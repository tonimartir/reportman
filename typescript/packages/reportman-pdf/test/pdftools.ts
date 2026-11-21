// PDF helpers of the tests: content streams of the engine's PDFs, and pdftotext / pdftoppm
// (poppler in WSL) for the text and raster comparisons.

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import zlib from 'node:zlib';
import { execFileSync } from 'node:child_process';

/** A Windows path as WSL sees it. */
export function toWsl(p: string): string {
  const abs = path.resolve(p);
  const m = /^([A-Za-z]):[\\/](.*)$/.exec(abs);
  if (m === null) return abs.replaceAll('\\', '/');
  return '/mnt/' + (m[1] as string).toLowerCase() + '/' + (m[2] as string).replaceAll('\\', '/');
}

let popplerChecked: boolean | null = null;

/** Poppler (pdftotext, pdftoppm) is available, natively or in WSL. */
export function hasPoppler(): boolean {
  if (popplerChecked === null) {
    try {
      runPoppler('pdftotext', ['-v']);
      popplerChecked = true;
    } catch {
      popplerChecked = false;
    }
  }
  return popplerChecked;
}

function runPoppler(tool: string, args: string[]): Buffer {
  if (process.platform === 'win32') return execFileSync('wsl', [tool, ...args], { stdio: ['ignore', 'pipe', 'pipe'] });
  return execFileSync(tool, args, { stdio: ['ignore', 'pipe', 'pipe'] });
}

function popplerPath(p: string): string {
  return process.platform === 'win32' ? toWsl(p) : p;
}

/** A temporary directory for the files of a test. */
export function tempDir(prefix: string): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

/** The text of a PDF (pdftotext -layout). */
export function pdfToText(pdfFile: string): string {
  return runPoppler('pdftotext', ['-layout', popplerPath(pdfFile), '-']).toString('utf8');
}

/** A gray raster page. */
export interface GrayPage {
  width: number;
  height: number;
  data: Uint8Array;
}

/** Parses a binary PGM (P5) file. */
export function parsePgm(buf: Uint8Array): GrayPage {
  let pos = 0;
  const token = (): string => {
    for (;;) {
      while (pos < buf.length && /\s/.test(String.fromCharCode(buf[pos] as number))) pos++;
      if (buf[pos] === 0x23) {
        while (pos < buf.length && buf[pos] !== 10) pos++;
        continue;
      }
      break;
    }
    let s = '';
    while (pos < buf.length && !/\s/.test(String.fromCharCode(buf[pos] as number))) s += String.fromCharCode(buf[pos++] as number);
    return s;
  };
  if (token() !== 'P5') throw new Error('Not a binary PGM');
  const width = parseInt(token(), 10);
  const height = parseInt(token(), 10);
  const max = parseInt(token(), 10);
  if (max > 255) throw new Error('16 bit PGM not supported');
  pos++; // the single white space after the maximum
  return { width, height, data: buf.subarray(pos, pos + width * height) };
}

/** The pages of a PDF as gray rasters (pdftoppm -gray). */
export function rasterize(pdfFile: string, dpi: number): GrayPage[] {
  const dir = tempDir('rm-raster-');
  const prefix = path.join(dir, 'page');
  runPoppler('pdftoppm', ['-gray', '-r', String(dpi), popplerPath(pdfFile), popplerPath(prefix)]);
  const files = fs.readdirSync(dir).filter((f) => f.endsWith('.pgm')).sort();
  const pages = files.map((f) => parsePgm(new Uint8Array(fs.readFileSync(path.join(dir, f)))));
  fs.rmSync(dir, { recursive: true, force: true });
  return pages;
}

/** The pixels of two rasters that differ by more than a threshold. */
export function rasterDifference(a: GrayPage, b: GrayPage, threshold = 0): number {
  if (a.width !== b.width || a.height !== b.height) throw new Error('Raster sizes differ');
  let count = 0;
  for (let i = 0; i < a.data.length; i++) if (Math.abs((a.data[i] as number) - (b.data[i] as number)) > threshold) count++;
  return count;
}

/** The content streams of a PDF written by the engine, in order, decompressed. */
export function contentStreams(pdf: Uint8Array): Uint8Array[] {
  const src = Buffer.from(pdf).toString('latin1');
  const result: Uint8Array[] = [];
  const re = /(\d+) 0 obj\r\n<< \/Length (\d+) 0 R\r\n(\/Filter \[\/FlateDecode\]\r\n)? >>\r\nstream\r\n/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(src)) !== null) {
    const lengthObj = new RegExp('\\r\\n' + (m[2] as string) + ' 0 obj\\r\\n(\\d+)\\r\\nendobj').exec(src);
    if (lengthObj === null) throw new Error('No length object ' + (m[2] as string));
    const length = parseInt(lengthObj[1] as string, 10);
    const start = m.index + m[0].length;
    const data = pdf.subarray(start, start + length);
    if (src.substring(start + length, start + length + 10) !== '\nendstream') throw new Error('Bad stream length');
    result.push(m[3] !== undefined ? new Uint8Array(zlib.inflateSync(data)) : data);
  }
  return result;
}

/** The first difference of two content streams, line by line, or null. */
export function firstLineDifference(a: Uint8Array, b: Uint8Array): string | null {
  const la = Buffer.from(a).toString('latin1').split('\r\n');
  const lb = Buffer.from(b).toString('latin1').split('\r\n');
  const n = Math.max(la.length, lb.length);
  for (let i = 0; i < n; i++)
    if (la[i] !== lb[i]) return `line ${i + 1}: got ${JSON.stringify(la[i])}, want ${JSON.stringify(lb[i])}`;
  return null;
}
