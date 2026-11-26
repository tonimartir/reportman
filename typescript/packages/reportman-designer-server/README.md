# @reportman/designer-server

The Report Manager web designer for Node.js: the server side of the `<reportman-designer>`
element, inside your own program. `npm install` and one route in Express, Fastify or node:http —
no container, no .NET, and the designer is served from your own origin, so it shares your session.

It answers the designer protocol of Reportman.Server (open, save, preview, the expression editor,
the SQL editor's data and tables) over folders of `.rep` files, with the connections you give it,
and, with `ai: true`, the designer's AI assistant (the copilot that designs and changes reports, the
SQL and expression assistants) through [Reportman AI](#the-ai-of-the-designer).

**Live demo:** <https://reportman.es/demo/designer/> — the designer on the sample reports, the AI
copilot included, answered in the browser by this package's protocol (see *Without Node.js* below).

> Status: preview (`next`). The answers are compared with the ones of Reportman.Server in the
> tests (`test/golden-http`). Reports are saved, exported and imported as the C# engine writes
> them (the `.rep` XML writer of `@reportman/lib`).

## The SQL editor

The tables and columns the SQL editor completes come from the connection: with a data folder, a
connection of its `dbxconnections.ini` keeps them in a local schema file,
`dbxschemas/<ALIAS>.json` next to it — the file the Delphi and .NET designers keep, with the
subschemas and the descriptions people wrote — generated from the database's catalog the first
time and read again (keeping what people wrote) when the designer asks to refresh. A connection
your program gives is read from its catalog (kept five minutes). The catalog is read for SQLite,
PostgreSQL, MySQL, SQL Server and Firebird; an Agent connection has no schema here
(Reportman.Server's AI package describes it).

## Use

```js
import express from 'express';
import { sqlite } from '@reportman/node';
import { createDesignerServer, nodeHandler } from '@reportman/designer-server';

const designer = createDesignerServer({
  aliases: { REPORTS: './reports' },
  connections: { MAIN: sqlite('./data.db') },
  // Who may do what: give the designer to the people who design reports
  authorize: (check, request) => isDesigner(request),
});

const app = express();
app.use(nodeHandler(designer));
app.listen(3000);
// http://localhost:3000/designer/?report=REPORTS/sales.rep
```

A whole application to run: [`examples/designer-express`](https://github.com/tonimartir/reportman/tree/main/typescript/examples/designer-express)
(the sample reports, their SQLite database and the designer in Express). Mount it before
`express.json()`, or give that parser a bigger limit: a report with pictures is bigger than its
default 100 kB. `request.raw` in `authorize` is the framework's request (your session, your user).

## The AI of the designer

With `ai`, the designer's AI goes through your server, as with Reportman.Server: the page never
talks to the Reportman AI cloud (`https://aiapi.reportman.es`), so it needs no origin the cloud
knows and no secret.

```js
const designer = createDesignerServer({
  dataPath,
  connections: { MAIN: sqlite('./data.db') },
  authorize: (check, request) => isDesigner(request),
  ai: true,      // or { installId, apiUrl, credentials, accountStatus, audit }
});
```

- `{base}/api/ai/*` passes on the copilot's calls (only the routes the designer uses: anything else
  is a 404) as **this installation**, and streams the answer back as it arrives; stopping on the page
  stops the call to the cloud. `{base}/api/ai-login/*` is the AI's login (by e-mail, Google, Microsoft
  or Apple), and `{base}/api/session/config` tells the element its installation.
- The installation is the one Reportman.Server keeps in its data folder (`server-id`), or
  `installId` (it must start with `repman-` or `web-`). Without a Reportman AI account, its guest
  credits pay; the person can log into Reportman AI from the chat, and then their account pays.
  `credentials(request)` lets a host whose users already are Reportman AI accounts say which one a
  request goes as, and `accountStatus(request)` the credits the designer shows when someone else pays.
- The copilot works on the report's connection: `{base}/api/designer/AiContext` gives it the
  columns of every dataset, the functions and the parameters, and `SqlColumns` runs the SQL it
  writes **to learn its columns only**: a single `SELECT` or `WITH` (anything else is refused before
  it runs), on a connection closed without committing.
- The AI designs with the part of the database you choose: the subschemas of the connection's local
  schema file (`dbxschemas/<ALIAS>.json` of the data folder), and a dataset remembers the subschema
  it was made with (`SCHEMANAME`), so a report opens with its own. `audit(call, request)` sees every
  call that spends.

The element shows the copilot when its server answers `{base}/api/session/config` (without `ai`,
open it with `no-ai`). `design-prompt` and `design-subschema` start a new report with a request: the
copilot designs it as soon as the report opens (README of `@reportman/designer`).

## Without Node.js: `@reportman/designer-server/browser`

The protocol and the operations of the designer use no Node.js API: `@reportman/designer-server/browser`
gives them over a backend of your own, so a page can answer its designer itself — a service worker
that takes the requests of the element's `api-base` — or another JavaScript server can. The backend
says where the reports are stored and how a report runs (the engine with its connections, culture,
clock and fonts); the live demo keeps the reports in the browser's Cache Storage and runs them on
sql.js.

```ts
import { DesignerOperations, DesignerProtocol, type DesignerBackend } from '@reportman/designer-server/browser';

const backend: DesignerBackend = {
  store,                                   // open(alias, path) / save(alias, path, bytes, eTag)
  open: (model, reportAlias, layout) => runner(model, layout), // prepareRun() and executeToPdf()
  fingerprint: () => 'my-database',        // a key of the caches for a connection alias
  schemaConnection: (alias) => ({ kind: 'direct', alias, family: 'sqlite', factory, definition: null, keepsFile: false, fingerprint: 'my-database' }),
};
const protocol = new DesignerProtocol(new DesignerOperations(backend), { authorize: () => true, basePath: '/designer' });
// in a service worker: if (protocol.owns(url.pathname)) event.respondWith(answer(protocol.handle(request)))
```

`DesignerProtocol` refuses everything unless it is given `authorize`: give it one that says who may
design when the protocol answers other people (in a page's own service worker, everyone is the visitor).
The Node server (`createDesignerServer`) is this protocol over `nodeDesignerBackend`.

The AI works there too: `new DesignerProtocol(operations, { authorize, ai: { installId: 'web-…' } })`
passes the copilot's calls on with `fetch`. From a browser the cloud sees the page's origin, and it
accepts the calls only from the origins it knows; the live demo is one of them.

## Security

The designer opens data with the connections of your server and runs any SQL a report holds, and
it saves reports. So:

- **Without `authorize` it answers only this machine** (localhost): enough to try it, and closed
  when it is deployed. Give `authorize(check, request)` to open it, with the three checks of
  Reportman.Server: `{ action: 'run', alias }` (open or run the reports of an alias),
  `{ action: 'design', alias }` (save reports in it) and `{ action: 'designer' }` (open data,
  evaluate expressions, run a report that is not saved).
- A report opens only the connections you give (`connections`, or the `dbxconnections.ini` of a
  data folder); one the server does not define is an error, never opened from what the report
  says. The parameter `ADOCONNECTIONSTRING` of a report does not change the connection.
- Reports do not read files (`allowFileAccess` is false by default).
- A report path never leaves the folder of its alias; saving keeps the replaced version in
  `.versions/` and refuses to overwrite a report someone else saved (its ETag).

## License

MPL-2.0.
