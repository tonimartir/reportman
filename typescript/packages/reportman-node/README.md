# reportman-node

Run Report Manager `.rep` reports from Node.js to PDF, with JavaScript only: no native modules,
no WebAssembly, no external binaries. The report is laid out by `reportman-engine`, a translation
of the C# engine, and gives the same PDF.

Status: prototype, not published. Supported today: labels, expressions, shapes, sections and
groups, subreports, master/detail, parameters, the standard 14 PDF fonts. Images, barcodes,
charts, HTML text and embedded TrueType fonts fail with a clear "not supported yet" error.

## The two steps

```ts
import { openReport, sqlite } from 'reportman-node';

const report = await openReport('invoices.rep', {
  connections: { SAMPLES: sqlite('samples.db') },   // by report connection alias
  culture: 'pt-BR',
});

// Step 1: the parameters, with list options and lookups resolved (the JSON of the .NET server)
const parameters = await report.describeParameters();

// Step 2: the values the user gave → the PDF
const pdf = await report.executeToPdf({ FIRST_ORDER: 7, LAST_ORDER: 9 });
```

- A wrong value throws a `ParameterException` naming the parameter and the problem
  (`Unknown`, `NotEditable`, `Required`, `WrongType`, `NotAnOption`, `Validation`).
- A report with nothing to print throws `NoDataToPrintException`.
- `renderParametersForm(parameters)` draws a plain HTML form as a reference; a host usually draws
  its own from the same JSON.

## Data

- `connections`: a factory per report connection alias. Only these are opened, whatever the
  `.rep` carries inside. `sqlite(file)` uses Node's built-in `node:sqlite` with the behaviour of
  Microsoft.Data.Sqlite, the provider of the C# engine. A factory receives the connection request
  (alias, driver, connection string, parameters) and returns `{ query(command), close(commit) }`.
- `datasets`: rows for a dataset instead of running its SQL — `{ columns, rows }` or a function,
  for example the result of a REST API.

## Command line

```bash
reportman-pdf invoices.rep -o invoices.pdf --sqlite SAMPLES=samples.db -paramFIRST_ORDER=7
reportman-pdf invoices.rep --describe --sqlite SAMPLES=samples.db
```

Reports must be XML (plain or zlib compressed). A report saved by Delphi in DFM format is saved
again as XML from the Report Manager designer.
