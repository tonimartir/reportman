// Barcodes of data a symbology may not take, for barcode-bad-data.test.ts: every linear symbology
// with letters, digits, punctuation, characters beyond ASCII and odd lengths, with and without the
// checksum, and PDF417 with each escape, error correction level and size; what the C# engine
// draws (golden-cs barcode: the pattern of a linear symbology, the codewords of a PDF417) or the
// error it gives.
//
// fixtures/barcode-bad-data.json.gz: [{ type, text, checksum?, ecc?, rows?, cols?, pattern? |
// codewords? | error? }]
//
//   node test/generate-barcode-bad-data-fixtures.mjs   (from packages/reportman-engine, on Windows,
//                                                       golden-cs built)

import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '../../../..');
const goldenCs = path.join(root, 'typescript/tools/golden-cs/bin/Release/net10.0/golden-cs.exe');
const work = fs.mkdtempSync(path.join(os.tmpdir(), 'rm-bcbad-'));

const linear = [
  'Code_2_5_interleaved', 'Code_2_5_industrial', 'Code_2_5_matrix', 'Code39', 'Code39Extended',
  'Code128A', 'Code128B', 'Code128C', 'Code128', 'Code93', 'Code93Extended', 'CodeMSI', 'CodePostNet',
  'CodeCodabar', 'CodeEAN8', 'CodeEAN13',
];
const texts = [
  '', ' ', 'A', 'a', '1', '12', '123', '1A', 'A1', '12A4', '1234567', '12345678', '1234567X', 'X2345678',
  '123456789012', '1234567890128', 'A234567890123', '12345678901A', '1234567890123456', 'é', 'ñ', '€',
  '\u0000', '\u007f', '\u0080', 'ÿ', 'Ā', '😀', '1 2', '-1', '+', '*', '$', '%', '/', '.',
  'lower', 'ABC', 'A1B2', '0123456789', '1'.repeat(101), 'Ab'.repeat(40), '12-34', '12.5', '#', '\\', '~',
  '{', 'À', '12\t34', '12\t', '\t12', '1+', '+1',
];
const cases = [];
for (const type of linear) for (const text of texts) for (const checksum of [false, true]) cases.push({ type, text, checksum });

const pdf417 = [
  '', 'a', '\\', '\\\\', '\\X', '\\X4', '\\X4G', '\\XZZ', '\\XFF', '\\X41', '\\C', '\\C9', '\\C-12', '\\C999',
  '\\C928', '\\C900', '\\C1000', '\\C99999999999', '\\G', '\\G1', '\\G123456', '\\G999999', '\\G-1', '\\0', '\\00',
  '\\065', '\\200', '\\999', '\\256', '\\Y', 'end\\', 'é', '€', 'Ā', '😀', '1'.repeat(50),
  '1'.repeat(2000), 'a'.repeat(1900),
];
for (const text of pdf417) cases.push({ type: 'CodePDF417', text });
for (const ecc of [-5, -2, -1, 0, 8, 9, 10, 100]) cases.push({ type: 'CodePDF417', text: 'ecc', ecc });
for (const [rows, cols] of [[-1, 0], [0, -1], [1, 1], [3, 1], [90, 1], [99, 1], [0, 30], [0, 31], [0, 100], [90, 30], [91, 30], [100, 100], [2, 0]])
  cases.push({ type: 'CodePDF417', text: 'rows and cols', rows, cols });

const input = path.join(work, 'cases.json');
const output = path.join(work, 'out.json');
fs.writeFileSync(input, JSON.stringify(cases));
const r = spawnSync(goldenCs, ['barcode', input, output], { encoding: 'utf8' });
if (r.status !== 0) throw new Error('golden-cs barcode failed: ' + r.stdout + r.stderr);
const cs = JSON.parse(fs.readFileSync(output, 'utf8'));

const out = cases.map((c, i) => {
  const res = cs[i];
  if (res.error !== undefined) return { ...c, error: res.error };
  if (c.type === 'CodePDF417') return { ...c, symbolRows: res.rows, symbolCols: res.cols, codewords: res.codewords };
  return { ...c, pattern: res.pattern };
});
fs.writeFileSync(path.join(here, 'fixtures/barcode-bad-data.json.gz'), zlib.gzipSync(JSON.stringify(out), { level: 9 }));
fs.rmSync(work, { recursive: true, force: true });
console.log(out.length + ' cases, ' + out.filter((c) => c.error !== undefined).length + ' errors');
