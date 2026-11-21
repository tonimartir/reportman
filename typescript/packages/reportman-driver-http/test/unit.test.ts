// The parts of the driver the report parity tests do not reach: how the settings are resolved (defaults,
// the host's values, the connections file, the session), the headers of each kind of credentials, the
// timeout, the errors of a request that gets no answer, the catalog, test and dialect requests of
// HttpAgentExecutor, and the JSON, the dates, the charsets and the cell conversions on their own. The
// expected texts are the ones System.Text.Json and HttpClient write (see the fixtures for the ones checked
// against golden-cs). Nothing here reaches the real Hub: a fake fetch stands for it, or the mock Hub.

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  CsDecimal,
  DateTimeKind,
  RpDateTime,
  type ConnectionRequest,
  type DataValue,
  type ParameterValueType,
  type QueryParameter,
} from 'reportman-engine';
import {
  AgentConnection,
  createExecutor,
  DEFAULT_BASE_URL,
  HttpAgentExecutor,
  IniDocument,
  isAgentConnection,
  reportmanAgent,
  resolveSettings,
  type FetchInit,
  type FetchLike,
  type ReportmanAgentOptions,
} from 'reportman-driver-http';
import { elementToString, parseJson, toPlain, tryGetProperty } from '../src/json.js';
import { executeBody, jsonDateTime, jsonDouble, jsonParameterValue } from '../src/request.js';
import { readInt64 } from '../src/settings.js';
import { statusCodeName } from '../src/status.js';
import { convertJsonValue, deserializeTable, mapTypeName, parseIsoDateTime } from '../src/table.js';
import { decodeUtf8, readContentAsString, readIniText } from '../src/text.js';
import { AUTH, EXAMPLE_DB, MockHub, PRIVATE_DB } from './hub.ts';
import { errorOf } from './golden.ts';

function request(alias: string, o: { configFile?: string; loadParams?: boolean; driver?: number } = {}): ConnectionRequest {
  return {
    database: { alias, configFile: o.configFile ?? '', loadParams: o.loadParams ?? true, driver: o.driver ?? 10 } as ConnectionRequest['database'],
    alias,
    connectionString: '',
    providerFactory: '',
    engineSqlite: false,
    dbParam: () => '',
    isolationLevel: 'RepeatableRead',
  };
}

function command(sql: string, parameters: QueryParameter[] = []) {
  return { sql, parameters, dataset: 'T' };
}

function param(name: string, valueType: ParameterValueType, value: DataValue, dbType: QueryParameter['dbType'] = 'Object'): QueryParameter {
  return { name, value, valueType, dbType };
}

/** A fetch that records what it is asked and answers `body` (200, JSON). */
function fakeFetch(body = '{"data":{"columns":[{"name":"A","dataType":"Int32"}],"rows":[[1]]}}', status = 200, contentType = 'application/json') {
  const calls: { url: string; init: FetchInit }[] = [];
  const fetch: FetchLike = (url, init) => {
    calls.push({ url, init });
    const bytes = new TextEncoder().encode(body);
    return Promise.resolve({
      status,
      headers: { get: (name: string) => (name.toLowerCase() === 'content-type' ? contentType : null) },
      arrayBuffer: () => Promise.resolve(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer),
    });
  };
  return { fetch, calls };
}

async function connect(alias: string, options: ReportmanAgentOptions, o: Parameters<typeof request>[1] = {}): Promise<AgentConnection> {
  return (await reportmanAgent(options)(request(alias, o))) as AgentConnection;
}

// ---------------------------------------------------------------------------------------------

describe('the settings of a connection (DatabaseInfo.Connect)', () => {
  const ini = ['[SALES]', 'DriverName=Reportman AI Agent', 'Url=https://hub.example.test/', 'HubDatabaseId= 42 ', 'ApiKey=ini-key', 'Token=ini-token', '[TOKENONLY]', 'HubDatabaseId=5', 'Token=ini-token', '[OTHER]', 'DriverName=Firebird'].join('\r\n');
  const doc = new IniDocument(ini);

  it('uses the default base URL, no credentials and no Hub database without anything', () => {
    expect(resolveSettings(request('X'), {}, undefined, undefined)).toEqual({
      baseUrl: DEFAULT_BASE_URL,
      apiKey: '',
      token: '',
      installId: '',
      hubDatabaseId: 0n,
      connectionName: 'X',
    });
    expect(DEFAULT_BASE_URL).toBe('https://aiapi.reportman.es');
  });

  it('completes the values of the host from the section of the connection; the URL of the file wins', () => {
    expect(resolveSettings(request('sales'), { baseUrl: 'https://mine.test', apiKey: 'host-key', hubDatabaseId: 7 }, doc, undefined)).toEqual({
      baseUrl: 'https://hub.example.test/',
      apiKey: 'host-key',
      token: '',
      installId: '',
      hubDatabaseId: 7n,
      connectionName: 'sales',
    });
    const fromFile = resolveSettings(request('SALES'), {}, doc, undefined);
    expect([fromFile.apiKey, fromFile.token, fromFile.hubDatabaseId]).toEqual(['ini-key', '', 42n]);
    const token = resolveSettings(request('TOKENONLY'), {}, doc, undefined);
    expect([token.apiKey, token.token, token.hubDatabaseId, token.baseUrl]).toEqual(['', 'ini-token', 5n, DEFAULT_BASE_URL]);
  });

  it('reads nothing from the file when the report connection does not load its parameters', () => {
    expect(resolveSettings(request('SALES', { loadParams: false }), {}, doc, undefined).hubDatabaseId).toBe(0n);
  });

  it('takes the session of the host only without an API key or a token', () => {
    const session = { token: () => 'session-token', installId: () => 'install-1' };
    const s = resolveSettings(request('NONE'), { hubDatabaseId: 3 }, doc, session);
    expect([s.token, s.installId]).toEqual(['session-token', 'install-1']);
    expect(resolveSettings(request('SALES'), {}, doc, session).token).toBe('');
    expect(resolveSettings(request('NONE'), {}, doc, { token: () => '  ' }).token).toBe('');
  });

  it('reads the Hub database as Int64.TryParse does', () => {
    expect([readInt64('7', 0n), readInt64(' +7 ', 0n), readInt64('-3', 0n), readInt64('seven', 0n), readInt64('', 9n)]).toEqual([7n, 7n, -3n, 0n, 9n]);
    expect(readInt64('9223372036854775808', 0n)).toBe(0n);
  });

  it('reads sections and keys without case, the first section, no comments', () => {
    const d = new IniDocument('x=1\n[a]\n; ApiKey=no\n#HubDatabaseId=1\n APIKEY = yes \n[A]\nApiKey=second\n[b]\n');
    expect(d.getValue(' A ', 'apikey', '-')).toBe('yes');
    expect(d.getValue('a', 'HubDatabaseId', '-')).toBe('-');
    expect(d.getValue('none', 'x', '-')).toBe('-');
  });

  it('reads the bytes of a connections file as C# does: UTF-8 after a BOM, Windows-1252 otherwise', () => {
    expect(readIniText(new Uint8Array([0xef, 0xbb, 0xbf, 0x41, 0xc3, 0xb1]))).toBe('A\u00f1');
    expect(readIniText(new Uint8Array([0x41, 0xf1, 0x80]))).toBe('A\u00f1\u20ac');
  });

  it('knows the connections the file maps to the Agent', () => {
    expect(isAgentConnection(request('OTHER', { driver: 8 }), doc)).toBe(false);
    expect(isAgentConnection(request('sales', { driver: 8 }), doc)).toBe(true);
    expect(isAgentConnection(request('sales', { driver: 8, loadParams: false }), doc)).toBe(false);
    expect(isAgentConnection(request('X', { driver: 10 }), undefined)).toBe(true);
  });

  it('asks the host for the file the report connection names, only when it loads its parameters', async () => {
    const asked: string[] = [];
    const options: ReportmanAgentOptions = {
      connectionsFile: (file) => {
        asked.push(file);
        return Promise.resolve(ini);
      },
    };
    const e = await createExecutor(request('SALES', { configFile: 'c:\\conn\\dbxconnections.ini' }), options);
    expect(e.settings.hubDatabaseId).toBe(42n);
    await createExecutor(request('SALES', { loadParams: false }), options);
    expect(asked).toEqual(['c:\\conn\\dbxconnections.ini']);
    // a synchronous text gives the connection at once
    const c = reportmanAgent({ connectionsFile: ini })(request('SALES'));
    expect(c).toBeInstanceOf(AgentConnection);
  });
});

// ---------------------------------------------------------------------------------------------

describe('the requests (with a fake fetch)', () => {
  it('posts to the default Hub with the body and headers of C#', async () => {
    const { fetch, calls } = fakeFetch();
    const c = await connect('SALES', { fetch, hubDatabaseId: 42, apiKey: 'k1', installId: 'i1' });
    const result = await c.query(command('SELECT 1', [param('A', 'Int32', 1, 'Int32')]));
    expect(result.rows).toEqual([[1]]);
    expect(calls).toHaveLength(1);
    expect(calls[0]!.url).toBe('https://aiapi.reportman.es/api/agent/execute');
    expect(calls[0]!.init.method).toBe('POST');
    expect(calls[0]!.init.headers).toEqual({
      'content-type': 'application/json; charset=utf-8',
      'x-reportman-apikey': 'k1',
      'x-reportman-webinstallid': 'i1',
    });
    expect(calls[0]!.init.body).toBe('{"hubDatabaseId":42,"sql":"SELECT 1","parameters":[{"name":"A","value":1,"dbType":11}]}');
  });

  it('sends a Bearer token only without an API key, and nothing without credentials', async () => {
    const { fetch, calls } = fakeFetch();
    await (await connect('X', { fetch, hubDatabaseId: 1, token: 't1', installId: 'i1', baseUrl: 'http://h.test//' })).query(command('S'));
    await (await connect('X', { fetch, hubDatabaseId: 1, apiKey: 'k', token: 't1' })).query(command('S'));
    await (await connect('X', { fetch, hubDatabaseId: 1 })).query(command('S'));
    expect(calls[0]!.url).toBe('http://h.test/api/agent/execute');
    expect(calls.map((c) => c.init.headers)).toEqual([
      { 'content-type': 'application/json; charset=utf-8', authorization: 'Bearer t1', 'x-reportman-webinstallid': 'i1' },
      { 'content-type': 'application/json; charset=utf-8', 'x-reportman-apikey': 'k' },
      { 'content-type': 'application/json; charset=utf-8' },
    ]);
  });

  it('fails before any request without a base URL or a Hub database', async () => {
    const { fetch, calls } = fakeFetch();
    expect(await errorOf((await connect('X', { fetch, baseUrl: '', hubDatabaseId: 1 })).query(command('S')))).toEqual({
      type: 'InvalidOperationException',
      message: 'BaseUrl is not configured for HttpAgent',
    });
    const e = await errorOf((await connect('NOHUB', { fetch, culture: 'es-ES' })).query(command('S')));
    expect(e?.type).toBe('NamedException');
    expect(e?.message).toMatch(/^La conexión "NOHUB" \(Reportman AI Agent\) no está configurada/);
    expect(calls).toHaveLength(0);
  });

  it('holds no session with the Hub: closing it sends nothing', async () => {
    const { fetch, calls } = fakeFetch();
    const c = await connect('X', { fetch, hubDatabaseId: 1 });
    expect(c.close()).toBeUndefined();
    expect(calls).toHaveLength(0);
  });

  it('gives up after the timeout with the TaskCanceledException of HttpClient', async () => {
    let signal: unknown;
    const never: FetchLike = (_url, init) => {
      signal = init.signal;
      return new Promise(() => undefined);
    };
    expect(await errorOf((await connect('X', { fetch: never, hubDatabaseId: 1, timeout: 50 })).query(command('S')))).toEqual({
      type: 'TaskCanceledException',
      message: 'The request was canceled due to the configured HttpClient.Timeout of 0.05 seconds elapsing.',
    });
    expect((signal as { aborted: boolean }).aborted).toBe(true);
    const es = await errorOf((await connect('X', { fetch: never, hubDatabaseId: 1, timeout: 50, culture: 'es-ES' })).query(command('S')));
    expect(es?.message).toBe('The request was canceled due to the configured HttpClient.Timeout of 0,05 seconds elapsing.');
  });

  it('says why a request got no answer, as HttpRequestException', async () => {
    const failing = (code: string | undefined, message = 'fetch failed'): FetchLike => () =>
      Promise.reject(Object.assign(new TypeError(message), { cause: Object.assign(new Error('inner ' + (code ?? '')), code === undefined ? {} : { code }) }));
    const run = async (fetch: FetchLike, baseUrl: string) => errorOf((await connect('X', { fetch, hubDatabaseId: 1, baseUrl })).query(command('S')));
    expect(await run(failing('ECONNREFUSED'), 'http://127.0.0.1:9')).toEqual({
      type: 'HttpRequestException',
      message: 'No connection could be made because the target machine actively refused it. (127.0.0.1:9)',
    });
    expect((await run(failing('ENOTFOUND'), 'https://nohost.invalid'))?.message).toBe('No such host is known. (nohost.invalid:443)');
    expect((await run(failing(undefined), 'http://[::1]:8080/x'))?.message).toBe('inner  ([::1]:8080)');
    const noFetch = new HttpAgentExecutor({ baseUrl: 'http://x', apiKey: '', token: '', installId: '', hubDatabaseId: 1n, connectionName: 'X' }, {
      fetch: undefined,
    });
    expect(noFetch.settings.baseUrl).toBe('http://x');
  });

  it('reads the error of the Hub with the name of its status code', async () => {
    const refused = fakeFetch('No access', 403, 'text/plain');
    expect((await errorOf((await connect('X', { fetch: refused.fetch, hubDatabaseId: 1, apiKey: 'k' })).query(command('S'))))?.message).toBe(
      'HttpAgent error Forbidden: No access',
    );
    expect((await errorOf((await connect('NOKEY', { fetch: refused.fetch, hubDatabaseId: 1 })).query(command('S'))))?.message).toMatch(
      /^The connection "NOKEY" \(Reportman AI Agent\) has no API key and there is no Reportman AI session\./,
    );
    expect([statusCodeName(200), statusCodeName(307), statusCodeName(422), statusCodeName(599)]).toEqual(['OK', 'RedirectKeepVerb', 'UnprocessableEntity', '599']);
  });
});

// ---------------------------------------------------------------------------------------------

describe('the requests of HttpAgentExecutor against the mock Hub', () => {
  let hub: MockHub;
  beforeAll(async () => {
    hub = await MockHub.start();
  });
  afterAll(async () => {
    await hub.close();
  });

  const executor = async (o: ReportmanAgentOptions) => (await connect('HUB', { baseUrl: hub.url, ...o })).executor;

  it('runs a query of a private database with a session (Bearer token and install id)', async () => {
    const session = { token: () => AUTH.token, installId: () => AUTH.installId };
    const c = await connect('HUB', { baseUrl: hub.url, hubDatabaseId: PRIVATE_DB, session });
    const r = await c.query(command('SELECT COUNT(*) AS N FROM CUSTOMERS'));
    expect(r.columns).toEqual([{ name: 'N', type: 'Int64', size: null, declaredType: null }]);
    expect(typeof r.rows[0]![0]).toBe('bigint');
    expect(hub.requests.at(-1)!.headers).toEqual({
      'content-type': 'application/json; charset=utf-8',
      authorization: 'Bearer ' + AUTH.token,
      'x-reportman-webinstallid': AUTH.installId,
    });
  });

  it('tests the connection', async () => {
    expect(await (await executor({ hubDatabaseId: EXAMPLE_DB })).testConnection()).toBe('Agent Connection: Success');
    const e = await errorOf((await executor({ hubDatabaseId: PRIVATE_DB })).testConnection());
    expect(e?.type).toBe('NamedException');
    const down = fakeFetch('{"success":true,"data":{"databaseConnectionSuccess":false,"databaseError":"The database is down","message":"m"}}');
    expect(await errorOf((await executor({ hubDatabaseId: 1, fetch: down.fetch })).testConnection())).toEqual({ type: 'Exception', message: 'The database is down' });
    const failed = fakeFetch('{"success":false,"error":null}');
    expect((await errorOf((await executor({ hubDatabaseId: 1, fetch: failed.fetch })).testConnection()))?.message).toBe('HttpAgent test failed');
    expect(down.calls[0]!.init.body).toBe('{"hubDatabaseId":1}');
  });

  it('reads the catalog of the database', async () => {
    const e = await executor({ hubDatabaseId: PRIVATE_DB, apiKey: AUTH.apiKey });
    const tables = (await e.readCatalog('api/agent/readtables', null, 'tables')) as { tableName: string }[];
    expect(tables.map((t) => t.tableName)).toContain('CUSTOMERS');
    const columns = (await e.readCatalog('api/agent/readcolumns', 'ORDERS', 'columns')) as { columnName: string }[];
    expect(columns.map((c) => c.columnName).slice(0, 3)).toEqual(['ORDER_ID', 'ORDER_NUMBER', 'CUSTOMER_ID']);
    const fks = (await e.readCatalog('api/agent/readforeignkeys', 'ORDERS', 'foreignKeys')) as { referencedTable: string }[];
    expect(fks.map((f) => f.referencedTable).sort()).toEqual(['CUSTOMERS', 'EMPLOYEES']);
    expect(await e.readCatalog('api/agent/readtables', null, 'nothing')).toEqual([]);
    expect(hub.requests.at(-2)!.body).toBe('{"hubDatabaseId":17,"tableName":"ORDERS"}');
    const refused = fakeFetch('{"success":false}');
    expect((await errorOf((await executor({ hubDatabaseId: 1, fetch: refused.fetch })).readCatalog('api/agent/readtables', null, 'tables')))?.message).toBe(
      'api/agent/readtables failed',
    );
  });

  it('reads the dialect of the database', async () => {
    expect(await (await executor({ hubDatabaseId: EXAMPLE_DB })).readDialect()).toBe('SQLite');
    expect(await (await executor({ hubDatabaseId: PRIVATE_DB })).readDialect()).toBe('SQLite3');
    expect(await (await executor({ hubDatabaseId: 99 })).readDialect()).toBe('');
    expect(await (await executor({})).readDialect()).toBe('');
    expect(hub.requests.at(-1)!.method).toBe('GET');
  });
});

// ---------------------------------------------------------------------------------------------

describe('the JSON of the requests (System.Text.Json, JavaScriptEncoder.Default)', () => {
  it('writes each .NET type of a parameter value', () => {
    const v = (t: ParameterValueType, value: DataValue) => jsonParameterValue(param('P', t, value));
    expect(v('Null', undefined)).toBe('null');
    expect(v('DBNull', null)).toBe('{}');
    expect([v('Boolean', true), v('Boolean', false)]).toEqual(['true', 'false']);
    expect([v('Byte', 255), v('Int32', -2147483648), v('Int64', -9223372036854775808n)]).toEqual(['255', '-2147483648', '-9223372036854775808']);
    expect(v('Char', 'x')).toBe('"x"');
    expect([v('Decimal', CsDecimal.parseInvariant('12.50')), v('Decimal', CsDecimal.fromParts(0n, 3, true))]).toEqual(['12.50', '0.000']);
    expect([v('Double', 0.00001), v('Double', 1.5), v('Double', 1e21), v('Double', 5e-324), v('Double', 1 / 3)]).toEqual([
      '1E-05',
      '1.5',
      '1E+21',
      '5E-324',
      '0.3333333333333333',
    ]);
    expect(v('Binary', new Uint8Array([0xff]))).toBe('"/w=="');
    // the Variant GETVALUEFROMSQL passes (VariantSystemTextJsonConverter), its type by its DbType
    const variant = (value: DataValue, dbType: QueryParameter['dbType']) => jsonParameterValue(param('@P', 'Object', value, dbType));
    expect([
      variant(null, 'Object'),
      variant(true, 'Boolean'),
      variant(7, 'Byte'),
      variant('x', 'SByte'),
      variant(5, 'Int32'),
      variant(5000000000n, 'Int64'),
      variant(CsDecimal.parseInvariant('12.50'), 'Decimal'),
      variant(0.1, 'Double'),
      variant(2, 'Double'),
      variant(RpDateTime.create(2024, 2, 29, 13, 45, 30, 500), 'DateTime'),
      variant(RpDateTime.create(2024, 2, 29, 0, 0, 0, 0, DateTimeKind.Utc), 'DateTime'),
      variant(new Uint8Array([1, 2, 255]), 'Binary'),
      variant("a<b&'\"é", 'String'),
    ]).toEqual([
      '{"Type":"Null","Value":{}}',
      '{"Type":"Boolean","Value":true}',
      '{"Type":"Byte","Value":7}',
      '{"Type":"Char","Value":"x"}',
      '{"Type":"Integer","Value":5}',
      '{"Type":"Long","Value":5000000000}',
      '{"Type":"Decimal","Value":12.50}',
      '{"Type":"Double","Value":0.1}',
      '{"Type":"Double","Value":2}',
      '{"Type":"DateTime","Value":"2024-02-29T13:45:30.5"}',
      '{"Type":"DateTime","Value":"2024-02-29T00:00:00Z"}',
      '{"Type":"Binary","Value":null}',
      '{"Type":"String","Value":"a\\u003Cb\\u0026\\u0027\\u0022\\u00E9"}',
    ]);
    expect(executeBody(7n, 'S', [param('@P', 'Object', 5, 'Int32')])).toBe(
      '{"hubDatabaseId":7,"sql":"S","parameters":[{"name":"@P","value":{"Type":"Integer","Value":5},"dbType":11}]}',
    );
    expect(() => v('Double', Number.NaN)).toThrow(/cannot be written as valid JSON/);
    expect(() => v('Double', Number.POSITIVE_INFINITY)).toThrow(/AllowNamedFloatingPointLiterals/);
  });

  it('writes a DateTime with its fraction and its kind', () => {
    expect(jsonDateTime(RpDateTime.create(2024, 2, 29))).toBe('"2024-02-29T00:00:00"');
    expect(jsonDateTime(RpDateTime.create(2024, 2, 29, 13, 45, 30, 500))).toBe('"2024-02-29T13:45:30.5"');
    expect(jsonDateTime(RpDateTime.fromTicks(3155378975999999999n))).toBe('"9999-12-31T23:59:59.9999999"');
    expect(jsonDateTime(RpDateTime.create(2024, 2, 29, 1, 2, 3, 0, DateTimeKind.Utc))).toBe('"2024-02-29T01:02:03Z"');
    const local = RpDateTime.create(2024, 7, 1, 10, 0, 0, 0, DateTimeKind.Local);
    const offset = -new Date(2024, 6, 1, 10, 0, 0).getTimezoneOffset();
    const sign = offset < 0 ? '-' : '+';
    const hhmm = String(Math.floor(Math.abs(offset) / 60)).padStart(2, '0') + ':' + String(Math.abs(offset) % 60).padStart(2, '0');
    expect(jsonDateTime(local)).toBe(`"2024-07-01T10:00:00${sign}${hhmm}"`);
  });

  it('escapes strings as the default encoder does', () => {
    const body = executeBody(7n, 'SELECT \'a\' "b" <c> & + ` \\ \u00f1 \u20ac \ud83d\ude00 \u0001\u007f\b\f\n\r\t \ud800', [param('N\u00f1', 'String', '', 'String')]);
    expect(body).toBe(
      '{"hubDatabaseId":7,"sql":"SELECT \\u0027a\\u0027 \\u0022b\\u0022 \\u003Cc\\u003E \\u0026 \\u002B \\u0060 \\\\ \\u00F1 \\u20AC \\uD83D\\uDE00 ' +
        '\\u0001\\u007F\\b\\f\\n\\r\\t \\uFFFD","parameters":[{"name":"N\\u00F1","value":"","dbType":16}]}',
    );
    expect(jsonDouble(-0)).toBe('-0');
  });
});

describe('the JSON of the answers (JsonDocument)', () => {
  const message = (text: string): string => {
    try {
      parseJson(text);
      return 'ok';
    } catch (e) {
      return (e as Error).message;
    }
  };

  it('fails as JsonDocument.Parse does', () => {
    expect(message('-')).toBe("Expected a digit ('0'-'9'), but instead reached end of data. LineNumber: 0 | BytePositionInLine: 1.");
    expect(message('tr')).toBe("'tr' is an invalid JSON literal. Expected the literal 'true'. LineNumber: 0 | BytePositionInLine: 2.");
    expect(message('{"a":' + '{"a":'.repeat(64) + '1' + '}'.repeat(65))).toMatch(/^The maximum configured depth of 64 has been exceeded\. Cannot read next JSON object\./);
    expect(message('[}')).toBe("'}' is invalid without a matching open. LineNumber: 0 | BytePositionInLine: 1.");
    expect(message('"\u00f1" x')).toBe("'x' is invalid after a single JSON value. Expected end of data. LineNumber: 0 | BytePositionInLine: 5.");
    expect(message('{"a":1,}')).toMatch(/^The JSON object contains a trailing comma/);
    expect(message('[1,]')).toMatch(/^The JSON array contains a trailing comma/);
    expect(message(' 1 ')).toBe('ok');
  });

  it('keeps the raw text of numbers, objects and arrays; the last of two properties wins', () => {
    const root = parseJson('{"a":1,"a":{"x": [1, 2.50]},"n":12345678901234567890,"s":"\\u00f1"}');
    expect(elementToString(tryGetProperty(root, 'a')!)).toBe('{"x": [1, 2.50]}');
    expect(toPlain(root)).toEqual({ a: { x: [1, 2.5] }, n: '12345678901234567890', s: '\u00f1' });
    expect(tryGetProperty(root, 'A')).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------------------------

describe('the cells of the answer (DeserializeDataTable)', () => {
  it('maps the .NET type names of the Hub', () => {
    expect(['Int32', 'Int64', 'Int16', 'Decimal', 'Double', 'Single', 'Boolean', 'DateTime', 'Byte[]', 'Byte', 'Guid', 'int'].map(mapTypeName)).toEqual([
      'Int32', 'Int64', 'Int16', 'Decimal', 'Double', 'Single', 'Boolean', 'DateTime', 'Binary', 'String', 'String', 'String',
    ]);
  });

  it('reads the ISO 8601 dates of System.Text.Json', () => {
    const d = (s: string) => parseIsoDateTime(s)?.toString();
    expect(d('2024-02-29')).toBe('2024-02-29T00:00:00.0000000');
    expect(d('2024-02-29T13:45')).toBe('2024-02-29T13:45:00.0000000');
    expect(d('2024-02-29T13:45:30.123456789')).toBe('2024-02-29T13:45:30.1234567');
    expect(d('2024-02-29T13:45:30Z')).toBe('2024-02-29T13:45:30.0000000');
    expect(parseIsoDateTime('2024-02-29T13:45:30Z')!.kind).toBe(DateTimeKind.Unspecified);
    for (const bad of ['2023-02-29', '2024-02-29T24:00', '2024-02-29T10', '2024-02-29t10:00', '2024-02-29 10:00', '0000-01-01', '2024-01-01T10:00+15:00', '2024-1-01'])
      expect(parseIsoDateTime(bad), bad).toBeUndefined();
    const utc = Date.UTC(2024, 0, 15, 15, 30);
    const local = new Date(utc);
    expect(d('2024-01-15T10:00:00-05:30')).toBe(
      RpDateTime.create(local.getFullYear(), local.getMonth() + 1, local.getDate(), local.getHours(), local.getMinutes()).toString(),
    );
  });

  it('gives the value of a cell of its type, or its text', () => {
    const cell = (json: string, type: Parameters<typeof convertJsonValue>[1]) => convertJsonValue(parseJson(json), type);
    expect([cell('7', 'Int32'), cell('7.0', 'Int32'), cell('"7"', 'Int32'), cell('2147483648', 'Int32')]).toEqual([7, '7.0', '7', '2147483648']);
    expect([cell('9007199254740993', 'Int64'), cell('40000', 'Int16')]).toEqual([9007199254740993n, '40000']);
    expect((cell('1.5E1', 'Decimal') as CsDecimal).toInvariantString()).toBe('15');
    expect([cell('1e400', 'Double'), cell('1e39', 'Single'), cell('0.1', 'Single')]).toEqual(['1e400', '1e39', Math.fround(0.1)]);
    expect([cell('true', 'Boolean'), cell('1', 'Boolean'), cell('"x"', 'String'), cell('true', 'String'), cell('[1, 2]', 'String')]).toEqual([
      true, '1', 'x', 'True', '[1, 2]',
    ]);
    expect([cell('""', 'Binary'), cell('5', 'Binary'), cell('"AAE="', 'Binary'), cell('"!"', 'Binary')]).toEqual([
      new Uint8Array(0), new Uint8Array(0), new Uint8Array([0, 1]), '!',
    ]);
  });

  it('builds the columns as a DataTable: names given to the empty ones, duplicates refused', () => {
    const r = deserializeTable('{"columns":[{"name":"Column1","dataType":"Int32"},{"name":"","dataType":null}],"rows":[[1],[1,"x",3]]}');
    expect(r.columns.map((c) => [c.name, c.type])).toEqual([
      ['Column1', 'Int32'],
      ['Column2', 'String'],
    ]);
    expect(r.rows).toEqual([[1, null], [1, 'x']]);
    // an explicit name after the one given to an empty name is a duplicate, as in a DataTable
    expect(() => deserializeTable('{"columns":[{"name":"","dataType":"Int32"},{"name":"Column1","dataType":"Int32"}],"rows":[]}')).toThrow("A column named 'Column1'");
    expect(() => deserializeTable('{"columns":[{"name":"A","dataType":"Int32"},{"name":"A","dataType":"Int32"}],"rows":[]}')).toThrow(
      "A column named 'A' already belongs to this DataTable.",
    );
    expect(() => deserializeTable('{"columns":[{"name":"N","dataType":"Int16"}],"rows":[["99999999999999999999"]]}')).toThrow(
      "Value was either too large or too small for an Int16.Couldn't store <99999999999999999999> in N Column.  Expected type is Int16.",
    );
  });
});

describe('the text of an answer (HttpContent.ReadAsStringAsync)', () => {
  const bytes = (...b: number[]) => new Uint8Array(b);
  it('decodes by the charset, else the byte order mark, else UTF-8', () => {
    expect(readContentAsString(bytes(0xef, 0xbb, 0xbf, 0x41), 'application/json')).toBe('A');
    expect(readContentAsString(bytes(0xff, 0xfe, 0x41, 0x00), null)).toBe('A');
    expect(readContentAsString(bytes(0xfe, 0xff, 0x00, 0x41), undefined)).toBe('A');
    expect(readContentAsString(bytes(0xe9, 0x80), 'text/plain; charset="ISO-8859-1"')).toBe('\u00e9\u0080');
    expect(readContentAsString(bytes(0xe9, 0x80), 'text/plain; charset=windows-1252')).toBe('\u00e9\u20ac');
    expect(readContentAsString(bytes(0x41, 0xe9), 'text/plain; charset=us-ascii')).toBe('A?');
    expect(() => readContentAsString(bytes(0x41), 'application/json; charset=nope')).toThrow(/The character set provided in ContentType is invalid/);
    expect(decodeUtf8(bytes(0xc3, 0x28, 0xff, 0xe2, 0x82, 0x41, 0xf0, 0x9f, 0x98, 0x80))).toBe('\ufffd(\ufffd\ufffdA\ud83d\ude00');
  });
});
