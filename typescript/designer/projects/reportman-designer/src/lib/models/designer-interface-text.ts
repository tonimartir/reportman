import { ReportItem, Report, PrintItemText } from "@reportman/lib";
import { IObjectInspector } from "../interfaces/object-inspector.interface";
import { TranslationService } from "../services/translator.service";
import { DesignerInterfaceSizePos } from "./designer-interface-size-pos";

export class DesignerInterfaceText extends DesignerInterfaceSizePos {
  private FPrintItemText?: PrintItemText;

  constructor(
    nreport: Report,
    nrepitem: Map<number, ReportItem>,
    nobjinsp: IObjectInspector,
    ntranslator: TranslationService
  ) {
    super(nreport, nrepitem, nobjinsp, ntranslator);
    if (nrepitem.size >= 0) {
      this.FPrintItemText = nrepitem.values().next().value as PrintItemText;
    }
  }

  public get printItemTextObject(): PrintItemText {
    if (!this.FPrintItemText) {
      throw new Error("Item not assigned");
    }
    return this.FPrintItemText;
  }

  public override GetProperties(
    lnames: string[],
    llabels: string[],
    ltypes: string[],
    lvalues: any[] | null,
    lhints: string[],
    lcat: string[],
    lorder?: (number | null)[] | null
  ): void {
    if (!this.FPrintItemText) {
      throw new Error("Item not assigned");
    }
    super.GetProperties(lnames, llabels, ltypes, lvalues, lhints, lcat, lorder);

    const cat = this.translator.TranslateStr(1202);
    const hint = "refcommontext.html";

    const push = (propName: string, labelId: number, typeId: number, value: any) => {
      lnames.push(propName);
      llabels.push(this.translator.TranslateStr(labelId));
      ltypes.push(this.translator.TranslateStr(typeId));
      lhints.push(hint);
      lcat.push(cat);
      lvalues?.push(value);
      lorder?.push(null);
    };

    push("alignment", 628, 569, this.getValueInteger("alignment")); // H. Alignment
    push("vAlignment", 629, 569, this.getValueInteger("vAlignment")); // V. Alignment
    push("wFontName", 560, 560, this.getValueString("wFontName")); // Windows Font
    push("lFontName", 561, 561, this.getValueString("lFontName")); // Linux Font
    push("type1Font", 562, 569, this.getValueInteger("type1Font")); // PDF Font
    push("printStep", 1039, 569, this.getValueInteger("printStep")); // Font Step
    push("fontSize", 563, 559, this.getValueInteger("fontSize")); // Font Size
    push("fontColor", 564, 558, this.getValueInteger("fontColor")); // Font Color
    push("backColor", 565, 558, this.getValueBoolean("backColor")); // Background
    push("fontStyle", 566, 566, this.getValueInteger("fontStyle")); // Font Style
    push("transparent", 567, 568, this.getValueBoolean("transparent")); // Transparent
    push("cutText", 625, 568, this.getValueBoolean("cutText")); // Cut Text
    push("wordWrap", 626, 568, this.getValueBoolean("wordWrap")); // Word Wrap
    // IsHtml - uses literal label like .NET (no translation ID assigned)
    lnames.push("isHtml");
    llabels.push("IsHtml");
    ltypes.push(this.translator.TranslateStr(568));
    lhints.push(hint);
    lcat.push(cat);
    lvalues?.push(this.getValueBoolean("isHtml"));
    lorder?.push(null);
    push("singleLine", 627, 568, this.getValueBoolean("singleLine")); // Single Line
    push("rightToLeft", 954, 568, this.getValueBoolean("rightToLeft")); // RTL
    push("fontRotation", 551, 559, (this.getValueInteger("fontRotation") as number) / 10); // Font Rotation
  }

  public override GetPropertyValues(pname: string, lpossiblevalues: string[]): void {
    if (pname === "alignment") {
      lpossiblevalues.push(this.translator.TranslateStr(631));
      lpossiblevalues.push(this.translator.TranslateStr(632));
      lpossiblevalues.push(this.translator.TranslateStr(633));
      lpossiblevalues.push(this.translator.TranslateStr(1113));
      return;
    }

    if (pname === "vAlignment") {
      lpossiblevalues.push(this.translator.TranslateStr(634));
      lpossiblevalues.push(this.translator.TranslateStr(635));
      lpossiblevalues.push(this.translator.TranslateStr(633));
      return;
    }

    if (pname === "type1Font") {
      lpossiblevalues.push("Helvetica");
      lpossiblevalues.push("Courier");
      lpossiblevalues.push("Times Roman");
      lpossiblevalues.push("Symbol");
      lpossiblevalues.push("ZafDingbats");
      lpossiblevalues.push("Truetype Link");
      lpossiblevalues.push("Truetype Embed");
      return;
    }

    if (pname === "printStep") {
      lpossiblevalues.push(this.translator.TranslateStr(1038));
      lpossiblevalues.push("20 cpi");
      lpossiblevalues.push("17 cpi");
      lpossiblevalues.push("15 cpi");
      lpossiblevalues.push("12 cpi");
      lpossiblevalues.push("10 cpi");
      lpossiblevalues.push("6 cpi");
      lpossiblevalues.push("5 cpi");
      return;
    }

    super.GetPropertyValues(pname, lpossiblevalues);
  }

  public override SetProperty(pname: string, newvalue: any): void {
    if (!this.FPrintItemText) {
      throw new Error("Item not assigned");
    }
    switch (pname) {
      case "alignment":
      case "vAlignment":
      case "wFontName":
      case "lFontName":
      case "type1Font":
      case "printStep":
      case "fontSize":
      case "fontColor":
      case "fontStyle":
      case "backColor":
      case "rightToLeft":
      case "transparent":
      case "cutText":
      case "wordWrap":
      case "isHtml":
      case "singleLine":
        this.setValue(pname, newvalue);
        return;
      case "fontRotation":
        // The inspector works in degrees; the report keeps tenths of a degree (GetProperty divides)
        this.setValue(pname, Math.round(Number(newvalue) * 10));
        return;
      default:
        super.SetProperty(pname, newvalue);
        break;
    }
  }
  public override GetProperty(pname: string): any {
    if (!this.FPrintItemText) {
      throw new Error("Item not assigned");
    }

    switch (pname) {
      case "alignment":
      case "vAlignment":
      case "type1Font":
      case "printStep":
      case "fontSize":
      case "fontColor":
      case "fontStyle":
      case "backColor":
        return this.getValueInteger(pname);
      case "wFontName":
      case "lFontName":
        return this.getValueString(pname);

      case "rightToLeft":
      case "transparent":
      case "cutText":
      case "wordWrap":
      case "isHtml":
      case "singleLine":
        return this.getValueBoolean(pname);
      case "fontRotation":
        return (this.getValueInteger(pname) as number) / 10;
      default:
        return super.GetProperty(pname);
    }
  }

  public override SetItem(nitem: ReportItem): void {
    if (nitem) {
      this.FPrintItemText = nitem as PrintItemText;
    }

    super.SetItem(nitem);
  }
}
