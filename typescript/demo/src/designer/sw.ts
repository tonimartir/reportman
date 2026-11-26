/// <reference lib="webworker" />
// The service worker of the designer of the live demo: the server of the designer, in the browser.
// It takes the requests of the element (api-base designer/api) and answers them with the designer
// protocol of @reportman/designer-server/browser over the demo's backend (backend.ts). Everything
// else (the page, the element, Monaco, the samples) goes to the network as usual.
import { DesignerOperations, DesignerProtocol, type ServerRequest } from '@reportman/designer-server/browser';
import { demoBackend } from './backend.js';

declare const self: ServiceWorkerGlobalScope;

// The demo's folder (with the samples, sql.js and the fonts): the parent of this worker's folder
const base = new URL('../', self.location.href).href;
// The routes of the protocol: {designer folder}/api/designer/...
const basePath = new URL('./', self.location.href).pathname.replace(/\/+$/, '');

const protocols = new Map<string, DesignerProtocol>();

/** The protocol of a culture: the engine's texts and the runs follow the language of the page. */
function protocolOf(culture: string): DesignerProtocol {
  let protocol = protocols.get(culture);
  if (protocol === undefined) {
    const operations = new DesignerOperations(demoBackend(base, { culture }), { culture });
    // Every visitor designs their own copies: nothing to refuse
    protocol = new DesignerProtocol(operations, { authorize: () => true, basePath });
    protocols.set(culture, protocol);
  }
  return protocol;
}

/** The culture of the page that asks: the Spanish page (indexes.html) runs in es-ES. */
async function cultureOf(event: FetchEvent): Promise<string> {
  const client = event.clientId ? await self.clients.get(event.clientId) : undefined;
  const page = client?.url ?? event.request.referrer ?? '';
  return /indexes\.html/i.test(page) ? 'es-ES' : 'en-US';
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
  };
  try {
    const reply = await protocolOf(await cultureOf(event)).handle(serverRequest);
    return new Response(reply.body as Uint8Array<ArrayBuffer>, { status: reply.status, headers: reply.headers as Record<string, string> });
  } catch (e) {
    return new Response(JSON.stringify({ error: e instanceof Error ? e.message : String(e) }), {
      status: 500,
      headers: { 'content-type': 'application/json; charset=utf-8' },
    });
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
  // Only the protocol's routes: the rest of the site, untouched
  const protocol = protocolOf('en-US');
  if (!protocol.owns(decodeURIComponent(url.pathname))) return;
  event.respondWith(answer(event, url));
});
