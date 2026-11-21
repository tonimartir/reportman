// Bytes to text as .NET reads them: HttpContent.ReadAsStringAsync (the charset of the Content-Type, else a
// byte order mark, else UTF-8; invalid sequences become U+FFFD) and the connections file
// (DbxIniDocument: UTF-8 with a BOM, else the ANSI code page of Windows). Written by hand so that the
// package needs no TextDecoder.

import { NetException } from '@reportman/engine';

type Decoder = (bytes: Uint8Array, start: number) => string;

/** UTF-8 with the replacement of the Unicode best practice (the one of .NET Core and of TextDecoder). */
export function decodeUtf8(bytes: Uint8Array, start = 0): string {
  let out = '';
  let i = start;
  const n = bytes.length;
  const chunk: number[] = [];
  const flush = (): void => {
    if (chunk.length > 0) {
      out += String.fromCharCode(...chunk);
      chunk.length = 0;
    }
  };
  const push = (code: number): void => {
    if (code > 0xffff) {
      code -= 0x10000;
      chunk.push(0xd800 | (code >> 10), 0xdc00 | (code & 0x3ff));
    } else chunk.push(code);
    if (chunk.length > 8000) flush();
  };
  while (i < n) {
    const b = bytes[i]!;
    if (b < 0x80) {
      push(b);
      i++;
      continue;
    }
    let need = 0;
    let code = 0;
    let lower = 0x80;
    let upper = 0xbf;
    if (b >= 0xc2 && b <= 0xdf) {
      need = 1;
      code = b & 0x1f;
    } else if (b >= 0xe0 && b <= 0xef) {
      need = 2;
      code = b & 0x0f;
      if (b === 0xe0) lower = 0xa0;
      if (b === 0xed) upper = 0x9f;
    } else if (b >= 0xf0 && b <= 0xf4) {
      need = 3;
      code = b & 0x07;
      if (b === 0xf0) lower = 0x90;
      if (b === 0xf4) upper = 0x8f;
    } else {
      push(0xfffd);
      i++;
      continue;
    }
    let j = i + 1;
    let ok = true;
    for (let k = 0; k < need; k++, j++) {
      const c = j < n ? bytes[j]! : -1;
      if (c < lower || c > upper) {
        ok = false;
        break;
      }
      lower = 0x80;
      upper = 0xbf;
      code = (code << 6) | (c & 0x3f);
    }
    if (!ok) {
      // the maximal subpart is replaced by one U+FFFD; the byte that broke it starts again
      push(0xfffd);
      i = j;
      continue;
    }
    push(code);
    i = j;
  }
  flush();
  return out;
}

function decodeUtf16(bytes: Uint8Array, start: number, bigEndian: boolean): string {
  const units: number[] = [];
  for (let i = start; i + 1 < bytes.length; i += 2) units.push(bigEndian ? (bytes[i]! << 8) | bytes[i + 1]! : bytes[i]! | (bytes[i + 1]! << 8));
  let out = '';
  for (let i = 0; i < units.length; i++) {
    const u = units[i]!;
    if (u >= 0xd800 && u <= 0xdbff && i + 1 < units.length && units[i + 1]! >= 0xdc00 && units[i + 1]! <= 0xdfff) {
      out += String.fromCharCode(u, units[i + 1]!);
      i++;
    } else if (u >= 0xd800 && u <= 0xdfff) out += '�';
    else out += String.fromCharCode(u);
  }
  if ((bytes.length - start) % 2 === 1) out += '�';
  return out;
}

function decodeUtf32(bytes: Uint8Array, start: number, bigEndian: boolean): string {
  let out = '';
  for (let i = start; i + 3 < bytes.length; i += 4) {
    const cp = bigEndian
      ? ((bytes[i]! << 24) | (bytes[i + 1]! << 16) | (bytes[i + 2]! << 8) | bytes[i + 3]!) >>> 0
      : ((bytes[i + 3]! << 24) | (bytes[i + 2]! << 16) | (bytes[i + 1]! << 8) | bytes[i]!) >>> 0;
    out += cp > 0x10ffff || (cp >= 0xd800 && cp <= 0xdfff) ? '�' : String.fromCodePoint(cp);
  }
  if ((bytes.length - start) % 4 !== 0) out += '�';
  return out;
}

/** Encoding.Latin1: each byte is the code point. */
function decodeLatin1(bytes: Uint8Array, start: number): string {
  let out = '';
  for (let i = start; i < bytes.length; i++) out += String.fromCharCode(bytes[i]!);
  return out;
}

/** ASCII: a byte above 0x7F is '?'. */
function decodeAscii(bytes: Uint8Array, start: number): string {
  let out = '';
  for (let i = start; i < bytes.length; i++) out += bytes[i]! < 0x80 ? String.fromCharCode(bytes[i]!) : '?';
  return out;
}

const CP1252_HIGH = [
  0x20ac, 0xfffd, 0x201a, 0x0192, 0x201e, 0x2026, 0x2020, 0x2021, 0x02c6, 0x2030, 0x0160, 0x2039, 0x0152, 0xfffd, 0x017d, 0xfffd,
  0xfffd, 0x2018, 0x2019, 0x201c, 0x201d, 0x2022, 0x2013, 0x2014, 0x02dc, 0x2122, 0x0161, 0x203a, 0x0153, 0xfffd, 0x017e, 0x0178,
];

/** Windows-1252 (the ANSI code page of a Western Windows). */
export function decodeWindows1252(bytes: Uint8Array, start = 0): string {
  let out = '';
  for (let i = start; i < bytes.length; i++) {
    const b = bytes[i]!;
    out += String.fromCharCode(b >= 0x80 && b < 0xa0 ? CP1252_HIGH[b - 0x80]! : b);
  }
  return out;
}

interface Charset {
  decode: Decoder;
  /** The byte order mark of the encoding (dropped when the text starts with it). */
  preamble: readonly number[];
}

const UTF8: Charset = { decode: decodeUtf8, preamble: [0xef, 0xbb, 0xbf] };
const UTF16LE: Charset = { decode: (b, s) => decodeUtf16(b, s, false), preamble: [0xff, 0xfe] };
const UTF16BE: Charset = { decode: (b, s) => decodeUtf16(b, s, true), preamble: [0xfe, 0xff] };
const UTF32LE: Charset = { decode: (b, s) => decodeUtf32(b, s, false), preamble: [0xff, 0xfe, 0, 0] };
const UTF32BE: Charset = { decode: (b, s) => decodeUtf32(b, s, true), preamble: [0, 0, 0xfe, 0xff] };
const LATIN1: Charset = { decode: decodeLatin1, preamble: [] };
const ASCII: Charset = { decode: decodeAscii, preamble: [] };
const CP1252: Charset = { decode: decodeWindows1252, preamble: [] };

/** The names Encoding.GetEncoding knows for these encodings (case insensitive). */
const CHARSETS: Record<string, Charset> = {
  'utf-8': UTF8, utf8: UTF8, 'unicode-1-1-utf-8': UTF8, 'unicode-2-0-utf-8': UTF8, 'x-unicode20utf8': UTF8,
  'utf-16': UTF16LE, 'utf-16le': UTF16LE, unicode: UTF16LE, 'ucs-2': UTF16LE, 'iso-10646-ucs-2': UTF16LE, 'unicodefffe': UTF16BE,
  'utf-16be': UTF16BE, 'utf-32': UTF32LE, 'utf-32le': UTF32LE, 'utf-32be': UTF32BE,
  'iso-8859-1': LATIN1, latin1: LATIN1, 'iso_8859-1': LATIN1, 'iso_8859-1:1987': LATIN1, l1: LATIN1, 'iso-ir-100': LATIN1,
  ibm819: LATIN1, cp819: LATIN1, csisolatin1: LATIN1,
  'us-ascii': ASCII, ascii: ASCII, 'ansi_x3.4-1968': ASCII, 'ansi_x3.4-1986': ASCII, 'iso646-us': ASCII, us: ASCII,
  'iso-ir-6': ASCII, ibm367: ASCII, cp367: ASCII, csascii: ASCII,
  'windows-1252': CP1252, 'x-ansi': CP1252, cp1252: CP1252,
};

function startsWith(bytes: Uint8Array, preamble: readonly number[]): boolean {
  if (preamble.length === 0 || bytes.length < preamble.length) return false;
  for (let i = 0; i < preamble.length; i++) if (bytes[i] !== preamble[i]) return false;
  return true;
}

/** The charset parameter of a Content-Type value, without one set of quotes; undefined without one. */
export function contentTypeCharset(contentType: string | null | undefined): string | undefined {
  if (contentType === null || contentType === undefined) return undefined;
  for (const part of contentType.split(';').slice(1)) {
    const eq = part.indexOf('=');
    if (eq < 0) continue;
    if (part.substring(0, eq).trim().toLowerCase() !== 'charset') continue;
    let value = part.substring(eq + 1).trim();
    if (value.length > 2 && value.startsWith('"') && value.endsWith('"')) value = value.substring(1, value.length - 1);
    return value;
  }
  return undefined;
}

/**
 * HttpContent.ReadAsStringAsync: the encoding of the charset of the Content-Type (an unknown one is the
 * InvalidOperationException of .NET), else of the byte order mark, else UTF-8; the byte order mark is
 * dropped.
 */
export function readContentAsString(bytes: Uint8Array, contentType: string | null | undefined): string {
  const charset = contentTypeCharset(contentType);
  if (charset !== undefined) {
    const encoding = CHARSETS[charset.toLowerCase()];
    if (encoding === undefined)
      throw new NetException(
        'InvalidOperationException',
        'The character set provided in ContentType is invalid. Cannot read content as string using an invalid character set.',
      );
    return encoding.decode(bytes, startsWith(bytes, encoding.preamble) ? encoding.preamble.length : 0);
  }
  for (const encoding of [UTF8, UTF32LE, UTF16LE, UTF16BE])
    if (startsWith(bytes, encoding.preamble)) return encoding.decode(bytes, encoding.preamble.length);
  return decodeUtf8(bytes, 0);
}

/**
 * The text of a connections file as DbxIniDocument reads it: UTF-8 after a BOM, otherwise the ANSI code
 * page of Windows, here Windows-1252 (the C# engine reads a file without BOM as UTF-8 outside Windows: give
 * the text instead of the bytes then).
 */
export function readIniText(bytes: Uint8Array): string {
  if (startsWith(bytes, UTF8.preamble)) return decodeUtf8(bytes, 3);
  return decodeWindows1252(bytes, 0);
}
