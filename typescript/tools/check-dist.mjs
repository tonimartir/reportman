// Loads every package of the workspace from its build (dist/) in plain Node — what an npm user
// gets, where the vitest runs, which resolve the sources with Vite, cannot show module loading
// problems — and runs the reportman-pdf command line on the samples. Run `npm run build` first.
import { readdirSync, readFileSync, mkdtempSync, rmSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { execFileSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const packagesDir = join(root, 'packages');
const samples = join(root, '..', 'samples');
let failed = false;

for (const name of readdirSync(packagesDir)) {
  const pkg = JSON.parse(readFileSync(join(packagesDir, name, 'package.json'), 'utf8'));
  const entry = join(packagesDir, name, pkg.exports['.'].default);
  try {
    const mod = await import(pathToFileURL(entry).href);
    console.log(`ok   ${name}: ${Object.keys(mod).length} exports`);
  } catch (e) {
    failed = true;
    console.error(`FAIL ${name}: ${e.message.split('\n')[0]}`);
  }
  // A CommonJS program requires the package by its name (require(esm), Node >= 22.12): the
  // "default" condition of its exports and no top-level await in the modules it loads
  try {
    const out = execFileSync(
      process.execPath,
      ['--input-type=commonjs', '-e', `console.log(Object.keys(require(${JSON.stringify(pkg.name)})).length)`],
      { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] },
    );
    console.log(`ok   require('${pkg.name}') from CommonJS: ${out.trim()} exports`);
  } catch (e) {
    failed = true;
    const text = (e.stderr?.toString() || e.message).split('\n').filter((l) => /Error|error/.test(l))[0] ?? e.message;
    console.error(`FAIL require('${pkg.name}') from CommonJS: ${text}`);
  }
}

const out = mkdtempSync(join(tmpdir(), 'reportman-check-'));
try {
  const cli = join(packagesDir, 'reportman-node', 'dist', 'cli.js');
  for (const report of ['customers', 'invoices', 'labels', 'product-catalog', 'monthly-sales', 'sales-by-category', 'fishes', 'contacts', 'year-over-year']) {
    const pdf = join(out, report + '.pdf');
    try {
      execFileSync(process.execPath, [cli, join(samples, report + '.rep'), '-o', pdf, '--sqlite', 'SAMPLES=' + join(samples, 'samples.db')], {
        stdio: ['ignore', 'ignore', 'pipe'],
      });
      const head = readFileSync(pdf).subarray(0, 5).toString('latin1');
      if (head !== '%PDF-') throw new Error('not a PDF');
      console.log(`ok   reportman-pdf ${report}.rep`);
    } catch (e) {
      failed = true;
      console.error(`FAIL reportman-pdf ${report}.rep: ${(e.stderr?.toString() || e.message).split('\n').filter((l) => l && !/ExperimentalWarning|trace-warnings/.test(l))[0]}`);
    }
  }
} finally {
  rmSync(out, { recursive: true, force: true });
}
process.exit(failed ? 1 : 0);
