import { DataInfo } from "../../models/data-info.js";
import { DatabaseInfo } from "../../models/database-info.js";
import { EmbeddedFile } from "../../models/embedded-file.js";
import { Param, ParamType } from "../../models/param.js";
import { PrintPosItem } from "../../models/print-pos-item.js";
import { Section } from "../../models/section.js";
import { SubReport } from "../../models/sub-report.js";
import { Report } from "../../models/report.js";
import { ChangeObjectOperation, ChangeOperationItem, UndoCue } from "../../models/undo-cue.js";
import { Fecha } from "../../../util/fecha.js";

/**
 * Turns the JSON document the server sends (plain objects, camelCase, numeric enums: the report as
 * the engine's JSON writes it) into the class instances the designer works with. Shared by the
 * ReadReport path and by anything that replaces the document at runtime (the AI copilot, undoing an
 * AI change).
 *
 * Every member of the document is kept, also the ones this model does not declare (the engine's
 * runtime values), so that the document goes back to the server as it came.
 */
export function hydrateReport(raw: any): Report {
  const report = new Report();
  Object.assign(report, raw);
  // A document that went through JSON.stringify (a snapshot) carries the component map as {}: rebuild it.
  if (!(report.components instanceof Map)) report.components = new Map();
  report.databaseInfo = [];
  for (const dbInfo of raw.databaseInfo ?? []) {
    report.databaseInfo.push(Object.assign(new DatabaseInfo(), dbInfo));
  }
  report.dataInfo = [];
  for (const dataInfo of raw.dataInfo ?? []) {
    report.dataInfo.push(Object.assign(new DataInfo(), dataInfo));
  }
  report.embeddedFiles = [];
  for (const efile of raw.embeddedFiles ?? []) {
    report.embeddedFiles.push(Object.assign(new EmbeddedFile(), efile));
  }
  report.subReports = [];
  for (const subrep of raw.subReports ?? []) {
    const newSubRep = new SubReport();
    Object.assign(newSubRep, subrep);
    newSubRep.sections = [];
    for (const section of subrep.sections ?? []) {
      const newSection = new Section();
      Object.assign(newSection, section);
      newSection.components = [];
      for (const compo of section.components ?? []) {
        newSection.components.push(hydratePrintPosItem(compo));
      }
      newSubRep.sections.push(newSection);
    }
    report.subReports.push(newSubRep);
  }
  report.params = [];
  for (const param of raw.params ?? []) {
    const newParam = new Param();
    Object.assign(newParam, param);
    if (newParam.value && typeof newParam.value.value === "string") {
      // A copy: the document given is not changed.
      newParam.value = { ...newParam.value };
      switch (newParam.paramType) {
        // The engine keeps a date, a time (on 1899-12-30) and a date and time as a DateTime: the
        // whole value is kept (time of day and milliseconds included).
        case ParamType.Date:
        case ParamType.DateTime:
        case ParamType.Time:
          newParam.value.value = Fecha.fromISODateTimeString(newParam.value.value as string);
          break;
      }
    }
    // A parameter without a value is still a parameter (the ERP version dropped them).
    report.params.push(newParam);
  }
  report.className = "TRPREPORT";
  report.name = "REPORT";
  report.undoCue = hydrateUndoCue(raw.undoCue);
  report.updateComponentList();
  return report;
}

/**
 * A component of a section by its className, as the engine's PrintPosItemConverter creates it
 * (TRPLABEL, TRPEXPRESSION, TRPSHAPE, TRPIMAGE, TRPBARCODE, TRPCHART).
 */
export function hydratePrintPosItem(raw: any): PrintPosItem {
  const className = raw?.className;
  if (!PrintPosItem.isPrintPosItem(className)) {
    // C# parity: the converter refuses any other class.
    throw new Error("Cannot create a PrintPosItem: " + (className ?? "<null>"));
  }
  const item = Report.newComponentByClassName(className) as PrintPosItem;
  Object.assign(item, raw);
  return item;
}

/**
 * The undo history of a document as UndoCue instances (both stacks), or a new empty one: the
 * designer always has a history to add to.
 */
export function hydrateUndoCue(raw: any): UndoCue {
  const undoCue = new UndoCue();
  if (!raw) return undoCue;
  for (const op of raw.undoOperations ?? []) undoCue.undoOperations.push(hydrateOperation(op));
  for (const op of raw.redoOperations ?? []) undoCue.redoOperations.push(hydrateOperation(op));
  return undoCue;
}

function hydrateOperation(raw: any): ChangeObjectOperation {
  const op = new ChangeObjectOperation(raw.operation, raw.groupId);
  Object.assign(op, raw);
  // The engine writes the date as ISO text; an operation without one keeps the date of its creation.
  if (typeof raw.date === "string") {
    const date = new Date(raw.date);
    op.date = isNaN(date.getTime()) ? new Date() : date;
  } else if (!(raw.date instanceof Date)) {
    op.date = new Date();
  }
  op.properties = [];
  for (const p of raw.properties ?? []) {
    const item = new ChangeOperationItem(p.propertyName, p.propertyType, p.oldValue, p.newValue);
    op.properties.push(Object.assign(item, p));
  }
  return op;
}

/** True for the members of the report object that exist only at runtime (not in its JSON). */
function isRuntimeReportMember(key: string): boolean {
  return key === "components" || key === "modified";
}

/**
 * The report as the plain JSON document hydrateReport reads (the inverse of hydrateReport): the
 * runtime-only members of the report (its component map and modified flag) are left out, dates
 * become ISO text and undefined members are omitted.
 */
export function serializeReport(report: Report): any {
  return JSON.parse(stringifyReport(report));
}

/** serializeReport as JSON text. */
export function stringifyReport(report: Report, space?: string | number): string {
  return JSON.stringify(
    report,
    function (this: unknown, key: string, value: unknown) {
      if (this === report && isRuntimeReportMember(key)) return undefined;
      return value;
    },
    space
  );
}
