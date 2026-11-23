// The part of sql.js the demo uses (sql.js ships no types).
declare module 'sql.js' {
  export type SqlValue = number | bigint | string | Uint8Array | null;
  export type BindParams = Record<string, SqlValue> | SqlValue[] | null;

  export interface Statement {
    bind(values?: BindParams): boolean;
    step(): boolean;
    get(params?: BindParams | null, config?: { useBigInt?: boolean }): SqlValue[];
    getColumnNames(): string[];
    free(): boolean;
  }

  export interface QueryExecResult {
    columns: string[];
    values: SqlValue[][];
  }

  export interface Database {
    prepare(sql: string): Statement;
    run(sql: string): Database;
    exec(sql: string): QueryExecResult[];
    close(): void;
  }

  export interface SqlJsStatic {
    Database: new (data?: Uint8Array | null) => Database;
  }

  export default function initSqlJs(config?: { locateFile?: (file: string) => string; wasmBinary?: ArrayBuffer | Uint8Array }): Promise<SqlJsStatic>;
}
