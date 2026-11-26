// Report Manager web designer for Node.js: the designer protocol of Reportman.Server over folders
// of .rep files and the <reportman-designer> element, served from the program's own origin. The
// adapters of @reportman/server plug it into node:http, Express and Fastify.
export { createDesignerServer, DesignerServer, designerJson, splitName, ReportJson, webJson } from './designer.js';
export type { DesignerAuthorize, DesignerCheck, DesignerServerOptions } from './designer.js';
export { DesignerProtocol } from './protocol.js';
export type { DesignerProtocolOptions } from './protocol.js';
export { DesignerOperations, ForbiddenError, NoDataError, JsonText } from './operations.js';
export type {
  DataSetInformation,
  DesignerBackend,
  DesignerOperationsOptions,
  DesignerRunner,
  DesignerStore,
  EvaluateResult,
  FunctionHelp,
  OperationContext,
  PrintedMetafile,
  ReportDocument,
  ReportResult,
  StoredReportContent,
  SyntaxCheckResult,
  AiLiveContext,
  AiRuntimeDataSource,
  AiProbeParameter,
} from './operations.js';
// The designer's AI through the server: the bridge to the Reportman AI cloud and its login
export { DesignerAiBridge, aiRouteMethod, AI_INSTALL_ID_HEADER, AI_TOKEN_HEADER } from './ai.js';
export type { DesignerAiOptions, DesignerAiCredentials, DesignerAiCall } from './ai.js';
export { whyNotARead } from './ai-sql-guard.js';
export { dataFolderInstallId } from './designer.js';
export { nodeDesignerBackend } from './node-backend.js';
// The report as the designer gets it (the JSON of the C# engine's Report) and as it sends it back
export { designerDocument, modelFromDocument, modelFromXml } from './document.js';
export { parseDesignerJson } from './json.js';
export type { SchemaConnection, SchemaFiles, SqlSchema, SchemaTable, SchemaColumn, SchemaForeignKey, NamedSubschema, RelationRef, AllowedValue, LocalSchemaFile } from './schema.js';
export { parseSchemaFile } from './schema.js';
export type { DesignerElementOptions } from './element.js';
export { nodeHandler, fastifyPlugin, toServerRequest } from '@reportman/server';
export type { HttpServerLike, ServerRequest, ServerResponse } from '@reportman/server';
