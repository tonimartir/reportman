// The cases of tools/check-canvas.mjs, made in Node from the sources (Vite loads this module for
// the script): each report run to a metafile, the .rpmf the browser page draws and the PDF of the
// same metafile that poppler rasterizes. With fonts, the PDF device of a run with the TrueType
// fonts of the system gives the font files it used, and the report runs again with those files
// only, in the same order: the page builds the same font library from them, so both choose the
// same faces.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { writeRpmf, type MetaFile } from '@reportman/metafile';
import { PdfDevice } from '@reportman/pdf';
import { FontLibrary, type LogFontFt } from '@reportman/text';
import { currentFontPlatform, diskFontFile, fontDirectories, fontFiles, openReport, sqlite } from '@reportman/node';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..', '..');
const samples = path.resolve(root, '..', 'samples');
const images = path.join(root, 'packages', 'reportman-engine', 'test', 'fixtures', 'images');

/** A case: a report, the pages to compare (0 based, every page by default), the TrueType fonts. */
interface CaseDefinition {
  name: string;
  report: string;
  pages?: number[];
  fonts?: boolean;
}

export const CASES: CaseDefinition[] = [
  { name: 'customers', report: path.join(samples, 'customers.rep') },
  { name: 'invoices', report: path.join(samples, 'invoices.rep') },
  { name: 'labels', report: path.join(samples, 'labels.rep') },
  { name: 'product-catalog', report: path.join(samples, 'product-catalog.rep') },
  { name: 'monthly-sales', report: path.join(samples, 'monthly-sales.rep') },
  { name: 'img-styles', report: path.join(images, 'img-styles.rep') },
  { name: 'img-catalogue', report: path.join(images, 'img-catalogue.rep') },
  { name: 'img-shared', report: path.join(images, 'img-shared.rep') },
  { name: 'img-background', report: path.join(images, 'img-background.rep') },
  { name: 'img-fishes', report: path.join(images, 'img-fishes.rep'), pages: [0, 1, 2] },
  { name: 'customers-fonts', report: path.join(samples, 'customers.rep'), pages: [0], fonts: true },
  { name: 'international-fonts', report: path.join(samples, 'international.rep'), fonts: true },
];

/** What the check needs of a case. */
export interface GeneratedCase {
  name: string;
  pages: number[];
  rpmf: Uint8Array;
  pdf: Uint8Array;
  /** The font files of the library, in order; null for the standard fonts. */
  fonts: string[] | null;
}

async function run(report: string, fonts: FontLibrary | undefined): Promise<MetaFile> {
  const opened = await openReport(report, { connections: { SAMPLES: sqlite(path.join(samples, 'samples.db')) }, fonts: fonts ?? false });
  return opened.executeToMetafile({});
}

/** The PDF of a metafile and the font files its fonts came from. */
function pdfOf(meta: MetaFile, fonts: FontLibrary | undefined): { pdf: Uint8Array; files: Set<string> } {
  const device = new PdfDevice({ fonts, compressed: true });
  if (!device.print(meta)) throw new Error('The metafile has no pages');
  const files = new Set<string>();
  for (const data of device.pdfFile.canvas.fontData.values()) {
    const face = data.logFont as LogFontFt | null;
    if (face !== null) files.add(face.filename);
  }
  return { pdf: device.pdfBytes, files };
}

export async function generateCases(): Promise<GeneratedCase[]> {
  const result: GeneratedCase[] = [];
  const platform = currentFontPlatform();
  let systemFiles: string[] | null = null;
  for (const c of CASES) {
    let library: FontLibrary | undefined;
    let fontList: string[] | null = null;
    if (c.fonts === true) {
      systemFiles ??= fontFiles(fontDirectories(platform));
      const all = new FontLibrary(systemFiles.map(diskFontFile), { platform });
      const used = pdfOf(await run(c.report, all), all).files;
      fontList = systemFiles.filter((f) => used.has(f));
      library = new FontLibrary(fontList.map(diskFontFile), { platform });
    }
    const meta = await run(c.report, library);
    const { pdf, files } = pdfOf(meta, library);
    if (fontList !== null && [...files].some((f) => !fontList.includes(f)))
      throw new Error(c.name + ': the fonts of the second run are not those of the first one');
    const pages = c.pages ?? Array.from({ length: meta.pages.currentCount }, (_, i) => i);
    result.push({ name: c.name, pages, rpmf: writeRpmf(meta), pdf, fonts: fontList });
  }
  return result;
}

/** The bytes of a font file of a case (the page asks for them by path). */
export function fontBytes(file: string): Uint8Array {
  return new Uint8Array(fs.readFileSync(file));
}
