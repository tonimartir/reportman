// Base64 without Buffer, so that the designer's protocol runs in a browser too (a service worker).

const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
const VALUES = new Int16Array(128).fill(-1);
for (let i = 0; i < ALPHABET.length; i++) VALUES[ALPHABET.charCodeAt(i)] = i;

/** The base64 text of some bytes (Convert.ToBase64String). */
export function bytesToBase64(bytes: Uint8Array): string {
  let out = '';
  let i = 0;
  for (; i + 2 < bytes.length; i += 3) {
    const n = (bytes[i]! << 16) | (bytes[i + 1]! << 8) | bytes[i + 2]!;
    out += ALPHABET[(n >> 18) & 63]! + ALPHABET[(n >> 12) & 63]! + ALPHABET[(n >> 6) & 63]! + ALPHABET[n & 63]!;
  }
  if (i < bytes.length) {
    const n = (bytes[i]! << 16) | ((i + 1 < bytes.length ? bytes[i + 1]! : 0) << 8);
    out += ALPHABET[(n >> 18) & 63]! + ALPHABET[(n >> 12) & 63]!;
    out += i + 1 < bytes.length ? ALPHABET[(n >> 6) & 63]! + '=' : '==';
  }
  return out;
}

/** The bytes of a base64 text, skipping what is not of the alphabet (Buffer.from(text, 'base64')). */
export function base64ToBytes(text: string): Uint8Array {
  const out = new Uint8Array(Math.floor((text.length * 3) / 4) + 3);
  let length = 0;
  let bits = 0;
  let count = 0;
  for (let i = 0; i < text.length; i++) {
    const c = text.charCodeAt(i);
    if (c === 61) break;
    const v = c < 128 ? VALUES[c]! : -1;
    if (v < 0) continue;
    bits = (bits << 6) | v;
    count += 6;
    if (count >= 8) {
      count -= 8;
      out[length++] = (bits >> count) & 255;
    }
  }
  return out.subarray(0, length);
}
