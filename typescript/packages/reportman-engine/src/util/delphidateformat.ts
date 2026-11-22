// The date masks of the Delphi engine, for the reports converted from Delphi (convertedFromDelphi,
// decision of 22-11-2026): FormatDateTime of the Delphi RTL (DateTimeToString of
// System.SysUtils), with the format settings Delphi takes from Windows for the culture
// (TFormatSettings.Create). The reports of the C# engine keep the masks of .NET (dateFormatMask).
// The same code as DelphiDateFormat.cs of the C# engine; both are checked against Delphi itself
// (tools/golden-delphi-dates).

import type { CultureInfo } from './culture.js';
import type { RpDateTime } from './datetime.js';
import { DELPHI_FORMAT_SETTINGS } from './delphiformatsettings.generated.js';

/** TFormatSettings: what FormatDateTime reads, the day names from Sunday. */
export interface DelphiFormatSettings {
  readonly shortDateFormat: string;
  readonly longDateFormat: string;
  readonly shortTimeFormat: string;
  readonly longTimeFormat: string;
  readonly timeAMString: string;
  readonly timePMString: string;
  /** '' when Delphi has #0 (nothing is written). */
  readonly dateSeparator: string;
  readonly timeSeparator: string;
  readonly shortMonthNames: readonly string[];
  readonly longMonthNames: readonly string[];
  readonly shortDayNames: readonly string[];
  readonly longDayNames: readonly string[];
  /** The era of the calendar of the locale (GetDateFormat 'gg'), for the g mask. */
  readonly eraName: string;
}

/**
 * The format settings of a culture: those of Delphi on Windows for the cultures with a table, by
 * name or, for a neutral culture ("ca"), the first of its language.
 */
export function delphiFormatSettings(culture: CultureInfo): DelphiFormatSettings {
  const name = culture.name.toLowerCase();
  const keys = Object.keys(DELPHI_FORMAT_SETTINGS);
  const key =
    keys.find((k) => k.toLowerCase() === name) ?? (name.includes('-') ? undefined : keys.find((k) => k.toLowerCase().startsWith(name + '-')));
  // The engine has data for the cultures of the table only (CultureInfo.get)
  return DELPHI_FORMAT_SETTINGS[key ?? 'en-US'] as DelphiFormatSettings;
}

const isHigh = (c: number): boolean => c >= 0xd800 && c <= 0xdbff;
const isLow = (c: number): boolean => c >= 0xdc00 && c <= 0xdfff;

/** The length of the character at i (StrCharLength): a surrogate pair is two code units. */
function charLength(s: string, i: number): number {
  return isHigh(s.charCodeAt(i)) && i + 1 < s.length && isLow(s.charCodeAt(i + 1)) ? 2 : 1;
}

/** StrLIComp(P, S, Length(S)) = 0: the text at i is s, ASCII letters in any case. */
function startsWithI(text: string, i: number, s: string): boolean {
  if (i + s.length > text.length) return false;
  for (let k = 0; k < s.length; k++) {
    let a = text.charCodeAt(i + k);
    if (a >= 97 && a <= 122) a -= 32;
    if (a !== s.charCodeAt(k)) return false;
  }
  return true;
}

/** '%.*d': at least digits digits. */
function pad(n: number, digits: number): string {
  const s = String(n);
  return s.length >= digits ? s : '0'.repeat(digits - s.length) + s;
}

/**
 * FormatDateTime(mask, value) of Delphi: d m y h n s z for day, month, year, hour, minute, second
 * and millisecond (m is the minute right after an h), ddd dddd mmm mmmm for the names, ddddd
 * dddddd c t tt for the formats of the settings (one level deep, as Delphi), am/pm a/p ampm for the
 * 12 hour clock (an h looks ahead for one before the next h), g and e for the era, / and : for the
 * separators, quoted text as it is. An empty mask is c.
 */
export function formatDateTimeDelphi(value: RpDateTime, mask: string, fs: DelphiFormatSettings): string {
  const year = value.year;
  const month = value.month;
  const day = value.day;
  const dow = value.dayOfWeek;
  const hour = value.hour;
  const min = value.minute;
  const sec = value.second;
  const msec = value.millisecond;
  let out = '';
  let level = 0;

  const appendFormat = (format: string): void => {
    if (level >= 2) return;
    level++;
    let lastToken = ' ';
    let use12HourClock = false;
    let i = 0;
    while (i < format.length) {
      const starter = format.charAt(i);
      if (isHigh(format.charCodeAt(i))) {
        const n = charLength(format, i);
        out += format.substr(i, n);
        i += n;
        lastToken = ' ';
        continue;
      }
      i++;
      // GetCount: the starter and the same characters after it
      const getCount = (): number => {
        const p = i;
        while (i < format.length && format.charAt(i) === starter) i++;
        return i - p + 1;
      };
      let token = starter;
      const tc = token.charCodeAt(0);
      if (tc >= 97 && tc <= 122) token = String.fromCharCode(tc - 32);
      const uc = token.charCodeAt(0);
      if (uc >= 65 && uc <= 90) {
        if (token === 'M' && lastToken === 'H') token = 'N';
        lastToken = token;
      }
      switch (token) {
        case 'Y': {
          const count = getCount();
          out += count <= 2 ? pad(year % 100, 2) : pad(year, 4);
          break;
        }
        case 'G':
          getCount();
          out += fs.eraName;
          break;
        case 'E': {
          // ConvertYearString: GetDateFormat 'yy' or 'yyyy' in the calendar of the locale (Gregorian)
          const count = getCount();
          let s = count <= 2 ? pad(year % 100, 2) : pad(year, 4);
          if (count === 1 && s.charAt(0) === '0') s = s.substring(1);
          out += s;
          break;
        }
        case 'M': {
          const count = getCount();
          if (count <= 2) out += pad(month, count);
          else out += count === 3 ? fs.shortMonthNames[month - 1] : fs.longMonthNames[month - 1];
          break;
        }
        case 'D': {
          const count = getCount();
          if (count <= 2) out += pad(day, count);
          else if (count === 3) out += fs.shortDayNames[dow];
          else if (count === 4) out += fs.longDayNames[dow];
          else if (count === 5) appendFormat(fs.shortDateFormat);
          else appendFormat(fs.longDateFormat);
          break;
        }
        case 'H': {
          let count = getCount();
          // The 12 hour clock when an am/pm follows before another hour (outside quotes)
          let betweenQuotes = false;
          let p = i;
          while (p < format.length) {
            const ch = format.charAt(p);
            if (isHigh(format.charCodeAt(p))) {
              p += charLength(format, p);
              continue;
            }
            if (ch === 'A' || ch === 'a') {
              if (!betweenQuotes) {
                if (startsWithI(format, p, 'AM/PM') || startsWithI(format, p, 'A/P') || startsWithI(format, p, 'AMPM')) use12HourClock = true;
                break;
              }
            } else if (ch === 'H' || ch === 'h') break;
            else if (ch === "'" || ch === '"') betweenQuotes = !betweenQuotes;
            p++;
          }
          let h = hour;
          if (use12HourClock) {
            if (h === 0) h = 12;
            else if (h > 12) h -= 12;
          }
          if (count > 2) count = 2;
          out += pad(h, count);
          break;
        }
        case 'N':
          out += pad(min, Math.min(getCount(), 2));
          break;
        case 'S':
          out += pad(sec, Math.min(getCount(), 2));
          break;
        case 'T':
          appendFormat(getCount() === 1 ? fs.shortTimeFormat : fs.longTimeFormat);
          break;
        case 'Z':
          out += pad(msec, Math.min(getCount(), 3));
          break;
        case 'A': {
          const p = i - 1;
          if (startsWithI(format, p, 'AM/PM')) {
            // The text of the mask itself: am/pm gives am or pm
            out += format.substr(hour >= 12 ? p + 3 : p, 2);
            i += 4;
            use12HourClock = true;
          } else if (startsWithI(format, p, 'A/P')) {
            out += format.charAt(hour >= 12 ? p + 2 : p);
            i += 2;
            use12HourClock = true;
          } else if (startsWithI(format, p, 'AMPM')) {
            out += hour < 12 ? fs.timeAMString : fs.timePMString;
            i += 3;
            use12HourClock = true;
          } else if (startsWithI(format, p, 'AAAA')) {
            out += fs.longDayNames[dow];
            i += 3;
          } else if (startsWithI(format, p, 'AAA')) {
            out += fs.shortDayNames[dow];
            i += 2;
          } else out += starter;
          break;
        }
        case 'C':
          getCount();
          appendFormat(fs.shortDateFormat);
          if (hour !== 0 || min !== 0 || sec !== 0 || msec !== 0) {
            out += ' ';
            appendFormat(fs.longTimeFormat);
          }
          break;
        case '/':
          out += fs.dateSeparator;
          break;
        case ':':
          out += fs.timeSeparator;
          break;
        case "'":
        case '"': {
          const p = i;
          while (i < format.length && format.charAt(i) !== starter) i += isHigh(format.charCodeAt(i)) ? charLength(format, i) : 1;
          out += format.substring(p, i);
          if (i < format.length) i++;
          break;
        }
        default:
          out += starter;
      }
    }
    level--;
  };

  appendFormat(mask === '' ? 'C' : mask);
  return out;
}
