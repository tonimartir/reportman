// The plain data of a data connection that answers from another thread (the worker of a synchronous
// driver: the calls of the engine wait for it): the values of the engine (CsDecimal and RpDateTime
// are classes, a structured clone would lose them), the commands, the results and the exceptions
// with their .NET type and their own fields.

import { CsDecimal } from '../util/decimal.js';
import { DateTimeKind, RpDateTime } from '../util/datetime.js';
import { NetException } from '../util/netexception.js';
import type { DataColumnInfo, DataValue, QueryCommand, QueryParameter, QueryResult } from './host.js';

/** A value as plain data: what a structured clone keeps (Date, bigint, Uint8Array) is left as it is. */
export type TransferValue =
  | null
  | undefined
  | string
  | number
  | bigint
  | boolean
  | Uint8Array
  | Date
  | { readonly decimal: readonly [string, number, boolean] }
  | { readonly dateTime: readonly [bigint, number] };

export function encodeDataValue(v: DataValue): TransferValue {
  if (v instanceof CsDecimal) return { decimal: [v.mag.toString(), v.scale, v.negative] };
  if (v instanceof RpDateTime) return { dateTime: [v.ticks, v.kind] };
  return v;
}

export function decodeDataValue(v: TransferValue): DataValue {
  if (v !== null && typeof v === 'object' && !(v instanceof Uint8Array) && !(v instanceof Date)) {
    if ('decimal' in v) return CsDecimal.fromParts(BigInt(v.decimal[0]), v.decimal[1], v.decimal[2]);
    return RpDateTime.fromTicks(v.dateTime[0], v.dateTime[1] as DateTimeKind);
  }
  return v;
}

/** A command as plain data. */
export interface TransferCommand {
  readonly sql: string;
  readonly parameters: readonly (Omit<QueryParameter, 'value'> & { readonly value: TransferValue })[];
  readonly dataset: string;
}

export function encodeQueryCommand(c: QueryCommand): TransferCommand {
  return {
    sql: c.sql,
    parameters: c.parameters.map((p) => ({ ...p, value: encodeDataValue(p.value) })),
    dataset: c.dataset,
  };
}

export function decodeQueryCommand(c: TransferCommand): QueryCommand {
  return { sql: c.sql, parameters: c.parameters.map((p) => ({ ...p, value: decodeDataValue(p.value) })), dataset: c.dataset };
}

/** A result as plain data. */
export interface TransferResult {
  readonly columns: readonly DataColumnInfo[];
  readonly rows: readonly (readonly TransferValue[])[];
}

export function encodeQueryResult(r: QueryResult): TransferResult {
  return { columns: r.columns, rows: r.rows.map((row) => row.map(encodeDataValue)) };
}

export function decodeQueryResult(r: TransferResult): QueryResult {
  return { columns: r.columns, rows: r.rows.map((row) => row.map(decodeDataValue)) };
}

/**
 * An exception as plain data: its .NET type (a NetException), its name and message, the values of
 * its own fields (a driver's exception keeps its error number, SQLSTATE, status entries...) and its
 * cause.
 */
export interface TransferError {
  readonly netType: string | undefined;
  readonly name: string;
  readonly message: string;
  readonly fields: Readonly<Record<string, unknown>>;
  readonly cause?: TransferError;
}

/** Plain data: primitives, and arrays and plain objects of them. */
function isPlain(v: unknown, depth = 0): boolean {
  if (v === null || v === undefined) return true;
  const t = typeof v;
  if (t === 'string' || t === 'number' || t === 'bigint' || t === 'boolean') return true;
  if (t !== 'object' || depth > 8) return false;
  if (Array.isArray(v)) return v.every((x) => isPlain(x, depth + 1));
  const proto = Object.getPrototypeOf(v) as unknown;
  if (proto !== Object.prototype && proto !== null) return false;
  return Object.values(v as Record<string, unknown>).every((x) => isPlain(x, depth + 1));
}

/** The own fields of an exception that cross: plain data only (no functions, no class instances). */
function plainFields(e: Error): Record<string, unknown> {
  const fields: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(e)) {
    if (k === 'netType' || k === 'name' || k === 'message' || k === 'stack' || k === 'cause') continue;
    if (isPlain(v)) fields[k] = v;
  }
  return fields;
}

export function encodeError(e: unknown): TransferError {
  const err = e instanceof Error ? e : new Error(String(e));
  const cause = (err as { cause?: unknown }).cause;
  return {
    netType: err instanceof NetException ? err.netType : undefined,
    name: err.name,
    message: err.message,
    fields: plainFields(err),
    cause: cause instanceof Error ? encodeError(cause) : undefined,
  };
}

/**
 * The exception of the plain data. A driver rebuilds its own exception classes with `rebuild` (it
 * returns undefined for the others): a NetException of another type, or a plain Error with its
 * name, otherwise.
 */
export function decodeError(w: TransferError, rebuild?: (w: TransferError) => Error | undefined): Error {
  let e = rebuild?.(w);
  if (e === undefined) {
    if (w.netType !== undefined) e = new NetException(w.netType, w.message);
    else {
      e = new Error(w.message);
      e.name = w.name;
    }
    for (const [k, v] of Object.entries(w.fields)) {
      if (!(k in e)) (e as unknown as Record<string, unknown>)[k] = v;
    }
  }
  if (w.cause !== undefined) (e as { cause?: unknown }).cause = decodeError(w.cause, rebuild);
  return e;
}
