// The text device against PrintOutText of C#: each case runs with the TypeScript engine and a
// TextDevice as the layout device, as golden-cs runs it with PrintOutText (same driver, same clock),
// and gives the same layout on the character grid and the same bytes. Regenerate the fixtures with
// test/generate-text-fixtures.mjs.

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { readReportXml } from '@reportman/lib';
import { prepareReport, RpDateTime, type EvalHost } from '@reportman/engine';
import { MetaBarcodeSymbology, MetaFile, MetaPage, PDFFontType, PrintStepType, PrinterSelectType, TextAlignType, TextAlignVerticalType } from '@reportman/metafile';
import { metaFileJson, samplesDb } from '../../reportman-engine/test/golden-run.js';
import { sqliteHost } from '../../reportman-engine/test/sqlite-host.js';
import { TextDevice, decodeCp437, encodeLatin1, encodeOem, encodeUtf8, runReportToText, type TextPrinterConfig } from '../src/text.js';
import { dec, decDivide, decMultiply, decRound } from '../src/text-decimal.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const fixtures = path.join(here, 'fixtures/text');

interface TextCase {
  name: string;
  report: string;
  params?: Record<string, string>;
  culture?: string;
  driver: string;
  oem?: boolean;
  fullPlain?: boolean;
  clock: string;
}
const cases = JSON.parse(fs.readFileSync(path.join(fixtures, 'cases.json'), 'utf8')) as TextCase[];

interface JsonObject {
  class: string;
  Left: number;
  Top: number;
  Width: number;
  Height: number;
  text?: string;
  Symbology?: number;
  Ecc?: number;
  Modules?: number;
  Rows?: number;
  Columns?: number;
  Flags?: number;
}

/** The objects of a metafile as the generator keeps them: [class, left, top, width, height, text?]. */
function layout(meta: MetaFile): unknown {
  const j = metaFileJson(meta) as { pageSizeIndex: number; customX: number; customY: number; orientation: string; pages: { objects: JsonObject[] }[] };
  return {
    pageSizeIndex: j.pageSizeIndex,
    customX: j.customX,
    customY: j.customY,
    orientation: j.orientation,
    pages: j.pages.map((p) =>
      p.objects.map((o) => {
        const r: unknown[] = [o.class.replace('MetaObject', ''), o.Left, o.Top, o.Width, o.Height];
        if (o.class === 'MetaObjectText') r.push(o.text);
        if (o.class === 'MetaObjectBarcode') r.push(o.Symbology, o.Ecc, o.Modules, o.Rows, o.Columns, o.Flags);
        return r;
      }),
    ),
  };
}

async function runText(c: TextCase): Promise<{ bytes: Uint8Array; meta: MetaFile }> {
  const model = readReportXml(new Uint8Array(fs.readFileSync(path.resolve(here, c.report))));
  const [y, mo, d, h, mi, s] = c.clock.split(/[-T:]/).map(Number) as [number, number, number, number, number, number];
  const now = RpDateTime.create(y, mo, d, h, mi, s);
  const host: EvalHost = { now: () => now, fileExists: () => false };
  const device = new TextDevice({ driver: c.driver, oemConvert: c.oem, fullPlain: c.fullPlain });
  const run = await prepareReport(model, { device, data: sqliteHost(samplesDb), culture: c.culture ?? 'en-US', host });
  for (const [k, v] of Object.entries(c.params ?? {})) run.setParameterValue(k, v);
  const bytes = await runReportToText(run);
  return { bytes, meta: run.metaFile };
}

/** The first line that differs, for a readable failure. */
function firstDifference(ts: Uint8Array, cs: Uint8Array): string {
  const a = Buffer.from(ts).toString('latin1').split('\n');
  const b = Buffer.from(cs).toString('latin1').split('\n');
  for (let i = 0; i < Math.max(a.length, b.length); i++)
    if (a[i] !== b[i]) return `line ${i + 1}\n  ts: ${JSON.stringify(a[i])}\n  cs: ${JSON.stringify(b[i])}`;
  return 'same lines';
}

describe('TextDevice against PrintOutText of C#', () => {
  for (const c of cases) {
    it(c.name, async () => {
      const { bytes, meta } = await runText(c);
      const expectedLayout = JSON.parse(fs.readFileSync(path.join(fixtures, c.name + '.layout.json'), 'utf8')) as unknown;
      expect(layout(meta)).toEqual(expectedLayout);
      const expected = new Uint8Array(fs.readFileSync(path.join(fixtures, c.name + '.txt')));
      if (Buffer.compare(Buffer.from(bytes), Buffer.from(expected)) !== 0) {
        fs.writeFileSync(path.join(os.tmpdir(), 'rm-text-' + c.name + '.ts.txt'), bytes);
        expect.fail(c.name + ': the bytes differ at ' + firstDifference(bytes, expected));
      }
    });
  }
});

describe('the code pages against .NET', () => {
  interface CodePage {
    codepage: number;
    map?: number[][];
    cases: { units: number[]; direct: number[]; convert: number[]; utf8: number[] }[];
  }
  const read = (cp: number): CodePage => JSON.parse(fs.readFileSync(path.join(fixtures, 'cp' + cp + '.json'), 'utf8')) as CodePage;
  const encoders: [number, (s: string) => Uint8Array][] = [
    [850, (t) => encodeOem(t, 850)],
    [858, (t) => encodeOem(t, 858)],
    // The data of the ESC/POS barcodes
    [28591, encodeLatin1],
  ];
  for (const [cp, encode] of encoders) {
    it('writes every UTF-16 code unit as .NET in ' + cp, () => {
      const j = read(cp);
      const expected = new Map(j.map!.map((e) => [e[0]!, e[1]!]));
      const text = [];
      const bytes = [];
      for (let c = 0; c < 0x10000; c++) {
        if (c >= 0xd800 && c <= 0xdfff) continue;
        text.push(String.fromCharCode(c));
        bytes.push(expected.get(c) ?? 0x3f);
      }
      expect([...encode(text.join(''))]).toEqual(bytes);
      // Surrogates (alone or in pairs) and combining marks, written directly and through UTF-8
      for (const k of j.cases) {
        expect([...encode(String.fromCharCode(...k.units))]).toEqual(k.direct);
        expect(k.convert).toEqual(k.direct);
      }
    });
  }
  it('writes UTF-8 as .NET, lone surrogates as U+FFFD', () => {
    for (const k of read(65001).cases) {
      const s = String.fromCharCode(...k.units);
      expect([...encodeUtf8(s)]).toEqual(k.utf8);
      expect(k.direct).toEqual(k.utf8);
    }
  });
  it('reads code page 437 as .NET (the text format of Reportman.Server)', () => {
    const decode = (JSON.parse(fs.readFileSync(path.join(fixtures, 'cp437.json'), 'utf8')) as { decode: number[][] }).decode;
    const all = Uint8Array.from({ length: 256 }, (_, i) => i);
    expect([...decodeCp437(all)].map((ch) => [ch.charCodeAt(0)])).toEqual(decode);
  });
});

describe('the decimal arithmetic of PrintOutText', () => {
  it('rounds the lines and the line spacing as System.Decimal does', () => {
    // 16200 twips at 6 lpi is 67.5 lines, exact: to even
    expect(decRound(decMultiply(decDivide(dec(16200), dec(1440)), decDivide(dec(600), dec(100))))).toBe(68n);
    // 1.0m / 9.6m * 216 = 22.500000000000000000000000007: up
    const q = decDivide({ m: 10n, s: 1 }, decDivide(dec(960), dec(100)));
    expect(q).toEqual({ m: 1041666666666666666666666667n, s: 28 });
    expect(decMultiply(q, dec(216))).toEqual({ m: 22500000000000000000000000007n, s: 27 });
    expect(decRound(decMultiply(q, dec(216)))).toBe(23n);
  });
});

describe('TextDevice', () => {
  const text = (page: MetaPage, t: string, left: number, top: number, width: number, fontSize = 12) =>
    page.drawText(left, top, width, 240, t, 'Arial', 'Helvetica', fontSize, 0, 0, 0xffffff, true, 0,
      PDFFontType.Helvetica, TextAlignType.Left, TextAlignVerticalType.Top, false, false, false, PrintStepType.BySize);
  const metafile = (): MetaFile => {
    const meta = new MetaFile();
    meta.linesPerInch = 600;
    meta.customX = 1440 * 4;
    meta.customY = 1440;
    const p1 = new MetaPage(meta);
    // The pages after the first take their size from the detail of the first (A4 by default)
    p1.pageDetail.custom = true;
    p1.pageDetail.customWidth = meta.customX;
    p1.pageDetail.customHeight = meta.customY;
    text(p1, 'Hello', 0, 0, 1440);
    text(p1, 'Año 100 €', 1440, 240, 2880);
    meta.pages.add(p1);
    const p2 = new MetaPage(meta);
    text(p2, 'Second', 0, 480, 1440);
    meta.pages.add(p2);
    return meta;
  };

  it('prints a complete metafile, every line of each page, in code page 850', () => {
    const device = new TextDevice();
    expect(device.print(metafile())).toBe(true);
    const lines = (...l: string[]): string => l.map((x) => x + '\r\n').join('');
    // 6 lines per page (1 inch at 6 lpi), 40 columns at 10 cpi
    const expected = lines('Hello', '          A\xa4o 100 ?', '', '', '', '') + lines('', '', 'Second', '', '', '');
    expect(Buffer.from(device.printResult).toString('latin1')).toBe(expected);
    expect(device.blacklines).toBe(3);
    expect(device.whitelines).toBe(9);
  });

  it('prints a page range, and in UTF-8 without the OEM conversion', () => {
    const device = new TextDevice({ oemConvert: false });
    device.fromPage = 1;
    device.toPage = 1;
    device.print(metafile());
    expect(Buffer.from(device.printResult).toString('utf8')).toBe('Hello\r\n          Año 100 €\r\n\r\n\r\n\r\n\r\n');
  });

  it('takes the driver from the printer configuration when none is forced', () => {
    const config: TextPrinterConfig = {
      driverName: (select) => (select === PrinterSelectType.TicketPrinter ? 'EPSON' : ''),
      oemConvert: () => true,
      cutPaperOption: () => true,
      cutPaperOperation: () => Uint8Array.of(29, 86, 0),
      openDrawerOption: () => false,
      openDrawerOperation: () => new Uint8Array(0),
    };
    const meta = metafile();
    meta.printerSelect = PrinterSelectType.TicketPrinter;
    const device = new TextDevice({ driver: '', printerConfig: config });
    device.print(meta);
    expect(device.printerDriver).toBe('EPSON');
    const out = device.printResult;
    // ESC @, ESC 2 (1/6), ESC C 6 (page length) and ESC - 0 (normal) first; ESC @ and the cut last
    expect([...out.subarray(0, 10)]).toEqual([27, 64, 27, 50, 27, 67, 6, 27, 45, 0]);
    expect([...out.subarray(out.length - 5)]).toEqual([27, 64, 29, 86, 0]);
  });

  it('measures on the character grid of the driver', () => {
    const device = new TextDevice({ driver: 'EPSON' });
    device.newDocument(metafile());
    const t = { text: 'abcdefghij', lFontName: '', wFontName: '', fontSize: 8, fontRotation: 0, fontStyle: 0, fontColor: 0,
      type1Font: PDFFontType.Helvetica, cutText: false, alignment: 0, wordWrap: true, rightToLeft: false, printStep: PrintStepType.BySize, isHtml: false };
    // 8 points is 17 cpi: 84 twips a character, two lines in 600 twips
    expect(device.textExtent(t, { x: 600, y: 0 })).toEqual({ x: 588, y: 480 });
    // EPSON has no 12 cpi: 10 points print at 17 cpi
    expect(device.nearestFontStep(PrintStepType.cpi12)).toBe(PrintStepType.cpi17);
  });

  it('draws the barcodes by itself on the ESC/POS drivers only', () => {
    expect(new TextDevice({ driver: 'EPSONTM88II' }).supportsNativeBarcode(MetaBarcodeSymbology.QR)).toBe(true);
    expect(new TextDevice({ driver: 'EPSONTM88II' }).supportsNativeBarcode(MetaBarcodeSymbology.Unknown)).toBe(false);
    expect(new TextDevice({ driver: 'EPSONTMU210' }).supportsNativeBarcode(MetaBarcodeSymbology.QR)).toBe(false);
    expect(new TextDevice().supportsNativeBarcode(MetaBarcodeSymbology.Code128)).toBe(false);
  });
});
