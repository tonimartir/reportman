// The worker of a synchronous connection: it owns the node-firebird connection (a FirebirdConnection)
// and answers each request of the other thread through a MessagePort, then wakes it (that thread
// waits with Atomics.wait). Only plain data crosses (the transfer functions of reportman-engine).
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
// The modules, loaded once: a failure to load them is the answer to every request (the other thread
// waits for an answer, it never sees an error of this thread)
const modules = (async () => {
  const { FirebirdConnection } = (await import('./connection' + ext)) as typeof import('./connection.js');
  const engine = await import('@reportman/engine');
  return { FirebirdConnection, engine };
})();
modules.catch(() => undefined);

type Request =
  | { op: 'open'; settings: import('./connectionstring.js').ConnectionSettings; isolationLevel: import('@reportman/engine').IsolationLevelName; culture: string }
  | { op: 'query'; command: import('@reportman/engine').TransferCommand }
  | { op: 'close'; commit: boolean };

const data = workerData as { port: MessagePort; flag: Int32Array };
const port = data.port;
const flag = data.flag;
let connection: import('./connection.js').FirebirdConnection | null = null;

function reply(message: unknown): void {
  port.postMessage(message);
  Atomics.store(flag, 0, 1);
  Atomics.notify(flag, 0);
}

/** An exception as plain data, also when reportman-engine could not be loaded. */
async function encoded(e: unknown): Promise<unknown> {
  try {
    return (await modules).engine.encodeError(e);
  } catch {
    const err = e instanceof Error ? e : new Error(String(e));
    return { netType: undefined, name: err.name, message: err.message, fields: {} };
  }
}

process.on('uncaughtException', (e) => void encoded(e).then((error) => reply({ ok: false, error })));

port.on('message', (request: Request) => {
  void (async () => {
    try {
      const { FirebirdConnection, engine } = await modules;
      const { CultureInfo, decodeQueryCommand, encodeQueryResult } = engine;
      switch (request.op) {
        case 'open':
          connection = await FirebirdConnection.open(request.settings, { isolationLevel: request.isolationLevel } as never, {
            culture: request.culture.length === 0 ? CultureInfo.invariant : CultureInfo.get(request.culture),
            invariant: CultureInfo.invariant,
          });
          reply({ ok: true });
          return;
        case 'query': {
          if (connection === null) throw new Error('The connection is closed.');
          const result = await connection.query(decodeQueryCommand(request.command));
          reply({ ok: true, value: encodeQueryResult(result) });
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
      reply({ ok: false, error: await encoded(e) });
    }
  })();
});
