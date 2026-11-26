// The Report Manager web designer inside an Express application: one route, no container, no
// .NET. The designer is served from this application's own origin, so it shares its session.
//
//   npm install
//   npm start                     then open http://localhost:3000/
//
// The data folder (./reportman-data) is laid out as the one of Reportman.Server: the report
// folders of each alias in informes/, the connections in dbxconnections.ini. The first start puts
// the sample reports there (alias INFORMES, folder Ejemplos) with their SQLite database.
import express from 'express';
import { fileURLToPath } from 'node:url';
import { ServerData } from '@reportman/server';
import { createDesignerServer, nodeHandler } from '@reportman/designer-server';

const dataPath = fileURLToPath(new URL('./reportman-data', import.meta.url));
const installed = new ServerData(dataPath).installSamples();
if (installed.reports > 0) console.log(`Installed ${installed.reports} sample reports in ${dataPath}`);

const designer = createDesignerServer({
  dataPath,
  // Who may do what. Without authorize the designer answers only this machine (localhost), which
  // is enough to try it. In a real application, ask your own session, e.g.:
  //   authorize: (check, request) => request.raw.user?.canDesignReports === true,
  // (request.raw is Express's request); check is { action: 'run' | 'design', alias } or
  // { action: 'designer' } (open data, evaluate expressions, preview a report not saved).
  // The AI copilot, through this server to Reportman AI (this installation's guest credits, or
  // the account the person logs into from the chat); leave it out for a designer without AI.
  ai: true,
});

const app = express();
app.get('/', (_req, res) => {
  res.type('html').send(`<!doctype html>
<meta charset="utf-8">
<title>Report Manager designer in Express</title>
<h1>Report Manager designer in Express</h1>
<ul>
  <li><a href="/designer/?report=INFORMES/Ejemplos/customers.rep">Customers by country</a></li>
  <li><a href="/designer/?report=INFORMES/Ejemplos/invoices.rep">Invoices</a></li>
  <li><a href="/designer/?report=INFORMES/Ejemplos/sales-by-category.rep">Sales by category</a></li>
</ul>`);
});
// The designer's routes (/api/designer/*) and the element with its page (/designer/)
app.use(nodeHandler(designer));

const port = Number(process.env.PORT ?? 3000);
app.listen(port, '127.0.0.1', () => console.log(`Report Manager designer: http://localhost:${port}/`));
