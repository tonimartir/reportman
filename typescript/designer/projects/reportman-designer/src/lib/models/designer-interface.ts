import { ReportItem, Report, ArrayUtil, SubReport, Section, PrintPosItem } from "@reportman/lib";
import { IObjectInspector } from "../interfaces/object-inspector.interface";
import { TranslationService } from "../services/translator.service";
import { DesignUtils } from "./design-utils";
import { ReportEditorDesign } from "./report-editor-design";

export class DesignerInterface {
  protected FReportItems: Map<number, ReportItem>;
  protected FObjectInspector: IObjectInspector;
  protected FReportItemObject?: ReportItem;
  public SelectionClassName = "";
  protected report: Report;
  protected repitem: Map<number, ReportItem>;
  protected objinsp: IObjectInspector;
  protected translator: TranslationService;

  constructor(
    nreport: Report,
    nrepitem: Map<number, ReportItem>,
    nobjinsp: IObjectInspector,
    ntranslator: TranslationService
  ) {
    this.FReportItems = nrepitem;
    this.FObjectInspector = nobjinsp;
    this.translator = ntranslator;
    this.report = nreport;
    this.objinsp = nobjinsp;
    this.repitem = nrepitem;
    if (nrepitem.size === 1) {
      this.FReportItemObject = [...nrepitem.values()][0];
    }
  }
  public getValueString(propName: string): string | undefined {
    let returnValue: string | undefined = undefined;
    for (const key of this.FReportItems.keys()) {
      const item = this.FReportItems.get(key);
      const value = (item as any)[propName];
      if (returnValue == undefined) {
        returnValue = value;
      } else {
        if (returnValue !== value) {
          returnValue = undefined;
          break;
        }
      }
    }
    return returnValue;
  }
  public getParentSubReport(): SubReport | undefined {
    for (const key of this.FReportItems.keys()) {
      const item = this.FReportItems.get(key);
      if (item) {
        switch (item.className) {
          case "TRPDATABASEINFOITEM":
          case "TRPDATAINFOITEM":
          case "TRPPARAM":
          case "TRPREPORT":
          case "TRPSUBREPORT":
            return undefined;
          case "TRPSECTION":
            return this.report.getParentSubReport(item as Section);
          default: {
            const section = this.report.getParentSection(item as PrintPosItem);
            return this.report.getParentSubReport(section);
          }
        }
      }
    }
    return undefined;
  }
  public getValueStringArray(propName: string): string[] | undefined {
    let returnValue: string[] | undefined = undefined;
    for (const key of this.FReportItems.keys()) {
      const item = this.FReportItems.get(key);
      const value = (item as any)[propName] as string[];
      if (returnValue == undefined) {
        returnValue = value;
      } else {
        if (!ArrayUtil.arraysAreEqual(returnValue, value)) {
          returnValue = undefined;
          break;
        }
      }
    }
    return returnValue;
  }
  public getValueStringArrayIndex(propName: string, index: number): string | undefined {
    let returnValue: string | undefined = undefined;
    for (const key of this.FReportItems.keys()) {
      const item = this.FReportItems.get(key);
      const valueArray = (item as any)[propName] as string[];
      const value = valueArray[index];
      if (returnValue == undefined) {
        returnValue = value;
      } else {
        if (returnValue != value) {
          returnValue = undefined;
          break;
        }
      }
    }
    return returnValue;
  }
  public setValueStringArrayIndex(propName: string, index: number, newvalue: string) {
    for (const key of this.FReportItems.keys()) {
      const item = this.FReportItems.get(key);
      const valueArray = (item as any)[propName] as string[];
      // Fill the holes: a sparse array serializes null in JSON and C# would end up
      // with null elements. Same convention as LabelItem.Text in C# (it fills
      // with the value of the default language).
      const defaultValue = valueArray.length > 0 ? valueArray[0] : "";
      while (valueArray.length < index) {
        valueArray.push(defaultValue);
      }
      valueArray[index] = newvalue;
    }
  }
  public setValueStringArray(propName: string, newvalue: string[]) {
    for (const key of this.FReportItems.keys()) {
      const item = this.FReportItems.get(key);
      const value = (item as any)[propName] as string[];
      value.splice(0, value.length);
      for (const val of newvalue) {
        value.push(val);
      }
    }
  }
  public getValueNumber(propName: string): number | undefined {
    let returnValue: number | undefined = undefined;
    for (const key of this.FReportItems.keys()) {
      const item = this.FReportItems.get(key);
      const value = (item as any)[propName] as number | undefined;
      if (returnValue == undefined) {
        returnValue = value;
      } else {
        if (returnValue !== value) {
          returnValue = undefined;
          break;
        }
      }
    }
    return returnValue;
  }
  public setValue(propName: any, value: any) {
    for (const key of this.FReportItems.keys()) {
      const item = this.FReportItems.get(key);
      (item as any)[propName] = value;
    }
  }
  public getValueInteger(propName: string): number | undefined {
    let returnValue: number | undefined = undefined;
    for (const key of this.FReportItems.keys()) {
      const item = this.FReportItems.get(key);
      const value = (item as any)[propName] as number | undefined;
      if (returnValue == undefined) {
        returnValue = value;
      } else {
        if (returnValue !== value) {
          returnValue = undefined;
          break;
        }
      }
    }
    if (returnValue != undefined) {
      returnValue = Math.round(returnValue);
    }
    return returnValue;
  }
  public getValueBoolean(propName: string): boolean | undefined {
    let returnValue: boolean | undefined = undefined;
    for (const key of this.FReportItems.keys()) {
      const item = this.FReportItems.get(key);
      const value = (item as any)[propName] as boolean | undefined;
      if (returnValue == undefined) {
        returnValue = value;
      } else {
        if (returnValue !== value) {
          returnValue = undefined;
          break;
        }
      }
    }
    if (returnValue != undefined) {
      returnValue = returnValue as boolean;
    }
    return returnValue;
  }

  public get SelectionList(): Map<number, ReportItem> {
    return this.FReportItems;
  }

  public get ReportItemObject(): ReportItem | undefined {
    return this.FReportItemObject;
  }

  public SetPropertyMulti(pname: string, newvalue: any): void {
    if (this.SelectionList.size === 1) {
      this.SetProperty(pname, newvalue);
    } else {
      for (const nitem of this.SelectionList.values()) {
        this.SetItem(nitem);
        this.SetProperty(pname, newvalue);
      }
    }
  }

  public GetPropertyMulti(pname: string): any {
    if (this.SelectionList.size === 1) {
      return this.GetProperty(pname);
    } else {
      let nvar: any = null;
      let firstpass = true;
      for (const nitem of this.SelectionList.values()) {
        this.SetItem(nitem);
        if (firstpass) {
          nvar = this.GetProperty(pname);
          firstpass = false;
        } else {
          if (nvar !== this.GetProperty(pname)) {
            return null; // Equivalent to `new any()`
          }
        }
      }
      return nvar;
    }
  }
  // Virtual methods to override
  public GetProperties(
    lnames: string[],
    llabels: string[],
    ltypes: string[],
    lvalues: any[],
    lhints: string[],
    lcat: string[],
    lorder?: (number | null)[] | null
    // eslint-disable-next-line @typescript-eslint/no-empty-function
  ): void {}

  public GetPropertyValues(pname: string, lpossiblevalues: string[]): void {
    throw new Error(`GetPropertyValues no implementado: ${pname}`);
  }

  // eslint-disable-next-line @typescript-eslint/no-empty-function
  public SetItem(nitem: ReportItem): void {}

  public GetProperty(pname: string): any {
    throw new Error(`GetProperty no implementado: ${pname}`);
  }

  public GetPropertyStream(pname: string, memvalue: string): string {
    throw new Error(`GetProperty (stream) no implementado: ${pname}`);
  }

  public SetProperty(pname: string, newvalue: any): void {
    throw new Error(`SetProperty no implementado: ${pname}`);
  }

  public SetPropertyStream(pname: string, newvalue: string): void {
    throw new Error(`SetProperty (stream) no implementado: ${pname}`);
  }
}
