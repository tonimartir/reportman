// The enumerations of Reportman.Drawing (MetaFile.cs, MetaObjectBarcode.cs, PrintOut.cs), with the
// same numeric values as the C# engine: they are stored in metafiles and reports as integers.

/** Use of the printer fonts when the report is sent to a printer. */
export enum PrinterFontsType {
  Default = 0,
  Always = 1,
  Never = 2,
  Recalculate = 3,
}

/** Preview scale. */
export enum AutoScaleType {
  Wide = 0,
  Real = 1,
  EntirePage = 2,
  Custom = 3,
  Height = 4,
}

/** PDF conformance when writing a PDF. */
export enum PDFConformanceType {
  PDF_1_4 = 0,
  PDF_A_3 = 1,
}

/** PDF conformance behaviour, modifies the default PDF conformance. */
export enum PDFConformance {
  SetPDFDefault = 0,
  SettPDF_1_4 = 1,
  SetPDF_A_3 = 2,
}

/** Relationship of an embedded file to the PDF document (PDF/A-3 AFRelationship). */
export enum PDFAFRelationShip {
  Unspecified = 0,
  Alternative = 1,
  Data = 2,
  Source = 3,
  Supplement = 4,
}

/** Brush styles: the fill pattern of a shape. */
export enum BrushType {
  Solid = 0,
  Clear = 1,
  Horizontal = 2,
  Vertical = 3,
  ADiagonal = 4,
  BDiagonal = 5,
  ACross = 6,
  BCross = 7,
  Dense1 = 8,
  Dense2 = 9,
  Dense3 = 10,
  Dense4 = 11,
  Dense5 = 12,
  Dense6 = 13,
  Dense7 = 14,
}

/** Pen styles of a shape outline. */
export enum PenType {
  Solid = 0,
  Dash = 1,
  Dot = 2,
  DashDot = 3,
  DashDotDot = 4,
  Clear = 5,
}

/** How an image adapts to its bounding box. */
export enum ImageDrawStyleType {
  Crop = 0,
  Stretch = 1,
  Full = 2,
  Tile = 3,
  Tiledpi = 4,
}

/** Shape types of a draw object. */
export enum ShapeType {
  Rectangle = 0,
  Square = 1,
  RoundRect = 2,
  RoundSquare = 3,
  Ellipse = 4,
  Circle = 5,
  HorzLine = 6,
  VertLine = 7,
  Oblique1 = 8,
  Oblique2 = 9,
}

/** Fixed pitch font selection for dot matrix printers. */
export enum PrintStepType {
  BySize = 0,
  cpi20 = 1,
  cpi17 = 2,
  cpi15 = 3,
  cpi12 = 4,
  cpi10 = 5,
  cpi6 = 6,
  cpi5 = 7,
}

/** Font of a text when it is written to PDF: one of the standard ones, linked or embedded. */
export enum PDFFontType {
  Helvetica = 0,
  Courier = 1,
  TimesRoman = 2,
  Symbol = 3,
  ZafDingbats = 4,
  Linked = 5,
  Embedded = 6,
}

/** Predefined printers of a report. */
export enum PrinterSelectType {
  DefaultPrinter = 0,
  ReportPrinter,
  TicketPrinter,
  Graphicprinter,
  Characterprinter,
  ReportPrinter2,
  TicketPrinter2,
  UserPrinter1,
  UserPrinter2,
  UserPrinter3,
  UserPrinter4,
  UserPrinter5,
  UserPrinter6,
  UserPrinter7,
  UserPrinter8,
  UserPrinter9,
  PlainPrinter,
  PlainFullPrinter,
  Printer1,
  Printer2,
  Printer3,
  Printer4,
  Printer5,
  Printer6,
  Printer7,
  Printer8,
  Printer9,
  Printer10,
  Printer11,
  Printer12,
  Printer13,
  Printer14,
  Printer15,
  Printer16,
  Printer17,
  Printer18,
  Printer19,
  Printer20,
  Printer21,
  Printer22,
  Printer23,
  Printer24,
  Printer25,
  Printer26,
  Printer27,
  Printer28,
  Printer29,
  Printer30,
  Printer31,
  Printer32,
  Printer33,
  Printer34,
  Printer35,
  Printer36,
  Printer37,
  Printer38,
  Printer39,
  Printer40,
  Printer41,
  Printer42,
  Printer43,
  Printer44,
  Printer45,
  Printer46,
  Printer47,
  Printer48,
  Printer49,
  Printer50,
}

/** Page orientation. */
export enum OrientationType {
  Default = 0,
  Portrait = 1,
  Landscape = 2,
}

/** Preview window size the first time it is shown. */
export enum PreviewWindowStyleType {
  Normal = 0,
  Maximized = 1,
}

/** Separators of the binary metafile format (internal in C#). */
export enum MetaSeparator {
  FileHeader = 0,
  PageHeader = 1,
  ObjectHeader = 2,
  StreamHeader = 3,
}

/** Type of a metafile object. */
export enum MetaObjectType {
  Text = 0,
  Draw = 1,
  Image = 2,
  Polygon = 3,
  Export = 4,
  Barcode = 5,
}

/** Horizontal text alignment of a print item. */
export enum TextAlignType {
  Left = 0,
  Right = 1,
  Center = 2,
  Justify = 3,
}

/** Vertical text alignment of a print item. */
export enum TextAlignVerticalType {
  Top = 0,
  Bottom = 1,
  Center = 2,
}

/** Format version of a metafile (MetaFile.MetaFileVersion in C#). */
export enum MetaFileVersion {
  MetaVersion2_2 = 0,
  MetaVersion2_4 = 1,
  MetaVersion3_0 = 2,
  MetaVersion4_0 = 3,
  MetaVersion4_1 = 4,
}

/** Barcode symbologies a device can draw by itself (MetaObjectBarcode). */
export enum MetaBarcodeSymbology {
  Unknown = 0,
  QR = 1,
  Code128 = 2,
  EAN13 = 3,
  EAN8 = 4,
  Code39 = 5,
  PDF417 = 6,
  ITF = 7,
  Code93 = 8,
  Codabar = 9,
  UPCA = 10,
  UPCE = 11,
}

/** Error correction level of two-dimensional symbologies (QR). */
export enum MetaBarcodeEcc {
  L = 0,
  M = 1,
  Q = 2,
  H = 3,
}

/** Low level printer operations of raw / ESC-POS devices (PrintOut.cs). */
export enum PrinterRawOperation {
  CutPaper = 0,
  OpenDrawer,
  LineFeed,
  CR,
  FF,
  TearOff,
  InitPrinter,
  Pulse,
  EndPrint,
  RedFont,
  BlackFont,
  Normal,
  Bold,
  Underline,
  Italic,
  StrikeOut,
  LineSpace6,
  LineSpace8,
  LineSpace7_72,
  LineSpacen_216,
  LineSpacen_180,
  Linespacen_60,
  cpi20,
  cpi17,
  cpi15,
  cpi12,
  cpi10,
  cpi6,
  cpi5,
}
