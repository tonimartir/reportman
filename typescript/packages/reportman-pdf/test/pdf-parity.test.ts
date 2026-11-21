import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { renderPdf } from 'reportman-pdf';
import { loadGolden } from './golden.js';
import {
  contentStreams,
  firstLineDifference,
  hasPoppler,
  pdfToText,
  rasterDifference,
  rasterize,
  tempDir,
} from './pdftools.js';

const reports = ['customers', 'invoices', 'features'];
const poppler = hasPoppler();
const work = tempDir('rm-pdf-parity-');

describe.each(reports)('PDF parity with PrintOutPDFStandard: %s', (name) => {
  const golden = loadGolden(name);
  const ts = renderPdf(golden.meta, { compressed: false });
  const tsCompressed = renderPdf(golden.meta, { compressed: true });
  const csFile = path.join(work, name + '.cs.pdf');
  const tsFile = path.join(work, name + '.ts.pdf');
  const tszFile = path.join(work, name + '.tsz.pdf');
  fs.writeFileSync(csFile, golden.csPdf);
  fs.writeFileSync(tsFile, ts);
  fs.writeFileSync(tszFile, tsCompressed);

  it('has the same content stream operators as C#, page by page', () => {
    const want = contentStreams(golden.csPdf);
    const got = contentStreams(ts);
    expect(got.length).toBe(golden.json.pages.length);
    expect(got.length).toBe(want.length);
    for (let i = 0; i < want.length; i++) expect(firstLineDifference(got[i]!, want[i]!), `page ${i + 1}`).toBeNull();
  });

  it('writes the same bytes as C# (uncompressed, same dates)', () => {
    expect(Buffer.compare(Buffer.from(ts), Buffer.from(golden.csPdf))).toBe(0);
  });

  it('compressed: the inflated content streams are the C# ones', () => {
    const want = contentStreams(golden.csPdf);
    const got = contentStreams(tsCompressed);
    expect(got.length).toBe(want.length);
    for (let i = 0; i < want.length; i++) expect(Buffer.compare(Buffer.from(got[i]!), Buffer.from(want[i]!))).toBe(0);
  });

  it.skipIf(!poppler)('has the same page count and text (pdftotext)', () => {
    const want = pdfToText(csFile);
    expect(want.length).toBeGreaterThan(0);
    expect(pdfToText(tsFile)).toBe(want);
    expect(pdfToText(tszFile)).toBe(want);
    // pdftotext ends every page with a form feed
    expect(want.split('\f').length - 1).toBe(golden.json.pages.length);
  });

  it.skipIf(!poppler)('rasterizes like C# (pdftoppm -gray)', () => {
    const want = rasterize(csFile, 72);
    const got = rasterize(tsFile, 72);
    const gotz = rasterize(tszFile, 72);
    expect(got.length).toBe(want.length);
    expect(gotz.length).toBe(want.length);
    for (let i = 0; i < want.length; i++) {
      const pixels = want[i]!.width * want[i]!.height;
      // Tight tolerance: at most 0.01% of the pixels may differ by more than 8 gray levels
      expect(rasterDifference(got[i]!, want[i]!, 8)).toBeLessThanOrEqual(Math.floor(pixels / 10000));
      expect(rasterDifference(gotz[i]!, want[i]!, 8)).toBeLessThanOrEqual(Math.floor(pixels / 10000));
    }
  });
});
