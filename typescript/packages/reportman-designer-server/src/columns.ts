// The columns (name and .NET type) of each dataset of a report, remembered so that the expression
// editor and the syntax check do not open every dataset on every request (DatasetColumnsCache of
// Reportman.Server): a dataset is executed once per SQL text and connection, then its columns are
// served from here for fifteen minutes, until it changes or the designer asks to refresh.

import { createHash } from 'node:crypto';
import { runAsync, type ReportRun } from '@reportman/engine';
import type { DataInfo, Report } from '@reportman/lib';

/** A column of a dataset: its name and its .NET type name ("System.Int64"). */
export interface DatasetColumn {
  name: string;
  type: string;
}

// DataColumn.DataType.ToString() of the column types of the engine
const NET_TYPES: Record<string, string> = {
  String: 'System.String',
  Int64: 'System.Int64',
  Int32: 'System.Int32',
  Int16: 'System.Int16',
  Byte: 'System.Byte',
  Boolean: 'System.Boolean',
  Double: 'System.Double',
  Single: 'System.Single',
  Decimal: 'System.Decimal',
  DateTime: 'System.DateTime',
  Binary: 'System.Byte[]',
  Object: 'System.Object',
};

/** The .NET type name of a column type of the engine. */
export function netTypeName(type: string): string {
  return NET_TYPES[type] ?? 'System.' + type;
}

/** The columns of an open dataset (ReportConnections.Columns). */
export function datasetColumns(run: ReportRun, alias: string): DatasetColumn[] {
  const dinfo = run.runtime.dataInfoByAlias(alias);
  if (dinfo === null) return [];
  return dinfo.data.columns.map((c) => ({ name: c.name, type: netTypeName(c.type) }));
}

const CACHE_FOR_MS = 15 * 60 * 1000;

/** Opens the datasets of a report: a run with its connections bound and the parameters at their defaults. */
export type RunFactory = () => Promise<ReportRun>;

/** The cache of the columns of the datasets, shared by the requests of a designer server. */
export class DatasetColumnsCache {
  private readonly entries = new Map<string, { columns: DatasetColumn[]; expires: number }>();
  private readonly now: () => number;

  constructor(now: () => number = Date.now) {
    this.now = now;
  }

  /** The remembered columns of a dataset, or null when it has not been opened yet (or they expired). */
  peek(key: string): DatasetColumn[] | null {
    const entry = this.entries.get(key);
    if (entry === undefined) return null;
    if (entry.expires <= this.now()) {
      this.entries.delete(key);
      return null;
    }
    return entry.columns;
  }

  /**
   * The columns of every dataset of the report (by alias, any case): from the cache when known,
   * else by opening the dataset (the run's connections, closed after). A dataset that fails is
   * reported in errors ("ALIAS: message") and left out.
   */
  async getAll(
    model: Report,
    keyOf: (dinfo: DataInfo) => string,
    open: RunFactory,
    refresh: boolean,
    errors: string[],
  ): Promise<Map<string, DatasetColumn[]>> {
    const result = new Map<string, DatasetColumn[]>();
    const missing: DataInfo[] = [];
    for (const dinfo of model.dataInfo) {
      const cached = refresh ? null : this.peek(keyOf(dinfo));
      if (cached !== null) result.set(dinfo.alias.toUpperCase(), cached);
      else missing.push(dinfo);
    }
    if (missing.length === 0) return result;
    const run = await open();
    try {
      // With the values the parameters form would start from, as the preview: a failure here
      // leaves the datasets to fail on their own (Reportman.Server logs it)
      try {
        await run.applyDefaults();
      } catch {
        // the parameters keep the values they had
      }
      const runtime = run.runtime;
      for (const dinfo of missing) {
        try {
          const index = runtime.dataInfoIndexOf(dinfo.alias);
          if (index < 0) throw new Error('Data alias not found:' + dinfo.alias);
          runtime.updateParamsBeforeOpen(index, true);
          await runAsync(runtime.dataInfos[index]!.connect());
          const columns = datasetColumns(run, dinfo.alias);
          this.entries.set(keyOf(dinfo), { columns, expires: this.now() + CACHE_FOR_MS });
          result.set(dinfo.alias.toUpperCase(), columns);
        } catch (e) {
          errors.push(dinfo.alias + ': ' + (e instanceof Error ? e.message : String(e)));
        }
      }
    } finally {
      await run.close();
    }
    return result;
  }
}

/**
 * The key of a dataset (DatasetColumnsCache.Key): the same while its alias, connection, SQL and
 * master do not change; the connection counts by what the server says the alias opens, not by its
 * name. A union of datasets is the same while its definition and every dataset it reads are.
 */
export function datasetKey(model: Report, dinfo: DataInfo, connection: (databaseAlias: string) => string, visiting = new Set<string>()): string {
  const sql = (dinfo.sql ?? '').replace(/\r\n/g, '\n').trim();
  const key = ['dscols', dinfo.alias.toUpperCase(), (dinfo.databaseAlias ?? '').toUpperCase(), connection(dinfo.databaseAlias ?? ''), dinfo.dataSource ?? '', dinfo.myBaseFilename ?? '', sql].join('|');
  const unions = dinfo.dataUnions ?? [];
  if (unions.length === 0) return key;
  const parts = [key, 'union', unions.join('\n'), String(dinfo.parallelUnion), String(dinfo.groupUnion), dinfo.myBaseIndexFields ?? '', dinfo.myBaseMasterFields ?? ''];
  visiting.add(dinfo.alias.toUpperCase());
  for (const line of unions) {
    // A source of a union: its alias, before an optional "-" of its fields (ReportDatasetUnions)
    const source = line.split('-')[0]!.trim();
    if (source.length === 0) continue;
    parts.push('src:' + source.toUpperCase());
    const other = model.dataInfo.find((d) => d.alias.toUpperCase() === source.toUpperCase());
    if (other === undefined || visiting.has(source.toUpperCase())) continue;
    visiting.add(source.toUpperCase());
    parts.push('=' + datasetKey(model, other, connection, visiting));
    visiting.delete(source.toUpperCase());
  }
  visiting.delete(dinfo.alias.toUpperCase());
  return 'dscols|' + dinfo.alias.toUpperCase() + '|union|' + createHash('sha256').update(parts.join('|')).digest('hex');
}
