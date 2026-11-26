// The designer protocol without Node.js (@reportman/designer-server/browser): the operations of the
// designer over a backend the page gives (where its reports are and how they run), to answer the
// <reportman-designer> element in the browser itself, from a service worker that takes the requests
// of its api-base. The live demo of reportman.es works so: the samples in the browser's cache,
// their database in sql.js, the engine and the PDF writer of the @reportman packages.
//
//   const protocol = new DesignerProtocol(new DesignerOperations(backend), { authorize: () => true, basePath: '/demo/designer-api' });
//   self.addEventListener('fetch', (e) => { if (protocol.owns(path)) e.respondWith(...protocol.handle(request)...) });
export { DesignerProtocol, designerJson, member, property, ReportJson, splitName, webJson } from './protocol.js';
export type { DesignerAuthorize, DesignerCheck, DesignerProtocolOptions } from './protocol.js';
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
export { designerDocument, modelFromDocument, modelFromXml } from './document.js';
export { parseDesignerJson } from './json.js';
export { bytesToBase64, base64ToBytes } from './base64.js';
export type { SchemaConnection, SchemaFiles, SqlSchema, SchemaTable, SchemaColumn, SchemaForeignKey, NamedSubschema, RelationRef, AllowedValue, LocalSchemaFile } from './schema.js';
export { parseSchemaFile } from './schema.js';
export type { ServerRequest, ServerResponse } from '@reportman/server';
