// The plain data that crosses between this thread and the worker of a synchronous connection: the
// values of the engine (CsDecimal and RpDateTime are classes, a structured clone would lose them),
// the commands, the results and the exceptions with their .NET type.

import { CsDecimal, NetException, RpDateTime, type DataValue, type DateTimeKind, type QueryCommand } from '@reportman/engine';
import { SqlException, type SqlError } from './errors.js';
import type { NetCell, SqlColumnInfo } from './values.js';
import type { TypedResult } from './connection.js';

/** A value as plain data. */
export type WireValue =
  | null
  | undefined
  | string
  | number
  | bigint
  | boolean
  | Uint8Array
  | { readonly decimal: [string, number, boolean] }
  | { readonly dateTime: [bigint, number] };

export function encodeValue(v: DataValue): WireValue {
  if (v instanceof CsDecimal) return { decimal: [v.mag.toString(), v.scale, v.negative] };
  if (v instanceof RpDateTime) return { dateTime: [v.ticks, v.kind] };
  if (v instanceof Date) {
    const d = RpDateTime.fromJsDate(v);
    return { dateTime: [d.ticks, d.kind] };
  }
  return v;
}

export function decodeValue(v: WireValue): DataValue {
  if (v !== null && typeof v === 'object' && !(v instanceof Uint8Array)) {
    if ('decimal' in v) return CsDecimal.fromParts(BigInt(v.decimal[0]), v.decimal[1], v.decimal[2]);
    return RpDateTime.fromTicks(v.dateTime[0], v.dateTime[1] as DateTimeKind);
  }
  return v;
}

/** A command as plain data. */
export interface WireCommand {
  readonly sql: string;
  readonly parameters: { name: string; value: WireValue; valueType: QueryCommand['parameters'][number]['valueType']; dbType: QueryCommand['parameters'][number]['dbType'] }[];
  readonly dataset: string;
}

export function encodeCommand(c: QueryCommand): WireCommand {
  return {
    sql: c.sql,
    parameters: c.parameters.map((p) => ({ name: p.name, value: encodeValue(p.value), valueType: p.valueType, dbType: p.dbType })),
    dataset: c.dataset,
  };
}

export function decodeCommand(c: WireCommand): QueryCommand {
  return { ...c, parameters: c.parameters.map((p) => ({ ...p, value: decodeValue(p.value) })) };
}

/** A result as plain data. */
export interface WireResult {
  readonly columns: SqlColumnInfo[];
  readonly rows: ({ type: NetCell['type']; value: WireValue; invariantText?: string } | null)[][];
}

export function encodeResult(r: TypedResult): WireResult {
  return {
    columns: r.columns,
    rows: r.rows.map((row) =>
      row.map((c) => (c === null ? null : c.invariantText === undefined ? { type: c.type, value: encodeValue(c.value) } : { type: c.type, value: encodeValue(c.value), invariantText: c.invariantText })),
    ),
  };
}

export function decodeResult(r: WireResult): TypedResult {
  return {
    columns: r.columns,
    rows: r.rows.map((row) => row.map((c) => (c === null ? (null as unknown as NetCell) : { ...c, value: decodeValue(c.value) }))),
  };
}

/** An exception as plain data. */
export interface WireError {
  readonly netType: string | undefined;
  readonly name: string;
  readonly message: string;
  readonly errors?: SqlError[];
  readonly cause?: WireError;
}

export function encodeError(e: unknown): WireError {
  const err = e instanceof Error ? e : new Error(String(e));
  const cause = (err as { cause?: unknown }).cause;
  return {
    netType: err instanceof NetException ? err.netType : undefined,
    name: err.name,
    message: err.message,
    errors: err instanceof SqlException ? [...err.errors] : undefined,
    cause: cause instanceof Error ? encodeError(cause) : undefined,
  };
}

export function decodeError(w: WireError): Error {
  let e: Error;
  if (w.errors !== undefined) e = new SqlException(w.errors, w.message);
  else if (w.netType !== undefined) e = new NetException(w.netType, w.message);
  else {
    e = new Error(w.message);
    e.name = w.name;
  }
  if (w.cause !== undefined) (e as { cause?: unknown }).cause = decodeError(w.cause);
  return e;
}
