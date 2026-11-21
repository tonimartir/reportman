// The columns of a result as FirebirdClient gives them to the C# engine: the column name, the .NET
// type of its values (FbDataReader.GetFieldType), its ColumnSize, and each value as FbDataReader
// reads it, then turned into the value the engine stores for that .NET type.
//
// The .NET types without a DataColumnType of the engine become what Variant.AssignFromObject of the
// C# engine makes of them: BigInteger (INT128) a Long, and the types it has no slot for (TimeSpan,
// Guid, FbZonedDateTime, FbZonedTime, FbDecFloat) their text, Convert.ToString under the current
// culture. Those columns are 'Object' columns, so their text keeps no MaxLength, as in C#.

import {
  CsDecimal,
  CultureInfo,
  type DataColumnInfo,
  type DataColumnType,
  type DataValue,
  DateTimeKind,
  formatDateTime,
  NetException,
  RpDateTime,
} from 'reportman-engine';
import { decFloatText, decodeDec16, decodeDec34 } from './decfloat.js';
import { FIRST_TIME_ZONE_ID, TIME_ZONE_NAMES } from './timezones.js';
import {
  type Charset,
  charCount,
  columnSize,
  DbDataType,
  dbDataType,
  decodeText,
  fieldCharset,
  type FieldDescription,
  invalidDataType,
  netTypeName,
  SqlType,
} from './types.js';
import type { SqlVar, XdrReader } from './wire.js';

/** A raw wire value kept by the driver's decoders (see installRawDecoders). */
export class RawValue {
  readonly a: number | bigint | Uint8Array;
  readonly b: number;
  readonly c: number;
  readonly d: number | null;
  constructor(a: number | bigint | Uint8Array, b = 0, c = 0, d: number | null = null) {
    this.a = a;
    this.b = b;
    this.c = c;
    this.d = d;
  }
}

function nullFlag(data: XdrReader, lowerV13: boolean): boolean {
  return lowerV13 && data.readInt() !== 0;
}

function copy(b: Buffer | undefined): Uint8Array {
  return b === undefined ? new Uint8Array(0) : new Uint8Array(b);
}

function need(data: XdrReader, n: number): void {
  // A row may span packets: node-firebird decodes it again once the rest arrives (a RangeError)
  if (data.pos + n > data.buffer.length) throw new RangeError('Packet is not complete');
}

/** A decoder that keeps the raw value of a field, for each SQL type the driver converts itself. */
function rawDecoder(v: SqlVar): SqlVar['decode'] | undefined {
  switch (v.type) {
    case SqlType.TEXT:
      return (data, lowerV13) => {
        need(data, v.length);
        const r = new RawValue(copy(data.readBuffer(v.length)));
        return nullFlag(data, lowerV13) ? null : r;
      };
    case SqlType.VARYING:
      return (data, lowerV13) => {
        need(data, 4);
        const len = data.buffer.readInt32BE(data.pos);
        need(data, 4 + len);
        const r = new RawValue(copy(data.readArray()));
        return nullFlag(data, lowerV13) ? null : r;
      };
    case SqlType.SHORT:
    case SqlType.LONG:
    case SqlType.TYPE_DATE:
      return (data, lowerV13) => {
        const r = new RawValue(data.readInt());
        return nullFlag(data, lowerV13) ? null : r;
      };
    case SqlType.TYPE_TIME:
      return (data, lowerV13) => {
        const r = new RawValue(data.readInt());
        return nullFlag(data, lowerV13) ? null : r;
      };
    case SqlType.TIMESTAMP:
      return (data, lowerV13) => {
        const date = data.readInt();
        const r = new RawValue(date, data.readInt());
        return nullFlag(data, lowerV13) ? null : r;
      };
    case SqlType.INT64:
      return (data, lowerV13) => {
        const r = new RawValue(data.readInt64BigInt());
        return nullFlag(data, lowerV13) ? null : r;
      };
    case SqlType.INT128:
      return (data, lowerV13) => {
        const r = new RawValue(data.readInt128Signed());
        return nullFlag(data, lowerV13) ? null : r;
      };
    case SqlType.FLOAT:
      return (data, lowerV13) => {
        const r = new RawValue(data.readFloat());
        return nullFlag(data, lowerV13) ? null : r;
      };
    case SqlType.DOUBLE:
    case SqlType.D_FLOAT:
      return (data, lowerV13) => {
        const r = new RawValue(data.readDouble());
        return nullFlag(data, lowerV13) ? null : r;
      };
    case SqlType.BOOLEAN:
      return (data, lowerV13) => {
        need(data, 4);
        const r = new RawValue(data.buffer[data.pos]!);
        data.pos += 4;
        return nullFlag(data, lowerV13) ? null : r;
      };
    case SqlType.TIME_TZ:
    case SqlType.TIME_TZ_EX:
      return (data, lowerV13) => {
        const time = data.readInt();
        const zone = data.readInt() & 0xffff;
        const offset = v.type === SqlType.TIME_TZ_EX ? (data.readInt() << 16) >> 16 : null;
        const r = new RawValue(time, zone, 0, offset);
        return nullFlag(data, lowerV13) ? null : r;
      };
    case SqlType.TIMESTAMP_TZ:
    case SqlType.TIMESTAMP_TZ_EX:
      return (data, lowerV13) => {
        const date = data.readInt();
        const time = data.readInt();
        const zone = data.readInt() & 0xffff;
        const offset = v.type === SqlType.TIMESTAMP_TZ_EX ? (data.readInt() << 16) >> 16 : null;
        const r = new RawValue(date, time, zone, offset);
        return nullFlag(data, lowerV13) ? null : r;
      };
    case SqlType.DEC16:
      return (data, lowerV13) => {
        need(data, 8);
        const r = new RawValue(copy(data.readBuffer(8, false)));
        return nullFlag(data, lowerV13) ? null : r;
      };
    case SqlType.DEC34:
      return (data, lowerV13) => {
        need(data, 16);
        const r = new RawValue(copy(data.readBuffer(16, false)));
        return nullFlag(data, lowerV13) ? null : r;
      };
    default:
      // BLOB keeps the decoder of node-firebird (a blob id it turns into a reader), ARRAY too
      return undefined;
  }
}

/** blr_dec64, blr_dec128: no scale follows them (node-firebird writes one, and the server refuses it). */
const BLR_DEC64 = 24;
const BLR_DEC128 = 25;

/** Gives the output fields of a statement the raw decoders. */
export function installRawDecoders(output: readonly SqlVar[]): void {
  for (const v of output) {
    const d = rawDecoder(v);
    if (d !== undefined) v.decode = d;
    if (v.type === SqlType.DEC16) v.calcBlr = (blr) => blr.addByte(BLR_DEC64);
    if (v.type === SqlType.DEC34) v.calcBlr = (blr) => blr.addByte(BLR_DEC128);
  }
}

// ---------------------------------------------------------------------------------------------
// Values

const MJD_EPOCH_DAYS = RpDateTime.create(1858, 11, 17).days;
const TICKS_PER_DAY = 864_000_000_000n;

/** TypeDecoder.DecodeDate: the date of a Firebird day number. */
export function decodeDate(sqlDate: number): RpDateTime {
  return RpDateTime.fromTicks(BigInt(sqlDate + MJD_EPOCH_DAYS) * TICKS_PER_DAY);
}

/** TypeDecoder.DecodeDate + DecodeTime. */
export function decodeTimestamp(sqlDate: number, sqlTime: number, kind = DateTimeKind.Unspecified): RpDateTime {
  return RpDateTime.fromTicks(BigInt(sqlDate + MJD_EPOCH_DAYS) * TICKS_PER_DAY + BigInt(sqlTime) * 1000n, kind);
}

function p2(n: number): string {
  return String(n).padStart(2, '0');
}

/** TimeSpan.ToString() ("c": [-][d.]hh:mm:ss[.fffffff]) of a number of ticks. */
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
  let s = (negative ? '-' : '') + (days > 0n ? days.toString() + '.' : '') + p2(hours) + ':' + p2(minutes) + ':' + p2(seconds);
  if (fraction !== 0) s += '.' + String(fraction).padStart(7, '0');
  return s;
}

/** TypeHelper.CreateZonedDateTime / CreateZonedTime: the name of a time zone id. */
function timeZoneName(id: number): string {
  const index = FIRST_TIME_ZONE_ID - id;
  const name = index >= 0 ? TIME_ZONE_NAMES[index] : undefined;
  if (name === undefined) {
    throw new NetException('ArgumentException', 'Unknown time zone ID.');
  }
  return name;
}

function offsetText(offset: number | null): string {
  return offset === null ? '' : ' (' + timeSpanText(BigInt(offset) * 600_000_000n) + ')';
}

/** TypeDecoder.DecodeDecimal: a scaled integer as a decimal (ShiftDecimalLeft divides by ten). */
function decodeDecimal(raw: number | bigint, scale: number, sqlType: number): CsDecimal {
  if (sqlType === SqlType.DOUBLE || sqlType === SqlType.D_FLOAT) return CsDecimal.fromDouble(raw as number);
  let d = CsDecimal.fromInteger(raw);
  const ten = CsDecimal.fromInteger(10);
  for (let shift = Math.abs(scale); shift > 0; shift--) d = d.div(ten);
  return d;
}

/** The text of a Guid read from 16 bytes (TypeDecoder.DecodeGuid, Guid.ToString()). */
function guidText(bytes: Uint8Array): string {
  if (bytes.length < 16) {
    throw new NetException('ArgumentException', "Destination array is not long enough to copy all the items in the collection. Check array index and length. (Parameter 'value')");
  }
  const hex = Buffer.from(bytes.subarray(0, 16)).toString('hex');
  return hex.substring(0, 8) + '-' + hex.substring(8, 12) + '-' + hex.substring(12, 16) + '-' + hex.substring(16, 20) + '-' + hex.substring(20);
}

const INT64_MIN = -9223372036854775808n;
const INT64_MAX = 9223372036854775807n;

/** A column of a result: DataColumnInfo, and the .NET type FirebirdClient gives its values. */
export interface FirebirdColumnInfo extends DataColumnInfo {
  /** DataType of the schema table (Int32, Decimal, FbZonedDateTime, BigInteger...). */
  readonly netType: string;
}

/** A column of a result and how its raw values become engine values. */
export interface OutputColumn {
  readonly info: FirebirdColumnInfo;
  readonly dbType: DbDataType;
  readonly isBlob: boolean;
  /** The engine value of a raw cell (bytes of a blob already read). */
  convert(raw: unknown): DataValue;
}

/** What converting a value needs to know of the connection. */
export interface ConversionContext {
  /** The character set of the connection. */
  readonly charset: Charset;
  /** The culture FirebirdClient's .ToString() of a value runs under (CultureInfo.CurrentCulture). */
  readonly culture: CultureInfo;
}

function engineType(type: DbDataType): DataColumnType {
  switch (type) {
    case DbDataType.Char:
    case DbDataType.VarChar:
    case DbDataType.Text:
      return 'String';
    case DbDataType.Binary:
      return 'Binary';
    case DbDataType.SmallInt:
      return 'Int16';
    case DbDataType.Integer:
      return 'Int32';
    case DbDataType.BigInt:
    case DbDataType.Int128:
      return 'Int64';
    case DbDataType.Float:
      return 'Single';
    case DbDataType.Double:
      return 'Double';
    case DbDataType.Decimal:
    case DbDataType.Numeric:
      return 'Decimal';
    case DbDataType.Date:
    case DbDataType.TimeStamp:
      return 'DateTime';
    case DbDataType.Boolean:
      return 'Boolean';
    case DbDataType.Guid:
    case DbDataType.Time:
    case DbDataType.TimeStampTZ:
    case DbDataType.TimeStampTZEx:
    case DbDataType.TimeTZ:
    case DbDataType.TimeTZEx:
    case DbDataType.Dec16:
    case DbDataType.Dec34:
      return 'Object';
    default:
      throw invalidDataType(type);
  }
}

/** The description of an output field with the length the server gave. */
export function describe(v: SqlVar): FieldDescription {
  return { sqlType: v.type, subType: v.subType, scale: v.scale, length: v.nativeLength ?? v.length };
}

/** FbDataReader.GetName: the alias, else the field name. */
function columnName(v: SqlVar): string {
  const alias = (v.alias ?? '').trim();
  return alias.length > 0 ? alias : (v.field ?? '').trim();
}

/** The column of an output field. */
export function outputColumn(v: SqlVar, ctx: ConversionContext): OutputColumn {
  const field = describe(v);
  const dbType = dbDataType(field);
  if (dbType === DbDataType.Array) {
    throw new NetException(
      'NotSupportedException',
      'The column ' + columnName(v) + ' is a Firebird ARRAY: the Firebird driver of Report Manager does not read arrays',
    );
  }
  // FbDataReader.GetSchemaTable asks GetFieldType of every column: SQL_NULL has no .NET type
  const netType = netTypeName(dbType);
  const charset = fieldCharset(field);
  // GdsStatement.ReadRawValue: the text of the connection's character set unless it is NONE
  const inner = ctx.charset.id !== 0 ? ctx.charset : charset;
  const chars = charCount(field);
  const info: FirebirdColumnInfo = {
    name: columnName(v),
    type: engineType(dbType),
    size: columnSize(field, dbType),
    declaredType: null,
    netType,
  };
  const sqlType = field.sqlType;
  let convert: (raw: unknown) => DataValue;
  switch (dbType) {
    case DbDataType.Char:
      convert = (raw) => {
        const bytes = (raw as RawValue).a as Uint8Array;
        if (charset.id === 1) return bytes.subarray(0, field.length);
        let s = decodeText(bytes.subarray(0, field.length), inner);
        if (field.length % charset.bytesPerCharacter === 0 && s.length > chars) s = s.substring(0, chars);
        return s;
      };
      break;
    case DbDataType.VarChar:
      convert = (raw) => {
        const bytes = (raw as RawValue).a as Uint8Array;
        return charset.id === 1 ? bytes : decodeText(bytes, inner);
      };
      break;
    case DbDataType.Guid:
      convert = (raw) => guidText((raw as RawValue).a as Uint8Array);
      break;
    case DbDataType.SmallInt:
      convert = (raw) => ((((raw as RawValue).a as number) << 16) >> 16);
      break;
    case DbDataType.Integer:
      convert = (raw) => (raw as RawValue).a as number;
      break;
    case DbDataType.BigInt:
      convert = (raw) => {
        const x = (raw as RawValue).a;
        return typeof x === 'bigint' ? x : BigInt(x as number);
      };
      break;
    case DbDataType.Int128:
      convert = (raw) => {
        // BigInteger: Variant.AssignFromObject makes it a Long (Convert.ToInt64 of its text)
        const x = (raw as RawValue).a as bigint;
        if (x < INT64_MIN || x > INT64_MAX) {
          throw new NetException('OverflowException', 'Value was either too large or too small for an Int64.');
        }
        return x;
      };
      break;
    case DbDataType.Decimal:
    case DbDataType.Numeric:
      convert = (raw) => {
        const x = (raw as RawValue).a as number | bigint;
        return decodeDecimal(sqlType === SqlType.SHORT ? ((x as number) << 16) >> 16 : x, field.scale, sqlType);
      };
      break;
    case DbDataType.Float:
    case DbDataType.Double:
      convert = (raw) => (raw as RawValue).a as number;
      break;
    case DbDataType.Date:
      convert = (raw) => decodeDate((raw as RawValue).a as number);
      break;
    case DbDataType.TimeStamp:
      convert = (raw) => {
        const r = raw as RawValue;
        return decodeTimestamp(r.a as number, r.b);
      };
      break;
    case DbDataType.Time:
      convert = (raw) => timeSpanText(BigInt((raw as RawValue).a as number) * 1000n);
      break;
    case DbDataType.Boolean:
      convert = (raw) => (raw as RawValue).a !== 0;
      break;
    case DbDataType.TimeTZ:
    case DbDataType.TimeTZEx:
      convert = (raw) => {
        // FbZonedTime.ToString: "{Time} {TimeZone}" (the time in UTC)
        const r = raw as RawValue;
        return timeSpanText(BigInt(r.a as number) * 1000n) + ' ' + timeZoneName(r.b) + offsetText(r.d);
      };
      break;
    case DbDataType.TimeStampTZ:
    case DbDataType.TimeStampTZEx:
      convert = (raw) => {
        // FbZonedDateTime.ToString: "{DateTime} {TimeZone}", the UTC date and time in the current culture
        const r = raw as RawValue;
        const utc = decodeTimestamp(r.a as number, r.b, DateTimeKind.Utc);
        const zone = timeZoneName(r.c);
        return formatDateTime(utc, '', ctx.culture) + ' ' + zone + offsetText(r.d);
      };
      break;
    case DbDataType.Dec16:
      convert = (raw) => decFloatText(decodeDec16((raw as RawValue).a as Uint8Array));
      break;
    case DbDataType.Dec34:
      convert = (raw) => decFloatText(decodeDec34((raw as RawValue).a as Uint8Array));
      break;
    case DbDataType.Text:
      // the bytes of a text blob, in the character set of the connection (BlobBase.ReadString)
      convert = (raw) => decodeText(raw as Uint8Array, ctx.charset);
      break;
    case DbDataType.Binary:
      convert = (raw) => raw as Uint8Array;
      break;
    default:
      throw invalidDataType(dbType);
  }
  return { info, dbType, isBlob: dbType === DbDataType.Text || dbType === DbDataType.Binary, convert };
}
