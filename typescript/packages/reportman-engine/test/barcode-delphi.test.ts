// The barcodes against the Delphi engine, the reference: the bc-delphi-* reports run here and each
// barcode gives the bars the Delphi engine draws for it (fixtures/barcode/NAME.delphi.json.gz,
// from generate-barcode-delphi-fixtures.mjs), rectangle by rectangle; and the bars read back, the
// way a scanner reads them, as the text of the item. (barcode-parity.test.ts checks that the C#
// engine gives these same metafiles.)
//
// The fixtures are those of the Delphi engine after the fixes of rpmdbarcode.pas that this work
// found (the loop of Code 93 extended, the weights of the Code 93 check characters, the Mod 10
// check digit of MSI, the short bars of PostNet on the base line, the last character and the
// repeated character of PDF417, its codeword escapes and its error correction levels 6 to 8, the
// text of a QR beyond code page 1252): every barcode here is bar by bar the one of Delphi, but for
// the cases of barcode-delphi-cases.json that keep a "delphi" mark.

import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { describe, expect, it } from 'vitest';
import { here, metaFileJson, runLikeGolden } from './golden-run.js';
import { toAnsi } from '../src/report/barcode/pdf417.js';
import {
  msiMod10,
  pdf417ErrorCorrection,
  pdf417Text,
  readCodabar,
  readCode93,
  readMatrix25,
  readMsi,
  readPdf417,
  readPostNet,
  readQr,
  type Bar,
} from './barcode-readers.js';

const fixtures = path.join(here, 'fixtures/barcode');

/** A case of barcode-delphi-cases.json. */
interface DelphiCase {
  caption: string;
  text: string;
  /** What the symbol says when it is not the text as it is (escapes, characters out of the code page). */
  expect?: string;
  /** The symbol of Delphi is another one: what it says. */
  delphi?: string;
  /** The ECCLevel of the item. */
  ECCLEVEL?: number;
}
const delphiCases = JSON.parse(fs.readFileSync(path.join(here, 'barcode-delphi-cases.json'), 'utf8')) as { pdf417: DelphiCase[]; qr: DelphiCase[] };

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

/** The same bars, one by one. */
function expectSameBars(ours: Barcode, theirs: Barcode): void {
  expect(theirs.bars.length).toBeGreaterThan(0);
  expect(ours.bars.length).toBe(theirs.bars.length);
  expect(ours.bars).toEqual(theirs.bars);
}

describe('linear barcodes against the Delphi engine', () => {
  const reference = delphi('bc-delphi-linear');
  const drawn = engine('bc-delphi-linear');

  it.each([...reference.keys()])('draws the bars of Delphi: %s', async (label) => {
    expectSameBars((await drawn).get(label)!, reference.get(label)!);
  });

  it.each([
    ['msi 123456', '123456'],
    ['msi 12345', '12345'],
    ['msi 0', '0'],
    ['msi 20 digits', '98765432109876543210'],
    ['msi 80523', '80523'],
    ['msi empty', ''],
  ])('MSI reads as its digits and their Mod 10 check digit: %s', async (label, text) => {
    expect(readMsi((await drawn).get(label)!.bars)).toBe(text + String(msiMod10(text)));
  });

  it('the Mod 10 check digit of 123456 is 6', () => {
    expect(msiMod10('123456')).toBe(6);
  });

  it.each([
    ['postnet 12345', '12345'],
    ['postnet 801221905', '801221905'],
    ['postnet 0123456789', '0123456789'],
  ])('PostNet reads as its digits, the short bars on the base line: %s', async (label, text) => {
    expect(readPostNet((await drawn).get(label)!.bars)).toEqual({ digits: text, aligned: 'bottom' });
  });

  it('PostNet of no digits is its two frame bars', async () => {
    expect(readPostNet((await drawn).get('postnet empty')!.bars)).toEqual({ digits: '', aligned: 'none' });
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

  it('Code 93 reads as its text, over the 14 characters where the weight of its K check character restarts too', async () => {
    const d = await drawn;
    expect(readCode93(d.get('code93 CODE93')!.bars)).toBe('CODE93');
    expect(readCode93(d.get('code93 14')!.bars)).toBe('ABCDEFGHIJKLMN');
    expect(readCode93(d.get('code93 15')!.bars)).toBe('ABCDEFGHIJKLMNO');
    expect(readCode93(d.get('code93 36')!.bars)).toBe('THE QUICK BROWN FOX 0123456789-.$/+%');
  });

  it('Code 93 extended reads as its text', async () => {
    const d = await drawn;
    expect(readCode93(d.get('code93x Code 93x')!.bars)).toBe('Code 93x');
    // 23 characters of Code 93
    expect(readCode93(d.get('code93x Hello, World!')!.bars)).toBe('Hello, World!');
  });
});

describe('PDF417 against the Delphi engine', () => {
  const reference = delphi('bc-delphi-pdf417');
  const drawn = engine('bc-delphi-pdf417');
  const cases = delphiCases.pdf417;
  /** What a reader gets: the bytes of the text in code page 1252, or what its escapes say. */
  const said = (c: DelphiCase): string => c.expect ?? toAnsi(c.text);

  it.each(cases.filter((c) => c.delphi === undefined))('draws the bars of Delphi: $caption', async (c) => {
    expectSameBars((await drawn).get(c.caption)!, reference.get(c.caption)!);
  });

  it.each(cases)('reads back as the text, with the error correction of its level: $caption', async (c) => {
    const symbol = readPdf417((await drawn).get(c.caption)!.bars);
    expect(pdf417Text(symbol.codewords)).toBe(said(c));
    const k = 2 ** (symbol.level + 1);
    const data = symbol.codewords.slice(0, symbol.codewords.length - k);
    expect(data.length).toBe(symbol.codewords[0]);
    expect(symbol.codewords.slice(data.length)).toEqual(pdf417ErrorCorrection(data, k));
  });

  // The one difference left: a character code page 1252 does not have. Delphi turns the text into
  // an AnsiString with the best fit of Windows, which gives some of those characters a similar
  // letter (the Greek capital omega, O); here every one of them is a question mark.
  it.each(cases.filter((c) => c.delphi !== undefined))('Delphi writes a similar letter for a character out of code page 1252: $caption', (c) => {
    expect(pdf417Text(readPdf417(reference.get(c.caption)!.bars).codewords)).toBe(c.delphi);
    expect(c.delphi).not.toBe(said(c));
  });

  it('only the best fit case is not the symbol of Delphi', () => {
    expect(cases.filter((c) => c.delphi !== undefined).map((c) => c.caption)).toEqual(['best fit of Windows']);
  });
});

// The QR symbols of both engines are the same for the same text at the same error correction
// level: the same version, mask and modules, with the same quiet zone of four modules (both
// encoders are ports of ZXing). What differs is the number of the level in the item: ECCLevel 3 is
// M here and H in Delphi (2 L, 3 M, 4 Q, 5 H and any other value L here; 1 M, 2 Q, 3 H and any
// other value L in Delphi), so the same report gives another symbol in each engine. The fixture
// of Delphi is drawn with the level that means the same.
describe('QR against the Delphi engine', () => {
  const reference = delphi('bc-delphi-qr');
  const drawn = engine('bc-delphi-qr');
  const cases = delphiCases.qr;
  const level = (c: DelphiCase): string => ({ 3: 'M', 4: 'Q', 5: 'H' })[c.ECCLEVEL ?? -1] ?? 'L';

  it.each(cases)('draws the modules of Delphi: $caption', async (c) => {
    expect(c.delphi).toBeUndefined();
    expectSameBars((await drawn).get(c.caption)!, reference.get(c.caption)!);
  });

  it.each(cases)('reads back as the text, at its error correction level: $caption', async (c) => {
    const symbol = readQr((await drawn).get(c.caption)!.bars);
    expect(symbol.text).toBe(c.text);
    expect(symbol.level).toBe(level(c));
  });
});
