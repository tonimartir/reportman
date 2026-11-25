using System;
using System.Collections.Generic;
using System.IO;
using Reportman.Drawing;

namespace Reportman.Reporting
{
    /// <summary>
    /// Helper operations for moving subreports between report documents: exporting a single
    /// subreport (with its related datasets and parameters) to a stream, deleting a subreport
    /// and its dependencies, and importing the contents of one report into another.
    /// </summary>
    public class ExternalReport
    {
        /// <summary>The dataset alias of a DataUnions entry: "ALIAS" or "ALIAS-COMMONFIELDS" (a parallel union).</summary>
        private static string UnionAlias(string entry)
        {
            int index = entry.IndexOf('-');
            return index >= 0 ? entry.Substring(0, index) : entry;
        }

        /// <summary>
        /// Exports a single subreport — together with the subreports its sections print as child
        /// subreports (and theirs), the datasets they use and the parameters of those datasets — to the
        /// specified stream. The report is written as it is (a report of the Delphi engine is not
        /// converted to .Net, so it still runs there).
        /// </summary>
        /// <param name="subreport">The subreport to export.</param>
        /// <param name="destination">The destination stream that will receive the serialized report.</param>
        /// <param name="version">The stream serialization version to use (defaults to <see cref="StreamVersion.V2"/>).</param>
        public static void ExportSubReport(SubReport subreport, System.IO.Stream destination, StreamVersion version = StreamVersion.V2)
        {
            using (MemoryStream mstream = new MemoryStream())
            {
                subreport.Report.SaveToStream(mstream, version);
                mstream.Seek(0, SeekOrigin.Begin);
                Report newreport = new Report();
                newreport.LoadFromStream(mstream, false);
                SubReport exported = null;
                foreach (SubReport subrep in newreport.SubReports)
                {
                    if (subrep.Name == subreport.Name)
                    {
                        exported = subrep;
                        break;
                    }
                }
                if (exported == null)
                    throw new UnNamedException("Subreport not found: " + subreport.Name);
                // The subreport and its child subreports, theirs too (the grandchildren were deleted and
                // the sections of the children still named them, so the export could not be read)
                List<SubReport> kept = new List<SubReport>();
                kept.Add(exported);
                for (int k = 0; k < kept.Count; k++)
                {
                    foreach (Section nsection in kept[k].Sections)
                    {
                        if ((nsection.ChildSubReport != null) && (kept.IndexOf(nsection.ChildSubReport) < 0))
                            kept.Add(nsection.ChildSubReport);
                    }
                }
                // A child subreport exported alone is a main subreport of the new report
                if ((exported.ParentSubReport != null) && (kept.IndexOf(exported.ParentSubReport) < 0))
                {
                    exported.ParentSubReport = null;
                    exported.ParentSection = null;
                    exported.ParentSub = "";
                    exported.ParentSec = "";
                }
                // The datasets of those subreports, their master datasets and the datasets of their unions
                HashSet<string> dataInfos = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
                List<DataInfo> pending = new List<DataInfo>();
                Action<string> keep = (alias) =>
                {
                    if (string.IsNullOrEmpty(alias) || dataInfos.Contains(alias))
                        return;
                    DataInfo dinfo = newreport.DataInfo[alias];
                    if (dinfo == null)
                        return;
                    dataInfos.Add(alias);
                    dataInfos.Add(dinfo.Alias);
                    pending.Add(dinfo);
                };
                foreach (SubReport subrep in kept)
                    keep(subrep.Alias);
                for (int k = 0; k < pending.Count; k++)
                {
                    keep(pending[k].DataSource);
                    foreach (string entry in pending[k].DataUnions)
                        keep(UnionAlias(entry));
                }
                List<SubReport> others = new List<SubReport>();
                foreach (SubReport subrep in newreport.SubReports)
                {
                    if (kept.IndexOf(subrep) < 0)
                        others.Add(subrep);
                }
                foreach (SubReport subrep in others)
                    newreport.DeleteSubReport(subrep);
                int i = 0;
                while (i < newreport.DataInfo.Count)
                {
                    DataInfo dataInfo = newreport.DataInfo[i];
                    if (dataInfos.Contains(dataInfo.Alias))
                        i++;
                    else
                    {
                        newreport.DataInfo.RemoveAt(i);
                        int index = newreport.Components.IndexOfValue(dataInfo);
                        if (index >= 0)
                            newreport.Components.RemoveAt(index);
                    }
                }
                // The parameters of no dataset or of an exported one, with only the exported datasets
                // (it removed every parameter assigned to a dataset)
                i = 0;
                while (i < newreport.Params.Count)
                {
                    Param nparam = newreport.Params[i];
                    if (nparam.Datasets.Count == 0)
                    {
                        i++;
                        continue;
                    }
                    int j = 0;
                    while (j < nparam.Datasets.Count)
                    {
                        if (dataInfos.Contains(nparam.Datasets[j]))
                            j++;
                        else
                            nparam.Datasets.RemoveAt(j);
                    }
                    if (nparam.Datasets.Count > 0)
                        i++;
                    else
                    {
                        newreport.Params.RemoveAt(i);
                        int index = newreport.Components.IndexOfValue(nparam);
                        if (index >= 0)
                            newreport.Components.RemoveAt(index);
                    }
                }
                newreport.SaveToStream(destination, version);
            }
        }

        /// <summary>Whether another subreport than the given one is bound to the dataset.</summary>
        private static bool UsedByOtherSubReport(Report report, SubReport subrep, string alias)
        {
            foreach (SubReport other in report.SubReports)
            {
                if ((other != subrep) && string.Equals(other.Alias, alias, StringComparison.OrdinalIgnoreCase))
                    return true;
            }
            return false;
        }

        /// <summary>Whether a dataset other than the given one has the alias as master or in its unions.</summary>
        private static bool UsedByOtherDataInfo(Report report, DataInfo dinfo, string alias)
        {
            foreach (DataInfo other in report.DataInfo)
            {
                if (other == dinfo)
                    continue;
                if (string.Equals(other.DataSource, alias, StringComparison.OrdinalIgnoreCase))
                    return true;
                foreach (string entry in other.DataUnions)
                {
                    if (string.Equals(UnionAlias(entry), alias, StringComparison.OrdinalIgnoreCase))
                        return true;
                }
            }
            return false;
        }

        /// <summary>
        /// Removes the specified subreport and, when no other subreport uses them, its dataset and the
        /// datasets of its unions; the parameters assigned to that dataset lose it.
        /// </summary>
        /// <param name="newreport">The report from which the subreport will be deleted.</param>
        /// <param name="subrep">The subreport to delete.</param>
        public static void DeleteSubReport(Report newreport, SubReport subrep)
        {
            // Its dataset, unless another subreport is bound to it (it was deleted anyway)
            if ((subrep.Alias.Length > 0) && !UsedByOtherSubReport(newreport, subrep, subrep.Alias))
            {
                DataInfo dinfo = newreport.DataInfo[subrep.Alias];
                if (dinfo != null && !UsedByOtherDataInfo(newreport, dinfo, dinfo.Alias))
                {
                    // The parameters assigned to the dataset lose it (the other datasets of those
                    // parameters were removed instead)
                    foreach (Param rparam in newreport.Params)
                    {
                        int j = 0;
                        while (j < rparam.Datasets.Count)
                        {
                            if (string.Equals(rparam.Datasets[j], dinfo.Alias, StringComparison.OrdinalIgnoreCase))
                                rparam.Datasets.RemoveAt(j);
                            else
                                j++;
                        }
                    }
                    newreport.DataInfo.Remove(dinfo);
                    int index = newreport.Components.IndexOfValue(dinfo);
                    if (index >= 0)
                        newreport.Components.RemoveAt(index);
                    // The datasets of its unions that nothing else uses
                    foreach (string entry in dinfo.DataUnions)
                    {
                        string related = UnionAlias(entry);
                        DataInfo union = newreport.DataInfo[related];
                        if ((union != null) && !UsedByOtherSubReport(newreport, subrep, union.Alias)
                            && !UsedByOtherDataInfo(newreport, union, union.Alias))
                        {
                            newreport.DataInfo.Remove(union);
                            index = newreport.Components.IndexOfValue(union);
                            if (index >= 0)
                                newreport.Components.RemoveAt(index);
                        }
                    }
                }
            }
            newreport.DeleteSubReport(subrep);
        }

        /// <summary>
        /// A name for an imported item that the target does not use, ignoring the case (the component
        /// list of a report read from XML is keyed by uppercase names, the one of a report read from its
        /// JSON by the names as written, so a name was found in one case and not in the other).
        /// </summary>
        private static void Register(Report destination, HashSet<string> names, HashSet<string> sourceNames, ReportItem item)
        {
            if ((item.Name.Length == 0) || names.Contains(item.Name))
            {
                // A new name that neither report uses, so that it takes the name of no item imported later
                string prefix = item.ClassName;
                int i = 1;
                string candidate = prefix + i.ToString();
                while (names.Contains(candidate) || sourceNames.Contains(candidate))
                {
                    i++;
                    candidate = prefix + i.ToString();
                }
                // The setter adds it to the component list
                item.Name = candidate;
            }
            else
                destination.Components.Add(item.Name, item);
            names.Add(item.Name);
        }

        /// <summary>
        /// Merges all subreports, datasets, database connections, and parameters from the
        /// <paramref name="source"/> report into the <paramref name="destination"/> report.
        /// A dataset whose alias the destination has is renamed (ALIAS_1, ALIAS_2...) and the
        /// subreports, parameters and datasets of the source that name it follow; conflicting
        /// component names are regenerated. The expressions of the source still name the old alias.
        /// </summary>
        /// <param name="destination">The report that will receive the imported objects.</param>
        /// <param name="source">The report whose contents will be imported.</param>
        public static void ImportReport(Report destination, Report source)
        {
            // The names the destination uses, ignoring the case
            HashSet<string> names = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
            foreach (string key in destination.Components.Keys)
                names.Add(key);
            foreach (Param p in destination.Params)
                names.Add(p.Name);
            foreach (DatabaseInfo d in destination.DatabaseInfo)
                names.Add(d.Name);
            foreach (DataInfo d in destination.DataInfo)
                names.Add(d.Name);
            foreach (SubReport s in destination.SubReports)
            {
                names.Add(s.Name);
                foreach (Section sec in s.Sections)
                {
                    names.Add(sec.Name);
                    foreach (PrintPosItem posItem in sec.Components)
                        names.Add(posItem.Name);
                }
            }
            names.Remove("");
            // The names of the source's items: a new name takes none of them
            HashSet<string> sourceNames = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
            foreach (Param p in source.Params)
                sourceNames.Add(p.Name);
            foreach (DatabaseInfo d in source.DatabaseInfo)
                sourceNames.Add(d.Name);
            foreach (DataInfo d in source.DataInfo)
                sourceNames.Add(d.Name);
            foreach (SubReport s in source.SubReports)
            {
                sourceNames.Add(s.Name);
                foreach (Section sec in s.Sections)
                {
                    sourceNames.Add(sec.Name);
                    foreach (PrintPosItem posItem in sec.Components)
                        sourceNames.Add(posItem.Name);
                }
            }
            // The new aliases of the source's datasets, before anything names them
            Dictionary<string, string> renamed = new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase);
            HashSet<string> aliases = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
            foreach (DataInfo dinfo in destination.DataInfo)
                aliases.Add(dinfo.Alias);
            foreach (DataInfo dinfo in source.DataInfo)
            {
                string original = dinfo.Alias;
                string alias = original;
                int idx = 1;
                while (aliases.Contains(alias))
                {
                    alias = original + "_" + idx;
                    idx++;
                }
                aliases.Add(alias);
                if ((alias != original) && !renamed.ContainsKey(original))
                    renamed.Add(original, alias);
            }
            Func<string, string> rename = (alias) =>
            {
                string newAlias;
                if (!string.IsNullOrEmpty(alias) && renamed.TryGetValue(alias, out newAlias))
                    return newAlias;
                return alias;
            };
            if (renamed.Count > 0)
            {
                // What names a renamed dataset follows it (it went on naming the destination's dataset)
                foreach (SubReport nsubreport in source.SubReports)
                    nsubreport.Alias = rename(nsubreport.Alias);
                foreach (Param nparam in source.Params)
                {
                    for (int j = 0; j < nparam.Datasets.Count; j++)
                        nparam.Datasets[j] = rename(nparam.Datasets[j]);
                }
                foreach (DataInfo dinfo in source.DataInfo)
                {
                    dinfo.DataSource = rename(dinfo.DataSource);
                    for (int j = 0; j < dinfo.DataUnions.Count; j++)
                    {
                        string entry = dinfo.DataUnions[j];
                        string alias = UnionAlias(entry);
                        string newAlias = rename(alias);
                        if (newAlias != alias)
                            dinfo.DataUnions[j] = newAlias + entry.Substring(alias.Length);
                    }
                }
            }
            foreach (Param nparam in source.Params)
            {
                nparam.Report = destination;
                if (destination.Params.IndexOf(nparam.Alias) < 0)
                {
                    Register(destination, names, sourceNames, nparam);
                    destination.Params.Add(nparam);
                }
                else
                {
                    // The destination's parameter is also assigned to the source's datasets (the loop
                    // went over the destination's own datasets, so nothing changed)
                    Param destparam = destination.Params[nparam.Alias];
                    foreach (string datasetname in nparam.Datasets)
                    {
                        if (destparam.Datasets.IndexOf(datasetname) < 0)
                            destparam.Datasets.Add(datasetname);
                    }
                }
            }

            foreach (DatabaseInfo dbinfo in source.DatabaseInfo)
            {
                dbinfo.Report = destination;
                if (destination.DatabaseInfo.IndexOf(dbinfo.Alias) < 0)
                {
                    Register(destination, names, sourceNames, dbinfo);
                    destination.DatabaseInfo.Add(dbinfo);
                }
            }
            foreach (DataInfo dinfo in source.DataInfo)
            {
                dinfo.Report = destination;
                Register(destination, names, sourceNames, dinfo);
                dinfo.Alias = rename(dinfo.Alias);
                destination.DataInfo.Add(dinfo);
            }
            SortedList<string, PrintPosItem> currentIdentifiers = new SortedList<string, PrintPosItem>();
            foreach (SubReport subrep in destination.SubReports)
            {
                foreach (Section sec in subrep.Sections)
                {
                    foreach (PrintPosItem posItem in sec.Components)
                    {
                        string identifier = "";
                        if (posItem is ExpressionItem)
                        {
                            identifier = ((ExpressionItem)posItem).Identifier;
                        }
                        if (posItem is ChartItem)
                        {
                            identifier = ((ChartItem)posItem).Identifier;
                        }
                        if (identifier.Length > 0)
                        {
                            if (!currentIdentifiers.ContainsKey(identifier))
                                currentIdentifiers.Add(identifier, posItem);
                        }
                    }
                }
            }
            foreach (SubReport nsubreport in source.SubReports)
            {
                nsubreport.Report = destination;
                Register(destination, names, sourceNames, nsubreport);
                destination.SubReports.Add(nsubreport);
                foreach (Section nsec in nsubreport.Sections)
                {
                    nsec.Report = destination;
                    Register(destination, names, sourceNames, nsec);
                    foreach (PrintPosItem posItem in nsec.Components)
                    {
                        posItem.Report = destination;
                        Register(destination, names, sourceNames, posItem);
                        if (posItem is ExpressionItem)
                        {
                            string ident = ((ExpressionItem)posItem).Identifier;
                            if (ident.Length > 0)
                            {
                                if (currentIdentifiers.ContainsKey(ident))
                                {
                                    ((ExpressionItem)posItem).Identifier = "";
                                }
                                else
                                {
                                    currentIdentifiers.Add(ident, posItem);
                                }
                            }
                        }
                        if (posItem is ChartItem)
                        {
                            string ident = ((ChartItem)posItem).Identifier;
                            if (ident.Length > 0)
                            {
                                if (currentIdentifiers.ContainsKey(ident))
                                {
                                    ((ChartItem)posItem).Identifier = "";
                                }
                                else
                                {
                                    currentIdentifiers.Add(ident, posItem);
                                }
                            }
                        }

                    }
                }
            }
            // The names the links keep, as the reader keeps them (uppercase, the subreport of a section as
            // written), after the renames: the
            // JSON carries them, and UpdateReferences links a section to its child by that name
            foreach (SubReport nsubreport in source.SubReports)
            {
                if (nsubreport.ParentSubReport != null)
                    nsubreport.ParentSub = nsubreport.ParentSubReport.Name.ToUpper();
                if (nsubreport.ParentSection != null)
                    nsubreport.ParentSec = nsubreport.ParentSection.Name.ToUpper();
                foreach (Section nsec in nsubreport.Sections)
                {
                    if (nsec.ChildSubReport != null)
                        nsec.ChildSubReportName = nsec.ChildSubReport.Name.ToUpper();
                    if (nsec.SubReportName.Length > 0)
                        nsec.SubReportName = nsubreport.Name;
                }
            }
        }
    }
}
