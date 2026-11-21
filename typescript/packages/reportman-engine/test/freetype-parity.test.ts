// FreeType parity with the C# engine: each case of freetype-cases.json run in the TypeScript engine
// with the TrueType provider (PdfDevice with a font library of the system fonts) the way golden-cs
// runs it with PrintOutPDFFreeType gives the same metafile, object by object, the same content
// streams (text operators, glyph codes, positions), the same text (pdftotext) and the same raster
// within a tight tolerance (pdftoppm), and the same objects but the font programs: these are
// fontkit subsets, not hb-subset ones. The /ID of a PDF/A-3 trailer is a random GUID.
//
// The C# PDFs embed the fonts of the machine they were made on: the cases only run on a machine
// with the same font files (fixtures/freetype/fonts.json).

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { metaFileJson, pdfCreation, here } from './golden-run.js';
import {
  documentStructure,
  firstTextDifference,
  fontFingerprint,
  fontObjects,
  readGzip,
  runFreeTypeLikeGolden,
  systemFonts,
  type FreeTypeCase,
} from './golden-run-ft.js';
import { contentStreams, firstLineDifference, hasPoppler, pdfToText, rasterDifference, rasterize, tempDir } from '../../reportman-pdf/test/pdftools.js';

const fixtures = path.join(here, 'fixtures/freetype');
const cases = JSON.parse(fs.readFileSync(path.join(here, 'freetype-cases.json'), 'utf8')) as FreeTypeCase[];
const sameFonts =
  process.platform === 'win32' &&
  JSON.stringify(fontFingerprint().sort()) === JSON.stringify(JSON.parse(fs.readFileSync(path.join(fixtures, 'fonts.json'), 'utf8')));
const poppler = sameFonts && hasPoppler();
const work = tempDir('rm-freetype-parity-');

describe.skipIf(!sameFonts).each(cases)('FreeType parity with golden-cs: $name', (c) => {
  const errorFile = path.join(fixtures, c.name + '.error.txt');
  const reportFile = path.resolve(here, c.report);
  if (fs.existsSync(errorFile)) {
    it('fails as C# does', async () => {
      const expected = fs.readFileSync(errorFile, 'utf8');
      const message = await runFreeTypeLikeGolden(reportFile, { params: c.params, culture: c.culture, fonts: systemFonts() }).then(
        () => 'no error',
        (e: unknown) => (e instanceof Error ? e.message : String(e)),
      );
      expect(expected).toContain(message.split('\n')[0]!);
    });
    return;
  }
  const csJson = JSON.parse(fs.readFileSync(path.join(fixtures, c.name + '.meta.json'), 'utf8')) as {
    pages: { objects: unknown[] }[];
  } & Record<string, unknown>;
  const pdfFile = path.join(fixtures, c.name + '.cs.pdf.gz');
  const csPdf = fs.existsSync(pdfFile) ? readGzip(pdfFile) : null;
  const { clock, now } = csPdf === null ? { clock: undefined, now: undefined } : pdfCreation(csPdf);
  // Run on the first test that needs it: a skipped suite (other fonts, another system, or none in a
  // container) collects its tests without scanning the fonts
  let run: ReturnType<typeof runFreeTypeLikeGolden> | undefined;
  const result = () => (run ??= runFreeTypeLikeGolden(reportFile, { params: c.params, culture: c.culture, now, clock, fonts: systemFonts() }));
  const csFile = path.join(work, c.name + '.cs.pdf');
  const tsFile = path.join(work, c.name + '.ts.pdf');

  it('lays out the same metafile as C#', async () => {
    const { meta } = await result();
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

  it('writes the same content streams as C#', async () => {
    const { pdf } = await result();
    expect(pdf).not.toBeNull();
    if (csPdf === null || pdf === null) return;
    fs.writeFileSync(csFile, csPdf);
    fs.writeFileSync(tsFile, pdf);
    const want = contentStreams(csPdf);
    const got = contentStreams(pdf);
    expect(want.length).toBeGreaterThan(0);
    expect(got.length).toBe(want.length);
    for (let i = 0; i < want.length; i++) expect(firstLineDifference(got[i]!, want[i]!), `page ${i + 1}`).toBeNull();
  });

  it('declares the same fonts as C# (descriptors, Type0 and CID fonts, widths)', async () => {
    const { pdf } = await result();
    if (csPdf === null || pdf === null) return;
    expect(fontObjects(pdf)).toEqual(fontObjects(csPdf));
  });

  it('writes the same objects as C# but the font programs (header, metadata, pages, images, files, catalog, trailer)', async () => {
    const { pdf } = await result();
    if (csPdf === null || pdf === null) return;
    const got = documentStructure(pdf);
    const want = documentStructure(csPdf);
    expect(got.header).toBe(want.header);
    expect(got.badOffsets).toEqual([]);
    expect(got.objects.length).toBe(want.objects.length);
    for (let i = 0; i < want.objects.length; i++) expect(firstTextDifference(got.objects[i]!, want.objects[i]!), `object ${i}`).toBeNull();
    expect(got.trailer).toBe(want.trailer);
    // A new PDF/A-3 document: its two identifiers are the same GUID
    expect(got.ids.length).toBe(want.ids.length);
    if (got.ids.length > 0) {
      expect(got.ids[0]).toMatch(/^[0-9a-f]{32}$/);
      expect(got.ids[1]).toBe(got.ids[0]);
    }
  });

  it.skipIf(!poppler)('has the same text as C# (pdftotext)', async () => {
    const { pdf } = await result();
    if (csPdf === null || pdf === null) return;
    fs.writeFileSync(csFile, csPdf);
    fs.writeFileSync(tsFile, pdf);
    expect(pdfToText(tsFile)).toBe(pdfToText(csFile));
  });

  it.skipIf(!poppler)('rasterizes like C# (pdftoppm -gray)', async () => {
    const { pdf } = await result();
    if (csPdf === null || pdf === null) return;
    fs.writeFileSync(csFile, csPdf);
    fs.writeFileSync(tsFile, pdf);
    const want = rasterize(csFile, 72);
    const got = rasterize(tsFile, 72);
    expect(got.length).toBe(want.length);
    for (let i = 0; i < want.length; i++) {
      const pixels = want[i]!.width * want[i]!.height;
      expect(rasterDifference(got[i]!, want[i]!, 8)).toBeLessThanOrEqual(Math.floor(pixels / 10000));
    }
  });

  it('keeps a copy of a PDF that differs', async () => {
    const { pdf } = await result();
    if (pdf !== null) fs.writeFileSync(path.join(os.tmpdir(), 'rm-freetype-' + c.name + '.ts.pdf'), pdf);
  });
});
