/**
 * Byte helpers for a core that has neither Buffer nor TextDecoder: the 1:1 byte to character
 * mapping of the report reader, base64 and UTF-8.
 */

/** Each byte becomes the character with its code (0-255), as the C# reader builds its string. */
export function bytesToLatin1(bytes: Uint8Array, start = 0, end = bytes.length): string {
  const chunk = 0x8000;
  let result = "";
  for (let i = start; i < end; i += chunk) {
    const slice = bytes.subarray(i, Math.min(i + chunk, end));
    result += String.fromCharCode.apply(null, slice as unknown as number[]);
  }
  return result;
}

/** UTF-16 code units to a string, in chunks (String.fromCharCode has an argument limit). */
export function codeUnitsToString(units: number[]): string {
  const chunk = 0x8000;
  let result = "";
  for (let i = 0; i < units.length; i += chunk) {
    result += String.fromCharCode.apply(null, units.slice(i, i + chunk));
  }
  return result;
}

const base64Chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
const base64Codes = (() => {
  const codes = new Int16Array(128).fill(-1);
  for (let i = 0; i < base64Chars.length; i++) codes[base64Chars.charCodeAt(i)] = i;
  return codes;
})();

/** Convert.ToBase64String. */
export function bytesToBase64(bytes: Uint8Array): string {
  let result = "";
  let i = 0;
  for (; i + 2 < bytes.length; i += 3) {
    const n = (bytes[i] << 16) | (bytes[i + 1] << 8) | bytes[i + 2];
    result +=
      base64Chars[(n >> 18) & 63] + base64Chars[(n >> 12) & 63] + base64Chars[(n >> 6) & 63] + base64Chars[n & 63];
  }
  const rest = bytes.length - i;
  if (rest === 1) {
    const n = bytes[i] << 16;
    result += base64Chars[(n >> 18) & 63] + base64Chars[(n >> 12) & 63] + "==";
  } else if (rest === 2) {
    const n = (bytes[i] << 16) | (bytes[i + 1] << 8);
    result += base64Chars[(n >> 18) & 63] + base64Chars[(n >> 12) & 63] + base64Chars[(n >> 6) & 63] + "=";
  }
  return result;
}

/** Convert.FromBase64String: white space is ignored; anything else that is not base64 throws. */
export function base64ToBytes(text: string): Uint8Array {
  const codes: number[] = [];
  let padding = 0;
  for (let i = 0; i < text.length; i++) {
    const c = text.charCodeAt(i);
    if (c === 0x20 || c === 0x09 || c === 0x0a || c === 0x0d) continue;
    if (c === 0x3d) {
      padding++;
      continue;
    }
    const v = c < 128 ? base64Codes[c] : -1;
    if (v < 0 || padding > 0) throw new Error("The input is not a valid Base-64 string.");
    codes.push(v);
  }
  if (padding > 2 || (codes.length + padding) % 4 !== 0 || codes.length % 4 === 1)
    throw new Error("The input is not a valid Base-64 string.");
  const result = new Uint8Array(Math.floor((codes.length * 6) / 8));
  let bits = 0;
  let value = 0;
  let index = 0;
  for (const code of codes) {
    value = (value << 6) | code;
    bits += 6;
    if (bits >= 8) {
      bits -= 8;
      result[index++] = (value >> bits) & 0xff;
    }
  }
  return result;
}

/**
 * UTF8Encoding.GetString: invalid sequences become U+FFFD, one for each maximal invalid
 * subpart (the Unicode recommended practice .NET follows). A byte order mark is kept.
 */
export function utf8ToString(bytes: Uint8Array): string {
  const units: number[] = [];
  let i = 0;
  const n = bytes.length;
  while (i < n) {
    const b0 = bytes[i];
    if (b0 < 0x80) {
      units.push(b0);
      i++;
      continue;
    }
    let need = 0;
    let cp = 0;
    let lower = 0x80;
    let upper = 0xbf;
    if (b0 >= 0xc2 && b0 <= 0xdf) {
      need = 1;
      cp = b0 & 0x1f;
    } else if (b0 >= 0xe0 && b0 <= 0xef) {
      need = 2;
      cp = b0 & 0x0f;
      if (b0 === 0xe0) lower = 0xa0;
      if (b0 === 0xed) upper = 0x9f;
    } else if (b0 >= 0xf0 && b0 <= 0xf4) {
      need = 3;
      cp = b0 & 0x07;
      if (b0 === 0xf0) lower = 0x90;
      if (b0 === 0xf4) upper = 0x8f;
    } else {
      units.push(0xfffd);
      i++;
      continue;
    }
    let j = i + 1;
    let ok = true;
    for (let k = 0; k < need; k++, j++) {
      const b = j < n ? bytes[j] : -1;
      if (b < lower || b > upper) {
        ok = false;
        break;
      }
      lower = 0x80;
      upper = 0xbf;
      cp = (cp << 6) | (b & 0x3f);
    }
    if (!ok) {
      units.push(0xfffd);
      i = j;
      continue;
    }
    if (cp >= 0x10000) {
      cp -= 0x10000;
      units.push(0xd800 + (cp >> 10), 0xdc00 + (cp & 0x3ff));
    } else {
      units.push(cp);
    }
    i = j;
  }
  return codeUnitsToString(units);
}
