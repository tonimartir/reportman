import { ReportItem } from "./report-item.js";

/** C# DatabaseInfo: the defaults are the ones of its constructor. */
export class DatabaseInfo extends ReportItem {
  public static FIREBIRD_PROVIDER2 = "FirebirdSql.Data.FirebirdClient";
  public alias = "";
  public providerFactory = "";
  public driver = DriverType.DotNet2;
  public dotNetDriver = DotNetDriverType.OleDb;
  // C# parity: the constructor first sets REPMAN_REPORTS, REPORT_NAME, REPORT and REPMAN_GROUPS and then clears them.
  public reportTable = "";
  public reportSearchField = "";
  public reportField = "";
  public reportGroupsTable = "";
  public connectionString = "";
  /** Optional DBX connection configuration file override. */
  public configFile = "";
  /** Load the connection parameters from the configured (or public) DBX connections file. */
  public loadParams = true;
  public transIsolation = IsolationLevel.RepeatableRead;
  constructor() {
    super();
    this.className = "TRPDATABASEINFOITEM";
  }
}

/** The default transaction isolation of a connection: the values of System.Data.IsolationLevel. */
export enum IsolationLevel {
  Unspecified = -1,
  Chaos = 16,
  ReadUncommitted = 256,
  ReadCommitted = 4096,
  RepeatableRead = 65536,
  Serializable = 1048576,
  Snapshot = 16777216,
}
/// <summary>
/// The DriverType is part of a report database information definition, indicating the technology to be used
/// to connect to the database, in .Net version you can choose DotNet or DotNet2 depending on the version you
/// are using. <see cref="Variant">DatabaseInfo</see>
/// </summary>
export enum DriverType {
  /// <summary>Borland database driver optimized for using disconnected DataSets. Not available in .Net</summary>
  DBExpress = 0,
  /// <summary>In memory database driver, it can be used to read DataSets into memory for further processing</summary>
  /// <remarks>When used in .Net it's capable of reading DataSets</remarks>
  Mybase = 1,
  /// <summary>Borland Interbase Express database driver, can access also Firebird databases.
  /// Not available in .Net</summary>
  IBX = 2,
  /// <summary>Borland Database Engine database driver, can access Paradox,Dbase, and some SQL Databases in native mode.
  /// Not available in .Net</summary>
  BDE = 3,
  /// <summary>Borland Interface to Microsoft DAO, can access any OleDB (including Microsoft Jet) or ODBC databases.
  /// Not available in .Net</summary>
  ADO = 4,
  /// <summary>Database access objects to access Interbase or 4rd databases known as Interbase Objects.
  /// Not available in .Net</summary>
  IBO = 5,
  /// <summary>Opensource Database Objects to access multiple sql database technologies (zeoslib).
  /// Not available in .Net</summary>
  ZEOS = 6,
  /// <summary>Driver used to connect to databases in .Net 1.x, because no abstraction is provided in .Net 1.x,
  /// you must select alse the driver (object instances) to be used. <see cref="Variant">DotNetDriverType</see>
  /// Available only in .Net 1.x</summary>
  DotNet = 7,
  /// <summary>Driver used to connect to databases in .Net 2.x, it's used with ProviderFactory property inside
  /// DatabaseInfo to perform the connection<see cref="Variant">DatabaseInfo</see>
  /// Available only in .Net 2.x</summary>
  DotNet2 = 8,
  /** FireDAC (Delphi) connection; the .Net engine opens it through a provider factory */
  Firedac = 9,
  /** Reportman DB Agent, reached through the Reportman Hub (HTTP) */
  HttpAgent = 10,
}
/// <summary>
/// The DotNetDriverType indicates the database provider to be used when you select DriverType.DotNet, that
/// is .Net 1.x, in this versions of .Net there were no abstraction for Database access, so you must select
/// and pre-link into your executable references to the database client library.
/// This type is not used in .Net 2.x because the functionality of database providers,
/// configured in machine.config or application.config<see cref="Variant">DatabaseInfo</see>
/// </summary>
export enum DotNetDriverType {
  /// <summary>OleDb .Net 1.x Data Provider</summary>
  OleDb,
  /// <summary>Odbc .Net 1.x Data Provider</summary>
  Odbc,
  /// <summary>Firebird for .Net 1.x Data Provider</summary>
  Firebird,
  /// <summary>SqlServer .Net 1.x Data Provider</summary>
  Sql,
  /// <summary>PostgreSql .Net 1.x Data Provider</summary>
  PostgreSql,
  /// <summary>MySql .Net 1.x Data Provider</summary>
  MySql,
  /// <summary>SQLite .Net 1.x Data Provider</summary>
  SQLite,
  /// <summary>Oracle .Net 1.x Data Provider</summary>
  Oracle,
  /// <summary>DB2 .Net 1.x Data Provider</summary>
  DB2,
  /// <summary>Sybase .Net 1.x Data Provider</summary>
  Sybase,
  /// <summary>SqlCE .Net 1.x Data Provider</summary>
  SqlCE,
}
