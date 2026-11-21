// The worker of the synchronous transport: it owns the pg client and answers each request of the
// main thread through a MessagePort, then wakes it (the main thread waits with Atomics.wait).
// Only plain data crosses: fields, the text of the rows, and errors as RawError.

import { workerData } from 'node:worker_threads';
import type { MessagePort } from 'node:worker_threads';
import type { ClientConfig } from 'pg';
import { closeSession, openSession, rawError, runQuery, runSimple } from './raw.ts';
import type { RawQuery, RawSession } from './raw.ts';

type Request =
  | { op: 'open'; config: ClientConfig }
  | { op: 'query'; query: RawQuery }
  | { op: 'simple'; sql: string }
  | { op: 'close' };

const data = workerData as { port: MessagePort; flag: Int32Array };
const port = data.port;
const flag = data.flag;
let session: RawSession | null = null;

function reply(message: unknown): void {
  port.postMessage(message);
  Atomics.store(flag, 0, 1);
  Atomics.notify(flag, 0);
}

process.on('uncaughtException', (e) => reply({ ok: false, error: rawError(e) }));

port.on('message', (request: Request) => {
  void (async () => {
    try {
      switch (request.op) {
        case 'open':
          session = await openSession(request.config);
          reply({ ok: true, value: session.parameters });
          return;
        case 'query':
          if (session === null) throw new Error('The connection is closed.');
          reply({ ok: true, value: await runQuery(session, request.query) });
          return;
        case 'simple':
          if (session === null) throw new Error('The connection is closed.');
          await runSimple(session, request.sql);
          reply({ ok: true });
          return;
        case 'close':
          if (session !== null) {
            const s = session;
            session = null;
            await closeSession(s);
          }
          reply({ ok: true });
          port.close();
          return;
      }
    } catch (e) {
      reply({ ok: false, error: rawError(e) });
    }
  })();
});
