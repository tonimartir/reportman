// The test database: a MySQL server (the official mysql:8.4 image) with samples.db copied into it,
// plus a TYPES table with every MySQL type a report can read and edge values, and the tables of the
// values MySqlConnector refuses by default (zero dates, a CHAR(36) that is not a Guid).
//
// The server of the tests is the container reportman-mysql-test (see README.md of this package):
//
//   docker run -d --name reportman-mysql-test -p 53306:3306 -e MYSQL_ROOT_PASSWORD=rmtest_root \
//     -e MYSQL_DATABASE=samples -e MYSQL_USER=rmtest -e MYSQL_PASSWORD=rmtest_pw mysql:8.4
//
// RM_MYSQL_HOST, RM_MYSQL_PORT, RM_MYSQL_DATABASE, RM_MYSQL_USER and RM_MYSQL_PASSWORD point the tests
// at another server (a MariaDB: reportman-mariadb-test on 53307, mariadb:11). When the server cannot
// be reached the database tests are skipped.
//
//   node test/database.ts [--force]      loads the database (from packages/reportman-driver-mysql)

import { DatabaseSync } from 'node:sqlite';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import mysql2 from 'mysql2';

const here = path.dirname(fileURLToPath(import.meta.url));
export const samplesDir = path.resolve(here, '../../../../samples');

export const mysqlTest = {
  host: process.env.RM_MYSQL_HOST ?? 'localhost',
  port: Number(process.env.RM_MYSQL_PORT ?? 53306),
  database: process.env.RM_MYSQL_DATABASE ?? 'samples',
  user: process.env.RM_MYSQL_USER ?? 'rmtest',
  password: process.env.RM_MYSQL_PASSWORD ?? 'rmtest_pw',
};

/** The MySqlConnector connection string of the test database (for golden-cs and the driver), with extra options. */
export function connectionString(extra = ''): string {
  return (
    `Server=${mysqlTest.host};Port=${mysqlTest.port};Database=${mysqlTest.database};User ID=${mysqlTest.user};Password=${mysqlTest.password}` +
    (extra.length > 0 ? ';' + extra : '')
  );
}

/** Bump it when the tables or their rows change: the database is loaded again. */
const LOAD_VERSION = 3;

function open(): Promise<mysql2.Connection> {
  return new Promise((resolve, reject) => {
    const c = mysql2.createConnection({
      host: mysqlTest.host,
      port: mysqlTest.port,
      user: mysqlTest.user,
      password: mysqlTest.password,
      database: mysqlTest.database,
      charset: 'UTF8MB4_GENERAL_CI',
      multipleStatements: true,
      connectTimeout: 5000,
    });
    c.on('error', () => undefined);
    c.connect((err) => (err ? reject(err) : resolve(c)));
  });
}

function query(c: mysql2.Connection, sql: string): Promise<unknown[]> {
  return new Promise((resolve, reject) => {
    c.query(sql, (err, rows) => (err ? reject(err) : resolve(rows as unknown[])));
  });
}

function end(c: mysql2.Connection): Promise<void> {
  return new Promise((resolve) => c.end(() => resolve()));
}

/** True when the test server answers (within a few seconds). */
export async function isReachable(): Promise<boolean> {
  let ok = false;
  try {
    await end(await open());
    ok = true;
  } catch {
    ok = false;
  }
  if (!ok && process.env.REPORTMAN_REQUIRE_DATABASES === '1')
    throw new Error('The MySQL test server does not answer, and the CI requires the test databases (REPORTMAN_REQUIRE_DATABASES)');
  return ok;
}

/** The server: MySQL or MariaDB, and its version. */
export async function serverVersion(): Promise<string> {
  const c = await open();
  try {
    const rows = (await query(c, 'SELECT VERSION() AS V')) as { V: string }[];
    return rows[0]!.V;
  } finally {
    await end(c);
  }
}

// The tables of samples.db with MySQL types: prices and rates as DECIMAL, dates as DATE, the fish
// notes and pictures as TEXT and LONGBLOB.
const TABLES: { name: string; ddl: string; columns: string[] }[] = [
  {
    name: 'CATEGORIES',
    ddl: 'CATEGORY_ID INT NOT NULL PRIMARY KEY, NAME VARCHAR(40) NOT NULL, DESCRIPTION VARCHAR(80)',
    columns: ['CATEGORY_ID', 'NAME', 'DESCRIPTION'],
  },
  {
    name: 'PRODUCTS',
    ddl:
      'PRODUCT_ID INT NOT NULL PRIMARY KEY, SKU VARCHAR(12) NOT NULL, EAN13 CHAR(13) NOT NULL, NAME VARCHAR(60) NOT NULL, ' +
      'CATEGORY_ID INT NOT NULL, UNIT VARCHAR(20) NOT NULL, UNIT_PRICE DECIMAL(10,2) NOT NULL, ' +
      'UNITS_IN_STOCK INT NOT NULL, REORDER_LEVEL SMALLINT NOT NULL, FOREIGN KEY (CATEGORY_ID) REFERENCES CATEGORIES (CATEGORY_ID)',
    columns: ['PRODUCT_ID', 'SKU', 'EAN13', 'NAME', 'CATEGORY_ID', 'UNIT', 'UNIT_PRICE', 'UNITS_IN_STOCK', 'REORDER_LEVEL'],
  },
  {
    name: 'EMPLOYEES',
    ddl:
      'EMPLOYEE_ID INT NOT NULL PRIMARY KEY, FIRST_NAME VARCHAR(30) NOT NULL, LAST_NAME VARCHAR(30) NOT NULL, ' +
      'TITLE VARCHAR(40) NOT NULL, HIRE_DATE DATE NOT NULL, REGION VARCHAR(30) NOT NULL',
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
      'ORDER_ID INT NOT NULL PRIMARY KEY, ORDER_NUMBER VARCHAR(12) NOT NULL, CUSTOMER_ID INT NOT NULL, ' +
      'EMPLOYEE_ID INT NOT NULL, ORDER_DATE DATE NOT NULL, SHIP_DATE DATE, STATUS VARCHAR(12) NOT NULL, ' +
      'VAT_RATE DECIMAL(5,2) NOT NULL, FOREIGN KEY (CUSTOMER_ID) REFERENCES CUSTOMERS (CUSTOMER_ID), ' +
      'FOREIGN KEY (EMPLOYEE_ID) REFERENCES EMPLOYEES (EMPLOYEE_ID)',
    columns: ['ORDER_ID', 'ORDER_NUMBER', 'CUSTOMER_ID', 'EMPLOYEE_ID', 'ORDER_DATE', 'SHIP_DATE', 'STATUS', 'VAT_RATE'],
  },
  {
    name: 'ORDER_LINES',
    ddl:
      'ORDER_ID INT NOT NULL, LINE_NO SMALLINT NOT NULL, PRODUCT_ID INT NOT NULL, QUANTITY INT NOT NULL, ' +
      'UNIT_PRICE DECIMAL(10,2) NOT NULL, DISCOUNT DECIMAL(5,2) NOT NULL, PRIMARY KEY (ORDER_ID, LINE_NO), ' +
      'FOREIGN KEY (ORDER_ID) REFERENCES ORDERS (ORDER_ID), FOREIGN KEY (PRODUCT_ID) REFERENCES PRODUCTS (PRODUCT_ID)',
    columns: ['ORDER_ID', 'LINE_NO', 'PRODUCT_ID', 'QUANTITY', 'UNIT_PRICE', 'DISCOUNT'],
  },
  {
    name: 'FISHES',
    ddl:
      'SPECIES_NO INT NOT NULL PRIMARY KEY, CATEGORY VARCHAR(15) NOT NULL, COMMON_NAME VARCHAR(30) NOT NULL, ' +
      'SPECIES_NAME VARCHAR(40) NOT NULL, LENGTH_CM DOUBLE NOT NULL, LENGTH_IN DOUBLE NOT NULL, NOTES TEXT, GRAPHIC LONGBLOB',
    columns: ['SPECIES_NO', 'CATEGORY', 'COMMON_NAME', 'SPECIES_NAME', 'LENGTH_CM', 'LENGTH_IN', 'NOTES', 'GRAPHIC'],
  },
  {
    name: 'GREETINGS',
    ddl:
      'GREETING_ID INT NOT NULL PRIMARY KEY, `LANGUAGE` VARCHAR(20) NOT NULL, NATIVE_NAME VARCHAR(30) NOT NULL, ' +
      'SCRIPT VARCHAR(20) NOT NULL, DIRECTION VARCHAR(3) NOT NULL, GREETING VARCHAR(80) NOT NULL, PARAGRAPH VARCHAR(400) NOT NULL',
    columns: ['GREETING_ID', 'LANGUAGE', 'NATIVE_NAME', 'SCRIPT', 'DIRECTION', 'GREETING', 'PARAGRAPH'],
  },
];

const INDEXES = [
  'CREATE INDEX IX_ORDERS_DATE ON ORDERS (ORDER_DATE)',
];

/** The TYPES table: every type, its usual values, its edge values, and nulls. */
const TYPES_DDL = `CREATE TABLE TYPES (
  ID INT NOT NULL PRIMARY KEY,
  T_TINYINT TINYINT, T_UTINYINT TINYINT UNSIGNED, T_BOOL TINYINT(1), T_UBOOL TINYINT(1) UNSIGNED,
  T_SMALLINT SMALLINT, T_USMALLINT SMALLINT UNSIGNED, T_MEDIUMINT MEDIUMINT, T_UMEDIUMINT MEDIUMINT UNSIGNED,
  T_INT INT, T_UINT INT UNSIGNED, T_BIGINT BIGINT, T_UBIGINT BIGINT UNSIGNED,
  T_BIT1 BIT(1), T_BIT5 BIT(5), T_BIT64 BIT(64),
  T_DEC5_2 DECIMAL(5,2), T_DEC18_4 DECIMAL(18,4), T_DEC29_0 DECIMAL(29,0), T_DEC38_10 DECIMAL(38,10), T_DEC65_30 DECIMAL(65,30),
  T_UDEC DECIMAL(10,2) UNSIGNED, T_FLOAT FLOAT, T_DOUBLE DOUBLE,
  T_CHAR CHAR(10), T_VARCHAR VARCHAR(20), T_UNICODE VARCHAR(30), T_LATIN1 VARCHAR(10) CHARACTER SET latin1,
  T_ASCII CHAR(5) CHARACTER SET ascii, T_UTF8MB3 VARCHAR(10) CHARACTER SET utf8mb3, T_UCS2 VARCHAR(10) CHARACTER SET ucs2,
  T_BINCOLL VARCHAR(10) COLLATE utf8mb4_bin,
  T_TINYTEXT TINYTEXT, T_TEXT TEXT, T_MEDIUMTEXT MEDIUMTEXT, T_LONGTEXT LONGTEXT,
  T_GUID CHAR(36), T_GUID32 CHAR(32),
  T_BINARY BINARY(4), T_BINARY16 BINARY(16), T_VARBINARY VARBINARY(8), T_TINYBLOB TINYBLOB, T_BLOB BLOB,
  T_MEDIUMBLOB MEDIUMBLOB, T_LONGBLOB LONGBLOB,
  T_DATE DATE, T_DATETIME DATETIME, T_DATETIME6 DATETIME(6), T_TIMESTAMP TIMESTAMP NULL, T_TIMESTAMP3 TIMESTAMP(3) NULL,
  T_TIME TIME, T_TIME6 TIME(6), T_YEAR YEAR,
  T_JSON JSON, T_ENUM ENUM('small','medium','large'), T_SET SET('a','b','c'), T_POINT POINT
)`;

const TYPES_ROWS = [
  `1, 12, 200, 1, 1, 1234, 60000, 123456, 16000000, 123456789, 4000000000, 1234567890123, 18000000000000000000,
   b'1', b'10101', b'1000000000000000000000000000000000000000000000000000000000000001',
   123.45, 12345678901234.5678, 12345678901234567890123456789, 1234567890123456789012345678.1234567890,
   0.123456789012345678901234567890, 99.99, 1.1, 3.141592653589793,
   'abc', 'Hello, world', '日本語 Ελληνικά עברית', 'café', 'ascii', 'ñandú', 'Ωμέγα', 'MixedCase',
   'tiny text', 'A text with ünïcödé and a line\\nbreak', 'medium text', 'long text 😀',
   '00112233-4455-6677-8899-AABBCCDDEEFF', '00112233445566778899aabbccddeeff',
   x'01020304', x'00112233445566778899AABBCCDDEEFF', x'DEADBEEF', x'00', x'000102FF', x'C0FFEE', x'FF',
   '2024-02-29', '2024-02-29 13:45:30', '2024-02-29 13:45:30.123456', '2024-02-29 13:45:30', '2024-02-29 13:45:30.123',
   '13:45:30', '13:45:30.123400', 2024,
   '{"a": 1, "b": [true, null, "x"], "c": "ñ"}', 'medium', 'a,c', ST_GeomFromText('POINT(1 2)')`,
  `2, -128, 0, 0, 0, -32768, 0, -8388608, 0, -2147483648, 0, -9223372036854775808, 0,
   b'0', b'0', b'0',
   -999.99, -99999999999999.9999, -79228162514264337593543950335, -0.0000000001,
   0.000000000000000000000000000001, 0.00, -3.40282e38, -1.7976931348623157e308,
   '', '', 'x', '', '', '', '', '',
   '', '', '', '',
   '00000000-0000-0000-0000-000000000000', 'ffffffffffffffffffffffffffffffff',
   x'00000000', x'FFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFF', x'', x'', x'', x'', x'',
   '1000-01-01', '1000-01-01 00:00:00', '1000-01-01 00:00:00.000000', '1970-01-01 00:00:01', '1970-01-01 00:00:01.000',
   '-838:59:59', '-00:00:00.000001', 1901,
   '[]', 'small', '', ST_GeomFromText('POINT(0 0)')`,
  `3, 127, 255, 5, 255, 32767, 65535, 8388607, 16777215, 2147483647, 4294967295, 9223372036854775807, 18446744073709551615,
   b'1', b'11111', b'1111111111111111111111111111111111111111111111111111111111111111',
   999.99, 99999999999999.9999, 79228162514264337593543950335, 9999999999999999999999999999.9999999999,
   12345.123456789012345678901234567890, 99999999.99, 3.40282e38, 1.7976931348623157e308,
   'padded    ', 'trailing  ', 'tab\\tinside', 'ÿÆ', '~', 'ü', 'Ω', 'Z',
   'x', 'quote '' and backslash \\\\', 'y', 'z',
   'ffffffff-ffff-ffff-ffff-ffffffffffff', '0123456789ABCDEF0123456789ABCDEF',
   x'7F7F7F7F', x'0102030405060708090A0B0C0D0E0F10', x'27', x'5C', x'0027005C', x'80', x'00',
   '9999-12-31', '9999-12-31 23:59:59', '9999-12-31 23:59:59.999999', '2038-01-19 03:14:07', '2038-01-19 03:14:07.999',
   '838:59:59', '838:59:59.000000', 2155,
   '"text"', 'large', 'a,b,c', ST_GeomFromText('POINT(-1.5 2.25)')`,
  `4${', NULL'.repeat(56)}`,
];

/** Dates MySQL keeps with sql_mode '' (zero dates and zero parts), refused by MySqlConnector by default. */
const ZERO_DATES_DDL = 'CREATE TABLE ZERODATES (ID INT NOT NULL PRIMARY KEY, D DATE, DT DATETIME, TS TIMESTAMP NULL, Y YEAR)';
const ZERO_DATES_ROWS = [
  "1, '0000-00-00', '0000-00-00 00:00:00', '0000-00-00 00:00:00', 0",
  "2, '2024-00-15', '2024-02-00 10:00:00', NULL, NULL",
  "3, '2024-02-29', '2024-02-29 13:45:30', '2024-02-29 13:45:30', 2024",
];

function literal(value: unknown, column: string): string {
  if (value === null || value === undefined) return 'NULL';
  if (typeof value === 'bigint') return value.toString();
  if (typeof value === 'number') return String(value);
  if (typeof value === 'string') return "'" + value.replace(/\\/g, '\\\\').replace(/'/g, "''") + "'";
  if (value instanceof Uint8Array) return value.length === 0 ? "''" : "X'" + Buffer.from(value).toString('hex') + "'";
  throw new Error('Unexpected value of ' + column);
}

/** Copies samples.db into the test database and creates TYPES (again when LOAD_VERSION changed). */
export async function loadDatabase(force = false): Promise<void> {
  const c = await open();
  try {
    await query(c, 'CREATE TABLE IF NOT EXISTS RM_LOAD (VERSION INT NOT NULL)');
    const version = (await query(c, 'SELECT VERSION FROM RM_LOAD')) as { VERSION: number }[];
    if (!force && version[0]?.VERSION === LOAD_VERSION) return;
    await query(c, "SET SESSION sql_mode = ''");
    await query(c, 'SET FOREIGN_KEY_CHECKS = 0');
    for (const name of ['TYPES', 'ZERODATES', 'BADGUIDS', 'RM_TX', ...TABLES.map((t) => t.name)]) await query(c, 'DROP TABLE IF EXISTS `' + name + '`');
    await query(c, 'SET FOREIGN_KEY_CHECKS = 1');
    for (const t of TABLES) await query(c, `CREATE TABLE ${t.name} (${t.ddl}) DEFAULT CHARSET=utf8mb4`);
    for (const ix of INDEXES) await query(c, ix);
    const sqlite = new DatabaseSync(path.join(samplesDir, 'samples.db'), { readOnly: true });
    try {
      for (const t of TABLES) {
        const rows = sqlite.prepare(`SELECT ${t.columns.map((col) => '"' + col + '"').join(', ')} FROM "${t.name}" ORDER BY 1, 2`).all() as Record<string, unknown>[];
        const columns = t.columns.map((col) => '`' + col + '`').join(', ');
        for (let i = 0; i < rows.length; i += 200) {
          const values = rows.slice(i, i + 200).map((r) => '(' + t.columns.map((col) => literal(r[col], col)).join(', ') + ')');
          await query(c, `INSERT INTO ${t.name} (${columns}) VALUES ${values.join(', ')}`);
        }
      }
    } finally {
      sqlite.close();
    }
    await query(c, TYPES_DDL + ' DEFAULT CHARSET=utf8mb4');
    for (const row of TYPES_ROWS) await query(c, 'INSERT INTO TYPES VALUES (' + row + ')');
    await query(c, ZERO_DATES_DDL);
    for (const row of ZERO_DATES_ROWS) await query(c, 'INSERT INTO ZERODATES VALUES (' + row + ')');
    await query(c, 'CREATE TABLE BADGUIDS (ID INT NOT NULL PRIMARY KEY, G CHAR(36))');
    await query(c, "INSERT INTO BADGUIDS VALUES (1, 'not a guid')");
    await query(c, 'CREATE TABLE RM_TX (V INT)');
    await query(c, 'DELETE FROM RM_LOAD');
    await query(c, 'INSERT INTO RM_LOAD (VERSION) VALUES (' + String(LOAD_VERSION) + ')');
  } finally {
    await end(c);
  }
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  loadDatabase(process.argv.includes('--force')).then(
    () => console.log('loaded ' + mysqlTest.host + ':' + String(mysqlTest.port) + '/' + mysqlTest.database),
    (e: unknown) => {
      console.error(e);
      process.exit(1);
    },
  );
}
