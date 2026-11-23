// .NET number formatting (System.Number.Formatting.cs of .NET 10): double.ToString(format),
// decimal.ToString(format) and the integer ToString(format), with the standard formats (C, D, E,
// F, G, N, P, R, X) and the custom ones (sections ';', '0', '#', '.', ',', '%', '\u2030', 'E+0',
// quoted literals and '\' escapes), using an explicit NumberFormatInfo.
//
// Digits of a double come from its exact binary value:
//  - shortest round-trip digits (ToString(), "R", "G") as JavaScript also produces them;
//  - for a precision, the exact expansion rounded half to even, as .NET's Dragon4/Grisu3 do;
//  - custom formats first round to 15 significant digits (DoublePrecisionCustomFormat) and then
//    round half up at the format's last digit, so 1.005 with "0.00" is "1.01" but "F2" is "1.00".

import { CsDecimal } from './decimal.js';
import type { NumberFormatData } from './culture.js';
import { formatException, NetMessages } from './netexception.js';

type NumberKind = 'Integer' | 'Decimal' | 'FloatingPoint';

/** Number.NumberBuffer: significant digits, decimal point position (Scale) and sign. */
interface NumberBuffer {
  digits: string;
  scale: number;
  isNegative: boolean;
  kind: NumberKind;
}

const DOUBLE_PRECISION_CUSTOM_FORMAT = 15;
const MAX_ROUND_TRIP_DIGITS = 17;

/** ParseFormatSpecifier: the standard format letter and its precision, or '\0' for custom. */
export function parseFormatSpecifier(format: string): { fmt: string; digits: number } {
  let c = '\0';
  if (format.length > 0) {
    c = format[0]!;
    if ((c >= 'A' && c <= 'Z') || (c >= 'a' && c <= 'z')) {
      if (format.length === 1) return { fmt: c, digits: -1 };
      let n = 0;
      let i = 1;
      while (i < format.length && format[i]! >= '0' && format[i]! <= '9') {
        if (n >= 100_000_000) throw formatException(NetMessages.badFormatSpecifier);
        n = n * 10 + (format.charCodeAt(i) - 48);
        i++;
      }
      if (i >= format.length || format[i] === '\0') return { fmt: c, digits: n };
    }
  }
  return { fmt: format.length === 0 || c === '\0' ? 'G' : '\0', digits: -1 };
}

// ---------------------------------------------------------------------------------------------
// Digits of a double

const f64 = new DataView(new ArrayBuffer(8));

/** The exact decimal expansion of |x| (x finite, non zero): value = 0.digits * 10^pointPos. */
function exactDigits(x: number): { digits: string; pointPos: number } {
  f64.setFloat64(0, x);
  const hi = f64.getUint32(0);
  const lo = f64.getUint32(4);
  const biased = (hi >>> 20) & 0x7ff;
  let mant = (BigInt(hi & 0xfffff) << 32n) | BigInt(lo);
  let e: number;
  if (biased === 0) e = -1074;
  else {
    mant |= 1n << 52n;
    e = biased - 1075;
  }
  let digits: string;
  let pointPos: number;
  if (e >= 0) {
    digits = (mant << BigInt(e)).toString();
    pointPos = digits.length;
  } else {
    digits = (mant * 5n ** BigInt(-e)).toString();
    pointPos = digits.length + e;
  }
  let end = digits.length;
  while (end > 0 && digits[end - 1] === '0') end--;
  return { digits: digits.slice(0, end), pointPos };
}

/** Shortest round-trip digits of |x| (x finite, non zero). */
function shortestDigits(x: number): { digits: string; pointPos: number } {
  const s = Math.abs(x).toExponential();
  const ePos = s.indexOf('e');
  const mantissa = s.slice(0, ePos).replace('.', '');
  const exp = parseInt(s.slice(ePos + 1), 10);
  let end = mantissa.length;
  while (end > 1 && mantissa[end - 1] === '0') end--;
  return { digits: mantissa.slice(0, end), pointPos: exp + 1 };
}

/**
 * Keeps `keep` digits of an exact expansion, rounding half to even (an exact tie keeps the even
 * digit), and drops trailing zeros.
 */
function roundHalfEven(d: { digits: string; pointPos: number }, keep: number): { digits: string; pointPos: number } {
  const { digits } = d;
  let { pointPos } = d;
  if (keep >= digits.length) return d;
  if (keep < 0) return { digits: '', pointPos: 0 };
  const first = digits.charCodeAt(keep) - 48;
  let up: boolean;
  if (first > 5) up = true;
  else if (first < 5) up = false;
  else {
    let tail = false;
    for (let i = keep + 1; i < digits.length; i++) {
      if (digits[i] !== '0') {
        tail = true;
        break;
      }
    }
    if (tail) up = true;
    else {
      const last = keep > 0 ? digits.charCodeAt(keep - 1) - 48 : 0;
      up = (last & 1) === 1;
    }
  }
  let kept = digits.slice(0, keep);
  if (up) {
    let i = kept.length - 1;
    while (i >= 0 && kept[i] === '9') i--;
    if (i < 0) {
      kept = '1';
      pointPos++;
    } else {
      kept = kept.slice(0, i) + String.fromCharCode(kept.charCodeAt(i) + 1);
    }
  }
  let end = kept.length;
  while (end > 0 && kept[end - 1] === '0') end--;
  kept = kept.slice(0, end);
  if (kept.length === 0) pointPos = 0;
  return { digits: kept, pointPos };
}

function getFloatingPointMaxDigitsAndPrecision(
  fmt: string,
  precision: number,
  info: NumberFormatData,
): { maxDigits: number; precision: number; isSignificantDigits: boolean } {
  if (fmt === '\0') return { maxDigits: precision, precision, isSignificantDigits: true };
  const maxDigits = precision;
  switch (fmt) {
    case 'C':
    case 'c':
      if (precision === -1) precision = info.currencyDecimalDigits;
      return { maxDigits, precision, isSignificantDigits: false };
    case 'E':
    case 'e':
      if (precision === -1) precision = 6;
      precision++;
      return { maxDigits, precision, isSignificantDigits: true };
    case 'F':
    case 'f':
    case 'N':
    case 'n':
      if (precision === -1) precision = info.numberDecimalDigits;
      return { maxDigits, precision, isSignificantDigits: false };
    case 'G':
    case 'g':
      if (precision === 0) precision = -1;
      return { maxDigits, precision, isSignificantDigits: true };
    case 'P':
    case 'p':
      if (precision === -1) precision = info.percentDecimalDigits;
      precision += 2;
      return { maxDigits, precision, isSignificantDigits: false };
    case 'R':
    case 'r':
      return { maxDigits, precision: -1, isSignificantDigits: true };
    default:
      throw formatException(NetMessages.badFormatSpecifier);
  }
}

function isNegativeDouble(x: number): boolean {
  return x < 0 || Object.is(x, -0);
}

/** double.ToString(format, info). */
export function formatDouble(value: number, format: string | null | undefined, info: NumberFormatData): string {
  if (!Number.isFinite(value)) {
    if (Number.isNaN(value)) return info.naNSymbol;
    return value < 0 ? info.negativeInfinitySymbol : info.positiveInfinitySymbol;
  }
  const f = format ?? '';
  const spec = parseFormatSpecifier(f);
  let precision = spec.digits;
  if (spec.fmt === '\0') precision = DOUBLE_PRECISION_CUSTOM_FORMAT;
  const number: NumberBuffer = { digits: '', scale: 0, isNegative: isNegativeDouble(value), kind: 'FloatingPoint' };
  const r = getFloatingPointMaxDigitsAndPrecision(spec.fmt, precision, info);
  precision = r.precision;
  if (value !== 0) {
    let d: { digits: string; pointPos: number };
    if (precision === -1) d = shortestDigits(value);
    else {
      const exact = exactDigits(value);
      d = roundHalfEven(exact, r.isSignificantDigits ? precision : exact.pointPos + precision);
    }
    number.digits = d.digits;
    number.scale = d.digits.length === 0 ? 0 : d.pointPos;
  }
  if (spec.fmt !== '\0') {
    let nMaxDigits = r.maxDigits;
    if (precision === -1) nMaxDigits = Math.max(number.digits.length, MAX_ROUND_TRIP_DIGITS);
    return numberToString(number, spec.fmt, nMaxDigits, info);
  }
  return numberToStringFormat(number, f, info);
}

/** decimal.ToString(format, info). */
export function formatDecimal(value: CsDecimal, format: string | null | undefined, info: NumberFormatData): string {
  const f = format ?? '';
  const spec = parseFormatSpecifier(f);
  const d = value.digits();
  const number: NumberBuffer = { digits: d.digits, scale: d.pointPos, isNegative: value.negative, kind: 'Decimal' };
  if (spec.fmt !== '\0') return numberToString(number, spec.fmt, spec.digits, info);
  return numberToStringFormat(number, f, info);
}

/** int.ToString(format, info) / long.ToString(format, info) (value in the Int64 range). */
export function formatInteger(value: bigint | number, format: string | null | undefined, info: NumberFormatData, bits: 32 | 64 = 64): string {
  const v = typeof value === 'bigint' ? value : BigInt(value);
  const f = format ?? '';
  if (f.length === 0) return v < 0n ? info.negativeSign + (-v).toString() : v.toString();
  const spec = parseFormatSpecifier(f);
  const upper = spec.fmt.toUpperCase();
  if (upper === 'G' ? spec.digits < 1 : upper === 'D') {
    const digits = (v < 0n ? -v : v).toString().padStart(Math.max(spec.digits, 0), '0');
    return v < 0n ? info.negativeSign + digits : digits;
  }
  if (upper === 'X') {
    const mask = bits === 32 ? 0xffffffffn : 0xffffffffffffffffn;
    let hex = (v & mask).toString(16);
    if (spec.fmt === 'X') hex = hex.toUpperCase();
    return hex.padStart(Math.max(spec.digits, 0), '0');
  }
  if (upper === 'B') {
    const mask = bits === 32 ? 0xffffffffn : 0xffffffffffffffffn;
    return (v & mask).toString(2).padStart(Math.max(spec.digits, 0), '0');
  }
  const abs = v < 0n ? -v : v;
  const digits = abs === 0n ? '' : abs.toString();
  const number: NumberBuffer = { digits, scale: digits.length, isNegative: v < 0n, kind: 'Integer' };
  if (spec.fmt !== '\0') return numberToString(number, spec.fmt, spec.digits, info);
  return numberToStringFormat(number, f, info);
}

// ---------------------------------------------------------------------------------------------
// NumberToString (standard formats)

const POS_CURRENCY_FORMATS = ['$#', '#$', '$ #', '# $'];
const NEG_CURRENCY_FORMATS = [
  '($#)', '-$#', '$-#', '$#-', '(#$)', '-#$', '#-$', '#$-', '-# $', '-$ #', '# $-', '$ #-', '$ -#', '#- $', '($ #)', '(# $)', '$- #',
];
const POS_PERCENT_FORMATS = ['# %', '#%', '%#', '% #'];
const NEG_PERCENT_FORMATS = ['-# %', '-#%', '-%#', '%-#', '%#-', '#-%', '#%-', '-% #', '# %-', '% #-', '% -#', '#- %'];
const NEG_NUMBER_FORMATS = ['(#)', '-#', '- #', '#-', '# -'];

function roundNumber(number: NumberBuffer, pos: number, isCorrectlyRounded: boolean): void {
  const dig = number.digits;
  let i = 0;
  while (i < pos && i < dig.length) i++;
  let result: string;
  if (i === pos && i < dig.length && !isCorrectlyRounded && dig.charCodeAt(i) >= 53) {
    while (i > 0 && dig[i - 1] === '9') i--;
    if (i > 0) {
      result = dig.slice(0, i - 1) + String.fromCharCode(dig.charCodeAt(i - 1) + 1);
    } else {
      number.scale++;
      result = '1';
      i = 1;
    }
  } else {
    while (i > 0 && dig[i - 1] === '0') i--;
    result = dig.slice(0, i);
  }
  if (i === 0) {
    if (number.kind !== 'FloatingPoint') number.isNegative = false;
    number.scale = 0;
  }
  number.digits = result;
}

function numberToString(number: NumberBuffer, format: string, nMaxDigits: number, info: NumberFormatData): string {
  const isCorrectlyRounded = number.kind === 'FloatingPoint';
  let sb = '';
  switch (format) {
    case 'C':
    case 'c': {
      if (nMaxDigits < 0) nMaxDigits = info.currencyDecimalDigits;
      roundNumber(number, number.scale + nMaxDigits, isCorrectlyRounded);
      const fmt = number.isNegative
        ? NEG_CURRENCY_FORMATS[info.currencyNegativePattern]!
        : POS_CURRENCY_FORMATS[info.currencyPositivePattern]!;
      for (const ch of fmt) {
        if (ch === '#') sb += formatFixed(number, nMaxDigits, info.currencyGroupSizes, info.currencyDecimalSeparator, info.currencyGroupSeparator);
        else if (ch === '-') sb += info.negativeSign;
        else if (ch === '$') sb += info.currencySymbol;
        else sb += ch;
      }
      return sb;
    }
    case 'F':
    case 'f': {
      if (nMaxDigits < 0) nMaxDigits = info.numberDecimalDigits;
      roundNumber(number, number.scale + nMaxDigits, isCorrectlyRounded);
      if (number.isNegative) sb += info.negativeSign;
      return sb + formatFixed(number, nMaxDigits, null, info.numberDecimalSeparator, null);
    }
    case 'N':
    case 'n': {
      if (nMaxDigits < 0) nMaxDigits = info.numberDecimalDigits;
      roundNumber(number, number.scale + nMaxDigits, isCorrectlyRounded);
      const fmt = number.isNegative ? NEG_NUMBER_FORMATS[info.numberNegativePattern]! : '#';
      for (const ch of fmt) {
        if (ch === '#') sb += formatFixed(number, nMaxDigits, info.numberGroupSizes, info.numberDecimalSeparator, info.numberGroupSeparator);
        else if (ch === '-') sb += info.negativeSign;
        else sb += ch;
      }
      return sb;
    }
    case 'E':
    case 'e': {
      if (nMaxDigits < 0) nMaxDigits = 6;
      nMaxDigits++;
      roundNumber(number, nMaxDigits, isCorrectlyRounded);
      if (number.isNegative) sb += info.negativeSign;
      return sb + formatScientific(number, nMaxDigits, info, format);
    }
    case 'G':
    case 'g': {
      let noRounding = false;
      let skipSign = false;
      if (nMaxDigits < 1) {
        if (number.kind === 'Decimal' && nMaxDigits === -1) {
          noRounding = true;
          if (number.digits.length === 0) skipSign = true;
        } else {
          nMaxDigits = number.digits.length;
        }
      }
      if (!noRounding) roundNumber(number, nMaxDigits, isCorrectlyRounded);
      if (!skipSign && number.isNegative) sb += info.negativeSign;
      return sb + formatGeneral(number, nMaxDigits, info, format === 'G' ? 'E' : 'e', noRounding);
    }
    case 'P':
    case 'p': {
      if (nMaxDigits < 0) nMaxDigits = info.percentDecimalDigits;
      number.scale += 2;
      roundNumber(number, number.scale + nMaxDigits, isCorrectlyRounded);
      const fmt = number.isNegative
        ? NEG_PERCENT_FORMATS[info.percentNegativePattern]!
        : POS_PERCENT_FORMATS[info.percentPositivePattern]!;
      for (const ch of fmt) {
        if (ch === '#') sb += formatFixed(number, nMaxDigits, info.percentGroupSizes, info.percentDecimalSeparator, info.percentGroupSeparator);
        else if (ch === '-') sb += info.negativeSign;
        else if (ch === '%') sb += info.percentSymbol;
        else sb += ch;
      }
      return sb;
    }
    case 'R':
    case 'r':
      // .NET 5 and later: R on a Decimal is G (the .NET Framework refuses it)
      if (number.kind !== 'FloatingPoint' && number.kind !== 'Decimal') throw formatException(NetMessages.badFormatSpecifier);
      return numberToString(number, format === 'R' ? 'G' : 'g', nMaxDigits, info);
    default:
      throw formatException(NetMessages.badFormatSpecifier);
  }
}

function formatFixed(
  number: NumberBuffer,
  nMaxDigits: number,
  groupDigits: readonly number[] | null,
  sDecimal: string,
  sGroup: string | null,
): string {
  let digPos = number.scale;
  const dig = number.digits;
  let p = 0;
  let sb = '';
  if (digPos > 0) {
    if (groupDigits !== null) {
      let groupSizeIndex = 0;
      let groupSize = 0;
      if (groupDigits.length !== 0) {
        let groupSizeCount = groupDigits[groupSizeIndex]!;
        while (digPos > groupSizeCount) {
          groupSize = groupDigits[groupSizeIndex]!;
          if (groupSize === 0) break;
          if (groupSizeIndex < groupDigits.length - 1) groupSizeIndex++;
          groupSizeCount += groupDigits[groupSizeIndex]!;
        }
        groupSize = groupSizeCount === 0 ? 0 : groupDigits[0]!;
      }
      groupSizeIndex = 0;
      let digitCount = 0;
      const digStart = digPos < dig.length ? digPos : dig.length;
      const parts: string[] = [];
      for (let i = digPos - 1; i >= 0; i--) {
        parts.push(i < digStart ? dig[i]! : '0');
        if (groupSize > 0) {
          digitCount++;
          if (digitCount === groupSize && i !== 0) {
            parts.push(sGroup!.split('').reverse().join(''));
            if (groupSizeIndex < groupDigits.length - 1) {
              groupSizeIndex++;
              groupSize = groupDigits[groupSizeIndex]!;
            }
            digitCount = 0;
          }
        }
      }
      sb += parts.join('').split('').reverse().join('');
      p = digStart;
    } else {
      do {
        sb += p < dig.length ? dig[p++]! : '0';
      } while (--digPos > 0);
    }
  } else {
    sb += '0';
  }
  if (nMaxDigits > 0) {
    sb += sDecimal;
    if (digPos < 0 && nMaxDigits > 0) {
      const zeroes = Math.min(-digPos, nMaxDigits);
      sb += '0'.repeat(zeroes);
      digPos += zeroes;
      nMaxDigits -= zeroes;
    }
    while (nMaxDigits > 0) {
      sb += p < dig.length ? dig[p++]! : '0';
      nMaxDigits--;
    }
  }
  return sb;
}

function formatExponent(info: NumberFormatData, value: number, expChar: string, minDigits: number, positiveSign: boolean): string {
  let sb = expChar;
  if (value < 0) {
    sb += info.negativeSign;
    value = -value;
  } else if (positiveSign) {
    sb += info.positiveSign;
  }
  return sb + value.toString().padStart(minDigits, '0');
}

function formatScientific(number: NumberBuffer, nMaxDigits: number, info: NumberFormatData, expChar: string): string {
  const dig = number.digits;
  let p = 0;
  let sb = p < dig.length ? dig[p++]! : '0';
  if (nMaxDigits !== 1) sb += info.numberDecimalSeparator;
  while (--nMaxDigits > 0) sb += p < dig.length ? dig[p++]! : '0';
  const e = dig.length === 0 ? 0 : number.scale - 1;
  return sb + formatExponent(info, e, expChar, 3, true);
}

function formatGeneral(number: NumberBuffer, nMaxDigits: number, info: NumberFormatData, expChar: string, suppressScientific: boolean): string {
  let digPos = number.scale;
  let scientific = false;
  if (!suppressScientific) {
    if (digPos > nMaxDigits || digPos < -3) {
      digPos = 1;
      scientific = true;
    }
  }
  const dig = number.digits;
  let p = 0;
  let sb = '';
  if (digPos > 0) {
    do {
      sb += p < dig.length ? dig[p++]! : '0';
    } while (--digPos > 0);
  } else {
    sb += '0';
  }
  if (p < dig.length || digPos < 0) {
    sb += info.numberDecimalSeparator;
    while (digPos < 0) {
      sb += '0';
      digPos++;
    }
    while (p < dig.length) sb += dig[p++]!;
  }
  if (scientific) sb += formatExponent(info, number.scale - 1, expChar, 2, true);
  return sb;
}

// ---------------------------------------------------------------------------------------------
// NumberToStringFormat (custom formats)

function findSection(format: string, section: number): number {
  if (section === 0) return 0;
  let src = 0;
  for (;;) {
    if (src >= format.length) return 0;
    const ch = format[src++]!;
    switch (ch) {
      case "'":
      case '"':
        while (src < format.length && format[src] !== '\0' && format[src++] !== ch);
        break;
      case '\\':
        if (src < format.length && format[src] !== '\0') src++;
        break;
      case ';':
        if (--section !== 0) break;
        if (src < format.length && format[src] !== '\0' && format[src] !== ';') return src;
        return 0;
      case '\0':
        return 0;
    }
  }
}

function numberToStringFormat(number: NumberBuffer, format: string, info: NumberFormatData): string {
  let digitCount: number;
  let decimalPos: number;
  let firstDigit: number;
  let lastDigit: number;
  let scientific: boolean;
  let thousandPos: number;
  let thousandCount = 0;
  let thousandSeps: boolean;
  let scaleAdjust: number;
  let src: number;
  let ch: string;

  let section = findSection(format, number.digits.length === 0 ? 2 : number.isNegative ? 1 : 0);

  for (;;) {
    digitCount = 0;
    decimalPos = -1;
    firstDigit = 0x7fffffff;
    lastDigit = 0;
    scientific = false;
    thousandPos = -1;
    thousandSeps = false;
    scaleAdjust = 0;
    src = section;

    while (src < format.length && (ch = format[src++]!) !== '\0' && ch !== ';') {
      switch (ch) {
        case '#':
          digitCount++;
          break;
        case '0':
          if (firstDigit === 0x7fffffff) firstDigit = digitCount;
          digitCount++;
          lastDigit = digitCount;
          break;
        case '.':
          if (decimalPos < 0) decimalPos = digitCount;
          break;
        case ',':
          if (digitCount > 0 && decimalPos < 0) {
            if (thousandPos >= 0) {
              if (thousandPos === digitCount) {
                thousandCount++;
                break;
              }
              thousandSeps = true;
            }
            thousandPos = digitCount;
            thousandCount = 1;
          }
          break;
        case '%':
          scaleAdjust += 2;
          break;
        case '\u2030':
          scaleAdjust += 3;
          break;
        case "'":
        case '"':
          while (src < format.length && format[src] !== '\0' && format[src++] !== ch);
          break;
        case '\\':
          if (src < format.length && format[src] !== '\0') src++;
          break;
        case 'E':
        case 'e':
          if (
            (src < format.length && format[src] === '0') ||
            (src + 1 < format.length && (format[src] === '+' || format[src] === '-') && format[src + 1] === '0')
          ) {
            while (++src < format.length && format[src] === '0');
            scientific = true;
          }
          break;
      }
    }

    if (decimalPos < 0) decimalPos = digitCount;

    if (thousandPos >= 0) {
      if (thousandPos === decimalPos) scaleAdjust -= thousandCount * 3;
      else thousandSeps = true;
    }

    if (number.digits.length !== 0) {
      number.scale += scaleAdjust;
      const pos = scientific ? digitCount : number.scale + digitCount - decimalPos;
      roundNumber(number, pos, false);
      if (number.digits.length === 0) {
        src = findSection(format, 2);
        if (src !== section) {
          section = src;
          continue;
        }
      }
    } else {
      if (number.kind !== 'FloatingPoint') number.isNegative = false;
      number.scale = 0;
    }
    break;
  }

  firstDigit = firstDigit < decimalPos ? decimalPos - firstDigit : 0;
  lastDigit = lastDigit > decimalPos ? decimalPos - lastDigit : 0;
  let digPos: number;
  let adjust: number;
  if (scientific) {
    digPos = decimalPos;
    adjust = 0;
  } else {
    digPos = number.scale > decimalPos ? number.scale : decimalPos;
    adjust = number.scale - decimalPos;
  }
  src = section;

  const thousandsSepPos: number[] = [];
  let thousandsSepCtr = -1;
  if (thousandSeps) {
    if (info.numberGroupSeparator.length > 0) {
      const groupDigits = info.numberGroupSizes;
      let groupSizeIndex = 0;
      let groupTotalSizeCount = 0;
      const groupSizeLen = groupDigits.length;
      if (groupSizeLen !== 0) groupTotalSizeCount = groupDigits[groupSizeIndex]!;
      let groupSize = groupTotalSizeCount;
      const totalDigits = digPos + (adjust < 0 ? adjust : 0);
      const numDigits = firstDigit > totalDigits ? firstDigit : totalDigits;
      while (numDigits > groupTotalSizeCount) {
        if (groupSize === 0) break;
        ++thousandsSepCtr;
        thousandsSepPos[thousandsSepCtr] = groupTotalSizeCount;
        if (groupSizeIndex < groupSizeLen - 1) {
          groupSizeIndex++;
          groupSize = groupDigits[groupSizeIndex]!;
        }
        groupTotalSizeCount += groupSize;
      }
    }
  }

  let sb = '';
  if (number.isNegative && section === 0 && number.scale !== 0) sb += info.negativeSign;

  let decimalWritten = false;
  const dig = number.digits;
  let cur = 0;
  const curDigit = (): string | null => (cur < dig.length ? dig[cur]! : null);

  while (src < format.length && (ch = format[src++]!) !== '\0' && ch !== ';') {
    if (adjust > 0) {
      switch (ch) {
        case '#':
        case '0':
        case '.':
          while (adjust > 0) {
            const c = curDigit();
            if (c !== null) {
              sb += c;
              cur++;
            } else sb += '0';
            if (thousandSeps && digPos > 1 && thousandsSepCtr >= 0) {
              if (digPos === thousandsSepPos[thousandsSepCtr]! + 1) {
                sb += info.numberGroupSeparator;
                thousandsSepCtr--;
              }
            }
            digPos--;
            adjust--;
          }
          break;
      }
    }

    switch (ch) {
      case '#':
      case '0': {
        let out: string | null;
        if (adjust < 0) {
          adjust++;
          out = digPos <= firstDigit ? '0' : null;
        } else {
          const c = curDigit();
          if (c !== null) {
            out = c;
            cur++;
          } else out = digPos > lastDigit ? '0' : null;
        }
        if (out !== null) {
          sb += out;
          if (thousandSeps && digPos > 1 && thousandsSepCtr >= 0) {
            if (digPos === thousandsSepPos[thousandsSepCtr]! + 1) {
              sb += info.numberGroupSeparator;
              thousandsSepCtr--;
            }
          }
        }
        digPos--;
        break;
      }
      case '.':
        if (digPos !== 0 || decimalWritten) break;
        if (lastDigit < 0 || (decimalPos < digitCount && curDigit() !== null)) {
          sb += info.numberDecimalSeparator;
          decimalWritten = true;
        }
        break;
      case '\u2030':
        sb += info.perMilleSymbol;
        break;
      case '%':
        sb += info.percentSymbol;
        break;
      case ',':
        break;
      case "'":
      case '"':
        while (src < format.length && format[src] !== '\0' && format[src] !== ch) sb += format[src++]!;
        if (src < format.length && format[src] !== '\0') src++;
        break;
      case '\\':
        if (src < format.length && format[src] !== '\0') sb += format[src++]!;
        break;
      case 'E':
      case 'e': {
        let positiveSign = false;
        let i = 0;
        if (scientific) {
          if (src < format.length && format[src] === '0') {
            i++;
          } else if (src + 1 < format.length && format[src] === '+' && format[src + 1] === '0') {
            positiveSign = true;
          } else if (src + 1 < format.length && format[src] === '-' && format[src + 1] === '0') {
            // E-0: a place holder
          } else {
            sb += ch;
            break;
          }
          while (++src < format.length && format[src] === '0') i++;
          if (i > 10) i = 10;
          const exp = dig.length === 0 ? 0 : number.scale - decimalPos;
          sb += formatExponent(info, exp, ch, i, positiveSign);
          scientific = false;
        } else {
          sb += ch;
          if (src < format.length) {
            if (format[src] === '+' || format[src] === '-') sb += format[src++]!;
            while (src < format.length && format[src] === '0') sb += format[src++]!;
          }
        }
        break;
      }
      default:
        sb += ch;
        break;
    }
  }

  if (number.isNegative && section === 0 && number.scale === 0 && sb.length > 0) sb = info.negativeSign + sb;
  return sb;
}
