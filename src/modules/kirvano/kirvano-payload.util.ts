/**
 * Defensive readers over the raw Kirvano webhook payload (`sample-kirvano.payload.md`). The payload
 * is accepted as an untyped `Record<string, unknown>` (see kirvano-receiver.controller.ts for why), so
 * every field is read with a runtime type check rather than assumed present — the same field is
 * missing on some event types (e.g. `checkout_url` is absent from PIX_GENERATED/SALE_APPROVED) and a
 * malformed/evolving payload from Kirvano must degrade to "variable omitted", never throw.
 */

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : undefined;
}

function asString(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}

/** The only shape Kirvano documents for its date fields: `YYYY-MM-DD HH:mm:ss`, no timezone. */
const KIRVANO_DATETIME_PATTERN = /^(\d{4})-(\d{2})-(\d{2}) (\d{2}):(\d{2}):(\d{2})$/;

/**
 * Reformats a Kirvano `YYYY-MM-DD HH:mm:ss` timestamp to the Brazilian `DD/MM/YYYY HH:mm` display
 * format (seconds dropped). Kirvano sends no timezone, so this is a pure string reformat — the value
 * is already in the payment's local time, nothing is converted. A value that doesn't match the
 * documented shape is returned unchanged rather than thrown on, same as every other reader here.
 */
export function formatLocalDateTime(value: string): string {
  const match = KIRVANO_DATETIME_PATTERN.exec(value);
  if (!match) return value;
  const [, year, month, day, hour, minute] = match;
  return `${day}/${month}/${year} ${hour}:${minute}`;
}

/**
 * Builds the `{{variable}}` substitution map from a Kirvano payload — the same 7 keys the default
 * templates use (see kirvano-default-templates.ts). Only keys with a real value are set; renderTemplate
 * leaves an unset placeholder literal, so a template referencing an absent variable degrades visibly
 * instead of silently blanking.
 */
export function buildVars(payload: Record<string, unknown>): Record<string, string> {
  const payment = asRecord(payload.payment);
  const products = Array.isArray(payload.products) ? payload.products : [];

  const vars: Record<string, string> = {};

  const customerName = extractCustomerName(payload);
  if (customerName) vars['customer.name'] = customerName;

  const totalPrice = asString(payload.total_price);
  if (totalPrice) vars.total_price = totalPrice;

  const productNames = products
    .map(product => asString(asRecord(product)?.name))
    .filter((name): name is string => !!name);
  if (productNames.length > 0) vars.products = productNames.join(', ');

  const qrcodeImage = asString(payment?.qrcode_image);
  if (qrcodeImage) vars['payment.qrcode_image'] = qrcodeImage;

  const qrcode = asString(payment?.qrcode);
  if (qrcode) vars['payment.qrcode'] = qrcode;

  const expiresAt = asString(payment?.expires_at);
  if (expiresAt) vars['payment.expires_at'] = formatLocalDateTime(expiresAt);

  const checkoutUrl = asString(payload.checkout_url);
  if (checkoutUrl) vars.checkout_url = checkoutUrl;

  return vars;
}

/** `customer.name`, or undefined when absent/empty. */
export function extractCustomerName(payload: Record<string, unknown>): string | undefined {
  const customer = asRecord(payload.customer);
  return asString(customer?.name);
}

/** Digits of `customer.phone_number`, or undefined when absent/empty (e.g. "5511987654321"). */
export function extractPhoneDigits(payload: Record<string, unknown>): string | undefined {
  const customer = asRecord(payload.customer);
  const phone = asString(customer?.phone_number);
  if (!phone) return undefined;
  const digits = phone.replace(/\D/g, '');
  return digits.length > 0 ? digits : undefined;
}
