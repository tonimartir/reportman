// A synchronous report connection: tedious runs in a worker thread (worker.ts) and this thread
// waits for each answer (Atomics.wait), so query and close return their results, not promises.
// That is what lets the engine read data while it evaluates an expression (GETVALUEFROMSQL, a
// dataset opened on demand, REOPEN), as the C# engine does with SqlClient. Nothing else runs in
// this thread meanwhile.

import { MessageChannel, Worker, receiveMessageOnPort, type MessagePort } from 'node:worker_threads';
import type { ConnectionRequest, DataConnection, DataValue, QueryCommand, QueryResult } from '@reportman/engine';
import type { ConnectionOptions, TypedResult } from './connection.js';
import type { SqlSettings } from './connectionstring.js';
import { clientSqlException, invalidOperation } from './errors.js';
import { decodeError, decodeResult, encodeCommand, type WireError, type WireResult } from './wire.js';

/** The worker module, next to this one (src/*.ts when the sources run, dist/*.js once built). */
function workerUrl(): URL {
  return new URL(import.meta.url.endsWith('.ts') ? './worker.ts' : './worker.js', import.meta.url);
}

/** A report connection whose calls wait for the worker that runs tedious. */
export class SyncMsSqlConnection implements DataConnection {
  private readonly worker: Worker;
  private readonly port: MessagePort;
  private readonly flag = new Int32Array(new SharedArrayBuffer(4));
  /** The longest wait for an answer (ms): the commands of a report have no time limit. */
  private readonly maxWait: number;
  private open = true;

  private constructor(maxWaitMs: number) {
    const { port1, port2 } = new MessageChannel();
    this.port = port1;
    this.maxWait = maxWaitMs;
    this.worker = new Worker(workerUrl(), { workerData: { port: port2, flag: this.flag }, transferList: [port2] });
    // an abandoned connection must not keep the process alive
    this.worker.unref();
    this.port.unref();
  }

  /** SqlConnection.Open and BeginTransaction in the worker. */
  static open(settings: SqlSettings, request: ConnectionRequest, options: ConnectionOptions, maxWaitMs = Number.MAX_SAFE_INTEGER): SyncMsSqlConnection {
    const c = new SyncMsSqlConnection(maxWaitMs);
    try {
      c.call({ op: 'open', settings, isolationLevel: request.isolationLevel, culture: options.culture.name, authentication: options.authentication, tls: options.tls });
    } catch (e) {
      c.terminate();
      throw e;
    }
    return c;
  }

  private call<T>(message: unknown): T {
    Atomics.store(this.flag, 0, 0);
    this.port.postMessage(message);
    const start = Date.now();
    while (Atomics.load(this.flag, 0) === 0) {
      if (Date.now() - start > this.maxWait) {
        this.terminate();
        throw clientSqlException('Execution Timeout Expired.  The timeout period elapsed prior to completion of the operation or the server is not responding.', -2);
      }
      Atomics.wait(this.flag, 0, 0, 200);
    }
    const received = receiveMessageOnPort(this.port);
    if (received === undefined) throw clientSqlException('The SQL Server worker gave no answer');
    const answer = received.message as { ok: boolean; value?: T; error?: WireError };
    if (!answer.ok) throw decodeError(answer.error!);
    return answer.value as T;
  }

  private terminate(): void {
    this.open = false;
    void this.worker.terminate();
  }

  query(command: QueryCommand): QueryResult {
    const r = this.queryTyped(command);
    return { columns: r.columns, rows: r.rows.map((row) => row.map((cell): DataValue => (cell === null ? null : cell.value))) };
  }

  /** The first result set with the .NET type of each value (see MsSqlConnection.queryTyped). */
  queryTyped(command: QueryCommand): TypedResult {
    if (!this.open) throw invalidOperation("ExecuteReader requires an open and available Connection. The connection's current state is closed.");
    return decodeResult(this.call<WireResult>({ op: 'query', command: encodeCommand(command) }));
  }

  close(commit: boolean): void {
    if (!this.open) return;
    try {
      this.call<void>({ op: 'close', commit });
    } finally {
      this.terminate();
    }
  }
}
