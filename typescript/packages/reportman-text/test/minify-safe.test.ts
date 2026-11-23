// The shaper must not depend on the names of fontkit's classes: a bundler that minifies (Vite,
// webpack) renames them, and the shaper took every OpenType font for an AAT one, so Arabic and
// Hebrew came out unshaped and in the wrong order (and Latin text lost its kerning) on a web page
// built for production. Found by the live demo of reportman.es on 23-11-2026.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as fontkitModule from 'fontkit';
import { describe, expect, it } from 'vitest';
import { shapeText } from '../src/fonts/shaper.js';

const here = path.dirname(fileURLToPath(import.meta.url));
// An open font of the demo (SIL OFL), in the repository
const file = path.join(here, '..', '..', '..', 'demo', 'public', 'fonts', 'NotoSansArabic-Regular.woff2');

type FontkitFont = Parameters<typeof shapeText>[0] & { unitsPerEm: number; _layoutEngine: { engine?: object } };
const fontkit = ((fontkitModule as { default?: unknown }).default ?? fontkitModule) as { create(buffer: Uint8Array): unknown };

describe.skipIf(!fs.existsSync(file))('the shaper in a minified bundle', () => {
  it('shapes the same when the class of the OpenType engine has another name', () => {
    const font = fontkit.create(new Uint8Array(fs.readFileSync(file))) as FontkitFont;
    const text = 'شكرًا لك على طلبك';
    const shape = () => shapeText(font, text, true, ['arab'], 'ARA ', font.unitsPerEm).map((g) => [g.glyph, g.xAdvance, g.xOffset, g.yOffset, g.cluster]);
    const expected = shape();
    const engineClass = (font._layoutEngine.engine as object).constructor;
    const name = Object.getOwnPropertyDescriptor(engineClass, 'name')!;
    // What a minifier does to it
    Object.defineProperty(engineClass, 'name', { value: 'e', configurable: true });
    try {
      expect(shape()).toEqual(expected);
    } finally {
      Object.defineProperty(engineClass, 'name', name);
    }
  });
});
