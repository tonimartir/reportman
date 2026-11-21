// The cases of the tests (cases.json), a run of a report the way golden-cs runs it (parameter values
// assigned as strings, as golden-cs --param sets Param.Value = "7", then every page laid out), and
// the comparisons with what golden-cs gives: the cells golden-cs sql writes, the metafile JSON and
// the statements in the general log of the server.

import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import mysql2 from 'mysql2';
import { expect } from 'vitest';
import { readReportXml } from 'reportman-lib';
import type { MetaFile } from 'reportman-metafile';
import { PdfDevice } from 'reportman-pdf';
import {
  CsDecimal,
  type DataHost,
  type DataValue,
  type EvalHost,
  NoDataToPrintException,
  prepareReport,
  RpDateTime,
  type ReportRun,
} from 'reportman-engine';
import { metaFileJson } from '../../reportman-engine/test/golden-run.js';
import { mysqlTest } from './database.js';

export const here = path.dirname(fileURLToPath(import.meta.url));
export const runFixtures = path.join(here, 'fixtures/run');
export const sqlFixtures = path.join(here, 'fixtures/sql');
export const goldenExe = path.resolve(here, '../../../tools/golden-cs/bin/Release/net10.0/golden-cs.exe');

export interface ReportCase {
  name: string;
  /** The report the TypeScript engine runs. */
  report: string;
  /** The report golden-cs runs, when it is another (a connection per dataset). */
  golden?: string;
  /** The report connections of `golden` beyond SAMPLES. */
  connections?: string[];
  params?: Record<string, string>;
  culture?: string;
  /**
   * Both engines fail, with other errors: the text the C# error contains, the one of the TypeScript
   * engine, and why (a limitation of MySqlConnector or of this driver, not reproduced on purpose).
   */
  knownDifference?: { error: string; tsError: string; why: string };
}

export interface QueryCase {
  name: string;
  sql: string;
  /** Options appended to the connection string. */
  options?: string;
}

export function cases(): { reports: ReportCase[]; queries: QueryCase[] } {
  return JSON.parse(fs.readFileSync(path.join(here, 'cases.json'), 'utf8')) as { reports: ReportCase[]; queries: QueryCase[] };
}

export interface RunResult {
  run: ReportRun;
  meta: MetaFile;
  noData: boolean;
}

/**
 * Runs a report as golden-cs does. The caller closes the run (its connections commit); a run that
 * fails is closed here.
 */
export async function runLikeGolden(
  reportFile: string,
  data: DataHost,
  options: { params?: Record<string, string>; culture?: string; now?: RpDateTime } = {},
): Promise<RunResult> {
  const model = readReportXml(new Uint8Array(fs.readFileSync(reportFile)));
  const now = options.now;
  const evalHost: EvalHost = {
    now: () => now ?? RpDateTime.fromJsDate(new Date()),
    fileExists: () => false,
  };
  const run = await prepareReport(model, {
    device: new PdfDevice(),
    data,
    culture: options.culture ?? 'en-US',
    host: evalHost,
  });
  try {
    for (const [k, v] of Object.entries(options.params ?? {})) run.setParameterValue(k, v);
    const meta = run.metaFile;
    try {
      await run.begin();
    } catch (e) {
      // PrintOut.PreparePrint: no data to print is not an error of the device
      if (e instanceof NoDataToPrintException) return { run, meta, noData: true };
      throw e;
    }
    await run.requestPage(2147483647);
    return { run, meta, noData: false };
  } catch (e) {
    await run.close();
    throw e;
  }
}

/** The error golden-cs prints: its .NET type and message (without the stack trace, lines in \n). */
export function goldenError(output: string): { error: string; message: string } {
  const text = output.replace(/\r\n/g, '\n');
  const m = /^ERROR ([\w.]+): ([\s\S]*?)(?=\n {3}at |\s*$)/.exec(text);
  if (m === null) return { error: 'unknown', message: text.trim() };
  return { error: m[1]!.split('.').pop()!, message: m[2]! };
}

/** What golden-cs sql writes: the schema and the cells, or the error. */
export interface GoldenSql {
  columns?: { columnName: string; dataType: string; columnSize: number | null; dataTypeName: string | null }[];
  rows?: unknown[][];
  error?: string;
  message?: string;
}

/** Runs golden-cs sql (the C# engine's view of a query). */
export function goldenSql(connection: string, sql: string, out: string): GoldenSql {
  if (fs.existsSync(out)) fs.unlinkSync(out);
  const r = spawnSync(goldenExe, ['sql', connection, sql, out], { encoding: 'utf8' });
  if (r.status !== 0) return goldenError(r.stderr || r.stdout);
  return JSON.parse(fs.readFileSync(out, 'utf8')) as GoldenSql;
}

/** A golden-cs cell ("Int32:1", "12.34", an ISO date, base64) against a value of the driver. */
export function expectCell(dataType: string, golden: unknown, mine: DataValue, where: string): void {
  if (golden === null) {
    expect(mine, where).toBeNull();
    return;
  }
  const g = golden as string;
  const typed = (prefix: string): string => {
    expect(g.startsWith(prefix + ':'), where + ' ' + g).toBe(true);
    return g.substring(prefix.length + 1);
  };
  switch (dataType) {
    case 'Decimal':
      expect(mine, where).toBeInstanceOf(CsDecimal);
      expect((mine as CsDecimal).toInvariantString(), where).toBe(g);
      return;
    case 'UInt64':
      // Variant.AssignFromObject: a Decimal
      expect(mine, where).toBeInstanceOf(CsDecimal);
      expect((mine as CsDecimal).toInvariantString(), where).toBe(typed('UInt64'));
      return;
    case 'DateTime':
      expect(mine, where).toBeInstanceOf(RpDateTime);
      expect((mine as RpDateTime).toString(), where).toBe(g);
      return;
    case 'Byte[]':
      expect(mine, where).toBeInstanceOf(Uint8Array);
      expect(Buffer.from(mine as Uint8Array).toString('base64'), where).toBe(g);
      return;
    case 'String':
      expect(mine, where).toBe(typed('String'));
      return;
    case 'Single':
      expect(mine, where).toBe(Math.fround(Number.parseFloat(typed('Single'))));
      return;
    case 'Double': {
      const v = Number.parseFloat(typed('Double'));
      if (Number.isNaN(v)) expect(Number.isNaN(mine as number), where).toBe(true);
      else expect(mine === v, where + ' ' + String(mine)).toBe(true);
      return;
    }
    case 'Int16':
    case 'Int32':
    case 'Byte':
      expect(mine, where).toBe(Number(typed(dataType)));
      return;
    case 'Int64':
    case 'SByte':
    case 'UInt16':
    case 'UInt32':
      // Variant.AssignFromObject: a Long
      expect(mine, where).toBe(BigInt(typed(dataType)));
      return;
    case 'Boolean':
      expect(mine, where).toBe(typed('Boolean') === 'True');
      return;
    default:
      // Guid, TimeSpan, MySqlDateTime, ReadOnlyMemory`1: their text
      expect(mine, where).toBe(typed(dataType));
  }
}

/** The metafile of a run against the JSON golden-cs wrote. */
export function expectSameMetafile(meta: MetaFile, csJson: { pages: { objects: unknown[] }[] } & Record<string, unknown>): void {
  const ts = metaFileJson(meta) as typeof csJson;
  const { pages: tsPages, ...tsHead } = ts;
  const { pages: csPages, ...csHead } = csJson;
  expect(tsHead).toEqual(csHead);
  expect(tsPages.length).toBe(csPages.length);
  for (let i = 0; i < csPages.length; i++) {
    const { objects: tsObjects, ...tsPage } = tsPages[i]! as { objects: unknown[] };
    const { objects: csObjects, ...csPage } = csPages[i]! as { objects: unknown[] };
    expect(tsPage, `page ${i + 1}`).toEqual(csPage);
    const n = Math.max(tsObjects.length, csObjects.length);
    for (let j = 0; j < n; j++) expect(tsObjects[j], `page ${i + 1} object ${j}`).toEqual(csObjects[j]);
  }
}

// ---------------------------------------------------------------------------------------------
// The general log of the server, read as root: the statements the clients sent

/** A statement of the log: its text, or its bytes when they are not UTF-8. */
export type LoggedStatement = string | { base64: string };

export interface GeneralLog {
  truncate(): Promise<void>;
  /** The Query entries of the other connections since the last truncate, in order. */
  statements(): Promise<LoggedStatement[]>;
  close(): Promise<void>;
}

/** The general log as a table (RM_MYSQL_ROOT_PASSWORD, rmtest_root by default); undefined without root. */
export async function openGeneralLog(): Promise<GeneralLog | undefined> {
  let c: mysql2.Connection;
  try {
    c = await new Promise<mysql2.Connection>((resolve, reject) => {
      const conn = mysql2.createConnection({
        host: mysqlTest.host,
        port: mysqlTest.port,
        user: 'root',
        password: process.env.RM_MYSQL_ROOT_PASSWORD ?? 'rmtest_root',
        charset: 'UTF8MB4_GENERAL_CI',
        connectTimeout: 5000,
      });
      conn.on('error', () => undefined);
      conn.connect((err) => (err ? reject(err) : resolve(conn)));
    });
  } catch {
    return undefined;
  }
  const q = <T>(sql: string): Promise<T> => new Promise((resolve, reject) => c.query(sql, (err, rows) => (err ? reject(err) : resolve(rows as T))));
  const id = (await q<{ ID: number }[]>('SELECT CONNECTION_ID() AS ID'))[0]!.ID;
  await q("SET GLOBAL log_output = 'TABLE'");
  await q('SET GLOBAL general_log = 1');
  return {
    async truncate() {
      await q('TRUNCATE TABLE mysql.general_log');
    },
    async statements() {
      const rows = await q<{ argument: Buffer | string }[]>(
        `SELECT argument FROM mysql.general_log WHERE command_type = 'Query' AND thread_id <> ${id} ORDER BY event_time`,
      );
      return rows.map((r) => {
        const raw = Buffer.isBuffer(r.argument) ? r.argument : Buffer.from(r.argument, 'utf8');
        const text = raw.toString('utf8');
        return Buffer.from(text, 'utf8').equals(raw) ? text : { base64: raw.toString('base64') };
      });
    },
    async close() {
      await q('SET GLOBAL general_log = 0');
      await new Promise<void>((resolve) => c.end(() => resolve()));
    },
  };
}

const SESSION = /^(SET NAMES |set session transaction isolation level |start transaction|commit$|rollback$)/;

/** The statements of the datasets (without the session and transaction statements). */
export function datasetStatements(statements: readonly LoggedStatement[]): LoggedStatement[] {
  return statements.filter((s) => typeof s !== 'string' || !SESSION.test(s));
}

/**
 * The statements with each consecutive repetition once. MySqlConnector hands out the same
 * MySqlDataReader for every command of a connection, so when a detail dataset is executed again for
 * its master (DataInfo.OnDataChange), ReportDataset.CurrentReader = the same object does not load
 * it, and the C# engine opens it once more with the same values: the statement goes twice. The
 * TypeScript engine gets a new result each time, and runs again only what C# runs again for an
 * empty detail: the two are compared with consecutive repetitions once.
 */
export function withoutRepetitions(statements: readonly LoggedStatement[]): LoggedStatement[] {
  return statements.filter((s, i) => i === 0 || JSON.stringify(s) !== JSON.stringify(statements[i - 1]));
}

/** Runs a statement as root (undefined without root): what a test needs of the server's state. */
export async function asRoot(sql: string): Promise<unknown> {
  let c: mysql2.Connection;
  try {
    c = await new Promise<mysql2.Connection>((resolve, reject) => {
      const conn = mysql2.createConnection({
        host: mysqlTest.host,
        port: mysqlTest.port,
        user: 'root',
        password: process.env.RM_MYSQL_ROOT_PASSWORD ?? 'rmtest_root',
        connectTimeout: 5000,
      });
      conn.on('error', () => undefined);
      conn.connect((err) => (err ? reject(err) : resolve(conn)));
    });
  } catch {
    return undefined;
  }
  try {
    return await new Promise((resolve, reject) => c.query(sql, (err, rows) => (err ? reject(err) : resolve(rows ?? true))));
  } finally {
    c.end();
  }
}
