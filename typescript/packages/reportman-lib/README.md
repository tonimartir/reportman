# @reportman/lib

The report model of Report Manager: the document of a report (the camelCase JSON of the engine
model, shared with the web designer), its undo history, and the reader and writer of `.rep` files
saved as XML (plain or zlib compressed). A report saved by Delphi in a DFM form is converted to that XML by
[`@reportman/dfm`](https://www.npmjs.com/package/@reportman/dfm), which reports saved as XML do not
need.

It is the base of [`@reportman/engine`](https://www.npmjs.com/package/@reportman/engine); to run
reports, see [`@reportman/node`](https://www.npmjs.com/package/@reportman/node).

Status: preview (`4.1.0-alpha.N`): the API may change until 4.1.0. Browser and Node.

## Reading and writing .rep files

```ts
import { readReportXml, writeReportXml, hydrateReport, parseReportJson, updateReferences } from "@reportman/lib";

const report = readReportXml(bytes); // a .rep saved as XML, plain or zlib compressed
const xml = writeReportXml(report); // the .rep as the C# engine saves it (writeReportXmlBytes: its bytes)

// What the designer's server does with the JSON document the web designer sends:
const edited = updateReferences(hydrateReport(parseReportJson(body)));
const saved = writeReportXml(edited);
```

`writeReportXml` is a port of the C# writer (`ReportWriter`, as `ReportBatchJsonAdapter` saves a
report): the document is the same, byte for byte, as the one the C# engine writes for the same
model (tested on every XML report of the repository). As C#, saving names the items without a name
and writes the undo history (BINCUE). `writeComponentsXml` writes components as the designer copies
them (`readComponentsXml` reads them).

The designer's subreport commands, ports of the C# `ExternalReport`:
`exportSubReport(report, index)` gives the `.rep` of a report with only that subreport (with the
subreports its sections print, their datasets and the parameters of no dataset);
`importReport(target, source)` moves the parameters, connections, datasets and subreports of a
report into another one, renaming what clashes. A report read as the server reads one is
`convertToDotNet`-ed and `updateReferences`-ed after `readReportXml`.

## Examples

Eleven sample reports, with pictures of their pages, their `.rep` files and the PDFs
`@reportman/node` makes of them, are in the
[examples gallery](https://github.com/tonimartir/reportman/tree/main/typescript/examples). To see
them run: `npx @reportman/server --samples`.
Or live in your browser, with nothing installed: the [live demo](https://reportman.es/demo/).

## The packages

The model and the packages around it are described in the
[TypeScript README](https://github.com/tonimartir/reportman/tree/main/typescript) of the repository.
