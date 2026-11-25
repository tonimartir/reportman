# The web designer (Angular workspace)

The sources of the Report Manager web designer:

| Project | What | npm |
|---|---|---|
| `projects/reportman-designer` | The designer as an Angular library: the report editor, the SQL and expression editors, the object inspector, and the Reportman AI copilot (which talks to Reportman.Server) | `@reportman/ngx-designer`, not published yet |
| `projects/reportman-designer-element` | The designer as a custom element, `<reportman-designer>`, for any page (Angular, Material and Monaco inside a shadow root) | [`@reportman/designer`](../packages/reportman-designer) |

The report model is `@reportman/lib` (`../packages/reportman-lib`), compiled from its sources. The
server of the designer is `@reportman/designer-server` (Node.js, `../packages/reportman-designer-server`)
or Reportman.Server (.NET).

This workspace is not one of the npm workspaces of `typescript/`: it has its own `package.json`
and `node_modules`, so the engine packages build and test without Angular.

```powershell
npm ci
npm run build:package    # the element into ../packages/reportman-designer/dist (no Monaco: a dependency)
npm run build:element    # the element with Monaco in assets/, into dist/reportman-designer-element
npm test                 # the library's unit tests (vitest)
```

`build:package` ends with `../tools/check-designer.mjs`: the element, its stylesheet and its fonts
are in the package, Monaco is not, and nothing is loaded from another site (the fonts, Roboto and
Material Icons, are served with the element from `assets/fonts`).

License: MPL-2.0. The fonts keep their own licenses (SIL Open Font License 1.1 for Roboto, Apache
License 2.0 for Material Icons), shipped next to them.
