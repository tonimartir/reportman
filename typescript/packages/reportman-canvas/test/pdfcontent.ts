// What the PDF device writes on a page, read back from its content stream (uncompressed PDF of
// @reportman/pdf), in twips with y down as the preview draws: the reference of the tests.

import { contentStreams } from '../../reportman-pdf/test/pdftools.js';

/** A string of the standard fonts placed with Td: its baseline origin and its characters. */
export interface PdfText {
  x: number;
  y: number;
  text: string;
}

/** A glyph of an embedded font placed with Tm: its origin and its code (the glyph number). */
export interface PdfGlyph {
  x: number;
  y: number;
  code: number;
}

export interface PdfRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface PdfPage {
  texts: PdfText[];
  glyphs: PdfGlyph[];
  rects: PdfRect[];
  images: PdfRect[];
  lines: { x1: number; y1: number; x2: number; y2: number }[];
}

function unescape(s: string): string {
  return s.replace(/\\(.)/g, '$1');
}

/** The objects of each page of an uncompressed PDF, in twips, y down from the top of the page. */
export function pdfPages(pdf: Uint8Array, pageHeights: number[]): PdfPage[] {
  return contentStreams(pdf).map((stream, index) => {
    const h = pageHeights[index] ?? (pageHeights[0] as number);
    const X = (v: string): number => Number(v) * 20;
    const Y = (v: string): number => h - Number(v) * 20;
    const page: PdfPage = { texts: [], glyphs: [], rects: [], images: [], lines: [] };
    // Lines end with CR LF, LF, or LF CR (the end of line of the shaped text of PDF 1.4)
    const lines = Buffer.from(stream).toString('latin1').split(/[\r\n]+/);
    let td: { x: number; y: number } | null = null;
    let translate: { x: number; y: number } | null = null;
    let move: { x: number; y: number } | null = null;
    for (let i = 0; i < lines.length; i++) {
      const l = lines[i] as string;
      let m: RegExpExecArray | null;
      if ((m = /^(-?[\d.]+) (-?[\d.]+) Td$/.exec(l))) td = { x: X(m[1] as string), y: Y(m[2] as string) };
      else if ((m = /^\((.*)\) Tj$/.exec(l)) && td !== null) {
        page.texts.push({ ...td, text: unescape(m[1] as string) });
        td = null;
      } else if ((m = /^1 0 0 1 (-?[\d.]+) (-?[\d.]+) Tm <([0-9A-F]+)> Tj$/.exec(l)))
        page.glyphs.push({ x: X(m[1] as string), y: Y(m[2] as string), code: parseInt(m[3] as string, 16) });
      else if ((m = /^(-?[\d.]+) (-?[\d.]+) (-?[\d.]+) (-?[\d.]+) re$/.exec(l)))
        page.rects.push({ x: X(m[1] as string), y: Y(m[2] as string), w: X(m[3] as string), h: -X(m[4] as string) });
      else if ((m = /^1 0 0 1 (-?[\d.]+) (-?[\d.]+) cm$/.exec(l))) translate = { x: X(m[1] as string), y: Y(m[2] as string) };
      else if ((m = /^(-?[\d.]+) 0 0 {2}(-?[\d.]+) 0 0 cm$/.exec(l)) && translate !== null) {
        const w = X(m[1] as string);
        const ih = X(m[2] as string);
        if (/^\/Im\d+ Do$/.test(lines[i + 1] ?? '')) page.images.push({ x: translate.x, y: translate.y - ih, w, h: ih });
        translate = null;
      } else if ((m = /^(-?[\d.]+) (-?[\d.]+) m$/.exec(l))) move = { x: X(m[1] as string), y: Y(m[2] as string) };
      else if ((m = /^(-?[\d.]+) (-?[\d.]+) l$/.exec(l)) && move !== null && lines[i + 1] === 'S') {
        page.lines.push({ x1: move.x, y1: move.y, x2: X(m[1] as string), y2: Y(m[2] as string) });
        move = null;
      }
    }
    return page;
  });
}
