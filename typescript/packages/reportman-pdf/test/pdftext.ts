// The text of a PDF of @reportman/pdf as a reader extracts it (PdfPig in the C# tests): every glyph
// of the content streams with its position, its width from the /W array of its font and its text
// from the font's /ToUnicode CMap (not from the /ActualText spans, which a reader may ignore).
// For the embedded fonts (Type0, Identity-H, one glyph per Tm/Tj); a standard 14 font string
// placed with Td gives one glyph per string, without width.

import { contentStreams } from './pdftools.js';

/** A glyph of a page, in PDF points (y up from the bottom of the page). */
export interface PdfTextGlyph {
  x: number;
  y: number;
  /** The advance of the glyph (0 when the font has no /W). */
  width: number;
  /** The characters the /ToUnicode CMap gives the glyph ("" when it has none). */
  text: string;
}

interface FontInfo {
  toUnicode: Map<number, string>;
  widths: Map<number, number>;
  defaultWidth: number;
}

function objects(src: string): Map<number, string> {
  const result = new Map<number, string>();
  const re = /(?:^|\n)(\d+) 0 obj\r?\n([\s\S]*?)\nendobj/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(src)) !== null) result.set(Number(m[1]), m[2] as string);
  return result;
}

const utf16 = (hex: string): string => {
  let s = '';
  for (let i = 0; i + 4 <= hex.length; i += 4) s += String.fromCharCode(parseInt(hex.substring(i, i + 4), 16));
  return s;
};

function parseToUnicode(body: string): Map<number, string> {
  const map = new Map<number, string>();
  for (const block of body.matchAll(/beginbfchar([\s\S]*?)endbfchar/g))
    for (const e of (block[1] as string).matchAll(/<([0-9A-Fa-f]+)>\s*<([0-9A-Fa-f]*)>/g)) map.set(parseInt(e[1] as string, 16), utf16(e[2] as string));
  for (const block of body.matchAll(/beginbfrange([\s\S]*?)endbfrange/g))
    for (const e of (block[1] as string).matchAll(/<([0-9A-Fa-f]+)>\s*<([0-9A-Fa-f]+)>\s*<([0-9A-Fa-f]+)>/g)) {
      const lo = parseInt(e[1] as string, 16);
      const hi = parseInt(e[2] as string, 16);
      const first = parseInt(e[3] as string, 16);
      for (let c = lo; c <= hi; c++) map.set(c, String.fromCharCode(first + c - lo));
    }
  return map;
}

function parseWidths(body: string): { widths: Map<number, number>; defaultWidth: number } {
  const widths = new Map<number, number>();
  const dw = /\/DW (\d+)/.exec(body);
  const start = body.indexOf('/W [');
  if (start >= 0) {
    // The array up to its closing bracket (it holds arrays itself)
    let depth = 0;
    let end = start + 3;
    for (; end < body.length; end++) {
      if (body[end] === '[') depth++;
      else if (body[end] === ']' && --depth === 0) break;
    }
    const text = body.substring(start + 4, end);
    // c [w1 w2 ...] or c1 c2 w
    const re = /(\d+)\s*\[([^\]]*)\]|(\d+)\s+(\d+)\s+([\d.]+)/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(text)) !== null) {
      if (m[1] !== undefined) {
        const first = Number(m[1]);
        (m[2] as string)
          .trim()
          .split(/\s+/)
          .filter((x) => x.length > 0)
          .forEach((x, i) => widths.set(first + i, Number(x)));
      } else for (let c = Number(m[3]); c <= Number(m[4]); c++) widths.set(c, Number(m[5]));
    }
  }
  return { widths, defaultWidth: dw === null ? 0 : Number(dw[1]) };
}

/** The embedded fonts of a PDF by their resource name (/Name of the Type0 font). */
function fonts(src: string): Map<string, FontInfo> {
  const objs = objects(src);
  const result = new Map<string, FontInfo>();
  for (const body of objs.values()) {
    if (!/\/Subtype \/Type0/.test(body)) continue;
    const name = /\/Name \/(\S+)/.exec(body);
    const tu = /\/ToUnicode (\d+) 0 R/.exec(body);
    const desc = /\/DescendantFonts \[ ?(\d+) 0 R/.exec(body);
    if (name === null) continue;
    const toUnicode = tu === null ? new Map<number, string>() : parseToUnicode(objs.get(Number(tu[1])) ?? '');
    const { widths, defaultWidth } = desc === null ? { widths: new Map<number, number>(), defaultWidth: 0 } : parseWidths(objs.get(Number(desc[1])) ?? '');
    result.set(name[1] as string, { toUnicode, widths, defaultWidth });
  }
  return result;
}

function unescape(s: string): string {
  return s.replace(/\\(.)/g, '$1');
}

/** The glyphs of each page of an uncompressed PDF, in the order they are drawn. */
export function pdfGlyphs(pdf: Uint8Array): PdfTextGlyph[][] {
  const src = Buffer.from(pdf).toString('latin1');
  const fontsByName = fonts(src);
  return contentStreams(pdf).map((stream) => {
    const glyphs: PdfTextGlyph[] = [];
    let font: FontInfo | undefined;
    let size = 0;
    let td = { x: 0, y: 0 };
    for (const line of Buffer.from(stream).toString('latin1').split(/[\r\n]+/)) {
      let m: RegExpExecArray | null;
      if ((m = /^\/(\S+) (-?[\d.]+) Tf$/.exec(line))) {
        font = fontsByName.get(m[1] as string);
        size = Number(m[2]);
      } else if ((m = /^(-?[\d.]+) (-?[\d.]+) Td$/.exec(line))) td = { x: Number(m[1]), y: Number(m[2]) };
      else if ((m = /^1 0 0 1 (-?[\d.]+) (-?[\d.]+) Tm <([0-9A-Fa-f]+)> Tj$/.exec(line))) {
        let x = Number(m[1]);
        const y = Number(m[2]);
        const hex = m[3] as string;
        for (let i = 0; i + 4 <= hex.length; i += 4) {
          const code = parseInt(hex.substring(i, i + 4), 16);
          const width = ((font?.widths.get(code) ?? font?.defaultWidth ?? 0) * size) / 1000;
          glyphs.push({ x, y, width, text: font?.toUnicode.get(code) ?? '' });
          x += width;
        }
      } else if ((m = /^\((.*)\) Tj$/.exec(line))) glyphs.push({ x: td.x, y: td.y, width: 0, text: unescape(m[1] as string) });
    }
    return glyphs;
  });
}

/** The text of each page: the characters of its glyphs in drawing order (as PdfPig's Page.Text). */
export function pdfPageTexts(pdf: Uint8Array): string[] {
  return pdfGlyphs(pdf).map((page) => page.map((g) => g.text).join(''));
}

/** A word: glyphs of one baseline between spaces, with its left and right edges. */
export interface PdfWord {
  text: string;
  left: number;
  right: number;
  y: number;
}

/** The words of a page, split at the space glyphs and at a change of baseline. */
export function pdfWords(glyphs: PdfTextGlyph[]): PdfWord[] {
  const words: PdfWord[] = [];
  let current: PdfWord | null = null;
  for (const g of glyphs) {
    const blank = g.text.trim() === '';
    if (blank || (current !== null && Math.abs(current.y - g.y) > 0.01)) {
      if (current !== null) words.push(current);
      current = null;
    }
    if (blank) continue;
    if (current === null) current = { text: g.text, left: g.x, right: g.x + g.width, y: g.y };
    else {
      current.text += g.text;
      current.left = Math.min(current.left, g.x);
      current.right = Math.max(current.right, g.x + g.width);
    }
  }
  if (current !== null) words.push(current);
  return words;
}
