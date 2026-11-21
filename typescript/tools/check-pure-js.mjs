// Fails when a production dependency of a package of this workspace brings native code or
// WebAssembly: .node/.wasm/.so/.dll/.dylib files, or an install/postinstall/preinstall script.
// The packages are pure JavaScript (TypeScript compiled to JS); Node's built-in modules are fine.
import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const packagesDir = join(root, 'packages');
const nodeModules = join(root, 'node_modules');
const banned = /\.(node|wasm|so|dll|dylib)$/i;
const problems = [];
const seen = new Set();

function packageDir(name) {
  const dir = join(nodeModules, ...name.split('/'));
  return existsSync(join(dir, 'package.json')) ? dir : null;
}

function scanFiles(dir, owner) {
  for (const entry of readdirSync(dir)) {
    if (entry === 'node_modules') continue;
    const path = join(dir, entry);
    const st = statSync(path);
    if (st.isDirectory()) scanFiles(path, owner);
    else if (banned.test(entry)) problems.push(`${owner}: ${path.slice(root.length + 1)}`);
  }
}

function visit(name) {
  if (seen.has(name)) return;
  seen.add(name);
  const dir = packageDir(name);
  if (!dir) {
    problems.push(`${name}: not installed`);
    return;
  }
  const pkg = JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8'));
  for (const script of ['preinstall', 'install', 'postinstall']) {
    if (pkg.scripts && pkg.scripts[script]) problems.push(`${name}: has a "${script}" script`);
  }
  scanFiles(dir, name);
  for (const dep of Object.keys(pkg.dependencies ?? {})) visit(dep);
}

for (const pkgName of readdirSync(packagesDir)) {
  const pkg = JSON.parse(readFileSync(join(packagesDir, pkgName, 'package.json'), 'utf8'));
  for (const dep of Object.keys(pkg.dependencies ?? {})) {
    if (dep.startsWith('reportman-')) continue;
    visit(dep);
  }
}

if (problems.length) {
  console.error('Native code or WebAssembly in production dependencies:');
  for (const p of problems) console.error('  ' + p);
  process.exit(1);
}
console.log(`OK: ${seen.size} production dependencies, all pure JavaScript.`);
