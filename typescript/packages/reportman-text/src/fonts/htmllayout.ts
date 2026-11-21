// The line layout helpers of the shaped measurement (HtmlLayoutUtils, LineGlyphs and LineSubText of
// HtmlTextParser.cs): paragraphs, break opportunities and the breaking of a shaped run in chunks
// that fit a width.

import type { TGlyphPos } from './ttfontdata.js';

/** A paragraph of a text: where it starts and its length without the line end (LineSubText). */
export interface LineSubText {
  position: number;
  length: number;
}

/** The glyphs of a line, with the glyphs of each cluster (LineGlyphs). */
export class LineGlyphs {
  readonly textOffset: number;
  readonly glyphs: TGlyphPos[] = [];
  /** The glyph indexes of each cluster (line cluster). */
  readonly clusterMap = new Map<number, number[]>();

  constructor(textOffset: number) {
    this.textOffset = textOffset;
  }

  /** Adds a glyph and records it under its line cluster (AddGlyph). */
  addGlyph(g: TGlyphPos, _logicalStart: number): void {
    this.glyphs.push(g);
    const idx = this.glyphs.length - 1;
    const cluster = g.lineCluster;
    let list = this.clusterMap.get(cluster);
    if (list === undefined) {
      list = [];
      this.clusterMap.set(cluster, list);
    }
    list.push(idx);
  }

  /** The smallest line cluster, 0 without glyphs. */
  get minClusterText(): number {
    if (this.glyphs.length === 0) return 0;
    let m = Number.POSITIVE_INFINITY;
    for (const g of this.glyphs) if (g.lineCluster < m) m = g.lineCluster;
    return m;
  }

  /** The largest line cluster, 0 without glyphs. */
  get maxClusterText(): number {
    if (this.glyphs.length === 0) return 0;
    let m = Number.NEGATIVE_INFINITY;
    for (const g of this.glyphs) if (g.lineCluster > m) m = g.lineCluster;
    return m;
  }
}

/** The paragraphs of a text, split at line feeds; a CR before the LF is left out (DividesIntoLines). */
export function dividesIntoLines(text: string): LineSubText[] {
  const result: LineSubText[] = [];
  let pos = 0;
  while (pos < text.length) {
    const nextPos = text.indexOf('\n', pos);
    if (nextPos === -1) {
      result.push({ position: pos, length: text.length - pos });
      break;
    }
    let len = nextPos - pos;
    if (nextPos > pos && text.charCodeAt(nextPos - 1) === 13) len--;
    result.push({ position: pos, length: len });
    pos = nextPos + 1;
  }
  return result;
}

/** The indexes of a line where it may break: spaces and hyphens (FillPossibleLineBreaksString). */
export function fillPossibleLineBreaksString(line: string): Set<number> {
  const breaks = new Set<number>();
  for (let i = 0; i < line.length; i++) {
    const c = line.charCodeAt(i);
    if (c === 0x20 || c === 0x2d) breaks.add(i);
  }
  return breaks;
}

function isBreakAt(possibleBreaks: Set<number> | null, line: string, charIdx: number): boolean {
  let hasBreak = possibleBreaks !== null && possibleBreaks.has(charIdx);
  if (!hasBreak && charIdx >= 0 && charIdx < line.length) {
    const c = line.charCodeAt(charIdx);
    hasBreak = c === 0x20 || c === 10;
  }
  return hasBreak;
}

/**
 * Breaks a left to right run of glyphs in chunks that fit (BreakChunksLTR): at the last break that
 * fits, mid word only when the run is alone in its line; an empty first chunk asks the caller to
 * flush the line first. `remaining` is updated in place.
 */
export function breakChunksLTR(
  positions: TGlyphPos[],
  remaining: { value: number },
  lineWidthLimit: number,
  possibleBreaks: Set<number> | null,
  line: string,
  lineHasContent: boolean,
): TGlyphPos[][] {
  const chunks: TGlyphPos[][] = [];
  if (positions.length === 0) return chunks;
  let startIdx = 0;
  let firstChunk = true;
  while (startIdx < positions.length) {
    let acc = 0.0;
    let lastBreakGlyphIdx = -1;
    let j = startIdx;
    while (j < positions.length) {
      const p = positions[j] as TGlyphPos;
      acc += p.xAdvance;
      const charIdx = p.lineCluster;
      const hasBreak = isBreakAt(possibleBreaks, line, charIdx);
      if (hasBreak && (acc <= remaining.value || p.charCode === 0x20 || p.charCode === 10)) lastBreakGlyphIdx = j;
      if (acc > remaining.value) break;
      j++;
    }
    let chunkEnd: number;
    if (j >= positions.length) chunkEnd = positions.length - 1;
    else if (lastBreakGlyphIdx !== -1) chunkEnd = lastBreakGlyphIdx;
    else if (firstChunk && lineHasContent) {
      chunks.push([]);
      chunks.push(positions.slice(startIdx));
      return chunks;
    } else chunkEnd = j === startIdx ? j : j - 1;
    chunks.push(positions.slice(startIdx, chunkEnd + 1));
    remaining.value = lineWidthLimit;
    firstChunk = false;
    startIdx = chunkEnd + 1;
  }
  return chunks;
}

/**
 * Breaks a right to left run of glyphs (in logical order) in chunks that fit, from its end
 * (BreakChunksRTL).
 */
export function breakChunksRTL(
  positions: TGlyphPos[],
  remaining: { value: number },
  lineWidthLimit: number,
  possibleBreaks: Set<number> | null,
  line: string,
  lineHasContent: boolean,
): TGlyphPos[][] {
  const chunks: TGlyphPos[][] = [];
  if (positions.length === 0) return chunks;
  let endIdx = positions.length - 1;
  let firstChunk = true;
  while (endIdx >= 0) {
    let acc = 0.0;
    let lastBreakGlyphIdx = -1;
    let j = endIdx;
    while (j >= 0) {
      const p = positions[j] as TGlyphPos;
      acc += p.xAdvance;
      const charIdx = p.lineCluster;
      const hasBreak = isBreakAt(possibleBreaks, line, charIdx);
      if (hasBreak && (acc <= remaining.value || p.charCode === 0x20 || p.charCode === 10)) lastBreakGlyphIdx = j;
      if (acc > remaining.value) break;
      j--;
    }
    let chunkStart: number;
    if (j < 0) chunkStart = 0;
    else if (lastBreakGlyphIdx !== -1) chunkStart = lastBreakGlyphIdx;
    else if (firstChunk && lineHasContent) {
      chunks.push([]);
      chunks.push(positions.slice(0, endIdx + 1));
      return chunks;
    } else chunkStart = j === endIdx ? j : j + 1;
    chunks.push(positions.slice(chunkStart, endIdx + 1));
    remaining.value = lineWidthLimit;
    firstChunk = false;
    endIdx = chunkStart - 1;
  }
  return chunks;
}

/** char.IsWhiteSpace of .NET for a UTF-16 code unit. */
export function isWhiteSpaceNet(c: number): boolean {
  if (c === 0x20 || (c >= 0x09 && c <= 0x0d) || c === 0xa0 || c === 0x85) return true;
  if (c < 0x1680) return false;
  return c === 0x1680 || (c >= 0x2000 && c <= 0x200a) || c === 0x2028 || c === 0x2029 || c === 0x202f || c === 0x205f || c === 0x3000;
}
