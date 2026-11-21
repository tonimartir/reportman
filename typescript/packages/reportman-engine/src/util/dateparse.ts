// DateTime.Parse / DateTime.TryParse(s, culture, DateTimeStyles.None) of .NET 10
// (System.DateTimeParse): the lexer over the culture's tokens (month and day names, AM/PM
// designators, date words, separators), the date parsing state machine, the terminal states that
// resolve the numbers with the culture's date order, the ISO 8601 path ("yyyy-MM-ddTHH:mm:ss") and
// time zone offsets ("Z", "GMT", "+hh:mm"), which convert the result to local time.
//
// The Gregorian calendar only: the CJK date suffixes, the Hebrew and Japanese calendars and the
// culture-specific quirks of Albanian, Vietnamese... are not part of the port.

import type { CultureInfo } from './culture.js';
import { DateTimeKind, daysInMonth, RpDateTime, TICKS_PER_DAY, TICKS_PER_SECOND } from './datetime.js';
import { collatorFor, isLetter, isWhiteSpace } from './chars.js';
import { formatException } from './netexception.js';
import type { LocalTimeZone } from './dateformat.js';
import { roundHalfEvenDouble } from './numberparse.js';

// TokenType
const NumberToken = 1;
const YearNumberToken = 2;
const Am = 3;
const Pm = 4;
const MonthToken = 5;
const EndOfString = 6;
const DayOfWeekToken = 7;
const TimeZoneToken = 8;
const EraToken = 9;
const DateWordToken = 10;
const UnknownToken = 11;
const IgnorableSymbol = 15;
const RegularTokenMask = 0x00ff;
const SEP_End = 0x200;
const SEP_Space = 0x300;
const SEP_Am = 0x400;
const SEP_Pm = 0x500;
const SEP_Date = 0x600;
const SEP_Time = 0x700;
const SEP_LocalTimeMark = 0xe00;
const SEP_DateOrOffset = 0xf00;
const SeparatorTokenMask = 0xff00;

// DTT
enum DTT {
  End = 0,
  NumEnd,
  NumAmpm,
  NumSpace,
  NumDatesep,
  NumTimesep,
  MonthEnd,
  MonthSpace,
  MonthDatesep,
  NumDatesuff,
  NumTimesuff,
  DayOfWeek,
  YearSpace,
  YearDateSep,
  YearEnd,
  TimeZone,
  Era,
  NumUTCTimeMark,
  Unk,
  NumLocalTimeMark,
}

// DS
enum DS {
  BEGIN = 0,
  N,
  NN,
  D_Nd,
  D_NN,
  D_NNd,
  D_M,
  D_MN,
  D_NM,
  D_MNd,
  D_NDS,
  D_Y,
  D_YN,
  D_YNd,
  D_YM,
  D_YMd,
  D_S,
  T_S,
  T_Nt,
  T_NNt,
  ERROR,
  DX_NN,
  DX_NNN,
  DX_MN,
  DX_NM,
  DX_MNN,
  DX_DS,
  DX_DSN,
  DX_NDS,
  DX_NNDS,
  DX_YNN,
  DX_YMN,
  DX_YN,
  DX_YM,
  TX_N,
  TX_NN,
  TX_NNN,
  TX_TS,
  DX_NNY,
}

const E = DS.ERROR;
// s_dateParsingStates: [state][DTT End .. NumUTCTimeMark]
const DATE_PARSING_STATES: readonly (readonly DS[])[] = [
  /* BEGIN */ [DS.BEGIN, E, DS.TX_N, DS.N, DS.D_Nd, DS.T_Nt, E, DS.D_M, DS.D_M, DS.D_S, DS.T_S, DS.BEGIN, DS.D_Y, DS.D_Y, E, DS.BEGIN, DS.BEGIN, E],
  /* N */ [E, DS.DX_NN, E, DS.NN, DS.D_NNd, E, DS.DX_NM, DS.D_NM, DS.D_MNd, DS.D_NDS, E, DS.N, DS.D_YN, DS.D_YNd, DS.DX_YN, DS.N, DS.N, E],
  /* NN */ [DS.DX_NN, DS.DX_NNN, DS.TX_N, DS.DX_NNN, E, DS.T_Nt, DS.DX_MNN, DS.DX_MNN, E, E, DS.T_S, DS.NN, DS.DX_NNY, E, DS.DX_NNY, DS.NN, DS.NN, E],
  /* D_Nd */ [E, DS.DX_NN, E, DS.D_NN, DS.D_NNd, E, DS.DX_NM, DS.D_MN, DS.D_MNd, E, E, DS.D_Nd, DS.D_YN, DS.D_YNd, DS.DX_YN, E, DS.D_Nd, E],
  /* D_NN */ [DS.DX_NN, DS.DX_NNN, DS.TX_N, DS.DX_NNN, E, DS.T_Nt, DS.DX_MNN, DS.DX_MNN, E, DS.DX_DS, DS.T_S, DS.D_NN, DS.DX_NNY, E, DS.DX_NNY, E, DS.D_NN, E],
  /* D_NNd */ [E, DS.DX_NNN, DS.DX_NNN, DS.DX_NNN, E, E, DS.DX_MNN, DS.DX_MNN, E, DS.DX_DS, E, DS.D_NNd, DS.DX_NNY, E, DS.DX_NNY, E, DS.D_NNd, E],
  /* D_M */ [E, DS.DX_MN, E, DS.D_MN, DS.D_MNd, E, E, E, E, E, E, DS.D_M, DS.D_YM, DS.D_YMd, DS.DX_YM, E, DS.D_M, E],
  /* D_MN */ [DS.DX_MN, DS.DX_MNN, DS.DX_MNN, DS.DX_MNN, E, DS.T_Nt, E, E, E, DS.DX_DS, DS.T_S, DS.D_MN, DS.DX_YMN, E, DS.DX_YMN, E, DS.D_MN, E],
  /* D_NM */ [DS.DX_NM, DS.DX_MNN, DS.DX_MNN, DS.DX_MNN, E, DS.T_Nt, E, E, E, DS.DX_DS, DS.T_S, DS.D_NM, DS.DX_YMN, E, DS.DX_YMN, E, DS.D_NM, E],
  /* D_MNd */ [E, DS.DX_MNN, E, DS.DX_MNN, E, E, E, E, E, E, E, DS.D_MNd, DS.DX_YMN, E, DS.DX_YMN, E, DS.D_MNd, E],
  /* D_NDS */ [DS.DX_NDS, DS.DX_NNDS, DS.DX_NNDS, DS.DX_NNDS, E, DS.T_Nt, E, E, E, DS.D_NDS, DS.T_S, DS.D_NDS, E, E, E, E, DS.D_NDS, E],
  /* D_Y */ [E, DS.DX_YN, E, DS.D_YN, DS.D_YNd, E, DS.DX_YM, DS.D_YM, DS.D_YMd, DS.D_YM, E, DS.D_Y, E, E, E, E, DS.D_Y, E],
  /* D_YN */ [DS.DX_YN, DS.DX_YNN, DS.DX_YNN, DS.DX_YNN, E, E, DS.DX_YMN, DS.DX_YMN, E, E, E, DS.D_YN, E, E, E, E, DS.D_YN, E],
  /* D_YNd */ [E, DS.DX_YNN, DS.DX_YNN, DS.DX_YNN, E, E, DS.DX_YMN, DS.DX_YMN, E, E, E, DS.D_YN, E, E, E, E, DS.D_YN, E],
  /* D_YM */ [DS.DX_YM, DS.DX_YMN, DS.DX_YMN, DS.DX_YMN, E, E, E, E, E, E, E, DS.D_YM, E, E, E, E, DS.D_YM, E],
  /* D_YMd */ [E, DS.DX_YMN, DS.DX_YMN, DS.DX_YMN, E, E, E, E, E, E, E, DS.D_YM, E, E, E, E, DS.D_YM, E],
  /* D_S */ [DS.DX_DS, DS.DX_DSN, DS.TX_N, DS.T_Nt, E, DS.T_Nt, E, E, E, DS.D_S, DS.T_S, DS.D_S, E, E, E, E, DS.D_S, E],
  /* T_S */ [DS.TX_TS, DS.TX_TS, DS.TX_TS, DS.T_Nt, DS.D_Nd, E, E, E, E, DS.D_S, DS.T_S, DS.T_S, E, E, E, DS.T_S, DS.T_S, E],
  /* T_Nt */ [E, DS.TX_NN, DS.TX_NN, DS.TX_NN, E, DS.T_NNt, DS.DX_NM, DS.D_NM, E, E, DS.T_S, E, E, E, E, DS.T_Nt, DS.T_Nt, DS.TX_NN],
  /* T_NNt */ [E, DS.TX_NNN, DS.TX_NNN, DS.TX_NNN, E, E, E, E, E, E, DS.T_S, DS.T_NNt, E, E, E, DS.T_NNt, DS.T_NNt, DS.TX_NNN],
];

const ORDER_YMD = 0;
const ORDER_MDY = 1;
const ORDER_DMY = 2;
const ORDER_YDM = 3;
const ORDER_YM = 4;
const ORDER_MY = 5;
const ORDER_MD = 6;
const ORDER_DM = 7;

const TWO_DIGIT_YEAR_MAX = 2049;

const INVARIANT_MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const INVARIANT_MONTHS_ABBR = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const INVARIANT_DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const INVARIANT_DAYS_ABBR = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

interface Token {
  str: string;
  type: number;
  value: number;
}

interface TokenTable {
  tokens: Token[];
  collator: Intl.Collator;
}

const tableCache = new Map<string, TokenTable>();

/** DateTimeFormatInfoScanner.GetDateWordsOfDTFI for the patterns the culture data has. */
function dateWords(culture: CultureInfo): string[] {
  const words: string[] = [];
  const d = culture.date;
  const add = (w: string, postfixOfMonth: boolean) => {
    if (w.length === 0) return;
    if (w === '.') return;
    if (postfixOfMonth) return;
    if (!words.includes(w)) words.push(w);
    if (w.endsWith('.')) {
      const w2 = w.slice(0, -1);
      if (!words.includes(w2)) words.push(w2);
    }
  };
  const scan = (pattern: string) => {
    let i = 0;
    while (i < pattern.length) {
      const ch = pattern[i]!;
      if (ch === "'") {
        // AddDateWords: skip leading white space / non letters, split on white space
        let j = i + 1;
        let postfix = i >= 4 && pattern.substring(i - 4, i) === 'MMMM';
        const start = j;
        while (j < pattern.length && (isWhiteSpace(pattern[j]!) || !isLetter(pattern[j]!)) && pattern[j] !== "'") j++;
        if (j !== start) postfix = false;
        let word = '';
        while (j < pattern.length) {
          const c = pattern[j]!;
          if (c === "'") {
            add(word, postfix);
            j++;
            break;
          } else if (c === '\\') {
            j++;
            if (j < pattern.length) word += pattern[j++]!;
          } else if (isWhiteSpace(c)) {
            add(word, postfix);
            postfix = false;
            word = '';
            j++;
          } else {
            word += c;
            j++;
          }
        }
        i = j;
      } else if (ch === '\\') {
        i += 2;
      } else i++;
    }
  };
  for (const p of [d.longDatePattern, d.shortDatePattern, d.yearMonthPattern, d.monthDayPattern, d.longTimePattern, d.shortTimePattern]) scan(p);
  return words;
}

function tokenTable(culture: CultureInfo): TokenTable {
  let t = tableCache.get(culture.name);
  if (t !== undefined) return t;
  const collator = collatorFor(culture.name, { sensitivity: 'accent', usage: 'search' });
  const tokens: Token[] = [];
  const insert = (str: string | undefined, type: number, value: number) => {
    if (str === undefined || str.length === 0) return;
    str = str.trim();
    if (str.length === 0) return;
    const existing = tokens.find((x) => x.str.length === str.length && collator.compare(x.str, str) === 0);
    if (existing !== undefined) {
      // InsertHash: the first regular type and the first separator type are kept
      if (((existing.type & RegularTokenMask) === 0 && (type & RegularTokenMask) !== 0) || ((existing.type & SeparatorTokenMask) === 0 && (type & SeparatorTokenMask) !== 0)) {
        existing.type |= type;
        if (value !== 0) existing.value = value;
      }
      return;
    }
    tokens.push({ str, type, value });
  };
  const d = culture.date;
  const lang = culture.twoLetterISOLanguageName;
  const timeSep = d.timeSeparator.trim();
  if (timeSep !== ',') insert(',', IgnorableSymbol, 0);
  if (timeSep !== '.') insert('.', IgnorableSymbol, 0);
  insert('-', SEP_DateOrOffset, 0);
  insert(d.timeSeparator, SEP_Time, 0);
  insert(d.aMDesignator, SEP_Am | Am, 0);
  insert(d.pMDesignator, SEP_Pm | Pm, 1);
  for (const w of dateWords(culture)) insert(w, DateWordToken, 0);
  insert(d.dateSeparator, SEP_Date, 0);
  for (let i = 1; i <= 13; i++) insert(d.monthNames[i - 1], MonthToken, i);
  for (let i = 1; i <= 13; i++) insert(d.abbreviatedMonthNames[i - 1], MonthToken, i);
  if (culture.useGenitiveMonth) {
    for (let i = 0; i < 13; i++) {
      insert(d.monthGenitiveNames[i], MonthToken, i + 1);
      insert(d.abbreviatedMonthGenitiveNames[i], MonthToken, i + 1);
    }
  }
  for (let i = 0; i < 7; i++) {
    insert(d.dayNames[i], DayOfWeekToken, i);
    insert(d.abbreviatedDayNames[i], DayOfWeekToken, i);
  }
  insert(d.eraName, EraToken, 1);
  if (lang !== 'en') {
    insert('AM', SEP_Am | Am, 0);
    insert('PM', SEP_Pm | Pm, 1);
    for (let i = 1; i <= 12; i++) {
      insert(INVARIANT_MONTHS[i - 1], MonthToken, i);
      insert(INVARIANT_MONTHS_ABBR[i - 1], MonthToken, i);
    }
    for (let i = 0; i < 7; i++) {
      insert(INVARIANT_DAYS[i], DayOfWeekToken, i);
      insert(INVARIANT_DAYS_ABBR[i], DayOfWeekToken, i);
    }
  }
  insert('T', SEP_LocalTimeMark, 0);
  insert('GMT', TimeZoneToken, 0);
  insert('Z', TimeZoneToken, 0);
  insert('/', SEP_Date, 0);
  insert(':', SEP_Time, 0);
  // Longer tokens first among those sharing a prefix (the hash table keeps them in front).
  const ordered = tokens.map((tk, i) => ({ tk, i })).sort((a, b) => b.tk.str.length - a.tk.str.length || a.i - b.i).map((x) => x.tk);
  t = { tokens: ordered, collator };
  tableCache.set(culture.name, t);
  return t;
}

/** The parser's view of the input (__DTString). */
class DTString {
  readonly value: string;
  index = 0;

  constructor(value: string) {
    this.value = value;
  }

  get length(): number {
    return this.value.length;
  }

  get current(): string {
    return this.index < this.value.length ? this.value[this.index]! : '\0';
  }

  /** The current character (a method, so that a caller re-reads it after moving). */
  cur(): string {
    return this.current;
  }
}

function isDigitChar(c: string): boolean {
  return c >= '0' && c <= '9' && c.length === 1;
}

function tokenize(table: TokenTable, mask: number, str: DTString): { type: number; value: number } | null {
  if (str.index >= str.length) return null;
  const ch = str.current;
  const letter = isLetter(ch);
  const remaining = str.length - str.index;
  for (const tk of table.tokens) {
    if ((tk.type & mask) === 0 || tk.str.length > remaining) continue;
    if (letter) {
      const next = str.index + tk.str.length;
      if (next < str.length && isLetter(str.value[next]!)) continue;
    }
    const slice = str.value.substr(str.index, tk.str.length);
    if ((tk.str.length === 1 && slice === tk.str) || table.collator.compare(slice, tk.str) === 0) {
      str.index += tk.str.length;
      return { type: tk.type & mask, value: tk.value };
    }
  }
  return null;
}

/** GetRegularToken. */
function getRegularToken(table: TokenTable, str: DTString): { type: number; value: number; length: number } {
  for (;;) {
    if (str.index >= str.length) return { type: EndOfString, value: 0, length: 0 };
    const c = str.current;
    if (isDigitChar(c)) {
      const start = str.index;
      let value = 0;
      while (str.index < str.length && isDigitChar(str.current)) {
        value = value * 10 + (str.current.charCodeAt(0) - 48);
        str.index++;
      }
      const len = str.index - start;
      if (len > 8) return { type: NumberToken, value: -1, length: len };
      if (len < 3) return { type: NumberToken, value, length: len };
      return { type: YearNumberToken, value, length: len };
    }
    if (isWhiteSpace(c)) {
      str.index++;
      continue;
    }
    const t = tokenize(table, RegularTokenMask, str);
    if (t === null) return { type: UnknownToken, value: 0, length: 0 };
    return { type: t.type, value: t.value, length: 0 };
  }
}

/** GetSeparatorToken: the separator after a number or a month name. */
function getSeparatorToken(table: TokenTable, str: DTString): { sep: number; indexBefore: number } {
  const indexBefore = str.index;
  while (str.index < str.length && isWhiteSpace(str.current)) str.index++;
  if (str.index >= str.length) return { sep: SEP_End, indexBefore };
  if (isDigitChar(str.current)) return { sep: SEP_Space, indexBefore };
  const t = tokenize(table, SeparatorTokenMask, str);
  return { sep: t === null ? SEP_Space : t.type, indexBefore };
}

const TM_NotSet = -1;
const TM_AM = 0;
const TM_PM = 1;

interface RawInfo {
  num: number[];
  month: number;
  year: number;
  dayOfWeek: number;
  timeMark: number;
  fraction: number;
}

interface Result {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
  haveDate: boolean;
  haveTime: boolean;
  timeZoneUsed: boolean;
  timeZoneOffsetMinutes: number;
  era: number;
}

/** ParseTimeZone: "+h", "+hh", "+hh:mm", "+hmm", "+hhmm" at the current '+' or '-'. */
function parseTimeZone(str: DTString): number | null {
  const sign = str.current;
  if (sign !== '+' && sign !== '-') return null;
  let i = str.index + 1;
  const digitsStart = i;
  let value = 0;
  while (i < str.length && isDigitChar(str.value[i]!)) {
    if (i - digitsStart >= 8) return null;
    value = value * 10 + (str.value.charCodeAt(i) - 48);
    i++;
  }
  const length = i - digitsStart;
  let hourOffset: number;
  let minuteOffset = 0;
  if (length === 1 || length === 2) {
    hourOffset = value;
    if (i < str.length && str.value[i] === ':') {
      let j = i + 1;
      const ms = j;
      let mv = 0;
      while (j < str.length && isDigitChar(str.value[j]!)) {
        mv = mv * 10 + (str.value.charCodeAt(j) - 48);
        j++;
      }
      const ml = j - ms;
      if (ml < 1 || ml > 2) return null;
      minuteOffset = mv;
      i = j;
    }
  } else if (length === 3 || length === 4) {
    hourOffset = Math.floor(value / 100);
    minuteOffset = value % 100;
  } else return null;
  if (minuteOffset < 0 || minuteOffset >= 60) return null;
  str.index = i;
  const total = hourOffset * 60 + minuteOffset;
  return sign === '-' ? -total : total;
}

/** HandleTimeZone: a "+hh:mm" / "-hh:mm" right after a time number. */
function handleTimeZone(str: DTString, result: Result): boolean {
  if (str.index < str.length - 1) {
    let k = str.index;
    let nextCh = str.value[k]!;
    while (isWhiteSpace(nextCh) && k < str.length - 1) {
      k++;
      nextCh = str.value[k]!;
    }
    if (nextCh === '+' || nextCh === '-') {
      str.index = k;
      if (result.timeZoneUsed) return false;
      result.timeZoneUsed = true;
      const tz = parseTimeZone(str);
      if (tz === null) return false;
      result.timeZoneOffsetMinutes = tz;
    }
  }
  return true;
}

/** ParseFraction: the digits after the '.' at the current position, summed as .NET sums them. */
function parseFraction(str: DTString): { ok: boolean; fraction: number } {
  let result = 0;
  let decimalBase = 0.1;
  let digits = 0;
  str.index++;
  while (str.index < str.length && isDigitChar(str.current)) {
    result += (str.current.charCodeAt(0) - 48) * decimalBase;
    decimalBase *= 0.1;
    digits++;
    str.index++;
  }
  return { ok: digits > 0, fraction: result };
}

function getYearMonthDayOrder(pattern: string): number {
  let yearOrder = -1;
  let monthOrder = -1;
  let dayOrder = -1;
  let orderCount = 0;
  let inQuote = false;
  for (let i = 0; i < pattern.length && orderCount < 3; i++) {
    const ch = pattern[i]!;
    if (ch === '\\' || ch === '%') {
      i++;
      continue;
    }
    if (ch === "'" || ch === '"') inQuote = !inQuote;
    if (!inQuote) {
      if (ch === 'y') {
        yearOrder = orderCount++;
        while (i + 1 < pattern.length && pattern[i + 1] === 'y') i++;
      } else if (ch === 'M') {
        monthOrder = orderCount++;
        while (i + 1 < pattern.length && pattern[i + 1] === 'M') i++;
      } else if (ch === 'd') {
        let patternCount = 1;
        while (i + 1 < pattern.length && pattern[i + 1] === 'd') {
          patternCount++;
          i++;
        }
        if (patternCount <= 2) dayOrder = orderCount++;
      }
    }
  }
  if (yearOrder === 0 && monthOrder === 1 && dayOrder === 2) return ORDER_YMD;
  if (monthOrder === 0 && dayOrder === 1 && yearOrder === 2) return ORDER_MDY;
  if (dayOrder === 0 && monthOrder === 1 && yearOrder === 2) return ORDER_DMY;
  if (yearOrder === 0 && dayOrder === 1 && monthOrder === 2) return ORDER_YDM;
  return -1;
}

function getYearMonthOrder(pattern: string): number {
  let yearOrder = -1;
  let monthOrder = -1;
  let orderCount = 0;
  let inQuote = false;
  for (let i = 0; i < pattern.length && orderCount < 2; i++) {
    const ch = pattern[i]!;
    if (ch === '\\' || ch === '%') {
      i++;
      continue;
    }
    if (ch === "'" || ch === '"') inQuote = !inQuote;
    if (!inQuote) {
      if (ch === 'y') {
        yearOrder = orderCount++;
        while (i + 1 < pattern.length && pattern[i + 1] === 'y') i++;
      } else if (ch === 'M') {
        monthOrder = orderCount++;
        while (i + 1 < pattern.length && pattern[i + 1] === 'M') i++;
      }
    }
  }
  if (yearOrder === 0 && monthOrder === 1) return ORDER_YM;
  if (monthOrder === 0 && yearOrder === 1) return ORDER_MY;
  return -1;
}

function getMonthDayOrder(pattern: string): number {
  let monthOrder = -1;
  let dayOrder = -1;
  let orderCount = 0;
  let inQuote = false;
  for (let i = 0; i < pattern.length && orderCount < 2; i++) {
    const ch = pattern[i]!;
    if (ch === '\\' || ch === '%') {
      i++;
      continue;
    }
    if (ch === "'" || ch === '"') inQuote = !inQuote;
    if (!inQuote) {
      if (ch === 'd') {
        let patternCount = 1;
        while (i + 1 < pattern.length && pattern[i + 1] === 'd') {
          patternCount++;
          i++;
        }
        if (patternCount <= 2) dayOrder = orderCount++;
      } else if (ch === 'M') {
        monthOrder = orderCount++;
        while (i + 1 < pattern.length && pattern[i + 1] === 'M') i++;
      }
    }
  }
  if (monthOrder === 0 && dayOrder === 1) return ORDER_MD;
  if (dayOrder === 0 && monthOrder === 1) return ORDER_DM;
  return -1;
}

function adjustYear(year: number): number {
  if (year < 100) {
    const y = TWO_DIGIT_YEAR_MAX % 100;
    return (Math.floor(TWO_DIGIT_YEAR_MAX / 100) - (year > y ? 1 : 0)) * 100 + year;
  }
  return year;
}

function isValidDay(year: number, month: number, day: number): boolean {
  return year >= 1 && year <= 9999 && month >= 1 && month <= 12 && day >= 1 && day <= daysInMonth(year, month);
}

function setDateYMD(result: Result, year: number, month: number, day: number): boolean {
  if (isValidDay(year, month, day)) {
    result.year = year;
    result.month = month;
    result.day = day;
    return true;
  }
  return false;
}

class ParseContext {
  constructor(
    readonly culture: CultureInfo,
    readonly now: RpDateTime,
  ) {}

  defaultYear(result: Result): void {
    result.year = this.now.year;
  }
}

function processTerminalState(dps: DS, result: Result, raw: RawInfo, ctx: ParseContext): boolean {
  const d = ctx.culture.date;
  const n = (i: number) => raw.num[i]!;
  let passed = true;
  switch (dps) {
    case DS.DX_NN: {
      if (result.haveDate) return false;
      ctx.defaultYear(result);
      const order = getMonthDayOrder(d.monthDayPattern);
      if (order < 0) return false;
      passed = order === ORDER_MD ? setDateYMD(result, result.year, n(0), n(1)) : setDateYMD(result, result.year, n(1), n(0));
      if (passed) result.haveDate = true;
      break;
    }
    case DS.DX_NNN: {
      if (result.haveDate) return false;
      const order = getYearMonthDayOrder(d.shortDatePattern);
      if (order < 0) return false;
      if (order === ORDER_YMD) passed = setDateYMD(result, adjustYear(n(0)), n(1), n(2));
      else if (order === ORDER_MDY) passed = setDateYMD(result, adjustYear(n(2)), n(0), n(1));
      else if (order === ORDER_DMY) passed = setDateYMD(result, adjustYear(n(2)), n(1), n(0));
      else if (order === ORDER_YDM) passed = setDateYMD(result, adjustYear(n(0)), n(2), n(1));
      else passed = false;
      if (passed) result.haveDate = true;
      break;
    }
    case DS.DX_MN:
    case DS.DX_NM: {
      if (result.haveDate) return false;
      const monthDayOrder = getMonthDayOrder(d.monthDayPattern);
      if (monthDayOrder < 0) return false;
      const yearOrder = dps === DS.DX_MN ? ORDER_MY : ORDER_YM;
      if (monthDayOrder === (dps === DS.DX_MN ? ORDER_DM : ORDER_MD)) {
        const yearMonthOrder = getYearMonthOrder(d.yearMonthPattern);
        if (yearMonthOrder < 0) return false;
        if (yearMonthOrder === yearOrder) {
          if (!setDateYMD(result, adjustYear(n(0)), raw.month, 1)) return false;
          break;
        }
      }
      ctx.defaultYear(result);
      if (!setDateYMD(result, result.year, raw.month, n(0))) return false;
      break;
    }
    case DS.DX_MNN: {
      if (result.haveDate) return false;
      const n1 = n(0);
      const n2 = n(1);
      const order = getYearMonthDayOrder(d.shortDatePattern);
      if (order < 0) return false;
      const tryDate = (year: number, day: number) => {
        const y = adjustYear(year);
        if (isValidDay(y, raw.month, day)) {
          result.year = y;
          result.month = raw.month;
          result.day = day;
          result.haveDate = true;
          return true;
        }
        return false;
      };
      if (order === ORDER_MDY) passed = tryDate(n2, n1) || tryDate(n1, n2);
      else if (order === ORDER_YMD) passed = tryDate(n1, n2) || tryDate(n2, n1);
      else if (order === ORDER_DMY) passed = tryDate(n2, n1) || tryDate(n1, n2);
      else passed = false;
      break;
    }
    case DS.DX_DS:
      break;
    case DS.DX_YNN: {
      if (result.haveDate) return false;
      const order = getYearMonthDayOrder(d.shortDatePattern);
      passed = order === ORDER_YDM ? setDateYMD(result, raw.year, n(1), n(0)) : setDateYMD(result, raw.year, n(0), n(1));
      if (passed) result.haveDate = true;
      break;
    }
    case DS.DX_NNY: {
      if (result.haveDate) return false;
      const order = getYearMonthDayOrder(d.shortDatePattern);
      if (order < 0) return false;
      passed =
        order === ORDER_MDY || order === ORDER_YMD
          ? setDateYMD(result, raw.year, n(0), n(1))
          : setDateYMD(result, raw.year, n(1), n(0));
      if (passed) result.haveDate = true;
      break;
    }
    case DS.DX_YMN:
      if (result.haveDate) return false;
      passed = setDateYMD(result, raw.year, raw.month, n(0));
      if (passed) result.haveDate = true;
      break;
    case DS.DX_YN:
      if (result.haveDate) return false;
      passed = setDateYMD(result, raw.year, n(0), 1);
      if (passed) result.haveDate = true;
      break;
    case DS.DX_YM:
      if (result.haveDate) return false;
      passed = setDateYMD(result, raw.year, raw.month, 1);
      if (passed) result.haveDate = true;
      break;
    case DS.TX_N:
      if (result.haveTime) return false;
      if (raw.timeMark === TM_NotSet) return false;
      result.hour = n(0);
      result.haveTime = true;
      break;
    case DS.TX_NN:
      if (result.haveTime) return false;
      result.hour = n(0);
      result.minute = n(1);
      result.haveTime = true;
      break;
    case DS.TX_NNN:
      if (result.haveTime) return false;
      result.hour = n(0);
      result.minute = n(1);
      result.second = n(2);
      result.haveTime = true;
      break;
    case DS.TX_TS:
      break;
    default:
      // DX_DSN, DX_NDS, DX_NNDS: CJK date suffixes, not reachable with the supported cultures
      return false;
  }
  if (!passed) return false;
  if (dps > DS.ERROR) raw.num.length = 0;
  return true;
}

function newRaw(): RawInfo {
  return { num: [], month: -1, year: -1, dayOfWeek: -1, timeMark: TM_NotSet, fraction: -1 };
}

function newResult(): Result {
  return {
    year: -1,
    month: -1,
    day: -1,
    hour: 0,
    minute: 0,
    second: 0,
    haveDate: false,
    haveTime: false,
    timeZoneUsed: false,
    timeZoneOffsetMinutes: 0,
    era: -1,
  };
}

function toDateTime(year: number, month: number, day: number, hour: number, minute: number, second: number): RpDateTime | undefined {
  if (!isValidDay(year, month, day)) return undefined;
  if (hour < 0 || hour >= 24 || minute < 0 || minute >= 60 || second < 0 || second >= 60) return undefined;
  return RpDateTime.create(year, month, day, hour, minute, second);
}

/** AdjustTimeZoneToLocal: the time given with an offset, as local time of the host time zone. */
function adjustToLocal(dt: RpDateTime, offsetMinutes: number, tz: LocalTimeZone, bTimeOnly: boolean, now: RpDateTime): RpDateTime | undefined {
  let ticks = dt.ticks - BigInt(offsetMinutes) * 600_000_000n;
  if (dt.ticks < BigInt(TICKS_PER_DAY)) {
    ticks += BigInt(tz.utcOffsetMinutes(bTimeOnly ? now : dt)) * 600_000_000n;
    if (ticks < 0n) ticks += BigInt(TICKS_PER_DAY);
  } else {
    if (ticks < 0n) return undefined;
    const utc = RpDateTime.fromTicks(ticks, DateTimeKind.Utc);
    ticks += BigInt(utcOffsetFromUtc(utc, tz)) * 600_000_000n;
  }
  try {
    return RpDateTime.fromTicks(ticks, DateTimeKind.Local);
  } catch {
    return undefined;
  }
}

/** The offset of the time zone at a UTC instant, from the offsets of local times. */
function utcOffsetFromUtc(utc: RpDateTime, tz: LocalTimeZone): number {
  if (tz.utcOffsetMinutesFromUtc !== undefined) return tz.utcOffsetMinutesFromUtc(utc);
  const guess = tz.utcOffsetMinutes(utc);
  const local = utc.addTicks(BigInt(guess) * 600_000_000n);
  return tz.utcOffsetMinutes(local);
}

/** The ISO 8601 path: "yyyy-MM-dd" then 'T' and "HH:mm[:ss[.f]]" and an optional zone. */
function parseISO8601(raw: RawInfo, str: DTString, result: Result, ctx: ParseContext, tz: LocalTimeZone): RpDateTime | undefined {
  const skip = () => {
    while (str.index < str.length && isWhiteSpace(str.cur())) str.index++;
  };
  const digits2 = (): number | undefined => {
    if (str.index + 2 > str.length) return undefined;
    const a = str.value[str.index]!;
    const b = str.value[str.index + 1]!;
    if (!isDigitChar(a) || !isDigitChar(b)) return undefined;
    str.index += 2;
    return (a.charCodeAt(0) - 48) * 10 + (b.charCodeAt(0) - 48);
  };
  skip();
  const hour = digits2();
  if (hour === undefined) return undefined;
  skip();
  if (str.cur() !== ':') return undefined;
  str.index++;
  skip();
  const minute = digits2();
  if (minute === undefined) return undefined;
  skip();
  let second = 0;
  let partSecond = 0;
  if (str.cur() === ':') {
    str.index++;
    skip();
    const s = digits2();
    if (s === undefined) return undefined;
    second = s;
    if (str.cur() === '.') {
      const f = parseFraction(str);
      if (!f.ok) return undefined;
      partSecond = f.fraction;
    }
    skip();
  }
  if (str.index < str.length) {
    const ch = str.cur();
    if (ch === '+' || ch === '-') {
      result.timeZoneUsed = true;
      const off = parseTimeZone(str);
      if (off === null) return undefined;
      result.timeZoneOffsetMinutes = off;
    } else if (ch === 'Z' || ch === 'z') {
      result.timeZoneUsed = true;
      result.timeZoneOffsetMinutes = 0;
      str.index++;
    }
    skip();
    if (str.index < str.length) return undefined;
  }
  const n0 = raw.num[0];
  const n1 = raw.num[1];
  if (n0 === undefined || n1 === undefined) return undefined;
  let time = toDateTime(raw.year, n0, n1, hour, minute, second);
  if (time === undefined) return undefined;
  time = time.addTicks(BigInt(roundHalfEvenDouble(partSecond * TICKS_PER_SECOND)));
  if (result.timeZoneUsed) return adjustToLocal(time, result.timeZoneOffsetMinutes, tz, false, ctx.now);
  return time;
}

function lex(dps: DS, str: DTString, raw: RawInfo, result: Result, table: TokenTable, ctx: ParseContext): { ok: boolean; dtt: DTT } {
  const t = getRegularToken(table, str);
  let dtt = DTT.Unk;
  const states = DATE_PARSING_STATES[dps]!;
  switch (t.type) {
    case NumberToken:
    case YearNumberToken: {
      if (raw.num.length === 3 || t.value === -1) return { ok: false, dtt };
      if (dps === DS.T_NNt && str.index < str.length - 1 && str.current === '.') {
        raw.fraction = parseFraction(str).fraction;
      }
      if (dps === DS.T_NNt || dps === DS.T_Nt) {
        if (str.index < str.length - 1 && !handleTimeZone(str, result)) return { ok: false, dtt };
      }
      if (t.type === YearNumberToken) {
        if (raw.year !== -1) return { ok: false, dtt };
        raw.year = t.value;
        const { sep, indexBefore } = getSeparatorToken(table, str);
        switch (sep) {
          case SEP_End:
            dtt = DTT.YearEnd;
            break;
          case SEP_Am:
          case SEP_Pm:
            if (raw.timeMark !== TM_NotSet) return { ok: false, dtt };
            raw.timeMark = sep === SEP_Am ? TM_AM : TM_PM;
            dtt = DTT.YearSpace;
            break;
          case SEP_Space:
            dtt = DTT.YearSpace;
            break;
          case SEP_Date:
            dtt = DTT.YearDateSep;
            break;
          case SEP_DateOrOffset:
            if (states[DTT.YearDateSep] === DS.ERROR && states[DTT.YearSpace]! > DS.ERROR) {
              str.index = indexBefore;
              dtt = DTT.YearSpace;
            } else dtt = DTT.YearDateSep;
            break;
          default:
            return { ok: false, dtt };
        }
        return { ok: true, dtt };
      }
      const { sep, indexBefore } = getSeparatorToken(table, str);
      switch (sep) {
        case SEP_End:
          dtt = DTT.NumEnd;
          raw.num.push(t.value);
          break;
        case SEP_Am:
        case SEP_Pm:
          if (raw.timeMark !== TM_NotSet) return { ok: false, dtt };
          raw.timeMark = sep === SEP_Am ? TM_AM : TM_PM;
          dtt = DTT.NumAmpm;
          // "1/10 5 AM": the two pending numbers are the date, the one before AM / PM the hour
          if (dps === DS.D_NN && !processTerminalState(DS.DX_NN, result, raw, ctx)) return { ok: false, dtt };
          raw.num.push(t.value);
          if ((dps === DS.T_NNt || dps === DS.T_Nt) && !handleTimeZone(str, result)) return { ok: false, dtt };
          break;
        case SEP_Space:
          dtt = DTT.NumSpace;
          raw.num.push(t.value);
          break;
        case SEP_Date:
          dtt = DTT.NumDatesep;
          raw.num.push(t.value);
          break;
        case SEP_DateOrOffset:
          if (states[DTT.NumDatesep] === DS.ERROR && states[DTT.NumSpace]! > DS.ERROR) {
            str.index = indexBefore;
            dtt = DTT.NumSpace;
          } else dtt = DTT.NumDatesep;
          raw.num.push(t.value);
          break;
        case SEP_Time:
          dtt = DTT.NumTimesep;
          raw.num.push(t.value);
          break;
        case SEP_LocalTimeMark:
          dtt = DTT.NumLocalTimeMark;
          raw.num.push(t.value);
          break;
        default:
          return { ok: false, dtt };
      }
      return { ok: true, dtt };
    }
    case Am:
    case Pm:
      if (raw.timeMark !== TM_NotSet) return { ok: false, dtt };
      raw.timeMark = t.value;
      break;
    case DayOfWeekToken:
      if (raw.dayOfWeek !== -1) return { ok: false, dtt };
      raw.dayOfWeek = t.value;
      dtt = DTT.DayOfWeek;
      break;
    case MonthToken: {
      if (raw.month !== -1) return { ok: false, dtt };
      const { sep, indexBefore } = getSeparatorToken(table, str);
      switch (sep) {
        case SEP_End:
          dtt = DTT.MonthEnd;
          break;
        case SEP_Space:
          dtt = DTT.MonthSpace;
          break;
        case SEP_Date:
          dtt = DTT.MonthDatesep;
          break;
        case SEP_DateOrOffset:
          if (states[DTT.MonthDatesep] === DS.ERROR && states[DTT.MonthSpace]! > DS.ERROR) {
            str.index = indexBefore;
            dtt = DTT.MonthSpace;
          } else dtt = DTT.MonthDatesep;
          break;
        default:
          return { ok: false, dtt };
      }
      raw.month = t.value;
      break;
    }
    case EraToken:
      if (result.era !== -1) return { ok: false, dtt };
      result.era = t.value;
      dtt = DTT.Era;
      break;
    case TimeZoneToken:
      if (result.timeZoneUsed) return { ok: false, dtt };
      dtt = DTT.TimeZone;
      result.timeZoneUsed = true;
      result.timeZoneOffsetMinutes = 0;
      break;
    case EndOfString:
      dtt = DTT.End;
      break;
    case DateWordToken:
    case IgnorableSymbol:
      break;
    default: {
      // UnknownToken
      const c = str.current;
      if (isLetter(c)) return { ok: false, dtt };
      if ((c === '-' || c === '+') && !result.timeZoneUsed) {
        const original = str.index;
        const off = parseTimeZone(str);
        if (off !== null) {
          result.timeZoneUsed = true;
          result.timeZoneOffsetMinutes = off;
          return { ok: true, dtt };
        }
        str.index = original;
      }
      // VerifyValidPunctuation: '#' pairs (VB) and NUL characters at the end
      if (c === '#') {
        let hashes = 0;
        for (let i = 0; i < str.length; i++) if (str.value[i] === '#') hashes++;
        const first = str.value.trimStart()[0] === '#';
        if (hashes === 2 && (first || str.value.trimEnd().endsWith('#'))) {
          str.index++;
          return { ok: true, dtt };
        }
        return { ok: false, dtt };
      }
      if (c === '\0') {
        for (let i = str.index; i < str.length; i++) if (str.value[i] !== '\0') return { ok: false, dtt };
        str.index = str.length;
        return { ok: true, dtt };
      }
      return { ok: false, dtt };
    }
  }
  return { ok: true, dtt };
}

/**
 * DateTime.TryParse(s, culture, DateTimeStyles.None): the parsed date or undefined. `now` gives
 * the date of a string with a time only (and the year of one without year); a time zone in the
 * string converts the result to local time (kind Local).
 */
export function tryParseDateTime(
  s: string,
  culture: CultureInfo,
  now: RpDateTime = RpDateTime.minValue,
  tz: LocalTimeZone = { utcOffsetMinutes: () => 0 },
): RpDateTime | undefined {
  if (s.length === 0) return undefined;
  const table = tokenTable(culture);
  const ctx = new ParseContext(culture, now);
  const str = new DTString(s);
  const raw = newRaw();
  const result = newResult();
  let dps = DS.BEGIN;
  let reachTerminalState = false;
  let dtt: DTT;
  do {
    const r = lex(dps, str, raw, result, table, ctx);
    if (!r.ok) return undefined;
    dtt = r.dtt;
    if (dtt !== DTT.Unk) {
      if (dtt === DTT.NumLocalTimeMark) {
        if (dps === DS.D_YNd || dps === DS.D_YN) return parseISO8601(raw, str, result, ctx, tz);
        return undefined;
      }
      dps = DATE_PARSING_STATES[dps]![dtt]!;
      if (dps === DS.ERROR) return undefined;
      if (dps > DS.ERROR) {
        if (!processTerminalState(dps, result, raw, ctx)) return undefined;
        reachTerminalState = true;
        dps = DS.BEGIN;
      }
    }
  } while (dtt !== DTT.End && dtt !== DTT.NumEnd && dtt !== DTT.MonthEnd);

  if (!reachTerminalState) return undefined;
  // AdjustTimeMark (cultures with an empty AM or PM designator) and AdjustHour
  let timeMark = raw.timeMark;
  const d = culture.date;
  if (timeMark === TM_NotSet) {
    if (d.aMDesignator.length === 0 && d.pMDesignator.length !== 0) timeMark = TM_AM;
    if (d.pMDesignator.length === 0 && d.aMDesignator.length !== 0) timeMark = TM_PM;
  }
  if (timeMark !== TM_NotSet) {
    if (timeMark === TM_AM) {
      if (result.hour < 0 || result.hour > 12) return undefined;
      if (result.hour === 12) result.hour = 0;
    } else {
      if (result.hour < 0 || result.hour > 23) return undefined;
      if (result.hour < 12) result.hour += 12;
    }
  }
  const bTimeOnly = result.year === -1 && result.month === -1 && result.day === -1;
  // CheckDefaultDateTime
  if (result.year === -1 || result.month === -1 || result.day === -1) {
    if (result.month === -1 && result.day === -1) {
      if (result.year === -1) {
        result.year = now.year;
        result.month = now.month;
        result.day = now.day;
      } else {
        result.month = 1;
        result.day = 1;
      }
    } else {
      if (result.year === -1) result.year = now.year;
      if (result.month === -1) result.month = 1;
      if (result.day === -1) result.day = 1;
    }
  }
  let time = toDateTime(result.year, result.month, result.day, result.hour, result.minute, result.second);
  if (time === undefined) return undefined;
  if (raw.fraction > 0) {
    try {
      time = time.addTicks(BigInt(roundHalfEvenDouble(raw.fraction * TICKS_PER_SECOND)));
    } catch {
      return undefined;
    }
  }
  if (raw.dayOfWeek !== -1 && raw.dayOfWeek !== time.dayOfWeek) return undefined;
  if (result.timeZoneUsed) {
    if (Math.abs(result.timeZoneOffsetMinutes) > 14 * 60) return undefined;
    return adjustToLocal(time, result.timeZoneOffsetMinutes, tz, bTimeOnly, now);
  }
  return time;
}

/** DateTime.Parse(s, culture) / Convert.ToDateTime(string): FormatException when it fails. */
export function parseDateTime(s: string, culture: CultureInfo, now?: RpDateTime, tz?: LocalTimeZone): RpDateTime {
  const r = tryParseDateTime(s, culture, now, tz);
  if (r === undefined) throw formatException(`String '${s}' was not recognized as a valid DateTime.`);
  return r;
}
