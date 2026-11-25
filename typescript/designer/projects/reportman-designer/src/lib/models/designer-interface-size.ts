import { ReportItem, PrintItem, Report } from "@reportman/lib";
import { DesignerInterface } from "./designer-interface";
import { IObjectInspector } from "../interfaces/object-inspector.interface";
import { TranslationService } from "../services/translator.service";

export class DesignerInterfaceSize extends DesignerInterface {
  private FPrintItemObject?: PrintItem;
  private FLeft = 0;
  private FTop = 0;
  private FWidth = 0;
  private FHeight = 0;
  private FScale = 1.0;
  private FSelected = false;

  constructor(
    report: Report,
    repitem: Map<number, ReportItem>,
    objinsp: IObjectInspector,
    translator: TranslationService
  ) {
    super(report, repitem, objinsp, translator);
    if (repitem.size >= 0) {
      this.FPrintItemObject = repitem.values().next().value as PrintItem;
    }
  }

  public get PrintItemObject(): PrintItem {
    if (!this.FPrintItemObject) {
      throw new Error("PrintItem not assigned");
    }
    return this.FPrintItemObject;
  }

  public get Left(): number {
    return this.FLeft;
  }
  public get Top(): number {
    return this.FTop;
  }
  public get Width(): number {
    return this.FWidth;
  }
  public get Height(): number {
    return this.FHeight;
  }

  protected SetSelected(newvalue: boolean): void {
    this.FSelected = newvalue;
  }

  public SetBounds(newleft: number, newwidth: number, newtop: number, newheight: number): void {
    this.FLeft = newleft;
    this.FWidth = newwidth;
    this.FTop = newtop;
    this.FHeight = newheight;
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
    lnames.splice(0, lnames.length);
    llabels.splice(0, lnames.length);
    ltypes.splice(0, lnames.length);
    lhints.splice(0, lnames.length);
    lcat.splice(0, lnames.length);
    if (lvalues) {
      lvalues.length = 0;
    }
    if (lorder) {
      lorder.length = 0;
    }

    lnames.push("printCondition");
    llabels.push(this.translator.TranslateStr(614));
    ltypes.push(this.translator.TranslateStr(571));
    lhints.push("refcommon.html");
    lcat.push(this.translator.TranslateStr(1201));
    if (lvalues) {
      lvalues.push(this.getValueString("printCondition"));
    }
    lorder?.push(null);

    lnames.push("doBeforePrint");
    llabels.push(this.translator.TranslateStr(613));
    ltypes.push(this.translator.TranslateStr(571));
    lhints.push("refcommon.html");
    lcat.push(this.translator.TranslateStr(1201));
    if (lvalues) {
      lvalues.push(this.getValueString("doBeforePrint"));
    }
    lorder?.push(null);

    lnames.push("doAfterPrint");
    llabels.push(this.translator.TranslateStr(612));
    ltypes.push(this.translator.TranslateStr(571));
    lhints.push("refcommon.html");
    lcat.push(this.translator.TranslateStr(1201));
    if (lvalues) {
      lvalues.push(this.getValueString("doAfterPrint"));
    }
    lorder?.push(null);

    lnames.push("width");
    llabels.push(this.translator.TranslateStr(554));
    ltypes.push("TWIPS");
    lhints.push("refcommon.html");
    lcat.push(this.translator.TranslateStr(1201));
    if (lvalues) {
      lvalues.push(this.getValueInteger("width"));
    }
    lorder?.push(null);

    lnames.push("height");
    llabels.push(this.translator.TranslateStr(555));
    ltypes.push("TWIPS");
    lhints.push("refcommon.html");
    lcat.push(this.translator.TranslateStr(1201));
    if (lvalues) {
      lvalues.push(this.getValueInteger("height"));
    }
    lorder?.push(null);
  }

  public override SetItem(nitem: ReportItem): void {
    this.FPrintItemObject = nitem as PrintItem;
    super.SetItem(nitem);
  }

  public override GetProperty(pname: string): any {
    switch (pname) {
      case "printCondition":
      case "doBeforePrint":
      case "doAfterPrint":
        return this.getValueString(pname);
      case "width":
      case "height":
        return this.getValueInteger(pname);
    }
    return super.GetProperty(pname);
  }

  public override SetProperty(pname: string, newvalue: any): void {
    switch (pname) {
      case "printCondition":
      case "doBeforePrint":
      case "doAfterPrint":
      case "width":
      case "height":
        this.setValue(pname, newvalue);
        return;
    }
    super.SetProperty(pname, newvalue);
  }
}
