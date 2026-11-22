// The CSV of the C# engine (PrintOutCSV.ExportToCSV, golden-cs run --csv) for the samples of
// run-cases.json of the engine, with the creation date of the C# PDF of each run (the clock of the
// TypeScript run, as the dates printed by TODAY and NOW go into the CSV):
//
//   test/fixtures/csv/cases.json      the cases and their clock
//   test/fixtures/csv/NAME.csv        what C# writes (on Windows: lines end with CR LF)
//
//   node test/generate-csv-fixtures.mjs        (from packages/reportman-export; golden-cs built)

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '../../../..');
const exe = path.join(root, 'typescript/tools/golden-cs/bin/Release/net10.0/golden-cs.exe');
const engineTest = path.join(root, 'typescript/packages/reportman-engine/test');
const db = path.join(root, 'samples/samples.db');
const out = path.join(here, 'fixtures/csv');
fs.mkdirSync(out, { recursive: true });

const runCases = JSON.parse(fs.readFileSync(path.join(engineTest, 'run-cases.json'), 'utf8'));
// The samples (not the synthetic reports), some with parameters or another culture
const names = ['customers', 'customers-es', 'invoices', 'invoices-range', 'labels', 'contacts', 'contacts-es', 'year-over-year', 'year-over-year-es'];
const work = fs.mkdtempSync(path.join(os.tmpdir(), 'rm-csv-'));
const result = [];
for (const name of names) {
  const c = runCases.find((x) => x.name === name);
  if (c === undefined) throw new Error('No run case ' + name);
  const report = path.resolve(engineTest, c.report);
  const pdf = path.join(work, name + '.pdf');
  const args = ['run', report, path.join(work, name + '.meta.json'), '--pdf', pdf, '--sqlite', db, '--csv', path.join(out, name + '.csv')];
  for (const [k, v] of Object.entries(c.params ?? {})) args.push('--param', k + '=' + v);
  if (c.culture) args.push('--culture', c.culture);
  const r = spawnSync(exe, args, { encoding: 'utf8' });
  if (r.status !== 0) throw new Error(name + ': ' + (r.stderr || r.stdout));
  const m = /\/CreationDate \((D:[^)]*)\)/.exec(fs.readFileSync(pdf).toString('latin1'));
  result.push({
    name,
    report: path.relative(here, report).split(path.sep).join('/'),
    ...(c.params === undefined ? {} : { params: c.params }),
    ...(c.culture === undefined ? {} : { culture: c.culture }),
    creationDate: m?.[1],
  });
  console.log(name + ': ' + r.stdout.trim());
}
fs.writeFileSync(path.join(out, 'cases.json'), JSON.stringify(result, null, 2) + '\n');
fs.rmSync(work, { recursive: true, force: true });
