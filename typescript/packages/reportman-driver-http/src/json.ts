// The JSON of the Hub API as System.Text.Json reads and writes it in HttpAgentExecutor.
//
// Reading: JsonDocument.Parse with its default options (no comments, no trailing commas, a maximum depth
// of 64), its errors (JsonReaderException: the message, the line and the byte position in the line), and
// the JsonElement operations the executor uses (TryGetProperty, GetProperty, GetString, GetBoolean,
// EnumerateArray, ToString), with their InvalidOperationException and KeyNotFoundException. The raw text
// of numbers, objects and arrays is kept, as JsonElement keeps it: an Int64 or a Decimal is read from its
// digits, and the text of a cell that is not of the type of its column is the text the Hub wrote.
//
// Writing: JsonSerializer with JavaScriptEncoder.Default (Utf8JsonWriter): ASCII only, the HTML-sensitive
// characters escaped as ", &, ', +, <, >, `.

import { NetException } from '@reportman/engine';

export type JsonValueKind = 'Object' | 'Array' | 'String' | 'Number' | 'True' | 'False' | 'Null';

/** A value of a parsed document (JsonElement). */
export class JsonElement {
  readonly kind: JsonValueKind;
  private readonly source: string;
  private readonly start: number;
  private readonly end: number;
  /** The value of a string. */
  readonly text: string | undefined;
  /** The items of an array. */
  readonly items: readonly JsonElement[] | undefined;
  /** The properties of an object, in their order (a name may be repeated). */
  readonly properties: readonly (readonly [string, JsonElement])[] | undefined;

  constructor(
    kind: JsonValueKind,
    source: string,
    start: number,
    end: number,
    extra: { text?: string; items?: JsonElement[]; properties?: [string, JsonElement][] } = {},
  ) {
    this.kind = kind;
    this.source = source;
    this.start = start;
    this.end = end;
    this.text = extra.text;
    this.items = extra.items;
    this.properties = extra.properties;
  }

  /** GetRawText: the value as written in the document. */
  get raw(): string {
    return this.source.substring(this.start, this.end);
  }
}

/** System.Text.Json.JsonReaderException. */
export class JsonReaderException extends NetException {
  readonly lineNumber: number;
  readonly bytePositionInLine: number;

  constructor(message: string, lineNumber: number, bytePositionInLine: number) {
    super('JsonReaderException', `${message} LineNumber: ${lineNumber} | BytePositionInLine: ${bytePositionInLine}.`);
    this.lineNumber = lineNumber;
    this.bytePositionInLine = bytePositionInLine;
  }
}

/** The InvalidOperationException of a JsonElement of another kind than the operation needs. */
export function wrongKind(expected: string, actual: JsonValueKind): NetException {
  return new NetException(
    'InvalidOperationException',
    `The requested operation requires an element of type '${expected}', but the target element has type '${actual}'.`,
  );
}

/** JsonElement.TryGetProperty: the last property of that name (the name is case sensitive). */
export function tryGetProperty(element: JsonElement, name: string): JsonElement | undefined {
  if (element.kind !== 'Object') throw wrongKind('Object', element.kind);
  const props = element.properties!;
  for (let i = props.length - 1; i >= 0; i--) if (props[i]![0] === name) return props[i]![1];
  return undefined;
}

/** JsonElement.GetProperty: KeyNotFoundException when it is not there. */
export function getProperty(element: JsonElement, name: string): JsonElement {
  const value = tryGetProperty(element, name);
  if (value === undefined) throw new NetException('KeyNotFoundException', 'The given key was not present in the dictionary.');
  return value;
}

/** JsonElement.GetString: null for a JSON null. */
export function getString(element: JsonElement): string | null {
  if (element.kind === 'Null') return null;
  if (element.kind !== 'String') throw wrongKind('String', element.kind);
  return element.text!;
}

/** JsonElement.GetBoolean. */
export function getBoolean(element: JsonElement): boolean {
  if (element.kind === 'True') return true;
  if (element.kind === 'False') return false;
  throw wrongKind('Boolean', element.kind);
}

/** JsonElement.EnumerateArray. */
export function enumerateArray(element: JsonElement): readonly JsonElement[] {
  if (element.kind !== 'Array') throw wrongKind('Array', element.kind);
  return element.items!;
}

/** JsonElement.ToString(): a string's value, "True"/"False", "" for null, the raw text of the rest. */
export function elementToString(element: JsonElement): string {
  switch (element.kind) {
    case 'String':
      return element.text!;
    case 'True':
      return 'True';
    case 'False':
      return 'False';
    case 'Null':
      return '';
    default:
      return element.raw;
  }
}

/** A plain JavaScript value of an element (numbers as numbers, or as their text beyond 2^53). */
export function toPlain(element: JsonElement): unknown {
  switch (element.kind) {
    case 'Object': {
      const o: Record<string, unknown> = {};
      for (const [k, v] of element.properties!) o[k] = toPlain(v);
      return o;
    }
    case 'Array':
      return element.items!.map(toPlain);
    case 'String':
      return element.text;
    case 'Number': {
      const n = Number(element.raw);
      return Number.isInteger(n) && !Number.isSafeInteger(n) && /^-?\d+$/.test(element.raw) ? element.raw : n;
    }
    case 'True':
      return true;
    case 'False':
      return false;
    case 'Null':
      return null;
  }
}

// ---------------------------------------------------------------------------------------------
// The reader (Utf8JsonReader as JsonDocument drives it)

const MESSAGES = {
  noTokens: 'The input does not contain any JSON tokens. Expected the input to start with a valid JSON token, when isFinalBlock is true.',
  zeroDepth: 'Expected depth to be zero at the end of the JSON payload. There is an open JSON object or array that should be closed.',
  endOfString: 'Expected end of string, but instead reached end of data.',
  valueEnd: 'Expected a value, but instead reached end of data.',
  digitEnd: "Expected a digit ('0'-'9'), but instead reached end of data.",
};

function isDigit(c: string): boolean {
  return c >= '0' && c <= '9';
}

function isWhite(c: string): boolean {
  return c === ' ' || c === '\t' || c === '\r' || c === '\n';
}

/** A delimiter after a number. */
function isDelimiter(c: string): boolean {
  return c === ',' || c === '}' || c === ']' || c === '/' || isWhite(c);
}

/** The first UTF-8 byte of the character at `index`. */
function firstByte(s: string, index: number): number {
  const cp = s.codePointAt(index)!;
  if (cp < 0x80) return cp;
  if (cp < 0x800) return 0xc0 | (cp >> 6);
  if (cp < 0x10000) return 0xe0 | (cp >> 12);
  return 0xf0 | (cp >> 18);
}

/** ThrowHelper.GetPrintableString of a byte: the character, or its hex code. */
function printable(s: string, index: number): string {
  const b = firstByte(s, index);
  if (b >= 0x20 && b < 0x7f) return String.fromCharCode(b);
  return '0x' + b.toString(16).toUpperCase().padStart(2, '0');
}

/** The UTF-8 length of the character at `index` (a surrogate pair is 4 bytes, its low half 0). */
function utf8Length(s: string, index: number): number {
  const c = s.charCodeAt(index);
  if (c < 0x80) return 1;
  if (c < 0x800) return 2;
  if (c >= 0xd800 && c <= 0xdbff) {
    const d = s.charCodeAt(index + 1);
    if (d >= 0xdc00 && d <= 0xdfff) return 4;
  }
  if (c >= 0xdc00 && c <= 0xdfff) {
    const p = s.charCodeAt(index - 1);
    if (index > 0 && p >= 0xd800 && p <= 0xdbff) return 0;
  }
  return 3;
}

class Reader {
  private i = 0;
  private depth = 0;
  private readonly s: string;
  private readonly maxDepth: number;

  constructor(s: string, maxDepth: number) {
    this.s = s;
    this.maxDepth = maxDepth;
  }

  private fail(message: string, at: number): never {
    let line = 0;
    let pos = 0;
    for (let k = 0; k < at && k < this.s.length; k++) {
      if (this.s.charAt(k) === '\n') {
        line++;
        pos = 0;
      } else pos += utf8Length(this.s, k);
    }
    throw new JsonReaderException(message, line, pos);
  }

  private white(): void {
    while (this.i < this.s.length && isWhite(this.s.charAt(this.i))) this.i++;
  }

  private get eof(): boolean {
    return this.i >= this.s.length;
  }

  document(): JsonElement {
    this.white();
    if (this.eof) this.fail(MESSAGES.noTokens, this.i);
    const value = this.value();
    this.white();
    if (!this.eof) this.fail(`'${printable(this.s, this.i)}' is invalid after a single JSON value. Expected end of data.`, this.i);
    return value;
  }

  private value(): JsonElement {
    const c = this.s.charAt(this.i);
    if (c === '{') return this.object();
    if (c === '[') return this.array();
    if (c === '"') {
      const start = this.i;
      const text = this.string();
      return new JsonElement('String', this.s, start, this.i, { text });
    }
    if (c === '-' || isDigit(c)) return this.number();
    if (c === 't') return this.literal('true', 'True');
    if (c === 'f') return this.literal('false', 'False');
    if (c === 'n') return this.literal('null', 'Null');
    return this.fail(`'${printable(this.s, this.i)}' is an invalid start of a value.`, this.i);
  }

  private open(kind: 'object' | 'array'): void {
    if (this.depth >= this.maxDepth)
      this.fail(`The maximum configured depth of ${this.maxDepth} has been exceeded. Cannot read next JSON ${kind}.`, this.i);
    this.depth++;
    this.i++;
  }

  /** After a value in a container: the separator, the end, or an error. */
  private afterValue(close: '}' | ']'): 'next' | 'end' {
    this.white();
    if (this.eof) this.fail(MESSAGES.zeroDepth, this.i);
    const c = this.s.charAt(this.i);
    if (c === ',') {
      this.i++;
      return 'next';
    }
    if (c === close) {
      this.i++;
      this.depth--;
      return 'end';
    }
    if (c === '}' || c === ']') this.fail(`'${c}' is invalid without a matching open.`, this.i);
    return this.fail(`'${printable(this.s, this.i)}' is invalid after a value. Expected either ',', '}', or ']'.`, this.i);
  }

  private array(): JsonElement {
    const start = this.i;
    this.open('array');
    const items: JsonElement[] = [];
    this.white();
    if (this.eof) this.fail(MESSAGES.zeroDepth, this.i);
    if (this.s.charAt(this.i) === ']') {
      this.i++;
      this.depth--;
      return new JsonElement('Array', this.s, start, this.i, { items });
    }
    if (this.s.charAt(this.i) === '}') this.fail("'}' is invalid without a matching open.", this.i);
    for (;;) {
      items.push(this.value());
      if (this.afterValue(']') === 'end') break;
      this.white();
      if (this.eof) this.fail(MESSAGES.zeroDepth, this.i);
      const c = this.s.charAt(this.i);
      if (c === ']')
        this.fail('The JSON array contains a trailing comma at the end which is not supported in this mode. Change the reader options.', this.i);
    }
    return new JsonElement('Array', this.s, start, this.i, { items });
  }

  private propertyName(): string {
    const c = this.s.charAt(this.i);
    if (c !== '"') this.fail(`'${printable(this.s, this.i)}' is an invalid start of a property name. Expected a '"'.`, this.i);
    return this.string();
  }

  private object(): JsonElement {
    const start = this.i;
    this.open('object');
    const properties: [string, JsonElement][] = [];
    this.white();
    if (this.eof) this.fail(MESSAGES.zeroDepth, this.i);
    if (this.s.charAt(this.i) === '}') {
      this.i++;
      this.depth--;
      return new JsonElement('Object', this.s, start, this.i, { properties });
    }
    if (this.s.charAt(this.i) === ']') this.fail("']' is invalid without a matching open.", this.i);
    for (;;) {
      const name = this.propertyName();
      this.white();
      if (this.eof) this.fail(MESSAGES.valueEnd, this.i);
      if (this.s.charAt(this.i) !== ':')
        this.fail(`'${printable(this.s, this.i)}' is invalid after a property name. Expected a ':'.`, this.i);
      this.i++;
      this.white();
      if (this.eof) this.fail(MESSAGES.valueEnd, this.i);
      properties.push([name, this.value()]);
      if (this.afterValue('}') === 'end') break;
      this.white();
      if (this.eof) this.fail(MESSAGES.zeroDepth, this.i);
      if (this.s.charAt(this.i) === '}')
        this.fail('The JSON object contains a trailing comma at the end which is not supported in this mode. Change the reader options.', this.i);
    }
    return new JsonElement('Object', this.s, start, this.i, { properties });
  }

  /** A string literal at the opening quote: its value (escapes resolved). */
  private string(): string {
    const s = this.s;
    let j = this.i + 1;
    let out = '';
    for (;;) {
      if (j >= s.length) this.fail(MESSAGES.endOfString, s.length);
      const c = s.charAt(j);
      if (c === '"') break;
      if (c === '\\') {
        j++;
        if (j >= s.length) this.fail(MESSAGES.endOfString, s.length);
        const e = s.charAt(j);
        switch (e) {
          case '"':
          case '\\':
          case '/':
            out += e;
            break;
          case 'b':
            out += '\b';
            break;
          case 'f':
            out += '\f';
            break;
          case 'n':
            out += '\n';
            break;
          case 'r':
            out += '\r';
            break;
          case 't':
            out += '\t';
            break;
          case 'u': {
            let code = 0;
            for (let k = 1; k <= 4; k++) {
              if (j + k >= s.length) this.fail(MESSAGES.endOfString, s.length);
              const h = s.charAt(j + k);
              const v = parseInt(h, 16);
              if (!/[0-9A-Fa-f]/.test(h))
                this.fail(`'${printable(s, j + k)}' is not a hex digit following '\\u' within a JSON string. The string should be correctly escaped.`, j + k);
              code = code * 16 + v;
            }
            out += String.fromCharCode(code);
            j += 4;
            break;
          }
          default:
            this.fail(`'${printable(s, j)}' is an invalid escapable character within a JSON string. The string should be correctly escaped.`, j);
        }
        j++;
        continue;
      }
      if (c.charCodeAt(0) < 0x20) this.fail(`'${printable(s, j)}' is invalid within a JSON string. The string should be correctly escaped.`, j);
      out += c;
      j++;
    }
    this.i = j + 1;
    return out;
  }

  private digits(j: number): number {
    while (j < this.s.length && isDigit(this.s.charAt(j))) j++;
    return j;
  }

  private number(): JsonElement {
    const s = this.s;
    const start = this.i;
    let j = this.i;
    const afterSign = (at: number): never =>
      this.fail(`'${printable(s, at)}' is invalid within a number, immediately after a sign character ('+' or '-'). Expected a digit ('0'-'9').`, at);
    if (s.charAt(j) === '-') {
      j++;
      if (j >= s.length) this.fail(MESSAGES.digitEnd, j);
      if (!isDigit(s.charAt(j))) afterSign(j);
    }
    if (s.charAt(j) === '0') {
      j++;
      if (j < s.length && isDigit(s.charAt(j))) this.fail(`Invalid leading zero before '${s.charAt(j)}'.`, j);
    } else j = this.digits(j);
    if (j < s.length && s.charAt(j) === '.') {
      j++;
      if (j >= s.length) this.fail(MESSAGES.digitEnd, j);
      if (!isDigit(s.charAt(j)))
        this.fail(`'${printable(s, j)}' is invalid within a number, immediately after a decimal point ('.'). Expected a digit ('0'-'9').`, j);
      j = this.digits(j);
    }
    if (j < s.length && (s.charAt(j) === 'e' || s.charAt(j) === 'E')) {
      j++;
      if (j >= s.length) this.fail(MESSAGES.digitEnd, j);
      if (s.charAt(j) === '+' || s.charAt(j) === '-') {
        j++;
        if (j >= s.length) this.fail(MESSAGES.digitEnd, j);
      }
      if (!isDigit(s.charAt(j))) afterSign(j);
      j = this.digits(j);
    }
    if (j < s.length && !isDelimiter(s.charAt(j)))
      this.fail(`'${printable(s, j)}' is an invalid end of a number. Expected a delimiter.`, j);
    this.i = j;
    return new JsonElement('Number', s, start, j);
  }

  private literal(word: string, kind: JsonValueKind): JsonElement {
    const s = this.s;
    const start = this.i;
    for (let k = 1; k < word.length; k++) {
      if (start + k >= s.length || s.charAt(start + k) !== word.charAt(k))
        this.fail(`'${s.substring(start)}' is an invalid JSON literal. Expected the literal '${word}'.`, start + k);
    }
    this.i = start + word.length;
    return new JsonElement(kind, s, start, this.i);
  }
}

/** JsonDocument.Parse(text): the root element, or the JsonReaderException of the text. */
export function parseJson(text: string, maxDepth = 64): JsonElement {
  return new Reader(text, maxDepth).document();
}

// ---------------------------------------------------------------------------------------------
// The writer

function hex4(code: number): string {
  return code.toString(16).toUpperCase().padStart(4, '0');
}

/** A JSON string as Utf8JsonWriter writes it with JavaScriptEncoder.Default. */
export function jsonString(value: string): string {
  let out = '"';
  for (let i = 0; i < value.length; i++) {
    const c = value.charCodeAt(i);
    if (c >= 0x20 && c < 0x7f) {
      switch (c) {
        case 0x22: // "
        case 0x26: // &
        case 0x27: // '
        case 0x2b: // +
        case 0x3c: // <
        case 0x3e: // >
        case 0x60: // `
          out += '\\u' + hex4(c);
          break;
        case 0x5c:
          out += '\\\\';
          break;
        default:
          out += value.charAt(i);
      }
      continue;
    }
    switch (c) {
      case 0x0a:
        out += '\\n';
        continue;
      case 0x0d:
        out += '\\r';
        continue;
      case 0x09:
        out += '\\t';
        continue;
      case 0x08:
        out += '\\b';
        continue;
      case 0x0c:
        out += '\\f';
        continue;
    }
    if (c >= 0xd800 && c <= 0xdbff) {
      const d = value.charCodeAt(i + 1);
      if (d >= 0xdc00 && d <= 0xdfff) {
        out += '\\u' + hex4(c) + '\\u' + hex4(d);
        i++;
        continue;
      }
      out += '\\uFFFD';
      continue;
    }
    if (c >= 0xdc00 && c <= 0xdfff) {
      out += '\\uFFFD';
      continue;
    }
    out += '\\u' + hex4(c);
  }
  return out + '"';
}
