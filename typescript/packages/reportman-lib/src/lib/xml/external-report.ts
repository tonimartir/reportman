import { Report } from "../models/report.js";
import { ReportItem } from "../models/report-item.js";
import { SubReport } from "../models/sub-report.js";
import { DataInfo } from "../models/data-info.js";
import { ExpressionItem } from "../models/expression-item.js";
import { ChartItem } from "../models/chart-item.js";
import { BidiModeType, PrintItemText } from "../models/print-item-text.js";
import { readReportXml } from "./report-reader.js";
import { saveReportBytes } from "./report-writer.js";
import { getChildSubReport } from "./report-links.js";
import { convertToDotNet } from "./convert.js";
import { ComponentList, addComponent, csComponentList, generateNewName } from "./report-names.js";
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

/**
 * ExternalReport.DeleteSubReport: removes a subreport, its dataset and the datasets of its unions,
 * and narrows the parameters of its dataset to it.
 */
function deleteSubReport(newreport: Report, subrep: SubReport): void {
  if (subrep.alias.length > 0) {
    for (const rparam of [...newreport.params]) {
      if (rparam.datasets.length > 0 && rparam.datasets.indexOf(subrep.alias) >= 0) {
        // C# parity: the other datasets of the parameter are removed (the parameter keeps the one of
        // the subreport, so the removal of a parameter left without datasets never happens).
        const toremove = rparam.datasets.filter((d) => d !== subrep.alias);
        for (const nstring of toremove) {
          removeItem(rparam.datasets, nstring);
          if (rparam.datasets.length === 0) {
            removeItem(newreport.params, rparam);
            removeComponentValue(newreport.components, rparam);
          }
        }
      }
    }
    const indexdata = dataInfoIndex(newreport.dataInfo, subrep.alias);
    if (indexdata >= 0) {
      const dinfo = newreport.dataInfo[indexdata];
      removeItem(newreport.dataInfo, dinfo);
      removeComponentValue(newreport.components, dinfo);
      for (const entry of dinfo.dataUnions) {
        // "ALIAS" or "ALIAS-COMMONFIELDS" (a parallel union)
        const related = entry.indexOf("-") >= 0 ? entry.substring(0, entry.indexOf("-")) : entry;
        const index = dataInfoIndex(newreport.dataInfo, related);
        if (index >= 0) newreport.dataInfo.splice(index, 1);
      }
    }
  }
  // BaseReport.DeleteSubReport (C# parity: deleting while counting up skips every other section,
  // whose names stay in the component list).
  removeItem(newreport.subReports, subrep);
  for (let i = 0; i < subrep.sections.length; i++) {
    const sec = subrep.sections[i];
    subrep.sections.splice(i, 1);
    newreport.components.delete(sec.name);
  }
  newreport.components.delete(subrep.name);
}

/**
 * ExternalReport.ExportSubReport: the report saved with only that subreport (and the subreports
 * its sections print as child subreports), its datasets and the parameters assigned to no dataset,
 * as the bytes of a .rep (XML, or zlib compressed when the report's stream format is XMLZlib, as
 * C# saves it; the compressed bytes are not those of C#, the document they hold is).
 *
 * As C#, the report is saved first (BaseReport.SaveToStream, which changes it as writeReportXml
 * does, without naming the items) and read back as BaseReport.LoadFromStream reads it (converted
 * to .Net: convertToDotNet), and the copy is reduced.
 */
export function exportSubReport(report: Report, subreportIndex: number): Uint8Array {
  const subreport = report.subReports[subreportIndex];
  if (subreport === undefined)
    throw new RangeError("Index was out of range. Must be non-negative and less than the size of the collection. (Parameter 'index')");
  // BaseReport.LoadFromStream: read and converted to .Net (the SQL parameters, the drivers).
  const newreport = readReportXml(saveReportBytes(report));
  convertToDotNet(newreport);
  // A SortedList by alias (the dataset itself is not used).
  const dataInfos = new Set<string>();
  const lsubreports: SubReport[] = [];
  const lchildsubreports: SubReport[] = [];
  for (const subrep of newreport.subReports) {
    if (subrep.name !== subreport.name) lsubreports.push(subrep);
    else {
      if (subrep.alias.length > 0) {
        // C# parity: SortedList.Add of an alias already added (two subreports of that name) throws.
        if (dataInfos.has(subrep.alias))
          throw new Error("An item with the same key has already been added. Key: " + subrep.alias);
        dataInfos.add(subrep.alias);
      }
      for (const nsection of subrep.sections) {
        const child = getChildSubReport(newreport, nsection);
        if (child) {
          lchildsubreports.push(child);
          if (child.alias.length > 0) dataInfos.add(child.alias);
        }
      }
    }
  }
  for (const subrep of lsubreports) if (lchildsubreports.indexOf(subrep) < 0) deleteSubReport(newreport, subrep);
  let i = 0;
  while (i < newreport.dataInfo.length) {
    if (dataInfos.has(newreport.dataInfo[i].alias)) i++;
    else newreport.dataInfo.splice(i, 1);
  }
  // C# parity: "remove parameters assignable only to other datasets" drops every parameter that
  // has a dataset; only those assigned to none are kept.
  i = 0;
  while (i < newreport.params.length) {
    if (newreport.params[i].datasets.length > 0) newreport.params.splice(i, 1);
    else i++;
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
 * C#'s rules: a parameter or a connection whose alias the target has is not imported; a dataset
 * always is, its alias followed by _1, _2... while the target has it (the subreports and
 * parameters of the source keep the old alias); an item whose name the target's component list
 * has gets a new one; an expression or chart identifier the target uses is cleared. The component
 * list is the one C# has for the target: keyed by uppercase names for a report read from XML, by
 * the names as they are written for one hydrated from its JSON (Report.OnDeserialized), so a name
 * that differs from the target's only in case is renamed in the second case and not in the first.
 * The items imported are also added to the target's own component list.
 */
export function importReport(target: Report, source: Report): Report {
  const components = csComponentList(target);
  const imported: ReportItem[] = [];
  const register = (item: ReportItem): void => {
    // ContainsKey / IndexOfKey of the name as it is written, else Components.Add.
    if (components.has(item.name) || item.name.length === 0) generateNewName(components, item);
    else components.set(item.name, item);
    imported.push(item);
  };
  for (const nparam of source.params) {
    if (aliasIndex(target.params, nparam.alias) < 0) {
      register(nparam);
      target.params.push(nparam);
    }
    // C# parity: for a parameter the target has, the loop meant to add the source's datasets goes
    // over the target's own datasets, so nothing changes.
  }
  for (const dbinfo of source.databaseInfo) {
    if (aliasIndex(target.databaseInfo, dbinfo.alias) < 0) {
      register(dbinfo);
      target.databaseInfo.push(dbinfo);
    }
  }
  for (const dinfo of source.dataInfo) {
    register(dinfo);
    let idx = 1;
    const original = dinfo.alias;
    while (dataInfoIndex(target.dataInfo, dinfo.alias) >= 0) {
      dinfo.alias = original + "_" + idx;
      idx++;
    }
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
    // C# parity: an unnamed subreport is added by its empty name (no name generated).
    if (components.has(nsubreport.name)) generateNewName(components, nsubreport);
    else components.set(nsubreport.name, nsubreport);
    imported.push(nsubreport);
    target.subReports.push(nsubreport);
    for (const nsec of nsubreport.sections) {
      if (components.has(nsec.name)) generateNewName(components, nsec);
      else components.set(nsec.name, nsec);
      imported.push(nsec);
      for (const posItem of nsec.components) {
        if (components.has(posItem.name)) generateNewName(components, posItem);
        else components.set(posItem.name, posItem);
        imported.push(posItem);
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
  if (components !== target.components) for (const item of imported) addComponent(target.components, item);
  return target;
}

