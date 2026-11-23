// The PDF417 codewords of 500 texts (fixtures/pdf417-codewords.json, written by
// generate-pdf417-fixtures.mjs): the ones the C# engine gives and the ones the Delphi engine
// draws, the same; they read back by the book as the text, and a scanner (the PDF417Reader of
// @zxing/library, on the symbol the engine draws) reads them as the text too.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import * as zxingModule from '@zxing/library';
import { MetaFile, MetaObjectDraw, MetaPage } from '@reportman/metafile';
import { CultureInfo } from '@reportman/engine';
import { draw2DBarcode, generateCodewords, toAnsi } from '../src/report/barcode/pdf417.js';
import { pdf417ErrorCorrection, pdf417Text } from './barcode-readers.js';

// @zxing/library gives Node its CommonJS bundle (the default export) and bundlers its ES modules
const zxing: typeof zxingModule = (zxingModule as unknown as { default?: typeof zxingModule }).default ?? zxingModule;

/**
 * The symbol of a text as the engine draws it (modules of 3 twips, rows of 9), painted one pixel
 * per twip with a quiet zone, and read by the PDF417Reader of @zxing/library.
 */
const cp1252 = new TextDecoder('windows-1252');

function scan(text: string): string {
  const nfi = CultureInfo.invariant.number;
  const { ySize } = generateCodewords(text, -1, 0, 0, nfi);
  const meta = new MetaFile();
  const page = new MetaPage(meta);
  meta.pages.add(page);
  meta.currentPage = 0;
  const quiet = 30;
  draw2DBarcode(text, -1, 0, 0, false, 3, quiet, quiet, ySize * 9, meta, 0, 0, nfi);
  const bars = page.objects.filter((o): o is MetaObjectDraw => o instanceof MetaObjectDraw);
  const width = Math.max(...bars.map((b) => b.left + b.width)) + quiet;
  const height = Math.max(...bars.map((b) => b.top + b.height)) + quiet;
  const pixels = new Uint8ClampedArray(width * height).fill(255);
  for (const b of bars) for (let y = b.top; y < b.top + b.height; y++) pixels.fill(0, y * width + b.left, y * width + b.left + b.width);
  const image = new zxing.BinaryBitmap(new zxing.HybridBinarizer(new zxing.RGBLuminanceSource(pixels, width, height)));
  return new zxing.PDF417Reader().decode(image).getText();
}

const here = path.dirname(fileURLToPath(import.meta.url));
const cases = JSON.parse(fs.readFileSync(path.join(here, 'fixtures', 'pdf417-codewords.json'), 'utf8')) as {
  text: string;
  rows: number;
  cols: number;
  codewords: number[];
  delphi: number[];
}[];

const nfi = CultureInfo.invariant.number;
const encode = (text: string): { rows: number; cols: number; codewords: number[] } => {
  const r = generateCodewords(text, -1, 0, 0, nfi);
  return { rows: r.ySize, cols: r.xSize, codewords: r.codewords.slice(0, r.xSize * r.ySize) };
};
const read = (codewords: readonly number[]): string => {
  try {
    return pdf417Text(codewords);
  } catch (e) {
    return 'not readable: ' + String(e);
  }
};

describe('the PDF417 codewords of a text', () => {
  it(`are those of the C# engine (${cases.length} texts)`, () => {
    const wrong = cases
      .map((c) => ({ text: c.text, expected: { rows: c.rows, cols: c.cols, codewords: c.codewords }, actual: encode(c.text) }))
      .filter((c) => JSON.stringify(c.actual) !== JSON.stringify(c.expected));
    expect(wrong).toEqual([]);
  });

  it('read back as the text in code page 1252, with their error correction', () => {
    const wrong: string[] = [];
    for (const c of cases) {
      const { codewords } = encode(c.text);
      if (read(codewords) !== toAnsi(c.text)) wrong.push(c.text + ' reads ' + read(codewords));
      // The automatic level: 2 below 41 data codewords, 3 below 161
      const k = codewords[0]! < 41 ? 8 : 16;
      const data = codewords.slice(0, codewords.length - k);
      if (data.length !== codewords[0] || JSON.stringify(codewords.slice(data.length)) !== JSON.stringify(pdf417ErrorCorrection(data, k)))
        wrong.push(c.text + ' error correction');
    }
    expect(wrong).toEqual([]);
  });

  it(`are read by a scanner as the text (${cases.length} texts)`, () => {
    // Every text, and the ones of a mode on its own (a short text goes in byte compaction)
    const texts = [...cases.map((c) => c.text), 'AB', 'A', '1', 'PDF417', 'ABC', '12345678901234', 'éñ'];
    const wrong: string[] = [];
    for (const text of texts) {
      let got: string;
      try {
        got = scan(text);
      } catch (e) {
        got = 'not read: ' + String(e);
      }
      // The reader gives the bytes in code page 1252
      const expected = cp1252.decode(Uint8Array.from(toAnsi(text), (ch) => ch.charCodeAt(0)));
      if (got !== expected) wrong.push(JSON.stringify(text) + ' reads ' + JSON.stringify(got));
    }
    expect(wrong).toEqual([]);
  });

  it(`are those of the Delphi engine (${cases.length} texts)`, () => {
    const different = cases.filter((c) => JSON.stringify(encode(c.text).codewords) !== JSON.stringify(c.delphi)).map((c) => c.text);
    expect(different).toEqual([]);
  });
});
