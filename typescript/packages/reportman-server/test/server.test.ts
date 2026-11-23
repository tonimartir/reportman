// The reports API of Reportman.Server served by @reportman/server over node:http: the routes, the
// formats, the parameters (query, JSON body, form), the API keys and the error codes.

import http from 'node:http';
import type { AddressInfo } from 'node:net';
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { sqlite } from '@reportman/node';
import { decodeCp437 } from '@reportman/export';
import { createReportServer, fastifyPlugin, nodeHandler, type ReportServerOptions } from '@reportman/server';

const here = path.dirname(fileURLToPath(import.meta.url));
const samples = path.resolve(here, '../../../../samples');
// The clock of the text fixture of PrintOutText (reportman-export/test/fixtures/text, contacts)
const textCases = JSON.parse(fs.readFileSync(path.join(here, '../../reportman-export/test/fixtures/text/cases.json'), 'utf8')) as {
  name: string;
  clock: string;
}[];
const textClock = new Date(textCases.find((c) => c.name === 'contacts')!.clock + 'Z');
const base: ReportServerOptions = {
  aliases: { SAMPLES: samples, Other: samples },
  connections: { SAMPLES: sqlite(path.join(samples, 'samples.db')) },
  // The standard 14 fonts: the same layout on a machine without TrueType fonts (the CI images)
  fonts: false,
  clock: { now: () => textClock, offsetMinutes: () => 0 },
};

async function listen(options: ReportServerOptions): Promise<{ url: string; close: () => Promise<void> }> {
  const server = http.createServer(nodeHandler(createReportServer(options)));
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as AddressInfo;
  return { url: `http://127.0.0.1:${port}`, close: () => new Promise((resolve) => server.close(() => resolve())) };
}

let open: { url: string; close: () => Promise<void> };
let keyed: { url: string; close: () => Promise<void> };
beforeAll(async () => {
  open = await listen(base);
  keyed = await listen({
    ...base,
    apiKeys: [
      { key: 'k-samples', aliases: ['SAMPLES'] },
      { key: 'k-other', aliases: ['other'] },
    ],
  });
});
afterAll(async () => {
  await open.close();
  await keyed.close();
});

const get = (url: string, headers: Record<string, string> = {}) => fetch(url, { headers });
const bytes = async (r: Response) => new Uint8Array(await r.arrayBuffer());

describe('@reportman/server: listing', () => {
  it('answers the health check and lists the aliases', async () => {
    const health = await (await get(open.url + '/api/health')).json();
    expect(health).toMatchObject({ status: 'ok', aliases: ['Other', 'SAMPLES'] });
    expect(await (await get(open.url + '/api/reports/aliases')).json()).toEqual(['Other', 'SAMPLES']);
  });

  it('gives the tree of an alias: the reports in name order, without the hidden folders', async () => {
    const tree = await (await get(open.url + '/api/reports/SAMPLES/tree')).json();
    expect(tree).toMatchObject({ name: '', path: '' });
    const names = (tree.reports as { name: string; path: string }[]).map((r) => r.name);
    expect(names).toContain('customers');
    expect(names).toEqual([...names].sort((a, b) => a.toUpperCase().localeCompare(b.toUpperCase())));
    expect((tree.reports as { path: string }[]).find((r) => r.path === 'customers.rep')).toBeDefined();
  });

  it('gives the parameters in the shape of Reportman.Server, and their description (step 1)', async () => {
    const params = (await (await get(open.url + '/api/reports/SAMPLES/parameters?path=invoices.rep')).json()) as { name: string; type: string }[];
    expect(params.map((p) => p.name)).toEqual(expect.arrayContaining(['FIRST_ORDER', 'LAST_ORDER']));
    expect(Object.keys(params[0]!).sort()).toEqual(['allowNulls', 'description', 'hint', 'name', 'type', 'value', 'visible']);
    const described = (await (await get(open.url + '/api/reports/SAMPLES/parameters/describe?path=invoices')).json()) as { name: string; typeName: string }[];
    expect(described.map((p) => p.name)).toEqual(expect.arrayContaining(['FIRST_ORDER', 'LAST_ORDER']));
  });
});

describe('@reportman/server: execute', () => {
  it('runs a report to PDF, inline, or as a download', async () => {
    const r = await get(open.url + '/api/reports/SAMPLES/execute?path=customers.rep');
    expect(r.status).toBe(200);
    expect(r.headers.get('content-type')).toBe('application/pdf');
    expect(r.headers.get('content-disposition')).toBe('inline; filename="customers.pdf"');
    expect(new TextDecoder('latin1').decode((await bytes(r)).subarray(0, 5))).toBe('%PDF-');
    const d = await get(open.url + '/api/reports/SAMPLES/execute?path=customers&download=1');
    expect(d.headers.get('content-disposition')).toBe('attachment; filename="customers.pdf"');
  });

  it('runs a report to a compressed metafile and to CSV (semicolons, with BOM)', async () => {
    const m = await get(open.url + '/api/reports/SAMPLES/execute?path=customers.rep&format=metafile');
    expect(m.headers.get('content-type')).toBe('application/x-reportman-metafile');
    expect(new TextDecoder('latin1').decode(zlib.inflateSync(await bytes(m)).subarray(0, 10))).toBe('RPMETAFILE');
    const c = await get(open.url + '/api/reports/SAMPLES/execute?path=customers.rep&format=csv');
    expect(c.headers.get('content-type')).toBe('text/csv; charset=utf-8');
    const csv = await bytes(c);
    expect([...csv.subarray(0, 3)]).toEqual([0xef, 0xbb, 0xbf]);
    expect(new TextDecoder().decode(csv.subarray(3))).toMatch(/^"[^"]*";/);
  });

  it('runs a report to the PLAIN text of PrintOutText, read in code page 437 and sent in UTF-8', async () => {
    const t = await get(open.url + '/api/reports/SAMPLES/execute?path=contacts.rep&format=text');
    expect(t.status).toBe(200);
    expect(t.headers.get('content-type')).toBe('text/plain; charset=utf-8');
    expect(t.headers.get('content-disposition')).toBe('inline; filename="contacts.txt"');
    // The bytes golden-cs wrote with PrintOutText (PLAIN, the same clock), as Reportman.Server answers them
    const printed = new Uint8Array(fs.readFileSync(path.join(here, '../../reportman-export/test/fixtures/text/contacts.txt')));
    expect(await t.text()).toBe(decodeCp437(printed));
  });

  it('takes the parameters from the query, a JSON body or a form, the same values giving the same result', async () => {
    const all = await (await get(open.url + '/api/reports/SAMPLES/execute?path=invoices.rep&format=csv')).text();
    const query = await (await get(open.url + '/api/reports/SAMPLES/execute?path=invoices.rep&format=csv&FIRST_ORDER=7&LAST_ORDER=9')).text();
    expect(query.length).toBeLessThan(all.length);
    const body = await (
      await fetch(open.url + '/api/reports/SAMPLES/execute?path=invoices.rep', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ Parameters: { first_order: 7, LAST_ORDER: '9' }, format: 'csv' }),
      })
    ).text();
    expect(body).toBe(query);
    const form = await (
      await fetch(open.url + '/api/reports/SAMPLES/execute?path=invoices.rep', {
        method: 'POST',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        body: 'FIRST_ORDER=7&LAST_ORDER=9&format=csv',
      })
    ).text();
    expect(form).toBe(query);
  });

  it('gives the error codes of Reportman.Server', async () => {
    const status = async (url: string) => {
      const r = await get(open.url + url);
      return [r.status, ((await r.json()) as { error: string }).error];
    };
    expect(await status('/api/reports/SAMPLES/execute?path=customers.rep&format=xlsx')).toEqual([400, "Unknown format 'xlsx'. Use pdf, metafile, text or csv."]);
    expect(await status('/api/reports/SAMPLES/execute?path=nope.rep')).toEqual([404, "'nope.rep' does not exist."]);
    expect(await status('/api/reports/SAMPLES/execute?path=../samples/customers.rep')).toEqual([400, 'Invalid report path.']);
    expect(await status('/api/reports/SAMPLES/execute')).toEqual([400, 'A report path is required.']);
    expect(await status('/api/reports/NOPE/tree')).toEqual([404, "Alias 'NOPE' is not configured."]);
    const off = await createReportServer({ ...base, text: false }).handle({
      method: 'GET',
      path: '/api/reports/SAMPLES/execute',
      query: new URLSearchParams('path=customers.rep&format=text'),
      headers: {},
    });
    expect([off.status, JSON.parse(new TextDecoder().decode(off.body)).error]).toEqual([501, 'The text format is not supported by this server.']);
  });
});

describe('@reportman/server: API keys', () => {
  it('needs a key, by header or in the query, and runs only the reports of its aliases', async () => {
    expect((await get(keyed.url + '/api/reports/aliases')).status).toBe(401);
    expect((await get(keyed.url + '/api/health')).status).toBe(200);
    expect(await (await get(keyed.url + '/api/reports/aliases', { 'X-ReportmanServer-ApiKey': 'k-other' })).json()).toEqual(['Other']);
    expect((await get(keyed.url + '/api/reports/SAMPLES/tree', { 'X-ReportmanServer-ApiKey': 'k-samples' })).status).toBe(200);
    expect((await get(keyed.url + '/api/reports/SAMPLES/tree?apikey=k-samples')).status).toBe(200);
    expect((await get(keyed.url + '/api/reports/SAMPLES/tree?apikey=k-other')).status).toBe(403);
    expect((await get(keyed.url + '/api/reports/SAMPLES/tree?apikey=wrong')).status).toBe(401);
  });
});

describe('@reportman/server: adapters', () => {
  it('lets Express go on with a path that is not of the API (next)', async () => {
    const handler = nodeHandler(createReportServer(base));
    let nextCalled = false;
    const req = { url: '/app/index.html', method: 'GET', headers: {} } as unknown as http.IncomingMessage;
    handler(req, {} as http.ServerResponse, () => {
      nextCalled = true;
    });
    expect(nextCalled).toBe(true);
  });

  it('registers the routes of a Fastify instance and answers through its reply', async () => {
    const routes = new Map<string, (request: { raw: http.IncomingMessage; body?: unknown }, reply: unknown) => Promise<void> | void>();
    let parserAdded = false;
    const fastify = {
      addContentTypeParser: () => {
        parserAdded = true;
      },
      all: (p: string, h: (request: { raw: http.IncomingMessage; body?: unknown }, reply: unknown) => Promise<void> | void) => routes.set(p, h),
    };
    let done = false;
    fastifyPlugin(createReportServer(base))(fastify, {}, () => {
      done = true;
    });
    expect([done, parserAdded, [...routes.keys()]]).toEqual([true, true, ['/api/health', '/api/reports/*']]);
    const sent: { status?: number; headers: Record<string, string>; body?: Uint8Array } = { headers: {} };
    const reply = {
      code(s: number) {
        sent.status = s;
        return reply;
      },
      header(k: string, v: string) {
        sent.headers[k] = v;
        return reply;
      },
      send(b: Uint8Array) {
        sent.body = b;
      },
    };
    const raw = { url: '/api/reports/aliases', method: 'GET', headers: {}, readableEnded: true } as unknown as http.IncomingMessage;
    await routes.get('/api/reports/*')!({ raw }, reply);
    expect(sent.status).toBe(200);
    expect(JSON.parse(new TextDecoder().decode(sent.body))).toEqual(['Other', 'SAMPLES']);
  });
});
