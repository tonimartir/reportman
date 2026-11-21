// The fixes of the report model and its string / adapter based clipboard.
import { describe, expect, it } from "vitest";
import {
  ChangeObjectOperation,
  DataInfo,
  DatabaseInfo,
  ExpressionItem,
  LabelItem,
  OperationType,
  Param,
  PrintItemText,
  BidiModeType,
  Report,
  Section,
  SectionType,
  SubReport,
  UndoCue,
  type ClipboardAdapter,
} from "@reportman/lib";

function newReport(): Report {
  const report = new Report();
  report.undoCue = new UndoCue();
  const sub = new SubReport();
  report.newName(sub);
  report.subReports.push(sub);
  SubReport.initNew(report, sub);
  report.updateComponentList();
  return report;
}

describe("report model fixes", () => {
  it("records the database alias and the SQL of a deleted dataset under their own names", () => {
    const report = newReport();
    const dinfo = new DataInfo();
    dinfo.alias = "CUST";
    dinfo.databaseAlias = "MAIN";
    dinfo.sql = "SELECT 1";
    report.newName(dinfo);
    report.addDataInfo(dinfo, report.undoCue!.getGroupId());
    report.deleteItem(dinfo, report.undoCue!.getGroupId());
    const op = report.undoCue!.undoOperations.at(-1)!;
    const byName = new Map(op.properties.map((p) => [p.propertyName, p.newValue]));
    expect(byName.get("databaseAlias")).toBe("MAIN");
    expect(byName.get("sql")).toBe("SELECT 1");
    expect(byName.get("openOnStart")).toBe(true);
    expect(op.properties.filter((p) => p.propertyName === "dataUnions").length).toBe(1);
    // and the dataset left the component list
    expect(report.components.has(dinfo.name.toUpperCase())).toBe(false);
    // undo brings it back with its SQL
    report.undoCue!.undo(report);
    expect(report.dataInfo[0].sql).toBe("SELECT 1");
    expect(report.dataInfo[0].databaseAlias).toBe("MAIN");
  });

  it("deletes a component by its uppercase key", () => {
    const report = newReport();
    const label = new LabelItem();
    label.name = "TRpLabel0";
    report.subReports[0].sections[0].components.push(label);
    report.updateComponentList();
    expect(report.components.has("TRPLABEL0")).toBe(true);
    report.deleteItem(label, report.undoCue!.getGroupId());
    expect(report.components.has("TRPLABEL0")).toBe(false);
  });

  it("clears the identifier of a pasted expression only when another item has it", () => {
    const report = newReport();
    const existing = new ExpressionItem();
    existing.identifier = "TOTAL";
    report.newName(existing);
    const sub = report.subReports[0];
    const groupId = report.undoCue!.getGroupId();
    const section1 = new Section();
    section1.sectionType = SectionType.Detail;
    section1.components = [existing];
    report.newName(section1);
    report.addSection(sub, section1, groupId, undefined);
    const unique = new ExpressionItem();
    unique.identifier = "OTHER";
    const repeated = new ExpressionItem();
    repeated.identifier = "TOTAL";
    const section2 = new Section();
    section2.sectionType = SectionType.Detail;
    section2.components = [unique, repeated];
    report.newName(section2);
    report.addSection(sub, section2, groupId, undefined);
    expect(existing.identifier).toBe("TOTAL");
    expect(unique.identifier).toBe("OTHER");
    expect(repeated.identifier).toBe("");
  });

  it("deletes a connection in the undo group given and names the dataset it changes", () => {
    const report = newReport();
    const db = new DatabaseInfo();
    db.alias = "MAIN";
    report.newName(db);
    report.addDatabaseInfo(db, report.undoCue!.getGroupId());
    const dinfo = new DataInfo();
    dinfo.alias = "CUST";
    dinfo.databaseAlias = "MAIN";
    report.newName(dinfo);
    report.addDataInfo(dinfo, report.undoCue!.getGroupId());
    const groupId = report.undoCue!.getGroupId();
    report.deleteItem(db, groupId);
    const ops = report.undoCue!.undoOperations.filter((o) => o.groupId === groupId);
    expect(ops.map((o) => o.operation)).toEqual([OperationType.Modify, OperationType.Remove]);
    expect(ops[0].componentName).toBe(dinfo.name);
    expect(dinfo.databaseAlias).toBe("");
    // one undo step restores both
    report.undoCue!.undo(report);
    expect(dinfo.databaseAlias).toBe("MAIN");
    expect(report.databaseInfo.map((d) => d.alias)).toEqual(["MAIN"]);
  });

  it("names the class it cannot create", () => {
    expect(() => Report.newComponentByClassName("TRPNOTHING")).toThrow("Class not found: TRPNOTHING");
  });

  it("undoes the addition of a component removing its uppercase key", () => {
    const report = newReport();
    const section = report.subReports[0].sections[0];
    const label = new LabelItem();
    label.name = "TRpLabel9";
    const op = new ChangeObjectOperation(OperationType.Add, report.undoCue!.getGroupId());
    op.componentName = label.name;
    op.componentClass = label.className;
    op.parentName = section.name;
    report.components.set(label.name.toUpperCase(), label);
    section.components.push(label);
    report.undoCue!.addOperation(op, report);
    report.undoCue!.undo(report);
    expect(section.components.length).toBe(0);
    expect(report.components.has("TRPLABEL9")).toBe(false);
  });

  it("keeps rightToLeft in step with the mode of the report language", () => {
    const label = new LabelItem();
    PrintItemText.setBidiMode(label, 1, BidiModeType.Full);
    expect(label.bidiModes).toEqual(["BidiNo", "BidiNo", "BidiFull"]);
    expect(label.rightToLeft).toBe(true);
    expect(PrintItemText.getBidiMode(label, 1)).toBe(BidiModeType.Full);
    expect(PrintItemText.getBidiMode(label, -1)).toBe(BidiModeType.No);
    expect(PrintItemText.bidiLanguageIndex(300)).toBe(0);
  });

  it("has the defaults of the C# constructors", () => {
    const report = new Report();
    expect([report.leftMargin, report.topMargin, report.rightMargin, report.bottomMargin]).toEqual([574, 574, 574, 861]);
    expect([report.linesPerInch, report.language, report.copies, report.streamFormat]).toEqual([600, -1, 1, 1]);
    expect(new Section().sectionType).toBe(SectionType.PageHeader);
    expect(new Param().value).toEqual({ type: "Null", value: null });
    expect(new ExpressionItem().exportDoNewLine).toBe(false);
  });
});

describe("copy and paste", () => {
  it("copies items as text and pastes them as one undo step", () => {
    const report = newReport();
    const section = report.subReports[0].sections[0];
    const label = new LabelItem();
    label.allStrings = ["Hello"];
    label.posX = 100;
    report.newName(label);
    const text = report.copyItemsToText([label]);
    expect(JSON.parse(text).copyClass).toBe("Items");
    expect(report.pasteItemsFromText(section, text)).toBe(true);
    expect(report.pasteItemsFromText(section, "")).toBe(false);
    expect(report.pasteItemsFromText(section, JSON.stringify({ copyClass: "Other" }))).toBe(false);
    const pasted = section.components[0] as LabelItem;
    expect(pasted).toBeInstanceOf(LabelItem);
    expect(pasted.allStrings).toEqual(["Hello"]);
    expect(pasted.posX).toBe(100);
    expect(report.components.get(pasted.name.toUpperCase())).toBe(pasted);
  });

  it("uses the clipboard given, or Report.clipboard", async () => {
    const report = newReport();
    const section = report.subReports[0].sections[0];
    let stored = "";
    const clipboard: ClipboardAdapter = {
      writeText: async (t) => {
        stored = t;
      },
      readText: async () => stored,
    };
    const label = new LabelItem();
    report.newName(label);
    await expect(report.copyItemsToClipboard([label])).rejects.toThrow("No clipboard");
    await report.copyItemsToClipboard([label], clipboard);
    expect(stored).toContain("TRPLABEL");
    Report.clipboard = clipboard;
    try {
      expect(await report.pasteItemsFromClipboard(section)).toBe(true);
    } finally {
      Report.clipboard = undefined;
    }
    expect(section.components.length).toBe(1);
  });
});
