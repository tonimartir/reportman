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
| `reportForm(bytes)` | `xml`, `text`, `binary`, `zlib-xml` or `zlib-binary`, as Delphi tells them (an error for what Delphi does not read) |
| `readDfm(bytes)` | the tree of any DFM stream (objects, properties and their typed values), also one a report can not be |
| `dfmTreeToXml(tree)` | the XML of a tree that `readDfm` gave |

## How it is checked

Against the Delphi engine itself, byte for byte. `test/dfm.test.ts` converts the text, binary and
zlib forms of 277 reports (the samples, the reports of the engine tests and of `repman/repsamples`),
the DFM reports of `repman/repsamples` as older versions of Delphi saved them, and hand-made DFMs
of what the corpus does not have (`test/make-dfm-cases.mjs`: references written by old versions,
repeated identifiers, parameter values of every type, clamped values, the `AllText` of old labels,
raw ANSI bytes, embedded files, a report without subreports, Unicode in every kind of string, the
corners of the grammar of `TParser`), which Delphi also saves in its three forms, and compares each
result with the XML Delphi writes from the same file; the files Delphi refuses must be refused too.
Also, against Delphi: the doubles (`FloatToStr`), UTF-8 (`TEncoding.UTF8`), the round trip of the
strings of the text form (`TWriter.WriteString`) and the casing table of `AnsiUpperCase`. The
fixtures come from `tools/golden-dfm`, a console program built with the Delphi engine
(`test/generate-dfm-fixtures.mjs`), and `npm run check:dfm -- <folder>` compares the converter with
Delphi on the DFM reports of any folder (Windows with RAD Studio).

## Text as Delphi writes and reads it

What the converter reads is what Delphi writes, read as Delphi reads it (`System.Classes`):

- **The text form** keeps printable ASCII between quotes and writes every other character as a
  `#code` of its UTF-16 code unit (`'Espa'#241'a'`, an emoji as two codes), with a line break and
  `+` every 64 code units, which may split a surrogate pair. `TParser` reads a string whose codes
  are all below 128 as bytes of the ANSI code page (the raw bytes of the files of old versions)
  and one with a code above 127 as UTF-16, each raw byte of it one character. Then
  `ObjectTextToBinary` writes each string with `TWriter.WriteString`, which turns a lone surrogate
  into U+FFFD when it chooses UTF-8 (`'AB'#55296`) and keeps it otherwise (`'A'#55357`).
- **The binary form** keeps a string as `vaString` (ASCII), `vaUTF8String` or `vaWString` (UTF-16;
  the `DefineProperties` strings of Reportman always). Invalid UTF-8 is an error, as in Delphi.
- **The form of a report** is told by its first byte (`TRpBaseReport.LoadFromStream`): `o` text,
  `<` XML, `x` zlib (with XML or a binary DFM inside), anything else binary. So a text DFM with a
  UTF-8 BOM or with blanks before `object`, or one compressed with zlib, is not a report for
  Delphi, and `dfmToXml` refuses it too; `readDfm` still reads it, as `ObjectTextToBinary` would.
- **`AnsiUpperCase`** (the aliases, the data sources, the parameter names) maps each code unit
  through the casing table of Windows, which keeps `µ`, `ß`, `ı`, `ǅ` or Georgian as they are; it
  is a table taken from Delphi, not `toUpperCase`.

One difference on purpose: a line longer than the 4096 bytes of the buffer of `TParser` is read
(Delphi says "Line too long"), as the text a report saved by the Lazarus port may have.

What Delphi does is kept, also when it loses information: a value at its `default` clause that the
constructor does not give back (the export size of an expression comes back as 1, the pen width of
a shape as 0), names the DFM does not keep (`TRPDATAINFOITEM1`...), a repeated identifier cleared, a
reference by a path of names (`TRpSection2.TRpLabel0`) that finds nothing and drops the component.
A property Delphi does not know is an error, as in Delphi.

Delphi on Windows reads the raw bytes of a text DFM and the `vaString` of a binary one with the ANSI
code page of the computer, and writes the text of `WritePropertyS` with it; the converter uses
Windows-1252 for both (with the best fit of Windows when writing: `Ā` is `A`), the code page of the
computers the reports usually come from. (Delphi on Linux uses UTF-8 there.)

License: MPL-2.0.
