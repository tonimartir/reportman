// The parts of the driver that need no server: the connection string as SqlClient reads it, the
// parameters as SqlClient types, converts, declares and writes them, the decimals and dates as
// SqlBuffer reads them, the xml text of SqlXml.Value and the :NAME placeholders.

import { EOL } from 'node:os';
import { describe, expect, it } from 'vitest';
import { CsDecimal, CultureInfo, NetException, RpDateTime, type QueryParameter } from '@reportman/engine';
import {
  bindParameter,
  bindParameters,
  decimalPrecision,
  isolationLevelCode,
  parseConnectionString,
  parseDataSource,
  rewritePlaceholders,
  sqlDateTime,
  sqlDecimal,
  tediousConfig,
  timeSpanText,
} from '../src/index.js';
import { sqlXmlValue } from '../src/xml.js';

const ctx = { culture: CultureInfo.get('en-US'), collation: Buffer.from([9, 4, 208, 0, 52]) };

function p(name: string, value: QueryParameter['value'], valueType: QueryParameter['valueType'], dbType: QueryParameter['dbType']): QueryParameter {
  return { name, value, valueType, dbType };
}

function netError(f: () => unknown): { netType: string; message: string } {
  try {
    f();
  } catch (e) {
    return { netType: e instanceof NetException ? e.netType : (e as Error).name, message: (e as Error).message };
  }
  throw new Error('no error');
}

describe('connection strings (SqlConnectionString)', () => {
  it('reads the keywords, their synonyms and SqlClient defaults', () => {
    const s = parseConnectionString(
      "Server=tcp:db.example.com,1500; Initial Catalog=sales;uid=rep;Pwd='a;b''c';TrustServerCertificate=yes;App=Reports;Connect Timeout=7;Language=Spanish;WSID=W1;Packet Size=4096;ApplicationIntent=ReadOnly;MultiSubnetFailover=true;MultipleActiveResultSets=True",
    );
    expect(s).toMatchObject({
      dataSource: 'tcp:db.example.com,1500',
      database: 'sales',
      userId: 'rep',
      password: "a;b'c",
      trustServerCertificate: true,
      applicationName: 'Reports',
      connectTimeout: 7,
      currentLanguage: 'Spanish',
      workstationId: 'W1',
      packetSize: 4096,
      applicationIntent: 'ReadOnly',
      multiSubnetFailover: true,
      multipleActiveResultSets: true,
      encrypt: 'Mandatory',
    });
    expect(parseConnectionString('Data Source=x').applicationName).toBe('Core Microsoft SqlClient Data Provider');
    expect(parseConnectionString('Encrypt=no').encrypt).toBe('Optional');
    expect(parseConnectionString('Encrypt=Strict').encrypt).toBe('Strict');
    expect(parseConnectionString('Trusted_Connection=SSPI').integratedSecurity).toBe(true);
    expect(parseConnectionString('Authentication=Active Directory Default').authentication).toBe('ActiveDirectoryDefault');
    expect(parseConnectionString('Type System Version=SQL Server 2012').typeSystemVersion).toBe('SQL Server 2012');
  });

  it('fails as SqlClient fails', () => {
    expect(netError(() => parseConnectionString('Frobnicate=1'))).toEqual({ netType: 'ArgumentException', message: "Keyword not supported: 'frobnicate'." });
    expect(netError(() => parseConnectionString('MultipleActiveResultSets=maybe')).message).toBe("Invalid value for key 'Multiple Active Result Sets'.");
    expect(netError(() => parseConnectionString('Timeout=abc')).message).toBe("Invalid value for key 'Connect Timeout'.");
    expect(netError(() => parseConnectionString('Connect Timeout=-1')).message).toBe("Invalid value for key 'Connect Timeout'.");
    expect(netError(() => parseConnectionString('Packet Size=100')).message).toBe("Invalid 'Packet Size'.  The value must be an integer >= 512 and <= 32768.");
    expect(netError(() => parseConnectionString('Network Library=dbmssocn')).message).toBe("Keyword not supported: 'network library'.");
    expect(netError(() => parseConnectionString('Failover Partner=x')).message).toBe("Use of key 'Failover Partner' requires the key 'Initial Catalog' to be present.");
    expect(netError(() => parseConnectionString('Server=x;Password')).message).toBe('Format of the initialization string does not conform to specification starting at index 9.');
  });

  it('reads Data Source as SqlClient (protocol, instance, port)', () => {
    expect(parseDataSource('tcp:db,1500')).toEqual({ host: 'db', port: 1500, instanceName: undefined });
    expect(parseDataSource('db\\SQLEXPRESS')).toEqual({ host: 'db', port: undefined, instanceName: 'SQLEXPRESS' });
    // a port wins over the instance name
    expect(parseDataSource('db\\SQLEXPRESS,1444')).toEqual({ host: 'db', port: 1444, instanceName: undefined });
    expect(parseDataSource('(local)')).toEqual({ host: 'localhost', port: undefined, instanceName: undefined });
    expect(parseDataSource('.')).toEqual({ host: 'localhost', port: undefined, instanceName: undefined });
    expect(netError(() => parseDataSource('np:\\\\.\\pipe\\sql\\query')).netType).toBe('NotSupportedException');
    expect(netError(() => parseDataSource('(localdb)\\MSSQLLocalDB')).netType).toBe('NotSupportedException');
  });

  it('gives tedious the behaviour of SqlClient', () => {
    const config = tediousConfig(parseConnectionString('Server=db;User ID=u;Password=p;Encrypt=Optional;Connect Timeout=0'), { culture: ctx.culture });
    expect(config.options).toMatchObject({ port: 1433, encrypt: false, requestTimeout: 0, connectTimeout: 2147483647, lowerCaseGuids: true, tdsVersion: '7_4' });
    expect(config.authentication).toEqual({ type: 'default', options: { userName: 'u', password: 'p' } });
    expect(tediousConfig(parseConnectionString('Server=db;Encrypt=Strict'), { culture: ctx.culture }).options?.encrypt).toBe('strict');
    expect(netError(() => tediousConfig(parseConnectionString('Server=db;Integrated Security=true'), { culture: ctx.culture })).netType).toBe('NotSupportedException');
    expect(netError(() => tediousConfig(parseConnectionString('Server=db;Authentication=ActiveDirectoryInteractive'), { culture: ctx.culture })).netType).toBe('NotSupportedException');
    expect(netError(() => tediousConfig(parseConnectionString('Server=db;Column Encryption Setting=Enabled'), { culture: ctx.culture })).netType).toBe('NotSupportedException');
  });

  it('begins the transactions with the isolation levels of SqlClient', () => {
    expect(isolationLevelCode('Unspecified')).toBe(2);
    expect(isolationLevelCode('ReadUncommitted')).toBe(1);
    expect(isolationLevelCode('ReadCommitted')).toBe(2);
    expect(isolationLevelCode('RepeatableRead')).toBe(3);
    expect(isolationLevelCode('Serializable')).toBe(4);
    expect(isolationLevelCode('Snapshot')).toBe(5);
    expect(netError(() => isolationLevelCode('Chaos'))).toEqual({
      netType: 'ArgumentOutOfRangeException',
      message: "The IsolationLevel enumeration value, 16, is not supported by the .Net Framework SqlClient Data Provider. (Parameter 'IsolationLevel')",
    });
  });
});

describe('parameters (SqlParameter, BuildParamList, TdsExecuteRPC)', () => {
  it('declares each DbType as SqlClient', () => {
    const { declarations } = bindParameters(
      [
        p('A', 7, 'Int32', 'Int32'),
        p('B', 'abc', 'String', 'String'),
        p('C', '', 'String', 'String'),
        p('D', 'x'.repeat(4001), 'String', 'String'),
        p('E', CsDecimal.fromParts(150n, 2, false), 'Decimal', 'Decimal'),
        p('F', CsDecimal.fromParts(5n, 2, false), 'Decimal', 'Decimal'),
        p('G', null, 'DBNull', 'Decimal'),
        p('H', 21.5, 'Double', 'Double'),
        p('I', RpDateTime.create(2024, 2, 1), 'DateTime', 'DateTime'),
        p('J', true, 'Boolean', 'Boolean'),
        p('K', 9007199254740993n, 'Int64', 'Int64'),
        p('L', 255, 'Byte', 'Byte'),
        p('M', new Uint8Array([1, 2]), 'Binary', 'Binary'),
        p('N', new Uint8Array(9000), 'Binary', 'Binary'),
        p('O', null, 'DBNull', 'Object'),
        p('P', 40, 'Int32', 'String'),
        p('Q', undefined, 'Null', 'Int32'),
        p('@R', 1, 'Int32', 'Int32'),
      ],
      ctx,
    );
    expect(declarations).toBe(
      '@A int,@B nvarchar(3),@C nvarchar(4000),@D nvarchar(max) ,@E decimal(3,2),@F decimal(2,2),@G decimal(29,0),@H float,@I datetime,@J bit,@K bigint,' +
        '@L tinyint,@M varbinary(2),@N varbinary(max) ,@O sql_variant,@P nvarchar(4000),@Q int,@R int',
    );
  });

  it('writes the TDS values (a C# null with the DEFAULT flag)', () => {
    expect(bindParameter(p('A', 7, 'Int32', 'Int32'), ctx).raw).toEqual({ typeInfo: Buffer.from([0x26, 4]), value: Buffer.from([4, 7, 0, 0, 0]), isDefault: false });
    expect(bindParameter(p('A', undefined, 'Null', 'Int32'), ctx).raw).toEqual({ typeInfo: Buffer.from([0x26, 4]), value: Buffer.from([0]), isDefault: true });
    expect(bindParameter(p('S', 'ab', 'String', 'String'), ctx).raw.value).toEqual(Buffer.from([4, 0, 0x61, 0, 0x62, 0]));
    const dec = bindParameter(p('E', CsDecimal.fromParts(150n, 2, true), 'Decimal', 'Decimal'), ctx).raw;
    expect(dec.typeInfo).toEqual(Buffer.from([0x6a, 17, 3, 2]));
    expect(dec.value.subarray(0, 4)).toEqual(Buffer.from([17, 0, 150, 0]));
    // sql_variant: an int, a decimal (precision 38), a string with the collation
    expect(bindParameter(p('V', 5, 'Int32', 'Object'), ctx).raw.value).toEqual(Buffer.from([6, 0, 0, 0, 0x38, 0, 5, 0, 0, 0]));
    expect(bindParameter(p('V', CsDecimal.fromParts(15n, 1, false), 'Decimal', 'Object'), ctx).raw.value.subarray(0, 8)).toEqual(Buffer.from([21, 0, 0, 0, 0x6c, 2, 38, 1]));
    expect(bindParameter(p('V', 'é', 'String', 'Object'), ctx).raw.value).toEqual(Buffer.from([11, 0, 0, 0, 0xe7, 7, 9, 4, 208, 0, 52, 2, 0, 0xe9, 0]));
  });

  it('converts the values to the type of the parameter as Convert.ChangeType', () => {
    expect(bindParameter(p('A', CsDecimal.fromParts(25n, 1, false), 'Decimal', 'Int32'), ctx).raw.value).toEqual(Buffer.from([4, 2, 0, 0, 0]));
    expect(bindParameter(p('A', 3.5, 'Double', 'Int32'), ctx).raw.value).toEqual(Buffer.from([4, 4, 0, 0, 0]));
    expect(bindParameter(p('A', '12', 'String', 'Int32'), ctx).raw.value).toEqual(Buffer.from([4, 12, 0, 0, 0]));
    expect(bindParameter(p('S', 1.5, 'Double', 'String'), { ...ctx, culture: CultureInfo.get('es-ES') }).raw.value).toEqual(Buffer.from([6, 0, 0x31, 0, 0x2c, 0, 0x35, 0]));
    expect(netError(() => bindParameter(p('A', 'C001', 'String', 'Int32'), ctx))).toEqual({ netType: 'FormatException', message: 'Failed to convert parameter value from a String to a Int32.' });
    expect(netError(() => bindParameter(p('A', 300, 'Int32', 'Byte'), ctx))).toEqual({ netType: 'OverflowException', message: 'Failed to convert parameter value from a Int32 to a Byte.' });
    expect(netError(() => bindParameter(p('A', RpDateTime.create(2024, 1, 1), 'DateTime', 'Int32'), ctx))).toEqual({
      netType: 'InvalidCastException',
      message: 'Failed to convert parameter value from a DateTime to a Int32.',
    });
    expect(netError(() => bindParameter(p('A', new Uint8Array([1]), 'Binary', 'String'), ctx))).toEqual({
      netType: 'InvalidCastException',
      message: 'Failed to convert parameter value from a Byte[] to a String.',
    });
    expect(netError(() => bindParameter(p('C', 'x', 'Char', 'SByte'), ctx))).toEqual({ netType: 'ArgumentException', message: 'No mapping exists from DbType SByte to a known SqlDbType.' });
  });

  it('writes datetime values as SqlDateTime (1/300 s, 1753 to 9999)', () => {
    expect(sqlDateTime(RpDateTime.create(1900, 1, 1))).toEqual({ days: 0, time: 0 });
    expect(sqlDateTime(RpDateTime.create(2024, 2, 29, 13, 45, 30, 997))).toEqual({ days: 45349, time: 14859299 });
    expect(sqlDateTime(RpDateTime.fromTicks(RpDateTime.create(2024, 1, 1, 23, 59, 59, 999).ticks))).toEqual({ days: 45291, time: 0 });
    expect(netError(() => sqlDateTime(RpDateTime.create(1700, 1, 1)))).toEqual({
      netType: 'SqlTypeException',
      message: 'SqlDateTime overflow. Must be between 1/1/1753 12:00:00 AM and 12/31/9999 11:59:59 PM.',
    });
    expect(decimalPrecision(CsDecimal.zero)).toBe(1);
  });
});

describe('values (SqlBuffer, SqlXml)', () => {
  it('reads decimals beyond System.Decimal as SqlBuffer.Decimal', () => {
    expect(sqlDecimal(15n * 10n ** 29n, 30, false).toInvariantString()).toBe('1.5000000000000000000000000000');
    expect(sqlDecimal(1234567890123456789012345678n * 10n ** 10n, 10, false).toInvariantString()).toBe('1234567890123456789012345678');
    expect(sqlDecimal(0n, 38, false).toInvariantString()).toBe('0.0000000000000000000000000000');
    expect(netError(() => sqlDecimal(99n * 10n ** 36n, 37, false))).toEqual({ netType: 'OverflowException', message: 'Conversion overflows.' });
    expect(netError(() => sqlDecimal(10n ** 37n, 9, false))).toEqual({ netType: 'SqlTypeException', message: 'Invalid numeric precision/scale.' });
    expect(netError(() => sqlDecimal(79228162514264337593543950336n, 0, false)).message).toBe('Conversion overflows.');
  });

  it('prints a TimeSpan as TimeSpan.ToString()', () => {
    expect(timeSpanText(0n)).toBe('00:00:00');
    expect(timeSpanText(495301234567n)).toBe('13:45:30.1234567');
    expect(timeSpanText(-864000000000n - 10n)).toBe('-1.00:00:00.0000010');
  });

  it('writes xml as SqlXml.Value', () => {
    expect(sqlXmlValue('<a b="1">t <c/></a>')).toBe('<a b="1">t <c /></a>');
    expect(sqlXmlValue('<a x="q&quot;&#x9;&#xA;">a &gt; b&#xD;&#xA;c\nd</a>')).toBe(`<a x="q&quot;&#x9;&#xA;">a &gt; b${EOL}c${EOL}d</a>`);
    expect(sqlXmlValue('<?pi x?><!-- c --><r/>')).toBe('<?pi x?><!-- c --><r />');
  });
});

describe('placeholders', () => {
  it('writes :NAME of a parameter as @NAME outside literals, identifiers and comments', () => {
    const params = [p('A', 1, 'Int32', 'Int32'), p('Bb', 1, 'Int32', 'Int32')];
    expect(rewritePlaceholders("SELECT :A, :bb, ':A', [:A], \":A\" -- :A\n, /* :A */ :C, geometry::Point(1, 2, 0)", params)).toBe(
      "SELECT @A, @bb, ':A', [:A], \":A\" -- :A\n, /* :A */ :C, geometry::Point(1, 2, 0)",
    );
    expect(rewritePlaceholders('SELECT :A', [])).toBe('SELECT :A');
  });
});
