// SQLite in the browser for the demo: sql.js (SQLite compiled to WebAssembly) with the behaviour
// of the sqlite() connection of @reportman/node, that is, of Microsoft.Data.Sqlite, the provider
// the C# engine opens SQLite with: the same column types, the same parameter binding and the same
// errors, so a report gives the same result in the browser as in Node and in .NET. Only the demo
// uses sql.js; the @reportman packages stay plain JavaScript.
import type { Database, SqlJsStatic, SqlValue } from 'sql.js';
import {
  CsDecimal,
  CultureInfo,
  RpDateTime,
  formatDecimal,
  rewriteNamedParameters,
  type ConnectionRequest,
  type DataColumnInfo,
  type DataColumnType,
  type DataConnection,
  type DataValue,
  type QueryCommand,
  type QueryParameter,
  type QueryResult,
} from '@reportman/engine';

/** An InvalidOperationException of the provider. */
class ProviderError extends Error {
  readonly netType = 'InvalidOperationException';
  constructor(message: string) {
    super(message);
    this.name = 'InvalidOperationException';
  }
}

type Affinity = 'INTEGER' | 'TEXT' | 'BLOB' | 'REAL';

/** SqliteValueReader.Sqlite3AffinityType of a declared type. */
function affinity(declared: string | null): Affinity {
  if (declared === null) return 'BLOB';
  const name = declared.toUpperCase();
  if (name.includes('INT')) return 'INTEGER';
  if (name.includes('CHAR') || name.includes('CLOB') || name.includes('TEXT')) return 'TEXT';
  if (name.includes('BLOB')) return 'BLOB';
  if (name.includes('REAL') || name.includes('FLOA') || name.includes('DOUB')) return 'REAL';
  return 'TEXT';
}

function sqliteTypeOf(value: unknown): Affinity | 'NULL' {
  if (value === null || value === undefined) return 'NULL';
  if (typeof value === 'bigint') return 'INTEGER';
  if (typeof value === 'number') return 'REAL';
  if (typeof value === 'string') return 'TEXT';
  return 'BLOB';
}

const FIELD_TYPES: Record<Affinity, DataColumnType> = {
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
  const fraction = String(d.ticksOfSecond).padStart(7, '0').replace(/0+$/, '');
  if (fraction.length > 0) text += '.' + fraction;
  return text;
}

/** SqliteParameterBinder: the SQLite value of a parameter. */
function bindValue(p: QueryParameter): SqlValue {
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

let viewNumber = 0;

/**
 * sqlite3_column_decltype of each column of a query, which sql.js does not export: the types
 * PRAGMA table_info gives for a temporary view of the query (parameters as NULL), which SQLite
 * takes from the same declared types. Null for a column with none (an expression) or when the
 * query cannot be a view.
 */
function declaredTypes(db: Database, sql: string, count: number): (string | null)[] {
  const none = new Array<string | null>(count).fill(null);
  const select = rewriteNamedParameters(sql, () => 'NULL').sql.replace(/[\s;]+$/, '');
  const name = 'reportman_columns_' + String(++viewNumber);
  try {
    db.run(`CREATE TEMP VIEW "${name}" AS ${select}`);
    const info = db.exec(`PRAGMA table_info("${name}")`)[0];
    if (info === undefined || info.values.length !== count) return none;
    return info.values.map((row) => {
      const type = row[2];
      return typeof type === 'string' && type !== '' ? type : null;
    });
  } catch {
    return none;
  } finally {
    try {
      db.run(`DROP VIEW IF EXISTS temp."${name}"`);
    } catch {
      // nothing to drop
    }
  }
}

class SqlJsConnection implements DataConnection {
  private readonly db: Database;
  private open = true;

  constructor(SQL: SqlJsStatic, bytes: Uint8Array) {
    // A database of its own for each connection, as node:sqlite opens the file for each one
    this.db = new SQL.Database(bytes);
    this.db.run('BEGIN');
  }

  query(command: QueryCommand): QueryResult {
    if (!this.open) throw new ProviderError('The connection is closed.');
    const { placeholders } = rewriteNamedParameters(command.sql, (p) => p.prefix + p.name);
    const names = [...new Set(placeholders.map((p) => p.prefix + p.name))];
    const bound = new Map<string, SqlValue>();
    for (const p of command.parameters) {
      // sqlite3_bind_parameter_index(name), else the name with each prefix
      let key: string | undefined = names.find((n) => n === p.name);
      if (key === undefined) key = [':', '@', '$'].map((x) => x + p.name).find((n) => names.includes(n));
      if (key === undefined) continue;
      bound.set(key, bindValue(p));
    }
    const unbound = names.filter((n) => !bound.has(n));
    if (unbound.length > 0) throw new ProviderError('Must add values for the following parameters: ' + unbound.join(', '));
    let stmt;
    try {
      stmt = this.db.prepare(command.sql);
    } catch (e) {
      throw new Error('SQLite Error 1: ' + (e as Error).message);
    }
    const rows: DataValue[][] = [];
    let columnNames: string[];
    try {
      const args: Record<string, SqlValue> = {};
      for (const [k, v] of bound) args[k] = v;
      if (names.length > 0) stmt.bind(args);
      while (stmt.step()) rows.push(stmt.get(null, { useBigInt: true }) as DataValue[]);
      columnNames = stmt.getColumnNames();
    } finally {
      stmt.free();
    }
    const declared = declaredTypes(this.db, command.sql, columnNames.length);
    const first = rows[0];
    const columns: DataColumnInfo[] = columnNames.map((name, i) => {
      const decl = declared[i] ?? null;
      const valueType = first === undefined ? 'NULL' : sqliteTypeOf(first[i]);
      // GetDataTypeName: the declared type without its size, else the type of the value
      let dataTypeName: string;
      if (decl !== null) {
        const k = decl.indexOf('(');
        dataTypeName = k < 0 ? decl : decl.substring(0, k);
      } else dataTypeName = valueType === 'NULL' ? 'BLOB' : valueType;
      const fieldType = valueType === 'NULL' ? FIELD_TYPES[affinity(dataTypeName)] : FIELD_TYPES[valueType];
      return { name, type: fieldType, size: -1, declaredType: dataTypeName };
    });
    return { columns, rows };
  }

  close(commit: boolean): void {
    if (!this.open) return;
    this.open = false;
    this.db.run(commit ? 'COMMIT' : 'ROLLBACK');
    this.db.close();
  }
}

/** A connection factory over a SQLite database given as bytes (the sqlite() of @reportman/node). */
export function sqlJs(SQL: SqlJsStatic, bytes: Uint8Array): (request: ConnectionRequest) => DataConnection {
  return () => new SqlJsConnection(SQL, bytes);
}
