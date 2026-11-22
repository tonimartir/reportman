// The date masks of a report are Delphi's (FormatDateTime: m is the month, n the minutes) and a
// value without a mask is written as Delphi's VarToStr writes it, as tests/HtmlYMascarasTest of the
// C# engine (its third part; the HTML parts are in html-text.test.ts). Expected values are the ones
// of the C# test, in the es-ES culture.

import { describe, expect, it } from 'vitest';
import { CsDecimal, CultureInfo, createContext, dateFormatMask, formatDateTime, ParamType, RpDateTime, Variant } from '@reportman/engine';

const ctx = createContext('es-ES');

describe('dateFormatMask', () => {
  it('translates the masks of Delphi to .NET', () => {
    expect(dateFormatMask('dd/mm/yyyy')).toBe('dd/MM/yyyy');
    // Minutes after the hour, 24 hour clock
    expect(dateFormatMask('hh:mm:ss')).toBe('HH:mm:ss');
    expect(dateFormatMask('dd/mm/yyyy hh:nn')).toBe('dd/MM/yyyy HH:mm');
    // am/pm: 12 hour clock and tt
    expect(dateFormatMask('hh:nn am/pm')).toBe('hh:mm tt');
    // A .NET mask stays as it is
    expect(dateFormatMask('dd/MM/yyyy HH:mm')).toBe('dd/MM/yyyy HH:mm');
    // Quoted literals are not touched
    expect(dateFormatMask("d 'de' mmmm 'de' yyyy")).toBe("d 'de' MMMM 'de' yyyy");
    // Milliseconds: z to f
    expect(dateFormatMask('ss.zzz')).toBe('ss.fff');
  });

  it('formats a date with a Delphi mask', () => {
    const date = RpDateTime.create(2026, 10, 3, 14, 5, 9);
    expect(formatDateTime(date, dateFormatMask('dd/mm/yyyy hh:nn:ss'), CultureInfo.get('es-ES'))).toBe('03/10/2026 14:05:09');
  });
});

describe('a value without a mask', () => {
  it('writes a date at midnight without the time', () => {
    // As ToShortDateString() and ToString() of the culture (es-ES of .NET 10: d/M/yyyy)
    const culture = CultureInfo.get('es-ES');
    const midnight = RpDateTime.create(2024, 4, 25);
    expect(Variant.fromDateTime(midnight).toFormatString(ctx, '', ParamType.Unknown, true)).toBe(formatDateTime(midnight, 'd', culture));
    expect(Variant.fromDateTime(midnight).toFormatString(ctx, '', ParamType.Unknown, true)).toBe('25/4/2024');
    const withTime = RpDateTime.create(2024, 4, 25, 13, 5, 0);
    expect(Variant.fromDateTime(withTime).toFormatString(ctx, '', ParamType.Unknown, true)).toBe(formatDateTime(withTime, 'G', culture));
    expect(Variant.fromDateTime(withTime).toFormatString(ctx, '', ParamType.Unknown, true)).toBe('25/4/2024 13:05:00');
  });

  it('writes a decimal without the zeros of its scale', () => {
    // 380.5 + 17288.5 is 17669.0, which was printed «17669,0»
    const sum = Variant.add(Variant.fromDecimal(CsDecimal.parseInvariant('380.5')), Variant.fromDecimal(CsDecimal.parseInvariant('17288.5')), ctx);
    expect(sum.toFormatString(ctx, '', ParamType.Unknown, true)).toBe('17669');
    expect(sum.toFormatString(ctx, '', ParamType.Unknown, false)).toBe('17669');
    const price = Variant.fromDecimal(CsDecimal.parseInvariant('1450.50'));
    expect(price.toFormatString(ctx, '', ParamType.Unknown, true)).toBe('1450,5');
  });
});
