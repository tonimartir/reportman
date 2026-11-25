import { ImageItem, Report, ReportItem } from "@reportman/lib";
import { IObjectInspector } from "../interfaces/object-inspector.interface";
import { TranslationService } from "../services/translator.service";
import { DesignerInterfaceSizePos } from "./designer-interface-size-pos";

export class DesignerInterfaceImage extends DesignerInterfaceSizePos {
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

    lnames.push("expression");
    llabels.push(this.translator.TranslateStr(571));
    ltypes.push(this.translator.TranslateStr(571));
    lhints.push("refimage.html");
    lcat.push(this.translator.TranslateStr(639));
    lvalues?.push(this.getValueString("expression"));
    lorder?.push(1);

    lnames.push("streamBase64");
    llabels.push(this.translator.TranslateStr(639));
    ltypes.push(this.translator.TranslateStr(639));
    lhints.push("refimage.html");
    lcat.push(this.translator.TranslateStr(639));
    lvalues?.push(this.getValueString("streamBase64"));
    lorder?.push(2);

    lnames.push("drawStyle");
    llabels.push(this.translator.TranslateStr(667));
    ltypes.push(this.translator.TranslateStr(569));
    lhints.push("refimage.html");
    lcat.push(this.translator.TranslateStr(639));
    lvalues?.push(this.getValueInteger("drawStyle"));
    lorder?.push(3);

    lnames.push("dpires");
    llabels.push(this.translator.TranslateStr(666));
    ltypes.push(this.translator.TranslateStr(559));
    lhints.push("refimage.html");
    lcat.push(this.translator.TranslateStr(639));
    lvalues?.push(this.getValueInteger("dpires"));
    lorder?.push(4);

    lnames.push("sharedImage");
    llabels.push(this.translator.TranslateStr(1409));
    ltypes.push(this.translator.TranslateStr(569));
    lhints.push("refimage.html");
    lcat.push(this.translator.TranslateStr(639));
    lvalues?.push(this.getValueInteger("sharedImage"));
    lorder?.push(5);
  }
  public override GetProperty(pname: string): any {
    switch (pname) {
      case "drawStyle":
      case "dpires":
      case "sharedImage":
        return this.getValueInteger(pname);
      case "expression":
      case "streamBase64":
        return this.getValueString(pname);
      default:
        return super.GetProperty(pname);
    }
  }

  public override GetPropertyValues(pname: string, lpossiblevalues: string[]): void {
    if (pname === "drawStyle") {
      lpossiblevalues.push(this.translator.TranslateStr(633));
      lpossiblevalues.push(this.translator.TranslateStr(637));
      lpossiblevalues.push(this.translator.TranslateStr(638));
      lpossiblevalues.push(this.translator.TranslateStr(668));
      lpossiblevalues.push(this.translator.TranslateStr(1326));
      return;
    }
    if (pname === "sharedImage") {
      lpossiblevalues.push(this.translator.TranslateStr(294));
      lpossiblevalues.push(this.translator.TranslateStr(1420));
      lpossiblevalues.push(this.translator.TranslateStr(1421));
      return;
    }
    super.GetPropertyValues(pname, lpossiblevalues);
  }

  public override SetProperty(pname: string, newvalue: any): void {
    switch (pname) {
      case "drawStyle":
      case "dpires":
      case "sharedImage":
      case "expression":
      case "streamBase64":
        this.setValue(pname, newvalue);
        break;
      default:
        super.SetProperty(pname, newvalue);
    }
  }
}
