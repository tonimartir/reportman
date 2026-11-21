export class ReportItem {
  public className: ReportItemClassName = undefined;
  public name = "";
}

export type ReportItemClassName =
  | "TRPLABEL"
  | "TRPEXPRESSION"
  | "TRPSECTION"
  | "TRPSUBREPORT"
  | "TRPPARAM"
  | "TRPCHART"
  | "TRPDATAINFOITEM"
  | "TRPDATABASEINFOITEM"
  | "TRPIMAGE"
  | "TRPSHAPE"
  | "TRPBARCODE"
  | "TRPREPORT"
  | undefined;
