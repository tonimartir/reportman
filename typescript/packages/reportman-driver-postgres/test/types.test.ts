// What reaches the engine for every PostgreSQL type, against what Npgsql gives the C# engine
// (golden-cs sql over the all_types table, fixtures/all_types*.sql.json): the column name, its
// DataTypeName and ColumnSize, the column type of the DataTable, and each value as
// Variant.AssignFromObject takes it.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  CsDecimal,
  DateTimeKind,
  RpDateTime,
  toBase64String,
  type ConnectionRequest,
  type DataColumnType,
  type DataValue,
  type QueryResult,
} from '@reportman/engine';
import { postgres } from '../src/index.js';
import { loadFixture, serverAvailable, testConfig } from './fixture.ts';

const here = path.dirname(fileURLToPath(import.meta.url));
const available = await serverAvailable();
if (available) await loadFixture();

interface GoldenSql {
  columns: { columnName: string; dataType: string | null; columnSize: number; dataTypeName: string }[];
  rows: (string | null)[][];
}

export const request: ConnectionRequest = {
  database: {} as ConnectionRequest['database'],
  alias: 'SAMPLES',
  connectionString: '',
  providerFactory: 'PostgreSQL',
  engineSqlite: false,
  dbParam: () => '',
  isolationLevel: 'RepeatableRead',
};

async function run(sql: string, culture?: string): Promise<QueryResult> {
  const connection = await postgres({ ...testConfig(), culture })(request);
  try {
    return await connection.query({ sql, parameters: [], dataset: 'D' });
  } finally {
    await connection.close(true);
  }
}

/** The DataTable column type of the C# engine for the .NET type Npgsql gives (AssignFromObject's slot). */
function engineType(dataType: string | null): DataColumnType {
  switch (dataType) {
    case 'Int16':
    case 'Int32':
    case 'Int64':
    case 'Decimal':
    case 'Single':
    case 'Double':
    case 'String':
    case 'Boolean':
    case 'DateTime':
      return dataType;
    case 'DateOnly':
    case 'TimeOnly':
    case 'DateTimeOffset':
      return 'DateTime';
    case 'Byte[]':
      return 'Binary';
    case 'UInt32':
      return 'Int64';
    case 'UInt64':
      return 'Decimal';
    default:
      return 'Object';
  }
}

const pad = (n: number, w = 2): string => String(n).padStart(w, '0');

/** The base offset of the local zone (as values.ts applies to timetz). */
function baseOffsetMinutes(): number {
  const y = new Date().getFullYear();
  return Math.min(-new Date(y, 0, 1).getTimezoneOffset(), -new Date(y, 6, 1).getTimezoneOffset());
}

/** Checks a value the driver gives against the value golden-cs printed for it. */
function expectValue(value: DataValue, golden: string | null, dataType: string | null, where: string): void {
  if (golden === null) {
    expect(value, where).toBeNull();
    return;
  }
  // golden-cs: "Type:text" (Convert.ToString, invariant), except DateTime, decimal and byte[]
  const text = golden.substring(golden.indexOf(':') + 1);
  switch (dataType) {
    case 'Decimal':
    case 'UInt64':
      expect((value as CsDecimal).toInvariantString(), where).toBe(dataType === 'Decimal' ? golden : text);
      return;
    case 'DateTime':
      expect((value as RpDateTime).toIsoString(), where).toBe(golden);
      return;
    case 'Byte[]':
      expect(toBase64String(value as Uint8Array), where).toBe(golden);
      return;
    case 'DateOnly': {
      const d = value as RpDateTime;
      expect(`${pad(d.month)}/${pad(d.day)}/${pad(d.year, 4)}`, where).toBe(text);
      expect(d.ticksOfSecond + d.hour + d.minute + d.second, where).toBe(0);
      return;
    }
    case 'TimeOnly': {
      const d = value as RpDateTime;
      expect(`${pad(d.hour)}:${pad(d.minute)}`, where).toBe(text);
      expect(d.year * 10000 + d.month * 100 + d.day, where).toBe(10101);
      return;
    }
    case 'DateTimeOffset': {
      // "01/02/0001 13:45:30 +02:00": the engine gets its LocalDateTime
      const m = /^(\d\d)\/(\d\d)\/(\d{4}) (\d\d):(\d\d):(\d\d) ([+-])(\d\d):(\d\d)$/.exec(text)!;
      const offset = (m[7] === '-' ? -1 : 1) * (Number(m[8]) * 60 + Number(m[9]));
      const clock = RpDateTime.create(Number(m[3]), Number(m[1]), Number(m[2]), Number(m[4]), Number(m[5]), Number(m[6]));
      const local = clock.addTicks(BigInt(baseOffsetMinutes() - offset) * 600_000_000n);
      const d = value as RpDateTime;
      expect(d.kind, where).toBe(DateTimeKind.Local);
      expect(d.toIsoString().substring(0, 19), where).toBe(local.toIsoString().substring(0, 19));
      return;
    }
    case 'Int16':
    case 'Int32':
      expect(value, where).toBe(Number(text));
      return;
    case 'Int64':
    case 'UInt32':
      expect(value, where).toBe(BigInt(text));
      return;
    case 'Single':
      expect(Object.is(value, Math.fround(Number(text))), where + ' ' + String(value)).toBe(true);
      return;
    case 'Double':
      expect(Object.is(value, Number(text)), where + ' ' + String(value)).toBe(true);
      return;
    case 'Boolean':
      expect(value, where).toBe(text === 'True');
      return;
    default:
      // bit(1) is a Boolean in an Object column; everything else travels as its text
      if (golden.startsWith('Boolean:')) expect(value, where).toBe(text === 'True');
      else expect(value, where).toBe(text);
  }
}

function compare(goldenFile: string, result: QueryResult): void {
  const golden = JSON.parse(fs.readFileSync(path.join(here, 'fixtures', goldenFile), 'utf8')) as GoldenSql;
  expect(result.columns.length).toBe(golden.columns.length);
  golden.columns.forEach((g, i) => {
    const c = result.columns[i]!;
    expect({ name: c.name, declaredType: c.declaredType, size: c.size, type: c.type }, g.columnName).toEqual({
      name: g.columnName,
      declaredType: g.dataTypeName,
      size: g.columnSize,
      type: engineType(g.dataType),
    });
  });
  expect(result.rows.length).toBe(golden.rows.length);
  golden.rows.forEach((row, r) =>
    row.forEach((g, i) => expectValue(result.rows[r]![i], g, golden.columns[i]!.dataType, `${golden.columns[i]!.columnName} row ${r + 1}`)),
  );
}

describe.skipIf(!available)('every PostgreSQL type as Npgsql gives it to the C# engine', () => {
  it('reads all_types as golden-cs sql reads it (schema and values)', async () => {
    compare('all_types.sql.json', await run('SELECT * FROM all_types ORDER BY id'));
  });

  it('prints ranges with the culture of the run (NpgsqlRange.ToString)', async () => {
    compare('all_types-es.sql.json', await run('SELECT id, c_numrange, c_daterange, c_tsrange, c_tstzrange FROM all_types ORDER BY id', 'es-ES'));
  });

  it('gives each date and time type the DateTimeKind of Npgsql', async () => {
    const r = await run(
      "SELECT timestamp '2024-01-02 03:04:05' AS a, timestamptz '2024-01-02 03:04:05+02' AS b, date '2024-01-02' AS c, time '10:00' AS d, timetz '10:00+02' AS e",
    );
    const kinds = (r.rows[0] as RpDateTime[]).map((d) => d.kind);
    expect(kinds).toEqual([DateTimeKind.Unspecified, DateTimeKind.Utc, DateTimeKind.Unspecified, DateTimeKind.Unspecified, DateTimeKind.Local]);
    expect((r.rows[0]![1] as RpDateTime).toIsoString()).toBe('2024-01-02T01:04:05.0000000');
  });

  it('reads timestamptz in UTC whatever the session time zone', async () => {
    const connection = await postgres({ ...testConfig(), options: '-c TimeZone=Asia/Kolkata' })(request);
    try {
      const r = await connection.query({
        sql: "SELECT timestamptz '2024-01-02 03:04:05+00' AS a, timestamptz '1900-01-01 00:00:00+00' AS b, current_setting('TimeZone') AS z",
        parameters: [],
        dataset: 'D',
      });
      expect((r.rows[0]![0] as RpDateTime).toIsoString()).toBe('2024-01-02T03:04:05.0000000');
      expect((r.rows[0]![1] as RpDateTime).toIsoString()).toBe('1900-01-01T00:00:00.0000000');
      expect(r.rows[0]![2]).toBe('Asia/Kolkata');
    } finally {
      await connection.close(true);
    }
  });
});
