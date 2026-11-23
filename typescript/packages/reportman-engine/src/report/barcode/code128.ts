// Port of the Code128 struct of Reportman.Reporting.BarcodeItem: the symbol values of a text in
// the fixed code sets A, B and C, and the shortest symbol switching between them (automatic).
//
// C# parity: the table of the struct also keeps the characters of each value in code sets A, B
// and C, used only by FindCodeAB and FindCodeC, which the engine never calls; only the patterns
// are ported.

import { BarcodeType } from '@reportman/lib';

/** The bar and space widths (in modules) of the values 0 to 102. */
export const CODE128_PATTERNS: readonly string[] = [
  '212222', '222122', '222221', '121223', '121322', '131222', '122213', '122312', '132212', '221213',
  '221312', '231212', '112232', '122132', '122231', '113222', '123122', '123221', '223211', '221132',
  '221231', '213212', '223112', '312131', '311222', '321122', '321221', '312212', '322112', '322211',
  '212123', '212321', '232121', '111323', '131123', '131321', '112313', '132113', '132311', '211313',
  '231113', '231311', '112133', '112331', '132131', '113123', '113321', '133121', '313121', '211331',
  '231131', '213113', '213311', '213131', '311123', '311321', '331121', '312113', '312311', '332111',
  '314111', '221411', '431111', '111224', '111422', '121124', '121421', '141122', '141221', '112214',
  '112412', '122114', '122411', '142112', '142211', '241211', '221114', '413111', '241112', '134111',
  '111242', '121142', '121241', '114212', '124112', '124211', '411212', '421112', '421211', '212141',
  '214121', '412121', '111143', '111341', '131141', '114113', '114311', '411113', '411311', '113141',
  '114131', '311141', '411131',
];

export const CODE128_START_A = '211412';
export const CODE128_START_B = '211214';
export const CODE128_START_C = '211232';
export const CODE128_STOP = '2331112';

const FNC1 = -1;
const INFINITE = Math.trunc(2147483647 / 4);
const SET_A = 0;
const SET_B = 1;
const SET_C = 2;

/**
 * Code 128 symbol values for text: the start code first and then the data, without the check
 * value and the stop pattern. The ¿ character (U+00BF) is FNC1, for GS1-128.
 *
 * Code128A and Code128B write the whole text in that code set (a character the set does not
 * have is written as a space). Code128C writes the digits in pairs; a character that does not
 * make a pair goes in code set B and the symbol switches back to C after it. Code128 chooses the
 * code sets that give the shortest symbol, switching between A, B and C as often as it pays off.
 */
export function encodeCode128(text: string, btype: BarcodeType): number[] {
  const n = text.length;
  if (n === 0) return [];
  const codes: number[] = new Array<number>(n);
  for (let i = 0; i < n; i++) {
    const c = text.charCodeAt(i);
    codes[i] = c === 0xbf ? FNC1 : c > 127 ? 32 : c;
  }
  const values: number[] = [];
  switch (btype) {
    case BarcodeType.Code128A:
      values.push(103);
      encodeFixed(codes, SET_A, values);
      break;
    case BarcodeType.Code128B:
      values.push(104);
      encodeFixed(codes, SET_B, values);
      break;
    case BarcodeType.Code128C:
      values.push(105);
      encodeFixed(codes, SET_C, values);
      break;
    default:
      encodeShortest(codes, values);
      break;
  }
  return values;
}

/** The value of a character in code set A or B, or -1 if the set does not have it. */
function valueIn(aset: number, c: number): number {
  if (c === FNC1) return 102;
  if (aset === SET_A) {
    if (c >= 0 && c < 32) return c + 64;
    if (c >= 32 && c <= 95) return c - 32;
  } else if (aset === SET_B) {
    if (c >= 32 && c <= 127) return c - 32;
  }
  return -1;
}

function isDigitAt(codes: readonly number[], p: number): boolean {
  return p < codes.length && codes[p]! >= 48 && codes[p]! <= 57;
}

/** Symbols needed to write codes[p..] being in aset, writing codes[p] in aset. */
function costIn(codes: readonly number[], cost: number[][], aset: number, p: number): number {
  if (codes[p] === FNC1) return 1 + cost[p + 1]![aset]!;
  if (aset === SET_C) return isDigitAt(codes, p) && isDigitAt(codes, p + 1) ? 1 + cost[p + 2]![aset]! : INFINITE;
  return valueIn(aset, codes[p]!) >= 0 ? 1 + cost[p + 1]![aset]! : INFINITE;
}

/** Writes codes[p] (the digit pair at p in code set C) and returns the next position. */
function writeAt(codes: readonly number[], aset: number, p: number, values: number[]): number {
  if (codes[p] === FNC1) {
    values.push(102);
    return p + 1;
  }
  if (aset === SET_C) {
    values.push((codes[p]! - 48) * 10 + (codes[p + 1]! - 48));
    return p + 2;
  }
  values.push(valueIn(aset, codes[p]!));
  return p + 1;
}

function switchTo(aset: number, values: number[]): void {
  values.push(aset === SET_A ? 101 : aset === SET_B ? 100 : 99);
}

function encodeFixed(codes: number[], aset: number, values: number[]): void {
  let current = aset;
  let p = 0;
  while (p < codes.length) {
    if (codes[p] === FNC1) p = writeAt(codes, current, p, values);
    else if (aset !== SET_C) {
      if (valueIn(aset, codes[p]!) < 0) codes[p] = 32;
      p = writeAt(codes, aset, p, values);
    } else if (isDigitAt(codes, p) && isDigitAt(codes, p + 1)) {
      if (current !== SET_C) {
        switchTo(SET_C, values);
        current = SET_C;
      }
      p = writeAt(codes, SET_C, p, values);
    } else {
      // A character that does not make a pair: code set B, or A for a control character
      const other = valueIn(SET_B, codes[p]!) >= 0 ? SET_B : SET_A;
      if (current !== other) {
        switchTo(other, values);
        current = other;
      }
      p = writeAt(codes, other, p, values);
    }
  }
}

function encodeShortest(codes: readonly number[], values: number[]): void {
  const n = codes.length;
  // From the end: the fewest symbols for the rest of the text in each code set
  const cost: number[][] = [];
  const choice: number[][] = [];
  for (let p = 0; p < n + 2; p++) {
    cost.push([0, 0, 0]);
    choice.push([0, 0, 0]);
  }
  for (let p = n - 1; p >= 0; p--) {
    for (let aset = SET_A; aset <= SET_C; aset++) {
      let best = costIn(codes, cost, aset, p);
      choice[p]![aset] = aset;
      for (let other = SET_C; other >= SET_A; other--) {
        if (other === aset) continue;
        const cand = costIn(codes, cost, other, p);
        if (cand < INFINITE && cand + 1 < best) {
          best = cand + 1;
          choice[p]![aset] = other;
        }
      }
      cost[p]![aset] = best;
    }
  }
  // The start code set: the cheapest (B on a tie, then C)
  let startset = SET_B;
  let beststart = costIn(codes, cost, SET_B, 0);
  const c2 = costIn(codes, cost, SET_C, 0);
  if (c2 < beststart) {
    beststart = c2;
    startset = SET_C;
  }
  if (costIn(codes, cost, SET_A, 0) < beststart) startset = SET_A;
  values.push(103 + startset);
  let current = startset;
  let pos = 0;
  while (pos < n) {
    const other = choice[pos]![current]!;
    if (other !== current) {
      switchTo(other, values);
      current = other;
    }
    pos = writeAt(codes, current, pos, values);
  }
}
