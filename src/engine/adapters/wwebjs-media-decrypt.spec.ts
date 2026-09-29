import { createCipheriv, createHmac, hkdfSync, randomBytes } from 'crypto';
import { decryptWaMedia, downloadAndDecryptWaMedia } from './wwebjs-media-decrypt';

function encrypt(plain: Buffer, key: Buffer, info: string): Buffer {
  const x = Buffer.from(hkdfSync('sha256', key, Buffer.alloc(32), info, 112));
  const iv = x.subarray(0, 16);
  const c = createCipheriv('aes-256-cbc', x.subarray(16, 48), iv);
  const ct = Buffer.concat([c.update(plain), c.final()]);
  const mac = createHmac('sha256', x.subarray(48, 80)).update(iv).update(ct).digest().subarray(0, 10);
  return Buffer.concat([ct, mac]);
}

describe('wwebjs-media-decrypt', () => {
  const key = randomBytes(32);
  const plain = Buffer.from('hello media');

  it('round-trips an image blob', () => {
    expect(decryptWaMedia(encrypt(plain, key, 'WhatsApp Image Keys'), key, 'image')).toEqual(plain);
  });

  it('rejects a tampered blob', () => {
    const enc = encrypt(plain, key, 'WhatsApp Image Keys');
    enc[0] ^= 1;
    expect(() => decryptWaMedia(enc, key, 'image')).toThrow('MAC mismatch');
  });

  it('downloads from the fixed CDN origin and decrypts', async () => {
    const enc = encrypt(plain, key, 'WhatsApp Audio Keys');
    const fetcher = jest.fn().mockResolvedValue({
      ok: true,
      status: 200,
      headers: { get: () => String(enc.length) },
      arrayBuffer: () => Promise.resolve(enc.buffer.slice(enc.byteOffset, enc.byteOffset + enc.length)),
    });
    const out = await downloadAndDecryptWaMedia(
      { directPath: '/v/t62/x?y=1', mediaKey: key.toString('base64'), type: 'ptt' },
      1024,
      fetcher as unknown as typeof fetch,
    );
    expect(out).toEqual(plain);
    expect(fetcher).toHaveBeenCalledWith('https://mmg.whatsapp.net/v/t62/x?y=1');
  });

  it('refuses a non-path directPath', async () => {
    await expect(
      downloadAndDecryptWaMedia({ directPath: '//evil.example/x', mediaKey: '', type: 'image' }, 10),
    ).rejects.toThrow('directPath');
  });
});
