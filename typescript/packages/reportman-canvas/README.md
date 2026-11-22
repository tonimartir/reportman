# @reportman/canvas

The browser preview of Report Manager: it paints the pages of a metafile on a Canvas 2D context, so
a web page shows what the PDF of `@reportman/pdf` will contain. The metafile is what
`@reportman/engine` lays a report out into (`executeToMetafile` of `@reportman/node`, or a `.rpmf`
file read with `readRpmf` of `@reportman/metafile`).

Each object is drawn the way the PDF device draws it (`PdfDevice.drawObject` and `PDFCanvas`): the
preview extends the same `TextCanvas` of `@reportman/text`, so a text is measured and broken in
lines exactly as in the PDF, and the shapes, line widths, dashes, image styles and their C# quirks
follow the PDF code line by line.

Status: preview (`4.1.0-alpha.N`, npm tag `next`). Browser (or a worker with an
`OffscreenCanvas`); the drawing code works on an interface, so it also runs in Node with any object
that has the methods of a 2D context.

## Use

```ts
import { readRpmf } from '@reportman/metafile';
import { renderPages } from '@reportman/canvas';

const meta = readRpmf(new Uint8Array(await (await fetch('/report.rpmf')).arrayBuffer()));
// One canvas per page in the container, at its size on the screen (scale 1 = 96 pixels per inch),
// sharp on the screen (devicePixelRatio)
await renderPages(document.getElementById('preview')!, meta, { scale: 1.25 });
```

One page on a context of your own:

```ts
import { CanvasPreview } from '@reportman/canvas';

const preview = new CanvasPreview();             // keeps the decoded images and glyphs
const size = preview.pageSize(meta, 0, 2);       // pixels at scale 2
canvas.width = size.width;
canvas.height = size.height;
const result = await preview.drawPage(canvas.getContext('2d')!, meta, 0, { scale: 2 });
result.skipped;      // what was left out, and why (nothing is thrown in the middle of a page)
result.annotations;  // the links and notes of the PDF, in pixels, to put over the canvas
```

A report laid out with the TrueType fonts (the `fonts` option of `@reportman/node`) is previewed with
the same font files, which the page fetches:

```ts
import { FontLibrary, memoryFontFile } from '@reportman/text';

const files = await Promise.all(['fonts/arial.ttf', 'fonts/arialbd.ttf'].map(async (path) =>
  memoryFontFile(path, new Uint8Array(await (await fetch(path)).arrayBuffer()))));
const preview = new CanvasPreview({ fonts: new FontLibrary(files) });
```

The library must hold the files the PDF device chose from, in the same order, so both choose the
same face for each text.

## API

| | |
|---|---|
| `new CanvasPreview({ fonts?, loadImage?, families? })` | A preview: the font library, the image loader (`browserImageLoader`), the browser families of Helvetica, Times and Courier. It keeps what it decodes per metafile. |
| `preview.pageSize(meta, pageIndex, scale = 1)` | The size of a page in pixels: the size the PDF gives the page (`pdfPageSizes`), at 96 × `scale` pixels per inch, rounded up. |
| `preview.drawPage(ctx, meta, pageIndex, options)` | Decodes the images of the page, then draws it. |
| `preview.loadImages(meta, pageIndex)` / `preview.paintPage(...)` | The two halves of `drawPage`: decoding (asynchronous) and drawing (synchronous). |
| `drawPage(ctx, meta, pageIndex, options)` | `drawPage` of a new preview. |
| `pageSize(meta, pageIndex, scale)` | `pageSize` without a preview. |
| `renderPages(container, meta, options)` | A canvas per page appended to an element (`pages`, `pixelRatio`, `className`, `onPage`). |

Options of a page: `scale` (pixels of the context per CSS pixel, 1 by default), `background` (the
color of the paper, white; `null` leaves the context as it is), `minLineWidth` (the narrowest line
in pixels, 1), `snapToPixels` (true). The page is drawn at the origin of the transform the context
has, clipped to the page, and the context is left as it was.

`CanvasContext` is the part of a 2D context the preview uses; a `CanvasRenderingContext2D` or an
`OffscreenCanvasRenderingContext2D` is one. `ImageLoader` turns an image into something the context
draws (an `ImageBitmap` in the browser).

## What it draws

- **Texts**: font, size, bold, italic, color, background of each line, underline or strikeout,
  alignment (left, right, center, justified word by word, top, center, bottom), word wrap, single
  line, clipping (cut text) and rotation around the top left corner, as the PDF canvas lays them out.
  - With the **standard 14 fonts** the text is measured with the width tables of the PDF, written in
    Windows-1252 as the PDF writes it, and drawn character by character at the position the widths
    give each character, with the browser family that has those widths: Arial for Helvetica, Times
    New Roman for Times, Courier New for Courier (then Helvetica, Liberation and Nimbus families).
    The line breaks and positions are the PDF's; the glyphs are those of the browser's font, as a
    PDF viewer draws a font the PDF does not embed with a font of its own.
  - With a **font library** every text is shaped by the TrueType provider as in the PDF, and each
    glyph is drawn with its outline, read with fontkit from the same font bytes the PDF embeds, at
    the position the shaper gives it: the glyphs are the PDF's, ligatures, contextual forms, right to
    left, complex scripts, fallback faces, collections and variable font instances included. Glyph
    outlines and not `FontFace` + `fillText`, because a canvas cannot draw a glyph by its number:
    `fillText` would shape the text again with the browser and lose the glyphs the PDF chose.
- **Shapes**: rectangles, squares, rounded rectangles and squares, ellipses, circles, horizontal,
  vertical and oblique lines; pen width (0 is 1 twip), pen styles (dash, dot, dash dot, dash dot
  dot, clear: the dash lengths of the PDF), solid or clear brush (the PDF fills the hatched brushes
  solid, and so does the preview). Barcodes are laid out by the engine as rectangles and drawn as
  such.
- **Images**: crop, stretch, full (at its resolution, centered), tile and tile dpi, with the C#
  quirks the PDF keeps (a tile is drawn at 72 dpi, and its clipping takes the width and height as the
  right and bottom and is never undone, so it clips the rest of the page). A JPEG is decoded by the
  browser without its Exif segment (the PDF embeds it as it is and viewers ignore its orientation);
  PNG and GIF are decoded as the PDF writer decodes them, and a bitmap is drawn with the pixels the
  PDF embeds: its palette, the color key mask C# writes for the palette entries with a fourth byte of
  0 (as readers take that array: its first pair), the fourth byte of 32 bits as alpha. Shared images
  are decoded once.
- **The page**: the size the PDF gives each page (the first one the size of the metafile, the next
  ones the page size of the first page detail or their own), white paper, nothing outside it.

As PDF viewers do, the preview draws the hairlines of a report one pixel wide (`minLineWidth`), puts
the horizontal and vertical lines and rectangles and the baselines of the texts on the pixels of the
device (`snapToPixels`: rules and barcode bars are sharp) and does not smooth an image enlarged four
times or more. Colors are those the PDF writes (each component as c / 256 with two decimals).

## Not drawn yet

What is not supported draws nothing and is listed in `result.skipped`; the rest of the page is drawn.

- The glyphs of the **Symbol** and **ZapfDingbats** standard fonts (the browser has no font with
  their encoding); their backgrounds and lines are drawn.
- **Type 1 fonts** of a font library (fontkit reads TrueType and CFF outlines); a color font
  (COLR, sbix) is drawn with the monochrome outlines the PDF embeds.
- What the PDF device cannot write either: right to left and HTML texts without a font library, a
  PDF/A-3 metafile without one, images in formats the PDF writer does not decode (WebP, ICO, WBMP)
  or that BitmapUtil rejects.
- The **annotations** (links and notes) are not page content: `result.annotations` gives them for
  the viewer to put over the canvas.
- Polygons, export texts and native barcode objects: the PDF device does not draw them either.
- A JPEG in CMYK: the PDF declares every JPEG DeviceRGB (as C# does), the browser decodes it right.

## Tests

`test/canvas.test.ts` (vitest, Node) draws metafiles built by hand and `samples/customers.rep` (run
with SQLite and read back from its `.rpmf`) on a recording context, and compares each text, glyph,
rectangle, line and image with what the PDF of the same metafile writes in its content stream.

`npm run check:canvas` (`tools/check-canvas.mjs`, not part of `npm run ci`: it needs a Chromium
browser and poppler, in WSL on Windows) draws 28 pages of the samples and of the image reports in a
headless Edge or Chrome at 100 dpi and compares their pixels with the raster of the PDF
(`pdftoppm -r 100 -gray`), with a tolerance of one pixel: at most 4.8 % of the ink of a page and
16 % of a 160 px square differ with the standard fonts (the hinting of the browser and the
baselines poppler puts a row higher), 0.03 % with a font library. It saves the side by side
pictures of every page in a temporary folder.
