// Generates test/fixtures/freetype: each case of freetype-cases.json run by the C# engine with the
// FreeType driver (golden-cs run --driver freetype: PrintOutPDFFreeType, fonts from the system font
// folders), its metafile as JSON and its PDF (gzipped), and the fingerprint of the font files of the
// machine (fonts.json): the PDFs embed those fonts, and the tests only compare on the same fonts.
//
//   node packages/reportman-engine/test/generate-freetype-fixtures.mjs     (from typescript/, Windows)

import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '../../../..');
const golden = path.join(root, 'typescript/tools/golden-cs/bin/Release/net10.0/golden-cs.exe');
const db = path.join(root, 'samples/samples.db');
const out = path.join(here, 'fixtures/freetype');
fs.mkdirSync(out, { recursive: true });

const cases = JSON.parse(fs.readFileSync(path.join(here, 'freetype-cases.json'), 'utf8'));
for (const c of cases) {
  const report = path.resolve(here, c.report);
  const metaFile = path.join(out, c.name + '.meta.json');
  const pdfFile = path.join(out, c.name + '.cs.pdf');
  const args = ['run', report, metaFile, '--pdf', pdfFile, '--sqlite', db, '--driver', 'freetype'];
  for (const [k, v] of Object.entries(c.params ?? {})) args.push('--param', k + '=' + v);
  if (c.culture) args.push('--culture', c.culture);
  const errorFile = path.join(out, c.name + '.error.txt');
  try {
    execFileSync(golden, args, { stdio: ['ignore', 'pipe', 'pipe'] });
    if (fs.existsSync(errorFile)) fs.rmSync(errorFile);
  } catch (e) {
    fs.writeFileSync(errorFile, String(e.stderr ?? e.message));
    console.log(c.name, 'fails in C#');
    continue;
  }
  if (fs.existsSync(pdfFile)) {
    fs.writeFileSync(pdfFile + '.gz', zlib.gzipSync(fs.readFileSync(pdfFile), { level: 9 }));
    fs.rmSync(pdfFile);
  }
  console.log(c.name);
}

// The font files the PDFs were made with
const dirs = [path.join(process.env.SystemRoot ?? 'C:\\Windows', 'FONTS')];
const local = process.env.LOCALAPPDATA;
if (local) {
  const userFonts = path.join(local, 'Microsoft', 'Windows', 'Fonts');
  if (fs.existsSync(userFonts)) dirs.push(userFonts);
}
const files = [];
const walk = (d) => {
  for (const e of fs.readdirSync(d, { withFileTypes: true })) {
    const full = path.join(d, e.name);
    if (e.isDirectory()) walk(full);
    else if (/\.(ttf|ttc|otf)$|\.pf/i.test(e.name)) files.push(e.name.toLowerCase() + ':' + fs.statSync(full).size);
  }
};
for (const d of dirs) walk(d);
fs.writeFileSync(path.join(out, 'fonts.json'), JSON.stringify(files.sort(), null, 1) + '\n');
