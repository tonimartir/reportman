// The errors as MySqlConnector reports them: MySqlException with the server's message, error number
// and SQLSTATE; its own messages for the errors of the client (unable to connect, a parameter that
// is not defined...).

import { NetException } from 'reportman-engine';

/** MySqlConnector's MySqlErrorCode of the client errors the driver raises. */
export const UNABLE_TO_CONNECT_TO_HOST = 1042;

/** An error of the MySQL server or of the client (MySqlConnector.MySqlException). */
export class MySqlException extends NetException {
  /** The error number (MySqlException.Number / ErrorCode): the server's, or a MySqlErrorCode. */
  readonly number: number;
  /** The SQLSTATE of a server error (MySqlException.SqlState). */
  readonly sqlState: string | null;

  constructor(message: string, number = 0, sqlState: string | null = null) {
    super('MySqlException', message);
    this.number = number;
    this.sqlState = sqlState;
  }
}

/** An error of mysql2 as the MySqlException MySqlConnector raises for it. */
export function mySqlException(e: unknown): Error {
  if (e instanceof NetException) return e;
  if (!(e instanceof Error)) return new MySqlException(String(e));
  const err = e as Error & { errno?: number; sqlState?: string; sqlMessage?: string; code?: string; fatal?: boolean };
  let result: MySqlException;
  if (typeof err.sqlState === 'string' && typeof err.errno === 'number') {
    // An error packet of the server: its message as the server wrote it
    result = new MySqlException(err.sqlMessage ?? err.message, err.errno, err.sqlState);
  } else if (err.code === 'ETIMEDOUT' || err.code === 'PROTOCOL_SEQUENCE_TIMEOUT') {
    result = new MySqlException('Connect Timeout expired.', UNABLE_TO_CONNECT_TO_HOST);
  } else if (
    err.code === 'ECONNREFUSED' ||
    err.code === 'ENOTFOUND' ||
    err.code === 'EAI_AGAIN' ||
    err.code === 'EHOSTUNREACH' ||
    err.code === 'ENETUNREACH' ||
    err.code === 'ECONNRESET' ||
    err.code === 'ENOENT'
  ) {
    result = new MySqlException('Unable to connect to any of the specified MySQL hosts.', UNABLE_TO_CONNECT_TO_HOST);
  } else if (err.code === 'HANDSHAKE_NO_SSL_SUPPORT') {
    result = new MySqlException('Server does not support SSL', UNABLE_TO_CONNECT_TO_HOST);
  } else {
    result = new MySqlException(err.message);
  }
  (result as { cause?: unknown }).cause = e;
  return result;
}

export function invalidOperation(message: string): NetException {
  return new NetException('InvalidOperationException', message);
}

export function notSupported(message: string): NetException {
  return new NetException('NotSupportedException', message);
}

export function formatException(message: string): NetException {
  return new NetException('FormatException', message);
}

export function invalidCast(message: string): NetException {
  return new NetException('InvalidCastException', message);
}
