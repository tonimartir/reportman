// A report connection to SQL Server through tedious, with the behaviour of SqlConnection,
// SqlTransaction, SqlCommand and SqlDataReader of Microsoft.Data.SqlClient 6.1: the login of
// SqlClient (the ODBC session defaults), the implicit transaction begun with the isolation level of
// the report connection (a TDS transaction-manager request, as BeginTransaction), each command sent
// as SqlClient sends it (a SQL batch without parameters, sp_executesql with the declarations of
// BuildParamList otherwise), its first result set read as SqlDataReader reads it (the result sets
// before it without columns skipped, the errors before it and inside it raised, the later ones left
// as SqlDataReader.Close leaves them), and closing the connection commits or rolls back.

import fs from 'node:fs';
import os from 'node:os';
import type { SecureContextOptions } from 'node:tls';
import tedious from 'tedious';
import {
  CultureInfo,
  NetException,
  type ConnectionRequest,
  type DataConnection,
  type DataValue,
  type IsolationLevelName,
  type QueryCommand,
  type QueryResult,
} from 'reportman-engine';
import { type SqlSettings, parseDataSource } from './connectionstring.js';
import { type SqlError, SqlException, clientSqlException, invalidOperation, notSupported } from './errors.js';
import { bindParameters } from './params.js';
import { RAW_PARAMETER, createConnection } from './raw.js';
import { rewritePlaceholders } from './sql.js';
import { type ColumnMetadata, type ColumnReader, type NetCell, type SqlColumnInfo, columnReader } from './values.js';

/** What the connection needs beyond the connection string. */
export interface ConnectionOptions {
  /** CultureInfo.CurrentCulture of the C# engine (parameter values converted to text and back). */
  readonly culture: CultureInfo;
  /** A tedious authentication that replaces the one of the connection string (Azure AD, NTLM...). */
  readonly authentication?: tedious.ConnectionAuthentication;
  /** TLS options (CA certificates...) that replace the ones of the connection string. */
  readonly tls?: SecureContextOptions;
}

/** The isolation levels of the TDS transaction-manager request (TdsEnums.TransactionManagerIsolationLevel). */
export function isolationLevelCode(level: IsolationLevelName): number {
  switch (level) {
    case 'Unspecified':
    // SqlInternalConnection.BeginSqlTransaction: Unspecified begins a ReadCommitted transaction
    case 'ReadCommitted':
      return tedious.ISOLATION_LEVEL.READ_COMMITTED;
    case 'ReadUncommitted':
      return tedious.ISOLATION_LEVEL.READ_UNCOMMITTED;
    case 'RepeatableRead':
      return tedious.ISOLATION_LEVEL.REPEATABLE_READ;
    case 'Serializable':
      return tedious.ISOLATION_LEVEL.SERIALIZABLE;
    case 'Snapshot':
      return tedious.ISOLATION_LEVEL.SNAPSHOT;
    case 'Chaos':
      // SQL.NotSupportedIsolationLevel: ADP.ArgumentOutOfRange(message, nameof(IsolationLevel))
      throw new NetException(
        'ArgumentOutOfRangeException',
        "The IsolationLevel enumeration value, 16, is not supported by the .Net Framework SqlClient Data Provider. (Parameter 'IsolationLevel')",
      );
  }
}

/** The TDS version of Type System Version. */
function tdsVersion(settings: SqlSettings): string {
  switch (settings.typeSystemVersion) {
    // SqlClient logs in with TDS 7.2 for both (the dates and times of SQL Server 2008 come as nvarchar)
    case 'SQL Server 2000':
    case 'SQL Server 2005':
      return '7_2';
    default:
      return '7_4';
  }
}

/** The tedious authentication of the connection string. */
function authentication(settings: SqlSettings, options: ConnectionOptions): tedious.ConnectionAuthentication {
  if (options.authentication !== undefined) return options.authentication;
  if (settings.integratedSecurity) {
    throw notSupported(
      'Integrated Security (Windows authentication with the credentials of the process) is not supported by the SQL Server driver of Report Manager: ' +
        "use SQL Server authentication (User ID and Password), or give mssql() an 'authentication' (NTLM with a domain, Azure AD).",
    );
  }
  switch (settings.authentication) {
    case 'NotSpecified':
    case 'SqlPassword':
      return { type: 'default', options: { userName: settings.userId, password: settings.password } };
    case 'ActiveDirectoryManagedIdentity':
      return { type: 'azure-active-directory-msi-vm', options: settings.userId.length > 0 ? { clientId: settings.userId } : {} };
    case 'ActiveDirectoryDefault':
      return { type: 'azure-active-directory-default', options: settings.userId.length > 0 ? { clientId: settings.userId } : {} };
    default:
      throw notSupported(
        `Authentication=${settings.authentication} is not supported by the SQL Server driver of Report Manager: give mssql() an 'authentication' of tedious instead.`,
      );
  }
}

/** Environment.MachineName: the NetBIOS name on Windows, the host name up to its first dot elsewhere. */
function machineName(): string {
  if (process.platform === 'win32' && process.env.COMPUTERNAME !== undefined && process.env.COMPUTERNAME.length > 0) return process.env.COMPUTERNAME;
  const name = os.hostname();
  const dot = name.indexOf('.');
  return dot > 0 ? name.substring(0, dot) : name;
}

/** The tedious configuration of a connection string, with SqlClient's behaviour where tedious has another default. */
export function tediousConfig(settings: SqlSettings, options: ConnectionOptions): tedious.ConnectionConfiguration {
  if (settings.userInstance) throw notSupported('User Instance is not supported by the SQL Server driver of Report Manager (it needs SQL Server Express on this machine).');
  if (settings.attachDbFilename.length > 0) throw notSupported('AttachDbFilename is not supported by the SQL Server driver of Report Manager: attach the database to the server.');
  if (settings.columnEncryption) throw notSupported('Column Encryption Setting=Enabled (Always Encrypted) is not supported by the SQL Server driver of Report Manager.');
  const address = parseDataSource(settings.dataSource);
  let tls = options.tls;
  if (tls === undefined && settings.serverCertificate.length > 0) tls = { ca: fs.readFileSync(settings.serverCertificate) };
  return {
    server: address.host,
    authentication: authentication(settings, options),
    options: {
      ...(address.instanceName !== undefined ? { instanceName: address.instanceName } : { port: address.port ?? 1433 }),
      database: settings.database.length > 0 ? settings.database : undefined,
      encrypt: settings.encrypt === 'Strict' ? 'strict' : settings.encrypt === 'Mandatory',
      trustServerCertificate: settings.trustServerCertificate,
      ...(settings.hostNameInCertificate.length > 0 ? { serverName: settings.hostNameInCertificate } : {}),
      ...(tls !== undefined ? { cryptoCredentialsDetails: tls } : {}),
      // Connect Timeout=0 waits for ever
      connectTimeout: settings.connectTimeout === 0 ? 2147483647 : settings.connectTimeout * 1000,
      // the C# engine sets CommandTimeout = 0 on every command: no limit
      requestTimeout: 0,
      appName: settings.applicationName,
      workstationId: settings.workstationId.length > 0 ? settings.workstationId : machineName(),
      packetSize: settings.packetSize,
      readOnlyIntent: settings.applicationIntent === 'ReadOnly',
      multiSubnetFailover: settings.multiSubnetFailover,
      tdsVersion: tdsVersion(settings),
      lowerCaseGuids: true,
      useColumnNames: false,
      rowCollectionOnDone: false,
      rowCollectionOnRequestCompletion: false,
      maxRetriesOnTransientErrors: 0,
    },
  };
}

interface ErrorToken {
  message: string;
  number: number;
  state: number;
  class: number;
  serverName: string;
  procName: string;
  lineNumber: number;
}

function sqlError(t: ErrorToken): SqlError {
  return { message: t.message, number: t.number, state: t.state, class: t.class, serverName: t.serverName, procName: t.procName, lineNumber: t.lineNumber };
}

/** The message of SqlClient for a failure of the network or of TLS while it opens a connection. */
function connectFailure(e: unknown): SqlException {
  const err = e as Error & { code?: string; cause?: Error & { code?: string } };
  const inner = err.cause instanceof Error ? err.cause : undefined;
  const text = inner?.message ?? err.message;
  if (inner !== undefined && /certificate|self[- ]signed|unable to verify/i.test(inner.message + ' ' + (inner.code ?? ''))) {
    return clientSqlException(
      'A connection was successfully established with the server, but then an error occurred during the login process. (provider: SSL Provider, error: 0 - The certificate chain was issued by an authority that is not trusted.)',
      -2146893019,
      e,
    );
  }
  if (err.code === 'ETIMEOUT') {
    return clientSqlException(
      'Connection Timeout Expired.  The timeout period elapsed while attempting to consume the pre-login handshake acknowledgement.  This could be because the pre-login handshake failed or the server was unable to respond back in time.',
      -2,
      e,
    );
  }
  return clientSqlException(
    'A network-related or instance-specific error occurred while establishing a connection to SQL Server. The server was not found or was not accessible. ' +
      `Verify that the instance name is correct and that SQL Server is configured to allow remote connections. (provider: TCP Provider, error: 0 - ${text})`,
    0,
    e,
  );
}

/** The columns and cells of a first result set, with the .NET types SqlClient gives. */
export interface TypedResult {
  columns: SqlColumnInfo[];
  rows: NetCell[][];
}

/** An open report connection with its implicit transaction. */
export class MsSqlConnection implements DataConnection {
  private readonly connection: tedious.Connection;
  private readonly options: ConnectionOptions;
  private open = true;
  /** Commands run one after another, as on one SqlConnection. */
  private queue: Promise<unknown> = Promise.resolve();
  /** The error and message tokens of the request in progress. */
  private listener: ((token: ErrorToken) => void) | null = null;
  /** The connection broke (end or a socket error). */
  private broken: Error | null = null;

  /** The version of Microsoft.SqlServer.Types SqlClient looks for (SqlConnectionString.TypeSystemAssemblyVersion). */
  private readonly typeSystemAssemblyVersion: string;
  /** Type System Version=SQL Server 2000: the max types and xml shown as text, ntext and image. */
  private readonly typeSystem2000: boolean;

  private constructor(connection: tedious.Connection, options: ConnectionOptions, settings: SqlSettings) {
    this.connection = connection;
    this.options = options;
    this.typeSystemAssemblyVersion = settings.typeSystemVersion === 'SQL Server 2012' ? '11.0.0.0' : '10.0.0.0';
    this.typeSystem2000 = settings.typeSystemVersion === 'SQL Server 2000';
    connection.on('errorMessage', (token: ErrorToken) => this.listener?.(token));
    connection.on('error', (e: Error) => {
      this.broken = e;
    });
    connection.on('end', () => {
      this.broken ??= new Error('The connection was closed.');
    });
  }

  /** SqlConnection.Open and BeginTransaction(isolation level of the request). */
  static async open(settings: SqlSettings, request: ConnectionRequest, options: ConnectionOptions): Promise<MsSqlConnection> {
    const config = tediousConfig(settings, options);
    const connection = createConnection(config, settings.currentLanguage);
    const loginErrors: SqlError[] = [];
    const onError = (token: ErrorToken): void => {
      loginErrors.push(sqlError(token));
    };
    connection.on('errorMessage', onError);
    connection.on('error', () => undefined);
    await new Promise<void>((resolve, reject) => {
      connection.connect((err?: Error) => {
        if (err === undefined || err === null) resolve();
        else reject(loginErrors.length > 0 ? new SqlException(loginErrors) : connectFailure(err));
      });
    }).catch((e: unknown) => {
      connection.close();
      throw e;
    });
    connection.removeListener('errorMessage', onError);
    const result = new MsSqlConnection(connection, options, settings);
    try {
      await result.begin(request.isolationLevel);
    } catch (e) {
      connection.close();
      throw e;
    }
    return result;
  }

  private begin(level: IsolationLevelName): Promise<void> {
    const code = isolationLevelCode(level);
    return this.transactionRequest((done) => this.connection.beginTransaction(done, '', code));
  }

  /** A transaction-manager request; its server errors as SqlException. */
  private transactionRequest(send: (done: (err?: Error | null) => void) => void): Promise<void> {
    const errors: SqlError[] = [];
    this.listener = (t) => {
      errors.push(sqlError(t));
    };
    return new Promise<void>((resolve, reject) => {
      send((err) => {
        this.listener = null;
        if (errors.length > 0) reject(new SqlException(errors));
        else if (err) reject(clientSqlException(err.message, 0, err));
        else resolve();
      });
    });
  }

  query(command: QueryCommand): Promise<QueryResult> {
    return this.queryTyped(command).then((r) => ({
      columns: r.columns,
      rows: r.rows.map((row) => row.map((cell): DataValue => (cell === null ? null : cell.value))),
    }));
  }

  /**
   * The command and its first result set with the .NET type of each value. The checks of
   * SqlCommand fail at once, before anything reaches the server: a closed connection, an empty
   * command, a parameter SqlClient cannot type or convert.
   */
  queryTyped(command: QueryCommand): Promise<TypedResult> {
    if (!this.open) throw invalidOperation('ExecuteReader requires an open and available Connection. The connection\'s current state is closed.');
    if (command.sql.length === 0) throw invalidOperation('ExecuteReader: CommandText property has not been initialized');
    const sql = rewritePlaceholders(command.sql, command.parameters);
    const collation = (this.connection as unknown as { databaseCollation?: { toBuffer(): Buffer } }).databaseCollation?.toBuffer().subarray(0, 5) ?? Buffer.alloc(5);
    const bound = command.parameters.length > 0 ? bindParameters(command.parameters, { culture: this.options.culture, collation }) : null;
    const run = this.queue.then(() => this.execute(sql, bound));
    this.queue = run.catch(() => undefined);
    return run;
  }

  private execute(sql: string, bound: ReturnType<typeof bindParameters> | null): Promise<TypedResult> {
    if (this.broken !== null) return Promise.reject(clientSqlException('A transport-level error has occurred when sending the request to the server.', 0, this.broken));
    return new Promise<TypedResult>((resolve, reject) => {
      // The response in order: until the first result set, its rows, and after it
      let phase: 'before' | 'first' | 'after' = 'before';
      const errorsBefore: SqlError[] = [];
      const errorsInFirst: SqlError[] = [];
      let readers: ColumnReader[] | null = null;
      let failure: unknown = null;
      const rows: NetCell[][] = [];
      this.listener = (token) => {
        const e = sqlError(token);
        if (phase === 'before') errorsBefore.push(e);
        else if (phase === 'first') errorsInFirst.push(e);
        else if (errorsBefore.length > 0 || e.class >= 20) errorsBefore.push(e);
      };
      const request = new tedious.Request(bound === null ? sql : 'sp_executesql', (err) => {
        this.listener = null;
        // SqlDataReader: an error before the first result set reads the whole response and
        // raises every error; an error inside it is raised by Read; the later ones are left
        if (errorsBefore.length > 0) failure = new SqlException(errorsBefore);
        else if (errorsInFirst.length > 0 && failure === null) failure = new SqlException(errorsInFirst);
        else if (failure === null && err && !(err instanceof tedious.RequestError) && !isServerAggregate(err)) failure = clientSqlException(err.message, 0, err);
        if (failure !== null) reject(failure);
        else resolve({ columns: readers?.map((r) => r.info) ?? [], rows });
      });
      request.on('columnMetadata', (columns: ColumnMetadata[] | Record<string, ColumnMetadata>) => {
        if (phase !== 'before' || errorsBefore.length > 0) return;
        phase = 'first';
        try {
          readers = (Array.isArray(columns) ? columns : Object.values(columns)).map((c) => columnReader(c, this.typeSystemAssemblyVersion, this.typeSystem2000));
        } catch (e) {
          failure ??= e;
        }
      });
      request.on('row', (columns: { value: unknown }[]) => {
        if (phase !== 'first' || readers === null || failure !== null) return;
        try {
          const row = new Array<NetCell>(columns.length);
          for (let i = 0; i < columns.length; i++) {
            const v = columns[i]!.value;
            row[i] = v === null || v === undefined ? (null as unknown as NetCell) : readers[i]!.read(v);
          }
          rows.push(row);
        } catch (e) {
          failure = e;
        }
      });
      const done = (): void => {
        if (phase === 'first') phase = 'after';
      };
      request.on('done', done);
      request.on('doneInProc', done);
      request.on('doneProc', done);
      if (bound === null) this.connection.execSqlBatch(request);
      else {
        // sp_executesql: the statement and the declarations without names, then the parameters
        request.addParameter('', tedious.TYPES.NVarChar, sql);
        request.addParameter('', tedious.TYPES.NVarChar, bound.declarations);
        for (const p of bound.parameters) request.addParameter(p.name, RAW_PARAMETER as unknown as (typeof tedious.TYPES)[keyof typeof tedious.TYPES], p.raw);
        this.connection.callProcedure(request);
      }
    });
  }

  async close(commit: boolean): Promise<void> {
    if (!this.open) return;
    this.open = false;
    await this.queue;
    try {
      const inTransaction = (this.connection as unknown as { inTransaction: boolean }).inTransaction;
      if (this.broken === null) {
        // a transaction the server ended (a COMMIT in the SQL, an error that rolled it back) is
        // a completed SqlTransaction: Commit and Rollback refuse it
        if (!inTransaction) throw invalidOperation('This SqlTransaction has completed; it is no longer usable.');
        if (commit) await this.transactionRequest((done) => this.connection.commitTransaction(done));
        else await this.transactionRequest((done) => this.connection.rollbackTransaction(done));
      }
    } finally {
      await new Promise<void>((resolve) => {
        if (this.broken !== null) {
          resolve();
          return;
        }
        this.connection.once('end', () => resolve());
        this.connection.close();
      });
    }
  }
}

/** The AggregateError tedious makes of several error tokens. */
function isServerAggregate(err: Error): boolean {
  return typeof AggregateError !== 'undefined' && err instanceof AggregateError && err.errors.every((e: unknown) => e instanceof tedious.RequestError);
}
