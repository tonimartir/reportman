// Image parity with the C# engine: each report of fixtures/images (generate-image-fixtures.mjs)
// runs in the TypeScript engine on samples.db the way golden-cs runs it (with the image files of
// its expressions read from that folder) and gives the same metafile, object by object, and a PDF
// byte-identical to the C# one; a report the C# engine fails fails here the same way.

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { readReportXml } from '@reportman/lib';
import { MetaPage, type MetaFile, type MetaObject } from '@reportman/metafile';
import { PdfDevice } from '@reportman/pdf';
import { NoDataToPrintException, prepareReport, type EvalHost, type RpDateTime } from '@reportman/engine';
import { metaFileJson, pdfCreation, renderDrawn, samplesDb, here } from './golden-run.js';
import { sqliteHost } from './sqlite-host.js';

const fixtures = path.join(here, 'fixtures/images');
const cases = JSON.parse(fs.readFileSync(path.join(fixtures, 'cases.json'), 'utf8')) as { name: string; report: string }[];

/** A copy of a page as it is now: its objects, its pool and the stream of its images. */
function snapshot(meta: MetaFile, page: MetaPage): MetaPage {
  const copy = new MetaPage(meta);
  copy.orientation = page.orientation;
  copy.updatedPageSize = page.updatedPageSize;
  copy.pageDetail = Object.assign(Object.create(Object.getPrototypeOf(page.pageDetail) as object), page.pageDetail);
  copy.objects = page.objects.map((o) => Object.assign(Object.create(Object.getPrototypeOf(o) as object), o) as MetaObject);
  const internal = copy as unknown as { fPool: Uint16Array; fPoolPos: number };
  internal.fPool = page.pool.slice();
  internal.fPoolPos = page.poolPos;
  copy.memStream.write(page.memStream.view());
  return copy;
}

/** Runs a report as golden-cs does, the files of the image expressions read from the fixtures. */
async function runImageReport(reportFile: string, now?: RpDateTime): Promise<{ meta: MetaFile; drawn: MetaPage[]; noData: boolean }> {
  const model = readReportXml(new Uint8Array(fs.readFileSync(reportFile)));
  const file = (p: string): string => path.resolve(fixtures, p);
  const host: EvalHost = {
    now: () => now ?? ({} as RpDateTime),
    fileExists: (p) => fs.existsSync(file(p)) && fs.statSync(file(p)).isFile(),
    readFile: (p) => new Uint8Array(fs.readFileSync(file(p))),
  };
  const run = await prepareReport(model, { device: new PdfDevice(), data: sqliteHost(samplesDb), culture: 'en-US', host });
  const meta = run.metaFile;
  try {
    await run.begin();
  } catch (e) {
    if (e instanceof NoDataToPrintException) return { meta, drawn: [], noData: true };
    throw e;
  }
  const drawn: MetaPage[] = [];
  let current = 0;
  await run.requestPage(current);
  while (meta.pages.currentCount > current) {
    drawn.push(snapshot(meta, meta.pages.get(current)));
    current++;
    await run.requestPage(current);
  }
  return { meta, drawn, noData: false };
}

describe.each(cases)('image parity with golden-cs: $name', (c) => {
  const reportFile = path.join(fixtures, c.report);
  const errorFile = path.join(fixtures, c.name + '.error.txt');
  if (fs.existsSync(errorFile)) {
    it('fails as C# does', async () => {
      const expected = fs.readFileSync(errorFile, 'utf8');
      // The layout or the PDF fails (the C# device draws each page as soon as it exists)
      const message = await (async () => {
        const { meta, drawn } = await runImageReport(reportFile);
        const { clock } = pdfCreation(new Uint8Array(Buffer.from('/CreationDate (D:20260101000000Z)')));
        renderDrawn(meta, drawn, clock);
        return 'no error';
      })().catch((e: unknown) => (e instanceof Error ? e.message : String(e)));
      expect(expected).toContain(message.split('\n')[0]!);
    });
    return;
  }
  const csJson = JSON.parse(fs.readFileSync(path.join(fixtures, c.name + '.meta.json'), 'utf8')) as {
    pages: { objects: unknown[] }[];
  } & Record<string, unknown>;
  const csPdf = new Uint8Array(fs.readFileSync(path.join(fixtures, c.name + '.cs.pdf')));
  const { clock, now } = pdfCreation(csPdf);
  const result = runImageReport(reportFile, now);

  it('lays out the same metafile as C#', async () => {
    const { meta } = await result;
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
  });

  it('writes the same PDF bytes as C#', async () => {
    const { meta, drawn, noData } = await result;
    expect(noData).toBe(false);
    const ts = renderDrawn(meta, drawn, clock);
    if (Buffer.compare(Buffer.from(ts), Buffer.from(csPdf)) !== 0)
      fs.writeFileSync(path.join(os.tmpdir(), 'rm-engine-' + c.name + '.ts.pdf'), ts);
    expect(Buffer.compare(Buffer.from(ts), Buffer.from(csPdf))).toBe(0);
  });
});
