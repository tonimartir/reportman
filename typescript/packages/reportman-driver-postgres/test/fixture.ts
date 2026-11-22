// The PostgreSQL database of the tests: the sample data of samples.db (read with node:sqlite)
// copied into PostgreSQL with PostgreSQL types, and a table with every type a report can read.
//
// The server is the Docker container reportman-pg-test (postgres:17) on localhost:55432, or the
// one REPORTMAN_PG_TEST names (a libpq URL: postgres://user:password@host:port/database). When no
// server answers, the tests that need it are skipped.
//
//   wsl docker run -d --name reportman-pg-test -e POSTGRES_USER=reportman \
//     -e POSTGRES_PASSWORD=rmtest_only -e POSTGRES_DB=reportman_test -p 55432:5432 postgres:17-alpine

import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';
import pg from 'pg';

const here = path.dirname(fileURLToPath(import.meta.url));
export const repoRoot = path.resolve(here, '../../../..');
export const samplesDir = path.join(repoRoot, 'samples');
export const goldenCs = path.join(repoRoot, 'typescript/tools/golden-cs/bin/Release/net10.0/golden-cs.exe');

/** The test server, as a pg configuration. */
export function testConfig(): pg.ClientConfig {
  const url = process.env.REPORTMAN_PG_TEST;
  if (url !== undefined && url.length > 0) {
    const u = new URL(url);
    return {
      host: u.hostname,
      port: u.port.length > 0 ? Number(u.port) : 5432,
      user: decodeURIComponent(u.username),
      password: decodeURIComponent(u.password),
      database: u.pathname.replace(/^\//, ''),
    };
  }
  return { host: 'localhost', port: 55432, user: 'reportman', password: 'rmtest_only', database: 'reportman_test' };
}

/** The same server as an Npgsql connection string (golden-cs). */
export function npgsqlConnectionString(): string {
  const c = testConfig();
  return `Host=${c.host};Port=${c.port};Database=${c.database};Username=${c.user};Password=${String(c.password)}`;
}

/** Whether the test server answers. */
export async function serverAvailable(): Promise<boolean> {
  const client = new pg.Client({ ...testConfig(), connectionTimeoutMillis: 3000 });
  let ok = false;
  try {
    await client.connect();
    await client.query('SELECT 1');
    ok = true;
  } catch {
    ok = false;
  } finally {
    await client.end().catch(() => undefined);
  }
  if (!ok && process.env.REPORTMAN_REQUIRE_DATABASES === '1')
    throw new Error('The PostgreSQL test server does not answer, and the CI requires the test databases (REPORTMAN_REQUIRE_DATABASES)');
  return ok;
}

// Bump when the tables below change: the loader reloads a database with another version.
const FIXTURE_VERSION = 'reportman-fixture-3';

/** The sample tables, as PostgreSQL would declare them. */
const SAMPLE_TABLES = `
CREATE TABLE categories (
  category_id integer PRIMARY KEY,
  name varchar(40) NOT NULL,
  description varchar(80)
);
CREATE TABLE products (
  product_id integer PRIMARY KEY,
  sku varchar(12) NOT NULL,
  ean13 varchar(13) NOT NULL,
  name varchar(60) NOT NULL,
  category_id integer NOT NULL REFERENCES categories(category_id),
  unit varchar(20) NOT NULL,
  unit_price numeric(10,2) NOT NULL,
  units_in_stock integer NOT NULL,
  reorder_level integer NOT NULL
);
CREATE TABLE employees (
  employee_id integer PRIMARY KEY,
  first_name varchar(30) NOT NULL,
  last_name varchar(30) NOT NULL,
  title varchar(40) NOT NULL,
  hire_date date NOT NULL,
  region varchar(30) NOT NULL
);
CREATE TABLE customers (
  customer_id integer PRIMARY KEY,
  code varchar(8) NOT NULL,
  company_name varchar(60) NOT NULL,
  contact_name varchar(60) NOT NULL,
  address varchar(60) NOT NULL,
  postal_code varchar(10) NOT NULL,
  city varchar(40) NOT NULL,
  country varchar(40) NOT NULL,
  phone varchar(20) NOT NULL,
  email varchar(60) NOT NULL,
  vat_rate numeric(5,2) NOT NULL,
  customer_since date NOT NULL
);
CREATE TABLE orders (
  order_id integer PRIMARY KEY,
  order_number varchar(12) NOT NULL,
  customer_id integer NOT NULL REFERENCES customers(customer_id),
  employee_id integer NOT NULL REFERENCES employees(employee_id),
  order_date date NOT NULL,
  ship_date date,
  status varchar(12) NOT NULL,
  vat_rate numeric(5,2) NOT NULL
);
CREATE TABLE order_lines (
  order_id integer NOT NULL REFERENCES orders(order_id),
  line_no integer NOT NULL,
  product_id integer NOT NULL REFERENCES products(product_id),
  quantity integer NOT NULL,
  unit_price numeric(10,2) NOT NULL,
  discount numeric(5,2) NOT NULL,
  PRIMARY KEY (order_id, line_no)
);
CREATE TABLE fishes (
  species_no integer PRIMARY KEY,
  category varchar(15) NOT NULL,
  common_name varchar(30) NOT NULL,
  species_name varchar(40) NOT NULL,
  length_cm double precision NOT NULL,
  length_in real NOT NULL,
  notes text,
  graphic bytea
);
CREATE TABLE greetings (
  greeting_id integer PRIMARY KEY,
  language varchar(20) NOT NULL,
  native_name varchar(30) NOT NULL,
  script varchar(20) NOT NULL,
  direction varchar(3) NOT NULL,
  greeting varchar(80) NOT NULL,
  paragraph varchar(400) NOT NULL
);
-- The SQLite date functions the sample reports use (strftime of a date)
CREATE FUNCTION strftime(fmt text, d date) RETURNS text LANGUAGE sql IMMUTABLE AS $$
  SELECT replace(replace(replace(fmt, '%Y', to_char(d, 'YYYY')), '%m', to_char(d, 'MM')), '%d', to_char(d, 'DD'))
$$;
`;

/** The order the sample tables are filled in (foreign keys). */
const SAMPLE_ORDER = ['categories', 'products', 'employees', 'customers', 'orders', 'order_lines', 'fishes', 'greetings'];

/**
 * A table with a column of every type a report can read through Npgsql, and rows with typical
 * values, the limits of each type and NULL. Values Npgsql cannot read (numeric NaN, intervals with
 * months, dates out of the DateTime range...) are tested one by one instead.
 */
export const ALL_TYPES_COLUMNS: [name: string, type: string, values: [string, string, string]][] = [
  ['c_int2', 'smallint', ['12', '-32768', '32767']],
  ['c_int4', 'integer', ['123456', '2147483647', '-2147483648']],
  ['c_int8', 'bigint', ['1234567890123', '-9223372036854775808', '9223372036854775807']],
  ['c_numeric', 'numeric', ['1234.5678', '79228162514264337593543950335', '-0.0000000000000000000000000001']],
  ['c_numeric_10_2', 'numeric(10,2)', ['99.95', '-0.01', '12345678.90']],
  ['c_float4', 'real', ['1.1', '3.4028235e38', "'-Infinity'"]],
  ['c_float8', 'double precision', ['3.141592653589793', "'NaN'", '-1e-300']],
  ['c_money', 'money', ['1234.56', "'-92233720368547758.08'", '92233720368547758.07']],
  ['c_text', 'text', ["'Hello, world'", "''", "E'tab\\there \\u00f1and\\u00fa \\u20ac'"]],
  ['c_varchar', 'varchar(20)', ["'varchar'", "'12345678901234567890'", "''"]],
  ['c_char', 'char(5)', ["'ab'", "''", "'abcde'"]],
  ['c_name', 'name', ["'pgname'", "''", "'x'"]],
  ['c_citext', 'citext', ["'CiText'", "''", "'X'"]],
  ['c_bool', 'boolean', ['true', 'false', 'true']],
  ['c_bit1', 'bit(1)', ["B'1'", "B'0'", "B'1'"]],
  ['c_bit3', 'bit(3)', ["B'101'", "B'000'", "B'111'"]],
  ['c_varbit', 'bit varying', ["B'1100'", "B''", "B'1'"]],
  ['c_date', 'date', ["'2024-03-15'", "'infinity'", "'-infinity'"]],
  ['c_date2', 'date', ["'0001-01-01'", "'9999-12-31'", "'2000-02-29'"]],
  ['c_time', 'time', ["'13:45:30.123456'", "'00:00:00'", "'23:59:59.999999'"]],
  ['c_time3', 'time(3)', ["'13:45:30.1234'", "'00:00:00'", "'23:59:59.999'"]],
  ['c_timetz', 'timetz', ["'13:45:30+02'", "'23:59:59.999999-12'", "'00:00:00+14'"]],
  ['c_timestamp', 'timestamp', ["'2024-03-15 13:45:30.123456'", "'infinity'", "'-infinity'"]],
  ['c_timestamp2', 'timestamp', ["'0001-01-01 00:00:00'", "'9999-12-31 23:59:59.999999'", "'2024-02-29 00:00:00.000001'"]],
  ['c_timestamptz', 'timestamptz', ["'2024-03-15 13:45:30.5+02'", "'infinity'", "'-infinity'"]],
  ['c_timestamptz2', 'timestamptz', ["'0001-01-01 00:00:00+00'", "'9999-12-31 23:59:59.999999+00'", "'2024-06-30 23:30:00-05:30'"]],
  ['c_interval', 'interval', ["'3 days 04:05:06.789'", "'-1 days +02:03:04'", "'-00:00:00.000001'"]],
  ['c_interval2', 'interval', ["'1000000 days'", "'25 hours'", "'0'"]],
  ['c_bytea', 'bytea', ["'\\x00010203ff'", "'\\x'", "'\\x41'"]],
  ['c_uuid', 'uuid', ["'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11'", "'00000000-0000-0000-0000-000000000000'", "'FFFFFFFF-FFFF-FFFF-FFFF-FFFFFFFFFFFF'"]],
  ['c_json', 'json', ['\'{"a": [1, 2]}\'', "'null'", "'\"text\"'"]],
  ['c_jsonb', 'jsonb', ['\'{"b": 1, "a": "x"}\'', "'[]'", "'3.50'"]],
  ['c_xml', 'xml', ["'<a>1</a>'", "''", "'<b x=\"1\"/>'"]],
  ['c_inet', 'inet', ["'192.168.1.10/24'", "'::1'", "'2001:db8::1/64'"]],
  ['c_cidr', 'cidr', ["'10.1.0.0/16'", "'2001:db8::/32'", "'192.168.0.1/32'"]],
  ['c_macaddr', 'macaddr', ["'08:00:2b:01:02:03'", "'00:00:00:00:00:00'", "'ff:ff:ff:ff:ff:ff'"]],
  ['c_macaddr8', 'macaddr8', ["'08:00:2b:01:02:03:04:05'", "'00:00:00:00:00:00:00:00'", "'ff:ff:ff:ff:ff:ff:ff:ff'"]],
  ['c_point', 'point', ["'(1.5,-2)'", "'(1e20,1e-7)'", "'(0,0)'"]],
  ['c_line', 'line', ["'{1,-1,0}'", "'{0.5,2,-3.25}'", "'{1,0,5}'"]],
  ['c_lseg', 'lseg', ["'[(0,0),(1,1.5)]'", "'[(1e15,2),(3,4)]'", "'[(-1,-1),(1,1)]'"]],
  ['c_box', 'box', ["'(1,1),(0,0)'", "'(0,0),(2.5,3)'", "'(-1,-1),(-2,-2)'"]],
  ['c_path', 'path', ["'[(0,0),(1,1),(2,0)]'", "'((0,0),(1,1),(2,0))'", "'[(1.25,2)]'"]],
  ['c_polygon', 'polygon', ["'((0,0),(1,1),(1,0))'", "'((0.5,0.5))'", "'((1,2),(3,4),(5,6),(7,8))'"]],
  ['c_circle', 'circle', ["'<(0,0),2.5>'", "'<(1e-5,2),0>'", "'<(-1,1),100>'"]],
  ['c_int4range', 'int4range', ["'[1,10)'", "'empty'", "'(,5]'"]],
  ['c_int8range', 'int8range', ["'(1,100]'", "'[5,)'", "'(,)'"]],
  ['c_numrange', 'numrange', ["'[1.5,2.25)'", "'(,5.5]'", "'empty'"]],
  ['c_daterange', 'daterange', ["'[2024-01-01,2024-02-01)'", "'[2024-01-01,)'", "'(,2024-03-01]'"]],
  ['c_tsrange', 'tsrange', ["'[2024-01-01 10:00,2024-01-01 12:30:15.5)'", "'(,2024-01-01 00:00]'", "'empty'"]],
  ['c_tstzrange', 'tstzrange', ["'[2024-01-01 10:00+00,2024-01-02 00:00+00)'", "'[2024-06-01 00:00+02,)'", "'empty'"]],
  ['c_int4multirange', 'int4multirange', ["'{[1,3),[5,8)}'", "'{}'", "'{[1,2)}'"]],
  ['c_tsvector', 'tsvector', ["'quick:1 brown:2A fox'", "''", "'a b c'"]],
  ['c_tsquery', 'tsquery', ["'quick & !fox'", "'a | b <-> c'", "'x:*'"]],
  ['c_oid', 'oid', ['12345', '0', '4294967295']],
  ['c_xid', 'xid', ["'777'", "'0'", "'4294967295'"]],
  ['c_cid', 'cid', ["'5'", "'0'", "'4294967295'"]],
  ['c_xid8', 'xid8', ["'18446744073709551615'", "'0'", "'12345'"]],
  ['c_regtype', 'regtype', ["'varchar'", "'int4'", "'mood'"]],
  ['c_pg_lsn', 'pg_lsn', ["'16/B374D848'", "'0/0'", "'FFFFFFFF/FFFFFFFF'"]],
  ['c_tid', 'tid', ["'(3,7)'", "'(0,0)'", "'(4294967295,65535)'"]],
  ['c_char1', '"char"', ["'x'", "''", "'Z'"]],
  ['c_enum', 'mood', ["'happy'", "'sad'", "'happy'"]],
  ['c_domain', 'posint', ['42', '1', '2147483647']],
  ['c_vdomain', 'shorttext', ["'dom'", "''", "'1234567890'"]],
  ['c_hstore', 'hstore', ['\'"a"=>"1", "b"=>NULL\'', "''", '\'"x"=>"y"\'']],
  ['c_ltree', 'ltree', ["'top.science.astronomy'", "''", "'a'"]],
  ['c_cube', 'cube', ["'(1,2,3)'", "'(1.5e20),(2)'", "'(0)'"]],
  ['c_jsonpath', 'jsonpath', ["'$.a[*] ? (@ > 1)'", "'$'", "'strict $.x'"]],
  ['c_refcursor', 'refcursor', ["'cur1'", "''", "'c'"]],
  ['c_int4_arr', 'integer[]', ["'{1,2,3}'", "'{}'", "'[2:3]={7,8}'"]],
  ['c_int4_arr2', 'integer[][]', ["'{{1,2},{3,4}}'", "'{}'", "'{{{1}}}'"]],
  ['c_text_arr', 'text[]', ['\'{"a b",NULL,c}\'', "'{}'", "'{NULL}'"]],
  ['c_varchar_arr', 'varchar(4)[]', ["'{ab,cd}'", "'{}'", "'{x}'"]],
  ['c_numeric_arr', 'numeric[]', ["'{1.5,2}'", "'{}'", "'{-0.001}'"]],
  ['c_float8_arr', 'double precision[]', ["'{1.5,NaN}'", "'{}'", "'{-Infinity}'"]],
  ['c_bool_arr', 'boolean[]', ["'{t,f}'", "'{}'", "'{t}'"]],
  ['c_date_arr', 'date[]', ["'{2024-01-01,infinity}'", "'{}'", "'{2000-01-01}'"]],
  ['c_timestamp_arr', 'timestamp[]', ["'{\"2024-01-01 10:00:00\"}'", "'{}'", "'{infinity}'"]],
  ['c_interval_arr', 'interval[]', ["'{\"1 day\"}'", "'{}'", "'{00:00:01}'"]],
  ['c_uuid_arr', 'uuid[]', ["'{a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11}'", "'{}'", "'{00000000-0000-0000-0000-000000000000}'"]],
  ['c_bytea_arr', 'bytea[]', ["'{\"\\\\x01\",NULL}'", "'{}'", "'{\"\\\\x\"}'"]],
  ['c_enum_arr', 'mood[]', ["'{sad,happy}'", "'{}'", "'{NULL}'"]],
  ['c_json_arr', 'json[]', ['\'{"{}","[1]"}\'', "'{}'", "'{NULL}'"]],
  ['c_inet_arr', 'inet[]', ["'{1.1.1.1,::2}'", "'{}'", "'{NULL}'"]],
  ['c_char1_arr', '"char"[]', ["'{a,b}'", "'{}'", "'{z}'"]],
  ['c_point_arr', 'point[]', ["'{\"(1,2)\"}'", "'{}'", "'{\"(0,0)\"}'"]],
  ['c_int4range_arr', 'int4range[]', ["'{\"[1,2)\"}'", "'{}'", "'{empty}'"]],
  ['c_bit1_arr', 'bit(1)[]', ["'{1,0}'", "'{}'", "'{1}'"]],
  ['c_varbit_arr', 'varbit[]', ["'{101}'", "'{}'", "'{NULL}'"]],
  ['c_oid_arr', 'oid[]', ["'{1,2}'", "'{}'", "'{4294967295}'"]],
  ['c_int2vector', 'int2vector', ["'1 2 3'", "''", "'7'"]],
  ['c_oidvector', 'oidvector', ["'23 25'", "''", "'1'"]],
];

const ALL_TYPES_DDL = `
CREATE EXTENSION IF NOT EXISTS citext;
CREATE EXTENSION IF NOT EXISTS hstore;
CREATE EXTENSION IF NOT EXISTS ltree;
CREATE EXTENSION IF NOT EXISTS cube;
CREATE TYPE mood AS ENUM ('sad', 'happy');
CREATE DOMAIN posint AS integer CHECK (VALUE > 0);
CREATE DOMAIN shorttext AS varchar(10);
CREATE TYPE pair AS (a integer, b text);
CREATE TABLE all_types (
  id integer PRIMARY KEY,
${ALL_TYPES_COLUMNS.map(([n, t]) => '  ' + n + ' ' + t).join(',\n')}
);
${[0, 1, 2]
  .map(
    (row) =>
      `INSERT INTO all_types (id, ${ALL_TYPES_COLUMNS.map(([n]) => n).join(', ')}) VALUES (${row + 1}, ${ALL_TYPES_COLUMNS.map(
        ([, t, v]) => '(' + v[row] + ')::' + t,
      ).join(', ')});`,
  )
  .join('\n')}
INSERT INTO all_types (id) VALUES (4);
`;

const DROP_ALL = `
DROP TABLE IF EXISTS order_lines, orders, products, categories, employees, customers, fishes, greetings, all_types CASCADE;
DROP FUNCTION IF EXISTS strftime(text, date);
DROP TYPE IF EXISTS mood CASCADE;
DROP TYPE IF EXISTS pair CASCADE;
DROP DOMAIN IF EXISTS posint CASCADE;
DROP DOMAIN IF EXISTS shorttext CASCADE;
`;

/** Copies one table of samples.db into PostgreSQL. */
async function copyTable(client: pg.Client, db: DatabaseSync, table: string): Promise<void> {
  const rows = db.prepare(`SELECT * FROM "${table.toUpperCase()}"`).all() as Record<string, unknown>[];
  if (rows.length === 0) return;
  const columns = Object.keys(rows[0]!);
  const batch = 200;
  for (let start = 0; start < rows.length; start += batch) {
    const chunk = rows.slice(start, start + batch);
    const values: unknown[] = [];
    const tuples = chunk.map((row) => {
      const refs = columns.map((c) => {
        const v = row[c];
        values.push(v === null || v === undefined ? null : v instanceof Uint8Array ? Buffer.from(v) : String(v));
        return '$' + values.length;
      });
      return '(' + refs.join(', ') + ')';
    });
    await client.query(`INSERT INTO ${table} (${columns.map((c) => c.toLowerCase()).join(', ')}) VALUES ${tuples.join(', ')}`, values);
  }
}

/**
 * Creates the test tables when the database does not have them yet (or has another version of
 * them). Safe to call from several test files at once: an advisory lock serialises the loaders.
 */
export async function loadFixture(): Promise<void> {
  const client = new pg.Client(testConfig());
  await client.connect();
  try {
    await client.query('BEGIN');
    await client.query('SELECT pg_advisory_xact_lock(4242424242)');
    await client.query('CREATE TABLE IF NOT EXISTS reportman_fixture (version text NOT NULL)');
    const r = await client.query('SELECT version FROM reportman_fixture');
    if (r.rows.length === 1 && r.rows[0].version === FIXTURE_VERSION) {
      await client.query('COMMIT');
      return;
    }
    await client.query(DROP_ALL);
    await client.query(SAMPLE_TABLES);
    const db = new DatabaseSync(path.join(samplesDir, 'samples.db'), { readOnly: true });
    try {
      for (const table of SAMPLE_ORDER) await copyTable(client, db, table);
    } finally {
      db.close();
    }
    await client.query(ALL_TYPES_DDL);
    await client.query('DELETE FROM reportman_fixture');
    await client.query('INSERT INTO reportman_fixture (version) VALUES ($1)', [FIXTURE_VERSION]);
    await client.query('COMMIT');
  } catch (e) {
    await client.query('ROLLBACK').catch(() => undefined);
    throw e;
  } finally {
    await client.end();
  }
}
