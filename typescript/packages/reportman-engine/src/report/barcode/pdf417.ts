// Port of Reportman.Reporting.PDF417Encoder (PDF417Encoder.cs, itself ported from the Delphi
// engine): the high level encoding of a text into PDF417 codewords (numeric, text and binary
// compaction, the escapes of the text compaction), the symbol size, the Reed-Solomon error
// correction and the drawing of the rows into the metafile, a filled rectangle per bar.
//
// The positions in the text are the ones of Delphi, from 1: the encoder of Delphi
// (TextToCodewords and the routines it calls, rpmdbarcode.pas) chooses the compaction modes with
// them, and the symbol of a text is the one Delphi draws only with the same choices. Two of them
// are its own: it never counts the last character of the text when it looks ahead for digits or
// for text (goodForNumericCompaction, goodForTextCompaction), and to choose between a shift and a
// latch of the text submode it looks at the character after the next one. Both give a valid
// symbol.
//
// What Delphi does wrong is not ported (test/barcode-delphi.test.ts has each case): it stops
// before a last character that is on its own (while i < CodeLen), it steps back two characters
// instead of one where the text compaction meets a character it cannot write, so the one before
// it is written twice (Position := Position - 2), it takes a codeword escape (\Cnnn) for a
// character, and for a text mode character over 127 it reads past its table.

import { BrushType, MetaObjectDraw, MetaObjectType, PenType, ShapeType, type MetaFile } from '@reportman/metafile';
import { substringNet } from '../../util/chars.js';
import type { NumberFormatData } from '../../util/culture.js';
import { NumberStyles, tryParseInt32 } from '../../util/numberparse.js';
import { castInt32, charAt, geti, i32, idiv, imod, indexOutOfRange, mathRound, seti, type IntPoint } from './netutil.js';
import {
  SPDF417_CODEWORDS,
  ST_MODS,
  ST_MODS_128,
  ST_MODS_256,
  ST_MODS_512,
  TEXT_COMPACTION_MODE,
  TEXT_COMPACTION_VALUE,
} from './pdf417tables.js';

export const SPDF417_CELL_WIDTH = 17;

/** TSPDF417TextCompactionMode (flags). */
const enum TextMode {
  None = 0,
  Alpha = 1,
  Lower = 2,
  Mixed = 4,
  Punctuation = 8,
}

/** TStDataMode. */
const enum DataMode {
  Binary,
  Text,
  Numeric,
}

/** A TSPDF417TextCompactionData of the table, with the .NET bounds check. */
function textValue(index: number): number {
  return geti(TEXT_COMPACTION_VALUE, index);
}

function textMode(index: number): number {
  return geti(TEXT_COMPACTION_MODE, index);
}

/** The error correction level: the given one, or one by the amount of data (Auto, -1). */
export function getRealErrorLevel(_numRows: number, _numColumns: number, eccLevel: number, numCodewords: number): number {
  if (eccLevel < 0) {
    if (numCodewords < 41) return 2;
    else if (numCodewords < 161) return 3;
    else if (numCodewords < 321) return 4;
    else return 5;
  }
  return eccLevel;
}

/** The character code at a position of Delphi (from 1), with the .NET bounds check. */
function at(code: string, position: number): number {
  return charAt(code, position - 1);
}

// The characters of code page 1252 from 0x80 to 0x9F
const CP1252_HIGH =
  '\u20AC\u0081\u201A\u0192\u201E\u2026\u2020\u2021\u02C6\u2030\u0160\u2039\u0152\u008D\u017D\u008F' +
  '\u0090\u2018\u2019\u201C\u201D\u2022\u2013\u2014\u02DC\u2122\u0161\u203A\u0153\u009D\u017E\u0178';

/**
 * ToAnsi: the text as the bytes PDF417 writes, a character per byte: the AnsiString the Delphi
 * engine encodes on a Western Windows (code page 1252: the euro sign is 0x80). A character the
 * code page does not have is a question mark.
 */
export function toAnsi(text: string): string {
  let ansi = '';
  for (let i = 0; i < text.length; i++) {
    const c = text.charCodeAt(i);
    if (c <= 0xff) ansi += text.charAt(i);
    else {
      const high = CP1252_HIGH.indexOf(text.charAt(i));
      ansi += high >= 0 ? String.fromCharCode(0x80 + high) : '?';
    }
  }
  return ansi;
}

/** The count of digits from position, and whether they are worth a numeric compaction (more than 13). */
function goodForNumericCompaction(code: string, position: number, codeLen: number): boolean {
  let count = 0;
  while (position + count < codeLen && at(code, position + count) >= 48 && at(code, position + count) <= 57) count++;
  return count > 13;
}

function isGoodTextValue(v: number): boolean {
  if (v > 127) return false;
  return textValue(v) >= 0;
}

function goodForTextCompaction(code: string, position: number, codeLen: number): boolean {
  let count = 0;
  while (position + count < codeLen && isGoodTextValue(at(code, position + count)) && count <= 5) count++;
  if (count === 1) return false;
  return count > 5 || (position + count >= codeLen && count > 0);
}

/** Six bytes as five base 900 digits. */
function convertBytesToBase900(s: readonly number[], a: number[]): void {
  const d = [0, 0, 0, 0, 0, 0];
  for (let i = 0; i < 6; i++) d[i] = s[i]!;
  let sp = 0;
  const digits = [0, 0, 0, 0, 0];
  while (sp < 5) {
    let dividend = 0;
    for (let i = 0; i < 6; i++) {
      dividend = dividend * 256 + d[i]!;
      d[i] = Math.trunc(dividend / 900) & 0xff;
      dividend = dividend % 900;
    }
    digits[sp] = dividend;
    sp++;
  }
  let idx = 0;
  while (sp > 0) {
    sp--;
    seti(a, idx, digits[sp]!);
    idx++;
  }
}

function isNumericString(s: string): boolean {
  if (s.length === 0 || s.length > 45) return false;
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    if (c < 48 || c > 57) return false;
  }
  return true;
}

/** A string of digits as base 900 digits; returns the count. */
function convertToBase900(s: string, a: number[]): number {
  if (!isNumericString(s)) throw new Error('ConvertToBase900: S should be a numeric string');
  const d: number[] = [];
  for (let i = 0; i < s.length; i++) d.push(s.charCodeAt(i) - 48);
  let lenD = d.length;
  // FirstDigit of Delphi (from 1): the first digit that is not zero
  let firstDigit = 0;
  for (let i = lenD; i >= 1; i--) if (d[i - 1] !== 0) firstDigit = i;
  if (firstDigit === 0) return 0;
  let sp = 0;
  const digits: number[] = new Array<number>(45).fill(0);
  let done = false;
  while (!done) {
    if (lenD - firstDigit <= 8) {
      let dividend = 0;
      for (let i = firstDigit; i <= lenD; i++) dividend = dividend * 10 + d[i - 1]!;
      while (dividend !== 0) {
        seti(digits, sp, dividend % 900);
        sp++;
        dividend = Math.trunc(dividend / 900);
      }
      done = true;
    } else {
      let rem = d[lenD - 1]!;
      lenD--;
      rem = rem + d[lenD - 1]! * 10;
      lenD--;
      let dividend = 0;
      for (let i = firstDigit; i <= lenD; i++) {
        dividend = dividend * 10 + d[i - 1]!;
        d[i - 1] = Math.trunc(dividend / 9);
        dividend = dividend % 9;
      }
      seti(digits, sp, dividend * 100 + rem);
      sp++;
      // FirstDigit stays where it is: Delphi compares the digit with the character '0', which a
      // digit already turned into its value never is. So the digits that become zero at the
      // front are still divided, and the number gets base 900 digits that are zero at its front:
      // the 38 digits of a full chunk of encodeNumeric (39 with the 1 before them) are always 15
      // codewords, which is what a reader takes as a group. Without those zeros they would be
      // 13, and the reader would take two of the next chunk with them.
    }
  }
  let idx = 0;
  while (sp > 0) {
    sp--;
    seti(a, idx, digits[sp]!);
    idx++;
  }
  return idx;
}

/** The codewords being written (codewords, numCodewords and newTextCodeword of the C# code). */
class CodewordWriter {
  readonly codewords: number[];
  numCodewords = 1;
  /** The next text value starts a codeword (two text values per codeword). */
  newTextCodeword = true;

  constructor(codewords: number[]) {
    this.codewords = codewords;
  }

  /** codewords[numCodewords++] = value. */
  add(value: number): void {
    seti(this.codewords, this.numCodewords, value);
    this.numCodewords++;
  }

  /** A text value: the first half of a new codeword, or the second half of the current one. */
  text(value: number): void {
    if (this.newTextCodeword) {
      seti(this.codewords, this.numCodewords, 30 * value);
      this.newTextCodeword = false;
    } else {
      const i = this.numCodewords;
      this.numCodewords++;
      seti(this.codewords, i, geti(this.codewords, i) + value);
      this.newTextCodeword = true;
    }
  }
}

/** The codewords of a text: the first one (the length) is left for GenerateCodewords. */
function textToCodewords(code: string, codewords: number[], nfi: NumberFormatData): number {
  for (let i = 0; i <= 2700; i++) seti(codewords, i, 900); // PadCodeword
  const w = new CodewordWriter(codewords);
  const pos = { value: 1 };
  const codeLen = code.length;
  if (codeLen === 0) return w.numCodewords;
  let currentMode: DataMode;
  if (goodForNumericCompaction(code, pos.value, codeLen)) {
    currentMode = DataMode.Numeric;
    w.add(902); // NumericCompaction
  } else if (goodForTextCompaction(code, pos.value, codeLen)) {
    currentMode = DataMode.Text;
  } else {
    currentMode = DataMode.Binary;
    w.add(901); // BinaryCompaction
  }
  // Up to the last character: Delphi stops before it (while i < CodeLen), and a text that ends
  // with a character on its own (one character, digits and a letter, text and an accented
  // letter) loses it
  while (pos.value <= codeLen) {
    const before = pos.value;
    switch (currentMode) {
      case DataMode.Binary:
        encodeBinary(code, w, pos, codeLen);
        break;
      case DataMode.Text:
        encodeText(code, w, pos, codeLen, nfi);
        break;
      case DataMode.Numeric:
        encodeNumeric(code, w, pos, codeLen);
        break;
    }
    if (goodForNumericCompaction(code, pos.value, codeLen)) {
      if (currentMode !== DataMode.Numeric) {
        currentMode = DataMode.Numeric;
        w.add(902);
      }
    } else if (goodForTextCompaction(code, pos.value, codeLen)) {
      if (currentMode !== DataMode.Text) {
        w.add(900); // TextCompaction
        currentMode = DataMode.Text;
      } else if (pos.value === before) {
        // The text compaction stopped at an escape it cannot write (\ddd or \Xhh of a character
        // without a text value, \G) and would be called again at the same position for ever
        throw new Error('PDF417: the text compaction cannot write the escape at character ' + String(before) + ' of the text');
      }
    } else {
      if (currentMode !== DataMode.Binary) {
        w.add(901);
        currentMode = DataMode.Binary;
      }
    }
  }
  return w.numCodewords;
}

function countBytes(code: string, position: number, codeLen: number): number {
  let result = 0;
  let done = false;
  while (!done) {
    if (
      result + position <= codeLen &&
      !goodForNumericCompaction(code, position + result, codeLen) &&
      !goodForTextCompaction(code, position + result, codeLen)
    )
      result++;
    else done = true;
  }
  return result;
}

function encodeBinary(code: string, w: CodewordWriter, pos: { value: number }, codeLen: number): void {
  const position = pos.value;
  const binaryDataSize = countBytes(code, position, codeLen);
  const multipleOfSix = binaryDataSize % 6 === 0;
  if (multipleOfSix) w.add(924);
  else w.add(901);
  let i = 0;
  const a = [0, 0, 0, 0, 0, 0, 0];
  while (i < binaryDataSize) {
    if (binaryDataSize - i < 6) {
      w.add(at(code, position + i) & 0xff);
      i++;
    } else {
      const bytes = [0, 1, 2, 3, 4, 5].map((k) => at(code, position + i + k) & 0xff);
      convertBytesToBase900(bytes, a);
      for (let j = 0; j < 5; j++) w.add(a[j]!);
      i += 6;
    }
  }
  pos.value = position + binaryDataSize;
}

function collectDigits(code: string, pos: { value: number }, codeLen: number): string {
  const startPos = pos.value;
  const maxDigitChunk = 38;
  while (pos.value <= codeLen && pos.value - startPos < maxDigitChunk && at(code, pos.value) >= 48 && at(code, pos.value) <= 57) pos.value++;
  if (pos.value - startPos > 0) return '1' + code.substring(startPos - 1, pos.value - 1);
  return '';
}

function encodeNumeric(code: string, w: CodewordWriter, pos: { value: number }, codeLen: number): void {
  let numericString: string;
  const a: number[] = new Array<number>(45).fill(0);
  do {
    numericString = collectDigits(code, pos, codeLen);
    if (numericString !== '') {
      const lenA = convertToBase900(numericString, a);
      for (let i = 0; i < lenA; i++) w.add(a[i]!);
    }
  } while (numericString !== '');
}

function selectBestTextMode(mode: number): TextMode {
  if ((mode & TextMode.Alpha) !== 0) return TextMode.Alpha;
  if ((mode & TextMode.Lower) !== 0) return TextMode.Lower;
  if ((mode & TextMode.Mixed) !== 0) return TextMode.Mixed;
  if ((mode & TextMode.Punctuation) !== 0) return TextMode.Punctuation;
  return TextMode.None;
}

const LatchAlphaToLower = 27;
const LatchAlphaToMixed = 28;
const ShiftAlphaToPunctuation = 29;
const ShiftLowerToAlpha = 27;
const LatchLowerToMixed = 28;
const ShiftLowerToPunctuation = 29;
const LatchMixedToPunctuation = 25;
const LatchMixedToLower = 27;
const LatchMixedToAlpha = 28;
const ShiftMixedToPunctuation = 29;
const LatchPunctuationToAlpha = 29;

/** Writes the latch or shift from one text submode to another; returns the new submode. */
function changeTextSubmode(currentMode: TextMode, newMode: TextMode, useShift: boolean, w: CodewordWriter): TextMode {
  let result = useShift ? currentMode : newMode;
  switch (currentMode) {
    case TextMode.Alpha:
      if (newMode === TextMode.Lower) {
        w.text(LatchAlphaToLower);
        if (useShift) result = newMode;
      } else if (newMode === TextMode.Mixed) {
        w.text(LatchAlphaToMixed);
        if (useShift) result = newMode;
      } else if (newMode === TextMode.Punctuation) {
        if (useShift) w.text(ShiftAlphaToPunctuation);
        else {
          w.text(LatchAlphaToMixed);
          w.text(LatchMixedToPunctuation);
        }
      }
      break;
    case TextMode.Lower:
      if (newMode === TextMode.Alpha) {
        if (useShift) w.text(ShiftLowerToAlpha);
        else {
          w.text(LatchLowerToMixed);
          w.text(LatchMixedToAlpha);
        }
      } else if (newMode === TextMode.Mixed) {
        w.text(LatchLowerToMixed);
        if (useShift) result = newMode;
      } else if (newMode === TextMode.Punctuation) {
        if (useShift) w.text(ShiftLowerToPunctuation);
        else {
          w.text(LatchLowerToMixed);
          w.text(LatchMixedToPunctuation);
        }
      }
      break;
    case TextMode.Mixed:
      if (newMode === TextMode.Alpha) {
        w.text(LatchMixedToAlpha);
        if (useShift) result = newMode;
      } else if (newMode === TextMode.Lower) {
        w.text(LatchMixedToLower);
        if (useShift) result = newMode;
      } else if (newMode === TextMode.Punctuation) {
        if (useShift) w.text(ShiftMixedToPunctuation);
        else w.text(LatchMixedToPunctuation);
      }
      break;
    case TextMode.Punctuation:
      if (newMode === TextMode.Alpha) {
        w.text(LatchPunctuationToAlpha);
        if (useShift) result = newMode;
      } else if (newMode === TextMode.Lower) {
        w.text(LatchPunctuationToAlpha);
        w.text(LatchAlphaToLower);
        if (useShift) result = newMode;
      } else if (newMode === TextMode.Mixed) {
        w.text(LatchPunctuationToAlpha);
        w.text(LatchAlphaToMixed);
        if (useShift) result = newMode;
      }
      break;
  }
  return result;
}

/** int.TryParse(s, NumberStyles.HexNumber, null): white space around up to eight hex digits. */
function tryParseHex(s: string): number | undefined {
  const isWhite = (c: number): boolean => c === 0x20 || (c >= 0x09 && c <= 0x0d);
  let i = 0;
  while (i < s.length && isWhite(s.charCodeAt(i))) i++;
  let value = 0;
  let digits = 0;
  let significant = 0;
  for (; i < s.length; i++) {
    const c = s.charCodeAt(i);
    const h = c >= 48 && c <= 57 ? c - 48 : c >= 65 && c <= 70 ? c - 55 : c >= 97 && c <= 102 ? c - 87 : -1;
    if (h < 0) break;
    digits++;
    if (significant > 0 || h !== 0) significant++;
    value = value * 16 + h;
  }
  if (digits === 0 || significant > 8) return undefined;
  while (i < s.length && isWhite(s.charCodeAt(i))) i++;
  for (; i < s.length; i++) if (s.charCodeAt(i) !== 0) return undefined;
  return value | 0;
}

interface NextCharacter {
  newChar: number;
  codeword: boolean;
}

/** The next character of the text compaction, with the escapes \ddd, \Cddd, \Xhh and \\. */
function getNextCharacter(code: string, next: NextCharacter, pos: { value: number }, codeLen: number, nfi: NumberFormatData): void {
  next.newChar = 0;
  next.codeword = false;
  const position = pos.value;
  if (position < codeLen) {
    if (charAt(code, position) === 92 && position + 1 < codeLen) {
      const nc = charAt(code, position + 1);
      if (nc >= 48 && nc <= 57) {
        const v = tryParseInt32(substringNet(code, position + 1, Math.min(3, codeLen - position - 1)), NumberStyles.Integer, nfi);
        next.newChar = v ?? 0;
        pos.value += 4;
      } else if (nc === 67 || nc === 99) {
        next.codeword = true;
        const v = tryParseInt32(substringNet(code, position + 2, Math.min(3, codeLen - position - 2)), NumberStyles.Integer, nfi);
        next.newChar = v ?? 0;
        pos.value += 5;
      } else if (nc === 71 || nc === 103) {
        // C# parity: the number is parsed from the G itself, so it never parses: no character is read
        const v = tryParseInt32(substringNet(code, position + 1, Math.min(6, codeLen - position - 1)), NumberStyles.Integer, nfi);
        if (v !== undefined) {
          pos.value += 8;
          next.codeword = true;
          next.newChar = v;
        }
      } else if (nc === 88 || nc === 120) {
        const v = tryParseHex(substringNet(code, position + 2, 2));
        next.newChar = v ?? 0;
        pos.value += 4;
      } else if (nc === 92) {
        next.newChar = charAt(code, position);
        pos.value += 2;
      } else {
        next.newChar = charAt(code, position);
        pos.value++;
      }
    } else {
      next.newChar = charAt(code, position);
      pos.value++;
    }
  }
}

function encodeText(code: string, w: CodewordWriter, pos: { value: number }, codeLen: number, nfi: NumberFormatData): void {
  w.newTextCodeword = true;
  let currentTextSubmode = TextMode.Alpha;
  let curValue = -1;
  let curMode: number = TextMode.None;
  let done = false;
  const next: NextCharacter = { newChar: 0, codeword: false };
  // getNextCharacter counts from 0
  const pos0 = { value: 0 };
  while (pos.value <= codeLen && !done) {
    const oldPosition = pos.value;
    pos0.value = pos.value - 1;
    getNextCharacter(code, next, pos0, codeLen, nfi);
    pos.value = pos0.value + 1;
    const newChar = next.newChar;
    const isCodeword = next.codeword;
    let validtext = false;
    if (newChar <= 127) validtext = textValue(newChar) >= 0;
    if (!validtext && !isCodeword) {
      // Back to the character the text compaction cannot write (Delphi goes back two, and the
      // character before it is written again)
      pos.value = oldPosition;
      break;
    } else if (!isCodeword) {
      curValue = textValue(newChar);
      curMode = textMode(newChar);
    }
    if (isCodeword) {
      if (!w.newTextCodeword) w.text(29);
      w.newTextCodeword = true;
      w.add(newChar);
    } else {
      if ((currentTextSubmode & curMode) === 0) {
        // A shift when the submode goes on, a latch when it does not: Delphi asks the character
        // after the next one (Code[Position + 1], with Position already at the next one)
        let useShift = true;
        if (pos.value < codeLen) {
          const after = at(code, pos.value + 1);
          useShift = after <= 127 && (currentTextSubmode & textMode(after)) !== 0;
        }
        currentTextSubmode = changeTextSubmode(currentTextSubmode, selectBestTextMode(curMode), useShift, w);
      }
      w.text(curValue);
    }
    if (goodForNumericCompaction(code, pos.value, codeLen)) done = true;
  }
  if (!w.newTextCodeword) w.text(29);
}

/** CalculateSize: the columns (xSize) and rows (ySize) of the symbol. */
function calculateSize(numCodewords: number, errorLevel: number, inNumRows: number, inNumCols: number): { xSize: number; ySize: number } {
  const numErrorCodewords = castInt32(Math.pow(2, errorLevel + 1));
  let xSize = inNumCols;
  let ySize = inNumRows;
  if (inNumRows <= 0 || inNumCols <= 0) {
    if (inNumRows > 0) {
      let i = 1;
      while (i <= 30) {
        if (i32(Math.imul(i, inNumRows) - numErrorCodewords) > numCodewords) break;
        i++;
      }
      xSize = i;
    } else if (inNumCols > 0) {
      let i = 3;
      while (i <= 90) {
        if (i32(Math.imul(i, inNumCols) - numErrorCodewords) > numCodewords) break;
        i++;
      }
      ySize = i;
    } else {
      let i = 1;
      let j = 3;
      while (i32(i * j - numErrorCodewords) < numCodewords) {
        if (j < 90) j++;
        if (i < 30 && i32(i * j - numErrorCodewords) < numCodewords) i++;
        if (j >= 90 && i >= 30) break;
      }
      xSize = i;
      ySize = j;
    }
  }
  return { xSize, ySize };
}

/** The Reed-Solomon error correction codewords of codewords[0..numCodewords). */
function calculateECC(codewords: number[], numCodewords: number, eccLen: number): void {
  const baseReg: number[] = new Array<number>(800).fill(0);
  const coeffReg: number[] = new Array<number>(800).fill(0);
  if (eccLen < 128) {
    const row = ST_MODS[eccLen];
    if (row === undefined && eccLen > 0) throw indexOutOfRange();
    for (let i = 0; i < eccLen; i++) seti(coeffReg, i, geti(row!, i));
  } else if (eccLen === 128) {
    for (let i = 0; i < eccLen; i++) seti(coeffReg, i, geti(ST_MODS_128, i));
  } else if (eccLen === 256) {
    for (let i = 0; i < eccLen; i++) seti(coeffReg, i, geti(ST_MODS_256, i));
  } else if (eccLen === 512) {
    for (let i = 0; i < eccLen; i++) seti(coeffReg, i, geti(ST_MODS_512, i));
  }
  for (let i = 0; i < eccLen; i++) seti(baseReg, i, 0);
  for (let i = numCodewords; i < i32(numCodewords + eccLen); i++) seti(codewords, i, 0);
  for (let i = 0; i < numCodewords; i++) {
    const wrap = (geti(baseReg, eccLen - 1) + geti(codewords, i)) % 929;
    for (let j = eccLen - 1; j >= 1; j--) {
      let temp = (geti(coeffReg, eccLen - 1 - j) * wrap) % 929;
      temp = (929 - temp) % 929;
      seti(baseReg, j, (geti(baseReg, j - 1) + temp) % 929);
    }
    let temp0 = (geti(coeffReg, eccLen - 1) * wrap) % 929;
    temp0 = (929 - temp0) % 929;
    seti(baseReg, 0, temp0);
  }
  for (let j = 0; j < eccLen; j++) seti(baseReg, j, (929 - geti(baseReg, j)) % 929);
  for (let j = 0; j < eccLen; j++) seti(codewords, numCodewords + j, geti(baseReg, eccLen - 1 - j));
}

/** The codewords of the symbol (data, padding and error correction) and its size. */
export interface Pdf417Codewords {
  codewords: number[];
  xSize: number;
  ySize: number;
  numCodewords: number;
  numErrorCodewords: number;
}

export function generateCodewords(text: string, eccLevelIn: number, numRowsIn: number, numColsIn: number, nfi: NumberFormatData): Pdf417Codewords {
  const codewords: number[] = new Array<number>(2701).fill(0);
  const numCodewords = textToCodewords(toAnsi(text), codewords, nfi);
  const errorLevel = getRealErrorLevel(numRowsIn, numColsIn, eccLevelIn, numCodewords);
  const numErrorCodewords = castInt32(Math.pow(2, errorLevel + 1));
  const { xSize, ySize } = calculateSize(numCodewords, errorLevel, numRowsIn, numColsIn);
  const cells = Math.imul(xSize, ySize);
  const padded = i32(numCodewords + i32(i32(cells - numCodewords) - numErrorCodewords));
  if (padded < 0) throw new Error('Barcode code too large');
  seti(codewords, 0, padded);
  if (i32(numErrorCodewords + numCodewords) <= cells) calculateECC(codewords, i32(cells - numErrorCodewords), numErrorCodewords);
  else throw new Error('Barcode code too large');
  return { codewords, xSize, ySize, numCodewords, numErrorCodewords };
}

function codewordToBitmask(rowNumber: number, codeword: number): number {
  if (codeword < 0 || codeword > 929) throw new Error('Invalid codeword');
  return geti(SPDF417_CODEWORDS[imod(rowNumber, 3)]!, codeword);
}

/** Where the drawing goes: the origin, the module, the colour and the rotation. */
interface Pdf417Canvas {
  meta: MetaFile;
  fLeft: number;
  fTop: number;
  modul: number;
  bColor: number;
  rotation: number;
}

function columnPosition(colNumber: number, modul: number): number {
  return Math.imul(Math.imul(colNumber, SPDF417_CELL_WIDTH), modul);
}

/** A bar: the rectangle from a to c, rotated around the origin (its corners, not its bounds). */
function drawBar(cv: Pdf417Canvas, a: IntPoint, c: IntPoint): void {
  const alpha = ((cv.rotation / 10.0) * Math.PI) / 180.0;
  const sinus = Math.sin(alpha);
  const cosinus = Math.cos(alpha);
  const ta: IntPoint = {
    x: i32(cv.fLeft + castInt32(mathRound(a.x * cosinus + a.y * sinus))),
    y: i32(cv.fTop + castInt32(mathRound(-a.x * sinus + a.y * cosinus))),
  };
  const tc: IntPoint = {
    x: i32(cv.fLeft + castInt32(mathRound(c.x * cosinus + c.y * sinus))),
    y: i32(cv.fTop + castInt32(mathRound(-c.x * sinus + c.y * cosinus))),
  };
  const metaobj = new MetaObjectDraw();
  metaobj.metaType = MetaObjectType.Draw;
  metaobj.top = ta.y;
  metaobj.left = ta.x;
  // C# parity: the width and height of a rotated bar are those of its rotated diagonal (they
  // may be negative)
  metaobj.width = i32(tc.x - ta.x);
  metaobj.height = i32(tc.y - ta.y);
  metaobj.drawStyle = ShapeType.Rectangle;
  metaobj.brushStyle = BrushType.Solid;
  // C# parity: the PDF417 bars are stroked too (PenType.Solid), unlike the 1D bars and the QR
  metaobj.penStyle = PenType.Solid;
  metaobj.penWidth = 0;
  metaobj.penColor = cv.bColor;
  metaobj.brushColor = cv.bColor;
  cv.meta.pages.get(cv.meta.currentPage).objects.push(metaobj);
}

function drawCodewordBitmask(cv: Pdf417Canvas, rowNumber: number, colNumber: number, workBarHeight: number, bitmask: number): void {
  const modul = cv.modul;
  for (let i = 16; i >= 0; i--) {
    if (((bitmask >>> i) & 1) !== 0) {
      const aleft = i32(Math.imul(16 - i, modul) + columnPosition(colNumber, modul));
      const atop = Math.imul(rowNumber, workBarHeight);
      const awidth = modul;
      const aheight = i32(workBarHeight + 1);
      drawBar(cv, { x: aleft, y: atop }, { x: i32(aleft + awidth), y: i32(atop + aheight) });
    }
  }
}

function drawCodeword(cv: Pdf417Canvas, rowNumber: number, colNumber: number, workBarHeight: number, pattern: string): void {
  const modul = cv.modul;
  let curPos = 0;
  let drawBlock = true;
  for (let i = 0; i < pattern.length; i++) {
    const newPos = Math.imul(pattern.charCodeAt(i) - 48, modul);
    if (drawBlock) {
      const aleft = i32(curPos + columnPosition(colNumber, modul));
      const atop = Math.imul(rowNumber, workBarHeight);
      const awidth = newPos;
      const aheight = i32(workBarHeight + 1);
      drawBar(cv, { x: aleft, y: atop }, { x: i32(aleft + awidth), y: i32(atop + aheight) });
    }
    curPos = i32(curPos + newPos);
    drawBlock = !drawBlock;
  }
}

function drawStartPattern(cv: Pdf417Canvas, rowNumber: number, workBarHeight: number): void {
  drawCodeword(cv, rowNumber, 0, workBarHeight, '81111113');
}

function drawStopPattern(cv: Pdf417Canvas, rowNumber: number, colNumber: number, workBarHeight: number, truncated: boolean): void {
  if (truncated) drawCodeword(cv, rowNumber, colNumber, workBarHeight, '1');
  else drawCodeword(cv, rowNumber, colNumber, workBarHeight, '711311121');
}

function drawLeftRowIndicator(cv: Pdf417Canvas, rowNumber: number, workBarHeight: number, numRows: number, numCols: number, errorLevel: number): void {
  let codeword = 0;
  const base = Math.imul(idiv(rowNumber, 3), 30);
  if (imod(rowNumber, 3) === 0) codeword = i32(base + idiv(numRows - 1, 3));
  else if (imod(rowNumber, 3) === 1) codeword = i32(base + imod(numRows - 1, 3) + Math.imul(3, errorLevel));
  else if (imod(rowNumber, 3) === 2) codeword = i32(base + (numCols - 1));
  drawCodewordBitmask(cv, rowNumber, 1, workBarHeight, codewordToBitmask(rowNumber, codeword));
}

function drawRightRowIndicator(
  cv: Pdf417Canvas,
  rowNumber: number,
  colNumber: number,
  workBarHeight: number,
  numRows: number,
  numCols: number,
  errorLevel: number,
): void {
  let codeword = 0;
  const base = Math.imul(idiv(rowNumber, 3), 30);
  if (imod(rowNumber, 3) === 0) codeword = i32(base + (numCols - 1));
  else if (imod(rowNumber, 3) === 1) codeword = i32(base + idiv(numRows - 1, 3));
  else if (imod(rowNumber, 3) === 2) codeword = i32(base + imod(numRows - 1, 3) + Math.imul(3, errorLevel));
  drawCodewordBitmask(cv, rowNumber, colNumber, workBarHeight, codewordToBitmask(rowNumber, codeword));
}

/** Draw2DBarcode: the PDF417 symbol of a text into the current page of the metafile. */
export function draw2DBarcode(
  currentText: string,
  eccLevel: number,
  numRows: number,
  numColumns: number,
  truncated: boolean,
  modul: number,
  fLeft: number,
  fTop: number,
  height: number,
  meta: MetaFile,
  bColor: number,
  rotation: number,
  nfi: NumberFormatData,
): void {
  const { codewords, xSize, ySize, numCodewords, numErrorCodewords } = generateCodewords(currentText, eccLevel, numRows, numColumns, nfi);
  const cv: Pdf417Canvas = { meta, fLeft, fTop, modul, bColor, rotation };
  let codewordPos = 1;
  const workBarHeight = idiv(height, ySize);
  const errorLevel = getRealErrorLevel(numRows, numColumns, eccLevel, numCodewords);
  const cells = Math.imul(xSize, ySize);
  for (let i = 0; i < ySize; i++) {
    drawStartPattern(cv, i, workBarHeight);
    drawLeftRowIndicator(cv, i, workBarHeight, ySize, xSize, errorLevel);
    for (let j = 0; j < xSize; j++) {
      if (i === 0 && j === 0) {
        drawCodewordBitmask(cv, i, j + 2, workBarHeight, codewordToBitmask(i, geti(codewords, 0)));
      } else if (codewordPos < numCodewords) {
        drawCodewordBitmask(cv, i, j + 2, workBarHeight, codewordToBitmask(i, geti(codewords, codewordPos)));
        codewordPos++;
      } else if (codewordPos >= i32(cells - numErrorCodewords)) {
        drawCodewordBitmask(cv, i, j + 2, workBarHeight, codewordToBitmask(i, geti(codewords, codewordPos)));
        codewordPos++;
      } else {
        drawCodewordBitmask(cv, i, j + 2, workBarHeight, codewordToBitmask(i, 900));
        codewordPos++;
      }
    }
    if (truncated) {
      drawStopPattern(cv, i, xSize + 2, workBarHeight, true);
    } else {
      drawRightRowIndicator(cv, i, xSize + 2, workBarHeight, ySize, xSize, errorLevel);
      drawStopPattern(cv, i, xSize + 3, workBarHeight, false);
    }
  }
}
