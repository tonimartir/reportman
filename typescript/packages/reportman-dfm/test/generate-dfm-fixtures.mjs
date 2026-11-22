// The reference outputs of the Delphi engine for @reportman/dfm, written by tools/golden-dfm (run
// tools/golden-dfm/build.bat first; Windows with RAD Studio):
//
//   fixtures/corpus/<group>.json.gz   for each report of a group of the repository (the samples,
//                                     the reports of the engine tests...), loaded by Delphi and
//                                     saved in its DFM forms: { name: { text, xml, binary?, zlib? } }
//                                     with the text DFM and the XML Delphi writes from it as strings
//                                     (both are ASCII: Delphi writes other characters as codes),
//                                     and the binary and zlib forms (base64) for some of them
//   fixtures/originals.json.gz        the DFM reports of repman/repsamples as an older Delphi saved
//                                     them (base64) and the XML of reptotxt -xml for each
//   cases/*.xml                       the XML of the hand-made reports of test/make-dfm-cases.mjs
//                                     (cases/invalid-*.error: the message of Delphi, which can not
//                                     read them); the cases are a group of the corpus too, so
//                                     Delphi writes their DFM forms with its own writer
//   fixtures/floats.json              the doubles as FloatToStr writes them
//   fixtures/utf8.json                TEncoding.UTF8.GetString of byte sequences (null: it raises)
//   fixtures/writestring.json         TWriter.WriteString and TReader.ReadString of strings, the
//                                     round trip of the strings of a text DFM
//   src/ansi-upper-table.ts           the code units AnsiUpperCase (CharUpperBuff) maps
//
// Usage: node test/generate-dfm-fixtures.mjs
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { gzipSync } from 'node:zlib';

const here = dirname(fileURLToPath(import.meta.url));
const ts = resolve(here, '..', '..', '..');
const repo = resolve(ts, '..');
const delphi = process.env.REPORTMAN_DELPHI ?? 'C:/desarrollo/prog/toni/reportman';
const exe = join(ts, 'tools', 'golden-dfm', 'bin_x86', 'golden-dfm.exe');
if (!existsSync(exe)) throw new Error('Build tools/golden-dfm first (build.bat)');
const out = join(here, 'fixtures');
mkdirSync(join(out, 'corpus'), { recursive: true });

// The groups: their folder and how many of their reports keep the binary and zlib forms too (the
// text and binary readers give the same tree for every report: test/dfm.test.ts checks it on
// these, tools/check-dfm.mjs on all of them)
const packages = join(ts, 'packages');
// The hand-made reports first: they are a group too
spawnSync(process.execPath, [join(here, 'make-dfm-cases.mjs')], { stdio: 'inherit' });
const cases = join(here, 'cases');
const GROUPS = [
  { group: 'cases', dir: cases, forms: Infinity },
  { group: 'samples', dir: join(repo, 'samples'), forms: Infinity },
  { group: 'repsamples', dir: join(delphi, 'repman', 'repsamples'), forms: Infinity },
  { group: 'synthetic', dir: join(packages, 'reportman-lib', 'test', 'fixtures', 'reports', 'synthetic'), forms: Infinity },
  { group: 'chart', dir: join(packages, 'reportman-engine', 'test', 'fixtures', 'chart'), forms: 4 },
  { group: 'barcode', dir: join(packages, 'reportman-engine', 'test', 'fixtures', 'barcode'), forms: 4 },
  { group: 'images', dir: join(packages, 'reportman-engine', 'test', 'fixtures', 'images'), forms: 4 },
  { group: 'run', dir: join(packages, 'reportman-engine', 'test', 'fixtures', 'run'), forms: 4 },
  { group: 'freetype', dir: join(packages, 'reportman-engine', 'test', 'fixtures', 'freetype'), forms: 2 },
  { group: 'http', dir: join(packages, 'reportman-driver-http', 'test', 'fixtures', 'reports'), forms: 4 },
  { group: 'mssql', dir: join(packages, 'reportman-driver-mssql', 'test', 'fixtures', 'reports'), forms: 2 },
];

// The first vaUTF8String (20, an Int32 length and the bytes) with a character of two or more bytes,
// its first continuation byte changed to 'A': the lead byte then has no continuation
function breakUtf8(binary) {
  const bytes = Buffer.from(binary);
  for (let i = 4; i + 5 < bytes.length; i++) {
    if (bytes[i] !== 20) continue;
    const n = bytes.readInt32LE(i + 1);
    if (n <= 0 || i + 5 + n > bytes.length) continue;
    const value = bytes.subarray(i + 5, i + 5 + n);
    const at = value.findIndex((b) => b >= 0x80 && b < 0xc0);
    if (at < 0) continue;
    try {
      new TextDecoder('utf-8', { fatal: true }).decode(value);
    } catch {
      continue;
    }
    value[at] = 0x41;
    return bytes;
  }
  throw new Error('no vaUTF8String in the binary form of unicode.rep');
}

const work = mkdtempSync(join(tmpdir(), 'rm-golden-dfm-'));
const run = (args) => spawnSync(exe, args, { encoding: 'utf8' });
const skipped = [];
let count = 0;
for (const { group, dir, forms } of GROUPS) {
  const bundle = {};
  let withForms = 0;
  // (not the cases Delphi does not read as reports)
  for (const file of readdirSync(dir).filter((f) => f.toLowerCase().endsWith('.rep') && !f.startsWith('invalid-')).sort()) {
    const name = basename(file, '.rep');
    const r = run([join(dir, file), work, name]);
    if (r.status !== 0) {
      // The broken reports of the reader tests, and what Delphi itself can not read back
      skipped.push(`${group}/${file}: ${(r.stderr || r.stdout).trim().split('\n')[0]}`);
      continue;
    }
    const entry = {
      text: readFileSync(join(work, name + '.text.rep'), 'latin1'),
      xml: readFileSync(join(work, name + '.xml'), 'latin1'),
    };
    if (withForms < forms) {
      entry.binary = readFileSync(join(work, name + '.binary.rep')).toString('base64');
      entry.zlib = readFileSync(join(work, name + '.zlib.rep')).toString('base64');
      withForms++;
    }
    if (/[^\x00-\x7f]/.test(entry.text) || /[^\x00-\x7f]/.test(entry.xml)) throw new Error(`${group}/${name}: not ASCII`);
    bundle[name] = entry;
    // A vaUTF8String of the binary form Delphi wrote, made invalid UTF-8: cases/invalid-utf8.rep
    if (group === 'cases' && name === 'unicode') writeFileSync(join(cases, 'invalid-utf8.rep'), breakUtf8(readFileSync(join(work, name + '.binary.rep'))));
    count++;
  }
  writeFileSync(join(out, 'corpus', group + '.json.gz'), gzipSync(JSON.stringify(bundle), { level: 9 }));
  console.log(`${group}: ${Object.keys(bundle).length} reports`);
}

// The DFM reports as older versions of Delphi saved them
const originals = {};
const repsamples = join(delphi, 'repman', 'repsamples');
for (const file of readdirSync(repsamples).filter((f) => f.toLowerCase().endsWith('.rep')).sort()) {
  const bytes = readFileSync(join(repsamples, file));
  if (bytes[0] === 0x3c) continue; // XML
  const xmlFile = join(work, file + '.xml');
  const r = run(['-xml', join(repsamples, file), xmlFile]);
  if (r.status !== 0) {
    skipped.push(`originals/${file}: ${(r.stderr || r.stdout).trim().split('\n')[0]}`);
    continue;
  }
  originals[basename(file, '.rep')] = { dfm: bytes.toString('base64'), xml: readFileSync(xmlFile, 'latin1') };
}
writeFileSync(join(out, 'originals.json.gz'), gzipSync(JSON.stringify(originals), { level: 9 }));
console.log(`originals: ${Object.keys(originals).length} reports`);

// The XML Delphi writes for each hand-made report (test/make-dfm-cases.mjs), or the message of
// Delphi for the ones it can not read (invalid-*.rep)
for (const file of readdirSync(cases).filter((f) => /\.(xml|error)$/.test(f))) rmSync(join(cases, file));
for (const file of readdirSync(cases).filter((f) => f.endsWith('.rep')).sort()) {
  const name = basename(file, '.rep');
  const r = run(['-xml', join(cases, file), join(cases, name + '.xml')]);
  const invalid = name.startsWith('invalid-');
  if (invalid !== (r.status !== 0)) throw new Error('cases/' + file + ': ' + (invalid ? 'Delphi reads it' : r.stderr || r.stdout));
  if (!invalid) continue;
  writeFileSync(join(cases, name + '.error'), (r.stderr || r.stdout).trim() + '\n');
  // What ObjectTextToBinary itself makes of a text one, which readDfm reads too
  const bytes = readFileSync(join(cases, file));
  if (bytes[0] === 0x78 || bytes.subarray(0, 4).toString('latin1') === 'TPF0') continue;
  const t = run(['-textxml', join(cases, file), join(cases, name + '.text.xml')]);
  if (t.status !== 0) writeFileSync(join(cases, name + '.text.error'), (t.stderr || t.stdout).trim() + '\n');
}
console.log('cases: the XML of test/cases/*.rep');

// TEncoding.UTF8.GetString: the sequences of every kind, valid and not, and random bytes
const UTF8 = [
  '41', 'c3a9', 'e282ac', 'f09f9880', 'efbbbf41', '80', 'bf', 'c0af', 'c1bf', 'c2', 'c241', 'e2', 'e282', 'e28241', 'e2c3a9',
  'f09f98', 'f09f9841', 'e08080', 'e09f80', 'e0a080', 'eda080', 'edbfbf', 'ed9fbf', 'ee8080', 'efbfbd', 'efbfbf', 'f0808080',
  'f08f8080', 'f0908080', 'f48fbfbf', 'f4908080', 'f5808080', 'f8888080', 'fe', 'ff', 'fffe', '41e2828241', 'c380',
  'eda080edb080', 'f0', 'f041', 'f09f', 'e0', 'e041', 'e0a0', 'e0a041', 'f4', 'f48f', 'f48fbf', '8080', 'c3c3a9', 'e2e282ac',
  'f0f09f9880', 'c0', 'c1', 'c041', 'f5', 'f541', 'f7bfbfbf', '00', 'c280', 'dfbf', 'e0a0bf', 'f09080bf',
];
// A random sequence of its own for each fixture, so that one does not change the others
const sequence = (start) => {
  let seed = start;
  return () => {
    seed = (seed * 1103515245 + 12345) % 2147483648;
    return seed / 2147483648;
  };
};
let random = sequence(1122);
const LEADS = [0x41, 0x7f, 0x80, 0xbf, 0xc0, 0xc2, 0xdf, 0xe0, 0xe1, 0xed, 0xee, 0xef, 0xf0, 0xf1, 0xf4, 0xf5, 0xff];
for (let i = 0; i < 200; i++) {
  const n = 1 + Math.floor(random() * 6);
  const bytes = [];
  for (let j = 0; j < n; j++) bytes.push(random() < 0.4 ? LEADS[Math.floor(random() * LEADS.length)] : 0x80 + Math.floor(random() * 0x40));
  UTF8.push(Buffer.from(bytes).toString('hex'));
}
const utf8 = {};
for (let i = 0; i < UTF8.length; i += 50) {
  const chunk = UTF8.slice(i, i + 50);
  const r = run(['-utf8', ...chunk]);
  if (r.status !== 0) throw new Error('utf8: ' + r.stderr);
  r.stdout.trim().split(/\r?\n/).forEach((line, j) => (utf8[chunk[j]] = line === 'ERROR' ? null : line.toLowerCase()));
}
writeFileSync(join(out, 'utf8.json'), JSON.stringify(utf8, null, 1) + '\n');
console.log(`utf8: ${UTF8.length} byte sequences`);

// TWriter.WriteString and TReader.ReadString: strings of every length and kind of character,
// with paired and lone surrogates
const UNITS = [0x41, 0x7f, 0xe9, 0x7ff, 0x800, 0x4e2d, 0xfeff, 0xfffd, 0xfffe, 0xd83d, 0xde00, 0xd800, 0xdc00];
const strings = ['', 'A', '\xe9', 'AB', 'AB\xe9', '中', '中中', 'A中', 'A\ud83d', '\ud83d', 'A😀', '😀',
  'AB\ud800', '\udc00', 'AB\udc00\ud800', 'ABCD\ud800', 'AB￾', 'A﻿', '\x7f\x80\x81', 'x'.repeat(300), '\xe9'.repeat(200),
  'A'.repeat(255) + '\ud800', '\ud800'.repeat(3) + 'ABCDEFGHIJ'];
for (let i = 0; i < 150; i++) {
  const n = 1 + Math.floor(random() * 12);
  let s = '';
  for (let j = 0; j < n; j++) s += String.fromCharCode(random() < 0.5 ? 0x20 + Math.floor(random() * 0x5f) : UNITS[Math.floor(random() * UNITS.length)]);
  strings.push(s);
}
const unitsHex = (s) => Array.from({ length: s.length }, (_, k) => s.charCodeAt(k).toString(16).padStart(4, '0')).join('');
const writeString = {};
for (let i = 0; i < strings.length; i += 40) {
  const chunk = strings.slice(i, i + 40);
  // The empty string as '-' (Windows drops an empty argument)
  const r = run(['-writestring', ...chunk.map((s) => (s.length === 0 ? '-' : unitsHex(s)))]);
  if (r.status !== 0) throw new Error('writestring: ' + r.stderr);
  const lines = r.stdout.split(/\r?\n/).slice(0, chunk.length);
  chunk.forEach((s, j) => {
    const [tag, back = ''] = lines[j].trim().split(' ');
    writeString[unitsHex(s)] = { type: Number(tag), value: back.toLowerCase() };
  });
}
writeFileSync(join(out, 'writestring.json'), JSON.stringify(writeString, null, 1) + '\n');
console.log(`writestring: ${strings.length} strings`);

// AnsiUpperCase of every code unit, as runs of the ones it maps: [first, count, delta, step]
const upperFile = join(work, 'upper.bin');
const ur = run(['-upper', upperFile]);
if (ur.status !== 0) throw new Error('upper: ' + ur.stderr);
const upperBytes = readFileSync(upperFile);
const mapped = [];
for (let c = 0; c < 0x10000; c++) {
  const d = upperBytes.readUInt16LE(c * 2);
  if (d !== c) mapped.push([c, d - c]);
}
const runs = [];
for (let i = 0; i < mapped.length; ) {
  const [c, delta] = mapped[i];
  let best = { count: 1, step: 1 };
  for (const step of [1, 2]) {
    let n = 1;
    while (i + n < mapped.length && mapped[i + n][0] === c + n * step && mapped[i + n][1] === delta) n++;
    if (n > best.count) best = { count: n, step };
  }
  runs.push(c, best.count, delta, best.step);
  i += best.count;
}
const runLines = [];
for (let i = 0; i < runs.length; i += 24) runLines.push('  ' + runs.slice(i, i + 24).join(', ') + ',');
writeFileSync(
  join(here, '..', 'src', 'ansi-upper-table.ts'),
  `// Generated by test/generate-dfm-fixtures.mjs from AnsiUpperCase of Delphi on Windows (CharUpperBuff,
// tools/golden-dfm -upper): the ${mapped.length} UTF-16 code units it maps, as runs of four numbers: the first
// code unit, how many there are, what is added to each one and the step from one to the next.
export const ANSI_UPPER_RUNS: readonly number[] = [
${runLines.join('\n')}
];
`,
);
console.log(`upper: ${mapped.length} code units in ${runs.length / 4} runs`);

// The doubles of the XML (WritePropertyD, RpDoubleToStr: FloatToStr): fixtures/floats.json, the
// text Delphi writes for each double (by the hexadecimal of its bits)
random = sequence(20261122);
const doubles = [
  0, -0, 1, 2, -1, 0.5, 1234.5678, 0.406597222222222, 45823.77083333333, 0.0001, 0.00001, 0.000123, -73046, 123456789012345,
  1234567890123456, 999999999999999.9, 1e15, 1e16, 1.5e20, 1e-10, 0.1, 1 / 3, 2 / 3, 0.30000000000000004, 5e-324, 1.7976931348623157e308,
  -2.5e-7, 45351, 0.99999999999999989, 9.999999999999999e-5, 1e21, 123.456e10,
];
for (let i = 0; i < 400; i++) {
  const magnitude = Math.floor(random() * 50) - 25;
  const v = (random() - 0.3) * Math.pow(10, magnitude);
  doubles.push(i % 3 === 0 ? Number(v.toPrecision(1 + Math.floor(random() * 17))) : v);
}
const bits = (v) => {
  const b = Buffer.alloc(8);
  b.writeDoubleLE(v);
  return b.readBigUInt64LE().toString(16).padStart(16, '0');
};
const keys = doubles.map(bits);
const floats = {};
for (let i = 0; i < keys.length; i += 50) {
  const chunk = keys.slice(i, i + 50);
  const r = run(['-floats', ...chunk]);
  if (r.status !== 0) throw new Error('floats: ' + r.stderr);
  const lines = r.stdout.trim().split(/\r?\n/);
  chunk.forEach((k, j) => (floats[k] = lines[j]));
}
writeFileSync(join(out, 'floats.json'), JSON.stringify(floats, null, 1) + '\n');
console.log(`floats: ${keys.length} doubles`);
rmSync(work, { recursive: true, force: true });
console.log(`${count} reports; skipped:\n  ${skipped.join('\n  ')}`);
