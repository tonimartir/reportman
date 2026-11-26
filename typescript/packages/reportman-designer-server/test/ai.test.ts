// The designer's AI through the server (Reportman.Designer.Server.Ai of Reportman.Server): the bridge
// to the Reportman AI cloud (only its routes, as this installation, the page's AI session as the
// Bearer, the answer streamed as it arrives and stopped with the page), the AI's login relay, the
// session config the element asks for its installation, and the copilot's operations of the designer
// protocol (ToXml, FromXml, SqlColumns with its SQL guard, AiContext). The cloud is a fake fetch.

import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import type { ServerRequest } from '@reportman/server';
import {
  createDesignerServer,
  dataFolderInstallId,
  nodeHandler,
  whyNotARead,
  type DesignerAiCall,
  type DesignerServer,
  type DesignerServerOptions,
} from '@reportman/designer-server';

const clock = { now: () => new Date('2026-11-26T12:00:00Z'), offsetMinutes: () => 0 };
const folders: string[] = [];
const INSTALL = 'repman-server-0123456789abcdef';

afterAll(() => {
  for (const f of folders) fs.rmSync(f, { recursive: true, force: true });
});

/** A call the fake cloud received. */
interface CloudCall {
  url: string;
  method: string;
  headers: Headers;
  body: string;
  signal: AbortSignal | undefined;
}

/** A fake cloud: records the calls and answers with what the test says. */
function fakeCloud(answer: (call: CloudCall) => Response | Promise<Response>): { fetch: typeof fetch; calls: CloudCall[] } {
  const calls: CloudCall[] = [];
  const fake = async function (this: unknown, input: RequestInfo | URL, init?: RequestInit) {
    // As a browser's fetch: called with another this (fetch kept as a method), Illegal invocation
    if (this !== undefined && this !== globalThis) throw new TypeError("Failed to execute 'fetch' on 'Window': Illegal invocation");
    const body = init?.body === undefined || init.body === null ? '' : new TextDecoder().decode(new Uint8Array(init.body as ArrayBuffer));
    const call: CloudCall = { url: String(input), method: init?.method ?? 'GET', headers: new Headers(init?.headers), body, signal: init?.signal ?? undefined };
    calls.push(call);
    return answer(call);
  } as typeof fetch;
  return { fetch: fake, calls };
}

async function designerWith(options: Partial<DesignerServerOptions> = {}): Promise<{ designer: DesignerServer; data: string }> {
  const data = fs.mkdtempSync(path.join(os.tmpdir(), 'rm-designer-ai-'));
  folders.push(data);
  const designer = createDesignerServer({ dataPath: data, trusted: true, fonts: false, clock, ...options });
  const installed = await designer.reports.handle({ method: 'POST', path: '/api/console/samples', query: new URLSearchParams(), headers: {} });
  expect(installed.status).toBe(200);
  return { designer, data };
}

function request(method: string, route: string, body?: unknown, headers: Record<string, string> = {}, signal?: AbortSignal): ServerRequest {
  const q = route.indexOf('?');
  return {
    method,
    path: q < 0 ? route : route.substring(0, q),
    query: new URLSearchParams(q < 0 ? '' : route.substring(q + 1)),
    headers: { ...(body === undefined ? {} : { 'content-type': 'application/json' }), ...headers },
    body: body === undefined ? undefined : new TextEncoder().encode(typeof body === 'string' ? body : JSON.stringify(body)),
    remoteAddress: '127.0.0.1',
    signal,
  };
}

/** The whole body of an answer, its parts read when it streams. */
async function text(reply: { body: Uint8Array; stream?: ReadableStream<Uint8Array> }): Promise<string> {
  if (reply.stream === undefined) return new TextDecoder().decode(reply.body);
  return await new Response(reply.stream).text();
}

const sse = (...frames: string[]) =>
  new ReadableStream<Uint8Array>({
    start(controller) {
      for (const f of frames) controller.enqueue(new TextEncoder().encode(f));
      controller.close();
    },
  });

describe('the AI bridge', () => {
  it('says its installation in the session config, and owns the AI routes only with the ai option', async () => {
    const { designer } = await designerWith({ ai: { installId: INSTALL } });
    const config = await designer.handle(request('GET', '/api/session/config'));
    expect(JSON.parse(await text(config))).toEqual({ apiUrl: 'https://aiapi.reportman.es', aiLoginUrl: '/api/ai-login', aiInstallId: INSTALL });
    expect(designer.owns('/api/ai/ReportDesigner/ModifyReportStream')).toBe(true);
    expect(designer.owns('/api/ai-login/api/login/email')).toBe(true);
    expect(designer.routes()).toEqual(expect.arrayContaining(['/api/ai/*', '/api/ai-login/*', '/api/session/config']));
    const { designer: without } = await designerWith();
    expect(without.owns('/api/ai/ReportDesigner/ModifyReportStream')).toBe(false);
    expect(without.owns('/api/session/config')).toBe(false);
  });

  it('keeps the installation of a data folder in server-id, as Reportman.Server', () => {
    const data = fs.mkdtempSync(path.join(os.tmpdir(), 'rm-designer-id-'));
    folders.push(data);
    const first = dataFolderInstallId(data);
    expect(first).toMatch(/^repman-server-[0-9a-f]{32}$/);
    expect(fs.readFileSync(path.join(data, 'server-id'), 'utf8')).toBe('rpsrv-' + first.substring('repman-server-'.length));
    expect(dataFolderInstallId(data)).toBe(first);
    // The id a Reportman.Server wrote there is taken as it is
    fs.writeFileSync(path.join(data, 'server-id'), 'rpsrv-feedface');
    expect(dataFolderInstallId(data)).toBe('repman-server-feedface');
    expect(() => createDesignerServer({ aliases: { R: data }, fonts: false, ai: true })).toThrow(/needs an installId/);
    expect(() => createDesignerServer({ aliases: { R: data }, fonts: false, ai: { installId: 'other-1' } })).toThrow(/repman- or web-/);
  });

  it('passes only the routes of the designer, with their method, before asking who calls', async () => {
    const cloud = fakeCloud(() => new Response('{}', { headers: { 'content-type': 'application/json' } }));
    let designerAsked = 0;
    const { designer } = await designerWith({
      ai: { installId: INSTALL, fetch: cloud.fetch },
      authorize: (check) => {
        if (check.action === 'designer') designerAsked++;
        return false;
      },
    });
    for (const [method, route] of [
      ['POST', 'api/schema/save'],
      ['GET', 'ReportDesigner/ModifyReportStream'],
      ['POST', 'api/schema/12x'],
      ['GET', 'api/schema/1234567890123456789'],
      ['POST', 'api/login/email'],
    ] as const) {
      const reply = await designer.handle(request(method, '/api/ai/' + route, method === 'POST' ? {} : undefined));
      expect(reply.status, route).toBe(404);
      expect(JSON.parse(await text(reply)).code).toBe('NotBridged');
    }
    expect(designerAsked).toBe(0);
    const refused = await designer.handle(request('POST', '/api/ai/ReportDesigner/ModifyReportStream', {}));
    expect(refused.status).toBe(403);
    expect(JSON.parse(await text(refused))).toEqual({ error: 'The AI of the designer is for the users who design reports.', code: 'NotDesigner' });
    const login = await designer.handle(request('POST', '/api/ai-login/api/login/email', {}));
    expect(login.status).toBe(403);
    expect(cloud.calls).toHaveLength(0);
  });

  it('sends the call on as the installation, with the page AI session as the Bearer, and streams the answer', async () => {
    const cloud = fakeCloud(() => new Response(sse('data: {"actor":"a","stage":"s"}\n\n', 'data: {"result":"ok"}\n\n', 'data: [DONE]\n\n'), { headers: { 'content-type': 'text/event-stream; charset=utf-8' } }));
    const audit: DesignerAiCall[] = [];
    const { designer } = await designerWith({ ai: { installId: INSTALL, fetch: cloud.fetch, apiUrl: 'https://cloud.test/', audit: (c) => audit.push(c) } });
    const reply = await designer.handle(
      request('POST', '/api/ai/ReportDesigner/ModifyReportStream?x=1', '{"prompt":"hello"}', {
        'x-reportman-ai-token': ' tok-123 ',
        'accept-language': 'es',
        accept: 'text/event-stream',
        // The page cannot choose the installation
        'x-reportman-webinstallid': 'web-other',
        cookie: 'session=1',
      }),
    );
    expect(reply.status).toBe(200);
    expect(reply.headers).toMatchObject({ 'content-type': 'text/event-stream; charset=utf-8', 'cache-control': 'no-cache', 'x-accel-buffering': 'no' });
    expect(reply.stream).toBeDefined();
    expect(await text(reply)).toBe('data: {"actor":"a","stage":"s"}\n\ndata: {"result":"ok"}\n\ndata: [DONE]\n\n');
    const call = cloud.calls[0]!;
    expect(call.url).toBe('https://cloud.test/ReportDesigner/ModifyReportStream?x=1');
    expect(call.method).toBe('POST');
    expect(call.body).toBe('{"prompt":"hello"}');
    expect(call.headers.get('x-reportman-webinstallid')).toBe(INSTALL);
    expect(call.headers.get('authorization')).toBe('Bearer tok-123');
    expect(call.headers.get('accept-language')).toBe('es');
    expect(call.headers.get('content-type')).toBe('application/json');
    expect(call.headers.get('cookie')).toBeNull();
    expect(audit).toEqual([expect.objectContaining({ route: 'ReportDesigner/ModifyReportStream', paidByAccount: true, status: 200, error: '' })]);
    expect(audit[0]!.bytes).toBe(new TextEncoder().encode('data: {"actor":"a","stage":"s"}\n\ndata: {"result":"ok"}\n\ndata: [DONE]\n\n').length);
  });

  it('goes as the guest of the installation without an AI session, and as the host says when it keeps the identity', async () => {
    const cloud = fakeCloud(() => new Response('{"profile":{}}', { headers: { 'content-type': 'application/json' } }));
    const audit: DesignerAiCall[] = [];
    const { designer } = await designerWith({
      ai: {
        installId: INSTALL,
        fetch: cloud.fetch,
        audit: (c) => audit.push(c),
        credentials: (r) => (r.headers['x-user'] === 'ana' ? { installId: 'web-fiscal-1', token: 'ana-token', headers: { 'X-Reportman-Product': 'fiscal', 'Accept-Language': 'ca' } } : null),
      },
    });
    await text(await designer.handle(request('POST', '/api/ai/api/userprofile/status', {})));
    expect(cloud.calls[0]!.headers.get('authorization')).toBeNull();
    expect(cloud.calls[0]!.headers.get('x-reportman-webinstallid')).toBe(INSTALL);
    await text(await designer.handle(request('POST', '/api/ai/api/aireport', {}, { 'x-user': 'ana', 'accept-language': 'es' })));
    const hosted = cloud.calls[1]!;
    expect(hosted.headers.get('authorization')).toBe('Bearer ana-token');
    expect(hosted.headers.get('x-reportman-webinstallid')).toBe('web-fiscal-1');
    expect(hosted.headers.get('x-reportman-product')).toBe('fiscal');
    // The host's headers go after the page's
    expect(hosted.headers.get('accept-language')).toBe('ca');
    // The status the page asks on every page is not audited
    expect(audit.map((c) => c.route)).toEqual(['api/aireport']);
  });

  it('answers the account status the host knows instead of the cloud', async () => {
    const cloud = fakeCloud(() => new Response('{}'));
    const { designer } = await designerWith({ ai: { installId: INSTALL, fetch: cloud.fetch, accountStatus: () => ({ profile: { email: 'a@b.c', tierName: 'Pro' } }) } });
    const reply = await designer.handle(request('POST', '/api/ai/api/userprofile/status', {}));
    expect(JSON.parse(await text(reply))).toEqual({ profile: { email: 'a@b.c', tierName: 'Pro' } });
    expect(cloud.calls).toHaveLength(0);
  });

  it('reads one schema of the library by its number, with GET', async () => {
    const cloud = fakeCloud(() => new Response('{"id":42}', { headers: { 'content-type': 'application/json' } }));
    const { designer } = await designerWith({ ai: { installId: INSTALL, fetch: cloud.fetch } });
    const reply = await designer.handle(request('GET', '/api/ai/api/schema/42'));
    expect(await text(reply)).toBe('{"id":42}');
    expect(cloud.calls[0]!.url).toBe('https://aiapi.reportman.es/api/schema/42');
    expect(cloud.calls[0]!.body).toBe('');
  });

  it('says when the cloud cannot be reached or does not answer in time', async () => {
    const down = fakeCloud(() => {
      throw new TypeError('fetch failed');
    });
    const { designer } = await designerWith({ ai: { installId: INSTALL, fetch: down.fetch } });
    const unreachable = await designer.handle(request('POST', '/api/ai/api/aireport', {}));
    expect(unreachable.status).toBe(502);
    expect(JSON.parse(await text(unreachable))).toEqual({ error: 'Could not reach the Reportman AI cloud: fetch failed', code: 'CloudUnreachable' });

    const silent = fakeCloud(
      (call) =>
        new Promise<Response>((_resolve, reject) => {
          call.signal?.addEventListener('abort', () => reject(call.signal!.reason));
        }),
    );
    const audit: DesignerAiCall[] = [];
    const { designer: slow } = await designerWith({ ai: { installId: INSTALL, fetch: silent.fetch, headersTimeoutSeconds: 0.05, audit: (c) => audit.push(c) } });
    const late = await slow.handle(request('POST', '/api/ai/api/aireport', {}));
    expect(late.status).toBe(504);
    expect(JSON.parse(await text(late)).code).toBe('CloudTimeout');
    expect(audit[0]).toMatchObject({ status: 504, error: 'timeout waiting for the cloud' });
  });

  it('ends an answer the cloud stops sending with an error frame', async () => {
    const stalled = fakeCloud(
      () =>
        new Response(
          new ReadableStream<Uint8Array>({
            start(controller) {
              controller.enqueue(new TextEncoder().encode('data: {"actor":"a","stage":"s"}\n\ndata: {"par'));
            },
          }),
          { headers: { 'content-type': 'text/event-stream' } },
        ),
    );
    const audit: DesignerAiCall[] = [];
    const { designer } = await designerWith({ ai: { installId: INSTALL, fetch: stalled.fetch, idleTimeoutSeconds: 0.05, audit: (c) => audit.push(c) } });
    const body = await text(await designer.handle(request('POST', '/api/ai/ReportDesigner/ModifyReportStream', {})));
    expect(body).toBe(
      'data: {"actor":"a","stage":"s"}\n\ndata: {"par\n\ndata: {"errorMessage":"The Reportman AI cloud stopped answering.","errorCode":"CloudTimeout"}\n\ndata: [DONE]\n\n',
    );
    expect(audit[0]!.error).toBe('timeout: no data from the cloud for 0.05 s');
    expect(stalled.calls[0]!.signal!.aborted).toBe(true);

    const cut = fakeCloud(
      () =>
        new Response(
          new ReadableStream<Uint8Array>({
            start(controller) {
              controller.enqueue(new TextEncoder().encode('data: 1\n\n'));
              // Cut after the first part went (an error at once would drop what is queued)
              setTimeout(() => controller.error(new Error('socket hang up')), 30);
            },
          }),
          { headers: { 'content-type': 'text/event-stream' } },
        ),
    );
    const { designer: other } = await designerWith({ ai: { installId: INSTALL, fetch: cut.fetch } });
    expect(await text(await other.handle(request('POST', '/api/ai/NlToSql/TranslateToSQLStream', {})))).toBe(
      'data: 1\n\n\n\ndata: {"errorMessage":"The connection with the Reportman AI cloud was lost.","errorCode":"CloudConnectionLost"}\n\ndata: [DONE]\n\n',
    );
  });

  it('stops the call to the cloud when the page goes away, through nodeHandler', async () => {
    let upstream: AbortSignal | undefined;
    let sent = 0;
    const cloud = fakeCloud((call) => {
      upstream = call.signal;
      let timer: ReturnType<typeof setInterval> | undefined;
      return new Response(
        new ReadableStream<Uint8Array>({
          start(controller) {
            timer = setInterval(() => controller.enqueue(new TextEncoder().encode('data: ' + sent++ + '\n\n')), 20);
          },
          cancel() {
            clearInterval(timer);
          },
        }),
        { headers: { 'content-type': 'text/event-stream' } },
      );
    });
    const audit: DesignerAiCall[] = [];
    const { designer } = await designerWith({ ai: { installId: INSTALL, fetch: cloud.fetch, audit: (c) => audit.push(c) } });
    const server = http.createServer(nodeHandler(designer));
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    try {
      const port = (server.address() as { port: number }).port;
      const page = new AbortController();
      const reply = await fetch(`http://127.0.0.1:${port}/api/ai/ReportDesigner/ModifyReportStream`, { method: 'POST', body: '{}', headers: { 'content-type': 'application/json' }, signal: page.signal });
      expect(reply.headers.get('content-type')).toBe('text/event-stream');
      expect(reply.headers.get('content-length')).toBeNull();
      // The parts arrive as the cloud sends them, before the answer ends
      const reader = reply.body!.getReader();
      const first = await reader.read();
      expect(new TextDecoder().decode(first.value)).toMatch(/^data: \d+/);
      page.abort();
      await reader.cancel().catch(() => undefined);
      for (let i = 0; i < 50 && !upstream?.aborted; i++) await new Promise((r) => setTimeout(r, 20));
      expect(upstream?.aborted).toBe(true);
      for (let i = 0; i < 50 && audit.length === 0; i++) await new Promise((r) => setTimeout(r, 20));
      expect(audit[0]).toMatchObject({ status: 499, error: 'stopped by the user' });
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });
});

describe("the AI's login relay", () => {
  it('relays only the login routes, with the page installation and language, not its cookies', async () => {
    const cloud = fakeCloud(() => new Response('{"sent":true}', { headers: { 'content-type': 'application/json' } }));
    const { designer } = await designerWith({ ai: { installId: INSTALL, fetch: cloud.fetch } });
    const reply = await designer.handle(request('POST', '/api/ai-login/api/LoginResend/send', '{"email":"a@b.c"}', { 'x-reportman-webinstallid': 'web-page', 'accept-language': 'es', cookie: 'x=1' }));
    expect(reply.status).toBe(200);
    expect(await text(reply)).toBe('{"sent":true}');
    const call = cloud.calls[0]!;
    expect(call.url).toBe('https://aiapi.reportman.es/api/LoginResend/send');
    expect(call.headers.get('x-reportman-webinstallid')).toBe('web-page');
    expect(call.headers.get('accept-language')).toBe('es');
    expect(call.headers.get('cookie')).toBeNull();
    const other = await designer.handle(request('POST', '/api/ai-login/api/login/token', {}));
    expect(other.status).toBe(404);
    expect(JSON.parse(await text(other)).code).toBe('NotRelayed');
    expect(cloud.calls).toHaveLength(1);
  });

  it('gives back the redirect of a provider login for the popup to follow', async () => {
    const cloud = fakeCloud(() => new Response(null, { status: 302, headers: { location: 'https://accounts.google.com/o/oauth2?x=1' } }));
    const { designer } = await designerWith({ ai: { installId: INSTALL, fetch: cloud.fetch } });
    const reply = await designer.handle(request('GET', '/api/ai-login/api/login/google/web?returnUrl=%2Fcb&installId=' + INSTALL));
    expect(reply.status).toBe(302);
    expect(reply.headers.location).toBe('https://accounts.google.com/o/oauth2?x=1');
    expect(cloud.calls[0]!.url).toBe('https://aiapi.reportman.es/api/login/google/web?returnUrl=%2Fcb&installId=' + INSTALL);
  });

  it('sends the popup to the cloud itself when the runtime hides the redirect (a browser fetch)', async () => {
    const opaque = Object.defineProperty(new Response(null, { status: 200 }), 'type', { value: 'opaqueredirect' });
    const cloud = fakeCloud(() => opaque);
    const { designer } = await designerWith({ ai: { installId: INSTALL, fetch: cloud.fetch } });
    const reply = await designer.handle(request('GET', '/api/ai-login/api/login/microsoft/web?returnUrl=x'));
    expect(reply.status).toBe(302);
    expect(reply.headers.location).toBe('https://aiapi.reportman.es/api/login/microsoft/web?returnUrl=x');
  });
});

describe("the copilot's operations", () => {
  const read = async (designer: DesignerServer, name: string) => {
    const reply = await designer.handle(request('POST', '/api/designer/ReadReport', { operation: 0, reportName: 'INFORMES/Ejemplos/' + name + '.rep' }));
    return JSON.parse(new TextDecoder().decode(reply.body)).report as Record<string, unknown>;
  };
  const json = async (designer: DesignerServer, route: string, body: unknown) => {
    const reply = await designer.handle(request('POST', '/api/designer/' + route, body));
    return { status: reply.status, json: JSON.parse(await text(reply)) as Record<string, any> };
  };

  it('turns the document into .rep XML and back (ToXml, FromXml)', async () => {
    const { designer } = await designerWith();
    const report = await read(designer, 'invoices');
    const xml = await json(designer, 'ToXml', { reportJson: JSON.stringify(report) });
    expect(xml.status).toBe(200);
    expect(xml.json.xml).toMatch(/<REPORT|<\?xml/);
    expect(xml.json.xml).toContain('ORDERS');
    const back = await json(designer, 'FromXml', { xml: xml.json.xml });
    expect(back.status).toBe(200);
    expect(back.json.report.dataInfo.map((d: { alias: string }) => d.alias)).toEqual((report.dataInfo as { alias: string }[]).map((d) => d.alias));
    expect((await json(designer, 'ToXml', {})).json).toEqual({ error: 'No report was provided' });
    expect((await json(designer, 'FromXml', { xml: ' ' })).status).toBe(400);
    const bad = await json(designer, 'FromXml', { xml: 'not xml' });
    expect(bad.status).toBe(400);
    expect(typeof bad.json.error).toBe('string');
  });

  it('builds the live context: functions, constants, parameters and the columns of every dataset (AiContext)', async () => {
    const { designer } = await designerWith();
    const report = await read(designer, 'invoices');
    const { status, json: context } = await json(designer, 'AiContext', { reportJson: JSON.stringify(report) });
    expect(status).toBe(200);
    const ec = context.expressionContext;
    expect(ec.functions).toContainEqual({ model: 'function FormatStr(format:string, value:Variant):string', help: '' });
    expect(ec.constants.map((c: { model: string }) => c.model)).toEqual(['TRUE', 'FALSE', 'NULL']);
    expect(ec.memoryVariablesBlock).toMatch(/^\[MEMORY_VARIABLES\]\n(M\.\w+:(string|integer|float|currency|date|time|datetime|boolean)\n)*\[\/MEMORY_VARIABLES\]$/);
    expect(ec.memoryVariablesBlock).toContain('M.FIRST_ORDER:integer');
    expect(context.openErrors).toEqual([]);
    const orders = context.runtimeDataSources.find((d: { name: string }) => d.name === 'INV');
    expect(orders.alias).toBe('SAMPLES');
    expect(orders.runtimeSchema).toMatchObject({ status: 'live_context', source: 'server_live', refreshRequired: false, issues: [] });
    expect(orders.runtimeSchema.datasetColumnsBlock).toMatch(/^\[DATASET_COLUMNS INV columns\]\n/);
    expect(orders.runtimeSchema.datasetColumnsBlock).toMatch(/\nORDER_ID:integer\n/);
    expect(ec.datasetColumnsBlocks).toContain(orders.runtimeSchema.datasetColumnsBlock);
  });

  it('tells a dataset that does not open in the live context', async () => {
    const { designer } = await designerWith();
    const report = await read(designer, 'customers');
    (report.dataInfo as { sql: string }[])[0]!.sql = 'SELECT * FROM NO_SUCH_TABLE';
    const { json: context } = await json(designer, 'AiContext', { report });
    const source = context.runtimeDataSources[0];
    expect(source.runtimeSchema.status).toBe('refresh_failed');
    expect(source.runtimeSchema.refreshRequired).toBe(true);
    expect(source.runtimeSchema.issues[0]).toMatchObject({ severity: 'error', code: 'open_failed' });
    expect(context.openErrors).toHaveLength(1);
    expect(context.openErrors[0]).toMatch(/NO_SUCH_TABLE/i);
  });

  it('gives the columns of the SQL the copilot wrote, run on the connection of its report (SqlColumns)', async () => {
    const { designer } = await designerWith();
    const report = await read(designer, 'invoices');
    const xml = (await json(designer, 'ToXml', { report })).json.xml as string;
    const ok = await json(designer, 'SqlColumns', { xml, databaseAlias: 'samples', sql: 'SELECT CUSTOMER_ID, COMPANY_NAME FROM CUSTOMERS WHERE CUSTOMER_ID = :ID', parameters: [{ name: ':id', value: 3, dbType: 11 }] });
    expect(ok.status).toBe(200);
    expect(ok.json).toEqual({ columns: [{ name: 'CUSTOMER_ID', dataType: 'System.Int64' }, { name: 'COMPANY_NAME', dataType: 'System.String' }] });
    // The report's own parameter feeds it too
    const own = await json(designer, 'SqlColumns', { xml, databaseAlias: 'SAMPLES', sql: 'SELECT ORDER_ID FROM ORDERS WHERE ORDER_ID >= :FIRST_ORDER', parameters: [{ name: 'FIRST_ORDER' }] });
    expect(own.json.columns).toEqual([{ name: 'ORDER_ID', dataType: 'System.Int64' }]);
    // What does not run is an answer too, for the cloud to fix the SQL
    const broken = await json(designer, 'SqlColumns', { xml, databaseAlias: 'SAMPLES', sql: 'SELECT NOPE FROM CUSTOMERS' });
    expect(broken.status).toBe(200);
    expect(broken.json.error).toMatch(/NOPE/i);
    expect((await json(designer, 'SqlColumns', { xml, databaseAlias: 'OTHER', sql: 'SELECT 1' })).json).toEqual({ error: 'The report has no connection OTHER' });
    expect((await json(designer, 'SqlColumns', { xml, sql: 'SELECT 1' })).status).toBe(400);
  });

  it('runs only a single read of the copilot, never committed', async () => {
    const { designer, data } = await designerWith();
    const report = await read(designer, 'customers');
    const xml = (await json(designer, 'ToXml', { report })).json.xml as string;
    for (const sql of ['DELETE FROM CUSTOMERS', 'SELECT 1; DROP TABLE CUSTOMERS', 'UPDATE CUSTOMERS SET NAME = 1', 'SELECT * INTO X FROM CUSTOMERS']) {
      const refused = await json(designer, 'SqlColumns', { xml, databaseAlias: 'SAMPLES', sql });
      expect(refused.json.error, sql).toMatch(/^(Only|A dataset only reads)/);
    }
    // The database is as it was
    const count = await json(designer, 'SqlColumns', { xml, databaseAlias: 'SAMPLES', sql: 'SELECT COUNT(*) AS N FROM CUSTOMERS' });
    expect(count.json.columns).toEqual([{ name: 'N', dataType: 'System.Int64' }]);
    expect(fs.existsSync(path.join(data, 'samples.db')) || fs.readdirSync(data).length > 0).toBe(true);
  });

  it('asks for a designer of reports', async () => {
    const { designer } = await designerWith({ authorize: () => false });
    for (const route of ['ToXml', 'FromXml', 'SqlColumns', 'AiContext']) {
      const reply = await designer.handle(request('POST', '/api/designer/' + route, { reportJson: '{}', xml: '<x/>', databaseAlias: 'A', sql: 'SELECT 1' }));
      expect(reply.status, route).toBe(403);
    }
  });
});

describe('the SQL guard of the copilot (AiSqlGuard)', () => {
  it('lets a single SELECT or WITH through', () => {
    expect(whyNotARead('SELECT * FROM T')).toBeNull();
    expect(whyNotARead('  with x as (select 1) select * from x ;; ')).toBeNull();
    expect(whyNotARead('(SELECT 1) UNION (SELECT 2)')).toBeNull();
    // Words inside strings, quoted names and comments say nothing
    expect(whyNotARead("SELECT 'DELETE; DROP' AS \"INSERT\", [UPDATE] FROM T -- DROP TABLE T\n /* ; DELETE */")).toBeNull();
    expect(whyNotARead("SELECT 'it''s; fine' FROM T")).toBeNull();
  });

  it('refuses anything else, saying why', () => {
    expect(whyNotARead('')).toBe('The SQL is empty.');
    expect(whyNotARead(' ; ')).toBe('The SQL is empty.');
    expect(whyNotARead('SELECT 1; SELECT 2')).toBe("Only one statement can be checked: remove everything after the first ';'.");
    expect(whyNotARead('delete from T')).toBe('Only a query (SELECT or WITH) can be checked, not DELETE.');
    expect(whyNotARead('WITH x AS (DELETE FROM T RETURNING *) SELECT * FROM x')).toBe('A dataset only reads: the query cannot contain DELETE.');
    expect(whyNotARead('SELECT * INTO T2 FROM T')).toBe('A dataset only reads: the query cannot contain INTO.');
    expect(whyNotARead('SELECT dbo.f() FROM T; EXEC x')).toBe("Only one statement can be checked: remove everything after the first ';'.");
  });
});
