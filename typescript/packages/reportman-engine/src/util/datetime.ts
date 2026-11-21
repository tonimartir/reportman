// System.DateTime as a wall-clock value without time zone: a day number since 0001-01-01 and the
// 100 ns ticks of the day (both exact JavaScript numbers), plus the DateTimeKind that .NET keeps
// with the value (it only matters to the "K", "o" and "U" formats). JavaScript Date is never used
// for values.
//
// OLE Automation dates (Delphi TDateTime): days since 1899-12-30 as a double, the fraction being
// the time of day; ToOADate and FromOADate follow .NET (millisecond precision, the negative
// fraction convention of OLE).

import { argumentException, argumentOutOfRangeException, NetMessages, overflowException } from './netexception.js';

export enum DateTimeKind {
  Unspecified = 0,
  Utc = 1,
  Local = 2,
}

export const TICKS_PER_MILLISECOND = 10_000;
export const TICKS_PER_SECOND = 10_000_000;
export const TICKS_PER_MINUTE = 600_000_000;
export const TICKS_PER_HOUR = 36_000_000_000;
export const TICKS_PER_DAY = 864_000_000_000;
const TICKS_PER_DAY_N = 864_000_000_000n;

const DAYS_PER_YEAR = 365;
const DAYS_PER_4_YEARS = DAYS_PER_YEAR * 4 + 1;
const DAYS_PER_100_YEARS = DAYS_PER_4_YEARS * 25 - 1;
const DAYS_PER_400_YEARS = DAYS_PER_100_YEARS * 4 + 1;
const DAYS_TO_1899 = DAYS_PER_400_YEARS * 4 + DAYS_PER_100_YEARS * 3 - 367;
const DAYS_TO_10000 = DAYS_PER_400_YEARS * 25 - 366;
const MAX_TICKS = BigInt(DAYS_TO_10000) * TICKS_PER_DAY_N - 1n;
const DOUBLE_DATE_OFFSET = BigInt(DAYS_TO_1899) * TICKS_PER_DAY_N;
const OA_DATE_MIN_AS_TICKS = BigInt(DAYS_PER_100_YEARS - DAYS_PER_YEAR) * TICKS_PER_DAY_N;
const OA_DATE_MIN_AS_DOUBLE = -657435.0;
const OA_DATE_MAX_AS_DOUBLE = 2958466.0;
const MILLIS_PER_DAY = 86_400_000n;
const MAX_MILLIS = BigInt(DAYS_TO_10000) * MILLIS_PER_DAY;

const DAYS_TO_MONTH_365 = [0, 31, 59, 90, 120, 151, 181, 212, 243, 273, 304, 334, 365];
const DAYS_TO_MONTH_366 = [0, 31, 60, 91, 121, 152, 182, 213, 244, 274, 305, 335, 366];

export function isLeapYear(year: number): boolean {
  return year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
}

export function daysInMonth(year: number, month: number): number {
  const days = isLeapYear(year) ? DAYS_TO_MONTH_366 : DAYS_TO_MONTH_365;
  return days[month]! - days[month - 1]!;
}

/** (long)double in .NET 9+: truncation, saturating, NaN is 0. */
export function doubleToInt64(d: number): bigint {
  if (Number.isNaN(d)) return 0n;
  if (d >= 9223372036854775807) return 9223372036854775807n;
  if (d <= -9223372036854775808) return -9223372036854775808n;
  return BigInt(Math.trunc(d));
}

function dateToDays(year: number, month: number, day: number): number {
  const days = isLeapYear(year) ? DAYS_TO_MONTH_366 : DAYS_TO_MONTH_365;
  const y = year - 1;
  return y * 365 + Math.floor(y / 4) - Math.floor(y / 100) + Math.floor(y / 400) + days[month - 1]! + day - 1;
}

export class RpDateTime {
  /** Days since 0001-01-01. */
  readonly days: number;
  /** Ticks (100 ns) since midnight. */
  readonly tickOfDay: number;
  readonly kind: DateTimeKind;
  private ymd: [number, number, number] | undefined;

  private constructor(days: number, tickOfDay: number, kind: DateTimeKind) {
    this.days = days;
    this.tickOfDay = tickOfDay;
    this.kind = kind;
  }

  /** DateTime.MinValue. */
  static readonly minValue = new RpDateTime(0, 0, DateTimeKind.Unspecified);

  /** new DateTime(ticks, kind). */
  static fromTicks(ticks: bigint, kind: DateTimeKind = DateTimeKind.Unspecified): RpDateTime {
    if (ticks < 0n || ticks > MAX_TICKS) {
      throw argumentOutOfRangeException(
        "Ticks must be between DateTime.MinValue.Ticks and DateTime.MaxValue.Ticks. (Parameter 'ticks')",
      );
    }
    const days = Number(ticks / TICKS_PER_DAY_N);
    const tod = Number(ticks % TICKS_PER_DAY_N);
    return new RpDateTime(days, tod, kind);
  }

  /** new DateTime(year, month, day, hour, minute, second, millisecond, kind). */
  static create(
    year: number,
    month: number,
    day: number,
    hour = 0,
    minute = 0,
    second = 0,
    millisecond = 0,
    kind: DateTimeKind = DateTimeKind.Unspecified,
  ): RpDateTime {
    if (year < 1 || year > 9999 || month < 1 || month > 12 || day < 1 || day > daysInMonth(year, month)) {
      throw argumentOutOfRangeException('Year, Month, and Day parameters describe an un-representable DateTime.');
    }
    if (hour < 0 || hour >= 24 || minute < 0 || minute >= 60 || second < 0 || second >= 60) {
      throw argumentOutOfRangeException('Hour, Minute, and Second parameters describe an un-representable DateTime.');
    }
    if (millisecond < 0 || millisecond >= 1000) {
      throw argumentOutOfRangeException(
        `millisecond ('${millisecond}') must be less than or equal to '999'. (Parameter 'millisecond')`,
      );
    }
    const tod = hour * TICKS_PER_HOUR + minute * TICKS_PER_MINUTE + second * TICKS_PER_SECOND + millisecond * TICKS_PER_MILLISECOND;
    return new RpDateTime(dateToDays(year, month, day), tod, kind);
  }

  /** The wall clock of a JavaScript Date in the host time zone (its local fields). */
  static fromJsDate(d: Date, kind: DateTimeKind = DateTimeKind.Unspecified): RpDateTime {
    return RpDateTime.create(
      d.getFullYear(),
      d.getMonth() + 1,
      d.getDate(),
      d.getHours(),
      d.getMinutes(),
      d.getSeconds(),
      d.getMilliseconds(),
      kind,
    );
  }

  get ticks(): bigint {
    return BigInt(this.days) * TICKS_PER_DAY_N + BigInt(this.tickOfDay);
  }

  private civil(): [number, number, number] {
    if (this.ymd !== undefined) return this.ymd;
    let n = this.days;
    const y400 = Math.floor(n / DAYS_PER_400_YEARS);
    n -= y400 * DAYS_PER_400_YEARS;
    let y100 = Math.floor(n / DAYS_PER_100_YEARS);
    if (y100 === 4) y100 = 3;
    n -= y100 * DAYS_PER_100_YEARS;
    const y4 = Math.floor(n / DAYS_PER_4_YEARS);
    n -= y4 * DAYS_PER_4_YEARS;
    let y1 = Math.floor(n / DAYS_PER_YEAR);
    if (y1 === 4) y1 = 3;
    const year = y400 * 400 + y100 * 100 + y4 * 4 + y1 + 1;
    n -= y1 * DAYS_PER_YEAR;
    const leap = y1 === 3 && (y4 !== 24 || y100 === 3);
    const days = leap ? DAYS_TO_MONTH_366 : DAYS_TO_MONTH_365;
    let m = (n >> 5) + 1;
    while (n >= days[m]!) m++;
    this.ymd = [year, m, n - days[m - 1]! + 1];
    return this.ymd;
  }

  get year(): number {
    return this.civil()[0];
  }
  get month(): number {
    return this.civil()[1];
  }
  get day(): number {
    return this.civil()[2];
  }
  get hour(): number {
    return Math.floor(this.tickOfDay / TICKS_PER_HOUR);
  }
  get minute(): number {
    return Math.floor(this.tickOfDay / TICKS_PER_MINUTE) % 60;
  }
  get second(): number {
    return Math.floor(this.tickOfDay / TICKS_PER_SECOND) % 60;
  }
  get millisecond(): number {
    return Math.floor(this.tickOfDay / TICKS_PER_MILLISECOND) % 1000;
  }
  /** Ticks within the second (0 to 9 999 999). */
  get ticksOfSecond(): number {
    return this.tickOfDay % TICKS_PER_SECOND;
  }
  /** DayOfWeek: 0 = Sunday. */
  get dayOfWeek(): number {
    return (this.days + 1) % 7;
  }
  get dayOfYear(): number {
    return this.days - dateToDays(this.year, 1, 1) + 1;
  }
  /** DateTime.Date: midnight of the same day, same kind. */
  get date(): RpDateTime {
    return new RpDateTime(this.days, 0, this.kind);
  }

  withKind(kind: DateTimeKind): RpDateTime {
    return new RpDateTime(this.days, this.tickOfDay, kind);
  }

  /** DateTime.AddTicks. */
  addTicks(value: bigint): RpDateTime {
    const t = this.ticks + value;
    if (t < 0n || t > MAX_TICKS) throw argumentOutOfRangeException(NetMessages.dateArithmetic);
    return RpDateTime.fromTicks(t, this.kind);
  }

  /** DateTime.AddDays of .NET 7+ (AddUnits): whole days plus the fraction truncated to ticks. */
  addDays(value: number): RpDateTime {
    // MaxDays of DateTime: DaysTo10000 - 1
    if (Math.abs(value) > DAYS_TO_10000 - 1) throw argumentOutOfRangeException(NetMessages.addValueOutOfRange);
    const integral = Math.trunc(value);
    const fractional = value - integral;
    const ticks = doubleToInt64(integral) * TICKS_PER_DAY_N + doubleToInt64(fractional * TICKS_PER_DAY);
    return this.addTicks(ticks);
  }

  /** DateTime.AddMonths. */
  addMonths(months: number): RpDateTime {
    if (months < -120000 || months > 120000) {
      throw argumentOutOfRangeException("Months value must be between +/-120000. (Parameter 'months')");
    }
    let y = this.year;
    let m = this.month - 1 + months;
    y += Math.floor(m / 12);
    m = ((m % 12) + 12) % 12 + 1;
    if (y < 1 || y > 9999) throw argumentOutOfRangeException("The added or subtracted value results in an un-representable DateTime. (Parameter 'months')");
    const d = Math.min(this.day, daysInMonth(y, m));
    return new RpDateTime(dateToDays(y, m, d), this.tickOfDay, this.kind);
  }

  /** The exact difference in ticks (this - other). */
  ticksSince(other: RpDateTime): bigint {
    return BigInt(this.days - other.days) * TICKS_PER_DAY_N + BigInt(this.tickOfDay - other.tickOfDay);
  }

  /** (this - other).TotalDays: (double)ticks / TicksPerDay. */
  totalDaysSince(other: RpDateTime): number {
    return Number(this.ticksSince(other)) / TICKS_PER_DAY;
  }

  compareTo(other: RpDateTime): number {
    if (this.days !== other.days) return this.days < other.days ? -1 : 1;
    if (this.tickOfDay !== other.tickOfDay) return this.tickOfDay < other.tickOfDay ? -1 : 1;
    return 0;
  }

  equals(other: RpDateTime): boolean {
    return this.compareTo(other) === 0;
  }

  /** DateTime.ToOADate. */
  toOADate(): number {
    let value = this.ticks;
    if (value === 0n) return 0.0;
    if (value < TICKS_PER_DAY_N) value += DOUBLE_DATE_OFFSET;
    if (value < OA_DATE_MIN_AS_TICKS) throw overflowException(NetMessages.oleAutDateInvalid);
    let millis = (value - DOUBLE_DATE_OFFSET) / 10000n;
    if (millis < 0n) {
      const frac = millis % MILLIS_PER_DAY;
      if (frac !== 0n) millis -= (MILLIS_PER_DAY + frac) * 2n;
    }
    return Number(millis) / 86400000;
  }

  /** DateTime.FromOADate (kind Unspecified). */
  static fromOADate(value: number): RpDateTime {
    if (!(value < OA_DATE_MAX_AS_DOUBLE) || !(value > OA_DATE_MIN_AS_DOUBLE)) {
      throw argumentException(NetMessages.oleAutDateInvalid);
    }
    let millis = doubleToInt64(value * 86400000 + (value >= 0 ? 0.5 : -0.5));
    if (millis < 0n) millis -= (millis % MILLIS_PER_DAY) * 2n;
    millis += DOUBLE_DATE_OFFSET / 10000n;
    if (millis < 0n || millis > MAX_MILLIS) throw argumentException(NetMessages.oleAutDateScale);
    return RpDateTime.fromTicks(millis * 10000n, DateTimeKind.Unspecified);
  }

  /** "yyyy-MM-ddTHH:mm:ss.fffffff" (no zone), the JSON form of a DateTime variant. */
  toIsoString(): string {
    const p = (n: number, w: number) => n.toString().padStart(w, '0');
    return (
      `${p(this.year, 4)}-${p(this.month, 2)}-${p(this.day, 2)}T${p(this.hour, 2)}:${p(this.minute, 2)}:` +
      `${p(this.second, 2)}.${p(this.ticksOfSecond, 7)}`
    );
  }

  /** Reads "yyyy-MM-dd[THH:mm[:ss[.fffffff]]]" (an optional trailing Z or offset is ignored). */
  static parseIso(text: string, kind: DateTimeKind = DateTimeKind.Unspecified): RpDateTime {
    const m = /^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2})(?::(\d{2})(?:\.(\d{1,7}))?)?)?(?:Z|[+-]\d{2}:?\d{2})?$/.exec(text);
    if (m === null) throw argumentException(`Not an ISO 8601 date: '${text}'`);
    const base = RpDateTime.create(+m[1]!, +m[2]!, +m[3]!, +(m[4] ?? 0), +(m[5] ?? 0), +(m[6] ?? 0), 0, kind);
    const frac = (m[7] ?? '').padEnd(7, '0');
    return base.addTicks(BigInt(+frac));
  }

  toString(): string {
    return this.toIsoString();
  }
}
