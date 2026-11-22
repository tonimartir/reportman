// The browser preview against the PDF, pixel by pixel: the sample reports and image reports run in
// Node (tools/canvas-check/generate.ts, from the sources), each metafile goes to a headless
// Chromium (Edge or Chrome, CHROME_PATH chooses another) as a .rpmf, @reportman/canvas draws its
// pages at 100 dpi there and the page posts their pixels back in gray; the PDF of the same metafile
// is rasterized by poppler (pdftoppm -r 100 -gray, in WSL on Windows) and the two are compared.
//
// The PDF does not embed the standard 14 fonts: each viewer draws them with a font of its own,
// and poppler in a bare WSL would take Noto Sans for Helvetica. On Windows poppler is given the
// fonts the browser draws them with (Arial, Times New Roman, Courier New, a fontconfig file of its
// own), so the comparison measures the preview, not the choice of a substitute. The TrueType cases
// embed their fonts: there both draw the same outlines. Poppler also draws as the preview does what
// is a choice of the viewer: hairlines one pixel wide and solid (-thinlinemode solid, and
// -aaVector no, since poppler leaves curved hairlines a faint gray even then) and without the
// annotations (-hide-annotations), which the preview gives the page apart.
//
// A pixel differs when its gray and the gray of every pixel within one pixel of it in the other
// raster are more than 64 apart (a quarter of the scale), both ways. The two rasterizers place a
// baseline on different pixel rows (poppler floors it, the browser rounds it), hint the stems of
// the standard fonts differently and anti-alias differently: that moves edges by a pixel and grays
// by less than a quarter, and is not counted; a glyph, a line or an image somewhere else is. Each
// page reports the share of its differing pixels among the pixels inked in either raster (the
// white of the paper is the same anyway), and the share in its worst 160 px square (among those
// with some ink). Measured on the cases (Edge 158, poppler 24.02): at most 4.8 % of the ink of a
// page and 16.1 % of a square for the standard fonts, 0.03 % and 0.3 % with the TrueType fonts;
// moving the texts of the standard fonts 2 px down (half a millimetre) makes 24 of those 26
// pages fail, their worst squares at 18 % to 39 %. A page fails above PAGE_THRESHOLD or
// WINDOW_THRESHOLD. The pictures of every page
// (preview | PDF | differences: red where only the preview is darker, blue where only the PDF is,
// and a zoom of the worst square) go to a temporary folder, printed at the end.
//
// Without a browser or without poppler it says so and passes. Not part of tools/ci.mjs.
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { execFileSync, spawn, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { deflateSync } from 'node:zlib';
import { createServer } from 'vite';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const DPI = 100;
/** Two grays that differ by more than this are a differing pixel. */
const GRAY_TOLERANCE = 64;
/** The share of the inked pixels of a page that may differ (see the measurements above). */
const PAGE_THRESHOLD = 0.06;
/** The share of the inked pixels of its worst 160 px square that may differ. */
const WINDOW_THRESHOLD = 0.2;

function findBrowser() {
  if (process.env.CHROME_PATH) return existsSync(process.env.CHROME_PATH) ? process.env.CHROME_PATH : null;
  const candidates =
    process.platform === 'win32'
      ? [
          join(process.env['ProgramFiles(x86)'] ?? 'C:\\Program Files (x86)', 'Microsoft', 'Edge', 'Application', 'msedge.exe'),
          join(process.env.ProgramFiles ?? 'C:\\Program Files', 'Microsoft', 'Edge', 'Application', 'msedge.exe'),
          join(process.env.ProgramFiles ?? 'C:\\Program Files', 'Google', 'Chrome', 'Application', 'chrome.exe'),
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

// ---------------------------------------------------------------------------------------------
// Poppler

const inWsl = process.platform === 'win32';

/** A Windows path as WSL sees it. */
function toWsl(p) {
  const m = /^([A-Za-z]):[\\/](.*)$/.exec(resolve(p));
  return m === null ? p.replaceAll('\\', '/') : '/mnt/' + m[1].toLowerCase() + '/' + m[2].replaceAll('\\', '/');
}

function popplerPath(p) {
  return inWsl ? toWsl(p) : p;
}

function runPoppler(tool, args, env = {}) {
  const pairs = Object.entries(env).map(([k, v]) => k + '=' + v);
  if (inWsl) return execFileSync('wsl', ['env', ...pairs, tool, ...args], { stdio: ['ignore', 'pipe', 'pipe'] });
  return execFileSync(tool, args, { stdio: ['ignore', 'pipe', 'pipe'], env: { ...process.env, ...env } });
}

function hasPoppler() {
  try {
    runPoppler('pdftoppm', ['-v']);
    return true;
  } catch {
    return false;
  }
}

/**
 * On Windows, a fontconfig of poppler's own: the core fonts of Windows, Helvetica as Arial, Times as
 * Times New Roman, Courier as Courier New. Elsewhere poppler keeps the substitutes of the system.
 */
function popplerFontEnv(work) {
  if (!inWsl) return {};
  const windir = process.env.SystemRoot ?? 'C:\\Windows';
  const fonts = join(work, 'fonts');
  mkdirSync(fonts);
  for (const f of readdirSync(join(windir, 'Fonts'))) if (/^(arial|arialbd|ariali|arialbi|times|timesbd|timesi|timesbi|cour|courbd|couri|courbi)\.ttf$/i.test(f)) copyFileSync(join(windir, 'Fonts', f), join(fonts, f));
  const alias = (from, to) => `  <alias binding="same"><family>${from}</family><prefer><family>${to}</family></prefer></alias>\n`;
  const conf =
    '<?xml version="1.0"?>\n<!DOCTYPE fontconfig SYSTEM "fonts.dtd">\n<fontconfig>\n' +
    `  <dir>${toWsl(fonts)}</dir>\n  <cachedir>${toWsl(join(work, 'fccache'))}</cachedir>\n` +
    alias('Helvetica', 'Arial') +
    alias('Times', 'Times New Roman') +
    alias('Times-Roman', 'Times New Roman') +
    alias('Courier', 'Courier New') +
    '</fontconfig>\n';
  writeFileSync(join(work, 'fonts.conf'), conf);
  return { FONTCONFIG_FILE: toWsl(join(work, 'fonts.conf')) };
}

/** Parses a binary PGM (P5). */
function parsePgm(buf) {
  let pos = 0;
  const token = () => {
    for (;;) {
      while (pos < buf.length && /\s/.test(String.fromCharCode(buf[pos]))) pos++;
      if (buf[pos] === 0x23) {
        while (pos < buf.length && buf[pos] !== 10) pos++;
        continue;
      }
      break;
    }
    let s = '';
    while (pos < buf.length && !/\s/.test(String.fromCharCode(buf[pos]))) s += String.fromCharCode(buf[pos++]);
    return s;
  };
  if (token() !== 'P5') throw new Error('Not a binary PGM');
  const width = parseInt(token(), 10);
  const height = parseInt(token(), 10);
  token();
  pos++;
  return { width, height, data: buf.subarray(pos, pos + width * height) };
}

/** The pages of a PDF in gray at the resolution of the check, by page number (1 based). */
function rasterize(pdfFile, outDir, env) {
  mkdirSync(outDir);
  // Thin lines one pixel wide, as the preview draws the hairlines of a report (and Acrobat does);
  // without the annotations, which the preview gives the viewer apart and does not draw
  runPoppler('pdftoppm', ['-gray', '-r', String(DPI), '-thinlinemode', 'solid', '-aaVector', 'no', '-hide-annotations', popplerPath(pdfFile), popplerPath(join(outDir, 'p'))], env);
  const pages = new Map();
  for (const f of readdirSync(outDir)) {
    const m = /^p-0*(\d+)\.pgm$/.exec(f);
    if (m !== null) pages.set(Number(m[1]), parsePgm(new Uint8Array(readFileSync(join(outDir, f)))));
  }
  return pages;
}

// ---------------------------------------------------------------------------------------------
// Pictures

const CRC = new Int32Array(256);
for (let n = 0; n < 256; n++) {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  CRC[n] = c;
}
function crc32(buf) {
  let c = -1;
  for (const b of buf) c = CRC[(c ^ b) & 255] ^ (c >>> 8);
  return (c ^ -1) >>> 0;
}
function chunk(type, data) {
  const out = Buffer.alloc(12 + data.length);
  out.writeUInt32BE(data.length, 0);
  out.write(type, 4, 'latin1');
  Buffer.from(data).copy(out, 8);
  out.writeUInt32BE(crc32(out.subarray(4, 8 + data.length)), 8 + data.length);
  return out;
}
/** An RGB PNG. */
function encodePng(width, height, rgb) {
  const raw = Buffer.alloc((width * 3 + 1) * height);
  for (let y = 0; y < height; y++) Buffer.from(rgb.buffer, rgb.byteOffset + y * width * 3, width * 3).copy(raw, y * (width * 3 + 1) + 1);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;
  ihdr[9] = 2;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}

/**
 * Preview | PDF | differences, of a region (x, y, w, h) of the two rasters, each pixel zoom times.
 * The differences show the PDF faint, the differing pixels red (only the preview is darker) or
 * blue (only the PDF is).
 */
function sideBySide(a, b, diff, width, x0, y0, w, h, zoom) {
  const gap = 6;
  const W = (w * 3 + gap * 2) * zoom;
  const H = h * zoom;
  const rgb = new Uint8Array(W * H * 3).fill(128);
  const put = (px, py, r, g, bl) => {
    for (let dy = 0; dy < zoom; dy++)
      for (let dx = 0; dx < zoom; dx++) {
        const o = ((py * zoom + dy) * W + px * zoom + dx) * 3;
        rgb[o] = r;
        rgb[o + 1] = g;
        rgb[o + 2] = bl;
      }
  };
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const i = (y0 + y) * width + x0 + x;
      const ga = a[i];
      const gb = b[i];
      put(x, y, ga, ga, ga);
      put(w + gap + x, y, gb, gb, gb);
      const faint = 255 - ((255 - gb) >> 2);
      if (diff[i] === 1) {
        if (ga < gb) put(2 * (w + gap) + x, y, 230, 0, 0);
        else put(2 * (w + gap) + x, y, 0, 60, 230);
      } else put(2 * (w + gap) + x, y, faint, faint, faint);
    }
  return encodePng(W, H, rgb);
}

// ---------------------------------------------------------------------------------------------
// Comparison

/** The differing and inked pixels of two rasters, over their common size, and the worst 160 px square. */
function compare(a, aw, ah, b) {
  const w = Math.min(aw, b.width);
  const h = Math.min(ah, b.height);
  const ga = new Uint8Array(w * h);
  const gb = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) {
    ga.set(a.subarray(y * aw, y * aw + w), y * w);
    gb.set(b.data.subarray(y * b.width, y * b.width + w), y * w);
  }
  const BLOCK = 40;
  const bw = Math.ceil(w / BLOCK);
  const blocks = new Uint32Array(bw * Math.ceil(h / BLOCK));
  let differing = 0;
  let strict = 0;
  let inked = 0;
  // A gray of one raster that some pixel of the other has within one pixel of it
  const near = (src, dst, x, y) => {
    const v = src[y * w + x];
    for (let dy = -1; dy <= 1; dy++) {
      const yy = y + dy;
      if (yy < 0 || yy >= h) continue;
      for (let dx = -1; dx <= 1; dx++) {
        const xx = x + dx;
        if (xx >= 0 && xx < w && Math.abs(dst[yy * w + xx] - v) <= GRAY_TOLERANCE) return true;
      }
    }
    return false;
  };
  const diff = new Uint8Array(w * h);
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const i = y * w + x;
      if (ga[i] < 250 || gb[i] < 250) inked++;
      if (Math.abs(ga[i] - gb[i]) <= GRAY_TOLERANCE) continue;
      strict++;
      if (near(ga, gb, x, y) && near(gb, ga, x, y)) continue;
      diff[i] = 1;
      differing++;
      blocks[Math.floor(y / BLOCK) * bw + Math.floor(x / BLOCK)]++;
    }
  // The 4 x 4 blocks with the most differences, and the share of their ink that differs
  const inkBlocks = new Uint32Array(blocks.length);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) if (ga[y * w + x] < 250 || gb[y * w + x] < 250) inkBlocks[Math.floor(y / BLOCK) * bw + Math.floor(x / BLOCK)]++;
  let best = { x: 0, y: 0, n: -1, ink: 0 };
  const MIN_WINDOW_INK = 400;
  for (let by = 0; by < Math.ceil(h / BLOCK); by++)
    for (let bx = 0; bx < bw; bx++) {
      let n = 0;
      let ink = 0;
      for (let dy = 0; dy < 4; dy++)
        for (let dx = 0; dx < 4 && bx + dx < bw; dx++) {
          n += blocks[(by + dy) * bw + bx + dx] ?? 0;
          ink += inkBlocks[(by + dy) * bw + bx + dx] ?? 0;
        }
      // The square whose ink differs the most, among those with some ink
      if (ink >= MIN_WINDOW_INK && (best.n < 0 || n / ink > best.n / Math.max(1, best.ink))) best = { x: bx * BLOCK, y: by * BLOCK, n, ink };
    }
  return { w, h, ga, gb, diff, differing, strict, inked, worst: best };
}

// ---------------------------------------------------------------------------------------------

const browser = findBrowser();
if (browser === null) {
  console.log('skip: no Chromium-based browser on this computer (set CHROME_PATH)');
  process.exit(0);
}
if (!hasPoppler()) {
  console.log('skip: no pdftoppm (poppler) on this computer' + (inWsl ? ' or in WSL' : ''));
  process.exit(0);
}

const work = mkdtempSync(join(tmpdir(), 'reportman-canvas-'));
const pictures = join(tmpdir(), 'reportman-canvas-check');
rmSync(pictures, { recursive: true, force: true });
mkdirSync(pictures);

const packages = ['lib', 'metafile', 'text', 'pdf', 'engine', 'node', 'canvas'];
const drawn = new Map();
let report;
const result = new Promise((r) => (report = r));
let cases = [];
const server = await createServer({
  configFile: false,
  root: join(root, 'tools', 'canvas-check'),
  logLevel: 'error',
  resolve: { alias: packages.map((n) => ({ find: new RegExp(`^@reportman/${n}$`), replacement: join(root, 'packages', `reportman-${n}`, 'src', 'index.ts') })) },
  server: { host: '127.0.0.1', port: 0, hmr: false, fs: { allow: [root] } },
  plugins: [
    {
      name: 'reportman-canvas-check',
      configureServer(s) {
        const query = (req) => new URL(req.url ?? '/', 'http://localhost').searchParams;
        s.middlewares.use('/__cases', (_req, res) => {
          res.setHeader('Content-Type', 'application/json');
          res.end(JSON.stringify(cases.map((c) => ({ name: c.name, pages: c.pages, fonts: c.fonts }))));
        });
        s.middlewares.use('/__rpmf', (req, res) => {
          const c = cases.find((x) => x.name === query(req).get('name'));
          if (c === undefined) {
            res.statusCode = 404;
            res.end();
            return;
          }
          res.end(Buffer.from(c.rpmf));
        });
        s.middlewares.use('/__font', (req, res) => {
          const file = query(req).get('path');
          // Only the files of the cases
          if (!cases.some((c) => c.fonts !== null && c.fonts.includes(file))) {
            res.statusCode = 404;
            res.end();
            return;
          }
          res.end(readFileSync(file));
        });
        s.middlewares.use('/__page', (req, res) => {
          const q = query(req);
          const parts = [];
          req.on('data', (c) => parts.push(c));
          req.on('end', () => {
            res.end('ok');
            drawn.set(q.get('case') + '/' + q.get('page'), {
              width: Number(q.get('w')),
              height: Number(q.get('h')),
              ms: Number(q.get('ms')),
              skipped: JSON.parse(q.get('skipped') ?? '[]'),
              gray: new Uint8Array(Buffer.concat(parts)),
            });
          });
        });
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

let exitCode = 1;
let child = null;
let profile = null;
try {
  // The cases, from the sources
  const t0 = Date.now();
  const generator = await server.ssrLoadModule('/generate.ts');
  cases = await generator.generateCases();
  const env = popplerFontEnv(work);
  const rasters = new Map();
  for (const c of cases) {
    const pdfFile = join(work, c.name + '.pdf');
    writeFileSync(pdfFile, c.pdf);
    rasters.set(c.name, rasterize(pdfFile, join(work, c.name), env));
  }
  console.log(`${cases.length} cases, ${cases.reduce((n, c) => n + c.pages.length, 0)} pages, run and rasterized in ${((Date.now() - t0) / 1000).toFixed(1)} s`);

  await server.listen();
  const url = server.resolvedUrls.local[0];
  profile = mkdtempSync(join(tmpdir(), 'reportman-browser-'));
  child = spawn(browser, ['--headless=new', '--disable-gpu', '--no-first-run', '--disable-lcd-text', `--user-data-dir=${profile}`, url], { stdio: 'ignore' });
  const timeout = new Promise((r) => setTimeout(() => r('RESULT: no answer from the browser in 10 minutes'), 600000).unref());
  const text = await Promise.race([result, timeout]);
  const pageLines = text.split('\n').filter((l) => l.trim());
  console.log(pageLines[0]);
  if (!/RESULT: drawn/.test(text)) {
    console.log(pageLines.slice(1).join('\n'));
  } else {
    const rows = [];
    let failures = 0;
    for (const c of cases) {
      for (const pageIndex of c.pages) {
        const key = c.name + '/' + pageIndex;
        const canvas = drawn.get(key);
        const pdfPage = rasters.get(c.name).get(pageIndex + 1);
        if (canvas === undefined || pdfPage === undefined) {
          rows.push({ key, line: `${key}: ${canvas === undefined ? 'not drawn' : 'not rasterized'}`, share: 1 });
          failures++;
          continue;
        }
        const r = compare(canvas.gray, canvas.width, canvas.height, pdfPage);
        const share = r.inked === 0 ? 0 : r.differing / r.inked;
        const pageShare = r.differing / (r.w * r.h);
        const sizeNote = canvas.width !== pdfPage.width || canvas.height !== pdfPage.height ? ` size ${canvas.width}x${canvas.height} vs ${pdfPage.width}x${pdfPage.height}` : '';
        const windowShare = r.worst.n / Math.max(1, r.worst.ink);
        const fail = share > PAGE_THRESHOLD || windowShare > WINDOW_THRESHOLD || Math.abs(canvas.width - pdfPage.width) > 1 || Math.abs(canvas.height - pdfPage.height) > 1;
        if (fail) failures++;
        const name = `${c.name}-p${pageIndex + 1}`;
        writeFileSync(join(pictures, name + '.png'), sideBySide(r.ga, r.gb, r.diff, r.w, 0, 0, r.w, r.h, 1));
        const zw = Math.min(160, r.w - r.worst.x);
        const zh = Math.min(160, r.h - r.worst.y);
        writeFileSync(join(pictures, name + '-zoom.png'), sideBySide(r.ga, r.gb, r.diff, r.w, r.worst.x, r.worst.y, zw, zh, 3));
        const skipped = canvas.skipped.length > 0 ? ` skipped: ${canvas.skipped.join('; ')}` : '';
        rows.push({
          key,
          share,
          line:
            `${fail ? 'FAIL' : 'ok  '} ${name.padEnd(26)} ${(100 * share).toFixed(2).padStart(6)} % of the ink` +
            ` (${(100 * pageShare).toFixed(3)} % of the page, ${r.differing} px; pixel by pixel ${((100 * r.strict) / Math.max(1, r.inked)).toFixed(1)} %) ${String(canvas.ms).padStart(4)} ms` +
            ` worst 160 px at ${r.worst.x},${r.worst.y}: ${(100 * windowShare).toFixed(1)} % of its ink${sizeNote}${skipped}`,
        });
      }
    }
    for (const r of rows) console.log(r.line);
    const worst = [...rows].sort((a, b) => b.share - a.share).slice(0, 3);
    console.log(`Pictures (preview | PDF | differences, and -zoom of the worst region): ${pictures}`);
    console.log(`The worst pages: ${worst.map((r) => r.key + ' ' + (100 * r.share).toFixed(2) + ' %').join(', ')}`);
    console.log(failures === 0 ? `RESULT: every page within ${PAGE_THRESHOLD * 100} % of its ink and ${WINDOW_THRESHOLD * 100} % in any square` : `RESULT: ${failures} pages differ`);
    exitCode = failures === 0 ? 0 : 1;
  }
} catch (e) {
  console.log('RESULT: the check failed: ' + (e instanceof Error ? (e.stack ?? e.message) : String(e)));
} finally {
  child?.kill();
  await server.close();
  await new Promise((r) => setTimeout(r, 500));
  for (const dir of [profile, work]) {
    if (dir === null) continue;
    try {
      rmSync(dir, { recursive: true, force: true });
    } catch {
      // the browser may still hold its profile for a moment
    }
  }
}
process.exit(exitCode);
