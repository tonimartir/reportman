# @reportman/ngx-designer

The web report designer of Report Manager for Angular: the editor (canvas, structure, properties,
undo), the SQL and expression editors, the preview, and the Reportman AI copilot. It talks to a
Reportman designer server: **@reportman/designer-server** (Node.js) or **Reportman.Server** (.NET),
which mount the designer's routes (`/api/designer`) and, for the AI, `/api/ai/` and `/api/ai-login`.

This library is not published yet (`"private": true`). To use the designer in a page today use the
custom element, `@reportman/designer` (`../reportman-designer-element`), which brings this library
inside it.

The report model, its undo history and the protocol live in `@reportman/lib`.

## Mounting it

```ts
// app.config.ts
provideHttpClient(),
provideZoneChangeDetection({ eventCoalescing: true }),   // the editor still relies on zone.js
provideReportmanDesigner({
  designerUrl: '/api/designer',            // the default
  host: () => {
    const session = inject(MySession);       // runs in an injection context
    return {
      aiInstallId: () => session.aiInstallId,          // the server's AI installation
      aiAvailable: () => session.designs(),            // may read signals
      sessionLost: () => session.backToLogin(),        // your session ended (401 LoginRequired)
      checkReportConnections: (report) => myWizard.check(report),   // optional
    };
  },
}),
```

Calls go through Angular's `HttpClient` (your interceptors add your session) and, for the AI's
streams, `fetch` to the same origin (your session cookie travels). Everything in `DesignerHost`
but `aiInstallId` has the defaults of the designer servers: `/api/ai/`, `/api/ai-login`,
`/ai/callback`.

```html
<report-editor #editor [reportName]="'ALIAS/path/report.rep'" [copilot]="true" (executed)="preview($event)">
  <rp-copilot-panel rpdCopilot [editor]="editor"></rp-copilot-panel>
</report-editor>
```

```ts
preview(result: ReportResult) {
  PdfViewerDialogComponent.open(this.dialog, result, 'report.pdf');
}
```

- **The AI's login** with Google or Microsoft comes back to a route of yours: route
  `AiLoginCallbackComponent` at `/ai/callback` (or at `DesignerHost.aiCallbackPath`).
- **Styles**: add `styles/designer-utilities.scss` and `styles/designer.scss` (shipped with the
  package) to your global styles, with an Angular Material theme. The look is CSS variables on
  `:root` (`--rpd-accent`, `--rpd-surface`, `--rpd-text`, `--rpd-border`, `--rpd-font`, `--rpd-fs`…):
  override them to fit your application.
- **Icons**: the Material Icons font (`https://fonts.googleapis.com/icon?family=Material+Icons`).
- **Monaco** (the SQL and expression editors) is loaded from `assets/monaco-editor/min/vs`, or from
  `DesignerHost.monacoUrl`. Serve `node_modules/monaco-editor/min` there.
- **Language**: Spanish, English, Catalan, French, German, Italian, Portuguese and Chinese
  (`TranslationService.languages`), `await inject(TranslationService).setLang('ca')`; any other is
  English. Spanish and English are in the bundle, the rest load the first time they are chosen.
  The editor's bar is translated too; `[labels]` still overrides any of its texts.
- **Connections**: `DESIGNER_CONNECTIONS` (optional) lists the aliases your server resolves, for
  "add connection".

## Building

The library lives in the Angular workspace `typescript/designer` of this repository and is built
against the model package `@reportman/lib`, which lives in `typescript/packages` (build it first:
`npm run build` in `typescript`).

```bash
# from typescript/designer
npm run build:lib    # → dist/reportman-designer
```
