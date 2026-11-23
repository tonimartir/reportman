// The PDF417 codewords of 500 texts (fixtures/pdf417-codewords.json, written by
// generate-pdf417-fixtures.mjs): the ones the C# engine gives, which read back by the book as the
// text; and the ones the Delphi engine draws wherever Delphi encodes the text. Delphi gets some
// texts wrong (it loses a last character that is on its own and writes twice the character before
// one the text compaction does not have, see barcode-delphi.test.ts): in those the codewords are
// not its own.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { CultureInfo } from '@reportman/engine';
import { generateCodewords, toAnsi } from '../src/report/barcode/pdf417.js';
import { pdf417ErrorCorrection, pdf417Text } from './barcode-readers.js';

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

  it('are those of the Delphi engine wherever Delphi encodes the text', () => {
    const right = cases.filter((c) => read(c.delphi) === toAnsi(c.text));
    const different = right.filter((c) => JSON.stringify(encode(c.text).codewords) !== JSON.stringify(c.delphi)).map((c) => c.text);
    expect(different).toEqual([]);
    // Most texts: the rest are the ones Delphi gets wrong, where the codewords are not its own
    expect(right.length).toBeGreaterThan(cases.length * 0.75);
    expect(right.length).toBeLessThan(cases.length);
    for (const c of cases) if (!right.includes(c)) expect(encode(c.text).codewords, c.text).not.toEqual(c.delphi);
  });
});
