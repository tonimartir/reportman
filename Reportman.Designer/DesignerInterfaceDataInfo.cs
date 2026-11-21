using Reportman.Drawing;
using Reportman.Reporting;
using System;
using System.Collections.Generic;

namespace Reportman.Designer
{
    internal class DesignerInterfaceDataInfo : DesignerInterface
    {
        private DataInfo FDataInfo;
        public DesignerInterfaceDataInfo(SortedList<int, ReportItem> repitem, IObjectInspector objinsp)
          : base(repitem, objinsp)
        {
            if (repitem.Count == 1)
                FDataInfo = (DataInfo)repitem.Values[0];
        }
        public DataInfo DataInfo { get { return FDataInfo; } }

        /// <summary>The type of the property of the unions: an ellipsis that opens UnionsEditorForm.</summary>
        internal const string UnionsType = "UNIONS";

        /// <summary>The dataset is on a MyBase connection: it runs no SQL, it may join other datasets.</summary>
        internal bool IsMyBase
        {
            get
            {
                if (FDataInfo == null || FDataInfo.Report == null)
                    return false;
                foreach (DatabaseInfo dbinfo in FDataInfo.Report.DatabaseInfo)
                {
                    if (dbinfo.Alias == FDataInfo.DatabaseAlias)
                        return dbinfo.Driver == DriverType.Mybase;
                }
                return false;
            }
        }

        private static void AddProperty(Strings lnames, Strings ltypes, Variants lvalues, Strings lhints, Strings lcat,
            string name, string type, Variant value)
        {
            lnames.Add(name);
            ltypes.Add(type);
            lhints.Add("refdatainfo.html");
            lcat.Add(Translator.TranslateStr(1201));
            if (lvalues != null)
                lvalues.Add(value);
        }
        public Strings GetAvaliableConnections()
        {
            Strings lpossiblevalues = new Strings();
            foreach (DatabaseInfo dbinfo in this.ReportItemObject.Report.DatabaseInfo)
            {
                lpossiblevalues.Add(dbinfo.Alias);
            }
            return lpossiblevalues;
        }
        public Strings GetAvaliableMasterDataSets()
        {
            Strings lpossiblevalues = new Strings
            {
                ""
            };
            foreach (DataInfo dinfo in this.ReportItemObject.Report.DataInfo)
            {
                if (dinfo.Alias != FDataInfo.Alias)
                    lpossiblevalues.Add(dinfo.Alias);
            }
            return lpossiblevalues;
        }

        public override void GetPropertyValues(string pname, Strings lpossiblevalues)
        {
            if (pname == Translator.TranslateStr(154))
            {
                Strings lconnections = GetAvaliableConnections();
                lpossiblevalues.Clear();
                lpossiblevalues.Add("");
                foreach (string nstring in lconnections)
                    lpossiblevalues.Add(nstring);
                return;
            }
            if (pname == Translator.TranslateStr(155))
            {
                Strings ldatasets = GetAvaliableMasterDataSets();
                lpossiblevalues.Clear();
                foreach (string nstring in ldatasets)
                    lpossiblevalues.Add(nstring);
                return;
            }
            base.GetPropertyValues(pname, lpossiblevalues);
        }
        public override void GetProperties(Strings lnames, Strings ltypes, Variants lvalues, Strings lhints, Strings lcat)
        {
            lnames.Clear();
            ltypes.Clear();
            lhints.Clear();
            lcat.Clear();
            if (lvalues != null)
                lvalues.Clear();
            // DataSet Name
            lnames.Add(Translator.TranslateStr(518));
            ltypes.Add(Translator.TranslateStr(557));
            lhints.Add("refdatainfo.html");
            lcat.Add(Translator.TranslateStr(1201));
            if (lvalues != null)
                lvalues.Add(FDataInfo.Alias);
            // Connection
            lnames.Add(Translator.TranslateStr(154));
            ltypes.Add(Translator.TranslateStr(569));
            lhints.Add("refdatainfo.html");
            lcat.Add(Translator.TranslateStr(1201));
            if (lvalues != null)
                lvalues.Add(FDataInfo.DatabaseAlias);
            // Master dataset
            lnames.Add(Translator.TranslateStr(155));
            ltypes.Add(Translator.TranslateStr(569));
            lhints.Add("refdatainfo.html");
            lcat.Add(Translator.TranslateStr(1201));
            if (lvalues != null)
                lvalues.Add(FDataInfo.DataSource);
            if (IsMyBase)
            {
                // A dataset of the MyBase connection runs no SQL: the datasets it joins and how
                AddProperty(lnames, ltypes, lvalues, lhints, lcat, Translator.TranslateStr(1083), UnionsType,
                    UnionSettings.Summary(FDataInfo));
                AddProperty(lnames, ltypes, lvalues, lhints, lcat, Translator.TranslateStr(1440), Translator.TranslateStr(568),
                    FDataInfo.ParallelUnion);
                AddProperty(lnames, ltypes, lvalues, lhints, lcat, Translator.TranslateStr(1084), Translator.TranslateStr(568),
                    FDataInfo.GroupUnion);
                AddProperty(lnames, ltypes, lvalues, lhints, lcat, Translator.TranslateStr(164), Translator.TranslateStr(557),
                    FDataInfo.MyBaseIndexFields);
                AddProperty(lnames, ltypes, lvalues, lhints, lcat, Translator.TranslateStr(165), Translator.TranslateStr(557),
                    FDataInfo.MyBaseMasterFields);
                return;
            }
            // SQL
            lnames.Add("SQL");
            ltypes.Add("SQL");
            lhints.Add("refdatainfo.html");
            lcat.Add(Translator.TranslateStr(1201));
            if (lvalues != null)
                lvalues.Add(FDataInfo.SQL);
        }
        public override Variant GetProperty(string pname)
        {
            // Alias Name
            if (pname == Translator.TranslateStr(518))
                return FDataInfo.Alias;
            // Connection name
            if (pname == Translator.TranslateStr(154))
                return FDataInfo.DatabaseAlias;
            // Master dataset
            if (pname == Translator.TranslateStr(155))
                return FDataInfo.DataSource;
            // SQL
            if (pname == "SQL")
                return FDataInfo.SQL;
            // The union of a dataset of the MyBase connection
            if (pname == Translator.TranslateStr(1083))
                return UnionSettings.Summary(FDataInfo);
            if (pname == Translator.TranslateStr(1440))
                return FDataInfo.ParallelUnion;
            if (pname == Translator.TranslateStr(1084))
                return FDataInfo.GroupUnion;
            if (pname == Translator.TranslateStr(164))
                return FDataInfo.MyBaseIndexFields;
            if (pname == Translator.TranslateStr(165))
                return FDataInfo.MyBaseMasterFields;
            return base.GetProperty(pname);
        }
        public override void SetProperty(string pname, Variant newvalue)
        {
            // DataSet Name
            if (pname == Translator.TranslateStr(518))
            {
                FDataInfo.Alias = newvalue.ToString();
                return;
            }
            // Connection name
            if (pname == Translator.TranslateStr(154))
            {
                Strings nstrings = GetAvaliableConnections();
                if (newvalue.VarType == VariantType.String)
                {
                    newvalue = nstrings.IndexOf(newvalue);
                }
                else
                    newvalue = newvalue - 1;
                if (newvalue < nstrings.Count)
                {
                    if (newvalue < 0)
                    {
                        FDataInfo.DatabaseAlias = "";
                    }
                    else
                        FDataInfo.DatabaseAlias = nstrings[newvalue];
                }
                else
                {
                    if (newvalue < 0)
                    {
                        FDataInfo.DatabaseAlias = "";
                    }
                }
                return;
            }
            // Master DataSet
            if (pname == Translator.TranslateStr(155))
            {
                Strings nstrings = GetAvaliableMasterDataSets();
                if (newvalue.AsString.Length == 0)
                    FDataInfo.DataSource = "";
                else
                {
                    if (DoubleUtil.IsNumeric(newvalue.AsString, System.Globalization.NumberStyles.Integer))
                    {
                        int nindx = Convert.ToInt32(newvalue.AsString);
                        if (nindx < nstrings.Count)
                            if (nindx >= 0)
                                FDataInfo.DataSource = nstrings[nindx];
                    }
                }
                return;
            }
            // SQL
            if (pname == "SQL")
            {
                FDataInfo.SQL = newvalue.ToString();
                return;
            }
            // The union of a dataset of the MyBase connection: the entries, written separated by commas
            if (pname == Translator.TranslateStr(1083))
            {
                FDataInfo.DataUnions.Clear();
                foreach (string entry in UnionSettings.ParseSummary(newvalue.ToString()))
                    FDataInfo.DataUnions.Add(entry);
                return;
            }
            if (pname == Translator.TranslateStr(1440))
            {
                FDataInfo.ParallelUnion = (bool)newvalue;
                return;
            }
            if (pname == Translator.TranslateStr(1084))
            {
                FDataInfo.GroupUnion = (bool)newvalue;
                return;
            }
            if (pname == Translator.TranslateStr(164))
            {
                FDataInfo.MyBaseIndexFields = newvalue.ToString().Trim();
                return;
            }
            if (pname == Translator.TranslateStr(165))
            {
                FDataInfo.MyBaseMasterFields = newvalue.ToString().Trim();
                return;
            }
            // inherited
            base.SetProperty(pname, newvalue);
        }
    }

}
