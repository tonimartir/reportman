// The columns of a result as MySqlConnector 2.5 gives them to the C# engine: the column name, the
// .NET type of its values (MySqlDbColumn.DataType of GetSchemaTable, through TypeMapper), its
// ColumnSize, and each value as the text-protocol ColumnReader reads it, then turned into the value
// the engine stores for that .NET type.
//
// The .NET types without a DataColumnType of the engine become what Variant.AssignFromObject of the
// C# engine makes of them: SByte, UInt16 and UInt32 a Long (Int64 columns), UInt64 a Decimal, and the
// types it has no slot for (TimeSpan, Guid, MySqlDateTime, ReadOnlyMemory<float>) their text,
// Convert.ToString under the current culture: those are 'Object' columns.

import {
  CsDecimal,
  CultureInfo,
  type DataColumnInfo,
  type DataColumnType,
  type DataValue,
  DateTimeKind,
  formatDateTime,
  NetException,
  NumberStyles,
  RpDateTime,
  tryParseDecimal,
} from '@reportman/engine';
import { BINARY_COLLATION, bytesPerCharacter } from './charsets.js';
import type { DateTimeKindName, GuidFormat } from './connectionstring.js';
import { formatException, invalidCast, notSupported } from './errors.js';

/** A column definition of the protocol (mysql2's ColumnDefinition). */
export interface ColumnDefinition {
  readonly name: string;
  readonly columnType: number;
  /** The byte length (unsigned 32 bits). */
  readonly columnLength: number;
  /** The collation id. */
  readonly characterSet: number;
  readonly flags: number;
  readonly decimals: number;
}

/** A column with the .NET type MySqlConnector reports for it (GetSchemaTable DataType). */
export interface MySqlColumnInfo extends DataColumnInfo {
  /** The name of the .NET type (Type.Name): Int32, UInt64, TimeSpan, Guid, MySqlDateTime... */
  readonly netType: string;
}

/** What reading the columns needs of the connection settings. */
export interface ReadOptions {
  readonly treatTinyAsBoolean: boolean;
  readonly guidFormat: GuidFormat;
  readonly allowZeroDateTime: boolean;
  readonly convertZeroDateTime: boolean;
  readonly dateTimeKind: DateTimeKindName;
  /** CultureInfo.CurrentCulture of the C# engine (the text of a MySqlDateTime). */
  readonly culture: CultureInfo;
}

/** ColumnType (the protocol's field types). */
export const ColumnType = {
  Decimal: 0,
  Tiny: 1,
  Short: 2,
  Long: 3,
  Float: 4,
  Double: 5,
  Null: 6,
  Timestamp: 7,
  Longlong: 8,
  Int24: 9,
  Date: 10,
  Time: 11,
  DateTime: 12,
  Year: 13,
  NewDate: 14,
  VarChar: 15,
  Bit: 16,
  Timestamp2: 17,
  DateTime2: 18,
  Vector: 242,
  Json: 0xf5,
  NewDecimal: 0xf6,
  Enum: 0xf7,
  Set: 0xf8,
  TinyBlob: 0xf9,
  MediumBlob: 0xfa,
  LongBlob: 0xfb,
  Blob: 0xfc,
  VarString: 0xfd,
  String: 0xfe,
  Geometry: 0xff,
} as const;

const COLUMN_TYPE_NAMES = new Map<number, string>(Object.entries(ColumnType).map(([k, v]) => [v, k]));

/** ColumnFlags. */
export const ColumnFlags = { Unsigned: 0x20, Binary: 0x80, Enum: 0x100, Set: 0x800 } as const;

/** The MySqlDbType of a column (TypeMapper.ConvertToMySqlDbType). */
export type MySqlDbType =
  | 'Bool'
  | 'Byte'
  | 'UByte'
  | 'Int16'
  | 'UInt16'
  | 'Int24'
  | 'UInt24'
  | 'Int32'
  | 'UInt32'
  | 'Int64'
  | 'UInt64'
  | 'Bit'
  | 'Guid'
  | 'Enum'
  | 'Set'
  | 'Binary'
  | 'VarBinary'
  | 'TinyBlob'
  | 'Blob'
  | 'MediumBlob'
  | 'LongBlob'
  | 'String'
  | 'VarChar'
  | 'TinyText'
  | 'Text'
  | 'MediumText'
  | 'LongText'
  | 'JSON'
  | 'Date'
  | 'DateTime'
  | 'Timestamp'
  | 'Time'
  | 'Year'
  | 'Float'
  | 'Double'
  | 'Decimal'
  | 'NewDecimal'
  | 'Geometry'
  | 'Null'
  | 'Vector';

/** The CLR type of each MySqlDbType (TypeMapper's DbTypeMapping.ClrType). */
const CLR_TYPES: Record<MySqlDbType, string> = {
  Bool: 'Boolean',
  Byte: 'SByte',
  UByte: 'Byte',
  Int16: 'Int16',
  UInt16: 'UInt16',
  Int24: 'Int32',
  UInt24: 'UInt32',
  Int32: 'Int32',
  UInt32: 'UInt32',
  Int64: 'Int64',
  UInt64: 'UInt64',
  Bit: 'UInt64',
  Guid: 'Guid',
  Enum: 'String',
  Set: 'String',
  Binary: 'Byte[]',
  VarBinary: 'Byte[]',
  TinyBlob: 'Byte[]',
  Blob: 'Byte[]',
  MediumBlob: 'Byte[]',
  LongBlob: 'Byte[]',
  String: 'String',
  VarChar: 'String',
  TinyText: 'String',
  Text: 'String',
  MediumText: 'String',
  LongText: 'String',
  JSON: 'String',
  Date: 'DateTime',
  DateTime: 'DateTime',
  Timestamp: 'DateTime',
  Time: 'TimeSpan',
  Year: 'Int32',
  Float: 'Single',
  Double: 'Double',
  Decimal: 'Decimal',
  NewDecimal: 'Decimal',
  Geometry: 'Byte[]',
  Null: 'Object',
  Vector: 'ReadOnlyMemory`1',
};

/** The engine column of each .NET type (what Variant.AssignFromObject makes of its values). */
const ENGINE_TYPES: Record<string, DataColumnType> = {
  Boolean: 'Boolean',
  SByte: 'Int64',
  Byte: 'Byte',
  Int16: 'Int16',
  UInt16: 'Int64',
  Int32: 'Int32',
  UInt32: 'Int64',
  Int64: 'Int64',
  UInt64: 'Decimal',
  Single: 'Single',
  Double: 'Double',
  Decimal: 'Decimal',
  String: 'String',
  'Byte[]': 'Binary',
  DateTime: 'DateTime',
  TimeSpan: 'Object',
  Guid: 'Object',
  MySqlDateTime: 'Object',
  'ReadOnlyMemory`1': 'Object',
  Object: 'Object',
};

function columnTypeName(type: number): string {
  return COLUMN_TYPE_NAMES.get(type) ?? String(type);
}

/** ProtocolUtility.GetBytesPerCharacter, failing as it fails. */
function bytesPerChar(collation: number): number {
  const n = bytesPerCharacter(collation);
  if (n === undefined) {
    throw notSupported(`Maximum byte length of character set ${collation === 0 ? 'None' : String(collation)} is unknown.`);
  }
  return n;
}

/** The MySqlDbType of a text or binary column (the shared cases of ConvertToMySqlDbType). */
function textOrBinaryType(column: ColumnDefinition, guidFormat: GuidFormat): MySqlDbType {
  const type = column.columnType;
  if (column.characterSet === BINARY_COLLATION) {
    if ((guidFormat === 'Binary16' || guidFormat === 'TimeSwapBinary16' || guidFormat === 'LittleEndianBinary16') && column.columnLength === 16) {
      return 'Guid';
    }
    return type === ColumnType.String
      ? 'Binary'
      : type === ColumnType.VarString
        ? 'VarBinary'
        : type === ColumnType.TinyBlob
          ? 'TinyBlob'
          : type === ColumnType.Blob
            ? 'Blob'
            : type === ColumnType.MediumBlob
              ? 'MediumBlob'
              : 'LongBlob';
  }
  return type === ColumnType.String
    ? 'String'
    : type === ColumnType.VarString
      ? 'VarChar'
      : type === ColumnType.TinyBlob
        ? 'TinyText'
        : type === ColumnType.Blob
          ? 'Text'
          : type === ColumnType.MediumBlob
            ? 'MediumText'
            : 'LongText';
}

/** TypeMapper.ConvertToMySqlDbType. */
export function mySqlDbType(column: ColumnDefinition, treatTinyAsBoolean: boolean, guidFormat: GuidFormat): MySqlDbType {
  const unsigned = (column.flags & ColumnFlags.Unsigned) !== 0;
  switch (column.columnType) {
    case ColumnType.Tiny:
      return treatTinyAsBoolean && column.columnLength === 1 && !unsigned ? 'Bool' : unsigned ? 'UByte' : 'Byte';
    case ColumnType.Int24:
      return unsigned ? 'UInt24' : 'Int24';
    case ColumnType.Long:
      return unsigned ? 'UInt32' : 'Int32';
    case ColumnType.Longlong:
      return unsigned ? 'UInt64' : 'Int64';
    case ColumnType.Bit:
      return 'Bit';
    case ColumnType.String:
      if (guidFormat === 'Char36' && Math.floor(column.columnLength / bytesPerChar(column.characterSet)) === 36) return 'Guid';
      if (guidFormat === 'Char32' && Math.floor(column.columnLength / bytesPerChar(column.characterSet)) === 32) return 'Guid';
      if ((column.flags & ColumnFlags.Enum) !== 0) return 'Enum';
      if ((column.flags & ColumnFlags.Set) !== 0) return 'Set';
      return textOrBinaryType(column, guidFormat);
    case ColumnType.VarChar:
    case ColumnType.VarString:
    case ColumnType.TinyBlob:
    case ColumnType.Blob:
    case ColumnType.MediumBlob:
    case ColumnType.LongBlob:
      return textOrBinaryType(column, guidFormat);
    case ColumnType.Json:
      return 'JSON';
    case ColumnType.Short:
      return unsigned ? 'UInt16' : 'Int16';
    case ColumnType.Date:
    case ColumnType.NewDate:
      return 'Date';
    case ColumnType.DateTime:
      return 'DateTime';
    case ColumnType.Timestamp:
      return 'Timestamp';
    case ColumnType.Time:
      return 'Time';
    case ColumnType.Year:
      return 'Year';
    case ColumnType.Float:
      return 'Float';
    case ColumnType.Double:
      return 'Double';
    case ColumnType.Decimal:
      return 'Decimal';
    case ColumnType.NewDecimal:
      return 'NewDecimal';
    case ColumnType.Geometry:
      return 'Geometry';
    case ColumnType.Null:
      return 'Null';
    case ColumnType.Enum:
      return 'Enum';
    case ColumnType.Set:
      return 'Set';
    case ColumnType.Vector:
      return 'Vector';
    default:
      throw new NetException('NotImplementedException', `ConvertToMySqlDbType for ${columnTypeName(column.columnType)} is not implemented`);
  }
}

// ---------------------------------------------------------------------------------------------
// Value readers (the text protocol ColumnReaders)

const utf8 = new TextDecoder('utf-8');
const ascii = (data: Uint8Array): string => {
  let s = '';
  for (const b of data) s += String.fromCharCode(b);
  return s;
};

/** FormatException() without a message: "One of the identified items was in an invalid format." */
function formatError(): NetException {
  return formatException('One of the identified items was in an invalid format.');
}

/** Utf8Parser.TryParse of an integer (sign and digits only) with bytesConsumed == length. */
function parseInteger(data: Uint8Array, min: bigint, max: bigint): bigint {
  const text = ascii(data);
  if (!/^[+-]?\d+$/.test(text)) throw formatError();
  const v = BigInt(text);
  if (v < min || v > max) throw formatError();
  return v;
}

function parseFloatText(data: Uint8Array, what: 'float' | 'double'): number {
  const text = ascii(data);
  if (/^[+-]?(\d+\.?\d*|\.\d+)([eE][+-]?\d+)?$/.test(text)) {
    const v = Number(text);
    return what === 'float' ? Math.fround(v) : v;
  }
  if (text === '-inf') return -Infinity;
  if (text === 'inf') return Infinity;
  if (text === 'nan') return NaN;
  throw formatException(`Couldn't parse value as ${what}: ${utf8.decode(data)}`);
}

function parseDecimalText(data: Uint8Array): CsDecimal {
  const text = ascii(data);
  if (!/^[+-]?(\d+\.?\d*|\.\d+)([eE][+-]?\d+)?$/.test(text)) throw formatError();
  const d = tryParseDecimal(text, NumberStyles.Float, CultureInfo.invariant.number);
  if (d === undefined) throw formatError();
  return d;
}

/** Utf8Parser.TryParse of a fixed number of digits at data[start]. */
function digitsAt(data: Uint8Array, start: number, count: number): number | undefined {
  // Utf8Parser reads as many digits as there are; the reader then demands exactly `count`
  let k = start;
  let v = 0;
  if (k < data.length && (data[k] === 0x2d || data[k] === 0x2b)) return undefined;
  while (k < data.length && data[k]! >= 0x30 && data[k]! <= 0x39) {
    v = v * 10 + (data[k]! - 0x30);
    k++;
  }
  return k - start === count ? v : undefined;
}

const ENGINE_KINDS: Record<DateTimeKindName, DateTimeKind> = {
  Unspecified: DateTimeKind.Unspecified,
  Utc: DateTimeKind.Utc,
  Local: DateTimeKind.Local,
};

/** The fields of a MySqlDateTime (AllowZeroDateTime). */
interface MySqlDateTimeValue {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
  microsecond: number;
}

/** TextDateTimeColumnReader.ParseDateTime. */
export function parseDateTime(data: Uint8Array, options: ReadOptions): RpDateTime | MySqlDateTimeValue {
  const invalid = (): NetException => formatException(`Couldn't interpret value as a valid DateTime: ${utf8.decode(data)}`);
  const year = digitsAt(data, 0, 4);
  if (year === undefined || data.length < 5 || data[4] !== 45) throw invalid();
  const month = digitsAt(data, 5, 2);
  if (month === undefined || data.length < 8 || data[7] !== 45) throw invalid();
  const day = digitsAt(data, 8, 2);
  if (day === undefined) throw invalid();
  if (year === 0 && month === 0 && day === 0) {
    if (options.convertZeroDateTime) return RpDateTime.minValue;
    if (options.allowZeroDateTime) return { year: 0, month: 0, day: 0, hour: 0, minute: 0, second: 0, microsecond: 0 };
    throw invalidCast(
      'Unable to convert MySQL date/time to System.DateTime, set AllowZeroDateTime=True or ConvertZeroDateTime=True in the connection string. See https://mysqlconnector.net/connection-options/',
    );
  }
  let hour = 0;
  let minute = 0;
  let second = 0;
  let ticks = 0;
  if (data.length !== 10) {
    if (data[10] !== 32) throw invalid();
    const h = digitsAt(data, 11, 2);
    if (h === undefined || data.length < 14 || data[13] !== 58) throw invalid();
    const mi = digitsAt(data, 14, 2);
    if (mi === undefined || data.length < 17 || data[16] !== 58) throw invalid();
    const s = digitsAt(data, 17, 2);
    if (s === undefined) throw invalid();
    hour = h;
    minute = mi;
    second = s;
    if (data.length !== 19) {
      if (data[19] !== 46) throw invalid();
      const count = data.length - 20;
      const f = count >= 1 && count <= 7 ? digitsAt(data, 20, count) : undefined;
      if (f === undefined) throw invalid();
      ticks = f * 10 ** (7 - count);
    }
  }
  if (options.allowZeroDateTime) {
    if (ticks % 10 !== 0) throw invalid();
    return { year, month, day, hour, minute, second, microsecond: ticks / 10 };
  }
  try {
    return RpDateTime.create(year, month, day, hour, minute, second, 0, ENGINE_KINDS[options.dateTimeKind]).addTicks(BigInt(ticks));
  } catch {
    throw invalid();
  }
}

/** IConvertible.ToString of a MySqlDateTime: its DateTime in the culture, or 0000-00-00. */
function mySqlDateTimeText(v: MySqlDateTimeValue, culture: CultureInfo): string {
  if (v.year === 0 || v.month === 0 || v.day === 0) return '0000-00-00';
  const d = RpDateTime.create(v.year, v.month, v.day, v.hour, v.minute, v.second).addTicks(BigInt(v.microsecond * 10));
  return formatDateTime(d, '', culture);
}

/** Utility.ParseTimeSpan, as TimeSpan.ToString() ("c") prints it. */
export function parseTimeSpan(data: Uint8Array): string {
  const invalid = (): NetException => formatException(`Couldn't interpret value as a valid TimeSpan: ${utf8.decode(data)}`);
  let k = 0;
  let negative = false;
  if (data[0] === 0x2d) {
    negative = true;
    k = 1;
  }
  let hoursDigits = 0;
  let hours = 0;
  while (k < data.length && data[k]! >= 0x30 && data[k]! <= 0x39) {
    hours = hours * 10 + (data[k]! - 0x30);
    k++;
    hoursDigits++;
  }
  if (hoursDigits === 0 || hours > 838) throw invalid();
  if (data[k] !== 58) throw invalid();
  const minutes = digitsAt(data, k + 1, 2);
  if (minutes === undefined || minutes > 59 || data[k + 3] !== 58) throw invalid();
  const seconds = digitsAt(data, k + 4, 2);
  if (seconds === undefined || seconds > 59) throw invalid();
  let microseconds = 0;
  const rest = k + 6;
  if (data.length !== rest) {
    if (data[rest] !== 46) throw invalid();
    const count = data.length - rest - 1;
    const f = count >= 1 && count <= 6 ? digitsAt(data, rest + 1, count) : undefined;
    if (f === undefined) throw invalid();
    microseconds = f * 10 ** (6 - count);
  }
  const total = ((hours * 60 + minutes) * 60 + seconds) * 1_000_000 + microseconds;
  return timeSpanText(BigInt(total) * 10n * (negative ? -1n : 1n));
}

/** TimeSpan.ToString() ("c"): [-][d.]hh:mm:ss[.fffffff]. */
export function timeSpanText(ticks: bigint): string {
  const negative = ticks < 0n;
  let t = negative ? -ticks : ticks;
  const fraction = Number(t % 10_000_000n);
  t /= 10_000_000n;
  const seconds = Number(t % 60n);
  t /= 60n;
  const minutes = Number(t % 60n);
  t /= 60n;
  const hours = Number(t % 24n);
  const days = t / 24n;
  const p2 = (n: number): string => String(n).padStart(2, '0');
  let s = (negative ? '-' : '') + (days > 0n ? days.toString() + '.' : '') + p2(hours) + ':' + p2(minutes) + ':' + p2(seconds);
  if (fraction !== 0) s += '.' + String(fraction).padStart(7, '0');
  return s;
}

const HEX = '0123456789abcdef';

function hex(bytes: ArrayLike<number>, from: number, to: number): string {
  let s = '';
  for (let i = from; i < to; i++) s += HEX.charAt(bytes[i]! >> 4) + HEX.charAt(bytes[i]! & 15);
  return s;
}

/** Guid.ToString() ("D") of the bytes in the order of the string (big endian). */
function guidText(b: ArrayLike<number>): string {
  return hex(b, 0, 4) + '-' + hex(b, 4, 6) + '-' + hex(b, 6, 8) + '-' + hex(b, 8, 10) + '-' + hex(b, 10, 16);
}

/** Utf8Parser.TryParse(Guid, 'D' or 'N'): the Guid's text in lower case, or undefined. */
function parseGuidText(data: Uint8Array, format: 'D' | 'N'): string | undefined {
  const text = ascii(data);
  const re = format === 'D' ? /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/ : /^[0-9a-fA-F]{32}$/;
  if (!re.test(text)) return undefined;
  const h = text.replace(/-/g, '').toLowerCase();
  return h.substring(0, 8) + '-' + h.substring(8, 12) + '-' + h.substring(12, 16) + '-' + h.substring(16, 20) + '-' + h.substring(20);
}

/** BitColumnReader. */
function readBit(data: Uint8Array, column: ColumnDefinition): bigint {
  if ((column.flags & ColumnFlags.Binary) === 0) {
    let v = 0n;
    for (const b of data) v = v * 256n + BigInt(b);
    return v;
  }
  if (column.columnLength <= 5 && data.length === 1 && data[0]! < 1 << column.columnLength) return BigInt(data[0]!);
  return parseInteger(data, 0n, 18446744073709551615n);
}

type Reader = (data: Uint8Array) => DataValue;

/** The shared cases of ColumnReader.Create for text and binary columns. */
function textOrBytesReader(column: ColumnDefinition, options: ReadOptions): Reader {
  if (column.characterSet !== BINARY_COLLATION) return (d) => utf8.decode(d);
  if (column.columnLength === 16) {
    // new Guid(span): exactly 16 bytes; the time-swapped form indexes 16 of them
    const exact = (d: Uint8Array): void => {
      if (d.length !== 16) throw new NetException('ArgumentException', "Byte array for Guid must be exactly 16 bytes long. (Parameter 'b')");
    };
    switch (options.guidFormat) {
      case 'Binary16':
        return (d) => (exact(d), guidText(d));
      case 'TimeSwapBinary16':
        return (d) => {
          if (d.length < 16) throw new NetException('IndexOutOfRangeException', 'Index was outside the bounds of the array.');
          return guidText([d[4]!, d[5]!, d[6]!, d[7]!, d[2]!, d[3]!, d[0]!, d[1]!, ...d.subarray(8, 16)]);
        };
      case 'LittleEndianBinary16':
        return (d) => (exact(d), guidText([d[3]!, d[2]!, d[1]!, d[0]!, d[5]!, d[4]!, d[7]!, d[6]!, ...d.subarray(8, 16)]));
    }
  }
  return (d) => new Uint8Array(d);
}

/** ColumnReader.Create (text protocol), each value as the engine stores it. */
function reader(column: ColumnDefinition, options: ReadOptions): Reader {
  const unsigned = (column.flags & ColumnFlags.Unsigned) !== 0;
  switch (column.columnType) {
    case ColumnType.Tiny:
      if (options.treatTinyAsBoolean && column.columnLength === 1 && !unsigned) return (d) => d[0] !== 0x30;
      return unsigned ? (d) => Number(parseInteger(d, 0n, 255n)) : (d) => parseInteger(d, -128n, 127n);
    case ColumnType.Int24:
    case ColumnType.Long:
      return unsigned ? (d) => parseInteger(d, 0n, 4294967295n) : (d) => Number(parseInteger(d, -2147483648n, 2147483647n));
    case ColumnType.Longlong:
      return unsigned
        ? (d) => CsDecimal.fromInteger(parseInteger(d, 0n, 18446744073709551615n))
        : (d) => parseInteger(d, -9223372036854775808n, 9223372036854775807n);
    case ColumnType.Bit:
      return (d) => CsDecimal.fromInteger(readBit(d, column));
    case ColumnType.String:
      if (options.guidFormat === 'Char36' && Math.floor(column.columnLength / bytesPerChar(column.characterSet)) === 36) {
        return (d) => {
          const g = parseGuidText(d, 'D');
          if (g === undefined) throw formatException(`Could not parse CHAR(36) value as Guid: ${utf8.decode(d)}`);
          return g;
        };
      }
      if (options.guidFormat === 'Char32' && Math.floor(column.columnLength / bytesPerChar(column.characterSet)) === 32) {
        return (d) => {
          const g = parseGuidText(d, 'N');
          if (g === undefined) throw formatException(`Could not parse CHAR(32) value as Guid: ${utf8.decode(d)}`);
          return g;
        };
      }
      return textOrBytesReader(column, options);
    case ColumnType.VarString:
    case ColumnType.VarChar:
    case ColumnType.TinyBlob:
    case ColumnType.Blob:
    case ColumnType.MediumBlob:
    case ColumnType.LongBlob:
    case ColumnType.Enum:
    case ColumnType.Set:
      return textOrBytesReader(column, options);
    case ColumnType.Json:
      return (d) => utf8.decode(d);
    case ColumnType.Short:
      return unsigned ? (d) => parseInteger(d, 0n, 65535n) : (d) => Number(parseInteger(d, -32768n, 32767n));
    case ColumnType.Date:
    case ColumnType.DateTime:
    case ColumnType.NewDate:
    case ColumnType.Timestamp:
      return (d) => {
        const v = parseDateTime(d, options);
        return v instanceof RpDateTime ? v : mySqlDateTimeText(v, options.culture);
      };
    case ColumnType.Time:
      return (d) => parseTimeSpan(d);
    case ColumnType.Year:
      return (d) => Number(parseInteger(d, -2147483648n, 2147483647n));
    case ColumnType.Float:
      return (d) => parseFloatText(d, 'float');
    case ColumnType.Double:
      return (d) => parseFloatText(d, 'double');
    case ColumnType.Decimal:
    case ColumnType.NewDecimal:
      return (d) => parseDecimalText(d);
    case ColumnType.Geometry:
      return (d) => new Uint8Array(d);
    case ColumnType.Null:
      return () => null;
    case ColumnType.Vector:
      // ReadOnlyMemory<float>.ToString()
      return (d) => `System.ReadOnlyMemory<Single>[${Math.floor(d.length / 4)}]`;
    default:
      throw new NetException('NotImplementedException', `Reading ${columnTypeName(column.columnType)} not implemented`);
  }
}

/** A column of a result: what GetSchemaTable says of it and how its values are read. */
export interface OutputColumn {
  readonly info: MySqlColumnInfo;
  readonly read: Reader;
}

/** MySqlDbColumn: ColumnName, DataType and ColumnSize, and the reader of the column. */
export function outputColumn(column: ColumnDefinition, options: ReadOptions): OutputColumn {
  const dbType = mySqlDbType(column, options.treatTinyAsBoolean, options.guidFormat);
  const clr = CLR_TYPES[dbType];
  const size =
    clr === 'String' || clr === 'Guid'
      ? Math.floor(column.columnLength / bytesPerChar(column.characterSet))
      : column.columnType === ColumnType.Vector
        ? Math.floor(column.columnLength / 4)
        : column.columnLength;
  const netType = options.allowZeroDateTime && clr === 'DateTime' ? 'MySqlDateTime' : clr;
  const info: MySqlColumnInfo = {
    name: column.name,
    type: ENGINE_TYPES[netType]!,
    size: Math.min(size, 2147483647),
    // GetSchemaTable of MySqlConnector has no DataTypeName column
    declaredType: null,
    netType,
  };
  return { info, read: reader(column, options) };
}
