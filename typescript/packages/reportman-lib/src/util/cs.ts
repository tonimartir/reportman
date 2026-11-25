/**
 * Helpers that reproduce the .NET behaviour the C# engine relies on (string trimming and upper
 * case, Substring bounds, Convert.ToInt32 / Convert.ToDouble, DateTime.FromOADate), so that the
 * ported code gives the same results and fails in the same cases.
 */

/** The exception .NET throws for text that is not a number (FormatException). */
export class CsFormatError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "FormatException";
  }
}

/** The exception .NET throws for a number out of the range of its type (OverflowException). */
export class CsOverflowError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "OverflowException";
  }
}

/** char.IsWhiteSpace: the characters String.Trim removes (Unicode White_Space, not U+FEFF). */
export function isCsWhiteSpace(c: number): boolean {
  if (c === 0x20 || (c >= 0x09 && c <= 0x0d) || c === 0x85 || c === 0xa0) return true;
  if (c < 0x1680) return false;
  return (
    c === 0x1680 ||
    (c >= 0x2000 && c <= 0x200a) ||
    c === 0x2028 ||
    c === 0x2029 ||
    c === 0x202f ||
    c === 0x205f ||
    c === 0x3000
  );
}

/** String.Trim(). */
export function csTrim(s: string): string {
  let start = 0;
  let end = s.length;
  while (start < end && isCsWhiteSpace(s.charCodeAt(start))) start++;
  while (end > start && isCsWhiteSpace(s.charCodeAt(end - 1))) end--;
  return start === 0 && end === s.length ? s : s.substring(start, end);
}

/** String.TrimEnd(char). */
export function csTrimEndChar(s: string, c: number): string {
  let end = s.length;
  while (end > 0 && s.charCodeAt(end - 1) === c) end--;
  return end === s.length ? s : s.substring(0, end);
}

/**
 * String.ToUpper(): .NET maps each UTF-16 code unit to one code unit (simple case mapping), so
 * characters whose upper case is longer (ß → SS in JavaScript) are left as they are.
 */
export function csToUpper(s: string): string {
  const upper = s.toUpperCase();
  // Same length: no character expanded, every code unit was mapped to one.
  if (upper.length === s.length) return upper;
  let result = "";
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    const u = ch.toUpperCase();
    result += u.length === 1 ? u : ch;
  }
  return result;
}

/** String.Substring(start, length), throwing as .NET does when the range is outside the string. */
export function csSubstring(s: string, start: number, length?: number): string {
  const len = length ?? s.length - start;
  if (start < 0 || len < 0 || start > s.length || start + len > s.length) {
    throw new RangeError("Index and length must refer to a location within the string.");
  }
  return s.substring(start, start + len);
}

/** The white space number parsing allows around a number (NumberStyles.AllowLeading/TrailingWhite). */
function isNumberWhite(c: number): boolean {
  return c === 0x20 || (c >= 0x09 && c <= 0x0d);
}

function trimNumberWhite(s: string): string {
  let start = 0;
  let end = s.length;
  while (start < end && isNumberWhite(s.charCodeAt(start))) start++;
  while (end > start && isNumberWhite(s.charCodeAt(end - 1))) end--;
  return s.substring(start, end);
}

/**
 * Convert.ToInt32(string) with the en-US culture (NumberStyles.Integer): optional white space, an
 * optional sign and ASCII digits. Throws CsFormatError or CsOverflowError as .NET does.
 */
export function csToInt32(value: string): number {
  const s = trimNumberWhite(value);
  let i = 0;
  let negative = false;
  if (i < s.length && (s[i] === "-" || s[i] === "+")) {
    negative = s[i] === "-";
    i++;
  }
  if (i >= s.length) throw new CsFormatError(`The input string '${value}' was not in a correct format.`);
  let result = 0;
  for (; i < s.length; i++) {
    const d = s.charCodeAt(i) - 48;
    if (d < 0 || d > 9) throw new CsFormatError(`The input string '${value}' was not in a correct format.`);
    result = result * 10 + d;
    if (result > 2147483648) throw new CsOverflowError("Value was either too large or too small for an Int32.");
  }
  if (negative) result = -result;
  if (result > 2147483647 || result < -2147483648)
    throw new CsOverflowError("Value was either too large or too small for an Int32.");
  return result === 0 ? 0 : result;
}

/** (short) cast of an int: the low 16 bits, signed. */
export function csToInt16(value: number): number {
  return (value << 16) >> 16;
}

const doublePattern = /^[+-]?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?$/;

/**
 * Convert.ToDouble(string, provider) with the reader's NumberFormatInfo (decimal point ".", no group
 * separator): NumberStyles.Float, plus the invariant Infinity / -Infinity / NaN symbols.
 */
export function csToDouble(value: string): number {
  const s = trimNumberWhite(value);
  if (doublePattern.test(s)) {
    const result = Number(s);
    return result;
  }
  const lower = s.toLowerCase();
  if (lower === "infinity" || lower === "+infinity") return Number.POSITIVE_INFINITY;
  if (lower === "-infinity") return Number.NEGATIVE_INFINITY;
  if (lower === "nan" || lower === "-nan" || lower === "+nan") return Number.NaN;
  throw new CsFormatError(`The input string '${value}' was not in a correct format.`);
}

const msPerDay = 86400000;
// DateTime.FromOADate's valid range: (-657435.0, 2958466.0) days.
const oaDateMinAsDouble = -657435.0;
const oaDateMaxAsDouble = 2958466.0;

/**
 * DateTime.FromOADate (C# DateUtil.DelphiDateToDateTime): days since 1899-12-30, rounded to the
 * millisecond as .NET does. The result is a Date holding the same wall-clock time in the local time
 * zone (a .NET DateTime of unspecified kind).
 */
export function csFromOADate(d: number): Date {
  if (!(d < oaDateMaxAsDouble) || !(d > oaDateMinAsDouble)) {
    throw new RangeError("Not a legal OleAut date.");
  }
  let millis = Math.trunc(d * msPerDay + (d >= 0 ? 0.5 : -0.5));
  // A negative OA date is a day before the epoch plus a positive fraction of a day.
  if (millis < 0) {
    millis -= (millis % msPerDay) * 2;
  }
  // The wall-clock components, computed in UTC to avoid time zone transitions.
  const utc = new Date(Date.UTC(1899, 11, 30) + millis);
  const local = new Date(2000, 0, 1);
  local.setFullYear(utc.getUTCFullYear(), utc.getUTCMonth(), utc.getUTCDate());
  local.setHours(utc.getUTCHours(), utc.getUTCMinutes(), utc.getUTCSeconds(), utc.getUTCMilliseconds());
  return local;
}

/** Math.Round(double) for an int conversion (Convert.ToInt32(double)): banker's rounding. */
export function csRoundToEven(v: number): number {
  const r = Math.round(v);
  if (Math.abs(v % 1) === 0.5 && r % 2 !== 0) return r - 1;
  return r;
}

/** The decimal digits of |x| (finite, not zero) and its decimal exponent: x = 0.d1d2... × 10^scale. */
interface DecimalDigits {
  digits: string;
  scale: number;
}

/** The shortest digits that read back as the same double (what .NET Core 3.0 and later formats). */
function shortestDigits(x: number): DecimalDigits {
  const s = Math.abs(x).toExponential();
  const ePos = s.indexOf("e");
  let digits = s.substring(0, ePos).replace(".", "");
  let end = digits.length;
  while (end > 1 && digits.charCodeAt(end - 1) === 48) end--;
  digits = digits.substring(0, end);
  return { digits, scale: Number(s.substring(ePos + 1)) + 1 };
}

/** The digits of |x| rounded to `precision` significant digits, trailing zeros dropped. */
function roundedDigits(x: number, precision: number): DecimalDigits {
  const s = Math.abs(x).toExponential(precision - 1);
  const ePos = s.indexOf("e");
  let digits = s.substring(0, ePos).replace(".", "");
  let end = digits.length;
  while (end > 1 && digits.charCodeAt(end - 1) === 48) end--;
  digits = digits.substring(0, end);
  return { digits, scale: Number(s.substring(ePos + 1)) + 1 };
}

/**
 * .NET's general format of a number (Number.Formatting FormatGeneral): fixed point unless the
 * exponent is above nMaxDigits or below -4, then d.dddE+XX (two exponent digits at least).
 */
function formatGeneral(negative: boolean, d: DecimalDigits, nMaxDigits: number): string {
  const sign = negative ? "-" : "";
  let { digits } = d;
  const scale = d.scale;
  if (scale > nMaxDigits || scale < -3) {
    const exp = scale - 1;
    const mantissa = digits.length > 1 ? digits[0] + "." + digits.substring(1) : digits;
    const absExp = Math.abs(exp);
    return sign + mantissa + "E" + (exp < 0 ? "-" : "+") + (absExp < 10 ? "0" : "") + absExp;
  }
  if (scale <= 0) return sign + "0." + "0".repeat(-scale) + digits;
  if (digits.length <= scale) return sign + digits + "0".repeat(scale - digits.length);
  digits = digits.substring(0, scale) + "." + digits.substring(scale);
  return sign + digits;
}

/**
 * double.ToString() / ToString("R") with a NumberFormatInfo whose decimal separator is "." (the
 * invariant culture, the ReportWriter's own format): the shortest text that reads back as the
 * same double, "-0" for a negative zero, NaN, Infinity and -Infinity.
 */
export function csDoubleToString(x: number): string {
  if (Number.isNaN(x)) return "NaN";
  if (x === Number.POSITIVE_INFINITY) return "Infinity";
  if (x === Number.NEGATIVE_INFINITY) return "-Infinity";
  if (x === 0) return Object.is(x, -0) ? "-0" : "0";
  const d = shortestDigits(x);
  // .NET 5 and later: fixed point up to 17 digits before the point (TNumber.MaxRoundTripDigits).
  return formatGeneral(x < 0, d, Math.max(d.digits.length, 17));
}

/** double.ToString("G15") with the "." decimal separator (en-US and the invariant culture). */
export function csDoubleToStringG15(x: number): string {
  if (Number.isNaN(x)) return "NaN";
  if (x === Number.POSITIVE_INFINITY) return "Infinity";
  if (x === Number.NEGATIVE_INFINITY) return "-Infinity";
  if (x === 0) return Object.is(x, -0) ? "-0" : "0";
  return formatGeneral(x < 0, roundedDigits(x, 15), 15);
}
