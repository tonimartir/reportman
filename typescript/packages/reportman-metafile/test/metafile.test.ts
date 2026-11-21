import { describe, expect, it } from 'vitest';
import {
  AlignmentFlags,
  BrushType,
  ImageDrawStyleType,
  MetaFile,
  MetaFileVersion,
  MetaObject,
  MetaObjectDraw,
  MetaObjectText,
  MetaObjectType,
  MetaPage,
  PDFAFRelationShip,
  PDFConformanceType,
  PDFFontType,
  PageSizeArray,
  PenType,
  PrintOut,
  PrintStepType,
  ShapeType,
  TextAlignType,
  TextAlignVerticalType,
  Units,
  alignToGridTwips,
  cmsToTwips,
  colorToRgb,
  convertToInt32,
  inchToTwips,
  intDiv,
  newTextObjectStruct,
  pageSizeName,
  rgbToColor,
  roundHalfEven,
  textObjectFromMetaObjectText,
  twipsFromUnits,
} from '@reportman/metafile';
import type { DevicePageSize, MetaPage as MetaPageType, PageSizeDetail, Point, TextObjectStruct } from '@reportman/metafile';

function newPage(meta = new MetaFile()): MetaPage {
  const page = new MetaPage(meta);
  meta.pages.add(page);
  return page;
}

describe('numeric helpers', () => {
  it('rounds half to even like Math.Round', () => {
    expect([0.5, 1.5, 2.5, -0.5, -1.5, -2.5, 2.4, 2.6, -2.6].map(roundHalfEven)).toEqual([0, 2, 2, -0, -2, -2, 2, 3, -3]);
    expect(convertToInt32(22.5)).toBe(22);
    expect(convertToInt32(23.5)).toBe(24);
  });
  it('divides ints toward zero', () => {
    expect(intDiv(-1, 2)).toBe(0);
    expect(intDiv(-3, 2)).toBe(-1);
    expect(intDiv(7, 2)).toBe(3);
    expect(() => intDiv(1, 0)).toThrow();
  });
});

describe('MetaPage string pool', () => {
  it('stores each string once, 1 based', () => {
    const page = newPage();
    expect(page.addString('Hello')).toBe(1);
    expect(page.addString('Arial')).toBe(6);
    expect(page.addString('Hello')).toBe(1);
    expect(page.addString('')).toBe(11);
    expect(page.addString('')).toBe(11);
    expect(page.poolPos).toBe(10);
  });
  it('grows past the first allocation and keeps the strings', () => {
    const page = newPage();
    const long = 'x'.repeat(5000);
    expect(page.addString('abc')).toBe(1);
    expect(page.addString(long)).toBe(4);
    expect(page.pool.length).toBe((1000 + 5000 + 2) * 2);
    const obj = new MetaObjectText();
    obj.textP = 4;
    obj.textS = 5000;
    expect(page.getText(obj)).toBe(long);
  });
  it('reads strings like new string(char[], start, length)', () => {
    const page = newPage();
    const obj = new MetaObjectText();
    expect(() => page.getText(obj)).toThrow(RangeError); // TextP 0: start -1
    obj.textP = 1;
    obj.textS = 0;
    expect(page.getText(obj)).toBe('');
    obj.textS = 2000;
    expect(() => page.getText(obj)).toThrow(RangeError);
    expect(page.getAnnotationText(obj)).toBeNull();
  });
});

describe('MetaPage drawing helpers', () => {
  it('adds a text object like MetaPage.DrawText', () => {
    const meta = new MetaFile();
    const page = newPage(meta);
    const t = page.drawText(10, 20, 300, 400, 'Text', 'Arial', 'Helvetica', 12, 900, 255, 0xffffff, true, 3,
      PDFFontType.TimesRoman, TextAlignType.Right, TextAlignVerticalType.Center, true, true, false, PrintStepType.cpi12);
    expect([t.textP, t.textS, t.lFontNameP, t.lFontNameS, t.wFontNameP, t.wFontNameS]).toEqual([1, 4, 5, 9, 14, 5]);
    expect(t.alignment).toBe(AlignmentFlags.AlignRight | AlignmentFlags.AlignVCenter | AlignmentFlags.SingleLine);
    expect(t.metaType).toBe(MetaObjectType.Text);
    expect([t.left, t.top, t.width, t.height]).toEqual([10, 20, 300, 400]);
    expect(t.type1Font).toBe(PDFFontType.TimesRoman);
    expect(page.getText(t)).toBe('Text');
    expect(page.getLFontNameText(t)).toBe('Helvetica');
    expect(page.getWFontNameText(t)).toBe('Arial');
    const s = textObjectFromMetaObjectText(page, t);
    expect(s).toMatchObject({ text: 'Text', wFontName: 'Arial', fontSize: 12, fontRotation: 900, fontStyle: 3, printStep: PrintStepType.cpi12 });
    // PDF/A-3 embeds every font
    meta.pdfConformance = PDFConformanceType.PDF_A_3;
    expect(meta.version).toBe(MetaFileVersion.MetaVersion3_0);
    const t2 = page.drawText(0, 0, 1, 1, 'x', 'Arial', 'Helvetica', 10, 0, 0, 0, true, 0, PDFFontType.Helvetica,
      TextAlignType.Justify, TextAlignVerticalType.Bottom, false, false, false, PrintStepType.BySize);
    expect(t2.type1Font).toBe(PDFFontType.Embedded);
    expect(t2.alignment).toBe(AlignmentFlags.AlignHJustify | AlignmentFlags.AlignBottom);
  });
  it('adds shapes and images, the image bytes in the page or the shared stream', () => {
    const meta = new MetaFile();
    const page = newPage(meta);
    const d = page.drawShape(1, 2, 3, 4, ShapeType.Circle, BrushType.Clear, PenType.Dot, 20, 0xff, 0xff00);
    expect(d.metaType).toBe(MetaObjectType.Draw);
    expect([d.drawStyle, d.brushStyle, d.penStyle, d.penWidth, d.penColor, d.brushColor]).toEqual([5, 1, 2, 20, 0xff, 0xff00]);
    page.addStream(new Uint8Array([9, 9]), false);
    const img = page.drawImage(0, 0, 100, 100, ImageDrawStyleType.Stretch, 96, new Uint8Array([1, 2, 3]));
    expect([img.copyMode, img.streamPos, img.streamSize, img.dpiRes]).toEqual([20, 2, 3, 96]);
    expect(Array.from(page.getStream(img))).toEqual([1, 2, 3]);
    const pos = page.addStream(new Uint8Array([7, 8]), true);
    img.sharedImage = true;
    img.streamPos = pos;
    img.streamSize = 4; // past the end: zero bytes, as C#
    expect(Array.from(page.getStream(img))).toEqual([7, 8, 0, 0]);
  });
});

describe('MetaFile', () => {
  it('has the C# defaults and page size helpers', () => {
    const meta = new MetaFile();
    expect([meta.customX, meta.customY, meta.version]).toEqual([12047, 17039, MetaFileVersion.MetaVersion2_4]);
    expect(PageSizeArray.length).toBe(149);
    expect(PageSizeArray[0]).toEqual([8268, 11693]);
    expect(PageSizeArray[30]).toEqual([-1, -1]);
    expect(pageSizeName(0)).toBe('A4');
    expect(pageSizeName(118)).toBe('Unknown');
    expect(pageSizeName(149)).toBe('PRC Envelope #10 Rotated');
    expect(PrintOut.pageSizeName(30)).toBe('Custom');
    const page = newPage(meta);
    expect([page.physicWidth, page.physicHeight]).toEqual([12047, 17039]);
    page.updatedPageSize = true;
    page.pageDetail.physicWidth = 5;
    expect(page.physicWidth).toBe(5);
    expect(() => meta.pages.get(1)).toThrow('Index out of range on MetaPage collection');
  });
  it('adds embedded files (a copy) and raises the version', () => {
    const meta = new MetaFile();
    const data = new Uint8Array([1, 2]);
    meta.newEmbeddedFile('a.xml', 'text/xml', PDFAFRelationShip.Data, 'desc', '2024-10-02', '', data);
    data[0] = 9;
    expect(meta.version).toBe(MetaFileVersion.MetaVersion3_0);
    expect(Array.from(meta.embeddedFiles[0]!.stream!)).toEqual([1, 2]);
    expect(meta.embeddedFiles[0]!.afRelationShipToString()).toBe('Data');
    const clone = meta.embeddedFiles[0]!.clone();
    expect(clone.stream).not.toBe(meta.embeddedFiles[0]!.stream);
    meta.clear();
    expect(meta.embeddedFiles.length).toBe(0);
  });
  it('writes the page count into the pool (UpdateTotalPages)', () => {
    const meta = new MetaFile();
    const p1 = newPage(meta);
    const shared = p1.drawText(0, 0, 1, 1, '         ', 'Arial', 'Helvetica', 10, 0, 0, 0, true, 0, 0, 0, 0, false, false, false, 0);
    const twin = p1.drawText(0, 0, 1, 1, '         ', 'Arial', 'Helvetica', 10, 0, 0, 0, true, 0, 0, 0, 0, false, false, false, 0);
    newPage(meta);
    newPage(meta);
    meta.updateTotalPages([{ pageIndex: 0, objectIndex: 0, displayFormat: '' }]);
    expect(p1.getText(shared)).toBe('3');
    // The twin shares the pool position: its characters changed too, its length did not
    expect(p1.getText(twin)).toBe('3        ');
    expect(() => meta.updateTotalPages([{ pageIndex: 0, objectIndex: 0, displayFormat: '00' }])).toThrow(/formatter/);
    meta.updateTotalPagesPCount([{ pageIndex: 0, objectIndex: 0, displayFormat: '00' }], 7, (v, f) => String(v).padStart(f.length, '0'));
    expect(p1.getText(shared)).toBe('07');
    p1.objects.push(new MetaObjectDraw());
    expect(() => meta.updateTotalPages([{ pageIndex: 0, objectIndex: 2, displayFormat: '' }])).toThrow(TypeError);
  });
  it('searches texts', () => {
    const meta = new MetaFile();
    const a = newPage(meta);
    newPage(meta);
    const c = newPage(meta);
    const t1 = a.drawText(0, 0, 1, 1, 'Café con leche', 'A', 'H', 10, 0, 0, 0, true, 0, 0, 0, 0, false, false, false, 0);
    const t2 = c.drawText(0, 0, 1, 1, 'CAFÉ solo', 'A', 'H', 10, 0, 0, 0, true, 0, 0, 0, 0, false, false, false, 0);
    const t3 = c.drawText(0, 0, 1, 1, 'Té', 'A', 'H', 10, 0, 0, 0, true, 0, 0, 0, 0, false, false, false, 0);
    meta.doSearch('café');
    expect([meta.objectFound(t1), meta.objectFound(t2), meta.objectFound(t3)]).toEqual([true, true, false]);
    expect([t1.id, t2.id, t3.id]).toEqual([1, 2, 0]);
    expect(meta.nextPageFound(0)).toBe(2);
    expect(meta.nextPageFound(2)).toBe(0);
    expect(meta.nextPageFound(1)).toBe(0); // not a found page: the first one
    meta.doSearch('');
    expect(meta.objectFound(t1)).toBe(false);
  });
});

/** A fixed width device: every character is 100 twips wide, lines are 200 twips high. */
class FixedDevice extends PrintOut {
  calls = 0;
  drawPage(_meta: MetaFile, _page: MetaPageType): void {}
  textExtent(aobj: TextObjectStruct, extent: Point): Point {
    this.calls++;
    const perLine = Math.max(1, Math.floor(extent.x / 100));
    const lines = aobj.text.length === 0 ? 0 : Math.ceil(aobj.text.length / perLine);
    return { x: Math.min(aobj.text.length, perLine) * 100, y: lines * 200 };
  }
  graphicExtent(_s: Uint8Array, e: Point): Point {
    return e;
  }
  setPageSize(_p: PageSizeDetail): Point {
    return { x: 0, y: 0 };
  }
  getPageSize(): DevicePageSize {
    return { size: { x: 0, y: 0 }, indexqt: 0 };
  }
}

describe('MetaFile.calcTextExtent', () => {
  it('cuts the text at a delimiter so it fits the height', () => {
    const device = new FixedDevice();
    const text = 'aaaa bbbb cccc dddd eeee ffff';
    // 10 characters a line, 2 lines fit: the cut is at a delimiter before position 20
    const pos = MetaFile.calcTextExtent(device, { x: 1000, y: 400 }, newTextObjectStruct({ text }));
    expect(pos).toBe(19);
    expect(text.substring(0, pos)).toBe('aaaa bbbb cccc dddd');
    expect(device.calls).toBeGreaterThan(2);
  });
  it('gives 0 when nothing fits', () => {
    const device = new FixedDevice();
    expect(MetaFile.calcTextExtent(device, { x: 1000, y: 100 }, newTextObjectStruct({ text: 'abc def' }))).toBe(0);
  });
  it('does not change the struct it gets', () => {
    const obj = newTextObjectStruct({ text: 'aaaa bbbb cccc' });
    MetaFile.calcTextExtent(new FixedDevice(), { x: 500, y: 200 }, obj);
    expect(obj.text).toBe('aaaa bbbb cccc');
  });
});

describe('PrintOut contract', () => {
  it('has the C# defaults and starts the document in preparePrint', () => {
    const d = new FixedDevice();
    expect([d.fromPage, d.toPage, d.copies]).toEqual([1, 100000, 0]);
    expect(d.textExtentLineInfo(newTextObjectStruct(), { x: 1, y: 2 })).toEqual({ lines: null, extent: { x: 1, y: 2 } });
    expect(d.supportsNativeBarcode(1)).toBe(false);
    expect(d.drawChart).toBeUndefined();
    const meta = new MetaFile();
    expect(d.print(meta)).toBe(true);
    expect(d.currentMetafile).toBe(meta);
  });
});

describe('objects, colors and twips', () => {
  it('creates objects by type and maps alignments', () => {
    expect(MetaObject.create(MetaObjectType.Draw)).toBeInstanceOf(MetaObjectDraw);
    expect(() => MetaObject.create(9 as MetaObjectType)).toThrow();
    expect(MetaObject.getIntHorizAlignment(TextAlignType.Center)).toBe(4);
    expect(MetaObject.getIntVertAlignment(TextAlignVerticalType.Bottom)).toBe(16);
  });
  it('converts colors and twips', () => {
    expect(colorToRgb(0x1f4e79)).toEqual({ r: 0x79, g: 0x4e, b: 0x1f });
    expect(rgbToColor(0x79, 0x4e, 0x1f)).toBe(0x1f4e79);
    expect(inchToTwips(0.015625)).toBe(22); // 22.5, to even
    expect(cmsToTwips(2.54)).toBe(1440);
    expect(twipsFromUnits(1, Units.Inch)).toBe(1440);
    expect(alignToGridTwips(170, 115)).toBe(115);
    expect(alignToGridTwips(-170, 115)).toBe(0); // (-170 + 57) / 115 = 0 in C# integers
    expect(alignToGridTwips(-230, 115)).toBe(-115);
  });
});
