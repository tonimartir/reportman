import { ReportItem, Report, SubReport } from "@reportman/lib";
import { IObjectInspector } from "../interfaces/object-inspector.interface";
import { TranslationService } from "../services/translator.service";
import { DesignerInterface } from "./designer-interface";

export class DesignerInterfaceSubReport extends DesignerInterface {
  private fsubreport?: SubReport;

  constructor(
    nreport: Report,
    nrepitem: Map<number, ReportItem>,
    nobjinsp: IObjectInspector,
    ntranslator: TranslationService
  ) {
    super(nreport, nrepitem, nobjinsp, ntranslator);
    if (nrepitem.size === 1) {
      this.fsubreport = nrepitem.values().next().value as SubReport;
    }
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
    super.GetProperties(lnames, llabels, ltypes, lvalues, lhints, lcat, lorder);
    this.fsubreport = this.ReportItemObject as SubReport;

    // Main dataset
    lnames.push("alias");
    llabels.push(this.translator.TranslateStr(275));
    ltypes.push(this.translator.TranslateStr(961));
    lhints.push("refsubreport.html");
    // lcat.push(this.translator.TranslateStr(280));
    if (lvalues !== null) {
      lvalues.push(this.fsubreport.alias);
    }
    lorder?.push(null);

    // Print only if data available
    lnames.push("printOnlyIfDataAvailable");
    llabels.push(this.translator.TranslateStr(800));
    ltypes.push(this.translator.TranslateStr(568));
    lhints.push("refsubreport.html");
    // lcat.push(this.translator.TranslateStr(280));
    if (lvalues !== null) {
      lvalues.push(this.fsubreport.printOnlyIfDataAvailable);
    }
    lorder?.push(null);
  }

  public override GetPropertyValues(pname: string, lpossiblevalues: string[]): void {
    if (pname === "alias") {
      this.fsubreport = this.ReportItemObject as SubReport;
      lpossiblevalues.push("");
      for (const dinfo of this.report.dataInfo) {
        if (dinfo.alias) {
          lpossiblevalues.push(dinfo.alias);
        }
      }
      return;
    }
    super.GetPropertyValues(pname, lpossiblevalues);
  }

  public override SetItem(nitem: ReportItem): void {
    this.fsubreport = nitem as SubReport;
    super.SetItem(nitem);
  }

  public override GetProperty(pname: string): any {
    if (pname === "alias") {
      return this.fsubreport?.alias;
    }
    if (pname === "printOnlyIfDataAvailable") {
      return this.fsubreport?.printOnlyIfDataAvailable;
    }
    return super.GetProperty(pname);
  }

  public override SetProperty(pname: string, newvalue: any): void {
    if (pname === "alias") {
      if (typeof newvalue == "string") {
        this.fsubreport!.alias = newvalue;
      } else {
        if (newvalue.value === 0) {
          this.fsubreport!.alias = "";
        } else {
          const index = (newvalue.value as number) - 1;
          this.fsubreport!.alias = this.report.dataInfo[index].alias;
        }
      }
      // Refresh the interface of structure
      this.FObjectInspector.refreshSubReport(this.fsubreport!);
      return;
    }
    if (pname === "printOnlyIfDataAvailable") {
      this.fsubreport!.printOnlyIfDataAvailable = newvalue;
      return;
    }
    super.SetProperty(pname, newvalue);
  }
}
