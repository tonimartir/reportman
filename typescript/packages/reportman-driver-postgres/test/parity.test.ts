// Run parity with the C# engine on PostgreSQL: each case of cases.ts runs through openReport with
// the postgres() connections and gives the metafile and the PDF bytes golden-cs gave with Npgsql
// (fixtures/, written by generate-fixtures.ts), or fails with the same error.

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { openReport, type OpenReportOptions } from 'reportman-node';
import { metaFileJson, pdfCreation } from '../../reportman-engine/test/golden-run.js';
import { postgres } from '../src/index.js';
import { CASES, type PgCase } from './cases.ts';
import { loadFixture, repoRoot, serverAvailable, testConfig } from './fixture.ts';

const here = path.dirname(fileURLToPath(import.meta.url));
const fixtures = path.join(here, 'fixtures');

const available = await serverAvailable();
if (available) await loadFixture();

function reportFile(c: PgCase): string {
  return c.report.startsWith('synthetic:') ? path.join(fixtures, c.report.substring(10) + '.rep') : path.join(repoRoot, c.report);
}

/** The options of the TypeScript run of a case: every report connection on the test server. */
function runOptions(c: PgCase, extra: OpenReportOptions = {}): OpenReportOptions {
  const factory = postgres({ ...testConfig(), culture: c.culture, synchronous: c.synchronous });
  const connections = Object.fromEntries(['SAMPLES', ...(c.connections ?? [])].map((alias) => [alias, factory]));
  return { connections, culture: c.culture, ...extra };
}

/** golden-cs's error: "ERROR Namespace.Type: message" and the following lines of the message. */
function csError(text: string): { type: string; message: string } {
  const m = /^ERROR ([\w.]+): ([\s\S]*)$/.exec(text.replace(/\r\n/g, '\n'));
  if (m === null) throw new Error('Not an error of golden-cs: ' + text);
  return { type: m[1]!.split('.').pop()!, message: m[2]!.trimEnd() };
}

describe.skipIf(!available)('PostgreSQL run parity with golden-cs (Npgsql 10)', () => {
  for (const c of CASES) {
    const errorFile = path.join(fixtures, c.name + '.error.txt');
    if (c.knownDifference !== undefined) {
      const known = c.knownDifference;
      it(`${c.name}: C# fails (${known.error}), the TypeScript engine runs it`, async () => {
        expect(fs.readFileSync(errorFile, 'utf8')).toContain(known.error);
        const report = await openReport(reportFile(c), runOptions(c));
        const pdf = await report.executeToPdf(null, { compressed: false });
        expect(Buffer.from(pdf.subarray(0, 5)).toString('latin1')).toBe('%PDF-');
      });
      continue;
    }
    if (fs.existsSync(errorFile)) {
      it(`${c.name}: fails as C# does`, async () => {
        const expected = csError(fs.readFileSync(errorFile, 'utf8'));
        const report = await openReport(reportFile(c), runOptions(c));
        const error = await report.executeToPdf(null, { compressed: false }).then(
          () => new Error('no error'),
          (e: unknown) => e as Error & { netType?: string },
        );
        expect((error as { netType?: string }).netType ?? error.name).toBe(expected.type);
        expect(error.message.replace(/\r\n/g, '\n')).toContain(expected.message);
      });
      continue;
    }
    describe(c.name, () => {
      const csPdf = new Uint8Array(fs.readFileSync(path.join(fixtures, c.name + '.cs.pdf')));
      const csJson = JSON.parse(fs.readFileSync(path.join(fixtures, c.name + '.meta.json'), 'utf8')) as {
        pages: { objects: unknown[] }[];
      } & Record<string, unknown>;
      const { clock } = pdfCreation(csPdf);

      it('lays out the same metafile as C#', async () => {
        const report = await openReport(reportFile(c), runOptions(c, { clock }));
        const ts = metaFileJson(await report.executeToMetafile(null)) as typeof csJson;
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

      it('writes the same PDF bytes as C#', async () => {
        const report = await openReport(reportFile(c), runOptions(c, { clock }));
        const pdf = await report.executeToPdf(null, { compressed: false });
        if (Buffer.compare(Buffer.from(pdf), Buffer.from(csPdf)) !== 0)
          fs.writeFileSync(path.join(os.tmpdir(), 'rm-pg-' + c.name + '.ts.pdf'), pdf);
        expect(Buffer.compare(Buffer.from(pdf), Buffer.from(csPdf))).toBe(0);
      });
    });
  }

  it('runs invoices.rep with a range of orders given to step 2 as the C# run of that range', async () => {
    const csPdf = new Uint8Array(fs.readFileSync(path.join(fixtures, 'invoices-range.cs.pdf')));
    const c: PgCase = { name: 'invoices', report: 'samples/invoices.rep' };
    const report = await openReport(reportFile(c), runOptions(c, { clock: pdfCreation(csPdf).clock }));
    const pdf = await report.executeToPdf({ FIRST_ORDER: 7, LAST_ORDER: 9 }, { compressed: false });
    expect(Buffer.compare(Buffer.from(pdf), Buffer.from(csPdf))).toBe(0);
  });
});
