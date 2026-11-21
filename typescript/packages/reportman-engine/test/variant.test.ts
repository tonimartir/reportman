// Variant host values and JSON, System.Decimal semantics, DateTime OLE conversions, the
// translator tables and the culture data. Expected values follow .NET 10.

import { describe, expect, it } from 'vitest';
import {
  CsDecimal,
  CultureInfo,
  createContext,
  DateTimeKind,
  decimalToSqlLiteral,
  formatDecimal,
  formatDouble,
  parseTranslationBytes,
  RpDateTime,
  Translator,
  tryParseDateTime,
  Variant,
  VariantType,
  standardDeviation,
} from '@reportman/engine';

const ctx = createContext('en-US');
const d = (s: string) => CsDecimal.parseInvariant(s);

describe('Variant.fromHost (AssignFromObject)', () => {
  it('maps the JavaScript values', () => {
    const cases: [unknown, VariantType][] = [
      [null, VariantType.Null],
      [undefined, VariantType.Null],
      [true, VariantType.Boolean],
      ['x', VariantType.String],
      [5, VariantType.Integer],
      [-2147483648, VariantType.Integer],
      [2147483648, VariantType.Double],
      [1.5, VariantType.Double],
      [-0, VariantType.Double],
      [5n, VariantType.Long],
      [d('1.50'), VariantType.Decimal],
      [RpDateTime.create(2024, 1, 2), VariantType.DateTime],
      [new Date(2024, 0, 2, 3, 4, 5), VariantType.DateTime],
      [new Uint8Array([1, 2]), VariantType.Binary],
      [new ArrayBuffer(2), VariantType.Binary],
      [{ toString: () => 'obj' }, VariantType.String],
    ];
    for (const [value, type] of cases) expect(Variant.fromHost(value).varType).toBe(type);
    expect(Variant.fromHost(new Date(2024, 0, 2, 3, 4, 5)).toString(ctx)).toBe('1/2/2024 3:04:05 AM');
    expect(() => Variant.fromHost(1n << 70n)).toThrow('Int64');
  });

  it('follows a type hint for numbers', () => {
    expect(Variant.fromHost(2.9, 'Integer').toString(ctx)).toBe('2');
    expect(Variant.fromHost(300, 'Byte').toString(ctx)).toBe('44');
    expect(Variant.fromHost(0.1, 'Decimal').toString(ctx)).toBe('0.1');
    expect(Variant.fromHost(45000.5, 'DateTime').toString(ctx)).toBe('3/15/2023 12:00:00 PM');
    expect(Variant.fromHost(7, 'Long').varType).toBe(VariantType.Long);
  });
});

describe('Variant JSON', () => {
  it('round-trips every type', () => {
    const values = [
      Variant.null,
      Variant.fromBoolean(false),
      Variant.fromByte(7),
      Variant.fromChar('z'),
      Variant.fromInteger(-3),
      Variant.fromString('a"b'),
      Variant.fromDouble(1.5),
      Variant.fromDouble(NaN),
      Variant.fromDouble(-Infinity),
      Variant.fromDecimal(d('-0.0100')),
      Variant.fromDateTime(RpDateTime.create(2024, 2, 29, 23, 59, 59, 999).addTicks(9n)),
      Variant.fromBinary(new Uint8Array([0, 255, 3])),
      Variant.fromLong(9223372036854775807n),
      Variant.fromLong(42n),
    ];
    for (const v of values) {
      const json = JSON.parse(JSON.stringify(v.toJSON()));
      const back = Variant.fromJSON(json);
      expect(back.varType).toBe(v.varType);
      expect(JSON.stringify(back.toJSON())).toBe(JSON.stringify(v.toJSON()));
    }
    expect(Variant.fromDecimal(d('1.50')).toJSON()).toEqual({ type: 'Decimal', value: '1.50' });
    expect(Variant.fromLong(9223372036854775807n).toJSON()).toEqual({ type: 'Long', value: '9223372036854775807' });
    expect(Variant.fromDateTime(RpDateTime.create(2024, 1, 2, 3, 4, 5)).toJSON()).toEqual({ type: 'DateTime', value: '2024-01-02T03:04:05.0000000' });
    expect(Variant.fromJSON({ type: 'Decimal', value: 2.5 }).toString(ctx)).toBe('2.5');
    expect(() => Variant.fromJSON({ type: 'Nope', value: 1 })).toThrow('Unknown VariantType: Nope');
  });
});

describe('System.Decimal', () => {
  const cases: [string, string, string][] = [
    ['1', '/', '3'],
    ['2', '/', '3'],
    ['10', '/', '3'],
    ['80', '/', '3'],
    ['1.0', '/', '4'],
    ['1.000', '/', '8'],
    ['4', '/', '0.4'],
    ['1', '/', '0.3'],
    ['1.0', '-', '1'],
    ['1', '-', '1.0'],
    ['-1', '+', '1'],
    ['0.1', '*', '0.1'],
    ['79228162514264337593543950335', '-', '0.5'],
    ['7922816251426433759354395033.5', '*', '1.1'],
    ['0.0000000000000001', '*', '0.0000000000000001'],
    ['123456789012345.678', '*', '0.0000000001'],
  ];
  const expected = [
    '0.3333333333333333333333333333',
    '0.6666666666666666666666666667',
    '3.3333333333333333333333333333',
    '26.666666666666666666666666667',
    '0.25',
    '0.125',
    '10',
    '3.3333333333333333333333333333',
    '-0.0',
    '0.0',
    '-0',
    '0.01',
    '79228162514264337593543950334',
    '8715097876569077135289834537',
    '0.0000000000000000000000000000',
    '12345.6789012345678',
  ];

  it('follows the DecCalc rounding and scales', () => {
    const results = cases.map(([a, op, b]) => {
      const x = d(a);
      const y = d(b);
      const r = op === '+' ? x.add(y) : op === '-' ? x.sub(y) : op === '*' ? x.mul(y) : x.div(y);
      return (r.negative ? '-' : '') + r.abs().toInvariantString();
    });
    expect(results).toEqual(expected);
  });

  it('overflows and divides by zero as .NET', () => {
    expect(() => d('79228162514264337593543950335').add(d('1'))).toThrow('Value was either too large or too small for a Decimal.');
    expect(() => d('1').div(d('0.00'))).toThrow('Attempted to divide by zero.');
    expect(() => CsDecimal.fromDouble(1e30)).toThrow('Decimal');
  });

  it('converts from and to double', () => {
    expect(CsDecimal.fromDouble(0.1).toInvariantString()).toBe('0.1');
    expect(CsDecimal.fromDouble(1 / 3).toInvariantString()).toBe('0.333333333333333');
    expect(CsDecimal.fromDouble(123456789.123456789).toInvariantString()).toBe('123456789.123457');
    expect(CsDecimal.fromDouble(1e-30).toInvariantString()).toBe('0');
    expect(CsDecimal.fromDouble(2.5e20).toInvariantString()).toBe('250000000000000000000');
    expect(d('0.1').toDouble()).toBe(0.1);
    expect(formatDecimal(d('-0.0'), '', ctx.culture.number)).toBe('0.0');
    expect(formatDouble(d('-0.0').toDouble(), '0.00', ctx.culture.number)).toBe('-0.00');
    expect(decimalToSqlLiteral(d('-1234.50'))).toBe('-1234.50');
  });
});

describe('DateTime', () => {
  it('converts OLE dates as .NET', () => {
    expect(RpDateTime.fromOADate(0).toIsoString()).toBe('1899-12-30T00:00:00.0000000');
    expect(RpDateTime.fromOADate(-1.25).toIsoString()).toBe('1899-12-29T06:00:00.0000000');
    expect(RpDateTime.fromOADate(45000.123456789).toIsoString()).toBe('2023-03-15T02:57:46.6670000');
    expect(RpDateTime.create(2023, 3, 15, 12).toOADate()).toBe(45000.5);
    expect(RpDateTime.create(1899, 12, 29, 6).toOADate()).toBe(-1.25);
    expect(RpDateTime.minValue.toOADate()).toBe(0);
    expect(() => RpDateTime.fromOADate(3e6)).toThrow('Not a legal OleAut date.');
  });

  it('parses with a time zone into local time', () => {
    const tz = { utcOffsetMinutes: () => 60 };
    const en = CultureInfo.get('en-US');
    const r = tryParseDateTime('2024-01-15T10:30:00Z', en, RpDateTime.minValue, tz)!;
    expect([r.toIsoString(), r.kind]).toEqual(['2024-01-15T11:30:00.0000000', DateTimeKind.Local]);
    expect(tryParseDateTime('1/15/2024 10:30 -02:00', en, RpDateTime.minValue, tz)!.toIsoString()).toBe('2024-01-15T13:30:00.0000000');
    expect(tryParseDateTime('15/1/2024', en)).toBeUndefined();
    expect(tryParseDateTime('15/1/2024', CultureInfo.get('es-ES'))!.toIsoString()).toBe('2024-01-15T00:00:00.0000000');
  });
});

describe('Translator', () => {
  it('reads the reportmanres tables', () => {
    expect(Translator.english.translateStr(438)).toBe('Type conversion error');
    expect(Translator.spanish.translateStr(440)).toBe('Identificador desconocido:');
    expect(Translator.english.translateStr(448)).toBe('Expected {0}');
    expect(Translator.english.translateStr(99999)).toBe('XXXXXXX');
    expect(Translator.forCulture(CultureInfo.get('es-ES'))).toBe(Translator.spanish);
    expect(Translator.forCulture(CultureInfo.get('ca-ES'))).toBe(Translator.english);
  });

  it('parses UTF-16LE with one string per LF and a doubled LF as a literal LF', () => {
    const text = 'one\ntwo\n\nlines\nthree';
    const bytes = new Uint8Array(text.length * 2);
    for (let i = 0; i < text.length; i++) bytes[i * 2] = text.charCodeAt(i);
    expect(parseTranslationBytes(bytes)).toEqual(['one', 'two\nlines', 'three']);
    const t = Translator.fromBytes(bytes);
    expect(t.translateStr(1)).toBe('two\nlines');
    expect(t.translateStr(438)).toBe('Type conversion error');
  });
});

describe('cultures', () => {
  it('has the generated cultures and the invariant one', () => {
    expect(CultureInfo.availableNames).toEqual(['en-US', 'es-ES', 'ca-ES', 'pt-BR', 'fr-FR', 'de-DE', 'it-IT', '']);
    expect(CultureInfo.get('fr-fr').number.numberGroupSeparator).toBe(' ');
    expect(CultureInfo.get('ca-ES').useGenitiveMonth).toBe(true);
    expect(CultureInfo.invariant.date.eraName).toBe('A.D.');
    expect(() => CultureInfo.get('xx-XX')).toThrow('Culture not available');
  });

  it('formats with the genitive month names of Catalan', () => {
    const ca = createContext('ca-ES');
    const v = Variant.fromDateTime(RpDateTime.create(2024, 4, 5));
    expect(v.toFormatString(ca, 'd mmmm yyyy')).toBe('5 d’abril 2024');
    expect(v.toFormatString(ca, 'mmmm yyyy')).toBe('abril 2024');
  });
});

describe('DoubleUtil', () => {
  it('computes the population standard deviation', () => {
    expect(standardDeviation([2, 4, 4, 4, 5, 5, 7, 9])).toBe(2);
    expect(() => standardDeviation([])).toThrow('Sequence contains no elements');
  });
});

describe('Byte and Char values (host values only)', () => {
  it('widen to Integer in arithmetic and compare as their codes', () => {
    const b = Variant.fromByte(200);
    const c = Variant.fromChar('A');
    expect(Variant.add(b, b, ctx).toJSON()).toEqual({ type: 'Integer', value: 400 });
    expect(Variant.mul(c, Variant.fromInteger(2), ctx).toJSON()).toEqual({ type: 'Integer', value: 130 });
    expect(Variant.mul(b, Variant.null, ctx).varType).toBe(VariantType.Null);
    expect(Variant.negate(c, ctx).toJSON()).toEqual({ type: 'Integer', value: -65 });
    expect(Variant.compare(c, Variant.fromChar('B'), ctx)).toBe(-1);
    expect(Variant.equals(b, Variant.fromInteger(200), ctx)).toBe(true);
    expect(Variant.compare(c, Variant.fromString('A'), ctx)).toBe(0);
    expect(b.abs(ctx).varType).toBe(VariantType.Double);
    expect(c.toString(ctx)).toBe('A');
    expect(b.toFormatString(ctx, '0.00')).toBe('200.00');
    // C# parity: the char conversion of an Integer is '\0' (no case in operator char)
    expect(Variant.fromInteger(65).toCharCode(ctx)).toBe(0);
    expect(() => Variant.add(Variant.null, c, ctx)).toThrow('Type conversion error Variant+ VariantType.Null-VariantType.Integer');
  });
});
