/// <summary>
/// Page orientation
/// </summary>
export enum PageOrientationType {
  /// <summary>The predefined orientation in selected printer will be used</summary>
  Default,
  /// <summary>Portrait orientaion will be used (Vertical)</summary>
  Portrait,
  /// <summary>Landscape orientaion will be used (Horizontal)</summary>
  Landscape,
}

/// <summary>
/// Page size configuration for report scheme
/// </summary>
export enum PageSizeType {
  /// <summary>
  /// The printer configuration will be used to obtain the page size
  /// </summary>
  Default,
  /// <summary>
  /// A page size will be selected from a list of available page sizes
  /// </summary>
  Custom,
  /// <summary>
  /// The page size will be specified with fixed height and width. The user executing the
  /// report must have administrator privileges over destination printer to use this setting,
  /// at least the first time the report is executed, because a new form will be created in
  /// the printer configuration
  /// </summary>
  User,
}

/// <summary>
/// When previewing pages of a report, visualization scale can be adjusted to predetermined sizes
/// </summary>
export enum AutoScaleType {
  /// <summary>The page will fit the width of the window application</summary>
  Wide,
  /// <summary>Real size, using dots per inch of screen</summary>
  Real,
  /// <summary>The entire page will be scaled to be visible inside the window application</summary>
  EntirePage,
  /// <summary>The page will have a custom scale</summary>
  Custom,
  /// <summary>The page will fit the height of the window</summary>
  Height,
}

/// <summary>
/// Preview window size the first time it's shown
/// </summary>
export enum PreviewWindowStyleType {
  /// <summary>
  /// Non maximized, normal size
  /// </summary>
  Normal,
  /// <summary>
  /// Maximized size
  /// </summary>
  Maximized,
}

/// <summary>
/// Report Manager allow automatic printer selection when processing reports, so you can assign
/// a predefined printer to a report, then assign on each computer a diferent printer to predefined
/// printers.
/// </summary>
/// <remarks>
/// This is useful for automatic output to ticket printer without the need for showing a print dialog
/// or setting it as default printer.
/// </remarks>
export enum PrinterSelectType {
  /// <summary>Default printer</summary>
  DefaultPrinter,
  /// <summary>Report Printer, user predefined printer</summary>
  ReportPrinter,
  /// <summary>Ticket Printer, user predefined printer, by default the text driver TM-U210 will be used</summary>
  TicketPrinter,
  /// <summary>Graphic Printer, user predefined printer</summary>
  Graphicprinter,
  /// <summary>Character Printer, user predefined printer, by default the text driver EPSON will be used</summary>
  Characterprinter,
  /// <summary>Report Printer 2, user predefined printer</summary>
  ReportPrinter2,
  /// <summary>Ticket Printer 2, user predefined printer, by default the text driver TM-U210 will be used</summary>
  TicketPrinter2,
  /// <summary>User Printer 1, user predefined printer</summary>
  UserPrinter1,
  /// <summary>User Printer 2, user predefined printer</summary>
  UserPrinter2,
  /// <summary>User Printer 3, user predefined printer</summary>
  UserPrinter3,
  /// <summary>User Printer 4, user predefined printer</summary>
  UserPrinter4,
  /// <summary>User Printer 5, user predefined printer</summary>
  UserPrinter5,
  /// <summary>User Printer 6, user predefined printer</summary>
  UserPrinter6,
  /// <summary>User Printer 7, user predefined printer</summary>
  UserPrinter7,
  /// <summary>User Printer 8, user predefined printer</summary>
  UserPrinter8,
  /// <summary>User Printer 9, user predefined printer</summary>
  UserPrinter9,
  /// <summary>Plain Printer, by default PLAIN text driver will be used</summary>
  PlainPrinter,
  /// <summary>Plain Full Printer, by default PLAIN text driver without form feed will be used</summary>
  PlainFullPrinter,
  /// <summary>Other printers</summary>
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
/// <summary>
/// When the Report is sent to a printer, there is an option to use the printer fonts, if the printer fonts
/// are used, in some cases the print is faster (dot matrix printers)
/// </summary>
export enum PrinterFontsType {
  /// <summary>The printer fonts are not used, or used only if the print driver forces it</summary>
  Default,
  /// <summary>The printer fonts are allways used, some print drivers does not have this option available</summary>
  Always,
  /// <summary>Do not use printer fonts</summary>
  Never,
  /// <summary>Use printer fonts, but if necessary recalculate the report to accomodate printer fonts,
  /// this is the recommended option when working with dot matrix printers, but number of pages in preview and
  /// number of printed can differ</summary>
  Recalculate,
}

export enum StreamFormatType {
  /// <summary>
  /// Zlib, binary and compressed, only usable in Win32 native reporting engine
  /// </summary>
  Zlib,
  /// <summary>
  /// Text, objext oriented, only usable in Win32 native reporting engine
  /// </summary>
  Text,
  /// <summary>
  /// Binary, only usable in Win32 native reporting engine
  /// </summary>
  Binary,
  /// <summary>
  /// XML Text, usable in Win32 native reporting engine and .Net engine
  /// </summary>
  XML,
  /// <summary>
  /// XML Text, zlib compressed, usable in Win32 native reporting engine and .Net engine
  /// </summary>
  XMLZlib,
}

/// <summary>
/// When exporting a document to PDF, there are some standard predefinded fonts you can use,
/// using this fonts redude file size
/// </summary>
export enum PDFFontType {
  /// <summary>Helvetica font, same look as Microsoft Arial, variable pitch</summary>
  Helvetica,
  /// <summary>Courier font, classic fixed pitch font</summary>
  Courier,
  /// <summary>Times Roman  font, classic variable pitch font</summary>
  TimesRoman,
  /// <summary>Symbol font, provided to print standard symbols</summary>
  Symbol,
  /// <summary>ZafDingbats font, provided to print other symbols</summary>
  ZafDingbats,
  /// <summary>Linked will store a reference to the font in the Adobe PDF file, the file
  /// size will not be increased, but destination computer (computer that opens the pdf file)
  /// must have the referenced installed</summary>
  Linked,
  /// <summary>Embedded will store the font data in the Adobe PDF file, the file
  /// size will be increased, but ensures the destination computer (computer that opens the pdf file)
  /// will render correctly the document</summary>
  Embedded,
}

/// <summary>
/// Enumeration indicating the text alignment, that is how the text is drawn inside the defined box
/// </summary>
export enum TextAlignType {
  /// <summary>Align the text to the left of the bounding box</summary>
  Left,
  /// <summary>Align the text to the right of the bounding box</summary>
  Right,
  /// <summary>Align the text to the center of the bounding box</summary>
  Center,
  /// <summary>Align the text to the left and the right of the bounding box, inserting spaces
  /// to align on both sides</summary>
  Justify,
}
/// <summary>
/// Enumeration indicating vertical text alignment, that is how the full text, after horizontal alignment is done, is drawn inside the defined box
/// </summary>
export enum TextAlignVerticalType {
  /// <summary>Align the text to the top of the bounding box</summary>
  Top,
  /// <summary>Align the text to the bottom of the bounding box</summary>
  Bottom,
  /// <summary>Align the text to the center of the bounding box</summary>
  Center,
}
/// <summary>
/// When printing to dot matrix devices, a fixed pitch font will be selected, the font to be selected can be specified
/// using the PrintStep
/// </summary>
export enum PrintStepType {
  /// <summary>The font size will determine the step, smaller sizes will select cpi20</summary>
  BySize,
  /// <summary>20 character per inch font</summary>
  cpi20,
  /// <summary>20 character per inch font</summary>
  cpi17,
  /// <summary>17 character per inch font</summary>
  cpi15,
  /// <summary>15 character per inch font</summary>
  cpi12,
  /// <summary>10 character per inch font</summary>
  cpi10,
  /// <summary>6 character per inch font</summary>
  cpi6,
  /// <summary>5 character per inch font</summary>
  cpi5,
}

export enum FontStyle {
  None = 0,
  Bold = 1 << 0, // 1
  Italic = 1 << 1, // 2
  Underline = 1 << 2, // 4
  Strikeout = 1 << 3, // 8
}

export enum PDFConformanceType {
  PDF_1_4 = 0,
  PDF_A_3 = 1,
}

export type CopyClass = "Items";
