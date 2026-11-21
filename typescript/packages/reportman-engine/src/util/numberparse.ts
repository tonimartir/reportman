// .NET number parsing (System.Number.Parsing.cs of .NET 10): TryParseNumber with NumberStyles,
// and the conversions of the parsed digits to double (correctly rounded), decimal (DecCalc
// rounding, half to even) and Int32 / Int64, with an explicit NumberFormatInfo.

import type { NumberFormatData } from './culture.js';
import { CsDecimal } from './decimal.js';
import { formatException, NetMessages, overflowException } from './netexception.js';
import { isWhiteSpace } from './chars.js';

/** System.Globalization.NumberStyles. */
export const NumberStyles = {
  None: 0,
  AllowLeadingWhite: 1,
  AllowTrailingWhite: 2,
  AllowLeadingSign: 4,
  AllowTrailingSign: 8,
  AllowParentheses: 16,
  AllowDecimalPoint: 32,
  AllowThousands: 64,
  AllowExponent: 128,
  AllowCurrencySymbol: 256,
  AllowHexSpecifier: 512,
  Integer: 7,
  HexNumber: 515,
  Number: 111,
  Float: 167,
  Currency: 383,
  Any: 511,
} as const;

type NumberKind = 'Integer' | 'Decimal' | 'FloatingPoint';

interface ParsedNumber {
  digits: string;
  scale: number;
  isNegative: boolean;
  hasNonZeroTail: boolean;
}

const STATE_SIGN = 0x0001;
const STATE_PARENS = 0x0002;
const STATE_DIGITS = 0x0004;
const STATE_NON_ZERO = 0x0008;
const STATE_DECIMAL = 0x0010;
const STATE_CURRENCY = 0x0020;

function isWhite(ch: string): boolean {
  return ch === ' ' || (ch >= '\t' && ch <= '\r');
}

function isDigitAscii(ch: string): boolean {
  return ch.length === 1 && ch >= '0' && ch <= '9';
}

const AT_END = '\0';

/** MatchChars: the position after value at p, or -1; NBSP / NNBSP in value also match a space. */
function matchChars(s: string, p: number, value: string): number {
  if (value.length === 0) return -1;
  let i = 0;
  for (;;) {
    const cp = p < s.length ? s[p]! : AT_END;
    const val = value[i]!;
    if (cp !== val && !((val === '\u00a0' || val === '\u202f') && cp === ' ')) return -1;
    p++;
    i++;
    if (i >= value.length) return p;
  }
}

const HYPHENS = ['\u2012', '\u207b', '\u208b', '\u2212', '\u2796', '\ufe63', '\uff0d'];

function allowHyphenDuringParsing(info: NumberFormatData): boolean {
  const ns = info.negativeSign;
  return ns.length === 1 && HYPHENS.includes(ns);
}

function matchNegativeSignChars(s: string, p: number, info: NumberFormatData): number {
  let ret = matchChars(s, p, info.negativeSign);
  if (ret < 0 && allowHyphenDuringParsing(info) && p < s.length && s[p] === '-') ret = p + 1;
  return ret;
}

/** TryParseNumber + TryStringToNumber: null when the text is not a number for the styles. */
function tryStringToNumber(s: string, styles: number, info: NumberFormatData, kind: NumberKind, maxDigCount: number): ParsedNumber | null {
  const number: ParsedNumber = { digits: '', scale: 0, isNegative: false, hasNonZeroTail: false };
  let decSep: string;
  let groupSep: string;
  let currSymbol = '';
  let parsingCurrency = false;
  if ((styles & NumberStyles.AllowCurrencySymbol) !== 0) {
    currSymbol = info.currencySymbol;
    decSep = info.currencyDecimalSeparator;
    groupSep = info.currencyGroupSeparator;
    parsingCurrency = true;
  } else {
    decSep = info.numberDecimalSeparator;
    groupSep = info.numberGroupSeparator;
  }

  let state = 0;
  let p = 0;
  const at = (i: number): string => (i < s.length ? s[i]! : AT_END);
  let ch = at(p);
  let next: number;

  for (;;) {
    if (
      !isWhite(ch) ||
      (styles & NumberStyles.AllowLeadingWhite) === 0 ||
      ((state & STATE_SIGN) !== 0 && (state & STATE_CURRENCY) === 0 && info.numberNegativePattern !== 2)
    ) {
      if (
        (styles & NumberStyles.AllowLeadingSign) !== 0 &&
        (state & STATE_SIGN) === 0 &&
        ((next = matchChars(s, p, info.positiveSign)) >= 0 ||
          ((next = matchNegativeSignChars(s, p, info)) >= 0 && (number.isNegative = true)))
      ) {
        state |= STATE_SIGN;
        p = next - 1;
      } else if (ch === '(' && (styles & NumberStyles.AllowParentheses) !== 0 && (state & STATE_SIGN) === 0) {
        state |= STATE_SIGN | STATE_PARENS;
        number.isNegative = true;
      } else if (currSymbol.length > 0 && (next = matchChars(s, p, currSymbol)) >= 0) {
        state |= STATE_CURRENCY;
        currSymbol = '';
        p = next - 1;
      } else {
        break;
      }
    }
    ch = at(++p);
  }

  let digCount = 0;
  let digEnd = 0;
  let numberOfTrailingZeros = 0;
  let digits = '';

  for (;;) {
    if (isDigitAscii(ch)) {
      state |= STATE_DIGITS;
      if (ch !== '0' || (state & STATE_NON_ZERO) !== 0) {
        if (digCount < maxDigCount) {
          digits += ch;
          if (ch !== '0' || kind !== 'Integer') digEnd = digCount + 1;
        } else if (ch !== '0') {
          number.hasNonZeroTail = true;
        }
        if ((state & STATE_DECIMAL) === 0) number.scale++;
        if (digCount < maxDigCount) {
          if (ch === '0') numberOfTrailingZeros++;
          else numberOfTrailingZeros = 0;
        }
        digCount++;
        state |= STATE_NON_ZERO;
      } else if ((state & STATE_DECIMAL) !== 0) {
        number.scale--;
      }
    } else if (
      (styles & NumberStyles.AllowDecimalPoint) !== 0 &&
      (state & STATE_DECIMAL) === 0 &&
      ((next = matchChars(s, p, decSep)) >= 0 ||
        (parsingCurrency && (state & STATE_CURRENCY) === 0 && (next = matchChars(s, p, info.numberDecimalSeparator)) >= 0))
    ) {
      state |= STATE_DECIMAL;
      p = next - 1;
    } else if (
      (styles & NumberStyles.AllowThousands) !== 0 &&
      (state & STATE_DIGITS) !== 0 &&
      (state & STATE_DECIMAL) === 0 &&
      ((next = matchChars(s, p, groupSep)) >= 0 ||
        (parsingCurrency && (state & STATE_CURRENCY) === 0 && (next = matchChars(s, p, info.numberGroupSeparator)) >= 0))
    ) {
      p = next - 1;
    } else {
      break;
    }
    ch = at(++p);
  }

  let negExp = false;
  number.digits = digits.slice(0, digEnd);
  if ((state & STATE_DIGITS) !== 0) {
    if ((ch === 'E' || ch === 'e') && (styles & NumberStyles.AllowExponent) !== 0) {
      const temp = p;
      ch = at(++p);
      if ((next = matchChars(s, p, info.positiveSign)) >= 0) {
        ch = at((p = next));
      } else if ((next = matchNegativeSignChars(s, p, info)) >= 0) {
        ch = at((p = next));
        negExp = true;
      }
      if (isDigitAscii(ch)) {
        let exp = 0;
        do {
          if (exp >= 100_000_000) {
            exp = 2147483647;
            number.scale = 0;
            while (isDigitAscii(ch)) ch = at(++p);
            break;
          }
          exp = exp * 10 + (ch.charCodeAt(0) - 48);
          ch = at(++p);
        } while (isDigitAscii(ch));
        if (negExp) exp = -exp;
        number.scale += exp;
      } else {
        p = temp;
        ch = at(p);
      }
    }

    if (kind === 'FloatingPoint' && !number.hasNonZeroTail) {
      const numberOfFractionalDigits = digEnd - number.scale;
      if (numberOfFractionalDigits > 0) {
        numberOfTrailingZeros = Math.min(numberOfTrailingZeros, numberOfFractionalDigits);
        number.digits = number.digits.slice(0, digEnd - numberOfTrailingZeros);
      }
    }

    for (;;) {
      if (!isWhite(ch) || (styles & NumberStyles.AllowTrailingWhite) === 0) {
        if (
          (styles & NumberStyles.AllowTrailingSign) !== 0 &&
          (state & STATE_SIGN) === 0 &&
          ((next = matchChars(s, p, info.positiveSign)) >= 0 ||
            ((next = matchNegativeSignChars(s, p, info)) >= 0 && (number.isNegative = true)))
        ) {
          state |= STATE_SIGN;
          p = next - 1;
        } else if (ch === ')' && (state & STATE_PARENS) !== 0) {
          state &= ~STATE_PARENS;
        } else if (currSymbol.length > 0 && (next = matchChars(s, p, currSymbol)) >= 0) {
          currSymbol = '';
          p = next - 1;
        } else {
          break;
        }
      }
      ch = at(++p);
    }
    if ((state & STATE_PARENS) === 0) {
      if ((state & STATE_NON_ZERO) === 0) {
        if (kind !== 'Decimal') number.scale = 0;
        if (kind === 'Integer' && (state & STATE_DECIMAL) === 0) number.isNegative = false;
      }
      // TrailingZeros: only NUL characters may follow
      for (let i = p; i < s.length; i++) if (s[i] !== '\0') return null;
      return number;
    }
  }
  return null;
}

// ---------------------------------------------------------------------------------------------
// double

function numberToDouble(n: ParsedNumber): number {
  let v: number;
  if (n.digits.length === 0) v = 0;
  else {
    // value = 0.digits * 10^scale; JavaScript's conversion of the text is correctly rounded, as
    // .NET's NumberToDouble is.
    // A non-zero tail beyond the stored digits acts as a sticky digit.
    const digits = n.hasNonZeroTail ? n.digits + '1' : n.digits;
    const exp = n.scale - digits.length;
    if (n.scale > 400) v = Infinity;
    else if (n.scale < -400) v = 0;
    else v = Number(digits + 'e' + exp);
  }
  return n.isNegative ? -v : v;
}

function equalsOrdinalIgnoreCase(a: string, b: string): boolean {
  return a.length === b.length && a.toUpperCase() === b.toUpperCase();
}

function trimWhite(s: string): string {
  let start = 0;
  let end = s.length - 1;
  while (start <= end && isWhiteSpace(s[start]!)) start++;
  while (end >= start && isWhiteSpace(s[end]!)) end--;
  return s.substring(start, end + 1);
}

/** double.TryParse(s, styles, info): undefined when it fails. */
export function tryParseDouble(s: string, styles: number, info: NumberFormatData): number | undefined {
  const n = tryStringToNumber(s, styles, info, 'FloatingPoint', 767 + 1);
  if (n !== null) return numberToDouble(n);
  let valueTrim = trimWhite(s);
  if (equalsOrdinalIgnoreCase(valueTrim, info.positiveInfinitySymbol)) return Infinity;
  if (equalsOrdinalIgnoreCase(valueTrim, info.negativeInfinitySymbol)) return -Infinity;
  if (equalsOrdinalIgnoreCase(valueTrim, info.naNSymbol)) return NaN;
  if (valueTrim.toUpperCase().startsWith(info.positiveSign.toUpperCase())) {
    valueTrim = valueTrim.slice(info.positiveSign.length);
    if (equalsOrdinalIgnoreCase(valueTrim, info.positiveInfinitySymbol)) return Infinity;
    if (equalsOrdinalIgnoreCase(valueTrim, info.naNSymbol)) return NaN;
    return undefined;
  }
  if (
    valueTrim.toUpperCase().startsWith(info.negativeSign.toUpperCase()) &&
    equalsOrdinalIgnoreCase(valueTrim.slice(info.negativeSign.length), info.naNSymbol)
  ) {
    return NaN;
  }
  if (allowHyphenDuringParsing(info) && valueTrim.startsWith('-') && equalsOrdinalIgnoreCase(valueTrim.slice(1), info.naNSymbol)) {
    return NaN;
  }
  return undefined;
}

/** double.Parse(s, styles, info): FormatException when it fails. */
export function parseDouble(s: string, styles: number, info: NumberFormatData): number {
  const v = tryParseDouble(s, styles, info);
  if (v === undefined) throw formatException(NetMessages.parseFailed(s));
  return v;
}

// ---------------------------------------------------------------------------------------------
// decimal

const DECIMAL_PRECISION = 29;

/** TryNumberToDecimal: undefined on overflow. */
function numberToDecimal(n: ParsedNumber): CsDecimal | undefined {
  const dig = n.digits;
  let e = n.scale;
  const sign = n.isNegative;
  if (dig.length === 0) {
    return CsDecimal.fromParts(0n, Math.min(Math.max(-e, 0), 28), sign);
  }
  if (e > DECIMAL_PRECISION) return undefined;
  let p = 0;
  let c = dig.charCodeAt(p);
  const at = (i: number): number => (i < dig.length ? dig.charCodeAt(i) : 0);
  let low64 = 0n;
  const ULONG_MAX_DIV10 = 0xffffffffffffffffn / 10n;
  while (e > -28) {
    e--;
    low64 = low64 * 10n + BigInt(c - 48);
    c = at(++p);
    if (low64 >= ULONG_MAX_DIV10) break;
    if (c === 0) {
      while (e > 0) {
        e--;
        low64 *= 10n;
        if (low64 >= ULONG_MAX_DIV10) break;
      }
      break;
    }
  }
  let high = 0n;
  const UINT_MAX_DIV10 = 0xffffffffn / 10n;
  while (
    (e > 0 || (c !== 0 && e > -28)) &&
    (high < UINT_MAX_DIV10 || (high === UINT_MAX_DIV10 && (low64 < 0x9999999999999999n || (low64 === 0x9999999999999999n && c <= 53))))
  ) {
    // multiply the 96-bit (high:low64) by 10
    let full = ((high << 64n) | low64) * 10n;
    if (c !== 0) {
      full += BigInt(c - 48);
      c = at(++p);
    }
    low64 = full & 0xffffffffffffffffn;
    high = (full >> 64n) & 0xffffffffn;
    e--;
  }
  if (c >= 53) {
    let round = true;
    if (c === 53 && (low64 & 1n) === 0n) {
      c = at(++p);
      let hasZeroTail = !n.hasNonZeroTail;
      while (c !== 0 && hasZeroTail) {
        hasZeroTail = hasZeroTail && c === 48;
        c = at(++p);
      }
      if (hasZeroTail) round = false;
    }
    if (round) {
      low64 = (low64 + 1n) & 0xffffffffffffffffn;
      if (low64 === 0n) {
        high = (high + 1n) & 0xffffffffn;
        if (high === 0n) {
          low64 = 0x999999999999999an;
          high = 0xffffffffn / 10n;
          e++;
        }
      }
    }
  }
  if (e > 0) return undefined;
  if (e <= -DECIMAL_PRECISION) return CsDecimal.fromParts(0n, DECIMAL_PRECISION - 1, sign);
  return CsDecimal.fromParts((high << 64n) | low64, -e, sign);
}

/** decimal.TryParse(s, styles, info): undefined when it fails (also on overflow). */
export function tryParseDecimal(s: string, styles: number, info: NumberFormatData): CsDecimal | undefined {
  const n = tryStringToNumber(s, styles, info, 'Decimal', DECIMAL_PRECISION + 1);
  if (n === null) return undefined;
  return numberToDecimal(n);
}

/** decimal.Parse(s, styles, info): FormatException or OverflowException. */
export function parseDecimal(s: string, styles: number, info: NumberFormatData): CsDecimal {
  const n = tryStringToNumber(s, styles, info, 'Decimal', DECIMAL_PRECISION + 1);
  if (n === null) throw formatException(NetMessages.parseFailed(s));
  const d = numberToDecimal(n);
  if (d === undefined) throw overflowException(NetMessages.overflowDecimal);
  return d;
}

// ---------------------------------------------------------------------------------------------
// Int32 / Int64 (NumberStyles.Integer: TryParseBinaryIntegerStyle)

type IntStatus = { status: 'ok'; value: bigint } | { status: 'failed' } | { status: 'overflow' };

function parseIntegerStyle(s: string, styles: number, info: NumberFormatData, min: bigint, max: bigint): IntStatus {
  if (s.length === 0) return { status: 'failed' };
  let index = 0;
  let num = s[0]!;
  if ((styles & NumberStyles.AllowLeadingWhite) !== 0 && isWhite(num)) {
    do {
      index++;
      if (index >= s.length) return { status: 'failed' };
      num = s[index]!;
    } while (isWhite(num));
  }
  let isNegative = false;
  if ((styles & NumberStyles.AllowLeadingSign) !== 0) {
    if (info.positiveSign === '+' && info.negativeSign === '-') {
      if (num === '-' || num === '+') {
        isNegative = num === '-';
        index++;
        if (index >= s.length) return { status: 'failed' };
        num = s[index]!;
      }
    } else if (allowHyphenDuringParsing(info) && num === '-') {
      isNegative = true;
      index++;
      if (index >= s.length) return { status: 'failed' };
      num = s[index]!;
    } else {
      const rest = s.slice(index);
      if (info.positiveSign.length > 0 && rest.startsWith(info.positiveSign)) {
        index += info.positiveSign.length;
        if (index >= s.length) return { status: 'failed' };
        num = s[index]!;
      } else if (info.negativeSign.length > 0 && rest.startsWith(info.negativeSign)) {
        isNegative = true;
        index += info.negativeSign.length;
        if (index >= s.length) return { status: 'failed' };
        num = s[index]!;
      }
    }
  }
  if (!isDigitAscii(num)) return { status: 'failed' };
  let digits = '';
  while (index < s.length && isDigitAscii(s[index]!)) digits += s[index++]!;
  // trailing white space, then only NUL characters
  if (index < s.length) {
    if (isWhite(s[index]!)) {
      if ((styles & NumberStyles.AllowTrailingWhite) === 0) return { status: 'failed' };
      while (index < s.length && isWhite(s[index]!)) index++;
    }
    for (let i = index; i < s.length; i++) if (s[i] !== '\0') return { status: 'failed' };
  }
  let v = BigInt(digits);
  if (isNegative) v = -v;
  if (v < min || v > max) return { status: 'overflow' };
  return { status: 'ok', value: v };
}

/** int.TryParse(s, styles, info). */
export function tryParseInt32(s: string, styles: number, info: NumberFormatData): number | undefined {
  const r = parseIntegerStyle(s, styles, info, -2147483648n, 2147483647n);
  return r.status === 'ok' ? Number(r.value) : undefined;
}

/** int.Parse(s, styles, info) / Convert.ToInt32(string). */
export function parseInt32(s: string, styles: number, info: NumberFormatData): number {
  const r = parseIntegerStyle(s, styles, info, -2147483648n, 2147483647n);
  if (r.status === 'failed') throw formatException(NetMessages.parseFailed(s));
  if (r.status === 'overflow') throw overflowException(NetMessages.overflowInt32);
  return Number(r.value);
}

/** long.TryParse(s, styles, info). */
export function tryParseInt64(s: string, styles: number, info: NumberFormatData): bigint | undefined {
  const r = parseIntegerStyle(s, styles, info, -9223372036854775808n, 9223372036854775807n);
  return r.status === 'ok' ? r.value : undefined;
}

/** bool.TryParse: "True" / "False" in any case, with white space and NUL around. */
export function tryParseBoolean(s: string): boolean | undefined {
  const check = (v: string): boolean | undefined => {
    if (equalsOrdinalIgnoreCase(v, 'True')) return true;
    if (equalsOrdinalIgnoreCase(v, 'False')) return false;
    return undefined;
  };
  const r = check(s);
  if (r !== undefined) return r;
  let start = 0;
  let end = s.length - 1;
  while (start <= end && (isWhiteSpace(s[start]!) || s[start] === '\0')) start++;
  while (end >= start && (isWhiteSpace(s[end]!) || s[end] === '\0')) end--;
  return check(s.substring(start, end + 1));
}

// ---------------------------------------------------------------------------------------------
// Convert.* of numbers

/** Convert.ToInt32(double): half to even, OverflowException out of range. */
export function convertDoubleToInt32(value: number): number {
  if (value >= 0) {
    if (value < 2147483647.5) {
      let result = Math.trunc(value);
      const dif = value - result;
      if (dif > 0.5 || (dif === 0.5 && (result & 1) !== 0)) result++;
      return result;
    }
  } else {
    if (value >= -2147483648.5) {
      let result = Math.trunc(value);
      const dif = value - result;
      if (dif < -0.5 || (dif === -0.5 && (result & 1) !== 0)) result--;
      return result;
    }
  }
  throw overflowException(NetMessages.overflowInt32);
}

/** Math.Round(double): half to even. */
export function roundHalfEvenDouble(value: number): number {
  if (!Number.isFinite(value)) return value;
  const r = Math.round(value);
  if (Math.abs(r - value) === 0.5 && r % 2 !== 0) return r - 1;
  return r === 0 && value < 0 ? -0 : r;
}

/** Convert.ToInt64(double): checked((long)Math.Round(value)). */
export function convertDoubleToInt64(value: number): bigint {
  const r = roundHalfEvenDouble(value);
  if (!(r >= -9223372036854775808 && r < 9223372036854775808)) throw overflowException(NetMessages.arithmeticOverflow);
  return BigInt(r);
}

/** Convert.ToInt32(decimal): rounds half to even first. */
export function convertDecimalToInt32(value: CsDecimal): number {
  return value.round().toInt32();
}

/** Convert.ToInt64(decimal): rounds half to even first. */
export function convertDecimalToInt64(value: CsDecimal): bigint {
  return value.round().toInt64();
}

