// The server of the web designer, framework independent: the designer protocol of Reportman.Server
// (Reportman.Designer.Server's DesignerController), a request in, a response out. The adapters of
// @reportman/server (nodeHandler, fastifyPlugin) plug it into node:http, Express and Fastify.
//
//   POST {base}/api/designer/ReadReport     open a report and the designer's tools (operation)
//   POST {base}/api/designer/WriteReport    save a report (with the ETag it was opened with)
//   POST {base}/api/designer/ExecuteReport  the preview: the PDF of a report or of an unsaved one
//   GET  {base}/api/designer/SqlSchema      the tables and columns of a connection (SQL editor)
//   GET  {base}/api/designer/agent-schemas  always [] (the Agent connections are of Reportman.Server)
//   GET  {base}/designer/...                the <reportman-designer> element and a page with it
//
// The bodies are the JSON of Reportman.Server (camelCase, names in any case, nulls left out) and
// an operation that fails answers 200 with errorMessage, as there. The AI assistant is not here:
// its routes (ToXml, FromXml, SqlColumns, AiContext, /api/ai) stay in Reportman.Server.

import { createReportServer, ServerError, type HttpServerLike, type ReportServer, type ReportServerOptions, type ServerRequest, type ServerResponse } from '@reportman/server';
import { DesignerOperations, ForbiddenError, JsonText, NoDataError, componentOf } from './operations.js';
import { elementResponse, type DesignerElementOptions } from './element.js';
import { parseDesignerJson } from './json.js';

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

/** Options of createDesignerServer: the ones of the report server, and the designer's. */
export interface DesignerServerOptions extends ReportServerOptions {
  /**
   * Whether a request may do what it asks. Without it the designer answers only requests from
   * this machine (localhost): enough to try it, and closed when it is deployed.
   */
  authorize?: DesignerAuthorize;
  /** The prefix of every route ('' by default): '/reportman' answers /reportman/api/designer/... */
  basePath?: string;
  /** The element's files and the page of the designer under {base}/designer/ (on by default). */
  element?: DesignerElementOptions | false;
}

const LOOPBACK = /^(127\.\d+\.\d+\.\d+|::1|::ffff:127\.\d+\.\d+\.\d+)$/;
const encoder = new TextEncoder();
const NOT_LOCAL =
  'This designer server answers only this machine: give createDesignerServer an authorize function to open it to others.';
const AI_ROUTES = new Set(['toxml', 'fromxml', 'sqlcolumns', 'aicontext']);

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

/** The server of the web designer over folders of .rep files. */
export class DesignerServer implements HttpServerLike {
  /**
   * The report server the designer opens its reports with (its store, connections, culture and
   * fonts). Mount it too (nodeHandler(designer.reports)) for the reports API and the console.
   */
  readonly reports: ReportServer;
  readonly operations: DesignerOperations;
  private readonly options: DesignerServerOptions;
  private readonly base: string;

  constructor(options: DesignerServerOptions) {
    this.options = options;
    this.base = '/' + (options.basePath ?? '').trim().replace(/^\/+|\/+$/g, '');
    if (this.base === '/') this.base = '';
    this.reports = createReportServer({ ...options, canDesign: true });
    this.operations = new DesignerOperations(this.reports, options);
  }

  /** The path inside the base, or null when it is outside. */
  private inside(path: string): string | null {
    if (this.base.length === 0) return path;
    const lower = path.toLowerCase();
    const base = this.base.toLowerCase();
    if (lower === base) return '/';
    return lower.startsWith(base + '/') ? path.substring(this.base.length) : null;
  }

  owns(path: string): boolean {
    const p = this.inside(path)?.toLowerCase().replace(/\/+$/, '');
    if (p === undefined) return false;
    if (p.startsWith('/api/designer/')) return true;
    return this.options.element !== false && (p === '/designer' || p.startsWith('/designer/'));
  }

  routes(): string[] {
    const routes = [this.base + '/api/designer/*'];
    if (this.options.element !== false) routes.push(this.base + '/designer', this.base + '/designer/*');
    return routes;
  }

  /** Null when the request may do it, else why not. */
  private async refused(check: DesignerCheck, request: ServerRequest): Promise<string | null> {
    const authorize = this.options.authorize;
    if (authorize === undefined) return request.remoteAddress !== undefined && LOOPBACK.test(request.remoteAddress) ? null : NOT_LOCAL;
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

  /** Answers a request. */
  async handle(request: ServerRequest): Promise<ServerResponse> {
    const inner = this.inside(request.path);
    if (inner === null) return designerJson(404, { error: 'Not found.' });
    const parts = inner.split('/').filter((p) => p.length > 0);
    const method = request.method.toUpperCase();
    if (parts[0]?.toLowerCase() === 'designer' && this.options.element !== false)
      return elementResponse(parts.slice(1), request, this.options.element ?? {}, this.base);
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
      if (method === 'POST' && AI_ROUTES.has(route))
        return designerJson(404, { error: 'The AI assistant is not part of @reportman/designer-server: open the designer with no-ai.' });
    } catch (e) {
      if (e instanceof ForbiddenError) return designerJson(403, { error: e.message });
      if (e instanceof ServerError) return designerJson(e.status, { error: e.message });
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
      throw new ServerError(400, 'The body is not valid JSON.');
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
          response.evaluateResult = await ops.exportReport(given ?? ops.readStoredModel(reportName ?? '').model);
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
      const model = report ?? this.operations.readStoredModel(reportName).model;
      const indexes = member(body, 'subreportIndexes');
      const result = await this.operations.execute(model, Array.isArray(indexes) ? indexes.map(Number) : null, { reportName });
      return designerJson(200, { result, noData: false });
    } catch (e) {
      if (e instanceof NoDataError) return designerJson(200, { noData: true, errorMessage: e.message });
      return designerJson(200, { noData: false, ...errorAnswer(e) });
    }
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

/** The server of the web designer: the designer protocol of Reportman.Server over folders of .rep files. */
export function createDesignerServer(options: DesignerServerOptions): DesignerServer {
  return new DesignerServer(options);
}
