using System.Collections.Generic;
using System.IO;

namespace Reportman.Reporting
{
    public class ExternalReport
    {
        public static void ExportSubReport(SubReport subreport, System.IO.Stream destination, StreamVersion version = StreamVersion.V2)
        {
            using (MemoryStream mstream = new MemoryStream())
            {
                subreport.Report.SaveToStream(mstream, version);
                mstream.Seek(0, SeekOrigin.Begin);
                Report newreport = new Report();
                newreport.LoadFromStream(mstream);
                SortedList<string, DataInfo> dataInfos = new SortedList<string, DataInfo>();
                // Drop other subreports
                List<SubReport> lsubreports = new List<SubReport>();
                List<SubReport> lchildsubreports = new List<SubReport>();
                foreach (SubReport subrep in newreport.SubReports)
                {
                    if (subrep.Name != subreport.Name)
                        lsubreports.Add(subrep);
                    else
                    {
                        if (subrep.Alias.Length>0)
                        {                            
                            dataInfos.Add(subrep.Alias, newreport.DataInfo[subrep.Alias]);
                        }
                        foreach (Section nsection in subrep.Sections)
                        {
                            if (nsection.ChildSubReport != null)
                            {
                                lchildsubreports.Add(nsection.ChildSubReport);
                                if (nsection.ChildSubReport.Alias.Length>0)
                                {
                                    if (!dataInfos.ContainsKey(nsection.ChildSubReport.Alias))
                                    {
                                        dataInfos.Add(nsection.ChildSubReport.Alias, newreport.DataInfo[nsection.ChildSubReport.Alias]);
                                    }
                                }
                            }
                        }
                    }

                }
                foreach (SubReport subrep in lsubreports)
                {
                    if (lchildsubreports.IndexOf(subrep) < 0)
                        DeleteSubReport(newreport, subrep);
                }
                int i = 0;
                while (i<newreport.DataInfo.Count)
                {
                    var dataInfo = newreport.DataInfo[i];
                    if (dataInfos.ContainsKey(dataInfo.Alias))
                    {
                        i++;
                    }
                    else
                    {
                        newreport.DataInfo.RemoveAt(i);
                    }
                }
                // Remove parameters assignable only to other datasets
                i = 0;
                while (i<newreport.Params.Count)
                {
                    var nparam = newreport.Params[i];
                    bool dropParam = true;
                    if (nparam.Datasets.Count>0)
                    {
                      foreach (string dataset in nparam.Datasets)
                      {
                            if (!dataInfos.ContainsKey(dataset))
                            {
                                dropParam = true;
                            }
                      }
                    } else
                    {
                        dropParam = false;
                    }
                    if (dropParam)
                    {
                        newreport.Params.RemoveAt(i);
                    }
                    else
                        i++;
                }
                newreport.SaveToStream(destination, version);
            }
        }
        public static void DeleteSubReport(Report newreport, SubReport subrep)
        {
            // Remove related dataset
            if (subrep.Alias.Length > 0)
            {
                // Remove parameters not assigned to the subreport
                List<Param> lparams = new List<Param>();
                foreach (Param rparam in newreport.Params)
                {
                    if (rparam.Datasets.Count > 0)
                    {
                        if (rparam.Datasets.IndexOf(subrep.Alias) < 0)
                        {
                            /*newreport.Params.Remove(rparam);
                            int index2 = newreport.Components.IndexOfValue(rparam);
                            if (index2 >= 0)
                                newreport.Components.RemoveAt(index2);*/
                        }
                        else
                        {
                            List<string> toremove = new List<string>();
                            foreach (string ndataset in rparam.Datasets)
                            {
                                if (ndataset != subrep.Alias)
                                {
                                    toremove.Add(ndataset);
                                }
                            }
                            foreach (string nstring in toremove)
                            {
                                rparam.Datasets.Remove(nstring);
                                if (rparam.Datasets.Count == 0)
                                {
                                    newreport.Params.Remove(rparam);
                                    int index2 = newreport.Components.IndexOfValue(rparam);
                                    if (index2 >= 0)
                                        newreport.Components.RemoveAt(index2);
                                }
                            }
                        }
                    }
                }
                int indexdata = newreport.DataInfo.IndexOf(subrep.Alias);
                if (indexdata >= 0)
                {
                    DataInfo dinfo = newreport.DataInfo[subrep.Alias];
                    newreport.DataInfo.Remove(dinfo);
                    int index = newreport.Components.IndexOfValue(dinfo);
                    if (index >= 0)
                        newreport.Components.RemoveAt(index);
                    // Remove related union datasets
                    foreach (string related in dinfo.DataUnions)
                    {
                        if (newreport.DataInfo.IndexOf(related) >= 0)
                        {
                            newreport.DataInfo.Remove(newreport.DataInfo[related]);
                        }
                    }
                }
            }
            newreport.DeleteSubReport(subrep);
        }
        public static void ImportReport(Report destination, Report source)
        {
            foreach (DataInfo dinfo in source.DataInfo)
            {
                if (destination.DataInfo.IndexOf(dinfo.Alias) >= 0)
                {
                    //throw new Exception("Ya existe un dataset llamado " + dinfo.Alias);
                }
            }
            foreach (Param nparam in source.Params)
            {
                nparam.Report = destination;
                if (destination.Params.IndexOf(nparam.Alias) < 0)
                {
                    if ((destination.Components.IndexOfKey(nparam.Name)  >= 0)
                         || (nparam.Name.Length == 0))
                    {
                        destination.GenerateNewName(nparam);
                    }
                    else
                    {
                        destination.Components.Add(nparam.Name, nparam);
                    }
                    destination.Params.Add(nparam);
                }
                else
                {
                    Param destparam = destination.Params[nparam.Alias];
                    foreach (string datasetname in destparam.Datasets)
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
                    if ((destination.Components.IndexOfKey(dbinfo.Name) >= 0) ||
                         (dbinfo.Name.Length == 0))
                    {
                        destination.GenerateNewName(dbinfo);
                    }
                    else
                    {
                        destination.Components.Add(dbinfo.Name, dbinfo);
                    }
                    destination.DatabaseInfo.Add(dbinfo);
                }
            }
            foreach (DataInfo dinfo in source.DataInfo)
            {
                dinfo.Report = destination;
                if ((destination.Components.IndexOfKey(dinfo.Name) >= 0)
                     || (dinfo.Name.Length == 0))
                {
                    destination.GenerateNewName(dinfo);
                }
                else {
                    destination.Components.Add(dinfo.Name, dinfo);
                }
                int idx = 1;
                string original = dinfo.Alias;
                while (destination.DataInfo[dinfo.Alias]!= null)
                {
                    dinfo.Alias = original + "_" + idx;
                    idx++;
                }
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
                        if (identifier.Length>0)
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
                if (destination.Components.IndexOfKey(nsubreport.Name) >= 0)
                {
                    destination.GenerateNewName(nsubreport);
                } else
                {
                    destination.Components.Add(nsubreport.Name, nsubreport);
                }
                destination.SubReports.Add(nsubreport);
                foreach (Section nsec in nsubreport.Sections)
                {
                    nsec.Report = destination;
                    if (destination.Components.ContainsKey(nsec.Name))
                    {
                        destination.GenerateNewName(nsec);
                    } 
                    else
                    {
                        destination.Components.Add(nsec.Name, nsec);
                    }
                    foreach (PrintPosItem posItem in nsec.Components)
                    {
                        posItem.Report = destination;
                        if (destination.Components.ContainsKey(posItem.Name))
                        {
                            destination.GenerateNewName(posItem);
                        }
                        else
                        {
                            destination.Components.Add(posItem.Name, posItem);
                        }
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
        }
    }
}
