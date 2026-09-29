import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Expose, plainToInstance } from 'class-transformer';
import { IsBoolean, IsInt, IsOptional, IsString, IsNotEmpty, Max, Min } from 'class-validator';
import { ToStrictBoolean } from '../../../common/utils/strict-boolean';
import { KirvanoEventConfig } from '../entities/kirvano-event-config.entity';
import type { KirvanoEventType } from '../entities/kirvano-event-config.entity';

export class UpdateKirvanoEventConfigDto {
  @ApiPropertyOptional({
    description: 'Id of an existing template (within the same session) to send when the event fires',
  })
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  templateId?: string;

  @ApiPropertyOptional({ description: 'Whether the event is currently active' })
  @IsOptional()
  @ToStrictBoolean()
  @IsBoolean()
  enabled?: boolean;

  @ApiPropertyOptional({
    description: 'Minutes to wait between receiving the webhook and enqueuing the message for dispatch',
  })
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(1440)
  delayMinutes?: number;
}

export class KirvanoEventConfigResponseDto {
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
  templateId!: string;

  @ApiProperty()
  @Expose()
  enabled!: boolean;

  @ApiProperty()
  @Expose()
  delayMinutes!: number;

  @ApiProperty()
  @Expose()
  createdAt!: Date;

  @ApiProperty()
  @Expose()
  updatedAt!: Date;

  static fromEntity(entity: KirvanoEventConfig): KirvanoEventConfigResponseDto {
    return plainToInstance(KirvanoEventConfigResponseDto, entity, { excludeExtraneousValues: true });
  }
}
