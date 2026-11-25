# @reportman/designer-server

The Report Manager web designer for Node.js: the server side of the `<reportman-designer>`
element, inside your own program. `npm install` and one route in Express, Fastify or node:http —
no container, no .NET, and the designer is served from your own origin, so it shares your session.

It answers the designer protocol of Reportman.Server (open, save, preview, the expression editor,
the SQL editor's data and tables) over folders of `.rep` files, with the connections you give it.
The AI assistant is not part of it: it stays in Reportman.Server, and the designer runs with
`no-ai`.

> Status: preview (`next`). The answers are compared with the ones of Reportman.Server in the
> tests (`test/golden-http`).

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
