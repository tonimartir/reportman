// The parts of the driver that reproduce Npgsql: its SQL rewriting, its connection strings, its
// parameter binding, the implicit transaction and its errors, and the synchronous transport.

import pg from 'pg';
import { describe, expect, it } from 'vitest';
import {
  CsDecimal,
  DateTimeKind,
  NetException,
  RpDateTime,
  type ConnectionRequest,
  type IsolationLevelName,
  type QueryCommand,
  type QueryParameter,
} from 'reportman-engine';
import { PostgresException, parseNpgsqlConnectionString, parseSql, postgres } from '../src/index.js';
import { bindParameter } from '../src/params.js';
import { intervalTicks, parseArray, readBytea, readNumeric, timeSpanText, tsQueryText } from '../src/values.js';
import { loadFixture, serverAvailable, testConfig } from './fixture.ts';

const available = await serverAvailable();
if (available) await loadFixture();

const request = (isolationLevel: IsolationLevelName = 'RepeatableRead'): ConnectionRequest => ({
  database: {} as ConnectionRequest['database'],
  alias: 'SAMPLES',
  connectionString: '',
  providerFactory: 'PostgreSQL',
  engineSqlite: false,
  dbParam: () => '',
  isolationLevel,
});

const command = (sql: string, parameters: QueryParameter[] = [], inTransaction = true): QueryCommand => ({ sql, parameters, inTransaction, dataset: 'D' });

const p = (name: string, valueType: QueryParameter['valueType'], value: QueryParameter['value'], dbType: QueryParameter['dbType'] = 'Object'): QueryParameter => ({
  name,
  value,
  valueType,
  dbType,
});

describe('Npgsql SQL rewriting (SqlQueryParser)', () => {
  const names = ['A', 'B', 'P.X', 'Pñ'];
  const lookup = (name: string): number => names.findIndex((n) => n.toUpperCase() === name.toUpperCase());

  it('numbers the parameters by first appearance, :name and @name alike', () => {
    expect(parseSql('SELECT :A, @b, :A, :P.X, :Pñ', lookup)).toEqual([{ sql: 'SELECT $1, $2, $1, $3, $4', parameters: [0, 1, 2, 3] }]);
  });

  it('leaves alone literals, identifiers, dollar quotes, comments, casts and unknown names', () => {
    const sql =
      "SELECT ':A', \"x:A\", E'it\\'s :A', $$:A$$, $tag$ :A $ $tag$, x::int, @@A, :C, a[1:2] -- :A\n /* :A /* :A */ :A */ + :B";
    expect(parseSql(sql, lookup)).toEqual([
      { sql: "SELECT ':A', \"x:A\", E'it\\'s :A', $$:A$$, $tag$ :A $ $tag$, x::int, @@A, :C, a[1:2] -- :A\n /* :A /* :A */ :A */ + $1", parameters: [1] },
    ]);
  });

  it('splits statements at the semicolons outside parentheses, numbering each one on its own', () => {
    expect(parseSql('SELECT :B; SELECT (:A; :B); SELECT 1 ;  ', lookup)).toEqual([
      { sql: 'SELECT $1', parameters: [1] },
      { sql: 'SELECT ($1; $2)', parameters: [0, 1] },
      { sql: 'SELECT 1 ', parameters: [] },
    ]);
  });

  it('reads backslashes in strings when standard_conforming_strings is off', () => {
    expect(parseSql("SELECT 'a\\' :A', :A", lookup, false)).toEqual([{ sql: "SELECT 'a\\' :A', $1", parameters: [0] }]);
    // With the setting on, 'a\' ends at its second quote and the last quote opens a literal
    expect(parseSql("SELECT 'a\\' :A', :A", lookup, true)).toEqual([{ sql: "SELECT 'a\\' $1', :A", parameters: [0] }]);
  });
});

describe('Npgsql connection strings', () => {
  it('reads the keywords and their synonyms', () => {
    const r = parseNpgsqlConnectionString(
      "Server=db.local:6543;Database=sales;User Id=report;Password='p;w''d';Timeout=5;Command Timeout=0;" +
        'Application Name=rm;Search Path=s1,public;Include Error Detail=true;Pooling=false',
    );
    expect(r.config).toMatchObject({
      host: 'db.local',
      port: 6543,
      database: 'sales',
      user: 'report',
      password: "p;w'd",
      connectionTimeoutMillis: 5000,
      application_name: 'rm',
      options: '-c search_path=s1,public',
    });
    expect(r.commandTimeout).toBe(0);
    expect(r.includeErrorDetail).toBe(true);
  });

  it('encrypts with SSL Mode=Require and verifies with VerifyFull', () => {
    expect(parseNpgsqlConnectionString('Host=h;SSL Mode=Require;Trust Server Certificate=true').config.ssl).toEqual({ rejectUnauthorized: false });
    expect(parseNpgsqlConnectionString('Host=h;SslMode=VerifyFull').config.ssl).toEqual({ rejectUnauthorized: true });
    expect(parseNpgsqlConnectionString('Host=h;SSL Mode=Prefer').config.ssl).toBeUndefined();
  });
});

describe('Npgsql parameter binding', () => {
  const dt = RpDateTime.create(2024, 1, 2, 3, 4, 5);
  const micros = (b: unknown): bigint => (b as Buffer).readBigInt64BE();

  it('sends each DbType as its PostgreSQL type', () => {
    expect(bindParameter(p('A', 'Int32', 7, 'Int32'))).toEqual({ oid: 23, value: '7' });
    expect(bindParameter(p('A', 'Int64', 12345678901n, 'Int64'))).toEqual({ oid: 20, value: '12345678901' });
    expect(bindParameter(p('A', 'Byte', 200, 'Byte'))).toEqual({ oid: 21, value: '200' });
    expect(bindParameter(p('A', 'Decimal', CsDecimal.parseInvariant('1.50'), 'Decimal'))).toEqual({ oid: 1700, value: '1.50' });
    expect(bindParameter(p('A', 'Double', -0, 'Double'))).toEqual({ oid: 701, value: '-0' });
    expect(bindParameter(p('A', 'Double', NaN, 'Double'))).toEqual({ oid: 701, value: 'NaN' });
    expect(bindParameter(p('A', 'Boolean', true, 'Boolean'))).toEqual({ oid: 16, value: 't' });
    expect(bindParameter(p('A', 'String', 'x', 'String'))).toEqual({ oid: 25, value: 'x' });
    expect(bindParameter(p('A', 'DBNull', null, 'Int32'))).toEqual({ oid: 23, value: null });
    expect(bindParameter(p('A', 'DBNull', null, 'Object'))).toEqual({ oid: 0, value: null });
  });

  it('sends a date as timestamp (DateTime2), a UTC date as timestamptz, MinValue and MaxValue as infinities', () => {
    const local = bindParameter(p('A', 'DateTime', dt, 'DateTime'));
    expect(local.oid).toBe(1114);
    expect(micros(local.value)).toBe(757479845000000n);
    const utc = bindParameter(p('A', 'DateTime', dt.withKind(DateTimeKind.Utc), 'DateTime'));
    expect(utc.oid).toBe(1184);
    expect(micros(bindParameter(p('A', 'DateTime', RpDateTime.minValue, 'DateTime')).value)).toBe(-(1n << 63n));
    expect(micros(bindParameter(p('A', 'DateTime', RpDateTime.fromTicks(3155378975999999999n), 'DateTime')).value)).toBe((1n << 63n) - 1n);
    // Before 2000 the division truncates toward zero, as C# does
    expect(micros(bindParameter(p('A', 'DateTime', RpDateTime.fromTicks(630822816000000000n - 15n), 'DateTime')).value)).toBe(-1n);
  });

  it('converts any number to an integer or numeric type, truncating', () => {
    expect(bindParameter(p('A', 'Double', -5.7, 'Int32')).value).toBe('-5');
    expect(bindParameter(p('A', 'Decimal', CsDecimal.parseInvariant('5.7'), 'Int64')).value).toBe('5');
    expect(bindParameter(p('A', 'Double', 5.7, 'Decimal')).value).toBe('5.7');
    expect(() => bindParameter(p('A', 'Int64', 3000000000n, 'Int32'))).toThrow('Arithmetic operation resulted in an overflow.');
  });

  it('refuses the values its type cannot take, as Npgsql', () => {
    expect(() => bindParameter(p('A', 'Int32', 7, 'String'))).toThrow(
      "Writing values of 'System.Int32' is not supported for parameters having DataTypeName 'text'.",
    );
    expect(() => bindParameter(p('A', 'Int32', 7, 'Double'))).toThrow("DataTypeName 'double precision'");
    expect(() => bindParameter(p('A', 'String', '7', 'Int32'))).toThrow("Writing values of 'System.String'");
    expect(() => bindParameter(p('@A', 'Object', 7, 'Int32'))).toThrow("Writing values of 'Reportman.Reporting.Variant'");
    expect(() => bindParameter(p('A', 'Null', undefined, 'Int32'))).toThrow("Parameter 'A' cannot be null, DBNull.Value should be used instead.");
    expect(() => bindParameter(p('A', 'Null', undefined, 'Object'))).toThrow(
      "Parameter 'A' must have either its DbType, NpgsqlDbType, DataTypeName or its Value set.",
    );
  });
});

describe('text formats', () => {
  it('reads numerics as decimals with their scale, or fails as Npgsql', () => {
    expect(readNumeric('123.4500').toInvariantString()).toBe('123.4500');
    expect(() => readNumeric('NaN')).toThrow('Numeric NaN not supported by System.Decimal');
    expect(() => readNumeric('1.00000000000000000000000000000')).toThrow('Numeric value does not fit in a System.Decimal');
    expect(() => readNumeric('79228162514264337593543950336')).toThrow('Value was either too large or too small for a Decimal.');
  });

  it('reads intervals as TimeSpan (wrapping as Npgsql does) and prints them as .NET', () => {
    expect(timeSpanText(intervalTicks('-1 days +02:03:04'))).toBe('-21:56:56');
    expect(timeSpanText(intervalTicks('1000000 days'))).toBe('1000000.00:00:00');
    expect(timeSpanText(intervalTicks('100000000 days'))).toBe('-6751991.04:00:54.7758080');
    expect(timeSpanText(intervalTicks('-00:00:00.000001'))).toBe('-00:00:00.0000010');
    expect(() => intervalTicks('1 mon')).toThrow('non-zero months');
  });

  it('reads arrays, bytea and tsquery', () => {
    expect(parseArray('[2:3]={{"a b",NULL},{c,"d\\"e"}}')).toEqual({ dims: 2, elements: ['a b', null, 'c', 'd"e'] });
    expect([...readBytea('\\x00ff')]).toEqual([0, 255]);
    expect([...readBytea('a\\000\\\\')]).toEqual([97, 0, 92]);
    expect(tsQueryText("'a' & 'b' & !( 'c' | 'd' )")).toBe("( 'a' & 'b' ) & !( 'c' | 'd' )");
  });
});

describe.skipIf(!available)('a PostgreSQL report connection', () => {
  const factory = postgres({ ...testConfig() });

  it.each<[IsolationLevelName, string]>([
    ['RepeatableRead', 'repeatable read'],
    ['Snapshot', 'repeatable read'],
    ['Serializable', 'serializable'],
    ['ReadCommitted', 'read committed'],
    ['ReadUncommitted', 'read uncommitted'],
    ['Unspecified', 'read committed'],
  ])('starts the implicit transaction with %s', async (level, expected) => {
    const c = await factory(request(level));
    const r = await c.query(command("SELECT current_setting('transaction_isolation') AS l"));
    expect(r.rows[0]![0]).toBe(expected);
    await c.close(true);
  });

  it('refuses the Chaos isolation level as Npgsql', async () => {
    await expect(Promise.resolve().then(() => factory(request('Chaos')))).rejects.toThrow('Unsupported IsolationLevel: Chaos');
  });

  it('commits on close(true) and rolls back on close(false)', async () => {
    const admin = new pg.Client(testConfig());
    await admin.connect();
    try {
      await admin.query('CREATE TABLE IF NOT EXISTS driver_tx (n integer)');
      await admin.query('DELETE FROM driver_tx');
      for (const commit of [false, true]) {
        const c = await factory(request());
        await c.query(command('INSERT INTO driver_tx VALUES (:N) RETURNING n', [p('N', 'Int32', commit ? 1 : 2, 'Int32')]));
        await c.close(commit);
      }
      expect((await admin.query('SELECT n FROM driver_tx')).rows).toEqual([{ n: 1 }]);
    } finally {
      await admin.query('DROP TABLE IF EXISTS driver_tx');
      await admin.end();
    }
  });

  it('runs a command without the transaction (GETVALUEFROMSQL) on the same connection, as Npgsql', async () => {
    const c = await factory(request());
    const r = await c.query(command('SELECT count(*) AS n FROM customers', [], false));
    expect(r.rows[0]![0]).toBe(63n);
    await c.close(true);
  });

  it('checks every parameter, used or not, and leaves unknown placeholders to the server', async () => {
    const c = await factory(request());
    await expect(Promise.resolve(c.query(command('SELECT 1 AS a', [p('X', 'Int32', 1, 'String')])))).rejects.toThrow(
      "Writing values of 'System.Int32' is not supported",
    );
    const e = await Promise.resolve(c.query(command('SELECT :Y AS a', [p('X', 'Int32', 1, 'Int32')]))).catch((err: unknown) => err);
    expect(e).toBeInstanceOf(PostgresException);
    expect((e as PostgresException).sqlState).toBe('42601');
    expect((e as Error).message.split(/\r?\n/)).toEqual(['42601: syntax error at or near ":"', '', 'POSITION: 8']);
    await c.close(true);
  });

  it('gives the DETAIL of server errors only with Include Error Detail', async () => {
    for (const include of [false, true]) {
      const c = await postgres({ ...testConfig(), includeErrorDetail: include })(request());
      const e = (await Promise.resolve(c.query(command("SELECT '{1'::int[] AS a"))).catch((err: unknown) => err)) as Error;
      expect(e.message).toContain(include ? 'DETAIL: Unexpected end of input.' : 'DETAIL: Detail redacted as it may contain sensitive data.');
      await c.close(true);
    }
  });

  it('fails a type Npgsql cannot read with the error of the C# engine, naming the column', async () => {
    const c = await factory(request());
    const e = (await Promise.resolve(c.query(command("SELECT row(1, 'x')::pair AS a"))).catch((err: unknown) => err)) as NetException;
    expect(e.netType).toBe('InvalidCastException');
    expect(e.message.split(/\r?\n/)).toEqual([
      "Unable to cast object of type 'System.DBNull' to type 'System.Type'.",
      'The column a is of type public.pair, which Npgsql cannot read.',
    ]);
    await c.close(true);
  });

  it('reads the formats of a server with other DateStyle, IntervalStyle, bytea_output and string settings', async () => {
    const c = await postgres({
      ...testConfig(),
      options: '-c DateStyle=SQL,DMY -c IntervalStyle=iso_8601 -c bytea_output=escape -c standard_conforming_strings=off -c lc_monetary=C',
    })(request());
    const r = await c.query(
      command(
        "SELECT '01/02/2024'::date AS d, timestamp '2024-03-04 05:06:07.5' AS t, interval '1 day 02:00:00' AS i, '\\\\x00ff41'::bytea AS b, " +
          "'it\\'s :P' AS s, :P AS p, 1234.56::money AS m",
        [p('P', 'String', 'v', 'String')],
      ),
    );
    const [d, t, i, b, s, pv, m] = r.rows[0]!;
    // The field order of the server (DMY) is kept for the SQL; only the output is ISO
    expect((d as RpDateTime).toIsoString()).toBe('2024-02-01T00:00:00.0000000');
    expect((t as RpDateTime).toIsoString()).toBe('2024-03-04T05:06:07.5000000');
    expect(i).toBe('1.02:00:00');
    expect([...(b as Uint8Array)]).toEqual([0, 255, 65]);
    expect([s, pv]).toEqual(["it's :P", 'v']);
    expect((m as CsDecimal).toInvariantString()).toBe('1234.56');
    await c.close(true);
  });

  it('stops a statement after the command timeout', async () => {
    const c = await postgres({ ...testConfig(), commandTimeout: 1 })(request());
    const e = (await Promise.resolve(c.query(command('SELECT pg_sleep(3) AS a'))).catch((err: unknown) => err)) as PostgresException;
    expect(e.sqlState).toBe('57014');
    await c.close(false);
  });

  it('fails to connect as Npgsql', async () => {
    const refused = await Promise.resolve()
      .then(() => postgres({ ...testConfig(), host: '127.0.0.1', port: 1 })(request()))
      .catch((err: unknown) => err as NetException);
    expect(refused.netType).toBe('NpgsqlException');
    expect(refused.message).toBe('Failed to connect to 127.0.0.1:1');
    // A name with several addresses: the last address tried
    const named = await Promise.resolve()
      .then(() => postgres({ ...testConfig(), host: 'localhost', port: 1 })(request()))
      .catch((err: unknown) => err as NetException);
    expect(named.message).toMatch(/^Failed to connect to (127\.0\.0\.1|::1):1$/);
    const denied = await Promise.resolve()
      .then(() => postgres({ ...testConfig(), password: 'wrong' })(request()))
      .catch((err: unknown) => err as PostgresException);
    expect(denied).toBeInstanceOf(PostgresException);
    expect(denied.message).toBe(`28P01: password authentication failed for user "${String(testConfig().user)}"`);
  });

  it('accepts an Npgsql connection string or a libpq URL', async () => {
    const c = testConfig();
    for (const cs of [
      `Host=${c.host};Port=${c.port};Database=${c.database};Username=${c.user};Password=${String(c.password)}`,
      `postgres://${c.user}:${String(c.password)}@${c.host}:${c.port}/${c.database}`,
    ]) {
      const connection = await postgres(cs)(request());
      expect((await connection.query(command('SELECT 1 AS a'))).rows).toEqual([[1]]);
      await connection.close(true);
    }
  });

  it('answers synchronously through the worker thread', () => {
    const sync = postgres({ ...testConfig(), synchronous: true });
    const c = sync(request());
    expect(c).not.toBeInstanceOf(Promise);
    const connection = c as Exclude<typeof c, PromiseLike<unknown>>;
    const r = connection.query(command('SELECT :N::int + 1 AS n, now() IS NOT NULL AS t', [p('N', 'Int32', 41, 'Int32')]));
    expect(r).toEqual({ columns: expect.any(Array), rows: [[42, true]] });
    expect(() => connection.query(command('SELECT 1/0 AS a'))).toThrow('22012: division by zero');
    connection.close(false);
  });
});
