// Generates the fixtures of the .rep XML writer tests (test/writer.test.ts): what the C# engine
// writes for every XML report of the repository, so that the tests run without .NET.
//
//   node test/generate-writer-fixtures.mjs [--extra <folder>]... [--out <bundle.json.gz>] [--dump <folder>]
//
// Corpus: every .rep tracked by git in the repository (samples/, the fixtures of every package)
// whose content is XML, plain or zlib compressed (the DFM ones are not read by the C# reader),
// deduplicated by content, and the synthetic reports written here into
// test/fixtures/reports/synthetic/writer-*.rep (the writer's own cases: undo histories written by
// C#, every parameter type, the links of child subreports, bidirectional modes...).
// For each report, with golden-cs (batch mode, one process):
//   - model-json: the C# model, the document hydrateReport reads,
//   - write-xml: the report read and saved by C# (SHA-256 of the bytes, or the exception),
//   - json-to-xml: the model saved as the designer's server saves the JSON it receives,
//   - export-subreport of its first subreports, from the .rep and from the model,
// plus JSON documents derived here from the models (what the designer may send: texts for numbers,
// names left empty, line breaks inside a label's language...), and import-report of pairs of them.
// Output: test/fixtures/writer/writer-fixtures.json.gz (or --out), read by writer.test.ts. The C#
// documents are kept as SHA-256 only; --dump <folder> also writes them there to look at a
// difference.
//
// --extra <folder>: also the XML .rep files of that folder (recursively), e.g. the Delphi repository;
// with --out, to check them locally:
//   node test/generate-writer-fixtures.mjs --extra C:\desarrollo\prog\toni\reportman --out %TEMP%\full.json.gz
//   set REPORTMAN_WRITER_FIXTURES=%TEMP%\full.json.gz && npx vitest run packages/reportman-lib/test/writer.test.ts
//
// Needs the built harness: dotnet build -c Release tools/golden-cs (from typescript/).

import { execFileSync } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import zlib from "node:zlib";

const testDir = path.dirname(fileURLToPath(import.meta.url));
const packageDir = path.dirname(testDir);
const typescriptDir = path.resolve(packageDir, "..", "..");
const repoDir = path.resolve(typescriptDir, "..");
const golden = path.join(typescriptDir, "tools", "golden-cs", "bin", "Release", "net10.0", "golden-cs.exe");
const syntheticDir = path.join(testDir, "fixtures", "reports", "synthetic");
const writerDir = path.join(testDir, "fixtures", "writer");

const args = process.argv.slice(2);
const option = (name) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
};
const extras = args.flatMap((a, i) => (a === "--extra" ? [args[i + 1]] : []));
const outFile = option("--out") ?? path.join(writerDir, "writer-fixtures.json.gz");
const dumpDir = option("--dump");
const work = fs.mkdtempSync(path.join(os.tmpdir(), "rep-writer-"));
fs.mkdirSync(writerDir, { recursive: true });
if (dumpDir) fs.mkdirSync(dumpDir, { recursive: true });

// ---- Writing reports as the C# ReportWriter does (as in generate-fixtures.mjs) ----

const C_MAXDATAWIDTH = 40;
function rpString(s) {
  let out = "";
  let alen = 0;
  for (const c of s.split("")) {
    if (/[0-9A-Za-z_ .()=;:]/.test(c)) {
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
const I = (name, value) => `<${name} type="Integer">${value}</${name}>`;
const B = (name, value) => `<${name} type="Boolean">${value ? "True" : "False"}</${name}>`;
const D = (name, value) => `<${name} type="Double">${value}</${name}>`;
const hex = (bytes) => Buffer.from(bytes).toString("hex").toUpperCase();
const BIN = (name, bytes) => `<${name} type="Binary" size="${bytes.length}">${rpString(hex(bytes))}</${name}>`;
const component = (name, className, props) => ["<COMPONENT>", S("NAME", name), S("CLASSNAME", className), ...props, "</COMPONENT>"];
const lines = (list) => list.flat(Infinity).join("\r\n") + "\r\n";

// An undo history as the C# designer writes it (Newtonsoft default settings): doubles with a
// decimal point, the dates of every kind, the texts JSON escapes. As JSON text, to keep 2.0 as it is.
const undoCSharp =
  `{"GroupId":3,"UndoOperations":[` +
  `{"Operation":0,"GroupId":1,"ComponentName":"TRPBARCODE1","ComponentClass":"TRPBARCODE","ParentName":"TRpSection0",` +
  `"OldItemIndex":null,"OldParentName":null,"Date":"2026-05-29T14:18:58.3640000Z","ExpandedProperties":true,"Properties":[` +
  `{"PropertyName":"ratio","PropertyType":2,"OldValue":null,"NewValue":2.0},` +
  `{"PropertyName":"axisYInitial","PropertyType":2,"OldValue":1e2,"NewValue":-0.0},` +
  `{"PropertyName":"list","PropertyType":8,"OldValue":[1.0,2,"a\\"b\\\\c\\u0001\\u2028\\u0085 \u00e9 \ud83d\ude00 </x>"],"NewValue":{"type":"Double","value":3.0,"nested":[{"x":4.0,"y":5}]}},` +
  `{"PropertyName":"big","PropertyType":1,"OldValue":12345678901234,"NewValue":-5},` +
  `{"PropertyName":"text","PropertyType":3,"OldValue":"tab\\there\\r\\nnew","NewValue":"\\b\\f/"},` +
  `{"PropertyName":"when","PropertyType":4,"OldValue":"2024-01-02T03:04:05.000","NewValue":"/Date(1700000000000)/"}]},` +
  `{"Operation":"Rename","GroupId":2,"ComponentName":"A","ComponentClass":null,"OldItemIndex":3,"OldParentName":"X",` +
  `"Date":"2024-01-02T03:04:05","ExpandedProperties":false,"Properties":[{"PropertyName":"name","PropertyType":"String","OldValue":"a","NewValue":"b"}]}` +
  `],"RedoOperations":[{"operation":2,"groupId":3,"componentName":"B","date":"2026-06-17T13:11:19.3910001Z","properties":[]}]}`;

// An operation without a date (null): C# writes it so; its JSON leaves the date out, and the
// constructor of the operation stamps the time of the run, so this report has no JSON case.
const undoNullDate =
  `{"GroupId":0,"UndoOperations":[{"Operation":1,"GroupId":1,"ComponentName":"REPORT","ComponentClass":"TRPREPORT",` +
  `"Date":null,"Properties":[{"PropertyName":"copies","PropertyType":1,"OldValue":1,"NewValue":2}]}],"RedoOperations":[]}`;

/** writer-kitchen-sink: the reader's kitchen sink (synthetic/kitchen-sink.rep) made writable and extended. */
function writerKitchenSink() {
  let text = fs.readFileSync(path.join(syntheticDir, "kitchen-sink.rep"), "latin1");
  // The history written by C#, instead of the reader's.
  text = text.replace(/<BINCUE type="Binary" size="\d+">[\s\S]*?<\/BINCUE>/, BIN("BINCUE", Buffer.from(undoCSharp, "utf8")));
  // Two components of the same mixed-case name: C# cannot read the JSON of such a report.
  const same = '<NAME type="String">Same</NAME>';
  const second = text.indexOf(same, text.indexOf(same) + 1);
  text = text.substring(0, second) + '<NAME type="String">Other</NAME>' + text.substring(second + same.length);
  // No embedded file: C# cannot save one without contents, nor write the JSON of one with them
  // (writer-embedded has them).
  text = text.replace(/<EMBEDDEDFILE>[\s\S]*?<\/EMBEDDEDFILE>\r\n/, "");
  // More parameters: every type and the values the writer formats.
  const params = [
    ["PDATEFRAC", 3, D("VALUE", "45000.75")],
    ["PDATENEG", 3, D("VALUE", "-0.5")],
    ["PDATETIMEFRAC", 5, D("VALUE", "45000.123456789")],
    ["PTIMEFRAC", 4, D("VALUE", "0.333333333333333")],
    ["PDATETIMEOLD", 5, D("VALUE", "-700.3")],
    ["PDOUBLESMALL", 2, D("VALUE", "1e-5")],
    ["PDOUBLEBIG", 2, D("VALUE", "1e15")],
    ["PDOUBLENOISE", 2, D("VALUE", "0.30000000000000004")],
    ["PDOUBLENEGZERO", 2, D("VALUE", "-0")],
    ["PDOUBLEMAX", 2, D("VALUE", "1.7976931348623157E+308")],
    ["PCURRENCY2", 6, D("VALUE", "1234567.891")],
    ["PBOOLFALSE", 7, B("VALUE", false)],
    ["PEXPREB", 8, S("VALUE", "1+1")],
    ["PSUBST", 10, S("VALUE", "WHERE X=1")],
    ["PLIST", 11, S("VALUE", "2")],
    ["PSUBSTEXPRE", 13, S("VALUE", "ignored")],
    ["PSUBSLIST", 14, S("VALUE", "a")],
    ["PINITIAL", 15, S("VALUE", "TODAY")],
    ["PUNKNOWN", 16, S("VALUE", "?")],
  ].map(([name, type, value]) => ["<PARAMETER>", S("NAME", name), I("PARAMTYPE", type), value, "</PARAMETER>"]);
  params.push([
    "<PARAMETER>",
    S("NAME", "PMESSAGES"),
    S("DESCRIPTION", "D0\nD1\nD2"),
    S("HINT", "H0\r\nH1"),
    S("ERRORMESSAGE", "X"),
    S("ITEMS", "\u00e9\nx y"),
    "</PARAMETER>",
  ]);
  text = text.replace("<SUBREPORT>", lines(params) + "<SUBREPORT>");
  // The section of the second subreport prints a third subreport (which names no parent: C#'s reader
  // makes it its own parent subreport), whose section prints the first one.
  text = text.replace(
    '<NAME type="String">TRpSection2</NAME>',
    '<NAME type="String">TRpSection2</NAME>\r\n' + S("CHILDSUBREPORT", "TRpSubReport2")
  );
  const thirdSubreport = [
    "<SUBREPORT>",
    S("NAME", "TRpSubReport2"),
    S("ALIAS", "MASTER"),
    "<SECTION>",
    S("NAME", "TRpSection3"),
    I("SECTIONTYPE", 2),
    S("CHILDSUBREPORT", "trpsubreport0"),
    // Bidirectional modes: the report language is 1, its mode is item 2.
    component("TRpLabelFull", "TRPLABEL", [S("BIDIMODES", "BidiNo\r\nBidiNo\r\nBidiFull\r\nBidiPartial\r\n"), S("WIDETEXT", "a\r\nb\r\nc")]),
    component("TRpLabelPartial", "TRPLABEL", [I("BIDIMODE", 1), S("WIDETEXT", "\ud83d\ude00 0123456789012345678901234567890123456789#<>&\"")]),
    component("TRpLabelFirst", "TRPLABEL", [S("BIDIMODES", "BidiPartial\r\n")]),
    component("TRpExprRtl", "TRPEXPRESSION", [I("BIDIMODE", 1), I("ALIGNMENT", 1024), I("VALIGNMENT", 32), B("ISHTML", true)]),
    component("TRpChartRanges", "TRPCHART", [D("YMIN", "1e-7"), D("YMAX", "1e21"), S("SERIESCOLORS", "1, 2,,3")]),
    component("TRpChartInf", "TRPCHART", [D("YMIN", "-0"), D("YMAX", "Infinity")]),
    component("TRpChartNaN", "TRPCHART", [D("YMIN", "NaN"), D("YMAX", "-Infinity")]),
    component("TRpBarcodeNoise", "TRPBARCODE", [D("RATIO", "0.30000000000000004")]),
    component("TRpBarcodeSmall", "TRPBARCODE", [D("RATIO", "1.5e-5"), I("ROTATION", -900)]),
    component("TRpImageEmpty", "TRPIMAGE", [S("EXPRESSION", "")]),
    component("TRpShapeMax", "TRPSHAPE", [I("BRUSHCOLOR", 2147483647), I("PENCOLOR", -2147483648)]),
    "</SECTION>",
    "</SUBREPORT>",
  ];
  text = text.replace("</REPORT>", lines(thirdSubreport) + "</REPORT>");
  return text;
}

/**
 * Embedded files with contents, one empty (C# cannot save one without contents, nor write the JSON
 * of a report that has them: this report has no JSON case).
 */
function writerEmbedded() {
  return lines([
    '<?xml version="1.0" standalone="no"?>',
    "<!DOCTYPE REPORT_MANAGER_2>",
    "<REPORT>",
    S("DOCAUTHOR", "\u00C1lvaro"),
    I("PDFCONFORMANCE", 1),
    "<EMBEDDEDFILE>",
    S("FILENAME", "factur-x.xml"),
    S("MIMETYPE", "text/xml"),
    S("DESCRIPTION", "The invoice, as XML"),
    S("CREATIONDATE", "D:20240101"),
    S("MODIFICATIONDATE", "D:20240202"),
    I("RELATIONSHIP", 2),
    BIN("STREAM", Buffer.from("<invoice>\u00E9 " + "0123456789".repeat(5) + "</invoice>", "utf8")),
    "</EMBEDDEDFILE>",
    "<EMBEDDEDFILE>",
    S("FILENAME", "empty.txt"),
    BIN("STREAM", []),
    "</EMBEDDEDFILE>",
    "<SUBREPORT>",
    S("NAME", "SUB"),
    "<SECTION>",
    S("NAME", "SEC"),
    I("SECTIONTYPE", 2),
    "</SECTION>",
    "</SUBREPORT>",
    "</REPORT>",
  ]);
}

/** A report with a null operation date (see undoNullDate). */
function writerNullDate() {
  return lines([
    '<?xml version="1.0" standalone="no"?>',
    "<!DOCTYPE REPORT_MANAGER_2>",
    "<REPORT>",
    BIN("BINCUE", Buffer.from(undoNullDate, "utf8")),
    "<SUBREPORT>",
    S("NAME", "SUB"),
    "<SECTION>",
    S("NAME", "SEC"),
    "</SECTION>",
    "</SUBREPORT>",
    "</REPORT>",
  ]);
}

const synthetic = {
  "writer-kitchen-sink": writerKitchenSink(),
  "writer-null-date": writerNullDate(),
  "writer-embedded": writerEmbedded(),
};
for (const [name, text] of Object.entries(synthetic)) fs.writeFileSync(path.join(syntheticDir, name + ".rep"), Buffer.from(text, "latin1"));
// zlib: the stream format of the kitchen sink is XMLZlib; this one is also compressed on disk.
fs.writeFileSync(path.join(syntheticDir, "writer-kitchen-sink-zlib.rep"), zlib.deflateSync(fs.readFileSync(path.join(syntheticDir, "writer-kitchen-sink.rep"))));
const noJson = new Set(["synthetic-writer-null-date"]);

// ---- The corpus ----

const rel = (file) => path.relative(packageDir, file).split(path.sep).join("/");
function walk(dir, out) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (["node_modules", "bin", "obj", ".git"].includes(e.name)) continue;
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, out);
    else if (e.name.toLowerCase().endsWith(".rep")) out.push(p);
  }
}
const files = execFileSync("git", ["ls-files", "*.rep"], { cwd: repoDir, encoding: "utf8" })
  .split(/\r?\n/)
  .filter((f) => f.length > 0)
  .map((f) => path.join(repoDir, f));
for (const name of [...Object.keys(synthetic), "writer-kitchen-sink-zlib"]) files.push(path.join(syntheticDir, name + ".rep"));
for (const extra of extras) walk(path.resolve(extra), files);

/**
 * samples/x.rep: samples-x; typescript/packages/reportman-P/test/fixtures/a/x.rep: P-a-x (the
 * lib's own reports: a-x, as in cases.json); outside the repository: extra-x-<hash>.
 */
function idFor(file, hash) {
  let r = path.relative(repoDir, file).split(path.sep).join("/");
  if (r.startsWith("..")) return "extra-" + path.basename(file, path.extname(file)) + "-" + hash.slice(0, 6);
  r = r
    .replace(/^typescript\/packages\/reportman-lib\/test\/fixtures\/reports\//, "")
    .replace(/^typescript\/packages\/reportman-/, "")
    .replace(/\/test\/fixtures\//, "/")
    .replace(/\/test\//, "/");
  return r.replace(/\.rep$/i, "").replace(/[^A-Za-z0-9_]+/g, "-");
}
const reports = [];
const seen = new Set();
for (const file of files) {
  const bytes = fs.readFileSync(file);
  if (bytes.length === 0 || (bytes[0] !== 0x3c && bytes[0] !== 0x78)) continue;
  if (bytes[0] === 0x78) {
    // zlib: only an XML report inside
    try {
      const inner = zlib.inflateSync(bytes);
      if (inner[0] !== 0x3c) continue;
    } catch {
      continue;
    }
  }
  const hash = crypto.createHash("sha256").update(bytes).digest("hex");
  if (seen.has(hash)) continue;
  seen.add(hash);
  reports.push({ id: idFor(file, hash), rep: rel(file), input: hash, file });
}

// ---- golden-cs, in batches ----

function batch(jobs) {
  const jobsFile = path.join(work, "jobs.json");
  const resultsFile = path.join(work, "results.json");
  fs.writeFileSync(jobsFile, JSON.stringify(jobs));
  execFileSync(golden, ["batch", jobsFile, resultsFile], { stdio: ["ignore", "inherit", "inherit"], maxBuffer: 1 << 28 });
  return JSON.parse(fs.readFileSync(resultsFile, "utf8"));
}
const sha = (bytes) => crypto.createHash("sha256").update(bytes).digest("hex");
function outcome(error, file, dumpName) {
  if (error) return { error: { type: error.type, message: error.message } };
  const bytes = fs.readFileSync(file);
  if (dumpDir) fs.copyFileSync(file, path.join(dumpDir, dumpName));
  const result = { sha256: sha(bytes), length: bytes.length };
  // An exported subreport of an XMLZlib report is compressed: its XML is compared.
  if (bytes[0] === 0x78) {
    const xml = zlib.inflateSync(bytes);
    if (dumpDir) fs.writeFileSync(path.join(dumpDir, dumpName + ".xml"), xml);
    return { compressed: true, sha256: sha(xml), length: xml.length };
  }
  return result;
}
const tmp = (name) => path.join(work, name);
/** The JSON text without the blanks between its tokens (the numbers as they are written). */
function minifyJson(text) {
  let out = "";
  let inString = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inString) {
      out += c;
      if (c === "\\") out += text[++i];
      else if (c === '"') inString = false;
    } else if (c === '"') {
      inString = true;
      out += c;
    } else if (!/[ \t\r\n\uFEFF]/.test(c)) out += c;
  }
  return out;
}

// 1. model-json, write-xml and write-components of every report
let results = batch(
  reports.flatMap((r) => [
    ["model-json", r.file, tmp(r.id + ".json")],
    ["write-xml", r.file, tmp(r.id + ".xml")],
    ["write-components", r.file, tmp(r.id + ".components.xml")],
  ])
);
reports.forEach((r, i) => {
  const modelError = results[3 * i];
  r.write = outcome(results[3 * i + 1], tmp(r.id + ".xml"), r.id + ".cs.xml");
  // ReportWriter.WriteComponents of all the components of the report
  if (!results[3 * i + 1]) r.components = outcome(results[3 * i + 2], tmp(r.id + ".components.xml"), r.id + ".components.xml");
  if (modelError) r.modelError = { type: modelError.type, message: modelError.message };
  else {
    // The JSON text as C# wrote it (2.0 stays 2.0: parseReportJson keeps it), without blanks.
    r.modelText = minifyJson(fs.readFileSync(tmp(r.id + ".json"), "utf8"));
    r.model = JSON.parse(r.modelText);
  }
});

// 2. JSON documents: the model of every report, and documents derived from the kitchen sink's.
const documents = [];
for (const r of reports) if (r.model && !noJson.has(r.id)) documents.push({ id: r.id, report: r.id });
const kitchenReport = reports.find((r) => r.id === "synthetic-writer-kitchen-sink");
if (!kitchenReport.model) throw new Error("No C# model of the kitchen sink: " + JSON.stringify(kitchenReport.modelError));
const kitchen = kitchenReport.model;
const derive = (id, note, change) => {
  const model = structuredClone(kitchen);
  change(model);
  documents.push({ id, note, model });
};
const allComponents = (m) => m.subReports.flatMap((s) => s.sections.flatMap((sec) => sec.components));
const param = (m, alias) => m.params.find((p) => p.alias === alias);
derive("json-texts-for-numbers", "values the designer may send as text", (m) => {
  param(m, "PINT").value = { type: "String", value: " 42 " };
  param(m, "PDOUBLE").value = { type: "String", value: "-1.5e3" };
  param(m, "PCURRENCY").value = { type: "String", value: "1,234.5" };
  param(m, "PCURRENCY2").value = { type: "String", value: "not a number" };
  param(m, "PBOOL").value = { type: "Integer", value: 1 };
  param(m, "PDATE").value = { type: "DateTime", value: "2024-05-06T07:08:09.123" };
  param(m, "PSTRING").value = { type: "Integer", value: 12 };
  param(m, "PEXPRE").value = { type: "Double", value: 0.1 };
});
derive("json-unnamed", "items without a name (EnsureComponentNames), repeated aliases (UpdateReferences)", (m) => {
  // C# parity: only one, Report.OnDeserialized adds every item by its name (an empty one too).
  m.dataInfo[1].name = "";
  m.dataInfo.push({ ...structuredClone(m.dataInfo[0]), name: "TRPDATAINFOITEM9" });
  m.databaseInfo.push({ ...structuredClone(m.databaseInfo[0]), name: "TRPDATABASEINFOITEM9" });
});
derive("json-label-lines", "line breaks inside the text of a language", (m) => {
  const label = allComponents(m).find((c) => c.className === "TRPLABEL");
  label.allStrings = ["one\r\ntwo", "a\nb\rc", "", "\u00e9\u20ac"];
});
derive("json-designer-history", "an undo history as the TypeScript designer sends it", (m) => {
  m.undoCue = {
    groupId: 5,
    undoOperations: [
      {
        operation: 1,
        groupId: 4,
        componentName: "TRpLabel0",
        componentClass: "TRPLABEL",
        date: "2026-11-20T10:11:12.345Z",
        expandedProperties: true,
        properties: [
          { propertyName: "posX", propertyType: 1, oldValue: 10, newValue: 20.5 },
          { propertyName: "allStrings", propertyType: 8, oldValue: ["a"], newValue: ["b", "c"] },
          { propertyName: "wFontName", propertyType: 3, oldValue: "Arial", newValue: "2024-01-01T00:00:00.000" },
        ],
      },
    ],
    redoOperations: [],
  };
});
derive("json-child-name", "a child subreport named by its exact (mixed case) name", (m) => {
  m.subReports[0].sections[0].childSubReportName = "TRpSubReport1";
});
derive("json-empty-history", "an empty undo history (not written)", (m) => {
  m.undoCue = { groupId: 0, undoOperations: [], redoOperations: [] };
});
derive("json-date-text", "a text parameter whose text looks like a date (a known difference)", (m) => {
  param(m, "PSTRING").value = { type: "String", value: "2024-01-02T03:04:05" };
});
for (const d of documents) {
  if (!d.model) continue;
  d.modelText = JSON.stringify(d.model);
  fs.writeFileSync(tmp(d.id + ".json"), d.modelText);
}
results = batch(documents.map((d) => ["json-to-xml", d.model ? tmp(d.id + ".json") : tmp(d.report + ".json"), tmp(d.id + ".json.xml")]));
documents.forEach((d, i) => (d.xml = outcome(results[i], tmp(d.id + ".json.xml"), d.id + ".json.xml")));

// 3. export-subreport: the first three subreports of every report, from its .rep; the first
// one also from its model.
const exportsList = [];
for (const r of reports) {
  if (!r.model && r.write.error) continue;
  const count = r.model ? r.model.subReports.length : 1;
  for (let index = 0; index < Math.min(count, 3); index++) {
    exportsList.push({ report: r.id, index, from: "rep" });
    if (index === 0 && r.model && !noJson.has(r.id)) exportsList.push({ report: r.id, index, from: "json" });
  }
}
const byId = new Map(reports.map((r) => [r.id, r]));
results = batch(
  exportsList.map((e, i) => [
    "export-subreport",
    e.from === "rep" ? byId.get(e.report).file : tmp(e.report + ".json"),
    String(e.index),
    tmp("export" + i + ".rep"),
  ])
);
exportsList.forEach((e, i) => Object.assign(e, outcome(results[i], tmp("export" + i + ".rep"), `${e.report}.export${e.index}.${e.from}.rep`)));

// 4. import-report: every report into the next one (from its .rep, and from its model for one
// pair in four), some into themselves, into a new report, and a few chosen pairs. The XML of the
// target for all; the C# JSON of the target (to compare the models) for one in eight and the
// chosen ones (it is most of the size of the bundle).
const importable = reports.filter((r) => r.model && !noJson.has(r.id));
const importsList = [];
importable.forEach((target, k) => {
  const source = importable[(k + 1) % importable.length];
  importsList.push({ target: target.id, source: source.id, from: "rep" });
  if (k % 4 === 0) importsList.push({ target: target.id, source: source.id, from: "json" });
  if (k % 25 === 0) {
    importsList.push({ target: target.id, source: target.id, from: "rep" });
    importsList.push({ target: target.id, source: target.id, from: "json" });
  }
  if (k % 50 === 0) importsList.push({ target: "-", source: target.id, from: "new" });
});
for (const t of ["synthetic-writer-kitchen-sink", "engine-repsamples-bold"]) {
  for (const s of ["synthetic-writer-kitchen-sink", "engine-repsamples-bold", "samples-customers"])
    for (const from of ["rep", "json"]) importsList.push({ target: t, source: s, from, withJson: true });
}
const importsFiltered = importsList.filter((im) => (im.target === "-" || byId.has(im.target)) && byId.has(im.source));
results = batch(
  importsFiltered.map((im, i) => [
    "import-report",
    im.from === "new" ? "-" : im.from === "rep" ? byId.get(im.target).file : tmp(im.target + ".json"),
    byId.get(im.source).file,
    tmp("import" + i + ".json"),
    tmp("import" + i + ".xml"),
  ])
);
importsFiltered.forEach((im, i) => {
  Object.assign(im, outcome(results[i], tmp("import" + i + ".xml"), `import${i}.xml`));
  if (!results[i] && (im.withJson || i % 8 === 0)) im.json = JSON.parse(fs.readFileSync(tmp("import" + i + ".json"), "utf8"));
  delete im.withJson;
});

// ---- The bundle ----

const bundle = {
  reports: reports.map(({ file, model, ...r }) => r),
  documents: documents.map(({ model, ...d }) => d),
  exports: exportsList,
  imports: importsFiltered,
};
fs.writeFileSync(outFile, zlib.gzipSync(JSON.stringify(bundle), { level: 9 }));
fs.rmSync(work, { recursive: true, force: true });
const count = (list, f) => list.filter(f).length;
console.log(
  `${reports.length} reports (${count(reports, (r) => r.write.error)} C# write errors, ${count(reports, (r) => r.modelError)} without JSON), ` +
    `${documents.length} JSON documents (${count(documents, (d) => d.xml.error)} errors), ` +
    `${exportsList.length} exports (${count(exportsList, (e) => e.error)} errors), ` +
    `${importsFiltered.length} imports (${count(importsFiltered, (e) => e.error)} errors) -> ${path.relative(process.cwd(), outFile)}`
);
