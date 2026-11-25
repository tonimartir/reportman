// The comparison of a report's TypeScript JSON (serializeReport) with the JSON of the C# engine
// (golden-cs model-json), shared by the reader parity tests and the writer tests.

/**
 * The members of the C# JSON that are not design properties of the report: runtime state of a
 * run, values derived from other members, and members the .rep format does not store (the C#
 * JSON writes them with their defaults). They are not part of the TypeScript model.
 */
export const csRuntimeOnly: Record<string, string[]> = {
  // Runtime state of a run; usedDataReaders is the open readers of a run.
  report: [
    "currentSubReportIndex",
    "asyncExecution",
    "asyncPriority",
    "printedSomething",
    "pageNum",
    "pageNumGroup",
    "internalPageWidth",
    "internalPageHeight",
    "freeSpace",
    "currentOrientation",
    "updatePageSize",
    "usedDataReaders",
  ],
  // Run state (lastRecord, currentGroupIndex) and values computed from the sections.
  subReport: [
    "lastRecord",
    "currentGroupIndex",
    "firstPageHeader",
    "lastPageHeader",
    "pageHeaderCount",
    "pageFooterCount",
    "firstPageFooter",
    "lastPageFooter",
    "firstDetail",
    "detailCount",
    "lastDetail",
    "groupCount",
  ],
  // PrintItem run and designer state (sizes of a run, design-time visibility, selection).
  printItem: ["printWidth", "printHeight", "visible", "lastExtent", "selectionIndex", "selectionRectangle"],
  // Group value of a run, first page of a group, IsExternal (always false).
  section: ["groupValue", "firstPage", "isExternal"],
  // Derived from alignment and the bidirectional mode.
  printItemText: ["printAlignment"],
  TRPLABEL: [],
  // Values of a run.
  TRPEXPRESSION: [
    "value",
    "sumValue",
    "dataCount",
    "updated",
    "partialPos",
    "isPageCount",
    "isGroupPageCount",
    "lastMetaIndex",
    "exportValue",
  ],
  // Not stored in the .rep.
  TRPSHAPE: ["color", "brushColorExpression"],
  // Derived from the stream.
  TRPIMAGE: ["hasEmbeddedImageStream", "embeddedImageByteCount"],
  // The default series palette (not stored in the .rep) and the drawing helper of a run.
  TRPCHART: ["seriesColors", "drawHelper"],
  // The text of a run.
  TRPBARCODE: ["currentText"],
  // The data of a run and the SQL a run replaces.
  dataInfo: ["data", "sqlOverride"],
  // Hub settings of the HttpAgent driver, from the connections file, not stored in the .rep.
  databaseInfo: ["httpAgentBaseUrl", "httpAgentHubDatabaseId", "httpAgentApiKey", "httpAgentToken", "httpAgentInstallId"],
  // Texts of the current language (derived) and the value of the last run.
  param: ["description", "userVisible", "hint", "errorMessage", "lastValue"],
  // The PDF object number of a run.
  embeddedFile: ["resourceNumber"],
};

export type Kind =
  | "report"
  | "subReport"
  | "section"
  | "component"
  | "dataInfo"
  | "databaseInfo"
  | "param"
  | "embeddedFile"
  | "undoCue";

function ignoredKeys(kind: Kind, obj: any): Set<string> {
  const keys = new Set<string>();
  const add = (list: string[]) => list.forEach((k) => keys.add(k));
  switch (kind) {
    case "report":
    case "dataInfo":
    case "databaseInfo":
    case "param":
    case "embeddedFile":
    case "subReport":
      add(csRuntimeOnly[kind]);
      if (kind === "subReport") add(csRuntimeOnly.printItem);
      break;
    case "section":
      add(csRuntimeOnly.section);
      add(csRuntimeOnly.printItem);
      break;
    case "component":
      add(csRuntimeOnly.printItem);
      add(csRuntimeOnly[obj.className] ?? []);
      if (["TRPLABEL", "TRPEXPRESSION", "TRPCHART"].includes(obj.className)) add(csRuntimeOnly.printItemText);
      break;
    case "undoCue":
      break;
  }
  return keys;
}

export const isNil = (v: unknown) => v === null || v === undefined;

export function sameDate(a: unknown, b: unknown): boolean {
  if (typeof a !== "string" || typeof b !== "string") return false;
  const ta = new Date(a).getTime();
  const tb = new Date(b).getTime();
  return !isNaN(ta) && ta === tb;
}

/** Plain JSON comparison, null and absent being the same (C# omits nulls). */
/**
 * A double that is not a number nor finite: Newtonsoft writes it as the text NaN, Infinity or
 * -Infinity, JSON.stringify as null.
 */
export function nonFinite(cs: unknown, ts: unknown): boolean {
  return (cs === "NaN" || cs === "Infinity" || cs === "-Infinity") && ts === null;
}

export function jsonEqual(a: unknown, b: unknown): boolean {
  if (isNil(a) && isNil(b)) return true;
  if (nonFinite(a, b)) return true;
  if (Array.isArray(a) && Array.isArray(b)) return a.length === b.length && a.every((x, i) => jsonEqual(x, b[i]));
  if (typeof a === "object" && typeof b === "object" && a && b && !Array.isArray(a) && !Array.isArray(b)) {
    const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
    for (const k of keys) if (!jsonEqual((a as any)[k], (b as any)[k])) return false;
    return true;
  }
  return a === b;
}

export interface Comparison {
  diffs: string[];
  compared: number;
}

/**
 * Compares the C# JSON with the TypeScript one. design: skip the C# runtime-only members (the
 * reader); otherwise every member must match (the hydration keeps every member).
 */
export function compare(kind: Kind, cs: any, ts: any, p: string, out: Comparison, design: boolean): void {
  const ignored = design ? ignoredKeys(kind, cs) : new Set<string>();
  const keys = new Set([...Object.keys(cs ?? {}), ...Object.keys(ts ?? {})]);
  for (const key of keys) {
    if (ignored.has(key)) continue;
    const c = cs?.[key];
    const t = ts?.[key];
    const at = `${p}.${key}`;
    if (kind === "report" && (key === "name" || key === "className")) {
      // The engine's report has no name nor class; this model names it REPORT (as the undo
      // operations address it) of class TRPREPORT.
      const expected = key === "name" ? "REPORT" : "TRPREPORT";
      if (c !== "" || t !== expected) out.diffs.push(`${at}: C# ${JSON.stringify(c)} TS ${JSON.stringify(t)}`);
      continue;
    }
    if (kind === "report" && key === "undoCue" && isNil(c) && !design) {
      // hydrateReport always gives the designer a history to add to.
      if (!jsonEqual(t, { groupId: 0, undoOperations: [], redoOperations: [] }))
        out.diffs.push(`${at}: TS has a non-empty history where C# has none`);
      continue;
    }
    if (isNil(c) && isNil(t)) continue;
    if (nonFinite(c, t)) continue;
    if (isNil(c) !== isNil(t)) {
      out.diffs.push(`${at}: C# ${JSON.stringify(c)} TS ${JSON.stringify(t)}`);
      continue;
    }
    out.compared++;
    const childKind = childKindOf(kind, key);
    if (childKind) {
      if (!Array.isArray(c) || !Array.isArray(t) || c.length !== t.length) {
        out.diffs.push(`${at}: C# ${c?.length} items, TS ${t?.length}`);
        continue;
      }
      c.forEach((item: any, i: number) => compare(childKind, item, t[i], `${at}[${i}]`, out, design));
      continue;
    }
    if (kind === "report" && key === "undoCue") {
      compareUndoCue(c, t, at, out);
      continue;
    }
    if (kind === "param" && key === "value" && c?.type === "DateTime" && t?.type === "DateTime") {
      // C# writes the DateTime without zone (local wall clock), this model a Date (ISO, UTC).
      if (!sameDate(c.value, t.value)) out.diffs.push(`${at}: C# ${JSON.stringify(c)} TS ${JSON.stringify(t)}`);
      continue;
    }
    if (!jsonEqual(c, t)) out.diffs.push(`${at}: C# ${JSON.stringify(c)} TS ${JSON.stringify(t)}`);
  }
}

function childKindOf(kind: Kind, key: string): Kind | undefined {
  if (kind === "report") {
    switch (key) {
      case "subReports":
        return "subReport";
      case "dataInfo":
        return "dataInfo";
      case "databaseInfo":
        return "databaseInfo";
      case "params":
        return "param";
      case "embeddedFiles":
        return "embeddedFile";
    }
  }
  if (kind === "subReport" && key === "sections") return "section";
  if (kind === "section" && key === "components") return "component";
  return undefined;
}

function compareUndoCue(c: any, t: any, p: string, out: Comparison): void {
  for (const list of ["undoOperations", "redoOperations"]) {
    const cl = c[list] ?? [];
    const tl = t[list] ?? [];
    if (cl.length !== tl.length) {
      out.diffs.push(`${p}.${list}: C# ${cl.length} operations, TS ${tl.length}`);
      continue;
    }
    cl.forEach((op: any, i: number) => {
      const top = tl[i];
      for (const key of new Set([...Object.keys(op), ...Object.keys(top)])) {
        const at = `${p}.${list}[${i}].${key}`;
        out.compared++;
        if (key === "date") {
          // The same instant: C# trims the zeros of the milliseconds.
          if (!sameDate(op.date, top.date)) out.diffs.push(`${at}: C# ${op.date} TS ${top.date}`);
        } else if (!jsonEqual(op[key], top[key])) {
          out.diffs.push(`${at}: C# ${JSON.stringify(op[key])} TS ${JSON.stringify(top[key])}`);
        }
      }
    });
  }
  out.compared++;
  if (c.groupId !== t.groupId) out.diffs.push(`${p}.groupId: C# ${c.groupId} TS ${t.groupId}`);
}


/** The paths where two plain JSON values differ (null and absent being the same), for messages. */
export function jsonDiffs(a: unknown, b: unknown, p = "", out: string[] = []): string[] {
  if (isNil(a) && isNil(b)) return out;
  if (Array.isArray(a) && Array.isArray(b)) {
    if (a.length !== b.length) out.push(`${p}: ${a.length} items, ${b.length}`);
    else a.forEach((x, i) => jsonDiffs(x, b[i], `${p}[${i}]`, out));
    return out;
  }
  if (typeof a === "object" && typeof b === "object" && a && b && !Array.isArray(a) && !Array.isArray(b)) {
    for (const k of new Set([...Object.keys(a), ...Object.keys(b)])) jsonDiffs((a as any)[k], (b as any)[k], `${p}.${k}`, out);
    return out;
  }
  if (a !== b) out.push(`${p}: ${JSON.stringify(a)} / ${JSON.stringify(b)}`);
  return out;
}
