// The data host contract: what the engine asks of the program that runs a report, in the role
// ADO.NET plays for the C# engine (DbProviderFactory, IDbConnection, IDbCommand, IDataReader).
//
// The engine never opens a database. For each report connection (DatabaseInfo) it asks the host
// for a DataConnection, runs the SQL of each dataset (DataInfo) through it with typed named
// parameters, and reads columns and rows back. A host may also give the rows of a dataset itself
// (the C# DataViewOverride): that is how a dataset comes from a REST API.
//
// Placeholders. The engine sends the SQL of the report as it is, after the text substitutions of
// the substitution parameters: named placeholders written `:NAME` (the Delphi form, the one the
// sample reports use) or `@NAME` (the .NET form, also what ConvertToDotNet writes). A parameter
// arrives with its name without prefix (the parameter alias), as C# names its IDbDataParameter;
// a provider binds it to `:NAME`, `@NAME` or `$NAME`, as Microsoft.Data.Sqlite does. A driver
// for a database with other placeholders (`?`, `$1`) rewrites them with rewriteNamedParameters,
// which skips string literals, quoted identifiers and comments.
//
// Transactions. As in C#, opening a connection starts an implicit transaction (with the isolation
// level of the report connection) and every command runs inside it, the ones of the datasets and
// the one of GETVALUEFROMSQL; closing the connection at the end of the report (or when the report
// fails) commits it.
//
// Results are materialised (every row at once); a streaming variant may come later.
//
// Host methods may return plain values or promises. A dataset opened from inside an expression
// (a field of a dataset not open yet, REOPEN, GETVALUEFROMSQL) needs plain values: see op.ts.

import type { DatabaseInfo, DataInfo } from 'reportman-lib';
import type { CsDecimal } from '../util/decimal.js';
import type { RpDateTime } from '../util/datetime.js';
import type { MaybePromise } from './op.js';

/**
 * The .NET type of a column (DataColumn.DataType): the types an ADO.NET reader gives. 'Binary' is
 * byte[]; 'Object' a column of mixed values. The engine converts every value it stores to the type
 * of its column, as a DataTable does (see columns.ts).
 */
export type DataColumnType =
  | 'String'
  | 'Int64'
  | 'Int32'
  | 'Int16'
  | 'Byte'
  | 'Boolean'
  | 'Double'
  | 'Single'
  | 'Decimal'
  | 'DateTime'
  | 'Binary'
  | 'Object';

/** A column of a result: a row of IDataReader.GetSchemaTable. */
export interface DataColumnInfo {
  /** ColumnName as the database gives it; the engine upper-cases it, as C# does. */
  name: string;
  /** DataType. */
  type: DataColumnType;
  /** ColumnSize (MaxLength of a string column); null or absent when the provider gives none. */
  size?: number | null;
  /**
   * DataTypeName: the type the column was declared with (SQLite "DATE", "VARCHAR"...), without
   * its size. A String, Int64 or Double column declared DATE, DATETIME or TIMESTAMP is a date
   * column (SQLite keeps dates as text or numbers), as in the C# and Delphi engines.
   */
  declaredType?: string | null;
}

/**
 * A value of a row: null or undefined (DBNull), string, number, bigint (Int64), boolean,
 * Uint8Array (byte[]), CsDecimal, RpDateTime or a JavaScript Date (its local fields). A number in
 * an integer column stays an integer; other values are converted to the column type as C# does.
 */
export type DataValue = null | undefined | string | number | bigint | boolean | Uint8Array | CsDecimal | RpDateTime | Date;

/** The rows of a query (a materialised IDataReader): its columns and its rows, in order. */
export interface QueryResult {
  columns: readonly DataColumnInfo[];
  rows: readonly (readonly DataValue[])[];
}

/** System.Data.DbType of a parameter, as the engine types it (Variant.GetDbType). */
export type ParameterDbType =
  | 'Object'
  | 'Boolean'
  | 'Byte'
  | 'SByte'
  | 'Int32'
  | 'Int64'
  | 'Decimal'
  | 'Double'
  | 'DateTime'
  | 'Binary'
  | 'String';

/**
 * The .NET type of a parameter value (the object C# assigns to IDbDataParameter.Value):
 * 'Null' is C# null (no value: ADO.NET providers refuse it, Microsoft.Data.Sqlite with "Value must
 * be set."), 'DBNull' a database NULL, 'Char' a one-character string.
 */
export type ParameterValueType =
  | 'Null'
  | 'DBNull'
  | 'Boolean'
  | 'Byte'
  | 'Char'
  | 'Int32'
  | 'Int64'
  | 'Decimal'
  | 'Double'
  | 'DateTime'
  | 'String'
  | 'Binary'
  | 'Object';

/** A named parameter of a command. */
export interface QueryParameter {
  /** The parameter alias, without prefix (GETVALUEFROMSQL names it "@" + alias, as C#). */
  readonly name: string;
  /**
   * The value: undefined for 'Null', null for 'DBNull', boolean, number (Byte, Int32, Double),
   * bigint (Int64), string (String, Char), CsDecimal, RpDateTime, Uint8Array.
   */
  readonly value: DataValue;
  readonly valueType: ParameterValueType;
  readonly dbType: ParameterDbType;
}

/** A command to execute (IDbCommand.ExecuteReader). */
export interface QueryCommand {
  /** The SQL, with its `:NAME` / `@NAME` placeholders. */
  readonly sql: string;
  readonly parameters: readonly QueryParameter[];
  /** The dataset alias the command belongs to ("" for GETVALUEFROMSQL). */
  readonly dataset: string;
}

/** An open connection (IDbConnection with its implicit transaction). */
export interface DataConnection {
  /** Executes a query and returns its columns and rows. */
  query(command: QueryCommand): MaybePromise<QueryResult>;
  /** Ends the implicit transaction (commit true, as DisConnect; false rolls back) and closes. */
  close(commit: boolean): MaybePromise<void>;
}

/** System.Data.IsolationLevel names. */
export type IsolationLevelName =
  | 'Unspecified'
  | 'Chaos'
  | 'ReadUncommitted'
  | 'ReadCommitted'
  | 'RepeatableRead'
  | 'Serializable'
  | 'Snapshot';

/** What the engine knows of a report connection when it asks the host to open it. */
export interface ConnectionRequest {
  /** The report connection, as the report has it. */
  readonly database: DatabaseInfo;
  readonly alias: string;
  /**
   * The connection string C# would use: the report parameter ALIAS_ADOCONNECTIONSTRING, else
   * ADOCONNECTIONSTRING, else the connection's own; for a SQLite connection of the Delphi engine,
   * "Data Source=" + its DBPARAM_DATABASE.
   */
  readonly connectionString: string;
  /** The provider factory C# would use ("SQLiteCore" for a SQLite connection of the Delphi engine). */
  readonly providerFactory: string;
  /** A SQLite connection of the Delphi engine (DatabaseInfo.IsEngineSqlite). */
  readonly engineSqlite: boolean;
  /** The report parameter of a connection parameter (ALIAS_DBPARAM_NAME, else DBPARAM_NAME): "" when absent. */
  dbParam(name: string): string;
  /** The isolation level of the implicit transaction (TransIsolation). */
  readonly isolationLevel: IsolationLevelName;
}

/** What the engine knows of a dataset when it asks the host for its rows. */
export interface DatasetRequest {
  readonly dataset: DataInfo;
  readonly alias: string;
}

/** The data host. */
export interface DataHost {
  /** Opens a connection and starts its implicit transaction (DatabaseInfo.Connect). */
  connect(request: ConnectionRequest): MaybePromise<DataConnection>;
  /**
   * The rows of a dataset given by the host (DataViewOverride), or undefined to run its SQL. The
   * engine asks it each time the dataset opens. As in C#, the report connection of the dataset is
   * still opened (connect), so a host that only gives rows returns a connection that does nothing.
   */
  datasetRows?(request: DatasetRequest): MaybePromise<QueryResult | undefined>;
}

/** A host without databases: every connection fails, the error naming it. */
export const noDataHost: DataHost = {
  connect(request: ConnectionRequest): DataConnection {
    throw new Error('No data host: the report connection ' + request.alias + ' cannot be opened');
  },
};

/** A named placeholder found by rewriteNamedParameters. */
export interface NamedPlaceholder {
  /** The name without prefix. */
  name: string;
  /** The prefix (":", "@" or "$"). */
  prefix: string;
  /** Position of the prefix in the original SQL. */
  index: number;
}

function isNameStart(c: string): boolean {
  return (c >= 'A' && c <= 'Z') || (c >= 'a' && c <= 'z') || c === '_' || c.charCodeAt(0) > 127;
}

function isNameChar(c: string): boolean {
  return isNameStart(c) || (c >= '0' && c <= '9');
}

/**
 * Rewrites the named placeholders of a SQL text (`:NAME`, `@NAME`, `$NAME`) with what `replace`
 * returns for each one (for example "?" or "$1"), and lists them in order. String literals ('...'
 * with '' inside), quoted identifiers ("...", [...], `...`), line comments (--) and block
 * comments are left as they are, and so are `::` casts, `@@` variables and a prefix not followed
 * by a name.
 */
export function rewriteNamedParameters(
  sql: string,
  replace: (placeholder: NamedPlaceholder, ordinal: number) => string,
  prefixes = ':@$',
): { sql: string; placeholders: NamedPlaceholder[] } {
  const placeholders: NamedPlaceholder[] = [];
  let out = '';
  let i = 0;
  const n = sql.length;
  while (i < n) {
    const c = sql.charAt(i);
    if (c === "'" || c === '"' || c === '`' || c === '[') {
      const close = c === '[' ? ']' : c;
      let j = i + 1;
      while (j < n) {
        if (sql.charAt(j) === close) {
          if (close !== ']' && sql.charAt(j + 1) === close) {
            j += 2;
            continue;
          }
          break;
        }
        j++;
      }
      out += sql.substring(i, Math.min(j + 1, n));
      i = j + 1;
      continue;
    }
    if (c === '-' && sql.charAt(i + 1) === '-') {
      let j = sql.indexOf('\n', i);
      if (j < 0) j = n;
      out += sql.substring(i, j);
      i = j;
      continue;
    }
    if (c === '/' && sql.charAt(i + 1) === '*') {
      let j = sql.indexOf('*/', i + 2);
      j = j < 0 ? n : j + 2;
      out += sql.substring(i, j);
      i = j;
      continue;
    }
    if (prefixes.includes(c)) {
      const next = sql.charAt(i + 1);
      // "::" casts and "@@" variables are not parameters
      if (next === c) {
        out += c + next;
        i += 2;
        continue;
      }
      if (next.length > 0 && isNameStart(next)) {
        let j = i + 2;
        while (j < n && isNameChar(sql.charAt(j))) j++;
        const placeholder: NamedPlaceholder = { name: sql.substring(i + 1, j), prefix: c, index: i };
        out += replace(placeholder, placeholders.length);
        placeholders.push(placeholder);
        i = j;
        continue;
      }
    }
    out += c;
    i++;
  }
  return { sql: out, placeholders };
}
