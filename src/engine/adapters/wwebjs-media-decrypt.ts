import { createDecipheriv, createHash, createHmac, hkdfSync, timingSafeEqual } from 'crypto';

/** HKDF `info` label per WhatsApp media type (same labels Baileys uses). */
const MEDIA_KEY_INFO: Record<string, string> = {
  image: 'WhatsApp Image Keys',
  sticker: 'WhatsApp Image Keys',
  video: 'WhatsApp Video Keys',
  gif: 'WhatsApp Video Keys',
  audio: 'WhatsApp Audio Keys',
  ptt: 'WhatsApp Audio Keys',
  document: 'WhatsApp Document Keys',
};

const CDN_ORIGIN = 'https://mmg.whatsapp.net';

export interface WaMediaRef {
  directPath: string;
  /** base64 */
  mediaKey: string;
  /** base64 */
  encFilehash?: string;
  /** WhatsApp message type: image, video, audio, ptt, document, sticker. */
  type: string;
}

/**
 * Decrypts a WhatsApp CDN media blob: AES-256-CBC with keys expanded from `mediaKey` via HKDF-SHA256
 * (112 bytes = iv 16 | cipherKey 32 | macKey 32 | rest), the last 10 bytes of the blob being a
 * truncated HMAC-SHA256 over iv+ciphertext. Throws on an unknown type or a MAC mismatch.
 */
export function decryptWaMedia(encrypted: Buffer, mediaKey: Buffer, type: string): Buffer {
  const info = MEDIA_KEY_INFO[type];
  if (!info) throw new Error(`Unsupported media type for decryption: ${type}`);
  if (encrypted.length <= 10) throw new Error('Encrypted media is too short');

  const expanded = Buffer.from(hkdfSync('sha256', mediaKey, Buffer.alloc(32), info, 112));
  const iv = expanded.subarray(0, 16);
  const cipherKey = expanded.subarray(16, 48);
  const macKey = expanded.subarray(48, 80);

  const ciphertext = encrypted.subarray(0, encrypted.length - 10);
  const mac = encrypted.subarray(encrypted.length - 10);
  const expectedMac = createHmac('sha256', macKey).update(iv).update(ciphertext).digest().subarray(0, 10);
  if (!timingSafeEqual(mac, expectedMac)) throw new Error('Media MAC mismatch');

  const decipher = createDecipheriv('aes-256-cbc', cipherKey, iv);
  return Buffer.concat([decipher.update(ciphertext), decipher.final()]);
}

/**
 * Fetch a media blob straight from WhatsApp's CDN and decrypt it in Node. Used when WhatsApp Web's
 * own downloader refuses the response (it rejects the CDN's `application/octet-stream` content type
 * as "unexpected for media type image"). The origin is fixed; only the signed `directPath` varies,
 * and it must be a path, never a URL, so this cannot be pointed at another host.
 */
export async function downloadAndDecryptWaMedia(
  ref: WaMediaRef,
  maxBytes: number,
  fetcher: typeof fetch = fetch,
): Promise<Buffer> {
  if (!ref.directPath.startsWith('/') || ref.directPath.startsWith('//')) {
    throw new Error('Unexpected media directPath');
  }
  const res = await fetcher(`${CDN_ORIGIN}${ref.directPath}`);
  if (!res.ok) throw new Error(`Media CDN responded ${res.status}`);
  const declared = Number(res.headers.get('content-length'));
  if (Number.isFinite(declared) && declared > maxBytes) throw new Error('Media exceeds the download cap');
  const encrypted = Buffer.from(await res.arrayBuffer());
  if (encrypted.length > maxBytes) throw new Error('Media exceeds the download cap');

  if (ref.encFilehash) {
    const actual = createHash('sha256').update(encrypted).digest('base64');
    if (actual !== ref.encFilehash) throw new Error('Encrypted media hash mismatch');
  }
  return decryptWaMedia(encrypted, Buffer.from(ref.mediaKey, 'base64'), ref.type);
}
