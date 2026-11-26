import { ParamType } from "./param.js";
import { PrintItemText } from "./print-item-text.js";

/** C# ExpressionItem: the defaults are the ones of its constructor. */
export class ExpressionItem extends PrintItemText {
  public expression = "";
  public agIniValue = "0";
  /**
   * @deprecated Unused (26-11-2026): the expression of the plain text export of the Delphi and C#
   * engines (fixed-width text for dot-matrix printers), very rarely used and hard to adjust. The
   * TypeScript engine has no such export and the web designer does not show it; it is read and written
   * only so that a report keeps it. Until somebody asks for it.
   */
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
  /**
   * @deprecated Unused (26-11-2026): the display format of the plain text export of the Delphi and C#
   * engines (fixed-width text for dot-matrix printers), very rarely used and hard to adjust. The
   * TypeScript engine has no such export and the web designer does not show it; it is read and written
   * only so that a report keeps it. Until somebody asks for it.
   */
  public exportDisplayFormat = "";
  /**
   * @deprecated Unused (26-11-2026): the line of the plain text export of the Delphi and C#
   * engines (fixed-width text for dot-matrix printers), very rarely used and hard to adjust. The
   * TypeScript engine has no such export and the web designer does not show it; it is read and written
   * only so that a report keeps it. Until somebody asks for it.
   */
  public exportLine = 0;
  /**
   * @deprecated Unused (26-11-2026): the column of the plain text export of the Delphi and C#
   * engines (fixed-width text for dot-matrix printers), very rarely used and hard to adjust. The
   * TypeScript engine has no such export and the web designer does not show it; it is read and written
   * only so that a report keeps it. Until somebody asks for it.
   */
  public exportPosition = 0;
  /**
   * @deprecated Unused (26-11-2026): the width of the plain text export of the Delphi and C#
   * engines (fixed-width text for dot-matrix printers), very rarely used and hard to adjust. The
   * TypeScript engine has no such export and the web designer does not show it; it is read and written
   * only so that a report keeps it. Until somebody asks for it.
   */
  public exportSize = 1;
  /**
   * @deprecated Unused (26-11-2026): the new line after it of the plain text export of the Delphi and C#
   * engines (fixed-width text for dot-matrix printers), very rarely used and hard to adjust. The
   * TypeScript engine has no such export and the web designer does not show it; it is read and written
   * only so that a report keeps it. Until somebody asks for it.
   */
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
