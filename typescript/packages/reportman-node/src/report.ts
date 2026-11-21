import { readFileSync, existsSync, statSync } from 'node:fs';
import { readReportXml, type Report } from '@reportman/lib';
import type { MetaFile } from '@reportman/metafile';
import { PdfDevice, systemClock, type PdfClock } from '@reportman/pdf';
import {
  prepareReport,
  RpDateTime,
  type CultureInfo,
  type EvalHost,
  type ParameterDescription,
  type ParameterInput,
  type ReportRun,
} from '@reportman/engine';
import { createDataHost, type DataSources } from './host.js';
import { fontLibrary, type FontOptions } from './fonts.js';
import { FontLibrary } from '@reportman/text';

/** Options of openReport. */
export interface OpenReportOptions extends DataSources {
  /**
   * The culture of the run (number and date formats, parsing), a .NET culture name: 'en-US',
   * 'es-ES', 'ca-ES', 'pt-BR', 'fr-FR', 'de-DE', 'it-IT' or the invariant culture ('').
   * 'en-US' by default. As in C#, a report with Language 0, 1 or 2 uses en-US, es-ES or ca-ES
   * while it prints its pages.
   */
  culture?: CultureInfo | string;
  /** The clock of TODAY, NOW and the dates of the PDF (the system clock by default). */
  clock?: PdfClock;
  /**
   * Let FILEEXISTS look at the file system, and image expressions read the image files they name
   * (false by default: a report does not see the disk).
   */
  allowFileAccess?: boolean;
  /**
   * The fonts of the PDF. By default (or false) the standard 14 PDF fonts, as PrintOutPDFStandard.
   * With font options (system folders, extra folders) or a FontLibrary, the TrueType fonts of the
   * machine, as PrintOutPDFFreeType (Reportman.Server): every text shaped, its font embedded and
   * subset, HTML text, right to left and complex scripts, PDF/A-3.
   */
  fonts?: FontOptions | FontLibrary | false;
  /**
   * Called with the fresh copy of the report model each step runs (describeParameters,
   * executeToPdf, executeToMetafile), before the engine prepares it: the host can adjust the
   * report as its old host did, e.g. its language (`model.language = 4`) or a parameter default.
   */
  beforeRun?: (model: Report) => void;
}

/** Options of a PDF. */
export interface PdfOptions {
  /** Flate compress the content streams (the report's PDFCompressed by default). */
  compressed?: boolean;
}

/** A report opened from a .rep file: the two steps of a run, parameters and PDF. */
export class NodeReport {
  private readonly bytes: Uint8Array;
  private readonly options: OpenReportOptions;
  /** The report model as read from the file (the camelCase JSON of the engine model). */
  readonly model: Report;

  constructor(bytes: Uint8Array, options: OpenReportOptions = {}) {
    this.bytes = bytes;
    this.options = options;
    this.model = readReportXml(bytes);
  }

  /**
   * Step 1: the parameters the user fills in, with the options of the lists and the lookup
   * datasets already run, the values the form starts with, and what may be edited — the
   * ParameterDescription of the .NET server (ReportParameters.Describe).
   */
  async describeParameters(): Promise<ParameterDescription[]> {
    const run = await this.prepare();
    try {
      return await run.describeParameters();
    } finally {
      await run.close();
    }
  }

  /** Step 1 as the JSON text of the .NET server. */
  async describeParametersJson(): Promise<string> {
    const run = await this.prepare();
    try {
      return await run.describeParametersJson();
    } finally {
      await run.close();
    }
  }

  /**
   * Step 2: runs the report with the values the user gave (by parameter name; the others keep
   * the values the form would start with) and returns the PDF. Values are checked as in .NET
   * (ReportParameters.Apply): a wrong one throws a ParameterException that names it.
   */
  async executeToPdf(values?: Readonly<Record<string, ParameterInput>> | null, options: PdfOptions = {}): Promise<Uint8Array> {
    const run = await this.prepare();
    try {
      await run.applyParameters(values ?? {});
      const device = run.device as PdfDevice;
      device.compressed = options.compressed ?? this.model.pdfCompressed;
      return await printPdf(run, device);
    } finally {
      await run.close();
    }
  }

  /** Runs the report with the values given and returns the metafile, for other outputs. */
  async executeToMetafile(values?: Readonly<Record<string, ParameterInput>> | null): Promise<MetaFile> {
    const run = await this.prepare();
    try {
      await run.applyParameters(values ?? {});
      return await run.execute();
    } finally {
      await run.close();
    }
  }

  /** A fresh run of a fresh copy of the model: the engine converts and fills what it runs. */
  private async prepare(): Promise<ReportRun> {
    const clock = this.options.clock ?? systemClock;
    const allowFileAccess = this.options.allowFileAccess ?? false;
    const host: EvalHost = {
      now: () => wallClock(clock),
      fileExists: (path) => allowFileAccess && existsSync(path),
      // The bytes of the image file an image expression names (FileInfo.Exists: a file, not a directory)
      readFile: (path) => (allowFileAccess && isFile(path) ? new Uint8Array(readFileSync(path)) : undefined),
    };
    const fontsOption = this.options.fonts;
    const fonts =
      fontsOption === undefined || fontsOption === false
        ? undefined
        : fontsOption instanceof FontLibrary
          ? fontsOption
          : fontLibrary(fontsOption);
    const model = readReportXml(this.bytes);
    if (this.options.beforeRun !== undefined) this.options.beforeRun(model);
    return prepareReport(model, {
      device: new PdfDevice({ clock, fonts }),
      data: createDataHost(this.options),
      culture: this.options.culture ?? 'en-US',
      host,
      convertToDotNet: true,
    });
  }
}

function isFile(path: string): boolean {
  try {
    return statSync(path).isFile();
  } catch {
    return false;
  }
}

/** The local wall clock of a PDF clock (DateTime.Now). */
function wallClock(clock: PdfClock): RpDateTime {
  const instant = clock.now();
  const local = new Date(instant.getTime() + clock.offsetMinutes(instant) * 60000);
  return RpDateTime.create(
    local.getUTCFullYear(),
    local.getUTCMonth() + 1,
    local.getUTCDate(),
    local.getUTCHours(),
    local.getUTCMinutes(),
    local.getUTCSeconds(),
  );
}

/**
 * PrintOutPDFBase.Print of C#, with the run giving the pages: the report starts (BeginPrint, the
 * first page is laid out while measuring with the device), the document starts, and each page is
 * drawn as soon as it is generated, the next one requested after it. A report with nothing to
 * print throws NoDataToPrintException (EmptyReportThrowException, as the .NET server).
 */
async function printPdf(run: ReportRun, device: PdfDevice): Promise<Uint8Array> {
  const meta = run.metaFile;
  await run.begin();
  device.preparePrint(meta);
  let current = device.fromPage - 1;
  await run.requestPage(current);
  if (meta.pages.currentCount < device.fromPage) throw new Error('The report has no page to print');
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
  return device.pdfBytes;
}

/** Opens a .rep report (XML, plain or zlib compressed) from a file or from its bytes. */
export async function openReport(source: string | Uint8Array, options: OpenReportOptions = {}): Promise<NodeReport> {
  const bytes = typeof source === 'string' ? new Uint8Array(readFileSync(source)) : source;
  return new NodeReport(bytes, options);
}
