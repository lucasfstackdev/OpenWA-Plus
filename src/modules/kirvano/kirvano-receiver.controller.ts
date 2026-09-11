import { Body, Controller, Headers, HttpCode, HttpStatus, Param, Post, UseGuards } from '@nestjs/common';
import { ApiOperation, ApiParam, ApiResponse, ApiTags } from '@nestjs/swagger';
import { Public } from '../auth/decorators/auth.decorators';
import { KirvanoReceiverService, KirvanoWebhookResult } from './kirvano-receiver.service';
import { KirvanoReceiverThrottlerGuard } from './kirvano-receiver-throttler.guard';
import { createLogger } from '../../common/services/logger.service';

// @Public so the global ApiKeyGuard early-returns (Kirvano can't present an OpenWA API key) — auth is
// instead the X-Kirvano-Token header, checked in KirvanoReceiverService against the per-session token
// from KirvanoTokenController. The body is intentionally untyped (see the handler below) rather than
// bound to a class DTO: the global ValidationPipe runs with forbidNonWhitelisted: true, and Kirvano's
// payload carries ~15 fields per event (utm, offer ids, payment brand, ...) that vary by event type and
// that we don't use — a typed DTO would 400 on every field it doesn't declare.
@ApiTags('kirvano')
@Public()
@Controller('sessions/:sessionId/kirvano/receiver')
export class KirvanoReceiverController {
  private readonly logger = createLogger('KirvanoReceiverController');

  constructor(private readonly receiverService: KirvanoReceiverService) {}

  @UseGuards(KirvanoReceiverThrottlerGuard)
  @Post()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Kirvano checkout webhook receiver — dispatches the mapped message template' })
  @ApiParam({ name: 'sessionId', description: 'Session ID' })
  @ApiResponse({
    status: 200,
    description: 'Accepted: "queued" (dispatch enqueued) or "ignored" (unmapped/disabled event).',
  })
  @ApiResponse({ status: 400, description: 'Payload is missing customer.phone_number.' })
  @ApiResponse({ status: 401, description: 'Missing or invalid X-Kirvano-Token header.' })
  @ApiResponse({ status: 429, description: 'Per-session rate limit exceeded (KIRVANO_RECEIVER_LIMIT).' })
  async receive(
    @Param('sessionId') sessionId: string,
    // @Headers('x-kirvano-token') token: string | undefined,
    @Headers('security-token') token: string | undefined,
    @Headers() headers: Record<string, string>,
    @Body() payload: Record<string, unknown>,
  ): Promise<KirvanoWebhookResult> {
    this.logger.log('TOKEN', token);
    return this.receiverService.handleWebhook(sessionId, token, payload);
  }
}
