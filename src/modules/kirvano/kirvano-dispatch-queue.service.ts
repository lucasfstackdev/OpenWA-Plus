import { Injectable } from '@nestjs/common';
import { MessageService } from '../message/message.service';
import { createLogger } from '../../common/services/logger.service';

export interface KirvanoDispatchJob {
  chatId: string;
  templateId: string;
  vars: Record<string, string>;
  /** Kept only for logging a failed dispatch — not sent anywhere. */
  eventType?: string;
}

interface SessionQueueState {
  queue: KirvanoDispatchJob[];
  /** Timestamps of the sends still inside the trailing WINDOW_MS window, oldest first. */
  sendTimestamps: number[];
  processing: boolean;
}

const WINDOW_MS = 5000;
const MAX_PER_WINDOW = 2;

/**
 * Paces Kirvano-triggered message sends per session: at most MAX_PER_WINDOW sends in any trailing
 * WINDOW_MS window, queuing (never dropping or rejecting) whatever doesn't fit yet. Deliberately an
 * in-memory FIFO with a sliding-window gate rather than BullMQ — the existing WEBHOOK/INGRESS queues
 * require QUEUE_ENABLED=true (Redis), and this pacing needs to work with zero extra config, in the
 * same spirit as BulkMessageService's sleep-between-sends loop.
 *
 * One independent queue+window per sessionId: a burst of events on one session never delays another
 * session's dispatch (mirrors SendPacingService, which already gates sends per sessionId).
 */
@Injectable()
export class KirvanoDispatchQueueService {
  private readonly logger = createLogger('KirvanoDispatchQueueService');
  private readonly sessions = new Map<string, SessionQueueState>();

  // Swappable test seams (see kirvano-dispatch-queue.service.spec.ts) — production code never
  // reassigns these, so a real Date.now()/setTimeout is used outside tests.
  now: () => number = () => Date.now();
  sleep: (ms: number) => Promise<void> = ms => new Promise(resolve => setTimeout(resolve, ms));

  constructor(private readonly messageService: MessageService) {}

  enqueue(sessionId: string, job: KirvanoDispatchJob): void {
    const state = this.getOrCreateState(sessionId);
    state.queue.push(job);
    void this.process(sessionId, state);
  }

  private getOrCreateState(sessionId: string): SessionQueueState {
    let state = this.sessions.get(sessionId);
    if (!state) {
      state = { queue: [], sendTimestamps: [], processing: false };
      this.sessions.set(sessionId, state);
    }
    return state;
  }

  private async process(sessionId: string, state: SessionQueueState): Promise<void> {
    // Only one processing loop per session at a time — a concurrent enqueue() just grows the queue
    // the running loop is already draining, rather than starting a second competing loop.
    if (state.processing) return;
    state.processing = true;
    try {
      let job: KirvanoDispatchJob | undefined;
      while ((job = state.queue.shift())) {
        await this.waitForSlot(state);
        state.sendTimestamps.push(this.now());
        try {
          await this.messageService.sendTemplate(sessionId, {
            chatId: job.chatId,
            templateId: job.templateId,
            vars: job.vars,
          });
        } catch (err) {
          // A failed dispatch (deleted template, session offline, invalid chatId, ...) must not stop
          // the rest of the queue for this session, nor propagate anywhere — the HTTP response for the
          // webhook that enqueued this job was already sent.
          this.logger.warn('Kirvano dispatch failed', {
            sessionId,
            eventType: job.eventType,
            error: err instanceof Error ? err.message : String(err),
          });
        }
      }
    } finally {
      state.processing = false;
    }
  }

  /** Blocks until fewer than MAX_PER_WINDOW sends for this session fall within the trailing window. */
  private async waitForSlot(state: SessionQueueState): Promise<void> {
    for (;;) {
      const now = this.now();
      state.sendTimestamps = state.sendTimestamps.filter(t => now - t < WINDOW_MS);
      if (state.sendTimestamps.length < MAX_PER_WINDOW) return;
      const oldest = state.sendTimestamps[0];
      const waitMs = WINDOW_MS - (now - oldest);
      await this.sleep(Math.max(waitMs, 25));
    }
  }
}
