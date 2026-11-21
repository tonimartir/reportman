// reportman-pdf: writes a metafile as a PDF with the standard 14 fonts and its images, and the
// PDF layout device the report engine measures text through.

export { PdfDevice } from './pdfdevice.js';
export type { PdfDeviceOptions } from './pdfdevice.js';
export { renderPdf } from './render.js';
export type { RenderPdfOptions } from './render.js';
export { PDFFile, systemClock, PDFA3_NOT_SUPPORTED, POINTS_PER_INCH } from './pdffile.js';
export type { PDFAnnotation, PdfClock } from './pdffile.js';
export {
  PDFCanvas,
  CONS_UNDERLINEPOS,
  CONS_STRIKEOUTPOS,
  CONS_UNDERLINEWIDTH,
} from './pdfcanvas.js';
// Images: the JPEG and BMP readers of the PDF writer and the decoders of the other formats
export { getJpegInfo, getBitmapInfo, BitmapFormatError } from './bitmaputil.js';
export type { JpegInfo, BitmapInfoResult } from './bitmaputil.js';
export { decodeImage, decodeImageForPdf, bitmapInfoOf, ImageFormatNotSupportedError } from './imagecodec.js';
export type { DecodedBitmap } from './imagecodec.js';
export { decodePng, isPngSignature, PngIncompleteError } from './pngdecoder.js';
export { decodeGif, isGifSignature } from './gifdecoder.js';
export { skiaRoundTrip } from './rgbaimage.js';
export type { RgbaImage } from './rgbaimage.js';
export { formatFixed2, intToHex, intToHexX, byteToHex2 } from './netformat.js';
export {
  splitDocDate,
  pdfDateOf,
  isoDateOf,
  pdfDateOfText,
  zoneOfOffset,
  localDigitsOf,
  netTrim,
} from './pdfdates.js';
export type { SplitDate } from './pdfdates.js';
