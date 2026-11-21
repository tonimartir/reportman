// Rebuilds a TypeScript MetaFile from the metafile JSON golden-cs writes, plus what that JSON
// does not carry and the C# PDF shows: the document metadata (information dictionary) and the
// page sizes (MediaBox), and the annotation texts of a fixture (features.annotations.json).

import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import {
  MetaFile,
  MetaObject,
  MetaObjectDraw,
  MetaObjectText,
  MetaPage,
  OrientationType,
} from 'reportman-metafile';

export const fixturesDir = fileURLToPath(new URL('./fixtures/', import.meta.url));

interface GoldenObject {
  class: string;
  text?: string;
  lFontName?: string;
  wFontName?: string;
  [key: string]: unknown;
}

interface GoldenMeta {
  pageSizeIndex: number;
  customX: number;
  customY: number;
  orientation: string;
  backColor: number;
  pages: { orientation: string; objects: GoldenObject[] }[];
}

const FIELD_NAMES: Record<string, string> = { DPIRes: 'dpiRes' };

function fieldName(key: string): string {
  return FIELD_NAMES[key] ?? key.charAt(0).toLowerCase() + key.slice(1);
}

/** The value of a PDF string (literal or hexadecimal UTF-16BE) at a position. */
function readPdfString(src: string, pos: number): string {
  if (src.charAt(pos) === '(') {
    let out = '';
    let depth = 0;
    for (let i = pos + 1; i < src.length; i++) {
      const c = src.charAt(i);
      if (c === '\\') {
        out += src.charAt(i + 1);
        i++;
      } else if (c === '(') {
        depth++;
        out += c;
      } else if (c === ')') {
        if (depth === 0) return out;
        depth--;
        out += c;
      } else out += c;
    }
    throw new Error('Unterminated PDF string');
  }
  if (src.startsWith('<FEFF', pos)) {
    const end = src.indexOf('>', pos);
    const hex = src.substring(pos + 5, end);
    let out = '';
    for (let i = 0; i < hex.length; i += 4) out += String.fromCharCode(parseInt(hex.substring(i, i + 4), 16));
    return out;
  }
  throw new Error('Not a PDF string at ' + String(pos));
}

/** The entries of the information dictionary (object 1) of a PDF. */
export function pdfInfo(pdf: Uint8Array): Map<string, string> {
  const src = Buffer.from(pdf).toString('latin1');
  const start = src.indexOf('1 0 obj');
  const end = src.indexOf('endobj', start);
  const dict = src.substring(start, end);
  const result = new Map<string, string>();
  const re = /\/(\w+) /g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(dict)) !== null) {
    const key = m[1] as string;
    const value = readPdfString(dict, m.index + m[0].length);
    result.set(key, value);
  }
  return result;
}

/** The MediaBox of every page of a PDF written by the engine, in page order, in points. */
export function pdfMediaBoxes(pdf: Uint8Array): [number, number][] {
  const src = Buffer.from(pdf).toString('latin1');
  const result: [number, number][] = [];
  const re = /\/MediaBox \[ 0 0 ([\d.]+) ([\d.]+)\]/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(src)) !== null) result.push([parseFloat(m[1] as string), parseFloat(m[2] as string)]);
  return result;
}

export interface GoldenFixture {
  name: string;
  meta: MetaFile;
  csPdf: Uint8Array;
  json: GoldenMeta;
}

/** Loads a fixture: the TypeScript MetaFile rebuilt from its JSON, and the C# PDF. */
export function loadGolden(name: string): GoldenFixture {
  const json = JSON.parse(fs.readFileSync(fixturesDir + name + '.meta.json', 'utf8')) as GoldenMeta;
  const csPdf = new Uint8Array(fs.readFileSync(fixturesDir + name + '.cs.pdf'));
  const annotationsFile = fixturesDir + name + '.annotations.json';
  const annotations: string[] = fs.existsSync(annotationsFile) ? JSON.parse(fs.readFileSync(annotationsFile, 'utf8')) : [];
  let nextAnnotation = 0;

  const meta = new MetaFile();
  meta.pageSizeIndex = json.pageSizeIndex;
  meta.customX = json.customX;
  meta.customY = json.customY;
  meta.orientation = OrientationType[json.orientation as keyof typeof OrientationType];
  meta.backColor = json.backColor;

  // Metadata, from the information dictionary of the C# PDF
  const info = pdfInfo(csPdf);
  meta.docAuthor = info.get('Author') ?? null;
  meta.docTitle = info.get('Title') ?? null;
  meta.docSubject = info.get('Subject') ?? null;
  meta.docCreator = info.get('Creator') ?? null;
  meta.docProducer = info.get('Producer') ?? null;
  meta.docKeywords = info.get('Keywords') ?? null;
  meta.docCreationDate = info.get('CreationDate') ?? null;
  meta.docModificationDate = info.get('ModDate') ?? null;

  // Page sizes: the first page is CustomX x CustomY, the others come from the page detail of the
  // first page (no page of these reports has its own size)
  const boxes = pdfMediaBoxes(csPdf);
  if (boxes.length !== json.pages.length) throw new Error(name + ': MediaBox count differs from the page count');
  const twips = (pt: number): number => Math.round(pt * 20);
  if (twips(boxes[0]![0]) !== json.customX || twips(boxes[0]![1]) !== json.customY)
    throw new Error(name + ': the first page is not CustomX x CustomY');

  json.pages.forEach((jpage, pageIndex) => {
    const page = new MetaPage(meta);
    page.orientation = OrientationType[jpage.orientation as keyof typeof OrientationType];
    if (pageIndex === 0 && boxes.length > 1) {
      const [w, h] = boxes[1]!;
      for (const b of boxes.slice(1))
        if (b[0] !== w || b[1] !== h) throw new Error(name + ': pages after the first one differ in size');
      const landscape = meta.orientation === OrientationType.Landscape;
      page.pageDetail.custom = true;
      page.pageDetail.customWidth = landscape ? twips(h) : twips(w);
      page.pageDetail.customHeight = landscape ? twips(w) : twips(h);
    }
    for (const jo of jpage.objects) {
      let obj: MetaObject;
      if (jo.class === 'MetaObjectText') obj = new MetaObjectText();
      else if (jo.class === 'MetaObjectDraw') obj = new MetaObjectDraw();
      else throw new Error(name + ': the golden loader does not rebuild ' + jo.class);
      for (const [key, value] of Object.entries(jo)) {
        if (key === 'class' || key === 'text' || key === 'lFontName' || key === 'wFontName') continue;
        const field = fieldName(key);
        if (!(field in obj)) throw new Error(name + ': unknown field ' + key + ' of ' + jo.class);
        (obj as unknown as Record<string, unknown>)[field] = value;
      }
      // The string pool, replayed in the order of the engine: annotation, text, fonts
      const check = (got: number, want: number, what: string): void => {
        if (got !== want) throw new Error(`${name}: page ${pageIndex} ${what} at ${got}, the C# pool has it at ${want}`);
      };
      if (obj.annotationS > 0) {
        const annotation = annotations[nextAnnotation++];
        if (annotation === undefined || annotation.length !== obj.annotationS)
          throw new Error(name + ': annotation texts do not match the objects');
        check(page.addString(annotation), obj.annotationP, 'annotation');
      }
      if (obj instanceof MetaObjectText) {
        check(page.addString(jo.text as string), obj.textP, 'text');
        check(page.addString(jo.lFontName as string), obj.lFontNameP, 'Linux font');
        check(page.addString(jo.wFontName as string), obj.wFontNameP, 'Windows font');
        if (page.getText(obj) !== jo.text) throw new Error(name + ': text differs');
      }
      page.objects.push(obj);
    }
    meta.pages.add(page);
  });
  if (nextAnnotation !== annotations.length) throw new Error(name + ': unused annotation texts');
  meta.finish();
  return { name, meta, csPdf, json };
}
