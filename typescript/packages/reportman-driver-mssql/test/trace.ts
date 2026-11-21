// What each client sends to the server, read from an Extended Events session (rm_trace, a ring
// buffer of rpc_completed and sql_batch_completed on the test database): the text of each SQL batch
// and of each RPC as the server writes it ("exec sp_executesql N'...',N'@A int',@A=7"), with the
// parameter declarations and values. The clients are told apart by their Application Name: each run
// to compare connects with its own (traceApp), so the tests may run while other clients work.

import { mssqlTest, runBatch } from './database.ts';

/** The Application Name of a traced run. */
export function traceApp(name: string): string {
  return 'rmtrace-' + name;
}

/** Starts the session, empty: a running one is stopped and started again (its ring buffer is read
 * as XML that SQL Server cuts at 4 MB, so the events of a long-running session would not be seen). */
export async function startTrace(): Promise<void> {
  await runBatch(
    `IF NOT EXISTS (SELECT 1 FROM sys.server_event_sessions WHERE name = 'rm_trace')
CREATE EVENT SESSION rm_trace ON SERVER
 ADD EVENT sqlserver.rpc_completed (ACTION (sqlserver.client_app_name) WHERE sqlserver.database_name = N'${mssqlTest.database}'),
 ADD EVENT sqlserver.sql_batch_completed (ACTION (sqlserver.client_app_name) WHERE sqlserver.database_name = N'${mssqlTest.database}')
 ADD TARGET package0.ring_buffer (SET max_events_limit = 20000)
 WITH (MAX_DISPATCH_LATENCY = 1 SECONDS, EVENT_RETENTION_MODE = ALLOW_SINGLE_EVENT_LOSS);
IF EXISTS (SELECT 1 FROM sys.dm_xe_sessions WHERE name = 'rm_trace') ALTER EVENT SESSION rm_trace ON SERVER STATE = STOP;
ALTER EVENT SESSION rm_trace ON SERVER STATE = START;`,
    'master',
  );
}

function unescapeXml(s: string): string {
  return s.replace(/&(lt|gt|quot|apos|amp|#x[0-9a-fA-F]+|#\d+);/g, (_m, e: string) => {
    if (e === 'lt') return '<';
    if (e === 'gt') return '>';
    if (e === 'quot') return '"';
    if (e === 'apos') return "'";
    if (e === 'amp') return '&';
    return String.fromCodePoint(e.startsWith('#x') ? Number.parseInt(e.substring(2), 16) : Number(e.substring(1)));
  });
}

const CDATA = /^<!\[CDATA\[([\s\S]*)\]\]>$/;

/** The value of a data or action element of an event (text or CDATA). */
function xeValue(body: string, element: string, name: string): string | undefined {
  const start = body.indexOf(`<${element} name="${name}"`);
  if (start < 0) return undefined;
  const open = body.indexOf('<value>', start);
  const close = body.indexOf('</value>', open);
  if (open < 0 || close < 0) return undefined;
  const v = body.substring(open + 7, close);
  const cdata = CDATA.exec(v);
  return cdata !== null ? cdata[1]! : unescapeXml(v);
}

/** The statements of an application, in the order the server completed them (after the dispatch latency). */
export async function tracedStatements(app: string): Promise<string[]> {
  await new Promise((r) => setTimeout(r, 1500));
  const rows = await runBatch(
    `SELECT CAST(t.target_data AS NVARCHAR(MAX)) AS X FROM sys.dm_xe_session_targets t JOIN sys.dm_xe_sessions s ON s.address = t.event_session_address WHERE s.name = 'rm_trace'`,
    'master',
  );
  const xml = String(rows[0]?.X ?? '');
  const out: { ts: string; seq: number; text: string }[] = [];
  let seq = 0;
  for (const m of xml.matchAll(/<event name="(\w+)"[^>]*timestamp="([^"]+)">([\s\S]*?)<\/event>/g)) {
    const body = m[3]!;
    if (xeValue(body, 'action', 'client_app_name') !== app) continue;
    const text = xeValue(body, 'data', m[1] === 'rpc_completed' ? 'statement' : 'batch_text') ?? '';
    out.push({ ts: m[2]!, seq: seq++, text });
  }
  out.sort((a, b) => (a.ts < b.ts ? -1 : a.ts > b.ts ? 1 : a.seq - b.seq));
  return out.map((e) => e.text);
}
