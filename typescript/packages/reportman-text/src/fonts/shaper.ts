// Shaping with fontkit the way the C# engine shapes with HarfBuzz (FontInfoFt.DarForma): a text of
// one direction and script, with the font at a scale of 1024 units per em, gives glyphs, advances
// and offsets in those units and the cluster (UTF-16 index) of each glyph, in visual order.
//
// fontkit lays out in font units and keeps no clusters. Here its layout steps are driven one by
// one: the advances and the GPOS adjustments are scaled as HarfBuzz scales them (each value on its
// own, em_mult; anchors with float multiplication and roundf), the legacy kern table is split
// between the two glyphs of a pair as HarfBuzz does, characters are mirrored in a right to left run
// when the font has the mirrored glyph, and the clusters follow the code points of each glyph, with
// HarfBuzz's merging of graphemes and of reordered glyphs.

import type { FkFont, FkGlyph, FkGlyphInfo, FkGlyphRun, FkOTEngine, FkPosition, FkShaper } from './fontkitfont.js';
import { FK_SHAPERS } from './fontkitfont.js';
import { mirroredCharacter } from '../bidi.js';

/** A shaped glyph, in units of the shaping scale. */
export interface ShapedGlyph {
  glyph: number;
  xAdvance: number;
  xOffset: number;
  yOffset: number;
  /** The UTF-16 index of the start of the glyph's cluster in the shaped text. */
  cluster: number;
}

interface HbScale {
  /** HarfBuzz x_mult: (scale << 16) / upem. */
  mult: number;
  /** HarfBuzz x_multf: scale / upem, as a float. */
  multf: number;
}

/** The scaled position HarfBuzz would hold for a glyph. */
interface HbPos {
  scale: HbScale;
  adv: number;
  xo: number;
  yo: number;
  /** Positioned by a lookup this module does not scale itself (cursive): converted from font units. */
  fromFontUnits: boolean;
}

type ScaledPosition = FkPosition & { __hb?: HbPos };

/** em_mult of HarfBuzz: a font unit value at the scale, rounded as the integer multiplication rounds. */
function emMult(v: number, s: HbScale): number {
  // v is an int16 in HarfBuzz
  let x = Math.trunc(v) & 0xffff;
  if (x >= 0x8000) x -= 0x10000;
  return Math.floor((x * s.mult + 32768) / 65536);
}

/**
 * roundf as HarfBuzz uses it: its own _hb_roundf, floorf (x + .5f), so a half goes up (-42.5 is
 * -42), not away from zero as the roundf of C (an anchor at a scale that is not the font's: the C#
 * FreeType driver usually shapes at 1024, the UnitsPerEM a new TTFontData starts with).
 */
function roundf(x: number): number {
  return Math.floor(Math.fround(Math.fround(x) + 0.5));
}

/** em_fscale of HarfBuzz: a float product in single precision. */
function emFscale(v: number, s: HbScale): number {
  return Math.fround(Math.fround(v) * s.multf);
}

/** A font unit value converted at the scale (for what is not scaled value by value). */
function fromFontUnits(v: number, s: HbScale): number {
  return roundf(Math.fround(Math.fround(v) * s.multf));
}

let patchedGpos: object | null = null;

/** Teaches fontkit's GPOS processor to keep HarfBuzz's scaled values next to its own. */
function patchGpos(processor: object): void {
  const proto = Object.getPrototypeOf(processor) as Record<string, unknown> & { __rmHbPatched?: boolean };
  if (proto.__rmHbPatched === true || proto === patchedGpos) return;
  patchedGpos = proto;
  proto.__rmHbPatched = true;
  type Proc = {
    positions: ScaledPosition[];
    glyphIterator: { index: number; peekIndex(n?: number): number };
    getAnchor(anchor: unknown): { x: number; y: number };
    font: { _variationProcessor: unknown; GDEF?: { itemVariationStore?: unknown } };
  };
  const applyPositionValue = proto.applyPositionValue as (this: Proc, sequenceIndex: number, value: Record<string, unknown>) => void;
  proto.applyPositionValue = function (this: Proc, sequenceIndex: number, value: Record<string, unknown>): void {
    const position = this.positions[this.glyphIterator.peekIndex(sequenceIndex)];
    const hb = position?.__hb;
    if (hb === undefined || position === undefined) {
      applyPositionValue.call(this, sequenceIndex, value);
      return;
    }
    const before = { xAdvance: position.xAdvance, xOffset: position.xOffset, yOffset: position.yOffset };
    applyPositionValue.call(this, sequenceIndex, value);
    if (typeof value.xAdvance === 'number') hb.adv += emMult(value.xAdvance, hb.scale);
    if (typeof value.xPlacement === 'number') hb.xo += emMult(value.xPlacement, hb.scale);
    if (typeof value.yPlacement === 'number') hb.yo += emMult(value.yPlacement, hb.scale);
    // The variation deltas fontkit adds on top (variable fonts), converted as they come
    const extraAdv = position.xAdvance - before.xAdvance - (typeof value.xAdvance === 'number' ? value.xAdvance : 0);
    const extraX = position.xOffset - before.xOffset - (typeof value.xPlacement === 'number' ? value.xPlacement : 0);
    const extraY = position.yOffset - before.yOffset - (typeof value.yPlacement === 'number' ? value.yPlacement : 0);
    if (extraAdv !== 0) hb.adv += fromFontUnits(extraAdv, hb.scale);
    if (extraX !== 0) hb.xo += fromFontUnits(extraX, hb.scale);
    if (extraY !== 0) hb.yo += fromFontUnits(extraY, hb.scale);
  };
  const applyAnchor = proto.applyAnchor as (this: Proc, markRecord: { markAnchor?: unknown }, baseAnchor: unknown, baseGlyphIndex: number) => void;
  proto.applyAnchor = function (this: Proc, markRecord: { markAnchor?: unknown }, baseAnchor: unknown, baseGlyphIndex: number): void {
    applyAnchor.call(this, markRecord, baseAnchor, baseGlyphIndex);
    if (!baseAnchor || !markRecord.markAnchor) return;
    const markPos = this.positions[this.glyphIterator.index];
    const hb = markPos?.__hb;
    if (hb === undefined) return;
    const b = this.getAnchor(baseAnchor);
    const m = this.getAnchor(markRecord.markAnchor);
    // MarkArray::apply: roundf (base_x - mark_x), the anchors scaled as floats
    hb.xo = roundf(Math.fround(emFscale(b.x, hb.scale) - emFscale(m.x, hb.scale)));
    hb.yo = roundf(Math.fround(emFscale(b.y, hb.scale) - emFscale(m.y, hb.scale)));
  };
  const applyLookup = proto.applyLookup as (this: Proc, lookupType: number, table: unknown) => boolean;
  proto.applyLookup = function (this: Proc, lookupType: number, table: unknown): boolean {
    if (lookupType !== 3) return applyLookup.call(this, lookupType, table);
    const i = this.glyphIterator.index;
    const j = this.glyphIterator.peekIndex();
    const done = applyLookup.call(this, lookupType, table);
    if (done) {
      const a = this.positions[i]?.__hb;
      const b = this.positions[j]?.__hb;
      if (a !== undefined) a.fromFontUnits = true;
      if (b !== undefined) b.fromFontUnits = true;
    }
    return done;
  };
}

/** propagate_attachment_offsets of HarfBuzz on the scaled positions (before fontkit clears the links). */
function scaledAttachments(glyphs: FkGlyphInfo[], positions: ScaledPosition[], rtl: boolean): void {
  const n = glyphs.length;
  const done = new Uint8Array(n);
  const visit = (i: number): void => {
    if (done[i] === 1) return;
    done[i] = 1;
    const g = glyphs[i] as FkGlyphInfo;
    const hb = (positions[i] as ScaledPosition).__hb;
    if (hb === undefined) return;
    if (g.cursiveAttachment !== null && g.cursiveAttachment !== undefined) {
      const j = g.cursiveAttachment;
      if (j >= 0 && j < n && j !== i) {
        visit(j);
        const hj = (positions[j] as ScaledPosition).__hb;
        if (hj !== undefined) hb.yo += hj.yo;
      }
    }
    if (g.markAttachment !== null && g.markAttachment !== undefined) {
      const j = g.markAttachment;
      if (j >= 0 && j < n && j !== i) {
        visit(j);
        const hj = (positions[j] as ScaledPosition).__hb;
        if (hj !== undefined) {
          hb.xo += hj.xo;
          hb.yo += hj.yo;
        }
        if (!rtl) {
          for (let k = j; k < i; k++) hb.xo -= ((positions[k] as ScaledPosition).__hb as HbPos).adv;
        } else {
          for (let k = j + 1; k < i + 1; k++) hb.xo += ((positions[k] as ScaledPosition).__hb as HbPos).adv;
        }
      }
    }
  };
  for (let i = 0; i < n; i++) visit(i);
}

const MARK = /\p{M}/u;
const EXT_PICT = /\p{Extended_Pictographic}/u;
const GRAPHEME_LEAD = /[\p{Ll}\p{Lu}\p{Lt}\p{Lo}\p{Zs}]/u;

/**
 * The continuation flags of HarfBuzz (hb_set_unicode_props): marks, emoji modifiers, the second of
 * a pair of regional indicators, ZWJ and the pictograph after it, and the other grapheme extenders.
 */
function continuations(cps: number[]): boolean[] {
  const out = new Array<boolean>(cps.length).fill(false);
  for (let i = 0; i < cps.length; i++) {
    const cp = cps[i] as number;
    const ch = String.fromCodePoint(cp);
    if (MARK.test(ch)) {
      out[i] = true;
      continue;
    }
    if (GRAPHEME_LEAD.test(ch)) continue;
    if (cp >= 0x1f3fb && cp <= 0x1f3ff) out[i] = true;
    else if (i > 0 && cp >= 0x1f1e6 && cp <= 0x1f1ff) {
      const prev = cps[i - 1] as number;
      if (prev >= 0x1f1e6 && prev <= 0x1f1ff && !out[i - 1]) out[i] = true;
    } else if (cp === 0x200d) {
      out[i] = true;
      if (i + 1 < cps.length && EXT_PICT.test(String.fromCodePoint(cps[i + 1] as number))) {
        i++;
        out[i] = true;
      }
    } else if ((cp >= 0xff9e && cp <= 0xff9f) || (cp >= 0xe0020 && cp <= 0xe007f)) out[i] = true;
  }
  return out;
}

function isVariationSelector(cp: number): boolean {
  return (cp >= 0xfe00 && cp <= 0xfe0f) || (cp >= 0xe0100 && cp <= 0xe01ef);
}

interface UvsSelector {
  varSelector: number;
  defaultUVS?: { startUnicodeValue: number; additionalCount: number }[] | null;
  nonDefaultUVS?: { unicodeValue: number; glyphID: number }[] | null;
}

/**
 * The glyph of a variation sequence (hb_font_get_variation_glyph): the glyph the cmap format 14
 * gives it, or the nominal glyph when the sequence uses the default one; null when the font does
 * not have the sequence.
 */
function variationGlyph(font: FkFont, cp: number, vs: number): number | null {
  const uvs = font._cmapProcessor.uvs as { varSelectors: { toArray(): UvsSelector[] } } | null | undefined;
  if (uvs === null || uvs === undefined) return null;
  const sel = uvs.varSelectors.toArray().find((s) => s.varSelector === vs);
  if (sel === undefined) return null;
  if (sel.nonDefaultUVS) for (const m of sel.nonDefaultUVS) if (m.unicodeValue === cp) return m.glyphID;
  if (sel.defaultUVS)
    for (const r of sel.defaultUVS)
      if (cp >= r.startUnicodeValue && cp <= r.startUnicodeValue + r.additionalCount) {
        const g = font._cmapProcessor.lookup(cp);
        return g === 0 ? null : g;
      }
  return null;
}

/**
 * Shapes a text of one direction and script with a font at a scale (units per em), as HarfBuzz:
 * the glyphs in visual order with their advances, offsets and clusters.
 *
 * @param scripts The OpenType script tags, in order of preference.
 * @param language The OpenType language tag, or null for the default language system.
 */
export function shapeText(font: FkFont, text: string, rtl: boolean, scripts: string[], language: string | null, scale: number): ShapedGlyph[] {
  if (text.length === 0) return [];
  const s: HbScale = { mult: Math.trunc((scale * 65536) / font.unitsPerEm), multf: Math.fround(scale / font.unitsPerEm) };
  // The code points and their UTF-16 indices
  const cps: number[] = [];
  const starts: number[] = [];
  for (let i = 0; i < text.length; ) {
    const cp = text.codePointAt(i) as number;
    cps.push(cp);
    starts.push(i);
    i += cp > 0xffff ? 2 : 1;
  }
  // Mirroring in a right to left run, when the font has the mirrored glyph (hb_ot_mirror_chars)
  if (rtl) {
    for (let i = 0; i < cps.length; i++) {
      const m = mirroredCharacter(cps[i] as number);
      if (m !== null && font.hasGlyphForCodePoint(m)) cps[i] = m;
    }
  }
  // Grapheme clusters: each continuation takes the cluster of what it continues
  const cont = continuations(cps);
  const baseCluster: number[] = [];
  for (let i = 0; i < cps.length; i++) baseCluster.push(cont[i] && i > 0 ? (baseCluster[i - 1] as number) : (starts[i] as number));
  // The glyphs: a variation selector joins its base when the font has the sequence. The code
  // points of each glyph are kept apart: fontkit keeps one glyph object per id, with the code
  // points of its first use, which can be another character (a space for a no-break space)
  const glyphs: FkGlyph[] = [];
  const glyphCps: number[][] = [];
  for (let i = 0; i < cps.length; i++) {
    const cp = cps[i] as number;
    const next = cps[i + 1];
    if (next !== undefined && isVariationSelector(next)) {
      const variant = variationGlyph(font, cp, next);
      if (variant !== null) {
        // The font has the sequence: one glyph for both (replace_glyphs (2, 1))
        glyphs.push(font.getGlyph(variant, [cp, next]));
        glyphCps.push([cp, next]);
        i++;
        continue;
      }
    }
    glyphs.push(font.glyphForCodePoint(cp));
    glyphCps.push([cp]);
  }
  const le = font._layoutEngine;
  const engine = le.engine as FkOTEngine | undefined;
  const isOT = engine !== undefined && engine.constructor.name === 'OTLayoutEngine';
  if (engine !== undefined && !isOT) return shapeWithFontkitLayout(font, text, rtl, scripts, language, s, baseCluster);
  // fontkit creates its kern table processor and its fallback mark positioning in its own layout,
  // when the font needs them: one layout before this one leaves them made
  if (le.kernProcessor === null || le.unicodeLayoutEngine === null) {
    const probe = (le as unknown as { __rmProbed?: boolean }).__rmProbed;
    if (probe !== true) {
      (le as unknown as { __rmProbed?: boolean }).__rmProbed = true;
      le.layout('AV', [], null, null, 'ltr');
    }
  }
  const glyphRun: FkGlyphRun = {
    // The layout reads the id and the code points of each glyph
    glyphs: glyphs.map((g, i) => ({ id: g.id, codePoints: glyphCps[i] as number[], advanceWidth: g.advanceWidth })),
    positions: null,
    script: scripts,
    language,
    direction: rtl ? 'rtl' : 'ltr',
    features: {},
  };
  // The glyphs after the substitutions, and their code points: those of the layout's glyph infos
  let out = glyphs;
  let outCps = glyphCps;
  if (engine !== undefined) {
    engine.setup(glyphRun);
    useHarfBuzzShaper(font, engine, glyphRun, scripts);
    engine.substitute(glyphRun);
    out = glyphRun.glyphs;
    outCps = (engine.glyphInfos ?? []).map((info) => info.codePoints);
  }
  const clusters = glyphClusters(outCps, cps, starts, cont);
  // Positions, font units and scaled
  const positions: ScaledPosition[] = out.map((g) => {
    const p: ScaledPosition = { xAdvance: g.advanceWidth, yAdvance: 0, xOffset: 0, yOffset: 0 };
    p.__hb = { scale: s, adv: emMult(g.advanceWidth, s), xo: 0, yo: 0, fromFontUnits: false };
    return p;
  });
  glyphRun.positions = positions;
  let positioned: Record<string, unknown> | null = null;
  if (engine !== undefined && engine.glyphInfos !== null) {
    const infos = engine.glyphInfos;
    if (engine.GPOSProcessor !== null) patchGpos(engine.GPOSProcessor);
    const zero = engine.shaper?.zeroMarkWidths;
    if (zero === 'BEFORE_GPOS') zeroMarks(infos, positions);
    if (engine.GPOSProcessor !== null && engine.plan !== null) engine.plan.process(engine.GPOSProcessor, infos, positions);
    positioned = engine.GPOSProcessor !== null ? engine.GPOSProcessor.features : null;
    if ((positioned === null || !('kern' in positioned)) && font.kern) applyKernTable(font, out, positions);
    if (zero === 'AFTER_GPOS') zeroMarks(infos, positions);
    if (engine.GPOSProcessor !== null) {
      scaledAttachments(infos, positions, rtl);
      engine.GPOSProcessor.fixAttachments(infos, positions);
    }
  } else if (font.kern) applyKernTable(font, out, positions);
  if (positioned === null) {
    // Fallback mark positioning of a font without GPOS (bounding boxes), converted from font units
    const before = positions.map((p) => ({ x: p.xOffset, y: p.yOffset, a: p.xAdvance }));
    const engineless = le.unicodeLayoutEngine;
    if (engineless !== null) {
      // The glyphs with their own code points, which say what is a mark
      const views = out.map((g, i) => {
        const own = outCps[i] ?? [];
        return Object.create(g, { codePoints: { value: own }, isMark: { value: own.length > 0 && own.every((c) => /\p{M}/u.test(String.fromCodePoint(c))) } }) as FkGlyph;
      });
      engineless.positionGlyphs(views, positions, engine !== undefined ? 'ltr' : rtl ? 'rtl' : 'ltr');
      positions.forEach((p, i) => {
        const b = before[i] as { x: number; y: number; a: number };
        const hb = p.__hb as HbPos;
        if (p.xOffset !== b.x || p.yOffset !== b.y || p.xAdvance !== b.a) {
          hb.xo += fromFontUnits(p.xOffset - b.x, s);
          hb.yo += fromFontUnits(p.yOffset - b.y, s);
          hb.adv += fromFontUnits(p.xAdvance - b.a, s);
        }
      });
    }
  }
  for (const p of positions) {
    const hb = p.__hb as HbPos;
    if (hb.fromFontUnits) {
      hb.adv = emMult(p.xAdvance, s);
      hb.xo = fromFontUnits(p.xOffset, s);
      hb.yo = fromFontUnits(p.yOffset, s);
    }
  }
  // Default ignorables not substituted: the space glyph with no advance (hb_ot_hide_default_ignorables)
  const space = font.glyphForCodePoint(0x20);
  for (let i = 0; i < out.length; i++) {
    const g = out[i] as FkGlyph;
    const cp = (outCps[i] ?? [])[0];
    if (cp === undefined || !le.isDefaultIgnorable(cp) || g.id !== font.glyphForCodePoint(cp).id) continue;
    out[i] = space;
    const p = positions[i] as ScaledPosition;
    p.xAdvance = 0;
    p.yAdvance = 0;
    const hb = p.__hb as HbPos;
    hb.adv = 0;
    hb.xo = 0;
    hb.yo = 0;
  }
  engine?.cleanup();
  const result: ShapedGlyph[] = out.map((g, i) => {
    const hb = (positions[i] as ScaledPosition).__hb as HbPos;
    return { glyph: g.id, xAdvance: hb.adv, xOffset: hb.xo, yOffset: hb.yo, cluster: clusters[i] as number };
  });
  if (rtl) result.reverse();
  return result;
}

/**
 * The shaper HarfBuzz runs (hb_ot_shaper_categorize), by the script of the text and the GSUB script
 * chosen for it (the first of the script's tags the font has, else DFLT, dflt or latn), and the
 * script its plan selects: the chosen tag, the script's own when the font has none of its tags.
 * Null when it is the one fontkit picks anyway. fontkit picks by the font's script alone: a font
 * without the Thai script would lose the decomposition of sara am HarfBuzz always does.
 */
function harfBuzzShaper(font: FkFont, scripts: string[]): { shaper: FkShaper; script: string } | null {
  const list = font.GSUB?.scriptList ?? [];
  const has = (tag: string): boolean => list.some((e) => e.tag === tag);
  const own = scripts[scripts.length - 1] ?? 'latn';
  let chosen: string | null = null;
  let found = false;
  for (const tag of scripts) {
    if (has(tag)) {
      chosen = tag;
      found = true;
      break;
    }
  }
  if (chosen === null) chosen = ['DFLT', 'dflt', 'latn'].find(has) ?? null;
  const script = found && chosen !== null ? chosen : own;
  switch (own) {
    case 'arab':
      return { shaper: FK_SHAPERS.arabic, script };
    case 'hebr':
      return { shaper: FK_SHAPERS.hebrew, script };
    case 'thai':
    case 'lao ':
      return { shaper: FK_SHAPERS.thai, script };
    case 'hang':
      return { shaper: FK_SHAPERS.hangul, script };
    case 'deva':
      if (chosen === 'DFLT' || chosen === 'latn') return { shaper: FK_SHAPERS.default, script: chosen };
      if (chosen !== null && chosen.endsWith('3')) return { shaper: FK_SHAPERS.use, script };
      return { shaper: FK_SHAPERS.indic, script };
    default:
      return null;
  }
}

/** Plans the run again with the shaper HarfBuzz runs, when fontkit's setup picked another one. */
function useHarfBuzzShaper(font: FkFont, engine: FkOTEngine, glyphRun: FkGlyphRun, scripts: string[]): void {
  const want = harfBuzzShaper(font, scripts);
  const infos = engine.glyphInfos;
  if (want === null || engine.plan === null || infos === null || infos.length === 0 || engine.shaper === want.shaper) return;
  const Info = (infos[0] as FkGlyphInfo).constructor as new (font: FkFont, id: number, codePoints: number[]) => FkGlyphInfo;
  const Plan = engine.plan.constructor as new (font: FkFont, script: string, direction: string) => NonNullable<FkOTEngine['plan']>;
  engine.glyphInfos = glyphRun.glyphs.map((g) => new Info(font, g.id, [...g.codePoints]));
  engine.shaper = want.shaper;
  engine.plan = new Plan(font, want.script, glyphRun.direction);
  want.shaper.plan(engine.plan, engine.glyphInfos, {});
  glyphRun.features = Object.fromEntries(Object.keys(engine.plan.allFeatures).map((k) => [k, true]));
}

/**
 * The cluster of each glyph of a shaped run (logical order), as HarfBuzz's clusters come out with
 * its default level (monotone graphemes): the characters of a grapheme share a cluster, a glyph
 * that stands for several characters (a ligature) merges their clusters and those of what is
 * between them, a merge reaches the characters that already shared a cluster with its ends, and
 * what was reordered is merged so the clusters never decrease.
 */
function glyphClusters(glyphCps: number[][], cps: number[], starts: number[], cont: boolean[]): number[] {
  const n = cps.length;
  // Union-find of the characters that share a cluster
  const parent = new Int32Array(n);
  for (let i = 0; i < n; i++) parent[i] = i;
  const find = (i: number): number => {
    while (parent[i] !== i) {
      parent[i] = parent[parent[i] as number] as number;
      i = parent[i] as number;
    }
    return i;
  };
  const union = (a: number, b: number): void => {
    const ra = find(a);
    const rb = find(b);
    if (ra === rb) return;
    if (ra < rb) parent[rb] = ra;
    else parent[ra] = rb;
  };
  for (let i = 1; i < n; i++) if (cont[i]) union(i, i - 1);
  // The characters each glyph stands for: its code points, in order; a code point that is not in
  // the text (a decomposition, Thai sara am) belongs to the character that decomposes into it
  const queue = new Map<number, number[]>();
  for (let i = 0; i < n; i++) {
    const cp = cps[i] as number;
    let q = queue.get(cp);
    if (q === undefined) {
      q = [];
      queue.set(cp, q);
    }
    q.push(i);
  }
  const used = new Uint8Array(n);
  // The parts of each character still to be claimed by a glyph of its decomposition
  const pending = new Map<number, number[]>();
  const sources: number[][] = [];
  let position = 0;
  for (const codePoints of glyphCps) {
    const src: number[] = [];
    for (const cp of codePoints) {
      // The nearest character that is that code point, or that decomposes into it and still has
      // that part to give (a glyph of a decomposition, Thai sara am)
      // The first unclaimed occurrence of the code point, unless a decomposition is nearer
      const q = queue.get(cp);
      let found = -1;
      let foundDistance = Number.POSITIVE_INFINITY;
      let fromQueue = -1;
      if (q !== undefined && q.length > 0) {
        found = q[0] as number;
        foundDistance = Math.abs(found - position);
        fromQueue = 0;
      }
      for (let d = 0; d < Math.min(foundDistance, n); d++) {
        let hit = -1;
        for (const i of d === 0 ? [position] : [position - d, position + d]) {
          if (i < 0 || i >= n || used[i] === 1) continue;
          let parts = pending.get(i);
          if (parts === undefined) {
            parts = Array.from(String.fromCodePoint(cps[i] as number).normalize('NFKD'), (c) => c.codePointAt(0) as number);
            if (parts.length < 2) parts = [];
            pending.set(i, parts);
          }
          if (parts.includes(cp)) {
            hit = i;
            break;
          }
        }
        if (hit >= 0) {
          const parts = pending.get(hit) as number[];
          parts.splice(parts.indexOf(cp), 1);
          found = hit;
          fromQueue = -1;
          // The Thai and Lao sara am, decomposed, go into the cluster before them
          // (preprocess_text_thai: merge_out_clusters with the previous cluster or the tone marks)
          if ((cps[hit] === 0x0e33 || cps[hit] === 0x0eb3) && hit > 0) union(hit, hit - 1);
          break;
        }
      }
      if (found < 0) continue;
      if (fromQueue >= 0) {
        (q as number[]).splice(fromQueue, 1);
        used[found] = 1;
      }
      src.push(found);
      position = Math.max(position, found);
    }
    if (src.length > 1) {
      const lo = Math.min(...src);
      const hi = Math.max(...src);
      for (let i = lo + 1; i <= hi; i++) union(i, lo);
    }
    sources.push(src);
  }
  const groupMin = new Map<number, number>();
  for (let i = 0; i < n; i++) {
    const r = find(i);
    const s = starts[i] as number;
    const m = groupMin.get(r);
    if (m === undefined || s < m) groupMin.set(r, s);
  }
  const clusters: number[] = [];
  let lastCluster = 0;
  for (const src of sources) {
    let best = Number.POSITIVE_INFINITY;
    for (const i of src) best = Math.min(best, groupMin.get(find(i)) as number);
    const c = best === Number.POSITIVE_INFINITY ? lastCluster : best;
    clusters.push(c);
    lastCluster = c;
  }
  mergeToMonotone(clusters);
  return clusters;
}

/** Merges clusters so that they never decrease, each merged range taking its smallest cluster. */
function mergeToMonotone(clusters: number[]): void {
  // Groups of merged glyphs: [start, end) with their minimum
  const starts: number[] = [];
  const mins: number[] = [];
  for (let i = 0; i < clusters.length; i++) {
    let c = clusters[i] as number;
    let start = i;
    while (mins.length > 0 && c < (mins[mins.length - 1] as number)) {
      start = starts.pop() as number;
      c = Math.min(c, mins.pop() as number);
    }
    starts.push(start);
    mins.push(c);
  }
  for (let g = 0; g < starts.length; g++) {
    const end = g + 1 < starts.length ? (starts[g + 1] as number) : clusters.length;
    for (let i = starts[g] as number; i < end; i++) clusters[i] = mins[g] as number;
  }
}

function zeroMarks(infos: FkGlyphInfo[], positions: ScaledPosition[]): void {
  for (let i = 0; i < infos.length; i++) {
    if ((infos[i] as FkGlyphInfo).isMark) {
      const p = positions[i] as ScaledPosition;
      p.xAdvance = 0;
      p.yAdvance = 0;
      if (p.__hb !== undefined) p.__hb.adv = 0;
    }
  }
}

/** The legacy kern table as HarfBuzz applies it: half of each value to each glyph of the pair. */
function applyKernTable(font: FkFont, glyphs: FkGlyph[], positions: ScaledPosition[]): void {
  const le = font._layoutEngine;
  if (le.kernProcessor === null) {
    // fontkit creates its kern processor in its own layout; ask it once
    le.layout('AV', [], null, null, 'ltr');
  }
  const kp = le.kernProcessor;
  if (kp === null) return;
  for (let i = 0; i < glyphs.length - 1; i++) {
    const kern = kp.getKerning((glyphs[i] as FkGlyph).id, (glyphs[i + 1] as FkGlyph).id);
    if (kern === 0) continue;
    const a = positions[i] as ScaledPosition;
    const b = positions[i + 1] as ScaledPosition;
    a.xAdvance += kern;
    const k = emMult(kern, (a.__hb as HbPos).scale);
    const k1 = k >> 1;
    const k2 = k - k1;
    (a.__hb as HbPos).adv += k1;
    (b.__hb as HbPos).adv += k2;
    (b.__hb as HbPos).xo += k2;
  }
}

/** A font with an AAT layout (morx): fontkit's own layout, converted from font units. */
function shapeWithFontkitLayout(
  font: FkFont,
  text: string,
  rtl: boolean,
  scripts: string[],
  language: string | null,
  s: HbScale,
  baseCluster: number[],
): ShapedGlyph[] {
  const run = font._layoutEngine.layout(text, [], scripts[0] ?? null, language, rtl ? 'rtl' : 'ltr');
  let k = 0;
  const result: ShapedGlyph[] = run.glyphs.map((g, i) => {
    const p = run.positions[i] as FkPosition;
    const cluster = baseCluster[Math.min(k, baseCluster.length - 1)] ?? 0;
    k += Math.max(1, g.codePoints.length);
    return { glyph: g.id, xAdvance: emMult(p.xAdvance, s), xOffset: fromFontUnits(p.xOffset, s), yOffset: fromFontUnits(p.yOffset, s), cluster };
  });
  return result;
}
