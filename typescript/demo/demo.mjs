// The live demo of reportman.es (demo/): the sample reports run by the @reportman packages in the
// browser. The page takes the packages from their sources, so it always runs the engine of this
// repository; its data (the samples, the sql.js WebAssembly) is copied from where it lives.
//
//   node demo/demo.mjs dev [--site <folder>]   a dev server (with --site, the doc/ folder of the
//                                              website, for responsive.css)
//   node demo/demo.mjs build [--out <folder>]  the static site into <folder> (demo/dist by default),
//                                              for doc/demo of the Delphi repository
//   node demo/demo.mjs check                   the site built as published, every sample run in a
//                                              headless Edge or Chrome, each PDF compared with the
//                                              one @reportman/node writes
//   node demo/demo.mjs thumbs                  the small thumbnails of the list (ImageMagick)
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import http from 'node:http';
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
// The designer's page: the element of @reportman/designer (npm run build:designer makes its dist) and
// Monaco, copied as they are; its server is a service worker built from the sources
const designerDist = join(ts, 'packages', 'reportman-designer', 'dist');
const monacoMin = join(ts, 'node_modules', 'monaco-editor', 'min');

/** The packages from their sources, the designer's protocol without Node too. */
function aliases() {
  return [
    { find: /^@reportman\/designer-server\/browser$/, replacement: join(ts, 'packages', 'reportman-designer-server', 'src', 'browser.ts') },
    ...packages.map((n) => ({ find: new RegExp(`^@reportman/${n}$`), replacement: join(ts, 'packages', `reportman-${n}`, 'src', 'index.ts') })),
  ];
}

const [command = 'dev', ...rest] = process.argv.slice(2);
const option = (name) => {
  const i = rest.indexOf('--' + name);
  return i < 0 ? undefined : rest[i + 1];
};

/** The sample files the demo serves: the reports, their database and samples.ini. */
function sampleFiles() {
  return readdirSync(samples).filter((f) => /\.rep$/i.test(f) || f === 'samples.db' || f === 'samples.ini');
}

const TYPES = { '.rep': 'application/xml', '.db': 'application/octet-stream', '.ini': 'text/plain; charset=utf-8', '.png': 'image/png', '.css': 'text/css', '.wasm': 'application/wasm', '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.woff2': 'font/woff2' };
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
    resolve: { alias: aliases() },
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
  await buildSite(out, false);
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

/**
 * The static site into a folder: the pages (minified, as published), the samples and sql.js.
 * withCheck adds the check page, so the check runs the code the website serves.
 */
async function buildSite(out, withCheck) {
  if (!existsSync(join(designerDist, 'main.js'))) throw new Error('No ' + designerDist + ': run npm run build:designer first');
  const input = {
    index: join(demo, 'index.html'),
    indexes: join(demo, 'indexes.html'),
    designer: join(demo, 'designer', 'index.html'),
    designeres: join(demo, 'designer', 'indexes.html'),
  };
  if (withCheck) input.check = join(demo, 'check.html');
  await build(
    config({
      config: {
        logLevel: 'error',
        build: {
          outDir: out,
          emptyOutDir: true,
          target: 'es2022',
          assetsDir: 'assets',
          // The engine, the PDF writer, the text shaper and the preview: one module of 1.7 MB (0.6 gzipped)
          chunkSizeWarningLimit: 2500,
          rollupOptions: { input },
        },
      },
    }),
  );
  for (const f of sampleFiles()) {
    mkdirSync(dirname(join(out, 'samples', f)), { recursive: true });
    cpSync(join(samples, f), join(out, 'samples', f));
  }
  cpSync(wasm, join(out, 'sql-wasm.wasm'));
  await buildDesignerWorker(join(out, 'designer'));
  copyDesignerElement(join(out, 'designer', 'element'));
}

/**
 * The service worker of the designer's page (designer/sw.js): a classic script, as every browser
 * runs one, with the engine, the PDF writer, the protocol and sql.js inside.
 */
async function buildDesignerWorker(outDir) {
  await build({
    configFile: false,
    root: demo,
    logLevel: 'error',
    // The fonts and thumbnails of public/ are the site's, already copied by the pages' build
    publicDir: false,
    resolve: { alias: aliases() },
    define: { 'process.env.NODE_ENV': JSON.stringify('production') },
    build: {
      outDir,
      emptyOutDir: false,
      target: 'es2022',
      chunkSizeWarningLimit: 4000,
      lib: { entry: join(demo, 'src', 'designer', 'sw.ts'), formats: ['iife'], name: 'reportmanDesignerWorker', fileName: () => 'sw.js' },
    },
  });
}

/**
 * The element's files (as npm ships them) and Monaco's, next to it, as the designer looks for them.
 * The designer edits SQL and expressions only: the workers of TypeScript, CSS, HTML and JSON
 * (8.7 MB of the 16 of Monaco) are left out.
 */
function copyDesignerElement(outDir) {
  cpSync(designerDist, outDir, { recursive: true, filter: (f) => !/[\\/](test\.html|prerendered-routes\.json)$/.test(f) });
  cpSync(monacoMin, join(outDir, 'assets', 'monaco-editor', 'min'), {
    recursive: true,
    filter: (f) => !/[\\/]assets[\\/](ts|css|html|json)\.worker-[^\\/]*\.js$/.test(f),
  });
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
  // The site as it is published (minified: a minifier renames classes, and code that looks at
  // their names breaks only there), with the check page, served as the website serves it
  const site = mkdtempSync(join(tmpdir(), 'reportman-demo-site-'));
  await buildSite(site, true);
  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url, 'http://x');
    if (url.pathname === '/__pdf') {
      pdfs.set(`${url.searchParams.get('name')} ${url.searchParams.get('mode')}`, await body(req));
      res.end('ok');
      return;
    }
    if (url.pathname === '/__result') {
      const text = (await body(req)).toString('utf8');
      res.end('ok');
      report(text);
      return;
    }
    const file = join(site, decodeURIComponent(url.pathname));
    if (!file.startsWith(site) || !existsSync(file) || !statSync(file).isFile()) {
      res.statusCode = 404;
      res.end();
      return;
    }
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Content-Type', typeOf(file));
    res.end(readFileSync(file));
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const url = `http://127.0.0.1:${server.address().port}/check.html`;
  const profile = mkdtempSync(join(tmpdir(), 'reportman-demo-'));
  const child = spawn(browser, ['--headless=new', '--disable-gpu', '--no-first-run', `--user-data-dir=${profile}`, url], { stdio: 'ignore' });
  const timeout = new Promise((r) => setTimeout(() => r('RESULT: no answer from the browser in 10 minutes'), 600000).unref());
  let text;
  try {
    text = await Promise.race([result, timeout]);
  } finally {
    child.kill();
    await new Promise((r) => server.close(r));
    await new Promise((r) => setTimeout(r, 500));
    try {
      rmSync(profile, { recursive: true, force: true });
      rmSync(site, { recursive: true, force: true });
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
