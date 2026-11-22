#!/usr/bin/env node
// reportman-server: the report server with its console, over a data folder.
//
//   npx @reportman/server [--data ./reportman-data] [--port 8080] [--host 127.0.0.1] [--samples]
//                         [--admin-key KEY | --trusted] [--culture es-ES] [--standard-fonts]
//
// The drivers of @reportman/driver-postgres, -firebird, -mysql, -mssql and -http are used when they
// are installed next to it; SQLite is built in.

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import http from 'node:http';
import { randomBytes } from 'node:crypto';
import path from 'node:path';
import type { ConnectionFactory } from '@reportman/node';
import { createReportServer } from './server.js';
import { nodeHandler } from './node.js';
import type { ServerDrivers } from './connections.js';

const HELP = `reportman-server: Report Manager reports API and console

  --data <folder>     the data folder (./reportman-data): reports, connections, keys
  --port <n>          the port (8080)
  --host <address>    the address to listen on (127.0.0.1; 0.0.0.0 for every one)
  --samples           install the sample reports and their SQLite database
  --admin-key <key>   the key of the console (REPORTMAN_ADMIN_KEY; by default one kept in
                      the data folder, console.key, printed at the start)
  --trusted           open the console without a key: only on a machine of your own
  --culture <name>    the culture of the reports (en-US)
  --standard-fonts    the 14 standard PDF fonts instead of the TrueType fonts of the system
  --help              this text
`;

function parseArgs(argv: readonly string[]): Map<string, string | true> {
  const options = new Map<string, string | true>();
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]!;
    if (!arg.startsWith('--')) throw new Error('Unexpected argument: ' + arg);
    const eq = arg.indexOf('=');
    if (eq > 0) {
      options.set(arg.substring(2, eq), arg.substring(eq + 1));
      continue;
    }
    const name = arg.substring(2);
    const next = argv[i + 1];
    if (['data', 'port', 'host', 'admin-key', 'culture'].includes(name)) {
      if (next === undefined) throw new Error('--' + name + ' needs a value');
      options.set(name, next);
      i++;
    } else options.set(name, true);
  }
  return options;
}

/** A driver package when it is installed, or undefined. */
async function optional(name: string): Promise<Record<string, unknown> | undefined> {
  try {
    return (await import(name)) as Record<string, unknown>;
  } catch {
    return undefined;
  }
}

type StringDriver = (connectionString: string) => ConnectionFactory;

/** The drivers installed next to the server. */
async function installedDrivers(): Promise<{ drivers: ServerDrivers; names: string[] }> {
  const drivers: ServerDrivers = {};
  const names: string[] = [];
  const pg = await optional('@reportman/driver-postgres');
  if (typeof pg?.postgres === 'function') {
    drivers.postgresql = pg.postgres as StringDriver;
    names.push('PostgreSQL');
  }
  const fb = await optional('@reportman/driver-firebird');
  if (typeof fb?.firebird === 'function') {
    drivers.firebird = fb.firebird as StringDriver;
    names.push('Firebird');
  }
  const my = await optional('@reportman/driver-mysql');
  if (typeof my?.mysql === 'function') {
    drivers.mysql = my.mysql as StringDriver;
    names.push('MySQL');
  }
  const ms = await optional('@reportman/driver-mssql');
  if (typeof ms?.mssql === 'function') {
    drivers.sqlserver = ms.mssql as StringDriver;
    names.push('SQL Server');
  }
  const agent = await optional('@reportman/driver-http');
  if (typeof agent?.reportmanAgent === 'function') {
    const make = agent.reportmanAgent as (options: { hubDatabaseId: number; apiKey?: string }) => ConnectionFactory;
    drivers.agent = (settings) => make(settings);
    names.push('Reportman AI Agent');
  }
  return { drivers, names };
}

/** The key of the console: the one given, or the one of the data folder (created the first time). */
function adminKeyOf(dataPath: string, given: string | undefined): string {
  if (given !== undefined && given.length > 0) return given;
  const file = path.join(dataPath, 'console.key');
  if (existsSync(file)) {
    const kept = readFileSync(file, 'utf8').trim();
    if (kept.length > 0) return kept;
  }
  const key = 'rpak_' + randomBytes(24).toString('hex');
  writeFileSync(file, key + '\n', { encoding: 'utf8', mode: 0o600 });
  return key;
}

async function main(): Promise<number> {
  const args = parseArgs(process.argv.slice(2));
  if (args.has('help')) {
    process.stdout.write(HELP);
    return 0;
  }
  const text = (name: string): string | undefined => {
    const v = args.get(name);
    return typeof v === 'string' ? v : undefined;
  };
  const dataPath = path.resolve(text('data') ?? 'reportman-data');
  const port = Number.parseInt(text('port') ?? '8080', 10);
  const host = text('host') ?? '127.0.0.1';
  const trusted = args.has('trusted');
  const { drivers, names } = await installedDrivers();
  mkdirSync(dataPath, { recursive: true });
  const adminKey = trusted ? undefined : adminKeyOf(dataPath, text('admin-key') ?? process.env.REPORTMAN_ADMIN_KEY);
  const server = createReportServer({
    dataPath,
    drivers,
    trusted,
    adminKey,
    culture: text('culture'),
    fonts: args.has('standard-fonts') ? false : undefined,
  });
  if (args.has('samples')) {
    const result = server.console!.data.installSamples();
    process.stdout.write(`Samples: ${result.reports} reports copied, database ${result.database ? 'updated' : 'unchanged'}, SAMPLES connection ${result.connection ? 'added' : 'already there'}\n`);
  }
  const listener = http.createServer(nodeHandler(server));
  await new Promise<void>((resolve, reject) => {
    listener.once('error', reject);
    listener.listen(port, host, resolve);
  });
  const shown = host === '0.0.0.0' || host === '::' ? 'localhost' : host.includes(':') ? `[${host}]` : host;
  // The port it got (--port 0 asks the system for a free one)
  const actual = (listener.address() as { port: number }).port;
  process.stdout.write(`Report Manager server on http://${shown}:${actual}/  (data: ${dataPath})\n`);
  process.stdout.write(`Drivers: SQLite${names.length > 0 ? ', ' + names.join(', ') : ''}\n`);
  if (trusted) process.stdout.write('Console open without a key (--trusted)\n');
  else process.stdout.write(`Console key: ${adminKey}\n`);
  if (server.console!.data.keys().length === 0) process.stdout.write('No API key yet: the reports API is open until the console creates one\n');
  if (host !== '127.0.0.1' && host !== 'localhost' && host !== '::1') process.stdout.write('Listening on every network: put it behind HTTPS before other machines use it\n');
  return await new Promise<number>(() => {
    // runs until it is stopped
  });
}

main().then(
  (code) => process.exit(code),
  (e: unknown) => {
    process.stderr.write((e instanceof Error ? e.message : String(e)) + '\n');
    process.exit(2);
  },
);
