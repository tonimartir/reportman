// The wire level of the driver: a pg client that runs statements with typed parameters and gives
// the fields and the raw text of the rows back, nothing parsed. It is shared by the in-process
// (asynchronous) transport and the worker of the synchronous one, so it depends only on pg.

import pg from 'pg';

/** A statement to run with the extended protocol. */
export interface RawQuery {
  text: string;
  /** Text values, binary values (Buffer) or NULL, for $1..$n. */
  values: (string | Uint8Array | null)[];
  /** The type OID of each value (0: let the server infer it). */
  types: number[];
}

/** A field of a RowDescription. */
export interface RawField {
  name: string;
  dataTypeID: number;
  dataTypeModifier: number;
}

/** The result of a statement. */
export interface RawResult {
  /** The statement returned a RowDescription (a query, even with no columns). */
  described: boolean;
  fields: RawField[];
  rows: (string | null)[][];
}

/** An error of the server (its ErrorResponse fields) or of the client (connection, protocol). */
export interface RawError {
  server: boolean;
  message: string;
  fields?: Record<string, string | undefined>;
  /** For connection failures: the address and port that did not answer, the system error code. */
  address?: string;
  port?: number;
  code?: string;
}

const SERVER_FIELDS = [
  'severity',
  'code',
  'detail',
  'hint',
  'position',
  'internalPosition',
  'internalQuery',
  'where',
  'schema',
  'table',
  'column',
  'dataType',
  'constraint',
  'file',
  'line',
  'routine',
] as const;

/** A pg error as a plain RawError (it crosses the worker boundary). */
export function rawError(e: unknown): RawError {
  const err = e as Record<string, unknown> & { message?: string };
  const message = typeof err?.message === 'string' ? err.message : String(e);
  if (e instanceof pg.DatabaseError || (typeof err?.code === 'string' && /^[0-9A-Z]{5}$/.test(err.code as string) && 'severity' in err)) {
    const fields: Record<string, string | undefined> = { message };
    for (const f of SERVER_FIELDS) {
      const v = err[f];
      fields[f] = v === undefined || v === null ? undefined : String(v);
    }
    return { server: true, message, fields };
  }
  // A connection to a name with several addresses fails with an AggregateError of each attempt
  const inner = e instanceof AggregateError && e.errors.length > 0 ? (e.errors[e.errors.length - 1] as Record<string, unknown>) : err;
  const out: RawError = { server: false, message: message.length > 0 ? message : String(inner?.message ?? '') };
  if (typeof inner?.address === 'string') out.address = inner.address as string;
  if (typeof inner?.port === 'number') out.port = inner.port as number;
  if (typeof err?.code === 'string') out.code = err.code as string;
  return out;
}

/** Every value as the text the server sent (no type parsing). */
const rawText = (value: string): string => value;

/** An open pg client and the run-time parameters the server reported (DateStyle, IntervalStyle...). */
export interface RawSession {
  client: pg.Client;
  parameters: Record<string, string>;
}

/** Opens a client. */
export async function openSession(config: pg.ClientConfig): Promise<RawSession> {
  const client = new pg.Client(config);
  const parameters: Record<string, string> = {};
  const connection = (client as unknown as { connection: NodeJS.EventEmitter }).connection;
  connection.on('parameterStatus', (msg: { parameterName: string; parameterValue: string }) => {
    parameters[msg.parameterName] = msg.parameterValue;
  });
  // A connection that fails later (server gone) must not crash the process: the next query fails
  client.on('error', () => undefined);
  await client.connect();
  return { client, parameters };
}

/** Runs one statement with the extended protocol. */
export function runQuery(session: RawSession, q: RawQuery): Promise<RawResult> {
  // pg reads the parameter OIDs and the type parsers from the same `types` option
  const types = Object.assign([...q.types], { getTypeParser: () => rawText });
  const query = new pg.Query({
    text: q.text,
    values: q.values.map((v) => (v instanceof Uint8Array && !Buffer.isBuffer(v) ? Buffer.from(v) : v)),
    types,
    rowMode: 'array',
    queryMode: 'extended',
  } as unknown as pg.QueryConfig);
  let described = false;
  const internal = query as unknown as { handleRowDescription(msg: unknown): void };
  const handleRowDescription = internal.handleRowDescription;
  internal.handleRowDescription = function (msg: unknown): void {
    described = true;
    handleRowDescription.call(this, msg);
  };
  return new Promise<RawResult>((resolve, reject) => {
    query.on('error', reject);
    query.on('end', (result) => {
      const r = result as unknown as { fields: pg.FieldDef[]; rows: (string | null)[][] };
      resolve({
        described,
        fields: r.fields.map((f) => ({ name: f.name, dataTypeID: f.dataTypeID, dataTypeModifier: f.dataTypeModifier })),
        rows: r.rows,
      });
    });
    session.client.query(query);
  });
}

/** Runs SQL with the simple protocol (BEGIN, COMMIT, SET...). */
export async function runSimple(session: RawSession, sql: string): Promise<void> {
  await session.client.query(sql);
}

/** Closes the client. */
export async function closeSession(session: RawSession): Promise<void> {
  await session.client.end();
}
