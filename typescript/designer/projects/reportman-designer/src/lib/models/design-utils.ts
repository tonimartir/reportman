import {
  BarcodeItem,
  ChangeObjectOperation,
  ChartItem,
  ExpressionItem,
  ImageItem,
  LabelItem,
  PrintItemText,
  PrintPosItem,
  PropertyType,
  Report,
  Section,
  SectionType,
  SubReport,
  TextAlignType,
  TextAlignVerticalType,
} from "@reportman/lib";
import { TranslationService } from "../services/translator.service";
import { MeasureUnitType } from "./report-design-preferences";

export class DesignUtils {
  public static TwipsPerInch = 1440;
  public static CmsPerInch = 2.54;
  public static twipsTopx(twips: number): number {
    // const dpr = window.devicePixelRatio || 1;
    // return (twips * 96.0 * dpr) / DesignUtils.TwipsPerInch;
    return (twips * 96.0) / DesignUtils.TwipsPerInch;
  }
  public static twipsToUnit(twips: number, unit: MeasureUnitType, decimals?: number): number {
    let newValue =
      ((unit == MeasureUnitType.Cm ? DesignUtils.CmsPerInch : 1) * twips) /
      DesignUtils.TwipsPerInch;
    if (decimals != null) {
      newValue = Number(newValue.toFixed(decimals));
    }
    return newValue;
  }
  public static unitToTwips(value: number, unit: MeasureUnitType, decimals?: number): number {
    let newValue =
      (value / (unit == MeasureUnitType.Cm ? DesignUtils.CmsPerInch : 1)) *
      DesignUtils.TwipsPerInch;
    if (decimals != null) {
      newValue = Number(newValue.toFixed(decimals));
    }
    return Math.round(newValue);
  }
  public static pxTotwips(px: number): number {
    return Math.round((px * DesignUtils.TwipsPerInch) / 96.0);
  }
  public static sectionTypeToString(secType: SectionType, groupName?: string) {
    switch (secType) {
      case SectionType.Detail:
        return "Detail";
      case SectionType.GroupHeader:
        return "Header " + groupName?.toString();
      case SectionType.GroupFooter:
        return "Footer " + groupName?.toString();
      case SectionType.PageHeader:
        return "Page Header";
      case SectionType.PageFooter:
        return "Page Footer";
      default:
        throw new Error("Section type no supported: " + secType);
    }
  }
  public static hexColorToNumber(hex: string): number {
    if (hex.startsWith("#")) {
      hex = hex.slice(1);
    }

    const r = parseInt(hex.slice(0, 2), 16);
    const g = parseInt(hex.slice(2, 4), 16);
    const b = parseInt(hex.slice(4, 6), 16);

    return r + (g << 8) + (b << 16);
  }
  public static numberToHexColor(n: number) {
    const r = n & 0xff;
    const g = (n >> 8) & 0xff;
    const b = (n >> 16) & 0xff;

    return (
      "#" +
      r.toString(16).padStart(2, "0") +
      g.toString(16).padStart(2, "0") +
      b.toString(16).padStart(2, "0")
    );
  }
  public static setLanguageText(texts: string[], newValue: string, reportLanguage?: number) {
    let language = (reportLanguage ?? -1) + 1;
    if (language < 0) {
      language = 0;
    }
    let defaultValue = "";
    if (texts.length > 0) {
      defaultValue = texts[0];
    }
    while (texts.length - 1 < language) {
      texts.push(defaultValue);
    }
    texts[language] = newValue;
  }
  public static getLanguageText(strings: string[], reportLanguage?: number): string {
    let language = (reportLanguage ?? -1) + 1;
    if (language < 0) {
      language = 0;
    }
    let text = "";
    if (language < 0) {
      language = 0;
    }
    if (language < strings.length) {
      text = strings[language];
    } else {
      if (strings.length > 0) {
        text = strings[0];
      }
    }
    return text;
  }
  public static getLanguageIndex(reportLanguage?: number): number {
    let language = (reportLanguage ?? -1) + 1;
    if (language < 0) {
      language = 0;
    }
    if (language < 0) {
      language = 0;
    }
    return language;
  }
  public static FontSizeToFabricFontSize(fontSize: number): number {
    return (fontSize * 96) / 72;
  }
  public static getTextDataFromComponent(component: PrintPosItem, report: Report): TextData {
    const resultado: TextData = {
      text: "",
      align: "left",
      valign: "top",
    };
    let textItem: PrintItemText | undefined = undefined;
    switch (component.className) {
      case "TRPLABEL":
        {
          textItem = component as PrintItemText;
          const compLabel = component as LabelItem;
          resultado.text = DesignUtils.getLanguageText(compLabel.allStrings, report.language);
        }
        break;
      case "TRPEXPRESSION":
        {
          textItem = component as PrintItemText;
          const expItem = component as ExpressionItem;
          resultado.text = expItem.expression;
        }
        break;
      case "TRPCHART":
        {
          textItem = component as PrintItemText;
          const chartItem = component as ChartItem;
          resultado.text = chartItem.valueExpression;
        }
        break;
      case "TRPIMAGE":
        {
          const imageItem = component as ImageItem;
          resultado.text = imageItem.expression ?? "";
        }
        break;
      case "TRPBARCODE":
        {
          const barcodeItem = component as BarcodeItem;
          resultado.text = barcodeItem.expression ?? "";
        }
        break;
    }
    if (textItem) {
      resultado.fontFamily = textItem.wFontName;
      resultado.fontSize = DesignUtils.FontSizeToFabricFontSize(textItem.fontSize ?? 10);
      resultado.transparent = textItem.transparent;
      const intfontstyle = textItem.fontStyle;
      resultado.bold = (intfontstyle & 1) > 0;
      resultado.italic = (intfontstyle & 2) > 0;
      resultado.underline = (intfontstyle & 4) > 0;
      resultado.strikeout = (intfontstyle & 8) > 0;
      switch (textItem.alignment) {
        case TextAlignType.Center:
          resultado.align = "center";
          break;
        case TextAlignType.Right:
          resultado.align = "right";
          break;
      }
      switch (textItem.vAlignment) {
        case TextAlignVerticalType.Bottom:
          resultado.valign = "bottom";
          break;
        case TextAlignVerticalType.Center:
          resultado.valign = "center";
          break;
      }
      resultado.fontColor = DesignUtils.numberToHexColor(textItem.fontColor);
      resultado.backColor = DesignUtils.numberToHexColor(textItem.backColor);
      if (!resultado.fontSize) {
        resultado.fontSize = 1;
      }
      if (!resultado.fontFamily) {
        resultado.fontFamily = "Arial";
      }
    } else {
      resultado.fontFamily = "Arial";
      resultado.fontSize = 10;
      resultado.fontColor = "#000000";
      resultado.transparent = true;
    }
    return resultado;
  }
  public static getSubreportDisplayName(
    name: string,
    translator: TranslationService,
    includedataset: boolean,
    alias?: string
  ) {
    let aresult = name;
    if (aresult.length > 11 && aresult.substring(0, 12).toUpperCase() == "TRPSUBREPORT") {
      aresult = translator.TranslateStr(353) + name.substring(12);
    }
    if (includedataset) {
      if (alias && alias.length > 0) {
        aresult = aresult + "(" + alias + ")";
      } else {
        aresult = aresult + "(" + translator.TranslateStr(1148) + ")";
      }
    }
    return aresult;
  }
  public static fontStyleToString(intfontstyle: number, translator: TranslationService): string {
    const styleArray: string[] = [];
    let result = "[";
    if ((intfontstyle & 1) > 0) {
      styleArray.push(translator.TranslateStr(547));
    }
    if ((intfontstyle & 2) > 0) {
      styleArray.push(translator.TranslateStr(549));
    }
    if ((intfontstyle & 4) > 0) {
      styleArray.push(translator.TranslateStr(548));
    }
    if ((intfontstyle & 8) > 0) {
      styleArray.push(translator.TranslateStr(550));
    }
    let idx = 0;
    for (idx = 0; idx < styleArray.length; idx++) {
      if (idx > 0) {
        result = result + ",";
      }
      result = result + styleArray[idx];
    }
    result = result + "]";
    return result;
  }
  public static getSizeDisplayName(size: string | undefined, translator: TranslationService) {
    if (!size) {
      return translator.TranslateStr(294);
    } else {
      return DesignUtils.getSizeAsString(size.length);
    }
  }
  private static getSizeAsString(size: number) {
    if (size < 1024) {
      return size.toFixed(2) + " bytes";
    } else {
      if (size < 1024 * 1024) {
        return (size / 1024).toFixed(2) + " Kbytes";
      } else {
        return (size / 1024 / 1024).toFixed(2) + " Mbytes";
      }
    }
  }
  public static getSectionDisplayName(
    report: Report,
    section: Section,
    addchildsubreport: boolean,
    translator: TranslationService
  ): string {
    const subreport = report.getParentSubReport(section);
    let aresult = "";
    switch (section.sectionType) {
      case SectionType.Detail:
        if (SubReport.detailCount(subreport) > 1) {
          let acount = 1;
          let index = SubReport.firstDetail(subreport);
          while (section != subreport.sections[index]) {
            acount++;
            index++;
            if (index > subreport.sections.length) {
              break;
            }
          }
          aresult = translator.TranslateStr(488) + "_" + acount.toString();
        } else {
          aresult = translator.TranslateStr(488);
        }
        break;
      case SectionType.PageHeader:
        aresult = translator.TranslateStr(484);
        break;
      case SectionType.PageFooter:
        aresult = translator.TranslateStr(491);
        break;
      case SectionType.GroupHeader:
        aresult = translator.TranslateStr(489) + " - " + section.groupName;
        break;
      case SectionType.GroupFooter:
        aresult = translator.TranslateStr(490) + " - " + section.groupName;
        break;
    }
    if (addchildsubreport) {
      if (section.childSubReportName) {
        const childSubreport = Report.subreportByName(report, section.childSubReportName);
        if (childSubreport != null) {
          aresult =
            aresult +
            "(" +
            DesignUtils.getSubreportDisplayName(childSubreport.name, translator, false, undefined) +
            ")";
        }
      }
    }
    return aresult;
  }
  public static initText(report: Report, itemText: PrintItemText, op: ChangeObjectOperation) {
    itemText.wFontName = report.wFontName;
    op.addProperty("wFontName", PropertyType.String, undefined, itemText.wFontName);
    itemText.lFontName = report.wFontName;
    op.addProperty("lFontName", PropertyType.String, undefined, itemText.lFontName);
    itemText.fontColor = report.fontColor;
    op.addProperty("fontColor", PropertyType.Integer, undefined, itemText.fontColor);
    itemText.backColor = report.backColor;
    op.addProperty("backColor", PropertyType.Integer, undefined, itemText.backColor);
    itemText.fontSize = report.fontSize;
    op.addProperty("fontSize", PropertyType.Integer, undefined, itemText.fontSize);
    itemText.fontRotation = report.fontRotation ?? 0;
    op.addProperty("fontRotation", PropertyType.Integer, undefined, itemText.fontRotation);
    itemText.fontStyle = report.fontStyle ?? 0;
    op.addProperty("fontStyle", PropertyType.Integer, undefined, itemText.fontStyle);
    itemText.alignment = report.alignment;
    op.addProperty("alignment", PropertyType.Integer, undefined, itemText.alignment);
    itemText.vAlignment = report.vAlignment;
    op.addProperty("vAlignment", PropertyType.Integer, undefined, itemText.vAlignment);
    itemText.cutText = report.cutText;
    op.addProperty("cutText", PropertyType.Boolean, undefined, itemText.cutText);
    itemText.wordWrap = report.wordWrap;
    op.addProperty("wordWrap", PropertyType.Boolean, undefined, itemText.wordWrap);
  }
}
export interface TextData {
  text?: string;
  fontSize?: number;
  fontFamily?: string;
  fontColor?: string;
  bold?: boolean;
  italic?: boolean;
  underline?: boolean;
  strikeout?: boolean;
  backColor?: string;
  transparent?: boolean;
  align: "left" | "right" | "center";
  valign: "top" | "center" | "bottom";
}
