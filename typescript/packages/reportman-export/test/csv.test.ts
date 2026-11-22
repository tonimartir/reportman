// The CSV of a metafile against the C# engine (PrintOutCSV): the samples run with the TypeScript
// engine as golden-cs ran them, with the clock of the C# run. Regenerate the fixtures with
// test/generate-csv-fixtures.mjs.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { MetaFile, MetaPage, PDFFontType, PrintStepType, TextAlignType, TextAlignVerticalType } from '@reportman/metafile';
import { metafileToCsv } from '@reportman/export';
import { pdfCreation, runLikeGolden } from '../../reportman-engine/test/golden-run.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const fixtures = path.join(here, 'fixtures/csv');
interface CsvCase {
  name: string;
  report: string;
  params?: Record<string, string>;
  culture?: string;
  creationDate: string;
}
const cases = JSON.parse(fs.readFileSync(path.join(fixtures, 'cases.json'), 'utf8')) as CsvCase[];

describe('metafileToCsv against PrintOutCSV of C#', () => {
  for (const c of cases) {
    it(c.name, async () => {
      const clock = pdfCreation(new Uint8Array(Buffer.from('/CreationDate (' + c.creationDate + ')', 'latin1')));
      const r = await runLikeGolden(path.resolve(here, c.report), { params: c.params, culture: c.culture, now: clock.now });
      expect(metafileToCsv(r.meta)).toBe(fs.readFileSync(path.join(fixtures, c.name + '.csv'), 'utf8'));
    });
  }
});

describe('metafileToCsv', () => {
  it('quotes each value, doubles the qualifier, takes a page range and other separators', () => {
    const meta = new MetaFile();
    const text = (page: MetaPage, t: string, left: number, top: number) =>
      page.drawText(left, top, 1000, 300, t, 'Arial', 'Helvetica', 10, 0, 0, 0xffffff, true, 0,
        PDFFontType.Helvetica, TextAlignType.Left, TextAlignVerticalType.Top, false, false, false, PrintStepType.BySize);
    const p1 = new MetaPage(meta);
    text(p1, 'a"b', 0, 0);
    text(p1, 'x', 1000, 0);
    text(p1, 'later', 1000, 500);
    meta.pages.add(p1);
    const p2 = new MetaPage(meta);
    text(p2, 'p2', 0, 0);
    meta.pages.add(p2);
    const lines = (...l: string[]): string => l.join('\n');
    // The columns are those of all the pages: page 2 has the column of 'x' too
    expect(metafileToCsv(meta, { newLine: '\n' })).toBe(lines('"a""b","x"', '"","later"', '', '"p2",""', '', ''));
    expect(metafileToCsv(meta, { fromPage: 2, toPage: 2, separator: ';', delimiter: "'", newLine: '\n' })).toBe(lines("'p2'", '', ''));
  });
});
