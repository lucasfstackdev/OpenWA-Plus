import { Entity, Column, Index, PrimaryGeneratedColumn, CreateDateColumn, ManyToOne, JoinColumn } from 'typeorm';
import { dateColumnType, jsonColumnType } from '../../../common/utils/column-types';
import { DateTransformer } from '../../../common/transformers/date.transformer';
import { Session } from '../../session/entities/session.entity';
import type { KirvanoEventType } from './kirvano-event-config.entity';

/**
 * Lifecycle of a persisted Kirvano webhook event:
 *  - 'pending'    — recorded on webhook receipt (or re-queued after a retryable failure); the sweeper
 *                   (KirvanoEventLogSweeperService) picks it up once `dispatchAt` elapses.
 *  - 'queued'     — the sweeper handed it to KirvanoDispatchQueueService; awaiting the pacing gate.
 *  - 'dispatched' — the message was sent successfully.
 *  - 'failed'     — terminal: dispatch failed and the retry budget (dispatchAttempts vs
 *                   KIRVANO_EVENT_DISPATCH_MAX_ATTEMPTS) is exhausted. A retryable failure instead goes
 *                   back to 'pending' with a later `dispatchAt` — see KirvanoEventLogService.
 */
export type KirvanoEventLogStatus = 'pending' | 'queued' | 'dispatched' | 'failed';

/**
 * One row per Kirvano webhook event received, persisted before the delayed dispatch it feeds. Carries
 * everything needed to re-hydrate the KirvanoDispatchQueueService job at dispatch time (chatId,
 * templateId, vars), so the sweeper never needs to re-read the original webhook payload.
 */
@Entity('kirvano_event_logs')
@Index('IDX_kirvano_event_logs_session_received', ['sessionId', 'receivedAt'])
@Index('IDX_kirvano_event_logs_status_dispatchAt', ['status', 'dispatchAt'])
export class KirvanoEventLog {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'varchar' })
  sessionId!: string;

  @ManyToOne(() => Session, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'sessionId' })
  session!: Session;

  @Column({ type: 'varchar', length: 40 })
  eventType!: KirvanoEventType;

  @Column({ type: dateColumnType(), transformer: DateTransformer })
  receivedAt!: Date;

  // receivedAt + the event config's delayMinutes at the time the webhook was received, computed once
  // here — a later change to the event's delayMinutes does not retroactively move an in-flight row.
  @Column({ type: dateColumnType(), transformer: DateTransformer })
  dispatchAt!: Date;

  @Column({ type: 'varchar', length: 20, default: 'pending' })
  status!: KirvanoEventLogStatus;

  @Column({ type: 'varchar', nullable: true })
  customerName!: string | null;

  @Column({ type: 'varchar', nullable: true })
  customerPhone!: string | null;

  // Needed to re-hydrate the KirvanoDispatchQueueService job when the sweeper releases this row.
  @Column({ type: 'varchar' })
  chatId!: string;

  @Column({ type: 'varchar' })
  templateId!: string;

  @Column({ type: jsonColumnType() })
  vars!: Record<string, string>;

  @Column({ type: 'int', default: 0 })
  dispatchAttempts!: number;

  @Column({ type: 'varchar', nullable: true })
  lastError!: string | null;

  @Column({ type: dateColumnType(), nullable: true, transformer: DateTransformer })
  dispatchedAt!: Date | null;

  @CreateDateColumn()
  createdAt!: Date;
}
