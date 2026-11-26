import { PrintItem } from "./print-item.js";
import { PrintPosItem } from "./print-pos-item.js";
import { StreamFormatType } from "./types.js";

/** C# Section: the defaults are the ones of its constructor. */
export class Section extends PrintItem {
  public changeExpression = "";
  public beginPageExpression = "";
  public skipExpreV = "";
  public skipExpreH = "";
  public skipToPageExpre = "";
  public backExpression = "";
  /** The subreport the section belongs to, by name (the reader sets the name of the subreport). */
  public subReportName = "";
  public groupName = "";
  public changeBool = false;
  public pageRepeat = false;
  public forcePrint = false;
  public skipPage = false;
  public alignBottom = false;
  // C# parity: the constructor does not set the type, so a new section is a page header.
  public sectionType = SectionType.PageHeader;
  public autoContract = false;
  public autoExpand = false;
  public horzDesp = false;
  public vertDesp = false;
  // C# parity: the constructor first sets the table, field and search field of the external section
  // to REPMAN_REPORTS, REPORT and REPORT_NAME and then clears them.
  //
  // External sections (Report files sharing sections), compatibility only (26-11-2026), as the C#
  // engine: these six properties are read and written so that a report keeps them, but no section is
  // loaded from its file or its database; the section prints the items the .rep carries (the copy the
  // Delphi designer saves with it). Only the Delphi engine loads them. The web designer does not show
  // them. Until somebody asks for them.
  public externalFilename = "";
  public externalConnection = "";
  public externalTable = "";
  public externalField = "";
  public externalSearchField = "";
  public externalSearchValue = "";
  public streamFormat = StreamFormatType.Text;
  public childSubReportName = "";
  /** Begin page flag saved by Delphi reports, only preserved: no engine uses it. */
  public beginPage = false;
  public skipRelativeH = false;
  public skipRelativeV = false;
  public skipType = SkipType.Default;
  public iniNumPage = false;
  public global = false;
  public backStyle = BackStyleType.Design;
  public dpires = 96;
  public drawStyle = ImageDrawStyleType.Full;
  public sharedImage = SharedImageType.None;
  /** The background image, base64 (C# StreamBase64 of its Stream). */
  public streamBase64 = "";
  public components: PrintPosItem[] = [];
  /** At design time, synchronize the width with the other sections that have it. */
  public syncWidth = true;
  constructor() {
    super();
    this.className = "TRPSECTION";
    this.width = 10700;
    this.height = 1500;
  }
}

/// <summary>
/// Section type, each section of a subreport have different function
/// </summary>
export enum SectionType {
  /// <summary>
  /// Printed at the page begin
  /// </summary>
  PageHeader,
  /// <summary>
  /// Printed when a group starts
  /// </summary>
  GroupHeader,
  /// <summary>
  /// Printed for each record in the main dataset of the subreport containg the section
  /// </summary>
  Detail,
  /// <summary>
  /// Printed when a group ends
  /// </summary>
  GroupFooter,
  /// <summary>
  /// Printed at the page begin
  /// </summary>
  PageFooter,
}

/// <summary>
/// A section can skip to a page or position
/// </summary>
export enum SkipType {
  /// <summary>
  /// The section will be printed in the natural place, just bellow the previous section, or
  /// right to it if Horzontal displacement property is true and there is enought space
  /// </summary>
  Default,
  /// <summary>
  /// The section will skip to a diferent position before print, the other properties
  /// related (Skip to page,Horizontal Skip...) will be used to determine the position
  /// </summary>
  Before,
  /// <summary>
  /// The section will skip to a diferent position before print, the other properties
  /// related (Skip to page,Horizontal Skip...) will be used to determine the position
  /// </summary>
  After,
}

/// <summary>
/// The background of a section can be visible only on design time, while preview only (will not print) or
/// also print the background
/// </summary>
export enum BackStyleType {
  /// <summary>
  /// The background will be only visible at design time, useful to fill preprinted forms,
  /// you can place the background in the section, with exact dots per inch define,
  /// so you place each expression in each predefined location
  /// </summary>
  Design,
  /// <summary>
  /// The background will be also visible at preview, but will not be printed
  /// </summary>
  Preview,
  /// <summary>
  /// The background will be visible at design, preview and will be printed
  /// </summary>
  Print,
}

/// <summary>
/// Drawing styles, determines the way the image adapt to a bounding box
/// </summary>
export enum ImageDrawStyleType {
  /// <summary>The image is drawn, but it's center inside the rectangle</summary>
  Center,
  /// <summary>The image is adapted to the bounding box size</summary>
  Stretch,
  /// <summary>The image is drawn without clipping, so bounding box size is ignored, dots per inch is used to calculate size</summary>
  Full,
  /// <summary>The image is drawn as many times as necessary to fill the rectangle left to right and top to bottom, scaling will depend on ouput device</summary>
  Tile,
  /// <summary>The image is drawn as many times as necessary to fill the rectangle left to right and top to bottom, the dots per inch image attribute will remain</summary>
  Tiledpi,
}

/// <summary>
/// Enumeration indicating if the image should be shared, so only one instance of the image is stored
/// while generating the report (ReportMetafile), if the image is repeated in the report, it's recommended
/// to share it, so the image is stored only once, and not for each page (a internal reference is done).
/// <see cref="Variant">ImageItem</see>
/// </summary>
/// <remarks>
/// When exporting the Report to Adobe PDF format, it's recommended to share images that are repeated
/// in each page, so the resulting file is smaller
/// </remarks>
export enum SharedImageType {
  /// <summary>The image will not be shared, recommended for variable images</summary>
  None,
  /// <summary>The image will be shared, for better performance, the reporting engine will assume that
  /// the image does not change in later drawings, recommended for page header logos for example</summary>
  Fixed,
  /// <summary>The image will be shared, but the engine must check it, so if the image changes while
  /// the report is processing, the new image will be stored and also shared until another change.
  /// This is recommended when the image will be printed in more than one page, then it changes and again
  /// repeats in more pages. For example in a categorized price list, printing an image for each category (wines,
  /// cheese). Checking this option will optimize the size of the resulting MetaFile (or Adobe PDF file)
  /// but will hurt performance, specially for large images, because the engine must check for changes in the image
  /// each time is drawn</summary>
  Variable,
}
