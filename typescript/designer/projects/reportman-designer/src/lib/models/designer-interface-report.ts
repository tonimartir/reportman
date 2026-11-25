import { ReportItem, Report, PageUtils } from "@reportman/lib";
import { IObjectInspector } from "../interfaces/object-inspector.interface";
import { TranslationService } from "../services/translator.service";
import { DesignerInterface } from "./designer-interface";
import { DesignUtils } from "./design-utils";
import { MeasureUnitType } from "./report-design-preferences";
export class DesignerInterfaceReport extends DesignerInterface {
  private FReport?: Report;

  constructor(
    nreport: Report,
    nrepitem: Map<number, ReportItem>,
    nobjinsp: IObjectInspector,
    ntranslator: TranslationService
  ) {
    super(nreport, nrepitem, nobjinsp, ntranslator);
    if (nrepitem.size === 1) {
      this.FReport = nrepitem.values().next().value as Report;
    }
  }

  public override SetItem(nitem: ReportItem) {
    super.SetItem(nitem);
    this.FReport = nitem as Report;
  }

  public override GetProperties(
    lnames: string[],
    llabels: string[],
    ltypes: string[],
    lvalues: any[],
    lhints: string[],
    lcat: string[],
    lorder?: (number | null)[] | null
  ): void {
    if (!this.FReport) {
      throw new Error("Report not assigned");
    }
    super.GetProperties(lnames, llabels, ltypes, lvalues, lhints, lcat, lorder);
    lnames.push("pageOrientation");
    llabels.push(this.translator.TranslateStr(98));
    ltypes.push(this.translator.TranslateStr(569));
    lhints.push("refreport.html");
    lcat.push(this.translator.TranslateStr(98));
    lvalues?.push(this.report.pageOrientation);

    lnames.push("pageSize");
    llabels.push(this.translator.TranslateStr(97));
    ltypes.push(this.translator.TranslateStr(569));
    lhints.push("refreport.html");
    lcat.push(this.translator.TranslateStr(98));
    lvalues?.push(this.report.pageSize);

    lnames.push("pageSizeIndex");
    llabels.push(this.translator.TranslateStr(104));
    ltypes.push(this.translator.TranslateStr(569));
    lhints.push("refreport.html");
    lcat.push(this.translator.TranslateStr(98));
    lvalues?.push(this.report.pageSizeIndex);

    lnames.push("customPageWidth");
    llabels.push(this.translator.TranslateStr(554));
    ltypes.push("TWIPS");
    lhints.push("refreport.html");
    lcat.push(this.translator.TranslateStr(1201));
    lvalues?.push(this.report.customPageWidth);

    lnames.push("customPageHeight");
    llabels.push(this.translator.TranslateStr(555));
    ltypes.push("TWIPS");
    lhints.push("refreport.html");
    lcat.push(this.translator.TranslateStr(1201));
    lvalues?.push(this.report.customPageHeight);

    lnames.push("forcePaperName");
    llabels.push(this.translator.TranslateStr(570));
    ltypes.push(this.translator.TranslateStr(555));
    lhints.push("refreport.html");
    lcat.push(this.translator.TranslateStr(1201));
    lvalues?.push(this.report.forcePaperName);

    lnames.push("");
    llabels.push(this.translator.TranslateStr(99));
    ltypes.push("");
    lhints.push("");
    lcat.push(this.translator.TranslateStr(1201));
    lvalues?.push(undefined);

    lnames.push("leftMargin");
    llabels.push(this.translator.TranslateStr(100));
    ltypes.push("TWIPS");
    lhints.push("refreport.html");
    lcat.push(this.translator.TranslateStr(1201));
    lvalues?.push(this.report.leftMargin);

    lnames.push("topMargin");
    llabels.push(this.translator.TranslateStr(102));
    ltypes.push("TWIPS");
    lhints.push("refreport.html");
    lcat.push(this.translator.TranslateStr(1201));
    lvalues?.push(this.report.topMargin);

    lnames.push("rightMargin");
    llabels.push(this.translator.TranslateStr(101));
    ltypes.push("TWIPS");
    lhints.push("refreport.html");
    lcat.push(this.translator.TranslateStr(1201));
    lvalues?.push(this.report.rightMargin);

    lnames.push("bottomMargin");
    llabels.push(this.translator.TranslateStr(103));
    ltypes.push("TWIPS");
    lhints.push("refreport.html");
    lcat.push(this.translator.TranslateStr(1201));
    lvalues?.push(this.report.bottomMargin);

    // Print setup
    lnames.push("");
    llabels.push(this.translator.TranslateStr(858));
    ltypes.push("");
    lhints.push("");
    lcat.push(this.translator.TranslateStr(1201));
    lvalues?.push(undefined);

    lnames.push("language");
    llabels.push(this.translator.TranslateStr(112));
    ltypes.push(this.translator.TranslateStr(569));
    lhints.push("refreport.html");
    lcat.push(this.translator.TranslateStr(1201));
    lvalues?.push((this.report.language ?? 0) + 1);

    lnames.push("previewWindow");
    llabels.push(this.translator.TranslateStr(840));
    ltypes.push(this.translator.TranslateStr(569));
    lhints.push("refreport.html");
    lcat.push(this.translator.TranslateStr(1201));
    lvalues?.push(this.report.previewWindow);

    lnames.push("autoScale");
    llabels.push(this.translator.TranslateStr(840));
    ltypes.push(this.translator.TranslateStr(569));
    lhints.push("refreport.html");
    lcat.push(this.translator.TranslateStr(1201));
    lvalues?.push(this.report.autoScale);

    lnames.push("printerSelect");
    llabels.push(this.translator.TranslateStr(741));
    ltypes.push(this.translator.TranslateStr(569));
    lhints.push("refreport.html");
    lcat.push(this.translator.TranslateStr(1201));
    lvalues?.push(this.report.printerSelect);

    lnames.push("paperSource");
    llabels.push(this.translator.TranslateStr(1286));
    ltypes.push(this.translator.TranslateStr(569));
    lhints.push("refreport.html");
    lcat.push(this.translator.TranslateStr(1201));
    lvalues?.push(this.report.paperSource);

    lnames.push("duplex");
    llabels.push(this.translator.TranslateStr(1300));
    ltypes.push(this.translator.TranslateStr(569));
    lhints.push("refreport.html");
    lcat.push(this.translator.TranslateStr(1201));
    lvalues?.push(this.report.duplex);

    lnames.push("printerFonts");
    llabels.push(this.translator.TranslateStr(113));
    ltypes.push(this.translator.TranslateStr(569));
    lhints.push("refreport.html");
    lcat.push(this.translator.TranslateStr(1201));
    lvalues?.push(this.report.printerFonts);

    lnames.push("linesPerInch");
    llabels.push(this.translator.TranslateStr(1377));
    ltypes.push(this.translator.TranslateStr(569));
    lhints.push("refreport.html");
    lcat.push(this.translator.TranslateStr(1201));
    lvalues?.push(this.report.linesPerInch);

    lnames.push("twoPass");
    llabels.push(this.translator.TranslateStr(111));
    ltypes.push(this.translator.TranslateStr(568));
    lhints.push("refreport.html");
    lcat.push(this.translator.TranslateStr(1201));
    lvalues?.push(this.report.twoPass);

    lnames.push("printOnlyIfDataAvailable");
    llabels.push(this.translator.TranslateStr(800));
    ltypes.push(this.translator.TranslateStr(568));
    lhints.push("refreport.html");
    lcat.push(this.translator.TranslateStr(1201));
    lvalues?.push(this.report.printOnlyIfDataAvailable);

    // Options
    lnames.push("");
    llabels.push(this.translator.TranslateStr(974));
    ltypes.push("");
    lhints.push("");
    lcat.push(this.translator.TranslateStr(1201));
    lvalues?.push(undefined);

    lnames.push("streamFormat");
    llabels.push(this.translator.TranslateStr(970));
    ltypes.push(this.translator.TranslateStr(569));
    lhints.push("refreport.html");
    lcat.push(this.translator.TranslateStr(1201));
    lvalues?.push(this.report.streamFormat);

    lnames.push("pdfConformance");
    llabels.push(this.translator.TranslateStr(1458));
    ltypes.push(this.translator.TranslateStr(569));
    lhints.push("refreport.html");
    lcat.push(this.translator.TranslateStr(1201));
    lvalues?.push(this.report.pdfConformance);

    lnames.push("pdfCompressed");
    llabels.push(this.translator.TranslateStr(1459));
    ltypes.push(this.translator.TranslateStr(568));
    lhints.push("refreport.html");
    lcat.push(this.translator.TranslateStr(1201));
    lvalues?.push(this.report.pdfCompressed);

    // Metadata
    lnames.push("");
    llabels.push(this.translator.TranslateStr(1474));
    ltypes.push("");
    lhints.push("");
    lcat.push(this.translator.TranslateStr(1201));
    lvalues?.push(undefined);

    lnames.push("docAuthor");
    llabels.push(this.translator.TranslateStr(1466));
    ltypes.push(this.translator.TranslateStr(555));
    lhints.push("refreport.html");
    lcat.push(this.translator.TranslateStr(1201));
    lvalues?.push(this.report.docAuthor);

    lnames.push("docCreator");
    llabels.push(this.translator.TranslateStr(1473));
    ltypes.push(this.translator.TranslateStr(555));
    lhints.push("refreport.html");
    lcat.push(this.translator.TranslateStr(1201));
    lvalues?.push(this.report.docCreator);

    lnames.push("docProducer");
    llabels.push(this.translator.TranslateStr(1472));
    ltypes.push(this.translator.TranslateStr(555));
    lhints.push("refreport.html");
    lcat.push(this.translator.TranslateStr(1201));
    lvalues?.push(this.report.docProducer);

    lnames.push("docTitle");
    llabels.push(this.translator.TranslateStr(1467));
    ltypes.push(this.translator.TranslateStr(555));
    lhints.push("refreport.html");
    lcat.push(this.translator.TranslateStr(1201));
    lvalues?.push(this.report.docTitle);

    lnames.push("docSubject");
    llabels.push(this.translator.TranslateStr(1468));
    ltypes.push(this.translator.TranslateStr(555));
    lhints.push("refreport.html");
    lcat.push(this.translator.TranslateStr(1201));
    lvalues?.push(this.report.docSubject);

    lnames.push("docCreationDate");
    llabels.push(this.translator.TranslateStr(1469));
    ltypes.push(this.translator.TranslateStr(555));
    lhints.push("refreport.html");
    lcat.push(this.translator.TranslateStr(1201));
    lvalues?.push(this.report.docCreationDate);

    lnames.push("docModificationDate");
    llabels.push(this.translator.TranslateStr(1470));
    ltypes.push(this.translator.TranslateStr(555));
    lhints.push("refreport.html");
    lcat.push(this.translator.TranslateStr(1201));
    lvalues?.push(this.report.docModificationDate);

    lnames.push("docKeywords");
    llabels.push(this.translator.TranslateStr(1471));
    ltypes.push(this.translator.TranslateStr(555));
    lhints.push("refreport.html");
    lcat.push(this.translator.TranslateStr(1201));
    lvalues?.push(this.report.docKeywords);

    lnames.push("docXMPContent");
    llabels.push(this.translator.TranslateStr(1479));
    ltypes.push(this.translator.TranslateStr(555));
    lhints.push("refreport.html");
    lcat.push(this.translator.TranslateStr(1201));
    lvalues?.push(this.report.docXMPContent);
  }

  public override GetPropertyValues(pname: string, lpossiblevalues: string[]): void {
    switch (pname) {
      case "pageOrientation":
        lpossiblevalues.push(this.translator.TranslateStr(95));
        lpossiblevalues.push(this.translator.TranslateStr(106));
        lpossiblevalues.push(this.translator.TranslateStr(107));
        return;
      case "pageSize":
        lpossiblevalues.push(this.translator.TranslateStr(95));
        lpossiblevalues.push(this.translator.TranslateStr(96));
        lpossiblevalues.push(this.translator.TranslateStr(732));
        return;
      case "previewWindow":
        lpossiblevalues.push(this.translator.TranslateStr(841));
        lpossiblevalues.push(this.translator.TranslateStr(842));
        return;
      case "autoScale":
        lpossiblevalues.push(this.translator.TranslateStr(843));
        lpossiblevalues.push(this.translator.TranslateStr(844));
        lpossiblevalues.push(this.translator.TranslateStr(845));
        return;
      case "pdfConformance":
        lpossiblevalues.push("PDF 1.4");
        lpossiblevalues.push("PDF A/3");
        return;
      case "streamFormat":
        lpossiblevalues.push(this.translator.TranslateStr(971));
        lpossiblevalues.push(this.translator.TranslateStr(973));
        lpossiblevalues.push(this.translator.TranslateStr(972));
        lpossiblevalues.push("XML");
        lpossiblevalues.push(this.translator.TranslateStr(1350));
        return;
      case "printerFonts":
        lpossiblevalues.push(this.translator.TranslateStr(95));
        lpossiblevalues.push(this.translator.TranslateStr(114));
        lpossiblevalues.push(this.translator.TranslateStr(115));
        lpossiblevalues.push(this.translator.TranslateStr(1433));
        return;
      case "duplex":
        lpossiblevalues.push(this.translator.TranslateStr(95));
        lpossiblevalues.push(this.translator.TranslateStr(1301));
        lpossiblevalues.push(this.translator.TranslateStr(1303));
        lpossiblevalues.push(this.translator.TranslateStr(1302));
        return;
      case "paperSource":
        lpossiblevalues.push(...PageUtils.getPaperSources());
        return;
      case "printerSelect":
        lpossiblevalues.push(...PageUtils.getPrinterNames());
        return;
      case "language":
        lpossiblevalues.push(this.translator.TranslateStr(95));
        lpossiblevalues.push(...PageUtils.GetLanguageDescriptions());
        return;
      case "linesPerInch":
        lpossiblevalues.push("6");
        lpossiblevalues.push("8");
        return;
      case "pageSizeIndex":
        for (let i = 0; i < PageUtils.MaxIndex; i++) {
          const widthTwips = (PageUtils.PageSizeArray[i][0] * DesignUtils.TwipsPerInch) / 1000;
          const heightTwips = (PageUtils.PageSizeArray[i][1] * DesignUtils.TwipsPerInch) / 1000;
          const widthCms = DesignUtils.twipsToUnit(widthTwips, MeasureUnitType.Cm);
          const heightCms = DesignUtils.twipsToUnit(heightTwips, MeasureUnitType.Cm);
          const newValue =
            PageUtils.pageSizeName(i) +
            " (" +
            widthCms.toFixed(3) +
            " x " +
            heightCms.toFixed(3) +
            ")";
          lpossiblevalues.push(newValue);
        }
        return;
    }
    super.GetPropertyValues(pname, lpossiblevalues);
  }

  public override SetProperty(pname: string, newvalue: any): void {
    if (!this.FReport) {
      throw new Error("Report not assigned");
    }
    switch (pname) {
      case "pageOrientation":
        this.FReport.pageOrientation = newvalue;
        return;
      case "pageSize":
        this.FReport.pageSize = newvalue;
        return;
      case "papersource":
        this.FReport.paperSource = newvalue;
        return;
      case "leftMargin":
        this.FReport.leftMargin = newvalue;
        return;
      case "rightMargin":
        this.FReport.rightMargin = newvalue;
        return;
      case "topMargin":
        this.FReport.topMargin = newvalue;
        return;
      case "bottomMargin":
        this.FReport.bottomMargin = newvalue;
        return;
      case "pageSizeIndex":
        this.FReport.pageSizeIndex = newvalue;
        return;
      case "printOnlyIfDataAvailable":
        this.FReport.printOnlyIfDataAvailable = newvalue;
        return;
      case "twoPass":
        this.FReport.twoPass = newvalue;
        return;
      case "pdfCompressed":
        this.FReport.pdfCompressed = newvalue;
        return;
      case "pdfConformance":
        this.FReport.pdfConformance = newvalue;
        return;
      case "streamFormat":
        this.FReport.streamFormat = newvalue;
        return;
      case "customPageWidth":
        this.FReport.customPageWidth = newvalue;
        return;
      case "customPageHeight":
        this.FReport.customPageHeight = newvalue;
        return;
      case "forcePaperName":
        this.FReport.forcePaperName = newvalue;
        return;
      case "language":
        this.FReport.language = newvalue - 1;
        return;
      case "printerSelect":
        this.FReport.printerSelect = newvalue;
        return;
      case "previewWindow":
        this.FReport.previewWindow = newvalue;
        return;
      case "autoScale":
        this.FReport.autoScale = newvalue;
        return;
      case "duplex":
        this.FReport.duplex = newvalue;
        return;
      case "printerFonts":
        this.FReport.printerFonts = newvalue;
        return;
      case "linesPerInch":
        this.FReport.linesPerInch = newvalue == 0 ? 6 : 8;
        return;
      case "docAuthor":
      case "docTitle":
      case "docSubject":
      case "docProducer":
      case "docCreator":
      case "docCreationDate":
      case "docModificationDate":
      case "docKeywords":
      case "docXMPContent":
        (this.FReport as any)[pname] = newvalue;
        return;
    }

    super.SetProperty(pname, newvalue);
  }

  public override GetProperty(pname: string): any {
    if (!this.FReport) {
      throw new Error("Report not assigned");
    }
    switch (pname) {
      case "pageOrientation":
        return this.FReport.pageOrientation;
      case "pageSize":
        return this.FReport.pageSize;
      case "paperSource":
        return this.FReport.paperSource;
      case "leftMargin":
        return this.FReport.leftMargin;
      case "rightMargin":
        return this.FReport.rightMargin;
      case "topMargin":
        return this.FReport.topMargin;
      case "bottomMargin":
        return this.FReport.bottomMargin;
      case "pageSizeIndex":
        return this.FReport.pageSizeIndex;
      case "customPageWidth":
        return this.FReport.customPageWidth;
      case "customPageHeight":
        return this.FReport.customPageHeight;
      case "forcePaperName":
        return this.FReport.forcePaperName;
      case "language":
        return (this.FReport.language ?? 0) + 1;
      case "previewWindow":
        return this.FReport.previewWindow;
      case "autoScale":
        return this.FReport.autoScale;
      case "pdfCompressed":
        return this.FReport.pdfCompressed;
      case "pdfConformance":
        return this.FReport.pdfConformance;
      case "streamFormat":
        return this.FReport.streamFormat;
      case "printerSelect":
        return this.FReport.printerSelect;
      case "duplex":
        return this.FReport.duplex;
      case "printerFonts":
        return this.FReport.printerFonts;
      case "linesPerInch":
        return this.FReport.linesPerInch == 6 ? 0 : 1;
      case "printOnlyIfDataAvailable":
        return this.FReport.printOnlyIfDataAvailable;
      case "twoPass":
        return this.FReport.twoPass;
      case "docAuthor":
      case "docTitle":
      case "docSubject":
      case "docProducer":
      case "docCreator":
      case "docCreationDate":
      case "docModificationDate":
      case "docKeywords":
      case "docXMPContent":
        return (this.FReport as any)[pname];
    }

    return super.GetProperty(pname);
  }
}
