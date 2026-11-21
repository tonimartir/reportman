// The Unicode bidirectional algorithm (UAX #9) with bidi-js, used the way the C# engine uses ICU's
// ubidi (Bidi.cs): the levels of a paragraph with a default direction for a paragraph with no
// strong letter, its runs of one level in visual order, and the mirrored characters.

import * as bidiModule from 'bidi-js';

interface BidiJs {
  getEmbeddingLevels(text: string, direction?: 'ltr' | 'rtl' | 'auto'): { levels: Uint8Array; paragraphs: { start: number; end: number; level: number }[] };
  getBidiCharTypeName(ch: string): string;
  getMirroredCharacter(ch: string): string | null;
}

let instance: BidiJs | null = null;

function bidi(): BidiJs {
  if (instance === null) {
    const mod = bidiModule as unknown as { default?: unknown };
    const factory = (typeof mod.default === 'function' ? mod.default : (mod as unknown)) as () => BidiJs;
    instance = factory();
  }
  return instance;
}

/** ICU's UBIDI_DEFAULT_LTR: a paragraph with no strong letter reads left to right. */
export const UBIDI_DEFAULT_LTR = 254;
/** ICU's UBIDI_DEFAULT_RTL: a paragraph with no strong letter reads right to left. */
export const UBIDI_DEFAULT_RTL = 255;

// A character of the Basic Multilingual Plane of each bidi class, to stand for a character outside it
// (bidi-js classifies UTF-16 code units, and a surrogate half alone is a left to right letter to it)
const STAND_IN: Record<string, string> = {
  L: 'a',
  R: 'א',
  AL: 'ا',
  EN: '0',
  ES: '+',
  ET: '#',
  AN: '٠',
  CS: ',',
  NSM: '̀',
  BN: '​',
  B: ' ',
  S: '\t',
  WS: ' ',
  ON: '!',
  LRE: '‪',
  RLE: '‫',
  PDF: '‬',
  LRO: '‭',
  RLO: '‮',
  LRI: '⁦',
  RLI: '⁧',
  FSI: '⁨',
  PDI: '⁩',
};

/** The text with every character outside the BMP as two stand-ins of its bidi class. */
function bmpText(text: string): string {
  let out = '';
  for (let i = 0; i < text.length; i++) {
    const c = text.charCodeAt(i);
    if (c >= 0xd800 && c <= 0xdbff && i + 1 < text.length) {
      const d = text.charCodeAt(i + 1);
      if (d >= 0xdc00 && d <= 0xdfff) {
        const cls = bidi().getBidiCharTypeName(text.substring(i, i + 2));
        const s = STAND_IN[cls] ?? '!';
        out += s + s;
        i++;
        continue;
      }
    }
    out += text.charAt(i);
  }
  return out;
}

/** The mirrored character of a code point (Bidi_Mirroring_Glyph), null when it has none. */
export function mirroredCharacter(cp: number): number | null {
  if (cp > 0xffff) return null;
  const m = bidi().getMirroredCharacter(String.fromCharCode(cp));
  return m === null ? null : m.charCodeAt(0);
}

/** A run of characters of one level, in visual order. */
export interface BidiRun {
  logicalStart: number;
  length: number;
  rtl: boolean;
}

/** A paragraph analysed by the bidirectional algorithm (the IBidiPara of Bidi.cs). */
export class BidiParagraph {
  private levels: Uint8Array = new Uint8Array(0);
  private paraLevel = 0;
  private runs: BidiRun[] = [];

  /**
   * Analyses a paragraph (ubidi_setPara): paraLevel 0 or 1 forces the direction, UBIDI_DEFAULT_LTR
   * and UBIDI_DEFAULT_RTL take it from the first strong letter, or that default without one.
   */
  setPara(text: string, paraLevel: number): void {
    const b = bidi();
    const mapped = bmpText(text);
    let direction: 'ltr' | 'rtl' | 'auto';
    if (paraLevel === 0) direction = 'ltr';
    else if (paraLevel === 1) direction = 'rtl';
    else direction = hasStrongLetter(mapped) ? 'auto' : paraLevel === UBIDI_DEFAULT_RTL ? 'rtl' : 'ltr';
    const result = b.getEmbeddingLevels(mapped, direction);
    this.levels = result.levels;
    this.paraLevel = result.paragraphs.length > 0 ? (result.paragraphs[0] as { level: number }).level : direction === 'rtl' ? 1 : 0;
    // Runs of one level, logical order
    const runs: { start: number; length: number; level: number }[] = [];
    let i = 0;
    while (i < this.levels.length) {
      const lvl = this.levels[i] as number;
      let j = i + 1;
      while (j < this.levels.length && this.levels[j] === lvl) j++;
      runs.push({ start: i, length: j - i, level: lvl });
      i = j;
    }
    // L2: from the highest level to the lowest odd one, reverse every sequence of runs at that level or above
    let maxLevel = 0;
    let minOdd = 255;
    for (const r of runs) {
      if (r.level > maxLevel) maxLevel = r.level;
      if ((r.level & 1) === 1 && r.level < minOdd) minOdd = r.level;
    }
    for (let lvl = maxLevel; lvl >= minOdd && lvl >= 1; lvl--) {
      let k = 0;
      while (k < runs.length) {
        if ((runs[k] as { level: number }).level >= lvl) {
          let e = k;
          while (e + 1 < runs.length && (runs[e + 1] as { level: number }).level >= lvl) e++;
          let a = k;
          let z = e;
          while (a < z) {
            const t = runs[a] as (typeof runs)[number];
            runs[a] = runs[z] as (typeof runs)[number];
            runs[z] = t;
            a++;
            z--;
          }
          k = e + 1;
        } else k++;
      }
    }
    this.runs = runs.map((r) => ({ logicalStart: r.start, length: r.length, rtl: (r.level & 1) === 1 }));
  }

  /** The level of a character (ubidi_getLevelAt). */
  getLevelAt(index: number): number {
    return (this.levels[index] as number | undefined) ?? this.paraLevel;
  }

  /** The number of runs (ubidi_countRuns). */
  countRuns(): number {
    return this.runs.length;
  }

  /** A run in visual order (ubidi_getVisualRun). */
  getVisualRun(index: number): BidiRun {
    return this.runs[index] as BidiRun;
  }

  /** The level of the paragraph (ubidi_getParaLevel). */
  getParaLevel(): number {
    return this.paraLevel;
  }
}

/** Whether a paragraph has a strong letter outside isolates (P2 finds one). */
function hasStrongLetter(text: string): boolean {
  const b = bidi();
  let isolates = 0;
  for (let i = 0; i < text.length; i++) {
    const t = b.getBidiCharTypeName(text.charAt(i));
    if (t === 'LRI' || t === 'RLI' || t === 'FSI') isolates++;
    else if (t === 'PDI') {
      if (isolates > 0) isolates--;
    } else if (t === 'B') return false;
    else if (isolates === 0 && (t === 'L' || t === 'R' || t === 'AL')) return true;
  }
  return false;
}
