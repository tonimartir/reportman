// A synchronous report connection: mysql2 runs in a worker thread (worker.ts) and this thread waits
// for each answer (Atomics.wait), so query and close return their results, not promises. That is
// what lets the engine read data while it evaluates an expression (GETVALUEFROMSQL, a dataset
// opened on demand, REOPEN), as the C# engine does with MySqlConnector. Nothing else runs in this
// thread meanwhile.

import { MessageChannel, Worker, receiveMessageOnPort, type MessagePort } from 'node:worker_threads';
import type { SslOptions } from 'mysql2';
import {
  decodeError,
  decodeQueryResult,
  encodeQueryCommand,
  type ConnectionRequest,
  type CultureInfo,
  type DataConnection,
  type QueryCommand,
  type QueryResult,
  type TransferError,
  type TransferResult,
} from '@reportman/engine';
import type { ConnectionSettings } from './connectionstring.js';
import { invalidOperation, MySqlException } from './errors.js';
import { ParameterCollection } from './params.js';

/** The worker module, next to this one (src/*.ts when the sources run, dist/*.js once built). */
function workerUrl(): URL {
  return new URL(import.meta.url.endsWith('.ts') ? './worker.ts' : './worker.js', import.meta.url);
}

/** The exceptions of the driver, rebuilt from the plain data of the worker. */
export function rebuildError(w: TransferError): Error | undefined {
  if (w.netType !== 'MySqlException') return undefined;
  return new MySqlException(w.message, (w.fields.number as number | undefined) ?? 0, (w.fields.sqlState as string | null | undefined) ?? null);
}

/** A report connection whose calls wait for the worker that runs mysql2. */
export class SyncMySqlConnection implements DataConnection {
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

  /** MySqlConnection.Open and BeginTransaction(isolation level of the request), in the worker. */
  static open(
    settings: ConnectionSettings,
    request: ConnectionRequest,
    culture: CultureInfo,
    ssl?: SslOptions,
    maxWaitMs = Number.MAX_SAFE_INTEGER,
  ): SyncMySqlConnection {
    // Functions (a checkServerIdentity callback) do not cross to the worker
    for (const [k, v] of Object.entries(ssl ?? {}))
      if (typeof v === 'function') throw new MySqlException(`The option ssl.${k} of a synchronous MySQL connection cannot be a function`);
    const c = new SyncMySqlConnection(maxWaitMs);
    try {
      c.call({ op: 'open', settings, isolationLevel: request.isolationLevel, culture: culture.name, ssl });
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
        throw new MySqlException('The MySQL worker did not answer in ' + String(this.maxWait) + ' ms');
      }
      Atomics.wait(this.flag, 0, 0, 200);
    }
    const received = receiveMessageOnPort(this.port);
    if (received === undefined) throw new MySqlException('The MySQL worker gave no answer');
    const answer = received.message as { ok: boolean; value?: T; error?: TransferError };
    if (!answer.ok) throw decodeError(answer.error!, rebuildError);
    return answer.value as T;
  }

  private terminate(): void {
    this.open = false;
    void this.worker.terminate();
  }

  query(command: QueryCommand): QueryResult {
    if (!this.open) {
      // As MySqlConnection.query: the parameters are added to the command first (a repeated name
      // fails there), then MySqlCommand.IsValid fails before anything reaches the server
      new ParameterCollection(command.parameters);
      throw invalidOperation('Connection must be Open; current state is Closed');
    }
    return decodeQueryResult(this.call<TransferResult>({ op: 'query', command: encodeQueryCommand(command) }));
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
