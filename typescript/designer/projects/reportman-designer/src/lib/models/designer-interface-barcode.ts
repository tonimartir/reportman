import { ReportItem, Report, BarcodeItem } from "@reportman/lib";
import { IObjectInspector } from "../interfaces/object-inspector.interface";
import { TranslationService } from "../services/translator.service";
import { DesignerInterfaceSizePos } from "./designer-interface-size-pos";
export class DesignerInterfaceBarcode extends DesignerInterfaceSizePos {
  private FPrintItemBarcode?: BarcodeItem;

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

    const cat = this.translator.TranslateStr(1209);
    const hint = "refbarcode.html";
    const push = (propName: string, id: number, typeId: number, value: any) => {
      lnames.push(propName);
      llabels.push(this.translator.TranslateStr(id));
      ltypes.push(this.translator.TranslateStr(typeId));
      lhints.push(hint);
      lcat.push(cat);
      if (lvalues) {
        lvalues.push(value);
      }
      lorder?.push(null);
    };

    push("expression", 571, 571, this.getValueString("expression"));
    push("barType", 577, 569, this.getValueInteger("barType"));
    push("checksum", 579, 568, this.getValueBoolean("checksum"));
    push("modul", 580, 556, this.getValueNumber("modul"));
    push("ratio", 581, 1171, this.getValueNumber("ratio"));
    push("displayFormat", 574, 557, this.getValueString("displayFormat"));
    const rotation = this.getValueNumber("rotation");
    push("rotation", 908, 569, rotation != undefined ? Math.floor(rotation / 900) : undefined);
    push("bColor", 564, 558, this.getValueInteger("bColor"));
    push("backColor", 565, 558, this.getValueInteger("backColor"));
    push("transparent", 567, 568, this.getValueBoolean("transparent"));
    const eccLevel = this.getValueInteger("eccLevel");
    push("eccLevel", 1335, 569, eccLevel != undefined ? eccLevel + 1 : undefined);
    push("numRows", 1336, 559, this.getValueInteger("numRows"));
    push("numColumns", 1337, 559, this.getValueInteger("numColumns"));
    push("truncated", 1338, 568, this.getValueBoolean("truncated"));
  }

  public override GetProperty(pname: string): any {
    switch (pname) {
      case "expression":
      case "displayFormat":
        return this.getValueString(pname);
      case "barType":
      case "checksum":
      case "transparent":
      case "truncated":
        return this.getValueBoolean(pname);
      case "ratio":
      case "modul":
        return this.getValueNumber(pname);
      case "rotation": {
        const rotation = this.getValueNumber(pname);
        return rotation != undefined ? Math.floor(rotation / 900) : undefined;
      }
      case "bColor":
      case "backColor":
      case "numRows":
      case "numColumns":
        return this.getValueInteger(pname);
      case "eccLevel": {
        const eccLevel = this.getValueInteger(pname);
        return eccLevel != undefined ? eccLevel + 1 : undefined;
      }
      default:
        return super.GetProperty(pname);
    }
  }
  public override SetProperty(pname: string, newvalue: any): void {
    switch (pname) {
      case "expression":
      case "barType":
      case "checksum":
      case "modul":
      case "ratio":
      case "displayFormat":
      case "bColor":
      case "backColor":
      case "transparent":
      case "numRows":
      case "numColumns":
      case "truncated":
        this.setValue(pname, newvalue);
        break;
      case "eccLevel":
        // The list shows Auto first (the report's -1), then the levels from 0: GetProperty adds one
        this.setValue(pname, Number(newvalue) - 1);
        break;
      case "rotation":
        switch (newvalue) {
          case 1:
            this.setValue(pname, 900);
            break;
          case 2:
            this.setValue(pname, 1800);
            break;
          case 3:
            this.setValue(pname, 2700);
            break;
          default:
            this.setValue(pname, 0);
            break;
        }
        break;
      default:
        super.SetProperty(pname, newvalue);
        break;
    }
  }

  public override GetPropertyValues(pname: string, lpossiblevalues: string[]): void {
    if (pname === "barType") {
      lpossiblevalues.push(
        "Code 2 5 interleaved",
        "Code 2 5 industrial",
        "Code 2 5 matrix",
        "Code 39",
        "Code 39 Extended",
        "Code 128A",
        "Code 128B",
        "Code 128C",
        "Code128",
        "Code 93",
        "Code 93 Extended",
        "Code MSI",
        "Code PostNet",
        "Code CodaBar",
        "Code EAN8",
        "Code EAN13",
        "Code PDF417",
        "Code QR"
      );
    } else if (pname === "rotation") {
      lpossiblevalues.push("0", "90", "180", "270");
    } else if (pname === "eccLevel") {
      lpossiblevalues.push(
        "Auto",
        "Level 0",
        "Level 1",
        "Level 2",
        "Level 3",
        "Level 4",
        "Level 5",
        "Level 6",
        "Level 7",
        "Level 8"
      );
    } else {
      super.GetPropertyValues(pname, lpossiblevalues);
    }
  }
}
