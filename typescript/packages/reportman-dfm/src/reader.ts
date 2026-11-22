// The DFM forms of a component stream, as Delphi writes a report with TWriter (TRpBaseReport.
// SaveToStream): binary (TPF0, rpStreamBinary), text (ObjectBinaryToText, rpStreamText, the default
// of the designers) and the binary one compressed with zlib (rpStreamZLib). The three are read into
// the same tree: the root object, its properties with their typed values, and its child objects.
// An independent implementation of the format (the value types of TValueType, TReader.ReadString,
// and TParser and ObjectTextToBinary for the text form), checked against the files Delphi writes
// and against what Delphi reads from them: test/dfm.test.ts and test/reader.test.ts.

import { unzlibSync } from 'fflate';

/** A value of a property, with the type the stream gives it (TValueType). */
export type DfmValue =
  | { type: 'integer'; value: number } // vaInt8, vaInt16, vaInt32
  | { type: 'int64'; value: bigint } // vaInt64
  | { type: 'extended'; value: number } // vaExtended (an untyped float of the text form)
  | { type: 'single'; value: number } // vaSingle (1.5s)
  | { type: 'double'; value: number } // vaDouble
  | { type: 'currency'; value: number } // vaCurrency: the value (the stream keeps value * 10000)
  | { type: 'date'; value: number } // vaDate (45000.5d)
  | { type: 'string'; value: string } // vaString, vaLString, vaWString, vaUTF8String
  | { type: 'ident'; value: string } // vaIdent: an enumerated value, a component name
  | { type: 'boolean'; value: boolean } // vaFalse, vaTrue
  | { type: 'null' } // vaNull as a value: a Null variant
  | { type: 'nil' } // vaNil
  | { type: 'binary'; value: Uint8Array } // vaBinary: the data of DefineBinaryProperty
  | { type: 'set'; value: string[] } // vaSet
  | { type: 'list'; value: DfmValue[] } // vaList: TStrings.Strings, for example
  | { type: 'collection'; value: DfmItem[] }; // vaCollection

/** An item of a collection: its properties, and its order when the stream writes it. */
export interface DfmItem {
  index?: number;
  properties: DfmProperty[];
}

/** A property: its name as written (a path such as BidiModes.Strings) and its value. */
export interface DfmProperty {
  name: string;
  value: DfmValue;
}

/** An object of the stream: object, inherited or inline, with its properties and children. */
export interface DfmObject {
  className: string;
  /** Empty for an object saved without a name (the root report). */
  name: string;
  kind: 'object' | 'inherited' | 'inline';
  /** The child position of the stream ([n] in the text form), when written. */
  childPos?: number;
  properties: DfmProperty[];
  children: DfmObject[];
}

/** The form a report is stored in, as TRpBaseReport.LoadFromStream tells it. */
export type ReportForm = 'xml' | 'text' | 'binary' | 'zlib-xml' | 'zlib-binary';

/** A file that is not a DFM the reader understands, or a broken one. */
export class DfmError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'DfmError';
  }
}

const SIGNATURE = [0x54, 0x50, 0x46, 0x30]; // TPF0

function isSignature(bytes: Uint8Array, at = 0): boolean {
  return bytes.length >= at + 4 && SIGNATURE.every((b, i) => bytes[at + i] === b);
}

const NOT_A_REPORT =
  'Not a report Delphi reads (Invalid stream format): a report is XML (it starts with <), a text DFM ' +
  '(it starts with "object", with no BOM or blanks before it), a binary DFM (TPF0) or a binary DFM or XML ' +
  'compressed with zlib.';

/**
 * The form of a report file, as TRpBaseReport.LoadFromStream tells it by its first byte: 'x' zlib
 * (decompressed, '<' is XML and anything else binary), 'o' text, '<' XML, anything else binary,
 * which TReader checks by its signature. So Delphi does not read a text DFM with a BOM or blanks
 * before "object", nor a text DFM compressed with zlib, and neither does the converter.
 */
export function reportForm(bytes: Uint8Array): ReportForm {
  if (bytes.length === 0) throw new DfmError('The report is empty.');
  if (bytes[0] === 0x78) {
    const inner = inflate(bytes);
    if (inner[0] === 0x3c) return 'zlib-xml';
    if (!isSignature(inner)) throw new DfmError(NOT_A_REPORT);
    return 'zlib-binary';
  }
  if (bytes[0] === 0x6f) return 'text';
  if (bytes[0] === 0x3c) return 'xml';
  if (!isSignature(bytes)) throw new DfmError(NOT_A_REPORT);
  return 'binary';
}

function inflate(bytes: Uint8Array): Uint8Array {
  try {
    return unzlibSync(bytes);
  } catch (e) {
    throw new DfmError('The zlib stream of the report is broken: ' + (e instanceof Error ? e.message : String(e)));
  }
}

/** Whether a report file is in a DFM form Delphi reads (text, binary, or binary compressed). */
export function isDfm(bytes: Uint8Array): boolean {
  try {
    const form = reportForm(bytes);
    return form !== 'xml' && form !== 'zlib-xml';
  } catch {
    return false;
  }
}

/**
 * The tree of a DFM stream: binary (TPF0) or text, as TReader and ObjectTextToBinary read them, or
 * either one compressed with zlib. Any DFM, also the ones a report can not be (a text form with a
 * UTF-8 BOM, which TParser reads as UTF-8); dfmToXml takes only what reportForm accepts.
 */
export function readDfm(bytes: Uint8Array): DfmObject {
  let data = bytes;
  if (data.length > 0 && data[0] === 0x78) data = inflate(data);
  if (isSignature(data)) return new BinaryReader(data).readRoot();
  if (data[0] === 0x3c) throw new DfmError('The report is XML, not a DFM form.');
  const { text, utf8 } = textBytes(data);
  return new TextParser(text, utf8).readRoot();
}

// ---------------------------------------------------------------------------------------------
// Text encodings

// Windows-1252 from 0x80 to 0x9F (the rest of the bytes are the code points); the undefined
// bytes are kept as their C1 control code points, as Windows does
const CP1252_HIGH = [
  0x20ac, 0x81, 0x201a, 0x0192, 0x201e, 0x2026, 0x2020, 0x2021, 0x02c6, 0x2030, 0x0160, 0x2039, 0x0152, 0x8d, 0x017d, 0x8f,
  0x90, 0x2018, 0x2019, 0x201c, 0x201d, 0x2022, 0x2013, 0x2014, 0x02dc, 0x2122, 0x0161, 0x203a, 0x0153, 0x9d, 0x017e, 0x0178,
];

/** Bytes of the ANSI code page of the files of the corpus (Windows-1252). */
export function decodeAnsi(bytes: Uint8Array, start = 0, end = bytes.length): string {
  const units = new Array<string>(end - start);
  for (let i = start; i < end; i++) {
    const b = bytes[i]!;
    units[i - start] = String.fromCharCode(b >= 0x80 && b < 0xa0 ? CP1252_HIGH[b - 0x80]! : b);
  }
  return units.join('');
}

let utf8Decoder: { decode(input: Uint8Array): string } | undefined;

/**
 * UTF-8 bytes as TEncoding.UTF8.GetString reads them (vaUTF8String, and the strings of a text form
 * with a UTF-8 BOM): an invalid sequence (a stray byte, a truncated or overlong sequence, a
 * surrogate, a code point above U+10FFFF) is an error, which Delphi raises too and so does not
 * load the report; a U+FEFF stays.
 */
export function decodeUtf8Strict(bytes: Uint8Array, start = 0, end = bytes.length): string {
  utf8Decoder ??= new TextDecoder('utf-8', { fatal: true, ignoreBOM: true });
  try {
    return utf8Decoder.decode(bytes.subarray(start, end));
  } catch {
    throw new DfmError('A string of the DFM is not valid UTF-8 (Delphi cannot read it either: "No mapping for the Unicode character exists in the target multi-byte code page").');
  }
}

/**
 * What TWriter.WriteString and then TReader.ReadString make of a string: ObjectTextToBinary writes
 * every string of the text form with WriteString, which writes it in UTF-8 (vaUTF8String) when
 * that is shorter than UTF-16 and not ASCII, and there a lone surrogate becomes U+FFFD; otherwise
 * it is kept as it is (vaString of ASCII, vaWString).
 */
export function writeStringRoundTrip(s: string): string {
  let bytes = 0;
  let ascii = true;
  let lone = false;
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    if (c < 0x80) bytes += 1;
    else {
      ascii = false;
      if (c < 0x800) bytes += 2;
      else if (c >= 0xd800 && c < 0xdc00 && i + 1 < s.length && (s.charCodeAt(i + 1) & 0xfc00) === 0xdc00) {
        bytes += 4;
        i++;
      } else {
        bytes += 3;
        if (c >= 0xd800 && c < 0xe000) lone = true;
      }
    }
  }
  if (ascii || !lone || bytes >= s.length * 2) return s;
  let out = '';
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    if (c >= 0xd800 && c < 0xdc00 && i + 1 < s.length && (s.charCodeAt(i + 1) & 0xfc00) === 0xdc00) {
      out += s[i]! + s[i + 1]!;
      i++;
    } else out += c >= 0xd800 && c < 0xe000 ? '�' : s[i]!;
  }
  return out;
}

/** UTF-8 bytes, an invalid sequence as U+FFFD: the names of the binary form (UTF8IdentToString). */
export function decodeUtf8(bytes: Uint8Array, start = 0, end = bytes.length): string {
  let out = '';
  let i = start;
  while (i < end) {
    const b = bytes[i]!;
    let cp = 0xfffd;
    let n = 1;
    if (b < 0x80) cp = b;
    else if (b >= 0xc2 && b < 0xe0 && i + 1 < end && (bytes[i + 1]! & 0xc0) === 0x80) {
      cp = ((b & 0x1f) << 6) | (bytes[i + 1]! & 0x3f);
      n = 2;
    } else if (b >= 0xe0 && b < 0xf0 && i + 2 < end && (bytes[i + 1]! & 0xc0) === 0x80 && (bytes[i + 2]! & 0xc0) === 0x80) {
      cp = ((b & 0x0f) << 12) | ((bytes[i + 1]! & 0x3f) << 6) | (bytes[i + 2]! & 0x3f);
      n = 3;
    } else if (b >= 0xf0 && b < 0xf5 && i + 3 < end && (bytes[i + 1]! & 0xc0) === 0x80 && (bytes[i + 2]! & 0xc0) === 0x80 && (bytes[i + 3]! & 0xc0) === 0x80) {
      cp = ((b & 0x07) << 18) | ((bytes[i + 1]! & 0x3f) << 12) | ((bytes[i + 2]! & 0x3f) << 6) | (bytes[i + 3]! & 0x3f);
      n = 4;
    }
    out += String.fromCodePoint(cp);
    i += n;
  }
  return out;
}

/**
 * The text form as TParser reads it: its bytes, one character each (the grammar is ASCII), and
 * the encoding of the bytes of its strings: UTF-8 after a BOM, the ANSI code page otherwise.
 */
function textBytes(bytes: Uint8Array): { text: string; utf8: boolean } {
  const utf8 = bytes.length >= 3 && bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf;
  const start = utf8 ? 3 : 0;
  const chars = new Array<string>(bytes.length - start);
  for (let i = start; i < bytes.length; i++) chars[i - start] = String.fromCharCode(bytes[i]!);
  return { text: chars.join(''), utf8 };
}

// ---------------------------------------------------------------------------------------------
// Binary form (TBinaryObjectReader)

const VA = {
  Null: 0,
  List: 1,
  Int8: 2,
  Int16: 3,
  Int32: 4,
  Extended: 5,
  String: 6,
  Ident: 7,
  False: 8,
  True: 9,
  Binary: 10,
  Set: 11,
  LString: 12,
  Nil: 13,
  Collection: 14,
  Single: 15,
  Currency: 16,
  Date: 17,
  WString: 18,
  Int64: 19,
  UTF8String: 20,
  Double: 21,
} as const;

/** An 80-bit extended float (little endian) as the nearest double. */
export function extendedToDouble(bytes: Uint8Array, at: number): number {
  const view = new DataView(bytes.buffer, bytes.byteOffset + at, 10);
  const lo = view.getUint32(0, true);
  const hi = view.getUint32(4, true);
  const se = view.getUint16(8, true);
  const sign = se & 0x8000 ? -1 : 1;
  const exponent = se & 0x7fff;
  if (exponent === 0 && hi === 0 && lo === 0) return sign * 0;
  if (exponent === 0x7fff) return hi === 0x80000000 && lo === 0 ? sign * Infinity : NaN;
  // The 64 bits of the mantissa as one integer (rounded once to a double), times 2^(e - 16383 - 63)
  const mantissa = hi * 4294967296 + lo;
  return sign * mantissa * Math.pow(2, (exponent === 0 ? 1 : exponent) - 16383 - 63);
}

class BinaryReader {
  private pos = 0;
  private readonly view: DataView;

  constructor(private readonly bytes: Uint8Array) {
    this.view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  }

  private need(n: number): void {
    if (this.pos + n > this.bytes.length) throw new DfmError('The binary DFM ends too soon.');
  }

  private byte(): number {
    this.need(1);
    return this.bytes[this.pos++]!;
  }

  private peek(): number {
    this.need(1);
    return this.bytes[this.pos]!;
  }

  private int32(): number {
    this.need(4);
    const v = this.view.getInt32(this.pos, true);
    this.pos += 4;
    return v;
  }

  /** A ShortString (identifiers, names): UTF-8, which is ASCII in practice. */
  private shortString(): string {
    const n = this.byte();
    this.need(n);
    const s = decodeUtf8(this.bytes, this.pos, this.pos + n);
    this.pos += n;
    return s;
  }

  private integerValue(): number {
    const t = this.byte();
    const v = this.integerOf(t);
    if (v === undefined) throw new DfmError('An integer was expected in the binary DFM.');
    return v;
  }

  private integerOf(t: number): number | undefined {
    switch (t) {
      case VA.Int8:
        this.need(1);
        return this.view.getInt8(this.pos++);
      case VA.Int16: {
        this.need(2);
        const v = this.view.getInt16(this.pos, true);
        this.pos += 2;
        return v;
      }
      case VA.Int32:
        return this.int32();
      default:
        return undefined;
    }
  }

  readRoot(): DfmObject {
    this.pos = 4; // TPF0
    const root = this.readObject();
    return root;
  }

  private readObject(): DfmObject {
    let kind: DfmObject['kind'] = 'object';
    let childPos: number | undefined;
    // The filer flags (ffInherited 1, ffChildPos 2, ffInline 4) in a byte $F0 + flags
    if ((this.peek() & 0xf0) === 0xf0) {
      const flags = this.byte() & 0x0f;
      if (flags & 1) kind = 'inherited';
      else if (flags & 4) kind = 'inline';
      if (flags & 2) childPos = this.integerValue();
    }
    const className = this.shortString();
    const name = this.shortString();
    const properties = this.readProperties();
    const children: DfmObject[] = [];
    while (this.peek() !== VA.Null) children.push(this.readObject());
    this.pos++;
    return { className, name, kind, ...(childPos !== undefined ? { childPos } : {}), properties, children };
  }

  /** Properties until the end of the list (vaNull), which is consumed. */
  private readProperties(): DfmProperty[] {
    const properties: DfmProperty[] = [];
    while (this.peek() !== VA.Null) {
      const name = this.shortString();
      properties.push({ name, value: this.readValue() });
    }
    this.pos++;
    return properties;
  }

  private readValue(): DfmValue {
    const t = this.byte();
    const integer = this.integerOf(t);
    if (integer !== undefined) return { type: 'integer', value: integer };
    switch (t) {
      case VA.Null:
        return { type: 'null' };
      case VA.List: {
        const value: DfmValue[] = [];
        while (this.peek() !== VA.Null) value.push(this.readValue());
        this.pos++;
        return { type: 'list', value };
      }
      case VA.Extended: {
        this.need(10);
        const v = extendedToDouble(this.bytes, this.pos);
        this.pos += 10;
        return { type: 'extended', value: v };
      }
      case VA.Single: {
        this.need(4);
        const v = this.view.getFloat32(this.pos, true);
        this.pos += 4;
        return { type: 'single', value: v };
      }
      case VA.Double:
      case VA.Date: {
        this.need(8);
        const v = this.view.getFloat64(this.pos, true);
        this.pos += 8;
        return { type: t === VA.Date ? 'date' : 'double', value: v };
      }
      case VA.Currency: {
        this.need(8);
        const v = this.view.getBigInt64(this.pos, true);
        this.pos += 8;
        return { type: 'currency', value: Number(v) / 10000 };
      }
      case VA.Int64: {
        this.need(8);
        const v = this.view.getBigInt64(this.pos, true);
        this.pos += 8;
        return { type: 'int64', value: v };
      }
      case VA.String: {
        const n = this.byte();
        this.need(n);
        const s = decodeAnsi(this.bytes, this.pos, this.pos + n);
        this.pos += n;
        return { type: 'string', value: s };
      }
      case VA.LString:
      case VA.UTF8String: {
        const n = this.int32();
        this.need(n);
        const s = t === VA.UTF8String ? decodeUtf8Strict(this.bytes, this.pos, this.pos + n) : decodeAnsi(this.bytes, this.pos, this.pos + n);
        this.pos += n;
        return { type: 'string', value: s };
      }
      case VA.WString: {
        const n = this.int32();
        this.need(n * 2);
        let s = '';
        for (let i = 0; i < n; i++) s += String.fromCharCode(this.view.getUint16(this.pos + i * 2, true));
        this.pos += n * 2;
        return { type: 'string', value: s };
      }
      case VA.Ident: {
        const s = this.shortString();
        return { type: 'ident', value: s };
      }
      case VA.False:
        return { type: 'boolean', value: false };
      case VA.True:
        return { type: 'boolean', value: true };
      case VA.Nil:
        return { type: 'nil' };
      case VA.Binary: {
        const n = this.int32();
        this.need(n);
        const value = this.bytes.slice(this.pos, this.pos + n);
        this.pos += n;
        return { type: 'binary', value };
      }
      case VA.Set: {
        const value: string[] = [];
        for (;;) {
          const s = this.shortString();
          if (s.length === 0) break;
          value.push(s);
        }
        return { type: 'set', value };
      }
      case VA.Collection: {
        const value: DfmItem[] = [];
        while (this.peek() !== VA.Null) {
          let index: number | undefined;
          const next = this.peek();
          if (next === VA.Int8 || next === VA.Int16 || next === VA.Int32) index = this.integerValue();
          if (this.byte() !== VA.List) throw new DfmError('A collection item of the binary DFM does not start with a list.');
          value.push({ ...(index !== undefined ? { index } : {}), properties: this.readProperties() });
        }
        this.pos++;
        return { type: 'collection', value };
      }
      default:
        throw new DfmError(`Unknown value type ${t} in the binary DFM at byte ${this.pos - 1}.`);
    }
  }
}

// ---------------------------------------------------------------------------------------------
// Text form (the grammar of ObjectTextToBinary)

type Token =
  | { kind: 'symbol'; text: string }
  | { kind: 'string'; text: string }
  | { kind: 'integer'; value: bigint }
  | { kind: 'float'; value: number; suffix: '' | 's' | 'c' | 'd' }
  | { kind: 'char'; text: string }
  | { kind: 'eof' };

class TextParser {
  private pos = 0;
  private line = 1;
  private token: Token = { kind: 'eof' };

  /** The bytes of the text, one character each, and the encoding of the bytes of its strings. */
  constructor(
    private readonly text: string,
    private readonly utf8: boolean,
  ) {
    this.next();
  }

  private error(message: string): never {
    throw new DfmError(`${message} (line ${this.line} of the text DFM)`);
  }

  /** TParser.SkipBlanks: every byte from 1 to 32 is a blank; a zero byte ends the text. */
  private skipBlanks(): void {
    const t = this.text;
    while (this.pos < t.length) {
      const c = t.charCodeAt(this.pos);
      if (c === 0 || c > 32) break;
      if (c === 0x0a) this.line++;
      this.pos++;
    }
  }

  private next(): Token {
    this.skipBlanks();
    const t = this.text;
    if (this.pos >= t.length || t.charCodeAt(this.pos) === 0) return (this.token = { kind: 'eof' });
    const c = t[this.pos]!;
    if (/[A-Za-z_]/.test(c)) {
      const start = this.pos;
      while (this.pos < t.length && /[A-Za-z0-9_]/.test(t[this.pos]!)) this.pos++;
      return (this.token = { kind: 'symbol', text: t.substring(start, this.pos) });
    }
    if (c === "'" || c === '#') return (this.token = { kind: 'string', text: this.readString() });
    if (/[0-9$-]/.test(c)) return (this.token = this.readNumber());
    this.pos++;
    return (this.token = { kind: 'char', text: c });
  }

  /**
   * A string token: quoted parts ('' is a quote) and #code characters written together, as
   * TParser.NextToken reads it. A code is decimal or $hexadecimal, an Integer (32 bits, it wraps)
   * that is 0 without digits. With a code above 127 it is a wide string: each code is a UTF-16
   * code unit (its low 16 bits) and each byte inside the quotes the character of its value.
   * Otherwise the codes and the bytes are bytes, decoded with the encoding of the file
   * (TokenString: UTF-8 after a BOM, the ANSI code page otherwise).
   */
  private readString(): string {
    const t = this.text;
    const parts: { code: number; raw: boolean }[] = [];
    for (;;) {
      const c = t[this.pos];
      if (c === "'") {
        this.pos++;
        for (;;) {
          const d = t[this.pos];
          if (d === undefined || d === '\n' || d === '\r' || d === '\0') this.error('Unterminated string');
          if (d === "'") {
            if (t[this.pos + 1] === "'") {
              parts.push({ code: 0x27, raw: true });
              this.pos += 2;
              continue;
            }
            this.pos++;
            break;
          }
          parts.push({ code: d.charCodeAt(0), raw: true });
          this.pos++;
        }
      } else if (c === '#') {
        this.pos++;
        let code = 0;
        if (t[this.pos] === '$') {
          this.pos++;
          for (let d; this.pos < t.length && (d = Number.parseInt(t[this.pos]!, 16)) >= 0; this.pos++) code = ((code << 4) + d) | 0;
        } else {
          for (let d; this.pos < t.length && (d = t.charCodeAt(this.pos) - 48) >= 0 && d <= 9; this.pos++) code = (code * 10 + d) | 0;
        }
        parts.push({ code, raw: false });
      } else break;
    }
    if (parts.some((p) => !p.raw && p.code > 127)) return parts.map((p) => String.fromCharCode(p.code & 0xffff)).join('');
    const bytes = Uint8Array.from(parts, (p) => p.code & 0xff);
    return this.utf8 ? decodeUtf8Strict(bytes) : decodeAnsi(bytes);
  }

  /**
   * A number as TParser.NextToken scans it: $ and hexadecimal digits; or a minus or a digit, the
   * digits, and then any of 0-9 . e E + - make it a float, which a suffix may type (s Single,
   * c Currency, d Date, f Extended). TokenInt and TokenFloat then read it (StrToInt64, StrToFloat).
   */
  private readNumber(): Token {
    const t = this.text;
    const start = this.pos;
    if (t[this.pos] === '$') {
      this.pos++;
      while (this.pos < t.length && /[0-9A-Fa-f]/.test(t[this.pos]!)) this.pos++;
      const digits = t.substring(start + 1, this.pos);
      if (digits.length === 0) this.error("'$' is not a valid integer value");
      return { kind: 'integer', value: BigInt.asIntN(64, BigInt('0x' + digits)) };
    }
    this.pos++;
    while (this.pos < t.length && /[0-9]/.test(t[this.pos]!)) this.pos++;
    let isFloat = false;
    while (this.pos < t.length && /[0-9.eE+-]/.test(t[this.pos]!)) {
      this.pos++;
      isFloat = true;
    }
    const number = t.substring(start, this.pos);
    const s = t[this.pos];
    if (s !== undefined && /[cCdDsSfF]/.test(s)) {
      this.pos++;
      const suffix = s.toLowerCase();
      return { kind: 'float', value: this.float(number), suffix: suffix === 'f' ? '' : (suffix as 's' | 'c' | 'd') };
    }
    if (isFloat) return { kind: 'float', value: this.float(number), suffix: '' };
    if (!/^-?[0-9]+$/.test(number)) this.error(`'${number}' is not a valid integer value`);
    return { kind: 'integer', value: BigInt(number) };
  }

  /** StrToFloat with '.' as the decimal separator. */
  private float(text: string): number {
    const v = Number(text);
    if (Number.isNaN(v) || !/^-?(?:[0-9]+\.?[0-9]*|\.[0-9]+)(?:[eE][-+]?[0-9]+)?$/.test(text)) this.error(`'${text}' is not a valid floating point value`);
    return v;
  }

  private isSymbol(text: string): boolean {
    return this.token.kind === 'symbol' && this.token.text.toLowerCase() === text;
  }

  private isChar(c: string): boolean {
    return this.token.kind === 'char' && this.token.text === c;
  }

  private expectChar(c: string): void {
    if (!this.isChar(c)) this.error(`'${c}' expected`);
    this.next();
  }

  private symbol(): string {
    if (this.token.kind !== 'symbol') this.error('Identifier expected');
    const s = this.token.text;
    this.next();
    return s;
  }

  /** ObjectTextToBinary reads one token after the end of the root object and ignores the rest. */
  readRoot(): DfmObject {
    return this.readObject();
  }

  private readObject(): DfmObject {
    let kind: DfmObject['kind'];
    if (this.isSymbol('object')) kind = 'object';
    else if (this.isSymbol('inherited')) kind = 'inherited';
    else if (this.isSymbol('inline')) kind = 'inline';
    else this.error("'object' expected");
    this.next();
    let name = '';
    let className = this.symbol();
    if (this.isChar(':')) {
      this.next();
      name = className;
      className = this.symbol();
    }
    let childPos: number | undefined;
    if (this.isChar('[')) {
      this.next();
      if (this.token.kind !== 'integer') this.error('Integer expected');
      childPos = Number(this.token.value);
      this.next();
      this.expectChar(']');
    }
    const properties: DfmProperty[] = [];
    const children: DfmObject[] = [];
    while (!this.isSymbol('end')) {
      if (this.isSymbol('object') || this.isSymbol('inherited') || this.isSymbol('inline')) children.push(this.readObject());
      else properties.push(this.readProperty());
    }
    this.next();
    return { className, name, kind, ...(childPos !== undefined ? { childPos } : {}), properties, children };
  }

  private readProperty(): DfmProperty {
    let name = this.symbol();
    while (this.isChar('.')) {
      this.next();
      name += '.' + this.symbol();
    }
    this.expectChar('=');
    return { name, value: this.readValue() };
  }

  private readValue(): DfmValue {
    const tok = this.token;
    switch (tok.kind) {
      case 'integer': {
        this.next();
        const v = tok.value;
        if (v >= -2147483648n && v <= 2147483647n) return { type: 'integer', value: Number(v) };
        return { type: 'int64', value: v };
      }
      case 'float': {
        this.next();
        switch (tok.suffix) {
          case 's':
            return { type: 'single', value: Math.fround(tok.value) };
          // The Int64 of the currency (value * 10000), as Delphi writes it
          case 'c':
            return { type: 'currency', value: Math.round(tok.value) / 10000 };
          case 'd':
            return { type: 'date', value: tok.value };
          default:
            return { type: 'extended', value: tok.value };
        }
      }
      case 'string': {
        let s = tok.text;
        this.next();
        // Fragments joined with +
        while (this.isChar('+')) {
          this.next();
          const part = this.token;
          if (part.kind !== 'string') this.error('String expected');
          s += part.text;
          this.next();
        }
        // Written with TWriter.WriteString by ObjectTextToBinary, read back by TReader
        return { type: 'string', value: writeStringRoundTrip(s) };
      }
      case 'symbol': {
        this.next();
        const lower = tok.text.toLowerCase();
        if (lower === 'true') return { type: 'boolean', value: true };
        if (lower === 'false') return { type: 'boolean', value: false };
        if (lower === 'nil') return { type: 'nil' };
        if (lower === 'null') return { type: 'null' };
        // A component reference may be qualified (Owner.Name)
        let ident = tok.text;
        while (this.isChar('.')) {
          this.next();
          ident += '.' + this.symbol();
        }
        return { type: 'ident', value: ident };
      }
      case 'char':
        return this.readCharValue(tok.text);
      default:
        this.error('Property value expected');
    }
  }

  private readCharValue(c: string): DfmValue {
    if (c === '[') {
      this.next();
      const value: string[] = [];
      while (!this.isChar(']')) {
        value.push(this.symbol());
        if (this.isChar(',')) this.next();
        else if (!this.isChar(']')) this.error("',' or ']' expected");
      }
      this.next();
      return { type: 'set', value };
    }
    if (c === '(') {
      this.next();
      const value: DfmValue[] = [];
      while (!this.isChar(')')) value.push(this.readValue());
      this.next();
      return { type: 'list', value };
    }
    if (c === '<') {
      this.next();
      const value: DfmItem[] = [];
      while (!this.isChar('>')) {
        if (!this.isSymbol('item')) this.error("'item' expected");
        this.next();
        let index: number | undefined;
        if (this.isChar('[')) {
          this.next();
          if (this.token.kind !== 'integer') this.error('Integer expected');
          index = Number(this.token.value);
          this.next();
          this.expectChar(']');
        }
        const properties: DfmProperty[] = [];
        while (!this.isSymbol('end')) properties.push(this.readProperty());
        this.next();
        value.push({ ...(index !== undefined ? { index } : {}), properties });
      }
      this.next();
      return { type: 'collection', value };
    }
    if (c === '{') return this.readBinary();
    this.error('Property value expected');
  }

  /** {hex digits}, blanks and line breaks between them. */
  private readBinary(): DfmValue {
    const t = this.text;
    const end = t.indexOf('}', this.pos);
    if (end < 0) this.error("'}' expected");
    const hex = t.substring(this.pos, end).replace(/\s+/g, (m) => {
      this.line += (m.match(/\n/g) ?? []).length;
      return '';
    });
    if (hex.length % 2 !== 0 || /[^0-9A-Fa-f]/.test(hex)) this.error('Invalid binary value');
    const value = new Uint8Array(hex.length / 2);
    for (let i = 0; i < value.length; i++) value[i] = Number.parseInt(hex.substr(i * 2, 2), 16);
    this.pos = end + 1;
    this.next();
    return { type: 'binary', value };
  }
}
