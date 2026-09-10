import { Entity, Column, PrimaryColumn, CreateDateColumn, UpdateDateColumn, OneToOne, JoinColumn } from 'typeorm';
import { Session } from '../../session/entities/session.entity';

/**
 * The Kirvano webhook receiver's per-session auth token. One row per session (sessionId is the
 * primary key, not generated) — a session either has a token or doesn't, there's nothing to list.
 */
@Entity('kirvano_integrations')
export class KirvanoIntegration {
  // varchar (not uuid) to match sessions.id, same reasoning as the other per-session entities in
  // this module: the data connection runs synchronize:false, so a 'uuid' decorator here would only
  // mislead schema diffs / a stray sync.
  @PrimaryColumn({ type: 'varchar' })
  sessionId!: string;

  @OneToOne(() => Session, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'sessionId' })
  session!: Session;

  @Column({ type: 'varchar', length: 64 })
  token!: string;

  @CreateDateColumn()
  createdAt!: Date;

  @UpdateDateColumn()
  updatedAt!: Date;
}
