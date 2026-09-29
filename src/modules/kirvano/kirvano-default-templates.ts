import { KirvanoEventType } from './entities/kirvano-event-config.entity';

/**
 * Seed content for the message template created the first time a session's Kirvano events are
 * listed. The `[Kirvano]` prefix on `name` keeps these easy to spot in the shared /templates list
 * without needing a schema change to the (already widely used) Template entity.
 */
export interface KirvanoDefaultTemplate {
  name: string;
  body: string;
}

export const KIRVANO_DEFAULT_TEMPLATES: Record<KirvanoEventType, KirvanoDefaultTemplate> = {
  ON_PIX_GENERATED: {
    name: '[Kirvano] Pix Gerado',
    body:
      'Olá *{{customer.name}}*, tudo bem? \n\n' +
      'Geramos o PIX no valor de *{{total_price}}* para sua compra (*{{products}}*).\n' +
      'Escaneie o QR Code para pagar: {{payment.qrcode_image}}\n' +
      'Ele expira em {{payment.expires_at}}.\n\n' +
      'Ou copie o PIX abaixo\n' +
      '{{payment.qrcode}}',
  },
  ON_PIX_EXPIRED: {
    name: '[Kirvano] Pix Expirado',
    body:
      'Olá *{{customer.name}}*!\n\n' +
      'Ainda não identificamos o pagamento do PIX no valor de *{{total_price}}* (*{{products}}*) e ele já expirou.\n' +
      'Você pode gerar um novo pagamento aqui: {{checkout_url}}',
  },
  ON_SALE_APPROVED: {
    name: '[Kirvano] Venda Aprovada',
    body:
      'Olá *{{customer.name}}*, tudo bem?\n\n' +
      'Sua compra de *{{products}}* no valor de *{{total_price}}* foi *aprovada*! ✅\n' +
      'Obrigado pela confiança',
  },
  ON_ABANDONED_CART: {
    name: '[Kirvano] Carrinho Abandonado',
    body:
      'Olá *{{customer.name}}*!\n\n' +
      'Notamos que você não finalizou sua compra de *{{products}}* - (*{{total_price}}*).\n' +
      'Retome de onde parou: {{checkout_url}}',
  },
};
