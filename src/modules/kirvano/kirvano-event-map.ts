import { KirvanoEventType } from './entities/kirvano-event-config.entity';

/**
 * Maps Kirvano's own `event` field values (from `sample-kirvano.payload.md`) to our internal event
 * types. Kirvano may add event types we don't handle (refunds, chargebacks, ...) — an unmapped value
 * is treated as "ignored", not an error, so the receiver never rejects a webhook Kirvano is entitled
 * to send just because we don't act on it yet.
 */
export const KIRVANO_EVENT_MAP: Record<string, KirvanoEventType> = {
  PIX_GENERATED: 'ON_PIX_GENERATED',
  PIX_EXPIRED: 'ON_PIX_EXPIRED',
  SALE_APPROVED: 'ON_SALE_APPROVED',
  ABANDONED_CART: 'ON_ABANDONED_CART',
};
