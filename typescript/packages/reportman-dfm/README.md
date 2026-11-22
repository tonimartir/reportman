# @reportman/dfm

The DFM to XML converter of Report Manager, in JavaScript. The Delphi designers save a report in
the DFM forms of Delphi's component streaming (text, the default; binary; either one compressed
with zlib), while the TypeScript and .NET engines read XML only. This package reads a `.rep` in any
DFM form and gives the XML the Delphi engine writes for it (`reptotxt -xml`), byte for byte, which
`@reportman/lib` and the rest of the engine then read.

It is optional: install it only to open DFM reports. `@reportman/node` (and so `@reportman/server`)
uses it on its own when it is installed; without it a DFM report is refused with a message that
says how to convert it.

Status: preview (`0.1.0-alpha.N`, npm tag `next`). Pure JavaScript; its only dependency is
`fflate`. Browser and Node.

## Use

```ts
import { dfmToXml, isDfm } from '@reportman/dfm';

const bytes = new Uint8Array(await (await fetch('/reports/invoice.rep')).arrayBuffer());
const xml = isDfm(bytes) ? dfmToXml(bytes) : bytes;     // what readReportXml of @reportman/lib reads
```

With `@reportman/node` nothing is needed: `openReport('invoice.rep')` converts a DFM report when
this package is installed (`dfm: false` refuses it instead).

The command line converts files without Delphi:

```bash
npx @reportman/dfm invoice.rep invoice.xml        # one report (to the standard output without out.xml)
npx @reportman/dfm reports/ reports-xml/          # every .rep of a folder and its subfolders
```

A report that is XML already is copied as it is; the source is never written.

| Export | |
|---|---|
| `dfmToXml(bytes)` | the XML of a DFM report (`Uint8Array`, ASCII) |
| `isDfm(bytes)` | whether a report is in a DFM form |
| `reportForm(bytes)` | `xml`, `text`, `binary`, `zlib-xml`, `zlib-text` or `zlib-binary`, as Delphi tells them |
| `readDfm(bytes)` | the tree of any DFM stream (objects, properties and their typed values) |
| `dfmTreeToXml(tree)` | the XML of a tree that `readDfm` gave |

## How it is checked

Against the Delphi engine itself, byte for byte. `test/dfm.test.ts` converts the text, binary and
zlib forms of 277 reports (the samples, the reports of the engine tests and of `repman/repsamples`),
the DFM reports of `repman/repsamples` as older versions of Delphi saved them, and hand-made DFMs
of what the corpus does not have (`test/make-dfm-cases.mjs`: references written by old versions,
repeated identifiers, parameter values of every type, clamped values, the `AllText` of old labels,
raw ANSI bytes, embedded files, a report without subreports), and compares each result with the
XML Delphi writes from the same file; also the doubles against `FloatToStr`. The fixtures come
from `tools/golden-dfm`, a console program built with the Delphi engine
(`test/generate-dfm-fixtures.mjs`), and `npm run check:dfm -- <folder>` compares the converter with
Delphi on the DFM reports of any folder (Windows with RAD Studio).

What Delphi does is kept, also when it loses information: a value at its `default` clause that the
constructor does not give back (the export size of an expression comes back as 1, the pen width of
a shape as 0), names the DFM does not keep (`TRPDATAINFOITEM1`...), a repeated identifier cleared, a
reference by a path of names (`TRpSection2.TRpLabel0`) that finds nothing and drops the component.
A property Delphi does not know is an error, as in Delphi.

The text of `WritePropertyS` goes through the ANSI code page of the computer in Delphi; the
converter uses Windows-1252 (with the best fit of Windows: `Ā` is `A`), the code page of the
computers the reports usually come from.

License: MPL-2.0.
