// The continuous integration of the TypeScript packages, run on this computer (no hosted CI): a clean
// copy of the working tree (the files git tracks or would track under typescript/ and samples/, so
// uncommitted changes are tested too, and never a node_modules or a dist) is installed with npm ci,
// built, tested and checked
//   - on Windows, with the Node of this computer, when it runs on Windows;
//   - on Linux, in Docker (inside WSL when it runs on Windows), once per Node version: node:22 and
//     node:24 (Debian bookworm slim). The containers use the host network, so the driver tests reach
//     the test databases.
// The test databases come first: the containers of the driver tests (PostgreSQL, Firebird, MySQL,
// MariaDB and SQL Server, the ones the README of each driver describes) are started, or created
// when they do not exist, and loaded with the samples (test/database.ts of each driver); the runs
// then require them (REPORTMAN_REQUIRE_DATABASES=1: a server that does not answer fails the tests
// instead of skipping them). Only these containers are touched.
//
//   npm run ci                          (from typescript/)
//   node tools/ci.mjs [--windows] [--linux] [--node 22,24] [--distro Ubuntu] [--keep] [--no-databases]
//
// --windows / --linux run only that system; --node the Linux Node versions; --distro the WSL
// distribution (the default one when omitted); --keep leaves the copies; --no-databases neither starts
// nor requires the test databases (their tests skip themselves when no server answers). The log of
// each run is in the folder it prints. Exit code 0 when every step of every run passed.
import { spawn, spawnSync } from 'node:child_process';
import { connect } from 'node:net';
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
  // The web designer: its Angular workspace (designer/, not an npm workspace) and the element package
  ['build:designer', ['run', 'build:designer']],
  ['test', ['test']],
  ['test:designer', ['run', 'test:designer']],
  ['check:pure-js', ['run', 'check:pure-js']],
  ['check:dist', ['run', 'check:dist']],
  // The expression parity in a Chromium-based browser of the computer (skipped where there is none)
  ['check:browser', ['run', 'check:browser']],
];

/**
 * The containers of the driver tests, as the README of each driver creates them, the port the tests
 * reach on localhost and the loader of its samples (test/database.ts, with its environment).
 */
const DATABASES = [
  {
    name: 'reportman-pg-test', port: 55432, loader: null,
    run: ['-p', '55432:5432', '-e', 'POSTGRES_USER=reportman', '-e', 'POSTGRES_PASSWORD=rmtest_only', '-e', 'POSTGRES_DB=reportman_test', 'postgres:17-alpine'],
  },
  {
    name: 'reportman-fb-test', port: 53050, loader: { driver: 'firebird', env: {} },
    run: ['-p', '53050:3050', '-e', 'FIREBIRD_ROOT_PASSWORD=rmtest_root', '-e', 'FIREBIRD_USER=RMTEST', '-e', 'FIREBIRD_PASSWORD=rmtest_pw',
      '-e', 'FIREBIRD_DATABASE=samples.fdb', '-e', 'FIREBIRD_DATABASE_DEFAULT_CHARSET=UTF8', 'firebirdsql/firebird:5'],
  },
  {
    name: 'reportman-mysql-test', port: 53306, loader: { driver: 'mysql', env: {} },
    run: ['-p', '53306:3306', '-e', 'MYSQL_ROOT_PASSWORD=rmtest_root', '-e', 'MYSQL_DATABASE=samples', '-e', 'MYSQL_USER=rmtest', '-e', 'MYSQL_PASSWORD=rmtest_pw', 'mysql:8.4'],
  },
  {
    name: 'reportman-mariadb-test', port: 53307, loader: { driver: 'mysql', env: { RM_MYSQL_PORT: '53307' } },
    run: ['-p', '53307:3306', '-e', 'MARIADB_ROOT_PASSWORD=rmtest_root', '-e', 'MARIADB_DATABASE=samples', '-e', 'MARIADB_USER=rmtest', '-e', 'MARIADB_PASSWORD=rmtest_pw', 'mariadb:11'],
  },
  {
    name: 'reportman-mssql-test', port: 51433, loader: { driver: 'mssql', env: {} },
    run: ['-p', '51433:1433', '-e', 'ACCEPT_EULA=Y', '-e', 'MSSQL_SA_PASSWORD=RmTest_only1!', 'mcr.microsoft.com/mssql/server:2022-latest'],
  },
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
const databases = !args.includes('--no-databases');

const work = mkdtempSync(join(tmpdir(), 'reportman-ci-'));
const logs = join(work, 'logs');
mkdirSync(logs);
console.log(`work folder: ${work}`);

// The files of the copy: tracked, or untracked and not ignored, and still on disk
// (and the files of the C# engine a test reads: the sRGB profile of PDF/A, and the one report of
// the C# tests in the corpus of the .rep writer)
const listed = spawnSync('git', ['ls-files', '-z', '--cached', '--others', '--exclude-standard', '--', 'typescript', 'samples', 'Reportman.Drawing/Resources/sRGB.icm', 'tests/htmltest.rep'], {
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

// docker, through WSL on Windows
const wslArgs = distro ? ['-d', distro] : [];
const dockerCommand = onWindows ? ['wsl.exe', ...wslArgs, '--', 'docker'] : ['docker'];
if (databases) {
  console.log('\n== test databases');
  const code = await ensureDatabases();
  if (code !== 0) results.push({ run: 'test databases', code, log: '' });
}
const requireDatabases = databases && results.length === 0 ? '1' : '';

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
      env: { ...process.env, REPORTMAN_REQUIRE_DATABASES: requireDatabases },
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
      '-e', `REPORTMAN_REQUIRE_DATABASES=${requireDatabases}`,
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

/** Whether something listens on a port of localhost. */
function listening(port) {
  return new Promise((resolve) => {
    const socket = connect({ host: '127.0.0.1', port });
    socket.setTimeout(2000);
    socket.on('connect', () => {
      socket.destroy();
      resolve(true);
    });
    socket.on('timeout', () => {
      socket.destroy();
      resolve(false);
    });
    socket.on('error', () => resolve(false));
  });
}

/** Starts (or creates) the test databases, waits for them and loads their samples; 0 when all are ready. */
async function ensureDatabases() {
  const docker = (dockerArgs) => spawnSync(dockerCommand[0], [...dockerCommand.slice(1), ...dockerArgs], { encoding: 'utf8' });
  let failed = 0;
  for (const db of DATABASES) {
    const state = docker(['inspect', '-f', '{{.State.Running}}', db.name]);
    let action = 'running';
    if (state.status !== 0) {
      action = 'created';
      const r = docker(['run', '-d', '--name', db.name, ...db.run]);
      if (r.status !== 0) {
        console.log(`  FAIL ${db.name}: docker run: ${(r.stderr || r.stdout).trim().split('\n')[0]}`);
        failed++;
        continue;
      }
    } else if (state.stdout.trim() !== 'true') {
      action = 'started';
      const r = docker(['start', db.name]);
      if (r.status !== 0) {
        console.log(`  FAIL ${db.name}: docker start: ${(r.stderr || r.stdout).trim().split('\n')[0]}`);
        failed++;
        continue;
      }
    }
    // A new SQL Server takes the longest to answer
    let ready = false;
    for (let i = 0; i < 90 && !ready; i++) {
      ready = await listening(db.port);
      if (!ready) await new Promise((r) => setTimeout(r, 2000));
    }
    if (!ready) {
      console.log(`  FAIL ${db.name}: nothing listens on port ${db.port}`);
      failed++;
      continue;
    }
    if (db.loader !== null) {
      // The loader reloads only a database of another version; a server that has just started may
      // refuse logins for a while, so it is tried again
      let loaded = null;
      for (let i = 0; i < 10; i++) {
        loaded = spawnSync(process.execPath, [join(typescriptDir, 'packages', 'reportman-driver-' + db.loader.driver, 'test', 'database.ts')], {
          cwd: join(typescriptDir, 'packages', 'reportman-driver-' + db.loader.driver),
          encoding: 'utf8',
          env: { ...process.env, ...db.loader.env },
        });
        if (loaded.status === 0) break;
        await new Promise((r) => setTimeout(r, 5000));
      }
      if (loaded.status !== 0) {
        console.log(`  FAIL ${db.name}: loading the samples: ${(loaded.stderr || loaded.stdout).trim().split('\n').slice(-1)[0]}`);
        failed++;
        continue;
      }
    }
    console.log(`  ok   ${db.name} (${action}, port ${db.port})`);
  }
  return failed === 0 ? 0 : 1;
}

/** Runs a command, its output to the log; on the console only the lines of the steps. */
function runLogged(command, commandArgs, { cwd, log, env }) {
  return new Promise((resolve) => {
    const file = createWriteStream(log);
    const child = spawn(command, commandArgs, { cwd, env: env ?? process.env });
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
