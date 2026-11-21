// reportman-driver-http: the Reportman AI Agent connections of Report Manager (the HttpAgent driver of the
// C# engine): the SQL of a report runs on a database behind a Reportman DB Agent, through the Hub API
// (aiapi.reportman.es by default), with fetch only, in Node.js and in the browser.
//
//   import { openReport } from 'reportman-node';
//   import { reportmanAgent } from 'reportman-driver-http';
//
//   const report = await openReport('sales.rep', {
//     connections: { SALES: reportmanAgent({ hubDatabaseId: 42, apiKey: process.env.RM_AGENT_KEY }) },
//   });
//   const pdf = await report.executeToPdf({ YEAR: 2025 });
//
// Each query is a POST of api/agent/execute ({hubDatabaseId, sql, parameters:[{name,value,dbType}]}) with
// the API key (X-Reportman-ApiKey) or a Bearer token and its install id (X-Reportman-WebInstallId); the
// answer ({data:{columns, rows}}) becomes the columns and values the C# engine builds its DataTable with.
// The WebRTC direct channel of the C# engine (DirectAgentExecutor, .NET 8+) is not part of this package:
// every query goes over HTTP, as on the net48 build of the C# engine.

import type { ConnectionRequest, DataConnection, MaybePromise, QueryCommand, QueryResult } from 'reportman-engine';
import { HttpAgentExecutor, type ExecutorOptions } from './executor.js';
import { type AgentSession, type HostValues, IniDocument, isAgentConnection, resolveSettings } from './settings.js';
import { readIniText } from './text.js';

export { HttpAgentExecutor, type ExecutorOptions, type FetchInit, type FetchLike, type FetchResponse } from './executor.js';
export {
  DEFAULT_BASE_URL,
  IniDocument,
  isAgentConnection,
  resolveSettings,
  type AgentSession,
  type AgentSettings,
  type HostValues,
} from './settings.js';
export { JsonReaderException } from './json.js';
export { deserializeTable } from './table.js';
export { executeBody } from './request.js';

/** The text of a connections file, or the function that reads the one a report connection names. */
export type ConnectionsFile =
  | string
  | Uint8Array
  | ((configFile: string) => MaybePromise<string | Uint8Array | null | undefined>);

/** Options of reportmanAgent. */
export interface ReportmanAgentOptions extends HostValues, ExecutorOptions {
  /**
   * The connections file (dbxconnections.ini) the report connection reads its Hub database, API key, token
   * and URL from, as in C#: its section named as the connection, with the keys HubDatabaseId, ApiKey, Token
   * and Url (or HttpAgentBaseUrl). Its text (bytes are read as C# reads them: UTF-8 after a BOM, Windows-1252
   * otherwise), or a function that receives the ConfigFile of the report connection ("" when it names none:
   * the shared file of the computer) and returns the text, or undefined when there is no such file. Read only
   * when the report connection loads its parameters (LoadParams).
   */
  connectionsFile?: ConnectionsFile;
  /**
   * The Reportman AI session of the host, for a connection with neither an API key nor a token (C#:
   * DatabaseInfo.HttpAgentSessionToken and HttpAgentSessionInstallId). Without one the request goes without
   * credentials: the example databases of the Hub answer to everybody, the others are refused with a clear
   * error.
   */
  session?: AgentSession;
}

/**
 * An open Reportman AI Agent connection. It holds no session with the Hub and no transaction: each query is
 * a request, as with the executor of the C# engine; closing it does nothing.
 */
export class AgentConnection implements DataConnection {
  readonly executor: HttpAgentExecutor;

  constructor(executor: HttpAgentExecutor) {
    this.executor = executor;
  }

  /** HttpAgentExecutor.Open: the command of a dataset, and the one of GETVALUEFROMSQL. */
  query(command: QueryCommand): Promise<QueryResult> {
    return this.executor.execute(command.sql, command.parameters);
  }

  close(): void {}
}

function iniOf(content: string | Uint8Array | null | undefined): IniDocument | undefined {
  if (content === null || content === undefined) return undefined;
  return new IniDocument(typeof content === 'string' ? content : readIniText(content));
}

function isThenable<T>(value: MaybePromise<T>): value is PromiseLike<T> {
  return value !== null && typeof value === 'object' && typeof (value as { then?: unknown }).then === 'function';
}

/** The executor of a report connection with these options: its settings resolved as C# resolves them. */
export function createExecutor(request: ConnectionRequest, options: ReportmanAgentOptions = {}): MaybePromise<HttpAgentExecutor> {
  const make = (ini: IniDocument | undefined): HttpAgentExecutor =>
    new HttpAgentExecutor(resolveSettings(request, options, ini, options.session), options);
  const file = options.connectionsFile;
  if (file === undefined || !request.database.loadParams) return make(undefined);
  if (typeof file !== 'function') return make(iniOf(file));
  const content = file(request.database.configFile ?? '');
  if (isThenable(content)) return Promise.resolve(content).then((c) => make(iniOf(c)));
  return make(iniOf(content));
}

/**
 * A connection factory for openReport's `connections` (the ConnectionFactory of reportman-node): each
 * report connection it serves runs its SQL through the Hub API with the Hub database, credentials and URL
 * of the options, completed from the connections file and the session as the C# engine completes them. A
 * report connection the connections file maps to the Agent (DriverName=Reportman AI Agent) is served too.
 */
export function reportmanAgent(options: ReportmanAgentOptions = {}): (request: ConnectionRequest) => MaybePromise<DataConnection> {
  return (request) => {
    const executor = createExecutor(request, options);
    return isThenable(executor) ? Promise.resolve(executor).then((e) => new AgentConnection(e)) : new AgentConnection(executor);
  };
}

/** Whether a report connection is an Agent one, by its driver or by the connections file. */
export function agentConnectionOf(request: ConnectionRequest, connectionsFile: string | Uint8Array | undefined): boolean {
  return isAgentConnection(request, iniOf(connectionsFile));
}
