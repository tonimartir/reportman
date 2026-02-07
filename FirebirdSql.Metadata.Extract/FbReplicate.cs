using Reportman.Drawing;
using System;
using System.Collections.Generic;
using System.Data;
using System.Text;

namespace FirebirdSql.Metadata.Extract
{
    public class FbReplicate
    {
        FbCompare ncompare;
        int dialect;
        ISqlExecuter Origin;
        ISqlExecuter Destination;
        FbCompareProgressEvent CompareEvent;
        public List<string> ExcludeTables = new List<string>();
        public string GetBIGINTstring()
        {
            if (dialect == 3)
                return "BIGINT";
            else
                return "NUMERIC(18,0)";
        }
        public string Delimiter
        {
            get
            {
                if (dialect == 1)
                    return "";
                else return "\"";
            }
        }

        public StringBuilder Result = new StringBuilder();
        public ISqlExecuterProgressEvent FlushEvent;
        DateTime mmfirst;
        SortedList<string, int> TablesRepli = new SortedList<string, int>();

        public FbReplicate(ISqlExecuter norigin, ISqlExecuter ndestination, int ndialect, FbCompareProgressEvent nCompareEvent)
        {
            dialect = ndialect;
            ncompare = new FbCompare(ndestination, norigin, dialect, true);
            ncompare.UpdateDestination = true;
            Origin = norigin;
            Destination = ndestination;
            CompareEvent = nCompareEvent;
            if (CompareEvent != null)
                ncompare.OnProgress += nCompareEvent;
            FlushEvent = new ISqlExecuterProgressEvent(FlushProg);
        }
        public int MAX_RECORD_COUNT = 20000;
        public int MAX_RECORD_FLUSH_COUNT = 20000;
        public int MAX_RECORD_COUNT2 = 2000000000;
        int current_record_count = 0;
        SortedList<string, List<long>> TablesWithDeletions = new SortedList<string, List<long>>();
        public void Execute()
        {
            Result = new StringBuilder();
            using (DataSet ndataset = new DataSet())
            {
                if (CompareEvent != null)
                    CompareEvent(this, new FbCompareProgressArgs(0, 0, 0, 0, "Checking new tables to replicate",
                        ""));
                Origin.StartTransaction(IsolationLevel.Snapshot);
                Destination.StartTransaction(IsolationLevel.Snapshot);
                CheckDbsInitialized(ndataset);
                // Prepare la original database
                string cadenasql = "SELECT RDB$RELATION_NAME AS RELNAME FROM RDB$RELATIONS R " +
                    " WHERE (R.RDB$SYSTEM_FLAG IS NULL  OR R.RDB$SYSTEM_FLAG=0) AND (R.RDB$VIEW_SOURCE IS NULL) AND " +
                    " NOT EXISTS (SELECT FIRST 1 R2.RDB$FIELD_NAME FROM RDB$RELATION_FIELDS R2 " +
                    " WHERE R2.RDB$RELATION_NAME=R.RDB$RELATION_NAME AND R2.RDB$FIELD_NAME='ID64')";
                DataTable tnoid64 = Origin.OpenInmediate(ndataset, cadenasql, "NOID64");

                for (int idxtabla = 0; idxtabla < tnoid64.Rows.Count; idxtabla++)
                {
                    DataRow xrow = tnoid64.Rows[idxtabla];
                    string tablename = xrow["RELNAME"].ToString().Trim();
                    if (CompareEvent != null)
                        CompareEvent(this, new FbCompareProgressArgs(idxtabla, tnoid64.Rows.Count, 0, 0, "Initializing replication for table: " +
                            tablename, ""));
                    CreateTableFields(tablename, false);
                    CreateTableTriggers(ndataset, tablename);
                    Modifytable(ndataset, tablename);
                }
                Origin.Flush(FlushEvent);

                foreach (DataTable ntable in ndataset.Tables)
                {
                    ntable.Dispose();
                }
                ndataset.Tables.Clear();

                ncompare.UpdateDestination = true;
                ncompare.Execute(true);


                // Check triggers, must have the check for environment variable so it does not
                // execute while replicating
                SortedList<string, string> lupdatedtriggers = ncompare.GetUpdatedTriggers();
                bool triggersupdated = false;
                foreach (string trigname in lupdatedtriggers.Keys)
                {
                    string source = lupdatedtriggers[trigname];

                    string search1 = "BEGIN" + (char)13 + (char)10 + " IF (RDB$GET_CONTEXT('USER_TRANSACTION','VREPLICATING')='1') THEN " +
                        (char)13 + (char)10 + "  EXIT;" + (char)13 + (char)10;
                    if (source.IndexOf(search1) < 0)
                    {
                        string search2 = "BEGIN" + (char)10 + " IF (RDB$GET_CONTEXT('USER_TRANSACTION','VREPLICATING')='1') THEN " +
                            (char)10 + "  EXIT;" + (char)10;
                        if (source.IndexOf(search2) < 0)
                        {
                            triggersupdated = true;
                            int idx = source.IndexOf("BEGIN");
                            string partial = source.Substring(0, idx + 5);
                            partial = partial.Replace("BEGIN", search1);
                            source = partial + source.Substring(idx + 5, source.Length - idx - 5);
                            Origin.Execute(source);
                            Destination.Execute(source);
                        }
                    }
                }
                if (triggersupdated)
                {
                    Origin.Commit();
                    Destination.Commit();
                    Origin.Flush();
                    Destination.Flush();
                }

                string excluded = "('TMP_TABLE_DEPEN','TMP_TABLE_DEPEN2','BORRADOS_ID64','SINCRONIZACION_64','ESTAD_CLIENTE_MES_PEDIDO','ESTAD_ARTICULO_MES_PEDIDO'";
                foreach (string texclu in ExcludeTables)
                {
                    excluded = excluded + "," + StringUtil.QuoteStr(texclu);
                }
                excluded = excluded + ")";


                mmfirst = System.DateTime.Now;
                TablesRepli.Clear();
                current_record_count = 0;
                // Replicate data
                // Estabilidad de borrados_id64 y version64
                long version64estable = 0;
                long borrados64estable = 0;
                for (int paso_estable = 0; paso_estable < 2; paso_estable++)
                {
                    if (paso_estable == 0)
                        Origin.StartTransaction(IsolationLevel.Snapshot);
                    try
                    {
                        if (paso_estable == 0)
                        {
                            DataSet vdataset = new DataSet();
                            Origin.Open(vdataset, "SELECT FIRST 1 GEN_ID(GEN_VERSION64,0) AS VERSIONU," +
                                " GEN_ID(GEN_BORRADOS64,0) AS VERSIOND " +
                                " FROM RDB$DATABASE ", "VERSION");
                            Origin.Flush();
                            DataRow nrow = vdataset.Tables["VERSION"].Rows[0];
                            version64estable = Convert.ToInt64(nrow["VERSIONU"]);
                            borrados64estable = Convert.ToInt64(nrow["VERSIOND"]);
                        }
                        else
                        {
                            using (DataTable tversionsorigin = Origin.OpenInmediate(ndataset, "SELECT MAX(VERSION64) AS VERSION64,MAX(BORRADO_VERSION64) AS BORRADO_VERSION64 " +
                                    " FROM OBTENER_TODO_VERSION64R", "__TVERSIONS__"))
                            {
                                DataRow brow = tversionsorigin.Rows[0];
                                long nueva_version = Convert.ToInt64(brow["VERSION64"]); ;
                                long nueva_borrados = Convert.ToInt64(brow["BORRADO_VERSION64"]);
                                if ((nueva_version != version64estable) || (nueva_borrados != borrados64estable))
                                {
                                    paso_estable = -1;
                                    Origin.Rollback();
                                    // Espera 10 segundos
                                    for (int i = 0; i < 10; i++)
                                        System.Threading.Thread.Sleep(1000);
                                }
                            }
                        }
                    }
                    finally
                    {
                        //if (paso_estable < 3)
                        //    Origin.Rollback();
                    }
                }
                //Origin.StartTransaction(IsolationLevel.Snapshot);
                try
                {
                    Origin.ExecuteInmediate("UPDATE OR INSERT INTO SINCRONIZACION_64 (CODIGO,FECHA) VALUES (1,'NOW')  MATCHING(CODIGO)");
                    Origin.Open(ndataset, "SELECT GENERATOR_NAME,GENERATOR_VALUE FROM GET_GENERATOR_VALUES", "RDB$GENERATORVALUES");
                    Destination.StartTransaction(IsolationLevel.Snapshot);
                    try
                    {
                        // Estabilidad del generador de al menos un minuto
                        Destination.Execute("EXECUTE BLOCK AS BEGIN RDB$SET_CONTEXT('USER_TRANSACTION','VREPLICATING',1); END");
                        using (DataTable tversionsorigin = Origin.OpenInmediate(ndataset, "SELECT TRIM(TABLA) AS TABLA,VERSION64,BORRADO_VERSION64,NUMBER " +
                            " FROM OBTENER_TODO_VERSION64R WHERE TRIM(TABLA) NOT IN " + excluded, "__TVERSIONS__"))
                        {
                            int idxrow = 0;
                            foreach (DataRow xxrow in tversionsorigin.Rows)
                            {
                                TablesRepli.Add(xxrow["TABLA"].ToString(), idxrow);
                                idxrow++;
                            }
                            using (DataTable tversionsdest = Destination.OpenInmediate(ndataset, "SELECT TRIM(TABLA) AS TABLA,VERSION64,BORRADO_VERSION64,NUMBER " +
                                " FROM OBTENER_TODO_VERSION64R WHERE TRIM(TABLA) NOT IN " + excluded, "__TVERSIONSDEST__"))
                            {
                                tversionsdest.Constraints.Add("PRIMVERSIONDESTTABLA", tversionsdest.Columns["TABLA"], true);
                                // First perform deletions in reverse foreign order

                                long delete_version_old = 0;
                                foreach (DataRow delvrow in tversionsdest.Rows)
                                {
                                    if (delvrow["BORRADO_VERSION64"] != DBNull.Value)
                                    {
                                        long newdelversion = Convert.ToInt64(delvrow["BORRADO_VERSION64"]);
                                        if (newdelversion > delete_version_old)
                                            delete_version_old = newdelversion;
                                    }
                                }
                                long delete_version_new = 0;
                                foreach (DataRow delvrow in tversionsorigin.Rows)
                                {
                                    if (delvrow["BORRADO_VERSION64"] != DBNull.Value)
                                    {
                                        long newdelversion = Convert.ToInt64(delvrow["BORRADO_VERSION64"]);
                                        if (newdelversion > delete_version_new)
                                            delete_version_new = newdelversion;
                                    }
                                }
                                if (delete_version_new > delete_version_old)
                                {
                                    TablesWithDeletions.Clear();
                                    Origin.Open(ndataset, "SELECT " +
                                        "TABLA,ID64,VERSION64,FECHA " +
                                        " FROM BORRADOS_ID64 WHERE VERSION64>" + delete_version_old.ToString(),
                                        "BORRADOS_ID64", MAX_RECORD_COUNT2,
                                        new ISqlExecuterPartialFillEvent(PartialFillEvent));
                                    Origin.Flush();
                                    using (DataView reverseview = new DataView(tversionsorigin, "", "NUMBER DESC", DataViewRowState.CurrentRows))
                                    {
                                        // Perform deletions
                                        int idxdel = 0;
                                        foreach (DataRowView xrow in reverseview)
                                        {
                                            string deltablename = xrow["TABLA"].ToString();
                                            if (ExcludeTables.IndexOf(deltablename) < 0)
                                            {
                                                if (TablesWithDeletions.IndexOfKey(deltablename) >= 0)
                                                {
                                                    //SortedList<string, string> ltriggers = DeactivateDestinationTriggers(ndataset, deltablename);
                                                    //Destination.Commit();
                                                    List<long> ldeletions = TablesWithDeletions[deltablename];
                                                    foreach (long iddel in ldeletions)
                                                    {
                                                        string delsql = "DELETE FROM " + Delimiter + deltablename +
                                                            Delimiter + " WHERE ID64=" + iddel.ToString();
                                                        Destination.Execute(delsql);
                                                        idxdel++;
                                                        if (idxdel > 50000)
                                                        {
                                                            Destination.Flush();
                                                            idxdel = 0;
                                                        }
                                                    }
                                                    //ActivateDestinationTriggers(ltriggers, deltablename);
                                                    //Destination.Commit();
                                                }
                                            }
                                        }
                                        Destination.Flush();
                                    }
                                }

                                foreach (DataRow orirow in tversionsorigin.Rows)
                                {
                                    string tablename = orirow["TABLA"].ToString();
                                    long version64ori = 0;
                                    if (orirow["VERSION64"] != DBNull.Value)
                                    {
                                        version64ori = Convert.ToInt64(orirow["VERSION64"]);
                                    }
                                    DataRow destrow = tversionsdest.Rows.Find(tablename);
                                    long version64dest = 0;
                                    if (destrow["VERSION64"] != DBNull.Value)
                                    {
                                        version64dest = Convert.ToInt64(destrow["VERSION64"]);
                                    }
                                    if (version64dest < version64ori)
                                    {
                                        //SortedList<string,string> ltriggers = DeactivateDestinationTriggers(ndataset, tablename);
                                        //Destination.Commit();
                                        //Destination.StartTransaction(IsolationLevel.Snapshot);
                                        Origin.Open(ndataset, "SELECT * FROM " + Delimiter + tablename + Delimiter +
                                            " WHERE VERSION64>" + version64dest.ToString(), tablename, MAX_RECORD_COUNT,
                                            new ISqlExecuterPartialFillEvent(PartialFillEvent));
                                        Origin.Flush();
                                        //ActivateDestinationTriggers(ltriggers, tablename);
                                        //Destination.Commit();
                                        //Destination.StartTransaction(IsolationLevel.Snapshot);
                                        Destination.Flush();
                                        // Se libera la table
                                        DataTable tabla = ndataset.Tables[tablename];
                                        if (tabla != null)
                                        {
                                            ndataset.Tables.Remove(tabla);
                                            tabla.Dispose();
                                        }
                                    }
                                }
                            }
                        }

                        DataTable tablegen = ndataset.Tables["RDB$GENERATORVALUES"];
                        foreach (DataRow xrow in tablegen.Rows)
                        {
                            string genname = xrow["GENERATOR_NAME"].ToString();
                            string genvalue = xrow["GENERATOR_VALUE"].ToString();
                            Destination.Execute("SET GENERATOR " + Delimiter + genname + Delimiter + " TO " + genvalue.ToString());
                        }

                        // Flush 
                        //Destination.Flush();
                        Destination.Flush();
                        Destination.Commit();
                        ncompare.ExecuteForeigns();
                        Destination.Flush();

                        // Update generator values


                        Destination.Commit();
                    }
                    catch
                    {
                        Destination.Rollback();
                        throw;
                    }
                }
                finally
                {
                    Origin.Commit();
                }
            }



        }
        System.Data.Common.DbCommand icommand = null;
        public void InsertTable(DataTable ntable, int totalcount)
        {
            bool isdeletions = ntable.TableName == "BORRADOS_ID64";
            if (CompareEvent != null)
            {
                DateTime mmlast = System.DateTime.Now;
                if ((mmlast - mmfirst).TotalSeconds > 1)
                {
                    if (TablesRepli.IndexOfKey(ntable.TableName) >= 0)
                    {
                        FbCompareProgressArgs carg = new FbCompareProgressArgs(TablesRepli[ntable.TableName] + 1, TablesRepli.Count,
                            0, 0, "Inserting record " + totalcount.ToString("N0") + " in table " + ntable.TableName, "");
                        CompareEvent(this, carg);
                        if (carg.Cancel)
                            throw new Exception("Operation cancelled");
                        mmfirst = System.DateTime.Now;
                    }
                    else
                    {
                        FbCompareProgressArgs carg = new FbCompareProgressArgs(0, 1,
                            0, 0, "Deleting record " + totalcount.ToString("N0") + " in table " + ntable.TableName, "");
                        CompareEvent(this, carg);
                        if (carg.Cancel)
                            throw new Exception("Operation cancelled");
                        mmfirst = System.DateTime.Now;
                    }
                }
            }
            StringBuilder sinsert = new StringBuilder();
            foreach (DataColumn ncolumn in ntable.Columns)
            {
                string colname = ncolumn.ColumnName;
                if (sinsert.Length == 0)
                    sinsert.Append("UPDATE OR INSERT INTO " + Delimiter + ntable.TableName + Delimiter + "(");
                else
                    sinsert.Append(",");
                sinsert.Append(Delimiter + colname + Delimiter);
            }
            StringBuilder svalues = new StringBuilder();
            foreach (DataColumn ncolumn in ntable.Columns)
            {
                string colname = ncolumn.ColumnName;
                if (svalues.Length == 0)
                    svalues.Append(" VALUES (");
                else
                    svalues.Append(",");
                //svalues.Append("@"+colname);
                svalues.Append("?");
            }
            sinsert.Append(")");
            sinsert.Append(svalues);
            sinsert.Append(")");
            if (isdeletions)
                sinsert.Append(" MATCHING (TABLA,ID64)");
            else
            {
                if (ntable.TableName == "ANEXOS")
                    sinsert.Append(" MATCHING(ID64,LINEA) ");
                else
                    sinsert.Append(" MATCHING (ID64)");
            }

            string cadsql = sinsert.ToString();

            if (icommand == null)
                icommand = Destination.CreateCommand(cadsql);
            icommand.Parameters.Clear();
            icommand.CommandText = cadsql;
            foreach (DataColumn ncolumn in ntable.Columns)
            {
                System.Data.Common.DbParameter nparam = icommand.CreateParameter();
                //nparam.ParameterName = ncolumn.ColumnName;
                nparam.ParameterName = "";
                nparam.DbType = TypeToDbType(ncolumn.DataType);
                icommand.Parameters.Add(nparam);
            }
            Destination.BeginInsertBlock();
            try
            {
                foreach (DataRow xrow in ntable.Rows)
                {
                    if (isdeletions)
                    {
                        string deltablename = xrow["TABLA"].ToString();
                        List<long> ldeletions = null;
                        if (TablesWithDeletions.IndexOfKey(deltablename) < 0)
                        {
                            ldeletions = new List<long>();
                            TablesWithDeletions.Add(deltablename, ldeletions);
                        }
                        else
                            ldeletions = TablesWithDeletions[deltablename];
                        long id64delete = Convert.ToInt64(xrow["ID64"]);
                        ldeletions.Add(id64delete);
                    }
                    int idx = 0;
                    for (int idxcol = 0; idxcol < ntable.Columns.Count; idxcol++)
                    {
                        icommand.Parameters[idxcol].Value = xrow[idxcol];
                        idx++;
                    }
                    Destination.Execute(icommand);
                    current_record_count++;
                    if (current_record_count > MAX_RECORD_FLUSH_COUNT)
                    {
                        current_record_count = 0;
                        Destination.Flush();
                    }
                }
            }
            finally
            {
                Destination.EndInsertBlock();
            }
        }
        public static DbType TypeToDbType(Type ntype)
        {
            DbType aresult;
            switch (ntype.ToString())
            {
                case "System.String":
                    aresult = DbType.String;
                    break;
                case "System.Int16":
                    aresult = DbType.Int16;
                    break;
                case "System.Int32":
                    aresult = DbType.Int32;
                    break;
                case "System.DateTime":
                    aresult = DbType.DateTime;
                    break;
                case "System.Decimal":
                    aresult = DbType.Decimal;
                    break;
                case "System.Double":
                    aresult = DbType.Double;
                    break;
                case "System.Single":
                    aresult = DbType.Single;
                    break;
                case "System.Int64":
                    aresult = DbType.Int64;
                    break;
                case "System.Float":
                    aresult = DbType.Single;
                    break;
                case "System.TimeSpan":
                    aresult = DbType.Time;
                    break;
                case "System.Byte[]":
                    aresult = DbType.Binary;
                    break;
                default:
                    throw new Exception("Tipo no soportado:" + ntype.ToString());
            }
            return aresult;
        }

        public void PartialFillEvent(object sender, ISqlExecuterPartialFillArgs args)
        {
            InsertTable(args.Table, args.TotalCount);
        }

        private void FlushProg(int count, int total)
        {
            if (ncompare.OnProgress != null)
                ncompare.OnProgress(this, new FbCompareProgressArgs(count, total, 0, 0, "Updating database", ""));
        }
        private object GetValueFromOrigin(DataSet ndataset, string cadsql)
        {
            object nresult = DBNull.Value;
            DataTable xtable = Origin.OpenInmediate(ndataset, cadsql, "XXXXXVALUE");
            try
            {
                if (xtable.Rows.Count > 0)
                    nresult = xtable.Rows[0][0];

            }
            finally
            {
                ndataset.Tables.Remove(xtable);
                xtable.Dispose();
            }
            return nresult;
        }
        private object GetValueFromDestination(DataSet ndataset, string cadsql)
        {
            object nresult = DBNull.Value;
            DataTable xtable = Destination.OpenInmediate(ndataset, cadsql, "XXXXXVALUE");
            try
            {
                if (xtable.Rows.Count > 0)
                    nresult = xtable.Rows[0][0];

            }
            finally
            {
                ndataset.Tables.Remove(xtable);
                xtable.Dispose();
            }
            return nresult;
        }
        private void CheckInitialitzed(ISqlExecuter Originx, DataSet ndataset)
        {
            // Check if genrators are created
            string cadenasql = "SELECT RDB$GENERATOR_NAME FROM RDB$GENERATORS WHERE RDB$GENERATOR_NAME='GEN_VERSION64'";

            object nvalor = null;
            if (Originx == Origin)
                nvalor = GetValueFromOrigin(ndataset, cadenasql);
            else
                nvalor = GetValueFromDestination(ndataset, cadenasql);
            if ((nvalor == DBNull.Value))
            {

                Originx.Execute("CREATE GENERATOR GEN_VERSION64");
                Originx.Execute("CREATE GENERATOR GEN_ID64");
                Originx.Execute("CREATE GENERATOR GEN_BORRADOS64");
                Originx.Execute("CREATE DOMAIN T_NOM40XNOTNULL VARCHAR(40) NOT NULL ");
                if (dialect == 3)
                    Originx.Execute("CREATE DOMAIN T_FECHAXAHORA TIMESTAMP DEFAULT 'NOW' ");
                else
                    Originx.Execute("CREATE DOMAIN T_FECHAXAHORA DATE DEFAULT 'NOW' ");
                Originx.Execute("CREATE TABLE TABLAS_INT64" +
                    "(TABLA T_NOM40XNOTNULL,CONSTRAINT IPRIMTABLASINT64 PRIMARY KEY(TABLA))");

                Originx.Execute("CREATE DOMAIN T_ENTER64 " + GetBIGINTstring());
                Originx.Execute("CREATE DOMAIN T_CODI64 " + GetBIGINTstring() + " NOT NULL");


                Originx.Commit();
                cadenasql = " CREATE TABLE SINCRONIZACION_64 " +
                    "(CODIGO T_CODI64,FECHA T_FECHAXAHORA," +
                    " CONSTRAINT IPRIMSINCRONIZACION64 PRIMARY KEY (CODIGO))";
                Originx.Execute(cadenasql);



                cadenasql = " CREATE TABLE BORRADOS_ID64 " +
                    "(TABLA T_NOM40XNOTNULL NOT NULL,ID64 T_CODI64 NOT NULL,VERSION64 T_CODI64,FECHA T_FECHAXAHORA," +
                    " CONSTRAINT IPRIMBORADOSVERSION64 PRIMARY KEY (TABLA,ID64))";

                Originx.Execute(cadenasql);
                cadenasql = "CREATE DESCENDING INDEX IBORRADOSID64TABVERSION6 ON BORRADOS_ID64 (TABLA,VERSION64)";
                Originx.Execute(cadenasql);
                cadenasql = "CREATE INDEX IBORRADOSID64VERSION6 ON BORRADOS_ID64 (VERSION64)";
                Originx.Execute(cadenasql);
                cadenasql = "CREATE DESCENDING INDEX IBORRADOSID64VERSION6D ON BORRADOS_ID64 (VERSION64)";
                Originx.Execute(cadenasql);
            }
            cadenasql = "SELECT RDB$RELATION_NAME FROM RDB$RELATIONS WHERE RDB$RELATION_NAME='TMP_TABLE_DEPEN'";

            nvalor = null;
            if (Originx == Origin)
                nvalor = GetValueFromOrigin(ndataset, cadenasql);
            else
                nvalor = GetValueFromDestination(ndataset, cadenasql);
            if ((nvalor == DBNull.Value))
            {
                cadenasql = "CREATE GLOBAL TEMPORARY TABLE TMP_TABLE_DEPEN(TABLE_NAME VARCHAR(40) NOT NULL,NUMBER INTEGER," +
                    " CONSTRAINT IPRIMTMPTABLEDEPEN PRIMARY KEY(TABLE_NAME));";
                Originx.Execute(cadenasql);
                cadenasql = "CREATE INDEX ITMPTABLEDEPENTA ON TMP_TABLE_DEPEN(NUMBER)";
                Originx.Execute(cadenasql);

                cadenasql = "CREATE GLOBAL TEMPORARY TABLE TMP_TABLE_DEPEN2(TABLE_NAME VARCHAR(40) NOT NULL," +
                    " CONSTRAINT IPRIMTMPTABLEDEPEN2 PRIMARY KEY(TABLE_NAME))";
                Originx.Execute(cadenasql);

                cadenasql = "CREATE OR ALTER PROCEDURE GET_GENERATOR_VALUES" +
                    " RETURNS " +
                    " (GENERATOR_NAME VARCHAR(50) CHARACTER SET UTF8,GENERATOR_VALUE BIGINT) " +
                    " AS BEGIN FOR SELECT TRIM(G.RDB$GENERATOR_NAME) " +
                    " FROM RDB$GENERATORS G " +
                    " WHERE (G.RDB$SYSTEM_FLAG IS NULL OR G.RDB$SYSTEM_FLAG <> 1) " +
                    " INTO :GENERATOR_NAME DO " +
                    " BEGIN " +
                    "   GENERATOR_VALUE =0; " +
                  "  EXECUTE STATEMENT 'SELECT FIRST 1 GEN_ID(' || :GENERATOR_NAME || ',0) FROM RDB$GENERATORS' " +
                    "     INTO :GENERATOR_VALUE; " +
                    " SUSPEND; " +
                    "  END  " +
                    " END ";
                Originx.Execute(cadenasql);


                cadenasql = "CREATE OR ALTER PROCEDURE GET_TABLE_DEPENDENCES(TABLE_NAME VARCHAR(40) CHARACTER SET UTF8," +
                    "RECURSIVE_LEVEL INTEGER,OLD_NUMBER INTEGER) " +
                    " RETURNS " +
                    " (NEW_NUMBER INTEGER) " +
                     " AS " +
                    " DECLARE VARIABLE NEW_TABLE VARCHAR(40) CHARACTER SET UTF8; " +
                    " BEGIN " +
                    " IF (NOT EXISTS (SELECT TABLE_NAME FROM TMP_TABLE_DEPEN2 WHERE TABLE_NAME=:TABLE_NAME)) THEN " +
                    "  INSERT INTO TMP_TABLE_DEPEN2(TABLE_NAME) VALUES (:TABLE_NAME); " +
                    "  RECURSIVE_LEVEL=RECURSIVE_LEVEL+1; " +
                    "  NEW_NUMBER=OLD_NUMBER;" +
                    " IF (RECURSIVE_LEVEL>100) THEN " +
                    "   EXIT; " +
                    "  FOR SELECT TRIM(IR.RDB$RELATION_NAME) " +
                    "  FROM RDB$RELATION_CONSTRAINTS RC " +
                    "   LEFT OUTER JOIN RDB$INDICES I ON I.RDB$INDEX_NAME=RC.RDB$INDEX_NAME " +
                    "   LEFT OUTER JOIN RDB$INDICES IR ON IR.RDB$INDEX_NAME=I.RDB$FOREIGN_KEY " +
                    " WHERE RC.RDB$RELATION_NAME=:TABLE_NAME AND NOT IR.RDB$RELATION_NAME=:TABLE_NAME " +
                    "   AND RC.RDB$CONSTRAINT_TYPE='FOREIGN KEY' " +
                    "   AND NOT EXISTS (SELECT D.TABLE_NAME FROM TMP_TABLE_DEPEN D WHERE D.TABLE_NAME=TRIM(IR.RDB$RELATION_NAME)) " +
                    "   AND NOT EXISTS (SELECT D2.TABLE_NAME FROM TMP_TABLE_DEPEN2 D2 WHERE D2.TABLE_NAME=TRIM(IR.RDB$RELATION_NAME)) " +
                    "   INTO :NEW_TABLE DO " +
                    "  BEGIN " +
                    "   SELECT NEW_NUMBER FROM GET_TABLE_DEPENDENCES(:NEW_TABLE,:RECURSIVE_LEVEL,:NEW_NUMBER) " +
                    "    INTO :NEW_NUMBER; " +
                    "  END " +
                    "  IF (NOT EXISTS (SELECT TABLE_NAME FROM TMP_TABLE_DEPEN WHERE TABLE_NAME=:TABLE_NAME)) THEN " +
                    "  BEGIN " +
                    "   NEW_NUMBER=NEW_NUMBER+1;" +
                    "  INSERT INTO TMP_TABLE_DEPEN(TABLE_NAME,NUMBER) VALUES (:TABLE_NAME,:NEW_NUMBER); " +
                    "   SUSPEND; " +
                    " END " +
                    " END ";
                Originx.Execute(cadenasql);

                cadenasql = "CREATE OR ALTER PROCEDURE GET_RELATIONS_ORDERED " +
                    " RETURNS " +
                    " (TABLE_NAME VARCHAR(40) CHARACTER SET UTF8,NUMBER INTEGER) " +
                    " AS " +
                    " DECLARE VARIABLE NEW_TABLE VARCHAR(40) CHARACTER SET UTF8; " +
                    " DECLARE VARIABLE NEW_NUMBER INTEGER; " +
                    " BEGIN " +
                     " NEW_NUMBER = 1; " +
                     " FOR SELECT R.RDB$RELATION_NAME FROM RDB$RELATIONS R " +
                     "  WHERE (R.RDB$SYSTEM_FLAG=0 OR R.RDB$SYSTEM_FLAG IS NULL) AND R.RDB$VIEW_SOURCE IS NULL " +
                     "   ORDER BY R.RDB$RELATION_NAME " +
                     "   INTO :NEW_TABLE DO " +
                     " BEGIN " +
                     "  SELECT NEW_NUMBER FROM GET_TABLE_DEPENDENCES(:NEW_TABLE,0,:NEW_NUMBER) " +
                     "   INTO :NEW_NUMBER; " +
                     " END " +
                     " FOR SELECT TABLE_NAME,NUMBER FROM TMP_TABLE_DEPEN " +
                     " ORDER BY NUMBER " +
                     "  INTO :TABLE_NAME,NUMBER DO " +
                     "BEGIN " +
                     " SUSPEND; " +
                     " END " +
                    "END ";
                Originx.Execute(cadenasql);


                cadenasql = "                CREATE OR ALTER PROCEDURE OBTENER_TODO_VERSION64R " +
                        " RETURNS " +
                        " (TABLA VARCHAR(40),VERSION64 " + GetBIGINTstring() + ",BORRADO_VERSION64 " + GetBIGINTstring() + ",NUMBER INTEGER) " +
                        " AS " +
                        " BEGIN " +
                        " FOR SELECT TABLE_NAME,NUMBER FROM GET_RELATIONS_ORDERED R  " +
                        " WHERE   " +
                        " EXISTS (SELECT FIRST 1 R2.RDB$FIELD_NAME FROM RDB$RELATION_FIELDS R2  " +
                        " WHERE R2.RDB$RELATION_NAME=R.TABLE_NAME AND R2.RDB$FIELD_NAME='ID64')  " +
                        " INTO :TABLA,NUMBER DO " +
                        " BEGIN " +
                        " VERSION64=NULL; " +
                        " BORRADO_VERSION64=NULL; " +
                        " EXECUTE STATEMENT 'sELECT FIRST 1 VERSION64 FROM ' || :TABLA || ' ORDER BY VERSION64 DESC' " +
                        " INTO :VERSION64; " +
                        "  SELECT FIRST 1 VERSION64 FROM BORRADOS_ID64 " +
                        "  WHERE TABLA=:TABLA ORDER BY TABLA DESC,VERSION64 DESC " +
                        " INTO :BORRADO_VERSION64; " +
                        " SUSPEND; " +
                        " END " +
                        "  END ";
                Originx.Execute(cadenasql);





                Originx.Commit();

                Originx.Flush();
            }

        }
        private void CheckDbsInitialized(DataSet ndataset)
        {
            CheckInitialitzed(Origin, ndataset);
            //CheckInitialitzed(Destination,ndataset);
        }
        private void CreateTableFields(string tabla, bool inserta_int64)
        {
            Origin.StartTransaction(IsolationLevel.Snapshot);
            string cadenasql = "ALTER TABLE " + tabla + " ADD ID64 T_ENTER64";
            Origin.Execute(cadenasql);
            cadenasql = "ALTER TABLE " + tabla + " ADD VERSION64 T_ENTER64";
            if (tabla != "TABLAS_TPV")
                Origin.Execute(cadenasql);
            cadenasql = "ALTER TABLE " + tabla + " ADD ESTRUCTURA64 T_ENTER64";
            if (tabla != "TABLAS_TPV")
                Origin.Execute(cadenasql);
            if (inserta_int64)
            {
                cadenasql = "INSERT INTO TABLAS_INT64(TABLA) VALUES ('" + tabla + "')";
                Origin.Execute(cadenasql);
                Origin.Commit();
            }

        }
        /*        private SortedList<string, string> DeactivateDestinationTriggers(DataSet ndataset,string tabla)
                {
                    SortedList<string, string> ltriggers = new SortedList<string, string>();
                    string cadenasql = "SELECT RDB$TRIGGER_NAME NOMBRE FROM RDB$TRIGGERS WHERE RDB$RELATION_NAME=" +
                            Reportman.Drawing.StringUtil.QuoteStr(tabla) + " AND  RDB$SYSTEM_FLAG=0 OR RDB$SYSTEM_FLAG IS NULL"+
                            " AND (RDB$FLAGS=1) ";
                    using (DataTable ttriggers = Destination.OpenInmediate(ndataset, cadenasql, "XXXTRIGGERS"+tabla))
                    {
                        foreach (DataRow nrow in ttriggers.Rows)
                        {
                            string trigname = nrow["NOMBRE"].ToString().Trim();
                            cadenasql = "ALTER TRIGGER " + Delimiter + trigname + Delimiter;
                            ltriggers.Add(trigname, cadenasql + " ACTIVE");
                            cadenasql = cadenasql + " INACTIVE";
                            Destination.Execute(cadenasql);
                        }

                    }
                    return ltriggers;
                }
                private void ActivateDestinationTriggers(SortedList<string, string> ltriggers,string tabla)
                {
                    // Activate triggers again
                    foreach (string trigname in ltriggers.Values)
                    {
                        Destination.Execute(trigname);
                    }
                }*/
        private void Modifytable(DataSet ndataset, string tabla)
        {
            // Deactivate triggers
            SortedList<string, string> ltriggers = new SortedList<string, string>();
            string cadenasql = "SELECT T.RDB$TRIGGER_NAME NOMBRE " +
                " FROM RDB$TRIGGERS T " +
                " LEFT OUTER JOIN RDB$CHECK_CONSTRAINTS CHK ON T.RDB$TRIGGER_NAME = CHK.RDB$TRIGGER_NAME " +
                " WHERE (CHK.RDB$TRIGGER_NAME IS NULL) AND T.RDB$RELATION_NAME=" +
                    Reportman.Drawing.StringUtil.QuoteStr(tabla) + "  AND " +
                    " (T.RDB$SYSTEM_FLAG IS NULL OR T.RDB$SYSTEM_FLAG <> 1) AND (T.RDB$FLAGS=1)";
            using (DataTable ttriggers = Origin.OpenInmediate(ndataset, cadenasql, "XXXTRIGGERS"))
            {
                foreach (DataRow nrow in ttriggers.Rows)
                {
                    string trigname = nrow["NOMBRE"].ToString().Trim();
                    cadenasql = "ALTER TRIGGER " + Delimiter + trigname + Delimiter;
                    ltriggers.Add(trigname, cadenasql + " ACTIVE");
                    cadenasql = cadenasql + " INACTIVE";
                    Origin.Execute(cadenasql);
                }

            }
            Origin.Commit();

            cadenasql = "UPDATE " + tabla + " SET ID64=GEN_ID(GEN_ID64,1),"
             + "VERSION64=GEN_ID(GEN_VERSION64,1)";
            Origin.Execute(cadenasql);
            // Activate triggers again
            foreach (string trigname in ltriggers.Values)
            {
                Origin.Execute(trigname);
            }
            Origin.Commit();

            string indexname = "I_" + tabla + "_64";
            if (indexname.Length > 30)
                indexname = "I" + tabla + "64";
            if (indexname.Length > 30)
                indexname = "I" + tabla.Substring(0, 28) + "6";
            cadenasql = "CREATE UNIQUE DESCENDING INDEX " + indexname + "D ON " + tabla + "(ID64)";
            Origin.Execute(cadenasql);
            cadenasql = "CREATE UNIQUE DESCENDING INDEX " + indexname + "V ON " + tabla + "(VERSION64)";
            Origin.Execute(cadenasql);
            Origin.Commit();
        }
        private void CreateTableTriggers(DataSet ndataset, string tabla)
        {
            string nomtrig = "TRIG_" + tabla + "_VERB";
            if (nomtrig.Length > 29)
            {
                nomtrig = "TR" + tabla + "VERB";
            }
            if (nomtrig.Length > 29)
            {
                nomtrig = tabla + "VERB";
            }
            if (nomtrig.Length > 29)
            {
                nomtrig = tabla + "B";
            }
            if (nomtrig.Length > 29)
            {
                nomtrig = "TR" + tabla.Substring(0, 25) + "B";
            }

            string cadenasql = "CREATE OR ALTER TRIGGER " + nomtrig + "I FOR " + tabla + " BEFORE INSERT POSITION 0"
            + "AS"
            + " BEGIN"
             + " NEW.ID64=GEN_ID(GEN_ID64,1);"
             + " NEW.VERSION64=GEN_ID(GEN_VERSION64,1);"
            + " END";
            Origin.Execute(cadenasql);
            cadenasql = "CREATE OR ALTER TRIGGER " + nomtrig + "U FOR " + tabla + " BEFORE UPDATE POSITION 0"
            + " AS"
            + " BEGIN"
             + " NEW.VERSION64=GEN_ID(GEN_VERSION64,1);"
            + " END";
            Origin.Execute(cadenasql);
            cadenasql = "CREATE OR ALTER TRIGGER " + nomtrig + "D FOR " + tabla + " BEFORE DELETE POSITION 0"
            + " AS"
            + " BEGIN"
            + " INSERT INTO BORRADOS_ID64(TABLA,ID64,VERSION64) VALUES('" + tabla + "',OLD.ID64,GEN_ID(GEN_BORRADOS64,1));"
            + " END";
            Origin.Execute(cadenasql);
            Origin.Commit();

        }



    }
}
