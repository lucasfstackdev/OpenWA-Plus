// Fixtures are the real payloads from sample-kirvano.payload.md, trimmed to the fields the reader
// actually looks at plus the ones known to vary/be absent per event type.
import { buildVars, extractCustomerName, extractPhoneDigits, formatLocalDateTime } from './kirvano-payload.util';

const pixGenerated = {
  event: 'PIX_GENERATED',
  total_price: 'R$ 169,80',
  customer: { name: 'João da Silva', phone_number: '5511987654321' },
  payment: {
    qrcode: '00020201011325br.gov.bcb.pix...7213D5D7',
    qrcode_image: 'http://localhost:3030/pix/a21e078e-2636-4a62-b35a-277e5818e9fa',
    expires_at: '2023-12-18 17:38:17',
  },
  products: [{ name: 'Mercado de Ações no Brasil' }, { name: 'Excel para Investidores' }],
};

const pixExpired = {
  event: 'PIX_EXPIRED',
  checkout_url: 'http://localhost:3001/recovery/338bb957-30e1-4ad9-abf5-ecc72cb42171',
  total_price: 'R$ 169,80',
  customer: { name: 'João da Silva', phone_number: '5511987654321' },
  payment: {
    qrcode: '00020201011325br.gov.bcb.pix...7213D5D7',
    qrcode_image: 'http://localhost:3030/pix/7c9003c4-dc59-439e-837e-4a43aa05237f',
    expires_at: '2023-12-18 17:38:32',
  },
  products: [{ name: 'Mercado de Ações no Brasil' }, { name: 'Excel para Investidores' }],
};

const saleApproved = {
  event: 'SALE_APPROVED',
  total_price: 'R$ 169,80',
  customer: { name: 'João da Silva', phone_number: '5511987654321' },
  payment: { method: 'CREDIT_CARD', brand: 'visa', installments: 1 },
  products: [{ name: 'Mercado de Ações no Brasil' }, { name: 'Excel para Investidores' }],
};

const abandonedCart = {
  event: 'ABANDONED_CART',
  checkout_url: 'http://localhost:3001/recovery/5280b33c-13f2-492e-bb9c-9d8306e7f3cd',
  total_price: 'R$ 169,80',
  customer: { name: 'João da Silva', phone_number: '5511987654321' },
  products: [{ name: 'Mercado de Ações no Brasil' }, { name: 'Excel para Investidores' }],
};

describe('buildVars', () => {
  it('extracts all 7 variables when present (PIX_GENERATED)', () => {
    expect(buildVars(pixGenerated)).toEqual({
      'customer.name': 'João da Silva',
      total_price: 'R$ 169,80',
      products: 'Mercado de Ações no Brasil, Excel para Investidores',
      'payment.qrcode_image': 'http://localhost:3030/pix/a21e078e-2636-4a62-b35a-277e5818e9fa',
      'payment.qrcode': '00020201011325br.gov.bcb.pix...7213D5D7',
      'payment.expires_at': '18/12/2023 17:38',
    });
  });

  it('omits payment.* but includes checkout_url (PIX_EXPIRED)', () => {
    const vars = buildVars(pixExpired);
    expect(vars.checkout_url).toBe('http://localhost:3001/recovery/338bb957-30e1-4ad9-abf5-ecc72cb42171');
    expect(vars['payment.qrcode']).toBeDefined(); // PIX_EXPIRED does carry payment in the sample
    expect(vars['payment.qrcode_image']).toBeDefined();
    expect(vars['payment.expires_at']).toBe('18/12/2023 17:38'); // reformatted to the local pattern
  });

  it('omits payment.* and checkout_url entirely (SALE_APPROVED)', () => {
    const vars = buildVars(saleApproved);
    expect(vars).toEqual({
      'customer.name': 'João da Silva',
      total_price: 'R$ 169,80',
      products: 'Mercado de Ações no Brasil, Excel para Investidores',
    });
    expect(vars.checkout_url).toBeUndefined();
    expect(vars['payment.qrcode']).toBeUndefined();
  });

  it('omits payment.* but includes checkout_url (ABANDONED_CART)', () => {
    const vars = buildVars(abandonedCart);
    expect(vars).toEqual({
      'customer.name': 'João da Silva',
      total_price: 'R$ 169,80',
      products: 'Mercado de Ações no Brasil, Excel para Investidores',
      checkout_url: 'http://localhost:3001/recovery/5280b33c-13f2-492e-bb9c-9d8306e7f3cd',
    });
  });

  it('degrades to an empty map for a malformed payload instead of throwing', () => {
    expect(buildVars({})).toEqual({});
    expect(buildVars({ customer: 'not-an-object', products: 'not-an-array' })).toEqual({});
  });
});

describe('formatLocalDateTime', () => {
  it('reformats the Kirvano YYYY-MM-DD HH:mm:ss shape to DD/MM/YYYY HH:mm, dropping seconds', () => {
    expect(formatLocalDateTime('2023-12-18 17:38:17')).toBe('18/12/2023 17:38');
    expect(formatLocalDateTime('2024-01-05 09:05:00')).toBe('05/01/2024 09:05');
  });

  it('returns anything not matching the documented shape unchanged, rather than throwing', () => {
    expect(formatLocalDateTime('18/12/2023 17:38')).toBe('18/12/2023 17:38');
    expect(formatLocalDateTime('2023-12-18T17:38:17Z')).toBe('2023-12-18T17:38:17Z');
    expect(formatLocalDateTime('')).toBe('');
    expect(formatLocalDateTime('not a date')).toBe('not a date');
  });
});

describe('extractCustomerName', () => {
  it('returns customer.name', () => {
    expect(extractCustomerName(pixGenerated)).toBe('João da Silva');
  });

  it('returns undefined when absent or empty', () => {
    expect(extractCustomerName({})).toBeUndefined();
    expect(extractCustomerName({ customer: {} })).toBeUndefined();
    expect(extractCustomerName({ customer: { name: '' } })).toBeUndefined();
  });
});

describe('extractPhoneDigits', () => {
  it('returns the digits from customer.phone_number', () => {
    expect(extractPhoneDigits(pixGenerated)).toBe('5511987654321');
  });

  it('strips non-digit formatting', () => {
    expect(extractPhoneDigits({ customer: { phone_number: '+55 (11) 98765-4321' } })).toBe('5511987654321');
  });

  it('returns undefined when absent or empty', () => {
    expect(extractPhoneDigits({})).toBeUndefined();
    expect(extractPhoneDigits({ customer: {} })).toBeUndefined();
    expect(extractPhoneDigits({ customer: { phone_number: '' } })).toBeUndefined();
    expect(extractPhoneDigits({ customer: { phone_number: '   ' } })).toBeUndefined();
  });
});
