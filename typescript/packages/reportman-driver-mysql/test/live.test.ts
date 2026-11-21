// The driver against golden-cs run now, on whatever server RM_MYSQL_* point at: the check of a server
// the fixtures were not made with (MariaDB: RM_MYSQL_PORT=53307 for reportman-mariadb-test). It runs
// with RM_MYSQL_LIVE=1 and golden-cs built, on a server other than the one of fixtures/server.json;
// otherwise it is skipped.
//
//   RM_MYSQL_LIVE=1 RM_MYSQL_PORT=53307 npx vitest run packages/reportman-driver-mysql

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { CultureInfo, type ConnectionRequest, type DataConnection, type QueryResult } from 'reportman-engine';
import { createDataHost, openReport } from 'reportman-node';
import { mysql, type MySqlColumnInfo } from 'reportman-driver-mysql';
import { pdfCreation } from '../../reportman-engine/test/golden-run.js';
import { connectionString, isReachable, loadDatabase, serverVersion } from './database.js';
import {
  cases,
  datasetStatements,
  expectCell,
  expectSameMetafile,
  type GeneralLog,
  goldenError,
  goldenExe,
  goldenSql,
  here,
  openGeneralLog,
  runLikeGolden,
  withoutRepetitions,
} from './golden.js';

// (on the server of the fixtures mysql.test.ts makes these comparisons; the two would share the
// general log of the server)
const fixtureServer = (JSON.parse(fs.readFileSync(path.join(here, 'fixtures/server.json'), 'utf8')) as { version: string }).version;
const reachable = process.env.RM_MYSQL_LIVE === '1' && fs.existsSync(goldenExe) && (await isReachable());
const version = reachable ? await serverVersion() : '';
const live = reachable && version !== fixtureServer;
if (live) await loadDatabase();
const scratch = live ? fs.mkdtempSync(path.join(os.tmpdir(), 'rm-mysql-live-')) : '';
const provider = 'MySQLConnector';
const { reports, queries } = cases();

function request(): ConnectionRequest {
  return {
    database: {} as ConnectionRequest['database'],
    alias: 'SAMPLES',
    connectionString: '',
    providerFactory: provider,
    engineSqlite: false,
    dbParam: () => '',
    isolationLevel: 'RepeatableRead',
  };
}

describe.skipIf(!live)(`live parity with golden-cs on ${version}`, () => {
  let log: GeneralLog | undefined;
  beforeAll(async () => {
    log = await openGeneralLog();
  });
  afterAll(async () => {
    await log?.close();
  });

  it.each(queries)('reads $name as MySqlConnector', async (q) => {
    const golden = goldenSql(provider + '|' + connectionString(q.options ?? ''), q.sql, path.join(scratch, q.name + '.json'));
    let factory: ReturnType<typeof mysql>;
    try {
      factory = mysql({ connectionString: connectionString(q.options ?? ''), culture: CultureInfo.invariant });
    } catch (e) {
      expect({ error: (e as { netType?: string }).netType, message: (e as Error).message }).toEqual({ error: golden.error, message: golden.message });
      return;
    }
    let connection: DataConnection;
    try {
      connection = await factory(request());
    } catch (e) {
      expect({ error: (e as { netType?: string }).netType, message: (e as Error).message }).toEqual({ error: golden.error, message: golden.message });
      return;
    }
    try {
      let r: QueryResult;
      try {
        r = await connection.query({ sql: q.sql, parameters: [], inTransaction: true, dataset: 'T' });
      } catch (e) {
        expect({ error: (e as { netType?: string }).netType, message: (e as Error).message }).toEqual({ error: golden.error, message: golden.message });
        return;
      }
      expect(golden.error, golden.message).toBeUndefined();
      expect(
        r.columns.map((c) => ({ columnName: c.name, dataType: (c as MySqlColumnInfo).netType, columnSize: c.size ?? null, dataTypeName: c.declaredType ?? null })),
      ).toEqual(golden.columns);
      expect(r.rows.length).toBe(golden.rows!.length);
      golden.rows!.forEach((row, i) =>
        row.forEach((cell, j) => expectCell(golden.columns![j]!.dataType, cell, r.rows[i]![j]!, `${golden.columns![j]!.columnName} row ${i + 1}`)),
      );
    } finally {
      await connection.close(true);
    }
  });

  it.each(reports)('runs $name as the C# engine', async (c) => {
    const meta = path.join(scratch, c.name + '.meta.json');
    const pdf = path.join(scratch, c.name + '.cs.pdf');
    for (const f of [meta, pdf]) if (fs.existsSync(f)) fs.unlinkSync(f);
    const args = ['run', path.resolve(here, c.golden ?? c.report), meta, '--pdf', pdf];
    for (const alias of ['SAMPLES', ...(c.connections ?? [])]) args.push('--connection', alias + '=' + provider + '|' + connectionString());
    for (const [k, v] of Object.entries(c.params ?? {})) args.push('--param', k + '=' + v);
    if (c.culture !== undefined) args.push('--culture', c.culture);
    await log?.truncate();
    const r = spawnSync(goldenExe, args, { encoding: 'utf8' });
    const csStatements = log === undefined ? undefined : await log.statements();
    const connections = { SAMPLES: mysql(connectionString()) };
    const reportFile = path.resolve(here, c.report);
    if (r.status !== 0) {
      const expected = goldenError(r.stderr || r.stdout);
      const run = runLikeGolden(reportFile, createDataHost({ connections }), { params: c.params, culture: c.culture });
      const error = await run.then(
        async (x) => {
          await x.run.close();
          return null;
        },
        (e: unknown) => (e as Error).message,
      );
      expect(error?.split('\n')[0]).toBe(expected.message.split('\n')[0]);
      return;
    }
    const csPdf = new Uint8Array(fs.readFileSync(pdf));
    const csJson = JSON.parse(fs.readFileSync(meta, 'utf8')) as { pages: { objects: unknown[] }[] } & Record<string, unknown>;
    const { clock, now } = pdfCreation(csPdf);
    await log?.truncate();
    const { run, meta: tsMeta } = await runLikeGolden(reportFile, createDataHost({ connections }), { params: c.params, culture: c.culture, now });
    try {
      expectSameMetafile(tsMeta, csJson);
    } finally {
      await run.close();
    }
    if (log !== undefined && csStatements !== undefined) {
      const mine = await log.statements();
      if (c.connections !== undefined) expect(withoutRepetitions(datasetStatements(mine))).toEqual(withoutRepetitions(datasetStatements(csStatements)));
      else expect(mine).toEqual(csStatements);
    }
    const report = await openReport(reportFile, { connections, clock, culture: c.culture });
    const tsPdf = await report.executeToPdf(c.params ?? {}, { compressed: false });
    expect(Buffer.compare(Buffer.from(tsPdf), Buffer.from(csPdf))).toBe(0);
  });
});

describe.skipIf(live)('without RM_MYSQL_LIVE', () => {
  it('skips the live comparison', () => {
    expect(live).toBe(false);
  });
});
