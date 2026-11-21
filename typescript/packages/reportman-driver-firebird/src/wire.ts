// The parts of node-firebird the driver uses beyond its documented API: a prepared statement keeps
// the described input and output fields (statement.input / statement.output, SQLVar objects), and
// the rows of a fetch are decoded by each output field's decode method. The driver gives the output
// fields of its own statements decoders that keep the raw wire values (dates as day numbers, times
// in 1/10000 s, DECFLOAT bytes, INT128 and BIGINT as bigint, text as bytes), so it can convert them
// as FirebirdClient does; node-firebird would turn dates into JavaScript Date (milliseconds, local
// time), DECFLOAT into numbers of another encoding and BIGINT into lossy numbers.

import type { EventEmitter } from 'node:events';
import type { Database } from 'node-firebird';

/** The XDR reader node-firebird decodes a row with. */
export interface XdrReader {
  buffer: Buffer;
  pos: number;
  readInt(): number;
  readUInt(): number;
  readInt64BigInt(): bigint;
  readInt128Signed(): bigint;
  readFloat(): number;
  readDouble(): number;
  readArray(): Buffer | undefined;
  readBuffer(len?: number, toAlign?: boolean): Buffer | undefined;
}

/** A described field of a statement (node-firebird SQLVar). */
export interface SqlVar {
  /** The SQL type without the nullable bit. */
  type: number;
  subType: number;
  scale: number;
  /** The length of the field in the message (node-firebird may widen it for NONE text). */
  length: number;
  /** The length the server described, when node-firebird widened `length`. */
  nativeLength?: number;
  nullable: boolean;
  field?: string;
  relation?: string;
  alias?: string;
  decode(data: XdrReader, lowerV13: boolean, options?: unknown): unknown;
  /** Writes the BLR of the field in the message description. */
  calcBlr(blr: { addByte(b: number): void }): void;
}

/** A blob cell of a fetched row: reads the blob within a transaction. */
export type BlobReader = (
  transaction: WireTransaction,
  callback: (err: Error | null | undefined, name: unknown, emitter?: EventEmitter) => void,
) => void;

/** A prepared statement (node-firebird Statement). */
export interface WireStatement {
  /** isc_info_sql_stmt_* of the statement. */
  type: number;
  input: SqlVar[];
  output: SqlVar[];
  execute(transaction: WireTransaction, params: unknown[], callback: (err: Error | null | undefined, ret?: { data?: unknown[][] }) => void, options?: object): void;
  fetchAll(transaction: WireTransaction, callback: (err: Error | null | undefined, rows?: unknown[][]) => void): void;
  drop(callback?: (err?: Error | null) => void): void;
}

/** A transaction of node-firebird, with its statement API. */
export interface WireTransaction {
  newStatement(query: string, callback: (err: Error | null, statement: WireStatement) => void): void;
  commit(callback: (err?: Error | null) => void): void;
  rollback(callback: (err?: Error | null) => void): void;
}

export type { Database };

/** isc_info_sql_stmt_* codes. */
export const StatementType = {
  select: 1,
  insert: 2,
  update: 3,
  delete: 4,
  ddl: 5,
  getSegment: 6,
  putSegment: 7,
  execProcedure: 8,
  startTrans: 9,
  commit: 10,
  rollback: 11,
  selectForUpdate: 12,
  setGenerator: 13,
  savepoint: 14,
} as const;
