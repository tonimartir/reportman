// The designer protocol of Reportman.Server (Reportman.Designer.Server's DesignerController), a
// request in, a response out, over the designer's operations and their backend:
//
//   POST {base}/api/designer/ReadReport     open a report and the designer's tools (operation)
//   POST {base}/api/designer/WriteReport    save a report (with the ETag it was opened with)
//   POST {base}/api/designer/ExecuteReport  the preview: the PDF of a report or of an unsaved one
//   GET  {base}/api/designer/SqlSchema      the tables and columns of a connection (SQL editor)
//   GET  {base}/api/designer/agent-schemas  always [] (the Agent connections are of Reportman.Server)
//   POST {base}/api/designer/ToXml          the AI copilot: the report as .rep XML for the cloud
//   POST {base}/api/designer/FromXml        the copilot's answer (XML) as the designer's JSON
//   POST {base}/api/designer/SqlColumns     the columns of a SQL the copilot wrote (only a read)
//   POST {base}/api/designer/AiContext      the live context: functions, parameters, dataset columns
//
// With the ai option, the AI of the designer goes through the server too (ai.ts):
//
//   GET  {base}/api/session/config          where the AI's login goes and this installation's id
//   *    {base}/api/ai/{cloud route}        the copilot's calls, on to the Reportman AI cloud
//   *    {base}/api/ai-login/{cloud route}  the AI's login, on to the cloud
//
// The bodies are the JSON of Reportman.Server (camelCase, names in any case, nulls left out) and
// an operation that fails answers 200 with errorMessage, as there.
//
// No Node.js API: the Node server (designer.ts) adds the report server and the element's files, and
// a page can answer its designer itself (a service worker over a store in the browser).

import type { ServerRequest, ServerResponse } from '@reportman/server';
import { DesignerOperations, ForbiddenError, JsonText, NoDataError, componentOf, type AiProbeParameter } from './operations.js';
import { parseDesignerJson } from './json.js';
import { DesignerAiBridge, aiRouteMethod, type DesignerAiOptions } from './ai.js';

/** What a request asks to do, for the authorize hook (the three checks of Reportman.Server). */
export type DesignerCheck =
  /** Open or run the reports of an alias (RequireRun). */
  | { action: 'run'; alias: string }
  /** Save reports into an alias (RequireDesign). */
  | { action: 'design'; alias: string }
  /**
   * A designer's tool, which opens data with the connections of the server, evaluates expressions
   * or runs a report that is not saved (RequireDesigner).
   */
  | { action: 'designer' };

/**
 * Says whether a request may do what it asks. The designer opens data with the connections of the
 * server and runs any SQL a report holds: give it to the people who design reports.
 */
export type DesignerAuthorize = (check: DesignerCheck, request: ServerRequest) => boolean | Promise<boolean>;

/** Options of the protocol. */
export interface DesignerProtocolOptions {
  /** Whether a request may do what it asks. Without it every request is refused (the Node server answers its own machine). */
  authorize?: DesignerAuthorize;
  /** The prefix of every route ('' by default): '/reportman' answers /reportman/api/designer/... */
  basePath?: string;
  /**
   * The designer's AI through this server: {base}/api/ai/* and {base}/api/ai-login/* go on to the
   * Reportman AI cloud as this installation, and {base}/api/session/config says it to the element.
   * Without it the element runs with no-ai.
   */
  ai?: DesignerAiOptions | DesignerAiBridge;
}

const encoder = new TextEncoder();

/**
 * A report document inside an answer: written as it is, its null members kept (the engine's
 * converters write some: a Null Variant's value, the public fields of an item).
 */
export class ReportJson {
  constructor(readonly document: Record<string, unknown>) {}
}

/**
 * JSON as Newtonsoft writes the designer's answers: null members left out (null items of a list
 * stay), a report document as it is (ReportJson) and the text of a JsonText as it comes.
 */
export function designerJson(status: number, value: unknown): ServerResponse {
  const raw: string[] = [];
  const marker = (text: string) => {
    raw.push(text);
    return '\u0000rm-json:' + (raw.length - 1) + '\u0000';
  };
  let text = JSON.stringify(value, (_key, v: unknown) => {
    if (v === null) return undefined;
    if (v instanceof ReportJson) return marker(JSON.stringify(v.document));
    if (v instanceof JsonText) return marker(v.text);
    return v;
  });
  if (raw.length > 0) text = text.replace(/"\\u0000rm-json:(\d+)\\u0000"/g, (_m, i: string) => raw[Number(i)]!);
  return {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8' },
    body: encoder.encode(text),
  };
}

/** JSON as ASP.NET writes an Ok(value) (System.Text.Json, web defaults): null members included. */
export function webJson(status: number, value: unknown): ServerResponse {
  return { status, headers: { 'content-type': 'application/json; charset=utf-8' }, body: encoder.encode(JSON.stringify(value)) };
}

/** The value of a member of a request body, its name in any case (Newtonsoft). */
export function member(body: Record<string, unknown>, name: string): unknown {
  const lower = name.toLowerCase();
  for (const key of Object.keys(body)) if (key.toLowerCase() === lower) return body[key];
  return undefined;
}

/** The value of a property of a request (ReportGenericRequest.Property), its name in any case. */
export function property(body: Record<string, unknown>, name: string): string | null {
  const list = member(body, 'properties');
  if (!Array.isArray(list)) return null;
  for (const p of list as Record<string, unknown>[]) {
    if (p === null || typeof p !== 'object') continue;
    const n = member(p, 'name');
    if (typeof n === 'string' && n.toLowerCase() === name.toLowerCase()) {
      const v = member(p, 'value');
      return v === null || v === undefined ? null : String(v);
    }
  }
  return null;
}

/** "ALIAS/path/name.rep" → its alias and path (DesignerService.SplitName); a name without alias is refused. */
export function splitName(reportName: string | null | undefined): { alias: string; path: string } {
  const name = (reportName ?? '').replace(/\\/g, '/').trim().replace(/^\/+|\/+$/g, '');
  const slash = name.indexOf('/');
  if (slash <= 0 || slash === name.length - 1) throw new Error('The report name must be ALIAS/path.rep');
  return { alias: name.substring(0, slash), path: name.substring(slash + 1) };
}

// ReadReportOperation, by number and by name (Newtonsoft reads an enum from either)
const OPERATIONS = [
  'ReadReport', 'ReadFunctions', 'ReadColumns', 'ReadFunctionsColumns', 'Evaluate', 'ReadAllTableColumns', 'ReadDataset',
  'ExportSubReport', 'ExportReport', 'Import', 'ImportEmpty', 'Duplicate', 'ImportName', 'CheckSyntax',
];

function operationOf(value: unknown): number {
  if (value === undefined || value === null) return 0;
  if (typeof value === 'number') return value;
  const s = String(value).trim();
  if (/^-?\d+$/.test(s)) return Number(s);
  const index = OPERATIONS.findIndex((o) => o.toLowerCase() === s.toLowerCase());
  if (index < 0) throw new Error(`Error converting value "${s}" to type 'ReadReportOperation'.`);
  return index;
}

function operationName(op: number): string {
  return OPERATIONS[op] ?? String(op);
}

/** A string member of a request: Newtonsoft reads a number or a boolean into a string as its text. */
function textMember(body: Record<string, unknown>, name: string): string | null {
  const v = member(body, name);
  if (v === undefined || v === null) return null;
  if (typeof v === 'string') return v;
  if (typeof v === 'boolean') return v ? 'True' : 'False';
  return typeof v === 'object' ? JSON.stringify(v) : String(v);
}

/** Convert.ToInt32 of a string: 0 for null, the .NET errors otherwise. */
function convertToInt32(text: string | null): number {
  if (text === null) return 0;
  const t = text.trim();
  if (!/^[+-]?\d+$/.test(t)) throw new Error(`The input string '${text}' was not in a correct format.`);
  const n = Number(t);
  if (n > 2147483647 || n < -2147483648) throw new Error('Value was either too large or too small for an Int32.');
  return n;
}

/** The error of a request with its HTTP status (ServerError of @reportman/server, told by its shape). */
function serverStatus(e: unknown): number | null {
  if (!(e instanceof Error) || e.name !== 'ServerError') return null;
  const status = (e as { status?: unknown }).status;
  return typeof status === 'number' ? status : null;
}

/** The designer protocol over the designer's operations. */
export class DesignerProtocol {
  readonly operations: DesignerOperations;
  protected readonly authorize: DesignerAuthorize | undefined;
  protected readonly base: string;
  /** The designer's AI through this server, when it was given (the ai option). */
  readonly ai: DesignerAiBridge | null;

  constructor(operations: DesignerOperations, options: DesignerProtocolOptions = {}) {
    this.operations = operations;
    this.authorize = options.authorize;
    this.base = '/' + (options.basePath ?? '').trim().replace(/^\/+|\/+$/g, '');
    if (this.base === '/') this.base = '';
    const ai = options.ai;
    this.ai = ai === undefined ? null : ai instanceof DesignerAiBridge ? ai : new DesignerAiBridge(ai);
  }

  /** The path inside the base, or null when it is outside. */
  protected inside(path: string): string | null {
    if (this.base.length === 0) return path;
    const lower = path.toLowerCase();
    const base = this.base.toLowerCase();
    if (lower === base) return '/';
    return lower.startsWith(base + '/') ? path.substring(this.base.length) : null;
  }

  /** Whether a path is one of the protocol's routes ({base}/api/designer/..., and the AI's with the ai option). */
  owns(path: string): boolean {
    const p = this.inside(path)?.toLowerCase().replace(/\/+$/, '');
    if (p === undefined) return false;
    if (p.startsWith('/api/designer/')) return true;
    return this.ai !== null && (p === '/api/session/config' || p.startsWith('/api/ai/') || p.startsWith('/api/ai-login/'));
  }

  routes(): string[] {
    const routes = [this.base + '/api/designer/*'];
    if (this.ai !== null) routes.push(this.base + '/api/session/config', this.base + '/api/ai/*', this.base + '/api/ai-login/*');
    return routes;
  }

  /** Why a request may not do what it asks without an authorize function (null: it may). */
  protected withoutAuthorize(_request: ServerRequest): string | null {
    return 'The designer protocol was given no authorize function.';
  }

  /** Null when the request may do it, else why not. */
  private async refused(check: DesignerCheck, request: ServerRequest): Promise<string | null> {
    const authorize = this.authorize;
    if (authorize === undefined) return this.withoutAuthorize(request);
    if (await authorize(check, request)) return null;
    switch (check.action) {
      case 'run':
        return `You may not open the reports of '${check.alias}'.`;
      case 'design':
        return `You may not save reports in '${check.alias}'.`;
      default:
        return 'Only a designer of reports may do this.';
    }
  }

  private async require(check: DesignerCheck, request: ServerRequest): Promise<void> {
    const why = await this.refused(check, request);
    if (why !== null) throw new ForbiddenError(why);
  }

  /** Answers a request of the protocol (404 for any other). */
  async handle(request: ServerRequest): Promise<ServerResponse> {
    const inner = this.inside(request.path);
    if (inner === null) return designerJson(404, { error: 'Not found.' });
    const parts = inner.split('/').filter((p) => p.length > 0);
    const method = request.method.toUpperCase();
    if (this.ai !== null && parts[0]?.toLowerCase() === 'api') {
      const area = parts[1]?.toLowerCase();
      if (area === 'session' && parts.length === 3 && parts[2]!.toLowerCase() === 'config' && method === 'GET') return this.ai.sessionConfig(this.base);
      if (area === 'ai' || area === 'ai-login') return this.aiCall(request, area, parts.slice(2).join('/'));
    }
    if (parts.length !== 3 || parts[0]?.toLowerCase() !== 'api' || parts[1]?.toLowerCase() !== 'designer') return designerJson(404, { error: 'Not found.' });
    const route = parts[2]!.toLowerCase();
    try {
      if (method === 'GET' && route === 'sqlschema') return await this.sqlSchema(request);
      if (method === 'GET' && route === 'agent-schemas') {
        await this.require({ action: 'designer' }, request);
        return designerJson(200, []);
      }
      if (method === 'POST' && route === 'readreport') return await this.readReport(request);
      if (method === 'POST' && route === 'writereport') return await this.writeReport(request);
      if (method === 'POST' && route === 'executereport') return await this.executeReport(request);
      if (method === 'POST' && route === 'toxml') return await this.toXml(request);
      if (method === 'POST' && route === 'fromxml') return await this.fromXml(request);
      if (method === 'POST' && route === 'sqlcolumns') return await this.sqlColumns(request);
      if (method === 'POST' && route === 'aicontext') return await this.aiContext(request);
    } catch (e) {
      if (e instanceof ForbiddenError) return designerJson(403, { error: e.message });
      const status = serverStatus(e);
      if (status !== null) return designerJson(status, { error: (e as Error).message });
      return designerJson(500, { error: e instanceof Error ? e.message : String(e) });
    }
    return designerJson(404, { error: 'Not found.' });
  }

  /** The body of a POST as a JSON object (an empty or missing one is an empty request). */
  private body(request: ServerRequest): Record<string, unknown> {
    const text = request.body === undefined ? '' : new TextDecoder('utf-8').decode(request.body);
    if (text.trim().length === 0) return {};
    let value: unknown;
    try {
      value = parseDesignerJson(text);
    } catch {
      throw new BadRequest('The body is not valid JSON.');
    }
    return value !== null && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
  }

  /** GET SqlSchema?alias=&refresh= */
  private async sqlSchema(request: ServerRequest): Promise<ServerResponse> {
    const alias = request.query.get('alias');
    // [FromQuery] string alias: ASP.NET's validation refuses a missing one
    if (alias === null) return designerJson(400, { title: 'One or more validation errors occurred.', status: 400, errors: { alias: ['The alias field is required.'] } });
    if (alias.trim().length === 0) return designerJson(400, { error: 'alias is required' });
    await this.require({ action: 'designer' }, request);
    const refresh = (request.query.get('refresh') ?? '').toLowerCase() === 'true';
    return webJson(200, await this.operations.sqlSchema(alias, refresh));
  }

  private async readReport(request: ServerRequest): Promise<ServerResponse> {
    const body = this.body(request);
    const response: Record<string, unknown> = {};
    const ops = this.operations;
    let op = 0;
    try {
      op = operationOf(member(body, 'operation'));
      const reportName = textMember(body, 'reportName');
      const expression = textMember(body, 'expression');
      const datasetName = textMember(body, 'datasetName');
      const report = member(body, 'report');
      const given = report !== null && report !== undefined && typeof report === 'object' ? (report as Record<string, unknown>) : null;
      const requireReport = (): Record<string, unknown> => {
        if (given === null) throw new Error('This operation needs the report in the request');
        return given;
      };
      // Opening a stored report needs only to run its alias (saving is checked apart); every other
      // operation opens data, evaluates or writes: a designer's tool
      if (op === 0 && reportName !== null && reportName.trim().length > 0) await this.require({ action: 'run', alias: splitName(reportName).alias }, request);
      else await this.require({ action: 'designer' }, request);
      const context = { reportName };
      switch (op) {
        case 0:
          if (reportName !== null && reportName.trim().length > 0) {
            const { report: read, eTag } = await ops.readStored(reportName);
            response.report = new ReportJson(read);
            response.eTag = eTag;
          } else if (expression !== null && expression.trim().length > 0) {
            response.report = new ReportJson(await ops.readFromBase64Xml(expression));
          } else {
            throw new Error('reportName or a base64 .rep in expression is required');
          }
          break;
        case 11:
          await this.require({ action: 'run', alias: splitName(reportName).alias }, request);
          await this.require({ action: 'design', alias: splitName(expression).alias }, request);
          await ops.duplicate(reportName ?? '', expression ?? '');
          break;
        case 12:
          await this.require({ action: 'design', alias: splitName(reportName).alias }, request);
          await ops.importName(reportName ?? '', expression ?? '');
          break;
        case 1:
          response.functions = await ops.readFunctionList(requireReport(), false, false, context);
          break;
        case 3:
          response.functions = await ops.readFunctionList(requireReport(), true, (property(body, 'refresh') ?? '').toLowerCase() === 'true', context);
          break;
        case 4:
          response.evaluateResult = await ops.evaluate(requireReport(), expression ?? '', context);
          break;
        case 13:
          response.syntaxCheck = await ops.checkSyntax(requireReport(), expression ?? '', context);
          break;
        case 5:
          response.dataSets = await ops.readAllTableColumns(requireReport());
          break;
        case 6:
          response.dataSets = await ops.readDataset(requireReport(), expression ?? '', datasetName ?? '', context);
          break;
        case 8:
          response.evaluateResult = await ops.exportReport(given ?? (await ops.readStoredModel(reportName ?? '')).model);
          break;
        case 7:
          response.evaluateResult = await ops.exportSubReport(requireReport(), convertToInt32(expression));
          break;
        case 9:
          response.report = new ReportJson(await ops.importSubReport(requireReport(), expression ?? ''));
          break;
        case 10:
          if (given !== null) throw new Error('Import empty must have no report');
          response.report = new ReportJson(await ops.importSubReport(null, expression ?? ''));
          break;
        default:
          throw new Error('Unknown operation ' + operationName(op));
      }
    } catch (e) {
      return designerJson(200, errorAnswer(e));
    }
    return designerJson(200, response);
  }

  private async writeReport(request: ServerRequest): Promise<ServerResponse> {
    const body = this.body(request);
    try {
      let report = member(body, 'report') as Record<string, unknown> | null | undefined;
      const reportJson = member(body, 'reportJson');
      if ((report === null || report === undefined) && typeof reportJson === 'string' && reportJson.trim().length > 0) report = parseDesignerJson(reportJson) as Record<string, unknown>;
      if (report === null || report === undefined) throw new Error('No report was provided');
      const reportName = textMember(body, 'reportName');
      if (reportName === null || reportName === undefined || reportName.trim().length === 0) throw new Error('reportName is required');
      await this.require({ action: 'design', alias: splitName(reportName).alias }, request);
      return designerJson(200, { eTag: await this.operations.write(reportName, report, property(body, 'eTag')) });
    } catch (e) {
      return designerJson(200, { errorMessage: e instanceof Error ? e.message : String(e) });
    }
  }

  private async executeReport(request: ServerRequest): Promise<ServerResponse> {
    const body = this.body(request);
    try {
      const report = member(body, 'report') as Record<string, unknown> | null | undefined;
      const reportName = textMember(body, 'reportName') ?? '';
      if (report !== null && report !== undefined) await this.require({ action: 'designer' }, request);
      else await this.require({ action: 'run', alias: splitName(reportName).alias }, request);
      const model = report ?? (await this.operations.readStoredModel(reportName)).model;
      const indexes = member(body, 'subreportIndexes');
      const result = await this.operations.execute(model, Array.isArray(indexes) ? indexes.map(Number) : null, { reportName });
      return designerJson(200, { result, noData: false });
    } catch (e) {
      if (e instanceof NoDataError) return designerJson(200, { noData: true, errorMessage: e.message });
      return designerJson(200, { noData: false, ...errorAnswer(e) });
    }
  }

  // ---- the AI ----

  /**
   * {base}/api/ai/* and {base}/api/ai-login/*: for whoever designs (no Reportman AI account is needed:
   * without one the installation's guest credits pay). A route the bridge does not pass is a 404 first.
   */
  private async aiCall(request: ServerRequest, area: string, route: string): Promise<ServerResponse> {
    const ai = this.ai!;
    if (area === 'ai' && aiRouteMethod(route.replace(/^\/+|\/+$/g, '')) !== request.method.toUpperCase()) return ai.bridge(request, route);
    const why = await this.refused({ action: 'designer' }, request);
    if (why !== null) return webJson(403, { error: 'The AI of the designer is for the users who design reports.', code: 'NotDesigner' });
    return area === 'ai' ? ai.bridge(request, route) : ai.login(request, route);
  }

  /** The report of a copilot's request: report, or the document in reportJson (WriteReportRequest). */
  private copilotReport(body: Record<string, unknown>): Record<string, unknown> | null {
    const report = member(body, 'report');
    if (report !== null && report !== undefined && typeof report === 'object') return report as Record<string, unknown>;
    const reportJson = member(body, 'reportJson');
    if (typeof reportJson === 'string' && reportJson.trim().length > 0) return parseDesignerJson(reportJson) as Record<string, unknown>;
    return null;
  }

  /** POST ToXml: the document as .rep XML, what the copilot exchanges with the cloud. */
  private async toXml(request: ServerRequest): Promise<ServerResponse> {
    const report = this.copilotReport(this.body(request));
    if (report === null) return webJson(400, { error: 'No report was provided' });
    await this.require({ action: 'designer' }, request);
    return webJson(200, { xml: this.operations.toXml(report) });
  }

  /** POST FromXml: the copilot's answer (XML) back as the JSON document the designer edits. */
  private async fromXml(request: ServerRequest): Promise<ServerResponse> {
    const xml = member(this.body(request), 'xml');
    if (typeof xml !== 'string' || xml.trim().length === 0) return webJson(400, { error: 'No xml was provided' });
    await this.require({ action: 'designer' }, request);
    try {
      return designerJson(200, { report: new ReportJson(this.operations.fromXml(xml)) });
    } catch (e) {
      return webJson(400, { error: e instanceof Error ? e.message : String(e) });
    }
  }

  /**
   * POST SqlColumns: the columns of a SQL the copilot wrote, run as one more dataset of the report the
   * cloud gave back (its XML). A SQL that does not run is an answer too (error): the cloud fixes it.
   */
  private async sqlColumns(request: ServerRequest): Promise<ServerResponse> {
    await this.require({ action: 'designer' }, request);
    const body = this.body(request);
    const xml = member(body, 'xml');
    const databaseAlias = member(body, 'databaseAlias');
    const sql = member(body, 'sql');
    const blank = (v: unknown) => typeof v !== 'string' || v.trim().length === 0;
    if (blank(xml) || blank(databaseAlias) || blank(sql)) return webJson(400, { error: 'xml, databaseAlias and sql are required' });
    const given = member(body, 'parameters');
    const parameters: AiProbeParameter[] = Array.isArray(given)
      ? given
          .filter((p): p is Record<string, unknown> => p !== null && typeof p === 'object')
          .map((p) => {
            const dbType = member(p, 'dbType');
            const name = member(p, 'name');
            return { name: typeof name === 'string' ? name : null, value: member(p, 'value'), dbType: typeof dbType === 'number' ? dbType : null };
          })
      : [];
    try {
      const columns = await this.operations.sqlColumns(xml as string, databaseAlias as string, sql as string, parameters);
      return webJson(200, { columns: columns.map((c) => ({ name: c.name, dataType: c.type })) });
    } catch (e) {
      return webJson(200, { error: e instanceof Error ? e.message : String(e) });
    }
  }

  /** POST AiContext: the live context for the copilot (columns of every dataset, functions, parameters). */
  private async aiContext(request: ServerRequest): Promise<ServerResponse> {
    const body = this.body(request);
    const report = this.copilotReport(body);
    if (report === null) return webJson(400, { error: 'No report was provided' });
    await this.require({ action: 'designer' }, request);
    try {
      return webJson(200, await this.operations.aiContext(report, (property(body, 'refresh') ?? '').toLowerCase() === 'true'));
    } catch (e) {
      return webJson(400, { error: e instanceof Error ? e.message : String(e) });
    }
  }
}

/** A body that is not JSON: 400, as ASP.NET answers it. */
class BadRequest extends Error {
  readonly status = 400;
  constructor(message: string) {
    super(message);
    this.name = 'ServerError';
  }
}

/** errorMessage, and the item and property of the report that failed when there is one. */
function errorAnswer(e: unknown): Record<string, unknown> {
  const answer: Record<string, unknown> = { errorMessage: e instanceof Error ? e.message : String(e) };
  const component = componentOf(e);
  if (component.name !== undefined) answer.errorComponentName = component.name;
  if (component.property !== undefined) answer.errorComponentProperty = component.property;
  return answer;
}
