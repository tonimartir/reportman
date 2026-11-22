// The administration routes of Reportman.Server over the data folder: the connections
// (ConnectionsController), the aliases, the sample reports and the API keys (ConsoleController) and
// the list of the samples (SamplesController), with the same routes and answers. They need the
// administrator's key (X-ReportmanServer-AdminKey), or nothing on a server set as trusted.

import { existsSync, readFileSync } from 'node:fs';
import { timingSafeEqual } from 'node:crypto';
import path from 'node:path';
import {
  ConnectionsStore,
  availableProviders,
  buildConnectionString,
  connectionStringParameters,
  describeProvider,
  isPasswordName,
  maskPasswords,
  testConnection,
  type AgentTestOptions,
  type ConnectionDefinition,
  type ServerDrivers,
} from './connections.js';
import { SAMPLE_REPORTS_FOLDER, ServerData, loadSamples, normalizeLanguage, samplesSource, type ApiKeyRecord } from './data.js';
import { ServerError } from './store.js';

/** The header of the administrator's key. */
export const ADMIN_KEY_HEADER = 'x-reportmanserver-adminkey';

/** What the console routes answer: a JSON value, an empty answer or some bytes. */
export type ConsoleAnswer = { status: number; json?: unknown; bytes?: Uint8Array; contentType?: string; cacheControl?: string };

/** Options of the console. */
export interface ConsoleOptions {
  data: ServerData;
  drivers: ServerDrivers;
  /** The administrator's key; without it only a trusted server opens the console. */
  adminKey?: string;
  /** Open the console without a key: for a server only its own people reach. */
  trusted?: boolean;
  /** Where an Agent connection is tested. */
  agent?: AgentTestOptions;
}

/** The body of PUT /api/connections/{alias} and POST .../test (SaveRequest). */
interface SaveRequest {
  kind?: string | null;
  hubDatabaseId?: number | null;
  apiKey?: string | null;
  providerFactory?: string | null;
  parameters?: { name?: string; value?: string | null }[] | null;
  connectionString?: string | null;
}

const ok = (json: unknown): ConsoleAnswer => ({ status: 200, json });
const noContent: ConsoleAnswer = { status: 204 };

/** A value of a JSON object by its name in any case. */
function field(o: Record<string, unknown>, name: string): unknown {
  const k = Object.keys(o).find((key) => key.toLowerCase() === name.toLowerCase());
  return k === undefined ? undefined : o[k];
}

/** The JSON object of a body ({} when empty). */
export function jsonBody(body: Uint8Array | undefined): Record<string, unknown> {
  if (body === undefined || body.length === 0) return {};
  const text = new TextDecoder('utf-8').decode(body);
  if (text.trim().length === 0) return {};
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    throw new ServerError(400, 'The body is not valid JSON.');
  }
  if (value === null || typeof value !== 'object' || Array.isArray(value)) throw new ServerError(400, 'The body must be a JSON object.');
  return value as Record<string, unknown>;
}

function saveRequest(o: Record<string, unknown>): SaveRequest {
  const str = (name: string): string | null => {
    const v = field(o, name);
    return typeof v === 'string' ? v : null;
  };
  const id = field(o, 'hubDatabaseId');
  const params = field(o, 'parameters');
  return {
    kind: str('kind'),
    hubDatabaseId: typeof id === 'number' ? id : typeof id === 'string' && /^\d+$/.test(id) ? Number(id) : null,
    apiKey: str('apiKey'),
    providerFactory: str('providerFactory'),
    parameters: Array.isArray(params)
      ? params
          .filter((p) => p !== null && typeof p === 'object')
          .map((p) => {
            const name = field(p as Record<string, unknown>, 'name');
            const value = field(p as Record<string, unknown>, 'value');
            return { name: typeof name === 'string' ? name : '', value: typeof value === 'string' ? value : value === null || value === undefined ? null : String(value) };
          })
      : null,
    connectionString: str('connectionString'),
  };
}

/** The key as the console lists it (View of ConsoleController). */
function keyView(k: ApiKeyRecord): Record<string, unknown> {
  return {
    id: k.id,
    name: k.name,
    key: k.key,
    aliases: k.aliases,
    createdUtc: k.createdUtc,
    createdBy: k.createdBy,
    lastUsedUtc: k.lastUsedUtc,
    rotatedUtc: k.rotatedUtc,
    rotatedBy: k.rotatedBy,
    disabled: k.disabled,
  };
}

/** The console routes. */
export class ConsoleApi {
  readonly data: ServerData;
  readonly connections: ConnectionsStore;
  private readonly options: ConsoleOptions;

  constructor(options: ConsoleOptions) {
    this.options = options;
    this.data = options.data;
    this.connections = new ConnectionsStore(options.data.dataPath, options.data.connectionsFile);
  }

  /** Whether the console needs a key. */
  get auth(): 'key' | 'none' {
    return this.options.trusted === true ? 'none' : 'key';
  }

  /** 401 unless the request carries the administrator's key (or the server is trusted). */
  requireAdmin(headers: Readonly<Record<string, string | undefined>>): void {
    if (this.options.trusted === true) return;
    const expected = this.options.adminKey ?? '';
    const given = headers[ADMIN_KEY_HEADER] ?? '';
    if (expected.length === 0) throw new ServerError(403, 'The console is closed: start the server with an administrator key, or as trusted.');
    const a = Buffer.from(given, 'utf8');
    const b = Buffer.from(expected, 'utf8');
    if (a.length !== b.length || !timingSafeEqual(a, b)) throw new ServerError(401, 'The administrator key is not valid.', { code: 'AdminKeyRequired' });
  }

  /**
   * Answers a console route, or null when the path is not one. `parts` are the decoded segments
   * after /api ("connections", "PG", "test").
   */
  async handle(method: string, parts: readonly string[], query: URLSearchParams, headers: Readonly<Record<string, string | undefined>>, body: Uint8Array | undefined): Promise<ConsoleAnswer | null> {
    const area = parts[0]?.toLowerCase();
    if (area === 'console' && parts.length === 2 && parts[1]!.toLowerCase() === 'status' && method === 'GET') {
      // Public: whether the page has to ask for the key
      return ok({ auth: this.auth, samples: samplesSource() !== null, providers: availableProviders(this.options.drivers).map((p) => p.name) });
    }
    if (area === 'reports' && parts[1]?.toLowerCase() === 'samples') {
      this.requireAdmin(headers);
      return this.samples(method, parts.slice(2), query, headers);
    }
    if (area === 'connections') {
      this.requireAdmin(headers);
      return this.connectionRoute(method, parts.slice(1), body);
    }
    if (area === 'console') {
      this.requireAdmin(headers);
      return this.consoleRoute(method, parts.slice(1), body);
    }
    return null;
  }

  // ---- /api/connections ----

  private async connectionRoute(method: string, rest: readonly string[], body: Uint8Array | undefined): Promise<ConsoleAnswer> {
    if (rest.length === 0 && method === 'GET') return ok(this.connections.list().map((c) => this.view(c)));
    if (rest.length === 1 && rest[0]!.toLowerCase() === 'providers' && method === 'GET') return ok(availableProviders(this.options.drivers));
    if (rest.length === 3 && rest[0]!.toLowerCase() === 'providers' && rest[2]!.toLowerCase() === 'parameters' && method === 'GET') return ok(describeProvider(rest[1]!));
    if (rest.length === 1) {
      const alias = rest[0]!;
      if (method === 'GET') {
        const c = this.connections.get(alias);
        if (c === null) throw new ServerError(404, 'Database alias not found: ' + alias);
        return ok(this.view(c));
      }
      if (method === 'PUT') {
        const definition = this.definition(alias, saveRequest(jsonBody(body)), this.connections.get(alias));
        if (definition.kind === 'agent' && (definition.hubDatabaseId ?? 0) <= 0)
          throw new ServerError(400, 'An Agent connection needs the Hub database it reaches.', { code: 'HubDatabaseRequired' });
        return ok(this.view(this.connections.save(definition)));
      }
      if (method === 'DELETE') {
        this.connections.delete(alias);
        return noContent;
      }
    }
    if (rest.length === 2 && rest[1]!.toLowerCase() === 'test' && method === 'POST') {
      const alias = rest[0]!;
      const stored = this.connections.get(alias);
      const request = body === undefined || body.length === 0 ? null : saveRequest(jsonBody(body));
      let definition: ConnectionDefinition | null;
      try {
        definition = request === null ? stored : this.definition(alias, request, stored);
      } catch (e) {
        return ok({ ok: false, message: e instanceof Error ? e.message : String(e) });
      }
      if (definition === null) return ok({ ok: false, message: 'Database alias not found: ' + alias });
      if (definition.kind === 'direct' && (definition.providerFactory ?? '').length === 0) return ok({ ok: false, message: 'Provider is required' });
      return ok(await testConnection(definition, this.options.drivers, this.options.agent));
    }
    throw new ServerError(404, 'Not found.');
  }

  /**
   * The definition to store or test (Definition of ConnectionsController): the parameters of the
   * request (an empty password keeps the stored one, a file of the data folder made absolute) and
   * the connection string built from them; a legacy string is read into parameters.
   */
  private definition(alias: string, request: SaveRequest, stored: ConnectionDefinition | null): ConnectionDefinition {
    const kind = request.kind === 'direct' ? 'direct' : request.kind === 'agent' ? 'agent' : (stored?.kind ?? 'agent');
    const definition: ConnectionDefinition = {
      alias,
      kind,
      hubDatabaseId: request.hubDatabaseId ?? stored?.hubDatabaseId ?? null,
      apiKey: request.apiKey !== null && request.apiKey !== undefined && request.apiKey.trim().length > 0 ? request.apiKey.trim() : (stored?.apiKey ?? null),
      providerFactory: request.providerFactory?.trim() ?? stored?.providerFactory ?? null,
      connectionString: null,
      parameters: {},
      extra: {},
    };
    if (kind !== 'direct') return definition;
    if (definition.providerFactory === null || definition.providerFactory.length === 0) throw new ServerError(400, 'Provider is required');
    if (request.parameters !== null && request.parameters !== undefined) {
      for (const p of request.parameters) {
        const name = (p.name ?? '').trim();
        if (name.length === 0) continue;
        let value = (p.value ?? '').trim();
        if (value.length === 0 && isPasswordName(name) && stored !== null) {
          const kept = Object.keys(stored.parameters).find((k) => k.toUpperCase() === name.toUpperCase());
          if (kept !== undefined) value = stored.parameters[kept]!;
        }
        if (value.length > 0) definition.parameters[name] = value;
      }
    } else if (request.connectionString !== null && request.connectionString !== undefined && request.connectionString.trim().length > 0) {
      definition.parameters = connectionStringParameters(definition.providerFactory, request.connectionString.trim());
    } else if (stored !== null) {
      definition.parameters = { ...stored.parameters };
    }
    definition.parameters = this.connections.resolve(definition.providerFactory, definition.parameters);
    definition.connectionString = buildConnectionString(definition.providerFactory, definition.parameters);
    return definition;
  }

  /** A connection as the page shows it (ConnectionView): passwords never sent. */
  private view(c: ConnectionDefinition): Record<string, unknown> {
    return {
      alias: c.alias,
      kind: c.kind,
      hubDatabaseId: c.hubDatabaseId,
      hasApiKey: c.apiKey !== null && c.apiKey.length > 0,
      isExample: false,
      providerFactory: c.providerFactory,
      connectionString: maskPasswords(c.connectionString),
      parameters: Object.entries(c.parameters).map(([name, value]) => {
        const secret = isPasswordName(name);
        return { name, value: secret ? null : value, hasSecret: secret && value.length > 0 };
      }),
    };
  }

  // ---- /api/console ----

  private consoleRoute(method: string, rest: readonly string[], body: Uint8Array | undefined): ConsoleAnswer {
    const head = rest[0]?.toLowerCase();
    if (head === 'check' && rest.length === 1 && method === 'GET') return noContent;
    if (head === 'aliases') {
      if (rest.length === 1 && method === 'GET') {
        return ok(Object.entries(this.data.aliases()).map(([alias, folder]) => ({ alias, folder, path: this.data.folderOf(alias) })));
      }
      if (rest.length === 2 && method === 'PUT') {
        const folder = field(jsonBody(body), 'folder');
        return ok(this.data.saveAlias(rest[1]!, typeof folder === 'string' ? folder : null));
      }
      if (rest.length === 2 && method === 'DELETE') {
        if (!this.data.deleteAlias(rest[1]!)) throw new ServerError(404, 'Unknown alias.');
        return noContent;
      }
    }
    if (head === 'samples' && rest.length === 1 && method === 'POST') {
      const result = this.data.installSamples();
      return ok({ ...result, schema: false });
    }
    if (head === 'keys') {
      if (rest.length === 1 && method === 'GET') return ok(this.data.keys().map(keyView));
      if (rest.length === 1 && method === 'POST') {
        const o = jsonBody(body);
        const name = field(o, 'name');
        const aliases = field(o, 'aliases');
        const record = this.data.createKey(typeof name === 'string' ? name : '', Array.isArray(aliases) ? aliases.map(String) : null, 'console');
        return ok({ key: record.key, record: keyView(record) });
      }
      if (rest.length === 3 && rest[2]!.toLowerCase() === 'rotate' && method === 'POST') {
        const record = this.data.rotateKey(rest[1]!, 'console');
        if (record === null) throw new ServerError(404, 'Unknown key.');
        return ok({ key: record.key, record: keyView(record) });
      }
      if (rest.length === 2 && method === 'PUT') {
        const o = jsonBody(body);
        const name = field(o, 'name');
        const aliases = field(o, 'aliases');
        const disabled = field(o, 'disabled');
        const record = this.data.updateKey(rest[1]!, {
          name: typeof name === 'string' ? name : null,
          aliases: Array.isArray(aliases) ? aliases.map(String) : null,
          disabled: typeof disabled === 'boolean' ? disabled : null,
        });
        if (record === null) throw new ServerError(404, 'Unknown key.');
        return ok(keyView(record));
      }
      if (rest.length === 2 && method === 'DELETE') {
        if (!this.data.deleteKey(rest[1]!)) throw new ServerError(404, 'Unknown key.');
        return noContent;
      }
    }
    throw new ServerError(404, 'Not found.');
  }

  // ---- /api/reports/samples ----

  /** The alias whose folder holds informes/Ejemplos, INFORMES first, and the path of the folder inside it. */
  private aliasOfSamples(): { alias: string; prefix: string } | null {
    const samples = path.resolve(this.data.reportsPath, SAMPLE_REPORTS_FOLDER);
    const aliases = Object.keys(this.data.aliases()).sort((a, b) => (a.toUpperCase() === 'INFORMES' ? -1 : b.toUpperCase() === 'INFORMES' ? 1 : a.toUpperCase() < b.toUpperCase() ? -1 : 1));
    for (const alias of aliases) {
      const folder = this.data.folderOf(alias);
      if (folder === null) continue;
      const root = path.resolve(folder) + path.sep;
      const target = samples + path.sep;
      const inside = process.platform === 'win32' ? target.toUpperCase().startsWith(root.toUpperCase()) : target.startsWith(root);
      if (!inside) continue;
      const prefix = target.length > root.length ? target.substring(root.length).replace(/\\/g, '/') : '';
      return { alias, prefix };
    }
    return null;
  }

  private samples(method: string, rest: readonly string[], query: URLSearchParams, headers: Readonly<Record<string, string | undefined>>): ConsoleAnswer {
    const source = samplesSource();
    if (rest.length === 0 && method === 'GET') {
      const language = normalizeLanguage(query.get('lang')) ?? normalizeLanguage(headers['accept-language']);
      const target = this.aliasOfSamples();
      const folder = path.join(this.data.reportsPath, SAMPLE_REPORTS_FOLDER);
      const items = (source === null ? [] : loadSamples(source, language)).map((s) => ({
        file: s.file,
        title: s.title,
        description: s.description,
        thumbnail: s.thumbnail === null ? null : '/api/reports/samples/thumbnails/' + encodeURIComponent(path.basename(s.thumbnail)),
        path: target === null ? null : target.prefix + s.file,
        installed: target !== null && existsSync(path.join(folder, s.file)),
        prompt: s.prompt,
      }));
      return ok({ alias: target?.alias ?? null, canDesign: false, canInstall: source !== null, items });
    }
    if (rest.length === 2 && rest[0]!.toLowerCase() === 'thumbnails' && method === 'GET') {
      const name = rest[1]!;
      if (source === null || name !== path.basename(name) || name.startsWith('.') || !name.toLowerCase().endsWith('.png')) throw new ServerError(404, 'Not found.');
      const file = path.join(source, 'thumbnails', name);
      if (!existsSync(file)) throw new ServerError(404, 'Not found.');
      return { status: 200, bytes: new Uint8Array(readFileSync(file)), contentType: 'image/png', cacheControl: 'public, max-age=86400' };
    }
    throw new ServerError(404, 'Not found.');
  }
}
