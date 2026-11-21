// The explicit environment of formatting and parsing: what the C# engine takes from the thread
// culture (CultureInfo.CurrentCulture, the Translator of the process) and from the machine (the
// local time zone and the clock that DateTime.Now reads).

import { CultureInfo } from '../util/culture.js';
import { type LocalTimeZone, utcTimeZone } from '../util/dateformat.js';
import { DateTimeKind, RpDateTime } from '../util/datetime.js';
import { Translator } from '../util/translator.js';

export interface VariantContext {
  /** The culture of numbers and dates (CultureInfo.CurrentCulture in C#). */
  readonly culture: CultureInfo;
  /** The engine messages (Translator.TranslateStr in C#). */
  readonly translator: Translator;
  /** The host time zone, for the "K", "o" and "U" formats and the time zones of parsed dates. */
  readonly timeZone: LocalTimeZone;
  /** DateTime.Now: the date of a parsed text with a time only. */
  readonly now: () => RpDateTime;
}

export interface ContextOptions {
  /** The message table; by default the one the C# engine picks for the culture (es or en). */
  translator?: Translator;
  timeZone?: LocalTimeZone;
  now?: () => RpDateTime;
}

/** The JavaScript clock as a local wall-clock time. */
export function systemNow(): RpDateTime {
  return RpDateTime.fromJsDate(new Date(), DateTimeKind.Local);
}

/** A context for a culture (a CultureInfo or the name of one with generated data). */
export function createContext(culture: CultureInfo | string = 'en-US', options: ContextOptions = {}): VariantContext {
  const ci = typeof culture === 'string' ? CultureInfo.get(culture) : culture;
  return {
    culture: ci,
    translator: options.translator ?? Translator.forCulture(ci),
    timeZone: options.timeZone ?? utcTimeZone,
    now: options.now ?? systemNow,
  };
}
