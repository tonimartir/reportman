// WOFF 1.0 web fonts (https://www.w3.org/TR/WOFF/): the tables of an sfnt font (TrueType or
// OpenType), each one compressed with zlib. The font library reads sfnt files, so a WOFF file is
// rebuilt as the sfnt it was made from: the same tables, uncompressed, in the same order. WOFF2
// (Brotli, with transformed glyf and loca tables) is not read: such a file is skipped as a file
// that is not a font.

import { unzlibSync } from 'fflate';

const WOFF = 0x774f4646; // 'wOFF'

const u32 = (b: Uint8Array, o: number): number => ((b[o]! << 24) | (b[o + 1]! << 16) | (b[o + 2]! << 8) | b[o + 3]!) >>> 0;
const u16 = (b: Uint8Array, o: number): number => (b[o]! << 8) | b[o + 1]!;

/** Whether some bytes start as a WOFF 1.0 file. */
export function isWoff(head: Uint8Array): boolean {
  return head.length >= 4 && u32(head, 0) === WOFF;
}

/** The sfnt font of a WOFF 1.0 file. */
export function woffToSfnt(woff: Uint8Array): Uint8Array {
  if (woff.length < 44 || u32(woff, 0) !== WOFF) throw new Error('Not a WOFF font');
  const flavor = u32(woff, 4);
  const numTables = u16(woff, 12);
  const tables: { tag: number; checksum: number; data: Uint8Array }[] = [];
  for (let i = 0; i < numTables; i++) {
    const e = 44 + i * 20;
    const tag = u32(woff, e);
    const offset = u32(woff, e + 4);
    const compLength = u32(woff, e + 8);
    const origLength = u32(woff, e + 12);
    const checksum = u32(woff, e + 16);
    if (offset + compLength > woff.length) throw new Error('WOFF table out of the file');
    const stored = woff.subarray(offset, offset + compLength);
    // A table is stored compressed only when that makes it shorter
    const data = compLength < origLength ? unzlibSync(stored) : stored;
    if (data.length !== origLength) throw new Error('WOFF table of a wrong length');
    tables.push({ tag, checksum, data });
  }
  let log2 = 0;
  while (1 << (log2 + 1) <= numTables) log2++;
  const searchRange = (1 << log2) * 16;
  const headerLength = 12 + numTables * 16;
  let size = headerLength;
  for (const t of tables) size += (t.data.length + 3) & ~3;
  const out = new Uint8Array(size);
  const put32 = (o: number, v: number): void => {
    out[o] = v >>> 24;
    out[o + 1] = (v >>> 16) & 0xff;
    out[o + 2] = (v >>> 8) & 0xff;
    out[o + 3] = v & 0xff;
  };
  const put16 = (o: number, v: number): void => {
    out[o] = v >>> 8;
    out[o + 1] = v & 0xff;
  };
  put32(0, flavor);
  put16(4, numTables);
  put16(6, searchRange);
  put16(8, log2);
  put16(10, numTables * 16 - searchRange);
  let offset = headerLength;
  tables.forEach((t, i) => {
    const r = 12 + i * 16;
    put32(r, t.tag);
    put32(r + 4, t.checksum);
    put32(r + 8, offset);
    put32(r + 12, t.data.length);
    out.set(t.data, offset);
    offset += (t.data.length + 3) & ~3;
  });
  return out;
}
