// Text routines of the Delphi engine that its expression functions use (port of
// Reportman.Reporting/EvalFunctionsDelphi.cs): the ANSI code page, FormatMaskText of MaskUtils,
// the base64 decoding of Indy, TStrings.Text lines and the ReadString of TMemIniFile.

import { toUpperNet } from './chars.js';

// 0x80..0x9F of Windows-1252 (the undefined ones are the character of their code, as Windows
// converts them)
const HIGH = [
  0x20ac, 0x0081, 0x201a, 0x0192, 0x201e, 0x2026, 0x2020, 0x2021, 0x02c6, 0x2030, 0x0160, 0x2039, 0x0152, 0x008d, 0x017d, 0x008f,
  0x0090, 0x2018, 0x2019, 0x201c, 0x201d, 0x2022, 0x2013, 0x2014, 0x02dc, 0x2122, 0x0161, 0x203a, 0x0153, 0x009d, 0x017e, 0x0178,
];

/** AnsiText.Decode: the text of some bytes, one Windows-1252 character per byte. */
export function ansiDecode(bytes: Uint8Array): string {
  let s = '';
  for (const b of bytes) s += String.fromCharCode(b >= 0x80 && b < 0xa0 ? HIGH[b - 0x80]! : b);
  return s;
}

/** AnsiText.Encode: one byte per UTF-16 unit, '?' for a character outside Windows-1252. */
export function ansiEncode(text: string): Uint8Array {
  const bytes = new Uint8Array(text.length);
  for (let i = 0; i < text.length; i++) {
    const c = text.charCodeAt(i);
    if (c < 0x80 || (c >= 0xa0 && c <= 0xff)) bytes[i] = c;
    else {
      const index = HIGH.indexOf(c);
      bytes[i] = index >= 0 ? 0x80 + index : 0x3f;
    }
  }
  return bytes;
}

/** TextLines.Split: the lines of a text as TStrings.Text splits them (CR, LF or CR LF). */
export function textLines(text: string): string[] {
  const lines: string[] = [];
  let i = 0;
  while (i < text.length) {
    const start = i;
    while (i < text.length && text[i] !== '\r' && text[i] !== '\n') i++;
    lines.push(text.substring(start, i));
    if (i < text.length && text[i] === '\r') i++;
    if (i < text.length && text[i] === '\n') i++;
  }
  return lines;
}

/** Delphi's TrimLeft: the characters up to the space removed. */
export function trimLeftDelphi(s: string): string {
  let i = 0;
  while (i < s.length && s.charCodeAt(i) <= 32) i++;
  return s.substring(i);
}

/** Delphi's TrimRight. */
export function trimRightDelphi(s: string): string {
  let i = s.length;
  while (i > 0 && s.charCodeAt(i - 1) <= 32) i--;
  return s.substring(0, i);
}

/** Delphi's Trim. */
export function trimDelphi(s: string): string {
  return trimRightDelphi(trimLeftDelphi(s));
}

enum MaskKind {
  None,
  Literal,
  IntlLiteral,
  Directive,
  Mask,
  MaskOpt,
  FieldSeparator,
  Field,
}

function at(s: string, index0: number): string {
  return index0 >= 0 && index0 < s.length ? s[index0]! : '\0';
}

/** The kind of the mask character at the 1-based position p. */
function kindAt(mask: string, p: number): MaskKind {
  const n = mask.length;
  if (p > n) return MaskKind.None;
  const c = mask[p - 1]!;
  const code = c.charCodeAt(0);
  if (code >= 0xd800 && code <= 0xdfff) return MaskKind.Literal;
  // After a backslash that is not itself after a backslash
  if (p > 1 && at(mask, p - 2) === '\\' && !(p > 2 && at(mask, p - 3) === '\\')) return MaskKind.Literal;
  // The last four characters may hold the save flag and the blank: "...;0;_"
  const tail = n >= 4 && p > n - 4;
  if (c === ';' && tail) return MaskKind.FieldSeparator;
  if (tail && at(mask, p - 2) === ';' && !(p > 2 && at(mask, p - 3) === '\\')) return MaskKind.Field;
  switch (c) {
    case ':':
    case '/':
      return MaskKind.IntlLiteral;
    case '!':
    case '>':
    case '<':
    case '\\':
      return MaskKind.Directive;
    case 'l':
    case 'a':
    case 'c':
    case '#':
    case '9':
      return MaskKind.MaskOpt;
    case 'L':
    case 'A':
    case 'C':
    case '0':
      return MaskKind.Mask;
    default:
      return MaskKind.Literal;
  }
}

/** Whether the value keeps the literals of the mask (the save flag is not '0'). */
function keepsLiterals(mask: string): boolean {
  const n = mask.length;
  if (n < 4) return true;
  let last = -1;
  let first = -1;
  for (let i = n; i > 0 && i >= n - 4 && first < 0; i--) {
    if (kindAt(mask, i) === MaskKind.FieldSeparator) {
      if (last < 0) last = i;
      else first = i;
    }
  }
  if (first < 0) first = last;
  if (first > 0 && first !== n) return mask[first] !== '0';
  return true;
}

/** Delphi's string.SubString (Copy): a start before the text is its beginning. */
function sub(s: string, start0: number, length: number): string {
  const l = s.length;
  const offset = start0 + 1 < 1 ? 0 : Math.min(start0, l);
  const count = length < 0 ? 0 : Math.min(l - offset, length);
  return s.substring(offset, offset + count);
}

/** The characters of the mask up to p that take a place in the text. */
function places(mask: string, p: number): number {
  let count = 0;
  for (let i = 1; i <= p; i++) {
    const k = kindAt(mask, i);
    if (k !== MaskKind.Directive && k !== MaskKind.Field && k !== MaskKind.FieldSeparator) count++;
  }
  return count;
}

function padPart(value: string, startPart: number, stopPart: number, length: number, fromRight: boolean): string {
  const span = stopPart - startPart;
  if (span < length) {
    const padAt = fromRight ? startPart - 1 : stopPart - 1;
    return sub(value, 0, padAt) + ' '.repeat(length - span) + sub(value, padAt, value.length);
  }
  if (span > length) {
    if (fromRight) return sub(value, 0, startPart - 1) + sub(value, stopPart - 1 - length, value.length);
    return sub(value, 0, startPart + length - 1) + sub(value, stopPart - 1, value.length);
  }
  return value;
}

/**
 * EditMaskText.Format: FormatMaskText of Delphi's MaskUtils with an edit mask ("000-000;0;_"). A
 * mask that keeps its literals (save flag other than 0) expects the value to contain them and pads
 * each part with spaces, one that does not inserts them; '!' fills from the right; ':' and '/' are
 * the culture's separators; the blank character of the mask is not used.
 */
export function formatMaskText(mask: string, value: string, dateSeparator: string, timeSeparator: string): string {
  const dateChar = dateSeparator.length > 0 ? dateSeparator[0]! : '/';
  const timeChar = timeSeparator.length > 0 ? timeSeparator[0]! : ':';
  const literal = (c: string): string => (c === '/' ? dateChar : c === ':' ? timeChar : c);
  const fromRight = mask.includes('!');
  const n = mask.length;
  let result = value;
  if (!keepsLiterals(mask)) {
    // The literals are inserted, the missing places filled with spaces
    if (!fromRight) {
      let offset = 1;
      for (let p = 1; p <= n; p++) {
        const k = kindAt(mask, p);
        if (k === MaskKind.Literal || k === MaskKind.IntlLiteral) {
          result = sub(result, 0, offset - 1) + literal(mask[p - 1]!) + sub(result, offset - 1, result.length - offset + 1);
          offset++;
        } else if (k === MaskKind.Mask || k === MaskKind.MaskOpt) {
          if (offset > result.length) result += ' ';
          offset++;
        }
      }
    } else {
      let offset = result.length;
      for (let p = n; p >= 1; p--) {
        const k = kindAt(mask, p);
        if (k === MaskKind.Literal || k === MaskKind.IntlLiteral)
          result = sub(result, 0, offset) + literal(mask[p - 1]!) + sub(result, offset, result.length - offset);
        else if (k === MaskKind.Mask || k === MaskKind.MaskOpt) {
          if (offset < 1) result = ' ' + result;
          else offset--;
        }
      }
    }
    return result;
  }
  // The value has the literals: each part between them padded or cut to its places
  let lastLiteral = 0;
  for (let p = 1; p <= n; p++) {
    const k = kindAt(mask, p);
    if (k !== MaskKind.Literal && k !== MaskKind.IntlLiteral) continue;
    const place = places(mask, p);
    const lit = literal(mask[p - 1]!);
    let endPart = result.length + 1;
    for (let j = lastLiteral; j <= result.length - 1; j++) {
      if (result[j] === lit) {
        endPart = j + 1;
        break;
      }
    }
    if (endPart > result.length) result += lit;
    result = padPart(result, lastLiteral + 1, endPart, place - (lastLiteral + 1), fromRight);
    lastLiteral = place;
  }
  const total = places(mask, n);
  if (result.length !== total) result = padPart(result, lastLiteral + 1, result.length + 1, total - lastLiteral, fromRight);
  return result;
}

const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';

/**
 * IndyBase64.Decode: the base64 decoding of the Delphi engine (Indy's TIdDecoderMIME, line by
 * line): a character outside the alphabet counts as 63, an incomplete group of four at the end of
 * a line is left out, the '=' of the end removes one or two bytes, each byte is the character of
 * its code.
 */
export function indyBase64Decode(text: string): string {
  let result = '';
  for (const line of textLines(text)) {
    const input = new Uint8Array(line.length);
    for (let i = 0; i < line.length; i++) {
      const c = line.charCodeAt(i);
      input[i] = c <= 0xff ? c : 0x3f;
    }
    const value = (b: number): number => {
      const i = ALPHABET.indexOf(String.fromCharCode(b));
      return i >= 0 ? i : 0xff;
    };
    const limit = Math.floor(input.length / 4) * 4;
    const output: number[] = [];
    for (let i = 0; i < limit; i += 4) {
      const a = value(input[i]!);
      const b = value(input[i + 1]!);
      const c = value(input[i + 2]!);
      const d = value(input[i + 3]!);
      output.push((((a & 63) << 2) | ((b >> 4) & 3)) & 0xff);
      output.push((((b & 15) << 4) | ((c >> 2) & 15)) & 0xff);
      output.push((((c & 3) << 6) | (d & 63)) & 0xff);
    }
    if (limit > 0 && input[limit - 1] === 0x3d) output.length -= input[limit - 2] === 0x3d ? 2 : 1;
    for (const b of output) result += String.fromCharCode(b);
  }
  return result;
}

/**
 * UTF8Encoding.GetString: an invalid sequence becomes U+FFFD, one for each maximal invalid
 * subpart (the Unicode recommended practice of .NET Core and of TextDecoder). Written by hand:
 * the engine needs no TextDecoder.
 */
export function utf8Decode(bytes: Uint8Array): string {
  const units: number[] = [];
  let out = '';
  const n = bytes.length;
  let i = 0;
  const push = (cp: number): void => {
    if (cp >= 0x10000) {
      cp -= 0x10000;
      units.push(0xd800 | (cp >> 10), 0xdc00 | (cp & 0x3ff));
    } else units.push(cp);
    if (units.length > 8000) {
      out += String.fromCharCode(...units);
      units.length = 0;
    }
  };
  while (i < n) {
    const b0 = bytes[i]!;
    if (b0 < 0x80) {
      push(b0);
      i++;
      continue;
    }
    let need: number;
    let cp: number;
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
      push(0xfffd);
      i++;
      continue;
    }
    let j = i + 1;
    let ok = true;
    for (let k = 0; k < need; k++, j++) {
      const b = j < n ? bytes[j]! : -1;
      if (b < lower || b > upper) {
        ok = false;
        break;
      }
      lower = 0x80;
      upper = 0xbf;
      cp = (cp << 6) | (b & 0x3f);
    }
    push(ok ? cp : 0xfffd);
    i = j;
  }
  return out + String.fromCharCode(...units);
}

/** UnicodeEncoding.GetString (little or big endian): a lone last byte becomes U+FFFD. */
function utf16Decode(bytes: Uint8Array, bigEndian: boolean): string {
  let out = '';
  let i = 0;
  for (; i + 1 < bytes.length; i += 2) out += String.fromCharCode(bigEndian ? (bytes[i]! << 8) | bytes[i + 1]! : bytes[i]! | (bytes[i + 1]! << 8));
  if (i < bytes.length) out += '�';
  return out;
}

/** The text of an INI file's bytes: its byte order mark, or else ANSI. */
function iniFileText(bytes: Uint8Array): string {
  if (bytes.length >= 3 && bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) return utf8Decode(bytes.subarray(3));
  if (bytes.length >= 2 && bytes[0] === 0xff && bytes[1] === 0xfe) return utf16Decode(bytes.subarray(2), false);
  if (bytes.length >= 2 && bytes[0] === 0xfe && bytes[1] === 0xff) return utf16Decode(bytes.subarray(2), true);
  return ansiDecode(bytes);
}

const sameText = (a: string, b: string): boolean => toUpperNet(a) === toUpperNet(b);

/**
 * IniText.Read: ReadString of Delphi's TMemIniFile on the bytes of the file (undefined: there is
 * no file). Sections and names ignore the case, the first section and the first name of a repeated
 * one count, spaces around '=' are removed, lines starting with ';' are comments, a line without
 * '=' is a name without a value that ReadString does not find.
 */
export function iniReadString(bytes: Uint8Array | undefined, section: string, name: string, defaultValue: string): string {
  if (bytes === undefined) return defaultValue;
  const seen = new Set<string>();
  let inSection = false;
  for (const raw of textLines(iniFileText(bytes))) {
    const s = trimDelphi(raw);
    if (s.length === 0 || s[0] === ';') continue;
    if (s[0] === '[' && s[s.length - 1] === ']') {
      const sectionName = trimDelphi(s.substring(1, s.length - 1));
      const key = toUpperNet(sectionName);
      const first = !seen.has(key);
      seen.add(key);
      inSection = first && sameText(sectionName, section);
      continue;
    }
    if (!inSection) continue;
    const eq = s.indexOf('=');
    if (eq >= 0 && sameText(trimRightDelphi(s.substring(0, eq)), name)) return trimLeftDelphi(s.substring(eq + 1));
  }
  return defaultValue;
}
