import { ReportItem, Report } from "@reportman/lib";
import { IObjectInspector } from "../interfaces/object-inspector.interface";
import { TranslationService } from "../services/translator.service";
import { DesignerInterfaceText } from "./designer-interface-text";
import { DesignUtils } from "./design-utils";

export class DesignerInterfaceLabel extends DesignerInterfaceText {
  constructor(
    nreport: Report,
    nrepitem: Map<number, ReportItem>,
    nobjinsp: IObjectInspector,
    translator: TranslationService
  ) {
    super(nreport, nrepitem, nobjinsp, translator);
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

    lnames.push("text");
    llabels.push(this.translator.TranslateStr(570));
    // A single line, like the C# designer (557): the WIDETEXT format cannot
    // represent line breaks inside a language (each line is a language).
    ltypes.push(this.translator.TranslateStr(200));
    lhints.push("reflabel.html");
    lcat.push(this.translator.TranslateStr(1203));
    if (lvalues) {
      const langIndex = DesignUtils.getLanguageIndex(this.report.language);
      const oldValue = this.getValueStringArrayIndex("allStrings", langIndex);
      lvalues.push(oldValue);
    }
    lorder?.push(null);
  }

  public override GetProperty(pname: string): any {
    switch (pname) {
      case "text": {
        const langIndex = DesignUtils.getLanguageIndex(this.report.language);
        const oldValue = this.getValueStringArrayIndex("allStrings", langIndex);
        return oldValue;
      }
    }
    return super.GetProperty(pname);
  }

  public override SetProperty(pname: string, newvalue: any): void {
    if (pname === "text") {
      // WIDETEXT does not allow line breaks inside a language: they are normalized
      // to a space so they do not become extra languages when the XML is read again.
      const sanitized = String(newvalue ?? "")
        .replace(/\r/g, "")
        .replace(/\n/g, " ");
      const langIndex = DesignUtils.getLanguageIndex(this.report.language);
      this.setValueStringArrayIndex("allStrings", langIndex, sanitized);
    } else {
      super.SetProperty(pname, newvalue);
    }
  }
}
