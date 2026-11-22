// The writing primitives of rpxmlstream.pas: WritePropertyI, WritePropertyI64, WritePropertyD,
// WritePropertyBool, WritePropertyS, WritePropertyW and WritePropertyB, with the escaping of
// StringToRpString / WStringToRpString (every character that is not a letter, a digit or one of
// "_ .()=;:" as #code#, and a line break after each 41 characters of the escaped text) and the
// AnsiString conversion of WritePropertyS (Windows-1252 with its best fit). The result is ASCII.

import { WIN1252_PAIRS } from './win1252-table.js';

const CRLF = '\r\n';
/** C_MAXDATAWIDTH of rpxmlstream.pas. */
const MAX_DATA_WIDTH = 40;

let ansiTable: Uint8Array | null = null;

/** The Windows-1252 byte of a UTF-16 code unit, as AnsiString(UnicodeString) on Windows (best fit, else ?). */
function ansiByte(codeUnit: number): number {
  if (ansiTable === null) {
    const t = new Uint8Array(0x10000).fill(0x3f);
    for (let c = 0; c < 0x80; c++) t[c] = c;
    for (let i = 0; i < WIN1252_PAIRS.length; i += 2) t[WIN1252_PAIRS[i] as number] = WIN1252_PAIRS[i + 1] as number;
    ansiTable = t;
  }
  return ansiTable[codeUnit & 0xffff]!;
}

/** RpIsAlpha / RpIsAlphaW: the characters written as they are. */
function isPlain(code: number): boolean {
  return (
    (code >= 0x30 && code <= 0x39) ||
    (code >= 0x41 && code <= 0x5a) ||
    (code >= 0x61 && code <= 0x7a) ||
    code === 0x5f || // _
    code === 0x20 ||
    code === 0x2e || // .
    code === 0x28 || // (
    code === 0x29 || // )
    code === 0x3d || // =
    code === 0x3b || // ;
    code === 0x3a // :
  );
}

/** StringToRpString / WStringToRpString of a sequence of character codes. */
function escapeCodes(codes: ArrayLike<number>): string {
  const out: string[] = [];
  let width = 0;
  for (let i = 0; i < codes.length; i++) {
    const code = codes[i]!;
    if (isPlain(code)) {
      out.push(String.fromCharCode(code));
      width++;
    } else {
      const sub = '#' + code + '#';
      out.push(sub);
      width += sub.length;
    }
    if (width > MAX_DATA_WIDTH) {
      width = 0;
      out.push(CRLF);
    }
  }
  return out.join('');
}

/** The bytes of AnsiString(s): one byte per UTF-16 code unit (a surrogate pair gives ??). */
export function ansiBytes(s: string): Uint8Array {
  const out = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) out[i] = ansiByte(s.charCodeAt(i));
  return out;
}

/** StringToRpString(AnsiString(s)). */
export function rpString(s: string): string {
  return escapeCodes(ansiBytes(s));
}

/** WStringToRpString(s): the UTF-16 code units. */
export function rpWideString(s: string): string {
  const codes = new Array<number>(s.length);
  for (let i = 0; i < s.length; i++) codes[i] = s.charCodeAt(i);
  return escapeCodes(codes);
}

/**
 * FloatToStr of Delphi (ffGeneral, 15 significant digits) with '.' as the decimal separator
 * (RpDoubleToStr): fixed notation unless the decimal point is more than 15 digits to the right
 * of the first digit or the value is below 0.0001 (then 1E-5, 1.5E20).
 */
export function delphiFloatToStr(value: number): string {
  if (Number.isNaN(value)) return 'NAN';
  if (value === Infinity) return 'INF';
  if (value === -Infinity) return '-INF';
  if (value === 0) return '0';
  const negative = value < 0;
  const [mantissa, exp] = Math.abs(value).toExponential(14).split('e') as [string, string];
  const digits = mantissa.replace('.', '').replace(/0+$/, '');
  // The position of the decimal point after the first digit (FloatRec.Exponent)
  const point = Number.parseInt(exp, 10) + 1;
  let text: string;
  if (point > 15 || point < -3) {
    const e = point - 1;
    text = digits[0]! + (digits.length > 1 ? '.' + digits.substring(1) : '') + 'E' + (e < 0 ? '-' : '') + Math.abs(e);
  } else if (point <= 0) {
    text = '0.' + '0'.repeat(-point) + digits;
  } else if (digits.length <= point) {
    text = digits + '0'.repeat(point - digits.length);
  } else {
    text = digits.substring(0, point) + '.' + digits.substring(point);
  }
  return (negative ? '-' : '') + text;
}

/** The hexadecimal of bytes in upper case (BinToHex). */
function hex(bytes: Uint8Array): string {
  const out = new Array<string>(bytes.length);
  for (let i = 0; i < bytes.length; i++) out[i] = (bytes[i]! < 16 ? '0' : '') + bytes[i]!.toString(16).toUpperCase();
  return out.join('');
}

/** The XML text being written. */
export class XmlOut {
  private readonly parts: string[] = [];

  /** A line as it is (WriteStringToStream(text + CRLF)). */
  line(text: string): void {
    this.parts.push(text + CRLF);
  }

  /** WritePropertyI (and WritePropertyI64). */
  int(name: string, value: number | bigint): void {
    this.parts.push(`<${name} type="Integer">${value.toString()}</${name}>${CRLF}`);
  }

  /** WritePropertyD. */
  double(name: string, value: number): void {
    this.parts.push(`<${name} type="Double">${delphiFloatToStr(value)}</${name}>${CRLF}`);
  }

  /** WritePropertyBool. */
  bool(name: string, value: boolean): void {
    this.parts.push(`<${name} type="Boolean">${value ? 'True' : 'False'}</${name}>${CRLF}`);
  }

  /** WritePropertyS(name, AnsiString(value)). */
  str(name: string, value: string): void {
    this.parts.push(`<${name} type="String">${rpString(value)}</${name}>${CRLF}`);
  }

  /** WritePropertyW. */
  wide(name: string, value: string): void {
    this.parts.push(`<${name} type="WideString">${rpWideString(value)}</${name}>${CRLF}`);
  }

  /** WritePropertyB: the size and the hexadecimal of the bytes, escaped as a string. */
  binary(name: string, value: Uint8Array): void {
    this.parts.push(`<${name} type="Binary" size="${value.length}">${escapeCodes(new TextEncoder().encode(hex(value)))}</${name}>${CRLF}`);
  }

  /** The text written, which is ASCII. */
  text(): string {
    return this.parts.join('');
  }

  /** The bytes of the text. */
  bytes(): Uint8Array {
    const t = this.text();
    const out = new Uint8Array(t.length);
    for (let i = 0; i < t.length; i++) out[i] = t.charCodeAt(i);
    return out;
  }
}
