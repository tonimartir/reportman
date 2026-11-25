// SQLite through node:sqlite (built into Node, no native module to install), with the
// behaviour of Microsoft.Data.Sqlite, the provider the C# engine opens SQLite with (SQLiteCore):
// the same column types, the same parameter binding and the same errors, so a report gives the
// same result in both engines.
import { DatabaseSync, type StatementSync } from 'node:sqlite';
import {
  CsDecimal,
  type ConnectionRequest,
  type DataColumnInfo,
  type DataColumnType,
  type DataConnection,
  type DataHost,
  type DataValue,
  type QueryCommand,
  type QueryParameter,
  type QueryResult,
  RpDateTime,
  formatDecimal,
  CultureInfo,
  rewriteNamedParameters,
} from '@reportman/engine';
import type { ConnectionFactory } from './host.js';

/** An InvalidOperationException of the provider. */
class ProviderError extends Error {
  readonly netType = 'InvalidOperationException';
  constructor(message: string) {
    super(message);
    this.name = 'InvalidOperationException';
  }
}

/**
 * SqliteException of Microsoft.Data.Sqlite: "SQLite Error 1: 'no such table: X'." (the primary
 * result code of the error, without its extended part, and the message of SQLite).
 */
function sqliteError(e: unknown): Error {
  const code = typeof (e as { errcode?: unknown }).errcode === 'number' ? (e as { errcode: number }).errcode & 0xff : 1;
  return new Error(`SQLite Error ${code}: '${e instanceof Error ? e.message : String(e)}'.`);
}

/** SqliteValueReader.Sqlite3AffinityType of a declared type. */
function affinity(declared: string | null): 'INTEGER' | 'TEXT' | 'BLOB' | 'REAL' {
  if (declared === null) return 'BLOB';
  const name = declared.toUpperCase();
  if (name.includes('INT')) return 'INTEGER';
  if (name.includes('CHAR') || name.includes('CLOB') || name.includes('TEXT')) return 'TEXT';
  if (name.includes('BLOB')) return 'BLOB';
  if (name.includes('REAL') || name.includes('FLOA') || name.includes('DOUB')) return 'REAL';
  return 'TEXT';
}

function sqliteTypeOf(value: unknown): 'INTEGER' | 'TEXT' | 'BLOB' | 'REAL' | 'NULL' {
  if (value === null || value === undefined) return 'NULL';
  if (typeof value === 'bigint') return 'INTEGER';
  if (typeof value === 'number') return 'REAL';
  if (typeof value === 'string') return 'TEXT';
  return 'BLOB';
}

const FIELD_TYPES: Record<'INTEGER' | 'TEXT' | 'BLOB' | 'REAL', DataColumnType> = {
  INTEGER: 'Int64',
  REAL: 'Double',
  TEXT: 'String',
  BLOB: 'Binary',
};

const INVARIANT = CultureInfo.invariant;

/** "yyyy-MM-dd HH:mm:ss.FFFFFFF" (trailing zeros of the fraction, and the point, removed). */
function sqliteDateText(d: RpDateTime): string {
  const p2 = (n: number): string => String(n).padStart(2, '0');
  let text = String(d.year).padStart(4, '0') + '-' + p2(d.month) + '-' + p2(d.day) + ' ' + p2(d.hour) + ':' + p2(d.minute) + ':' + p2(d.second);
  let fraction = String(d.ticksOfSecond).padStart(7, '0').replace(/0+$/, '');
  if (fraction.length > 0) text += '.' + fraction;
  return text;
}

/** SqliteParameterBinder: the SQLite value of a parameter. */
function bindValue(p: QueryParameter): null | bigint | number | string | Uint8Array {
  switch (p.valueType) {
    case 'Null':
      throw new ProviderError('Value must be set.');
    case 'DBNull':
      return null;
    case 'Boolean':
      return p.value ? 1n : 0n;
    case 'Byte':
    case 'Int32':
      return BigInt(p.value as number);
    case 'Int64':
      return p.value as bigint;
    case 'Char':
      // DbType SByte is SqliteType.Integer: the code of the character
      return p.dbType === 'SByte' ? BigInt((p.value as string).charCodeAt(0)) : (p.value as string);
    case 'Decimal':
      return formatDecimal(p.value as CsDecimal, '0.0###########################', INVARIANT.number);
    case 'Double':
      return p.value as number;
    case 'DateTime':
      return sqliteDateText(p.value as RpDateTime);
    case 'String':
      return p.value as string;
    case 'Binary':
      return p.value as Uint8Array;
    default:
      throw new ProviderError(
        'No mapping exists from object type Reportman.Reporting.Variant to a known managed provider native type.',
      );
  }
}


class SqliteConnection implements DataConnection {
  private readonly db: DatabaseSync;
  private readonly alias: string;
  private open = true;

  constructor(file: string, alias: string, readOnly: boolean) {
    this.db = new DatabaseSync(file, { readOnly });
    this.alias = alias;
    this.db.exec('BEGIN');
  }

  query(command: QueryCommand): QueryResult {
    if (!this.open) throw new ProviderError('The connection is closed.');
    const { placeholders } = rewriteNamedParameters(command.sql, (p) => p.prefix + p.name);
    const names = [...new Set(placeholders.map((p) => p.prefix + p.name))];
    const bound = new Map<string, null | bigint | number | string | Uint8Array>();
    for (const p of command.parameters) {
      // sqlite3_bind_parameter_index(name), else the name with each prefix
      let key: string | undefined = names.find((n) => n === p.name);
      if (key === undefined) key = [':', '@', '$'].map((x) => x + p.name).find((n) => names.includes(n));
      if (key === undefined) continue;
      bound.set(key, bindValue(p));
    }
    const unbound = names.filter((n) => !bound.has(n));
    if (unbound.length > 0) throw new ProviderError('Must add values for the following parameters: ' + unbound.join(', '));
    let stmt: StatementSync;
    try {
      stmt = this.db.prepare(command.sql);
    } catch (e) {
      throw sqliteError(e);
    }
    stmt.setReadBigInts(true);
    stmt.setReturnArrays(true);
    const args: Record<string, null | bigint | number | string | Uint8Array> = {};
    for (const [k, v] of bound) args[k] = v;
    let rows: unknown[][];
    try {
      rows = stmt.all(args) as unknown as unknown[][];
    } catch (e) {
      throw sqliteError(e);
    }
    const cols = stmt.columns();
    const first = rows[0];
    const columns: DataColumnInfo[] = cols.map((c, i) => {
      const declared = c.type === null || c.type === undefined ? null : String(c.type);
      const valueType = first === undefined ? 'NULL' : sqliteTypeOf(first[i]);
      // GetDataTypeName: the declared type without its size, else the type of the value
      let dataTypeName: string;
      if (declared !== null) {
        const k = declared.indexOf('(');
        dataTypeName = k < 0 ? declared : declared.substring(0, k);
      } else dataTypeName = valueType === 'NULL' ? 'BLOB' : valueType;
      const fieldType = valueType === 'NULL' ? FIELD_TYPES[affinity(dataTypeName)] : FIELD_TYPES[valueType];
      return { name: c.name, type: fieldType, size: -1, declaredType: dataTypeName };
    });
    return { columns, rows: rows as DataValue[][] };
  }

  close(commit: boolean): void {
    if (!this.open) return;
    this.open = false;
    this.db.exec(commit ? 'COMMIT' : 'ROLLBACK');
    this.db.close();
  }
}

/** Options of a SQLite connection. */
export interface SqliteOptions {
  /** Open the database read only (true by default: a report only reads). */
  readOnly?: boolean;
}

/**
 * A connection factory that opens a SQLite file for a report connection, inside an implicit
 * transaction committed when the report closes it (as the C# engine does with ADO.NET).
 */
export function sqlite(file: string, options: SqliteOptions = {}): ConnectionFactory {
  const readOnly = options.readOnly ?? true;
  return (request) => new SqliteConnection(file, request.alias, readOnly);
}
