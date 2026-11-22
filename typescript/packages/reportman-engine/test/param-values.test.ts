// Report parameters at run time, as tests/ParamsTest of the C# engine: the type an initial
// expression turns into (Param.ParamTypeOf), initial expressions evaluated and put back, the value
// InitializeParams binds, and CheckParameters validating the values just entered (not the previous
// run's LastValue), a list parameter with the value it will bind. Expected values are the ones of
// the C# test.

import { describe, expect, it } from 'vitest';
import { Param, ParamType as LibParamType, Report, VariantType as LibVariantType } from '@reportman/lib';
import { PdfDevice } from '@reportman/pdf';
import { CsDecimal, ParamType, paramTypeOf, prepareReport, RpDateTime, Variant, VariantType, type ReportRuntime } from '@reportman/engine';

type LibValue = NonNullable<Param['value']>;
const str = (s: string): LibValue => ({ type: LibVariantType.String, value: s });
const int = (n: number): LibValue => ({ type: LibVariantType.Integer, value: n });

function add(report: Report, alias: string, type: LibParamType, value: LibValue): Param {
  const p = new Param();
  p.name = 'TRPPARAM' + (report.params.length + 1);
  p.alias = alias;
  p.paramType = type;
  p.visible = true;
  p.value = value;
  report.params.push(p);
  return p;
}

async function runtimeOf(report: Report): Promise<ReportRuntime> {
  return (await prepareReport(report, { device: new PdfDevice() })).runtime;
}

function isToday(v: Variant): boolean {
  if (v.varType !== VariantType.DateTime) return false;
  const d = v.rawValue as RpDateTime;
  const now = new Date();
  return d.year === now.getFullYear() && d.month === now.getMonth() + 1 && d.day === now.getDate();
}

describe('paramTypeOf', () => {
  it('gives the type of the value, as VariantTypeToParamType of Delphi', () => {
    expect(paramTypeOf(Variant.fromDateTime(RpDateTime.create(2026, 10, 7)))).toBe(ParamType.Date);
    expect(paramTypeOf(Variant.fromDateTime(RpDateTime.create(2026, 10, 7, 9, 30, 0)))).toBe(ParamType.DateTime);
    expect(paramTypeOf(Variant.fromDateTime(RpDateTime.create(1899, 12, 30, 9, 30, 0)))).toBe(ParamType.Time);
    expect(paramTypeOf(Variant.fromInteger(5))).toBe(ParamType.Integer);
    expect(paramTypeOf(Variant.fromLong(5n))).toBe(ParamType.Integer);
    expect(paramTypeOf(Variant.fromDouble(2.5))).toBe(ParamType.Double);
    expect(paramTypeOf(Variant.fromDecimal(CsDecimal.parseInvariant('2.5')))).toBe(ParamType.Currency);
    expect(paramTypeOf(Variant.fromBoolean(true))).toBe(ParamType.Bool);
    expect(paramTypeOf(Variant.fromString('abc'))).toBe(ParamType.String);
    expect(paramTypeOf(Variant.null)).toBe(ParamType.Unknown);
  });
});

describe('initial expressions', () => {
  it('are evaluated, put back, and bound by InitializeParams', async () => {
    const report = new Report();
    add(report, 'FROMDATE', LibParamType.InitialValue, str('TODAY'));
    add(report, 'COUNT', LibParamType.InitialValue, str('2+3'));
    const runtime = await runtimeOf(report);
    runtime.updateInitialValues();
    const today = runtime.paramByAlias('FROMDATE')!;
    const sum = runtime.paramByAlias('COUNT')!;
    expect(today.paramType).toBe(ParamType.Date);
    expect(isToday(today.value)).toBe(true);
    expect([ParamType.Integer, ParamType.Double]).toContain(sum.paramType);
    expect(sum.value.toDouble(runtime.evaluator.context)).toBe(5);

    // What is saved is the expression, not today's date: the model is untouched and the runtime
    // puts the expression back
    expect(report.params[0]!.paramType).toBe(LibParamType.InitialValue);
    expect(report.params[0]!.value).toEqual(str('TODAY'));
    runtime.restoreInitialValues();
    expect(today.paramType).toBe(ParamType.InitialValue);
    expect(today.value.toString(runtime.evaluator.context)).toBe('TODAY');

    // Printing without a parameters form: the value bound is the date, not the text "TODAY"
    const reloaded = await runtimeOf(report);
    reloaded.initEvaluator();
    reloaded.initializeParams();
    expect(isToday(reloaded.paramByAlias('FROMDATE')!.lastValue)).toBe(true);
  });
});

describe('CheckParameters', () => {
  it('validates the values just entered', async () => {
    const report = new Report();
    const amount = add(report, 'AMOUNT', LibParamType.Integer, int(5));
    amount.validation = 'AMOUNT>10';
    amount.errorMessages = ['The amount must be greater than 10'];
    const runtime = await runtimeOf(report);
    const p = runtime.paramByAlias('AMOUNT')!;
    expect(runtime.checkParameters()).toBe('AMOUNT');
    p.value = Variant.fromInteger(20);
    // The previous run's 5 is not what is checked
    expect(runtime.checkParameters()).toBe('');
    p.value = Variant.fromInteger(3);
    expect(runtime.checkParameters()).toBe('AMOUNT');
  });

  it('validates a list parameter with the value it will bind', async () => {
    const report = new Report();
    const amount = add(report, 'AMOUNT', LibParamType.Integer, int(20));
    amount.validation = 'AMOUNT>10';
    const kind = add(report, 'KIND', LibParamType.List, str("'B'"));
    kind.items = ['Sales', 'Purchases'];
    kind.values = ["'S'", "'B'"];
    kind.validation = "KIND='S'";
    const runtime = await runtimeOf(report);
    expect(runtime.checkParameters()).toBe('KIND');
    runtime.paramByAlias('KIND')!.value = Variant.fromString("'S'");
    expect(runtime.checkParameters()).toBe('');
  });
});

describe('a list parameter in the model JSON', () => {
  it('serializes without a run-time list value', () => {
    const report = new Report();
    const choice = add(report, 'CHOICE', LibParamType.List, str('2'));
    choice.items = ['One', 'Two'];
    choice.values = ['1', '2'];
    const json = JSON.stringify(report);
    expect(json).toContain('"CHOICE"');
    expect(json).not.toContain('listValue');
  });
});
