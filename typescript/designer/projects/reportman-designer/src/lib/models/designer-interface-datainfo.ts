import { Report, DataInfo, ReportItem } from "@reportman/lib";
import { DesignerInterface } from "./designer-interface";
import { IObjectInspector } from "../interfaces/object-inspector.interface";
import { TranslationService } from "../services/translator.service";
import { Texto } from "../shell/texto";
import { UNIONS_PROPERTY_TYPE, UnionSettings, isMyBaseDataset } from "./union-settings";

/**
 * Two SQL texts are the same one when they differ only in line breaks or surrounding blanks (the
 * inspector and the editor normalise them differently): only a real change makes an audit stale.
 */
export function sameSql(a?: string | null, b?: string | null): boolean {
  return Texto.normalizarSaltosLinea(a ?? "").trim() === Texto.normalizarSaltosLinea(b ?? "").trim();
}

export class DesignerInterfaceDataInfo extends DesignerInterface {
  private FDataInfo?: DataInfo;

  constructor(
    nreport: Report,
    nrepitem: Map<number, ReportItem>,
    nobjinsp: IObjectInspector,
    ntranslator: TranslationService
  ) {
    super(nreport, nrepitem, nobjinsp, ntranslator);
    if (nrepitem.size === 1) {
      this.FDataInfo = nrepitem.values().next().value as DataInfo;
    }
  }

  public get dataInfo(): DataInfo {
    if (!this.FDataInfo) {
      throw new Error("Item not assigned");
    }
    return this.FDataInfo;
  }

  /** The dataset is on a MyBase connection: it runs no SQL, it may join other datasets. */
  public get isMyBase(): boolean {
    return isMyBaseDataset(this.report, this.FDataInfo);
  }

  public getAvaliableConnections(): string[] {
    const result: string[] = [];
    for (const dbinfo of this.report.databaseInfo) {
      if (dbinfo.alias) {
        result.push(dbinfo.alias);
      }
    }
    return result;
  }

  public getAvaliableMasterDataSets(): string[] {
    if (!this.FDataInfo) {
      throw new Error("Item not assigned");
    }
    const result: string[] = [""];
    for (const dinfo of this.report.dataInfo) {
      if (dinfo.alias !== this.FDataInfo.alias && dinfo.alias) {
        result.push(dinfo.alias);
      }
    }
    return result;
  }

  public override GetPropertyValues(pname: string, lpossiblevalues: string[]): void {
    if (!this.FDataInfo) {
      throw new Error("Item not assigned");
    }
    if (pname === "databaseAlias") {
      lpossiblevalues.length = 0;
      lpossiblevalues.push("");
      lpossiblevalues.push(...this.getAvaliableConnections());
      return;
    }

    if (pname === "dataSource") {
      lpossiblevalues.length = 0;
      lpossiblevalues.push(...this.getAvaliableMasterDataSets());
      return;
    }

    super.GetPropertyValues(pname, lpossiblevalues);
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
    if (!this.FDataInfo) {
      throw new Error("Item not assigned");
    }
    llabels.length = 0;
    lnames.length = 0;
    ltypes.length = 0;
    lhints.length = 0;
    lcat.length = 0;
    if (lvalues) {
      lvalues.length = 0;
    }
    if (lorder) {
      lorder.length = 0;
    }

    const cat = this.translator.TranslateStr(1201);
    const hint = "refdatainfo.html";
    lnames.push("alias");
    llabels.push(this.translator.TranslateStr(518));
    ltypes.push(this.translator.TranslateStr(557));
    lhints.push(hint);
    lcat.push(cat);
    if (lvalues) {
      lvalues.push(this.FDataInfo.alias);
    }
    lorder?.push(null);

    lnames.push("databaseAlias");
    llabels.push(this.translator.TranslateStr(154));
    ltypes.push(this.translator.TranslateStr(961));
    lhints.push(hint);
    lcat.push(cat);
    if (lvalues) {
      lvalues.push(this.FDataInfo.databaseAlias);
    }
    lorder?.push(null);

    lnames.push("dataSource");
    llabels.push(this.translator.TranslateStr(155));
    ltypes.push(this.translator.TranslateStr(961));
    lhints.push(hint);
    lcat.push(cat);
    if (lvalues) {
      lvalues.push(this.FDataInfo.dataSource);
    }
    lorder?.push(null);

    if (this.isMyBase) {
      // A dataset of the MyBase connection runs no SQL: the datasets it joins and how
      const add = (name: string, label: string, type: string, value: any) => {
        lnames.push(name);
        llabels.push(label);
        ltypes.push(type);
        lhints.push(hint);
        lcat.push(cat);
        if (lvalues) {
          lvalues.push(value);
        }
        lorder?.push(null);
      };
      const info = this.FDataInfo;
      const tr = (key: number) => this.translator.TranslateStr(key);
      add("dataUnions", tr(1083), UNIONS_PROPERTY_TYPE, UnionSettings.summary(info));
      add("parallelUnion", tr(1440), tr(568), !!info.parallelUnion);
      add("groupUnion", tr(1084), tr(568), !!info.groupUnion);
      add("myBaseIndexFields", tr(164), tr(557), info.myBaseIndexFields ?? "");
      add("myBaseMasterFields", tr(165), tr(557), info.myBaseMasterFields ?? "");
      return;
    }

    lnames.push("sql");
    llabels.push("SQL");
    ltypes.push("SQL");
    lhints.push(hint);
    lcat.push(cat);
    if (lvalues) {
      lvalues.push(this.FDataInfo.sql);
    }
    lorder?.push(null);
  }

  public override GetProperty(pname: string): any {
    if (!this.FDataInfo) {
      throw new Error("Item not assigned");
    }

    switch (pname) {
      case "alias":
        return this.FDataInfo.alias;

      case "databaseAlias":
        return this.FDataInfo.databaseAlias;

      case "dataSource":
        return this.FDataInfo.dataSource;

      case "sql":
        return this.FDataInfo.sql;

      // The union of a dataset of the MyBase connection
      case "dataUnions":
        return UnionSettings.summary(this.FDataInfo);

      case "parallelUnion":
        return !!this.FDataInfo.parallelUnion;

      case "groupUnion":
        return !!this.FDataInfo.groupUnion;

      case "myBaseIndexFields":
        return this.FDataInfo.myBaseIndexFields ?? "";

      case "myBaseMasterFields":
        return this.FDataInfo.myBaseMasterFields ?? "";

      default:
        return super.GetProperty(pname);
    }
  }

  public override SetProperty(pname: string, newvalue: any): void {
    if (!this.FDataInfo) {
      throw new Error("Item not assigned");
    }

    switch (pname) {
      case "alias":
        this.FDataInfo.alias = newvalue.toString().toUpperCase();
        break;

      case "databaseAlias": {
        const list = this.getAvaliableConnections();
        if (typeof newvalue === "number" && newvalue <= list.length) {
          this.FDataInfo.databaseAlias = newvalue === 0 ? "" : list[newvalue - 1];
        } else {
          this.FDataInfo.databaseAlias = newvalue;
        }
        break;
      }

      case "dataSource": {
        const list = this.getAvaliableMasterDataSets();
        if (typeof newvalue === "number" && newvalue <= list.length) {
          this.FDataInfo.dataSource = newvalue === 0 ? "" : list[newvalue - 1];
        } else {
          this.FDataInfo.dataSource = newvalue;
        }
        break;
      }

      case "sql": {
        const sql = newvalue.toString();
        // As Delphi's TRpDataInfoItem.SetSQL and the engine's DataInfo.SQL: the audit explains one
        // SQL text, so another text clears it (and its error) and the copilot audits it again.
        if (!sameSql(sql, this.FDataInfo.sql)) {
          this.FDataInfo.sqlExplanation = "";
          this.FDataInfo.sqlExplanationError = "";
        }
        this.FDataInfo.sql = sql;
        break;
      }

      // The union of a dataset of the MyBase connection: the entries, written separated by commas
      // (a new array: the undo history keeps the old one).
      case "dataUnions":
        this.FDataInfo.dataUnions = Array.isArray(newvalue)
          ? (newvalue as unknown[]).map((e) => String(e ?? "").trim()).filter((e) => e.length > 0)
          : UnionSettings.parseSummary(newvalue == null ? "" : String(newvalue));
        break;

      case "parallelUnion":
        this.FDataInfo.parallelUnion = !!newvalue;
        break;

      case "groupUnion":
        this.FDataInfo.groupUnion = !!newvalue;
        break;

      case "myBaseIndexFields":
        this.FDataInfo.myBaseIndexFields = (newvalue ?? "").toString().trim();
        break;

      case "myBaseMasterFields":
        this.FDataInfo.myBaseMasterFields = (newvalue ?? "").toString().trim();
        break;

      default:
        super.SetProperty(pname, newvalue);
        break;
    }
  }
}
