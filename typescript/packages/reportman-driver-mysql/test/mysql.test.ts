// The MySQL driver against a MySQL server and the C# engine with MySqlConnector 2.5:
//
//   - the reports of cases.json run in the TypeScript engine through openReport and the driver give
//     the metafile and the PDF bytes golden-cs gave (fixtures/run, the C# clock), and the server
//     receives the same statements MySqlConnector sent (the general log, read as root);
//   - the queries of cases.json give the columns, .NET types, sizes and values MySqlConnector reads
//     (fixtures/sql), or its errors, with the connection string options of each case;
//   - parameters of every engine type, transactions and errors behave as with MySqlConnector.
//
// The fixtures come from test/generate-fixtures.ts. The tests need the test server (see
// database.ts); without it they are skipped.

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  CsDecimal,
  CultureInfo,
  type ConnectionRequest,
  type DataConnection,
  DateTimeKind,
  type DataValue,
  type QueryParameter,
  type QueryResult,
  RpDateTime,
} from 'reportman-engine';
import { createDataHost, openReport } from 'reportman-node';
import { mysql, type MySqlColumnInfo } from 'reportman-driver-mysql';
import { pdfCreation } from '../../reportman-engine/test/golden-run.js';
import { connectionString, isReachable, loadDatabase, mysqlTest, serverVersion } from './database.js';
import {
  asRoot,
  cases,
  datasetStatements,
  expectCell,
  expectSameMetafile,
  type GeneralLog,
  type GoldenSql,
  here,
  type LoggedStatement,
  openGeneralLog,
  runFixtures,
  runLikeGolden,
  sqlFixtures,
  withoutRepetitions,
} from './golden.js';

const reachable = await isReachable();
if (reachable) await loadDatabase();
const version = reachable ? await serverVersion() : '';
// The fixtures are what MySqlConnector read from one server (fixtures/server.json): the tests that
// compare with them run against that server; live.test.ts compares with golden-cs on any other
const fixtureServer = (JSON.parse(fs.readFileSync(path.join(here, 'fixtures/server.json'), 'utf8')) as { version: string }).version;
const withFixtures = reachable && version === fixtureServer;

const connections = { SAMPLES: mysql(connectionString()) };
const { reports, queries } = cases();

function request(isolationLevel: ConnectionRequest['isolationLevel'] = 'RepeatableRead'): ConnectionRequest {
  return {
    database: {} as ConnectionRequest['database'],
    alias: 'SAMPLES',
    connectionString: '',
    providerFactory: 'MySQLConnector',
    engineSqlite: false,
    dbParam: () => '',
    isolationLevel,
  };
}

function command(sql: string, parameters: QueryParameter[] = [], inTransaction = true) {
  return { sql, parameters, inTransaction, dataset: 'T' };
}

const DB_TYPES: Record<string, QueryParameter['dbType']> = {
  Null: 'Object', DBNull: 'Object', Boolean: 'Boolean', Byte: 'Byte', Char: 'SByte', Int32: 'Int32', Int64: 'Int64',
  Decimal: 'Decimal', Double: 'Double', DateTime: 'DateTime', String: 'String', Binary: 'Binary', Object: 'Object',
};

function param(name: string, valueType: QueryParameter['valueType'], value: DataValue, dbType?: QueryParameter['dbType']): QueryParameter {
  return { name, value, valueType, dbType: dbType ?? DB_TYPES[valueType]! };
}

function errorOf(p: Promise<unknown> | (() => unknown)): Promise<{ type: string; message: string } | null> {
  const run = typeof p === 'function' ? Promise.resolve().then(p) : p;
  return run.then(
    () => null,
    (e: unknown) => ({ type: (e as { netType?: string }).netType ?? (e as Error).name, message: (e as Error).message }),
  );
}

// ---------------------------------------------------------------------------------------------

describe.skipIf(!withFixtures)(`report parity with golden-cs on ${version}`, () => {
  let log: GeneralLog | undefined;
  beforeAll(async () => {
    log = await openGeneralLog();
  });
  afterAll(async () => {
    await log?.close();
  });

  describe.each(reports)('$name', (c) => {
    const reportFile = path.resolve(here, c.report);
    const errorFile = path.join(runFixtures, c.name + '.error.json');
    const statementsFile = path.join(runFixtures, c.name + '.statements.json');
    const csStatements = JSON.parse(fs.readFileSync(statementsFile, 'utf8')) as LoggedStatement[];
    // A report whose datasets C# keeps open together runs there on a connection per dataset
    // (fixtures/reports/NAME.split.rep); here on one connection and on those
    const split = c.connections !== undefined;
    const files: [string, Record<string, ReturnType<typeof mysql>>][] = [[reportFile, connections]];
    if (split) {
      const all: Record<string, ReturnType<typeof mysql>> = { SAMPLES: connections.SAMPLES };
      for (const alias of c.connections!) all[alias] = mysql(connectionString());
      files.push([path.resolve(here, c.golden!), all]);
    }

    if (fs.existsSync(errorFile)) {
      it('fails as C# does', async () => {
        const expected = JSON.parse(fs.readFileSync(errorFile, 'utf8')) as { error: string; message: string };
        const error = await errorOf(runLikeGolden(reportFile, createDataHost({ connections }), { params: c.params, culture: c.culture }));
        expect(error).not.toBeNull();
        expect(error!.message.split('\n')[0]).toBe(expected.message.split('\n')[0]);
      });
      return;
    }
    const csJson = JSON.parse(fs.readFileSync(path.join(runFixtures, c.name + '.meta.json'), 'utf8')) as {
      pages: { objects: unknown[] }[];
    } & Record<string, unknown>;
    const csPdf = new Uint8Array(fs.readFileSync(path.join(runFixtures, c.name + '.cs.pdf')));
    const { clock, now } = pdfCreation(csPdf);

    const sameMetafile = (meta: Parameters<typeof expectSameMetafile>[0]): void => expectSameMetafile(meta, csJson);
    const samePdf = (pdf: Uint8Array, tag: string): void => {
      if (Buffer.compare(Buffer.from(pdf), Buffer.from(csPdf)) !== 0) {
        fs.writeFileSync(path.join(os.tmpdir(), 'rm-mysql-' + c.name + tag + '.ts.pdf'), pdf);
      }
      expect(Buffer.compare(Buffer.from(pdf), Buffer.from(csPdf))).toBe(0);
    };

    it.each(files.map(([file, conns]) => ({ file: path.basename(file), full: file, conns })))(
      'lays out the same metafile run as golden-cs runs it ($file)',
      async ({ full, conns }) => {
        const { run, meta, noData } = await runLikeGolden(full, createDataHost({ connections: conns }), { params: c.params, culture: c.culture, now });
        try {
          expect(noData).toBe(false);
          sameMetafile(meta);
        } finally {
          await run.close();
        }
      },
    );

    it.each(files.map(([file, conns]) => ({ file: path.basename(file), full: file, conns })))(
      'gives the same metafile and PDF bytes through openReport ($file)',
      async ({ full, file, conns }) => {
        const options = { connections: conns, clock, culture: c.culture };
        const metaReport = await openReport(full, options);
        sameMetafile(await metaReport.executeToMetafile(c.params ?? {}));
        const report = await openReport(full, options);
        samePdf(await report.executeToPdf(c.params ?? {}, { compressed: false }), file === path.basename(reportFile) ? '' : '.split');
      },
    );

    it('sends the server the statements MySqlConnector sends', async (ctx) => {
      if (log === undefined) ctx.skip();
      await log!.truncate();
      const { run } = await runLikeGolden(reportFile, createDataHost({ connections }), { params: c.params, culture: c.culture, now });
      await run.close();
      const mine = await log!.statements();
      // on one connection the session statements of each C# connection are not there: the
      // statements of the datasets are the same, in the same order
      if (split) expect(withoutRepetitions(datasetStatements(mine))).toEqual(withoutRepetitions(datasetStatements(csStatements)));
      else expect(mine).toEqual(csStatements);
    });
  });

  it('runs the SQL of a sample with :NAME placeholders, which MySqlConnector leaves to the server', async () => {
    // invoices.rep keeps its Delphi placeholders (:FIRST_ORDER): C# fails on them (a syntax error
    // of the server); the driver binds them as the @FIRST_ORDER of the adapted copy
    const csPdf = new Uint8Array(fs.readFileSync(path.join(runFixtures, 'invoices-range.cs.pdf')));
    const report = await openReport(path.resolve(here, '../../../../samples/invoices.rep'), { connections, clock: pdfCreation(csPdf).clock });
    const pdf = await report.executeToPdf({ FIRST_ORDER: 7, LAST_ORDER: 9 }, { compressed: false });
    expect(Buffer.compare(Buffer.from(pdf), Buffer.from(csPdf))).toBe(0);
  });
});

// ---------------------------------------------------------------------------------------------

describe.skipIf(!withFixtures)('the values MySqlConnector reads (golden-cs sql)', () => {
  it.each(queries)('$name', async (q) => {
    const golden = JSON.parse(fs.readFileSync(path.join(sqlFixtures, q.name + '.json'), 'utf8')) as GoldenSql;
    // golden-cs sql writes values with the invariant culture (a MySqlDateTime is its DateTime there)
    let factory: ReturnType<typeof mysql>;
    try {
      factory = mysql({ connectionString: connectionString(q.options ?? ''), culture: CultureInfo.invariant });
    } catch (e) {
      // the connection string is read when the factory is made (C#: when ConnectionString is set)
      expect({ type: (e as { netType?: string }).netType, message: (e as Error).message }).toEqual({ type: golden.error, message: golden.message });
      return;
    }
    const opened = errorOf(Promise.resolve(factory(request())));
    let connection: DataConnection;
    try {
      connection = await factory(request());
    } catch {
      expect(await opened).toEqual({ type: golden.error, message: golden.message });
      return;
    }
    try {
      const result = errorOf(() => connection.query(command(q.sql)));
      if (golden.error !== undefined) {
        expect(await result).toEqual({ type: golden.error, message: golden.message });
        return;
      }
      expect(await result).toBeNull();
      const r: QueryResult = await connection.query(command(q.sql));
      expect(
        r.columns.map((c) => ({ columnName: c.name, dataType: (c as MySqlColumnInfo).netType, columnSize: c.size ?? null, dataTypeName: c.declaredType ?? null })),
      ).toEqual(golden.columns);
      expect(r.rows.length).toBe(golden.rows!.length);
      golden.rows!.forEach((row, i) =>
        row.forEach((cell, j) => expectCell(golden.columns![j]!.dataType, cell, r.rows[i]![j]!, `${golden.columns![j]!.columnName} row ${i + 1}`)),
      );
    } finally {
      await connection.close(true);
    }
  });

  it('gives the engine column types of the .NET types', async () => {
    const c = await connections.SAMPLES(request());
    try {
      const r = await c.query(command('SELECT * FROM TYPES ORDER BY ID'));
      const types = Object.fromEntries(r.columns.map((col) => [col.name, col.type]));
      expect(types).toMatchObject({
        T_TINYINT: 'Int64', T_UTINYINT: 'Byte', T_BOOL: 'Boolean', T_UBOOL: 'Byte', T_SMALLINT: 'Int16', T_USMALLINT: 'Int64',
        T_MEDIUMINT: 'Int32', T_UMEDIUMINT: 'Int64', T_INT: 'Int32', T_UINT: 'Int64', T_BIGINT: 'Int64', T_UBIGINT: 'Decimal',
        T_BIT1: 'Decimal', T_DEC5_2: 'Decimal', T_FLOAT: 'Single', T_DOUBLE: 'Double', T_CHAR: 'String', T_TEXT: 'String',
        T_GUID: 'Object', T_GUID32: 'String', T_BINARY: 'Binary', T_LONGBLOB: 'Binary', T_DATE: 'DateTime', T_DATETIME6: 'DateTime',
        T_TIMESTAMP: 'DateTime', T_TIME: 'Object', T_YEAR: 'Int32', T_JSON: 'String', T_ENUM: 'String', T_SET: 'String', T_POINT: 'Binary',
      });
    } finally {
      await c.close(true);
    }
  });

  it('prints a DATETIME read with AllowZeroDateTime in the culture it is given', async () => {
    const c = await mysql({ connectionString: connectionString('AllowZeroDateTime=True'), culture: 'es-ES' })(request());
    try {
      const r = await c.query(command('SELECT DT FROM ZERODATES ORDER BY ID'));
      expect(r.columns[0]!.type).toBe('Object');
      expect(r.rows.map((row) => row[0])).toEqual(['0000-00-00', '0000-00-00', '29/2/2024 13:45:30']);
    } finally {
      await c.close(true);
    }
  });

  it('reads dates with the kind of DateTimeKind', async () => {
    const c = await mysql(connectionString('DateTimeKind=Utc'))(request());
    try {
      const r = await c.query(command('SELECT T_DATETIME FROM TYPES WHERE ID = 1'));
      expect((r.rows[0]![0] as RpDateTime).kind).toBe(DateTimeKind.Utc);
    } finally {
      await c.close(true);
    }
  });
});

// ---------------------------------------------------------------------------------------------

describe.skipIf(!reachable)('parameters as MySqlConnector sends them', () => {
  let connection: DataConnection;
  beforeAll(async () => {
    connection = await connections.SAMPLES(request());
  });
  afterAll(async () => {
    await connection?.close(true);
  });

  /** An integer of the server as a bigint (MySQL types a small literal BIGINT, MariaDB INT). */
  const int = (v: DataValue): bigint => (typeof v === 'bigint' ? v : BigInt(v as number));

  /** What the server makes of the literal of the parameter. */
  async function roundTrip(p: QueryParameter, sql = 'SELECT @P AS V'): Promise<DataValue> {
    const r = await connection.query(command(sql, [{ ...p, name: 'P' }]));
    return r.rows[0]![0]!;
  }

  it('binds every engine value type', async () => {
    expect(int(await roundTrip(param('P', 'Int32', -42)))).toBe(-42n);
    expect(int(await roundTrip(param('P', 'Byte', 200)))).toBe(200n);
    expect(await roundTrip(param('P', 'Int64', -9223372036854775808n))).toBe(-9223372036854775808n);
    expect(int(await roundTrip(param('P', 'Boolean', true)))).toBe(1n);
    expect(int(await roundTrip(param('P', 'Boolean', false)))).toBe(0n);
    expect(await roundTrip(param('P', 'Char', 'A'))).toBe('A');
    expect(await roundTrip(param('P', 'Char', "'"))).toBe("'");
    expect(await roundTrip(param('P', 'Char', '\\'))).toBe('\\');
    // a double goes as its "R" text: 0.1 is a DECIMAL literal for the server, 1E+300 a DOUBLE one
    expect(((await roundTrip(param('P', 'Double', 0.1))) as CsDecimal).toInvariantString()).toBe('0.1');
    expect(await roundTrip(param('P', 'Double', 0.1), 'SELECT CAST(@P AS DOUBLE) AS V')).toBe(0.1);
    expect(await roundTrip(param('P', 'Double', 1e300))).toBe(1e300);
    expect(await roundTrip(param('P', 'Double', -1.5e-7))).toBe(-1.5e-7);
    expect(await roundTrip(param('P', 'Double', 123456789012345680000))).toBe(123456789012345680000);
    expect(((await roundTrip(param('P', 'Decimal', CsDecimal.parseInvariant('-12.50')))) as CsDecimal).toInvariantString()).toBe('-12.50');
    expect(
      ((await roundTrip(param('P', 'Decimal', CsDecimal.parseInvariant('79228162514264337593543950335')))) as CsDecimal).toInvariantString(),
    ).toBe('79228162514264337593543950335');
    expect(await roundTrip(param('P', 'String', "ñandú 日本 'quoted' \\ back\0nul 😀"))).toBe("ñandú 日本 'quoted' \\ back\0nul 😀");
    const d = RpDateTime.fromTicks(RpDateTime.create(2024, 2, 29, 23, 59, 59).ticks + 9_999_999n);
    expect(((await roundTrip(param('P', 'DateTime', d))) as RpDateTime).toString()).toBe('2024-02-29T23:59:59.9999990');
    expect(((await roundTrip(param('P', 'DateTime', RpDateTime.create(1, 1, 1)))) as RpDateTime).toString()).toBe('0001-01-01T00:00:00.0000000');
    const bytes = new Uint8Array([0, 1, 0x27, 0x5c, 0x80, 0xff, 0xc3, 0x28]);
    expect(await roundTrip(param('P', 'Binary', bytes))).toEqual(bytes);
    expect(await roundTrip(param('P', 'DBNull', null))).toBeNull();
    expect(await roundTrip(param('P', 'Null', undefined))).toBeNull();
  });

  it('finds the placeholders as MySqlConnector: @NAME, ?NAME, :NAME of a parameter, case-insensitive, not in quotes or comments', async () => {
    const r = await connection.query(
      command("SELECT @a + ?A + :A AS S, '@A' AS L, \"@A\" AS Q, `@A` AS I /* @A */ FROM (SELECT 1 AS `@A`) X -- @A", [param('A', 'Int32', 20)]),
    );
    expect([int(r.rows[0]![0]!), ...r.rows[0]!.slice(1, 3), int(r.rows[0]![3]!)]).toEqual([60n, '@A', '@A', 1n]);
    // :NAME of something that is not a parameter goes to the server as it is (a time literal here)
    const t = await connection.query(command("SELECT TIME '10:30' AS T, :B AS B", [param('B', 'String', 'b')]));
    expect(t.rows[0]).toEqual(['10:30:00', 'b']);
  });

  it('fails as MySqlConnector fails on a parameter it cannot bind', async () => {
    expect(await errorOf(() => connection.query(command('SELECT @X AS X', [param('Y', 'Int32', 1)])))).toEqual({
      type: 'MySqlException',
      message: "Parameter '@X' must be defined. To use this as a variable, set 'Allow User Variables=true' in the connection string.",
    });
    expect(await errorOf(() => connection.query(command('SELECT ? AS X, ? AS Y', [param('A', 'Int32', 1)])))).toEqual({
      type: 'MySqlException',
      message: 'Parameter index 1 is invalid when only 1 parameter is defined.',
    });
    expect(await errorOf(() => connection.query(command('SELECT 1', [param('A', 'Int32', 1), param('@a', 'Int32', 2)])))).toEqual({
      type: 'MySqlException',
      message: "Parameter '@a' has already been defined.",
    });
    // GETVALUEFROMSQL passes the Variant itself
    expect(await errorOf(() => connection.query(command('SELECT @P', [param('@P', 'Object', 5, 'Int32')])))).toEqual({
      type: 'InvalidCastException',
      message: "Unable to cast object of type 'Reportman.Reporting.Variant' to type 'System.Int32'.",
    });
    expect(await errorOf(() => connection.query(command('SELECT @P', [param('@P', 'Object', 'x', 'String')])))).toEqual({
      type: 'NotSupportedException',
      message: 'Parameter type Variant is not supported; see https://mysqlconnector.net/param-type. Value: x',
    });
  });

  it('checks the kind of a date against DateTimeKind', async () => {
    const utc = await mysql(connectionString('DateTimeKind=Utc'))(request());
    try {
      const local = RpDateTime.create(2024, 1, 1, 0, 0, 0, 0, DateTimeKind.Local);
      expect(await errorOf(() => utc.query(command('SELECT @D', [param('D', 'DateTime', local)])))).toEqual({
        type: 'MySqlException',
        message: 'DateTime.Kind must not be Local when DateTimeKind setting is Utc (parameter name: D)',
      });
    } finally {
      await utc.close(true);
    }
  });

  it('lets user variables through with AllowUserVariables', async () => {
    const c = await mysql(connectionString('AllowUserVariables=True'))(request());
    try {
      const r = await c.query(command('SELECT @v := 5 AS A, @v + @P AS B', [param('P', 'Int32', 1)]));
      expect(r.rows[0]!.map(Number)).toEqual([5, 6]);
    } finally {
      await c.close(true);
    }
  });
});

// ---------------------------------------------------------------------------------------------

describe.skipIf(!reachable)('transactions and connections', () => {
  it('begins the implicit transaction with the isolation level of the report connection', async () => {
    const levels: [ConnectionRequest['isolationLevel'], string][] = [
      ['RepeatableRead', 'REPEATABLE-READ'],
      ['Snapshot', 'REPEATABLE-READ'],
      ['Unspecified', 'REPEATABLE-READ'],
      ['Serializable', 'SERIALIZABLE'],
      ['ReadCommitted', 'READ-COMMITTED'],
      ['ReadUncommitted', 'READ-UNCOMMITTED'],
    ];
    for (const [level, expected] of levels) {
      const c = await connections.SAMPLES(request(level));
      try {
        expect((await c.query(command('SELECT @@transaction_isolation AS I'))).rows[0]![0], level).toBe(expected);
      } finally {
        await c.close(true);
      }
    }
    expect(await errorOf(Promise.resolve(connections.SAMPLES(request('Chaos'))))).toEqual({
      type: 'NotSupportedException',
      message: 'IsolationLevel.Chaos is not supported.',
    });
  });

  it('commits on close(true) and rolls back on close(false)', async () => {
    const clear = await connections.SAMPLES(request());
    await clear.query(command('DELETE FROM RM_TX'));
    await clear.close(true);

    const rolled = await connections.SAMPLES(request());
    await rolled.query(command('INSERT INTO RM_TX (V) VALUES (1)'));
    await rolled.close(false);
    const committed = await connections.SAMPLES(request());
    await committed.query(command('INSERT INTO RM_TX (V) VALUES (2)'));
    await committed.close(true);

    const check = await connections.SAMPLES(request());
    try {
      expect((await check.query(command('SELECT V FROM RM_TX ORDER BY V'))).rows).toEqual([[2]]);
    } finally {
      await check.close(true);
    }
  });

  it('refuses a command outside the implicit transaction (GETVALUEFROMSQL), as MySqlCommand does', async () => {
    const c = await connections.SAMPLES(request());
    try {
      expect(await errorOf(() => c.query(command('SELECT 1', [], false)))).toEqual({
        type: 'InvalidOperationException',
        message: "The transaction associated with this command is not the connection's active transaction; see https://mysqlconnector.net/trans",
      });
    } finally {
      await c.close(true);
    }
    // Ignore Command Transaction=true lets it run
    const ignore = await mysql(connectionString('Ignore Command Transaction=true'))(request());
    try {
      expect((await ignore.query(command('SELECT 1 AS X', [], false))).rows.map((row) => row.map(Number))).toEqual([[1]]);
    } finally {
      await ignore.close(true);
    }
  });

  it('reports a wrong password and an unknown database with the server messages', async () => {
    const wrong = await errorOf(Promise.resolve(mysql({ connectionString: connectionString(), password: 'not-the-password' })(request())));
    expect(wrong?.type).toBe('MySqlException');
    expect(wrong?.message).toMatch(/^Access denied for user 'rmtest'@'[^']+' \(using password: YES\)$/);
    expect(await errorOf(Promise.resolve(mysql({ connectionString: connectionString(), database: 'nosuchdb' })(request())))).toEqual({
      type: 'MySqlException',
      message: "Access denied for user 'rmtest'@'%' to database 'nosuchdb'",
    });
    expect(await errorOf(Promise.resolve(mysql({ connectionString: connectionString(), port: 1 })(request())))).toEqual({
      type: 'MySqlException',
      message: 'Unable to connect to any of the specified MySQL hosts.',
    });
  });

  it('authenticates without TLS as MySqlConnector: the RSA key is asked for on a loopback address or with AllowPublicKeyRetrieval', async (ctx) => {
    // a new password empties the cache of caching_sha2_password: the next login is a full one
    const reset = `ALTER USER '${mysqlTest.user}'@'%' IDENTIFIED BY '${mysqlTest.password}'`;
    if ((await asRoot(reset)) === undefined || !version.includes('.') || /MariaDB/.test(version)) ctx.skip();
    const plain = await mysql(connectionString('SslMode=None'))(request());
    await plain.close(true);
    // RM_MYSQL_REMOTE_HOST: the same server at an address that is not a loopback one (the WSL address)
    const remote = process.env.RM_MYSQL_REMOTE_HOST;
    if (remote === undefined) return;
    await asRoot(reset);
    const options = { connectionString: connectionString('SslMode=None'), host: remote };
    expect(await errorOf(Promise.resolve(mysql(options)(request())))).toEqual({
      type: 'MySqlException',
      message:
        "Authentication method 'caching_sha2_password' failed. Either use a secure connection, specify the server's RSA public key with ServerRSAPublicKeyFile, or set AllowPublicKeyRetrieval=True.",
    });
    const allowed = await mysql({ ...options, connectionString: connectionString('SslMode=None;AllowPublicKeyRetrieval=True') })(request());
    await allowed.close(true);
  });

  it('reads the first result set and a statement without rows', async () => {
    const c = await connections.SAMPLES(request());
    try {
      expect(await c.query(command('UPDATE CUSTOMERS SET CITY = CITY WHERE 1 = 0'))).toEqual({ columns: [], rows: [] });
      const r = await c.query(command('UPDATE CUSTOMERS SET CITY = CITY WHERE 1 = 0; SELECT 7 AS X; SELECT 8 AS Y'));
      expect(r.rows.map((row) => row.map(Number))).toEqual([[7]]);
      expect(r.columns.map((col) => col.name)).toEqual(['X']);
    } finally {
      await c.close(false);
    }
  });
});

describe.skipIf(reachable)('without the test server', () => {
  it('skips the database tests', () => {
    expect(reachable).toBe(false);
  });
});
