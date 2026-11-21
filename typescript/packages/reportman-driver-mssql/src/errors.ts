// The errors as Microsoft.Data.SqlClient reports them: SqlException with the messages of the
// server's error tokens (several joined with a line break, Environment.NewLine), the exceptions of
// SqlClient's own checks (InvalidOperationException, ArgumentException...) with their messages, and
// a NotSupportedException for what this driver leaves out.

import { EOL } from 'node:os';
import { NetException } from 'reportman-engine';

/** An error or message token of the server (SqlError). */
export interface SqlError {
  readonly message: string;
  readonly number: number;
  readonly state: number;
  /** The severity (Class): 11 to 16 user errors, 17 to 19 resources, 20 and more fatal. */
  readonly class: number;
  readonly serverName: string;
  readonly procName: string;
  readonly lineNumber: number;
}

/** An error of the server or of the network (Microsoft.Data.SqlClient.SqlException). */
export class SqlException extends NetException {
  /** The errors (SqlException.Errors), the first one gives Number, State and Class. */
  readonly errors: readonly SqlError[];

  constructor(errors: readonly SqlError[], message?: string) {
    // SqlException.Message: the message of each error, joined with Environment.NewLine
    super('SqlException', message ?? errors.map((e) => e.message).join(EOL));
    this.errors = errors;
  }

  /** The number of the first error (SqlException.Number). */
  get number(): number {
    return this.errors[0]?.number ?? 0;
  }

  get state(): number {
    return this.errors[0]?.state ?? 0;
  }

  get class(): number {
    return this.errors[0]?.class ?? 0;
  }
}

/** A SqlException of the client (no server token): the network, a timeout. */
export function clientSqlException(message: string, number = 0, cause?: unknown): SqlException {
  const e = new SqlException([{ message, number, state: 0, class: 20, serverName: '', procName: '', lineNumber: 0 }]);
  if (cause !== undefined) (e as { cause?: unknown }).cause = cause;
  return e;
}

export function invalidOperation(message: string): NetException {
  return new NetException('InvalidOperationException', message);
}

export function notSupported(message: string): NetException {
  return new NetException('NotSupportedException', message);
}

export function argumentException(message: string): NetException {
  return new NetException('ArgumentException', message);
}

export function overflowException(message: string): NetException {
  return new NetException('OverflowException', message);
}

export function invalidCast(message: string): NetException {
  return new NetException('InvalidCastException', message);
}

export function formatException(message: string): NetException {
  return new NetException('FormatException', message);
}

/** System.Data.SqlTypes.SqlTypeException. */
export function sqlTypeException(message: string): NetException {
  return new NetException('SqlTypeException', message);
}

/** System.IO.FileNotFoundException (an assembly SqlClient cannot load). */
export function fileNotFound(message: string): NetException {
  return new NetException('FileNotFoundException', message);
}

/** SQLResource.ConversionOverflowMessage. */
export const CONVERSION_OVERFLOWS = 'Conversion overflows.';
