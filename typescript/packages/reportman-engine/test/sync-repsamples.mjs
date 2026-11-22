// Copies the reports of repman/repsamples of the Delphi repository into fixtures/repsamples, the part
// of the corpus of the plan (F0) that comes from Delphi: the XML ones as they are and the DFM ones
// converted with @reportman/dfm (the XML Delphi writes for them, reptotxt -xml), with the SQLite
// database some of them read (clientes.db). The cases of run-cases.json and freetype-cases.json run
// the ones both engines can run; generate-run-fixtures.mjs and generate-freetype-fixtures.mjs write
// what C# gives for them.
//
//   node test/sync-repsamples.mjs     (from packages/reportman-engine; npm run build first)
//
// Not copied, as no engine can run them here: mod130 and mod300 (the tables of an invoicing
// database), testorder (SQL of another server), debugagentexample (a Hub database).

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const delphi = process.env.REPORTMAN_DELPHI ?? 'C:/desarrollo/prog/toni/reportman';
const source = path.join(delphi, 'repman', 'repsamples');
const out = path.join(here, 'fixtures', 'repsamples');
const { dfmToXml, reportForm } = await import(pathToFileURL(path.join(here, '..', '..', 'reportman-dfm', 'dist', 'index.js')).href);

const SKIP = new Set(['mod130.rep', 'mod300.rep', 'testorder.rep', 'debugagentexample.rep']);
fs.mkdirSync(out, { recursive: true });
for (const file of fs.readdirSync(source).sort()) {
  if (!file.toLowerCase().endsWith('.rep') || SKIP.has(file.toLowerCase())) continue;
  const bytes = new Uint8Array(fs.readFileSync(path.join(source, file)));
  const form = reportForm(bytes);
  const xml = form === 'xml' ? bytes : dfmToXml(bytes);
  fs.writeFileSync(path.join(out, file), xml);
  console.log(`${file}: ${form === 'xml' ? 'XML' : 'converted from ' + form}`);
}
fs.copyFileSync(path.join(source, 'clientes.db'), path.join(out, 'clientes.db'));
console.log('clientes.db');
