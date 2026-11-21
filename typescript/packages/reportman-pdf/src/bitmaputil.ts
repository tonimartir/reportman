// Port of Reportman.Drawing.BitmapUtil: the JPEG probe (the size in its SOF marker) and the BMP
// reader that turns the pixels of a Windows bitmap into the form a PDF image takes (RGB rows top
// down, an indexed palette, a colour key mask or the alpha channel as a soft mask).

/** A C# exception of the bitmap reader (UnNamedException and the runtime errors it lets through). */
export class BitmapFormatError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'BitmapFormatError';
  }
}

/** new byte[negative] (OverflowException). */
const OVERFLOW = 'Arithmetic operation resulted in an overflow.';
/** An index past the end of a byte array (IndexOutOfRangeException). */
const OUT_OF_RANGE = 'Index was outside the bounds of the array.';

/** A read-only MemoryStream over bytes: Read copies what is left, Seek may go past the end. */
export class ByteStream {
  position = 0;
  constructor(readonly data: Uint8Array) {}

  get length(): number {
    return this.data.length;
  }

  /** Stream.Read looped until count bytes or the end (BitmapUtil.ReadFull). */
  read(buffer: Uint8Array, offset: number, count: number): number {
    if (count <= 0) return 0;
    const available = Math.max(0, Math.min(count, this.data.length - this.position));
    if (available > 0) buffer.set(this.data.subarray(this.position, this.position + available), offset);
    this.position += available;
    return available;
  }

  seek(position: number): void {
    this.position = position;
  }
}

function newBytes(size: number): Uint8Array {
  if (size < 0) throw new BitmapFormatError(OVERFLOW);
  return new Uint8Array(size);
}

function byteAt(buf: Uint8Array, index: number): number {
  if (index < 0 || index >= buf.length) throw new BitmapFormatError(OUT_OF_RANGE);
  return buf[index] as number;
}

/** StreamUtil.ByteArrayToUInt / ByteArrayToInt with 4 bytes, little endian. */
function int32At(buf: Uint8Array, index: number): number {
  return (byteAt(buf, index) | (byteAt(buf, index + 1) << 8) | (byteAt(buf, index + 2) << 16) | (byteAt(buf, index + 3) << 24)) | 0;
}

function uint16At(buf: Uint8Array, index: number): number {
  return byteAt(buf, index) | (byteAt(buf, index + 1) << 8);
}

/** An int as uppercase hexadecimal padded to six digits (ToString("X").PadLeft(6, '0')). */
function hex6(value: number): string {
  return value.toString(16).toUpperCase().padStart(6, '0');
}

/** C# Math.Round (to even) of a value that is never a half: x/31*255 and x/63*255. */
function roundComponent(value: number): number {
  return Math.round(value) & 0xff;
}

// JPEG markers
const M_SOF0 = 0xc0;
const M_SOF1 = 0xc1;
const M_SOF2 = 0xc2;
const M_SOF3 = 0xc3;
const M_SOF5 = 0xc5;
const M_SOF6 = 0xc6;
const M_SOF7 = 0xc7;
const M_SOF9 = 0xc9;
const M_SOF10 = 0xca;
const M_SOF11 = 0xcb;
const M_SOF13 = 0xcd;
const M_SOF14 = 0xce;
const M_SOF15 = 0xcf;
const M_SOI = 0xd8;
const M_EOI = 0xd9;
const M_SOS = 0xda;

const INVALID_JPEG = 'Invalid JPEG';

function nextMarker(s: ByteStream): number {
  const c1 = new Uint8Array(2);
  // Find 0xFF byte; count and skip any non-FFs
  if (s.read(c1, 0, 1) < 1) throw new BitmapFormatError(INVALID_JPEG);
  while (c1[0] !== 0xff) {
    if (s.read(c1, 0, 1) < 1) throw new BitmapFormatError(INVALID_JPEG);
  }
  // Get marker code byte, swallowing any duplicate FF bytes (pad bytes)
  do {
    if (s.read(c1, 0, 1) < 1) throw new BitmapFormatError(INVALID_JPEG);
  } while (c1[0] === 0xff);
  return c1[0] as number;
}

// Skip over an unknown or uninteresting variable-length marker
function skipVariable(s: ByteStream): void {
  const c1 = new Uint8Array(2);
  if (s.read(c1, 0, 2) < 2) throw new BitmapFormatError(INVALID_JPEG);
  let alength = (c1[1] as number) + ((c1[0] as number) << 8);
  // Length includes itself, so must be at least 2
  if (alength < 2) throw new BitmapFormatError(INVALID_JPEG);
  alength = alength - 2;
  const abuf = new Uint8Array(alength);
  if (s.read(abuf, 0, alength) < alength) throw new BitmapFormatError(INVALID_JPEG);
}

function processSOFn(s: ByteStream): { width: number; height: number } {
  const c1 = new Uint8Array(2);
  if (s.read(c1, 0, 2) < 2) throw new BitmapFormatError(INVALID_JPEG);
  // data_precission skiped
  if (s.read(c1, 0, 1) < 1) throw new BitmapFormatError(INVALID_JPEG);
  if (s.read(c1, 0, 2) < 2) throw new BitmapFormatError(INVALID_JPEG);
  const height = (c1[1] as number) + ((c1[0] as number) << 8);
  if (s.read(c1, 0, 2) < 2) throw new BitmapFormatError(INVALID_JPEG);
  const width = (c1[1] as number) + ((c1[0] as number) << 8);
  return { width, height };
}

/** What GetJPegInfo tells: a JPEG (FF D8), and the size of its first frame. */
export interface JpegInfo {
  isJpeg: boolean;
  width: number;
  height: number;
}

/**
 * GetJPegInfo: true when the bytes start with FF D8, with the size of the first SOFn marker read
 * before the start of scan (0 x 0 when there is none). Fails with "Invalid JPEG" when the markers
 * end before a SOFn, SOS or EOI.
 */
export function getJpegInfo(data: Uint8Array): JpegInfo {
  const result: JpegInfo = { isJpeg: false, width: 0, height: 0 };
  const s = new ByteStream(data);
  const c1 = new Uint8Array(2);
  const c2 = new Uint8Array(2);
  if (s.read(c1, 0, 1) < 1) return result;
  if (c1[0] !== 0xff) return result;
  if (s.read(c2, 0, 1) < 1) return result;
  if (c2[0] !== M_SOI) return result;
  result.isJpeg = true;
  // Read segments until M_SOS
  let marker: number;
  do {
    marker = nextMarker(s);
    switch (marker) {
      case M_SOF0: // Baseline
      case M_SOF1: // Extended sequential, Huffman
      case M_SOF2: // Progressive, Huffman
      case M_SOF3: // Lossless, Huffman
      case M_SOF5: // Differential sequential, Huffman
      case M_SOF6: // Differential progressive, Huffman
      case M_SOF7: // Differential lossless, Huffman
      case M_SOF9: // Extended sequential, arithmetic
      case M_SOF10: // Progressive, arithmetic
      case M_SOF11: // Lossless, arithmetic
      case M_SOF13: // Differential sequential, arithmetic
      case M_SOF14: // Differential progressive, arithmetic
      case M_SOF15: {
        // Differential lossless, arithmetic
        const size = processSOFn(s);
        result.width = size.width;
        result.height = size.height;
        // Exit, no more info need
        marker = M_SOS;
        break;
      }
      default:
        skipVariable(s);
        break;
    }
  } while (marker !== M_SOS && marker !== M_EOI);
  return result;
}

/** What GetBitmapInfo gives (its return value and out parameters). */
export interface BitmapInfoResult {
  /** The bytes are a bitmap it read (the return value). */
  isBitmap: boolean;
  width: number;
  height: number;
  /** Size in bytes of the pixels it wrote. */
  imageSize: number;
  /** Paletized: the pixels are palette indexes. */
  indexed: boolean;
  bitsPerPixel: number;
  /** For indexed bitmaps, the highest palette index (the hival of a PDF /Indexed color space). */
  usedColors: number;
  /** For indexed bitmaps, the palette as a PDF hexadecimal string. */
  palette: string;
  /** The bytes start with GIF (they are left to the image decoder). */
  isGif: boolean;
  /** For indexed bitmaps, the color key /Mask of the palette entries with alpha 0 (or empty). */
  mask: string;
  /** The pixels in PDF form (MemBits), null when they were not asked for. */
  bits: Uint8Array | null;
  /** The soft mask (the alpha of a 32 bit bitmap), null when there is none or it was not asked for. */
  smask: Uint8Array | null;
}

/** A MemoryStream written at positions (MemBits): SetLength, Seek and Write. */
class BitsStream {
  buf = new Uint8Array(0);
  pos = 0;

  setLength(length: number): void {
    if (length < 0) throw new BitmapFormatError("Stream length must be non-negative and less than 2^31 - 1 - origin. (Parameter 'value')");
    const n = new Uint8Array(length);
    n.set(this.buf.subarray(0, Math.min(length, this.buf.length)));
    this.buf = n;
  }

  seek(position: number): void {
    this.pos = position;
  }

  write(src: Uint8Array, count: number): void {
    const end = this.pos + count;
    if (end > this.buf.length) {
      const n = new Uint8Array(end);
      n.set(this.buf);
      this.buf = n;
    }
    this.buf.set(src.subarray(0, count), this.pos);
    this.pos = end;
  }
}

/**
 * GetBitmapInfo: reads a Windows bitmap (BM). With wantBits it also converts its pixels: 1, 4 and
 * 8 bit bitmaps keep their indexes (rows of whole bytes, top down) with the palette as a PDF
 * string, and the palette entries with alpha 0 as a color key mask; 15, 16, 24 and 32 bit bitmaps
 * become RGB, and the fourth byte of a 32 bit bitmap its soft mask (wantMask).
 *
 * C# parity, kept as the C# code does it: the header of a core (OS/2 1.x) bitmap is read with
 * 32 bit fields; a header of less than 32 bytes but 15 or more fails reading biClrUsed; every
 * entry of a palette whose fourth byte is 0 (as most bitmaps write them) goes into the mask, its
 * ranges written without separators ("[ 0 01 1 ]"); a 32 bit bitmap always has a soft mask, its
 * fourth byte even when unused; a top down bitmap (negative height) fails; compression is
 * ignored; a short read of an indexed row keeps the bytes of the previous row.
 */
export function getBitmapInfo(data: Uint8Array, wantBits: boolean, wantMask: boolean): BitmapInfoResult {
  const r: BitmapInfoResult = {
    isBitmap: false,
    width: 0,
    height: 0,
    imageSize: 0,
    indexed: false,
    bitsPerPixel: 8,
    usedColors: 0,
    palette: '',
    isGif: false,
    mask: '',
    bits: null,
    smask: null,
  };
  const MAX_BITMAPHEADERSIZE = 32000;
  const astream = new ByteStream(data);
  let buf: Uint8Array = new Uint8Array(16);
  let iscoreheader = false;
  // Read the file header
  if (astream.read(buf, 0, 14) !== 14) return r;
  r.isGif = buf[0] === 0x47 && buf[1] === 0x49 && buf[2] === 0x46;
  if (r.isGif) return r;
  if (buf[0] !== 0x42 || buf[1] !== 0x4d) return r;
  const bfOffBits = int32At(buf, 10) >>> 0;
  // Read the size of bitmap info
  if (astream.read(buf, 0, 4) !== 4) return r;
  const bsize = int32At(buf, 0) >>> 0;
  if (bsize < 2 || bsize > MAX_BITMAPHEADERSIZE) return r;
  if (bsize < 15) iscoreheader = true;
  else buf = new Uint8Array(bsize + 1);
  // (int)(bsize - 4): negative for a size of 2 or 3, nothing is read
  const toreadHeader = (bsize - 4) | 0;
  if (astream.read(buf, 0, toreadHeader) !== toreadHeader) return r;
  let width: number;
  let height: number;
  let bitsperpixel: number;
  let usedcolors = 0;
  if (iscoreheader) {
    width = int32At(buf, 0);
    height = int32At(buf, 4);
    bitsperpixel = uint16At(buf, 10);
  } else {
    width = int32At(buf, 0);
    height = int32At(buf, 4);
    bitsperpixel = uint16At(buf, 10);
    const biClrUsed = int32At(buf, 28);
    if (bitsperpixel < 16) usedcolors = biClrUsed;
  }
  r.width = width;
  r.height = height;
  r.bitsPerPixel = bitsperpixel;
  r.usedColors = usedcolors;
  let imagesize = Math.imul(Math.imul(width, height), 3);
  r.imageSize = imagesize;
  if (!wantBits) {
    r.isBitmap = true;
    return r;
  }
  // Read color entries
  let numcolors: number;
  switch (bitsperpixel) {
    case 1:
      numcolors = 2;
      break;
    case 4:
      numcolors = 16;
      break;
    case 8:
      numcolors = 256;
      break;
    case 16:
    case 15:
    case 24:
    case 32:
      numcolors = 0;
      break;
    default:
      throw new BitmapFormatError('Bad bitcount in GetBitmapInfo');
  }
  let palette = '';
  let mask = '';
  if (numcolors > 0) {
    if (iscoreheader) {
      usedcolors = numcolors;
      const bufcolors = newBytes(usedcolors * 3);
      if (astream.read(bufcolors, 0, usedcolors * 3) !== usedcolors * 3) throw new BitmapFormatError('Invalid bitmap palette');
      for (let y = 0; y < usedcolors; y++) {
        const index = y * 3;
        const acolor = ((bufcolors[index + 2] as number) << 16) + ((bufcolors[index + 1] as number) << 8) + (bufcolors[index] as number);
        if (palette === '') palette = '<' + hex6(acolor);
        else palette = palette + ' ' + hex6(acolor);
      }
      if (usedcolors > 0) palette = palette + '>';
    } else {
      if (usedcolors === 0) usedcolors = numcolors;
      const size = Math.imul(usedcolors, 4);
      const bufcolors = newBytes(size);
      if (astream.read(bufcolors, 0, size) !== size) throw new BitmapFormatError('Invalid bitmap palette');
      for (let y = 0; y < usedcolors; y++) {
        const index = Math.imul(y, 4);
        const acolor = (byteAt(bufcolors, index + 2) << 16) + (byteAt(bufcolors, index + 1) << 8) + byteAt(bufcolors, index);
        if (palette === '') palette = '<' + hex6(acolor);
        else palette = palette + ' ' + hex6(acolor);
        // C# parity: the soft mask of an indexed bitmap (createIndexedSMap) is never written
        if (byteAt(bufcolors, index + 3) === 0) {
          if (mask === '') mask = '[ ';
          mask = mask + String(y) + ' ' + String(y);
        }
      }
      if (usedcolors > 0) palette = palette + '>';
      if (mask.length > 0) mask = mask + ' ]';
    }
  }
  r.palette = palette;
  r.mask = mask;
  r.usedColors = usedcolors;
  // Go to position bits
  astream.seek(bfOffBits);
  const membits = new BitsStream();
  let smask: Uint8Array | null = null;
  if (numcolors > 0) {
    let divider: number;
    switch (numcolors) {
      case 2:
        divider = 8;
        break;
      case 16:
        divider = 2;
        break;
      default:
        divider = 1;
        break;
    }
    let scanwidth = (width / divider) | 0;
    r.indexed = true;
    if (width % divider > 0) scanwidth = scanwidth + 1;
    // bitmap file format is aligned on double word, the alignment must be removed from datafile
    const origwidth = scanwidth;
    while (scanwidth % 4 > 0) scanwidth = scanwidth + 1;
    buf = newBytes(scanwidth);
    // The (unused) soft mask buffer of an indexed bitmap
    if (!iscoreheader && usedcolors > 0) newBytes(width);
    membits.setLength(Math.imul(height, origwidth));
    membits.seek(0);
    for (let y = height - 1; y >= 0; y--) {
      astream.read(buf, 0, scanwidth);
      membits.seek(Math.imul(y, origwidth));
      membits.write(buf, origwidth);
    }
    imagesize = membits.buf.length;
  } else {
    membits.setLength(imagesize);
    let scanwidth: number;
    let toread: number;
    let module: number;
    if (bitsperpixel === 32) {
      scanwidth = Math.imul(width, 4);
      toread = 0;
      module = 4;
    } else if (bitsperpixel === 16 || bitsperpixel === 15) {
      scanwidth = Math.imul(width, 2);
      // Align to 32 bit
      toread = 4 - (scanwidth % 4);
      if (toread === 4) toread = 0;
      module = 2;
    } else {
      scanwidth = Math.imul(width, 3);
      // Align to 32 bit
      toread = 4 - (scanwidth % 4);
      if (toread === 4) toread = 0;
      module = 3;
    }
    membits.seek(0);
    scanwidth = (scanwidth + toread) | 0;
    buf = newBytes(scanwidth);
    const linewidth = Math.imul(width, 3);
    const bufdest = newBytes(linewidth);
    let bufdestMask: Uint8Array | null = null;
    if (bitsperpixel > 24 && wantMask) bufdestMask = newBytes(Math.imul(width, height));
    for (let y = height - 1; y >= 0; y--) {
      if (astream.read(buf, 0, scanwidth) !== scanwidth) throw new BitmapFormatError('Bad bitmap stream');
      membits.seek(Math.imul(Math.imul(width, 3), y));
      if (bitsperpixel > 16) {
        for (let h = 0; h < width; h++) {
          bufdest[h * 3] = buf[module * h + 2] as number;
          bufdest[h * 3 + 1] = buf[module * h + 1] as number;
          bufdest[h * 3 + 2] = buf[module * h] as number;
          if (bufdestMask !== null) bufdestMask[y * width + h] = buf[module * h + 3] as number;
        }
      } else if (bitsperpixel === 15) {
        // 5-5-5
        for (let h = 0; h < width; h++) {
          const num = (buf[module * h] as number) | ((buf[module * h + 1] as number) << 8);
          const rcolor = roundComponent(((num & 0x1f) / 31) * 255);
          const gcolor = roundComponent((((num & 0x3ff) >> 5) / 31) * 255);
          const bcolor = roundComponent((((num & 0x7fff) >> 10) / 31) * 255);
          bufdest[h * 3] = bcolor;
          bufdest[h * 3 + 1] = gcolor;
          bufdest[h * 3 + 2] = rcolor;
        }
      } else {
        // 5-6-5
        for (let h = 0; h < width; h++) {
          const num = (buf[module * h] as number) | ((buf[module * h + 1] as number) << 8);
          const rcolor = roundComponent(((num & 0x1f) / 31) * 255);
          const gcolor = roundComponent((((num & 0x7ff) >> 5) / 63) * 255);
          const bcolor = roundComponent(((num >> 11) / 31) * 255);
          bufdest[h * 3] = bcolor;
          bufdest[h * 3 + 1] = gcolor;
          bufdest[h * 3 + 2] = rcolor;
        }
      }
      membits.write(bufdest, linewidth);
    }
    if (bufdestMask !== null) smask = bufdestMask;
  }
  r.imageSize = imagesize;
  r.bits = membits.buf;
  r.smask = smask !== null && smask.length > 0 ? smask : null;
  // Adobe PDF counts from 0 to usedcolors
  if (r.usedColors > 0) r.usedColors--;
  r.isBitmap = true;
  return r;
}
