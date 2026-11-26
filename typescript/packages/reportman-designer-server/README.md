# @reportman/designer-server

The Report Manager web designer for Node.js: the server side of the `<reportman-designer>`
element, inside your own program. `npm install` and one route in Express, Fastify or node:http —
no container, no .NET, and the designer is served from your own origin, so it shares your session.

It answers the designer protocol of Reportman.Server (open, save, preview, the expression editor,
the SQL editor's data and tables) over folders of `.rep` files, with the connections you give it.
The AI assistant is not part of it: it stays in Reportman.Server, and the designer runs with
`no-ai`.

**Live demo:** <https://reportman.es/demo/designer/> — the designer on the sample reports, answered
in the browser by this package's protocol (see *Without Node.js* below).

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
