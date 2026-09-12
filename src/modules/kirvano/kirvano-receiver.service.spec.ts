import { BadRequestException, UnauthorizedException } from '@nestjs/common';
import { KirvanoReceiverService } from './kirvano-receiver.service';
import type { KirvanoService } from './kirvano.service';
import type { KirvanoTokenService } from './kirvano-token.service';
import type { KirvanoEventLogService } from './kirvano-event-log.service';
import type { ContactService } from '../contact/contact.service';
import type { KirvanoEventConfig } from './entities/kirvano-event-config.entity';

describe('KirvanoReceiverService', () => {
  let kirvanoService: { ensureConfig: jest.Mock };
  let tokenService: { assertValidToken: jest.Mock };
  let eventLogService: { recordPending: jest.Mock };
  let contactService: { getNumberId: jest.Mock };
  let service: KirvanoReceiverService;

  const config = (overrides: Partial<KirvanoEventConfig> = {}): KirvanoEventConfig =>
    ({
      id: 'cfg-1',
      sessionId: 'sessA',
      eventType: 'ON_PIX_GENERATED',
      templateId: 'tpl-1',
      enabled: true,
      delayMinutes: 1,
      createdAt: new Date(),
      updatedAt: new Date(),
      ...overrides,
    }) as KirvanoEventConfig;

  const payload = {
    event: 'PIX_GENERATED',
    total_price: 'R$ 169,80',
    customer: { name: 'João da Silva', phone_number: '5511987654321' },
    payment: { qrcode: 'copia-e-cola', qrcode_image: 'http://x/qr.png', expires_at: '2023-12-18 17:38:17' },
    products: [{ name: 'Curso A' }],
  };

  beforeEach(() => {
    kirvanoService = { ensureConfig: jest.fn().mockResolvedValue(config()) };
    tokenService = { assertValidToken: jest.fn().mockResolvedValue(undefined) };
    eventLogService = { recordPending: jest.fn().mockResolvedValue(undefined) };
    // Default: number exists and resolves to the same JID the syntactic fallback would guess, so
    // tests that don't care about number verification keep asserting the plain chatId shape.
    contactService = { getNumberId: jest.fn().mockResolvedValue('5511987654321@c.us') };
    service = new KirvanoReceiverService(
      kirvanoService as unknown as KirvanoService,
      tokenService as unknown as KirvanoTokenService,
      eventLogService as unknown as KirvanoEventLogService,
      contactService as unknown as ContactService,
    );
  });

  it('validates the token before doing anything else', async () => {
    tokenService.assertValidToken.mockRejectedValue(new UnauthorizedException('nope'));

    await expect(service.handleWebhook('sessA', 'wrong', payload)).rejects.toBeInstanceOf(UnauthorizedException);
    expect(kirvanoService.ensureConfig).not.toHaveBeenCalled();
    expect(eventLogService.recordPending).not.toHaveBeenCalled();
  });

  it('ignores an unmapped event type without touching config or the log', async () => {
    const result = await service.handleWebhook('sessA', 'tok', { event: 'SUBSCRIPTION_CANCELED' });

    expect(result).toEqual({ status: 'ignored', event: 'SUBSCRIPTION_CANCELED' });
    expect(kirvanoService.ensureConfig).not.toHaveBeenCalled();
    expect(eventLogService.recordPending).not.toHaveBeenCalled();
  });

  it('ignores a mapped event whose config is disabled', async () => {
    kirvanoService.ensureConfig.mockResolvedValue(config({ enabled: false }));

    const result = await service.handleWebhook('sessA', 'tok', payload);

    expect(result).toEqual({ status: 'ignored', event: 'ON_PIX_GENERATED' });
    expect(eventLogService.recordPending).not.toHaveBeenCalled();
  });

  it('rejects a payload missing customer.phone_number', async () => {
    const { customer: _customer, ...withoutPhone } = payload;
    void _customer;

    await expect(service.handleWebhook('sessA', 'tok', withoutPhone)).rejects.toBeInstanceOf(BadRequestException);
    expect(eventLogService.recordPending).not.toHaveBeenCalled();
  });

  it('persists a pending log row for a valid, enabled event', async () => {
    const result = await service.handleWebhook('sessA', 'tok', payload);

    expect(result).toEqual({ status: 'queued', event: 'ON_PIX_GENERATED' });
    expect(kirvanoService.ensureConfig).toHaveBeenCalledWith('sessA', 'ON_PIX_GENERATED');
    expect(eventLogService.recordPending).toHaveBeenCalledWith(
      'sessA',
      expect.objectContaining({
        eventType: 'ON_PIX_GENERATED',
        chatId: '5511987654321@c.us',
        templateId: 'tpl-1',
        vars: {
          'customer.name': 'João da Silva',
          total_price: 'R$ 169,80',
          products: 'Curso A',
          'payment.qrcode_image': 'http://x/qr.png',
          'payment.qrcode': 'copia-e-cola',
          'payment.expires_at': '18/12/2023 17:38',
        },
        customerName: 'João da Silva',
        customerPhone: '5511987654321',
        delayMinutes: 1,
      }),
    );
  });

  it('checks WhatsApp number existence and uses the resolved JID as chatId', async () => {
    contactService.getNumberId.mockResolvedValue('5511987654321@lid');

    const result = await service.handleWebhook('sessA', 'tok', payload);

    expect(result).toEqual({ status: 'queued', event: 'ON_PIX_GENERATED' });
    expect(contactService.getNumberId).toHaveBeenCalledWith('sessA', '5511987654321');
    expect(eventLogService.recordPending).toHaveBeenCalledWith(
      'sessA',
      expect.objectContaining({ chatId: '5511987654321@lid' }),
    );
  });

  it('ignores the event when the number is not registered on WhatsApp', async () => {
    contactService.getNumberId.mockResolvedValue(null);

    const result = await service.handleWebhook('sessA', 'tok', payload);

    expect(result).toEqual({ status: 'ignored', event: 'ON_PIX_GENERATED' });
    expect(eventLogService.recordPending).not.toHaveBeenCalled();
  });

  it('falls back to the syntactic chatId when the existence check itself fails', async () => {
    contactService.getNumberId.mockRejectedValue(new Error('Session is not started'));

    const result = await service.handleWebhook('sessA', 'tok', payload);

    expect(result).toEqual({ status: 'queued', event: 'ON_PIX_GENERATED' });
    expect(eventLogService.recordPending).toHaveBeenCalledWith(
      'sessA',
      expect.objectContaining({ chatId: '5511987654321@c.us' }),
    );
  });
});
