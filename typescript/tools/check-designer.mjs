// Checks the build of @reportman/designer (packages/reportman-designer/dist, made by
// `npm run build:package` in typescript/designer): the element, its stylesheet and fonts are
// there, every font the stylesheet names is in the package, Monaco is not (it is a dependency of
// the package, served from its own files), and nothing is loaded from another site.
//
//   node tools/check-designer.mjs
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const dist = join(dirname(fileURLToPath(import.meta.url)), '..', 'packages', 'reportman-designer', 'dist');
const problems = [];
const need = (file) => {
  if (!existsSync(join(dist, file))) problems.push('missing ' + file);
};

if (!existsSync(dist)) {
  console.error('check-designer: no build at ' + dist + ': cd typescript/designer && npm ci && npm run build:package');
  process.exit(1);
}
for (const file of ['main.js', 'reportman-designer.css', 'ai-callback.html', 'assets/fonts/fonts.css', 'assets/fonts/roboto/LICENSE', 'assets/fonts/material-icons/LICENSE'])
  need(file);
if (existsSync(join(dist, 'fonts.css'))) {
  // nothing: the stylesheet lives in assets/fonts
}
const css = existsSync(join(dist, 'assets/fonts/fonts.css')) ? readFileSync(join(dist, 'assets/fonts/fonts.css'), 'utf8') : '';
for (const m of css.matchAll(/url\(["']?\.\/([^)"']+)["']?\)/g)) need('assets/fonts/' + m[1]);
if (existsSync(join(dist, 'assets', 'monaco-editor'))) problems.push('assets/monaco-editor is in the package: build it with the "package" configuration');

const files = [];
const walk = (dir) => {
  for (const name of readdirSync(dir)) {
    const file = join(dir, name);
    if (statSync(file).isDirectory()) walk(file);
    else files.push(file);
  }
};
walk(dist);
for (const file of files.filter((f) => /\.(js|css|html)$/.test(f))) {
  const text = readFileSync(file, 'utf8');
  for (const host of ['fonts.googleapis.com', 'fonts.gstatic.com'])
    if (text.includes(host)) problems.push(relative(dist, file) + ' loads from ' + host);
}
const size = files.reduce((n, f) => n + statSync(f).size, 0);
if (problems.length > 0) {
  for (const p of problems) console.error('FAIL @reportman/designer: ' + p);
  process.exit(1);
}
console.log(`ok   @reportman/designer: ${files.length} files, ${(size / 1048576).toFixed(1)} MB`);
