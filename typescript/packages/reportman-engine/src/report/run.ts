// The entry point of the report engine: prepare a report, describe and apply its parameters (the
// two steps of a parameters form), and lay it out into a metafile measuring with a device.
//
//   const run = await prepareReport(model, { data, device, culture });
//   const form = await run.describeParameters();
//   await run.applyParameters({ FIRST_ORDER: 3 });
//   const meta = await run.execute();

import type { Report } from 'reportman-lib';
import type { MetaFile, PrintOut } from 'reportman-metafile';
import { defaultHost, type EvalHost } from '../eval/evaluator.js';
import { CultureInfo } from '../util/culture.js';
import type { Translator } from '../util/translator.js';
import type { LocalTimeZone } from '../util/dateformat.js';
import { Variant } from '../variant/variant.js';
import { type DataHost, noDataHost } from '../data/host.js';
import { runAsync } from '../data/op.js';
import {
  applyDefaults,
  applyParameters,
  describeParameters,
  type ParameterDescription,
  type ParameterInput,
  parameterDescriptionsToJson,
} from '../params/parameters.js';
import { convertToDotNet } from './convert.js';
import { type ReportProgress, ReportRuntime } from './report.js';

/** The options of prepareReport. */
export interface PrepareReportOptions {
  /** The layout device: it measures the texts while the report is laid out (a PdfDevice...). */
  device: PrintOut;
  /** The data host (connections and queries); without one every connection fails. */
  data?: DataHost;
  /** The culture of numbers and dates (the thread culture of C#); en-US by default. */
  culture?: CultureInfo | string;
  /** The clock and file system of the expressions (TODAY, NOW, FILEEXISTS...). */
  host?: EvalHost;
  /** The engine messages; by default the table of the culture (Spanish for "es", else English). */
  translator?: Translator;
  /**
   * Convert a report of the Delphi engine as the C# engine does when it loads one
   * (ConvertToDotNet: `:NAME` parameters become `@NAME`, Delphi display formats .Net ones). True by
   * default; reports whose connections are .Net, Mybase or SQLite of the Delphi engine are kept.
   */
  convertToDotNet?: boolean;
  /** Progress: records and pages so far; return true to cancel (the report fails). */
  onProgress?: ReportProgress;
  /** Run only these subreports (by index) and their child subreports. */
  subReportIndexes?: number[];
  /** The local time zone of the expressions (dates with a zone, the "K" format); UTC by default. */
  timeZone?: LocalTimeZone;
}

/** The options of describeParameters and applyParameters. */
export interface ParametersOptions {
  /** The caller designs reports: substitution and expression parameters are editable. */
  canEditFreeText?: boolean;
}

/** A report ready to run. */
export class ReportRun {
  readonly runtime: ReportRuntime;
  readonly device: PrintOut;
  private begun = false;

  constructor(runtime: ReportRuntime, device: PrintOut) {
    this.runtime = runtime;
    this.device = device;
  }

  /** The metafile the report is laid out into. */
  get metaFile(): MetaFile {
    return this.runtime.metaFile;
  }

  /** Step one: the parameters the user sees, with their defaults and options (lookups read). */
  async describeParameters(options: ParametersOptions = {}): Promise<ParameterDescription[]> {
    return this.withCleanup(() => runAsync(describeParameters(this.runtime, options.canEditFreeText ?? false)));
  }

  /** Step one, as the JSON .NET writes for it (System.Text.Json, web defaults). */
  async describeParametersJson(options: ParametersOptions = {}): Promise<string> {
    return parameterDescriptionsToJson(await this.describeParameters(options));
  }

  /**
   * Step two: assigns the posted values (by alias, any case) and runs the report's validations;
   * throws ParameterException at the first value refused.
   */
  async applyParameters(
    values: Readonly<Record<string, ParameterInput>> | null | undefined,
    options: ParametersOptions = {},
  ): Promise<void> {
    await this.withCleanup(() => runAsync(applyParameters(this.runtime, values, options.canEditFreeText ?? false)));
  }

  /** The values a parameters form would start from, asking nobody anything (the preview). */
  async applyDefaults(): Promise<void> {
    await this.withCleanup(() => runAsync(applyDefaults(this.runtime)));
  }

  /**
   * Assigns a parameter's value directly (Param.Value), as a host of the C# engine does: a
   * string, number or boolean, or a Variant. Throws when the report has no such parameter.
   */
  setParameterValue(alias: string, value: Variant | string | number | boolean | null): void {
    const p = this.runtime.paramByAlias(alias);
    if (p === null) throw new Error('Unknown parameter ' + alias);
    p.value = value instanceof Variant ? value : Variant.fromHost(value);
  }

  private async withCleanup<T>(f: () => Promise<T>): Promise<T> {
    try {
      return await f();
    } catch (e) {
      await runAsync(this.runtime.closeAll());
      throw e;
    }
  }

  /**
   * Begins the layout (BeginPrint): the page size from the device, the parameters, the datasets
   * opened and the first section found. Fails with NoDataToPrintException when there is nothing
   * to print.
   */
  async begin(): Promise<void> {
    this.device.currentMetafile = this.runtime.metaFile;
    this.begun = true;
    await this.withCleanup(() => runAsync(this.runtime.beginPrint(this.device)));
  }

  /**
   * Generates pages until the one asked for exists (every page for a two pass report), as a
   * device of the C# engine asks for them while it prints; true when the report has finished.
   */
  async requestPage(pageIndex: number): Promise<boolean> {
    if (!this.begun) await this.begin();
    return this.withCleanup(() => runAsync(this.runtime.requestPage(pageIndex)));
  }

  /**
   * Closes the connections the report opened (the lookups of describeParameters keep theirs open,
   * as C# does, until the report runs). A run closes them when it ends.
   */
  async close(): Promise<void> {
    await runAsync(this.runtime.closeAll());
  }

  /** Lays the whole report out and returns the finished metafile. */
  async execute(): Promise<MetaFile> {
    await this.begin();
    await this.requestPage(2147483647);
    await runAsync(this.runtime.closeAll());
    return this.runtime.metaFile;
  }
}

/** Prepares a report (a model read with readReportXml) to describe its parameters and run it. */
export async function prepareReport(model: Report, options: PrepareReportOptions): Promise<ReportRun> {
  const culture =
    options.culture === undefined
      ? CultureInfo.get('en-US')
      : typeof options.culture === 'string'
        ? CultureInfo.get(options.culture)
        : options.culture;
  const runtime = new ReportRuntime(model, {
    host: options.data ?? noDataHost,
    culture,
    evalHost: options.host ?? defaultHost,
    translator: options.translator,
    onProgress: options.onProgress,
    subReportIndexes: options.subReportIndexes,
    timeZone: options.timeZone,
  });
  if (options.convertToDotNet !== false) convertToDotNet(runtime);
  return new ReportRun(runtime, options.device);
}
