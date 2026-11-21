// A report connection to Firebird through node-firebird, with the behaviour of FbConnection and
// FbCommand: the implicit transaction is begun with the TPB FbTransaction builds for the isolation
// level of the report connection, every command is prepared, bound and read as FirebirdClient does
// it, and closing the connection commits or rolls back that transaction and detaches.

import type { EventEmitter } from 'node:events';
import Firebird from 'node-firebird';
import {
  CultureInfo,
  type ConnectionRequest,
  type DataConnection,
  type DataValue,
  type IsolationLevelName,
  NetException,
  type QueryCommand,
  type QueryParameter,
  type QueryResult,
} from '@reportman/engine';
import type { ConnectionSettings } from './connectionstring.js';
import { FbException, fbException } from './errors.js';
import { bindParameter, type ParameterContext } from './params.js';
import { parseNamedParameters } from './sql.js';
import { type Charset, charsetByName, SqlType } from './types.js';
import { installRawDecoders, type OutputColumn, outputColumn } from './values.js';
import { type BlobReader, type Database, StatementType, type WireStatement, type WireTransaction } from './wire.js';

const TPB = { consistency: 1, concurrency: 2, readCommitted: 15, recVersion: 17 } as const;

/** FbTransaction.BuildTpb: the isolation part of the TPB of an IsolationLevel (write, no wait). */
export function isolationTpb(level: IsolationLevelName): number[] {
  switch (level) {
    case 'Serializable':
      return [TPB.consistency];
    case 'RepeatableRead':
    case 'Snapshot':
      return [TPB.concurrency];
    default:
      return [TPB.readCommitted, TPB.recVersion];
  }
}

function invalidOperation(message: string): NetException {
  return new NetException('InvalidOperationException', message);
}

/** Calls a node-firebird callback function as a promise, its errors as FbException. */
function call<T>(run: (cb: (err: unknown, result?: T) => void) => void): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    try {
      run((err, result) => (err ? reject(fbException(err)) : resolve(result as T)));
    } catch (e) {
      reject(fbException(e));
    }
  });
}

/** Reads a blob cell of a fetched row (within the transaction of the statement). */
function readBlob(reader: BlobReader, transaction: WireTransaction): Promise<Uint8Array> {
  return new Promise<Uint8Array>((resolve, reject) => {
    reader(transaction, (err, _name, emitter?: EventEmitter) => {
      if (err) {
        reject(fbException(err));
        return;
      }
      const chunks: Buffer[] = [];
      emitter!.on('data', (chunk: Buffer) => chunks.push(Buffer.from(chunk)));
      emitter!.on('end', () => resolve(new Uint8Array(Buffer.concat(chunks))));
      emitter!.on('error', (e: unknown) => reject(fbException(e)));
    });
  });
}

/** A parameter sent as a double (blr_double = 27), whatever its value. */
class DoubleParam {
  readonly value: number;
  constructor(value: number) {
    this.value = value;
  }
  encode(msg: { addDouble(v: number): void }): void {
    msg.addDouble(this.value);
  }
  calcBlr(blr: { addByte(b: number): void }): void {
    blr.addByte(27);
  }
}

interface WireConnection {
  sendExecute(op: number, statement: unknown, transaction: unknown, callback: unknown, parameters?: unknown[]): void;
}

/**
 * node-firebird sends a number by its value, an integral one as an integer (and one beyond 2^63
 * wrongly), and the server parses a double given as text inexactly: the doubles of a statement go
 * as doubles, put in the message node-firebird built (Connection.sendExecute of this attachment).
 */
function sendDoubles(db: Database, doubles: WeakMap<object, Map<number, number>>): void {
  const cnx = (db as unknown as { connection: WireConnection }).connection;
  const send = cnx.sendExecute;
  cnx.sendExecute = function (this: WireConnection, op, statement, transaction, callback, parameters) {
    const values = doubles.get(statement as object);
    if (values !== undefined && parameters !== undefined) {
      for (const [i, v] of values) parameters[i] = new DoubleParam(v);
      doubles.delete(statement as object);
    }
    send.call(this, op, statement, transaction, callback, parameters);
  };
}

/** What the connection needs beyond the connection string. */
export interface ConnectionOptions {
  readonly culture: CultureInfo;
  readonly invariant: CultureInfo;
}

/** An open report connection with its implicit transaction. */
export class FirebirdConnection implements DataConnection {
  private readonly db: Database;
  private readonly transaction: WireTransaction;
  private readonly params: ParameterContext;
  private readonly charset: Charset;
  private open = true;
  /** The parameters of a statement to send as doubles, by index. */
  private readonly doubles = new WeakMap<object, Map<number, number>>();
  /** Commands run one after another, as on one FbConnection. */
  private queue: Promise<unknown> = Promise.resolve();

  private constructor(db: Database, transaction: WireTransaction, charset: Charset, options: ConnectionOptions) {
    this.db = db;
    this.transaction = transaction;
    this.charset = charset;
    this.params = { charset, culture: options.culture, invariant: options.invariant };
    sendDoubles(db, this.doubles);
  }

  /** FbConnection.Open and BeginTransaction(isolation level of the request). */
  static async open(settings: ConnectionSettings, request: ConnectionRequest, options: ConnectionOptions): Promise<FirebirdConnection> {
    if (settings.dialect !== 3) {
      throw new NetException('NotSupportedException', 'The Firebird driver of Report Manager only connects with SQL dialect 3');
    }
    const charset = charsetByName(settings.charset);
    if (charset === undefined) throw new NetException('ArgumentException', 'Invalid character set specified.');
    if (settings.database.length === 0) throw new NetException('ArgumentException', 'An invalid connection string argument has been supplied or a required connection string argument has not been supplied.');
    const attachOptions: Firebird.Options = {
      host: settings.dataSource.length > 0 ? settings.dataSource : 'localhost',
      port: settings.port,
      database: settings.database,
      user: settings.user,
      password: settings.password,
      encoding: settings.charset.toUpperCase() as Firebird.SupportedCharacterSet,
      lowercase_keys: false,
      blobAsText: false,
      wireCrypt: settings.wireCrypt === 'Disabled' ? Firebird.WIRE_CRYPT_DISABLE : Firebird.WIRE_CRYPT_ENABLE,
      wireCompression: settings.compression,
    };
    if (settings.role.length > 0) attachOptions.role = settings.role;
    const db = await attachWithTimeout(attachOptions, settings.connectionTimeout);
    try {
      const transaction = await call<WireTransaction>((cb) =>
        db.transaction(
          { isolation: isolationTpb(request.isolationLevel), readOnly: false, wait: false },
          cb as unknown as (err: unknown, tx: Firebird.Transaction) => void,
        ),
      );
      return new FirebirdConnection(db, transaction, charset, options);
    } catch (e) {
      db.detach();
      throw e;
    }
  }

  query(command: QueryCommand): Promise<QueryResult> {
    // FbCommand.CheckCommand fails before anything reaches the server, and so this does, at once
    if (!this.open) throw invalidOperation('Connection must be valid and open.');
    const run = this.queue.then(() => this.run(command));
    this.queue = run.catch(() => undefined);
    return run;
  }

  private async run(command: QueryCommand): Promise<QueryResult> {
    const byName = new Map<string, QueryParameter>();
    for (const p of command.parameters) {
      const key = normalizedName(p.name);
      // FbParameterCollection.IndexOf finds the first parameter with that name
      if (!byName.has(key)) byName.set(key, p);
    }
    const parsed = parseNamedParameters(command.sql, (name) => byName.has(normalizedName(name)));
    const tx = this.transaction;
    const statement = await call<WireStatement>((cb) => tx.newStatement(parsed.sql, cb as (err: Error | null, s: WireStatement) => void));
    try {
      return await this.execute(statement, parsed.names, command.parameters, byName);
    } finally {
      statement.drop();
    }
  }

  private async execute(
    statement: WireStatement,
    names: readonly string[],
    parameters: readonly QueryParameter[],
    byName: ReadonlyMap<string, QueryParameter>,
  ): Promise<QueryResult> {
    // FbCommand.ExecuteCommand: the parameters are checked and written first
    if (names.length > 0 && parameters.length === 0) throw new NetException('FbException', 'Must declare command parameters.');
    const input = statement.input ?? [];
    const values: unknown[] = [];
    if (parameters.length > 0) {
      for (let i = 0; i < input.length; i++) {
        let p: QueryParameter | undefined;
        if (names.length > 0) {
          const name = names[i];
          if (name === undefined) {
            throw new NetException('ArgumentOutOfRangeException', "Index was out of range. Must be non-negative and less than the size of the collection. (Parameter 'index')");
          }
          p = byName.get(normalizedName(name));
          if (p === undefined) throw new NetException('FbException', `Must declare the variable '${name}'.`);
        } else {
          p = parameters[i];
          if (p === undefined) {
            throw new NetException('ArgumentOutOfRangeException', "Index was out of range. Must be non-negative and less than the size of the collection. (Parameter 'index')");
          }
        }
        const v = input[i]!;
        const bound = bindParameter(p, v, this.params);
        // node-firebird turns a value for a date or time placeholder into a JavaScript Date: the
        // text goes as text, and the server reads it with its full precision
        if (bound.asText) v.type = SqlType.VARYING;
        if (bound.double === true) {
          let doubles = this.doubles.get(statement);
          if (doubles === undefined) this.doubles.set(statement, (doubles = new Map()));
          doubles.set(i, bound.value as number);
          values.push(0);
        } else values.push(bound.value);
      }
    } else if (input.length > 0) {
      throw new NetException('FbException', 'The command has ' + String(input.length) + ' placeholders and no parameters.');
    }
    const output = statement.output ?? [];
    // FbDataReader.GetSchemaTable: the columns, before any value is read
    const columns: OutputColumn[] = output.map((v) => outputColumn(v, { charset: this.charset, culture: this.params.culture }));
    installRawDecoders(output);
    const tx = this.transaction;
    const ret = await call<{ data?: unknown[][] } | undefined>((cb) => statement.execute(tx, values, cb, {}));
    let rows: unknown[][];
    if (output.length === 0) rows = [];
    else if (statement.type === StatementType.select || statement.type === StatementType.selectForUpdate) {
      rows = (await call<unknown[][] | undefined>((cb) => statement.fetchAll(tx, cb))) ?? [];
    } else {
      // EXECUTE PROCEDURE: its output parameters, one row
      rows = ret?.data !== undefined && ret.data.length > 0 ? [ret.data[0]!] : [];
    }
    const result: DataValue[][] = [];
    for (const row of rows) {
      const values: DataValue[] = new Array<DataValue>(columns.length);
      for (let i = 0; i < columns.length; i++) {
        let cell: unknown = row[i];
        if (cell === null || cell === undefined) {
          values[i] = null;
          continue;
        }
        const column = columns[i]!;
        if (column.isBlob) cell = await readBlob(cell as BlobReader, tx);
        values[i] = column.convert(cell);
      }
      result.push(values);
    }
    return { columns: columns.map((c) => c.info), rows: result };
  }

  async close(commit: boolean): Promise<void> {
    if (!this.open) return;
    this.open = false;
    await this.queue;
    const tx = this.transaction;
    try {
      await call<void>((cb) => (commit ? tx.commit(cb) : tx.rollback(cb)));
    } finally {
      await new Promise<void>((resolve) => this.db.detach(() => resolve()));
    }
  }
}

/** FbParameter.NormalizeParameterName, compared as FbParameterCollection.IndexOf does. */
function normalizedName(name: string): string {
  const n = name.length === 0 || name.charAt(0) === '@' ? name : '@' + name;
  return n.toUpperCase();
}

function attachWithTimeout(options: Firebird.Options, seconds: number): Promise<Database> {
  return new Promise<Database>((resolve, reject) => {
    let settled = false;
    const timer =
      seconds > 0
        ? setTimeout(() => {
            settled = true;
            reject(new FbException('Timeout while connecting to the server ' + String(options.host) + ':' + String(options.port) + '.'));
          }, seconds * 1000)
        : undefined;
    Firebird.attach(options, (err: unknown, db: Database) => {
      if (timer !== undefined) clearTimeout(timer);
      if (settled) {
        if (!err) db.detach();
        return;
      }
      settled = true;
      if (err) reject(fbException(err));
      else resolve(db);
    });
  });
}

