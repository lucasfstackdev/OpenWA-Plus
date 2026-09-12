import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Between, LessThanOrEqual, Like, MoreThanOrEqual, Repository } from 'typeorm';
import { KirvanoEventLog } from './entities/kirvano-event-log.entity';
import type { KirvanoEventType } from './entities/kirvano-event-config.entity';
import { createLogger } from '../../common/services/logger.service';

/** Upper bound on a single event-log page, so a large `limit` can't load the whole table at once. */
export const MAX_KIRVANO_EVENT_LOG_PAGE_SIZE = 200;

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
