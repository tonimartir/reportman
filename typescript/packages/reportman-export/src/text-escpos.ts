// The barcodes the ESC/POS receipt printers (the TM88 family and its clones) draw by themselves,
// from the data of the barcode object of the metafile (PrintOutText.EncodeEscPosQr,
// EncodeEscPosPdf417, EncodeEscPos1D): the command sequences, byte for byte as C# writes them.

import { MetaBarcodeEcc, MetaBarcodeSymbology, TWIPS_PER_INCH, roundHalfEven, toInt32 } from '@reportman/metafile';
import type { MetaObjectBarcode } from '@reportman/metafile';
import { encodeLatin1 } from './text-encoding.js';

/** Dots per inch of the ESC/POS receipt printers (203 is the common one, ESCPOS_DPI). */
export const ESCPOS_DPI = 203;

/** Twips to printer dots, (int)Math.Round. */
const dots = (twips: number): number => toInt32(roundHalfEven((twips * ESCPOS_DPI) / TWIPS_PER_INCH));

function concat(parts: (Uint8Array | number[])[]): Uint8Array {
  let n = 0;
  for (const p of parts) n += p.length;
  const out = new Uint8Array(n);
  let pos = 0;
  for (const p of parts) {
    out.set(p, pos);
    pos += p.length;
  }
  return out;
}

const A = 0x61; // 'a'
const K = 0x6b; // 'k'
const PAREN = 0x28; // '('

/**
 * A linear symbology through GS k: bar height from the box, module width from the box over the
 * modules the encoder counted (2 to 6), no human readable text, the data as ISO-8859-1. Code 128
 * goes with the subset prefix the printer wants ({A, {B or {C; the automatic one as B).
 */
export function encodeEscPos1D(data: string | null, bar: MetaObjectBarcode, align: number): Uint8Array {
  let m: number;
  switch (bar.symbology) {
    case MetaBarcodeSymbology.UPCA:
      m = 65;
      break;
    case MetaBarcodeSymbology.UPCE:
      m = 66;
      break;
    case MetaBarcodeSymbology.EAN13:
      m = 67;
      break;
    case MetaBarcodeSymbology.EAN8:
      m = 68;
      break;
    case MetaBarcodeSymbology.Code39:
      m = 69;
      break;
    case MetaBarcodeSymbology.ITF:
      m = 70;
      break;
    case MetaBarcodeSymbology.Codabar:
      m = 71;
      break;
    case MetaBarcodeSymbology.Code93:
      m = 72;
      break;
    default:
      m = 73; // Code 128
  }
  let payload = data ?? '';
  if (m === 73) {
    const prefix = bar.columns === 1 ? '{A' : bar.columns === 3 ? '{C' : '{B';
    if (!payload.startsWith('{')) payload = prefix + payload;
  }
  let bytes = encodeLatin1(payload);
  if (bytes.length > 255) bytes = bytes.subarray(0, 255);
  const boxdots = dots(bar.width);
  const modules = bar.modules > 0 ? bar.modules : Math.max(20, payload.length * 11);
  let module = Math.trunc(boxdots / modules);
  if (module < 2) module = 2;
  if (module > 6) module = 6;
  let height = dots(bar.height);
  if (height < 1) height = 1;
  if (height > 255) height = 255;
  return concat([
    [27, A, align & 0xff], // ESC a n
    [29, 0x68, height], // GS h n: bar height
    [29, 0x77, module], // GS w n: module width
    [29, 0x48, 0], // GS H 0: no human readable text
    [29, K, m, bytes.length], // GS k m n d1..dn
    bytes,
    [27, A, 0],
  ]);
}

/**
 * PDF417 through GS ( k cn 48: columns and rows as the item asked (0 automatic), the module width
 * from the box, the row height three modules, the error correction level (bits 8 to 15 of the
 * flags), truncated when asked, then store and print.
 */
export function encodeEscPosPdf417(data: string | null, bar: MetaObjectBarcode, align: number): Uint8Array {
  const payload = encodeLatin1(data ?? '');
  const boxdots = dots(bar.width);
  const modules = bar.modules > 0 ? bar.modules : 100;
  let module = Math.trunc(boxdots / modules);
  if (module < 2) module = 2;
  if (module > 8) module = 8;
  const columns = bar.columns < 0 ? 0 : Math.min(30, bar.columns);
  const rows = bar.rows < 3 ? 0 : Math.min(90, bar.rows);
  let ecc = (bar.flags >> 8) & 0xff;
  if (ecc > 8) ecc = 8;
  const options = (bar.flags & 1) !== 0 ? 1 : 0;
  const k = payload.length + 3;
  return concat([
    [27, A, align & 0xff],
    [29, PAREN, K, 3, 0, 48, 65, columns & 0xff], // fn 65: columns
    [29, PAREN, K, 3, 0, 48, 66, rows & 0xff], // fn 66: rows
    [29, PAREN, K, 3, 0, 48, 67, module], // fn 67: module width
    [29, PAREN, K, 3, 0, 48, 68, Math.min(8, module * 3)], // fn 68: row height
    [29, PAREN, K, 4, 0, 48, 69, 48, 48 + ecc], // fn 69: error correction level
    [29, PAREN, K, 3, 0, 48, 70, options], // fn 70: options
    [29, PAREN, K, k & 0xff, (k >> 8) & 0xff, 48, 80, 48], // fn 80: store
    payload,
    [29, PAREN, K, 3, 0, 48, 81, 48], // fn 81: print
    [27, A, 0],
  ]);
}

/**
 * The QR sequence: model 2, the module size that fills the box the layout reserved (the modules
 * across the box, quiet zone included; 3 to 16 dots), the error correction the item asked, the data
 * stored and printed; the alignment set before and back to left after.
 */
export function encodeEscPosQr(data: string, bar: MetaObjectBarcode, align: number): Uint8Array {
  const boxdots = dots(bar.width);
  const modules = bar.modules > 0 ? bar.modules : 33;
  let module = Math.trunc(boxdots / modules);
  if (module < 3) module = 3;
  if (module > 16) module = 16;
  let ecc: number;
  switch (bar.ecc) {
    case MetaBarcodeEcc.M:
      ecc = 49;
      break;
    case MetaBarcodeEcc.Q:
      ecc = 50;
      break;
    case MetaBarcodeEcc.H:
      ecc = 51;
      break;
    default:
      ecc = 48;
  }
  const payload = encodeLatin1(data);
  const k = payload.length + 3;
  return concat([
    [27, A, align & 0xff], // ESC a n
    [29, PAREN, K, 4, 0, 49, 65, 50, 0], // fn 65: model 2
    [29, PAREN, K, 3, 0, 49, 67, module], // fn 67: module size
    [29, PAREN, K, 3, 0, 49, 69, ecc], // fn 69: error correction
    [29, PAREN, K, k & 0xff, (k >> 8) & 0xff, 49, 80, 48], // fn 80: store
    payload,
    [29, PAREN, K, 3, 0, 49, 81, 48], // fn 81: print
    [27, A, 0], // back to left
  ]);
}
