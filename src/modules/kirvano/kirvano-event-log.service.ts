import { BadRequestException, Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Between, LessThanOrEqual, Like, MoreThanOrEqual, Repository } from 'typeorm';
import { KirvanoEventLog } from './entities/kirvano-event-log.entity';
import { KIRVANO_EVENT_TYPES } from './entities/kirvano-event-config.entity';
import type { KirvanoEventType } from './entities/kirvano-event-config.entity';
import { createLogger } from '../../common/services/logger.service';

/** Upper bound on a single event-log page, so a large `limit` can't load the whole table at once. */
export const MAX_KIRVANO_EVENT_LOG_PAGE_SIZE = 200;

/** Upper bound on a stats query's [from, to] span, so a pathological custom range can't force an
 *  unbounded GROUP BY scan. A year comfortably covers the "this month" / custom-range use cases. */
export const MAX_KIRVANO_STATS_RANGE_DAYS = 366;

export interface KirvanoEventStatsPoint {
  timestamp: string;
  ON_ABANDONED_CART: number;
  ON_PIX_EXPIRED: number;
  ON_PIX_GENERATED: number;
  ON_SALE_APPROVED: number;
}

export interface KirvanoEventStatsResult {
  totals: Record<KirvanoEventType, number>;
  timeSeries: KirvanoEventStatsPoint[];
}

/**
 * SQL for the time-series bucket over `k.receivedAt`, per DB dialect — same reasoning as
 * `timeSeriesTimestampSql` in stats.service.ts (SQLite's strftime() vs Postgres's to_char() + quoted
 * column), duplicated here rather than shared: coupling KirvanoModule to StatsModule for ~10 lines of
 * stable, dialect-specific SQL would cost more (a cross-module import, a shared refactor risk to
 * stats.service.ts's own tests) than the duplication does.
 */
function statsBucketSql(dbType: string, interval: 'hour' | 'day'): string {
  if (dbType === 'postgres') {
    const fmt = interval === 'hour' ? 'YYYY-MM-DD HH24:00:00' : 'YYYY-MM-DD';
    return `to_char(k."receivedAt", '${fmt}')`;
  }
  const fmt = interval === 'hour' ? '%Y-%m-%d %H:00:00' : '%Y-%m-%d';
  return `strftime('${fmt}', k.receivedAt)`;
}

function emptyEventTypeCounts(): Record<KirvanoEventType, number> {
  return Object.fromEntries(KIRVANO_EVENT_TYPES.map(type => [type, 0])) as Record<KirvanoEventType, number>;
}

export interface RecordPendingInput {
  eventType: KirvanoEventType;
  chatId: string;
  templateId: string;
  vars: Record<string, string>;
  customerName: string | null;
  customerPhone: string | null;
  delayMinutes: number;
  receivedAt: Date;
}

export interface KirvanoEventLogQueryOptions {
  from?: Date;
  to?: Date;
  eventType?: string;
  search?: string;
  limit?: number;
  offset?: number;
}

export interface DispatchOutcomeOptions {
  maxAttempts: number;
  retryDelayMs: number;
}

@Injectable()
export class KirvanoEventLogService {
  private readonly logger = createLogger('KirvanoEventLogService');

  constructor(
    @InjectRepository(KirvanoEventLog, 'data')
    private readonly repository: Repository<KirvanoEventLog>,
  ) {}

  async recordPending(sessionId: string, input: RecordPendingInput): Promise<KirvanoEventLog> {
    const dispatchAt = new Date(input.receivedAt.getTime() + input.delayMinutes * 60_000);
    const row = this.repository.create({
      sessionId,
      eventType: input.eventType,
      receivedAt: input.receivedAt,
      dispatchAt,
      status: 'pending',
      customerName: input.customerName,
      customerPhone: input.customerPhone,
      chatId: input.chatId,
      templateId: input.templateId,
      vars: input.vars,
      dispatchAttempts: 0,
      lastError: null,
      dispatchedAt: null,
    });
    return this.repository.save(row);
  }

  async list(
    sessionId: string,
    options: KirvanoEventLogQueryOptions = {},
  ): Promise<{ data: KirvanoEventLog[]; total: number }> {
    const baseWhere: Record<string, unknown> = { sessionId };

    if (options.eventType) baseWhere.eventType = options.eventType;

    if (options.from && options.to) {
      baseWhere.receivedAt = Between(options.from, options.to);
    } else if (options.from) {
      baseWhere.receivedAt = MoreThanOrEqual(options.from);
    } else if (options.to) {
      baseWhere.receivedAt = LessThanOrEqual(options.to);
    }

    // No cross-dialect ILIKE helper exists in this codebase yet — `Like` is used as-is, so the search
    // is case-sensitive on Postgres and case-insensitive on SQLite (its default `LIKE` collation).
    // Same tradeoff other ad-hoc searches in the project accept. An array `where` is TypeORM's OR: one
    // query matching either field, with take/skip applied correctly to the combined result set.
    const where = options.search
      ? [
          { ...baseWhere, customerName: Like(`%${options.search}%`) },
          { ...baseWhere, customerPhone: Like(`%${options.search}%`) },
        ]
      : baseWhere;

    const requested = options.limit && options.limit > 0 ? options.limit : 50;
    const take = Math.min(requested, MAX_KIRVANO_EVENT_LOG_PAGE_SIZE);
    const skip = options.offset && options.offset > 0 ? options.offset : 0;

    const [data, total] = await this.repository.findAndCount({
      where,
      order: { receivedAt: 'DESC' },
      take,
      skip,
    });

    return { data, total };
  }

  /**
   * Aggregate event counts per type over [from, to], bucketed for a line chart. Counts every logged
   * event regardless of dispatch status ("how many of this event came in", not "how many messages
   * were successfully sent") — the same metric backs both the per-type totals and the time series, so
   * a KPI card and its corresponding chart line always agree.
   *
   * Bucket granularity is derived from the range span, not requested explicitly: 36h or less groups by
   * hour (so a "today" range still shows a meaningful trend), otherwise by day — same rule
   * stats.service.ts uses for its fixed '24h' vs '7d'/'30d' periods, generalized to an arbitrary range.
   */
  async getStats(sessionId: string, from: Date, to: Date): Promise<KirvanoEventStatsResult> {
    if (to.getTime() <= from.getTime()) {
      throw new BadRequestException('`to` must be after `from`');
    }
    const spanMs = to.getTime() - from.getTime();
    if (spanMs > MAX_KIRVANO_STATS_RANGE_DAYS * 24 * 60 * 60 * 1000) {
      throw new BadRequestException(`Date range cannot exceed ${MAX_KIRVANO_STATS_RANGE_DAYS} days`);
    }
    const interval: 'hour' | 'day' = spanMs <= 36 * 60 * 60 * 1000 ? 'hour' : 'day';
    const dbType = this.repository.manager.dataSource.options.type;

    // `receivedAt`'s DateTransformer only runs for repository-level finds (Between/MoreThanOrEqual in
    // list() above) — a raw QueryBuilder condition like this one binds the parameter as-is. On SQLite
    // the column is `text` (ISO strings), so an unconverted Date parameter compares against it as
    // whatever better-sqlite3's default Date serialization produces, which never matches the stored
    // ISO string: every row was silently excluded. Converting here mirrors DateTransformer.to() exactly.
    const toBoundParam = (date: Date): string | Date => (dbType === 'postgres' ? date : date.toISOString());

    // Alias the bucket as `bucket`, not `timestamp`: `timestamp` is a reserved type keyword in
    // PostgreSQL, so `GROUP BY timestamp` would be read as the type rather than the output alias.
    const raw = await this.repository
      .createQueryBuilder('k')
      .select(statsBucketSql(dbType, interval), 'bucket')
      .addSelect('k.eventType', 'eventType')
      .addSelect('COUNT(*)', 'count')
      .where('k.sessionId = :sessionId', { sessionId })
      .andWhere('k.receivedAt >= :from', { from: toBoundParam(from) })
      .andWhere('k.receivedAt <= :to', { to: toBoundParam(to) })
      .groupBy('bucket')
      .addGroupBy('k.eventType')
      .orderBy('bucket', 'ASC')
      .getRawMany<{ bucket: string; eventType: KirvanoEventType; count: string }>();

    const totals = emptyEventTypeCounts();
    const bucketMap = new Map<string, Record<KirvanoEventType, number>>();

    for (const row of raw) {
      const count = parseInt(row.count, 10);
      totals[row.eventType] += count;
      if (!bucketMap.has(row.bucket)) {
        bucketMap.set(row.bucket, emptyEventTypeCounts());
      }
      bucketMap.get(row.bucket)![row.eventType] = count;
    }

    const timeSeries: KirvanoEventStatsPoint[] = Array.from(bucketMap.entries())
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
      .map(([timestamp, counts]) => ({ timestamp, ...counts }));

    return { totals, timeSeries };
  }

  async findDueForDispatch(now: Date, limit: number): Promise<KirvanoEventLog[]> {
    return this.repository.find({
      where: { status: 'pending', dispatchAt: LessThanOrEqual(now) },
      order: { dispatchAt: 'ASC' },
      take: limit,
    });
  }

  async markQueued(id: string): Promise<void> {
    await this.repository.update({ id }, { status: 'queued' });
  }

  /**
   * Records the outcome of a dispatch attempt. A success is terminal ('dispatched'). A failure either
   * goes back to 'pending' with a later `dispatchAt` (linear backoff: retryDelayMs * attempt) when the
   * retry budget isn't exhausted, or becomes terminal ('failed') once it is — fully automatic, no
   * operator action required either way.
   */
  async recordDispatchOutcome(
    id: string,
    outcome: { ok: true } | { ok: false; error: string },
    opts: DispatchOutcomeOptions,
  ): Promise<void> {
    if (outcome.ok) {
      await this.repository.update({ id }, { status: 'dispatched', dispatchedAt: new Date() });
      return;
    }

    const row = await this.repository.findOne({ where: { id } });
    if (!row) return;

    const attempts = (row.dispatchAttempts ?? 0) + 1;
    if (attempts < opts.maxAttempts) {
      const dispatchAt = new Date(Date.now() + opts.retryDelayMs * attempts);
      await this.repository.update(
        { id },
        { status: 'pending', dispatchAttempts: attempts, lastError: outcome.error, dispatchAt },
      );
      this.logger.log('Kirvano dispatch failed, scheduled for automatic retry', {
        id,
        attempts,
        maxAttempts: opts.maxAttempts,
      });
    } else {
      await this.repository.update({ id }, { status: 'failed', dispatchAttempts: attempts, lastError: outcome.error });
      this.logger.warn('Kirvano dispatch retry budget exhausted', { id, attempts });
    }
  }
}
