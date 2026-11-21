// The dates of a PDF document (PDFFile.SplitDocDate, PDFDateOf, ISODateOf, LocalZoneOf...).

/** A date split in its digits (yyyyMMddHHmmss or the first of them) and its zone (Z, +hh:mm, -hh:mm or empty). */
export interface SplitDate {
  digits: string;
  zone: string;
}

// The white space of .NET (char.IsWhiteSpace), for String.Trim
function isNetWhiteSpace(c: number): boolean {
  return (
    (c >= 9 && c <= 13) ||
    c === 0x20 ||
    c === 0x85 ||
    c === 0xa0 ||
    c === 0x1680 ||
    (c >= 0x2000 && c <= 0x200a) ||
    c === 0x2028 ||
    c === 0x2029 ||
    c === 0x202f ||
    c === 0x205f ||
    c === 0x3000
  );
}

/** String.Trim of .NET. */
export function netTrim(s: string): string {
  let a = 0;
  let b = s.length;
  while (a < b && isNetWhiteSpace(s.charCodeAt(a))) a++;
  while (b > a && isNetWhiteSpace(s.charCodeAt(b - 1))) b--;
  return s.substring(a, b);
}

const isDigit = (c: string): boolean => c >= '0' && c <= '9';

function datePart(digits: string, start: number): number {
  return parseInt(digits.substring(start, start + 2), 10);
}

/**
 * Splits a date as a report gives it, ISO 8601 (2024-10-02T15:29:15+02:00) or a PDF date
 * (D:20241002152915+02'00'), into its digits and its time zone; null when it is neither.
 */
export function splitDocDate(text: string | null | undefined): SplitDate | null {
  if (text === null || text === undefined) return null;
  let s = netTrim(text);
  if (s.startsWith('D:')) s = s.substring(2);
  let d = '';
  let z = '';
  let i = 0;
  while (i < s.length) {
    const c = s.charAt(i);
    const n = d.length;
    if (isDigit(c)) {
      if (n >= 14) return null;
      d += c;
    } else if (c === '-' && (n === 4 || n === 6)) {
      // A date separator of ISO 8601
    } else if ((c === 'T' || c === ' ') && n === 8) {
      // The time separator
    } else if (c === ':' && (n === 10 || n === 12)) {
      // A time separator
    } else if ((c === '.' || c === ',') && n === 14) {
      // The fraction of a second: not kept
      while (i + 1 < s.length && isDigit(s.charAt(i + 1))) i++;
    } else if ((c === 'Z' || c === 'z') && n >= 8) {
      // A PDF date may follow the Z with its offset, which can only be zero
      let zeros = 0;
      i++;
      while (i < s.length) {
        if (s.charAt(i) === '0') zeros++;
        else if (s.charAt(i) !== ':' && s.charAt(i) !== "'") return null;
        i++;
      }
      if (zeros !== 0 && zeros !== 2 && zeros !== 4) return null;
      z = 'Z';
    } else if ((c === '+' || c === '-') && n >= 8) {
      let zonedigits = '';
      i++;
      while (i < s.length) {
        const zc = s.charAt(i);
        if (isDigit(zc)) zonedigits += zc;
        else if (zc !== ':' && zc !== "'") return null;
        i++;
      }
      if (zonedigits.length !== 2 && zonedigits.length !== 4) return null;
      if (zonedigits.length === 2) zonedigits += '00';
      if (parseInt(zonedigits.substring(0, 2), 10) > 23 || parseInt(zonedigits.substring(2, 4), 10) > 59) return null;
      z = c + zonedigits.substring(0, 2) + ':' + zonedigits.substring(2, 4);
    } else return null;
    i++;
  }
  let dg = d;
  const len = dg.length;
  if (!(len === 4 || len === 6 || len === 8 || len === 10 || len === 12 || len === 14)) return null;
  // An hour alone: ISO 8601 and XMP ask for its minutes
  if (len === 10) dg = dg + '00';
  if (len >= 6 && (datePart(dg, 4) < 1 || datePart(dg, 4) > 12)) return null;
  if (len >= 8 && (datePart(dg, 6) < 1 || datePart(dg, 6) > 31)) return null;
  if (len >= 10 && datePart(dg, 8) > 23) return null;
  if (len >= 12 && datePart(dg, 10) > 59) return null;
  if (len >= 14 && datePart(dg, 12) > 59) return null;
  // A time zone needs a time
  if (dg.length < 10) z = '';
  return { digits: dg, zone: z };
}

/** D:yyyyMMddHHmmss followed by Z or +hh'mm' (PDFDateOf). */
export function pdfDateOf(digits: string, zone: string): string {
  let result = 'D:' + digits;
  if (zone === 'Z') result += 'Z';
  else if (zone.length === 6) result += zone.charAt(0) + zone.substring(1, 3) + "'" + zone.substring(4, 6) + "'";
  return result;
}

/** yyyy-MM-ddTHH:mm:ss followed by Z or +hh:mm, or the first parts of it (ISODateOf). */
export function isoDateOf(digits: string, zone: string): string {
  let result = digits.substring(0, 4);
  if (digits.length >= 6) result += '-' + digits.substring(4, 6);
  if (digits.length >= 8) result += '-' + digits.substring(6, 8);
  if (digits.length >= 12) {
    result += 'T' + digits.substring(8, 10) + ':' + digits.substring(10, 12);
    if (digits.length >= 14) result += ':' + digits.substring(12, 14);
    result += zone;
  }
  return result;
}

/** The PDF date of a text date, empty when it is not a date (PDFDateOfText). */
export function pdfDateOfText(text: string | null | undefined): string {
  const sd = splitDocDate(text);
  return sd === null ? '' : pdfDateOf(sd.digits, sd.zone);
}

/** A time zone offset in minutes as Z or +hh:mm (LocalZoneOf). */
export function zoneOfOffset(offsetMinutes: number): string {
  let minutes = Math.round(offsetMinutes);
  if (minutes === 0) return 'Z';
  const sign = minutes < 0 ? '-' : '+';
  minutes = Math.abs(minutes);
  return sign + String(Math.trunc(minutes / 60)).padStart(2, '0') + ':' + String(minutes % 60).padStart(2, '0');
}

const pad2 = (n: number): string => String(n).padStart(2, '0');

/**
 * The local wall time of an instant as yyyyMMddHHmmss, at a time zone offset in minutes
 * (DateTime.Now.ToString("yyyyMMddHHmmss")).
 */
export function localDigitsOf(date: Date, offsetMinutes: number): string {
  const local = new Date(date.getTime() + offsetMinutes * 60000);
  return (
    String(local.getUTCFullYear()).padStart(4, '0') +
    pad2(local.getUTCMonth() + 1) +
    pad2(local.getUTCDate()) +
    pad2(local.getUTCHours()) +
    pad2(local.getUTCMinutes()) +
    pad2(local.getUTCSeconds())
  );
}
