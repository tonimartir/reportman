// fontkit, as this package uses it: the formats and shapers registered once, and the shapes of the
// objects read (fontkit has no types). Only fontkit/core and explicit format and shaper modules are
// imported, so nothing of Node is pulled into the core.

import { create, registerFormat, registerShaper } from 'fontkit/core';
import { TTFFont, TTFGlyph } from 'fontkit/formats/TTFFont';
import { TrueTypeCollection } from 'fontkit/formats/TrueTypeCollection';
import { DefaultShaper } from 'fontkit/shapers/DefaultShaper';
import { ArabicShaper } from 'fontkit/shapers/ArabicShaper';
import { HangulShaper } from 'fontkit/shapers/HangulShaper';
import { HebrewShaper } from 'fontkit/shapers/HebrewShaper';
import { IndicShaper } from 'fontkit/shapers/IndicShaper';
import { MyanmarShaper } from 'fontkit/shapers/MyanmarShaper';
import { ThaiShaper } from 'fontkit/shapers/ThaiShaper';
import { UniversalShaper } from 'fontkit/shapers/UniversalShaper';

/** A glyph of fontkit. */
export interface FkGlyph {
  readonly id: number;
  readonly codePoints: number[];
  readonly advanceWidth: number;
}

/** The glyph metadata fontkit keeps while shaping (GlyphInfo). */
export interface FkGlyphInfo {
  id: number;
  codePoints: number[];
  isMark: boolean;
  markAttachment: number | null;
  cursiveAttachment: number | null;
}

/** A position of fontkit (GlyphPosition), font units. */
export interface FkPosition {
  xAdvance: number;
  yAdvance: number;
  xOffset: number;
  yOffset: number;
}

/** The OpenType layout engine of fontkit (OTLayoutEngine). */
export interface FkOTEngine {
  glyphInfos: FkGlyphInfo[] | null;
  plan: { process(processor: unknown, glyphs: FkGlyphInfo[], positions?: FkPosition[]): void; allFeatures: Record<string, number> } | null;
  shaper: FkShaper | null;
  GSUBProcessor: unknown;
  GPOSProcessor: { features: Record<string, unknown>; direction: string; fixAttachments(g: FkGlyphInfo[], p: FkPosition[]): void } | null;
  fallbackPosition: boolean;
  setup(glyphRun: FkGlyphRun): void;
  substitute(glyphRun: FkGlyphRun): void;
  zeroMarkAdvances(positions: FkPosition[]): void;
  cleanup(): void;
  position?: unknown;
}

/** A glyph run of fontkit, as its layout engine reads and fills it. */
export interface FkGlyphRun {
  glyphs: FkGlyph[];
  positions: FkPosition[] | null;
  script: string | string[];
  language: string | null;
  direction: 'ltr' | 'rtl';
  features: Record<string, boolean>;
}

/** The layout engine of a font (LayoutEngine). */
export interface FkLayoutEngine {
  engine?: FkOTEngine & { constructor: { name: string } };
  kernProcessor: { getKerning(left: number, right: number): number } | null;
  unicodeLayoutEngine: { positionGlyphs(glyphs: FkGlyph[], positions: FkPosition[], direction: string): void } | null;
  layout(text: string, features: string[], script: string | null, language: string | null, direction: string): { glyphs: FkGlyph[]; positions: FkPosition[] };
  isDefaultIgnorable(cp: number): boolean;
}

/** A subset of fontkit. */
export interface FkSubset {
  glyphs: number[];
  mapping: Record<number, number>;
  includeGlyph(glyph: number): number;
  encode(): Uint8Array;
}

/** A font of fontkit (TTFFont). */
export interface FkFont {
  readonly unitsPerEm: number;
  readonly numGlyphs: number;
  readonly postscriptName: string | null;
  readonly kern?: unknown;
  readonly GSUB?: { scriptList?: { tag: string }[] | null } | null;
  readonly GPOS?: unknown;
  readonly morx?: unknown;
  readonly fvar?: { axis: { axisTag: string }[] };
  readonly directory: { tables: Record<string, { offset: number; length: number }> };
  readonly _cmapProcessor: {
    lookup(codepoint: number, variationSelector?: number): number;
    getVariationSelector(codepoint: number, variationSelector: number): number;
    uvs: unknown;
  };
  readonly _layoutEngine: FkLayoutEngine;
  readonly _variationProcessor: unknown;
  getGlyph(id: number, codePoints?: number[]): FkGlyph;
  glyphForCodePoint(codePoint: number): FkGlyph;
  hasGlyphForCodePoint(codePoint: number): boolean;
  createSubset(): FkSubset;
  getVariation(settings: Record<string, number>): FkFont;
}

/** The outline glyph of a TrueType font, even in a color font (whose getGlyph gives color glyphs). */
export function outlineGlyph(font: FkFont, id: number): FkGlyph {
  const Ctor = TTFGlyph as new (id: number, codePoints: number[], font: FkFont) => FkGlyph;
  return new Ctor(id, [], font);
}

/** A shaper of fontkit (a class with static members): what a layout of this package reads of it. */
export interface FkShaper {
  readonly zeroMarkWidths?: string;
  plan(plan: unknown, glyphs: FkGlyphInfo[], features: Record<string, boolean>): void;
}

/** The shapers of fontkit, by the HarfBuzz shaper each one stands for. */
export const FK_SHAPERS = {
  default: DefaultShaper as FkShaper,
  arabic: ArabicShaper as FkShaper,
  hangul: HangulShaper as FkShaper,
  hebrew: HebrewShaper as FkShaper,
  indic: IndicShaper as FkShaper,
  myanmar: MyanmarShaper as FkShaper,
  thai: ThaiShaper as FkShaper,
  use: UniversalShaper as FkShaper,
} as const;

let registered = false;

function ensureRegistered(): void {
  if (registered) return;
  registered = true;
  registerFormat(TTFFont);
  registerFormat(TrueTypeCollection);
  for (const shaper of [ArabicShaper, HangulShaper, HebrewShaper, IndicShaper, MyanmarShaper, ThaiShaper, UniversalShaper])
    registerShaper(shaper);
}

/**
 * The fontkit font of a face of a file: the face of a collection (the lower 16 bits of the index)
 * and, for a named instance of a variable font (the upper bits), that instance.
 */
export function openFontkitFace(bytes: Uint8Array, faceIndex: number, instanceCoords: Record<string, number> | null): FkFont {
  ensureRegistered();
  const obj = create(bytes) as FkFont | { fonts: FkFont[] };
  let font: FkFont;
  if ('fonts' in obj && Array.isArray(obj.fonts)) {
    const f = obj.fonts[faceIndex & 0xffff];
    if (f === undefined) throw new Error('The collection has no face ' + String(faceIndex & 0xffff));
    font = f;
  } else font = obj as FkFont;
  if (instanceCoords !== null) font = font.getVariation(instanceCoords);
  return font;
}
