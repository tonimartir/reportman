// Report Manager web designer for Node.js: the designer protocol of Reportman.Server over folders
// of .rep files and the <reportman-designer> element, served from the program's own origin. The
// adapters of @reportman/server plug it into node:http, Express and Fastify.
export { createDesignerServer, DesignerServer, designerJson, splitName } from './designer.js';
export type { DesignerAuthorize, DesignerCheck, DesignerServerOptions } from './designer.js';
export { DesignerOperations, ForbiddenError, NoDataError } from './operations.js';
export type { DataSetInformation, EvaluateResult, FunctionHelp, ReportDocument, ReportResult, SyntaxCheckResult } from './operations.js';
export type { DesignerElementOptions } from './element.js';
export { nodeHandler, fastifyPlugin, toServerRequest } from '@reportman/server';
export type { HttpServerLike, ServerRequest, ServerResponse } from '@reportman/server';
