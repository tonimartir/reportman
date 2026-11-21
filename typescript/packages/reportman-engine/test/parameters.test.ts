// The two steps of a parameters form (port of Reportman.Server.Tests.ReportParametersTests): what
// describeParameters gives and what applyParameters accepts. The form cannot be trusted: a hidden
// or read-only parameter, a value that is not one of a list's options, or a free-text parameter
// from whoever only runs reports are refused.

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { afterAll, describe, expect, it } from 'vitest';
import { DatabaseInfo, DataInfo, DriverType, Param, ParamType as LibParamType, Report, SubReport, VariantType } from '@reportman/lib';
import { PdfDevice } from '@reportman/pdf';
import {
  CsDecimal,
  NoDataToPrintException,
  ParameterException,
  ParameterProblem,
  ParamType,
  prepareReport,
  RpDateTime,
  VariantType as EngineVariantType,
  type ReportRun,
} from '@reportman/engine';
import { sqliteHost } from './sqlite-host.js';

const database = path.join(os.tmpdir(), 'rm-params-' + process.pid + '-' + Date.now() + '.db');
{
  const db = new DatabaseSync(database);
  db.exec("CREATE TABLE EMPRESAS (ID INTEGER, NOMBRE TEXT); INSERT INTO EMPRESAS VALUES (1, 'Alfa'), (2, 'Beta'), (3, 'Gamma');");
  db.close();
}
afterAll(() => {
  try {
    fs.unlinkSync(database);
  } catch {
    // the file is removed with the temporary folder
  }
});

function newReport(): Report {
  const report = new Report();
  SubReport.initNew(report, (() => {
    const sub = new SubReport();
    sub.name = 'TRPSUBREPORT1';
    report.subReports.push(sub);
    return sub;
  })());
  for (const s of report.subReports[0]!.sections) s.subReportName = 'TRPSUBREPORT1';
  const db = new DatabaseInfo();
  db.alias = 'DATOS';
  db.name = 'TRPDATABASEINFOITEM1';
  db.driver = DriverType.DotNet2;
  db.loadParams = false;
  db.providerFactory = 'SQLiteCore';
  db.connectionString = 'Data Source=' + database;
  report.databaseInfo.push(db);
  const lookup = new DataInfo();
  lookup.alias = 'LKEMPRESAS';
  lookup.name = 'TRPDATAINFOITEM1';
  lookup.databaseAlias = 'DATOS';
  lookup.sql = 'SELECT NOMBRE, ID FROM EMPRESAS ORDER BY ID';
  report.dataInfo.push(lookup);
  return report;
}

type LibValue = { type: VariantType; value: unknown };
const str = (s: string): LibValue => ({ type: VariantType.String, value: s });
const int = (n: number): LibValue => ({ type: VariantType.Integer, value: n });
const dbl = (n: number): LibValue => ({ type: VariantType.Double, value: n });
const bool = (b: boolean): LibValue => ({ type: VariantType.Boolean, value: b });
const date = (d: Date): LibValue => ({ type: VariantType.DateTime, value: d });
const nul: LibValue = { type: VariantType.Null, value: null };

function add(report: Report, alias: string, type: LibParamType, value: LibValue, set?: (p: Param) => void): Param {
  const p = new Param();
  p.alias = alias;
  p.name = alias;
  p.paramType = type;
  p.visible = true;
  p.value = value as Param['value'];
  set?.(p);
  report.params.push(p);
  return p;
}

async function prepare(report: Report): Promise<ReportRun> {
  return prepareReport(report, { device: new PdfDevice(), data: sqliteHost(database) });
}

async function problem(run: ReportRun, values: Record<string, unknown>, designer = false): Promise<ParameterProblem> {
  try {
    await run.applyParameters(values as never, { canEditFreeText: designer });
  } catch (e) {
    if (e instanceof ParameterException) return e.problem;
    throw e;
  }
  throw new Error('No ParameterException');
}

function today(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

describe('describeParameters', () => {
  it('gives the visible parameters with their type, defaults and options', async () => {
    const report = newReport();
    add(report, 'DESDE', LibParamType.InitialValue, str('TODAY'), (p) => (p.descriptions = ['From']));
    add(report, 'OCULTO', LibParamType.String, str('x'), (p) => (p.neverVisible = true));
    add(report, 'EMPRESAS', LibParamType.Multiple, nul, (p) => (p.lookupDataset = 'LKEMPRESAS'));
    add(report, 'ORDEN', LibParamType.Subst, str('ORDER BY 1'));
    const run = await prepare(report);

    const described = await run.describeParameters({ canEditFreeText: false });

    expect(described.map((d) => d.name)).toEqual(['DESDE', 'EMPRESAS', 'ORDEN']);
    const desde = described[0]!;
    expect(desde.type).toBe(ParamType.Date);
    expect(desde.typeName).toBe('Date');
    expect(desde.value).toBe(today());
    expect(desde.description).toBe('From');
    // The lookup dataset's rows are the options, and «all» is the default selection.
    const empresas = described[1]!;
    expect(empresas.options.map((o) => o.text)).toEqual(['Alfa', 'Beta', 'Gamma']);
    expect(empresas.options.map((o) => o.value)).toEqual(['1', '2', '3']);
    expect(empresas.selected).toEqual(['1', '2', '3']);
    expect(empresas.value).toBeNull();
    // A substitution parameter goes into the SQL as text: whoever only runs reports may not change it.
    expect(described[2]!.freeText).toBe(true);
    expect(described[2]!.editable).toBe(false);
    expect((await run.describeParameters({ canEditFreeText: true }))[2]!.editable).toBe(true);
  });

  it('writes the JSON of ASP.NET Core (System.Text.Json, web defaults)', async () => {
    const report = newReport();
    add(report, 'IMPORTE', LibParamType.Currency, dbl(12.5), (p) => {
      p.descriptions = ['Año <fiscal> & "más"'];
      p.hints = ["It's +1"];
    });
    add(report, 'DIA', LibParamType.DateTime, date(new Date(2026, 9, 7, 9, 30, 5)));
    add(report, 'TIPO', LibParamType.List, int(1), (p) => {
      p.items = ['Ventas', 'Compras'];
      p.values = ["'S'", "'B'"];
      p.searchDataset = 'X';
    });
    add(report, 'N', LibParamType.Integer, int(7), (p) => (p.isReadOnly = true));
    add(report, 'D', LibParamType.Double, dbl(0.1), (p) => (p.allowNulls = true));
    const run = await prepare(report);
    const json = await run.describeParametersJson();
    expect(json).toBe(
      '[' +
        '{"name":"IMPORTE","type":6,"typeName":"Currency","description":"A\\u00F1o \\u003Cfiscal\\u003E \\u0026 \\u0022m\\u00E1s\\u0022","hint":"It\\u0027s \\u002B1","errorMessage":"","value":12.5,"allowNulls":false,"readOnly":false,"freeText":false,"editable":true,"options":[],"selected":[],"hasSearch":false},' +
        '{"name":"DIA","type":5,"typeName":"DateTime","description":"","hint":"","errorMessage":"","value":"2026-10-07T09:30:05","allowNulls":false,"readOnly":false,"freeText":false,"editable":true,"options":[],"selected":[],"hasSearch":false},' +
        '{"name":"TIPO","type":11,"typeName":"List","description":"","hint":"","errorMessage":"","value":"\\u0027B\\u0027","allowNulls":false,"readOnly":false,"freeText":false,"editable":true,"options":[{"text":"Ventas","value":"\\u0027S\\u0027"},{"text":"Compras","value":"\\u0027B\\u0027"}],"selected":[],"hasSearch":true},' +
        '{"name":"N","type":1,"typeName":"Integer","description":"","hint":"","errorMessage":"","value":7,"allowNulls":false,"readOnly":true,"freeText":false,"editable":false,"options":[],"selected":[],"hasSearch":false},' +
        '{"name":"D","type":2,"typeName":"Double","description":"","hint":"","errorMessage":"","value":0.1,"allowNulls":true,"readOnly":false,"freeText":false,"editable":true,"options":[],"selected":[],"hasSearch":false}' +
        ']',
    );
  });
});

describe('applyParameters', () => {
  it('converts by type and keeps what is not posted', async () => {
    const report = newReport();
    add(report, 'DESDE', LibParamType.Date, date(new Date(2020, 0, 1)));
    add(report, 'HORA', LibParamType.Time, nul);
    add(report, 'IMPORTE', LibParamType.Currency, dbl(0));
    add(report, 'ID', LibParamType.Integer, int(0));
    add(report, 'ACTIVO', LibParamType.Bool, bool(false));
    add(report, 'EMPRESAS', LibParamType.Multiple, nul, (p) => (p.lookupDataset = 'LKEMPRESAS'));
    add(report, 'TIPO', LibParamType.String, str('fijo'));
    const run = await prepare(report);

    await run.applyParameters({
      desde: '2026-10-07',
      hora: '09:30',
      importe: '12.50',
      id: 9007199254740993n,
      activo: true,
      empresas: ['1', '3'],
    });

    const value = (alias: string) => run.runtime.paramByAlias(alias)!.value;
    expect((value('DESDE').rawValue as RpDateTime).equals(RpDateTime.create(2026, 10, 7))).toBe(true);
    const hora = value('HORA').rawValue as RpDateTime;
    expect([hora.year, hora.month, hora.day, hora.hour, hora.minute, hora.second]).toEqual([1899, 12, 30, 9, 30, 0]);
    expect(value('IMPORTE').varType).toBe(EngineVariantType.Decimal);
    expect((value('IMPORTE').rawValue as CsDecimal).toInvariantString()).toBe('12.50');
    expect(value('ID').varType).toBe(EngineVariantType.Long);
    expect(value('ID').rawValue).toBe(9007199254740993n);
    expect(value('ACTIVO').rawValue).toBe(true);
    expect(value('EMPRESAS').rawValue).toBe('1,3');
    expect(value('TIPO').rawValue).toBe('fijo');
  });

  it('refuses what the form should not have sent', async () => {
    const report = newReport();
    add(report, 'OCULTO', LibParamType.String, str('x'), (p) => (p.neverVisible = true));
    add(report, 'FIJO', LibParamType.String, str('x'), (p) => (p.isReadOnly = true));
    add(report, 'ORDEN', LibParamType.Subst, str('ORDER BY 1'));
    add(report, 'EMPRESAS', LibParamType.Multiple, nul, (p) => (p.lookupDataset = 'LKEMPRESAS'));
    add(report, 'TIPO', LibParamType.List, str("'S'"), (p) => {
      p.items = ['Ventas', 'Compras'];
      p.values = ["'S'", "'B'"];
    });
    add(report, 'DESDE', LibParamType.Date, date(new Date(2020, 0, 1)));
    const run = await prepare(report);

    expect(await problem(run, { OCULTO: 'y' })).toBe(ParameterProblem.Unknown);
    expect(await problem(run, { FIJO: 'y' })).toBe(ParameterProblem.NotEditable);
    expect(await problem(run, { ORDEN: 'ORDER BY 1; DROP TABLE X' })).toBe(ParameterProblem.NotEditable);
    expect(await problem(run, { EMPRESAS: ['1', '4'] })).toBe(ParameterProblem.NotAnOption);
    expect(await problem(run, { TIPO: "'S' OR 1=1" })).toBe(ParameterProblem.NotAnOption);
    expect(await problem(run, { DESDE: '07/10/2026' })).toBe(ParameterProblem.WrongType);
    expect(await problem(run, { DESDE: null })).toBe(ParameterProblem.Required);

    // Whoever designs may change a free-text parameter.
    await run.applyParameters({ ORDEN: 'ORDER BY 2' }, { canEditFreeText: true });
    expect(run.runtime.paramByAlias('ORDEN')!.value.rawValue).toBe('ORDER BY 2');
  });

  it("runs the report's own validation on the new values", async () => {
    const report = newReport();
    add(report, 'IMPORTE', LibParamType.Integer, int(5), (p) => {
      p.validation = 'IMPORTE>10';
      p.errorMessages = ['El importe tiene que ser mayor que 10'];
    });
    const run = await prepare(report);

    let failed: ParameterException | undefined;
    try {
      await run.applyParameters({ IMPORTE: 3 });
    } catch (e) {
      failed = e as ParameterException;
    }
    expect(failed).toBeInstanceOf(ParameterException);
    expect(failed!.problem).toBe(ParameterProblem.Validation);
    expect(failed!.parameter).toBe('IMPORTE');
    expect(failed!.message).toBe('El importe tiene que ser mayor que 10');

    await run.applyParameters({ IMPORTE: 20 });
  });

  it('gives the messages of the C# engine', async () => {
    const report = newReport();
    add(report, 'N', LibParamType.Integer, int(1));
    add(report, 'L', LibParamType.Multiple, nul, (p) => {
      p.items = ['A'];
      p.values = ['1'];
    });
    const run = await prepare(report);
    const message = async (values: Record<string, unknown>) =>
      run.applyParameters(values as never).then(
        () => '',
        (e: Error) => e.message,
      );
    expect(await message({ X: 1 })).toBe('The report has no parameter X to fill in.');
    expect(await message({ N: 1.5 })).toBe('The parameter N needs a whole number.');
    expect(await message({ N: '' })).toBe('The parameter N cannot be empty.');
    expect(await message({ L: 'x' })).toBe('The parameter L needs a list of values.');
    expect(await message({ L: ['2'] })).toBe('«2» is not one of the options of L.');
    expect(await message({ L: [] })).toBe('Choose at least one option of L.');
  });
});

describe('applyDefaults and running', () => {
  it('leaves the values a parameters form would start from', async () => {
    const report = newReport();
    add(report, 'EMPRESAS', LibParamType.Multiple, nul, (p) => (p.lookupDataset = 'LKEMPRESAS'));
    add(report, 'DOBLE', LibParamType.InitialValue, str('2*21'));
    const run = await prepare(report);
    await run.applyDefaults();
    const empresas = run.runtime.paramByAlias('EMPRESAS')!;
    expect(empresas.selected).toEqual(['1', '2', '3']);
    expect(empresas.lastValue.rawValue).toBe('1,2,3');
    const doble = run.runtime.paramByAlias('DOBLE')!;
    expect(doble.paramType).toBe(ParamType.Integer);
    expect(doble.lastValue.rawValue).toBe(42);
  });

  it('says there is nothing to print instead of failing', async () => {
    const report = newReport();
    const empty = new DataInfo();
    empty.alias = 'VACIO';
    empty.name = 'TRPDATAINFOITEM2';
    empty.databaseAlias = 'DATOS';
    empty.sql = 'SELECT ID FROM EMPRESAS WHERE ID < 0';
    report.dataInfo.push(empty);
    report.subReports[0]!.alias = 'VACIO';
    const run = await prepare(report);
    await expect(run.execute()).rejects.toBeInstanceOf(NoDataToPrintException);
    expect(run.metaFile.empty).toBe(true);
  });
});
