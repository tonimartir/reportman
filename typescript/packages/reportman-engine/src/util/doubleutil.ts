// Port of the parts of Reportman.Drawing.DoubleUtil the expression language and the report
// engine use: IsNumeric, Truncate, StandardDeviation, FormatCurrAdv, FormatStringDecimals, Frac,
// Trunc, RoundDecimalUp, CompareValue, NumberToText (English, Spanish, Catalan; the other
// languages are empty strings in C#) and the SQL literals.

import { charToUpperNet } from './chars.js';
import type { NumberFormatData } from './culture.js';
import { CsDecimal } from './decimal.js';
import { NetException, NetMessages } from './netexception.js';
import { formatDecimal, formatDouble } from './numberformat.js';
import { convertDecimalToInt64, NumberStyles, tryParseDouble } from './numberparse.js';
import { CultureInfo } from './culture.js';

const ZERO = CsDecimal.zero;

/** IsNumeric(val, NumberStyle): double.TryParse, and within the Int32 range for Integer. */
export function isNumeric(val: string, numberStyle: number, info: NumberFormatData): boolean {
  const result = tryParseDouble(val, numberStyle, info);
  if (result === undefined) return false;
  if (numberStyle === NumberStyles.Integer && (result > 2147483647 || result < -2147483648)) return false;
  return true;
}

/** Truncate(decimal): through double (Math.Floor / Math.Ceiling), as the C# code. */
export function truncateDecimal(nvalue: CsDecimal): CsDecimal {
  const d = nvalue.toDouble();
  return CsDecimal.fromDouble(nvalue.compareTo(ZERO) >= 0 ? Math.floor(d) : Math.ceil(d));
}

/** StandardDeviation: the population standard deviation (sequential sums, as LINQ Average). */
export function standardDeviation(values: readonly number[]): number {
  if (values.length === 0) throw new NetException('InvalidOperationException', NetMessages.sequenceNoElements);
  let sum = 0;
  for (const v of values) sum += v;
  const avg = sum / values.length;
  let sq = 0;
  for (const v of values) {
    const d = v - avg;
    sq += d * d;
  }
  return Math.sqrt(sq / values.length);
}

/**
 * SampleStandardDeviation: the sample standard deviation (n - 1), as StdDev of the Math unit of
 * Delphi; 0 for one value, as the Delphi engine gives its aggregate.
 */
export function sampleStandardDeviation(values: readonly number[]): number {
  const count = values.length;
  if (count < 2) return 0;
  let sum = 0;
  for (const v of values) sum += v;
  const avg = sum / count;
  let sq = 0;
  for (const v of values) sq += (avg - v) * (avg - v);
  return Math.sqrt(sq / (count - 1));
}

/** FormatCurrAdv(mask, number): number.ToString(mask). */
export function formatCurrAdv(mask: string, number: number, info: NumberFormatData): string {
  return formatDouble(number, mask, info);
}

/** FormatStringDecimals: "N0" or "N" + decimals. */
export function formatStringDecimals(decimals: number): string {
  return decimals > 0 ? 'N' + decimals.toString() : 'N0';
}

/** Frac: number - Math.Truncate(number). */
export function frac(number: CsDecimal): CsDecimal {
  return number.sub(number.truncate());
}

/** Trunc: Convert.ToInt64(Math.Truncate(number)). */
export function trunc(number: CsDecimal): bigint {
  return convertDecimalToInt64(number.truncate());
}

/** RoundDecimalUp: rounds to the nearest multiple, the midpoint up. */
export function roundDecimalUp(number: CsDecimal, multiple: CsDecimal): CsDecimal {
  if (multiple.compareTo(ZERO) === 0) return ZERO;
  let negative = false;
  if (number.compareTo(ZERO) < 0) {
    number = number.negate();
    negative = true;
  }
  let scale = 1;
  while (frac(number.mul(CsDecimal.fromInteger(scale))).compareTo(ZERO) !== 0) {
    scale = scale * 10;
    if (scale > 10000000) break;
  }
  while (frac(multiple.mul(CsDecimal.fromInteger(scale))).compareTo(ZERO) !== 0) {
    scale = scale * 10;
    if (scale > 10000000) break;
  }
  const scaleD = CsDecimal.fromInteger(scale);
  let numberscaled = number.mul(scaleD).round();
  const multiplescaled = multiple.mul(scaleD);
  const division = numberscaled.div(multiplescaled).round();
  const moddiv = numberscaled.sub(multiplescaled.mul(division));
  if (moddiv.compareTo(multiplescaled.div(CsDecimal.fromInteger(2))) < 0) numberscaled = numberscaled.sub(moddiv);
  else numberscaled = numberscaled.add(moddiv);
  let aresult = numberscaled.div(scaleD);
  if (negative) aresult = aresult.negate();
  return aresult;
}

/** DoubleResolution of the Math unit of Delphi: 1E-15 by the fuzz factor (1000). */
const DOUBLE_RESOLUTION = 1e-12;

/**
 * CompareValue of the Math unit of Delphi, the COMPAREVALUE of the Delphi engine, on doubles (a
 * decimal is converted): 0 when the values differ in epsilon or less (SameValue), else -1 when the
 * first one is the lower and 1 when it is not. With an epsilon of 0 the epsilon is the resolution
 * of the values, Max(Min(Abs(p1), Abs(p2)) * 1E-12, 1E-12); a negative epsilon makes nothing equal.
 * (Equal values with an epsilon of 0 gave 1, and a difference of exactly epsilon was not equal.)
 */
export function compareValue(p1: CsDecimal | number, p2: CsDecimal | number, epsilon: CsDecimal | number): number {
  const a = typeof p1 === 'number' ? p1 : p1.toDouble();
  const b = typeof p2 === 'number' ? p2 : p2.toDouble();
  let e = typeof epsilon === 'number' ? epsilon : epsilon.toDouble();
  if (e === 0) {
    // Min and Max as Delphi writes them (if A < B then A else B), for the NaN
    const absA = Math.abs(a);
    const absB = Math.abs(b);
    const resolution = (absA < absB ? absA : absB) * DOUBLE_RESOLUTION;
    e = resolution > DOUBLE_RESOLUTION ? resolution : DOUBLE_RESOLUTION;
  }
  const same = a > b ? a - b <= e : b - a <= e;
  if (same) return 0;
  return a < b ? -1 : 1;
}

// ---------------------------------------------------------------------------------------------
// NumberToText

function numToStr(num: bigint): string {
  const hundred = 100n;
  const thousand = 1000n;
  const million = 1000000n;
  const billion = 1000000000n;
  if (num >= billion) {
    return num % billion === 0n ? numToStr(num / billion) + ' Billion' : numToStr(num / billion) + ' Billion ' + numToStr(num % billion);
  }
  if (num >= million) {
    return num % million === 0n ? numToStr(num / million) + ' Million' : numToStr(num / million) + ' Million ' + numToStr(num % million);
  }
  if (num >= thousand) {
    return num % thousand === 0n
      ? numToStr(num / thousand) + ' Thousand'
      : numToStr(num / thousand) + ' Thousand ' + numToStr(num % thousand);
  }
  if (num >= hundred) {
    return num % hundred === 0n ? numToStr(num / hundred) + ' Hundred' : numToStr(num / hundred) + ' Hundred ' + numToStr(num % hundred);
  }
  switch (num / 10n) {
    case 6n:
    case 7n:
    case 9n:
      return num % 10n === 0n ? numToStr(num / 10n) + 'ty' : numToStr(num / 10n) + 'ty-' + numToStr(num % 10n);
    case 8n:
      return num === 80n ? 'Eighty' : 'Eighty-' + numToStr(num % 10n);
    case 5n:
      return num === 50n ? 'Fifty' : 'Fifty-' + numToStr(num % 10n);
    case 4n:
      return num === 40n ? 'Forty' : 'Forty-' + numToStr(num % 10n);
    case 3n:
      return num === 30n ? 'Thirty' : 'Thirty-' + numToStr(num % 10n);
    case 2n:
      return num === 20n ? 'Twenty' : 'Twenty-' + numToStr(num % 10n);
    case 1n:
    case 0n: {
      const small = [
        'Zero', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine', 'Ten', 'Eleven', 'Twelve', 'Thirteen',
        // C# parity: "Eightteen" is spelled so in DoubleUtil.NumToStr.
        'Fourteen', 'Fifteen', 'Sixteen', 'Seventeen', 'Eightteen', 'Nineteen',
      ];
      return num >= 0n && num < 20n ? small[Number(num)]! : '';
    }
    default:
      return '';
  }
}

function numberToTextEnglish(amount: CsDecimal): string {
  amount = amount.abs();
  const num = trunc(amount);
  const fracture = convertDecimalToInt64(CsDecimal.fromInteger(1000).mul(amount.sub(CsDecimal.fromInteger(num))).round());
  let aresult = numToStr(num);
  if (fracture > 0n) aresult = aresult + ' and ' + fracture.toString() + '/1000';
  return aresult;
}

function longitud(numero: bigint): number {
  return numero / 10n === 0n ? 1 : 1 + longitud(numero / 10n);
}

function unidadesToStrS(numero: bigint, female: boolean): string {
  switch (numero) {
    case 1n:
      return female ? 'una' : 'un';
    case 2n:
      return 'dos';
    case 3n:
      return 'tres';
    case 4n:
      return 'cuatro';
    case 5n:
      return 'cinco';
    case 6n:
      return 'seis';
    case 7n:
      return 'siete';
    case 8n:
      return 'ocho';
    case 9n:
      return 'nueve';
    default:
      return '';
  }
}

function decenasToStrS(numero: bigint, female: boolean): string {
  switch (numero) {
    case 0n:
      return '';
    case 1n:
    case 2n:
    case 3n:
    case 4n:
    case 5n:
    case 6n:
    case 7n:
    case 8n:
    case 9n:
      return unidadesToStrS(numero, female);
    case 10n:
      return 'diez';
    case 11n:
      return 'once';
    case 12n:
      return 'doce';
    case 13n:
      return 'trece';
    case 14n:
      return 'catorce';
    case 15n:
      return 'quince';
    case 16n:
      return 'diecis\u00e9is';
    case 17n:
      return 'diecisiete';
    case 18n:
      return 'dieciocho';
    case 19n:
      return 'diecinueve';
    case 20n:
      return 'veinte';
    case 21n:
      return female ? 'veintiuna' : 'veintiuno';
    case 22n:
      return 'veintid\u00f3s';
    case 23n:
      return 'veintitr\u00e9s';
    case 24n:
    case 25n:
    case 26n:
    case 27n:
    case 28n:
    case 29n:
      return 'veinti' + unidadesToStrS(numero % 10n, female);
    case 30n:
      return 'treinta';
    case 40n:
      return 'cuarenta';
    case 50n:
      return 'cincuenta';
    case 60n:
      return 'sesenta';
    case 70n:
      return 'setenta';
    case 80n:
      return 'ochenta';
    case 90n:
      return 'noventa';
    default:
      return decenasToStrS(numero - (numero % 10n), female) + ' y ' + unidadesToStrS(numero % 10n, female);
  }
}

function centenasToStrS(numero: bigint, female: boolean): string {
  if (numero >= 1n && numero <= 99n) return decenasToStrS(numero, female);
  if (numero === 100n) return 'cien';
  if (numero >= 101n && numero <= 199n) return 'ciento ' + decenasToStrS(numero % 100n, female);
  // C# parity: the doscientos branch tests 100 again, so it never runs (200 is built below).
  if (numero === 500n) return female ? 'quinientas' : 'quinientos';
  if (numero >= 501n && numero <= 599n) return (female ? 'quinientas ' : 'quinientos ') + decenasToStrS(numero % 100n, female);
  if (numero === 700n) return female ? 'setecientas' : 'setecientos';
  if (numero >= 701n && numero <= 799n) return (female ? 'setecientas ' : 'setecientos ') + decenasToStrS(numero % 100n, female);
  if (numero === 900n) return female ? 'novecientas' : 'novecientos';
  if (numero >= 901n && numero <= 999n) return (female ? 'novecientas ' : 'novecientos ') + decenasToStrS(numero % 100n, female);
  const cientosstr = unidadesToStrS(numero / 100n, female);
  let centenas = '';
  if (cientosstr !== '') centenas = female ? cientosstr + 'cientas ' : cientosstr + 'cientos ';
  return centenas + decenasToStrS(numero % 100n, female);
}

function unidadesDeMillarToStrS(numero: bigint, female: boolean): string {
  if (numero > 999n) {
    if (numero > 1999n) return unidadesToStrS(numero / 1000n, female) + ' mil ' + centenasToStrS(numero % 1000n, female);
    return 'mil ' + centenasToStrS(numero % 1000n, female);
  }
  return centenasToStrS(numero, female);
}

function decenasDeMillarToStrS(numero: bigint, female: boolean): string {
  if (numero > 9999n) return decenasToStrS(numero / 1000n, female) + ' mil ' + centenasToStrS(numero % 1000n, female);
  return unidadesDeMillarToStrS(numero, female);
}

function centenasDeMillarToStrS(numero: bigint, female: boolean): string {
  if (numero > 99999n) return centenasToStrS(numero / 1000n, female) + ' mil ' + centenasToStrS(numero % 1000n, female);
  return decenasDeMillarToStrS(numero, female);
}

function unidadesDeMillonToStrS(numero: bigint, female: boolean): string {
  if (numero > 1999999n) return unidadesToStrS(numero / 1000000n, false) + ' millones ' + centenasDeMillarToStrS(numero % 1000000n, female);
  return 'un mill\u00f3n ' + centenasDeMillarToStrS(numero % 1000000n, female);
}

function decenasDeMillonToStrS(numero: bigint, female: boolean): string {
  return decenasToStrS(numero / 1000000n, false) + ' millones ' + centenasDeMillarToStrS(numero % 1000000n, female);
}

function centenasDeMillonToStrS(numero: bigint, female: boolean): string {
  return centenasToStrS(numero / 1000000n, false) + ' millones ' + centenasDeMillarToStrS(numero % 1000000n, female);
}

function milesDeMillonToStrS(numero: bigint, female: boolean): string {
  // C# parity: divides by 100000 (not 1000000), as DoubleUtil.MilesDeMillonToStrS.
  return unidadesDeMillarToStrS(numero / 100000n, false) + ' millones ' + centenasDeMillarToStrS(numero % 1000000n, female);
}

function decenasDeMilesDeMillonToStrS(numero: bigint, female: boolean): string {
  return decenasDeMillarToStrS(numero / 1000000n, false) + ' millones ' + centenasDeMillarToStrS(numero % 1000000n, female);
}

function centenasDeMilesDeMillonToStrS(numero: bigint, female: boolean): string {
  return centenasDeMillarToStrS(numero / 1000000n, false) + ' millones ' + centenasDeMillarToStrS(numero % 1000000n, female);
}

function capitalize(s: string): string {
  return s.length > 0 ? charToUpperNet(s[0]!) + s.substring(1) : s;
}

function centavosOf(number: CsDecimal, numero: bigint): bigint {
  return convertDecimalToInt64(number.sub(CsDecimal.fromInteger(numero)).mul(CsDecimal.fromInteger(100)).round());
}

function numberToTextSpanish(number: CsDecimal, female: boolean): string {
  number = number.abs();
  const numero = convertDecimalToInt64(CsDecimal.fromInteger(trunc(number)));
  const centavos = centavosOf(number, numero);
  let s: string;
  switch (longitud(numero)) {
    case 1:
      s = unidadesToStrS(numero, female);
      break;
    case 2:
      s = decenasToStrS(numero, female);
      break;
    case 3:
      s = centenasToStrS(numero, female);
      break;
    case 4:
      s = unidadesDeMillarToStrS(numero, female);
      break;
    case 5:
      s = decenasDeMillarToStrS(numero, female);
      break;
    case 6:
      s = centenasDeMillarToStrS(numero, female);
      break;
    case 7:
      s = unidadesDeMillonToStrS(numero, female);
      break;
    case 8:
      s = decenasDeMillonToStrS(numero, female);
      break;
    case 9:
      s = centenasDeMillonToStrS(numero, female);
      break;
    case 10:
      s = milesDeMillonToStrS(numero, female);
      break;
    case 11:
      s = decenasDeMilesDeMillonToStrS(numero, female);
      break;
    case 12:
      s = centenasDeMilesDeMillonToStrS(numero, female);
      break;
    default:
      s = 'Demasiado grande';
      break;
  }
  let aresult = '';
  if (centavos > 0n) {
    switch (longitud(centavos)) {
      case 1:
        aresult = unidadesToStrS(centavos, female);
        break;
      case 2:
        aresult = decenasToStrS(centavos, female);
        break;
    }
    aresult = s + ' con ' + aresult;
  } else aresult = s;
  return capitalize(aresult);
}

function unidadesToStrC(numero: bigint, female: boolean): string {
  switch (numero) {
    case 1n:
      return female ? 'una' : 'un';
    case 2n:
      return 'dos';
    case 3n:
      return 'tres';
    case 4n:
      return 'quatre';
    case 5n:
      return 'cinc';
    case 6n:
      return 'sis';
    case 7n:
      return 'set';
    case 8n:
      return 'vuit';
    case 9n:
      return 'nou';
    default:
      return '';
  }
}

function decenasToStrC(numero: bigint, female: boolean): string {
  switch (numero) {
    case 1n:
    case 2n:
    case 3n:
    case 4n:
    case 5n:
    case 6n:
    case 7n:
    case 8n:
    case 9n:
      return unidadesToStrC(numero, female);
    case 10n:
      return 'deu';
    case 11n:
      return 'onze';
    case 12n:
      return 'dotze';
    case 13n:
      return 'tretze';
    case 14n:
      return 'catorze';
    case 15n:
      return 'quinze';
    case 16n:
      return 'setze';
    case 17n:
      return 'disset';
    case 18n:
      return 'divuit';
    case 19n:
      return 'dinou';
    case 20n:
      return 'vint';
    case 21n:
      return female ? 'vint-i-una' : 'vint-i-un';
    case 22n:
      return 'vint-i-dos';
    case 23n:
      return 'vint-i-tres';
    case 24n:
    case 25n:
    case 26n:
    case 27n:
    case 28n:
    case 29n:
      return 'vint-i-' + unidadesToStrC(numero % 10n, female);
    case 30n:
      return 'trenta';
    case 31n:
      return female ? 'trenta-una' : 'trenta-un';
    case 40n:
      return 'quaranta';
    case 41n:
      return female ? 'quaranta-una' : 'quaranta-un';
    case 50n:
      return 'cinquanta';
    case 51n:
      // C# parity: "cincuanta" is spelled so in DoubleUtil.DecenasToStrC.
      return female ? 'cincuanta-una' : 'cincuanta-un';
    case 60n:
      return 'seixanta';
    case 61n:
      return female ? 'seixanta-una' : 'seixanta-un';
    case 70n:
      return 'setanta';
    case 71n:
      return female ? 'setanta-una' : 'setanta-un';
    case 80n:
      return 'vuitanta';
    case 81n:
      return female ? 'vuitanta-una' : 'vuitanta-un';
    case 90n:
      return 'noranta';
    case 91n:
      return female ? 'noranta-una' : 'noranta-un';
    case 0n:
      return '';
    default:
      return decenasToStrC(numero - (numero % 10n), female) + '-' + unidadesToStrC(numero % 10n, female);
  }
}

function centenasToStrC(numero: bigint, female: boolean): string {
  if (numero >= 1n && numero <= 99n) return decenasToStrC(numero, female);
  if (numero === 100n) return 'cent';
  if (numero >= 101n && numero <= 199n) return 'cent ' + decenasToStrC(numero % 100n, female);
  // C# parity: the dos-cents branch tests 100 again (never runs) and 500 swaps the genders.
  if (numero === 500n) return female ? 'cinc-cents' : 'cinc-centes';
  if (numero >= 501n && numero <= 599n) return (female ? 'cinc-centes ' : 'cinc-cents ') + decenasToStrC(numero % 100n, female);
  if (numero === 700n) return female ? 'set-centes' : 'set-cents';
  if (numero >= 701n && numero <= 799n) return (female ? 'set-centes ' : 'set-cents ') + decenasToStrC(numero % 100n, female);
  if (numero === 900n) return female ? 'nou-centes' : 'nou-cents';
  if (numero >= 901n && numero <= 999n) return (female ? 'nou-centes ' : 'nou-cents ') + decenasToStrC(numero % 100n, female);
  if (female) return unidadesToStrC(numero / 100n, female) + '-centes ' + decenasToStrC(numero % 100n, female);
  if (unidadesToStrC(numero / 100n, female).trim().length > 0) {
    return unidadesToStrC(numero / 100n, female) + '-cents ' + decenasToStrC(numero % 100n, female);
  }
  return '';
}

function unidadesDeMillarToStrC(numero: bigint, female: boolean): string {
  if (numero > 999n) {
    if (numero > 1999n) return unidadesToStrC(numero / 1000n, female) + ' mil ' + centenasToStrC(numero % 1000n, female);
    return 'mil ' + centenasToStrC(numero % 1000n, female);
  }
  return centenasToStrC(numero, female);
}

function decenasDeMillarToStrC(numero: bigint, female: boolean): string {
  if (numero > 9999n) return decenasToStrC(numero / 1000n, female) + ' mil ' + centenasToStrC(numero % 1000n, female);
  return unidadesDeMillarToStrC(numero, female);
}

function centenasDeMillarToStrC(numero: bigint, female: boolean): string {
  if (numero > 99999n) return centenasToStrC(numero / 1000n, female) + ' mil ' + centenasToStrC(numero % 1000n, female);
  return decenasDeMillarToStrC(numero, female);
}

function unidadesDeMillonToStrC(numero: bigint, female: boolean): string {
  if (numero > 1999999n) return unidadesToStrC(numero / 1000000n, false) + ' milions ' + centenasDeMillarToStrC(numero % 1000000n, female);
  return 'un mili\u00f3 ' + centenasDeMillarToStrC(numero % 1000000n, female);
}

function decenasDeMillonToStrC(numero: bigint, female: boolean): string {
  return decenasToStrC(numero / 1000000n, false) + ' milions ' + centenasDeMillarToStrC(numero % 1000000n, female);
}

function centenasDeMillonToStrC(numero: bigint, female: boolean): string {
  return centenasToStrC(numero / 1000000n, false) + ' milions ' + centenasDeMillarToStrC(numero % 1000000n, female);
}

function milesDeMillonToStrC(numero: bigint, female: boolean): string {
  // C# parity: divides by 100000, as DoubleUtil.MilesDeMillonToStrC.
  return unidadesDeMillarToStrC(numero / 100000n, false) + ' milions ' + centenasDeMillarToStrC(numero % 1000000n, female);
}

function decenasDeMilesDeMillonToStrC(numero: bigint, female: boolean): string {
  return decenasDeMillarToStrC(numero / 1000000n, false) + ' milions ' + centenasDeMillarToStrC(numero % 1000000n, female);
}

function centenasDeMilesDeMillonToStrC(numero: bigint, female: boolean): string {
  return centenasDeMillarToStrC(numero / 1000000n, false) + ' milions ' + centenasDeMillarToStrC(numero % 1000000n, female);
}

function numberToTextCatalan(number: CsDecimal, female: boolean): string {
  number = number.abs();
  const numero = convertDecimalToInt64(CsDecimal.fromInteger(trunc(number)));
  const centavos = centavosOf(number, numero);
  let s: string;
  switch (longitud(numero)) {
    case 1:
      s = unidadesToStrC(numero, female);
      break;
    case 2:
      s = decenasToStrC(numero, female);
      break;
    case 3:
      s = centenasToStrC(numero, female);
      break;
    case 4:
      s = unidadesDeMillarToStrC(numero, female);
      break;
    case 5:
      s = decenasDeMillarToStrC(numero, female);
      break;
    case 6:
      s = centenasDeMillarToStrC(numero, female);
      break;
    case 7:
      s = unidadesDeMillonToStrC(numero, female);
      break;
    case 8:
      s = decenasDeMillonToStrC(numero, female);
      break;
    case 9:
      s = centenasDeMillonToStrC(numero, female);
      break;
    case 10:
      s = milesDeMillonToStrC(numero, female);
      break;
    case 11:
      s = decenasDeMilesDeMillonToStrC(numero, female);
      break;
    case 12:
      s = centenasDeMilesDeMillonToStrC(numero, female);
      break;
    default:
      s = 'Massa gran';
      break;
  }
  let aresult = '';
  if (centavos > 0n) {
    switch (longitud(centavos)) {
      case 1:
        aresult = unidadesToStrC(centavos, female);
        break;
      case 2:
        aresult = decenasToStrC(centavos, female);
        break;
    }
    aresult = s + ' amb ' + aresult;
  } else aresult = s;
  return capitalize(aresult);
}

/**
 * NumberToText(number, female, lang): 0 and -1 English, 1 Spanish, 2 Catalan; 4 (Portuguese),
 * 7 (Turkish), 8 (Lithuanian) and 13 (Mexican Spanish) are empty strings in C#, as any other.
 */
export function numberToText(number: CsDecimal, female: boolean, lang: number): string {
  switch (lang) {
    case -1:
    case 0:
      return numberToTextEnglish(number);
    case 1:
      return numberToTextSpanish(number, female);
    case 2:
      return numberToTextCatalan(number, female);
    default:
      return '';
  }
}

const SQL_INFO: NumberFormatData = {
  ...CultureInfo.invariant.number,
  negativeSign: '-',
  positiveSign: '+',
  currencySymbol: '',
  numberGroupSeparator: '',
};

/** DecimalToSqlLiteral: the invariant "G" text of the decimal. */
export function decimalToSqlLiteral(value: CsDecimal): string {
  return formatDecimal(value, '', SQL_INFO);
}

/** DoubleToSqlLiteral: the invariant "G" text of the double. */
export function doubleToSqlLiteral(value: number): string {
  return formatDouble(value, '', SQL_INFO);
}
