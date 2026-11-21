import { DataInfo } from "./data-info.js";
import { DatabaseInfo } from "./database-info.js";
import { ExpressionItem } from "./expression-item.js";
import { ImageItem } from "./image-item.js";
import { LabelItem } from "./label-item.js";
import { Param } from "./param.js";
import { ReportItem } from "./report-item.js";
import { ShapeItem } from "./shape-item.js";
import { SubReport } from "./sub-report.js";
import { ChangeObjectOperation, OperationType, PropertyType, UndoCue } from "./undo-cue.js";
import { ChartItem } from "./chart-item.js";
import { Section, SectionType } from "./section.js";
import { BarcodeItem } from "./barcode-item.js";
import { PrintPosItem } from "./print-pos-item.js";
import { PrintItemText } from "./print-item-text.js";
import { ArrayUtil } from "./array-util.js";
import { EmbeddedFile } from "./embedded-file.js";
import {
  AutoScaleType,
  CopyClass,
  FontStyle,
  PageOrientationType,
  PageSizeType,
  PDFConformanceType,
  PDFFontType,
  PreviewWindowStyleType,
  PrinterFontsType,
  PrinterSelectType,
  PrintStepType,
  StreamFormatType,
  TextAlignType,
  TextAlignVerticalType,
} from "./types.js";

/** C# Report (BaseReport): the defaults are the ones of its constructor. */
export class Report extends ReportItem {
  /** Runtime only (not serialised): every item of the report by uppercase name. */
  public components = new Map<string, ReportItem>();
  /** Runtime only (not serialised): the designer changed the report. */
  public modified = false;
  public wFontName = "Arial";
  public lFontName = "Helvetica";
  public gridVisible = true;
  public gridLines = false;
  public gridEnabled = true;
  public gridColor = 0xff0000;
  public gridWidth = 115;
  public gridHeight = 115;
  public pageOrientation = PageOrientationType.Default;
  public pageSize = PageSizeType.Default;
  public pageSizeIndex = 0;
  public pageWidth = 11906;
  public pageHeight = 16837;
  public customPageWidth = 11906;
  public customPageHeight = 16837;
  public pageBackColor = 0xffffff;
  public autoScale = AutoScaleType.Wide;
  public previewMargins = false;
  public previewWindow = PreviewWindowStyleType.Normal;
  public leftMargin = 574;
  public rightMargin = 574;
  public topMargin = 574;
  public bottomMargin = 861;
  public printerSelect = PrinterSelectType.DefaultPrinter;
  public language = -1;
  public copies = 1;
  public collateCopies = false;
  public twoPass = false;
  public printerFonts = PrinterFontsType.Default;
  public printOnlyIfDataAvailable = false;
  public streamFormat = StreamFormatType.Text;
  public actionBefore = false;
  public actionAfter = false;
  public previewAbout = true;
  public type1Font = PDFFontType.Helvetica;
  public pdfConformance = PDFConformanceType.PDF_1_4;
  public pdfCompressed = false;
  public fontSize = 10;
  public fontRotation = 0;
  public fontStyle = FontStyle.None;
  public fontColor = 0x000000;
  public backColor = 0xffffff;
  public transparent = true;
  public cutText = false;
  public alignment = TextAlignType.Left;
  public vAlignment = TextAlignVerticalType.Top;
  public wordWrap = false;
  public singleLine = false;
  public multiPage = false;
  public printStep = PrintStepType.BySize;
  public paperSource = 0;
  public duplex = 0;
  public forcePaperName?: string;
  public linesPerInch = 600;
  public databaseInfo: DatabaseInfo[] = [];
  public dataInfo: DataInfo[] = [];
  public subReports: SubReport[] = [];
  public undoCue?: UndoCue;
  public params: Param[] = [];
  /** Files embedded into the generated document (PDF attachments). */
  public embeddedFiles: EmbeddedFile[] = [];
  public docAuthor?: string;
  public docTitle?: string;
  public docSubject?: string;
  public docProducer?: string;
  public docCreator?: string;
  public docCreationDate?: string;
  public docModificationDate?: string;
  public docKeywords?: string;
  public docXMPContent?: string;

  constructor() {
    super();
    this.name = "REPORT";
    this.className = "TRPREPORT";
  }
  public updateComponentList() {
    this.components.clear();
    const duplicates: ReportItem[] = [];
    for (const dbInfo of this.databaseInfo) {
      if (!this.addComponentToReport(dbInfo, false)) {
        duplicates.push(dbInfo);
      }
    }
    for (const dataInfo of this.dataInfo) {
      if (!this.addComponentToReport(dataInfo, false)) {
        duplicates.push(dataInfo);
      }
    }
    if (this.params) {
      for (const param of this.params) {
        if (!this.addComponentToReport(param, false)) {
          duplicates.push(param);
        }
      }
    }
    for (const subreport of this.subReports) {
      if (!this.addComponentToReport(subreport, false)) {
        duplicates.push(subreport);
      }
      for (const section of subreport.sections) {
        if (!this.addComponentToReport(section, false)) {
          duplicates.push(section);
        }
        for (const compo of section.components) {
          if (!this.addComponentToReport(compo, false)) {
            duplicates.push(compo);
          }
        }
      }
    }
    for (const duplicate of duplicates) {
      // Si hay un duplicado en undocue, se elimina la cola
      if (this.undoCue) {
        let clearUndoCue = false;
        for (const op of this.undoCue.undoOperations) {
          if (op.componentName == duplicate.name) {
            clearUndoCue = true;
          }
        }
        if (!clearUndoCue) {
          for (const op of this.undoCue.redoOperations) {
            if (op.componentName == duplicate.name) {
              clearUndoCue = true;
            }
          }
        }
        if (clearUndoCue) {
          this.undoCue.clear();
        }
      }
      this.newName(duplicate);
      this.components.set(duplicate.name.toUpperCase(), duplicate);
    }
  }
  public addComponentToReport(reportItem: ReportItem, throwErrorIfDuplicate: boolean): boolean {
    // Add name
    if (!reportItem.name) {
      this.newName(reportItem);
    }
    // Check can not exists
    if (this.components.get(reportItem.name.toUpperCase())) {
      if (throwErrorIfDuplicate) {
        throw new Error("Duplicated report item, name: " + reportItem.name);
      } else {
        return false;
      }
    }
    this.components.set(reportItem.name.toUpperCase(), reportItem);
    return true;
  }
  public newName(reportItem: ReportItem) {
    if (!reportItem.className) {
      throw new Error("Report item with no classname");
    }
    let idx = 1;
    let prefix = reportItem.className + idx.toString();
    while (this.components.get(prefix.toUpperCase())) {
      idx++;
      prefix = reportItem.className + idx.toString();
    }
    reportItem.name = prefix;
  }
  public static subreportByName(report: Report, subReportName: string): SubReport | undefined {
    for (const subreport of report.subReports) {
      if (subreport.name == subReportName) {
        return subreport;
      }
    }
    return undefined;
  }
  public static newComponentByClassName(className: string): ReportItem {
    let newItem: ReportItem | undefined = undefined;
    switch (className) {
      case "TRPLABEL":
        {
          const label = new LabelItem();
          label.className = className;
          newItem = label;
          label.allStrings = [];
        }
        break;
      case "TRPEXPRESSION": {
        const expre = new ExpressionItem();
        expre.className = className;
        newItem = expre;
        break;
      }
      case "TRPSHAPE":
        {
          const shape = new ShapeItem();
          shape.className = className;
          newItem = shape;
        }
        break;
      case "TRPIMAGE":
        {
          const image = new ImageItem();
          image.className = className;
          newItem = image;
        }
        break;
      case "TRPBARCODE":
        {
          const barcode = new BarcodeItem();
          barcode.className = className;
          newItem = barcode;
        }
        break;
      case "TRPCHART":
        {
          const chart = new ChartItem();
          chart.className = className;
          newItem = chart;
        }
        break;
      case "TRPSECTION":
        {
          const section = new Section();
          section.className = className;
          newItem = section;
        }
        break;
      case "TRPSUBREPORT":
        {
          const subreport = new SubReport();
          subreport.className = className;
          newItem = subreport;
        }
        break;
      case "TRPPARAM":
        {
          const param = new Param();
          param.className = className;
          newItem = param;
        }
        break;
      case "TRPDATAINFOITEM":
        {
          const dataInfo = new DataInfo();
          dataInfo.className = className;
          newItem = dataInfo;
        }
        break;
      case "TRPDATABASEINFOITEM":
        {
          const databaseInfo = new DatabaseInfo();
          databaseInfo.className = className;
          newItem = databaseInfo;
        }
        break;
    }
    if (!newItem) {
      throw new Error("Class not found: " + className);
    }
    return newItem;
  }
  public deleteComponents(section: Section, groupId: number) {
    while (section.components.length > 0) {
      const compo = section.components[0];
      this.deleteComponentPrintPosItem(section, compo, 0, groupId);
    }
  }

  private addPrintPosItemProperties(item: PrintPosItem, op: ChangeObjectOperation) {
    op.addProperty("align", PropertyType.Integer, undefined, item.align);
    op.addProperty(
      "annotationExpression",
      PropertyType.String,
      undefined,
      item.annotationExpression
    );
    op.addProperty("doAfterPrint", PropertyType.String, undefined, item.doAfterPrint);
    op.addProperty("doBeforePrint", PropertyType.String, undefined, item.doBeforePrint);
    op.addProperty("height", PropertyType.Integer, undefined, item.height);
    op.addProperty("posX", PropertyType.Integer, undefined, item.posX);
    op.addProperty("posY", PropertyType.Integer, undefined, item.posY);
    op.addProperty("printCondition", PropertyType.String, undefined, item.printCondition);
    op.addProperty("width", PropertyType.Integer, undefined, item.width);
  }
  private addPrintItemTextProperties(item: PrintItemText, op: ChangeObjectOperation) {
    op.addProperty("alignment", PropertyType.Integer, undefined, item.alignment);
    op.addProperty("rightToLeft", PropertyType.Boolean, undefined, item.rightToLeft);
    op.addProperty("backColor", PropertyType.Integer, undefined, item.backColor);
    op.addProperty("cutText", PropertyType.Boolean, undefined, item.cutText);
    op.addProperty("fontColor", PropertyType.Integer, undefined, item.fontColor);
    op.addProperty("fontRotation", PropertyType.Integer, undefined, item.fontRotation);
    op.addProperty("fontSize", PropertyType.Integer, undefined, item.fontSize);
    op.addProperty("fontStyle", PropertyType.Integer, undefined, item.fontStyle);
    op.addProperty("interLine", PropertyType.Integer, undefined, item.interLine);
    op.addProperty("lFontName", PropertyType.String, undefined, item.lFontName);
    op.addProperty("wFontName", PropertyType.String, undefined, item.wFontName);
    op.addProperty("multiPage", PropertyType.Boolean, undefined, item.multiPage);
    op.addProperty("printStep", PropertyType.Integer, undefined, item.printStep);
    op.addProperty("singleLine", PropertyType.Boolean, undefined, item.singleLine);
    op.addProperty("transparent", PropertyType.Boolean, undefined, item.transparent);
    op.addProperty("wordBreak", PropertyType.Boolean, undefined, item.wordBreak);
    op.addProperty("wordWrap", PropertyType.Boolean, undefined, item.wordWrap);
    op.addProperty("isHtml", PropertyType.Boolean, undefined, item.isHtml);
    op.addProperty("type1Font", PropertyType.Integer, undefined, item.type1Font);
  }
  private addExpressionProperties(item: ExpressionItem, op: ChangeObjectOperation) {
    op.addProperty("agIniValue", PropertyType.String, undefined, item.agIniValue);
    op.addProperty("printNulls", PropertyType.Boolean, undefined, item.printNulls);
    op.addProperty("agType", PropertyType.Integer, undefined, item.agType);
    op.addProperty("aggregate", PropertyType.Integer, undefined, item.aggregate);
    op.addProperty("dataType", PropertyType.Integer, undefined, item.dataType);
    op.addProperty("displayFormat", PropertyType.String, undefined, item.displayFormat);
    op.addProperty("expression", PropertyType.String, undefined, item.expression);
    op.addProperty("groupName", PropertyType.String, undefined, item.groupName);
    op.addProperty("identifier", PropertyType.String, undefined, item.identifier);
    op.addProperty("printOnlyOne", PropertyType.Boolean, undefined, item.printOnlyOne);
  }
  private addLabelProperties(item: LabelItem, op: ChangeObjectOperation) {
    // Copia: guardar la referencia viva haría que ediciones posteriores
    // mutasen el valor registrado en la operación de deshacer.
    op.addProperty("allStrings", PropertyType.StringArray, undefined, [...item.allStrings]);
  }
  private addShapeProperties(item: ShapeItem, op: ChangeObjectOperation) {
    op.addProperty("brushColor", PropertyType.Integer, undefined, item.brushColor);
    op.addProperty("brushStyle", PropertyType.Integer, undefined, item.brushStyle);
    op.addProperty("penColor", PropertyType.Integer, undefined, item.penColor);
    op.addProperty("penStyle", PropertyType.Integer, undefined, item.penStyle);
    op.addProperty("penWidth", PropertyType.Integer, undefined, item.penWidth);
    op.addProperty("shape", PropertyType.Integer, undefined, item.shape);
  }
  private addImageProperties(item: ImageItem, op: ChangeObjectOperation) {
    op.addProperty("copyMode", PropertyType.Integer, undefined, item.copyMode);
    op.addProperty("dpires", PropertyType.Integer, undefined, item.dpires);
    op.addProperty("drawStyle", PropertyType.Integer, undefined, item.drawStyle);
    op.addProperty("rotation", PropertyType.Integer, undefined, item.rotation);
    op.addProperty("sharedImage", PropertyType.Integer, undefined, item.sharedImage);
    op.addProperty("streamBase64", PropertyType.String, undefined, item.streamBase64);
    op.addProperty("expression", PropertyType.String, undefined, item.expression);
  }
  private addChartProperties(item: ChartItem, op: ChangeObjectOperation) {
    op.addProperty("autorange", PropertyType.Integer, undefined, item.autoRange);
    op.addProperty("axisYFinal", PropertyType.Number, undefined, item.axisYFinal);
    op.addProperty("axisYInitial", PropertyType.Number, undefined, item.axisYInitial);
    op.addProperty("captionExpression", PropertyType.String, undefined, item.captionExpression);
    op.addProperty("changeSerieBool", PropertyType.Boolean, undefined, item.changeSerieBool);
    op.addProperty(
      "changeSerieExpression",
      PropertyType.String,
      undefined,
      item.changeSerieExpression
    );
    op.addProperty("chartStyle", PropertyType.Integer, undefined, item.chartStyle);
    op.addProperty("clearExpression", PropertyType.String, undefined, item.clearExpression);
    op.addProperty(
      "clearExpressionBool",
      PropertyType.Boolean,
      undefined,
      item.clearExpressionBool
    );
    op.addProperty("colorExpression", PropertyType.String, undefined, item.colorExpression);
    op.addProperty("driver", PropertyType.Integer, undefined, item.driver);
    op.addProperty("elevation", PropertyType.Number, undefined, item.elevation);
    op.addProperty("getValueCondition", PropertyType.String, undefined, item.getValueCondition);
    op.addProperty("horzFontRotation", PropertyType.Integer, undefined, item.horzFontRotation);
    op.addProperty("horzFontSize", PropertyType.Integer, undefined, item.horzFontSize);
    op.addProperty("horzOffset", PropertyType.Number, undefined, item.horzOffset);
    op.addProperty("identifier", PropertyType.String, undefined, item.identifier);
    op.addProperty("markStyle", PropertyType.Integer, undefined, item.markStyle);
    op.addProperty("multiBar", PropertyType.Integer, undefined, item.multiBar);
    op.addProperty("orthogonal", PropertyType.Boolean, undefined, item.orthogonal);
    op.addProperty("perspective", PropertyType.Number, undefined, item.perspective);
    op.addProperty("resolution", PropertyType.Integer, undefined, item.resolution);
    op.addProperty("rotation", PropertyType.Integer, undefined, item.rotation);
    op.addProperty("serieCaption", PropertyType.String, undefined, item.serieCaption);
    op.addProperty(
      "serieColorExpression",
      PropertyType.String,
      undefined,
      item.serieColorExpression
    );
    op.addProperty("showHint", PropertyType.Boolean, undefined, item.showHint);
    op.addProperty("showLegend", PropertyType.Boolean, undefined, item.showLegend);
    op.addProperty("tilt", PropertyType.Number, undefined, item.tilt);
    op.addProperty("valueExpression", PropertyType.String, undefined, item.valueExpression);
    op.addProperty("valueXExpression", PropertyType.String, undefined, item.valueXExpression);
    op.addProperty("vertFontRotation", PropertyType.Integer, undefined, item.vertFontRotation);
    op.addProperty("vertFontSize", PropertyType.Integer, undefined, item.vertFontSize);
    op.addProperty("vertOffset", PropertyType.Number, undefined, item.vertOffset);
    op.addProperty("view3d", PropertyType.Boolean, undefined, item.view3d);
    op.addProperty("view3dWalls", PropertyType.Boolean, undefined, item.view3dWalls);
    op.addProperty("zoom", PropertyType.Integer, undefined, item.zoom);
  }
  private addBarcodeProperties(item: BarcodeItem, op: ChangeObjectOperation) {
    op.addProperty("bColor", PropertyType.Integer, undefined, item.bColor);
    op.addProperty("barType", PropertyType.Integer, undefined, item.barType);
    op.addProperty("checksum", PropertyType.Boolean, undefined, item.checksum);
    op.addProperty("eccLevel", PropertyType.Integer, undefined, item.eccLevel);
    op.addProperty("expression", PropertyType.String, undefined, item.expression);
    op.addProperty("expression", PropertyType.String, undefined, item.expression);
    op.addProperty("modul", PropertyType.Integer, undefined, item.modul);
    op.addProperty("numColumns", PropertyType.Integer, undefined, item.numColumns);
    op.addProperty("numRows", PropertyType.Integer, undefined, item.numRows);
    op.addProperty("ratio", PropertyType.Number, undefined, item.ratio);
    op.addProperty("truncated", PropertyType.Boolean, undefined, item.truncated);
    op.addProperty("truncated", PropertyType.Boolean, undefined, item.truncated);
  }
  public deleteComponentPrintPosItem(
    section: Section,
    compo: PrintPosItem,
    index: number,
    groupId: number
  ) {
    if (groupId) {
      const op = new ChangeObjectOperation(OperationType.Remove, groupId);
      op.parentName = section.name;
      op.componentClass = compo.className;
      op.componentName = compo.name;
      op.oldItemIndex = 0;
      this.addComponentProperties(compo, op);
      this.undoCue?.addOperation(op, this);
    }
    this.deleteComponent(compo);
    section.components.splice(index, 1);
  }
  public getParentSection(item: PrintPosItem): Section {
    for (const subreport of this.subReports) {
      for (const section of subreport.sections) {
        for (const sectionItem of section.components) {
          if (sectionItem == item) {
            return section;
          }
        }
      }
    }
    throw new Error("Component " + item.name + " not found in report");
  }
  public getParentSubReport(section: Section): SubReport {
    const subreport = this.getParentSubReportOrUndefined(section);
    if (subreport) {
      return subreport;
    } else {
      throw new Error("Section " + section.name + " not found in report");
    }
  }
  public getParentSubReportOrUndefined(section: Section): SubReport | undefined {
    for (const subreport of this.subReports) {
      for (const sectionItem of subreport.sections) {
        if (sectionItem == section) {
          return subreport;
        }
      }
    }
    return undefined;
  }

  public deleteComponent(item: ReportItem) {
    const compoExists = this.components.get(item.name.toUpperCase());
    if (compoExists) {
      this.components.delete(item.name.toUpperCase());
    }
  }
  public findGroupFooter(header: Section, subreport: SubReport): Section {
    let idxGroup = 0;
    for (const section of subreport.sections) {
      if (section.sectionType == SectionType.GroupHeader) {
        idxGroup++;
        if (section == header) {
          break;
        }
      }
    }
    for (let idx = subreport.sections.length - 1; idx >= 0; idx--) {
      const section = subreport.sections[idx];
      if (section.sectionType == SectionType.GroupFooter) {
        idxGroup--;
        if (idxGroup == 0) {
          return section;
        }
      }
    }
    throw new Error("Can not find group footer");
  }
  public findGroupHeader(header: Section, subreport: SubReport): Section {
    let idxGroup = 0;
    for (let idx = subreport.sections.length - 1; idx >= 0; idx--) {
      const section = subreport.sections[idx];
      if (section.sectionType == SectionType.GroupFooter) {
        idxGroup++;
        if (section == header) {
          break;
        }
      }
    }
    for (const section of subreport.sections) {
      if (section.sectionType == SectionType.GroupHeader) {
        idxGroup--;
        if (idxGroup == 0) {
          return section;
        }
      }
    }
    throw new Error("Can not find group header");
  }
  private moveSection(
    section: Section,
    up: boolean,
    secondStep: boolean,
    groupId: number | undefined
  ) {
    if (!groupId) {
      groupId = this.undoCue!.getGroupId();
    }
    const subreport = this.getParentSubReport(section);
    let doSwap = true;
    const oldIndex = subreport.sections.indexOf(section);
    const newIndex = up ? oldIndex - 1 : oldIndex + 1;
    const swapSection = subreport.sections[newIndex];
    // Swap solo aplicable para secciones iguales que no sean grupo
    switch (section.sectionType) {
      case SectionType.Detail:
      case SectionType.PageFooter:
      case SectionType.PageHeader:
        if (swapSection.sectionType != section.sectionType) {
          doSwap = false;
        }
        break;
      case SectionType.GroupHeader:
        if (swapSection.sectionType != SectionType.GroupHeader) {
          doSwap = false;
        } else {
          if (!secondStep) {
            const otherSection = this.findGroupFooter(section, subreport);
            this.moveSection(otherSection, !up, true, groupId);
          }
        }
        break;
      case SectionType.GroupFooter:
        if (swapSection.sectionType != SectionType.GroupFooter) {
          doSwap = false;
        } else {
          if (!secondStep) {
            const otherSection = this.findGroupHeader(section, subreport);
            this.moveSection(otherSection, !up, true, groupId);
          }
        }
        break;
    }
    if (doSwap) {
      const op = new ChangeObjectOperation(
        up ? OperationType.SwapUp : OperationType.SwapDown,
        groupId
      );
      op.componentClass = section.className;
      op.parentName = subreport.name;
      op.oldItemIndex = oldIndex;
      ArrayUtil.swap(subreport.sections, oldIndex, newIndex);
      this.undoCue?.addOperation(op, this);
    }
  }
  public upReportItem(selectedItem: ReportItem) {
    let oldIndex = -1;
    let parentName: string | undefined = undefined;
    switch (selectedItem.className) {
      case "TRPSUBREPORT":
        {
          const subrep = selectedItem as SubReport;
          oldIndex = this.subReports.indexOf(subrep);
          const isFirstSubreport = oldIndex == 0;
          if (!isFirstSubreport) {
            ArrayUtil.swap(this.subReports, oldIndex, oldIndex - 1);
          } else {
            return;
          }
        }
        break;
      case "TRPSECTION":
        {
          const section = selectedItem as Section;
          const subreport = this.getParentSubReport(section);
          parentName = subreport.name;
          oldIndex = subreport.sections.indexOf(section);
          const isFirstSection = oldIndex == 0;
          if (!isFirstSection) {
            this.moveSection(section, true, false, undefined);
            return;
          } else {
            return;
          }
        }
        break;
      case "TRPPARAM":
        {
          const param = selectedItem as Param;
          oldIndex = this.params.indexOf(param);
          const isFirstParam = oldIndex == 0;
          if (!isFirstParam) {
            ArrayUtil.swap(this.params, oldIndex, oldIndex - 1);
          } else {
            return;
          }
        }
        break;
      case "TRPDATAINFOITEM":
        {
          const ditem = selectedItem as DataInfo;
          oldIndex = this.dataInfo.indexOf(ditem);
          const isFisrtDataInfo = oldIndex == 0;
          if (!isFisrtDataInfo) {
            ArrayUtil.swap(this.dataInfo, oldIndex, oldIndex - 1);
          } else {
            return;
          }
        }
        break;
      case "TRPDATABASEINFOITEM":
        {
          const dbitem = selectedItem as DatabaseInfo;
          oldIndex = this.databaseInfo.indexOf(dbitem);
          const isFirstDbInfo = oldIndex == 0;
          if (!isFirstDbInfo) {
            ArrayUtil.swap(this.databaseInfo, oldIndex, oldIndex - 1);
          } else {
            return;
          }
        }
        break;
      default:
        throw new Error("Classname incorrect: " + selectedItem.className);
    }
    const op = new ChangeObjectOperation(OperationType.SwapUp, this.undoCue!.getGroupId());
    op.componentClass = selectedItem.className;
    op.oldItemIndex = oldIndex;
    op.parentName = parentName;
    this.undoCue?.addOperation(op, this);
  }
  public downReportItem(selectedItem: ReportItem) {
    let oldIndex = -1;
    let parentName: string | undefined = undefined;
    switch (selectedItem.className) {
      case "TRPSUBREPORT":
        {
          const subrep = selectedItem as SubReport;
          oldIndex = this.subReports.indexOf(subrep);
          const isLastSubreport = oldIndex >= this.subReports.length - 1;
          if (!isLastSubreport) {
            ArrayUtil.swap(this.subReports, oldIndex, oldIndex + 1);
          } else {
            return;
          }
        }
        break;
      case "TRPSECTION":
        {
          const section = selectedItem as Section;
          const subreport = this.getParentSubReport(section);
          parentName = subreport.name;
          oldIndex = subreport.sections.indexOf(section);
          const isLastSection = oldIndex >= subreport.sections.length - 1;
          if (!isLastSection) {
            this.moveSection(section, false, false, undefined);
            return;
          } else {
            return;
          }
        }
        break;
      case "TRPPARAM":
        {
          const param = selectedItem as Param;
          oldIndex = this.params.indexOf(param);
          const isLastParam = oldIndex >= this.params.length - 1;
          if (!isLastParam) {
            ArrayUtil.swap(this.params, oldIndex, oldIndex + 1);
          } else {
            return;
          }
        }
        break;
      case "TRPDATAINFOITEM":
        {
          const ditem = selectedItem as DataInfo;
          oldIndex = this.dataInfo.indexOf(ditem);
          const isLastDataInfo = oldIndex >= this.dataInfo.length - 1;
          if (!isLastDataInfo) {
            ArrayUtil.swap(this.dataInfo, oldIndex, oldIndex + 1);
          } else {
            return;
          }
        }
        break;
      case "TRPDATABASEINFOITEM":
        {
          const dbitem = selectedItem as DatabaseInfo;
          oldIndex = this.databaseInfo.indexOf(dbitem);
          const isLastDbInfo = oldIndex >= this.databaseInfo.length - 1;
          if (!isLastDbInfo) {
            ArrayUtil.swap(this.databaseInfo, oldIndex, oldIndex + 1);
          } else {
            return;
          }
        }
        break;
      default:
        throw new Error("Classname incorrect: " + selectedItem.className);
    }
    const op = new ChangeObjectOperation(OperationType.SwapDown, this.undoCue!.getGroupId());
    op.componentClass = selectedItem.className;
    op.parentName = parentName;
    op.oldItemIndex = oldIndex;
    this.undoCue?.addOperation(op, this);
  }
  private deleteSection(section: Section, groupId: number) {
    const subreport = this.getParentSubReport(section);
    if (!subreport) {
      return;
    }
    switch (section.sectionType) {
      case SectionType.Detail:
      case SectionType.PageFooter:
      case SectionType.PageHeader:
        {
          this.deleteComponents(section, groupId);
          const index = subreport.sections.indexOf(section);
          if (index >= 0) {
            this.deleteComponent(section);
            if (groupId) {
              const op = new ChangeObjectOperation(OperationType.Remove, groupId);
              op.componentName = section.name;
              op.parentName = subreport.name;
              op.componentClass = section.className;
              op.oldItemIndex = index;
              this.addCommonSectionProperties(section, op);
              this.undoCue?.addOperation(op, this);
            }
            subreport.sections.splice(index, 1);
          }
        }
        break;
      case SectionType.GroupFooter:
      case SectionType.GroupHeader:
        {
          const groupName = section.groupName;
          const secToDelete: Section[] = [];
          for (const sec of subreport.sections) {
            this.deleteComponents(sec, groupId);
            if (
              sec.groupName == groupName &&
              (sec.sectionType == SectionType.GroupFooter ||
                sec.sectionType == SectionType.GroupHeader)
            ) {
              secToDelete.push(sec);
            }
          }
          for (const sec of secToDelete) {
            const index = subreport.sections.indexOf(sec);
            if (index >= 0) {
              if (groupId) {
                const op = new ChangeObjectOperation(OperationType.Remove, groupId);
                op.componentName = sec.name;
                op.parentName = subreport.name;
                op.componentClass = sec.className;
                op.oldItemIndex = index;
                this.addCommonSectionProperties(sec, op);
                this.undoCue?.addOperation(op, this);
              }
              this.deleteComponent(sec);
              subreport.sections.splice(index, 1);
            }
          }
        }
        break;
    }
  }
  private addSubreportProperties(subreport: SubReport, op: ChangeObjectOperation) {
    op.addProperty("alias", PropertyType.String, undefined, subreport.alias);
    op.addProperty(
      "printOnlyIfDataAvailable",
      PropertyType.Boolean,
      undefined,
      subreport.printOnlyIfDataAvailable
    );
  }
  private deleteSubreport(subreport: SubReport, groupId: number) {
    const index = this.subReports.indexOf(subreport);
    if (index < 0) {
      return;
    }
    // Delete references a schildsubreport
    for (const subrep of this.subReports) {
      for (const section of subrep.sections) {
        if (section.childSubReportName == subreport.name) {
          if (groupId) {
            const opName = new ChangeObjectOperation(OperationType.Modify, groupId);
            opName.componentClass = section.className;
            opName.componentName = section.name;
            opName.addProperty(
              "childSubreportName",
              PropertyType.String,
              section.childSubReportName,
              ""
            );
            this.undoCue!.addOperation(opName, this);
          }
          section.childSubReportName = "";
        }
      }
    }
    while (subreport.sections.length > 0) {
      this.deleteSection(subreport.sections[0], groupId);
    }
    if (groupId) {
      const op = new ChangeObjectOperation(OperationType.Remove, groupId);
      op.componentName = subreport.name;
      op.componentClass = subreport.className;
      op.oldItemIndex = index;
      this.addSubreportProperties(subreport, op);
      this.undoCue?.addOperation(op, this);
    }

    this.deleteComponent(subreport);
    this.subReports.splice(index, 1);
  }
  public getComponentByName(name: string): ReportItem | Report {
    if (name == "REPORT") {
      return this;
    } else {
      const item = this.components.get(name.toUpperCase());
      if (!item) {
        throw new Error("Item not found at apply Operation undo/redo cue: " + name);
      }
      return item;
    }
  }

  private addCommonSectionProperties(sec: Section, op: ChangeObjectOperation) {
    op.addProperty("printCondition", PropertyType.String, undefined, sec.printCondition);
    op.addProperty("alignBottom", PropertyType.Boolean, undefined, sec.alignBottom);
    op.addProperty("autoContract", PropertyType.Boolean, undefined, sec.autoContract);
    op.addProperty("autoExpand", PropertyType.Boolean, undefined, sec.autoExpand);
    op.addProperty("autoExpand", PropertyType.Boolean, undefined, sec.autoExpand);
    op.addProperty("backExpression", PropertyType.String, undefined, sec.backExpression);
    op.addProperty("backStyle", PropertyType.Integer, undefined, sec.backStyle);
    op.addProperty("beginPageExpression", PropertyType.String, undefined, sec.beginPageExpression);
    op.addProperty("childSubreportName", PropertyType.String, undefined, sec.childSubReportName);
    op.addProperty("doAfterPrint", PropertyType.String, undefined, sec.doAfterPrint);
    op.addProperty("doBeforePrint", PropertyType.String, undefined, sec.doBeforePrint);
    op.addProperty("dpires", PropertyType.Integer, undefined, sec.dpires);
    op.addProperty("drawStyle", PropertyType.Integer, undefined, sec.drawStyle);
    op.addProperty("forcePrint", PropertyType.Boolean, undefined, sec.forcePrint);
    op.addProperty("global", PropertyType.Boolean, undefined, sec.global);
    op.addProperty("height", PropertyType.Integer, undefined, sec.height);
    op.addProperty("width", PropertyType.Integer, undefined, sec.width);
    op.addProperty("horzDesp", PropertyType.Boolean, undefined, sec.horzDesp);
    op.addProperty("iniNumPage", PropertyType.Boolean, undefined, sec.iniNumPage);
    op.addProperty("pageRepeat", PropertyType.Boolean, undefined, sec.pageRepeat);
    op.addProperty("printCondition", PropertyType.String, undefined, sec.printCondition);
    op.addProperty("sectionType", PropertyType.Integer, undefined, sec.sectionType);
    op.addProperty("sharedImage", PropertyType.Integer, undefined, sec.sharedImage);
    op.addProperty("skipExpreH", PropertyType.String, undefined, sec.skipExpreH);
    op.addProperty("skipExpreV", PropertyType.String, undefined, sec.skipExpreV);
    op.addProperty("skipPage", PropertyType.Boolean, undefined, sec.skipPage);
    op.addProperty("skipRelativeH", PropertyType.Boolean, undefined, sec.skipRelativeH);
    op.addProperty("skipRelativeV", PropertyType.Boolean, undefined, sec.skipRelativeV);
    op.addProperty("skipToPageExpre", PropertyType.String, undefined, sec.skipToPageExpre);
    op.addProperty("skipType", PropertyType.Integer, undefined, sec.skipType);
    op.addProperty("streamBase64", PropertyType.String, undefined, sec.streamBase64);
    op.addProperty("subReportName", PropertyType.String, undefined, sec.subReportName);
    op.addProperty("streamFormat", PropertyType.Integer, undefined, sec.streamFormat);
    op.addProperty("vertDesp", PropertyType.Boolean, undefined, sec.vertDesp);
    op.addProperty("groupName", PropertyType.String, undefined, sec.groupName);
    op.addProperty("changeExpression", PropertyType.String, undefined, sec.changeExpression);
    op.addProperty("changeBool", PropertyType.Boolean, undefined, sec.changeBool);
  }
  public addParam(item: Param, groupId: number) {
    const op = new ChangeObjectOperation(OperationType.Add, groupId);
    op.componentName = item.name;
    op.componentClass = item.className;
    this.addParamProperties(item, op);
    this.undoCue?.addOperation(op, this);
    this.params.push(item);
    this.components.set(item.name.toUpperCase(), item);
  }
  public addDatabaseInfo(item: DatabaseInfo, groupId: number) {
    const op = new ChangeObjectOperation(OperationType.Add, groupId);
    op.componentName = item.name;
    op.componentClass = item.className;
    this.addDatabaseInfoProperties(item, op);
    this.undoCue?.addOperation(op, this);
    this.databaseInfo.push(item);
    this.components.set(item.name.toUpperCase(), item);
  }
  public addSection(
    subrep: SubReport,
    section: Section,
    groupId: number,
    index: number | undefined
  ) {
    const components: PrintPosItem[] = [...section.components];
    section.components = [];
    {
      const op = new ChangeObjectOperation(OperationType.Add, groupId);
      if (this.components.get(section.name.toUpperCase())) {
        this.newName(section);
      }
      op.componentName = section.name;
      op.componentClass = section.className;
      op.parentName = subrep.name;
      this.addCommonSectionProperties(section, op);
      this.undoCue?.addOperation(op, this);
      this.components.set(section.name.toUpperCase(), section);
    }
    if (index != null) {
      subrep.sections.splice(index, 0, section);
    } else {
      subrep.sections.push(section);
    }
    for (const compo of components) {
      if (this.components.get(compo.name.toUpperCase())) {
        this.newName(compo);
      }
      // Remove duplicate identifiers
      switch (compo.className) {
        case "TRPEXPRESSION":
        case "TRPCHART":
          {
            const compoExpre = compo as ExpressionItem | ChartItem;
            if (compoExpre.identifier) {
              for (const actualCompo of this.components.values()) {
                switch (actualCompo.className) {
                  case "TRPEXPRESSION":
                  case "TRPCHART":
                    {
                      const actualCompoExpre = actualCompo as ExpressionItem | ChartItem;
                      if (actualCompoExpre.identifier == compoExpre.identifier) {
                        compoExpre.identifier = "";
                      }
                    }
                    break;
                }
              }
            }
          }
          break;
      }
      {
        const op = new ChangeObjectOperation(OperationType.Add, groupId);
        op.componentName = compo.name;
        op.componentClass = compo.className;
        op.parentName = section.name;
        this.addComponentProperties(compo, op);
        this.undoCue?.addOperation(op, this);
        this.components.set(compo.name.toUpperCase(), compo);
      }
      section.components.push(compo);
    }
  }
  public addSubReport(item: SubReport, groupId: number) {
    const sections: Section[] = [...item.sections];
    item.sections = [];
    {
      const op = new ChangeObjectOperation(OperationType.Add, groupId);
      op.componentName = item.name;
      op.componentClass = item.className;
      this.addSubreportProperties(item, op);
      this.undoCue?.addOperation(op, this);
      this.subReports.push(item);
      this.components.set(item.name.toUpperCase(), item);
    }
    for (const section of sections) {
      this.addSection(item, section, groupId, undefined);
    }
  }
  public addDataInfo(item: DataInfo, groupId: number) {
    const op = new ChangeObjectOperation(OperationType.Add, groupId);
    op.componentName = item.name;
    op.componentClass = item.className;
    this.addDataInfoProperties(item, op);
    this.undoCue?.addOperation(op, this);
    this.dataInfo.push(item);
    this.components.set(item.name.toUpperCase(), item);
  }
  public deleteItem(item: ReportItem, groupId: number, deleteRelated = false) {
    switch (item.className) {
      case "TRPDATAINFOITEM":
        this.deleteDataInfo(item as DataInfo, groupId);
        break;
      case "TRPDATABASEINFOITEM":
        this.deleteDatabaseInfo(item as DatabaseInfo, groupId);
        break;
      case "TRPSECTION":
        {
          // One detail minimum
          const section = item as Section;
          if (section.sectionType == SectionType.Detail) {
            const subreport = this.getParentSubReport(section);
            if (SubReport.detailCount(subreport) == 1) {
              return;
            }
          }

          this.deleteSection(section, groupId);
        }
        break;
      case "TRPPARAM":
        this.deleteParam(item as Param, groupId);
        break;
      case "TRPSUBREPORT":
        // One subreprot only
        if (this.subReports.length <= 1) {
          return;
        }
        {
          const subrep = item as SubReport;
          const alias = subrep.alias;
          if (alias && deleteRelated) {
            for (const dinfo of this.dataInfo) {
              if (dinfo.alias === alias) {
                this.deleteDataInfo(dinfo, groupId);
              }
            }
            // Delete related params
            let i = 0;
            while (i < this.params.length) {
              const param = this.params[i];
              if (param.datasets) {
                const idxDataset = param.datasets.indexOf(alias);
                if (idxDataset >= 0) {
                  param.datasets.splice(idxDataset, 1);
                  if (param.datasets.length == 0) {
                    this.params.splice(i, 1);
                  } else {
                    i++;
                  }
                } else {
                  i++;
                }
              } else {
                i++;
              }
            }
          }
          this.deleteSubreport(subrep, groupId);
        }
        break;
      default:
        {
          const printPosItem = item as PrintPosItem;
          const parentSec = this.getParentSection(printPosItem);
          const index = parentSec.components.indexOf(printPosItem);
          this.deleteComponentPrintPosItem(parentSec, printPosItem, index, groupId);
        }
        break;
    }
  }

  private addDataInfoProperties(item: DataInfo, op: ChangeObjectOperation) {
    op.addProperty("alias", PropertyType.String, undefined, item.alias);
    op.addProperty("bdeFilter", PropertyType.String, undefined, item.bdeFilter);
    op.addProperty("bdeFirstRange", PropertyType.String, undefined, item.bdeFirstRange);
    op.addProperty("bdeIndexFields", PropertyType.String, undefined, item.bdeIndexFields);
    op.addProperty("bdeIndexName", PropertyType.String, undefined, item.bdeIndexName);
    op.addProperty("bdeLastRange", PropertyType.String, undefined, item.bdeLastRange);
    op.addProperty("bdeMasterFields", PropertyType.String, undefined, item.bdeMasterFields);
    op.addProperty("bdeTable", PropertyType.String, undefined, item.bdeTable);
    op.addProperty("bdeType", PropertyType.Integer, undefined, item.bdeType);
    op.addProperty("dataSource", PropertyType.String, undefined, item.dataSource);
    op.addProperty("dataUnions", PropertyType.StringArray, undefined, item.dataUnions);
    op.addProperty("databaseAlias", PropertyType.String, undefined, item.databaseAlias);
    op.addProperty("groupUnion", PropertyType.Boolean, undefined, item.groupUnion);
    op.addProperty("myBaseFields", PropertyType.String, undefined, item.myBaseFields);
    op.addProperty("myBaseFilename", PropertyType.String, undefined, item.myBaseFilename);
    op.addProperty("myBaseIndexFields", PropertyType.String, undefined, item.myBaseIndexFields);
    op.addProperty("myBaseMasterFields", PropertyType.String, undefined, item.myBaseMasterFields);
    op.addProperty("openOnStart", PropertyType.Boolean, undefined, item.openOnStart);
    op.addProperty("parallelUnion", PropertyType.Boolean, undefined, item.parallelUnion);
    op.addProperty("sql", PropertyType.String, undefined, item.sql);
  }
  private addDatabaseInfoProperties(item: DatabaseInfo, op: ChangeObjectOperation) {
    op.addProperty("alias", PropertyType.String, undefined, item.alias);
    op.addProperty("connectionString", PropertyType.String, undefined, item.connectionString);
    op.addProperty("dotNetDriver", PropertyType.Integer, undefined, item.dotNetDriver);
    op.addProperty("driver", PropertyType.Integer, undefined, item.driver);
    op.addProperty("providerFactory", PropertyType.String, undefined, item.providerFactory);
    op.addProperty("reportField", PropertyType.String, undefined, item.reportField);
    op.addProperty("reportGroupsTable", PropertyType.String, undefined, item.reportGroupsTable);
    op.addProperty("reportSearchField", PropertyType.String, undefined, item.reportSearchField);
    op.addProperty("reportTable", PropertyType.String, undefined, item.reportTable);
    op.addProperty("transIsolation", PropertyType.Integer, undefined, item.transIsolation);
  }
  private addParamProperties(item: Param, op: ChangeObjectOperation) {
    op.addProperty("alias", PropertyType.String, undefined, item.alias);
    op.addProperty("allowNulls", PropertyType.String, undefined, item.allowNulls);
    op.addProperty("datasets", PropertyType.StringArray, undefined, item.datasets);
    op.addProperty("descriptions", PropertyType.StringArray, undefined, item.descriptions);
    op.addProperty("errorMessages", PropertyType.StringArray, undefined, item.errorMessages);
    op.addProperty("hints", PropertyType.StringArray, undefined, item.hints);
    op.addProperty("isReadOnly", PropertyType.Boolean, undefined, item.isReadOnly);
    op.addProperty("items", PropertyType.StringArray, undefined, item.items);
    op.addProperty("lookupDataset", PropertyType.String, undefined, item.lookupDataset);
    op.addProperty("neverVisible", PropertyType.Boolean, undefined, item.neverVisible);
    op.addProperty("paramType", PropertyType.Integer, undefined, item.paramType);
    op.addProperty("search", PropertyType.String, undefined, item.search);
    op.addProperty("searchDataset", PropertyType.String, undefined, item.searchDataset);
    op.addProperty("searchParam", PropertyType.String, undefined, item.searchParam);
    op.addProperty("selected", PropertyType.StringArray, undefined, item.selected);
    op.addProperty("validation", PropertyType.String, undefined, item.validation);
    op.addProperty("value", PropertyType.Variant, undefined, item.value);
    op.addProperty("values", PropertyType.StringArray, undefined, item.values);
    op.addProperty("visible", PropertyType.Boolean, undefined, item.visible);
  }
  private deleteDataInfo(dataInfo: DataInfo, groupId: number) {
    const index = this.dataInfo.indexOf(dataInfo);
    if (index < 0) {
      return;
    }
    const alias = dataInfo.alias;
    if (alias) {
      for (const subreport of this.subReports) {
        if (subreport.alias == alias) {
          if (groupId) {
            const opdinfo = new ChangeObjectOperation(OperationType.Modify, groupId);
            opdinfo.componentClass = subreport.className;
            opdinfo.componentName = subreport.name;
            opdinfo.addProperty("alias", PropertyType.String, subreport.alias, "");
            this.undoCue?.addOperation(opdinfo, this);
          }
          subreport.alias = "";
        }
      }
      for (const dinfo of this.dataInfo) {
        if (dinfo.dataSource == alias) {
          if (groupId) {
            const opdinfo = new ChangeObjectOperation(OperationType.Modify, groupId);
            opdinfo.componentClass = dinfo.className;
            opdinfo.componentName = dinfo.name;
            opdinfo.addProperty("dataSource", PropertyType.String, dinfo.dataSource, "");
            this.undoCue?.addOperation(opdinfo, this);
          }
          dinfo.dataSource = "";
        }
      }
      for (const param of this.params) {
        const index = param.datasets.indexOf(alias);
        if (index >= 0) {
          const oldValue = param.datasets.slice();
          param.datasets.splice(index, 1);
          if (groupId) {
            const opParam = new ChangeObjectOperation(OperationType.Modify, groupId);
            opParam.componentClass = param.className;
            opParam.componentName = param.name;
            opParam.addProperty(
              "datasets",
              PropertyType.StringArray,
              oldValue,
              param.datasets.slice()
            );
            this.undoCue?.addOperation(opParam, this);
          }
        }
      }
    }
    if (groupId) {
      const op = new ChangeObjectOperation(OperationType.Remove, groupId);
      op.componentClass = dataInfo.className;
      op.oldItemIndex = index;
      op.componentName = dataInfo.name;
      this.addDataInfoProperties(dataInfo, op);
      this.undoCue?.addOperation(op, this);
    }
    this.deleteComponent(dataInfo);
    this.dataInfo.splice(index, 1);
  }
  private deleteDatabaseInfo(databaseInfo: DatabaseInfo, groupId: number) {
    const index = this.databaseInfo.indexOf(databaseInfo);
    if (index < 0) {
      return;
    }
    const alias = databaseInfo.alias;
    if (alias) {
      for (const dinfo of this.dataInfo) {
        if (dinfo.databaseAlias == alias) {
          if (groupId) {
            const opName = new ChangeObjectOperation(OperationType.Modify, groupId);
            opName.componentClass = dinfo.className;
            opName.componentName = dinfo.name;
            opName.addProperty("databaseAlias", PropertyType.String, dinfo.databaseAlias, "");
            this.undoCue!.addOperation(opName, this);
          }
          dinfo.databaseAlias = "";
        }
      }
    }
    if (groupId) {
      const op = new ChangeObjectOperation(OperationType.Remove, groupId);
      op.componentClass = databaseInfo.className;
      op.oldItemIndex = index;
      op.componentName = databaseInfo.name;
      this.addDatabaseInfoProperties(databaseInfo, op);
      this.undoCue?.addOperation(op, this);
    }

    this.deleteComponent(databaseInfo);
    this.databaseInfo.splice(index, 1);
  }
  private deleteParam(param: Param, groupId: number) {
    const index = this.params.indexOf(param);
    if (index < 0) {
      return;
    }
    if (groupId) {
      const op = new ChangeObjectOperation(OperationType.Remove, groupId);
      op.componentClass = param.className;
      op.oldItemIndex = index;
      op.componentName = param.name;
      this.addParamProperties(param, op);
      this.undoCue?.addOperation(op, this);
    }
    this.deleteComponent(param);
    this.params.splice(index, 1);
  }
  public addComponentProperties(compo: PrintPosItem, op: ChangeObjectOperation) {
    this.addPrintPosItemProperties(compo, op);
    switch (compo.className) {
      case "TRPEXPRESSION":
        this.addPrintItemTextProperties(compo as PrintItemText, op);
        this.addExpressionProperties(compo as ExpressionItem, op);
        break;
      case "TRPLABEL":
        this.addPrintItemTextProperties(compo as PrintItemText, op);
        this.addLabelProperties(compo as LabelItem, op);
        break;
      case "TRPSHAPE":
        this.addShapeProperties(compo as ShapeItem, op);
        break;
      case "TRPIMAGE":
        this.addImageProperties(compo as ImageItem, op);
        break;
      case "TRPCHART":
        this.addPrintItemTextProperties(compo as PrintItemText, op);
        this.addChartProperties(compo as ChartItem, op);
        break;
      case "TRPBARCODE":
        this.addBarcodeProperties(compo as BarcodeItem, op);
        break;
    }
  }
  /**
   * Where copyItemsToClipboard and pasteItemsFromClipboard write and read when they are not given
   * one. The core does no I/O: a browser host sets it to navigator.clipboard (it has the same two
   * methods), other hosts to their own clipboard.
   */
  public static clipboard: ClipboardAdapter | undefined = undefined;

  /** The items as the text the designer copies to the clipboard (a CopyContent in JSON). */
  public copyItemsToText(items: PrintPosItem[]): string {
    const groupId = 0;
    const copyContent = new CopyContent();
    copyContent.operations = [];
    for (const compo of items) {
      const op = new ChangeObjectOperation(OperationType.Remove, groupId);
      // op.parentName = section.name;
      op.componentClass = compo.className;
      op.componentName = compo.name;
      // op.oldItemIndex = 0;
      this.addComponentProperties(compo, op);
      copyContent.operations?.push(op);
    }
    return JSON.stringify(copyContent, null, 2);
  }
  /**
   * Adds to the section the items of a text copied by copyItemsToText, as one undo step. Returns
   * false, changing nothing, when the text is empty or is not a copy of items.
   */
  public pasteItemsFromText(section: Section, text: string): boolean {
    if (!text) {
      return false;
    }
    const obj = JSON.parse(text);
    if (obj.copyClass != "Items" || !obj.operations) {
      return false;
    }
    const copyContent = obj as CopyContent;
    const groupId = this.undoCue!.getGroupId();
    for (const operation of copyContent.operations!) {
      const comp = Report.newComponentByClassName(operation.componentClass!) as PrintPosItem;
      operation.groupId = groupId;
      operation.parentName = section.name;
      operation.operation = OperationType.Add;
      this.undoCue!.applyPropertiesToObject(operation, comp, false);
      this.newName(comp);
      operation.componentName = comp.name;
      this.components.set(comp.name.toUpperCase(), comp);
      section.components.push(comp);
      this.undoCue!.addOperation(operation, this);
    }
    return true;
  }
  /** Copies the items to the clipboard (the given one or Report.clipboard). */
  public async copyItemsToClipboard(items: PrintPosItem[], clipboard?: ClipboardAdapter) {
    const target = Report.requireClipboard(clipboard);
    await target.writeText(this.copyItemsToText(items));
  }
  /** Pastes into the section the items copied to the clipboard (the given one or Report.clipboard). */
  public async pasteItemsFromClipboard(section: Section, clipboard?: ClipboardAdapter): Promise<boolean> {
    const source = Report.requireClipboard(clipboard);
    const text = await source.readText();
    return this.pasteItemsFromText(section, text);
  }
  private static requireClipboard(clipboard?: ClipboardAdapter): ClipboardAdapter {
    const result = clipboard ?? Report.clipboard;
    if (!result) {
      throw new Error("No clipboard: pass one or set Report.clipboard");
    }
    return result;
  }
  public containsDataInfo(alias: string): boolean {
    for (const dinfo of this.dataInfo) {
      if (alias == dinfo.alias) {
        return true;
      }
    }
    return false;
  }
  public containsParam(alias: string): boolean {
    for (const param of this.params) {
      if (alias == param.alias) {
        return true;
      }
    }
    return false;
  }
  public containsDatabaseInfo(alias: string): boolean {
    for (const dbInfo of this.databaseInfo) {
      if (alias == dbInfo.alias) {
        return true;
      }
    }
    return false;
  }
  private findDatasetName(alias: string): string {
    let idx = 1;
    let result = alias;
    while (this.containsDataInfo(result)) {
      result = alias + "_" + idx.toString();
      idx++;
    }
    return result;
  }
  public import(newReport: Report) {
    const groupId = this.undoCue!.getGroupId();
    for (const dbinfo of newReport.databaseInfo) {
      if (!this.containsDatabaseInfo(dbinfo.alias ?? "")) {
        if (this.components.get(dbinfo.name.toUpperCase()) || !dbinfo.name) {
          this.newName(dbinfo);
        }
        this.addDatabaseInfo(dbinfo, groupId);
      }
    }
    const duplicateDatasets = new Map<string, string>();
    for (const dataInfo of newReport.dataInfo) {
      if (this.containsDataInfo(dataInfo.alias ?? "")) {
        const newDataSetName = this.findDatasetName(dataInfo.alias ?? "");
        duplicateDatasets.set(dataInfo.alias ?? "", newDataSetName);
        dataInfo.alias = newDataSetName;
      }
      if (this.components.get(dataInfo.name.toUpperCase()) || !dataInfo.name) {
        this.newName(dataInfo);
      }
      this.addDataInfo(dataInfo, groupId);
    }
    for (const param of newReport.params) {
      for (const key of duplicateDatasets.keys()) {
        const idxParam = param.datasets.indexOf(key);
        if (idxParam >= 0) {
          param.datasets[idxParam] = duplicateDatasets.get(key) ?? "";
        }
      }
      if (this.containsParam(param.alias ?? "")) {
        // Remove unused datasets
        let i = 0;
        while (i < param.datasets.length) {
          const dsetName = param.datasets[i];
          if (!this.containsDataInfo(dsetName)) {
            param.datasets.splice(i, 1);
          } else {
            i++;
          }
        }
      } else {
        if (this.components.get(param.name.toUpperCase()) || !param.name) {
          this.newName(param);
        }
        this.addParam(param, groupId);
      }
    }
    for (const subrep of newReport.subReports) {
      if (this.components.get(subrep.name.toUpperCase()) || !subrep.name) {
        this.newName(subrep);
      }
      if (subrep.alias) {
        for (const key of duplicateDatasets.keys()) {
          if (subrep.alias == key) {
            subrep.alias = duplicateDatasets.get(key) ?? "";
          }
        }
      }
      const sections = subrep.sections;
      subrep.sections = [];
      this.addSubReport(subrep, groupId);
      for (const section of sections) {
        this.addSection(subrep, section, groupId, undefined);
      }
    }
  }
}

/** A text clipboard: navigator.clipboard has this shape. */
export interface ClipboardAdapter {
  writeText(text: string): Promise<void>;
  readText(): Promise<string>;
}

export class CopyContent {
  public copyClass: CopyClass = "Items";
  public operations?: ChangeObjectOperation[];
}
