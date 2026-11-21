// The values of a result as Npgsql gives them to the C# engine, read from PostgreSQL's text
// format. Each column gets the .NET type of the DataTable column C# fills (DataColumnType) and its
// values the object Variant.AssignFromObject turns into a Variant: integers, decimals (with their
// scale), doubles, strings, byte arrays and dates; DateOnly, TimeOnly and DateTimeOffset become
// DateTime as AssignFromObject converts them; the types the engine has no slot for (TimeSpan,
// Guid, IPAddress, ranges, arrays...) are the text AssignFromObject prints for them
// (Convert.ToString). The values Npgsql cannot read fail with Npgsql's exception.

import {
  CsDecimal,
  CultureInfo,
  DateTimeKind,
  RpDateTime,
  formatDateTime,
  formatDecimal,
  formatDouble,
  type DataColumnType,
  type DataValue,
} from 'reportman-engine';
import { argumentException, argumentOutOfRange, invalidCast, overflow } from './errors.js';
import type { PgType, TypeCatalog, ValueKind } from './types.js';

const TICKS_PER_SECOND = 10_000_000n;
const TICKS_PER_DAY = 864_000_000_000n;
const MAX_TICKS = 3_155_378_975_999_999_999n;
const TWO96 = 1n << 96n;

/**
 * The .NET type of the values that became DateTime here but are another type in C#: a parameter
 * that takes one of them (a detail parameter from a master column) is bound as that type.
 */
export const clrTypeOfValue = new WeakMap<object, string>();

function mark<T extends object>(value: T, clr: string): T {
  clrTypeOfValue.set(value, clr);
  return value;
}

/** What reading a column needs besides the text. */
export interface ReadContext {
  catalog: TypeCatalog;
  /** The culture of the text of ranges (NpgsqlRange.ToString uses the current culture). */
  culture: CultureInfo;
  /** OIDs of the regtype values of the result (their text is the type name). */
  regtypes: ReadonlyMap<string, bigint>;
}

/** How the values of a column are read. */
export interface ColumnReader {
  readonly type: DataColumnType;
  /** A value from its text (never called for NULL). */
  read(text: string): DataValue;
}

// ---------------------------------------------------------------------------------------------
// Numbers

const DECIMAL_SCALE = 'Numeric value does not fit in a System.Decimal';

/** A numeric's text as a System.Decimal (NumericConverter). */
export function readNumeric(text: string): CsDecimal {
  if (text === 'NaN') throw invalidCast('Numeric NaN not supported by System.Decimal');
  if (text === 'Infinity' || text === '-Infinity') throw overflow(DECIMAL_SCALE);
  const m = /^(-?)(\d+)(?:\.(\d*))?$/.exec(text);
  if (m === null) throw invalidCast('Invalid numeric text: ' + text);
  const frac = m[3] ?? '';
  if (frac.length > 28) throw overflow(DECIMAL_SCALE);
  const mag = BigInt(m[2]! + frac);
  if (mag >= TWO96) throw overflow('Value was either too large or too small for a Decimal.');
  return CsDecimal.fromParts(mag, frac.length, m[1] === '-');
}

/** money: its int64 (the digits of the text, whatever lc_monetary prints) in hundredths. */
function readMoney(text: string): CsDecimal {
  const digits = text.replace(/[^0-9]/g, '');
  const negative = text.includes('-') || text.includes('(');
  return CsDecimal.fromParts(BigInt(digits.length === 0 ? '0' : digits), 2, negative);
}

function readFloat(text: string): number {
  return Number(text);
}

const INVARIANT = CultureInfo.invariant;

/** double.ToString() under a culture. */
function doubleText(value: number, culture: CultureInfo = INVARIANT): string {
  return formatDouble(value, '', culture.number);
}

/** The numbers of a geometric value printed as .NET prints doubles (1E+20, not 1e+20). */
function reformatNumbers(text: string): string {
  return text.replace(/-?(?:Infinity|NaN|\d+(?:\.\d+)?(?:e[+-]?\d+)?)/g, (n) => doubleText(Number(n)));
}

// ---------------------------------------------------------------------------------------------
// Dates and times

const OUT_OF_RANGE_DATETIME = 'Out of range of DateTime (year must be between 1 and 9999).';

/** Ticks of a civil date and time, or undefined when the year is out of DateTime's range. */
function civilTicks(year: number, month: number, day: number, hour: number, minute: number, second: number, micro: number): bigint | undefined {
  if (year < 1 || year > 9999) return undefined;
  return RpDateTime.create(year, month, day, hour, minute, second).ticks + BigInt(micro) * 10n;
}

function micros(fraction: string | undefined): number {
  return fraction === undefined ? 0 : Number(fraction.padEnd(6, '0').substring(0, 6));
}

/** A time zone offset ("+02", "-05:30", "+00:09:21") in seconds. */
function offsetSeconds(text: string): number {
  const m = /^([+-])(\d{2})(?::(\d{2}))?(?::(\d{2}))?$/.exec(text);
  if (m === null) throw invalidCast('Invalid time zone offset: ' + text);
  const s = Number(m[2]) * 3600 + Number(m[3] ?? '0') * 60 + Number(m[4] ?? '0');
  return m[1] === '-' ? -s : s;
}

const TIMESTAMP_RE = /^(\d{4,})-(\d{2})-(\d{2}) (\d{2}):(\d{2}):(\d{2})(?:\.(\d+))?([+-]\d{2}(?::\d{2}){0,2})?( BC)?$/;

/** timestamp: DateTime (Unspecified); infinity and -infinity are MaxValue and MinValue. */
function readTimestamp(text: string): RpDateTime {
  if (text === 'infinity') return RpDateTime.fromTicks(MAX_TICKS);
  if (text === '-infinity') return RpDateTime.minValue;
  const m = TIMESTAMP_RE.exec(text);
  if (m === null) throw invalidCast('Invalid timestamp text: ' + text);
  const ticks = m[9] !== undefined ? undefined : civilTicks(+m[1]!, +m[2]!, +m[3]!, +m[4]!, +m[5]!, +m[6]!, micros(m[7]));
  if (ticks === undefined) throw invalidCast(OUT_OF_RANGE_DATETIME);
  return RpDateTime.fromTicks(ticks);
}

/** timestamptz: DateTime (Utc), whatever the session time zone printed it with. */
function readTimestampTz(text: string): RpDateTime {
  if (text === 'infinity') return RpDateTime.fromTicks(MAX_TICKS);
  if (text === '-infinity') return RpDateTime.minValue;
  const m = TIMESTAMP_RE.exec(text);
  if (m === null || m[8] === undefined) throw invalidCast('Invalid timestamptz text: ' + text);
  const year = m[9] !== undefined ? 1 - Number(m[1]) : Number(m[1]);
  // The civil time may be out of range while the instant is not (10000-01-01 00:30+01)
  const local = proleptic(year, +m[2]!, +m[3]!) * TICKS_PER_DAY + BigInt(((+m[4]! * 60 + +m[5]!) * 60 + +m[6]!)) * TICKS_PER_SECOND + BigInt(micros(m[7])) * 10n;
  const utc = local - BigInt(offsetSeconds(m[8])) * TICKS_PER_SECOND;
  if (utc < 0n || utc > MAX_TICKS) throw invalidCast(OUT_OF_RANGE_DATETIME);
  return RpDateTime.fromTicks(utc, DateTimeKind.Utc);
}

/** Days from 0001-01-01 of a proleptic Gregorian date (year 0 is 1 BC). */
function proleptic(year: number, month: number, day: number): bigint {
  const y = BigInt(month <= 2 ? year - 1 : year);
  const m = BigInt(month <= 2 ? month + 12 : month);
  const floorDiv = (a: bigint, b: bigint): bigint => (a >= 0n ? a / b : -((-a + b - 1n) / b));
  // Days since 0000-03-01, then shifted to 0001-01-01
  const days = 365n * y + floorDiv(y, 4n) - floorDiv(y, 100n) + floorDiv(y, 400n) + (153n * (m - 3n) + 2n) / 5n + BigInt(day) - 1n;
  return days - 306n;
}

/** date: DateOnly, a DateTime at midnight for the engine. */
function readDate(text: string): RpDateTime {
  if (text === 'infinity') return mark(RpDateTime.create(9999, 12, 31), 'System.DateOnly');
  if (text === '-infinity') return mark(RpDateTime.fromTicks(0n), 'System.DateOnly');
  const m = /^(\d{4,})-(\d{2})-(\d{2})( BC)?$/.exec(text);
  if (m === null) throw invalidCast('Invalid date text: ' + text);
  const year = Number(m[1]);
  if (m[4] !== undefined || year > 9999) throw argumentOutOfRange("Value to add was out of range. (Parameter 'value')");
  return mark(RpDateTime.create(year, +m[2]!, +m[3]!), 'System.DateOnly');
}

/** Ticks of a time of day ("13:45:30.123456", up to 24:00:00). */
function timeTicks(text: string): bigint {
  const m = /^(\d{2}):(\d{2}):(\d{2})(?:\.(\d+))?$/.exec(text);
  if (m === null) throw invalidCast('Invalid time text: ' + text);
  return BigInt((+m[1]! * 60 + +m[2]!) * 60 + +m[3]!) * TICKS_PER_SECOND + BigInt(micros(m[4])) * 10n;
}

/** time: TimeOnly, DateTime.MinValue plus the time for the engine. */
function readTime(text: string): RpDateTime {
  const ticks = timeTicks(text);
  if (ticks >= TICKS_PER_DAY)
    throw argumentOutOfRange("Ticks must be between 0 and and TimeOnly.MaxValue.Ticks. (Parameter 'ticks')");
  return mark(RpDateTime.fromTicks(ticks), 'System.TimeOnly');
}

/**
 * timetz: a DateTimeOffset on 0001-01-02; the engine takes its LocalDateTime (the time zone of
 * this process).
 */
function readTimeTz(text: string): RpDateTime {
  const m = /^(\d{2}:\d{2}:\d{2}(?:\.\d+)?)([+-].+)$/.exec(text);
  if (m === null) throw invalidCast('Invalid timetz text: ' + text);
  const offset = offsetSeconds(m[2]!);
  if (offset % 60 !== 0) throw argumentException("Offset must be specified in whole minutes. (Parameter 'offset')");
  if (Math.abs(offset) > 14 * 3600) throw argumentOutOfRange("Offset must be within plus or minus 14 hours. (Parameter 'offset')");
  const utc = TICKS_PER_DAY + timeTicks(m[1]!) - BigInt(offset) * TICKS_PER_SECOND;
  return mark(localDateTime(utc), 'System.DateTimeOffset');
}

/**
 * The standard offset of the local time zone (minutes east of UTC): what .NET applies to a date of
 * year 1, before any adjustment rule of the zone (TimeZoneInfo.BaseUtcOffset), where the time zone
 * database of JavaScript would give the local mean time of the 19th century.
 */
function baseUtcOffsetMinutes(): number {
  const year = new Date().getFullYear();
  const jan = -new Date(year, 0, 1).getTimezoneOffset();
  const jul = -new Date(year, 6, 1).getTimezoneOffset();
  return Math.min(jan, jul);
}

/** DateTimeOffset.LocalDateTime of an instant of 0001-01-02 (UTC ticks): the base offset of the zone. */
function localDateTime(utcTicks: bigint): RpDateTime {
  return RpDateTime.fromTicks(utcTicks + BigInt(baseUtcOffsetMinutes()) * 600_000_000n, DateTimeKind.Local);
}

/** TimeSpan.ToString() ("c"): [-][d.]hh:mm:ss[.fffffff]. */
export function timeSpanText(ticks: bigint): string {
  const negative = ticks < 0n;
  let t = negative ? -ticks : ticks;
  const days = t / TICKS_PER_DAY;
  t %= TICKS_PER_DAY;
  const p2 = (n: bigint): string => String(n).padStart(2, '0');
  const h = t / 36_000_000_000n;
  t %= 36_000_000_000n;
  const mi = t / 600_000_000n;
  t %= 600_000_000n;
  const s = t / TICKS_PER_SECOND;
  const f = t % TICKS_PER_SECOND;
  return (negative ? '-' : '') + (days > 0n ? String(days) + '.' : '') + p2(h) + ':' + p2(mi) + ':' + p2(s) + (f > 0n ? '.' + String(f).padStart(7, '0') : '');
}

const INTERVAL_MONTHS =
  "Cannot read interval values with non-zero months as TimeSpan, since that type doesn't support months. Consider using NodaTime Period which better corresponds to PostgreSQL interval, or read the value as NpgsqlInterval, or transform the interval to not contain months or years in PostgreSQL before reading it.";

/** interval (IntervalStyle postgres): the ticks of the TimeSpan Npgsql reads (days and time; no months). */
export function intervalTicks(text: string): bigint {
  let months = 0n;
  let days = 0n;
  let time = 0n;
  const tokens = text.split(' ').filter((t) => t.length > 0);
  for (let i = 0; i < tokens.length; i++) {
    const tok = tokens[i]!;
    const tm = /^([+-]?)(\d+):(\d{2}):(\d{2})(?:\.(\d+))?$/.exec(tok);
    if (tm !== null) {
      const us = (BigInt(tm[2]!) * 3600n + BigInt(tm[3]!) * 60n + BigInt(tm[4]!)) * 1_000_000n + BigInt(micros(tm[5]));
      time += tm[1] === '-' ? -us : us;
      continue;
    }
    const unit = tokens[i + 1] ?? '';
    if (!/^[+-]?\d+$/.test(tok)) throw invalidCast('Invalid interval text: ' + text);
    const n = BigInt(tok);
    i++;
    if (unit.startsWith('year')) months += n * 12n;
    else if (unit.startsWith('mon')) months += n;
    else if (unit.startsWith('day')) days += n;
    else throw invalidCast('Invalid interval text: ' + text);
  }
  if (months !== 0n) throw invalidCast(INTERVAL_MONTHS);
  return BigInt.asIntN(64, days * TICKS_PER_DAY + time * 10n);
}

// ---------------------------------------------------------------------------------------------
// Other scalar types

/** bytea in hex ("\x0001") or escape format. */
export function readBytea(text: string): Uint8Array {
  if (text.startsWith('\\x')) return new Uint8Array(Buffer.from(text.substring(2), 'hex'));
  const out: number[] = [];
  for (let i = 0; i < text.length; i++) {
    const c = text.charCodeAt(i);
    if (c === 92 /* \ */) {
      if (text.charAt(i + 1) === '\\') {
        out.push(92);
        i++;
      } else {
        out.push(parseInt(text.substring(i + 1, i + 4), 8));
        i += 3;
      }
    } else out.push(c);
  }
  return new Uint8Array(out);
}

/** "char": System.Char (a byte); PostgreSQL prints 0 as nothing and high bytes as \ooo. */
function readChar1(text: string): string {
  if (text.length === 0) return '\u0000';
  if (/^\\[0-7]{3}$/.test(text)) return String.fromCharCode(parseInt(text.substring(1), 8));
  return text;
}

/** IPAddress.ToString(): the address without its netmask. */
function readInet(text: string): string {
  const k = text.indexOf('/');
  return k < 0 ? text : text.substring(0, k);
}

/** PhysicalAddress.ToString(): the hex digits in upper case, no separators. */
function readMacaddr(text: string): string {
  return text.replace(/[:.-]/g, '').toUpperCase();
}

/** The text of a tsquery as NpgsqlTsQuery.ToString() writes it: every inner operation in "( ... )". */
export function tsQueryText(text: string): string {
  type Node = { op: 'lex'; text: string } | { op: '!'; child: Node } | { op: string; left: Node; right: Node };
  let i = 0;
  const skip = (): void => {
    while (text.charAt(i) === ' ') i++;
  };
  const primary = (): Node => {
    skip();
    const c = text.charAt(i);
    if (c === '!') {
      i++;
      return { op: '!', child: primary() };
    }
    if (c === '(') {
      i++;
      const n = orExpr();
      skip();
      i++; // ')'
      return n;
    }
    // A quoted lexeme with its weights / prefix mark
    const start = i;
    i++;
    while (i < text.length) {
      if (text.charAt(i) === "'" && text.charAt(i + 1) === "'") i += 2;
      else if (text.charAt(i) === '\\') i += 2;
      else if (text.charAt(i) === "'") break;
      else i++;
    }
    i++;
    if (text.charAt(i) === ':') {
      i++;
      while (/[*ABCDabcd]/.test(text.charAt(i))) i++;
    }
    return { op: 'lex', text: text.substring(start, i) };
  };
  const phrase = (): Node => {
    let left = primary();
    for (;;) {
      skip();
      const m = /^<(-|\d+)>/.exec(text.substring(i));
      if (m === null) return left;
      i += m[0].length;
      left = { op: m[0], left, right: primary() };
    }
  };
  const andExpr = (): Node => {
    let left = phrase();
    for (;;) {
      skip();
      if (text.charAt(i) !== '&') return left;
      i++;
      left = { op: '&', left, right: phrase() };
    }
  };
  const orExpr = (): Node => {
    let left = andExpr();
    for (;;) {
      skip();
      if (text.charAt(i) !== '|') return left;
      i++;
      left = { op: '|', left, right: andExpr() };
    }
  };
  const render = (n: Node, first: boolean): string => {
    if (n.op === 'lex') return (n as { text: string }).text;
    if (n.op === '!') {
      const child = (n as { child: Node }).child;
      return '!' + (child.op === 'lex' ? render(child, false) : '( ' + render(child, true) + ' )');
    }
    const b = n as { op: string; left: Node; right: Node };
    const inner = render(b.left, false) + ' ' + b.op + ' ' + render(b.right, false);
    return first ? inner : '( ' + inner + ' )';
  };
  if (text.trim().length === 0) return '';
  return render(orExpr(), true);
}

// ---------------------------------------------------------------------------------------------
// Arrays and ranges

/** The elements of an array's text and its number of dimensions. */
export function parseArray(text: string, delimiter = ','): { dims: number; elements: (string | null)[] } {
  let i = 0;
  if (text.charAt(0) === '[') i = text.indexOf('=') + 1;
  const elements: (string | null)[] = [];
  let depth = 0;
  let dims = 0;
  while (i < text.length) {
    const c = text.charAt(i);
    if (c === '{') {
      depth++;
      if (depth > dims) dims = depth;
      i++;
    } else if (c === '}') {
      depth--;
      i++;
    } else if (c === delimiter || c === ' ') i++;
    else if (c === '"') {
      let v = '';
      i++;
      while (i < text.length && text.charAt(i) !== '"') {
        if (text.charAt(i) === '\\') i++;
        v += text.charAt(i);
        i++;
      }
      i++;
      elements.push(v);
    } else {
      let j = i;
      while (j < text.length && text.charAt(j) !== delimiter && text.charAt(j) !== '}') j++;
      const v = text.substring(i, j);
      elements.push(v.toUpperCase() === 'NULL' ? null : v);
      i = j;
    }
  }
  return { dims: Math.max(1, dims), elements };
}

/** The bounds of a range's text (null: infinite), or 'empty'. */
function parseRange(text: string): 'empty' | { lowerInc: boolean; upperInc: boolean; lower: string | null; upper: string | null } {
  if (text === 'empty') return 'empty';
  let i = 1;
  const bound = (): string | null => {
    if (text.charAt(i) === ',' || text.charAt(i) === ')' || text.charAt(i) === ']') return null;
    let v = '';
    if (text.charAt(i) === '"') {
      i++;
      while (i < text.length) {
        const c = text.charAt(i);
        if (c === '\\') {
          v += text.charAt(i + 1);
          i += 2;
        } else if (c === '"' && text.charAt(i + 1) === '"') {
          v += '"';
          i += 2;
        } else if (c === '"') {
          i++;
          break;
        } else {
          v += c;
          i++;
        }
      }
      return v;
    }
    while (i < text.length && text.charAt(i) !== ',' && text.charAt(i) !== ')' && text.charAt(i) !== ']') v += text.charAt(i++);
    return v;
  };
  const lower = bound();
  i++; // ','
  const upper = bound();
  return { lowerInc: text.charAt(0) === '[', upperInc: text.charAt(text.length - 1) === ']', lower, upper };
}

// ---------------------------------------------------------------------------------------------
// Column readers

/** The type a value is read as, following domains. */
function resolve(catalog: TypeCatalog, oid: number): PgType | undefined {
  let t = catalog.get(oid);
  while (t !== undefined && t.kind === 'domain') t = catalog.get(t.elem!);
  return t;
}

/** The CLR type Npgsql reads a type as (for the names of arrays and ranges) and whether it is a value type. */
function clrOf(catalog: TypeCatalog, oid: number, typmod: number): { name: string; valueType: boolean } {
  const t = resolve(catalog, oid);
  const vt = (name: string): { name: string; valueType: boolean } => ({ name, valueType: true });
  const ref = (name: string): { name: string; valueType: boolean } => ({ name, valueType: false });
  if (t === undefined) return ref('System.Object');
  switch (t.kind) {
    case 'int2':
      return vt('System.Int16');
    case 'int4':
      return vt('System.Int32');
    case 'int8':
      return vt('System.Int64');
    case 'float4':
      return vt('System.Single');
    case 'float8':
      return vt('System.Double');
    case 'numeric':
    case 'money':
      return vt('System.Decimal');
    case 'bool':
      return vt('System.Boolean');
    case 'text':
      return ref('System.String');
    case 'char1':
      return vt('System.Char');
    case 'bytea':
      return ref('System.Byte[]');
    case 'date':
      return vt('System.DateOnly');
    case 'time':
      return vt('System.TimeOnly');
    case 'timetz':
      return vt('System.DateTimeOffset');
    case 'timestamp':
    case 'timestamptz':
      return vt('System.DateTime');
    case 'interval':
      return vt('System.TimeSpan');
    case 'uuid':
      return vt('System.Guid');
    case 'inet':
      return ref('System.Net.IPAddress');
    case 'cidr':
      return vt('System.Net.IPNetwork');
    case 'macaddr':
      return ref('System.Net.NetworkInformation.PhysicalAddress');
    case 'bit':
      return typmod === 1 ? vt('System.Boolean') : ref('System.Collections.BitArray');
    case 'varbit':
      return ref('System.Collections.BitArray');
    case 'geometry':
      return vt(t.clr!);
    case 'cube':
      return vt('NpgsqlTypes.NpgsqlCube');
    case 'range':
      return vt('NpgsqlTypes.NpgsqlRange`1[' + clrOf(catalog, t.elem!, -1).name + ']');
    case 'multirange':
      return ref(clrOf(catalog, t.elem!, -1).name + '[]');
    case 'int2vector':
      return ref('System.Int16[]');
    case 'oidvector':
      return ref('System.UInt32[]');
    case 'tsvector':
      return ref('NpgsqlTypes.NpgsqlTsVector');
    case 'tsquery':
      return ref('NpgsqlTypes.NpgsqlTsQuery');
    case 'uint32':
    case 'regtype':
      return vt('System.UInt32');
    case 'uint64':
      return vt('System.UInt64');
    case 'pg_lsn':
      return vt('NpgsqlTypes.NpgsqlLogSequenceNumber');
    case 'tid':
      return vt('NpgsqlTypes.NpgsqlTid');
    case 'record':
      return ref('System.Object[]');
    case 'hstore':
      return ref('System.Collections.Generic.Dictionary`2[System.String,System.String]');
    case 'array':
      return ref(clrOf(catalog, t.elem!, typmod).name + '[]');
    default:
      return ref('System.Object');
  }
}

/** Whether Npgsql has no reader for a type (its schema DataType is DBNull). */
export function isUnsupported(catalog: TypeCatalog, oid: number): boolean {
  const t = resolve(catalog, oid);
  if (t === undefined || t.kind === 'unsupported') return true;
  if (t.kind === 'array' || t.kind === 'range' || t.kind === 'multirange') return isUnsupported(catalog, t.elem!);
  return false;
}

const reader = (type: DataColumnType, read: (text: string) => DataValue): ColumnReader => ({ type, read });

/** The text of a range bound as NpgsqlRange<T>.ToString() writes it (T.ToString() under the culture). */
function rangeBoundText(ctx: ReadContext, subtype: number, text: string): string {
  const t = resolve(ctx.catalog, subtype);
  switch (t?.kind) {
    case 'numeric':
      return formatDecimal(readNumeric(text), '', ctx.culture.number);
    case 'float4':
    case 'float8':
      return doubleText(Number(text), ctx.culture);
    case 'date':
      return formatDateTime(readDate(text), 'd', ctx.culture);
    case 'timestamp':
      return formatDateTime(readTimestamp(text), '', ctx.culture);
    case 'timestamptz':
      return formatDateTime(readTimestampTz(text), '', ctx.culture);
    default:
      return text;
  }
}

/** The reader of a column of a type (with the typmod of the column). */
export function columnReader(ctx: ReadContext, oid: number, typmod: number): ColumnReader {
  const t = resolve(ctx.catalog, oid);
  const kind: ValueKind = t === undefined ? 'unsupported' : t.kind;
  switch (kind) {
    case 'int2':
      return reader('Int16', Number);
    case 'int4':
      return reader('Int32', Number);
    case 'int8':
      return reader('Int64', BigInt);
    case 'float4':
      return reader('Single', (s) => Math.fround(readFloat(s)));
    case 'float8':
      return reader('Double', readFloat);
    case 'numeric':
      return reader('Decimal', readNumeric);
    case 'money':
      return reader('Decimal', readMoney);
    case 'bool':
      return reader('Boolean', (s) => s === 't');
    case 'text':
      return reader('String', (s) => s);
    case 'char1':
      return reader('Object', readChar1);
    case 'bytea':
      return reader('Binary', readBytea);
    case 'date':
      return reader('DateTime', readDate);
    case 'time':
      return reader('DateTime', readTime);
    case 'timetz':
      return reader('DateTime', readTimeTz);
    case 'timestamp':
      return reader('DateTime', readTimestamp);
    case 'timestamptz':
      return reader('DateTime', readTimestampTz);
    case 'interval':
      return reader('Object', (s) => timeSpanText(intervalTicks(s)));
    case 'uuid':
    case 'cidr':
    case 'pg_lsn':
    case 'tid':
    case 'tsvector':
      return reader('Object', (s) => s);
    case 'inet':
      return reader('Object', readInet);
    case 'macaddr':
      return reader('Object', readMacaddr);
    case 'bit':
      // bit(1) is a Boolean; any other bit string a BitArray
      return typmod === 1 ? reader('Object', (s) => s === '1') : reader('Object', () => 'System.Collections.BitArray');
    case 'varbit':
      return reader('Object', () => 'System.Collections.BitArray');
    case 'geometry':
    case 'cube':
      return reader('Object', reformatNumbers);
    case 'tsquery':
      return reader('Object', tsQueryText);
    case 'uint32':
      return reader('Int64', BigInt);
    case 'uint64':
      return reader('Decimal', (s) => CsDecimal.fromInteger(BigInt(s)));
    case 'regtype':
      return reader('Int64', (s) => {
        const o = ctx.regtypes.get(s);
        if (o === undefined) throw invalidCast('Unknown type name: ' + s);
        return o;
      });
    case 'int2vector':
      return reader('Object', () => 'System.Int16[]');
    case 'oidvector':
      return reader('Object', () => 'System.UInt32[]');
    case 'record':
      return reader('Object', () => 'System.Object[]');
    case 'hstore':
      return reader('Object', () => 'System.Collections.Generic.Dictionary`2[System.String,System.String]');
    case 'void':
      return reader('Object', () => null);
    case 'range': {
      const sub = t!.elem!;
      return reader('Object', (s) => {
        const r = parseRange(s);
        if (r === 'empty') return 'empty';
        return (
          (r.lowerInc ? '[' : '(') +
          (r.lower === null ? '' : rangeBoundText(ctx, sub, r.lower)) +
          ',' +
          (r.upper === null ? '' : rangeBoundText(ctx, sub, r.upper)) +
          (r.upperInc ? ']' : ')')
        );
      });
    }
    case 'multirange': {
      const name = clrOf(ctx.catalog, oid, typmod).name;
      return reader('Object', () => name);
    }
    case 'array': {
      const elemOid = t!.elem!;
      const elem = clrOf(ctx.catalog, elemOid, typmod);
      // The elements are read to fail as Npgsql does on a value it cannot read (regtype: its OID)
      const elemReader = resolve(ctx.catalog, elemOid)?.kind === 'regtype' ? reader('Object', () => null) : columnReader(ctx, elemOid, typmod);
      const delimiter = resolve(ctx.catalog, elemOid)?.oid === 603 ? ';' : ',';
      return reader('Object', (s) => {
        const { dims, elements } = parseArray(s, delimiter);
        for (const e of elements) {
          if (e === null) {
            if (elem.valueType)
              throw invalidCast(
                'Cannot read a non-nullable collection of elements because the returned array contains nulls. Call GetFieldValue with a nullable collection type instead.',
              );
          } else elemReader.read(e);
        }
        return elem.name + '[' + ','.repeat(dims - 1) + ']';
      });
    }
    default:
      return reader('Object', () => {
        throw invalidCast('No reader');
      });
  }
}
