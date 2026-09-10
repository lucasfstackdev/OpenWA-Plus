import {
  Entity,
  Column,
  Index,
  PrimaryGeneratedColumn,
  CreateDateColumn,
  UpdateDateColumn,
  ManyToOne,
  JoinColumn,
} from 'typeorm';
import { Session } from '../../session/entities/session.entity';

/** The four Kirvano checkout events the dashboard exposes a message-template mapping for. */
export type KirvanoEventType = 'ON_ABANDONED_CART' | 'ON_PIX_EXPIRED' | 'ON_PIX_GENERATED' | 'ON_SALE_APPROVED';

export const KIRVANO_EVENT_TYPES: KirvanoEventType[] = [
  'ON_ABANDONED_CART',
  'ON_PIX_EXPIRED',
  'ON_PIX_GENERATED',
  'ON_SALE_APPROVED',
];

/**
 * Per-session mapping from a Kirvano webhook event to the message template that should be sent, and
 * whether the event is currently active. One row per (session, eventType) — enforced by the unique
 * index below. The actual Kirvano webhook ingress endpoint that consumes this config is out of scope
 * here and lands separately.
 */
@Index('IDX_kirvano_event_configs_session_event', ['sessionId', 'eventType'], { unique: true })
@Entity('kirvano_event_configs')
export class KirvanoEventConfig {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  // varchar (not uuid) to match sessions.id, same reasoning as the other per-session entities
  // (templates, webhooks, automation_rules): the data connection runs synchronize:false, so a 'uuid'
  // decorator here would only mislead schema diffs / a stray sync.
  @Column({ type: 'varchar' })
  sessionId!: string;

  @ManyToOne(() => Session, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'sessionId' })
  session!: Session;

  @Column({ type: 'varchar', length: 40 })
  eventType!: KirvanoEventType;

  // References templates.id within the same session; not a DB-level FK so the template CRUD in
  // TemplateModule stays free to delete/rename without this table needing to know about it — the
  // service resolves it via TemplateService and surfaces a 404 if it's gone.
  @Column({ type: 'varchar' })
  templateId!: string;

  @Column({ type: 'boolean', default: true })
  enabled!: boolean;

  @CreateDateColumn()
  createdAt!: Date;

  @UpdateDateColumn()
  updatedAt!: Date;
}
