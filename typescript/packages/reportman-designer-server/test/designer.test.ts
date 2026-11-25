// The checks of @reportman/designer-server beyond the answers golden-http compares: who may do what
// (the loopback-only default and the checks of DesignerController per operation), the connections
// (only the server's: one it does not define is refused, ADOCONNECTIONSTRING never moves it), the
// paths (never outside the folder of an alias), the ETag of a save, the evaluator over a data host
// that answers asynchronously, and the local schema file of a connection (generated from the
// catalog as the C# engine generates it, its descriptions kept on a refresh).

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { sqlite, type ConnectionFactory } from '@reportman/node';
import type { ServerRequest } from '@reportman/server';
import { createDesignerServer, type DesignerCheck, type DesignerServer, type DesignerServerOptions } from '@reportman/designer-server';

const clock = { now: () => new Date('2026-11-25T12:00:00Z'), offsetMinutes: () => 0 };
const folders: string[] = [];

/** A designer server over a fresh data folder with the sample reports installed. */
async function designerWith(options: Partial<DesignerServerOptions> = {}): Promise<{ designer: DesignerServer; data: string }> {
  const data = fs.mkdtempSync(path.join(os.tmpdir(), 'rm-designer-'));
  folders.push(data);
  const designer = createDesignerServer({ dataPath: data, trusted: true, fonts: false, clock, ...options });
  const installed = await designer.reports.handle({ method: 'POST', path: '/api/console/samples', query: new URLSearchParams(), headers: {} });
  expect(installed.status).toBe(200);
  return { designer, data };
}

afterAll(() => {
  for (const f of folders) fs.rmSync(f, { recursive: true, force: true });
});

function request(method: string, route: string, body?: unknown, remoteAddress = '127.0.0.1'): ServerRequest {
  const q = route.indexOf('?');
  return {
    method,
    path: q < 0 ? route : route.substring(0, q),
    query: new URLSearchParams(q < 0 ? '' : route.substring(q + 1)),
    headers: body === undefined ? {} : { 'content-type': 'application/json' },
    body: body === undefined ? undefined : new TextEncoder().encode(JSON.stringify(body)),
    remoteAddress,
  };
}

async function call(designer: DesignerServer, method: string, route: string, body?: unknown, remoteAddress?: string): Promise<{ status: number; json: Record<string, unknown> }> {
  const reply = await designer.handle(request(method, route, body, remoteAddress));
  return { status: reply.status, json: JSON.parse(new TextDecoder().decode(reply.body)) as Record<string, unknown> };
}

const readReport = (designer: DesignerServer, body: unknown, remote?: string) => call(designer, 'POST', '/api/designer/ReadReport', body, remote);

describe('who may use the designer', () => {
  it('answers only this machine without an authorize function', async () => {
    const { designer } = await designerWith();
    const local = await readReport(designer, { operation: 0, reportName: 'INFORMES/Ejemplos/customers.rep' }, '::1');
    expect(local.json.errorMessage).toBeUndefined();
    expect(local.json.report).toBeDefined();
    for (const remote of ['10.0.0.7', '192.168.1.20', '::ffff:10.0.0.7']) {
      const refused = await readReport(designer, { operation: 0, reportName: 'INFORMES/Ejemplos/customers.rep' }, remote);
      expect(refused.json.errorMessage).toMatch(/answers only this machine/);
      expect(refused.json.report).toBeUndefined();
    }
    // A request whose address is not known is not from this machine
    const unknown = await designer.handle({ ...request('GET', '/api/designer/SqlSchema?alias=SAMPLES'), remoteAddress: undefined });
    expect(unknown.status).toBe(403);
    expect((await call(designer, 'GET', '/api/designer/SqlSchema?alias=SAMPLES', undefined, '10.1.1.1')).status).toBe(403);
    expect((await call(designer, 'GET', '/api/designer/SqlSchema?alias=SAMPLES')).status).toBe(200);
  });

  it('asks the checks of DesignerController for each operation', async () => {
    const asked: DesignerCheck[] = [];
    let allow = true;
    const { designer } = await designerWith({
      authorize: (check) => {
        asked.push(check);
        return allow;
      },
    });
    const opened = await readReport(designer, { operation: 0, reportName: 'INFORMES/Ejemplos/customers.rep' });
    const document = opened.json.report;
    const checksOf = async (method: string, route: string, body?: unknown) => {
      asked.length = 0;
      await call(designer, method, route, body);
      return [...asked];
    };
    const run = { action: 'run', alias: 'INFORMES' };
    const design = (alias: string) => ({ action: 'design', alias });
    const tool = { action: 'designer' };
    // Opening a stored report needs only to run its alias; every other operation is a designer's tool
    expect(await checksOf('POST', '/api/designer/ReadReport', { operation: 0, reportName: 'INFORMES/Ejemplos/customers.rep' })).toEqual([run]);
    expect(await checksOf('POST', '/api/designer/ReadReport', { operation: 0, expression: 'AAAA' })).toEqual([tool]);
    for (const operation of [1, 3, 4, 5, 6, 13]) expect(await checksOf('POST', '/api/designer/ReadReport', { operation, report: document, expression: '1' })).toEqual([tool]);
    expect(await checksOf('POST', '/api/designer/ReadReport', { operation: 11, reportName: 'INFORMES/Ejemplos/customers.rep', expression: 'OTHER/c.rep' })).toEqual([tool, run, design('OTHER')]);
    expect(await checksOf('POST', '/api/designer/ReadReport', { operation: 12, reportName: 'INFORMES/x.rep', expression: 'AAAA' })).toEqual([tool, design('INFORMES')]);
    // Saving needs to design the alias it saves in; the preview of a stored report to run it
    expect(await checksOf('POST', '/api/designer/WriteReport', { reportName: 'INFORMES/Copias/a.rep', report: document })).toEqual([design('INFORMES')]);
    expect(await checksOf('POST', '/api/designer/ExecuteReport', { reportName: 'INFORMES/Ejemplos/customers.rep' })).toEqual([run]);
    expect(await checksOf('POST', '/api/designer/ExecuteReport', { report: document })).toEqual([tool]);
    expect(await checksOf('GET', '/api/designer/SqlSchema?alias=SAMPLES')).toEqual([tool]);
    expect(await checksOf('GET', '/api/designer/agent-schemas')).toEqual([tool]);

    // Refused: an errorMessage in the protocol, 403 in the plain routes, and nothing done
    allow = false;
    expect((await readReport(designer, { operation: 4, report: document, expression: '1+1' })).json).toEqual({ errorMessage: 'Only a designer of reports may do this.' });
    expect((await readReport(designer, { operation: 0, reportName: 'INFORMES/Ejemplos/customers.rep' })).json).toEqual({ errorMessage: "You may not open the reports of 'INFORMES'." });
    expect((await call(designer, 'POST', '/api/designer/WriteReport', { reportName: 'INFORMES/Copias/a.rep', report: document })).json).toEqual({
      errorMessage: "You may not save reports in 'INFORMES'.",
    });
    expect((await call(designer, 'POST', '/api/designer/ExecuteReport', { report: document })).json).toEqual({ noData: false, errorMessage: 'Only a designer of reports may do this.' });
    const schema = await call(designer, 'GET', '/api/designer/SqlSchema?alias=SAMPLES');
    expect(schema).toEqual({ status: 403, json: { error: 'Only a designer of reports may do this.' } });
    allow = true;
  });
});

describe('the connections are the server’s', () => {
  let designer: DesignerServer;
  let data: string;
  let document: Record<string, unknown>;
  beforeAll(async () => {
    ({ designer, data } = await designerWith({ authorize: () => true }));
    document = (await readReport(designer, { operation: 0, reportName: 'INFORMES/Ejemplos/customers.rep' })).json.report as Record<string, unknown>;
  });

  it('never opens what ADOCONNECTIONSTRING or the report connection say', async () => {
    // Another database, with another CUSTOMERS
    const other = path.join(data, 'other.db');
    const db = new DatabaseSync(other);
    db.exec("CREATE TABLE CUSTOMERS (CUSTOMER_ID INTEGER, CODE VARCHAR(8)); INSERT INTO CUSTOMERS VALUES (1, 'OTHER')");
    db.close();
    const changed = structuredClone(document) as { params: Record<string, unknown>[]; databaseInfo: Record<string, unknown>[] };
    for (const name of ['ADOCONNECTIONSTRING', 'SAMPLES_ADOCONNECTIONSTRING'])
      changed.params.push({ name, alias: name, paramType: 0, visible: false, value: { type: 'String', value: 'Data Source=' + other } });
    changed.databaseInfo[0]!.connectionString = 'Data Source=' + other;
    changed.databaseInfo[0]!.providerFactory = 'SQLiteCore';
    const answer = await readReport(designer, { operation: 6, report: changed, datasetName: 'CUST', expression: 'SELECT CODE FROM CUSTOMERS ORDER BY CUSTOMER_ID' });
    expect(answer.json.errorMessage).toBeUndefined();
    const rows = (answer.json.dataSets as { rows: { values: unknown[] }[] }[])[0]!.rows;
    expect(rows[0]!.values).toEqual(['C0001']);
    expect(rows.length).toBeGreaterThan(1);
    // The first record of the report's own SQL, from the server's database
    const value = await readReport(designer, { operation: 4, report: changed, expression: 'CUST.CODE' });
    const unchanged = await readReport(designer, { operation: 4, report: document, expression: 'CUST.CODE' });
    expect(value.json.evaluateResult).toEqual(unchanged.json.evaluateResult);
    expect(value.json.evaluateResult).not.toEqual({ dataType: 'String', value: 'OTHER' });
  });

  it('refuses a connection the server does not define', async () => {
    const changed = structuredClone(document) as { databaseInfo: Record<string, unknown>[]; dataInfo: Record<string, unknown>[] };
    changed.databaseInfo[0]!.alias = 'NOPE';
    changed.dataInfo[0]!.databaseAlias = 'NOPE';
    const dataset = await readReport(designer, { operation: 6, report: changed, datasetName: 'CUST', expression: '' });
    expect(dataset.json.errorMessage).toMatch(/The connection NOPE is not defined/);
    const preview = await call(designer, 'POST', '/api/designer/ExecuteReport', { report: changed });
    expect(preview.json.errorMessage).toMatch(/The connection NOPE is not defined/);
    const evaluated = await readReport(designer, { operation: 4, report: changed, expression: 'CUST.CODE' });
    expect(evaluated.json.errorMessage).toMatch(/The connection NOPE is not defined/);
    // The editor's columns say which dataset failed
    const functions = await readReport(designer, { operation: 3, report: changed });
    expect(functions.json.errorMessage).toMatch(/^CUST: The connection NOPE is not defined/);
    const schema = await call(designer, 'GET', '/api/designer/SqlSchema?alias=NOPE');
    expect(schema.json).toMatchObject({ alias: 'NOPE', kind: 'unknown', error: 'Database alias not found: NOPE' });
  });

  it('evaluates with a data host that answers asynchronously', async () => {
    const file = path.join(data, 'ejemplos', 'samples.db');
    const direct = sqlite(file);
    // Every call of the connection answers a promise, as a network database does
    const later: ConnectionFactory = async (request) => {
      const connection = await direct(request);
      return {
        query: async (command) => connection.query(command),
        close: async (commit) => connection.close(commit),
      };
    };
    const { designer: async } = await designerWith({ authorize: () => true, connections: { SAMPLES: later } });
    // The same answers as with the synchronous driver: qualified, unqualified and unknown fields
    for (const expression of ['CUST.CODE', 'COMPANY_NAME', "CUST.COMPANY_NAME+' '+M.DBPARAM_DRIVERNAME", 'CUST.NOPE', 'NOPE']) {
      const expected = await readReport(designer, { operation: 4, report: document, expression });
      expect(expected.json.evaluateResult ?? expected.json.errorMessage).toBeDefined();
      expect((await readReport(async, { operation: 4, report: document, expression })).json).toEqual(expected.json);
    }
    expect((await readReport(async, { operation: 4, report: document, expression: 'CUST.NOPE' })).json.errorMessage).toMatch(/NOPE/);
    // And the dataset of the SQL editor and the preview
    const dataset = { operation: 6, report: document, datasetName: 'CUST', expression: '' };
    expect((await readReport(async, dataset)).json).toEqual((await readReport(designer, dataset)).json);
    const preview = (await call(async, 'POST', '/api/designer/ExecuteReport', { report: document })).json as { result: { pageCount: number } };
    expect(preview.result.pageCount).toBeGreaterThan(0);
  });
});

describe('the preview', () => {
  it('says noData for a report without records, and names the item of an error', async () => {
    const { designer } = await designerWith({ authorize: () => true });
    const document = (await readReport(designer, { operation: 0, reportName: 'INFORMES/Ejemplos/customers.rep' })).json.report as Record<string, any>;
    const empty = structuredClone(document);
    empty.dataInfo[0].sql = 'SELECT * FROM CUSTOMERS WHERE 1=0';
    const noData = (await call(designer, 'POST', '/api/designer/ExecuteReport', { report: empty })).json;
    expect(noData.noData).toBe(true);
    expect(noData.errorMessage).toMatch(/No data/i);
    expect(noData.result).toBeUndefined();

    const broken = structuredClone(document);
    const item = (broken.subReports[0].sections as any[]).flatMap((s) => s.components).find((c: any) => c.className === 'TRPEXPRESSION');
    item.expression = '1 +* (2';
    const failed = (await call(designer, 'POST', '/api/designer/ExecuteReport', { report: broken })).json;
    expect(failed.noData).toBe(false);
    expect(failed.errorComponentName).toBe(item.name);
    expect(failed.errorComponentProperty).toBe('Expression');
    expect(failed.errorMessage).toMatch(/Parentesis error/);
  });
});

describe('the paths and the versions of the reports', () => {
  it('never leaves the folder of an alias', async () => {
    const { designer } = await designerWith({ authorize: () => true });
    for (const reportName of ['INFORMES/../server.json', 'INFORMES/Ejemplos/../../dbxconnections.ini', 'INFORMES/Ejemplos/.versions/customers.rep', 'INFORMES/./customers.rep']) {
      expect((await readReport(designer, { operation: 0, reportName })).json).toEqual({ errorMessage: 'Invalid report path.' });
      expect((await call(designer, 'POST', '/api/designer/ExecuteReport', { reportName })).json).toEqual({ noData: false, errorMessage: 'Invalid report path.' });
      expect((await readReport(designer, { operation: 11, reportName: 'INFORMES/Ejemplos/customers.rep', expression: reportName })).json).toEqual({ errorMessage: 'Invalid report path.' });
    }
    expect((await readReport(designer, { operation: 0, reportName: 'NOPE/customers.rep' })).json).toEqual({ errorMessage: "Alias 'NOPE' is not configured." });
    expect((await readReport(designer, { operation: 0, reportName: 'customers.rep' })).json).toEqual({ errorMessage: 'The report name must be ALIAS/path.rep' });
  });

  it('does not overwrite a report that exists without its ETag', async () => {
    const { designer } = await designerWith({ authorize: () => true });
    const first = await readReport(designer, { operation: 11, reportName: 'INFORMES/Ejemplos/customers.rep', expression: 'INFORMES/Copias/c.rep' });
    expect(first.json).toEqual({});
    const again = await readReport(designer, { operation: 11, reportName: 'INFORMES/Ejemplos/labels.rep', expression: 'INFORMES/Copias/c.rep' });
    expect(again.json).toEqual({ errorMessage: "'Copias/c.rep' was modified by someone else; reload it before saving." });
    // The copy is the customers report, with its own ETag
    const copy = await readReport(designer, { operation: 0, reportName: 'INFORMES/Copias/c.rep' });
    const original = await readReport(designer, { operation: 0, reportName: 'INFORMES/Ejemplos/customers.rep' });
    expect(copy.json.eTag).toBe(original.json.eTag);
    expect(copy.json.report).toEqual(original.json.report);
  });

  it('saves with the ETag the report was opened with, and refuses a stale one', async () => {
    const { designer, data } = await designerWith({ authorize: () => true });
    const write = (body: unknown) => call(designer, 'POST', '/api/designer/WriteReport', body);
    const opened = await readReport(designer, { operation: 0, reportName: 'INFORMES/Ejemplos/customers.rep' });
    const document = opened.json.report as Record<string, any>;
    // A name that does not exist yet is created, with or without an ETag
    const created = await write({ reportName: 'INFORMES/Nuevos/a.rep', report: document, properties: [{ name: 'eTag', value: 'whatever' }] });
    expect(created.json.errorMessage).toBeUndefined();
    expect(fs.existsSync(path.join(data, 'informes', 'Nuevos', 'a.rep'))).toBe(true);
    const tag = created.json.eTag as string;
    const firstRead = await readReport(designer, { operation: 0, reportName: 'INFORMES/Nuevos/a.rep' });
    expect(firstRead.json.eTag).toBe(tag);

    // With the ETag it was opened with (the property's name in any case): saved, the old version kept
    const changed = structuredClone(document);
    changed.subReports[0].sections[0].height += 10;
    const saved = await write({ reportName: 'INFORMES/Nuevos/a.rep', report: changed, properties: [{ Name: 'ETAG', Value: tag }] });
    expect(saved.json.errorMessage).toBeUndefined();
    expect(saved.json.eTag).not.toBe(tag);
    expect(fs.readdirSync(path.join(data, 'informes', 'Nuevos', '.versions')).length).toBe(1);
    // The one it had is stale now: someone else saved it
    const stale = await write({ reportName: 'INFORMES/Nuevos/a.rep', report: document, properties: [{ name: 'eTag', value: tag }] });
    expect(stale.json).toEqual({ errorMessage: "'Nuevos/a.rep' was modified by someone else; reload it before saving." });
    // Without an ETag: over the current version
    const current = await write({ reportName: 'INFORMES/Nuevos/a.rep', report: document });
    expect(current.json.errorMessage).toBeUndefined();
    // The same document as the first save (a save leaves out the empty texts, as C# does)
    expect((await readReport(designer, { operation: 0, reportName: 'INFORMES/Nuevos/a.rep' })).json.report).toEqual(firstRead.json.report);
    // Never outside the alias, never into the kept versions
    for (const reportName of ['INFORMES/../x.rep', 'INFORMES/Nuevos/.versions/a.rep'])
      expect((await write({ reportName, report: document })).json).toEqual({ errorMessage: 'Invalid report path.' });
  });

  it('saves the undo history without what is older than four years', async () => {
    const { designer } = await designerWith({ authorize: () => true });
    const document = (await readReport(designer, { operation: 0, reportName: 'INFORMES/Ejemplos/labels.rep' })).json.report as Record<string, any>;
    const operation = (date: string, componentName: string) => ({ operation: 0, groupId: 1, componentName, componentClass: 'TRPLABEL', date, properties: [] });
    // The clock of the server is on 2026-11-25: four years before is 2022-11-25
    document.undoCue = {
      groupId: 1,
      undoOperations: [operation('2021-06-01T10:00:00Z', 'OLD'), operation('2022-11-26T10:00:00Z', 'RECENT')],
      redoOperations: [operation('2020-01-01T10:00:00Z', 'OLDREDO'), operation('2026-11-24T10:00:00Z', 'NEWREDO')],
    };
    const saved = await call(designer, 'POST', '/api/designer/WriteReport', { reportName: 'INFORMES/Copias/undo.rep', report: document });
    expect(saved.json.errorMessage).toBeUndefined();
    const read = (await readReport(designer, { operation: 0, reportName: 'INFORMES/Copias/undo.rep' })).json.report as Record<string, any>;
    expect(read.undoCue.undoOperations.map((o: { componentName: string }) => o.componentName)).toEqual(['RECENT']);
    expect(read.undoCue.redoOperations.map((o: { componentName: string }) => o.componentName)).toEqual(['NEWREDO']);
  });
});

describe('the local schema of a connection', () => {
  it('is generated from the catalog as the C# engine generates it, and a refresh keeps what people wrote', async () => {
    const { designer, data } = await designerWith({ authorize: () => true });
    const file = path.join(data, 'dbxschemas', 'SAMPLES.json');
    const shipped = JSON.parse(fs.readFileSync(file, 'utf8')) as { tables: { name: string; columns: Record<string, unknown>[]; foreignKeys: Record<string, unknown>[] }[] };
    const withFile = (await call(designer, 'GET', '/api/designer/SqlSchema?alias=SAMPLES')).json;
    expect(withFile.source).toBe('file');

    // Without the file: generated from the catalog, the tables, types and keys the shipped one has
    fs.rmSync(file);
    const generated = (await call(designer, 'GET', '/api/designer/SqlSchema?alias=samples')).json as { schemaTables: { name: string; context: string; columns: Record<string, unknown>[]; foreignKeys: Record<string, unknown>[] }[]; schemas: unknown[]; dialect: string; source: string };
    expect(fs.existsSync(file)).toBe(true);
    expect(generated.source).toBe('file');
    expect(generated.dialect).toBe('SQLite');
    expect(generated.schemas).toEqual([]);
    const design = (t: { name: string; columns: Record<string, unknown>[]; foreignKeys: Record<string, unknown>[] }) => ({
      name: t.name,
      columns: t.columns.map((c) => ({ name: c.name, dataType: c.dataType, isPrimaryKey: c.isPrimaryKey, detectedType: c.detectedType })),
      foreignKeys: t.foreignKeys.map((fk) => ({ constraintName: fk.constraintName, targetTable: fk.targetTable, sourceColumns: fk.sourceColumns, targetColumns: fk.targetColumns })),
    });
    // In the order of sqlite_master ORDER BY name (binary: ORDERS before ORDER_LINES), as the C#
    // engine reads them; the shipped file has another one
    const names = generated.schemaTables.map((t) => t.name);
    expect(names).toEqual([...names].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0)));
    const byName = (list: ReturnType<typeof design>[]) => Object.fromEntries(list.map((t) => [t.name, t]));
    expect(byName(generated.schemaTables.map(design))).toEqual(byName(shipped.tables.map(design)));
    expect(generated.schemaTables.every((t) => t.context === '')).toBe(true);
    const written = JSON.parse(fs.readFileSync(file, 'utf8')) as { version: number; alias: string; dialect: string; generatedUtc: string };
    expect(written).toMatchObject({ version: 2, alias: 'SAMPLES', dialect: 'SQLite', generatedUtc: '2026-11-25T12:00:00Z' });

    // What people write is kept when the catalog is read again
    const edited = JSON.parse(fs.readFileSync(file, 'utf8')) as Record<string, any>;
    edited.tables[0].context = 'The categories of the products.';
    edited.tables[0].columns[1].context = 'Its name.';
    edited.tables[0].columns[1].allowedValues = [{ value: 'A', label: 'The first' }];
    edited.tables[0].futureMember = { kept: true };
    edited.schemas = [{ name: 'Mine', description: 'Some tables', tables: ['CATEGORIES', 'NOPE'], columns: { CATEGORIES: ['NAME', 'GONE'] } }];
    fs.writeFileSync(file, JSON.stringify(edited));
    const refreshed = (await call(designer, 'GET', '/api/designer/SqlSchema?alias=SAMPLES&refresh=true')).json as Record<string, any>;
    expect(refreshed.schemaTables[0].context).toBe('The categories of the products.');
    expect(refreshed.schemaTables[0].columns[1]).toMatchObject({ context: 'Its name.', allowedValues: [{ value: 'A', label: 'The first' }] });
    expect(refreshed.schemas).toEqual([{ name: 'Mine', description: 'Some tables', tables: ['CATEGORIES'], columns: { CATEGORIES: ['NAME'] }, excludedRelations: null }]);
    expect((JSON.parse(fs.readFileSync(file, 'utf8')) as Record<string, any>).tables[0].futureMember).toEqual({ kept: true });
  });

  it('answers the shape of Reportman.Server for an Agent connection and for a connection that does not open', async () => {
    const { designer, data } = await designerWith({ authorize: () => true });
    fs.appendFileSync(path.join(data, 'dbxconnections.ini'), '\n[CLOUD]\nDriverName=Reportman AI Agent\nHubDatabaseId=42\n\n[BROKEN]\nDriverName=ADO.NET\nProviderFactory=SQLiteCore\nParam.DataSource=nowhere/none.db\nParam.Mode=ReadOnly\n');
    const agent = (await call(designer, 'GET', '/api/designer/SqlSchema?alias=CLOUD')).json;
    expect(agent).toEqual({
      alias: 'CLOUD',
      kind: 'agent',
      dialect: 'Default',
      hubDatabaseId: 42,
      hubSchemaId: null,
      schemaTables: [],
      schemas: [],
      excludedRelations: null,
      error: 'This server cannot read the schema of Agent connections (it has no Reportman AI)',
      source: 'hub',
    });
    const broken = (await call(designer, 'GET', '/api/designer/SqlSchema?alias=BROKEN')).json;
    expect(broken).toMatchObject({ alias: 'BROKEN', kind: 'direct', dialect: 'Default', schemaTables: [], source: 'file' });
    expect(broken.error).toMatch(/^BROKEN: /);
  });
});
