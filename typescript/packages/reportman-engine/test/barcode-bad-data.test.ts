// Barcodes of data a symbology may not take (fixtures/barcode-bad-data.json.gz, written by
// generate-barcode-bad-data-fixtures.mjs from the C# engine): the same pattern, codewords or error
// as C#, and an error that says what is wrong, never an internal message of .NET such as "Index
// was outside the bounds of the array".

import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { BarcodeItem as BarcodeModel, BarcodeType, Report } from '@reportman/lib';
import { PdfDevice } from '@reportman/pdf';
import { CultureInfo, prepareReport, type ReportRuntime } from '@reportman/engine';
import { BarcodeItem } from '../src/report/barcode/barcodeitem.js';
import { generateCodewords } from '../src/report/barcode/pdf417.js';

interface Case {
  type: keyof typeof BarcodeType;
  text: string;
  checksum?: boolean;
  ecc?: number;
  rows?: number;
  cols?: number;
  pattern?: string;
  symbolRows?: number;
  symbolCols?: number;
  codewords?: number[];
  error?: string;
}

const here = path.dirname(fileURLToPath(import.meta.url));
const cases = JSON.parse(zlib.gunzipSync(fs.readFileSync(path.join(here, 'fixtures/barcode-bad-data.json.gz'))).toString('utf8')) as Case[];

/** The messages .NET gives for a bug, not for the data of a report. */
const INTERNAL = /Index was outside|Index and length|input string|Object reference|Negating the minimum|Value cannot be null|startIndex|Arithmetic operation/;

const message = (e: unknown): string => (e instanceof Error ? e.message : String(e));

let runtime: ReportRuntime | undefined;
async function encode(c: Case): Promise<Omit<Case, 'type' | 'text' | 'checksum' | 'ecc' | 'rows' | 'cols'>> {
  try {
    if (c.type === 'CodePDF417') {
      const r = generateCodewords(c.text, c.ecc ?? -1, c.rows ?? 0, c.cols ?? 0, CultureInfo.invariant.number);
      return { symbolRows: r.ySize, symbolCols: r.xSize, codewords: r.codewords.slice(0, r.xSize * r.ySize) };
    }
    runtime ??= (await prepareReport(new Report(), { device: new PdfDevice() })).runtime;
    const model = new BarcodeModel();
    model.barType = BarcodeType[c.type];
    model.checksum = c.checksum ?? false;
    const item = new BarcodeItem(runtime, model);
    item.currentText = c.text;
    return { pattern: item.calculateBarcode() };
  } catch (e) {
    return { error: message(e) };
  }
}

const expected = (c: Case): Omit<Case, 'type' | 'text' | 'checksum' | 'ecc' | 'rows' | 'cols'> =>
  c.error !== undefined
    ? { error: c.error }
    : c.type === 'CodePDF417'
      ? { symbolRows: c.symbolRows, symbolCols: c.symbolCols, codewords: c.codewords }
      : { pattern: c.pattern };

describe('a barcode of data the symbology may not take', () => {
  it(`gives the pattern, the codewords or the error of the C# engine (${cases.length} cases)`, async () => {
    const wrong: unknown[] = [];
    for (const c of cases) {
      const actual = await encode(c);
      if (JSON.stringify(actual) !== JSON.stringify(expected(c))) wrong.push({ type: c.type, text: c.text, checksum: c.checksum, expected: expected(c), actual });
    }
    expect(wrong.slice(0, 10)).toEqual([]);
  });

  it('says what is wrong, not an internal error', () => {
    const internal = cases.filter((c) => c.error !== undefined && INTERNAL.test(c.error));
    expect(internal.map((c) => `${c.type} ${JSON.stringify(c.text)}: ${c.error}`)).toEqual([]);
  });

  it('names the symbology and the data', () => {
    const find = (type: Case['type'], text: string, checksum = false) => cases.find((c) => c.type === type && c.text === text && (c.checksum ?? false) === checksum)!.error;
    expect(find('CodeEAN8', '1234567X')).toBe('EAN8 bad Data: 1234567X');
    expect(find('CodeEAN13', 'A234567890123')).toBe('EAN13 bad Data: A234567890123');
    // With the checksum the message has the text of the item, not the padded one
    expect(find('CodeEAN13', '12A4', true)).toBe('EAN13 bad Data: 12A4');
    expect(find('Code_2_5_interleaved', '12A4')).toBe('Interleaved 2 of 5 bad Data: 12A4');
    expect(find('Code_2_5_industrial', '1A')).toBe('Industrial 2 of 5 bad Data: 1A');
    expect(find('Code_2_5_matrix', '1A')).toBe('Matrix 2 of 5 bad Data: 1A');
  });

  it('writes what Code 128 C, PDF417 and an error correction level above 8 can write', () => {
    const find = (type: Case['type'], text: string, extra: Partial<Case> = {}) =>
      cases.find((c) => c.type === type && c.text === text && Object.entries(extra).every(([k, v]) => c[k as keyof Case] === v))!;
    // A control character that does not make a pair: code set A
    expect(find('Code128C', '12\t34').error).toBeUndefined();
    // Level 9 and above: level 8, as Delphi (512 error correction codewords)
    for (const ecc of [9, 10, 100]) expect(find('CodePDF417', 'ecc', { ecc }).codewords).toEqual(find('CodePDF417', 'ecc', { ecc: 8 }).codewords);
    // A hex escape cut at the end of the text: the digit there is (character 4, no text value)
    expect(find('CodePDF417', '\\X4').error).toBe('PDF417: the text compaction cannot write the escape at character 1 of the text');
    expect(find('CodePDF417', 'rows and cols', { rows: 100, cols: 100 }).error).toBe(
      'PDF417: 100 rows and 100 columns are 10000 codewords, more than the 2700 of the largest symbol (90 rows and 30 columns)',
    );
    expect(find('CodePDF417', 'rows and cols', { rows: 90, cols: 30 }).error).toBeUndefined();
  });
});
