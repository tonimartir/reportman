// DateTime.ToString(format) of .NET 10 (System.DateTimeFormat): the standard formats (d D f F g
// G m M o O r R s t T u U y Y) and the custom ones (FormatCustomized), with an explicit culture.
// The "K", "o" and "U" formats and "z" need the offset of the host time zone for local dates:
// that comes from a LocalTimeZone (UTC when none is given).

import type { CultureInfo, DateTimeFormatData } from './culture.js';
import { DateTimeKind, RpDateTime, TICKS_PER_DAY } from './datetime.js';
import { formatException, NetMessages } from './netexception.js';

/** The host time zone: the UTC offset, in minutes, of a local wall-clock time. */
export interface LocalTimeZone {
  utcOffsetMinutes(local: RpDateTime): number;
  /** The UTC offset, in minutes, at a UTC instant (derived from utcOffsetMinutes when absent). */
  utcOffsetMinutesFromUtc?(utc: RpDateTime): number;
}

/** A time zone without offset. */
export const utcTimeZone: LocalTimeZone = { utcOffsetMinutes: () => 0 };

const INVARIANT_DAY_ABBR = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const INVARIANT_MONTH_ABBR = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

function pad(value: number, len: number): string {
  return value.toString().padStart(len, '0');
}

function parseRepeatPattern(format: string, pos: number, patternChar: string): number {
  let index = pos + 1;
  while (index < format.length && format[index] === patternChar) index++;
  return index - pos;
}

function parseNextChar(format: string, pos: number): string | null {
  if (pos >= format.length - 1) return null;
  return format[pos + 1]!;
}

/** ParseQuoteString: appends the quoted text and returns the length consumed. */
function parseQuoteString(format: string, pos: number, out: { s: string }): number {
  const formatLen = format.length;
  const beginPos = pos;
  const quoteChar = format[pos++]!;
  let foundQuote = false;
  while (pos < formatLen) {
    const ch = format[pos++]!;
    if (ch === quoteChar) {
      foundQuote = true;
      break;
    } else if (ch === '\\') {
      if (pos < formatLen) out.s += format[pos++]!;
      else throw formatException(NetMessages.formatInvalidString);
    } else {
      out.s += ch;
    }
  }
  if (!foundQuote) throw formatException(NetMessages.formatBadQuote(quoteChar));
  return pos - beginPos;
}

function isUseGenitiveForm(format: string, index: number, tokenLen: number, patternToMatch: string): boolean {
  let i: number;
  let repeat = 0;
  for (i = index - 1; i >= 0 && format[i] !== patternToMatch; i--);
  if (i >= 0) {
    while (--i >= 0 && format[i] === patternToMatch) repeat++;
    if (repeat <= 1) return true;
  }
  for (i = index + tokenLen; i < format.length && format[i] !== patternToMatch; i++);
  if (i < format.length) {
    repeat = 0;
    while (++i < format.length && format[i] === patternToMatch) repeat++;
    if (repeat <= 1) return true;
  }
  return false;
}

function localOffsetMinutes(dt: RpDateTime, tz: LocalTimeZone): number {
  return tz.utcOffsetMinutes(dt);
}

function formatOffset(minutes: number, tokenLen: number): string {
  let s = minutes >= 0 ? '+' : '-';
  const m = Math.abs(minutes);
  const hours = Math.floor(m / 60);
  const mins = m % 60;
  if (tokenLen <= 1) s += hours.toString();
  else {
    s += pad(hours, 2);
    if (tokenLen >= 3) s += ':' + pad(mins, 2);
  }
  return s;
}

function formatCustomized(dt: RpDateTime, format: string, dtfi: DateTimeFormatData, culture: CultureInfo | null, tz: LocalTimeZone, out: { s: string }): void {
  let bTimeOnly = true;
  let i = 0;
  while (i < format.length) {
    const ch = format[i]!;
    let tokenLen: number;
    switch (ch) {
      case 'g':
        tokenLen = parseRepeatPattern(format, i, ch);
        out.s += dtfi.eraName;
        break;
      case 'h': {
        tokenLen = parseRepeatPattern(format, i, ch);
        let hour12 = dt.hour;
        if (hour12 > 12) hour12 -= 12;
        else if (hour12 === 0) hour12 = 12;
        out.s += pad(hour12, Math.min(tokenLen, 2));
        break;
      }
      case 'H':
        tokenLen = parseRepeatPattern(format, i, ch);
        out.s += pad(dt.hour, Math.min(tokenLen, 2));
        break;
      case 'm':
        tokenLen = parseRepeatPattern(format, i, ch);
        out.s += pad(dt.minute, Math.min(tokenLen, 2));
        break;
      case 's':
        tokenLen = parseRepeatPattern(format, i, ch);
        out.s += pad(dt.second, Math.min(tokenLen, 2));
        break;
      case 'f':
      case 'F': {
        tokenLen = parseRepeatPattern(format, i, ch);
        if (tokenLen > 7) throw formatException(NetMessages.formatInvalidString);
        let fraction = dt.ticksOfSecond;
        fraction = Math.floor(fraction / 10 ** (7 - tokenLen));
        if (ch === 'f') {
          out.s += pad(fraction, tokenLen);
        } else {
          let effectiveDigits = tokenLen;
          while (effectiveDigits > 0) {
            if (fraction % 10 === 0) {
              fraction = Math.floor(fraction / 10);
              effectiveDigits--;
            } else break;
          }
          if (effectiveDigits > 0) out.s += pad(fraction, effectiveDigits);
          else if (out.s.length > 0 && out.s[out.s.length - 1] === '.') out.s = out.s.slice(0, -1);
        }
        break;
      }
      case 't':
        tokenLen = parseRepeatPattern(format, i, ch);
        if (tokenLen === 1) {
          const d = dt.hour < 12 ? dtfi.aMDesignator : dtfi.pMDesignator;
          if (d.length >= 1) out.s += d[0]!;
        } else {
          out.s += dt.hour < 12 ? dtfi.aMDesignator : dtfi.pMDesignator;
        }
        break;
      case 'd':
        tokenLen = parseRepeatPattern(format, i, ch);
        if (tokenLen <= 2) out.s += pad(dt.day, tokenLen);
        else out.s += tokenLen === 3 ? dtfi.abbreviatedDayNames[dt.dayOfWeek]! : dtfi.dayNames[dt.dayOfWeek]!;
        bTimeOnly = false;
        break;
      case 'M': {
        tokenLen = parseRepeatPattern(format, i, ch);
        const month = dt.month;
        if (tokenLen <= 2) out.s += pad(month, tokenLen);
        else if (culture !== null && culture.useGenitiveMonth && isUseGenitiveForm(format, i, tokenLen, 'd')) {
          out.s += tokenLen === 3 ? dtfi.abbreviatedMonthGenitiveNames[month - 1]! : dtfi.monthGenitiveNames[month - 1]!;
        } else {
          out.s += tokenLen === 3 ? dtfi.abbreviatedMonthNames[month - 1]! : dtfi.monthNames[month - 1]!;
        }
        bTimeOnly = false;
        break;
      }
      case 'y': {
        const year = dt.year;
        tokenLen = parseRepeatPattern(format, i, ch);
        if (tokenLen <= 2) out.s += pad(year % 100, tokenLen);
        else out.s += pad(year, tokenLen);
        bTimeOnly = false;
        break;
      }
      case 'z': {
        tokenLen = parseRepeatPattern(format, i, ch);
        let offset: number;
        if (bTimeOnly && dt.ticks < BigInt(TICKS_PER_DAY)) offset = localOffsetMinutes(dt, tz);
        else if (dt.kind === DateTimeKind.Utc) offset = 0;
        else offset = localOffsetMinutes(dt, tz);
        out.s += formatOffset(offset, tokenLen);
        break;
      }
      case 'K':
        tokenLen = 1;
        if (dt.kind === DateTimeKind.Local) out.s += formatOffset(localOffsetMinutes(dt, tz), 3);
        else if (dt.kind === DateTimeKind.Utc) out.s += 'Z';
        break;
      case ':':
        out.s += dtfi.timeSeparator;
        tokenLen = 1;
        break;
      case '/':
        out.s += dtfi.dateSeparator;
        tokenLen = 1;
        break;
      case "'":
      case '"':
        tokenLen = parseQuoteString(format, i, out);
        break;
      case '%': {
        const nextChar = parseNextChar(format, i);
        if (nextChar !== null && nextChar !== '%') {
          formatCustomized(dt, nextChar, dtfi, culture, tz, out);
          tokenLen = 2;
        } else {
          throw formatException(NetMessages.formatInvalidString);
        }
        break;
      }
      case '\\': {
        const nextChar = parseNextChar(format, i);
        if (nextChar !== null) {
          out.s += nextChar;
          tokenLen = 2;
        } else {
          throw formatException(NetMessages.formatInvalidString);
        }
        break;
      }
      default:
        out.s += ch;
        tokenLen = 1;
        break;
    }
    i += tokenLen;
  }
}

function toUniversal(dt: RpDateTime, tz: LocalTimeZone): RpDateTime {
  if (dt.kind === DateTimeKind.Utc) return dt;
  const offset = tz.utcOffsetMinutes(dt);
  return dt.addTicks(-BigInt(offset) * 600_000_000n).withKind(DateTimeKind.Utc);
}

/** DateTime.ToString(format) with the culture; an empty format is "G". */
export function formatDateTime(dt: RpDateTime, format: string | null | undefined, culture: CultureInfo, tz: LocalTimeZone = utcTimeZone): string {
  const dtfi = culture.date;
  let f = format ?? '';
  if (f.length === 0) f = 'G';
  if (f.length === 1) {
    switch (f) {
      case 'o':
      case 'O': {
        const out = { s: '' };
        formatCustomized(dt, "yyyy'-'MM'-'dd'T'HH':'mm':'ss.fffffffK", dtfi, null, tz, out);
        return out.s;
      }
      case 'r':
      case 'R':
        return (
          `${INVARIANT_DAY_ABBR[dt.dayOfWeek]}, ${pad(dt.day, 2)} ${INVARIANT_MONTH_ABBR[dt.month - 1]} ${pad(dt.year, 4)} ` +
          `${pad(dt.hour, 2)}:${pad(dt.minute, 2)}:${pad(dt.second, 2)} GMT`
        );
      case 's':
        return `${pad(dt.year, 4)}-${pad(dt.month, 2)}-${pad(dt.day, 2)}T${pad(dt.hour, 2)}:${pad(dt.minute, 2)}:${pad(dt.second, 2)}`;
      case 'u':
        return `${pad(dt.year, 4)}-${pad(dt.month, 2)}-${pad(dt.day, 2)} ${pad(dt.hour, 2)}:${pad(dt.minute, 2)}:${pad(dt.second, 2)}Z`;
      case 'd':
        f = dtfi.shortDatePattern;
        break;
      case 'D':
        f = dtfi.longDatePattern;
        break;
      case 'f':
        f = dtfi.longDatePattern + ' ' + dtfi.shortTimePattern;
        break;
      case 'F':
        f = dtfi.fullDateTimePattern;
        break;
      case 'g':
        f = dtfi.shortDatePattern + ' ' + dtfi.shortTimePattern;
        break;
      case 'G':
        f = dtfi.shortDatePattern + ' ' + dtfi.longTimePattern;
        break;
      case 'm':
      case 'M':
        f = dtfi.monthDayPattern;
        break;
      case 't':
        f = dtfi.shortTimePattern;
        break;
      case 'T':
        f = dtfi.longTimePattern;
        break;
      case 'U':
        dt = toUniversal(dt, tz);
        f = dtfi.fullDateTimePattern;
        break;
      case 'y':
      case 'Y':
        f = dtfi.yearMonthPattern;
        break;
      default:
        throw formatException(NetMessages.formatInvalidString);
    }
  }
  const out = { s: '' };
  formatCustomized(dt, f, dtfi, culture, tz, out);
  return out.s;
}

/** DateTime.ToShortDateString. */
export function shortDateString(dt: RpDateTime, culture: CultureInfo): string {
  return formatDateTime(dt, 'd', culture);
}

function equalsIgnoreCaseAt(s: string, index: number, word: string): boolean {
  if (index + word.length > s.length) return false;
  for (let k = 0; k < word.length; k++) {
    if (s[index + k]!.toUpperCase() !== word[k]!.toUpperCase()) return false;
  }
  return true;
}

function containsIgnoreCase(s: string, word: string): boolean {
  for (let i = 0; i + word.length <= s.length; i++) if (equalsIgnoreCaseAt(s, i, word)) return true;
  return false;
}

/**
 * Variant.DateFormatMask: report masks follow Delphi's FormatDateTime (lower case m is the month,
 * minutes only right after an hour; n the minutes; z the milliseconds; h the 24 hour clock unless
 * am/pm is present). Upper case tokens and quoted literals pass through.
 */
export function dateFormatMask(mask: string): string {
  if (mask.length === 0) return mask;
  const twelveHours = containsIgnoreCase(mask, 'am/pm') || containsIgnoreCase(mask, 'a/p') || containsIgnoreCase(mask, 'ampm');
  let sb = '';
  let lastToken = '\0';
  let i = 0;
  while (i < mask.length) {
    const c = mask[i]!;
    if (c === "'" || c === '"') {
      let end = mask.indexOf(c, i + 1);
      if (end < 0) end = mask.length - 1;
      sb += mask.substring(i, end + 1);
      i = end + 1;
      continue;
    }
    if (equalsIgnoreCaseAt(mask, i, 'am/pm')) {
      sb += 'tt';
      i += 5;
      lastToken = 't';
      continue;
    }
    if (equalsIgnoreCaseAt(mask, i, 'ampm')) {
      sb += 'tt';
      i += 4;
      lastToken = 't';
      continue;
    }
    if (equalsIgnoreCaseAt(mask, i, 'a/p')) {
      sb += 't';
      i += 3;
      lastToken = 't';
      continue;
    }
    let run = 1;
    while (i + run < mask.length && mask[i + run] === c) run++;
    switch (c) {
      case 'm': {
        const t = lastToken === 'h' ? 'm' : 'M';
        sb += t.repeat(run);
        lastToken = t;
        break;
      }
      case 'n':
        sb += 'm'.repeat(run);
        lastToken = 'm';
        break;
      case 'h':
        sb += (twelveHours ? 'h' : 'H').repeat(run);
        lastToken = 'h';
        break;
      case 'z':
        sb += 'f'.repeat(run);
        lastToken = 'f';
        break;
      case 'c':
        if (run === 1) {
          sb += 'g';
          lastToken = 'g';
          break;
        }
        sb += c.repeat(run);
        lastToken = c;
        break;
      case 'd':
      case 'y':
      case 's':
      case 'H':
      case 'M':
      case 'f':
      case 'F':
      case 't':
      case 'g':
        sb += c.repeat(run);
        lastToken = c === 'H' ? 'h' : c;
        break;
      default:
        sb += c.repeat(run);
        if (!/[\t-\r \u0085\u00a0\u1680\u2000-\u200a\u2028\u2029\u202f\u205f\u3000]/.test(c) && c !== '/' && c !== ':' && c !== '.' && c !== '-' && c !== ',') {
          lastToken = c;
        }
        break;
    }
    i += run;
  }
  return sb;
}

