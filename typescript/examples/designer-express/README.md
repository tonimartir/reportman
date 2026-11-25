# The web designer in an Express application

The Report Manager web designer (`<reportman-designer>`) inside your own Node.js application, with
`@reportman/designer-server`: `npm install`, one route, and it runs — no container, no .NET, and the
designer comes from your application's own origin, so it shares its session.

```bash
npm install
npm start
```

Open <http://localhost:3000/> and pick a report: the designer opens it, saves it (as `.rep` XML, the
file Delphi, .NET and the npm engine read) and previews it as PDF.

What `server.mjs` does:

```js
const designer = createDesignerServer({ dataPath });   // reports and connections of a data folder
app.use(nodeHandler(designer));                         // /api/designer/* and /designer/
```

`dataPath` is a folder laid out as the one of Reportman.Server (the report folders of each alias in
`informes/`, the connections in `dbxconnections.ini`); the first start puts the sample reports there,
with their SQLite database. Your own reports and connections can come from options instead:

```js
import { sqlite } from '@reportman/node';
import { postgres } from '@reportman/driver-postgres';

const designer = createDesignerServer({
  aliases: { REPORTS: './reports' },
  connections: { MAIN: sqlite('./data.db'), ERP: postgres(process.env.DATABASE_URL) },
  authorize: (check, request) => request.raw.user?.canDesignReports === true,
});
```

## Before you deploy it

- **Without `authorize` the designer answers only this machine** (localhost). The designer opens
  data with your connections and runs the SQL its reports hold: give it to the people who design
  reports. `authorize(check, request)` gets one of `{ action: 'run', alias }` (open or run the reports
  of an alias), `{ action: 'design', alias }` (save reports in it) and `{ action: 'designer' }` (open
  data, evaluate expressions, preview a report that is not saved), and `request.raw` is Express's
  request (your session, your user).
- Mount `nodeHandler(designer)` before `express.json()`, or give that parser a bigger limit: a report
  with pictures is bigger than its default 100 kB.
- The designer has no AI assistant here: the AI stays in Reportman.Server (`no-ai`).

License: MPL-2.0.
