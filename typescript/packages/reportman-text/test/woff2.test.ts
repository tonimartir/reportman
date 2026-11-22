// WOFF2: the sfnt woff2ToSfnt rebuilds (the transformed glyf and loca decoded, the tables of an sfnt)
// read by fontkit as an sfnt, against fontkit reading the WOFF2 file itself: the same glyphs,
// advances, outlines, boxes and cmap. A WOFF2 font of the repository always (fixtures/: the icons of
// the generated documentation site, doc/_site/styles, Glyphicons Halflings of Bootstrap);
// RM_WOFF2_FILES, a file with one WOFF2 path per line, adds others (on 22-11-2026 the 163 WOFF2
// files of the development machine were all the same).

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as fontkitModule from 'fontkit';
import { describe, expect, it } from 'vitest';
import { isWoff2, woff2ToSfnt } from '../src/fonts/woff2.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const repoFont = path.join(here, 'fixtures', 'glyphicons-halflings-regular.woff2');
const extra = process.env.RM_WOFF2_FILES;
const files = [repoFont, ...(extra !== undefined && fs.existsSync(extra) ? fs.readFileSync(extra, 'utf8').split(/\r?\n/).filter((l) => l.trim() !== '') : [])];

type Glyph = { advanceWidth: number; path: { toSVG(): string }; bbox: { minX: number; minY: number; maxX: number; maxY: number }; id: number };
type Font = {
  numGlyphs: number;
  unitsPerEm: number;
  characterSet: number[];
  getGlyph(id: number): Glyph;
  glyphForCodePoint(cp: number): Glyph;
  directory: { tables: Record<string, { transformed?: boolean }> };
};
const fontkit = ((fontkitModule as { default?: unknown }).default ?? fontkitModule) as { create(buffer: Buffer): unknown };

/** What differs between the WOFF2 file and its sfnt, as fontkit reads them. */
function differences(file: string): string[] {
  const bytes = fs.readFileSync(file);
  const woff2 = fontkit.create(bytes) as Font;
  const sfnt = fontkit.create(Buffer.from(woff2ToSfnt(new Uint8Array(bytes)))) as Font;
  const out: string[] = [];
  if (woff2.numGlyphs !== sfnt.numGlyphs) out.push(`glyphs ${woff2.numGlyphs} and ${sfnt.numGlyphs}`);
  if (woff2.unitsPerEm !== sfnt.unitsPerEm) out.push('units per em');
  for (let g = 0; g < woff2.numGlyphs && out.length < 5; g++) {
    const a = woff2.getGlyph(g);
    const b = sfnt.getGlyph(g);
    if (a.advanceWidth !== b.advanceWidth) out.push(`glyph ${g}: advance ${a.advanceWidth} and ${b.advanceWidth}`);
    if (a.path.toSVG() !== b.path.toSVG()) out.push(`glyph ${g}: outline`);
    const ba = a.bbox;
    const bb = b.bbox;
    if (ba.minX !== bb.minX || ba.minY !== bb.minY || ba.maxX !== bb.maxX || ba.maxY !== bb.maxY) out.push(`glyph ${g}: box`);
  }
  for (const cp of woff2.characterSet) if (woff2.glyphForCodePoint(cp).id !== sfnt.glyphForCodePoint(cp).id) out.push(`cmap U+${cp.toString(16)}`);
  return out.map((d) => path.basename(file) + ': ' + d);
}

describe('WOFF2 fonts', () => {
  it('rebuilds the sfnt of the font of the repository, glyf and loca transformed', () => {
    const bytes = new Uint8Array(fs.readFileSync(repoFont));
    expect(isWoff2(bytes)).toBe(true);
    const font = fontkit.create(Buffer.from(bytes)) as Font;
    expect(font.directory.tables.glyf?.transformed).toBe(true);
    expect(font.directory.tables.loca?.transformed).toBe(true);
    const sfnt = woff2ToSfnt(bytes);
    expect(isWoff2(sfnt)).toBe(false);
    expect(differences(repoFont)).toEqual([]);
  });

  it(`gives the glyphs fontkit reads from the WOFF2 file (${files.length} files)`, () => {
    const wrong = files.flatMap(differences);
    expect(wrong).toEqual([]);
  });

  it('refuses what is not a WOFF2 file, and collections', () => {
    expect(() => woff2ToSfnt(new Uint8Array(64))).toThrow(/Not a WOFF2 font/);
    const ttc = new Uint8Array(fs.readFileSync(repoFont));
    ttc.set([0x74, 0x74, 0x63, 0x66], 4);
    expect(() => woff2ToSfnt(ttc)).toThrow(/collections/);
  });
});
