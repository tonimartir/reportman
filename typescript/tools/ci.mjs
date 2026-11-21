// The continuous integration of the TypeScript packages, run on this computer (no hosted CI): a clean
// copy of the working tree (the files git tracks or would track under typescript/ and samples/, so
// uncommitted changes are tested too, and never a node_modules or a dist) is installed with npm ci,
// built, tested and checked
//   - on Windows, with the Node of this computer, when it runs on Windows;
//   - on Linux, in Docker (inside WSL when it runs on Windows), once per Node version: node:22 and
//     node:24 (Debian bookworm slim). The containers use the host network, so the driver tests reach
//     the test databases when they are up (they skip themselves otherwise).
//
//   npm run ci                          (from typescript/)
//   node tools/ci.mjs [--windows] [--linux] [--node 22,24] [--distro Ubuntu] [--keep]
//
// --windows / --linux run only that system; --node the Linux Node versions; --distro the WSL
// distribution (the default one when omitted); --keep leaves the copies. The log of each run is in
// the folder it prints. Exit code 0 when every step of every run passed.
import { spawn, spawnSync } from 'node:child_process';
import { createWriteStream, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const typescriptDir = join(here, '..');
const repoRoot = join(typescriptDir, '..');
const STAGED_MARK = '.ci-staged';
// The tar of Windows (bsdtar): a GNU tar first on the PATH (Git Bash) reads 'C:' as a remote host
const TAR = process.platform === 'win32' ? join(process.env.SystemRoot ?? 'C:\\Windows', 'System32', 'tar.exe') : 'tar';

/** The steps of a run, in a clean copy of typescript/ (npm ci removes and installs node_modules). */
const STEPS = [
  ['npm ci', ['ci', '--no-audit', '--no-fund']],
  ['build', ['run', 'build']],
  ['test', ['test']],
  ['check:pure-js', ['run', 'check:pure-js']],
  ['check:dist', ['run', 'check:dist']],
];

const args = process.argv.slice(2);
const option = (name) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
};

if (args.includes('--here')) {
  // Inside a copy made by this script (a container or the Windows copy): the steps, one by one.
  if (!existsSync(join(typescriptDir, STAGED_MARK))) {
    console.error('--here runs only in a copy made by tools/ci.mjs (npm ci would replace node_modules)');
    process.exit(2);
  }
  process.exit(await runSteps(typescriptDir));
}

const onWindows = process.platform === 'win32';
const onlyWindows = args.includes('--windows') && !args.includes('--linux');
const onlyLinux = args.includes('--linux') && !args.includes('--windows');
if (onlyWindows && !onWindows) {
  console.error('--windows: this is not Windows');
  process.exit(2);
}
const wantWindows = onWindows && !onlyLinux;
const wantLinux = !onlyWindows;
const nodeVersions = (option('--node') ?? '22,24').split(',').map((v) => v.trim()).filter(Boolean);
const distro = option('--distro');
const keep = args.includes('--keep');

const work = mkdtempSync(join(tmpdir(), 'reportman-ci-'));
const logs = join(work, 'logs');
mkdirSync(logs);
console.log(`work folder: ${work}`);

// The files of the copy: tracked, or untracked and not ignored, and still on disk
// (and the files of the C# engine a test reads: the sRGB profile of PDF/A)
const listed = spawnSync('git', ['ls-files', '-z', '--cached', '--others', '--exclude-standard', '--', 'typescript', 'samples', 'Reportman.Drawing/Resources/sRGB.icm'], {
  cwd: repoRoot,
  encoding: 'utf8',
  maxBuffer: 64 * 1024 * 1024,
});
if (listed.status !== 0) {
  console.error('git ls-files failed: ' + listed.stderr);
  process.exit(2);
}
const files = listed.stdout.split('\0').filter((f) => f && existsSync(join(repoRoot, f)));
writeFileSync(join(typescriptDir, STAGED_MARK), 'a copy made by tools/ci.mjs\n');
files.push('typescript/' + STAGED_MARK);
const listFile = join(work, 'files.txt');
writeFileSync(listFile, files.join('\n') + '\n');
const tarFile = join(work, 'src.tar');
// Windows has bsdtar (tar.exe); -T reads the list, forward slashes as git gives them
const packed = spawnSync(TAR, ['-cf', tarFile, '-T', listFile], { cwd: repoRoot, encoding: 'utf8' });
rmSync(join(typescriptDir, STAGED_MARK), { force: true });
if (packed.status !== 0) {
  console.error('tar failed: ' + packed.stderr);
  process.exit(2);
}
console.log(`copy: ${files.length} files of typescript/ and samples/`);

const results = [];

if (wantWindows) {
  const copy = join(work, 'windows');
  mkdirSync(copy);
  const unpacked = spawnSync(TAR, ['-xf', tarFile, '-C', copy], { encoding: 'utf8' });
  if (unpacked.status !== 0) {
    results.push({ run: 'windows', code: 2, log: '' });
    console.error('tar -x failed: ' + unpacked.stderr);
  } else {
    const name = `windows node ${process.version}`;
    const log = join(logs, 'windows.log');
    console.log(`\n== ${name}`);
    const code = await runLogged(process.execPath, [join(copy, 'typescript', 'tools', 'ci.mjs'), '--here'], {
      cwd: join(copy, 'typescript'),
      log,
    });
    results.push({ run: name, code, log });
  }
}

if (wantLinux) {
  let mountTar = tarFile;
  let docker = ['docker'];
  if (onWindows) {
    const wsl = distro ? ['-d', distro] : [];
    const converted = spawnSync('wsl.exe', [...wsl, '--', 'wslpath', '-a', tarFile.replace(/\\/g, '/')], { encoding: 'utf8' });
    if (converted.status !== 0) {
      console.error('wslpath failed (is WSL installed?): ' + converted.stderr);
      results.push({ run: 'linux', code: 2, log: '' });
      nodeVersions.length = 0;
    }
    mountTar = converted.stdout.trim();
    docker = ['wsl.exe', ...wsl, '--', 'docker'];
  }
  for (const version of nodeVersions) {
    const name = `linux node ${version}`;
    const log = join(logs, `linux-node${version}.log`);
    console.log(`\n== ${name}`);
    const script = [
      'set -e',
      'mkdir -p /w',
      'tar -xf /src.tar -C /w',
      'cd /w/typescript',
      'node tools/ci.mjs --here',
    ].join(' && ');
    const code = await runLogged(docker[0], [
      ...docker.slice(1),
      'run', '--rm', '--network', 'host',
      // the time zone of this computer, the one the fixtures of the drivers were written in
      '-e', `TZ=${Intl.DateTimeFormat().resolvedOptions().timeZone}`,
      '-v', `${mountTar}:/src.tar:ro`,
      '-v', 'reportman-ci-npm-cache:/root/.npm',
      `node:${version}-bookworm-slim`,
      'bash', '-c', script,
    ], { cwd: work, log });
    results.push({ run: name, code, log });
  }
}

console.log('\n== summary');
for (const r of results) console.log(`${r.code === 0 ? 'PASS' : 'FAIL'}  ${r.run}${r.code === 0 ? '' : '   log: ' + r.log}`);
console.log(`logs: ${logs}`);
if (!keep) {
  for (const sub of ['windows', 'src.tar', 'files.txt']) rmSync(join(work, sub), { recursive: true, force: true });
}
process.exit(results.length > 0 && results.every((r) => r.code === 0) ? 0 : 1);

/** Runs the steps in dir; prints one line per step and the end of the output of the one that fails. */
async function runSteps(dir) {
  console.log(`[ci] node ${process.version} on ${process.platform}`);
  for (const [label, npmArgs] of STEPS) {
    const start = Date.now();
    const out = [];
    const code = await new Promise((resolve) => {
      const child = spawn('npm', npmArgs, { cwd: dir, shell: process.platform === 'win32', env: { ...process.env, CI: '1' } });
      child.stdout.on('data', (d) => out.push(d));
      child.stderr.on('data', (d) => out.push(d));
      child.on('close', (c) => resolve(c ?? 1));
      child.on('error', () => resolve(1));
    });
    const text = Buffer.concat(out).toString('utf8');
    const seconds = ((Date.now() - start) / 1000).toFixed(0) + ' s';
    const summary = label === 'test' ? ' ' + (text.match(/Tests\s+[^\n]*/)?.[0] ?? '').replace(/\x1b\[[0-9;]*m/g, '').trim() : '';
    console.log(`[ci] ${code === 0 ? 'ok  ' : 'FAIL'} ${label} (${seconds})${summary}`);
    console.log(text);
    if (code !== 0) {
      console.log(`---- the end of ${label}:`);
      console.log(text.split('\n').slice(-60).join('\n'));
      return 1;
    }
  }
  return 0;
}

/** Runs a command, its output to the log; on the console only the lines of the steps. */
function runLogged(command, commandArgs, { cwd, log }) {
  return new Promise((resolve) => {
    const file = createWriteStream(log);
    const child = spawn(command, commandArgs, { cwd });
    let pending = '';
    let failing = false;
    const onData = (d) => {
      file.write(d);
      pending += d.toString('utf8');
      const lines = pending.split('\n');
      pending = lines.pop();
      for (const line of lines) {
        if (line.startsWith('[ci] ')) console.log('  ' + line.substring(5));
        if (/^---- the end of/.test(line)) failing = true;
      }
    };
    child.stdout.on('data', onData);
    child.stderr.on('data', onData);
    child.on('error', (e) => {
      file.write(String(e));
      resolve(2);
    });
    child.on('close', (c) => {
      file.end(() => {
        if (c !== 0 || failing) {
          const tail = readFileSync(log, 'utf8').split('\n').slice(-40).join('\n');
          console.log(tail);
        }
        resolve(c ?? 1);
      });
    });
  });
}
