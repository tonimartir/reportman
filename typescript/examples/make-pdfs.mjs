// The PDFs of the examples gallery (README.md): every sample report of ../../samples run by
// @reportman/node with its default parameters, on the sample SQLite database and the TrueType
// fonts of the system (as @reportman/server runs them), into ./pdf.
//
//   npm run build            (in typescript/, once)
//   node examples/make-pdfs.mjs [name...]
import { mkdirSync, readdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { openReport, sqlite } from '@reportman/node';

const here = dirname(fileURLToPath(import.meta.url));
const samples = join(here, '..', '..', 'samples');
const out = join(here, 'pdf');
mkdirSync(out, { recursive: true });

const only = process.argv.slice(2);
const names = readdirSync(samples)
  .filter((f) => f.endsWith('.rep'))
  .map((f) => f.slice(0, -4))
  .filter((n) => only.length === 0 || only.includes(n));

let failed = 0;
for (const name of names) {
  const file = join(samples, name + '.rep');
  try {
    const probe = await openReport(file);
    const connections = {};
    for (const db of probe.model.databaseInfo) connections[db.alias] = sqlite(join(samples, 'samples.db'));
    const report = await openReport(file, { connections, culture: 'es-ES', fonts: {} });
    const pdf = await report.executeToPdf({});
    writeFileSync(join(out, name + '.pdf'), pdf);
    console.log(`${name}.pdf ${pdf.length} bytes`);
  } catch (e) {
    failed++;
    console.log(`${name}: ${e instanceof Error ? e.message : String(e)}`);
  }
}
process.exit(failed === 0 ? 0 : 1);
