import { Report } from "../models/report.js";
import { ReportItem } from "../models/report-item.js";
import { SubReport } from "../models/sub-report.js";
import { DataInfo } from "../models/data-info.js";
import { ExpressionItem } from "../models/expression-item.js";
import { ChartItem } from "../models/chart-item.js";
import { BidiModeType, PrintItemText } from "../models/print-item-text.js";
import { readReportXml } from "./report-reader.js";
import { saveReportBytes } from "./report-writer.js";
import { getChildSubReport, getParentSection, getParentSubReport, setChildSubReport, setParentSection, setParentSubReport } from "./report-links.js";
import { ComponentList, addComponent, csComponentList, setItemName } from "./report-names.js";
import { bytesToLatin1 } from "../../util/bytes.js";
import { csToUpper } from "../../util/cs.js";
import { unzlibSync } from "fflate";

/*
 * The port of the C# ExternalReport (Reportman.Reporting/ExternalReport.cs): a subreport exported
 * as a report of its own, and a report imported into another one, as the designer's server does.
 */

/** DataInfos.IndexOf: the alias as it is written, else ignoring the case. */
function dataInfoIndex(list: DataInfo[], alias: string): number {
  for (let i = 0; i < list.length; i++) if (list[i].alias === alias) return i;
  if (alias !== null && alias !== undefined) {
    // string.Equals(..., OrdinalIgnoreCase)
    const upper = csToUpper(alias);
    for (let i = 0; i < list.length; i++) if (csToUpper(list[i].alias ?? "") === upper) return i;
  }
  return -1;
}

/** Params.IndexOf / DatabaseInfos.IndexOf: the alias as it is written. */
function aliasIndex(list: { alias: string }[], alias: string): number {
  for (let i = 0; i < list.length; i++) if (list[i].alias === alias) return i;
  return -1;
}

/** SortedList.RemoveAt(IndexOfValue(item)): the first key of that item. */
function removeComponentValue(components: ComponentList, item: ReportItem): void {
  for (const [key, value] of components) {
    if (value === item) {
      components.delete(key);
      return;
    }
  }
}

function removeItem<T>(list: T[], item: T): void {
  const index = list.indexOf(item);
  if (index >= 0) list.splice(index, 1);
}

/** The dataset alias of a DataUnions entry: "ALIAS" or "ALIAS-COMMONFIELDS" (a parallel union). */
function unionAlias(entry: string): string {
  const index = entry.indexOf("-");
  return index >= 0 ? entry.substring(0, index) : entry;
}

/** A set of names compared ignoring the case (StringComparer.OrdinalIgnoreCase). */
class NameSet {
  private readonly names = new Set<string>();
  add(name: string | undefined | null): void {
    this.names.add(csToUpper(name ?? ""));
  }
  has(name: string | undefined | null): boolean {
    return this.names.has(csToUpper(name ?? ""));
  }
  delete(name: string): void {
    this.names.delete(csToUpper(name));
  }
}

/** BaseReport.DeleteSubReport: the subreport, its sections (by their names as written) and itself out of the component list. */
function baseDeleteSubReport(newreport: Report, subrep: SubReport): void {
  removeItem(newreport.subReports, subrep);
  while (subrep.sections.length > 0) {
    const sec = subrep.sections[0];
    subrep.sections.splice(0, 1);
    newreport.components.delete(sec.name);
  }
  newreport.components.delete(subrep.name);
}

/**
 * ExternalReport.ExportSubReport: the report saved with only that subreport, the subreports its
 * sections print as child subreports (and theirs), the datasets they use (with their master
 * datasets and the datasets of their unions) and the parameters of no dataset or of those datasets
 * (assigned only to them), as the bytes of a .rep (XML, or zlib compressed when the report's
 * stream format is XMLZlib, as C# saves it; the compressed bytes are not those of C#, the document
 * they hold is).
 *
 * As C#, the report is saved first (BaseReport.SaveToStream, which changes it as writeReportXml
 * does, without naming the items) and read back as it is (not converted to .Net, so a report of
 * the Delphi engine still runs there), and the copy is reduced.
 */
export function exportSubReport(report: Report, subreportIndex: number): Uint8Array {
  const subreport = report.subReports[subreportIndex];
  if (subreport === undefined)
    throw new RangeError("Index was out of range. Must be non-negative and less than the size of the collection. (Parameter 'index')");
  const newreport = readReportXml(saveReportBytes(report));
  const exported = newreport.subReports.find((s) => s.name === subreport.name);
  if (exported === undefined) throw new Error("Subreport not found: " + subreport.name);
  // The subreport and its child subreports, theirs too
  const kept: SubReport[] = [exported];
  for (let k = 0; k < kept.length; k++) {
    for (const nsection of kept[k].sections) {
      const child = getChildSubReport(newreport, nsection);
      if (child && kept.indexOf(child) < 0) kept.push(child);
    }
  }
  // A child subreport exported alone is a main subreport of the new report
  const parent = getParentSubReport(exported);
  if (parent && kept.indexOf(parent) < 0) {
    setParentSubReport(exported, undefined);
    setParentSection(exported, undefined);
    exported.parentSub = "";
    exported.parentSec = "";
  }
  // The datasets of those subreports, their master datasets and the datasets of their unions
  const dataInfos = new NameSet();
  const pending: DataInfo[] = [];
  const keep = (alias: string | undefined | null): void => {
    if (alias === undefined || alias === null || alias.length === 0 || dataInfos.has(alias)) return;
    const index = dataInfoIndex(newreport.dataInfo, alias);
    if (index < 0) return;
    const dinfo = newreport.dataInfo[index];
    dataInfos.add(alias);
    dataInfos.add(dinfo.alias);
    pending.push(dinfo);
  };
  for (const subrep of kept) keep(subrep.alias);
  for (let k = 0; k < pending.length; k++) {
    keep(pending[k].dataSource);
    for (const entry of pending[k].dataUnions) keep(unionAlias(entry));
  }
  for (const subrep of newreport.subReports.filter((s) => kept.indexOf(s) < 0)) baseDeleteSubReport(newreport, subrep);
  let i = 0;
  while (i < newreport.dataInfo.length) {
    const dataInfo = newreport.dataInfo[i];
    if (dataInfos.has(dataInfo.alias)) i++;
    else {
      newreport.dataInfo.splice(i, 1);
      removeComponentValue(newreport.components, dataInfo);
    }
  }
  // The parameters of no dataset or of an exported one, with only the exported datasets
  i = 0;
  while (i < newreport.params.length) {
    const nparam = newreport.params[i];
    if (nparam.datasets.length === 0) {
      i++;
      continue;
    }
    nparam.datasets = nparam.datasets.filter((d) => dataInfos.has(d));
    if (nparam.datasets.length > 0) i++;
    else {
      newreport.params.splice(i, 1);
      removeComponentValue(newreport.components, nparam);
    }
  }
  return saveReportBytes(newreport);
}

/** exportSubReport as text: the XML of the exported report, decompressed if it was compressed. */
export function exportSubReportXml(report: Report, subreportIndex: number): string {
  let bytes = exportSubReport(report, subreportIndex);
  if (bytes.length > 0 && bytes[0] === 0x78) bytes = unzlibSync(bytes);
  return bytesToLatin1(bytes);
}

/**
 * ExternalReport.ImportReport: the parameters, connections, datasets and subreports of the source
 * are moved into the target (the source's objects themselves, as C# does), which is returned.
 *
 * C#'s rules: a parameter or a connection whose alias the target has is not imported (the target's
 * parameter is also assigned to the source parameter's datasets); a dataset always is, its alias
 * followed by _1, _2... while the target has it, and the subreports, parameters and datasets of the
 * source that name it follow the new alias (their expressions do not); an item whose name the
 * target uses, ignoring the case, gets a new one that neither report uses; an expression or chart
 * identifier the target uses is cleared; the link names (child, parent and subreport of a section)
 * are those of the items after the renames. The component list is the one C# has for the target
 * (keyed by uppercase names for a report read from XML, by the names as they are written for one
 * hydrated from its JSON: Report.OnDeserialized); the items imported are also added to the
 * target's own component list.
 */
export function importReport(target: Report, source: Report): Report {
  const components = csComponentList(target);
  const imported: ReportItem[] = [];
  // The names the target uses, ignoring the case
  const names = new NameSet();
  for (const key of components.keys()) names.add(key);
  for (const p of target.params) names.add(p.name);
  for (const d of target.databaseInfo) names.add(d.name);
  for (const d of target.dataInfo) names.add(d.name);
  for (const s of target.subReports) {
    names.add(s.name);
    for (const sec of s.sections) {
      names.add(sec.name);
      for (const posItem of sec.components) names.add(posItem.name);
    }
  }
  names.delete("");
  // The names of the source's items: a new name takes none of them
  const sourceNames = new NameSet();
  for (const p of source.params) sourceNames.add(p.name);
  for (const d of source.databaseInfo) sourceNames.add(d.name);
  for (const d of source.dataInfo) sourceNames.add(d.name);
  for (const s of source.subReports) {
    sourceNames.add(s.name);
    for (const sec of s.sections) {
      sourceNames.add(sec.name);
      for (const posItem of sec.components) sourceNames.add(posItem.name);
    }
  }
  const register = (item: ReportItem): void => {
    if (item.name.length === 0 || names.has(item.name)) {
      const prefix = item.className ?? "";
      let n = 1;
      let candidate = prefix + n.toString();
      while (names.has(candidate) || sourceNames.has(candidate)) {
        n++;
        candidate = prefix + n.toString();
      }
      // The C# setter adds it to the component list
      setItemName(components, item, candidate);
    } else components.set(item.name, item);
    names.add(item.name);
    imported.push(item);
  };
  // The new aliases of the source's datasets, before anything names them
  const renamed = new Map<string, string>();
  const aliases = new NameSet();
  for (const dinfo of target.dataInfo) aliases.add(dinfo.alias);
  for (const dinfo of source.dataInfo) {
    const original = dinfo.alias;
    let alias = original;
    let idx = 1;
    while (aliases.has(alias)) {
      alias = original + "_" + idx;
      idx++;
    }
    aliases.add(alias);
    if (alias !== original && !renamed.has(csToUpper(original))) renamed.set(csToUpper(original), alias);
  }
  const rename = (alias: string): string => {
    if (alias === undefined || alias === null || alias.length === 0) return alias;
    return renamed.get(csToUpper(alias)) ?? alias;
  };
  if (renamed.size > 0) {
    for (const nsubreport of source.subReports) nsubreport.alias = rename(nsubreport.alias);
    for (const nparam of source.params) nparam.datasets = nparam.datasets.map(rename);
    for (const dinfo of source.dataInfo) {
      dinfo.dataSource = rename(dinfo.dataSource);
      dinfo.dataUnions = dinfo.dataUnions.map((entry) => {
        const alias = unionAlias(entry);
        const newAlias = rename(alias);
        return newAlias !== alias ? newAlias + entry.substring(alias.length) : entry;
      });
    }
  }
  for (const nparam of source.params) {
    const index = aliasIndex(target.params, nparam.alias);
    if (index < 0) {
      register(nparam);
      target.params.push(nparam);
    } else {
      // The target's parameter is also assigned to the source parameter's datasets
      const destparam = target.params[index];
      for (const datasetname of nparam.datasets) if (destparam.datasets.indexOf(datasetname) < 0) destparam.datasets.push(datasetname);
    }
  }
  for (const dbinfo of source.databaseInfo) {
    if (aliasIndex(target.databaseInfo, dbinfo.alias) < 0) {
      register(dbinfo);
      target.databaseInfo.push(dbinfo);
    }
  }
  for (const dinfo of source.dataInfo) {
    register(dinfo);
    dinfo.alias = rename(dinfo.alias);
    target.dataInfo.push(dinfo);
  }
  const currentIdentifiers = new Set<string>();
  for (const subrep of target.subReports)
    for (const sec of subrep.sections)
      for (const posItem of sec.components) {
        const identifier = posItem instanceof ExpressionItem || posItem instanceof ChartItem ? posItem.identifier : "";
        if (identifier.length > 0) currentIdentifiers.add(identifier);
      }
  for (const nsubreport of source.subReports) {
    register(nsubreport);
    target.subReports.push(nsubreport);
    for (const nsec of nsubreport.sections) {
      register(nsec);
      for (const posItem of nsec.components) {
        register(posItem);
        // C# parity: RightToLeft is the mode of the language of the item's report, now the target.
        if (posItem instanceof PrintItemText)
          posItem.rightToLeft = PrintItemText.getBidiMode(posItem, target.language) !== BidiModeType.No;
        if (posItem instanceof ExpressionItem || posItem instanceof ChartItem) {
          const ident = posItem.identifier;
          if (ident.length > 0) {
            if (currentIdentifiers.has(ident)) posItem.identifier = "";
            else currentIdentifiers.add(ident);
          }
        }
      }
    }
  }
  // The names the links keep, as the reader keeps them (uppercase, the subreport of a section as
  // written), after the renames
  for (const nsubreport of source.subReports) {
    const parent = getParentSubReport(nsubreport);
    if (parent) nsubreport.parentSub = csToUpper(parent.name);
    const parentSection = getParentSection(nsubreport);
    if (parentSection) nsubreport.parentSec = csToUpper(parentSection.name);
    for (const nsec of nsubreport.sections) {
      const child = getChildSubReport(source, nsec);
      if (child) {
        nsec.childSubReportName = csToUpper(child.name);
        setChildSubReport(nsec, child);
      }
      if (nsec.subReportName.length > 0) nsec.subReportName = nsubreport.name;
    }
  }
  if (components !== target.components) for (const item of imported) addComponent(target.components, item);
  return target;
}
