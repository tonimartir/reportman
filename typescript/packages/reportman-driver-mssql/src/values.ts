// The columns of a result as Microsoft.Data.SqlClient gives them to the C# engine: the column name,
// the .NET type of its values (GetSchemaTable DataType), its ColumnSize and DataTypeName, and each
// value as SqlDataReader.GetValue reads it (SqlBuffer), then turned into the value the engine
// stores for that .NET type.
//
// The .NET types the engine has no DataColumnType for become what Variant.AssignFromObject of the
// C# engine makes of them: a DateTimeOffset its LocalDateTime (the time zone of this process), a
// TimeSpan and a Guid their text (Convert.ToString); those, and sql_variant, are 'Object' columns.
// A user-defined type (hierarchyid, geometry, geography) fails as SqlClient fails without the
// Microsoft.SqlServer.Types assembly; a decimal beyond System.Decimal fails as SqlBuffer.Decimal.

import { createRequire } from 'node:module';
import path from 'node:path';
import { CsDecimal, type DataColumnInfo, type DataColumnType, type DataValue, DateTimeKind, RpDateTime } from '@reportman/engine';
import { CONVERSION_OVERFLOWS, fileNotFound, invalidCast, notSupported, overflowException, sqlTypeException } from './errors.js';
import { RawValue } from './raw.js';
import { sqlXmlValue } from './xml.js';

const require = createRequire(import.meta.url);
const tediousRoot = path.dirname(require.resolve('tedious'));
const tediousRequire = createRequire(path.join(tediousRoot, 'tedious.js'));
const iconv = tediousRequire('iconv-lite') as { decode(buf: Buffer, encoding: string): string };
const { Collation } = tediousRequire(path.join(tediousRoot, 'collation.js')) as {
  Collation: { fromBuffer(buffer: Buffer, offset?: number): { codepage: string | undefined } };
};

const TICKS_PER_MS = 10_000n;
const TICKS_PER_MINUTE = 600_000_000n;
const TICKS_PER_DAY = 864_000_000_000n;
const MAX_TICKS = 3_155_378_975_999_999_999n;
/** Ticks of 1900-01-01, the base of datetime and smalldatetime. */
const SQL_BASE_TICKS = 599_266_080_000_000_000n;
/** Ticks of 1970-01-01. */
const UNIX_EPOCH_TICKS = 621_355_968_000_000_000n;
const TWO96 = 1n << 96n;

/** The .NET type names of the values of a column (Type.Name). */
export type NetTypeName =
  | 'Byte'
  | 'Int16'
  | 'Int32'
  | 'Int64'
  | 'Boolean'
  | 'Decimal'
  | 'Double'
  | 'Single'
  | 'String'
  | 'Byte[]'
  | 'DateTime'
  | 'TimeSpan'
  | 'DateTimeOffset'
  | 'Guid'
  | 'Object';

/** A column with the .NET type SqlClient reports for it. */
export interface SqlColumnInfo extends DataColumnInfo {
  /** GetSchemaTable DataType (Type.Name): Int16, TimeSpan, Guid, DateTimeOffset, Object... */
  readonly netType: NetTypeName;
}

/** A value as SqlDataReader.GetValue gives it: its .NET type, the engine value, and the text of the types the engine prints as text. */
export interface NetCell {
  readonly type: NetTypeName;
  /** What the engine stores (AssignFromObject's view): a DateTimeOffset as its LocalDateTime, a TimeSpan and a Guid as their text. */
  readonly value: DataValue;
  /** Convert.ToString(value, InvariantCulture) of a DateTimeOffset (the others print their value). */
  readonly invariantText?: string;
}

const COLUMN_TYPE: Readonly<Record<NetTypeName, DataColumnType>> = {
  Byte: 'Byte',
  Int16: 'Int16',
  Int32: 'Int32',
  Int64: 'Int64',
  Boolean: 'Boolean',
  Decimal: 'Decimal',
  Double: 'Double',
  Single: 'Single',
  String: 'String',
  'Byte[]': 'Binary',
  DateTime: 'DateTime',
  TimeSpan: 'Object',
  DateTimeOffset: 'Object',
  Guid: 'Object',
  Object: 'Object',
};

/** The column metadata of tedious (COLMETADATA). */
export interface ColumnMetadata {
  readonly colName: string;
  readonly type: { readonly id: number; readonly name: string };
  readonly userType: number;
  readonly dataLength?: number | undefined;
  readonly precision?: number | undefined;
  readonly scale?: number | undefined;
  readonly collation?: { readonly codepage?: string | undefined } | undefined;
  readonly udtInfo?: { readonly typeName: string; readonly assemblyName: string; readonly maxByteSize: number } | undefined;
}

/** How the values of a column are read. */
export interface ColumnReader {
  readonly info: SqlColumnInfo;
  /** A value that is not NULL (tedious' value, or the bytes of the types read as bytes). */
  read(value: unknown): NetCell;
}

const UDT_TIMESTAMP = 80;
const MAX_LENGTH = 0xffff;

/** The time, datetime2 and datetimeoffset ColumnSize: the bytes of the time part plus the date and offset. */
function timeBytes(scale: number): number {
  return scale <= 2 ? 3 : scale <= 4 ? 4 : 5;
}

function column(name: string, netType: NetTypeName, size: number, dataTypeName: string, read: (value: unknown) => NetCell): ColumnReader {
  return { info: { name, type: COLUMN_TYPE[netType], netType, size, declaredType: dataTypeName }, read };
}

const asNumber = (type: NetTypeName) => (v: unknown): NetCell => ({ type, value: v as number });

/**
 * The reader of a column: SqlClient's _SqlMetaData → GetSchemaTable (DataType, ColumnSize,
 * DataTypeName) and SqlBuffer.Value. With Type System Version=SQL Server 2000 SqlClient shows the
 * max types and xml as text, ntext and image (and the server, on TDS 7.2, sends the dates and
 * times of SQL Server 2008 as nvarchar).
 */
export function columnReader(meta: ColumnMetadata, typeSystemAssemblyVersion = '10.0.0.0', typeSystem2000 = false): ColumnReader {
  const name = meta.colName;
  const length = meta.dataLength ?? 0;
  const max = length === MAX_LENGTH;
  if (typeSystem2000) {
    if (meta.type.name === 'VarChar' && max) return column(name, 'String', 2147483647, 'text', asString);
    if (meta.type.name === 'NVarChar' && max) return column(name, 'String', 2147483647, 'ntext', asString);
    if (meta.type.name === 'Xml') return column(name, 'String', 2147483647, 'ntext', (v) => ({ type: 'String', value: sqlXmlValue(v as string) }));
    if (meta.type.name === 'VarBinary' && max) return column(name, 'Byte[]', 2147483647, 'image', asBytes);
    // a CLR type is its bytes: varbinary of its maximum size, image when it has none
    if (meta.type.name === 'UDT') {
      const size = meta.udtInfo?.maxByteSize ?? MAX_LENGTH;
      return size === MAX_LENGTH ? column(name, 'Byte[]', 2147483647, 'image', asBytes) : column(name, 'Byte[]', size, 'varbinary', asBytes);
    }
  }
  switch (meta.type.name) {
    case 'TinyInt':
      return column(name, 'Byte', 1, 'tinyint', asNumber('Byte'));
    case 'SmallInt':
      return column(name, 'Int16', 2, 'smallint', asNumber('Int16'));
    case 'Int':
      return column(name, 'Int32', 4, 'int', asNumber('Int32'));
    case 'BigInt':
      return column(name, 'Int64', 8, 'bigint', (v) => ({ type: 'Int64', value: BigInt(v as string) }));
    case 'IntN':
      switch (length) {
        case 1:
          return column(name, 'Byte', 1, 'tinyint', asNumber('Byte'));
        case 2:
          return column(name, 'Int16', 2, 'smallint', asNumber('Int16'));
        case 4:
          return column(name, 'Int32', 4, 'int', asNumber('Int32'));
        default:
          return column(name, 'Int64', 8, 'bigint', (v) => ({ type: 'Int64', value: BigInt(v as string) }));
      }
    case 'Bit':
    case 'BitN':
      return column(name, 'Boolean', 1, 'bit', (v) => ({ type: 'Boolean', value: v as boolean }));
    case 'Real':
      return column(name, 'Single', 4, 'real', asNumber('Single'));
    case 'Float':
      return column(name, 'Double', 8, 'float', asNumber('Double'));
    case 'FloatN':
      return length === 4 ? column(name, 'Single', 4, 'real', asNumber('Single')) : column(name, 'Double', 8, 'float', asNumber('Double'));
    case 'Money':
      return column(name, 'Decimal', 8, 'money', (v) => ({ type: 'Decimal', value: readMoney(rawBytes(v), 0, 8) }));
    case 'SmallMoney':
      return column(name, 'Decimal', 4, 'smallmoney', (v) => ({ type: 'Decimal', value: readMoney(rawBytes(v), 0, 4) }));
    case 'MoneyN':
      return column(name, 'Decimal', length, length === 4 ? 'smallmoney' : 'money', (v) => {
        const b = rawBytes(v);
        return { type: 'Decimal', value: readMoney(b, 1, b[0]!) };
      });
    case 'DecimalN':
    case 'NumericN':
    case 'Decimal':
    case 'Numeric':
      // SqlClient names both decimal (MetaType.MetaDecimal)
      return column(name, 'Decimal', 17, 'decimal', (v) => {
        const b = rawBytes(v);
        return { type: 'Decimal', value: readDecimal(b, 1, b[0]! - 1, meta.scale ?? 0) };
      });
    case 'DateTime':
      return column(name, 'DateTime', 8, 'datetime', (v) => ({ type: 'DateTime', value: readDateTime(rawBytes(v), 0, 8) }));
    case 'SmallDateTime':
      return column(name, 'DateTime', 4, 'smalldatetime', (v) => ({ type: 'DateTime', value: readDateTime(rawBytes(v), 0, 4) }));
    case 'DateTimeN':
      return column(name, 'DateTime', length, length === 4 ? 'smalldatetime' : 'datetime', (v) => {
        const b = rawBytes(v);
        return { type: 'DateTime', value: readDateTime(b, 1, b[0]!) };
      });
    case 'Date':
      return column(name, 'DateTime', 3, 'date', (v) => ({ type: 'DateTime', value: readDate(rawBytes(v), 1) }));
    case 'Time': {
      const scale = meta.scale ?? 7;
      return column(name, 'TimeSpan', timeBytes(scale), 'time', (v) => {
        const b = rawBytes(v);
        const ticks = readTimeTicks(b, 1, b[0]!, scale);
        return { type: 'TimeSpan', value: timeSpanText(ticks) };
      });
    }
    case 'DateTime2': {
      const scale = meta.scale ?? 7;
      return column(name, 'DateTime', timeBytes(scale) + 3, 'datetime2', (v) => {
        const b = rawBytes(v);
        return { type: 'DateTime', value: RpDateTime.fromTicks(readDateTime2Ticks(b, 1, b[0]!, scale)) };
      });
    }
    case 'DateTimeOffset': {
      const scale = meta.scale ?? 7;
      return column(name, 'DateTimeOffset', timeBytes(scale) + 5, 'datetimeoffset', (v) => {
        const b = rawBytes(v);
        return readDateTimeOffset(b, 1, b[0]!, scale);
      });
    }
    case 'Char':
      return column(name, 'String', length, 'char', asString);
    case 'VarChar':
      return column(name, 'String', length === MAX_LENGTH ? 2147483647 : length, 'varchar', asString);
    case 'NChar':
      return column(name, 'String', length / 2, 'nchar', asString);
    case 'NVarChar':
      return column(name, 'String', length === MAX_LENGTH ? 2147483647 : length / 2, 'nvarchar', asString);
    case 'Text':
      return column(name, 'String', 2147483647, 'text', asString);
    case 'NText':
      return column(name, 'String', 1073741823, 'ntext', asString);
    case 'Xml':
      return column(name, 'String', 2147483647, 'xml', (v) => ({ type: 'String', value: sqlXmlValue(v as string) }));
    case 'Binary':
      return column(name, 'Byte[]', length, meta.userType === UDT_TIMESTAMP ? 'timestamp' : 'binary', asBytes);
    case 'VarBinary':
      return column(name, 'Byte[]', length === MAX_LENGTH ? 2147483647 : length, meta.userType === UDT_TIMESTAMP ? 'timestamp' : 'varbinary', asBytes);
    case 'Image':
      return column(name, 'Byte[]', 2147483647, 'image', asBytes);
    case 'UniqueIdentifier':
      return column(name, 'Guid', 16, 'uniqueidentifier', (v) => ({ type: 'Guid', value: (v as string).toLowerCase() }));
    case 'Variant':
      return column(name, 'Object', 8009, 'sql_variant', (v) => readVariant(rawBytes(v)));
    case 'UDT': {
      // Without Microsoft.SqlServer.Types, GetSchemaTable gives the column no DataType (DBNull) and
      // the C# engine fails taking it as a Type; GetValue would fail loading the assembly
      const e = invalidCast("Unable to cast object of type 'System.DBNull' to type 'System.Type'.");
      (e as { cause?: unknown }).cause = udtNotLoaded(meta.udtInfo?.assemblyName ?? '', typeSystemAssemblyVersion);
      throw e;
    }
    default:
      throw notSupported(`The SQL Server type ${meta.type.name} (0x${meta.type.id.toString(16)}) of column '${name}' is not supported by the SQL Server driver of Report Manager.`);
  }
}

/**
 * SqlClient without Microsoft.SqlServer.Types: the assembly of a CLR type (hierarchyid, geometry,
 * geography) cannot be loaded, in the version of Type System Version (10.0.0.0, or 11.0.0.0 with
 * SQL Server 2012). In the SQL, CAST(col AS VARBINARY(MAX)) or col.ToString() read them.
 */
export function udtNotLoaded(assemblyQualifiedName: string, typeSystemAssemblyVersion: string): Error {
  const comma = assemblyQualifiedName.indexOf(',');
  let assembly = comma >= 0 ? assemblyQualifiedName.substring(comma + 1).trim() : assemblyQualifiedName;
  // SqlConnection.ResolveTypeAssembly: Microsoft.SqlServer.Types in the version of Type System Version
  if (/^Microsoft\.SqlServer\.Types\s*,/i.test(assembly)) assembly = assembly.replace(/Version=[^,]*/, 'Version=' + typeSystemAssemblyVersion);
  return fileNotFound(`Could not load file or assembly '${assembly}'. The system cannot find the file specified.`);
}

function asString(v: unknown): NetCell {
  return { type: 'String', value: v as string };
}

function asBytes(v: unknown): NetCell {
  const b = v as Buffer;
  return { type: 'Byte[]', value: new Uint8Array(b.buffer, b.byteOffset, b.length) };
}

function rawBytes(v: unknown): Buffer {
  if (v instanceof RawValue) return v.bytes;
  throw new Error('The SQL Server driver expected the bytes of a value from tedious');
}

function readUIntLE(b: Buffer, offset: number, length: number): bigint {
  let r = 0n;
  for (let i = length - 1; i >= 0; i--) r = (r << 8n) | BigInt(b[offset + i]!);
  return r;
}

/** money (8 bytes: high, low) and smallmoney (4) as SqlMoney → decimal: scale 4. */
export function readMoney(b: Buffer, offset: number, length: number): CsDecimal {
  let units: bigint;
  if (length === 4) units = BigInt(b.readInt32LE(offset));
  else units = (BigInt(b.readInt32LE(offset)) << 32n) | BigInt(b.readUInt32LE(offset + 4));
  return CsDecimal.fromParts(units < 0n ? -units : units, 4, units < 0n);
}

/** The number of trailing decimal zeros of a magnitude (0 has them all). */
function trailingZeros(mag: bigint): number {
  if (mag === 0n) return Number.MAX_SAFE_INTEGER;
  let n = 0;
  while (mag % 10n === 0n) {
    mag /= 10n;
    n++;
  }
  return n;
}

/**
 * SqlBuffer.Decimal: a SQL decimal as System.Decimal. Beyond its 96 bits or 28 decimals, the
 * trailing zeros are dropped (down to 28 decimals, or all of them when the magnitude is too big),
 * and what still does not fit fails: OverflowException "Conversion overflows.", or SqlTypeException
 * "Invalid numeric precision/scale." when there are more zeros than decimals to drop.
 */
export function sqlDecimal(mag: bigint, scale: number, negative: boolean): CsDecimal {
  if (mag < TWO96 && scale <= 28) return CsDecimal.fromParts(mag, scale, negative);
  if (scale > 0) {
    const zeros = trailingZeros(mag);
    if (zeros > 0) {
      let newScale: number;
      if (scale > 28) {
        if (zeros < scale - 28) throw overflowException(CONVERSION_OVERFLOWS);
        newScale = 28;
      } else newScale = scale - zeros;
      if (newScale < 0) throw sqlTypeException('Invalid numeric precision/scale.');
      const m = mag / 10n ** BigInt(scale - newScale);
      if (m >= TWO96) throw overflowException(CONVERSION_OVERFLOWS);
      return CsDecimal.fromParts(m, newScale, negative);
    }
  }
  throw overflowException(CONVERSION_OVERFLOWS);
}

/** decimal/numeric: a sign byte (1 positive) and the little-endian magnitude. */
function readDecimal(b: Buffer, offset: number, magnitudeLength: number, scale: number): CsDecimal {
  const positive = b[offset] === 1;
  return sqlDecimal(readUIntLE(b, offset + 1, magnitudeLength), scale, !positive);
}

/** SqlTypeWorkarounds.SqlDateTimeToDateTime: days since 1900 and 1/300 s, rounded to milliseconds. */
export function sqlDateTimeTicks(days: number, time: number): bigint {
  const ms = BigInt(Math.trunc(time / 0.3 + 0.5));
  return SQL_BASE_TICKS + BigInt(days) * TICKS_PER_DAY + ms * TICKS_PER_MS;
}

/** datetime (8 bytes) and smalldatetime (4 bytes: days, minutes). */
function readDateTime(b: Buffer, offset: number, length: number): RpDateTime {
  if (length === 4) {
    const days = b.readUInt16LE(offset);
    const minutes = b.readUInt16LE(offset + 2);
    return RpDateTime.fromTicks(sqlDateTimeTicks(days, minutes * 18000));
  }
  return RpDateTime.fromTicks(sqlDateTimeTicks(b.readInt32LE(offset), b.readUInt32LE(offset + 4)));
}

function readDays(b: Buffer, offset: number): bigint {
  return BigInt(b[offset]! | (b[offset + 1]! << 8) | (b[offset + 2]! << 16));
}

/** date: 3 bytes of days since 0001-01-01. */
function readDate(b: Buffer, offset: number): RpDateTime {
  return RpDateTime.fromTicks(readDays(b, offset) * TICKS_PER_DAY);
}

/** The time of time, datetime2 and datetimeoffset in ticks: its units are 10^-scale s. */
function timeTicks(b: Buffer, offset: number, scale: number): bigint {
  const units = readUIntLE(b, offset, timeBytes(scale));
  return units * 10n ** BigInt(7 - scale);
}

function readTimeTicks(b: Buffer, offset: number, _length: number, scale: number): bigint {
  return timeTicks(b, offset, scale);
}

function readDateTime2Ticks(b: Buffer, offset: number, _length: number, scale: number): bigint {
  const t = timeTicks(b, offset, scale);
  return readDays(b, offset + timeBytes(scale)) * TICKS_PER_DAY + t;
}

/** datetimeoffset: the UTC date and time and the offset in minutes. */
function readDateTimeOffset(b: Buffer, offset: number, _length: number, scale: number): NetCell {
  const utc = readDateTime2Ticks(b, offset, _length, scale);
  const minutes = b.readInt16LE(offset + timeBytes(scale) + 3);
  return dateTimeOffsetCell(utc, minutes);
}

/** A DateTimeOffset: the engine takes its LocalDateTime; golden-cs prints its invariant text. */
export function dateTimeOffsetCell(utcTicks: bigint, offsetMinutes: number): NetCell {
  return {
    type: 'DateTimeOffset',
    value: localDateTime(utcTicks),
    invariantText: dateTimeOffsetInvariantText(utcTicks + BigInt(offsetMinutes) * TICKS_PER_MINUTE, offsetMinutes),
  };
}

/**
 * The standard offset of the local time zone (minutes east of UTC): what .NET applies to the dates
 * before the rules of the zone, where the time zone database of JavaScript gives the local mean time.
 */
function baseUtcOffsetMinutes(): number {
  const year = new Date().getFullYear();
  const jan = -new Date(year, 0, 1).getTimezoneOffset();
  const jul = -new Date(year, 6, 1).getTimezoneOffset();
  return Math.min(jan, jul);
}

/** DateTimeOffset.LocalDateTime (UtcDateTime.ToLocalTime: clamped to the DateTime range). */
export function localDateTime(utcTicks: bigint): RpDateTime {
  const ms = Number((utcTicks - UNIX_EPOCH_TICKS) / TICKS_PER_MS);
  const date = new Date(ms);
  let offset = -date.getTimezoneOffset();
  if (date.getUTCFullYear() < 1900 || !Number.isInteger(offset)) offset = baseUtcOffsetMinutes();
  let ticks = utcTicks + BigInt(Math.round(offset * 60)) * 10_000_000n;
  if (ticks > MAX_TICKS) ticks = MAX_TICKS;
  if (ticks < 0n) ticks = 0n;
  return RpDateTime.fromTicks(ticks, DateTimeKind.Local);
}

function pad(n: number | bigint, width: number): string {
  return String(n).padStart(width, '0');
}

/** DateTimeOffset.ToString(InvariantCulture): MM/dd/yyyy HH:mm:ss zzz. */
function dateTimeOffsetInvariantText(clockTicks: bigint, offsetMinutes: number): string {
  const d = RpDateTime.fromTicks(clockTicks);
  const sign = offsetMinutes < 0 ? '-' : '+';
  const abs = Math.abs(offsetMinutes);
  return (
    `${pad(d.month, 2)}/${pad(d.day, 2)}/${pad(d.year, 4)} ${pad(d.hour, 2)}:${pad(d.minute, 2)}:${pad(d.second, 2)} ` +
    `${sign}${pad(Math.floor(abs / 60), 2)}:${pad(abs % 60, 2)}`
  );
}

/** TimeSpan.ToString() ("c"): [-][d.]hh:mm:ss[.fffffff]. */
export function timeSpanText(ticks: bigint): string {
  const negative = ticks < 0n;
  let t = negative ? -ticks : ticks;
  const days = t / TICKS_PER_DAY;
  t %= TICKS_PER_DAY;
  const h = t / 36_000_000_000n;
  t %= 36_000_000_000n;
  const mi = t / 600_000_000n;
  t %= 600_000_000n;
  const s = t / 10_000_000n;
  const f = t % 10_000_000n;
  return (negative ? '-' : '') + (days > 0n ? String(days) + '.' : '') + pad(h, 2) + ':' + pad(mi, 2) + ':' + pad(s, 2) + (f > 0n ? '.' + pad(f, 7) : '');
}

/** A Guid of 16 bytes (the first three groups little-endian), as Guid.ToString(): lower case "D". */
function guidText(b: Buffer, offset: number): string {
  const h = (i: number): string => b[offset + i]!.toString(16).padStart(2, '0');
  return (
    h(3) + h(2) + h(1) + h(0) + '-' + h(5) + h(4) + '-' + h(7) + h(6) + '-' + h(8) + h(9) + '-' + h(10) + h(11) + h(12) + h(13) + h(14) + h(15)
  );
}

/** A sql_variant value: its base type, its properties and its data, as the .NET value of the base type. */
export function readVariant(b: Buffer): NetCell {
  const total = b.readUInt32LE(0);
  const baseType = b[4]!;
  const propBytes = b[5]!;
  const p = 6;
  const data = p + propBytes;
  const dataLength = total - 2 - propBytes;
  switch (baseType) {
    case 0x30:
      return { type: 'Byte', value: b[data]! };
    case 0x34:
      return { type: 'Int16', value: b.readInt16LE(data) };
    case 0x38:
      return { type: 'Int32', value: b.readInt32LE(data) };
    case 0x7f:
      return { type: 'Int64', value: b.readBigInt64LE(data) };
    case 0x32:
      return { type: 'Boolean', value: b[data] !== 0 };
    case 0x3b:
      return { type: 'Single', value: b.readFloatLE(data) };
    case 0x3e:
      return { type: 'Double', value: b.readDoubleLE(data) };
    case 0x3c:
      return { type: 'Decimal', value: readMoney(b, data, 8) };
    case 0x7a:
      return { type: 'Decimal', value: readMoney(b, data, 4) };
    case 0x3d:
      return { type: 'DateTime', value: readDateTime(b, data, 8) };
    case 0x3a:
      return { type: 'DateTime', value: readDateTime(b, data, 4) };
    case 0x24:
      return { type: 'Guid', value: guidText(b, data) };
    case 0x6a:
    case 0x6c: {
      const scale = b[p + 1]!;
      return { type: 'Decimal', value: readDecimal(b, data, dataLength - 1, scale) };
    }
    case 0xa5:
    case 0xad:
      return { type: 'Byte[]', value: new Uint8Array(b.subarray(data, data + dataLength)) };
    case 0xa7:
    case 0xaf: {
      const codepage = Collation.fromBuffer(b, p).codepage ?? 'CP1252';
      return { type: 'String', value: iconv.decode(b.subarray(data, data + dataLength), codepage) };
    }
    case 0xe7:
    case 0xef:
      return { type: 'String', value: b.toString('utf16le', data, data + dataLength) };
    case 0x28:
      return { type: 'DateTime', value: readDate(b, data) };
    case 0x29:
      return { type: 'TimeSpan', value: timeSpanText(timeTicks(b, data, b[p]!)) };
    case 0x2a:
      return { type: 'DateTime', value: RpDateTime.fromTicks(readDateTime2Ticks(b, data, dataLength, b[p]!)) };
    case 0x2b: {
      const scale = b[p]!;
      const utc = readDateTime2Ticks(b, data, dataLength, scale);
      return dateTimeOffsetCell(utc, b.readInt16LE(data + timeBytes(scale) + 3));
    }
    default:
      throw notSupported(`The sql_variant base type 0x${baseType.toString(16)} is not supported by the SQL Server driver of Report Manager.`);
  }
}
