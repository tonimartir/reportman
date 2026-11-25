// Byte parity of the .rep XML writer with the C# engine (ReportWriter, ExternalReport).
//
// test/fixtures/writer/writer-fixtures.json.gz holds what golden-cs gives for every XML report of
// the repository (samples/ and the fixtures of every package, 343 different files with the
// synthetic writer-*.rep, which cover every item type, every parameter type, undo histories
// written by C#, the links of child subreports and the bidirectional modes): the SHA-256 of the
// document C# writes after reading the file (write-xml) and after reading its JSON model as the
// designer's server does (json-to-xml), of the subreports it exports and of the reports it imports
// into others, and the C# JSON of those imports. It is made by test/generate-writer-fixtures.mjs
// (which needs .NET); this test needs none.
//
// The full corpus was also checked locally: those reports plus the XML ones of the Delphi
// repository (reportman/repman, tests) with
//   node test/generate-writer-fixtures.mjs --extra <Delphi repository> --out <bundle> [--dump <dir>]
//   REPORTMAN_WRITER_FIXTURES=<bundle> npx vitest run packages/reportman-lib/test/writer.test.ts
// --dump writes the C# documents, to see where a difference is.
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { gunzipSync } from "node:zlib";
import { unzlibSync } from "fflate";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  ChangeObjectOperation,
  ChangeOperationItem,
  LabelItem,
  OperationType,
  ParamType,
  PropertyType,
  Report,
  UndoCue,
  VariantType,
  exportSubReport,
  exportSubReportXml,
  hydrateReport,
  importReport,
  parseReportJson,
  readComponentsXml,
  readReportXml,
  serializeReport,
  updateReferences,
  writeComponentsXml,
  writeReportXml,
  writeReportXmlBytes,
} from "@reportman/lib";
import { Comparison, compare, jsonDiffs } from "./model-compare.js";

const packageDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

interface Outcome {
  sha256?: string;
  length?: number;
  compressed?: boolean;
  error?: { type: string; message: string };
}
interface ReportCase {
  id: string;
  rep: string;
  /** SHA-256 of the .rep the fixtures were made from. */
  input: string;
  write: Outcome;
  components?: Outcome;
  modelText?: string;
  modelError?: { type: string; message: string };
}
interface DocumentCase {
  id: string;
  report?: string;
  note?: string;
  modelText?: string;
  xml: Outcome;
}
interface ExportCase extends Outcome {
  report: string;
  index: number;
  from: "rep" | "json";
}
interface ImportCase extends Outcome {
  target: string;
  source: string;
  from: "rep" | "json" | "new";
  json?: any;
}
interface Bundle {
  reports: ReportCase[];
  documents: DocumentCase[];
  exports: ExportCase[];
  imports: ImportCase[];
}

const bundleFile =
  process.env.REPORTMAN_WRITER_FIXTURES ?? path.join(packageDir, "test/fixtures/writer/writer-fixtures.json.gz");
const bundle: Bundle = JSON.parse(gunzipSync(fs.readFileSync(bundleFile)).toString("utf8"));
const reports = new Map(bundle.reports.map((r) => [r.id, r]));
/** Bytes as one character each (compared as text: much faster than arrays of numbers). */
const text = (bytes: Uint8Array) => Buffer.from(bytes).toString("latin1");
const readBytes = (rel: string) => new Uint8Array(fs.readFileSync(path.resolve(packageDir, rel)));
const sha = (data: string | Uint8Array) =>
  createHash("sha256")
    .update(typeof data === "string" ? Buffer.from(data, "latin1") : data)
    .digest("hex");

/** The report of a .rep as the designer's server reads one (C# LoadFromStream without converting it to .Net, and UpdateReferences). */
function serverReport(rep: string): Report {
  return updateReferences(readReportXml(readBytes(rep)));
}

/** The report of its JSON as the designer's server reads it (DeserializeObject and UpdateReferences). */
function jsonReport(modelText: string): Report {
  return updateReferences(hydrateReport(parseReportJson(modelText)));
}

function modelTextOf(id: string): string {
  const text = reports.get(id)?.modelText;
  if (text === undefined) throw new Error("No C# model of " + id);
  return text;
}

/**
 * C# cannot read the JSON of a report with two items of the same name (Report.OnDeserialized adds
 * each item to the component list by its name, a SortedList: "An item with the same key has already
 * been added", wrapped by the reflection call): the error is C#'s JSON deserialization, before the
 * writer; hydrateReport renames the second item instead.
 */
const DESERIALIZATION_ERROR = "Exception has been thrown by the target of an invocation.";

/**
 * The differences with C# this port keeps, by JSON document: the line TypeScript writes and the
 * one C# writes instead (the rest of the document is checked to be the same).
 * - json-date-text: C#'s VariantJsonConverter reads the value of a variant with the reader's
 *   DateParseHandling, so the text of a text parameter that looks like a date becomes a DateTime,
 *   saved as Variant.ToString() gives it (in the culture of the server). Not reproduced: it is C#'s
 *   reading of the JSON, not its writer (the same text read from a .rep stays a text), and it
 *   changes what the user typed.
 */
const KNOWN_DIFFERENCES: Record<string, { ts: string; cs: string }> = {
  "json-date-text": {
    ts: '<VALUE type="String">2024#45#01#45#02T03:04:05</VALUE>',
    cs: '<VALUE type="String">1#47#2#47#2024 3:04:05 AM</VALUE>',
  },
};
function hasRepeatedNames(model: any): boolean {
  const names: string[] = [];
  for (const d of [...(model.params ?? []), ...(model.databaseInfo ?? []), ...(model.dataInfo ?? [])]) names.push(d.name);
  for (const s of model.subReports ?? []) {
    names.push(s.name);
    for (const sec of s.sections ?? []) {
      names.push(sec.name);
      for (const c of sec.components ?? []) names.push(c.name);
    }
  }
  return new Set(names).size !== names.length;
}

function expectError(action: () => unknown, message: string): void {
  let thrown: unknown = undefined;
  try {
    action();
  } catch (e) {
    thrown = e;
  }
  expect(thrown, "C# throws: " + message).toBeInstanceOf(Error);
  expect((thrown as Error).message).toBe(message);
}

function expectDocument(outcome: Outcome, bytes: Uint8Array | string): void {
  let data = typeof bytes === "string" ? Buffer.from(bytes, "latin1") : bytes;
  if (outcome.compressed) {
    expect(data[0], "zlib compressed as in C#").toBe(0x78);
    data = unzlibSync(data);
  } else expect(data[0]).toBe(0x3c);
  expect(data.length).toBe(outcome.length);
  expect(sha(data)).toBe(outcome.sha256);
}

describe("the fixtures", () => {
  it("cover the corpus", () => {
    expect(bundle.reports.length).toBeGreaterThanOrEqual(300);
    expect(bundle.documents.length).toBeGreaterThanOrEqual(300);
    expect(bundle.exports.length).toBeGreaterThanOrEqual(500);
    expect(bundle.imports.length).toBeGreaterThanOrEqual(300);
    const xml = bundle.reports.filter((r) => !r.write.error).length;
    expect(xml).toBeGreaterThanOrEqual(300);
  });
  it("were made from the reports of the repository as they are", () => {
    // A report changed since: run node test/generate-writer-fixtures.mjs (needs .NET).
    const changed = bundle.reports.filter((r) => sha(readBytes(r.rep)) !== r.input).map((r) => r.rep);
    expect(changed).toEqual([]);
  });
});

describe("writeReportXml(readReportXml(rep)) is the document C# writes", () => {
  for (const r of bundle.reports) {
    it(r.id, () => {
      const bytes = readBytes(r.rep);
      if (r.write.error) {
        expectError(() => writeReportXml(readReportXml(bytes)), r.write.error.message);
        return;
      }
      const report = readReportXml(bytes);
      const xml = writeReportXml(report);
      expectDocument(r.write, xml);
      // The bytes are the text (ASCII).
      expect(text(writeReportXmlBytes(readReportXml(bytes)))).toBe(xml);
      if (r.components && !r.components.error) {
        // ReportWriter.WriteComponents of all its components.
        const items = report.subReports.flatMap((s) => s.sections.flatMap((sec) => sec.components));
        const components = writeComponentsXml(items, report);
        expectDocument(r.components, components);
        // read back by readComponentsXml
        expect(readComponentsXml(components, new Report()).map((c) => c.className)).toEqual(items.map((c) => c.className));
      }
    });
  }
});

/**
 * Members the .rep does not keep as the model has them (C# writes them so):
 * - errorMessages: Param.ErrorMessage, the message of the current language only, is written;
 * - bidiModes: written only when they say more than BIDIMODE (whether the current language is
 *   right to left), which gives back the modes up to the current language (rightToLeft is
 *   compared instead);
 * - parentSub / parentSec: the parents C#'s reader links are written (a child subreport is its own
 *   parent subreport);
 * - streamFormat: XML while it is written;
 * - the value of a date parameter: only its day (TimeSpan.Days: truncated towards zero, so the day
 *   of a date before 1899-12-30 with a time of day becomes the next one);
 * - the texts written only when they are not empty (an empty one reads back as none);
 * - the texts of a label: one line per language (a line break inside one is a space, a CR is
 *   dropped) and the reader drops an empty one.
 */
function cleanLanguages(list: string[]): string[] {
  return list.map((s) => (s ?? "").replace(/\r/g, "").replace(/\n/g, " ")).filter((s) => s.length > 0);
}

function hasEmptyLanguage(report: Report): boolean {
  for (const s of report.subReports)
    for (const sec of s.sections)
      for (const c of sec.components)
        if (c instanceof LabelItem && c.allStrings.some((t) => t.replace(/[\r\n]/g, "").length === 0)) return true;
  return false;
}

const textParamTypes = [
  ParamType.String,
  ParamType.ExpreA,
  ParamType.ExpreB,
  ParamType.Subst,
  ParamType.List,
  ParamType.SubsExpreList,
  ParamType.InitialValue,
  ParamType.Unknown,
];

/** A date and time parameter before 1899-12-30 (in a report's JSON or model). */
function beforeDelphiEpoch(p: any): boolean {
  if (p.paramType !== ParamType.DateTime && p.paramType !== ParamType.Time) return false;
  const value = p.value?.value;
  const date = value instanceof Date ? value : typeof value === "string" ? new Date(value) : undefined;
  return date !== undefined && date.getTime() < new Date(1899, 11, 30).getTime();
}

/**
 * The documents that C#'s writer does not save as its reader reads them, so that saving the report
 * read back gives another one: a label with an empty language (the reader drops it, the languages
 * after it move up), and a date and time before 1899-12-30 (DateTimeToDelphiDateTime writes
 * TimeSpan.TotalDays, not the OLE date the reader reads: such a date moves at each save).
 */
function lossyDocument(report: Report): boolean {
  return hasEmptyLanguage(report) || report.params.some((p) => beforeDelphiEpoch(p));
}

function normalizeRoundTrip(json: any): any {
  const copy = structuredClone(json);
  const dropEmpty = (obj: any, keys: string[]) => {
    for (const k of keys) if (obj[k] === "") delete obj[k];
  };
  delete copy.streamFormat;
  dropEmpty(copy, ["docAuthor", "docTitle", "docSubject", "docProducer", "docCreator", "docCreationDate", "docModificationDate", "docKeywords", "docXMPContent"]);
  for (const d of copy.dataInfo ?? []) dropEmpty(d, ["sqlExplanation", "sqlExplanationError", "schemaName"]);
  for (const d of copy.databaseInfo ?? []) dropEmpty(d, ["configFile"]);
  // Written always, so none reads back as an empty one.
  if (copy.forcePaperName === undefined) copy.forcePaperName = "";
  for (const e of copy.embeddedFiles ?? [])
    for (const k of ["fileName", "mimeType", "description", "creationDate", "modificationDate"]) if (e[k] === undefined) e[k] = "";
  for (const p of copy.params ?? []) {
    delete p.errorMessages;
    if (p.paramType === ParamType.Date || p.paramType === ParamType.SubstExpre || beforeDelphiEpoch(p)) delete p.value;
    // A text parameter without value is written as an empty text.
    if (p.value?.type === "Null" && textParamTypes.includes(p.paramType)) p.value = { type: "String", value: "" };
  }
  for (const s of copy.subReports ?? []) {
    delete s.parentSub;
    delete s.parentSec;
    for (const sec of s.sections ?? [])
      for (const c of sec.components ?? []) {
        delete c.bidiModes;
        dropEmpty(c, ["annotationExpression"]);
        if (Array.isArray(c.allStrings)) c.allStrings = cleanLanguages(c.allStrings);
      }
  }
  return copy;
}

describe("a written report reads back as the same report", () => {
  // An undo operation without a date reads as "now": the two reads must see the same clock
  beforeEach(() => {
    vi.useFakeTimers({ now: new Date("2026-01-02T03:04:05.678Z"), toFake: ["Date"] });
  });
  afterEach(() => {
    vi.useRealTimers();
  });
  for (const r of bundle.reports.filter((r) => !r.write.error)) {
    it(r.id, () => {
      const first = readReportXml(readBytes(r.rep));
      const written = writeReportXmlBytes(first);
      const second = readReportXml(written);
      const again = writeReportXmlBytes(second);
      // The same document again (C#'s writer saves what its reader reads), but for the documents
      // lossyDocument tells.
      if (!lossyDocument(first)) expect(text(again)).toBe(text(written));
      // Once the empty languages are gone it is stable (a date before 1899-12-30 keeps moving).
      if (!first.params.some((p) => beforeDelphiEpoch(p))) expect(text(writeReportXmlBytes(readReportXml(again)))).toBe(text(again));
      const a = serializeReport(first);
      const b = serializeReport(second);
      expect(b.streamFormat).toBe(3);
      expect(jsonDiffs(normalizeRoundTrip(a), normalizeRoundTrip(b), "report")).toEqual([]);
    });
  }
});

describe("writeReportXml(updateReferences(hydrateReport(json))) is what the designer's server saves", () => {
  for (const d of bundle.documents) {
    it(d.id + (d.note ? ": " + d.note : ""), () => {
      const text = d.modelText ?? modelTextOf(d.report!);
      if (d.xml.error?.message === DESERIALIZATION_ERROR) {
        expect(hasRepeatedNames(JSON.parse(text))).toBe(true);
        return;
      }
      const report = jsonReport(text);
      if (d.xml.error) {
        expectError(() => writeReportXml(report), d.xml.error.message);
        return;
      }
      const xml = writeReportXml(report);
      const known = KNOWN_DIFFERENCES[d.id];
      if (known) {
        expect(xml).toContain(known.ts);
        expectDocument(d.xml, xml.replace(known.ts, known.cs));
        return;
      }
      expectDocument(d.xml, xml);
    });
  }
});

describe("exportSubReport is ExternalReport.ExportSubReport", () => {
  for (const e of bundle.exports) {
    it(`${e.report} #${e.index} from its ${e.from === "rep" ? ".rep" : "JSON"}`, () => {
      if (e.from === "json" && e.error?.message === DESERIALIZATION_ERROR) {
        expect(hasRepeatedNames(JSON.parse(modelTextOf(e.report)))).toBe(true);
        return;
      }
      const load = () => (e.from === "rep" ? serverReport(reports.get(e.report)!.rep) : jsonReport(modelTextOf(e.report)));
      if (e.error) {
        expectError(() => exportSubReport(load(), e.index), e.error.message);
        return;
      }
      const bytes = exportSubReport(load(), e.index);
      expectDocument(e, bytes);
      // The same document as text.
      const xml = exportSubReportXml(load(), e.index);
      expect(sha(xml)).toBe(e.sha256);
    });
  }
});

/**
 * What C#'s model of a report read from its JSON says differently from hydrateReport's, without a
 * difference in what is written: the integer of a variant is a long (Variant.AssignFromObject of
 * Newtonsoft's Int64), and a report whose JSON has no undo history has none (hydrateReport gives
 * the designer an empty one).
 */
function csJsonOfJsonTarget(json: any, from: string): any {
  if (from !== "json") return json;
  const copy = structuredClone(json);
  for (const p of copy.params ?? []) if (p.value?.type === "Long") p.value.type = "Integer";
  if (copy.undoCue === undefined) copy.undoCue = { groupId: 0, undoOperations: [], redoOperations: [] };
  return copy;
}

describe("importReport is ExternalReport.ImportReport", () => {
  for (const im of bundle.imports) {
    it(`${im.source} into ${im.target === "-" ? "a new report" : im.target} (${im.from})`, () => {
      if (im.from === "json" && im.error?.message === DESERIALIZATION_ERROR) {
        expect(hasRepeatedNames(JSON.parse(modelTextOf(im.target)))).toBe(true);
        return;
      }
      const target =
        im.from === "new" ? new Report() : im.from === "rep" ? serverReport(reports.get(im.target)!.rep) : jsonReport(modelTextOf(im.target));
      const source = serverReport(reports.get(im.source)!.rep);
      expect(importReport(target, source)).toBe(target);
      if (im.json) {
        const out: Comparison = { diffs: [], compared: 0 };
        compare("report", csJsonOfJsonTarget(im.json, im.from), serializeReport(target), "report", out, true);
        expect(out.diffs).toEqual([]);
      }
      if (im.error) {
        expectError(() => writeReportXml(target), im.error.message);
        return;
      }
      expectDocument(im, writeReportXml(target));
    });
  }
});

describe("the undo history as C# writes it", () => {
  it("keeps the numbers, dates and texts of a history written by C#", () => {
    // (writer-kitchen-sink.rep has such a history, checked against C# above.)
    const head =
      '{"GroupId":0,"UndoOperations":[{"Operation":1,"GroupId":1,"ComponentName":"REPORT","ComponentClass":"TRPREPORT",' +
      '"ParentName":null,"OldItemIndex":null,"OldParentName":null,"Date":"2026-01-02T03:04:05.1234567Z","ExpandedProperties":true,' +
      '"Properties":[{"PropertyName":"ratio","PropertyType":2,"OldValue":2.0,"NewValue":';
    const tail = "}]}],\"RedoOperations\":[]}";
    const xml = writeReportXml(readReportXml(reportWithHistory(head + '[1e2,-0.0,{"a":3.0},4]' + tail)));
    // Newtonsoft: 1e2 is the double 100.0, 4 a long.
    expect(bincue(xml)).toBe(head + '[100.0,-0.0,{"a":3.0},4]' + tail);
  });
  it("writes a history of the TypeScript designer as C# does", () => {
    const report = new Report();
    const cue = new UndoCue();
    const op = new ChangeObjectOperation(OperationType.Modify, 4);
    op.componentName = "TRPLABEL1";
    op.date = new Date(Date.UTC(2026, 10, 20, 10, 11, 12, 340));
    op.properties.push(new ChangeOperationItem("posX", PropertyType.Integer, 10, 20.5));
    op.properties.push(new ChangeOperationItem("text", PropertyType.String, 'a"b\\c\u0001\u2028', "2024-01-01T00:00:00.000"));
    cue.undoOperations.push(op);
    report.undoCue = cue;
    expect(bincue(writeReportXml(report))).toBe(
      '{"GroupId":0,"UndoOperations":[{"Operation":1,"GroupId":4,"ComponentName":"TRPLABEL1","ComponentClass":null,' +
        '"ParentName":null,"OldItemIndex":null,"OldParentName":null,"Date":"2026-11-20T10:11:12.34Z","ExpandedProperties":true,' +
        '"Properties":[{"PropertyName":"posX","PropertyType":1,"OldValue":10,"NewValue":20.5},' +
        '{"PropertyName":"text","PropertyType":3,"OldValue":"a\\"b\\\\c\\u0001\\u2028","NewValue":"2024-01-01T00:00:00"}]}],"RedoOperations":[]}'
    );
  });
});

/** A report whose BINCUE is that JSON text. */
function reportWithHistory(json: string): Uint8Array {
  const hex = Buffer.from(json, "utf8").toString("hex").toUpperCase();
  const xml =
    '<?xml version="1.0" standalone="no"?>\n<!DOCTYPE REPORT_MANAGER_2>\n<REPORT>\n' +
    `<BINCUE type="Binary" size="${hex.length / 2}">${hex}</BINCUE>\n</REPORT>\n`;
  return new Uint8Array(Buffer.from(xml, "latin1"));
}

/** The JSON text of the BINCUE of a written report. */
function bincue(xml: string): string {
  const m = /<BINCUE type="Binary" size="(\d+)">([\s\S]*?)<\/BINCUE>/.exec(xml);
  if (!m) throw new Error("no BINCUE");
  const bytes = Buffer.from(m[2].replace(/\r\n/g, ""), "hex");
  expect(bytes.length).toBe(Number(m[1]));
  return bytes.toString("utf8");
}

describe("the values the writer formats", () => {
  it("writes the parameter values as C# does", () => {
    const report = new Report();
    const add = (alias: string, paramType: ParamType, type: VariantType, value: unknown) => {
      const p = hydrateReport({ params: [{ alias, name: alias, paramType, value: { type, value } }] }).params[0];
      report.params.push(p);
      return p;
    };
    const pint = add("PINT", ParamType.Integer, VariantType.String, " 42 ");
    add("PTEXT", ParamType.Integer, VariantType.String, "4x");
    add("PDOUBLE", ParamType.Double, VariantType.Double, 0.1 + 0.2);
    add("PSMALL", ParamType.Double, VariantType.Double, 1e-5);
    add("PBIG", ParamType.Double, VariantType.Double, 1e15);
    add("PBIGGER", ParamType.Double, VariantType.Double, 1e17);
    add("PSTRING", ParamType.String, VariantType.Double, 1 / 3);
    add("PBOOL", ParamType.Bool, VariantType.Integer, 2);
    const xml = writeReportXml(report);
    const value = (alias: string) => new RegExp(`<NAME type="String">${alias}</NAME>[\\s\\S]*?(<VALUE [^\\n]*)`).exec(xml)![1];
    expect(value("PINT")).toBe('<VALUE type="Integer">42</VALUE>');
    // C# parity: saving turns the text of a number into the number.
    expect(pint.value).toEqual({ type: VariantType.Integer, value: 42 });
    expect(value("PTEXT")).toBe('<VALUE type="String">4x</VALUE>');
    expect(value("PDOUBLE")).toBe('<VALUE type="Double">0.30000000000000004</VALUE>');
    expect(value("PSMALL")).toBe('<VALUE type="Double">1E-05</VALUE>');
    // Fixed point up to 17 digits (.NET 5 and later), then an exponent.
    expect(value("PBIG")).toBe('<VALUE type="Double">1000000000000000</VALUE>');
    expect(value("PBIGGER")).toBe('<VALUE type="Double">1E+17</VALUE>');
    // Variant.ToString of a double: 15 significant digits.
    expect(value("PSTRING")).toBe('<VALUE type="String">0.333333333333333</VALUE>');
    expect(value("PBOOL")).toBe('<VALUE type="Boolean">True</VALUE>');
  });
  it("throws as C# does for a value it cannot convert", () => {
    const report = hydrateReport({ params: [{ alias: "PDATE", name: "PDATE", paramType: ParamType.Date, value: { type: "Null", value: null } }] });
    expectError(() => writeReportXml(report), "Type conversion error");
    // (golden-cs json-to-xml gives these two messages for the same parameters)
    const bool = hydrateReport({ params: [{ alias: "PB", name: "PB", paramType: ParamType.Bool, value: { type: "String", value: "x" } }] });
    expectError(() => writeReportXml(bool), "Type conversion errorImplicit bool from VariantType.String");
  });
});
