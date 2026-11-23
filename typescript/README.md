# Report Manager in TypeScript

The Report Manager engine as npm packages: run `.rep` reports from Node.js (and the browser) with
**JavaScript only** — no native binaries, no WebAssembly, no Docker, no OS dependencies. It is a
translation of the C# engine in this repository; the two engines are meant to give the same output
for the same report.

Status: **preview**, versions `4.1.0-alpha.N` with the npm tag `next`
(`npm install @reportman/node@next`); the API may change until 4.1.0. The plan (in Spanish) is
`docs/npm_typescript_plan.md` of the Delphi repository (`tonimartir/reportmandelphi`).

**Examples:** the eleven sample reports, with pictures of their pages, their `.rep` files and the
PDFs `@reportman/node` makes of them, are in the [examples gallery](examples/README.md), which also
shows how to run them; every package's README points there. `npx @reportman/server --samples`
runs them in a web console.

## Packages

| Package | What | Runs in |
|---|---|---|
| `@reportman/lib` | The report model (the camelCase JSON of the engine model, shared with the web designer), its undo history, and the `.rep` XML reader | browser, Node |
| `@reportman/metafile` | The metafile: the device-independent pages a report is laid out into, and the layout device contract (measure text, draw a page) | browser, Node |
| `@reportman/text` | Text measurement: the standard 14 PDF fonts, and TrueType/OpenType fonts with fontkit (shaping, fallback, bidi with bidi-js), HTML text, the engine's line breaking | browser, Node |
| `@reportman/pdf` | Metafile → PDF (standard fonts, or embedded font subsets; images; PDF/A-3B); also the layout device that measures text while the report is laid out | browser, Node |
| `@reportman/engine` | Expressions, parameters (two steps), datasets, and the layout of a report into a metafile: sections, groups, subreports, images, barcodes, charts | browser, Node |
| `@reportman/dfm` | Optional: Delphi DFM reports (text, binary, compressed) to the XML the Delphi engine writes for them; `reportman-dfm2xml` | browser, Node |
| `@reportman/node` | Node.js host: open a `.rep`, describe its parameters (step 1), run it to PDF (step 2); SQLite (`node:sqlite`), system fonts, CLI `@reportman/pdf` | Node |
| `@reportman/export` | Metafile → CSV (as C#), SVG and HTML (as the Delphi drivers); the text of line, dot matrix and receipt printers (`PrintOutText`) | browser, Node |
| `@reportman/canvas` | The preview: the pages of a metafile on a Canvas 2D context, drawn as the PDF draws them | browser |
| `@reportman/server` | The reports API of Reportman.Server (list, parameters, run to PDF, `.rpmf`, text, CSV) for `node:http`, Express and Fastify; with a data folder, its console (connections, aliases, API keys, samples, API explorer) and the `reportman-server` command | Node |
| `@reportman/driver-postgres` | PostgreSQL (`pg`), as Npgsql | Node |
| `@reportman/driver-firebird` | Firebird (`node-firebird`), as FirebirdClient | Node |
| `@reportman/driver-mysql` | MySQL and MariaDB (`mysql2`), as MySqlConnector | Node |
| `@reportman/driver-mssql` | SQL Server (`tedious`), as Microsoft.Data.SqlClient | Node |
| `@reportman/driver-http` | The Reportman AI Agent through the Hub HTTP API (`fetch`), as HttpAgentExecutor | browser, Node |

The eleven reports of `../samples` give the same metafile as the C# engine: with the standard fonts
the PDFs are byte-identical (nine samples; `letter` and `international` need fonts), and with
`fonts` every sample matches the C# FreeType device except the bytes of the embedded font subsets.
The `.rpmf` metafile files of the viewers are written and read byte for byte as C# writes them
(`writeRpmf`, `readRpmf` of `@reportman/metafile`). Not ported yet: declarative REST datasets.

## Rules

1. **The core does no I/O.** Every package but `@reportman/node` is compiled without DOM or Node
   types (`lib: ES2023`, `types: []`): using `fs`, `window` or `fetch` there does not compile. The
   host gives report bytes, font bytes, data access, the clock and the locale.
2. **Pure JavaScript.** Third-party dependencies are plain JavaScript: no `.node`, `.wasm`,
   `.so`/`.dll`, and no install scripts. `npm run check:pure-js` enforces it. Node's built-in
   modules (`node:zlib`, `node:sqlite`) are allowed in `@reportman/node`.
3. **XML reports; DFM through an optional converter.** Like the C# engine, the readers accept XML
   `.rep` files (plain or zlib compressed). A report saved by Delphi in a DFM form is converted
   by `@reportman/dfm` to the XML Delphi writes for it, byte for byte (`@reportman/node` uses it
   when it is installed), or saved again as XML from the designer or with `reptotxt -xml`.
4. **Same output as C#.** Each ported part is checked against the C# engine with
   `tools/golden-cs` (model JSON, expression results, metafile and PDF of a run).
5. **ES modules only, Node 22.12 or later.** There is no CommonJS build: a CommonJS program loads
   the packages with `require()` (Node's `require(esm)`), which `check:dist` tests for every
   package. So the exports use the `default` condition and no module a package loads has a
   top-level `await` (a worker file, loaded apart, may).

## Build and test

```bash
npm install
npm run build        # tsc -b
npm test             # vitest, against the sources
npm run check:pure-js
npm run check:dist   # the builds in plain Node, the CLIs on the samples
npm run check:browser  # the expression parity cases in a headless Edge or Chrome
npm run check:canvas   # the canvas preview against the PDF rasterized by poppler (WSL on Windows)
npm run check:dfm -- <folder>   # @reportman/dfm against Delphi on the DFM reports of a folder (tools/golden-dfm)
```

### The live demo

`demo/` is the page of `https://reportman.es/demo/`: the samples run in the visitor's browser
(step 1 the form of the parameters, step 2 the preview with `@reportman/canvas` and the PDF), from
the sources of the packages. The data is read with sql.js (SQLite in WebAssembly, a dev dependency
used by the page only) with the behaviour of the `sqlite()` connection of `@reportman/node`; the
fonts are open fonts in WOFF2 (`demo/public/fonts`, with their licences: Liberation, DejaVu, Noto,
the Japanese one subset to the characters of the samples), chosen by the Linux names the reports
carry.

```bash
npm run demo -- dev --site <Delphi repository>/doc      # http://127.0.0.1:5180/ (--site for the stylesheet)
npm run demo -- check                                   # every sample in a headless Edge or Chrome: each PDF must be the one @reportman/node writes
npm run demo -- build --out <Delphi repository>/doc/demo  # the static site, committed there (doc/ is reportman.es)
npm run demo -- thumbs                                  # the small thumbnails of the list (ImageMagick)
```

### Releases

Every package has the same version, the one the Delphi and C# engines share at each release
(4.x). `npm run version:set -- 4.1.0-alpha.2` sets it on all of them, on the references between
them and in `package-lock.json` (edit the status lines of the README files by hand);
`npm run release:next` checks that they share it, builds from scratch, runs the tests and
`check:dist`, and stages them with the tag `next` (`tools/release.mjs`, npm 11.15 or later):
`npm stage publish` asks for no 2FA, and the staged versions are approved together in the
**Staged Packages** tab of the account settings on npmjs.com, with one 2FA for the batch. Then
`npm run release:publish` (it can be run again: it does only what the registry does not have yet)
moves the tag `latest`, which npm gives to the first version of a package and the website shows,
to the newest preview while there is no final version. The registry takes some minutes to show a
new version everywhere: a package may look missing for a while.

Moving a tag asks for the 2FA once a package with a login session. With `NPM_STAGE_TOKEN` set in
the terminal to a granular access token of the account with the permission **Read and write
(stage only)** and **Bypass two-factor authentication** (for the `@reportman` packages, created on
npmjs.com), every command of the release runs with that token and none asks for the 2FA: such a
token cannot publish, only stage, move tags and deprecate, and what it stages waits for the
approval. `--direct` publishes with `npm publish` instead (one 2FA a package).

### Continuous integration, on this computer

`npm run ci` (`tools/ci.mjs`) copies the working tree (the files git tracks or would track in
`typescript/` and `samples/`, uncommitted changes included, never a `node_modules` or a `dist`) and
runs `npm ci`, build, tests, `check:pure-js`, `check:dist` and `check:browser` on it (the last one
passes without a browser, as in the Docker images):

- on Windows, with the Node of the computer (when it runs on Windows);
- on Linux, in Docker — inside WSL when it runs on Windows — once on `node:22` and once on
  `node:24` (Debian bookworm slim), with the host network, so the driver tests reach the test
  databases when they are up, and the time zone of the computer, the one of the fixtures.

`--windows` or `--linux` runs one system only, `--node 24` other Linux versions, `--distro` another
WSL distribution, `--keep` leaves the copies. It prints one line per step and keeps the logs.

The fixtures of the C# engine come from Windows: where .NET answers per system (`Environment.NewLine`
in SQL Server xml values, `Environment.MachineName`) the tests expect the answer of the system they run
on, and the FreeType parity cases run only with the Windows fonts they were written with.

### What a set of reports uses

`npm run inventory -- <report.rep | folder>... [--md out.md] [--json out.json]`
(`tools/rep-inventory.mjs`, after `npm run build`) reads each report with the XML reader (a Delphi DFM
file is listed apart, to save as XML from the designer) and counts the classes, sections, connections by
driver, datasets (SQL, master/detail, unions), parameters, the functions, report variables, fields and
parameters of the expressions (and the functions the engine does not know), fonts, display formats,
images, and the properties set to other values than the defaults. It never writes a connection
string, an SQL sentence or a parameter value.

Reference outputs of the C# engine (needs the .NET 10 SDK):

```bash
dotnet build -c Release tools/golden-cs
tools/golden-cs/bin/Release/net10.0/golden-cs model-json ../samples/customers.rep
tools/golden-cs/bin/Release/net10.0/golden-cs eval cases.json out.json --culture en-US
tools/golden-cs/bin/Release/net10.0/golden-cs run ../samples/customers.rep meta.json --pdf out.pdf --sqlite ../samples/samples.db
```

`golden-cs eval ... --delphi` evaluates as in a report converted from Delphi (`Evaluator.DelphiMasks`
of C#, `delphiMasks` of the context here): where the C# engine works with another behaviour than
the Delphi one, only such a report takes the Delphi behaviour. The expression fixtures have both
modes (`packages/reportman-engine/test/generate-eval-fixtures.mjs`).

Where the reference is the Delphi engine (Delphi 13, Win32): `tools/golden-delphi` runs a report
as `printreptopdf` does (its metafile, SVG, HTML and PDF), `tools/golden-dfm` reads and writes DFM
as `System.Classes` does, `tools/golden-delphi-eval` evaluates expressions with the Delphi
evaluator (its `compare.mjs` compares them with `golden-cs eval`, with `--delphi` as a converted
report), and `tools/golden-delphi-dates` gives the format settings and
`FormatDateTime` of each culture: a report converted from Delphi formats its dates with the masks
of Delphi (`packages/reportman-engine/test/generate-delphi-date-fixtures.mjs`). Each folder has its
`build.bat`. The barcodes are checked against Delphi too: `generate-barcode-delphi-fixtures.mjs`
keeps the bars `golden-delphi` draws for the `bc-delphi-*` reports, and `barcode-delphi.test.ts`
compares them with the bars of this engine and reads the symbols back.

License: MPL-2.0, like the C# engine.
