// HttpAgentExecutor: the requests of the Hub API (api/agent/execute and the catalog, test and database
// requests of the same class), with its headers, credentials, timeout and errors, over the fetch of the
// platform (Node.js 18+, the browsers, Deno, Bun...), reached through globalThis.
//
// The WebRTC direct channel of the C# engine on .NET 8+ (DirectAgentExecutor, which tries a DataChannel
// first and falls back to this same HTTP path when it cannot open one) is not part of this package: every
// query goes over HTTP, as on the net48 build of the C# engine and on the Linux/FPC builds of the Delphi
// one. The result is the same, only the transport differs.

import {
  CultureInfo,
  formatDouble,
  NamedException,
  NetException,
  Translator,
  type QueryParameter,
  type QueryResult,
} from '@reportman/engine';
import { parseJson, toPlain, tryGetProperty, type JsonElement } from './json.js';
import { databaseBody, executeBody } from './request.js';
import type { AgentSettings } from './settings.js';
import { statusCodeName } from './status.js';
import { deserializeTable } from './table.js';
import { readContentAsString } from './text.js';

// ---------------------------------------------------------------------------------------------
// The platform (structural: the package is compiled without DOM or Node types)

/** The part of a fetch Response the executor reads. */
export interface FetchResponse {
  readonly status: number;
  readonly headers: { get(name: string): string | null };
  arrayBuffer(): Promise<ArrayBuffer>;
}

/** The part of fetch's RequestInit the executor sets. */
export interface FetchInit {
  method: 'GET' | 'POST';
  headers: Record<string, string>;
  body?: string;
  signal?: unknown;
}

/** fetch, or anything that behaves like it for these requests (a test double, a proxy...). */
export type FetchLike = (url: string, init: FetchInit) => Promise<FetchResponse>;

interface AbortControllerLike {
  readonly signal: unknown;
  abort(reason?: unknown): void;
}

interface PlatformGlobals {
  fetch?: FetchLike;
  AbortController?: new () => AbortControllerLike;
  setTimeout?: (handler: () => void, ms: number) => unknown;
  clearTimeout?: (id: unknown) => void;
}

const platform = globalThis as unknown as PlatformGlobals;

// ---------------------------------------------------------------------------------------------
// The messages of the engine (rpmdconsts / reportmanres)

const AGENT_NOT_CONFIGURED = 1824;
const AGENT_NO_CREDENTIALS = 1825;
const AGENT_NOT_CONFIGURED_DEFAULT =
  'The connection "%s" (Reportman AI Agent) is not configured on this computer: it has no Hub database. Define it in the ' +
  'connections file, for example with the connections dialog or the new report wizard.';
const AGENT_NO_CREDENTIALS_DEFAULT =
  'The connection "%s" (Reportman AI Agent) has no API key and there is no Reportman AI session. Log in from the designer, ' +
  'or add the API key of the connection to the connections file to run the report without a session (printreptopdf, server).';

function agentMessage(translator: Translator, index: number, fallback: string, alias: string): string {
  let message = translator.translateStr(index);
  if (message.length === 0 || message === 'XXXXXXX') message = fallback;
  const position = message.indexOf('%s');
  if (position >= 0) message = message.substring(0, position) + alias + message.substring(position + 2);
  return message;
}

// ---------------------------------------------------------------------------------------------

/** How an executor behaves beyond its settings. */
export interface ExecutorOptions {
  /** The fetch to use; the one of the platform by default. */
  fetch?: FetchLike;
  /**
   * The time a request may take, in milliseconds: HttpClient.Timeout, 100 000 (100 s) by default; 0 or
   * Infinity waits for ever. A request that takes longer fails as in C#, with a TaskCanceledException.
   */
  timeout?: number;
  /** The culture of the messages (the Spanish texts of the engine for "es", the English ones otherwise). */
  culture?: CultureInfo | string;
  /** The texts of the engine's messages (instead of the culture's). */
  translator?: Translator;
}

/** A request of the executor: the URL, the method and the body. */
interface AgentRequest {
  url: string;
  method: 'GET' | 'POST';
  body?: string;
}

/** The answer of a request: its status and its text (HttpContent.ReadAsStringAsync). */
interface AgentAnswer {
  status: number;
  text: string;
}

/** The executor of a Reportman AI Agent connection (HttpAgentExecutor). */
export class HttpAgentExecutor {
  readonly settings: Readonly<AgentSettings>;
  private readonly fetchFn: FetchLike | undefined;
  private readonly timeout: number;
  private readonly culture: CultureInfo;
  private readonly translator: Translator;

  constructor(settings: AgentSettings, options: ExecutorOptions = {}) {
    this.settings = { ...settings };
    this.fetchFn = options.fetch ?? (typeof platform.fetch === 'function' ? platform.fetch.bind(globalThis) : undefined);
    this.timeout = options.timeout ?? 100000;
    const culture = options.culture ?? 'en-US';
    this.culture = typeof culture === 'string' ? CultureInfo.get(culture) : culture;
    this.translator = options.translator ?? Translator.forCulture(this.culture);
  }

  /** The clear error of a connection without a Hub database (resource string 1824 with its alias). */
  notConfiguredException(): NamedException {
    const alias = this.settings.connectionName;
    return new NamedException(agentMessage(this.translator, AGENT_NOT_CONFIGURED, AGENT_NOT_CONFIGURED_DEFAULT, alias), alias);
  }

  /** CheckNoCredentialsRefusal: the clear error of a 403 to a request without an API key and without a session. */
  private checkNoCredentialsRefusal(status: number): void {
    const s = this.settings;
    if (status === 403 && s.apiKey.length === 0 && s.token.length === 0) {
      throw new NamedException(
        agentMessage(this.translator, AGENT_NO_CREDENTIALS, AGENT_NO_CREDENTIALS_DEFAULT, s.connectionName),
        s.connectionName,
      );
    }
  }

  /** The checks before a request of the Hub database: a base URL and a Hub database. */
  private checkConfigured(): void {
    if (this.settings.baseUrl.length === 0) throw new NetException('InvalidOperationException', 'BaseUrl is not configured for HttpAgent');
    if (this.settings.hubDatabaseId <= 0n) throw this.notConfiguredException();
  }

  /** BaseUrl.TrimEnd('/') + "/" + path. */
  private url(path: string): string {
    return this.settings.baseUrl.replace(/\/+$/, '') + '/' + path;
  }

  /** ApplyHeaders: the API key, or the Bearer token without one, and the install id; nothing without them. */
  headers(withBody: boolean): Record<string, string> {
    const s = this.settings;
    const headers: Record<string, string> = {};
    if (withBody) headers['content-type'] = 'application/json; charset=utf-8';
    if (s.apiKey.length > 0) headers['x-reportman-apikey'] = s.apiKey;
    else if (s.token.length > 0) headers['authorization'] = 'Bearer ' + s.token;
    if (s.installId.length > 0) headers['x-reportman-webinstallid'] = s.installId;
    return headers;
  }

  /** The TaskCanceledException of HttpClient.Timeout. */
  private timeoutException(): NetException {
    const seconds = formatDouble(this.timeout / 1000, '', this.culture.number);
    return new NetException(
      'TaskCanceledException',
      `The request was canceled due to the configured HttpClient.Timeout of ${seconds} seconds elapsing.`,
    );
  }

  /** The HttpRequestException of a request that got no answer. */
  private requestException(url: string, error: unknown): NetException {
    let endpoint = '';
    try {
      const m = /^[a-z][a-z0-9+.-]*:\/\/(?:[^@/?#]*@)?(\[[^\]]*\]|[^:/?#]*)(?::(\d+))?/i.exec(url);
      if (m !== null) endpoint = m[1]! + ':' + (m[2] ?? (url.toLowerCase().startsWith('https:') ? '443' : '80'));
    } catch {
      endpoint = '';
    }
    let code = '';
    let detail = error instanceof Error ? error.message : String(error);
    for (let e: unknown = error; e !== null && e !== undefined && typeof e === 'object'; e = (e as { cause?: unknown }).cause) {
      const c = (e as { code?: unknown }).code;
      if (typeof c === 'string') code = c;
      if (e !== error && e instanceof Error) detail = e.message;
    }
    // The texts of the Windows sockets the C# engine shows (in the language of the system there)
    let message: string;
    if (code === 'ECONNREFUSED') message = 'No connection could be made because the target machine actively refused it.';
    else if (code === 'ENOTFOUND' || code === 'EAI_AGAIN') message = 'No such host is known.';
    else if (code === 'ETIMEDOUT') message = 'A connection attempt failed because the connected party did not properly respond after a period of time, or established connection failed because connected host has failed to respond.';
    else if (code === 'ECONNRESET') message = 'An existing connection was forcibly closed by the remote host.';
    else message = detail.length > 0 ? detail : 'An error occurred while sending the request.';
    return new NetException('HttpRequestException', endpoint.length > 0 ? `${message} (${endpoint})` : message);
  }

  /** Sends a request and reads its answer as text, within the timeout. */
  private async send(request: AgentRequest): Promise<AgentAnswer> {
    const fetchFn = this.fetchFn;
    if (fetchFn === undefined) throw new NetException('PlatformNotSupportedException', 'There is no fetch on this platform: pass one in the fetch option.');
    const controller = typeof platform.AbortController === 'function' ? new platform.AbortController() : undefined;
    const init: FetchInit = { method: request.method, headers: this.headers(request.body !== undefined) };
    if (request.body !== undefined) init.body = request.body;
    if (controller !== undefined) init.signal = controller.signal;
    const work = (async (): Promise<AgentAnswer> => {
      let response: FetchResponse;
      try {
        response = await fetchFn(request.url, init);
      } catch (e) {
        throw this.requestException(request.url, e);
      }
      const bytes = new Uint8Array(await response.arrayBuffer());
      return { status: response.status, text: readContentAsString(bytes, response.headers.get('content-type')) };
    })();
    const limit = this.timeout;
    if (!(limit > 0) || limit === Infinity || typeof platform.setTimeout !== 'function') return work;
    let timer: unknown;
    let timedOut = false;
    const expired = new Promise<never>((_, reject) => {
      timer = platform.setTimeout!(() => {
        timedOut = true;
        controller?.abort();
        reject(this.timeoutException());
      }, limit);
    });
    try {
      return await Promise.race([work, expired]);
    } catch (e) {
      if (timedOut) throw this.timeoutException();
      throw e;
    } finally {
      platform.clearTimeout?.(timer);
      work.catch(() => undefined);
    }
  }

  private failure(status: number, text: string): NetException {
    this.checkNoCredentialsRefusal(status);
    return new NetException('Exception', `HttpAgent error ${statusCodeName(status)}: ${text}`);
  }

  /** ExecuteSqlAsync: runs a query through api/agent/execute and returns its columns and rows. */
  async execute(sql: string, parameters: readonly QueryParameter[]): Promise<QueryResult> {
    this.checkConfigured();
    const body = executeBody(this.settings.hubDatabaseId, sql, parameters);
    const answer = await this.send({ url: this.url('api/agent/execute'), method: 'POST', body });
    if (answer.status < 200 || answer.status > 299) throw this.failure(answer.status, answer.text);
    return deserializeTable(answer.text);
  }

  /**
   * TestConnection (api/agent/testconnection): its Agent and the database behind it. The message of the Hub
   * ("Agent Connection: Success ..."), or ""; the error of the Hub when the database cannot be reached.
   */
  async testConnection(): Promise<string> {
    this.checkConfigured();
    const answer = await this.send({ url: this.url('api/agent/testconnection'), method: 'POST', body: databaseBody(this.settings.hubDatabaseId) });
    if (answer.status < 200 || answer.status > 299) throw this.failure(answer.status, answer.text);
    const root = parseJson(answer.text);
    let data: JsonElement = root;
    const dataProp = root.kind === 'Object' ? tryGetProperty(root, 'data') : undefined;
    if (dataProp !== undefined && dataProp.kind === 'Object') data = dataProp;
    const message = readText(data, 'message');
    const success = root.kind === 'Object' ? tryGetProperty(root, 'success') : undefined;
    const dbOk = data.kind === 'Object' ? tryGetProperty(data, 'databaseConnectionSuccess') : undefined;
    if ((success !== undefined && success.kind === 'False') || (dbOk !== undefined && dbOk.kind === 'False')) {
      let error = readText(data, 'databaseError');
      if (error.length === 0) error = readText(root, 'error');
      throw new NetException('Exception', error.length > 0 ? error : message.length > 0 ? message : 'HttpAgent test failed');
    }
    return message;
  }

  /**
   * ReadCatalogAsync: the array `field` of the answer of a catalog request (api/agent/readtables,
   * readcolumns or readforeignkeys, what app.reportman.es/database-config reads), [] when it has none.
   */
  async readCatalog(action: string, tableName: string | null, field: string): Promise<unknown[]> {
    this.checkConfigured();
    const answer = await this.send({ url: this.url(action), method: 'POST', body: databaseBody(this.settings.hubDatabaseId, tableName) });
    if (answer.status < 200 || answer.status > 299) throw this.failure(answer.status, answer.text);
    const root = parseJson(answer.text);
    const success = root.kind === 'Object' ? tryGetProperty(root, 'success') : undefined;
    if (success !== undefined && success.kind === 'False') {
      const error = readText(root, 'error');
      throw new NetException('Exception', error.length > 0 ? error : action + ' failed');
    }
    let data = root;
    const dataProp = root.kind === 'Object' ? tryGetProperty(root, 'data') : undefined;
    if (dataProp !== undefined && dataProp.kind === 'Object') data = dataProp;
    const array = data.kind === 'Object' ? tryGetProperty(data, field) : undefined;
    return array !== undefined && array.kind === 'Array' ? (toPlain(array) as unknown[]) : [];
  }

  /** ReadDialectAsync: the dialect of the Hub database (GET api/agent/databases, as "Firebird5"); "" when unknown. */
  async readDialect(): Promise<string> {
    if (this.settings.baseUrl.length === 0 || this.settings.hubDatabaseId <= 0n) return '';
    const answer = await this.send({ url: this.url('api/agent/databases'), method: 'GET' });
    if (answer.status < 200 || answer.status > 299) return '';
    const root = parseJson(answer.text);
    const databases = root.kind === 'Object' ? tryGetProperty(root, 'databases') : undefined;
    if (databases === undefined || databases.kind !== 'Array') return '';
    for (const item of databases.items!) {
      const id = item.kind === 'Object' ? tryGetProperty(item, 'hubDatabaseId') : undefined;
      if (id === undefined) continue;
      const m = /^[\t\n\v\f\r ]*([+-]?\d+)[\t\n\v\f\r ]*$/.exec(id.raw.replace(/^"+|"+$/g, ''));
      if (m === null || BigInt(m[1]!) !== this.settings.hubDatabaseId) continue;
      const dialect = readText(item, 'dialect').trim();
      if (dialect.length > 0) return dialect;
    }
    return '';
  }
}

/** ReadText: a string property of an object, or "". */
function readText(item: JsonElement, name: string): string {
  if (item.kind !== 'Object') return '';
  const value = tryGetProperty(item, name);
  return value !== undefined && value.kind === 'String' ? value.text! : '';
}
