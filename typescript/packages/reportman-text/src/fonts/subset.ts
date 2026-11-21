// The font program of a font of the PDF (FontInfoFt.GetFontStream): a fontkit subset with the
// glyphs used. A TrueType subset is compact (glyphs renumbered) and the map from the glyph numbers
// of the page to the new ones is left in TTFontData.glyphMap, for the /CIDToGIDMap. A CFF subset is
// a CID-keyed CFF whose charset gives every glyph its old number as CID, so the page keeps its
// numbers and a CIDFontType0 needs no map.

import { outlineGlyph, type FkFont } from './fontkitfont.js';
import { faceDirectory, sfntIsCFF } from './sfnt.js';
import { SortedNumberMap, type TTFontData } from './ttfontdata.js';

/** The subset of a face with the glyphs of a font data; sets glyphMap, fontProgramIsSubset and the CFF flags. */
export function subsetFont(font: FkFont, data: TTFontData, faceIndex: number): Uint8Array {
  const bytes = data.fontData;
  const dir = faceDirectory(bytes, faceIndex);
  const cff = dir >= 0 && sfntIsCFF(bytes, dir);
  data.glyphMap = null;
  data.cffKeepsCIDs = false;
  data.cffProgram = false;
  const tables = (font as FkFont & { directory: { tables: Record<string, unknown> } }).directory.tables;
  if (tables['CFF2'] !== undefined)
    throw new Error(
      'The font ' + data.fontFamily + ' has CFF2 outlines (a variable OpenType font): fontkit cannot subset them, so it cannot be embedded',
    );
  if (tables['glyf'] === undefined && tables['CFF '] === undefined)
    throw new Error('The font ' + data.fontFamily + ' has no outlines to embed');
  const subset = font.createSubset();
  // A color font (COLR, sbix) gives color glyphs, which fontkit's TrueType subset cannot read: the
  // subset reads the outline glyphs underneath
  const base = font as FkFont & { directory: { tables: Record<string, unknown> } };
  if (!cff && (base.directory.tables.COLR !== undefined || base.directory.tables.sbix !== undefined)) {
    (subset as unknown as { font: unknown }).font = new Proxy(base, {
      get(target, prop) {
        if (prop === 'getGlyph') return (id: number) => outlineGlyph(target, id);
        const v = Reflect.get(target, prop, target) as unknown;
        return typeof v === 'function' ? (v as (...a: unknown[]) => unknown).bind(target) : v;
      },
    });
  }
  const requested = data.glyphs.values();
  for (const g of requested) subset.includeGlyph(g);
  if (!cff) {
    const program = subset.encode();
    const map = new SortedNumberMap<number>();
    for (const g of requested) {
      const n = subset.mapping[g];
      if (n === undefined) throw new Error('The subset lost the glyph ' + String(g));
      map.set(g, n);
    }
    data.glyphMap = map;
    data.fontProgramIsSubset = true;
    return program;
  }
  // CFF: the CIDs of the subset are the glyph numbers of the font
  const cffProgram = subset.encode();
  const oldOfNew = subset.glyphs.slice();
  // Whatever the CIDs of the font were, the CID of each glyph of the subset is its old number, the
  // code the page writes
  const program = setCidCharset(cffProgram, oldOfNew);
  data.cffKeepsCIDs = true;
  data.cffProgram = true;
  data.fontProgramIsSubset = true;
  return program;
}

// ---------------------------------------------------------------------------------------------
// The charset of a CFF subset written by fontkit, replaced by one with the old glyph numbers

interface DictOp {
  /** The operator, 12 xx as 1200 + xx. */
  op: number;
  /** The operand bytes, as written. */
  operands: Uint8Array[];
}

function readIndex(d: Uint8Array, pos: number): { count: number; offSize: number; offsets: number[]; dataStart: number; end: number } {
  const count = ((d[pos] as number) << 8) | (d[pos + 1] as number);
  if (count === 0) return { count, offSize: 0, offsets: [], dataStart: pos + 2, end: pos + 2 };
  const offSize = d[pos + 2] as number;
  const offsets: number[] = [];
  for (let i = 0; i <= count; i++) {
    let v = 0;
    for (let k = 0; k < offSize; k++) v = v * 256 + (d[pos + 3 + i * offSize + k] as number);
    offsets.push(v);
  }
  const dataStart = pos + 3 + (count + 1) * offSize - 1;
  return { count, offSize, offsets, dataStart, end: dataStart + (offsets[count] as number) };
}

function parseDict(d: Uint8Array, start: number, end: number): DictOp[] {
  const ops: DictOp[] = [];
  let operands: Uint8Array[] = [];
  let p = start;
  while (p < end) {
    const b0 = d[p] as number;
    if (b0 <= 21) {
      let op = b0;
      p++;
      if (b0 === 12) {
        op = 1200 + (d[p] as number);
        p++;
      }
      ops.push({ op, operands });
      operands = [];
      continue;
    }
    let len: number;
    if (b0 === 28) len = 3;
    else if (b0 === 29) len = 5;
    else if (b0 === 30) {
      len = 1;
      while (p + len < end) {
        const n = d[p + len] as number;
        len++;
        if ((n & 0x0f) === 0x0f || n >> 4 === 0x0f) break;
      }
    } else if (b0 >= 32 && b0 <= 246) len = 1;
    else if (b0 >= 247 && b0 <= 254) len = 2;
    else len = 1;
    operands.push(d.slice(p, p + len));
    p += len;
  }
  return ops;
}

function int32Operand(value: number): Uint8Array {
  return new Uint8Array([29, (value >>> 24) & 0xff, (value >>> 16) & 0xff, (value >>> 8) & 0xff, value & 0xff]);
}

function intOperand(value: number): Uint8Array {
  if (value >= -107 && value <= 107) return new Uint8Array([value + 139]);
  if (value >= 108 && value <= 1131) {
    const v = value - 108;
    return new Uint8Array([(v >> 8) + 247, v & 0xff]);
  }
  if (value >= -1131 && value <= -108) {
    const v = -value - 108;
    return new Uint8Array([(v >> 8) + 251, v & 0xff]);
  }
  if (value >= -32768 && value <= 32767) return new Uint8Array([28, (value >> 8) & 0xff, value & 0xff]);
  return int32Operand(value);
}

function operandValue(b: Uint8Array): number {
  const b0 = b[0] as number;
  if (b0 === 29) return (((b[1] as number) << 24) | ((b[2] as number) << 16) | ((b[3] as number) << 8) | (b[4] as number)) | 0;
  if (b0 === 28) {
    const v = ((b[1] as number) << 8) | (b[2] as number);
    return v >= 0x8000 ? v - 0x10000 : v;
  }
  if (b0 >= 32 && b0 <= 246) return b0 - 139;
  if (b0 >= 247 && b0 <= 250) return (b0 - 247) * 256 + (b[1] as number) + 108;
  if (b0 >= 251 && b0 <= 254) return -(b0 - 251) * 256 - (b[1] as number) - 108;
  return 0;
}

function encodeDict(ops: DictOp[]): Uint8Array {
  const parts: number[] = [];
  for (const o of ops) {
    for (const opnd of o.operands) for (const b of opnd) parts.push(b);
    if (o.op >= 1200) parts.push(12, o.op - 1200);
    else parts.push(o.op);
  }
  return new Uint8Array(parts);
}

function writeIndex(items: Uint8Array[]): Uint8Array {
  if (items.length === 0) return new Uint8Array([0, 0]);
  let offset = 1;
  for (const it of items) offset += it.length;
  const offSize = offset <= 0xff ? 1 : offset <= 0xffff ? 2 : offset <= 0xffffff ? 3 : 4;
  const out = new Uint8Array(3 + (items.length + 1) * offSize + offset - 1);
  out[0] = items.length >> 8;
  out[1] = items.length & 0xff;
  out[2] = offSize;
  let o = 1;
  let p = 3;
  const put = (v: number): void => {
    for (let k = offSize - 1; k >= 0; k--) out[p + k] = Math.floor(v / 256 ** (offSize - 1 - k)) & 0xff;
    p += offSize;
  };
  put(o);
  for (const it of items) {
    o += it.length;
    put(o);
  }
  for (const it of items) {
    out.set(it, p);
    p += it.length;
  }
  return out;
}

const POINTER_OPS = new Set([15, 16, 17, 1236, 1237]);

/**
 * A CID-keyed CFF (as fontkit's CFFSubset writes it) with a charset that gives glyph i the CID
 * oldOfNew[i], and a CIDCount that covers them. The Top DICT is written again (its pointers keep
 * their five byte form, moved by the change of its size) and the charset goes at the end.
 */
export function setCidCharset(cff: Uint8Array, oldOfNew: number[]): Uint8Array {
  const hdrSize = cff[2] as number;
  const names = readIndex(cff, hdrSize);
  const top = readIndex(cff, names.end);
  if (top.count !== 1) throw new Error('A CFF subset with ' + String(top.count) + ' fonts');
  const topStart = top.dataStart + (top.offsets[0] as number);
  const topEnd = top.dataStart + (top.offsets[1] as number);
  const ops = parseDict(cff, topStart, topEnd);
  let maxCid = 0;
  for (const g of oldOfNew) if (g > maxCid) maxCid = g;
  // The new Top DICT, its CIDCount set; the delta of the sizes moves everything after it
  const firstPass = ops.map((o) => ({
    op: o.op,
    operands: o.op === 1234 ? [intOperand(maxCid + 1)] : o.operands,
  }));
  if (!firstPass.some((o) => o.op === 1234)) {
    // fontkit always writes CIDCount; a font without it gets one after ROS
    const ros = firstPass.findIndex((o) => o.op === 1230);
    firstPass.splice(ros + 1, 0, { op: 1234, operands: [intOperand(maxCid + 1)] });
  }
  const oldTopIndexSize = top.end - names.end;
  const newTopDictLength = encodeDict(firstPass).length;
  const newTopIndexSize = writeIndex([new Uint8Array(newTopDictLength)]).length;
  const delta = newTopIndexSize - oldTopIndexSize;
  const tailStart = top.end;
  const newLength = cff.length + delta;
  // The charset at the end: format 2 ranges of consecutive CIDs for glyphs 1..n-1
  const ranges: number[] = [];
  for (let i = 1; i < oldOfNew.length; ) {
    const first = oldOfNew[i] as number;
    let j = i;
    while (j + 1 < oldOfNew.length && (oldOfNew[j + 1] as number) === (oldOfNew[j] as number) + 1 && j - i < 0xffff) j++;
    ranges.push(first, j - i);
    i = j + 1;
  }
  const charset = new Uint8Array(1 + ranges.length * 2);
  charset[0] = 2;
  for (let k = 0; k < ranges.length; k++) {
    charset[1 + 2 * k] = ((ranges[k] as number) >> 8) & 0xff;
    charset[2 + 2 * k] = (ranges[k] as number) & 0xff;
  }
  const charsetOffset = newLength;
  const finalOps = firstPass.map((o) => {
    if (o.op === 15) return { op: 15, operands: [int32Operand(charsetOffset)] };
    if (POINTER_OPS.has(o.op)) return { op: o.op, operands: o.operands.map((b) => int32Operand(operandValue(b) + delta)) };
    if (o.op === 18 && o.operands.length === 2)
      return { op: 18, operands: [o.operands[0] as Uint8Array, int32Operand(operandValue(o.operands[1] as Uint8Array) + delta)] };
    return o;
  });
  const topDict = encodeDict(finalOps);
  const topIndex = writeIndex([topDict]);
  if (topIndex.length !== newTopIndexSize) throw new Error('The CFF Top DICT changed size');
  const out = new Uint8Array(newLength + charset.length);
  out.set(cff.subarray(0, names.end), 0);
  out.set(topIndex, names.end);
  out.set(cff.subarray(tailStart), names.end + topIndex.length);
  out.set(charset, newLength);
  // The Private DICT pointers of the Font DICTs of the FDArray
  const fdArrayOp = ops.find((o) => o.op === 1236);
  if (fdArrayOp !== undefined && delta !== 0) {
    const fdArray = readIndex(cff, operandValue(fdArrayOp.operands[0] as Uint8Array));
    for (let i = 0; i < fdArray.count; i++) {
      const s = fdArray.dataStart + (fdArray.offsets[i] as number);
      const e = fdArray.dataStart + (fdArray.offsets[i + 1] as number);
      // Walk the dict to the operands of Private (18): size, then a five byte offset
      const fdOps = parseDict(cff, s, e);
      let pos = s;
      for (const o of fdOps) {
        let len = 0;
        for (const opnd of o.operands) len += opnd.length;
        if (o.op === 18 && o.operands.length === 2) {
          const offBytes = o.operands[1] as Uint8Array;
          if (offBytes[0] !== 29) throw new Error('A CFF Private DICT offset that is not in its long form');
          const at = pos + (o.operands[0] as Uint8Array).length + delta;
          out.set(int32Operand(operandValue(offBytes) + delta), at);
        }
        pos += len + (o.op >= 1200 ? 2 : 1);
      }
    }
  }
  return out;
}
