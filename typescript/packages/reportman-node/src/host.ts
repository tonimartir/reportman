import type {
  ConnectionRequest,
  DataConnection,
  DataHost,
  DatasetRequest,
  MaybePromise,
  QueryResult,
} from '@reportman/engine';

/**
 * Opens a report connection: receives what the engine knows of it (alias, driver, connection
 * string, parameters) and returns an open connection with its implicit transaction.
 */
export type ConnectionFactory = (request: ConnectionRequest) => MaybePromise<DataConnection>;

/** The rows of a dataset given by the host instead of running its SQL (DataViewOverride). */
export type DatasetSource = QueryResult | ((request: DatasetRequest) => MaybePromise<QueryResult | undefined>);

/** Where the data of a report comes from. */
export interface DataSources {
  /**
   * The connections, by report connection alias (case insensitive). Only these are opened: a
   * report connection that is not here fails, whatever the .rep carries inside (the rule of
   * Reportman.Server since 06-10-2026: a .rep is a file anybody who designs can write).
   */
  connections?: Readonly<Record<string, ConnectionFactory>>;
  /** Rows for datasets, by dataset alias (case insensitive): a REST API, an array in memory… */
  datasets?: Readonly<Record<string, DatasetSource>>;
}

/** A connection that runs nothing: the report connection of a dataset whose rows the host gives. */
const idleConnection: DataConnection = {
  query(): QueryResult {
    throw new Error('This connection only serves datasets whose rows are given by the host');
  },
  close(): void {},
};

function byAlias<T>(record: Readonly<Record<string, T>> | undefined): Map<string, T> {
  const map = new Map<string, T>();
  for (const [key, value] of Object.entries(record ?? {})) map.set(key.toUpperCase(), value);
  return map;
}

/** The data host of the engine for the given sources. */
export function createDataHost(sources: DataSources): DataHost {
  const connections = byAlias(sources.connections);
  const datasets = byAlias(sources.datasets);
  const usesOnlyGivenRows = (alias: string): boolean => datasets.size > 0 && !connections.has(alias);
  return {
    connect(request: ConnectionRequest): MaybePromise<DataConnection> {
      const alias = request.alias.toUpperCase();
      const factory = connections.get(alias);
      if (factory !== undefined) return factory(request);
      // As in C#, the connection of a dataset with given rows is opened all the same
      if (usesOnlyGivenRows(alias)) return idleConnection;
      throw new Error(
        'The connection ' + request.alias + ' is not defined: pass it in the connections option of openReport',
      );
    },
    datasetRows(request: DatasetRequest): MaybePromise<QueryResult | undefined> {
      const source = datasets.get(request.alias.toUpperCase());
      if (source === undefined) return undefined;
      return typeof source === 'function' ? source(request) : source;
    },
  };
}
