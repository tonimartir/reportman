// The value of a parameter as FirebirdClient sends it. FirebirdClient converts the .NET value the C#
// engine gives (IDbDataParameter.Value) to the type the server described for its placeholder, with
// the conversions of DbValue (Convert.ToInt32, Convert.ToDecimal... under the invariant culture,
// value.ToString() for text) and of TypeEncoder (a decimal to a scaled integer by truncation), and
// fails as they fail. The DbType of the parameter plays no part (only a Guid one is checked).
//
// Here the value is converted the same way and handed to node-firebird in a form the server takes
// exactly for that type: a decimal as the text of the truncated value, a date and time as its text
// with the 1/10000 s of Firebird (node-firebird would round it through a JavaScript Date), integers
// beyond 2^53 as text.

import {
  CsDecimal,
  type CultureInfo,
  formatDateTime,
  formatDecimal,
  formatDouble,
  NetException,
  NumberStyles,
  parseDecimal,
  parseDouble,
  type QueryParameter,
  RpDateTime,
  tryParseBoolean,
  tryParseDateTime,
  tryParseInt64,
} from 'reportman-engine';
import { type Charset, charCount, DbDataType, dbDataType, decodeText, fieldCharset, invalidDataType, SqlType } from './types.js';
import { describe } from './values.js';
import type { SqlVar } from './wire.js';

/**
 * What to send for a parameter: the value, whether it goes as text whatever the field type, and
 * whether it is a double (node-firebird sends a number by its value: an integral one as an integer).
 */
export interface BoundValue {
  readonly value: unknown;
  readonly asText: boolean;
  readonly double?: boolean;
}

const NULL_VALUE: BoundValue = { value: null, asText: false };

/** The .NET type name of a parameter value (GetType().Name). */
function netName(p: QueryParameter): string {
  switch (p.valueType) {
    case 'Binary':
      return 'Byte[]';
    case 'Object':
      return typeof p.value === 'string' ? 'String' : 'Object';
    default:
      return p.valueType;
  }
}

function invalidCast(from: string, to: string): NetException {
  return new NetException('InvalidCastException', `Invalid cast from '${from}' to '${to}'.`);
}

function unableToCast(from: string, to: string): NetException {
  return new NetException('InvalidCastException', `Unable to cast object of type '${from}' to type '${to}'.`);
}

function notConvertible(): NetException {
  return unableToCast('System.Byte[]', 'System.IConvertible');
}

function overflow(type: 'Int16' | 'Int32' | 'Int64' | 'Decimal'): NetException {
  const article = type === 'Int16' || type === 'Int32' || type === 'Int64' ? 'an' : 'a';
  return new NetException('OverflowException', `Value was either too large or too small for ${article} ${type}.`);
}

const RANGES = {
  Int16: [-32768n, 32767n],
  Int32: [-2147483648n, 2147483647n],
  Int64: [-9223372036854775808n, 9223372036854775807n],
} as const;

type IntType = keyof typeof RANGES;

function checkRange(v: bigint, type: IntType): bigint {
  const [min, max] = RANGES[type];
  if (v < min || v > max) throw overflow(type);
  return v;
}

/** Convert.ToInt32(double): rounds half to even. */
function roundHalfEven(x: number): number {
  const r = Math.round(x);
  return r - x === 0.5 && r % 2 !== 0 ? r - 1 : r;
}

/** Convert.ToInt16 / ToInt32 / ToInt64 of a value, under the invariant culture. */
function toInteger(p: QueryParameter, type: IntType, invariant: CultureInfo): bigint {
  const v = p.value;
  switch (p.valueType) {
    case 'Boolean':
      return v ? 1n : 0n;
    case 'Byte':
    case 'Int32':
      return checkRange(BigInt(v as number), type);
    case 'Int64':
      return checkRange(v as bigint, type);
    case 'Char': {
      const code = BigInt((v as string).charCodeAt(0));
      return type === 'Int16' ? checkRange(code, 'Int16') : code;
    }
    case 'Decimal': {
      // decimal.ToInt32(decimal.Round(value, 0)); decimal.ToInt16 goes through ToInt32
      const r = decimalToInteger((v as CsDecimal).round());
      return checkRange(type === 'Int16' ? checkRange(r, 'Int32') : r, type);
    }
    case 'Double': {
      const d = v as number;
      if (type === 'Int64') {
        // checked((long)Math.Round(value))
        const r = roundHalfEven(d);
        if (!Number.isFinite(r) || r >= 9223372036854775808 || r < -9223372036854775808) {
          throw new NetException('OverflowException', 'Arithmetic operation resulted in an overflow.');
        }
        return BigInt(r);
      }
      // ToInt32(double), then ToInt16(int)
      if (!(d >= -2147483648.5 && d < 2147483647.5)) throw overflow('Int32');
      return checkRange(BigInt(roundHalfEven(d)), type);
    }
    case 'String':
    case 'Object': {
      const s = String(v);
      const r = tryParseInt64(s, NumberStyles.Integer, invariant.number);
      if (r === undefined) {
        if (/^[\s\0]*[+-]?\d+[\s\0]*$/.test(s)) throw overflow(type);
        throw new NetException('FormatException', `The input string '${s}' was not in a correct format.`);
      }
      return checkRange(r, type);
    }
    case 'DateTime':
      throw invalidCast('DateTime', type);
    case 'Binary':
      throw notConvertible();
    default:
      throw invalidCast(netName(p), type);
  }
}

function decimalToInteger(d: CsDecimal): bigint {
  const t = d.mag / 10n ** BigInt(d.scale);
  return d.negative ? -t : t;
}

/** Convert.ToDecimal of a value, under the invariant culture. */
function toDecimal(p: QueryParameter, invariant: CultureInfo): CsDecimal {
  const v = p.value;
  switch (p.valueType) {
    case 'Boolean':
      return v ? CsDecimal.one : CsDecimal.zero;
    case 'Byte':
    case 'Int32':
      return CsDecimal.fromInteger(v as number);
    case 'Int64':
      return CsDecimal.fromInteger(v as bigint);
    case 'Decimal':
      return v as CsDecimal;
    case 'Double':
      return CsDecimal.fromDouble(v as number);
    case 'String':
    case 'Object':
      return parseDecimal(String(v), NumberStyles.Number, invariant.number);
    case 'Binary':
      throw notConvertible();
    default:
      throw invalidCast(netName(p), 'Decimal');
  }
}

/** Convert.ToDouble of a value, under the invariant culture. */
function toDouble(p: QueryParameter, invariant: CultureInfo, to: 'Double' | 'Single'): number {
  const v = p.value;
  switch (p.valueType) {
    case 'Boolean':
      return v ? 1 : 0;
    case 'Byte':
    case 'Int32':
    case 'Double':
      return v as number;
    case 'Int64':
      return Number(v as bigint);
    case 'Decimal':
      return (v as CsDecimal).toDouble();
    case 'String':
    case 'Object':
      return parseDouble(String(v), NumberStyles.Float | NumberStyles.AllowThousands, invariant.number);
    case 'Binary':
      throw notConvertible();
    default:
      throw invalidCast(netName(p), to);
  }
}

/** Convert.ToBoolean of a value, under the invariant culture. */
function toBoolean(p: QueryParameter): boolean {
  const v = p.value;
  switch (p.valueType) {
    case 'Boolean':
      return v as boolean;
    case 'Byte':
    case 'Int32':
    case 'Double':
      return (v as number) !== 0;
    case 'Int64':
      return (v as bigint) !== 0n;
    case 'Decimal':
      return !(v as CsDecimal).isZero;
    case 'String':
    case 'Object': {
      const b = tryParseBoolean(String(v));
      if (b === undefined) throw new NetException('FormatException', `String '${String(v)}' was not recognized as a valid Boolean.`);
      return b;
    }
    case 'Binary':
      throw notConvertible();
    default:
      throw invalidCast(netName(p), 'Boolean');
  }
}

/** DbValue.GetDateTime: Convert.ToDateTime under the current culture. */
function toDateTime(p: QueryParameter, culture: CultureInfo): RpDateTime {
  const v = p.value;
  switch (p.valueType) {
    case 'DateTime':
      return v instanceof RpDateTime ? v : RpDateTime.fromJsDate(v as unknown as Date);
    case 'String':
    case 'Object': {
      const d = tryParseDateTime(String(v), culture);
      if (d === undefined) throw new NetException('FormatException', `String '${String(v)}' was not recognized as a valid DateTime.`);
      return d;
    }
    case 'Binary':
      throw notConvertible();
    default:
      throw invalidCast(netName(p), 'DateTime');
  }
}

/** DbValue.GetString: value.ToString() under the current culture (the bytes of a byte[] in the field's charset). */
function toText(p: QueryParameter, charset: Charset, culture: CultureInfo): string {
  const v = p.value;
  switch (p.valueType) {
    case 'Boolean':
      return v ? 'True' : 'False';
    case 'Byte':
    case 'Int32':
      return (v as number) < 0 ? culture.number.negativeSign + String(-(v as number)) : String(v);
    case 'Int64':
      return (v as bigint) < 0n ? culture.number.negativeSign + (-(v as bigint)).toString() : (v as bigint).toString();
    case 'Decimal':
      return formatDecimal(v as CsDecimal, '', culture.number);
    case 'Double':
      return formatDouble(v as number, '', culture.number);
    case 'DateTime':
      return formatDateTime(toDateTime(p, culture), '', culture);
    case 'Binary':
      return decodeText(v as Uint8Array, charset);
    default:
      return String(v);
  }
}

/** (byte[])value of FirebirdClient: a byte[] or an InvalidCastException. */
function toBytes(p: QueryParameter): Uint8Array {
  if (p.valueType === 'Binary') return p.value as Uint8Array;
  const name = p.valueType === 'Char' ? 'System.Char' : 'System.' + netName(p);
  throw unableToCast(name, 'System.Byte[]');
}

/** IscException.ForErrorCodes(isc_arith_except, isc_string_truncation), as FbException. */
function stringTruncation(): NetException {
  return new NetException(
    'FbException',
    'arithmetic exception, numeric overflow, or string truncation\nstring right truncation',
  );
}

function p2(n: number): string {
  return String(n).padStart(2, '0');
}

/** The date part as Firebird reads it ("YYYY-MM-DD"). */
function dateText(d: RpDateTime): string {
  return String(d.year).padStart(4, '0') + '-' + p2(d.month) + '-' + p2(d.day);
}

/** The time of day, truncated to 1/10000 s (TypeEncoder.EncodeTime), as Firebird reads it. */
function timeText(d: RpDateTime): string {
  const units = Math.floor(d.ticksOfSecond / 1000);
  return p2(d.hour) + ':' + p2(d.minute) + ':' + p2(d.second) + '.' + String(units).padStart(4, '0');
}

/** A scaled integer as the exact text of its decimal value. */
function scaledText(v: bigint, scale: number): string {
  const negative = v < 0n;
  let digits = (negative ? -v : v).toString();
  const places = -scale;
  if (places <= 0) return (negative ? '-' : '') + digits + '0'.repeat(-places);
  if (digits.length <= places) digits = digits.padStart(places + 1, '0');
  return (negative ? '-' : '') + digits.slice(0, -places) + '.' + digits.slice(-places);
}

/** An integer for node-firebird: a number when exact, else its text. */
function integerValue(v: bigint): BoundValue {
  return v >= -9007199254740991n && v <= 9007199254740991n ? { value: Number(v), asText: false } : { value: v.toString(), asText: true };
}

/** A floating point value: sent as a double (blr_double), whatever its value. */
function doubleValue(v: number): BoundValue {
  return { value: v, asText: false, double: true };
}

/** What converting a parameter needs to know of the connection. */
export interface ParameterContext {
  readonly charset: Charset;
  readonly culture: CultureInfo;
  readonly invariant: CultureInfo;
}

/** The value to send for a parameter to a described placeholder, as FirebirdClient would send it. */
export function bindParameter(p: QueryParameter, input: SqlVar, ctx: ParameterContext): BoundValue {
  if (p.valueType === 'Null' || p.valueType === 'DBNull' || p.value === null || p.value === undefined) return NULL_VALUE;
  const field = describe(input);
  const type = dbDataType(field);
  const charset = fieldCharset(field);
  switch (type) {
    case DbDataType.Guid:
      // FbCommand.UpdateParameterValues: only a Guid or a byte[] goes to a CHAR(16) OCTETS
      if (p.valueType !== 'Binary') throw new NetException('InvalidOperationException', 'Incorrect Guid value.');
      if ((p.value as Uint8Array).length < 16) {
        throw new NetException('ArgumentException', "Destination array is not long enough to copy all the items in the collection. Check array index and length. (Parameter 'value')");
      }
      return { value: Buffer.from((p.value as Uint8Array).subarray(0, 16)), asText: false };
    case DbDataType.Char:
    case DbDataType.VarChar: {
      if (charset.id === 1) {
        const bytes = toBytes(p);
        if (bytes.length > field.length) throw stringTruncation();
        return { value: Buffer.from(bytes), asText: false };
      }
      const s = toText(p, charset, ctx.culture);
      if (charset.id === 0) {
        if (Buffer.byteLength(s, 'utf8') > field.length) throw stringTruncation();
      } else if (field.length % charset.bytesPerCharacter === 0 && s.length > charCount(field)) {
        throw stringTruncation();
      }
      return { value: s, asText: false };
    }
    case DbDataType.SmallInt:
      return integerValue(toInteger(p, 'Int16', ctx.invariant));
    case DbDataType.Integer:
      return integerValue(toInteger(p, 'Int32', ctx.invariant));
    case DbDataType.BigInt:
      return integerValue(toInteger(p, 'Int64', ctx.invariant));
    case DbDataType.Int128: {
      // DbValue.GetInt128: a byte, short, int or long; anything else fails the unboxing cast
      switch (p.valueType) {
        case 'Byte':
        case 'Int32':
          return integerValue(BigInt(p.value as number));
        case 'Int64':
          return integerValue(p.value as bigint);
        default:
          throw unableToCast(p.valueType === 'Binary' ? 'System.Byte[]' : 'System.' + netName(p), 'System.Numerics.BigInteger');
      }
    }
    case DbDataType.Decimal:
    case DbDataType.Numeric: {
      const d = toDecimal(p, ctx.invariant);
      if (field.sqlType === SqlType.DOUBLE || field.sqlType === SqlType.D_FLOAT) return doubleValue(d.toDouble());
      // TypeEncoder.EncodeDecimal: multiplied by ten per decimal place, then truncated to the storage type
      let shifted = d;
      const ten = CsDecimal.fromInteger(10);
      for (let shift = Math.abs(field.scale); shift > 0; shift--) shifted = shifted.mul(ten);
      let integer = decimalToInteger(shifted);
      switch (field.sqlType) {
        case SqlType.SHORT:
          integer = checkRange(checkRange(integer, 'Int32'), 'Int16');
          break;
        case SqlType.LONG:
          integer = checkRange(integer, 'Int32');
          break;
        case SqlType.INT64:
        case SqlType.QUAD:
          integer = checkRange(integer, 'Int64');
          break;
      }
      return { value: scaledText(integer, -Math.abs(field.scale)), asText: true };
    }
    case DbDataType.Float:
      return doubleValue(Math.fround(toDouble(p, ctx.invariant, 'Single')));
    case DbDataType.Double:
      return doubleValue(toDouble(p, ctx.invariant, 'Double'));
    case DbDataType.Date:
      return { value: dateText(toDateTime(p, ctx.culture)), asText: true };
    case DbDataType.Time:
      return { value: timeText(toDateTime(p, ctx.culture)), asText: true };
    case DbDataType.TimeStamp: {
      const d = toDateTime(p, ctx.culture);
      return { value: dateText(d) + ' ' + timeText(d), asText: true };
    }
    case DbDataType.Boolean:
      return { value: toBoolean(p), asText: false };
    case DbDataType.TimeStampTZ:
    case DbDataType.TimeStampTZEx:
    case DbDataType.TimeTZ:
    case DbDataType.TimeTZEx:
      // DbValue.GetTimeZoneId: only an FbZonedDateTime or FbZonedTime carries a time zone
      toDateTime(p, ctx.culture);
      throw new NetException('InvalidOperationException', 'Incorrect time zone value.');
    case DbDataType.Dec16:
    case DbDataType.Dec34:
      throw unableToCast(p.valueType === 'Binary' ? 'System.Byte[]' : 'System.' + netName(p), 'FirebirdSql.Data.Types.FbDecFloat');
    case DbDataType.Binary:
      return { value: Buffer.from(toBytes(p)), asText: false };
    case DbDataType.Text:
      if (p.valueType === 'Binary') return { value: Buffer.from(p.value as Uint8Array), asText: false };
      if (p.valueType === 'String') return { value: p.value as string, asText: false };
      throw unableToCast('System.' + netName(p), 'System.String');
    case DbDataType.Array:
      throw new NetException('NotSupportedException', 'The Firebird driver of Report Manager does not write ARRAY parameters');
    case DbDataType.Null:
      // a placeholder of no type (? IS NULL): FirebirdClient sends only that it is not null
      return { value: '', asText: true };
    default:
      throw invalidDataType(type);
  }
}
