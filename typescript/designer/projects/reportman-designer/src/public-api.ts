/*
 * Public API of @reportman/ngx-designer: the Report Manager web report designer, an Angular library
 * (ngx-reportman), dressed with Material, and the shell services it needs from its host.
 */
export * from './lib/report-editor/report-editor.component';
export * from './lib/object-inspector/object-inspector.component';
export * from './lib/report-structure-tree/report-structure-tree.component';
export * from './lib/components/cue-list/cue-list.component';
export * from './lib/components/expression-builder/expression-builder.component';
export * from './lib/services/ngx-reportman-lib.service';
export * from './lib/services/canvas.service';
export * from './lib/services/translator.service';
export * from './lib/services/file.service';
export * from './lib/models/report-dataset-helper';
export * from './lib/shell/presentacion.service';
export * from './lib/shell/ventana';
export * from './lib/shell/opcion-menu';
export * from './lib/shell/tipo-confirmacion';
export * from './lib/shell/loading.modal';
export * from './lib/shell/texto';
export * from './lib/shell/app-services';
export * from './lib/shell/shared.module';
// What SharedModule declares has to be public too, or a consumer of the module could not compile it.
export * from './lib/shell/widgets/boton.component';
export * from './lib/shell/widgets/entradas.component';
export * from './lib/shell/widgets/menu.component';
export * from './lib/shell/widgets/ng-icon.directive';
export * from './lib/shell/widgets/split.component';
export * from './lib/shell/widgets/wide-select-panel.directive';
export * from './lib/shell/shell-dialogs';
export * from './lib/shell/designer-ai';
export * from './lib/shell/designer-connections';
export * from './lib/dialogs/sql-dialog/sql-dialog.component';
export { sameSql } from './lib/models/designer-interface-datainfo';
export * from './lib/components/sql-editor/sql-editor.component';
export * from './lib/ai/ai-types';
export { renderAiMarkdown } from './lib/ai/ai-markdown';
export * from './lib/ai/ai-inference-tracker';
export * from './lib/ai/ai-log-store';
export * from './lib/ai/ai-usage-header.component';
export * from './lib/ai/ai-chat.component';
export * from './lib/ai/ai-account.component';
// The designer against its server (Reportman.Designer.Server + .Ai): how a host mounts it
// (provideReportmanDesigner, DESIGNER_HOST), the AI through the server's bridge, the Reportman AI
// account, the copilot and the preview.
export * from './lib/server/designer-host';
export * from './lib/server/provide-reportman-designer';
export * from './lib/server/designer-ai-bridge.service';
export * from './lib/server/ai-account.service';
export * from './lib/server/ai-config.service';
export * from './lib/server/copilot-api.service';
export * from './lib/server/hub-databases.service';
export * from './lib/server/designer-docs.service';
export * from './lib/server/ai-login-callback.component';
export * from './lib/copilot/copilot-panel.component';
export * from './lib/copilot/schema-choice';
export * from './lib/copilot/schema-selector.component';
export * from './lib/preview/pdf-viewer-dialog.component';
