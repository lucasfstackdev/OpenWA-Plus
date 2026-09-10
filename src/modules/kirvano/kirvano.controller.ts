import { Body, Controller, Get, Param, Put } from '@nestjs/common';
import { ApiOperation, ApiParam, ApiResponse, ApiTags } from '@nestjs/swagger';
import { RequireRole } from '../auth/decorators/auth.decorators';
import { ApiKeyRole } from '../auth/entities/api-key.entity';
import { KirvanoService } from './kirvano.service';
import { KirvanoEventConfigResponseDto, UpdateKirvanoEventConfigDto } from './dto';

@ApiTags('kirvano')
@Controller('sessions/:sessionId/kirvano/events')
export class KirvanoController {
  constructor(private readonly kirvanoService: KirvanoService) {}

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
