// Adapters of the report server: node:http (and Express, whose requests and responses are the
// ones of node:http) and Fastify.

import type { IncomingMessage, ServerResponse as NodeResponse } from 'node:http';
import type { HttpServerLike, ServerRequest, ServerResponse } from './server.js';

/** The body of a node:http request, or of one a framework already read (Express's body parsers). */
async function readBody(req: IncomingMessage & { body?: unknown }): Promise<Uint8Array | undefined> {
  const parsed = req.body;
  if (parsed instanceof Uint8Array) return parsed;
  if (typeof parsed === 'string') return new TextEncoder().encode(parsed);
  if (parsed !== undefined && parsed !== null && typeof parsed === 'object') {
    // express.json() or express.urlencoded(): the body again as the client sent it
    const type = req.headers['content-type'] ?? '';
    if (/x-www-form-urlencoded/i.test(type)) return new TextEncoder().encode(new URLSearchParams(parsed as Record<string, string>).toString());
    return new TextEncoder().encode(JSON.stringify(parsed));
  }
  if (req.readableEnded) return undefined;
  const chunks: Uint8Array[] = [];
  for await (const chunk of req) chunks.push(typeof chunk === 'string' ? new TextEncoder().encode(chunk) : (chunk as Uint8Array));
  if (chunks.length === 0) return undefined;
  const total = chunks.reduce((n, c) => n + c.length, 0);
  const body = new Uint8Array(total);
  let offset = 0;
  for (const c of chunks) {
    body.set(c, offset);
    offset += c.length;
  }
  return body;
}

/** The framework independent request of a node:http one. */
export async function toServerRequest(req: IncomingMessage & { body?: unknown; originalUrl?: string }): Promise<ServerRequest> {
  // Express mounted on a path gives the path inside the mount in url, the whole one in originalUrl
  const url = new URL(req.originalUrl ?? req.url ?? '/', 'http://localhost');
  const headers: Record<string, string | undefined> = {};
  for (const [k, v] of Object.entries(req.headers)) headers[k.toLowerCase()] = Array.isArray(v) ? v.join(', ') : v;
  return { method: req.method ?? 'GET', path: url.pathname, query: url.searchParams, headers, body: await readBody(req), remoteAddress: req.socket?.remoteAddress };
}

function send(res: NodeResponse, response: ServerResponse): void {
  res.statusCode = response.status;
  for (const [k, v] of Object.entries(response.headers)) res.setHeader(k, v);
  res.setHeader('content-length', String(response.body.length));
  res.end(response.body);
}

/**
 * A node:http request listener: http.createServer(nodeHandler(server)). In Express,
 * app.use(nodeHandler(server)): a path the server does not answer (owns) goes to next(). The
 * server is a ReportServer, a DesignerServer of @reportman/designer-server or any HttpServerLike.
 */
export function nodeHandler(server: HttpServerLike): (req: IncomingMessage, res: NodeResponse, next?: (err?: unknown) => void) => void {
  return (req, res, next) => {
    const path = new URL((req as { originalUrl?: string }).originalUrl ?? req.url ?? '/', 'http://localhost').pathname;
    if (!server.owns(path) && next !== undefined) {
      next();
      return;
    }
    toServerRequest(req)
      .then((request) => server.handle(request))
      .then((response) => send(res, response))
      .catch((e: unknown) => {
        if (next !== undefined) next(e);
        else {
          res.statusCode = 500;
          res.end(String(e));
        }
      });
  };
}

/** What the Fastify adapter needs of a Fastify instance (no dependency on the package). */
interface FastifyLike {
  addContentTypeParser(contentType: string | RegExp, options: { parseAs: 'buffer' }, parser: (req: unknown, body: Uint8Array, done: (err: Error | null, body?: unknown) => void) => void): void;
  all(path: string, handler: (request: { raw: IncomingMessage; body?: unknown }, reply: FastifyReplyLike) => Promise<void> | void): void;
}
interface FastifyReplyLike {
  code(status: number): FastifyReplyLike;
  header(name: string, value: string): FastifyReplyLike;
  send(body: Uint8Array): void;
}

/**
 * A Fastify plugin: fastify.register(fastifyPlugin(server)). The bodies of the routes reach the
 * server as they came (a parser of every content type as bytes, inside the plugin only).
 */
export function fastifyPlugin(server: HttpServerLike): (fastify: FastifyLike, _opts: unknown, done: () => void) => void {
  return (fastify, _opts, done) => {
    fastify.addContentTypeParser(/.*/, { parseAs: 'buffer' }, (_req, body, next) => next(null, body));
    const handler = async (request: { raw: IncomingMessage; body?: unknown }, reply: FastifyReplyLike): Promise<void> => {
      const raw = request.raw as IncomingMessage & { body?: unknown };
      raw.body = request.body;
      const response = await server.handle(await toServerRequest(raw));
      reply.code(response.status);
      for (const [k, v] of Object.entries(response.headers)) reply.header(k, v);
      reply.send(response.body);
    };
    for (const route of server.routes()) fastify.all(route, handler);
    done();
  };
}
