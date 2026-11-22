// Report Manager server for Node.js: the reports API of Reportman.Server over folders of .rep
// files, framework independent, with adapters for node:http, Express and Fastify.
export { createReportServer, ReportServer, errorResponse } from './server.js';
export type { ApiKey, ReportServerOptions, ServerRequest, ServerResponse } from './server.js';
export { FolderReportStore, ServerError } from './store.js';
export type { ReportEntry, ReportFolderNode } from './store.js';
export { nodeHandler, fastifyPlugin, toServerRequest } from './node.js';
