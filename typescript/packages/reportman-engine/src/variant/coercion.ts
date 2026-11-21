// Port of Reportman.Reporting.VariantCoercion: the Delphi Variant type coercion that promotes two
// operands of different types to a common base type before comparing them.

import { CsDecimal } from '../util/decimal.js';
import { RpDateTime } from '../util/datetime.js';
import { overflowException, NetMessages, UnNamedException } from '../util/netexception.js';
import {
  convertDecimalToInt32,
  convertDecimalToInt64,
  convertDoubleToInt32,
  convertDoubleToInt64,
  NumberStyles,
  parseDecimal,
  parseDouble,
  tryParseBoolean,
  tryParseInt32,
  tryParseInt64,
} from '../util/numberparse.js';
import { tryParseDateTime } from '../util/dateparse.js';
import type { VariantContext } from './context.js';
import { Variant, VariantType } from './variant.js';

enum BaseType {
  Error,
  Empty,
  Null,
  Integer,
  Float,
  Currency,
  String,
  Boolean,
  DateTime,
  Int64,
  UInt64,
  Any,
}

const B = BaseType;
const COERCION_TYPE_MAP: readonly (readonly BaseType[])[] = [
  [B.Error, B.Error, B.Error, B.Error, B.Error, B.Error, B.Error, B.Error, B.Error, B.Error, B.Error, B.Error],
  [B.Error, B.Empty, B.Null, B.Integer, B.Float, B.Currency, B.String, B.Boolean, B.DateTime, B.Int64, B.UInt64, B.Any],
  [B.Error, B.Null, B.Null, B.Null, B.Null, B.Null, B.Null, B.Null, B.Null, B.Null, B.Null, B.Any],
  [B.Error, B.Integer, B.Null, B.Integer, B.Float, B.Currency, B.Float, B.Integer, B.DateTime, B.Int64, B.UInt64, B.Any],
  [B.Error, B.Float, B.Null, B.Float, B.Float, B.Currency, B.Float, B.Float, B.DateTime, B.Float, B.Float, B.Any],
  [B.Error, B.Currency, B.Null, B.Currency, B.Currency, B.Currency, B.Currency, B.Currency, B.DateTime, B.Currency, B.Currency, B.Any],
  [B.Error, B.String, B.Null, B.Float, B.Float, B.Currency, B.String, B.Boolean, B.DateTime, B.Float, B.Float, B.Any],
  [B.Error, B.Boolean, B.Null, B.Integer, B.Float, B.Currency, B.Boolean, B.Boolean, B.DateTime, B.Int64, B.UInt64, B.Any],
  [B.Error, B.DateTime, B.Null, B.DateTime, B.DateTime, B.DateTime, B.DateTime, B.DateTime, B.DateTime, B.DateTime, B.DateTime, B.Any],
  [B.Error, B.Int64, B.Null, B.Int64, B.Float, B.Currency, B.Float, B.Int64, B.DateTime, B.Int64, B.UInt64, B.Any],
  [B.Error, B.UInt64, B.Null, B.UInt64, B.Float, B.Currency, B.Float, B.UInt64, B.DateTime, B.UInt64, B.UInt64, B.Any],
  [B.Error, B.Any, B.Any, B.Any, B.Any, B.Any, B.Any, B.Any, B.Any, B.Any, B.Any, B.Any],
];

/**
 * VariantCoercion.Coercion: both values cast to the base type the map gives for their types, or
 * null when nothing is done (same type, or either is Null: Delphi compares Null directly).
 * Throws the "Type conversion error ... Variant coercion" error for impossible combinations.
 */
export function coercion(value1: Variant, value2: Variant, ctx: VariantContext): [Variant, Variant] | null {
  if (value1.varType === value2.varType) return null;
  if (value1.varType === VariantType.Null || value2.varType === VariantType.Null) return null;
  const target = COERCION_TYPE_MAP[getBaseType(value1.varType)]![getBaseType(value2.varType)]!;
  if (target === BaseType.Error) raiseInvalidCoercion(value1, value2, ctx);
  if (target === BaseType.Null) return null;
  return [castToBaseType(value1, target, ctx), castToBaseType(value2, target, ctx)];
}

function getBaseType(t: VariantType): BaseType {
  switch (t) {
    case VariantType.Null:
      return BaseType.Null;
    case VariantType.Byte:
    case VariantType.Integer:
      return BaseType.Integer;
    case VariantType.Long:
      return BaseType.Int64;
    case VariantType.Double:
      return BaseType.Float;
    case VariantType.Decimal:
      return BaseType.Currency;
    case VariantType.String:
    case VariantType.Char:
      return BaseType.String;
    case VariantType.Boolean:
      return BaseType.Boolean;
    case VariantType.DateTime:
      return BaseType.DateTime;
    default:
      return BaseType.Error;
  }
}

function castToBaseType(value: Variant, target: BaseType, ctx: VariantContext): Variant {
  switch (target) {
    case BaseType.Integer:
      return Variant.fromInteger(toInteger(value, ctx));
    case BaseType.Int64:
      return Variant.fromLong(toInt64(value, ctx));
    case BaseType.Float:
      return Variant.fromDouble(toDouble(value, ctx));
    case BaseType.Currency:
      return Variant.fromDecimal(toCurrency(value, ctx));
    case BaseType.String:
      return Variant.fromString(value.toString(ctx));
    case BaseType.Boolean:
      return Variant.fromBoolean(toBoolean(value, ctx));
    case BaseType.DateTime:
      return Variant.fromDateTime(toDateTime(value, ctx));
    default:
      raiseInvalidCoercion(value, value, ctx);
  }
}

function toDelphiBooleanInteger(value: boolean): number {
  return value ? -1 : 0;
}

function toInteger(value: Variant, ctx: VariantContext): number {
  switch (value.varType) {
    case VariantType.Null:
      return 0;
    case VariantType.Boolean:
      return toDelphiBooleanInteger(value.toBool(ctx));
    case VariantType.Byte:
      return value.toByte(ctx);
    case VariantType.Integer:
      return value.toInt(ctx);
    case VariantType.Long: {
      const l = value.toLong(ctx);
      if (l > 2147483647n || l < -2147483648n) throw overflowException(NetMessages.arithmeticOverflow);
      return Number(l);
    }
    case VariantType.Decimal:
      return convertDecimalToInt32(value.toDecimal(ctx));
    case VariantType.Double:
      return convertDoubleToInt32(value.toDouble(ctx));
    case VariantType.DateTime:
      return convertDoubleToInt32(value.toDateTime(ctx).toOADate());
    case VariantType.String:
    case VariantType.Char:
      return parseInteger(value.toString(ctx), ctx);
    default:
      raiseInvalidCoercion(value, value, ctx);
  }
}

function toInt64(value: Variant, ctx: VariantContext): bigint {
  switch (value.varType) {
    case VariantType.Null:
      return 0n;
    case VariantType.Boolean:
      return BigInt(toDelphiBooleanInteger(value.toBool(ctx)));
    case VariantType.Byte:
      return BigInt(value.toByte(ctx));
    case VariantType.Integer:
      return BigInt(value.toInt(ctx));
    case VariantType.Long:
      return value.toLong(ctx);
    case VariantType.Decimal:
      return convertDecimalToInt64(value.toDecimal(ctx));
    case VariantType.Double:
      return convertDoubleToInt64(value.toDouble(ctx));
    case VariantType.DateTime:
      return convertDoubleToInt64(value.toDateTime(ctx).toOADate());
    case VariantType.String:
    case VariantType.Char:
      return parseInt64(value.toString(ctx), ctx);
    default:
      raiseInvalidCoercion(value, value, ctx);
  }
}

function toDouble(value: Variant, ctx: VariantContext): number {
  switch (value.varType) {
    case VariantType.Null:
      return 0.0;
    case VariantType.Boolean:
      return toDelphiBooleanInteger(value.toBool(ctx));
    case VariantType.Byte:
      return value.toByte(ctx);
    case VariantType.Integer:
      return value.toInt(ctx);
    case VariantType.Long:
      return Number(value.toLong(ctx));
    case VariantType.Decimal:
      return value.toDecimal(ctx).toDouble();
    case VariantType.Double:
      return value.toDouble(ctx);
    case VariantType.DateTime:
      return value.toDateTime(ctx).toOADate();
    case VariantType.String:
    case VariantType.Char:
      return parseDoubleText(value.toString(ctx), ctx);
    default:
      raiseInvalidCoercion(value, value, ctx);
  }
}

function toCurrency(value: Variant, ctx: VariantContext): CsDecimal {
  switch (value.varType) {
    case VariantType.Null:
      return CsDecimal.zero;
    case VariantType.Boolean:
      return CsDecimal.fromInteger(toDelphiBooleanInteger(value.toBool(ctx)));
    case VariantType.Byte:
      return CsDecimal.fromInteger(value.toByte(ctx));
    case VariantType.Integer:
      return CsDecimal.fromInteger(value.toInt(ctx));
    case VariantType.Long:
      return CsDecimal.fromInteger(value.toLong(ctx));
    case VariantType.Decimal:
      return value.toDecimal(ctx);
    case VariantType.Double:
      return CsDecimal.fromDouble(value.toDouble(ctx));
    case VariantType.DateTime:
      return CsDecimal.fromDouble(value.toDateTime(ctx).toOADate());
    case VariantType.String:
    case VariantType.Char:
      return parseDecimal(value.toString(ctx), NumberStyles.Currency, ctx.culture.number);
    default:
      raiseInvalidCoercion(value, value, ctx);
  }
}

function toBoolean(value: Variant, ctx: VariantContext): boolean {
  switch (value.varType) {
    case VariantType.Null:
      return false;
    case VariantType.Boolean:
      return value.toBool(ctx);
    case VariantType.Byte:
      return value.toByte(ctx) !== 0;
    case VariantType.Integer:
      return value.toInt(ctx) !== 0;
    case VariantType.Long:
      return value.toLong(ctx) !== 0n;
    case VariantType.Decimal:
      return !value.toDecimal(ctx).isZero;
    case VariantType.Double:
      return value.toDouble(ctx) !== 0.0;
    case VariantType.DateTime:
      return value.toDateTime(ctx).toOADate() !== 0.0;
    case VariantType.String:
    case VariantType.Char: {
      const b = tryParseDelphiBoolean(value.toString(ctx));
      if (b !== undefined) return b;
      throw new UnNamedException(ctx.translator.translateStr(438));
    }
    default:
      raiseInvalidCoercion(value, value, ctx);
  }
}

function toDateTime(value: Variant, ctx: VariantContext): RpDateTime {
  switch (value.varType) {
    case VariantType.Null:
      return RpDateTime.fromOADate(0.0);
    case VariantType.Boolean:
      return RpDateTime.fromOADate(toDelphiBooleanInteger(value.toBool(ctx)));
    case VariantType.Byte:
      return RpDateTime.fromOADate(value.toByte(ctx));
    case VariantType.Integer:
      return RpDateTime.fromOADate(value.toInt(ctx));
    case VariantType.Long:
      return RpDateTime.fromOADate(Number(value.toLong(ctx)));
    case VariantType.Decimal:
      return RpDateTime.fromOADate(value.toDecimal(ctx).toDouble());
    case VariantType.Double:
      return RpDateTime.fromOADate(value.toDouble(ctx));
    case VariantType.DateTime:
      return value.toDateTime(ctx);
    case VariantType.String:
    case VariantType.Char: {
      const s = value.toString(ctx);
      const dt = tryParseDateTime(s, ctx.culture, ctx.now(), ctx.timeZone);
      if (dt !== undefined) return dt;
      return RpDateTime.fromOADate(parseDoubleText(s, ctx));
    }
    default:
      raiseInvalidCoercion(value, value, ctx);
  }
}

function parseInteger(value: string, ctx: VariantContext): number {
  const i = tryParseInt32(value, NumberStyles.Integer, ctx.culture.number);
  if (i !== undefined) return i;
  const b = tryParseDelphiBoolean(value);
  if (b !== undefined) return toDelphiBooleanInteger(b);
  return convertDoubleToInt32(parseDoubleText(value, ctx));
}

function parseInt64(value: string, ctx: VariantContext): bigint {
  const i = tryParseInt64(value, NumberStyles.Integer, ctx.culture.number);
  if (i !== undefined) return i;
  const b = tryParseDelphiBoolean(value);
  if (b !== undefined) return BigInt(toDelphiBooleanInteger(b));
  return convertDoubleToInt64(parseDoubleText(value, ctx));
}

function parseDoubleText(value: string, ctx: VariantContext): number {
  return parseDouble(value, NumberStyles.Float | NumberStyles.AllowThousands, ctx.culture.number);
}

/** TryParseBoolean: "0" is false, "-1" is true, else bool.TryParse. */
function tryParseDelphiBoolean(value: string): boolean | undefined {
  if (value === '0') return false;
  if (value === '-1') return true;
  return tryParseBoolean(value);
}

function raiseInvalidCoercion(value1: Variant, value2: Variant, ctx: VariantContext): never {
  throw new UnNamedException(
    ctx.translator.translateStr(438) + ' Variant coercion ' + value1.getTypeString() + '-' + value2.getTypeString(),
  );
}
