// The answer of api/agent/execute as HttpAgentExecutor.DeserializeDataTable reads it into a DataTable:
// the envelope, the error of the Hub, the columns (MapTypeName) and the cells (ConvertJsonValue). A cell
// that is not of its column's JSON kind is given as its text (element.ToString(), the fallback of C#):
// the engine stores it in the column type as a DataTable does (DataRow[i] = value, under the locale of the
// table), with the same conversions and errors.

import {
  CultureInfo,
  CsDecimal,
  DateTimeKind,
  fromBase64String,
  NetException,
  NumberStyles,
  RpDateTime,
  tryParseDecimal,
  type DataColumnInfo,
  type DataColumnType,
  type DataValue,
  type QueryResult,
} from 'reportman-engine';
import {
  elementToString,
  enumerateArray,
  getBoolean,
  getProperty,
  getString,
  parseJson,
  tryGetProperty,
  type JsonElement,
} from './json.js';

/** MapTypeName: the .NET type names of the Hub; any other is a string column. */
export function mapTypeName(typeName: string): DataColumnType {
  switch (typeName) {
    case 'Int32':
      return 'Int32';
    case 'Int64':
      return 'Int64';
    case 'Int16':
      return 'Int16';
    case 'Decimal':
      return 'Decimal';
    case 'Double':
      return 'Double';
    case 'Single':
      return 'Single';
    case 'Boolean':
      return 'Boolean';
    case 'DateTime':
      return 'DateTime';
    case 'Byte[]':
      return 'Binary';
    default:
      return 'String';
  }
}

const INT_RE = /^-?\d+$/;

/** Utf8Parser.TryParse of an integer (JsonElement.GetInt16/32/64): its digits, in range. */
function integerOf(element: JsonElement, min: bigint, max: bigint): bigint | undefined {
  if (element.kind !== 'Number') return undefined;
  const raw = element.raw;
  if (!INT_RE.test(raw)) return undefined;
  const v = BigInt(raw);
  return v < min || v > max ? undefined : v;
}

function twoDigits(s: string, at: number): number | undefined {
  const a = s.charCodeAt(at) - 48;
  const b = s.charCodeAt(at + 1) - 48;
  if (!(a >= 0 && a <= 9 && b >= 0 && b <= 9)) return undefined;
  return a * 10 + b;
}

function daysInMonth(year: number, month: number): number {
  return [31, (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0 ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][month - 1]!;
}

const TICKS_PER_MINUTE = 600000000n;
const UNIX_EPOCH_TICKS = 621355968000000000n;
const MAX_TICKS = 3155378975999999999n;

/** The offset (minutes) of the host time zone at a UTC instant (TimeZoneInfo.Local). */
function localOffsetMinutes(utcTicks: bigint): number {
  const ms = Number((utcTicks - UNIX_EPOCH_TICKS) / 10000n);
  return -new Date(ms).getTimezoneOffset();
}

/**
 * JsonElement.GetDateTime (JsonHelpers.TryParseAsISO, the ISO 8601-1:2019 profile of System.Text.Json):
 * "yyyy-MM-dd", "yyyy-MM-ddTHH:mm", "yyyy-MM-ddTHH:mm:ss", a fraction of up to 16 digits (7 are kept),
 * then "Z" or an offset "+hh", "+hh:mm". A time with an offset is the local time of that instant. The
 * DataTable keeps no kind (DataSetDateTime.UnspecifiedLocal): the value is Unspecified.
 */
export function parseIsoDateTime(s: string): RpDateTime | undefined {
  if (s.length < 10 || s.length > 42) return undefined;
  const y1 = twoDigits(s, 0);
  const y2 = twoDigits(s, 2);
  if (y1 === undefined || y2 === undefined) return undefined;
  const year = y1 * 100 + y2;
  if (s.charAt(4) !== '-' || s.charAt(7) !== '-') return undefined;
  const month = twoDigits(s, 5);
  const day = twoDigits(s, 8);
  if (month === undefined || day === undefined) return undefined;
  let hour = 0;
  let minute = 0;
  let second = 0;
  let fraction = 0;
  let offsetToken = '';
  let offsetHours = 0;
  let offsetMinutes = 0;
  const parseOffset = (at: number): boolean => {
    const rest = s.substring(at);
    if (rest.length < 2) return false;
    const h = twoDigits(rest, 0);
    if (h === undefined) return false;
    offsetHours = h;
    if (rest.length === 2) return true;
    if (rest.length !== 5 || rest.charAt(2) !== ':') return false;
    const m = twoDigits(rest, 3);
    if (m === undefined) return false;
    offsetMinutes = m;
    return true;
  };
  const parsed = ((): boolean => {
    if (s.length === 10) return true;
    if (s.length < 16) return false;
    if (s.charAt(10) !== 'T' || s.charAt(13) !== ':') return false;
    const h = twoDigits(s, 11);
    const mi = twoDigits(s, 14);
    if (h === undefined || mi === undefined) return false;
    hour = h;
    minute = mi;
    if (s.length === 16) return true;
    let c = s.charAt(16);
    let index = 17;
    if (c === 'Z') {
      offsetToken = 'Z';
      return index === s.length;
    }
    if (c === '+' || c === '-') {
      offsetToken = c;
      return parseOffset(index);
    }
    if (c !== ':') return false;
    if (s.length < 19) return false;
    const sec = twoDigits(s, 17);
    if (sec === undefined) return false;
    second = sec;
    if (s.length === 19) return true;
    c = s.charAt(19);
    index = 20;
    if (c === 'Z') {
      offsetToken = 'Z';
      return index === s.length;
    }
    if (c === '+' || c === '-') {
      offsetToken = c;
      return parseOffset(index);
    }
    if (c !== '.') return false;
    if (s.length < 21) return false;
    let read = 0;
    const end = Math.min(index + 16, s.length);
    while (index < end && s.charAt(index) >= '0' && s.charAt(index) <= '9') {
      if (read < 7) {
        fraction = fraction * 10 + (s.charCodeAt(index) - 48);
        read++;
      }
      index++;
    }
    if (fraction !== 0) while (read < 7) {
      fraction *= 10;
      read++;
    }
    if (index === s.length) return true;
    c = s.charAt(index++);
    if (c === 'Z') {
      offsetToken = 'Z';
      return index === s.length;
    }
    if (c === '+' || c === '-') {
      offsetToken = c;
      return parseOffset(index);
    }
    return false;
  })();
  if (!parsed) return undefined;
  // TryCreateDateTime
  if (year === 0 || month < 1 || month > 12 || day < 1 || day > daysInMonth(year, month)) return undefined;
  if (hour > 23 || minute > 59 || second > 59) return undefined;
  const wall = RpDateTime.create(year, month, day, hour, minute, second).addTicks(BigInt(fraction));
  if (offsetToken !== '+' && offsetToken !== '-') return wall.withKind(DateTimeKind.Unspecified);
  // TryCreateDateTimeOffset, then DateTimeOffset.LocalDateTime
  if (offsetHours > 14 || offsetMinutes > 59 || (offsetHours === 14 && offsetMinutes !== 0)) return undefined;
  const offset = BigInt((offsetToken === '-' ? -1 : 1) * (offsetHours * 60 + offsetMinutes));
  const utc = wall.ticks - offset * TICKS_PER_MINUTE;
  if (utc < 0n || utc > MAX_TICKS) return undefined;
  let local = utc + BigInt(localOffsetMinutes(utc)) * TICKS_PER_MINUTE;
  if (local < 0n) local = 0n;
  if (local > MAX_TICKS) local = MAX_TICKS;
  return RpDateTime.fromTicks(local, DateTimeKind.Unspecified);
}

/** ConvertJsonValue: the value of a cell for its column type, or its text when it is not one. */
export function convertJsonValue(element: JsonElement, type: DataColumnType): DataValue {
  const fallback = (): string => elementToString(element);
  switch (type) {
    case 'Int32': {
      const v = integerOf(element, -2147483648n, 2147483647n);
      return v === undefined ? fallback() : Number(v);
    }
    case 'Int64': {
      const v = integerOf(element, -9223372036854775808n, 9223372036854775807n);
      return v === undefined ? fallback() : v;
    }
    case 'Int16': {
      const v = integerOf(element, -32768n, 32767n);
      return v === undefined ? fallback() : Number(v);
    }
    case 'Decimal': {
      if (element.kind !== 'Number') return fallback();
      const v: CsDecimal | undefined = tryParseDecimal(element.raw, NumberStyles.Float, CultureInfo.invariant.number);
      return v === undefined ? fallback() : v;
    }
    case 'Double': {
      if (element.kind !== 'Number') return fallback();
      const v = Number(element.raw);
      return Number.isFinite(v) ? v : fallback();
    }
    case 'Single': {
      if (element.kind !== 'Number') return fallback();
      const v = Math.fround(Number(element.raw));
      return Number.isFinite(v) ? v : fallback();
    }
    case 'Boolean':
      return element.kind === 'True' ? true : element.kind === 'False' ? false : fallback();
    case 'DateTime': {
      if (element.kind !== 'String') return fallback();
      return parseIsoDateTime(element.text!) ?? fallback();
    }
    case 'Binary': {
      if (element.kind !== 'String') return new Uint8Array(0);
      const base64 = element.text!;
      if (base64.length === 0) return new Uint8Array(0);
      try {
        return fromBase64String(base64);
      } catch {
        return fallback();
      }
    }
    default:
      return element.kind === 'String' ? element.text! : fallback();
  }
}

/** DataColumnCollection.Add of an empty name: "Column1", "Column2"... the first one that is free. */
function defaultName(taken: readonly DataColumnInfo[], next: { index: number }): string {
  for (;;) {
    const name = 'Column' + next.index++;
    if (!taken.some((c) => c.name.toUpperCase() === name.toUpperCase())) return name;
  }
}

/**
 * DeserializeDataTable: the rows of an answer of the Hub ({data:{columns, rows}}, or columns and rows at
 * the root), or the errors of C#: the Hub's ({success:false, error}), a missing part, a JSON element of
 * another kind than the one read.
 */
export function deserializeTable(json: string): QueryResult {
  let root = parseJson(json);
  const data = tryGetProperty(root, 'data');
  if (data !== undefined) root = data;
  const success = tryGetProperty(root, 'success');
  if (success !== undefined && !getBoolean(success)) {
    const error = tryGetProperty(root, 'error');
    const message = error !== undefined ? getString(error) : 'Unknown error';
    throw new NetException('Exception', 'HttpAgent execution failed: ' + (message ?? ''));
  }
  const cols = tryGetProperty(root, 'columns');
  const rowsProp = tryGetProperty(root, 'rows');
  if (cols === undefined || rowsProp === undefined) throw new NetException('Exception', 'Invalid response format: missing columns or rows');
  const columns: DataColumnInfo[] = [];
  const next = { index: 1 };
  for (const col of enumerateArray(cols)) {
    const name = getString(getProperty(col, 'name')) ?? '';
    const typeName = getString(getProperty(col, 'dataType')) ?? 'String';
    // DataColumnCollection.Add: an empty name is given one, a repeated one is refused
    if (name.length > 0 && columns.some((c) => c.name === name))
      throw new NetException('DuplicateNameException', `A column named '${name}' already belongs to this DataTable.`);
    columns.push({ name: name.length === 0 ? defaultName(columns, next) : name, type: mapTypeName(typeName), size: null, declaredType: null });
  }
  const rows: DataValue[][] = [];
  for (const row of enumerateArray(rowsProp)) {
    const values: DataValue[] = new Array<DataValue>(columns.length).fill(null);
    const cells = enumerateArray(row);
    for (let i = 0; i < cells.length && i < columns.length; i++) {
      const cell = cells[i]!;
      const value = cell.kind === 'Null' ? null : convertJsonValue(cell, columns[i]!.type);
      if (typeof value === 'string') checkIntegerText(value, columns[i]!);
      values[i] = value;
    }
    rows.push(values);
  }
  return { columns, rows };
}

const INTEGER_OVERFLOW: Partial<Record<DataColumnType, string>> = {
  Int16: 'Value was either too large or too small for an Int16.',
  Int32: 'Value was either too large or too small for an Int32.',
  Int64: 'Value was either too large or too small for an Int64.',
};

/**
 * The text of a cell of an integer column that is an integer beyond Int64: DataRow[i] = text fails with
 * the OverflowException of Int64.Parse (the conversion of the engine reads it as a format error).
 */
function checkIntegerText(text: string, column: DataColumnInfo): void {
  const overflow = INTEGER_OVERFLOW[column.type];
  if (overflow === undefined) return;
  const m = /^[\t\n\v\f\r ]*([+-]?)(\d+)[\t\n\v\f\r \0]*$/.exec(text);
  if (m === null) return;
  const v = BigInt(m[1] + m[2]);
  if (v >= -9223372036854775808n && v <= 9223372036854775807n) return;
  throw new NetException(
    'ArgumentException',
    `${overflow}Couldn't store <${text}> in ${column.name} Column.  Expected type is ${column.type}.`,
  );
}
