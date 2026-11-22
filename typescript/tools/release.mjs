// Publishes the version every package shares (tools/set-version.mjs) and can be run again: it
// publishes only the packages whose version is not on the registry yet, so a run that stopped
// half way (a 2FA authorization that expired, a network error) is finished by running it again.
// Then the tag latest, while there is no final version, follows the newest preview: npm gives
// latest to the first version a package publishes, whatever --tag says (and the website shows the
// version of latest). With --deprecate-0x, the versions of the 0.x line (the placeholder
// 0.0.0-stage of npm and 0.1.0-alpha.1, before the line moved to 4.x) are deprecated once: two
// commands a package, each one with its 2FA. Every command that writes asks for the 2FA of the
// account (npm login first).
//
//   node tools/release.mjs [--tag next] [--dry-run] [--deprecate-0x]

import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const dryRun = args.includes('--dry-run');
const deprecate0x = args.includes('--deprecate-0x');
const tagIndex = args.indexOf('--tag');
const tag = tagIndex >= 0 ? args[tagIndex + 1] : 'next';
const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';

/** Runs npm; quiet ones return their output, the others share the terminal (the 2FA prompts). */
function run(npmArgs, { quiet = false } = {}) {
  const r = spawnSync(npm, npmArgs, { cwd: root, encoding: 'utf8', shell: process.platform === 'win32', stdio: quiet ? 'pipe' : 'inherit' });
  return { ok: r.status === 0, out: (r.stdout ?? '').trim() };
}

/** What the registry has of a package: its versions, tags and deprecations (null: not there). */
function registry(name) {
  const r = run(['view', name, 'versions', 'dist-tags', '--json'], { quiet: true });
  if (!r.ok || r.out === '') return null;
  const data = JSON.parse(r.out);
  return { versions: data.versions ?? [], tags: data['dist-tags'] ?? {} };
}

/** semver order (numbers, then a version without prerelease after one with it). */
function compare(a, b) {
  const [ma, pa = ''] = a.split(/-(.*)/s);
  const [mb, pb = ''] = b.split(/-(.*)/s);
  const na = ma.split('.').map(Number);
  const nb = mb.split('.').map(Number);
  for (let i = 0; i < 3; i++) if (na[i] !== nb[i]) return na[i] - nb[i];
  if (pa === pb) return 0;
  if (pa === '') return 1;
  if (pb === '') return -1;
  const xa = pa.split('.');
  const xb = pb.split('.');
  for (let i = 0; i < Math.max(xa.length, xb.length); i++) {
    if (xa[i] === undefined) return -1;
    if (xb[i] === undefined) return 1;
    const da = /^\d+$/.test(xa[i]);
    const db = /^\d+$/.test(xb[i]);
    if (da && db && Number(xa[i]) !== Number(xb[i])) return Number(xa[i]) - Number(xb[i]);
    if (da !== db) return da ? -1 : 1;
    if (xa[i] !== xb[i]) return xa[i] < xb[i] ? -1 : 1;
  }
  return 0;
}

const packages = fs
  .readdirSync(path.join(root, 'packages'))
  .map((d) => path.join(root, 'packages', d, 'package.json'))
  .filter((f) => fs.existsSync(f))
  .map((f) => JSON.parse(fs.readFileSync(f, 'utf8')))
  .filter((p) => p.private !== true);
const versions = [...new Set(packages.map((p) => p.version))];
if (versions.length !== 1) {
  console.error('The packages do not share one version: run node tools/set-version.mjs <version>');
  process.exit(1);
}
const version = versions[0];
const final = !version.includes('-');
const failed = [];

// 1. The packages whose version is not on the registry
const missing = packages.filter((p) => !(registry(p.name)?.versions ?? []).includes(version));
console.log(`${packages.length} packages at ${version}; to publish: ${missing.length === 0 ? 'none' : missing.map((p) => p.name).join(', ')}`);
for (const p of missing) {
  console.log(`\n== npm publish ${p.name}@${version} --tag ${tag}`);
  if (!run(['publish', '--workspace=' + p.name, '--tag', tag, ...(dryRun ? ['--dry-run'] : [])]).ok) failed.push(p.name + ' (publish)');
}

// 2. latest: the newest preview until there is a final version (a final one is published as latest)
for (const p of packages) {
  const reg = registry(p.name);
  if (reg === null || !reg.versions.includes(version)) continue;
  const latest = reg.tags.latest;
  if (latest !== undefined && compare(latest, version) >= 0) continue;
  if (latest !== undefined && !latest.includes('-') && !final) continue;
  console.log(`\n== npm dist-tag add ${p.name}@${version} latest (was ${latest ?? 'none'})`);
  if (!dryRun && !run(['dist-tag', 'add', `${p.name}@${version}`, 'latest']).ok) failed.push(p.name + ' (latest)');
}

// 3. With --deprecate-0x, the 0.x line, once: deprecated (a failure is reported, not repeated)
const notDeprecated = [];
for (const p of deprecate0x ? packages : []) {
  const reg = registry(p.name);
  if (reg === null) continue;
  for (const old of reg.versions.filter((v) => v.startsWith('0.'))) {
    const dep = run(['view', `${p.name}@${old}`, 'deprecated'], { quiet: true });
    if (dep.ok && dep.out !== '') continue;
    const message = old === '0.0.0-stage' ? 'Placeholder of npm staged publishing; use the 4.x versions' : `Replaced by the 4.x line (${version})`;
    console.log(`\n== npm deprecate ${p.name}@${old}`);
    if (!dryRun && !run(['deprecate', `${p.name}@${old}`, message]).ok) notDeprecated.push(`${p.name}@${old}`);
  }
}

if (notDeprecated.length > 0) console.error(`
Not deprecated: ${notDeprecated.join(', ')}`);
if (failed.length > 0) {
  console.error(`\nNot done (run it again to finish): ${failed.join(', ')}`);
  process.exit(1);
}
console.log(`\n${dryRun ? 'Dry run: nothing written' : 'Done'}: ${packages.length} packages at ${version}. npm may stage the new versions: approve them in the Staged Packages tab of the account settings on npmjs.com.`);
