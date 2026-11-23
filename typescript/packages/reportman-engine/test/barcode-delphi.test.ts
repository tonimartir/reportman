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
import { elements, msiMod10, readCodabar, readCode93, readMatrix25, readMsi, readPostNet, type Bar } from './barcode-readers.js';

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

  // Where Delphi is wrong the bars are others, each case in its test below: the check digit of
  // MSI, the short bars of PostNet, the check characters of a Code 93 over 14 characters and the
  // whole of Code 93 extended
  const wrongInDelphi = (l: string): boolean =>
    l.startsWith('msi ') || (l.startsWith('postnet ') && l !== 'postnet empty') || l === 'code93 15' || l === 'code93 36' || l.startsWith('code93x');

  it.each(labels.filter((l) => !wrongInDelphi(l)))('draws the bars of Delphi: %s', async (label) => {
    const ours = (await drawn).get(label)!;
    const theirs = reference.get(label)!;
    expect(theirs.bars.length).toBeGreaterThan(0);
    expect(ours.bars.length).toBe(theirs.bars.length);
    expect(ours.bars).toEqual(theirs.bars);
  });

  it.each([
    ['msi 123456', '123456'],
    ['msi 12345', '12345'],
    ['msi 0', '0'],
    ['msi 20 digits', '98765432109876543210'],
    ['msi 80523', '80523'],
    ['msi empty', ''],
  ])('MSI draws the bars of Delphi but for the check digit, the Mod 10 one: %s', async (label, text) => {
    const ours = (await drawn).get(label)!.bars;
    const theirs = reference.get(label)!.bars;
    const read = readMsi(ours);
    expect(read).toBe(text + String(msiMod10(text)));
    // Code_MSI of Delphi adds the character codes of the digits (ord(FText[i])), not their
    // values, and takes the alternate digits from the left: its check digit is another one
    // (the same by chance for some texts), which a scanner that checks Mod 10 refuses
    const delphiRead = readMsi(theirs);
    expect(delphiRead.slice(0, -1)).toBe(text);
    if (delphiRead === read) {
      expect(ours).toEqual(theirs);
      return;
    }
    // The same bars everywhere but in the check digit: eight elements before the three of the stop
    const a = elements(ours);
    const b = elements(theirs);
    expect(a.length).toBe(b.length);
    const check = a.length - 11;
    expect(a.slice(0, check)).toEqual(b.slice(0, check));
    expect(a.slice(check + 8)).toEqual(b.slice(check + 8));
    expect(ours.length).toBe(theirs.length);
    expect(ours[0]).toEqual(theirs[0]);
    expect(ours[ours.length - 1]).toEqual(theirs[theirs.length - 1]);
  });

  it('the check digit of MSI that Delphi draws is not the Mod 10 one', () => {
    // 123456: Mod 10 is 6, Delphi draws 2. When Delphi is fixed this fails: the bars are then
    // the same and the test above compares them all.
    expect(readMsi(reference.get('msi 123456')!.bars)).toBe('1234562');
    expect(msiMod10('123456')).toBe(6);
  });

  it.each([
    ['postnet 12345', '12345'],
    ['postnet 801221905', '801221905'],
    ['postnet 0123456789', '0123456789'],
  ])('PostNet draws the bars of Delphi with the short ones on the base line: %s', async (label, text) => {
    const ours = (await drawn).get(label)!.bars;
    const theirs = reference.get(label)!.bars;
    expect(readPostNet(ours)).toEqual({ digits: text, aligned: 'bottom' });
    // DoLines of Delphi draws a short bar from the top of the item (its height is 2/5 of it):
    // the symbol upside down, which reads as other digits
    expect(readPostNet(theirs)).toEqual({ digits: text, aligned: 'top' });
    expect(ours.length).toBe(theirs.length);
    const height = Math.max(...theirs.map((b) => b[3]));
    for (let i = 0; i < ours.length; i++) {
      const [left, top, width, h, color] = theirs[i]!;
      // The same bar, a short one moved down to end where the tall ones end
      expect(ours[i]).toEqual([left, top + (height - h), width, h, color]);
    }
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
    expect(readCode93(d.get('code93 15')!.bars)).toBe('ABCDEFGHIJKLMNO');
    expect(readCode93(d.get('code93 36')!.bars)).toBe('THE QUICK BROWN FOX 0123456789-.$/+%');
  });

  it.each(['code93 15', 'code93 36'])('Code 93 over 14 characters draws the bars of Delphi but for the check characters: %s', async (label) => {
    const ours = (await drawn).get(label)!.bars;
    const theirs = reference.get(label)!.bars;
    // Code_93 of Delphi restarts the weight of the C check character where the weight of K has
    // to restart (if weightK > 15 then weightC := 1): from the fifteenth character on both check
    // characters are wrong, and a reader refuses the symbol
    expect(() => readCode93(theirs)).toThrow();
    const a = elements(ours);
    const b = elements(theirs);
    expect(a.length).toBe(b.length);
    // Six elements per check character, before the seven of the stop
    const check = a.length - 7 - 12;
    expect(a.slice(0, check)).toEqual(b.slice(0, check));
    expect(a.slice(check + 12)).toEqual(b.slice(check + 12));
    expect(a.slice(check, check + 12)).not.toEqual(b.slice(check, check + 12));
  });

  it('Code 93 extended writes the text: Delphi writes a NUL before it and loses its last character', async () => {
    // Code_93Extended of Delphi (rpmdbarcode.pas) walks the text from 0 to Length - 1: index 0 of
    // an AnsiString is the last byte of its length (0), and the last character is never read
    const d = await drawn;
    expect(readCode93(d.get('code93x Code 93x')!.bars)).toBe('Code 93x');
    expect(readCode93(reference.get('code93x Code 93x')!.bars)).toBe('\0Code 93');
    // 23 characters of Code 93: readable with the check characters right
    expect(readCode93(d.get('code93x Hello, World!')!.bars)).toBe('Hello, World!');
    expect(() => readCode93(reference.get('code93x Hello, World!')!.bars)).toThrow();
  });
});
