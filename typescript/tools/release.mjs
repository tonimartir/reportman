// Publishes the version every package shares (tools/set-version.mjs) and can be run again: it does
// only what the registry does not have yet, so a run that stopped half way is finished by running
// it again.
//
// The versions are staged (npm stage publish, npm 11.15 or later): staging asks for no 2FA, and the
// staged versions are approved together in the Staged Packages tab of the account settings on
// npmjs.com, with one 2FA for the whole batch. A version already staged is not staged again: the
// run says it waits for its approval.
//
// That approval is the only 2FA of a release. The script never runs a command that asks for one:
// npm publish, npm dist-tag and npm deprecate ask for the 2FA once per command, so once per package
// (since July 2026 a token with "Bypass two-factor authentication" does not spare it for them), and
// the release of 26-11-2026 cost more than thirty prompts moving the tag latest and deprecating the
// placeholders of npm. run() refuses any npm command but those that ask for none (view, stage), so
// such a step cannot come back by mistake.
//
// So the tag is chosen when staging, never moved afterwards: latest, which npm gives to the first
// version of a package anyway and the website shows, while the package has no final version (the
// newest preview is what npm install gets); next for a preview of a package whose latest is a final
// version (latest stays on it). The tag next of 4.1.0-alpha.4 is not moved by later previews.
//
// NPM_STAGE_TOKEN may name a granular access token of the account with the permission "Read and
// write (stage only)" (created on npmjs.com, for the @reportman packages): every command runs with
// it, and what it stages waits for the approval with the 2FA. The token is read by npm from the
// environment (the run writes a temporary npmrc that names the variable, never its value). Without
// it, npm uses the login session of the terminal (npm login).
//
//   node tools/release.mjs [--dry-run]

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const dryRun = args.includes('--dry-run');
const unknown = args.filter((a) => a !== '--dry-run');
if (unknown.length > 0) {
  console.error(`Unknown option ${unknown.join(' ')}. --tag, --direct and --deprecate-0x were removed on 27-11-2026:
the tag is chosen when staging, and publishing, moving a tag or deprecating ask for a 2FA per package.`);
  process.exit(1);
}
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

/** The npm commands that ask for no 2FA: the only ones this script runs (see the top). */
function asksNo2fa(npmArgs) {
  const [command, sub] = npmArgs;
  if (command === '--version' || command === 'view') return true;
  return command === 'stage' && (sub === 'publish' || sub === 'list');
}

/**
 * Runs npm; quiet ones return their output, the others share the terminal. keepErr shows the error
 * output too, after the command, and returns it (to tell one error).
 */
function run(npmArgs, { quiet = false, keepErr = false } = {}) {
  if (!asksNo2fa(npmArgs)) throw new Error(`npm ${npmArgs.join(' ')} may ask for a 2FA per package: this script never runs it`);
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
const npmVersion = run(['--version'], { quiet: true }).out;
if (!/^\d+\.\d+\.\d+/.test(npmVersion) || compare(npmVersion.replace(/-.*/, ''), '11.15.0') < 0) {
  console.error(`npm ${npmVersion} cannot stage (npm stage publish needs npm 11.15.0 or later): update it (npm install -g npm@11)`);
  process.exit(1);
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

/** The tag a package is staged with: next only for a preview when latest is a final version. */
function tagFor(reg) {
  const latest = reg?.tags.latest;
  return !final && latest !== undefined && !latest.includes('-') ? 'next' : 'latest';
}

// The packages whose version is not on the registry: staged (once)
const known = new Map(packages.map((p) => [p.name, registry(p.name)]));
const missing = packages.filter((p) => !(known.get(p.name)?.versions ?? []).includes(version));
console.log(`${packages.length} packages at ${version}; not on the registry: ${missing.length === 0 ? 'none' : missing.map((p) => p.name).join(', ')}`);
const waiting = [];
const failed = [];
for (const p of missing) {
  const status = stageStatus(p.name, version);
  if (status !== null) {
    waiting.push(p.name + (status === 'approved' ? ' (approved, not on the registry yet)' : ''));
    continue;
  }
  // Approved although the registry did not list it yet: it leaves npm stage list before npm view
  // shows it
  if (hasVersion(p.name, version)) continue;
  const tag = tagFor(known.get(p.name));
  console.log(`\n== npm stage publish ${p.name}@${version} --tag ${tag}`);
  const staged = run(['stage', 'publish', '--workspace=' + p.name, '--tag', tag, ...(dryRun ? ['--dry-run'] : [])], { keepErr: true });
  if (staged.ok) waiting.push(p.name);
  else if (/E409|previously published/i.test(staged.err)) {
    console.log(`   ${p.name}@${version} is published already (the registry did not show it yet): not an error`);
  } else failed.push(p.name);
}
if (failed.length > 0) console.error(`\nNot staged (run it again to finish): ${failed.join(', ')}`);
if (waiting.length > 0 && !dryRun) {
  console.log(`
${waiting.length} versions staged, not on the registry yet: ${waiting.join(', ')}.
Approve them in the Staged Packages tab of the account settings on npmjs.com: tick "Add to batch"
on every one (the tab may show them in pages), then approve the batch, one 2FA. Nothing else is
needed: each one is published with its tag. Running this again only says what is still missing.`);
}
if (failed.length > 0) process.exit(1);
if (dryRun && missing.length > 0) {
  console.log(`\nDry run: nothing written (${missing.length} of ${packages.length} packages would be staged).`);
  process.exit(0);
}
if (waiting.length > 0) process.exit(0);

// Everything is on the registry: say which tags do not point at it yet (moving one by hand asks for
// a 2FA per package, so the script does not do it)
const behind = [];
for (const p of packages) {
  const reg = registry(p.name);
  const want = tagFor(reg);
  const has = reg?.tags[want];
  if (has !== version) behind.push(`${p.name} (${want}: ${has ?? 'none'})`);
}
if (behind.length > 0) console.warn(`\nThe registry may take some minutes to show the new tags; not yet: ${behind.join(', ')}`);
console.log(`\nDone: ${packages.length} packages at ${version}.`);
