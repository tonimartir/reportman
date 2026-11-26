// The report host of the demo: what openReport of @reportman/node does (packages/reportman-node/
// src/report.ts), in a browser. The report comes as bytes, the fonts as a FontLibrary of font files
// already fetched, the data from connection factories; the report never sees files.
import { readReportXml, type Report } from '@reportman/lib';
import type { MetaFile } from '@reportman/metafile';
import { PdfDevice, systemClock, type PdfClock } from '@reportman/pdf';
import {
  prepareReport,
  RpDateTime,
  type ConnectionRequest,
  type CultureInfo,
  type DataConnection,
  type DataHost,
  type EvalHost,
  type MaybePromise,
  type ParameterDescription,
  type ParameterInput,
  type ReportRun,
} from '@reportman/engine';
import type { FontLibrary } from '@reportman/text';

/** Opens a report connection (a ConnectionFactory of @reportman/node). */
export type ConnectionFactory = (request: ConnectionRequest) => MaybePromise<DataConnection>;

export interface BrowserReportOptions {
  /** The connections, by report connection alias (case insensitive). */
  connections?: Readonly<Record<string, ConnectionFactory>>;
  /** The culture of the run, a .NET culture name ('en-US' by default). */
  culture?: CultureInfo | string;
  /** The clock of TODAY, NOW and the dates of the PDF. */
  clock?: PdfClock;
  /**
   * The TrueType fonts (each run takes a clone, as fontLibrary of @reportman/node gives); without
   * them, the standard 14 PDF fonts.
   */
  fonts?: FontLibrary;
}

/** A report opened from the bytes of a .rep: the two steps of a run, parameters and output. */
export class BrowserReport {
  readonly model: Report;

  constructor(
    private readonly bytes: Uint8Array,
    private readonly options: BrowserReportOptions = {},
  ) {
    this.model = readReportXml(bytes);
  }

  /** Step 1: the parameters the user fills in, with their options and starting values. */
  async describeParameters(): Promise<ParameterDescription[]> {
    const run = await this.prepare();
    try {
      return await run.describeParameters();
    } finally {
      await run.close();
    }
  }

  /** Step 2: runs the report with the values given (checked as in .NET) and returns the PDF. */
  async executeToPdf(values?: Readonly<Record<string, ParameterInput>> | null, compressed?: boolean): Promise<Uint8Array> {
    const run = await this.prepare();
    try {
      await run.applyParameters(values ?? {});
      const device = run.device as PdfDevice;
      device.compressed = compressed ?? this.model.pdfCompressed;
      return await printPdf(run, device);
    } finally {
      await run.close();
    }
  }

  /** Step 2 for the preview: runs the report with the values given and returns its metafile. */
  async executeToMetafile(values?: Readonly<Record<string, ParameterInput>> | null): Promise<MetaFile> {
    const run = await this.prepare();
    try {
      await run.applyParameters(values ?? {});
      return await run.execute();
    } finally {
      await run.close();
    }
  }

  /** A fresh run of a fresh copy of the model, as NodeReport.prepare. */
  private prepare(): Promise<ReportRun> {
    const clock = this.options.clock ?? systemClock;
    const host: EvalHost = {
      now: () => wallClock(clock),
      fileExists: () => false,
      readFile: () => undefined,
      fileFunctions: false,
    };
    const fonts = this.options.fonts?.clone();
    const model = readReportXml(this.bytes);
    return prepareReport(model, {
      device: new PdfDevice({ clock, fonts }),
      data: dataHost(this.options.connections ?? {}),
      culture: this.options.culture ?? 'en-US',
      host,
      convertToDotNet: true,
    });
  }
}

/** The data host of the engine for the connections given (createDataHost of @reportman/node). */
export function dataHost(connections: Readonly<Record<string, ConnectionFactory>>): DataHost {
  const byAlias = new Map<string, ConnectionFactory>();
  for (const [key, value] of Object.entries(connections)) byAlias.set(key.toUpperCase(), value);
  return {
    connect(request: ConnectionRequest): MaybePromise<DataConnection> {
      const factory = byAlias.get(request.alias.toUpperCase());
      if (factory !== undefined) return factory(request);
      throw new Error('The connection ' + request.alias + ' is not defined');
    },
    datasetRows: () => undefined,
  };
}

/** The local wall clock of a PDF clock (DateTime.Now). */
export function wallClock(clock: PdfClock): RpDateTime {
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

/** printPdf of @reportman/node: PrintOutPDFBase.Print of C#, each page drawn as it is generated. */
export async function printPdf(run: ReportRun, device: PdfDevice): Promise<Uint8Array> {
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
