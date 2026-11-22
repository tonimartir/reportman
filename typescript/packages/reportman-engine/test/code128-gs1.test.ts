// Code 128 and GS1-128 as tests/Code128Gs1Test of the C# engine: every case is encoded with the
// barcode item and the bars are read back with a reader of the test's own (the symbol table of
// ISO/IEC 15417, the check value and the code sets A, B and C), which plays the part of ZXing in
// C# with ASSUME_GS1: FNC1 (the ¿ of the text) first gives the "]C1" prefix and elsewhere GS.

import { describe, expect, it } from 'vitest';
import { BarcodeItem as BarcodeModel, BarcodeType, Report } from '@reportman/lib';
import { PdfDevice } from '@reportman/pdf';
import { prepareReport, type ReportRuntime } from '@reportman/engine';
import { BarcodeItem } from '../src/report/barcode/barcodeitem.js';

const FNC1 = '¿';
const SSCC = '376104250021234569';
const GS = '\u001d';

// The bar and space widths of the symbol values 0 to 106 (106 is the stop, with its final bar)
const SYMBOLS = [
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
  '114131', '311141', '411131', '211412', '211214', '211232', '2331112',
];

/**
 * Reads a pattern of the engine ('5' to '8' bars of 1 to 4 modules, '0' to '3' spaces) as a Code
 * 128 reader with GS1 does; the number of modules too. Throws when it does not read.
 */
function read(pattern: string): { text: string; modules: number } {
  const widths = [...pattern].map((ch) => (ch >= '5' ? ch.charCodeAt(0) - 0x35 + 1 : ch.charCodeAt(0) - 0x30 + 1));
  for (let i = 0; i < pattern.length; i++) if ((pattern[i]! >= '5') !== (i % 2 === 0)) throw new Error('bars and spaces do not alternate at ' + i);
  const modules = widths.reduce((a, b) => a + b, 0);
  if ((widths.length - 7) % 6 !== 0) throw new Error('not a whole number of symbols');
  const values: number[] = [];
  for (let i = 0; i + 6 <= widths.length - 7; i += 6) {
    const symbol = widths.slice(i, i + 6).join('');
    const v = SYMBOLS.indexOf(symbol);
    if (v < 0 || v > 105) throw new Error('unknown symbol ' + symbol);
    values.push(v);
  }
  if (widths.slice(-7).join('') !== SYMBOLS[106]) throw new Error('no stop pattern');
  const [start, ...rest] = values;
  if (start === undefined || start < 103) throw new Error('no start code');
  const check = rest.pop();
  let sum = start;
  rest.forEach((v, i) => (sum += v * (i + 1)));
  if (check !== sum % 103) throw new Error('bad check value');
  let set = start - 103; // 0 A, 1 B, 2 C
  let text = '';
  rest.forEach((v, i) => {
    if (v === 102) {
      text += i === 0 ? ']C1' : GS;
      return;
    }
    if (set === 2) {
      if (v < 100) text += String(v).padStart(2, '0');
      else set = v === 100 ? 1 : 0;
      return;
    }
    if (v === 99) set = 2;
    else if (set === 0 && v === 100) set = 1;
    else if (set === 1 && v === 101) set = 0;
    else if (v >= 96) throw new Error('function code ' + v + ' not expected');
    else if (set === 1) text += String.fromCharCode(v + 32);
    else text += String.fromCharCode(v < 64 ? v + 32 : v - 64);
  });
  return { text, modules };
}

let runtime: ReportRuntime | undefined;
async function encode(barType: BarcodeType, text: string, ratio?: number): Promise<{ pattern: string; widths: number[] }> {
  runtime ??= (await prepareReport(new Report(), { device: new PdfDevice() })).runtime;
  const model = new BarcodeModel();
  model.barType = barType;
  model.modul = 10;
  if (ratio !== undefined) model.ratio = ratio;
  const item = new BarcodeItem(runtime, model);
  item.currentText = text;
  const pattern = item.calculateBarcode();
  // The twips each width of the pattern is drawn with (the modules of MakeModules)
  return { pattern, widths: [...(item as unknown as { modules: number[] }).modules] };
}
const pattern = async (barType: BarcodeType, text: string): Promise<string> => (await encode(barType, text)).pattern;

const cases: [string, BarcodeType, string][] = [
  ['sscc_auto', BarcodeType.Code128, FNC1 + '00' + SSCC],
  ['sscc_b', BarcodeType.Code128B, FNC1 + '00' + SSCC],
  ['sscc_c', BarcodeType.Code128C, FNC1 + '00' + SSCC],
  ['lot_auto', BarcodeType.Code128, FNC1 + '10L2511'],
  ['lot_b', BarcodeType.Code128B, FNC1 + '10L2511'],
  // (00) is fixed length: the lot follows without FNC1. One code set for all of it made L2511 "0051"
  ['sscc_lot_auto', BarcodeType.Code128, FNC1 + '00' + SSCC + '10L2511'],
  // Fixed length first, FNC1 after the variable (37) because (10) follows it
  ['gtin_quantity_lot_auto', BarcodeType.Code128, FNC1 + '0208412345678905' + '3724' + FNC1 + '10L2511'],
  ['odd_auto', BarcodeType.Code128, FNC1 + '10123'],
  ['odd_c', BarcodeType.Code128C, FNC1 + '10123'],
  ['odd_digits_auto', BarcodeType.Code128, '12345'],
  ['comma_b', BarcodeType.Code128B, 'A,B'],
  ['comma_auto', BarcodeType.Code128, 'A,B'],
  ['text_auto', BarcodeType.Code128, 'Code-128 abc'],
  ['control_a', BarcodeType.Code128A, 'AB\tC'],
  ['control_auto', BarcodeType.Code128, 'ab\tcd'],
];

describe('Code 128 and GS1-128 read back', () => {
  it.each(cases)('%s', async (_name, barType, text) => {
    const expected = (text.startsWith(FNC1) ? ']C1' + text.substring(1) : text).replaceAll(FNC1, GS);
    const { text: got, modules } = read(await pattern(barType, text));
    expect(got).toBe(expected);
    // A whole number of data symbols between the start, check and stop codes
    expect((modules - 13) % 11).toBe(0);
  });

  it('keeps bars of 1 to 4 modules whatever the Ratio', async () => {
    const { pattern: p, widths } = await encode(BarcodeType.Code128, FNC1 + '10L2511', 3.0);
    expect(read(p).text).toBe(']C110L2511');
    expect(widths).toEqual([10, 20, 30, 40]);
  });
});
