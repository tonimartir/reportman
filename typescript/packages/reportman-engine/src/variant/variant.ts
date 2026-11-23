// Port of Reportman.Reporting.Variant (Variant.cs): the value type of the expression language,
// with its implicit conversions, arithmetic and comparison operators (comparisons go through
// VariantCoercion), ExpressionSum (the + of an expression), ToString() and
// ToString(displayformat, paramtype, printnulls).
//
// A Variant is immutable here (C# copies the struct on every assignment, so values never alias).
// Culture, messages and time zone come from an explicit VariantContext instead of the thread.

import { compareCulture } from '../util/chars.js';
import { compositeFormat } from '../util/compositeformat.js';
import { dateFormatMask, formatDateTime } from '../util/dateformat.js';
import { RpDateTime, DateTimeKind } from '../util/datetime.js';
import { delphiFormatSettings, formatDateTimeDelphi } from '../util/delphidateformat.js';
import { delphiDecimalText, delphiFloatText, delphiFormatString } from '../util/delphiformat.js';
import { delphiNumberMaskToDotNet } from '../util/delphinumbermask.js';
import { CsDecimal } from '../util/decimal.js';
import { formatDecimal, formatDouble, formatInteger } from '../util/numberformat.js';
import { NumberStyles, tryParseDecimal, tryParseDouble } from '../util/numberparse.js';
import { NetException, overflowException, UnNamedException } from '../util/netexception.js';
import { fromBase64String, toBase64String } from '../util/base64.js';
import type { VariantContext } from './context.js';
import { coercion } from './coercion.js';

/** Reportman.Reporting.VariantType (same order and values). */
export enum VariantType {
  Null = 0,
  Byte = 1,
  Boolean = 2,
  Char = 3,
  Integer = 4,
  String = 5,
  Double = 6,
  Decimal = 7,
  DateTime = 8,
  Binary = 9,
  Long = 10,
}

/** Reportman.Reporting.ParamType (same order and values). */
export enum ParamType {
  String = 0,
  Integer = 1,
  Double = 2,
  Date = 3,
  Time = 4,
  DateTime = 5,
  Currency = 6,
  Bool = 7,
  ExpreB = 8,
  ExpreA = 9,
  Subst = 10,
  List = 11,
  Multiple = 12,
  SubstExpre = 13,
  SubsExpreList = 14,
  InitialValue = 15,
  Unknown = 16,
}

/** The name of a VariantType as C# writes it (VarType.ToString()). */
export function variantTypeName(t: VariantType): string {
  return VariantType[t]!;
}

/** The JSON form of a Variant (see Variant.toJSON). */
export interface VariantJson {
  type: string;
  value: null | boolean | number | string;
}

/** How a host number becomes a Variant when no type is implied. */
export type HostTypeHint =
  | 'Null'
  | 'Byte'
  | 'Boolean'
  | 'Char'
  | 'Integer'
  | 'String'
  | 'Double'
  | 'Decimal'
  | 'DateTime'
  | 'Binary'
  | 'Long';

type Payload = undefined | boolean | number | bigint | string | CsDecimal | RpDateTime | Uint8Array;

function translate(ctx: VariantContext, index: number): string {
  return ctx.translator.translateStr(index);
}

function conversionError(ctx: VariantContext, suffix = ''): UnNamedException {
  return new UnNamedException(translate(ctx, 438) + suffix);
}

function int32(n: number): number {
  return n | 0;
}

function int64(n: bigint): bigint {
  return BigInt.asIntN(64, n);
}

/** double.CompareTo: NaN is smaller than every number and equal to itself. */
function compareDoubles(a: number, b: number): number {
  if (a < b) return -1;
  if (a > b) return 1;
  if (a === b) return 0;
  if (Number.isNaN(a)) return Number.isNaN(b) ? 0 : -1;
  return 1;
}

function compareNumbers(a: number, b: number): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

function compareBools(a: boolean, b: boolean): number {
  return a === b ? 0 : a ? 1 : -1;
}

export class Variant {
  readonly varType: VariantType;
  private readonly v: Payload;

  private constructor(varType: VariantType, v: Payload) {
    this.varType = varType;
    this.v = v;
  }

  /** new Variant(): Null. */
  static readonly null = new Variant(VariantType.Null, undefined);

  static fromBoolean(value: boolean): Variant {
    return new Variant(VariantType.Boolean, value);
  }

  /** An Integer (int32); the value wraps to 32 bits as a C# int conversion does. */
  static fromInteger(value: number): Variant {
    return new Variant(VariantType.Integer, int32(value));
  }

  /**
   * The result of an operation between two Integer values: an Integer, or a Long when it does not
   * fit (it wrapped around: 1000000*1000000 was -727379968), as the Int64 of the Delphi engine.
   */
  private static integerOrLong(value: bigint): Variant {
    return value >= -2147483648n && value <= 2147483647n ? Variant.fromInteger(Number(value)) : Variant.fromLong(value);
  }

  /** A Long (int64); the value wraps to 64 bits. */
  static fromLong(value: bigint | number): Variant {
    return new Variant(VariantType.Long, int64(typeof value === 'bigint' ? value : BigInt(value)));
  }

  static fromByte(value: number): Variant {
    return new Variant(VariantType.Byte, value & 0xff);
  }

  /** A Char from a one-character string or a UTF-16 code unit. */
  static fromChar(value: string | number): Variant {
    const code = typeof value === 'number' ? value & 0xffff : value.charCodeAt(0);
    return new Variant(VariantType.Char, code);
  }

  static fromDouble(value: number): Variant {
    return new Variant(VariantType.Double, value);
  }

  static fromDecimal(value: CsDecimal): Variant {
    return new Variant(VariantType.Decimal, value);
  }

  /** A String; null becomes "" as in the C# implicit conversion. */
  static fromString(value: string | null | undefined): Variant {
    return new Variant(VariantType.String, value ?? '');
  }

  static fromDateTime(value: RpDateTime): Variant {
    return new Variant(VariantType.DateTime, value);
  }

  /** A Binary value (the bytes are copied, as SetStream copies the stream). */
  static fromBinary(value: Uint8Array): Variant {
    return new Variant(VariantType.Binary, new Uint8Array(value));
  }

  /**
   * AssignFromObject for host values:
   * - null / undefined: Null; a Variant: itself.
   * - boolean: Boolean; string: String; bigint: Long (OverflowException outside the Int64 range,
   *   as the C# conversion of a BigInteger).
   * - number: with a hint, that type (Integer and Long truncate, Byte wraps, Decimal converts as
   *   (decimal)double, DateTime reads an OLE date); without one, an integral number in the Int32
   *   range (and not -0) is Integer and any other number Double.
   * - CsDecimal: Decimal; RpDateTime: DateTime; a JavaScript Date: DateTime of its local fields.
   * - Uint8Array / ArrayBuffer / other ArrayBuffer views: Binary.
   * - anything else: String of String(value), as the C# default branch (Convert.ToString).
   */
  static fromHost(value: unknown, hint?: HostTypeHint): Variant {
    if (value === null || value === undefined) return Variant.null;
    if (value instanceof Variant) return value;
    if (hint !== undefined && typeof value === 'number') return Variant.fromNumberHint(value, hint);
    switch (typeof value) {
      case 'boolean':
        return Variant.fromBoolean(value);
      case 'string':
        if (hint === 'Char' && value.length > 0) return Variant.fromChar(value);
        return Variant.fromString(value);
      case 'bigint':
        if (value > 9223372036854775807n || value < -9223372036854775808n) {
          throw overflowException('Value was either too large or too small for an Int64.');
        }
        return Variant.fromLong(value);
      case 'number':
        if (Number.isInteger(value) && value >= -2147483648 && value <= 2147483647 && !Object.is(value, -0)) {
          return Variant.fromInteger(value);
        }
        return Variant.fromDouble(value);
    }
    if (value instanceof CsDecimal) return Variant.fromDecimal(value);
    if (value instanceof RpDateTime) return Variant.fromDateTime(value);
    if (value instanceof Date) return Variant.fromDateTime(RpDateTime.fromJsDate(value));
    if (value instanceof Uint8Array) return Variant.fromBinary(value);
    if (value instanceof ArrayBuffer) return Variant.fromBinary(new Uint8Array(value));
    if (ArrayBuffer.isView(value)) return Variant.fromBinary(new Uint8Array(value.buffer, value.byteOffset, value.byteLength));
    return Variant.fromString(String(value));
  }

  private static fromNumberHint(value: number, hint: HostTypeHint): Variant {
    switch (hint) {
      case 'Null':
        return Variant.null;
      case 'Byte':
        return Variant.fromByte(Math.trunc(value));
      case 'Boolean':
        return Variant.fromBoolean(value !== 0);
      case 'Char':
        return Variant.fromChar(Math.trunc(value));
      case 'Integer':
        return Variant.fromInteger(Math.trunc(value));
      case 'Long':
        return Variant.fromLong(BigInt(Math.trunc(value)));
      case 'Double':
        return Variant.fromDouble(value);
      case 'Decimal':
        return Variant.fromDecimal(CsDecimal.fromDouble(value));
      case 'DateTime':
        return Variant.fromDateTime(RpDateTime.fromOADate(value));
      case 'String':
        return Variant.fromString(String(value));
      case 'Binary':
        return Variant.fromString(String(value));
    }
  }

  // -------------------------------------------------------------------------------------------
  // Type tests

  get isNull(): boolean {
    return this.varType === VariantType.Null;
  }

  isInteger(): boolean {
    return this.varType === VariantType.Byte || this.varType === VariantType.Integer || this.varType === VariantType.Long;
  }

  isBoolean(): boolean {
    return this.varType === VariantType.Boolean;
  }

  isDateTime(): boolean {
    return this.varType === VariantType.DateTime;
  }

  isString(): boolean {
    return this.varType === VariantType.String;
  }

  isNumber(): boolean {
    switch (this.varType) {
      case VariantType.Byte:
      case VariantType.Integer:
      case VariantType.Long:
      case VariantType.Decimal:
      case VariantType.Double:
        return true;
      default:
        return false;
    }
  }

  /** A String without characters. */
  get isEmptyString(): boolean {
    return this.varType === VariantType.String && this.s.length === 0;
  }

  /** GetTypeString: "VariantType.Integer"... */
  getTypeString(): string {
    return 'VariantType.' + VariantType[this.varType];
  }

  // -------------------------------------------------------------------------------------------
  // Raw payloads (no conversion; throw when the type differs)

  /** The JavaScript value of the payload, typed by varType. */
  get rawValue(): Payload {
    return this.v;
  }

  private get b(): boolean {
    return this.v as boolean;
  }
  private get n(): number {
    return this.v as number;
  }
  private get l(): bigint {
    return this.v as bigint;
  }
  private get d(): CsDecimal {
    return this.v as CsDecimal;
  }
  private get dt(): RpDateTime {
    return this.v as RpDateTime;
  }
  private get s(): string {
    return this.v as string;
  }
  private get bin(): Uint8Array {
    return this.v as Uint8Array;
  }

  /** GetStream: the bytes of a Binary value (a copy). */
  getBytes(): Uint8Array {
    if (this.varType !== VariantType.Binary) throw new UnNamedException('No Binary Variant type');
    return new Uint8Array(this.bin);
  }

  // -------------------------------------------------------------------------------------------
  // Implicit conversions of C# (operator bool(Variant), operator int(Variant)...)

  /** (bool)variant. */
  toBool(ctx: VariantContext): boolean {
    switch (this.varType) {
      case VariantType.Null:
        return false;
      case VariantType.Boolean:
        return this.b;
      case VariantType.Byte:
      case VariantType.Char:
      case VariantType.Integer:
        return this.n !== 0;
      case VariantType.Long:
        return this.l !== 0n;
      default:
        throw conversionError(ctx, 'Implicit bool from ' + this.getTypeString());
    }
  }

  /** (int)variant. */
  toInt(ctx: VariantContext): number {
    switch (this.varType) {
      case VariantType.Byte:
      case VariantType.Integer:
        return this.n;
      case VariantType.Long:
        return Number(BigInt.asIntN(32, this.l));
      default:
        throw conversionError(ctx);
    }
  }

  /** (long)variant. */
  toLong(ctx: VariantContext): bigint {
    switch (this.varType) {
      case VariantType.Byte:
      case VariantType.Integer:
        return BigInt(this.n);
      case VariantType.Long:
        return this.l;
      default:
        throw conversionError(ctx);
    }
  }

  /** (byte)variant. */
  toByte(ctx: VariantContext): number {
    switch (this.varType) {
      case VariantType.Byte:
        return this.n;
      case VariantType.Char:
      case VariantType.Integer:
        return this.n & 0xff;
      case VariantType.Long:
        return Number(this.l & 0xffn);
      default:
        throw conversionError(ctx);
    }
  }

  /** (char)variant as a UTF-16 code unit. */
  toCharCode(ctx: VariantContext): number {
    switch (this.varType) {
      case VariantType.Byte:
      case VariantType.Char:
        return this.n;
      case VariantType.Integer:
      case VariantType.Long:
        // C# parity: the switch of operator char has no Integer or Long case, so they give '\0'.
        return 0;
      default:
        throw conversionError(ctx);
    }
  }

  /** (short)variant. */
  toShort(ctx: VariantContext): number {
    switch (this.varType) {
      case VariantType.Byte:
      case VariantType.Char:
        return (this.n << 16) >> 16;
      case VariantType.Integer:
        return (this.n << 16) >> 16;
      case VariantType.Long:
        return Number(BigInt.asIntN(16, this.l));
      default:
        throw conversionError(ctx);
    }
  }

  /** (decimal)variant. */
  toDecimal(ctx: VariantContext): CsDecimal {
    switch (this.varType) {
      case VariantType.Byte:
      case VariantType.Char:
      case VariantType.Integer:
        return CsDecimal.fromInteger(this.n);
      case VariantType.Decimal:
        return this.d;
      case VariantType.Double:
        return CsDecimal.fromDouble(this.n);
      case VariantType.Long:
        return CsDecimal.fromInteger(this.l);
      default:
        throw conversionError(ctx);
    }
  }

  /** (double)variant. */
  toDouble(ctx: VariantContext): number {
    switch (this.varType) {
      case VariantType.Byte:
      case VariantType.Integer:
      case VariantType.Double:
        return this.n;
      case VariantType.Long:
        return Number(this.l);
      case VariantType.Decimal:
        return this.d.toDouble();
      default:
        throw conversionError(ctx);
    }
  }

  /** (DateTime)variant. */
  toDateTime(ctx: VariantContext): RpDateTime {
    if (this.varType === VariantType.DateTime) return this.dt;
    throw conversionError(ctx);
  }

  /**
   * (string)variant: the text of a String or a Char; null for every other type (the unset
   * string field of the C# struct); Binary throws.
   */
  toImplicitString(ctx: VariantContext): string | null {
    switch (this.varType) {
      case VariantType.Char:
        return String.fromCharCode(this.n);
      case VariantType.String:
        return this.s;
      case VariantType.Binary:
        throw conversionError(ctx);
      default:
        return null;
    }
  }

  // -------------------------------------------------------------------------------------------
  // Text

  /** Variant.ToString(). */
  toString(ctx?: VariantContext): string {
    if (ctx === undefined) return this.debugString();
    const nfi = ctx.culture.number;
    switch (this.varType) {
      case VariantType.Null:
        return '';
      case VariantType.Boolean:
        return this.b ? 'True' : 'False';
      case VariantType.Byte:
        return this.n.toString();
      case VariantType.Char:
        return String.fromCharCode(this.n);
      case VariantType.Integer:
        return formatInteger(this.n, '', nfi, 32);
      case VariantType.Long:
        return formatInteger(this.l, '', nfi, 64);
      case VariantType.Decimal:
        return formatDecimal(this.d, '', nfi);
      case VariantType.Double:
        // 15 significant digits, as the Delphi engine and the .NET Framework: the shortest text that
        // reads back as the same Double shows the noise of the binary value (0.1+0.2 as
        // 0,30000000000000004)
        // (a negative zero is "-0" for .NET Core 3 and later: the zero)
        return this.n === 0 ? '0' : formatDouble(this.n, 'G15', nfi);
      case VariantType.DateTime:
        return formatDateTime(this.dt, '', ctx.culture, ctx.timeZone);
      case VariantType.String:
        return this.s;
      case VariantType.Binary:
        throw conversionError(ctx);
    }
  }

  /** Invariant text for debugging (not a C# behaviour). */
  private debugString(): string {
    switch (this.varType) {
      case VariantType.Null:
        return '';
      case VariantType.Boolean:
        return this.b ? 'True' : 'False';
      case VariantType.Char:
        return String.fromCharCode(this.n);
      case VariantType.Long:
        return this.l.toString();
      case VariantType.Decimal:
        return this.d.toInvariantString();
      case VariantType.DateTime:
        return this.dt.toIsoString();
      case VariantType.Binary:
        return toBase64String(this.bin);
      case VariantType.String:
        return this.s;
      default:
        return String(this.v);
    }
  }

  /**
   * DisplayText: a date at midnight without its time, a time without a date (day 0001-01-01, a
   * time column) without its date, a decimal without trailing zeros (G29). Midnight of day
   * 0001-01-01 is also DateTime.MinValue, a date: it keeps printing as a date.
   */
  displayText(ctx: VariantContext): string {
    const delphi = ctx.delphiMasks === true;
    switch (this.varType) {
      case VariantType.DateTime: {
        const timeOnly = this.dt.days === 0 && this.dt.tickOfDay !== 0;
        if (delphi) {
          // A report converted from Delphi: the format settings Delphi takes from Windows (the short
          // date, and the long time when it has one; a time alone, on the day zero of OLE too, is
          // the long time)
          const settings = delphiFormatSettings(ctx.culture);
          const oleZero = this.dt.year === 1899 && this.dt.month === 12 && this.dt.day === 30;
          return formatDateTimeDelphi(this.dt, timeOnly || (oleZero && this.dt.tickOfDay !== 0) ? 'tt' : 'c', settings);
        }
        if (timeOnly) return formatDateTime(this.dt, 'T', ctx.culture, ctx.timeZone);
        return this.dt.tickOfDay === 0 ? formatDateTime(this.dt, 'd', ctx.culture, ctx.timeZone) : this.toString(ctx);
      }
      case VariantType.Decimal:
        // In a report converted from Delphi: the Currency or the Double it is in Delphi
        if (delphi) return delphiDecimalText(this.d, ctx.culture.number);
        return formatDecimal(this.d, 'G29', ctx.culture.number);
      case VariantType.Double:
        if (delphi) return delphiFloatText(this.n, ctx.culture.number);
        return this.toString(ctx);
      default:
        return this.toString(ctx);
    }
  }

  private static defaultDateTimeFormat(ctx: VariantContext, paramtype: ParamType): string {
    const df = ctx.culture.date;
    if (paramtype === ParamType.Date) return df.shortDatePattern;
    if (paramtype === ParamType.Time) return df.shortTimePattern;
    return df.fullDateTimePattern;
  }

  /** Variant.ToString(displayformat, paramtype, printnulls). */
  toFormatString(ctx: VariantContext, displayformat: string, paramtype: ParamType = ParamType.Unknown, printnulls = true): string {
    let value: Variant = this;
    if (paramtype !== ParamType.Unknown) {
      if (value.isNull) {
        switch (paramtype) {
          case ParamType.String:
          case ParamType.ExpreA:
          case ParamType.ExpreB:
          case ParamType.Multiple:
          case ParamType.Subst:
            value = Variant.fromString('');
            break;
          case ParamType.Integer:
          case ParamType.Double:
          case ParamType.Currency:
            value = Variant.fromInteger(0);
            break;
          case ParamType.Bool:
            value = Variant.fromBoolean(false);
            break;
        }
      }
    } else if (value.isNull) {
      return '';
    }
    const atype = value.varType;
    const isDateParam = paramtype === ParamType.Date || paramtype === ParamType.Time || paramtype === ParamType.DateTime;
    const delphi = ctx.delphiMasks === true;
    if (!value.isNull && displayformat.length === 0 && printnulls) {
      // A date, or a number in a date parameter, in the default format of the type
      if (isDateParam && (value.isNumber() || atype === VariantType.DateTime)) return Variant.defaultDateText(ctx, value.dateValue(ctx), paramtype);
      return value.displayText(ctx);
    }
    switch (atype) {
      case VariantType.Null:
        return '';
      case VariantType.Integer:
      case VariantType.Long:
      case VariantType.Byte:
      case VariantType.Decimal:
      case VariantType.Double:
        if (Variant.equals(value, Variant.fromInteger(0), ctx) && !printnulls) return '';
        if (isDateParam) {
          // A number in a date parameter is a date, with the mask or the default format of the
          // type (PrintNulls does not change it)
          const adate = value.dateValue(ctx);
          if (displayformat.length === 0) return Variant.defaultDateText(ctx, adate, paramtype);
          if (delphi) return formatDateTimeDelphi(adate, displayformat, delphiFormatSettings(ctx.culture));
          return formatDateTime(adate, dateFormatMask(displayformat), ctx.culture, ctx.timeZone);
        }
        if (displayformat.length === 0) return value.displayText(ctx);
        if (displayformat[0] === '*') return formatDouble(value.toDouble(ctx), displayformat.substring(1), ctx.culture.number);
        return value.formatNumber(ctx, delphi ? delphiNumberMaskToDotNet(displayformat) : displayformat);
      case VariantType.DateTime: {
        // A mask of the report: Delphi's FormatDateTime for a report converted from Delphi
        if (displayformat.length > 0) {
          if (delphi) return formatDateTimeDelphi(value.dt, displayformat, delphiFormatSettings(ctx.culture));
          return formatDateTime(value.dt, dateFormatMask(displayformat), ctx.culture, ctx.timeZone);
        }
        if (isDateParam && !delphi) {
          // A time without a date (a time column: day 0001-01-01) is its time only, as Delphi's
          // FormatDateTime leaves out a zero date (midnight of that day is DateTime.MinValue, a date)
          if (paramtype !== ParamType.Date && value.dt.days === 0 && value.dt.tickOfDay !== 0)
            return formatDateTime(value.dt, 'T', ctx.culture, ctx.timeZone);
          return Variant.defaultDateText(ctx, value.dt, paramtype);
        }
        // No mask and no date type: as with PrintNulls (it gave the long date and time pattern)
        return value.displayText(ctx);
      }
      case VariantType.String: {
        const astring = value.s;
        // Delphi's Format (%s) in a report converted from Delphi, .NET's ({0}) in the others
        if (displayformat.length > 0) return delphi ? delphiFormatString(displayformat, astring) : compositeFormat(displayformat, [astring]);
        return astring;
      }
      case VariantType.Boolean:
        return delphi ? delphiFormatString(displayformat, value.b ? 'True' : 'False') : compositeFormat(displayformat, [value.b ? 'True' : 'False']);
      default:
        return '';
    }
  }

  /**
   * DateValue: the date of a value in a date parameter: a date, or a number as the OLE date it is
   * in the Delphi engine (the conversion of a number to a date threw).
   */
  private dateValue(ctx: VariantContext): RpDateTime {
    if (this.varType === VariantType.DateTime) return this.dt;
    return RpDateTime.fromOADate(this.toDouble(ctx));
  }

  /**
   * DefaultDateText: a date in the default format of its parameter type. The patterns of .NET are
   * used as they are (through dateFormatMask the h of a 12 hour pattern became the 24 hour clock:
   * "13:45:34 PM"); a report converted from Delphi takes the short date, the short time or both,
   * as FormatVariant of the Delphi engine.
   */
  private static defaultDateText(ctx: VariantContext, value: RpDateTime, paramtype: ParamType): string {
    if (ctx.delphiMasks === true) {
      const mask = paramtype === ParamType.Date ? 'ddddd' : paramtype === ParamType.Time ? 't' : 'ddddd t';
      return formatDateTimeDelphi(value, mask, delphiFormatSettings(ctx.culture));
    }
    return formatDateTime(value, Variant.defaultDateTimeFormat(ctx, paramtype), ctx.culture, ctx.timeZone);
  }

  /**
   * FormatNumber: a number with a custom format of .NET: a Decimal and a Long with their own
   * digits (through a Double, more than 15 digits were lost), and a negative value the mask rounds
   * to zero as the zero (.NET keeps the sign: "-0,00"), as Delphi's FormatFloat.
   */
  private formatNumber(ctx: VariantContext, mask: string): string {
    const nfi = ctx.culture.number;
    try {
      if (this.varType === VariantType.Decimal) {
        const text = formatDecimal(this.d, mask, nfi);
        if (this.d.compareTo(CsDecimal.zero) >= 0) return text;
        const zero = formatDecimal(CsDecimal.zero, mask, nfi);
        return formatDecimal(this.d.negate(), mask, nfi) === zero ? zero : text;
      }
      if (this.varType === VariantType.Long) {
        const text = formatInteger(this.l, mask, nfi, 64);
        if (this.l >= 0n || this.l === -9223372036854775808n) return text;
        const zero = formatInteger(0n, mask, nfi, 64);
        return formatInteger(-this.l, mask, nfi, 64) === zero ? zero : text;
      }
    } catch (e) {
      // A standard format the type has not (R on a Decimal in the .NET Framework): as a Double,
      // as always
      if (!(e instanceof NetException) || e.netType !== 'FormatException') throw e;
    }
    const avalue = this.toDouble(ctx);
    const text = formatDouble(avalue, mask, nfi);
    if (!(avalue < 0)) return text;
    const zero = formatDouble(0, mask, nfi);
    return formatDouble(-avalue, mask, nfi) === zero ? zero : text;
  }

  // -------------------------------------------------------------------------------------------
  // Comparison

  /** Variant.CompareTo(Variant): coerces different types first (VariantCoercion). */
  static compare(a: Variant, b: Variant, ctx: VariantContext): number {
    // A date and a number compare as numbers (the date by its OLE value), as Delphi compares a
    // TDateTime: a time without a date (a time column) is a time of 30/12/1899, greater than 0
    if (a.varType === VariantType.DateTime && b.isNumber()) return compareDoubles(a.dt.toOADate(), b.toDouble(ctx));
    if (b.varType === VariantType.DateTime && a.isNumber()) return compareDoubles(a.toDouble(ctx), b.dt.toOADate());
    if (a.varType !== b.varType) {
      const c = coercion(a, b, ctx);
      if (c !== null) return Variant.compare(c[0], c[1], ctx);
    }
    if (b.isNull) return a.isNull ? 0 : -1;
    switch (a.varType) {
      case VariantType.Null:
        return 1;
      case VariantType.Integer:
        if (b.isBoolean()) {
          // C# parity: unreachable once coerced (both are Integer here), kept as in C#.
          let partial = true;
          if (Variant.equals(b, Variant.fromInteger(0), ctx)) partial = false;
          return compareBools(partial, b.toBool(ctx));
        }
        return CsDecimal.fromInteger(a.n).compareTo(b.toDecimal(ctx));
      case VariantType.Long:
        return CsDecimal.fromInteger(a.l).compareTo(b.toDecimal(ctx));
      case VariantType.Boolean: {
        let other = b;
        if (other.isInteger()) other = Variant.fromBoolean(!Variant.equals(other, Variant.fromInteger(0), ctx));
        return compareBools(a.b, other.toBool(ctx));
      }
      case VariantType.Char:
        return compareNumbers(a.n, b.toCharCode(ctx));
      case VariantType.String: {
        const astring = b.toImplicitString(ctx);
        // String.CompareTo(null) is 1
        if (astring === null) return 1;
        return compareCulture(a.s, astring, ctx.culture.name);
      }
      case VariantType.Byte:
        return compareNumbers(a.n, b.toByte(ctx));
      case VariantType.Double:
        return compareDoubles(a.n, b.toDouble(ctx));
      case VariantType.Decimal:
        return a.d.compareTo(b.toDecimal(ctx));
      case VariantType.DateTime:
        return a.dt.compareTo(b.toDateTime(ctx));
      case VariantType.Binary: {
        const x = a.bin;
        const y = b.bin;
        if (x.length !== y.length) return -1;
        for (let i = 0; i < x.length; i++) if (x[i] !== y[i]) return -1;
        return 0;
      }
    }
  }

  /** operator ==: two Nulls are equal, Null and a value are not. */
  static equals(a: Variant, b: Variant, ctx: VariantContext): boolean {
    if (a.isNull || b.isNull) return a.isNull && b.isNull;
    return Variant.compare(a, b, ctx) === 0;
  }

  /** operator != (no Null special case, as in C#). */
  static notEquals(a: Variant, b: Variant, ctx: VariantContext): boolean {
    return Variant.compare(a, b, ctx) !== 0;
  }

  static lessThan(a: Variant, b: Variant, ctx: VariantContext): boolean {
    return Variant.compare(a, b, ctx) < 0;
  }

  static greaterThan(a: Variant, b: Variant, ctx: VariantContext): boolean {
    return Variant.compare(a, b, ctx) > 0;
  }

  static lessOrEqual(a: Variant, b: Variant, ctx: VariantContext): boolean {
    return Variant.compare(a, b, ctx) <= 0;
  }

  static greaterOrEqual(a: Variant, b: Variant, ctx: VariantContext): boolean {
    return Variant.compare(a, b, ctx) >= 0;
  }

  /** operator | (both operands converted, then or). */
  static or(a: Variant, b: Variant, ctx: VariantContext): boolean {
    if (a.varType !== b.varType) {
      const c = coercion(a, b, ctx);
      if (c !== null) [a, b] = c;
    }
    const a1 = a.toBool(ctx);
    const a2 = b.toBool(ctx);
    return a1 || a2;
  }

  /** operator & (both operands converted, then and). */
  static and(a: Variant, b: Variant, ctx: VariantContext): Variant {
    if (a.varType !== b.varType) {
      const c = coercion(a, b, ctx);
      if (c !== null) [a, b] = c;
    }
    const a1 = a.toBool(ctx);
    const a2 = b.toBool(ctx);
    return Variant.fromBoolean(a1 && a2);
  }

  // -------------------------------------------------------------------------------------------
  // Arithmetic

  /**
   * TryTextAsNumber: the text read with the culture (Float, thousands, parentheses) as a decimal,
   * else as a double.
   */
  private static tryTextAsNumber(text: string, ctx: VariantContext): Variant | undefined {
    if (text.length === 0) return undefined;
    const styles = NumberStyles.Float | NumberStyles.AllowThousands | NumberStyles.AllowParentheses;
    const d = tryParseDecimal(text, styles, ctx.culture.number);
    if (d !== undefined) return Variant.fromDecimal(d);
    const f = tryParseDouble(text, styles, ctx.culture.number);
    if (f !== undefined) return Variant.fromDouble(f);
    return undefined;
  }

  /**
   * ExpressionOperand, an operand of the -, * and / of an expression (and of the sign): a text that
   * is a number is that number, as the Delphi engine converts it ('6'-2 is 4, STR(2)*2 is 4; it was
   * a type conversion error). A text that is not a number stays a text, and the operator fails
   * with it as always.
   */
  static expressionOperand(v: Variant, ctx: VariantContext): Variant {
    if (v.varType === VariantType.String) {
      const number = Variant.tryTextAsNumber(v.s, ctx);
      if (number !== undefined) return number;
    }
    return v;
  }

  /**
   * ExpressionSum, the + of an expression: a number plus a text is the sum when the text is a
   * number (10+'7' is 17), otherwise both texts joined (10+'a' is '10a'); anything else is the +
   * of two variants.
   */
  static expressionSum(a: Variant, b: Variant, ctx: VariantContext): Variant {
    // In a report converted from Delphi the number is written as the Delphi engine writes it: a
    // decimal without the zeros of its scale and with 15 digits ('x'+1.10 is x1,1; else x1,10)
    const numberText = (v: Variant): string => (ctx.delphiMasks === true ? v.displayText(ctx) : v.toString(ctx));
    if (a.isNumber() && b.varType === VariantType.String) {
      const number2 = Variant.tryTextAsNumber(b.s, ctx);
      if (number2 !== undefined) return Variant.add(a, number2, ctx);
      return Variant.fromString(numberText(a) + b.s);
    }
    if (a.varType === VariantType.String && b.isNumber()) {
      const number1 = Variant.tryTextAsNumber(a.s, ctx);
      if (number1 !== undefined) return Variant.add(number1, b, ctx);
      return Variant.fromString(a.s + numberText(b));
    }
    return Variant.add(a, b, ctx);
  }

  private static widenByteChar(v: Variant): Variant {
    if (v.varType === VariantType.Byte || v.varType === VariantType.Char) return Variant.fromInteger(v.n);
    return v;
  }

  /** operator +. */
  static add(a: Variant, b: Variant, ctx: VariantContext): Variant {
    switch (a.varType) {
      case VariantType.Null:
        switch (b.varType) {
          case VariantType.Byte:
          case VariantType.Integer:
          case VariantType.Long:
            a = Variant.fromInteger(0);
            break;
          case VariantType.String:
            a = Variant.fromString('');
            break;
          case VariantType.Decimal:
            a = Variant.fromDecimal(CsDecimal.zero);
            break;
          case VariantType.Double:
            a = Variant.fromDouble(0);
            break;
          case VariantType.Null:
            return Variant.null;
        }
        break;
      case VariantType.Byte:
      case VariantType.Char:
        a = Variant.widenByteChar(a);
        break;
    }
    b = Variant.widenByteChar(b);
    const error = (): UnNamedException =>
      conversionError(ctx, ' Variant+ ' + a.getTypeString() + '-' + b.getTypeString());
    switch (a.varType) {
      case VariantType.Integer:
        switch (b.varType) {
          case VariantType.Null:
            return a;
          case VariantType.Integer:
            return Variant.integerOrLong(BigInt(a.n) + BigInt(b.n));
          case VariantType.Long:
            return Variant.fromLong(BigInt(a.n) + b.l);
          case VariantType.Double:
            return Variant.fromDouble(a.n + b.n);
          case VariantType.Decimal:
            return Variant.fromDecimal(CsDecimal.fromInteger(a.n).add(b.d));
          case VariantType.DateTime:
            return Variant.fromDateTime(b.dt.addDays(a.n));
          default:
            throw error();
        }
      case VariantType.Long:
        switch (b.varType) {
          case VariantType.Null:
            return a;
          case VariantType.Integer:
            return Variant.fromLong(a.l + BigInt(b.n));
          case VariantType.Long:
            return Variant.fromLong(a.l + b.l);
          case VariantType.Double:
            return Variant.fromDouble(Number(a.l) + b.n);
          case VariantType.Decimal:
            return Variant.fromDecimal(CsDecimal.fromInteger(a.l).add(b.d));
          case VariantType.DateTime:
            return Variant.fromDateTime(b.dt.addDays(Number(a.l)));
          default:
            throw error();
        }
      case VariantType.Double:
        switch (b.varType) {
          case VariantType.Null:
            return a;
          case VariantType.Integer:
          case VariantType.Double:
            return Variant.fromDouble(a.n + b.n);
          case VariantType.Long:
            return Variant.fromDouble(a.n + Number(b.l));
          case VariantType.Decimal:
            return Variant.fromDouble(a.n + b.d.toDouble());
          case VariantType.DateTime:
            return Variant.fromDateTime(b.dt.addDays(a.n));
          default:
            throw error();
        }
      case VariantType.Decimal:
        switch (b.varType) {
          case VariantType.Null:
            return a;
          case VariantType.Integer:
            return Variant.fromDecimal(a.d.add(CsDecimal.fromInteger(b.n)));
          case VariantType.Long:
            return Variant.fromDecimal(a.d.add(CsDecimal.fromInteger(b.l)));
          case VariantType.Double:
            return Variant.fromDouble(a.d.toDouble() + b.n);
          case VariantType.Decimal:
            return Variant.fromDecimal(a.d.add(b.d));
          case VariantType.DateTime:
            return Variant.fromDateTime(b.dt.addDays(a.d.toDouble()));
          default:
            throw error();
        }
      case VariantType.DateTime:
        switch (b.varType) {
          case VariantType.Null:
            return a;
          case VariantType.Integer:
          case VariantType.Double:
            return Variant.fromDateTime(a.dt.addDays(b.n));
          case VariantType.Long:
            return Variant.fromDateTime(a.dt.addDays(Number(b.l)));
          case VariantType.Decimal:
            return Variant.fromDateTime(a.dt.addDays(b.d.toDouble()));
          case VariantType.DateTime:
            // A date plus a date, as the Delphi engine adds two TDateTime values: the date of the
            // sum of their OLE dates, so a date plus a time (TODAY+TIME) is the date with the time.
            // It was a type error
            return Variant.fromDateTime(RpDateTime.fromOADate(a.dt.toOADate() + b.dt.toOADate()));
          default:
            throw error();
        }
      case VariantType.String:
        switch (b.varType) {
          case VariantType.Null:
            return a;
          case VariantType.String:
            return Variant.fromString(a.s + b.s);
          default:
            throw error();
        }
      default:
        throw error();
    }
  }

  /**
   * NumberMinusDate: a number minus a date, as the Delphi engine subtracts a TDateTime from a
   * number: the date of the number minus the OLE date of the date (it gave the date minus the
   * number: the operands the other way round).
   */
  private static numberMinusDate(number: number, date: RpDateTime): Variant {
    return Variant.fromDateTime(RpDateTime.fromOADate(number - date.toOADate()));
  }

  /** operator - (binary). */
  static sub(a: Variant, b: Variant, ctx: VariantContext): Variant {
    a = a.varType === VariantType.Null ? Variant.fromDecimal(CsDecimal.zero) : Variant.widenByteChar(a);
    b = b.varType === VariantType.Null ? Variant.fromDecimal(CsDecimal.zero) : Variant.widenByteChar(b);
    const error = (): UnNamedException => conversionError(ctx);
    switch (a.varType) {
      case VariantType.Integer:
        switch (b.varType) {
          case VariantType.Integer:
            return Variant.integerOrLong(BigInt(a.n) - BigInt(b.n));
          case VariantType.Long:
            return Variant.fromLong(BigInt(a.n) - b.l);
          case VariantType.Double:
            return Variant.fromDouble(a.n - b.n);
          case VariantType.Decimal:
            return Variant.fromDecimal(CsDecimal.fromInteger(a.n).sub(b.d));
          case VariantType.DateTime:
            return Variant.numberMinusDate(a.n, b.dt);
          default:
            throw error();
        }
      case VariantType.Long:
        switch (b.varType) {
          case VariantType.Integer:
            return Variant.fromLong(a.l - BigInt(b.n));
          case VariantType.Long:
            return Variant.fromLong(a.l - b.l);
          case VariantType.Double:
            return Variant.fromDouble(Number(a.l) - b.n);
          case VariantType.Decimal:
            return Variant.fromDecimal(CsDecimal.fromInteger(a.l).sub(b.d));
          case VariantType.DateTime:
            return Variant.numberMinusDate(Number(a.l), b.dt);
          default:
            throw error();
        }
      case VariantType.Double:
        switch (b.varType) {
          case VariantType.Integer:
          case VariantType.Double:
            return Variant.fromDouble(a.n - b.n);
          case VariantType.Long:
            return Variant.fromDouble(a.n - Number(b.l));
          case VariantType.Decimal:
            return Variant.fromDouble(a.n - b.d.toDouble());
          case VariantType.DateTime:
            return Variant.numberMinusDate(a.n, b.dt);
          default:
            throw error();
        }
      case VariantType.Decimal:
        switch (b.varType) {
          case VariantType.Integer:
            return Variant.fromDecimal(a.d.sub(CsDecimal.fromInteger(b.n)));
          case VariantType.Long:
            return Variant.fromDecimal(a.d.sub(CsDecimal.fromInteger(b.l)));
          case VariantType.Double:
            return Variant.fromDouble(a.d.toDouble() - b.n);
          case VariantType.Decimal:
            return Variant.fromDecimal(a.d.sub(b.d));
          case VariantType.DateTime:
            return Variant.numberMinusDate(a.d.toDouble(), b.dt);
          default:
            throw error();
        }
      case VariantType.DateTime:
        switch (b.varType) {
          case VariantType.Integer:
          case VariantType.Double:
            return Variant.fromDateTime(a.dt.addDays(-b.n));
          case VariantType.Long:
            return Variant.fromDateTime(a.dt.addDays(-Number(b.l)));
          case VariantType.Decimal:
            return Variant.fromDateTime(a.dt.addDays(-b.d.toDouble()));
          case VariantType.DateTime:
            // A time without a date is kept on the day 0001-01-01: against a date, each one counts
            // as its OLE value, as in the Delphi engine (NOW-TIME gave the days since the year 1)
            if ((a.dt.days === 0) !== (b.dt.days === 0)) return Variant.fromDouble(a.dt.toOADate() - b.dt.toOADate());
            return Variant.fromDouble(a.dt.totalDaysSince(b.dt));
          default:
            throw error();
        }
      default:
        throw error();
    }
  }

  /** operator - (unary). */
  static negate(a: Variant, ctx: VariantContext): Variant {
    switch (a.varType) {
      case VariantType.Null:
        // C# parity: the Null case sets 0.0m, a decimal zero with one decimal place.
        a = Variant.fromDecimal(CsDecimal.fromParts(0n, 1, false));
        break;
      case VariantType.Byte:
      case VariantType.Char:
        a = Variant.widenByteChar(a);
        break;
    }
    switch (a.varType) {
      case VariantType.Integer:
        return Variant.fromInteger(-a.n);
      case VariantType.Long:
        return Variant.fromLong(-a.l);
      case VariantType.Double:
        return Variant.fromDouble(-a.n);
      case VariantType.Decimal:
        return Variant.fromDecimal(a.d.negate());
      default:
        throw conversionError(ctx);
    }
  }

  /** operator *. */
  static mul(a: Variant, b: Variant, ctx: VariantContext): Variant {
    if (a.varType === VariantType.Null) return Variant.null;
    a = Variant.widenByteChar(a);
    if (b.varType === VariantType.Null) return Variant.null;
    b = Variant.widenByteChar(b);
    const error = (): UnNamedException => conversionError(ctx);
    switch (a.varType) {
      case VariantType.Integer:
        switch (b.varType) {
          case VariantType.Integer:
            return Variant.integerOrLong(BigInt(a.n) * BigInt(b.n));
          case VariantType.Long:
            return Variant.fromLong(BigInt(a.n) * b.l);
          case VariantType.Double:
            return Variant.fromDouble(a.n * b.n);
          case VariantType.Decimal:
            return Variant.fromDecimal(CsDecimal.fromInteger(a.n).mul(b.d));
          default:
            throw error();
        }
      case VariantType.Long:
        switch (b.varType) {
          case VariantType.Integer:
            return Variant.fromLong(a.l * BigInt(b.n));
          case VariantType.Long:
            return Variant.fromLong(a.l * b.l);
          case VariantType.Double:
            return Variant.fromDouble(Number(a.l) * b.n);
          case VariantType.Decimal:
            return Variant.fromDecimal(CsDecimal.fromInteger(a.l).mul(b.d));
          default:
            throw error();
        }
      case VariantType.Double:
        switch (b.varType) {
          case VariantType.Integer:
          case VariantType.Double:
            return Variant.fromDouble(a.n * b.n);
          case VariantType.Long:
            return Variant.fromDouble(a.n * Number(b.l));
          case VariantType.Decimal:
            return Variant.fromDouble(a.n * b.d.toDouble());
          default:
            throw error();
        }
      case VariantType.Decimal:
        switch (b.varType) {
          case VariantType.Integer:
            return Variant.fromDecimal(a.d.mul(CsDecimal.fromInteger(b.n)));
          case VariantType.Long:
            return Variant.fromDecimal(a.d.mul(CsDecimal.fromInteger(b.l)));
          case VariantType.Double:
            return Variant.fromDouble(a.d.toDouble() * b.n);
          case VariantType.Decimal:
            return Variant.fromDecimal(a.d.mul(b.d));
          default:
            throw error();
        }
      default:
        throw error();
    }
  }

  /** operator /. Int / Int is a Double; a decimal division by zero throws. */
  static div(a: Variant, b: Variant, ctx: VariantContext): Variant {
    if (a.varType === VariantType.Null) return Variant.null;
    a = Variant.widenByteChar(a);
    if (b.varType === VariantType.Null) return Variant.null;
    b = Variant.widenByteChar(b);
    const error = (): UnNamedException => conversionError(ctx);
    switch (a.varType) {
      case VariantType.Integer:
        switch (b.varType) {
          case VariantType.Integer:
          case VariantType.Double:
            return Variant.fromDouble(a.n / b.n);
          case VariantType.Long:
            return Variant.fromDouble(a.n / Number(b.l));
          case VariantType.Decimal:
            return Variant.fromDecimal(CsDecimal.fromInteger(a.n).div(b.d));
          default:
            throw error();
        }
      case VariantType.Long:
        switch (b.varType) {
          case VariantType.Integer:
          case VariantType.Double:
            return Variant.fromDouble(Number(a.l) / b.n);
          case VariantType.Long:
            return Variant.fromDouble(Number(a.l) / Number(b.l));
          case VariantType.Decimal:
            return Variant.fromDecimal(CsDecimal.fromInteger(a.l).div(b.d));
          default:
            throw error();
        }
      case VariantType.Double:
        switch (b.varType) {
          case VariantType.Integer:
          case VariantType.Double:
            return Variant.fromDouble(a.n / b.n);
          case VariantType.Long:
            return Variant.fromDouble(a.n / Number(b.l));
          case VariantType.Decimal:
            return Variant.fromDouble(a.n / b.d.toDouble());
          default:
            throw error();
        }
      case VariantType.Decimal:
        switch (b.varType) {
          case VariantType.Integer:
            return Variant.fromDecimal(a.d.div(CsDecimal.fromInteger(b.n)));
          case VariantType.Long:
            return Variant.fromDecimal(a.d.div(CsDecimal.fromInteger(b.l)));
          case VariantType.Double:
            return Variant.fromDouble(a.d.toDouble() / b.n);
          case VariantType.Decimal:
            return Variant.fromDecimal(a.d.div(b.d));
          default:
            throw error();
        }
      default:
        throw error();
    }
  }

  /** Variant.Abs. */
  abs(ctx: VariantContext): Variant {
    if (!this.isNumber()) throw conversionError(ctx);
    switch (this.varType) {
      case VariantType.Decimal:
        return Variant.fromDecimal(this.d.abs());
      case VariantType.Double:
        return Variant.fromDouble(Math.abs(this.n));
      case VariantType.Integer:
        if (this.n === -2147483648) throw overflowException('Negating the minimum value of a twos complement number is invalid.');
        return Variant.fromInteger(Math.abs(this.n));
      case VariantType.Long:
        if (this.l === -9223372036854775808n) throw overflowException('Negating the minimum value of a twos complement number is invalid.');
        return Variant.fromLong(this.l < 0n ? -this.l : this.l);
      default:
        return Variant.fromDouble(Math.abs(this.toDouble(ctx)));
    }
  }

  // -------------------------------------------------------------------------------------------
  // Host values and JSON

  /**
   * AsObject: the host value (null for Null; number for Byte, Char code, Integer, Double; bigint
   * for Long; CsDecimal; RpDateTime; string; boolean; and, unlike C#, the bytes of a Binary).
   */
  asObject(): null | boolean | number | bigint | string | CsDecimal | RpDateTime | Uint8Array {
    if (this.varType === VariantType.Null) return null;
    if (this.varType === VariantType.Binary) return new Uint8Array(this.bin);
    if (this.varType === VariantType.Char) return String.fromCharCode(this.n);
    return this.v as Exclude<Payload, undefined>;
  }

  /**
   * The JSON form {type, value}, type being the VariantType name:
   * Null: null; Boolean: boolean; Byte, Integer, Double: number (NaN and infinities as the
   * strings "NaN", "Infinity", "-Infinity"); Long: number when it is a safe integer, else its
   * digits as a string; Decimal: its invariant text with the scale ("1.50"); Char and String:
   * string; DateTime: "yyyy-MM-ddTHH:mm:ss.fffffff" without zone; Binary: base64.
   */
  toJSON(): VariantJson {
    const type = VariantType[this.varType]!;
    switch (this.varType) {
      case VariantType.Null:
        return { type, value: null };
      case VariantType.Boolean:
        return { type, value: this.b };
      case VariantType.Byte:
      case VariantType.Integer:
        return { type, value: this.n };
      case VariantType.Double:
        if (Number.isNaN(this.n)) return { type, value: 'NaN' };
        if (!Number.isFinite(this.n)) return { type, value: this.n > 0 ? 'Infinity' : '-Infinity' };
        return { type, value: this.n };
      case VariantType.Long:
        return { type, value: this.l >= -9007199254740991n && this.l <= 9007199254740991n ? Number(this.l) : this.l.toString() };
      case VariantType.Decimal:
        return { type, value: this.d.toInvariantString() };
      case VariantType.Char:
        return { type, value: String.fromCharCode(this.n) };
      case VariantType.String:
        return { type, value: this.s };
      case VariantType.DateTime:
        return { type, value: this.dt.toIsoString() };
      case VariantType.Binary:
        return { type, value: toBase64String(this.bin) };
    }
  }

  /** Reads the JSON form of toJSON (numbers may also come as strings and the other way round). */
  static fromJSON(json: VariantJson): Variant {
    const t = (VariantType as unknown as Record<string, number>)[json.type];
    if (t === undefined) throw new NetException('JsonSerializationException', `Unknown VariantType: ${json.type}`);
    const value = json.value;
    if (value === null || value === undefined) return Variant.null;
    switch (t as VariantType) {
      case VariantType.Null:
        return Variant.null;
      case VariantType.Boolean:
        return Variant.fromBoolean(typeof value === 'string' ? value.toLowerCase() === 'true' : Boolean(value));
      case VariantType.Byte:
        return Variant.fromByte(Number(value));
      case VariantType.Integer:
        return Variant.fromInteger(Number(value));
      case VariantType.Double:
        return Variant.fromDouble(Number(value));
      case VariantType.Long:
        return Variant.fromLong(BigInt(typeof value === 'number' ? Math.trunc(value) : String(value)));
      case VariantType.Decimal:
        return Variant.fromDecimal(
          typeof value === 'number' ? CsDecimal.parseInvariant(numberToPlain(value)) : CsDecimal.parseInvariant(String(value)),
        );
      case VariantType.Char:
        return Variant.fromChar(String(value));
      case VariantType.String:
        return Variant.fromString(String(value));
      case VariantType.DateTime:
        return Variant.fromDateTime(RpDateTime.parseIso(String(value), DateTimeKind.Unspecified));
      case VariantType.Binary:
        return Variant.fromBinary(fromBase64String(String(value)));
    }
  }
}

/** A JavaScript number as plain decimal digits (no exponent), for decimals read from JSON. */
function numberToPlain(n: number): string {
  if (Number.isInteger(n) && Math.abs(n) < 1e21) return n.toString();
  const s = n.toString();
  if (!/e/i.test(s)) return s;
  const [m, e] = s.toLowerCase().split('e') as [string, string];
  const exp = parseInt(e, 10);
  const neg = m.startsWith('-');
  const digits = (neg ? m.slice(1) : m).replace('.', '');
  const pointPos = (neg ? m.slice(1) : m).indexOf('.') < 0 ? (neg ? m.length - 1 : m.length) : (neg ? m.slice(1) : m).indexOf('.');
  const pos = pointPos + exp;
  let r: string;
  if (pos <= 0) r = '0.' + '0'.repeat(-pos) + digits;
  else if (pos >= digits.length) r = digits + '0'.repeat(pos - digits.length);
  else r = digits.slice(0, pos) + '.' + digits.slice(pos);
  return (neg ? '-' : '') + r;
}
