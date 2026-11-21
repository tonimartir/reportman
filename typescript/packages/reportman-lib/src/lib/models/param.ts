import { ReportItem } from "./report-item.js";
import { Variant, VariantType } from "./variant.js";

/** C# Param: the defaults are the ones of its constructor. */
export class Param extends ReportItem {
  public alias = "";
  public paramType = ParamType.String;
  /** One description per report language (the engine keeps them as lines of a single text). */
  public descriptions: string[] = [];
  public hints: string[] = [];
  public errorMessages: string[] = [];
  public validation = "";
  public search = "";
  public visible = false;
  public isReadOnly = false;
  public neverVisible = false;
  public allowNulls = false;
  public datasets: string[] = [];
  public items: string[] = [];
  public values: string[] = [];
  public selected: string[] = [];
  public lookupDataset = "";
  public searchParam = "";
  public searchDataset = "";
  public value?: Variant = { type: VariantType.Null, value: null };
  constructor() {
    super();
    this.className = "TRPPARAM";
  }
}

/// <summary>
/// Type used in report parameters, for each parameter type, a diferent action will be performed
/// to assign the value before executing the report, a parameter can be assigned to
/// any number of database querys
/// </summary>
export enum ParamType {
  String,
  Integer,
  Double,
  Date,
  Time,
  DateTime,
  Currency,
  Bool,
  ExpreB,
  ExpreA,
  Subst,
  List,
  Multiple,
  SubstExpre,
  SubsExpreList,
  InitialValue,
  Unknown,
}
