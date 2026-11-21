import { describe, expect, it } from 'vitest';
import {
  MetaFile,
  MetaObjectBarcode,
  MetaObjectExport,
  MetaObjectPolygon,
  MetaObjectText,
  MetaPage,
  OrientationType,
  PDFAFRelationShip,
  PDFConformanceType,
  PDFFontType,
  PrintStepType,
  PrinterFontsType,
  ShapeType,
  TextAlignType,
  TextAlignVerticalType,
  newTextObjectStruct,
} from 'reportman-metafile';
import { StandardTextMeasurer, ShaperNotSupportedError } from 'reportman-text';
import {
  ImageNotSupportedError,
  PDFA3_NOT_SUPPORTED,
  PDFFile,
  PdfDevice,
  formatFixed2,
  intToHex,
  pdfDateOf,
  pdfDateOfText,
  renderPdf,
  splitDocDate,
  zoneOfOffset,
} from 'reportman-pdf';
import type { PdfClock } from 'reportman-pdf';
import { contentStreams } from './pdftools.js';

const latin1 = (b: Uint8Array): string => Buffer.from(b).toString('latin1');

function simpleMeta(pages = 1): MetaFile {
  const meta = new MetaFile();
  meta.customX = 11906;
  meta.customY = 16838;
  meta.orientation = OrientationType.Portrait;
  for (let i = 0; i < pages; i++) {
    const page = new MetaPage(meta);
    page.drawText(1000, 1000, 3000, 300, 'Page ' + String(i + 1), 'Arial', 'Helvetica', 10, 0, 0, 0xffffff, true, 0,
      PDFFontType.Helvetica, TextAlignType.Left, TextAlignVerticalType.Top, false, false, false, PrintStepType.BySize);
    meta.pages.add(page);
  }
  return meta;
}

const fixedClock: PdfClock = { now: () => new Date(Date.UTC(2026, 10, 21, 0, 31, 17)), offsetMinutes: () => 60 };

describe('.NET number formatting ("##0.00")', () => {
  it('formats like double.ToString("##0.00") with a dot', () => {
    expect(formatFixed2(28.7)).toBe('28.70');
    expect(formatFixed2(-41)).toBe('-41.00');
    expect(formatFixed2(0)).toBe('0.00');
    expect(formatFixed2(0.875)).toBe('0.88');
    expect(formatFixed2(0.125)).toBe('0.13'); // digits rounded half up
    expect(formatFixed2(1.005)).toBe('1.01'); // 15 significant digits first: 1.00500000000000
    expect(formatFixed2(255 / 256)).toBe('1.00');
    expect(formatFixed2(0.005)).toBe('0.01');
    expect(formatFixed2(0.0049)).toBe('0.00');
    expect(formatFixed2(999.995)).toBe('1000.00');
    expect(formatFixed2(1e21)).toBe('1000000000000000000000.00');
    expect(formatFixed2(123456789.125)).toBe('123456789.13');
  });
  it('keeps the sign of negative values that round to zero (seen in the C# PDFs)', () => {
    expect(formatFixed2(-1.2246467991473532e-16)).toBe('-0.00');
    expect(formatFixed2(-0)).toBe('-0.00');
    expect(formatFixed2(Math.cos(Math.PI / 2))).toBe('0.00');
  });
  it('writes hexadecimal like IntToHex', () => {
    expect(intToHex(0x41)).toBe('0041');
    expect(intToHex(0x1f600)).toBe('1F600');
    expect(intToHex(-1)).toBe('FFFFFFFF');
  });
});

describe('document dates', () => {
  it('splits ISO 8601 and PDF dates', () => {
    expect(splitDocDate('2024-10-02T15:29:15+02:00')).toEqual({ digits: '20241002152915', zone: '+02:00' });
    expect(splitDocDate("D:20241002152915+02'00'")).toEqual({ digits: '20241002152915', zone: '+02:00' });
    expect(splitDocDate('D:20261106102628Z00\'00\'')).toEqual({ digits: '20261106102628', zone: 'Z' });
    expect(splitDocDate(' 2024-10-02 15:29:15.123Z ')).toEqual({ digits: '20241002152915', zone: 'Z' });
    expect(splitDocDate('2024-10-02T15')).toEqual({ digits: '202410021500', zone: '' });
    expect(splitDocDate('2024-10-02+02:00')).toEqual({ digits: '20241002', zone: '' });
    expect(splitDocDate('2024-13-02')).toBeNull();
    expect(splitDocDate('2024-10-02T25:00')).toBeNull();
    expect(splitDocDate('2024-10-02T10:00+24:00')).toBeNull();
    expect(splitDocDate('yesterday')).toBeNull();
    expect(splitDocDate(null)).toBeNull();
  });
  it('writes PDF dates and zones', () => {
    expect(pdfDateOf('20241002152915', '+02:00')).toBe("D:20241002152915+02'00'");
    expect(pdfDateOf('20241002152915', 'Z')).toBe('D:20241002152915Z');
    expect(pdfDateOfText('not a date')).toBe('');
    expect(zoneOfOffset(0)).toBe('Z');
    expect(zoneOfOffset(-330)).toBe('-05:30');
  });
  it('dates a document without dates with the clock', () => {
    const pdf = renderPdf(simpleMeta(), { clock: fixedClock });
    expect(latin1(pdf)).toContain("/CreationDate (D:20261121013117+01'00')");
    expect(latin1(pdf)).toContain("/ModDate (D:20261121013117+01'00')");
    const meta = simpleMeta();
    meta.docCreationDate = '2020-01-02T03:04:05Z';
    meta.docModificationDate = '2021-01-01';
    const pdf2 = latin1(renderPdf(meta, { clock: fixedClock }));
    expect(pdf2).toContain('/CreationDate (D:20200102030405Z)');
    expect(pdf2).toContain('/ModDate (D:20210101)');
  });
});

describe('PDF strings', () => {
  it('escapes ASCII and writes the rest as UTF-16BE', () => {
    expect(PDFFile.encodePDFText('a(b)\\c')).toBe('(a\\(b\\)\\\\c)');
    expect(PDFFile.encodePDFText(null)).toBe('()');
    expect(PDFFile.encodePDFText('ñ€😀')).toBe('<FEFF00F120ACD83DDE00>');
    expect(PDFFile.encodePDFText('a\ud800')).toBe('<FEFF0061FFFD>');
  });
});

describe('PdfDevice', () => {
  it('writes the metadata, the fonts and one content stream per page', () => {
    const meta = simpleMeta(3);
    meta.docTitle = 'Título';
    meta.docAuthor = 'Me';
    meta.docKeywords = 'k';
    const pdf = latin1(renderPdf(meta, { clock: fixedClock }));
    expect(pdf.startsWith('%PDF-1.4\r\n1 0 obj\r\n<<\r\n/Author (Me)\r\n')).toBe(true);
    expect(pdf).toContain('/Title <FEFF005400ED00740075006C006F>'); // Título
    expect(pdf).toContain('/Keywords (k)');
    expect(pdf).not.toContain('/Producer');
    expect(pdf).toContain('/BaseFont /ZapfDingbats');
    expect(pdf).toContain('/Count 3');
    expect(pdf.endsWith('%%EOF\r\n')).toBe(true);
    expect(contentStreams(Buffer.from(pdf, 'latin1')).length).toBe(3);
  });
  it('prints a range of pages', () => {
    const meta = simpleMeta(5);
    const pdf = renderPdf(meta, { fromPage: 2, toPage: 3, clock: fixedClock });
    const streams = contentStreams(pdf).map(latin1);
    expect(streams.length).toBe(2);
    expect(streams[0]).toContain('(Page 2) Tj');
    expect(streams[1]).toContain('(Page 3) Tj');
    expect(() => renderPdf(simpleMeta(1), { fromPage: 3 })).toThrow(/fewer pages/);
    const device = new PdfDevice({ clock: fixedClock });
    device.fromPage = 3;
    expect(device.print(simpleMeta(1))).toBe(false);
  });
  it('sizes the pages: first CustomX x CustomY, then the first page detail or their own', () => {
    const meta = simpleMeta(3);
    meta.pages.get(0).pageDetail.index = 2; // Letter for the next pages
    const p3 = meta.pages.get(2);
    p3.updatedPageSize = true;
    p3.orientation = OrientationType.Landscape;
    p3.pageDetail.custom = true;
    p3.pageDetail.customWidth = 5000;
    p3.pageDetail.customHeight = 8000;
    p3.pageDetail.physicWidth = 5000;
    p3.pageDetail.physicHeight = 8000;
    const pdf = latin1(renderPdf(meta, { clock: fixedClock }));
    const boxes = [...pdf.matchAll(/\/MediaBox \[ 0 0 ([\d.]+) ([\d.]+)\]/g)].map((m) => m[1] + 'x' + m[2]);
    expect(boxes).toEqual(['595.30x841.90', '612.00x792.00', '400.00x250.00']);
  });
  it('writes links and notes as annotations', () => {
    const meta = simpleMeta(2);
    const page = meta.pages.get(1);
    const t = page.objects[0]!;
    t.annotationP = page.addString('URL:https://reportman.es');
    t.annotationS = 'URL:https://reportman.es'.length;
    const d = page.drawShape(100, 100, 400, 200, ShapeType.Rectangle, 0, 0, 0, 0, 0);
    d.annotationP = page.addString('note');
    d.annotationS = 4;
    const pdf = latin1(renderPdf(meta, { clock: fixedClock }));
    expect(pdf).toContain('/Subtype /Link');
    expect(pdf).toContain('/URI (https://reportman.es)');
    expect(pdf).toContain('/Contents (note)');
    expect(pdf).toMatch(/\/Annots \[\d+ 0 R \d+ 0 R\]/);
  });
  it('writes the embedded files (unreferenced in PDF 1.4, as C#)', () => {
    const meta = simpleMeta();
    meta.newEmbeddedFile('data.xml', 'text/xml', PDFAFRelationShip.Data, 'Data', '2024-10-02T15:29:15+02:00', '', new Uint8Array([60, 97, 62]));
    const pdf = latin1(renderPdf(meta, { clock: fixedClock }));
    expect(pdf).toContain('/Subtype /text#2Fxml');
    expect(pdf).toContain("/CreationDate (D:20241002152915+02'00')");
    expect(pdf).toContain('stream\r\n<a>\r\nendstream');
    expect(pdf).toContain('/AFRelationship /Data');
    expect(pdf).not.toContain('/EmbeddedFiles');
    const z = latin1(renderPdf(meta, { clock: fixedClock, compressed: true }));
    expect(z).toContain('/Filter [/FlateDecode]');
  });
  it('fails for images, PDF/A-3, right to left text and printer fonts Recalculate', () => {
    const meta = simpleMeta();
    meta.pages.get(0).drawImage(0, 0, 100, 100, 1, 96, new Uint8Array([1, 2, 3]));
    expect(() => renderPdf(meta)).toThrow(ImageNotSupportedError);
    expect(() => new PdfDevice().graphicExtent(new Uint8Array(1), { x: 0, y: 0 }, 96)).toThrow(ImageNotSupportedError);
    const a3 = simpleMeta();
    a3.pdfConformance = PDFConformanceType.PDF_A_3;
    expect(() => renderPdf(a3)).toThrow(PDFA3_NOT_SUPPORTED);
    const rtl = simpleMeta();
    (rtl.pages.get(0).objects[0] as MetaObjectText).rightToLeft = true;
    expect(() => renderPdf(rtl)).toThrow(ShaperNotSupportedError);
    const rec = simpleMeta();
    rec.printerFonts = PrinterFontsType.Recalculate;
    expect(() => renderPdf(rec)).toThrow(ShaperNotSupportedError);
  });
  it('does not draw polygons, export data and barcodes (as the C# device)', () => {
    const meta = simpleMeta();
    const before = contentStreams(renderPdf(meta, { clock: fixedClock }))[0];
    const page = meta.pages.get(0);
    page.objects.push(new MetaObjectPolygon(), new MetaObjectExport(), new MetaObjectBarcode());
    page.objects[1]!.metaType = 3;
    page.objects[2]!.metaType = 4;
    page.objects[3]!.metaType = 5;
    const after = contentStreams(renderPdf(meta, { clock: fixedClock }))[0];
    expect(Buffer.compare(Buffer.from(after!), Buffer.from(before!))).toBe(0);
  });
  it('calculates only: empty content streams', () => {
    const device = new PdfDevice({ clock: fixedClock });
    device.calculateOnly = true;
    device.print(simpleMeta(2));
    expect(contentStreams(device.pdfBytes).map((s) => s.length)).toEqual([0, 0]);
  });
  it('measures like the standard measurer, before and after a document', () => {
    const device = new PdfDevice();
    const measurer = new StandardTextMeasurer();
    const t = newTextObjectStruct({ text: 'Hello world, wrapping in a box', fontSize: 11, fontStyle: 1, wordWrap: true, type1Font: PDFFontType.TimesRoman });
    const want = measurer.textExtentLineInfo(t, { x: 1500, y: 0 });
    expect(device.textExtentLineInfo(t, { x: 1500, y: 0 })).toEqual(want);
    expect(device.textExtent(t, { x: 1500, y: 0 })).toEqual(want.extent);
    device.print(simpleMeta());
    expect(device.textExtentLineInfo(t, { x: 1500, y: 0 })).toEqual(want);
    expect(device.lineInfo).toEqual(want.lines);
    expect(MetaFile.calcTextExtent(device, { x: 1500, y: 300 }, t)).toBe(MetaFile.calcTextExtent(measurer, { x: 1500, y: 300 }, t));
  });
  it('keeps the page size state of a device', () => {
    const device = new PdfDevice();
    const detail = simpleMeta().pages.get(0).pageDetail;
    expect(device.setPageSize(detail)).toEqual({ x: 11906, y: 16838 });
    expect(device.getPageSize()).toEqual({ size: { x: 11906, y: 16838 }, indexqt: 0 });
    device.setOrientation(OrientationType.Landscape);
    expect(device.getPageSize().size).toEqual({ x: 16838, y: 11906 });
    detail.custom = true;
    detail.customWidth = 1000;
    detail.customHeight = 2000;
    expect(device.setPageSize(detail)).toEqual({ x: 2000, y: 1000 });
    expect(device.getPageSize().indexqt).toBe(-1);
    detail.custom = false;
    detail.index = 500;
    expect(() => device.setPageSize(detail)).toThrow(RangeError);
  });
});
