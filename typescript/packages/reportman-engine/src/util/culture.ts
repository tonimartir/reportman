// The culture data the engine formats and parses with: the .NET NumberFormatInfo and
// DateTimeFormatInfo of a culture (ICU data of .NET 10), generated from golden-cs culture-json.
// There is no thread culture: every formatting and parsing call receives a CultureInfo.

import { CULTURE_DATA } from './cultures.generated.js';

/** System.Globalization.NumberFormatInfo. */
export interface NumberFormatData {
  readonly numberDecimalSeparator: string;
  readonly numberGroupSeparator: string;
  readonly numberGroupSizes: readonly number[];
  readonly numberDecimalDigits: number;
  readonly numberNegativePattern: number;
  readonly currencyDecimalSeparator: string;
  readonly currencyGroupSeparator: string;
  readonly currencyGroupSizes: readonly number[];
  readonly currencyDecimalDigits: number;
  readonly currencySymbol: string;
  readonly currencyPositivePattern: number;
  readonly currencyNegativePattern: number;
  readonly percentDecimalSeparator: string;
  readonly percentGroupSeparator: string;
  readonly percentGroupSizes: readonly number[];
  readonly percentDecimalDigits: number;
  readonly percentSymbol: string;
  readonly perMilleSymbol: string;
  readonly percentPositivePattern: number;
  readonly percentNegativePattern: number;
  readonly negativeSign: string;
  readonly positiveSign: string;
  readonly naNSymbol: string;
  readonly positiveInfinitySymbol: string;
  readonly negativeInfinitySymbol: string;
}

/** System.Globalization.DateTimeFormatInfo (Gregorian calendar). */
export interface DateTimeFormatData {
  readonly shortDatePattern: string;
  readonly longDatePattern: string;
  readonly shortTimePattern: string;
  readonly longTimePattern: string;
  readonly fullDateTimePattern: string;
  readonly monthDayPattern: string;
  readonly yearMonthPattern: string;
  readonly dateSeparator: string;
  readonly timeSeparator: string;
  readonly aMDesignator: string;
  readonly pMDesignator: string;
  readonly firstDayOfWeek: number;
  /** Sunday first, as DayOfWeek. */
  readonly dayNames: readonly string[];
  readonly abbreviatedDayNames: readonly string[];
  /** 13 entries, the last one empty, as .NET. */
  readonly monthNames: readonly string[];
  readonly abbreviatedMonthNames: readonly string[];
  readonly monthGenitiveNames: readonly string[];
  readonly abbreviatedMonthGenitiveNames: readonly string[];
  /** GetEraName(1) of the Gregorian calendar ("AD" in en-US). */
  readonly eraName: string;
}

/** The serialisable data of a culture. */
export interface CultureData {
  /** The culture name ("en-US"; "" for the invariant culture). */
  readonly name: string;
  readonly twoLetterISOLanguageName: string;
  readonly number: NumberFormatData;
  readonly date: DateTimeFormatData;
}

/** A culture ready to format with: its data plus the values .NET derives from it. */
export class CultureInfo implements CultureData {
  readonly name: string;
  readonly twoLetterISOLanguageName: string;
  readonly number: NumberFormatData;
  readonly date: DateTimeFormatData;
  /** DateTimeFormatFlags.UseGenitiveMonth: the genitive month names differ from the regular ones. */
  readonly useGenitiveMonth: boolean;

  constructor(data: CultureData) {
    this.name = data.name;
    this.twoLetterISOLanguageName = data.twoLetterISOLanguageName;
    this.number = data.number;
    this.date = data.date;
    const d = data.date;
    this.useGenitiveMonth =
      !sameStrings(d.monthGenitiveNames, d.monthNames) || !sameStrings(d.abbreviatedMonthGenitiveNames, d.abbreviatedMonthNames);
  }

  /** The cultures with generated data. "" is the invariant culture. */
  static get availableNames(): readonly string[] {
    return Object.keys(CULTURE_DATA);
  }

  private static readonly cache = new Map<string, CultureInfo>();

  /**
   * One of the cultures with generated data (en-US, es-ES, ca-ES, pt-BR, fr-FR, de-DE, it-IT and
   * the invariant culture ""). The name is matched without regard to case.
   */
  static get(name: string): CultureInfo {
    const key = Object.keys(CULTURE_DATA).find((k) => k.toLowerCase() === name.toLowerCase());
    if (key === undefined) throw new Error(`Culture not available: '${name}'`);
    let c = CultureInfo.cache.get(key);
    if (c === undefined) {
      c = new CultureInfo(CULTURE_DATA[key]!);
      CultureInfo.cache.set(key, c);
    }
    return c;
  }

  /** CultureInfo.InvariantCulture. */
  static get invariant(): CultureInfo {
    return CultureInfo.get('');
  }

  /** A culture built from custom data (for cultures without generated data). */
  static fromData(data: CultureData): CultureInfo {
    return new CultureInfo(data);
  }
}

function sameStrings(a: readonly string[], b: readonly string[]): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}
