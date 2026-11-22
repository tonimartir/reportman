// Loads every package of the workspace from its build (dist/) in plain Node — what an npm user
// gets, where the vitest runs, which resolve the sources with Vite, cannot show module loading
// problems — and runs the reportman-pdf command line on the samples. Run `npm run build` first.
import { readdirSync, readFileSync, mkdtempSync, rmSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { execFileSync, spawn } from 'node:child_process';
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

// The reportman-dfm2xml command line: a DFM report of test/cases to the XML Delphi writes for it
try {
  const cases = join(packagesDir, 'reportman-dfm', 'test', 'cases');
  const xml = execFileSync(process.execPath, [join(packagesDir, 'reportman-dfm', 'dist', 'cli.js'), join(cases, 'values.rep')], { maxBuffer: 1 << 26 });
  if (!xml.equals(readFileSync(join(cases, 'values.xml')))) throw new Error('not the XML of Delphi');
  console.log('ok   reportman-dfm2xml values.rep');
} catch (e) {
  failed = true;
  console.error('FAIL reportman-dfm2xml: ' + e.message.split('\n')[0]);
}

// The reportman-server command line: a data folder with the samples, the console page and key
// (read from the folder), a sample run through the reports API with the connection the samples
// installed, and the CSV of the report
const data = mkdtempSync(join(tmpdir(), 'reportman-server-'));
const child = spawn(process.execPath, [join(packagesDir, 'reportman-server', 'dist', 'cli.js'), '--data', data, '--port', '0', '--samples', '--standard-fonts'], {
  stdio: ['ignore', 'pipe', 'pipe'],
});
try {
  let output = '';
  const url = await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('no answer in 30 s: ' + output)), 30000);
    child.stdout.on('data', (chunk) => {
      output += chunk;
      const m = /on (http:\/\/127\.0\.0\.1:\d+)\//.exec(output);
      if (m !== null && /Console key: /.test(output)) {
        clearTimeout(timer);
        resolve(m[1]);
      }
    });
    child.stderr.on('data', (chunk) => (output += chunk));
    child.on('exit', (code) => reject(new Error('exited with ' + code + ': ' + output)));
  });
  const key = readFileSync(join(data, 'console.key'), 'utf8').trim();
  if (!output.includes('Console key: ' + key)) throw new Error('the key printed is not the one of console.key');
  const page = await fetch(url + '/');
  if (!(await page.text()).includes('<title>Report Manager Server</title>')) throw new Error('no console page');
  const connections = await (await fetch(url + '/api/connections', { headers: { 'X-ReportmanServer-AdminKey': key } })).json();
  if (!connections.some((c) => c.alias === 'SAMPLES')) throw new Error('no SAMPLES connection: ' + JSON.stringify(connections));
  const test = await (await fetch(url + '/api/connections/SAMPLES/test', { method: 'POST', headers: { 'X-ReportmanServer-AdminKey': key } })).json();
  if (test.ok !== true) throw new Error('SAMPLES test: ' + test.message);
  const csv = await fetch(url + '/api/reports/INFORMES/execute?path=Ejemplos/customers.rep&format=csv');
  if (csv.status !== 200 || !(await csv.text()).includes('"Total customers"')) throw new Error('customers.rep to CSV: ' + csv.status);
  console.log('ok   reportman-server: console, samples, SAMPLES connection, customers.rep');
} catch (e) {
  failed = true;
  console.error('FAIL reportman-server: ' + e.message.split('\n')[0]);
} finally {
  child.kill();
  await new Promise((resolve) => setTimeout(resolve, 300));
  rmSync(data, { recursive: true, force: true });
}
process.exit(failed ? 1 : 0);
