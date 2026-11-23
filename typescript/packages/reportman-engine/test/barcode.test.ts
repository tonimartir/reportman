// Barcodes beyond what golden-cs can show: the barcode object of a device that draws barcodes by
// itself (an ESC/POS receipt printer, never the PDF device of golden-cs) and the PDF417 escapes
// the text compaction cannot write.

import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { readReportXml, type BarcodeItem as BarcodeModel, type Report } from '@reportman/lib';
import { MetaBarcodeEcc, MetaBarcodeSymbology, MetaObjectBarcode, MetaObjectDraw } from '@reportman/metafile';
import { PdfDevice } from '@reportman/pdf';
import { NotSupportedYetError, prepareReport, RpDateTime } from '@reportman/engine';
import { zxingLinearModules } from '../src/report/barcode/zxingwidth.js';
import { here, samplesDb } from './golden-run.js';
import { sqliteHost } from './sqlite-host.js';

const fixtures = path.join(here, 'fixtures/barcode');

function model(name: string): Report {
  return readReportXml(new Uint8Array(fs.readFileSync(path.join(fixtures, name + '.rep'))));
}

/** A device that draws some barcode symbologies by itself. */
class NativeDevice extends PdfDevice {
  constructor(private readonly symbologies: MetaBarcodeSymbology[]) {
    super();
  }

  override supportsNativeBarcode(symbology: MetaBarcodeSymbology): boolean {
    return this.symbologies.includes(symbology);
  }
}

async function execute(report: Report, device: PdfDevice) {
  const run = await prepareReport(report, {
    device,
    data: sqliteHost(samplesDb),
    host: { now: () => RpDateTime.create(2026, 1, 1), fileExists: () => false },
  });
  return run.execute();
}

describe('a device that draws barcodes by itself', () => {
  it('gets a QR as a barcode object, with the grid of ZXing (quiet zone included)', async () => {
    const meta = await execute(model('bc-qr'), new NativeDevice([MetaBarcodeSymbology.QR]));
    const page = meta.pages.get(0);
    const barcodes = page.objects.filter((o): o is MetaObjectBarcode => o instanceof MetaObjectBarcode);
    expect(page.objects.some((o) => o instanceof MetaObjectDraw)).toBe(false);
    expect(barcodes.length).toBe(23);
    const first = barcodes[0]!;
    expect(page.getText(first)).toBe('Hello');
    expect(first).toMatchObject({ left: 574, top: 574, width: 1000, height: 1000, symbology: MetaBarcodeSymbology.QR, modules: 29, rows: 29 });
    // ECCLevel -1, 2, 3, 4, 5, 1 and 8
    expect(barcodes.slice(0, 7).map((b) => b.ecc)).toEqual([
      MetaBarcodeEcc.L,
      MetaBarcodeEcc.L,
      MetaBarcodeEcc.M,
      MetaBarcodeEcc.Q,
      MetaBarcodeEcc.H,
      MetaBarcodeEcc.L,
      MetaBarcodeEcc.L,
    ]);
    // A wide box: the same grid, the box of the item
    const wide = barcodes.find((b) => page.getText(b) === 'A')!;
    expect(wide).toMatchObject({ width: 2500, height: 900, modules: 29, rows: 29 });
  });

  it('draws the other symbologies as bars when it only draws QR codes', async () => {
    const meta = await execute(model('bc-code128'), new NativeDevice([MetaBarcodeSymbology.QR]));
    expect(meta.pages.get(0).objects.some((o) => o instanceof MetaObjectBarcode)).toBe(false);
  });

  it('gets a linear barcode as a barcode object, with the modules ZXing gives C#', async () => {
    const meta = await execute(model('bc-code128'), new NativeDevice([MetaBarcodeSymbology.Code128]));
    const page = meta.pages.get(0);
    const barcodes = page.objects.filter((o): o is MetaObjectBarcode => o instanceof MetaObjectBarcode);
    // 28 items: the empty text and the five ZXing refuses (beyond ASCII: the ¿ that stands for
    // FNC1 in the engine, Ñandú €) are drawn as bars, as in C#
    expect(barcodes.length).toBe(22);
    expect(page.objects.some((o) => o instanceof MetaObjectDraw)).toBe(true);
    expect(barcodes.some((b) => /[^\0-\x7f]/.test(page.getText(b)))).toBe(false);
    for (const b of barcodes) {
      expect(b.symbology).toBe(MetaBarcodeSymbology.Code128);
      expect(b.modules).toBe(zxingLinearModules(MetaBarcodeSymbology.Code128, page.getText(b)));
    }
  });

  it('is not supported yet for PDF417', async () => {
    await expect(execute(model('bc-pdf417'), new NativeDevice([MetaBarcodeSymbology.PDF417]))).rejects.toThrow(NotSupportedYetError);
    await expect(execute(model('bc-pdf417'), new NativeDevice([MetaBarcodeSymbology.PDF417]))).rejects.toThrow(
      /PDF417 barcodes drawn by the device itself/,
    );
  });
});

describe('PDF417 escapes', () => {
  // The text compaction stops at an escape it cannot write (a character without a text value, the
  // \G macro) and would be called again at the same position for ever: an error, as in C#
  // (bc-err-pdf417esc of the parity cases).
  it.each(['esc \\200 high', '\\005 no text value', 'G macro \\G123456 x', 'hex \\XZZ bad', 'hex \\XFF high'])(
    'fails clearly on an escape the text compaction cannot write: %s',
    async (text) => {
      const report = model('bc-err-pdf417x');
      const item = report.subReports[0]!.sections[0]!.components[0] as BarcodeModel;
      item.expression = "'" + text + "'";
      await expect(execute(report, new PdfDevice())).rejects.toThrow(
        /PDF417: the text compaction cannot write the escape at character \d+ of the text:Error calculating barcode/,
      );
    },
  );

  it('writes the escapes it can write', async () => {
    const report = model('bc-err-pdf417x');
    const item = report.subReports[0]!.sections[0]!.components[0] as BarcodeModel;
    item.expression = "'esc \\065 \\X42 \\\\ \\C900 end'";
    const meta = await execute(report, new PdfDevice());
    expect(meta.pages.get(0).objects.length).toBeGreaterThan(100);
  });
});
