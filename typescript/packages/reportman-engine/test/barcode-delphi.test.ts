// The barcodes against the Delphi engine, the reference: the bc-delphi-* reports run here and each
// barcode gives the bars the Delphi engine draws for it (fixtures/barcode/NAME.delphi.json.gz,
// from generate-barcode-delphi-fixtures.mjs), rectangle by rectangle; and the bars read back, the
// way a scanner reads them, as the text of the item. (barcode-parity.test.ts checks that the C#
// engine gives these same metafiles.) Where the Delphi engine is the one that is wrong, the
// difference is told here, case by case.

import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { describe, expect, it } from 'vitest';
import { here, metaFileJson, runLikeGolden } from './golden-run.js';
import { readCodabar, readCode93, readMatrix25, readMsi, readPostNet, type Bar } from './barcode-readers.js';

const fixtures = path.join(here, 'fixtures/barcode');

interface Barcode {
  label: string;
  bars: Bar[];
}

/** The barcodes the Delphi engine draws for a report, by their label. */
function delphi(name: string): Map<string, Barcode> {
  const pages = JSON.parse(zlib.gunzipSync(fs.readFileSync(path.join(fixtures, name + '.delphi.json.gz'))).toString('utf8')) as Barcode[][];
  return new Map(pages.flat().map((b) => [b.label, b]));
}

/** The barcodes this engine draws for a report, by their label: the rectangles before each label. */
async function engine(name: string): Promise<Map<string, Barcode>> {
  const { meta } = await runLikeGolden(path.join(fixtures, name + '.rep'));
  const json = metaFileJson(meta) as { pages: { objects: Record<string, unknown>[] }[] };
  const out = new Map<string, Barcode>();
  for (const page of json.pages) {
    let bars: Bar[] = [];
    for (const o of page.objects) {
      if (o.class === 'MetaObjectText') {
        out.set(o.text as string, { label: o.text as string, bars });
        bars = [];
      } else if (o.class === 'MetaObjectDraw') {
        bars.push([o.Left, o.Top, o.Width, o.Height, o.BrushColor] as unknown as Bar);
      }
    }
  }
  return out;
}

describe('linear barcodes against the Delphi engine', () => {
  const reference = delphi('bc-delphi-linear');
  const drawn = engine('bc-delphi-linear');
  const labels = [...reference.keys()];

  // Code 93 extended is not what Delphi draws: see below
  it.each(labels.filter((l) => !l.startsWith('code93x')))('draws the bars of Delphi: %s', async (label) => {
    const ours = (await drawn).get(label)!;
    const theirs = reference.get(label)!;
    expect(theirs.bars.length).toBeGreaterThan(0);
    expect(ours.bars.length).toBe(theirs.bars.length);
    expect(ours.bars).toEqual(theirs.bars);
  });

  it('MSI reads as its digits and a check digit', async () => {
    const d = await drawn;
    expect(readMsi(d.get('msi 123456')!.bars).slice(0, -1)).toBe('123456');
    expect(readMsi(d.get('msi 12345')!.bars).slice(0, -1)).toBe('12345');
    expect(readMsi(d.get('msi 0')!.bars).slice(0, -1)).toBe('0');
    expect(readMsi(d.get('msi 20 digits')!.bars).slice(0, -1)).toBe('98765432109876543210');
    expect(readMsi(d.get('msi 80523')!.bars).slice(0, -1)).toBe('80523');
    expect(readMsi(d.get('msi empty')!.bars).length).toBe(1);
  });

  it('PostNet reads as its digits', async () => {
    const d = await drawn;
    expect(readPostNet(d.get('postnet 12345')!.bars).digits).toBe('12345');
    expect(readPostNet(d.get('postnet 801221905')!.bars).digits).toBe('801221905');
    expect(readPostNet(d.get('postnet 0123456789')!.bars).digits).toBe('0123456789');
    expect(readPostNet(d.get('postnet empty')!.bars).digits).toBe('');
  });

  it('Codabar reads as its text between the start A and the stop B', async () => {
    const d = await drawn;
    expect(readCodabar(d.get('codabar 1234')!.bars)).toBe('A1234B');
    expect(readCodabar(d.get('codabar all')!.bars)).toBe('A0123456789-$:/.+B');
    expect(readCodabar(d.get('codabar 40156')!.bars)).toBe('A40156B');
    expect(readCodabar(d.get('codabar 12.50+3')!.bars)).toBe('A12.50+3B');
    expect(readCodabar(d.get('codabar empty')!.bars)).toBe('AB');
  });

  it('2 of 5 matrix reads as its digits', async () => {
    const d = await drawn;
    expect(readMatrix25(d.get('matrix 1234')!.bars)).toBe('1234');
    expect(readMatrix25(d.get('matrix 9081726354')!.bars)).toBe('9081726354');
    expect(readMatrix25(d.get('matrix 5')!.bars)).toBe('5');
  });

  it('Code 93 reads as its text', async () => {
    const d = await drawn;
    expect(readCode93(d.get('code93 CODE93')!.bars)).toBe('CODE93');
    expect(readCode93(d.get('code93 14')!.bars)).toBe('ABCDEFGHIJKLMN');
  });

  it('Code 93 extended writes the text: Delphi writes a NUL before it and loses its last character', async () => {
    // Code_93Extended of Delphi (rpmdbarcode.pas) walks the text from 0 to Length - 1: index 0 of
    // an AnsiString is the last byte of its length (0), and the last character is never read
    const label = 'code93x Code 93x';
    expect(readCode93((await drawn).get(label)!.bars)).toBe('Code 93x');
    expect(readCode93(reference.get(label)!.bars)).toBe('\0Code 93');
  });
});
