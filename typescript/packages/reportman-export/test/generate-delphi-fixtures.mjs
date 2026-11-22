// The Delphi fixtures of svg-html.test.ts: for each report of delphi-cases.json, what the Delphi
// engine writes with ExportMetafileToSVG, ExportMetafileToHtml and ExportMetafileToHtmlSingle
// (tools/golden-delphi), from its first pages, and the metafile it wrote them from (meta.json),
// into fixtures/delphi/<name>/: meta.json, svg/, html/ and single/.
//
//   node packages/reportman-export/test/generate-delphi-fixtures.mjs [--no-build] [name...]
//
// Windows only: it builds golden-delphi with dcc32 of RAD Studio 13 (tools/golden-delphi/build.bat)
// against the Delphi repository, REPORTMAN_DELPHI (C:\desarrollo\prog\toni\reportman by default).
// The reports read samples/samples.db through their SQLite connection (FireDAC in Delphi).

import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const toolDir = path.resolve(here, '../../../tools/golden-delphi');
const exe = path.join(toolDir, 'bin_x86', 'golden-delphi.exe');
const out = path.join(here, 'fixtures', 'delphi');

if (process.platform !== 'win32') {
  console.error('golden-delphi is a Windows program (Delphi, Win32)');
  process.exit(1);
}

const args = process.argv.slice(2);
const build = !args.includes('--no-build');
const only = args.filter((a) => !a.startsWith('--'));

if (build) {
  const r = spawnSync('cmd.exe', ['/d', '/c', path.join(toolDir, 'build.bat')], { stdio: 'inherit' });
  if (r.status !== 0) process.exit(r.status ?? 1);
}
if (!fs.existsSync(exe)) {
  console.error('Not built: ' + exe);
  process.exit(1);
}

const cases = JSON.parse(fs.readFileSync(path.join(here, 'delphi-cases.json'), 'utf8'));
let failed = 0;
for (const c of cases) {
  if (only.length > 0 && !only.includes(c.name)) continue;
  const dir = path.join(out, c.name);
  fs.rmSync(dir, { recursive: true, force: true });
  const argv = [path.resolve(here, c.report), dir, '-name', c.name, '-caption', c.caption ?? ''];
  if (c.pages) argv.push('-pages', String(c.pages));
  // Delphi's ParamStr does not understand \" in an argument: the captions have no quotes
  if ((c.caption ?? '').includes('"')) throw new Error(c.name + ': a caption can not have quotes');
  const r = spawnSync(exe, argv, { encoding: 'utf8' });
  process.stdout.write(r.stdout);
  if (r.status !== 0) {
    console.error(c.name + ': ' + (r.stderr || 'exit code ' + r.status));
    failed++;
  }
}
process.exit(failed > 0 ? 1 : 0);
