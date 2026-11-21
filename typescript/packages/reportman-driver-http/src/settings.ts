// The settings of a Reportman AI Agent connection as DatabaseInfo resolves them before it creates the
// executor (Connect): the values the host gives, completed from the section of the connection in the
// connections file (dbxconnections.ini: DbxIniDocument, LoadHttpAgentConnectionParams), then from the
// Reportman AI session of the host (ApplyHttpAgentSession).

import type { ConnectionRequest } from 'reportman-engine';

/** DriverType.HttpAgent. */
export const DRIVER_HTTP_AGENT = 10;

/** DatabaseInfo.HttpAgentBaseUrl by default (a Release build of the C# engine). */
export const DEFAULT_BASE_URL = 'https://aiapi.reportman.es';

/** What an executor needs: HttpAgentExecutor's BaseUrl, ApiKey, Token, InstallId, HubDatabaseId, ConnectionName. */
export interface AgentSettings {
  baseUrl: string;
  apiKey: string;
  token: string;
  installId: string;
  /** The Hub database (a long). */
  hubDatabaseId: bigint;
  /** The report connection (alias), for the errors that name it. */
  connectionName: string;
}

/** C# string.IsNullOrWhiteSpace. */
export function isBlank(value: string | null | undefined): boolean {
  return value === null || value === undefined || value.trim().length === 0;
}

// ---------------------------------------------------------------------------------------------
// DbxIniDocument (reading)

/** A connections file: the sections in their order, a repeated name each time. */
export class IniDocument {
  private readonly lines: string[];

  constructor(text: string) {
    this.lines = text.split(/\r\n|\n|\r/);
  }

  private static header(text: string): string | undefined {
    const t = text.trim();
    if (t.length >= 2 && t.charAt(0) === '[' && t.charAt(t.length - 1) === ']') return t.substring(1, t.length - 1).trim();
    return undefined;
  }

  private static keyOf(text: string): string | undefined {
    const t = text.trim();
    if (t.length === 0 || t.charAt(0) === ';' || t.charAt(0) === '#' || t.charAt(0) === '[') return undefined;
    const eq = t.indexOf('=');
    return eq > 0 ? t.substring(0, eq).trim() : undefined;
  }

  /** GetValue: the trimmed value of `key` in the first section `section` (neither depends on the case). */
  getValue(section: string, key: string, defaultValue: string): string {
    const wanted = section.trim().toUpperCase();
    let start = -1;
    for (let i = 0; i < this.lines.length; i++) {
      const name = IniDocument.header(this.lines[i]!);
      if (name !== undefined && name.toUpperCase() === wanted) {
        start = i;
        break;
      }
    }
    if (start < 0) return defaultValue;
    const k = key.toUpperCase();
    for (let i = start + 1; i < this.lines.length; i++) {
      const line = this.lines[i]!;
      if (IniDocument.header(line) !== undefined) break;
      if (IniDocument.keyOf(line)?.toUpperCase() === k) {
        const t = line.trim();
        return t.substring(t.indexOf('=') + 1).trim();
      }
    }
    return defaultValue;
  }
}

/** ReadInt64: Int64.TryParse(NumberStyles.Integer, invariant) of the value, or the default. */
export function readInt64(value: string, defaultValue: bigint): bigint {
  if (isBlank(value)) return defaultValue;
  const m = /^[\t\n\v\f\r ]*([+-]?)(\d+)[\t\n\v\f\r \0]*$/.exec(value.trim());
  if (m === null) return defaultValue;
  const v = BigInt(m[1] + m[2]);
  if (v < -9223372036854775808n || v > 9223372036854775807n) return defaultValue;
  return v;
}

/** The names of the Agent in the DriverName of a connections file (IsHttpAgentDriverName). */
export function isAgentDriverName(name: string): boolean {
  const n = name.toLowerCase();
  return n === 'reportman ai agent' || n === 'reportman agent' || n === 'http agent' || n === 'httpagent';
}

// ---------------------------------------------------------------------------------------------

/** The values a host sets on a DatabaseInfo before it runs the report (they win over the connections file). */
export interface HostValues {
  baseUrl?: string;
  apiKey?: string;
  token?: string;
  installId?: string;
  hubDatabaseId?: number | bigint;
}

/** The Reportman AI session of the host (DatabaseInfo.HttpAgentSessionToken / HttpAgentSessionInstallId). */
export interface AgentSession {
  /** The Bearer token of the session, or "" without one. */
  token: () => string;
  /** The install id the token is bound to. */
  installId?: () => string;
}

/**
 * The settings of the connection of `request`: the host values (DatabaseInfo's properties, the default
 * base URL otherwise); when the report connection loads its parameters (LoadParams) and the connections
 * file has its section, the API key, Hub database and token it lacks and the URL of the file (Url, or
 * HttpAgentBaseUrl), which always wins; without an API key or a token, the session of the host.
 */
export function resolveSettings(
  request: ConnectionRequest,
  host: HostValues,
  ini: IniDocument | undefined,
  session: AgentSession | undefined,
): AgentSettings {
  const alias = request.alias;
  let baseUrl = host.baseUrl ?? DEFAULT_BASE_URL;
  let apiKey = host.apiKey ?? '';
  let token = host.token ?? '';
  let installId = host.installId ?? '';
  let hubDatabaseId = host.hubDatabaseId === undefined ? 0n : BigInt(host.hubDatabaseId);
  // LoadHttpAgentConnectionParams
  if (request.database.loadParams && !isBlank(alias) && ini !== undefined) {
    const iniKey = ini.getValue(alias, 'ApiKey', '').trim();
    const iniToken = ini.getValue(alias, 'Token', '').trim();
    let iniUrl = ini.getValue(alias, 'Url', '').trim();
    if (isBlank(iniUrl)) iniUrl = ini.getValue(alias, 'HttpAgentBaseUrl', '').trim();
    if (isBlank(apiKey) && !isBlank(iniKey)) apiKey = iniKey;
    if (hubDatabaseId === 0n) hubDatabaseId = readInt64(ini.getValue(alias, 'HubDatabaseId', ''), 0n);
    if (!isBlank(iniUrl)) baseUrl = iniUrl;
    if (isBlank(token) && isBlank(apiKey) && !isBlank(iniToken)) token = iniToken;
  }
  // ApplyHttpAgentSession
  if (isBlank(apiKey) && isBlank(token) && session !== undefined) {
    const sessionToken = session.token();
    if (!isBlank(sessionToken)) {
      token = sessionToken;
      const sessionInstall = session.installId?.() ?? '';
      if (!isBlank(sessionInstall)) installId = sessionInstall;
    }
  }
  return { baseUrl, apiKey, token, installId, hubDatabaseId, connectionName: alias };
}

/**
 * Whether the connections file makes this report connection an Agent one (ResolveHttpAgentDriverFromConfig):
 * the driver of the report, or a DriverName of the Agent in its section.
 */
export function isAgentConnection(request: ConnectionRequest, ini: IniDocument | undefined): boolean {
  if (request.database.driver === DRIVER_HTTP_AGENT) return true;
  if (!request.database.loadParams || isBlank(request.alias) || ini === undefined) return false;
  return isAgentDriverName(ini.getValue(request.alias, 'DriverName', '').trim());
}
