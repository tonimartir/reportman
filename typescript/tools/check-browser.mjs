// The core of the engine in a browser: the expression parity cases of @reportman/engine run in a
// Chromium-based browser of this computer (Edge or Chrome, headless; CHROME_PATH chooses another)
// on a page Vite serves from the sources, and must give the C# results (the page posts them back). Without such a browser
// (the Docker images of the CI) it says so and passes.
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { createServer } from 'vite';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

function findBrowser() {
  if (process.env.CHROME_PATH) return existsSync(process.env.CHROME_PATH) ? process.env.CHROME_PATH : null;
  const candidates =
    process.platform === 'win32'
      ? [
          join(process.env['ProgramFiles(x86)'] ?? 'C:\Program Files (x86)', 'Microsoft', 'Edge', 'Application', 'msedge.exe'),
          join(process.env.ProgramFiles ?? 'C:\Program Files', 'Microsoft', 'Edge', 'Application', 'msedge.exe'),
          join(process.env.ProgramFiles ?? 'C:\Program Files', 'Google', 'Chrome', 'Application', 'chrome.exe'),
        ]
      : process.platform === 'darwin'
        ? ['/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge']
        : [];
  for (const c of candidates) if (existsSync(c)) return c;
  if (process.platform !== 'win32') {
    for (const name of ['google-chrome', 'chromium', 'chromium-browser', 'microsoft-edge']) {
      const r = spawnSync('which', [name], { encoding: 'utf8' });
      if (r.status === 0 && r.stdout.trim()) return r.stdout.trim();
    }
  }
  return null;
}

const browser = findBrowser();
if (browser === null) {
  console.log('skip: no Chromium-based browser on this computer (set CHROME_PATH)');
  process.exit(0);
}
const packages = ['lib', 'metafile', 'text', 'pdf', 'engine'];
// The page posts its summary to /__result when it has compared every case
let report;
const result = new Promise((resolve) => (report = resolve));
const server = await createServer({
  configFile: false,
  root: join(root, 'tools', 'browser-check'),
  logLevel: 'error',
  resolve: { alias: packages.map((n) => ({ find: new RegExp(`^@reportman/${n}$`), replacement: join(root, 'packages', `reportman-${n}`, 'src', 'index.ts') })) },
  server: { host: '127.0.0.1', port: 0, hmr: false, fs: { allow: [root] } },
  plugins: [
    {
      name: 'reportman-browser-result',
      configureServer(s) {
        s.middlewares.use('/__result', (req, res) => {
          let body = '';
          req.setEncoding('utf8');
          req.on('data', (c) => (body += c));
          req.on('end', () => {
            res.end('ok');
            report(body);
          });
        });
      },
    },
  ],
});
await server.listen();
const url = server.resolvedUrls.local[0];
const profile = mkdtempSync(join(tmpdir(), 'reportman-browser-'));
const child = spawn(browser, ['--headless=new', '--disable-gpu', '--no-first-run', `--user-data-dir=${profile}`, url], { stdio: 'ignore' });
const timeout = new Promise((resolve) => setTimeout(() => resolve('RESULT: no answer from the browser in 10 minutes'), 600000).unref());
let text;
try {
  text = await Promise.race([result, timeout]);
} finally {
  child.kill();
  await server.close();
  await new Promise((resolve) => setTimeout(resolve, 500));
  try {
    rmSync(profile, { recursive: true, force: true });
  } catch {
    // the browser may still hold its profile for a moment
  }
}
console.log(text.split('\n').filter((l) => l.trim()).join('\n'));
process.exit(/RESULT: all the same/.test(text) ? 0 : 1);
