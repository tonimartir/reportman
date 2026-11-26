// The backend of the designer's operations on Node.js: the folder store of @reportman/server, the
// engine of @reportman/node with the server's connections, culture, clock and fonts, and the local
// schema files in the data folder.

import { createHash } from 'node:crypto';
import path from 'node:path';
import { openReportModel, type ConnectionFactory } from '@reportman/node';
import { connectionFactory, type ReportServer, type ReportServerOptions } from '@reportman/server';
import type { DesignerBackend } from './operations.js';
import { SCHEMA_FOLDER, familyOfProvider, type SchemaConnection } from './schema.js';
import { folderSchemaFiles } from './schema-files.js';

// Identity of the factories the program gives, for the keys of the caches
const factoryIds = new WeakMap<object, number>();
let nextFactoryId = 1;
function factoryId(f: object): string {
  let id = factoryIds.get(f);
  if (id === undefined) {
    id = nextFactoryId++;
    factoryIds.set(f, id);
  }
  return 'given:' + id;
}

const message = (e: unknown): string => (e instanceof Error ? e.message : String(e));

/** The backend of a report server: its store, how it opens a report, its connections and its data folder. */
export function nodeDesignerBackend(reports: ReportServer, options: ReportServerOptions): DesignerBackend {
  /** What a connection alias opens, hashed (never the connection string itself: it may carry a password). */
  const fingerprint = (reportAlias: string, databaseAlias: string): string => {
    const given = typeof options.connections === 'function' ? options.connections(reportAlias) : options.connections;
    const key = Object.keys(given ?? {}).find((k) => k.toUpperCase() === databaseAlias.toUpperCase());
    if (key !== undefined) return factoryId(given![key]!);
    const c = reports.console?.connections.get(databaseAlias) ?? null;
    if (c === null) return 'unknown';
    const text = [c.kind, c.providerFactory, c.connectionString, c.hubDatabaseId, c.apiKey].join('|');
    return createHash('sha256').update(text).digest('hex').substring(0, 16);
  };

  /** What the server knows of a connection alias, for its schema. */
  const schemaConnection = (alias: string): SchemaConnection | null => {
    const given = typeof options.connections === 'function' ? options.connections('') : options.connections;
    const key = Object.keys(given ?? {}).find((k) => k.toUpperCase() === alias.toUpperCase());
    const definition = reports.console?.connections.get(alias) ?? null;
    if (key !== undefined) {
      const factory: ConnectionFactory = given![key]!;
      // The program's connection wins over the one of dbxconnections.ini, as in the reports
      return { kind: 'direct', alias, family: 'other', factory, definition: null, keepsFile: false, fingerprint: factoryId(factory) };
    }
    if (definition === null) return null;
    if (definition.kind === 'agent') return { kind: 'agent', alias, hubDatabaseId: definition.hubDatabaseId };
    let factory: ConnectionFactory | undefined;
    let factoryError: string | undefined;
    try {
      factory = connectionFactory(definition, options.drivers ?? {});
    } catch (e) {
      factoryError = message(e);
    }
    return {
      kind: 'direct',
      alias,
      family: familyOfProvider(definition.providerFactory),
      factory,
      factoryError,
      definition,
      keepsFile: true,
      fingerprint: fingerprint('', alias),
    };
  };

  return {
    store: reports.store,
    open(model, reportAlias, layout) {
      // The tools that lay nothing out (columns, functions, syntax, evaluate, data) run with the
      // standard fonts, so a machine without fonts (a slim container) still answers them
      const openOptions = layout ? reports.openOptions(reportAlias) : { ...reports.openOptions(reportAlias), fonts: false as const };
      const node = openReportModel(model, openOptions);
      return {
        prepareRun: () => node.prepareRun(),
        executeToPdf: ({ subReportIndexes, onMetafile }) => node.executeToPdf(null, { defaults: true, subReportIndexes, onMetafile }),
      };
    },
    fingerprint,
    schemaConnection,
    schemaFiles: options.dataPath === undefined ? null : folderSchemaFiles(path.join(path.resolve(options.dataPath), SCHEMA_FOLDER)),
  };
}
