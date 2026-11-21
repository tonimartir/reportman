// Reference results of the C# engine (golden-cs: Npgsql 10) for the PostgreSQL parity tests. It
// loads the test database (fixture.ts), writes the synthetic reports of cases.ts into fixtures/,
// and for each case runs golden-cs on PostgreSQL: the metafile JSON and the uncompressed PDF, or
// the error when the C# run fails. It also writes what Npgsql gives for the all_types table.
//
//   node test/generate-fixtures.ts [name...]      (from packages/reportman-driver-postgres,
//                                                  with the test server running, see fixture.ts)

import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { CASES, syntheticReports } from './cases.ts';
import { goldenCs, loadFixture, npgsqlConnectionString, repoRoot } from './fixture.ts';

const here = path.dirname(fileURLToPath(import.meta.url));
const out = path.join(here, 'fixtures');
fs.mkdirSync(out, { recursive: true });

await loadFixture();
const connection = 'PostgreSQL|' + npgsqlConnectionString();

for (const [name, xml] of Object.entries(syntheticReports())) fs.writeFileSync(path.join(out, name + '.rep'), xml);

/** The error golden-cs printed: its first line and the lines of the message, without the stack. */
function errorText(stderr: string): string {
  const lines = stderr.split(/\r?\n/);
  const end = lines.findIndex((l) => l.startsWith('   at '));
  return lines.slice(0, end < 0 ? lines.length : end).join('\n').trimEnd();
}

const only = process.argv.slice(2);
for (const c of CASES) {
  if (only.length > 0 && !only.includes(c.name)) continue;
  const report = c.report.startsWith('synthetic:') ? path.join(out, c.report.substring(10) + '.rep') : path.join(repoRoot, c.report);
  const meta = path.join(out, c.name + '.meta.json');
  const pdf = path.join(out, c.name + '.cs.pdf');
  const errFile = path.join(out, c.name + '.error.txt');
  for (const f of [meta, pdf, errFile]) if (fs.existsSync(f)) fs.unlinkSync(f);
  const args = ['run', report, meta, '--pdf', pdf];
  for (const alias of ['SAMPLES', ...(c.connections ?? [])]) args.push('--connection', alias + '=' + connection);
  for (const [k, v] of Object.entries(c.params ?? {})) args.push('--param', k + '=' + v);
  if (c.culture !== undefined) args.push('--culture', c.culture);
  const r = spawnSync(goldenCs, args, { encoding: 'utf8' });
  if (r.status !== 0) {
    const text = errorText(r.stderr || r.stdout);
    fs.writeFileSync(errFile, text);
    for (const f of [meta, pdf]) if (fs.existsSync(f)) fs.unlinkSync(f);
    console.log(c.name + ': ' + text.split('\n')[0]);
  } else {
    // Compact JSON: the fixtures are compared as objects
    fs.writeFileSync(meta, JSON.stringify(JSON.parse(fs.readFileSync(meta, 'utf8'))));
    console.log(c.name + ': ' + r.stdout.trim());
  }
}

// What the C# engine receives for every type (GetSchemaTable and GetValue)
if (only.length === 0) {
  for (const [file, sql, culture] of [
    ['all_types.sql.json', 'SELECT * FROM all_types ORDER BY id', 'en-US'],
    ['all_types-es.sql.json', 'SELECT id, c_numrange, c_daterange, c_tsrange, c_tstzrange FROM all_types ORDER BY id', 'es-ES'],
  ] as const) {
    const r = spawnSync(goldenCs, ['sql', connection, sql, path.join(out, file), '--culture', culture], { encoding: 'utf8' });
    if (r.status !== 0) throw new Error(r.stderr);
    console.log(file + ': written');
  }
}
