// Helpers of the run parity tests: the metafile as golden-cs writes it, the clock of a C# PDF, and
// a run of a report the way golden-cs runs it (the PDF device asks for the pages one by one and
// draws each one as soon as it exists, as PrintOutPDF.Print does).

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { readReportXml } from '@reportman/lib';
import { MetaFile, MetaPage, OrientationType, PDFConformanceType, type MetaObject } from '@reportman/metafile';
import { PdfDevice, renderPdf, type PdfClock } from '@reportman/pdf';
import { NoDataToPrintException, prepareReport, RpDateTime, type EvalHost, type ReportRun } from '@reportman/engine';
import { sqliteHost } from './sqlite-host.js';

export const here = path.dirname(fileURLToPath(import.meta.url));
export const samplesDb = path.resolve(here, '../../../../samples/samples.db');
export const runFixtures = path.join(here, 'fixtures/run');

export interface RunCase {
  name: string;
  report: string;
  params?: Record<string, string>;
  culture?: string;
}

export function runCases(): RunCase[] {
  return JSON.parse(fs.readFileSync(path.join(here, 'run-cases.json'), 'utf8')) as RunCase[];
}

const FIELD_NAMES: Record<string, string> = { dpiRes: 'DPIRes' };

/** The JSON of an object of a page as golden-cs writes it (JObject.FromObject plus its strings). */
function objectJson(page: MetaPage, obj: MetaObject): Record<string, unknown> {
  const jo: Record<string, unknown> = { class: obj.constructor.name };
  for (const [k, v] of Object.entries(obj)) jo[FIELD_NAMES[k] ?? k.charAt(0).toUpperCase() + k.slice(1)] = v;
  const pool = (p: number, s: number): string => (s <= 0 ? '' : String.fromCharCode(...page.pool.subarray(p - 1, p - 1 + s)));
  const o = obj as unknown as Record<string, number>;
  if (jo.class === 'MetaObjectText') {
    jo.text = pool(o.textP!, o.textS!);
    jo.lFontName = pool(o.lFontNameP!, o.lFontNameS!);
    jo.wFontName = pool(o.wFontNameP!, o.wFontNameS!);
  }
  if (jo.class === 'MetaObjectExport') jo.textExp = pool(o.textExpP!, o.textExpS!);
  if (obj.annotationS > 0) jo.annotation = pool(obj.annotationP, obj.annotationS);
  return jo;
}

/** The metafile as golden-cs writes it (MetaFileJson). */
export function metaFileJson(meta: MetaFile): Record<string, unknown> {
  const pages: unknown[] = [];
  for (const page of meta.pages) {
    const d = page.pageDetail;
    pages.push({
      orientation: OrientationType[page.orientation],
      updatedPageSize: page.updatedPageSize,
      pageDetail: {
        Index: d.index,
        Custom: d.custom,
        CustomWidth: d.customWidth,
        CustomHeight: d.customHeight,
        PhysicWidth: d.physicWidth,
        PhysicHeight: d.physicHeight,
        PaperSource: d.paperSource,
        ForcePaperName: d.forcePaperName,
        Duplex: d.duplex,
      },
      objects: page.objects.map((o) => objectJson(page, o)),
    });
  }
  return {
    pageSizeIndex: meta.pageSizeIndex,
    customX: meta.customX,
    customY: meta.customY,
    orientation: OrientationType[meta.orientation],
    backColor: meta.backColor,
    docAuthor: meta.docAuthor,
    docTitle: meta.docTitle,
    docSubject: meta.docSubject,
    docProducer: meta.docProducer,
    docCreator: meta.docCreator,
    docKeywords: meta.docKeywords,
    docXMPContent: meta.docXMPContent,
    docCreationDate: meta.docCreationDate,
    docModificationDate: meta.docModificationDate,
    pdfConformance: PDFConformanceType[meta.pdfConformance],
    pdfCompressed: meta.pdfCompressed,
    pages,
  };
}

/** The creation date of a PDF of the engine: its local time and time zone offset. */
export function pdfCreation(pdf: Uint8Array): { clock: PdfClock; now: RpDateTime } {
  const src = Buffer.from(pdf).toString('latin1');
  const m = /\/CreationDate \(D:(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})(Z|([+-])(\d{2})'(\d{2})')?\)/.exec(src);
  if (m === null) throw new Error('The PDF has no creation date');
  const [y, mo, d, h, mi, s] = m.slice(1, 7).map(Number) as [number, number, number, number, number, number];
  const offset = m[8] === undefined ? 0 : (m[8] === '-' ? -1 : 1) * (Number(m[9]) * 60 + Number(m[10]));
  const instant = new Date(Date.UTC(y, mo - 1, d, h, mi, s) - offset * 60000);
  return {
    clock: { now: () => instant, offsetMinutes: () => offset },
    now: RpDateTime.create(y, mo, d, h, mi, s),
  };
}

/** A copy of a page as it is now (the pool too: page counts are written into it later). */
function snapshot(meta: MetaFile, page: MetaPage): MetaPage {
  const copy = new MetaPage(meta);
  copy.orientation = page.orientation;
  copy.updatedPageSize = page.updatedPageSize;
  copy.pageDetail = Object.assign(Object.create(Object.getPrototypeOf(page.pageDetail) as object), page.pageDetail);
  copy.objects = page.objects.map((o) => Object.assign(Object.create(Object.getPrototypeOf(o) as object), o) as MetaObject);
  const internal = copy as unknown as { fPool: Uint16Array; fPoolPos: number };
  internal.fPool = page.pool.slice();
  internal.fPoolPos = page.poolPos;
  return copy;
}

export interface RunResult {
  run: ReportRun;
  meta: MetaFile;
  /** The pages as the C# PDF device drew them (each one when it was generated). */
  drawn: MetaPage[];
  /** The report had nothing to print (NoDataToPrintException): the C# device prints nothing. */
  noData: boolean;
}

/** Runs a report as golden-cs does: the device asks for page after page and draws each one. */
export async function runLikeGolden(
  reportFile: string,
  options: { params?: Record<string, string>; culture?: string; now?: RpDateTime } = {},
): Promise<RunResult> {
  const model = readReportXml(new Uint8Array(fs.readFileSync(reportFile)));
  const now = options.now;
  const evalHost: EvalHost = {
    now: () => now ?? RpDateTime.fromJsDate(new Date()),
    fileExists: () => false,
  };
  const run = await prepareReport(model, {
    device: new PdfDevice(),
    data: sqliteHost(samplesDb),
    culture: options.culture ?? 'en-US',
    host: evalHost,
  });
  for (const [k, v] of Object.entries(options.params ?? {})) run.setParameterValue(k, v);
  const meta = run.metaFile;
  try {
    await run.begin();
  } catch (e) {
    // PrintOut.PreparePrint: no data to print is not an error of the device
    if (e instanceof NoDataToPrintException) return { run, meta, drawn: [], noData: true };
    throw e;
  }
  const drawn: MetaPage[] = [];
  let current = 0;
  await run.requestPage(current);
  while (meta.pages.currentCount > current) {
    drawn.push(snapshot(meta, meta.pages.get(current)));
    current++;
    await run.requestPage(current);
  }
  return { run, meta, drawn, noData: false };
}

/** The PDF of the pages as they were drawn, with the clock of the C# PDF. */
export function renderDrawn(meta: MetaFile, drawn: MetaPage[], clock: PdfClock): Uint8Array {
  const pages = [...meta.pages];
  meta.pages.clearCollection();
  for (const p of drawn) meta.pages.add(p);
  try {
    return renderPdf(meta, { compressed: false, clock });
  } finally {
    meta.pages.clearCollection();
    for (const p of pages) meta.pages.add(p);
  }
}
