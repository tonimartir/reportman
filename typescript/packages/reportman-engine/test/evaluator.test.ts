// The parts of the evaluator that golden-cs eval cannot reach (it only evaluates expressions
// without variables or datasets): variables and :=, M. names, dataset fields and their errors,
// the registration API, error positions, the language of MONTHNAME / NUMTOTEXT, nested
// evaluation and GetStreamFromExpression. Expected values follow the C# code.

import { describe, expect, it } from 'vitest';
import {
  createContext,
  DatasetAlias,
  DateTimeKind,
  EvalException,
  Evaluator,
  IdenCallbackFunction,
  IdenConstant,
  IdenVariableParam,
  MemoryTable,
  ParamType,
  RpDateTime,
  Variant,
  VariantType,
  type ParamLike,
} from '@reportman/engine';

const now = () => RpDateTime.create(2024, 2, 29, 13, 45, 30, 0, DateTimeKind.Local);
const host = { now, fileExists: (p: string) => p === 'exists.txt' };

function make(culture = 'en-US'): Evaluator {
  return new Evaluator({ context: createContext(culture, { now }), host });
}

function evaluate(ev: Evaluator, text: string): Variant {
  ev.expression = text;
  return ev.evaluate();
}

function errorOf(fn: () => unknown): EvalException {
  try {
    fn();
  } catch (e) {
    return e as EvalException;
  }
  throw new Error('no error');
}

describe('variables', () => {
  it('assigns with := and reads with and without M.', () => {
    const ev = make();
    ev.newVariable('total', Variant.fromInteger(1));
    expect(evaluate(ev, 'TOTAL').toString(ev.context)).toBe('1');
    expect(evaluate(ev, 'total := 5').toString(ev.context)).toBe('5');
    expect(evaluate(ev, 'M.TOTAL + 1').toString(ev.context)).toBe('6');
    expect(evaluate(ev, 'm.total :=2').toString(ev.context)).toBe('2');
    // C# parity: the value assigned is the one of the rest of the statement list (the separator
    // after := evaluates "TOTAL + 1" before the assignment), so TOTAL becomes 2 + 1.
    expect(evaluate(ev, 'TOTAL := 5; TOTAL + 1').toString(ev.context)).toBe('3');
    expect(evaluate(ev, 'TOTAL').toString(ev.context)).toBe('3');
    expect(evaluate(ev, '1; TOTAL := TOTAL*10').toString(ev.context)).toBe('30');
  });

  it('keeps the value of the assignment as the result', () => {
    const ev = make();
    ev.newVariable('X', Variant.null);
    expect(evaluate(ev, "X:='a'+'b'").toString(ev.context)).toBe('ab');
    expect(ev.identifiers.get('M.X')!.value.toString(ev.context)).toBe('ab');
  });

  it('is not an assignment with a blank between : and =', () => {
    const ev = make();
    ev.newVariable('X', Variant.fromInteger(1));
    const e = errorOf(() => evaluate(ev, 'X: =5'));
    expect(e.netType).toBe('EvalException');
  });

  it('refuses a second variable of the same name', () => {
    const ev = make();
    ev.newVariable('A', Variant.null);
    expect(() => ev.newVariable('a', Variant.null)).toThrow('Variable exists:a');
  });

  it('binds report parameters (IdenVariableParam)', () => {
    const ev = make();
    const param: ParamLike = {
      paramType: ParamType.Integer,
      lastValue: Variant.fromInteger(7),
      getMultiValue: () => Variant.fromString('multi'),
    };
    ev.addVariable('PCOUNT', new IdenVariableParam(ev, param));
    expect(evaluate(ev, 'PCOUNT*2').toString(ev.context)).toBe('14');
    evaluate(ev, 'PCOUNT:=3');
    expect(param.lastValue.toString(ev.context)).toBe('3');
  });

  it('cannot assign a constant or a function', () => {
    const ev = make();
    expect(() => {
      ev.identifiers.get('TRUE')!.value = Variant.null;
    }).toThrow('Can not set a value to a constant');
    expect(() => {
      ev.identifiers.get('LEFT')!.value = Variant.null;
    }).toThrow();
  });
});

describe('dataset fields', () => {
  const customers = new MemoryTable(['ID', 'Name', 'Amount'], [
    [1, 'Alice', 10.5],
    [2, 'Bob', null],
  ]);
  const orders = new MemoryTable(['ID', 'CUSTOMER'], [[100, 1]]);

  it('reads ALIAS.FIELD and FIELD of the current row', () => {
    const ev = make();
    const alias = new DatasetAlias();
    const c = alias.add('customers', customers, 0);
    ev.aliasList = alias;
    expect(evaluate(ev, 'CUSTOMERS.NAME').toString(ev.context)).toBe('Alice');
    expect(evaluate(ev, 'name').toString(ev.context)).toBe('Alice');
    expect(evaluate(ev, '[CUSTOMERS.Name]').toString(ev.context)).toBe('Alice');
    // C# parity: an unknown character (here ") ends the expression, so the + has no operand
    expect(errorOf(() => evaluate(ev, '[CUSTOMERS.Name] + "x"')).message).toBe('Syntax error');
    expect(evaluate(ev, 'AMOUNT*2').toString(ev.context)).toBe('21');
    c.currentRow = 1;
    expect(evaluate(ev, 'AMOUNT').varType).toBe(VariantType.Null);
    expect(evaluate(ev, 'CUSTOMERS.ID+1').toString(ev.context)).toBe('3');
  });

  it('raises the ambiguity of a field in two datasets and of a field and a variable', () => {
    const ev = make();
    // the variable first: NewVariable refuses a name that is already a field
    ev.newVariable('CUSTOMER', Variant.fromInteger(5));
    const alias = new DatasetAlias();
    alias.add('customers', customers);
    alias.add('orders', orders);
    ev.aliasList = alias;
    expect(errorOf(() => evaluate(ev, 'ID')).message).toBe('Especify variable or file:ID');
    expect(evaluate(ev, 'ORDERS.ID').toString(ev.context)).toBe('100');
    expect(() => ev.newVariable('NAME', Variant.null)).toThrow('Variable exists:NAME');
    expect(errorOf(() => evaluate(ev, 'CUSTOMER')).message).toBe('Especify variable or file:CUSTOMER');
    expect(evaluate(ev, 'M.CUSTOMER').toString(ev.context)).toBe('5');
  });

  it('asks for a dataset that is not loaded', () => {
    const ev = make();
    const alias = new DatasetAlias();
    ev.aliasList = alias;
    const asked: string[] = [];
    ev.onDatasetNeeded = (args) => {
      asked.push(args.dataset);
      if (args.dataset === 'ORDERS') alias.add('orders', orders);
    };
    expect(evaluate(ev, 'ORDERS.CUSTOMER').toString(ev.context)).toBe('1');
    expect(asked).toContain('ORDERS');
    expect(errorOf(() => evaluate(ev, 'NOPE.FIELD')).message).toBe('Unknown identifier: NOPE.FIELD');
  });

  it('cannot assign a field', () => {
    const ev = make();
    const alias = new DatasetAlias();
    alias.add('customers', customers);
    ev.aliasList = alias;
    const iden = ev.searchIdentifier('NAME')!;
    expect(() => {
      iden.value = Variant.null;
    }).toThrow();
  });
});

describe('registration API', () => {
  it('adds functions and constants', () => {
    const ev = make();
    ev.addIden(
      'twice',
      new IdenCallbackFunction(ev, 'TWICE', 1, (p) => Variant.mul(p[0]!, Variant.fromInteger(2), ev.context), 'function Twice(n)'),
    );
    ev.addIden('PAGE', new IdenConstant(ev, Variant.fromInteger(3)));
    expect(evaluate(ev, 'TWICE(PAGE)+1').toString(ev.context)).toBe('7');
    expect(evaluate(ev, 'TWICE(TWICE(2))').toString(ev.context)).toBe('8');
    expect(ev.identifiers.get('TWICE')!.model).toBe('function Twice(n)');
    expect(() => ev.addIden('PAGE', new IdenConstant(ev))).toThrow('An item with the same key has already been added. Key: PAGE');
  });

  it('lists the identifiers in culture order', () => {
    const ev = make();
    const keys = ev.identifiers.keys;
    // 41 of the C# engine and the 10 of the Delphi engine (EvalFunctionsDelphi.cs)
    expect(keys.length).toBe(51);
    expect(keys.includes('HOURMINSEC')).toBe(true);
    expect(keys[0]).toBe('ABS');
    expect(keys.includes('FORMATNUM')).toBe(true);
    expect(ev.identifiers.at(0).name).toBe('Abs');
  });
});

describe('errors', () => {
  it('carries the line and the position after the current token', () => {
    const ev = make();
    let e = errorOf(() => evaluate(ev, 'UNKNOWN + 1'));
    expect([e.message, e.sourceLine, e.sourcePos, e.elementName]).toEqual(['Unknown identifier: UNKNOWN', 1, 7, 'UNKNOWN']);
    e = errorOf(() => evaluate(ev, '1+\n2+\nFOO'));
    expect([e.sourceLine, e.sourcePos]).toEqual([3, 9]);
    e = errorOf(() => evaluate(ev, '(1+2'));
    expect([e.message, e.sourcePos]).toEqual(['Parentesis error', 4]);
    e = errorOf(() => evaluate(ev, "LEFT('abc' 1)"));
    expect(e.message).toBe('Expected ,');
  });

  it('uses the messages of the culture', () => {
    const ev = make('es-ES');
    expect(errorOf(() => evaluate(ev, 'FOO')).message).toBe('Identificador desconocido: FOO');
    expect(errorOf(() => evaluate(ev, 'TRUE+1')).message).toMatch(/^Error de conversi/);
  });

  it('refuses a new expression while evaluating', () => {
    const ev = make();
    ev.addIden(
      'REENTER',
      new IdenCallbackFunction(ev, 'REENTER', 0, () => {
        ev.expression = '1';
        return Variant.null;
      }),
    );
    expect(errorOf(() => evaluate(ev, 'REENTER')).netType).toBe('EvalException');
  });
});

describe('evaluation', () => {
  it('evaluates an empty expression as True', () => {
    expect(evaluate(make(), '').toString(make().context)).toBe('True');
  });

  it('checks the syntax by evaluating (C# parity: Evaluate resets FChecking)', () => {
    const ev = make();
    expect(() => ev.checkSyntax('1+2')).not.toThrow();
    expect(() => ev.checkSyntax('FOO')).toThrow('Unknown identifier: FOO');
    expect(() => ev.checkSyntax("LEFT(5,1)")).toThrow('Object reference not set to an instance of an object.');
  });

  it('shares the variables with EVALTEXT and CHECKEXPRESSION', () => {
    const ev = make();
    ev.newVariable('X', Variant.fromInteger(41));
    expect(evaluate(ev, "EVALTEXT('X+1')").toString(ev.context)).toBe('42');
    expect(evaluate(ev, "EVALTEXT('X:=1'); X").toString(ev.context)).toBe('1');
    expect(errorOf(() => evaluate(ev, "CHECKEXPRESSION('X>5','too small')")).message).toBe('too small');
    expect(ev.evaluateText('X*3').toString(ev.context)).toBe('3');
  });

  it('reads the clock and the files of the host', () => {
    const ev = make();
    expect(evaluate(ev, "FORMATSTR('yyyy-mm-dd hh:nn:ss', NOW)").toString(ev.context)).toBe('2024-02-29 13:45:30');
    expect(evaluate(ev, "FORMATSTR('yyyy-mm-dd hh:nn:ss', TODAY)").toString(ev.context)).toBe('2024-02-29 00:00:00');
    expect(evaluate(ev, "FILEEXISTS('exists.txt')").toString(ev.context)).toBe('True');
    expect(evaluate(ev, "FILEEXISTS('other.txt')").toString(ev.context)).toBe('False');
    expect(evaluate(ev, "ISVALIDDATETIME('10:30')").toString(ev.context)).toBe('True');
    expect(evaluate(ev, "'13:00' < NOW").toString(ev.context)).toBe('True');
  });

  it('writes month names and numbers in the evaluator language', () => {
    const ev = make();
    expect(evaluate(ev, 'MONTHNAME(9)').toString(ev.context)).toBe('September');
    ev.language = 1;
    expect(evaluate(ev, 'MONTHNAME(9)').toString(ev.context)).toBe('Setiembre');
    expect(evaluate(ev, 'NUMTOTEXT(1234.56,FALSE)').toString(ev.context)).toBe('Mil doscientos treinta y cuatro con cincuenta y seis');
    expect(evaluate(ev, 'NUMTOTEXT(21,TRUE)').toString(ev.context)).toBe('Veintiuna');
    expect(evaluate(ev, 'NUMTOTEXT(200,FALSE)').toString(ev.context)).toBe('Doscientos ');
    expect(evaluate(ev, 'NUMTOTEXT(1000000,FALSE)').toString(ev.context)).toBe('Un millón ');
    expect(evaluate(ev, 'NUMTOTEXT(2500000,TRUE)').toString(ev.context)).toBe('Dos millones quinientas mil ');
    ev.language = 2;
    expect(evaluate(ev, 'MONTHNAME(3)').toString(ev.context)).toBe('Març');
    expect(evaluate(ev, 'NUMTOTEXT(1234.56,FALSE)').toString(ev.context)).toBe('Mil dos-cents trenta-quatre amb cinquanta-sis');
    expect(evaluate(ev, 'NUMTOTEXT(51,FALSE)').toString(ev.context)).toBe('Cincuanta-un');
    ev.language = 4;
    expect(evaluate(ev, 'NUMTOTEXT(5,FALSE)').toString(ev.context)).toBe('');
  });

  it('gets the bytes of a binary field without its Paradox header', () => {
    const ev = make();
    const image = new Uint8Array([1, 0, 0, 1, 3, 0, 0, 0, 7, 8, 9, 10]);
    const alias = new DatasetAlias();
    alias.add('t', new MemoryTable(['PIC', 'PATH'], [[image, 'exists.txt']]));
    ev.aliasList = alias;
    expect([...ev.getStreamFromExpression('T.PIC')!]).toEqual([7, 8, 9]);
    expect([...ev.getStreamFromExpression("STRINGTOBIN('QUJD')")!]).toEqual([65, 66, 67]);
    expect(() => ev.getStreamFromExpression('T.PATH')).toThrow('File not found:exists.txt');
    expect(() => ev.getStreamFromExpression('1+1')).toThrow('Field or file not found:1+1');
  });
});

describe('Variant.toFormatString with a parameter type', () => {
  const ctx = createContext('en-US');
  const date = Variant.fromDateTime(RpDateTime.create(2024, 3, 5, 14, 7, 9));

  it('formats dates with the defaults of the parameter type', () => {
    expect(date.toFormatString(ctx, '', ParamType.Date, true)).toBe('3/5/2024');
    // C# parity: DateFormatMask turns the h of "h:mm tt" into H (no am/pm in the mask) and keeps tt
    expect(date.toFormatString(ctx, '', ParamType.Time, true)).toBe('14:07 PM');
    expect(date.toFormatString(ctx, '', ParamType.DateTime, true)).toBe('Tuesday, March 5, 2024 14:07:09 PM');
    expect(date.toFormatString(ctx, '', ParamType.Unknown, false)).toBe('Tuesday, March 5, 2024 14:07:09 PM');
    expect(date.toFormatString(ctx, 'dd/mm/yyyy', ParamType.Date, false)).toBe('05/03/2024');
  });

  it('gives defaults to Null values and hides zeros', () => {
    expect(Variant.null.toFormatString(ctx, '0.00', ParamType.Integer, true)).toBe('0.00');
    expect(Variant.null.toFormatString(ctx, '', ParamType.Bool, true)).toBe('False');
    expect(Variant.null.toFormatString(ctx, '{0}', ParamType.String, true)).toBe('');
    expect(Variant.null.toFormatString(ctx, 'x', ParamType.Date, true)).toBe('');
    expect(Variant.fromInteger(0).toFormatString(ctx, '0.00', ParamType.Unknown, false)).toBe('');
    expect(Variant.fromInteger(5).toFormatString(ctx, '', ParamType.Unknown, false)).toBe('5');
    expect(() => Variant.fromInteger(5).toFormatString(ctx, 'dd', ParamType.Date, true)).toThrow('Type conversion error');
  });
});
