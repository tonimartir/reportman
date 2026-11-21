// A report connection on PostgreSQL with the behaviour of Npgsql 10, the provider the C# engine
// (Reportman.Server) opens PostgreSQL with: the implicit transaction with the report's isolation
// level, the SQL rewritten and the parameters bound as Npgsql does, the first result set of the
// command read with the column types and values Npgsql gives, and Npgsql's errors.

import { EOL } from 'node:os';
import {
  CultureInfo,
  NetException,
  type ConnectionRequest,
  type DataColumnInfo,
  type DataConnection,
  type DataValue,
  type IsolationLevelName,
  type MaybePromise,
  type QueryCommand,
  type QueryParameter,
  type QueryResult,
} from '@reportman/engine';
import type pg from 'pg';
import { PostgresException, invalidCast, invalidOperation, notSupported, npgsqlException } from './errors.js';
import { bindParameter, type WireParameter } from './params.js';
import type { RawField, RawResult } from './raw.js';
import { parseSql } from './sql.js';
import { AsyncTransport, SyncTransport, TransportError, type Transport } from './transport.js';
import { TypeCatalog, catalogQuery, columnSize, dataTypeName, type CatalogRow } from './types.js';
import { columnReader, isUnsupported, type ReadContext } from './values.js';

/** What every connection of a factory shares. */
export interface ConnectionSettings {
  config: pg.ClientConfig;
  includeErrorDetail: boolean;
  culture: CultureInfo;
  synchronous: boolean;
  /** The longest a synchronous call may wait (ms). */
  maxWaitMs: number;
}

// ---------------------------------------------------------------------------------------------
// Operations that run synchronously or asynchronously, as the transport answers

type Op<T> = Generator<unknown, T, unknown>;

function* wait<T>(value: MaybePromise<T>): Op<T> {
  return (yield value) as T;
}

function drive<T>(op: Op<T>, synchronous: boolean): MaybePromise<T> {
  if (synchronous) {
    let input: unknown = undefined;
    for (;;) {
      const step = op.next(input);
      if (step.done) return step.value;
      input = step.value;
    }
  }
  return (async () => {
    let input: unknown = undefined;
    let error: unknown = undefined;
    let failed = false;
    for (;;) {
      const step = failed ? op.throw(error) : op.next(input);
      failed = false;
      if (step.done) return step.value;
      try {
        input = await step.value;
      } catch (e) {
        error = e;
        failed = true;
      }
    }
  })();
}

// ---------------------------------------------------------------------------------------------

const NULL_REFERENCE = 'Object reference not set to an instance of an object.';

/**
 * The exception Npgsql raises for a failure of the transport: the server's errors as
 * PostgresException, a server that cannot be reached as "Failed to connect to address:port".
 */
function toException(e: unknown, includeErrorDetail: boolean, connecting?: pg.ClientConfig): unknown {
  if (!(e instanceof TransportError)) return e;
  const raw = e.raw;
  if (raw.server) return new PostgresException({ message: raw.message, ...raw.fields }, includeErrorDetail);
  if (connecting !== undefined) {
    const address = raw.address ?? connecting.host ?? 'localhost';
    const port = raw.port ?? connecting.port ?? 5432;
    const failure = npgsqlException(`Failed to connect to ${address}:${String(port)}`, e);
    failure.message += raw.address === undefined && raw.message.length > 0 ? EOL + raw.message : '';
    return failure;
  }
  return npgsqlException(raw.message, e);
}

/** NpgsqlConnection.BeginTransaction(level): the BEGIN Npgsql sends. */
function beginSql(level: IsolationLevelName): string {
  switch (level) {
    case 'RepeatableRead':
    case 'Snapshot':
      return 'BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ';
    case 'Serializable':
      return 'BEGIN TRANSACTION ISOLATION LEVEL SERIALIZABLE';
    case 'ReadUncommitted':
      return 'BEGIN TRANSACTION ISOLATION LEVEL READ UNCOMMITTED';
    case 'ReadCommitted':
    case 'Unspecified':
      return 'BEGIN TRANSACTION ISOLATION LEVEL READ COMMITTED';
    case 'Chaos':
      throw notSupported('Unsupported IsolationLevel: Chaos');
  }
}

/** String.Equals(a, b, StringComparison.OrdinalIgnoreCase). */
function ordinalIgnoreCase(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    const x = a.charAt(i);
    const y = b.charAt(i);
    if (x === y) continue;
    const ux = x.toUpperCase();
    const uy = y.toUpperCase();
    if (ux.length !== 1 || uy.length !== 1 || ux !== uy) return false;
  }
  return true;
}

/** NpgsqlParameterCollection.IndexOf(name): its name without prefix, exact first, then ignoring case. */
function parameterIndex(parameters: readonly QueryParameter[], name: string): number {
  const trimmed = parameters.map((p) => (p.name.startsWith(':') || p.name.startsWith('@') ? p.name.substring(1) : p.name));
  const exact = trimmed.indexOf(name);
  if (exact >= 0) return exact;
  return trimmed.findIndex((t) => ordinalIgnoreCase(t, name));
}

/** A PostgreSQL array literal of texts. */
function textArray(values: readonly string[]): string {
  return '{' + values.map((v) => '"' + v.replace(/\\/g, '\\\\').replace(/"/g, '\\"') + '"').join(',') + '}';
}

/** An open report connection. */
export class PostgresConnection implements DataConnection {
  private readonly transport: Transport;
  private readonly settings: ConnectionSettings;
  private readonly catalog = new TypeCatalog();
  private readonly standardConformingStrings: boolean;
  private readonly serverMajor: number;
  private open = true;

  private constructor(transport: Transport, settings: ConnectionSettings, parameters: Record<string, string>) {
    this.transport = transport;
    this.settings = settings;
    this.standardConformingStrings = (parameters.standard_conforming_strings ?? 'on') === 'on';
    this.serverMajor = parseInt(parameters.server_version ?? '17', 10);
  }

  /** Opens a connection and starts its implicit transaction (DatabaseInfo.Connect). */
  static open(settings: ConnectionSettings, request: ConnectionRequest): MaybePromise<PostgresConnection> {
    return drive(PostgresConnection.openOp(settings, request), settings.synchronous);
  }

  private static *openOp(settings: ConnectionSettings, request: ConnectionRequest): Op<PostgresConnection> {
    const transport: Transport = settings.synchronous ? new SyncTransport(settings.maxWaitMs) : new AsyncTransport();
    let parameters: Record<string, string>;
    try {
      parameters = yield* wait(transport.open(settings.config));
    } catch (e) {
      throw toException(e, settings.includeErrorDetail, settings.config);
    }
    try {
      const begin = beginSql(request.isolationLevel);
      // The text formats the values are read in: ISO dates (the field order of the server is
      // kept), postgres intervals, the shortest exact text of floats
      const setup: string[] = [];
      const dateStyle = parameters.DateStyle ?? 'ISO, MDY';
      if (!/^\s*ISO\b/i.test(dateStyle)) setup.push('SET DateStyle TO ISO');
      if ((parameters.IntervalStyle ?? 'postgres') !== 'postgres') setup.push('SET IntervalStyle TO postgres');
      setup.push('SET extra_float_digits TO 3');
      setup.push(begin);
      yield* wait(transport.simple(setup.join('; ')));
    } catch (e) {
      try {
        yield* wait(transport.close());
      } catch {
        // the original error is the one to report
      }
      throw toException(e, settings.includeErrorDetail);
    }
    return new PostgresConnection(transport, settings, parameters);
  }

  /** IDbCommand.ExecuteReader: the first result set of the command, read whole. */
  query(command: QueryCommand): MaybePromise<QueryResult> {
    return drive(this.queryOp(command), this.transport.synchronous);
  }

  private *queryOp(command: QueryCommand): Op<QueryResult> {
    if (!this.open) throw invalidOperation('Connection is not open');
    // Npgsql checks every parameter of the command, used in the SQL or not
    const wire: WireParameter[] = command.parameters.map(bindParameter);
    const statements = parseSql(command.sql, (name) => parameterIndex(command.parameters, name), this.standardConformingStrings);
    let first: RawResult | null = null;
    try {
      for (const st of statements) {
        if (st.sql.trim().length === 0) continue;
        const r = yield* wait(
          this.transport.query({
            text: st.sql,
            values: st.parameters.map((i) => wire[i]!.value),
            types: st.parameters.map((i) => wire[i]!.oid),
          }),
        );
        // The reader is on the first statement that returns rows (a query, even with no rows)
        if (first === null && r.described) first = r;
      }
      if (first === null || first.fields.length === 0) throw new NetException('NullReferenceException', NULL_REFERENCE);
      yield* this.loadTypes(first.fields);
      return yield* this.read(first);
    } catch (e) {
      throw toException(e, this.settings.includeErrorDetail);
    }
  }

  /** Loads from pg_type the types of the fields (and their elements) not known yet. */
  private *loadTypes(fields: readonly RawField[]): Op<void> {
    let missing = this.catalog.missing(fields.map((f) => f.dataTypeID));
    const asked = new Set<number>();
    while (missing.length > 0) {
      for (const oid of missing) asked.add(oid);
      const r = yield* wait(
        this.transport.query({ text: catalogQuery(this.serverMajor >= 14), values: ['{' + missing.join(',') + '}'], types: [1016] }),
      );
      const rows: CatalogRow[] = r.rows.map((row) => ({
        oid: Number(row[0]),
        typname: row[1]!,
        nspname: row[2]!,
        typtype: row[3]!,
        typcategory: row[4]!,
        typelem: Number(row[5]),
        typbasetype: Number(row[6]),
        rangeElem: Number(row[7]),
      }));
      // An OID pg_type does not have is a type nobody can read
      for (const oid of missing)
        if (!rows.some((row) => row.oid === oid))
          rows.push({ oid, typname: String(oid), nspname: '-', typtype: 'b', typcategory: 'X', typelem: 0, typbasetype: 0, rangeElem: 0 });
      this.catalog.add(rows);
      missing = this.catalog.missing(fields.map((f) => f.dataTypeID)).filter((oid) => !asked.has(oid));
    }
  }

  /** The columns and rows of a result as the C# engine receives them. */
  private *read(result: RawResult): Op<QueryResult> {
    const fields = result.fields;
    for (const f of fields) {
      if (isUnsupported(this.catalog, f.dataTypeID)) {
        // Npgsql gives the column no DataType: the C# engine fails reading the schema
        throw invalidCast(
          "Unable to cast object of type 'System.DBNull' to type 'System.Type'." +
            EOL +
            `The column ${f.name} is of type ${dataTypeName(this.catalog, f.dataTypeID)}, which Npgsql cannot read.`,
        );
      }
    }
    const regtypes = yield* this.regtypeOids(result);
    const ctx: ReadContext = { catalog: this.catalog, culture: this.settings.culture, regtypes };
    const readers = fields.map((f) => columnReader(ctx, f.dataTypeID, f.dataTypeModifier));
    const columns: DataColumnInfo[] = fields.map((f, i) => ({
      name: f.name,
      type: readers[i]!.type,
      size: columnSize(this.catalog, f.dataTypeID, f.dataTypeModifier),
      declaredType: dataTypeName(this.catalog, f.dataTypeID),
    }));
    const rows: DataValue[][] = result.rows.map((row) => row.map((v, i) => (v === null ? null : readers[i]!.read(v))));
    return { columns, rows };
  }

  /** regtype: PostgreSQL prints the type name, Npgsql reads the OID. */
  private *regtypeOids(result: RawResult): Op<Map<string, bigint>> {
    const map = new Map<string, bigint>();
    const names = new Set<string>();
    result.fields.forEach((f, i) => {
      let t = this.catalog.get(f.dataTypeID);
      while (t !== undefined && t.kind === 'domain') t = this.catalog.get(t.elem!);
      if (t?.kind !== 'regtype') return;
      for (const row of result.rows) if (row[i] !== null) names.add(row[i]!);
    });
    if (names.size === 0) return map;
    const r = yield* wait(
      this.transport.query({ text: 'SELECT t, t::regtype::oid::int8 FROM unnest($1::text[]) AS t', values: [textArray([...names])], types: [25] }),
    );
    for (const row of r.rows) map.set(row[0]!, BigInt(row[1]!));
    return map;
  }

  /** Ends the implicit transaction (commit or roll back) and closes the connection. */
  close(commit: boolean): MaybePromise<void> {
    return drive(this.closeOp(commit), this.transport.synchronous);
  }

  private *closeOp(commit: boolean): Op<void> {
    if (!this.open) return;
    this.open = false;
    let failure: unknown = undefined;
    try {
      yield* wait(this.transport.simple(commit ? 'COMMIT' : 'ROLLBACK'));
    } catch (e) {
      failure = toException(e, this.settings.includeErrorDetail);
    }
    try {
      yield* wait(this.transport.close());
    } catch (e) {
      failure ??= toException(e, this.settings.includeErrorDetail);
    }
    if (failure !== undefined) throw failure;
  }
}
