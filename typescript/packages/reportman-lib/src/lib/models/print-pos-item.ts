import { ReportItemClassName } from "./report-item.js";
import { PrintItem } from "./print-item.js";

export class PrintPosItem extends PrintItem {
  public hidden = false;
  public posX = 0;
  public posY = 0;
  public align = PrintItemAlign.None;
  public partialFlag = false;
  public annotationExpression?: string;
  public static isPrintPosItem(className: ReportItemClassName): boolean {
    switch (className) {
      case "TRPBARCODE":
      case "TRPCHART":
      case "TRPEXPRESSION":
      case "TRPLABEL":
      case "TRPIMAGE":
      case "TRPSHAPE":
        return true;
    }
    return false;
  }
}

/// <summary>
/// Enumeration indicating the alignment of a Report Item related to his parent. This is useful when the
/// parent Section have properties like AutoExpand or AutoContract set, you can place a Rectangle
/// and set Align to AllClient, the rectangle will be adapted at run time to fill the section. You can also
/// align to bottom or expand lines from top to bottom.
/// <see cref="Variant">PrintPosItem</see><see cref="Variant">Section</see>
/// </summary>
export enum PrintItemAlign {
  /// <summary>No alignment, default will be used</summary>
  None,
  /// <summary>Align to bottom of the parent</summary>
  Bottom,
  /// <summary>Align to the right of the parent</summary>
  Right,
  /// <summary>Align to the right and bottom of the parent</summary>
  BottomRight,
  /// <summary>Expand from left to right of the parent</summary>
  LeftRight,
  /// <summary>Expand from top to bottom of the parent</summary>
  TopBottom,
  /// <summary>Expand to all area of the parent</summary>
  AllClient,
}
