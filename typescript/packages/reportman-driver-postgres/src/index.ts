// PostgreSQL for Report Manager in Node.js, through pg (pure JavaScript), with the behaviour of
// Npgsql 10, the provider of the C# engine: a report gives the same result in both engines.
//
//   import { openReport } from '@reportman/node';
//   import { postgres } from '@reportman/driver-postgres';
//   const report = await openReport('sales.rep', {
//     connections: { SALES: postgres('Host=db;Database=sales;Username=report;Password=...') },
//   });

import { CultureInfo, type ConnectionRequest, type DataConnection, type MaybePromise } from '@reportman/engine';
import type pg from 'pg';
import { PostgresConnection, type ConnectionSettings } from './connection.js';
import { parseNpgsqlConnectionString } from './connstring.js';

/** Options of a PostgreSQL connection: pg's client options plus Npgsql's behaviours. */
export interface PostgresOptions extends Omit<pg.ClientConfig, 'connectionString' | 'types'> {
  /**
   * An Npgsql connection string ("Host=...;Port=...;Database=...;Username=...;Password=...") or a
   * libpq URL (postgres://user:password@host:port/database). The other options win over it.
   */
  connectionString?: string;
  /** Seconds a statement may run (Npgsql's Command Timeout: 30 by default; 0 for no limit). */
  commandTimeout?: number;
  /** Put the DETAIL of server errors in their message (Npgsql's Include Error Detail). */
  includeErrorDetail?: boolean;
  /**
   * The culture of the text of values the engine has no type for and .NET prints with the
   * current culture (ranges of numbers and dates): the culture the report runs with. en-US by
   * default, as openReport.
   */
  culture?: CultureInfo | string;
  /**
   * Answer the engine synchronously: pg runs in a worker thread and each query waits for it.
   * Needed by the reports that read data while an expression is evaluated (GETVALUEFROMSQL, a
   * dataset opened on demand, REOPEN), which the C# engine runs; this thread waits meanwhile.
   * False by default (every query returns a promise).
   */
  synchronous?: boolean;
}

/** Opens a report connection: the connection factory of reportman-node (ConnectionFactory). */
export type PostgresConnectionFactory = (request: ConnectionRequest) => MaybePromise<DataConnection>;

function isUrl(text: string): boolean {
  return /^postgres(ql)?:\/\//i.test(text);
}

/** The settings of the connections of a factory. */
export function connectionSettings(options: PostgresOptions | string): ConnectionSettings {
  const o: PostgresOptions = typeof options === 'string' ? { connectionString: options } : options;
  const { connectionString, commandTimeout, includeErrorDetail, culture, synchronous, ...client } = o;
  let config: pg.ClientConfig = {};
  let timeout = 30;
  let detail = false;
  if (connectionString !== undefined && connectionString.length > 0) {
    if (isUrl(connectionString)) config.connectionString = connectionString;
    else {
      const parsed = parseNpgsqlConnectionString(connectionString);
      config = parsed.config;
      if (parsed.commandTimeout !== undefined) timeout = parsed.commandTimeout;
      if (parsed.includeErrorDetail !== undefined) detail = parsed.includeErrorDetail;
    }
  }
  config = { connectionTimeoutMillis: 15000, ...config, ...client };
  if (commandTimeout !== undefined) timeout = commandTimeout;
  if (includeErrorDetail !== undefined) detail = includeErrorDetail;
  if (timeout > 0 && config.statement_timeout === undefined) config.statement_timeout = timeout * 1000;
  const cultureInfo = culture === undefined ? CultureInfo.get('en-US') : typeof culture === 'string' ? CultureInfo.get(culture) : culture;
  const connectMs = config.connectionTimeoutMillis ?? 15000;
  return {
    config,
    includeErrorDetail: detail,
    culture: cultureInfo,
    synchronous: synchronous ?? false,
    maxWaitMs: timeout > 0 ? connectMs + timeout * 1000 + 60000 : Number.MAX_SAFE_INTEGER,
  };
}

/**
 * A connection factory that opens PostgreSQL for a report connection: each report run opens its
 * own client, starts the implicit transaction with the isolation level of the report connection
 * and commits it (or rolls it back) when the run closes the connection.
 *
 * The connection comes from these options, never from the connection string inside the .rep.
 */
export function postgres(options: PostgresOptions | string): PostgresConnectionFactory {
  const settings = connectionSettings(options);
  return (request) => PostgresConnection.open(settings, request);
}

export { PostgresConnection } from './connection.js';
export { PostgresException } from './errors.js';
export { parseNpgsqlConnectionString } from './connstring.js';
export type { ParsedConnectionString } from './connstring.js';
export { parseSql } from './sql.js';
export type { ParsedStatement } from './sql.js';
