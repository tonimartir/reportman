// The schema behind a connection alias for the SQL editor (SqlSchemaService of Reportman.Server), in
// the shape the cloud's DatabaseConfig has: the tables with their columns, types, keys and foreign
// keys, and the subschemas people defined. A direct connection of the server's dbxconnections.ini
// keeps it in a local schema file, dbxschemas/<ALIAS>.json next to dbxconnections.ini (the file
// the Delphi and C# designers keep, LocalSchemaStore of the engine): read from it, or generated
// from the database's catalog the first time (and again on a refresh, keeping what people wrote).
//
// The catalog is read through the connection the server opens for the alias (DataConnection.query):
// SQLite with sqlite_master and its PRAGMAs, as the C# engine; PostgreSQL, MySQL and SQL Server with
// INFORMATION_SCHEMA and Firebird with its RDB$ tables (C# reads the provider's schema collections
// there: the queries are the equivalent ones; not compared with C# in the tests, which have SQLite
// only). An Agent connection has no schema here: the Hub describes it to Reportman.Server's AI
// package, which this server does not have (the answer says so, as Reportman.Server without it).

import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import type { ConnectionRequest, DataColumnInfo, DataConnection, DataValue, QueryResult } from '@reportman/engine';
import { DatabaseInfo } from '@reportman/lib';
import type { ConnectionFactory } from '@reportman/node';
import type { ConnectionDefinition } from '@reportman/server';

// ---- The answer (SqlSchemaService.SqlSchema), written by System.Text.Json: null members included ----

export interface AllowedValue {
  value: string;
  label: string;
  [extra: string]: unknown;
}

export interface SchemaColumn {
  name: string;
  /** One of the cloud's ColumnDataType names: Integer, Numeric, Currency, String, TextLong, Date, TimeStamp, Boolean. */
  dataType: string;
  context: string;
  isPrimaryKey: boolean;
  /** The type the database reports. */
  detectedType: string;
  allowedValues: AllowedValue[] | null;
}

export interface SchemaForeignKey {
  constraintName: string;
  targetTable: string;
  sourceColumns: string[];
  targetColumns: string[];
  relationshipContext: string;
}

export interface SchemaTable {
  name: string;
  context: string;
  columns: SchemaColumn[];
  foreignKeys: SchemaForeignKey[];
}

/** A relation by its ends (LocalRelationRef), with what a newer version wrote kept. */
export interface RelationRef {
  sourceTable: string;
  sourceColumns: string[];
  targetTable: string;
  targetColumns: string[];
  [extra: string]: unknown;
}

export interface NamedSubschema {
  name: string;
  description: string;
  tables: string[];
  columns: Record<string, string[]> | null;
  excludedRelations: RelationRef[] | null;
}

export interface SqlSchema {
  alias: string;
  /** "agent", "direct" or "unknown" (an alias the server does not define). */
  kind: string;
  /** A DatabaseDialect name of the cloud (PostgreSQL, Firebird5, SQLite...), Default when unknown. */
  dialect: string;
  hubDatabaseId: number | null;
  hubSchemaId: number | null;
  schemaTables: SchemaTable[];
  schemas: NamedSubschema[];
  excludedRelations: RelationRef[] | null;
  /** Why the schema is empty or partial, when it is. */
  error: string | null;
  /** Who described it: "file" (the connection's local schema file), "hub" or "catalog". */
  source: string;
}

function emptySchema(alias: string, kind = 'unknown'): SqlSchema {
  return { alias, kind, dialect: 'Default', hubDatabaseId: null, hubSchemaId: null, schemaTables: [], schemas: [], excludedRelations: null, error: null, source: '' };
}

// ---- The local schema file (LocalSchemaFile of the engine) ----

type Extra = Record<string, unknown>;

export interface LocalSchemaColumn extends Extra {
  name: string;
  dataType: string;
  context: string;
  isPrimaryKey: boolean;
  detectedType: string;
  allowedValues?: AllowedValue[] | null;
}

export interface LocalSchemaForeignKey extends Extra {
  constraintName: string;
  targetTable: string;
  sourceColumns: string[];
  targetColumns: string[];
  relationshipContext: string;
}

export interface LocalSchemaTable extends Extra {
  name: string;
  context: string;
  columns: LocalSchemaColumn[];
  foreignKeys: LocalSchemaForeignKey[];
  /** False when the columns were not read (a large catalog); absent when they were. */
  columnsRead?: boolean | null;
}

export interface LocalSubschema extends Extra {
  name: string;
  description: string;
  tables: string[];
  columns?: Record<string, string[]> | null;
  excludedRelations?: RelationRef[] | null;
}

export interface LocalSchemaFile extends Extra {
  version: number;
  alias: string;
  dialect: string;
  generatedUtc: string;
  tables: LocalSchemaTable[];
  schemas: LocalSubschema[];
  excludedRelations?: RelationRef[] | null;
}

/** The folder of the files, next to dbxconnections.ini. */
export const SCHEMA_FOLDER = 'dbxschemas';
const CURRENT_VERSION = 2;
/** The number of tables from which a catalog is large: its file keeps the names only. */
export const LARGE_CATALOG_THRESHOLD = 5000;

const CLOUD_COLUMN_TYPES = ['Integer', 'Numeric', 'Currency', 'String', 'TextLong', 'Date', 'TimeStamp', 'Boolean'];

/** System.Text.Json reads the names of the members in any case (PropertyNameCaseInsensitive). */
function member(o: Extra, name: string): unknown {
  if (name in o) return o[name];
  const lower = name.toLowerCase();
  for (const k of Object.keys(o)) if (k.toLowerCase() === lower) return o[k];
  return undefined;
}

const str = (v: unknown, fallback = ''): string => (typeof v === 'string' ? v : v === null || v === undefined ? fallback : String(v));
const isObject = (v: unknown): v is Extra => v !== null && typeof v === 'object' && !Array.isArray(v);

/** The members of an object that are not the known ones, kept as they are (JsonExtensionData). */
function extraOf(o: Extra, known: readonly string[]): Extra {
  const set = new Set(known.map((k) => k.toLowerCase()));
  const extra: Extra = {};
  for (const [k, v] of Object.entries(o)) if (!set.has(k.toLowerCase())) extra[k] = v;
  return extra;
}

function stringList(v: unknown): string[] {
  return Array.isArray(v) ? v.map((x) => str(x)) : [];
}

function relationList(v: unknown): RelationRef[] | null {
  if (!Array.isArray(v)) return null;
  const result: RelationRef[] = [];
  for (const r of v) {
    if (!isObject(r)) continue;
    const ref: RelationRef = {
      sourceTable: str(member(r, 'sourceTable')),
      sourceColumns: stringList(member(r, 'sourceColumns')),
      targetTable: str(member(r, 'targetTable')),
      targetColumns: stringList(member(r, 'targetColumns')),
      ...extraOf(r, ['sourceTable', 'sourceColumns', 'targetTable', 'targetColumns']),
    };
    if (ref.sourceTable.length === 0 || ref.targetTable.length === 0) continue;
    if (!result.some((x) => sameRef(x, ref))) result.push(ref);
  }
  return result.length > 0 ? result : null;
}

const upper = (s: string) => s.toUpperCase();
const sameText = (a: string, b: string) => upper(a) === upper(b);
const sameList = (a: string[], b: string[]) => a.length === b.length && a.every((x, i) => sameText(x, b[i]!));

function sameRef(a: RelationRef, b: RelationRef): boolean {
  return sameText(a.sourceTable, b.sourceTable) && sameText(a.targetTable, b.targetTable) && sameList(a.sourceColumns, b.sourceColumns) && sameList(a.targetColumns, b.targetColumns);
}

/** LocalSchemaFile.Parse with LocalSchemaStore.Normalize: a file as the engine reads it. */
export function parseSchemaFile(text: string): LocalSchemaFile {
  const raw: unknown = JSON.parse(text.replace(/^﻿/, ''));
  const o = isObject(raw) ? raw : {};
  const tables: LocalSchemaTable[] = [];
  for (const t of Array.isArray(member(o, 'tables')) ? (member(o, 'tables') as unknown[]) : []) {
    if (!isObject(t)) continue;
    const name = str(member(t, 'name'));
    if (name.length === 0) continue;
    const columns: LocalSchemaColumn[] = [];
    for (const c of Array.isArray(member(t, 'columns')) ? (member(t, 'columns') as unknown[]) : []) {
      if (!isObject(c) || str(member(c, 'name')).length === 0) continue;
      let allowed: AllowedValue[] | null = null;
      const values = member(c, 'allowedValues');
      if (Array.isArray(values)) {
        allowed = values
          .filter((v): v is Extra => isObject(v) && str(member(v, 'value')).length > 0)
          .map((v) => ({ value: str(member(v, 'value')), label: str(member(v, 'label')), ...extraOf(v, ['value', 'label']) }));
        if (allowed.length === 0) allowed = null;
      }
      columns.push({
        name: str(member(c, 'name')),
        dataType: str(member(c, 'dataType'), 'String'),
        context: str(member(c, 'context')),
        isPrimaryKey: member(c, 'isPrimaryKey') === true,
        detectedType: str(member(c, 'detectedType')),
        ...(allowed !== null ? { allowedValues: allowed } : {}),
        ...extraOf(c, ['name', 'dataType', 'context', 'isPrimaryKey', 'detectedType', 'allowedValues']),
      });
    }
    const foreignKeys: LocalSchemaForeignKey[] = [];
    for (const f of Array.isArray(member(t, 'foreignKeys')) ? (member(t, 'foreignKeys') as unknown[]) : []) {
      if (!isObject(f)) continue;
      foreignKeys.push({
        constraintName: str(member(f, 'constraintName')),
        targetTable: str(member(f, 'targetTable')),
        sourceColumns: stringList(member(f, 'sourceColumns')),
        targetColumns: stringList(member(f, 'targetColumns')),
        relationshipContext: str(member(f, 'relationshipContext')),
        ...extraOf(f, ['constraintName', 'targetTable', 'sourceColumns', 'targetColumns', 'relationshipContext']),
      });
    }
    const table: LocalSchemaTable = {
      name,
      context: str(member(t, 'context')),
      columns,
      foreignKeys,
      ...extraOf(t, ['name', 'context', 'columns', 'foreignKeys', 'columnsRead']),
    };
    // Read is written as nothing, as every file before the mark
    if (member(t, 'columnsRead') === false) table.columnsRead = false;
    tables.push(table);
  }
  const schemas: LocalSubschema[] = [];
  for (const s of Array.isArray(member(o, 'schemas')) ? (member(o, 'schemas') as unknown[]) : []) {
    if (!isObject(s) || str(member(s, 'name')).trim().length === 0) continue;
    const subTables = stringList(member(s, 'tables')).filter((n) => n.length > 0);
    let columns: Record<string, string[]> | null = null;
    const given = member(s, 'columns');
    if (isObject(given)) {
      // Only tables of the subschema, and only tables with columns chosen (none chosen is all)
      const chosen: Record<string, string[]> = {};
      for (const [key, value] of Object.entries(given)) {
        if (key.length === 0 || !Array.isArray(value)) continue;
        const table = subTables.find((n) => sameText(n, key));
        const names = value.map((n) => str(n)).filter((n) => n.length > 0);
        if (table !== undefined && names.length > 0 && !(table in chosen)) chosen[table] = names;
      }
      columns = Object.keys(chosen).length > 0 ? chosen : null;
    }
    const sub: LocalSubschema = {
      name: str(member(s, 'name')),
      description: str(member(s, 'description')),
      tables: subTables,
      ...extraOf(s, ['name', 'description', 'tables', 'columns', 'excludedRelations']),
    };
    if (columns !== null) sub.columns = columns;
    const excluded = relationList(member(s, 'excludedRelations'));
    if (excluded !== null) sub.excludedRelations = excluded;
    schemas.push(sub);
  }
  const file: LocalSchemaFile = {
    version: typeof member(o, 'version') === 'number' ? (member(o, 'version') as number) : CURRENT_VERSION,
    alias: str(member(o, 'alias')),
    dialect: str(member(o, 'dialect'), 'Default'),
    generatedUtc: str(member(o, 'generatedUtc')),
    tables,
    schemas,
    ...extraOf(o, ['version', 'alias', 'dialect', 'generatedUtc', 'tables', 'schemas', 'excludedRelations']),
  };
  const excluded = relationList(member(o, 'excludedRelations'));
  if (excluded !== null) file.excludedRelations = excluded;
  return file;
}

/** The path of the file of an alias: the alias in upper case, the characters a file name cannot have as '_'. */
export function schemaFilePath(folder: string, alias: string): string {
  const name = alias.trim().toUpperCase();
  if (name.length === 0) throw new Error('No connection alias');
  return path.join(folder, name.replace(/[<>:"/\\|?*\u0000-\u001f]/g, '_') + '.json');
}

/** LocalSchemaStore.Load: the file, or null when there is none. */
export function loadSchemaFile(file: string): LocalSchemaFile | null {
  if (!existsSync(file)) return null;
  return parseSchemaFile(readFileSync(file, 'utf8'));
}

/** LocalSchemaStore.Save: indented, UTF-8 without BOM, written next to the old one and moved over it. */
export function saveSchemaFile(schema: LocalSchemaFile, file: string): void {
  if (schema.version < CURRENT_VERSION) schema.version = CURRENT_VERSION;
  mkdirSync(path.dirname(file), { recursive: true });
  const temp = file + '.tmp';
  writeFileSync(temp, JSON.stringify(schema, null, 2), 'utf8');
  if (existsSync(file)) rmSync(file);
  renameSync(temp, file);
}

/** DatabaseCatalogReader.LooseType: the cloud's column type of a declared database type. */
export function looseType(declared: string): string {
  const t = (declared ?? '').toUpperCase();
  if (t.includes('INT') || t.includes('SERIAL') || t.includes('SMALL') || t.includes('BIG')) return 'Integer';
  if (t.includes('BOOL') || t.includes('BIT')) return 'Boolean';
  if (t.includes('TIMESTAMP') || t.includes('DATETIME')) return 'TimeStamp';
  if (t.includes('DATE')) return 'Date';
  if (t.includes('CURRENCY') || t.includes('MONEY')) return 'Currency';
  if (t.includes('DEC') || t.includes('NUM') || t.includes('FLOAT') || t.includes('DOUBLE') || t.includes('REAL')) return 'Numeric';
  if (t.includes('TEXT') || t.includes('BLOB') || t.includes('CLOB')) return 'TextLong';
  return 'String';
}

/** LocalSchemaStore.CloudColumnType: an exact type name passes, else it is deduced from the declared type. */
export function cloudColumnType(dataType: string, detectedType: string): string {
  const d = (dataType ?? '').trim();
  const known = CLOUD_COLUMN_TYPES.find((k) => sameText(k, d));
  if (known !== undefined) return known;
  return looseType(d.length > 0 ? d : detectedType ?? '');
}

/** SqlSchemaFiles.ToSchema: the answer of a file. */
export function schemaOfFile(file: LocalSchemaFile, alias: string): SqlSchema {
  return {
    ...emptySchema(alias, 'direct'),
    dialect: file.dialect,
    schemaTables: file.tables.map((t) => ({
      name: t.name,
      context: t.context,
      columns: t.columns.map((c) => ({
        name: c.name,
        dataType: cloudColumnType(c.dataType, c.detectedType),
        context: c.context,
        isPrimaryKey: c.isPrimaryKey,
        detectedType: c.detectedType,
        allowedValues: c.allowedValues == null ? null : c.allowedValues.map((v) => ({ value: v.value, label: v.label })),
      })),
      foreignKeys: t.foreignKeys.map((fk) => ({
        constraintName: fk.constraintName,
        targetTable: fk.targetTable,
        sourceColumns: fk.sourceColumns,
        targetColumns: fk.targetColumns,
        relationshipContext: fk.relationshipContext,
      })),
    })),
    schemas: file.schemas.map((s) => ({
      name: s.name,
      description: s.description,
      tables: s.tables,
      columns: s.columns ?? null,
      excludedRelations: s.excludedRelations ?? null,
    })),
    excludedRelations: file.excludedRelations ?? null,
  };
}

const isRead = (t: LocalSchemaTable) => t.columnsRead !== false;

/** LocalSchemaStore.TablesToRead: the tables of the subschemas and the ones whose columns were read. */
function tablesToRead(file: LocalSchemaFile | null): string[] {
  const result: string[] = [];
  if (file === null) return result;
  const seen = new Set<string>();
  const add = (n: string) => {
    if (n.length > 0 && !seen.has(upper(n))) {
      seen.add(upper(n));
      result.push(n);
    }
  };
  for (const s of file.schemas) for (const n of s.tables) add(n);
  for (const t of file.tables) if (isRead(t)) add(t.name);
  return result;
}

function sameRelation(a: LocalSchemaForeignKey, b: LocalSchemaForeignKey): boolean {
  return sameText(a.targetTable, b.targetTable) && sameList(a.sourceColumns, b.sourceColumns) && sameList(a.targetColumns, b.targetColumns);
}

function extraFields<T extends Extra>(o: T, known: readonly string[]): Extra {
  return extraOf(o, known);
}

const TABLE_KEYS = ['name', 'context', 'columns', 'foreignKeys', 'columnsRead'];
const COLUMN_KEYS = ['name', 'dataType', 'context', 'isPrimaryKey', 'detectedType', 'allowedValues'];
const FK_KEYS = ['constraintName', 'targetTable', 'sourceColumns', 'targetColumns', 'relationshipContext'];

/**
 * LocalSchemaStore.Merge: the file just read from the catalog with what the previous one had that
 * the catalog cannot know (contexts, allowed values, relations added by hand, what a newer version
 * wrote) for what still exists, and its subschemas without the tables and columns that are gone.
 */
export function mergeSchemaFiles(previous: LocalSchemaFile | null, fresh: LocalSchemaFile): LocalSchemaFile {
  if (previous === null) return fresh;
  const oldTables = new Map<string, LocalSchemaTable>();
  for (const t of previous.tables) if (!oldTables.has(upper(t.name))) oldTables.set(upper(t.name), t);
  const freshTables = new Map<string, LocalSchemaTable>();
  for (const table of fresh.tables) {
    if (!freshTables.has(upper(table.name))) freshTables.set(upper(table.name), table);
    const old = oldTables.get(upper(table.name));
    if (old === undefined) continue;
    if (old.context.length > 0) table.context = old.context;
    Object.assign(table, extraFields(old, TABLE_KEYS));
    if (!isRead(table) && isRead(old)) {
      // Read before and not in this reading (a large catalog): what was read stays
      table.columns = old.columns;
      table.foreignKeys = old.foreignKeys.filter((fk) => fk.constraintName.length > 0);
      delete table.columnsRead;
      continue;
    }
    for (const column of table.columns) {
      const oldColumn = old.columns.find((c) => sameText(c.name, column.name));
      if (oldColumn === undefined) continue;
      if (oldColumn.context.length > 0) column.context = oldColumn.context;
      if (oldColumn.allowedValues != null) column.allowedValues = oldColumn.allowedValues;
      else delete column.allowedValues;
      Object.assign(column, extraFields(oldColumn, COLUMN_KEYS));
    }
    for (const fk of table.foreignKeys) {
      const oldFk = old.foreignKeys.find((f) => f.constraintName.length > 0 && sameText(f.constraintName, fk.constraintName));
      if (oldFk === undefined) continue;
      if (oldFk.relationshipContext.length > 0) fk.relationshipContext = oldFk.relationshipContext;
      Object.assign(fk, extraFields(oldFk, FK_KEYS));
    }
  }
  // The relations people added (no constraint name), while both ends are still there
  const spelled = (table: LocalSchemaTable, names: string[]): string[] | null => {
    const result: string[] = [];
    for (const n of names) {
      const c = table.columns.find((x) => sameText(x.name, n));
      if (c === undefined) return null;
      result.push(c.name);
    }
    return result;
  };
  for (const table of fresh.tables) {
    const old = oldTables.get(upper(table.name));
    if (old === undefined) continue;
    for (const oldFk of old.foreignKeys) {
      if (oldFk.constraintName.length > 0) continue;
      const target = oldFk.targetTable.length > 0 ? freshTables.get(upper(oldFk.targetTable)) : undefined;
      if (target === undefined || oldFk.sourceColumns.length === 0 || oldFk.sourceColumns.length !== oldFk.targetColumns.length) continue;
      const source = spelled(table, oldFk.sourceColumns);
      const targetColumns = spelled(target, oldFk.targetColumns);
      if (source === null || targetColumns === null) continue;
      const manual: LocalSchemaForeignKey = {
        ...extraFields(oldFk, FK_KEYS),
        constraintName: '',
        targetTable: target.name,
        sourceColumns: source,
        targetColumns,
        relationshipContext: oldFk.relationshipContext,
      };
      const same = table.foreignKeys.find((fk) => sameRelation(fk, manual));
      if (same === undefined) table.foreignKeys.push(manual);
      else if (same.relationshipContext.length === 0) same.relationshipContext = manual.relationshipContext;
    }
  }
  fresh.schemas = previous.schemas.map((schema) => {
    const kept: LocalSubschema = { ...extraFields(schema, ['name', 'description', 'tables', 'columns', 'excludedRelations']), name: schema.name, description: schema.description, tables: [] };
    if (schema.excludedRelations != null) kept.excludedRelations = schema.excludedRelations;
    for (const name of schema.tables) {
      const current = freshTables.get(upper(name))?.name;
      if (current !== undefined && !kept.tables.includes(current)) kept.tables.push(current);
    }
    if (schema.columns != null) {
      for (const [key, names] of Object.entries(schema.columns)) {
        const table = freshTables.get(upper(key));
        if (table === undefined || !kept.tables.includes(table.name)) continue;
        const columns: string[] = [];
        for (const name of names) {
          const column = table.columns.find((c) => sameText(c.name, name));
          if (column !== undefined && !columns.includes(column.name)) columns.push(column.name);
          else if (column === undefined && !isRead(table) && !columns.includes(name)) columns.push(name);
        }
        if (columns.length > 0) (kept.columns ??= {})[table.name] = columns;
      }
    }
    return kept;
  });
  if (fresh.alias.length === 0) fresh.alias = previous.alias;
  if (previous.excludedRelations != null) fresh.excludedRelations = previous.excludedRelations;
  else delete fresh.excludedRelations;
  Object.assign(fresh, extraFields(previous, ['version', 'alias', 'dialect', 'generatedUtc', 'tables', 'schemas', 'excludedRelations']));
  if (previous.version > fresh.version) fresh.version = previous.version;
  return fresh;
}

// ---- Reading the catalog through a connection ----

/** The family of a database, by the provider of its connection. */
export type CatalogFamily = 'sqlite' | 'postgresql' | 'mysql' | 'sqlserver' | 'firebird' | 'other';

/** The family of a provider of dbxconnections.ini (SQLiteCore, PostgreSQL, MySQLConnector, SQLServer, FirebirdSql.Data.FirebirdClient). */
export function familyOfProvider(providerFactory: string | null | undefined): CatalogFamily {
  const p = (providerFactory ?? '').trim().toUpperCase();
  if (p.includes('SQLITE')) return 'sqlite';
  if (p.includes('POSTGRE') || p.includes('NPGSQL')) return 'postgresql';
  if (p.includes('MYSQL')) return 'mysql';
  if (p === 'SQLSERVER' || p.includes('SQLCLIENT') || p.includes('MSSQL')) return 'sqlserver';
  if (p.includes('FIREBIRD')) return 'firebird';
  return 'other';
}

const command = (sql: string) => ({ sql, parameters: [], dataset: '' });
const text = (v: DataValue): string => (v === null || v === undefined ? '' : typeof v === 'string' ? v : String(v));

async function rows(connection: DataConnection, sql: string): Promise<QueryResult> {
  return await connection.query(command(sql));
}

function quote(family: CatalogFamily, name: string): string {
  if (family === 'mysql') return '`' + name.replace(/`/g, '``') + '`';
  if (family === 'sqlserver') return '[' + name.replace(/]/g, ']]') + ']';
  return '"' + name.replace(/"/g, '""') + '"';
}

/** DatabaseCatalogReader.CloudType: the cloud's column type of a column type of the engine (the .NET type). */
function cloudType(type: DataColumnInfo['type']): string {
  switch (type) {
    case 'Int64':
    case 'Int32':
    case 'Int16':
    case 'Byte':
      return 'Integer';
    case 'Double':
    case 'Single':
    case 'Decimal':
      return 'Numeric';
    case 'Boolean':
      return 'Boolean';
    case 'DateTime':
      return 'TimeStamp';
    case 'Binary':
      return 'TextLong';
    default:
      return 'String';
  }
}

/** The dialect of the cloud for an open connection of a family. */
async function dialectOf(family: CatalogFamily, connection: DataConnection): Promise<string> {
  switch (family) {
    case 'sqlite':
      return 'SQLite';
    case 'postgresql':
      return 'PostgreSQL';
    case 'mysql':
      return 'MySQL';
    case 'sqlserver':
      return 'SQLServer';
    case 'firebird': {
      // C#: the major version after "-V" of ServerVersion ("WI-V5.0.1.1469"); here the engine version ("5.0.1")
      let version = '';
      try {
        const r = await rows(connection, "select rdb$get_context('SYSTEM', 'ENGINE_VERSION') from rdb$database");
        version = text(r.rows[0]?.[0]);
      } catch {
        // the default
      }
      const major = version.trim()[0] ?? '5';
      return major === '2' || major === '3' ? 'Firebird2' : major === '4' ? 'Firebird4' : major === '1' ? 'Firebird1' : 'Firebird5';
    }
    default:
      return 'Default';
  }
}

interface CatalogName {
  name: string;
  schema: string;
}

const SYSTEM_SCHEMAS = new Set(['INFORMATION_SCHEMA', 'PG_CATALOG', 'SYS', 'SYSTEM', 'MYSQL', 'PERFORMANCE_SCHEMA']);

async function tableNames(family: CatalogFamily, connection: DataConnection): Promise<CatalogName[]> {
  let result: CatalogName[] = [];
  if (family === 'sqlite') {
    const r = await rows(connection, "SELECT name FROM sqlite_master WHERE type IN ('table','view') AND name NOT LIKE 'sqlite_%' ORDER BY name");
    return r.rows.map((row) => ({ name: text(row[0]), schema: '' }));
  }
  if (family === 'firebird') {
    const r = await rows(connection, 'SELECT TRIM(RDB$RELATION_NAME) FROM RDB$RELATIONS WHERE COALESCE(RDB$SYSTEM_FLAG, 0) = 0');
    result = r.rows.map((row) => ({ name: text(row[0]).trim(), schema: '' })).filter((t) => t.name.length > 0 && !t.name.includes('$'));
  } else {
    const where = family === 'mysql' ? ' WHERE TABLE_SCHEMA = DATABASE()' : '';
    const r = await rows(connection, 'SELECT TABLE_NAME, TABLE_SCHEMA, TABLE_TYPE FROM INFORMATION_SCHEMA.TABLES' + where);
    const seen = new Set<string>();
    for (const row of r.rows) {
      const name = text(row[0]).trim();
      const schema = text(row[1]).trim();
      if (name.length === 0 || text(row[2]).toUpperCase().includes('SYSTEM')) continue;
      const s = schema.toUpperCase();
      if (SYSTEM_SCHEMAS.has(s) || s.startsWith('PG_TOAST')) continue;
      if (seen.has(upper(name))) continue;
      seen.add(upper(name));
      result.push({ name, schema });
    }
  }
  // string.Compare(..., OrdinalIgnoreCase)
  return result.sort((a, b) => (upper(a.name) < upper(b.name) ? -1 : upper(a.name) > upper(b.name) ? 1 : 0));
}

async function sqliteColumns(connection: DataConnection, table: LocalSchemaTable): Promise<void> {
  try {
    const r = await rows(connection, 'PRAGMA table_info("' + table.name.replace(/"/g, '""') + '")');
    for (const row of r.rows) {
      const declared = row[2] === null || row[2] === undefined ? '' : text(row[2]);
      const pk = row[5];
      table.columns.push({
        name: text(row[1]),
        dataType: looseType(declared),
        context: '',
        isPrimaryKey: pk !== null && pk !== undefined && Number(pk) > 0,
        detectedType: declared,
      });
    }
  } catch {
    // listed without columns
  }
}

async function sqliteForeignKeys(connection: DataConnection, table: LocalSchemaTable): Promise<void> {
  const r = await rows(connection, 'PRAGMA foreign_key_list("' + table.name.replace(/"/g, '""') + '")');
  const byId = new Map<string, LocalSchemaForeignKey>();
  for (const row of r.rows) {
    const id = text(row[0]);
    let fk = byId.get(id);
    if (fk === undefined) {
      fk = { constraintName: 'FK_' + table.name + '_' + id, targetTable: text(row[2]), sourceColumns: [], targetColumns: [], relationshipContext: '' };
      byId.set(id, fk);
      table.foreignKeys.push(fk);
    }
    fk.sourceColumns.push(row[3] === null || row[3] === undefined ? '' : text(row[3]));
    fk.targetColumns.push(row[4] === null || row[4] === undefined ? '' : text(row[4]));
  }
}

/** The columns of a table from the columns of an empty SELECT * (TryColumnsFromReader without KeyInfo). */
async function readerColumns(family: CatalogFamily, connection: DataConnection, table: LocalSchemaTable): Promise<void> {
  try {
    const sql = family === 'sqlserver' ? 'SELECT TOP 0 * FROM ' + quote(family, table.name) : 'SELECT * FROM ' + quote(family, table.name) + ' WHERE 1=0';
    const r = await rows(connection, sql);
    for (const c of r.columns) {
      const declared = (c.declaredType ?? '').trim();
      let dataType = cloudType(c.type);
      // The .NET type does not tell a date from a timestamp, nor a long text from a short one
      if (declared.length > 0) {
        const loose = looseType(declared);
        if ((dataType === 'TimeStamp' && loose === 'Date') || (dataType === 'String' && loose === 'TextLong')) dataType = loose;
      }
      const name = c.name.trim();
      if (name.length > 0)
        table.columns.push({ name, dataType, context: '', isPrimaryKey: false, detectedType: declared.length > 0 ? declared : 'System.' + (c.type === 'Binary' ? 'Byte[]' : c.type) });
    }
  } catch {
    table.columns = [];
  }
}

const PRIMARY_KEYS_SQL = `SELECT kcu.TABLE_NAME, kcu.COLUMN_NAME
FROM INFORMATION_SCHEMA.TABLE_CONSTRAINTS tc
JOIN INFORMATION_SCHEMA.KEY_COLUMN_USAGE kcu ON kcu.CONSTRAINT_NAME = tc.CONSTRAINT_NAME AND kcu.CONSTRAINT_SCHEMA = tc.CONSTRAINT_SCHEMA AND kcu.TABLE_NAME = tc.TABLE_NAME
WHERE tc.CONSTRAINT_TYPE = 'PRIMARY KEY'`;

const FOREIGN_KEYS_SQL = `SELECT rc.CONSTRAINT_NAME AS CN, kcu.TABLE_NAME AS FK_TABLE, kcu.COLUMN_NAME AS FK_COLUMN, kcu.ORDINAL_POSITION AS POS, kcu2.TABLE_NAME AS PK_TABLE, kcu2.COLUMN_NAME AS PK_COLUMN
FROM INFORMATION_SCHEMA.REFERENTIAL_CONSTRAINTS rc
JOIN INFORMATION_SCHEMA.KEY_COLUMN_USAGE kcu ON kcu.CONSTRAINT_NAME = rc.CONSTRAINT_NAME AND kcu.CONSTRAINT_SCHEMA = rc.CONSTRAINT_SCHEMA
JOIN INFORMATION_SCHEMA.KEY_COLUMN_USAGE kcu2 ON kcu2.CONSTRAINT_NAME = rc.UNIQUE_CONSTRAINT_NAME AND kcu2.CONSTRAINT_SCHEMA = rc.UNIQUE_CONSTRAINT_SCHEMA AND kcu2.ORDINAL_POSITION = kcu.ORDINAL_POSITION
ORDER BY kcu.TABLE_NAME, rc.CONSTRAINT_NAME, kcu.ORDINAL_POSITION`;

const FIREBIRD_PRIMARY_KEYS_SQL = `SELECT TRIM(rc.RDB$RELATION_NAME), TRIM(s.RDB$FIELD_NAME)
FROM RDB$RELATION_CONSTRAINTS rc JOIN RDB$INDEX_SEGMENTS s ON s.RDB$INDEX_NAME = rc.RDB$INDEX_NAME
WHERE rc.RDB$CONSTRAINT_TYPE = 'PRIMARY KEY'`;

const FIREBIRD_FOREIGN_KEYS_SQL = `SELECT TRIM(rc.RDB$CONSTRAINT_NAME) AS CN, TRIM(rc.RDB$RELATION_NAME) AS FK_TABLE, TRIM(s.RDB$FIELD_NAME) AS FK_COLUMN, s.RDB$FIELD_POSITION AS POS,
TRIM(pk.RDB$RELATION_NAME) AS PK_TABLE, TRIM(ps.RDB$FIELD_NAME) AS PK_COLUMN
FROM RDB$RELATION_CONSTRAINTS rc
JOIN RDB$REF_CONSTRAINTS ref ON ref.RDB$CONSTRAINT_NAME = rc.RDB$CONSTRAINT_NAME
JOIN RDB$RELATION_CONSTRAINTS pk ON pk.RDB$CONSTRAINT_NAME = ref.RDB$CONST_NAME_UQ
JOIN RDB$INDEX_SEGMENTS s ON s.RDB$INDEX_NAME = rc.RDB$INDEX_NAME
JOIN RDB$INDEX_SEGMENTS ps ON ps.RDB$INDEX_NAME = pk.RDB$INDEX_NAME AND ps.RDB$FIELD_POSITION = s.RDB$FIELD_POSITION
WHERE rc.RDB$CONSTRAINT_TYPE = 'FOREIGN KEY'
ORDER BY rc.RDB$RELATION_NAME, rc.RDB$CONSTRAINT_NAME, s.RDB$FIELD_POSITION`;

async function primaryKeys(connection: DataConnection, sql: string): Promise<Set<string>> {
  const result = new Set<string>();
  const r = await rows(connection, sql);
  for (const row of r.rows) result.add(upper(text(row[0]).trim() + '.' + text(row[1]).trim()));
  return result;
}

async function foreignKeys(connection: DataConnection, sql: string): Promise<Map<string, LocalSchemaForeignKey[]>> {
  const result = new Map<string, LocalSchemaForeignKey[]>();
  const r = await rows(connection, sql);
  let current: LocalSchemaForeignKey | null = null;
  let currentTable = '';
  for (const row of r.rows) {
    const tableName = text(row[1]).trim();
    const name = text(row[0]).trim();
    if (current === null || current.constraintName !== name || currentTable !== tableName) {
      current = { constraintName: name, targetTable: text(row[4]).trim(), sourceColumns: [], targetColumns: [], relationshipContext: '' };
      currentTable = tableName;
      const list = result.get(upper(tableName)) ?? [];
      list.push(current);
      result.set(upper(tableName), list);
    }
    current.sourceColumns.push(text(row[2]).trim());
    current.targetColumns.push(text(row[5]).trim());
  }
  return result;
}

/**
 * LocalSchemaStore.Generate: the catalog of a connection read into a new file for an alias. A
 * large catalog (more than LARGE_CATALOG_THRESHOLD tables) reads the columns of the tables of
 * the previous file only, the others marked as not read.
 */
export async function generateSchemaFile(family: CatalogFamily, connection: DataConnection, alias: string, previous: LocalSchemaFile | null, now: Date): Promise<LocalSchemaFile> {
  if (family === 'other') throw new Error('The catalog of this database cannot be read: its provider is not known');
  const names = await tableNames(family, connection);
  const large = names.length > LARGE_CATALOG_THRESHOLD;
  const wanted = large ? new Set(tablesToRead(previous).map((n) => upper(n.trim()))) : null;
  const tables: LocalSchemaTable[] = [];
  const details: LocalSchemaTable[] = [];
  for (const n of names) {
    const table: LocalSchemaTable = { name: n.name, context: '', columns: [], foreignKeys: [] };
    if (wanted === null || wanted.has(upper(n.name))) details.push(table);
    else table.columnsRead = false;
    tables.push(table);
  }
  let pks: Set<string> | null = null;
  let fks: Map<string, LocalSchemaForeignKey[]> | null = null;
  if (family !== 'sqlite' && details.length > 0) {
    try {
      fks = await foreignKeys(connection, family === 'firebird' ? FIREBIRD_FOREIGN_KEYS_SQL : FOREIGN_KEYS_SQL);
    } catch {
      fks = new Map();
    }
    try {
      pks = await primaryKeys(connection, family === 'firebird' ? FIREBIRD_PRIMARY_KEYS_SQL : PRIMARY_KEYS_SQL);
    } catch {
      pks = null;
    }
  }
  for (const table of details) {
    if (family === 'sqlite') {
      await sqliteColumns(connection, table);
      try {
        await sqliteForeignKeys(connection, table);
      } catch {
        // a table whose foreign keys cannot be read keeps its columns
      }
      continue;
    }
    await readerColumns(family, connection, table);
    if (pks !== null) for (const c of table.columns) c.isPrimaryKey = pks.has(upper(table.name + '.' + c.name));
    table.foreignKeys.push(...(fks?.get(upper(table.name)) ?? []));
  }
  return {
    version: CURRENT_VERSION,
    alias: alias.trim().toUpperCase(),
    dialect: await dialectOf(family, connection),
    generatedUtc: now.toISOString().substring(0, 19) + 'Z',
    tables,
    schemas: [],
  };
}

/** What the schema service knows of a connection alias. */
export type SchemaConnection =
  | {
      kind: 'direct';
      alias: string;
      family: CatalogFamily;
      /** The connection the server opens for it; undefined when it cannot (factoryError says why). */
      factory: ConnectionFactory | undefined;
      factoryError?: string;
      definition: ConnectionDefinition | null;
      /** A connection of dbxconnections.ini: its schema is kept in a local schema file. */
      keepsFile: boolean;
      /** What the alias opens, for the cache of the catalogs. */
      fingerprint: string;
    }
  | { kind: 'agent'; alias: string; hubDatabaseId: number | null };

const CATALOG_CACHE_MS = 5 * 60 * 1000;

/** SqlSchemaService: the schema of a connection alias for the SQL editor. */
export class SqlSchemaService {
  private readonly catalogCache = new Map<string, { schema: SqlSchema; expires: number }>();

  /**
   * @param find What the server knows of an alias (null: it does not define it).
   * @param folder The folder of the local schema files (dataPath/dbxschemas), null without a data folder.
   */
  constructor(
    private readonly find: (alias: string) => SchemaConnection | null,
    private readonly folder: string | null,
    private readonly now: () => Date = () => new Date(),
  ) {}

  async get(aliasGiven: string, refresh: boolean): Promise<SqlSchema> {
    const alias = (aliasGiven ?? '').trim();
    const definition = this.find(alias);
    if (definition === null) return { ...emptySchema(alias), error: 'Database alias not found: ' + alias };
    if (definition.kind === 'agent') {
      // The Hub describes the databases of Agent connections to the AI package of Reportman.Server
      const schema: SqlSchema = { ...emptySchema(alias, 'agent'), hubDatabaseId: definition.hubDatabaseId, source: 'hub' };
      schema.error =
        definition.hubDatabaseId === null || definition.hubDatabaseId <= 0
          ? 'The Agent connection has no HubDatabaseId'
          : 'This server cannot read the schema of Agent connections (it has no Reportman AI)';
      return schema;
    }
    if (definition.keepsFile && this.folder !== null) return { ...(await this.fromFile(alias, definition, refresh)), source: 'file' };
    // A connection the program opens itself: its catalog, kept a few minutes
    const key = alias.toUpperCase() + '|' + definition.fingerprint;
    const cached = this.catalogCache.get(key);
    if (!refresh && cached !== undefined && cached.expires > Date.now()) return cached.schema;
    const schema = { ...(await this.fromCatalog(alias, definition)), source: 'catalog' };
    if (schema.error === null) this.catalogCache.set(key, { schema, expires: Date.now() + CATALOG_CACHE_MS });
    return schema;
  }

  /** The catalog of the connection read into a file (opened and closed here); a failure is the error. */
  private async generate(alias: string, definition: Extract<SchemaConnection, { kind: 'direct' }>, previous: LocalSchemaFile | null): Promise<{ file: LocalSchemaFile | null; error: string | null }> {
    if (definition.factory === undefined) return { file: null, error: alias + ': ' + (definition.factoryError ?? 'the connection cannot be opened on this server') };
    let connection: DataConnection | undefined;
    try {
      connection = await definition.factory(schemaRequest(alias, definition));
      const family = definition.family === 'other' ? await probeFamily(connection) : definition.family;
      return { file: await generateSchemaFile(family, connection, alias, previous, this.now()), error: null };
    } catch (e) {
      return { file: null, error: alias + ': ' + (e instanceof Error ? e.message : String(e)) };
    } finally {
      try {
        // A read: nothing to commit
        await connection?.close(false);
      } catch {
        // best effort
      }
    }
  }

  /** FromFileAsync: the file of the connection, generated (or, with refresh, read again and merged) from the catalog. */
  private async fromFile(alias: string, definition: Extract<SchemaConnection, { kind: 'direct' }>, refresh: boolean): Promise<SqlSchema> {
    const file = schemaFilePath(this.folder!, alias);
    let previous: LocalSchemaFile | null = null;
    try {
      previous = loadSchemaFile(file);
    } catch {
      // a file that cannot be read is generated again
    }
    if (previous !== null && !refresh) return schemaOfFile(previous, alias);
    const { file: fresh, error } = await this.generate(alias, definition, previous);
    if (fresh === null) {
      if (previous === null) return { ...emptySchema(alias, 'direct'), error };
      // The database does not answer now: what the file had, saying why it is not fresh
      return { ...schemaOfFile(previous, alias), error };
    }
    const merged = mergeSchemaFiles(previous, fresh);
    try {
      saveSchemaFile(merged, file);
    } catch {
      // the answer is the schema all the same
    }
    return schemaOfFile(merged, alias);
  }

  /** FromCatalog: the schema of a connection read from its catalog, without a file. */
  private async fromCatalog(alias: string, definition: Extract<SchemaConnection, { kind: 'direct' }>): Promise<SqlSchema> {
    const { file, error } = await this.generate(alias, definition, null);
    if (file === null) return { ...emptySchema(alias, 'direct'), error };
    return schemaOfFile(file, alias);
  }
}

/** The ConnectionRequest of a connection opened to read its catalog (no report: the server's connection). */
function schemaRequest(alias: string, definition: Extract<SchemaConnection, { kind: 'direct' }>): ConnectionRequest {
  const database = new DatabaseInfo();
  database.alias = alias;
  database.providerFactory = definition.definition?.providerFactory ?? '';
  database.connectionString = definition.definition?.connectionString ?? '';
  database.loadParams = false;
  return {
    database,
    alias,
    connectionString: database.connectionString,
    providerFactory: database.providerFactory,
    engineSqlite: false,
    dbParam: () => '',
    isolationLevel: 'ReadCommitted',
  };
}

/**
 * The family of a database the program opens (its provider is not known): asked to the database
 * itself, first with version(), which PostgreSQL and MySQL answer (a failed query aborts the
 * transaction of PostgreSQL: it must be the first), then the functions of SQLite, SQL Server and
 * Firebird.
 */
async function probeFamily(connection: DataConnection): Promise<CatalogFamily> {
  const first = async (sql: string): Promise<string | null> => {
    try {
      return text((await rows(connection, sql)).rows[0]?.[0]);
    } catch {
      return null;
    }
  };
  const version = await first('SELECT version()');
  if (version !== null) return /postgres/i.test(version) ? 'postgresql' : 'mysql';
  if ((await first('select sqlite_version()')) !== null) return 'sqlite';
  if ((await first('SELECT @@VERSION')) !== null) return 'sqlserver';
  if ((await first("select rdb$get_context('SYSTEM', 'ENGINE_VERSION') from rdb$database")) !== null) return 'firebird';
  return 'other';
}
