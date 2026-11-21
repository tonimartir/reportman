// A local mock of the Reportman Hub (aiapi.reportman.es) for the tests: the routes the C# executor
// (HttpAgentExecutor, DirectAgentExecutor) calls, answered from samples/samples.db through node:sqlite,
// and a log of every request it receives, so the requests of both engines can be compared. The tests
// never call the real Hub.
//
//   POST /api/agent/execute         {hubDatabaseId, sql, parameters:[{name,value,dbType}]}
//                                   -> {success:true, data:{columns:[{name,dataType}], rows:[[...]]}}
//                                      or {success:false, error} (an error of the database)
//   POST /api/agent/testconnection  -> {success, data:{agentConnectionSuccess, databaseConnectionSuccess,
//                                      databaseError, message}, error}
//   POST /api/agent/readtables, readcolumns, readforeignkeys -> {success:true, data:{tables|columns|foreignKeys}}
//   GET  /api/agent/databases       -> {databases:[{hubDatabaseId, name, dialect, isExample}]}
//   POST /api/data-session/start    -> 404: no direct channel, the C# engine falls back to HTTP
//
// Databases: 7 is an example (answers to everybody), 17 needs the API key or the session of AUTH, any
// other is not found. A SQL text "CANNED name" answers the canned response `name` (CANNED below): every
// column type the Hub returns, malformed answers, HTTP errors, a slow answer.
//
// It is written in the TypeScript Node runs as it is (type stripping), so that generate-fixtures.ts
// can use it without a build.

import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { DatabaseSync, type SQLInputValue } from 'node:sqlite';

const here = path.dirname(fileURLToPath(import.meta.url));
export const samplesDb = path.resolve(here, '../../../../samples/samples.db');

/** The credentials database 17 accepts. */
export const AUTH = { apiKey: 'rm-test-api-key', token: 'rm-test-token', installId: 'rm-test-install' };
export const EXAMPLE_DB = 7;
export const PRIVATE_DB = 17;

/** A request the mock received: what the comparisons look at. */
export interface HubRequest {
  method: string;
  path: string;
  /** The headers that carry the request (content type and credentials), as received (lower case names). */
  headers: Record<string, string>;
  /** The body as text (UTF-8). */
  body: string;
}

const LOGGED_HEADERS = ['content-type', 'x-reportman-apikey', 'authorization', 'x-reportman-webinstallid'];

/** A canned answer: status, content type, body (text, or bytes) and an optional delay. */
interface Canned {
  status?: number;
  contentType?: string;
  body: string | Uint8Array;
  delayMs?: number;
}

const ok = (data: string): string => '{"success":true,"data":' + data + '}';

/**
 * The canned answers. TYPES has a column of each dataType the Hub writes (the .NET type names of the
 * Agent's DataTable) and the names it may write that HttpAgentExecutor does not map (they are text),
 * with edge values; MISMATCH has cells of another JSON kind than their column, which C# converts
 * through the DataTable (or fails on, see the error cases).
 */
export const CANNED: Record<string, Canned> = {
  types: {
    body: ok(
      '{"columns":[' +
        '{"name":"ID","dataType":"Int32"},{"name":"I16","dataType":"Int16"},{"name":"I32","dataType":"Int32"},' +
        '{"name":"I64","dataType":"Int64"},{"name":"DEC","dataType":"Decimal"},{"name":"DBL","dataType":"Double"},' +
        '{"name":"SGL","dataType":"Single"},{"name":"BOOL","dataType":"Boolean"},{"name":"DT","dataType":"DateTime"},' +
        '{"name":"BIN","dataType":"Byte[]"},{"name":"STR","dataType":"String"},{"name":"GUID","dataType":"Guid"},' +
        '{"name":"BYTE","dataType":"Byte"},{"name":"TS","dataType":"TimeSpan"},{"name":"NOTYPE","dataType":null}' +
        '],"rows":[' +
        '[1,-32768,-2147483648,-9223372036854775808,-79228162514264337593543950335,-1.7976931348623157E+308,-3.4028235E+38,false,"0001-01-01T00:00:00","","","00000000-0000-0000-0000-000000000000",0,"00:00:00","a"],' +
        '[2,32767,2147483647,9223372036854775807,79228162514264337593543950335,1.7976931348623157E+308,3.4028235E+38,true,"9999-12-31T23:59:59.9999999","/w==","\\u00f1 \\" \\\\ \\n \\t \\u20ac \\ud83d\\ude00","6f9619ff-8b86-d011-b42d-00c04fc964ff",255,"1.02:03:04.5000000","b"],' +
        '[3,0,0,9007199254740993,0.1,0.1,0.1,true,"2024-02-29","AAECAwQFBgcICQ==","plain","x",7,"-00:00:01","c"],' +
        '[4,null,null,null,null,null,null,null,null,null,null,null,null,null,null],' +
        '[5,1,2,3,12.50,1E-05,1.5,false,"2024-02-29T13:45","AA==","x","y",1,"z","d"],' +
        '[6,-1,-2,-3,-0.000,5e-324,1e-45,true,"2024-02-29T13:45:30.1234567","QUJD","",null,2,null,"e"],' +
        '[7,100,100000,1234567890123,1E+3,123456789012345680000,16777217,false,"2000-01-01T00:00:00.5","SGVsbG8gV29ybGQ=","end","g",3,"t","f"]' +
        ']}',
    ),
  },
  'types-zone': {
    body: ok(
      '{"columns":[{"name":"ID","dataType":"Int32"},{"name":"DT","dataType":"DateTime"}],"rows":[' +
        '[1,"2024-02-29T13:45:30Z"],[2,"2024-02-29T13:45:30.5Z"],[3,"2024-07-01T10:00:00+02:00"],[4,"2024-01-15T10:00:00-05:30"]]}',
    ),
  },
  mismatch: {
    body: ok(
      '{"columns":[' +
        '{"name":"ID","dataType":"Int32"},{"name":"I32","dataType":"Int32"},{"name":"I64","dataType":"Int64"},' +
        '{"name":"DEC","dataType":"Decimal"},{"name":"DBL","dataType":"Double"},{"name":"BOOL","dataType":"Boolean"},' +
        '{"name":"DT","dataType":"DateTime"},{"name":"BIN","dataType":"Byte[]"},{"name":"STR","dataType":"String"}' +
        '],"rows":[' +
        '[1,"12","34","5.25","1.5","true","2024-02-29 10:30:00",12,12.50],' +
        '[2," 7 ","-8","1,234.5","1e400","False","02/29/2024",true,true],' +
        '[3,"+5",7,"0.5",1e-400," TRUE ","2024-02-29T10:30:00.123+00:00",{"a":1},{"a": [1, 2]}],' +
        '[4,5,6,7,8,true,"2024-02-29",[1],[1, 2 ,3]],' +
        '[5,6,7,8,9,false,"2024-02-29","",false],' +
        '[6],' +
        '[7,1,2,3,4,true,"2024-01-01","AA==","x","extra",5]' +
        ']}',
    ),
  },
  'no-rows': { body: ok('{"columns":[{"name":"A","dataType":"Int32"},{"name":"B","dataType":"String"}],"rows":[]}') },
  'no-columns': { body: ok('{"columns":[],"rows":[]}') },
  'no-envelope': { body: '{"columns":[{"name":"A","dataType":"Int64"}],"rows":[[1],[2]]}' },
  'empty-name': { body: ok('{"columns":[{"name":"","dataType":"Int32"},{"name":null,"dataType":"String"}],"rows":[[1,"x"]]}') },
  'bad-int32': { body: ok('{"columns":[{"name":"N","dataType":"Int32"}],"rows":[[12.5]]}') },
  'bad-int64': { body: ok('{"columns":[{"name":"N","dataType":"Int64"}],"rows":[[9223372036854775808]]}') },
  'bad-decimal': { body: ok('{"columns":[{"name":"N","dataType":"Decimal"}],"rows":[[1e40]]}') },
  'bad-boolean': { body: ok('{"columns":[{"name":"B","dataType":"Boolean"}],"rows":[[1]]}') },
  'bad-datetime': { body: ok('{"columns":[{"name":"D","dataType":"DateTime"}],"rows":[["not a date"]]}') },
  'bad-base64': { body: ok('{"columns":[{"name":"B","dataType":"Byte[]"}],"rows":[["not base64!"]]}') },
  'duplicate-column': { body: ok('{"columns":[{"name":"A","dataType":"Int32"},{"name":"A","dataType":"Int32"}],"rows":[[1,2]]}') },
  'missing-rows': { body: ok('{"columns":[{"name":"A","dataType":"Int32"}]}') },
  'missing-name': { body: ok('{"columns":[{"dataType":"Int32"}],"rows":[]}') },
  'rows-not-array': { body: ok('{"columns":[{"name":"A","dataType":"Int32"}],"rows":{}}') },
  'row-not-array': { body: ok('{"columns":[{"name":"A","dataType":"Int32"}],"rows":[1]}') },
  'name-not-string': { body: ok('{"columns":[{"name":5,"dataType":"Int32"}],"rows":[]}') },
  'success-false': { body: '{"success":false,"error":"The Agent of this database is not connected"}' },
  'success-false-null-error': { body: '{"success":false,"error":null}' },
  'success-false-no-error': { body: '{"success":false}' },
  'success-false-null-data': { body: '{"success":false,"error":"x","data":null}' },
  'success-not-bool': { body: '{"success":"false","error":"x"}' },
  'data-success-false': { body: '{"success":true,"data":{"success":false,"error":"inner"}}' },
  'root-array': { body: '[1,2]' },
  'html-200': { contentType: 'text/html', body: '<html><body>Bad gateway</body></html>' },
  'empty-200': { contentType: 'text/plain', body: '' },
  'truncated-json': { body: '{"success":true,"data":{"columns":[' },
  'status-400': { status: 400, body: '{"success":false,"error":"Missing sql"}' },
  'status-401': { status: 401, contentType: 'text/plain', body: 'Unauthorized' },
  'status-404': { status: 404, body: '' },
  'status-418': { status: 418, contentType: 'text/plain', body: 'teapot' },
  'status-422': { status: 422, body: '{"error":"x"}' },
  'status-500': { status: 500, contentType: 'text/plain', body: 'Internal error: ñ' },
  'status-502': { status: 502, contentType: 'text/html', body: '<h1>502</h1>' },
  'status-503': { status: 503, body: '{"success":false,"error":"busy"}' },
  // the names of the status codes .NET has twice (HttpStatusCode.ToString()); a redirection without
  // Location is not followed
  'status-300': { status: 300, body: 'x' },
  'status-301': { status: 301, body: 'x' },
  'status-302': { status: 302, body: 'x' },
  'status-303': { status: 303, body: 'x' },
  'status-307': { status: 307, body: 'x' },
  'status-413': { status: 413, body: 'x' },
  'status-429': { status: 429, body: 'x' },
  'status-504': { status: 504, body: 'x' },
  'status-599': { status: 599, body: 'x' },
  'bad-charset': { contentType: 'application/json; charset=no-such-charset', body: ok('{"columns":[],"rows":[]}') },
  'quoted-charset': {
    contentType: 'application/json; charset="iso-8859-1"',
    body: new Uint8Array([...new TextEncoder().encode(ok('{"columns":[{"name":"A","dataType":"String"}],"rows":[["')), 0xe9, 0x80, ...new TextEncoder().encode('"]]}}')]),
  },
  'utf16-bom': {
    contentType: 'application/json',
    body: new Uint8Array([0xff, 0xfe, ...[...ok('{"columns":[{"name":"A","dataType":"String"}],"rows":[["é€"]]}')].flatMap((ch) => [ch.charCodeAt(0) & 0xff, ch.charCodeAt(0) >> 8])]),
  },
  'bad-utf8': {
    body: new Uint8Array([...new TextEncoder().encode(ok('{"columns":[{"name":"A","dataType":"String"}],"rows":[["')), 0xc3, 0x28, 0xff, 0xe2, 0x82, ...new TextEncoder().encode('"]]}}')]),
  },
  'duplicate-property': { body: '{"success":true,"data":{"columns":[{"name":"X","name":"A","dataType":"Int32","dataType":"Int64"}],"rows":[[1]],"rows":[[5],[6]]}}' },
  'case-property': { body: '{"Success":false,"Data":{"columns":[{"name":"A","dataType":"Int32"}],"rows":[[1]]},"columns":[{"name":"B","dataType":"Int32"}],"rows":[[2]]}' },
  'deep-json': { body: '{"columns":[],"rows":[],"x":' + '['.repeat(70) + ']'.repeat(70) + '}' },
  'trailing-comma': { body: '{"columns":[],"rows":[],}' },
  'trailing-text': { body: '{"columns":[],"rows":[]} x' },
  'comment-json': { body: '{"columns":[],"rows":[]} // done' },
  'leading-zero': { body: ok('{"columns":[{"name":"A","dataType":"Int32"}],"rows":[[01]]}') },
  'bad-escape': { body: ok('{"columns":[{"name":"A\\x","dataType":"Int32"}],"rows":[]}') },
  'control-in-string': { body: ok('{"columns":[{"name":"A\tB","dataType":"Int32"}],"rows":[]}') },
  'bad-literal': { body: ok('{"columns":[],"rows":[],"z":nul}') },
  'bad-literal-long': { body: '{"columns":[],"rows":[],"z":trxe, "a":1, "b":"ññ"}' },
  'bad-number': { body: '{"columns":[],"rows":[],"z":-x}' },
  'bad-number2': { body: '{"columns":[],"rows":[],"z":1.}' },
  'bad-number3': { body: '{"columns":[],"rows":[],"z":12x}' },
  'bad-number4': { body: '{"columns":[],"rows":[],"z":1e}' },
  'bad-property': { body: '{"columns":[],"rows":[],z:1}' },
  'bad-colon': { body: '{"columns":[],"rows":[],"z" 1}' },
  'mismatched': { body: '{"columns":[],"rows":[]]' },
  'bad-hex': { body: '{"columns":[],"rows":[],"z":"\\u12G4"}' },
  'eof-after-name': { body: '{"columns":[],"rows":[],"z"' },
  'unterminated-string': { body: ok('{"columns":[{"name":"A') },
  'multiline-error': { body: '{\n  "columns": [\n    {"name": "A", "dataType": "Int32"}\n  ],\n  "rows": [[1] [2]]\n}' },
  'non-ascii-error': { body: '{"columns":[],"rows":[]}ñ' },
  'whitespace-only': { body: ' \r\n  ' },
  'linked-rows': {
    body: ok(
      '{"columns":[{"name":"K","dataType":"Int32"},{"name":"V","dataType":"String"}],"rows":[[1,"one"],[2,"two"],[3,"three"]]}',
    ),
  },
  'utf8-bom': { body: new Uint8Array([0xef, 0xbb, 0xbf, ...new TextEncoder().encode(ok('{"columns":[{"name":"A","dataType":"String"}],"rows":[["ñ"]]}'))]) },
  latin1: {
    contentType: 'application/json; charset=iso-8859-1',
    body: new Uint8Array([...new TextEncoder().encode(ok('{"columns":[{"name":"A","dataType":"String"}],"rows":[["')), 0xf1, ...new TextEncoder().encode('"]]}}')]),
  },
  slow: { delayMs: 1500, body: ok('{"columns":[{"name":"A","dataType":"Int32"}],"rows":[[1]]}') },
  'very-slow': { delayMs: 102000, body: ok('{"columns":[{"name":"A","dataType":"Int32"}],"rows":[[1]]}') },
};

/** The parts of a request body the mock reads. */
interface Parsed {
  hubDatabaseId?: unknown;
  sql?: unknown;
  parameters?: { name?: unknown; value?: unknown; dbType?: unknown }[];
  tableName?: unknown;
}

function parseBody(body: string): Parsed {
  try {
    return JSON.parse(body) as Parsed;
  } catch {
    return {};
  }
}

// ---------------------------------------------------------------------------------------------
// The answers of a query on samples.db, typed as an Agent types its DataTable

/** A DbType of the request (System.Data.DbType). */
const DbType = { Binary: 1, Boolean: 3, DateTime: 6, Decimal: 7, Double: 8, Int32: 11, Int64: 12, String: 16 };

/** A parameter value as Microsoft.Data.Sqlite binds it. */
function bindValue(value: unknown, dbType: unknown): SQLInputValue {
  if (value === null || value === undefined) return null;
  if (typeof value === 'object') return null; // DBNull ({})
  if (typeof value === 'boolean') return value ? 1 : 0;
  if (typeof value === 'string') {
    if (dbType === DbType.DateTime) {
      // yyyy-MM-dd HH:mm:ss.FFFFFFF, without the offset
      const m = /^(\d{4}-\d{2}-\d{2})T(\d{2}:\d{2}:\d{2})(\.\d+)?/.exec(value);
      if (m !== null) return m[1] + ' ' + m[2] + (m[3] ?? '');
    }
    if (dbType === DbType.Binary) return new Uint8Array(Buffer.from(value, 'base64'));
    return value;
  }
  if (typeof value === "number") return Number.isSafeInteger(value) ? BigInt(value) : value;
  return String(value);
}

/** The placeholders of a SQL text (:NAME, @NAME, $NAME) outside quotes. */
function placeholders(sql: string): string[] {
  const found: string[] = [];
  const re = /'(?:[^']|'')*'|"(?:[^"]|"")*"|([:@$])([A-Za-z_][A-Za-z0-9_]*)/g;
  for (let m = re.exec(sql); m !== null; m = re.exec(sql)) if (m[1] !== undefined) found.push(m[1] + m[2]);
  return found;
}

type DataType = 'Int64' | 'Double' | 'String' | 'Byte[]' | 'DateTime' | 'Decimal' | 'Boolean';

function declaredType(declared: string | null): DataType | undefined {
  if (declared === null) return undefined;
  const t = declared.toUpperCase();
  if (t.includes('INT')) return 'Int64';
  if (t.includes('CHAR') || t.includes('CLOB') || t.includes('TEXT')) return 'String';
  if (t.includes('BLOB')) return 'Byte[]';
  if (t.includes('REAL') || t.includes('FLOA') || t.includes('DOUB')) return 'Double';
  if (t.includes('DATE') || t.includes('TIME')) return 'DateTime';
  if (t.includes('NUMERIC') || t.includes('DECIMAL')) return 'Decimal';
  if (t.includes('BOOL')) return 'Boolean';
  return 'String';
}

/** The type of an expression column, from its values (a REAL anywhere makes it Double). */
function valuesType(values: unknown[]): DataType {
  let type: DataType | undefined;
  for (const v of values) {
    if (v === null || v === undefined) continue;
    if (typeof v === 'number') return 'Double';
    const t: DataType = typeof v === 'bigint' ? 'Int64' : typeof v === 'string' ? 'String' : 'Byte[]';
    if (type === undefined) type = t;
    else if (type !== t) return 'String';
  }
  return type ?? 'String';
}

function jsonString(s: string): string {
  return JSON.stringify(s);
}

function cellJson(value: unknown, type: DataType): string {
  if (value === null || value === undefined) return 'null';
  switch (type) {
    case 'Int64':
      return typeof value === 'bigint' ? value.toString() : jsonString(String(value));
    case 'Double':
    case 'Decimal':
      if (typeof value === 'number' || typeof value === 'bigint') return String(value);
      return jsonString(String(value));
    case 'Boolean':
      return value === 0n || value === 0 ? 'false' : 'true';
    case 'Byte[]':
      return value instanceof Uint8Array ? jsonString(Buffer.from(value).toString('base64')) : jsonString(String(value));
    case 'DateTime': {
      const s = String(value);
      const m = /^(\d{4}-\d{2}-\d{2})(?:[ T](\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?))?$/.exec(s);
      if (m === null) return jsonString(s);
      return jsonString(m[1] + 'T' + (m[2] === undefined ? '00:00:00' : m[2].length === 5 ? m[2] + ':00' : m[2]));
    }
    case 'String':
      return jsonString(value instanceof Uint8Array ? Buffer.from(value).toString('utf8') : String(value));
  }
}

function runSql(db: DatabaseSync, sql: string, parameters: Parsed['parameters']): string {
  const stmt = db.prepare(sql);
  stmt.setReadBigInts(true);
  const bound: Record<string, SQLInputValue> = {};
  const names = placeholders(sql);
  for (const p of parameters ?? []) {
    if (typeof p.name !== 'string') continue;
    const name = p.name.startsWith('@') || p.name.startsWith(':') ? p.name.substring(1) : p.name;
    for (const ph of names) if (ph.substring(1).toUpperCase() === name.toUpperCase()) bound[ph] = bindValue(p.value, p.dbType);
  }
  stmt.setAllowBareNamedParameters(false);
  const columns = stmt.columns();
  const rows = stmt.all(bound) as Record<string, unknown>[];
  const keys = columns.map((c) => c.name);
  const values = rows.map((r) => keys.map((k) => r[k]));
  const types = columns.map((c, i) => declaredType(c.type) ?? valuesType(values.map((v) => v[i])));
  return ok(
    '{"columns":[' +
      columns.map((c, i) => '{"name":' + jsonString(c.name) + ',"dataType":"' + types[i] + '"}').join(',') +
      '],"rows":[' +
      values.map((v) => '[' + v.map((cell, i) => cellJson(cell, types[i]!)).join(',') + ']').join(',') +
      ']}',
  );
}

// ---------------------------------------------------------------------------------------------
// The catalog of the database (what app.reportman.es/database-config reads)

function catalog(db: DatabaseSync, route: string, tableName: unknown): string {
  if (route === 'readtables') {
    const tables = db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name").all() as { name: string }[];
    return ok('{"tables":[' + tables.map((t) => '{"tableName":' + jsonString(t.name) + ',"tableType":"TABLE"}').join(',') + ']}');
  }
  const table = typeof tableName === 'string' ? tableName.replace(/[^A-Za-z0-9_]/g, '') : '';
  if (route === 'readcolumns') {
    const cols = db.prepare(`PRAGMA table_info(${table})`).all() as { name: string; type: string; notnull: number }[];
    return ok(
      '{"columns":[' +
        cols.map((c) => `{"columnName":${jsonString(c.name)},"dataType":${jsonString(c.type)},"isNullable":${c.notnull === 0}}`).join(',') +
        ']}',
    );
  }
  const fks = table.length === 0 ? [] : (db.prepare(`PRAGMA foreign_key_list(${table})`).all() as { table: string; from: string; to: string }[]);
  return ok(
    '{"foreignKeys":[' +
      fks.map((f) => `{"tableName":${jsonString(table)},"columnName":${jsonString(f.from)},"referencedTable":${jsonString(f.table)},"referencedColumn":${jsonString(f.to)}}`).join(',') +
      ']}',
  );
}

// ---------------------------------------------------------------------------------------------

export class MockHub {
  readonly requests: HubRequest[] = [];
  private readonly server: http.Server;
  private readonly db: DatabaseSync;
  url = '';

  private constructor() {
    this.db = new DatabaseSync(samplesDb, { readOnly: true });
    this.server = http.createServer((req, res) => {
      const chunks: Buffer[] = [];
      req.on('data', (c: Buffer) => chunks.push(c));
      req.on('end', () => {
        const body = Buffer.concat(chunks).toString('utf8');
        const headers: Record<string, string> = {};
        for (const h of LOGGED_HEADERS) {
          const v = req.headers[h];
          if (typeof v === 'string') headers[h] = v;
        }
        const request: HubRequest = { method: req.method ?? '', path: req.url ?? '', headers, body };
        this.requests.push(request);
        this.answer(request, res);
      });
    });
    // a slow answer the client gave up on must not keep the server open
    this.server.keepAliveTimeout = 1000;
  }

  static async start(): Promise<MockHub> {
    const hub = new MockHub();
    await new Promise<void>((resolve) => hub.server.listen(0, '127.0.0.1', () => resolve()));
    const address = hub.server.address();
    if (address === null || typeof address === 'string') throw new Error('No address');
    hub.url = 'http://127.0.0.1:' + address.port;
    return hub;
  }

  /** The requests of api/agent/execute (the ones both engines send). */
  executeRequests(): HubRequest[] {
    return this.requests.filter((r) => r.path === '/api/agent/execute');
  }

  clear(): void {
    this.requests.length = 0;
  }

  async close(): Promise<void> {
    this.server.closeAllConnections();
    await new Promise<void>((resolve) => this.server.close(() => resolve()));
    this.db.close();
  }

  private answer(request: HubRequest, res: http.ServerResponse): void {
    const send = (status: number, body: string | Uint8Array, contentType = 'application/json; charset=utf-8', delayMs = 0): void => {
      const write = (): void => {
        if (res.destroyed) return;
        const bytes = typeof body === 'string' ? Buffer.from(body, 'utf8') : Buffer.from(body);
        res.writeHead(status, { 'Content-Type': contentType, 'Content-Length': bytes.length });
        res.end(bytes);
      };
      if (delayMs > 0) {
        const timer = setTimeout(write, delayMs);
        res.on('close', () => clearTimeout(timer));
      } else write();
    };
    const route = request.path.replace(/^\/api\/agent\//, '');
    if (request.path === '/api/agent/databases' && request.method === 'GET') {
      send(
        200,
        '{"databases":[{"hubDatabaseId":7,"hubSchemaId":21,"name":"Samples","displayName":"Samples - Example","isExample":true,"dialect":"SQLite"},' +
          '{"hubDatabaseId":"17","name":"Private","isExample":false,"dialect":" SQLite3 "}]}',
      );
      return;
    }
    const known = ['execute', 'testconnection', 'readtables', 'readcolumns', 'readforeignkeys'];
    if (request.method !== 'POST' || !request.path.startsWith('/api/agent/') || !known.includes(route)) {
      send(404, '{}');
      return;
    }
    const body = parseBody(request.body);
    const id = typeof body.hubDatabaseId === 'number' ? body.hubDatabaseId : Number(body.hubDatabaseId);
    if (id !== EXAMPLE_DB && id !== PRIVATE_DB) {
      send(404, '{"success":false,"error":"Database ' + String(body.hubDatabaseId) + ' not found"}');
      return;
    }
    if (id === PRIVATE_DB) {
      const key = request.headers['x-reportman-apikey'] ?? '';
      const authorization = request.headers['authorization'] ?? '';
      if (key.length === 0 && authorization.length === 0) {
        send(403, 'No access to this database. Valid API Key or Login required.', 'text/plain; charset=utf-8');
        return;
      }
      const bearerOk = authorization === 'Bearer ' + AUTH.token && request.headers['x-reportman-webinstallid'] === AUTH.installId;
      if (key !== AUTH.apiKey && !bearerOk) {
        send(403, '{"success":false,"error":"Invalid credentials"}');
        return;
      }
    }
    if (route === 'testconnection') {
      send(
        200,
        '{"success":true,"data":{"agentConnectionSuccess":true,"databaseConnectionSuccess":true,"databaseError":null,"message":"Agent Connection: Success"},"error":null}',
      );
      return;
    }
    if (route !== 'execute') {
      send(200, catalog(this.db, route, body.tableName));
      return;
    }
    const sql = typeof body.sql === 'string' ? body.sql : '';
    const canned = /^\s*CANNED\s+([\w-]+)/.exec(sql);
    if (canned !== null) {
      const c = CANNED[canned[1]!];
      if (c === undefined) send(200, '{"success":false,"error":"No canned answer ' + canned[1] + '"}');
      else send(c.status ?? 200, c.body, c.contentType, c.delayMs);
      return;
    }
    try {
      send(200, runSql(this.db, sql, body.parameters));
    } catch (e) {
      send(200, '{"success":false,"error":' + jsonString((e as Error).message) + '}');
    }
  }
}
