// Generates the parity fixtures of the .rep XML reader: the C# model JSON (golden-cs model-json)
// of every XML report the tests read.
//
//   node test/generate-fixtures.mjs [--delphi <repsamples folder>]
//
// Inputs:
//   - the XML samples of this repository (../../../samples/*.rep, first byte "<"),
//   - the XML samples of the Delphi repository (repman/repsamples), copied into
//     test/fixtures/reports/delphi/ (only when the folder exists; the copies are kept),
//   - synthetic reports written here into test/fixtures/reports/synthetic/: every tag the reader
//     reads, the quirks of the format, zlib compressed copies and files the C# reader rejects.
// Outputs: test/fixtures/json/<id>.json (the C# JSON, compact) or <id>.error.json (the exception
// C# throws), and test/fixtures/cases.json, the list the tests read.
//
// Needs the built harness: dotnet build -c Release tools/golden-cs (from typescript/).

import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import zlib from "node:zlib";

const testDir = path.dirname(fileURLToPath(import.meta.url));
const packageDir = path.dirname(testDir);
const typescriptDir = path.resolve(packageDir, "..", "..");
const repoSamples = path.resolve(typescriptDir, "..", "samples");
const golden = path.join(typescriptDir, "tools", "golden-cs", "bin", "Release", "net10.0", "golden-cs.exe");
const fixturesDir = path.join(testDir, "fixtures");
const reportsDir = path.join(fixturesDir, "reports");
const delphiDir = path.join(reportsDir, "delphi");
const syntheticDir = path.join(reportsDir, "synthetic");
const jsonDir = path.join(fixturesDir, "json");

const args = process.argv.slice(2);
const delphiArg = args.indexOf("--delphi");
const delphiSource =
  delphiArg >= 0 ? args[delphiArg + 1] : "C:\\desarrollo\\prog\\toni\\reportman\\repman\\repsamples";

for (const dir of [fixturesDir, reportsDir, delphiDir, syntheticDir, jsonDir]) fs.mkdirSync(dir, { recursive: true });

// ---- Writing reports as the C# ReportWriter does ----

const C_MAXDATAWIDTH = 40;
function isRpAlpha(c) {
  return /[0-9A-Za-z_ .()=;:]/.test(c);
}
/** ReportWriter.StringToRpString: #code# escapes and a CR LF after every 40 characters or so. */
function rpString(s) {
  let out = "";
  let alen = 0;
  for (const c of s.split("")) {
    if (isRpAlpha(c)) {
      out += c;
      alen++;
    } else {
      const sub = "#" + c.charCodeAt(0) + "#";
      out += sub;
      alen += sub.length;
    }
    if (alen > C_MAXDATAWIDTH) {
      alen = 0;
      out += "\r\n";
    }
  }
  return out;
}
const S = (name, value) => `<${name} type="String">${rpString(value)}</${name}>`;
const W = (name, value) => `<${name} type="WideString">${rpString(value)}</${name}>`;
const I = (name, value) => `<${name} type="Integer">${value}</${name}>`;
const B = (name, value) => `<${name} type="Boolean">${value ? "True" : "False"}</${name}>`;
const D = (name, value) => `<${name} type="Double">${value}</${name}>`;
function hex(bytes) {
  return Buffer.from(bytes).toString("hex").toUpperCase();
}
const BIN = (name, bytes) => `<${name} type="Binary" size="${bytes.length}">${rpString(hex(bytes))}</${name}>`;

const header = `<?xml version="1.0" standalone="no"?>\r\n<!DOCTYPE REPORT_MANAGER_2>\r\n`;
const doc = (lines) => header + lines.flat(Infinity).join("\r\n") + "\r\n";

function component(name, className, props) {
  return ["<COMPONENT>", S("NAME", name), S("CLASSNAME", className), ...props, "</COMPONENT>"];
}

// An undo history as the C# writer saves it (Newtonsoft default settings: PascalCase names).
const undoPascal = {
  GroupId: 7,
  UndoOperations: [
    {
      Operation: 1,
      GroupId: 1,
      ComponentName: "REPORT",
      ComponentClass: "TRPREPORT",
      ParentName: null,
      OldItemIndex: null,
      OldParentName: null,
      Date: "2026-05-29T14:18:58.3640000Z",
      ExpandedProperties: true,
      Properties: [
        { PropertyName: "pageHeight", PropertyType: 1, OldValue: 16837, NewValue: 8120 },
        { PropertyName: "docTitle", PropertyType: 3, OldValue: "2024-01-02T03:04:05.000", NewValue: "Title" },
        { PropertyName: "ratio", PropertyType: 2, OldValue: 2.5, NewValue: 3 },
        { PropertyName: "datasets", PropertyType: 8, OldValue: ["A", "B"], NewValue: [] },
        // Newtonsoft dates: the Microsoft form, 7 fraction digits, and texts that are no date.
        { PropertyName: "docSubject", PropertyType: 3, OldValue: "/Date(1700000000000)/", NewValue: "2024-02-29T23:59:59.9999999Z" },
        { PropertyName: "docKeywords", PropertyType: 3, OldValue: "2024-13-01T00:00:00", NewValue: "2024-02-30T00:00:00" },
        { PropertyName: "docProducer", PropertyType: 3, OldValue: "2024-01-01T00:00:00.12345678", NewValue: ["2021-03-04T05:06:07.1Z", 1, true, null] },
        {
          PropertyName: "value",
          PropertyType: 7,
          OldValue: { type: "DateTime", value: "2020-01-01T10:00:00.5000000" },
          NewValue: { type: "String", value: "x" },
        },
      ],
    },
  ],
  RedoOperations: [
    {
      operation: "Modify",
      groupId: 2,
      componentName: "TRPLABEL1",
      componentClass: "TRPLABEL",
      date: "2026-06-17T13:11:19.391Z",
      expandedProperties: false,
      properties: [{ propertyName: "posX", propertyType: "Integer", oldValue: 10, newValue: 20 }],
    },
  ],
};

const sectionStream = [0x42, 0x4d, 0, 1, 2, 3, 250, 255, 7];
const imageStream = Array.from({ length: 70 }, (_, i) => (i * 37) & 255);

const kitchenSink = doc([
  "<REPORT>",
  BIN("BINCUE", Buffer.from(JSON.stringify(undoPascal), "utf8")),
  S("WFONTNAME", "Segoe UI"),
  S("LFONTNAME", "DejaVu Sans"),
  B("GRIDVISIBLE", false),
  B("GRIDLINES", true),
  B("GRIDENABLED", false),
  I("GRIDCOLOR", 255),
  I("GRIDWIDTH", 57),
  I("GRIDHEIGHT", 58),
  I("PAGEORIENTATION", 2),
  I("PAGESIZE", 2),
  I("PAGESIZEQT", 8),
  I("PAGEHEIGHT", 15000),
  I("PAGEWIDTH", 9000),
  I("CUSTOMPAGEHEIGHT", 14000),
  I("CUSTOMPAGEWIDTH", 8000),
  I("PAGEBACKCOLOR", 12345),
  I("PREVIEWSTYLE", 3),
  B("PREVIEWMARGINS", true),
  I("PREVIEWWINDOW", 1),
  I("LEFTMARGIN", 100),
  I("TOPMARGIN", 200),
  I("RIGHTMARGIN", 300),
  I("BOTTOMMARGIN", 400),
  I("PRINTERSELECT", 5),
  I("LANGUAGE", 1),
  I("COPIES", 3),
  B("COLLATECOPIES", true),
  B("TWOPASS", true),
  I("PRINTERFONTS", 3),
  B("PRINTONLYIFDATAAVAILABLE", true),
  I("STREAMFORMAT", 4),
  B("REPORTACTIONDRAWERBEFORE", true),
  B("REPORTACTIONDRAWERAFTER", true),
  B("PREVIEWABOUT", false),
  I("TYPE1FONT", 2),
  // (short) of 70000
  I("FONTSIZE", 70000),
  I("FONTROTATION", 450),
  I("FONTSTYLE", 5),
  I("FONTCOLOR", 65280),
  I("BACKCOLOR", 0),
  B("TRANSPARENT", false),
  B("CUTTEXT", true),
  // AlignHCenter
  I("ALIGNMENT", 4),
  // AlignBottom
  I("VALIGNMENT", 16),
  B("WORDWRAP", true),
  B("SINGLELINE", true),
  S("BIDIMODES", "BidiFull"),
  B("MULTIPAGE", true),
  I("PRINTSTEP", 4),
  I("PAPERSOURCE", 2),
  I("DUPLEX", 1),
  S("FORCEPAPERNAME", "A4 / custom paper, with a long name that wraps"),
  I("LINESPERINCH", 6),
  I("PDFCONFORMANCE", 1),
  B("PDFCOMPRESSED", true),
  W("DOCAUTHOR", "Autor ñ – €"),
  S("DOCCREATOR", "Creator"),
  S("DOCPRODUCER", "Producer"),
  S("DOCSUBJECT", "Subject\r\nwith two lines"),
  S("DOCTITLE", "Title"),
  S("DOCCREATIONDATE", "D:20240101000000"),
  S("DOCMODIFICATIONDATE", "D:20240102000000"),
  S("DOCKEYWORDS", "a, b"),
  S("DOCXMPCONTENT", "<x:xmpmeta/>"),
  "<DATABASEINFO>",
  S("ALIAS", "MAIN"),
  S("NAME", "TRPDATABASEINFOITEM1"),
  S("CONFIGFILE", "C:\\conf\\dbx.ini"),
  B("LOADPARAMS", false),
  B("LOADDRIVERPARAMS", true),
  B("LOGINPROMPT", true),
  I("DRIVER", 10),
  S("REPORTTABLE", "T1"),
  S("REPORTSEARCHFIELD", "F1"),
  S("REPORTFIELD", "F2"),
  S("REPORTGROUPSTABLE", "G1"),
  W("ADOCONNECTIONSTRING", "Data Source=x;User=y"),
  I("DOTNETDRIVER", 6),
  S("PROVIDERFACTORY", "Microsoft.Data.Sqlite"),
  "</DATABASEINFO>",
  // A second connection named as the first: renamed by the reader (the name is uppercase).
  "<DATABASEINFO>",
  S("ALIAS", "SECOND"),
  S("NAME", "TRPDATABASEINFOITEM1"),
  "</DATABASEINFO>",
  "<DATAINFO>",
  S("ALIAS", "CUST"),
  S("NAME", "Customers"),
  S("DATABASEALIAS", "MAIN"),
  W("SQL", "SELECT * FROM CUSTOMERS\r\nWHERE ID=:ID"),
  W("SQLEXPLANATION", "Explanation"),
  W("SQLEXPLANATIONERROR", "Error"),
  I("HUBSCHEMAID", 34),
  W("SCHEMANAME", "Sales"),
  S("DATASOURCE", "MASTER"),
  S("MYBASEFILENAME", "file.cds"),
  S("MYBASEFIELDS", "A;B"),
  S("MYBASEINDEXFIELDS", "A"),
  S("MYBASEMASTERFIELDS", "B"),
  S("BDEINDEXFIELDS", "ID"),
  S("BDEINDEXNAME", "IDX"),
  S("BDETABLE", "CUSTOMERS"),
  I("BDETYPE", 1),
  S("BDEFILTER", "ID>0"),
  S("BDEMASTERFIELDS", "MID"),
  S("BDEFIRSTRANGE", "1"),
  S("BDELASTRANGE", "9"),
  S("DATAUNIONS", "A\n  B \n\n C"),
  B("GROUPUNION", true),
  B("PARALLELUNION", true),
  B("OPENONSTART", false),
  "</DATAINFO>",
  // A dataset without a name (older reports): EnsureComponentNames names it.
  "<DATAINFO>",
  S("ALIAS", "MASTER"),
  S("DATABASEALIAS", "MAIN"),
  S("SQL", "SELECT 1"),
  "</DATAINFO>",
  "<PARAMETER>",
  S("NAME", "PSTRING"),
  S("INTNAME", "PSTRING"),
  I("PARAMTYPE", 0),
  W("DESCRIPTION", "Description 0\nDescription 1\r\nDescription 2"),
  W("HINT", "Hint"),
  W("ERRORMESSAGE", "Error 0\nError 1"),
  W("VALIDATION", "M.PSTRING<>''"),
  W("SEARCH", "search"),
  B("VISIBLE", true),
  B("ISREADONLY", true),
  B("NEVERVISIBLE", true),
  B("ALLOWNULLS", true),
  S("DATASETS", "CUST\nMASTER"),
  S("ITEMS", "One\nTwo"),
  S("VALUES", "1\n2"),
  S("SELECTED", "1"),
  S("LOOKUPDATASET", "LOOK"),
  S("SEARCHPARAM", "SP"),
  S("SEARCHDATASET", "SD"),
  W("VALUE", "Hello, world"),
  "</PARAMETER>",
  "<PARAMETER>",
  S("NAME", "PINT"),
  I("PARAMTYPE", 1),
  I("VALUE", -42),
  "</PARAMETER>",
  "<PARAMETER>",
  S("NAME", "PDOUBLE"),
  I("PARAMTYPE", 2),
  D("VALUE", "1234.5625"),
  "</PARAMETER>",
  "<PARAMETER>",
  S("NAME", "PCURRENCY"),
  I("PARAMTYPE", 6),
  D("VALUE", "-0.25"),
  "</PARAMETER>",
  "<PARAMETER>",
  S("NAME", "PDATE"),
  I("PARAMTYPE", 3),
  D("VALUE", "45000"),
  "</PARAMETER>",
  "<PARAMETER>",
  S("NAME", "PDATETIME"),
  I("PARAMTYPE", 5),
  D("VALUE", "45000.75"),
  "</PARAMETER>",
  "<PARAMETER>",
  S("NAME", "PTIME"),
  I("PARAMTYPE", 4),
  D("VALUE", "0.5"),
  "</PARAMETER>",
  "<PARAMETER>",
  S("NAME", "POLDDATE"),
  I("PARAMTYPE", 3),
  D("VALUE", "-1.25"),
  "</PARAMETER>",
  "<PARAMETER>",
  S("NAME", "PBOOL"),
  I("PARAMTYPE", 7),
  B("VALUE", true),
  "</PARAMETER>",
  "<PARAMETER>",
  S("NAME", "PMULTIPLE"),
  I("PARAMTYPE", 12),
  S("ITEMS", "A\nB\nC"),
  S("VALUES", "1\n2\n3"),
  S("SELECTED", "1\n3"),
  S("VALUE", "ignored"),
  "</PARAMETER>",
  // A date saved as text by an older designer: repaired into a date parameter.
  "<PARAMETER>",
  S("NAME", "PREPAIRDATE"),
  I("PARAMTYPE", 3),
  S("VALUE", "2024-05-06"),
  "</PARAMETER>",
  "<PARAMETER>",
  S("NAME", "PREPAIRDATETIME"),
  I("PARAMTYPE", 5),
  S("VALUE", "2024-05-06T07:08:09.123"),
  "</PARAMETER>",
  // Text that is no date: the parameter becomes a string one.
  "<PARAMETER>",
  S("NAME", "PREPAIRTEXT"),
  I("PARAMTYPE", 1),
  S("VALUE", "not a number"),
  "</PARAMETER>",
  "<PARAMETER>",
  S("NAME", "PEXPRE"),
  I("PARAMTYPE", 9),
  S("VALUE", "TODAY+1"),
  "</PARAMETER>",
  "<EMBEDDEDFILE>",
  S("FILENAME", "invoice.xml"),
  S("MIMETYPE", "text/xml"),
  S("DESCRIPTION", "The invoice"),
  S("CREATIONDATE", "D:20240101"),
  S("MODIFICATIONDATE", "D:20240202"),
  I("RELATIONSHIP", 2),
  "</EMBEDDEDFILE>",
  "<SUBREPORT>",
  S("NAME", "TRpSubReport0"),
  S("ALIAS", "CUST"),
  B("PRINTONLYIFDATAAVAILABLE", false),
  B("REOPENONPRINT", false),
  "<SECTION>",
  S("NAME", "TRpSection0"),
  I("WIDTH", 10000),
  I("HEIGHT", 2000),
  S("SUBREPORT", "TRpSubReport0"),
  S("GROUPNAME", "GROUP1"),
  S("CHANGEEXPRESSION", "CUST.COUNTRY"),
  B("CHANGEBOOL", true),
  B("PAGEREPEAT", true),
  B("SKIPPAGE", true),
  B("ALIGNBOTTOM", true),
  I("SECTIONTYPE", 1),
  B("AUTOEXPAND", true),
  B("AUTOCONTRACT", true),
  B("HORZDESP", true),
  B("VERTDESP", true),
  S("EXTERNALFILENAME", "ext.rep"),
  S("EXTERNALCONNECTION", "MAIN"),
  S("EXTERNALTABLE", "REPMAN_REPORTS"),
  S("EXTERNALFIELD", "REPORT"),
  S("EXTERNALSEARCHFIELD", "REPORT_NAME"),
  S("EXTERNALSEARCHVALUE", "X"),
  S("BEGINPAGEEXPRESSION", "FREE_SPACE_CMS<3"),
  B("BEGINPAGE", true),
  S("SKIPEXPREV", "1"),
  S("SKIPEXPREH", "2"),
  S("SKIPTOPAGEEXPRE", "3"),
  B("SKIPRELATIVEH", true),
  B("SKIPRELATIVEV", true),
  I("SKIPTYPE", 2),
  B("ININUMPAGE", true),
  B("GLOBAL", true),
  S("BACKEXPRESSION", "CUST.PHOTO"),
  S("PRINTCONDITION", "TRUE"),
  S("DOBEFOREPRINT", "X:=1"),
  S("DOAFTERPRINT", "X:=2"),
  I("STREAMFORMAT", 0),
  S("CHILDSUBREPORT", "TRpSubReport1"),
  I("BACKSTYLE", 2),
  I("DPIRES", 300),
  I("DRAWSTYLE", 3),
  `<CACHEDIMAGE type="Boolean">False</CACHEDIMAGE>`,
  BIN("STREAM", sectionStream),
  B("SYNCWIDTH", false),
  // Errors in section properties are ignored.
  S("NOTASECTIONPROPERTY", "x"),
  `<WIDTH type="Integer">not a number</WIDTH>`,
  component("TRpLabel0", "TRPLABEL", [
    I("WIDTH", 1000),
    I("HEIGHT", 300),
    S("PRINTCONDITION", "A=B"),
    S("DOBEFOREPRINT", "B"),
    S("DOAFTERPRINT", "C"),
    S("ANNOTATION", "'note'"),
    I("POSX", 10),
    I("POSY", 20),
    I("ALIGN", 6),
    S("WFONTNAME", "Arial"),
    S("LFONTNAME", "Helvetica"),
    I("BIDIMODE", 2),
    I("TYPE1FONT", 6),
    I("FONTSIZE", 12),
    I("FONTROTATION", -900),
    I("FONTSTYLE", 15),
    I("FONTCOLOR", 1234567),
    I("BACKCOLOR", 7654321),
    B("TRANSPARENT", false),
    B("CUTTEXT", true),
    I("ALIGNMENT", 1024),
    I("VALIGNMENT", 32),
    B("WORDWRAP", true),
    B("ISHTML", true),
    B("SINGLELINE", true),
    B("WORDBREAK", true),
    I("INTERLINE", 3),
    B("MULTIPAGE", true),
    I("PRINTSTEP", 2),
    W("WIDETEXT", "Default text\r\nLanguage 0\r\n\r\nLanguage 2\r\n\r\r\nLast"),
  ]),
  component("TRpLabel1", "TRPLABEL", [
    I("BIDIMODE", 1),
    S("BIDIMODES", "BidiNo\r\nBidiNo\r\nBidiFull\r\n"),
    W("WIDETEXT", "Only one\r\n"),
  ]),
  // Two components with the same uppercase name: the second gets a new name.
  component("TRPLABEL1", "TRPLABEL", [W("WIDETEXT", "first")]),
  component("TRPLABEL1", "TRPLABEL", [W("WIDETEXT", "second")]),
  // Two with the same mixed-case name: the engine keeps both names (only the first is listed).
  component("Same", "TRPSHAPE", [I("SHAPE", 4)]),
  component("Same", "TRPSHAPE", [I("SHAPE", 5)]),
  component("TRpExpression0", "TRPEXPRESSION", [
    I("ALIGNMENT", 2),
    W("EXPRESSION", "'A'+#13#10+CUST.NAME"),
    S("AGINIVALUE", "10"),
    S("EXPORTEXPRESSION", "CUST.CODE"),
    I("DATATYPE", 2),
    S("DISPLAYFORMAT", "#,##0.00"),
    S("IDENTIFIER", "TOTAL"),
    S("GROUPNAME", "GROUP1"),
    I("AGGREGATE", 1),
    I("AGTYPE", 4),
    B("AUTOEXPAND", true),
    B("AUTOCONTRACT", true),
    B("PRINTONLYONE", true),
    B("PRINTNULLS", false),
    S("EXPORTDISPLAYFORMAT", "0"),
    I("EXPORTLINE", 1),
    I("EXPORTPOSITION", 2),
    I("EXPORTSIZE", 3),
    B("EXPORTDONEWLINE", true),
  ]),
  component("TRpShape0", "TRPSHAPE", [
    I("SHAPE", 7),
    I("BRUSHSTYLE", 4),
    I("BRUSHCOLOR", 111),
    I("PENSTYLE", 3),
    I("PENCOLOR", 222),
    I("PENWIDTH", 15),
  ]),
  component("TRpImage0", "TRPIMAGE", [
    S("EXPRESSION", "CUST.PHOTO"),
    I("DPIRES", 150),
    I("DRAWSTYLE", 4),
    I("CACHEDIMAGE", 2),
    BIN("STREAM", imageStream),
    I("ROTATION", 65536 + 90),
    I("COPYMODE", 20),
  ]),
  component("TRpBarcode0", "TRPBARCODE", [
    S("EXPRESSION", "'12345'"),
    I("MODUL", 15),
    D("RATIO", "2.75"),
    I("TYP", 17),
    B("CHECKSUM", true),
    B("TRANSPARENT", true),
    S("DISPLAYFORMAT", "000"),
    I("ROTATION", 900),
    I("BCOLOR", 333),
    I("BACKCOLOR", 444),
    I("NUMCOLUMNS", 4),
    I("NUMROWS", 6),
    I("ECCLEVEL", 3),
    B("TRUNCATED", true),
  ]),
  component("TRpChart0", "TRPCHART", [
    S("VALUEEXPRESSION", "CUST.SALES"),
    S("VALUEXEXPRESSION", "CUST.X"),
    S("GETVALUECONDITION", "TRUE"),
    S("CHANGESERIEEXPRESSION", "CUST.YEAR"),
    S("CAPTIONEXPRESSION", "CUST.NAME"),
    S("COLOREXPRESSION", "255"),
    S("SERIECOLOREXPRESSION", "65280"),
    S("SERIECAPTION", "Series"),
    S("CLEAREXPRESSION", "FALSE"),
    S("IDENTIFIER", "CHART1"),
    B("CHANGESERIEBOOL", true),
    B("CLEAREXPRESSIONBOOL", true),
    I("CHARTTYPE", 5),
    I("DRIVER", 1),
    B("VIEW3D", false),
    B("VIEW3DWALLS", true),
    I("PERSPECTIVE", 20),
    I("ELEVATION", 300),
    I("ROTATION", 310),
    I("ZOOM", 90),
    I("HORZOFFSET", 5),
    I("VERTOFFSET", 6),
    I("TILT", 7),
    B("ORTHOGONAL", false),
    I("MULTIBAR", 3),
    I("RESOLUTION", 200),
    B("SHOWLEGEND", true),
    B("SHOWHINT", false),
    I("MARKSTYLE", 2),
    I("HORZFONTSIZE", 8),
    I("VERTFONTSIZE", 9),
    I("HORZFONTROTATION", 45),
    I("VERTFONTROTATION", 90),
    I("AUTORANGE", 4),
    D("YMIN", "-10.5"),
    D("YMAX", "1e3"),
    S("SERIESCOLORS", '"255", 65280  x,16711680'),
  ]),
  "</SECTION>",
  "<SECTION>",
  S("NAME", "TRpSection1"),
  S("SUBREPORT", "TRpSubReport0"),
  I("SECTIONTYPE", 2),
  `<CACHEDIMAGE type="Integer">1</CACHEDIMAGE>`,
  // A second stream shorter than the first: written over it, the tail stays.
  BIN("STREAM", [1, 2, 3, 4, 5, 6]),
  BIN("STREAM", [9, 9]),
  "</SECTION>",
  "</SUBREPORT>",
  "<SUBREPORT>",
  S("NAME", "TRpSubReport1"),
  S("PARENTSUBREPORT", "TRpSubReport0"),
  S("PARENTSECTION", "TRpSection0"),
  "<SECTION>",
  S("NAME", "TRpSection2"),
  I("SECTIONTYPE", 2),
  "</SECTION>",
  "</SUBREPORT>",
  "</REPORT>",
]);

// The defaults of every item: only names.
const defaults = doc([
  "<REPORT>",
  "<DATABASEINFO>",
  S("ALIAS", "DB"),
  "</DATABASEINFO>",
  "<DATAINFO>",
  S("ALIAS", "DS"),
  "</DATAINFO>",
  "<PARAMETER>",
  S("NAME", "P1"),
  "</PARAMETER>",
  "<SUBREPORT>",
  S("NAME", "SUB"),
  "<SECTION>",
  S("NAME", "SEC"),
  component("L1", "TRPLABEL", []),
  component("E1", "TRPEXPRESSION", []),
  component("S1", "TRPSHAPE", []),
  component("I1", "TRPIMAGE", []),
  component("B1", "TRPBARCODE", []),
  component("C1", "TRPCHART", []),
  "</SECTION>",
  "</SUBREPORT>",
  "</REPORT>",
]);

// The quirks of the tokenizer and of the text values.
const quirks =
  // Text before <REPORT is skipped, the attributes are free text.
  `garbage before\n<REPORT   >\n` +
  // Values: IsAlpha characters, #code# escapes (one digit, five digits, invalid "digits"), the
  // rest dropped; line breaks inside values dropped.
  `<WFONTNAME type="String">A,b-c#65##9731#d\r\ne#1x#f</WFONTNAME>\n` +
  // type written before size: the type is lost, the size is read.
  `<LFONTNAME type="String" size="12">Courier</LFONTNAME>\n` +
  `<GRIDCOLOR type="Integer">  +77 </GRIDCOLOR>\n` +
  `<LANGUAGE type="Integer">-1</LANGUAGE>\n` +
  `<FONTSIZE type="Integer">-32769</FONTSIZE>\n` +
  `<PREVIEWABOUT type="Boolean">true</PREVIEWABOUT>\n` +
  `<SUBREPORT><NAME type="String">TRPSUBREPORT1</NAME>` +
  `<SECTION><NAME type="String">TRPSECTION1</NAME><SUBREPORT type="String">trpsubreport1</SUBREPORT>` +
  `<COMPONENT><NAME type="String">TRPLABEL1</NAME><CLASSNAME type="String">TRPLABEL</CLASSNAME>` +
  `<NAME type="String">TRPLABEL1</NAME><BIDIMODE type="Integer">1</BIDIMODE></COMPONENT>` +
  `<COMPONENT><NAME type="String"></NAME><CLASSNAME type="String">TRPEXPRESSION</CLASSNAME></COMPONENT>` +
  `</SECTION>` +
  `<SECTION><NAME type="String">TRPSECTION1</NAME></SECTION>` +
  `</SUBREPORT>\n</REPORT>\n`;

// The errors of the C# reader.
const errors = {
  "error-unknown-report-property": doc(["<REPORT>", S("NOSUCHPROPERTY", "x"), "</REPORT>"]),
  "error-unknown-component-property": doc([
    "<REPORT>",
    "<SUBREPORT>",
    S("NAME", "S"),
    "<SECTION>",
    S("NAME", "X"),
    component("C", "TRPSHAPE", [S("EXPRESSION", "1")]),
    "</SECTION>",
    "</SUBREPORT>",
    "</REPORT>",
  ]),
  "error-unknown-class": doc([
    "<REPORT>",
    "<SUBREPORT>",
    S("NAME", "S"),
    "<SECTION>",
    S("NAME", "X"),
    component("C", "TRPMYITEM", []),
    "</SECTION>",
    "</SUBREPORT>",
    "</REPORT>",
  ]),
  "error-no-alias": doc(["<REPORT>", "<DATAINFO>", S("NAME", "D"), "</DATAINFO>", "</REPORT>"]),
  "error-binary-size": doc(["<REPORT>", `<BINCUE type="Binary" size="4">ABCD</BINCUE>`, "</REPORT>"]),
  "error-missing-parent": doc([
    "<REPORT>",
    "<SUBREPORT>",
    S("NAME", "S"),
    S("PARENTSUBREPORT", "NOSUCH"),
    "</SUBREPORT>",
    "</REPORT>",
  ]),
  "error-not-a-subreport": doc([
    "<REPORT>",
    "<SUBREPORT>",
    S("NAME", "S"),
    "<SECTION>",
    S("NAME", "SEC"),
    S("CHILDSUBREPORT", "SEC"),
    "</SECTION>",
    "</SUBREPORT>",
    "</REPORT>",
  ]),
  "error-embedded-not-closed": doc([
    "<REPORT>",
    "<EMBEDDEDFILE>",
    `<FILENAME type="String">a</FILENAME>`,
    `<MIMETYPE type="String">b`,
    "</EMBEDDEDFILE>",
    "</REPORT>",
  ]),
  "error-image-cachedimage": doc([
    "<REPORT>",
    "<SUBREPORT>",
    S("NAME", "S"),
    "<SECTION>",
    S("NAME", "X"),
    component("I", "TRPIMAGE", [B("CACHEDIMAGE", true)]),
    "</SECTION>",
    "</SUBREPORT>",
    "</REPORT>",
  ]),
  "error-integer-overflow": doc(["<REPORT>", I("COPIES", 2147483648), "</REPORT>"]),
  "error-no-report": doc(["<NOTAREPORT>", "</NOTAREPORT>"]),
  "error-unclosed-tag": header + "<REPORT>\r\n<WFONTNAME type=\"String\">Arial</WFONTNAME\r\n</REPORT>\r\n",
};

// ---- Cases ----

const cases = [];
function addCase(id, repFile) {
  cases.push({ id, rep: path.relative(packageDir, repFile).split(path.sep).join("/") });
}

for (const f of fs.readdirSync(repoSamples).filter((f) => f.endsWith(".rep")).sort()) {
  const file = path.join(repoSamples, f);
  if (fs.readFileSync(file)[0] === 0x3c) addCase("samples-" + path.basename(f, ".rep"), file);
}

if (fs.existsSync(delphiSource)) {
  for (const f of fs.readdirSync(delphiSource).filter((f) => f.endsWith(".rep")).sort()) {
    const source = path.join(delphiSource, f);
    if (fs.readFileSync(source)[0] === 0x3c) fs.copyFileSync(source, path.join(delphiDir, f));
  }
}
for (const f of fs.readdirSync(delphiDir).filter((f) => f.endsWith(".rep")).sort())
  addCase("delphi-" + path.basename(f, ".rep"), path.join(delphiDir, f));

const synthetic = { "kitchen-sink": kitchenSink, defaults, quirks, ...errors };
for (const [name, text] of Object.entries(synthetic)) {
  const file = path.join(syntheticDir, name + ".rep");
  fs.writeFileSync(file, Buffer.from(text, "latin1"));
  addCase("synthetic-" + name, file);
}
// zlib compressed copies (stream format XMLZlib): a sample and the kitchen sink.
for (const [name, source] of [
  ["zlib-customers", path.join(repoSamples, "customers.rep")],
  ["zlib-kitchen-sink", path.join(syntheticDir, "kitchen-sink.rep")],
]) {
  const file = path.join(syntheticDir, name + ".rep");
  fs.writeFileSync(file, zlib.deflateSync(fs.readFileSync(source)));
  addCase("synthetic-" + name, file);
}

for (const c of cases) {
  const repFile = path.join(packageDir, c.rep);
  const jsonFile = path.join(jsonDir, c.id + ".json");
  const errorFile = path.join(jsonDir, c.id + ".error.json");
  for (const f of [jsonFile, errorFile]) if (fs.existsSync(f)) fs.unlinkSync(f);
  // The harness writes the file as UTF-8 (its console output uses the console code page).
  let failure = undefined;
  try {
    execFileSync(golden, ["model-json", repFile, jsonFile], {
      encoding: "utf8",
      maxBuffer: 256 * 1024 * 1024,
      stdio: ["ignore", "pipe", "pipe"],
    });
  } catch (e) {
    failure = String(e.stderr ?? e);
  }
  if (failure === undefined) {
    fs.writeFileSync(jsonFile, JSON.stringify(JSON.parse(fs.readFileSync(jsonFile, "utf8"))) + "\n");
    c.json = path.relative(packageDir, jsonFile).split(path.sep).join("/");
  } else {
    if (fs.existsSync(jsonFile)) fs.unlinkSync(jsonFile);
    const m = /^ERROR ([^:]+): ([\s\S]*?)\r?\n {3}at /m.exec(failure);
    if (!m) throw new Error("golden-cs failed on " + c.rep + ":\n" + failure);
    fs.writeFileSync(errorFile, JSON.stringify({ type: m[1], message: m[2] }, null, 2) + "\n");
    c.error = path.relative(packageDir, errorFile).split(path.sep).join("/");
  }
  console.log(c.id, c.json ? "json" : "error");
}
fs.writeFileSync(path.join(fixturesDir, "cases.json"), JSON.stringify(cases, null, 2) + "\n");
