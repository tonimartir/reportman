# golden-http

The same HTTP requests to Reportman.Server (C#) and to the Node servers of this repository
(`@reportman/server`, `@reportman/designer-server`), and their answers compared. Reportman.Server
is the reference: when the two differ, the Node server is fixed, unless the difference is listed
with its reason in `../golden-http.test.ts` (`DIFFERENCES`, `EXTENSIONS`).

| File | What it is |
|---|---|
| `make-cases.mjs` | The list of requests. Edit it and run `node make-cases.mjs`. |
| `cases.json` | The requests, written by `make-cases.mjs`. |
| `recorded.json` | The answers of Reportman.Server to them. Do not edit it: record them again. |
| `server.ts` | The Node servers that replay them. |
| `../golden-http.test.ts` | The replay, in the vitest suite of the workspace. |

## How the requests run

In order, on a fresh data folder laid out as the one of Reportman.Server, with the sample
reports a new installation gets: the alias `INFORMES` (folder `informes/`), the reports in
`Ejemplos/`, their SQLite database in `ejemplos/samples.db` and the connection `SAMPLES` in
`dbxconnections.ini`. Both servers run without users or keys (Reportman.Server in its *trusted*
mode), in the culture `en-US`, and the Node server's clock is on the day of the recording
(`recordedOn`).

A request can take a value of an earlier answer (`{"$case": "<name>", "$path": "report"}`, e.g.
the report model the designer opened), a sample report in base64 (`{"$base64file": "labels.rep"}`)
or the JSON text of a value (`{"$json": ...}`). An answer is normalized the same way on both
sides: `mask` replaces values that change on every run (version tags, versions), `decode` turns
base64 into text (the XML of an export), `pdf` replaces a PDF in base64 by its page count, and
the data folder and the date of the day become `<data>` and `<today>`. `expect` says what the body
is: JSON (by default), `text`, `pdf`, `metafile`, `binary` (its size and SHA-256) or `status` (only
the status: the body is the framework's).

## Recording the answers of Reportman.Server

The recorder is a test of Reportman.Server (`Reportman.Server.Tests/Contract/GoldenHttpRecorder.cs`,
in the private repository of Reportman.Server). It runs only when `REPORTMAN_GOLDEN_HTTP` names
this folder:

```powershell
$env:REPORTMAN_GOLDEN_HTTP = "<this repository>\typescript\packages\reportman-designer-server\test\golden-http"
dotnet test Reportman.Server.Tests --filter GoldenHttpRecorder
```

It removes the one sample of Reportman.Server alone first (`Ejemplos/ventas-por-cliente.rep`, on
the example database of the cloud through the connection `EXAMPLE`), which the Node server does
not ship.

## What is not compared

Only the routes both servers have. Reportman.Server also answers routes the Node servers do not
have, and they are not in `cases.json`:

- the report files as JSON documents: `GET/PUT/POST/DELETE /api/reports/{alias}/file`,
  `POST /api/reports/{alias}/rename` and `POST /api/reports/execute` (an unsaved document) — the
  designer of the Node servers uses the designer protocol instead (`/api/designer/*`);
- users, groups, permissions, sessions, setup and the audit log (`/api/session/*`, `/api/setup`,
  `/api/console/users|groups|permissions|audit*`, `/api/console/diagnostics`,
  `/api/console/import/repwebexe`);
- the schemas of the connections and their preview (`/api/connections/{alias}/schema*`,
  `/api/connections/{alias}/preview`);
- the AI assistant (`/api/ai/*`, `/api/ai-login/*`) and the copilot routes of the designer
  (`/api/designer/ToXml`, `FromXml`, `SqlColumns`, `AiContext`, `agent-schemas`).

And the Node server has three routes of its own: `GET /api/reports/{alias}/parameters/describe`
(the parameters of step 1, with their options), `GET /api/console/status`, and the `text` format
answering 501 when a program turns it off.
