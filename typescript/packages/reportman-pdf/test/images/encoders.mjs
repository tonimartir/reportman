// Small image encoders for the image parity fixtures: PNG (every color type and bit depth,
// palettes, tRNS, sBIT and other chunks, the five row filters, Adam7 interlacing), GIF (LZW with
// frequent clear codes, extensions, local palettes, interlacing) and Windows bitmaps.

import zlib from 'node:zlib';

const CRC = new Int32Array(256);
for (let n = 0; n < 256; n++) {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  CRC[n] = c;
}

export function crc32(buf) {
  let c = -1;
  for (const b of buf) c = CRC[(c ^ b) & 255] ^ (c >>> 8);
  return (c ^ -1) >>> 0;
}

export function pngChunk(type, data) {
  const out = Buffer.alloc(12 + data.length);
  out.writeUInt32BE(data.length, 0);
  out.write(type, 4, 'latin1');
  Buffer.from(data).copy(out, 8);
  out.writeUInt32BE(crc32(out.subarray(4, 8 + data.length)), 8 + data.length);
  return out;
}

const CHANNELS = { 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 };
const PASSES = [
  [0, 0, 8, 8],
  [4, 0, 8, 8],
  [0, 4, 4, 8],
  [2, 0, 4, 4],
  [0, 2, 2, 4],
  [1, 0, 2, 2],
  [0, 1, 1, 2],
];

/**
 * A PNG of w x h pixels; samples(x, y) gives the samples of a pixel at the bit depth.
 * Options: plte, trns (bytes), interlace, filters (cycle the five filter types by row), before
 * (chunks before PLTE), after (chunks after the image data), idatSplit (bytes per IDAT chunk).
 */
export function png(w, h, colorType, bitDepth, samples, o = {}) {
  const ch = CHANNELS[colorType];
  const bpp = ch * bitDepth;
  const fbpp = Math.max(1, bpp >> 3);
  const raw = [];
  let rowIndex = 0;
  for (const [x0, y0, dx, dy] of o.interlace ? PASSES : [[0, 0, 1, 1]]) {
    const pw = Math.ceil((w - x0) / dx);
    const ph = Math.ceil((h - y0) / dy);
    if (pw <= 0 || ph <= 0) continue;
    let prior = null;
    for (let py = 0; py < ph; py++) {
      const row = Buffer.alloc(Math.ceil((pw * bpp) / 8));
      let bit = 0;
      for (let px = 0; px < pw; px++) {
        const s = samples(x0 + px * dx, y0 + py * dy);
        for (let c = 0; c < ch; c++) {
          const v = s[c];
          if (bitDepth === 16) {
            row[bit >> 3] = v >> 8;
            row[(bit >> 3) + 1] = v & 255;
          } else if (bitDepth === 8) row[bit >> 3] = v;
          else row[bit >> 3] |= v << (8 - bitDepth - (bit & 7));
          bit += bitDepth;
        }
      }
      const ft = o.badFilter && rowIndex === 0 ? (rowIndex++, 0) : o.filters ? rowIndex++ % 5 : 0;
      const f = Buffer.alloc(row.length);
      for (let i = 0; i < row.length; i++) {
        const a = i >= fbpp ? row[i - fbpp] : 0;
        const b = prior ? prior[i] : 0;
        const c = i >= fbpp && prior ? prior[i - fbpp] : 0;
        let pr = 0;
        if (ft === 1) pr = a;
        else if (ft === 2) pr = b;
        else if (ft === 3) pr = (a + b) >> 1;
        else if (ft === 4) {
          const p = a + b - c;
          const pa = Math.abs(p - a);
          const pb = Math.abs(p - b);
          const pc = Math.abs(p - c);
          pr = pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
        }
        f[i] = (row[i] - pr) & 255;
      }
      raw.push(Buffer.from([o.badFilter && raw.length === 0 ? 7 : ft]), f);
      prior = row;
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr[8] = bitDepth;
  ihdr[9] = colorType;
  ihdr[12] = o.interlace ? 1 : 0;
  const parts = [Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), pngChunk('IHDR', ihdr)];
  for (const [t, d] of o.before ?? []) parts.push(pngChunk(t, d));
  if (o.plte) parts.push(pngChunk('PLTE', Buffer.from(o.plte)));
  if (o.trns) parts.push(pngChunk('tRNS', Buffer.from(o.trns)));
  const z = zlib.deflateSync(Buffer.concat(raw), { level: 9 });
  const split = o.idatSplit ?? z.length;
  for (let i = 0; i < z.length; i += split) parts.push(pngChunk('IDAT', z.subarray(i, i + split)));
  for (const [t, d] of o.after ?? []) parts.push(pngChunk(t, d));
  parts.push(pngChunk('IEND', Buffer.alloc(0)));
  return Buffer.concat(parts);
}

/** GIF LZW with a clear code before the table grows, so the code size stays the literal width + 1. */
export function gifLzw(indices, minCodeSize) {
  const clear = 1 << minCodeSize;
  const eoi = clear + 1;
  const codeSize = minCodeSize + 1;
  const out = [];
  let cur = 0;
  let nbits = 0;
  const emit = (code) => {
    cur |= code << nbits;
    nbits += codeSize;
    while (nbits >= 8) {
      out.push(cur & 255);
      cur >>>= 8;
      nbits -= 8;
    }
  };
  emit(clear);
  let count = 0;
  const maxBeforeClear = (1 << codeSize) - clear - 2;
  for (const ix of indices) {
    emit(ix);
    count++;
    if (count >= maxBeforeClear) {
      emit(clear);
      count = 0;
    }
  }
  emit(eoi);
  if (nbits > 0) out.push(cur & 255);
  return out;
}

/** A GIF LZW stream that lets the table grow to 12 bits (standard encoder, no clear until full). */
export function gifLzwGrowing(indices, minCodeSize) {
  const clear = 1 << minCodeSize;
  const eoi = clear + 1;
  let codeSize = minCodeSize + 1;
  let next = eoi + 1;
  const dict = new Map();
  const out = [];
  let cur = 0;
  let nbits = 0;
  const emit = (code) => {
    cur |= code << nbits;
    nbits += codeSize;
    while (nbits >= 8) {
      out.push(cur & 255);
      cur >>>= 8;
      nbits -= 8;
    }
  };
  emit(clear);
  let w = String(indices[0]);
  for (let i = 1; i < indices.length; i++) {
    const k = indices[i];
    const wk = w + ',' + k;
    if (dict.has(wk)) {
      w = wk;
      continue;
    }
    emit(w.includes(',') ? dict.get(w) : Number(w));
    if (next < 4096) {
      dict.set(wk, next++);
      if (next > 1 << codeSize && codeSize < 12) codeSize++;
    }
    w = String(k);
  }
  emit(w.includes(',') ? dict.get(w) : Number(w));
  emit(eoi);
  if (nbits > 0) out.push(cur & 255);
  return out;
}

function subBlocks(bytes) {
  const o = [];
  for (let i = 0; i < bytes.length; i += 255) {
    const s = bytes.slice(i, i + 255);
    o.push(s.length, ...s);
  }
  o.push(0);
  return o;
}

const le16 = (v) => [v & 255, v >> 8];
const tableBits = (n) => {
  let b = 0;
  while (2 << b < n) b++;
  return b;
};

/** A GIF: a logical screen with a global palette and frames (x, y, w, h, indices...). */
export function gif({ w, h, global, bg = 0, frames, trailer = true, version = 'GIF89a', comment }) {
  const o = [...Buffer.from(version), ...le16(w), ...le16(h)];
  if (global) {
    const b = tableBits(global.length);
    o.push(0x80 | (7 << 4) | b, bg, 0);
    for (let i = 0; i < 2 << b; i++) o.push(...(global[i] ?? [0, 0, 0]));
  } else o.push(0, bg, 0);
  if (comment) o.push(0x21, 0xfe, ...subBlocks([...Buffer.from(comment)]));
  for (const f of frames) {
    if (f.transparent !== undefined || f.gce)
      o.push(0x21, 0xf9, 4, (f.transparent !== undefined ? 1 : 0) | ((f.disposal ?? 0) << 2), 10, 0, f.transparent ?? 0, 0);
    o.push(0x2c, ...le16(f.x ?? 0), ...le16(f.y ?? 0), ...le16(f.w), ...le16(f.h));
    let flags = f.interlace ? 0x40 : 0;
    if (f.local) {
      const b = tableBits(f.local.length);
      flags |= 0x80 | b;
      o.push(flags);
      for (let i = 0; i < 2 << b; i++) o.push(...(f.local[i] ?? [0, 0, 0]));
    } else o.push(flags);
    const mcs = f.minCodeSize ?? 2;
    let idx = f.indices;
    if (f.interlace) {
      const rows = [];
      for (let y = 0; y < f.h; y++) rows.push(idx.slice(y * f.w, (y + 1) * f.w));
      const order = [];
      for (const [s, d] of [
        [0, 8],
        [4, 8],
        [2, 4],
        [1, 2],
      ])
        for (let y = s; y < f.h; y += d) order.push(y);
      idx = order.flatMap((y) => rows[y]);
    }
    o.push(mcs, ...subBlocks(f.growing ? gifLzwGrowing(idx, mcs) : gifLzw(idx, mcs)));
  }
  if (trailer) o.push(0x3b);
  return Buffer.from(o);
}

/**
 * A Windows bitmap (BITMAPINFOHEADER, bottom up): bpp 1, 4, 8 (palette of [r, g, b, a]), 16
 * (5-6-5 values), 24 or 32 (pixels(x, y) gives [r, g, b] or [r, g, b, a], or the 16 bit value).
 */
export function bmp(w, h, bpp, pixels, palette = []) {
  const rowBytes = Math.ceil((w * (bpp === 15 ? 16 : bpp)) / 32) * 4;
  const palBytes = bpp <= 8 ? palette.length * 4 : 0;
  const off = 54 + palBytes;
  const buf = Buffer.alloc(off + rowBytes * h);
  buf.write('BM', 0, 'latin1');
  buf.writeUInt32LE(buf.length, 2);
  buf.writeUInt32LE(off, 10);
  buf.writeUInt32LE(40, 14);
  buf.writeInt32LE(w, 18);
  buf.writeInt32LE(h, 22);
  buf.writeUInt16LE(1, 26);
  buf.writeUInt16LE(bpp, 28);
  buf.writeUInt32LE(rowBytes * h, 34);
  buf.writeUInt32LE(2835, 38);
  buf.writeUInt32LE(2835, 42);
  buf.writeUInt32LE(bpp <= 8 ? palette.length : 0, 46);
  palette.forEach(([r, g, b, a = 0], i) => {
    buf[54 + i * 4] = b;
    buf[55 + i * 4] = g;
    buf[56 + i * 4] = r;
    buf[57 + i * 4] = a;
  });
  for (let y = 0; y < h; y++) {
    const row = off + (h - 1 - y) * rowBytes;
    for (let x = 0; x < w; x++) {
      const p = pixels(x, y);
      if (bpp === 32) {
        buf[row + x * 4] = p[2];
        buf[row + x * 4 + 1] = p[1];
        buf[row + x * 4 + 2] = p[0];
        buf[row + x * 4 + 3] = p[3];
      } else if (bpp === 24) {
        buf[row + x * 3] = p[2];
        buf[row + x * 3 + 1] = p[1];
        buf[row + x * 3 + 2] = p[0];
      } else if (bpp === 16 || bpp === 15) buf.writeUInt16LE(p, row + x * 2);
      else {
        const bit = x * bpp;
        buf[row + (bit >> 3)] |= p << (8 - bpp - (bit & 7));
      }
    }
  }
  return buf;
}
