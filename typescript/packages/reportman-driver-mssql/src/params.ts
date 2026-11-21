// The parameters of a command as SqlClient sends them: each IDbDataParameter of the C# engine gets
// the SqlDbType of its DbType (SqlParameter.DbType → MetaType.GetMetaTypeFromDbType: Object is
// sql_variant, String nvarchar, DateTime datetime...), its value is converted to that type
// (SqlParameter.CoerceValue: Convert.ChangeType under the current culture), the declaration of
// sp_executesql is the one SqlCommand.BuildParamList writes ("@A int,@B nvarchar(3),@C decimal(3,2)"),
// and the value goes in the TDS form of the type, a value SqlClient has none for (C# null) with the
// DEFAULT flag: the server then answers "expects the parameter '@A', which was not supplied", as it
// does for the C# engine.

import {
  CsDecimal,
  CultureInfo,
  formatDateTime,
  formatDecimal,
  formatDouble,
  NetException,
  NumberStyles,
  parseDateTime,
  parseDecimal,
  parseDouble,
  type DataValue,
  type ParameterDbType,
  type ParameterValueType,
  type QueryParameter,
  RpDateTime,
  tryParseInt64,
} from '@reportman/engine';
import { argumentException, formatException, invalidCast, overflowException, sqlTypeException } from './errors.js';
import type { RawParameterValue } from './raw.js';

/** The SqlDbType a parameter is sent as (its MetaType). */
export type SqlMetaType = 'Variant' | 'Bit' | 'TinyInt' | 'Int' | 'BigInt' | 'Decimal' | 'Float' | 'DateTime' | 'NVarChar' | 'VarBinary';

/** The .NET types of the values a parameter can hold (ParameterValueType but Null and DBNull). */
type ClrType = 'Boolean' | 'Byte' | 'Char' | 'Int32' | 'Int64' | 'Decimal' | 'Double' | 'DateTime' | 'String' | 'Byte[]';

/** MetaType.GetMetaTypeFromDbType for the DbTypes of the engine. */
export function metaTypeOf(dbType: ParameterDbType): SqlMetaType {
  switch (dbType) {
    case 'Object':
      return 'Variant';
    case 'Boolean':
      return 'Bit';
    case 'Byte':
      return 'TinyInt';
    case 'Int32':
      return 'Int';
    case 'Int64':
      return 'BigInt';
    case 'Decimal':
      return 'Decimal';
    case 'Double':
      return 'Float';
    case 'DateTime':
      return 'DateTime';
    case 'Binary':
      return 'VarBinary';
    case 'String':
      return 'NVarChar';
    case 'SByte':
      // a Char variant (Variant.GetDbType): SqlClient has no SqlDbType for it
      throw argumentException('No mapping exists from DbType SByte to a known SqlDbType.');
  }
}

/** The .NET class of the values of a MetaType (MetaType.ClassType); null for sql_variant (object). */
const CLASS_TYPE: Readonly<Record<SqlMetaType, ClrType | null>> = {
  Variant: null,
  Bit: 'Boolean',
  TinyInt: 'Byte',
  Int: 'Int32',
  BigInt: 'Int64',
  Decimal: 'Decimal',
  Float: 'Double',
  DateTime: 'DateTime',
  NVarChar: 'String',
  VarBinary: 'Byte[]',
};

/** The .NET type of a parameter value. */
function clrTypeOf(valueType: ParameterValueType, value: DataValue): ClrType {
  switch (valueType) {
    case 'Boolean':
    case 'Byte':
    case 'Char':
    case 'Int32':
    case 'Int64':
    case 'Decimal':
    case 'Double':
    case 'DateTime':
    case 'String':
      return valueType;
    case 'Binary':
      return 'Byte[]';
    default:
      // an Object column of the master: the type of the JavaScript value
      if (typeof value === 'string') return 'String';
      if (typeof value === 'bigint') return 'Int64';
      if (typeof value === 'boolean') return 'Boolean';
      if (typeof value === 'number') return Number.isInteger(value) && Math.abs(value) <= 2147483647 ? 'Int32' : 'Double';
      if (value instanceof Uint8Array) return 'Byte[]';
      if (value instanceof CsDecimal) return 'Decimal';
      return 'DateTime';
  }
}

/** A value with its .NET type. */
interface Typed {
  type: ClrType;
  value: boolean | number | bigint | string | CsDecimal | RpDateTime | Uint8Array;
}

function asTyped(type: ClrType, value: DataValue): Typed {
  if (value instanceof Date) return { type, value: RpDateTime.fromJsDate(value) };
  return { type, value: value as Typed['value'] };
}

// ---------------------------------------------------------------------------------------------
// Convert.ChangeType(value, type, null): the IConvertible conversions under the current culture

const OVERFLOW: Readonly<Record<string, string>> = {
  Byte: 'Value was either too large or too small for an unsigned byte.',
  Int32: 'Value was either too large or too small for an Int32.',
  Int64: 'Value was either too large or too small for an Int64.',
  Decimal: 'Value was either too large or too small for a Decimal.',
};

function invalidCastFrom(from: ClrType, to: ClrType): NetException {
  if (from === 'Byte[]') return invalidCast('Object must implement IConvertible.');
  return invalidCast(`Invalid cast from '${from}' to '${to}'.`);
}

/** Convert.ToInt32(double) and friends: rounded half to even, then the range of the type. */
function roundDouble(v: number, min: number, max: number, to: string): bigint {
  if (!(v >= min - 0.5 && v < max + 0.5)) throw overflowException(OVERFLOW[to]!);
  const r = Math.round(v);
  const fixed = Math.abs(v - Math.trunc(v)) === 0.5 && r % 2 !== 0 ? r - 1 : r;
  return BigInt(fixed);
}

/** decimal.Round(value, 0) to even, as Convert.ToInt32(decimal) does. */
function roundDecimal(d: CsDecimal): bigint {
  const pow = 10n ** BigInt(d.scale);
  let q = d.mag / pow;
  const r = d.mag % pow;
  const twice = r * 2n;
  if (twice > pow || (twice === pow && q % 2n === 1n)) q++;
  return d.negative ? -q : q;
}

function toInteger(t: Typed, to: 'Byte' | 'Int32' | 'Int64', culture: CultureInfo): bigint {
  const [min, max] = to === 'Byte' ? [0n, 255n] : to === 'Int32' ? [-2147483648n, 2147483647n] : [-9223372036854775808n, 9223372036854775807n];
  let r: bigint;
  switch (t.type) {
    case 'Boolean':
      return t.value ? 1n : 0n;
    case 'Byte':
    case 'Int32':
      r = BigInt(t.value as number);
      break;
    case 'Char':
      r = BigInt((t.value as string).charCodeAt(0));
      break;
    case 'Int64':
      r = t.value as bigint;
      break;
    case 'Double':
      r = roundDouble(t.value as number, Number(min), Number(max), to);
      break;
    case 'Decimal':
      r = roundDecimal(t.value as CsDecimal);
      break;
    case 'String': {
      const parsed = tryParseInt64(t.value as string, NumberStyles.Integer, culture.number);
      if (parsed === undefined) {
        // Int32.Parse: a number too big for Int64 overflows too; anything else is a format error
        if (/^\s*[+-]?\d+\s*$/.test(t.value as string)) throw overflowException(OVERFLOW[to]!);
        throw formatException(`The input string '${t.value as string}' was not in a correct format.`);
      }
      r = parsed;
      break;
    }
    default:
      throw invalidCastFrom(t.type, to);
  }
  if (r < min || r > max) throw overflowException(OVERFLOW[to]!);
  return r;
}

function toBoolean(t: Typed): boolean {
  switch (t.type) {
    case 'Byte':
    case 'Int32':
    case 'Double':
      return (t.value as number) !== 0;
    case 'Int64':
      return (t.value as bigint) !== 0n;
    case 'Decimal':
      return !(t.value as CsDecimal).isZero;
    case 'String': {
      const s = (t.value as string).trim().toLowerCase();
      if (s === 'true') return true;
      if (s === 'false') return false;
      throw formatException(`String '${t.value as string}' was not recognized as a valid Boolean.`);
    }
    default:
      throw invalidCastFrom(t.type, 'Boolean');
  }
}

function toDecimal(t: Typed, culture: CultureInfo): CsDecimal {
  switch (t.type) {
    case 'Boolean':
      return t.value ? CsDecimal.one : CsDecimal.zero;
    case 'Byte':
    case 'Int32':
      return CsDecimal.fromInteger(t.value as number);
    case 'Int64':
      return CsDecimal.fromInteger(t.value as bigint);
    case 'Double':
      try {
        return CsDecimal.fromDouble(t.value as number);
      } catch {
        throw overflowException(OVERFLOW.Decimal!);
      }
    case 'String':
      return parseDecimal(t.value as string, NumberStyles.Number, culture.number);
    default:
      throw invalidCastFrom(t.type, 'Decimal');
  }
}

function toDouble(t: Typed, culture: CultureInfo): number {
  switch (t.type) {
    case 'Boolean':
      return t.value ? 1 : 0;
    case 'Byte':
    case 'Int32':
      return t.value as number;
    case 'Int64':
      return Number(t.value as bigint);
    case 'Decimal':
      return (t.value as CsDecimal).toDouble();
    case 'String':
      return parseDouble(t.value as string, NumberStyles.Float | NumberStyles.AllowThousands, culture.number);
    default:
      throw invalidCastFrom(t.type, 'Double');
  }
}

function toDateTime(t: Typed, culture: CultureInfo): RpDateTime {
  if (t.type === 'String') return parseDateTime(t.value as string, culture);
  throw invalidCastFrom(t.type, 'DateTime');
}

/** IConvertible.ToString(null): the text of the value under the current culture. */
function toText(t: Typed, culture: CultureInfo): string {
  switch (t.type) {
    case 'Boolean':
      return t.value ? 'True' : 'False';
    case 'Byte':
    case 'Int32':
      return String(t.value);
    case 'Int64':
      return (t.value as bigint).toString();
    case 'Char':
    case 'String':
      return t.value as string;
    case 'Double':
      return formatDouble(t.value as number, '', culture.number);
    case 'Decimal':
      return formatDecimal(t.value as CsDecimal, '', culture.number);
    case 'DateTime':
      return formatDateTime(t.value as RpDateTime, '', culture);
    default:
      throw invalidCastFrom(t.type, 'String');
  }
}

/**
 * SqlParameter.CoerceValue: the value converted to the class of the MetaType; a value that cannot
 * be converted fails with ADP.ParameterConversionFailed, an exception of the type of the inner one.
 */
function coerce(t: Typed, meta: SqlMetaType, culture: CultureInfo): Typed {
  const target = CLASS_TYPE[meta];
  if (target === null || target === t.type) return t;
  try {
    switch (target) {
      case 'Boolean':
        return { type: target, value: toBoolean(t) };
      case 'Byte':
      case 'Int32':
        return { type: target, value: Number(toInteger(t, target, culture)) };
      case 'Int64':
        return { type: target, value: toInteger(t, target, culture) };
      case 'Decimal':
        return { type: target, value: toDecimal(t, culture) };
      case 'Double':
        return { type: target, value: toDouble(t, culture) };
      case 'DateTime':
        return { type: target, value: toDateTime(t, culture) };
      case 'String':
        return { type: target, value: toText(t, culture) };
      default:
        throw invalidCastFrom(t.type, target);
    }
  } catch (e) {
    const message = `Failed to convert parameter value from a ${t.type} to a ${target}.`;
    const netType = e instanceof NetException ? e.netType : '';
    let error: NetException;
    if (netType === 'FormatException' || netType === 'InvalidCastException' || netType === 'OverflowException' || netType === 'ArgumentException') {
      error = new NetException(netType, message);
    } else throw e;
    (error as { cause?: unknown }).cause = e;
    throw error;
  }
}

// ---------------------------------------------------------------------------------------------
// Sizes, precision and the declaration (SqlCommand.BuildParamList)

/** SqlParameter.ValueSizeCore of the value as assigned (not converted). */
function valueSize(t: Typed | null): number {
  if (t === null) return 0;
  if (t.type === 'String') return (t.value as string).length;
  if (t.type === 'Byte[]') return (t.value as Uint8Array).length;
  if (t.type === 'Byte' || t.type === 'Char') return 1;
  return 0;
}

/** SqlDecimal(decimal).Precision: the digits of the mantissa, at least the scale (and 1). */
export function decimalPrecision(d: CsDecimal): number {
  const digits = d.mag === 0n ? 1 : d.mag.toString().length;
  return Math.max(digits, d.scale);
}

/** A parameter ready to be sent. */
export interface BoundParameter {
  /** The name without '@' (tedious writes it with one). */
  readonly name: string;
  /** Its piece of the @params of sp_executesql ("@A int"). */
  readonly declaration: string;
  readonly raw: RawParameterValue;
}

/** What the parameters need of the connection. */
export interface BindContext {
  /** CultureInfo.CurrentCulture of the C# engine (Convert.ChangeType). */
  readonly culture: CultureInfo;
  /** The 5 bytes of the collation of the database (strings are sent with it). */
  readonly collation: Buffer;
}

// TDS type ids
const INTN = 0x26;
const BITN = 0x68;
const FLTN = 0x6d;
const DECIMALN = 0x6a;
const DATETIMN = 0x6f;
const NVARCHAR = 0xe7;
const BIGVARBIN = 0xa5;
const SSVARIANT = 0x62;
const TYPE_SIZE_LIMIT = 8000;

const PLP_NULL = Buffer.from([0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff]);
const PLP_TERMINATOR = Buffer.alloc(4);

/** A PLP value (the max types): its length, one chunk and the terminator. */
function plp(data: Buffer): Buffer {
  const head = Buffer.alloc(8);
  head.writeBigUInt64LE(BigInt(data.length));
  if (data.length === 0) return Buffer.concat([head, PLP_TERMINATOR]);
  const chunk = Buffer.alloc(4);
  chunk.writeUInt32LE(data.length);
  return Buffer.concat([head, chunk, data, PLP_TERMINATOR]);
}

function u16(n: number): Buffer {
  const b = Buffer.alloc(2);
  b.writeUInt16LE(n);
  return b;
}

/** The 16 bytes of the magnitude of a decimal, little-endian. */
function magnitude(d: CsDecimal): Buffer {
  const b = Buffer.alloc(16);
  let m = d.mag;
  for (let i = 0; i < 16; i++) {
    b[i] = Number(m & 0xffn);
    m >>= 8n;
  }
  return b;
}

const MIN_SQL_DATETIME_TICKS = 552_877_920_000_000_000n; // 1753-01-01
const MAX_SQL_DATETIME_TICKS = 3_155_378_975_999_970_000n; // 9999-12-31 23:59:59.997
const SQL_BASE_TICKS = 599_266_080_000_000_000n; // 1900-01-01
const TICKS_PER_DAY = 864_000_000_000n;
const MAX_DATETIME_TICKS = 3_155_378_975_999_999_999n;

/** new SqlDateTime(DateTime): the days since 1900 and the 1/300 s of the day. */
export function sqlDateTime(dt: RpDateTime): { days: number; time: number } {
  const ticks = dt.ticks;
  // DateTime.MaxValue is SqlDateTime.MaxValue
  if (ticks === MAX_DATETIME_TICKS) return { days: 2958463, time: 25919999 };
  if (ticks < MIN_SQL_DATETIME_TICKS || ticks > MAX_SQL_DATETIME_TICKS) {
    throw sqlTypeException('SqlDateTime overflow. Must be between 1/1/1753 12:00:00 AM and 12/31/9999 11:59:59 PM.');
  }
  const span = ticks - SQL_BASE_TICKS;
  let day = span / TICKS_PER_DAY;
  let rest = span - day * TICKS_PER_DAY;
  if (rest < 0n) {
    day--;
    rest += TICKS_PER_DAY;
  }
  let time = Math.trunc((Number(rest) / 10000) * 0.3 + 0.5);
  if (time > 25919999) {
    time = 0;
    day++;
  }
  return { days: Number(day), time };
}

function dateTimeBytes(dt: RpDateTime): Buffer {
  const { days, time } = sqlDateTime(dt);
  const b = Buffer.alloc(8);
  b.writeInt32LE(days, 0);
  b.writeUInt32LE(time, 4);
  return b;
}

function decimalValue(d: CsDecimal): Buffer {
  return Buffer.concat([Buffer.from([d.negative && !d.isZero ? 0 : 1]), magnitude(d)]);
}

/**
 * The sql_variant value of a parameter of DbType Object: the base type of the .NET value
 * (MetaType.GetMetaTypeFromValue) with its properties (TdsParser.WriteSqlVariantValue).
 */
function variantValue(t: Typed, ctx: BindContext): Buffer {
  let baseType: number;
  let props: Buffer = Buffer.alloc(0);
  let data: Buffer;
  switch (t.type) {
    case 'Boolean':
      baseType = 0x32;
      data = Buffer.from([t.value ? 1 : 0]);
      break;
    case 'Byte':
      baseType = 0x30;
      data = Buffer.from([t.value as number]);
      break;
    case 'Int32':
      baseType = 0x38;
      data = Buffer.alloc(4);
      data.writeInt32LE(t.value as number);
      break;
    case 'Int64':
      baseType = 0x7f;
      data = Buffer.alloc(8);
      data.writeBigInt64LE(t.value as bigint);
      break;
    case 'Double':
      baseType = 0x3e;
      data = Buffer.alloc(8);
      data.writeDoubleLE(t.value as number);
      break;
    case 'Decimal': {
      const d = t.value as CsDecimal;
      baseType = 0x6c;
      // MetaDecimal's precision (38) and the scale of the value
      props = Buffer.from([38, d.scale]);
      data = decimalValue(d);
      break;
    }
    case 'DateTime':
      baseType = 0x3d;
      data = dateTimeBytes(t.value as RpDateTime);
      break;
    case 'Char':
    case 'String': {
      data = Buffer.from(t.value as string, 'utf16le');
      if (data.length > TYPE_SIZE_LIMIT) throw argumentException('A sql_variant parameter takes a string of 4000 characters at most.');
      baseType = 0xe7;
      props = Buffer.concat([ctx.collation, u16(data.length)]);
      break;
    }
    case 'Byte[]': {
      data = Buffer.from(t.value as Uint8Array);
      if (data.length > TYPE_SIZE_LIMIT) throw argumentException('A sql_variant parameter takes 8000 bytes at most.');
      baseType = 0xa5;
      props = u16(data.length);
      break;
    }
  }
  const head = Buffer.alloc(6);
  head.writeUInt32LE(2 + props.length + data.length, 0);
  head[4] = baseType;
  head[5] = props.length;
  return Buffer.concat([head, props, data]);
}

function variantTypeInfo(): Buffer {
  const b = Buffer.alloc(5);
  b[0] = SSVARIANT;
  b.writeUInt32LE(8009, 1);
  return b;
}

/** One parameter: its MetaType, converted value, declaration, TYPE_INFO and value bytes. */
export function bindParameter(p: QueryParameter, ctx: BindContext): BoundParameter {
  const meta = metaTypeOf(p.dbType);
  const name = p.name.startsWith('@') ? p.name.substring(1) : p.name;
  const isDefault = p.valueType === 'Null' || p.value === undefined;
  const isNull = isDefault || p.valueType === 'DBNull' || p.value === null;
  const original = isNull ? null : asTyped(clrTypeOf(p.valueType, p.value), p.value);
  const value = original === null ? null : coerce(original, meta, ctx.culture);
  let declaration: string;
  let typeInfo: Buffer;
  let data: Buffer;
  switch (meta) {
    case 'Variant':
      declaration = 'sql_variant';
      typeInfo = variantTypeInfo();
      data = value === null ? Buffer.alloc(4) : variantValue(value, ctx);
      break;
    case 'Bit':
      declaration = 'bit';
      typeInfo = Buffer.from([BITN, 1]);
      data = value === null ? Buffer.from([0]) : Buffer.from([1, value.value ? 1 : 0]);
      break;
    case 'TinyInt':
      declaration = 'tinyint';
      typeInfo = Buffer.from([INTN, 1]);
      data = value === null ? Buffer.from([0]) : Buffer.from([1, value.value as number]);
      break;
    case 'Int': {
      declaration = 'int';
      typeInfo = Buffer.from([INTN, 4]);
      if (value === null) data = Buffer.from([0]);
      else {
        data = Buffer.alloc(5);
        data[0] = 4;
        data.writeInt32LE(value.value as number, 1);
      }
      break;
    }
    case 'BigInt': {
      declaration = 'bigint';
      typeInfo = Buffer.from([INTN, 8]);
      if (value === null) data = Buffer.from([0]);
      else {
        data = Buffer.alloc(9);
        data[0] = 8;
        data.writeBigInt64LE(value.value as bigint, 1);
      }
      break;
    }
    case 'Float': {
      declaration = 'float';
      typeInfo = Buffer.from([FLTN, 8]);
      if (value === null) data = Buffer.from([0]);
      else {
        data = Buffer.alloc(9);
        data[0] = 8;
        data.writeDoubleLE(value.value as number, 1);
      }
      break;
    }
    case 'Decimal': {
      const d = value === null ? null : (value.value as CsDecimal);
      // GetActualPrecision / GetActualScale of the converted value; no value: decimal(29,0)
      const precision = d === null ? 29 : decimalPrecision(d);
      const scale = d === null ? 0 : d.scale;
      declaration = `decimal(${precision},${scale})`;
      typeInfo = Buffer.from([DECIMALN, 17, precision, scale]);
      data = d === null ? Buffer.from([0]) : Buffer.concat([Buffer.from([17]), decimalValue(d)]);
      break;
    }
    case 'DateTime':
      declaration = 'datetime';
      typeInfo = Buffer.from([DATETIMN, 8]);
      data = value === null ? Buffer.from([0]) : Buffer.concat([Buffer.from([8]), dateTimeBytes(value.value as RpDateTime)]);
      break;
    case 'NVarChar': {
      const text = value === null ? null : Buffer.from(value.value as string, 'utf16le');
      const size = valueSize(original);
      const isMax = Math.max(size * 2, text?.length ?? 0) > TYPE_SIZE_LIMIT;
      declaration = isMax ? 'nvarchar(max) ' : `nvarchar(${size === 0 ? 4000 : size})`;
      typeInfo = Buffer.concat([Buffer.from([NVARCHAR]), u16(isMax ? 0xffff : TYPE_SIZE_LIMIT), ctx.collation]);
      if (isMax) data = text === null ? PLP_NULL : plp(text);
      else data = text === null ? u16(0xffff) : Buffer.concat([u16(text.length), text]);
      break;
    }
    case 'VarBinary': {
      const bytes = value === null ? null : Buffer.from(value.value as Uint8Array);
      const size = valueSize(original);
      const isMax = Math.max(size, bytes?.length ?? 0) > TYPE_SIZE_LIMIT;
      declaration = isMax ? 'varbinary(max) ' : `varbinary(${size === 0 ? TYPE_SIZE_LIMIT : size})`;
      typeInfo = Buffer.concat([Buffer.from([BIGVARBIN]), u16(isMax ? 0xffff : TYPE_SIZE_LIMIT)]);
      if (isMax) data = bytes === null ? PLP_NULL : plp(bytes);
      else data = bytes === null ? u16(0xffff) : Buffer.concat([u16(bytes.length), bytes]);
      break;
    }
  }
  return { name, declaration: '@' + name + ' ' + declaration, raw: { typeInfo, value: data, isDefault } };
}

/** The parameters of a command in order, and the @params of sp_executesql (BuildParamList). */
export function bindParameters(parameters: readonly QueryParameter[], ctx: BindContext): { declarations: string; parameters: BoundParameter[] } {
  const bound = parameters.map((p) => bindParameter(p, ctx));
  return { declarations: bound.map((b) => b.declaration).join(','), parameters: bound };
}
