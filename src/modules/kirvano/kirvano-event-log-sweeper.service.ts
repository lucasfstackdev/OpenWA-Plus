import { Injectable, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { KirvanoEventLogService } from './kirvano-event-log.service';
import { KirvanoDispatchQueueService } from './kirvano-dispatch-queue.service';
import { createLogger } from '../../common/services/logger.service';
import { resolveNonNegativeIntEnv } from '../../config/configuration';

/** How many due rows a single sweep pass hands to the dispatch queue at once. */
const SWEEP_BATCH_SIZE = 50;

export interface KirvanoSweepOptions {
  intervalMs: number;
  maxAttempts: number;
  retryDelayMs: number;
}

export function resolveKirvanoSweepOptions(env: NodeJS.ProcessEnv = process.env): KirvanoSweepOptions {
  const maxAttempts = Number(env.KIRVANO_EVENT_DISPATCH_MAX_ATTEMPTS);
  return {
    intervalMs: resolveNonNegativeIntEnv(env.KIRVANO_DISPATCH_SWEEP_INTERVAL_MS, 5_000),
    maxAttempts: Number.isInteger(maxAttempts) && maxAttempts >= 1 ? maxAttempts : 3,
    retryDelayMs: resolveNonNegativeIntEnv(env.KIRVANO_EVENT_DISPATCH_RETRY_DELAY_MS, 60_000),
  };
}

/**
 * Owns the "wait out the delay, then dispatch" half of the Kirvano flow: KirvanoReceiverService only
 * persists a 'pending' row (see kirvano-event-log.service.ts); this sweep is what actually moves it
 * into KirvanoDispatchQueueService once its `dispatchAt` elapses. A plain unref'd setInterval, same
 * shape as IngressReconcilerService — no BullMQ/@nestjs/schedule dependency (neither is assumed to be
 * configured), and the project runs a single replica (see charts/openwa/values.yaml), so an in-process
 * timer is sufficient: there's no second instance that could double-sweep the same row.
 *
 * A failed dispatch is retried automatically (see KirvanoEventLogService.recordDispatchOutcome): the
 * row simply reappears as 'pending' with a later `dispatchAt`, so it's picked up by a later pass of
 * this exact sweep — no separate retry path, no operator action.
 *
 * Known gap: if the process crashes between markQueued and the dispatch settling, the row is stranded
 * in 'queued' forever (no second-level reconciler like IngressReconcilerService exists for this yet).
 * Out of scope for now — single-replica deployment makes this a rare, ops-visible edge case rather
 * than a routine one.
 */
@Injectable()
export class KirvanoEventLogSweeperService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = createLogger('KirvanoEventLogSweeperService');
  private timer?: ReturnType<typeof setInterval>;
  private sweeping = false;

  constructor(
    private readonly eventLogService: KirvanoEventLogService,
    private readonly dispatchQueue: KirvanoDispatchQueueService,
  ) {}

  onModuleInit(): void {
    const opts = resolveKirvanoSweepOptions();
    if (opts.intervalMs <= 0) {
      this.logger.log('Kirvano event-log sweeper disabled (KIRVANO_DISPATCH_SWEEP_INTERVAL_MS <= 0)');
      return;
    }
    this.timer = setInterval(() => {
      this.sweep(opts).catch(err =>
        this.logger.error('Kirvano event-log sweep failed', err instanceof Error ? err.stack : String(err)),
      );
    }, opts.intervalMs);
    this.timer.unref?.();
  }

  onModuleDestroy(): void {
    if (this.timer) clearInterval(this.timer);
  }

  async sweep(opts: KirvanoSweepOptions, now: Date = new Date()): Promise<void> {
    if (this.sweeping) return;
    this.sweeping = true;
    try {
      const due = await this.eventLogService.findDueForDispatch(now, SWEEP_BATCH_SIZE);
      for (const row of due) {
        // Marked 'queued' BEFORE enqueue: findDueForDispatch only selects 'pending' rows, so this
        // stops the next sweep pass (which could fire before this row's dispatch settles) from
        // enqueueing it a second time.
        await this.eventLogService.markQueued(row.id);
        this.dispatchQueue.enqueue(row.sessionId, {
          chatId: row.chatId,
          templateId: row.templateId,
          vars: row.vars,
          eventType: row.eventType,
          onSettled: result => {
            const outcome =
              result.outcome === 'sent' ? { ok: true as const } : { ok: false as const, error: result.error };
            this.eventLogService
              .recordDispatchOutcome(row.id, outcome, {
                maxAttempts: opts.maxAttempts,
                retryDelayMs: opts.retryDelayMs,
              })
              .catch(err =>
                this.logger.error(
                  'Failed to persist Kirvano dispatch outcome',
                  err instanceof Error ? err.stack : String(err),
                  { id: row.id },
                ),
              );
          },
        });
      }
    } finally {
      this.sweeping = false;
    }
  }
}
