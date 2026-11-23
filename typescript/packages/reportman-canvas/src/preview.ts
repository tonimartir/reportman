// The preview: the pages of a metafile drawn on a Canvas 2D context, object by object as the PDF
// device draws them (PdfDevice.drawObject), with the canvas of painter.ts.

import {
  ImageDrawStyleType,
  MetaObjectDraw,
  MetaObjectImage,
  MetaObjectText,
  MetaObjectType,
  PDFConformanceType,
  PDFFontType,
  PrinterFontsType,
  ShapeType,
  TWIPS_PER_INCH,
  intDiv,
  roundHalfEven,
} from '@reportman/metafile';
import type { MetaFile, MetaObject, MetaPage } from '@reportman/metafile';
import { POINTS_PER_INCH } from '@reportman/pdf';
import { FontInfoFt, type FontInfoProvider, type FontLibrary } from '@reportman/text';
import type { CanvasContext, CanvasImage } from './context.js';
import { DEFAULT_FAMILIES, OutlineCache, type StandardFamilies } from './fonts.js';
import { browserImageLoader, prepareImage, type ImageLoader, type PreparedImage } from './images.js';
import { pdfPageSizes, type TwipsSize } from './pagesize.js';
import { PreviewCanvas, type SkippedObject } from './painter.js';

/** The radius of a rounded rectangle, twips (RECTANGLE_RADIUS of the PDF device). */
const RECTANGLE_RADIUS = 160;

/** CSS pixels per inch: a scale of 1 draws a page at its size on the screen. */
export const CSS_PIXELS_PER_INCH = 96;

/** Options of a preview. */
export interface CanvasPreviewOptions {
  /**
   * The TrueType fonts the metafile was laid out with (the fonts of the PDF device): every text is
   * shaped and drawn with the outlines of the glyphs the PDF embeds. Without them, the standard 14
   * PDF fonts, drawn with the browser families of `families`.
   */
  fonts?: FontLibrary;
  /** Decodes the images (createImageBitmap of the browser by default). */
  loadImage?: ImageLoader;
  /** The browser families of Helvetica, Times and Courier. */
  families?: Partial<StandardFamilies>;
}

/** Options of the drawing of a page. */
export interface DrawPageOptions {
  /** Pixels of the context per CSS pixel: 1 (the default) is 96 pixels per inch. */
  scale?: number;
  /** The color of the page, a CSS color ('#ffffff' by default); null leaves what the context has. */
  background?: string | null;
  /**
   * The narrowest line, in pixels of the context (1 by default): PDF viewers draw the hairlines of
   * a report (a pen of width 0 is 1 twip) one pixel wide. 0 draws every line its exact width.
   */
  minLineWidth?: number;
  /**
   * Align to the pixels of the context the horizontal and vertical lines and rectangles (their
   * edges on pixel boundaries, one pixel at least, as the stroke adjustment of PDF viewers keeps
   * rules and barcode bars sharp) and the baselines of the texts (true by default). The pixels are
   * taken as aligned with the origin of the page; false draws every coordinate as it is.
   */
  snapToPixels?: boolean;
}

/** What drawing a page did. */
export interface DrawPageResult {
  pageIndex: number;
  /** The size of the page in pixels of the context (pageSize). */
  width: number;
  height: number;
  /** The objects left out, or in part, and why: nothing is thrown in the middle of a page. */
  skipped: SkippedObject[];
  /**
   * The annotations of the objects, which the PDF adds to the page for the viewer (a link opens an
   * address, a note shows its text) and the preview does not draw: a viewer puts them over the
   * canvas.
   */
  annotations: PageAnnotation[];
}

/** An annotation of an object, where the PDF puts it. */
export interface PageAnnotation {
  objectIndex: number;
  /** A link (an annotation that starts with URL:) or a text note. */
  kind: 'link' | 'note';
  /** The address of a link, the text of a note. */
  text: string;
  /** Its rectangle in pixels of the context (the rectangle the PDF device gives it). */
  x: number;
  y: number;
  width: number;
  height: number;
}

/** A size in pixels. */
export interface PixelSize {
  width: number;
  height: number;
}

interface ImageEntry {
  prepared: PreparedImage | null;
  image: CanvasImage | null;
  error: string | null;
  loading: Promise<void> | null;
}

/** Convert.ToInt32(double) of the PDF device, which fails for NaN and values out of the int range. */
function convertToInt32Checked(x: number): number {
  const r = roundHalfEven(x);
  if (!Number.isFinite(r) || r > 2147483647 || r < -2147483648) throw new RangeError('Value was either too large or too small for an Int32.');
  return r | 0;
}

function messageOf(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

/** Pixels per twip at a scale. */
function pixelsPerTwip(scale: number): number {
  return (scale * CSS_PIXELS_PER_INCH) / TWIPS_PER_INCH;
}

/** Pixels of a length in twips, rounded up as pdftoppm sizes its pages. */
function pixelsOf(twips: number, scale: number): number {
  return Math.max(0, Math.ceil(twips * pixelsPerTwip(scale) - 1e-7));
}

/** The size in pixels of a page at a scale (1 = 96 pixels per inch), as the PDF sizes the page. */
export function pageSize(meta: MetaFile, pageIndex: number, scale = 1): PixelSize {
  const size = pdfPageSizes(meta)[pageIndex];
  if (size === undefined) throw new RangeError('The metafile has no page ' + String(pageIndex));
  return { width: pixelsOf(size.width, scale), height: pixelsOf(size.height, scale) };
}

/**
 * A preview of metafiles on Canvas 2D contexts. It keeps what it decodes (the images of each
 * metafile, the glyph outlines, the fonts), so a viewer draws every page with one preview.
 */
export class CanvasPreview {
  readonly fonts: FontLibrary | null;
  private readonly provider: FontInfoProvider | null;
  private readonly loadImage: ImageLoader;
  private readonly families: StandardFamilies;
  private readonly outlines = new OutlineCache();
  private readonly images = new WeakMap<MetaFile, Map<string, ImageEntry>>();
  private readonly canvases = new WeakMap<MetaFile, PreviewCanvas>();
  private readonly sizes = new WeakMap<MetaFile, { count: number; sizes: TwipsSize[] }>();

  constructor(options: CanvasPreviewOptions = {}) {
    this.fonts = options.fonts ?? null;
    this.provider = this.fonts === null ? null : new FontInfoFt(this.fonts);
    this.loadImage = options.loadImage ?? browserImageLoader;
    this.families = { ...DEFAULT_FAMILIES, ...options.families };
  }

  private twipsSize(meta: MetaFile, pageIndex: number): TwipsSize {
    let known = this.sizes.get(meta);
    if (known === undefined || known.count !== meta.pages.currentCount) {
      known = { count: meta.pages.currentCount, sizes: pdfPageSizes(meta) };
      this.sizes.set(meta, known);
    }
    const size = known.sizes[pageIndex];
    if (size === undefined) throw new RangeError('The metafile has no page ' + String(pageIndex));
    return size;
  }

  /** The size in pixels of a page at a scale (1 = 96 pixels per inch). */
  pageSize(meta: MetaFile, pageIndex: number, scale = 1): PixelSize {
    const size = this.twipsSize(meta, pageIndex);
    return { width: pixelsOf(size.width, scale), height: pixelsOf(size.height, scale) };
  }

  private canvasOf(meta: MetaFile): PreviewCanvas {
    let canvas = this.canvases.get(meta);
    if (canvas === undefined) {
      canvas = new PreviewCanvas(this.provider, this.outlines);
      canvas.families = this.families;
      this.canvases.set(meta, canvas);
    }
    return canvas;
  }

  private imageKey(pageIndex: number, obj: MetaObjectImage): string {
    return (obj.sharedImage ? 's:' : 'p' + String(pageIndex) + ':') + String(obj.streamPos) + ':' + String(obj.streamSize);
  }

  /** Decodes the images of a page that are not decoded yet (drawPage does it). */
  async loadImages(meta: MetaFile, pageIndex: number): Promise<void> {
    const page = meta.pages.get(pageIndex);
    let entries = this.images.get(meta);
    if (entries === undefined) {
      entries = new Map();
      this.images.set(meta, entries);
    }
    const pending: Promise<void>[] = [];
    for (const obj of page.objects) {
      if (obj.metaType !== MetaObjectType.Image || !(obj instanceof MetaObjectImage)) continue;
      const key = this.imageKey(pageIndex, obj);
      const known = entries.get(key);
      if (known !== undefined) {
        if (known.loading !== null) pending.push(known.loading);
        continue;
      }
      const entry: ImageEntry = { prepared: null, image: null, error: null, loading: null };
      entries.set(key, entry);
      try {
        entry.prepared = prepareImage(page.getStream(obj));
      } catch (e) {
        entry.error = messageOf(e);
        continue;
      }
      const input = entry.prepared.input;
      if (input === null) continue;
      entry.loading = (async () => {
        try {
          entry.image = await this.loadImage(input);
          if (entry.image === null) entry.error = 'The ' + input.format.toUpperCase() + ' image could not be decoded';
        } catch (e) {
          entry.error = 'The ' + input.format.toUpperCase() + ' image could not be decoded: ' + messageOf(e);
        } finally {
          entry.loading = null;
        }
      })();
      pending.push(entry.loading);
    }
    await Promise.all(pending);
  }

  /** Decodes the images of a page and draws it. */
  async drawPage(ctx: CanvasContext, meta: MetaFile, pageIndex: number, options: DrawPageOptions = {}): Promise<DrawPageResult> {
    await this.loadImages(meta, pageIndex);
    return this.paintPage(ctx, meta, pageIndex, options);
  }

  /**
   * Draws a page now: the images loadImages decoded (the others are left out). The context is
   * scaled from the transform it has, so the page goes to its origin, and it is left as it was.
   */
  paintPage(ctx: CanvasContext, meta: MetaFile, pageIndex: number, options: DrawPageOptions = {}): DrawPageResult {
    const scale = options.scale ?? 1;
    const size = this.twipsSize(meta, pageIndex);
    const page = meta.pages.get(pageIndex);
    const k = pixelsPerTwip(scale);
    const result: DrawPageResult = { pageIndex, width: pixelsOf(size.width, scale), height: pixelsOf(size.height, scale), skipped: [], annotations: [] };
    const canvas = this.canvasOf(meta);
    canvas.ctx = ctx;
    canvas.pdfConformance = meta.pdfConformance;
    // Printer fonts Recalculate measures every text with the shaper, as the PDF device
    canvas.forceComplexShaping = this.recalculates(meta);
    canvas.minLineWidth = (options.minLineWidth ?? 1) / k;
    canvas.pixelsPerTwip = options.snapToPixels === false ? 0 : k;
    canvas.devicePixelsPerTwip = k;
    canvas.save();
    try {
      ctx.scale(k, k);
      // Nothing outside the page, as in a PDF viewer
      ctx.beginPath();
      ctx.rect(0, 0, size.width, size.height);
      ctx.clip();
      const background = options.background === undefined ? '#ffffff' : options.background;
      if (background !== null) {
        ctx.fillStyle = background;
        ctx.fillRect(0, 0, size.width, size.height);
      }
      ctx.lineCap = 'butt';
      ctx.lineJoin = 'miter';
      ctx.miterLimit = 10;
      ctx.textAlign = 'left';
      ctx.textBaseline = 'alphabetic';
      if (ctx.fontKerning !== undefined) ctx.fontKerning = 'none';
      const images = this.images.get(meta);
      const objects = page.objects;
      for (let i = 0; i < objects.length; i++) {
        const obj = objects[i] as MetaObject;
        const depth = canvas.saveDepth;
        canvas.onSkip = (reason) => result.skipped.push({ objectIndex: i, reason });
        // PDFFile.NewAnnotation: the width and height as the PDF device passes them
        const annotate = (left: number, top: number, width: number, height: number): void => {
          const text = page.getAnnotationText(obj);
          if (text === null) return;
          const link = text.length > 4 && text.substring(0, 4).toUpperCase() === 'URL:';
          const x1 = left * k;
          const x2 = (left + width) * k;
          const y1 = top * k;
          const y2 = (top + height) * k;
          result.annotations.push({
            objectIndex: i,
            kind: link ? 'link' : 'note',
            text: link ? text.substring(4) : text,
            x: Math.min(x1, x2),
            y: Math.min(y1, y2),
            width: Math.abs(x2 - x1),
            height: Math.abs(y2 - y1),
          });
        };
        try {
          this.drawObject(canvas, meta, page, pageIndex, obj, images, annotate);
        } catch (e) {
          result.skipped.push({ objectIndex: i, reason: messageOf(e) });
          // An object that failed in the middle leaves the context as it found it
          canvas.restoreTo(depth);
        }
      }
    } finally {
      canvas.onSkip = null;
      // The clippings of the tiled images stay until the end of the page, as in the PDF
      canvas.restoreTo(0);
      canvas.ctx = null;
    }
    return result;
  }

  private recalculates(meta: MetaFile): boolean {
    return meta.printerFonts === PrinterFontsType.Recalculate && this.provider !== null;
  }

  /** Draws an object of a page as the PDF device does (DrawObject). */
  private drawObject(
    canvas: PreviewCanvas,
    meta: MetaFile,
    page: MetaPage,
    pageIndex: number,
    obj: MetaObject,
    images: Map<string, ImageEntry> | undefined,
    annotate: (left: number, top: number, width: number, height: number) => void,
  ): void {
    const posx = obj.left;
    const posy = obj.top;
    switch (obj.metaType) {
      case MetaObjectType.Text: {
        if (!(obj instanceof MetaObjectText)) return;
        if (this.recalculates(meta)) canvas.forceComplexShaping = true;
        const font = canvas.font;
        font.wFontName = page.getWFontNameText(obj);
        font.lFontName = page.getLFontNameText(obj);
        font.style = obj.fontStyle;
        font.name = obj.type1Font;
        if (meta.printerFonts === PrinterFontsType.Recalculate && meta.pdfConformance !== PDFConformanceType.PDF_A_3 && font.name !== PDFFontType.Embedded)
          font.name = PDFFontType.Linked;
        font.size = obj.fontSize;
        font.color = obj.fontColor;
        font.bold = (obj.fontStyle & 1) > 0;
        font.italic = (obj.fontStyle & 2) > 0;
        font.underline = (obj.fontStyle & 4) > 0;
        font.strikeOut = (obj.fontStyle & 8) > 0;
        font.backColor = obj.backColor;
        font.transparent = obj.transparent;
        canvas.updateFonts();
        const rec = { left: posx, top: posy, width: obj.width, height: obj.height };
        canvas.textRect(rec, page.getText(obj), obj.alignment, obj.cutText, obj.wordWrap, obj.fontRotation, obj.rightToLeft, obj.isHtml);
        annotate(posx, posy, obj.width, obj.height);
        return;
      }
      case MetaObjectType.Draw: {
        if (!(obj instanceof MetaObjectDraw)) return;
        canvas.brushStyle = obj.brushStyle;
        canvas.penStyle = obj.penStyle;
        canvas.penColor = obj.penColor;
        canvas.brushColor = obj.brushColor;
        canvas.penWidth = obj.penWidth;
        let X = intDiv(canvas.penWidth, 2);
        let Y = X;
        let W = (obj.width - canvas.penWidth + 1) | 0;
        let H = (obj.height - canvas.penWidth + 1) | 0;
        if (canvas.penWidth === 0) {
          W--;
          H--;
        }
        const S = W < H ? W : H;
        const shape = obj.drawStyle as ShapeType;
        if (shape === ShapeType.Square || shape === ShapeType.RoundSquare || shape === ShapeType.Circle) {
          X = (X + intDiv(W - S, 2)) | 0;
          Y = (Y + intDiv(H - S, 2)) | 0;
          W = S;
          H = S;
        }
        switch (shape) {
          case ShapeType.Rectangle:
          case ShapeType.Square:
            canvas.rectangle(X + posx, Y + posy, X + posx + W, Y + posy + H);
            break;
          case ShapeType.RoundRect:
          case ShapeType.RoundSquare:
            canvas.roundedRectangle(X + posx, Y + posy, X + posx + W, Y + posy + H, RECTANGLE_RADIUS);
            break;
          case ShapeType.Ellipse:
          case ShapeType.Circle:
            canvas.ellipse(X + posx, Y + posy, X + posx + W, Y + posy + H);
            break;
          case ShapeType.HorzLine:
            canvas.line(X + posx, Y + posy, X + posx + W, Y + posy);
            break;
          case ShapeType.VertLine:
            canvas.line(X + posx, Y + posy, X + posx, Y + posy + H);
            break;
          case ShapeType.Oblique1:
            canvas.line(X + posx, Y + posy, X + posx + W, Y + posy + H);
            break;
          case ShapeType.Oblique2:
            canvas.line(X + posx, Y + posy + H, X + posx + W, Y + posy);
            break;
        }
        // C# parity: the width and height given are the right and bottom coordinates
        annotate(posx + X, Y + posy, posx + X + W, posy + Y + H);
        return;
      }
      case MetaObjectType.Image: {
        if (!(obj instanceof MetaObjectImage)) return;
        const entry = images?.get(this.imageKey(pageIndex, obj));
        if (entry === undefined) throw new Error('The image was not loaded (paintPage without loadImages)');
        if (entry.prepared === null) throw new Error(entry.error ?? 'The image was not loaded');
        const prepared = entry.prepared;
        if (entry.error !== null) canvas.onSkip?.(entry.error);
        let rec = { left: posx, top: posy, width: obj.width, height: obj.height };
        switch (obj.drawImageStyle as number) {
          case ImageDrawStyleType.Full:
            canvas.drawImage(rec, prepared, entry.image, obj.dpiRes, false, false);
            break;
          case ImageDrawStyleType.Stretch:
            canvas.drawImage(rec, prepared, entry.image, 0, false, false);
            break;
          case ImageDrawStyleType.Crop: {
            // The image keeps its proportions, centered
            const binfo = prepared.cropSize;
            if (binfo instanceof Error) throw binfo;
            if (binfo === null) {
              // The decoder does not know the image: nothing to fit, drawn as the stretch style draws it
              canvas.drawImage(rec, prepared, entry.image, 0, false, false);
              break;
            }
            const propx = rec.width / binfo.width;
            const propy = rec.height / binfo.height;
            if (propy > propx) {
              const H = convertToInt32Checked(roundHalfEven((rec.height * propx) / propy));
              rec = { left: rec.left, top: (rec.top + intDiv((rec.height - H) | 0, 2)) | 0, width: rec.width, height: H };
            } else {
              const W = convertToInt32Checked((rec.width * propy) / propx);
              rec = { left: (rec.left + intDiv((rec.width - W) | 0, 2)) | 0, top: rec.top, width: W, height: rec.height };
            }
            canvas.drawImage(rec, prepared, entry.image, 0, false, false);
            break;
          }
          case ImageDrawStyleType.Tile:
          case ImageDrawStyleType.Tiledpi:
            canvas.drawImage(rec, prepared, entry.image, POINTS_PER_INCH, true, true);
            break;
        }
        annotate(rec.left, rec.top, rec.width, rec.height);
        return;
      }
      default:
        // Polygons, export texts and native barcodes: the PDF device does not draw them either
        return;
    }
  }
}

/**
 * Draws a page of a metafile on a context: decodes its images, then draws it as the PDF device
 * does. A viewer that draws several pages keeps a CanvasPreview instead, which keeps what it
 * decodes.
 */
export async function drawPage(
  ctx: CanvasContext,
  meta: MetaFile,
  pageIndex: number,
  options: DrawPageOptions & CanvasPreviewOptions = {},
): Promise<DrawPageResult> {
  return new CanvasPreview(options).drawPage(ctx, meta, pageIndex, options);
}

/** Options of renderPages. */
export interface RenderPagesOptions extends DrawPageOptions, CanvasPreviewOptions {
  /** The preview to draw with (a new one by default). */
  preview?: CanvasPreview;
  /** The pages, 0 based (every page by default). */
  pages?: readonly number[];
  /** Device pixels per CSS pixel (the devicePixelRatio of the window by default). */
  pixelRatio?: number;
  /** The class of the canvases. */
  className?: string;
  /** Called after each page, with its canvas. */
  onPage?: (canvas: HTMLCanvasElement, result: DrawPageResult) => void;
}

/**
 * A scrolling preview: one canvas per page appended to a container, each page the size of the
 * PDF page at the scale (CSS pixels) and sharp on the screen (device pixels). The pages are drawn
 * one after the other, letting the browser paint between them.
 */
export async function renderPages(container: HTMLElement, meta: MetaFile, options: RenderPagesOptions = {}): Promise<HTMLCanvasElement[]> {
  const preview = options.preview ?? new CanvasPreview(options);
  const doc = container.ownerDocument;
  const ratio = options.pixelRatio ?? doc.defaultView?.devicePixelRatio ?? 1;
  const scale = options.scale ?? 1;
  const pages = options.pages ?? Array.from({ length: meta.pages.currentCount }, (_, i) => i);
  const canvases: HTMLCanvasElement[] = [];
  for (const pageIndex of pages) {
    const canvas = doc.createElement('canvas');
    const size = preview.pageSize(meta, pageIndex, scale * ratio);
    canvas.width = size.width;
    canvas.height = size.height;
    canvas.style.width = String(size.width / ratio) + 'px';
    canvas.style.height = String(size.height / ratio) + 'px';
    if (options.className !== undefined) canvas.className = options.className;
    container.appendChild(canvas);
    canvases.push(canvas);
    const ctx = canvas.getContext('2d');
    if (ctx === null) throw new Error('The browser gives no 2D context');
    const result = await preview.drawPage(ctx, meta, pageIndex, { ...options, scale: scale * ratio });
    options.onPage?.(canvas, result);
    // Let the browser show the page before the next one
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
  }
  return canvases;
}
