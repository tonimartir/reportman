// @reportman/dfm against the Delphi engine on the DFM reports of a folder and its subfolders: the
// XML Delphi writes for each one (tools/golden-dfm -xml, as reptotxt -xml) and the XML of the
// converter (its build: npm run build first) must be the same bytes. Windows with tools/golden-dfm
// built; not part of tools/ci.mjs (the fixtures of test/dfm.test.ts are the check of the CI).
//
//   node tools/check-dfm.mjs <folder>...
import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const exe = join(root, 'tools', 'golden-dfm', 'bin_x86', 'golden-dfm.exe');
if (!existsSync(exe)) {
  console.log('skip: build tools/golden-dfm first (build.bat, Windows with RAD Studio)');
  process.exit(0);
}
const { dfmToXml, reportForm } = await import(pathToFileURL(join(root, 'packages', 'reportman-dfm', 'dist', 'index.js')).href);
const folders = process.argv.slice(2);
if (folders.length === 0) {
  console.error('Usage: node tools/check-dfm.mjs <folder>...');
  process.exit(2);
}

function reports(folder) {
  const result = [];
  for (const entry of readdirSync(folder, { withFileTypes: true })) {
    const path = join(folder, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === 'node_modules' || entry.name.startsWith('.')) continue;
      try {
        result.push(...reports(path));
      } catch {
        // a folder that can not be read
      }
    } else if (entry.isFile() && entry.name.toLowerCase().endsWith('.rep')) result.push(path);
  }
  return result;
}

const work = mkdtempSync(join(tmpdir(), 'rm-check-dfm-'));
let same = 0;
let different = 0;
let delphiFailed = 0;
let converterFailed = 0;
let readsMore = 0;
try {
  for (const folder of folders) {
    for (const file of reports(folder)) {
      let bytes;
      try {
        bytes = new Uint8Array(readFileSync(file));
      } catch {
        continue;
      }
      // XML is not converted; anything else is a DFM for one of the two, or for none
      let form;
      try {
        form = reportForm(bytes);
      } catch {
        form = 'refused';
      }
      if (form === 'xml' || form === 'zlib-xml') continue;
      const out = join(work, 'out.xml');
      rmSync(out, { force: true });
      const r = spawnSync(exe, ['-xml', file, out], { encoding: 'utf8' });
      if (r.status !== 0) {
        // Delphi does not read it: neither must the converter
        let converted = false;
        try {
          dfmToXml(bytes);
          converted = true;
        } catch {
          // refused too
        }
        if (converted) readsMore++;
        else delphiFailed++;
        console.log(`${converted ? 'CONVERTED    ' : 'both refuse  '} ${file}: ${(r.stderr || r.stdout).trim().split('\n')[0]}`);
        continue;
      }
      const expected = readFileSync(out);
      let actual;
      try {
        actual = Buffer.from(dfmToXml(bytes));
      } catch (e) {
        converterFailed++;
        console.log(`FAIL          ${file}: ${e.message}`);
        continue;
      }
      if (actual.equals(expected)) {
        same++;
        continue;
      }
      different++;
      const a = expected.toString('latin1').split('\r\n');
      const b = actual.toString('latin1').split('\r\n');
      const i = a.findIndex((l, k) => l !== b[k]);
      console.log(`DIFFERENT     ${file}: line ${i + 1}\n    Delphi: ${a[i]}\n    dfm:    ${b[i]}`);
    }
  }
} finally {
  rmSync(work, { recursive: true, force: true });
}
console.log(
  `${same} identical, ${different} different, ${converterFailed} failed in the converter, ${delphiFailed} refused by both, ` +
    `${readsMore} converted that Delphi can not read`,
);
process.exit(different + converterFailed + readsMore > 0 ? 1 : 0);
