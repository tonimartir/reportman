// A synchronous report connection: node-firebird runs in a worker thread (worker.ts) and this thread
// waits for each answer (Atomics.wait), so query and close return their results, not promises.
// That is what lets the engine read data while it evaluates an expression (GETVALUEFROMSQL, a
// dataset opened on demand, REOPEN), as the C# engine does with FirebirdClient. Nothing else runs in
// this thread meanwhile.

import { MessageChannel, Worker, receiveMessageOnPort, type MessagePort } from 'node:worker_threads';
import {
  decodeError,
  decodeQueryResult,
  encodeQueryCommand,
  NetException,
  type ConnectionRequest,
  type CultureInfo,
  type DataConnection,
  type QueryCommand,
  type QueryResult,
  type TransferError,
  type TransferResult,
} from 'reportman-engine';
import type { ConnectionSettings } from './connectionstring.js';
import { FbException, type StatusEntry } from './errors.js';

/** The worker module, next to this one (src/*.ts when the sources run, dist/*.js once built). */
function workerUrl(): URL {
  return new URL(import.meta.url.endsWith('.ts') ? './worker.ts' : './worker.js', import.meta.url);
}

/** The exceptions of the driver, rebuilt from the plain data of the worker. */
export function rebuildError(w: TransferError): Error | undefined {
  if (w.netType !== 'FbException') return undefined;
  return new FbException(w.message, (w.fields.errorCode as number | undefined) ?? 0, (w.fields.errors as StatusEntry[] | undefined) ?? []);
}

/** A report connection whose calls wait for the worker that runs node-firebird. */
export class SyncFirebirdConnection implements DataConnection {
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

  /** FbConnection.Open and BeginTransaction(isolation level of the request), in the worker. */
  static open(settings: ConnectionSettings, request: ConnectionRequest, culture: CultureInfo, maxWaitMs = Number.MAX_SAFE_INTEGER): SyncFirebirdConnection {
    const c = new SyncFirebirdConnection(maxWaitMs);
    try {
      c.call({ op: 'open', settings, isolationLevel: request.isolationLevel, culture: culture.name });
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
        throw new FbException('The Firebird worker did not answer in ' + String(this.maxWait) + ' ms');
      }
      Atomics.wait(this.flag, 0, 0, 200);
    }
    const received = receiveMessageOnPort(this.port);
    if (received === undefined) throw new FbException('The Firebird worker gave no answer');
    const answer = received.message as { ok: boolean; value?: T; error?: TransferError };
    if (!answer.ok) throw decodeError(answer.error!, rebuildError);
    return answer.value as T;
  }

  private terminate(): void {
    this.open = false;
    void this.worker.terminate();
  }

  query(command: QueryCommand): QueryResult {
    // FbCommand.CheckCommand fails before anything reaches the server, as FirebirdConnection.query
    if (!this.open) throw new NetException('InvalidOperationException', 'Connection must be valid and open.');
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
