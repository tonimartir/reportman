// The designer's AI through the server (Reportman.Designer.Server.Ai of Reportman.Server): the page
// never talks to the Reportman AI cloud. It calls {base}/api/ai/{route} instead of {cloud}/{route} with
// the very same body, and this server sends it on as its installation (the guest credits are per
// installation), with the page's Reportman AI session when the person logged into the AI in its chat,
// and copies the answer back as it arrives: the events of an answer travel untouched, nothing is parsed
// or rebuilt on the way. The AI's login goes the same way ({base}/api/ai-login/...), so the page needs
// no origin the cloud knows.
//
// Only the cloud routes the designer uses pass (the list of the .NET bridge); any other is a 404.
// Stopping on the page closes its connection, and the call to the cloud is aborted with it, which
// stops the inference there.
//
// No Node.js API: fetch and web streams, so a page's service worker can answer its designer's AI too
// (the live demo of reportman.es), as long as the cloud accepts the page's origin.

import type { ServerRequest, ServerResponse } from '@reportman/server';

/** The Reportman AI identity one call to the cloud goes as (AiCredentials). */
export interface DesignerAiCredentials {
  /** The installation (X-Reportman-WebInstallId): the one the token was issued for. */
  installId: string;
  /** The account's session, sent as the Bearer; none: the installation's guest credits. */
  token?: string | null;
  /** More headers the cloud reads (a product, a payer...), after the page's: the page cannot change them. */
  headers?: Record<string, string>;
}

/** One call through the bridge, for the host's audit (AiBridgeCall). */
export interface DesignerAiCall {
  /** The cloud route (NlToSql/TranslateToSQLStream, api/aireport...). */
  route: string;
  /** Who paid: the page's Reportman AI account, or the installation's guest credits. */
  paidByAccount: boolean;
  /** The HTTP status; 499 when the person stopped it on the page. */
  status: number;
  bytes: number;
  ms: number;
  error: string;
}

/** The designer's AI: how the server reaches Reportman AI (ReportmanAiOptions and the host's seams). */
export interface DesignerAiOptions {
  /**
   * The installation the calls go as (X-Reportman-WebInstallId): its guest credits and the AI sessions
   * of the accounts that log in from it. The cloud takes it only with the repman- or web- prefix.
   */
  installId: string;
  /** The Reportman AI cloud API (https://aiapi.reportman.es). */
  apiUrl?: string;
  /** How long the cloud may take to start answering, in seconds (60). */
  headersTimeoutSeconds?: number;
  /**
   * The longest silence allowed between two parts of an answer, in seconds (360): a local agent may
   * think a long while before its first token.
   */
  idleTimeoutSeconds?: number;
  /**
   * The identity of a request when the host keeps it (its users are Reportman AI accounts): null for
   * the default, the page's AI session as this installation.
   */
  credentials?: (request: ServerRequest) => DesignerAiCredentials | null | Promise<DesignerAiCredentials | null>;
  /**
   * The account and credits the designer shows, when the host knows them better than the cloud (somebody
   * else pays): the answer of api/userprofile/status in the cloud's shape, or null to ask the cloud.
   */
  accountStatus?: (request: ServerRequest) => unknown | Promise<unknown>;
  /** Every call that spends (not the status the page asks on every page), for the host's audit. */
  audit?: (call: DesignerAiCall, request: ServerRequest) => void;
  /** The fetch of the calls to the cloud (the global one). */
  fetch?: typeof fetch;
}

/** The installation header of the cloud. */
export const AI_INSTALL_ID_HEADER = 'X-Reportman-WebInstallId';
/** The page's Reportman AI session, when the person logged into the AI: sent on as the Bearer. */
export const AI_TOKEN_HEADER = 'x-reportman-ai-token';

const DEFAULT_API_URL = 'https://aiapi.reportman.es';

/** The cloud routes reachable through the bridge, with their method (CloudBridge.Routes). */
const AI_ROUTES: Record<string, string> = {
  'nltosql/translatetosqlstream': 'POST',
  'nltosql/suggestsqlcodestream': 'POST',
  'nltosql/explainsqlstream': 'POST',
  // «Analyse with AI» of the local schema screen: the schema goes inline, nothing is stored in the cloud
  'nltosql/analyzeschemastream': 'POST',
  // «Generate with AI» of the same screen: nothing is stored in the cloud
  'nltosql/generateschemastream': 'POST',
  'reportmanexpression/suggestexpressionstream': 'POST',
  'reportdesigner/preprocesssqlcontextstream': 'POST',
  'reportdesigner/modifyreportstream': 'POST',
  'api/aireport': 'POST',
  'api/agent/databases': 'GET',
  // The profile and credits for the gauge and the account card (the guest's too)
  'api/userprofile/status': 'POST',
  // The schema library of Reportman AI, read only (api/schema/save never passes)
  'api/schema/list': 'GET',
};

/** Cloud routes that end in the number of one record, by their prefix (CloudBridge.NumberedRoutes). */
const AI_NUMBERED_ROUTES: Record<string, string> = { 'api/schema/': 'GET' };

/** The cloud's login routes (CloudLoginRelay.Routes): nothing else passes. */
const AI_LOGIN_ROUTES: Record<string, string> = {
  'api/loginresend/send': 'POST',
  'api/login/email': 'POST',
  'api/login/google/web': 'GET',
  'api/login/microsoft/web': 'GET',
  'api/login/apple/web': 'GET',
};

const STATUS_ROUTE = 'api/userprofile/status';
/** Routes that spend nothing and are asked on every page: not audited. */
const UNAUDITED = new Set([STATUS_ROUTE, 'api/agent/databases']);
/** Request headers passed on besides the session: what the page accepts, its language, an Agent key. */
const FORWARDED = ['accept', 'accept-language', 'x-reportman-apikey'];
/** The login relay passes the page's installation too. */
const LOGIN_FORWARDED = ['accept', 'accept-language', AI_INSTALL_ID_HEADER.toLowerCase()];

/** The method a cloud route passes with, or null when it does not pass (CloudBridge.MethodOf). */
export function aiRouteMethod(path: string): string | null {
  const lower = path.toLowerCase();
  const listed = AI_ROUTES[lower];
  if (listed !== undefined) return listed;
  for (const [prefix, method] of Object.entries(AI_NUMBERED_ROUTES)) {
    if (!lower.startsWith(prefix)) continue;
    // ASCII digits only, 18 at most: the id goes into the cloud's URL as it came
    if (/^\d{1,18}$/.test(path.substring(prefix.length))) return method;
  }
  return null;
}

const encoder = new TextEncoder();

function jsonAnswer(status: number, value: unknown): ServerResponse {
  return { status, headers: { 'content-type': 'application/json; charset=utf-8' }, body: encoder.encode(JSON.stringify(value)) };
}

/** The end of a URL: the query of the request, as it came. */
function queryOf(request: ServerRequest): string {
  const q = request.query.toString();
  return q.length > 0 ? '?' + q : '';
}

/** A body for fetch (an ArrayBuffer of its own: a Uint8Array may be a view of a bigger buffer). */
function bodyOf(request: ServerRequest): ArrayBuffer | undefined {
  if (request.method.toUpperCase() === 'GET' || request.body === undefined) return undefined;
  return request.body.slice().buffer as ArrayBuffer;
}

/** Aborts when any of the signals does (AbortSignal.any where the runtime has it). */
function anySignal(signals: (AbortSignal | undefined)[]): AbortSignal {
  const list = signals.filter((s): s is AbortSignal => s !== undefined);
  const any = (AbortSignal as unknown as { any?: (s: AbortSignal[]) => AbortSignal }).any;
  if (any !== undefined) return any(list);
  const controller = new AbortController();
  for (const s of list) {
    if (s.aborted) controller.abort(s.reason);
    else s.addEventListener('abort', () => controller.abort(s.reason), { once: true });
  }
  return controller.signal;
}

class Timeout extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'Timeout';
  }
}

/** The bridge and the login relay of the designer's AI. */
export class DesignerAiBridge {
  readonly installId: string;
  readonly apiUrl: string;
  private readonly options: DesignerAiOptions;

  constructor(options: DesignerAiOptions) {
    if (!/^(repman-|web-)/.test(options.installId ?? '')) throw new Error("The AI's installId must start with repman- or web- (the cloud takes no other).");
    this.options = options;
    this.installId = options.installId;
    this.apiUrl = (options.apiUrl ?? DEFAULT_API_URL).replace(/\/+$/, '');
  }

  /**
   * A call to the cloud. Never this.options.fetch(...) nor a fetch kept as a method: a browser's fetch
   * called with another `this` (the bridge) throws Illegal invocation.
   */
  private send(input: string, init: RequestInit): Promise<Response> {
    const f = this.options.fetch ?? globalThis.fetch;
    return f.call(globalThis, input, init);
  }

  /** GET /api/session/config: where the AI's login goes and this installation's id. */
  sessionConfig(base: string): ServerResponse {
    return jsonAnswer(200, { apiUrl: this.apiUrl, aiLoginUrl: base + '/api/ai-login', aiInstallId: this.installId });
  }

  /** {base}/api/ai/{route}: the call on to the cloud, its answer back as it arrives. The caller is a designer. */
  async bridge(request: ServerRequest, route: string): Promise<ServerResponse> {
    const path = route.replace(/^\/+|\/+$/g, '');
    const method = aiRouteMethod(path);
    if (method === null || method !== request.method.toUpperCase())
      return jsonAnswer(404, { error: 'This cloud route is not available through the server.', code: 'NotBridged' });

    // The account card asks for the profile and credits: the host may know them better (who pays)
    if (path.toLowerCase() === STATUS_ROUTE && this.options.accountStatus !== undefined) {
      const status = await this.options.accountStatus(request);
      if (status !== null && status !== undefined) return jsonAnswer(200, status);
    }

    // Who the call goes as: the host's account for this person, or the page's AI session as this
    // installation (the guest credits when there is none)
    let credentials = this.options.credentials !== undefined ? await this.options.credentials(request) : null;
    if (credentials === null) {
      const token = (request.headers[AI_TOKEN_HEADER] ?? '').trim();
      credentials = { installId: this.installId, token: token.length > 0 ? token : null };
    }

    const headers = new Headers();
    // Always the installation the server decides, whatever the page says
    headers.set(AI_INSTALL_ID_HEADER, credentials.installId);
    if (credentials.token) headers.set('Authorization', 'Bearer ' + credentials.token);
    for (const name of FORWARDED) {
      const value = request.headers[name];
      if (value !== undefined && value.length > 0) headers.set(name, value);
    }
    const contentType = request.headers['content-type'];
    if (contentType !== undefined && contentType.length > 0 && request.method.toUpperCase() !== 'GET') headers.set('content-type', contentType);
    // The host's own: after the page's, so the page cannot override them
    for (const [name, value] of Object.entries(credentials.headers ?? {})) headers.set(name, value);

    const started = Date.now();
    const outcome: DesignerAiCall = { route: path, paidByAccount: !!credentials.token, status: 0, bytes: 0, ms: 0, error: '' };
    const finish = (): void => {
      outcome.ms = Date.now() - started;
      if (!UNAUDITED.has(path.toLowerCase())) this.options.audit?.(outcome, request);
    };

    // Our own deadlines: one for the headers, then one between two parts of the answer
    const deadline = new AbortController();
    const signal = anySignal([request.signal, deadline.signal]);
    const headersTimer = setTimeout(() => deadline.abort(new Timeout('timeout waiting for the cloud')), (this.options.headersTimeoutSeconds ?? 60) * 1000);
    let reply: Response;
    try {
      reply = await this.send(this.apiUrl + '/' + path + queryOf(request), { method, headers, body: bodyOf(request), signal, redirect: 'manual' });
    } catch (e) {
      clearTimeout(headersTimer);
      if (request.signal?.aborted) {
        outcome.status = 499;
        outcome.error = 'stopped by the user';
        finish();
        return { status: 499, headers: {}, body: new Uint8Array(0) };
      }
      if (deadline.signal.aborted) {
        outcome.status = 504;
        outcome.error = 'timeout waiting for the cloud';
        finish();
        return jsonAnswer(504, { error: 'The Reportman AI cloud did not answer in time.', code: 'CloudTimeout' });
      }
      const why = e instanceof Error ? e.message : String(e);
      outcome.status = 502;
      outcome.error = 'cloud unreachable: ' + why;
      finish();
      return jsonAnswer(502, { error: 'Could not reach the Reportman AI cloud: ' + why, code: 'CloudUnreachable' });
    }
    clearTimeout(headersTimer);

    outcome.status = reply.status;
    const answerHeaders: Record<string, string> = {};
    const replyType = reply.headers.get('content-type');
    if (replyType !== null) answerHeaders['content-type'] = replyType;
    const isEventStream = /^text\/event-stream\b/i.test(replyType ?? '');
    if (isEventStream) {
      answerHeaders['cache-control'] = 'no-cache';
      // A reverse proxy in front of the server (nginx) must not hold the parts either
      answerHeaders['x-accel-buffering'] = 'no';
    }
    if (reply.body === null) {
      finish();
      return { status: reply.status, headers: answerHeaders, body: new Uint8Array(0) };
    }

    const idleMs = (this.options.idleTimeoutSeconds ?? 360) * 1000;
    const reader = reply.body.getReader();
    let finished = false;
    const done = (): void => {
      if (finished) return;
      finished = true;
      finish();
    };
    const stream = new ReadableStream<Uint8Array>({
      pull: async (controller) => {
        let idle: ReturnType<typeof setTimeout> | undefined;
        try {
          const read = await Promise.race([
            reader.read(),
            new Promise<never>((_resolve, reject) => {
              idle = setTimeout(() => reject(new Timeout('timeout: no data from the cloud for ' + idleMs / 1000 + ' s')), idleMs);
            }),
          ]);
          if (read.done) {
            controller.close();
            done();
            return;
          }
          outcome.bytes += read.value.length;
          controller.enqueue(read.value);
        } catch (e) {
          if (request.signal?.aborted) {
            outcome.status = 499;
            outcome.error = 'stopped by the user';
            done();
            controller.close();
            return;
          }
          const timeout = e instanceof Timeout;
          outcome.error = timeout ? e.message : 'cloud connection lost: ' + (e instanceof Error ? e.message : String(e));
          deadline.abort(e);
          reader.cancel().catch(() => undefined);
          // A last frame in the cloud's own final shape, so the page shows the error instead of no result
          if (isEventStream)
            controller.enqueue(
              errorFrame(timeout ? 'CloudTimeout' : 'CloudConnectionLost', timeout ? 'The Reportman AI cloud stopped answering.' : 'The connection with the Reportman AI cloud was lost.'),
            );
          controller.close();
          done();
        } finally {
          clearTimeout(idle);
        }
      },
      cancel: () => {
        // The page went away: the call to the cloud stops with it
        outcome.status = 499;
        outcome.error = 'stopped by the user';
        deadline.abort(new Error('stopped by the user'));
        reader.cancel().catch(() => undefined);
        done();
      },
    });
    return { status: reply.status, headers: answerHeaders, body: new Uint8Array(0), stream };
  }

  /**
   * {base}/api/ai-login/{route}: the AI's login through the server (CloudLoginRelay). Only the login
   * routes pass; the page's installation and language travel, its origin and cookies do not. A redirect
   * (the start of a Google, Microsoft or Apple login) goes back as it is, for the popup to follow; where
   * the runtime cannot read it (a browser's fetch), the popup is sent to the cloud's own route.
   */
  async login(request: ServerRequest, route: string): Promise<ServerResponse> {
    const path = route.replace(/^\/+|\/+$/g, '');
    const method = AI_LOGIN_ROUTES[path.toLowerCase()];
    if (method === undefined || method !== request.method.toUpperCase())
      return jsonAnswer(404, { error: 'This login route is not relayed by the server.', code: 'NotRelayed' });
    const url = this.apiUrl + '/' + path + queryOf(request);
    const headers = new Headers();
    for (const name of LOGIN_FORWARDED) {
      const value = request.headers[name];
      if (value !== undefined && value.length > 0) headers.set(name, value);
    }
    const contentType = request.headers['content-type'];
    if (contentType !== undefined && contentType.length > 0 && method !== 'GET') headers.set('content-type', contentType);
    let reply: Response;
    try {
      reply = await this.send(url, { method, headers, body: bodyOf(request), redirect: 'manual', signal: request.signal });
    } catch (e) {
      return jsonAnswer(502, { error: 'Could not reach the Reportman AI cloud: ' + (e instanceof Error ? e.message : String(e)), code: 'CloudUnreachable' });
    }
    // An opaque redirect (a browser's fetch hides where it goes): the popup goes to the cloud itself
    if (reply.type === 'opaqueredirect') return { status: 302, headers: { location: url }, body: new Uint8Array(0) };
    const answerHeaders: Record<string, string> = {};
    const location = reply.headers.get('location');
    if (location !== null) answerHeaders['location'] = location;
    const replyType = reply.headers.get('content-type');
    if (replyType !== null) answerHeaders['content-type'] = replyType;
    return { status: reply.status, headers: answerHeaders, body: new Uint8Array(await reply.arrayBuffer()) };
  }
}

/** The cloud's final frame with an error, and the end of the stream (CloudBridge.WriteErrorFrameAsync). */
function errorFrame(code: string, message: string): Uint8Array {
  return encoder.encode('\n\ndata: ' + JSON.stringify({ errorMessage: message, errorCode: code }) + '\n\ndata: [DONE]\n\n');
}
