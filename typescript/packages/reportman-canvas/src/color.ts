import { formatFixed2 } from '@reportman/pdf';

/**
 * A component as the PDF holds it: the PDF canvas writes c / 256 with two decimals (RGBToFloats),
 * so 255 is 1.00 but 100 is 0.39, 99 on the screen; the preview shows what the PDF shows.
 */
function pdfComponent(c: number): number {
  return Math.round(Number(formatFixed2(c / 256)) * 255);
}

const cache = new Map<number, string>();

/** The CSS color of a metafile color ($00BBGGRR), as the PDF writes it. */
export function cssColor(color: number): string {
  let css = cache.get(color);
  if (css === undefined) {
    const r = pdfComponent(color & 0xff);
    const g = pdfComponent((color >> 8) & 0xff);
    const b = pdfComponent((color >> 16) & 0xff);
    css = 'rgb(' + String(r) + ',' + String(g) + ',' + String(b) + ')';
    if (cache.size < 4096) cache.set(color, css);
  }
  return css;
}
