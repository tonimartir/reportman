import { ParamType } from "./param.js";
import { PrintItemText } from "./print-item-text.js";

/** C# ExpressionItem: the defaults are the ones of its constructor. */
export class ExpressionItem extends PrintItemText {
  public expression = "";
  public agIniValue = "0";
  public exportExpression = "";
  public dataType = ParamType.Unknown;
  public displayFormat = "";
  public identifier = "";
  public groupName = "";
  public aggregate = Aggregate.None;
  public agType = AggregateType.Summary;
  public autoExpand = false;
  public autoContract = false;
  public printOnlyOne = false;
  public printNulls = true;
  public exportDisplayFormat = "";
  public exportLine = 0;
  public exportPosition = 0;
  public exportSize = 1;
  public exportDoNewLine = false;
  constructor() {
    super();
    this.className = "TRPEXPRESSION";
    this.width = 1440;
    this.height = 275;
  }
}

export enum Aggregate {
  None,
  Group,
  Page,
  General,
}
export enum AggregateType {
  Summary,
  Minimum,
  Maximum,
  Average,
  StandardDeviation,
}
