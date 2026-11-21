// The exceptions of Npgsql as the C# engine surfaces them: the same .NET class name (netType, as
// e.GetType().Name) and the same message, so a report fails with the same text in both engines.

import { EOL } from 'node:os';
import { NetException } from '@reportman/engine';

/** Detail of a server error when the connection string has no Include Error Detail=true. */
const DETAIL_REDACTED =
  "Detail redacted as it may contain sensitive data. Specify 'Include Error Detail' in the connection string to include this information.";

/** The fields of an ErrorResponse of the server (as pg's DatabaseError carries them). */
export interface ServerErrorFields {
  message: string;
  severity?: string;
  code?: string;
  detail?: string;
  hint?: string;
  position?: string;
  internalPosition?: string;
  internalQuery?: string;
  where?: string;
  schema?: string;
  table?: string;
  column?: string;
  dataType?: string;
  constraint?: string;
  file?: string;
  line?: string;
  routine?: string;
}

/**
 * Npgsql.PostgresException: an error the server reported. Its message is Npgsql's:
 * "SQLSTATE: text", then the position and the detail on lines of their own.
 */
export class PostgresException extends NetException {
  readonly sqlState: string;
  readonly messageText: string;
  readonly severity: string;
  readonly detail: string | undefined;
  readonly hint: string | undefined;
  readonly position: number;
  readonly where: string | undefined;
  readonly schemaName: string | undefined;
  readonly tableName: string | undefined;
  readonly columnName: string | undefined;
  readonly constraintName: string | undefined;

  constructor(fields: ServerErrorFields, includeErrorDetail = false) {
    const sqlState = fields.code ?? '';
    const position = fields.position === undefined ? 0 : Number(fields.position);
    const detail =
      fields.detail === undefined || fields.detail.length === 0 ? undefined : includeErrorDetail ? fields.detail : DETAIL_REDACTED;
    super('PostgresException', PostgresException.messageOf(sqlState, fields.message, position, detail));
    this.sqlState = sqlState;
    this.messageText = fields.message;
    this.severity = fields.severity ?? 'ERROR';
    this.detail = detail;
    this.hint = fields.hint;
    this.position = position;
    this.where = fields.where;
    this.schemaName = fields.schema;
    this.tableName = fields.table;
    this.columnName = fields.column;
    this.constraintName = fields.constraint;
  }

  /** PostgresException.GetMessage (Environment.NewLine between the parts). */
  private static messageOf(sqlState: string, text: string, position: number, detail: string | undefined): string {
    const add = (name: string, value: string | undefined): string =>
      value !== undefined && value.trim().length > 0 ? EOL + name + ': ' + value : '';
    const more = add('POSITION', position === 0 ? undefined : String(position)) + add('DETAIL', detail);
    return more.length === 0 ? sqlState + ': ' + text : sqlState + ': ' + text + EOL + more;
  }
}

/** System.InvalidCastException. */
export function invalidCast(message: string): NetException {
  return new NetException('InvalidCastException', message);
}

/** System.OverflowException. */
export function overflow(message: string): NetException {
  return new NetException('OverflowException', message);
}

/** System.InvalidOperationException. */
export function invalidOperation(message: string): NetException {
  return new NetException('InvalidOperationException', message);
}

/** System.ArgumentOutOfRangeException. */
export function argumentOutOfRange(message: string): NetException {
  return new NetException('ArgumentOutOfRangeException', message);
}

/** System.ArgumentException. */
export function argumentException(message: string): NetException {
  return new NetException('ArgumentException', message);
}

/** System.NotSupportedException. */
export function notSupported(message: string): NetException {
  return new NetException('NotSupportedException', message);
}

/** Npgsql.NpgsqlException: a failure of the connection (the server could not be reached...). */
export function npgsqlException(message: string, cause?: unknown): NetException {
  const e = new NetException('NpgsqlException', message);
  if (cause !== undefined) (e as { cause?: unknown }).cause = cause;
  return e;
}

/** InvalidCastException of a value Npgsql cannot write to the type of its parameter. */
export function writingNotSupported(clrType: string, dataTypeName: string | null): NetException {
  return invalidCast(
    `Writing values of '${clrType}' is not supported for parameters having ` +
      (dataTypeName === null
        ? 'no NpgsqlDbType or DataTypeName. Try setting one of these values to the expected database type.'
        : `DataTypeName '${dataTypeName}'.`),
  );
}

/** InvalidCastException of a column of a type Npgsql has no reader for. */
export function readingNotSupported(dataTypeName: string): NetException {
  return invalidCast(`Reading as 'System.Object' is not supported for fields having DataTypeName '${dataTypeName}'`);
}
