// Readers of the barcodes the engine draws, for the tests: what the bars of a metafile say, read
// the way a scanner does (the symbologies of @zxing/library with its readers, the others by their
// specification), so a test checks the data of a symbol and not only its bars.

import * as zxingModule from '@zxing/library';
import { SPDF417_CODEWORDS } from '../src/report/barcode/pdf417tables.js';

// @zxing/library gives Node its CommonJS bundle (the default export) and bundlers its ES modules
const zxing: typeof zxingModule = (zxingModule as unknown as { default?: typeof zxingModule }).default ?? zxingModule;

/** A bar as the fixtures keep it: left, top, width, height and colour. */
export type Bar = readonly [left: number, top: number, width: number, height: number, color: number];

const WHITE = 0xffffff;

/** An element of a linear symbol: a bar (its height against the tallest: full or short) or a space. */
export interface Element {
  bar: boolean;
  width: number;
  /** A bar shorter than the tallest one (PostNet). */
  short: boolean;
  /** The bar starts at the top of the symbol. */
  atTop: boolean;
  /** The bar ends at the bottom of the symbol. */
  atBottom: boolean;
}

/** The bars and spaces of a linear symbol drawn left to right (white bars are spaces). */
export function elements(bars: readonly Bar[]): Element[] {
  const dark = bars.filter((b) => b[4] !== WHITE).sort((a, b) => a[0] - b[0]);
  if (dark.length === 0) return [];
  const top = Math.min(...dark.map((b) => b[1]));
  const bottom = Math.max(...dark.map((b) => b[1] + b[3]));
  const out: Element[] = [];
  let x = dark[0]![0];
  for (const b of dark) {
    if (b[0] > x) out.push({ bar: false, width: b[0] - x, short: false, atTop: false, atBottom: false });
    out.push({ bar: true, width: b[2], short: b[3] < bottom - top, atTop: b[1] === top, atBottom: b[1] + b[3] === bottom });
    x = b[0] + b[2];
  }
  return out;
}

/** Narrow (false) or wide (true) for each element, against the narrowest one. */
function wide(els: readonly Element[]): boolean[] {
  const narrow = Math.min(...els.map((e) => e.width));
  return els.map((e) => e.width > narrow * 1.5);
}

function fail(what: string): never {
  throw new Error('not a ' + what + ' symbol');
}

/**
 * MSI (Modified Plessey): a wide bar and a narrow space, four bits per digit (0 a narrow bar and
 * a wide space, 1 a wide bar and a narrow space), a narrow bar, a wide space and a narrow bar.
 * Returns the digits, the check digit included.
 */
export function readMsi(bars: readonly Bar[]): string {
  const els = elements(bars);
  const w = wide(els);
  if (els.length < 5 || (els.length - 5) % 8 !== 0) fail('MSI');
  if (!(w[0] && !w[1])) fail('MSI');
  const n = els.length;
  if (!(!w[n - 3] && w[n - 2] && !w[n - 1])) fail('MSI');
  let digits = '';
  for (let i = 2; i < n - 3; i += 8) {
    let d = 0;
    for (let bit = 0; bit < 4; bit++) {
      const bar = w[i + bit * 2]!;
      const space = w[i + bit * 2 + 1]!;
      if (bar === space) fail('MSI');
      d = d * 2 + (bar ? 1 : 0);
    }
    if (d > 9) fail('MSI');
    digits += String(d);
  }
  return digits;
}

/** The Mod 10 check digit of MSI (Luhn: from the right, every other digit doubled). */
export function msiMod10(digits: string): number {
  let sum = 0;
  for (let i = digits.length - 1, double = true; i >= 0; i--, double = !double) {
    const d = digits.charCodeAt(i) - 48;
    const v = double ? d * 2 : d;
    sum += v > 9 ? v - 9 : v;
  }
  return (10 - (sum % 10)) % 10;
}

const POSTNET = ['11000', '00011', '00101', '00110', '01001', '01010', '01100', '10001', '10010', '10100'];

/**
 * PostNet: a tall frame bar, five bars per digit (two tall, three short) and a tall frame bar;
 * every bar stands on the base line (`aligned` says whether the short ones do, 'bottom', or hang
 * from the top, 'top'). Returns the digits.
 */
export function readPostNet(bars: readonly Bar[]): { digits: string; aligned: 'bottom' | 'top' | 'none' } {
  const b = elements(bars).filter((e) => e.bar);
  if (b.length < 2 || (b.length - 2) % 5 !== 0) fail('PostNet');
  if (b[0]!.short || b[b.length - 1]!.short) fail('PostNet');
  let digits = '';
  for (let i = 1; i < b.length - 1; i += 5) {
    const code = b.slice(i, i + 5).map((e) => (e.short ? '0' : '1')).join('');
    const d = POSTNET.indexOf(code);
    if (d < 0) fail('PostNet');
    digits += String(d);
  }
  const short = b.filter((e) => e.short);
  const aligned = short.length === 0 ? 'none' : short.every((e) => e.atBottom) ? 'bottom' : short.every((e) => e.atTop) ? 'top' : fail('PostNet');
  return { digits, aligned };
}

// Bar, space, bar, space, bar, space, bar: 1 for a wide one
const CODABAR: Record<string, string> = {
  '0000011': '0', '0000110': '1', '0001001': '2', '1100000': '3', '0010010': '4', '1000010': '5', '0100001': '6', '0100100': '7',
  '0110000': '8', '1001000': '9', '0001100': '-', '0011000': '$', '1000101': ':', '1010001': '/', '1010100': '.', '0010101': '+',
  '0011010': 'A', '0101001': 'B', '0001011': 'C', '0001110': 'D',
};

/** Codabar: seven elements per character and a narrow space between characters; start and stop included. */
export function readCodabar(bars: readonly Bar[]): string {
  const els = elements(bars);
  const w = wide(els);
  if ((els.length + 1) % 8 !== 0) fail('Codabar');
  let text = '';
  for (let i = 0; i < els.length; i += 8) {
    const ch = CODABAR[w.slice(i, i + 7).map((x) => (x ? '1' : '0')).join('')];
    if (ch === undefined) fail('Codabar');
    if (i + 7 < els.length && w[i + 7]) fail('Codabar');
    text += ch;
  }
  if (!/^[A-D][^A-D]*[A-D]$/.test(text)) fail('Codabar');
  return text;
}

const TWO_OF_FIVE = ['00110', '10001', '01001', '11000', '00101', '10100', '01100', '00011', '10010', '01010'];

/**
 * 2 of 5 matrix: the start (a bar of three modules, then narrow space, bar, space, bar, space),
 * five elements per digit (bar, space, bar, space, bar; two of them wide) and a narrow space, and
 * the stop (the bar of three modules, narrow space, bar, space, bar). Returns the digits.
 */
export function readMatrix25(bars: readonly Bar[]): string {
  const els = elements(bars);
  const n = els.length;
  if (n < 11 || (n - 11) % 6 !== 0) fail('2 of 5 matrix');
  const narrow = Math.min(...els.map((e) => e.width));
  const isWide = (e: Element): boolean => e.width > narrow * 1.5;
  // The guards: their first bar is the widest element of the symbol, the rest narrow
  const guard = (from: number, count: number): boolean => els[from]!.width > narrow * 2 && els.slice(from + 1, from + count).every((e) => !isWide(e));
  if (!guard(0, 6) || !guard(n - 5, 5)) fail('2 of 5 matrix');
  let digits = '';
  for (let i = 6; i < n - 5; i += 6) {
    const code = els.slice(i, i + 5).map((e) => (isWide(e) ? '1' : '0')).join('');
    const d = TWO_OF_FIVE.indexOf(code);
    if (d < 0 || isWide(els[i + 5]!)) fail('2 of 5 matrix');
    digits += String(d);
  }
  return digits;
}

/** A row of pixels (one per twip) of the full-height bars, with quiet zones, for a reader of @zxing/library. */
function row(bars: readonly Bar[]): zxingModule.BitArray {
  const dark = bars.filter((b) => b[4] !== WHITE);
  const left = Math.min(...dark.map((b) => b[0]));
  const right = Math.max(...dark.map((b) => b[0] + b[2]));
  const quiet = 200;
  const bits = new zxing.BitArray(right - left + 2 * quiet);
  for (const b of dark) for (let x = b[0]; x < b[0] + b[2]; x++) bits.set(x - left + quiet);
  return bits;
}

/** Code 93 (plain or extended), with the Code93Reader of @zxing/library: it checks both check characters. */
export function readCode93(bars: readonly Bar[]): string {
  return new zxing.Code93Reader().decodeRow(0, row(bars), new Map()).getText();
}

// ---------------------------------------------------------------------------------------------
// QR

/** A QR symbol read back from its modules. */
export interface QrSymbol {
  /** The modules of a side (21 for version 1), without the quiet zone. */
  size: number;
  text: string;
  /** L, M, Q or H. */
  level: string;
}

/**
 * A QR symbol drawn without rotation, read with the QRCodeReader of @zxing/library: the dark
 * modules (the rectangles of the size of the smallest one; a background rectangle is not one) as
 * a bit matrix with its quiet zone.
 */
export function readQr(bars: readonly Bar[]): QrSymbol {
  const module = Math.min(...bars.map((b) => b[2]));
  const dark = bars.filter((b) => b[2] === module && b[3] === module);
  const left = Math.min(...dark.map((b) => b[0]));
  const top = Math.min(...dark.map((b) => b[1]));
  const size = Math.round((Math.max(...dark.map((b) => b[0] + b[2])) - left) / module);
  const quiet = 4;
  const matrix = new zxing.BitMatrix(size + 2 * quiet, size + 2 * quiet);
  for (const b of dark) matrix.set(Math.round((b[0] - left) / module) + quiet, Math.round((b[1] - top) / module) + quiet);
  const image = { getBlackMatrix: () => matrix } as unknown as zxingModule.BinaryBitmap;
  const result = new zxing.QRCodeReader().decode(image, new Map([[zxing.DecodeHintType.PURE_BARCODE, true]]));
  return { size, text: result.getText(), level: String(result.getResultMetadata().get(zxing.ResultMetadataType.ERROR_CORRECTION_LEVEL)) };
}

// ---------------------------------------------------------------------------------------------
// PDF417

/** A PDF417 symbol read back from its bars. */
export interface Pdf417Symbol {
  rows: number;
  /** Data columns. */
  cols: number;
  /** The error correction level the row indicators give. */
  level: number;
  truncated: boolean;
  /** The codewords of the data region, row by row: the length, the data, the padding and the error correction. */
  codewords: number[];
}

const PDF417_START = 0b11111111010101000;
const PDF417_STOP = 0b11111110100010100;
const clusters = SPDF417_CODEWORDS.map((patterns) => new Map(patterns.map((p, codeword) => [p, codeword])));

/**
 * The codewords of a PDF417 symbol drawn without rotation: the modules of each row (17 per
 * codeword: start, left indicator, data, right indicator and stop, or data and one bar when
 * truncated) looked up in the cluster of the row.
 */
export function readPdf417(bars: readonly Bar[]): Pdf417Symbol {
  const left = Math.min(...bars.map((b) => b[0]));
  const modul = Math.min(...bars.map((b) => b[2]));
  const tops = [...new Set(bars.map((b) => b[1]))].sort((a, b) => a - b);
  const codewords: number[] = [];
  let cols = -1;
  let level = -1;
  let truncated = false;
  tops.forEach((top, r) => {
    const rowBars = bars.filter((b) => b[1] === top);
    const right = Math.max(...rowBars.map((b) => b[0] + b[2]));
    const bits = new Array<number>(Math.round((right - left) / modul)).fill(0);
    for (const b of rowBars) {
      const start = Math.round((b[0] - left) / modul);
      for (let i = 0; i < Math.round(b[2] / modul); i++) bits[start + i] = 1;
    }
    const patterns: number[] = [];
    for (let c = 0; c + 17 <= bits.length; c += 17) patterns.push(bits.slice(c, c + 17).reduce((v, bit) => v * 2 + bit, 0));
    if (patterns[0] !== PDF417_START) fail('PDF417');
    const full = patterns[patterns.length - 1] === PDF417_STOP;
    truncated = !full;
    const values = patterns.slice(1, full ? patterns.length - 1 : patterns.length).map((p) => {
      const codeword = clusters[r % 3]!.get(p);
      if (codeword === undefined) fail('PDF417');
      return codeword;
    });
    const data = values.slice(1, full ? values.length - 1 : values.length);
    if (cols >= 0 && data.length !== cols) fail('PDF417');
    cols = data.length;
    // The left indicator of the second row: (rows - 1) % 3 + 3 * level
    if (r === 1) level = Math.floor((values[0]! % 30) / 3);
    codewords.push(...data);
  });
  return { rows: tops.length, cols, level, truncated, codewords };
}

/**
 * The error correction codewords of PDF417 for the data codewords, by the book (ISO/IEC 15438):
 * the remainder by the generator polynomial with roots 3^1 to 3^k over GF(929), complemented.
 */
export function pdf417ErrorCorrection(data: readonly number[], k: number): number[] {
  // g[0] is the coefficient of x^k (1), g[k] the constant
  let g = [1];
  let root = 1;
  for (let i = 0; i < k; i++) {
    root = (root * 3) % 929;
    const next = new Array<number>(g.length + 1).fill(0);
    for (let j = 0; j < g.length; j++) {
      next[j] = (next[j]! + g[j]!) % 929;
      next[j + 1] = (next[j + 1]! + 929 - ((g[j]! * root) % 929)) % 929;
    }
    g = next;
  }
  const e = new Array<number>(k).fill(0);
  for (const d of data) {
    const t = (d + e[0]!) % 929;
    for (let j = 0; j < k; j++) e[j] = ((j + 1 < k ? e[j + 1]! : 0) + 929 - ((t * g[j + 1]!) % 929)) % 929;
  }
  return e.map((v) => (929 - v) % 929);
}

const PDF417_PUNCTUATION = ';<>@[\\]_`~!\r\t,:\n-.$/"|*()?{}\'';
const PDF417_MIXED = '0123456789&\r\t,:#-.$/+%*=^';

/**
 * The bytes (a character each) the data codewords of a PDF417 symbol say, by the book: text
 * compaction with its four submodes, byte compaction (901: groups of five codewords while more
 * than five are left, then a byte per codeword; 924: groups of five) and numeric compaction
 * (groups of fifteen codewords). `codewords` are all those of the symbol: the first one is the
 * count of data codewords.
 */
export function pdf417Text(codewords: readonly number[]): string {
  const cw = codewords.slice(1, codewords[0]);
  let out = '';
  let i = 0;
  let mode = 900;
  const isLatch = (c: number): boolean => c === 900 || c === 901 || c === 902 || c === 924;
  while (i < cw.length) {
    const c = cw[i]!;
    if (isLatch(c)) {
      mode = c;
      i++;
      continue;
    }
    if (c >= 900 && c !== 913) throw new Error('PDF417: codeword ' + String(c));
    let j = i;
    if (mode === 900) {
      // 0 alpha, 1 lower, 2 mixed, 3 punctuation
      let sub = 0;
      let shift = -1;
      const value = (v: number): void => {
        const m = shift >= 0 ? shift : sub;
        const shifted = shift >= 0;
        shift = -1;
        if (m === 3) {
          if (v < 29) out += PDF417_PUNCTUATION.charAt(v);
          else if (!shifted) sub = 0;
          return;
        }
        if (m === 2 ? v < 25 : v < 26) out += m === 0 ? String.fromCharCode(65 + v) : m === 1 ? String.fromCharCode(97 + v) : PDF417_MIXED.charAt(v);
        else if (v === 26) out += ' ';
        else if (shifted) throw new Error('PDF417: a latch after a shift');
        else if (v === 29) shift = 3;
        else if (m === 0) sub = v === 27 ? 1 : 2;
        else if (m === 1) {
          if (v === 27) shift = 0;
          else sub = 2;
        } else sub = v === 25 ? 3 : v === 27 ? 1 : 0;
      };
      while (j < cw.length && (cw[j]! < 900 || cw[j] === 913)) {
        if (cw[j] === 913) {
          shift = -1;
          out += String.fromCharCode(cw[j + 1]! & 0xff);
          j += 2;
        } else {
          value(Math.floor(cw[j]! / 30));
          value(cw[j]! % 30);
          j++;
        }
      }
    } else {
      while (j < cw.length && cw[j]! < 900) j++;
      const run = cw.slice(i, j);
      const number = (group: readonly number[]): bigint => group.reduce((v, x) => v * 900n + BigInt(x), 0n);
      if (mode === 902) {
        for (let k = 0; k < run.length; k += 15) {
          const digits = number(run.slice(k, k + 15)).toString();
          if (!digits.startsWith('1')) throw new Error('PDF417: numeric group ' + digits);
          out += digits.slice(1);
        }
      } else {
        let k = 0;
        if (mode === 924 && run.length % 5 !== 0) throw new Error('PDF417: 924 with ' + String(run.length) + ' codewords');
        while (mode === 924 ? k < run.length : run.length - k > 5) {
          let v = number(run.slice(k, k + 5));
          let six = '';
          for (let b = 0; b < 6; b++) {
            six = String.fromCharCode(Number(v & 255n)) + six;
            v >>= 8n;
          }
          if (v !== 0n) throw new Error('PDF417: byte group');
          out += six;
          k += 5;
        }
        for (; k < run.length; k++) {
          if (run[k]! > 255) throw new Error('PDF417: byte ' + String(run[k]));
          out += String.fromCharCode(run[k]!);
        }
      }
    }
    i = j;
  }
  return out;
}
