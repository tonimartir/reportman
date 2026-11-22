// The preview against the PDF device: the calls a recording context gets for texts, shapes and
// images of metafiles built by hand and of a sample run, compared with what the PDF of the same
// metafile writes (its content stream, read back in twips). A scale of 15 makes a pixel a twip.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  BrushType,
  ImageDrawStyleType,
  MetaFile,
  MetaObjectBarcode,
  MetaObjectType,
  MetaPage,
  OrientationType,
  PDFFontType,
  PenType,
  PrintStepType,
  ShapeType,
  TextAlignType,
  TextAlignVerticalType,
  readRpmf,
  writeRpmf,
} from '@reportman/metafile';
import { renderPdf } from '@reportman/pdf';
import { FontLibrary, memoryFontFile } from '@reportman/text';
import { openReport, sqlite } from '@reportman/node';
import {
  CanvasPreview,
  DEFAULT_FAMILIES,
  cssColor,
  drawPage,
  pageSize,
  pdfPageSizes,
  prepareImage,
  renderPages,
  winAnsiChar,
  type ImageInput,
  type ImageLoader,
} from '@reportman/canvas';
import { bmp, png } from '../../reportman-pdf/test/images/encoders.mjs';
import { FakeContext, type Call } from './fakecontext.js';
import { pdfPages, type PdfPage } from './pdfcontent.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const samples = path.resolve(here, '../../../../samples');

const A4 = { width: 11906, height: 16838 };

function newMeta(pages = 1): MetaFile {
  const meta = new MetaFile();
  meta.customX = A4.width;
  meta.customY = A4.height;
  meta.orientation = OrientationType.Portrait;
  for (let i = 0; i < pages; i++) meta.pages.add(new MetaPage(meta));
  return meta;
}

interface TextOptions {
  font?: PDFFontType;
  size?: number;
  style?: number;
  color?: number;
  back?: number;
  transparent?: boolean;
  align?: TextAlignType;
  valign?: TextAlignVerticalType;
  wordWrap?: boolean;
  cut?: boolean;
  rotation?: number;
  singleLine?: boolean;
  wFont?: string;
}

function text(page: MetaPage, x: number, y: number, w: number, h: number, s: string, o: TextOptions = {}): void {
  page.drawText(
    x,
    y,
    w,
    h,
    s,
    o.wFont ?? 'Arial',
    'Helvetica',
    o.size ?? 10,
    o.rotation ?? 0,
    o.color ?? 0,
    o.back ?? 0xffffff,
    o.transparent ?? true,
    o.style ?? 0,
    o.font ?? PDFFontType.Helvetica,
    o.align ?? TextAlignType.Left,
    o.valign ?? TextAlignVerticalType.Top,
    o.singleLine ?? false,
    o.wordWrap ?? false,
    o.cut ?? false,
    PrintStepType.BySize,
  );
}

/** A loader that gives each image a name and keeps what it got. */
function fakeLoader(): { loader: ImageLoader; inputs: ImageInput[] } {
  const inputs: ImageInput[] = [];
  return {
    inputs,
    loader: async (input) => {
      inputs.push(input);
      return { fake: input.format + String(inputs.length) };
    },
  };
}

async function draw(meta: MetaFile, pageIndex = 0, fonts?: FontLibrary, loader?: ImageLoader) {
  const ctx = new FakeContext();
  const result = await drawPage(ctx, meta, pageIndex, { scale: 15, minLineWidth: 0, snapToPixels: false, fonts, loadImage: loader ?? fakeLoader().loader });
  expect(ctx.depth).toBe(0);
  return { ctx, result };
}

function pdfOf(meta: MetaFile, fonts?: FontLibrary): PdfPage[] {
  const pdf = renderPdf(meta, { compressed: false, fonts });
  return pdfPages(
    pdf,
    pdfPageSizes(meta).map((s) => s.height),
  );
}

const near = (a: number, b: number, tolerance = 0.11): boolean => Math.abs(a - b) <= tolerance;

/**
 * Every string the PDF writes has its first character drawn by the preview at the same baseline
 * origin (the PDF rounds to 0.01 point, 0.2 twips), and the preview draws as many characters.
 */
function expectSameTexts(calls: Call[], pdf: PdfPage): void {
  const texts = calls.filter((c) => c.op === 'fillText');
  for (const t of pdf.texts) {
    if (t.text === '' || t.text.charAt(0) === ' ') continue;
    const first = winAnsiChar(t.text.charCodeAt(0));
    const found = texts.find((c) => c.text === first && near(c.points[0]![0], t.x) && near(c.points[0]![1], t.y));
    expect(found, `"${t.text}" at ${t.x}, ${t.y}`).toBeDefined();
  }
  const pdfChars = pdf.texts.reduce((n, t) => n + [...t.text].filter((c) => c !== ' ' && winAnsiChar(c.charCodeAt(0)) !== '').length, 0);
  expect(texts.length).toBe(pdfChars);
}

/** Every rectangle of the PDF (shapes, backgrounds, clips) is a rectangle of the preview. */
function expectSameRects(calls: Call[], pdf: PdfPage, extra = 1): void {
  const rects = calls.filter((c) => c.op === 'rect');
  // The preview adds the clip of the page
  expect(rects.length).toBe(pdf.rects.length + extra);
  for (const r of pdf.rects) {
    const found = rects.find((c) => near(c.points[0]![0], r.x) && near(c.points[0]![1], r.y) && near(c.size![0], r.w, 0.21) && near(c.size![1], r.h, 0.21));
    expect(found, `rectangle ${JSON.stringify(r)}`).toBeDefined();
  }
}

describe('pages', () => {
  it('sizes each page as the PDF does', () => {
    const meta = newMeta(3);
    meta.customX = 12000;
    meta.customY = 17000;
    meta.pages.get(2).updatedPageSize = true;
    meta.pages.get(2).orientation = OrientationType.Landscape;
    meta.pages.get(2).pageDetail.physicWidth = 12240;
    meta.pages.get(2).pageDetail.physicHeight = 15840;
    // The second page takes the size of the page detail of the first one (index 0, A4 of the table)
    expect(pdfPageSizes(meta)).toEqual([
      { width: 12000, height: 17000 },
      { width: 11906, height: 16838 },
      { width: 15840, height: 12240 },
    ]);
    // 96 pixels per inch at scale 1, rounded up as pdftoppm does
    expect(pageSize(meta, 0)).toEqual({ width: 800, height: 1134 });
    expect(pageSize(meta, 1)).toEqual({ width: 794, height: 1123 });
    expect(pageSize(meta, 1, 100 / 96)).toEqual({ width: 827, height: 1170 });
    expect(pageSize(meta, 2, 1)).toEqual({ width: 1056, height: 816 });
  });

  it('scales the context, clips to the page and paints it white, leaving the context as it was', async () => {
    const meta = newMeta();
    const ctx = new FakeContext();
    const result = await drawPage(ctx, meta, 0, { scale: 2 });
    expect(result).toEqual({ pageIndex: 0, width: 1588, height: 2246, skipped: [], annotations: [] });
    const fill = ctx.ops('fillRect')[0]!;
    expect(fill.fillStyle).toBe('#ffffff');
    expect(fill.size![0]).toBeCloseTo(11906 * (2 * 96) / 1440, 6);
    expect(ctx.ops('clip')).toHaveLength(1);
    expect(ctx.depth).toBe(0);
    expect(ctx.fontKerning).toBe('none');
    // No background
    const ctx2 = new FakeContext();
    await drawPage(ctx2, meta, 0, { background: null });
    expect(ctx2.ops('fillRect')).toHaveLength(0);
  });

  it('gives colors as the PDF writes them (two decimals of c / 256)', () => {
    expect(cssColor(0)).toBe('rgb(0,0,0)');
    expect(cssColor(0xffffff)).toBe('rgb(255,255,255)');
    // 100 / 256 = 0.39 -> 99.45; 128 / 256 = 0.50 -> 127.5; BBGGRR
    expect(cssColor(0x800064)).toBe('rgb(99,0,128)');
  });
});

describe('texts with the standard fonts', () => {
  it('draws each character at the position of its width, from the baseline, in the browser family', async () => {
    const meta = newMeta();
    text(meta.pages.get(0), 1440, 1440, 5000, 400, 'Hello W', { color: 0x0000ff });
    const { ctx } = await draw(meta);
    const calls = ctx.ops('fillText');
    expect(calls.map((c) => c.text).join('')).toBe('HelloW');
    // Helvetica widths: H 722, e 556, l 222, o 556, space 278; 10 points = 200 twips
    const xs = [0, 722, 722 + 556, 722 + 556 + 222, 722 + 556 + 444, 722 + 556 + 444 + 556 + 278].map((w) => 1440 + w * 0.2);
    calls.forEach((c, i) => {
      expect(c.points[0]![0]).toBeCloseTo(xs[i]!, 6);
      // The first line starts at the top: the baseline is the font size below it
      expect(c.points[0]![1]).toBeCloseTo(1440 + 200, 6);
      expect(c.font).toBe('200px ' + 'Arial, Helvetica, "Liberation Sans", "Nimbus Sans", sans-serif');
      expect(c.fillStyle).toBe('rgb(255,0,0)');
    });
    expectSameTexts(ctx.calls, pdfOf(meta)[0]!);
  });

  it('places the lines of every alignment, word wrap, justification and style where the PDF places them', async () => {
    const meta = newMeta();
    const page = meta.pages.get(0);
    const long = 'The quick brown fox jumps over the lazy dog and keeps running far away';
    let y = 500;
    for (const align of [TextAlignType.Left, TextAlignType.Right, TextAlignType.Center, TextAlignType.Justify]) {
      for (const valign of [TextAlignVerticalType.Top, TextAlignVerticalType.Center, TextAlignVerticalType.Bottom]) {
        text(page, 1000, y, 3000, 900, long, { align, valign, wordWrap: true });
        y += 1000;
      }
    }
    text(page, 6000, 500, 4000, 300, 'Bold italic Times', { font: PDFFontType.TimesRoman, style: 3, size: 12 });
    text(page, 6000, 900, 4000, 300, 'Courier text', { font: PDFFontType.Courier, size: 9 });
    text(page, 6000, 1300, 4000, 300, 'Accents àéîõü € “quotes” – Ŝ', { size: 11 });
    text(page, 6000, 1700, 4000, 300, 'Line one\r\nLine two\nLine three', { size: 8 });
    text(page, 6000, 2600, 1200, 300, 'Single line that does not wrap at all', { singleLine: true, wordWrap: true });
    const { ctx, result } = await draw(meta);
    expect(result.skipped).toEqual([]);
    const pdf = pdfOf(meta)[0]!;
    expect(pdf.texts.length).toBeGreaterThan(40);
    expectSameTexts(ctx.calls, pdf);
    // Bold italic Times and Courier families
    expect(ctx.ops('fillText').find((c) => c.text === 'B')!.font).toBe('italic bold 240px "Times New Roman", Times, "Liberation Serif", "Nimbus Roman", serif');
    expect(ctx.ops('fillText').find((c) => c.text === 'C')!.font).toMatch(/^180px "Courier New"/);
    // The WinAnsi characters come back as themselves; what Windows-1252 cannot hold is a ?
    const drawn = ctx.ops('fillText').map((c) => c.text).join('');
    expect(drawn).toContain('àéîõü€“quotes”–S');
  });

  it('draws the background of each line, the underline and the strikeout as the PDF does', async () => {
    const meta = newMeta();
    const page = meta.pages.get(0);
    text(page, 1000, 1000, 4000, 600, 'Underlined', { style: 4, transparent: false, back: 0x00ffff, size: 12 });
    text(page, 1000, 2000, 4000, 600, 'Struck out', { style: 8 });
    const { ctx } = await draw(meta);
    const pdf = pdfOf(meta)[0]!;
    expectSameTexts(ctx.calls, pdf);
    expectSameRects(ctx.calls, pdf);
    // The background is filled, not stroked, in the back color (from the top of the line, the
    // leading of the font above the top of the text)
    const bg = ctx.ops('rect').find((r) => near(r.points[0]![0], 1000) && near(r.points[0]![1], 1000 - 32))!;
    const after = ctx.calls.slice(ctx.calls.indexOf(bg) + 1, ctx.calls.indexOf(bg) + 3).map((c) => c.op);
    expect(after).toEqual(['fill', 'fillText']);
    expect(ctx.calls[ctx.calls.indexOf(bg) + 1]!.fillStyle).toBe('rgb(255,255,0)');
    // Underline and strikeout: the lines of the PDF, as wide (a tenth of the size)
    const strokes = ctx.calls.filter((c) => c.op === 'lineTo');
    expect(strokes).toHaveLength(2);
    expect(pdf.lines).toHaveLength(2);
    for (const l of pdf.lines) expect(strokes.some((s) => near(s.points[0]![0], l.x2) && near(s.points[0]![1], l.y2))).toBe(true);
    expect(strokes[0]!.lineWidth).toBe(24);
  });

  it('clips a cut text and rotates a text around its top left corner', async () => {
    const meta = newMeta();
    const page = meta.pages.get(0);
    text(page, 1000, 1000, 600, 200, 'Clipped text', { cut: true });
    text(page, 3000, 3000, 2000, 300, 'UV', { rotation: 900 });
    const { ctx } = await draw(meta);
    const clips = ctx.ops('clip');
    // The page and the cut text
    expect(clips).toHaveLength(2);
    const clipRect = ctx.calls[ctx.calls.indexOf(clips[1]!) - 1]!;
    expect(clipRect.points[0]).toEqual([1000, 1000]);
    expect(clipRect.size).toEqual([600, 200]);
    // 90 degrees counterclockwise: the baseline 200 twips below the corner goes 200 to its right
    const u = ctx.ops('fillText').find((c) => c.text === 'U')!;
    expect(u.points[0]![0]).toBeCloseTo(3200, 6);
    expect(u.points[0]![1]).toBeCloseTo(3000, 6);
    const v = ctx.ops('fillText').find((c) => c.text === 'V')!;
    expect(v.points[0]![0]).toBeCloseTo(3200, 6);
    expect(v.points[0]![1]).toBeCloseTo(3000 - 722 * 0.2, 6);
  });

  it('leaves out what it does not draw, without throwing in the middle of the page', async () => {
    const meta = newMeta();
    const page = meta.pages.get(0);
    text(page, 1000, 1000, 3000, 300, 'abc', { font: PDFFontType.Symbol });
    const rtl = page.objects.length;
    text(page, 1000, 2000, 3000, 300, 'שלום');
    (page.objects[rtl] as { rightToLeft: boolean }).rightToLeft = true;
    text(page, 1000, 3000, 3000, 300, 'After');
    const barcode = new MetaObjectBarcode();
    barcode.metaType = MetaObjectType.Barcode;
    page.objects.push(barcode);
    const { ctx, result } = await draw(meta);
    expect(result.skipped.map((s) => s.objectIndex)).toEqual([1]);
    expect(result.skipped[0]!.reason).toMatch(/Right to left text needs a text shaper/);
    // The objects before and after it are drawn
    expect(ctx.ops('fillText').map((c) => c.text).join('')).toBe('αβχAfter');
  });

  it('draws Symbol and ZapfDingbats as the characters of their encodings, where their widths put them', async () => {
    const meta = newMeta();
    const page = meta.pages.get(0);
    text(page, 1000, 1000, 5000, 300, 'abc"', { font: PDFFontType.Symbol, style: 3 });
    text(page, 1000, 2000, 5000, 300, '!an', { font: PDFFontType.ZafDingbats });
    const { ctx, result } = await draw(meta);
    expect(result.skipped).toEqual([]);
    const calls = ctx.ops('fillText');
    expect(calls.map((c) => c.text).join('')).toBe('αβχ∀✁❁■');
    // No bold or italic face: the family of the characters
    expect(calls[0]!.font).toBe('200px ' + DEFAULT_FAMILIES.symbol);
    expect(calls[4]!.font).toBe('200px ' + DEFAULT_FAMILIES.dingbats);
    // The widths of the AFM files (10 points: 0.2 twips a thousandth): alpha 631, beta 549; a1 974
    expect(calls[1]!.points[0]![0] - calls[0]!.points[0]![0]).toBeCloseTo(631 * 0.2, 6);
    expect(calls[2]!.points[0]![0] - calls[1]!.points[0]![0]).toBeCloseTo(549 * 0.2, 6);
    expect(calls[5]!.points[0]![0] - calls[4]!.points[0]![0]).toBeCloseTo(974 * 0.2, 6);
  });
});

describe('shapes', () => {
  it('draws rectangles, rounded rectangles, ellipses and lines with the pens and brushes of the PDF', async () => {
    const meta = newMeta();
    const page = meta.pages.get(0);
    const shapes = [
      ShapeType.Rectangle,
      ShapeType.Square,
      ShapeType.RoundRect,
      ShapeType.RoundSquare,
      ShapeType.Ellipse,
      ShapeType.Circle,
      ShapeType.HorzLine,
      ShapeType.VertLine,
      ShapeType.Oblique1,
      ShapeType.Oblique2,
    ];
    shapes.forEach((shape, i) => {
      page.drawShape(500 + i * 1100, 1000, 1000, 600, shape, BrushType.Solid, PenType.Solid, 0, 0x0000ff, 0x00ff00);
      page.drawShape(500 + i * 1100, 2000, 1000, 600, shape, BrushType.Clear, PenType.Dash, 40, 0xff0000, 0);
      page.drawShape(500 + i * 1100, 3000, 1000, 600, shape, BrushType.Horizontal, PenType.Clear, 0, 0, 0x808080);
    });
    page.drawShape(500, 4000, 1000, 600, ShapeType.Rectangle, BrushType.Clear, PenType.Clear, 0, 0, 0);
    page.drawShape(500, 5000, 1000, 600, ShapeType.Rectangle, BrushType.Clear, PenType.Dot, 0, 0, 0);
    page.drawShape(1600, 5000, 1000, 600, ShapeType.Rectangle, BrushType.Clear, PenType.DashDot, 0, 0, 0);
    page.drawShape(2700, 5000, 1000, 600, ShapeType.Rectangle, BrushType.Clear, PenType.DashDotDot, 0, 0, 0);
    const { ctx, result } = await draw(meta);
    expect(result.skipped).toEqual([]);
    const pdf = pdfOf(meta)[0]!;
    expectSameRects(ctx.calls, pdf);
    // A solid rectangle of pen 0: a line of 1 twip, the size of the object (W + 1 - 1)
    const solid = ctx.ops('rect')[1]!;
    expect(solid.points[0]).toEqual([500, 1000]);
    expect(solid.size).toEqual([1000, 600]);
    const i = ctx.calls.indexOf(solid);
    expect(ctx.calls.slice(i + 1, i + 3).map((c) => c.op)).toEqual(['fill', 'stroke']);
    expect(ctx.calls[i + 1]!.fillStyle).toBe('rgb(0,255,0)');
    expect(ctx.calls[i + 2]!.strokeStyle).toBe('rgb(255,0,0)');
    expect(ctx.calls[i + 2]!.lineWidth).toBe(1);
    // A square: centered in the box
    expect(ctx.ops('rect')[4]!.points[0]).toEqual([1600 + 200, 1000]);
    expect(ctx.ops('rect')[4]!.size).toEqual([600, 600]);
    // The dashed, clear brush rectangle: stroked only, 40 twips wide, inset by half the pen
    const dashed = ctx.ops('rect')[2]!;
    expect(dashed.points[0]).toEqual([520, 2020]);
    expect(dashed.size).toEqual([961, 561]);
    const d = ctx.calls.indexOf(dashed);
    expect(ctx.calls[d + 1]!.op).toBe('stroke');
    expect(ctx.calls[d + 1]!.dash).toEqual([320, 160]);
    expect(ctx.calls[d + 1]!.lineWidth).toBe(40);
    // A clear pen: filled only, whatever the brush style
    const hatched = ctx.ops('rect')[3]!;
    expect(ctx.calls[ctx.calls.indexOf(hatched) + 1]!.op).toBe('fill');
    expect(ctx.calls[ctx.calls.indexOf(hatched) + 2]!.op).not.toBe('stroke');
    // Dot, dash dot, dash dot dot
    const dashes = ctx.calls.filter((c) => c.op === 'stroke').slice(-3).map((c) => c.dash);
    expect(dashes).toEqual([[20, 20], [160, 140, 40, 140], [160, 80, 40, 80, 40, 80]]);
    // Lines: every line of the PDF, the same ends
    const lineTos = ctx.calls.filter((c, k) => c.op === 'lineTo' && ctx.calls[k + 1]?.op === 'stroke' && ctx.calls[k - 1]?.op === 'moveTo');
    expect(lineTos).toHaveLength(pdf.lines.length);
    for (const l of pdf.lines) expect(lineTos.some((c) => near(c.points[0]![0], l.x2) && near(c.points[0]![1], l.y2))).toBe(true);
    // Ellipses: four curves with the integer control points of the PDF (k = 0.55)
    const curves = ctx.ops('bezierCurveTo');
    // Rounded rectangles, rounded squares, ellipses and circles of the three rows, four curves each
    expect(curves).toHaveLength(4 * 3 * 4);
    const ellipse = ctx.calls.filter((c) => c.op === 'moveTo').find((c) => near(c.points[0]![0], 4900) && near(c.points[0]![1], 1300))!;
    const e = ctx.calls.indexOf(ellipse);
    // W 1000, H 600: w2 500, h2 300, wk = 275, hk = 165
    expect(ctx.calls[e + 1]!.points).toEqual([
      [4900, 1300 - 165],
      [4900 + 500 - 275, 1000],
      [4900 + 500, 1000],
    ]);
  });

  // tests/FormasClearTest of the C# engine (its Skia bitmap part; the PDF part is in
  // reportman-engine/test/shapes-clear.test.ts): the bitmap driver painted the lines whatever the pen
  it('paints nothing for a clear pen and a clear brush, whatever the shape', async () => {
    // What paints, but the background of the page (what an empty page paints)
    const paints = (calls: Call[]): Call[] => calls.filter((c) => ['fill', 'stroke', 'fillRect'].includes(c.op));
    const background = paints((await draw(newMeta())).ctx.calls);
    const shapes = [
      ShapeType.Rectangle,
      ShapeType.Square,
      ShapeType.RoundRect,
      ShapeType.Ellipse,
      ShapeType.Circle,
      ShapeType.HorzLine,
      ShapeType.VertLine,
      ShapeType.Oblique1,
      ShapeType.Oblique2,
    ];
    for (const shape of shapes) {
      const meta = newMeta();
      meta.pages.get(0).drawShape(500, 500, 3000, 2000, shape, BrushType.Clear, PenType.Clear, 20, 0, 0);
      const { ctx } = await draw(meta);
      expect(paints(ctx.calls), ShapeType[shape]).toEqual(background);
    }
    // The measure sees what is drawn: a solid outline, and a hatched fill with a clear pen
    const control = newMeta();
    control.pages.get(0).drawShape(500, 500, 3000, 2000, ShapeType.Rectangle, BrushType.Clear, PenType.Solid, 20, 0, 0);
    expect(paints((await draw(control)).ctx.calls).length).toBeGreaterThan(background.length);
    const hatched = newMeta();
    hatched.pages.get(0).drawShape(500, 500, 3000, 2000, ShapeType.Rectangle, BrushType.Horizontal, PenType.Clear, 20, 0, 0);
    expect(paints((await draw(hatched)).ctx.calls).length).toBeGreaterThan(background.length);
  });
});

describe('images', () => {
  const photo = new Uint8Array(bmp(4, 2, 24, (x: number, y: number) => [x * 60, y * 120, 200]));
  const pngImage = new Uint8Array(png(3, 3, 6, 8, (x: number, y: number) => [x * 80, y * 80, 0, 255]));

  it('places crop, stretch, full and tiled images where the PDF places them', async () => {
    const meta = newMeta();
    const page = meta.pages.get(0);
    page.drawImage(1000, 1000, 1000, 1000, ImageDrawStyleType.Crop, 96, photo);
    page.drawImage(3000, 1000, 1000, 1000, ImageDrawStyleType.Stretch, 96, photo);
    page.drawImage(5000, 1000, 1000, 1000, ImageDrawStyleType.Full, 96, photo);
    page.drawImage(7000, 1000, 1000, 1000, ImageDrawStyleType.Crop, 96, pngImage);
    page.drawImage(1000, 3000, 2000, 1000, ImageDrawStyleType.Full, 0, pngImage);
    const { loader, inputs } = fakeLoader();
    const { ctx, result } = await draw(meta, 0, undefined, loader);
    expect(result.skipped).toEqual([]);
    // Each image (each one has its bytes in the page) decoded once, to the pixels the PDF embeds
    expect(inputs.map((i) => i.kind + ':' + i.format)).toEqual(['rgba:bmp', 'rgba:bmp', 'rgba:bmp', 'rgba:png', 'rgba:png']);
    const bmpInput = inputs[0] as Extract<ImageInput, { kind: 'rgba' }>;
    // The pixel (1, 1) of the bitmap: x * 60, y * 120, 200, opaque
    expect([...bmpInput.pixels.subarray((1 * 4 + 1) * 4, (1 * 4 + 1) * 4 + 4)]).toEqual([60, 120, 200, 255]);
    const pngInput = inputs[3] as Extract<ImageInput, { kind: 'rgba' }>;
    expect([pngInput.width, pngInput.height, pngInput.pixels.length]).toEqual([3, 3, 36]);
    const images = ctx.ops('drawImage');
    const pdf = pdfOf(meta)[0]!;
    expect(images).toHaveLength(pdf.images.length);
    pdf.images.forEach((im, i) => {
      const c = images[i]!;
      expect(near(c.points[0]![0], im.x) && near(c.points[0]![1], im.y), `${JSON.stringify(c.points)} ${JSON.stringify(im)}`).toBe(true);
      expect(near(c.size![0], im.w, 0.21) && near(c.size![1], im.h, 0.21), `${JSON.stringify(c.size)} ${JSON.stringify(im)}`).toBe(true);
    });
    // Crop: 4 x 2 in a square, centered vertically
    expect(images[0]!.points[0]).toEqual([1000, 1250]);
    expect(images[0]!.size).toEqual([1000, 500]);
    // Full at 96 dpi: 4 pixels are 60 twips, centered
    expect(images[2]!.points[0]).toEqual([5000 + 470, 1000 + 485]);
    expect(images[2]!.size).toEqual([60, 30]);
    expect((images[0]!.image as { fake: string }).fake).toBe('bmp1');
    expect((images[3]!.image as { fake: string }).fake).toBe('png4');
  });

  it('tiles as the PDF does: one tile at 72 dpi, and a clip that stays to the end of the page', async () => {
    const meta = newMeta();
    const page = meta.pages.get(0);
    page.drawImage(100, 100, 1000, 500, ImageDrawStyleType.Tile, 96, photo);
    text(page, 2000, 2000, 2000, 300, 'Hidden');
    const { ctx } = await draw(meta);
    const images = ctx.ops('drawImage');
    // 4 x 2 pixels at 72 dpi are 80 x 40 twips, centered in the box
    expect(images).toHaveLength(1);
    expect(images[0]!.points[0]).toEqual([560, 330]);
    expect(images[0]!.size).toEqual([80, 40]);
    // The clipping rectangle takes the width and height as its right and bottom
    const clip = ctx.ops('clip')[1]!;
    const r = ctx.calls[ctx.calls.indexOf(clip) - 1]!;
    expect(r.points[0]).toEqual([560, 330]);
    expect(r.size).toEqual([80 - 560, 40 - 330]);
    // The text is drawn inside that clip: no restore between them
    const firstText = ctx.calls.findIndex((c) => c.op === 'fillText');
    expect(ctx.calls.slice(ctx.calls.indexOf(clip), firstText).some((c) => c.op === 'restore')).toBe(false);
    const pdf = pdfOf(meta)[0]!;
    expect(pdf.images).toHaveLength(1);
    expectSameRects(ctx.calls, pdf);
  });

  it('shares the decoded images between the pages and leaves out what it cannot decode', async () => {
    const meta = newMeta(2);
    const shared = meta.pages.get(0).addStream(photo, true);
    for (const page of meta.pages) {
      const o = page.drawImage(1000, 1000, 1000, 1000, ImageDrawStyleType.Stretch, 96, new Uint8Array(0));
      o.streamPos = shared;
      o.streamSize = photo.length;
      o.sharedImage = true;
    }
    // WebP, which the PDF writer does not decode
    meta.pages.get(1).drawImage(3000, 1000, 500, 500, ImageDrawStyleType.Stretch, 96, new Uint8Array([0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x57, 0x45, 0x42, 0x50, 0x56, 0x50, 0x38, 0x20]));
    const { loader, inputs } = fakeLoader();
    const preview = new CanvasPreview({ loadImage: loader });
    const ctx = new FakeContext();
    await preview.drawPage(ctx, meta, 0, { scale: 15 });
    const r2 = await preview.drawPage(ctx, meta, 1, { scale: 15 });
    expect(inputs).toHaveLength(1);
    expect(ctx.ops('drawImage')).toHaveLength(2);
    expect(r2.skipped).toEqual([{ objectIndex: 1, reason: expect.stringMatching(/WebP images are not supported/) }]);
    // A loader that fails leaves the image out
    const failing = new CanvasPreview({ loadImage: async () => null });
    const r3 = await failing.drawPage(new FakeContext(), meta, 0, { scale: 15 });
    expect(r3.skipped[0]!.reason).toMatch(/BMP image could not be decoded/);
  });
});

describe('a sample run', () => {
  it('draws customers.rep (through its .rpmf) as its PDF: the texts, rectangles and lines of every page', async () => {
    const report = await openReport(path.join(samples, 'customers.rep'), { connections: { SAMPLES: sqlite(path.join(samples, 'samples.db')) } });
    const run = await report.executeToMetafile({});
    // The metafile a browser gets: the .rpmf file of the viewers
    const meta = readRpmf(writeRpmf(run));
    const pdf = pdfOf(meta);
    expect(pdf).toHaveLength(3);
    const preview = new CanvasPreview();
    for (let i = 0; i < meta.pages.currentCount; i++) {
      const ctx = new FakeContext();
      const result = await preview.drawPage(ctx, meta, i, { scale: 15, minLineWidth: 0, snapToPixels: false });
      expect(result.skipped).toEqual([]);
      expect(ctx.depth).toBe(0);
      expectSameTexts(ctx.calls, pdf[i]!);
      expectSameRects(ctx.calls, pdf[i]!);
      expect(ctx.ops('fillText').length).toBeGreaterThan(300);
    }
  });
});

// A TrueType font of the system, for the font library: the PDF embeds its glyphs and the preview
// draws their outlines. Skipped where there is none (the Docker images of the CI).
const systemFont = [
  'C:/Windows/Fonts/arial.ttf',
  '/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf',
  '/usr/share/fonts/truetype/liberation/LiberationSans-Regular.ttf',
  '/System/Library/Fonts/Supplemental/Arial.ttf',
  '/Library/Fonts/Arial.ttf',
].find((f) => fs.existsSync(f));

describe.skipIf(systemFont === undefined)('texts with a font library', () => {
  it('draws every glyph the PDF embeds with its outline, at the origin the PDF gives it', async () => {
    const file = systemFont as string;
    const library = new FontLibrary([memoryFontFile(file, new Uint8Array(fs.readFileSync(file)))]);
    const meta = newMeta();
    const page = meta.pages.get(0);
    text(page, 1000, 1000, 4000, 1200, 'Kerning AVATAR, fi ligatures and wrapped words', { wordWrap: true, size: 14, color: 0x008000 });
    text(page, 1000, 3000, 4000, 400, 'Right aligned', { align: TextAlignType.Right, style: 4 });
    const { ctx, result } = await draw(meta, 0, library);
    expect(result.skipped).toEqual([]);
    expect(ctx.ops('fillText')).toHaveLength(0);
    const pdf = pdfOf(meta, library)[0]!;
    expect(pdf.glyphs.length).toBeGreaterThan(40);
    const face = library.fileOf(file)!.fontkit(0) as unknown as {
      unitsPerEm: number;
      getGlyph(id: number): { path: { commands: { command: string; args: number[] }[] } };
    };
    const moves = ctx.ops('moveTo');
    let checked = 0;
    for (const g of pdf.glyphs) {
      // A glyph drawn for a second text gets a code of its own past the glyphs of the font
      if (g.code >= (face as unknown as { numGlyphs: number }).numGlyphs) continue;
      const commands = face.getGlyph(g.code).path.commands;
      if (commands.length === 0) continue;
      const first = commands[0]!;
      const size = g.y < 2900 ? 14 : 10;
      const s = (size * 20) / face.unitsPerEm;
      const x = g.x + first.args[0]! * s;
      const y = g.y - first.args[1]! * s;
      expect(moves.some((m) => near(m.points[0]![0], x) && near(m.points[0]![1], y)), `glyph ${g.code} at ${g.x}, ${g.y}`).toBe(true);
      checked++;
    }
    expect(checked).toBeGreaterThan(35);
    // One fill per line and color, in the color of the text
    expect(ctx.ops('fill').some((f) => f.fillStyle === 'rgb(0,128,0)')).toBe(true);
    // The underline of the second text
    expect(pdf.lines).toHaveLength(1);
    expect(ctx.ops('stroke').length).toBe(1);
  });
});

describe('alignment to the pixels', () => {
  // At scale 1 a pixel is 15 twips
  it('puts hairlines on pixel centers, fills on pixel boundaries and baselines on pixel rows', async () => {
    const meta = newMeta();
    const page = meta.pages.get(0);
    page.drawShape(1003, 2008, 3000, 1500, ShapeType.Rectangle, BrushType.Clear, PenType.Solid, 0, 0, 0);
    page.drawShape(1003, 4008, 3001, 7, ShapeType.Rectangle, BrushType.Solid, PenType.Clear, 0, 0, 0);
    page.drawShape(1003, 5008, 3000, 600, ShapeType.HorzLine, BrushType.Solid, PenType.Solid, 0, 0, 0);
    page.drawShape(1003, 6008, 3000, 600, ShapeType.HorzLine, BrushType.Solid, PenType.Solid, 30, 0, 0);
    text(page, 1003, 7008, 3000, 300, 'Text');
    text(page, 1003, 8008, 3000, 300, 'Up', { rotation: 450 });
    const ctx = new FakeContext();
    await drawPage(ctx, meta, 0, { scale: 1 });
    const rects = ctx.ops('rect');
    // The stroked rectangle: its lines one pixel wide on pixel centers
    expect(rects[1]!.points[0]).toEqual([66.5, 133.5]);
    expect(rects[1]!.size).toEqual([200, 100]);
    expect(ctx.calls[ctx.calls.indexOf(rects[1]!) + 1]!.lineWidth).toBeCloseTo(15, 9);
    // The filled one: from pixel boundary to pixel boundary, one pixel high at least
    expect(rects[2]!.points[0]).toEqual([67, 267]);
    expect(rects[2]!.size).toEqual([200, 1]);
    // A hairline on a pixel center, a line of 2 pixels on a pixel boundary
    const lines = ctx.ops('moveTo');
    expect(lines[0]!.points[0]).toEqual([67, 333.5]);
    expect(lines[1]!.points[0]![1]).toBe(Math.round(((6008 + 15) * 96) / 1440));
    // The baseline: 7008 + 200 twips is 480.53 pixels, drawn on the row 481
    const t = ctx.ops('fillText').find((c) => c.text === 'T')!;
    expect(t.points[0]![1]).toBeCloseTo(481, 9);
    expect(t.points[0]![0]).toBeCloseTo((1003 * 96) / 1440, 9);
    // A rotated text keeps its exact position
    const u = ctx.ops('fillText').find((c) => c.text === 'U')!;
    const a = Math.PI / 4;
    expect(u.points[0]![0]).toBeCloseTo(((1003 + 200 * Math.sin(a)) * 96) / 1440, 9);
    expect(u.points[0]![1]).toBeCloseTo(((8008 + 200 * Math.cos(a)) * 96) / 1440, 9);
  });
});

describe('annotations and images in detail', () => {
  it('gives the annotations of the objects where the PDF puts them, without drawing them', async () => {
    const meta = newMeta();
    const page = meta.pages.get(0);
    text(page, 1000, 1000, 3000, 300, 'Link');
    const link = page.objects[0]!;
    link.annotationP = page.addString('URL:https://reportman.es');
    link.annotationS = 'URL:https://reportman.es'.length;
    const shape = page.drawShape(1000, 2000, 1500, 600, ShapeType.Rectangle, BrushType.Solid, PenType.Solid, 0, 0, 0xffffff);
    shape.annotationP = page.addString('A note');
    shape.annotationS = 6;
    const ctx = new FakeContext();
    const result = await drawPage(ctx, meta, 0, { scale: 15, snapToPixels: false });
    expect(result.annotations).toEqual([
      { objectIndex: 0, kind: 'link', text: 'https://reportman.es', x: 1000, y: 1000, width: 3000, height: 300 },
      // C# parity: the right and bottom passed as the width and height
      { objectIndex: 1, kind: 'note', text: 'A note', x: 1000, y: 2000, width: 1000 + 1500, height: 2000 + 600 },
    ]);
  });

  it('masks the palette entries of a bitmap and keeps the alpha of 32 bits, as the PDF embeds them', () => {
    // Palette entries with a fourth byte of 0 go into the color key mask, written without
    // separators: entries 1 and 3 give "[ 1 13 3 ]", whose first pair a reader takes, 1 to 13, so
    // the entry 2 is masked too
    const indexed = new Uint8Array(
      bmp(4, 1, 8, (x: number) => x, [
        [10, 20, 30, 255],
        [40, 50, 60, 0],
        [70, 80, 90, 255],
        [100, 110, 120, 0],
      ]),
    );
    const p = prepareImage(indexed).input as Extract<ImageInput, { kind: 'rgba' }>;
    expect([...p.pixels]).toEqual([10, 20, 30, 255, 40, 50, 60, 0, 70, 80, 90, 0, 100, 110, 120, 0]);
    const alpha = new Uint8Array(bmp(2, 1, 32, (x: number) => [255, 0, 0, x * 128]));
    const q = prepareImage(alpha).input as Extract<ImageInput, { kind: 'rgba' }>;
    expect([...q.pixels]).toEqual([255, 0, 0, 0, 255, 0, 0, 128]);
  });

  it('gives a JPEG to the browser without its Exif orientation, which the PDF viewers ignore', () => {
    const seg = (marker: number, body: number[]): number[] => [0xff, marker, (body.length + 2) >> 8, (body.length + 2) & 0xff, ...body];
    const exif = seg(0xe1, [0x45, 0x78, 0x69, 0x66, 0, 0, 1, 2, 3]);
    const sof = seg(0xc0, [8, 0, 2, 0, 3, 1, 1, 0x11, 0]);
    const jpeg = new Uint8Array([0xff, 0xd8, ...seg(0xe0, [0x4a, 0x46]), ...exif, ...sof, 0xff, 0xda, 0, 2, 9, 9, 0xff, 0xd9]);
    const prepared = prepareImage(jpeg);
    expect([prepared.width, prepared.height]).toEqual([3, 2]);
    const input = prepared.input as Extract<ImageInput, { kind: 'encoded' }>;
    expect([...input.bytes]).toEqual([0xff, 0xd8, ...seg(0xe0, [0x4a, 0x46]), ...sof, 0xff, 0xda, 0, 2, 9, 9, 0xff, 0xd9]);
  });

  it('smooths an image unless it is enlarged four times or more', async () => {
    const meta = newMeta();
    const page = meta.pages.get(0);
    const small = new Uint8Array(bmp(4, 2, 24, () => [0, 0, 0]));
    const large = new Uint8Array(bmp(200, 100, 24, () => [0, 0, 0]));
    page.drawImage(1000, 1000, 1500, 750, ImageDrawStyleType.Stretch, 96, small);
    page.drawImage(1000, 3000, 1500, 750, ImageDrawStyleType.Stretch, 96, large);
    const ctx = new FakeContext();
    await drawPage(ctx, meta, 0, { scale: 1, loadImage: fakeLoader().loader });
    expect(ctx.ops('drawImage').map((c) => c.smoothing)).toEqual([false, true]);
  });
});

describe('renderPages', () => {
  it('appends a canvas per page, sharp at the pixel ratio and the size of the page on the screen', async () => {
    const meta = newMeta(2);
    text(meta.pages.get(1), 1000, 1000, 3000, 300, 'Second');
    const contexts: FakeContext[] = [];
    const appended: unknown[] = [];
    const doc = {
      defaultView: { devicePixelRatio: 2 },
      createElement: () => {
        const ctx = new FakeContext();
        contexts.push(ctx);
        return { width: 0, height: 0, style: {} as Record<string, string>, className: '', getContext: () => ctx };
      },
    };
    const container = { ownerDocument: doc, appendChild: (c: unknown) => appended.push(c) } as unknown as HTMLElement;
    const pages: number[] = [];
    const canvases = await renderPages(container, meta, { scale: 1, className: 'page', onPage: (_c, r) => pages.push(r.pageIndex) });
    expect(canvases).toHaveLength(2);
    expect(appended).toHaveLength(2);
    expect(pages).toEqual([0, 1]);
    const first = canvases[0] as unknown as { width: number; height: number; style: Record<string, string>; className: string };
    expect([first.width, first.height, first.style.width, first.style.height, first.className]).toEqual([1588, 2246, '794px', '1123px', 'page']);
    expect(contexts[1]!.ops('fillText').map((c) => c.text).join('')).toBe('Second');
  });
});
