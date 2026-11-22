// The TypeScript shaper (fontkit with the scaled positions of HarfBuzz) against HarfBuzz itself, as
// the C# engine shapes (fixtures/shaping.json, from test/generate-shaping-fixtures.mjs): the same
// glyphs, advances, offsets and clusters, at the scale of the font and at 1024 (the one the C#
// FreeType driver usually shapes with). Only with the same font files of Windows.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as fontkitModule from 'fontkit';
import { describe, expect, it } from 'vitest';
import { shapeText } from '../src/fonts/shaper.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const fixture = JSON.parse(fs.readFileSync(path.join(here, 'fixtures', 'shaping.json'), 'utf8')) as {
  sizes: Record<string, number>;
  cases: { file: string; face: number; rtl: boolean; script: string; text: string; scale: number | 'font'; glyphs: number[][] }[];
};
const fonts = path.join(process.env.SystemRoot ?? 'C:\\Windows', 'Fonts');
const sameFonts =
  process.platform === 'win32' && Object.entries(fixture.sizes).every(([f, size]) => fs.existsSync(path.join(fonts, f)) && fs.statSync(path.join(fonts, f)).size === size);
const OPENTYPE: Record<string, string[]> = {
  Arab: ['arab'],
  Hebr: ['hebr'],
  Deva: ['dev2', 'deva'],
  Thai: ['thai'],
  Latn: ['latn'],
  Mani: ['mani'],
};

type FontkitFont = Parameters<typeof shapeText>[0] & { unitsPerEm: number };
const fontkit = ((fontkitModule as { default?: unknown }).default ?? fontkitModule) as { openSync(file: string, postscriptName?: string): unknown };
const opened = new Map<string, FontkitFont>();
function fontOf(file: string, face: number): FontkitFont {
  const key = file + '#' + face;
  let font = opened.get(key);
  if (font === undefined) {
    const f = fontkit.openSync(path.join(fonts, file)) as FontkitFont & { fonts?: FontkitFont[] };
    font = f.fonts !== undefined ? (f.fonts[face] as FontkitFont) : f;
    opened.set(key, font);
  }
  return font;
}

describe.skipIf(!sameFonts)('the shaper against HarfBuzz (golden-cs shape)', () => {
  for (const scale of ['font', 1024] as const) {
    it(`gives the glyphs and positions of HarfBuzz at ${scale === 'font' ? 'the scale of the font' : 'the scale 1024'}`, () => {
      const wrong: string[] = [];
      for (const c of fixture.cases.filter((x) => x.scale === scale)) {
        const font = fontOf(c.file, c.face);
        const s = scale === 'font' ? font.unitsPerEm : scale;
        const language = c.script === 'Arab' ? 'ARA ' : null;
        const mine = shapeText(font, c.text, c.rtl, OPENTYPE[c.script] ?? [], language, s).map((g) => [g.glyph, g.xAdvance, g.xOffset, g.yOffset, g.cluster]);
        for (let i = 0; i < Math.max(mine.length, c.glyphs.length); i++) {
          const a = (c.glyphs[i] ?? []).join(' ');
          const b = (mine[i] ?? []).join(' ');
          if (a !== b) {
            wrong.push(`${c.file} ${c.script} "${c.text}" glyph ${i}: HarfBuzz ${a} | TS ${b}`);
            break;
          }
        }
      }
      expect(wrong).toEqual([]);
    });
  }
});
