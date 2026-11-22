// The modules of a linear barcode drawn by the device itself (a receipt printer), against the ones
// ZXing.Net gives the C# engine: fixtures/zxing-widths.json, written by
// generate-zxing-width-fixtures.mjs with golden-cs zxing-width (null where ZXing refuses the text and
// the item draws its bars).

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { MetaBarcodeSymbology } from '@reportman/metafile';
import { zxingLinearModules } from '../src/report/barcode/zxingwidth.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const cases = JSON.parse(fs.readFileSync(path.join(here, 'fixtures', 'zxing-widths.json'), 'utf8')) as {
  symbology: keyof typeof MetaBarcodeSymbology;
  text: string;
  modules: number | null;
}[];

describe('the modules of a native linear barcode', () => {
  for (const symbology of [...new Set(cases.map((c) => c.symbology))]) {
    const of = cases.filter((c) => c.symbology === symbology);
    it(`gives those of ZXing.Net for ${symbology} (${of.length} texts, ${of.filter((c) => c.modules === null).length} refused)`, () => {
      const wrong = of
        .map((c) => ({ text: c.text, expected: c.modules, actual: zxingLinearModules(MetaBarcodeSymbology[c.symbology], c.text) }))
        .filter((c) => c.actual !== c.expected);
      expect(wrong).toEqual([]);
    });
  }
});
