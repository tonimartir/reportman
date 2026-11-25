// Gives every package of the workspace the same version (Toni, 22-11-2026: all the @reportman
// packages, and at the release the Delphi and C# engines, share one 4.x version). It sets the
// version of each package, the references between them (dependencies, peer, optional and dev
// dependencies, always the exact version), their entries in package-lock.json and the version the
// server API reports by default. The status lines of the README files are text: edit them by hand.
//
//   node tools/set-version.mjs <version>          e.g. node tools/set-version.mjs 4.1.0-alpha.1
//   node tools/set-version.mjs --check            fails when the packages do not share one version

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const SEMVER = /^\d+\.\d+\.\d+(-[0-9A-Za-z-]+(\.[0-9A-Za-z-]+)*)?$/;
const DEP_FIELDS = ['dependencies', 'peerDependencies', 'optionalDependencies', 'devDependencies'];
const SCOPE = '@reportman/';

/** Reads a JSON file, remembering its line ends. */
function readJson(file) {
  const text = fs.readFileSync(file, 'utf8');
  return { data: JSON.parse(text), crlf: text.includes('\r\n') };
}

/** Writes a JSON file as npm does (two spaces, a final line end), with its own line ends. */
function writeJson(file, { data, crlf }) {
  const text = JSON.stringify(data, null, 2) + '\n';
  fs.writeFileSync(file, crlf ? text.split('\n').join('\r\n') : text);
}

/** Sets the version and the references to the other packages of the scope. */
function stamp(pkg, version) {
  pkg.version = version;
  for (const field of DEP_FIELDS) {
    const deps = pkg[field];
    if (deps === undefined) continue;
    for (const name of Object.keys(deps)) if (name.startsWith(SCOPE)) deps[name] = version;
  }
}

const packageDirs = fs
  .readdirSync(path.join(root, 'packages'))
  .map((d) => path.join(root, 'packages', d))
  .filter((d) => fs.existsSync(path.join(d, 'package.json')))
  // The Angular library of the web designer (not an npm workspace, not published yet)
  .concat([path.join(root, 'designer', 'projects', 'reportman-designer')]);

const arg = process.argv[2];
if (arg === '--check') {
  const versions = new Map();
  for (const dir of packageDirs) {
    const { data } = readJson(path.join(dir, 'package.json'));
    versions.set(data.name, data.version);
    for (const field of DEP_FIELDS)
      for (const [name, range] of Object.entries(data[field] ?? {}))
        if (name.startsWith(SCOPE) && range !== data.version) {
          console.error(`${data.name}: ${field} ${name} is ${range}, not ${data.version}`);
          process.exitCode = 1;
        }
  }
  const distinct = [...new Set(versions.values())];
  if (distinct.length !== 1) {
    console.error('The packages do not share one version: ' + [...versions].map(([n, v]) => `${n} ${v}`).join(', '));
    process.exitCode = 1;
  } else if (process.exitCode !== 1) console.log(`${versions.size} packages at ${distinct[0]}`);
} else {
  if (arg === undefined || !SEMVER.test(arg)) {
    console.error('usage: node tools/set-version.mjs <version> | --check   (a semver version, e.g. 4.1.0-alpha.1)');
    process.exit(2);
  }
  for (const dir of packageDirs) {
    const file = path.join(dir, 'package.json');
    const json = readJson(file);
    stamp(json.data, arg);
    writeJson(file, json);
  }
  // The lock: the entries of the workspace packages (the node_modules links have no version)
  const lockFile = path.join(root, 'package-lock.json');
  const lock = readJson(lockFile);
  for (const [key, entry] of Object.entries(lock.data.packages))
    if (key.startsWith('packages/') && typeof entry.name === 'string' && entry.name.startsWith(SCOPE)) stamp(entry, arg);
  writeJson(lockFile, lock);
  // The version the server reports when the host gives none
  const serverFile = path.join(root, 'packages/reportman-server/src/server.ts');
  const server = fs.readFileSync(serverFile, 'utf8');
  const stamped = server.replace(/(version: this\.options\.version \?\? ')[^']*(')/, `$1${arg}$2`);
  if (stamped === server && !server.includes(`?? '${arg}'`)) throw new Error('The default version of server.ts was not found');
  fs.writeFileSync(serverFile, stamped);
  console.log(`${packageDirs.length} packages at ${arg}`);
}
