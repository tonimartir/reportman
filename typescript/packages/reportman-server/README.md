# @reportman/server

The reports API of Reportman.Server for Node.js, over folders of `.rep` files: list the reports of
an alias, describe their parameters and run them to PDF, metafile, text or CSV — the same routes,
answers and error codes, so the programs that call Reportman.Server can call this one. With a data
folder it also has the console of Reportman.Server: connections (defined and tested), aliases, API
keys, the sample reports and an API explorer. Pure JavaScript on top of `@reportman/node`;
framework independent, with adapters for `node:http`, Express and Fastify.

Status: preview (`0.1.0-alpha.N`, npm tag `next`).

## Try it

```bash
npx @reportman/server --samples
```

It creates `./reportman-data`, installs the sample reports with their SQLite database, prints the
console key and listens on `http://127.0.0.1:8080/`. Open that address, enter the key, and the API
explorer runs the samples: it shows the exact request and gives the same call for curl,
PowerShell, JavaScript, C# and Delphi.

| Option | |
|---|---|
| `--data <folder>` | the data folder (`./reportman-data`) |
| `--port <n>`, `--host <address>` | `8080` and `127.0.0.1`; `0.0.0.0` listens on every network (put HTTPS in front) |
| `--samples` | install the sample reports, their database and the `SAMPLES` connection |
| `--admin-key <key>` | the console key (or `REPORTMAN_ADMIN_KEY`); by default one kept in `console.key` of the data folder |
| `--trusted` | the console without a key: only on a machine of your own |
| `--culture <name>` | the culture of the runs (`en-US`) |
| `--standard-fonts` | the 14 standard PDF fonts instead of the TrueType fonts of the system |

SQLite is built in. For other databases install their drivers next to the server and they are
used: `@reportman/driver-postgres`, `@reportman/driver-firebird`, `@reportman/driver-mysql`,
`@reportman/driver-mssql`, and `@reportman/driver-http` for the Reportman AI Agent.

## The data folder

Laid out as the one of Reportman.Server, so a folder moves between the two:

| | |
|---|---|
| `informes/` | the report folders of the aliases (a relative folder hangs from here) |
| `server.json` | the aliases: `{ "aliases": { "INFORMES": "." } }` |
| `dbxconnections.ini` | the connections, the file the Delphi and .NET designers read |
| `apikeys.json` | the API keys |
| `ejemplos/` | the database of the sample reports |
| `console.key` | the console key the command line made (not used by Reportman.Server) |

A direct connection names its provider (`SQLiteCore`, `PostgreSQL`,
`FirebirdSql.Data.FirebirdClient`, `MySQLConnector`, `SQLServer`) and keeps the parameters of the
.NET connection string builder (`Param.Host=...`), with the connection string built from them; a
database file inside the data folder is written relative to it. An Agent connection keeps its Hub
database and key. What the JavaScript drivers cannot do is a clear error of the connection test:
SQLite encrypted with a password, Windows authentication for SQL Server, embedded Firebird, ODBC.

## Routes

| Route | Answer |
|---|---|
| `GET /api/health` | `{ status, version, engine, aliases, console }` |
| `GET /api/reports/aliases` | the aliases the caller may run |
| `GET /api/reports/{alias}/tree` | `{ name, path, folders, reports: [{ name, path, size, modifiedUtc }] }` |
| `GET /api/reports/{alias}/parameters?path=` | `[{ name, type, description, hint, visible, value, allowNulls }]`, the shape of Reportman.Server |
| `GET /api/reports/{alias}/parameters/describe?path=` | the `ParameterDescription` of step 1 (options of the lists, lookups read) |
| `GET /api/reports/{alias}/execute?path=&format=&NAME=value` | the output; `download=1` sends it as an attachment |
| `POST /api/reports/{alias}/execute?path=&format=` | the same, the parameters in a JSON body `{ "parameters": {...}, "format": "pdf" }` or a form |

`format` is `pdf` (default), `metafile` (the `.rpmf` of the viewers, compressed), `text` (the
PLAIN text of a line printer, laid out on its character grid, in UTF-8) or `csv` (semicolons, quoted,
UTF-8 with BOM). The parameters are set as Reportman.Server sets them: any parameter, hidden ones
too, by alias or name; a text `yyyy-MM-dd[THH:mm[:ss]]` is a date.

Errors are JSON `{ error }`: 400 (a bad path, format or body), 401 (no valid key), 403 (the key does
not run that alias), 404 (an unknown alias or report), 422 (the report has no data — `noData:
true` — or fails in an item: `errorComponentName`, `errorComponentProperty`), 501 (`text` turned
off), 500 otherwise.

The console routes, with a data folder and the console key in `X-ReportmanServer-AdminKey` (the
routes and answers of Reportman.Server's `ConnectionsController`, `ConsoleController` and
`SamplesController`):

| Route | |
|---|---|
| `GET /api/connections`, `GET/PUT/DELETE /api/connections/{alias}` | the connections, passwords never sent back (an empty one on save keeps the stored one) |
| `POST /api/connections/{alias}/test` | `{ ok, message, serverVersion }`; with a body, a definition before it is stored |
| `GET /api/connections/providers`, `.../providers/{name}/parameters` | the providers this server opens and their parameters |
| `GET /api/console/aliases`, `PUT/DELETE /api/console/aliases/{alias}` | the aliases of `server.json` |
| `GET/POST /api/console/keys`, `PUT/DELETE /api/console/keys/{id}`, `POST .../{id}/rotate` | the API keys |
| `POST /api/console/samples` | install the sample reports that are missing |
| `GET /api/reports/samples?lang=`, `.../samples/thumbnails/{name}` | the sample reports and their pictures |
| `GET /api/console/status` | public: whether the console needs a key |

## Use in a program

```ts
import http from 'node:http';
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

Or with a data folder and its console: `createReportServer({ dataPath: '/srv/reportman', adminKey,
drivers: { postgresql: postgres } })`. Aliases, connections and keys given in code are served
next to the ones of the folder (the code wins for the same name) and the console does not change
them.

- **Express**: `app.use(nodeHandler(server))`; other paths go on to `next()`. Body parsers that ran
  before are fine.
- **Fastify**: `fastify.register(fastifyPlugin(server))`.
- **Anything else**: `server.handle({ method, path, query, headers, body })` gives
  `{ status, headers, body }`.

A key goes in the `X-ReportmanServer-ApiKey` header, or as `apikey` in the query for plain links.
**Without any key (in `apiKeys` or `apikeys.json`) the reports API is open**: only for a server
that just your own programs reach.

Options: `aliases`, `dataPath`, `drivers`, `adminKey`, `trusted`, `connections` (or a function of
the alias), `datasets` (rows given by the program), `apiKeys`, `culture`, `fonts` (the system
TrueType fonts by default, as the FreeType device of Reportman.Server; `false` for the standard 14
PDF fonts), `allowFileAccess` (false: a report does not read the disk), `text` (another text
output, or `false`), `clock` (of TODAY, NOW and the dates of the PDF), `agentApiUrl` (where Agent
connections are tested), `consolePage` (`false`: the console routes without the page).

## Not here yet

The rest of Reportman.Server: saving, renaming and deleting reports, the designer protocol
(`/api/designer/*`), users, groups and sessions (the console has one key), the audit log, the SQL
schemas of the connections and the AI bridge.

License: MPL-2.0.
