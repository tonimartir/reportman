// HTML output of a metafile: a port of the HTML driver of the Delphi engine (rphtmldriver.pas,
// ExportMetafileToHtml and ExportMetafileToHtmlSingle), which the C# engine does not have. Every
// object of a page is an absolutely positioned DIV with a CSS class for its font: texts (HTML
// escaped, line breaks as <br/>), rectangles and lines as borders and backgrounds, images as IMG or
// as the background of the DIV (tiled). The other shapes give an empty DIV.

import {
  ImageDrawStyleType,
  MetaObjectType,
  ShapeType,
  type MetaFile,
  type MetaObject,
  type MetaObjectDraw,
  type MetaObjectImage,
  type MetaObjectText,
  type MetaPage,
} from '@reportman/metafile';
import {
  CRLF,
  DelphiImageError,
  changeFileExt,
  colorToRgbHex,
  getBitmapInfo,
  getJpegInfo,
  imageBaseName,
  pageFileName,
  pageRange,
  roundHalfEven,
  twipsToPoints,
  twipsToPx,
  type ExportedPage,
  type ExportedPages,
} from './svg.js';

/** Options of metafileToHtml. */
export interface HtmlOptions {
  /** The pages, 1-based and inclusive; all of them by default. */
  fromPage?: number;
  toPage?: number;
  /** The caption of the document, its <TITLE> ('' by default). */
  caption?: string;
  /**
   * The file name the Delphi driver is given ('report.html' by default). Each page is named after
   * it, its page index (0 based) before the extension (report0.html, report1.html...), and so is
   * each image (reportpage0obj3.jpg: page and object index), whose name the page refers to: a
   * folder in the name is kept in the references.
   */
  fileName?: string;
}

/** Options of metafileToHtmlSingle. */
export interface HtmlSingleOptions {
  /** The caption of the document, its <TITLE> ('' by default). */
  caption?: string;
}

const ALIGN_RIGHT = 2;
const ALIGN_HCENTER = 4;
const ALIGN_BOTTOM = 16;
const ALIGN_VCENTER = 32;
const SINGLE_LINE = 64;
const ALIGN_HJUSTIFY = 1024;
const PEN_CLEAR = 5;
const BRUSH_CLEAR = 1;

/** ColorToHTMLColor of the HTML driver: #RRGGBB. */
function htmlColor(color: number): string {
  return '#' + colorToRgbHex(color);
}

/** RpHtmlEncode and the line breaks: LF is <br/>, CR is removed. */
function textToHtml(text: string): string {
  return text
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&apos;')
    .replaceAll('\n', '<br/>')
    .replaceAll('\r', '');
}

const BASE64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';

/** MIMEEncodeString (Indy's TIdEncoderMIME): base64 with padding, in one line. */
function base64(data: Uint8Array): string {
  let s = '';
  let i = 0;
  for (; i + 2 < data.length; i += 3) {
    const n = ((data[i] as number) << 16) | ((data[i + 1] as number) << 8) | (data[i + 2] as number);
    s += BASE64[n >> 18]! + BASE64[(n >> 12) & 63]! + BASE64[(n >> 6) & 63]! + BASE64[n & 63]!;
  }
  if (i < data.length) {
    const b1 = data[i + 1];
    const n = ((data[i] as number) << 16) | ((b1 ?? 0) << 8);
    s += BASE64[n >> 18]! + BASE64[(n >> 12) & 63]! + (b1 === undefined ? '=' : BASE64[(n >> 6) & 63]!) + '=';
  }
  return s;
}

/**
 * The single line flag the driver reads from every object. Delphi parity: for a shape or an image
 * Delphi reads the bytes of its variant record past its fields, which the engine leaves at 0.
 */
function alignmentOf(obj: MetaObject): number {
  return obj.metaType === MetaObjectType.Text ? (obj as MetaObjectText).alignment : 0;
}

/** ObjectToStyle: the CSS of the font of a text, an empty rule for the rest. */
function objectToStyle(page: MetaPage, obj: MetaObject): string {
  let s = '{ ';
  if (obj.metaType === MetaObjectType.Text) {
    const text = obj as MetaObjectText;
    s += 'FONT-FAMILY:"' + page.getWFontNameText(text) + '","' + page.getLFontNameText(text) + '";';
    s += 'COLOR:' + htmlColor(text.fontColor) + ';';
    if (text.transparent) s += 'BACKGROUND-COLOR:TRANSPARENT;';
    else s += 'BACKGROUND-COLOR:' + htmlColor(text.backColor) + ';';
    s += 'FONT-SIZE:' + String(text.fontSize) + 'PT;';
    s += (text.fontStyle & 1) > 0 ? 'FONT-WEIGHT:BOLD;' : 'FONT-WEIGHT:NORMAL;';
    s += (text.fontStyle & 2) > 0 ? 'FONT-STYLE:ITALIC;' : 'FONT-STYLE:NORMAL;';
    // Delphi parity: an underlined text gets both decorations, the second one (NONE, or the
    // misspelt LINE-THROUGHT of a strikeout) wins
    if ((text.fontStyle & 4) > 0) s += 'TEXT-DECORATION:UNDERLINE;';
    s += (text.fontStyle & 8) > 0 ? 'TEXT-DECORATION:LINE-THROUGHT;' : 'TEXT-DECORATION:NONE;';
  }
  return s + '}';
}

/**
 * The styles of the objects as the sorted TStringList of Delphi finds them: the first object with
 * a style names its class (.fc<index>), the next ones with the same style, compared without case
 * (AnsiCompareText), use that class.
 */
class StyleClasses {
  private readonly byKey = new Map<string, number>();

  /** The class index of a style, or undefined (and the style is added) for a new one. */
  find(style: string, index: number): number | undefined {
    const key = style.toUpperCase();
    const existing = this.byKey.get(key);
    if (existing === undefined) this.byKey.set(key, index);
    return existing;
  }
}

/** The image of an object: its bytes, the name of its file and the size the driver gives it. */
interface ImageFacts {
  data: Uint8Array;
  name: string;
  fileExt: string;
  width: number;
  height: number;
}

/**
 * What both functions of the driver read of an image: GetJPegInfo and, for a BMP, GetBitmapInfo
 * (without its pixels), whose errors they raise, and the size of a full size image.
 */
function imageFacts(page: MetaPage, pageIndex: number, image: MetaObjectImage, fileName: string, index: number): ImageFacts {
  let name = imageBaseName(fileName, pageIndex, index);
  const data = page.getStream(image);
  const info = getJpegInfo(data);
  let fileExt = '';
  let bitmapWidth = info.width;
  let bitmapHeight = info.height;
  if (info.format === 'JPEG') {
    name = changeFileExt(name, '.jpg');
    fileExt = 'jpg';
  } else if (info.format === 'BMP') {
    const bitmap = getBitmapInfo(data);
    bitmapWidth = bitmap.width;
    bitmapHeight = bitmap.height;
    name = changeFileExt(name, '.bmp');
    fileExt = 'bmp';
  }
  // Delphi parity: a PNG or a GIF has no size here (0, the size variables of the driver are left
  // as they are), so a full size PNG is 0 by 0
  let width = image.width;
  let height = image.height;
  if (image.drawImageStyle === ImageDrawStyleType.Full) {
    width = fullSize(bitmapWidth, image.dpiRes);
    height = fullSize(bitmapHeight, image.dpiRes);
  }
  return { data, name, fileExt, width, height };
}

const TWO_63 = 2 ** 63;

/**
 * round(pixels/dpi*1440) into an Integer: the size in twips of an image at its resolution. The
 * floating point exceptions are masked (Delphi 12 and later), so a resolution of 0 gives an
 * infinite or NaN that Round turns into the integer indefinite (the lowest Int64), whose 32 low
 * bits, the Integer the driver keeps, are 0.
 */
function fullSize(pixels: number, dpi: number): number {
  const value = (pixels / dpi) * 1440;
  if (!Number.isFinite(value) || Math.abs(value) >= TWO_63) return 0;
  return Number(BigInt.asIntN(32, BigInt(roundHalfEven(value))));
}

/** The data URI of an embedded image (the extension of a PNG or a GIF is empty, as in Delphi). */
function dataUri(facts: ImageFacts): string {
  return 'data:image/' + facts.fileExt + ';base64,' + base64(facts.data);
}

/** ObjectToHtmlText: the content of the DIV of an object. */
function objectToHtmlText(
  page: MetaPage,
  pageIndex: number,
  obj: MetaObject,
  fileName: string,
  index: number,
  embedImages: boolean,
  files: Map<string, Uint8Array>,
): string {
  if (obj.metaType === MetaObjectType.Text) return textToHtml(page.getText(obj as MetaObjectText));
  if (obj.metaType !== MetaObjectType.Image) return '';
  try {
    const facts = imageFacts(page, pageIndex, obj as MetaObjectImage, fileName, index);
    let source = facts.name;
    // The file is saved for every draw style, a tiled image too (its DIV refers to it)
    if (embedImages) source = dataUri(facts);
    else files.set(facts.name, facts.data);
    const style = (obj as MetaObjectImage).drawImageStyle;
    if (style === ImageDrawStyleType.Tile || style === ImageDrawStyleType.Tiledpi) source = '';
    if (source.length === 0) return '';
    return '<IMG SRC="' + source + '" HEIGHT=' + twipsToPx(facts.height) + 'PX ' + ' WIDTH=' + twipsToPx(facts.width) + 'PX' + ' BORDER=0>';
  } catch (e) {
    // The message of the error instead of the image. ObjectBounds reads the image first and does
    // not catch these errors, so in practice the export has already stopped.
    if (e instanceof DelphiImageError) return textToHtml(e.message);
    throw e;
  }
}

/** ObjectBounds: the style attribute of the DIV of an object, quotes included ('' for no style). */
function objectBounds(page: MetaPage, pageIndex: number, obj: MetaObject, fileName: string, index: number, yOffset: number, embedImages: boolean): string {
  const position = (o: MetaObject): string => 'left:' + twipsToPx(o.left) + 'PX;' + 'top:' + twipsToPx(o.top + yOffset) + 'PX;';
  switch (obj.metaType) {
    case MetaObjectType.Text: {
      const text = obj as MetaObjectText;
      let s = '"' + position(text) + 'width:' + twipsToPx(text.width) + 'PX;' + 'height:' + twipsToPx(text.height) + 'PX;';
      const a = text.alignment;
      if ((a & ALIGN_RIGHT) > 0) s += 'text-align:right;';
      else if ((a & ALIGN_HCENTER) > 0) s += 'text-align:center;';
      else if ((a & ALIGN_HJUSTIFY) > 0) s += 'text-align:justify;';
      else s += 'text-align:left;';
      if ((a & ALIGN_BOTTOM) > 0) s += 'vertical-align:bottom;';
      else if ((a & ALIGN_VCENTER) > 0) s += 'vertical-align:middle;';
      return s + '"';
    }
    case MetaObjectType.Draw: {
      const draw = obj as MetaObjectDraw;
      let penWidth = twipsToPoints(draw.penWidth);
      if (penWidth < 1) penWidth = 1;
      switch (draw.drawStyle) {
        case ShapeType.Rectangle: {
          let s = '"' + position(draw) + 'width:' + twipsToPx(draw.width) + 'PX;' + 'height:' + twipsToPx(draw.height) + 'PX;';
          if (draw.penStyle !== PEN_CLEAR) {
            s += 'BORDER-STYLE:SOLID;';
            s += 'BORDER-COLOR:' + htmlColor(draw.penColor) + ';';
            s += 'BORDER-WIDTH:' + penWidth + 'PX;';
          }
          if (draw.brushStyle === BRUSH_CLEAR) s += 'BACKGROUND-COLOR:TRANSPARENT;';
          else s += 'BACKGROUND-COLOR:' + htmlColor(draw.brushColor) + ';';
          return s + '"';
        }
        case ShapeType.HorzLine: {
          let s = '"' + position(draw) + 'width:' + twipsToPx(draw.width) + 'PX;' + 'height:1PX;';
          if (draw.penStyle !== PEN_CLEAR) s += 'BORDER-TOP:' + penWidth + 'PX SOLID ' + htmlColor(draw.penColor) + ';';
          return s + '"';
        }
        case ShapeType.VertLine: {
          let s = '"' + position(draw) + 'width:1PX;' + 'height:' + twipsToPx(draw.height) + 'PX;';
          if (draw.penStyle !== PEN_CLEAR) s += 'BORDER-LEFT:' + penWidth + 'PX SOLID ' + htmlColor(draw.penColor) + ';';
          return s + '"';
        }
        default:
          // Squares, ellipses, rounded and oblique shapes are not drawn
          return '';
      }
    }
    case MetaObjectType.Image: {
      const image = obj as MetaObjectImage;
      let s = '"' + position(image);
      // The errors reading the image are not caught here: the export stops
      const facts = imageFacts(page, pageIndex, image, fileName, index);
      if (image.drawImageStyle === ImageDrawStyleType.Tile || image.drawImageStyle === ImageDrawStyleType.Tiledpi) {
        s += 'background-image:url(' + (embedImages ? dataUri(facts) : facts.name) + ');';
      }
      return s + 'width:' + twipsToPx(facts.width) + 'PX;' + 'height:' + twipsToPx(facts.height) + 'PX;' + '"';
    }
    default:
      return '';
  }
}

/** A DIV of an object: its bounds, its class, the single line mark and its content. */
function objectDiv(
  page: MetaPage,
  pageIndex: number,
  obj: MetaObject,
  fileName: string,
  index: number,
  yOffset: number,
  embedImages: boolean,
  styleClass: number,
  files: Map<string, Uint8Array>,
): string {
  const singleLine = (alignmentOf(obj) & SINGLE_LINE) > 0;
  let s = CRLF + '<DIV style=' + objectBounds(page, pageIndex, obj, fileName, index, yOffset, embedImages) + '><span class="fc' + styleClass + '">';
  if (singleLine) s += '<NOBR>';
  s += objectToHtmlText(page, pageIndex, obj, fileName, index, embedImages, files);
  if (singleLine) s += '</NOBR>';
  return s + '</span></DIV>';
}

const bodyTag = (meta: MetaFile): string =>
  '<BODY  BGCOLOR="' + htmlColor(meta.backColor) + '" LEFTMARGIN=0 TOPMARGIN=0 BOTTOMMARGIN=0 RIGHTMARGIN=0>';

/** ExportPageToHtml. */
function exportPageToHtml(meta: MetaFile, page: MetaPage, pageIndex: number, caption: string, fileName: string, files: Map<string, Uint8Array>): string {
  const objects = page.objects;
  const styleClasses: number[] = [];
  let s = '<HTML>';
  if (objects.length > 0) {
    s += CRLF + '<STYLE>';
    s += CRLF + '.pg{position:absolute;top:0px;left:0px;height:' + twipsToPx(meta.customY) + 'px;width:' + twipsToPx(meta.customX) + 'px;}';
    s += CRLF + 'DIV {position:absolute}';
    // A style for each report component
    const styles = new StyleClasses();
    for (let i = 0; i < objects.length; i++) {
      const style = objectToStyle(page, objects[i] as MetaObject);
      const existing = styles.find(style, i);
      if (existing !== undefined) styleClasses[i] = existing;
      else {
        s += CRLF + '.fc' + i + ' ' + style;
        styleClasses[i] = i;
      }
    }
    s += CRLF + '</STYLE>';
  }
  s += CRLF + '<TITLE>' + textToHtml(caption) + '</TITLE>';
  if (objects.length > 0) {
    s += CRLF + bodyTag(meta);
    for (let i = 0; i < objects.length; i++) {
      s += objectDiv(page, pageIndex, objects[i] as MetaObject, fileName, i, 0, false, styleClasses[i] as number, files);
    }
    s += CRLF + '</BODY>';
  }
  s += CRLF + '</HTML>';
  return s;
}

/**
 * The pages of a metafile as HTML documents (ExportMetafileToHtml): one document per page, with
 * the image files they refer to. The errors reading an image stop the export, as in Delphi.
 */
export function metafileToHtml(meta: MetaFile, options: HtmlOptions = {}): ExportedPages {
  const caption = options.caption ?? '';
  const fileName = options.fileName ?? 'report.html';
  const files = new Map<string, Uint8Array>();
  const pages: ExportedPage[] = [];
  for (const index of pageRange(meta, options.fromPage, options.toPage)) {
    const text = exportPageToHtml(meta, meta.pages.get(index), index, caption, fileName, files);
    pages.push({ index, fileName: pageFileName(fileName, index), text });
  }
  return { pages, files };
}

/**
 * Every page of a metafile in one HTML document (ExportMetafileToHtmlSingle): the pages one under
 * the other, the images inline as data URIs. Delphi writes it in the ANSI code page:
 * windows1252Bytes gives those bytes.
 *
 * Delphi parity: the class of a style is named after the index of the object in its page, so a
 * style first used on a later page can repeat the name of a class of an earlier page (the later
 * rule wins in the browser).
 */
export function metafileToHtmlSingle(meta: MetaFile, options: HtmlSingleOptions = {}): string {
  const caption = options.caption ?? '';
  const count = meta.pages.currentCount;
  let s = '<HTML>';
  s += CRLF + '<STYLE>';
  // The integer product of Delphi (32 bits)
  s += CRLF + '.pg{position:absolute;top:' + '0px;left:0px;height:' + twipsToPx(Math.imul(meta.customY, count)) + 'px;width:' + twipsToPx(meta.customX) + 'px;}';
  s += CRLF + 'DIV {position:absolute}';
  const styleClasses: number[] = [];
  const styles = new StyleClasses();
  for (let p = 0; p < count; p++) {
    const page = meta.pages.get(p);
    for (let i = 0; i < page.objects.length; i++) {
      const style = objectToStyle(page, page.objects[i] as MetaObject);
      const existing = styles.find(style, i);
      if (existing !== undefined) styleClasses.push(existing);
      else {
        s += CRLF + '.fc' + i + ' ' + style;
        styleClasses.push(i);
      }
    }
  }
  s += CRLF + '</STYLE>';
  s += CRLF + '<TITLE>' + textToHtml(caption) + '</TITLE>';
  s += CRLF + bodyTag(meta);
  // No image file is written: the images are inline, the names are not used
  const files = new Map<string, Uint8Array>();
  let currentPosY = 0;
  let objectId = 0;
  for (let p = 0; p < count; p++) {
    const page = meta.pages.get(p);
    for (let i = 0; i < page.objects.length; i++) {
      s += objectDiv(page, p, page.objects[i] as MetaObject, '', i, currentPosY, true, styleClasses[objectId] as number, files);
      objectId++;
    }
    currentPosY += meta.customY;
  }
  s += CRLF + '</BODY>';
  s += CRLF + '</HTML>';
  return s;
}
