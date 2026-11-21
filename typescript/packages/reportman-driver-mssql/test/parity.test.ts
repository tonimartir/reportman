// Run parity with the C# engine on SQL Server: each case of cases.ts runs through openReport with
// the mssql() connections and gives the metafile and the PDF bytes golden-cs gave with
// Microsoft.Data.SqlClient (fixtures/run, written by generate-fixtures.ts), or fails with the same
// error, and sends the server the same statements (traced with Extended Events, trace.ts).

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { openReport, type OpenReportOptions } from 'reportman-node';
import { metaFileJson, pdfCreation } from '../../reportman-engine/test/golden-run.js';
import { mssql } from '../src/index.js';
import { CASES, type ReportCase, fixtures, reportFile } from './cases.ts';
import { connectionString, isReachable, loadDatabase } from './database.ts';
import { startTrace, traceApp, tracedStatements } from './trace.ts';

const runDir = path.join(fixtures, 'run');
const available = await isReachable();
if (available) {
  await loadDatabase();
  await startTrace();
}
const stamp = Date.now().toString(36);

/** The options of the TypeScript run of a case: every report connection on the test server. */
function runOptions(c: ReportCase, app: string, extra: OpenReportOptions = {}): OpenReportOptions {
  const factory = mssql({ connectionString: connectionString('Application Name=' + app), culture: c.culture, synchronous: c.synchronous });
  const connections = Object.fromEntries(['SAMPLES', ...(c.connections ?? [])].map((alias) => [alias, factory]));
  return { connections, culture: c.culture, ...extra };
}

function readJson<T>(file: string): T {
  return JSON.parse(fs.readFileSync(file, 'utf8')) as T;
}

describe.skipIf(!available)('SQL Server run parity with golden-cs (Microsoft.Data.SqlClient 6.1)', () => {
  for (const c of CASES) {
    const errorFile = path.join(runDir, c.name + '.error.json');
    const statementsFile = path.join(runDir, c.name + '.statements.json');
    const file = reportFile(c.report);
    if (c.knownDifference !== undefined) {
      const known = c.knownDifference;
      it(`${c.name}: C# fails (${known.error})${known.tsError === undefined ? ', the TypeScript engine runs it' : ''}`, async () => {
        expect(readJson<{ message: string }>(errorFile).message).toContain(known.error);
        const report = await openReport(file, runOptions(c, traceApp('ts-' + c.name + '-' + stamp)));
        const run = report.executeToPdf(c.values ?? null, { compressed: false });
        if (known.tsError !== undefined) await expect(run).rejects.toThrow(known.tsError);
        else expect(Buffer.from((await run).subarray(0, 5)).toString('latin1')).toBe('%PDF-');
      });
      continue;
    }
    if (fs.existsSync(errorFile)) {
      it(`${c.name}: fails as C# does`, async () => {
        const expected = readJson<{ error: string; message: string }>(errorFile);
        const app = traceApp('ts-' + c.name + '-' + stamp);
        const report = await openReport(file, runOptions(c, app));
        const error = await report.executeToPdf(c.values ?? null, { compressed: false }).then(
          () => new Error('no error'),
          (e: unknown) => e as Error & { netType?: string },
        );
        expect((error as { netType?: string }).netType ?? error.name).toBe(expected.error);
        expect(error.message.replace(/\r\n/g, '\n')).toBe(expected.message);
        if (c.statements !== false) expect(await tracedStatements(app)).toEqual(readJson(statementsFile));
      });
      continue;
    }
    describe(c.name, () => {
      const csPdf = new Uint8Array(fs.readFileSync(path.join(runDir, c.name + '.cs.pdf')));
      const csJson = readJson<{ pages: { objects: unknown[] }[] } & Record<string, unknown>>(path.join(runDir, c.name + '.meta.json'));
      const { clock } = pdfCreation(csPdf);

      // (the xml values have Environment.NewLine: the fixtures are the Windows one; types.test.ts
      // checks the values on every system)
      it.skipIf(c.newLineInValues === true && os.EOL !== '\r\n')('lays out the same metafile as C#', async () => {
        const report = await openReport(file, runOptions(c, traceApp('ts-meta-' + c.name + '-' + stamp), { clock }));
        const ts = metaFileJson(await report.executeToMetafile(c.values ?? null)) as typeof csJson;
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
      });

      it('writes the same PDF bytes as C#, sending the same statements', async () => {
        const app = traceApp('ts-' + c.name + '-' + stamp);
        const report = await openReport(file, runOptions(c, app, { clock }));
        const pdf = await report.executeToPdf(c.values ?? null, { compressed: false });
        if (Buffer.compare(Buffer.from(pdf), Buffer.from(csPdf)) !== 0) fs.writeFileSync(path.join(os.tmpdir(), 'rm-mssql-' + c.name + '.ts.pdf'), pdf);
        expect(Buffer.compare(Buffer.from(pdf), Buffer.from(csPdf))).toBe(0);
        if (c.statements !== false) expect(await tracedStatements(app)).toEqual(readJson(statementsFile));
      });
    });
  }
});
