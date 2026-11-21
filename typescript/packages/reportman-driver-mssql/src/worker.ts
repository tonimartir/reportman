// The worker of a synchronous connection: it owns the tedious connection (an MsSqlConnection) and
// answers each request of the other thread through a MessagePort, then wakes it (that thread waits
// with Atomics.wait). Only plain data crosses (wire.ts).
//
// From the sources (src/*.ts, under Node's type stripping, as the tests run) the imports of the
// driver are written with .js: a resolve hook takes the .ts file next to them.

import { registerHooks } from 'node:module';
import { workerData, type MessagePort } from 'node:worker_threads';

if (import.meta.url.endsWith('.ts')) {
  registerHooks({
    resolve(specifier, context, nextResolve) {
      if (specifier.startsWith('.') && specifier.endsWith('.js') && context.parentURL?.endsWith('.ts') === true) {
        return nextResolve(specifier.substring(0, specifier.length - 3) + '.ts', context);
      }
      return nextResolve(specifier, context);
    },
  });
}

const ext = import.meta.url.endsWith('.ts') ? '.ts' : '.js';
const { MsSqlConnection } = (await import('./connection' + ext)) as typeof import('./connection.js');
const wire = (await import('./wire' + ext)) as typeof import('./wire.js');
const { CultureInfo } = await import('@reportman/engine');

type Request =
  | { op: 'open'; settings: import('./connectionstring.js').SqlSettings; isolationLevel: import('@reportman/engine').IsolationLevelName; culture: string; authentication?: unknown; tls?: unknown }
  | { op: 'query'; command: import('./wire.js').WireCommand }
  | { op: 'close'; commit: boolean };

const data = workerData as { port: MessagePort; flag: Int32Array };
const port = data.port;
const flag = data.flag;
let connection: import('./connection.js').MsSqlConnection | null = null;

function reply(message: unknown): void {
  port.postMessage(message);
  Atomics.store(flag, 0, 1);
  Atomics.notify(flag, 0);
}

process.on('uncaughtException', (e) => reply({ ok: false, error: wire.encodeError(e) }));

port.on('message', (request: Request) => {
  void (async () => {
    try {
      switch (request.op) {
        case 'open':
          connection = await MsSqlConnection.open(request.settings, { isolationLevel: request.isolationLevel } as never, {
            culture: CultureInfo.get(request.culture),
            authentication: request.authentication as never,
            tls: request.tls as never,
          });
          reply({ ok: true });
          return;
        case 'query': {
          if (connection === null) throw new Error('The connection is closed.');
          const result = await connection.queryTyped(wire.decodeCommand(request.command));
          reply({ ok: true, value: wire.encodeResult(result) });
          return;
        }
        case 'close':
          if (connection !== null) {
            const c = connection;
            connection = null;
            await c.close(request.commit);
          }
          reply({ ok: true });
          port.close();
          return;
      }
    } catch (e) {
      reply({ ok: false, error: wire.encodeError(e) });
    }
  })();
});
