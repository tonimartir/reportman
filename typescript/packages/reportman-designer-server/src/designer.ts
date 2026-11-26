// The server of the web designer on Node.js, framework independent: the designer protocol of
// Reportman.Server (protocol.ts) over folders of .rep files, and the <reportman-designer> element, a
// request in, a response out. The adapters of @reportman/server (nodeHandler, fastifyPlugin) plug it
// into node:http, Express and Fastify.
//
//   POST {base}/api/designer/ReadReport     open a report and the designer's tools (operation)
//   POST {base}/api/designer/WriteReport    save a report (with the ETag it was opened with)
//   POST {base}/api/designer/ExecuteReport  the preview: the PDF of a report or of an unsaved one
//   GET  {base}/api/designer/SqlSchema      the tables and columns of a connection (SQL editor)
//   GET  {base}/api/designer/agent-schemas  always [] (the Agent connections are of Reportman.Server)
//   GET  {base}/designer/...                the <reportman-designer> element and a page with it

import { createReportServer, type HttpServerLike, type ReportServer, type ReportServerOptions, type ServerRequest, type ServerResponse } from '@reportman/server';
import { DesignerOperations } from './operations.js';
import { DesignerProtocol, designerJson, type DesignerAuthorize } from './protocol.js';
import { nodeDesignerBackend } from './node-backend.js';
import { elementResponse, type DesignerElementOptions } from './element.js';

export { designerJson, member, property, ReportJson, splitName, webJson } from './protocol.js';
export type { DesignerAuthorize, DesignerCheck } from './protocol.js';

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
const NOT_LOCAL =
  'This designer server answers only this machine: give createDesignerServer an authorize function to open it to others.';

/** The server of the web designer over folders of .rep files. */
export class DesignerServer extends DesignerProtocol implements HttpServerLike {
  /**
   * The report server the designer opens its reports with (its store, connections, culture and
   * fonts). Mount it too (nodeHandler(designer.reports)) for the reports API and the console.
   */
  readonly reports: ReportServer;
  private readonly element: DesignerElementOptions | false;

  constructor(options: DesignerServerOptions) {
    const reports = createReportServer({ ...options, canDesign: true });
    super(new DesignerOperations(nodeDesignerBackend(reports, options), options), options);
    this.reports = reports;
    this.element = options.element ?? {};
  }

  /** Without an authorize function, only this machine. */
  protected override withoutAuthorize(request: ServerRequest): string | null {
    return request.remoteAddress !== undefined && LOOPBACK.test(request.remoteAddress) ? null : NOT_LOCAL;
  }

  override owns(path: string): boolean {
    if (super.owns(path)) return true;
    const p = this.inside(path)?.toLowerCase().replace(/\/+$/, '');
    return p !== undefined && this.element !== false && (p === '/designer' || p.startsWith('/designer/'));
  }

  override routes(): string[] {
    const routes = super.routes();
    if (this.element !== false) routes.push(this.base + '/designer', this.base + '/designer/*');
    return routes;
  }

  /** Answers a request. */
  override async handle(request: ServerRequest): Promise<ServerResponse> {
    const inner = this.inside(request.path);
    if (inner === null) return designerJson(404, { error: 'Not found.' });
    const parts = inner.split('/').filter((p) => p.length > 0);
    if (parts[0]?.toLowerCase() === 'designer' && this.element !== false) return elementResponse(parts.slice(1), request, this.element, this.base);
    return super.handle(request);
  }
}

/** The server of the web designer: the designer protocol of Reportman.Server over folders of .rep files. */
export function createDesignerServer(options: DesignerServerOptions): DesignerServer {
  return new DesignerServer(options);
}
