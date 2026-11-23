# @reportman/metafile

The metafile of Report Manager: the device-independent pages a report is laid out into, and the
layout device contract the engine measures text and draws pages through. It also writes and reads
the `.rpmf` metafile files of the Report Manager viewers byte for byte as the C# engine does
(`writeRpmf`, `readRpmf`).

[`@reportman/engine`](https://www.npmjs.com/package/@reportman/engine) lays reports out into
metafiles; [`@reportman/pdf`](https://www.npmjs.com/package/@reportman/pdf),
[`@reportman/export`](https://www.npmjs.com/package/@reportman/export) and
[`@reportman/canvas`](https://www.npmjs.com/package/@reportman/canvas) turn them into PDF, CSV, SVG,
HTML, text or a preview. To run reports, see [`@reportman/node`](https://www.npmjs.com/package/@reportman/node).

Status: preview (`4.1.0-alpha.N`): the API may change until 4.1.0. Browser and Node.

## Examples

Eleven sample reports, with pictures of their pages, their `.rep` files and the PDFs
`@reportman/node` makes of them, are in the
[examples gallery](https://github.com/tonimartir/reportman/tree/main/typescript/examples). To see
them run: `npx @reportman/server --samples`.
Or live in your browser, with nothing installed: the [live demo](https://reportman.es/demo/).

## The packages

The metafile and the packages around it are described in the
[TypeScript README](https://github.com/tonimartir/reportman/tree/main/typescript) of the repository.
