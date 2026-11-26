// The backend of the designer of the live demo, in the browser: what node-backend.ts of
// @reportman/designer-server does on a server. The reports are kept in the browser's Cache Storage
// (each visitor edits copies of the samples, which come from the demo's own folder the first time),
// the data is the sample SQLite database in sql.js, and a report runs with the engine and the PDF
// writer of the @reportman packages, with the open fonts of the demo.
import initSqlJs, { type SqlJsStatic } from 'sql.js';
import { Report, SubReport, hydrateReport, readReportXml, serializeReport, writeReportXmlBytes } from '@reportman/lib';
import { PdfDevice, systemClock } from '@reportman/pdf';
import { prepareReport, type EvalHost, type ReportRun } from '@reportman/engine';
import {
  parseSchemaFile,
  type DesignerBackend,
  type DesignerRunner,
  type DesignerStore,
  type LocalSchemaFile,
  type SchemaConnection,
  type SchemaFiles,
  type StoredReportContent,
} from '@reportman/designer-server/browser';
import { dataHost, printPdf, wallClock, type ConnectionFactory } from '../browser-report.js';
import { fontLibraryOf, fontsOf } from '../fonts.js';
import { sqlJs } from '../sqljs.js';

import { SAMPLES_ALIAS, STORE_CACHE, schemaKey, storeKey } from './names.js';

/**
 * The local schema file of the samples' connection (samples/dbxschemas/SAMPLES.json, the one
 * Reportman.Server keeps): its subschemas are what the copilot designs with, and each sample's
 * datasets name theirs. The designer reads it synchronously, so it is read before (ready); what the
 * visitor changes (a refresh from the catalog) is kept in the Cache Storage, as the reports.
 */
export class DemoSchemaFiles implements SchemaFiles {
  private readonly files = new Map<string, LocalSchemaFile>();
  private reading: Promise<void> | undefined;

  constructor(private readonly base: string) {}

  /** The file of the samples, the visitor's copy first. */
  ready(): Promise<void> {
    this.reading ??= (async () => {
      const cache = await caches.open(STORE_CACHE);
      const saved = await cache.match(schemaKey(this.base, SAMPLES_ALIAS));
      const reply = saved ?? (await fetch(new URL('samples/dbxschemas/' + SAMPLES_ALIAS + '.json', this.base).href));
      if (reply.ok) this.files.set(SAMPLES_ALIAS, parseSchemaFile(await reply.text()));
    })().catch(() => {
      // Without the file the connection is described from its catalog
      this.reading = undefined;
    });
    return this.reading;
  }

  load(alias: string): LocalSchemaFile | null {
    return this.files.get(alias.toUpperCase()) ?? null;
  }

  save(alias: string, schema: LocalSchemaFile): void {
    this.files.set(alias.toUpperCase(), schema);
    const text = JSON.stringify(schema, null, 2);
    void caches
      .open(STORE_CACHE)
      .then((cache) => cache.put(schemaKey(this.base, alias), new Response(text, { headers: { 'content-type': 'application/json' } })))
      .catch(() => undefined);
  }
}

/** An error of the store, as FolderReportStore of @reportman/server throws them. */
class StoreError extends Error {
  constructor(
    readonly status: number,
    message: string,
    readonly kind: 'notFound' | 'conflict' | 'unknownAlias' | 'invalid',
  ) {
    super(message);
    this.name = 'ServerError';
  }
}

/** The version tag of a report's bytes: the first 24 hex digits of their SHA-256, as Reportman.Server. */
async function eTagOf(content: Uint8Array): Promise<string> {
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', content as Uint8Array<ArrayBuffer>));
  return Array.from(digest, (b) => b.toString(16).padStart(2, '0'))
    .join('')
    .substring(0, 24);
}

/** "Sales/month" → "Sales/month.rep", refusing what would leave the alias. */
function cleanPath(path: string): string {
  const cleaned = path.replace(/\\/g, '/').trim().replace(/^\/+|\/+$/g, '');
  if (cleaned.length === 0) throw new StoreError(400, 'A report path is required.', 'invalid');
  const parts = cleaned.split('/');
  if (parts.some((p) => p.length === 0 || p === '.' || p === '..' || p.startsWith('.'))) throw new StoreError(400, 'Invalid report path.', 'invalid');
  return /\.rep$/i.test(cleaned) ? cleaned : cleaned + '.rep';
}

/** The store of the demo: the reports of SAMPLES in the Cache Storage, the samples of the demo the first time. */
export class DemoStore implements DesignerStore {
  /** @param base The URL of the demo's folder (with the samples), ending with '/'. */
  constructor(private readonly base: string) {}

  private key(alias: string, path: string): string {
    if (alias.toUpperCase() !== SAMPLES_ALIAS) throw new StoreError(404, `Alias '${alias}' is not configured.`, 'unknownAlias');
    return storeKey(this.base, cleanPath(path));
  }

  /** The bytes of a report: the saved copy, else the sample of the demo. */
  private async read(alias: string, path: string): Promise<Uint8Array | null> {
    const key = this.key(alias, path);
    const cache = await caches.open(STORE_CACHE);
    const saved = await cache.match(key);
    if (saved !== undefined) return new Uint8Array(await saved.arrayBuffer());
    const name = cleanPath(path);
    // The samples are in the demo's folder, without subfolders
    if (name.includes('/')) return null;
    const sample = await fetch(new URL('samples/' + encodeURIComponent(name), this.base).href);
    if (!sample.ok) return null;
    return new Uint8Array(await sample.arrayBuffer());
  }

  async open(alias: string, path: string): Promise<StoredReportContent> {
    const content = await this.read(alias, path);
    if (content === null) throw new StoreError(404, `'${cleanPath(path)}' does not exist.`, 'notFound');
    return { content, eTag: await eTagOf(content) };
  }

  async save(alias: string, path: string, content: Uint8Array, expectedETag: string | null): Promise<{ eTag: string }> {
    const key = this.key(alias, path);
    const current = await this.read(alias, path);
    const currentTag = current === null ? null : await eTagOf(current);
    if (currentTag !== expectedETag) throw new StoreError(409, `'${cleanPath(path)}' was modified by someone else; reload it before saving.`, 'conflict');
    const cache = await caches.open(STORE_CACHE);
    await cache.put(key, new Response(content as Uint8Array<ArrayBuffer>, { headers: { 'content-type': 'application/xml' } }));
    return { eTag: await eTagOf(content) };
  }
}

let sqlLoading: Promise<{ SQL: SqlJsStatic; db: Uint8Array }> | undefined;

/** sql.js and the sample database, downloaded the first time a report runs. */
function database(base: string): Promise<{ SQL: SqlJsStatic; db: Uint8Array }> {
  sqlLoading ??= Promise.all([
    initSqlJs({ locateFile: () => new URL('sql-wasm.wasm', base).href }),
    fetch(new URL('samples/samples.db', base).href).then(async (r) => {
      if (!r.ok) throw new Error('samples/samples.db: ' + String(r.status));
      return new Uint8Array(await r.arrayBuffer());
    }),
  ]).then(([SQL, db]) => ({ SQL, db }));
  sqlLoading.catch(() => (sqlLoading = undefined));
  return sqlLoading;
}

/** A connection to the sample database, for any alias (the demo has one database). */
function sampleConnection(base: string): ConnectionFactory {
  return async (request) => {
    const { SQL, db } = await database(base);
    return sqlJs(SQL, db)(request);
  };
}

/** Options of the demo's backend. */
export interface DemoBackendOptions {
  /** The culture of the runs ('en-US', 'es-ES'...). */
  culture: string;
}

/** The backend of the designer of the demo. */
export function demoBackend(base: string, options: DemoBackendOptions, schemaFiles: DemoSchemaFiles): DesignerBackend {
  const connection = sampleConnection(base);
  return {
    store: new DemoStore(base),
    open(model: Report, _reportAlias: string, layout: boolean): DesignerRunner {
      // A copy of the model, hydrated afresh for each run (as openReportModel of @reportman/node)
      const document = JSON.stringify(serializeReport(model));
      const prepare = async (subReportIndexes?: number[]): Promise<ReportRun> => {
        const fresh = hydrateReport(JSON.parse(document));
        // The preview lays out with the open fonts of the demo; the tools with the standard 14 fonts
        const fonts = layout ? (await fontLibraryOf(base, fontsOf(fresh))).clone() : undefined;
        const host: EvalHost = { now: () => wallClock(systemClock), fileExists: () => false, readFile: () => undefined, fileFunctions: false };
        const connections: Record<string, ConnectionFactory> = {};
        for (const db of fresh.databaseInfo) connections[db.alias] = connection;
        return prepareReport(fresh, {
          device: new PdfDevice({ clock: systemClock, fonts }),
          data: dataHost(connections),
          culture: options.culture,
          host,
          convertToDotNet: true,
          subReportIndexes,
        });
      };
      return {
        prepareRun: () => prepare(),
        async executeToPdf({ subReportIndexes, onMetafile }) {
          const run = await prepare(subReportIndexes);
          try {
            await run.applyDefaults();
            const device = run.device as PdfDevice;
            device.compressed = model.pdfCompressed;
            const pdf = await printPdf(run, device);
            onMetafile(run.metaFile);
            return pdf;
          } finally {
            await run.close();
          }
        },
      };
    },
    fingerprint: () => 'samples.db',
    schemaConnection(alias: string): SchemaConnection {
      // The samples' connection keeps its schema in its file (with its subschemas); another alias, its catalog
      const keepsFile = alias.toUpperCase() === SAMPLES_ALIAS && schemaFiles.load(alias) !== null;
      return { kind: 'direct', alias, family: 'sqlite', factory: connection, definition: null, keepsFile, fingerprint: 'samples.db' };
    },
    schemaFiles,
  };
}

/**
 * A new report on the samples' database: the connection of the samples (taken from one of them), one
 * empty subreport with its sections and nothing else, as «New report» of the designer leaves it.
 */
export async function newReportXml(store: DemoStore, sample = 'customers.rep'): Promise<Uint8Array> {
  const source = readReportXml((await store.open(SAMPLES_ALIAS, sample)).content);
  const report = new Report();
  report.databaseInfo = source.databaseInfo;
  const subreport = new SubReport();
  SubReport.initNew(report, subreport);
  report.newName(subreport);
  report.subReports.push(subreport);
  return writeReportXmlBytes(report);
}
