// Texts as the Delphi engine writes them, for the reports converted from Delphi
// (convertedFromDelphi): the display format of a text (Delphi's Format with one argument) and a
// number without a mask (FloatToStr). The same code as DelphiFormat.cs of the C# engine.

import type { CsDecimal } from './decimal.js';
import type { NumberFormatData } from './culture.js';
import { formatDecimal, formatDouble } from './numberformat.js';

/** Reads a number at p; -1 when there is none. Returns [value, next position]. */
function readNumber(s: string, start: number): [number, number] {
  let value = -1;
  let p = start;
  while (p < s.length && s.charCodeAt(p) >= 48 && s.charCodeAt(p) <= 57 && value < 100000) {
    value = (value < 0 ? 0 : value * 10) + (s.charCodeAt(p) - 48);
    p++;
  }
  return [value, p];
}

/**
 * Format(format, [argument]) of Delphi for one text argument: %s (and %0:s) is the text, with a
 * width (%10s to the right, %-10s to the left) and a precision that cuts it (%.3s), and %% is a
 * percent sign. Everything else stays as it is written: a mask without % prints itself, as in
 * Delphi, and the specifiers Delphi refuses for a text (%d, %f...) are left as text instead of the
 * error Delphi raises.
 */
export function delphiFormatString(format: string, argument: string): string {
  if (format.length === 0 || !format.includes('%')) return format;
  let sb = '';
  let i = 0;
  while (i < format.length) {
    const c = format.charAt(i);
    if (c !== '%') {
      sb += c;
      i++;
      continue;
    }
    const start = i;
    i++;
    if (i < format.length && format.charAt(i) === '%') {
      sb += '%';
      i++;
      continue;
    }
    // [index ':'] ['-'] [width] ['.' precision] type
    let p = i;
    let number: number;
    [number, p] = readNumber(format, p);
    let index = 0;
    if (p < format.length && format.charAt(p) === ':') {
      index = number < 0 ? 0 : number;
      p++;
      number = -1;
    }
    let left = false;
    if (number < 0 && p < format.length && format.charAt(p) === '-') {
      left = true;
      p++;
    }
    let width = number;
    if (number < 0) [width, p] = readNumber(format, p);
    let precision = -1;
    if (p < format.length && format.charAt(p) === '.') {
      p++;
      [precision, p] = readNumber(format, p);
      if (precision < 0) precision = 0;
    }
    const type = p < format.length ? format.charAt(p) : '';
    if ((type === 's' || type === 'S') && index === 0) {
      let text = precision >= 0 && precision < argument.length ? argument.substring(0, precision) : argument;
      if (width > text.length) text = left ? text.padEnd(width) : text.padStart(width);
      sb += text;
      i = p + 1;
    } else {
      // Not a text specifier: as it is written
      sb += format.substring(start, i);
    }
  }
  return sb;
}

/**
 * FloatToStr of Delphi: 15 significant digits, the exponent without a plus sign or leading zeros
 * (1E20, 1E-5), and zero without a sign.
 */
export function delphiFloatText(value: number, info: NumberFormatData): string {
  if (value === 0) return '0';
  const s = formatDouble(value, 'G15', info);
  const e = s.indexOf('E');
  if (e < 0) return s;
  let exponent = s.substring(e + 1);
  const negative = exponent.startsWith('-');
  exponent = exponent.replace(/^[+-]+/, '').replace(/^0+/, '');
  if (exponent.length === 0) exponent = '0';
  return s.substring(0, e) + 'E' + (negative ? '-' : '') + exponent;
}

/**
 * A Decimal without a mask: with up to four decimals it is the Currency of Delphi, which keeps its
 * digits; with more it is a Double there, with its 15 digits (80/9 is 8,88888888888889).
 */
export function delphiDecimalText(value: CsDecimal, info: NumberFormatData): string {
  if (value.scale <= 4) return formatDecimal(value, 'G29', info);
  return delphiFloatText(value.toDouble(), info);
}
