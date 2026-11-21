// Reference runs of the C# engine for barcode-parity.test.ts: for each case of barcode-cases.json,
// golden-cs runs the report on samples.db and writes the metafile JSON and the uncompressed PDF,
// kept gzipped in fixtures/barcode/ (NAME.meta.json.gz, NAME.cs.pdf.gz: a barcode is thousands of
// rectangles). A case whose run fails writes the error instead (NAME.error.txt), so the TypeScript
// engine can be checked to fail the same way.
//
//   node test/generate-barcode-fixtures.mjs [name...]     (from packages/reportman-engine)

import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import zlib from 'node:zlib';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '../../../..');
const exe = path.join(root, 'typescript/tools/golden-cs/bin/Release/net10.0/golden-cs.exe');
const db = path.join(root, 'samples/samples.db');
const out = path.join(here, 'fixtures/barcode');
fs.mkdirSync(out, { recursive: true });

const gzip = (bytes) => zlib.gzipSync(bytes, { level: 9 });

const cases = JSON.parse(fs.readFileSync(path.join(here, 'barcode-cases.json'), 'utf8'));
const only = process.argv.slice(2);
for (const c of cases) {
  if (only.length > 0 && !only.includes(c.name)) continue;
  const report = path.resolve(here, c.report);
  const meta = path.join(out, c.name + '.meta.json');
  const pdf = path.join(out, c.name + '.cs.pdf');
  const errFile = path.join(out, c.name + '.error.txt');
  for (const f of [meta, pdf, meta + '.gz', pdf + '.gz', errFile]) if (fs.existsSync(f)) fs.unlinkSync(f);
  const args = ['run', report, meta, '--pdf', pdf, '--sqlite', db];
  for (const [k, v] of Object.entries(c.params ?? {})) args.push('--param', k + '=' + v);
  if (c.culture) args.push('--culture', c.culture);
  const r = spawnSync(exe, args, { encoding: 'utf8' });
  if (r.status !== 0) {
    const first = (r.stderr || r.stdout).split(/\r?\n/)[0];
    fs.writeFileSync(errFile, first);
    console.log(c.name + ': ' + first);
  } else {
    // Compact JSON: the fixtures are compared as objects
    fs.writeFileSync(meta + '.gz', gzip(Buffer.from(JSON.stringify(JSON.parse(fs.readFileSync(meta, 'utf8'))))));
    fs.writeFileSync(pdf + '.gz', gzip(fs.readFileSync(pdf)));
    console.log(c.name + ': ' + r.stdout.trim());
  }
  for (const f of [meta, pdf]) if (fs.existsSync(f)) fs.unlinkSync(f);
}
