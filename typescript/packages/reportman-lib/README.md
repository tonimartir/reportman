# @reportman/lib

The report model of Report Manager: the document of a report (the camelCase JSON of the engine
model, shared with the web designer), its undo history, and the reader of `.rep` files saved as
XML (plain or zlib compressed). A report saved by Delphi in a DFM form is converted to that XML by
[`@reportman/dfm`](https://www.npmjs.com/package/@reportman/dfm), which reports saved as XML do not
need.

It is the base of [`@reportman/engine`](https://www.npmjs.com/package/@reportman/engine); to run
reports, see [`@reportman/node`](https://www.npmjs.com/package/@reportman/node).

Status: preview (`4.1.0-alpha.N`): the API may change until 4.1.0. Browser and Node.

## Examples

Eleven sample reports, with pictures of their pages, their `.rep` files and the PDFs
`@reportman/node` makes of them, are in the
[examples gallery](https://github.com/tonimartir/reportman/tree/main/typescript/examples). To see
them run: `npx @reportman/server --samples`.

## The packages

The model and the packages around it are described in the
[TypeScript README](https://github.com/tonimartir/reportman/tree/main/typescript) of the repository.
