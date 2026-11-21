// The parts of the driver that need no server: the placeholders MySqlConnector finds and the literals
// it writes for them, its connection strings, the statements of a transaction, the reading of
// column definitions and text values, and the OK packet of a session that is already utf8mb4.

import { describe, expect, it } from 'vitest';
import { CsDecimal, CultureInfo, DateTimeKind, type QueryParameter, RpDateTime } from 'reportman-engine';
import { okReportsUtf8mb4, startTransactionStatements } from '../src/connection.js';
import { parseConnectionString, parsePairs } from '../src/connectionstring.js';
import { type BindOptions, bindParameters, binaryLiteral, ParameterCollection, parameterLiteral, timestampLiteral } from '../src/params.js';
import { normalizeParameterName } from '../src/sql.js';
import { type ColumnDefinition, ColumnType, outputColumn, parseDateTime, parseTimeSpan, type ReadOptions, timeSpanText } from '../src/values.js';

const bind: BindOptions = { noBackslashEscapes: false, allowUserVariables: false, dateTimeKind: 'Unspecified', culture: CultureInfo.get('en-US') };
const p = (name: string, valueType: QueryParameter['valueType'], value: QueryParameter['value'], dbType: QueryParameter['dbType'] = 'Object'): QueryParameter => ({
  name,
  value,
  valueType,
  dbType,
});
const sqlOf = (sql: string, params: QueryParameter[], options: Partial<BindOptions> = {}): string | Uint8Array =>
  bindParameters(sql, new ParameterCollection(params), { ...bind, ...options });
const errorOf = (f: () => unknown): { type: string; message: string } | null => {
  try {
    f();
    return null;
  } catch (e) {
    return { type: (e as { netType?: string }).netType ?? (e as Error).name, message: (e as Error).message };
  }
};

describe('placeholders (SqlParser, StatementPreparer)', () => {
  const a = p('A', 'Int32', 7);
  it('replaces @NAME, ?NAME and :NAME of a parameter, case-insensitive, outside quotes and comments', () => {
    expect(sqlOf("SELECT @A, ?a, :a, '@A', \"@A\", `@A` -- @A\n/* @A */ # @A", [a])).toBe("SELECT 7, 7, 7, '@A', \"@A\", `@A` -- @A\n/* @A */ # @A\n");
    expect(sqlOf("SELECT 'it\\'s @A', 'x''@A' FROM T WHERE B = @A", [a])).toBe("SELECT 'it\\'s @A', 'x''@A' FROM T WHERE B = 7");
    // without backslash escapes the backslash ends nothing: the quote after it closes the string
    expect(sqlOf("SELECT 'a\\' AS X, @A", [a], { noBackslashEscapes: true })).toBe("SELECT 'a\\' AS X, 7");
  });

  it('keeps @@variables, user variables (when allowed), --x and :NAME of no parameter', () => {
    expect(sqlOf('SELECT @@version, 1--@A\n', [a])).toBe('SELECT @@version, 1--7\n');
    expect(sqlOf("SELECT TIME '10:30', :OTHER, @A", [a])).toBe("SELECT TIME '10:30', :OTHER, 7");
    expect(sqlOf('SELECT @v := @A', [a], { allowUserVariables: true })).toBe('SELECT @v := 7');
    expect(errorOf(() => sqlOf('SELECT @v', [a]))).toEqual({
      type: 'MySqlException',
      message: "Parameter '@v' must be defined. To use this as a variable, set 'Allow User Variables=true' in the connection string.",
    });
  });

  it('takes quoted names and positional ?', () => {
    expect(sqlOf("SELECT @`A`, @'A', ?, ?", [a, p('B', 'String', 'b')])).toBe("SELECT 7, 7, 7, 'b'");
    expect(errorOf(() => sqlOf('SELECT ?', []))).toEqual({ type: 'MySqlException', message: 'Parameter index 0 is invalid when only 0 parameters are defined.' });
    expect(normalizeParameterName(' @`a``b` ')).toBe('a`b');
    expect(normalizeParameterName("?'x''y'")).toBe("x'y");
  });

  it('keeps the quirks of MySqlConnector: the character after a quote or a parameter is not looked at', () => {
    expect(sqlOf("SELECT 'x'@A, @A@A", [a])).toBe("SELECT 'x'@A, 7@A");
  });

  it('refuses a name defined twice', () => {
    expect(errorOf(() => new ParameterCollection([a, p('@a', 'Int32', 1)]))).toEqual({ type: 'MySqlException', message: "Parameter '@a' has already been defined." });
  });
});

describe('literals (MySqlParameter.AppendSqlString)', () => {
  const lit = (q: QueryParameter, options: Partial<BindOptions> = {}): unknown => parameterLiteral(q, { ...bind, ...options });
  it('writes every value type of the engine', () => {
    expect(lit(p('P', 'Null', undefined))).toBe('NULL');
    expect(lit(p('P', 'DBNull', null))).toBe('NULL');
    expect(lit(p('P', 'Boolean', true))).toBe('true');
    expect(lit(p('P', 'Byte', 255))).toBe('255');
    expect(lit(p('P', 'Int32', -5))).toBe('-5');
    expect(lit(p('P', 'Int64', -9223372036854775808n))).toBe('-9223372036854775808');
    expect(lit(p('P', 'Decimal', CsDecimal.parseInvariant('-1.50')))).toBe('-1.50');
    expect(lit(p('P', 'Double', 0.1))).toBe('0.1');
    expect(lit(p('P', 'Double', 1e15))).toBe('1000000000000000');
    expect(lit(p('P', 'Double', 1e17))).toBe('1E+17');
    expect(lit(p('P', 'Double', 1.5e-7))).toBe('1.5E-07');
    expect(lit(p('P', 'Double', 123456.789))).toBe('123456.789');
    expect(lit(p('P', 'String', "a'b\\c\0d"))).toBe("'a''b\\\\c\\0d'");
    expect(lit(p('P', 'String', "a'b\\c\0d"), { noBackslashEscapes: true })).toBe("'a''b\\c\0d'");
    expect(lit(p('P', 'Char', "'"))).toBe("''''");
    expect(lit(p('P', 'Char', '\\'))).toBe("'\\\\'");
    expect(lit(p('P', 'Char', '\0'))).toBe("'\\0'");
  });

  it('writes dates with their microseconds, truncated, and checks their kind', () => {
    const d = RpDateTime.fromTicks(RpDateTime.create(2024, 2, 29, 13, 5, 9).ticks + 1_234_567n);
    expect(timestampLiteral(d)).toBe("timestamp('2024-02-29 13:05:09.123456')");
    expect(timestampLiteral(RpDateTime.create(1, 1, 1))).toBe("timestamp('0001-01-01 00:00:00.000000')");
    expect(errorOf(() => lit(p('D', 'DateTime', RpDateTime.create(2024, 1, 1, 0, 0, 0, 0, DateTimeKind.Utc)), { dateTimeKind: 'Local' }))).toEqual({
      type: 'MySqlException',
      message: 'DateTime.Kind must not be Utc when DateTimeKind setting is Local (parameter name: D)',
    });
  });

  it('writes bytes as _binary with NUL, quote and backslash escaped', () => {
    expect(Buffer.from(binaryLiteral(new Uint8Array([0x41, 0, 0x27, 0x5c, 0xff]), false)).toString('latin1')).toBe("_binary'A\\0''\\\\\xff'");
    expect(Buffer.from(binaryLiteral(new Uint8Array([0, 0x5c]), true)).toString('latin1')).toBe("_binary'\0\\'");
    // a statement with bytes UTF-8 cannot carry goes as bytes
    const out = sqlOf('SELECT @B', [p('B', 'Binary', new Uint8Array([0x80]))]);
    expect(out).toBeInstanceOf(Uint8Array);
    expect(Buffer.from(out as Uint8Array).toString('latin1')).toBe("SELECT _binary'\x80'");
    expect(sqlOf('SELECT @B', [p('B', 'Binary', new Uint8Array([0x41]))])).toBe("SELECT _binary'A'");
  });

  it('fails on the Variant GETVALUEFROMSQL passes, as MySqlConnector fails', () => {
    expect(errorOf(() => lit(p('@P', 'Object', 5n, 'Int64')))).toEqual({
      type: 'InvalidCastException',
      message: "Unable to cast object of type 'Reportman.Reporting.Variant' to type 'System.Int64'.",
    });
    expect(errorOf(() => lit(p('@P', 'Object', 1.5, 'Double')))).toEqual({
      type: 'NotSupportedException',
      message: 'Parameter type Variant is not supported; see https://mysqlconnector.net/param-type. Value: 1.5',
    });
  });
});

describe('connection strings (MySqlConnectionStringBuilder)', () => {
  it('reads the keys and synonyms of MySqlConnector, with its defaults', () => {
    const s = parseConnectionString(
      "Host=db1, db2;Port=3307;Uid=reports;Pwd='p;w';Initial Catalog=sales;SslMode=VerifyFull;Connect Timeout=5;Treat Tiny As Boolean=no;GUID Format=Binary16;DateTimeKind=utc;Allow User Variables=yes;Pooling=false",
    );
    expect(s).toMatchObject({
      hosts: ['db1', 'db2'],
      port: 3307,
      user: 'reports',
      password: 'p;w',
      database: 'sales',
      sslMode: 'VerifyFull',
      connectionTimeout: 5,
      treatTinyAsBoolean: false,
      guidFormat: 'Binary16',
      dateTimeKind: 'Utc',
      allowUserVariables: true,
    });
    expect(parseConnectionString('Server=x')).toMatchObject({
      port: 3306,
      sslMode: 'Preferred',
      connectionTimeout: 15,
      treatTinyAsBoolean: true,
      allowZeroDateTime: false,
      convertZeroDateTime: false,
      guidFormat: 'Char36',
      ignoreCommandTransaction: false,
      noBackslashEscapes: false,
    });
    expect(parseConnectionString('Old Guids=true').guidFormat).toBe('LittleEndianBinary16');
    expect(parseConnectionString('SslMode=Disabled').sslMode).toBe('None');
    expect(parsePairs('a=1; b = "x""y" ;c==d=2')).toEqual([['a', '1'], ['b', 'x"y'], ['c=d', '2']]);
  });

  it('fails as MySqlConnector fails', () => {
    expect(errorOf(() => parseConnectionString('Server=x;Frobnicate=1'))).toEqual({ type: 'ArgumentException', message: "Option 'frobnicate' not supported." });
    expect(errorOf(() => parseConnectionString('Port=abc'))).toEqual({ type: 'ArgumentException', message: "Invalid value 'abc' for 'Port' connection string option." });
    expect(errorOf(() => parseConnectionString('OldGuids=true;GuidFormat=Char36'))).toEqual({ type: 'MySqlException', message: 'OldGuids cannot be used with GuidFormat' });
  });
});

describe('transactions (MySqlConnection.BeginTransaction)', () => {
  it('sets the isolation level of the session, then starts the transaction', () => {
    expect(startTransactionStatements('ReadCommitted')).toEqual(['set session transaction isolation level read committed;', 'start transaction;']);
    expect(startTransactionStatements('Snapshot')).toEqual(['set session transaction isolation level repeatable read;', 'start transaction with consistent snapshot;']);
    expect(startTransactionStatements('Unspecified')[0]).toBe('set session transaction isolation level repeatable read;');
    expect(errorOf(() => startTransactionStatements('Chaos'))).toEqual({ type: 'NotSupportedException', message: 'IsolationLevel.Chaos is not supported.' });
  });

  it('tells from the OK of the authentication whether the session is already utf8mb4', () => {
    const lenenc = (s: string): Buffer => Buffer.concat([Buffer.from([s.length]), Buffer.from(s)]);
    const variable = (name: string, value: string): Buffer => Buffer.concat([lenenc(name), lenenc(value)]);
    const ok = (vars: Buffer[]): Buffer => {
      const data = Buffer.concat(vars);
      const entry = Buffer.concat([Buffer.from([0, data.length]), data]);
      return Buffer.concat([Buffer.from([0, 0, 0, 0x02, 0x40, 0, 0, 0]), Buffer.from([entry.length]), entry]);
    };
    const all = ['character_set_client', 'character_set_connection', 'character_set_results'].map((v) => variable(v, 'utf8mb4'));
    expect(okReportsUtf8mb4(ok(all))).toBe(true);
    expect(okReportsUtf8mb4(ok(all.slice(0, 2)))).toBe(false);
    expect(okReportsUtf8mb4(Buffer.from([0, 0, 0, 0x02, 0, 0, 0]))).toBe(false);
  });
});

describe('columns and values (TypeMapper, ColumnReader)', () => {
  const read: ReadOptions = {
    treatTinyAsBoolean: true,
    guidFormat: 'Char36',
    allowZeroDateTime: false,
    convertZeroDateTime: false,
    dateTimeKind: 'Unspecified',
    culture: CultureInfo.get('en-US'),
  };
  const col = (columnType: number, columnLength: number, characterSet = 255, flags = 0): ColumnDefinition => ({
    name: 'C',
    columnType,
    columnLength,
    characterSet,
    flags,
    decimals: 0,
  });
  const info = (c: ColumnDefinition, options: Partial<ReadOptions> = {}) => outputColumn(c, { ...read, ...options });
  const bytes = (s: string): Uint8Array => new TextEncoder().encode(s);

  it('gives the .NET type, the engine column and the size MySqlConnector gives', () => {
    expect(info(col(ColumnType.Tiny, 1, 63)).info).toMatchObject({ netType: 'Boolean', type: 'Boolean', size: 1 });
    expect(info(col(ColumnType.Tiny, 1, 63), { treatTinyAsBoolean: false }).info).toMatchObject({ netType: 'SByte', type: 'Int64' });
    expect(info(col(ColumnType.Long, 10, 63, 0x20)).info).toMatchObject({ netType: 'UInt32', type: 'Int64' });
    expect(info(col(ColumnType.Longlong, 20, 63, 0x20)).info).toMatchObject({ netType: 'UInt64', type: 'Decimal' });
    expect(info(col(ColumnType.VarString, 30, 33)).info).toMatchObject({ netType: 'String', size: 10 });
    expect(info(col(ColumnType.String, 144, 255)).info).toMatchObject({ netType: 'Guid', type: 'Object', size: 36 });
    expect(info(col(ColumnType.String, 144, 255), { guidFormat: 'None' }).info).toMatchObject({ netType: 'String', size: 36 });
    expect(info(col(ColumnType.String, 16, 63), { guidFormat: 'Binary16' }).info).toMatchObject({ netType: 'Guid', size: 16 });
    expect(info(col(ColumnType.LongBlob, 4294967295, 63)).info).toMatchObject({ netType: 'Byte[]', type: 'Binary', size: 2147483647 });
    expect(info(col(ColumnType.Json, 4294967295, 63)).info).toMatchObject({ netType: 'String', size: 2147483647 });
    expect(info(col(ColumnType.DateTime, 19, 63), { allowZeroDateTime: true }).info).toMatchObject({ netType: 'MySqlDateTime', type: 'Object' });
    expect(info(col(ColumnType.Null, 0, 63)).info).toMatchObject({ netType: 'Object', type: 'Object', size: 0 });
    expect(info(col(ColumnType.Vector, 12, 63)).info).toMatchObject({ netType: 'ReadOnlyMemory`1', size: 3 });
    expect(errorOf(() => info(col(ColumnType.VarString, 10, 9999)))).toEqual({ type: 'NotSupportedException', message: 'Maximum byte length of character set 9999 is unknown.' });
    expect(errorOf(() => info(col(ColumnType.DateTime2, 10, 63)))).toEqual({ type: 'NotImplementedException', message: 'ConvertToMySqlDbType for DateTime2 is not implemented' });
  });

  it('reads the text values as MySqlConnector reads them', () => {
    expect(info(col(ColumnType.Tiny, 1, 63)).read(bytes('-1'))).toBe(true);
    expect(info(col(ColumnType.Bit, 8, 63, 0x20)).read(new Uint8Array([1, 2]))).toEqual(CsDecimal.fromInteger(258));
    expect(info(col(ColumnType.NewDecimal, 40, 63)).read(bytes('1234567890123456789012345678.1234567890'))).toEqual(CsDecimal.parseInvariant('1234567890123456789012345678.1'));
    expect(errorOf(() => info(col(ColumnType.NewDecimal, 40, 63)).read(bytes('99999999999999999999999999999999')))).toEqual({
      type: 'FormatException',
      message: 'One of the identified items was in an invalid format.',
    });
    expect(info(col(ColumnType.Float, 12, 63)).read(bytes('3.40282e38'))).toBe(Math.fround(3.40282e38));
    expect(info(col(ColumnType.String, 144, 255)).read(bytes('00112233-4455-6677-8899-AABBCCDDEEFF'))).toBe('00112233-4455-6677-8899-aabbccddeeff');
    expect(errorOf(() => info(col(ColumnType.String, 144, 255)).read(bytes('')))).toEqual({ type: 'FormatException', message: 'Could not parse CHAR(36) value as Guid: ' });
    const g = new Uint8Array([0, 0x11, 0x22, 0x33, 0x44, 0x55, 0x66, 0x77, 0x88, 0x99, 0xaa, 0xbb, 0xcc, 0xdd, 0xee, 0xff]);
    expect(info(col(ColumnType.String, 16, 63), { guidFormat: 'LittleEndianBinary16' }).read(g)).toBe('33221100-5544-7766-8899-aabbccddeeff');
    expect(info(col(ColumnType.String, 16, 63), { guidFormat: 'TimeSwapBinary16' }).read(g)).toBe('44556677-2233-0011-8899-aabbccddeeff');
  });

  it('reads TIME as TimeSpan.ToString() prints it', () => {
    expect(parseTimeSpan(bytes('-838:59:59'))).toBe('-34.22:59:59');
    expect(parseTimeSpan(bytes('13:45:30.1234'))).toBe('13:45:30.1234000');
    expect(parseTimeSpan(bytes('-00:00:00.000001'))).toBe('-00:00:00.0000010');
    expect(timeSpanText(0n)).toBe('00:00:00');
    expect(errorOf(() => parseTimeSpan(bytes('839:00:00')))).toEqual({ type: 'FormatException', message: "Couldn't interpret value as a valid TimeSpan: 839:00:00" });
  });

  it('reads dates, zero dates by the options', () => {
    expect((parseDateTime(bytes('2024-02-29 13:45:30.123456'), read) as RpDateTime).toString()).toBe('2024-02-29T13:45:30.1234560');
    expect(parseDateTime(bytes('0000-00-00'), { ...read, convertZeroDateTime: true })).toBe(RpDateTime.minValue);
    expect(errorOf(() => parseDateTime(bytes('0000-00-00 00:00:00'), read))?.type).toBe('InvalidCastException');
    expect(errorOf(() => parseDateTime(bytes('2024-02-30'), read))).toEqual({ type: 'FormatException', message: "Couldn't interpret value as a valid DateTime: 2024-02-30" });
    const allow = info(col(ColumnType.DateTime, 19, 63), { allowZeroDateTime: true });
    expect(allow.read(bytes('0000-00-00 00:00:00'))).toBe('0000-00-00');
    expect(allow.read(bytes('2024-00-15 00:00:00'))).toBe('0000-00-00');
    expect(allow.read(bytes('2024-02-29 13:45:30'))).toBe('2/29/2024 1:45:30 PM');
    expect((parseDateTime(bytes('2024-02-29'), { ...read, dateTimeKind: 'Local' }) as RpDateTime).kind).toBe(DateTimeKind.Local);
  });
});
