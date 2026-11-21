// How the connection reaches PostgreSQL: in this thread (asynchronous: every call returns a
// promise) or through a worker thread that the calls wait for (synchronous: every call returns its
// result). The synchronous transport is what lets the engine read a dataset while it evaluates an
// expression (GETVALUEFROMSQL, a dataset opened on demand), as the C# engine does with Npgsql.

import { MessageChannel, Worker, receiveMessageOnPort, type MessagePort } from 'node:worker_threads';
import type pg from 'pg';
import type { MaybePromise } from 'reportman-engine';
import { closeSession, openSession, rawError, runQuery, runSimple, type RawError, type RawQuery, type RawResult, type RawSession } from './raw.js';

/** A failure of the transport, as plain data (see raw.ts). */
export class TransportError extends Error {
  readonly raw: RawError;
  constructor(raw: RawError) {
    super(raw.message);
    this.raw = raw;
  }
}

export interface Transport {
  readonly synchronous: boolean;
  /** Connects; gives the run-time parameters the server reported. */
  open(config: pg.ClientConfig): MaybePromise<Record<string, string>>;
  query(q: RawQuery): MaybePromise<RawResult>;
  simple(sql: string): MaybePromise<void>;
  close(): MaybePromise<void>;
}

const fail = (e: unknown): never => {
  throw new TransportError(rawError(e));
};

/** The asynchronous transport: pg in this thread. */
export class AsyncTransport implements Transport {
  readonly synchronous = false;
  private session: RawSession | null = null;

  async open(config: pg.ClientConfig): Promise<Record<string, string>> {
    this.session = await openSession(config).catch(fail);
    return this.session.parameters;
  }

  query(q: RawQuery): Promise<RawResult> {
    return runQuery(this.session!, q).catch(fail);
  }

  simple(sql: string): Promise<void> {
    return runSimple(this.session!, sql).catch(fail);
  }

  async close(): Promise<void> {
    const s = this.session;
    this.session = null;
    if (s !== null) await closeSession(s).catch(fail);
  }
}

/** The worker module, next to this one (src/*.ts when the sources run, dist/*.js once built). */
function workerUrl(): URL {
  return new URL(import.meta.url.endsWith('.ts') ? './worker.ts' : './worker.js', import.meta.url);
}

/**
 * The synchronous transport: pg runs in a worker thread and this thread waits for each answer
 * (Atomics.wait), so nothing else runs here meanwhile.
 */
export class SyncTransport implements Transport {
  readonly synchronous = true;
  private readonly worker: Worker;
  private readonly port: MessagePort;
  private readonly flag = new Int32Array(new SharedArrayBuffer(4));
  /** The longest wait for an answer (ms); the worker gives up before (connect and command timeouts). */
  private readonly maxWait: number;
  private closed = false;

  constructor(maxWaitMs: number) {
    const { port1, port2 } = new MessageChannel();
    this.port = port1;
    this.maxWait = maxWaitMs;
    this.worker = new Worker(workerUrl(), { workerData: { port: port2, flag: this.flag }, transferList: [port2] });
    // An abandoned connection must not keep the process alive
    this.worker.unref();
    this.port.unref();
  }

  private call<T>(message: unknown): T {
    if (this.closed) throw new TransportError({ server: false, message: 'The connection is closed.' });
    Atomics.store(this.flag, 0, 0);
    this.port.postMessage(message);
    const start = Date.now();
    while (Atomics.load(this.flag, 0) === 0) {
      if (Date.now() - start > this.maxWait) {
        this.terminate();
        throw new TransportError({ server: false, message: 'The PostgreSQL worker did not answer in ' + String(this.maxWait) + ' ms' });
      }
      Atomics.wait(this.flag, 0, 0, 200);
    }
    const received = receiveMessageOnPort(this.port);
    if (received === undefined) throw new TransportError({ server: false, message: 'The PostgreSQL worker gave no answer' });
    const answer = received.message as { ok: boolean; value?: T; error?: RawError };
    if (!answer.ok) throw new TransportError(answer.error!);
    return answer.value as T;
  }

  private terminate(): void {
    this.closed = true;
    void this.worker.terminate();
  }

  open(config: pg.ClientConfig): Record<string, string> {
    // Functions (a password callback, a stream factory) do not cross to the worker
    for (const [k, v] of Object.entries(config))
      if (typeof v === 'function')
        throw new TransportError({ server: false, message: `The option ${k} of a synchronous PostgreSQL connection cannot be a function` });
    try {
      return this.call<Record<string, string>>({ op: 'open', config });
    } catch (e) {
      this.terminate();
      throw e;
    }
  }

  query(q: RawQuery): RawResult {
    return this.call<RawResult>({ op: 'query', query: q });
  }

  simple(sql: string): void {
    this.call<void>({ op: 'simple', sql });
  }

  close(): void {
    if (this.closed) return;
    try {
      this.call<void>({ op: 'close' });
    } finally {
      this.terminate();
    }
  }
}
