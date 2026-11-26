# @reportman/designer

Report Manager's web report designer as a custom element, `<reportman-designer>`, for any page
whatever its framework (or none). It brings its own Angular, Material, the designer
(`@reportman/ngx-designer`) and Monaco, inside a shadow root: the page's styles do not reach it and
its styles do not reach the page. It talks to a Reportman designer server: **@reportman/designer-server**
(Node.js) or **Reportman.Server** (.NET). Both can serve the element themselves.

The npm package `@reportman/designer` is this element built (`typescript/packages/reportman-designer`);
the sources are in the Angular workspace `typescript/designer` of this repository.

## Using it

```html
<script type="module" src="https://reports.example.com/element/main.js"></script>

<reportman-designer report="INFORMES/Ejemplos/customers.rep" lang="en" closable style="height: 100vh"></reportman-designer>

<script>
  const designer = document.querySelector('reportman-designer');
  designer.addEventListener('saved', (e) => console.log('saved', e.detail.reportName));
  designer.addEventListener('closed', () => designer.remove());
</script>
```

The element takes the height its container gives it (at least 480 px).

| Attribute | |
|---|---|
| `report` | `ALIAS/path.rep`, the report to design (required) |
| `server` | origin of the designer server; the page's origin by default |
| `api-base` | where its routes hang: `{api-base}/designer`, `{api-base}/ai/`, `{api-base}/ai-login`; `/api` by default. A host that answers per company or per tenant puts it in the route, e.g. `/api/companies/12/designer` (the server's `DesignerOptions.ApiBase`) |
| `ai-account` | `login` (default): the person logs into Reportman AI from the chat. `host`: the host's server puts the person's account on every AI call (`IAiCredentials`) and says the credits to show (`IAiAccountStatus`); the chat neither logs in nor out |
| `lang` | `es` (default), `en`, `ca`, `fr`, `de`, `it`, `pt` or `zh`; any other is English |
| `readonly` | no Save; designing and previewing still work |
| `closable` | a close button, which only fires `closed` |
| `no-ai` | the element without the Reportman AI copilot |
| `ai-install-id` | the server's installation for Reportman AI; asked to the server (`/api/session/config`) when missing, and not needed with `ai-account="host"` or `no-ai` |
| `ai-callback` | the path of the page's origin where the AI's Google/Microsoft login comes back; `ai-callback.html` next to the script by default |
| `design-prompt` | a new report's request: the copilot designs it as soon as the report opens (the new report wizard of Reportman.Server does it so) |
| `design-subschema` | with `design-prompt`, the subschema of the local schema file of the report's connection the copilot designs with; without it, the one a dataset of the report names, else the first |

Property `getToken`: a function (it may be async) returning the page's session as a Bearer token,
added to every call of the designer.

Property `modified` (read-only): the design has changes not saved yet, for the page to ask before
it closes the designer.

| Event | `detail` |
|---|---|
| `saved` | `{ reportName }` |
| `executed` | the preview result (the element also shows the PDF) |
| `closed` | — |
| `sessionlost` | — (the server answered 401: the page's session ended) |

**Sessions today**: the server authenticates with its own cookie, so the page has to be on its
origin (or behind the same reverse proxy). Pages on another origin can pass `getToken` for a server
that accepts a Bearer token.

## Monaco

The SQL and expression editors use Monaco, which the element loads from `assets/monaco-editor/min`
next to the script (`{script folder}/assets/monaco-editor/min/vs`). The npm package depends on
`monaco-editor`, but does not ship its files in the element's folder: a host serves
`node_modules/monaco-editor/min` at that path. `@reportman/designer-server` does it; with
Reportman.Server the app serves its own copy.

## What the isolation takes

- `ViewEncapsulation.ShadowDom` on the element; `:host` starts from `all: initial`, and its two
  roots (the editor and the overlay container) restate the inherited font and colour, because a
  page rule with `!important` that matches the host itself still wins over `:host`.
- The CDK overlay container (dialogs, menus, selects, tooltips) is moved inside the shadow root
  (`ShadowRootOverlayContainer`).
- Monaco's loader puts `editor.main.css` in the document's head; `@reportman/ngx-designer` links it
  into the shadow root as well (`loadMonaco`).
- Fonts are always the document's: the element adds Roboto and Material Icons to the page's head, once,
  served from its own files (`assets/fonts`): no request to another site.
- The library looks things up from its own nodes, never from `document` (the Fabric canvas, the
  focus, the structure tree, the canvas' click-away).
- zone.js is loaded only if the page has none; an Angular page with zones keeps its own.
- Angular also writes its emulated component styles to the page's head; they are scoped by
  `_ngcontent` attributes and do not touch the page.

One designer at a time per page: the element's configuration is one per script. A page may close
it (remove the element) and open another, for another report or in a new dialog: the element's
stylesheet is read once and given to each new one.

## Building

From the workspace `typescript/designer`:

```bash
npm run build:element     # → dist/reportman-designer-element
npm run build:package     # the element as the npm package @reportman/designer (production,package)
```

Scripts that build unattended (a deploy, a Docker image) use the npm scripts and not `ng build`:
Angular CLI 21.2 leaves esbuild's service running and `ng build` never ends; the scripts preload
`scripts/ng-exit.cjs`, which exits with the CLI's code as soon as the CLI sets it.

`public/test.html` is a page with no framework and hostile styles to check the isolation:
`?report=ALIAS/path.rep&lang=en&readonly&noai`.
