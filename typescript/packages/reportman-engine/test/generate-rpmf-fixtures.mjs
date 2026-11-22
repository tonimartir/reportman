// The .rpmf files of the C# engine for rpmf-parity.test.ts: for a selection of the cases of the
// other parity tests (texts and shapes, several pages, page counts written afterwards,
// annotations, charts, barcodes, images in the page stream and in the shared stream, PDF/A with
// embedded files, a report without data), golden-cs runs the report as the parity test of the case
// does and saves its metafile with --rpmf (kept gzipped in fixtures/rpmf/NAME.rpmf.gz: a metafile
// is mostly zeros) and, for some, with --rpmfz too (NAME.rpmfz, compressed by the C# engine).
// fixtures/rpmf/cases.json keeps each case and the creation date of its C# PDF, the clock of the
// TypeScript run. A case whose run fails is left out (its own parity test checks the failure).
//
//   node test/generate-rpmf-fixtures.mjs [name...]     (from packages/reportman-engine)

import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import zlib from 'node:zlib';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '../../../..');
const exe = path.join(root, 'typescript/tools/golden-cs/bin/Release/net10.0/golden-cs.exe');
const db = path.join(root, 'samples/samples.db');
const out = path.join(here, 'fixtures/rpmf');
fs.mkdirSync(out, { recursive: true });

const gzip = (bytes) => zlib.gzipSync(bytes, { level: 9 });
const readJson = (file) => JSON.parse(fs.readFileSync(path.join(here, file), 'utf8'));

// The cases, by the list they come from. `folder`: the image expressions read their files there
// (golden-cs runs in it); `driver`: the PDF device golden-cs measures and prints with.
const sources = {
  run: { cases: readJson('run-cases.json') },
  chart: { cases: readJson('chart-cases.json') },
  barcode: { cases: readJson('barcode-cases.json') },
  images: { cases: readJson('fixtures/images/cases.json'), folder: 'fixtures/images' },
  freetype: { cases: readJson('freetype-cases.json'), driver: 'freetype' },
};
const selection = [
  { from: 'run', name: 'syn-nodata' }, // no data: a metafile without pages
  { from: 'run', name: 'syn-pagecount' }, // page counts written into the pools at the end
  { from: 'run', name: 'syn-multipage' }, // several pages, shapes
  { from: 'run', name: 'syn-layout', compressed: true }, // annotations: RPMETAFILE40, 74 byte records
  { from: 'run', name: 'invoices-range' }, // a sample with parameters
  { from: 'run', name: 'contacts-es' }, // another culture, accented texts
  { from: 'run', name: 'labels' }, // columns
  { from: 'chart', name: 'monthly-sales-range' }, // a chart sample
  { from: 'chart', name: 'ch-inf-bar' }, // a synthetic chart
  { from: 'barcode', name: 'bc-code128' }, // barcodes
  { from: 'images', name: 'img-styles', compressed: true }, // images in the page stream, every draw style
  { from: 'images', name: 'img-background' }, // shared images (the stream of the metafile), backgrounds
  { from: 'freetype', name: 'ft-pdfa', compressed: true }, // PDF/A-3: RPMETAFILE30, metadata, embedded files
];

const casesFile = path.join(out, 'cases.json');
const previous = new Map((fs.existsSync(casesFile) ? JSON.parse(fs.readFileSync(casesFile, 'utf8')) : []).map((c) => [c.name, c]));
const only = process.argv.slice(2);
const work = fs.mkdtempSync(path.join(os.tmpdir(), 'rm-rpmf-'));
const result = [];
for (const s of selection) {
  const source = sources[s.from];
  const c = source.cases.find((x) => x.name === s.name);
  if (c === undefined) throw new Error('No case ' + s.name + ' in ' + s.from);
  const folder = source.folder === undefined ? undefined : path.join(here, source.folder);
  const entry = {
    name: c.name,
    // Relative to test/, with forward slashes
    report: path.relative(here, path.resolve(folder ?? here, c.report)).split(path.sep).join('/'),
    ...(c.params === undefined ? {} : { params: c.params }),
    ...(c.culture === undefined ? {} : { culture: c.culture }),
    ...(source.folder === undefined ? {} : { folder: source.folder }),
    ...(source.driver === undefined ? {} : { driver: source.driver }),
    ...(s.compressed ? { compressed: true } : {}),
  };
  if (only.length > 0 && !only.includes(c.name)) {
    if (previous.has(c.name)) result.push(previous.get(c.name));
    continue;
  }
  const rpmf = path.join(work, c.name + '.rpmf');
  const pdf = path.join(work, c.name + '.pdf');
  const rpmfz = path.join(out, c.name + '.rpmfz');
  for (const f of [path.join(out, c.name + '.rpmf.gz'), rpmfz]) if (fs.existsSync(f)) fs.unlinkSync(f);
  const args = ['run', path.resolve(here, entry.report), path.join(work, c.name + '.meta.json'), '--pdf', pdf, '--sqlite', db, '--rpmf', rpmf];
  if (s.compressed) args.push('--rpmfz', rpmfz);
  for (const [k, v] of Object.entries(c.params ?? {})) args.push('--param', k + '=' + v);
  if (c.culture) args.push('--culture', c.culture);
  if (source.driver) args.push('--driver', source.driver);
  const r = spawnSync(exe, args, { encoding: 'utf8', cwd: folder ?? here });
  if (r.status !== 0) {
    console.log(c.name + ': ' + (r.stderr || r.stdout).split(/\r?\n/)[0] + ' (left out)');
    continue;
  }
  // The clock of the run: the creation date of its PDF (none for a report without data)
  if (fs.existsSync(pdf)) {
    const m = /\/CreationDate \((D:[^)]*)\)/.exec(fs.readFileSync(pdf).toString('latin1'));
    if (m !== null) entry.creationDate = m[1];
  }
  const bytes = fs.readFileSync(rpmf);
  fs.writeFileSync(path.join(out, c.name + '.rpmf.gz'), gzip(bytes));
  result.push(entry);
  console.log(c.name + ': ' + r.stdout.trim() + ', ' + bytes.subarray(0, 12).toString('latin1') + ', ' + bytes.length + ' bytes');
}
fs.rmSync(work, { recursive: true, force: true });
fs.writeFileSync(casesFile, JSON.stringify(result, null, 1) + '\n');
