// reportman-canvas: the preview of Report Manager in a browser. It paints the pages of a metafile
// on a Canvas 2D context as the PDF device of @reportman/pdf writes them, so a web page shows
// what the PDF will contain.

export { CanvasPreview, drawPage, pageSize, renderPages, CSS_PIXELS_PER_INCH } from './preview.js';
export type { CanvasPreviewOptions, DrawPageOptions, DrawPageResult, PageAnnotation, PixelSize, RenderPagesOptions } from './preview.js';
export type { CanvasContext, CanvasImage } from './context.js';
export { PreviewCanvas } from './painter.js';
export type { SkippedObject } from './painter.js';
export { browserImageLoader, prepareImage } from './images.js';
export type { ImageInput, ImageLoader, PreparedImage } from './images.js';
export { DEFAULT_FAMILIES, OutlineCache, winAnsiChar } from './fonts.js';
export type { StandardFamilies, GlyphOutline, OutlineCommand } from './fonts.js';
export { cssColor } from './color.js';
export { pdfPageSizes } from './pagesize.js';
export type { TwipsSize } from './pagesize.js';
