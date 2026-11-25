import { ReportItem, Report, Param, ParamType, VariantType } from "@reportman/lib";
import { IObjectInspector } from "../interfaces/object-inspector.interface";
import { TranslationService } from "../services/translator.service";
import { DesignerInterface } from "./designer-interface";
import { DesignUtils } from "./design-utils";
export class DesignerInterfaceParam extends DesignerInterface {
  private FParamItem?: Param;

  constructor(
    nreport: Report,
    nrepitem: Map<number, ReportItem>,
    nobjinsp: IObjectInspector,
    ntranslator: TranslationService
  ) {
    super(nreport, nrepitem, nobjinsp, ntranslator);
    if (nrepitem.size === 1) {
      this.FParamItem = nrepitem.values().next().value as Param;
    }
  }

  public override SetItem(nitem: ReportItem) {
    this.FParamItem = nitem as Param;
    super.SetItem(nitem);
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
    if (!this.FParamItem) {
      throw new Error("Item not assigned");
    }
    super.GetProperties(lnames, llabels, ltypes, lvalues, lhints, lcat, lorder);

    lnames.push("alias");
    llabels.push(this.translator.TranslateStr(544));
    ltypes.push(this.translator.TranslateStr(200));
    lhints.push("refparam.html");
    lcat.push(this.translator.TranslateStr(722));
    lvalues?.push(this.FParamItem.alias);
    lorder?.push(null);

    lnames.push("paramType");
    llabels.push(this.translator.TranslateStr(193));
    ltypes.push(this.translator.TranslateStr(569));
    lhints.push("refparam.html");
    lcat.push(this.translator.TranslateStr(722));
    lvalues?.push(this.FParamItem.paramType);
    lorder?.push(null);

    lnames.push("value");
    llabels.push(this.translator.TranslateStr(194));
    ltypes.push(this.translator.TranslateStr(135));
    lhints.push("refparam.html");
    lcat.push(this.translator.TranslateStr(722));
    lvalues?.push(this.FParamItem.value);
    lorder?.push(null);

    lnames.push("visible");
    llabels.push(this.translator.TranslateStr(183));
    ltypes.push(this.translator.TranslateStr(568));
    lhints.push("refparam.html");
    lcat.push(this.translator.TranslateStr(722));
    lvalues?.push(this.FParamItem.visible);
    lorder?.push(null);

    lnames.push("text");
    llabels.push(this.translator.TranslateStr(197));
    ltypes.push(this.translator.TranslateStr(200));
    lhints.push("refparam.html");
    lcat.push(this.translator.TranslateStr(722));
    lvalues?.push(DesignUtils.getLanguageText(this.FParamItem.descriptions, this.report.language));
    lorder?.push(null);
    lnames.push("hint");
    llabels.push(this.translator.TranslateStr(1382));
    ltypes.push(this.translator.TranslateStr(200));
    lhints.push("refparam.html");
    lcat.push(this.translator.TranslateStr(722));
    lvalues?.push(DesignUtils.getLanguageText(this.FParamItem.hints, this.report.language));
    lorder?.push(null);
    lnames.push("validation");
    llabels.push(this.translator.TranslateStr(1401));
    ltypes.push(this.translator.TranslateStr(200));
    lhints.push("refparam.html");
    lcat.push(this.translator.TranslateStr(722));
    lvalues?.push(this.FParamItem.validation);
    lorder?.push(null);

    lnames.push("errorMessage");
    llabels.push(this.translator.TranslateStr(1403));
    ltypes.push(this.translator.TranslateStr(200));
    lhints.push("refparam.html");
    lcat.push(this.translator.TranslateStr(722));
    lvalues?.push(DesignUtils.getLanguageText(this.FParamItem.errorMessages, this.report.language));
    lorder?.push(null);

    lnames.push("datasets");
    llabels.push(this.translator.TranslateStr(198));
    ltypes.push(this.translator.TranslateStr(198));
    lhints.push("refparam.html");
    lcat.push(this.translator.TranslateStr(722));
    lvalues?.push(this.FParamItem.datasets.join(";"));
    lorder?.push(null);

    lnames.push("search");
    llabels.push(this.translator.TranslateStr(946));
    ltypes.push(this.translator.TranslateStr(200));
    lhints.push("refparam.html");
    lcat.push(this.translator.TranslateStr(722));
    lvalues?.push(this.FParamItem.search);
    lorder?.push(null);
  }

  public override GetPropertyValues(pname: string, lpossiblevalues: string[]): void {
    if (pname === "paramType") {
      lpossiblevalues.push(this.translator.TranslateStr(557)); // String
      lpossiblevalues.push(this.translator.TranslateStr(559)); // Integer
      lpossiblevalues.push(this.translator.TranslateStr(887)); // Float
      lpossiblevalues.push(this.translator.TranslateStr(888)); // Date
      lpossiblevalues.push(this.translator.TranslateStr(890)); // Time
      lpossiblevalues.push(this.translator.TranslateStr(889)); // DateTime
      lpossiblevalues.push(this.translator.TranslateStr(556)); // Currency
      lpossiblevalues.push(this.translator.TranslateStr(891)); // Bool
      lpossiblevalues.push(this.translator.TranslateStr(942)); // Expression Before open
      lpossiblevalues.push(this.translator.TranslateStr(943)); // Expression After open
      lpossiblevalues.push(this.translator.TranslateStr(951)); // Substitution parameter
      lpossiblevalues.push(this.translator.TranslateStr(961)); // Param list
      lpossiblevalues.push(this.translator.TranslateStr(1368)); // Param list multiple
      lpossiblevalues.push(this.translator.TranslateStr(1422)); // String substitution expression
      lpossiblevalues.push(this.translator.TranslateStr(1442)); // String substitution list
      lpossiblevalues.push(this.translator.TranslateStr(1443)); // Initial expression
      lpossiblevalues.push(this.translator.TranslateStr(575)); // Unknown
    }
  }

  public override SetProperty(pname: string, newvalue: any): void {
    if (!this.FParamItem) {
      throw new Error("Item not assigned");
    }

    if (pname === "name") {
      this.FParamItem.name = newvalue;
    } else if (pname === "alias") {
      this.FParamItem.alias = newvalue;
    } else if (pname === "paramType") {
      this.FParamItem.paramType = newvalue;
      switch (this.FParamItem.paramType) {
        case ParamType.Integer:
          if (typeof this.FParamItem.value!.value == "number") {
            this.FParamItem.value = {
              type: VariantType.Integer,
              value: Math.round(this.FParamItem.value!.value),
            };
          } else {
            this.FParamItem.value = { type: VariantType.Integer, value: 0 };
          }
          break;
        case ParamType.Double:
          if (typeof this.FParamItem.value!.value == "number") {
            this.FParamItem.value = {
              type: VariantType.Double,
              value: this.FParamItem.value!.value,
            };
          } else {
            this.FParamItem.value = { type: VariantType.Double, value: 0 };
          }
          break;
        case ParamType.Currency:
          if (typeof this.FParamItem.value!.value == "number") {
            this.FParamItem.value = {
              type: VariantType.Decimal,
              value: this.FParamItem.value!.value,
            };
          } else {
            this.FParamItem.value = { type: VariantType.Decimal, value: 0 };
          }
          break;
        case ParamType.Date:
        case ParamType.Time:
        case ParamType.DateTime:
          if (this.FParamItem.value!.value instanceof Date) {
            this.FParamItem.value = {
              type: VariantType.DateTime,
              value: this.FParamItem.value!.value,
            };
          } else {
            this.FParamItem.value = { type: VariantType.DateTime, value: new Date() };
          }
          break;
        case ParamType.Bool:
          if (typeof this.FParamItem.value!.value == "boolean") {
            this.FParamItem.value = {
              type: VariantType.Boolean,
              value: this.FParamItem.value!.value,
            };
          } else {
            this.FParamItem.value = { type: VariantType.Boolean, value: false };
          }
          break;
        default:
          if (typeof this.FParamItem.value!.value != "string") {
            this.FParamItem.value = { type: VariantType.String, value: "" };
          }
          break;
      }
    } else if (pname === "value") {
      this.FParamItem.value = newvalue;
    } else if (pname === "visible") {
      this.FParamItem.visible = newvalue;
    } else if (pname === "text") {
      DesignUtils.setLanguageText(this.FParamItem.descriptions, newvalue, this.report.language);
    } else if (pname === "hint") {
      DesignUtils.setLanguageText(this.FParamItem.hints, newvalue, this.report.language);
    } else if (pname === "validation") {
      this.FParamItem.validation = newvalue;
    } else if (pname === "errorMessage") {
      DesignUtils.setLanguageText(this.FParamItem.errorMessages, newvalue, this.report.language);
    } else if (pname === "search") {
      this.FParamItem.search = newvalue;
    } else if (pname === "datasets") {
      this.FParamItem.datasets = (newvalue as string).split(";");
    } else {
      super.SetProperty(pname, newvalue);
    }
  }
  public override GetProperty(pname: string): any {
    if (!this.FParamItem) {
      throw new Error("Item not assigned");
    }

    switch (pname) {
      case "name":
        return this.FParamItem.name;

      case "paramType":
        return this.FParamItem.paramType;

      case "value":
        return this.FParamItem.value;

      case "visible":
        return this.FParamItem.visible;

      case "description":
        return DesignUtils.getLanguageText(this.FParamItem.descriptions, this.report.language);

      case "hint":
        return DesignUtils.getLanguageText(this.FParamItem.hints, this.report.language);

      case "validation":
        return this.FParamItem.validation;

      case "errorMessage":
        return DesignUtils.getLanguageText(this.FParamItem.errorMessages, this.report.language);

      case "search":
        return this.FParamItem.search;

      case "datasets":
        return this.FParamItem.datasets.join(";");

      default:
        return super.GetProperty(pname);
    }
  }
}
