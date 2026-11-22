// .rpmf parity with the C# engine: for each case of fixtures/rpmf (generate-rpmf-fixtures.mjs) the
// TypeScript run of the report, saved with writeRpmf, gives the bytes MetaFile.SaveToStream wrote
// for the C# run; readRpmf reads the C# file (plain and, for some cases, compressed by the C#
// engine) into a metafile that writes back the same bytes; and a compressed file reads back equal.
// The FreeType case lays out with the fonts of the machine: its TypeScript run only compares on
// the fonts the fixtures were made with, the reading tests run everywhere.

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import zlib from 'node:zlib';
import { describe, expect, it } from 'vitest';
import { readReportXml } from '@reportman/lib';
import { readRpmf, writeRpmf, type MetaFile } from '@reportman/metafile';
import { PdfDevice } from '@reportman/pdf';
import { NoDataToPrintException, prepareReport, type EvalHost, type RpDateTime } from '@reportman/engine';
import { here, pdfCreation, runLikeGolden, samplesDb } from './golden-run.js';
import { fontFingerprint, runFreeTypeLikeGolden, systemFonts } from './golden-run-ft.js';
import { sqliteHost } from './sqlite-host.js';

interface RpmfCase {
  name: string;
  /** Relative to test/. */
  report: string;
  params?: Record<string, string>;
  culture?: string;
  /** The image expressions read their files from this folder (relative to test/). */
  folder?: string;
  /** The PDF device of the run: the standard fonts, or the TrueType fonts of the system. */
  driver?: 'freetype';
  /** The C# engine also wrote the file compressed (NAME.rpmfz). */
  compressed?: boolean;
  /** Creation date of the C# PDF of the run (the clock of the TypeScript run). */
  creationDate?: string;
}

const fixtures = path.join(here, 'fixtures/rpmf');
const cases = JSON.parse(fs.readFileSync(path.join(fixtures, 'cases.json'), 'utf8')) as RpmfCase[];
const sameFonts =
  process.platform === 'win32' &&
  JSON.stringify(fontFingerprint().sort()) ===
    JSON.stringify(JSON.parse(fs.readFileSync(path.join(here, 'fixtures/freetype/fonts.json'), 'utf8')));

/** -1 when the bytes are equal, else the first offset where they differ. */
function firstDifference(a: Uint8Array, b: Uint8Array): number {
  if (Buffer.compare(Buffer.from(a.buffer, a.byteOffset, a.length), Buffer.from(b.buffer, b.byteOffset, b.length)) === 0) return -1;
  const n = Math.min(a.length, b.length);
  for (let i = 0; i < n; i++) if (a[i] !== b[i]) return i;
  return n;
}

/** Runs a report as golden-cs does (the device asks for page after page), files read from a folder. */
async function runInFolder(c: RpmfCase, now: RpDateTime | undefined): Promise<MetaFile> {
  const folder = path.join(here, c.folder as string);
  const model = readReportXml(new Uint8Array(fs.readFileSync(path.resolve(here, c.report))));
  const file = (p: string): string => path.resolve(folder, p);
  const host: EvalHost = {
    now: () => now ?? ({} as RpDateTime),
    fileExists: (p) => fs.existsSync(file(p)) && fs.statSync(file(p)).isFile(),
    readFile: (p) => new Uint8Array(fs.readFileSync(file(p))),
  };
  const run = await prepareReport(model, { device: new PdfDevice(), data: sqliteHost(samplesDb), culture: c.culture ?? 'en-US', host });
  for (const [k, v] of Object.entries(c.params ?? {})) run.setParameterValue(k, v);
  const meta = run.metaFile;
  try {
    await run.begin();
  } catch (e) {
    if (e instanceof NoDataToPrintException) return meta;
    throw e;
  }
  let current = 0;
  await run.requestPage(current);
  while (meta.pages.currentCount > current) {
    current++;
    await run.requestPage(current);
  }
  return meta;
}

/** The metafile of the TypeScript run of a case, run the way its own parity test runs it. */
async function runCase(c: RpmfCase): Promise<MetaFile> {
  const clock =
    c.creationDate === undefined ? undefined : pdfCreation(new Uint8Array(Buffer.from('/CreationDate (' + c.creationDate + ')', 'latin1')));
  const reportFile = path.resolve(here, c.report);
  if (c.driver === 'freetype') {
    const r = await runFreeTypeLikeGolden(reportFile, {
      params: c.params,
      culture: c.culture,
      now: clock?.now,
      clock: clock?.clock,
      fonts: systemFonts(),
    });
    return r.meta;
  }
  if (c.folder !== undefined) return runInFolder(c, clock?.now);
  return (await runLikeGolden(reportFile, { params: c.params, culture: c.culture, now: clock?.now })).meta;
}

describe.each(cases)('rpmf parity with golden-cs: $name', (c) => {
  const csBytes = new Uint8Array(zlib.gunzipSync(fs.readFileSync(path.join(fixtures, c.name + '.rpmf.gz'))));

  it.skipIf(c.driver === 'freetype' && !sameFonts)('writes the bytes C# writes for the same report', async () => {
    const meta = await runCase(c);
    const ts = writeRpmf(meta);
    const at = firstDifference(ts, csBytes);
    if (at >= 0) fs.writeFileSync(path.join(os.tmpdir(), 'rm-rpmf-' + c.name + '.ts.rpmf'), ts);
    expect(at, `first difference at byte ${at} (TypeScript ${ts.length} bytes, C# ${csBytes.length})`).toBe(-1);
  });

  it('reads the C# file and writes the same bytes back', () => {
    const meta = readRpmf(csBytes);
    expect(meta.finished).toBe(true);
    expect(firstDifference(writeRpmf(meta), csBytes)).toBe(-1);
  });

  if (c.compressed === true) {
    it('reads the file the C# engine compressed', () => {
      const csCompressed = new Uint8Array(fs.readFileSync(path.join(fixtures, c.name + '.rpmfz')));
      expect(csCompressed[0]).toBe(0x78);
      expect(firstDifference(writeRpmf(readRpmf(csCompressed)), csBytes)).toBe(-1);
    });
  }

  it('reads back what it writes compressed', () => {
    const meta = readRpmf(csBytes);
    const compressed = writeRpmf(meta, { compressed: true });
    expect(compressed[0]).toBe(0x78);
    const back = readRpmf(compressed);
    expect(back.version).toBe(meta.version);
    expect(back.pages.count).toBe(meta.pages.count);
    expect(firstDifference(writeRpmf(back), csBytes)).toBe(-1);
  });
});
