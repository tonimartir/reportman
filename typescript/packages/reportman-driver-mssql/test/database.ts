// The test database: a SQL Server 2022 (the official image) with samples.db copied into it, plus a
// TYPES table with every type a report can read and its edge values, a VARIANTS table of
// sql_variant values of every base type, and a UDTS table (hierarchyid, geometry, geography).
//
// The server of the tests is the container reportman-mssql-test (see README.md of this package):
//
//   docker run -d --name reportman-mssql-test -p 51433:1433 -e ACCEPT_EULA=Y \
//     -e 'MSSQL_SA_PASSWORD=RmTest_only1!' mcr.microsoft.com/mssql/server:2022-latest
//
// RM_MSSQL_HOST, RM_MSSQL_PORT, RM_MSSQL_DATABASE, RM_MSSQL_USER and RM_MSSQL_PASSWORD point the
// tests at another server. When the server cannot be reached the database tests are skipped.
//
//   node test/database.ts [--force]      loads the database (from packages/reportman-driver-mssql)

import { DatabaseSync } from 'node:sqlite';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import type { ConnectionRequest } from '@reportman/engine';
import tedious from 'tedious';

const here = path.dirname(fileURLToPath(import.meta.url));
export const repoRoot = path.resolve(here, '../../../..');
export const samplesDir = path.join(repoRoot, 'samples');

export const mssqlTest = {
  // 127.0.0.1: SqlClient does not reach the WSL port forward through localhost (it tries ::1)
  host: process.env.RM_MSSQL_HOST ?? '127.0.0.1',
  port: Number(process.env.RM_MSSQL_PORT ?? 51433),
  database: process.env.RM_MSSQL_DATABASE ?? 'reportman_test',
  user: process.env.RM_MSSQL_USER ?? 'sa',
  password: process.env.RM_MSSQL_PASSWORD ?? 'RmTest_only1!',
};

/** The SqlClient connection string of the test database (for golden-cs and the driver), with extra options. */
export function connectionString(extra = '', database = mssqlTest.database): string {
  return (
    `Server=${mssqlTest.host},${mssqlTest.port};Database=${database};User ID=${mssqlTest.user};Password=${mssqlTest.password};` +
    'TrustServerCertificate=True' +
    (extra.length > 0 ? ';' + extra : '')
  );
}

/** A connection request as the engine makes it (golden-cs sql runs without a transaction: ReadCommitted). */
export function request(isolationLevel: ConnectionRequest['isolationLevel'] = 'ReadCommitted'): ConnectionRequest {
  return {
    database: {} as ConnectionRequest['database'],
    alias: 'SAMPLES',
    connectionString: '',
    providerFactory: 'SQLServer',
    engineSqlite: false,
    dbParam: () => '',
    isolationLevel,
  };
}

/** A database without ALLOW_SNAPSHOT_ISOLATION. */
export const NO_SNAPSHOT_DATABASE = 'reportman_nosnap';

/** Bump it when the tables or their rows change: the database is loaded again. */
const LOAD_VERSION = 6;

function open(database: string): Promise<tedious.Connection> {
  return new Promise((resolve, reject) => {
    const c = new tedious.Connection({
      server: mssqlTest.host,
      authentication: { type: 'default', options: { userName: mssqlTest.user, password: mssqlTest.password } },
      options: { port: mssqlTest.port, database, encrypt: true, trustServerCertificate: true, connectTimeout: 5000, rowCollectionOnRequestCompletion: true },
    });
    c.on('error', () => undefined);
    c.connect((err) => (err ? reject(err) : resolve(c)));
  });
}

/** Runs a batch; the rows of its last result set as objects. */
export function batch(c: tedious.Connection, sql: string): Promise<Record<string, unknown>[]> {
  return new Promise((resolve, reject) => {
    const rows: Record<string, unknown>[] = [];
    const request = new tedious.Request(sql, (err) => (err ? reject(err) : resolve(rows)));
    request.on('row', (columns: { value: unknown; metadata: { colName: string } }[]) => {
      const row: Record<string, unknown> = {};
      for (const col of columns) row[col.metadata.colName] = col.value;
      rows.push(row);
    });
    c.execSqlBatch(request);
  });
}

function close(c: tedious.Connection): Promise<void> {
  return new Promise((resolve) => {
    c.on('end', () => resolve());
    c.close();
  });
}

/** True when the test server answers (within a few seconds). */
export async function isReachable(): Promise<boolean> {
  try {
    await close(await open('master'));
    return true;
  } catch {
    return false;
  }
}

/** Runs a batch on the test database (or master). */
export async function runBatch(sql: string, database = mssqlTest.database): Promise<Record<string, unknown>[]> {
  const c = await open(database);
  try {
    return await batch(c, sql);
  } finally {
    await close(c);
  }
}

// The tables of samples.db with SQL Server types: prices and rates as DECIMAL, dates as DATE, the
// texts of the customers as VARCHAR (code page 1252) and the rest as NVARCHAR, the fish notes and
// pictures as NVARCHAR(MAX) and VARBINARY(MAX).
const TABLES: { name: string; ddl: string; columns: string[] }[] = [
  {
    name: 'CATEGORIES',
    ddl: 'CATEGORY_ID INT NOT NULL PRIMARY KEY, NAME NVARCHAR(40) NOT NULL, DESCRIPTION NVARCHAR(80)',
    columns: ['CATEGORY_ID', 'NAME', 'DESCRIPTION'],
  },
  {
    name: 'PRODUCTS',
    ddl:
      'PRODUCT_ID INT NOT NULL PRIMARY KEY, SKU VARCHAR(12) NOT NULL, EAN13 CHAR(13) NOT NULL, NAME NVARCHAR(60) NOT NULL, ' +
      'CATEGORY_ID INT NOT NULL REFERENCES CATEGORIES (CATEGORY_ID), UNIT NVARCHAR(20) NOT NULL, UNIT_PRICE DECIMAL(10,2) NOT NULL, ' +
      'UNITS_IN_STOCK INT NOT NULL, REORDER_LEVEL SMALLINT NOT NULL',
    columns: ['PRODUCT_ID', 'SKU', 'EAN13', 'NAME', 'CATEGORY_ID', 'UNIT', 'UNIT_PRICE', 'UNITS_IN_STOCK', 'REORDER_LEVEL'],
  },
  {
    name: 'EMPLOYEES',
    ddl:
      'EMPLOYEE_ID INT NOT NULL PRIMARY KEY, FIRST_NAME NVARCHAR(30) NOT NULL, LAST_NAME NVARCHAR(30) NOT NULL, ' +
      'TITLE NVARCHAR(40) NOT NULL, HIRE_DATE DATE NOT NULL, REGION NVARCHAR(30) NOT NULL',
    columns: ['EMPLOYEE_ID', 'FIRST_NAME', 'LAST_NAME', 'TITLE', 'HIRE_DATE', 'REGION'],
  },
  {
    name: 'CUSTOMERS',
    ddl:
      'CUSTOMER_ID INT NOT NULL PRIMARY KEY, CODE VARCHAR(8) NOT NULL, COMPANY_NAME VARCHAR(60) NOT NULL, ' +
      'CONTACT_NAME VARCHAR(60) NOT NULL, ADDRESS VARCHAR(60) NOT NULL, POSTAL_CODE VARCHAR(10) NOT NULL, ' +
      'CITY VARCHAR(40) NOT NULL, COUNTRY VARCHAR(40) NOT NULL, PHONE VARCHAR(20) NOT NULL, EMAIL VARCHAR(60) NOT NULL, ' +
      'VAT_RATE DECIMAL(5,2) NOT NULL, CUSTOMER_SINCE DATE NOT NULL',
    columns: ['CUSTOMER_ID', 'CODE', 'COMPANY_NAME', 'CONTACT_NAME', 'ADDRESS', 'POSTAL_CODE', 'CITY', 'COUNTRY', 'PHONE', 'EMAIL', 'VAT_RATE', 'CUSTOMER_SINCE'],
  },
  {
    name: 'ORDERS',
    ddl:
      'ORDER_ID INT NOT NULL PRIMARY KEY, ORDER_NUMBER VARCHAR(12) NOT NULL, CUSTOMER_ID INT NOT NULL REFERENCES CUSTOMERS (CUSTOMER_ID), ' +
      'EMPLOYEE_ID INT NOT NULL REFERENCES EMPLOYEES (EMPLOYEE_ID), ORDER_DATE DATE NOT NULL, SHIP_DATE DATE, STATUS VARCHAR(12) NOT NULL, ' +
      'VAT_RATE DECIMAL(5,2) NOT NULL',
    columns: ['ORDER_ID', 'ORDER_NUMBER', 'CUSTOMER_ID', 'EMPLOYEE_ID', 'ORDER_DATE', 'SHIP_DATE', 'STATUS', 'VAT_RATE'],
  },
  {
    name: 'ORDER_LINES',
    ddl:
      'ORDER_ID INT NOT NULL REFERENCES ORDERS (ORDER_ID), LINE_NO SMALLINT NOT NULL, PRODUCT_ID INT NOT NULL REFERENCES PRODUCTS (PRODUCT_ID), ' +
      'QUANTITY INT NOT NULL, UNIT_PRICE DECIMAL(10,2) NOT NULL, DISCOUNT DECIMAL(5,2) NOT NULL, PRIMARY KEY (ORDER_ID, LINE_NO)',
    columns: ['ORDER_ID', 'LINE_NO', 'PRODUCT_ID', 'QUANTITY', 'UNIT_PRICE', 'DISCOUNT'],
  },
  {
    name: 'FISHES',
    ddl:
      'SPECIES_NO INT NOT NULL PRIMARY KEY, CATEGORY NVARCHAR(15) NOT NULL, COMMON_NAME NVARCHAR(30) NOT NULL, ' +
      'SPECIES_NAME NVARCHAR(40) NOT NULL, LENGTH_CM FLOAT NOT NULL, LENGTH_IN FLOAT NOT NULL, NOTES NVARCHAR(MAX), GRAPHIC VARBINARY(MAX)',
    columns: ['SPECIES_NO', 'CATEGORY', 'COMMON_NAME', 'SPECIES_NAME', 'LENGTH_CM', 'LENGTH_IN', 'NOTES', 'GRAPHIC'],
  },
  {
    name: 'GREETINGS',
    ddl:
      'GREETING_ID INT NOT NULL PRIMARY KEY, [LANGUAGE] NVARCHAR(20) NOT NULL, NATIVE_NAME NVARCHAR(30) NOT NULL, ' +
      'SCRIPT NVARCHAR(20) NOT NULL, DIRECTION NVARCHAR(3) NOT NULL, GREETING NVARCHAR(80) NOT NULL, PARAGRAPH NVARCHAR(400) NOT NULL',
    columns: ['GREETING_ID', 'LANGUAGE', 'NATIVE_NAME', 'SCRIPT', 'DIRECTION', 'GREETING', 'PARAGRAPH'],
  },
];

const INDEXES = ['CREATE INDEX IX_ORDERS_DATE ON ORDERS (ORDER_DATE)'];

/** The columns of TYPES: name and declaration. */
export const TYPES_COLUMNS: readonly [string, string][] = [
  ['T_TINYINT', 'TINYINT'],
  ['T_SMALLINT', 'SMALLINT'],
  ['T_INT', 'INT'],
  ['T_BIGINT', 'BIGINT'],
  ['T_BIT', 'BIT'],
  ['T_DEC5_2', 'DECIMAL(5,2)'],
  ['T_DEC18_4', 'DECIMAL(18,4)'],
  ['T_NUM28_0', 'NUMERIC(28,0)'],
  ['T_DEC38_10', 'DECIMAL(38,10)'],
  ['T_DEC38_0', 'DECIMAL(38,0)'],
  ['T_DEC38_38', 'DECIMAL(38,38)'],
  ['T_MONEY', 'MONEY'],
  ['T_SMALLMONEY', 'SMALLMONEY'],
  ['T_FLOAT', 'FLOAT'],
  ['T_REAL', 'REAL'],
  ['T_CHAR', 'CHAR(10)'],
  ['T_VARCHAR', 'VARCHAR(20)'],
  ['T_VARCHARMAX', 'VARCHAR(MAX)'],
  ['T_NCHAR', 'NCHAR(10)'],
  ['T_NVARCHAR', 'NVARCHAR(30)'],
  ['T_NVARCHARMAX', 'NVARCHAR(MAX)'],
  ['T_TEXT', 'TEXT'],
  ['T_NTEXT', 'NTEXT'],
  ['T_GREEK', 'VARCHAR(20) COLLATE Greek_CI_AS'],
  ['T_CYRILLIC', 'VARCHAR(20) COLLATE Cyrillic_General_CI_AS'],
  ['T_JAPANESE', 'VARCHAR(20) COLLATE Japanese_CI_AS'],
  ['T_UTF8', 'VARCHAR(40) COLLATE Latin1_General_100_CI_AS_SC_UTF8'],
  ['T_CASE', 'VARCHAR(10) COLLATE Latin1_General_CS_AS'],
  ['T_TEXT_GREEK', 'TEXT COLLATE Greek_CI_AS'],
  ['T_BINARY', 'BINARY(4)'],
  ['T_VARBINARY', 'VARBINARY(8)'],
  ['T_VARBINARYMAX', 'VARBINARY(MAX)'],
  ['T_IMAGE', 'IMAGE'],
  ['T_DATE', 'DATE'],
  ['T_TIME', 'TIME'],
  ['T_TIME0', 'TIME(0)'],
  ['T_TIME3', 'TIME(3)'],
  ['T_DATETIME', 'DATETIME'],
  ['T_DATETIME2', 'DATETIME2'],
  ['T_DATETIME2_0', 'DATETIME2(0)'],
  ['T_DATETIME2_3', 'DATETIME2(3)'],
  ['T_SMALLDATETIME', 'SMALLDATETIME'],
  ['T_DTO', 'DATETIMEOFFSET'],
  ['T_DTO0', 'DATETIMEOFFSET(0)'],
  ['T_GUID', 'UNIQUEIDENTIFIER'],
  ['T_XML', 'XML'],
  ['T_VARIANT', 'SQL_VARIANT'],
  ['T_ROWVERSION', 'ROWVERSION'],
];

/** The rows of TYPES, in the order of TYPES_COLUMNS but the ROWVERSION (the server fills it). */
const TYPES_ROWS = [
  `1, 12, 1234, 123456789, 1234567890123, 1,
   123.45, 12345678901234.5678, 1234567890123456789012345678, 1234567890123456789.1234567890,
   79228162514264337593543950335, 0.5,
   922337203685477.5807, 214748.3647, 3.141592653589793, 1.1,
   'abc', 'Hello, world', REPLICATE(CAST('long text ' AS VARCHAR(MAX)), 500), N'日本', N'日本語 Ελληνικά עברית', REPLICATE(CAST(N'ñandú 😀 ' AS NVARCHAR(MAX)), 600),
   'A text with ' + CHAR(233) + ' and a line' + CHAR(13) + CHAR(10) + 'break', N'ntext ünïcödé',
   N'Ωμέγα', N'Привет', N'日本語', N'ñandú 😀 中文', 'MixedCase', N'Αλφα',
   0x01020304, 0xDEADBEEF, CAST(REPLICATE(CAST(0xC0FFEE AS VARBINARY(MAX)), 4000) AS VARBINARY(MAX)), 0x000102FF,
   '2024-02-29', '13:45:30.1234567', '13:45:30', '13:45:30.123',
   '2024-02-29 13:45:30.997', '2024-02-29 13:45:30.1234567', '2024-02-29 13:45:30', '2024-02-29 13:45:30.123',
   '2024-02-29 13:45:29', '2024-02-29 13:45:30.1234567 +05:30', '2024-07-15 08:00:00 -07:00',
   '6F9619FF-8B86-D011-B42D-00C04FC964FF', N'<a b="1">text <c/></a>', CAST(42 AS INT)`,
  `2, 0, -32768, -2147483648, -9223372036854775808, 0,
   -999.99, -99999999999999.9999, -9999999999999999999999999999, -0.0000000001,
   -79228162514264337593543950335, -0.25,
   -922337203685477.5808, -214748.3648, -1.7976931348623157E+308, -3.4028235E+38,
   '', '', '', N'', N'', N'',
   '', N'',
   '', '', '', '', '', '',
   0x00000000, 0x, 0x, 0x,
   '0001-01-01', '00:00:00', '00:00:00', '00:00:00',
   '1753-01-01 00:00:00', '0001-01-01 00:00:00', '0001-01-01', '0001-01-01',
   '1900-01-01 00:00:00', '0001-01-01 00:00:00 +00:00', '0001-01-01 00:00:00 -14:00',
   '00000000-0000-0000-0000-000000000000',
   N'<?pi data?><!-- note --><r xmlns="urn:x" a=''q&quot;uote'' b="tab&#x9;nl&#xA;cr&#xD;"><t>a &lt; b &gt; c &amp; d</t><e></e><s xml:space="preserve">  two  </s><n>line1&#xD;&#xA;line2' + NCHAR(10) + N'line3</n></r>',
   CAST(N'variant text' AS NVARCHAR(20))`,
  `3, 255, 32767, 2147483647, 9223372036854775807, 1,
   999.99, 99999999999999.9999, 9999999999999999999999999999, 7922816251426433759.3543950335,
   1, 0.1234567890123456789012345678,
   0.0001, -0.0001, 1.7976931348623157E+308, 3.4028235E+38,
   'padded', 'trailing  ', CHAR(9) + 'tab', N'ü', N'Ω' + NCHAR(55357) + NCHAR(56832), N'x',
   'x', N'y',
   'αβγ', 'ЖЗИ', 'ｱｲｳ', 'z', 'Z', 'ω',
   0x7F7F7F7F, 0x00, 0x27, 0x80,
   '9999-12-31', '23:59:59.9999999', '23:59:59', '23:59:59.999',
   '9999-12-31 23:59:59.997', '9999-12-31 23:59:59.9999999', '9999-12-31 23:59:59', '9999-12-31 23:59:59.999',
   '2079-06-06 23:59:00', '9999-12-31 23:59:59.9999999 +00:00', '9999-12-31 23:59:59 +14:00',
   'FFFFFFFF-FFFF-FFFF-FFFF-FFFFFFFFFFFF', N'<root><x>&amp;</x></root>', CAST(12.5 AS DECIMAL(5,2))`,
  `4${', NULL'.repeat(TYPES_COLUMNS.length - 1)}`,
];

/** sql_variant values of every base type. */
const VARIANTS = [
  'CAST(1 AS TINYINT)',
  'CAST(-2 AS SMALLINT)',
  'CAST(3 AS INT)',
  'CAST(-4000000000 AS BIGINT)',
  'CAST(1 AS BIT)',
  'CAST(-12.345 AS DECIMAL(10,3))',
  'CAST(123456789.123456789 AS NUMERIC(38,9))',
  'CAST(12.3456 AS MONEY)',
  'CAST(-1.5 AS SMALLMONEY)',
  'CAST(2.5 AS FLOAT)',
  'CAST(5 AS FLOAT)',
  'CAST(0.1 AS REAL)',
  "CAST('char' AS CHAR(6))",
  "CAST('varchar ' + CHAR(233) AS VARCHAR(20))",
  "CAST(N'nchar' AS NCHAR(6))",
  "CAST(N'nvarchar Ω' AS NVARCHAR(20))",
  "CAST('Ωμέγα' COLLATE Greek_CI_AS AS VARCHAR(20))",
  'CAST(0x0102 AS BINARY(2))',
  'CAST(0xABCDEF AS VARBINARY(10))',
  "CAST('2024-02-29' AS DATE)",
  "CAST('13:45:30.1234567' AS TIME)",
  "CAST('13:45:30' AS TIME(0))",
  "CAST('2024-02-29 13:45:30.997' AS DATETIME)",
  "CAST('2024-02-29 13:45:30.1234567' AS DATETIME2)",
  "CAST('2024-02-29 13:45' AS SMALLDATETIME)",
  "CAST('2024-02-29 13:45:30.1234567 +05:30' AS DATETIMEOFFSET)",
  "CAST('6F9619FF-8B86-D011-B42D-00C04FC964FF' AS UNIQUEIDENTIFIER)",
  'NULL',
];

function hex(bytes: Uint8Array): string {
  return '0x' + Buffer.from(bytes).toString('hex');
}

function literal(value: unknown, column: string): string {
  if (value === null || value === undefined) return 'NULL';
  if (typeof value === 'bigint') return value.toString();
  if (typeof value === 'number') return String(value);
  if (typeof value === 'string') return "N'" + value.replace(/'/g, "''") + "'";
  if (value instanceof Uint8Array) return hex(value);
  throw new Error('Unexpected value of ' + column);
}

/** Copies samples.db into the test database and creates the type tables (again when LOAD_VERSION changed). */
export async function loadDatabase(force = false): Promise<void> {
  const master = await open('master');
  try {
    // the test files load the database at the same time: one after another
    await batch(master, "EXEC sp_getapplock @Resource = N'reportman_load', @LockMode = N'Exclusive', @LockOwner = N'Session', @LockTimeout = 600000");
    await batch(master, `IF DB_ID(N'${mssqlTest.database}') IS NULL CREATE DATABASE [${mssqlTest.database}]`);
    // the Snapshot isolation level of the transactions
    await batch(master, `ALTER DATABASE [${mssqlTest.database}] SET ALLOW_SNAPSHOT_ISOLATION ON`);
    // a database without it
    await batch(master, `IF DB_ID(N'${NO_SNAPSHOT_DATABASE}') IS NULL CREATE DATABASE [${NO_SNAPSHOT_DATABASE}]`);
    await batch(master, `IF OBJECT_ID(N'${NO_SNAPSHOT_DATABASE}.dbo.T') IS NULL EXEC (N'CREATE TABLE ${NO_SNAPSHOT_DATABASE}.dbo.T (A INT)')`);
    await loadTables(force);
  } finally {
    await close(master);
  }
}

async function loadTables(force: boolean): Promise<void> {
  const c = await open(mssqlTest.database);
  try {
    await batch(c, "IF OBJECT_ID(N'RM_LOAD') IS NULL CREATE TABLE RM_LOAD (VERSION INT NOT NULL)");
    const version = await batch(c, 'SELECT VERSION FROM RM_LOAD');
    if (!force && version[0]?.VERSION === LOAD_VERSION) return;
    for (const name of ['TYPES', 'VARIANTS', 'UDTS', 'RM_TX', ...[...TABLES].reverse().map((t) => t.name)]) {
      await batch(c, `IF OBJECT_ID(N'${name}') IS NOT NULL DROP TABLE [${name}]`);
    }
    for (const t of TABLES) await batch(c, `CREATE TABLE ${t.name} (${t.ddl})`);
    for (const ix of INDEXES) await batch(c, ix);
    const sqlite = new DatabaseSync(path.join(samplesDir, 'samples.db'), { readOnly: true });
    try {
      for (const t of TABLES) {
        const rows = sqlite.prepare(`SELECT ${t.columns.map((col) => '"' + col + '"').join(', ')} FROM "${t.name}" ORDER BY 1, 2`).all() as Record<string, unknown>[];
        const columns = t.columns.map((col) => '[' + col + ']').join(', ');
        const chunk = t.name === 'FISHES' ? 4 : 200;
        for (let i = 0; i < rows.length; i += chunk) {
          const values = rows.slice(i, i + chunk).map((r) => '(' + t.columns.map((col) => literal(r[col], col)).join(', ') + ')');
          await batch(c, `INSERT INTO ${t.name} (${columns}) VALUES ${values.join(', ')}`);
        }
      }
    } finally {
      sqlite.close();
    }
    await batch(c, `CREATE TABLE TYPES (ID INT NOT NULL PRIMARY KEY, ${TYPES_COLUMNS.map(([n, t]) => n + ' ' + t).join(', ')})`);
    const inserted = TYPES_COLUMNS.filter(([, t]) => t !== 'ROWVERSION').map(([n]) => n);
    for (const row of TYPES_ROWS) await batch(c, `INSERT INTO TYPES (ID, ${inserted.join(', ')}) VALUES (${row})`);
    await batch(c, 'CREATE TABLE VARIANTS (ID INT NOT NULL PRIMARY KEY, V SQL_VARIANT)');
    // one row per statement: a VALUES list would convert every value to the type of highest precedence
    await batch(c, VARIANTS.map((v, i) => `INSERT INTO VARIANTS VALUES (${i + 1}, ${v})`).join(';\n'));
    await batch(c, 'CREATE TABLE UDTS (ID INT NOT NULL PRIMARY KEY, H HIERARCHYID, G GEOMETRY, GG GEOGRAPHY)');
    await batch(
      c,
      "INSERT INTO UDTS VALUES (1, hierarchyid::Parse('/1/2/'), geometry::STGeomFromText('POINT(1 2)', 0), geography::Point(47.65, -122.34, 4326)), (2, NULL, NULL, NULL)",
    );
    await batch(c, 'CREATE TABLE RM_TX (V INT)');
    await batch(c, 'DELETE FROM RM_LOAD');
    await batch(c, 'INSERT INTO RM_LOAD (VERSION) VALUES (' + String(LOAD_VERSION) + ')');
  } finally {
    await close(c);
  }
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  loadDatabase(process.argv.includes('--force')).then(
    () => console.log('loaded ' + mssqlTest.host + ':' + String(mssqlTest.port) + '/' + mssqlTest.database),
    (e: unknown) => {
      console.error(e);
      process.exit(1);
    },
  );
}
