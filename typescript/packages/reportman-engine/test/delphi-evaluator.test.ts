// The evaluator against the Delphi engine. The expected values are those of TRpEvaluator
// (tools/golden-delphi-eval, 23-11-2026) in es-ES unless a test says otherwise. Where the C# engine
// was wrong (an error, garbage) every report gives the Delphi value; where it worked with another
// behaviour, only a report converted from Delphi does (a context with delphiMasks, as
// BaseReport.ConvertedFromDelphi sets Evaluator.DelphiMasks in C#), and both modes are tested.
// The C# engine gives the same in both modes: eval-parity.test.ts.

import { describe, expect, it } from 'vitest';
import { createContext, DateTimeKind, Evaluator, RpDateTime, VariantType } from '@reportman/engine';

const now = () => RpDateTime.create(2024, 2, 29, 13, 45, 30, 0, DateTimeKind.Local);
const host = { now, fileExists: () => false };

/** An evaluator of a report of the C# engine, or of one converted from Delphi. */
function make(culture = 'es-ES', converted = false): Evaluator {
  const ctx = createContext(culture, { now });
  return new Evaluator({ context: converted ? { ...ctx, delphiMasks: true } : ctx, host });
}

/** The text of the value of an expression (Variant.ToString() of the culture). */
function text(ev: Evaluator, expr: string): string {
  ev.expression = expr;
  return ev.evaluate().toString(ev.context);
}

/** The value of an expression that gives a number (a Decimal keeps the zeros of its scale as text). */
function num(ev: Evaluator, expr: string): number {
  ev.expression = expr;
  return ev.evaluate().toDouble(ev.context);
}

/** The type and the text of the value. */
function typed(ev: Evaluator, expr: string): [string, string] {
  ev.expression = expr;
  const v = ev.evaluate();
  return [VariantType[v.varType]!, v.toString(ev.context)];
}

function fails(ev: Evaluator, expr: string): boolean {
  try {
    ev.expression = expr;
    ev.evaluate();
    return false;
  } catch {
    return true;
  }
}

const net = make();
const delphi = make('es-ES', true);
const both = [net, delphi];

describe('a text that is a number in - * / (every report)', () => {
  it('is the number, as Delphi converts it', () => {
    for (const ev of both) {
      expect(num(ev, "'6'-2")).toBe(4);
      expect(num(ev, "6-'2'")).toBe(4);
      expect(num(ev, "'6'-'2'")).toBe(4);
      expect(num(ev, "'2'*3")).toBe(6);
      expect(num(ev, "3*'2'")).toBe(6);
      expect(num(ev, "'2'*'3'")).toBe(6);
      expect(num(ev, "6/'2'")).toBe(3);
      expect(num(ev, "'6'/2")).toBe(3);
      expect(num(ev, "'6'/'2'")).toBe(3);
      expect(num(ev, 'STR(2)*2')).toBe(4);
      expect(num(ev, "'10'/'4'")).toBe(2.5);
      expect(num(ev, "'3'*'3'*'3'")).toBe(27);
      expect(num(ev, "-'6'")).toBe(-6);
      // The text is read with the culture, as the + reads it: a decimal comma, spaces, parentheses,
      // an exponent, and the thousands separator
      expect(num(ev, "'1,5'*2")).toBe(3);
      expect(num(ev, "'1.5'*2")).toBe(30);
      expect(num(ev, "' 3 '*2")).toBe(6);
      expect(num(ev, "'(4)'*2")).toBe(-8);
      expect(num(ev, "'1e2'-1")).toBe(99);
      expect(num(ev, "'2,5'/2")).toBe(1.25);
      // A date minus a text that is a number
      expect(text(ev, "FORMATSTR('dd/mm/yyyy',FLOATTODATETIME(45000)-'1')")).toBe('14/03/2023');
      // The number of a text is a Decimal, as in a + (a Double in Delphi)
      expect(typed(ev, "'6'-2")).toEqual(['Decimal', '4']);
      expect(typed(ev, "'6'+2")).toEqual(['Decimal', '8']);
    }
    expect(num(make('en-US'), "'1.5'*2")).toBe(3);
  });

  it('keeps failing with a text that is not a number', () => {
    for (const ev of both) {
      for (const e of ["'a'-1", "1-'a'", "'a'*2", "2/'a'", "''-1", "1-''", "''*2", "'x'-'y'", "'x'*'y'", "'x'/'y'", "-'a'", "'True'*2", "' '*2"]) {
        expect(fails(ev, e), e).toBe(true);
      }
    }
  });
});

describe('the text of a number or a date in STR and in a + with a text (converted reports)', () => {
  it('is the text Delphi writes in a report converted from Delphi', () => {
    // A decimal without the zeros of its scale, with the 15 digits of a Double
    expect(text(delphi, 'STR(1.50)')).toBe('1,5');
    expect(text(delphi, 'STR(1.0)')).toBe('1');
    expect(text(delphi, 'STR(-1.50)')).toBe('-1,5');
    expect(text(delphi, 'STR(1.10*3)')).toBe('3,3');
    expect(text(delphi, 'STR(1/3)')).toBe('0,333333333333333');
    expect(text(delphi, 'STR(2/3)')).toBe('0,666666666666667');
    expect(text(delphi, 'STR(80/9.0)')).toBe('8,88888888888889');
    expect(text(delphi, 'STR(100/7.0)')).toBe('14,2857142857143');
    expect(text(delphi, 'STR(1/0.3)')).toBe('3,33333333333333');
    expect(text(delphi, 'STR(123456789.123456789)')).toBe('123456789,123457');
    expect(text(delphi, 'STR(1234567.891)')).toBe('1234567,891');
    expect(text(delphi, "'x'+1.10")).toBe('x1,1');
    expect(text(delphi, "1.10+'x'")).toBe('1,1x');
    expect(text(delphi, "'x'+1.0")).toBe('x1');
    expect(text(delphi, "'a'+1/3")).toBe('a0,333333333333333');
    expect(text(delphi, "'a'+10/4")).toBe('a2,5');
    expect(text(delphi, "EVALTEXT('''x''+1.10')")).toBe('x1,1');
    // A date as the short date of Windows, with the long time when it has one; a time alone
    expect(text(delphi, 'STR(FLOATTODATETIME(45000))')).toBe('15/03/2023');
    expect(text(delphi, 'STR(FLOATTODATETIME(45000.5))')).toBe('15/03/2023 12:00:00');
    expect(text(delphi, 'STR(FLOATTODATETIME(45000.75))')).toBe('15/03/2023 18:00:00');
    expect(text(delphi, 'STR(FLOATTODATETIME(0.5))')).toBe('12:00:00');
    expect(text(delphi, 'STR(FLOATTODATETIME(-1.5))')).toBe('29/12/1899 12:00:00');
    // The decimal separator of the culture
    expect(text(make('en-US', true), 'STR(1.50)')).toBe('1.5');
    expect(text(make('en-US', true), "'x'+1.10")).toBe('x1.1');
  });

  it('keeps the text of the C# engine in its own reports', () => {
    expect(text(net, 'STR(1.50)')).toBe('1,50');
    expect(text(net, 'STR(1.0)')).toBe('1,0');
    expect(text(net, 'STR(80/9.0)')).toBe('8,888888888888888888888888889');
    expect(text(net, "'x'+1.10")).toBe('x1,10');
    expect(text(net, "1.10+'x'")).toBe('1,10x');
    expect(text(net, 'STR(FLOATTODATETIME(45000))')).toBe('15/3/2023 0:00:00');
    expect(text(net, 'STR(FLOATTODATETIME(0.5))')).toBe('30/12/1899 12:00:00');
  });

  it('is the same in both for an integer, a Double, a boolean and a text', () => {
    for (const ev of both) {
      expect(text(ev, 'STR(1)')).toBe('1');
      expect(text(ev, 'STR(1.5)')).toBe('1,5');
      expect(text(ev, 'STR(2.5D)')).toBe('2,5');
      expect(text(ev, 'STR(10/4)')).toBe('2,5');
      expect(text(ev, 'STR(0.1+0.2)')).toBe('0,3');
      expect(text(ev, 'STR(TRUE)')).toBe('True');
      expect(text(ev, 'STR(NULL)')).toBe('');
      expect(text(ev, "STR('a')")).toBe('a');
      expect(text(ev, "10+'a'")).toBe('10a');
      expect(text(ev, "'x'+2.5D")).toBe('x2,5');
      // A number plus the text of a number is the sum
      expect(num(ev, "'7'+1.50")).toBe(8.5);
      // A date, or a boolean, plus a text fails in both engines
      expect(fails(ev, "'x'+FLOATTODATETIME(45000)")).toBe(true);
      expect(fails(ev, "'x'+TRUE")).toBe(true);
    }
  });
});

describe('LEFT, RIGHT, REPLACESTR, POS and SUBSTR', () => {
  it('gives nothing for a negative count in LEFT and RIGHT (every report)', () => {
    for (const ev of both) {
      expect(typed(ev, "LEFT('abc',-1)")).toEqual(['String', '']);
      expect(typed(ev, "RIGHT('abc',-1)")).toEqual(['String', '']);
      expect(typed(ev, "LEFT('abc',-100)")).toEqual(['String', '']);
      expect(typed(ev, "RIGHT('',-1)")).toEqual(['String', '']);
      expect(text(ev, "LEFT('abc',0)")).toBe('');
      expect(text(ev, "LEFT('abc',2)")).toBe('ab');
      expect(text(ev, "RIGHT('abc',2)")).toBe('bc');
      expect(text(ev, "LEFT('abc',5)")).toBe('abc');
      expect(text(ev, "RIGHT('abc',5)")).toBe('abc');
    }
  });

  it('replaces nothing with an empty pattern (every report)', () => {
    for (const ev of both) {
      expect(text(ev, "REPLACESTR('abc','','X')")).toBe('abc');
      expect(text(ev, "REPLACESTR('','','X')")).toBe('');
      expect(text(ev, "REPLACESTR('abcabc','b','X')")).toBe('aXcaXc');
      expect(text(ev, "REPLACESTR('aaa','aa','b')")).toBe('ba');
      expect(text(ev, "REPLACESTR('abc','b','')")).toBe('ac');
    }
  });

  it('ignores the case in REPLACESTR in a report converted from Delphi', () => {
    expect(text(delphi, "REPLACESTR('abcabc','B','X')")).toBe('aXcaXc');
    expect(text(delphi, "REPLACESTR('ABCabc','b','x')")).toBe('AxCaxc');
    expect(text(delphi, "REPLACESTR('aAaA','a','b')")).toBe('bbbb');
    expect(text(delphi, "REPLACESTR('abc','ABC','')")).toBe('');
    expect(text(delphi, "REPLACESTR('ÁBC','á','x')")).toBe('xBC');
    expect(text(delphi, "REPLACESTR('ñandú','Ñ','N')")).toBe('Nandú');
    expect(text(delphi, "REPLACESTR('ΑΒΓ','β','x')")).toBe('ΑxΓ');
    expect(text(delphi, "REPLACESTR('ЖЗИ','з','x')")).toBe('ЖxИ');
    expect(text(delphi, "REPLACESTR('ÿ','Ÿ','x')")).toBe('x');
    // The upper case of Windows: the sharp s, the dotted and the dotless i, the final sigma, the
    // micro sign and the long s are not the letters they look like
    expect(text(delphi, "REPLACESTR('straße','SS','x')")).toBe('straße');
    expect(text(delphi, "REPLACESTR('İstanbul','i','x')")).toBe('İstanbul');
    expect(text(delphi, "REPLACESTR('ISTANBUL','ı','x')")).toBe('ISTANBUL');
    expect(text(delphi, "REPLACESTR('Σσς','σ','x')")).toBe('xxς');
    expect(text(delphi, "REPLACESTR('µ','Μ','x')")).toBe('µ');
    expect(text(delphi, "REPLACESTR('ſ','S','x')")).toBe('ſ');
    expect(text(delphi, "REPLACESTR('ǅ','ǆ','x')")).toBe('ǅ');
    expect(text(delphi, "REPLACESTR('ǆ','Ǆ','x')")).toBe('x');
    expect(text(delphi, "REPLACESTR('𐐨','𐐀','x')")).toBe('x');
    // The reports of the C# engine keep the case
    expect(text(net, "REPLACESTR('abcabc','B','X')")).toBe('abcabc');
    expect(text(net, "REPLACESTR('ABCabc','b','x')")).toBe('ABCaxc');
    expect(text(net, "REPLACESTR('ÁBC','á','x')")).toBe('ÁBC');
  });

  it('searches the characters as they are in POS, and never finds an empty text (every report)', () => {
    for (const ev of both) {
      expect(num(ev, "POS('','abc')")).toBe(0);
      expect(num(ev, "POS('','')")).toBe(0);
      expect(num(ev, "POS('ab','a'#173'b')")).toBe(0);
      expect(num(ev, "POS('e','e'#769)")).toBe(1);
      expect(num(ev, "POS('é','e'#769)")).toBe(0);
      expect(num(ev, "POS(#0,'abc')")).toBe(0);
      expect(num(ev, "POS('b','abc')")).toBe(2);
      expect(num(ev, "POS('B','abc')")).toBe(0);
      expect(num(ev, "POS('z','abc')")).toBe(0);
      expect(num(ev, "POS('ss','straße')")).toBe(0);
      expect(num(ev, "POS(#10,'a'#13#10'b')")).toBe(3);
      expect(num(ev, "POS(#13#10,'a'#13#10'b')")).toBe(2);
      expect(num(ev, "POS('abc','abc')")).toBe(1);
      expect(num(ev, "POS('abcd','abc')")).toBe(0);
    }
  });

  it('gives nothing for an index below 1 in SUBSTR in a report converted from Delphi', () => {
    expect(typed(delphi, "SUBSTR('abcdef',0,3)")).toEqual(['String', '']);
    expect(typed(delphi, "SUBSTR('abcdef',-1,3)")).toEqual(['String', '']);
    expect(typed(delphi, "SUBSTR('abcdef',-10,20)")).toEqual(['String', '']);
    // The reports of the C# engine start at the first character
    expect(text(net, "SUBSTR('abcdef',0,3)")).toBe('abc');
    expect(text(net, "SUBSTR('abcdef',-1,3)")).toBe('abc');
    for (const ev of both) {
      expect(text(ev, "SUBSTR('abcdef',1,0)")).toBe('');
      expect(text(ev, "SUBSTR('abcdef',2,-1)")).toBe('');
      expect(text(ev, "SUBSTR('abcdef',2,3)")).toBe('bcd');
      expect(text(ev, "SUBSTR('abcdef',5,10)")).toBe('ef');
      expect(text(ev, "SUBSTR('abcdef',7,2)")).toBe('');
      expect(text(ev, "SUBSTR('abcdef',1,100)")).toBe('abcdef');
      expect(text(ev, "SUBSTR('',0,1)")).toBe('');
    }
  });
});

describe('COMPAREVALUE as CompareValue of the Math unit of Delphi (every report)', () => {
  it('is 0 when the values differ in epsilon or less', () => {
    for (const ev of both) {
      expect(num(ev, 'COMPAREVALUE(1,1.001,0.001)')).toBe(0);
      expect(num(ev, 'COMPAREVALUE(1,1.05,0.1)')).toBe(0);
      expect(num(ev, 'COMPAREVALUE(1,0.9,0.1)')).toBe(0);
      expect(num(ev, 'COMPAREVALUE(1,2,1)')).toBe(0);
      expect(num(ev, 'COMPAREVALUE(3,1,2)')).toBe(0);
      expect(num(ev, 'COMPAREVALUE(2.5,1.5,1)')).toBe(0);
      expect(num(ev, 'COMPAREVALUE(0.3,0.1,0.2)')).toBe(0);
      expect(num(ev, 'COMPAREVALUE(1.15,1.1,0.05)')).toBe(0);
      expect(num(ev, 'COMPAREVALUE(INT(1),INT(2),INT(1))')).toBe(0);
      expect(num(ev, 'COMPAREVALUE(1,2,0.1)')).toBe(-1);
      expect(num(ev, 'COMPAREVALUE(2,1,0.1)')).toBe(1);
      expect(num(ev, 'COMPAREVALUE(1,0.8,0.1)')).toBe(1);
      expect(num(ev, 'COMPAREVALUE(1,1.0011,0.001)')).toBe(-1);
      // The values are doubles: 1.1 - 1 is a little more than 0.1
      expect(num(ev, 'COMPAREVALUE(1,1.1,0.1)')).toBe(-1);
      // A negative epsilon makes nothing equal
      expect(num(ev, 'COMPAREVALUE(1,1.1,-0.1)')).toBe(-1);
      expect(num(ev, 'COMPAREVALUE(1,2,-1)')).toBe(-1);
      expect(num(ev, 'COMPAREVALUE(1,1,-0.1)')).toBe(1);
    }
  });

  it('takes the resolution of the values as the epsilon when it is 0', () => {
    for (const ev of both) {
      expect(num(ev, 'COMPAREVALUE(1,1,0)')).toBe(0);
      expect(num(ev, 'COMPAREVALUE(0,0,0)')).toBe(0);
      expect(num(ev, 'COMPAREVALUE(-5,-5,0)')).toBe(0);
      expect(num(ev, 'COMPAREVALUE(1.5D,1.5,0)')).toBe(0);
      expect(num(ev, 'COMPAREVALUE(0.1+0.2,0.3,0)')).toBe(0);
      expect(num(ev, 'COMPAREVALUE(0.1D+0.2D,0.3D,0)')).toBe(0);
      expect(num(ev, 'COMPAREVALUE(1,2,0)')).toBe(-1);
      expect(num(ev, 'COMPAREVALUE(2,1,0)')).toBe(1);
      // Max(Min(Abs(a), Abs(b)) * 1E-12, 1E-12)
      expect(num(ev, 'COMPAREVALUE(1,1.0000000000001,0)')).toBe(0);
      expect(num(ev, 'COMPAREVALUE(1,1.000000000001,0)')).toBe(-1);
      expect(num(ev, 'COMPAREVALUE(1000000,1000000.0000001,0)')).toBe(0);
      expect(num(ev, 'COMPAREVALUE(1000000,1000000.00001,0)')).toBe(-1);
      expect(num(ev, 'COMPAREVALUE(0,0.000000000001,0)')).toBe(0);
      expect(num(ev, 'COMPAREVALUE(0,0.00000000001,0)')).toBe(-1);
      expect(num(ev, 'COMPAREVALUE(123456789012,123456789012.1,0)')).toBe(0);
      expect(num(ev, 'COMPAREVALUE(123456789012,123456789012.2,0)')).toBe(-1);
      // Values a Decimal does not hold (they threw)
      expect(num(ev, 'COMPAREVALUE(1E300,1E300,0)')).toBe(0);
      expect(num(ev, 'COMPAREVALUE(1E300,1.0000000000001E300,0)')).toBe(0);
      expect(num(ev, 'COMPAREVALUE(1E300,1.00000000001E300,0)')).toBe(-1);
      expect(num(ev, 'COMPAREVALUE(1E300,-1E300,0)')).toBe(1);
      expect(num(ev, 'COMPAREVALUE(0D/0,1,0)')).toBe(1);
      expect(num(ev, 'COMPAREVALUE(1,0D/0,0)')).toBe(1);
      expect(fails(ev, "COMPAREVALUE('1',1,0)")).toBe(true);
      expect(fails(ev, 'COMPAREVALUE(1,2,NULL)')).toBe(true);
    }
  });
});

describe('MONTHNAME, the date parts of a number and INT of a date', () => {
  it('takes any number as the month, rounded half to even as Delphi (every report)', () => {
    // The names of a report of the C# engine: its tables, by the language of the evaluator
    const names = ['', 'January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December', ''];
    const month = (expr: string): number => names.indexOf(text(net, expr));
    expect(month('MONTHNAME(INT(3))')).toBe(3);
    expect(month('MONTHNAME(3.0)')).toBe(3);
    expect(month('MONTHNAME(3D)')).toBe(3);
    expect(month('MONTHNAME(1.4)')).toBe(1);
    expect(month('MONTHNAME(1.5)')).toBe(2);
    expect(month('MONTHNAME(1.6)')).toBe(2);
    expect(month('MONTHNAME(2.5)')).toBe(2);
    expect(month('MONTHNAME(3.5)')).toBe(4);
    expect(month('MONTHNAME(4.5)')).toBe(4);
    expect(month('MONTHNAME(10.5D)')).toBe(10);
    expect(month('MONTHNAME(11.5)')).toBe(12);
    expect(month('MONTHNAME(12.5)')).toBe(12);
    expect(month('MONTHNAME(0.6)')).toBe(1);
    for (const e of ['MONTHNAME(0.5)', 'MONTHNAME(0.4)', 'MONTHNAME(12.6)', 'MONTHNAME(13)', 'MONTHNAME(0)', 'MONTHNAME(-1)', 'MONTHNAME(-0.6)', 'MONTHNAME(256)']) {
      expect(typed(net, e), e).toEqual(['String', '']);
      expect(typed(delphi, e), e).toEqual(['String', '']);
    }
    for (const ev of both) {
      expect(fails(ev, "MONTHNAME('a')")).toBe(true);
      expect(fails(ev, "MONTHNAME('3')")).toBe(true);
      expect(fails(ev, 'MONTHNAME(TRUE)')).toBe(true);
    }
  });

  it('gives the long month names of the locale as Delphi has them in a report converted from Delphi', () => {
    const es = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];
    for (let m = 1; m <= 12; m++) expect(text(delphi, `MONTHNAME(${m})`)).toBe(es[m - 1]);
    expect(text(delphi, 'MONTHNAME(INT(3))')).toBe('marzo');
    expect(text(delphi, 'MONTHNAME(1.5)')).toBe('febrero');
    expect(text(delphi, 'MONTHNAME(2.5)')).toBe('febrero');
    expect(text(delphi, 'MONTHNAME(3.5)')).toBe('abril');
    expect(text(delphi, 'MONTHNAME(12.5)')).toBe('diciembre');
    expect(text(delphi, 'MONTHNAME(FLOATTODATETIME(45000))')).toBe('marzo');
    expect(text(delphi, 'MONTHNAME(FLOATTODATETIME(0.5))')).toBe('diciembre');
    expect(text(make('en-US', true), 'MONTHNAME(9)')).toBe('September');
    // The language of the evaluator does not change them
    const spanish = make('es-ES', true);
    spanish.language = 2;
    expect(text(spanish, 'MONTHNAME(9)')).toBe('septiembre');
    // A report of the C# engine: the tables of the engine, English by default
    expect(text(net, 'MONTHNAME(1)')).toBe('January');
    expect(text(net, 'MONTHNAME(FLOATTODATETIME(45000))')).toBe('March');
    const spanishTable = make();
    spanishTable.language = 1;
    expect(text(spanishTable, 'MONTHNAME(9)')).toBe('Setiembre');
  });

  it('takes a number as an OLE date in DAY, MONTH and YEAR (every report)', () => {
    for (const ev of both) {
      expect(num(ev, 'DAY(45000)')).toBe(15);
      expect(num(ev, 'DAY(45000.5)')).toBe(15);
      expect(num(ev, 'DAY(45000.5D)')).toBe(15);
      expect(num(ev, 'DAY(INT(45000))')).toBe(15);
      expect(num(ev, 'DAY(5)')).toBe(4);
      expect(num(ev, 'DAY(0)')).toBe(30);
      expect(num(ev, 'DAY(-1)')).toBe(29);
      expect(num(ev, 'DAY(-1.5)')).toBe(29);
      expect(num(ev, 'DAY(-0.5)')).toBe(30);
      expect(num(ev, 'DAY(45000.9999999999)')).toBe(16);
      expect(num(ev, 'DAY(FLOATTODATETIME(45000))')).toBe(15);
      // Delphi takes the number in DAY only: MONTH and YEAR of a number are a type error there
      expect(num(ev, 'MONTH(45000)')).toBe(3);
      expect(num(ev, 'YEAR(45000)')).toBe(2023);
      expect(num(ev, 'YEAR(45000.5D)')).toBe(2023);
      expect(fails(ev, "DAY('a')")).toBe(true);
      expect(fails(ev, "DAY('45000')")).toBe(true);
      expect(fails(ev, 'DAY(TRUE)')).toBe(true);
      expect(fails(ev, 'MONTH(TRUE)')).toBe(true);
      expect(fails(ev, "YEAR('a')")).toBe(true);
    }
  });

  it('gives the integer part of the OLE date in INT of a date (every report)', () => {
    for (const ev of both) {
      expect(num(ev, 'INT(FLOATTODATETIME(45000))')).toBe(45000);
      expect(num(ev, 'INT(FLOATTODATETIME(45000.75))')).toBe(45000);
      expect(num(ev, 'INT(FLOATTODATETIME(-1.5))')).toBe(-1);
      expect(num(ev, 'INT(FLOATTODATETIME(0.5))')).toBe(0);
      expect(num(ev, 'INT(TIME)')).toBe(0);
      // 29-2-2024, the clock of these tests
      expect(num(ev, 'INT(TODAY)')).toBe(45351);
      expect(num(ev, 'INT(NOW)')).toBe(45351);
      expect(text(ev, 'INT(TODAY)=INT(NOW)')).toBe('True');
      expect(fails(ev, 'INT(TRUE)')).toBe(true);
      expect(fails(ev, "INT('5')")).toBe(true);
    }
  });
});

describe('VAL, ISNUMERIC and ISINTEGER', () => {
  it('reads an exponent in VAL (every report)', () => {
    for (const ev of both) {
      expect(num(ev, "VAL('1e3')")).toBe(1000);
      expect(num(ev, "VAL('1E3')")).toBe(1000);
      expect(num(ev, "VAL('1e+3')")).toBe(1000);
      expect(num(ev, "VAL('1E-3')")).toBe(0.001);
      expect(num(ev, "VAL('1,5e2')")).toBe(150);
      expect(num(ev, "VAL('1E-400')")).toBe(0);
      // A number a Decimal does not hold is a Double (it threw)
      expect(typed(ev, "VAL('1E29')")).toEqual(['Double', '1E+29']);
      expect(num(ev, "VAL('1e400')")).toBe(Infinity);
      expect(typed(ev, "VAL('1e3')")).toEqual(['Decimal', '1000']);
      // An empty text stays 0 (an error in Delphi)
      expect(typed(ev, "VAL('')")).toEqual(['Integer', '0']);
      expect(num(ev, "VAL('1,5')")).toBe(1.5);
      expect(num(ev, "VAL('123')")).toBe(123);
      expect(num(ev, "VAL(' 12 ')")).toBe(12);
      expect(num(ev, "VAL('-1')")).toBe(-1);
      expect(num(ev, "VAL('+1')")).toBe(1);
      expect(num(ev, "VAL(',5')")).toBe(0.5);
      expect(num(ev, "VAL('5,')")).toBe(5);
      expect(num(ev, "VAL('1,000')")).toBe(1);
      expect(num(ev, "VAL('0,1')*3")).toBeCloseTo(0.3, 12);
      expect(num(ev, 'VAL(5.5)')).toBe(5.5);
      for (const e of ["VAL('abc')", "VAL('1e')", "VAL('e3')", "VAL('(1)')", "VAL('$1')", "VAL('.5')", "VAL('1 000')", "VAL(' ')", 'VAL(NULL)']) expect(fails(ev, e), e).toBe(true);
    }
  });

  it('takes no thousands separators in VAL and ISNUMERIC in a report converted from Delphi', () => {
    // StrToFloat of Delphi: in es-ES the point is not a part of a number
    for (const e of ["VAL('1.5')", "VAL('1.000')", "VAL('1.000,5')", "VAL('1.5.5')", "VAL('5.')", "VAL('0.1')", "VAL('1.50')", "VAL('1.5e2')", "VAL('1-')"]) {
      expect(fails(delphi, e), e).toBe(true);
    }
    for (const e of ["ISNUMERIC('1.5')", "ISNUMERIC('1.5.5')", "ISNUMERIC('1.000')", "ISNUMERIC('1.000,5')", "ISNUMERIC('5.')", "ISNUMERIC('1.5e2')", "ISNUMERIC('1..5')"]) {
      expect(text(delphi, e), e).toBe('False');
    }
    for (const e of ["ISNUMERIC('1,5')", "ISNUMERIC('1,000')", "ISNUMERIC('5,')", "ISNUMERIC(',5')", "ISNUMERIC('1e5')", "ISNUMERIC('1,5e2')", "ISNUMERIC(' 1 ')", "ISNUMERIC('-1')"]) {
      expect(text(delphi, e), e).toBe('True');
    }
    // In en-US the comma is the one that is no part of a number
    const us = make('en-US', true);
    expect(num(us, "VAL('1.5')")).toBe(1.5);
    expect(fails(us, "VAL('1,000')")).toBe(true);
    expect(text(us, "ISNUMERIC('1,000.5')")).toBe('False');
    expect(text(us, "ISNUMERIC('1000.5')")).toBe('True');
    // The reports of the C# engine skip the thousands separators, wherever they are
    expect(num(net, "VAL('1.5')")).toBe(15);
    expect(num(net, "VAL('1.000,5')")).toBe(1000.5);
    expect(num(net, "VAL('1.5.5')")).toBe(155);
    expect(num(net, "VAL('1-')")).toBe(-1);
    expect(text(net, "ISNUMERIC('1.5')")).toBe('True');
    expect(text(net, "ISNUMERIC('1.5.5')")).toBe('True');
    expect(text(net, "ISNUMERIC('1.000,5')")).toBe('True');
  });

  it('never took thousands separators in ISINTEGER', () => {
    for (const ev of both) {
      expect(text(ev, "ISINTEGER('1.000')")).toBe('False');
      expect(text(ev, "ISINTEGER('1,000')")).toBe('False');
      expect(text(ev, "ISINTEGER('1.5')")).toBe('False');
      expect(text(ev, "ISINTEGER('12')")).toBe('True');
      expect(text(ev, "ISINTEGER('-2147483648')")).toBe('True');
      expect(text(ev, "ISINTEGER('2147483648')")).toBe('False');
    }
  });
});

describe('a date plus a date and a number minus a date (every report)', () => {
  const iso = (ev: Evaluator, expr: string): string => text(ev, `FORMATSTR('yyyy-mm-dd hh:nn:ss',${expr})`);

  it('adds the OLE dates of two dates, as Delphi adds two TDateTime values', () => {
    for (const ev of both) {
      expect(iso(ev, 'FLOATTODATETIME(45000)+FLOATTODATETIME(0.5)')).toBe('2023-03-15 12:00:00');
      expect(iso(ev, 'FLOATTODATETIME(0.5)+FLOATTODATETIME(45000)')).toBe('2023-03-15 12:00:00');
      expect(iso(ev, 'FLOATTODATETIME(45000.25)+FLOATTODATETIME(0.5)')).toBe('2023-03-15 18:00:00');
      expect(iso(ev, 'FLOATTODATETIME(0.25)+FLOATTODATETIME(0.5)')).toBe('1899-12-30 18:00:00');
      expect(iso(ev, 'FLOATTODATETIME(0.75)+FLOATTODATETIME(0.75)')).toBe('1899-12-31 12:00:00');
      expect(iso(ev, 'FLOATTODATETIME(45000)+FLOATTODATETIME(45000)')).toBe('2146-05-29 00:00:00');
      expect(iso(ev, 'FLOATTODATETIME(45000)+FLOATTODATETIME(1)')).toBe('2023-03-16 00:00:00');
      expect(iso(ev, 'FLOATTODATETIME(45000)+FLOATTODATETIME(-1)')).toBe('2023-03-14 00:00:00');
      expect(iso(ev, 'FLOATTODATETIME(45000)+FLOATTODATETIME(-1.5)')).toBe('2023-03-13 12:00:00');
      expect(iso(ev, 'FLOATTODATETIME(-1.25)+FLOATTODATETIME(-1.25)')).toBe('1899-12-28 12:00:00');
      // A date plus a time: TODAY+TIME is now (the clock of these tests: 29-2-2024 13:45:30). TIME
      // is a time without a date (day 0001-01-01 here), which counts as a time of the day zero
      expect(iso(ev, 'TODAY+TIME')).toBe('2024-02-29 13:45:30');
      expect(iso(ev, 'TIME+TODAY')).toBe('2024-02-29 13:45:30');
      expect(text(ev, '(TODAY+TIME)-NOW')).toBe('0');
      expect(iso(ev, 'TODAY+FLOATTODATETIME(0.75)')).toBe('2024-02-29 18:00:00');
      expect(num(ev, 'YEAR(TIME+TIME)')).toBe(1899);
      // A date .NET does not hold (after the year 9999) is an error
      expect(fails(ev, 'FLOATTODATETIME(1500000)+FLOATTODATETIME(1500000)')).toBe(true);
    }
  });

  it('subtracts the OLE date from the number (it gave the date minus the number)', () => {
    for (const ev of both) {
      expect(iso(ev, '1-FLOATTODATETIME(45000)')).toBe('1776-10-16 00:00:00');
      expect(iso(ev, '45001-FLOATTODATETIME(45000)')).toBe('1899-12-31 00:00:00');
      expect(iso(ev, '45001.5-FLOATTODATETIME(45000)')).toBe('1899-12-31 12:00:00');
      expect(iso(ev, '2.5D-FLOATTODATETIME(1)')).toBe('1899-12-31 12:00:00');
      expect(iso(ev, 'INT(5)-FLOATTODATETIME(1)')).toBe('1900-01-03 00:00:00');
      expect(iso(ev, '100000-FLOATTODATETIME(45000)')).toBe('2050-07-31 00:00:00');
      expect(iso(ev, '100000.0-FLOATTODATETIME(45000)')).toBe('2050-07-31 00:00:00');
      expect(iso(ev, "'6'-FLOATTODATETIME(1)")).toBe('1900-01-04 00:00:00');
      expect(num(ev, 'YEAR(100000-FLOATTODATETIME(45000))')).toBe(2050);
      expect(text(ev, '5-FLOATTODATETIME(45000)<0')).toBe('True');
      // The date minus the number, and the difference of two dates, as they were
      expect(iso(ev, 'FLOATTODATETIME(45000)-1')).toBe('2023-03-14 00:00:00');
      expect(num(ev, 'FLOATTODATETIME(45000)-FLOATTODATETIME(44000)')).toBe(1000);
    }
  });
});
