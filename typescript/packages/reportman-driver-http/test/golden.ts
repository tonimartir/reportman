// The cases of the parity tests (cases.json), the connections of a run over the mock Hub, and a run of a
// report the way golden-cs runs it (parameter values assigned as strings, as golden-cs --param sets
// Param.Value = "7", the PDF device asking for the pages one by one).

import fs from 'node:fs';
import net from 'node:net';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect } from 'vitest';
import { readReportXml } from 'reportman-lib';
import type { MetaFile } from 'reportman-metafile';
import { PdfDevice, systemClock, type PdfClock } from 'reportman-pdf';
import { NoDataToPrintException, prepareReport, RpDateTime, type DataHost, type EvalHost } from 'reportman-engine';
import type { ConnectionFactory } from 'reportman-node';
import { reportmanAgent, type ReportmanAgentOptions } from 'reportman-driver-http';
import { metaFileJson } from '../../reportman-engine/test/golden-run.js';
import { connectionsIni } from './connections.ts';
import { MockHub, type HubRequest } from './hub.ts';
import { CONFIG_FILE } from './reports.ts';

export const here = path.dirname(fileURLToPath(import.meta.url));
export const runFixtures = path.join(here, 'fixtures/run');
export const reportsDir = path.join(here, 'fixtures/reports');

export interface ReportCase {
  name: string;
  report: string;
  params?: Record<string, string>;
  culture?: string;
  /** The answer depends on the time zone of the computer (a DateTime with an offset is local time). */
  zone?: boolean;
  /** Waits for the 100 s timeout of HttpClient. */
  slow?: boolean;
  /** false: the values of its parameters are not of their types (golden-cs assigns their text; openReport types them). */
  typed?: boolean;
}

export function cases(): ReportCase[] {
  return (JSON.parse(fs.readFileSync(path.join(here, 'cases.json'), 'utf8')) as { reports: ReportCase[] }).reports;
}

/** Whether this computer is in the time zone the fixtures were made in. */
export function sameZone(): boolean {
  const zone = (JSON.parse(fs.readFileSync(path.join(here, 'fixtures/zone.json'), 'utf8')) as { timeZone: string }).timeZone;
  return Intl.DateTimeFormat().resolvedOptions().timeZone === zone;
}

/** An address nobody listens on. */
export async function refusedUrl(): Promise<string> {
  const server = net.createServer();
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => resolve()));
  const port = (server.address() as net.AddressInfo).port;
  await new Promise<void>((resolve) => server.close(() => resolve()));
  return 'http://127.0.0.1:' + port;
}

/** The report connections of the tests (the sections of connections.ts and one that is not there). */
export const ALIASES = [
  'SAMPLES', 'AGENT', 'MAPPED', 'PRIVATE_KEY', 'PRIVATE_NOKEY', 'PRIVATE_BADKEY', 'PRIVATE_TOKEN', 'NOID', 'BADID', 'ZEROID',
  'UNKNOWNDB', 'REFUSED', 'TRAILING', 'BASEURLKEY', 'MISSING',
];

/** The connections of a run: every alias through the driver, reading the connections file of the run. */
export function agentConnections(ini: string, options: ReportmanAgentOptions = {}): Record<string, ConnectionFactory> {
  const factory = reportmanAgent({
    ...options,
    connectionsFile: (configFile) => (configFile === CONFIG_FILE ? ini : undefined),
  });
  return Object.fromEntries(ALIASES.map((a) => [a, factory]));
}

/** The mock Hub and the connections file that points at it. */
export async function startHub(): Promise<{ hub: MockHub; ini: string }> {
  const hub = await MockHub.start();
  return { hub, ini: connectionsIni(hub.url, await refusedUrl()) };
}

/** The requests of api/agent/execute in a list of requests (the ones both engines send). */
export function executeRequests(requests: readonly HubRequest[]): HubRequest[] {
  return requests.filter((r) => r.path === '/api/agent/execute');
}

// ---------------------------------------------------------------------------------------------

export interface PrintResult {
  meta: MetaFile;
  /** The PDF, or undefined when the report had nothing to print (the C# printer writes none). */
  pdf: Uint8Array | undefined;
}

/**
 * Runs a report and prints it to PDF as golden-cs does (PrintOutPDF.Print: the device asks for the pages
 * one by one and draws each one as soon as it exists), with the parameter values assigned as text and the
 * clock of the C# PDF. The run is closed at the end (its connections close).
 */
export async function printLikeGolden(
  reportFile: string,
  data: DataHost,
  options: { params?: Record<string, string>; culture?: string; clock?: PdfClock; now?: RpDateTime } = {},
): Promise<PrintResult> {
  const model = readReportXml(new Uint8Array(fs.readFileSync(reportFile)));
  const now = options.now;
  const evalHost: EvalHost = { now: () => now ?? RpDateTime.fromJsDate(new Date()), fileExists: () => false };
  const device = new PdfDevice({ clock: options.clock ?? systemClock });
  device.compressed = false;
  const run = await prepareReport(model, { device, data, culture: options.culture ?? 'en-US', host: evalHost });
  try {
    for (const [k, v] of Object.entries(options.params ?? {})) run.setParameterValue(k, v);
    const meta = run.metaFile;
    try {
      await run.begin();
    } catch (e) {
      if (e instanceof NoDataToPrintException) return { meta, pdf: undefined };
      throw e;
    }
    device.preparePrint(meta);
    let current = device.fromPage - 1;
    await run.requestPage(current);
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
    return { meta, pdf: device.pdfBytes };
  } finally {
    await run.close();
  }
}


/** The metafile of a run against the JSON golden-cs wrote. */
export function expectSameMetafile(meta: MetaFile, csJson: { pages: { objects: unknown[] }[] } & Record<string, unknown>): void {
  const ts = metaFileJson(meta) as typeof csJson;
  const { pages: tsPages, ...tsHead } = ts;
  const { pages: csPages, ...csHead } = csJson;
  expect(tsHead).toEqual(csHead);
  expect(tsPages.length).toBe(csPages.length);
  for (let i = 0; i < csPages.length; i++) {
    const { objects: tsObjects, ...tsPage } = tsPages[i]! as { objects: unknown[] };
    const { objects: csObjects, ...csPage } = csPages[i]! as { objects: unknown[] };
    expect(tsPage, `page ${i + 1}`).toEqual(csPage);
    const n = Math.max(tsObjects.length, csObjects.length);
    for (let j = 0; j < n; j++) expect(tsObjects[j], `page ${i + 1} object ${j}`).toEqual(csObjects[j]);
  }
}

/** The .NET type and the message of an error. */
export function errorOf(p: Promise<unknown>): Promise<{ type: string; message: string } | null> {
  return p.then(
    () => null,
    (e: unknown) => ({ type: (e as { netType?: string }).netType ?? (e as Error).name, message: (e as Error).message }),
  );
}
