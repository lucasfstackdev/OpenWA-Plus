import { BadRequestException, Body, Controller, Get, Param, Put, Query } from '@nestjs/common';
import { ApiOperation, ApiParam, ApiQuery, ApiResponse, ApiTags } from '@nestjs/swagger';
import { RequireRole } from '../auth/decorators/auth.decorators';
import { ApiKeyRole } from '../auth/entities/api-key.entity';
import { KirvanoService } from './kirvano.service';
import { KirvanoEventLogService } from './kirvano-event-log.service';
import {
  KirvanoEventConfigResponseDto,
  KirvanoEventLogListResponseDto,
  KirvanoEventLogResponseDto,
  KirvanoEventStatsResponseDto,
  UpdateKirvanoEventConfigDto,
} from './dto';

@ApiTags('kirvano')
@Controller('sessions/:sessionId/kirvano/events')
export class KirvanoController {
  constructor(
    private readonly kirvanoService: KirvanoService,
    private readonly eventLogService: KirvanoEventLogService,
  ) {}

  @Get()
  @RequireRole(ApiKeyRole.OPERATOR)
  @ApiOperation({ summary: "List the session's Kirvano event configs (seeding defaults on first call)" })
  @ApiParam({ name: 'sessionId', description: 'Session ID' })
  @ApiResponse({
    status: 200,
    description: 'The 4 Kirvano events.',
    type: KirvanoEventConfigResponseDto,
    isArray: true,
  })
  async list(@Param('sessionId') sessionId: string): Promise<KirvanoEventConfigResponseDto[]> {
    return (await this.kirvanoService.listEvents(sessionId)).map(config =>
      KirvanoEventConfigResponseDto.fromEntity(config),
    );
  }

  @Get('log')
  @RequireRole(ApiKeyRole.OPERATOR)
  @ApiOperation({ summary: "List the session's persisted Kirvano webhook event log, newest first" })
  @ApiParam({ name: 'sessionId', description: 'Session ID' })
  @ApiQuery({ name: 'from', required: false, description: 'ISO datetime lower bound on receivedAt' })
  @ApiQuery({ name: 'to', required: false, description: 'ISO datetime upper bound on receivedAt' })
  @ApiQuery({ name: 'eventType', required: false })
  @ApiQuery({ name: 'search', required: false, description: 'Matches customer name or phone' })
  @ApiQuery({ name: 'limit', required: false, type: Number })
  @ApiQuery({ name: 'offset', required: false, type: Number })
  @ApiResponse({ status: 200, description: 'Paginated event log.', type: KirvanoEventLogListResponseDto })
  async listLog(
    @Param('sessionId') sessionId: string,
    @Query('from') from?: string,
    @Query('to') to?: string,
    @Query('eventType') eventType?: string,
    @Query('search') search?: string,
    @Query('limit') limit?: string,
    @Query('offset') offset?: string,
  ): Promise<KirvanoEventLogListResponseDto> {
    const result = await this.eventLogService.list(sessionId, {
      from: from ? new Date(from) : undefined,
      to: to ? new Date(to) : undefined,
      eventType,
      search,
      limit: limit ? parseInt(limit, 10) : undefined,
      offset: offset ? parseInt(offset, 10) : undefined,
    });
    return { data: result.data.map(entity => KirvanoEventLogResponseDto.fromEntity(entity)), total: result.total };
  }

  @Get('stats')
  @RequireRole(ApiKeyRole.OPERATOR)
  @ApiOperation({ summary: "Aggregate the session's Kirvano event counts per type, bucketed for a chart" })
  @ApiParam({ name: 'sessionId', description: 'Session ID' })
  @ApiQuery({ name: 'from', required: true, description: 'ISO datetime lower bound on receivedAt' })
  @ApiQuery({ name: 'to', required: true, description: 'ISO datetime upper bound on receivedAt' })
  @ApiResponse({
    status: 200,
    description: 'Per-type totals and a bucketed time series.',
    type: KirvanoEventStatsResponseDto,
  })
  @ApiResponse({ status: 400, description: 'Missing/invalid from or to, or an out-of-range span.' })
  async getStats(
    @Param('sessionId') sessionId: string,
    @Query('from') from?: string,
    @Query('to') to?: string,
  ): Promise<KirvanoEventStatsResponseDto> {
    if (!from || !to) {
      throw new BadRequestException('`from` and `to` are required');
    }
    const fromDate = new Date(from);
    const toDate = new Date(to);
    if (Number.isNaN(fromDate.getTime()) || Number.isNaN(toDate.getTime())) {
      throw new BadRequestException('`from` and `to` must be valid ISO datetimes');
    }
    return this.eventLogService.getStats(sessionId, fromDate, toDate);
  }

  @Put(':eventType')
  @RequireRole(ApiKeyRole.OPERATOR)
  @ApiOperation({ summary: 'Update the template and/or active state for one Kirvano event' })
  @ApiParam({ name: 'sessionId', description: 'Session ID' })
  @ApiParam({ name: 'eventType', description: 'Kirvano event type' })
  @ApiResponse({ status: 200, description: 'Updated event config.', type: KirvanoEventConfigResponseDto })
  @ApiResponse({ status: 404, description: 'Unknown event type, or the referenced template does not exist.' })
  async update(
    @Param('sessionId') sessionId: string,
    @Param('eventType') eventType: string,
    @Body() dto: UpdateKirvanoEventConfigDto,
  ): Promise<KirvanoEventConfigResponseDto> {
    return KirvanoEventConfigResponseDto.fromEntity(await this.kirvanoService.updateEvent(sessionId, eventType, dto));
  }
}
