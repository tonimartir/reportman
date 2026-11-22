import { readFileSync, existsSync, statSync } from 'node:fs';
import { readReportXml, type Report } from '@reportman/lib';
import type { MetaFile, PrintOut } from '@reportman/metafile';
import { PdfDevice, systemClock, type PdfClock } from '@reportman/pdf';
import {
  prepareReport,
  RpDateTime,
  Variant,
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
   * Let FILEEXISTS look at the file system, image expressions read the image files they name, and
   * LOADFILE and GETINIVALUE read files (false by default: a report does not see the disk).
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
   * executeToPdf, executeToMetafile, executeWithDevice), before the engine prepares it: the host
   * can adjust the report as its old host did, e.g. its language (`model.language = 4`) or a
   * parameter default.
   */
  beforeRun?: (model: Report) => void;
}

/** Options of a PDF. */
export interface PdfOptions extends RunOptions {
  /** Flate compress the content streams (the report's PDFCompressed by default). */
  compressed?: boolean;
}

/** Options of one run (executeToPdf, executeToMetafile, executeWithDevice). */
export interface RunOptions {
  /**
   * Cancels the run: it fails with the reason of the signal (an AbortError by default). The run
   * looks at it between pages and while it lays out records; a query already sent to the database
   * runs to its end.
   */
  signal?: AbortSignal;
  /** Progress: the records and pages so far, at most every half second and at the end. */
  onProgress?: (recordCount: number, pageCount: number) => void;
  /**
   * Values set straight on the parameters, as the execute endpoint of Reportman.Server does
   * (ReportExecutionService.ApplyParameters): any parameter, hidden ones too, by its alias or its
   * name in any case; JSON values, a text "yyyy-MM-dd[THH:mm[:ss]]" a date. Nothing is checked: it is
   * the call of a program, not the form of a person. When given, the values of the form (the
   * first argument) are not applied.
   */
  assign?: Readonly<Record<string, unknown>>;
}

const ISO_DATE = /^\d{4}-\d{2}-\d{2}(?:[T ]\d{2}:\d{2}(?::\d{2}(?:\.\d{1,7})?)?)?(?:Z|[+-]\d{2}:?\d{2})?$/;

/** ReportExecutionService.ToClr: the value of a JSON value for a parameter. */
function assignedValue(value: unknown): Variant | string | number | boolean | null {
  if (value === null || value === undefined) return null;
  if (typeof value === 'boolean') return value;
  // TryGetInt64: an integer is a long, any other number a double
  if (typeof value === 'number') return Number.isInteger(value) && Math.abs(value) > 2147483647 ? Variant.fromLong(BigInt(value)) : value;
  if (typeof value === 'string') return ISO_DATE.test(value) ? Variant.fromDateTime(RpDateTime.parseIso(value)) : value;
  // GetRawText of an array or an object
  return JSON.stringify(value);
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
    options.signal?.throwIfAborted();
    const run = await this.prepare(options);
    try {
      await this.setParameters(run, values, options);
      const device = run.device as PdfDevice;
      device.compressed = options.compressed ?? this.model.pdfCompressed;
      return await withSignal(options.signal, () => printPdf(run, device, options.signal));
    } finally {
      await run.close();
    }
  }

  /** Runs the report with the values given and returns the metafile, for other outputs. */
  async executeToMetafile(values?: Readonly<Record<string, ParameterInput>> | null, options: RunOptions = {}): Promise<MetaFile> {
    options.signal?.throwIfAborted();
    const run = await this.prepare(options);
    try {
      await this.setParameters(run, values, options);
      return await withSignal(options.signal, () => run.execute());
    } finally {
      await run.close();
    }
  }

  /**
   * Runs the report with the values given on the device of another output, which lays the report
   * out as it prints it (the TextDevice of @reportman/export measures on its character grid), and
   * gives the run to `print`: its answer is the result. The connections close after it.
   *
   * ```ts
   * const text = await report.executeWithDevice(new TextDevice(), (run) => runReportToText(run), values);
   * ```
   */
  async executeWithDevice<T>(
    device: PrintOut,
    print: (run: ReportRun) => Promise<T>,
    values?: Readonly<Record<string, ParameterInput>> | null,
    options: RunOptions = {},
  ): Promise<T> {
    options.signal?.throwIfAborted();
    const run = await this.prepare(options, device);
    try {
      await this.setParameters(run, values, options);
      return await withSignal(options.signal, () => print(run));
    } finally {
      await run.close();
    }
  }

  /** The values of the form (checked), or the assigned ones (set as they come). */
  private async setParameters(run: ReportRun, values: Readonly<Record<string, ParameterInput>> | null | undefined, options: RunOptions): Promise<void> {
    if (options.assign === undefined) {
      await run.applyParameters(values ?? {});
      return;
    }
    for (const [key, value] of Object.entries(options.assign)) {
      const k = key.toUpperCase();
      const p = this.model.params.find((q) => q.alias.toUpperCase() === k) ?? this.model.params.find((q) => q.name.toUpperCase() === k);
      // A name the report does not have is left out, as Reportman.Server does
      if (p !== undefined) run.setParameterValue(p.alias, assignedValue(value));
    }
  }

  /** A fresh run of a fresh copy of the model: the engine converts and fills what it runs. */
  private async prepare(runOptions: RunOptions = {}, device?: PrintOut): Promise<ReportRun> {
    const clock = this.options.clock ?? systemClock;
    const allowFileAccess = this.options.allowFileAccess ?? false;
    const host: EvalHost = {
      now: () => wallClock(clock),
      fileExists: (path) => allowFileAccess && existsSync(path),
      // The bytes of the image file an image expression names (FileInfo.Exists: a file, not a directory)
      readFile: (path) => (allowFileAccess && isFile(path) ? new Uint8Array(readFileSync(path)) : undefined),
      // LOADFILE and GETINIVALUE read files too
      fileFunctions: allowFileAccess,
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
    const { signal, onProgress } = runOptions;
    return prepareReport(model, {
      device: device ?? new PdfDevice({ clock, fonts }),
      data: createDataHost(this.options),
      culture: this.options.culture ?? 'en-US',
      host,
      convertToDotNet: true,
      // The engine cancels when its progress callback returns true
      onProgress:
        signal === undefined && onProgress === undefined
          ? undefined
          : (records, pages) => {
              onProgress?.(records, pages);
              return signal?.aborted === true;
            },
    });
  }
}

/** Runs a step; when the signal aborted it, the error is the reason of the signal. */
async function withSignal<T>(signal: AbortSignal | undefined, step: () => Promise<T>): Promise<T> {
  try {
    return await step();
  } catch (e) {
    if (signal?.aborted === true) throw signal.reason;
    throw e;
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
async function printPdf(run: ReportRun, device: PdfDevice, signal?: AbortSignal): Promise<Uint8Array> {
  const meta = run.metaFile;
  await run.begin();
  signal?.throwIfAborted();
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
    signal?.throwIfAborted();
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
