// A data host over node:sqlite that answers as Microsoft.Data.Sqlite does for the C# engine (the
// provider golden-cs opens SQLite connections with): every report connection opens the same
// database read only, with an implicit transaction; parameters bind to :NAME, @NAME and $NAME by
// their names, case-sensitive; the column types are those of the values of the first row (the
// declared type when that value is NULL); values as the SQLite reader gives them (INTEGER as
// bigint, REAL as number, TEXT, BLOB).

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

/** An InvalidOperationException of the provider. */
class ProviderError extends Error {
  readonly netType = 'InvalidOperationException';
  constructor(message: string) {
    super(message);
    this.name = 'InvalidOperationException';
  }
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

/** The log of what the host did, for the tests. */
export interface SqliteHostLog {
  connects: string[];
  queries: { dataset: string; sql: string; parameters: Record<string, unknown> }[];
  closes: { alias: string; commit: boolean }[];
}

class SqliteConnection implements DataConnection {
  private readonly db: DatabaseSync;
  private readonly alias: string;
  private readonly log: SqliteHostLog;
  private open = true;

  constructor(file: string, alias: string, log: SqliteHostLog) {
    this.db = new DatabaseSync(file, { readOnly: true });
    this.alias = alias;
    this.log = log;
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
      throw new Error('SQLite Error 1: ' + (e as Error).message);
    }
    stmt.setReadBigInts(true);
    stmt.setReturnArrays(true);
    const args: Record<string, null | bigint | number | string | Uint8Array> = {};
    for (const [k, v] of bound) args[k] = v;
    const rows = stmt.all(args) as unknown as unknown[][];
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
    this.log.queries.push({
      dataset: command.dataset,
      sql: command.sql,
      parameters: Object.fromEntries(command.parameters.map((p) => [p.name, p.value])),
    });
    return { columns, rows: rows as DataValue[][] };
  }

  close(commit: boolean): void {
    if (!this.open) return;
    this.open = false;
    this.log.closes.push({ alias: this.alias, commit });
    this.db.exec(commit ? 'COMMIT' : 'ROLLBACK');
    this.db.close();
  }
}

/** A host that opens every report connection on one SQLite file (golden-cs --sqlite). */
export function sqliteHost(file: string): DataHost & { log: SqliteHostLog } {
  const log: SqliteHostLog = { connects: [], queries: [], closes: [] };
  return {
    log,
    connect(request: ConnectionRequest): DataConnection {
      log.connects.push(request.alias);
      return new SqliteConnection(file, request.alias, log);
    },
  };
}

