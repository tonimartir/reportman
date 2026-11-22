// HTML text laid out with the TrueType provider (PdfDevice with the system fonts, the FreeType
// device of C#), as these console tests of the C# engine check it with PrintOutPDFFreeType:
//
//   tests/HtmlBlankLineTest        an empty line of an HTML text takes its height
//   tests/HtmlMultiPageExtentTest  a multipage HTML expression in an AutoExpand section is
//                                  measured at its width, so what follows stays on the page
//   tests/HtmlYMascarasTest        HTML text aligned as the plain text (its first part)
//   tests/HtmlFallbackCacheTest    the metrics of a fallback font are filled once per provider
//   tests/PdfTextoRecuperableTest  every character of the text can be read back from the PDF
//                                  (ligatures and contextual forms declared in /ToUnicode)
//
// The PDF is read as PdfPig reads it in C#: the glyphs of the content stream, their widths and
// their /ToUnicode text (../../reportman-pdf/test/pdftext.ts). Expected values are the ones of the
// C# tests. Without the fonts (Arial; the families of each case) the tests are skipped.

import { describe, expect, it } from 'vitest';
import { PDFFontType, TextAlignType, type Report } from '@reportman/lib';
import { newTextObjectStruct, type MetaFile, MetaObjectText } from '@reportman/metafile';
import { PdfDevice } from '@reportman/pdf';
import type { FontLibrary } from '@reportman/text';
import { prepareReport } from '@reportman/engine';
import { addExpression, addLabel, addSubReport, detailOf, newReport } from './build-report.js';
import { systemFonts } from './golden-run-ft.js';
import { pdfGlyphs, pdfPageTexts, pdfWords } from '../../reportman-pdf/test/pdftext.js';

function fontsOrNull(): FontLibrary | null {
  try {
    return systemFonts();
  } catch {
    return null;
  }
}

const library = fontsOrNull();
const hasFamily = (family: string): boolean => library !== null && library.keys().includes(family.toUpperCase() + '____B0I0');
const hasArial = hasFamily('Arial');
const fonts = (): FontLibrary => systemFonts();

const ARIAL = { wFontName: 'Arial', lFontName: 'Arial', fontSize: 10, type1Font: PDFFontType.Embedded, transparent: true };

async function print(report: Report): Promise<{ meta: MetaFile; pdf: Uint8Array }> {
  const device = new PdfDevice({ fonts: fonts(), compressed: false });
  const run = await prepareReport(report, { device });
  const meta = await run.execute();
  device.print(meta);
  return { meta, pdf: device.pdfBytes };
}

describe.skipIf(!hasArial)('an empty line of an HTML text (HtmlBlankLineTest)', () => {
  /** The measured height of an HTML text 10000 twips wide. */
  const height = (html: string): number => {
    const device = new PdfDevice({ fonts: fonts(), compressed: false });
    const t = newTextObjectStruct({ text: html, ...ARIAL, wordWrap: true, isHtml: true });
    return device.textExtentLineInfo(t, { x: 10000, y: 100000 }).extent.y;
  };

  /** The vertical distance, in PDF points, from "alpha" to "omega". */
  const gap = async (html: string): Promise<number> => {
    const report = newReport({ margin: 500 });
    const s = detailOf(report);
    s.height = 3000;
    addLabel(s, html, { ...ARIAL, width: 10000, height: 2500, wordWrap: true, isHtml: true });
    const { pdf } = await print(report);
    const words = pdfWords(pdfGlyphs(pdf)[0]!);
    const alpha = words.find((w) => w.text === 'alpha')!;
    const omega = words.find((w) => w.text === 'omega')!;
    return alpha.y - omega.y;
  };

  it('adds one line of height per empty line', () => {
    const two = height('alpha<br>omega');
    const three = height('alpha<br><br>omega');
    const four = height('alpha<br><br><br>omega');
    const line = Math.trunc(two / 2);
    expect(two).toBeGreaterThan(0);
    expect(Math.abs(three - (two + line))).toBeLessThanOrEqual(2);
    expect(Math.abs(four - (two + 2 * line))).toBeLessThanOrEqual(4);
    // A source newline between paragraphs is a blank line
    expect(height('<p>alpha</p>\n<p>omega</p>')).toBe(three);
  });

  it('draws the word after an empty line one line lower in the PDF', async () => {
    const without = await gap('alpha<br>omega');
    const withBlank = await gap('alpha<br><br>omega');
    expect(withBlank).toBeGreaterThan(without * 1.7);
  });
});

describe.skipIf(!hasArial)('a multipage HTML expression in an AutoExpand section (HtmlMultiPageExtentTest)', () => {
  const BOX_WIDTH = 10000;

  const paragraphs = (count: number): string => {
    let s = '';
    for (let i = 1; i <= count; i++)
      s += '<p><b>Paragraph ' + String(i) + ' </b>The provider maintains the software, answers the incidents and delivers the new versions while the contract is in force.</p>\n';
    return s;
  };

  /** The text in its own AutoExpand section, and what follows in another subreport (the signatures). */
  const contract = (html: string, multiPage: boolean): Report => {
    const report = newReport({ margin: 500 });
    const text = detailOf(report);
    text.height = 600;
    text.autoExpand = true;
    addExpression(text, "'" + html.replaceAll("'", "''") + "'", {
      ...ARIAL,
      posY: 100,
      width: BOX_WIDTH,
      height: 400,
      wordWrap: true,
      cutText: false,
      isHtml: true,
      multiPage,
    });
    const after = detailOf(report, addSubReport(report));
    after.height = 2000;
    addLabel(after, 'AFTER', { ...ARIAL, width: BOX_WIDTH, height: 300 });
    return report;
  };

  /** The page and top of the label printed after the text, and the page count. */
  const follower = async (html: string, multiPage: boolean): Promise<{ pages: number; page: number; top: number }> => {
    const { meta } = await print(contract(html, multiPage));
    const pages = meta.pages.currentCount;
    for (let p = 0; p < pages; p++) {
      const page = meta.pages.get(p);
      for (const o of page.objects) if (o instanceof MetaObjectText && page.getText(o) === 'AFTER') return { pages, page: p, top: o.top };
    }
    return { pages, page: -1, top: -1 };
  };

  it('keeps what follows a text that fits on the first page, where it is without MultiPage', async () => {
    const short = paragraphs(12);
    const on = await follower(short, true);
    const off = await follower(short, false);
    expect(off).toMatchObject({ pages: 1, page: 0 });
    expect(on).toMatchObject({ pages: 1, page: 0 });
    expect(on.top).toBe(off.top);
  });

  it('continues a text that does not fit on the next page, with nothing lost', async () => {
    const { pdf } = await print(contract(paragraphs(90), true));
    const texts = pdfPageTexts(pdf);
    const all = texts.join(' ');
    expect(texts.length).toBeGreaterThan(1);
    expect(all).toContain('Paragraph 1 ');
    expect(all).toContain('Paragraph 90 ');
    expect(texts.at(-1)).toContain('AFTER');
  });
});

describe.skipIf(!hasArial)('HTML text aligned as plain text (HtmlYMascarasTest)', () => {
  const BOX_WIDTH = 11000; // twips, from PosX 0 on a page without left margin

  const extentOf = async (text: string, html: boolean, alignment: TextAlignType, embedded: boolean, wordWrap: boolean) => {
    const report = newReport();
    const s = detailOf(report);
    s.height = 2000;
    addLabel(s, text, {
      ...ARIAL,
      width: BOX_WIDTH,
      height: 500,
      type1Font: embedded ? PDFFontType.Embedded : PDFFontType.Helvetica,
      wordWrap,
      cutText: true,
      isHtml: html,
      alignment,
    });
    const { pdf } = await print(report);
    const words = pdfWords(pdfGlyphs(pdf)[0]!);
    return { left: Math.min(...words.map((w) => w.left)), right: Math.max(...words.map((w) => w.right)), words };
  };

  const variants: [string, boolean, boolean][] = [
    ['embedded', true, false],
    ['standard', false, false],
    ['standard and word wrap', false, true],
  ];
  const alignments: [string, TextAlignType][] = [
    ['left', TextAlignType.Left],
    ['center', TextAlignType.Center],
    ['right', TextAlignType.Right],
  ];
  const boxRight = BOX_WIDTH / 20;

  for (const [variant, embedded, wordWrap] of variants)
    for (const [name, alignment] of alignments)
      it(`places HTML aligned to the ${name} where the plain text goes (${variant})`, async () => {
        const plain = await extentOf('Fecha: 03/10/2026 Pagina 1', false, alignment, embedded, wordWrap);
        const html = await extentOf('<b>Fecha:</b> 03/10/2026 <i>Pagina 1</i>', true, alignment, embedded, wordWrap);
        // The bold widens «Fecha:» a little, so a few points are allowed
        expect(Math.abs(plain.left - html.left)).toBeLessThan(6);
        expect(Math.abs(plain.right - html.right)).toBeLessThan(6);
        if (alignment === TextAlignType.Left) expect(html.left).toBeLessThan(3);
        if (alignment === TextAlignType.Right) expect(Math.abs(html.right - boxRight)).toBeLessThan(4);
      });

  // With an entity: the real report had «&nbsp;» and the label came out shifted
  it('places HTML with &nbsp; at the edges of the box', async () => {
    const text = '<b>Fecha:</b> 03/10/2026 &nbsp; <i>Pagina 1</i>';
    const left = await extentOf(text, true, TextAlignType.Left, false, false);
    expect(left.left).toBeLessThan(3);
    const right = await extentOf(text, true, TextAlignType.Right, false, false);
    expect(Math.abs(right.right - boxRight)).toBeLessThan(4);
  });
});

describe.skipIf(!hasArial)('the metrics of a fallback font (HtmlFallbackCacheTest)', () => {
  it('are filled once per provider and reused', () => {
    const device = new PdfDevice({ fonts: fonts(), compressed: false });
    // The cache of the provider (FontInfoFt.fontDataCache), as the C# test reads it by reflection
    const cache = (device.fontProvider as unknown as { fontDataCache: Map<string, unknown> }).fontDataCache;
    const measure = () =>
      device.textExtentLineInfo(newTextObjectStruct({ text: 'alpha 中文字体 omega', ...ARIAL, wordWrap: true, isHtml: true }), { x: 10000, y: 100000 }).lines;

    // The CJK characters get a fallback family
    let family: string | null = null;
    for (const line of measure())
      for (const g of (line.glyphs ?? []) as { charCode: number; fontFamily: string | null }[]) if (g.charCode === 0x4e2d) family = g.fontFamily;
    expect(family).not.toBeNull();
    expect(family!.toLowerCase()).not.toBe('arial');

    // Its font data is in the cache of the provider after the first measure
    const prefix = family!.replaceAll(' ', '').toUpperCase();
    const fallbackKey = [...cache.keys()].find((k) => k.toUpperCase().startsWith(prefix));
    expect(fallbackKey, 'keys: ' + [...cache.keys()].join(', ')).toBeDefined();
    const fallback = cache.get(fallbackKey!);

    // Measuring again adds nothing and reuses the same font data
    const entries = cache.size;
    for (let i = 0; i < 200; i++) measure();
    expect(cache.size).toBe(entries);
    expect(cache.get(fallbackKey!)).toBe(fallback);
  });
});

describe.skipIf(!hasArial)('the text of a PDF can be read back (PdfTextoRecuperableTest)', () => {
  // The fonts are many because which ones substitute glyphs depends on the machine: on Windows
  // neither Arial nor Times ligate, but Cambria, Calibri and Constantia do
  const latin = 'oficina eficaz, inflar el aforo: cc9fiV6qbWqwP';
  const cases: [string, string, string, boolean, boolean][] = [
    ['latin-cambria', latin, 'Cambria', false, false],
    ['latin-cambria-html', latin, 'Cambria', true, false],
    ['latin-calibri-html', latin, 'Calibri', true, false],
    ['latin-times-html', latin, 'Times New Roman', true, false],
    ['latin-constantia-html', latin, 'Constantia', true, false],
    ['latin-dejavu-html', latin, 'DejaVu Sans', true, false],
    ['accents-html', 'año de gestión: áéíóúüÇ', 'Calibri', true, false],
    ['arabic', 'الفاتورة رقم', 'Arial', false, true],
    ['arabic-segoe', 'الفاتورة رقم', 'Segoe UI', false, true],
    ['hebrew', 'חשבונית', 'Arial', false, true],
    ['greek-html', 'Ευχαριστώ', 'Arial', true, false],
  ];

  /** What of the original is not in the extracted text, without looking at the order or the spaces. */
  const missing = (original: string, text: string): string[] => {
    const left = [...text].filter((ch) => ch !== ' ');
    const result: string[] = [];
    for (const ch of [...original].filter((x) => x !== ' ')) {
      const i = left.indexOf(ch);
      if (i >= 0) left.splice(i, 1);
      else result.push(ch + ' (U+' + ch.codePointAt(0)!.toString(16).toUpperCase().padStart(4, '0') + ')');
    }
    return result;
  };

  /** A report with one label, Embedded: the only path that shapes and embeds. */
  const pdfOf = async (text: string, family: string, html: boolean, rtl: boolean): Promise<Uint8Array> => {
    const report = newReport({ margin: 574 });
    const s = detailOf(report);
    s.height = 2000;
    addLabel(s, text, {
      wFontName: family,
      lFontName: family,
      fontSize: 12,
      type1Font: PDFFontType.Embedded,
      transparent: true,
      width: 11000,
      height: 500,
      wordWrap: false,
      cutText: false,
      isHtml: html,
      rightToLeft: rtl,
      bidiModes: rtl ? ['BidiPartial'] : [],
    });
    return (await print(report)).pdf;
  };

  let ligatures = 0;
  for (const [name, text, family, html, rtl] of cases)
    it.skipIf(!hasFamily(family))(`keeps every character: ${name}`, async () => {
      const pdf = await pdfOf(text, family, html, rtl);
      // A ligature well declared is a CMap entry whose target is two characters
      if (/<[0-9A-Fa-f]{4}>\s+<[0-9A-Fa-f]{8,}>/.test(Buffer.from(pdf).toString('latin1'))) ligatures++;
      const extracted = pdfPageTexts(pdf).join(' ');
      expect(missing(text, extracted), 'extracted «' + extracted + '»').toEqual([]);
      const privateUse = [...extracted].filter((ch) => ch >= '' && ch <= '');
      expect(privateUse).toEqual([]);
    });

  // The guard of «did this measure anything?»: on a machine whose fonts do not ligate this would
  // pass without exercising the path it watches
  it.skipIf(!hasFamily('Cambria') && !hasFamily('Calibri') && !hasFamily('Constantia'))('has seen a font form a ligature declared with two characters', () => {
    expect(ligatures).toBeGreaterThan(0);
  });
});
