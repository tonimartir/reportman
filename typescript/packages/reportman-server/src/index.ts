// Report Manager server for Node.js: the reports API of Reportman.Server over folders of .rep
// files, framework independent, with adapters for node:http, Express and Fastify; with a data
// folder, its console too (connections, aliases, API keys, the sample reports and an API explorer).
export { createReportServer, ReportServer, errorResponse } from './server.js';
export { attachmentDisposition } from './server.js';
export type { ApiKey, HttpServerLike, ReportServerOptions, ServerRequest, ServerResponse } from './server.js';
export { FolderReportStore, ServerError, eTagOf, modifiedUtcOf } from './store.js';
export type { FolderReportStoreOptions, ReportEntry, ReportFolderNode, ServerErrorKind, StoredReport } from './store.js';
export { nodeHandler, fastifyPlugin, toServerRequest } from './node.js';
export { ConsoleApi, ADMIN_KEY_HEADER } from './console.js';
export type { ConsoleOptions } from './console.js';
export { ServerData, samplesSource, loadSamples, SAMPLE_CONNECTION_ALIAS, SAMPLE_REPORTS_FOLDER } from './data.js';
export type { ApiKeyRecord, SampleEntry, SamplesInstallResult } from './data.js';
export {
  ConnectionsStore,
  availableProviders,
  buildConnectionString,
  connectionFactories,
  connectionFactory,
  connectionStringParameters,
  describeProvider,
  testConnection,
} from './connections.js';
export type { AgentTestOptions, ConnectionDefinition, ConnectionParameterInfo, ConnectionTestResult, ServerDrivers } from './connections.js';
