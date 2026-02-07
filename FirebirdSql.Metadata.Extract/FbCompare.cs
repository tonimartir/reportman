using Reportman.Drawing;
using System;
using System.Collections.Generic;
using System.Data;
using System.Runtime.InteropServices;
using System.Text;

namespace FirebirdSql.Metadata.Extract
{
    public delegate void FbCompareProgressEvent(object sender, FbCompareProgressArgs args);
    public class FbCompare
    {
        public delegate void FbFilterObjectEvent(object sender, FbFilterObjectEventArgs args);
        public FbFilterObjectEvent OnFilterOldObject;
        private enum CompareStep { Reading, Preparing, Comparing };
        CompareStep FCompareStep;
        DataSet NewData;
        DataSet OldData;
        ISqlExecuter OldDb;
        ISqlExecuter NewDb;
        public string SentenceSeparator;
        public string AlternativeSentenceSeparator;
        public bool DetailedFlush;
        int dialect;
        SortedList<string, List<string>> PrimaryKeysNew;
        SortedList<string, List<string>> PrimaryKeysOld;
        StringBuilder nresult;
        public FbCompareProgressEvent OnProgress;
        bool validate_column_order;
        List<string> Sentences = new List<string>();
        public bool UpdateDestination = false;
        public StringBuilder Result
        {
            get
            {
                return nresult;
            }
        }
        public FbCompare(ISqlExecuter nolddb, ISqlExecuter ncurrentdb, int ndialect, bool nvalidate_column_order)
        {
            OldDb = nolddb;
            NewDb = ncurrentdb;
            dialect = ndialect;
            SentenceSeparator = ";";
            AlternativeSentenceSeparator = System.Environment.NewLine + "^";
            validate_column_order = nvalidate_column_order;

        }
        private void AddSentence(string nsentence, bool addOnFail = true)
        {
            AddSentence(nsentence, SentenceSeparator, addOnFail);
        }
        private void AddSentence(string nsentence, string SentenceSep, bool addOnFail = true)
        {
            if (UpdateDestination)
            {
                if (addOnFail)
                {
                    nresult.AppendLine(nsentence + SentenceSep);
                    Sentences.Add(nsentence);
                }
                OldDb.StartTransaction(IsolationLevel.Snapshot);
                OldDb.Execute(nsentence);
                OldDb.Commit();
                OldDb.Flush();
                if (!addOnFail)
                {
                    nresult.AppendLine(nsentence + SentenceSep);
                    Sentences.Add(nsentence);
                }
            }
            else
            {
                nresult.AppendLine(nsentence + SentenceSep);
                Sentences.Add(nsentence);
            }
        }
        private void AddComment(string ncomment)
        {
            nresult.Append("--");
            nresult.Append(ncomment);
            nresult.Append(System.Environment.NewLine);
        }
        private void DoInit()
        {
            nresult = new StringBuilder();
            Sentences = new List<string>();

            NewData = new DataSet();
            OldData = new DataSet();

            removeddeps = new SortedList<string, string>();
            removedindexes = new SortedList<string, string>();
            removedfields = new SortedList<string, string>();
            domainsadded = new SortedList<string, string>();
            removedconstraints = new SortedList<string, string>();
            removedprims = new SortedList<string, string>();
            removedexceptions = new SortedList<string, string>();
            removedprocs = new SortedList<string, string>();
            removedfuncs = new SortedList<string, string>();
            removedgens = new SortedList<string, string>();
            removedtrig = new SortedList<string, string>();
            removedconst = new SortedList<string, string>();
            removedviews = new SortedList<string, string>();
            ltablesnew = new SortedList<string, string>();
            ltablesold = new SortedList<string, string>();
            addediden = new SortedList<string, string>();

            viewdependedonname = null;
            viewdependedonnamecolumn = null;
            viewIndices = null;
            viewIndicesDetail = null;
            CurrentProgress = 0;
            FCompareStep = CompareStep.Reading;
        }
        const int MAX_PROGRESS = 80;
        int CurrentProgress = 0;
        enum UpdateType { Full, OmitForeign, OnlyForeign }
        public void Execute(bool omitforeign)
        {
            DoInit();



            FillOldAndNewData();

            FCompareStep = CompareStep.Comparing;

            UpdateType uptype = UpdateType.Full;
            if (omitforeign)
                uptype = UpdateType.OmitForeign;
            CompareData(uptype);

            if (UpdateDestination)
            {
                if (Sentences.Count > 0)
                {
                    OldDb.Commit();
                    OldDb.Flush();
                }
            }

        }
        public void ExecuteForeigns()
        {
            CompareData(UpdateType.OnlyForeign);

            if (UpdateDestination)
            {
                if (Sentences.Count > 0)
                {
                    OldDb.Commit();
                    OldDb.Flush();
                }
            }
        }
        SortedList<string, string> removeddeps;
        SortedList<string, string> removedindexes;
        SortedList<string, string> removedfields;
        SortedList<string, string> domainsadded;
        SortedList<string, string> removedconstraints;
        SortedList<string, string> removedprims;
        SortedList<string, string> removedexceptions;
        SortedList<string, string> removedprocs;
        SortedList<string, string> removedfuncs;
        SortedList<string, string> removedgens;
        SortedList<string, string> removedtrig;
        SortedList<string, string> removedconst;
        SortedList<string, string> removedviews;
        SortedList<string, string> ltablesnew;
        SortedList<string, string> ltablesold;
        SortedList<string, string> addediden;
        DataView viewdependedonname = null;
        DataView viewIndices = null;
        DataView viewIndicesDetail = null;
        DataView viewdependedonnamecolumn = null;
        DataView viewrelationfieldsold = null;
        DataView viewrelationfieldsnew = null;
        DataView viewrelationfieldsolddet = null;
        DataView viewrelationfieldsnewdet = null;
        [DllImport("msvcrt.dll", CallingConvention = CallingConvention.Cdecl)]
        static extern int memcmp(byte[] b1, byte[] b2, long count);

        static bool ByteArrayCompare(byte[] b1, byte[] b2)
        {
            // Validate buffers are the same length.
            // This also ensures that the count does not exceed the length of either buffer.  
            return b1.Length == b2.Length && memcmp(b1, b2, b1.Length) == 0;
        }
        private void CompareData(UpdateType uptype)
        {
            if (uptype != UpdateType.OnlyForeign)
            {
                DoProgress(0, 0, "Preparing procedures", "");
                PrepareProcedures();
                DoProgress(0, 0, "Comparing functions", "");
                UpdateFunctions(UpdateFunctionsType.CreateNew);
                DoProgress(0, 0, "Comparing generators", "");
                UpdateGenerators();
                DoProgress(0, 0, "Comparing exceptions", "");
                UpdateExceptions();
                DoProgress(0, 0, "Comparing domains", "");
                UpdateDomains();
                DoProgress(0, 0, "Comparing tables", "");
                UpdateTables();
                DoProgress(0, 0, "Comparing indexes", "");
                UpdateIndexes();
                DoProgress(0, 0, "Comparing foreign keys", "");
                UpdateForeigns(UpdateForeignType.DropOld);
            }
            if ((uptype == UpdateType.OnlyForeign) ||
                (uptype == UpdateType.Full))
            {
                DoProgress(0, 0, "Comparing foreign keys", "");
                UpdateForeigns(UpdateForeignType.CreateNew);
            }
            if (uptype != UpdateType.OnlyForeign)
            {
                DoProgress(0, 0, "Comparing procedures", "");
                UpdateProcedures();
                DoProgress(0, 0, "Comparing Views", "");
                UpdateViews();
                DoProgress(0, 0, "Comparing Triggers", "");
                UpdateTriggers();
            }
            UpdateFunctions(UpdateFunctionsType.Remove);
            /*            DoProgress(0, 0, "Comparing Constraints", "");
                        UpdateConstraints();*/


        }
        public string FindMissingRecords(bool detailed)
        {
            StringBuilder nbuilder = new StringBuilder();
            OldDb.StartTransaction(IsolationLevel.Snapshot);
            try
            {
                NewDb.StartTransaction(IsolationLevel.Snapshot);
                try
                {

                    List<string> tables = new List<string>();
                    using (DataTable trelations = OldDb.OpenInmediate(null, "SELECT RDB$RELATION_NAME FROM RDB$RELATIONS WHERE RDB$SYSTEM_FLAG IS NULL OR RDB$SYSTEM_FLAG=0", "TABLES"))
                    {
                        foreach (DataRow xrow in trelations.Rows)
                        {
                            var tableName = xrow[0].ToString().Trim();
                            bool include = true;
                            if (this.OnFilterOldObject != null)
                            {
                                FbFilterObjectEventArgs args = new FbFilterObjectEventArgs(FbFilterObjectEventArgs.FbFilterObjectArgsType.Table, tableName, null);
                                OnFilterOldObject(this, args);
                                include = args.IncludeObject;
                            }
                            if (include)
                                tables.Add(tableName);
                        }
                    }

                    SortedList<string, List<string>> primaryKeys = new SortedList<string, List<string>>();

                    using (DataTable tprimarys = OldDb.OpenInmediate(null, "SELECT TRIM(RELC.RDB$RELATION_NAME) AS RELATION_NAME,RELC.RDB$CONSTRAINT_NAME," +
                        "RELC.RDB$CONSTRAINT_TYPE,RELC.RDB$INDEX_NAME," +
                        "TRIM(I.RDB$FIELD_NAME) AS FIELD_NAME,I.RDB$FIELD_POSITION" +
                        " FROM RDB$RELATION_CONSTRAINTS RELC" +
                        " LEFT OUTER JOIN RDB$INDEX_SEGMENTS I" +
                        " ON I.RDB$INDEX_NAME=RELC.RDB$INDEX_NAME" +
                        " WHERE (RELC.RDB$CONSTRAINT_TYPE = 'PRIMARY KEY' OR" +
                        " RELC.RDB$CONSTRAINT_TYPE = 'UNIQUE')" +
                        " ORDER BY RELC.RDB$RELATION_NAME,RELC.RDB$CONSTRAINT_NAME,I.RDB$FIELD_POSITION",
                          "PRIMARY_KEYS"))
                    {
                        foreach (DataRow xrow in tprimarys.Rows)
                        {
                            string tableName = xrow[0].ToString().Trim();
                            bool include = true;
                            if (this.OnFilterOldObject != null)
                            {
                                FbFilterObjectEventArgs args = new FbFilterObjectEventArgs(FbFilterObjectEventArgs.FbFilterObjectArgsType.Table, tableName, null);
                                OnFilterOldObject(this, args);
                                include = args.IncludeObject;
                            }
                            if (include)
                            {
                                if (primaryKeys.IndexOfKey(tableName) < 0)
                                {
                                    primaryKeys.Add(tableName, new List<string>());
                                }
                                primaryKeys[tableName].Add(xrow["FIELD_NAME"].ToString().Trim());
                            }
                        }
                    }
                    SortedList<string, List<DataRow>> relationFields = new SortedList<string, List<DataRow>>();
                    DataTable tfields = OldDb.OpenInmediate(null, "SELECT TRIM(R.RDB$RELATION_NAME) AS RELATION_NAME,TRIM(F.RDB$FIELD_NAME) AS FIELD_NAME," +
                        " F.RDB$COLLATION_ID AS COLLATION_ID,F.RDB$FIELD_POSITION AS FIELD_POSITION," +
                        " F.RDB$DEFAULT_SOURCE AS DEFAULT_SOURCE,F.RDB$NULL_FLAG AS NULL_FLAG," +
                        " D.RDB$VALIDATION_SOURCE AS VALIDATION_SOURCE,D.RDB$DEFAULT_SOURCE AS DEFAULT_SOURCE_DOMAIN," +
                        " D.RDB$NULL_FLAG AS NULL_FLAG_DOMAIN,D.RDB$COMPUTED_SOURCE AS COMPUTED_SOURCE," +
                        " D.RDB$COMPUTED_BLR,D.RDB$FIELD_NAME AS DOMAIN_NAME,D.RDB$SYSTEM_FLAG AS SYSTEM_FLAG," +
                        " D.RDB$FIELD_LENGTH AS FIELD_LENGTH,D.RDB$FIELD_SCALE AS FIELD_SCALE," +
                        " D.RDB$FIELD_TYPE AS FIELD_TYPE,D.RDB$FIELD_SUB_TYPE AS FIELD_SUB_TYPE," +
                        " D.RDB$SEGMENT_LENGTH AS SEG_LENGTH,D.RDB$CHARACTER_LENGTH AS CHARACTER_SIZE," +
                        " D.RDB$COLLATION_ID AS COLLATION_ID_DOMAIN,D.RDB$FIELD_PRECISION," +
                        " DIM.RDB$DIMENSION AS DIMENSION, " +
                        " DIM.RDB$LOWER_BOUND AS LOWER_BOUND,DIM.RDB$UPPER_BOUND AS UPPER_BOUND, " +
                        " CH.RDB$CHARACTER_SET_NAME AS CHARACTER_SET_NAME," +
                        " CO.RDB$COLLATION_NAME AS COLLATION_NAME," +
                        " CO2.RDB$COLLATION_NAME AS COLLATION_NAME_DOMAIN,R.RDB$OWNER_NAME,R.RDB$EXTERNAL_FILE" +
                        " FROM RDB$RELATIONS R" +
                        " LEFT OUTER JOIN RDB$RELATION_FIELDS F" +
                        " ON F.RDB$RELATION_NAME=R.RDB$RELATION_NAME" +
                        " LEFT OUTER JOIN RDB$FIELDS D" +
                        " ON F.RDB$FIELD_SOURCE=D.RDB$FIELD_NAME" +
                        " LEFT OUTER JOIN RDB$CHARACTER_SETS CH" +
                        " ON CH.RDB$CHARACTER_SET_ID=D.RDB$CHARACTER_SET_ID" +
                        " LEFT OUTER JOIN RDB$COLLATIONS CO" +
                        " ON CO.RDB$COLLATION_ID=F.RDB$COLLATION_ID AND CO.RDB$CHARACTER_SET_ID=D.RDB$CHARACTER_SET_ID" +
                        " LEFT OUTER JOIN RDB$COLLATIONS CO2" +
                        " ON CO2.RDB$COLLATION_ID=D.RDB$COLLATION_ID AND CO2.RDB$CHARACTER_SET_ID=D.RDB$CHARACTER_SET_ID" +
                        " LEFT OUTER JOIN RDB$FIELD_DIMENSIONS DIM " +
                        " ON DIM.RDB$FIELD_NAME=F.RDB$FIELD_NAME " +
                        " WHERE (R.RDB$SYSTEM_FLAG=0 OR (R.RDB$SYSTEM_FLAG IS NULL)) AND (RDB$VIEW_BLR IS NULL) " +
                        " ORDER BY R.RDB$RELATION_NAME,F.RDB$FIELD_POSITION", "FIELDS");
                    foreach (DataRow xrow in tfields.Rows)
                    {
                        string tableName = xrow[0].ToString();
                        bool include = true;
                        if (this.OnFilterOldObject != null)
                        {
                            FbFilterObjectEventArgs args = new FbFilterObjectEventArgs(FbFilterObjectEventArgs.FbFilterObjectArgsType.Table, tableName, null);
                            OnFilterOldObject(this, args);
                            include = args.IncludeObject;
                        }
                        if (include)
                        {
                            string fieldName = xrow["FIELD_NAME"].ToString().Trim();
                            if (this.OnFilterOldObject != null)
                            {
                                FbFilterObjectEventArgs args = new FbFilterObjectEventArgs(FbFilterObjectEventArgs.FbFilterObjectArgsType.Column, fieldName, tableName);
                                OnFilterOldObject(this, args);
                                include = args.IncludeObject;
                            }
                            if (include)
                            {
                                if (relationFields.IndexOfKey(tableName) < 0)
                                {
                                    relationFields.Add(tableName, new List<DataRow>());
                                }
                                relationFields[tableName].Add(xrow);
                            }
                        }
                    }
                    int idxTable = 0;
                    foreach (string tableName in primaryKeys.Keys)
                    {
                        idxTable++;
                        List<string> primarys = primaryKeys[tableName];
                        List<DataRow> fields = relationFields[tableName];
                        StringBuilder buildquery = new StringBuilder();
                        foreach (DataRow xrow in fields)
                        {
                            if (buildquery.Length > 0)
                                buildquery.Append(",");
                            else
                                buildquery.Append("SELECT ");
                            buildquery.Append(xrow["FIELD_NAME"].ToString().Trim());
                        }
                        string cadsql = buildquery.ToString() + " FROM " + tableName;
                        if (OnProgress != null)
                            OnProgress(this, new FbCompareProgressArgs(idxTable, primaryKeys.Count, 0, 0, "Reading origin table " + tableName, ""));
                        DataTable tableOld = OldDb.OpenInmediate(null, cadsql, tableName);
                        if (OnProgress != null)
                            OnProgress(this, new FbCompareProgressArgs(idxTable, primaryKeys.Count, 0, 0, "Reading destination table " + tableName, ""));
                        DataTable tableNew = NewDb.OpenInmediate(null, cadsql, tableName);
                        using (DataView viewNew = new DataView(tableNew, "", string.Join(",", primarys), DataViewRowState.CurrentRows))
                        {
                            object[] keys = new object[primarys.Count];
                            int idxRecord = 0;
                            int missing = 0;
                            foreach (DataRow xrow in tableOld.Rows)
                            {
                                for (int i = 0; i < primarys.Count; i++)
                                {
                                    keys[i] = xrow[primarys[i]];
                                }
                                DataRowView[] rfind = viewNew.FindRows(keys);
                                if (rfind.Length == 0)
                                {
                                    missing++;
                                    if (detailed)
                                    {
                                        nbuilder.Append("Record not found table: ");
                                        nbuilder.Append(tableName);
                                        for (int i = 0; i < primarys.Count; i++)
                                        {
                                            nbuilder.Append(" ");
                                            nbuilder.Append(primarys[i]);
                                            nbuilder.Append("=");
                                            nbuilder.Append(xrow[primarys[i]]);
                                        }
                                        nbuilder.AppendLine();
                                    }
                                }
                                if (idxRecord % 1000 == 0)
                                {
                                    if (OnProgress != null)
                                        OnProgress(this, new FbCompareProgressArgs(idxTable, primaryKeys.Count, idxRecord, tableOld.Rows.Count, "Searching rows for table " + tableName, "Record " + idxRecord.ToString("N2") + " of " + tableOld.Rows.Count.ToString("N0")));
                                }
                                idxRecord++;
                            }
                            if (missing > 0)
                            {
                                nbuilder.Append("Records not found table ");
                                nbuilder.Append(tableName);
                                nbuilder.Append(" records: ");
                                nbuilder.Append(missing.ToString("N0"));
                                nbuilder.Append(" total: " + tableOld.Rows.Count.ToString("N0") + " percent: " + ((decimal)missing / tableOld.Rows.Count * 100).ToString("N2") + "%");
                                nbuilder.AppendLine();
                            }
                        }
                        tableOld.Dispose();
                        tableNew.Dispose();
                    }
                }
                finally
                {
                    NewDb.Commit();
                }
            }
            finally
            {
                OldDb.Commit();
            }
            this.nresult = nbuilder;
            return nbuilder.ToString();
        }
        public string InsertTable(string tableName, string condition, string primaryfield, int primaryoffset)
        {
            StringBuilder nbuilder = new StringBuilder();
            OldDb.StartTransaction(IsolationLevel.Snapshot);
            try
            {
                NewDb.StartTransaction(IsolationLevel.Snapshot);
                try
                {

                    List<DataRow> relationFields = new List<DataRow>();
                    DataTable tfields = OldDb.OpenInmediate(null, "SELECT TRIM(R.RDB$RELATION_NAME) AS RELATION_NAME,TRIM(F.RDB$FIELD_NAME) AS FIELD_NAME," +
                        " F.RDB$COLLATION_ID AS COLLATION_ID,F.RDB$FIELD_POSITION AS FIELD_POSITION," +
                        " F.RDB$DEFAULT_SOURCE AS DEFAULT_SOURCE,F.RDB$NULL_FLAG AS NULL_FLAG," +
                        " D.RDB$VALIDATION_SOURCE AS VALIDATION_SOURCE,D.RDB$DEFAULT_SOURCE AS DEFAULT_SOURCE_DOMAIN," +
                        " D.RDB$NULL_FLAG AS NULL_FLAG_DOMAIN,D.RDB$COMPUTED_SOURCE AS COMPUTED_SOURCE," +
                        " D.RDB$COMPUTED_BLR,D.RDB$FIELD_NAME AS DOMAIN_NAME,D.RDB$SYSTEM_FLAG AS SYSTEM_FLAG," +
                        " D.RDB$FIELD_LENGTH AS FIELD_LENGTH,D.RDB$FIELD_SCALE AS FIELD_SCALE," +
                        " D.RDB$FIELD_TYPE AS FIELD_TYPE,D.RDB$FIELD_SUB_TYPE AS FIELD_SUB_TYPE," +
                        " D.RDB$SEGMENT_LENGTH AS SEG_LENGTH,D.RDB$CHARACTER_LENGTH AS CHARACTER_SIZE," +
                        " D.RDB$COLLATION_ID AS COLLATION_ID_DOMAIN,D.RDB$FIELD_PRECISION," +
                        " DIM.RDB$DIMENSION AS DIMENSION, " +
                        " DIM.RDB$LOWER_BOUND AS LOWER_BOUND,DIM.RDB$UPPER_BOUND AS UPPER_BOUND, " +
                        " CH.RDB$CHARACTER_SET_NAME AS CHARACTER_SET_NAME," +
                        " CO.RDB$COLLATION_NAME AS COLLATION_NAME," +
                        " CO2.RDB$COLLATION_NAME AS COLLATION_NAME_DOMAIN,R.RDB$OWNER_NAME,R.RDB$EXTERNAL_FILE" +
                        " FROM RDB$RELATIONS R" +
                        " LEFT OUTER JOIN RDB$RELATION_FIELDS F" +
                        " ON F.RDB$RELATION_NAME=R.RDB$RELATION_NAME" +
                        " LEFT OUTER JOIN RDB$FIELDS D" +
                        " ON F.RDB$FIELD_SOURCE=D.RDB$FIELD_NAME" +
                        " LEFT OUTER JOIN RDB$CHARACTER_SETS CH" +
                        " ON CH.RDB$CHARACTER_SET_ID=D.RDB$CHARACTER_SET_ID" +
                        " LEFT OUTER JOIN RDB$COLLATIONS CO" +
                        " ON CO.RDB$COLLATION_ID=F.RDB$COLLATION_ID AND CO.RDB$CHARACTER_SET_ID=D.RDB$CHARACTER_SET_ID" +
                        " LEFT OUTER JOIN RDB$COLLATIONS CO2" +
                        " ON CO2.RDB$COLLATION_ID=D.RDB$COLLATION_ID AND CO2.RDB$CHARACTER_SET_ID=D.RDB$CHARACTER_SET_ID" +
                        " LEFT OUTER JOIN RDB$FIELD_DIMENSIONS DIM " +
                        " ON DIM.RDB$FIELD_NAME=F.RDB$FIELD_NAME " +
                        " WHERE (R.RDB$SYSTEM_FLAG=0 OR (R.RDB$SYSTEM_FLAG IS NULL)) AND (RDB$VIEW_BLR IS NULL) " +
                        " AND R.RDB$RELATION_NAME=" + StringUtil.QuoteStr(tableName) +
                        " ORDER BY R.RDB$RELATION_NAME,F.RDB$FIELD_POSITION", "FIELDS");
                    foreach (DataRow xrow in tfields.Rows)
                    {
                        relationFields.Add(xrow);
                    }
                    StringBuilder buildquery = new StringBuilder();
                    StringBuilder campos = new StringBuilder();
                    StringBuilder parametros = new StringBuilder();
                    List<string> lcampos = new List<string>();
                    foreach (DataRow xrow in relationFields)
                    {
                        if (buildquery.Length > 0)
                        {
                            buildquery.Append(",");
                            campos.Append(",");
                            parametros.Append(",");
                        }
                        else
                        {
                            buildquery.Append("SELECT ");
                        }
                        lcampos.Add(xrow["FIELD_NAME"].ToString().Trim());
                        buildquery.Append(xrow["FIELD_NAME"].ToString().Trim());
                        campos.Append(xrow["FIELD_NAME"].ToString().Trim());
                        parametros.Append("@" + xrow["FIELD_NAME"].ToString().Trim());
                    }
                    string cadsql = buildquery.ToString() + " FROM " + tableName;
                    if (condition != null)
                        cadsql = cadsql + " " + condition;
                    if (OnProgress != null)
                        OnProgress(this, new FbCompareProgressArgs(0, 0, 0, 0, "Reading origin table " + tableName, ""));
                    DataTable tableOld = OldDb.OpenInmediate(null, cadsql, tableName);
                    int idxRecord = 0;
                    string isql = "INSERT INTO " + tableName + " (" + campos.ToString() + ") VALUES (" + parametros.ToString() + ")";
                    var command = NewDb.CreateCommand(isql);
                    foreach (DataColumn ncol in tableOld.Columns)
                    {
                        var param = command.CreateParameter();
                        param.ParameterName = ncol.ColumnName;
                        param.DbType = DataUtilities.TypeToDbType(ncol.DataType);
                        command.Parameters.Add(param);
                    }
                    foreach (DataRow xrow in tableOld.Rows)
                    {
                        if (idxRecord % 1000 == 0)
                        {
                            if (OnProgress != null)
                                OnProgress(this, new FbCompareProgressArgs(1, 2, idxRecord, tableOld.Rows.Count, "Searching rows for table " + tableName, "Record " + idxRecord.ToString("N2") + " of " + tableOld.Rows.Count.ToString("N0")));
                        }
                        if (primaryfield.Length > 0)
                            xrow[primaryfield] = Convert.ToInt32(xrow[primaryfield]) + primaryoffset;
                        foreach (DataColumn ncol in tableOld.Columns)
                        {
                            var param = command.Parameters[ncol.ColumnName];
                            param.Value = DBNull.Value;
                            object valor = xrow[ncol.ColumnName];
                            if ((valor != DBNull.Value) && (ncol.ColumnName != "ALBARAN")
                                && (ncol.ColumnName != "COD_CITA_USUARIO")
                                && (ncol.ColumnName != "COD_TAREA")
                                && (ncol.ColumnName != "PRESUPUESTO")
                                )
                                param.Value = valor;
                        }
                        NewDb.Execute(command);
                        NewDb.Flush();
                        idxRecord++;
                    }
                    NewDb.Commit();
                }
                catch
                {
                    NewDb.Rollback();
                    throw;
                }
            }
            finally
            {
                OldDb.Commit();
            }
            this.nresult = nbuilder;
            return nbuilder.ToString();
        }

        public string ValidateContent(FirebirdSql.Data.FirebirdClient.FbConnection connectionold,
             FirebirdSql.Data.FirebirdClient.FbConnection connectionnew,
             System.Data.Common.DbTransaction transactionold,
            System.Data.Common.DbTransaction transactionnew)
        {
            StringBuilder nbuilder = new StringBuilder();

            System.Data.Common.DbCommand commandold = FirebirdSql.Data.FirebirdClient.FirebirdClientFactory.Instance.CreateCommand();
            commandold.Connection = connectionold;
            commandold.Transaction = transactionold;

            System.Data.Common.DbCommand commandnew = FirebirdSql.Data.FirebirdClient.FirebirdClientFactory.Instance.CreateCommand();
            commandnew.Connection = connectionnew;
            commandnew.Transaction = transactionnew;
            // Compare data
            int idx = 0;
            foreach (string tablename in PrimaryKeysNew.Keys)
            {
                idx++;
                DoProgress(idx, PrimaryKeysNew.Count, 0, 1, "Comparing table " + tablename, "");
                List<string> PrimFields = PrimaryKeysNew[tablename];
                string orderby = "";
                foreach (string primfield in PrimFields)
                {
                    if (orderby.Length != 0)
                        orderby = orderby + ",";
                    orderby = orderby + FbExtract.QuoteIdentifier(primfield, dialect);
                }
                StringBuilder fieldsstring = new StringBuilder();
                DataRowView[] fieldsarray = viewrelationfieldsnew.FindRows(tablename);
                foreach (DataRowView fieldr in fieldsarray)
                {
                    if (fieldsstring.Length != 0)
                        fieldsstring.Append(",");
                    fieldsstring.Append(FbExtract.QuoteIdentifier(fieldr["FIELD"].ToString(), dialect));
                }
                bool datafound = true;
                bool diferent_content = false;
                while ((datafound) && (!diferent_content))
                {
                    int reccount = 0;
                    string cadenasql = "SELECT " + fieldsstring + " FROM " +
                        FbExtract.QuoteIdentifier(tablename, dialect) +
                     " ORDER BY " + orderby;
                    commandnew.CommandText = cadenasql;
                    commandold.CommandText = cadenasql;
                    using (System.Data.Common.DbDataReader nreadernew = commandnew.ExecuteReader())
                    {
                        DateTime mmfirst = System.DateTime.Now;
                        using (System.Data.Common.DbDataReader nreaderold = commandold.ExecuteReader())
                        {
                            bool readedold = nreaderold.Read();
                            bool readednew = nreadernew.Read();
                            if (readedold != readednew)
                            {
                                diferent_content = true;
                            }
                            while (readedold)
                            {
                                reccount++;
                                //nreaderold.GetValues(valuesold);
                                //nreaderold.GetValues(valuesnew);

                                for (int i = 0; i < nreaderold.FieldCount; i++)
                                {
                                    object value1 = nreadernew[i];
                                    object value2 = nreaderold[i];
                                    if (!value1.Equals(value2))
                                    {
                                        if ((value1 is byte[]) && (value2 is byte[]))
                                        {
                                            diferent_content = !ByteArrayCompare((byte[])value1, (byte[])value2);
                                            if (diferent_content)
                                                break;
                                        }
                                        else
                                        {
                                            diferent_content = true;
                                            break;
                                        }
                                    }
                                }

                                readedold = nreaderold.Read();
                                readednew = nreadernew.Read();
                                if (diferent_content)
                                    break;

                                DateTime mmlast = System.DateTime.Now;
                                if ((mmlast - mmfirst).TotalSeconds > 1)
                                {
                                    DoProgress(idx, PrimaryKeysNew.Count, 0, 1, "Comparing table " + tablename, "Compared " + reccount.ToString("N0") + " records ");
                                    mmfirst = System.DateTime.Now;
                                }
                            }
                            datafound = false;
                        }
                    }

                }
                if (diferent_content)
                    nbuilder.Append("TABLE CONTENT " + tablename + " IS DIFERENT ");
            }
            return nbuilder.ToString();
        }
        private void UpdateGenerators()
        {
            DataTable oldgenerators = OldData.Tables["GENERATORS"];
            DataTable newgenerators = NewData.Tables["GENERATORS"];
            foreach (DataRow orirow in newgenerators.Rows)
            {
                string fname = orirow["NAME"].ToString();
                DataRow destrow = oldgenerators.Rows.Find(fname);
                if (destrow == null)
                {
                    AddSentence(orirow["SOURCE"].ToString());
                }
                else
                {
                    if (orirow["SOURCE"].ToString() != destrow["SOURCE"].ToString())
                    {
                        DropGenerator(fname);
                        AddSentence(orirow["SOURCE"].ToString());
                    }
                }
            }
            foreach (DataRow oldrow in oldgenerators.Rows)
            {
                string fname = oldrow["NAME"].ToString();
                DataRow newrow = newgenerators.Rows.Find(fname);
                if (newrow == null)
                {
                    DropGenerator(fname);
                }
            }
        }
        private void UpdateExceptions()
        {
            DataTable oldexceptions = OldData.Tables["EXCEPTIONS"];
            DataTable newexceptions = NewData.Tables["EXCEPTIONS"];
            foreach (DataRow orirow in newexceptions.Rows)
            {
                string fname = orirow["NAME"].ToString();
                DataRow destrow = oldexceptions.Rows.Find(fname);
                if (destrow == null)
                {
                    AddSentence(orirow["SOURCE"].ToString());
                }
                else
                {
                    if (orirow["SOURCE"].ToString() != destrow["SOURCE"].ToString())
                    {
                        DropException(fname);
                        AddSentence(orirow["SOURCE"].ToString());
                    }
                }
            }
            foreach (DataRow oldrow in oldexceptions.Rows)
            {
                string fname = oldrow["NAME"].ToString();
                DataRow newrow = newexceptions.Rows.Find(fname);
                if (newrow == null)
                {
                    DropException(fname);
                }
            }
        }
        enum UpdateFunctionsType { CreateNew, Remove };
        private void UpdateFunctions(UpdateFunctionsType ntype)
        {
            DataTable oldfunctions = OldData.Tables["FUNCTIONS"];
            DataTable newfunctions = NewData.Tables["FUNCTIONS"];
            switch (ntype)
            {
                case UpdateFunctionsType.CreateNew:
                    bool term_added = false;
                    foreach (DataRow orirow in newfunctions.Rows)
                    {
                        string fname = orirow["NAME"].ToString();
                        DataRow destrow = oldfunctions.Rows.Find(fname);
                        if (destrow == null)
                        {
                            if ((!term_added) && (!UpdateDestination))
                            {
                                AddSentence("SET TERM ^", ";");
                                term_added = true;
                            }
                            if (term_added)
                                AddSentence(orirow["SOURCE"].ToString(), "^");
                            else
                                AddSentence(orirow["SOURCE"].ToString(), "");
                        }
                        else
                        {
                            if (orirow["SOURCE"].ToString() != destrow["SOURCE"].ToString())
                            {
                                string newsource = orirow["SOURCE"].ToString();
                                newsource = newsource.Substring(7, newsource.Length - 7);
                                newsource = "ALTER " + newsource;
                                if ((!term_added) && (!UpdateDestination))
                                {
                                    AddSentence("SET TERM ^", ";");
                                    term_added = true;
                                }
                                //DropProcedure(fname,false);
                                if (term_added)
                                    AddSentence(newsource, "^");
                                else
                                    AddSentence(newsource, "");
                            }
                        }
                    }
                    if (term_added)
                        AddSentence("SET TERM ;", "^");
                    break;
                case UpdateFunctionsType.Remove:
                    foreach (DataRow oldrow in oldfunctions.Rows)
                    {
                        string fname = oldrow["NAME"].ToString();
                        DataRow newrow = newfunctions.Rows.Find(fname);
                        if (newrow == null)
                        {
                            DropFunction(fname);
                        }
                    }
                    break;
            }
        }
        private void UpdateDomains()
        {
            DataTable olddomains = OldData.Tables["DOMAINS"];
            DataTable newdomains = NewData.Tables["DOMAINS"];
            foreach (DataRow orirow in newdomains.Rows)
            {
                string fname = orirow["NAME"].ToString();
                DataRow destrow = olddomains.Rows.Find(fname);
                if (destrow == null)
                {
                    AddSentence(orirow["SOURCE"].ToString());
                }
                else
                {
                    if (orirow["SOURCE"].ToString() != destrow["SOURCE"].ToString())
                    {
                        // Alter the domain
                        AddComment("Can not update domain - Updated domain: " + orirow["SOURCE"].ToString() + " Old domain: " + destrow["SOURCE"].ToString());
                    }
                }
            }
            foreach (DataRow oldrow in olddomains.Rows)
            {
                string fname = oldrow["NAME"].ToString();
                DataRow newrow = newdomains.Rows.Find(fname);
                if (newrow == null)
                {
                    DropDomain(fname);
                }
            }
        }
        private void UpdateIndexes()
        {
            DataTable oldindices = OldData.Tables["INDICES"];
            DataTable newindices = NewData.Tables["INDICES"];
            foreach (DataRow orirow in newindices.Rows)
            {
                string fname = orirow["NAME"].ToString();
                DataRow destrow = oldindices.Rows.Find(fname);
                if (destrow == null)
                {
                    AddSentence(orirow["SOURCE"].ToString());
                }
                else
                {
                    if (orirow["SOURCE"].ToString() != destrow["SOURCE"].ToString())
                    {
                        string indexsource = orirow["SOURCE"].ToString();
                        DropIndex(fname, indexsource, true);
                        AddSentence(indexsource);
                    }
                }
            }
            foreach (DataRow oldrow in oldindices.Rows)
            {
                string fname = oldrow["NAME"].ToString();
                DataRow newrow = newindices.Rows.Find(fname);
                string indexsource = oldrow["SOURCE"].ToString();
                if (newrow == null)
                {
                    DropIndex(fname, indexsource, false);
                }
            }
        }
        enum UpdateForeignType { DropOld, CreateNew };
        private void UpdateForeigns(UpdateForeignType updateforeign_type)
        {
            DataTable oldforeigns = OldData.Tables["FOREIGNS"];
            DataTable newforeigns = NewData.Tables["FOREIGNS"];
            DataView vnewforeigns = new DataView(newforeigns, "SYSTEM_NAME=true", "SOURCE", DataViewRowState.CurrentRows);
            DataView voldforeigns = new DataView(oldforeigns, "SYSTEM_NAME=true", "SOURCE", DataViewRowState.CurrentRows);
            foreach (DataRow orirow in newforeigns.Rows)
            {
                if (Convert.ToBoolean(orirow["SYSTEM_NAME"]))
                {
                    DataRowView[] destvrows = vnewforeigns.FindRows(orirow["SOURCE"]);
                    if (destvrows.Length == 0)
                    {
                        if (updateforeign_type == UpdateForeignType.CreateNew)
                            AddSentence(orirow["SOURCE"].ToString());
                    }
                }
                else
                {
                    string fname = orirow["NAME"].ToString();
                    DataRow destrow = oldforeigns.Rows.Find(fname);
                    if (destrow == null)
                    {
                        if (updateforeign_type == UpdateForeignType.CreateNew)
                            AddSentence(orirow["SOURCE"].ToString());
                    }
                    else
                    {
                        if (updateforeign_type == UpdateForeignType.DropOld)
                        {
                            if (orirow["SOURCE"].ToString() != destrow["SOURCE"].ToString())
                            {
                                string tablename = orirow["TABLE"].ToString();
                                DropForeign(fname, tablename, true);
                                AddSentence(orirow["SOURCE"].ToString());
                            }
                        }
                    }
                }
            }
            if (updateforeign_type == UpdateForeignType.DropOld)
            {
                foreach (DataRow oldrow in oldforeigns.Rows)
                {
                    if (Convert.ToBoolean(oldrow["SYSTEM_NAME"]))
                    {
                        DataRowView[] orivrows = vnewforeigns.FindRows(oldrow["SOURCE"]);
                        if (orivrows.Length == 0)
                        {
                            string tablename = oldrow["TABLE"].ToString();
                            string fname = oldrow["NAME"].ToString();
                            DropForeign(fname, tablename, true);
                            //DropForeign(fname, tablename, false);
                        }
                    }
                    else
                    {
                        string fname = oldrow["NAME"].ToString();
                        DataRow newrow = newforeigns.Rows.Find(fname);
                        if (newrow == null)
                        {
                            string tablename = oldrow["TABLE"].ToString();
                            //DropForeign(fname, tablename,false);
                            DropForeign(fname, tablename, true);
                        }
                    }
                }
            }
        }
        private void UpdateViews()
        {
            DataTable oldforeigns = OldData.Tables["VIEWS"];
            DataTable newforeigns = NewData.Tables["VIEWS"];
            foreach (DataRow orirow in newforeigns.Rows)
            {
                string fname = orirow["NAME"].ToString();
                DataRow destrow = oldforeigns.Rows.Find(fname);
                if (destrow == null)
                {
                    AddSentence(orirow["SOURCE"].ToString());
                }
                else
                {
                    char[] chars = new char[1];
                    chars[0] = ';';
                    if (orirow["SOURCE"].ToString().TrimEnd(chars) != destrow["SOURCE"].ToString().TrimEnd(chars))
                    {
                        string tablename = orirow["TABLE"].ToString();
                        DropView(fname, tablename, true);
                        AddSentence(orirow["SOURCE"].ToString());
                    }
                }
            }
            foreach (DataRow oldrow in oldforeigns.Rows)
            {
                string fname = oldrow["NAME"].ToString();
                DataRow newrow = newforeigns.Rows.Find(fname);
                if (newrow == null)
                {
                    string tablename = oldrow["TABLE"].ToString();
                    DropView(fname, tablename, false);
                }
            }
        }
        public SortedList<string, string> GetUpdatedTriggers()
        {
            SortedList<string, string> nlist = new SortedList<string, string>();
            DataTable newforeigns = NewData.Tables["TRIGGERS"];
            foreach (DataRow orirow in newforeigns.Rows)
            {
                string fname = orirow["NAME"].ToString();
                string source = orirow["SOURCE"].ToString();
                nlist.Add(fname, source);
            }
            return nlist;
        }

        private void UpdateTriggers()
        {
            DataTable oldforeigns = OldData.Tables["TRIGGERS"];
            DataTable newforeigns = NewData.Tables["TRIGGERS"];
            foreach (DataRow orirow in newforeigns.Rows)
            {
                string fname = orirow["NAME"].ToString();
                DataRow destrow = oldforeigns.Rows.Find(fname);
                if (destrow == null)
                {
                    if (!UpdateDestination)
                        AddSentence("SET TERM ^", ";");
                    if (UpdateDestination)
                        AddSentence(orirow["SOURCE"].ToString(), "");
                    else
                        AddSentence(orirow["SOURCE"].ToString(), "^");
                    if (!UpdateDestination)
                        AddSentence("SET TERM ;", "^");
                }
                else
                {
                    if (orirow["SOURCE"].ToString() != destrow["SOURCE"].ToString())
                    {
                        string tablename = orirow["TABLE"].ToString();
                        DropTrigger(fname, tablename, true);
                        if (!UpdateDestination)
                            AddSentence("SET TERM ^", ";");
                        if (UpdateDestination)
                            AddSentence(orirow["SOURCE"].ToString(), "");
                        else
                            AddSentence(orirow["SOURCE"].ToString(), "^");
                        if (!UpdateDestination)
                            AddSentence("SET TERM ;", "^");
                    }
                }
            }
            foreach (DataRow oldrow in oldforeigns.Rows)
            {
                string fname = oldrow["NAME"].ToString();
                DataRow newrow = newforeigns.Rows.Find(fname);
                if (newrow == null)
                {
                    string tablename = oldrow["TABLE"].ToString();
                    DropTrigger(fname, tablename, false);
                }
            }
        }
        private void UpdateProcedures()
        {
            bool term_added = false;
            DataTable oldprocedures = OldData.Tables["PROCEDURES"];
            DataTable newprocedures = NewData.Tables["PROCEDURES"];
            foreach (DataRow orirow in newprocedures.Rows)
            {
                string fname = orirow["NAME"].ToString();
                DataRow destrow = oldprocedures.Rows.Find(fname);
                if (destrow == null)
                {
                    if ((!term_added) && (!UpdateDestination))
                    {
                        AddSentence("SET TERM ^", ";");
                        term_added = true;
                    }
                    if (term_added)
                        AddSentence(orirow["SOURCE"].ToString(), "^");
                    else
                        AddSentence(orirow["SOURCE"].ToString(), "");
                }
                else
                {
                    if (orirow["SOURCE"].ToString().Trim() != destrow["SOURCE"].ToString().Trim())
                    {
                        if ((!term_added) && (!UpdateDestination))
                        {
                            AddSentence("SET TERM ^", ";");
                            term_added = true;
                        }
                        //DropProcedure(fname,false);
                        if (term_added)
                            AddSentence(orirow["SOURCE"].ToString(), "^");
                        else
                            AddSentence(orirow["SOURCE"].ToString(), "");
                    }
                }
            }
            if (term_added)
                AddSentence("SET TERM ;", "^");
            foreach (DataRow oldrow in oldprocedures.Rows)
            {
                string fname = oldrow["NAME"].ToString();
                DataRow newrow = newprocedures.Rows.Find(fname);
                if (newrow == null)
                {
                    DropProcedure(fname, false);
                }
            }
        }
        private void UpdateTable(string tablename)
        {
            DataRowView[] updatedfields = viewrelationfieldsnew.FindRows(tablename);
            DataRowView[] oldfields = viewrelationfieldsold.FindRows(tablename);
            object[] obkey = new object[2];
            // First Add new fields
            int addedfields = 0;
            foreach (DataRowView upvrow in updatedfields)
            {
                DataRow uprow = upvrow.Row;
                string fieldname = uprow["FIELD"].ToString();
                obkey[0] = tablename;
                obkey[1] = fieldname;
                DataRowView[] oldvrow = viewrelationfieldsolddet.FindRows(obkey);
                if (oldvrow.Length == 0)
                {
                    AddSentence("ALTER TABLE " + FbExtract.QuoteIdentifier(tablename, dialect) + " ADD " +
                       FbExtract.QuoteIdentifier(fieldname, dialect) + " " + uprow["SOURCE"].ToString());
                    DataRow nrow = viewrelationfieldsold.Table.NewRow();
                    nrow["TABLE"] = tablename;
                    nrow["FIELD"] = fieldname;
                    nrow["SOURCE"] = uprow["SOURCE"];
                    nrow["POSITION"] = oldfields.Length + addedfields;
                    addedfields++;
                    viewrelationfieldsold.Table.Rows.Add(nrow);
                }
            }
            // Second reorder position if needed
            // Renumerate old fields to remove spaces between field positions
            int newpos = 1;
            foreach (DataRowView upvrow in updatedfields)
            {
                upvrow["POSITION"] = newpos;
                newpos++;
            }

            foreach (DataRowView upvrow in updatedfields)
            {
                DataRow uprow = upvrow.Row;
                int newposition = System.Convert.ToInt32(uprow["POSITION"]);
                string fieldname = uprow["FIELD"].ToString();
                obkey[0] = tablename;
                obkey[1] = fieldname;
                DataRowView[] oldvrow = viewrelationfieldsolddet.FindRows(obkey);
                int oldposition = System.Convert.ToInt32(oldvrow[0]["POSITION"]) + 1;
                if ((oldposition != newposition) && (validate_column_order))
                {
                    AddSentence("ALTER TABLE " + FbExtract.QuoteIdentifier(tablename, dialect) + " ALTER COLUMN " +
                       FbExtract.QuoteIdentifier(fieldname, dialect) + " POSITION " + newposition.ToString());
                    oldposition = newposition;
                }
                string oldsource = oldvrow[0]["SOURCE"].ToString();
                string newsource = uprow["SOURCE"].ToString();
                if (oldsource != newsource)
                {
                    if (UpdateDestination)
                    {
                        try
                        {
                            AddSentence("ALTER TABLE " + FbExtract.QuoteIdentifier(tablename, dialect) + " ALTER COLUMN " +
                               FbExtract.QuoteIdentifier(fieldname, dialect) + " TYPE " + newsource, false);
                        }
                        catch
                        {
                            // select RDB$DEPENDED_ON_NAME from RDB$DEPENDENCIES where RDB$FIELD_NAME='PRECIO_UD'
                            // and RDB$DEPENDED_ON_NAME = 'LINALMAC' and RDB$DEPENDED_ON_TYPE = 0
                            object[] viewKey = new object[3];
                            viewKey[0] = tablename;
                            viewKey[1] = fieldname;
                            viewKey[2] = 0;
                            DataRowView[] rview = viewdependedonnamecolumn.FindRows(viewKey);
                            foreach (DataRowView rv in rview)
                            {
                                string depname = rv["DEPENDENT_NAME"].ToString();
                                string deponname = rv["DEPENDED_ON_NAME"].ToString();
                                int deptype = Convert.ToInt32(rv["DEPENDENT_TYPE"]);
                                int depenontype = Convert.ToInt32(rv["DEPENDED_ON_TYPE"]);
                                DropDependence(depname, deponname, deptype, depenontype);
                            }
                            object[] viewKey2 = new object[2];
                            viewKey2[0] = tablename;
                            viewKey2[1] = fieldname;
                            DataRowView[] rviewIndicesDetail = viewIndicesDetail.FindRows(viewKey2);
                            foreach (DataRowView rvi in rviewIndicesDetail)
                            {
                                DataRowView[] rviewIndices = viewIndices.FindRows(rvi["RDB$INDEX_NAME"].ToString());
                                string indexsource = rviewIndices[0].Row["SOURCE"].ToString();

                                DropIndex(rvi["RDB$INDEX_NAME"].ToString(), indexsource, true);
                            }

                            AddSentence("ALTER TABLE " + FbExtract.QuoteIdentifier(tablename, dialect) + " ADD " +
                                   FbExtract.QuoteIdentifier(fieldname + "__", dialect) + " " + newsource, false);
                            AddSentence("UPDATE " + FbExtract.QuoteIdentifier(tablename, dialect) + " SET " +
                                   FbExtract.QuoteIdentifier(fieldname + "__", dialect) + "=" +
                                   FbExtract.QuoteIdentifier(fieldname, dialect), false);
                            AddSentence("ALTER TABLE " + FbExtract.QuoteIdentifier(tablename, dialect) + " DROP " +
                                   FbExtract.QuoteIdentifier(fieldname, dialect), false);
                            AddSentence("ALTER TABLE " + FbExtract.QuoteIdentifier(tablename, dialect) + " ADD " +
                               FbExtract.QuoteIdentifier(fieldname, dialect) + " " + newsource, true);
                            AddSentence("UPDATE " + FbExtract.QuoteIdentifier(tablename, dialect) + " SET " +
                                   FbExtract.QuoteIdentifier(fieldname, dialect) + "=" +
                                   FbExtract.QuoteIdentifier(fieldname + "__", dialect), false);
                            AddSentence("ALTER TABLE " + FbExtract.QuoteIdentifier(tablename, dialect) + " DROP " +
                                   FbExtract.QuoteIdentifier(fieldname + "__", dialect), false);
                            AddSentence("ALTER TABLE " + FbExtract.QuoteIdentifier(tablename, dialect) + " ALTER COLUMN " +
                               FbExtract.QuoteIdentifier(fieldname, dialect) + " POSITION " + oldposition.ToString());
                        }
                    }
                    else
                    {
                        AddSentence("ALTER TABLE " + FbExtract.QuoteIdentifier(tablename, dialect) + " ALTER COLUMN " +
                           FbExtract.QuoteIdentifier(fieldname, dialect) + " TYPE " + newsource, true);
                    }
                }
            }
            // Inform old fields not in new fields (do not delete)
            foreach (DataRowView oldvrow in oldfields)
            {
                DataRow oldrow = oldvrow.Row;
                string fieldname = oldrow["FIELD"].ToString();
                obkey[0] = tablename;
                obkey[1] = fieldname;
                DataRowView[] newvrow = viewrelationfieldsnewdet.FindRows(obkey);
                if (newvrow.Length == 0)
                {
                    AddComment("Field not found in updated db - Table:" + tablename + " Field:" + fieldname);
                }
            }
        }
        private void UpdateTables()
        {
            DataTable oldtables = OldData.Tables["TABLES"];
            DataTable newtables = NewData.Tables["TABLES"];
            foreach (DataRow orirow in newtables.Rows)
            {
                string fname = orirow["NAME"].ToString();
                DataRow destrow = oldtables.Rows.Find(fname);
                if (destrow == null)
                {
                    AddSentence(orirow["SOURCE"].ToString(), "");
                }
                else
                {
                    if (orirow["SOURCE"].ToString() != destrow["SOURCE"].ToString())
                    {
                        // Alter the fitelds table
                        UpdateTable(fname);
                    }
                }
            }
            foreach (DataRow oldrow in oldtables.Rows)
            {
                string fname = oldrow["NAME"].ToString();
                DataRow newrow = newtables.Rows.Find(fname);
                if (newrow == null)
                {
                    DropTable(fname);
                }
            }
        }
        private void PrepareProcedures()
        {
            SortedList<string, string> newlist = new SortedList<string, string>();
            SortedList<string, string> oldlist = new SortedList<string, string>();

            DataTable oldtable = OldData.Tables["PROCEDURES"];
            foreach (DataRow xrow in oldtable.Rows)
            {
                oldlist.Add(xrow["NAME"].ToString(), xrow["SOURCE"].ToString());
            }
            DataTable newtable = NewData.Tables["PROCEDURES"];
            foreach (DataRow xrow in newtable.Rows)
            {
                newlist.Add(xrow["NAME"].ToString(), xrow["SOURCE"].ToString());
            }
            // Drop procedures not found on new db
            foreach (string procname in oldlist.Keys)
            {
                if (newlist.IndexOfKey(procname) < 0)
                    DropProcedure(procname, false);
            }
            // Drop procedures not equal
            foreach (string procname in newlist.Keys)
            {
                if (oldlist.IndexOfKey(procname) >= 0)
                {
                    if (newlist[procname] != oldlist[procname])
                    {
                        DropProcedure(procname, true);
                    }
                }
            }
        }
        private void DropProcedure(string procname, bool force)
        {
            if (force)
                DropDependence(procname, "", 5, 0);
            else
            {
                AddComment("Procedure not droped: " + procname);
            }
        }
        private void DropGenerator(string genname)
        {
            DropDependence(genname, "", 14, 0);
        }
        private void DropException(string exname)
        {
            DropDependence(exname, "", 7, 0);
        }
        private void DropFunction(string funcname)
        {
            DropDependence(funcname, "", 15, 0);
        }
        private void DropDomain(string domname)
        {
            AddComment("Domain not dropped: " + domname);
        }
        private void DropIndex(string indexname, string sourcename, bool force)
        {
            if (force)
                DropDependence(indexname, "", 6, 0);
            else
                AddComment("Index not dropped: " + indexname + " : " + sourcename);
        }
        private void DropForeign(string fname, string tablename, bool force)
        {
            if (force)
                AddSentence("ALTER TABLE " + FbExtract.QuoteIdentifier(tablename, dialect) + " DROP CONSTRAINT " +
                     FbExtract.QuoteIdentifier(fname, dialect));
            else
                AddComment("Foreign key not dropped: " + fname + " for table " + tablename);
        }
        private void DropTrigger(string fname, string tablename, bool force)
        {
            if (force)
                DropDependence(fname, "", 2, 0);
            else
                AddComment("Trigger not dropped: " + fname + " for table " + tablename);
        }
        private void DropView(string fname, string tablename, bool force)
        {
            if (force)
                DropDependence(fname, "", 1, 0);
            else
                AddComment("View not dropped: " + fname + " for table " + tablename);
        }
        private void DropTable(string tabname)
        {
            // Check dependences
            AddComment("Table not dropped: " + tabname);
        }
        private string GenerateDepID(string dependent_name, string depended_on_name,
                int dependent_type, int depended_on_type)
        {
            return dependent_name.PadLeft(31, '*') + depended_on_name.PadLeft(31, '*') + dependent_type.ToString("000") +
              depended_on_type.ToString("000");
        }
        private void DropDependence(string dependent_name, string depended_on_name,
            int dependent_type, int depended_on_type)
        {
            dependent_name = dependent_name.Trim();
            depended_on_name = depended_on_name.Trim();
            string depid = GenerateDepID(dependent_name,
                depended_on_name, dependent_type, depended_on_type);
            // Already removed?
            if (removeddeps.IndexOfKey(depid) >= 0)
                return;
            DataRowView[] resultview = null;
            switch (dependent_type)
            {
                // Stored procedure
                case 5:
                case 2:
                case 1:
                case 3:
                case 7:
                case 6:
                case 10:
                case 14:
                case 15:
                    resultview = viewdependedonname.FindRows(dependent_name);
                    break;
            }
            if (resultview != null)
            {
                foreach (DataRowView nrv in resultview)
                {
                    string dependent_name_row = nrv["DEPENDENT_NAME"].ToString();
                    string depended_on_name_row = nrv["DEPENDED_ON_NAME"].ToString();
                    if (depended_on_name_row != dependent_name_row)
                        DropDependence(dependent_name_row,
                        depended_on_name_row,
                        System.Convert.ToInt32(nrv["DEPENDENT_TYPE"]),
                        System.Convert.ToInt32(nrv["DEPENDED_ON_TYPE"]));
                }
            }
            int index = 0;
            string asql = "";
            switch (dependent_type)
            {
                // Trigger
                case 2:
                    index = removedtrig.IndexOfKey(dependent_name);
                    if (index < 0)
                    {
                        asql = "DROP TRIGGER " + FbExtract.QuoteIdentifier(dependent_name, dialect);
                        removedtrig.Add(dependent_name, asql);
                    }
                    break;
                case 3:
                    // Construir DROP FIELD
                    break;
                case 1:
                    index = removedviews.IndexOfKey(dependent_name);
                    if (index < 0)
                    {
                        asql = "DROP VIEW " + FbExtract.QuoteIdentifier(dependent_name, dialect);
                        removedviews.Add(dependent_name, asql);

                    }
                    break;
                case 5:
                    index = removedprocs.IndexOfKey(dependent_name);
                    if (index < 0)
                    {
                        asql = "DROP PROCEDURE " + FbExtract.QuoteIdentifier(dependent_name, dialect);
                        removedprocs.Add(dependent_name, asql);
                    }
                    break;
                case 14:
                    index = removedgens.IndexOfKey(dependent_name);
                    if (index < 0)
                    {
                        asql = "DROP GENERATOR " + FbExtract.QuoteIdentifier(dependent_name, dialect);
                        removedgens.Add(dependent_name, asql);
                    }
                    break;
                case 15:
                    index = removedfuncs.IndexOfKey(dependent_name);
                    if (index < 0)
                    {
                        asql = "DROP EXTERNAL FUNCTION " + FbExtract.QuoteIdentifier(dependent_name, dialect);
                        removedfuncs.Add(dependent_name, asql);
                    }
                    break;
                case 10:
                case 6:
                    index = removedindexes.IndexOfKey(dependent_name);
                    if (index < 0)
                    {
                        asql = "DROP INDEX " + FbExtract.QuoteIdentifier(dependent_name, dialect);
                        removedindexes.Add(dependent_name, asql);
                    }
                    break;
                case 7:
                    index = removedexceptions.IndexOfKey(dependent_name);
                    if (index < 0)
                    {
                        asql = "DROP EXCEPTION " + FbExtract.QuoteIdentifier(dependent_name, dialect);
                        removedexceptions.Add(dependent_name, asql);
                    }
                    break;
            }
            if (asql.Length > 0)
            {
                removeddeps.Add(depid, depid);
                AddSentence(asql);
            }
        }

        private void DoProgress(int count1, int max1, int count2, int max2, string message1, string message2)
        {
            if (DetailedFlush)
            {
                if (FCompareStep == CompareStep.Reading)
                {
                    OldDb.Flush();
                    NewDb.Flush();
                }
            }
            if (OnProgress != null)
            {
                FbCompareProgressArgs nargs = new FbCompareProgressArgs(count1, max1, count2, max2, message1, message2);
                OnProgress(this, nargs);
                if (nargs.Cancel)
                    throw new Exception("Operation Cancelled");
            }
        }
        private void DoProgress(int count2, int max2, string message1, string message2)
        {
            CurrentProgress++;
            if (DetailedFlush)
            {
                if (FCompareStep == CompareStep.Reading)
                {
                    OldDb.Flush();
                    NewDb.Flush();
                }
            }
            if (OnProgress != null)
            {
                FbCompareProgressArgs nargs = new FbCompareProgressArgs(CurrentProgress, MAX_PROGRESS, count2, max2, message1, message2);
                OnProgress(this, nargs);
                if (nargs.Cancel)
                    throw new Exception("Operation Cancelled");
            }
        }
        private void FilterTable(DataTable ntable, FbFilterObjectEventArgs.FbFilterObjectArgsType objectType)
        {
            if (OnFilterOldObject == null)
                return;
            List<DataRow> rowsToRemove = new List<DataRow>();
            foreach (DataRow xrow in ntable.Rows)
            {
                string name1 = null;
                string name2 = null;
                switch (objectType)
                {
                    case FbFilterObjectEventArgs.FbFilterObjectArgsType.Domain:
                        name1 = "DOMAIN_NAME";
                        break;
                    case FbFilterObjectEventArgs.FbFilterObjectArgsType.Column:
                        name1 = "FIELD_NAME";
                        name2 = "RELATION_NAME";
                        break;
                    case FbFilterObjectEventArgs.FbFilterObjectArgsType.Table:
                        name1 = "RELATION_NAME";
                        break;
                    case FbFilterObjectEventArgs.FbFilterObjectArgsType.Procedure:
                        name1 = "PROCEDURE_NAME";
                        break;
                    case FbFilterObjectEventArgs.FbFilterObjectArgsType.View:
                        name1 = "RELATION_NAME";
                        break;
                    case FbFilterObjectEventArgs.FbFilterObjectArgsType.Index:
                        name1 = "INDEX_NAME";
                        break;
                    case FbFilterObjectEventArgs.FbFilterObjectArgsType.Function:
                        name1 = "FUNCTION_NAME";
                        break;
                    case FbFilterObjectEventArgs.FbFilterObjectArgsType.Constraint:
                        name1 = "CONSTRAINT";
                        break;
                }
                FbFilterObjectEventArgs args = new FbFilterObjectEventArgs(objectType, name1, name2);
                OnFilterOldObject(this, args);
                bool include = args.IncludeObject;
                if (!include)
                {
                    rowsToRemove.Add(xrow);
                }
            }
            foreach (var xrow in rowsToRemove)
            {
                ntable.Rows.Remove(xrow);
            }
        }

        private void FillOldAndNewData()
        {
            // Read tables com source and destination
            OldDb.StartTransaction(IsolationLevel.Snapshot);
            NewDb.StartTransaction(IsolationLevel.Snapshot);

            int OdsVersion = 11;
            string functionSourceField = OldDb.GetValueFromSql("select RDB$FIELD_NAME FROM RDB$RELATION_FIELDS " +
              "  WHERE RDB$RELATION_NAME = 'RDB$FUNCTIONS' AND RDB$FIELD_NAME = 'RDB$FUNCTION_SOURCE'").ToString();
            if (functionSourceField.Length > 0)
            {
                OdsVersion = 12;
            }


            DoProgress(0, 0, "Checking destination table version", "");

            // Check table format version
            DataTable versiontable = OldDb.OpenInmediate(NewData, "SELECT MAX(RDB$FORMAT) FROM RDB$RELATIONS WHERE (RDB$SYSTEM_FLAG=0 OR (RDB$SYSTEM_FLAG IS NULL))",
                "MAXVERSION");
            long Max2 = 0;
            if (versiontable.Rows[0][0] != DBNull.Value)
                Max2 = System.Convert.ToInt64(versiontable.Rows[0][0]);
            if (Max2 > 100)
                throw new Exception("Risk of fail update because too many table versions after last rebuild, backup and restore the database");

            string sql = FbExtract.GetSqlFilter("", dialect);
            DoProgress(0, 0, "Reading destination filters", "");
            OldDb.Open(OldData, sql, "FILTERS_DETAIL");
            DoProgress(0, 0, "Reading source filters", "");
            NewDb.Open(NewData, sql, "FILTERS_DETAIL");

            sql = FbExtract.GetSqlFunctions("", dialect, OdsVersion);
            DoProgress(0, 0, "Reading destination functions", "");
            OldDb.Open(OldData, sql, "FUNCTIONS_DETAIL");
            DoProgress(0, 0, "Reading source functions", "");
            NewDb.Open(NewData, sql, "FUNCTIONS_DETAIL");


            sql = FbExtract.GetSqlDomains("", "", dialect);
            DoProgress(0, 0, "Reading destination domains", "");
            OldDb.Open(OldData, sql, "DOMAINS_DETAIL");
            FilterTable(OldData.Tables["DOMAINS_DETAIL"], FbFilterObjectEventArgs.FbFilterObjectArgsType.Domain);

            DoProgress(0, 0, "Reading source domains", "");
            NewDb.Open(NewData, sql, "DOMAINS_DETAIL");

            sql = FbExtract.GetSqlGenerators("", dialect);
            DoProgress(0, 0, "Reading destination generators", "");
            OldDb.Open(OldData, sql, "GENERATORS_DETAIL");
            DoProgress(0, 0, "Reading source generators", "");
            NewDb.Open(NewData, sql, "GENERATORS_DETAIL");

            sql = FbExtract.GetSqlExceptions("", dialect);
            DoProgress(0, 0, "Reading destination exceptions", "");
            OldDb.Open(OldData, sql, "EXCEPTIONS_DETAIL");
            DoProgress(0, 0, "Reading source exceptions", "");
            NewDb.Open(NewData, sql, "EXCEPTIONS_DETAIL");


            string relsql = "";
            string checksql = "";

            bool hasrelationtype = true;

            FbExtract.GetTablesSql("", false, false, hasrelationtype, ref sql, ref checksql, ref relsql);

            DoProgress(0, 0, "Reading destination table checks", "");
            OldDb.Open(OldData, checksql, "CHECKS");
            DoProgress(0, 0, "Reading source table checks", "");
            NewDb.Open(NewData, checksql, "CHECKS");

            DoProgress(0, 0, "Reading source unique checks", "");
            OldDb.Open(OldData, relsql, "UNIQUES");
            DoProgress(0, 0, "Reading destination unique checks", "");
            NewDb.Open(NewData, relsql, "UNIQUES");

            DoProgress(0, 0, "Reading destination tables", "");
            OldDb.Open(OldData, sql, "TABLES_DETAIL");
            DoProgress(0, 0, "Reading source tables", "");
            NewDb.Open(NewData, sql, "TABLES_DETAIL");


            string dpendedsql = "";
            sql = "";
            string sqlparams = "";
            string sqldim = "";
            FbExtract.GetSqlProcedures("", dialect, ref sql, ref dpendedsql, ref sqlparams, ref sqldim, true, OdsVersion);

            DoProgress(0, 0, "Reading destination procedures", "");
            OldDb.Open(OldData, sql, "PROCEDURES_DETAIL");
            DoProgress(0, 0, "Reading source procedures", "");
            NewDb.Open(NewData, sql, "PROCEDURES_DETAIL");
            DoProgress(0, 0, "Reading destination procedures params", "");
            OldDb.Open(OldData, sqlparams, "PROCEDURES_PARAMS");
            DoProgress(0, 0, "Reading source procedures params", "");
            NewDb.Open(NewData, sqlparams, "PROCEDURES_PARAMS");
            DoProgress(0, 0, "Reading destination procedures dimensions", "");
            OldDb.Open(OldData, sqldim, "PROCEDURES_DIMENSIONS");
            DoProgress(0, 0, "Reading source procedures dimensions", "");
            NewDb.Open(NewData, sqldim, "PROCEDURES_DIMENSIONS");
            DoProgress(0, 0, "Reading destination procedures dependencies", "");
            OldDb.Open(OldData, dpendedsql, "PROCEDURES_DETAIL_DEP");
            DoProgress(0, 0, "Reading source procedures dependencies", "");
            NewDb.Open(NewData, dpendedsql, "PROCEDURES_DETAIL_DEP");






            /*            sql = "SELECT TRIM(RDB$RELATION_NAME) FROM RDB$RELATIONS WHERE (RDB$SYSTEM_FLAG=0 OR RDB$SYSTEM_FLAG IS NULL) " +
                            " AND (RDB$RELATION_TYPE=0 OR RDB$RELATION_TYPE IS NULL) ";
                        OldDb.Open(OldData, sql, "RELATIONS");
                        NewDb.Open(NewData, sql, "RELATIONS");*/
            // Dependences
            sql = "SELECT TRIM(RDB$DEPENDENT_NAME) AS DEPENDENT_NAME," +
                " TRIM(RDB$DEPENDED_ON_NAME) AS DEPENDED_ON_NAME," +
                " TRIM(RDB$FIELD_NAME) AS FIELD_NAME," +
                " RDB$DEPENDENT_TYPE AS DEPENDENT_TYPE," +
                " RDB$DEPENDED_ON_TYPE AS DEPENDED_ON_TYPE" +
                " FROM RDB$DEPENDENCIES ";
            DoProgress(0, 0, "Reading destination dependencies", "");
            OldDb.Open(OldData, sql, "DEPENDENCIES");
            DoProgress(0, 0, "Reading source dependencies", "");
            NewDb.Open(NewData, sql, "DEPENDENCIES");


            sql = FbExtract.GetIndexSql("", "", dialect);
            DoProgress(0, 0, "Reading destination indices", "");
            OldDb.Open(OldData, sql, "INDICES_DETAIL");
            DoProgress(0, 0, "Reading source indices", "");
            NewDb.Open(NewData, sql, "INDICES_DETAIL");



            sql = "";
            string sqlindex = "";
            FbExtract.GetForeignSql("", "", dialect, ref sql, ref sqlindex);
            DoProgress(0, 0, "Reading destination foreigns", "");
            OldDb.Open(OldData, sql, "FOREIGNS_DETAIL");
            OldDb.Open(OldData, sqlindex, "FOREIGNS_DETAILI");
            DoProgress(0, 0, "Reading source foreigns", "");
            NewDb.Open(NewData, sql, "FOREIGNS_DETAIL");
            NewDb.Open(NewData, sqlindex, "FOREIGNS_DETAILI");


            sql = FbExtract.GetViewsSql("", dialect);
            DoProgress(0, 0, "Reading destination views", "");
            OldDb.Open(OldData, sql, "VIEWS_DETAIL");
            DoProgress(0, 0, "Reading source views", "");
            NewDb.Open(NewData, sql, "VIEWS_DETAIL");

            sql = FbExtract.GetTriggersSql("", "", dialect, false);
            DoProgress(0, 0, "Reading destination triggers", "");
            OldDb.Open(OldData, sql, "TRIGGERS_DETAIL");

            DoProgress(0, 0, "Reading source triggers", "");
            NewDb.Open(NewData, sql, "TRIGGERS_DETAIL");



            DoProgress(0, 0, "Flush destination sql querys", "");
            OldDb.Flush();
            DoProgress(0, 0, "Flush source sql querys", "");

            NewDb.Flush();

            FCompareStep = CompareStep.Preparing;

            viewdependedonname = new DataView(OldData.Tables["DEPENDENCIES"], "", "DEPENDED_ON_NAME", DataViewRowState.CurrentRows);
            viewdependedonnamecolumn = new DataView(OldData.Tables["DEPENDENCIES"], "", "DEPENDED_ON_NAME,FIELD_NAME,DEPENDED_ON_TYPE", DataViewRowState.CurrentRows);
            viewIndicesDetail = new DataView(OldData.Tables["INDICES_DETAIL"], "", "RDB$RELATION_NAME,RDB$FIELD_NAME", DataViewRowState.CurrentRows);


            DoProgress(0, 0, "Processing filters", "");
            // Fill filers from detail
            FbExtract.ProcessFilters(NewData.Tables["FILTERS_DETAIL"], CreateSimpleTable(NewData, "FILTERS"), null, dialect, SentenceSeparator);
            FbExtract.ProcessFilters(OldData.Tables["FILTERS_DETAIL"], CreateSimpleTable(OldData, "FILTERS"), null, dialect, SentenceSeparator);
            // Fill function detail
            DoProgress(0, 0, "Processing functions", "");
            FbExtract.ProcessFunctions(NewData.Tables["FUNCTIONS_DETAIL"], CreateSimpleTable(NewData, "FUNCTIONS"), null, dialect, SentenceSeparator, false, FbExtract.ExtractFunctionType.Both);
            FbExtract.ProcessFunctions(OldData.Tables["FUNCTIONS_DETAIL"], CreateSimpleTable(OldData, "FUNCTIONS"), null, dialect, SentenceSeparator, false, FbExtract.ExtractFunctionType.Both);

            // Fill domains from domain source
            DoProgress(0, 0, "Processing domains", "");
            FbExtract.ProcessDomains(NewData.Tables["DOMAINS_DETAIL"], CreateSimpleTable(NewData, "DOMAINS"), null, dialect, SentenceSeparator);
            FbExtract.ProcessDomains(OldData.Tables["DOMAINS_DETAIL"], CreateSimpleTable(OldData, "DOMAINS"), null, dialect, SentenceSeparator);


            PrimaryKeysNew = new SortedList<string, List<string>>();
            PrimaryKeysOld = new SortedList<string, List<string>>();
            // Fill tables 
            DoProgress(0, 0, "Processing Tables", "");
            NewData.Tables.Add(FbExtract.CreateFieldsTable());
            FbExtract.ProcessTables("", false, true, hasrelationtype, NewData.Tables["TABLES_DETAIL"], NewData.Tables["CHECKS"],
                NewData.Tables["UNIQUES"], CreateSimpleTable(NewData, "TABLES"), NewData.Tables["FIELDS"], null, dialect, SentenceSeparator,
                PrimaryKeysNew, null);
            OldData.Tables.Add(FbExtract.CreateFieldsTable());
            FbExtract.ProcessTables("", false, false, hasrelationtype, OldData.Tables["TABLES_DETAIL"], OldData.Tables["CHECKS"],
                OldData.Tables["UNIQUES"], CreateSimpleTable(OldData, "TABLES"), OldData.Tables["FIELDS"], null, dialect, SentenceSeparator,
                PrimaryKeysOld, null);


            viewrelationfieldsnew = new DataView(NewData.Tables["FIELDS"], "", "TABLE", DataViewRowState.CurrentRows);
            viewrelationfieldsold = new DataView(OldData.Tables["FIELDS"], "", "TABLE", DataViewRowState.CurrentRows);

            viewrelationfieldsnewdet = new DataView(NewData.Tables["FIELDS"], "", "TABLE,FIELD", DataViewRowState.CurrentRows);
            viewrelationfieldsolddet = new DataView(OldData.Tables["FIELDS"], "", "TABLE,FIELD", DataViewRowState.CurrentRows);

            // Fill procedures
            DoProgress(0, 0, "Processing Procedures", "");
            FbExtract.ProcessProcedures("", NewData.Tables["PROCEDURES_DETAIL"],
                NewData.Tables["PROCEDURES_DETAIL_DEP"], NewData.Tables["PROCEDURES_PARAMS"], NewData.Tables["PROCEDURES_DIMENSIONS"],
                 CreateSimpleTable(NewData, "PROCEDURES"), null, SentenceSeparator, dialect, true, false, false);
            FbExtract.ProcessProcedures("", OldData.Tables["PROCEDURES_DETAIL"],
                OldData.Tables["PROCEDURES_DETAIL_DEP"], OldData.Tables["PROCEDURES_PARAMS"], OldData.Tables["PROCEDURES_DIMENSIONS"],
                 CreateSimpleTable(OldData, "PROCEDURES"), null, SentenceSeparator, dialect, true, false, false);

            // Generators
            DoProgress(0, 0, "Processing generators", "");
            FbExtract.ProcessGenerators(NewData.Tables["GENERATORS_DETAIL"], CreateSimpleTable(NewData, "GENERATORS"), null, dialect, SentenceSeparator);
            FbExtract.ProcessGenerators(OldData.Tables["GENERATORS_DETAIL"], CreateSimpleTable(OldData, "GENERATORS"), null, dialect, SentenceSeparator);

            // Generators
            DoProgress(0, 0, "Processing exceptios", "");
            FbExtract.ProcessExceptions(NewData.Tables["EXCEPTIONS_DETAIL"], CreateSimpleTable(NewData, "EXCEPTIONS"), null, dialect, SentenceSeparator);
            FbExtract.ProcessExceptions(OldData.Tables["EXCEPTIONS_DETAIL"], CreateSimpleTable(OldData, "EXCEPTIONS"), null, dialect, SentenceSeparator);

            // Indices
            DoProgress(0, 0, "Processing indices", "");
            FbExtract.ProcessIndexes(NewData.Tables["INDICES_DETAIL"], CreateSimpleTable(NewData, "INDICES"), null, dialect, SentenceSeparator);
            FbExtract.ProcessIndexes(OldData.Tables["INDICES_DETAIL"], CreateSimpleTable(OldData, "INDICES"), null, dialect, SentenceSeparator);
            viewIndices = new DataView(OldData.Tables["INDICES"], "", "NAME", DataViewRowState.CurrentRows);

            // Foreigns
            DoProgress(0, 0, "Processing foreign keys", "");
            FbExtract.ProcessForeigns(NewData.Tables["FOREIGNS_DETAIL"], NewData.Tables["FOREIGNS_DETAILI"], CreateSimpleTable(NewData, "FOREIGNS"), null, dialect, SentenceSeparator);
            FbExtract.ProcessForeigns(OldData.Tables["FOREIGNS_DETAIL"], OldData.Tables["FOREIGNS_DETAILI"], CreateSimpleTable(OldData, "FOREIGNS"), null, dialect, SentenceSeparator);

            // Views
            DoProgress(0, 0, "Processing views", "");
            FbExtract.ProcessViews(NewData.Tables["VIEWS_DETAIL"], CreateSimpleTable(NewData, "VIEWS"), null, dialect, SentenceSeparator, false);
            FbExtract.ProcessViews(OldData.Tables["VIEWS_DETAIL"], CreateSimpleTable(OldData, "VIEWS"), null, dialect, SentenceSeparator, false);

            // Triggers
            DoProgress(0, 0, "Processing triggers", "");
            FbExtract.ProcessTriggers(NewData.Tables["TRIGGERS_DETAIL"], CreateSimpleTable(NewData, "TRIGGERS"), null, dialect, SentenceSeparator);
            FbExtract.ProcessTriggers(OldData.Tables["TRIGGERS_DETAIL"], CreateSimpleTable(OldData, "TRIGGERS"), null, dialect, SentenceSeparator);

        }
        private DataTable CreateSimpleTable(DataSet ndata, string tablename)
        {
            DataTable ntable = new DataTable(tablename);
            ndata.Tables.Add(ntable);
            ntable.Columns.Add("NAME", System.Type.GetType("System.String"));
            ntable.Columns.Add("SOURCE", System.Type.GetType("System.String"));
            ntable.Columns.Add("SOURCE_HEADER", System.Type.GetType("System.String"));
            if (tablename == "DOMAINS")
                ntable.Columns.Add("PARTIAL_SOURCE", System.Type.GetType("System.String"));
            if ((tablename == "INDICES") || (tablename == "FOREIGNS") || (tablename == "TRIGGERS") || (tablename == "VIEWS"))
                ntable.Columns.Add("TABLE", System.Type.GetType("System.String"));
            if (tablename == "FOREIGNS")
                ntable.Columns.Add("SYSTEM_NAME", System.Type.GetType("System.Boolean"));
            ntable.Constraints.Add("IPRIM" + tablename, ntable.Columns[0], true);
            if (tablename == "PROCEDURES")
                ntable.Columns.Add("DEFINITION", System.Type.GetType("System.Int32"));
            if (tablename == "FUNCTIONS")
                ntable.Columns.Add("ENTRY_POINT", System.Type.GetType("System.String"));
            return ntable;
        }

    }
    public class FbFilterObjectEventArgs
    {
        public enum FbFilterObjectArgsType { Domain, Column, Table, Procedure, Function, Constraint, Index, View }
        public bool IncludeObject = true;
        public string ObjectName;
        public string ParentName;

        FbFilterObjectArgsType ObjectType;
        public FbFilterObjectEventArgs(FbFilterObjectArgsType nobjectType, string nobjectName, string nparentName)
        {
            ObjectType = nobjectType;
            ObjectName = nobjectName;
            ParentName = nparentName;
        }
    }
    public class FbCompareProgressArgs
    {
        public int count1;
        public int max1;
        public int count2;
        public int max2;
        public string message1 = "";
        public string message2 = "";
        public bool Cancel;
        public FbCompareProgressArgs(int ncount1, int nmax1, int ncount2, int nmax2,
            string nmessage1, string nmessage2)
        {
            count1 = ncount1;
            count2 = ncount2;
            max1 = nmax1;
            max2 = nmax2;
            message1 = nmessage1;
            message2 = nmessage2;
        }
    }
}
