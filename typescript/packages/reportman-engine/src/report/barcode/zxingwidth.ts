// The modules of a linear barcode as the C# engine takes them from ZXing.Net for a device that draws
// the barcode by itself (BarcodeItem.EmitNativeBarcode: MultiFormatWriter with no margin, the width
// of the symbol), or null where the writer refuses the text and the item draws its bars. Only the
// width and the refusals of each writer of ZXing are reproduced (EAN13Writer, EAN8Writer,
// Code39Writer, Code93Writer, ITFWriter, CodaBarWriter, Code128Writer), not their bars:
// @zxing/library has no writer for them. Checked against ZXing.Net with golden-cs zxing-width.

import { MetaBarcodeSymbology } from '@reportman/metafile';

/** The modules of the symbol, or null when ZXing refuses the text. */
export function zxingLinearModules(symbology: MetaBarcodeSymbology, text: string): number | null {
  // OneDimensionalCodeWriter: an empty text is refused
  if (text.length === 0) return null;
  switch (symbology) {
    case MetaBarcodeSymbology.EAN13:
      return upcEan(text, 12) ? 95 : null;
    case MetaBarcodeSymbology.EAN8:
      return upcEan(text, 7) ? 67 : null;
    case MetaBarcodeSymbology.ITF:
      return text.length % 2 === 0 && text.length <= 80 && allDigits(text) ? 9 + 9 * text.length : null;
    case MetaBarcodeSymbology.Code39:
      return code39(text);
    case MetaBarcodeSymbology.Code93:
      return code93(text);
    case MetaBarcodeSymbology.Codabar:
      return codabar(text);
    case MetaBarcodeSymbology.Code128:
      return code128(text);
    default:
      return null;
  }
}

const isDigit = (c: number): boolean => c >= 48 && c <= 57;

function allDigits(text: string): boolean {
  for (let i = 0; i < text.length; i++) if (!isDigit(text.charCodeAt(i))) return false;
  return true;
}

/**
 * EAN13Writer and EAN8Writer: the digits without their check digit (it is added), or with a check
 * digit that must be right (UPCEANReader.checkStandardUPCEANChecksum); digits only.
 */
function upcEan(text: string, dataLength: number): boolean {
  if (!allDigits(text)) return false;
  if (text.length === dataLength) return true;
  if (text.length !== dataLength + 1) return false;
  // The standard UPC/EAN checksum: from the right, odd positions three times
  let sum = 0;
  for (let i = dataLength - 1; i >= 0; i -= 2) sum += text.charCodeAt(i) - 48;
  sum *= 3;
  for (let i = dataLength - 2; i >= 0; i -= 2) sum += text.charCodeAt(i) - 48;
  return (1000 - sum) % 10 === text.charCodeAt(dataLength) - 48;
}

const CODE39_ALPHABET = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ-. $/+%';

/**
 * Code39Writer: 80 characters at most; a character outside the alphabet makes the whole text full
 * ASCII (tryToConvertToExtendedMode: two characters each, but for the digits, the capitals, the
 * space, '-' and '.'), 80 at most again; then 13 modules a character plus the guards.
 */
function code39(text: string): number | null {
  let length = text.length;
  if (length > 80) return null;
  for (let i = 0; i < text.length; i++) {
    if (CODE39_ALPHABET.indexOf(text.charAt(i)) < 0) {
      length = 0;
      for (let j = 0; j < text.length; j++) {
        const c = text.charCodeAt(j);
        if (c > 127) return null;
        length += isDigit(c) || (c >= 65 && c <= 90) || c === 32 || c === 45 || c === 46 ? 1 : 2;
      }
      if (length > 80) return null;
      break;
    }
  }
  return 24 + 1 + 13 * length;
}

/**
 * Code93Writer: the text in full ASCII first (convertToExtended: two characters each, but for the
 * digits, the capitals, the space and - . $ / + %), 80 at most; then 9 modules a character, two
 * check characters, the guards and the termination bar.
 */
function code93(text: string): number | null {
  let length = 0;
  for (let i = 0; i < text.length; i++) {
    const c = text.charCodeAt(i);
    if (c > 127) return null;
    const one = c === 32 || c === 36 || c === 37 || c === 43 || (c >= 45 && c <= 57) || (c >= 65 && c <= 90);
    length += one ? 1 : 2;
  }
  if (length > 80) return null;
  return (length + 2 + 2) * 9 + 1;
}

const CODABAR_START_END = 'ABCD';
const CODABAR_ALT_START_END = 'TN*E';
const CODABAR_TEN = '/:+.';

/**
 * CodaBarWriter: the guards A B C D (or T N * E) at both ends, or none and A is added at both ends
 * (also to a text of one character); the characters between them are digits and - $ (9 modules)
 * or / : + . (10); each guard 10 modules and a gap between characters.
 */
function codabar(text: string): number | null {
  let contents = text;
  if (contents.length < 2) contents = 'A' + contents + 'A';
  else {
    const first = contents.charAt(0).toUpperCase();
    const last = contents.charAt(contents.length - 1).toUpperCase();
    const startsNormal = CODABAR_START_END.includes(first);
    const endsNormal = CODABAR_START_END.includes(last);
    const startsAlt = CODABAR_ALT_START_END.includes(first);
    const endsAlt = CODABAR_ALT_START_END.includes(last);
    if (startsNormal) {
      if (!endsNormal) return null;
    } else if (startsAlt) {
      if (!endsAlt) return null;
    } else {
      if (endsNormal || endsAlt) return null;
      contents = 'A' + contents + 'A';
    }
  }
  let width = 20;
  for (let i = 1; i < contents.length - 1; i++) {
    const ch = contents.charAt(i);
    // Char.IsDigit of .NET: any decimal digit of Unicode
    if (/^\p{Nd}$/u.test(ch) || ch === '-' || ch === '$') width += 9;
    else if (CODABAR_TEN.includes(ch)) width += 10;
    else return null;
  }
  return width + contents.length - 1;
}

const FNC_1 = 0xf1;
const FNC_2 = 0xf2;
const FNC_3 = 0xf3;
const FNC_4 = 0xf4;
const CODE_A = 101;
const CODE_B = 100;
const CODE_C = 99;

const enum CType {
  Uncodable,
  OneDigit,
  TwoDigits,
  Fnc1,
}

function findCType(value: string, start: number): CType {
  const last = value.length;
  if (start >= last) return CType.Uncodable;
  let c = value.charCodeAt(start);
  if (c === FNC_1) return CType.Fnc1;
  if (!isDigit(c)) return CType.Uncodable;
  if (start + 1 >= last) return CType.OneDigit;
  c = value.charCodeAt(start + 1);
  if (!isDigit(c)) return CType.OneDigit;
  return CType.TwoDigits;
}

/** Code128Writer.chooseCode: the code set for the character at start (the code sets of ZXing). */
function chooseCode(value: string, start: number, oldCode: number): number {
  let lookahead = findCType(value, start);
  if (lookahead === CType.OneDigit) return oldCode === CODE_A ? CODE_A : CODE_B;
  if (lookahead === CType.Uncodable) {
    if (start < value.length) {
      const c = value.charCodeAt(start);
      if (c < 32 || (oldCode === CODE_A && (c < 96 || (c >= FNC_1 && c <= FNC_4)))) return CODE_A;
    }
    return CODE_B;
  }
  if (oldCode === CODE_A && lookahead === CType.Fnc1) return CODE_A;
  if (oldCode === CODE_C) return CODE_C;
  if (oldCode === CODE_B) {
    if (lookahead === CType.Fnc1) return CODE_B;
    // Two digits: what follows decides
    lookahead = findCType(value, start + 2);
    if (lookahead === CType.Uncodable || lookahead === CType.OneDigit) return CODE_B;
    if (lookahead === CType.Fnc1) return findCType(value, start + 3) === CType.TwoDigits ? CODE_C : CODE_B;
    // Four digits at least: an even run switches now, an odd one later
    let index = start + 4;
    while ((lookahead = findCType(value, index)) === CType.TwoDigits) index += 2;
    return lookahead === CType.OneDigit ? CODE_B : CODE_C;
  }
  // The first code set
  if (lookahead === CType.Fnc1) lookahead = findCType(value, start + 1);
  return lookahead === CType.TwoDigits ? CODE_C : CODE_B;
}

/**
 * Code128Writer: ASCII or the escapes of FNC1 to FNC4 (U+00F1 to U+00F4), of any length (ZXing.Net
 * has not the limit of 80 characters of ZXing); the code sets chosen as ZXing chooses them; 11
 * modules a symbol (the start, the code changes, the characters, the check symbol) and 13 the stop.
 */
function code128(text: string): number | null {
  const length = text.length;
  for (let i = 0; i < length; i++) {
    const c = text.charCodeAt(i);
    if (c > 127 && (c < FNC_1 || c > FNC_4)) return null;
  }
  let symbols = 0;
  let codeSet = 0;
  let position = 0;
  while (position < length) {
    const newCodeSet = chooseCode(text, position, codeSet);
    if (newCodeSet === codeSet) {
      const c = text.charCodeAt(position);
      // Two digits a symbol in code C (an FNC1 is one symbol in any set)
      if (codeSet === CODE_C && c !== FNC_1 && c !== FNC_2 && c !== FNC_3 && c !== FNC_4) position++;
      position++;
    } else codeSet = newCodeSet;
    symbols++;
  }
  // The check symbol, then the stop
  return 11 * (symbols + 1) + 13;
}
