// What reaches the engine for every type, compared with what SqlClient gives the C# engine
// (golden-cs sql, fixtures/sql): the columns (ColumnName, DataType, ColumnSize, DataTypeName), the
// .NET type and value of every cell, and the errors of the queries and connection strings that fail.

import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { CsDecimal, RpDateTime } from 'reportman-engine';
import { MsSqlConnection, mssql, type NetCell } from '../src/index.js';
import { QUERIES, fixtures } from './cases.ts';
import { connectionString, isReachable, loadDatabase, request } from './database.ts';
import type { GoldenSql } from './golden.ts';

const available = await isReachable();
if (available) await loadDatabase();

/** The text golden-cs writes for a cell of SqlDataReader.GetValue. */
function goldenText(cell: NetCell): string {
  const v = cell.value;
  if (cell.type === 'Decimal') return (v as CsDecimal).toInvariantString();
  if (cell.type === 'DateTime') return (v as RpDateTime).toIsoString();
  if (cell.type === 'Byte[]') return Buffer.from(v as Uint8Array).toString('base64');
  if (cell.type === 'DateTimeOffset') return 'DateTimeOffset:' + cell.invariantText!;
  if (cell.type === 'Boolean') return 'Boolean:' + (v ? 'True' : 'False');
  if (cell.type === 'Single') return 'Single:' + String(v);
  return cell.type + ':' + String(v);
}

function expectCell(golden: unknown, mine: NetCell | null, where: string): void {
  if (golden === null) {
    expect(mine, where).toBeNull();
    return;
  }
  expect(mine, where).not.toBeNull();
  const g = golden as string;
  if (mine!.type === 'Double' || mine!.type === 'Single') {
    // the shortest text of .NET and of JavaScript differ ("1.1" and 1.100000023841858): the value is compared
    const [type, text] = [g.substring(0, g.indexOf(':')), g.substring(g.indexOf(':') + 1)];
    expect(mine!.type, where).toBe(type);
    const expected = mine!.type === 'Single' ? Math.fround(Number.parseFloat(text)) : Number.parseFloat(text);
    expect(mine!.value, where).toBe(expected);
    return;
  }
  expect(goldenText(mine!), where).toBe(g);
}

/** The part of a message that does not come from the operating system (its language). */
function withoutOsText(message: string): string {
  return message.replace(/(error: 0 - ).*$/s, '$1').replace(/('\.) .*$/s, '$1');
}

describe.skipIf(!available)('the values of SQL Server as SqlClient gives them (golden-cs sql)', () => {
  for (const q of QUERIES) {
    const golden = JSON.parse(fs.readFileSync(path.join(fixtures, 'sql', q.name + '.json'), 'utf8')) as GoldenSql;
    it(q.name, async () => {
      let conn: MsSqlConnection | undefined;
      try {
        conn = (await mssql({ connectionString: connectionString(q.options ?? ''), culture: q.culture })(request())) as MsSqlConnection;
        const result = await conn.queryTyped({ sql: q.sql, parameters: [], dataset: 'D' });
        if (golden.error === 'NullReferenceException') {
          // golden-cs reads GetSchemaTable, null for a command without a result set: no columns
          expect(result.columns).toEqual([]);
          return;
        }
        expect(golden.error, golden.message).toBeUndefined();
        expect(result.columns.map((c) => [c.name, c.netType, c.size, c.declaredType])).toEqual(
          golden.columns!.map((c) => [c.columnName, c.dataType === 'Byte[]' ? 'Byte[]' : c.dataType, c.columnSize, c.dataTypeName]),
        );
        expect(result.rows.length).toBe(golden.rows!.length);
        for (let r = 0; r < golden.rows!.length; r++) {
          for (let i = 0; i < golden.columns!.length; i++) expectCell(golden.rows![r]![i], result.rows[r]![i]!, `row ${r} ${golden.columns![i]!.columnName}`);
        }
      } catch (e) {
        if (golden.error === undefined) throw e;
        const err = e as Error & { netType?: string; cause?: Error & { netType?: string } };
        if (golden.error === 'FileNotFoundException') {
          // the C# engine fails on the schema of a CLR type; GetValue fails loading its assembly
          expect(err.netType).toBe('InvalidCastException');
          expect(err.cause?.netType).toBe('FileNotFoundException');
          expect(withoutOsText(err.cause!.message)).toBe(withoutOsText(golden.message!));
          return;
        }
        expect(err.netType ?? err.name).toBe(golden.error);
        expect(withoutOsText(err.message.replace(/\r\n/g, '\n'))).toBe(withoutOsText(golden.message!));
      } finally {
        // a failed query may have rolled the transaction back (the C# engine fails at it before)
        await conn?.close(true).catch(() => undefined);
      }
    });
  }
});
