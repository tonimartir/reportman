// The modules ZXing.Net gives the C# engine for a linear barcode drawn by the device (golden-cs
// zxing-width, BarcodeItem.EmitNativeBarcode), for zxing-width.test.ts: hand cases at the edges of
// each writer (lengths, check digits, guards, full ASCII, code set changes of Code 128) and random
// texts from an alphabet a little wider than each symbology's, so that refusals come up too.
//
//   node test/generate-zxing-width-fixtures.mjs        (from packages/reportman-engine; golden-cs built)

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '../../../..');
const exe = path.join(root, 'typescript/tools/golden-cs/bin/Release/net10.0/golden-cs.exe');

// A seeded generator (mulberry32), so the fixtures can be written again the same
let seed = 0x5eed1234;
function random() {
  seed = (seed + 0x6d2b79f5) | 0;
  let t = seed;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}
const pick = (s) => s.charAt(Math.floor(random() * s.length));
const text = (alphabet, min, max) => {
  const n = min + Math.floor(random() * (max - min + 1));
  let r = '';
  for (let i = 0; i < n; i++) r += pick(alphabet);
  return r;
};

const DIGITS = '0123456789';
const ASCII = [...Array(128).keys()].map((c) => String.fromCharCode(c)).join('');
const FNC = 'ñòóô';
const cases = [];
const add = (symbology, t) => cases.push({ symbology, text: t });

// EAN-13 and EAN-8: with and without the check digit, a wrong one, other lengths, a letter
for (const t of ['400638133393', '4006381333931', '4006381333932', '40063813339', '40063813339312', '40063813339A', '0000000000000', '1234567'])
  add('EAN13', t);
for (const t of ['9638507', '96385074', '96385075', '963850', '963850744', '96385A7', '00000000']) add('EAN8', t);
for (let i = 0; i < 200; i++) add('EAN13', text(DIGITS, 11, 14));
for (let i = 0; i < 100; i++) add('EAN13', text(DIGITS, 12, 12) + pick(DIGITS));
for (let i = 0; i < 200; i++) add('EAN8', text(DIGITS, 6, 9));
// ITF: even and odd lengths, 80 and 82 digits, a letter
for (const t of ['12', '123', '1234567890', '1A', '1'.repeat(80), '1'.repeat(82)]) add('ITF', t);
for (let i = 0; i < 150; i++) add('ITF', text(DIGITS + 'A', 1, 20));
// Code 39: its alphabet, full ASCII (lower case, symbols, the asterisk), over 80, beyond ASCII
for (const t of ['CODE39', 'code39', 'A*B', 'A$B/C+D%E', 'a$b', '\u0000\u001f@`', 'A'.repeat(80), 'A'.repeat(81), 'a'.repeat(40), 'a'.repeat(41), 'Ñ', '1 2-3.4'])
  add('Code39', t);
for (let i = 0; i < 300; i++) add('Code39', text('0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ-. $/+%', 1, 30));
for (let i = 0; i < 300; i++) add('Code39', text(ASCII, 1, 45));
for (let i = 0; i < 30; i++) add('Code39', text(ASCII + 'éÑ€', 1, 10));
// Code 93: the same
for (const t of ['CODE93', 'code93', 'A$B/C+D%E', 'a$b', '\u0000\u001f@`:;', 'A'.repeat(80), 'A'.repeat(81), 'a'.repeat(40), 'a'.repeat(41), 'é'])
  add('Code93', t);
for (let i = 0; i < 300; i++) add('Code93', text('0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ-. $/+%', 1, 30));
for (let i = 0; i < 300; i++) add('Code93', text(ASCII, 1, 45));
for (let i = 0; i < 30; i++) add('Code93', text(ASCII + 'éÑ€', 1, 10));
// Codabar: the guards, missing ones, lower case guards, one character, the ten-module characters
for (const t of ['A123B', '1234', 'a123b', 'T12E', 't12*', 'A123', '123B', 'A12T', '1', 'A', 'AB', '12', '1-2$3/4:5+6.7', 'A1X2B', '١٢٣'])
  add('Codabar', t);
for (let i = 0; i < 300; i++) add('Codabar', text('0123456789-$/:+.', 1, 25));
for (let i = 0; i < 300; i++) add('Codabar', pick('ABCDTN*Eabcdtne') + text('0123456789-$/:+.', 0, 20) + pick('ABCDTN*Eabcdtne'));
for (let i = 0; i < 100; i++) add('Codabar', text('0123456789-$/:+.ABCDTN*EX', 1, 15));
// Code 128: digits runs (odd and even, before, after and between letters), control characters,
// lower case, the FNC escapes, over 80 characters, beyond ASCII
for (const t of ['1', '12', '123', '1234', '12345', 'A1234', 'A12345', 'AB1234CD', 'AB12345CD', '1234AB', '12345AB', 'ñ12', 'ñ1234',
  '12ñ1234', 'A12ñ34', 'A12ñ345', '\u0001A', 'A\u0001', 'a\u0001', '\u0001a', '\u0001ô', 'aô', '12ô', 'ABC', 'abc',
  '1'.repeat(80), '1'.repeat(81), 'A'.repeat(80), 'é', '{1}', 'õ'])
  add('Code128', t);
for (let i = 0; i < 300; i++) add('Code128', text(DIGITS + 'AB', 1, 30));
for (let i = 0; i < 300; i++) add('Code128', text(ASCII + FNC, 1, 40));
for (let i = 0; i < 300; i++) add('Code128', text(DIGITS + '\u0001\u001fa' + FNC, 1, 30));
for (let i = 0; i < 30; i++) add('Code128', text(ASCII + 'é€', 1, 10));
// Long texts
for (const t of ['A'.repeat(81), 'a'.repeat(200), '1'.repeat(1000), 'A1'.repeat(300)]) add('Code128', t);
for (const s of ['EAN13', 'ITF', 'Code39', 'Code93', 'Codabar']) add(s, '1'.repeat(500));

const work = fs.mkdtempSync(path.join(os.tmpdir(), 'rm-zxing-'));
const input = path.join(work, 'cases.json');
const output = path.join(work, 'widths.json');
fs.writeFileSync(input, JSON.stringify(cases));
const r = spawnSync(exe, ['zxing-width', input, output], { encoding: 'utf8' });
if (r.status !== 0) throw new Error('golden-cs zxing-width failed: ' + r.stderr);
const widths = JSON.parse(fs.readFileSync(output, 'utf8'));
fs.rmSync(work, { recursive: true });
const result = cases.map((c, i) => ({ ...c, modules: widths[i] }));
fs.writeFileSync(path.join(here, 'fixtures', 'zxing-widths.json'), JSON.stringify(result, null, 0).split('},{').join('},\n{') + '\n');
const refused = result.filter((c) => c.modules === null).length;
console.log(`${result.length} cases, ${refused} refused`);
