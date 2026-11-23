# @reportman/text

The text measurement of Report Manager: the standard 14 PDF fonts (their widths, line spacing and
the Windows-1252 encoding of their texts), TrueType and OpenType fonts through fontkit (font
choice and fallback, shaping, right to left with bidi-js, subsets), HTML text, and the line
breaking of the engine, so a text is laid out, previewed and printed in the same lines.

It is used by [`@reportman/pdf`](https://www.npmjs.com/package/@reportman/pdf) and
[`@reportman/canvas`](https://www.npmjs.com/package/@reportman/canvas); to run reports, see
[`@reportman/node`](https://www.npmjs.com/package/@reportman/node).

Status: preview (`4.1.0-alpha.N`): the API may change until 4.1.0. Browser and Node.

## Examples

Eleven sample reports, with pictures of their pages, their `.rep` files and the PDFs
`@reportman/node` makes of them, are in the
[examples gallery](https://github.com/tonimartir/reportman/tree/main/typescript/examples): the
`international` one sets the same message in nine languages and eight scripts. To see them run:
`npx @reportman/server --samples`.

## The packages

The text measurement and the packages around it are described in the
[TypeScript README](https://github.com/tonimartir/reportman/tree/main/typescript) of the repository.
