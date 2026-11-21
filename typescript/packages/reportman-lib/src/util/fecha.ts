/**
 * The three date helpers the model borrowed from the ERP's `Fecha` utility: parameter values
 * travel as ISO strings and undo entries as Spanish "dd/mm/yyyy hh:mm:ss" text.
 */
export class Fecha {
  /** "yyyy-mm-dd…" → local Date at midnight. */
  public static fromISODateString(value: string): Date | undefined {
    if (!value) return undefined;
    if ((value as any) instanceof Date) return value as any;
    const year = parseInt(value.substring(0, 4), 10);
    const month = parseInt(value.substring(5, 7), 10);
    const day = parseInt(value.substring(8, 10), 10);
    if (isNaN(year) || isNaN(month) || isNaN(day)) return undefined;
    return new Date(year, month - 1, day);
  }

  /**
   * "yyyy-mm-ddThh:mm:ss[.fff…]" → local Date with time (and milliseconds). With a zone ("Z", as
   * this model writes a Date, or "±hh:mm") it is that instant, as the engine reads it.
   */
  public static fromISODateTimeString(value: string): Date | undefined {
    if (!value) return undefined;
    if ((value as any) instanceof Date) return value as any;
    if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}:\d{2})$/i.test(value)) {
      const instant = Date.parse(value);
      if (!isNaN(instant)) return new Date(instant);
    }
    const year = parseInt(value.substring(0, 4), 10);
    const month = parseInt(value.substring(5, 7), 10);
    const day = parseInt(value.substring(8, 10), 10);
    const hour = parseInt(value.substring(11, 13), 10) || 0;
    const minute = parseInt(value.substring(14, 16), 10) || 0;
    const second = parseInt(value.substring(17, 19), 10) || 0;
    const fraction = /^\.(\d+)/.exec(value.substring(19));
    // The first three digits of the fraction (a Date keeps milliseconds).
    const millisecond = fraction ? Number((fraction[1] + "00").substring(0, 3)) : 0;
    if (isNaN(year) || isNaN(month) || isNaN(day)) return undefined;
    // setFullYear: years below 100 are not taken as 19xx.
    const result = new Date(2000, 0, 1);
    result.setFullYear(year, month - 1, day);
    result.setHours(hour, minute, second, millisecond);
    return result;
  }

  /** "dd/mm/yyyy hh:mm[:ss]" → local Date. */
  public static fromDateTimeESString(value: string): Date | undefined {
    if (!value) return undefined;
    if ((value as any) instanceof Date) return value as any;
    const day = parseInt(value.substring(0, 2), 10);
    const month = parseInt(value.substring(3, 5), 10);
    const year = parseInt(value.substring(6, 10), 10);
    const hour = parseInt(value.substring(11, 13), 10) || 0;
    const minute = parseInt(value.substring(14, 16), 10) || 0;
    const second = parseInt(value.substring(17, 19), 10) || 0;
    if (isNaN(year) || isNaN(month) || isNaN(day)) return undefined;
    return new Date(year, month - 1, day, hour, minute, second);
  }
}
