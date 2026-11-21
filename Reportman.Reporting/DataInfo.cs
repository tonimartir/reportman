using Reportman.Drawing;
using System;
using System.Collections.Generic;
using System.Data;
using System.IO;

namespace Reportman.Reporting
{
    /// <summary>
    /// DatabaInfo stores information about a dataset, a Report have a collection
    /// of dataset definitions. Each dataset is related to one connection (DatabaseInfo)<see cref="Report"/><see cref="DataInfos"/>
    /// </summary>
    public class DataInfo : ReportItem, IDisposable, ICloneable
    {
        Strings masterfieldslist;
        object[] mastervalues;
        private string sql;

        private Evaluator internalevaluator;
        private Evaluator GetEvaluator()
        {
            if (internalevaluator == null)
            {
                internalevaluator = new Evaluator();
            }
            return internalevaluator;
        }
        private string OldSQLUsed;
        private bool connecting;
        /// <summary>DataInfo name (alias)</summary>
		public string Alias { get; set; }
        /// <summary>DatabaseInfo alias related to this dataset</summary>
		public string DatabaseAlias { get; set; }
        /// <summary>Sql sentence, for parameters precede them by double quotes in native drivers or by @ symbol in .Net drivers</summary>
        public string SQL
        {
            get { return sql; }
            set
            {
                    if (value == null)
                    {
                        value = string.Empty;
                    }
                if (string.Equals(sql, value, StringComparison.Ordinal))
                    return;
                sql = value;
                SQLExplanation = string.Empty;
                SQLExplanationError = string.Empty;
            }
        }
        /// <summary>
        /// Gets or sets the natural language explanation for the SQL query.
        /// </summary>
        public string SQLExplanation { get; set; }
        /// <summary>
        /// Gets or sets the error message if the query explanation fails.
        /// </summary>
        public string SQLExplanationError { get; set; }
        /// <summary>
        /// Gets or sets the database hub schema identifier.
        /// </summary>
        public long HubSchemaId { get; set; }
        /// <summary>
        /// The local subschema (or the host's zone) the dataset was made with, by name; empty for all the
        /// tables or a Hub schema (<see cref="HubSchemaId"/>). Saved only when it is not empty.
        /// </summary>
        public string SchemaName { get; set; }
        /// <summary>A master dataset can be assigned so the query is executed each time the parameters of the
        /// query change, the parameters with the same name as master dataset fields will be checked</summary>
		public string DataSource { get; set; }
        /// <summary>Filename to loadwhen MyBase driver is selected</summary>
		public string MyBaseFilename { get; set; }
        /// <summary>Field definition file when Mybase driver is selected</summary>
        public string MyBaseFields { get; set; }
        /// <summary>Index fields when MyBase driver is selected</summary>
        public string MyBaseIndexFields { get; set; }
        /// <summary>Master fields when MyBase driver is selected</summary>
        public string MyBaseMasterFields { get; set; }
        /// <summary>Index fields when BDE driver is selected</summary>
        public string BDEIndexFields { get; set; }
        /// <summary>Index name when BDE driver is selected</summary>
        public string BDEIndexName { get; set; }
        /// <summary>Index table name when BDE driver is selected and BDEType is Table</summary>
        public string BDETable { get; set; }
        /// <summary>BDE dataset type (table,query) when BDE driver is selected</summary>
        public DatasetType BDEType { get; set; }
        /// <summary>BDE filter BDE driver is selected</summary>
        public string BDEFilter { get; set; }
        /// <summary>BDE master fields BDE driver is selected</summary>
        public string BDEMasterFields { get; set; }
        /// <summary>BDE first range filter BDE driver is selected</summary>
        public string BDEFirstRange { get; set; }
        /// <summary>BDE last range filter BDE driver is selected</summary>
        public string BDELastRange { get; set; }
        /// <summary>When Mybase driver is selected, you can fill the dataset (in memory dataset) with other datasets</summary>
        public Strings DataUnions { get; set; }
        /// <summary>When Mybase driver is selected, you can fill the dataset (in memory dataset) with other datasets, with grouping option</summary>
        public bool GroupUnion { get; set; }
        /// <summary>When Mybase driver is selected, and union is performed, 
        /// </summary>
        public bool ParallelUnion { get; set; }
        /// <summary>By default all datasets are open on start, set this property to false when you want to open the dataset at runtime manually</summary>
        public bool OpenOnStart { get; set; }
        /// <summary>Current IDataReader</summary>
		public IDataReader DataReader;
        /// <summary>Current in memory two record buffer table</summary>
        public ReportDataset Data;
        /// <summary>Current IDbCommand</summary>
		public System.Data.IDbCommand Command;
        /// <summary>Set this property to override the sql sentence at runtime, set is before executing the report</summary>
        public string SQLOverride;
        /// <summary>
        /// Gets or sets an optional DataView override used to supply custom data at runtime.
        /// </summary>
        public DataView DataViewOverride;
        /// <summary>
        /// How <see cref="Connect"/> executes the query on a direct connection. Default reads the rows;
        /// <see cref="System.Data.CommandBehavior.SchemaOnly"/> only describes the columns (the dataset
        /// opens empty), which is how the AI copilot learns the columns of a SQL it wrote. Not saved
        /// with the report.
        /// </summary>
        [System.Text.Json.Serialization.JsonIgnore]
        [Newtonsoft.Json.JsonIgnore]
        public CommandBehavior OpenBehavior { get; set; } = CommandBehavior.Default;
        /// <summary>
        /// Free resources
        /// </summary>
		override public void Dispose()
        {
            base.Dispose();
            if (Data != null)
            {
                Data.Dispose();
                Data = null;
            }
            // TODO: Check for assigned connections and dispose them
            // That is check if they implements IDisposable and call Dispose()
        }
        /// <summary>
        /// Gets the class name identifier for the ReportItem serialization.
        /// </summary>
        /// <returns>A string identifier.</returns>
        protected override string GetClassName()
        {
            return "TRPDATAINFOITEM";
        }
        /// <summary>
        /// Clone the DataInfo item
        /// </summary>
        /// <param name="areport">The new owner of the DataInfo</param>
        /// <returns>A new DataInfo item</returns>
		public DataInfo Clone(Report areport)
        {
            DataInfo ninfo = (DataInfo)Clone();
            ninfo.Report = areport;
            return ninfo;
        }
        /// <summary>
        /// Clone the DataInfo item
        /// </summary>
        /// <returns>A new DataInfo item</returns>
        public object Clone()
        {
            DataInfo ninfo = new DataInfo();
            ninfo.Report = Report;
            ninfo.Alias = Alias;
            ninfo.BDEFilter = BDEFilter;
            ninfo.BDEFirstRange = this.BDEFirstRange;
            ninfo.BDEIndexFields = this.BDEIndexFields;
            ninfo.BDEIndexName = this.BDEIndexName;
            ninfo.BDELastRange = this.BDELastRange;
            ninfo.BDEMasterFields = this.BDEMasterFields;
            ninfo.BDETable = this.BDETable;
            ninfo.BDEType = this.BDEType;
            ninfo.DatabaseAlias = this.DatabaseAlias;
            ninfo.DataSource = this.DataSource;
            ninfo.DataUnions = (Strings)this.DataUnions.Clone();
            ninfo.GroupUnion = this.GroupUnion;
            ninfo.ParallelUnion = this.ParallelUnion;
            ninfo.MyBaseFields = this.MyBaseFields;
            ninfo.MyBaseFilename = this.MyBaseFilename;
            ninfo.MyBaseIndexFields = this.MyBaseIndexFields;
            ninfo.MyBaseMasterFields = this.MyBaseMasterFields;
            ninfo.Name = Name;
            ninfo.OpenOnStart = this.OpenOnStart;
            ninfo.Report = Report;
            ninfo.SQL = this.SQL;
            ninfo.SQLExplanation = this.SQLExplanation;
            ninfo.SQLExplanationError = this.SQLExplanationError;
            ninfo.HubSchemaId = this.HubSchemaId;
            ninfo.SchemaName = this.SchemaName;
            return ninfo;
        }
        /// <summary>
        /// Constructor
        /// </summary>
        public DataInfo()
            : base()
        {
            OpenOnStart = true;
            DataUnions = new Strings();
            Alias = ""; DatabaseAlias = ""; SQL = ""; DataSource = ""; SQLOverride = "";
            SQLExplanation = "";
            SQLExplanationError = "";
            HubSchemaId = 0;
            SchemaName = "";
            MyBaseFilename = ""; MyBaseFields = ""; MyBaseIndexFields = ""; MyBaseMasterFields = "";
            BDEIndexFields = ""; BDEIndexName = ""; BDETable = "";
            BDEFilter = ""; BDEMasterFields = ""; BDEFirstRange = ""; BDELastRange = "";
            Data = new ReportDataset();
        }
        /// <summary>
        /// Obtain the related DatabaseInfoItem, searching by DatabaseAlias
        /// </summary>
        /// <returns>The DatabaseInfo or throws an exception</returns>
		public DatabaseInfo GetDbItem()
        {
            int index = -1;
            DatabaseInfos infos = Report.DatabaseInfo;
            for (int i = 0; i < infos.Count; i++)
            {
                if (infos[i].Alias == DatabaseAlias)
                {
                    index = i;
                    break;
                }
            }
            if (index >= 0)
                return infos[index];
            else
                throw new NamedException("Database alias not found: " + DatabaseAlias, DatabaseAlias);
        }
        /// <summary>
        /// Obtain field information from the dataset, useful for the designer
        /// </summary>
        /// <param name="astream">Stream to fill with the information</param>
		public void GetFieldsInfo(Stream astream)
        {
            int i;
            for (i = 0; i < Data.Columns.Count; i++)
            {
                StreamUtil.SWriteLine(astream, Data.Columns[i].ColumnName);
                StreamUtil.SWriteLine(astream, Data.Columns[i].DataType.ToString());
                StreamUtil.SWriteLine(astream, Data.Columns[i].MaxLength.ToString());
            }
        }
        /// <summary>
        /// Positions the dataset memory view cursor back to the first record.
        /// </summary>
        public void GoFirstMem()
        {
            if (Data.CurrentView == null)
                return;
            Data.First();
        }
        /// <summary>
        /// Open the dataset and read the first record into the data variable
        /// </summary>
		public void Connect()
        {
            if (connecting)
                throw new NamedException("Circular datalinks not allowed:" + Alias, Alias);
            if ((Data.CurrentReader != null) || (Data.CurrentView != null))
                return;
            connecting = true;
            try
            {
                DatabaseInfo dbitem = GetDbItem();
                dbitem.Connect();
                DataReader = null;
                Data.CurrentReader = null;
                Data.CurrentView = null;
                Data.UpdateColumns = true;

                Params aparams = Report.Params;


                DataInfo mastersource = null;
                // Open first the master source
                if (DataSource.Length > 0)
                {
                    int index = Report.DataInfo.IndexOf(DataSource);
                    if (index < 0)
                        throw new NamedException("Master source not found: "
                         + DataSource + " in " + Alias, DataSource);
                    mastersource = Report.DataInfo[index];
                    Report.UpdateParamsBeforeOpen(index, true);
                    mastersource.Connect();
                }
                if ((dbitem.Driver == DriverType.Mybase) || (DataViewOverride != null))
                {
#if REPMAN_COMPACT
                    throw new Exception("Driver Mybase not supported in Compact framework");
#else
                    if (DataViewOverride != null)
                    {
                        Data.CurrentView = DataViewOverride;

                        if (mastersource != null)
                        {
                            UpdateParams(mastersource.Data, Command);
                            Data.ViewFilter = mastervalues;

                            mastersource.Data.OnDataChange += new DataChange(OnDataChange);
                        }
                    }
                    else
                    {
                        masterfieldslist = Strings.FromSemiColon(MyBaseMasterFields.ToUpper());
                        masterfieldslist.RemoveBlanks();
                        mastervalues = new object[masterfieldslist.Count];

                        for (int ixvalue = 0; ixvalue < masterfieldslist.Count; ixvalue++)
                            mastervalues[ixvalue] = DBNull.Value;
                        DataSet intdataset = dbitem.Report.DatabaseInfo.MemoryDataSet;
                        DataTable inttable = null;
                        int indextable = intdataset.Tables.IndexOf(Alias);
                        if (indextable >= 0)
                        {
                            inttable = intdataset.Tables[indextable];
                            intdataset.Tables.Remove(inttable);
                            inttable.Dispose();
                            inttable = null;
                        }
                        if (this.DataUnions.Count > 0)
                        {
                            inttable = BuildUnion();
                            if (inttable != null)
                            {
                                inttable.TableName = Alias;
                                Strings lsorting = Strings.FromSemiColon(this.MyBaseIndexFields);
                                Strings lnew = new Strings();
                                Strings nmaster = Strings.FromSemiColon(this.MyBaseMasterFields);
                                for (int ix = 0; ix < nmaster.Count; ix++)
                                    lnew.Add(lsorting[ix]);
                                string sortingstring = lnew.ToCharSeparated(',');
                                DataView intview = null;

                                // The order of the index fields (IndexFieldNames of the Delphi engine), also
                                // the order of the master/detail filter
                                if (MyBaseIndexFields.Length > 0)
                                {
                                    Strings nsort = Strings.FromSemiColon(this.MyBaseIndexFields);
                                    nsort.RemoveBlanks();
                                    DataTable oldtable = inttable;
                                    inttable = oldtable.Clone();
                                    foreach (DataRow xrow in OrderedRows(oldtable, nsort))
                                        inttable.Rows.Add(xrow.ItemArray);
                                    oldtable.Dispose();
                                }
                                intview = new DataView(inttable, "", sortingstring, DataViewRowState.CurrentRows);


                                intdataset.Tables.Add(inttable);
                                Data.CurrentView = intview;

                                if (mastersource != null)
                                {
                                    UpdateParams(mastersource.Data, Command);
                                    Data.ViewFilter = mastervalues;

                                    mastersource.Data.OnDataChange += new DataChange(OnDataChange);
                                }

                            }
                        }
                    }
#endif
                }
                else
                {
                    IDataReader areader;
                    if (dbitem.SqlExecuter == null)
                        Command = dbitem.Connection.CreateCommand();
                    else
                        Command = dbitem.SqlExecuter.CreateCommand();
                    Command.CommandTimeout = 0;
                    Command.Transaction = dbitem.CurrentTransaction;
                    string sqlsentence;
                    if (SQLOverride.Length != 0)
                        sqlsentence = SQLOverride;
                    else
                        sqlsentence = SQL;
                    // Assign parameters, string substitution only
                    for (int i = 0; i < aparams.Count; i++)
                    {
                        Param aparam = aparams[i];
                        switch (aparam.ParamType)
                        {
                            case ParamType.Subst:
                            case ParamType.Multiple:
                                int index = aparam.Datasets.IndexOf(Alias);
                                if (index >= 0)
                                    sqlsentence = sqlsentence.Replace(aparam.Search, aparam.Value);
                                break;
                            case ParamType.SubstExpre:
                            case ParamType.SubsExpreList:
                                int index2 = aparam.Datasets.IndexOf(Alias);
                                if (index2 >= 0)
                                {

                                    string nvalue = aparam.LastValue.ToString();
                                    //        GetEvaluator().Expression = nvalue;
                                    //      nvalue = GetEvaluator().Evaluate().ToString();

                                    sqlsentence = sqlsentence.Replace(aparam.Search, nvalue);
                                }
                                break;
                        }
                    }

                    Command.CommandText = sqlsentence;
                    OldSQLUsed = sqlsentence;
                    // Assign parameters
                    for (int i = 0; i < aparams.Count; i++)
                    {
                        Param aparam = aparams[i];
                        int index = aparam.Datasets.IndexOf(Alias);
                        if (index >= 0)
                        {
                            if ((aparam.ParamType != ParamType.Subst) &&
                             (aparam.ParamType != ParamType.Multiple) && (aparam.ParamType != ParamType.SubsExpreList)
                                 && (aparam.ParamType != ParamType.SubstExpre))
                            {
                                System.Data.IDataParameter dbparam = Command.CreateParameter();
                                //dbparam.ParameterName = "@" + aparam.Alias;
                                // SQL Server does not like "@" prefix
                                dbparam.ParameterName = aparam.Alias;
                                dbparam.Direction = ParameterDirection.Input;
                                object pvalue = aparam.LastValue.AsObject();
                                dbparam.DbType = ParameterDbType.For(Command, aparam.Value.GetDbType(), pvalue);
                                dbparam.Value = pvalue;
                                Command.Parameters.Add(dbparam);
                            }
                        }
                    }
                    if (mastersource != null)
                    {
                        UpdateParams(mastersource.Data, Command);
                        mastersource.Data.OnDataChange += new DataChange(OnDataChange);
                    }
                    if (dbitem.SqlExecuter != null)
                    {
                        Data.CurrentView = new DataView(dbitem.SqlExecuter.Open(Command));
                    }
                    else
                    {
                        if (OpenBehavior == CommandBehavior.Default)
                            areader = Command.ExecuteReader();
                        else
                            areader = Command.ExecuteReader(OpenBehavior);
                        DataReader = areader;
                        Data.CurrentReader = DataReader;
                    }

                }

            }
            finally
            {
                connecting = false;
            }
        }
        /// <summary>
        /// The rows of a dataset of the MyBase connection made of other datasets of the report
        /// (<see cref="DataUnions"/>), as TRpDataInfoItem.Connect of the Delphi engine builds them:
        /// each dataset is opened (one already open is read from its current row) and its rows are
        /// added to the result. The first dataset gives the columns. Without <see cref="ParallelUnion"/>
        /// the rows of the others follow by position; with <see cref="GroupUnion"/> a row with the
        /// values of the index fields (<see cref="MyBaseIndexFields"/>) of one already there is added
        /// to it. With <see cref="ParallelUnion"/> the columns of each other dataset are added to the
        /// rows of the result, see <see cref="CombineParallel"/>.
        /// </summary>
        private DataTable BuildUnion()
        {
            Strings indexFields = Strings.FromSemiColon(MyBaseIndexFields);
            indexFields.RemoveBlanks();
            DataTable client = null;
            Strings originalFields = new Strings();
            for (int i = 0; i < DataUnions.Count; i++)
            {
                string entry = DataUnions[i];
                Strings commonFields;
                string sourceAlias = ExtractUnionFields(entry, out commonFields);
                int index = Report.DataInfo.IndexOf(sourceAlias);
                if (index < 0)
                    throw new NamedException(Translator.TranslateStr(959) + " - " + Alias + " - " + entry, Alias);
                DataInfo source = Report.DataInfo[index];
                if ((source.Data.CurrentReader == null) && (source.Data.CurrentView == null))
                    Report.UpdateParamsBeforeOpen(index, true);
                source.Connect();
                DataTable data = ReadUnionSource(source.Data);
                if ((i == 0) || (!ParallelUnion))
                {
                    client = CombineAddDataset(client, data, GroupUnion, indexFields, Alias);
                    originalFields = commonFields;
                }
                else
                {
                    if ((originalFields.Count > 0) && (commonFields.Count != originalFields.Count))
                        throw new NamedException("The common fields of the union " + entry + " in " + Alias
                            + " must be as many as those of the first dataset: " + originalFields.ToSemiColon(), Alias);
                    DataTable combined = CombineParallel(client, OrderedRows(client, indexFields), data,
                        "Q" + (i + 1).ToString("00") + "_", commonFields, originalFields);
                    client = CombineAddDataset(null, combined, GroupUnion, indexFields, Alias);
                }
            }
            return client;
        }

        /// <summary>
        /// The dataset alias of a union entry, "ALIAS" or "ALIAS-FIELD1;FIELD2", and its common fields
        /// in upper case (ExtractUnionFields of the Delphi engine: the first '-' ends the alias).
        /// </summary>
        private static string ExtractUnionFields(string entry, out Strings commonFields)
        {
            commonFields = new Strings();
            int index = entry.IndexOf('-');
            if (index < 0)
                return entry;
            foreach (string field in Strings.FromSemiColon(entry.Substring(index + 1)))
                commonFields.Add(field.ToUpperInvariant());
            return entry.Substring(0, index);
        }

        /// <summary>
        /// The rows of a dataset from its current row to its last one, with its columns.
        /// </summary>
        private static DataTable ReadUnionSource(ReportDataset data)
        {
            DataTable table = new DataTable();
            foreach (DataColumn column in data.Columns)
                table.Columns.Add(column.ColumnName, column.DataType);
            while (!data.Eof)
            {
                DataRow row = data.CurrentRow;
                if (row == null)
                    break;
                table.Rows.Add(row.ItemArray);
                data.Next();
            }
            return table;
        }

        /// <summary>
        /// Adds the rows of a dataset to the result of a union (CombineAddDataset of the Delphi engine):
        /// the result takes the columns of the first one, and the values of each row fill its columns
        /// by position. With grouping, a row whose index fields (by position) have the values of a row
        /// already there adds its other values to it (numbers are added, texts joined) instead.
        /// </summary>
        private static DataTable CombineAddDataset(DataTable client, DataTable data, bool group, Strings indexFields, string alias)
        {
            if (client == null)
                client = data.Clone();
            if (data.Columns.Count > client.Columns.Count)
                throw new NamedException(Translator.TranslateStr(960) + " - " + alias, alias);
            int[] keyColumns = new int[0];
            if (group)
            {
                if (indexFields.Count == 0)
                    throw new NamedException("A grouped union needs the index fields (MyBaseIndexFields) of " + alias, alias);
                keyColumns = new int[indexFields.Count];
                for (int k = 0; k < indexFields.Count; k++)
                {
                    keyColumns[k] = client.Columns.IndexOf(indexFields[k]);
                    if (keyColumns[k] < 0)
                        throw new NamedException("Field '" + indexFields[k] + "' not found in " + alias, alias);
                }
            }
            foreach (DataRow row in data.Rows)
            {
                DataRow target = null;
                if (group)
                {
                    foreach (DataRow existing in client.Rows)
                    {
                        bool same = true;
                        foreach (int k in keyColumns)
                        {
                            if (!UnionValuesEqual(existing[k], ConvertUnionValue(row[k], client.Columns[k].DataType)))
                            {
                                same = false;
                                break;
                            }
                        }
                        if (same)
                        {
                            target = existing;
                            break;
                        }
                    }
                }
                if (target != null)
                {
                    for (int i = 0; i < data.Columns.Count; i++)
                    {
                        if (Array.IndexOf(keyColumns, i) >= 0 || row[i] == DBNull.Value)
                            continue;
                        if (target[i] == DBNull.Value)
                            target[i] = ConvertUnionValue(row[i], client.Columns[i].DataType);
                        else
                            target[i] = ConvertUnionValue(AddUnionValues(target[i], row[i]), client.Columns[i].DataType);
                    }
                }
                else
                {
                    DataRow newRow = client.NewRow();
                    for (int i = 0; i < data.Columns.Count; i++)
                        newRow[i] = ConvertUnionValue(row[i], client.Columns[i].DataType);
                    client.Rows.Add(newRow);
                }
            }
            return client;
        }

        /// <summary>
        /// A parallel union (CombineParallel of the Delphi engine): the columns of the first dataset, an
        /// integer column named as the prefix (0 for the rows only the first one has, 1 for the rows the
        /// second one reaches), and the columns of the second one with the prefix but its common
        /// fields. With common fields each row of the second dataset fills the first row of the first
        /// one with the same values that it has not filled yet, or a new row; the result is ordered by
        /// the prefix column and then by the common fields. Without them the rows are paired by position.
        /// </summary>
        private static DataTable CombineParallel(DataTable data1, List<DataRow> rows1, DataTable data2, string prefix,
            Strings commonFields, Strings originalFields)
        {
            DataTable result = data1.Clone();
            int prefixColumn = result.Columns.Add(prefix, typeof(int)).Ordinal;
            int[] targets = new int[data2.Columns.Count];
            for (int i = 0; i < data2.Columns.Count; i++)
            {
                string name = data2.Columns[i].ColumnName;
                if (commonFields.IndexOf(name.ToUpperInvariant()) < 0)
                    targets[i] = result.Columns.Add(prefix + name, data2.Columns[i].DataType).Ordinal;
                else
                {
                    targets[i] = result.Columns.IndexOf(name);
                    if (targets[i] < 0)
                        throw new NamedException("Field '" + name + "' not found in the first dataset of the union", name);
                }
            }
            int[] keyColumns = new int[originalFields.Count];
            int[] keySources = new int[originalFields.Count];
            for (int k = 0; k < originalFields.Count; k++)
            {
                keyColumns[k] = result.Columns.IndexOf(originalFields[k]);
                if (keyColumns[k] < 0)
                    throw new NamedException("Field '" + originalFields[k] + "' not found in the union", originalFields[k]);
                keySources[k] = data2.Columns.IndexOf(commonFields[k]);
                if (keySources[k] < 0)
                    throw new NamedException("Field '" + commonFields[k] + "' not found in the dataset of the union", commonFields[k]);
            }
            foreach (DataRow row in rows1)
            {
                DataRow newRow = result.NewRow();
                for (int i = 0; i < row.Table.Columns.Count; i++)
                    newRow[i] = row[i];
                newRow[prefixColumn] = 0;
                result.Rows.Add(newRow);
            }
            int position = 0;
            foreach (DataRow row in data2.Rows)
            {
                DataRow target = null;
                if (keyColumns.Length > 0)
                {
                    foreach (DataRow candidate in OrderedRows(result, prefixColumn, keyColumns))
                    {
                        if ((int)candidate[prefixColumn] != 0)
                            continue;
                        bool same = true;
                        for (int k = 0; k < keyColumns.Length; k++)
                        {
                            object key = ConvertUnionValue(row[keySources[k]], result.Columns[keyColumns[k]].DataType);
                            if (!UnionValuesEqual(candidate[keyColumns[k]], key))
                            {
                                same = false;
                                break;
                            }
                        }
                        if (same)
                        {
                            target = candidate;
                            break;
                        }
                    }
                }
                else if (position < result.Rows.Count)
                    target = result.Rows[position];
                if (target == null)
                {
                    target = result.NewRow();
                    result.Rows.Add(target);
                }
                for (int i = 0; i < data2.Columns.Count; i++)
                    target[targets[i]] = ConvertUnionValue(row[i], result.Columns[targets[i]].DataType);
                target[prefixColumn] = 1;
                position++;
            }
            if (keyColumns.Length == 0)
                return result;
            DataTable ordered = result.Clone();
            foreach (DataRow row in OrderedRows(result, prefixColumn, keyColumns))
                ordered.Rows.Add(row.ItemArray);
            return ordered;
        }

        /// <summary>
        /// The rows of a table in the order of an index on some of its columns (the rows with the same
        /// values keep their order): the order a TClientDataSet with IndexFieldNames goes through them.
        /// </summary>
        private static List<DataRow> OrderedRows(DataTable table, Strings indexFields)
        {
            List<int> columns = new List<int>();
            foreach (string field in indexFields)
            {
                int column = table.Columns.IndexOf(field);
                if (column < 0)
                    throw new NamedException("Field '" + field + "' not found in the union", field);
                columns.Add(column);
            }
            return OrderedRows(table, -1, columns.ToArray());
        }

        private static List<DataRow> OrderedRows(DataTable table, int firstColumn, int[] columns)
        {
            List<DataRow> rows = new List<DataRow>();
            foreach (DataRow row in table.Rows)
                rows.Add(row);
            if ((firstColumn < 0) && (columns.Length == 0))
                return rows;
            List<int> keys = new List<int>();
            if (firstColumn >= 0)
                keys.Add(firstColumn);
            keys.AddRange(columns);
            // A stable sort: List.Sort is not, so the position breaks the ties
            Dictionary<DataRow, int> positions = new Dictionary<DataRow, int>();
            for (int i = 0; i < rows.Count; i++)
                positions[rows[i]] = i;
            rows.Sort(delegate (DataRow a, DataRow b)
            {
                foreach (int key in keys)
                {
                    int result = CompareUnionValues(a[key], b[key]);
                    if (result != 0)
                        return result;
                }
                return positions[a].CompareTo(positions[b]);
            });
            return rows;
        }

        /// <summary>
        /// The order of two values of an index of a union: nulls first, numbers by value, texts as a
        /// DataView without case sensitivity compares them (the culture, ignoring case: the order of
        /// the index of the Delphi in-memory dataset too), dates by time.
        /// </summary>
        private static int CompareUnionValues(object a, object b)
        {
            bool nullA = a == null || a == DBNull.Value;
            bool nullB = b == null || b == DBNull.Value;
            if (nullA || nullB)
                return nullA == nullB ? 0 : (nullA ? -1 : 1);
            if (IsUnionNumber(a) && IsUnionNumber(b))
            {
                if (a is double || a is float || b is double || b is float)
                    return Convert.ToDouble(a).CompareTo(Convert.ToDouble(b));
                return Convert.ToDecimal(a).CompareTo(Convert.ToDecimal(b));
            }
            if (a is string && b is string)
                return System.Globalization.CultureInfo.CurrentCulture.CompareInfo.Compare((string)a, (string)b,
                    System.Globalization.CompareOptions.IgnoreCase | System.Globalization.CompareOptions.IgnoreKanaType
                    | System.Globalization.CompareOptions.IgnoreWidth);
            if (a is IComparable && a.GetType() == b.GetType())
                return ((IComparable)a).CompareTo(b);
            return string.CompareOrdinal(Convert.ToString(a, System.Globalization.CultureInfo.InvariantCulture),
                Convert.ToString(b, System.Globalization.CultureInfo.InvariantCulture));
        }

        private static bool UnionValuesEqual(object a, object b)
        {
            return CompareUnionValues(a, b) == 0;
        }

        private static bool IsUnionNumber(object value)
        {
            return value is byte || value is sbyte || value is short || value is ushort || value is int || value is uint
                || value is long || value is ulong || value is float || value is double || value is decimal;
        }

        /// <summary>
        /// A value of a union converted to the type of the column it goes to, as a Variant assigned to
        /// a field of the Delphi engine is.
        /// </summary>
        private static object ConvertUnionValue(object value, Type type)
        {
            if (value == null || value == DBNull.Value)
                return DBNull.Value;
            if (type == typeof(object) || type.IsInstanceOfType(value))
                return value;
            if (type == typeof(string))
                return Convert.ToString(value, System.Globalization.CultureInfo.InvariantCulture);
            return Convert.ChangeType(value, type, System.Globalization.CultureInfo.InvariantCulture);
        }

        /// <summary>
        /// The sum of two values of a grouped union (the + of two Variants of the Delphi engine): texts
        /// are joined, a date moves by a number of days, numbers are added.
        /// </summary>
        private static object AddUnionValues(object a, object b)
        {
            if (a is string || b is string)
            {
                if (a is string && b is string)
                    return (string)a + (string)b;
                return Convert.ToDouble(a, System.Globalization.CultureInfo.InvariantCulture)
                    + Convert.ToDouble(b, System.Globalization.CultureInfo.InvariantCulture);
            }
            if (a is DateTime)
                return DateTime.FromOADate(((DateTime)a).ToOADate() + Convert.ToDouble(b));
            if (b is DateTime)
                return DateTime.FromOADate(Convert.ToDouble(a) + ((DateTime)b).ToOADate());
            if (a is double || a is float || b is double || b is float)
                return Convert.ToDouble(a) + Convert.ToDouble(b);
            if (a is decimal || b is decimal)
                return Convert.ToDecimal(a) + Convert.ToDecimal(b);
            return Convert.ToInt64(a) + Convert.ToInt64(b);
        }

        private void OnDataChange(ReportDataset master)
        {
            if (UpdateParams(master, Command))
            {
                if ((Data.CurrentView != null) && (masterfieldslist != null))
                {
                    Data.ViewFilter = mastervalues;
                }
                else
                {
                    if (DataReader != null)
                    {
                        DataReader.Close();
                        DataReader = null;
                    }
                    DatabaseInfo dbitem = GetDbItem();

                    if (dbitem.SqlExecuter != null)
                    {
                        Data.CurrentView = new DataView(dbitem.SqlExecuter.Open(Command));
                    }
                    else
                    {
                        IDataReader areader = Command.ExecuteReader();
                        DataReader = areader;
                        Data.UpdateColumns = (OldSQLUsed != Command.CommandText);
                        Data.CurrentReader = areader;
                    }
                }
            }
        }
        /// <summary>
        /// Update the parameters inside the command, the master dataset will be used to fill the parameters
        /// with matching names
        /// </summary>
        /// <param name="master">Master dataset</param>
        /// <param name="ncommand">Command</param>
        /// <returns></returns>
		public bool UpdateParams(ReportDataset master, IDbCommand ncommand)
        {
            if ((Data.CurrentView != null) && (masterfieldslist != null))
            {
                bool nresult = false;
                int idx = 0;
                foreach (string nmasterf in masterfieldslist)
                {
                    object nvalue = DBNull.Value;
                    if (!master.Eof)
                    {
                        nvalue = master.CurrentRow[nmasterf];
                    }
                    if (!nvalue.Equals(mastervalues[idx]))
                    {
                        nresult = true;
                        mastervalues[idx] = nvalue;
                    }
                    idx++;
                }
                return nresult;
            }
            else
            {
                bool aresult = false;
                for (int i = 0; i < ncommand.Parameters.Count; i++)
                {
                    IDbDataParameter param = (IDbDataParameter)ncommand.Parameters[i];
                    string paramname = param.ParameterName;
                    if (paramname.Length > 0)
                    {
                        if (paramname[0] == '@')
                            paramname = param.ParameterName.Substring(1, param.ParameterName.Length - 1);
                        int index = master.Columns.IndexOf(paramname);
                        if (index >= 0)
                        {
                            if (master.Eof)
                            {
                                if (param.Value != null)
                                    aresult = true;
                                param.Value = null;
                            }
                            else
                                if (!master.CurrentRow[paramname].Equals(param.Value))
                            {
                                aresult = true;
                                param.Value = master.CurrentRow[paramname];
                            }
                        }
                    }
                }
                return aresult;
            }
        }
        /// <summary>
        /// Close the dataset, and free the datareader
        /// </summary>
		public void DisConnect()
        {
            if (DataReader != null)
            {
                DataReader.Close();
                Command = null;
                DataReader = null;
                Data.CurrentReader = null;
            }
            if (Data.CurrentView != null)
            {
                Data.CurrentView = null;
            }
            if (Data.CurrentReader != null)
            {
                Data.CurrentReader = null;
            }
        }
        /// <summary>
        /// Detaches and clears the memory view source from the dataset, freeing it for disconnection.
        /// </summary>
        public void DisConnectMem()
        {

            if (Data != null)
            {
                if (Data.CurrentView != null)
                    Data.CurrentView = null;
            }
        }
    }
}
