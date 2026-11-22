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
//   fixtures/floats.json              the doubles as FloatToStr writes them
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
const GROUPS = [
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

const work = mkdtempSync(join(tmpdir(), 'rm-golden-dfm-'));
const run = (args) => spawnSync(exe, args, { encoding: 'utf8' });
const skipped = [];
let count = 0;
for (const { group, dir, forms } of GROUPS) {
  const bundle = {};
  let withForms = 0;
  for (const file of readdirSync(dir).filter((f) => f.toLowerCase().endsWith('.rep')).sort()) {
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

// The hand-made reports (test/make-dfm-cases.mjs) and the XML Delphi writes for each one
spawnSync(process.execPath, [join(here, 'make-dfm-cases.mjs')], { stdio: 'inherit' });
const cases = join(here, 'cases');
for (const file of readdirSync(cases).filter((f) => f.endsWith('.rep')).sort()) {
  const r = run(['-xml', join(cases, file), join(cases, basename(file, '.rep') + '.xml')]);
  if (r.status !== 0) throw new Error('cases/' + file + ': ' + (r.stderr || r.stdout));
}
console.log('cases: the XML of test/cases/*.rep');

// The doubles of the XML (WritePropertyD, RpDoubleToStr: FloatToStr): fixtures/floats.json, the
// text Delphi writes for each double (by the hexadecimal of its bits)
let seed = 20261122;
const random = () => {
  seed = (seed * 1103515245 + 12345) % 2147483648;
  return seed / 2147483648;
};
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
