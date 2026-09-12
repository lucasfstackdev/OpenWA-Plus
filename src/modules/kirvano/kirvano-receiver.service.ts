import { BadRequestException, Injectable } from '@nestjs/common';
import { KirvanoService } from './kirvano.service';
import { KirvanoTokenService } from './kirvano-token.service';
import { KirvanoEventLogService } from './kirvano-event-log.service';
import { KIRVANO_EVENT_MAP } from './kirvano-event-map';
import { buildVars, extractCustomerName, extractPhoneDigits } from './kirvano-payload.util';
import { toParticipantWid } from '../../engine/identity/wa-id';
import { ContactService } from '../contact/contact.service';
import { createLogger } from '../../common/services/logger.service';

export interface KirvanoWebhookResult {
  /**
   * 'queued' means the event was persisted and scheduled — not that it's in the in-memory dispatch
   * queue yet. KirvanoEventLogSweeperService moves it there once the event's delayMinutes elapses.
   */
  status: 'queued' | 'ignored';
  event?: string;
}

@Injectable()
export class KirvanoReceiverService {
  private readonly logger = createLogger('KirvanoReceiverService');

  constructor(
    private readonly kirvanoService: KirvanoService,
    private readonly tokenService: KirvanoTokenService,
    private readonly eventLogService: KirvanoEventLogService,
    private readonly contactService: ContactService,
  ) {}

  async handleWebhook(
    sessionId: string,
    token: string | undefined,
    payload: Record<string, unknown>,
  ): Promise<KirvanoWebhookResult> {
    await this.tokenService.assertValidToken(sessionId, token);

    const rawEvent = typeof payload.event === 'string' ? payload.event : '';
    const eventType = KIRVANO_EVENT_MAP[rawEvent];
    if (!eventType) {
      this.logger.log('Ignoring unmapped Kirvano event', { sessionId, event: rawEvent });
      return { status: 'ignored', event: rawEvent || undefined };
    }

    // Same idempotent creation listEvents() relies on — the receiver must work even if the dashboard's
    // /kirvano page was never opened for this session.
    const config = await this.kirvanoService.ensureConfig(sessionId, eventType);
    if (!config.enabled) {
      this.logger.log('Ignoring disabled Kirvano event', { sessionId, event: eventType });
      return { status: 'ignored', event: eventType };
    }

    const phone = extractPhoneDigits(payload);
    if (!phone) {
      throw new BadRequestException('Missing or empty customer.phone_number in payload');
    }

    let chatId = toParticipantWid(phone);
    try {
      const resolved = await this.contactService.getNumberId(sessionId, phone);
      if (resolved === null) {
        this.logger.log('Ignoring Kirvano event: number not registered on WhatsApp', {
          sessionId,
          event: eventType,
        });
        return { status: 'ignored', event: eventType };
      }
      chatId = resolved; // canonical resolved JID, more precise than the syntactic guess above
    } catch (err) {
      // Session not connected / engine unavailable — can't verify right now. Don't block the
      // webhook over it: fall back to the syntactic chatId and let the failure handling that
      // already exists in KirvanoDispatchQueueService (try/catch + log, queue keeps draining)
      // deal with it — exactly the behaviour from before this check existed.
      this.logger.warn('Could not verify WhatsApp number before dispatch, proceeding anyway', {
        sessionId,
        event: eventType,
        error: err instanceof Error ? err.message : String(err),
      });
    }

    await this.eventLogService.recordPending(sessionId, {
      eventType,
      chatId,
      templateId: config.templateId,
      vars: buildVars(payload),
      customerName: extractCustomerName(payload) ?? null,
      customerPhone: phone,
      delayMinutes: config.delayMinutes,
      receivedAt: new Date(),
    });

    return { status: 'queued', event: eventType };
  }
}
