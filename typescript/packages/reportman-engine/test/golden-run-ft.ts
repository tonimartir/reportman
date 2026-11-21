// Helpers of the FreeType parity tests: a run printed the way golden-cs prints with
// PrintOutPDFFreeType (the same device measures the layout and draws each page as soon as it is
// generated, PrintOutPDFBase.Print), the font library of the machine, and the fingerprint of its
// font files (the C# PDFs embed the fonts of the machine they were made on).

import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { readReportXml } from '@reportman/lib';
import type { MetaFile } from '@reportman/metafile';
import { PdfDevice, type PdfClock } from '@reportman/pdf';
import { NoDataToPrintException, prepareReport, RpDateTime, type EvalHost } from '@reportman/engine';
import { fontDirectories, fontFiles, fontLibrary } from '@reportman/node';
import { FontLibrary } from '@reportman/text';
import { samplesDb } from './golden-run.js';
import { sqliteHost } from './sqlite-host.js';

export interface FreeTypeCase {
  name: string;
  report: string;
  params?: Record<string, string>;
  culture?: string;
}

/** The font files of the system the FreeType fixtures were made with: name and size of each. */
export function fontFingerprint(): string[] {
  return fontFiles(fontDirectories('windows')).map((f) => path.basename(f).toLowerCase() + ':' + String(fs.statSync(f).size));
}

let library: FontLibrary | null = null;

/** A fresh font library of the system fonts (one scan per test process, a clean state per run). */
export function systemFonts(): FontLibrary {
  if (library === null) library = fontLibrary({ platform: 'windows' });
  return library.clone();
}

export interface FreeTypeRun {
  meta: MetaFile;
  pdf: Uint8Array | null;
  noData: boolean;
}

/** Runs a report and prints it as golden-cs run --driver freetype does. */
export async function runFreeTypeLikeGolden(
  reportFile: string,
  options: { params?: Record<string, string>; culture?: string; now?: RpDateTime; clock?: PdfClock; fonts: FontLibrary },
): Promise<FreeTypeRun> {
  const model = readReportXml(new Uint8Array(fs.readFileSync(reportFile)));
  const now = options.now;
  const evalHost: EvalHost = {
    now: () => now ?? RpDateTime.fromJsDate(new Date()),
    fileExists: () => false,
  };
  const device = new PdfDevice({ fonts: options.fonts, compressed: false, clock: options.clock });
  const run = await prepareReport(model, {
    device,
    data: sqliteHost(samplesDb),
    culture: options.culture ?? 'en-US',
    host: evalHost,
  });
  for (const [k, v] of Object.entries(options.params ?? {})) run.setParameterValue(k, v);
  const meta = run.metaFile;
  try {
    await run.begin();
  } catch (e) {
    if (e instanceof NoDataToPrintException) return { meta, pdf: null, noData: true };
    throw e;
  }
  device.preparePrint(meta);
  let current = device.fromPage - 1;
  await run.requestPage(current);
  if (meta.pages.currentCount < device.fromPage) return { meta, pdf: null, noData: false };
  device.setOrientation(meta.orientation);
  device.setPageSize(meta.pages.get(0).pageDetail);
  while (meta.pages.currentCount > current) {
    const page = meta.pages.get(current);
    if (page.updatedPageSize) {
      device.setOrientation(page.orientation);
      device.setPageSize(page.pageDetail);
    }
    if (current >= device.fromPage) device.newPage(meta, page);
    device.drawPage(meta, page);
    current++;
    if (current > device.toPage - 1) break;
    await run.requestPage(current);
  }
  device.endDocument(meta);
  return { meta, pdf: device.pdfBytes, noData: false };
}

/** A fixture PDF, stored gzipped. */
export function readGzip(file: string): Uint8Array {
  return new Uint8Array(zlib.gunzipSync(fs.readFileSync(file)));
}

/** The text of the font objects of a PDF: descriptors, Type0 and CID fonts, without the subset tags. */
export function fontObjects(pdf: Uint8Array): string[] {
  const src = Buffer.from(pdf).toString('latin1');
  const out: string[] = [];
  const re = /\d+ 0 obj\r?\n(<< \/Type \/(?:FontDescriptor|Font)[\s\S]*?)endobj/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(src)) !== null) out.push((m[1] as string).replace(/[A-Z]{6}\+/g, 'XXXXXX+').replace(/\d+ 0 R/g, 'n 0 R'));
  return out;
}

/** A PDF as the document parity compares it (documentStructure). */
export interface PdfStructure {
  /** Everything before the first object: the version and the binary comment. */
  header: string;
  /** "n: text" of each object but the font programs and their glyph maps, subset tags hidden. */
  objects: string[];
  /** The trailer dictionary, the identifiers hidden. */
  trailer: string;
  /** The identifiers of the trailer (/ID), empty without them. */
  ids: string[];
  /** The objects the cross reference table does not point at, empty when it is right. */
  badOffsets: number[];
}

/**
 * The objects of a PDF but the font programs and their glyph maps (fontkit subsets, not hb-subset
 * ones), with the subset tags hidden, and its trailer with the /ID hidden (a random GUID): the
 * header, the information dictionary, the XMP metadata, the output intent and its ICC profile,
 * the content streams, the fonts, the pages, the resources, the images, the embedded files and the
 * catalog. Also whether each entry of the cross reference table points at its object.
 */
export function documentStructure(pdf: Uint8Array): PdfStructure {
  const src = Buffer.from(pdf).toString('latin1');
  const first = /\d+ 0 obj\r?\n/.exec(src);
  const header = first === null ? src : src.substring(0, first.index);
  const skipped = new Set<string>();
  for (const m of src.matchAll(/\/(?:FontFile2|FontFile3|CIDToGIDMap) (\d+) 0 R/g)) skipped.add(m[1] as string);
  const objects: string[] = [];
  for (const m of src.matchAll(/(?:^|\n)(\d+) 0 obj\r?\n([\s\S]*?)endobj/g)) {
    const n = m[1] as string;
    if (skipped.has(n)) continue;
    objects.push(n + ': ' + (m[2] as string).replace(/[A-Z]{6}\+/g, 'XXXXXX+'));
  }
  const t = /trailer\r?\n([\s\S]*?)startxref/.exec(src);
  const trailerText = t === null ? '' : (t[1] as string);
  const ids = [...trailerText.matchAll(/<([0-9A-Fa-f]*)>/g)].map((m) => m[1] as string);
  const trailer = trailerText.replace(/\/ID \[<[0-9A-Fa-f]*> <[0-9A-Fa-f]*>\]/, '/ID [<id> <id>]');
  const badOffsets: number[] = [];
  const x = /xref\r?\n0 (\d+)\r?\n([\s\S]*?)trailer/.exec(src);
  if (x !== null) {
    const entries = (x[2] as string).match(/\d{10} \d{5} [fn] ?\r?\n/g) ?? [];
    entries.forEach((e, i) => {
      if (e.length !== 20) badOffsets.push(i);
      else if (i > 0 && !src.startsWith(String(i) + ' 0 obj', parseInt(e.substring(0, 10), 10))) badOffsets.push(i);
    });
    if (entries.length !== parseInt(x[1] as string, 10)) badOffsets.push(-1);
  } else badOffsets.push(-1);
  return { header, objects, trailer, ids, badOffsets };
}

/** Where two texts differ first, with some context, or null. */
export function firstTextDifference(a: string, b: string): string | null {
  if (a === b) return null;
  let i = 0;
  while (i < a.length && i < b.length && a[i] === b[i]) i++;
  return `at ${i}: got ${JSON.stringify(a.substring(Math.max(0, i - 40), i + 40))}, want ${JSON.stringify(b.substring(Math.max(0, i - 40), i + 40))}`;
}
