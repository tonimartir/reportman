import { unzlibSync } from "fflate";
import { Report } from "../models/report.js";
import { ReportItem } from "../models/report-item.js";
import { SubReport } from "../models/sub-report.js";
import { Section } from "../models/section.js";
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
import { TextAlignType, TextAlignVerticalType } from "../models/types.js";
import { Variant, VariantType } from "../models/variant.js";
import { UndoCue } from "../models/undo-cue.js";
import { readUndoCueJson } from "./undo-cue-json.js";
import { ensureComponentNames, markReadFromXml, setItemName } from "./report-names.js";
import { setChildSubReport, setParentSection, setParentSubReport, setSectionSubReport } from "./report-links.js";
import { base64ToBytes, bytesToBase64, bytesToLatin1, codeUnitsToString, utf8ToString } from "../../util/bytes.js";
import {
  CsFormatError,
  csFromOADate,
  csSubstring,
  csToDouble,
  csToInt16,
  csToInt32,
  csToUpper,
  csTrim,
  csTrimEndChar,
  isCsWhiteSpace,
} from "../../util/cs.js";

/** The message of the error a Delphi DFM report (text or binary, plain or zlib) gives. */
export const DFM_FORMAT_MESSAGE =
  "This .rep file is in Delphi DFM format; save it as XML from the Report Manager designer, or convert it with @reportman/dfm (dfmToXml, or the reportman-dfm2xml command).";

/**
 * An error reading a report. propertyName is the property or item it is about, when the engine
 * names one (its NamedException).
 */
export class ReportReaderError extends Error {
  constructor(
    message: string,
    public readonly propertyName?: string
  ) {
    super(message);
    this.name = "ReportReaderError";
  }
}

/**
 * Reads a .rep report saved as XML, plain or zlib compressed, as the C# engine's ReportReader
 * does (Report.LoadFromStream without the conversion to .Net drivers): a new Report.
 */
export function readReportXml(bytes: Uint8Array): Report {
  const report = new Report();
  loadReportXml(report, bytes);
  return report;
}

/**
 * Reads a .rep report into an existing Report, as C# ReportReader.LoadFromStream: the connections,
 * datasets, parameters, subreports, embedded files, component list and undo history are replaced;
 * the report properties the file does not have keep their values.
 */
export function loadReportXml(report: Report, bytes: Uint8Array): void {
  // Before reading: the reader names the items in the list it keys by uppercase names.
  markReadFromXml(report);
  new ReportXmlReader(report).loadFromBytes(bytes);
}

/**
 * The components of a section saved as XML (C# ReportReader.ReadFromString: the designer's copy of
 * a section), created for the given report: their names are registered in its component list.
 */
export function readComponentsXml(contents: string, report: Report): PrintPosItem[] {
  return new ReportXmlReader(report).readFromString(contents);
}

// MetaFile alignment flags.
const AlignmentFlags_AlignRight = 2;
const AlignmentFlags_AlignHJustify = 1024;
const AlignmentFlags_AlignHCenter = 4;
const AlignmentFlags_AlignVCenter = 32;
const AlignmentFlags_AlignBottom = 16;

/** StringUtil.IsAlpha: ['0'..'9','a'..'z','A'..'Z','(',')','.',' ',';',':','_','=']. */
/** Windows-1252 from 128 to 159 (from 160 to 255 it is Latin-1). */
const CP1252_HIGH = [
  0x20ac, 0x0081, 0x201a, 0x0192, 0x201e, 0x2026, 0x2020, 0x2021, 0x02c6, 0x2030, 0x0160, 0x2039, 0x0152, 0x008d, 0x017d, 0x008f,
  0x0090, 0x2018, 0x2019, 0x201c, 0x201d, 0x2022, 0x2013, 0x2014, 0x02dc, 0x2122, 0x0161, 0x203a, 0x0153, 0x009d, 0x017e, 0x0178,
];

function isAlpha(c: number): boolean {
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

/** StringUtil.HexToBytes: uppercase hexadecimal digits only, anything else is skipped. */
function hexToBytes(hex: string, buf: Uint8Array): number {
  let binindex = 0;
  let highnibble = -1;
  for (let hexindex = 0; hexindex < hex.length; hexindex++) {
    const c = hex.charCodeAt(hexindex);
    let aval = -1;
    if (c >= 48 && c <= 57) aval = c - 48;
    else if (c >= 65 && c <= 70) aval = c - 55;
    if (aval >= 0) {
      if (highnibble >= 0) {
        aval = aval + (highnibble << 4);
        highnibble = -1;
        if (binindex >= buf.length) {
          // C# parity: writing past the buffer of the declared size throws IndexOutOfRangeException.
          throw new RangeError("Index was outside the bounds of the array.");
        }
        buf[binindex] = aval;
        binindex++;
      } else highnibble = aval;
    }
  }
  return binindex;
}

/** Delphi TStrings.Text: one item per line (CR LF, CR or LF); a final line break adds no item. */
function delphiTextToStrings(text: string): string[] {
  const list: string[] = [];
  let start = 0;
  let i = 0;
  while (i < text.length) {
    const c = text.charCodeAt(i);
    if (c === 13 || c === 10) {
      list.push(text.substring(start, i));
      if (c === 13 && i + 1 < text.length && text.charCodeAt(i + 1) === 10) i++;
      start = i + 1;
    }
    i++;
  }
  if (start < text.length) list.push(text.substring(start));
  return list;
}

/** The engine's newline separated texts (Param.Descriptions, Hints, ErrorMessages) as its JSON writes them. */
function splitNewlineText(text: string): string[] {
  return text.length === 0 ? [] : text.split("\n");
}

/**
 * ChartItem.SeriesColorsText: the setter parses a Delphi comma text into integers (separators:
 * commas and blanks, quotes trimmed, invalid items dropped) and the getter joins them with commas.
 */
export function normalizeSeriesColorsText(value: string): string {
  if (!value) return "";
  const colors: number[] = [];
  for (const token of value.split(/[, \t\r\n]/)) {
    if (token.length === 0) continue;
    let t = token;
    while (t.startsWith('"')) t = t.substring(1);
    while (t.endsWith('"')) t = t.substring(0, t.length - 1);
    try {
      colors.push(csToInt32(t));
    } catch {
      // int.TryParse failed: the item is dropped.
    }
  }
  return colors.join(",");
}

/** The C# class of a report item, for the messages that name it. */
function csTypeName(item: ReportItem): string {
  switch (item.className) {
    case "TRPSUBREPORT":
      return "SubReport";
    case "TRPSECTION":
      return "Section";
    case "TRPLABEL":
      return "LabelItem";
    case "TRPEXPRESSION":
      return "ExpressionItem";
    case "TRPSHAPE":
      return "ShapeItem";
    case "TRPIMAGE":
      return "ImageItem";
    case "TRPBARCODE":
      return "BarcodeItem";
    case "TRPCHART":
      return "ChartItem";
    case "TRPPARAM":
      return "Param";
    case "TRPDATAINFOITEM":
      return "DataInfo";
    case "TRPDATABASEINFOITEM":
      return "DatabaseInfo";
    default:
      return String(item.className);
  }
}

function isDfm(buf: Uint8Array): boolean {
  if (buf.length === 0) return false;
  // Text DFM ("object TRpReport"), or binary DFM (the TPF0 signature).
  if (buf[0] === 0x6f) return true;
  return buf.length >= 4 && buf[0] === 0x54 && buf[1] === 0x50 && buf[2] === 0x46 && buf[3] === 0x30;
}

function invalidFormatException(): never {
  throw new ReportReaderError("Invalid format");
}

/** The port of the C# ReportReader (Reportman.Reporting/ReportReader.cs). */
class ReportXmlReader {
  private astring = "";
  private position = 0;
  private propname = "";
  private proptype = "";
  private propsize = "";
  private propvalue = "";
  private compclass = "";

  constructor(private readonly areport: Report) {}

  public loadFromBytes(bytes: Uint8Array): void {
    let buf = bytes;
    let asize = buf.length;
    if (asize === 0) throw new ReportReaderError("Zero Length stream");
    if (buf[0] === 0x78) {
      // 'x': zlib compressed (the engine's XMLZlib stream format)
      try {
        buf = unzlibSync(bytes);
      } catch (e) {
        throw new ReportReaderError("Invalid zlib compressed report: " + (e instanceof Error ? e.message : String(e)));
      }
      asize = buf.length;
    }
    if (isDfm(buf)) throw new ReportReaderError(DFM_FORMAT_MESSAGE);
    if (asize === 0) {
      // C# parity: new string(achar, 0, asize - 1) with an empty uncompressed stream.
      throw new RangeError("Length cannot be less than zero.");
    }
    // C# parity: one character per byte (no decoding), and the last byte is dropped.
    this.astring = bytesToLatin1(buf, 0, asize - 1);
    this.intReadFromString();
  }

  public readFromString(contents: string): PrintPosItem[] {
    const nresult: PrintPosItem[] = [];
    this.astring = contents;
    this.position = 0;
    this.findNextName();
    while (this.tag() !== "/SECTION") {
      if (this.tag() === "COMPONENT") {
        nresult.push(this.readComponent());
      } else if (this.tag() === "SECTION") {
        this.findNextName();
      } else if (this.tag() === "/COMPONENT") {
        this.findNextName();
      } else {
        throw new Error("Invalid XML name " + this.propname);
      }
    }
    for (const comp of nresult) this.updateRightToLeft(comp);
    return nresult;
  }

  // ---- The C# Name setter, component list and names (ReportItem.Name, BaseReport) ----

  /** ReportItem.Name setter: renames, registering the item in the report's component list. */
  private setName(item: ReportItem, value: string): void {
    setItemName(this.areport.components, item, value);
  }

  private resetReportState(): void {
    const rp = this.areport;
    rp.undoCue = undefined;
    rp.databaseInfo = [];
    rp.dataInfo = [];
    rp.params = [];
    rp.subReports = [];
    rp.embeddedFiles = [];
    rp.components = new Map<string, ReportItem>();
  }

  // ---- Tokenizer ----

  /** The current tag (a method, so that TypeScript does not narrow it across findNextName calls). */
  private tag(): string {
    return this.propname;
  }

  private findNextName(): void {
    let abegin = 0;
    let aend = 0;
    const s = this.astring;
    this.propname = "";
    this.proptype = "";
    this.propsize = "";
    while (this.position < s.length) {
      const c = s.charCodeAt(this.position);
      if (c === 60) {
        if (abegin > 0) invalidFormatException();
        abegin = this.position + 1;
      } else if (c === 62) {
        if (abegin === 0) invalidFormatException();
        aend = this.position;
        this.position++;
        break;
      }
      this.position++;
    }
    if (aend === 0) invalidFormatException();
    let propname = csTrim(s.substring(abegin, aend));
    let typepos = propname.indexOf(" ");
    let props = "";
    if (typepos >= 0) {
      props = csSubstring(propname, typepos + 1);
      propname = propname.substring(0, typepos);
    }
    typepos = props.indexOf("size");
    if (typepos >= 0) {
      // C# parity: the value is taken 6 characters after "size" (size=") ...
      let propsize = csSubstring(props, typepos + 6);
      const endpos = propsize.indexOf('"');
      if (endpos <= 0) invalidFormatException();
      propsize = propsize.substring(0, endpos);
      this.propsize = propsize;
      // ... and the rest of the attributes is cut at the position of the closing quote inside the
      // size value, not inside the attributes: a type written before size is lost.
      props = csTrim(csSubstring(props, endpos + 1));
    }
    typepos = props.indexOf("type");
    if (typepos >= 0) {
      let proptype = csSubstring(props, typepos + 6);
      const endpos = proptype.indexOf('"');
      if (endpos <= 0) invalidFormatException();
      proptype = proptype.substring(0, endpos);
      this.proptype = proptype;
    }
    let end = this.position;
    while (end < s.length && s.charCodeAt(end) !== 60) end++;
    this.propvalue = s.substring(this.position, end);
    this.position = end;
    if (propname.length === 0) invalidFormatException();
    this.propname = propname;
  }

  // ---- Values ----

  /**
   * The value as text: only IsAlpha characters, #code# for any other; line breaks are dropped. A
   * String without codes above 255 has its 128 to 159 read as Windows-1252: Delphi writes a String
   * property as the bytes of its ANSI code page (the euro is 128, the quotes 145 to 148), the .Net
   * engine as UTF-16 code units (there they are C1 control characters, not text).
   */
  private getAsString(): string {
    const pv = this.propvalue;
    const units: number[] = [];
    let wide = false;
    let i = 0;
    while (i < pv.length) {
      const c = pv.charCodeAt(i);
      if (c === 35) {
        let anumber = 0;
        i++;
        while (i < pv.length) {
          const d = pv.charCodeAt(i);
          if (d === 35) {
            i++;
            break;
          }
          // C# parity: no check that it is a digit, int arithmetic.
          anumber = (Math.imul(anumber, 10) + (d - 48)) | 0;
          i++;
        }
        // (char)anumber: the low 16 bits
        units.push(anumber & 0xffff);
        if (anumber > 255) wide = true;
      } else if (isAlpha(c)) {
        units.push(c);
        i++;
      } else i++;
    }
    if (!wide && this.proptype === "String") {
      for (let j = 0; j < units.length; j++) if (units[j] >= 0x80 && units[j] <= 0x9f) units[j] = CP1252_HIGH[units[j] - 0x80];
    }
    return codeUnitsToString(units);
  }

  private getAsInteger(): number {
    return csToInt32(this.propvalue);
  }

  private getAsDouble(): number {
    return csToDouble(this.propvalue);
  }

  /** A Delphi TDateTime (days since 1899-12-30) as the local Date of the same wall-clock time. */
  private getAsDateTime(): Date {
    return csFromOADate(this.getAsDouble());
  }

  private getAsBool(): boolean {
    return this.propvalue === "True";
  }

  /** StringUtil-based Strings.Fill of the reader: one trimmed item per line, empty lines dropped. */
  private fillStrings(list: string[]): void {
    let avalue = this.getAsString();
    let index = avalue.indexOf("\n");
    while (index >= 0) {
      list.push(csTrim(avalue.substring(0, index)));
      avalue = csTrim(avalue.substring(index + 1));
      index = avalue.indexOf("\n");
    }
    avalue = csTrim(avalue);
    if (avalue.length > 0) list.push(avalue);
  }

  /**
   * The label texts (WIDETEXT): lines split by LF, the CR of CR LF is not part of the text, and a
   * text that ends with the separator has an empty last language.
   */
  private fillStringsNoTrim(list: string[]): void {
    let avalue = this.getAsString();
    if (avalue.length === 0) return;
    let index = avalue.indexOf("\n");
    while (index >= 0) {
      addLineNoTrim(list, avalue.substring(0, index));
      avalue = avalue.substring(index + 1);
      index = avalue.indexOf("\n");
    }
    addLineNoTrim(list, avalue);
  }

  /** The bytes of a binary property: hexadecimal of the declared size. */
  private binToBytes(): Uint8Array {
    const alen = csToInt32(this.propsize);
    if (alen === 0) return new Uint8Array(0);
    if (alen < 0) {
      // C# parity: new byte[negative] throws OverflowException.
      throw new RangeError("Arithmetic operation resulted in an overflow.");
    }
    const abufdest = new Uint8Array(alen);
    const readed = hexToBytes(this.propvalue, abufdest);
    if (readed !== alen) throw new ReportReaderError("Expected: " + this.propsize + " Found: " + readed.toString());
    return abufdest;
  }

  /**
   * BinToStream into the stream of a section or an image: the bytes are written at its position,
   * always 0, over what it had (a longer old content keeps its tail), as a MemoryStream does.
   */
  private binToStreamBase64(current: string): string {
    const bytes = this.binToBytes();
    if (bytes.length === 0) return current;
    const old = current.length > 0 ? base64ToBytes(current) : new Uint8Array(0);
    if (old.length <= bytes.length) return bytesToBase64(bytes);
    const merged = old.slice();
    merged.set(bytes, 0);
    return bytesToBase64(merged);
  }

  private readUndoCue(): UndoCue | undefined {
    const bytes = this.binToBytes();
    return readUndoCueJson(utf8ToString(bytes));
  }

  // ---- The document ----

  private intReadFromString(): void {
    const rp = this.areport;
    this.resetReportState();
    this.position = this.astring.indexOf("<REPORT");
    if (this.position < 0)
      throw new ReportReaderError("Report must begin with <REPORT" + String.fromCharCode(10) + this.astring);
    this.findNextName();
    this.findNextName();
    while (this.tag().length > 0) {
      if (this.tag() === "/REPORT") break;
      if (this.tag() === "DATABASEINFO") {
        this.findNextName();
        if (this.tag() !== "ALIAS") invalidFormatException();
        const dbitem = new DatabaseInfo();
        dbitem.alias = this.getAsString();
        rp.databaseInfo.push(dbitem);
        this.findNextName();
        while (this.tag() !== "/DATABASEINFO") {
          this.readPropDBInfo(dbitem);
          this.findNextName();
        }
      } else if (this.tag() === "DATAINFO") {
        this.findNextName();
        if (this.tag() !== "ALIAS") invalidFormatException();
        const ditem = new DataInfo();
        ditem.alias = this.getAsString();
        rp.dataInfo.push(ditem);
        this.findNextName();
        while (this.tag() !== "/DATAINFO") {
          this.readPropDataInfo(ditem);
          this.findNextName();
        }
      } else if (this.tag() === "PARAMETER") {
        this.findNextName();
        if (this.tag() !== "NAME") invalidFormatException();
        const aparam = new Param();
        aparam.alias = this.getAsString();
        rp.params.push(aparam);
        this.findNextName();
        while (this.tag() !== "/PARAMETER") {
          this.readPropParam(aparam);
          this.findNextName();
        }
      } else if (this.tag() === "EMBEDDEDFILE") {
        const efile = new EmbeddedFile();
        this.findNextName();
        while (this.tag() !== "/EMBEDDEDFILE") {
          if (this.tag() === "FILENAME") efile.fileName = this.getAsString();
          else if (this.tag() === "MIMETYPE") efile.mimeType = this.getAsString();
          else if (this.tag() === "DESCRIPTION") efile.description = this.getAsString();
          else if (this.tag() === "CREATIONDATE") efile.creationDate = this.getAsString();
          else if (this.tag() === "MODIFICATIONDATE") efile.modificationDate = this.getAsString();
          else if (this.tag() === "RELATIONSHIP") efile.afRelationShip = this.getAsInteger();
          else if (this.tag() === "STREAM") efile.streamBase64 = bytesToBase64(this.binToBytes());
          else throw new ReportReaderError("Embededed file wrong property:" + this.propname, "Embedded file");
          const oldprop = this.propname;
          this.findNextName();
          if (this.tag() !== "/" + oldprop)
            throw new ReportReaderError("Embededed file property not closed:" + this.propname, "Embedded file");
          this.findNextName();
        }
        // Without STREAM (other writers, a hand edit) the file is empty: the writer reads it
        if (efile.streamBase64 === undefined) efile.streamBase64 = "";
        rp.embeddedFiles.push(efile);
      } else if (this.tag() === "SUBREPORT") {
        this.findNextName();
        if (this.tag() !== "NAME") invalidFormatException();
        const subrep = new SubReport();
        this.setName(subrep, this.getAsString());
        rp.subReports.push(subrep);
        this.findNextName();
        while (this.tag() !== "/SUBREPORT") {
          if (this.tag() === "SECTION") {
            this.findNextName();
            if (this.tag() !== "NAME") invalidFormatException();
            const sec = new Section();
            subrep.sections.push(sec);
            this.setName(sec, this.getAsString());
            this.findNextName();
            while (this.tag() !== "/SECTION") {
              if (this.tag() === "COMPONENT") {
                sec.components.push(this.readComponent());
              } else this.readPropSection(sec);
              this.findNextName();
            }
          } else this.readPropSubReport(subrep);
          this.findNextName();
        }
      } else this.readPropReport();
      this.findNextName();
    }
    this.reloadLinks();
    // Ensure all components have names (needed for undo/redo, older versions didn't require
    // names for DataInfo, etc.)
    ensureComponentNames(rp);
    this.updateDerivedValues();
  }

  /** A COMPONENT: its name, its class and its properties, up to /COMPONENT. */
  private readComponent(): PrintPosItem {
    this.findNextName();
    if (this.tag() !== "NAME") invalidFormatException();
    const compname = this.getAsString();
    this.findNextName();
    this.findNextName();
    if (this.tag() !== "CLASSNAME") invalidFormatException();
    this.compclass = this.getAsString();
    const comp = this.createComponent();
    this.setName(comp, compname);
    this.findNextName();
    while (this.tag() !== "/COMPONENT") {
      this.readCompProp(comp);
      this.findNextName();
    }
    return comp;
  }

  /**
   * The links between subreports and sections: the same lookups and errors, the subreport name of
   * each section, and the object references C# keeps (the writer saves them: report-links.ts).
   */
  private reloadLinks(): void {
    const rp = this.areport;
    const lookup = (name: string, cast: (item: ReportItem) => boolean, typeName: string): ReportItem => {
      const item = rp.components.get(name);
      if (item === undefined) {
        // C# parity: the indexer of the component list throws before the engine's own check.
        throw new ReportReaderError(`The given key '${name}' was not present in the dictionary.`, name);
      }
      if (!cast(item)) {
        throw new ReportReaderError(
          `Unable to cast object of type 'Reportman.Reporting.${csTypeName(item)}' to type 'Reportman.Reporting.${typeName}'.`,
          name
        );
      }
      return item;
    };
    for (const subrep of rp.subReports) {
      if (subrep.parentSub.length > 0)
        setParentSubReport(subrep, lookup(subrep.parentSub, (i) => i instanceof SubReport, "SubReport") as SubReport);
      if (subrep.parentSec.length > 0)
        setParentSection(subrep, lookup(subrep.parentSec, (i) => i instanceof Section, "Section") as Section);
    }
    // The sections after every PARENTSUBREPORT: the section of a child sets its parent, also when
    // the child comes later (reports saved before named the child itself)
    for (const subrep of rp.subReports) {
      for (const sec of subrep.sections) {
        if (sec.childSubReportName.length > 0) {
          const child = lookup(sec.childSubReportName, (i) => i instanceof SubReport, "SubReport") as SubReport;
          setChildSubReport(sec, child);
          setParentSection(child, sec);
          // The subreport of the section (it was the child itself)
          setParentSubReport(child, subrep);
        }
        if (sec.subReportName.length > 0) {
          sec.subReportName = subrep.name;
          setSectionSubReport(sec, subrep);
        }
      }
    }
  }

  /**
   * The values the engine's JSON derives from others, set as it gives them: rightToLeft from the
   * bidirectional mode of the report language, and the value of a multiple selection parameter.
   */
  private updateDerivedValues(): void {
    const rp = this.areport;
    for (const subrep of rp.subReports)
      for (const sec of subrep.sections) for (const comp of sec.components) this.updateRightToLeft(comp);
    for (const param of rp.params) {
      if (param.paramType === ParamType.Multiple) {
        // C# parity: Param.Value of a multiple selection parameter is the selected values joined
        // by commas (GetMultiValue), whatever VALUE held.
        param.value = { type: VariantType.String, value: param.selected.join(",") };
      }
    }
  }

  private updateRightToLeft(comp: PrintPosItem): void {
    if (comp instanceof PrintItemText) {
      comp.rightToLeft = PrintItemText.getBidiMode(comp, this.areport.language) !== BidiModeType.No;
    }
  }

  // ---- Properties ----

  private readPropReport(): void {
    const rp = this.areport;
    switch (this.propname) {
      case "WFONTNAME":
        rp.wFontName = this.getAsString();
        break;
      case "BINCUE":
        rp.undoCue = this.readUndoCue();
        break;
      case "LFONTNAME":
        rp.lFontName = this.getAsString();
        break;
      case "GRIDVISIBLE":
        rp.gridVisible = this.getAsBool();
        break;
      case "GRIDLINES":
        rp.gridLines = this.getAsBool();
        break;
      case "GRIDENABLED":
        rp.gridEnabled = this.getAsBool();
        break;
      case "GRIDCOLOR":
        rp.gridColor = this.getAsInteger();
        break;
      case "GRIDWIDTH":
        rp.gridWidth = this.getAsInteger();
        break;
      case "GRIDHEIGHT":
        rp.gridHeight = this.getAsInteger();
        break;
      case "PAGEORIENTATION":
        rp.pageOrientation = this.getAsInteger();
        break;
      case "PAGESIZE":
        rp.pageSize = this.getAsInteger();
        break;
      case "PAGESIZEQT":
        rp.pageSizeIndex = this.getAsInteger();
        break;
      case "PAGEHEIGHT":
        rp.pageHeight = this.getAsInteger();
        break;
      case "PAGEWIDTH":
        rp.pageWidth = this.getAsInteger();
        break;
      case "CUSTOMPAGEHEIGHT":
        rp.customPageHeight = this.getAsInteger();
        break;
      case "CUSTOMPAGEWIDTH":
        rp.customPageWidth = this.getAsInteger();
        break;
      case "PAGEBACKCOLOR":
        rp.pageBackColor = this.getAsInteger();
        break;
      case "PREVIEWSTYLE":
        rp.autoScale = this.getAsInteger();
        break;
      case "PREVIEWMARGINS":
        rp.previewMargins = this.getAsBool();
        break;
      case "PREVIEWWINDOW":
        rp.previewWindow = this.getAsInteger();
        break;
      case "LEFTMARGIN":
        rp.leftMargin = this.getAsInteger();
        break;
      case "TOPMARGIN":
        rp.topMargin = this.getAsInteger();
        break;
      case "RIGHTMARGIN":
        rp.rightMargin = this.getAsInteger();
        break;
      case "BOTTOMMARGIN":
        rp.bottomMargin = this.getAsInteger();
        break;
      case "PRINTERSELECT":
        rp.printerSelect = this.getAsInteger();
        break;
      case "LANGUAGE":
        rp.language = this.getAsInteger();
        break;
      case "COPIES":
        rp.copies = this.getAsInteger();
        break;
      case "COLLATECOPIES":
        rp.collateCopies = this.getAsBool();
        break;
      case "TWOPASS":
        rp.twoPass = this.getAsBool();
        break;
      case "PRINTERFONTS":
        rp.printerFonts = this.getAsInteger();
        break;
      case "PRINTONLYIFDATAAVAILABLE":
        rp.printOnlyIfDataAvailable = this.getAsBool();
        break;
      case "STREAMFORMAT":
        rp.streamFormat = this.getAsInteger();
        break;
      case "REPORTACTIONDRAWERBEFORE":
        rp.actionBefore = this.getAsBool();
        break;
      case "REPORTACTIONDRAWERAFTER":
        rp.actionAfter = this.getAsBool();
        break;
      case "PREVIEWABOUT":
        rp.previewAbout = this.getAsBool();
        break;
      case "TYPE1FONT":
        rp.type1Font = this.getAsInteger();
        break;
      case "FONTSIZE":
        rp.fontSize = csToInt16(this.getAsInteger());
        break;
      case "FONTROTATION":
        rp.fontRotation = csToInt16(this.getAsInteger());
        break;
      case "FONTSTYLE":
        rp.fontStyle = this.getAsInteger();
        break;
      case "FONTCOLOR":
        rp.fontColor = this.getAsInteger();
        break;
      case "BACKCOLOR":
        rp.backColor = this.getAsInteger();
        break;
      case "TRANSPARENT":
        rp.transparent = this.getAsBool();
        break;
      case "CUTTEXT":
        rp.cutText = this.getAsBool();
        break;
      case "ALIGNMENT":
        rp.alignment = this.readAlignment();
        break;
      case "VALIGNMENT":
        rp.vAlignment = this.readVAlignment();
        break;
      case "WORDWRAP":
        rp.wordWrap = this.getAsBool();
        break;
      case "SINGLELINE":
        rp.singleLine = this.getAsBool();
        break;
      case "BIDIMODES":
        break;
      case "MULTIPAGE":
        rp.multiPage = this.getAsBool();
        break;
      case "PRINTSTEP":
        rp.printStep = this.getAsInteger();
        break;
      case "PAPERSOURCE":
        rp.paperSource = this.getAsInteger();
        break;
      case "DUPLEX":
        rp.duplex = this.getAsInteger();
        break;
      case "FORCEPAPERNAME":
        rp.forcePaperName = this.getAsString();
        break;
      case "LINESPERINCH":
        rp.linesPerInch = csToInt16(this.getAsInteger());
        break;
      case "PDFCONFORMANCE":
        rp.pdfConformance = this.getAsInteger();
        break;
      case "PDFCOMPRESSED":
        rp.pdfCompressed = this.getAsBool();
        break;
      case "DOCAUTHOR":
        rp.docAuthor = this.getAsString();
        break;
      case "DOCCREATOR":
        rp.docCreator = this.getAsString();
        break;
      case "DOCPRODUCER":
        rp.docProducer = this.getAsString();
        break;
      case "DOCSUBJECT":
        rp.docSubject = this.getAsString();
        break;
      case "DOCTITLE":
        rp.docTitle = this.getAsString();
        break;
      case "DOCCREATIONDATE":
        rp.docCreationDate = this.getAsString();
        break;
      case "DOCMODIFICATIONDATE":
        rp.docModificationDate = this.getAsString();
        break;
      case "DOCKEYWORDS":
        rp.docKeywords = this.getAsString();
        break;
      case "DOCXMPCONTENT":
        rp.docXMPContent = this.getAsString();
        break;
      default:
        if (this.propname[0] !== "/")
          throw new ReportReaderError("Property not supported in Report: " + this.propname, this.propname);
        break;
    }
  }

  /** The horizontal alignment flags of the metafile as an alignment. */
  private readAlignment(): TextAlignType {
    let newalign = TextAlignType.Left;
    const aalign = this.getAsInteger();
    if ((aalign & AlignmentFlags_AlignRight) > 0) newalign = TextAlignType.Right;
    else if ((aalign & AlignmentFlags_AlignHCenter) > 0) newalign = TextAlignType.Center;
    else if ((aalign & AlignmentFlags_AlignHJustify) > 0) newalign = TextAlignType.Justify;
    return newalign;
  }

  /** The vertical alignment flags of the metafile as an alignment. */
  private readVAlignment(): TextAlignVerticalType {
    let vnewalign = TextAlignVerticalType.Top;
    const valign = this.getAsInteger();
    if ((valign & AlignmentFlags_AlignBottom) > 0) vnewalign = TextAlignVerticalType.Bottom;
    else if ((valign & AlignmentFlags_AlignVCenter) > 0) vnewalign = TextAlignVerticalType.Center;
    return vnewalign;
  }

  private readPropSubReport(subrep: SubReport): void {
    switch (this.propname) {
      case "ALIAS":
        subrep.alias = this.getAsString();
        break;
      case "PARENTSUBREPORT":
        subrep.parentSub = csToUpper(this.getAsString());
        break;
      case "PARENTSECTION":
        subrep.parentSec = csToUpper(this.getAsString());
        break;
      case "PRINTONLYIFDATAAVAILABLE":
        subrep.printOnlyIfDataAvailable = this.getAsBool();
        break;
      case "REOPENONPRINT":
        subrep.reOpenOnPrint = this.getAsBool();
        break;
      case "NAME":
        this.setName(subrep, this.getAsString());
        break;
      default:
        if (this.propname[0] !== "/")
          throw new ReportReaderError("Property not supported in SubReport: " + this.propname, this.propname);
        break;
    }
  }

  private createComponent(): PrintPosItem {
    // C# parity: the class is the raw text of CLASSNAME, not its decoded value.
    switch (this.propvalue) {
      case "TRPEXPRESSION":
        return new ExpressionItem();
      case "TRPLABEL":
        return new LabelItem();
      case "TRPCHART":
        return new ChartItem();
      case "TRPSHAPE":
        return new ShapeItem();
      case "TRPIMAGE":
        return new ImageItem();
      case "TRPBARCODE":
        return new BarcodeItem();
      default:
        throw new ReportReaderError("Class not supported:" + this.propvalue, this.propvalue);
    }
  }

  private readPropSection(sec: Section): void {
    // C# parity: every error reading a section property (unknown property, invalid number...) is
    // ignored.
    try {
      switch (this.propname) {
        case "CHANGEEXPRESSION":
          sec.changeExpression = this.getAsString();
          break;
        case "BEGINPAGEEXPRESSION":
          sec.beginPageExpression = this.getAsString();
          break;
        case "BEGINPAGE":
          sec.beginPage = this.getAsBool();
          break;
        case "SKIPEXPREV":
          sec.skipExpreV = this.getAsString();
          break;
        case "SKIPEXPREH":
          sec.skipExpreH = this.getAsString();
          break;
        case "SKIPTOPAGEEXPRE":
          sec.skipToPageExpre = this.getAsString();
          break;
        case "BACKEXPRESSION":
          sec.backExpression = this.getAsString();
          break;
        case "PRINTCONDITION":
          sec.printCondition = this.getAsString();
          break;
        case "DOAFTERPRINT":
          sec.doAfterPrint = this.getAsString();
          break;
        case "DOBEFOREPRINT":
          sec.doBeforePrint = this.getAsString();
          break;
        case "WIDTH":
          sec.width = this.getAsInteger();
          break;
        case "HEIGHT":
          sec.height = this.getAsInteger();
          break;
        case "SUBREPORT":
          sec.subReportName = csToUpper(this.getAsString());
          break;
        case "GROUPNAME":
          sec.groupName = this.getAsString();
          break;
        case "CHANGEBOOL":
          sec.changeBool = this.getAsBool();
          break;
        case "PAGEREPEAT":
          sec.pageRepeat = this.getAsBool();
          break;
        case "FORCEPRINT":
          sec.forcePrint = this.getAsBool();
          break;
        case "SKIPPAGE":
          sec.skipPage = this.getAsBool();
          break;
        case "ALIGNBOTTOM":
          sec.alignBottom = this.getAsBool();
          break;
        case "SYNCWIDTH":
          sec.syncWidth = this.getAsBool();
          break;
        case "SECTIONTYPE":
          sec.sectionType = this.getAsInteger();
          break;
        case "AUTOEXPAND":
          sec.autoExpand = this.getAsBool();
          break;
        case "AUTOCONTRACT":
          sec.autoContract = this.getAsBool();
          break;
        case "HORZDESP":
          sec.horzDesp = this.getAsBool();
          break;
        case "VERTDESP":
          sec.vertDesp = this.getAsBool();
          break;
        case "EXTERNALFILENAME":
          sec.externalFilename = this.getAsString();
          break;
        case "EXTERNALCONNECTION":
          sec.externalConnection = this.getAsString();
          break;
        case "EXTERNALTABLE":
          sec.externalTable = this.getAsString();
          break;
        case "EXTERNALFIELD":
          sec.externalField = this.getAsString();
          break;
        case "EXTERNALSEARCHFIELD":
          sec.externalSearchField = this.getAsString();
          break;
        case "EXTERNALSEARCHVALUE":
          sec.externalSearchValue = this.getAsString();
          break;
        case "STREAMFORMAT":
          sec.streamFormat = this.getAsInteger();
          break;
        case "CHILDSUBREPORT":
          sec.childSubReportName = csToUpper(this.getAsString());
          break;
        case "SKIPRELATIVEH":
          sec.skipRelativeH = this.getAsBool();
          break;
        case "SKIPRELATIVEV":
          sec.skipRelativeV = this.getAsBool();
          break;
        case "SKIPTYPE":
          sec.skipType = this.getAsInteger();
          break;
        case "ININUMPAGE":
          sec.iniNumPage = this.getAsBool();
          break;
        case "GLOBAL":
          sec.global = this.getAsBool();
          break;
        case "BACKSTYLE":
          sec.backStyle = this.getAsInteger();
          break;
        case "DPIRES":
          sec.dpires = this.getAsInteger();
          break;
        case "DRAWSTYLE":
          sec.drawStyle = this.getAsInteger();
          break;
        case "CACHEDIMAGE":
          if (this.propvalue !== "False") sec.sharedImage = this.getAsInteger();
          break;
        case "STREAM":
          sec.streamBase64 = this.binToStreamBase64(sec.streamBase64);
          break;
        case "NAME":
          this.setName(sec, this.getAsString());
          break;
        default:
          if (this.propname[0] !== "/")
            throw new ReportReaderError("Property not suported in Section:" + this.propname, this.propname);
          break;
      }
    } catch {
      // ignored, as the engine does
    }
  }

  private readPropDBInfo(dbitem: DatabaseInfo): void {
    switch (this.propname) {
      case "CONFIGFILE":
        dbitem.configFile = this.getAsString();
        break;
      case "LOADPARAMS":
        dbitem.loadParams = this.getAsBool();
        break;
      case "LOADDRIVERPARAMS":
        break;
      case "LOGINPROMPT":
        break;
      case "PROVIDERFACTORY":
        dbitem.providerFactory = this.getAsString();
        break;
      case "DRIVER":
        dbitem.driver = this.getAsInteger();
        break;
      case "DOTNETDRIVER":
        dbitem.dotNetDriver = this.getAsInteger();
        break;
      case "REPORTTABLE":
        dbitem.reportTable = this.getAsString();
        break;
      case "REPORTSEARCHFIELD":
        dbitem.reportSearchField = this.getAsString();
        break;
      case "REPORTFIELD":
        dbitem.reportField = this.getAsString();
        break;
      case "REPORTGROUPSTABLE":
        dbitem.reportGroupsTable = this.getAsString();
        break;
      case "ADOCONNECTIONSTRING":
        dbitem.connectionString = this.getAsString();
        break;
      case "NAME":
        this.setName(dbitem, this.getAsString());
        break;
      default:
        if (this.propname[0] !== "/")
          throw new ReportReaderError("Property not suported in Databaseinfo:" + this.propname, this.propname);
        break;
    }
  }

  private readPropDataInfo(ditem: DataInfo): void {
    switch (this.propname) {
      case "DATABASEALIAS":
        ditem.databaseAlias = this.getAsString();
        break;
      case "NAME":
        this.setName(ditem, this.getAsString());
        break;
      case "SQL":
        ditem.sql = this.getAsString();
        break;
      case "DATASOURCE":
        ditem.dataSource = this.getAsString();
        break;
      case "SQLEXPLANATION":
        ditem.sqlExplanation = this.getAsString();
        break;
      case "SQLEXPLANATIONERROR":
        ditem.sqlExplanationError = this.getAsString();
        break;
      case "HUBSCHEMAID":
        ditem.hubSchemaId = this.getAsInteger();
        break;
      case "SCHEMANAME":
        ditem.schemaName = this.getAsString();
        break;
      case "MYBASEFILENAME":
        ditem.myBaseFilename = this.getAsString();
        break;
      case "MYBASEFIELDS":
        ditem.myBaseFields = this.getAsString();
        break;
      case "MYBASEINDEXFIELDS":
        ditem.myBaseIndexFields = this.getAsString();
        break;
      case "MYBASEMASTERFIELDS":
        ditem.myBaseMasterFields = this.getAsString();
        break;
      case "BDEINDEXFIELDS":
        ditem.bdeIndexFields = this.getAsString();
        break;
      case "BDEINDEXNAME":
        ditem.bdeIndexName = this.getAsString();
        break;
      case "BDETABLE":
        ditem.bdeTable = this.getAsString();
        break;
      case "BDETYPE":
        ditem.bdeType = this.getAsInteger();
        break;
      case "BDEFILTER":
        ditem.bdeFilter = this.getAsString();
        break;
      case "BDEMASTERFIELDS":
        ditem.bdeMasterFields = this.getAsString();
        break;
      case "BDEFIRSTRANGE":
        ditem.bdeFirstRange = this.getAsString();
        break;
      case "BDELASTRANGE":
        ditem.bdeLastRange = this.getAsString();
        break;
      case "DATAUNIONS":
        this.fillStrings(ditem.dataUnions);
        break;
      case "GROUPUNION":
        ditem.groupUnion = this.getAsBool();
        break;
      case "PARALLELUNION":
        ditem.parallelUnion = this.getAsBool();
        break;
      case "OPENONSTART":
        ditem.openOnStart = this.getAsBool();
        break;
      default:
        if (this.propname[0] !== "/")
          throw new ReportReaderError("Property not suported in Datainfo:" + this.propname, this.propname);
        break;
    }
  }

  private readPropParam(aparam: Param): void {
    switch (this.propname) {
      case "DESCRIPTION":
        aparam.descriptions = splitNewlineText(this.getAsString());
        break;
      case "HINT":
        aparam.hints = splitNewlineText(this.getAsString());
        break;
      case "ERRORMESSAGE":
        aparam.errorMessages = splitNewlineText(this.getAsString());
        break;
      case "VALIDATION":
        aparam.validation = this.getAsString();
        break;
      case "SEARCH":
        aparam.search = this.getAsString();
        break;
      case "VISIBLE":
        aparam.visible = this.getAsBool();
        break;
      case "ISREADONLY":
        aparam.isReadOnly = this.getAsBool();
        break;
      case "NEVERVISIBLE":
        aparam.neverVisible = this.getAsBool();
        break;
      case "ALLOWNULLS":
        aparam.allowNulls = this.getAsBool();
        break;
      case "PARAMTYPE":
        aparam.paramType = this.getAsInteger();
        break;
      case "DATASETS":
        this.fillStrings(aparam.datasets);
        break;
      case "ITEMS":
        this.fillStrings(aparam.items);
        break;
      case "VALUES":
        this.fillStrings(aparam.values);
        break;
      case "SELECTED":
        this.fillStrings(aparam.selected);
        break;
      case "LOOKUPDATASET":
        aparam.lookupDataset = this.getAsString();
        break;
      case "SEARCHPARAM":
        aparam.searchParam = this.getAsString();
        break;
      case "SEARCHDATASET":
        aparam.searchDataset = this.getAsString();
        break;
      case "VALUE":
        this.readParamValue(aparam);
        break;
      case "INTNAME":
        this.setName(aparam, this.getAsString());
        break;
      default:
        if (this.propname[0] !== "/")
          throw new ReportReaderError("Property not suported in Param:" + this.propname, this.propname);
        break;
    }
  }

  private readParamValue(aparam: Param): void {
    try {
      aparam.value = this.readParamValueByType(aparam.paramType);
    } catch (e) {
      if (!(e instanceof CsFormatError)) throw e;
      // string.Equals(proptype, "String", OrdinalIgnoreCase)
      if (csToUpper(this.proptype) !== "STRING") throw e;
      this.repairStringSerializedParamValue(aparam);
    }
  }

  private readParamValueByType(paramType: ParamType): Variant {
    switch (paramType) {
      case ParamType.String:
      case ParamType.ExpreA:
      case ParamType.ExpreB:
      case ParamType.Subst:
      case ParamType.SubstExpre:
      case ParamType.List:
      case ParamType.SubsExpreList:
      case ParamType.InitialValue:
      case ParamType.Unknown:
        return { type: VariantType.String, value: this.getAsString() };
      case ParamType.Integer:
        return { type: VariantType.Integer, value: this.getAsInteger() };
      case ParamType.Double:
      case ParamType.Currency:
        return { type: VariantType.Double, value: this.getAsDouble() };
      case ParamType.Date:
      case ParamType.Time:
      case ParamType.DateTime:
        return { type: VariantType.DateTime, value: this.getAsDateTime() };
      case ParamType.Bool:
        return { type: VariantType.Boolean, value: this.getAsBool() };
      default:
        return { type: VariantType.String, value: this.getAsString() };
    }
  }

  /** A date, time or date and time parameter saved as text by an older designer. */
  private repairStringSerializedParamValue(aparam: Param): void {
    const stringValue = this.getAsString();
    const repaired = tryParseDateLikeParamValue(stringValue);
    if (repaired) {
      aparam.paramType = repaired.paramType;
      aparam.value = { type: VariantType.DateTime, value: repaired.value };
      return;
    }
    aparam.paramType = ParamType.String;
    aparam.value = { type: VariantType.String, value: stringValue };
  }

  private readCompProp(comp: PrintPosItem): void {
    let assigned = false;
    switch (this.propname) {
      case "PRINTCONDITION":
        comp.printCondition = this.getAsString();
        assigned = true;
        break;
      case "DOAFTERPRINT":
        comp.doAfterPrint = this.getAsString();
        assigned = true;
        break;
      case "ANNOTATION":
        comp.annotationExpression = this.getAsString();
        assigned = true;
        break;
      case "DOBEFOREPRINT":
        comp.doBeforePrint = this.getAsString();
        assigned = true;
        break;
      case "WIDTH":
        comp.width = this.getAsInteger();
        assigned = true;
        break;
      case "HEIGHT":
        comp.height = this.getAsInteger();
        assigned = true;
        break;
      case "POSX":
        comp.posX = this.getAsInteger();
        assigned = true;
        break;
      case "POSY":
        comp.posY = this.getAsInteger();
        assigned = true;
        break;
      case "ALIGN":
        comp.align = this.getAsInteger();
        assigned = true;
        break;
      case "NAME":
        this.setName(comp, this.getAsString());
        assigned = true;
        break;
    }
    if (assigned) return;
    if (comp instanceof PrintItemText) {
      const compt = comp;
      switch (this.propname) {
        case "WFONTNAME":
          compt.wFontName = this.getAsString();
          assigned = true;
          break;
        case "LFONTNAME":
          compt.lFontName = this.getAsString();
          assigned = true;
          break;
        case "TYPE1FONT":
          compt.type1Font = this.getAsInteger();
          assigned = true;
          break;
        case "FONTSIZE":
          compt.fontSize = csToInt16(this.getAsInteger());
          assigned = true;
          break;
        case "FONTROTATION":
          compt.fontRotation = csToInt16(this.getAsInteger());
          assigned = true;
          break;
        case "FONTSTYLE":
          compt.fontStyle = this.getAsInteger();
          assigned = true;
          break;
        case "FONTCOLOR":
          compt.fontColor = this.getAsInteger();
          assigned = true;
          break;
        case "BACKCOLOR":
          compt.backColor = this.getAsInteger();
          assigned = true;
          break;
        case "TRANSPARENT":
          compt.transparent = this.getAsBool();
          assigned = true;
          break;
        case "CUTTEXT":
          compt.cutText = this.getAsBool();
          assigned = true;
          break;
        case "ALIGNMENT":
          compt.alignment = this.readAlignment();
          assigned = true;
          break;
        case "VALIGNMENT":
          compt.vAlignment = this.readVAlignment();
          assigned = true;
          break;
        case "WORDWRAP":
          compt.wordWrap = this.getAsBool();
          assigned = true;
          break;
        case "ISHTML":
          compt.isHtml = this.getAsBool();
          assigned = true;
          break;
        case "SINGLELINE":
          compt.singleLine = this.getAsBool();
          assigned = true;
          break;
        case "WORDBREAK":
          compt.wordBreak = this.getAsBool();
          assigned = true;
          break;
        case "INTERLINE":
          compt.interLine = this.getAsInteger();
          assigned = true;
          break;
        case "BIDIMODES":
          // Every language, as Delphi reads it (BidiModes.Text): written after BIDIMODE, so it wins
          compt.bidiModes = delphiTextToStrings(this.getAsString());
          assigned = true;
          break;
        case "BIDIMODE": {
          // Mode of the current language (Delphi TRpBidiMode: 0 No, 1 Partial, 2 Full)
          const value = this.getAsInteger();
          const mode = value === 1 ? BidiModeType.Partial : value === 2 ? BidiModeType.Full : BidiModeType.No;
          setBidiModeOnly(compt, this.areport.language, mode);
          assigned = true;
          break;
        }
        case "MULTIPAGE":
          compt.multiPage = this.getAsBool();
          assigned = true;
          break;
        case "PRINTSTEP":
          compt.printStep = this.getAsInteger();
          assigned = true;
          break;
      }
    }
    if (assigned) return;
    if (comp instanceof LabelItem) {
      switch (this.propname) {
        case "WIDETEXT":
          this.fillStringsNoTrim(comp.allStrings);
          assigned = true;
          break;
      }
    }
    if (comp instanceof ExpressionItem) {
      const compe = comp;
      switch (this.propname) {
        case "EXPRESSION":
          compe.expression = this.getAsString();
          assigned = true;
          break;
        case "AGINIVALUE":
          compe.agIniValue = this.getAsString();
          assigned = true;
          break;
        case "EXPORTEXPRESSION":
          compe.exportExpression = this.getAsString();
          assigned = true;
          break;
        case "DATATYPE":
          compe.dataType = this.getAsInteger();
          assigned = true;
          break;
        case "DISPLAYFORMAT":
          compe.displayFormat = this.getAsString();
          assigned = true;
          break;
        case "IDENTIFIER":
          compe.identifier = this.getAsString();
          assigned = true;
          break;
        case "GROUPNAME":
          compe.groupName = this.getAsString();
          assigned = true;
          break;
        case "AGGREGATE":
          compe.aggregate = this.getAsInteger();
          assigned = true;
          break;
        case "AGTYPE":
          compe.agType = this.getAsInteger();
          assigned = true;
          break;
        case "AUTOEXPAND":
          compe.autoExpand = this.getAsBool();
          assigned = true;
          break;
        case "AUTOCONTRACT":
          compe.autoContract = this.getAsBool();
          assigned = true;
          break;
        case "PRINTONLYONE":
          compe.printOnlyOne = this.getAsBool();
          assigned = true;
          break;
        case "PRINTNULLS":
          compe.printNulls = this.getAsBool();
          assigned = true;
          break;
        case "EXPORTDISPLAYFORMAT":
          compe.exportDisplayFormat = this.getAsString();
          assigned = true;
          break;
        case "EXPORTLINE":
          compe.exportLine = this.getAsInteger();
          assigned = true;
          break;
        case "EXPORTPOSITION":
          compe.exportPosition = this.getAsInteger();
          assigned = true;
          break;
        case "EXPORTSIZE":
          compe.exportSize = this.getAsInteger();
          assigned = true;
          break;
        case "EXPORTDONEWLINE":
          compe.exportDoNewLine = this.getAsBool();
          assigned = true;
          break;
      }
    }
    if (assigned) return;
    if (comp instanceof ShapeItem) {
      const comps = comp;
      switch (this.propname) {
        case "SHAPE":
          comps.shape = this.getAsInteger();
          assigned = true;
          break;
        case "BRUSHSTYLE":
          comps.brushStyle = this.getAsInteger();
          assigned = true;
          break;
        case "BRUSHCOLOR":
          comps.brushColor = this.getAsInteger();
          assigned = true;
          break;
        case "PENSTYLE":
          comps.penStyle = this.getAsInteger();
          assigned = true;
          break;
        case "PENCOLOR":
          comps.penColor = this.getAsInteger();
          assigned = true;
          break;
        case "PENWIDTH":
          comps.penWidth = this.getAsInteger();
          assigned = true;
          break;
      }
    }
    if (assigned) return;
    if (comp instanceof ImageItem) {
      const compi = comp;
      switch (this.propname) {
        case "EXPRESSION":
          compi.expression = this.getAsString();
          assigned = true;
          break;
        case "DPIRES":
          compi.dpires = this.getAsInteger();
          assigned = true;
          break;
        case "DRAWSTYLE":
          compi.drawStyle = this.getAsInteger();
          assigned = true;
          break;
        case "CACHEDIMAGE":
          if (this.propvalue !== "False") compi.sharedImage = this.getAsInteger();
          assigned = true;
          break;
        case "STREAM":
          compi.streamBase64 = this.binToStreamBase64(compi.streamBase64);
          assigned = true;
          break;
        case "ROTATION":
          compi.rotation = csToInt16(this.getAsInteger());
          assigned = true;
          break;
        case "COPYMODE":
          compi.copyMode = this.getAsInteger();
          assigned = true;
          break;
      }
    }
    if (assigned) return;
    if (comp instanceof BarcodeItem) {
      const compb = comp;
      switch (this.propname) {
        case "EXPRESSION":
          compb.expression = this.getAsString();
          assigned = true;
          break;
        case "MODUL":
          compb.modul = this.getAsInteger();
          assigned = true;
          break;
        case "RATIO":
          compb.ratio = this.getAsDouble();
          assigned = true;
          break;
        case "TYP":
          compb.barType = this.getAsInteger();
          assigned = true;
          break;
        case "CHECKSUM":
          compb.checksum = this.getAsBool();
          assigned = true;
          break;
        case "TRANSPARENT":
          compb.transparent = this.getAsBool();
          assigned = true;
          break;
        case "DISPLAYFORMAT":
          compb.displayFormat = this.getAsString();
          assigned = true;
          break;
        case "ROTATION":
          compb.rotation = csToInt16(this.getAsInteger());
          assigned = true;
          break;
        case "BCOLOR":
          compb.bColor = this.getAsInteger();
          assigned = true;
          break;
        case "BACKCOLOR":
          compb.backColor = this.getAsInteger();
          assigned = true;
          break;
        case "NUMCOLUMNS":
          compb.numColumns = this.getAsInteger();
          assigned = true;
          break;
        case "NUMROWS":
          compb.numRows = this.getAsInteger();
          assigned = true;
          break;
        case "ECCLEVEL":
          compb.eccLevel = this.getAsInteger();
          assigned = true;
          break;
        case "TRUNCATED":
          compb.truncated = this.getAsBool();
          assigned = true;
          break;
      }
    }
    if (assigned) return;
    if (comp instanceof ChartItem) {
      const compc = comp;
      switch (this.propname) {
        case "VALUEEXPRESSION":
          compc.valueExpression = this.getAsString();
          assigned = true;
          break;
        case "VALUEXEXPRESSION":
          compc.valueXExpression = this.getAsString();
          assigned = true;
          break;
        case "GETVALUECONDITION":
          compc.getValueCondition = this.getAsString();
          assigned = true;
          break;
        case "CHANGESERIEEXPRESSION":
          compc.changeSerieExpression = this.getAsString();
          assigned = true;
          break;
        case "CAPTIONEXPRESSION":
          compc.captionExpression = this.getAsString();
          assigned = true;
          break;
        case "COLOREXPRESSION":
          compc.colorExpression = this.getAsString();
          assigned = true;
          break;
        case "SERIECOLOREXPRESSION":
          compc.serieColorExpression = this.getAsString();
          assigned = true;
          break;
        case "SERIECAPTION":
          compc.serieCaption = this.getAsString();
          assigned = true;
          break;
        case "CLEAREXPRESSION":
          compc.clearExpression = this.getAsString();
          assigned = true;
          break;
        case "IDENTIFIER":
          compc.identifier = this.getAsString();
          assigned = true;
          break;
        case "CHANGESERIEBOOL":
          compc.changeSerieBool = this.getAsBool();
          assigned = true;
          break;
        case "CLEAREXPRESSIONBOOL":
          compc.clearExpressionBool = this.getAsBool();
          assigned = true;
          break;
        case "CHARTTYPE":
          compc.chartStyle = this.getAsInteger();
          assigned = true;
          break;
        case "DRIVER":
          compc.driver = this.getAsInteger();
          assigned = true;
          break;
        case "VIEW3D":
          compc.view3d = this.getAsBool();
          assigned = true;
          break;
        case "VIEW3DWALLS":
          compc.view3dWalls = this.getAsBool();
          assigned = true;
          break;
        case "PERSPECTIVE":
          compc.perspective = this.getAsInteger();
          assigned = true;
          break;
        case "ELEVATION":
          compc.elevation = this.getAsInteger();
          assigned = true;
          break;
        case "ROTATION":
          compc.rotation = this.getAsInteger();
          assigned = true;
          break;
        case "ZOOM":
          compc.zoom = this.getAsInteger();
          assigned = true;
          break;
        case "HORZOFFSET":
          compc.horzOffset = this.getAsInteger();
          assigned = true;
          break;
        case "VERTOFFSET":
          compc.vertOffset = this.getAsInteger();
          assigned = true;
          break;
        case "TILT":
          compc.tilt = this.getAsInteger();
          assigned = true;
          break;
        case "ORTHOGONAL":
          compc.orthogonal = this.getAsBool();
          assigned = true;
          break;
        case "MULTIBAR":
          compc.multiBar = this.getAsInteger();
          assigned = true;
          break;
        case "RESOLUTION":
          compc.resolution = this.getAsInteger();
          assigned = true;
          break;
        case "SHOWLEGEND":
          compc.showLegend = this.getAsBool();
          assigned = true;
          break;
        case "SHOWHINT":
          compc.showHint = this.getAsBool();
          assigned = true;
          break;
        case "MARKSTYLE":
          compc.markStyle = this.getAsInteger();
          assigned = true;
          break;
        case "HORZFONTSIZE":
          compc.horzFontSize = this.getAsInteger();
          assigned = true;
          break;
        case "VERTFONTSIZE":
          compc.vertFontSize = this.getAsInteger();
          assigned = true;
          break;
        case "HORZFONTROTATION":
          compc.horzFontRotation = this.getAsInteger();
          assigned = true;
          break;
        case "VERTFONTROTATION":
          compc.vertFontRotation = this.getAsInteger();
          assigned = true;
          break;
        case "AUTORANGE":
          compc.autoRange = this.getAsInteger();
          assigned = true;
          break;
        case "YMIN":
          compc.axisYInitial = this.getAsDouble();
          assigned = true;
          break;
        case "YMAX":
          compc.axisYFinal = this.getAsDouble();
          assigned = true;
          break;
        case "SERIESCOLORS":
          compc.seriesColorsText = normalizeSeriesColorsText(this.getAsString());
          assigned = true;
          break;
      }
    }
    if (assigned) return;
    if (this.propname[0] !== "/")
      throw new ReportReaderError("Property not suported in " + this.compclass + ":" + this.propname);
  }
}

/** One label text: the CRs at its end are dropped. */
function addLineNoTrim(list: string[], line: string): void {
  // The language separator in WIDETEXT is CR LF: the CR is not part of the text. Older versions
  // split only on LF and kept one more CR at the end of each language on every save; they are
  // removed here (it repairs those reports). A language made only of CRs is an empty language of
  // those reports: it is kept, so the next ones do not move.
  list.push(csTrimEndChar(line, 13));
}

/** The C# BidiMode setter: only the list of modes (rightToLeft is derived at the end of the read). */
function setBidiModeOnly(item: PrintItemText, language: number, mode: BidiModeType): void {
  const langindex = PrintItemText.bidiLanguageIndex(language);
  while (item.bidiModes.length <= langindex) item.bidiModes.push(PrintItemText.bidiModeToString(BidiModeType.No));
  item.bidiModes[langindex] = PrintItemText.bidiModeToString(mode);
}

function daysInMonth(year: number, month: number): number {
  if (month === 2) return (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0 ? 29 : 28;
  return [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][month - 1];
}

/**
 * DateTime.TryParseExact(value, ["yyyy-MM-dd", "HH:mm:ss", "yyyy-MM-ddTHH:mm:ss",
 * "yyyy-MM-ddTHH:mm:ss.fff", "yyyy-MM-ddTHH:mm:ss.fffffff"], InvariantCulture, None) and the type
 * the reader infers from the text: 'T' a date and time, ':' a time (on today's date, as .NET does
 * for a time without date), otherwise a date.
 */
function tryParseDateLikeParamValue(value: string): { value: Date; paramType: ParamType } | undefined {
  let allWhite = true;
  for (let i = 0; i < value.length; i++) {
    if (!isCsWhiteSpace(value.charCodeAt(i))) {
      allWhite = false;
      break;
    }
  }
  if (allWhite) return undefined;
  let m = /^(\d{4})-(\d{2})-(\d{2})(?:T(\d{2}):(\d{2}):(\d{2})(?:\.(\d{3}|\d{7}))?)?$/.exec(value);
  let year: number;
  let month: number;
  let day: number;
  let hour = 0;
  let minute = 0;
  let second = 0;
  let ms = 0;
  if (m) {
    year = Number(m[1]);
    month = Number(m[2]);
    day = Number(m[3]);
    if (m[4] !== undefined) {
      hour = Number(m[4]);
      minute = Number(m[5]);
      second = Number(m[6]);
      if (m[7] !== undefined) ms = Math.floor(Number(m[7].padEnd(7, "0")) / 10000);
    }
  } else {
    m = /^(\d{2}):(\d{2}):(\d{2})$/.exec(value);
    if (!m) return undefined;
    const today = new Date();
    year = today.getFullYear();
    month = today.getMonth() + 1;
    day = today.getDate();
    hour = Number(m[1]);
    minute = Number(m[2]);
    second = Number(m[3]);
  }
  if (year < 1 || month < 1 || month > 12 || day < 1 || day > daysInMonth(year, month)) return undefined;
  if (hour > 23 || minute > 59 || second > 59) return undefined;
  const date = new Date(2000, 0, 1);
  date.setFullYear(year, month - 1, day);
  date.setHours(hour, minute, second, ms);
  const paramType = value.indexOf("T") >= 0 ? ParamType.DateTime : value.indexOf(":") >= 0 ? ParamType.Time : ParamType.Date;
  return { value: date, paramType };
}
