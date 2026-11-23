# @reportman/driver-postgres

PostgreSQL for Report Manager in Node.js, through [pg](https://node-postgres.com/) (plain
JavaScript), with the behaviour of Npgsql 10, the provider the C# engine opens PostgreSQL with, so
a report gives the same result in both engines.

```ts
import { openReport } from '@reportman/node';
import { postgres } from '@reportman/driver-postgres';

const report = await openReport('sales.rep', {
  connections: { SALES: postgres('Host=db.example.com;Database=sales;Username=report;Password=...') },
});
const pdf = await report.executeToPdf({ YEAR: 2025 });
```

`postgres(options)` returns a connection factory for `connections`. `options` is an Npgsql
connection string (`Host=...;Port=...;Database=...;Username=...;Password=...`), a libpq URL
(`postgres://user:password@host:port/database`), or an object with pg's client options (`host`,
`port`, `database`, `user`, `password`, `ssl`...) plus:

| Option | |
|---|---|
| `connectionString` | an Npgsql connection string or a URL; the other options win over it |
| `commandTimeout` | seconds a statement may run (30 by default, 0 for no limit) |
| `includeErrorDetail` | put the DETAIL of server errors in their message |
| `culture` | the culture of the run (`'en-US'` by default, as in openReport) |
| `synchronous` | answer the engine synchronously (see below) |

The connection string inside the `.rep` is not used: the host says where the data is. Each run
opens its own client, starts the transaction with the isolation level of the report connection and
ends it when the run closes the connection.

**`synchronous`**: a report that reads data while an expression is evaluated (`GETVALUEFROMSQL`, a
dataset opened on demand, `REOPEN`) needs the answer at once. With `synchronous: true`, pg runs in a
worker thread and the engine's thread waits for each query. While it waits nothing else runs on
that thread, so the database must not be served by the same process (an embedded PostgreSQL such
as PGlite has to run in a process of its own).

Status: preview (`4.1.0-alpha.N`): the API may change until 4.1.0. Node 22.12 or later.

## Examples

Eleven sample reports, with pictures of their pages, their `.rep` files and the PDFs
`@reportman/node` makes of them, are in the
[examples gallery](https://github.com/tonimartir/reportman/tree/main/typescript/examples). To see
them run: `npx @reportman/server --samples`.
Or live in your browser, with nothing installed: the [live demo](https://reportman.es/demo/).
