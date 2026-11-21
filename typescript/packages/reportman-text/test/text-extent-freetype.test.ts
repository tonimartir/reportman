// Measurement parity with the C# FreeType driver (golden-cs text-extent --driver freetype): the
// TrueType provider over the system fonts gives the extents and the lines (positions, sizes,
// widths, heights, baselines, texts) of PrintOutPDFFreeType for every case. The fonts are those of
// the machine the fixture was made on: the cases only run on the same font files.

import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { newTextObjectStruct, type PDFFontType } from 'reportman-metafile';
import { FontInfoFt, StandardTextMeasurer, TextCanvas } from 'reportman-text';
import { fontDirectories, fontFiles, fontLibrary } from 'reportman-node';

interface FixtureCase {
  case: {
    text: string;
    wFontName?: string;
    lFontName?: string;
    fontSize?: number;
    fontStyle?: number;
    type1Font?: number;
    wordWrap?: boolean;
    alignment?: number;
    width?: number;
    height?: number;
  };
  error?: string;
  extent?: [number, number];
  lineExtent?: [number, number];
  lines?: { position: number; size: number; width: number; height: number; topPos: number; lastLine: boolean; lineHeight: number; text: string }[];
}

const here = path.dirname(fileURLToPath(import.meta.url));
const fixtures: FixtureCase[] = JSON.parse(fs.readFileSync(path.join(here, 'fixtures/text-extent-freetype.json'), 'utf8'));
const fingerprintFile = path.resolve(here, '../../reportman-engine/test/fixtures/freetype/fonts.json');
const sameFonts =
  process.platform === 'win32' &&
  JSON.stringify(fontFiles(fontDirectories('windows')).map((f) => path.basename(f).toLowerCase() + ':' + String(fs.statSync(f).size)).sort()) ===
    JSON.stringify(JSON.parse(fs.readFileSync(fingerprintFile, 'utf8')));

describe.skipIf(!sameFonts)('text extent parity with PrintOutPDFFreeType (golden-cs text-extent --driver freetype)', () => {
  it(`has the C# cases (${fixtures.length})`, () => {
    expect(fixtures.length).toBeGreaterThan(500);
  });

  it('gives the same extents and lines for every case', () => {
    // One provider and canvas for every case, in order, as golden-cs uses one printer
    const canvas = new TextCanvas(new FontInfoFt(fontLibrary({ platform: 'windows' })));
    const measurer = new StandardTextMeasurer(canvas);
    const mismatches: string[] = [];
    for (const f of fixtures) {
      const c = f.case;
      const t = newTextObjectStruct({
        text: c.text,
        lFontName: c.lFontName ?? 'Helvetica',
        wFontName: c.wFontName ?? 'Arial',
        fontSize: c.fontSize ?? 10,
        fontStyle: c.fontStyle ?? 0,
        type1Font: (c.type1Font ?? 0) as PDFFontType,
        wordWrap: c.wordWrap ?? false,
        alignment: c.alignment ?? 0,
      });
      const extent = { x: c.width ?? 0, y: c.height ?? 0 };
      const li = measurer.textExtentLineInfo(t, extent);
      const e = measurer.textExtent(t, extent);
      const got = {
        extent: [e.x, e.y],
        lineExtent: [li.extent.x, li.extent.y],
        lines: li.lines.map((l) => ({
          position: l.position,
          size: l.size,
          width: l.width,
          height: l.height,
          topPos: l.topPos,
          lastLine: l.lastLine,
          lineHeight: l.lineHeight,
          text: l.text,
        })),
      };
      const want = { extent: f.extent, lineExtent: f.lineExtent, lines: f.lines };
      if (JSON.stringify(got) !== JSON.stringify(want))
        mismatches.push(JSON.stringify(c) + '\n  got  ' + JSON.stringify(got) + '\n  want ' + JSON.stringify(want));
    }
    expect(mismatches.slice(0, 3).join('\n')).toBe('');
    expect(mismatches.length).toBe(0);
  });
});
