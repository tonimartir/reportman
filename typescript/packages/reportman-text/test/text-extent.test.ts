import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { newTextObjectStruct, PDFFontType } from 'reportman-metafile';
import { StandardTextMeasurer } from 'reportman-text';

interface FixtureCase {
  case: {
    text: string;
    fontSize?: number;
    fontStyle?: number;
    fontRotation?: number;
    type1Font?: number;
    wordWrap?: boolean;
    cutText?: boolean;
    alignment?: number;
    width?: number;
    height?: number;
  };
  error?: string;
  extent?: [number, number];
  lineExtent?: [number, number];
  lines?: [number, number, number, number, number, number][];
}

const fixtures: FixtureCase[] = JSON.parse(
  fs.readFileSync(fileURLToPath(new URL('./fixtures/text-extent.json', import.meta.url)), 'utf8'),
);

describe('text extent parity with PrintOutPDFStandard (golden-cs text-extent)', () => {
  it(`has the C# cases (${fixtures.length})`, () => {
    expect(fixtures.length).toBeGreaterThan(1000);
  });

  it('gives the same extents and line lists for every case', () => {
    // One measurer for every case, in order, as golden-cs uses one printer
    const measurer = new StandardTextMeasurer();
    const mismatches: string[] = [];
    for (const f of fixtures) {
      const c = f.case;
      const t = newTextObjectStruct({
        text: c.text,
        lFontName: 'Helvetica',
        wFontName: 'Arial',
        fontSize: c.fontSize ?? 10,
        fontStyle: c.fontStyle ?? 0,
        fontRotation: c.fontRotation ?? 0,
        type1Font: (c.type1Font ?? 0) as PDFFontType,
        wordWrap: c.wordWrap ?? false,
        cutText: c.cutText ?? false,
        alignment: c.alignment ?? 0,
      });
      const extent = { x: c.width ?? 0, y: c.height ?? 0 };
      const li = measurer.textExtentLineInfo(t, extent);
      const e = measurer.textExtent(t, extent);
      const lines = li.lines.map((l) => [l.position, l.size, l.width, l.height, l.topPos, l.lastLine ? 1 : 0]);
      const got = { extent: [e.x, e.y], lineExtent: [li.extent.x, li.extent.y], lines };
      const want = { extent: f.extent, lineExtent: f.lineExtent, lines: f.lines };
      if (JSON.stringify(got) !== JSON.stringify(want))
        mismatches.push(JSON.stringify(c) + '\n  got  ' + JSON.stringify(got) + '\n  want ' + JSON.stringify(want));
      for (const l of li.lines) {
        expect(l.step).toBe(5); // cpi10
        expect(l.glyphs).toBeNull();
        expect(l.text).toBeNull();
        expect(l.lineHeight).toBe(0);
      }
    }
    expect(mismatches.slice(0, 5).join('\n')).toBe('');
    expect(mismatches.length).toBe(0);
  });
});
