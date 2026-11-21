// A report connection to MySQL or MariaDB through mysql2, with the behaviour of MySqlConnection and
// MySqlCommand of MySqlConnector 2.5: the session is set up as MySqlConnector sets it up (utf8mb4,
// SET NAMES, the same capability flags), the implicit transaction is begun with the statements
// MySqlConnector sends for the isolation level of the report connection, each command is sent as
// MySqlConnector sends it without Prepare (text protocol, the parameters as SQL literals in its
// text), its first result set is read as MySqlDataReader reads it, and closing the connection
// commits or rolls back that transaction.

import fs from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import mysql from 'mysql2';
import {
  type ConnectionRequest,
  CultureInfo,
  type DataConnection,
  type DataValue,
  type IsolationLevelName,
  type QueryCommand,
  type QueryResult,
} from 'reportman-engine';
import type { ConnectionSettings } from './connectionstring.js';
import { invalidOperation, MySqlException, mySqlException, notSupported, UNABLE_TO_CONNECT_TO_HOST } from './errors.js';
import { type BindOptions, bindParameters, ParameterCollection } from './params.js';
import { type ColumnDefinition, outputColumn, type ReadOptions } from './values.js';

/**
 * The statements BeginTransaction sends (MySqlConnection.GetStartTransactionPayload): the isolation
 * level of the session, then the start of the transaction.
 */
export function startTransactionStatements(level: IsolationLevelName): [string, string] {
  let text: string;
  switch (level) {
    case 'ReadUncommitted':
      text = 'read uncommitted';
      break;
    case 'ReadCommitted':
      text = 'read committed';
      break;
    case 'Serializable':
      text = 'serializable';
      break;
    case 'RepeatableRead':
    case 'Snapshot':
    case 'Unspecified':
      text = 'repeatable read';
      break;
    default:
      throw notSupported(`IsolationLevel.${level} is not supported.`);
  }
  const start = level === 'Snapshot' ? 'start transaction with consistent snapshot;' : 'start transaction;';
  return ['set session transaction isolation level ' + text + ';', start];
}

// ---------------------------------------------------------------------------------------------
// A statement with raw bytes (a binary literal of a parameter) goes as those bytes: mysql2 writes
// the text of a query as UTF-8, so its query packet is taught to send a Uint8Array as it is. And
// MySqlConnector sends SET NAMES unless the OK of the authentication says the session is utf8mb4
// already: mysql2 does not read that OK, so its handshake is taught to look.

interface QueryPacketClass {
  prototype: { toPacket(this: QueryPacketThis, sequenceId?: number): unknown };
}
interface QueryPacketThis {
  query: unknown;
  clientFlags: number;
  attributes?: Record<string, unknown>;
}
type PacketConstructor = new (id: number, buffer: Buffer, start: number, end: number) => { offset: number };

interface HandshakePacket {
  buffer: Buffer;
  offset: number;
  end: number;
  peekByte(): number;
}
interface ClientHandshakeClass {
  prototype: { handshakeResult(this: unknown, packet: HandshakePacket, connection: object): unknown };
}

const CLIENT_QUERY_ATTRIBUTES = 0x08000000;
const SERVER_SESSION_STATE_CHANGED = 0x4000;
const COM_QUERY = 3;
let patched = false;

/** Connections whose server said, in the OK of the authentication, that the session is utf8mb4. */
const utf8mb4Sessions = new WeakSet<object>();

/** A length-encoded integer at data[k]: [value, next offset]; undefined past the end. */
function lengthEncoded(data: Buffer, k: number): [number, number] | undefined {
  if (k >= data.length) return undefined;
  const b = data[k]!;
  if (b < 0xfb) return [b, k + 1];
  if (b === 0xfc) return k + 3 <= data.length ? [data.readUInt16LE(k + 1), k + 3] : undefined;
  if (b === 0xfd) return k + 4 <= data.length ? [data.readUIntLE(k + 1, 3), k + 4] : undefined;
  if (b === 0xfe) return k + 9 <= data.length ? [Number(data.readBigUInt64LE(k + 1)), k + 9] : undefined;
  return undefined;
}

/**
 * OkPayload.Create: true when the session-state information of an OK packet sets
 * character_set_client, character_set_connection and character_set_results to utf8mb4, as
 * MariaDB 11.5 and later report it after the authentication: MySqlConnector then sends no SET NAMES.
 */
export function okReportsUtf8mb4(data: Buffer): boolean {
  let k = 1; // header 0x00
  for (let i = 0; i < 2; i++) {
    const n = lengthEncoded(data, k); // affected rows, last insert id
    if (n === undefined) return false;
    k = n[1];
  }
  if (k + 4 > data.length) return false;
  const status = data.readUInt16LE(k);
  k += 4; // status flags, warnings
  if ((status & SERVER_SESSION_STATE_CHANGED) === 0) return false;
  const info = lengthEncoded(data, k);
  if (info === undefined) return false;
  k = info[1] + info[0];
  const total = lengthEncoded(data, k);
  if (total === undefined) return false;
  k = total[1];
  const end = Math.min(data.length, k + total[0]);
  const values = new Map<string, string>();
  while (k < end) {
    const type = data[k++]!;
    const length = lengthEncoded(data, k);
    if (length === undefined) return false;
    const next = length[1] + length[0];
    if (type === 0) {
      // SESSION_TRACK_SYSTEM_VARIABLES: name, value
      let j = length[1];
      while (j < next) {
        const name = lengthEncoded(data, j);
        if (name === undefined) break;
        const nameText = data.toString('utf8', name[1], name[1] + name[0]);
        j = name[1] + name[0];
        const value = lengthEncoded(data, j);
        if (value === undefined) break;
        values.set(nameText, data.toString('utf8', value[1], value[1] + value[0]));
        j = value[1] + value[0];
      }
    }
    k = next;
  }
  return ['character_set_client', 'character_set_connection', 'character_set_results'].every((v) => values.get(v) === 'utf8mb4');
}

/**
 * The two things mysql2 is taught: to send the bytes of a statement as they are, and to tell from
 * the OK of the authentication whether the session is already utf8mb4.
 */
function patchMysql2(): void {
  if (patched) return;
  patched = true;
  const require = createRequire(import.meta.url);
  const root = path.dirname(require.resolve('mysql2'));
  const ClientHandshake = require(path.join(root, 'lib/commands/client_handshake.js')) as ClientHandshakeClass;
  const handshakeResult = ClientHandshake.prototype.handshakeResult;
  ClientHandshake.prototype.handshakeResult = function (this: unknown, packet: HandshakePacket, connection: object) {
    if (packet.peekByte() === 0 && okReportsUtf8mb4(packet.buffer.subarray(packet.offset, packet.end))) utf8mb4Sessions.add(connection);
    return handshakeResult.call(this, packet, connection);
  };
  const Query = require(path.join(root, 'lib/packets/query.js')) as QueryPacketClass;
  const Packet = require(path.join(root, 'lib/packets/packet.js')) as PacketConstructor;
  const original = Query.prototype.toPacket;
  Query.prototype.toPacket = function (this: QueryPacketThis, ...args: [number?]) {
    if (!(this.query instanceof Uint8Array)) return original.apply(this, args);
    const headerLength = (this.clientFlags & CLIENT_QUERY_ATTRIBUTES) !== 0 ? 7 : 5;
    const length = headerLength + this.query.length;
    const buffer = Buffer.allocUnsafe(length);
    buffer.set(this.query, headerLength);
    buffer[4] = COM_QUERY;
    if (headerLength === 7) {
      buffer[5] = 0; // parameter_count
      buffer[6] = 1; // parameter_set_count
    }
    const packet = new Packet(0, buffer, 0, length);
    packet.offset = length;
    return packet;
  };
}

// ---------------------------------------------------------------------------------------------

interface RawQueryResult {
  rows: unknown;
  fields: unknown;
}

function rawQuery(connection: mysql.Connection, sql: string | Uint8Array): Promise<RawQueryResult> {
  return new Promise<RawQueryResult>((resolve, reject) => {
    connection.query({ sql: sql as string, rowsAsArray: true, typeCast: false }, (err: unknown, rows: unknown, fields: unknown) =>
      err ? reject(mySqlException(err)) : resolve({ rows, fields }),
    );
  });
}

/** The first result set of a (multi-statement) result: what MySqlDataReader is positioned on. */
function firstResultSet(raw: RawQueryResult): { fields: ColumnDefinition[]; rows: (Buffer | null)[][] } | undefined {
  const { rows, fields } = raw;
  if (!Array.isArray(fields) || fields.length === 0) return undefined;
  const multi = fields[0] === undefined || Array.isArray(fields[0]);
  if (!multi) return { fields: fields as ColumnDefinition[], rows: rows as (Buffer | null)[][] };
  const sets = rows as unknown[];
  for (let i = 0; i < fields.length; i++) {
    const f = fields[i] as ColumnDefinition[] | undefined;
    if (Array.isArray(f)) return { fields: f, rows: sets[i] as (Buffer | null)[][] };
  }
  return undefined;
}

/** What the connection needs beyond the connection string. */
export interface ConnectionOptions {
  readonly culture: CultureInfo;
  /** mysql2 TLS options that replace the ones of the connection string (SSL Mode, SSL CA...). */
  readonly ssl?: mysql.SslOptions;
}

function readFile(file: string, what: string): Buffer {
  try {
    return fs.readFileSync(file);
  } catch (e) {
    const err = new MySqlException(what + file);
    (err as { cause?: unknown }).cause = e;
    throw err;
  }
}

/** The mysql2 TLS options of SSL Mode and the certificates of the connection string. */
function tlsOptions(settings: ConnectionSettings): mysql.SslOptions | undefined {
  if (settings.sslMode === 'None') return undefined;
  const verify = settings.sslMode === 'VerifyCA' || settings.sslMode === 'VerifyFull';
  const ssl: mysql.SslOptions = { rejectUnauthorized: verify, verifyIdentity: settings.sslMode === 'VerifyFull' };
  if (settings.sslCa.length > 0) ssl.ca = readFile(settings.sslCa, 'Cannot find CA Certificate File: ');
  if (settings.sslCert.length > 0) ssl.cert = readFile(settings.sslCert, 'Cannot find client certificate file: ');
  if (settings.sslKey.length > 0) ssl.key = readFile(settings.sslKey, `Could not load the client key from `);
  if (settings.certificateFile.length > 0) {
    (ssl as { pfx?: Buffer }).pfx = readFile(settings.certificateFile, 'Cannot find Certificate File');
    if (settings.certificatePassword.length > 0) ssl.passphrase = settings.certificatePassword;
  }
  return ssl;
}

const PUBLIC_KEY_REQUESTS: Readonly<Record<string, number>> = { caching_sha2_password: 2, sha256_password: 1 };

/** IPAddress.IsLoopback: 127.0.0.0/8, ::1 and their IPv4-mapped forms. */
export function isLoopback(address: string | undefined): boolean {
  if (address === undefined) return false;
  const a = address.toLowerCase();
  const v4 = a.startsWith('::ffff:') ? a.substring(7) : a;
  return v4.startsWith('127.') || a === '::1';
}

/**
 * The RSA authentication of MySqlConnector without TLS: the server's key from Server RSA Public Key
 * File, or asked to the server only with Allow Public Key Retrieval (mysql2 would always ask).
 */
function rsaPlugins(settings: ConnectionSettings): mysql.ConnectionOptions['authPlugins'] {
  let serverPublicKey: Buffer | undefined;
  if (settings.serverRsaPublicKeyFile.length > 0) {
    try {
      serverPublicKey = fs.readFileSync(settings.serverRsaPublicKeyFile);
    } catch (e) {
      const err = new MySqlException(`Couldn't load server's RSA public key from '${settings.serverRsaPublicKeyFile}'`);
      (err as { cause?: unknown }).cause = e;
      throw err;
    }
  }
  const plugins: Record<string, mysql.AuthPlugin> = {};
  for (const [name, request] of Object.entries(PUBLIC_KEY_REQUESTS)) {
    const factory = mysql.authPlugins[name as 'caching_sha2_password' | 'sha256_password'];
    const make = factory(serverPublicKey === undefined ? {} : { serverPublicKey });
    plugins[name] = (metadata) => {
      const step = make(metadata);
      return (data) => {
        const out = step(data);
        // a connection to a loopback address may ask for the key, as MySqlConnector lets it
        const remote = (metadata.connection as unknown as { stream?: { remoteAddress?: string } }).stream?.remoteAddress;
        if (!settings.allowPublicKeyRetrieval && !isLoopback(remote) && Buffer.isBuffer(out) && out.length === 1 && out[0] === request) {
          throw new MySqlException(
            `Authentication method '${name}' failed. Either use a secure connection, specify the server's RSA public key with ServerRSAPublicKeyFile, or set AllowPublicKeyRetrieval=True.`,
            UNABLE_TO_CONNECT_TO_HOST,
          );
        }
        return out;
      };
    };
  }
  return plugins;
}

function connect(options: mysql.ConnectionOptions): Promise<mysql.Connection> {
  return new Promise<mysql.Connection>((resolve, reject) => {
    const connection = mysql.createConnection(options);
    connection.on('error', () => undefined);
    connection.connect((err: unknown) => {
      if (err) {
        connection.destroy();
        reject(err);
      } else resolve(connection);
    });
  });
}

/** An open report connection with its implicit transaction. */
export class MySqlConnection implements DataConnection {
  private readonly connection: mysql.Connection;
  private readonly settings: ConnectionSettings;
  private readonly bind: BindOptions;
  private readonly read: ReadOptions;
  private open = true;
  /** Commands run one after another, as on one MySqlConnection. */
  private queue: Promise<unknown> = Promise.resolve();

  private constructor(connection: mysql.Connection, settings: ConnectionSettings, options: ConnectionOptions) {
    this.connection = connection;
    this.settings = settings;
    this.bind = {
      noBackslashEscapes: settings.noBackslashEscapes,
      allowUserVariables: settings.allowUserVariables,
      dateTimeKind: settings.dateTimeKind,
      culture: options.culture,
    };
    this.read = {
      treatTinyAsBoolean: settings.treatTinyAsBoolean,
      guidFormat: settings.guidFormat,
      allowZeroDateTime: settings.allowZeroDateTime,
      convertZeroDateTime: settings.convertZeroDateTime,
      dateTimeKind: settings.dateTimeKind,
      culture: options.culture,
    };
  }

  /** MySqlConnection.Open and BeginTransaction(isolation level of the request). */
  static async open(settings: ConnectionSettings, request: ConnectionRequest, options: ConnectionOptions): Promise<MySqlConnection> {
    if (settings.protocol === 'Pipe' || settings.protocol === 'Memory') {
      throw notSupported(`The MySQL driver of Report Manager connects through TCP or a Unix socket, not ${settings.protocol === 'Pipe' ? 'a named pipe' : 'shared memory'}`);
    }
    patchMysql2();
    const hosts = settings.hosts.length > 0 ? settings.hosts : ['localhost'];
    const ssl = options.ssl ?? tlsOptions(settings);
    // The capability flags of MySqlConnector: no IGNORE_SPACE (it changes how the server parses
    // function names), no ODBC, LOCAL_FILES only with AllowLoadLocalInfile (not supported here)
    const flags = ['-IGNORE_SPACE', '-ODBC', '-LOCAL_FILES', '-LONG_FLAG'];
    const base: mysql.ConnectionOptions = {
      port: settings.port,
      user: settings.user,
      password: settings.password,
      database: settings.database.length > 0 ? settings.database : undefined,
      // utf8mb4_general_ci in the handshake, then SET NAMES utf8mb4, as MySqlConnector
      charsetNumber: 45,
      multipleStatements: true,
      flags,
      connectTimeout: settings.connectionTimeout * 1000,
      compress: settings.useCompression,
      // the statement is sent as the driver built it
      queryFormat: ((sql: unknown) => sql) as unknown as mysql.ConnectionOptions['queryFormat'],
      connectAttributes: settings.applicationName.length > 0 ? { program_name: settings.applicationName } : undefined,
    };
    let connection: mysql.Connection | undefined;
    let lastError: unknown;
    for (const host of hosts) {
      const unix = settings.protocol === 'Unix' || (process.platform !== 'win32' && (host.startsWith('/') || host.startsWith('./')));
      // without TLS (and off a Unix socket) the password goes RSA-encrypted, as MySqlConnector allows it
      const target: mysql.ConnectionOptions = unix ? { ...base, socketPath: host } : { ...base, host, authPlugins: rsaPlugins(settings) };
      try {
        connection = await connect(ssl === undefined ? target : { ...target, ssl });
      } catch (e) {
        const code = (e as { code?: string }).code;
        // SSL Mode=Preferred: a server without TLS is used without it
        if (code === 'HANDSHAKE_NO_SSL_SUPPORT' && settings.sslMode === 'Preferred' && options.ssl === undefined) {
          try {
            connection = await connect(target);
          } catch (e2) {
            lastError = e2;
          }
        } else lastError = e;
        // A server that answered with an error (a wrong password...) is not tried again on another host
        if (connection === undefined && typeof (lastError as { sqlState?: unknown }).sqlState === 'string') break;
      }
      if (connection !== undefined) break;
    }
    if (connection === undefined) {
      const e = mySqlException(lastError);
      if (e instanceof MySqlException && e.number === UNABLE_TO_CONNECT_TO_HOST && hosts.length > 1 && e.message === 'Connect Timeout expired.') {
        throw new MySqlException('Unable to connect to any of the specified MySQL hosts.', UNABLE_TO_CONNECT_TO_HOST);
      }
      throw e;
    }
    try {
      // set collation_connection to the server default, unless the server said the session is utf8mb4
      if (!utf8mb4Sessions.has(connection)) await rawQuery(connection, 'SET NAMES utf8mb4;');
      const [isolation, start] = startTransactionStatements(request.isolationLevel);
      await rawQuery(connection, isolation);
      await rawQuery(connection, start);
      return new MySqlConnection(connection, settings, options);
    } catch (e) {
      connection.destroy();
      throw e;
    }
  }

  query(command: QueryCommand): Promise<QueryResult> {
    // MySqlCommand.IsValid fails before anything reaches the server, and so this does, at once:
    // GETVALUEFROMSQL, which needs its answer synchronously, gets the error MySqlConnector gives
    // (the parameters are added to the command first: a repeated name fails there)
    const parameters = new ParameterCollection(command.parameters);
    if (!this.open) throw invalidOperation('Connection must be Open; current state is Closed');
    if (!command.inTransaction && !this.settings.ignoreCommandTransaction) {
      throw invalidOperation("The transaction associated with this command is not the connection's active transaction; see https://mysqlconnector.net/trans");
    }
    if (command.sql.trim().length === 0) throw invalidOperation('CommandText must be specified');
    const run = this.queue.then(() => this.run(command.sql, parameters));
    this.queue = run.catch(() => undefined);
    return run;
  }

  private async run(sql: string, parameters: ParameterCollection): Promise<QueryResult> {
    const statement = bindParameters(sql, parameters, this.bind);
    const raw = await rawQuery(this.connection, statement);
    const set = firstResultSet(raw);
    if (set === undefined) return { columns: [], rows: [] };
    const columns = set.fields.map((f) =>
      outputColumn(
        {
          name: f.name,
          columnType: f.columnType,
          columnLength: f.columnLength >>> 0,
          characterSet: f.characterSet,
          flags: f.flags,
          decimals: f.decimals,
        },
        this.read,
      ),
    );
    const rows: DataValue[][] = [];
    for (const row of set.rows) {
      const values = new Array<DataValue>(columns.length);
      for (let i = 0; i < columns.length; i++) {
        const cell = row[i];
        values[i] = cell === null || cell === undefined ? null : columns[i]!.read(cell);
      }
      rows.push(values);
    }
    return { columns: columns.map((c) => c.info), rows };
  }

  async close(commit: boolean): Promise<void> {
    if (!this.open) return;
    this.open = false;
    await this.queue;
    try {
      await rawQuery(this.connection, commit ? 'commit' : 'rollback');
    } finally {
      await new Promise<void>((resolve) => this.connection.end(() => resolve()));
    }
  }
}

