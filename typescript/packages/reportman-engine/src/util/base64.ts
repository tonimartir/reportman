// Convert.FromBase64String / Convert.ToBase64String without Node or DOM globals.

import { formatException, NetMessages } from './netexception.js';

const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
const DECODE = new Int16Array(128).fill(-1);
for (let i = 0; i < ALPHABET.length; i++) DECODE[ALPHABET.charCodeAt(i)] = i;

/**
 * Convert.FromBase64String: white space (space, tab, CR, LF) is ignored anywhere, the rest must be
 * groups of four characters with at most two '=' of padding at the end; anything else is the
 * FormatException of .NET. The unused bits of the last group are ignored.
 */
export function fromBase64String(s: string): Uint8Array {
  let clean = '';
  for (const c of s) {
    if (c === ' ' || c === '\t' || c === '\r' || c === '\n') continue;
    clean += c;
  }
  if (clean.length % 4 !== 0) throw formatException(NetMessages.badBase64);
  let padding = 0;
  if (clean.endsWith('==')) padding = 2;
  else if (clean.endsWith('=')) padding = 1;
  const body = clean.length - padding;
  const out = new Uint8Array((clean.length / 4) * 3 - padding);
  let o = 0;
  let acc = 0;
  let bits = 0;
  for (let i = 0; i < body; i++) {
    const code = clean.charCodeAt(i);
    const v = code < 128 ? DECODE[code]! : -1;
    if (v < 0) throw formatException(NetMessages.badBase64);
    acc = (acc << 6) | v;
    bits += 6;
    if (bits >= 8) {
      bits -= 8;
      if (o < out.length) out[o++] = (acc >> bits) & 0xff;
    }
  }
  return out;
}

/** Convert.ToBase64String. */
export function toBase64String(bytes: Uint8Array): string {
  let s = '';
  for (let i = 0; i < bytes.length; i += 3) {
    const b0 = bytes[i]!;
    const b1 = i + 1 < bytes.length ? bytes[i + 1]! : 0;
    const b2 = i + 2 < bytes.length ? bytes[i + 2]! : 0;
    s += ALPHABET[b0 >> 2]!;
    s += ALPHABET[((b0 & 3) << 4) | (b1 >> 4)]!;
    s += i + 1 < bytes.length ? ALPHABET[((b1 & 15) << 2) | (b2 >> 6)]! : '=';
    s += i + 2 < bytes.length ? ALPHABET[b2 & 63]! : '=';
  }
  return s;
}
