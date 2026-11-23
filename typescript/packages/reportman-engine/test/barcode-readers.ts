// Readers of the barcodes the engine draws, for the tests: what the bars of a metafile say, read
// the way a scanner does (the symbologies of @zxing/library with its readers, the others by their
// specification), so a test checks the data of a symbol and not only its bars.

import * as zxingModule from '@zxing/library';

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
