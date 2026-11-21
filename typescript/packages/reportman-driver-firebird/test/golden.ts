// The cases of the tests (cases.json) and a run of a report the way golden-cs runs it: parameter
// values assigned as strings (golden-cs --param sets Param.Value = "7"), then every page laid out.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { readReportXml } from 'reportman-lib';
import type { MetaFile } from 'reportman-metafile';
import { PdfDevice } from 'reportman-pdf';
import { NoDataToPrintException, prepareReport, RpDateTime, type DataHost, type EvalHost, type ReportRun } from 'reportman-engine';

export const here = path.dirname(fileURLToPath(import.meta.url));
export const runFixtures = path.join(here, 'fixtures/run');
export const sqlFixtures = path.join(here, 'fixtures/sql');

export interface ReportCase {
  name: string;
  report: string;
  params?: Record<string, string>;
  culture?: string;
  /**
   * C# runs the report and the TypeScript engine fails: the text of its error and why (a limitation of
   * this driver, not of FirebirdClient).
   */
  knownDifference?: { tsError: string; why: string };
}

export interface QueryCase {
  name: string;
  sql: string;
}

export function cases(): { reports: ReportCase[]; queries: QueryCase[] } {
  return JSON.parse(fs.readFileSync(path.join(here, 'cases.json'), 'utf8')) as { reports: ReportCase[]; queries: QueryCase[] };
}

export interface RunResult {
  run: ReportRun;
  meta: MetaFile;
  noData: boolean;
}

/**
 * Runs a report as golden-cs does. The caller closes the run (its connections commit); a run that
 * fails is closed here.
 */
export async function runLikeGolden(
  reportFile: string,
  data: DataHost,
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
    data,
    culture: options.culture ?? 'en-US',
    host: evalHost,
  });
  try {
    for (const [k, v] of Object.entries(options.params ?? {})) run.setParameterValue(k, v);
    const meta = run.metaFile;
    try {
      await run.begin();
    } catch (e) {
      // PrintOut.PreparePrint: no data to print is not an error of the device
      if (e instanceof NoDataToPrintException) return { run, meta, noData: true };
      throw e;
    }
    await run.requestPage(2147483647);
    return { run, meta, noData: false };
  } catch (e) {
    await run.close();
    throw e;
  }
}
