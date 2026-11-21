// The parts of the driver that need no server: the placeholders FirebirdClient finds, its connection
// strings, the conversions of parameter values, DECFLOAT decoding, and the FirebirdClient form of
// node-firebird errors.

import { describe, expect, it } from 'vitest';
import { CsDecimal, CultureInfo, type QueryParameter, RpDateTime } from 'reportman-engine';
import { parseConnectionString } from '../src/connectionstring.js';
import { isolationTpb } from '../src/connection.js';
import { decFloatText, decodeDec16, decodeDec34 } from '../src/decfloat.js';
import { FbException, fbException, recoverStatus } from '../src/errors.js';
import { bindParameter } from '../src/params.js';
import { parseNamedParameters } from '../src/sql.js';
import { charsetByName, SqlType } from '../src/types.js';
import { timeSpanText } from '../src/values.js';
import type { SqlVar } from '../src/wire.js';

describe('placeholders (NamedParametersParser)', () => {
  const none = (): boolean => false;
  it('turns @NAME outside quotes into ?, in order', () => {
    expect(parseNamedParameters("SELECT * FROM T WHERE A = @A AND B = '@B' AND \"@C\" = @a", none)).toEqual({
      sql: "SELECT * FROM T WHERE A = ? AND B = '@B' AND \"@C\" = ?",
      names: ['@A', '@a'],
    });
    expect(parseNamedParameters('SELECT @X$1, @Ñu FROM R', none)).toEqual({ sql: 'SELECT ?, ? FROM R', names: ['@X$1', '@Ñu'] });
  });

  it('keeps the quirks of FirebirdClient: comments are not special, a lone @ is a parameter', () => {
    expect(parseNamedParameters('SELECT 1 -- @A\nFROM R', none)).toEqual({ sql: 'SELECT 1 -- ?\nFROM R', names: ['@A'] });
    expect(parseNamedParameters('SELECT @@X FROM R', none)).toEqual({ sql: 'SELECT ?@X FROM R', names: ['@'] });
    expect(parseNamedParameters("SELECT 'it''s @A' FROM R", none)).toEqual({ sql: "SELECT 'it''s @A' FROM R", names: [] });
  });

  it('takes :NAME of a parameter of the command, and only those', () => {
    const isParam = (n: string): boolean => n.toUpperCase() === 'FROM_ID';
    expect(parseNamedParameters("SELECT * FROM T WHERE ID >= :FROM_ID AND T = '10:30' AND :OTHER = 1", isParam)).toEqual({
      sql: "SELECT * FROM T WHERE ID >= ? AND T = '10:30' AND :OTHER = 1",
      names: ['@FROM_ID'],
    });
    // the body of an EXECUTE BLOCK keeps its PSQL variables
    expect(parseNamedParameters('EXECUTE BLOCK (FROM_ID INT = :from_id) RETURNS (R INT) AS BEGIN R = :FROM_ID; SUSPEND; END', isParam)).toEqual({
      sql: 'EXECUTE BLOCK (FROM_ID INT = ?) RETURNS (R INT) AS BEGIN R = :FROM_ID; SUSPEND; END',
      names: ['@from_id'],
    });
  });
});

describe('connection strings (ConnectionString)', () => {
  it('reads the keys and synonyms of FirebirdClient', () => {
    const s = parseConnectionString("Server=db.local;Port Number=3051;Initial Catalog=/data/a.fdb;UID=REPORTS;PWD=x;Password='p;w';charset=WIN1252;Role=R1;WireCrypt=Disabled;Connection Timeout=5");
    expect(s).toMatchObject({ dataSource: 'db.local', port: 3051, database: '/data/a.fdb', user: 'REPORTS', password: 'p;w', charset: 'WIN1252', role: 'R1', wireCrypt: 'Disabled', connectionTimeout: 5 });
    expect(parseConnectionString('Database=x.fdb')).toMatchObject({ dataSource: '', port: 3050, charset: 'UTF8', dialect: 3, wireCrypt: 'Enabled' });
  });

  it('takes the server and port written in the database', () => {
    expect(parseConnectionString('Database=srv/3052:/data/a.fdb')).toMatchObject({ dataSource: 'srv', port: 3052, database: '/data/a.fdb' });
    expect(parseConnectionString('Database=srv:C:\\data\\a.fdb')).toMatchObject({ dataSource: 'srv', database: 'C:\\data\\a.fdb' });
    expect(parseConnectionString('Database=//srv:3053/employee')).toMatchObject({ dataSource: 'srv', port: 3053, database: 'employee' });
    expect(parseConnectionString('Database=inet:///employee')).toMatchObject({ dataSource: 'localhost', database: 'employee' });
    expect(parseConnectionString('DataSource=other;Database=srv:alias')).toMatchObject({ dataSource: 'srv', database: 'alias' });
    expect(parseConnectionString('Database=C:\\data\\a.fdb')).toMatchObject({ dataSource: '', database: 'C:\\data\\a.fdb' });
  });
});

describe('transactions (FbTransaction.BuildTpb)', () => {
  it('maps the isolation levels', () => {
    expect(isolationTpb('Serializable')).toEqual([1]);
    expect(isolationTpb('RepeatableRead')).toEqual([2]);
    expect(isolationTpb('Snapshot')).toEqual([2]);
    expect(isolationTpb('ReadCommitted')).toEqual([15, 17]);
    expect(isolationTpb('ReadUncommitted')).toEqual([15, 17]);
    expect(isolationTpb('Unspecified')).toEqual([15, 17]);
  });
});

describe('parameter values (DbValue, TypeEncoder)', () => {
  const ctx = { charset: charsetByName('UTF8')!, culture: CultureInfo.get('en-US'), invariant: CultureInfo.invariant };
  const field = (type: number, scale = 0, length = 4, subType = 0): SqlVar =>
    ({ type, scale, length, subType, nullable: true, decode: () => null, calcBlr: () => undefined }) as SqlVar;
  const p = (valueType: QueryParameter['valueType'], value: QueryParameter['value']): QueryParameter => ({ name: 'P', value, valueType, dbType: 'Object' });
  const bind = (v: SqlVar, q: QueryParameter): unknown => bindParameter(q, v, ctx).value;
  const fails = (v: SqlVar, q: QueryParameter): string => {
    try {
      bindParameter(q, v, ctx);
      return 'no error';
    } catch (e) {
      return (e as { netType: string }).netType + ': ' + (e as Error).message;
    }
  };

  it('converts to integers as Convert.ToInt16/32/64', () => {
    const int = field(SqlType.LONG);
    expect(bind(int, p('Double', 2.5))).toBe(2);
    expect(bind(int, p('Double', -2.5))).toBe(-2);
    expect(bind(int, p('Decimal', CsDecimal.parseInvariant('7.5')))).toBe(8);
    expect(bind(int, p('String', ' -12 '))).toBe(-12);
    expect(bind(int, p('Char', 'a'))).toBe(97);
    expect(fails(int, p('String', '1.5'))).toBe("FormatException: The input string '1.5' was not in a correct format.");
    expect(fails(int, p('String', '99999999999'))).toBe('OverflowException: Value was either too large or too small for an Int32.');
    expect(fails(int, p('Double', 3e9))).toBe('OverflowException: Value was either too large or too small for an Int32.');
    expect(fails(int, p('Binary', new Uint8Array(1)))).toBe("InvalidCastException: Unable to cast object of type 'System.Byte[]' to type 'System.IConvertible'.");
    expect(fails(field(SqlType.SHORT, 0, 2), p('Decimal', CsDecimal.parseInvariant('1000000000000')))).toBe('OverflowException: Value was either too large or too small for an Int32.');
    expect(fails(field(SqlType.INT64, 0, 8), p('Double', 1e19))).toBe('OverflowException: Arithmetic operation resulted in an overflow.');
    expect(bind(field(SqlType.INT64, 0, 8), p('Int64', 2n ** 60n))).toBe('1152921504606846976');
  });

  it('scales decimals by truncation for each storage', () => {
    expect(bind(field(SqlType.LONG, -2), p('Decimal', CsDecimal.parseInvariant('-12.349')))).toBe('-12.34');
    expect(bind(field(SqlType.SHORT, -1, 2), p('Int32', 5))).toBe('5.0');
    expect(bind(field(SqlType.INT64, -4, 8), p('String', '0.00005'))).toBe('0.0000');
    expect(bind(field(SqlType.INT128, -6, 16), p('Double', 0.1))).toBe('0.100000');
    expect(fails(field(SqlType.SHORT, -2, 2), p('Int32', 400))).toBe('OverflowException: Value was either too large or too small for an Int16.');
    expect(bindParameter(p('Decimal', CsDecimal.parseInvariant('1.25')), field(SqlType.DOUBLE, -2, 8), ctx)).toEqual({ value: 1.25, asText: false, double: true });
  });

  it('formats a value for a text placeholder with the current culture', () => {
    const text = field(SqlType.VARYING, 0, 80, 4);
    expect(bind(text, p('Double', 1234.5))).toBe('1234.5');
    expect(bindParameter(p('Double', 1234.5), text, { ...ctx, culture: CultureInfo.get('es-ES') }).value).toBe('1234,5');
    expect(bind(text, p('DateTime', RpDateTime.create(2025, 1, 2, 3, 4, 5)))).toBe('1/2/2025 3:04:05 AM');
    expect(fails(field(SqlType.VARYING, 0, 8, 4), p('String', 'abc'))).toBe(
      'FbException: arithmetic exception, numeric overflow, or string truncation\nstring right truncation',
    );
    expect(bind(field(SqlType.VARYING, 0, 8, 4), p('String', 'ab'))).toBe('ab');
  });

  it('sends dates and times as the text the server reads exactly', () => {
    const d = RpDateTime.fromTicks(RpDateTime.create(2024, 12, 31, 7, 8, 9).ticks + 1_234_567n);
    expect(bindParameter(p('DateTime', d), field(SqlType.TIMESTAMP, 0, 8), ctx)).toEqual({ value: '2024-12-31 07:08:09.1234', asText: true });
    expect(bind(field(SqlType.TYPE_DATE), p('DateTime', d))).toBe('2024-12-31');
    expect(bind(field(SqlType.TYPE_TIME), p('DateTime', d))).toBe('07:08:09.1234');
    expect(bind(field(SqlType.TYPE_DATE), p('String', '12/31/2024 10:00'))).toBe('2024-12-31');
    expect(fails(field(SqlType.TYPE_DATE), p('String', 'tomorrow'))).toBe("FormatException: String 'tomorrow' was not recognized as a valid DateTime.");
    expect(fails(field(SqlType.TYPE_DATE), p('Boolean', true))).toBe("InvalidCastException: Invalid cast from 'Boolean' to 'DateTime'.");
  });

  it('sends nulls, and refuses what FirebirdClient refuses', () => {
    expect(bindParameter(p('Null', undefined), field(SqlType.LONG), ctx)).toEqual({ value: null, asText: false });
    expect(bindParameter(p('DBNull', null), field(SqlType.DEC16, 0, 8), ctx)).toEqual({ value: null, asText: false });
    expect(fails(field(SqlType.TIME_TZ, 0, 8), p('String', 'x'))).toBe("FormatException: String 'x' was not recognized as a valid DateTime.");
    expect(fails(field(SqlType.INT128, 0, 16), p('String', '1'))).toBe("InvalidCastException: Unable to cast object of type 'System.String' to type 'System.Numerics.BigInteger'.");
    expect(fails(field(SqlType.BLOB, 0, 8, 1), p('Int32', 1))).toBe("InvalidCastException: Unable to cast object of type 'System.Int32' to type 'System.String'.");
    expect(fails(field(SqlType.TEXT, 0, 16, 1), p('Binary', new Uint8Array(4)))).toBe(
      "ArgumentException: Destination array is not long enough to copy all the items in the collection. Check array index and length. (Parameter 'value')",
    );
  });
});

describe('DECFLOAT (DecimalCodec, FbDecFloat.ToString)', () => {
  const bytes = (hex: string): Uint8Array => new Uint8Array(Buffer.from(hex, 'hex'));
  it('decodes decimal64 and decimal128', () => {
    // 1 (exponent 0), -0, Infinity, NaN, sNaN and 123.45 as decimal64
    expect(decFloatText(decodeDec16(bytes('2238000000000001')))).toBe('1E0');
    expect(decFloatText(decodeDec16(bytes('a238000000000000')))).toBe('-0');
    expect(decFloatText(decodeDec16(bytes('7800000000000000')))).toBe('inf');
    expect(decFloatText(decodeDec16(bytes('fc00000000000000')))).toBe('-nan');
    expect(decFloatText(decodeDec16(bytes('7e00000000000000')))).toBe('snan');
    expect(decFloatText(decodeDec16(bytes('22300000000049c5')))).toBe('12345E-2');
    expect(decFloatText(decodeDec34(bytes('22080000000000000000000000000001')))).toBe('1E0');
  });
});

describe('errors (FbException)', () => {
  it('writes a node-firebird error as FirebirdClient does', () => {
    const e = Object.assign(new Error('Dynamic SQL Error, SQL error code = -204, Table unknown, NOSUCHTABLE, At line 1, column 15'), {
      gdscode: 335544569,
    });
    const fb = fbException(e) as FbException;
    expect(fb).toBeInstanceOf(FbException);
    expect(fb.netType).toBe('FbException');
    expect(fb.message).toBe('Dynamic SQL Error\nSQL error code = -204\nTable unknown\nNOSUCHTABLE\nAt line 1, column 15');
    expect(fb.errors.map((x) => x.code)).toEqual([335544569, 335544436, 335544580, 335544382, 336397208]);
    const conversion = fbException(Object.assign(new Error('Conversion error from string "abc"'), { gdscode: 335544334, gdsparams: ['abc'] }));
    expect(conversion.message).toBe('conversion error from string "abc"');
  });

  it('keeps a message it cannot take apart', () => {
    expect(recoverStatus('Something else', 335544569, undefined)).toBeUndefined();
    expect(fbException(Object.assign(new Error('Something, else'), { gdscode: 1 })).message).toBe('Something\nelse');
    expect(fbException(new Error('Connection is closed.')).message).toBe('Connection is closed.');
  });
});

describe('time spans (TimeSpan.ToString)', () => {
  it('prints the "c" format', () => {
    expect(timeSpanText(0n)).toBe('00:00:00');
    expect(timeSpanText(495_301_234_000n)).toBe('13:45:30.1234000');
    expect(timeSpanText(-36_000_000_000n)).toBe('-01:00:00');
    expect(timeSpanText(864_000_000_000n + 1n)).toBe('1.00:00:00.0000001');
  });
});
