import { ReportItem } from "./report-item.js";

/** C# PrintItem: the defaults are the ones of its constructor. */
export class PrintItem extends ReportItem {
  public width = 0;
  public height = 0;
  public printCondition = "";
  public doAfterPrint = "";
  public doBeforePrint = "";
}
