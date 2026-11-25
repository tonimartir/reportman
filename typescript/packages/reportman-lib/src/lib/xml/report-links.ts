import { Report } from "../models/report.js";
import { Section } from "../models/section.js";
import { SubReport } from "../models/sub-report.js";
import { csToUpper } from "../../util/cs.js";
import { csComponentList } from "./report-names.js";

/*
 * The object references between subreports and sections the C# engine keeps besides their names
 * (Section.SubReport, SubReport.ParentSubReport and SubReport.ParentSection) and its writer saves:
 * the JSON of the model has only the names, so a report read from its JSON has none of them until
 * UpdateReferences links the sections, while the reader sets them as it reads (the parents of a
 * child subreport included). They are kept here, by object, so that a report written after being
 * read, or after updateReferences, gives the C# document.
 */

const sectionSubReports = new WeakMap<Section, SubReport>();
const parentSubReports = new WeakMap<SubReport, SubReport>();
const parentSections = new WeakMap<SubReport, Section>();

/** C# Section.SubReport: the subreport the writer saves as the section's SUBREPORT. */
export function getSectionSubReport(section: Section): SubReport | undefined {
  return sectionSubReports.get(section);
}

export function setSectionSubReport(section: Section, subReport: SubReport | undefined): void {
  if (subReport) sectionSubReports.set(section, subReport);
  else sectionSubReports.delete(section);
}

/** C# SubReport.ParentSubReport: saved as PARENTSUBREPORT. */
export function getParentSubReport(subReport: SubReport): SubReport | undefined {
  return parentSubReports.get(subReport);
}

export function setParentSubReport(subReport: SubReport, parent: SubReport | undefined): void {
  if (parent) parentSubReports.set(subReport, parent);
  else parentSubReports.delete(subReport);
}

/** C# SubReport.ParentSection: saved as PARENTSECTION. */
export function getParentSection(subReport: SubReport): Section | undefined {
  return parentSections.get(subReport);
}

export function setParentSection(subReport: SubReport, section: Section | undefined): void {
  if (section) parentSections.set(subReport, section);
  else parentSections.delete(subReport);
}

const childSubReports = new WeakMap<Section, { name: string; subReport: SubReport | undefined }>();

/**
 * Links a section to the subreport it prints (C# Section.ChildSubReport), for the name the section
 * has now: the writer saves that subreport's name while the section keeps that name, even if the
 * subreport was renamed or removed since (as C# writes its reference).
 */
export function setChildSubReport(section: Section, subReport: SubReport | undefined): void {
  childSubReports.set(section, { name: section.childSubReportName ?? "", subReport });
}

/**
 * C# Section.ChildSubReport: the subreport the reader or updateReferences linked to the section;
 * a section never linked (or whose childSubReportName changed since) is resolved by its name as
 * UpdateReferences does.
 */
export function getChildSubReport(report: Report, section: Section): SubReport | undefined {
  const link = childSubReports.get(section);
  if (link && link.name === (section.childSubReportName ?? "")) return link.subReport;
  return resolveChildSubReport(report, section)?.subReport;
}

/**
 * UpdateReferences' lookup of a ChildSubReportName in the component list: the key as it is
 * written, else (the last) one whose upper case it is; anything but a subreport is no subreport.
 */
function resolveChildSubReport(report: Report, section: Section): { subReport: SubReport | undefined } | undefined {
  const name = section.childSubReportName ?? "";
  if (name.length === 0) return undefined;
  const components = csComponentList(report);
  if (components.has(name)) {
    const item = components.get(name);
    return { subReport: item instanceof SubReport ? item : undefined };
  }
  let found: { subReport: SubReport | undefined } | undefined = undefined;
  for (const [key, item] of components) if (csToUpper(key) === name) found = { subReport: item instanceof SubReport ? item : undefined };
  return found;
}

/**
 * BaseReport.UpdateReferences, what the designer's server does to a report it receives as JSON:
 * removes the datasets and connections whose alias repeats one before it, links every section to
 * its subreport (so that the writer saves its SUBREPORT, as C# does) and to the subreport its
 * ChildSubReportName names.
 */
export function updateReferences(report: Report): Report {
  // C# parity: a SortedList by alias, the first one is kept (removed in place).
  removeRepeatedAliases(report.dataInfo);
  removeRepeatedAliases(report.databaseInfo);
  for (const subReport of report.subReports) {
    for (const section of subReport.sections) {
      setSectionSubReport(section, subReport);
      // C# parity: a name that names nothing leaves the link as it was.
      const child = resolveChildSubReport(report, section);
      if (child !== undefined) setChildSubReport(section, child.subReport);
      // The links the JSON does not carry, as the XML reader sets them (the parent subreport is
      // what makes a subreport a child when the report runs)
      if ((section.childSubReportName ?? "").length > 0) {
        const linked = childSubReports.get(section)?.subReport;
        if (linked) {
          setParentSubReport(linked, subReport);
          setParentSection(linked, section);
        }
      }
    }
  }
  return report;
}

function removeRepeatedAliases(list: { alias: string }[]): void {
  const aliases = new Set<string>();
  let i = 0;
  while (i < list.length) {
    if (aliases.has(list[i].alias)) list.splice(i, 1);
    else {
      aliases.add(list[i].alias);
      i++;
    }
  }
}
