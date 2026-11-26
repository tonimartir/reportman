/// <reference lib="webworker" />
// The service worker of the designer of the live demo: the server of the designer, in the browser.
// It takes the requests of the element (api-base designer/api) and answers them with the designer
// protocol of @reportman/designer-server/browser over the demo's backend (backend.ts), the AI of the
// designer included: the copilot's calls go on to the Reportman AI cloud from here, as this browser's
// installation (its guest credits) or the AI account the visitor logs into in the chat. Everything else
// (the page, the element, Monaco, the samples) goes to the network as usual.
import { DesignerOperations, DesignerProtocol, type ServerRequest } from '@reportman/designer-server/browser';
import { DemoSchemaFiles, DemoStore, demoBackend, newReportXml } from './backend.js';
import { AI_CACHE, SAMPLES_ALIAS, aiInstallKey } from './names.js';

declare const self: ServiceWorkerGlobalScope;

// The demo's folder (with the samples, sql.js and the fonts): the parent of this worker's folder
const base = new URL('../', self.location.href).href;
// The routes of the protocol: {designer folder}/api/designer/...
const basePath = new URL('./', self.location.href).pathname.replace(/\/+$/, '');
// The demo's own route: a new report on the samples' database
const newReportPath = (basePath + '/api/demo/NewReport').toLowerCase();

/**
 * The Reportman AI cloud. Fixed when the demo is built, never taken from the page: a link that chose
 * it would send the visitor's AI session to whoever it named.
 */
const AI_API: string = (import.meta as { env?: Record<string, string | undefined> }).env?.VITE_REPORTMAN_AI_API || 'https://aiapi.reportman.es';

const schemaFiles = new DemoSchemaFiles(base);
const protocols = new Map<string, Promise<DesignerProtocol>>();

/**
 * This browser's installation for Reportman AI (web-demo-<random>, kept in the Cache Storage): the
 * guest credits of a visitor who has not logged into the AI.
 */
async function aiInstallId(): Promise<string> {
  const cache = await caches.open(AI_CACHE);
  const key = aiInstallKey(base);
  const kept = await cache.match(key);
  const known = kept === undefined ? '' : (await kept.text()).trim();
  if (/^web-demo-[0-9a-f]{32}$/.test(known)) return known;
  const id = 'web-demo-' + crypto.randomUUID().replace(/-/g, '');
  await cache.put(key, new Response(id, { headers: { 'content-type': 'text/plain' } }));
  return id;
}

/** The protocol of a culture: the engine's texts and the runs follow the language of the page. */
function protocolOf(culture: string): Promise<DesignerProtocol> {
  let protocol = protocols.get(culture);
  if (protocol === undefined) {
    protocol = (async () => {
      const [installId] = await Promise.all([aiInstallId(), schemaFiles.ready()]);
      const operations = new DesignerOperations(demoBackend(base, { culture }, schemaFiles), { culture });
      // Every visitor designs their own copies: nothing to refuse
      return new DesignerProtocol(operations, { authorize: () => true, basePath, ai: { installId, apiUrl: AI_API } });
    })();
    protocol.catch(() => protocols.delete(culture));
    protocols.set(culture, protocol);
  }
  return protocol;
}

/** The routes the protocol answers (the same for every culture), without waiting for one. */
const routes = new DesignerProtocol(new DesignerOperations(demoBackend(base, { culture: 'en-US' }, schemaFiles)), { basePath, ai: { installId: 'web-demo-routes' } });

/** The culture of the page that asks: the Spanish page (indexes.html) runs in es-ES. */
async function cultureOf(event: FetchEvent): Promise<string> {
  const client = event.clientId ? await self.clients.get(event.clientId) : undefined;
  const page = client?.url ?? event.request.referrer ?? '';
  return /indexes\.html/i.test(page) ? 'es-ES' : 'en-US';
}

const json = (status: number, value: unknown): Response =>
  new Response(JSON.stringify(value), { status, headers: { 'content-type': 'application/json; charset=utf-8' } });

/**
 * POST {designer}/api/demo/NewReport { name }: a new report SAMPLES/<name>.rep on the samples'
 * database, empty (the copilot designs it, or the visitor). 409 when the name is taken.
 */
async function newReport(request: Request): Promise<Response> {
  let name = '';
  try {
    name = String(((await request.json()) as { name?: unknown }).name ?? '').trim();
  } catch {
    return json(400, { error: 'The body is not valid JSON.' });
  }
  if (!/^[A-Za-z0-9][A-Za-z0-9 _-]{0,59}$/.test(name)) return json(400, { error: 'A name of letters, digits, spaces, - and _ (up to 60).' });
  const store = new DemoStore(base);
  try {
    await store.open(SAMPLES_ALIAS, name + '.rep');
    return json(409, { error: 'exists' });
  } catch {
    // Not there: it can be made
  }
  try {
    await store.save(SAMPLES_ALIAS, name + '.rep', await newReportXml(store), null);
    return json(200, { reportName: SAMPLES_ALIAS + '/' + name + '.rep' });
  } catch (e) {
    return json(500, { error: e instanceof Error ? e.message : String(e) });
  }
}

async function answer(event: FetchEvent, url: URL): Promise<Response> {
  const request = event.request;
  const method = request.method.toUpperCase();
  const headers: Record<string, string> = {};
  request.headers.forEach((value, name) => (headers[name.toLowerCase()] = value));
  const serverRequest: ServerRequest = {
    method,
    path: decodeURIComponent(url.pathname),
    query: url.searchParams,
    headers,
    body: method === 'GET' || method === 'HEAD' ? undefined : new Uint8Array(await request.arrayBuffer()),
    // The page stops a copilot's answer: the call to the cloud stops with it
    signal: request.signal,
  };
  try {
    const reply = await (await protocolOf(await cultureOf(event))).handle(serverRequest);
    // The start of a provider's login: the popup follows the redirect
    const location = reply.headers['location'];
    if (reply.status >= 300 && reply.status < 400 && location !== undefined) return Response.redirect(location, reply.status);
    // An AI answer streams: its parts reach the page as the cloud sends them
    const body = reply.stream ?? (reply.body.length > 0 || reply.status !== 204 ? (reply.body as Uint8Array<ArrayBuffer>) : null);
    return new Response(reply.status === 204 || reply.status === 304 ? null : body, { status: reply.status, headers: reply.headers as Record<string, string> });
  } catch (e) {
    return json(500, { error: e instanceof Error ? e.message : String(e) });
  }
}

self.addEventListener('install', () => {
  void self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  // The page that registered it is answered at once, without a reload
  event.waitUntil(self.clients.claim());
});

self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);
  if (url.origin !== self.location.origin) return;
  const path = decodeURIComponent(url.pathname);
  if (path.toLowerCase() === newReportPath && event.request.method === 'POST') {
    event.respondWith(newReport(event.request));
    return;
  }
  // Only the protocol's routes: the rest of the site, untouched
  if (!routes.owns(path)) return;
  event.respondWith(answer(event, url));
});
