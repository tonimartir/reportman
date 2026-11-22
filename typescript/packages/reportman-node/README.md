# @reportman/node

Run Report Manager `.rep` reports from Node.js to PDF, with JavaScript only: no native modules,
no WebAssembly, no external binaries. The report is laid out by `@reportman/engine`, a translation
of the C# engine, and gives the same PDF.

Status: preview (`0.1.0-alpha.N`, npm tag `next`): the API may change until 1.0. Supported
today: labels, expressions, shapes, images (JPEG, PNG, BMP, GIF), barcodes (1D, PDF417, QR),
charts, sections and groups, subreports, master/detail, parameters, the standard 14 PDF fonts
and, with the `fonts` option, embedded TrueType and OpenType fonts with HTML text, right to left
and complex scripts, and PDF/A-3B.

## Install

```bash
npm install @reportman/node@next
npm install @reportman/driver-postgres@next   # or driver-firebird, driver-mysql, driver-mssql, driver-http
```

Node 22.12 or later. The packages are ES modules only; a CommonJS program loads them with
`require('@reportman/node')` (Node's `require(esm)`).

## Fonts

```ts
const report = await openReport('letter.rep', {
  connections: { SAMPLES: sqlite('samples.db') },
  fonts: { folders: ['./fonts'] },   // the system font folders and these, scanned once
});
```

- Without `fonts` (or `fonts: false`) the PDF uses the standard 14 PDF fonts, as the C# device
  `PrintOutPDFStandard`: HTML text, right to left text and PDF/A-3 fail with a clear error.
- With `fonts` the PDF is the one of the C# FreeType device (`PrintOutPDFFreeType`): each font is
  chosen by the report's font name and style (`WFontName` on Windows, `LFontName` elsewhere, or
  `platform`), a character the font lacks takes a font that has it, every text is shaped
  (ligatures, kerning, marks, Arabic, Hebrew, Devanagari, Thai) and laid out with the Unicode
  bidirectional algorithm, and the fonts are embedded as subsets. A `FontLibrary` of
  `@reportman/text` can be given instead, for fonts that are not files on the disk.
- The fonts are read with fontkit: TrueType, OpenType CFF and collections. Type 1 fonts (`.pfb`)
  are not read, and a CFF2 (variable OpenType) font fails with a clear error.

## The two steps

```ts
import { openReport, sqlite } from '@reportman/node';

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
- `beforeRun(model)`, an option of `openReport`, adjusts the fresh copy of the report each step
  runs, as an old host did before running it: the language (`model.language = 4`) or the value
  of a hidden parameter (`CODEMP`), which `executeToPdf` does not take from the caller.
- `executeToPdf(values, { signal, onProgress })` (and `executeToMetafile`): an `AbortSignal`
  cancels the run, which then fails with the reason of the signal; `onProgress(records, pages)`
  is called at most every half second and at the end. A query already sent to the database runs
  to its end.
- A report that reads data while it prints (GETVALUEFROMSQL, a dataset opened on demand) needs a
  driver with `synchronous: true`. With an asynchronous one it fails, and
  `isSynchronousDataRequired(error)` tells it apart, so a host can run it again synchronously.

## Data

- `connections`: a factory per report connection alias. Only these are opened, whatever the
  `.rep` carries inside. `sqlite(file)` uses Node's built-in `node:sqlite` with the behaviour of
  Microsoft.Data.Sqlite, the provider of the C# engine. A factory receives the connection request
  (alias, driver, connection string, parameters) and returns `{ query(command), close(commit) }`.
  A MyBase connection (in-memory datasets: unions of other datasets of the report) opens nothing
  and needs no factory.
- `datasets`: rows for a dataset instead of running its SQL — `{ columns, rows }` or a function,
  for example the result of a REST API.

## Command line

```bash
reportman-pdf invoices.rep -o invoices.pdf --sqlite SAMPLES=samples.db -paramFIRST_ORDER=7
reportman-pdf invoices.rep --describe --sqlite SAMPLES=samples.db
```

Reports must be XML (plain or zlib compressed). A report saved by Delphi in DFM format is saved
again as XML from the Report Manager designer, or with the `reptotxt -xml` command of Report
Manager, which checks the conversion.
