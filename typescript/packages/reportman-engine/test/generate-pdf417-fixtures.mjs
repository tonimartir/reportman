// The PDF417 codewords of many texts, for pdf417-codewords.test.ts: what the C# engine encodes
// (golden-cs barcode) and what the Delphi engine draws for the same text (a report of the texts,
// test/synthetic/make-barcode-reports.mjs --cases, run by golden-delphi; each symbol read back
// from its bars to its codewords). The texts are the ends of each compaction mode (the lengths
// from one character, in each kind of character) and random ones, pieces of capitals, lower
// case, digits (runs around the 14 that make a numeric compaction and the 38 of a chunk),
// punctuation and characters over 127, which the text compaction does not have.
//
// fixtures/pdf417-codewords.json: [{ text, rows, cols, codewords, delphi }], the codewords of the
// whole symbol (the count, the data, the padding and the error correction) in both.
//
//   node test/generate-pdf417-fixtures.mjs      (from packages/reportman-engine, on Windows;
//                                                golden-cs and golden-delphi built, or the one
//                                                GOLDEN_DELPHI names; npx tsc -b . first: the
//                                                cluster table is taken from dist)

import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '../../../..');
const goldenCs = path.join(root, 'typescript/tools/golden-cs/bin/Release/net10.0/golden-cs.exe');
const goldenDelphi = process.env.GOLDEN_DELPHI ?? path.join(root, 'typescript/tools/golden-delphi/bin_x86/golden-delphi.exe');
const work = fs.mkdtempSync(path.join(os.tmpdir(), 'rm-pdf417-'));
const { SPDF417_CODEWORDS } = await import(pathToFileURL(path.join(here, '../dist/report/barcode/pdf417tables.js')).href);

function run(exe, args) {
  const r = spawnSync(exe, args, { encoding: 'utf8' });
  if (r.status !== 0) throw new Error(path.basename(exe) + ' ' + args.join(' ') + ' failed: ' + r.stdout + r.stderr);
}

// A seeded generator (mulberry32), so the fixtures can be written again the same
let seed = 0x417c0de;
function random() {
  seed = (seed + 0x6d2b79f5) | 0;
  let t = seed;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}
const int = (n) => Math.floor(random() * n);
const pick = (s) => s.charAt(int(s.length));
const piece = (alphabet, length) => {
  let r = '';
  for (let i = 0; i < length; i++) r += pick(alphabet);
  return r;
};

const UPPER = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
const LOWER = 'abcdefghijklmnopqrstuvwxyz';
const DIGITS = '0123456789';
const MIXED = '&,:#-.$/+%*=^';
const PUNCTUATION = ';<>@[]_`~!,:-.$/"|*()?{}';
// Over 127: the letters of code page 1252 and the euro sign (0x80 there)
const HIGH = 'ñáéíóúüÑÁÉçÇ€¿¡ºª';
const ALPHABETS = [
  UPPER, LOWER, DIGITS, DIGITS, DIGITS, MIXED, PUNCTUATION, HIGH, ' ', UPPER + LOWER, LOWER + ' ', UPPER + DIGITS, DIGITS + ' ',
  UPPER + LOWER + DIGITS + ' ', LOWER + HIGH + ' ', UPPER + LOWER + DIGITS + MIXED + PUNCTUATION + ' ',
];
const DIGIT_RUNS = [1, 2, 5, 12, 13, 14, 15, 20, 37, 38, 39, 44, 45, 60, 80];

const texts = new Set();
for (const alphabet of [UPPER, LOWER, DIGITS, HIGH, PUNCTUATION, MIXED]) for (let length = 1; length <= 8; length++) texts.add(piece(alphabet, length));
while (texts.size < 500) {
  let text = '';
  for (let pieces = 1 + int(5); pieces > 0; pieces--) {
    const alphabet = ALPHABETS[int(ALPHABETS.length)];
    text += piece(alphabet, alphabet === DIGITS ? DIGIT_RUNS[int(DIGIT_RUNS.length)] : 1 + int(alphabet === HIGH ? 8 : 14));
  }
  if (text.length <= 150) texts.add(text);
}
const cases = [...texts];

// The C# engine
const csCases = path.join(work, 'cs-cases.json');
const csOut = path.join(work, 'cs-out.json');
fs.writeFileSync(csCases, JSON.stringify(cases.map((text) => ({ type: 'CodePDF417', text }))));
run(goldenCs, ['barcode', csCases, csOut]);
const cs = JSON.parse(fs.readFileSync(csOut, 'utf8'));

// The Delphi engine: the report of the cases, and the codewords of each symbol
const delphiCases = path.join(work, 'delphi-cases.json');
const report = path.join(work, 'pdf417.rep');
fs.writeFileSync(delphiCases, JSON.stringify(cases.map((text) => ({ text, type: 'PDF417', MODUL: 2 }))));
run(process.execPath, [path.join(here, 'synthetic/make-barcode-reports.mjs'), '--cases', delphiCases, report]);
run(goldenDelphi, [report, path.join(work, 'delphi')]);
const meta = JSON.parse(fs.readFileSync(path.join(work, 'delphi/meta.json'), 'utf8'));

const START = 0b11111111010101000;
const STOP = 0b11111110100010100;
const clusters = SPDF417_CODEWORDS.map((patterns) => new Map(patterns.map((p, codeword) => [p, codeword])));

/** The codewords of the data region of a symbol, from its bars ({ left, top, width }). */
function readCodewords(bars) {
  const left = Math.min(...bars.map((b) => b.left));
  const modul = Math.min(...bars.map((b) => b.width));
  const tops = [...new Set(bars.map((b) => b.top))].sort((a, b) => a - b);
  const codewords = [];
  tops.forEach((top, r) => {
    const rowBars = bars.filter((b) => b.top === top);
    const right = Math.max(...rowBars.map((b) => b.left + b.width));
    const bits = new Array(Math.round((right - left) / modul)).fill(0);
    for (const b of rowBars) {
      const start = Math.round((b.left - left) / modul);
      for (let i = 0; i < Math.round(b.width / modul); i++) bits[start + i] = 1;
    }
    const patterns = [];
    for (let c = 0; c + 17 <= bits.length; c += 17) patterns.push(bits.slice(c, c + 17).reduce((v, bit) => v * 2 + bit, 0));
    if (patterns[0] !== START || patterns[patterns.length - 1] !== STOP) throw new Error('not a PDF417 row');
    // Without the start, the left indicator, the right indicator and the stop
    for (const p of patterns.slice(2, patterns.length - 2)) {
      const codeword = clusters[r % 3].get(p);
      if (codeword === undefined) throw new Error('not a PDF417 codeword');
      codewords.push(codeword);
    }
  });
  return codewords;
}

const delphi = new Map();
for (const page of meta.pages) {
  let bars = [];
  for (const o of page.objects) {
    if (o.type === 'text') {
      delphi.set(o.text, readCodewords(bars));
      bars = [];
    } else if (o.type === 'draw') bars.push(o);
  }
}

const out = cases.map((text, i) => {
  if (cs[i].error !== undefined) throw new Error('C# fails on ' + JSON.stringify(text) + ': ' + cs[i].error);
  return { text, rows: cs[i].rows, cols: cs[i].cols, codewords: cs[i].codewords, delphi: delphi.get('c' + i) };
});
fs.writeFileSync(path.join(here, 'fixtures/pdf417-codewords.json'), '[\n' + out.map((c) => JSON.stringify(c)).join(',\n') + '\n]\n');
fs.rmSync(work, { recursive: true, force: true });
console.log(out.length + ' texts, ' + out.filter((c) => JSON.stringify(c.codewords) === JSON.stringify(c.delphi)).length + ' with the codewords of Delphi');
