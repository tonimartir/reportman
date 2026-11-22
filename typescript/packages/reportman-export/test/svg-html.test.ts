// The SVG and HTML outputs against the Delphi engine (rpsvgdriver, rphtmldriver), the fixtures of
// generate-delphi-fixtures.mjs (tools/golden-delphi): for each report of delphi-cases.json, the
// documents and images Delphi wrote from its first pages, and that metafile (meta.json).
//
// 1. The drivers: the metafile of Delphi, rebuilt from meta.json, gives the same bytes as Delphi,
//    page by page and file by file (but the images Delphi saves from uninitialized memory).
// 2. The engines: the TypeScript engine runs the same report (samples.db, the clock of the Delphi
//    run) and its outputs are compared with Delphi's: the same bytes where the metafiles are the
//    same, and where they are not, what can be compared, with what differs and why.
//
// golden-delphi runs in en-US (the messages and formats of the engine) and is built as the
// packages are, without REPMANRELEASE: FireDAC for SQLite, no TeeChart.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  MetaFile,
  MetaObjectDraw,
  MetaObjectExport,
  MetaObjectImage,
  MetaObjectPolygon,
  MetaObjectText,
  MetaObjectType,
  MetaPage,
  type MetaObject,
} from '@reportman/metafile';
import { RpDateTime } from '@reportman/engine';
import { DelphiImageError, metafileToHtml, metafileToHtmlSingle, metafileToSvg, windows1252Bytes, type ExportedPages } from '@reportman/export';
import { runLikeGolden } from '../../reportman-engine/test/golden-run.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const fixtures = path.join(here, 'fixtures/delphi');

interface DelphiCase {
  name: string;
  report: string;
  pages?: number;
  caption?: string;
  /**
   * false: only the drivers are compared. letter.rep (HTML text) and international.rep (right to
   * left, complex scripts) run in the TypeScript engine only with TrueType fonts, measured by its
   * port of the C# FreeType device, not as the Delphi PDF driver measures them on Windows.
   */
  engine?: boolean;
}
const cases = JSON.parse(fs.readFileSync(path.join(here, 'delphi-cases.json'), 'utf8')) as DelphiCase[];

// ---------------------------------------------------------------------------------------------
// The metafile of Delphi (golden-delphi's meta.json)

interface DelphiObject {
  type: 'text' | 'draw' | 'image' | 'polygon' | 'export';
  top: number;
  left: number;
  width: number;
  height: number;
  annotation?: string;
  rawAlignment?: number;
  [field: string]: unknown;
}
interface DelphiMetafile {
  customX: number;
  customY: number;
  backColor: number;
  totalPages: number;
  runTime: string;
  runTimeOffsetMinutes: number;
  pages: { objects: DelphiObject[] }[];
}

function readDelphiMetafile(name: string): DelphiMetafile {
  return JSON.parse(fs.readFileSync(path.join(fixtures, name, 'meta.json'), 'utf8')) as DelphiMetafile;
}

/** A MetaFile of the TypeScript model with the pages, objects, strings and images of Delphi's. */
function toMetaFile(json: DelphiMetafile): MetaFile {
  const meta = new MetaFile();
  meta.customX = json.customX;
  meta.customY = json.customY;
  meta.backColor = json.backColor;
  for (const p of json.pages) {
    const page = new MetaPage(meta);
    for (const o of p.objects) {
      let obj: MetaObject;
      const n = (field: string): number => o[field] as number;
      const b = (field: string): boolean => o[field] as boolean;
      switch (o.type) {
        case 'text': {
          const t = new MetaObjectText();
          t.metaType = MetaObjectType.Text;
          const text = o.text as string;
          const wFont = o.wFontName as string;
          const lFont = o.lFontName as string;
          t.textP = page.addString(text);
          t.textS = text.length;
          t.wFontNameP = page.addString(wFont);
          t.wFontNameS = wFont.length;
          t.lFontNameP = page.addString(lFont);
          t.lFontNameS = lFont.length;
          t.fontSize = n('fontSize');
          t.fontRotation = n('fontRotation');
          t.fontStyle = n('fontStyle');
          t.type1Font = n('type1Font');
          t.fontColor = n('fontColor');
          t.backColor = n('backColor');
          t.transparent = b('transparent');
          t.cutText = b('cutText');
          t.alignment = n('alignment');
          t.wordWrap = b('wordWrap');
          t.rightToLeft = b('rightToLeft');
          t.printStep = n('printStep');
          t.isHtml = b('isHtml');
          obj = t;
          break;
        }
        case 'draw': {
          const d = new MetaObjectDraw();
          d.metaType = MetaObjectType.Draw;
          d.drawStyle = n('drawStyle');
          d.brushStyle = n('brushStyle');
          d.brushColor = n('brushColor');
          d.penStyle = n('penStyle');
          d.penWidth = n('penWidth');
          d.penColor = n('penColor');
          obj = d;
          break;
        }
        case 'image': {
          const i = new MetaObjectImage();
          i.metaType = MetaObjectType.Image;
          const data = new Uint8Array(Buffer.from(o.data as string, 'base64'));
          i.copyMode = n('copyMode');
          i.drawImageStyle = n('drawImageStyle');
          i.dpiRes = n('dpiRes');
          i.previewOnly = b('previewOnly');
          // Every image in the stream of its page: shared or not, the driver reads the same bytes
          i.streamPos = page.addStream(data, false);
          i.streamSize = data.length;
          obj = i;
          break;
        }
        case 'polygon':
          obj = new MetaObjectPolygon();
          obj.metaType = MetaObjectType.Polygon;
          break;
        case 'export':
          obj = new MetaObjectExport();
          obj.metaType = MetaObjectType.Export;
          break;
      }
      obj.top = o.top;
      obj.left = o.left;
      obj.width = o.width;
      obj.height = o.height;
      if (o.annotation !== undefined) {
        obj.annotationP = page.addString(o.annotation);
        obj.annotationS = o.annotation.length;
      }
      page.objects.push(obj);
    }
    meta.pages.add(page);
  }
  return meta;
}

// ---------------------------------------------------------------------------------------------
// The files of Delphi

const latin1 = (bytes: Uint8Array): string => Buffer.from(bytes).toString('latin1');

/** The files of an output folder of a case: name → bytes. */
function delphiFiles(name: string, folder: string): Map<string, Uint8Array> {
  const dir = path.join(fixtures, name, folder);
  const result = new Map<string, Uint8Array>();
  for (const f of fs.readdirSync(dir).sort()) result.set(f, new Uint8Array(fs.readFileSync(path.join(dir, f))));
  return result;
}

/** The documents and files of an export, by file name, as Delphi writes them. */
function exportedFiles(output: ExportedPages): Map<string, Uint8Array> {
  const result = new Map<string, Uint8Array>();
  for (const page of output.pages) result.set(page.fileName, windows1252Bytes(page.text));
  for (const [file, data] of output.files) result.set(file, data);
  return result;
}

const isIndexedBmp = (data: Uint8Array): boolean =>
  data[0] === 0x42 && data[1] === 0x4d && data.length >= 30 && (data[28] as number) + (data[29] as number) * 256 <= 8;

/**
 * A file that can not be compared: for an indexed BMP the SVG driver of Delphi saves the memory
 * GetDIBBits left uninitialized (it changes from one run to the next); the port saves the image.
 */
const unreproducible = (folder: string, file: string, ours: Uint8Array): boolean =>
  folder === 'svg' && file.endsWith('.bmp') && isIndexedBmp(ours);

// ---------------------------------------------------------------------------------------------
// 1. The drivers, on Delphi's metafile

describe('the drivers on the metafile of Delphi, byte for byte', () => {
  for (const c of cases) {
    describe(c.name, () => {
      const json = readDelphiMetafile(c.name);
      const caption = c.caption ?? '';

      it('keeps the single line flag of shapes and images at 0 (read past their fields by Delphi)', () => {
        for (const p of json.pages) for (const o of p.objects) if (o.type !== 'text') expect(o.rawAlignment).toBe(0);
      });

      it('metafileToSvg', () => {
        const out = metafileToSvg(toMetaFile(json), { caption, fileName: c.name + '.svg' });
        const actual = exportedFiles(out);
        const expected = delphiFiles(c.name, 'svg');
        expect([...actual.keys()].sort()).toEqual([...expected.keys()].sort());
        for (const [file, bytes] of expected) {
          if (unreproducible('svg', file, actual.get(file)!)) continue;
          expect(latin1(actual.get(file)!), file).toBe(latin1(bytes));
        }
      });

      it('metafileToHtml', () => {
        const out = metafileToHtml(toMetaFile(json), { caption, fileName: c.name + '.html' });
        const actual = exportedFiles(out);
        const expected = delphiFiles(c.name, 'html');
        expect([...actual.keys()].sort()).toEqual([...expected.keys()].sort());
        for (const [file, bytes] of expected) expect(latin1(actual.get(file)!), file).toBe(latin1(bytes));
      });

      it('metafileToHtmlSingle', () => {
        const html = metafileToHtmlSingle(toMetaFile(json), { caption });
        const expected = delphiFiles(c.name, 'single');
        expect([...expected.keys()]).toEqual([c.name + '.html']);
        expect(latin1(windows1252Bytes(html))).toBe(latin1(expected.get(c.name + '.html')!));
      });
    });
  }
});

// ---------------------------------------------------------------------------------------------
// 2. The engines: the TypeScript run of the report against the Delphi files

/** The outputs of the TypeScript engine for a case, from the pages Delphi kept. */
interface EngineOutputs {
  meta: MetaFile;
  totalPages: number;
  svg: Map<string, Uint8Array>;
  html: Map<string, Uint8Array>;
  single: Uint8Array;
}

async function engineOutputs(c: DelphiCase): Promise<EngineOutputs> {
  const json = readDelphiMetafile(c.name);
  // TODAY and NOW of the Delphi run
  const t = /^(\d+)-(\d+)-(\d+)T(\d+):(\d+):(\d+)$/.exec(json.runTime)!.slice(1).map(Number) as [number, number, number, number, number, number];
  const r = await runLikeGolden(path.resolve(here, c.report), { now: RpDateTime.create(...t) });
  const meta = r.meta;
  const totalPages = meta.pages.currentCount;
  // The pages Delphi kept (golden-delphi ran the report to its end too)
  const kept = [...meta.pages].slice(0, json.pages.length);
  meta.pages.clearCollection();
  for (const p of kept) meta.pages.add(p);
  const caption = c.caption ?? '';
  return {
    meta,
    totalPages,
    svg: exportedFiles(metafileToSvg(meta, { caption, fileName: c.name + '.svg' })),
    html: exportedFiles(metafileToHtml(meta, { caption, fileName: c.name + '.html' })),
    single: windows1252Bytes(metafileToHtmlSingle(meta, { caption })),
  };
}

/** Every document and file of a case (the same names), the Delphi one and the TypeScript one. */
function* documentPairs(c: DelphiCase, out: EngineOutputs): Generator<[string, string, string]> {
  for (const folder of ['svg', 'html'] as const) {
    const expected = delphiFiles(c.name, folder);
    expect([...out[folder].keys()].sort()).toEqual([...expected.keys()].sort());
    for (const [file, bytes] of expected) {
      const ours = out[folder].get(file)!;
      if (!unreproducible(folder, file, ours)) yield [folder + '/' + file, latin1(bytes), latin1(ours)];
    }
  }
  yield ['single/' + c.name + '.html', latin1(delphiFiles(c.name, 'single').get(c.name + '.html')!), latin1(out.single)];
}

// The parts of the documents, to compare them where the metafiles differ

interface SvgElement {
  /** The element with its positions as #. */
  shape: string;
  positions: number[];
  /** The text of a <text>, the reference of an <image>. */
  content: string;
}

/** The elements of the body of an SVG page (each <text> and <image>, or an error message), and the rest. */
function svgParts(svg: string): { head: string; elements: SvgElement[] } {
  const start = svg.indexOf('</rect>\r\n') + '</rect>\r\n'.length;
  const elements: SvgElement[] = [];
  const re = /<text ([^>]*)>([\s\S]*?)<\/text>\r\n|<image ([^>]*)><\/image>\r\n|([^<]+)/g;
  const body = svg.substring(start, svg.length - '</svg>'.length);
  for (const m of body.matchAll(re)) {
    const attributes = m[1] ?? m[3];
    if (attributes === undefined) {
      elements.push({ shape: 'message', positions: [], content: m[4]! });
      continue;
    }
    const positions: number[] = [];
    // x, y, width, height (the font size is not a position)
    const shape = attributes.replace(/(x|y|width|height)="(-?\d+)px"/g, (_all, name: string, value: string) => {
      positions.push(Number(value));
      return name + '="#"';
    });
    elements.push({ shape: (m[1] !== undefined ? 'text ' : 'image ') + shape, positions, content: m[2] ?? '' });
  }
  return { head: svg.substring(0, start), elements };
}

interface HtmlDiv {
  /** The style of the DIV with its positions and sizes as #. */
  shape: string;
  positions: number[];
  /** The rule of its class. */
  rule: string;
  content: string;
}

/** The DIVs of an HTML document, with the rules of their classes, and the rest of its lines. */
function htmlParts(html: string): { head: string[]; divs: HtmlDiv[] } {
  const rules = new Map<string, string>();
  const head: string[] = [];
  const divs: HtmlDiv[] = [];
  for (const line of html.split('\r\n')) {
    const rule = /^\.(fc\d+) (\{.*\})$/.exec(line);
    if (rule !== null) {
      // As the browser: a repeated class name, the later rule wins
      rules.set(rule[1]!, rule[2]!);
      continue;
    }
    const div = /^<DIV style=(.*)><span class="(fc\d+)">(.*)<\/span><\/DIV>$/.exec(line);
    if (div === null) {
      head.push(line);
      continue;
    }
    const positions: number[] = [];
    const shape = div[1]!.replace(/(left|top|width|height):(-?\d+)PX/g, (_all, name: string, value: string) => {
      positions.push(Number(value));
      return name + ':#PX';
    });
    divs.push({ shape, positions, rule: div[2]!, content: div[3]! });
  }
  for (const d of divs) d.rule = rules.get(d.rule) ?? d.rule;
  return { head, divs };
}

/** The largest difference between two lists of positions (Infinity when they do not pair). */
function maxDelta(a: number[], b: number[]): number {
  if (a.length !== b.length) return Infinity;
  let max = 0;
  for (let i = 0; i < a.length; i++) max = Math.max(max, Math.abs((a[i] as number) - (b[i] as number)));
  return max;
}

/** The parts of a document pair, the SVG elements or the HTML DIVs, paired one to one. */
function pairedParts(file: string, delphi: string, ts: string): { delphiHead: string | string[]; tsHead: string | string[]; pairs: [SvgElement | HtmlDiv, SvgElement | HtmlDiv | undefined][] } {
  if (file.endsWith('.svg')) {
    const d = svgParts(delphi);
    const t = svgParts(ts);
    return { delphiHead: d.head, tsHead: t.head, pairs: d.elements.map((e, i) => [e, t.elements[i]]) };
  }
  const d = htmlParts(delphi);
  const t = htmlParts(ts);
  return { delphiHead: d.head, tsHead: t.head, pairs: d.divs.map((e, i) => [e, t.divs[i]]) };
}

// The reports whose TypeScript metafile is Delphi's: the same bytes. The other ones are compared
// below, each with what differs in its metafile and why.
const IDENTICAL = new Set(['customers', 'invoices', 'labels', 'sales-by-category', 'contacts', 'year-over-year', 'features', 'img-styles']);

describe('the TypeScript engine against the Delphi engine', () => {
  for (const c of cases) {
    if (c.engine === false) continue;
    it(c.name, async () => {
      const out = await engineOutputs(c);
      const json = readDelphiMetafile(c.name);
      expect(out.totalPages).toBe(json.totalPages);
      if (IDENTICAL.has(c.name)) {
        for (const [file, delphi, ts] of documentPairs(c, out)) expect(ts, file).toBe(delphi);
        return;
      }
      switch (c.name) {
        case 'product-catalog': {
          // The bars of the barcodes: Delphi draws each one as a rectangle with a solid pen of
          // width 0, the TypeScript engine (as the C# one) with a clear pen (penStyle 5), so in
          // the HTML only Delphi's bars have a 1 px border; the SVG does not draw shapes
          const BAR_BORDER = 'BORDER-STYLE:SOLID;BORDER-COLOR:#000000;BORDER-WIDTH:1PX;';
          let bars = 0;
          for (const [file, delphi, ts] of documentPairs(c, out)) {
            if (file.startsWith('svg/')) {
              expect(ts, file).toBe(delphi);
              continue;
            }
            const d = delphi.split('\r\n');
            const t = ts.split('\r\n');
            expect(t.length, file).toBe(d.length);
            for (let i = 0; i < d.length; i++) {
              if (d[i] === t[i]) continue;
              expect(t[i], file).toBe(d[i]!.replace(BAR_BORDER, ''));
              bars++;
            }
          }
          // The 300 bars of the ten EAN-13 of the page (30 each), in the HTML page and in the single HTML
          expect(bars).toBe(600);
          break;
        }
        case 'fishes': {
          // 1. The TypeScript engine (as the C# one) lays out two sections of each fish taller, by
          //    24 and 35 twips (the vertical lines that fill them are as much longer), so what
          //    follows moves down: 118 twips, 8 px, after the second fish of the page.
          // 2. The notes (FISH.NOTES) end with a line break in samples.db: the TypeScript text
          //    keeps it (<br/> at the end in the HTML, LF in the SVG), Delphi's does not.
          // The images are the same bytes; the rest of the documents is equal.
          const TOLERANCE_PX = 8;
          let moved = 0;
          for (const [file, delphi, ts] of documentPairs(c, out)) {
            if (!file.endsWith('.svg') && !file.endsWith('.html')) {
              expect(ts, file).toBe(delphi);
              continue;
            }
            const p = pairedParts(file, delphi, ts);
            expect(p.tsHead, file).toEqual(p.delphiHead);
            for (const [d, t] of p.pairs) {
              expect(t, file).toBeDefined();
              expect(t!.shape, file).toBe(d.shape);
              const delta = maxDelta(d.positions, t!.positions);
              expect(delta, file + ' ' + d.content.substring(0, 40)).toBeLessThanOrEqual(TOLERANCE_PX);
              if (delta > 0) moved++;
              if ('rule' in d) expect((t as HtmlDiv).rule, file).toBe(d.rule);
              const content = t!.content === d.content ? t!.content : t!.content.replace(/(<br\/>|\n)$/, '');
              expect(content, file).toBe(d.content);
            }
            expect(p.pairs.length, file).toBe(file.endsWith('.svg') ? svgParts(ts).elements.length : htmlParts(ts).divs.length);
          }
          expect(moved).toBeGreaterThan(0);
          break;
        }
        case 'monthly-sales': {
          // The chart: the Delphi engine built without TeeChart (golden-delphi, as the packages)
          // draws it with the PDF driver's own code (grid lines, value labels with two decimals,
          // the series as lines), the TypeScript engine (as the C# one) as columns with its own
          // axis labels: 44 objects against 37. The chart is the last item of the page: the first
          // 95 objects are the same, in the same order.
          const CHART_FIRST_OBJECT = 95;
          const page = out.meta.pages.get(0);
          // The SVG writes texts and images only
          const svgElements = page.objects
            .slice(0, CHART_FIRST_OBJECT)
            .filter((o) => o.metaType === MetaObjectType.Text || o.metaType === MetaObjectType.Image).length;
          expect(json.pages[0]!.objects.length).toBeGreaterThan(CHART_FIRST_OBJECT);
          for (const [file, delphi, ts] of documentPairs(c, out)) {
            const p = pairedParts(file, delphi, ts);
            const before = file.endsWith('.svg') ? svgElements : CHART_FIRST_OBJECT;
            expect(p.tsHead, file).toEqual(p.delphiHead);
            for (const [d, t] of p.pairs.slice(0, before)) expect(t, file).toEqual(d);
          }
          break;
        }
        default:
          throw new Error('No comparison for ' + c.name);
      }
    }, 60000);
  }
});

// ---------------------------------------------------------------------------------------------
// 3. What the fixtures do not show: the options, the file names, empty pages, broken images

describe('metafileToSvg and metafileToHtml options', () => {
  const customers = (): MetaFile => toMetaFile(readDelphiMetafile('customers'));
  const fishes = (): MetaFile => toMetaFile(readDelphiMetafile('fishes'));

  it('exports a range of pages, named by their index in the metafile', () => {
    const svg = metafileToSvg(customers(), { fromPage: 2, toPage: 5 });
    expect(svg.pages.map((p) => [p.index, p.fileName])).toEqual([[1, 'report1.svg']]);
    const html = metafileToHtml(customers(), { toPage: 1, fileName: 'out\list.htm' });
    expect(html.pages.map((p) => [p.index, p.fileName])).toEqual([[0, 'out\list0.htm']]);
    // The same document as the whole export gives for that page
    expect(svg.pages[0]!.text).toBe(metafileToSvg(customers()).pages[1]!.text);
  });

  it('names the images after the file name, its folder included in the references', () => {
    const html = metafileToHtml(fishes(), { fileName: 'out/fish.html' });
    expect([...html.files.keys()]).toEqual(['out/fishpage0obj13.jpg', 'out/fishpage0obj26.jpg']);
    expect(html.pages[0]!.text).toContain('<IMG SRC="out/fishpage0obj13.jpg" HEIGHT=140PX  WIDTH=234PX BORDER=0>');
    const svg = metafileToSvg(fishes(), { fileName: 'fish' });
    expect(svg.pages[0]!.fileName).toBe('fish0');
    expect(svg.pages[0]!.text).toContain('xlink:href="fishpage0obj13.jpg"');
  });

  it('gives every page the same name when the name has another dot (ChangeFileExt)', () => {
    const svg = metafileToSvg(customers(), { fileName: 'my.report.svg' });
    expect(svg.pages.map((p) => p.fileName)).toEqual(['my.svg', 'my.svg']);
    const html = metafileToHtml(fishes(), { fileName: 'my.fish.html' });
    // Both images go to my.jpg too: the second one replaces the first, as on the disk
    expect([...html.files.keys()]).toEqual(['my.jpg']);
  });

  it('writes an empty page with its background only, or without style and body in HTML', () => {
    const meta = new MetaFile();
    meta.customX = 11906;
    meta.customY = 16838;
    meta.backColor = 0x00ff80;
    meta.pages.add(new MetaPage(meta));
    expect(metafileToHtml(meta, { caption: 'Empty & <blank>' }).pages[0]!.text).toBe(
      '<HTML>\r\n<TITLE>Empty &amp; &lt;blank&gt;</TITLE>\r\n</HTML>',
    );
    const svg = metafileToSvg(meta).pages[0]!.text;
    expect(svg.endsWith('<rect x="0" y="0" width="774px"  height="1094px"  fill="#80FF00"></rect>\r\n</svg>')).toBe(true);
    expect(metafileToHtmlSingle(meta)).toContain('.pg{position:absolute;top:0px;left:0px;height:1094px;width:774px;}');
  });

  it('writes the error of an image it can not read in the SVG; in HTML the export stops', () => {
    const meta = new MetaFile();
    const page = new MetaPage(meta);
    meta.pages.add(page);
    // A JPEG that ends before its frame
    page.drawImage(0, 0, 1000, 1000, 0, 96, new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0x00]));
    expect(metafileToSvg(meta).pages[0]!.text).toContain('</rect>\r\nInvalid JPEG/PNG stream</svg>');
    expect(() => metafileToHtml(meta)).toThrow(DelphiImageError);
    expect(() => metafileToHtml(meta)).toThrow('Invalid JPEG/PNG stream');
  });

  it('gives the bytes of Delphi\'s AnsiString: Windows-1252 with its best fit', () => {
    expect([...windows1252Bytes('A€Āő–\u{1F600}日')]).toEqual([0x41, 0x80, 0x41, 0x6f, 0x96, 0x3f, 0x3f, 0x3f]);
  });
});
