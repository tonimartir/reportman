// The connection of the driver against the test server: the implicit transaction with each
// isolation level of SqlClient, commit and rollback, the checks of SqlCommand, the commands of a
// connection one after another, the failures to connect, the parameters of every engine type as the
// server receives them, and the synchronous connection (a worker thread).

import { describe, expect, it } from 'vitest';
import { CsDecimal, RpDateTime, type DataConnection, type IsolationLevelName, type QueryCommand, type QueryParameter } from 'reportman-engine';
import { MsSqlConnection, SqlException, SyncMsSqlConnection, mssql } from '../src/index.js';
import { NO_SNAPSHOT_DATABASE, connectionString, isReachable, loadDatabase, mssqlTest, request, runBatch } from './database.ts';

const available = await isReachable();
if (available) await loadDatabase();

function command(sql: string, parameters: QueryParameter[] = []): QueryCommand {
  return { sql, parameters, dataset: 'D' };
}

async function open(level: IsolationLevelName = 'RepeatableRead', extra = '', synchronous = false): Promise<DataConnection> {
  return mssql({ connectionString: connectionString(extra), synchronous })(request(level));
}

const ISOLATION = 'SELECT transaction_isolation_level AS L, @@TRANCOUNT AS C FROM sys.dm_exec_sessions WHERE session_id = @@SPID';

describe.skipIf(!available)('the SQL Server connection', () => {
  const levels: [IsolationLevelName, number][] = [
    ['Unspecified', 2],
    ['ReadUncommitted', 1],
    ['ReadCommitted', 2],
    ['RepeatableRead', 3],
    ['Serializable', 4],
    ['Snapshot', 5],
  ];
  for (const [level, code] of levels) {
    it(`begins the implicit transaction with ${level} (as SqlConnection.BeginTransaction)`, async () => {
      const conn = await open(level);
      const r = await conn.query(command(ISOLATION));
      expect(r.rows).toEqual([[code, 1]]);
      await conn.close(true);
    });
  }

  it('fails as the server does when the database does not allow snapshot isolation', async () => {
    const conn = await open('Snapshot', 'Database=' + NO_SNAPSHOT_DATABASE);
    await expect(conn.query(command('SELECT A FROM T'))).rejects.toThrow(
      `Snapshot isolation transaction failed accessing database '${NO_SNAPSHOT_DATABASE}' because snapshot isolation is not allowed in this database.`,
    );
    await Promise.resolve(conn.close(false)).catch(() => undefined);
  });

  it('refuses Chaos as SqlClient does', async () => {
    await expect(open('Chaos')).rejects.toMatchObject({ netType: 'ArgumentOutOfRangeException' });
  });

  it('commits on close(true) and rolls back on close(false)', async () => {
    const v = Math.floor(Math.random() * 1e9);
    for (const commit of [false, true]) {
      const conn = await open();
      await conn.query(command(`INSERT INTO RM_TX (V) VALUES (${v}); SELECT V FROM RM_TX WHERE V = ${v}`));
      await conn.close(commit);
      const rows = await runBatch(`SELECT COUNT(*) AS N FROM RM_TX WHERE V = ${v}`);
      expect(rows[0]!.N).toBe(commit ? 1 : 0);
    }
    await runBatch(`DELETE FROM RM_TX WHERE V = ${v}`);
  });

  it('refuses at once an empty command and a closed connection', async () => {
    const conn = await open();
    expect(() => conn.query(command(''))).toThrow('ExecuteReader: CommandText property has not been initialized');
    await conn.close(true);
    expect(() => conn.query(command('SELECT 1 AS A'))).toThrow(/requires an open and available Connection/);
  });

  it('runs the commands of a connection one after another', async () => {
    const conn = (await open()) as MsSqlConnection;
    const [a, b, c] = await Promise.all([
      conn.query(command("SELECT 1 AS A WAITFOR DELAY '00:00:00.200'")),
      conn.query(command('SELECT 2 AS B')),
      conn.query(command('SELECT 1/0 AS C')).catch((e: unknown) => e),
    ]);
    expect(a.rows).toEqual([[1]]);
    expect(b.rows).toEqual([[2]]);
    expect(c).toBeInstanceOf(SqlException);
    expect((c as SqlException).number).toBe(8134);
    await conn.close(true);
  });

  it('fails to connect as SqlClient does', async () => {
    await expect(mssql(`Server=127.0.0.1,1;User ID=sa;Password=x;Connect Timeout=5;TrustServerCertificate=True`)(request())).rejects.toThrow(
      /^A network-related or instance-specific error occurred while establishing a connection to SQL Server\./,
    );
    await expect(open('RepeatableRead', 'Password=wrong')).rejects.toMatchObject({ netType: 'SqlException', message: "Login failed for user 'sa'.", number: 18456 });
  });

  it('sends the parameters of every engine type as SqlClient (the server sees their type and value)', async () => {
    const conn = (await open()) as MsSqlConnection;
    const params: QueryParameter[] = [
      { name: 'PBOOL', value: true, valueType: 'Boolean', dbType: 'Boolean' },
      { name: 'PBYTE', value: 200, valueType: 'Byte', dbType: 'Byte' },
      { name: 'PINT', value: -7, valueType: 'Int32', dbType: 'Int32' },
      { name: 'PLONG', value: 9007199254740993n, valueType: 'Int64', dbType: 'Int64' },
      { name: 'PDEC', value: CsDecimal.fromParts(79228162514264337593543950335n, 28, true), valueType: 'Decimal', dbType: 'Decimal' },
      { name: 'PDBL', value: 0.1, valueType: 'Double', dbType: 'Double' },
      { name: 'PDT', value: RpDateTime.create(2024, 2, 29, 13, 45, 30, 998), valueType: 'DateTime', dbType: 'DateTime' },
      { name: 'PSTR', value: 'ñandú 😀', valueType: 'String', dbType: 'String' },
      { name: 'PLONGSTR', value: 'é'.repeat(5000), valueType: 'String', dbType: 'String' },
      { name: 'PBIN', value: new Uint8Array([0, 1, 255]), valueType: 'Binary', dbType: 'Binary' },
      { name: 'PLONGBIN', value: new Uint8Array(9000).fill(7), valueType: 'Binary', dbType: 'Binary' },
      { name: 'PVAR', value: CsDecimal.fromParts(125n, 2, false), valueType: 'Decimal', dbType: 'Object' },
      { name: 'PVARNULL', value: null, valueType: 'DBNull', dbType: 'Object' },
    ];
    const r = await conn.queryTyped(
      command(
        'SELECT @PBOOL AS B, @PBYTE AS Y, @PINT AS I, @PLONG AS L, @PDEC AS D, @PDBL AS F, @PDT AS T, @PSTR AS S, LEN(@PLONGSTR) AS SL, ' +
          "@PBIN AS X, DATALENGTH(@PLONGBIN) AS XL, @PVAR AS V, SQL_VARIANT_PROPERTY(@PVAR, 'BaseType') AS VT, SQL_VARIANT_PROPERTY(@PVAR, 'Precision') AS VP, @PVARNULL AS VN",
        params,
      ),
    );
    expect(r.columns.map((c) => c.declaredType)).toEqual([
      'bit',
      'tinyint',
      'int',
      'bigint',
      'decimal',
      'float',
      'datetime',
      'nvarchar',
      'bigint',
      'varbinary',
      'bigint',
      'sql_variant',
      'sql_variant',
      'sql_variant',
      'sql_variant',
    ]);
    const v = r.rows[0]!.map((c) => (c === null ? null : c.value));
    expect(v.slice(0, 4)).toEqual([true, 200, -7, 9007199254740993n]);
    expect((v[4] as CsDecimal).toInvariantString()).toBe('-7.9228162514264337593543950335');
    expect(v[5]).toBe(0.1);
    // datetime keeps 1/300 s: .998 is .997
    expect((v[6] as RpDateTime).toIsoString()).toBe('2024-02-29T13:45:30.9970000');
    expect(v.slice(7, 9)).toEqual(['ñandú 😀', 5000n]);
    expect(Array.from(v[9] as Uint8Array)).toEqual([0, 1, 255]);
    expect(v[10]).toBe(9000n);
    expect((v[11] as CsDecimal).toInvariantString()).toBe('1.25');
    expect(v.slice(12)).toEqual(['numeric', 38, null]);
    await conn.close(true);
  });

  it('runs synchronously in a worker thread', async () => {
    const conn = (await open('Serializable', '', true)) as SyncMsSqlConnection;
    expect(conn).toBeInstanceOf(SyncMsSqlConnection);
    const r = conn.query(command(ISOLATION));
    expect(r.rows).toEqual([[4, 1]]);
    const typed = conn.queryTyped(command('SELECT CAST(1.50 AS DECIMAL(5,2)) AS D, CAST(@P AS DATETIME2) AS T', [{ name: 'P', value: RpDateTime.create(2024, 1, 2), valueType: 'DateTime', dbType: 'DateTime' }]));
    expect((typed.rows[0]![0]!.value as CsDecimal).toInvariantString()).toBe('1.50');
    expect((typed.rows[0]![1]!.value as RpDateTime).toIsoString()).toBe('2024-01-02T00:00:00.0000000');
    expect(() => conn.query(command('SELECT 1/0 AS A'))).toThrow(SqlException);
    conn.close(true);
    expect(() => mssql({ connectionString: connectionString('Password=wrong'), synchronous: true })(request())).toThrow("Login failed for user 'sa'.");
  });

  it('reads a server that is the one of the tests', () => {
    expect(mssqlTest.port).toBeGreaterThan(0);
  });
});
