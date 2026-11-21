// Port of the runtime part of Reportman.Reporting.DatabaseInfo: a report connection, opened
// through the data host (the provider resolution of C# is the host's job).

import { DriverType, type DatabaseInfo } from '@reportman/lib';
import { toUpperNet, trimNet } from '../util/chars.js';
import type { ReportRuntime } from '../report/report.js';
import type { ConnectionRequest, DataConnection, IsolationLevelName } from './host.js';
import { type Op, wait } from './op.js';

const ISOLATION_NAMES: Record<number, IsolationLevelName> = {
  [-1]: 'Unspecified',
  16: 'Chaos',
  256: 'ReadUncommitted',
  4096: 'ReadCommitted',
  65536: 'RepeatableRead',
  1048576: 'Serializable',
  16777216: 'Snapshot',
};

/** DatabaseInfo.FIREBIRD_PROVIDER2 and SQLITECORE_PROVIDER. */
const FIREBIRD_PROVIDER2 = 'FirebirdSql.Data.FirebirdClient';
const SQLITECORE_PROVIDER = 'SQLiteCore';

/** DbConnectionStringBuilder: a value quoted when it needs it. */
function connectionStringValue(value: string): string {
  if (value.length === 0) return value;
  const needsQuote =
    value.includes(';') || value.includes("'") || value.includes('"') || value.trim() !== value || value.includes('=');
  if (!needsQuote) return value;
  if (!value.includes('"')) return '"' + value + '"';
  if (!value.includes("'")) return "'" + value + "'";
  return '"' + value.split('"').join('""') + '"';
}

/** A report connection at run time. */
export class ReportDatabase {
  readonly model: DatabaseInfo;
  readonly report: ReportRuntime;
  alias: string;
  driver: DriverType;
  providerFactory: string;
  connectionString: string;
  transIsolation: number;
  /** The open connection (with its implicit transaction), or null. */
  connection: DataConnection | null = null;

  constructor(report: ReportRuntime, model: DatabaseInfo) {
    this.report = report;
    this.model = model;
    this.alias = model.alias;
    this.driver = model.driver;
    this.providerFactory = model.providerFactory;
    this.connectionString = model.connectionString;
    this.transIsolation = model.transIsolation;
  }

  get name(): string {
    return this.model.name;
  }

  /** ReportDbParam: ALIAS_DBPARAM_NAME, else DBPARAM_NAME, trimmed; "" when absent. */
  dbParam(name: string): string {
    const params = this.report.params;
    let index = this.report.paramIndexOf(this.alias + '_DBPARAM_' + name);
    if (index < 0) index = this.report.paramIndexOf('DBPARAM_' + name);
    if (index < 0) return '';
    const value = params[index]!.value;
    return value.isNull ? '' : trimNet(value.toString(this.report.evaluator.context));
  }

  /**
   * IsEngineSqlite: a SQLite connection of the Delphi engine (FireDAC, Zeos or dbExpress, or
   * .Net without provider) whose parameters live in the report (DBPARAM_DRIVERID=SQLite and
   * DBPARAM_DATABASE).
   */
  isEngineSqlite(): boolean {
    const d = this.driver;
    if (
      d !== DriverType.Firedac &&
      d !== DriverType.ZEOS &&
      d !== DriverType.DBExpress &&
      !(d === DriverType.DotNet2 && this.providerFactory.length === 0)
    )
      return false;
    let driverId = this.dbParam('DRIVERID');
    if (driverId.length === 0) driverId = this.dbParam('DRIVERNAME');
    if (driverId.length === 0) driverId = this.dbParam('DATABASE PROTOCOL');
    return toUpperNet(driverId).startsWith('SQLITE') && this.dbParam('DATABASE').length > 0;
  }

  /** What CreateDbConnection resolves before the provider: the connection string and provider. */
  request(): ConnectionRequest {
    let usedConnectionString = this.connectionString;
    let index = this.report.paramIndexOf('ADOCONNECTIONSTRING');
    const ctx = this.report.evaluator.context;
    if (index >= 0) usedConnectionString = this.report.params[index]!.value.toString(ctx);
    index = this.report.paramIndexOf(this.alias + '_ADOCONNECTIONSTRING');
    if (index >= 0) usedConnectionString = this.report.params[index]!.value.toString(ctx);
    if (this.driver === DriverType.IBX) this.providerFactory = FIREBIRD_PROVIDER2;
    let usedFactory = this.providerFactory;
    const engineSqlite = this.isEngineSqlite();
    if (engineSqlite) {
      usedFactory = SQLITECORE_PROVIDER;
      usedConnectionString = 'Data Source=' + connectionStringValue(this.dbParam('DATABASE'));
    }
    return {
      database: this.model,
      alias: this.alias,
      connectionString: usedConnectionString,
      providerFactory: usedFactory,
      engineSqlite,
      dbParam: (name: string) => this.dbParam(name),
      isolationLevel: ISOLATION_NAMES[this.transIsolation] ?? 'RepeatableRead',
    };
  }

  /** The rows of a query come as a table (the HTTP agent's DataTable): the dataset is a view. */
  get tableResults(): boolean {
    return this.driver === DriverType.HttpAgent;
  }

  /** Connect: opens the connection and its implicit transaction (nothing for Mybase). */
  *connect(): Op<void> {
    if (this.driver === DriverType.Mybase) return;
    if (this.connection !== null) return;
    this.connection = yield* wait(this.report.host.connect(this.request()));
  }

  /**
   * DisConnect: commits the implicit transaction and closes the connection.
   * C# parity: an HTTP agent connection is not closed here (C# keeps its executor); the run
   * closes it at the end (closeAll).
   */
  *disConnect(): Op<void> {
    if (this.driver === DriverType.Mybase) return;
    if (this.driver === DriverType.HttpAgent) return;
    yield* this.close(true);
  }

  /** Closes the connection whatever the driver (end of the run, or a failure: commit false). */
  *close(commit: boolean): Op<void> {
    const c = this.connection;
    if (c === null) return;
    this.connection = null;
    yield* wait(c.close(commit));
  }
}
