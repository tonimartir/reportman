// The QR code matrix of a text, as the C# engine gets it from ZXing.Net 0.16.11
// (QRCodeWriter.encode(text, QR_CODE, 0, 0, hints)): the symbol with its quiet zone of four
// modules.
//
// It is the encoder of ZXing.Net (Encoder.encode, ported here) on the building blocks of
// @zxing/library, the TypeScript port of the same ZXing (modes, versions, the bit packing, the
// Reed-Solomon blocks and the matrix with its patterns), which give the same bits. Three parts of
// @zxing/library do not give what ZXing.Net 0.16.11 gives, and are the ZXing.Net ones here:
// - the byte mode: ZXing.Net writes the text in ISO-8859-1 (a code unit outside it as '?')
//   without an ECI segment; @zxing/library writes UTF-8;
// - the version: ZXing.Net rounds the bytes of the data down ((bits + 7) / 8 in integers);
//   @zxing/library does not, and takes a bigger version (or none: "Data too big") when the bits
//   are a few more than a whole number of bytes;
// - the mask: the penalty rule 3 of ZXing.Net counts a finder-like pattern only when its four
//   light modules are inside the symbol, and its rule 4 computes the dark ratio in doubles.

import {
  BitArray,
  QRCodeByteMatrix as ByteMatrix,
  QRCodeDecoderErrorCorrectionLevel as ErrorCorrectionLevel,
  QRCodeEncoder as Encoder,
  QRCodeMaskUtil as MaskUtil,
  QRCodeMatrixUtil as MatrixUtil,
  QRCodeMode as Mode,
  QRCodeVersion as Version,
  WriterException,
} from '@zxing/library';
import { argumentException } from '../../util/netexception.js';
import { castInt32 } from './netutil.js';

/** A QR matrix with its quiet zone: true for a dark module. */
export interface QrMatrix {
  readonly width: number;
  readonly height: number;
  get(x: number, y: number): boolean;
}

/** QRCodeWriter.QUIET_ZONE_SIZE. */
const QUIET_ZONE_SIZE = 4;

/**
 * The ISO-8859-1 bytes of ZXing.Net: a UTF-16 code unit above 0xFF is '?' (a surrogate pair is
 * "??", as golden-cs shows).
 */
export function latin1Bytes(text: string): Uint8Array {
  const bytes = new Uint8Array(text.length);
  for (let i = 0; i < text.length; i++) {
    const c = text.charCodeAt(i);
    bytes[i] = c <= 0xff ? c : 0x3f;
  }
  return bytes;
}

/**
 * The ZXing error correction level of the item's ECCLevel: 2 = L, 3 = M, 4 = Q, 5 = H; any other
 * value gives no hint, and ZXing uses L.
 */
function errorCorrectionLevel(eccLevel: number): ErrorCorrectionLevel {
  switch (eccLevel) {
    case 3:
      return ErrorCorrectionLevel.M;
    case 4:
      return ErrorCorrectionLevel.Q;
    case 5:
      return ErrorCorrectionLevel.H;
  }
  return ErrorCorrectionLevel.L;
}

/** Encoder.willFit: the bits fit in the data bytes of the version (integer bytes). */
function willFit(numInputBits: number, version: Version, ecLevel: ErrorCorrectionLevel): boolean {
  const numBytes = version.getTotalCodewords();
  const numEcBytes = version.getECBlocksForLevel(ecLevel).getTotalECCodewords();
  const numDataBytes = numBytes - numEcBytes;
  const totalInputBytes = Math.trunc((numInputBits + 7) / 8);
  return numDataBytes >= totalInputBytes;
}

function chooseVersion(numInputBits: number, ecLevel: ErrorCorrectionLevel): Version {
  for (let versionNum = 1; versionNum <= 40; versionNum++) {
    const version = Version.getVersionForNumber(versionNum);
    if (willFit(numInputBits, version, ecLevel)) return version;
  }
  throw new WriterException('Data too big');
}

function calculateBitsNeeded(mode: Mode, headerBits: BitArray, dataBits: BitArray, version: Version): number {
  return headerBits.getSize() + mode.getCharacterCountBits(version) + dataBits.getSize();
}

/** Encoder.recommendVersion: a guess with the count bits of version 1, then the real one. */
function recommendVersion(ecLevel: ErrorCorrectionLevel, mode: Mode, headerBits: BitArray, dataBits: BitArray): Version {
  const provisionalBitsNeeded = calculateBitsNeeded(mode, headerBits, dataBits, Version.getVersionForNumber(1));
  const provisionalVersion = chooseVersion(provisionalBitsNeeded, ecLevel);
  const bitsNeeded = calculateBitsNeeded(mode, headerBits, dataBits, provisionalVersion);
  return chooseVersion(bitsNeeded, ecLevel);
}

/**
 * MaskUtil.applyMaskPenaltyRule3 of ZXing.Net: a 1:1:3:1:1 pattern with four light modules
 * before or after it, inside the symbol.
 */
function maskPenaltyRule3(matrix: ByteMatrix): number {
  let numPenalties = 0;
  const array = matrix.getArray();
  const width = matrix.getWidth();
  const height = matrix.getHeight();
  const whiteHorizontal = (row: Uint8Array, from: number, to: number): boolean => {
    if (from < 0 || row.length < to) return false;
    for (let i = from; i < to; i++) if (row[i] === 1) return false;
    return true;
  };
  const whiteVertical = (col: number, from: number, to: number): boolean => {
    if (from < 0 || array.length < to) return false;
    for (let i = from; i < to; i++) if (array[i]![col] === 1) return false;
    return true;
  };
  for (let y = 0; y < height; y++) {
    const arrayY = array[y]!;
    for (let x = 0; x < width; x++) {
      if (
        x + 6 < width &&
        arrayY[x] === 1 &&
        arrayY[x + 1] === 0 &&
        arrayY[x + 2] === 1 &&
        arrayY[x + 3] === 1 &&
        arrayY[x + 4] === 1 &&
        arrayY[x + 5] === 0 &&
        arrayY[x + 6] === 1 &&
        (whiteHorizontal(arrayY, x - 4, x) || whiteHorizontal(arrayY, x + 7, x + 11))
      )
        numPenalties++;
      if (
        y + 6 < height &&
        array[y]![x] === 1 &&
        array[y + 1]![x] === 0 &&
        array[y + 2]![x] === 1 &&
        array[y + 3]![x] === 1 &&
        array[y + 4]![x] === 1 &&
        array[y + 5]![x] === 0 &&
        array[y + 6]![x] === 1 &&
        (whiteVertical(x, y - 4, y) || whiteVertical(x, y + 7, y + 11))
      )
        numPenalties++;
    }
  }
  return numPenalties * 40;
}

/** MaskUtil.applyMaskPenaltyRule4 of ZXing.Net: 10 for each 5 % of distance from half dark. */
function maskPenaltyRule4(matrix: ByteMatrix): number {
  let numDarkCells = 0;
  const array = matrix.getArray();
  const width = matrix.getWidth();
  const height = matrix.getHeight();
  for (let y = 0; y < height; y++) {
    const arrayY = array[y]!;
    for (let x = 0; x < width; x++) if (arrayY[x] === 1) numDarkCells++;
  }
  const numTotalCells = height * width;
  const darkRatio = numDarkCells / numTotalCells;
  const fivePercentVariances = castInt32(Math.abs(darkRatio - 0.5) * 20.0);
  return fivePercentVariances * 10;
}

function calculateMaskPenalty(matrix: ByteMatrix): number {
  return MaskUtil.applyMaskPenaltyRule1(matrix) + MaskUtil.applyMaskPenaltyRule2(matrix) + maskPenaltyRule3(matrix) + maskPenaltyRule4(matrix);
}

function chooseMaskPattern(bits: BitArray, ecLevel: ErrorCorrectionLevel, version: Version, matrix: ByteMatrix): number {
  let minPenalty = 2147483647; // Lower penalty is better.
  let bestMaskPattern = -1;
  // We try all mask patterns to choose the best one.
  for (let maskPattern = 0; maskPattern < 8; maskPattern++) {
    MatrixUtil.buildMatrix(bits, ecLevel, version, maskPattern, matrix);
    const penalty = calculateMaskPenalty(matrix);
    if (penalty < minPenalty) {
      minPenalty = penalty;
      bestMaskPattern = maskPattern;
    }
  }
  return bestMaskPattern;
}

/** Encoder.encode of ZXing.Net with no character set: the matrix of the symbol. */
function encode(content: string, ecLevel: ErrorCorrectionLevel): ByteMatrix {
  // The default byte mode encoding, ISO-8859-1, writes no ECI segment
  const mode = Encoder.chooseMode(content, 'ISO-8859-1');
  const headerBits = new BitArray();
  Encoder.appendModeInfo(mode, headerBits);
  const dataBits = new BitArray();
  if (mode === Mode.BYTE) for (const b of latin1Bytes(content)) dataBits.appendBits(b, 8);
  else Encoder.appendBytes(content, mode, dataBits, 'ISO-8859-1');
  const version = recommendVersion(ecLevel, mode, headerBits, dataBits);
  const headerAndDataBits = new BitArray();
  headerAndDataBits.appendBitArray(headerBits);
  const numLetters = mode === Mode.BYTE ? dataBits.getSizeInBytes() : content.length;
  Encoder.appendLengthInfo(numLetters, version, mode, headerAndDataBits);
  headerAndDataBits.appendBitArray(dataBits);
  const ecBlocks = version.getECBlocksForLevel(ecLevel);
  const numDataBytes = version.getTotalCodewords() - ecBlocks.getTotalECCodewords();
  Encoder.terminateBits(numDataBytes, headerAndDataBits);
  const finalBits = Encoder.interleaveWithECBytes(headerAndDataBits, version.getTotalCodewords(), numDataBytes, ecBlocks.getNumBlocks());
  const dimension = version.getDimensionForVersion();
  const matrix = new ByteMatrix(dimension, dimension);
  const maskPattern = chooseMaskPattern(finalBits, ecLevel, version, matrix);
  MatrixUtil.buildMatrix(finalBits, ecLevel, version, maskPattern, matrix);
  return matrix;
}

/** QRCodeWriter.encode(text, QR_CODE, 0, 0, hints) of ZXing.Net 0.16.11, at the item's level. */
export function qrMatrix(text: string, eccLevel: number): QrMatrix {
  // C# parity: ArgumentException("Found empty contents", contents) has an empty parameter name
  if (text.length === 0) throw argumentException('Found empty contents');
  const input = encode(text, errorCorrectionLevel(eccLevel));
  // renderResult with no size: one module per pixel and the quiet zone around
  const inputWidth = input.getWidth();
  const inputHeight = input.getHeight();
  const width = inputWidth + QUIET_ZONE_SIZE * 2;
  const height = inputHeight + QUIET_ZONE_SIZE * 2;
  return {
    width,
    height,
    get(x: number, y: number): boolean {
      const ix = x - QUIET_ZONE_SIZE;
      const iy = y - QUIET_ZONE_SIZE;
      return ix >= 0 && iy >= 0 && ix < inputWidth && iy < inputHeight && input.get(ix, iy) === 1;
    },
  };
}
