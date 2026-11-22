// The + of an expression with a number and a text (Variant.ExpressionSum), as tests/EvalSumTest of
// the C# engine: a text that is a number is added (10+'7' is 17), any other text is joined with the
// number written as STR() writes it (10+'a' is '10a'); Booleans and dates with a text, the other
// operators and the + of two variants that the aggregates use still raise the error. The culture is
// es-ES, the one of the Delphi measures (decimal comma, thousands dot). Expected values are the
// ones of the C# test.

import { describe, expect, it } from 'vitest';
import { CsDecimal, createContext, Evaluator, RpDateTime, Variant, VariantType } from '@reportman/engine';

const ctx = createContext('es-ES');

function expectText(v: Variant, expected: string): void {
  expect(VariantType[v.varType]).toBe('String');
  expect(v.toString(ctx)).toBe(expected);
}

function expectNumber(v: Variant, expected: number): void {
  expect(v.isNumber()).toBe(true);
  expect(Math.abs(v.toDouble(ctx) - expected)).toBeLessThan(1e-9);
}

const sum = (a: Variant, b: Variant) => Variant.expressionSum(a, b, ctx);
const dbl = Variant.fromDouble;
const str = Variant.fromString;

describe('Variant.expressionSum', () => {
  it('joins a number and a text that is not a number', () => {
    expectText(sum(dbl(10), str('a')), '10a');
    expectText(sum(str('a'), dbl(10)), 'a10');
    expectText(sum(Variant.fromInteger(10), str('a')), '10a');
    expectText(sum(Variant.fromLong(10n), str('a')), '10a');
    expectText(sum(Variant.fromDecimal(CsDecimal.parseInvariant('10')), str('a')), '10a');
    expectText(sum(Variant.fromByte(10), str('a')), '10a');
    expectText(sum(dbl(10), str('')), '10');
    expectText(sum(str(''), dbl(10)), '10');
  });

  it('writes the number as STR() writes it, in the culture', () => {
    expectText(sum(dbl(10.5), str('a')), '10,5a');
  });

  it('adds a text that is a number', () => {
    expectNumber(sum(dbl(10), str('7')), 17);
    expectNumber(sum(str('7'), dbl(10)), 17);
    expectNumber(sum(Variant.fromInteger(10), str('7')), 17);
    expectNumber(sum(str('7'), Variant.fromInteger(10)), 17);
  });

  it('keeps numbers, texts and nulls as before', () => {
    expectNumber(sum(dbl(10), Variant.fromInteger(5)), 15);
    expectText(sum(str('a'), str('b')), 'ab');
    expectText(sum(Variant.null, str('a')), 'a');
    expectNumber(sum(dbl(10), Variant.null), 10);
  });

  it('still raises for Booleans and dates with a text', () => {
    expect(() => sum(Variant.fromBoolean(true), str('a'))).toThrow();
    expect(() => sum(str('a'), Variant.fromBoolean(true))).toThrow();
    expect(() => sum(Variant.fromDateTime(RpDateTime.create(2026, 11, 18)), str('a'))).toThrow();
  });

  it('leaves the + of two variants of the aggregates unchanged', () => {
    expect(() => Variant.add(Variant.fromInteger(0), str('abc'), ctx)).toThrow();
  });

  // What 10 + text gave in the Delphi engine (Double + AnsiString, Spanish locale), measured on
  // 18-11-2026: the text is read as the same number.
  it('reads the text as Delphi reads it', () => {
    const cases: [string, number | string][] = [
      ['7', 17], [' 7', 17], ['7 ', 17], ['+7', 17], ['-7', 3],
      ['1,5', 11.5], ['1.5', 25], ['1.000', 1010], ['1.000,5', 1010.5],
      ['1e3', 1010], ['1E3', 1010], ['7 \t', 17], ['(7)', 3],
      ['7a', '107a'], ['0x10', '100x10'], ['$10', '10$10'], ['7€', '107€'],
      ['1 000', '101 000'],
    ];
    for (const [text, expected] of cases) {
      const v = sum(dbl(10), str(text));
      if (typeof expected === 'string') expectText(v, expected);
      else expectNumber(v, expected);
    }
  });
});

describe('the + of an expression', () => {
  const ev = new Evaluator({ context: ctx });
  const evaluate = (text: string) => ev.evaluateText(text);

  it('joins a number and a text', () => {
    expectText(evaluate("10+'a'"), '10a');
    expectText(evaluate("'Pos '+10"), 'Pos 10');
    expectText(evaluate("10+''"), '10');
    expectText(evaluate("10+'a'+' Stk'"), '10a Stk');
    expectText(evaluate("(10+'a')"), '10a');
    expectText(evaluate("TRIM(10+'a')"), '10a');
    expectText(evaluate("IIF(1>0,10+'a','')"), '10a');
    expectText(evaluate("'Pos '+10+'a'"), 'Pos 10a');
  });

  it('evaluates from the left', () => {
    expectText(evaluate("10+5+'a'"), '15a');
    expectText(evaluate("'a'+10+5"), 'a105');
  });

  it('writes the number as STR()', () => {
    const asStr = evaluate("STR(10.5)+'a'").toString(ctx);
    expectText(evaluate("10.5+'a'"), asStr);
  });

  it('adds a text that is a number', () => {
    expectNumber(evaluate("10+'7'"), 17);
    expectNumber(evaluate("'7'+10"), 17);
  });

  it('still raises for the other operators and for Booleans', () => {
    expect(() => evaluate("10-'a'")).toThrow();
    expect(() => evaluate("10*'a'")).toThrow();
    expect(() => evaluate("TRUE+'a'")).toThrow();
  });
});
