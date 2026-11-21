// reportman-driver-firebird: Firebird for Report Manager in Node.js, through node-firebird (the wire
// protocol in plain JavaScript), with the behaviour of FirebirdSql.Data.FirebirdClient 10.3, the
// provider the C# engine and Reportman.Server open Firebird with: the same columns and .NET types,
// the same values, the same parameter binding and the same errors, so a report gives the same
// result in both engines.
//
//   import { openReport } from '@reportman/node';
//   import { firebird } from '@reportman/driver-firebird';
//
//   const report = await openReport('invoices.rep', {
//     connections: { SAMPLES: firebird('DataSource=db.example.com;Database=/data/sales.fdb;User=REPORTS;Password=...') },
//   });
//   const pdf = await report.executeToPdf({ FIRST_ORDER: 7 });

import { CultureInfo, type ConnectionRequest, type DataConnection, type MaybePromise } from '@reportman/engine';
import { FirebirdConnection } from './connection.js';
import { SyncFirebirdConnection } from './sync.js';
import { type ConnectionSettings, defaultSettings, parseConnectionString } from './connectionstring.js';

export { FbException, type StatusEntry } from './errors.js';
export { parseConnectionString, type ConnectionSettings } from './connectionstring.js';
export { isolationTpb } from './connection.js';
export { SyncFirebirdConnection } from './sync.js';
export type { FirebirdColumnInfo } from './values.js';

/** Where and how to connect: a FirebirdClient connection string, or its parts. */
export interface FirebirdOptions {
  /**
   * A FirebirdClient connection string ("DataSource=...;Port=...;Database=...;User=...;Password=...;
   * Charset=UTF8"), with the keys and synonyms FirebirdClient accepts. The other options override it.
   */
  connectionString?: string;
  /** The server (DataSource); "localhost" by default. */
  host?: string;
  /** 3050 by default. */
  port?: number;
  /** The database: a path or an alias on the server, also "host/port:path". */
  database?: string;
  user?: string;
  password?: string;
  role?: string;
  /** The character set of the connection; UTF8 by default, as in FirebirdClient. */
  charset?: string;
  /** Wire encryption: 'Enabled' by default (used when the server allows it), 'Disabled' or 'Required'. */
  wireCrypt?: 'Disabled' | 'Enabled' | 'Required';
  /** Seconds to wait for the server; 15 by default, 0 waits for ever. */
  connectionTimeout?: number;
  /**
   * The culture FirebirdClient formats some values with (CultureInfo.CurrentCulture of the C#
   * engine, the culture of the run): a TIMESTAMP WITH TIME ZONE column (its text is the date in that
   * culture), and a number or date sent to a text parameter. 'en-US' by default, the default culture
   * of openReport; pass the culture the report runs with.
   */
  culture?: CultureInfo | string;
  /**
   * Answer the engine synchronously: node-firebird runs in a worker thread and each call waits for
   * it. Needed by the reports that read data while an expression is evaluated (GETVALUEFROMSQL, a
   * dataset opened on demand, REOPEN), which the C# engine runs with FirebirdClient; this thread
   * waits meanwhile. False by default (every call returns a promise).
   */
  synchronous?: boolean;
}

/** The settings of the options. */
export function resolveSettings(options: FirebirdOptions | string): ConnectionSettings {
  const o: FirebirdOptions = typeof options === 'string' ? { connectionString: options } : options;
  const s = o.connectionString !== undefined ? parseConnectionString(o.connectionString) : defaultSettings();
  if (o.host !== undefined) s.dataSource = o.host;
  if (o.port !== undefined) s.port = o.port;
  if (o.database !== undefined) s.database = o.database;
  if (o.user !== undefined) s.user = o.user;
  if (o.password !== undefined) s.password = o.password;
  if (o.role !== undefined) s.role = o.role;
  if (o.charset !== undefined) s.charset = o.charset;
  if (o.wireCrypt !== undefined) s.wireCrypt = o.wireCrypt;
  if (o.connectionTimeout !== undefined) s.connectionTimeout = o.connectionTimeout;
  return s;
}

/**
 * A connection factory for openReport's `connections` (the ConnectionFactory of reportman-node):
 * each report connection it serves attaches to the database and begins its implicit transaction with
 * the isolation level of the report connection, as the C# engine does with FirebirdClient. The
 * connection string of the .rep is not used: the host says where the data is.
 */
export function firebird(options: FirebirdOptions | string): (request: ConnectionRequest) => MaybePromise<DataConnection> {
  const settings = resolveSettings(options);
  const o = typeof options === 'string' ? {} : options;
  const culture = o.culture === undefined ? CultureInfo.get('en-US') : typeof o.culture === 'string' ? CultureInfo.get(o.culture) : o.culture;
  const invariant = CultureInfo.invariant;
  if (o.synchronous === true) return (request) => SyncFirebirdConnection.open({ ...settings }, request, culture);
  return (request) => FirebirdConnection.open({ ...settings }, request, { culture, invariant });
}
