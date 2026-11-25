import { ReportItem, Report, ShapeItem, ShapeType, PenType, BrushType } from "@reportman/lib";
import { IObjectInspector } from "../interfaces/object-inspector.interface";
import { DesignerInterfaceSizePos } from "./designer-interface-size-pos";
import { TranslationService } from "../services/translator.service";

export class DesignerInterfaceShape extends DesignerInterfaceSizePos {
  constructor(
    nreport: Report,
    nrepitem: Map<number, ReportItem>,
    nobjinsp: IObjectInspector,
    ntranslator: TranslationService
  ) {
    super(nreport, nrepitem, nobjinsp, ntranslator);
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

    lnames.push("shape");
    llabels.push(this.translator.TranslateStr(643));
    ltypes.push(this.translator.TranslateStr(569));
    lhints.push("refdraw.html");
    lcat.push(this.translator.TranslateStr(643));
    lvalues?.push(this.getValueInteger("shape"));
    lorder?.push(1);

    lnames.push("penStyle");
    llabels.push(this.translator.TranslateStr(646));
    ltypes.push(this.translator.TranslateStr(569));
    lhints.push("refdraw.html");
    lcat.push(this.translator.TranslateStr(643));
    lvalues?.push(this.getValueInteger("penStyle"));
    lorder?.push(2);

    lnames.push("penColor");
    llabels.push(this.translator.TranslateStr(647));
    ltypes.push(this.translator.TranslateStr(558));
    lhints.push("refdraw.html");
    lcat.push(this.translator.TranslateStr(643));
    lvalues?.push(this.getValueInteger("penColor"));
    lorder?.push(3);

    lnames.push("penWidth");
    llabels.push(this.translator.TranslateStr(648));
    ltypes.push(this.translator.TranslateStr(556));
    lhints.push("refdraw.html");
    lcat.push(this.translator.TranslateStr(643));
    lvalues?.push(this.getValueInteger("penWidth"));
    lorder?.push(4);

    lnames.push("brushStyle");
    llabels.push(this.translator.TranslateStr(644));
    ltypes.push(this.translator.TranslateStr(569));
    lhints.push("refdraw.html");
    lcat.push(this.translator.TranslateStr(643));
    lvalues?.push(this.getValueInteger("brushStyle"));
    lorder?.push(5);

    lnames.push("brushColor");
    llabels.push(this.translator.TranslateStr(645));
    ltypes.push(this.translator.TranslateStr(558));
    lhints.push("refdraw.html");
    lcat.push(this.translator.TranslateStr(643));
    lvalues?.push(this.getValueInteger("brushColor"));
    lorder?.push(6);
  }

  public override GetProperty(pname: string): any {
    switch (pname) {
      case "shape":
      case "penStyle":
      case "penColor":
      case "penWidth":
      case "brushStyle":
      case "brushColor":
        return this.getValueInteger(pname);
      default:
        return super.GetProperty(pname);
    }
  }

  public override SetProperty(pname: string, newvalue: any): void {
    switch (pname) {
      case "shape":
      case "penStyle":
      case "penColor":
      case "penWidth":
      case "brushStyle":
      case "brushColor":
        this.setValue(pname, newvalue);
        return;
    }
    super.SetProperty(pname, newvalue);
  }

  public override GetPropertyValues(pname: string, lpossiblevalues: string[]): void {
    if (pname === "shape") {
      lpossiblevalues.push(this.translator.TranslateStr(606));
      lpossiblevalues.push(this.translator.TranslateStr(609));
      lpossiblevalues.push(this.translator.TranslateStr(607));
      lpossiblevalues.push(this.translator.TranslateStr(608));
      lpossiblevalues.push(this.translator.TranslateStr(605));
      lpossiblevalues.push(this.translator.TranslateStr(604));
      lpossiblevalues.push(this.translator.TranslateStr(306));
      lpossiblevalues.push(this.translator.TranslateStr(307));
      lpossiblevalues.push(this.translator.TranslateStr(719));
      lpossiblevalues.push(this.translator.TranslateStr(720));
      return;
    }
    if (pname === "penStyle") {
      lpossiblevalues.push(this.translator.TranslateStr(598));
      lpossiblevalues.push(this.translator.TranslateStr(599));
      lpossiblevalues.push(this.translator.TranslateStr(600));
      lpossiblevalues.push(this.translator.TranslateStr(601));
      lpossiblevalues.push(this.translator.TranslateStr(602));
      lpossiblevalues.push(this.translator.TranslateStr(603));
      return;
    }
    if (pname === "brushStyle") {
      lpossiblevalues.push(this.translator.TranslateStr(583));
      lpossiblevalues.push(this.translator.TranslateStr(584));
      lpossiblevalues.push(this.translator.TranslateStr(585));
      lpossiblevalues.push(this.translator.TranslateStr(586));
      lpossiblevalues.push(this.translator.TranslateStr(587));
      lpossiblevalues.push(this.translator.TranslateStr(588));
      lpossiblevalues.push(this.translator.TranslateStr(589));
      lpossiblevalues.push(this.translator.TranslateStr(590));
      lpossiblevalues.push(this.translator.TranslateStr(591));
      lpossiblevalues.push(this.translator.TranslateStr(592));
      lpossiblevalues.push(this.translator.TranslateStr(593));
      lpossiblevalues.push(this.translator.TranslateStr(594));
      lpossiblevalues.push(this.translator.TranslateStr(595));
      lpossiblevalues.push(this.translator.TranslateStr(596));
      lpossiblevalues.push(this.translator.TranslateStr(597));
      return;
    }
    super.GetPropertyValues(pname, lpossiblevalues);
  }
}
