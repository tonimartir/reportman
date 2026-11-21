// The Firebird driver against a Firebird server and the C# engine with FirebirdClient 10.3:
//
//   - the reports of cases.json run in the TypeScript engine through openReport and the driver
//     give the metafile and the PDF bytes golden-cs gave (fixtures/run, the C# clock);
//   - the queries of cases.json give the columns, .NET types, sizes and values FirebirdClient
//     reads (fixtures/sql), or its errors;
//   - parameters of every engine type, transactions and errors behave as with FirebirdClient.
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
  type DataValue,
  type QueryParameter,
  type QueryResult,
  RpDateTime,
} from 'reportman-engine';
import { createDataHost, openReport } from 'reportman-node';
import { firebird, type FirebirdColumnInfo } from 'reportman-driver-firebird';
import { metaFileJson, pdfCreation } from '../../reportman-engine/test/golden-run.js';
import { connectionString, isReachable, loadDatabase } from './database.js';
import { cases, here, runFixtures, runLikeGolden, sqlFixtures } from './golden.js';

const reachable = await isReachable();
if (reachable) await loadDatabase();

const connections = { SAMPLES: firebird(connectionString()) };

function request(isolationLevel: ConnectionRequest['isolationLevel'] = 'RepeatableRead'): ConnectionRequest {
  return {
    database: {} as ConnectionRequest['database'],
    alias: 'SAMPLES',
    connectionString: '',
    providerFactory: 'FirebirdSql.Data.FirebirdClient',
    engineSqlite: false,
    dbParam: () => '',
    isolationLevel,
  };
}

function command(sql: string, parameters: QueryParameter[] = []) {
  return { sql, parameters, dataset: 'T' };
}

function param(name: string, valueType: QueryParameter['valueType'], value: DataValue): QueryParameter {
  const dbType: Record<string, QueryParameter['dbType']> = {
    Null: 'Object', DBNull: 'Object', Boolean: 'Boolean', Byte: 'Byte', Char: 'SByte', Int32: 'Int32', Int64: 'Int64',
    Decimal: 'Decimal', Double: 'Double', DateTime: 'DateTime', String: 'String', Binary: 'Binary', Object: 'Object',
  };
  return { name, value, valueType, dbType: dbType[valueType]! };
}

function errorOf(p: Promise<unknown>): Promise<{ type: string; message: string } | null> {
  return p.then(
    () => null,
    (e: unknown) => ({ type: (e as { netType?: string }).netType ?? (e as Error).name, message: (e as Error).message }),
  );
}

// ---------------------------------------------------------------------------------------------

const { reports, queries } = cases();

describe.skipIf(!reachable)('report parity with golden-cs on Firebird', () => {
  describe.each(reports)('$name', (c) => {
    const reportFile = path.resolve(here, c.report);
    const errorFile = path.join(runFixtures, c.name + '.error.json');
    if (c.knownDifference !== undefined) {
      const known = c.knownDifference;
      it(`C# runs it, the TypeScript engine fails (${known.tsError})`, async () => {
        expect(fs.existsSync(path.join(runFixtures, c.name + '.meta.json'))).toBe(true);
        const error = await errorOf(runLikeGolden(reportFile, createDataHost({ connections }), { params: c.params, culture: c.culture }));
        expect(error?.message).toContain(known.tsError);
      });
      return;
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

    const sameMetafile = (meta: Parameters<typeof metaFileJson>[0]): void => {
      const ts = metaFileJson(meta) as typeof csJson;
      const { pages: tsPages, ...tsHead } = ts;
      const { pages: csPages, ...csHead } = csJson;
      expect(tsHead).toEqual(csHead);
      expect(tsPages.length).toBe(csPages.length);
      for (let i = 0; i < csPages.length; i++) {
        const { objects: tsObjects, ...tsPage } = tsPages[i]! as { objects: unknown[] };
        const { objects: csObjects, ...csPage } = csPages[i]! as { objects: unknown[] };
        expect(tsPage, `page ${i + 1}`).toEqual(csPage);
        const n = Math.max(tsObjects.length, csObjects.length);
        for (let j = 0; j < n; j++) expect(tsObjects[j], `page ${i + 1} object ${j}`).toEqual(csObjects[j]);
      }
    };
    const samePdf = (pdf: Uint8Array): void => {
      if (Buffer.compare(Buffer.from(pdf), Buffer.from(csPdf)) !== 0) {
        fs.writeFileSync(path.join(os.tmpdir(), 'rm-firebird-' + c.name + '.ts.pdf'), pdf);
      }
      expect(Buffer.compare(Buffer.from(pdf), Buffer.from(csPdf))).toBe(0);
    };

    // (the PDF of these pages is compared through openReport below: the PDF device that measured
    // the images draws them there)
    it('lays out the same metafile run as golden-cs runs it', async () => {
      const { run, meta, noData } = await runLikeGolden(reportFile, createDataHost({ connections }), {
        params: c.params,
        culture: c.culture,
        now,
      });
      try {
        expect(noData).toBe(false);
        sameMetafile(meta);
      } finally {
        await run.close();
      }
    });

    it('gives the same metafile and PDF bytes through openReport', async () => {
      const options = { connections, clock, culture: c.culture };
      const metaReport = await openReport(reportFile, options);
      sameMetafile(await metaReport.executeToMetafile(c.params ?? {}));
      const report = await openReport(reportFile, options);
      samePdf(await report.executeToPdf(c.params ?? {}, { compressed: false }));
    });
  });

  it('runs the SQL of a sample with :NAME placeholders, which FirebirdClient leaves to the server', async () => {
    // invoices.rep keeps its Delphi placeholders (:FIRST_ORDER): C# fails on them ("Column unknown
    // FIRST_ORDER"); the driver binds them as the @FIRST_ORDER of the adapted copy
    const csPdf = new Uint8Array(fs.readFileSync(path.join(runFixtures, 'invoices-range.cs.pdf')));
    const report = await openReport(path.resolve(here, '../../../../samples/invoices.rep'), { connections, clock: pdfCreation(csPdf).clock });
    const pdf = await report.executeToPdf({ FIRST_ORDER: 7, LAST_ORDER: 9 }, { compressed: false });
    expect(Buffer.compare(Buffer.from(pdf), Buffer.from(csPdf))).toBe(0);
  });
});

// ---------------------------------------------------------------------------------------------

/** A golden-cs cell ("Int32:1", "12.34", an ISO date, base64) against a value of the driver. */
function expectCell(dataType: string, golden: unknown, mine: DataValue, where: string): void {
  if (golden === null) {
    expect(mine, where).toBeNull();
    return;
  }
  const g = golden as string;
  const typed = (prefix: string): string => {
    expect(g.startsWith(prefix + ':'), where + ' ' + g).toBe(true);
    return g.substring(prefix.length + 1);
  };
  switch (dataType) {
    case 'Decimal':
      expect(mine, where).toBeInstanceOf(CsDecimal);
      expect((mine as CsDecimal).toInvariantString(), where).toBe(g);
      return;
    case 'DateTime':
      expect(mine, where).toBeInstanceOf(RpDateTime);
      expect((mine as RpDateTime).toString(), where).toBe(g);
      return;
    case 'Byte[]':
      expect(Buffer.from(mine as Uint8Array).toString('base64'), where).toBe(g);
      return;
    case 'String':
      // a CHAR or VARCHAR of OCTETS: FirebirdClient says String and reads a byte[]
      if (mine instanceof Uint8Array) expect(Buffer.from(mine).toString('base64'), where).toBe(g);
      // (golden-cs wrote its JSON as UTF-8: a lone surrogate became U+FFFD there)
      else expect(Buffer.from(mine as string, 'utf8').toString('utf8'), where).toBe(typed('String'));
      return;
    case 'Single':
      expect(mine, where).toBe(Math.fround(Number.parseFloat(typed('Single'))));
      return;
    case 'Double': {
      const v = Number.parseFloat(typed('Double'));
      if (Number.isNaN(v)) expect(Number.isNaN(mine as number), where).toBe(true);
      else expect(mine, where).toBe(v);
      return;
    }
    case 'Int16':
    case 'Int32':
      expect(mine, where).toBe(Number(typed(dataType)));
      return;
    case 'Int64':
    case 'BigInteger':
      expect(mine, where).toBe(BigInt(typed(dataType)));
      return;
    case 'Boolean':
      expect(mine, where).toBe(typed('Boolean') === 'True');
      return;
    default:
      // Guid, TimeSpan, FbZonedTime, FbZonedDateTime, FbDecFloat: their text
      expect(mine, where).toBe(typed(dataType));
  }
}

describe.skipIf(!reachable)('the values FirebirdClient reads (golden-cs sql)', () => {
  let connection: DataConnection;
  beforeAll(async () => {
    connection = await connections.SAMPLES(request());
  });
  afterAll(async () => {
    await connection?.close(true);
  });

  it.each(queries)('$name', async (q) => {
    const golden = JSON.parse(fs.readFileSync(path.join(sqlFixtures, q.name + '.json'), 'utf8')) as {
      columns?: { columnName: string; dataType: string; columnSize: number | null; dataTypeName: string | null }[];
      rows?: unknown[][];
      error?: string;
      message?: string;
    };
    if (q.name === 'int128-beyond-int64') {
      // FirebirdClient reads the BigInteger; the C# engine fails when it prints it
      // (Variant.AssignFromObject: Convert.ToInt64 of its text). The driver fails when it reads it.
      expect(golden.columns![0]!.dataType).toBe('BigInteger');
      const error = await errorOf(Promise.resolve(connection.query(command(q.sql))));
      expect(error).toEqual({ type: 'OverflowException', message: 'Value was either too large or too small for an Int64.' });
      return;
    }
    const result = connection.query(command(q.sql));
    if (golden.error !== undefined) {
      const error = await errorOf(Promise.resolve(result));
      expect(error).toEqual({ type: golden.error, message: golden.message });
      return;
    }
    const r: QueryResult = await result;
    expect(r.columns.map((c) => ({ columnName: c.name, dataType: (c as FirebirdColumnInfo).netType, columnSize: c.size ?? null, dataTypeName: null }))).toEqual(
      golden.columns,
    );
    expect(r.rows.length).toBe(golden.rows!.length);
    golden.rows!.forEach((row, i) =>
      row.forEach((cell, j) => expectCell(golden.columns![j]!.dataType, cell, r.rows[i]![j]!, `${golden.columns![j]!.columnName} row ${i + 1}`)),
    );
  });

  it('gives the engine column types of the .NET types', async () => {
    const r = await connection.query(command('SELECT * FROM TYPES ORDER BY ID'));
    const types = Object.fromEntries(r.columns.map((c) => [c.name, c.type]));
    expect(types).toMatchObject({
      T_SMALLINT: 'Int16', T_INTEGER: 'Int32', T_BIGINT: 'Int64', T_INT128: 'Int64', T_NUM4_2: 'Decimal',
      T_DEC38_6: 'Decimal', T_FLOAT: 'Single', T_DOUBLE: 'Double', T_DECF16: 'Object', T_CHAR: 'String',
      T_OCTETS: 'String', T_GUID: 'Object', T_BLOB_TEXT: 'String', T_BLOB_BIN: 'Binary', T_DATE: 'DateTime',
      T_TIME: 'Object', T_TIMESTAMP: 'DateTime', T_TIME_TZ: 'Object', T_TIMESTAMP_TZ: 'Object', T_BOOLEAN: 'Boolean',
    });
  });

  it('prints a TIMESTAMP WITH TIME ZONE in the culture it is given', async () => {
    const es = await firebird({ connectionString: connectionString(), culture: 'es-ES' })(request());
    try {
      const r = await es.query(command('SELECT T_TIMESTAMP_TZ FROM TYPES WHERE ID = 1'));
      // golden-cs sql ... --culture es-ES: FbZonedDateTime:1/7/2024 14:00:00 America/New_York
      expect(r.rows[0]![0]).toBe('1/7/2024 14:00:00 America/New_York');
    } finally {
      await es.close(true);
    }
  });
});

// ---------------------------------------------------------------------------------------------

describe.skipIf(!reachable)('parameters as FirebirdClient sends them', () => {
  let connection: DataConnection;
  beforeAll(async () => {
    connection = await connections.SAMPLES(request());
  });
  afterAll(async () => {
    await connection?.close(true);
  });

  /** The value a placeholder of `type` receives for the parameter. */
  async function roundTrip(type: string, p: QueryParameter): Promise<DataValue> {
    const r = await connection.query(command(`SELECT CAST(@P AS ${type}) AS V FROM RDB$DATABASE`, [{ ...p, name: 'P' }]));
    return r.rows[0]![0]!;
  }

  it('binds every engine value type', async () => {
    expect(await roundTrip('INTEGER', param('P', 'Int32', 42))).toBe(42);
    expect(await roundTrip('INTEGER', param('P', 'Byte', 200))).toBe(200);
    expect(await roundTrip('BIGINT', param('P', 'Int64', 9223372036854775807n))).toBe(9223372036854775807n);
    expect(await roundTrip('INTEGER', param('P', 'Boolean', true))).toBe(1);
    expect(await roundTrip('INTEGER', param('P', 'Char', 'A'))).toBe(65);
    expect(await roundTrip('BOOLEAN', param('P', 'Boolean', false))).toBe(false);
    expect(await roundTrip('BOOLEAN', param('P', 'String', ' true '))).toBe(true);
    expect(await roundTrip('DOUBLE PRECISION', param('P', 'Double', 0.1))).toBe(0.1);
    expect(await roundTrip('FLOAT', param('P', 'Double', 0.1))).toBe(Math.fround(0.1));
    expect(await roundTrip('DOUBLE PRECISION', param('P', 'String', '1.5e3'))).toBe(1500);
    expect(await roundTrip('DOUBLE PRECISION', param('P', 'Double', 1e300))).toBe(1e300);
    expect(await roundTrip('FLOAT', param('P', 'Double', 3.4028234663852886e38))).toBe(3.4028234663852886e38);
    expect(await roundTrip('DOUBLE PRECISION', param('P', 'Int64', -9007199254740993n))).toBe(-9007199254740992);
    expect(await roundTrip('VARCHAR(30)', param('P', 'String', 'ñandú 日本'))).toBe('ñandú 日本');
    expect(await roundTrip('VARCHAR(30)', param('P', 'Int32', -7))).toBe('-7');
    expect(await roundTrip('VARCHAR(30)', param('P', 'Boolean', true))).toBe('True');
    expect(await roundTrip('VARCHAR(30)', param('P', 'Double', 1.5))).toBe('1.5');
    expect(await roundTrip('VARCHAR(30)', param('P', 'Decimal', CsDecimal.parseInvariant('12.50')))).toBe('12.50');
    expect(await roundTrip('VARCHAR(30)', param('P', 'DateTime', RpDateTime.create(2024, 2, 29, 13, 5, 9)))).toBe('2/29/2024 1:05:09 PM');
    expect(await roundTrip('VARCHAR(30)', param('P', 'Binary', new TextEncoder().encode('bytes')))).toBe('bytes');
    expect(await roundTrip('INTEGER', param('P', 'DBNull', null))).toBeNull();
    // C# null: FbParameter.Value = null is DBNull
    expect(await roundTrip('INTEGER', param('P', 'Null', undefined))).toBeNull();
  });

  it('truncates a decimal to the scale of its placeholder (TypeEncoder.EncodeDecimal)', async () => {
    const n = await roundTrip('NUMERIC(10,2)', param('P', 'Decimal', CsDecimal.parseInvariant('1.239')));
    expect((n as CsDecimal).toInvariantString()).toBe('1.23');
    const m = await roundTrip('NUMERIC(10,2)', param('P', 'Double', -2.999));
    expect((m as CsDecimal).toInvariantString()).toBe('-2.99');
    const s = await roundTrip('NUMERIC(4,1)', param('P', 'String', '123.45'));
    expect((s as CsDecimal).toInvariantString()).toBe('123.4');
    const big = await roundTrip('NUMERIC(38,4)', param('P', 'Decimal', CsDecimal.parseInvariant('-79228162514264337593543.9503')));
    expect((big as CsDecimal).toInvariantString()).toBe('-79228162514264337593543.9503');
  });

  it('rounds a double half to even for an integer placeholder (Convert.ToInt32)', async () => {
    expect(await roundTrip('INTEGER', param('P', 'Double', 2.5))).toBe(2);
    expect(await roundTrip('INTEGER', param('P', 'Double', 3.5))).toBe(4);
    expect(await roundTrip('SMALLINT', param('P', 'Decimal', CsDecimal.parseInvariant('-4.5')))).toBe(-4);
  });

  it('sends dates and times with the 1/10000 s of Firebird', async () => {
    const d = RpDateTime.fromTicks(RpDateTime.create(2024, 2, 29, 23, 59, 59).ticks + 9_999_999n);
    expect((await roundTrip('TIMESTAMP', param('P', 'DateTime', d)) as RpDateTime).toString()).toBe('2024-02-29T23:59:59.9999000');
    expect((await roundTrip('DATE', param('P', 'DateTime', d)) as RpDateTime).toString()).toBe('2024-02-29T00:00:00.0000000');
    expect(await roundTrip('TIME', param('P', 'DateTime', d))).toBe('23:59:59.9999000');
    expect((await roundTrip('DATE', param('P', 'String', '3/1/2024')) as RpDateTime).toString()).toBe('2024-03-01T00:00:00.0000000');
    expect((await roundTrip('DATE', param('P', 'DateTime', RpDateTime.create(1, 1, 1))) as RpDateTime).toString()).toBe('0001-01-01T00:00:00.0000000');
  });

  it('writes text and binary blobs', async () => {
    expect(await roundTrip('BLOB SUB_TYPE TEXT', param('P', 'String', 'long text ü'))).toBe('long text ü');
    const bytes = new Uint8Array([0, 1, 2, 255]);
    expect(await roundTrip('BLOB SUB_TYPE BINARY', param('P', 'Binary', bytes))).toEqual(bytes);
    expect(await roundTrip('CHAR(16) CHARACTER SET OCTETS', param('P', 'Binary', new Uint8Array(16).fill(0xab)))).toBe(
      'abababab-abab-abab-abab-abababababab',
    );
    const binary = await connection.query(command('SELECT T_ID FROM (SELECT 1 AS T_ID FROM RDB$DATABASE) WHERE CAST(@B AS VARBINARY(4)) = X\'01020304\'', [param('B', 'Binary', new Uint8Array([1, 2, 3, 4]))]));
    expect(binary.rows.length).toBe(1);
  });

  it('tells a null from a value for a placeholder of no type (? IS NULL)', async () => {
    const isNull = async (p: QueryParameter) =>
      (await connection.query(command('SELECT 1 AS X FROM RDB$DATABASE WHERE @P IS NULL', [p]))).rows.length;
    expect(await isNull(param('P', 'DBNull', null))).toBe(1);
    expect(await isNull(param('P', 'Int32', 1))).toBe(0);
    expect(await isNull(param('P', 'String', ''))).toBe(0);
  });

  it('fails as FirebirdClient fails on a value it cannot convert', async () => {
    const fail = (type: string, p: QueryParameter) => errorOf(roundTrip(type, p));
    expect(await fail('INTEGER', param('P', 'String', 'False'))).toEqual({ type: 'FormatException', message: "The input string 'False' was not in a correct format." });
    expect(await fail('SMALLINT', param('P', 'Int32', 40000))).toEqual({ type: 'OverflowException', message: 'Value was either too large or too small for an Int16.' });
    expect(await fail('INTEGER', param('P', 'DateTime', RpDateTime.create(2024, 1, 1)))).toEqual({ type: 'InvalidCastException', message: "Invalid cast from 'DateTime' to 'Int32'." });
    expect(await fail('DATE', param('P', 'Int32', 1))).toEqual({ type: 'InvalidCastException', message: "Invalid cast from 'Int32' to 'DateTime'." });
    expect(await fail('DECIMAL(9,2)', param('P', 'Char', 'x'))).toEqual({ type: 'InvalidCastException', message: "Invalid cast from 'Char' to 'Decimal'." });
    expect(await fail('BLOB SUB_TYPE BINARY', param('P', 'String', 'x'))).toEqual({
      type: 'InvalidCastException',
      message: "Unable to cast object of type 'System.String' to type 'System.Byte[]'.",
    });
    expect(await fail('VARCHAR(3)', param('P', 'String', 'abcd'))).toEqual({
      type: 'FbException',
      message: 'arithmetic exception, numeric overflow, or string truncation\nstring right truncation',
    });
    expect(await fail('TIMESTAMP WITH TIME ZONE', param('P', 'DateTime', RpDateTime.create(2024, 1, 1)))).toEqual({
      type: 'InvalidOperationException',
      message: 'Incorrect time zone value.',
    });
    expect(await fail('DECFLOAT(16)', param('P', 'Decimal', CsDecimal.one))).toEqual({
      type: 'InvalidCastException',
      message: "Unable to cast object of type 'System.Decimal' to type 'FirebirdSql.Data.Types.FbDecFloat'.",
    });
    expect(await fail('INT128', param('P', 'Decimal', CsDecimal.one))).toEqual({
      type: 'InvalidCastException',
      message: "Unable to cast object of type 'System.Decimal' to type 'System.Numerics.BigInteger'.",
    });
    expect(await fail('CHAR(16) CHARACTER SET OCTETS', param('P', 'String', 'x'))).toEqual({ type: 'InvalidOperationException', message: 'Incorrect Guid value.' });
  });

  it('binds parameters by name as FirebirdClient: @NAME, case-insensitive, repeated', async () => {
    const r = await connection.query(
      command('SELECT CAST(@a AS INTEGER) + CAST(@A AS INTEGER) AS S, \'@A\' AS LIT FROM RDB$DATABASE', [param('A', 'Int32', 20)]),
    );
    expect(r.rows[0]).toEqual([40n, '@A']);
    expect(await errorOf(Promise.resolve(connection.query(command('SELECT CAST(@X AS INTEGER) FROM RDB$DATABASE', [param('Y', 'Int32', 1)]))))).toEqual({
      type: 'FbException',
      message: "Must declare the variable '@X'.",
    });
    expect(await errorOf(Promise.resolve(connection.query(command('SELECT CAST(@X AS INTEGER) FROM RDB$DATABASE'))))).toEqual({
      type: 'FbException',
      message: 'Must declare command parameters.',
    });
    // :NAME of a parameter is a placeholder too; a PSQL variable is not
    const block = await connection.query(
      command('EXECUTE BLOCK (P INTEGER = :P) RETURNS (R INTEGER) AS DECLARE X INTEGER; BEGIN X = :P * 2; R = :X; SUSPEND; END', [param('P', 'Int32', 21)]),
    );
    expect(block.rows).toEqual([[42]]);
  });
});

// ---------------------------------------------------------------------------------------------

describe.skipIf(!reachable)('transactions and connections', () => {
  it('begins the implicit transaction with the isolation level of the report connection', async () => {
    const isolation = 'SELECT RDB$GET_CONTEXT(\'SYSTEM\', \'ISOLATION_LEVEL\') AS I FROM RDB$DATABASE';
    const levels: [ConnectionRequest['isolationLevel'], string][] = [
      ['RepeatableRead', 'SNAPSHOT'],
      ['Snapshot', 'SNAPSHOT'],
      ['Serializable', 'CONSISTENCY'],
      ['ReadCommitted', 'READ COMMITTED'],
      ['Unspecified', 'READ COMMITTED'],
    ];
    for (const [level, expected] of levels) {
      const c = await connections.SAMPLES(request(level));
      try {
        expect((await c.query(command(isolation))).rows[0]![0], level).toBe(expected);
      } finally {
        await c.close(true);
      }
    }
  });

  it('commits on close(true) and rolls back on close(false)', async () => {
    const setup = await connections.SAMPLES(request());
    await setup.query(command("EXECUTE BLOCK AS BEGIN IF (NOT EXISTS (SELECT 1 FROM RDB$RELATIONS WHERE RDB$RELATION_NAME = 'RM_TX')) THEN EXECUTE STATEMENT 'CREATE TABLE RM_TX (V INTEGER)'; END"));
    await setup.close(true);
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

  it('reports a wrong password with the FirebirdClient message', async () => {
    const wrong = firebird({ connectionString: connectionString(), password: 'not-the-password' });
    expect(await errorOf(Promise.resolve(wrong(request())))).toEqual({
      type: 'FbException',
      message: 'Your user name and password are not defined. Ask your database administrator to set up a Firebird login.',
    });
  });

  it('refuses an ARRAY column with a clear error', async () => {
    const c = await connections.SAMPLES(request());
    try {
      expect(await errorOf(Promise.resolve(c.query(command('SELECT ID, A FROM ARRAYS'))))).toEqual({
        type: 'NotSupportedException',
        message: 'The column A is a Firebird ARRAY: the Firebird driver of Report Manager does not read arrays',
      });
      // the connection goes on
      expect((await c.query(command('SELECT ID FROM ARRAYS'))).rows).toEqual([[1]]);
    } finally {
      await c.close(true);
    }
  });

  it('reads an EXECUTE PROCEDURE and a statement without rows', async () => {
    const c = await connections.SAMPLES(request());
    try {
      const empty = await c.query(command('UPDATE CUSTOMERS SET CITY = CITY WHERE 1 = 0'));
      expect(empty).toEqual({ columns: [], rows: [] });
      const proc = await c.query(command("EXECUTE BLOCK RETURNS (A VARCHAR(5), B NUMERIC(9,2)) AS BEGIN A = 'x'; B = 1.5; SUSPEND; END"));
      expect(proc.rows.length).toBe(1);
      expect(proc.rows[0]![0]).toBe('x');
    } finally {
      await c.close(false);
    }
  });
});

describe.skipIf(reachable)('without the test server', () => {
  it('skips the database tests', () => {
    expect(reachable).toBe(false);
    expect(CultureInfo.invariant).toBeDefined();
  });
});
