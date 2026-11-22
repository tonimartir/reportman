// The test database: a Firebird server (the official firebirdsql/firebird image) with samples.db
// copied into it, plus a TYPES table with every Firebird type a report can read and edge values.
//
// The server of the tests is the container reportman-fb-test (see README.md of this package):
//
//   docker run -d --name reportman-fb-test -p 53050:3050 -e FIREBIRD_ROOT_PASSWORD=rmtest_root \
//     -e FIREBIRD_USER=RMTEST -e FIREBIRD_PASSWORD=rmtest_pw -e FIREBIRD_DATABASE=samples.fdb \
//     -e FIREBIRD_DATABASE_DEFAULT_CHARSET=UTF8 firebirdsql/firebird:5
//
// RM_FB_HOST, RM_FB_PORT, RM_FB_DATABASE, RM_FB_USER and RM_FB_PASSWORD point the tests at another
// server. When the server cannot be reached the database tests are skipped.
//
//   node test/database.ts            loads the database (from packages/reportman-driver-firebird)

import { DatabaseSync } from 'node:sqlite';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import Firebird from 'node-firebird';

const here = path.dirname(fileURLToPath(import.meta.url));
export const samplesDir = path.resolve(here, '../../../../samples');

export const fbTest = {
  host: process.env.RM_FB_HOST ?? 'localhost',
  port: Number(process.env.RM_FB_PORT ?? 53050),
  database: process.env.RM_FB_DATABASE ?? '/var/lib/firebird/data/samples.fdb',
  user: process.env.RM_FB_USER ?? 'RMTEST',
  password: process.env.RM_FB_PASSWORD ?? 'rmtest_pw',
};

/** The FirebirdClient connection string of the test database (for golden-cs and the driver). */
export function connectionString(): string {
  return `DataSource=${fbTest.host};Port=${fbTest.port};Database=${fbTest.database};User=${fbTest.user};Password=${fbTest.password};Charset=UTF8`;
}

/** Bump it when the tables or their rows change: the database is loaded again. */
const LOAD_VERSION = 4;

function attach(): Promise<Firebird.Database> {
  return new Promise((resolve, reject) => {
    Firebird.attach(
      { host: fbTest.host, port: fbTest.port, database: fbTest.database, user: fbTest.user, password: fbTest.password, encoding: 'UTF8' },
      (err: unknown, db: Firebird.Database) => (err ? reject(err) : resolve(db)),
    );
  });
}

function query(db: Firebird.Database, sql: string, params: unknown[] = []): Promise<Record<string, unknown>[]> {
  return new Promise((resolve, reject) => {
    db.query(sql, params, (err: unknown, rows: Record<string, unknown>[]) => (err ? reject(err) : resolve(rows ?? [])));
  });
}

/** True when the test server answers (within a few seconds). */
export async function isReachable(): Promise<boolean> {
  const attempt = attach().then(
    (db) => {
      db.detach();
      return true;
    },
    () => false,
  );
  const timeout = new Promise<boolean>((resolve) => setTimeout(() => resolve(false), 5000).unref());
  const ok = await Promise.race([attempt, timeout]);
  if (!ok && process.env.REPORTMAN_REQUIRE_DATABASES === '1')
    throw new Error('The Firebird test server does not answer, and the CI requires the test databases (REPORTMAN_REQUIRE_DATABASES)');
  return ok;
}

// The tables of samples.db with Firebird types: prices and rates as NUMERIC, dates as DATE, the
// fish notes and pictures as text and binary blobs.
const TABLES: { name: string; ddl: string; columns: string[] }[] = [
  {
    name: 'CATEGORIES',
    ddl: 'CATEGORY_ID INTEGER NOT NULL PRIMARY KEY, NAME VARCHAR(40) NOT NULL, DESCRIPTION VARCHAR(80)',
    columns: ['CATEGORY_ID', 'NAME', 'DESCRIPTION'],
  },
  {
    name: 'PRODUCTS',
    ddl:
      'PRODUCT_ID INTEGER NOT NULL PRIMARY KEY, SKU VARCHAR(12) NOT NULL, EAN13 CHAR(13) NOT NULL, NAME VARCHAR(60) NOT NULL, ' +
      'CATEGORY_ID INTEGER NOT NULL REFERENCES CATEGORIES, UNIT VARCHAR(20) NOT NULL, UNIT_PRICE NUMERIC(10,2) NOT NULL, ' +
      'UNITS_IN_STOCK INTEGER NOT NULL, REORDER_LEVEL SMALLINT NOT NULL',
    columns: ['PRODUCT_ID', 'SKU', 'EAN13', 'NAME', 'CATEGORY_ID', 'UNIT', 'UNIT_PRICE', 'UNITS_IN_STOCK', 'REORDER_LEVEL'],
  },
  {
    name: 'EMPLOYEES',
    ddl:
      'EMPLOYEE_ID INTEGER NOT NULL PRIMARY KEY, FIRST_NAME VARCHAR(30) NOT NULL, LAST_NAME VARCHAR(30) NOT NULL, ' +
      'TITLE VARCHAR(40) NOT NULL, HIRE_DATE DATE NOT NULL, REGION VARCHAR(30) NOT NULL',
    columns: ['EMPLOYEE_ID', 'FIRST_NAME', 'LAST_NAME', 'TITLE', 'HIRE_DATE', 'REGION'],
  },
  {
    name: 'CUSTOMERS',
    ddl:
      'CUSTOMER_ID INTEGER NOT NULL PRIMARY KEY, CODE VARCHAR(8) NOT NULL, COMPANY_NAME VARCHAR(60) NOT NULL, ' +
      'CONTACT_NAME VARCHAR(60) NOT NULL, ADDRESS VARCHAR(60) NOT NULL, POSTAL_CODE VARCHAR(10) NOT NULL, ' +
      'CITY VARCHAR(40) NOT NULL, COUNTRY VARCHAR(40) NOT NULL, PHONE VARCHAR(20) NOT NULL, EMAIL VARCHAR(60) NOT NULL, ' +
      'VAT_RATE NUMERIC(5,2) NOT NULL, CUSTOMER_SINCE DATE NOT NULL',
    columns: ['CUSTOMER_ID', 'CODE', 'COMPANY_NAME', 'CONTACT_NAME', 'ADDRESS', 'POSTAL_CODE', 'CITY', 'COUNTRY', 'PHONE', 'EMAIL', 'VAT_RATE', 'CUSTOMER_SINCE'],
  },
  {
    name: 'ORDERS',
    ddl:
      'ORDER_ID INTEGER NOT NULL PRIMARY KEY, ORDER_NUMBER VARCHAR(12) NOT NULL, CUSTOMER_ID INTEGER NOT NULL REFERENCES CUSTOMERS, ' +
      'EMPLOYEE_ID INTEGER NOT NULL REFERENCES EMPLOYEES, ORDER_DATE DATE NOT NULL, SHIP_DATE DATE, STATUS VARCHAR(12) NOT NULL, ' +
      'VAT_RATE NUMERIC(5,2) NOT NULL',
    columns: ['ORDER_ID', 'ORDER_NUMBER', 'CUSTOMER_ID', 'EMPLOYEE_ID', 'ORDER_DATE', 'SHIP_DATE', 'STATUS', 'VAT_RATE'],
  },
  {
    name: 'ORDER_LINES',
    ddl:
      'ORDER_ID INTEGER NOT NULL REFERENCES ORDERS, LINE_NO SMALLINT NOT NULL, PRODUCT_ID INTEGER NOT NULL REFERENCES PRODUCTS, ' +
      'QUANTITY INTEGER NOT NULL, UNIT_PRICE NUMERIC(10,2) NOT NULL, DISCOUNT NUMERIC(5,2) NOT NULL, PRIMARY KEY (ORDER_ID, LINE_NO)',
    columns: ['ORDER_ID', 'LINE_NO', 'PRODUCT_ID', 'QUANTITY', 'UNIT_PRICE', 'DISCOUNT'],
  },
  {
    name: 'FISHES',
    ddl:
      'SPECIES_NO INTEGER NOT NULL PRIMARY KEY, CATEGORY VARCHAR(15) NOT NULL, COMMON_NAME VARCHAR(30) NOT NULL, ' +
      'SPECIES_NAME VARCHAR(40) NOT NULL, LENGTH_CM DOUBLE PRECISION NOT NULL, LENGTH_IN DOUBLE PRECISION NOT NULL, ' +
      'NOTES BLOB SUB_TYPE TEXT, GRAPHIC BLOB SUB_TYPE BINARY',
    columns: ['SPECIES_NO', 'CATEGORY', 'COMMON_NAME', 'SPECIES_NAME', 'LENGTH_CM', 'LENGTH_IN', 'NOTES', 'GRAPHIC'],
  },
  {
    name: 'GREETINGS',
    ddl:
      'GREETING_ID INTEGER NOT NULL PRIMARY KEY, "LANGUAGE" VARCHAR(20) NOT NULL, NATIVE_NAME VARCHAR(30) NOT NULL, ' +
      'SCRIPT VARCHAR(20) NOT NULL, DIRECTION VARCHAR(3) NOT NULL, GREETING VARCHAR(80) NOT NULL, PARAGRAPH VARCHAR(400) NOT NULL',
    columns: ['GREETING_ID', '"LANGUAGE"', 'NATIVE_NAME', 'SCRIPT', 'DIRECTION', 'GREETING', 'PARAGRAPH'],
  },
];

const INDEXES = [
  'CREATE INDEX IX_ORDERS_CUSTOMER ON ORDERS(CUSTOMER_ID)',
  'CREATE INDEX IX_ORDERS_DATE ON ORDERS(ORDER_DATE)',
  'CREATE INDEX IX_PRODUCTS_CATEGORY ON PRODUCTS(CATEGORY_ID)',
];

/** The TYPES table: every type, its usual values, its edge values, and nulls. */
const TYPES_DDL = `CREATE TABLE TYPES (
  ID INTEGER NOT NULL PRIMARY KEY,
  T_SMALLINT SMALLINT, T_INTEGER INTEGER, T_BIGINT BIGINT, T_INT128 INT128,
  T_NUM4_2 NUMERIC(4,2), T_NUM9_3 NUMERIC(9,3), T_NUM18_4 NUMERIC(18,4), T_DEC38_6 DECIMAL(38,6), T_NUM10_0 NUMERIC(10,0),
  T_FLOAT FLOAT, T_DOUBLE DOUBLE PRECISION, T_DECF16 DECFLOAT(16), T_DECF34 DECFLOAT(34),
  T_CHAR CHAR(10), T_VARCHAR VARCHAR(20), T_UNICODE VARCHAR(30), T_CHAR3 CHAR(3),
  T_WIN1252 CHAR(5) CHARACTER SET WIN1252, T_LATIN1 VARCHAR(10) CHARACTER SET ISO8859_1, T_NONE VARCHAR(10) CHARACTER SET NONE,
  T_OCTETS CHAR(4) CHARACTER SET OCTETS, T_GUID CHAR(16) CHARACTER SET OCTETS, T_VARBINARY VARCHAR(8) CHARACTER SET OCTETS,
  T_BLOB_TEXT BLOB SUB_TYPE TEXT, T_BLOB_BIN BLOB SUB_TYPE BINARY,
  T_DATE DATE, T_TIME TIME, T_TIMESTAMP TIMESTAMP, T_TIME_TZ TIME WITH TIME ZONE, T_TIMESTAMP_TZ TIMESTAMP WITH TIME ZONE,
  T_BOOLEAN BOOLEAN
)`;

const TYPES_ROWS = [
  `1, 123, 123456, 1234567890123, 123456789012345678,
   12.34, -123456.789, 12345678901234.5678, 1234567890123456789012.123456, 1234567890,
   1.1, 3.141592653589793, CAST('123.45' AS DECFLOAT(16)), CAST('-1.20' AS DECFLOAT(34)),
   'abc', 'Hello, world', '日本語 Ελληνικά עברית', '😀😀😀',
   'café', 'Ñandú', 'plain',
   x'01020304', x'00112233445566778899AABBCCDDEEFF', x'DEADBEEF',
   'A text blob with ünïcödé and a line
break', x'000102FF',
   DATE '2024-02-29', TIME '13:45:30.1234', TIMESTAMP '2024-02-29 13:45:30.1234',
   CAST('13:45:30.1234 Europe/Madrid' AS TIME WITH TIME ZONE), CAST('2024-07-01 10:00:00.5 America/New_York' AS TIMESTAMP WITH TIME ZONE),
   TRUE`,
  `2, -32768, 2147483647, -9223372036854775808, 9223372036854775807,
   -99.99, 0.001, -99999999999999.9999, -0.000001, -9999999999,
   3.4028234e38, 1.7976931348623157e308, CAST('9.999999999999999E+384' AS DECFLOAT(16)), CAST('-0' AS DECFLOAT(34)),
   '', '', 'x', 'ab',
   '', '', '',
   x'00000000', x'FFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFF', x'',
   '', x'',
   DATE '0001-01-01', TIME '00:00:00', TIMESTAMP '9999-12-31 23:59:59.9999',
   CAST('23:59:59.9999 UTC' AS TIME WITH TIME ZONE), CAST('2000-01-01 00:00:00 UTC' AS TIMESTAMP WITH TIME ZONE),
   FALSE`,
  `3, 32767, -2147483648, 9223372036854775807, -9223372036854775808,
   99.99, -999999.999, 0, 0.000001, 0,
   -1.1754944e-38, -4.9e-324, CAST('NaN' AS DECFLOAT(16)), CAST('-Infinity' AS DECFLOAT(34)),
   'padded    ', 'trailing  ', 'tab	inside', 'a',
   'Œuvre', 'ÿ', 'ascii',
   x'7F7F7F7F', x'0102030405060708090A0B0C0D0E0F10', x'00',
   'x', x'00',
   DATE '9999-12-31', TIME '23:59:59.9999', TIMESTAMP '1900-01-01 00:00:00.0001',
   CAST('00:00:00 Etc/GMT-14' AS TIME WITH TIME ZONE), CAST('2024-03-31 01:30:00 Europe/Madrid' AS TIMESTAMP WITH TIME ZONE),
   TRUE`,
  `4, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL,
   NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL`,
];

function literal(value: unknown, column: string): string {
  if (value === null || value === undefined) return 'NULL';
  if (typeof value === 'bigint') return value.toString();
  if (typeof value === 'number') return String(value);
  if (typeof value === 'string') {
    if (/_DATE$|^CUSTOMER_SINCE$/.test(column)) return `DATE '${value}'`;
    return "'" + value.replace(/'/g, "''") + "'";
  }
  throw new Error('Unexpected value of ' + column);
}

/** Copies samples.db into the test database and creates TYPES (again when LOAD_VERSION changed). */
export async function loadDatabase(force = false): Promise<void> {
  const db = await attach();
  try {
    const loaded = await query(db, "SELECT 1 AS X FROM RDB$RELATIONS WHERE RDB$RELATION_NAME = 'RM_LOAD'");
    if (loaded.length > 0 && !force) {
      const version = await query(db, 'SELECT VERSION FROM RM_LOAD');
      if (version[0]?.VERSION === LOAD_VERSION) return;
    }
    // Drop what a previous load left, children first
    const existing = new Set(
      (await query(db, 'SELECT TRIM(RDB$RELATION_NAME) AS N FROM RDB$RELATIONS WHERE RDB$SYSTEM_FLAG = 0')).map((r) => String(r.N)),
    );
    for (const name of ['RM_LOAD', 'ARRAYS', 'TYPES', 'GREETINGS', 'FISHES', 'ORDER_LINES', 'ORDERS', 'CUSTOMERS', 'EMPLOYEES', 'PRODUCTS', 'CATEGORIES']) {
      if (existing.has(name)) await query(db, 'DROP TABLE ' + name);
    }
    for (const t of TABLES) await query(db, `CREATE TABLE ${t.name} (${t.ddl})`);
    for (const ix of INDEXES) await query(db, ix);
    await query(db, TYPES_DDL);
    // A Firebird ARRAY column: the driver does not read arrays (a clear error)
    await query(db, 'CREATE TABLE ARRAYS (ID INTEGER NOT NULL PRIMARY KEY, A INTEGER[3])');
    await query(db, 'CREATE TABLE RM_LOAD (VERSION INTEGER NOT NULL)');

    const sqlite = new DatabaseSync(path.join(samplesDir, 'samples.db'), { readOnly: true });
    try {
      for (const t of TABLES) {
        const plain = t.columns.map((c) => c.replace(/"/g, ''));
        const rows = sqlite.prepare(`SELECT ${plain.map((c) => '"' + c + '"').join(', ')} FROM "${t.name}" ORDER BY 1, 2`).all() as Record<string, unknown>[];
        if (t.name === 'FISHES') {
          // The blobs go as parameters (node-firebird uploads them)
          const sql = `INSERT INTO FISHES (${t.columns.join(', ')}) VALUES (${t.columns.map(() => '?').join(', ')})`;
          for (const r of rows) {
            const graphic = r.GRAPHIC as Uint8Array | null;
            await query(db, sql, [
              r.SPECIES_NO, r.CATEGORY, r.COMMON_NAME, r.SPECIES_NAME, r.LENGTH_CM, r.LENGTH_IN, r.NOTES,
              graphic === null ? null : Buffer.from(graphic),
            ]);
          }
          continue;
        }
        for (let i = 0; i < rows.length; i += 100) {
          const inserts = rows
            .slice(i, i + 100)
            .map((r) => `INSERT INTO ${t.name} (${t.columns.join(', ')}) VALUES (${plain.map((c) => literal(r[c], c)).join(', ')});`);
          await query(db, 'EXECUTE BLOCK AS BEGIN\n' + inserts.join('\n') + '\nEND');
        }
      }
    } finally {
      sqlite.close();
    }
    for (const row of TYPES_ROWS) await query(db, 'INSERT INTO TYPES VALUES (' + row + ')');
    await query(db, 'INSERT INTO ARRAYS (ID) VALUES (1)');
    await query(db, 'INSERT INTO RM_LOAD (VERSION) VALUES (' + String(LOAD_VERSION) + ')');
  } finally {
    db.detach();
  }
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  loadDatabase(process.argv.includes('--force')).then(
    () => console.log('loaded ' + fbTest.host + ':' + String(fbTest.port) + ':' + fbTest.database),
    (e: unknown) => {
      console.error(e);
      process.exit(1);
    },
  );
}
