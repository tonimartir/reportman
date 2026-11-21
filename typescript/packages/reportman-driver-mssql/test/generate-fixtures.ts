// Reference outputs of the C# engine on SQL Server (Microsoft.Data.SqlClient 6.1, golden-cs) for the
// tests:
//
//   1. the report copies whose SQL is adapted to SQL Server and the synthetic reports
//      (fixtures/reports/), from cases.ts;
//   2. for each report case, the metafile JSON and the uncompressed PDF golden-cs writes
//      (fixtures/run/), or the error of the run (NAME.error.json), and the statements SqlClient sent
//      to the server (NAME.statements.json, from the Extended Events session of trace.ts);
//   3. for each query, the columns and values SqlClient reads (fixtures/sql/), or its error.
//
//   node test/generate-fixtures.ts [name...]      (from packages/reportman-driver-mssql, with the
//                                                   test database running)

import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { CASES, QUERIES, fixtures, reportFile, writeReports } from './cases.ts';
import { connectionString, loadDatabase } from './database.ts';
import { goldenError, goldenExe } from './golden.ts';
import { startTrace, traceApp, tracedStatements } from './trace.ts';

const provider = 'SQLServer';

async function main(): Promise<void> {
  const only = process.argv.slice(2);
  const wanted = (name: string): boolean => only.length === 0 || only.includes(name);
  await loadDatabase();
  await startTrace();
  writeReports();
  const stamp = Date.now().toString(36);

  const runDir = path.join(fixtures, 'run');
  fs.mkdirSync(runDir, { recursive: true });
  for (const c of CASES) {
    if (!wanted(c.name)) continue;
    const meta = path.join(runDir, c.name + '.meta.json');
    const pdf = path.join(runDir, c.name + '.cs.pdf');
    const errFile = path.join(runDir, c.name + '.error.json');
    const statementsFile = path.join(runDir, c.name + '.statements.json');
    for (const f of [meta, pdf, errFile, statementsFile]) if (fs.existsSync(f)) fs.unlinkSync(f);
    const app = traceApp('cs-' + c.name + '-' + stamp);
    const options = [c.csOptions ?? '', 'Application Name=' + app].filter((o) => o.length > 0).join(';');
    const args = ['run', reportFile(c.golden ?? c.report), meta, '--pdf', pdf];
    for (const alias of ['SAMPLES', ...(c.connections ?? [])]) args.push('--connection', alias + '=' + provider + '|' + connectionString(options));
    for (const [k, v] of Object.entries(c.params ?? {})) args.push('--param', k + '=' + v);
    if (c.culture !== undefined) args.push('--culture', c.culture);
    const r = spawnSync(goldenExe, args, { encoding: 'utf8' });
    if (r.status !== 0) {
      for (const f of [meta, pdf]) if (fs.existsSync(f)) fs.unlinkSync(f);
      const e = goldenError(r.stderr || r.stdout);
      fs.writeFileSync(errFile, JSON.stringify(e, null, 2) + '\n');
      console.log(c.name + ': ' + e.error + ': ' + e.message.split('\n')[0]);
    } else {
      fs.writeFileSync(meta, JSON.stringify(JSON.parse(fs.readFileSync(meta, 'utf8'))));
      console.log(c.name + ': ' + r.stdout.trim());
    }
    if (c.statements !== false) fs.writeFileSync(statementsFile, JSON.stringify(await tracedStatements(app), null, 2) + '\n');
  }

  const sqlDir = path.join(fixtures, 'sql');
  fs.mkdirSync(sqlDir, { recursive: true });
  for (const q of QUERIES) {
    if (!wanted(q.name)) continue;
    const out = path.join(sqlDir, q.name + '.json');
    if (fs.existsSync(out)) fs.unlinkSync(out);
    const args = ['sql', provider + '|' + connectionString(q.options ?? ''), q.sql, out];
    if (q.culture !== undefined) args.push('--culture', q.culture);
    const r = spawnSync(goldenExe, args, { encoding: 'utf8' });
    if (r.status !== 0) {
      if (fs.existsSync(out)) fs.unlinkSync(out);
      const e = goldenError(r.stderr || r.stdout);
      fs.writeFileSync(out, JSON.stringify(e, null, 2) + '\n');
      console.log(q.name + ': ' + e.error + ': ' + e.message.split('\n')[0]);
    } else {
      fs.writeFileSync(out, JSON.stringify(JSON.parse(fs.readFileSync(out, 'utf8')), null, 2) + '\n');
      console.log(q.name + ': ok');
    }
  }
}

main().catch((e: unknown) => {
  console.error(e);
  process.exit(1);
});
