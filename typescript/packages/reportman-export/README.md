# @reportman/export

The outputs of a Report Manager metafile besides the PDF, with JavaScript only: CSV, SVG and HTML.
The metafile is what `@reportman/engine` lays a report out into (`executeToMetafile` of
`@reportman/node`); these functions turn its pages into text, as the engines of Report Manager do:

| Function | Port of | Output |
|---|---|---|
| `metafileToCsv` | `PrintOutCSV` of the C# engine | one CSV text, every page |
| `metafileToSvg` | `ExportMetafileToSVG` of the Delphi engine (`rpsvgdriver.pas`) | one SVG document per page, and its image files |
| `metafileToHtml` | `ExportMetafileToHtml` of the Delphi engine (`rphtmldriver.pas`) | one HTML document per page, and its image files |
| `metafileToHtmlSingle` | `ExportMetafileToHtmlSingle` of the Delphi engine | one HTML document with every page, images inline |

The C# engine has no SVG or HTML output: those two are ports of the Delphi drivers, and give the
documents Delphi writes from the same metafile, byte for byte (`test/svg-html.test.ts` checks them
against the Delphi engine itself, `tools/golden-delphi`).

Status: preview (`0.1.0-alpha.N`, npm tag `next`). Browser and Node: the package does no I/O, it
returns the documents and the files, and the host writes them.

## CSV

```ts
import { openReport, sqlite } from '@reportman/node';
import { metafileToCsv } from '@reportman/export';

const report = await openReport('customers.rep', { connections: { SAMPLES: sqlite('samples.db') } });
const meta = await report.executeToMetafile();
const csv = metafileToCsv(meta, { separator: ';' });
```

Each distinct left of the objects (divided by `precision`, 10 twips by default) is a column of
every page, each distinct top of a text a row of its page; a page ends with an empty line. Options:
`fromPage`, `toPage` (1-based), `separator` (`,`), `delimiter` (`"`, doubled inside a value),
`precision`, `newLine` (`\r\n`).

## SVG

```ts
import { writeFileSync } from 'node:fs';
import { metafileToSvg, windows1252Bytes } from '@reportman/export';

const { pages, files } = metafileToSvg(meta, { caption: 'Customers', fileName: 'customers.svg' });
for (const page of pages) writeFileSync(page.fileName, windows1252Bytes(page.text)); // customers0.svg, customers1.svg...
for (const [name, bytes] of files) writeFileSync(name, bytes);                      // customerspage0obj3.jpg...
```

What the Delphi driver writes: the page size of the metafile and its background color, each text
as a `<text>` at its top left corner with its color, its Linux font name and its size (no
wrapping, alignment, style or rotation), and each image as an `<image>` that refers to a file; the
shapes are not drawn. The text goes in as it is, without XML escaping.

## HTML

```ts
import { metafileToHtml, metafileToHtmlSingle, windows1252Bytes } from '@reportman/export';

const { pages, files } = metafileToHtml(meta, { caption: 'Customers', fileName: 'customers.html' });
const single = metafileToHtmlSingle(meta, { caption: 'Customers' });
writeFileSync('customers.html', windows1252Bytes(single));
```

Each object is an absolutely positioned `DIV`, its font a CSS class: texts (HTML escaped, line
breaks as `<br/>`, `<NOBR>` for a single line text), rectangles and horizontal and vertical lines
as borders and backgrounds, images as `IMG` or, tiled, as the background of the `DIV`. Squares,
ellipses, rounded and oblique shapes give an empty `DIV`. `metafileToHtmlSingle` puts the pages one
under the other and the images inline (`data:` URIs).

## Options and results

- `fromPage`, `toPage` (SVG and HTML): the pages, 1-based and inclusive; all of them by default.
- `caption`: the `<desc>` of each SVG page, the `<TITLE>` of the HTML.
- `fileName` (`report.svg`, `report.html`): the name Delphi is given. A page is named after it with
  its index (0 based) before the extension, an image with `page<P>obj<O>` and `.jpg`, `.bmp` or no
  extension (PNG, GIF). The documents refer to the images by that name, a folder in it included.
- `pages`: `{ index, fileName, text }` for each page; `files`: a `Map` of the image files by name.
- `windows1252Bytes(text)`: the bytes Delphi writes, its `AnsiString` on a Windows-1252 system
  (`Ā` is `A`, what has no equivalent is `?`). The SVG declares `ISO-8859-1`, the HTML no charset.

## Where the Delphi behaviour is kept

The port writes what Delphi writes, its oddities too (the code says so where they are):

- A true color BMP in SVG gives the text `Bad bitmap stream` instead of the image (GetBitmapInfo
  reads the pixels from the stream it has just emptied); for an indexed BMP Delphi saves
  uninitialized memory as the file, the port the image itself.
- An image that can not be read stops the HTML export with a `DelphiImageError` (the SVG writes its
  message); a full size PNG or GIF is 0 by 0 in HTML (Delphi does not read their size).
- In the single HTML a class is named after the index of its first object in its page, so a style
  first used on a later page can reuse the name of a class of an earlier page.
- An underlined text gets `TEXT-DECORATION:UNDERLINE;` and then `NONE` (or `LINE-THROUGHT`).

License: MPL-2.0.
