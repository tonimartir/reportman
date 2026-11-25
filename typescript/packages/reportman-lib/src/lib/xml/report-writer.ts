import { zlibSync } from "fflate";
import { Report } from "../models/report.js";
import { Section } from "../models/section.js";
import { SubReport } from "../models/sub-report.js";
import { DatabaseInfo } from "../models/database-info.js";
import { DataInfo } from "../models/data-info.js";
import { Param, ParamType } from "../models/param.js";
import { PrintPosItem } from "../models/print-pos-item.js";
import { BidiModeType, PrintItemText } from "../models/print-item-text.js";
import { LabelItem } from "../models/label-item.js";
import { ExpressionItem } from "../models/expression-item.js";
import { ShapeItem } from "../models/shape-item.js";
import { ImageItem } from "../models/image-item.js";
import { BarcodeItem } from "../models/barcode-item.js";
import { ChartItem } from "../models/chart-item.js";
import { EmbeddedFile } from "../models/embedded-file.js";
import { PDFConformanceType, StreamFormatType, TextAlignType, TextAlignVerticalType } from "../models/types.js";
import { Variant, VariantType } from "../models/variant.js";
import { UndoCue } from "../models/undo-cue.js";
import { writeUndoCueJson } from "./undo-cue-json.js";
import { ensureComponentNames } from "./report-names.js";
import { getChildSubReport, getParentSection, getParentSubReport, getSectionSubReport } from "./report-links.js";
import { normalizeSeriesColorsText } from "./report-reader.js";
import { base64ToBytes, bytesToHex, latin1ToBytes, stringToUtf8 } from "../../util/bytes.js";
import { csDoubleToString, csDoubleToStringG15, csToDouble, csToInt32, isCsWhiteSpace } from "../../util/cs.js";

/**
 * An error saving a report, with the message the C# engine gives in the same case (a null
 * reference, a value of a parameter of another type...).
 */
export class ReportWriterError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ReportWriterError";
  }
}

/**
 * The report as .rep XML, as the designer's server saves it (C# ReportBatchJsonAdapter
 * .SerializeReport(report, Xml)): the items without a name get one (EnsureComponentNames), the
 * stream format is XML while it is written (the document says so) and the text is the one of
 * BaseReport.SaveToStream (RestoreInitialValues, then ReportWriter, stream version 2: the names of
 * the items and the undo history). Pure ASCII, one LF after each line, no BOM.
 *
 * As C#, saving changes the report: the names given, an initial value parameter evaluated by the
 * engine back to its expression, and the text value of an integer, double or currency parameter
 * that is a number becomes that number.
 *
 * The subreport of each section (SUBREPORT), the subreport it prints (CHILDSUBREPORT) and the
 * parents of a subreport (PARENTSUBREPORT, PARENTSECTION) are written from the links readReportXml
 * and updateReferences keep (report-links.ts), as C# writes them from its object references: a
 * report hydrated from its JSON has no SUBREPORT until updateReferences, which is what the server
 * does to the JSON it receives; a section never linked prints the subreport its childSubReportName
 * names.
 */
export function writeReportXml(report: Report): string {
  ensureComponentNames(report);
  const originalFormat = report.streamFormat;
  try {
    report.streamFormat = StreamFormatType.XML;
    return saveReportText(report);
  } finally {
    report.streamFormat = originalFormat;
  }
}

/** writeReportXml as its UTF-8 bytes (the text is ASCII: one byte per character). */
export function writeReportXmlBytes(report: Report): Uint8Array {
  return latin1ToBytes(writeReportXml(report));
}

/**
 * C# BaseReport.SaveToStream (no EnsureComponentNames): the XML text, zlib compressed when the
 * report's stream format is XMLZlib. The compressed bytes are not those of C# (SharpZipLib): the
 * same document, another deflate encoder.
 */
export function saveReportBytes(report: Report): Uint8Array {
  const text = latin1ToBytes(saveReportText(report));
  if (report.streamFormat === StreamFormatType.XMLZlib) return zlibSync(text, { level: 6 });
  return text;
}

/**
 * ReportWriter.WriteComponents: the components inside a SECTION element (the designer's copy of
 * components, read back by readComponentsXml). The report gives the current language of their
 * bidirectional mode (none: the default language, as C# does for an item without a report).
 */
export function writeComponentsXml(items: PrintPosItem[], report?: Report): string {
  const w = new XmlLines();
  w.line("<SECTION>");
  for (const item of items) writeComponent(w, item, report);
  w.line("</SECTION>");
  return w.text();
}

/** BaseReport.SaveToStream as text: RestoreInitialValues, then ReportWriter.SaveToStream. */
function saveReportText(report: Report): string {
  restoreInitialValues(report);
  const w = new XmlLines();
  w.line('<?xml version="1.0" standalone="no"?>');
  w.line("<!DOCTYPE REPORT_MANAGER_2>");
  w.line("<REPORT>");
  writeReportProps(w, report);
  for (const dbinfo of report.databaseInfo ?? []) {
    w.line("<DATABASEINFO>");
    writeDatabaseInfo(w, dbinfo);
    w.line("</DATABASEINFO>");
  }
  for (const dinfo of report.dataInfo ?? []) {
    w.line("<DATAINFO>");
    writeDataInfo(w, dinfo);
    w.line("</DATAINFO>");
  }
  for (const param of report.params ?? []) {
    w.line("<PARAMETER>");
    writeParam(w, param, report);
    w.line("</PARAMETER>");
  }
  for (const subrep of report.subReports ?? []) {
    w.line("<SUBREPORT>");
    writeSubReport(w, subrep);
    for (const section of subrep.sections ?? []) writeSection(w, section, report);
    w.line("</SUBREPORT>");
  }
  for (const efile of report.embeddedFiles ?? []) {
    w.line("<EMBEDDEDFILE>");
    writeEmbeddedFile(w, efile);
    w.line("</EMBEDDEDFILE>");
  }
  w.line("</REPORT>");
  return w.text();
}

/**
 * BaseReport.RestoreInitialValues: a parameter whose initial expression the engine evaluated
 * (Param.EvaluatedInitialExpression) is saved as that expression. The parameters of this model
 * never hold one; an engine parameter (evaluatedInitialExpression) does.
 */
function restoreInitialValues(report: Report): void {
  for (const p of report.params ?? []) {
    const evaluated = (p as { evaluatedInitialExpression?: unknown }).evaluatedInitialExpression;
    if (typeof evaluated !== "string") continue;
    p.paramType = ParamType.InitialValue;
    p.value = { type: VariantType.String, value: evaluated };
    (p as { evaluatedInitialExpression?: unknown }).evaluatedInitialExpression = null;
  }
}

// ---- The lines and the values (StreamUtil.SWriteLine, ReportWriter.WritePropertyX) ----

const C_MAXDATAWIDTH = 40;

/** ReportWriter.RpIsAlpha: '0'-'9', 'A'-'Z', 'a'-'z' and "_ .()=;:". */
function rpIsAlpha(c: number): boolean {
  return (
    (c >= 48 && c <= 57) ||
    (c >= 65 && c <= 90) ||
    (c >= 97 && c <= 122) ||
    c === 95 ||
    c === 32 ||
    c === 46 ||
    c === 40 ||
    c === 41 ||
    c === 61 ||
    c === 59 ||
    c === 58
  );
}

/**
 * ReportWriter.StringToRpString: the characters out of RpIsAlpha as #code# (the UTF-16 code
 * unit), and a CR LF when a line of the value passes 40 characters.
 */
function stringToRpString(value: string | null | undefined): string {
  const s = value ?? "";
  const parts: string[] = [];
  let alen = 0;
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    if (rpIsAlpha(c)) {
      parts.push(s[i]);
      alen++;
    } else {
      const sub = "#" + c + "#";
      parts.push(sub);
      alen += sub.length;
    }
    if (alen > C_MAXDATAWIDTH) {
      alen = 0;
      parts.push("\r\n");
    }
  }
  return parts.join("");
}

/** The text of an int (C# Int32.ToString). */
function intText(value: unknown, property: string): string {
  if (value === undefined || value === null) return "0";
  const n = typeof value === "boolean" ? (value ? 1 : 0) : Number(value);
  if (!Number.isInteger(n) || n > 2147483647 || n < -2147483648)
    throw new ReportWriterError(`The value of ${property} is not an integer: ${String(value)}`);
  return n === 0 ? "0" : String(n);
}

class XmlLines {
  private readonly parts: string[] = [];
  line(s: string): void {
    this.parts.push(s, "\n");
  }
  text(): string {
    return this.parts.join("");
  }
  S(name: string, value: string | null | undefined): void {
    this.line("<" + name + ' type="String">' + stringToRpString(value) + "</" + name + ">");
  }
  I(name: string, value: unknown): void {
    this.line("<" + name + ' type="Integer">' + intText(value, name) + "</" + name + ">");
  }
  B(name: string, value: unknown): void {
    this.line("<" + name + ' type="Boolean">' + (value ? "True" : "False") + "</" + name + ">");
  }
  D(name: string, value: number): void {
    this.line("<" + name + ' type="Double">' + csDoubleToString(Number(value)) + "</" + name + ">");
  }
  DateTime(name: string, days: number): void {
    this.line("<" + name + ' type="DateTime">' + csDoubleToString(days) + "</" + name + ">");
  }
  Bin(name: string, bytes: Uint8Array): void {
    this.line(
      "<" + name + ' type="Binary" size="' + bytes.length + '">' + stringToRpString(bytesToHex(bytes)) + "</" + name + ">"
    );
  }
}

function hasText(s: string | null | undefined): s is string {
  return s !== undefined && s !== null && s.length > 0;
}

/** string.IsNullOrWhiteSpace. */
function isNullOrWhiteSpace(s: string | null | undefined): boolean {
  if (s === undefined || s === null) return true;
  for (let i = 0; i < s.length; i++) if (!isCsWhiteSpace(s.charCodeAt(i))) return false;
  return true;
}

/** Strings.Text: the items joined by CR LF. */
function stringsText(list: readonly string[] | string | null | undefined): string {
  if (list === undefined || list === null) return "";
  if (typeof list === "string") return list;
  return list.map((x) => x ?? "").join("\r\n");
}

/** The engine's newline separated texts (Param.Descriptions, Hints, ErrorMessages), one line per language. */
function newlineText(list: readonly string[] | string | null | undefined): string {
  if (list === undefined || list === null) return "";
  if (typeof list === "string") return list;
  return list.map((x) => x ?? "").join("\n");
}

/** The metafile flags of a horizontal alignment. */
function alignmentFlags(alignment: TextAlignType): number {
  switch (alignment) {
    case TextAlignType.Right:
      return 2;
    case TextAlignType.Center:
      return 4;
    case TextAlignType.Justify:
      return 1024;
    default:
      return 0;
  }
}

/** The metafile flags of a vertical alignment. */
function vAlignmentFlags(alignment: TextAlignVerticalType): number {
  switch (alignment) {
    case TextAlignVerticalType.Bottom:
      return 16;
    case TextAlignVerticalType.Center:
      return 32;
    default:
      return 0;
  }
}

function base64Bytes(value: string | null | undefined): Uint8Array {
  return value ? base64ToBytes(value) : new Uint8Array(0);
}

// ---- The report and its items ----

function writeReportProps(w: XmlLines, rp: Report): void {
  const cue: UndoCue | undefined = rp.undoCue;
  if (cue && ((cue.undoOperations?.length ?? 0) !== 0 || (cue.redoOperations?.length ?? 0) !== 0)) {
    w.Bin("BINCUE", stringToUtf8(writeUndoCueJson(cue)));
  }
  w.S("WFONTNAME", rp.wFontName);
  w.S("LFONTNAME", rp.lFontName);
  w.B("GRIDVISIBLE", rp.gridVisible);
  w.B("GRIDLINES", rp.gridLines);
  w.B("GRIDENABLED", rp.gridEnabled);
  w.I("GRIDCOLOR", rp.gridColor);
  w.I("GRIDWIDTH", rp.gridWidth);
  w.I("GRIDHEIGHT", rp.gridHeight);
  w.I("PAGEORIENTATION", rp.pageOrientation);
  w.I("PAGESIZE", rp.pageSize);
  w.I("PAGESIZEQT", rp.pageSizeIndex);
  w.I("PAGEHEIGHT", rp.pageHeight);
  w.I("PAGEWIDTH", rp.pageWidth);
  w.I("CUSTOMPAGEHEIGHT", rp.customPageHeight);
  w.I("CUSTOMPAGEWIDTH", rp.customPageWidth);
  w.I("PAGEBACKCOLOR", rp.pageBackColor);
  w.I("PREVIEWSTYLE", rp.autoScale);
  w.B("PREVIEWMARGINS", rp.previewMargins);
  w.I("PREVIEWWINDOW", rp.previewWindow);
  w.I("LEFTMARGIN", rp.leftMargin);
  w.I("TOPMARGIN", rp.topMargin);
  w.I("RIGHTMARGIN", rp.rightMargin);
  w.I("BOTTOMMARGIN", rp.bottomMargin);
  w.I("PRINTERSELECT", rp.printerSelect);
  w.I("LANGUAGE", rp.language);
  w.I("COPIES", rp.copies);
  w.B("COLLATECOPIES", rp.collateCopies);
  w.B("TWOPASS", rp.twoPass);
  w.I("PRINTERFONTS", rp.printerFonts);
  w.B("PRINTONLYIFDATAAVAILABLE", rp.printOnlyIfDataAvailable);
  w.I("STREAMFORMAT", rp.streamFormat);
  w.B("REPORTACTIONDRAWERBEFORE", rp.actionBefore);
  w.B("REPORTACTIONDRAWERAFTER", rp.actionAfter);
  w.B("PREVIEWABOUT", rp.previewAbout);
  w.I("TYPE1FONT", rp.type1Font);
  w.I("FONTSIZE", rp.fontSize);
  w.I("FONTROTATION", rp.fontRotation);
  w.I("FONTSTYLE", rp.fontStyle);
  w.I("FONTCOLOR", rp.fontColor);
  w.I("BACKCOLOR", rp.backColor);
  w.B("TRANSPARENT", rp.transparent);
  w.B("CUTTEXT", rp.cutText);
  w.I("ALIGNMENT", alignmentFlags(rp.alignment));
  w.I("VALIGNMENT", vAlignmentFlags(rp.vAlignment));
  w.B("WORDWRAP", rp.wordWrap);
  w.B("SINGLELINE", rp.singleLine);
  w.B("MULTIPAGE", rp.multiPage);
  w.I("PRINTSTEP", rp.printStep);
  w.I("PAPERSOURCE", rp.paperSource);
  w.I("DUPLEX", rp.duplex);
  w.S("FORCEPAPERNAME", rp.forcePaperName);
  w.I("LINESPERINCH", rp.linesPerInch);
  if ((rp.pdfConformance ?? PDFConformanceType.PDF_1_4) !== PDFConformanceType.PDF_1_4)
    w.I("PDFCONFORMANCE", rp.pdfConformance);
  if (rp.pdfCompressed) w.B("PDFCOMPRESSED", rp.pdfCompressed);
  if (hasText(rp.docAuthor)) w.S("DOCAUTHOR", rp.docAuthor);
  if (hasText(rp.docCreator)) w.S("DOCCREATOR", rp.docCreator);
  if (hasText(rp.docProducer)) w.S("DOCPRODUCER", rp.docProducer);
  if (hasText(rp.docSubject)) w.S("DOCSUBJECT", rp.docSubject);
  if (hasText(rp.docTitle)) w.S("DOCTITLE", rp.docTitle);
  if (hasText(rp.docCreationDate)) w.S("DOCCREATIONDATE", rp.docCreationDate);
  if (hasText(rp.docModificationDate)) w.S("DOCMODIFICATIONDATE", rp.docModificationDate);
  if (hasText(rp.docKeywords)) w.S("DOCKEYWORDS", rp.docKeywords);
  if (hasText(rp.docXMPContent)) w.S("DOCXMPCONTENT", rp.docXMPContent);
}

function writeDatabaseInfo(w: XmlLines, dbinfo: DatabaseInfo): void {
  w.S("ALIAS", dbinfo.alias);
  w.S("NAME", dbinfo.name);
  if (!isNullOrWhiteSpace(dbinfo.configFile)) w.S("CONFIGFILE", dbinfo.configFile);
  if (dbinfo.loadParams === false) w.B("LOADPARAMS", false);
  w.I("DRIVER", dbinfo.driver);
  w.S("REPORTTABLE", dbinfo.reportTable);
  w.S("REPORTSEARCHFIELD", dbinfo.reportSearchField);
  w.S("REPORTFIELD", dbinfo.reportField);
  w.S("REPORTGROUPSTABLE", dbinfo.reportGroupsTable);
  w.S("ADOCONNECTIONSTRING", dbinfo.connectionString);
  w.I("DOTNETDRIVER", dbinfo.dotNetDriver);
  w.S("PROVIDERFACTORY", dbinfo.providerFactory);
}

function writeDataInfo(w: XmlLines, dinfo: DataInfo): void {
  w.S("ALIAS", dinfo.alias);
  w.S("NAME", dinfo.name);
  w.S("DATABASEALIAS", dinfo.databaseAlias);
  w.S("SQL", dinfo.sql);
  if (!isNullOrWhiteSpace(dinfo.sqlExplanation)) w.S("SQLEXPLANATION", dinfo.sqlExplanation);
  if (!isNullOrWhiteSpace(dinfo.sqlExplanationError)) w.S("SQLEXPLANATIONERROR", dinfo.sqlExplanationError);
  // C# parity: (int) of the long HubSchemaId.
  if (dinfo.hubSchemaId) w.I("HUBSCHEMAID", Number(dinfo.hubSchemaId) | 0);
  if (hasText(dinfo.schemaName)) w.S("SCHEMANAME", dinfo.schemaName);
  w.S("DATASOURCE", dinfo.dataSource);
  w.S("MYBASEFILENAME", dinfo.myBaseFilename);
  w.S("MYBASEFIELDS", dinfo.myBaseFields);
  w.S("MYBASEINDEXFIELDS", dinfo.myBaseIndexFields);
  w.S("MYBASEMASTERFIELDS", dinfo.myBaseMasterFields);
  w.S("BDEINDEXFIELDS", dinfo.bdeIndexFields);
  w.S("BDEINDEXNAME", dinfo.bdeIndexName);
  w.S("BDETABLE", dinfo.bdeTable);
  w.I("BDETYPE", dinfo.bdeType);
  w.S("BDEFILTER", dinfo.bdeFilter);
  w.S("BDEMASTERFIELDS", dinfo.bdeMasterFields);
  w.S("BDEFIRSTRANGE", dinfo.bdeFirstRange);
  w.S("BDELASTRANGE", dinfo.bdeLastRange);
  w.S("DATAUNIONS", stringsText(dinfo.dataUnions));
  w.B("GROUPUNION", dinfo.groupUnion);
  w.B("OPENONSTART", dinfo.openOnStart);
  w.B("PARALLELUNION", dinfo.parallelUnion);
}

/** Strings.GetStringByIndex: the line of that index (of the first one when there is none). */
function getStringByIndex(text: string, index: number): string {
  const list: string[] = [];
  let partial = "";
  for (let i = 0; i < text.length; i++) {
    const c = text.charCodeAt(i);
    if (c === 13) {
      list.push(partial);
      partial = "";
      if (i < text.length - 1 && text.charCodeAt(i + 1) === 10) i++;
    } else if (c === 10) {
      list.push(partial);
      partial = "";
    } else partial += text[i];
  }
  list.push(partial);
  if (index < 0) index = 0;
  return index < list.length ? list[index] : list[0];
}

/**
 * Param.ErrorMessage: the message of the report's current language. C# parity: the writer saves
 * only that one, and the getter compares the length of the text (not the number of lines) with
 * the language.
 */
function currentErrorMessage(param: Param, language: number): string {
  const messages = newlineText(param.errorMessages);
  if (messages.length > language) return getStringByIndex(messages, language);
  if (messages.length > 0) return getStringByIndex(messages, 0);
  return "";
}

const TYPE_CONVERSION_ERROR = "Type conversion error";

/** The C# Variant a value of this model is: its type, or the one of the JavaScript value when they disagree. */
function csVariantType(v: Variant | undefined): VariantType {
  if (!v || v.value === null || v.value === undefined) return VariantType.Null;
  const value = v.value;
  switch (typeof value) {
    case "boolean":
      return VariantType.Boolean;
    case "string":
      return v.type === VariantType.Char && value.length === 1 ? VariantType.Char : VariantType.String;
    case "number":
      if (v.type === VariantType.Double || v.type === VariantType.Decimal) return v.type;
      if (v.type === VariantType.Integer || v.type === VariantType.Long || v.type === VariantType.Byte) return v.type;
      return Number.isInteger(value) ? VariantType.Long : VariantType.Double;
    case "bigint":
      return VariantType.Long;
    default:
      if (value instanceof Date) return VariantType.DateTime;
      return v.type;
  }
}

/** The wall-clock time of a Date (the C# DateTime of the model) in milliseconds since 1899-12-30. */
function delphiMilliseconds(value: unknown): number {
  if (!(value instanceof Date) || isNaN(value.getTime())) throw new ReportWriterError(TYPE_CONVERSION_ERROR);
  const wall = new Date(Date.UTC(2000, 0, 1));
  wall.setUTCFullYear(value.getFullYear(), value.getMonth(), value.getDate());
  wall.setUTCHours(value.getHours(), value.getMinutes(), value.getSeconds(), value.getMilliseconds());
  return wall.getTime() - Date.UTC(1899, 11, 30);
}

/** DateUtil.DateTimeToDelphiDateTime: TimeSpan.TotalDays since 1899-12-30. */
function delphiDateTime(value: unknown): number {
  const ticks = delphiMilliseconds(value) * 10000;
  return ticks / 864000000000;
}

/** DateUtil.DateTimeToDelphiDate: the whole days (TimeSpan.Days, truncated towards zero). */
function delphiDate(value: unknown): number {
  const ms = delphiMilliseconds(value);
  return (ms - (ms % 86400000)) / 86400000;
}

/** DateTime.ToString() with the en-US culture: M/d/yyyy h:mm:ss tt. */
function enUsDateTime(d: Date): string {
  const h = d.getHours();
  const h12 = h % 12 === 0 ? 12 : h % 12;
  const pad = (n: number) => String(n).padStart(2, "0");
  return (
    String(d.getMonth() + 1) +
    "/" +
    String(d.getDate()) +
    "/" +
    String(d.getFullYear()).padStart(4, "0") +
    " " +
    h12 +
    ":" +
    pad(d.getMinutes()) +
    ":" +
    pad(d.getSeconds()) +
    " " +
    (h < 12 ? "AM" : "PM")
  );
}

/** Variant.ToString() (the culture of the server: en-US). */
function variantToString(v: Variant | undefined): string {
  const type = csVariantType(v);
  const value = v?.value;
  switch (type) {
    case VariantType.Null:
      return "";
    case VariantType.Boolean:
      return value ? "True" : "False";
    case VariantType.Byte:
    case VariantType.Integer:
    case VariantType.Long:
      return String(value);
    case VariantType.Decimal:
      return Number(value).toString();
    case VariantType.Double:
      return Number(value) === 0 ? "0" : csDoubleToStringG15(Number(value));
    case VariantType.DateTime:
      return enUsDateTime(value as Date);
    case VariantType.Binary:
      throw new ReportWriterError(TYPE_CONVERSION_ERROR);
    default:
      return String(value);
  }
}

/** Implicit conversion of a Variant to int. */
function variantToInt(v: Variant | undefined): number {
  switch (csVariantType(v)) {
    case VariantType.Byte:
    case VariantType.Integer:
      return Number(v!.value);
    case VariantType.Long:
      // C# parity: (int) of a long.
      return Number(v!.value) | 0;
    default:
      throw new ReportWriterError(TYPE_CONVERSION_ERROR);
  }
}

/** Implicit conversion of a Variant to double. */
function variantToDouble(v: Variant | undefined): number {
  switch (csVariantType(v)) {
    case VariantType.Byte:
    case VariantType.Integer:
    case VariantType.Long:
    case VariantType.Decimal:
    case VariantType.Double:
      return Number(v!.value);
    default:
      throw new ReportWriterError(TYPE_CONVERSION_ERROR);
  }
}

/** Implicit conversion of a Variant to bool. */
function variantToBool(v: Variant | undefined): boolean {
  const type = csVariantType(v);
  switch (type) {
    case VariantType.Null:
      return false;
    case VariantType.Boolean:
      return Boolean(v!.value);
    case VariantType.Byte:
    case VariantType.Integer:
    case VariantType.Long:
      return Number(v!.value) !== 0;
    case VariantType.Char:
      return String(v!.value) !== "\0";
    default:
      throw new ReportWriterError(TYPE_CONVERSION_ERROR + "Implicit bool from VariantType." + type);
  }
}

/** Implicit conversion of a Variant to DateTime. */
function variantToDate(v: Variant | undefined): Date {
  if (csVariantType(v) !== VariantType.DateTime) throw new ReportWriterError(TYPE_CONVERSION_ERROR);
  return v!.value as Date;
}

/** DoubleUtil.IsNumeric(text, Integer) and Convert.ToInt32 (en-US). */
function parseIntegerText(text: string): number | undefined {
  try {
    return csToInt32(text);
  } catch {
    return undefined;
  }
}

/**
 * DoubleUtil.IsNumeric(text, Float or Currency) and Convert.ToDouble (en-US). A currency text may
 * have thousands separators, which Convert.ToDouble accepts too.
 */
function parseDoubleText(text: string, currency: boolean): number | undefined {
  try {
    return csToDouble(text);
  } catch {
    if (!currency) return undefined;
    const t = text.trim();
    if (!/^[+-]?\d{1,3}(,\d{3})+(\.\d*)?$/.test(t)) return undefined;
    return csToDouble(t.replace(/,/g, ""));
  }
}

function writeParam(w: XmlLines, aparam: Param, report: Report): void {
  w.S("NAME", aparam.alias);
  w.S("INTNAME", aparam.name);
  w.S("DESCRIPTION", newlineText(aparam.descriptions));
  w.S("HINT", newlineText(aparam.hints));
  w.S("ERRORMESSAGE", currentErrorMessage(aparam, report.language ?? -1));
  w.S("VALIDATION", aparam.validation);
  w.S("SEARCH", aparam.search);
  w.B("VISIBLE", aparam.visible);
  w.B("ISREADONLY", aparam.isReadOnly);
  w.B("NEVERVISIBLE", aparam.neverVisible);
  w.B("ALLOWNULLS", aparam.allowNulls);
  w.I("PARAMTYPE", aparam.paramType);
  w.S("DATASETS", stringsText(aparam.datasets));
  w.S("ITEMS", stringsText(aparam.items));
  w.S("VALUES", stringsText(aparam.values));
  w.S("SELECTED", stringsText(aparam.selected));
  w.S("LOOKUPDATASET", aparam.lookupDataset);
  w.S("SEARCHDATASET", aparam.searchDataset);
  w.S("SEARCHPARAM", aparam.searchParam);
  const value = aparam.value;
  switch (aparam.paramType) {
    case ParamType.String:
    case ParamType.ExpreA:
    case ParamType.ExpreB:
    case ParamType.Subst:
    case ParamType.List:
    case ParamType.SubsExpreList:
    case ParamType.InitialValue:
    case ParamType.Unknown:
      w.S("VALUE", variantToString(value));
      break;
    case ParamType.Integer:
      if (csVariantType(value) === VariantType.String) {
        const n = parseIntegerText(variantToString(value));
        if (n !== undefined) {
          // C# parity: the writer turns the parameter's value into the number.
          aparam.value = { type: VariantType.Integer, value: n };
          w.I("VALUE", n);
        } else w.S("VALUE", variantToString(value));
      } else w.I("VALUE", variantToInt(value));
      break;
    case ParamType.Double:
    case ParamType.Currency:
      if (csVariantType(value) === VariantType.String) {
        const n = parseDoubleText(variantToString(value), aparam.paramType === ParamType.Currency);
        if (n !== undefined) {
          aparam.value = { type: VariantType.Double, value: n };
          w.D("VALUE", n);
        } else w.S("VALUE", variantToString(value));
      } else w.D("VALUE", variantToDouble(value));
      break;
    case ParamType.Date:
      w.DateTime("VALUE", delphiDate(variantToDate(value)));
      break;
    case ParamType.DateTime:
    case ParamType.Time:
      w.DateTime("VALUE", delphiDateTime(variantToDate(value)));
      break;
    case ParamType.Bool:
      w.B("VALUE", variantToBool(value));
      break;
  }
}

function writeSubReport(w: XmlLines, subrep: SubReport): void {
  w.S("NAME", subrep.name);
  w.S("ALIAS", subrep.alias);
  const parentSubReport = getParentSubReport(subrep);
  if (parentSubReport) w.S("PARENTSUBREPORT", parentSubReport.name);
  const parentSection = getParentSection(subrep);
  if (parentSection) w.S("PARENTSECTION", parentSection.name);
  w.B("PRINTONLYIFDATAAVAILABLE", subrep.printOnlyIfDataAvailable);
  w.B("REOPENONPRINT", subrep.reOpenOnPrint);
}

function writeSection(w: XmlLines, sec: Section, report: Report): void {
  w.line("<SECTION>");
  w.S("NAME", sec.name);
  w.I("WIDTH", sec.width);
  w.I("HEIGHT", sec.height);
  w.S("PRINTCONDITION", sec.printCondition);
  w.S("DOBEFOREPRINT", sec.doBeforePrint);
  w.S("DOAFTERPRINT", sec.doAfterPrint);
  const owner = getSectionSubReport(sec);
  if (owner) w.S("SUBREPORT", owner.name);
  w.S("GROUPNAME", sec.groupName);
  w.S("CHANGEEXPRESSION", sec.changeExpression);
  w.S("BEGINPAGEEXPRESSION", sec.beginPageExpression);
  if (sec.beginPage) w.B("BEGINPAGE", sec.beginPage);
  w.S("SKIPEXPREV", sec.skipExpreV);
  w.S("SKIPEXPREH", sec.skipExpreH);
  w.S("SKIPTOPAGEEXPRE", sec.skipToPageExpre);
  w.S("BACKEXPRESSION", sec.backExpression);
  w.B("CHANGEBOOL", sec.changeBool);
  w.B("PAGEREPEAT", sec.pageRepeat);
  w.B("FORCEPRINT", sec.forcePrint);
  w.B("SKIPPAGE", sec.skipPage);
  w.B("ALIGNBOTTOM", sec.alignBottom);
  w.I("SECTIONTYPE", sec.sectionType);
  w.B("AUTOEXPAND", sec.autoExpand);
  w.B("AUTOCONTRACT", sec.autoContract);
  w.B("HORZDESP", sec.horzDesp);
  w.B("VERTDESP", sec.vertDesp);
  w.S("EXTERNALFILENAME", sec.externalFilename);
  w.S("EXTERNALCONNECTION", sec.externalConnection);
  w.S("EXTERNALTABLE", sec.externalTable);
  w.S("EXTERNALFIELD", sec.externalField);
  w.S("EXTERNALSEARCHFIELD", sec.externalSearchField);
  w.S("EXTERNALSEARCHVALUE", sec.externalSearchValue);
  w.I("STREAMFORMAT", sec.streamFormat);
  const child = getChildSubReport(report, sec);
  if (child) w.S("CHILDSUBREPORT", child.name);
  w.B("SKIPRELATIVEH", sec.skipRelativeH);
  w.B("SKIPRELATIVEV", sec.skipRelativeV);
  w.I("SKIPTYPE", sec.skipType);
  w.B("ININUMPAGE", sec.iniNumPage);
  w.B("GLOBAL", sec.global);
  w.I("DPIRES", sec.dpires);
  w.I("CACHEDIMAGE", sec.sharedImage);
  w.I("BACKSTYLE", sec.backStyle);
  w.I("DRAWSTYLE", sec.drawStyle);
  const stream = base64Bytes(sec.streamBase64);
  if (stream.length > 0) w.Bin("STREAM", stream);
  w.B("SYNCWIDTH", sec.syncWidth);
  for (const item of sec.components ?? []) writeComponent(w, item, report);
  w.line("</SECTION>");
}

/**
 * ReportWriter.NeedsBidiModes: BIDIMODE only says whether the current language is right to left;
 * BIDIMODES is written when the modes hold more than that.
 */
function needsBidiModes(compt: PrintItemText, current: number, rightToLeft: boolean): boolean {
  const modes = compt.bidiModes ?? [];
  for (let i = 0; i < modes.length; i++) {
    const implied = i === current && rightToLeft ? BidiModeType.Partial : BidiModeType.No;
    if (modes[i] !== PrintItemText.bidiModeToString(implied)) return true;
  }
  return false;
}

/** Delphi TStrings.Text: every item followed by CR LF. */
function delphiText(list: readonly string[]): string {
  return list.map((x) => (x ?? "") + "\r\n").join("");
}

function writeComponent(w: XmlLines, comp: PrintPosItem, report: Report | undefined): void {
  w.line("<COMPONENT>");
  w.S("NAME", comp.name);
  if (!comp.className) throw new ReportWriterError("No ClassName providem for component with name: " + comp.name);
  w.S("CLASSNAME", comp.className);
  w.I("WIDTH", comp.width);
  w.I("HEIGHT", comp.height);
  w.S("PRINTCONDITION", comp.printCondition);
  w.S("DOBEFOREPRINT", comp.doBeforePrint);
  w.S("DOAFTERPRINT", comp.doAfterPrint);
  if (hasText(comp.annotationExpression)) w.S("ANNOTATION", comp.annotationExpression);
  w.I("POSX", comp.posX);
  w.I("POSY", comp.posY);
  w.I("ALIGN", comp.align);
  if (comp instanceof PrintItemText) {
    const compt = comp;
    // The current language of the item's report (C# GetBidiLanguageIndex; 0 without a report).
    const current = report ? PrintItemText.bidiLanguageIndex(report.language) : 0;
    const modes = compt.bidiModes ?? [];
    const rightToLeft =
      modes.length > current &&
      (modes[current] === PrintItemText.bidiModeToString(BidiModeType.Partial) ||
        modes[current] === PrintItemText.bidiModeToString(BidiModeType.Full));
    w.S("WFONTNAME", compt.wFontName);
    w.S("LFONTNAME", compt.lFontName);
    // As the Delphi xml writer: Partial when right to left (also BidiFull, kept by BIDIMODES).
    w.I("BIDIMODE", rightToLeft ? 1 : 0);
    w.I("TYPE1FONT", compt.type1Font);
    w.I("FONTSIZE", compt.fontSize);
    w.I("FONTROTATION", compt.fontRotation);
    w.I("FONTSTYLE", compt.fontStyle);
    w.I("FONTCOLOR", compt.fontColor);
    w.I("BACKCOLOR", compt.backColor);
    w.B("TRANSPARENT", compt.transparent);
    w.B("CUTTEXT", compt.cutText);
    w.I("ALIGNMENT", alignmentFlags(compt.alignment));
    w.I("VALIGNMENT", vAlignmentFlags(compt.vAlignment));
    w.I("INTERLINE", compt.interLine);
    w.B("WORDWRAP", compt.wordWrap);
    if (compt.isHtml) w.B("ISHTML", compt.isHtml);
    w.B("WORDBREAK", compt.wordBreak);
    w.B("SINGLELINE", compt.singleLine);
    if (needsBidiModes(compt, current, rightToLeft)) w.S("BIDIMODES", delphiText(modes));
    w.B("MULTIPAGE", compt.multiPage);
    w.I("PRINTSTEP", compt.printStep);
  }
  if (comp instanceof LabelItem) {
    // WIDETEXT has one line per language: the CRs of a text are dropped and its LFs become spaces.
    const clean = (comp.allStrings ?? []).map((lang) => (lang ?? "").replace(/\r/g, "").replace(/\n/g, " "));
    w.S("WIDETEXT", stringsText(clean));
  } else if (comp instanceof ExpressionItem) {
    w.S("EXPRESSION", comp.expression);
    w.S("AGINIVALUE", comp.agIniValue);
    w.S("EXPORTEXPRESSION", comp.exportExpression);
    w.I("DATATYPE", comp.dataType);
    w.S("DISPLAYFORMAT", comp.displayFormat);
    w.S("IDENTIFIER", comp.identifier);
    w.I("AGGREGATE", comp.aggregate);
    w.S("GROUPNAME", comp.groupName);
    w.I("AGTYPE", comp.agType);
    w.B("AUTOEXPAND", comp.autoExpand);
    w.B("AUTOCONTRACT", comp.autoContract);
    w.B("PRINTONLYONE", comp.printOnlyOne);
    w.B("PRINTNULLS", comp.printNulls);
    w.S("EXPORTDISPLAYFORMAT", comp.exportDisplayFormat);
    w.I("EXPORTLINE", comp.exportLine);
    w.I("EXPORTPOSITION", comp.exportPosition);
    w.I("EXPORTSIZE", comp.exportSize);
    w.B("EXPORTDONEWLINE", comp.exportDoNewLine);
  } else if (comp instanceof ShapeItem) {
    w.I("SHAPE", comp.shape);
    w.I("BRUSHSTYLE", comp.brushStyle);
    w.I("BRUSHCOLOR", comp.brushColor);
    w.I("PENSTYLE", comp.penStyle);
    w.I("PENCOLOR", comp.penColor);
    w.I("PENWIDTH", comp.penWidth);
  } else if (comp instanceof ImageItem) {
    w.S("EXPRESSION", comp.expression);
    const stream = base64Bytes(comp.streamBase64);
    if (stream.length > 0) w.Bin("STREAM", stream);
    w.I("ROTATION", comp.rotation);
    w.I("DRAWSTYLE", comp.drawStyle);
    w.I("DPIRES", comp.dpires);
    w.I("COPYMODE", comp.copyMode);
    w.I("CACHEDIMAGE", comp.sharedImage);
  } else if (comp instanceof ChartItem) {
    w.S("VALUEEXPRESSION", comp.valueExpression);
    w.S("VALUEXEXPRESSION", comp.valueXExpression);
    w.S("GETVALUECONDITION", comp.getValueCondition);
    w.S("CHANGESERIEEXPRESSION", comp.changeSerieExpression);
    w.S("CAPTIONEXPRESSION", comp.captionExpression);
    w.S("COLOREXPRESSION", comp.colorExpression);
    w.S("SERIECOLOREXPRESSION", comp.serieColorExpression);
    w.S("SERIECAPTION", comp.serieCaption);
    w.S("CLEAREXPRESSION", comp.clearExpression);
    // The colors of the Delphi Series collection (as the C# getter gives them back).
    const seriesColors = normalizeSeriesColorsText(comp.seriesColorsText ?? "");
    if (seriesColors.length > 0) w.S("SERIESCOLORS", seriesColors);
    w.B("CHANGESERIEBOOL", comp.changeSerieBool);
    w.I("CHARTTYPE", comp.chartStyle);
    w.S("IDENTIFIER", comp.identifier);
    w.B("CLEAREXPRESSIONBOOL", comp.clearExpressionBool);
    w.I("DRIVER", comp.driver);
    w.B("VIEW3D", comp.view3d);
    w.B("VIEW3DWALLS", comp.view3dWalls);
    w.I("PERSPECTIVE", comp.perspective);
    w.I("ELEVATION", comp.elevation);
    w.I("ROTATION", comp.rotation);
    w.I("ZOOM", comp.zoom);
    w.I("HORZOFFSET", comp.horzOffset);
    w.I("VERTOFFSET", comp.vertOffset);
    w.I("TILT", comp.tilt);
    w.B("ORTHOGONAL", comp.orthogonal);
    w.I("MULTIBAR", comp.multiBar);
    w.I("RESOLUTION", comp.resolution);
    w.B("SHOWLEGEND", comp.showLegend);
    w.B("SHOWHINT", comp.showHint);
    w.I("MARKSTYLE", comp.markStyle);
    w.I("HORZFONTSIZE", comp.horzFontSize);
    w.I("VERTFONTSIZE", comp.vertFontSize);
    w.I("HORZFONTROTATION", comp.horzFontRotation);
    w.I("VERTFONTROTATION", comp.vertFontRotation);
    w.I("AUTORANGE", comp.autoRange);
    w.D("YMIN", comp.axisYInitial);
    w.D("YMAX", comp.axisYFinal);
  } else if (comp instanceof BarcodeItem) {
    w.S("EXPRESSION", comp.expression);
    w.I("MODUL", comp.modul);
    w.D("RATIO", comp.ratio);
    w.I("TYP", comp.barType);
    w.B("CHECKSUM", comp.checksum);
    w.B("TRANSPARENT", comp.transparent);
    w.S("DISPLAYFORMAT", comp.displayFormat);
    w.I("ROTATION", comp.rotation);
    w.I("BCOLOR", comp.bColor);
    w.I("BACKCOLOR", comp.backColor);
    w.I("NUMCOLUMNS", comp.numColumns);
    w.I("NUMROWS", comp.numRows);
    w.I("ECCLEVEL", comp.eccLevel);
    w.B("TRUNCATED", comp.truncated);
  }
  w.line("</COMPONENT>");
}

function writeEmbeddedFile(w: XmlLines, efile: EmbeddedFile): void {
  w.S("FILENAME", efile.fileName);
  w.S("MIMETYPE", efile.mimeType);
  w.S("DESCRIPTION", efile.description);
  w.S("CREATIONDATE", efile.creationDate);
  w.S("MODIFICATIONDATE", efile.modificationDate);
  w.I("RELATIONSHIP", efile.afRelationShip);
  // C# parity: an embedded file without contents (its Stream is null) cannot be saved.
  if (efile.streamBase64 === undefined || efile.streamBase64 === null)
    throw new ReportWriterError("Object reference not set to an instance of an object.");
  w.Bin("STREAM", base64Bytes(efile.streamBase64));
}
