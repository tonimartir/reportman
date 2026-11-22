// A connection opened outside a report, the way a connections page tests one: the factory gets the
// request a report connection with that alias, provider and connection string would make, runs one
// query and is closed again.
import { DatabaseInfo } from '@reportman/lib';
import type { ConnectionRequest } from '@reportman/engine';
import type { ConnectionFactory } from './host.js';

/** What probeConnection opens and runs. */
export interface ProbeOptions {
  /** The alias of the connection. */
  alias: string;
  /** The provider factory name (SQLiteCore, PostgreSQL...), as a report connection would give it. */
  providerFactory?: string;
  /** The connection string, as a report connection would give it. */
  connectionString?: string;
  /** The query to run; its first value is the answer. */
  sql: string;
}

/**
 * Opens a connection of a factory, runs one query and closes it (rolling back): the first value of
 * the query as text, '' when it gives none. An error of the driver is thrown as it comes.
 */
export async function probeConnection(factory: ConnectionFactory, options: ProbeOptions): Promise<string> {
  const database = new DatabaseInfo();
  database.alias = options.alias;
  database.providerFactory = options.providerFactory ?? '';
  database.connectionString = options.connectionString ?? '';
  database.loadParams = false;
  const request: ConnectionRequest = {
    database,
    alias: options.alias,
    connectionString: database.connectionString,
    providerFactory: database.providerFactory,
    engineSqlite: false,
    dbParam: () => '',
    isolationLevel: 'ReadCommitted',
  };
  const connection = await factory(request);
  try {
    const result = await connection.query({ sql: options.sql, parameters: [], dataset: '' });
    const value = result.rows[0]?.[0];
    return value === null || value === undefined ? '' : String(value);
  } finally {
    await connection.close(false);
  }
}
