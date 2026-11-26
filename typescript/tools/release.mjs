// Publishes the version every package shares (tools/set-version.mjs) and can be run again: it does
// only what the registry does not have yet, so a run that stopped half way is finished by running
// it again.
//
// By default the versions are staged (npm stage publish, npm 11.15 or later): staging asks for no
// 2FA, and the staged versions are approved together in the Staged Packages tab of the account
// settings on npmjs.com, with one 2FA for the whole batch. A version already staged is not staged
// again: the run says it waits for its approval. Once they are approved, running it again moves
// the tag latest (below). --direct publishes with npm publish as before: one 2FA per package.
//
// The tag latest, while there is no final version, follows the newest preview: npm gives latest to
// the first version a package publishes, whatever --tag says (and the website shows the version of
// latest). With --deprecate-0x, the versions of the 0.x line (the placeholder 0.0.0-stage of npm
// and 0.1.0-alpha.1, before the line moved to 4.x) are deprecated once.
//
// Moving a tag and deprecating ask for the 2FA of the account with a login session (npm login),
// one prompt a package. With NPM_STAGE_TOKEN set to a granular access token of the account with the
// permission "Read and write (stage only)" and "Bypass two-factor authentication" (created on
// npmjs.com, for the @reportman packages), every command runs with that token and none of them asks
// for the 2FA: the token cannot publish, only stage, move tags and deprecate, and what it stages
// waits for the approval with the 2FA. The token is read by npm from the environment (the run
// writes a temporary npmrc that names the variable, never its value).
//
//   node tools/release.mjs [--tag next] [--dry-run] [--direct] [--deprecate-0x]

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const dryRun = args.includes('--dry-run');
const direct = args.includes('--direct');
const deprecate0x = args.includes('--deprecate-0x');
const tagIndex = args.indexOf('--tag');
const tag = tagIndex >= 0 ? args[tagIndex + 1] : 'next';
const windows = process.platform === 'win32';
const npm = windows ? 'npm.cmd' : 'npm';
const REGISTRY = '//registry.npmjs.org/';

// The stage-only token: a temporary npmrc that names the variable (npm expands ${NPM_STAGE_TOKEN})
const tokenConfig = [];
if (process.env.NPM_STAGE_TOKEN) {
  const npmrc = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'rm-release-')), '.npmrc');
  fs.writeFileSync(npmrc, `${REGISTRY}:_authToken=\${NPM_STAGE_TOKEN}\n`, { mode: 0o600 });
  process.on('exit', () => fs.rmSync(path.dirname(npmrc), { recursive: true, force: true }));
  tokenConfig.push('--userconfig', npmrc);
}

// Run by npm (npm run release:publish), the npm that runs it, without a shell; run by hand, the npm
// of the PATH (npm.cmd through the shell on Windows, an argument with spaces quoted)
const npmCli = /npm-cli\.js$/.test(process.env.npm_execpath ?? '') ? process.env.npm_execpath : null;
const quote = (a) => (windows && /\s/.test(a) ? `"${a}"` : a);

/**
 * Runs npm; quiet ones return their output, the others share the terminal (the 2FA prompts).
 * keepErr shows the error output too, after the command, and returns it (to tell one error).
 */
function run(npmArgs, { quiet = false, keepErr = false } = {}) {
  const all = [...npmArgs, ...tokenConfig];
  const options = { cwd: root, encoding: 'utf8', stdio: quiet ? 'pipe' : keepErr ? ['inherit', 'inherit', 'pipe'] : 'inherit' };
  const r = npmCli !== null ? spawnSync(process.execPath, [npmCli, ...all], options) : spawnSync(npm, all.map(quote), { ...options, shell: windows });
  if (keepErr && !quiet && r.stderr) process.stderr.write(r.stderr);
  return { ok: r.status === 0, out: (r.stdout ?? '').trim(), err: (r.stderr ?? '').trim() };
}

/**
 * What the registry has of a package: its versions and tags (null: not there). --prefer-online:
 * npm keeps what it read of a package for some minutes, and a version just approved would look
 * missing.
 */
function registry(name) {
  const r = run(['view', name, 'versions', 'dist-tags', '--json', '--prefer-online'], { quiet: true });
  if (!r.ok || r.out === '') return null;
  const data = JSON.parse(r.out);
  return { versions: [].concat(data.versions ?? []), tags: data['dist-tags'] ?? {} };
}

/** Whether the registry has a version of a package, asking it now (not npm's cache). */
function hasVersion(name, ver) {
  const r = run(['view', `${name}@${ver}`, 'version', '--prefer-online'], { quiet: true });
  return r.ok && r.out.replace(/['"]/g, '') === ver;
}

/**
 * What npm stage list says of a version of a package: 'pending' (staged, waiting for its approval),
 * 'approved' (the registry may take some minutes to show it) or null (not staged, or rejected: it
 * can be staged again).
 */
function stageStatus(name, ver) {
  const r = run(['stage', 'list', name, '--json'], { quiet: true });
  if (!r.ok) {
    // A dry run may have no login: it stages nothing, so it does not need to know
    if (dryRun) return null;
    // Not known: say why (npm's error is in its output too, after its notices) and stage it anyway;
    // npm refuses to stage a version twice, and the staging below says so
    const notice = /bypass 2FA are being restricted|gh\.io\/npm-gat-bypass2fa|^npm notice\s*$/i;
    const why = [r.err, r.out]
      .flatMap((s) => s.split(/\r?\n/))
      .filter((line) => line.trim() !== '' && !notice.test(line))
      .join(' | ');
    console.warn(`npm stage list ${name} failed (${why || 'npm said nothing more'}): staging it anyway`);
    return null;
  }
  const items = r.out === '' ? [] : [].concat(JSON.parse(r.out)).filter((i) => String(i.version) === ver);
  const status = items.map((i) => String(i.status ?? '')).find((s) => !/reject/i.test(s));
  if (status === undefined) return null;
  return /approv|publish|promot/i.test(status) ? 'approved' : 'pending';
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

// Staged publishing needs npm 11.15
if (!direct) {
  const v = run(['--version'], { quiet: true }).out;
  if (!/^\d+\.\d+\.\d+/.test(v) || compare(v.replace(/-.*/, ''), '11.15.0') < 0) {
    console.error(`npm ${v} cannot stage (npm stage publish needs npm 11.15.0 or later): update it (npm install -g npm@11) or publish with --direct`);
    process.exit(1);
  }
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

// 1. The packages whose version is not on the registry: published, or staged (once)
const missing = packages.filter((p) => !(registry(p.name)?.versions ?? []).includes(version));
console.log(`${packages.length} packages at ${version}; not on the registry: ${missing.length === 0 ? 'none' : missing.map((p) => p.name).join(', ')}`);
const waiting = [];
// Published although the registry did not list them yet: an approved version leaves npm stage
// list before npm view shows it, and staging it again is refused (E409, "Cannot stage previously
// published version"). They are published: their tag is moved like the others.
const justPublished = new Set();
for (const p of missing) {
  if (direct) {
    console.log(`\n== npm publish ${p.name}@${version} --tag ${tag}`);
    if (!run(['publish', '--workspace=' + p.name, '--tag', tag, ...(dryRun ? ['--dry-run'] : [])]).ok) failed.push(p.name + ' (publish)');
    continue;
  }
  const status = stageStatus(p.name, version);
  if (status !== null) {
    waiting.push(p.name + (status === 'approved' ? ' (approved, not on the registry yet)' : ''));
    continue;
  }
  if (hasVersion(p.name, version)) {
    justPublished.add(p.name);
    continue;
  }
  console.log(`\n== npm stage publish ${p.name}@${version} --tag ${tag}`);
  const staged = run(['stage', 'publish', '--workspace=' + p.name, '--tag', tag, ...(dryRun ? ['--dry-run'] : [])], { keepErr: true });
  if (staged.ok) waiting.push(p.name);
  else if (/E409|previously published/i.test(staged.err)) {
    console.log(`   ${p.name}@${version} is published already (the registry did not show it yet): not an error`);
    justPublished.add(p.name);
  } else failed.push(p.name + ' (stage)');
}
if (waiting.length > 0 && !dryRun) {
  if (failed.length > 0) console.error(`\nNot staged (run it again to finish): ${failed.join(', ')}`);
  console.log(`
${waiting.length} versions staged, not on the registry yet: ${waiting.join(', ')}.
Approve them in the Staged Packages tab of the account settings on npmjs.com (select them all,
Approve: one 2FA for the batch). Then run this again (npm run release:publish) to move the tag
latest; the registry may take some minutes to show an approved version.`);
  process.exit(failed.length > 0 ? 1 : 0);
}

// 2. latest: the newest preview until there is a final version (a final one is published as latest)
for (const p of packages) {
  const reg = registry(p.name);
  if (reg === null || (!reg.versions.includes(version) && !justPublished.has(p.name))) continue;
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
console.log(`\n${dryRun ? 'Dry run: nothing written' : 'Done'}: ${packages.length} packages at ${version}.`);
