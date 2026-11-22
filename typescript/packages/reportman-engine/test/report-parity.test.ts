// Run parity with the C# engine: each case of run-cases.json runs in the TypeScript engine on
// samples.db (node:sqlite) the way golden-cs runs it, and gives the same metafile, object by
// object and field by field, and a PDF byte-identical to the C# one.

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { systemClock } from '@reportman/pdf';
import { caseDb, metaFileJson, pdfCreation, renderDrawn, runCases, runFixtures, runLikeGolden, here } from './golden-run.js';

describe.each(runCases())('run parity with golden-cs: $name', (c) => {
  const errorFile = path.join(runFixtures, c.name + '.error.txt');
  const reportFile = path.resolve(here, c.report);
  if (fs.existsSync(errorFile)) {
    it('fails as C# does', async () => {
      const expected = fs.readFileSync(errorFile, 'utf8');
      // The layout, and the drawing of the PDF, where C# fails too (a PDF/A-3 text without a font
      // provider, for example, fails in PDFCanvas.TextRect)
      const message = await runLikeGolden(reportFile, { params: c.params, culture: c.culture, db: caseDb(c) }).then(
        ({ meta, drawn, noData }) => {
          if (!noData) renderDrawn(meta, drawn, systemClock);
          return 'no error';
        },
      ).catch((e: unknown) => (e instanceof Error ? e.message : String(e)));
      expect(expected).toContain(message.split('\n')[0]!);
    });
    return;
  }
  const csJson = JSON.parse(fs.readFileSync(path.join(runFixtures, c.name + '.meta.json'), 'utf8')) as {
    pages: { objects: unknown[] }[];
  } & Record<string, unknown>;
  const pdfFile = path.join(runFixtures, c.name + '.cs.pdf');
  // A report with nothing to print: the C# device writes no PDF
  const csPdf = fs.existsSync(pdfFile) ? new Uint8Array(fs.readFileSync(pdfFile)) : null;
  const { clock, now } = csPdf === null ? { clock: undefined, now: undefined } : pdfCreation(csPdf);
  const result = runLikeGolden(reportFile, { params: c.params, culture: c.culture, now, db: caseDb(c) });

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

  it(csPdf === null ? 'has nothing to print, as C#' : 'writes the same PDF bytes as C#', async () => {
    const { meta, drawn, noData } = await result;
    if (csPdf === null || clock === undefined) {
      expect(noData).toBe(true);
      expect(meta.empty).toBe(true);
      return;
    }
    expect(noData).toBe(false);
    const ts = renderDrawn(meta, drawn, clock);
    if (Buffer.compare(Buffer.from(ts), Buffer.from(csPdf)) !== 0) {
      // The PDF that differs, to compare it by hand
      fs.writeFileSync(path.join(os.tmpdir(), 'rm-engine-' + c.name + '.ts.pdf'), ts);
    }
    expect(Buffer.compare(Buffer.from(ts), Buffer.from(csPdf))).toBe(0);
  });
});
