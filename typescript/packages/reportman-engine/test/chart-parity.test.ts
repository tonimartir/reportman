// Chart parity with the C# engine: each case of chart-cases.json (the chart samples and the
// synthetic reports of synthetic/make-chart-reports.mjs) runs in the TypeScript engine the way
// golden-cs runs it (PrintOutPDFStandard, which draws charts with VectorChart), and gives the same
// metafile, object by object and field by field, and a PDF byte-identical to the C# one; or fails
// with the error of the C# engine.

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import zlib from 'node:zlib';
import { describe, expect, it } from 'vitest';
import type { MetaFile, MetaPage } from '@reportman/metafile';
import { metaFileJson, pdfCreation, renderDrawn, runLikeGolden, here, type RunCase } from './golden-run.js';

const fixtures = path.join(here, 'fixtures/chart');
const cases = JSON.parse(fs.readFileSync(path.join(here, 'chart-cases.json'), 'utf8')) as RunCase[];

/**
 * The image streams of the pages (fishes has images), which the snapshots of runLikeGolden do not
 * copy: a page's stream only grows while the page is generated, so it is the same when it is drawn.
 */
function withImageStreams(meta: MetaFile, drawn: MetaPage[]): MetaPage[] {
  drawn.forEach((p, i) => {
    if (p.memStream.view().length === 0) p.memStream.write(meta.pages.get(i).memStream.view());
  });
  return drawn;
}

describe.each(cases)('chart parity with golden-cs: $name', (c) => {
  const errorFile = path.join(fixtures, c.name + '.error.txt');
  const reportFile = path.resolve(here, c.report);
  if (fs.existsSync(errorFile)) {
    it('fails as C# does', async () => {
      const expected = fs.readFileSync(errorFile, 'utf8');
      const message = await runLikeGolden(reportFile, { params: c.params, culture: c.culture }).then(
        () => 'no error',
        (e: unknown) => (e instanceof Error ? e.message : String(e)),
      );
      expect(expected).toContain(message.split('\n')[0]!);
    });
    return;
  }
  const gunzip = (file: string): Buffer => zlib.gunzipSync(fs.readFileSync(path.join(fixtures, file)));
  const csJson = JSON.parse(gunzip(c.name + '.meta.json.gz').toString('utf8')) as {
    pages: { objects: unknown[] }[];
  } & Record<string, unknown>;
  const csPdf = new Uint8Array(gunzip(c.name + '.cs.pdf.gz'));
  const { clock, now } = pdfCreation(csPdf);
  const result = runLikeGolden(reportFile, { params: c.params, culture: c.culture, now });
  // The tests below await it (and fail with its error)
  result.catch(() => undefined);

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
      expect(tsObjects.length, `page ${i + 1} objects`).toBe(csObjects.length);
      for (let j = 0; j < csObjects.length; j++) expect(tsObjects[j], `page ${i + 1} object ${j}`).toEqual(csObjects[j]);
    }
  });

  it('writes the same PDF bytes as C#', async () => {
    const { meta, drawn } = await result;
    const ts = renderDrawn(meta, withImageStreams(meta, drawn), clock);
    if (Buffer.compare(Buffer.from(ts), Buffer.from(csPdf)) !== 0) {
      // The PDF that differs, to compare it by hand
      fs.writeFileSync(path.join(os.tmpdir(), 'rm-engine-' + c.name + '.ts.pdf'), ts);
    }
    expect(Buffer.compare(Buffer.from(ts), Buffer.from(csPdf))).toBe(0);
  });
});
