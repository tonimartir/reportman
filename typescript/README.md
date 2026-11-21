# Report Manager in TypeScript

The Report Manager engine as npm packages: run `.rep` reports from Node.js (and the browser) with
**JavaScript only** — no native binaries, no WebAssembly, no Docker, no OS dependencies. It is a
translation of the C# engine in this repository; the two engines are meant to give the same output
for the same report.

Status: **prototype, not published**. The plan (in Spanish) is `docs/npm_typescript_plan.md` of
the Delphi repository (`tonimartir/reportmandelphi`).

## Packages

| Package | What | Runs in |
|---|---|---|
| `reportman-lib` | The report model (the camelCase JSON of the engine model, shared with the web designer), its undo history, and the `.rep` XML reader | browser, Node |
| `reportman-metafile` | The metafile: the device-independent pages a report is laid out into, and the layout device contract (measure text, draw a page) | browser, Node |
| `reportman-text` | Text measurement: the standard 14 PDF font metrics and the engine's line breaking | browser, Node |
| `reportman-pdf` | Metafile → PDF; also the layout device that measures text while the report is laid out | browser, Node |
| `reportman-engine` | Expressions, parameters, datasets, and the layout of a report into a metafile | browser, Node |
| `reportman-node` | Node.js host: open a `.rep`, describe its parameters (step 1), run it to PDF (step 2) | Node |

## Rules

1. **The core does no I/O.** Every package but `reportman-node` is compiled without DOM or Node
   types (`lib: ES2023`, `types: []`): using `fs`, `window` or `fetch` there does not compile. The
   host gives report bytes, font bytes, data access, the clock and the locale.
2. **Pure JavaScript.** Third-party dependencies are plain JavaScript: no `.node`, `.wasm`,
   `.so`/`.dll`, and no install scripts. `npm run check:pure-js` enforces it. Node's built-in
   modules (`node:zlib`, `node:sqlite`) are allowed in `reportman-node`.
3. **Only XML reports.** Like the C# engine, the readers accept XML `.rep` files (plain or zlib
   compressed). A report saved by Delphi in DFM format is saved again as XML from the designer.
4. **Same output as C#.** Each ported part is checked against the C# engine with
   `tools/golden-cs` (model JSON, expression results, metafile and PDF of a run).

## Build and test

```bash
npm install
npm run build        # tsc -b
npm test             # vitest, against the sources
npm run check:pure-js
```

Reference outputs of the C# engine (needs the .NET 10 SDK):

```bash
dotnet build -c Release tools/golden-cs
tools/golden-cs/bin/Release/net10.0/golden-cs model-json ../samples/customers.rep
tools/golden-cs/bin/Release/net10.0/golden-cs eval cases.json out.json --culture en-US
tools/golden-cs/bin/Release/net10.0/golden-cs run ../samples/customers.rep meta.json --pdf out.pdf --sqlite ../samples/samples.db
```

License: MPL-2.0, like the C# engine.
