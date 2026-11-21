// The .rep XML reader beyond the C# parity fixtures: DFM detection, loading into an existing report,
// the components of a section, and some values of the synthetic reports spelled out.
import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  DFM_FORMAT_MESSAGE,
  ExpressionItem,
  ImageItem,
  LabelItem,
  OperationType,
  ParamType,
  PropertyType,
  Report,
  ReportReaderError,
  ShapeItem,
  VariantType,
  loadReportXml,
  readComponentsXml,
  readReportXml,
} from "@reportman/lib";
import { readUndoCueJson } from "../src/lib/xml/undo-cue-json.js";

const packageDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const synthetic = (name: string) =>
  new Uint8Array(fs.readFileSync(path.join(packageDir, "test/fixtures/reports/synthetic", name + ".rep")));
const latin1 = (s: string) => new Uint8Array(Buffer.from(s, "latin1"));

describe("Delphi DFM reports", () => {
  const textDfm = "object TRpReport\r\n  PageHeight = 8120\r\nend\r\n";
  const binaryDfm = "TPF0\tTRpReport\x00\x09GridWidth";
  const cases: [string, Uint8Array][] = [
    ["text", latin1(textDfm)],
    ["binary", latin1(binaryDfm)],
    ["zlib text", new Uint8Array(zlib.deflateSync(Buffer.from(textDfm, "latin1")))],
    ["zlib binary", new Uint8Array(zlib.deflateSync(Buffer.from(binaryDfm, "latin1")))],
  ];
  for (const [name, bytes] of cases) {
    it(`refuses a ${name} DFM with a clear message`, () => {
      expect(() => readReportXml(bytes)).toThrow(ReportReaderError);
      expect(() => readReportXml(bytes)).toThrow(DFM_FORMAT_MESSAGE);
    });
  }
  it("says an empty file is empty", () => {
    expect(() => readReportXml(new Uint8Array(0))).toThrow("Zero Length stream");
  });
  it("says a file that is neither XML nor zlib is no report", () => {
    expect(() => readReportXml(latin1("hello world\n"))).toThrow("Report must begin with <REPORT\nhello world");
  });
  it("reports a broken zlib stream", () => {
    expect(() => readReportXml(latin1("x not zlib"))).toThrow(/zlib/);
  });
});

describe("values of the synthetic reports", () => {
  it("decodes texts as the engine does (escapes, dropped characters, line breaks)", () => {
    const report = readReportXml(synthetic("quirks"));
    // "A,b-c#65##9731#d\r\ne#1x#f": only IsAlpha characters, #code# escapes without digit check
    expect(report.wFontName).toBe("AbcA☃deRf");
    // type written before size: the size is read, the type lost (the value is still read)
    expect(report.lFontName).toBe("Courier");
    expect(report.gridColor).toBe(77);
    // (short)-32769
    expect(report.fontSize).toBe(32767);
    // only "True" is true
    expect(report.previewAbout).toBe(false);
    const sub = report.subReports[0];
    expect(sub.sections.map((s) => s.name)).toEqual(["TRPSECTION1", "TRPSECTION2"]);
    expect(sub.sections[0].subReportName).toBe("TRPSUBREPORT1");
    const [label, expression] = sub.sections[0].components;
    expect(label.name).toBe("TRPLABEL1");
    expect((label as LabelItem).bidiModes).toEqual(["BidiPartial"]);
    expect((label as LabelItem).rightToLeft).toBe(true);
    // a component without a name gets one at the end
    expect(expression.name).toBe("TRPEXPRESSION1");
  });

  it("reads every kind of item of the kitchen sink", () => {
    const report = readReportXml(synthetic("kitchen-sink"));
    expect(report.databaseInfo.map((d) => d.name)).toEqual(["TRPDATABASEINFOITEM1", "TRPDATABASEINFOITEM2"]);
    expect(report.dataInfo.map((d) => d.name)).toEqual(["Customers", "TRPDATAINFOITEM1"]);
    expect(report.dataInfo[0].dataUnions).toEqual(["A", "B", "C"]);
    const byAlias = new Map(report.params.map((p) => [p.alias, p]));
    expect(byAlias.get("PSTRING")!.descriptions).toEqual(["Description 0", "Description 1\r", "Description 2"]);
    expect(byAlias.get("PMULTIPLE")!.value).toEqual({ type: VariantType.String, value: "1,3" });
    expect(byAlias.get("PINT")!.value).toEqual({ type: VariantType.Integer, value: -42 });
    const date = byAlias.get("PDATE")!.value!.value as Date;
    expect([date.getFullYear(), date.getMonth(), date.getDate(), date.getHours()]).toEqual([2023, 2, 15, 0]);
    const time = byAlias.get("PTIME")!.value!.value as Date;
    expect([time.getFullYear(), time.getMonth(), time.getDate(), time.getHours()]).toEqual([1899, 11, 30, 12]);
    const old = byAlias.get("POLDDATE")!.value!.value as Date;
    expect([old.getFullYear(), old.getMonth(), old.getDate(), old.getHours()]).toEqual([1899, 11, 29, 6]);
    expect(byAlias.get("PREPAIRDATE")!.paramType).toBe(ParamType.Date);
    expect(byAlias.get("PREPAIRDATETIME")!.paramType).toBe(ParamType.DateTime);
    expect(byAlias.get("PREPAIRTEXT")!.paramType).toBe(ParamType.String);
    expect(byAlias.get("PREPAIRTEXT")!.value).toEqual({ type: VariantType.String, value: "not a number" });

    const [sec0, sec1] = report.subReports[0].sections;
    // a second, shorter stream is written over the first: its tail stays
    expect(Buffer.from(sec1.streamBase64, "base64")).toEqual(Buffer.from([9, 9, 3, 4, 5, 6]));
    expect(sec0.width).toBe(10000);
    const image = sec0.components.find((c) => c instanceof ImageItem) as ImageItem;
    expect(Buffer.from(image.streamBase64, "base64")).toEqual(Buffer.from(Array.from({ length: 70 }, (_, i) => (i * 37) & 255)));
    expect(image.rotation).toBe(90);
    const labels = sec0.components.filter((c) => c instanceof LabelItem) as LabelItem[];
    // C# parity: a language left empty (CR LF CR LF) is dropped as a leftover CR
    expect(labels[0].allStrings).toEqual(["Default text", "Language 0", "Language 2", "Last"]);
    // "TRPLABEL1" is the key of "TRpLabel1": both uppercase ones are renamed
    expect(labels.map((l) => l.name)).toEqual(["TRpLabel0", "TRpLabel1", "TRPLABEL2", "TRPLABEL3"]);
    // two items named "Same": both keep the name, the list holds the first
    const shapes = sec0.components.filter((c) => c instanceof ShapeItem && c.name === "Same");
    expect(shapes.length).toBe(2);
    expect(report.components.get("SAME")).toBe(shapes[0]);
    const expression = sec0.components.find((c) => c instanceof ExpressionItem) as ExpressionItem;
    expect(expression.exportDoNewLine).toBe(true);

    const cue = report.undoCue!;
    expect(cue.groupId).toBe(0);
    expect(cue.undoOperations[0].operation).toBe(OperationType.Modify);
    expect(cue.undoOperations[0].date.toISOString()).toBe("2026-05-29T14:18:58.364Z");
    expect(cue.redoOperations[0].properties[0].propertyType).toBe(PropertyType.Integer);
    // written as text#47#xml
    expect(report.embeddedFiles[0].mimeType).toBe("text/xml");
  });
});

describe("loadReportXml and readComponentsXml", () => {
  it("replaces the lists and keeps the properties the file does not have", () => {
    const report = new Report();
    report.docTitle = "kept";
    report.leftMargin = 1;
    loadReportXml(report, synthetic("kitchen-sink"));
    loadReportXml(report, synthetic("defaults"));
    expect(report.docTitle).toBe("Title");
    expect(report.leftMargin).toBe(100);
    expect(report.undoCue).toBeUndefined();
    expect(report.params.map((p) => p.alias)).toEqual(["P1"]);
    expect([...report.components.keys()].sort()).toEqual(
      ["B1", "C1", "E1", "I1", "L1", "S1", "SEC", "SUB", "TRPDATABASEINFOITEM1", "TRPDATAINFOITEM1", "TRPPARAM1"].sort()
    );
  });

  it("reads the components of a section and registers their names", () => {
    const report = readReportXml(synthetic("defaults"));
    const xml =
      `<SECTION><COMPONENT><NAME type="String">L1</NAME><CLASSNAME type="String">TRPLABEL</CLASSNAME>` +
      `<WIDETEXT type="String">Hello</WIDETEXT></COMPONENT>` +
      `<COMPONENT><NAME type="String">TRPSHAPE1</NAME><CLASSNAME type="String">TRPSHAPE</CLASSNAME>` +
      `<SHAPE type="Integer">4</SHAPE></COMPONENT></SECTION>`;
    const items = readComponentsXml(xml, report);
    expect(items.map((i) => i.className)).toEqual(["TRPLABEL", "TRPSHAPE"]);
    expect((items[0] as LabelItem).allStrings).toEqual(["Hello"]);
    expect((items[1] as ShapeItem).shape).toBe(4);
    // "L1" is taken (an uppercase name): renamed
    expect(items[0].name).toBe("TRPLABEL1");
    expect(report.components.get("TRPSHAPE1")).toBe(items[1]);
    expect(() => readComponentsXml("<SECTION><OTHER></OTHER></SECTION>", report)).toThrow("Invalid XML name OTHER");
  });
});

describe("the undo history JSON (BINCUE)", () => {
  it("writes a date with an offset in local time, as Newtonsoft does", () => {
    const cue = readUndoCueJson(
      JSON.stringify({
        undoOperations: [
          { operation: 1, properties: [{ propertyName: "x", propertyType: 3, newValue: "2024-01-02T03:04:05.25+02:00" }] },
        ],
      })
    )!;
    const value = cue.undoOperations[0].properties[0].newValue as string;
    const instant = new Date(Date.UTC(2024, 0, 2, 1, 4, 5, 250));
    const offset = -instant.getTimezoneOffset();
    const pad = (n: number) => String(n).padStart(2, "0");
    const expected =
      `${instant.getFullYear()}-${pad(instant.getMonth() + 1)}-${pad(instant.getDate())}T` +
      `${pad(instant.getHours())}:${pad(instant.getMinutes())}:${pad(instant.getSeconds())}.25` +
      `${offset < 0 ? "-" : "+"}${pad(Math.floor(Math.abs(offset) / 60))}:${pad(Math.abs(offset) % 60)}`;
    expect(value).toBe(expected);
  });
  it("is empty for an empty document and refuses what is not an object", () => {
    expect(readUndoCueJson("")).toBeUndefined();
    expect(readUndoCueJson(" null ")).toBeUndefined();
    expect(() => readUndoCueJson("[1]")).toThrow();
    expect(() => readUndoCueJson(JSON.stringify({ undoOperations: [{ operation: "Nothing" }] }))).toThrow();
  });
  it("keeps the constructor's date when there is none", () => {
    const before = Date.now();
    const cue = readUndoCueJson(JSON.stringify({ UndoOperations: [{ Operation: 0, GroupId: 3 }] }))!;
    expect(cue.undoOperations[0].groupId).toBe(3);
    expect(cue.undoOperations[0].date.getTime()).toBeGreaterThanOrEqual(before);
    expect(cue.undoOperations[0].expandedProperties).toBe(true);
  });
});
