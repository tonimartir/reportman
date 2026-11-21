// Port of the runtime part of Reportman.Reporting.Section: a section measures and prints its
// items, grows and shrinks with them (AutoExpand, AutoContract), keeps the value of its group and
// the page count references of GROUPPAGECOUNT.

import type { Section as SectionModel } from '@reportman/lib';
import type { MetaFile, Point, PrintOut, TotalPage } from '@reportman/metafile';
import { messageOf } from '../util/netexception.js';
import { Variant } from '../variant/variant.js';
import { ReportException } from './errors.js';
import {
  ExpressionItem,
  type PartialRef,
  PrintItem,
  PrintItemAlign,
  type PrintPosItem,
  pt,
  SubReportEvent,
} from './items.js';
import { ImageStreamSource, printSectionBackground, type SharedImageType } from './imageitem.js';
import type { ReportRuntime } from './report.js';
import type { SubReportRuntime } from './subreport.js';

/** SectionType. */
export enum SectionType {
  PageHeader,
  GroupHeader,
  Detail,
  GroupFooter,
  PageFooter,
}

/** SkipType. */
export enum SkipType {
  Default,
  Before,
  After,
}

/** BackStyleType. */
export enum BackStyleType {
  Design,
  Preview,
  Print,
}

const INT_MAX = 2147483647;

export class SectionRuntime extends PrintItem {
  readonly model: SectionModel;
  changeExpression: string;
  changeBool: boolean;
  pageRepeat: boolean;
  skipPage: boolean;
  beginPageExpression: string;
  skipType: SkipType;
  skipToPageExpre: string;
  skipRelativeH: boolean;
  skipRelativeV: boolean;
  skipExpreH: string;
  skipExpreV: string;
  alignBottom: boolean;
  autoExpand: boolean;
  autoContract: boolean;
  horzDesp: boolean;
  vertDesp: boolean;
  /** The child subreport, printed after the section. */
  childSubReport: SubReportRuntime | null = null;
  forcePrint: boolean;
  iniNumPage: boolean;
  global: boolean;
  dpires: number;
  backStyle: BackStyleType;
  sectionType: SectionType;
  groupName: string;
  backExpression: string;
  /** The value of the group expression for the current group. */
  groupValue: Variant = Variant.null;
  private readonly fPageGroupCountList: TotalPage[] = [];
  /** The image draw style of the background (ImageDrawStyleType). */
  drawStyle: number;
  sharedImage: SharedImageType;
  /** The background image (embedded or given by the background expression). */
  private readonly background: ImageStreamSource;
  /** While processing, the first page of the group. */
  firstPage = 0;
  /** The subreport the section belongs to (null when the report does not name it, as in C#). */
  subReport: SubReportRuntime | null = null;
  readonly components: PrintPosItem[] = [];

  constructor(report: ReportRuntime, model: SectionModel) {
    super(report, model);
    this.model = model;
    this.changeExpression = model.changeExpression;
    this.changeBool = model.changeBool;
    this.pageRepeat = model.pageRepeat;
    this.skipPage = model.skipPage;
    this.beginPageExpression = model.beginPageExpression;
    this.skipType = model.skipType as number as SkipType;
    this.skipToPageExpre = model.skipToPageExpre;
    this.skipRelativeH = model.skipRelativeH;
    this.skipRelativeV = model.skipRelativeV;
    this.skipExpreH = model.skipExpreH;
    this.skipExpreV = model.skipExpreV;
    this.alignBottom = model.alignBottom;
    this.autoExpand = model.autoExpand;
    this.autoContract = model.autoContract;
    this.horzDesp = model.horzDesp;
    this.vertDesp = model.vertDesp;
    this.forcePrint = model.forcePrint;
    this.iniNumPage = model.iniNumPage;
    this.global = model.global;
    this.dpires = model.dpires;
    this.backStyle = model.backStyle as number as BackStyleType;
    this.sectionType = model.sectionType as number as SectionType;
    this.groupName = model.groupName;
    this.backExpression = model.backExpression;
    this.drawStyle = model.drawStyle;
    this.sharedImage = model.sharedImage as number as SharedImageType;
    this.background = new ImageStreamSource(report, model.streamBase64);
  }

  clearPageCountList(): void {
    this.fPageGroupCountList.length = 0;
  }

  /** UpdatePageCounts: GROUPPAGECOUNT gets the pages of the group. */
  updatePageCounts(): void {
    const meta = this.report.metaFile;
    meta.updateTotalPagesPCount(this.fPageGroupCountList, meta.pages.currentCount - this.firstPage, this.report.integerFormatter);
  }

  override subReportChanged(newstate: SubReportEvent, newgroup: string): void {
    super.subReportChanged(newstate, newgroup);
    if (newstate === SubReportEvent.Start) {
      this.firstPage = 0;
      this.background.reset();
    }
  }

  /** EvaluateBeginPage: the section must begin a page. */
  evaluateBeginPage(): boolean {
    if (this.beginPageExpression.length === 0) return false;
    const ev = this.report.evaluator;
    ev.expression = this.beginPageExpression;
    try {
      ev.evaluate();
      return ev.result.toBool(ev.context);
    } catch (e) {
      throw new ReportException(
        messageOf(e) + '\n' + this.name + ' Prop:BeginPageExpression',
        this.name,
        'BeginPageExpression',
      );
    }
  }

  private hasPartial(): boolean {
    for (const c of this.components) if (c instanceof ExpressionItem && c.isPartial) return true;
    return false;
  }

  override getExtension(adriver: PrintOut, maxExtent: Point, forcePartial: boolean): Point {
    let newextent = pt(this.width, this.height);
    const aresult = super.getExtension(adriver, maxExtent, forcePartial);
    const doPartialPrint = this.hasPartial();
    let minsize: number;
    let currentsize: number;
    if (this.autoContract) {
      minsize = 0;
      currentsize = 0;
    } else {
      minsize = aresult.y;
      currentsize = aresult.y;
    }
    // C# parity: without AutoExpand the limit is the width of the section
    const maxsize = this.autoExpand ? INT_MAX : aresult.x;
    if (!this.autoExpand && !this.autoContract) {
      aresult.y = currentsize;
      this.lastExtent = { ...aresult };
      for (const acompo of this.components) {
        if (acompo.align !== PrintItemAlign.None) acompo.getExtension(adriver, { ...newextent }, forcePartial);
      }
      return aresult;
    }
    for (const acompo of this.components) {
      if (acompo.evaluatePrintCondition()) {
        if (doPartialPrint) {
          if (acompo instanceof ExpressionItem && acompo.isPartial) {
            newextent = { ...maxExtent };
            newextent.y = newextent.y - acompo.posY;
            const compsize = acompo.getExtension(adriver, newextent, forcePartial);
            if (compsize.y > 0) {
              const newsize =
                acompo.align === PrintItemAlign.Bottom || acompo.align === PrintItemAlign.Right ? compsize.y : acompo.posY + compsize.y;
              if (newsize < maxsize && newsize > currentsize) currentsize = newsize;
            }
          }
        } else {
          newextent = { ...maxExtent };
          newextent.y = newextent.y - acompo.posY;
          const compsize = acompo.getExtension(adriver, newextent, forcePartial);
          if (compsize.y > 0) {
            const newsize =
              acompo.align === PrintItemAlign.Bottom || acompo.align === PrintItemAlign.Right ? compsize.y : acompo.posY + compsize.y;
            if (newsize < maxsize && newsize > currentsize) currentsize = newsize;
          }
        }
      }
    }
    if (currentsize < minsize) currentsize = minsize;
    aresult.y = currentsize;
    this.lastExtent = { ...aresult };
    return aresult;
  }

  /**
   * GetStream: the background image (the embedded one, decompressed, or the one the background
   * expression gives); null when there is none.
   */
  getStream(): Uint8Array | null {
    return this.background.getStream(this.backExpression, this.sharedImage);
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
    // Draw the background if needed
    if (this.backStyle !== BackStyleType.Design) {
      const astream = this.getStream();
      // C# parity: a section with a background style and no background image prints no items
      if (astream === null) return;
      if (astream.length > 0)
        printSectionBackground(this.background, astream, metafile, aposx, aposy, this.printWidth, this.printHeight, this.drawStyle,
          this.dpires, this.backStyle === BackStyleType.Preview, this.sharedImage);
    }
    const doPartialPrint = this.hasPartial();
    // C# parity: compe keeps the last expression item seen, also by the loop above
    let compe: ExpressionItem | null = null;
    for (const c of this.components) {
      if (c instanceof ExpressionItem) {
        compe = c;
        if (c.isPartial) break;
      }
    }
    partialPrint.value = false;
    for (const compo of this.components) {
      let nwidth = -1;
      let nheight = -1;
      let newposx: number;
      let newposy: number;
      switch (compo.align) {
        case PrintItemAlign.Bottom:
          newposx = aposx + compo.posX;
          newposy = aposy + this.lastExtent.y - compo.lastExtent.y;
          break;
        case PrintItemAlign.Right:
          newposx = aposx + this.lastExtent.x - compo.lastExtent.x;
          newposy = aposy + compo.posY;
          break;
        case PrintItemAlign.BottomRight:
          newposx = aposx + compo.posX;
          newposy = aposy + this.lastExtent.y - compo.lastExtent.y;
          break;
        case PrintItemAlign.LeftRight:
          newposx = aposx;
          newposy = aposy + compo.posY;
          nwidth = this.lastExtent.x;
          break;
        case PrintItemAlign.TopBottom:
          newposx = aposx + compo.posX;
          newposy = aposy + compo.posY;
          nheight = this.lastExtent.y;
          break;
        case PrintItemAlign.AllClient:
          newposx = aposx;
          newposy = aposy;
          nwidth = this.lastExtent.x;
          nheight = this.lastExtent.y;
          break;
        default:
          newposx = aposx + compo.posX;
          newposy = aposy + compo.posY;
          break;
      }
      const componentExtent = { ...maxExtent };
      componentExtent.y = componentExtent.y - compo.posY;
      if (doPartialPrint) {
        let compoprinted = false;
        if (compo instanceof ExpressionItem) {
          compe = compo;
          if (compe.isPartial) {
            const intPartialPrint: PartialRef = { value: false };
            compo.print(adriver, newposx, newposy, nwidth, nheight, metafile, componentExtent, intPartialPrint);
            if (intPartialPrint.value) partialPrint.value = true;
            compoprinted = true;
          }
        }
        if (!compoprinted && compo.partialFlag && !partialPrint.value) {
          const intPartialPrint: PartialRef = { value: false };
          compo.partialFlag = false;
          compo.print(adriver, newposx, newposy, nwidth, nheight, metafile, componentExtent, intPartialPrint);
        }
        if (compe === null && (compo.align === PrintItemAlign.TopBottom || compo.align === PrintItemAlign.AllClient)) {
          const dummypartial: PartialRef = { value: false };
          compo.print(adriver, newposx, newposy, nwidth, nheight, metafile, componentExtent, dummypartial);
        }
      } else {
        compo.partialFlag = false;
        // Evaluates print condition of each comonent
        if (compo.evaluatePrintCondition()) {
          const intPartialPrint: PartialRef = { value: false };
          // For aligned to bottom elements, the partial print will force to align bottom at the
          // last section of the partial print
          if (partialPrint.value && (compo.align === PrintItemAlign.Bottom || compo.align === PrintItemAlign.BottomRight))
            compo.partialFlag = true;
          else compo.print(adriver, newposx, newposy, nwidth, nheight, metafile, componentExtent, intPartialPrint);
          if (intPartialPrint.value) partialPrint.value = true;
          if (compo instanceof ExpressionItem) {
            compe = compo;
            if (compe.isGroupPageCount && compe.lastMetaIndex > 0)
              this.addPageGroupCountItem(metafile.currentPage, compe.lastMetaIndex, compe.displayFormat);
          }
        }
      }
    }
  }

  private addPageGroupCountItem(apageindex: number, aobjectindex: number, adisplayformat: string): void {
    const subrep = this.subReport;
    if (subrep === null) throw new Error('Object reference not set to an instance of an object.');
    const index = subrep.groupIndex(this.groupName);
    if (index > 0) {
      subrep.sections[subrep.firstDetail - index]!.fPageGroupCountList.push({
        pageIndex: apageindex,
        objectIndex: aobjectindex,
        displayFormat: adisplayformat,
      });
    }
  }
}
