// Ports of the image part of Reportman.Reporting: ImageItem (an image of a section, embedded in
// the report or given by an expression) and the background image of a Section, which share the
// way they get their stream (GetStream: the expression or the embedded image, decompressed when
// it is a zlib stream, and the cache of a shared image).

import type { ImageItem as ImageModel } from 'reportman-lib';
import { MetaObjectImage, MetaObjectType, type MetaFile, type MetaPage, type Point, type PrintOut } from 'reportman-metafile';
import { fromBase64String } from '../util/base64.js';
import { inflateZlib } from '../util/inflate.js';
import { type PartialRef, PrintPosItem, SubReportEvent } from './items.js';
import type { ReportRuntime } from './report.js';

/** How an image is shared by the objects of the metafile (SharedImageType). */
export enum SharedImageType {
  /** Every object gets its own copy of the image. */
  None,
  /** The image is stored once in the shared stream of the metafile. */
  Fixed,
  /** As Fixed, but an image given by an expression is stored again when it changes. */
  Variable,
}

/** ImageDrawStyleType values the measurement of an image item does not depend on. */
const CROP = 0;
const STRETCH = 1;
const TILE = 3;
const TILEDPI = 4;

/**
 * The stream of an image item or of a section background (GetStream of ImageItem and Section),
 * with the stream position of the image already added to the metafile when it is shared.
 *
 * C# parity: OldStreamPos starts at 0, not -1 (the C# field is not initialized; the Start of the
 * subreport sets -1); an image given by an expression is shared again only with Variable and the
 * same bytes as the last one (with Fixed the second image of an expression is always stored
 * again); a null image leaves the shared position of the last one, which the next image reuses.
 */
export class ImageStreamSource {
  private readonly fStream: Uint8Array;
  private fDecompStream: Uint8Array | null = null;
  private fOldStream: Uint8Array | null = null;
  /** The stream position of the image last added shared, -1 for none. */
  oldStreamPos = 0;

  constructor(
    private readonly report: ReportRuntime,
    streamBase64: string,
  ) {
    this.fStream = streamBase64.length > 0 ? fromBase64String(streamBase64) : new Uint8Array(0);
  }

  /** The embedded image, as stored in the report. */
  get embedded(): Uint8Array {
    return this.fStream;
  }

  /** The Start of a subreport: nothing is shared yet. */
  reset(): void {
    this.oldStreamPos = -1;
    this.fOldStream = null;
  }

  /** GetStream: the image of the expression, or the embedded one (decompressed); null for none. */
  getStream(expression: string, sharedImage: SharedImageType): Uint8Array | null {
    let aresult: Uint8Array | null = null;
    if (expression.length > 0) {
      aresult = this.report.evaluator.getStreamFromExpression(expression);
      if (aresult !== null && this.fOldStream !== null) {
        if (this.fOldStream.length === aresult.length) {
          if (sharedImage === SharedImageType.Variable) {
            for (let i = 0; i < this.fOldStream.length; i++) {
              if (this.fOldStream[i] !== aresult[i]) {
                this.oldStreamPos = -1;
                break;
              }
            }
          } else this.oldStreamPos = -1;
        } else this.oldStreamPos = -1;
      }
    } else if (this.fStream.length > 0) {
      if (this.fOldStream !== null) aresult = this.fOldStream;
      else if (this.fStream[0] === 0x78) {
        // StreamUtil.IsCompressed: a zlib stream starts with 'x'
        if (this.fDecompStream === null) this.fDecompStream = inflateZlib(this.fStream);
        aresult = this.fDecompStream;
      } else aresult = this.fStream;
    }
    this.fOldStream = aresult;
    return aresult;
  }

  /** The stream of an image object: the shared position of the last image or a new one. */
  addTo(obj: MetaObjectImage, page: MetaPage, stream: Uint8Array, sharedImage: SharedImageType): void {
    if (this.oldStreamPos >= 0) {
      obj.streamPos = this.oldStreamPos;
      obj.sharedImage = true;
    } else {
      const shared = sharedImage !== SharedImageType.None;
      obj.streamPos = page.addStream(stream, shared);
      if (shared) this.oldStreamPos = obj.streamPos;
      obj.sharedImage = shared;
    }
    obj.streamSize = stream.length;
  }
}

/** ImageItem: an image, embedded in the report or given by an expression. */
export class ImageItem extends PrintPosItem {
  /** How the image fits its rectangle (ImageDrawStyleType). */
  drawStyle: number;
  /** Resolution of the image in dots per inch. */
  dpires: number;
  copyMode: number;
  rotation: number;
  /** An expression giving the image (a binary field, a binary value or a file name). */
  expression: string;
  sharedImage: SharedImageType;
  private readonly source: ImageStreamSource;

  constructor(report: ReportRuntime, model: ImageModel) {
    super(report, model);
    this.drawStyle = model.drawStyle;
    this.dpires = model.dpires;
    this.copyMode = model.copyMode;
    this.rotation = model.rotation;
    this.expression = model.expression ?? '';
    this.sharedImage = model.sharedImage as number as SharedImageType;
    this.source = new ImageStreamSource(report, model.streamBase64 ?? '');
  }

  override subReportChanged(newstate: SubReportEvent, newgroup: string): void {
    super.subReportChanged(newstate, newgroup);
    if (newstate === SubReportEvent.Start) this.source.reset();
  }

  /** GetStream: the image to print, null when there is none. */
  getStream(): Uint8Array | null {
    return this.source.getStream(this.expression, this.sharedImage);
  }

  /** The extent: the size of the image at its resolution when it is drawn at its own size (Full). */
  override getExtension(adriver: PrintOut, maxExtent: Point, forcePartial: boolean): Point {
    let aresult = super.getExtension(adriver, maxExtent, forcePartial);
    const style = this.drawStyle;
    if (style === CROP || style === TILE || style === TILEDPI || style === STRETCH) return aresult;
    const stream = this.getStream();
    if (stream === null) return aresult;
    aresult = adriver.graphicExtent(stream, aresult, this.dpires);
    this.lastExtent = { ...aresult };
    return aresult;
  }

  protected override doPrint(
    adriver: PrintOut,
    aposx: number,
    aposy: number,
    newwidth: number,
    newheight: number,
    metafile: MetaFile,
    maxExtent: Point,
    partialPrint: PartialRef,
  ): void {
    super.doPrint(adriver, aposx, aposy, newwidth, newheight, metafile, maxExtent, partialPrint);
    const stream = this.getStream();
    if (stream === null || stream.length === 0) return;
    const metaobj = new MetaObjectImage();
    const apage = metafile.pages.get(metafile.currentPage);
    this.fillAnnotation(metaobj, apage);
    metaobj.metaType = MetaObjectType.Image;
    metaobj.top = aposy;
    metaobj.left = aposx;
    metaobj.width = this.printWidth;
    metaobj.height = this.printHeight;
    metaobj.copyMode = 20;
    metaobj.drawImageStyle = this.drawStyle;
    metaobj.dpiRes = this.dpires;
    metaobj.previewOnly = false;
    this.source.addTo(metaobj, apage, stream, this.sharedImage);
    apage.objects.push(metaobj);
  }
}

/**
 * The background image of a section (Section.DoPrint, before its items): an object of the size
 * of the section, preview only for the Preview background style. C# parity: it has no copy mode
 * and no annotation.
 */
export function printSectionBackground(
  source: ImageStreamSource,
  stream: Uint8Array,
  metafile: MetaFile,
  aposx: number,
  aposy: number,
  printWidth: number,
  printHeight: number,
  drawStyle: number,
  dpires: number,
  previewOnly: boolean,
  sharedImage: SharedImageType,
): void {
  const obj = new MetaObjectImage();
  obj.metaType = MetaObjectType.Image;
  obj.top = aposy;
  obj.left = aposx;
  obj.height = printHeight;
  obj.width = printWidth;
  obj.drawImageStyle = drawStyle;
  obj.dpiRes = dpires;
  obj.previewOnly = previewOnly;
  const page = metafile.pages.get(metafile.currentPage);
  source.addTo(obj, page, stream, sharedImage);
  page.objects.push(obj);
}
