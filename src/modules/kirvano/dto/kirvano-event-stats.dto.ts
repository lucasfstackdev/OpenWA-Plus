import { ApiProperty } from '@nestjs/swagger';
import { Expose } from 'class-transformer';
import type { KirvanoEventType } from '../entities/kirvano-event-config.entity';

export class KirvanoEventStatsPointDto {
  @ApiProperty({ description: 'Bucket label: "YYYY-MM-DD" (day granularity) or "YYYY-MM-DD HH:00:00" (hour)' })
  @Expose()
  timestamp!: string;

  @ApiProperty()
  @Expose()
  ON_ABANDONED_CART!: number;

  @ApiProperty()
  @Expose()
  ON_PIX_EXPIRED!: number;

  @ApiProperty()
  @Expose()
  ON_PIX_GENERATED!: number;

  @ApiProperty()
  @Expose()
  ON_SALE_APPROVED!: number;
}

export class KirvanoEventStatsResponseDto {
  @ApiProperty({
    description: 'Total events received per type across the whole [from, to] range, regardless of dispatch status',
    example: { ON_ABANDONED_CART: 12, ON_PIX_EXPIRED: 3, ON_PIX_GENERATED: 20, ON_SALE_APPROVED: 8 },
  })
  @Expose()
  totals!: Record<KirvanoEventType, number>;

  @ApiProperty({
    type: KirvanoEventStatsPointDto,
    isArray: true,
    description:
      'One point per bucket, in chronological order. Bucket granularity is hour when the ' +
      'range is 36h or less, day otherwise.',
  })
  @Expose()
  timeSeries!: KirvanoEventStatsPointDto[];
}
