# @reportman/server

The reports API of Reportman.Server for Node.js, over folders of `.rep` files: list the reports of
an alias, describe their parameters and run them to PDF, metafile, text or CSV — the same routes,
answers and error codes, so the programs that call Reportman.Server can call this one. Pure
JavaScript on top of `@reportman/node`; framework independent, with adapters for `node:http`,
Express and Fastify.

Status: preview (`0.1.0-alpha.N`, npm tag `next`).

## Routes

| Route | Answer |
|---|---|
| `GET /api/health` | `{ status, version, engine, aliases }` |
| `GET /api/reports/aliases` | the aliases the caller may run |
| `GET /api/reports/{alias}/tree` | `{ name, path, folders, reports: [{ name, path, size, modifiedUtc }] }` |
| `GET /api/reports/{alias}/parameters?path=` | `[{ name, type, description, hint, visible, value, allowNulls }]`, the shape of Reportman.Server |
| `GET /api/reports/{alias}/parameters/describe?path=` | the `ParameterDescription` of step 1 (options of the lists, lookups read) |
| `GET /api/reports/{alias}/execute?path=&format=&NAME=value` | the output; `download=1` sends it as an attachment |
| `POST /api/reports/{alias}/execute?path=&format=` | the same, the parameters in a JSON body `{ "parameters": {...}, "format": "pdf" }` or a form |

`format` is `pdf` (default), `metafile` (the `.rpmf` of the viewers, compressed), `text` or `csv`
(semicolons, quoted, UTF-8 with BOM). The parameters are set as Reportman.Server sets them: any
parameter, hidden ones too, by alias or name; a text `yyyy-MM-dd[THH:mm[:ss]]` is a date.

Errors are JSON `{ error }`: 400 (a bad path, format or body), 401 (no valid key), 403 (the key does
not run that alias), 404 (an unknown alias or report), 422 (the report has no data — `noData:
true` — or fails in an item: `errorComponentName`, `errorComponentProperty`), 501 (`text` without
a text output configured), 500 otherwise.

## Use

```ts
import http from 'node:http';
import { sqlite } from '@reportman/node';
import { postgres } from '@reportman/driver-postgres';
import { createReportServer, nodeHandler } from '@reportman/server';

const server = createReportServer({
  aliases: { SALES: '/srv/reports/sales' },                 // a folder of .rep files per alias
  connections: { SALES: postgres(process.env.PG_URL!) },   // by report connection alias
  apiKeys: [{ key: process.env.REPORTS_KEY!, aliases: ['SALES'] }],
  culture: 'es-ES',
});
http.createServer(nodeHandler(server)).listen(8080);
```

- **Express**: `app.use(nodeHandler(server))`; other paths go on to `next()`. Body parsers that ran
  before are fine.
- **Fastify**: `fastify.register(fastifyPlugin(server))`.
- **Anything else**: `server.handle({ method, path, query, headers, body })` gives
  `{ status, headers, body }`.

A key goes in the `X-ReportmanServer-ApiKey` header, or as `apikey` in the query for plain links.
**Without `apiKeys` the API is open**: only for a server that just your own programs reach.

Options: `connections` (or a function of the alias), `datasets` (rows given by the program),
`culture`, `fonts` (the system TrueType fonts by default, as the FreeType device of
Reportman.Server; `false` for the standard 14 PDF fonts), `allowFileAccess` (false: a report does
not read the disk), `text` (the text output).

## Not here yet

The rest of Reportman.Server: saving, renaming and deleting reports, the designer protocol
(`/api/designer/*`), the console, users and sessions, the connections API and the AI bridge.

License: MPL-2.0.
