// The Reportman AI Agent driver against the C# engine (golden-cs, the HttpAgent driver) over the mock Hub:
//
//   - each report of cases.json, run as golden-cs runs it and through openReport with the driver, lays out
//     the metafile golden-cs wrote and gives its PDF bytes (fixtures/run, the C# clock);
//   - the mock Hub receives from the driver the requests of api/agent/execute it received from C#: the
//     same headers (content type, API key, Bearer token, install id) and the same body, byte for byte;
//   - a report that fails in C# fails with the same error;
//   - a report that reads data while an expression is evaluated (GETVALUEFROMSQL), which C# runs, fails
//     here (fetch is asynchronous) after the requests C# sent until then.
//
// The fixtures come from test/generate-fixtures.ts. C# also asks the Hub for a direct channel first
// (api/data-session/start, answered 404 by the mock: it falls back to HTTP); the driver does not.

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createDataHost, openReport } from '@reportman/node';
import { pdfCreation } from '../../reportman-engine/test/golden-run.js';
import type { MockHub, HubRequest } from './hub.ts';
import {
  agentConnections,
  cases,
  errorOf,
  executeRequests,
  expectSameMetafile,
  printLikeGolden,
  reportsDir,
  runFixtures,
  sameZone,
  startHub,
  type ReportCase,
} from './golden.ts';

let hub: MockHub;
let ini: string;

beforeAll(async () => {
  ({ hub, ini } = await startHub());
});

afterAll(async () => {
  await hub.close();
});

const slow = process.env.RM_AGENT_SLOW === '1';
const zoneOk = sameZone();

/** The connections of a case (the culture of the run for the texts of the errors). */
function connectionsFor(c: ReportCase, options: { timeout?: number } = {}) {
  return agentConnections(ini, { culture: c.culture ?? 'en-US', ...options });
}

/**
 * The error of the TypeScript run against the one C# printed. Two texts come from outside the engines: a
 * refused connection is described by the operating system (in its language: the endpoint is compared), and
 * the reason a text is not a date is said by DateTime.Parse of .NET (the engine gives the older text: the
 * part of the DataTable is compared).
 */
function expectSameError(c: ReportCase, mine: { type: string; message: string } | null, cs: { error: string; message: string }): void {
  expect(mine, 'the run fails').not.toBeNull();
  const first = (s: string): string => s.replace(/\r\n/g, '\n').split('\n')[0]!;
  if (c.name === 'agent-conn-refused') {
    expect(mine!.type).toBe(cs.error);
    expect(/ \(127\.0\.0\.1:\d+\)$/.test(mine!.message), mine!.message).toBe(true);
    return;
  }
  if (c.name === 'agent-canned-bad-datetime') {
    expect(mine!.message.substring(mine!.message.indexOf("Couldn't store"))).toBe(cs.message.substring(cs.message.indexOf("Couldn't store")));
    return;
  }
  if (c.slow === true && !slow) {
    // the same request with a timeout of 1 s instead of the 100 s of HttpClient
    expect(mine!.type).toBe(cs.error);
    expect(mine!.message).toBe(cs.message.replace('of 100 seconds', 'of 1 seconds'));
    return;
  }
  expect(first(mine!.message)).toBe(first(cs.message));
  // the engine wraps some errors in a ReportException, as C# does; the others keep their .NET type
  if (cs.error !== 'ReportException') expect(mine!.type).toBe(cs.error);
}

/** Waits (5 s at most) until a condition holds: a request the engine gave up on still reaches the Hub. */
async function until(condition: () => boolean): Promise<void> {
  for (let i = 0; i < 100 && !condition(); i++) await new Promise((resolve) => setTimeout(resolve, 50));
}

function expectSameRequests(mine: readonly HubRequest[], csFile: string): void {
  const cs = executeRequests(JSON.parse(fs.readFileSync(csFile, 'utf8')) as HubRequest[]);
  expect(executeRequests(mine)).toEqual(cs);
}

describe.each(cases())('$name', (c) => {
  const reportFile = path.join(reportsDir, c.report + '.rep');
  const errorFile = path.join(runFixtures, c.name + '.error.json');
  const requestsFile = path.join(runFixtures, c.name + '.requests.json');
  const skip = c.zone === true && !zoneOk;
  const timeout = c.slow === true && !slow ? 1000 : undefined;
  const testTimeout = c.slow === true && slow ? 130000 : 30000;

  if (c.knownDifference !== undefined) {
    const known = c.knownDifference;
    it.skipIf(skip)(`C# runs it; the TypeScript engine fails (${known.tsError}), after the same requests`, async () => {
      expect(fs.existsSync(path.join(runFixtures, c.name + '.meta.json'))).toBe(true);
      hub.clear();
      const data = createDataHost({ connections: connectionsFor(c) });
      const error = await errorOf(printLikeGolden(reportFile, data, { params: c.params, culture: c.culture }));
      expect(error?.message).toContain(known.tsError);
      const cs = executeRequests(JSON.parse(fs.readFileSync(requestsFile, 'utf8')) as HubRequest[]);
      await until(() => executeRequests(hub.requests).length >= known.requests);
      expect(executeRequests(hub.requests)).toEqual(cs.slice(0, known.requests));
    });
    return;
  }

  if (fs.existsSync(errorFile)) {
    const cs = JSON.parse(fs.readFileSync(errorFile, 'utf8')) as { error: string; message: string };

    it.skipIf(skip)('fails as C# does, after the same requests', async () => {
      hub.clear();
      const data = createDataHost({ connections: connectionsFor(c, { timeout }) });
      expectSameError(c, await errorOf(printLikeGolden(reportFile, data, { params: c.params, culture: c.culture })), cs);
      expectSameRequests(hub.requests, requestsFile);
    }, testTimeout);

    it.skipIf(skip)('fails as C# does through openReport', async () => {
      const report = await openReport(reportFile, { connections: connectionsFor(c, { timeout }), culture: c.culture });
      expectSameError(c, await errorOf(report.executeToPdf(c.params ?? {}, { compressed: false })), cs);
    }, testTimeout);
    return;
  }

  const csMeta = (): { pages: { objects: unknown[] }[] } & Record<string, unknown> =>
    JSON.parse(fs.readFileSync(path.join(runFixtures, c.name + '.meta.json'), 'utf8')) as { pages: { objects: unknown[] }[] } & Record<string, unknown>;
  const pdfFile = path.join(runFixtures, c.name + '.cs.pdf');
  // A report without data: C# lays out no page and its printer writes no PDF
  const csPdf = fs.existsSync(pdfFile) ? new Uint8Array(fs.readFileSync(pdfFile)) : undefined;
  const samePdf = (pdf: Uint8Array, tag: string): void => {
    if (Buffer.compare(Buffer.from(pdf), Buffer.from(csPdf!)) !== 0) fs.writeFileSync(path.join(os.tmpdir(), `rm-agent-${c.name}.${tag}.pdf`), pdf);
    expect(Buffer.compare(Buffer.from(pdf), Buffer.from(csPdf!))).toBe(0);
  };

  it.skipIf(skip)('lays out the same metafile and PDF as golden-cs, after the same requests', async () => {
    const created = csPdf === undefined ? undefined : pdfCreation(csPdf);
    hub.clear();
    const data = createDataHost({ connections: connectionsFor(c) });
    const { meta, pdf } = await printLikeGolden(reportFile, data, { params: c.params, culture: c.culture, clock: created?.clock, now: created?.now });
    expectSameMetafile(meta, csMeta());
    if (csPdf === undefined) expect(pdf).toBeUndefined();
    else samePdf(pdf!, 'ts');
    expectSameRequests(hub.requests, requestsFile);
  });

  // openReport types the values of the parameters (ReportParameters.Apply) where golden-cs assigns their
  // text: a case whose values are not of the type of their parameters runs only as golden-cs runs it
  it.skipIf(skip || c.typed === false)('gives the same metafile and PDF bytes through openReport', async () => {
    const clock = csPdf === undefined ? undefined : pdfCreation(csPdf).clock;
    const options = { connections: connectionsFor(c), clock, culture: c.culture };
    const params = c.params ?? {};
    hub.clear();
    const metaReport = await openReport(reportFile, options);
    if (csPdf === undefined) {
      const error = await errorOf(metaReport.executeToMetafile(params));
      expect(error?.type).toBe('NoDataToPrintException');
      return;
    }
    expectSameMetafile(await metaReport.executeToMetafile(params), csMeta());
    const report = await openReport(reportFile, options);
    samePdf(await report.executeToPdf(params, { compressed: false }), 'open');
    if (c.params === undefined) {
      // two runs, each one with the requests of C#
      const cs = executeRequests(JSON.parse(fs.readFileSync(requestsFile, 'utf8')) as HubRequest[]);
      expect(executeRequests(hub.requests)).toEqual([...cs, ...cs]);
    }
  });
});
