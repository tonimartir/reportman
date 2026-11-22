// The connections of the server: the sections of dbxconnections.ini in its data folder, read and
// written as Reportman.Server does (ConnectionsStore), so the file is the one the Delphi and C#
// designers read. A direct section names an ADO.NET provider (SQLiteCore, PostgreSQL...) and keeps
// the parameters of its connection string builder (Param.Name=value) with the string built from
// them; here each provider is opened with the JavaScript driver of its database. An Agent section
// (DriverName=Reportman AI Agent) reaches a database behind a Reportman DB Agent through the Hub.

import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { probeConnection, sqlite, type ConnectionFactory, type DbxDrivers } from '@reportman/node';
import { writeAtomic } from './data.js';
import { ServerError } from './store.js';

/** The drivers the server opens connections with; SQLite is built in (node:sqlite). */
export interface ServerDrivers extends DbxDrivers {
  /** The Reportman AI Agent connections (reportmanAgent of @reportman/driver-http). */
  agent?: (settings: { hubDatabaseId: number; apiKey?: string }) => ConnectionFactory;
}

/** One section of dbxconnections.ini (ConnectionDefinition). */
export interface ConnectionDefinition {
  alias: string;
  kind: 'agent' | 'direct';
  hubDatabaseId: number | null;
  apiKey: string | null;
  providerFactory: string | null;
  /** What the driver opens: built from the parameters when there are any. */
  connectionString: string | null;
  /** The parameters of the provider by their builder names (Param.Name in the file). */
  parameters: Record<string, string>;
  /** The other keys of the section, kept as they are. */
  extra: Record<string, string>;
}

/** A parameter of a provider, as the connections page shows it (ConnectionParameterInfo). */
export interface ConnectionParameterInfo {
  /** The name of the property of the provider's connection string builder: the stored key. */
  name: string;
  type: 'string' | 'int' | 'bool' | 'enum';
  enumValues?: Record<string, number>;
  defaultValue: string | null;
  isPassword: boolean;
  /** Shown by default; the rest under "show all". */
  isMain: boolean;
  description: string | null;
}

type DriverKind = 'sqlite' | 'postgresql' | 'firebird' | 'mysql' | 'sqlserver';

interface ParameterSpec {
  name: string;
  /** The keyword of the connection string. */
  keyword: string;
  type?: 'string' | 'int' | 'bool' | 'enum';
  values?: readonly string[];
  /** The numbers of the enum names when they are not 0, 1, 2... */
  numbers?: readonly number[];
  defaultValue?: string;
  main?: boolean;
  description?: string;
  /** Other keywords of a legacy connection string that mean this parameter. */
  synonyms?: readonly string[];
}

interface ProviderSpec {
  name: string;
  label: string;
  kind: DriverKind;
  sample: string;
  /** The query of a connection test; its answer is the version of the server. */
  versionSql: string;
  parameters: readonly ParameterSpec[];
}

// The providers of Reportman.Server (DirectProviders) the JavaScript drivers open, with the main
// parameters of its connections page (ConnectionParameters.MainParameters) and a few others the
// drivers read. The names are the ones of the .NET builders, so the file stays the same for both.
const PROVIDERS: readonly ProviderSpec[] = [
  {
    name: 'SQLiteCore',
    label: 'SQLite',
    kind: 'sqlite',
    sample: 'Data Source=/data/base.db',
    versionSql: 'select sqlite_version()',
    parameters: [
      { name: 'DataSource', keyword: 'Data Source', main: true, description: 'The database file; relative to the data folder of the server.', synonyms: ['filename', 'datasource'] },
      { name: 'Mode', keyword: 'Mode', type: 'enum', values: ['ReadWriteCreate', 'ReadWrite', 'ReadOnly', 'Memory'], defaultValue: 'ReadWriteCreate', main: true, description: 'Reports only read: ReadOnly is the safe choice.' },
      { name: 'Password', keyword: 'Password', main: true, description: 'Encrypted databases (SQLCipher) are not supported by node:sqlite.' },
      { name: 'Cache', keyword: 'Cache', type: 'enum', values: ['Default', 'Private', 'Shared'], defaultValue: 'Default', main: true },
    ],
  },
  {
    name: 'PostgreSQL',
    label: 'PostgreSQL',
    kind: 'postgresql',
    sample: 'Host=localhost;Port=5432;Database=base;Username=postgres;Password=secret',
    versionSql: "select current_setting('server_version')",
    parameters: [
      { name: 'Host', keyword: 'Host', main: true, synonyms: ['server'] },
      { name: 'Port', keyword: 'Port', type: 'int', defaultValue: '5432', main: true },
      { name: 'Database', keyword: 'Database', main: true, synonyms: ['db'] },
      { name: 'Username', keyword: 'Username', main: true, synonyms: ['user name', 'userid', 'user id', 'uid'] },
      { name: 'Password', keyword: 'Password', main: true, synonyms: ['psw', 'pwd'] },
      { name: 'SslMode', keyword: 'SSL Mode', type: 'enum', values: ['Disable', 'Allow', 'Prefer', 'Require', 'VerifyCA', 'VerifyFull'], defaultValue: 'Prefer', main: true },
      { name: 'TrustServerCertificate', keyword: 'Trust Server Certificate', type: 'bool', defaultValue: 'false' },
      { name: 'Timeout', keyword: 'Timeout', type: 'int', defaultValue: '15', description: 'Seconds to wait for the connection.' },
      { name: 'CommandTimeout', keyword: 'Command Timeout', type: 'int', defaultValue: '30', description: 'Seconds a query may run.' },
      { name: 'ApplicationName', keyword: 'Application Name' },
      { name: 'SearchPath', keyword: 'Search Path' },
    ],
  },
  {
    name: 'FirebirdSql.Data.FirebirdClient',
    label: 'Firebird',
    kind: 'firebird',
    sample: 'DataSource=localhost;Port=3050;Database=/data/base.fdb;User=SYSDBA;Password=masterkey;Charset=UTF8',
    versionSql: "select rdb$get_context('SYSTEM', 'ENGINE_VERSION') from rdb$database",
    parameters: [
      { name: 'DataSource', keyword: 'Data Source', main: true, synonyms: ['server', 'host'] },
      { name: 'Port', keyword: 'Port Number', type: 'int', defaultValue: '3050', main: true, synonyms: ['port'] },
      { name: 'Database', keyword: 'Initial Catalog', main: true, synonyms: ['database'] },
      { name: 'UserID', keyword: 'User ID', main: true, synonyms: ['user', 'user name', 'username'] },
      { name: 'Password', keyword: 'Password', main: true, synonyms: ['user password'] },
      { name: 'Charset', keyword: 'Character Set', defaultValue: 'UTF8', main: true, synonyms: ['charset'] },
      { name: 'ServerType', keyword: 'Server Type', type: 'enum', values: ['Default', 'Embedded'], defaultValue: 'Default', main: true, description: 'Embedded Firebird is not supported by the JavaScript driver.' },
      { name: 'Role', keyword: 'Role Name', synonyms: ['role'] },
      { name: 'Dialect', keyword: 'Dialect', type: 'int', defaultValue: '3' },
      { name: 'ConnectionTimeout', keyword: 'Connection Timeout', type: 'int', defaultValue: '15' },
      { name: 'WireCrypt', keyword: 'Wire Crypt', type: 'enum', values: ['Disabled', 'Enabled', 'Required'], defaultValue: 'Enabled' },
    ],
  },
  {
    name: 'MySQLConnector',
    label: 'MySQL / MariaDB',
    kind: 'mysql',
    sample: 'Server=localhost;Port=3306;Database=base;User=root;Password=secret',
    versionSql: 'select version()',
    parameters: [
      { name: 'Server', keyword: 'Server', main: true, synonyms: ['host', 'data source', 'datasource', 'address'] },
      { name: 'Port', keyword: 'Port', type: 'int', defaultValue: '3306', main: true },
      { name: 'Database', keyword: 'Database', main: true, synonyms: ['initial catalog'] },
      { name: 'UserID', keyword: 'User ID', main: true, synonyms: ['username', 'uid', 'user name', 'user'] },
      { name: 'Password', keyword: 'Password', main: true, synonyms: ['pwd'] },
      { name: 'SslMode', keyword: 'SSL Mode', type: 'enum', values: ['None', 'Preferred', 'Required', 'VerifyCA', 'VerifyFull'], defaultValue: 'Preferred', main: true },
      { name: 'ConnectionTimeout', keyword: 'Connection Timeout', type: 'int', defaultValue: '15', synonyms: ['connect timeout'] },
      { name: 'DefaultCommandTimeout', keyword: 'Default Command Timeout', type: 'int', defaultValue: '30', synonyms: ['command timeout'] },
      { name: 'CharacterSet', keyword: 'Character Set', synonyms: ['charset'] },
      { name: 'AllowPublicKeyRetrieval', keyword: 'Allow Public Key Retrieval', type: 'bool', defaultValue: 'false' },
      { name: 'ApplicationName', keyword: 'Application Name' },
    ],
  },
  {
    name: 'SQLServer',
    label: 'SQL Server',
    kind: 'sqlserver',
    sample: 'Server=localhost;Database=base;User Id=sa;Password=secret;TrustServerCertificate=True',
    versionSql: "select cast(serverproperty('ProductVersion') as nvarchar(128))",
    parameters: [
      { name: 'DataSource', keyword: 'Data Source', main: true, synonyms: ['server', 'address', 'addr', 'network address'] },
      { name: 'InitialCatalog', keyword: 'Initial Catalog', main: true, synonyms: ['database'] },
      { name: 'UserID', keyword: 'User ID', main: true, synonyms: ['uid', 'user'] },
      { name: 'Password', keyword: 'Password', main: true, synonyms: ['pwd'] },
      { name: 'IntegratedSecurity', keyword: 'Integrated Security', type: 'bool', defaultValue: 'false', main: true, description: 'Windows authentication is not supported by the JavaScript driver.', synonyms: ['trusted_connection'] },
      { name: 'Encrypt', keyword: 'Encrypt', type: 'enum', values: ['Optional', 'Mandatory', 'Strict'], defaultValue: 'Mandatory', main: true },
      { name: 'TrustServerCertificate', keyword: 'Trust Server Certificate', type: 'bool', defaultValue: 'false', main: true },
      { name: 'ConnectTimeout', keyword: 'Connect Timeout', type: 'int', defaultValue: '15', synonyms: ['connection timeout', 'timeout'] },
      { name: 'CommandTimeout', keyword: 'Command Timeout', type: 'int', defaultValue: '30' },
      { name: 'ApplicationName', keyword: 'Application Name', synonyms: ['app'] },
      { name: 'MultipleActiveResultSets', keyword: 'Multiple Active Result Sets', type: 'bool', defaultValue: 'false' },
    ],
  },
];

const AGENT_DRIVER_NAME = 'Reportman AI Agent';
const DIRECT_DRIVER_NAME = 'ADO.NET';
const sameText = (a: string, b: string): boolean => a.toUpperCase() === b.toUpperCase();
const squeeze = (s: string): string => s.toLowerCase().replace(/[\s_]/g, '');

/** Whether a parameter is a password (ConnectionParameters.IsPasswordName). */
export function isPasswordName(name: string): boolean {
  return name.toLowerCase().includes('password') || name.toLowerCase() === 'pwd';
}

/** The spec of a provider by its name (any case), or undefined. */
function providerSpec(name: string | null | undefined): ProviderSpec | undefined {
  return name === null || name === undefined ? undefined : PROVIDERS.find((p) => sameText(p.name, name.trim()));
}

/** The spec of a parameter by its name, keyword or a synonym. */
function parameterSpec(provider: ProviderSpec, name: string): ParameterSpec | undefined {
  const k = squeeze(name);
  return provider.parameters.find((p) => squeeze(p.name) === k || squeeze(p.keyword) === k || (p.synonyms ?? []).some((s) => squeeze(s) === k));
}

// ---- connection strings ----

/** A connection string as its keywords and values, in order (DbConnectionStringBuilder). */
export function parseConnectionString(text: string): [string, string][] {
  const pairs: [string, string][] = [];
  let i = 0;
  while (i < text.length) {
    while (i < text.length && (text[i] === ';' || text[i] === ' ')) i++;
    const eq = text.indexOf('=', i);
    if (eq < 0) break;
    const key = text.substring(i, eq).trim();
    i = eq + 1;
    while (i < text.length && text[i] === ' ') i++;
    let value = '';
    const q = text[i];
    if (q === '"' || q === "'") {
      i++;
      while (i < text.length) {
        if (text[i] === q) {
          if (text[i + 1] === q) {
            value += q;
            i += 2;
            continue;
          }
          i++;
          break;
        }
        value += text[i++];
      }
      while (i < text.length && text[i] !== ';') i++;
    } else {
      const end = text.indexOf(';', i);
      value = text.substring(i, end < 0 ? text.length : end).trim();
      i = end < 0 ? text.length : end;
    }
    if (key.length > 0) pairs.push([key, value]);
  }
  return pairs;
}

function quoteValue(value: string): string {
  if (!/[;'"=]|^\s|\s$/.test(value)) return value;
  return value.includes('"') ? "'" + value.replace(/'/g, "''") + "'" : '"' + value + '"';
}

function parseBool(text: string, name: string): boolean {
  switch (text.trim().toLowerCase()) {
    case 'true':
    case '1':
    case 'yes':
    case 'on':
    case 'sí':
    case 'si':
      return true;
    case 'false':
    case '0':
    case 'no':
    case 'off':
      return false;
    default:
      throw new ServerError(400, `${name}: '${text}' is not a boolean`);
  }
}

/**
 * The connection string of the parameters (ConnectionParameters.Build): each value checked by its
 * type and written with its keyword; an empty value leaves the driver's default.
 */
export function buildConnectionString(providerName: string, parameters: Readonly<Record<string, string>>): string {
  const provider = providerSpec(providerName);
  if (provider === undefined) throw new ServerError(400, `Provider ${providerName} is not supported by this server.`);
  const pairs: string[] = [];
  // In the order of the provider's parameters, as a builder writes them; the others after them
  const rank = (name: string): number => {
    const spec = parameterSpec(provider, name);
    return spec === undefined ? provider.parameters.length : provider.parameters.indexOf(spec);
  };
  const entries = Object.entries(parameters).sort((a, b) => rank(a[0]) - rank(b[0]));
  for (const [name, raw] of entries) {
    const value = (raw ?? '').trim();
    if (value.length === 0) continue;
    const spec = parameterSpec(provider, name);
    if (spec === undefined) {
      // A keyword the page does not describe goes as it is: the driver says whether it knows it
      pairs.push(name + '=' + quoteValue(value));
      continue;
    }
    let text = value;
    if (spec.type === 'int') {
      if (!/^-?\d+$/.test(value)) throw new ServerError(400, `${spec.name}: '${value}' is not a whole number`);
    } else if (spec.type === 'bool') {
      text = parseBool(value, spec.name) ? 'True' : 'False';
    } else if (spec.type === 'enum') {
      const found = spec.values!.find((v) => sameText(v, value));
      if (found === undefined) throw new ServerError(400, `${spec.name}: '${value}' is not one of ${spec.values!.join(', ')}`);
      text = found;
    }
    pairs.push(spec.keyword + '=' + quoteValue(text));
  }
  return pairs.join(';');
}

/** The parameters of a legacy connection string, by the builder names when known (ConnectionParameters.Parse). */
export function connectionStringParameters(providerName: string, connectionString: string): Record<string, string> {
  const provider = providerSpec(providerName);
  const result: Record<string, string> = {};
  for (const [keyword, value] of parseConnectionString(connectionString)) {
    if (value.length === 0) continue;
    const spec = provider === undefined ? undefined : parameterSpec(provider, keyword);
    const name = spec?.name ?? keyword;
    if (!(name in result)) result[name] = value;
  }
  return result;
}

/** A connection string with its passwords hidden, for a list (a quoted one too, which may hold a ';'). */
export function maskPasswords(connectionString: string | null): string | null {
  return connectionString === null ? null : connectionString.replace(/(password|pwd)\s*=\s*("(?:[^"]|"")*"|'(?:[^']|'')*'|[^;]*)/gi, '$1=***');
}

// ---- the store ----

/** dbxconnections.ini of a data folder (ConnectionsStore of Reportman.Server). */
export class ConnectionsStore {
  readonly file: string;
  readonly dataPath: string;

  constructor(dataPath: string, file = path.join(dataPath, 'dbxconnections.ini')) {
    this.dataPath = path.resolve(dataPath);
    this.file = file;
  }

  /** The connections in alias order. */
  list(): ConnectionDefinition[] {
    return [...this.parse().values()].sort((a, b) => (a.alias.toUpperCase() < b.alias.toUpperCase() ? -1 : 1));
  }

  get(alias: string): ConnectionDefinition | null {
    return this.parse().get(alias.toUpperCase()) ?? null;
  }

  /** Stores a connection (its alias upper case); an empty key or password keeps the stored one. */
  save(definition: ConnectionDefinition): ConnectionDefinition {
    const alias = definition.alias.trim().toUpperCase();
    if (alias.length === 0 || /[[\]=]/.test(alias)) throw new ServerError(400, 'Invalid alias');
    const all = this.parse();
    const existing = all.get(alias);
    const saved: ConnectionDefinition = { ...definition, alias, parameters: { ...definition.parameters }, extra: { ...definition.extra } };
    if (existing !== undefined) {
      if (saved.apiKey === null || saved.apiKey.length === 0) saved.apiKey = existing.apiKey;
      for (const [k, v] of Object.entries(existing.parameters)) if (isPasswordName(k) && (saved.parameters[k] ?? '').length === 0) saved.parameters[k] = v;
      for (const [k, v] of Object.entries(existing.extra)) if (!(k in saved.extra)) saved.extra[k] = v;
    }
    all.set(alias, saved);
    this.write(all.values());
    return this.get(alias)!;
  }

  /** Removes a connection; false when there is none with that alias. */
  delete(alias: string): boolean {
    const all = this.parse();
    if (!all.delete(alias.toUpperCase())) return false;
    this.write(all.values());
    return true;
  }

  private parse(): Map<string, ConnectionDefinition> {
    const result = new Map<string, ConnectionDefinition>();
    if (!existsSync(this.file)) return result;
    let current: { alias: string; raw: Map<string, [string, string]> } | null = null;
    const flush = (): void => {
      if (current === null) return;
      const get = (key: string): string | undefined => current!.raw.get(key.toLowerCase())?.[1];
      const isAgent = (get('DriverName') ?? '').toLowerCase().includes('agent');
      const id = Number.parseInt(get('HubDatabaseId') ?? '', 10);
      const c: ConnectionDefinition = {
        alias: current.alias,
        kind: isAgent ? 'agent' : 'direct',
        hubDatabaseId: Number.isFinite(id) ? id : null,
        apiKey: get('ApiKey') ?? null,
        providerFactory: get('ProviderFactory') ?? null,
        connectionString: get('ConnectionString') ?? null,
        parameters: {},
        extra: {},
      };
      for (const [lower, [key, value]] of current.raw) {
        if (['drivername', 'hubdatabaseid', 'apikey', 'providerfactory', 'connectionstring'].includes(lower)) continue;
        if (lower.startsWith('param.')) c.parameters[key.substring(6)] = value;
        else c.extra[key] = value;
      }
      // A direct section written by hand has only the string: the page edits it as parameters
      if (c.kind === 'direct' && Object.keys(c.parameters).length === 0 && c.connectionString !== null && c.providerFactory !== null && providerSpec(c.providerFactory) !== undefined)
        c.parameters = connectionStringParameters(c.providerFactory, c.connectionString);
      for (const k of Object.keys(c.parameters)) c.parameters[k] = this.fromPortablePath(c.providerFactory, k, c.parameters[k]!);
      // The string the driver opens is always the one of the parameters
      if (c.kind === 'direct' && Object.keys(c.parameters).length > 0 && providerSpec(c.providerFactory) !== undefined) {
        try {
          c.connectionString = buildConnectionString(c.providerFactory!, c.parameters);
        } catch {
          // keep the string of the file
        }
      }
      result.set(c.alias.toUpperCase(), c);
    };
    for (const rawLine of readFileSync(this.file, 'utf8').replace(/^﻿/, '').split(/\r?\n/)) {
      const line = rawLine.trim();
      if (line.length === 0 || line.startsWith(';') || line.startsWith('#')) continue;
      if (line.startsWith('[') && line.endsWith(']')) {
        flush();
        current = { alias: line.substring(1, line.length - 1).trim(), raw: new Map() };
        continue;
      }
      const eq = line.indexOf('=');
      if (eq <= 0 || current === null) continue;
      const key = line.substring(0, eq).trim();
      current.raw.set(key.toLowerCase(), [key, line.substring(eq + 1).trim()]);
    }
    flush();
    return result;
  }

  private write(connections: Iterable<ConnectionDefinition>): void {
    const lines = [
      '; Reportman connections: one section per alias, the same format the Delphi and C# designers read.',
      '; Managed by Reportman Server; edits by hand are kept.',
    ];
    const sorted = [...connections].sort((a, b) => (a.alias.toUpperCase() < b.alias.toUpperCase() ? -1 : 1));
    for (const c of sorted) {
      lines.push('', `[${c.alias}]`);
      if (c.kind === 'agent') {
        lines.push(`DriverName=${AGENT_DRIVER_NAME}`);
        if (c.hubDatabaseId !== null && c.hubDatabaseId > 0) lines.push(`HubDatabaseId=${c.hubDatabaseId}`);
        if (c.apiKey !== null && c.apiKey.length > 0) lines.push(`ApiKey=${c.apiKey}`);
      } else {
        lines.push(`DriverName=${DIRECT_DRIVER_NAME}`);
        if (c.providerFactory !== null && c.providerFactory.length > 0) lines.push(`ProviderFactory=${c.providerFactory}`);
        for (const k of Object.keys(c.parameters).sort((a, b) => (a.toUpperCase() < b.toUpperCase() ? -1 : 1)))
          if (c.parameters[k]!.length > 0) lines.push(`Param.${k}=${this.toPortablePath(c.parameters[k]!)}`);
        if (c.connectionString !== null && c.connectionString.length > 0) lines.push(`ConnectionString=${c.connectionString}`);
      }
      for (const [k, v] of Object.entries(c.extra)) lines.push(`${k}=${v}`);
    }
    writeAtomic(this.file, lines.join('\n') + '\n');
  }

  // A database file inside the data folder is written relative to it, so the folder can move.

  private toPortablePath(value: string): string {
    if (value.length === 0 || !path.isAbsolute(value)) return value;
    const full = path.resolve(value);
    const root = this.dataPath.endsWith(path.sep) ? this.dataPath : this.dataPath + path.sep;
    const inside = process.platform === 'win32' ? full.toUpperCase().startsWith(root.toUpperCase()) : full.startsWith(root);
    return inside ? full.substring(root.length).replace(/\\/g, '/') : value;
  }

  /** A relative value naming a file of the data folder → its absolute path (always for a SQLite data source). */
  fromPortablePath(provider: string | null, name: string, value: string): string {
    if (value.length === 0 || path.isAbsolute(value) || value.includes('=')) return value;
    const isSqliteFile =
      provider !== null && sameText(provider, 'SQLiteCore') && sameText(name, 'DataSource') && !value.startsWith(':') && !value.toLowerCase().startsWith('file:');
    const full = path.resolve(this.dataPath, value);
    return isSqliteFile || existsSync(full) ? full : value;
  }

  /** The parameters as the server opens them: relative files of the data folder made absolute. */
  resolve(provider: string | null, parameters: Readonly<Record<string, string>>): Record<string, string> {
    const result: Record<string, string> = {};
    for (const [k, v] of Object.entries(parameters)) result[k] = this.fromPortablePath(provider, k, v);
    return result;
  }
}

// ---- providers, factories and tests ----

/** The providers the server can open with the drivers it has: SQLite always. */
export function availableProviders(drivers: ServerDrivers): { name: string; label: string; sample: string }[] {
  return PROVIDERS.filter((p) => p.kind === 'sqlite' || drivers[p.kind] !== undefined).map((p) => ({ name: p.name, label: p.label, sample: p.sample }));
}

/** The parameters of a provider: the main ones first, in their order, then the rest by name. */
export function describeProvider(name: string): ConnectionParameterInfo[] {
  const provider = providerSpec(name);
  if (provider === undefined) throw new ServerError(400, `Provider ${name} is not supported by this server.`);
  const info = provider.parameters.map((p, i) => ({
    order: i,
    info: {
      name: p.name,
      type: p.type ?? 'string',
      ...(p.type === 'enum' ? { enumValues: Object.fromEntries(p.values!.map((v, j) => [v, p.numbers?.[j] ?? j])) } : {}),
      defaultValue: p.defaultValue ?? null,
      isPassword: isPasswordName(p.name),
      isMain: p.main === true,
      description: p.description ?? null,
    } satisfies ConnectionParameterInfo,
  }));
  return info
    .sort((a, b) => (a.info.isMain !== b.info.isMain ? (a.info.isMain ? -1 : 1) : a.info.isMain ? a.order - b.order : a.info.name.toUpperCase() < b.info.name.toUpperCase() ? -1 : 1))
    .map((x) => x.info);
}

/** A parameter of a definition by name, in any case. */
function param(c: ConnectionDefinition, name: string): string {
  const k = Object.keys(c.parameters).find((p) => sameText(p, name));
  return k === undefined ? '' : c.parameters[k]!.trim();
}

/** The factory of a direct connection, or an error that says why it cannot be opened here. */
function directFactory(c: ConnectionDefinition, drivers: ServerDrivers): ConnectionFactory {
  const provider = providerSpec(c.providerFactory);
  if (provider === undefined) throw new ServerError(400, `Provider ${c.providerFactory ?? '(none)'} is not supported by this server.`);
  if (provider.kind === 'sqlite') {
    if (param(c, 'Password').length > 0) throw new ServerError(400, 'Encrypted SQLite databases (Password) are not supported by node:sqlite.');
    const mode = param(c, 'Mode').toLowerCase();
    let file = param(c, 'DataSource');
    if (file.length === 0 && mode === 'memory') file = ':memory:';
    if (file.length === 0) throw new ServerError(400, 'The SQLite connection needs its DataSource (the database file).');
    // Opening ReadWriteCreate would create a mistyped file empty, and the test would pass
    if (file !== ':memory:' && !file.toLowerCase().startsWith('file:') && mode !== 'readwritecreate' && !existsSync(file))
      throw new ServerError(400, 'The database file does not exist: ' + file, { code: 'FileNotFound' });
    return sqlite(file, { readOnly: mode !== 'readwrite' && mode !== 'readwritecreate' });
  }
  if (provider.kind === 'sqlserver' && /^(true|yes|sspi)$/i.test(param(c, 'IntegratedSecurity')))
    throw new ServerError(400, 'Windows authentication (IntegratedSecurity) is not supported by the JavaScript driver of SQL Server.');
  if (provider.kind === 'firebird' && sameText(param(c, 'ServerType'), 'Embedded'))
    throw new ServerError(400, 'Embedded Firebird (ServerType=Embedded) is not supported by the JavaScript driver.');
  const driver = drivers[provider.kind];
  if (driver === undefined)
    throw new ServerError(400, `There is no driver for ${provider.label} on this server: install @reportman/driver-${provider.kind === 'postgresql' ? 'postgres' : provider.kind === 'sqlserver' ? 'mssql' : provider.kind}.`);
  return driver(c.connectionString ?? '');
}

/** The factory of a connection, or an error that says why it cannot be opened here. */
export function connectionFactory(c: ConnectionDefinition, drivers: ServerDrivers): ConnectionFactory {
  if (c.kind === 'direct') return directFactory(c, drivers);
  if (c.hubDatabaseId === null || c.hubDatabaseId <= 0) throw new ServerError(400, 'An Agent connection needs the Hub database it reaches.', { code: 'HubDatabaseRequired' });
  if (drivers.agent === undefined) throw new ServerError(400, 'There is no driver for the Reportman AI Agent on this server: install @reportman/driver-http.');
  return drivers.agent({ hubDatabaseId: c.hubDatabaseId, ...(c.apiKey !== null && c.apiKey.length > 0 ? { apiKey: c.apiKey } : {}) });
}

/** The factories of every connection that can be opened here, by alias. */
export function connectionFactories(store: ConnectionsStore, drivers: ServerDrivers): Record<string, ConnectionFactory> {
  const result: Record<string, ConnectionFactory> = {};
  for (const c of store.list()) {
    try {
      result[c.alias] = connectionFactory(c, drivers);
    } catch {
      // a connection this server cannot open: the report that uses it says so when it runs
    }
  }
  return result;
}

/** The result of a connection test, as Reportman.Server answers it. */
export interface ConnectionTestResult {
  ok: boolean;
  message: string;
  code?: string;
  serverVersion?: string;
  status?: number;
}

/** Options of a test of an Agent connection: the Hub API (aiapi.reportman.es by default). */
export interface AgentTestOptions {
  apiUrl?: string;
  fetch?: typeof fetch;
}

/** Opens a connection and asks the version of its server; an Agent one is tested by the Hub, as the designers do. */
export async function testConnection(c: ConnectionDefinition, drivers: ServerDrivers, agent: AgentTestOptions = {}): Promise<ConnectionTestResult> {
  try {
    if (c.kind === 'agent') return await testAgent(c, agent);
    const factory = directFactory(c, drivers);
    const provider = providerSpec(c.providerFactory)!;
    const version = await probeConnection(factory, {
      alias: c.alias,
      providerFactory: c.providerFactory ?? '',
      connectionString: c.connectionString ?? '',
      sql: provider.versionSql,
    });
    return { ok: true, message: 'Connected', serverVersion: version };
  } catch (e) {
    const code = e instanceof ServerError && typeof e.extra.code === 'string' ? e.extra.code : undefined;
    return { ok: false, message: e instanceof Error ? e.message : String(e), ...(code !== undefined ? { code } : {}) };
  }
}

async function testAgent(c: ConnectionDefinition, options: AgentTestOptions): Promise<ConnectionTestResult> {
  if (c.hubDatabaseId === null || c.hubDatabaseId <= 0) return { ok: false, code: 'HubDatabaseRequired', message: 'HubDatabaseId is required' };
  const headers: Record<string, string> = { 'content-type': 'application/json' };
  if (c.apiKey !== null && c.apiKey.length > 0) headers['X-Reportman-ApiKey'] = c.apiKey;
  const base = (options.apiUrl ?? 'https://aiapi.reportman.es').replace(/\/+$/, '');
  const reply = await (options.fetch ?? fetch)(base + '/api/agent/testconnection', {
    method: 'POST',
    headers,
    body: JSON.stringify({ hubDatabaseId: c.hubDatabaseId }),
  });
  const body = await reply.text();
  return { ok: reply.ok && cloudSaysSuccess(body), status: reply.status, message: cloudMessage(body) };
}

/** The cloud answers { success, data: { message, databaseError }, error }: the human part. */
function cloudMessage(body: string): string {
  const trim = body.length > 400 ? body.substring(0, 400) : body;
  try {
    const root = JSON.parse(body) as unknown;
    if (root === null || typeof root !== 'object' || Array.isArray(root)) return trim;
    const o = root as Record<string, unknown>;
    if (typeof o.error === 'string') return o.error;
    const data = o.data;
    if (data !== null && typeof data === 'object') {
      const d = data as Record<string, unknown>;
      if (typeof d.databaseError === 'string') return d.databaseError;
      if (typeof d.message === 'string') return d.message;
    }
    if (typeof o.message === 'string') return o.message;
    return trim;
  } catch {
    return trim;
  }
}

function cloudSaysSuccess(body: string): boolean {
  try {
    const root = JSON.parse(body) as unknown;
    if (root === null || typeof root !== 'object' || Array.isArray(root)) return true;
    const o = root as Record<string, unknown>;
    const data = o.data as Record<string, unknown> | undefined;
    if (data !== null && typeof data === 'object' && data.databaseConnectionSuccess === false) return false;
    return o.success !== false;
  } catch {
    return true;
  }
}
