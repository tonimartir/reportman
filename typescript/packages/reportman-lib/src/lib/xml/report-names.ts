import { Report } from "../models/report.js";
import { ReportItem } from "../models/report-item.js";
import { csToUpper } from "../../util/cs.js";

/*
 * The names of the items of a report as the C# engine keeps them: ReportItem.Name's setter, the
 * report's component list (BaseReport.Components, report.components here) and the names it
 * generates. Shared by the reader, the writer and the import of a report.
 */

/** A component list: the items of a report by key (C# BaseReport.Components). */
export type ComponentList = Map<string, ReportItem>;

/**
 * The C# ReportItem.Name setter: renames the item, registering it in the report's component list
 * (a name already taken gets a new one).
 */
export function setItemName(components: ComponentList, item: ReportItem, value: string): void {
  if (item.name.length > 0) {
    // C# parity: the old name is looked up as it is written, while the keys are uppercase, so
    // only an uppercase name is removed.
    if (components.has(item.name)) {
      if (components.get(item.name) === item) components.delete(item.name);
    }
  }
  item.name = value;
  if (item.name.length > 0) {
    // C# parity: the same case-sensitive lookup decides whether the name is taken.
    if (components.has(item.name)) item.name = findNewName(components, item);
    addComponent(components, item);
  }
}

/** BaseReport.AddComponent: registers the item by uppercase name unless the name is taken. */
export function addComponent(components: ComponentList, item: ReportItem): void {
  if (item.name.length > 0) {
    const key = csToUpper(item.name);
    if (!components.has(key)) components.set(key, item);
  }
}

/** BaseReport.FindNewName: class name and the first free number from 1. */
export function findNewName(components: ComponentList, item: ReportItem): string {
  const clname = item.className ?? "";
  let i = 1;
  let nname = clname + i.toString();
  while (components.has(nname)) {
    i++;
    nname = clname + i.toString();
  }
  return nname;
}

/** BaseReport.GenerateNewName. */
export function generateNewName(components: ComponentList, item: ReportItem): void {
  setItemName(components, item, findNewName(components, item));
}

/**
 * BaseReport.EnsureComponentNames: names the items without one (older reports had no names for
 * connections, datasets and parameters).
 */
export function ensureComponentNames(report: Report): void {
  const components = csComponentList(report);
  const named: ReportItem[] = [];
  const generate = (item: ReportItem) => {
    generateNewName(components, item);
    named.push(item);
  };
  for (const dbInfo of report.databaseInfo) if (!dbInfo.name) generate(dbInfo);
  for (const dataInfo of report.dataInfo) if (!dataInfo.name) generate(dataInfo);
  for (const param of report.params) if (!param.name) generate(param);
  for (const subReport of report.subReports) {
    if (!subReport.name) generate(subReport);
    for (const section of subReport.sections) {
      if (!section.name) generate(section);
      for (const component of section.components) {
        if (!component.name) generate(component);
      }
    }
  }
  // The names given are in the report's own list too.
  if (components !== report.components) for (const item of named) addComponent(report.components, item);
}

/** Every item of a report in the order C# registers them after reading its JSON (Report.OnDeserialized). */
export function reportItems(report: Report): ReportItem[] {
  const items: ReportItem[] = [...report.params, ...report.databaseInfo, ...report.dataInfo];
  for (const subReport of report.subReports) {
    items.push(subReport);
    for (const section of subReport.sections) {
      items.push(section);
      items.push(...section.components);
    }
  }
  return items;
}

const readFromXml = new WeakSet<Report>();

/** Marks a report read by readReportXml: C# keys its component list by uppercase names. */
export function markReadFromXml(report: Report): void {
  readFromXml.add(report);
}

/**
 * The component list C# would have for this report: for one read from XML, the reader's (the
 * report's own, keyed by uppercase names); for one hydrated from its JSON, the list
 * Report.OnDeserialized builds, keyed by the names as they are written.
 */
export function csComponentList(report: Report): ComponentList {
  if (readFromXml.has(report)) return report.components;
  const list: ComponentList = new Map();
  for (const item of reportItems(report)) if (item.name && !list.has(item.name)) list.set(item.name, item);
  return list;
}
