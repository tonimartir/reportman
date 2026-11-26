import { ReportItem, Report, SectionType } from "@reportman/lib";
import { IObjectInspector } from "../interfaces/object-inspector.interface";
import { TranslationService } from "../services/translator.service";
import { DesignerInterfaceText } from "./designer-interface-text";

// The "dataType" dropdown (see GetPropertyValues) lists its options in a curated order
// [Unknown, String, Integer, Float, Currency, Date, DateTime, Time, Boolean] that does NOT match the
// ParamType enum integer order. The object inspector binds a list property by the POSITION of the
// value within the options list, so we must translate between the ParamType value and that position.
// Index in the dropdown -> ParamType numeric value:
const DATATYPE_INDEX_TO_PARAMTYPE = [16, 0, 1, 2, 6, 3, 5, 4, 7];

/**
 * The properties of an expression. The six of the plain text export (Export Expression, Exp. Format,
 * Exp. Line, Exp. Position, Exp. Size, Exp. New Line), which the Delphi designer shows, are left out
 * on purpose (26-11-2026): very rarely used, hard to adjust, and no export of the TypeScript engine
 * reads them. They stay in the model (deprecated) so a report keeps them; until somebody asks for them.
 */
export class DesignerInterfaceExpression extends DesignerInterfaceText {
  constructor(
    nreport: Report,
    nrepitem: Map<number, ReportItem>,
    nobjinsp: IObjectInspector,
    ntranslator: TranslationService
  ) {
    super(nreport, nrepitem, nobjinsp, ntranslator);
  }

  // Map a ParamType value to its position in the dataType dropdown (falls back to "Unknown").
  private dataTypeToIndex(paramType: number | undefined): number | undefined {
    if (paramType == undefined) {
      return undefined;
    }
    const index = DATATYPE_INDEX_TO_PARAMTYPE.indexOf(paramType);
    return index >= 0 ? index : 0;
  }

  // Map a dataType dropdown position back to its ParamType value (falls back to Unknown = 16).
  private indexToDataType(index: number): number {
    return index >= 0 && index < DATATYPE_INDEX_TO_PARAMTYPE.length
      ? DATATYPE_INDEX_TO_PARAMTYPE[index]
      : 16;
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

    const cat = this.translator.TranslateStr(571);
    const hint = "refexpression.html";

    lnames.push("expression");
    llabels.push(this.translator.TranslateStr(571));
    ltypes.push(this.translator.TranslateStr(571));
    lhints.push(hint);
    lcat.push(cat);
    if (lvalues) {
      lvalues.push(this.getValueString("expression"));
    }
    lorder?.push(null);

    lnames.push("dataType");
    llabels.push(this.translator.TranslateStr(892));
    ltypes.push(this.translator.TranslateStr(569));
    lhints.push(hint);
    lcat.push(cat);
    if (lvalues) {
      lvalues.push(this.dataTypeToIndex(this.getValueInteger("dataType")));
    }
    lorder?.push(null);

    lnames.push("displayFormat");
    llabels.push(this.translator.TranslateStr(574));
    ltypes.push(this.translator.TranslateStr(557));
    lhints.push(hint);
    lcat.push(cat);
    if (lvalues) {
      lvalues.push(this.getValueString("displayFormat"));
    }
    lorder?.push(null);

    lnames.push("multiPage");
    llabels.push(this.translator.TranslateStr(958));
    ltypes.push(this.translator.TranslateStr(568));
    lhints.push(hint);
    lcat.push(cat);
    if (lvalues) {
      lvalues.push(this.getValueBoolean("multiPage"));
    }
    lorder?.push(null);

    lnames.push("printNulls");
    llabels.push(this.translator.TranslateStr(941));
    ltypes.push(this.translator.TranslateStr(568));
    lhints.push(hint);
    lcat.push(cat);
    if (lvalues) {
      lvalues.push(this.getValueBoolean("printNulls"));
    }
    lorder?.push(null);

    lnames.push("identifier");
    llabels.push(this.translator.TranslateStr(304));
    ltypes.push(this.translator.TranslateStr(557));
    lhints.push(hint);
    lcat.push(this.translator.TranslateStr(1207));
    if (lvalues) {
      lvalues.push(this.getValueString("identifier"));
    }
    lorder?.push(null);

    lnames.push("aggregate");
    llabels.push(this.translator.TranslateStr(293));
    ltypes.push(this.translator.TranslateStr(569));
    lhints.push(hint);
    lcat.push(cat);
    if (lvalues) {
      lvalues.push(this.getValueInteger("aggregate"));
    }
    lorder?.push(null);

    lnames.push("groupName");
    llabels.push(this.translator.TranslateStr(296));
    ltypes.push(this.translator.TranslateStr(961));
    lhints.push(hint);
    lcat.push(cat);
    if (lvalues) {
      lvalues.push(this.getValueString("groupName"));
    }
    lorder?.push(null);

    lnames.push("agType");
    llabels.push(this.translator.TranslateStr(297));
    ltypes.push(this.translator.TranslateStr(569));
    lhints.push(hint);
    lcat.push(cat);
    if (lvalues) {
      lvalues.push(this.getValueInteger("agType"));
    }
    lorder?.push(null);

    lnames.push("agIniValue");
    llabels.push(this.translator.TranslateStr(303));
    ltypes.push(this.translator.TranslateStr(571));
    lhints.push(hint);
    lcat.push(cat);
    if (lvalues) {
      lvalues.push(this.getValueString("agIniValue"));
    }
    lorder?.push(null);

    lnames.push("printOnlyOne");
    llabels.push(this.translator.TranslateStr(576));
    ltypes.push(this.translator.TranslateStr(568));
    lhints.push(hint);
    lcat.push(cat);
    if (lvalues) {
      lvalues.push(this.getValueBoolean("printOnlyOne"));
    }
    lorder?.push(null);
  }

  public override GetPropertyValues(pname: string, lpossiblevalues: string[]): void {
    switch (pname) {
      case "groupName": {
        lpossiblevalues.push("");
        const subreport = this.getParentSubReport();
        if (subreport) {
          for (const s of subreport.sections) {
            if (s.sectionType === SectionType.GroupHeader) {
              if (s.groupName) {
                lpossiblevalues.push(s.groupName);
              }
            }
          }
        }
        return;
      }
      case "dataType":
        lpossiblevalues.push(
          this.translator.TranslateStr(886),
          this.translator.TranslateStr(557),
          this.translator.TranslateStr(559),
          this.translator.TranslateStr(887),
          this.translator.TranslateStr(556),
          this.translator.TranslateStr(888),
          this.translator.TranslateStr(889),
          this.translator.TranslateStr(890),
          this.translator.TranslateStr(891)
        );
        return;
      case "aggregate":
        lpossiblevalues.push(
          this.translator.TranslateStr(294),
          this.translator.TranslateStr(296),
          this.translator.TranslateStr(269),
          this.translator.TranslateStr(295)
        );
        return;
      case "agType":
        lpossiblevalues.push(
          this.translator.TranslateStr(298),
          this.translator.TranslateStr(299),
          this.translator.TranslateStr(300),
          this.translator.TranslateStr(301),
          this.translator.TranslateStr(302)
        );
        return;
    }
    super.GetPropertyValues(pname, lpossiblevalues);
  }

  public override GetProperty(pname: string): any {
    switch (pname) {
      case "expression":
      case "displayFormat":
      case "identifier":
      case "groupName":
      case "agIniValue":
        return this.getValueString(pname);
      case "dataType":
        return this.dataTypeToIndex(this.getValueInteger("dataType"));
      case "aggregate":
      case "agType":
        return this.getValueInteger(pname);
      case "multiPage":
      case "printNulls":
      case "printOnlyOne":
        return this.getValueBoolean(pname);

      default:
        return super.GetProperty(pname);
    }
  }
  public override SetProperty(pname: string, newvalue: any): void {
    switch (pname) {
      case "dataType":
        this.setValue("dataType", this.indexToDataType(newvalue));
        break;
      case "expression":
      case "displayFormat":
      case "multiPage":
      case "printNulls":
      case "identifier":
      case "aggregate":
      case "agType":
      case "agIniValue":
      case "printOnlyOne":
        this.setValue(pname, newvalue);
        break;
      case "groupName":
        if (typeof newvalue === "number") {
          const groups: string[] = [""];
          const subReport = this.getParentSubReport();
          if (subReport) {
            for (const s of subReport.sections) {
              if (s.sectionType === SectionType.GroupHeader && s.groupName) {
                groups.push(s.groupName);
              }
            }
            this.setValue("groupName", groups[newvalue] || "");
          }
        } else {
          this.setValue("groupName", newvalue);
        }
        break;
      default:
        super.SetProperty(pname, newvalue);
        break;
    }
  }
}
