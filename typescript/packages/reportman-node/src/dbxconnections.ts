// The connections of this computer in the shared dbxconnections.ini (port of DbxDirectConnections
// and DbxIniDocument of the C# engine): the sections with DriverName=ADO.NET that Reportman.Server,
// the Reportman AI Desktop and chat write. The C# engine opens one when a report connection keeps
// only its alias (a report of the Delphi engine converted, for example); here the host asks for
// them with dbxConnections() and passes them as its connections, so the rule of @reportman/node
// holds: only the connections the host gives are opened.

import { existsSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import path from 'node:path';
import type { ConnectionFactory } from './host.js';
import { sqlite } from './sqlite.js';

/** A DriverName=ADO.NET section of dbxconnections.ini. */
export interface DbxDirectConnection {
  /** The name of the section: the alias of the connection. */
  alias: string;
  /** ProviderFactory: SQLiteCore, PostgreSQL, FirebirdSql.Data.FirebirdClient, MySQLConnector, SQLServer... */
  providerFactory: string;
  /** ConnectionString, without the password. */
  connectionString: string;
  /** Param.Name=value: the properties of the provider's connection string builder. */
  parameters: Record<string, string>;
  /** Secret.Name=dpapi:...: passwords ciphered with Windows DPAPI for the user that saved them. */
  secrets: Record<string, string>;
  /** The file it was read from. */
  fileName: string;
}

/**
 * The places of the shared file, in the order of the designers (DbxDirectConnections.Candidates):
 * %PUBLIC%, C:\Users\Public, the common application data and the folder of the program.
 */
export function dbxConnectionsCandidates(): string[] {
  const result: string[] = [];
  const add = (dir: string | undefined): void => {
    if (dir !== undefined && dir.trim().length > 0) result.push(path.join(dir, 'dbxconnections.ini'));
  };
  if (process.platform === 'win32') {
    add(process.env.PUBLIC);
    if (process.env.SystemDrive) add(path.join(process.env.SystemDrive + path.sep, 'Users', 'Public'));
    add(process.env.ProgramData);
  } else {
    // Environment.SpecialFolder.CommonApplicationData of .NET outside Windows
    add('/usr/share');
    add(path.join(homedir(), '.config'));
  }
  add(path.dirname(process.argv[1] ?? process.cwd()));
  return result;
}

/** The shared file there is, or '' when there is none. */
export function dbxConnectionsPath(): string {
  return dbxConnectionsCandidates().find((f) => existsSync(f)) ?? '';
}

/** The text of the file by the rule of DbxIniDocument: UTF-8 after a BOM, otherwise ANSI on Windows and UTF-8 elsewhere. */
function iniText(bytes: Uint8Array): string {
  if (bytes.length >= 3 && bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) return new TextDecoder('utf-8').decode(bytes.subarray(3));
  return new TextDecoder(process.platform === 'win32' ? 'windows-1252' : 'utf-8').decode(bytes);
}

const PARAM = 'param.';
const SECRET = 'secret.';

/** The DriverName=ADO.NET sections of a file (the shared one by default), in its order. */
export function readDbxDirectConnections(file?: string): DbxDirectConnection[] {
  const fileName = file ?? dbxConnectionsPath();
  if (fileName === '' || !existsSync(fileName)) return [];
  const result: DbxDirectConnection[] = [];
  let current: DbxDirectConnection | null = null;
  let direct = false;
  const close = (): void => {
    if (current !== null && direct) result.push(current);
  };
  for (const line of iniText(new Uint8Array(readFileSync(fileName))).split(/\r\n|\n|\r/)) {
    const t = line.trim();
    if (t.startsWith('[') && t.endsWith(']')) {
      close();
      current = { alias: t.substring(1, t.length - 1).trim(), providerFactory: '', connectionString: '', parameters: {}, secrets: {}, fileName };
      direct = false;
      continue;
    }
    // A comment, a header or a line without a key before '='
    if (current === null || t.length === 0 || t[0] === ';' || t[0] === '#') continue;
    const eq = t.indexOf('=');
    if (eq <= 0) continue;
    const key = t.substring(0, eq).trim();
    const value = t.substring(eq + 1).trim();
    const lower = key.toLowerCase();
    if (lower === 'drivername') direct = value.toLowerCase() === 'ado.net';
    else if (lower === 'providerfactory') current.providerFactory = value;
    else if (lower === 'connectionstring') current.connectionString = value;
    else if (lower.startsWith(PARAM)) current.parameters[key.substring(PARAM.length)] = value;
    else if (lower.startsWith(SECRET)) current.secrets[key.substring(SECRET.length)] = value;
  }
  close();
  return result;
}

/** Whether a parameter is a password (DbxDirectConnections.IsPasswordName). */
function isPasswordName(name: string): boolean {
  const n = name.toLowerCase();
  return n.includes('password') || n === 'pwd';
}

/** A connection string as an ordered list of keyword and value (DbConnectionStringBuilder). */
function parseConnectionString(text: string): [string, string][] {
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

function writeConnectionString(pairs: [string, string][]): string {
  return pairs.map(([k, v]) => k + '=' + quoteValue(v)).join(';');
}

// The builder property names of the Param.* (DataSource, UserID...) as connection string keywords
const KEYWORDS: Record<string, string> = {
  datasource: 'Data Source',
  userid: 'User ID',
  initialcatalog: 'Initial Catalog',
  integratedsecurity: 'Integrated Security',
  trustservercertificate: 'Trust Server Certificate',
  connecttimeout: 'Connect Timeout',
  connectiontimeout: 'Connect Timeout',
  commandtimeout: 'Command Timeout',
  sslmode: 'SSL Mode',
  applicationname: 'Application Name',
};

const has = (pairs: [string, string][], key: string): boolean => {
  const k = key.toLowerCase();
  const synonyms = k === 'password' || k === 'pwd' ? ['password', 'pwd'] : [k];
  return pairs.some(([p]) => synonyms.includes(p.toLowerCase()));
};

function setPassword(pairs: [string, string][], key: string, value: string): void {
  const k = key.toLowerCase();
  // One password in the string: «pwd» and «password» are the same keyword
  const synonyms = k === 'password' || k === 'pwd' ? ['password', 'pwd'] : [k];
  for (let i = pairs.length - 1; i >= 0; i--) if (synonyms.includes(pairs[i]![0].toLowerCase())) pairs.splice(i, 1);
  pairs.push([key, value]);
}

/**
 * DbxDirectConnections.BuildConnectionString: the ConnectionString of the section (or, without one,
 * its Param.*), with the password another program wrote in clear when the string does not have it,
 * and the ciphered ones (DPAPI, which JavaScript cannot decipher) asked to `password` (undefined:
 * left out).
 */
export function dbxConnectionString(connection: DbxDirectConnection, password?: (alias: string, name: string) => string | undefined): string {
  let text = connection.connectionString;
  if (text.trim().length === 0) {
    const pairs: [string, string][] = Object.entries(connection.parameters).map(([k, v]) => [KEYWORDS[k.toLowerCase()] ?? k, v]);
    text = writeConnectionString(pairs);
  }
  const clear = Object.entries(connection.parameters).filter(([k, v]) => isPasswordName(k) && v.length > 0);
  const secrets = Object.keys(connection.secrets);
  if (clear.length === 0 && secrets.length === 0) return text;
  const pairs = parseConnectionString(text);
  let changed = false;
  for (const [k, v] of clear) {
    if (has(pairs, k)) continue;
    setPassword(pairs, k, v);
    changed = true;
  }
  for (const name of secrets) {
    const value = password?.(connection.alias, name);
    if (value === undefined) continue;
    setPassword(pairs, name, value);
    changed = true;
  }
  return changed ? writeConnectionString(pairs) : text;
}

/** The driver of a connection string: a driver package's function (postgres, firebird, mysql, mssql). */
export type ConnectionStringDriver = (connectionString: string) => ConnectionFactory;

/** The drivers by kind of database; the provider factory names of the file select one. */
export interface DbxDrivers {
  postgresql?: ConnectionStringDriver;
  firebird?: ConnectionStringDriver;
  mysql?: ConnectionStringDriver;
  sqlserver?: ConnectionStringDriver;
}

// The provider factory names of Reportman.Server (DirectProviders) and of older designers
const PROVIDERS: Record<string, keyof DbxDrivers | 'sqlite'> = {
  sqlitecore: 'sqlite',
  'microsoft.data.sqlite': 'sqlite',
  'system.data.sqlite': 'sqlite',
  postgresql: 'postgresql',
  npgsql: 'postgresql',
  'firebirdsql.data.firebirdclient': 'firebird',
  mysqlconnector: 'mysql',
  'mysql.data.mysqlclient': 'mysql',
  sqlserver: 'sqlserver',
  'system.data.sqlclient': 'sqlserver',
  'microsoft.data.sqlclient': 'sqlserver',
};

/** Options of dbxConnections. */
export interface DbxConnectionsOptions {
  /** The file; the shared one of this computer by default (dbxConnectionsCandidates). */
  path?: string;
  /** The driver of each kind of database. SQLite is built in (node:sqlite). */
  drivers?: DbxDrivers;
  /**
   * A password the file keeps ciphered with Windows DPAPI (Secret.Password=dpapi:...), which
   * JavaScript cannot decipher: (alias, parameter name) gives it, for example from an environment
   * variable or a secret store; undefined opens the connection without it.
   */
  password?: (alias: string, name: string) => string | undefined;
}

/** The SQLite file of a connection string (Data Source, DataSource or Filename). */
function sqliteFile(connectionString: string): string {
  for (const [k, v] of parseConnectionString(connectionString)) {
    const key = k.toLowerCase().replace(/\s/g, '');
    if (key === 'datasource' || key === 'filename') return v;
  }
  return '';
}

/**
 * The connections of this computer by alias, for the connections of openReport: each ADO.NET
 * section whose provider has a driver (SQLite always; the others when given in `drivers`).
 */
export function dbxConnections(options: DbxConnectionsOptions = {}): Record<string, ConnectionFactory> {
  const result: Record<string, ConnectionFactory> = {};
  for (const c of readDbxDirectConnections(options.path)) {
    const kind = PROVIDERS[c.providerFactory.trim().toLowerCase()];
    if (kind === undefined) continue;
    const connectionString = dbxConnectionString(c, options.password);
    if (kind === 'sqlite') {
      const file = sqliteFile(connectionString);
      if (file !== '') result[c.alias] = sqlite(file);
      continue;
    }
    const driver = options.drivers?.[kind];
    if (driver !== undefined) result[c.alias] = driver(connectionString);
  }
  return result;
}
