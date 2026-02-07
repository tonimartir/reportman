using FirebirdSql.Data.FirebirdClient;
using System;
using System.Collections.Generic;
using System.Data;
using System.IO;
using System.Text;

namespace FirebirdSql.Metadata.Extract
{
    public delegate void FBCloneEventHandler(object sender, FBCloneEventArgs args);
    public delegate void FBCloneLogEventHandler(object sender, string message);
    public delegate void FBCloneErrorIgnoredEventHandler(object sender, FBCloneEventArgs args, Exception E);
    public class FbClone : IDisposable
    {
        public const int DEFAULT_READING_THREADS = 4;
        public const int DEFAULT_INDEXING_THREADS = 4;
        public const int DEFAULT_ROW_GROUPING = 200;
        [Flags()]
        public enum IgnoreErrorFlags
        {
            None = 0, Domain = 1, Table = 2, Trigger = 4, Procedure = 8, DataRow = 16, Function = 8, Filter = 32, View = 64, PrimaryKey = 128,
            ForeignKey = 256, Index = 512, Generator = 1024, Check = 2048, Exception = 4096, Role = 8192, Grant = 16384, Packages = 32768
        }
        DateTime mmfirst;
        DateTime mmlast;
        DataView destinationFieldsView;
        DataTable destinationTriggers;
        DataTable destinationForeigns;
        TimeSpan nspan;
        FbTransaction ntrans;
        FbTransaction ntransfix;
        IgnoreErrorFlags CurrentOperation = IgnoreErrorFlags.None;
        FbTransactionOptions opts;
        public bool? CompressionSource;
        public bool? CompressionDestination;
        public int ReadingThreads = DEFAULT_READING_THREADS;
        public int IndexingThreads = DEFAULT_INDEXING_THREADS;
        public int RecordGroupCount = DEFAULT_ROW_GROUPING;
        public bool AddCustomFunctions;
        public bool ForeignKeysParallel;
        public IgnoreErrorFlags IgnoreFlags = IgnoreErrorFlags.None;
        private FbConnection Connection;
        private FbConnection nconnection;
        private FbConnection nconnectionfix;
        public bool CommitEachItem;
        public string SourceCharset;
        public string DestinationCharset;
        public int ProgressInterval = 500;
        public int RecordProgressInterval = 100;
        public bool CommitEachTable;
        public bool CountRecords;
        public bool ConvertToCIAI = false;
        public bool WriteLogFile = false;
        public FBCloneEventHandler OnProgress;
        public FBCloneLogEventHandler OnLog;
        public FBCloneErrorIgnoredEventHandler OnErrorIgnored;
        private FbTransaction Transaction;
        private int source_dialect;
        private int destination_dialect;
        public string IdentifierSeparatorSource;
        public string IdentifierSeparatorDestination;
        public string SentenceSeparator;
        public string AlternativeSentenceSeparator;
        public string DestinationServer;
        public string DestinationDatabase;
        public string DestinationUser;
        public string DestinationPassword;
        public bool enableforced;
        public bool disableforced;
        public bool MetadataOnly;
        public bool FixMetadata;
        public Reportman.Drawing.ISqlExecuter SqlExecuter;
        private FBCloneEventArgs intargs;
        public FBCloneEventArgs CurrentProgress
        {
            get
            {
                return intargs;
            }
        }
        private bool forcedwrites;
        FbExtract nextract;
        FbExtract nextractfix;
        FbCommand metacommand;
        FbCommand oricommand;
        FbCommand icommand;
        FbDataAdapter nadapter;
        public SortedList<string, string> SkipTables = new SortedList<string, string>();
        public List<string> ChangeTypes = new List<string>();
        public List<string> OnlyTables = new List<string>();
        public List<string> ImportTablesFirst = new List<string>();

        int page_size;
        int sweep_inteval;
        int buffers;
        public FbClone(FbConnection Connection,
            int ndialect, int destdialect)
        {
            CommitEachItem = true;
            CommitEachTable = true;
            CountRecords = false;
            this.Connection = Connection;
            this.source_dialect = ndialect;
            if (destdialect != 0)
                destination_dialect = destdialect;
            else
                destination_dialect = source_dialect;
            if (source_dialect == 1)
                IdentifierSeparatorSource = "";
            else
                IdentifierSeparatorSource = "\"";
            if (destination_dialect == 1)
                IdentifierSeparatorDestination = "";
            else
                IdentifierSeparatorDestination = "\"";
            SentenceSeparator = ";";
            AlternativeSentenceSeparator = System.Environment.NewLine + "^";
            metacommand = new FbCommand();
            oricommand = new FbCommand();
            icommand = new FbCommand();
            nextract = new FbExtract(Connection, Transaction, destination_dialect);
            nadapter = new FbDataAdapter();
            nadapter.SelectCommand = oricommand;
            intargs = new FBCloneEventArgs();
        }
        string nsourceconnectionstringfix = "";
        int SourceDbPort = 3050;
        int DestinationDbPort = 3050;
        System.Data.DataTable TableConfig;
        public FbClone(string server, string databasepath, string user, string password, string ncharset, int ndialect, string destserver,
            string destdatabase, string destuser, string destpassword, bool disableforcedwrites, bool enableforcedwrites, int nsourcedbport, int ndestinationdbport,
            int destdialect, string destcharset, Reportman.Drawing.ISqlExecuter nSQLExecuter, System.Data.DataTable nTableConfig, bool? nCompressionSource)
        {
            TableConfig = nTableConfig;
            SourceCharset = ncharset;
            if (destcharset != null)
                DestinationCharset = ncharset;
            else
                DestinationCharset = destcharset;
            enableforced = enableforcedwrites;
            disableforced = disableforcedwrites;

            SourceDbPort = nsourcedbport;
            DestinationDbPort = ndestinationdbport;
            CompressionSource = nCompressionSource;

            source_dialect = ndialect;
            if (destdialect != 0)
                destination_dialect = destdialect;
            else
                destination_dialect = source_dialect;
            DestinationDatabase = destdatabase;
            DestinationServer = destserver;
            DestinationUser = destuser;
            DestinationPassword = destpassword;
            opts = new FbTransactionOptions();
            opts.TransactionBehavior = FbTransactionBehavior.Concurrency | FbTransactionBehavior.Wait;
            CommitEachTable = true;
            CountRecords = true;
            CommitEachItem = true;
            string sourceconnecionstring = "No Garbage Collection=True;Pooling=false;DataSource=" + server + ";DataBase=" + databasepath + ";User=" + user + ";Password=" + password + ";Charset=" + SourceCharset + ";Dialect=" + destination_dialect.ToString() + ";PacketSize=32000;FetchSize=2000;Port=" + SourceDbPort.ToString();
            if (CompressionSource != null)
            {
                sourceconnecionstring = sourceconnecionstring + ";Compression=";
                if (Convert.ToBoolean(CompressionSource))
                {
                    sourceconnecionstring = sourceconnecionstring + "true";
                }
                else
                {
                    sourceconnecionstring = sourceconnecionstring + "false";
                }
            }
            nsourceconnectionstringfix = "Pooling=false;DataSource=" + server + ";DataBase=" + databasepath + ";User=" + user + ";Password=" + password + ";Charset=NONE;Dialect=" + destination_dialect.ToString() +
                ";Port=" + SourceDbPort.ToString();
            SqlExecuter = nSQLExecuter;
            if (SqlExecuter == null)
            {
                Connection = new FbConnection(sourceconnecionstring);
                Connection.Open();
                FbDatabaseInfo ninfo = new FbDatabaseInfo(Connection);
                Transaction = Connection.BeginTransaction(opts);
                page_size = ninfo.GetPageSize();
                forcedwrites = ninfo.GetForcedWrites();
                buffers = ninfo.GetNumBuffers();
                sweep_inteval = ninfo.GetSweepInterval();
            }
            else
            {
                page_size = 16384;
                forcedwrites = false;
                sweep_inteval = 0;
                buffers = 1024;
                SqlExecuter.StartTransaction(IsolationLevel.Snapshot);
                SqlExecuter.Flush();
            }
            if (source_dialect == 1)
                IdentifierSeparatorSource = "";
            else
                IdentifierSeparatorSource = "\"";
            if (destination_dialect == 1)
                IdentifierSeparatorSource = "";
            else
                IdentifierSeparatorSource = "\"";
            SentenceSeparator = ";";
            AlternativeSentenceSeparator = System.Environment.NewLine + "^";
            oricommand = new FbCommand();
            icommand = new FbCommand();
            metacommand = new FbCommand();
            nextract = new FbExtract(Connection, Transaction, destination_dialect);
            if (SqlExecuter != null)
            {
                nextract.OnFill += DoFilLSqlExecuter;
                nextract.OdsVersion = 12;
                nextract.PageSize = page_size;
            }
            intargs = new FBCloneEventArgs();
            nadapter = new FbDataAdapter();
            nadapter.SelectCommand = oricommand;
        }
        public DataTable DoFilLSqlExecuter(FbCommand ncommand)
        {
            using (DataSet ndataset = new DataSet())
            {
                SqlExecuter.Open(ndataset, ncommand, "DD");
                SqlExecuter.Flush();
                return ndataset.Tables[0];
            }
        }

        public string QuoteIdentifier(string iden)
        {
            string aresult = iden;
            if (destination_dialect == 1)
                aresult = iden.ToUpper();
            else
            {
                aresult = iden.Replace("\"", "\"\"");
                aresult = "\"" + aresult + "\"";
            }
            return aresult;
        }
        public static string NormalizeString(string ntext)
        {
            /*ntext = ntext.Normalize(NormalizationForm.FormD);
            Regex reg = new Regex("[^a-zA-Z0-9 ]");
            return reg.Replace(ntext, "");*/
            byte[] nbytes = Encoding.ASCII.GetBytes(ntext);
            string nstring = Encoding.ASCII.GetString(nbytes);

            return nstring;
        }
        public static FbDbType InternalTypeToParamType(int field_type, int field_scale, int sub_type)
        {
            FbDbType aresult = FbDbType.VarChar;
            switch (field_type)
            {
                case 7:
                    aresult = FbDbType.SmallInt;
                    break;
                case 8:
                    aresult = FbDbType.Integer;
                    break;
                case 9:
                    // QUAD
                    aresult = FbDbType.BigInt;
                    break;
                case 10:
                    aresult = FbDbType.Float;
                    break;
                case 11:
                case 27:
                    aresult = FbDbType.Double;
                    if (field_scale < 0)
                        aresult = FbDbType.Numeric;
                    break;
                case 12:
                    aresult = FbDbType.Date;
                    break;
                case 13:
                    aresult = FbDbType.Time;
                    break;
                case 14:
                    aresult = FbDbType.Char;
                    break;
                case 16:
                    // New Decimal type
                    aresult = FbDbType.Numeric;
                    break;
                case 35:
                    aresult = FbDbType.TimeStamp;
                    break;
                case 37:
                    aresult = FbDbType.VarChar;
                    break;
                case 23:
                    aresult = FbDbType.Boolean;
                    break;
                case 26:
                    if (field_scale < 0)
                    {
                        aresult = FbDbType.Numeric;
                    }
                    else
                    {
                        aresult = FbDbType.Int128;
                    }
                    break;
                case 40:
                    aresult = FbDbType.VarChar;
                    break;
                case 261:
                    aresult = FbDbType.Binary;
                    if (sub_type == 1)
                        aresult = FbDbType.VarChar;
                    break;
                default:
                    throw new Exception("Unknown type subtype:" + field_type);
            }
            return aresult;
        }
        public void Execute(bool overwrite, bool usedb, bool usedb_generators)
        {
            // if ((ReadingThreads != 1) && (CommitEachTable))
            //     throw new Exception("Reading threads greater than 1 and Commit each table are incompatible");
            if (overwrite && usedb)
                throw new Exception("Replace existing database and use existing database can not be used at the same time");
            if (FixMetadata)
            {
                nconnectionfix = new FbConnection(nsourceconnectionstringfix);
                nconnectionfix.Open();
                ntransfix = nconnectionfix.BeginTransaction(opts);
            }
            string destcharset = SourceCharset;
            if (DestinationCharset != null)
                destcharset = DestinationCharset;
            string destinationconnectionstring = "Pooling=false;DataSource=" + DestinationServer + ";DataBase=" + DestinationDatabase + ";User=" + DestinationUser + ";Password=" + DestinationPassword + ";Charset=" + destcharset + ";Dialect=" + destination_dialect.ToString() +
                ";records affected=false" + ";Port=" + DestinationDbPort.ToString();
            if (CompressionDestination != null)
            {
                destinationconnectionstring = destinationconnectionstring + ";Compression=";
                if (Convert.ToBoolean(CompressionDestination))
                {
                    destinationconnectionstring = destinationconnectionstring + "true";
                }
                else
                {
                    destinationconnectionstring = destinationconnectionstring + "false";
                }
            }
            if (disableforced)
                forcedwrites = false;
            if (enableforced)
                forcedwrites = true;

            if (!usedb)
            {
                try
                {
                    FbConnection.CreateDatabase(destinationconnectionstring, page_size, forcedwrites, overwrite);
                }
                catch
                {
                    if (overwrite)
                    {
                        FirebirdSql.Data.Services.FbConfiguration dbconf = new Data.Services.FbConfiguration();
                        dbconf.ConnectionString = destinationconnectionstring;
                        dbconf.DatabaseShutdown2(Data.Services.FbShutdownOnlineMode.Full, Data.Services.FbShutdownType.ForceShutdown, 0);
                        FbConnection.CreateDatabase(destinationconnectionstring, page_size, forcedwrites, overwrite);
                    }
                    else
                        throw;
                }

                FirebirdSql.Data.Services.FbConfiguration bconfig = new FirebirdSql.Data.Services.FbConfiguration();
                bconfig.ConnectionString = destinationconnectionstring;

                // bconfig.SetPageBuffers(buffers);
                bconfig.SetSweepInterval(sweep_inteval);
            }
            if (SqlExecuter != null)
            {
                ReadingThreads = 1;
                IndexingThreads = 1;
            }


            DataTable nresult = new DataTable();
            nresult.Columns.Add("NAME", System.Type.GetType("System.String"));
            nresult.Columns.Add("SOURCE", System.Type.GetType("System.String"));
            nresult.Columns.Add("SOURCE_HEADER", System.Type.GetType("System.String"));
            nresult.Columns.Add("DEFINITION", System.Type.GetType("System.Int32"));
            nresult.Columns.Add("TABLE", System.Type.GetType("System.String"));
            nresult.Columns.Add("REFERENCES", System.Type.GetType("System.String"));
            nconnection = new FbConnection(destinationconnectionstring);
            try
            {

                CurrentOperation = IgnoreErrorFlags.None;
                intargs.ProgressName = "Connecting";
                intargs.TotalProgressCount = 19;
                intargs.ProgressCount = 1;
                intargs.TotalTableCount = 0;
                intargs.TotalRecordCount = 0;
                intargs.RecordCount = 0;
                intargs.Cancel = false;
                intargs.Table = "";
                intargs.TableCount = 0;
                mmfirst = DateTime.Now;
                CheckProgress(true);
                nconnection.Open();
                FbDatabaseInfo dbinfo = new FbDatabaseInfo(nconnection);
                int OdsDestinationVersion = dbinfo.GetOdsVersion();

                FbTransactionOptions opts = new FbTransactionOptions();
                opts.TransactionBehavior = FbTransactionBehavior.Concurrency | FbTransactionBehavior.Wait;
                oricommand.Connection = Connection;
                oricommand.Transaction = Transaction;
                ntrans = nconnection.BeginTransaction(opts);
                try
                {
                    CurrentOperation = IgnoreErrorFlags.Filter;
                    intargs.ProgressCount++;
                    InitArgs();
                    intargs.ProgressName = "Filters";
                    CheckProgress(true);

                    metacommand.Connection = nconnection;
                    metacommand.Transaction = ntrans;

                    if (!usedb)
                    {
                        nextract.ExtractFilter("", nresult);
                        FilterResult(nresult);
                        ExecuteTable("Filters", nresult);
                    }
                    //
                    CurrentOperation = IgnoreErrorFlags.Function;
                    intargs.ProgressCount++;
                    InitArgs();
                    intargs.ProgressName = "Functions";
                    CheckProgress(true);

                    nresult.Rows.Clear();
                    if (!usedb)
                    {
                        System.Data.DataTable tableFunctions = null;
                        if (AddCustomFunctions)
                        {
                            tableFunctions = CreateCustomFunctions();
                            ExecuteTable("Functions", tableFunctions);
                        }
                        nextract.ExtractFunction("", nresult, true, FbExtract.ExtractFunctionType.Udfs);
                        FilterResult(nresult);
                        // Remove rows already in custom functions
                        if (AddCustomFunctions)
                        {
                            SortedList<string, DataRow> functions = new SortedList<string, DataRow>();
                            foreach (DataRow xrow in nresult.Rows)
                            {
                                functions.Add(xrow["NAME"].ToString().ToUpper(), xrow);
                            }
                            foreach (string key in functions.Keys)
                            {
                                System.Data.DataRow customRow = tableFunctions.Rows.Find(key);
                                if ((customRow != null) || (key == "ASCII_CHAR") || (key == "ASCII_VAL"))
                                {
                                    nresult.Rows.Remove(functions[key]);
                                }
                            }
                        }
                        ExecuteTableMultiple("Functions", nresult, true);
                    }
                    //
                    CurrentOperation = IgnoreErrorFlags.Domain;
                    intargs.ProgressCount++;
                    InitArgs();
                    intargs.ProgressName = "Domains";
                    CheckProgress(true);

                    nresult.Rows.Clear();
                    if (!usedb)
                    {
                        nextract.ExtractDomain("", "", nresult);
                        if (ConvertToCIAI)
                        {
                            foreach (DataRow xrow in nresult.Rows)
                            {
                                string domsource = xrow["SOURCE"].ToString();
                                if (domsource.IndexOf("T_DIRECCION_LARGA") >= 0)
                                    if (domsource.IndexOf("T_DIRECCION_LARGAUNICODE") < 0)
                                        domsource = "CREATE DOMAIN \"T_DIRECCION_LARGA\" VARCHAR(100) CHARACTER SET UTF8 COLLATE UNICODE";
                                if ((domsource.IndexOf("T_FORMATO") < 0) && (domsource.IndexOf("T_NOMMEDIO") < 0)
                                    && (domsource.IndexOf("T_CODIGOALPHA") < 0) && (domsource.IndexOf("T_IDENALPHA") < 0))
                                {
                                    string domsource_origin = domsource;
                                    int pos_collate = domsource.IndexOf("COLLATE UNICODE");
                                    int pos_collate_ai = domsource.IndexOf("COLLATE UNICODE_CI_AI");
                                    if ((pos_collate >= 0) && (pos_collate_ai < 0))
                                    {
                                        domsource = domsource.Substring(0, pos_collate - 1) + " COLLATE UNICODE_CI_AI";
                                        if (pos_collate + 15 < domsource_origin.Length)
                                            domsource = domsource + domsource_origin.Substring(pos_collate + 1, domsource_origin.Length - pos_collate - 1);

                                        xrow["SOURCE"] = domsource;
                                    }
                                }
                            }
                        }
                        FilterResult(nresult);
                        ExecuteTable("Domains", nresult);

                        if (OdsDestinationVersion >= 12)
                        {
                            nresult.Rows.Clear();
                            nextract.ExtractFunction("", nresult, true, FbExtract.ExtractFunctionType.Functions);
                            FilterResult(nresult);
                            ExecuteTableMultiple("Functions", nresult, true);
                        }

                        nresult.Rows.Clear();
                        nextract.ExtractPackages("", nresult, true);
                        FilterResult(nresult);
                        ExecuteTableMultiple("Packages", nresult, true);


                        nresult.Rows.Clear();
                        nextract.ExtractProcedure("", nresult, false, true);
                        FilterResult(nresult);
                        //ExecuteTableMultiple("Procedures", nresult, true);
                        ExecuteTable("Procedures", nresult);

                        nresult.Rows.Clear();
                        nextract.ExtractView("", nresult, true);
                        FilterResult(nresult);
                        //ExecuteTableMultiple("Procedures", nresult, true);
                        ExecuteTable("Views", nresult);
                    }
                    nresult.Rows.Clear();
                    //
                    CurrentOperation = IgnoreErrorFlags.Table;
                    intargs.ProgressCount++;
                    InitArgs();
                    intargs.ProgressName = "Tables";
                    CheckProgress(true);




                    nresult.Rows.Clear();
                    if (!usedb)
                    {
                        nextract.ChangeTypes = this.ChangeTypes;
                        nextract.ExtractTable("", nresult, false, false, null);
                        if (ConvertToCIAI)
                        {
                            foreach (DataRow xrow in nresult.Rows)
                            {
                                string tablesource = xrow["SOURCE"].ToString();
                                if (tablesource.IndexOf("PROMOCION_DONPIN_CLIENTES") >= 0)
                                {
                                    if (tablesource.IndexOf("\"CADENA\" T_NOM20") >= 0)
                                    {
                                        tablesource = tablesource.Replace("\"CADENA\" T_NOM20", "\"CADENA\" T_NOMMEDIO");
                                        xrow["SOURCE"] = tablesource;
                                    }
                                }
                            }
                        }
                        ExecuteTable("Tables", nresult);
                    }
                    else
                    {
                        DataTable destinationFieldsTable = new DataTable();
                        destinationFieldsTable.Columns.Add("TABLE");
                        destinationFieldsTable.Columns.Add("FIELD");
                        destinationFieldsTable.Columns.Add("POSITION", System.Type.GetType("System.Int32"));
                        destinationFieldsTable.Columns.Add("SOURCE");
                        destinationFieldsTable.Columns.Add("LENGTH", System.Type.GetType("System.Int32"));
                        destinationFieldsTable.Columns.Add("CHARSET");
                        FbExtract nextractDestination = new FbExtract(nconnection, ntrans, destination_dialect);

                        nextractDestination.ExtractTable("", nresult, true, true, destinationFieldsTable);
                        destinationFieldsView = new DataView(destinationFieldsTable, "", "TABLE", DataViewRowState.CurrentRows);

                        destinationTriggers = new DataTable();
                        destinationTriggers.Columns.Add("NAME", System.Type.GetType("System.String"));
                        destinationTriggers.Columns.Add("SOURCE", System.Type.GetType("System.String"));
                        destinationTriggers.Columns.Add("TABLE", System.Type.GetType("System.String"));

                        nextractDestination.ExtractTrigger("", "", destinationTriggers, false);

                        DataTable dropTriggers = new DataTable();
                        dropTriggers.Columns.Add("NAME", System.Type.GetType("System.String"));
                        dropTriggers.Columns.Add("SOURCE", System.Type.GetType("System.String"));
                        dropTriggers.Columns.Add("TABLE", System.Type.GetType("System.String"));
                        object[] newdrop = new object[3];
                        foreach (DataRow xrow in destinationTriggers.Rows)
                        {
                            newdrop[0] = xrow["NAME"];
                            newdrop[1] = "DROP TRIGGER " + QuoteIdentifier(xrow["NAME"].ToString());
                            newdrop[2] = xrow["TABLE"];
                            dropTriggers.Rows.Add(newdrop);
                        }
                        destinationForeigns = new DataTable();
                        destinationForeigns.Columns.Add("NAME", System.Type.GetType("System.String"));
                        destinationForeigns.Columns.Add("SOURCE", System.Type.GetType("System.String"));
                        destinationForeigns.Columns.Add("TABLE", System.Type.GetType("System.String"));
                        nextractDestination.ExtractForeign("", "", destinationForeigns);

                        DataTable dropForeigns = new DataTable();
                        dropForeigns.Columns.Add("NAME", System.Type.GetType("System.String"));
                        dropForeigns.Columns.Add("SOURCE", System.Type.GetType("System.String"));
                        dropForeigns.Columns.Add("TABLE", System.Type.GetType("System.String"));
                        foreach (DataRow xrow in destinationForeigns.Rows)
                        {
                            string table = xrow["TABLE"].ToString();
                            newdrop[0] = xrow["NAME"];
                            newdrop[1] = "ALTER TABLE " + QuoteIdentifier(table) + " DROP CONSTRAINT " + QuoteIdentifier(xrow["NAME"].ToString());
                            newdrop[2] = xrow["TABLE"];
                            dropForeigns.Rows.Add(newdrop);
                        }

                        ExecuteTable("Drop triggers", dropTriggers);

                        ExecuteTable("Drop foreigns", dropForeigns);
                    }

                    // Commit is needed to insert data into the tables
                    ntrans.Commit();
                    ntrans = nconnection.BeginTransaction(opts);
                    metacommand.Transaction = ntrans;
                    icommand.Transaction = ntrans;

                    CurrentOperation = IgnoreErrorFlags.DataRow;
                    intargs.ProgressCount++;
                    InitArgs();
                    intargs.ProgressName = "Data";
                    CheckProgress(true);


                    if (!MetadataOnly)
                    {
                        // Import all data from source database
                        oricommand.CommandText = "SELECT RDB$RELATION_NAME,CAST(NULL AS BLOB SUB_TYPE 1) AS SQL_FILTER,99999999 AS SORT_ORDER " +
                            " FROM RDB$RELATIONS " +
                            " WHERE (RDB$SYSTEM_FLAG=0 OR RDB$SYSTEM_FLAG IS NULL) AND (RDB$VIEW_BLR IS NULL) ";
                        icommand.Connection = nconnection;
                        icommand.Transaction = ntrans;
                        DataTable relations = null;
                        try
                        {
                            intargs.SQL = "Source: " + oricommand.CommandText;
                            if (SqlExecuter == null)
                            {
                                relations = new DataTable();
                                nadapter.Fill(relations);
                            }
                            else
                            {
                                using (DataSet ndataset = new DataSet())
                                {
                                    SqlExecuter.Open(ndataset, oricommand.CommandText, "DD");
                                    SqlExecuter.Flush();
                                    relations = ndataset.Tables[0];
                                }
                            }
                            foreach (DataRow trow in relations.Rows)
                            {
                                string relname = trow["RDB$RELATION_NAME"].ToString().Trim();
                                trow["RDB$RELATION_NAME"] = relname;
                                int sortIndex = ImportTablesFirst.IndexOf(relname);
                                if (sortIndex >= 0)
                                {
                                    trow["SORT_ORDER"] = sortIndex;
                                }
                            }
                            if (OnlyTables.Count > 0)
                            {
                                List<DataRow> toremove = new List<DataRow>();
                                SortedList<string, string> onlyt = new SortedList<string, string>();
                                foreach (string nexclu in OnlyTables)
                                    onlyt.Add(nexclu.Trim().ToUpper(), nexclu.ToUpper());
                                foreach (DataRow relrow in relations.Rows)
                                {
                                    string relname = relrow[0].ToString().Trim().ToUpper();
                                    if (onlyt.IndexOfKey(relname) < 0)
                                        toremove.Add(relrow);
                                }
                                foreach (DataRow remrow in toremove)
                                    relations.Rows.Remove(remrow);
                            }
                            if (TableConfig != null)
                            {
                                List<DataRow> toremove2 = new List<DataRow>();
                                foreach (DataRow relrow in TableConfig.Rows)
                                {
                                    string tableNameExclude = relrow["TABLENAME"].ToString().ToUpper();
                                    bool found = false;
                                    bool exclude = Convert.ToBoolean(relrow["EXCLUDE"]);
                                    foreach (System.Data.DataRow rtableName in relations.Rows)
                                    {
                                        string relname = rtableName[0].ToString().Trim().ToUpper();
                                        if (relname == tableNameExclude)
                                        {
                                            if (exclude)
                                            {
                                                toremove2.Add(rtableName);
                                                if (SkipTables == null)
                                                    SkipTables = new SortedList<string, string>();
                                                if (SkipTables.IndexOfKey(relname) < 0)
                                                    SkipTables.Add(relname, relname);
                                            }
                                            else
                                                rtableName["SQL_FILTER"] = relrow["FILTER"];
                                            found = true;
                                            break;
                                        }
                                    }
                                    if (!found)
                                    {
                                        throw new Exception("Table in TableConfig not found " + tableNameExclude);
                                    }
                                }
                                foreach (DataRow remrow in toremove2)
                                    relations.Rows.Remove(remrow);
                            }
                            // Get relation fields
                            oricommand.CommandText = "SELECT R.RDB$RELATION_NAME," +
                                "R.RDB$FIELD_NAME,F.RDB$FIELD_TYPE,F.RDB$FIELD_SUB_TYPE, " +
                                " F.RDB$FIELD_SCALE AS ESCALA " +
                                " FROM RDB$RELATIONS REL " +
                                " LEFT OUTER JOIN RDB$RELATION_FIELDS R ON R.RDB$RELATION_NAME=REL.RDB$RELATION_NAME " +
                                " LEFT OUTER JOIN RDB$FIELDS F ON F.RDB$FIELD_NAME = R.RDB$FIELD_SOURCE " +
                                " WHERE (REL.RDB$SYSTEM_FLAG=0 OR REL.RDB$SYSTEM_FLAG IS NULL) AND (REL.RDB$VIEW_BLR IS NULL) " +
                                " AND F.RDB$COMPUTED_SOURCE IS NULL ";
                            DataTable fields = null;
                            try
                            {
                                intargs.SQL = "Source:" + oricommand.CommandText;
                                if (SqlExecuter == null)
                                {
                                    fields = new DataTable();
                                    nadapter.Fill(fields);
                                }
                                else
                                {
                                    using (DataSet ndataset = new DataSet())
                                    {
                                        SqlExecuter.Open(ndataset, oricommand.CommandText, "DD");
                                        SqlExecuter.Flush();
                                        fields = ndataset.Tables[0];
                                    }
                                }
                                foreach (DataRow xrow in fields.Rows)
                                {
                                    string fname = xrow["RDB$FIELD_NAME"].ToString().Trim();
                                    string relname = xrow["RDB$RELATION_NAME"].ToString().Trim();
                                    xrow["RDB$RELATION_NAME"] = relname;
                                    xrow["RDB$FIELD_NAME"] = fname;
                                }

                                using (DataView nview = new DataView(fields, "", "RDB$RELATION_NAME", DataViewRowState.CurrentRows))
                                {
                                    using (DataView nviewrelations = new DataView(relations, "", "SORT_ORDER,RDB$RELATION_NAME", DataViewRowState.CurrentRows))
                                    {
                                        ImportTables(nviewrelations, nview);
                                    }
                                }
                            }
                            finally
                            {
                                fields.Dispose();
                            }
                        }
                        finally
                        {
                            relations.Dispose();
                        }
                    }

                    CurrentOperation = IgnoreErrorFlags.PrimaryKey;
                    intargs.ProgressCount++;
                    InitArgs();
                    intargs.ProgressName = "Primary keys";
                    CheckProgress(true);

                    // 
                    CurrentOperation = IgnoreErrorFlags.PrimaryKey;
                    nresult.Rows.Clear();
                    if (!usedb)
                    {
                        nextract.ExtractPrimaryKey("", nresult, null);
                        if (ImportTablesFirst.Count > 0)
                        {
                            if (nresult.Columns.IndexOf("SORT_ORDER") < 0)
                                nresult.Columns.Add("SORT_ORDER", System.Type.GetType("System.Int32"));
                            foreach (DataRow xrow in nresult.Rows)
                            {
                                string tablename = xrow["TABLE"].ToString().Trim();
                                int index = ImportTablesFirst.IndexOf(tablename);
                                if (index >= 0)
                                {
                                    xrow["SORT_ORDER"] = index;
                                }
                                else
                                {
                                    xrow["SORT_ORDER"] = 9999999;
                                }
                            }
                            nresult.DefaultView.Sort = "SORT_ORDER,TABLE";
                            nresult = nresult.DefaultView.ToTable();
                        }

                        FilterResult(nresult);
                        //ExecuteTable("Primary keys", nresult);
                        //ExecuteTableMultiple("Primary keys", nresult,true);
                        ExecuteTableMultiple("Primary keys", nresult, true);
                    }
                    //


                    CurrentOperation = IgnoreErrorFlags.Index;
                    intargs.ProgressCount++;
                    InitArgs();
                    intargs.ProgressName = "Indexes";
                    CheckProgress(true);

                    nresult.Rows.Clear();
                    if (!usedb)
                    {
                        nextract.ExtractIndex("", "", nresult);
                        FilterResult(nresult);
                        if (ImportTablesFirst.Count > 0)
                        {
                            if (nresult.Columns.IndexOf("SORT_ORDER") < 0)
                                nresult.Columns.Add("SORT_ORDER", System.Type.GetType("System.Int32"));
                            foreach (DataRow xrow in nresult.Rows)
                            {
                                int index = ImportTablesFirst.IndexOf(xrow["TABLE"].ToString());
                                if (index >= 0)
                                {
                                    xrow["SORT_ORDER"] = index;
                                }
                                else
                                {
                                    xrow["SORT_ORDER"] = 9999999;
                                }
                            }
                            nresult.DefaultView.Sort = "SORT_ORDER,TABLE";
                            nresult = nresult.DefaultView.ToTable();
                        }
                        //                        ExecuteTableMultiThread("Indexes", nresult);
                        ExecuteTableMultiple("Indexes", nresult, true);
                    }
                    //
                    CurrentOperation = IgnoreErrorFlags.ForeignKey;
                    intargs.ProgressCount++;
                    InitArgs();
                    intargs.ProgressName = "Foreign keys";
                    CheckProgress(true);


                    nresult.Rows.Clear();
                    if (usedb)
                    {
                        ExecuteTable("Triggers", destinationTriggers);
                        ExecuteTable("Foreigns", destinationForeigns);
                    }
                    if (!usedb)
                    {
                        nextract.ExtractForeign("", "", nresult);
                        FilterResult(nresult);
                        if (ImportTablesFirst.Count > 0)
                        {
                            if (nresult.Columns.IndexOf("SORT_ORDER") < 0)
                                nresult.Columns.Add("SORT_ORDER", System.Type.GetType("System.Int32"));
                            foreach (DataRow xrow in nresult.Rows)
                            {
                                int index = ImportTablesFirst.IndexOf(xrow["TABLE"].ToString());
                                if (index >= 0)
                                {
                                    xrow["SORT_ORDER"] = index;
                                }
                                else
                                {
                                    xrow["SORT_ORDER"] = 9999999;
                                }
                            }
                            nresult.DefaultView.Sort = "SORT_ORDER,TABLE";
                            nresult = nresult.DefaultView.ToTable();
                        }



                        // Remove duplicate foreigns
                        SortedList<string, List<DataRow>> foreignsSorted = new SortedList<string, List<DataRow>>();
                        foreach (DataRow xrow in nresult.Rows)
                        {
                            string source = xrow["SOURCE"].ToString();
                            List<DataRow> lista = null;
                            if (foreignsSorted.IndexOfKey(source) >= 0)
                            {
                                lista = foreignsSorted[source];
                            }
                            else
                            {
                                lista = new List<DataRow>();
                                foreignsSorted.Add(source, lista);
                            }
                            lista.Add(xrow);
                        }
                        foreach (List<DataRow> lrows in foreignsSorted.Values)
                        {
                            if (lrows.Count > 1)
                            {
                                while (lrows.Count > 1)
                                {
                                    nresult.Rows.Remove(lrows[0]);
                                    lrows.Remove(lrows[0]);
                                }
                            }
                        }

                        // Remove foreigns referencing the skipped tables
                        if (SkipTables.Count > 0)
                        {
                            List<DataRow> nremovefor = new List<DataRow>();
                            foreach (DataRow rowfor in nresult.Rows)
                            {
                                string nstring = rowfor["SOURCE"].ToString();
                                int ipos = nstring.IndexOf(" REFERENCES ");
                                if (ipos >= 0)
                                {
                                    nstring = nstring.Substring(ipos + 12, nstring.Length - ipos - 12);
                                    ipos = nstring.IndexOf(' ');
                                    if (ipos >= 0)
                                    {
                                        nstring = nstring.Substring(0, ipos).Trim();
                                        if (nstring[0] == '\"')
                                            nstring = nstring.Substring(1, nstring.Length - 2);
                                        if (SkipTables.IndexOfKey(nstring) >= 0)
                                            nremovefor.Add(rowfor);
                                    }
                                }
                            }
                            foreach (DataRow rowfori in nremovefor)
                            {
                                nresult.Rows.Remove(rowfori);
                            }
                        }
                        if (ForeignKeysParallel)
                        {
                            ExecuteTableMultiple("Foreigns", nresult, true);
                        }
                        else
                        {
                            ExecuteTable("Foreigns", nresult);
                        }
                    }
                    // 
                    CurrentOperation = IgnoreErrorFlags.Generator;
                    intargs.ProgressCount++;
                    InitArgs();
                    intargs.ProgressName = "Generators";
                    CheckProgress(true);


                    nresult.Rows.Clear();
                    if ((!usedb) || (usedb_generators))
                    {
                        nextract.ExtractGenerator("", nresult);
                        // FilterResult(nresult);
                        ExecuteTable("Generators", nresult);
                    }

                    if ((!MetadataOnly) && ((!usedb) || (usedb && usedb_generators)))
                    {
                        nresult.Rows.Clear();
                        oricommand.CommandText = "SELECT RDB$GENERATOR_NAME GNAME,RDB$GENERATOR_ID NID FROM RDB$GENERATORS " +
                            " WHERE RDB$SYSTEM_FLAG=0 OR RDB$SYSTEM_FLAG IS NULL";
                        oricommand.Connection = Connection;
                        oricommand.Transaction = Transaction;
                        intargs.SQL = "Source: " + oricommand.CommandText;
                        using (FbDataReader nreader = oricommand.ExecuteReader())
                        {
                            metacommand.Connection = nconnection;
                            metacommand.Transaction = ntrans;
                            while (nreader.Read())
                            {
                                DataRow grow = nresult.NewRow();
                                grow["NAME"] = nreader["GNAME"].ToString().Trim();
                                nresult.Rows.Add(grow);
                                grow["SOURCE"] = "SET GENERATOR " + QuoteIdentifier(nreader["GNAME"].ToString().Trim()) +
                                    " TO ";
                            }
                        }
                        foreach (DataRow genrow in nresult.Rows)
                        {
                            oricommand.CommandText = "SELECT FIRST 1 GEN_ID(" + QuoteIdentifier(genrow["NAME"].ToString()) + ",0) AS NEWVALUE FROM RDB$RELATIONS ";
                            intargs.SQL = "Source: " + oricommand.CommandText;
                            using (FbDataReader nreader = oricommand.ExecuteReader())
                            {
                                if (!nreader.Read())
                                {
                                    throw new Exception("Error obtaining generator value for: " + genrow["NAME"].ToString());
                                }
                                genrow["SOURCE"] = genrow["SOURCE"].ToString() + nreader[0].ToString();
                            }
                        }
                        ExecuteTableMultiple("Generator values", nresult, false);
                    }

                    //
                    CurrentOperation = IgnoreErrorFlags.View;
                    intargs.ProgressCount++;
                    InitArgs();
                    intargs.ProgressName = "Views";
                    CheckProgress(true);

                    nresult.Rows.Clear();
                    if (!usedb)
                    {
                        nextract.ExtractView("", nresult, true);
                        FilterResult(nresult);
                        ExecuteTable("View", nresult);
                        nresult.Rows.Clear();
                        nextract.ExtractView("", nresult, false);
                        FilterResult(nresult);
                        ExecuteTable("View", nresult);
                    }
                    //
                    CurrentOperation = IgnoreErrorFlags.Exception;
                    intargs.ProgressCount++;
                    InitArgs();
                    intargs.ProgressName = "Exceptions";
                    CheckProgress(true);

                    nresult.Rows.Clear();
                    if (!usedb)
                    {
                        nextract.ExtractException("", nresult);
                        FilterResult(nresult);
                        ExecuteTable("Exceptions", nresult);
                    }
                    //


                    CurrentOperation = IgnoreErrorFlags.Procedure;
                    intargs.ProgressCount++;
                    InitArgs();
                    intargs.ProgressName = "Procedures";
                    CheckProgress(true);

                    if (!usedb)
                    {
                        if (OdsDestinationVersion >= 12)
                        {
                            nresult.Rows.Clear();
                            nextract.ExtractFunction("", nresult, false, FbExtract.ExtractFunctionType.Functions);
                            FilterResult(nresult);
                            ExecuteTableMultiple("Functions", nresult, true);
                        }

                        nresult.Rows.Clear();
                        nextract.ExtractPackages("", nresult, false);
                        FilterResult(nresult);
                        ExecuteTableMultiple("Packages", nresult, true);


                        nresult.Rows.Clear();
                        if (FixMetadata)
                        {
                            nextractfix = new FbExtract(nconnectionfix, ntransfix, destination_dialect);
                            nextractfix.ExtractProcedure("", nresult, false, false);
                        }
                        else
                            nextract.ExtractProcedure("", nresult, false, false);
                        // Fix procedure metadata
                        if (FixMetadata)
                        {
                            foreach (DataRow xrow in nresult.Rows)
                            {
                                xrow["SOURCE"] = NormalizeString(xrow["SOURCE"].ToString());
                            }
                        }
                        FilterResult(nresult);
                        ExecuteTable("Procedures", nresult);
                    }
                    //


                    CurrentOperation = IgnoreErrorFlags.Trigger;
                    intargs.ProgressCount++;
                    InitArgs();
                    intargs.ProgressName = "Triggers";
                    CheckProgress(true);



                    nresult.Rows.Clear();
                    if (!usedb)
                    {
                        if (FixMetadata)
                        {
                            nextractfix = new FbExtract(nconnectionfix, ntransfix, destination_dialect);
                            nextractfix.ExtractTrigger("", "", nresult, false);
                        }
                        else
                            nextract.ExtractTrigger("", "", nresult, false);
                        FilterResult(nresult);


                        // Fix trigger metadata
                        if (FixMetadata)
                        {
                            foreach (DataRow xrow in nresult.Rows)
                            {
                                xrow["SOURCE"] = NormalizeString(xrow["SOURCE"].ToString());
                            }
                        }
                        ExecuteTableMultiple("Triggers", nresult, true);
                    }
                    //
                    CurrentOperation = IgnoreErrorFlags.Check;
                    intargs.ProgressCount++;
                    InitArgs();
                    intargs.ProgressName = "Checks";
                    CheckProgress(true);

                    nresult.Rows.Clear();
                    if (!usedb)
                    {
                        nextract.ExtractCheck("", "", nresult);
                        FilterResult(nresult);
                        ExecuteTable("Checks", nresult);
                    }

                    //
                    CurrentOperation = IgnoreErrorFlags.Role;
                    intargs.ProgressCount++;
                    InitArgs();
                    intargs.ProgressName = "Roles";
                    CheckProgress(true);

                    nresult.Rows.Clear();
                    if (!usedb)
                    {
                        nextract.ExtractRoles("", nresult);
                        ExecuteTable("Roles", nresult);
                    }
                    //
                    intargs.ProgressCount++;
                    InitArgs();
                    intargs.ProgressName = "Roles user";
                    CheckProgress(true);

                    nresult.Rows.Clear();
                    if (!usedb)
                    {
                        nextract.ExtractRolesUser("", "", nresult);
                        ExecuteTable("Roles user", nresult);
                    }
                    //

                    CurrentOperation = IgnoreErrorFlags.Grant;
                    intargs.ProgressCount = intargs.TotalProgressCount;
                    InitArgs();
                    intargs.ProgressName = "Grants";
                    CheckProgress(true);

                    nresult.Rows.Clear();
                    if (!usedb)
                    {
                        nextract.ExtractGrant("", "", nresult);
                        ExecuteTable("Grant", nresult);
                    }

                    // Update generators from main source
                    if (ntrans != null)
                        ntrans.Commit();
                    nconnection.Close();
                    nconnection.Dispose();
                    if (FixMetadata)
                    {
                        ntransfix.Commit();
                        nconnectionfix.Close();
                        nconnectionfix.Dispose();
                    }
                }
                catch (Exception E)
                {
                    try
                    {
                        nconnection.Close();
                        nconnection.Dispose();
                    }
                    catch
                    {

                    }
                    string nmessage = E.Message;
                    nmessage = nmessage + (char)13 + (char)10 + "Error processing: " + intargs.GetFullMessage();
                    nmessage = nmessage + (char)13 + (char)10 + "Exception: " + E.GetType().ToString();
                    nmessage = nmessage + (char)13 + (char)10 + "Call Stack:" + E.StackTrace;
                    WriteLog(nmessage);
                    throw new Exception(nmessage);
                }
            }
            finally
            {
                nconnection = null;
            }
        }
        private void FilterResult(DataTable nresult)
        {
            if (SkipTables.Count > 0)
            {
                List<DataRow> nremove = new List<DataRow>();
                foreach (DataRow xrow in nresult.Rows)
                {
                    if (SkipTables.IndexOfKey(xrow["NAME"].ToString()) >= 0)
                        nremove.Add(xrow);
                }
                foreach (DataRow rrow in nremove)
                    nresult.Rows.Remove(rrow);
            }
        }

        private void InitArgs()
        {
            intargs.Table = "";
            intargs.TableCount = 0;
            intargs.TotalTableCount = 0;
            intargs.TotalRecordCount = 0;
            intargs.RecordCount = 0;
            intargs.SQL = "";
        }
        private void ExecuteTable(string description, DataTable ntable)
        {
            intargs.TotalTableCount = ntable.Rows.Count;
            intargs.TableCount = 0;
            foreach (DataRow xrow in ntable.Rows)
            {
                intargs.Table = xrow[0].ToString().Trim();
                intargs.TableCount++;
                metacommand.CommandText = xrow["SOURCE"].ToString();
                intargs.SQL = "Destination:" + metacommand.CommandText;
                try
                {
                    try
                    {
                        metacommand.ExecuteNonQuery();
                    }
                    catch (Exception ex)
                    {
                        throw;
                    }
                    if (CommitEachItem)
                    {
                        ntrans.Commit();
                        ntrans = nconnection.BeginTransaction(opts);
                        metacommand.Transaction = ntrans;
                    }
                }
                catch (Exception E)
                {
                    if ((int)CurrentOperation == 0)
                        throw new Exception(E.Message + "Ejecutando: " + metacommand.CommandText, E);
                    if ((IgnoreFlags & CurrentOperation) != CurrentOperation)
                    {
                        throw new Exception(E.Message + "Ejecutando: " + metacommand.CommandText, E);
                    }
                    else
                    {
                        if (CommitEachItem)
                        {
                            ntrans.Rollback();
                            ntrans = nconnection.BeginTransaction(opts);
                            metacommand.Transaction = ntrans;
                        }
                    }
                    WriteLog(E.Message + "Ejecutando: " + metacommand.CommandText);
                    if (OnErrorIgnored != null)
                        OnErrorIgnored(this, intargs, E);
                }
                CheckProgress(false);
            }
            CheckProgress(true);
        }

        public void CheckProgress(bool force)
        {
            if (OnProgress != null)
            {
                if (((intargs.RecordCount % RecordProgressInterval) == 0) || force)
                {
                    mmlast = DateTime.Now;

                    nspan = mmlast - mmfirst;
                    if ((nspan.TotalMilliseconds > ProgressInterval) || force)
                    {
                        OnProgress(this, intargs);
                        if (intargs.Cancel)
                            throw new Exception("Operation cancelled");
                        mmfirst = DateTime.Now;
                    }
                }
            }

        }
        public void Dispose()
        {
            if (Transaction != null)
            {
                Transaction.Dispose();
                Transaction = null;
            }
            if (Connection != null)
            {
                Connection.Dispose();
                Connection = null;
            }
        }
        private void DelayCommandToExecute(int nkey, SimpleCommand simpleCommand)
        {
            System.Threading.Monitor.Enter(PendingCommands);
            try
            {
                PendingCommands.Add(nkey, simpleCommand);
                DelayedCommands.Add(nkey, simpleCommand);
            }
            finally
            {
                System.Threading.Monitor.Exit(PendingCommands);
            }
        }
        private SimpleCommand GetCommandToExecute(int threadid, ref int nkey, out bool delayed)
        {
            SimpleCommand nresult = null;
            nkey = -1;
            delayed = false;
            if (ThreadPreAssigned[threadid].Count > 0)
            {
                nresult = ThreadPreAssigned[threadid][0];
                ThreadPreAssigned[threadid].RemoveAt(0);
                return nresult;
            }

            System.Threading.Monitor.Enter(PendingCommands);
            try
            {
                for (int idx = 0; idx < PendingCommands.Count; idx++)
                {
                    int tempkey = PendingCommands.Keys[idx];
                    if (DelayedCommands.ContainsKey(tempkey) && (DelayedCommands.Count < PendingCommands.Count))
                    {
                        continue;
                    }
                    if (DelayedCommands.ContainsKey(tempkey))
                    {
                        delayed = true;
                    }
                    if (CommandTable.IndexOfKey(tempkey) >= 0)
                    {
                        string maintable = CommandTable[tempkey];
                        if (TableAssignedToThread.IndexOfKey(maintable) >= 0)
                        {
                            if (TableAssignedToThread[maintable] != threadid)
                            {
                                continue;
                            }
                        }
                        else
                            TableAssignedToThread.Add(maintable, threadid);
                    }
                    nkey = tempkey;
                    nresult = PendingCommands[nkey];
                    PendingCommands.Remove(nkey);
                    break;
                }
            }
            finally
            {
                System.Threading.Monitor.Exit(PendingCommands);
            }
            return nresult;
        }
        /*        private string GetCommandToExecute(int threadid,ref int nkey)
                {
                    string nresult = "";
                    nkey = -1;
                    if (ThreadPreAssigned[threadid].Count > 0)
                    {
                        nresult = ThreadPreAssigned[threadid][0];
                        ThreadPreAssigned[threadid].RemoveAt(0);
                        return nresult;
                    }
                    System.Threading.Monitor.Enter(PendingCommands);
                    try
                    {
                        for (int i = 0; i < PendingCommands.Count; i++)
                        {
                           nkey = PendingCommands.Keys[i];
                           string tablename = "";
                           if (CommandTable.IndexOfKey(nkey)>=0)
                            {
                                tablename = CommandTable[nkey];
                            }
                            if (tablename.Length > 0)
                            {

                                if (TableThreadId.IndexOfKey(tablename)>=0)
                                {
                                    int threadidtable = TableThreadId[tablename];
                                    if (threadid == threadidtable)
                                    {
                                        nresult = PendingCommands[nkey];
                                        PendingCommands.Remove(nkey);
                                        break;
                                    }
                                    else
                                    {
                                        // Nothing to do busy table
                                    }
                                }
                                else
                                {
                                    TableThreadId.Add(tablename, threadid);
                                    nresult = PendingCommands[nkey];
                                    PendingCommands.Remove(nkey);
                                    break;
                                }

                            }
                            else
                            {
                                nresult = PendingCommands[nkey];
                                PendingCommands.Remove(nkey);
                                break;
                            }
                        }
                    }
                    finally
                    {
                        System.Threading.Monitor.Exit(PendingCommands);
                    }
                    if (nresult.Length == 0)
                        nkey = -1;
                    return nresult;
                }*/
        private void IntExecuteTable(object nid)
        {
            int idxthread = Convert.ToInt32(nid);
            FBCloneEventArgs privateintargs = ThreadCloneEventArgs[idxthread];
            try
            {
                string description = privateintargs.Description;

                FbConnection destconnection = new FbConnection(nconnection.ConnectionString);
                destconnection.Open();
                try
                {
                    FbCommand icommand = new FbCommand();
                    icommand.Connection = destconnection;
                    FbTransactionOptions fbops = new FbTransactionOptions();
                    //fbops.TransactionBehavior = FbTransactionBehavior.ReadCommitted | FbTransactionBehavior.NoWait;
                    fbops.TransactionBehavior = FbTransactionBehavior.ReadCommitted;
                    fbops.WaitTimeout = new TimeSpan(0, 10, 0);

                    icommand.Transaction = destconnection.BeginTransaction(fbops);
                    int nkey = 0;
                    string commandtext = "";
                    bool delayed;
                    SimpleCommand scommand = GetCommandToExecute(idxthread, ref nkey, out delayed);
                    if (scommand != null)
                    {
                        commandtext = scommand.Sql;
                        privateintargs.SQL = commandtext;
                        privateintargs.Table = scommand.Name;
                    }
                    //int retries = 0;
                    while (commandtext.Length > 0)
                    {
                        try
                        {
                            icommand.CommandText = commandtext;
                            privateintargs.SQL = commandtext;
                            icommand.ExecuteNonQuery();
                            if (DoCommitOne)
                            {
                                try
                                {
                                    icommand.Transaction.Commit();
                                }
                                catch
                                {
                                    throw;
                                    /*retries++;
                                    if (retries > 5)
                                        throw;
                                    icommand.Transaction.Rollback();
                                    icommand.Transaction = destconnection.BeginTransaction(fbops);
                                    System.Threading.Thread.Sleep(2000);
                                    continue;*/
                                }
                                icommand.Transaction = icommand.Connection.BeginTransaction(fbops);
                            }
                            System.Threading.Monitor.Enter(TablesInUse);
                            try
                            {
                                TablesInUse[idxthread].Clear();
                            }
                            finally
                            {
                                System.Threading.Monitor.Exit(TablesInUse);
                            }
                            if (CheckBreak(description))
                                break;
                        }
                        catch (Exception ex)
                        {
                            if (ex.Message.IndexOf("deadlock") >= 0)
                            {
                                if (DoCommitOne)
                                {
                                    icommand.Transaction.Rollback();
                                    if (delayed)
                                        System.Threading.Thread.Sleep(10000);
                                    else
                                        System.Threading.Thread.Sleep(1000);
                                    icommand.Transaction = icommand.Connection.BeginTransaction(fbops);
                                    int oldKey = nkey;
                                    commandtext = "";
                                    privateintargs.Table = "";
                                    privateintargs.SQL = "";
                                    SimpleCommand newcommand = GetCommandToExecute(idxthread, ref nkey, out delayed);
                                    if (newcommand != null)
                                    {
                                        DelayCommandToExecute(oldKey, scommand);
                                        scommand = newcommand;
                                        commandtext = scommand.Sql;
                                        privateintargs.SQL = commandtext;
                                        privateintargs.Table = scommand.Name;
                                    }
                                    else
                                    {
                                        System.Threading.Thread.Sleep(10000);
                                        commandtext = scommand.Sql;
                                        privateintargs.SQL = commandtext;
                                        privateintargs.Table = scommand.Name;
                                    }
                                    continue;
                                }
                            }
                            IncludeError("Error executing commmand " + commandtext, ex, idxthread);
                            if (CheckBreak(description))
                                break;
                        }
                        commandtext = "";
                        privateintargs.Table = "";
                        privateintargs.SQL = "";
                        scommand = GetCommandToExecute(idxthread, ref nkey, out delayed);
                        if (scommand != null)
                        {
                            commandtext = scommand.Sql;
                            privateintargs.SQL = commandtext;
                            privateintargs.Table = scommand.Name;
                        }
                        // retries = 0;
                    }
                    icommand.Transaction.Commit();
                }
                finally
                {
                    destconnection.Dispose();
                }
                privateintargs.Finished = true;
            }
            catch (Exception ex)
            {
                IncludeError("Error executing table commands", ex, idxthread);
                privateintargs.Finished = true;
            }
        }
        private bool CheckBreak(string description)
        {
            if (ThreadErrors.Count == 0)
                return false;
            switch (description)
            {
                case "Primary keys":
                    if (IgnoreFlags.HasFlag(IgnoreErrorFlags.PrimaryKey))
                        return false;
                    else
                        return true;
                case "Tables":
                    if (IgnoreFlags.HasFlag(IgnoreErrorFlags.Table))
                        return false;
                    else
                        return true;
                case "Indexes":
                    if (IgnoreFlags.HasFlag(IgnoreErrorFlags.Index))
                        return false;
                    else
                        return true;
                case "Foreigns":
                    if (IgnoreFlags.HasFlag(IgnoreErrorFlags.ForeignKey))
                        return false;
                    else
                        return true;
                case "Triggers":
                    if (IgnoreFlags.HasFlag(IgnoreErrorFlags.Trigger))
                        return false;
                    else
                        return true;
                case "Generator values":
                    if (IgnoreFlags.HasFlag(IgnoreErrorFlags.Generator))
                        return false;
                    else
                        return true;
                case "Procedures":
                    if (IgnoreFlags.HasFlag(IgnoreErrorFlags.Procedure))
                        return false;
                    else
                        return true;
                case "Functions":
                    if (IgnoreFlags.HasFlag(IgnoreErrorFlags.Function))
                        return false;
                    else
                        return true;
                case "Packages":
                    if (IgnoreFlags.HasFlag(IgnoreErrorFlags.Packages))
                        return false;
                    else
                        return true;
                default:
                    throw new Exception("Description to decide break unknwon: " + description);
            }
        }
        SortedList<int, SimpleCommand> PendingCommands = new SortedList<int, SimpleCommand>();
        SortedList<int, SimpleCommand> DelayedCommands = new SortedList<int, SimpleCommand>();
        SortedList<int, string> CommandTable = new SortedList<int, string>();
        SortedList<string, int> TableThreadId = new SortedList<string, int>();
        SortedList<int, List<SimpleCommand>> ThreadPreAssigned = new SortedList<int, List<SimpleCommand>>();
        SortedList<int, string> ReferenceTable = new SortedList<int, string>();
        SortedList<int, FBCloneEventArgs> ThreadCloneEventArgs = new SortedList<int, FBCloneEventArgs>();
        SortedList<int, SortedList<string, string>> TablesInUse = new SortedList<int, SortedList<string, string>>();
        SortedList<int, string> ThreadErrors = new SortedList<int, string>();
        SortedList<string, int> TableAssignedToThread = new SortedList<string, int>();
        // No possible to allow multithread creation (table in use for foreign keys)
        //int ProcessorCount = 4;
        bool DoCommitOne;
        private void ExecuteTableMultiple(string description, DataTable ntable, bool ndocommitone)
        {
            ntrans.Commit();
            nconnection.Close();
            DoCommitOne = ndocommitone;
            intargs.TotalTableCount = ntable.Rows.Count;
            intargs.TableCount = 0;
            PendingCommands.Clear();
            DelayedCommands.Clear();
            TableAssignedToThread.Clear();
            CommandTable.Clear();
            ReferenceTable.Clear();
            TableThreadId.Clear();
            ThreadPreAssigned.Clear();
            ThreadCloneEventArgs.Clear();
            TablesInUse.Clear();
            ThreadErrors.Clear();

            for (int i = 0; i < IndexingThreads; i++)
            {
                ThreadPreAssigned.Add(i, new List<SimpleCommand>());
                var cloneArgs = new FBCloneEventArgs();

                cloneArgs.Description = description;
                ThreadCloneEventArgs.Add(i, cloneArgs);
                TablesInUse.Add(i, new SortedList<string, string>());
            }

            int idx = 0;
            foreach (DataRow xrow in ntable.Rows)
            {
                idx++;
                string source = xrow["SOURCE"].ToString();
                string name = xrow["NAME"].ToString();
                if (name == "INSERTAR_LINEA_ART_PROV_PRECIO_5DESC")
                {

                }
                PendingCommands.Add(idx, new SimpleCommand(name, source));
                if (description == "Triggers")
                {
                    string tablename = xrow["TABLE"].ToString();
                    CommandTable.Add(idx, tablename);
                    //string referenced = xrow["TABLE"].ToString();
                    //ReferenceTable.Add(idx, referenced);
                }
                if ((description == "Foreigns") || (description == "Primary keys"))
                {
                    intargs.ProgressName = description;
                    string tablename = xrow["TABLE"].ToString();
                    //string referenced = xrow["REFERENCES"].ToString();
                    CommandTable.Add(idx, tablename);
                    //ReferenceTable.Add(idx, referenced);
                }
            }
            //            if ((description == "Foreigns") || (description == "Triggers"))
            if ((description == "Foreignsx"))
            {
                // Distribute foreigns first to avoid interrelation conflict
                while (PendingCommands.Count != 0)
                {
                    int idxthread = -1;
                    int mincommands = int.MaxValue;
                    for (int i = 0; i < IndexingThreads; i++)
                    {
                        if (ThreadPreAssigned[i].Count < mincommands)
                        {
                            idxthread = i;
                            mincommands = ThreadPreAssigned[i].Count;
                        }
                    }
                    int nkey = PendingCommands.Keys[0];
                    SimpleCommand scommand = PendingCommands[nkey];
                    string newcommand = "";
                    if (scommand != null)
                        newcommand = scommand.Sql;
                    PendingCommands.Remove(nkey);

                    ThreadPreAssigned[idxthread].Add(scommand);
                    SortedList<string, string> TablesUsed = new SortedList<string, string>();
                    string ntable1 = ReferenceTable[nkey];
                    string ntable2 = CommandTable[nkey];
                    FindRelatedForeignCommands(ntable1, TablesUsed);
                    FindRelatedForeignCommands(ntable2, TablesUsed);
                    foreach (string tablename in TablesUsed.Keys)
                    {
                        List<int> lnewkeys = new List<int>();
                        foreach (int idxcommand in PendingCommands.Keys)
                        {
                            if ((CommandTable[idxcommand] == tablename) || (ReferenceTable[idxcommand] == tablename))
                                lnewkeys.Add(idxcommand);
                        }
                        foreach (int newkey in lnewkeys)
                        {
                            ThreadPreAssigned[idxthread].Add(PendingCommands[newkey]);
                            PendingCommands.Remove(newkey);
                        }
                    }
                }

            }


            List<System.Threading.Thread> ThreadList = new List<System.Threading.Thread>();
            for (int i = 0; i < IndexingThreads; i++)
            {
                System.Threading.Thread newthread = new System.Threading.Thread(new System.Threading.ParameterizedThreadStart(IntExecuteTable));
                ThreadList.Add(newthread);
                FBCloneEventArgs privateintargs = ThreadCloneEventArgs[i];
                newthread.Start(i);
            }
            if (OnProgress != null)
            {
                while (ThreadList.Count > 0)
                {
                    System.Threading.Thread newthread = ThreadList[0];
                    if (!newthread.Join(500))
                    {
                        int preassigned = 0;
                        foreach (int idxth in ThreadPreAssigned.Keys)
                            preassigned = preassigned + ThreadPreAssigned[idxth].Count;
                        intargs.TableCount = intargs.TotalTableCount - this.PendingCommands.Count - preassigned;
                        intargs.RecordCount = 0;
                        StringBuilder nmessage = new StringBuilder();
                        StringBuilder nmessageSQL = new StringBuilder();
                        for (int i = 0; i < ThreadList.Count; i++)
                        {
                            FBCloneEventArgs args = ThreadCloneEventArgs[i];
                            if ((!args.Finished) && ((args.Table != null && args.Table.Length > 0) || (args.SQL.Length > 0)))
                            {
                                if (nmessage.Length > 0)
                                    nmessage.Append(" - ");
                                if (nmessageSQL.Length > 0)
                                    nmessageSQL.Append(" - ");
                                nmessage.Append(args.Table);
                                nmessageSQL.Append(args.SQL);
                            }
                        }

                        intargs.SQL = nmessageSQL.ToString();
                        intargs.Table = nmessage.ToString();
                        try
                        {
                            CheckProgress(true);
                        }
                        catch
                        {
                            for (int i = 0; i < ThreadList.Count; i++)
                            {
                                FBCloneEventArgs args = ThreadCloneEventArgs[i];
                                args.Cancel = true;
                            }
                            throw;
                        }
                    }
                    else
                        ThreadList.RemoveAt(0);
                }
            }
            else
            {
                foreach (System.Threading.Thread newthread in ThreadList)
                {
                    newthread.Join();
                }

            }
            StringBuilder errors = new StringBuilder();
            foreach (int idxKey in ThreadErrors.Keys)
            {
                string errormessage = ThreadErrors[idxKey];
                errors.AppendLine(errormessage);
            }
            if (errors.Length > 0)
            {
                WriteLog(errors.ToString());
                if (CheckBreak(description))
                {
                    throw new Exception(errors.ToString());
                }
            }
            //ntrans.Commit();
            nconnection.Open();
            ntrans = nconnection.BeginTransaction(opts);
            metacommand.Transaction = ntrans;
            icommand.Transaction = ntrans;
        }
        string LogFileName = "";
        private void WriteLog(string message)
        {
            string newMessage = System.DateTime.Now.ToString("dd/MM/yyyy HH:mm:ss ") + message;
            if (WriteLogFile)
            {
                if (LogFileName.Length == 0)
                {
                    LogFileName = System.Reflection.Assembly.GetExecutingAssembly().Location;
                    LogFileName = System.IO.Path.GetDirectoryName(LogFileName);
                    LogFileName = System.IO.Path.Combine(LogFileName, "copy.log");
                }
                using (StreamWriter writer = new StreamWriter(LogFileName, true, Encoding.UTF8))
                {
                    writer.WriteLine(newMessage);
                }
            }
            OnLog?.Invoke(this, newMessage);
        }
        private void FindRelatedForeignCommands(string tablename, SortedList<string, string> TablesUsed)
        {
            if (TablesUsed.IndexOfKey(tablename) < 0)
            {
                TablesUsed.Add(tablename, tablename);
                foreach (int idx in PendingCommands.Keys)
                {
                    string ntable1 = ReferenceTable[idx];
                    string ntable2 = CommandTable[idx];
                    if ((ntable1 == tablename) || (ntable2 == tablename))
                    {
                        FindRelatedForeignCommands(ntable1, TablesUsed);
                        FindRelatedForeignCommands(ntable2, TablesUsed);
                    }
                }
            }
        }

        private string GetTableToRead(ref string sqlFilter)
        {
            string nresult = "";
            System.Threading.Monitor.Enter(PendingTables);
            try
            {
                if (PendingTables.Count > 0)
                {
                    nresult = PendingTables.Keys[0];
                    sqlFilter = PendingTables[nresult];
                    PendingTables.Remove(nresult);
                }
            }
            finally
            {
                System.Threading.Monitor.Exit(PendingTables);
            }
            return nresult;
        }
        SortedList<string, string> PendingTables = new SortedList<string, string>();
        DataView FieldsView;
        private class ImportTableThread
        {
            public FbConnection OriConnection;
            public FbTransaction OriTransaction;
            public FbConnection DestConnection;
            public FbTransaction DestTransaction;
            public FbCommand OriCommand;
            public FbCommand DestCommand;
            public long TransactionId;
            public int IdxThread;
            public List<ImportTableThread> AdditionalSharedConnections;
        }
        private void ImportTables(DataView relations, DataView fields)
        {
            FieldsView = fields;
            PendingTables.Clear();
            ThreadCloneEventArgs.Clear();
            ThreadPreAssigned.Clear();
            ThreadErrors.Clear();
            for (int i = 0; i < ReadingThreads; i++)
            {
                ThreadCloneEventArgs.Add(i, new FBCloneEventArgs());
            }

            InitArgs();
            intargs.TotalTableCount = relations.Count;
            foreach (DataRowView tablerow in relations)
            {
                string tablename = tablerow[0].ToString().Trim();
                string filter = tablerow[1].ToString().Trim();
                PendingTables.Add(tablename, filter);
            }
            List<ImportTableThread> ThreadConnectionsConsecutive = new List<ImportTableThread>();
            {
                List<ImportTableThread> ThreadConnections = new List<ImportTableThread>();
                List<ImportTableThread> AdditionalSharedConnections = new List<ImportTableThread>();
                // Try to start consecutive transactions

                for (int i = 0; i < ReadingThreads; i++)
                {
                    ImportTableThread newThread = new ImportTableThread();
                    newThread.IdxThread = i;
                    newThread.OriConnection = new FbConnection(Connection.ConnectionString);
                    newThread.OriConnection.Open();
                    newThread.AdditionalSharedConnections = AdditionalSharedConnections;
                    ThreadConnections.Add(newThread);
                }
                for (int i = 0; i < ReadingThreads; i++)
                {
                    ThreadConnections[i].OriTransaction = ThreadConnections[i].OriConnection.BeginTransaction(IsolationLevel.Snapshot);
                }
                for (int i = 0; i < ReadingThreads; i++)
                {
                    ThreadConnections[i].OriCommand = new FbCommand();
                    ThreadConnections[i].OriCommand.Connection = ThreadConnections[i].OriConnection;
                    ThreadConnections[i].OriCommand.Transaction = ThreadConnections[i].OriTransaction;
                    ThreadConnections[i].OriCommand.CommandText = "SELECT CURRENT_TRANSACTION AS TRAN_ID FROM RDB$DATABASE";
                    using (var reader = ThreadConnections[i].OriCommand.ExecuteReader())
                    {
                        reader.Read();
                        ThreadConnections[i].TransactionId = Convert.ToInt64(reader[0]);
                    }
                    if (i == 0)
                    {
                        ThreadConnectionsConsecutive.Add(ThreadConnections[i]);
                    }
                    else
                    {
                        long diff = ThreadConnections[i].TransactionId - ThreadConnections[i - 1].TransactionId;
                        if (diff > 1)
                        {
                            for (int j = i; j < ReadingThreads; j++)
                            {
                                ThreadConnections[j].OriConnection.Close();
                            }
                            break;
                        }
                        else
                            ThreadConnectionsConsecutive.Add(ThreadConnections[i]);
                    }
                }
            }
            List<System.Threading.Thread> ThreadList = new List<System.Threading.Thread>();
            for (int i = 0; i < ThreadConnectionsConsecutive.Count; i++)
            {
                ImportTableThread threadInfo = ThreadConnectionsConsecutive[i];

                System.Threading.Thread newthread = new System.Threading.Thread(new System.Threading.ParameterizedThreadStart(ImportTable));
                ThreadList.Add(newthread);
            }
            for (int i = 0; i < ThreadConnectionsConsecutive.Count; i++)
            {
                ThreadConnectionsConsecutive[i].DestConnection = new FbConnection(nconnection.ConnectionString);
                ThreadConnectionsConsecutive[i].DestConnection.Open();
                ThreadConnectionsConsecutive[i].DestTransaction = ThreadConnectionsConsecutive[i].DestConnection.BeginTransaction(IsolationLevel.ReadCommitted);
                ThreadConnectionsConsecutive[i].DestCommand = new FbCommand();
                ThreadConnectionsConsecutive[i].DestCommand.Connection = ThreadConnectionsConsecutive[i].DestConnection;
                ThreadConnectionsConsecutive[i].DestCommand.Transaction = ThreadConnectionsConsecutive[i].DestTransaction;
            }
            try
            {
                for (int i = 0; i < ThreadList.Count; i++)
                {
                    ThreadList[i].Start(ThreadConnectionsConsecutive[i]);
                }
                if (OnProgress != null)
                {
                    while (ThreadList.Count > 0)
                    {
                        System.Threading.Thread newthread = ThreadList[0];
                        if (!newthread.Join(500))
                        {
                            intargs.TableCount = intargs.TotalTableCount - PendingTables.Count;
                            intargs.RecordCount = -1;
                            StringBuilder nmessage = new StringBuilder();
                            for (int i = 0; i < ThreadCloneEventArgs.Count; i++)
                            {
                                FBCloneEventArgs args = ThreadCloneEventArgs[i];
                                if ((!args.Finished) && (args.Table != null && args.Table.Length > 0))
                                {
                                    if (nmessage.Length > 0)
                                        nmessage.Append(" - ");
                                    nmessage.Append(args.Table);
                                    nmessage.Append(" ");
                                    nmessage.Append(args.RecordCount.ToString("N0"));
                                    if (args.TotalRecordCount > 0)
                                    {
                                        nmessage.Append(" of ");
                                        nmessage.Append(args.TotalRecordCount.ToString("N0"));
                                    }
                                }
                            }
                            intargs.SQL = nmessage.ToString();
                            try
                            {
                                CheckProgress(true);
                            }
                            catch
                            {
                                for (int i = 0; i < ThreadList.Count; i++)
                                {
                                    FBCloneEventArgs args = ThreadCloneEventArgs[i];
                                    args.Cancel = true;
                                }
                                throw;
                            }
                        }
                        else
                            ThreadList.RemoveAt(0);
                    }
                }
                else
                {
                    foreach (System.Threading.Thread newthread in ThreadList)
                    {
                        newthread.Join();
                    }

                }
            }
            finally
            {
                for (int i = 0; i < ThreadConnectionsConsecutive.Count; i++)
                {
                    var tableThread = ThreadConnectionsConsecutive[i];
                    if (tableThread.DestTransaction != null)
                    {
                        tableThread.DestTransaction.Commit();
                        tableThread.DestTransaction.Dispose();
                        tableThread.DestTransaction = null;
                    }
                    tableThread.DestConnection.Close();
                    tableThread.DestConnection.Dispose();


                    tableThread.DestCommand.Dispose();
                }
            }
            StringBuilder errors = new StringBuilder();
            foreach (int idxKey in ThreadErrors.Keys)
            {
                string errormessage = ThreadErrors[idxKey];
                errors.AppendLine(errormessage);
            }
            if (errors.Length > 0)
            {
                WriteLog(errors.ToString());
                if (CheckBreak("Tables"))
                {
                    throw new Exception(errors.ToString());
                }
            }
        }

        private void ImportTable(object objidxthread)
        {
            ImportTableThread threadInfo = (ImportTableThread)objidxthread;
            List<ImportTableThread> threadInfoQueue = new List<ImportTableThread>();
            List<FbConnection> ConnectionsToClose = new List<FbConnection>();
            List<FbTransaction> TransactionsToClose = new List<FbTransaction>();
            List<List<FbCommand>> Commands = new List<List<FbCommand>>();
            threadInfoQueue.Add(threadInfo);
            int idxthread = threadInfo.IdxThread;
            FBCloneEventArgs intargs = ThreadCloneEventArgs[idxthread];
            try
            {
                string sqlFilter = "";
                string tablename = GetTableToRead(ref sqlFilter);
                FbCommand oricommand = threadInfo.OriCommand;
                List<System.Threading.Tasks.Task> taskList = new List<System.Threading.Tasks.Task>();
                int MAX_COMMANDS_SERIE = RecordGroupCount;
                while (tablename.Length > 0)
                {
                    FbCommand icommand = threadInfo.DestCommand;
                    try
                    {
                        SortedList<string, DataRow> allfields = new SortedList<string, DataRow>();
                        //intargs.TableCount = relindx + 1;
                        //string tablename = relations.Rows[relindx][0].ToString().Trim();
                        intargs.Table = tablename;
                        //CheckProgress(true);
                        DataRowView[] vfields = FieldsView.FindRows(tablename);
                        string isqlfields = "";
                        string isqlparams = "";
                        icommand.Parameters.Clear();
                        int idxparam = 0;
                        foreach (DataRowView vfield in vfields)
                        {
                            string fnname = vfield["RDB$FIELD_NAME"].ToString();
                            allfields.Add(fnname, vfield.Row);
                        }
                        intargs.TotalRecordCount = 0;
                        SortedList<string, int> fieldLenghts = null;
                        if (destinationFieldsView != null)
                        {
                            DataRowView[] vrows = destinationFieldsView.FindRows(tablename);
                            foreach (DataRowView vrow in vrows)
                            {
                                if (fieldLenghts == null)
                                    fieldLenghts = new SortedList<string, int>();
                                if (vrow["LENGTH"] != DBNull.Value)
                                    fieldLenghts.Add(vrow["FIELD"].ToString(), Convert.ToInt32(vrow["LENGTH"]));
                                else
                                    if (vrow["CHARSET"].ToString().Length > 0)
                                {
                                    fieldLenghts.Add(vrow["FIELD"].ToString(), Int32.MaxValue);
                                }
                            }
                        }
                        //if ((CountRecords) && (tablename != "LINALBA"))
                        if ((CountRecords))
                        {
                            string selects = "";
                            foreach (string sfiename in allfields.Keys)
                            {
                                if (selects.Length > 0)
                                    selects = selects + ",";
                                else
                                    selects = "COUNT(*) AS RDB$COUNTTOTAL,";
                                selects = selects + "COUNT(" + QuoteIdentifier(sfiename) + ") AS " + QuoteIdentifier(sfiename);
                            }
                            string cadSql = "SELECT " + selects + " FROM  " + QuoteIdentifier(tablename);
                            if (sqlFilter.Length > 0)
                            {
                                cadSql = cadSql + " WHERE " + sqlFilter;
                            }
                            oricommand.CommandText = cadSql;
                            if (SkipTables.IndexOfKey(tablename) < 0)
                            {
                                intargs.SQL = "Source: " + oricommand.CommandText;
                                if (SqlExecuter != null)
                                {
                                    using (DataSet ndataset = new DataSet())
                                    {
                                        SqlExecuter.Open(ndataset, oricommand.CommandText, "DD");
                                        SqlExecuter.Flush();
                                        DataTable tresult = ndataset.Tables[0];
                                        DataRow creader = tresult.Rows[0];
                                        for (int idxref = 0; idxref < tresult.Columns.Count; idxref++)
                                        {
                                            string fname = tresult.Columns[idxref].ColumnName;
                                            if (fname == "RDB$COUNTTOTAL")
                                            {
                                                if (creader[idxref] != DBNull.Value)
                                                    intargs.TotalRecordCount = System.Convert.ToInt32(creader[idxref]);
                                            }
                                            else
                                            {
                                                if (creader[idxref] == DBNull.Value)
                                                    allfields.Remove(fname);
                                                else
                                                {
                                                    if (System.Convert.ToInt32(creader[idxref]) == 0)
                                                        allfields.Remove(fname);
                                                }
                                            }
                                        }


                                    }
                                }
                                else
                                {
                                    FbDataReader creader;
                                    System.Threading.Monitor.Enter(PendingTables);
                                    try
                                    {
                                        creader = oricommand.ExecuteReader();
                                    }
                                    finally
                                    {
                                        System.Threading.Monitor.Exit(PendingTables);
                                    }
                                    try
                                    {
                                        creader.Read();
                                        for (int idxref = 0; idxref < creader.FieldCount; idxref++)
                                        {
                                            string fname = creader.GetName(idxref);
                                            if (fname == "RDB$COUNTTOTAL")
                                            {
                                                if (creader[idxref] != DBNull.Value)
                                                    intargs.TotalRecordCount = System.Convert.ToInt32(creader[idxref]);
                                            }
                                            else
                                            {
                                                if (creader[idxref] == DBNull.Value)
                                                    allfields.Remove(fname);
                                                else
                                                {
                                                    if (System.Convert.ToInt32(creader[idxref]) == 0)
                                                        allfields.Remove(fname);
                                                }
                                            }
                                        }
                                    }
                                    finally
                                    {
                                        creader.Dispose();
                                    }
                                }
                            }
                        }
                        icommand.Parameters.Clear();
                        foreach (string sfield in allfields.Keys)
                        {
                            DataRow vfield = allfields[sfield];
                            if (isqlfields.Length > 0)
                                isqlfields = isqlfields + ",";
                            if (isqlparams.Length > 0)
                                isqlparams = isqlparams + ",";
                            isqlfields = isqlfields + QuoteIdentifier(sfield);
                            //isqlparams = isqlparams + "@" + sfield;
                            isqlparams = isqlparams + "?";
                            int sub_type = 0;
                            if (vfield["RDB$FIELD_SUB_TYPE"] != DBNull.Value)
                                sub_type = System.Convert.ToInt32(vfield["RDB$FIELD_SUB_TYPE"]);
                            FbDbType ntype = InternalTypeToParamType(System.Convert.ToInt32(vfield["RDB$FIELD_TYPE"]),
                                System.Convert.ToInt32(vfield["ESCALA"]), sub_type);
                            //FbParameter nparam = new FbParameter(sfield,ntype);
                            FbParameter nparam = new FbParameter();
                            nparam.FbDbType = ntype;
                            if ((nparam.DbType == DbType.Binary) && CountRecords && (fieldLenghts != null))
                            {
                                if (fieldLenghts.IndexOfKey(sfield) >= 0)
                                    nparam.DbType = DbType.String;
                            }
                            nparam.ParameterName = idxparam.ToString();
                            icommand.Parameters.Add(nparam);

                            idxparam++;
                        }
                        string cadSql2 = "SELECT " + isqlfields + " FROM " + QuoteIdentifier(tablename);
                        if (sqlFilter.Length > 0)
                        {
                            cadSql2 = cadSql2 + " WHERE " + sqlFilter;
                        }

                        oricommand.CommandText = cadSql2;
                        icommand.CommandText = "INSERT INTO " + QuoteIdentifier(tablename) + " ( " + isqlfields + " ) " +
                            " VALUES (" + isqlparams + ")";

                        foreach (var commandL in Commands)
                        {
                            foreach (var cm in commandL)
                            {
                                CloneCommand(icommand, cm);
                            }
                        }

                        if ((allfields.Count > 0) && (SkipTables.IndexOfKey(tablename) < 0))
                        {
                            int paramcount = icommand.Parameters.Count;
                            intargs.SQL = "Source :" + oricommand.CommandText;
                            intargs.Table = tablename;

                            FbDataReader nreader;
                            System.Threading.Monitor.Enter(PendingTables);
                            try
                            {
                                nreader = oricommand.ExecuteReader();
                            }
                            finally
                            {
                                System.Threading.Monitor.Exit(PendingTables);
                            }
                            try
                            {
                                DateTime mmFirst = DateTime.Now;
                                intargs.SQL = "Destination: " + icommand.CommandText;
                                int idxrecord = 0;
                                int idxTask = -1;
                                int idxCommandTask = 0;
                                List<FbCommand> CommandList = new List<FbCommand>();
                                bool newTask = Commands.Count > 0;
                                if (newTask)
                                {
                                    idxCommandTask = 0;
                                }
                                while (nreader.Read())
                                {
                                    idxrecord++;
                                    if (newTask)
                                    {
                                        int idxCompleted = System.Threading.Tasks.Task.WaitAny(taskList.ToArray());
                                        var completedTask = taskList[idxCompleted];
                                        if (completedTask.Exception != null)
                                        {
                                            throw completedTask.Exception;
                                        }
                                        CommandList = Commands[idxCompleted];
                                        idxTask = idxCompleted;
                                        idxCommandTask = 0;
                                        newTask = false;
                                    }
                                    if (CommandList.Count > 0)
                                    {
                                        icommand = CommandList[idxCommandTask];
                                    }
                                    if (CountRecords && (fieldLenghts != null))
                                    {
                                        for (int i = 0; i < paramcount; i++)
                                        {
                                            int maxLength = 0;
                                            string nombre = nreader.GetName(i);
                                            if (fieldLenghts.TryGetValue(nombre, out maxLength))
                                            {
                                                object valor = nreader[i];

                                                if (valor != DBNull.Value)
                                                {
                                                    if (valor is byte[])
                                                    {
                                                        valor = UTF8Encoding.UTF8.GetString((byte[])valor).TrimEnd();
                                                    }
                                                    else
                                                        valor = valor.ToString().TrimEnd();
                                                    if (valor.ToString().Length > maxLength)
                                                    {
                                                        valor = valor.ToString().Substring(0, maxLength);
                                                        StringBuilder mensaje = new StringBuilder();

                                                        mensaje.AppendLine("Longitud excedida tabla " + tablename + " campo: " + nombre);
                                                        mensaje.AppendLine("Excepción en ExecuteNonQuery: Comando ");
                                                        mensaje.AppendLine(icommand.CommandText);
                                                        mensaje.AppendLine("Valores de parámetros: ");
                                                        for (int idx = 0; idx < paramcount; idx++)
                                                        {
                                                            mensaje.AppendLine(nreader.GetName(idx) + "=" + nreader[idx].ToString());
                                                        }
                                                        if (OnErrorIgnored != null)
                                                            OnErrorIgnored(this, intargs, new Exception(mensaje.ToString()));
                                                    }
                                                }
                                                icommand.Parameters[i].Value = valor;
                                            }
                                            else
                                                icommand.Parameters[i].Value = nreader[i];
                                        }
                                    }
                                    else
                                    {
                                        for (int i = 0; i < paramcount; i++)
                                        {
                                            icommand.Parameters[i].Value = nreader[i];
                                        }
                                    }
                                    try
                                    {
                                        if (threadInfoQueue.Count == 1)
                                        {
                                            icommand.ExecuteNonQuery();
                                        }
                                        else
                                        {
                                            idxCommandTask++;
                                            if (idxCommandTask >= MAX_COMMANDS_SERIE)
                                            {
                                                FbCommand[] arrayCommand = CommandList.ToArray();
                                                var task = new System.Threading.Tasks.Task(() =>
                                                {
                                                    var qinfo = threadInfo;
                                                    for (int idxq = 0; idxq < MAX_COMMANDS_SERIE; idxq++)
                                                    {
                                                        var xcommand = arrayCommand[idxq];
                                                        xcommand.ExecuteNonQuery();
                                                    }
                                                });
                                                task.ConfigureAwait(false);
                                                taskList[idxTask] = task;
                                                task.Start();
                                                idxCommandTask = 0;
                                                newTask = true;
                                            }
                                        }
                                        if (MAX_COMMANDS_SERIE > 1)
                                        {
                                            DateTime mmLast = DateTime.Now;
                                            if ((mmLast - mmFirst).TotalSeconds > 5)
                                            {
                                                mmFirst = mmLast;
                                                ImportTableThread newThread = null;
                                                lock (threadInfo.AdditionalSharedConnections)
                                                {
                                                    if (threadInfo.AdditionalSharedConnections.Count > 0)
                                                    {
                                                        newThread = threadInfo.AdditionalSharedConnections[0];
                                                        threadInfo.AdditionalSharedConnections.RemoveAt(0);
                                                    }
                                                }
                                                if (newThread != null)
                                                {
                                                    if (threadInfoQueue.Count == 1)
                                                    {
                                                        List<FbCommand> newCommands = new List<FbCommand>();
                                                        var tcs2 = new System.Threading.Tasks.TaskCompletionSource<bool>();
                                                        tcs2.SetResult(true);
                                                        taskList.Add(tcs2.Task);
                                                        for (int idx = 0; idx < MAX_COMMANDS_SERIE; idx++)
                                                        {
                                                            FbCommand ncommand = new FbCommand();
                                                            ncommand.Connection = threadInfo.DestConnection;
                                                            ncommand.Transaction = threadInfo.DestTransaction;
                                                            CloneCommand(threadInfo.DestCommand, ncommand);
                                                            newCommands.Add(ncommand);
                                                        }
                                                        Commands.Add(newCommands);
                                                        idxCommandTask = 0;
                                                        newTask = true;
                                                    }
                                                    FbConnection nconnection = new FbConnection(threadInfo.DestConnection.ConnectionString);
                                                    nconnection.Open();
                                                    ConnectionsToClose.Add(nconnection);
                                                    var ntrans = nconnection.BeginTransaction();
                                                    TransactionsToClose.Add(ntrans);
                                                    threadInfoQueue.Add(newThread);

                                                    intargs.Table = threadInfoQueue.Count.ToString() + " X " + tablename;


                                                    var tcs = new System.Threading.Tasks.TaskCompletionSource<bool>();
                                                    tcs.SetResult(true);
                                                    taskList.Add(tcs.Task);
                                                    List<FbCommand> newCommands2 = new List<FbCommand>();
                                                    Commands.Add(newCommands2);
                                                    for (int idx = 0; idx < MAX_COMMANDS_SERIE; idx++)
                                                    {
                                                        FbCommand ncommand = new FbCommand();
                                                        ncommand.Connection = nconnection;
                                                        ncommand.Transaction = ntrans;
                                                        CloneCommand(threadInfo.DestCommand, ncommand);
                                                        newCommands2.Add(ncommand);
                                                    }
                                                }
                                            }
                                        }
                                    }
                                    catch (Exception E)
                                    {
                                        if ((IgnoreFlags & CurrentOperation) != CurrentOperation)
                                        {
                                            StringBuilder mensaje = new StringBuilder();
                                            mensaje.AppendLine(E.Message);
                                            mensaje.AppendLine("Excepción en ExecuteNonQuery: Comando ");
                                            mensaje.AppendLine(icommand.CommandText);
                                            mensaje.AppendLine("Valores de parámetros: ");
                                            for (int i = 0; i < paramcount; i++)
                                            {
                                                mensaje.AppendLine(nreader.GetName(i) + "=" + nreader[i].ToString());
                                            }

                                            throw new Exception(mensaje.ToString());
                                        }
                                        if (OnErrorIgnored != null)
                                            OnErrorIgnored(this, intargs, E);
                                    }
                                    intargs.RecordCount = idxrecord;
                                    if (intargs.Cancel)
                                        throw new Exception("Operation cancelled");
                                    if ((ThreadErrors.Count > 0) && (!IgnoreFlags.HasFlag(IgnoreErrorFlags.Table)))
                                    {
                                        break;
                                    }
                                    //CheckProgress(false);
                                }
                                if ((!newTask) && (idxCommandTask > 0))
                                {
                                    List<FbCommand> newCommandList = new List<FbCommand>();
                                    for (int idxC = 0; idxC < idxCommandTask; idxC++)
                                    {
                                        newCommandList.Add(CommandList[idxC]);
                                    }
                                    FbCommand[] arrayCommand = newCommandList.ToArray();
                                    var task = new System.Threading.Tasks.Task(() =>
                                    {
                                        foreach (var xcommand in arrayCommand)
                                        {
                                            xcommand.ExecuteNonQuery();
                                        }
                                    });
                                    task.ConfigureAwait(false);
                                    taskList[idxTask] = task;
                                    task.Start();
                                }
                                System.Threading.Tasks.Task.WaitAll(taskList.ToArray());
                                foreach (var completedTask in taskList)
                                {
                                    if (completedTask.Exception != null)
                                    {
                                        throw completedTask.Exception;
                                    }
                                }
                            }
                            finally
                            {
                                nreader.Dispose();
                            }
                            if (CommitEachTable)
                            {
                                threadInfo.DestTransaction.Commit();
                                threadInfo.DestTransaction = icommand.Connection.BeginTransaction(IsolationLevel.ReadCommitted);
                                {
                                    var commands = Commands[0];
                                    foreach (var cm in commands)
                                    {
                                        cm.Transaction = threadInfo.DestTransaction;
                                    }
                                }
                                foreach (var trans in TransactionsToClose)
                                {
                                    trans.Commit();
                                }
                                TransactionsToClose.Clear();
                                for (int idxCon = 0; idxCon < ConnectionsToClose.Count; idxCon++)
                                {
                                    var trans = ConnectionsToClose[idxCon].BeginTransaction();
                                    TransactionsToClose.Add(trans);
                                    var commands = Commands[idxCon + 1];
                                    foreach (var cm in commands)
                                    {
                                        cm.Transaction = trans;
                                    }
                                }
                            }
                        }
                    }
                    catch (Exception ex)
                    {
                        IncludeError("Error importing data to table " + tablename + " sql filter " + sqlFilter, ex, idxthread);
                        if (OnErrorIgnored != null)
                            OnErrorIgnored(this, intargs, ex);
                    }
                    if ((ThreadErrors.Count == 0) || (this.IgnoreFlags.HasFlag(IgnoreErrorFlags.Table)))
                        tablename = GetTableToRead(ref sqlFilter);
                    else
                        break;
                }

            }
            catch (Exception E)
            {
                IncludeError("Error in thread " + idxthread, E, idxthread);
            }
            finally
            {
                foreach (var trans in TransactionsToClose)
                {
                    trans.Commit();
                }
                foreach (var conn in ConnectionsToClose)
                {
                    conn.Close();
                    conn.Dispose();
                }
                lock (threadInfo.AdditionalSharedConnections)
                {
                    foreach (var threadI in threadInfoQueue)
                    {
                        threadInfo.AdditionalSharedConnections.Add(threadInfo);
                    }
                }
                if (Commands.Count > 0)
                {
                    foreach (var commandList in Commands)
                    {
                        foreach (var cm in commandList)
                        {
                            cm.Dispose();
                        }
                    }
                }
                intargs.Finished = true;
                intargs.Table = "";
                intargs.SQL = "";
            }

        }
        private void CloneCommand(FbCommand oriCommand, FbCommand destCommand)
        {
            destCommand.CommandText = oriCommand.CommandText;
            destCommand.Parameters.Clear();
            foreach (FbParameter oriParam in oriCommand.Parameters)
            {
                FbParameter newParam = new FbParameter(oriParam.ParameterName, oriParam.FbDbType);
                destCommand.Parameters.Add(newParam);
            }
        }
        private void IncludeError(string processDescription, Exception ex, int idxthread)
        {
            lock (ThreadErrors)
            {
                if (!ThreadErrors.ContainsKey(idxthread))
                {
                    ThreadErrors.Add(idxthread, "");
                }
                string original = ThreadErrors[idxthread];
                string message = processDescription + ex.Message + " " + ex.StackTrace;
                if (ex.InnerException != null)
                {
                    message = message + " InnerException: " + ex.Message + " " + ex.StackTrace;
                }
                if (original.Length == 0)
                {
                    original = message;
                }
                else
                {
                    original = original + (char)13 + (char)10 + message;
                }
                ThreadErrors[idxthread] = original;
            }
        }
        private static DataTable CreateCustomFunctions()
        {
            System.Data.DataTable newTable = new DataTable("CustomFunctions");
            newTable.Columns.Add("NAME", System.Type.GetType("System.String"));
            newTable.Columns.Add("SOURCE", System.Type.GetType("System.String"));
            newTable.Constraints.Add("IPRIMNAME", newTable.Columns[0], true);
            newTable.Rows.Add(new[] { "F_ADDMONTH", @"CREATE OR ALTER FUNCTION F_ADDMONTH(DATE_VALUE TIMESTAMP,MONTH_COUNT INTEGER)
RETURNS TIMESTAMP
AS
BEGIN
 RETURN DATEADD(:MONTH_COUNT MONTH TO DATE_VALUE);
END" });
            newTable.Rows.Add(new[] { "F_ADDYEAR", @"CREATE OR ALTER FUNCTION F_ADDYEAR(DATE_VALUE TIMESTAMP,YEAR_COUNT INTEGER)
RETURNS TIMESTAMP
AS
BEGIN
 RETURN DATEADD(:YEAR_COUNT YEAR TO DATE_VALUE);
END" });
            newTable.Rows.Add(new[] { "F_CMONTHLONG", @"CREATE OR ALTER FUNCTION F_CMONTHLONG(DATE_VALUE TIMESTAMP)
RETURNS VARCHAR(50)
AS
declare variable result varchar(50);
BEGIN
 result = CASE DATE_VALUE 
   WHEN 1 THEN 'January'
   WHEN 2 THEN 'February'
   WHEN 3 THEN 'March'
   WHEN 4 THEN 'April'
   WHEN 5 THEN 'May'
   WHEN 6 THEN 'June'
   WHEN 7 THEN 'July'
   WHEN 8 THEN 'August'
   WHEN 9 THEN 'September'
   WHEN 10 THEN 'October'
   WHEN 11 THEN 'November'
   WHEN 12 THEN 'December'
   ELSE NULL
  END;
 return result;
END
" });
            newTable.Rows.Add(new[] { "F_BLOBSIZE", @"CREATE OR ALTER FUNCTION F_BLOBSIZE(BLOB_VALUE BLOB SUB_TYPE 0)
RETURNS INTEGER
AS
BEGIN
 RETURN OCTET_LENGTH(BLOB_VALUE);
END
" });
            newTable.Rows.Add(new[] { "F_BLOBLEFT", @"CREATE OR ALTER FUNCTION F_BLOBLEFT(BLOB_VALUE BLOB SUB_TYPE 1,LCOUNT INTEGER)
RETURNS BLOB SUB_TYPE 1
AS
BEGIN
 RETURN LEFT(BLOB_VALUE,LCOUNT);
END
" });
            newTable.Rows.Add(new[] { "F_DAYOFMONTH", @"CREATE OR ALTER FUNCTION F_DAYOFMONTH(DATE_VALUE TIMESTAMP)
RETURNS INTEGER
AS
BEGIN
 RETURN EXTRACT(DAY FROM DATE_VALUE);
END

" });
            newTable.Rows.Add(new[] { "F_DAYOFWEEK", @"CREATE OR ALTER FUNCTION F_DAYOFWEEK(DATE_VALUE TIMESTAMP)
RETURNS INTEGER
AS
BEGIN
 RETURN EXTRACT(WEEKDAY FROM DATE_VALUE)+1;
END

" });
            newTable.Rows.Add(new[] { "F_DOUBLEABS", @"CREATE OR ALTER FUNCTION F_DOUBLEABS(DOUBLE_VALUE DOUBLE PRECISION)
RETURNS DOUBLE PRECISION
AS
BEGIN
 RETURN ABS(DOUBLE_VALUE);
END

" });
            newTable.Rows.Add(new[] { "F_FIXEDPOINT", @"CREATE OR ALTER FUNCTION F_FIXEDPOINT(DOUBLE_VALUE DOUBLE PRECISION, DECIMAL_COUNT INTEGER)
RETURNS VARCHAR(254)
AS
BEGIN
 RETURN CAST(ROUND(DOUBLE_VALUE,DECIMAL_COUNT) AS VARCHAR(254));
END

" });
            newTable.Rows.Add(new[] { "F_LEFT", @"CREATE OR ALTER FUNCTION F_LEFT(VARCHAR_VALUE VARCHAR(254), CHAR_COUNT INTEGER)
RETURNS VARCHAR(254)
AS
BEGIN
 RETURN LEFT(VARCHAR_VALUE, CHAR_COUNT);
END

" });
            newTable.Rows.Add(new[] { "F_LRTRIM", @"CREATE OR ALTER FUNCTION F_LRTRIM(VARCHAR_VALUE VARCHAR(254))
RETURNS VARCHAR(254)
AS
BEGIN
 RETURN TRIM(VARCHAR_VALUE);
END

" });
            newTable.Rows.Add(new[] { "F_LTRIM", @"CREATE OR ALTER FUNCTION F_LTRIM(VARCHAR_VALUE VARCHAR(254))
RETURNS VARCHAR(254)
AS
BEGIN
 RETURN TRIM(LEADING FROM VARCHAR_VALUE);
END

" });
            newTable.Rows.Add(new[] { "F_RTRIM", @"CREATE OR ALTER FUNCTION F_RTRIM(VARCHAR_VALUE VARCHAR(254))
RETURNS VARCHAR(254)
AS
BEGIN
 RETURN TRIM(TRAILING FROM VARCHAR_VALUE);
END
" });
            newTable.Rows.Add(new[] { "F_MODULO", @"CREATE OR ALTER FUNCTION F_MODULO(PARAM1 INTEGER, PARAM2 INTEGER)
RETURNS INTEGER
AS
BEGIN
  IF (PARAM1 IS NULL OR PARAM2 IS NULL) THEN RETURN 0; ELSE RETURN MOD(PARAM1, PARAM2);
END
" });

            newTable.Rows.Add(new[] { "F_PADLEFT", @"CREATE OR ALTER FUNCTION F_PADLEFT(VARCHAR_VALUE VARCHAR(254),PADDING_STRING VARCHAR(10),
 TOTAL_WIDTH INTEGER)
RETURNS VARCHAR(254)
AS
BEGIN
  RETURN LPAD(COALESCE(VARCHAR_VALUE,''),TOTAL_WIDTH,PADDING_STRING);
END
" });
            newTable.Rows.Add(new[] { "F_POWER", @"CREATE OR ALTER FUNCTION F_POWER(X DOUBLE PRECISION,Y DOUBLE PRECISION)
RETURNS DOUBLE PRECISION
AS
BEGIN
  RETURN power(x,y);
END
" });
            newTable.Rows.Add(new[] { "F_POWER10", @"CREATE OR ALTER FUNCTION F_POWER10(X DOUBLE PRECISION)
RETURNS DOUBLE PRECISION
AS
BEGIN
  RETURN power(x,10);
END
" });
            newTable.Rows.Add(new[] { "F_PADRIGHT", @"CREATE OR ALTER FUNCTION F_PADRIGHT(VARCHAR_VALUE VARCHAR(254),PADDING_STRING VARCHAR(10),
 TOTAL_WIDTH INTEGER)
RETURNS VARCHAR(254)
AS
BEGIN
 RETURN RPAD(COALESCE(VARCHAR_VALUE,''),TOTAL_WIDTH,PADDING_STRING);
END
" });
            newTable.Rows.Add(new[] { "F_RIGHT", @"CREATE OR ALTER FUNCTION F_RIGHT(VARCHAR_VALUE VARCHAR(254),CHAR_COUNT INTEGER)
RETURNS VARCHAR(254)
AS
BEGIN
 RETURN RIGHT(VARCHAR_VALUE,CHAR_COUNT);
END
" });
            newTable.Rows.Add(new[] { "F_ROUNDTO", @"CREATE OR ALTER FUNCTION F_ROUNDTO(DOUBLE_VALUE DOUBLE PRECISION, DECIMAL_COUNT INTEGER)
RETURNS DOUBLE PRECISION
AS
BEGIN
 RETURN ROUND(COALESCE(DOUBLE_VALUE,0), DECIMAL_COUNT);
END
" });
            newTable.Rows.Add(new[] { "F_ROUNDFLOAT", @"CREATE OR ALTER FUNCTION F_ROUNDFLOAT(NUM DOUBLE PRECISION,REDONDEO DOUBLE PRECISION)
RETURNS NUMERIC(18,5)
AS
DECLARE VARIABLE ANTICNUM DOUBLE PRECISION;
DECLARE VARIABLE provanum NUMERIC(18,5);
DECLARE VARIABLE provaredon NUMERIC(18,5);
DECLARE VARIABLE quocient DOUBLE PRECISION;
DECLARE VARIABLE  numdecimals integer;
DECLARE VARIABLE  intnum BIGINT;
DECLARE VARIABLE   intredon BIGINT;
DECLARE VARIABLE  reste integer;
DECLARE VARIABLE  signenum INTEGER;
DECLARE VARIABLE  escala integer;
DECLARE VARIABLE RESULT NUMERIC(18,5);
BEGIN

 -- Si algun d'ells es 0 ja est� arrodonit
 if ((redondeo=0) or (num=0)) then
 begin
  result=num;
  RETURN RESULT;
 end
 -- Guardem el n�mero original
 signenum=1;
 if (num<0) then 
  signenum=-1;
 anticnum=num;
 -- Mirem qui te m�s decimals
 provanum=abs(num);
 provaredon=abs(redondeo);
 numdecimals=0;
 escala=1;
 -- MOD SUSTITUYE FRAC
 While ((provanum-TRUNC(provanum))<>0) do
 begin
  Numdecimals = numdecimals+1;
  provanum=provanum*10;
  provaredon=provaredon*10;
  escala=escala*10;
 end
 While (provaredon-TRUNC(provaredon)<>0) do
 begin
  numdecimals=numdecimals + 1;
  provanum=provanum*10;
  provaredon=provaredon*10;
  escala=escala*10;
 end
 -- Passem a enters els numeros
 intnum=TRUNC(provanum);
 intredon=TRUNC(provaredon);

 -- Mirem el m�dul de la divisio
 -- reste:=intnum mod intredon;
 IF (INTREDON=0) THEN
 BEGIN
  RETURN null;
 END
 quocient=intnum/intredon;

 reste=Round(intnum-intredon*TRUNC(quocient));
 if (reste<=(intredon/2)) then
  intnum=intnum-reste;
 else
  intnum=intnum-reste+intredon;
 
 result=cast(intnum as numeric(18,5))/escala*signenum;
 RETURN RESULT;
END" });
            newTable.Rows.Add(new[] { "F_STRINGLENGTH", @"CREATE OR ALTER FUNCTION F_STRINGLENGTH(VARCHAR_VALUE VARCHAR(254))
RETURNS INTEGER
AS
BEGIN
 RETURN COALESCE(CHARACTER_LENGTH(VARCHAR_VALUE),0);
END
" });
            newTable.Rows.Add(new[] { "F_STRIPDATE", @"CREATE OR ALTER FUNCTION F_STRIPDATE(DATE_VALUE TIMESTAMP)
RETURNS TIMESTAMP
AS
BEGIN
 RETURN CAST(DATE_VALUE AS TIME);
END
" });
            newTable.Rows.Add(new[] { "F_STRIPTIME", @"CREATE OR ALTER FUNCTION F_STRIPTIME(DATE_VALUE TIMESTAMP)
RETURNS TIMESTAMP
AS
BEGIN
 RETURN CAST(DATE_VALUE AS DATE);
END
" });
            newTable.Rows.Add(new[] { "F_SUBSTR", @"CREATE OR ALTER FUNCTION F_SUBSTR(VARCHAR_VALUE VARCHAR(254), VARCHAR_PATTERN VARCHAR(254))
RETURNS INTEGER
AS
BEGIN
 RETURN POSITION(VARCHAR_PATTERN IN VARCHAR_VALUE);
END
" });
            newTable.Rows.Add(new[] { "F_TRUNCATE", @"CREATE OR ALTER FUNCTION F_TRUNCATE(DOUBLE_VALUE DOUBLE PRECISION)
RETURNS DOUBLE PRECISION
AS
BEGIN
 RETURN TRUNC(COALESCE(DOUBLE_VALUE,0));
END
" });
            newTable.Rows.Add(new[] { "F_WEEKOFYEAR", @"CREATE OR ALTER FUNCTION F_WEEKOFYEAR(DATE_VALUE TIMESTAMP)
RETURNS INTEGER
AS
BEGIN
 RETURN EXTRACT(WEEK FROM DATE_VALUE);
END
" });
            newTable.Rows.Add(new[] { "F_MONTH", @"CREATE OR ALTER FUNCTION F_MONTH(DATE_VALUE TIMESTAMP)
RETURNS INTEGER
AS
BEGIN
 RETURN EXTRACT(MONTH FROM DATE_VALUE);
END
" });
            newTable.Rows.Add(new[] { "F_YEAR", @"CREATE FUNCTION F_YEAR(DATE_VALUE TIMESTAMP)
RETURNS INTEGER
AS
BEGIN
 RETURN  EXTRACT(YEAR FROM DATE_VALUE);
END
" });
            newTable.Rows.Add(new[] { "F_YEAROFYEAR", @"CREATE FUNCTION F_YEAROFYEAR(DATE_VALUE TIMESTAMP)
RETURNS INTEGER
AS
BEGIN
 RETURN  EXTRACT(YEAR FROM DATE_VALUE);
END
" });
            return newTable;
        }

    }
    public class SimpleCommand
    {
        public string Name;
        public string Sql;
        public SimpleCommand(string name, string sql)
        {
            Name = name;
            Sql = sql;
        }

    }
    public class FBCloneEventArgs
    {
        public int TotalProgressCount;
        public int ProgressCount;
        public string ProgressName;
        public bool Cancel;
        public string Table;
        public int RecordCount;
        public int TotalRecordCount;
        public int TableCount;
        public int TotalTableCount;
        public bool Finished;
        public string SQL = "";
        public string Description;
        public string GetFullMessage()
        {
            FBCloneEventArgs intargs = this;
            string nmessage = intargs.ProgressName + " Name: " +
                intargs.Table + " ";
            if (intargs.TotalRecordCount > 0)
                nmessage = nmessage + "Record " + intargs.RecordCount.ToString("##,###") + " of " + intargs.TotalRecordCount;
            else
                if (intargs.RecordCount > 0)
                nmessage = nmessage + " Record " + intargs.RecordCount.ToString("#,#");
            nmessage = nmessage + (char)13 + (char)10;
            if (intargs.SQL.Length > 0)
            {
                nmessage = nmessage + (char)13 + (char)10 + intargs.SQL;
            }
            return nmessage;
        }
    }
}
