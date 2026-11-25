// Before npm packs @reportman/server: the sample reports of the repository (samples/: the .rep
// files, their SQLite database, samples.ini, the thumbnails and the local schema of their connection,
// dbxschemas/SAMPLES.json) into the package's own samples/,
// which the console installs into a data folder (POST /api/console/samples, --samples).
import { copyFileSync, existsSync, mkdirSync, readdirSync, rmSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const pkg = join(dirname(fileURLToPath(import.meta.url)), '..');
const source = join(pkg, '..', '..', '..', 'samples');
const target = join(pkg, 'samples');
if (!existsSync(join(source, 'samples.db'))) {
  console.error('copy-samples: no samples at ' + source);
  process.exit(1);
}
rmSync(target, { recursive: true, force: true });
mkdirSync(join(target, 'thumbnails'), { recursive: true });
mkdirSync(join(target, 'dbxschemas'), { recursive: true });
let n = 0;
for (const name of readdirSync(source)) {
  if (/\.rep$/i.test(name) || name === 'samples.db' || name === 'samples.ini') {
    copyFileSync(join(source, name), join(target, name));
    n++;
  }
}
for (const name of readdirSync(join(source, 'thumbnails'))) {
  if (/\.png$/i.test(name)) {
    copyFileSync(join(source, 'thumbnails', name), join(target, 'thumbnails', name));
    n++;
  }
}
for (const name of readdirSync(join(source, 'dbxschemas'))) {
  if (/\.json$/i.test(name)) {
    copyFileSync(join(source, 'dbxschemas', name), join(target, 'dbxschemas', name));
    n++;
  }
}
console.log('copy-samples: ' + n + ' files into ' + target);
