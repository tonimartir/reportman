import { ReportItem, Report, PrintPosItem, PrintItemAlign } from "@reportman/lib";
import { IObjectInspector } from "../interfaces/object-inspector.interface";
import { DesignerInterfaceSize } from "./designer-interface-size";
import { TranslationService } from "../services/translator.service";

export class DesignerInterfaceSizePos extends DesignerInterfaceSize {
  private FPrintPosItemObject?: PrintPosItem;

  constructor(
    nreport: Report,
    nrepitem: Map<number, ReportItem>,
    nobjinsp: IObjectInspector,
    translator: TranslationService
  ) {
    super(nreport, nrepitem, nobjinsp, translator);
    if (nrepitem.size >= 0) {
      this.FPrintPosItemObject = nrepitem.values().next().value as PrintPosItem;
    }
  }

  public get PrintPosItemObject(): PrintPosItem {
    if (!this.FPrintPosItemObject) {
      throw new Error("Item Not assigned");
    }
    return this.FPrintPosItemObject;
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
    super.GetProperties(lnames, llabels, ltypes, lvalues, lhints, lcat, lorder);
    if (!this.FPrintPosItemObject) {
      throw new Error("Item Not assigned");
    }

    lnames.push("posX");
    llabels.push(this.translator.TranslateStr(553));
    ltypes.push("TWIPS");
    lhints.push("refcommon.html");
    lcat.push(this.translator.TranslateStr(1201));
    if (lvalues) {
      lvalues.push(this.getValueInteger("posX"));
    }
    lorder?.push(null);

    lnames.push("posY");
    llabels.push(this.translator.TranslateStr(552));
    ltypes.push("TWIPS");
    lhints.push("refcommon.html");
    lcat.push(this.translator.TranslateStr(1201));
    if (lvalues) {
      lvalues.push(this.getValueInteger("posY"));
    }
    lorder?.push(null);

    lnames.push("align");
    llabels.push(this.translator.TranslateStr(623));
    ltypes.push(this.translator.TranslateStr(569));
    lhints.push("refcommon.html");
    lcat.push(this.translator.TranslateStr(1201));
    if (lvalues) {
      lvalues.push(this.getValueInteger("align"));
    }
    lorder?.push(null);

    lnames.push("annotationExpression");
    llabels.push(this.translator.TranslateStr(1480));
    ltypes.push(this.translator.TranslateStr(571));
    lhints.push("refcommon.html");
    lcat.push(this.translator.TranslateStr(1201));
    if (lvalues) {
      lvalues.push(this.getValueString("annotationExpression"));
    }
    lorder?.push(null);
  }

  public override GetPropertyValues(pname: string, lpossiblevalues: string[]): void {
    if (!this.FPrintPosItemObject) {
      throw new Error("Item Not assigned");
    }
    if (pname === "align") {
      lpossiblevalues.push(this.translator.TranslateStr(294));
      lpossiblevalues.push(this.translator.TranslateStr(621));
      lpossiblevalues.push(this.translator.TranslateStr(622));
      lpossiblevalues.push(
        this.translator.TranslateStr(621) + "/" + this.translator.TranslateStr(622)
      );
      lpossiblevalues.push(this.translator.TranslateStr(1224));
      lpossiblevalues.push(this.translator.TranslateStr(1225));
      lpossiblevalues.push(this.translator.TranslateStr(1226));
      return;
    }
    super.GetPropertyValues(pname, lpossiblevalues);
  }

  public override SetProperty(pname: string, newvalue: any): void {
    if (!this.FPrintPosItemObject) {
      throw new Error("Item Not assigned");
    }
    switch (pname) {
      case "posX":
      case "posY":
      case "align":
      case "annotationExpression":
        this.setValue(pname, newvalue);
        return;
    }
    super.SetProperty(pname, newvalue);
  }

  public override SetItem(nitem: ReportItem): void {
    this.FPrintPosItemObject = nitem as PrintPosItem;
    super.SetItem(nitem);
  }

  public override GetProperty(pname: string): any {
    switch (pname) {
      case "posX":
      case "posY":
      case "align":
        return this.getValueInteger("align");
      case "annotationExpression":
        return this.getValueString("annotationExpression");
    }
    return super.GetProperty(pname);
  }

  public StringToPrintItemAlign(text: string): PrintItemAlign {
    if (text === this.translator.TranslateStr(621)) {
      return PrintItemAlign.Bottom;
    }
    if (text === this.translator.TranslateStr(622)) {
      return PrintItemAlign.Right;
    }
    if (text === this.translator.TranslateStr(621) + "/" + this.translator.TranslateStr(622)) {
      return PrintItemAlign.BottomRight;
    }
    if (text === this.translator.TranslateStr(1224)) {
      return PrintItemAlign.LeftRight;
    }
    if (text === this.translator.TranslateStr(1225)) {
      return PrintItemAlign.TopBottom;
    }
    if (text === this.translator.TranslateStr(1226)) {
      return PrintItemAlign.AllClient;
    }
    return PrintItemAlign.None;
  }

  public PrintItemAlignToString(align: PrintItemAlign): string {
    switch (align) {
      case PrintItemAlign.None:
        return this.translator.TranslateStr(294);
      case PrintItemAlign.Bottom:
        return this.translator.TranslateStr(621);
      case PrintItemAlign.Right:
        return this.translator.TranslateStr(622);
      case PrintItemAlign.BottomRight:
        return this.translator.TranslateStr(621) + "/" + this.translator.TranslateStr(622);
      case PrintItemAlign.LeftRight:
        return this.translator.TranslateStr(1224);
      case PrintItemAlign.TopBottom:
        return this.translator.TranslateStr(1225);
      case PrintItemAlign.AllClient:
        return this.translator.TranslateStr(1226);
    }
  }
}
