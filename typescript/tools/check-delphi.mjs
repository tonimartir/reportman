// The PDF of the TypeScript engine against the one of the Delphi engine for the reports of the corpus
// (the samples and the runnable reports of repman/repsamples), what a Delphi user sees today:
// tools/golden-delphi -pdf writes the Delphi PDF as printreptopdf does (the PDF driver measures, the
// metafile saved with SaveMetafileToPDF), @reportman/node the TypeScript one with the TrueType fonts
// of the system (the FreeType driver of C#, which the TypeScript engine matches object by object).
// For each report: the pages, the words of the text that are not in the other one (pdftotext,
// compared as a multiset: the order follows the positions) and the share of pixels that differ
// (pdftoppm -gray at 72 dpi, by more than 32 levels). The engines differ where C# and Delphi do
// (DirectWrite against FreeType metrics, the charts without TeeChart), so it is a measure, not a
// test: the parity tests check the TypeScript engine against C#.
//
//   node tools/check-delphi.mjs [name...]     (Windows; npm run build and tools/golden-delphi/build.bat
//                                               first; pdftotext on the PATH, pdftoppm in WSL)
import { execFileSync, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const golden = path.join(root, 'tools', 'golden-delphi', 'bin_x86', 'golden-delphi.exe');
if (process.platform !== 'win32' || !fs.existsSync(golden)) {
  console.log('skip: Windows with tools/golden-delphi built (build.bat)');
  process.exit(0);
}
const { openReport, sqlite } = await import(pathToFileURL(path.join(root, 'packages', 'reportman-node', 'dist', 'index.js')).href);
const samples = path.join(root, '..', 'samples');
const repsamples = path.join(root, 'packages', 'reportman-engine', 'test', 'fixtures', 'repsamples');
const CASES = [
  ...['customers', 'invoices', 'labels', 'product-catalog', 'monthly-sales', 'sales-by-category', 'fishes', 'letter', 'international', 'contacts', 'year-over-year'].map(
    (n) => ({ name: n, report: path.join(samples, n + '.rep') }),
  ),
  // sample4 runs only in Delphi (a MyBase .cds dataset); firedactest and sqlite_clientes ask Delphi for
  // a connection TEST its dbxconnections.ini does not have
  ...['arab2wordwrap', 'arabonly', 'bold', 'bold_nospecial', 'boldold', 'testpdf417', 'htmltest', 'debugagent', 'medianchart'].map((n) => ({
    name: 'rs-' + n,
    report: path.join(repsamples, n + '.rep'),
  })),
];
const only = process.argv.slice(2);
const work = fs.mkdtempSync(path.join(os.tmpdir(), 'rm-check-delphi-'));
const wslPath = (p) => '/mnt/' + p[0].toLowerCase() + p.slice(2).replace(/\\/g, '/');
const words = (file) => execFileSync('pdftotext', ['-enc', 'UTF-8', file, '-'], { encoding: 'utf8' }).split(/\s+/).filter(Boolean);

/** The pages of a PDF as gray images (P5). */
function raster(file, name) {
  const prefix = path.join(work, name);
  execFileSync('wsl', ['-e', 'pdftoppm', '-gray', '-r', '72', wslPath(file), wslPath(prefix)]);
  return fs
    .readdirSync(work)
    .filter((f) => f.startsWith(name + '-') && f.endsWith('.pgm'))
    .sort()
    .map((f) => {
      const buf = fs.readFileSync(path.join(work, f));
      const header = buf.subarray(0, 64).toString('latin1').split(/\s+/);
      const size = buf.length - Number(header[1]) * Number(header[2]);
      return buf.subarray(size);
    });
}

/** The words of one list that are not in the other (as multisets). */
function missing(a, b) {
  const count = new Map();
  for (const w of b) count.set(w, (count.get(w) ?? 0) + 1);
  const out = [];
  for (const w of a) {
    const n = count.get(w) ?? 0;
    if (n > 0) count.set(w, n - 1);
    else out.push(w);
  }
  return out;
}

console.log('| Report | Pages Delphi / TS | Words only in Delphi | Words only in TS | Pixels that differ |');
console.log('|---|---|---|---|---|');
try {
  for (const c of CASES) {
    if (only.length > 0 && !only.includes(c.name)) continue;
    const delphiPdf = path.join(work, c.name + '.delphi.pdf');
    const tsPdf = path.join(work, c.name + '.ts.pdf');
    // From the folder of the report, as printreptopdf: its relative files and connections
    const r = spawnSync(golden, [c.report, path.join(work, c.name), '-pdf', delphiPdf], { cwd: path.dirname(c.report), encoding: 'utf8' });
    if (r.status !== 0) {
      console.log(`| ${c.name} | Delphi fails: ${(r.stderr || r.stdout).trim().split('\n')[0]} | | | |`);
      continue;
    }
    const report = await openReport(c.report, { fonts: {}, connections: { SAMPLES: sqlite(path.join(samples, 'samples.db')) } });
    fs.writeFileSync(tsPdf, await report.executeToPdf());
    const a = raster(delphiPdf, c.name + '-d');
    const b = raster(tsPdf, c.name + '-t');
    let differ = 0;
    let total = 0;
    for (let p = 0; p < Math.min(a.length, b.length); p++) {
      const n = Math.min(a[p].length, b[p].length);
      for (let k = 0; k < n; k++) if (Math.abs(a[p][k] - b[p][k]) > 32) differ++;
      total += n;
    }
    const wd = words(delphiPdf);
    const wt = words(tsPdf);
    const show = (list) => (list.length === 0 ? '0' : `${list.length}: ${list.slice(0, 4).join(' ')}${list.length > 4 ? ' ...' : ''}`);
    console.log(`| ${c.name} | ${a.length} / ${b.length} | ${show(missing(wd, wt))} | ${show(missing(wt, wd))} | ${total === 0 ? '-' : ((100 * differ) / total).toFixed(2) + ' %'} |`);
  }
} finally {
  fs.rmSync(work, { recursive: true, force: true });
}
