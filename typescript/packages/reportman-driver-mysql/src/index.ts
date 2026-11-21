// reportman-driver-mysql: MySQL and MariaDB for Report Manager in Node.js, through mysql2 (the wire
// protocol in plain JavaScript), with the behaviour of MySqlConnector 2.5, the provider the C# engine
// and Reportman.Server open MySQL with ("MySQLConnector"): the same columns and .NET types, the same
// values, the same parameter binding (the literals MySqlConnector writes in the statement), the same
// transactions and the same errors, so a report gives the same result in both engines.
//
//   import { openReport } from 'reportman-node';
//   import { mysql } from 'reportman-driver-mysql';
//
//   const report = await openReport('invoices.rep', {
//     connections: { SAMPLES: mysql('Server=db.example.com;Database=sales;User ID=reports;Password=...') },
//   });
//   const pdf = await report.executeToPdf({ FIRST_ORDER: 7 });

import type { SslOptions } from 'mysql2';
import { CultureInfo, type ConnectionRequest, type DataConnection, type MaybePromise } from 'reportman-engine';
import { MySqlConnection, startTransactionStatements } from './connection.js';
import { type ConnectionSettings, defaultSettings, parseConnectionString } from './connectionstring.js';
import { SyncMySqlConnection } from './sync.js';

export { MySqlException } from './errors.js';
export { parseConnectionString, type ConnectionSettings, type GuidFormat, type SslMode } from './connectionstring.js';
export { startTransactionStatements };
export { bindParameters, ParameterCollection } from './params.js';
export { SyncMySqlConnection } from './sync.js';
export type { MySqlColumnInfo } from './values.js';

/** Where and how to connect: a MySqlConnector connection string, or its parts. */
export interface MySqlOptions {
  /**
   * A MySqlConnector connection string ("Server=...;Port=...;Database=...;User ID=...;Password=..."),
   * with the keys, synonyms and defaults of MySqlConnector 2.5 (TreatTinyAsBoolean, AllowZeroDateTime,
   * ConvertZeroDateTime, GuidFormat, DateTimeKind, AllowUserVariables, NoBackslashEscapes, SslMode...).
   * The other options override it.
   */
  connectionString?: string;
  /** The server (Server); "localhost" by default. A comma-separated list is tried in order. */
  host?: string;
  /** 3306 by default. */
  port?: number;
  database?: string;
  user?: string;
  password?: string;
  /** Seconds to wait for the server; 15 by default, 0 waits for ever. */
  connectionTimeout?: number;
  /**
   * mysql2 TLS options, instead of those of the connection string (SSL Mode=Preferred by default:
   * TLS without verifying the certificate when the server offers it).
   */
  ssl?: SslOptions;
  /**
   * The culture of the run (CultureInfo.CurrentCulture of the C# engine): the text of a DATETIME read
   * with AllowZeroDateTime=True (MySqlDateTime) and of a Variant in an error. 'en-US' by default, the
   * default culture of openReport; pass the culture the report runs with.
   */
  culture?: CultureInfo | string;
  /**
   * Answer the engine synchronously: mysql2 runs in a worker thread and each call waits for it.
   * Needed by the reports that read data while an expression is evaluated (GETVALUEFROMSQL, a
   * dataset opened on demand, REOPEN); this thread waits meanwhile. The ssl options cannot hold
   * functions then (they do not cross to the worker). False by default (every call returns a
   * promise).
   */
  synchronous?: boolean;
}

/** The settings of the options. */
export function resolveSettings(options: MySqlOptions | string): ConnectionSettings {
  const o: MySqlOptions = typeof options === 'string' ? { connectionString: options } : options;
  const s = o.connectionString !== undefined ? parseConnectionString(o.connectionString) : defaultSettings();
  if (o.host !== undefined) s.hosts = o.host.split(',').map((h) => h.trim()).filter((h) => h.length > 0);
  if (o.port !== undefined) s.port = o.port;
  if (o.database !== undefined) s.database = o.database;
  if (o.user !== undefined) s.user = o.user;
  if (o.password !== undefined) s.password = o.password;
  if (o.connectionTimeout !== undefined) s.connectionTimeout = o.connectionTimeout;
  return s;
}

/**
 * A connection factory for openReport's `connections` (the ConnectionFactory of reportman-node):
 * each report connection it serves opens a session and begins its implicit transaction with the
 * isolation level of the report connection, as the C# engine does with MySqlConnector. The
 * connection string of the .rep is not used: the host says where the data is.
 */
export function mysql(options: MySqlOptions | string): (request: ConnectionRequest) => MaybePromise<DataConnection> {
  const settings = resolveSettings(options);
  const o = typeof options === 'string' ? {} : options;
  const culture = o.culture === undefined ? CultureInfo.get('en-US') : typeof o.culture === 'string' ? CultureInfo.get(o.culture) : o.culture;
  if (o.synchronous === true) return (request) => SyncMySqlConnection.open({ ...settings, hosts: [...settings.hosts] }, request, culture, o.ssl);
  return (request) => MySqlConnection.open({ ...settings, hosts: [...settings.hosts] }, request, { culture, ssl: o.ssl });
}
