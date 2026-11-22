// The .rpmf format on metafiles made by hand: what the fixtures of the C# engine
// (reportman-engine/test/rpmf-parity.test.ts) do not reach: every object class, the 07 and 41
// versions, the quirks of the C# records and the errors of the reader.

import zlib from 'node:zlib';
import { describe, expect, it } from 'vitest';
import {
  EmbeddedFile,
  MetaBarcodeEcc,
  MetaBarcodeSymbology,
  MetaFile,
  MetaFileVersion,
  MetaObjectBarcode,
  MetaObjectDraw,
  MetaObjectExport,
  MetaObjectImage,
  MetaObjectPolygon,
  MetaObjectText,
  MetaObjectType,
  MetaPage,
  OrientationType,
  PDFAFRelationShip,
  PDFConformanceType,
  PrinterFontsType,
  readRpmf,
  writeRpmf,
} from '@reportman/metafile';

const latin1 = (bytes: Uint8Array, start: number, end: number): string => String.fromCharCode(...bytes.subarray(start, end));
const int32 = (bytes: Uint8Array, at: number): number => new DataView(bytes.buffer, bytes.byteOffset).getInt32(at, true);

/** A page with an object of every class but the polygon (see its own test). */
function richPage(meta: MetaFile): MetaPage {
  const page = new MetaPage(meta);
  meta.pages.add(page);
  const t = page.drawText(-10, 20, 3000, 400, 'Año 😀 €', 'Arial', 'Helvetica', 12, -900, 0xff, -1, true, 3, 5, 1, 2, true, true, true, 3);
  t.rightToLeft = true;
  t.isHtml = true;
  t.annotationP = page.addString('note');
  t.annotationS = 4;
  page.drawShape(1, 2, 3, 4, 5, 2, 3, 20, 0x112233, 0x445566);
  page.drawImage(5, 6, 7, 8, 1, 300, new Uint8Array([1, 2, 3, 4, 5]));
  const shared = new MetaObjectImage();
  shared.metaType = MetaObjectType.Image;
  shared.sharedImage = true;
  shared.streamPos = page.addStream(new Uint8Array([9, 8, 7]), true);
  shared.streamSize = 3;
  page.objects.push(shared);
  const exp = new MetaObjectExport();
  exp.metaType = MetaObjectType.Export;
  Object.assign(exp, { textExpP: page.addString('export'), textExpS: 6, line: 3, position: 4, size: 5, doNewLine: true });
  page.objects.push(exp);
  const bar = new MetaObjectBarcode();
  bar.metaType = MetaObjectType.Barcode;
  Object.assign(bar, { textP: page.addString('12345'), textS: 5, symbology: MetaBarcodeSymbology.QR, ecc: MetaBarcodeEcc.H, modules: 21, rows: 21, columns: 2, flags: 0x300 });
  page.objects.push(bar);
  return page;
}

function richMeta(): MetaFile {
  const meta = new MetaFile();
  Object.assign(meta, {
    pageSizeIndex: -1, customX: 11906, customY: 16838, orientation: OrientationType.Landscape, backColor: -1,
    paperSource: 7, copies: 2, linesPerInch: 600, collateCopies: true, duplex: 1, printerSelect: 3, autoScale: 2,
    previewWindow: 1, openDrawerBefore: true, openDrawerAfter: false, previewAbout: true, previewMargins: true,
  });
  richPage(meta);
  const second = new MetaPage(meta);
  second.updatedPageSize = true;
  second.orientation = OrientationType.Portrait;
  Object.assign(second.pageDetail, { index: 4, custom: false, customWidth: 100, customHeight: 200, physicWidth: 300, physicHeight: 400, paperSource: 2, forcePaperName: 'Letter', duplex: 1 });
  meta.pages.add(second);
  return meta;
}

describe('rpmf writer', () => {
  it('writes the signature of the version, 2.2 as 2.4', () => {
    const sig = (v: MetaFileVersion): string => {
      const meta = new MetaFile();
      meta.version = v;
      return latin1(writeRpmf(meta), 0, 13);
    };
    expect(sig(MetaFileVersion.MetaVersion2_2)).toBe('RPMETAFILE09\0');
    expect(sig(MetaFileVersion.MetaVersion2_4)).toBe('RPMETAFILE09\0');
    expect(sig(MetaFileVersion.MetaVersion3_0)).toBe('RPMETAFILE30\0');
    expect(sig(MetaFileVersion.MetaVersion4_0)).toBe('RPMETAFILE40\0');
    expect(sig(MetaFileVersion.MetaVersion4_1)).toBe('RPMETAFILE41\0');
  });

  it('writes an empty metafile in 71 bytes', () => {
    const bytes = writeRpmf(new MetaFile());
    // Signature, separator, 5 int32, 3 int16, 2 bytes, 3 int32, 2 bytes, 2 int32, page count
    expect(bytes.length).toBe(13 + 4 + 20 + 6 + 2 + 12 + 2 + 8 + 4);
    expect(int32(bytes, 17 + 4)).toBe(12047); // CustomX of a new metafile
  });

  it('writes records of 66 bytes, 74 with annotations (4.0)', () => {
    const size = (v: MetaFileVersion): number => {
      const meta = new MetaFile();
      meta.version = v;
      const page = new MetaPage(meta);
      meta.pages.add(page);
      const empty = writeRpmf(meta).length;
      page.drawShape(0, 0, 1, 1, 0, 0, 0, 0, 0, 0);
      return writeRpmf(meta).length - empty;
    };
    expect(size(MetaFileVersion.MetaVersion2_4)).toBe(66);
    expect(size(MetaFileVersion.MetaVersion3_0)).toBe(66);
    expect(size(MetaFileVersion.MetaVersion4_0)).toBe(74);
  });

  it('raises the version to 4.1 for PrinterFonts = Recalculate, as SaveToStream', () => {
    const meta = richMeta();
    meta.printerFonts = PrinterFontsType.Recalculate;
    const bytes = writeRpmf(meta);
    expect(meta.version).toBe(MetaFileVersion.MetaVersion4_1);
    expect(meta.pages.get(1).version).toBe(MetaFileVersion.MetaVersion4_1);
    expect(latin1(bytes, 0, 12)).toBe('RPMETAFILE41');
    const back = readRpmf(bytes);
    expect(back.printerFonts).toBe(PrinterFontsType.Recalculate);
    expect(writeRpmf(back)).toEqual(bytes);
  });

  it('writes the shared stream before the first page only', () => {
    const meta = new MetaFile();
    meta.sharedStream.write(new Uint8Array([1, 2, 3]));
    const none = writeRpmf(meta);
    meta.pages.add(new MetaPage(meta));
    const one = writeRpmf(meta);
    expect(int32(one, none.length)).toBe(3); // StreamHeader
    expect(one.subarray(none.length + 12, none.length + 15)).toEqual(new Uint8Array([1, 2, 3]));
    expect(int32(one, none.length + 15)).toBe(1); // PageHeader
    expect(readRpmf(one).sharedStream.toUint8Array()).toEqual(new Uint8Array([1, 2, 3]));
  });

  it('writes strings as UTF-8, null as empty, a lone surrogate as U+FFFD', () => {
    const meta = new MetaFile();
    meta.pdfConformance = PDFConformanceType.PDF_A_3;
    meta.docAuthor = 'ñ€😀\ud800x';
    const bytes = writeRpmf(meta);
    expect(int32(bytes, 19)).toBe(2 + 3 + 4 + 3 + 1);
    expect([...bytes.subarray(23, 36)]).toEqual([0xc3, 0xb1, 0xe2, 0x82, 0xac, 0xf0, 0x9f, 0x98, 0x80, 0xef, 0xbf, 0xbd, 0x78]);
    expect(int32(bytes, 36)).toBe(0); // DocCreator: null
    expect(readRpmf(bytes).docAuthor).toBe('ñ€😀\uFFFDx');
  });

  it('writes the polygon record as C# does, the pen fields out of place', () => {
    const meta = new MetaFile();
    const page = new MetaPage(meta);
    meta.pages.add(page);
    const poly = new MetaObjectPolygon();
    poly.metaType = MetaObjectType.Polygon;
    Object.assign(poly, { polyBrushStyle: 1, polyBrushColor: 2, polyPenStyle: 3, polyPenWidth: 4, polyPenColor: 5, polyPointCount: 6, polyStreamPos: 7, polyStreamSize: 2 ** 40 });
    page.objects.push(poly);
    const bytes = writeRpmf(meta);
    const back = readRpmf(bytes).pages.get(0).objects[0];
    // C# parity: MetaObjectPolygon.SaveToStream writes the pen color where FillFromBuf reads the pen
    // width and the brush style where it reads the pen color, so a polygon read and written again
    // changes (the engine makes no polygons)
    expect(back).toBeInstanceOf(MetaObjectPolygon);
    expect(back).toMatchObject({ polyBrushStyle: 1, polyBrushColor: 2, polyPenStyle: 3, polyPenWidth: 5, polyPenColor: 1, polyPointCount: 6, polyStreamPos: 7, polyStreamSize: 2 ** 40 });
    expect(writeRpmf(readRpmf(bytes))).not.toEqual(bytes);
  });

  it('compresses as a zlib stream any zlib reader reads', () => {
    const meta = richMeta();
    const plain = writeRpmf(meta);
    const compressed = writeRpmf(meta, { compressed: true });
    expect(new Uint8Array(zlib.inflateSync(compressed))).toEqual(plain);
    expect(writeRpmf(readRpmf(new Uint8Array(zlib.deflateSync(plain))))).toEqual(plain);
  });
});

describe('rpmf reader', () => {
  it.each([MetaFileVersion.MetaVersion2_4, MetaFileVersion.MetaVersion3_0, MetaFileVersion.MetaVersion4_0])(
    'reads every object class back (version %i)',
    (version) => {
      const meta = richMeta();
      meta.version = version;
      if (version >= MetaFileVersion.MetaVersion3_0) {
        meta.pdfConformance = PDFConformanceType.PDF_A_3;
        meta.pdfCompressed = true;
        meta.docTitle = 'Title';
        meta.docXMPContent = '<x/>';
        meta.newEmbeddedFile('a.xml', 'text/xml', PDFAFRelationShip.Data, 'Data', '2026-01-01', '2026-02-02', new Uint8Array([60, 97, 47, 62]));
      }
      const bytes = writeRpmf(meta);
      const back = readRpmf(bytes);
      expect(writeRpmf(back)).toEqual(bytes);
      expect(back.version).toBe(version);
      expect(back.finished).toBe(true);
      const { pages: _p, ...head } = back as unknown as Record<string, unknown>;
      expect(head).toMatchObject({
        pageSizeIndex: -1, customX: 11906, customY: 16838, orientation: OrientationType.Landscape, backColor: -1,
        paperSource: 7, copies: 2, linesPerInch: 600, collateCopies: true, duplex: 1, printerSelect: 3, autoScale: 2,
        previewWindow: 1, openDrawerBefore: true, openDrawerAfter: false, previewAbout: true, previewMargins: true,
      });
      const page = back.pages.get(0);
      const [t, d, img, shared, exp, bar] = page.objects;
      expect(t).toBeInstanceOf(MetaObjectText);
      expect(page.getText(t as MetaObjectText)).toBe('Año 😀 €');
      expect(t).toMatchObject({ left: -10, fontSize: 12, fontRotation: -900, fontColor: 0xff, backColor: -1, transparent: true, fontStyle: 3, type1Font: 5, cutText: true, wordWrap: true, rightToLeft: true, isHtml: true, printStep: 3 });
      expect(page.getAnnotationText(t as MetaObjectText)).toBe(version >= MetaFileVersion.MetaVersion4_0 ? 'note' : null);
      expect(d).toBeInstanceOf(MetaObjectDraw);
      expect(d).toMatchObject({ drawStyle: 5, brushStyle: 2, penStyle: 3, penWidth: 20, penColor: 0x112233, brushColor: 0x445566 });
      expect(page.getStream(img as MetaObjectImage)).toEqual(new Uint8Array([1, 2, 3, 4, 5]));
      expect(img).toMatchObject({ copyMode: 20, drawImageStyle: 1, dpiRes: 300, sharedImage: false });
      expect(page.getStream(shared as MetaObjectImage)).toEqual(new Uint8Array([9, 8, 7]));
      // C# parity: the export record has the text position where the length goes
      expect(exp).toBeInstanceOf(MetaObjectExport);
      expect(exp).toMatchObject({ textExpP: 27, textExpS: 27, line: 3, position: 4, size: 5, doNewLine: true });
      expect(bar).toMatchObject({ textS: 5, symbology: MetaBarcodeSymbology.QR, ecc: MetaBarcodeEcc.H, modules: 21, rows: 21, columns: 2, flags: 0x300 });
      expect(page.getText(bar as MetaObjectBarcode)).toBe('12345');
      // The page details of the second page; the paper name keeps the zeros of its field (C# parity)
      const second = back.pages.get(1);
      expect(second.updatedPageSize).toBe(true);
      expect(second.pageDetail).toMatchObject({ index: 4, custom: false, customWidth: 100, customHeight: 200, physicWidth: 300, physicHeight: 400, paperSource: 2, duplex: 1 });
      expect(second.pageDetail.forcePaperName).toBe('Letter' + '\0'.repeat(55));
      if (version >= MetaFileVersion.MetaVersion3_0) {
        expect(back.pdfConformance).toBe(PDFConformanceType.PDF_A_3);
        expect(back.pdfCompressed).toBe(true);
        expect([back.docTitle, back.docAuthor, back.docXMPContent]).toEqual(['Title', '', '<x/>']);
        const efile = back.embeddedFiles[0] as EmbeddedFile;
        expect(efile).toMatchObject({ fileName: 'a.xml', mimeType: 'text/xml', description: 'Data', modificationDate: '2026-02-02', afRelationShip: PDFAFRelationShip.Data });
        // C# parity: the format has no creation date for an embedded file
        expect(efile.creationDate).toBeNull();
        expect(efile.stream).toEqual(new Uint8Array([60, 97, 47, 62]));
      }
    },
  );

  it('keeps the pool as read: strings already in it are found, new ones go after it', () => {
    const meta = richMeta();
    const bytes = writeRpmf(meta);
    const page = readRpmf(bytes).pages.get(0);
    expect(page.poolPos).toBe(meta.pages.get(0).poolPos);
    expect(page.addString('Año 😀 €')).toBe(1);
    expect(page.addString('Arial')).toBe((page.objects[0] as MetaObjectText).wFontNameP);
    expect(page.addString('12345')).toBe((page.objects[5] as MetaObjectBarcode).textP);
    // C# parity: the Linux font names are not in the list of a page read from a file
    expect(page.addString('Helvetica')).toBe(meta.pages.get(0).poolPos + 1);
  });

  it('reads a 07 file: no page details, the pages take the size of the metafile', () => {
    const meta = new MetaFile();
    Object.assign(meta, { pageSizeIndex: 2, customX: 1000, customY: 2000, orientation: OrientationType.Landscape });
    const page = new MetaPage(meta);
    page.orientation = OrientationType.Landscape;
    Object.assign(page.pageDetail, { index: 2, custom: true, customWidth: 1000, customHeight: 2000, physicWidth: 1000, physicHeight: 2000, forcePaperName: '' });
    page.drawText(1, 2, 3, 4, 'old', 'Arial', 'Helvetica', 10, 0, 0, 0, false, 0, 0, 0, 0, false, false, false, 0);
    meta.pages.add(page);
    const v09 = writeRpmf(meta);
    // The page header of the 07 format ends after the mark: no orientation ... UpdatedPageSize
    // The page starts after the 71 bytes of the file header (with the page count) and its separator
    const pageAt = 75;
    const details = 4 + 4 + 1 + 5 * 4 + 61 + 4 + 3 + 1;
    const v07 = new Uint8Array(v09.length - details);
    v07.set(v09.subarray(0, pageAt + 8));
    v07.set(v09.subarray(pageAt + 8 + details), pageAt + 8);
    v07[11] = 0x37; // '7'
    const back = readRpmf(v07);
    expect(back.version).toBe(MetaFileVersion.MetaVersion2_2);
    const p = back.pages.get(0);
    expect(p.orientation).toBe(OrientationType.Landscape);
    expect(p.pageDetail).toMatchObject({ index: 2, custom: true, customWidth: 1000, customHeight: 2000, physicWidth: 1000, physicHeight: 2000, paperSource: 0, forcePaperName: '', duplex: 0 });
    expect(p.getText(p.objects[0] as MetaObjectText)).toBe('old');
    expect(writeRpmf(back)).toEqual(v09);
  });

  it('reads the 16 bit fields as C# does', () => {
    const meta = new MetaFile();
    meta.paperSource = -1;
    meta.copies = 70000;
    meta.linesPerInch = -5;
    const back = readRpmf(writeRpmf(meta));
    expect([back.paperSource, back.copies, back.linesPerInch]).toEqual([65535, 70000 - 65536, 6]);
  });

  it('fails as the C# reader does', () => {
    const meta = new MetaFile();
    const page = new MetaPage(meta);
    meta.pages.add(page);
    page.drawText(1, 2, 3, 4, 'text', 'Arial', 'Helvetica', 10, 0, 0, 0, false, 0, 0, 0, 0, false, false, false, 0);
    const bytes = writeRpmf(meta);
    const bad = (b: Uint8Array): string => {
      try {
        readRpmf(b);
        return 'no error';
      } catch (e) {
        return (e as Error).message;
      }
    };
    expect(bad(new Uint8Array(0))).toBe('Bad report metafile signature');
    expect(bad(bytes.subarray(0, 12))).toBe('Bad report metafile signature');
    const sig = bytes.slice();
    sig[11] = 0x38;
    expect(bad(sig)).toBe('Bad report metafile signature');
    expect(bad(bytes.subarray(0, 40))).toBe('Bad report metafile file header');
    const sep = bytes.slice();
    sep[71] = 9; // the separator of the first page
    expect(bad(sep)).toBe('Page separator expected in report metafile');
    const obj = bytes.slice();
    obj[75] = 9; // the object separator of the first page
    expect(bad(obj)).toBe('Object separator expected in report metafile');
    expect(bad(bytes.subarray(0, 200))).toBe('Page separator expected in report metafile');
    expect(bad(bytes.subarray(0, bytes.length - 2))).toBe('Page separator expected in report metafile');
    const extra = new Uint8Array(bytes.length + 2);
    extra.set(bytes);
    expect(bad(extra)).toBe('Page separator expected in report metafile');
    const type = bytes.slice();
    type[75 + 8 + 98 + 4 + 16] = 9; // the type byte of the first object
    expect(bad(type)).toBe('Unknown meta object type: 9');
    expect(bad(new Uint8Array([0x78, 0x9c, 0xff, 0xff, 0xff, 0xff, 0, 0, 0, 0]))).toMatch(/^Invalid compressed report metafile/);
    const z = writeRpmf(meta, { compressed: true });
    expect(bad(z.subarray(0, z.length >> 1))).toMatch(/^Invalid compressed report metafile/);
  });
});
