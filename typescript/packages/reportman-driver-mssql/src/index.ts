// reportman-driver-mssql: SQL Server for Report Manager in Node.js, through tedious (the TDS
// protocol in plain JavaScript), with the behaviour of Microsoft.Data.SqlClient 6.1, the provider
// the C# engine and Reportman.Server open SQL Server with ("SQLServer"): the same columns and .NET
// types, the same values, the same parameters on the wire (sp_executesql with SqlClient's
// declarations), the same transactions and the same errors, so a report gives the same result in
// both engines.
//
//   import { openReport } from 'reportman-node';
//   import { mssql } from 'reportman-driver-mssql';
//
//   const report = await openReport('invoices.rep', {
//     connections: { SAMPLES: mssql('Server=db.example.com;Database=sales;User ID=reports;Password=...') },
//   });
//   const pdf = await report.executeToPdf({ FIRST_ORDER: 7 });

import type { SecureContextOptions } from 'node:tls';
import type tedious from 'tedious';
import { CultureInfo, type ConnectionRequest, type DataConnection, type MaybePromise } from 'reportman-engine';
import { MsSqlConnection } from './connection.js';
import { type SqlSettings, defaultSettings, parseConnectionString } from './connectionstring.js';
import { SyncMsSqlConnection } from './sync.js';

export { SyncMsSqlConnection } from './sync.js';
export { MsSqlConnection, isolationLevelCode, tediousConfig, type ConnectionOptions, type TypedResult } from './connection.js';
export {
  parseConnectionString,
  parseDataSource,
  defaultSettings,
  DEFAULT_APPLICATION_NAME,
  type SqlSettings,
  type EncryptOption,
  type AuthenticationMethod,
  type TypeSystemVersion,
  type ServerAddress,
} from './connectionstring.js';
export { SqlException, type SqlError } from './errors.js';
export { bindParameter, bindParameters, decimalPrecision, metaTypeOf, sqlDateTime, type BoundParameter, type SqlMetaType } from './params.js';
export { rewritePlaceholders } from './sql.js';
export { sqlDecimal, timeSpanText, localDateTime, type SqlColumnInfo, type NetCell, type NetTypeName } from './values.js';

/** Where and how to connect: a SqlClient connection string, or its parts. */
export interface MsSqlOptions {
  /**
   * A SqlClient connection string ("Server=host,port;Database=...;User ID=...;Password=...;
   * TrustServerCertificate=True"), with the keywords, synonyms and defaults of SqlClient 6.1
   * (Encrypt=Mandatory by default). The other options override it.
   */
  connectionString?: string;
  /** Data Source: "host", "host,port", "host\\instance", "tcp:host,port". */
  server?: string;
  database?: string;
  user?: string;
  password?: string;
  /** Seconds to wait for the server (Connect Timeout); 15 by default, 0 waits for ever. */
  connectTimeout?: number;
  /** A tedious authentication instead of User ID and Password (NTLM with a domain, Azure AD...). */
  authentication?: tedious.ConnectionAuthentication;
  /** TLS options (CA certificates...) for the encrypted connection. */
  tls?: SecureContextOptions;
  /**
   * The culture of the run (CultureInfo.CurrentCulture of the C# engine): the text of a parameter
   * value SqlClient converts to a string, or parses. 'en-US' by default, the default culture of
   * openReport; pass the culture the report runs with.
   */
  culture?: CultureInfo | string;
  /**
   * Answer the engine synchronously: tedious runs in a worker thread and each call waits for it.
   * Needed by the reports that read data while an expression is evaluated (a dataset opened on
   * demand, REOPEN), which the C# engine runs (with MultipleActiveResultSets=True); this thread
   * waits meanwhile. False by default (every call returns a promise).
   */
  synchronous?: boolean;
}

/** The settings of the options. */
export function resolveSettings(options: MsSqlOptions | string): SqlSettings {
  const o: MsSqlOptions = typeof options === 'string' ? { connectionString: options } : options;
  const s = o.connectionString !== undefined ? parseConnectionString(o.connectionString) : defaultSettings();
  if (o.server !== undefined) s.dataSource = o.server;
  if (o.database !== undefined) s.database = o.database;
  if (o.user !== undefined) s.userId = o.user;
  if (o.password !== undefined) s.password = o.password;
  if (o.connectTimeout !== undefined) s.connectTimeout = o.connectTimeout;
  return s;
}

/**
 * A connection factory for openReport's `connections` (the ConnectionFactory of reportman-node):
 * each report connection it serves opens a session and begins its implicit transaction with the
 * isolation level of the report connection, as the C# engine does with SqlClient; closing it at
 * the end of the run commits (or rolls back). The connection string of the .rep is not used: the
 * host says where the data is.
 */
export function mssql(options: MsSqlOptions | string): (request: ConnectionRequest) => MaybePromise<DataConnection> {
  const settings = resolveSettings(options);
  const o: MsSqlOptions = typeof options === 'string' ? {} : options;
  const culture = o.culture === undefined ? CultureInfo.get('en-US') : typeof o.culture === 'string' ? CultureInfo.get(o.culture) : o.culture;
  const connectionOptions = { culture, authentication: o.authentication, tls: o.tls };
  if (o.synchronous === true) return (request) => SyncMsSqlConnection.open({ ...settings }, request, connectionOptions);
  return (request) => MsSqlConnection.open({ ...settings }, request, connectionOptions);
}
