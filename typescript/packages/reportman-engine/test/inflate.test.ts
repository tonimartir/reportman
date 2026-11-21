// The zlib decoder of the compressed images embedded in a report (StreamUtil.DeCompressStream):
// every kind of DEFLATE block node:zlib writes, and the errors SharpZipLib reports.

import zlib from 'node:zlib';
import { describe, expect, it } from 'vitest';
import { InflateError, inflateZlib } from '../src/util/inflate.js';

function sample(n: number): Buffer {
  const b = Buffer.alloc(n);
  let s = 12345;
  for (let i = 0; i < n; i++) {
    s = (Math.imul(s, 1103515245) + 12345) >>> 0;
    // Runs and repeats for the matches, noise for the literals
    b[i] = i % 1000 < 400 ? (i >> 6) & 0xff : s >>> 24;
  }
  return b;
}

describe('inflateZlib', () => {
  const data = sample(200000);
  it.each([
    ['stored blocks', { level: 0 }],
    ['fast', { level: 1 }],
    ['best', { level: 9 }],
    ['fixed Huffman codes', { strategy: zlib.constants.Z_FIXED }],
    ['Huffman only', { strategy: zlib.constants.Z_HUFFMAN_ONLY }],
    ['run length', { strategy: zlib.constants.Z_RLE }],
    ['a small window', { windowBits: 9 }],
  ])('decodes %s', (_name, options) => {
    expect(Buffer.from(inflateZlib(zlib.deflateSync(data, options)))).toEqual(data);
  });

  it('decodes an empty stream and ignores the bytes after the stream', () => {
    expect(inflateZlib(zlib.deflateSync(Buffer.alloc(0)))).toHaveLength(0);
    const z = Buffer.concat([zlib.deflateSync(Buffer.from('abc')), Buffer.from([1, 2, 3])]);
    expect(Buffer.from(inflateZlib(z)).toString()).toBe('abc');
  });

  it('fails as SharpZipLib does for a bad header, a bad checksum, truncated or broken data', () => {
    const z = zlib.deflateSync(data);
    expect(() => inflateZlib(new Uint8Array([0x78, 0x9d, 0, 0]))).toThrow('Header checksum illegal');
    expect(() => inflateZlib(new Uint8Array([0x79, 0x18, 0, 0]))).toThrow('Compression Method unknown');
    const badSum = Buffer.from(z);
    badSum[badSum.length - 1] ^= 1;
    expect(() => inflateZlib(badSum)).toThrow(/Adler chksum/);
    expect(() => inflateZlib(z.subarray(0, z.length - 100))).toThrow('Unexpected EOF');
    // BFINAL with the reserved block type 3
    expect(() => inflateZlib(new Uint8Array([0x78, 0x9c, 0x07, 0, 0, 0, 0, 0]))).toThrow(InflateError);
    // A stored block whose length and its complement disagree
    expect(() => inflateZlib(new Uint8Array([0x78, 0x9c, 0x01, 5, 0, 0, 0, 1, 2, 3, 4, 5, 0, 0, 0, 0]))).toThrow('Broken uncompressed block');
  });
});
