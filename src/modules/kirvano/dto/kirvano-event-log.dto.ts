import { ApiProperty } from '@nestjs/swagger';
import { Expose, plainToInstance } from 'class-transformer';
import { KirvanoEventLog } from '../entities/kirvano-event-log.entity';
import type { KirvanoEventLogStatus } from '../entities/kirvano-event-log.entity';
import type { KirvanoEventType } from '../entities/kirvano-event-config.entity';

export class KirvanoEventLogResponseDto {
  @ApiProperty()
  @Expose()
  id!: string;

  @ApiProperty()
  @Expose()
  sessionId!: string;

  @ApiProperty({ enum: ['ON_ABANDONED_CART', 'ON_PIX_EXPIRED', 'ON_PIX_GENERATED', 'ON_SALE_APPROVED'] })
  @Expose()
  eventType!: KirvanoEventType;

  @ApiProperty()
  @Expose()
  receivedAt!: Date;

  @ApiProperty({ description: 'Estimated time the event enters the dispatch queue (receivedAt + delayMinutes)' })
  @Expose()
  dispatchAt!: Date;

  @ApiProperty({ enum: ['pending', 'queued', 'dispatched', 'failed'] })
  @Expose()
  status!: KirvanoEventLogStatus;

  @ApiProperty({ nullable: true })
  @Expose()
  customerName!: string | null;

  @ApiProperty({ nullable: true })
  @Expose()
  customerPhone!: string | null;

  @ApiProperty()
  @Expose()
  dispatchAttempts!: number;

  @ApiProperty({ nullable: true })
  @Expose()
  lastError!: string | null;

  @ApiProperty({ nullable: true })
  @Expose()
  dispatchedAt!: Date | null;

  static fromEntity(entity: KirvanoEventLog): KirvanoEventLogResponseDto {
    return plainToInstance(KirvanoEventLogResponseDto, entity, { excludeExtraneousValues: true });
  }
}

export class KirvanoEventLogListResponseDto {
  @ApiProperty({ type: KirvanoEventLogResponseDto, isArray: true })
  @Expose()
  data!: KirvanoEventLogResponseDto[];

  @ApiProperty()
  @Expose()
  total!: number;
}
