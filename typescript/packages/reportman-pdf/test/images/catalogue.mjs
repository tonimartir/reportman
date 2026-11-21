// The images of the image parity fixtures: PNG in every color type and bit depth (with and
// without tRNS, interlaced, filtered, sBIT, color chunks Skia ignores, truncated, broken), GIF
// (palettes, transparency, interlacing, frames past the screen, truncated, broken), Windows
// bitmaps (1, 4, 8, 16, 24 and 32 bits), a JPEG and formats no decoder reads.

import { bmp, gif, png, pngChunk } from './encoders.mjs';

/** A deterministic pseudo random sample generator. */
function rng(seed) {
  let s = seed >>> 0;
  return (max) => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s % (max + 1);
  };
}

const max = (bd) => (1 << bd) - 1;

function noise(seed, channels, bd) {
  const r = rng(seed);
  const cache = new Map();
  return (x, y) => {
    const k = x + ',' + y;
    if (!cache.has(k)) cache.set(k, Array.from({ length: channels }, () => r(max(bd))));
    return cache.get(k);
  };
}

const palette = (n, seed) => {
  const r = rng(seed);
  const out = [];
  for (let i = 0; i < n; i++) out.push(r(255), r(255), r(255));
  return out;
};

const pal4 = [
  [255, 0, 0],
  [0, 160, 0],
  [0, 0, 255],
  [250, 220, 0],
];

/** name -> bytes */
export function catalogue() {
  const c = {};
  // PNG gray
  for (const bd of [1, 2, 4, 8, 16]) {
    c[`png-gray${bd}`] = png(13, 7, 0, bd, noise(bd, 1, bd), { filters: true });
    c[`png-gray${bd}-trns`] = png(13, 7, 0, bd, (x, y) => [(x + y) % (max(bd) + 1)], {
      trns: [0, bd === 16 ? 0 : 1, ...(bd === 16 ? [] : [])].slice(0, 2),
      filters: true,
    });
  }
  // A gray key with bits over the bit depth: libpng keeps its low bits
  c['png-gray1-trns-masked'] = png(9, 3, 0, 1, (x) => [x % 2], { trns: [0, 3] });
  c['png-gray8-trns-masked'] = png(9, 3, 0, 8, (x) => [x * 20], { trns: [1, 40] });
  c['png-gray16-trns'] = png(9, 3, 0, 16, (x) => [x * 7000], { trns: [0x6d, 0x60] });
  // PNG RGB
  c['png-rgb8'] = png(11, 9, 2, 8, noise(30, 3, 8), { filters: true });
  c['png-rgb16'] = png(11, 9, 2, 16, (x, y) => [x * 5000 + 0xff, y * 6000 + 0x80, (x * y * 999) & 0xffff], { filters: true });
  c['png-rgb8-trns'] = png(8, 4, 2, 8, (x, y) => [x * 30, y * 60, 7], { trns: [0, 60, 0, 60, 0, 7] });
  c['png-rgb8-trns-masked'] = png(8, 4, 2, 8, (x, y) => [x * 30, y * 60, 7], { trns: [1, 30, 2, 0, 3, 7] });
  c['png-rgb16-trns'] = png(8, 4, 2, 16, (x, y) => [x * 3000, y * 9000, 77], { trns: [0x17, 0x70, 0, 0, 0, 77] });
  c['png-rgb8-565'] = png(16, 8, 2, 8, noise(31, 3, 8), { before: [['sBIT', [5, 6, 5]]] });
  c['png-rgb16-565'] = png(16, 8, 2, 16, noise(32, 3, 16), { before: [['sBIT', [5, 6, 5]]] });
  c['png-rgb8-565-trns'] = png(8, 4, 2, 8, (x, y) => [x * 30, y * 60, 7], { before: [['sBIT', [5, 6, 5]]], trns: [0, 60, 0, 60, 0, 7] });
  c['png-rgb16-565-trns'] = png(8, 4, 2, 16, (x, y) => [x * 3000, y * 9000, 77], { before: [['sBIT', [5, 6, 5]]], trns: [0x17, 0x70, 0, 0, 0, 77] });
  c['png-rgb8-sbit'] = png(8, 4, 2, 8, noise(33, 3, 8), { before: [['sBIT', [8, 8, 8]]] });
  // PNG palette
  for (const bd of [1, 2, 4, 8]) {
    const n = Math.min(1 << bd, 40);
    c[`png-pal${bd}`] = png(17, 5, 3, bd, noise(40 + bd, 1, bd), { plte: palette(1 << bd, bd), filters: true });
    c[`png-pal${bd}-trns`] = png(17, 5, 3, bd, noise(50 + bd, 1, bd), {
      plte: palette(n, bd + 9),
      trns: Array.from({ length: Math.max(1, n >> 1) }, (_, i) => (i * 97) & 255),
    });
  }
  // Indexes past the palette take its last color
  c['png-pal4-short'] = png(16, 2, 3, 4, (x) => [x], { plte: palette(5, 3), trns: [0, 128] });
  // PNG gray and alpha, RGBA
  c['png-ga8'] = png(16, 16, 4, 8, (x, y) => [x * 16 + 3, y * 16 + 5], { filters: true });
  c['png-ga16'] = png(10, 4, 4, 16, (x, y) => [x * 6000 + 0xff, y * 20000 + 0xff]);
  c['png-ga8-alphaonly'] = png(8, 2, 4, 8, (x) => [200, x * 30], { before: [['sBIT', [1, 8]]] });
  c['png-rgba8'] = png(16, 16, 6, 8, noise(60, 4, 8), { filters: true });
  c['png-rgba16'] = png(9, 9, 6, 16, noise(61, 4, 16), { filters: true });
  // Interlaced
  c['png-i-gray1'] = png(13, 11, 0, 1, noise(70, 1, 1), { interlace: true, filters: true });
  c['png-i-pal4'] = png(13, 11, 3, 4, noise(71, 1, 4), { interlace: true, plte: palette(16, 71), trns: [10, 200, 255] });
  c['png-i-rgb8'] = png(13, 11, 2, 8, noise(72, 3, 8), { interlace: true, filters: true });
  c['png-i-ga8'] = png(5, 3, 4, 8, noise(73, 2, 8), { interlace: true });
  c['png-i-rgba16'] = png(13, 11, 6, 16, noise(74, 4, 16), { interlace: true, filters: true });
  c['png-i-1x1'] = png(1, 1, 2, 8, () => [10, 20, 30], { interlace: true });
  // Chunks Skia ignores (no color management) and image data in several chunks
  c['png-color-chunks'] = png(6, 6, 2, 8, noise(80, 3, 8), {
    before: [
      ['gAMA', [0, 0, 0xb1, 0x8f]],
      ['cHRM', new Array(32).fill(1)],
      ['sRGB', [0]],
      ['tEXt', [...Buffer.from('Comment\0synthetic')]],
    ],
    after: [['tIME', [7, 0xe8, 1, 2, 3, 4, 5]]],
    idatSplit: 7,
  });
  // Chunks libpng ignores, and chunks it rejects (no image)
  c['png-rgb-plte'] = png(5, 5, 2, 8, noise(84, 3, 8), { plte: palette(4, 84) });
  c['png-trns-after-idat'] = png(4, 4, 0, 8, noise(85, 1, 8), { after: [['tRNS', [0, 7]]] });
  const badText = Buffer.from(png(4, 4, 2, 8, noise(86, 3, 8), { after: [['tEXt', [...Buffer.from('Title\0x')]]] }));
  badText[badText.length - 13] ^= 0xff;
  c['png-ancillary-bad-crc'] = badText;
  c['png-no-plte'] = png(4, 4, 3, 8, () => [0]);
  c['png-unknown-critical'] = png(4, 4, 2, 8, noise(87, 3, 8), { before: [['ABCD', [1, 2, 3]]] });
  c['png-bad-filter'] = png(4, 4, 2, 8, noise(88, 3, 8), { badFilter: true });
  // A truncated image: the rows decoded and transparent below
  const whole = png(10, 40, 6, 8, noise(81, 4, 8));
  c['png-truncated'] = whole.subarray(0, whole.length - 120);
  const wholeGray = png(30, 40, 0, 8, noise(82, 1, 8));
  c['png-truncated-gray'] = wholeGray.subarray(0, Math.floor(wholeGray.length * 0.6));
  // A broken CRC: no image (0 x 0)
  const bad = Buffer.from(png(4, 4, 2, 8, noise(83, 3, 8)));
  bad[bad.length - 13] ^= 0xff;
  c['png-bad-crc'] = bad;
  // GIF
  c['gif-basic'] = gif({ w: 4, h: 3, global: pal4, frames: [{ w: 4, h: 3, indices: [0, 1, 2, 3, 1, 2, 3, 0, 2, 3, 0, 1] }] });
  c['gif-offset-transparent'] = gif({ w: 6, h: 5, global: pal4, bg: 2, frames: [{ x: 2, y: 1, w: 3, h: 2, transparent: 1, indices: [0, 1, 2, 3, 1, 0] }] });
  c['gif-interlaced'] = gif({ w: 3, h: 19, global: pal4, frames: [{ w: 3, h: 19, interlace: true, indices: Array.from({ length: 57 }, (_, i) => Math.floor(i / 3) % 4) }] });
  c['gif-local'] = gif({ w: 2, h: 2, global: pal4, frames: [{ w: 2, h: 2, local: [[10, 20, 30], [40, 50, 60]], indices: [0, 1, 1, 0] }] });
  c['gif-beyond-screen'] = gif({ w: 4, h: 4, global: pal4, frames: [{ x: 2, y: 3, w: 3, h: 2, indices: [0, 1, 2, 3, 0, 1] }] });
  c['gif-out-of-palette'] = gif({ w: 4, h: 1, global: pal4.slice(0, 2), frames: [{ w: 4, h: 1, minCodeSize: 3, indices: [0, 1, 5, 7] }] });
  c['gif-two-frames'] = gif({ w: 2, h: 1, global: pal4, comment: 'two frames', frames: [{ w: 2, h: 1, indices: [0, 1] }, { w: 2, h: 1, indices: [2, 3] }] });
  c['gif87a'] = gif({ version: 'GIF87a', w: 2, h: 1, global: pal4, frames: [{ w: 2, h: 1, indices: [2, 3] }] });
  const r8 = rng(90);
  const big = Array.from({ length: 64 * 48 }, (_, i) => (i % 64 < 32 ? Math.floor(i / 97) % 256 : r8(255)));
  c['gif-8bit-growing'] = gif({ w: 64, h: 48, global: Array.from({ length: 256 }, (_, i) => [i, 255 - i, (i * 7) & 255]), frames: [{ w: 64, h: 48, minCodeSize: 8, growing: true, indices: big }] });
  // The LZW table fills (4096 codes) and the codes stay 12 bits without a clear code
  const r9 = rng(91);
  const noisy = Array.from({ length: 200 * 150 }, (_, i) => (i % 200 < 100 ? Math.floor(i / 97) % 256 : r9(255)));
  c['gif-table-full'] = gif({ w: 200, h: 150, global: Array.from({ length: 256 }, (_, i) => [255 - i, i, (i * 3) & 255]), frames: [{ w: 200, h: 150, minCodeSize: 8, growing: true, indices: noisy }] });
  const full = gif({ w: 4, h: 2, global: pal4, frames: [{ w: 4, h: 2, indices: [0, 1, 2, 3, 3, 2, 1, 0] }] });
  c['gif-truncated'] = full.subarray(0, full.length - 6);
  c['gif-not-enough-data'] = gif({ w: 4, h: 2, global: pal4, frames: [{ w: 4, h: 2, indices: [1, 2, 3] }] });
  c['gif-min-code-size-1'] = gif({ w: 4, h: 1, global: pal4.slice(0, 2), frames: [{ w: 4, h: 1, minCodeSize: 1, indices: [0, 1, 1, 0] }] });
  c['gif-zero-frame'] = gif({ w: 2, h: 2, global: pal4, frames: [{ w: 0, h: 0, indices: [] }] });
  c['gif-no-frame'] = gif({ w: 2, h: 2, global: pal4, frames: [] });
  c['gif-no-palette'] = gif({ w: 2, h: 1, frames: [{ w: 2, h: 1, indices: [0, 1] }] });
  // A code past the table: 4 = clear, then code 7 with only 6 defined
  c['gif-bad-code'] = Buffer.concat([gif({ w: 2, h: 1, global: pal4, frames: [] }).subarray(0, -1), Buffer.from([0x2c, 0, 0, 0, 0, 2, 0, 1, 0, 0, 2, 2, 0x3c, 0x00, 0, 0x3b])]);
  // Windows bitmaps
  c['bmp-24'] = bmp(7, 5, 24, (x, y) => [x * 30, y * 50, (x + y) * 10]);
  c['bmp-32'] = bmp(6, 4, 32, (x, y) => [x * 40, y * 60, 90, x * 50]);
  c['bmp-15'] = bmp(5, 3, 15, (x, y) => ((x * 6) << 10) | ((y * 9) << 5) | (x + y));
  c['bmp-16'] = bmp(5, 3, 16, (x, y) => ((x * 6) << 11) | ((y * 20) << 5) | (x + y));
  c['bmp-8'] = bmp(9, 4, 8, (x, y) => (x + y * 9) % 6, [[255, 0, 0], [0, 255, 0], [0, 0, 255], [9, 9, 9], [200, 100, 50], [1, 2, 3]]);
  c['bmp-8-alpha'] = bmp(4, 2, 8, (x) => x % 3, [[255, 0, 0, 255], [0, 255, 0, 255], [0, 0, 255, 255]]);
  c['bmp-4'] = bmp(9, 3, 4, (x, y) => (x * 3 + y) % 16, Array.from({ length: 16 }, (_, i) => [i * 16, 255 - i * 16, i * 8, 255]));
  c['bmp-1'] = bmp(11, 3, 1, (x, y) => (x + y) % 2, [[0, 0, 0, 255], [255, 255, 255, 255]]);
  // Bytes no decoder reads: an empty (0 x 0) image
  c['unknown'] = Buffer.from('This is not an image at all, just text.');
  return c;
}
