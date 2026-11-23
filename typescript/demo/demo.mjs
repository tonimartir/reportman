// The live demo of reportman.es (demo/): the sample reports run by the @reportman packages in the
// browser. The page takes the packages from their sources, so it always runs the engine of this
// repository; its data (the samples, the sql.js WebAssembly) is copied from where it lives.
//
//   node demo/demo.mjs dev [--site <folder>]   a dev server (with --site, the doc/ folder of the
//                                              website, for responsive.css)
//   node demo/demo.mjs build [--out <folder>]  the static site into <folder> (demo/dist by default),
//                                              for doc/demo of the Delphi repository
//   node demo/demo.mjs check                   every sample run in a headless Edge or Chrome, each
//                                              PDF compared with the one @reportman/node writes
//   node demo/demo.mjs thumbs                  the small thumbnails of the list (ImageMagick)
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { build, createServer } from 'vite';

const demo = dirname(fileURLToPath(import.meta.url));
const ts = join(demo, '..');
const samples = join(ts, '..', 'samples');
const wasm = join(ts, 'node_modules', 'sql.js', 'dist', 'sql-wasm-browser.wasm');
const packages = ['lib', 'metafile', 'text', 'pdf', 'engine', 'canvas'];

const [command = 'dev', ...rest] = process.argv.slice(2);
const option = (name) => {
  const i = rest.indexOf('--' + name);
  return i < 0 ? undefined : rest[i + 1];
};

/** The sample files the demo serves: the reports, their database and samples.ini. */
function sampleFiles() {
  return readdirSync(samples).filter((f) => /\.rep$/i.test(f) || f === 'samples.db' || f === 'samples.ini');
}

const TYPES = { '.rep': 'application/xml', '.db': 'application/octet-stream', '.ini': 'text/plain; charset=utf-8', '.png': 'image/png', '.css': 'text/css', '.wasm': 'application/wasm' };
const typeOf = (f) => TYPES[f.slice(f.lastIndexOf('.'))] ?? 'application/octet-stream';

/** Serves a file of the disk. */
function send(res, file) {
  if (!existsSync(file)) {
    res.statusCode = 404;
    res.end();
    return;
  }
  res.setHeader('Content-Type', typeOf(file));
  res.end(readFileSync(file));
}

/** The Vite configuration of the page (and of the check page). */
function config(extra = {}) {
  const site = option('site');
  return {
    configFile: false,
    root: demo,
    base: './',
    logLevel: 'warn',
    resolve: {
      alias: packages.map((n) => ({ find: new RegExp(`^@reportman/${n}$`), replacement: join(ts, 'packages', `reportman-${n}`, 'src', 'index.ts') })),
    },
    server: { host: '127.0.0.1', port: 0, fs: { allow: [ts, samples] } },
    plugins: [
      {
        name: 'reportman-demo-data',
        configureServer(server) {
          server.middlewares.use((req, res, next) => {
            const url = decodeURIComponent((req.url ?? '').split('?')[0]);
            if (url.startsWith('/samples/')) return send(res, join(samples, url.slice('/samples/'.length)));
            if (url === '/sql-wasm.wasm') return send(res, wasm);
            if (url === '/responsive.css' && site !== undefined) return send(res, join(site, 'responsive.css'));
            next();
          });
        },
      },
      ...(extra.plugins ?? []),
    ],
    ...extra.config,
  };
}

if (command === 'dev') {
  const server = await createServer(config({ config: { server: { host: '127.0.0.1', port: Number(option('port') ?? 5180), fs: { allow: [ts, samples] } } } }));
  await server.listen();
  server.printUrls();
} else if (command === 'build') {
  const out = resolve(option('out') ?? join(demo, 'dist'));
  await build(
    config({
      config: {
        build: {
          outDir: out,
          emptyOutDir: true,
          target: 'es2022',
          assetsDir: 'assets',
          // The engine, the PDF writer, the text shaper and the preview: one module of 1.7 MB (0.6 gzipped)
          chunkSizeWarningLimit: 2500,
          rollupOptions: { input: { index: join(demo, 'index.html'), indexes: join(demo, 'indexes.html') } },
        },
      },
    }),
  );
  for (const f of sampleFiles()) {
    mkdirSync(dirname(join(out, 'samples', f)), { recursive: true });
    cpSync(join(samples, f), join(out, 'samples', f));
  }
  cpSync(wasm, join(out, 'sql-wasm.wasm'));
  console.log('demo built into ' + out);
} else if (command === 'check') {
  process.exit(await check());
} else if (command === 'thumbs') {
  // The small thumbnails of the list (public/thumbs), from those of the samples, with ImageMagick
  for (const f of readdirSync(join(samples, 'thumbnails')).filter((n) => /\.png$/i.test(n))) {
    const r = spawnSync('magick', [join(samples, 'thumbnails', f), '-resize', '96x', '-strip', '-define', 'png:compression-level=9', join(demo, 'public', 'thumbs', f)], { stdio: 'inherit' });
    if (r.status !== 0) process.exit(1);
  }
} else {
  console.error('usage: node demo/demo.mjs dev|build|check|thumbs');
  process.exit(2);
}

/** A Chromium-based browser of this computer (as tools/check-browser.mjs finds it). */
function findBrowser() {
  if (process.env.CHROME_PATH) return existsSync(process.env.CHROME_PATH) ? process.env.CHROME_PATH : null;
  const candidates =
    process.platform === 'win32'
      ? [
          join(process.env['ProgramFiles(x86)'] ?? 'C:\\Program Files (x86)', 'Microsoft', 'Edge', 'Application', 'msedge.exe'),
          join(process.env.ProgramFiles ?? 'C:\\Program Files', 'Microsoft', 'Edge', 'Application', 'msedge.exe'),
          join(process.env.ProgramFiles ?? 'C:\\Program Files', 'Google', 'Chrome', 'Application', 'chrome.exe'),
        ]
      : ['/usr/bin/google-chrome', '/usr/bin/chromium', '/usr/bin/chromium-browser', '/usr/bin/microsoft-edge'];
  return candidates.find((c) => existsSync(c)) ?? null;
}

/** The PDFs of @reportman/node for the samples, made as the check page makes them. */
async function nodePdfs(names) {
  const { openReport, sqlite } = await import('@reportman/node');
  const { FontLibrary, memoryFontFile } = await import('@reportman/text');
  const { fontsOf } = await import(pathToFileURL(join(demo, 'src', 'fonts.ts')).href);
  const clock = { now: () => new Date(Date.UTC(2026, 0, 15, 9, 30, 0)), offsetMinutes: () => 60 };
  const result = new Map();
  for (const name of names) {
    const file = join(samples, name + '.rep');
    const probe = await openReport(file);
    const connections = {};
    for (const db of probe.model.databaseInfo) connections[db.alias] = sqlite(join(samples, 'samples.db'));
    const files = [...fontsOf(probe.model)].sort();
    const fonts = new FontLibrary(
      files.map((f) => memoryFontFile(f + '.woff2', new Uint8Array(readFileSync(join(demo, 'public', 'fonts', f + '.woff2'))))),
      { platform: 'unix' },
    );
    for (const [mode, f] of [['truetype', fonts], ['standard', false]]) {
      try {
        const report = await openReport(file, { connections, culture: 'en-US', clock, fonts: f });
        result.set(`${name} ${mode}`, await report.executeToPdf({}));
      } catch (e) {
        result.set(`${name} ${mode}`, e instanceof Error ? e.message : String(e));
      }
    }
  }
  return result;
}

async function check() {
  const browser = findBrowser();
  if (browser === null) {
    console.log('skip: no Chromium-based browser on this computer (set CHROME_PATH)');
    return 0;
  }
  const pdfs = new Map();
  let report;
  const result = new Promise((r) => (report = r));
  const body = (req) =>
    new Promise((r) => {
      const chunks = [];
      req.on('data', (c) => chunks.push(c));
      req.on('end', () => r(Buffer.concat(chunks)));
    });
  const server = await createServer(
    config({
      plugins: [
        {
          name: 'reportman-demo-check',
          configureServer(s) {
            s.middlewares.use('/__pdf', async (req, res) => {
              const q = new URL(req.url, 'http://x').searchParams;
              pdfs.set(`${q.get('name')} ${q.get('mode')}`, await body(req));
              res.end('ok');
            });
            s.middlewares.use('/__result', async (req, res) => {
              const text = (await body(req)).toString('utf8');
              res.end('ok');
              report(text);
            });
          },
        },
      ],
      config: { server: { host: '127.0.0.1', port: 0, hmr: false, fs: { allow: [ts, samples] } } },
    }),
  );
  await server.listen();
  const url = server.resolvedUrls.local[0] + 'check.html';
  const profile = mkdtempSync(join(tmpdir(), 'reportman-demo-'));
  const child = spawn(browser, ['--headless=new', '--disable-gpu', '--no-first-run', `--user-data-dir=${profile}`, url], { stdio: 'ignore' });
  const timeout = new Promise((r) => setTimeout(() => r('RESULT: no answer from the browser in 10 minutes'), 600000).unref());
  let text;
  try {
    text = await Promise.race([result, timeout]);
  } finally {
    child.kill();
    await server.close();
    await new Promise((r) => setTimeout(r, 500));
    try {
      rmSync(profile, { recursive: true, force: true });
    } catch {
      // the browser may still hold its profile for a moment
    }
  }
  console.log(text);
  const names = [...new Set([...pdfs.keys()].map((k) => k.split(' ')[0]))];
  const expected = await nodePdfs(names);
  const outDir = join(demo, 'check-out');
  rmSync(outDir, { recursive: true, force: true });
  mkdirSync(outDir, { recursive: true });
  let failures = /FAILED|SKIPPED|the page failed|no answer/.test(text) ? 1 : 0;
  for (const [key, browserPdf] of pdfs) {
    const nodePdf = expected.get(key);
    const same = nodePdf instanceof Uint8Array && Buffer.from(nodePdf).equals(browserPdf);
    if (!same) {
      failures++;
      const base = join(outDir, key.replace(' ', '-'));
      writeFileSync(base + '-browser.pdf', browserPdf);
      if (nodePdf instanceof Uint8Array) writeFileSync(base + '-node.pdf', nodePdf);
    }
    console.log(`${key}: ${same ? 'same PDF as Node' : nodePdf instanceof Uint8Array ? `DIFFERENT (${browserPdf.length} vs ${nodePdf.length} bytes)` : 'Node failed: ' + nodePdf}`);
  }
  console.log(failures === 0 ? `RESULT: ${pdfs.size} PDFs, all the same as Node` : `RESULT: ${failures} problems (PDFs in demo/check-out)`);
  return failures === 0 ? 0 : 1;
}
