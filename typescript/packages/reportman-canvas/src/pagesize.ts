import { OrientationType, PageSizeArray, TWIPS_PER_INCH, roundHalfEven, toInt32 } from '@reportman/metafile';
import type { MetaFile, PageSizeDetail } from '@reportman/metafile';

/** A size in twips. */
export interface TwipsSize {
  width: number;
  height: number;
}

/**
 * The size in twips of every page of a metafile as the PDF device gives its pages (PdfDevice.print
 * and newPage): the first page the size of the metafile; the next ones the size of the page detail
 * of the first page in the orientation of the metafile, or their own size when they have one. The
 * state the device carries from page to page is followed, so the preview of a page is the size
 * the PDF gives it.
 */
export function pdfPageSizes(meta: MetaFile): TwipsSize[] {
  // The state of a new PdfDevice after newDocument
  let orientation: OrientationType = meta.orientation;
  let width = meta.customX;
  let height = meta.customY;
  let realWidth: number;
  let realHeight: number;
  if (orientation === OrientationType.Landscape) {
    realWidth = meta.customY;
    realHeight = meta.customX;
  } else {
    realWidth = meta.customX;
    realHeight = meta.customY;
  }
  const setOrientation = (o: OrientationType): void => {
    if (o === orientation || o === OrientationType.Default) return;
    orientation = o;
    if (o === OrientationType.Portrait) {
      width = realWidth;
      height = realHeight;
    } else {
      width = realHeight;
      height = realWidth;
    }
  };
  const setPageSize = (psize: PageSizeDetail): void => {
    let w: number;
    let h: number;
    if (psize.custom) {
      w = psize.customWidth;
      h = psize.customHeight;
    } else {
      const size = PageSizeArray[psize.index];
      // The PDF device fails here; the preview keeps the size it has
      if (size === undefined) return;
      w = toInt32(roundHalfEven((size[0] / 1000) * TWIPS_PER_INCH));
      h = toInt32(roundHalfEven((size[1] / 1000) * TWIPS_PER_INCH));
    }
    realWidth = w;
    realHeight = h;
    if (orientation === OrientationType.Landscape) {
      width = h;
      height = w;
    } else {
      width = w;
      height = h;
    }
  };
  const sizes: TwipsSize[] = [];
  const count = meta.pages.currentCount;
  if (count === 0) return sizes;
  // The page the document starts with
  sizes.push({ width: meta.customX, height: meta.customY });
  setOrientation(meta.orientation);
  setPageSize(meta.pages.get(0).pageDetail);
  for (let i = 0; i < count; i++) {
    const page = meta.pages.get(i);
    if (page.updatedPageSize) {
      setOrientation(page.orientation);
      setPageSize(page.pageDetail);
    }
    if (i === 0) continue;
    // newPage: a page with its own size takes its physical size
    if (page.updatedPageSize) {
      realWidth = page.pageDetail.physicWidth;
      realHeight = page.pageDetail.physicHeight;
      if (page.orientation === OrientationType.Landscape) {
        width = page.pageDetail.physicHeight;
        height = page.pageDetail.physicWidth;
      } else {
        width = page.pageDetail.physicWidth;
        height = page.pageDetail.physicHeight;
      }
    }
    sizes.push({ width, height });
  }
  return sizes;
}

/** The size of a page in twips, as the PDF gives it. */
export function pageTwips(meta: MetaFile, pageIndex: number): TwipsSize {
  const size = pdfPageSizes(meta)[pageIndex];
  if (size === undefined) throw new RangeError('The metafile has no page ' + String(pageIndex));
  return size;
}
