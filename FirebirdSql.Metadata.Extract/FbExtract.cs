using FirebirdSql.Data.FirebirdClient;
using System;
using System.Collections.Generic;
using System.Data;
using System.IO;
using System.Text;

namespace FirebirdSql.Metadata.Extract
{
    public delegate DataTable FilLEvent(FbCommand ncommand);
    public class FbExtract
    {
        private FbConnection Connection;
        private FbTransaction Transaction;
        private int dialect;
        public string IdentifierSeparator;
        public string SentenceSeparator;
        public string AlternativeSentenceSeparator;
        public FilLEvent OnFill;
        FbDatabaseInfo ndbinfo;
        public int OdsVersion;
        public int OdsSubVersion;
        public int PageSize;
        public FbExtract(FbConnection Connection, FbTransaction Transaction,
            int dialect)
        {
            this.Transaction = Transaction;
            this.Connection = Connection;
            this.dialect = dialect;
            if (dialect == 1)
                IdentifierSeparator = "";
            else
                IdentifierSeparator = "\"";
            SentenceSeparator = ";";
            AlternativeSentenceSeparator = System.Environment.NewLine + "^";
        }
        public static string FieldTypeToSource(int field_type, int field_sub_type,
                int length, int scale, int character_length, int precision,
                int dialect, ref string int_type)
        {
            string aresult;
            switch (field_type)
            {
                case 7:
                    aresult = "SMALLINT";
                    int_type = "SMALLINT";
                    break;
                case 8:
                    aresult = "INTEGER";
                    int_type = "INTEGER";
                    break;
                case 9:
                    aresult = "QUAD";
                    int_type = "QUAD";
                    break;
                case 10:
                    aresult = "FLOAT";
                    int_type = "FLOAT";
                    break;
                case 11:
                case 27:
                    aresult = "DOUBLE PRECISION";
                    int_type = "DOUBLE PRECISION";
                    break;
                case 12:
                    aresult = "DATE";
                    int_type = "DOUBLE PRECISION";
                    if (field_sub_type == 1)
                    {
                        aresult = aresult + " WITH TIME ZONE";
                    }
                    break;
                case 13:
                    aresult = "TIME";
                    int_type = "DOUBLE PRECISION";
                    break;
                case 14:
                    aresult = "CHAR(" + character_length.ToString() + ")";
                    int_type = "CHAR";
                    break;
                case 16:
                    // Int64
                    if (field_sub_type == 0)
                        aresult = "BIGINT";
                    else
                       if (field_sub_type == 2)
                        aresult = "DECIMAL";
                    else
                        aresult = "NUMERIC";

                    int_type = "INT64";
                    break;
                case 35:
                    if (dialect > 2)
                    {
                        aresult = "TIMESTAMP";
                        int_type = "INT64";
                    }
                    else
                    {
                        aresult = "DATE";
                        int_type = "INTEGER";
                    }
                    if (field_sub_type == 1)
                    {
                        aresult = aresult + " WITH TIME ZONE";
                        int_type = "INT96";
                    }
                    break;
                case 37:
                    aresult = "VARCHAR(" + character_length.ToString() + ")";
                    int_type = "VARCHAR";
                    break;
                case 40:
                    if (character_length > 0)
                        aresult = "CSTRING(" + character_length.ToString() + ")";
                    else
                        aresult = "CSTRING(" + length.ToString() + ")";
                    int_type = "CSTRING";
                    break;
                case 261:
                    aresult = "BLOB";
                    int_type = "BLOB";
                    break;
                case 24:
                    aresult = "DECFLOAT(16)";
                    break;
                case 25:
                    aresult = "DECFLOAT(34)";
                    break;
                case 26:
                    aresult = "INT128";
                    break;
                case 23:
                    aresult = "BOOLEAN";
                    break;
                case 29:
                    aresult = "TIMESTAMP WITH TIME ZONE";
                    int_type = "DOUBLE PRECISION";
                    break;
                default:
                    aresult = "UNKNOWN";
                    break;
            }
            if (scale < 0)
            {
                if ((aresult != "NUMERIC") && (aresult != "DECIMAL"))
                    aresult = "NUMERIC";
                if (precision > 0)
                {
                    aresult = aresult + "(" + precision.ToString() + "," + (-scale).ToString() + ")";
                }
                else
                {

                    switch (length)
                    {
                        case 2:
                            aresult = aresult + "(4," + (-scale).ToString() + ")";
                            break;
                        case 4:
                            aresult = aresult + "(9," + (-scale).ToString() + ")";
                            break;
                        case 8:
                            if (dialect == 1)
                                aresult = aresult + "(15," + (-scale).ToString() + ")";
                            else
                                aresult = aresult + "(18," + (-scale).ToString() + ")";
                            break;
                        default:
                            break;
                    }
                }
            }
            else
            {
                if ((aresult == "NUMERIC") || (aresult == "DECIMAL"))
                {
                    if (precision > 0)
                    {
                        aresult = aresult + "(" + precision.ToString() + ",0)";
                    }
                    else
                        aresult = aresult + "(18,0)";
                }
            }
            return aresult;
        }
        private DataTable OpenQuery(string sql)
        {
            DataTable ntable = null;
            FbTransaction trans = Transaction;
            using (FbCommand acommand = new FbCommand(sql, Connection, trans))
            {
                if (OnFill == null)
                {
                    using (FbDataAdapter nadap = new FbDataAdapter())
                    {
                        nadap.SelectCommand = acommand;
                        ntable = new DataTable();
                        nadap.Fill(ntable);
                    }
                }
                else
                    ntable = OnFill(acommand);
            }
            return ntable;
        }
        public static string QuoteStr(string text)
        {
            text.Replace("'", "''");
            text = "'" + text + "'";
            return text;
        }
        private DataTable FillTable(string sql, DataSet data, string tablename)
        {
            DataTable ntable = OpenQuery(sql);
            ntable.TableName = tablename;
            if (ntable.DataSet != null)
                ntable.DataSet.Tables.Remove(ntable);
            data.Tables.Add(ntable);
            List<DataColumn> scols = new List<DataColumn>();
            foreach (DataColumn ncol in ntable.Columns)
            {
                if (ncol.DataType == System.Type.GetType("System.String"))
                    scols.Add(ncol);
            }
            if (scols.Count > 0)
            {
                for (int i = 0; i < ntable.Rows.Count; i++)
                {
                    DataRow arow = ntable.Rows[i];
                    arow.BeginEdit();
                    foreach (DataColumn acol in scols)
                    {
                        if (arow[acol] != DBNull.Value)
                        {
                            arow[acol] = arow[acol].ToString().Trim();
                        }
                    }
                    arow.EndEdit();
                }
            }
            return ntable;
        }
        internal static string GetSqlDomains(string domainname, string relationname, int dialect)
        {
            string sql = "SELECT F.RDB$FIELD_NAME AS NAME," +
                            "F.RDB$FIELD_TYPE AS FIELD_TYPE,F.RDB$FIELD_SUB_TYPE AS FIELD_SUB_TYPE," +
                            "F.RDB$FIELD_LENGTH AS FIELD_LENGTH,F.RDB$FIELD_SCALE AS FIELD_SCALE," +
                            "F.RDB$NULL_FLAG AS NULL_FLAG,F.RDB$CHARACTER_LENGTH AS CHARACTER_SIZE," +
                            "F.RDB$FIELD_PRECISION AS FIELD_PRECISION," +
                            "CO.RDB$COLLATION_NAME AS COLLATION_NAME," +
                            "CH.RDB$CHARACTER_SET_NAME AS CHARACTER_SET_NAME, " +
                            "F.RDB$DEFAULT_SOURCE AS DEFAULT_SOURCE," +
                            "F.RDB$VALIDATION_SOURCE AS VALIDATION_SOURCE," +
                            "F.RDB$COMPUTED_SOURCE AS COMPUTED_SOURCE," +
                            "RDB$SEGMENT_LENGTH AS SEG_LENGTH,D.RDB$DIMENSION AS DIMENSION, " +
                            "D.RDB$LOWER_BOUND AS LOWER_BOUND,D.RDB$UPPER_BOUND AS UPPER_BOUND ";
            // List only domains related to that table
            if (relationname.Length > 0)
            {
                sql = sql + " FROM RDB$RELATIONS R " +
                    " LEFT OUTER JOIN RDB$RELATION_FIELDS RF" +
                    " ON RF.RDB$RELATION_NAME=R.RDB$RELATION_NAME " +
                    " LEFT OUTER JOIN RDB$FIELDS F" +
                    " ON RF.RDB$FIELD_SOURCE=F.RDB$FIELD_NAME" +
                    " LEFT OUTER JOIN RDB$COLLATIONS CO " +
                    // Maybe dedpending on ODS Version use RF or F in collation ID
                    " ON CO.RDB$COLLATION_ID=RF.RDB$COLLATION_ID " +
                         " AND CO.RDB$CHARACTER_SET_ID=F.RDB$CHARACTER_SET_ID ";
            }
            else
            {
                sql = sql + " FROM RDB$FIELDS F " +
                 " LEFT OUTER JOIN RDB$COLLATIONS CO " +
                 " ON CO.RDB$COLLATION_ID=F.RDB$COLLATION_ID " +
                              " AND CO.RDB$CHARACTER_SET_ID=F.RDB$CHARACTER_SET_ID ";
            }
            sql = sql + " LEFT OUTER JOIN RDB$CHARACTER_SETS CH " +
                            " ON CH.RDB$CHARACTER_SET_ID=F.RDB$CHARACTER_SET_ID ";


            sql = sql + " LEFT OUTER JOIN RDB$FIELD_DIMENSIONS D " +
                            " ON D.RDB$FIELD_NAME=F.RDB$FIELD_NAME " +
                            " WHERE (F.RDB$SYSTEM_FLAG=0 OR (F.RDB$SYSTEM_FLAG IS NULL)) " +
                            " AND (NOT F.RDB$FIELD_NAME STARTING WITH 'RDB$') ";
            if (domainname != "")
                sql = sql + " AND F.RDB$FIELD_NAME = " + QuoteStr(domainname);
            sql = sql + " ORDER BY F.RDB$FIELD_NAME,D.RDB$DIMENSION";

            return sql;
        }
        internal static void ProcessDomains(DataTable tareader, DataTable table, StringBuilder sbuilder, int dialect, string SentenceSeparator)
        {
            short sub_type, segment, char_length, scale, precision;
            string int_type = "";
            string domname, newdomainname;
            string data_type = "";
            string domainsource;
            string charset;
            string collation;
            string default_source;
            string validation_source;
            string dimension = "";
            short null_flag;
            bool recordfound = tareader.Rows.Count > 0;
            int idxrow = 0;
            while (recordfound)
            {
                DataRow areader = tareader.Rows[idxrow];
                sub_type = 0;
                char_length = 0;
                segment = 0;
                scale = 0;
                precision = 0;
                null_flag = 0;
                domname = areader["NAME"].ToString().Trim();
                if (areader["FIELD_SUB_TYPE"] != DBNull.Value)
                    sub_type = (short)areader["FIELD_SUB_TYPE"];
                if (areader["SEG_LENGTH"] != DBNull.Value)
                    segment = (short)areader["SEG_LENGTH"];
                if (areader["CHARACTER_SIZE"] != DBNull.Value)
                    char_length = (short)areader["CHARACTER_SIZE"];
                if (areader["FIELD_SCALE"] != DBNull.Value)
                    scale = (short)areader["FIELD_SCALE"];
                if (areader["FIELD_PRECISION"] != DBNull.Value)
                    precision = (short)areader["FIELD_PRECISION"];
                data_type = FieldTypeToSource((short)areader["FIELD_TYPE"], sub_type,
                                 (short)areader["FIELD_LENGTH"], scale, char_length,
                                 precision, dialect, ref int_type);
                domainsource = data_type;
                charset = "";
                collation = "";
                if (areader["CHARACTER_SET_NAME"] != DBNull.Value)
                    charset = areader["CHARACTER_SET_NAME"].ToString().Trim();
                default_source = areader["DEFAULT_SOURCE"].ToString().Trim();
                validation_source = areader["VALIDATION_SOURCE"].ToString().Trim();
                if (areader["NULL_FLAG"] != DBNull.Value)
                    null_flag = (short)areader["NULL_FLAG"];
                if (areader["COLLATION_NAME"] != DBNull.Value)
                    collation = areader["COLLATION_NAME"].ToString().Trim();
                // Read field dimensions
                if (areader["DIMENSION"] != DBNull.Value)
                {
                    dimension = "[";
                    dimension = dimension + areader["LOWER_BOUND"].ToString() +
                        ":" + areader["UPPER_BOUND"].ToString();
                    idxrow++;
                    recordfound = idxrow < tareader.Rows.Count;
                    if (recordfound)
                        areader = tareader.Rows[idxrow];
                    newdomainname = areader["NAME"].ToString().Trim();
                    while (recordfound && (newdomainname == domname))
                    {
                        dimension = dimension + ",";
                        dimension = dimension + areader["LOWER_BOUND"].ToString() +
                            ":" + areader["UPPER_BOUND"].ToString();
                        idxrow++;
                        recordfound = idxrow < tareader.Rows.Count;
                        if (recordfound)
                            areader = tareader.Rows[idxrow];
                        if (recordfound)
                            newdomainname = areader["NAME"].ToString().Trim();
                    }
                    dimension = dimension + "]";
                }
                else
                {
                    dimension = "";
                    idxrow++;
                    recordfound = idxrow < tareader.Rows.Count;
                    if (recordfound)
                        areader = tareader.Rows[idxrow];
                }
                if (dimension.Length > 0)
                    domainsource = domainsource + dimension;
                if (int_type == "BLOB")
                {
                    domainsource = domainsource + " SUB_TYPE " + sub_type.ToString();
                    domainsource = domainsource + " SEGMENT SIZE " + segment.ToString();
                }
                if (charset.Length > 0)
                    domainsource = domainsource + " CHARACTER SET " + charset;
                if (default_source.Length > 0)
                    domainsource = domainsource + " " + default_source;
                if (validation_source.Length > 0)
                {
                    int indexconst = validation_source.ToUpper().IndexOf("CONSTRAINT");
                    if (indexconst >= 0)
                    {
                        string newsource = "";
                        if (indexconst > 0)
                            newsource = newsource + validation_source.Substring(0, indexconst);
                        validation_source = newsource + validation_source.Substring(indexconst + 10, validation_source.Length - indexconst - 10).Trim();
                    }
                }
                if (validation_source.Length > 0)
                    domainsource = domainsource + " " + validation_source;
                if (null_flag == 1)
                    domainsource = domainsource + " NOT NULL";
                if (collation.Length > 0)
                    domainsource = domainsource + " COLLATE " + collation;
                string partialdomainsource = domainsource;
                domainsource = "CREATE DOMAIN " + QuoteIdentifier(domname, dialect) + " " + domainsource;
                if (table != null)
                {
                    DataRow nrow = table.NewRow();
                    nrow["NAME"] = domname;
                    nrow["SOURCE"] = domainsource;
                    if (nrow.Table.Columns.IndexOf("PARTIAL_SOURCE") > 0)
                        nrow["PARTIAL_SOURCE"] = partialdomainsource;
                    table.Rows.Add(nrow);
                }

                if (sbuilder != null)
                    sbuilder.AppendLine(domainsource + SentenceSeparator);
            }

        }

        public string ExtractDomain(string domainname, string relationname,
            DataTable table)
        {
            string sql = GetSqlDomains(domainname, relationname, dialect);
            StringBuilder sbuilder = new StringBuilder();
            using (DataTable tareader = OpenQuery(sql))
            {
                ProcessDomains(tareader, table, sbuilder, dialect, SentenceSeparator);
            }
            return sbuilder.ToString();
        }
        //        public static string DecodeConnectionStringValue(string value)
        //        {
        //            string[] parts = connectionString.Split(";".ToCharArray());
        //            foreach (string p in parts)
        //            {
        //                string dvalue= p.Split("=".ToCharArray);
        //                if (dvalue.Get
        //            }
        //        }
        public string ExtractCreateDatabase()
        {
            string sql = "";
            bool monitortables = false;
            StringBuilder sbuilder = new StringBuilder();
            sbuilder.Append("CREATE DATABASE ");


            // Server version with monitoring tables
            //if (ninfo.ServerVersion.IndexOf("V2") >= 0)
            //{
            if ((OdsVersion == 0) || (PageSize == 0))
            {
                FbDatabaseInfo ninfo = new FbDatabaseInfo(Connection);
                OdsVersion = ninfo.GetOdsVersion();
                PageSize = ninfo.GetPageSize();
            }
            if (OdsVersion >= 11)
                monitortables = true;
            //}
            string datafile = "";
            if (monitortables)
            {
                sql = "SELECT MON$DATABASE_NAME AS DBNAME FROM MON$DATABASE";
                using (DataTable tareader = OpenQuery(sql))
                {
                    if (tareader.Rows.Count > 0)
                        datafile = tareader.Rows[0]["DBNAME"].ToString();
                }
            }
            else
            {

            }
            // Page Size
            sbuilder.Append(" PAGE_SIZE " + PageSize.ToString());
            sbuilder.Append(System.Environment.NewLine);

            // Default character set
            sql = "SELECT D.RDB$CHARACTER_SET_NAME AS CHARSET FROM RDB$DATABASE D";
            using (DataTable tareader = OpenQuery(sql))
            {
                if (tareader.Rows.Count > 0)
                    sbuilder.Append(" DEFAULT CHARACTER SET " + tareader.Rows[0]["CHARSET"].ToString().Trim());
            }


            return sbuilder.ToString();
        }
        internal static string GetSqlFilter(string filtername, int dialect)
        {
            string sql = "SELECT F.RDB$FUNCTION_NAME,F.RDB$MODULE_NAME,F.RDB$ENTRYPOINT," +
                "F.RDB$INPUT_SUB_TYPE,F.RDB$OUTPUT_SUB_TYPE " +
                "FROM RDB$FILTERS F ";
            if (filtername != "")
                sql = sql + " WHERE F.RDB$FILTER_NAME=" + QuoteStr(filtername);
            return sql;
        }
        internal static void ProcessFilters(DataTable tareader, DataTable table, StringBuilder sbuilder, int dialect, string SentenceSeparator)
        {
            DataRow areader = null;
            int idxrow = 0;
            bool recordfound = idxrow < tareader.Rows.Count;
            if (recordfound)
                areader = tareader.Rows[idxrow];
            while (recordfound)
            {
                string line = "DECLARE FILTER " + QuoteIdentifier(areader["RDB$FUNCTION_NAME"].ToString().Trim(), dialect) +
                 " INPUT_TYPE " + areader["RDB$INPUT_SUB_TYPE"].ToString().Trim() +
                 " OUTPUT_TYPE " + areader["RDB$OUTPUT_SUB_TYPE"].ToString().Trim() +
                 " ENTRY_POINT " + areader["RDB$ENTRYPOINT"].ToString().Trim() +
                 " MODULE_NAME " + areader["RDB$MODULE_NAME"].ToString().Trim() + SentenceSeparator;
                if (sbuilder != null)
                    sbuilder.AppendLine(line);
                if (table != null)
                {
                    DataRow nrow = table.NewRow();
                    nrow["NAME"] = areader["RDB$FUNCTION_NAME"].ToString().Trim();
                    nrow["SOURCE"] = line;
                    table.Rows.Add(nrow);
                }
                idxrow++;
                recordfound = idxrow < tareader.Rows.Count;
                if (recordfound)
                    areader = tareader.Rows[idxrow];
            }

        }
        public string ExtractFilter(string filtername,
            DataTable table)
        {
            StringBuilder sbuilder = new StringBuilder();
            string sql = GetSqlFilter(filtername, dialect);
            using (DataTable tareader = OpenQuery(sql))
            {
                ProcessFilters(tareader, table, sbuilder, dialect, SentenceSeparator);
            }
            return sbuilder.ToString();
        }
        public static string GetSqlFunctions(string functionname, int dialect, int ods)
        {
            string sql;
            if (ods >= 12)
            {
                sql = "SELECT F.RDB$FUNCTION_NAME,F.RDB$MODULE_NAME,F.RDB$ENTRYPOINT,L.RDB$ARGUMENT_NAME," +
                    "FX.RDB$FIELD_NAME AS DOMAIN_NAME,L.RDB$NULL_FLAG AS NULL_FLAG,FX.RDB$NULL_FLAG AS NULL_FLAG_DOMAIN,FX.RDB$SYSTEM_FLAG AS SYSTEM_FLAG," +
                    "F.RDB$RETURN_ARGUMENT,L.RDB$ARGUMENT_POSITION,L.RDB$MECHANISM, " +
                    "COALESCE(CASE WHEN L.RDB$FIELD_TYPE=0 THEN NULL ELSE L.RDB$FIELD_TYPE END,FX.RDB$FIELD_TYPE) AS FIELD_TYPE," +
                    "COALESCE(L.RDB$FIELD_SCALE,FX.RDB$FIELD_SCALE) AS FIELD_SCALE," +
                    "COALESCE(L.RDB$FIELD_LENGTH,fX.RDB$FIELD_LENGTH) AS FIELD_LENGTH,L.RDB$FIELD_SUB_TYPE AS FIELD_SUB_TYPE," +
                    "COALESCE(L.RDB$FIELD_PRECISION,FX.RDB$FIELD_PRECISION) AS FIELD_PRECISION," +
                    "COALESCE(L.RDB$CHARACTER_LENGTH,fX.RDB$CHARACTER_LENGTH) AS CHARACTER_SIZE," +
                    "CH.RDB$CHARACTER_SET_NAME AS CHARACTER_SET_NAME,COALESCE(L.RDB$CHARACTER_SET_ID,FX.RDB$CHARACTER_SET_ID) AS CHARSET, " +
                    "CH.RDB$BYTES_PER_CHARACTER AS BYTES_CHAR,F.RDB$FUNCTION_SOURCE AS SOURCE,F.RDB$OWNER_NAME AS OWNER_NAME " +
                    " FROM RDB$FUNCTIONS F " +
                    " LEFT OUTER JOIN RDB$FUNCTION_ARGUMENTS L " +
                    " ON L.RDB$FUNCTION_NAME=F.RDB$FUNCTION_NAME " +
                    " LEFT OUTER JOIN RDB$FIELDS FX" +
                    " ON L.RDB$FIELD_SOURCE=FX.RDB$FIELD_NAME" +
                    " LEFT OUTER JOIN RDB$CHARACTER_SETS CH " +
                    " ON CH.RDB$CHARACTER_SET_ID=COALESCE(L.RDB$CHARACTER_SET_ID,FX.RDB$CHARACTER_SET_ID) " +
                    " WHERE (NOT F.RDB$FUNCTION_NAME STARTING WITH 'RDB$') " +
                    " AND (F.RDB$SYSTEM_FLAG IS NULL OR F.RDB$SYSTEM_FLAG=0) AND F.RDB$PACKAGE_NAME IS NULL";
                if (functionname != "")
                    sql = sql + " AND F.RDB$FUNCTION_NAME=" + QuoteStr(functionname);
                sql = sql + " ORDER BY F.RDB$FUNCTION_NAME,L.RDB$ARGUMENT_POSITION ";

            }
            else
            {
                sql = "SELECT F.RDB$FUNCTION_NAME,F.RDB$MODULE_NAME,F.RDB$ENTRYPOINT," +
                    "F.RDB$RETURN_ARGUMENT,L.RDB$ARGUMENT_POSITION,L.RDB$MECHANISM, " +
                    "L.RDB$FIELD_TYPE AS FIELD_TYPE,L.RDB$FIELD_SCALE AS FIELD_SCALE," +
                    "L.RDB$FIELD_LENGTH AS FIELD_LENGTH,L.RDB$FIELD_SUB_TYPE AS FIELD_SUB_TYPE," +
                    "L.RDB$FIELD_PRECISION AS FIELD_PRECISION,L.RDB$CHARACTER_LENGTH AS CHARACTER_SIZE," +
                    "CH.RDB$CHARACTER_SET_NAME AS CHARACTER_SET_NAME,L.RDB$CHARACTER_SET_ID AS CHARSET, " +
                    "CH.RDB$BYTES_PER_CHARACTER AS BYTES_CHAR";
                sql = sql +
                    " FROM RDB$FUNCTIONS F " +
                    " LEFT OUTER JOIN RDB$FUNCTION_ARGUMENTS L " +
                    " ON L.RDB$FUNCTION_NAME=F.RDB$FUNCTION_NAME " +
                    " LEFT OUTER JOIN RDB$CHARACTER_SETS CH " +
                    " ON CH.RDB$CHARACTER_SET_ID=L.RDB$CHARACTER_SET_ID " +
                    " WHERE (NOT F.RDB$FUNCTION_NAME STARTING WITH 'RDB$') ";
                if (functionname != "")
                    sql = sql + " AND F.RDB$FUNCTION_NAME=" + QuoteStr(functionname);
                sql = sql + " ORDER BY F.RDB$FUNCTION_NAME,L.RDB$ARGUMENT_POSITION ";
            }
            return sql;
        }

        public static void ProcessFunctions(DataTable tareader, DataTable table, StringBuilder sbuilder, int dialect,
            string SentenceSeparator, bool headerOnly, ExtractFunctionType extractType)
        {
            string args = "";
            string funcsource = "";
            string returns = "";
            string finishstring = "";
            string linestart = "";
            string funcname = "";
            string entry_point = "";
            string module_name = "";
            bool hasInternalFunctions = false;
            if (tareader.Columns.IndexOf("SOURCE") >= 0)
            {
                hasInternalFunctions = true;
            }


            DataRow areader = null;
            int idxrow = 0;
            bool recordfound = idxrow < tareader.Rows.Count;
            if (recordfound)
                areader = tareader.Rows[idxrow];
            short sub_type, char_length, scale, precision;
            string int_type = "";
            string data_type = "";
            while (recordfound)
            {
                string newfuncname = areader["RDB$FUNCTION_NAME"].ToString().Trim();
                if (newfuncname != funcname)
                {
                    if (funcname.Length > 0)
                    {
                        if (returns.Length == 0)
                            returns = "RETURNS INTEGER";
                        string line = linestart;
                        string lineHeader = "";
                        if (funcsource.Length > 0)
                        {
                            if (args.Length > 0)
                                line = line + " (" + args + ") " + returns + " AS ";
                            else
                                line = line + " " + returns + " AS ";
                            lineHeader = line + " BEGIN END ";
                            line = line + funcsource;
                        }
                        else
                        {
                            if (args.Length > 0)
                                line = line + " " + args + " " + returns + " ";
                            else
                                line = line + " " + returns + " ";
                            line = line + finishstring;
                        }
                        bool include = true;
                        if (extractType != ExtractFunctionType.Both)
                        {
                            if (funcsource.Length > 0)
                            {
                                include = extractType == ExtractFunctionType.Functions;
                            }
                            else
                            {
                                include = extractType == ExtractFunctionType.Udfs;
                            }
                        }
                        if ((sbuilder != null) && (include))
                        {
                            if (headerOnly)
                            {
                                if (lineHeader.Length > 0)
                                {
                                    sbuilder.Append(lineHeader);
                                }
                                else
                                {
                                    sbuilder.Append(line);
                                }
                            }
                            else
                            {
                                sbuilder.Append(line);
                            }
                            sbuilder.AppendLine(SentenceSeparator);
                        }
                        if ((table != null) && (include))
                        {
                            DataRow nrow = table.NewRow();
                            nrow["NAME"] = funcname;
                            nrow["SOURCE"] = line;
                            nrow["SOURCE_HEADER"] = lineHeader;
                            if (nrow.Table.Columns.IndexOf("ENTRY_POINT") >= 0)
                            {
                                nrow["ENTRY_POINT"] = entry_point;
                            }
                            if (nrow.Table.Columns.IndexOf("INPUT") >= 0)
                            {
                                nrow["INPUT"] = args;
                                if (returns.Length > 0)
                                    nrow["OUTPUT"] = returns.Substring(8, returns.Length - 8);
                                nrow["ENTRY_POINT"] = entry_point;
                                nrow["MODULE_NAME"] = module_name;
                            }
                            table.Rows.Add(nrow);
                        }
                    }
                    funcname = newfuncname;
                    args = "";
                    funcsource = "";
                    returns = "";

                    if (hasInternalFunctions)
                    {
                        funcsource = areader["SOURCE"].ToString();
                    }
                    if (funcsource.Length > 0)
                    {
                        finishstring = "";
                        linestart = "CREATE OR ALTER FUNCTION " + QuoteIdentifier(funcname, dialect);
                    }
                    else
                    {
                        entry_point = areader["RDB$ENTRYPOINT"].ToString().Trim();
                        module_name = areader["RDB$MODULE_NAME"].ToString().Trim();
                        linestart = "DECLARE EXTERNAL FUNCTION " + QuoteIdentifier(funcname, dialect);
                        finishstring = " ENTRY_POINT '" + areader["RDB$ENTRYPOINT"].ToString().Trim() + "'" +
                            " MODULE_NAME '" + areader["RDB$MODULE_NAME"].ToString().Trim() + "'";
                    }
                }
                if (areader["RDB$ARGUMENT_POSITION"] != DBNull.Value)
                {
                    bool free_it = false;
                    bool isInternalFunction = false;
                    int mechanism = 0;
                    if (areader["RDB$MECHANISM"] != DBNull.Value)
                    {
                        mechanism = System.Convert.ToInt32(areader["RDB$MECHANISM"]);
                    }
                    if (hasInternalFunctions)
                    {
                        if (areader["SOURCE"].ToString().Length > 0)
                        {
                            mechanism = 20;
                            isInternalFunction = true;
                        }
                    }
                    if (mechanism < 0)
                    {
                        free_it = true;
                        mechanism = -mechanism;
                    }
                    bool isdomain = false;
                    int null_flag = 0;
                    bool null_flag_domain = false;
                    if (isInternalFunction)
                    {
                        if (areader["NULL_FLAG"] != DBNull.Value)
                            null_flag = (short)areader["NULL_FLAG"];
                        if (null_flag == 1)
                        {
                            // If is a domain level null don't mark it as not null
                            if (isdomain)
                                if (areader["NULL_FLAG_DOMAIN"] != DBNull.Value)
                                {
                                    if (Convert.ToInt32(areader["NULL_FLAG_DOMAIN"]) == 1)
                                    {
                                        null_flag_domain = true;
                                        null_flag = 0;
                                    }
                                }
                        }
                        string domain_name = areader["DOMAIN_NAME"].ToString().Trim();
                        isdomain = true;
                        // Domain ?
                        if (domain_name.Length > 4)
                        {
                            if (domain_name.Substring(0, 4) == "RDB$")
                                if ((domain_name[4] > '0') && (domain_name[4] <= '9'))
                                {
                                    if (areader["SYSTEM_FLAG"] == DBNull.Value)
                                        isdomain = false;
                                    else
                                        if ((short)areader["SYSTEM_FLAG"] != 1)
                                        isdomain = false;
                                }
                        }
                    }
                    char_length = 0;
                    if (isdomain)
                    {
                        data_type = areader["DOMAIN_NAME"].ToString().Trim();
                        if (areader["NULL_FLAG_DOMAIN"] != DBNull.Value)
                        {
                            if (Convert.ToInt32(areader["NULL_FLAG_DOMAIN"]) == 1)
                            {
                                null_flag_domain = true;
                            }
                        }
                    }
                    else
                    {
                        sub_type = 0;
                        scale = 0;
                        precision = 0;
                        if (areader["FIELD_SUB_TYPE"] != DBNull.Value)
                            sub_type = (short)areader["FIELD_SUB_TYPE"];
                        if (areader["CHARACTER_SIZE"] != DBNull.Value)
                            char_length = (short)areader["CHARACTER_SIZE"];
                        if (areader["FIELD_SCALE"] != DBNull.Value)
                            scale = (short)areader["FIELD_SCALE"];
                        if (areader["FIELD_PRECISION"] != DBNull.Value)
                            precision = (short)areader["FIELD_PRECISION"];
                        int flength = 0;
                        if (areader["FIELD_LENGTH"] != DBNull.Value)
                            flength = System.Convert.ToInt32(areader["FIELD_LENGTH"]);
                        if (areader["CHARSET"] != DBNull.Value)
                        {
                            if (char_length == 0)
                            {
                                int charset = Convert.ToInt32(areader["CHARSET"]);
                                if (areader["BYTES_CHAR"] != DBNull.Value)
                                {
                                    int byteschar = Convert.ToInt32(areader["BYTES_CHAR"]);
                                    char_length = Convert.ToInt16(flength / byteschar);
                                }
                            }
                        }
                        data_type = FieldTypeToSource(System.Convert.ToInt32(areader["FIELD_TYPE"]), sub_type,
                                         flength, scale, char_length,
                                         precision, dialect, ref int_type);
                    }
                    if ((null_flag == 1) && (!null_flag_domain))
                        data_type = data_type + " NOT NULL";
                    if (free_it)
                        data_type = data_type + " FREE_IT";
                    if ((short)areader["RDB$ARGUMENT_POSITION"] == (short)areader["RDB$RETURN_ARGUMENT"])
                    {
                        switch (mechanism)
                        {
                            case 0:
                                data_type = data_type + " BY VALUE";
                                break;
                            case 5:
                                data_type = data_type + " BY DESCRIPTOR";
                                break;
                        }

                        returns = "RETURNS " + data_type;
                    }
                    else
                    {
                        switch (mechanism)
                        {
                            case 1:
                                break;
                            case 5:
                                data_type = data_type + " BY DESCRIPTOR";
                                break;
                        }
                        if (args.Length > 0)
                            args = args + ",";
                        if (isInternalFunction)
                        {
                            args = args + areader["RDB$ARGUMENT_NAME"].ToString().Trim() + " ";
                        }
                        args = args + data_type;
                    }
                }
                idxrow++;
                recordfound = idxrow < tareader.Rows.Count;
                if (recordfound)
                    areader = tareader.Rows[idxrow];
            }
            if (funcname.Length > 0)
            {
                if (returns.Length == 0)
                    returns = "RETURNS INTEGER";
                string line = linestart;
                string lineHeader = "";
                if (funcsource.Length > 0)
                {
                    if (args.Length > 0)
                        line = line + " (" + args + ") " + returns + " AS ";
                    else
                        line = line + " " + returns + " AS ";
                    lineHeader = line + " BEGIN END ";
                    line = line + funcsource;
                }
                else
                {
                    if (args.Length > 0)
                        line = line + " " + args + " " + returns + " ";
                    else
                        line = line + " " + returns + " ";
                    line = line + finishstring;
                }
                bool include = true;
                if (extractType != ExtractFunctionType.Both)
                {
                    if (funcsource.Length > 0)
                    {
                        include = extractType == ExtractFunctionType.Functions;
                    }
                    else
                    {
                        include = extractType == ExtractFunctionType.Udfs;
                    }
                }
                if ((sbuilder != null) && (include))
                {
                    if (headerOnly)
                    {
                        if (lineHeader.Length > 0)
                        {
                            sbuilder.Append(lineHeader);
                        }
                        else
                        {
                            sbuilder.Append(line);
                        }
                    }
                    else
                    {
                        sbuilder.Append(line);
                    }
                    sbuilder.AppendLine(SentenceSeparator);
                }
                if ((table != null) && (include))
                {
                    DataRow nrow = table.NewRow();
                    nrow["NAME"] = funcname;
                    nrow["SOURCE"] = line;
                    nrow["SOURCE_HEADER"] = lineHeader;
                    if (nrow.Table.Columns.IndexOf("ENTRY_POINT") >= 0)
                    {
                        nrow["ENTRY_POINT"] = entry_point;
                    }
                    if (nrow.Table.Columns.IndexOf("INPUT") >= 0)
                    {
                        nrow["INPUT"] = args;
                        if (returns.Length > 0)
                            nrow["OUTPUT"] = returns.Substring(8, returns.Length - 8);
                        nrow["ENTRY_POINT"] = entry_point;
                        nrow["MODULE_NAME"] = module_name;
                    }
                    table.Rows.Add(nrow);
                }
            }
        }
        public enum ExtractFunctionType { Both, Udfs, Functions };
        public string ExtractFunction(string functionname,
            DataTable table, bool headerOnly, ExtractFunctionType extractType)
        {
            if (OdsVersion == 0)
            {
                FbDatabaseInfo ninfo = new FbDatabaseInfo(Connection);
                OdsVersion = ninfo.GetOdsVersion();
                OdsSubVersion = ninfo.GetOdsMinorVersion();
            }
            string sql = GetSqlFunctions(functionname, dialect, OdsVersion);


            StringBuilder sbuilder = new StringBuilder();


            using (DataTable tareader = OpenQuery(sql))
            {
                ProcessFunctions(tareader, table, sbuilder, dialect, SentenceSeparator, headerOnly, extractType);
            }
            return sbuilder.ToString();
        }
        public string QuoteIdentifier(string iden)
        {
            string aresult = iden;
            if (dialect == 1)
                aresult = iden.ToUpper();
            else
            {
                aresult = iden.Replace("\"", "\"\"");
                aresult = "\"" + aresult + "\"";
            }
            return aresult;
        }
        internal static string QuoteIdentifier(string iden, int dialect)
        {
            string aresult = iden;
            if (dialect == 1)
                aresult = iden.ToUpper();
            else
            {
                aresult = iden.Replace("\"", "\"\"");
                aresult = "\"" + aresult + "\"";
            }
            return aresult;
        }
        private static string FormatIdenSpaces(string iden)
        {
            string aresult = iden + "                               ";
            return aresult.Substring(0, 31);
        }
        public string ExtractPrimaryKey(string tablename,
            DataTable table, SortedList<string, List<string>> primary_columns)
        {
            bool addtablename = false;
            if (table != null)
                if (table.Columns.IndexOf("TABLE") >= 0)
                    addtablename = true;

            StringBuilder sbuilder = new StringBuilder();
            string relsql = "SELECT RELC.RDB$RELATION_NAME AS RELATION_NAME,RELC.RDB$CONSTRAINT_NAME," +
                "RELC.RDB$CONSTRAINT_TYPE,RELC.RDB$INDEX_NAME," +
                "I.RDB$FIELD_NAME,I.RDB$FIELD_POSITION" +
                " FROM RDB$RELATION_CONSTRAINTS RELC" +
                " LEFT OUTER JOIN RDB$INDEX_SEGMENTS I" +
                " ON I.RDB$INDEX_NAME=RELC.RDB$INDEX_NAME" +
                " WHERE (RELC.RDB$CONSTRAINT_TYPE = 'PRIMARY KEY' OR" +
                " RELC.RDB$CONSTRAINT_TYPE = 'UNIQUE') AND (NOT RELC.RDB$RELATION_NAME STARTING WITH 'RDB$') ";
            if (tablename != "")
                relsql = relsql + " AND RELC.RDB$RELATION_NAME=" + QuoteStr(tablename);
            relsql = relsql + " ORDER BY RELC.RDB$RELATION_NAME,RELC.RDB$CONSTRAINT_NAME,I.RDB$FIELD_POSITION";
            DataSet cached = new DataSet();
            try
            {
                DataColumn[] cols3 = new DataColumn[3];
                DataTable reltable = FillTable(relsql, cached, "UNIQUES");
                cols3[0] = reltable.Columns[0];
                cols3[1] = reltable.Columns[1];
                cols3[2] = reltable.Columns["RDB$FIELD_POSITION"];
                reltable.Constraints.Add("PRIMUNIQUES", cols3, true);

                DataView viewtable = new DataView(reltable, "",
                    "RDB$CONSTRAINT_NAME,RDB$FIELD_POSITION", DataViewRowState.CurrentRows);
                string relname = "";
                string consname = "";
                string lfields = "";
                string constype = "";
                StringBuilder fields = new StringBuilder();
                foreach (DataRowView convrow in viewtable)
                {
                    DataRow conrow = convrow.Row;
                    string newconsname = conrow["RDB$CONSTRAINT_NAME"].ToString();
                    string newrelaname = conrow["RELATION_NAME"].ToString();
                    if (newconsname != consname)
                    {
                        if (consname != "")
                        {
                            bool include = true;
                            if (consname.Length > 4)
                                if (consname.Substring(0, 5) == "INTEG")
                                {
                                    include = false;
                                }
                            if (include)
                            {
                                fields.Append(" CONSTRAINT " + QuoteIdentifier(consname));
                            }
                            if (constype == "PRIMARY KEY")
                                fields.Append(" PRIMARY KEY ");
                            else
                                fields.Append(" UNIQUE ");
                            fields.Append(lfields + ")");
                            string nline = "ALTER TABLE " + QuoteIdentifier(relname) + " ADD " + fields.ToString();
                            sbuilder.AppendLine(nline);
                            if (table != null)
                            {
                                DataRow nrow = table.NewRow();
                                nrow["NAME"] = relname + " - " + consname;
                                nrow["SOURCE"] = nline;
                                if (addtablename)
                                {
                                    nrow["TABLE"] = relname;
                                }
                                table.Rows.Add(nrow);
                            }
                            fields = new StringBuilder();
                        }
                        lfields = "";
                        consname = newconsname;
                        relname = newrelaname;
                        constype = conrow["RDB$CONSTRAINT_TYPE"].ToString();
                    }
                    if (lfields != "")
                        lfields = lfields + ",";
                    else
                        lfields = "(";
                    string fname = conrow["RDB$FIELD_NAME"].ToString();
                    lfields = lfields + QuoteIdentifier(fname);
                    if (primary_columns != null)
                    {
                        if (primary_columns.IndexOfKey(relname) < 0)
                            primary_columns.Add(relname, new List<string>());
                        primary_columns[relname].Add(fname);
                    }
                }
                if (consname != "")
                {
                    bool include = true;
                    if (consname.Length > 4)
                        if (consname.Substring(0, 5) == "INTEG")
                        {
                            include = false;
                        }
                    if (include)
                    {
                        fields.Append(" CONSTRAINT " + QuoteIdentifier(consname));
                    }
                    if (constype == "PRIMARY KEY")
                        fields.Append(" PRIMARY KEY ");
                    else
                        fields.Append(" UNIQUE ");
                    fields.Append(lfields + ")");
                    string nline = "ALTER TABLE " + QuoteIdentifier(relname) + " ADD " + fields.ToString();
                    sbuilder.AppendLine(nline);
                    if (table != null)
                    {
                        DataRow nrow = table.NewRow();
                        nrow["NAME"] = relname + " - " + consname;
                        nrow["SOURCE"] = nline;
                        if (addtablename)
                        {
                            nrow["TABLE"] = relname;
                        }
                        table.Rows.Add(nrow);
                    }
                    lfields = "";
                    fields = new StringBuilder();

                }

            }
            finally
            {
                for (int i = 0; i < cached.Tables.Count; i++)
                {
                    cached.Tables[i].Dispose();
                }
                cached.Tables.Clear();
                cached.Dispose();
            }


            return sbuilder.ToString();
        }
        internal static void GetTablesSql(string tablename, bool domains, bool primary_key, bool hasrelationtype,
             ref string sql, ref string checksql, ref string relsql)
        {
            sql = "SELECT R.RDB$RELATION_NAME AS RELATION_NAME,F.RDB$FIELD_NAME AS FIELD_NAME," +
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
                " CO2.RDB$COLLATION_NAME AS COLLATION_NAME_DOMAIN,R.RDB$OWNER_NAME,R.RDB$EXTERNAL_FILE";
            if (hasrelationtype)
                sql = sql + ",R.RDB$RELATION_TYPE ";
            sql = sql +
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
                " WHERE (R.RDB$SYSTEM_FLAG=0 OR (R.RDB$SYSTEM_FLAG IS NULL)) AND (RDB$VIEW_BLR IS NULL) ";
            if (tablename != "")
                sql = sql + " AND R.RDB$RELATION_NAME=" + QuoteStr(tablename);
            sql = sql + " ORDER BY R.RDB$RELATION_NAME,F.RDB$FIELD_POSITION";
            // Fields with null flag
            checksql = "SELECT RCO.RDB$RELATION_NAME,CON.RDB$TRIGGER_NAME,RCO.RDB$CONSTRAINT_NAME," +
                " RCO.RDB$CONSTRAINT_TYPE,RCO.RDB$INDEX_NAME" +
                " FROM RDB$RELATION_CONSTRAINTS RCO" +
                " LEFT OUTER JOIN RDB$CHECK_CONSTRAINTS CON" +
                " ON CON.RDB$CONSTRAINT_NAME = RCO.RDB$CONSTRAINT_NAME " +
                " WHERE RCO.RDB$CONSTRAINT_TYPE = 'NOT NULL'" +
                " AND (NOT CON.RDB$CONSTRAINT_NAME IS NULL) ";
            if (tablename != "")
                checksql = checksql + " AND RCO.RDB$RELATION_NAME=" + QuoteStr(tablename);
            checksql = checksql + " ORDER BY RCO.RDB$RELATION_NAME";

            relsql = "SELECT RELC.RDB$RELATION_NAME AS RELATION_NAME,RELC.RDB$CONSTRAINT_NAME," +
                "RELC.RDB$CONSTRAINT_TYPE,RELC.RDB$INDEX_NAME," +
                "I.RDB$FIELD_NAME,I.RDB$FIELD_POSITION" +
                " FROM RDB$RELATION_CONSTRAINTS RELC" +
                " LEFT OUTER JOIN RDB$INDEX_SEGMENTS I" +
                " ON I.RDB$INDEX_NAME=RELC.RDB$INDEX_NAME" +
                " WHERE (RELC.RDB$CONSTRAINT_TYPE = 'PRIMARY KEY' OR" +
                " RELC.RDB$CONSTRAINT_TYPE = 'UNIQUE')";
            if (tablename != "")
                relsql = relsql + " AND RELC.RDB$RELATION_NAME=" + QuoteStr(tablename);
            relsql = relsql + " ORDER BY RELC.RDB$RELATION_NAME,RELC.RDB$CONSTRAINT_NAME,I.RDB$FIELD_POSITION";

        }
        public static DataTable CreateFieldsTable()
        {
            DataTable ntable = new DataTable("FIELDS");
            ntable.Columns.Add("TABLE", System.Type.GetType("System.String"));
            ntable.Columns.Add("POSITION", System.Type.GetType("System.Int32"));
            ntable.Columns.Add("FIELD", System.Type.GetType("System.String"));
            ntable.Columns.Add("SOURCE", System.Type.GetType("System.String"));
            DataColumn[] ncolumns = new DataColumn[3];
            ncolumns[0] = ntable.Columns[0];
            ncolumns[1] = ntable.Columns[1];
            ncolumns[2] = ntable.Columns[2];
            ntable.Constraints.Add("IPRIFIELDS", ncolumns, true);
            return ntable;
        }
        internal static void ProcessTables(string tablename, bool domains, bool primary_key, bool hasrelationtype,
             DataTable tareader, DataTable checktable, DataTable reltable,
             DataTable table, DataTable fieldstable, StringBuilder sbuilder, int dialect, string SentenceSeparator,
            SortedList<string, List<string>> primary_keys, List<string> changeTypes)
        {
            SortedList<string, string> TypesChange = new SortedList<string, string>();
            if (changeTypes != null)
            {
                foreach (string nstring in changeTypes)
                {
                    string[] parts = nstring.Split(',');
                    if (parts.Length != 2)
                    {
                        throw new Exception("Incorrect syntax change types must be: TABLE.COLUMN,NEWTYPE actual " + nstring);
                    }
                    string[] parts2 = parts[0].Split('.');
                    if (parts2.Length != 2)
                    {
                        throw new Exception("Incorrect syntax change types must be: TABLE.COLUMN,NEWTYPE actual " + nstring);
                    }
                    TypesChange.Add(parts[0], parts[1]);
                }
            }
            bool addlength = false;
            if (fieldstable != null)
                if (fieldstable.Columns.IndexOf("LENGTH") >= 0)
                    addlength = true;

            using (DataView viewreltable = new DataView(reltable, "", "RELATION_NAME", DataViewRowState.CurrentRows))
            {
                DataColumn[] cols = new DataColumn[2];
                cols[0] = checktable.Columns[0];
                cols[1] = checktable.Columns[1];
                checktable.Constraints.Add("PRIMCHECKS", cols, true);

                DataColumn[] cols3 = new DataColumn[3];
                cols3[0] = reltable.Columns[0];
                cols3[1] = reltable.Columns[1];
                cols3[2] = reltable.Columns["RDB$FIELD_POSITION"];
                reltable.Constraints.Add("PRIMUNIQUES", cols3, true);

                string tname = "";
                DataRow areader = null;
                int idxrow = 0;
                bool recordfound = idxrow < tareader.Rows.Count;
                if (recordfound)
                    areader = tareader.Rows[idxrow];
                short sub_type, segment, char_length, scale, precision;
                char_length = 0;
                string int_type = "";
                string domname, newdomainname;
                string data_type = "";
                string domainsource;
                string charset;
                string last_charset = "";
                int last_length = 0;
                string collation;
                string default_source;
                string validation_source;
                string dimension = "";
                short null_flag;
                string newtname = "";
                bool doread;
                string fieldname = "";
                string fieldsource;
                string external_file = "";
                string owner_name = "";
                bool latest = false;
                int ttype = 0;
                StringBuilder fields = new StringBuilder();
                while (recordfound || latest)
                {
                    charset = "";
                    doread = true;
                    if (!latest)
                    {
                        newtname = areader["RELATION_NAME"].ToString().Trim();
                        fieldname = areader["FIELD_NAME"].ToString().Trim();
                    }
                    if ((newtname != tname))
                    {
                        if (tname.Length > 0)
                        {
                            if (sbuilder != null)
                                sbuilder.Append("/* Table: " + tname + " Owner:" +
                                    owner_name + " */" + System.Environment.NewLine);
                            string line = "CREATE";
                            if (ttype == 5)
                                line = line + " GLOBAL TEMPORARY";
                            line = line + " TABLE " + QuoteIdentifier(tname, dialect);
                            if (external_file != "")
                            {
                                line = line + " EXTERNAL FILE " + QuoteStr(external_file);
                            }
                            // Append Unique constraints
                            if (primary_key)
                            {
                                DataRowView[] viewtable = viewreltable.FindRows(tname);
                                string consname = "";
                                string lfields = "";
                                string constype = "";
                                foreach (DataRowView convrow in viewtable)
                                {
                                    DataRow conrow = convrow.Row;
                                    string newconsname = conrow["RDB$CONSTRAINT_NAME"].ToString();
                                    if (newconsname != consname)
                                    {
                                        if (consname != "")
                                        {
                                            fields.Append(",");
                                            fields.Append(System.Environment.NewLine);
                                            bool include = true;
                                            if (consname.Length > 4)
                                                if (consname.Substring(0, 5) == "INTEG")
                                                {
                                                    include = false;
                                                }
                                            if (include)
                                            {
                                                fields.Append(" CONSTRAINT " + QuoteIdentifier(consname, dialect));
                                            }
                                            if (constype == "PRIMARY KEY")
                                                fields.Append(" PRIMARY KEY ");
                                            else
                                                fields.Append(" UNIQUE ");
                                            fields.Append(lfields + ")");
                                        }
                                        lfields = "";
                                        consname = newconsname;
                                        constype = conrow["RDB$CONSTRAINT_TYPE"].ToString();
                                    }
                                    if (lfields != "")
                                        lfields = lfields + ",";
                                    else
                                        lfields = "(";
                                    string fname = conrow["RDB$FIELD_NAME"].ToString().Trim();
                                    lfields = lfields + QuoteIdentifier(fname, dialect);
                                    if (primary_keys != null)
                                    {
                                        if (primary_keys.IndexOfKey(tname) < 0)
                                            primary_keys.Add(tname, new List<string>());
                                        primary_keys[tname].Add(fname);
                                    }
                                }
                                if (consname != "")
                                {
                                    fields.Append(",");
                                    fields.Append(System.Environment.NewLine);
                                    bool include = true;
                                    if (consname.Length > 4)
                                        if (consname.Substring(0, 5) == "INTEG")
                                        {
                                            include = false;
                                        }
                                    if (include)
                                    {
                                        fields.Append(" CONSTRAINT " + QuoteIdentifier(consname, dialect));
                                    }
                                    if (constype == "PRIMARY KEY")
                                        fields.Append(" PRIMARY KEY ");
                                    else
                                        fields.Append(" UNIQUE ");
                                    fields.Append(lfields + ")");
                                }
                            }
                            fields.Append(System.Environment.NewLine);
                            fields.AppendLine(")" + SentenceSeparator);
                            line = line + System.Environment.NewLine + fields.ToString() + System.Environment.NewLine;
                            if (sbuilder != null)
                                sbuilder.Append(line);
                            if (table != null)
                            {
                                DataRow nrow = table.NewRow();
                                nrow["NAME"] = tname;
                                nrow["SOURCE"] = line;
                                table.Rows.Add(nrow);
                            }
                            fields = new StringBuilder();
                        }
                        tname = newtname;
                        if (latest)
                            break;
                    }
                    external_file = areader["RDB$EXTERNAL_FILE"].ToString().Trim();
                    if (hasrelationtype)
                    {
                        ttype = 0;
                        if (areader["RDB$RELATION_TYPE"] != DBNull.Value)
                            ttype = System.Convert.ToInt32(areader["RDB$RELATION_TYPE"]);
                    }
                    owner_name = areader["RDB$OWNER_NAME"].ToString().Trim();
                    if (fields.Length == 0)
                    {
                        fields.AppendLine("(");
                    }
                    else
                    {
                        fields.Append(",");
                        fields.Append(System.Environment.NewLine);
                    }
                    fields.Append(" ");
                    fields.Append(QuoteIdentifier(areader["FIELD_NAME"].ToString().Trim(), dialect) + " ");
                    fieldsource = "";
                    default_source = "";
                    validation_source = "";
                    collation = "";
                    bool null_flag_domain = false;
                    if (areader["RDB$COMPUTED_BLR"] != DBNull.Value)
                    {
                        // fields.Append(" COMPUTED BY ");
                        string computed = areader["COMPUTED_SOURCE"].ToString().Trim();
                        if (computed != "")
                            fieldsource = " COMPUTED BY " + computed;
                    }
                    else
                    {
                        // Null can be a constraint added to the column
                        null_flag = 0;
                        object[] keys = new object[2];
                        keys[0] = tname;
                        keys[1] = fieldname;
                        DataRow nullrow = checktable.Rows.Find(keys);
                        if (nullrow != null)
                            null_flag = 1;
                        string domain_name = areader["DOMAIN_NAME"].ToString().Trim();
                        // Domain ?
                        bool isdomain = true;
                        if (domain_name.Length > 4)
                        {
                            if (domain_name.Substring(0, 4) == "RDB$")
                                if ((domain_name[4] > '0') && (domain_name[4] <= '9'))
                                {
                                    if (areader["SYSTEM_FLAG"] == DBNull.Value)
                                        isdomain = false;
                                    else
                                        if ((short)areader["SYSTEM_FLAG"] != 1)
                                        isdomain = false;
                                }
                        }
                        if (null_flag == 0)
                        {
                            if (areader["NULL_FLAG"] != DBNull.Value)
                                null_flag = (short)areader["NULL_FLAG"];
                            if (null_flag == 1)
                            {
                                // If is a domain level null don't mark it as not null
                                if (isdomain)
                                    if (areader["NULL_FLAG_DOMAIN"] != DBNull.Value)
                                    {
                                        if (Convert.ToInt32(areader["NULL_FLAG_DOMAIN"]) == 1)
                                        {
                                            null_flag_domain = true;
                                            null_flag = 0;
                                        }
                                    }
                            }
                        }
                        if (TypesChange.ContainsKey(newtname + "." + fieldname))
                        {
                            fieldsource = TypesChange[newtname + "." + fieldname];
                        }
                        else
                        if (isdomain)
                        {
                            fieldsource = areader["DOMAIN_NAME"].ToString().Trim();
                            if (areader["NULL_FLAG_DOMAIN"] != DBNull.Value)
                            {
                                if (Convert.ToInt32(areader["NULL_FLAG_DOMAIN"]) == 1)
                                {
                                    null_flag_domain = true;
                                }
                            }
                            if (areader["CHARACTER_SIZE"] != DBNull.Value)
                                char_length = (short)areader["CHARACTER_SIZE"];
                            if (areader["CHARACTER_SET_NAME"] != DBNull.Value)
                                charset = areader["CHARACTER_SET_NAME"].ToString().Trim();
                            last_charset = charset;
                            last_length = char_length;
                        }
                        else
                        {
                            // Decode field type
                            sub_type = 0;
                            char_length = 0;
                            segment = 0;
                            scale = 0;
                            precision = 0;
                            domname = FormatIdenSpaces(areader["RELATION_NAME"].ToString()) +
                                areader["FIELD_NAME"].ToString().Trim();
                            if (areader["FIELD_SUB_TYPE"] != DBNull.Value)
                                sub_type = (short)areader["FIELD_SUB_TYPE"];
                            if (areader["SEG_LENGTH"] != DBNull.Value)
                                segment = (short)areader["SEG_LENGTH"];
                            if (areader["CHARACTER_SIZE"] != DBNull.Value)
                                char_length = (short)areader["CHARACTER_SIZE"];
                            if (areader["FIELD_SCALE"] != DBNull.Value)
                                scale = (short)areader["FIELD_SCALE"];
                            if (areader["RDB$FIELD_PRECISION"] != DBNull.Value)
                                precision = (short)areader["RDB$FIELD_PRECISION"];
                            data_type = FieldTypeToSource((short)areader["FIELD_TYPE"], sub_type,
                                             (short)areader["FIELD_LENGTH"], scale, char_length,
                                             precision, dialect, ref int_type);
                            domainsource = data_type;
                            if (int_type == "BLOB")
                            {
                                domainsource = domainsource + " SUB_TYPE " + sub_type.ToString();
                                domainsource = domainsource + " SEGMENT SIZE " + segment.ToString();
                            }
                            charset = "";
                            collation = "";
                            if (areader["CHARACTER_SET_NAME"] != DBNull.Value)
                                charset = areader["CHARACTER_SET_NAME"].ToString().Trim();
                            // Null flag can be inside the domain
                            if (null_flag == 0)
                            {
                                if (areader["NULL_FLAG_DOMAIN"] != DBNull.Value)
                                    null_flag = (short)areader["NULL_FLAG_DOMAIN"];
                            }
                            if (areader["COLLATION_NAME"] != DBNull.Value)
                                collation = areader["COLLATION_NAME"].ToString().Trim();
                            // Read field dimensions
                            dimension = "";
                            if (areader["DIMENSION"] != DBNull.Value)
                            {
                                doread = false;
                                dimension = "[";
                                dimension = dimension + areader["LOWER_BOUND"].ToString() +
                                    ":" + areader["UPPER_BOUND"].ToString();
                                idxrow++;
                                recordfound = idxrow < tareader.Rows.Count;
                                if (recordfound)
                                    areader = tareader.Rows[idxrow];
                                newdomainname = FormatIdenSpaces(areader["RELATION_NAME"].ToString()) +
                                    areader["FIELD_NAME"].ToString().Trim();
                                while (recordfound && (newdomainname == domname))
                                {
                                    dimension = dimension + ",";
                                    dimension = dimension + areader["LOWER_BOUND"].ToString() +
                                        ":" + areader["UPPER_BOUND"].ToString();
                                    idxrow++;
                                    recordfound = idxrow < tareader.Rows.Count;
                                    if (recordfound)
                                        areader = tareader.Rows[idxrow];
                                    if (recordfound)
                                        newdomainname = FormatIdenSpaces(areader["RELATION_NAME"].ToString()) +
                                            areader["FIELD_NAME"].ToString().Trim();
                                }
                                dimension = dimension + "]";
                            }
                            if (dimension.Length > 0)
                                domainsource = domainsource + dimension;
                            if (charset.Length > 0)
                                domainsource = domainsource + " CHARACTER SET " + charset;
                            fieldsource = domainsource;
                            default_source = areader["DEFAULT_SOURCE_DOMAIN"].ToString().Trim();
                            //validation_source = areader["VALIDATION_SOURCE_DOMAIN"].ToString().Trim();
                            collation = areader["COLLATION_NAME_DOMAIN"].ToString().Trim();
                        }
                        if (areader["DEFAULT_SOURCE"].ToString().Trim() != "")
                            default_source = areader["DEFAULT_SOURCE"].ToString().Trim();
                        if (areader["VALIDATION_SOURCE"].ToString().Trim() != "")
                            validation_source = areader["VALIDATION_SOURCE"].ToString().Trim();
                        if (default_source.Length > 0)
                            fieldsource = fieldsource + " " + default_source;
                        //if (validation_source.Length > 0)
                        //    fieldsource = fieldsource + " " + validation_source;
                        if ((null_flag == 1) && (!null_flag_domain))
                            fieldsource = fieldsource + " NOT NULL";
                        if (areader["COLLATION_NAME"].ToString().Trim() != "")
                        {
                            if ((dialect == 3) || (data_type != "BLOB"))
                                collation = areader["COLLATION_NAME"].ToString().Trim();
                        }
                        if (collation.Length > 0)
                            fieldsource = fieldsource + " COLLATE " + collation;
                        last_charset = charset;
                        last_length = char_length;
                    }
                    if (fieldstable != null)
                    {
                        DataRow fieldrow = fieldstable.NewRow();
                        fieldrow["TABLE"] = areader["RELATION_NAME"].ToString().Trim();
                        fieldrow["FIELD"] = areader["FIELD_NAME"].ToString().Trim();
                        fieldrow["POSITION"] = areader["FIELD_POSITION"];
                        if (fieldrow["POSITION"] == DBNull.Value)
                            fieldrow["POSITION"] = 0;
                        fieldrow["SOURCE"] = fieldsource.Trim();
                        if (addlength)
                        {
                            if (last_length > 0)
                                fieldrow["LENGTH"] = last_length;
                            if (last_charset.Length > 0)
                                fieldrow["CHARSET"] = last_charset;
                        }
                        fieldstable.Rows.Add(fieldrow);
                        last_length = 0;
                        last_charset = "";
                        char_length = 0;
                    }

                    fields.Append(fieldsource);
                    if (doread)
                    {
                        idxrow++;
                        recordfound = idxrow < tareader.Rows.Count;
                        if (recordfound)
                            areader = tareader.Rows[idxrow];
                    }
                    if (!recordfound)
                    {
                        newtname = "";
                        latest = true;
                    }
                }
            }

        }
        public List<string> ChangeTypes = new List<string>();

        public string ExtractTable(string tablename,
            DataTable table, bool domains, bool primary_key, DataTable fieldstable)
        {
            if (OdsVersion == 0)
            {
                FbDatabaseInfo ninfo = new FbDatabaseInfo(Connection);
                OdsVersion = ninfo.GetOdsVersion();
                OdsSubVersion = ninfo.GetOdsMinorVersion();
            }
            StringBuilder sbuilder = new StringBuilder();

            // List domains first if necessary
            if ((tablename != "") && domains)
                sbuilder.Append(ExtractDomain("", tablename, null));

            bool hasrelationtype = (OdsVersion > 11) || ((OdsVersion > 10) && (OdsSubVersion > 0));

            string sql = "";
            string relsql = "";
            string checksql = "";

            GetTablesSql(tablename, domains, primary_key, hasrelationtype, ref sql, ref checksql, ref relsql);





            // Create a datatable
            DataSet cached = new DataSet();
            try
            {
                DataTable checktable = FillTable(checksql, cached, "CHECKS");

                DataTable reltable = FillTable(relsql, cached, "UNIQUES");

                using (DataTable tareader = OpenQuery(sql))
                {
                    ProcessTables(tablename, domains, primary_key, hasrelationtype, tareader, checktable, reltable, table, fieldstable, sbuilder, dialect, SentenceSeparator, null, ChangeTypes);
                }

            }
            finally
            {
                for (int i = 0; i < cached.Tables.Count; i++)
                {
                    cached.Tables[i].Dispose();
                }
                cached.Tables.Clear();
                cached.Dispose();
            }

            return sbuilder.ToString();
        }
        public void SaveToStream(Stream outputstream)
        {
            string res = ExtractDatabase();
            byte[] buf = new byte[res.Length];
            for (int i = 0; i < res.Length; i++)
            {
                buf[i] = (byte)res[i];
            }
            outputstream.Write(buf, 0, res.Length);
        }
        public void SaveToFile(string filename)
        {

            using (FileStream fstream = new FileStream(filename, FileMode.Create))
            {
                SaveToStream(fstream);
            }
        }
        internal static string GetIndexSql(string tablename, string indexname, int dialect)
        {
            string sql = "SELECT I.RDB$RELATION_NAME,I.RDB$INDEX_NAME,I.RDB$UNIQUE_FLAG," +
                    "I.RDB$SEGMENT_COUNT,I.RDB$INDEX_TYPE,I.RDB$EXPRESSION_SOURCE," +
                    "S.RDB$FIELD_NAME,S.RDB$FIELD_POSITION" +
                    " FROM RDB$INDICES I" +
                    " LEFT OUTER JOIN RDB$INDEX_SEGMENTS S" +
                    " ON S.RDB$INDEX_NAME=I.RDB$INDEX_NAME" +
                    " LEFT OUTER JOIN RDB$RELATION_CONSTRAINTS R" +
                    " ON R.RDB$INDEX_NAME=I.RDB$INDEX_NAME " +
                    " WHERE ((I.RDB$SYSTEM_FLAG=0) OR (I.RDB$SYSTEM_FLAG IS NULL)) " +
                    " AND (R.RDB$INDEX_NAME IS NULL)";
            if (indexname.Length > 0)
                sql = sql + " AND I.RDB$INDEX_NAME=" + QuoteStr(indexname);
            if (tablename.Length > 0)
                sql = sql + " AND I.RDB$RELATION_NAME=" + QuoteStr(tablename);
            sql = sql + " ORDER BY I.RDB$RELATION_NAME,I.RDB$INDEX_NAME,S.RDB$FIELD_POSITION";
            return sql;
        }
        public static void ProcessIndexes(DataTable tareader, DataTable table, StringBuilder sbuilder, int dialect, string SentenceSeparator)
        {
            DataRow areader = null;
            int idxrow = 0;
            bool recordfound = idxrow < tareader.Rows.Count;
            if (recordfound)
                areader = tareader.Rows[idxrow];
            string args = "";
            string linestart = "";
            string indname = "";
            string relname = "";
            bool addtablename = false;
            if (table != null)
                if (table.Columns.IndexOf("TABLE") >= 0)
                    addtablename = true;
            while (recordfound)
            {
                string newindexname = areader["RDB$INDEX_NAME"].ToString().Trim();
                if (newindexname != indname)
                {
                    if (indname.Length > 0)
                    {
                        string line = linestart;
                        if (args.Length > 0)
                            line = line + " " + args + ")" + SentenceSeparator;
                        if (sbuilder != null)
                            sbuilder.AppendLine(line);
                        if (table != null)
                        {
                            DataRow nrow = table.NewRow();
                            nrow["NAME"] = indname;
                            nrow["SOURCE"] = line;
                            if (addtablename)
                                nrow["TABLE"] = relname;
                            table.Rows.Add(nrow);
                        }
                    }
                    indname = newindexname;
                    relname = areader["RDB$RELATION_NAME"].ToString().Trim();
                    args = "";
                    linestart = "CREATE ";
                    if (areader["RDB$UNIQUE_FLAG"] != DBNull.Value)
                        if ((short)areader["RDB$UNIQUE_FLAG"] == 1)
                            linestart = linestart + "UNIQUE ";

                    if (areader["RDB$INDEX_TYPE"] != DBNull.Value)
                        if ((short)areader["RDB$INDEX_TYPE"] == 1)
                            linestart = linestart + "DESCENDING ";
                    linestart = linestart + "INDEX " + QuoteIdentifier(indname, dialect)
                        + " ON " + QuoteIdentifier(relname, dialect);
                    string exindex = areader["RDB$EXPRESSION_SOURCE"].ToString().Trim();
                    if (exindex != "")
                    {
                        linestart = linestart + " COMPUTED BY " + exindex;
                    }
                }
                if (areader["RDB$FIELD_NAME"] != DBNull.Value)
                {
                    if (args.Length == 0)
                        args = "(";
                    else
                        args = args + ",";
                    args = args + QuoteIdentifier(areader["RDB$FIELD_NAME"].ToString().Trim(), dialect);
                }
                idxrow++;
                recordfound = idxrow < tareader.Rows.Count;
                if (recordfound)
                    areader = tareader.Rows[idxrow];
            }
            if (indname.Length > 0)
            {
                string line = linestart;
                if (args.Length > 0)
                    line = line + " " + args + ")" + SentenceSeparator;
                if (sbuilder != null)
                    sbuilder.AppendLine(line);
                if (table != null)
                {
                    DataRow nrow = table.NewRow();
                    nrow["NAME"] = indname;
                    nrow["SOURCE"] = line;
                    if (addtablename)
                        nrow["TABLE"] = relname;
                    table.Rows.Add(nrow);
                }
            }
        }
        public string ExtractIndex(string tablename, string indexname,
            DataTable table)
        {
            string sql = GetIndexSql(tablename, indexname, dialect);


            StringBuilder sbuilder = new StringBuilder();
            using (DataTable tareader = OpenQuery(sql))
            {
                ProcessIndexes(tareader, table, sbuilder, dialect, SentenceSeparator);
            }
            return sbuilder.ToString();
        }

        internal static void GetForeignSql(string tablename, string foreignname, int dialect, ref string sql, ref string sqlindex)
        {
            sql = "SELECT C.RDB$RELATION_NAME,C.RDB$CONSTRAINT_NAME,C.RDB$CONSTRAINT_TYPE," +
                "CF.RDB$UPDATE_RULE,CF.RDB$DELETE_RULE,CF.RDB$MATCH_OPTION," +
                "CF.RDB$CONST_NAME_UQ,C2.RDB$INDEX_NAME,S.RDB$FIELD_NAME,S.RDB$FIELD_POSITION," +
                "C2.RDB$RELATION_NAME AS RELATED_TABLE,C.RDB$INDEX_NAME AS SOURCE_INDEX " +
                " FROM RDB$RELATION_CONSTRAINTS C" +
                " LEFT OUTER JOIN RDB$REF_CONSTRAINTS CF" +
                " ON CF.RDB$CONSTRAINT_NAME=C.RDB$CONSTRAINT_NAME" +
                " LEFT OUTER JOIN RDB$RELATION_CONSTRAINTS C2" +
                " ON C2.RDB$CONSTRAINT_NAME=CF.RDB$CONST_NAME_UQ" +
                " LEFT OUTER JOIN RDB$INDEX_SEGMENTS S" +
                " ON S.RDB$INDEX_NAME=C2.RDB$INDEX_NAME" +
                " WHERE C.RDB$CONSTRAINT_TYPE='FOREIGN KEY'";
            if (foreignname.Length > 0)
                sql = sql + " AND C.RDB$CONSTRAINT_NAME=" + QuoteStr(foreignname);
            if (tablename.Length > 0)
                sql = sql + " AND C.RDB$RELATION_NAME=" + QuoteStr(tablename);
            sql = sql + " ORDER BY C.RDB$RELATION_NAME,C.RDB$CONSTRAINT_NAME,S.RDB$FIELD_POSITION";

            sqlindex = "SELECT S.RDB$INDEX_NAME AS INDEX_NAME,S.RDB$FIELD_NAME,S.RDB$FIELD_POSITION" +
                " FROM RDB$RELATION_CONSTRAINTS C" +
                " LEFT OUTER JOIN RDB$INDEX_SEGMENTS S" +
                " ON S.RDB$INDEX_NAME=C.RDB$INDEX_NAME" +
                " WHERE C.RDB$CONSTRAINT_TYPE='FOREIGN KEY'";
            if (foreignname.Length > 0)
                sqlindex = sqlindex + " AND C.RDB$CONSTRAINT_NAME=" + QuoteStr(foreignname);
            if (tablename.Length > 0)
                sqlindex = sqlindex + " AND C.RDB$RELATION_NAME=" + QuoteStr(tablename);
            sqlindex = sqlindex + " ORDER BY C.RDB$RELATION_NAME,C.RDB$CONSTRAINT_NAME,S.RDB$FIELD_POSITION";

        }
        public static void ProcessForeigns(DataTable tareader, DataTable tindex,
           DataTable table, StringBuilder sbuilder, int dialect, string SentenceSeparator)
        {
            using (DataView viewindex = new DataView(tindex, "", "INDEX_NAME", DataViewRowState.CurrentRows))
            {
                bool addtablename = false;
                bool addsystemname = false;
                bool addforeigndetail = false;
                bool addreferences = false;
                if (table != null)
                {
                    if (table.Columns.IndexOf("TABLE") >= 0)
                        addtablename = true;
                    if (table.Columns.IndexOf("REFERENCES") >= 0)
                        addreferences = true;
                    if (table.Columns.IndexOf("SYSTEM_NAME") >= 0)
                        addsystemname = true;
                    if (table.Columns.IndexOf("UPDATE_RULE") >= 0)
                        addforeigndetail = true;
                }

                string args = "";
                string linestart = "";
                string consname = "";
                string forname = "";
                string source_index = "";
                string relname = "";
                string relatedname = "";
                string updaterule = "";
                string deleterule = "";
                DataRow areader = null;
                int idxrow = 0;
                bool recordfound = idxrow < tareader.Rows.Count;
                if (recordfound)
                    areader = tareader.Rows[idxrow];
                string keyfields = "";
                string related_keyfields = "";
                DataColumn[] keys = new DataColumn[2];
                keys[0] = tindex.Columns["INDEX_NAME"];
                keys[1] = tindex.Columns["RDB$FIELD_POSITION"];
                tindex.Constraints.Add("PRIMINDEX", keys, true);
                bool system_name = false;
                while (recordfound)
                {
                    string newforname = areader["RDB$CONSTRAINT_NAME"].ToString().Trim();
                    if (newforname != forname)
                    {
                        if (forname.Length > 0)
                        {
                            string line = linestart;
                            if (args.Length > 0)
                                line = line + " " + args + ")";
                            if (updaterule != "RESTRICT")
                            {
                                line = line + " ON UPDATE " + updaterule;
                            }
                            if (deleterule != "RESTRICT")
                            {
                                line = line + " ON DELETE " + deleterule;
                            }
                            line = line + SentenceSeparator;
                            if (sbuilder != null)
                                sbuilder.AppendLine(line);
                            if (table != null)
                            {
                                DataRow nrow = table.NewRow();
                                nrow["NAME"] = forname;
                                nrow["SOURCE"] = line;
                                if (addtablename)
                                    nrow["TABLE"] = relname;
                                if (addsystemname)
                                    nrow["SYSTEM_NAME"] = system_name;
                                if (addforeigndetail)
                                {
                                    nrow["CONSTRAINT_TYPE"] = "FOREIGN KEY";
                                    nrow["FIELDNAMES"] = keyfields;
                                    nrow["EXPRESSION"] = DBNull.Value;
                                    nrow["RELATED_TABLE"] = relatedname;
                                    nrow["RELATED_FIELDNAMES"] = related_keyfields;
                                    nrow["CONS_NAME_UQ"] = forname;
                                    nrow["UPDATE_RULE"] = updaterule;
                                    nrow["DELETE_RULE"] = deleterule;
                                }
                                if (addreferences)
                                    nrow["REFERENCES"] = relatedname;
                                table.Rows.Add(nrow);
                            }
                        }
                        forname = newforname;
                        relname = areader["RDB$RELATION_NAME"].ToString().Trim();
                        consname = areader["RDB$CONSTRAINT_NAME"].ToString().Trim();
                        updaterule = areader["RDB$UPDATE_RULE"].ToString().Trim().ToUpper();
                        deleterule = areader["RDB$DELETE_RULE"].ToString().Trim().ToUpper();
                        source_index = areader["SOURCE_INDEX"].ToString().Trim();
                        args = "";
                        linestart = "ALTER TABLE " + QuoteIdentifier(relname, dialect) + " ADD";
                        bool include = true;
                        system_name = false;
                        if (consname.Length > 5)
                            if (consname.Substring(0, 6) == "INTEG_")
                            {
                                include = false;
                                system_name = true;
                            }
                        if (include)
                        {
                            linestart = linestart + " CONSTRAINT " + QuoteIdentifier(consname, dialect);
                        }
                        linestart = linestart + " FOREIGN KEY ";
                        DataRowView[] nview = viewindex.FindRows(source_index);
                        //using (DataView nview = new DataView(tindex, "INDEX_NAME=" + QuoteStr(source_index), "RDB$FIELD_POSITION", DataViewRowState.CurrentRows))
                        {
                            string sfields = "";
                            keyfields = "";
                            foreach (DataRowView rview in nview)
                            {
                                DataRow nrow = rview.Row;
                                if (sfields == "")
                                    sfields = sfields + "(";
                                else
                                    sfields = sfields + ",";
                                string identifi = QuoteIdentifier(nrow["RDB$FIELD_NAME"].ToString().Trim(), dialect);
                                sfields = sfields + identifi;
                                if (keyfields.Length > 0)
                                    keyfields = keyfields + ",";
                                keyfields = keyfields + identifi;


                            }
                            sfields = sfields + ")";
                            relatedname = areader["RELATED_TABLE"].ToString().Trim();
                            linestart = linestart + sfields + " REFERENCES " + QuoteIdentifier(relatedname, dialect) + " ";
                            related_keyfields = "";
                        }
                    }
                    if (areader["RDB$FIELD_NAME"] != DBNull.Value)
                    {
                        if (args.Length == 0)
                            args = "(";
                        else
                            args = args + ",";
                        string identifi = QuoteIdentifier(areader["RDB$FIELD_NAME"].ToString().Trim(), dialect);
                        args = args + identifi;
                        if (related_keyfields.Length > 0)
                            related_keyfields = related_keyfields + ",";
                        related_keyfields = related_keyfields + identifi;
                    }
                    idxrow++;
                    recordfound = idxrow < tareader.Rows.Count;
                    if (recordfound)
                        areader = tareader.Rows[idxrow];
                }
                if (forname.Length > 0)
                {
                    string line = linestart;
                    if (args.Length > 0)
                        line = line + " " + args + ")";
                    if (updaterule != "RESTRICT")
                    {
                        line = line + " ON UPDATE " + updaterule;
                    }
                    if (deleterule != "RESTRICT")
                    {
                        line = line + " ON DELETE " + deleterule;
                    }
                    line = line + SentenceSeparator;
                    if (sbuilder != null)
                        sbuilder.AppendLine(line);
                    if (table != null)
                    {
                        DataRow nrow = table.NewRow();
                        nrow["NAME"] = forname;
                        if (addsystemname)
                            nrow["SYSTEM_NAME"] = system_name;
                        nrow["SOURCE"] = line;
                        if (addtablename)
                            nrow["TABLE"] = relname;
                        if (addforeigndetail)
                        {
                            nrow["CONSTRAINT_TYPE"] = "FOREIGN KEY";
                            nrow["FIELDNAMES"] = keyfields;
                            nrow["EXPRESSION"] = DBNull.Value;
                            nrow["RELATED_TABLE"] = relatedname;
                            nrow["RELATED_FIELDNAMES"] = related_keyfields;
                            nrow["CONS_NAME_UQ"] = forname;
                            nrow["UPDATE_RULE"] = updaterule;
                            nrow["DELETE_RULE"] = deleterule;
                        }
                        table.Rows.Add(nrow);
                    }
                }
            }
        }

        public string ExtractForeign(string tablename, string foreignname,
                   DataTable table)
        {
            StringBuilder sbuilder = new StringBuilder();

            string sql = "";
            string sqlindex = "";
            GetForeignSql(tablename, foreignname, dialect, ref sql, ref sqlindex);


            using (DataTable tareader = OpenQuery(sql))
            {
                using (DataTable tindex = OpenQuery(sqlindex))
                {
                    ProcessForeigns(tareader, tindex, table, sbuilder, dialect, SentenceSeparator);
                }
            }

            return sbuilder.ToString();
        }
        internal static string GetSqlGenerators(string generatorname, int dialect)
        {
            string sql = "SELECT G.RDB$GENERATOR_NAME " +
                " FROM RDB$GENERATORS G " +
                " WHERE (G.RDB$SYSTEM_FLAG IS NULL OR G.RDB$SYSTEM_FLAG <> 1)";
            if (generatorname != "")
                sql = sql + " AND G.RDB$GENERATOR_NAME=" + QuoteStr(generatorname);
            sql = sql + " ORDER BY G.RDB$GENERATOR_NAME";
            return sql;
        }
        internal static void ProcessGenerators(DataTable tareader, DataTable table, StringBuilder sbuilder, int dialect, string SentenceSeparator)
        {
            DataRow areader = null;
            int idxrow = 0;
            bool recordfound = idxrow < tareader.Rows.Count;
            if (recordfound)
                areader = tareader.Rows[idxrow];
            while (recordfound)
            {
                string genname = areader["RDB$GENERATOR_NAME"].ToString().Trim();
                string line = "CREATE GENERATOR " + QuoteIdentifier(genname, dialect);
                line = line + SentenceSeparator;
                if (sbuilder != null)
                    sbuilder.AppendLine(line);
                if (table != null)
                {
                    DataRow nrow = table.NewRow();
                    nrow["NAME"] = genname;
                    nrow["SOURCE"] = line;
                    table.Rows.Add(nrow);
                }
                idxrow++;
                recordfound = idxrow < tareader.Rows.Count;
                if (recordfound)
                    areader = tareader.Rows[idxrow];
            }

        }
        public string ExtractGenerator(string generatorname,
            DataTable table)
        {
            StringBuilder sbuilder = new StringBuilder();


            string sql = GetSqlGenerators(generatorname, dialect);

            using (DataTable tareader = OpenQuery(sql))
            {
                ProcessGenerators(tareader, table, sbuilder, dialect, SentenceSeparator);
            }
            return sbuilder.ToString();
        }
        internal static string GetPackagesSql(string packageName, int dialect)
        {
            string sql = "SELECT RDB$PACKAGE_NAME AS NAME,RDB$OWNER_NAME AS OWNER, " +
                " RDB$PACKAGE_HEADER_SOURCE AS HEADER, RDB$PACKAGE_BODY_SOURCE AS BODY " +
                " FROM RDB$PACKAGES " +
                " WHERE (RDB$SYSTEM_FLAG = 0) ";
            if (packageName != "")
                sql = sql + " AND RDB$PACKAGE_NAME=" + QuoteStr(packageName);
            return sql;
        }
        public static void ProcessPackages(DataTable tareader, DataTable table, StringBuilder sbuilder, int dialect,
            string SentenceSeparator, bool headerOnly)
        {
            foreach (DataRow xrow in tareader.Rows)
            {
                string header = xrow["HEADER"].ToString();
                string body = xrow["BODY"].ToString();
                string line = "";
                string packageName = xrow["NAME"].ToString().Trim();
                if (headerOnly)
                {
                    line = "CREATE OR ALTER PACKAGE " + QuoteIdentifier(packageName, dialect) + " AS " +
                        header;
                }
                else
                {
                    line = "RECREATE PACKAGE BODY " + QuoteIdentifier(packageName, dialect) + " AS " +
                        body;
                }
                if (sbuilder != null)
                {
                    sbuilder.AppendLine(line);
                    sbuilder.AppendLine(SentenceSeparator);
                }
                if (table != null)
                {
                    DataRow nrow = table.NewRow();
                    nrow["NAME"] = packageName;
                    nrow["SOURCE"] = NormalizeLineBreaks(line);
                    table.Rows.Add(nrow);
                }
            }
        }
        internal static string GetViewsSql(string viewname, int dialect)
        {
            string sql = "SELECT R.RDB$RELATION_NAME,R.RDB$VIEW_SOURCE,F.RDB$FIELD_NAME," +
                " R.RDB$OWNER_NAME,R.RDB$RELATION_ID " +
                " FROM RDB$RELATIONS R" +
                " LEFT OUTER JOIN RDB$RELATION_FIELDS F" +
                " ON F.RDB$RELATION_NAME=R.RDB$RELATION_NAME" +
                " WHERE ((R.RDB$SYSTEM_FLAG = 0) OR (R.RDB$SYSTEM_FLAG IS NULL)) AND" +
                "(NOT (R.RDB$VIEW_BLR IS NULL)) AND R.RDB$FLAGS = 1 ";
            if (viewname != "")
                sql = sql + " WHERE R.RDB$RELATION_NAME=" + QuoteStr(viewname);
            sql = sql + " ORDER BY R.RDB$RELATION_ID,R.RDB$RELATION_NAME,F.RDB$FIELD_POSITION";
            return sql;
        }
        public static void ProcessViews(DataTable tareader, DataTable table, StringBuilder sbuilder, int dialect, string SentenceSeparator,
            bool emptyBody)
        {
            string args = "";
            string finishstring = "";
            string line = "";
            string vname = "";
            DataRow areader = null;
            int argCount = 0;
            int idxrow = 0;
            bool recordfound = idxrow < tareader.Rows.Count;
            if (recordfound)
                areader = tareader.Rows[idxrow];
            bool addtablename = false;
            if (table != null)
                if (table.Columns.IndexOf("TABLE") >= 0)
                    addtablename = true;
            List<string> arguments = new List<string>();
            string newvname = "";
            while (recordfound)
            {
                newvname = areader["RDB$RELATION_NAME"].ToString().Trim();
                if (newvname != vname)
                {
                    if (vname.Length > 0)
                    {
                        if (emptyBody)
                        {
                            finishstring = finishstring + " SELECT ";
                            for (int idx = 0; idx < argCount; idx++)
                            {
                                if (idx != 0)
                                {
                                    finishstring = finishstring + " , ";
                                }
                                finishstring = finishstring + " NULL AS " + arguments[idx];
                            }
                            finishstring = finishstring + " FROM RDB$DATABASE ";
                        }
                        line = line + args + finishstring + SentenceSeparator;
                        if (sbuilder != null)
                            sbuilder.AppendLine(line);
                        if (table != null)
                        {
                            DataRow nrow = table.NewRow();
                            nrow["NAME"] = vname;
                            nrow["SOURCE"] = line;
                            if (addtablename)
                                nrow["TABLE"] = newvname;
                            table.Rows.Add(nrow);
                        }
                    }
                    vname = newvname;
                    args = "";
                    string owner_name = areader["RDB$OWNER_NAME"].ToString().Trim();
                    line = "/* View: " + vname + " Owner:" +
                        owner_name + " */" + System.Environment.NewLine;
                    line = line + "CREATE OR ALTER VIEW " + QuoteIdentifier(vname, dialect) + " ";
                    finishstring = ") AS ";
                    if (emptyBody)
                    {

                    }
                    else
                    {
                        finishstring = finishstring + areader["RDB$VIEW_SOURCE"].ToString().Trim();
                    }
                    argCount = 0;
                    arguments.Clear();
                }
                if (args == "")
                    args = args + "(";
                else
                    args = args + ",";
                argCount++;
                string argName = QuoteIdentifier(areader["RDB$FIELD_NAME"].ToString().Trim(), dialect);
                args = args + argName;
                arguments.Add(argName);
                idxrow++;
                recordfound = idxrow < tareader.Rows.Count;
                if (recordfound)
                    areader = tareader.Rows[idxrow];
            }
            if (vname.Length > 0)
            {
                if (emptyBody)
                {
                    finishstring = finishstring + " SELECT ";
                    for (int idx = 0; idx < argCount; idx++)
                    {
                        if (idx != 0)
                        {
                            finishstring = finishstring + " , ";
                        }
                        finishstring = finishstring + " NULL AS " + arguments[idx];
                    }
                    finishstring = finishstring + " FROM RDB$DATABASE ";
                }

                line = line + args + finishstring + SentenceSeparator;
                if (sbuilder != null)
                    sbuilder.AppendLine(line);
                if (table != null)
                {
                    DataRow nrow = table.NewRow();
                    nrow["NAME"] = vname;
                    nrow["SOURCE"] = NormalizeLineBreaks(line);
                    if (addtablename)
                        nrow["TABLE"] = newvname;
                    table.Rows.Add(nrow);
                }
            }
        }
        public string ExtractView(string viewname,
            DataTable table, bool emptyBody)
        {
            string sql = GetViewsSql(viewname, dialect);


            StringBuilder sbuilder = new StringBuilder();
            using (DataTable tareader = OpenQuery(sql))
            {
                ProcessViews(tareader, table, sbuilder, dialect, SentenceSeparator, emptyBody);
            }
            return sbuilder.ToString();
        }
        public string ExtractPackages(string packageName,
            DataTable table, bool headerOnly)
        {

            if (OdsVersion == 0)
            {
                if (ndbinfo == null)
                    ndbinfo = new FbDatabaseInfo(Connection);
                OdsVersion = ndbinfo.GetOdsVersion();
            }
            if (OdsVersion < 12)
                return "";
            string sql = GetPackagesSql(packageName, dialect);


            StringBuilder sbuilder = new StringBuilder();
            using (DataTable tareader = OpenQuery(sql))
            {
                ProcessPackages(tareader, table, sbuilder, dialect, SentenceSeparator, headerOnly);
            }
            return sbuilder.ToString();
        }

        public string ExtractCheck(string checkname, string tablename,
            DataTable table)
        {
            StringBuilder sbuilder = new StringBuilder();

            string sql = "SELECT RELC.RDB$RELATION_NAME,CHK.RDB$CONSTRAINT_NAME," +
                "TRG.RDB$TRIGGER_SEQUENCE,TRG.RDB$TRIGGER_SOURCE" +
                " FROM RDB$RELATION_CONSTRAINTS RELC" +
                " LEFT OUTER JOIN RDB$CHECK_CONSTRAINTS CHK" +
                " ON CHK.RDB$CONSTRAINT_NAME=RELC.RDB$CONSTRAINT_NAME" +
                " LEFT OUTER JOIN RDB$TRIGGERS TRG ON " +
                " TRG.RDB$TRIGGER_NAME = CHK.RDB$TRIGGER_NAME" +
                " WHERE  TRG.RDB$TRIGGER_TYPE = 1";


            if (checkname != "")
                sql = sql + " AND RELC.RDB$CONSTRAINT_NAME=" + QuoteStr(checkname);
            if (tablename != "")
                sql = sql + " AND RELC.RDB$RELATION_NAME=" + QuoteStr(tablename);
            sql = sql + " ORDER BY RELC.RDB$RELATION_NAME,TRG.RDB$TRIGGER_SEQUENCE";
            using (DataTable tareader = OpenQuery(sql))
            {
                DataRow areader = null;
                int idxrow = 0;
                bool recordfound = idxrow < tareader.Rows.Count;
                if (recordfound)
                    areader = tareader.Rows[idxrow];
                while (recordfound)
                {
                    string consname = areader["RDB$CONSTRAINT_NAME"].ToString().Trim();
                    string tname = areader["RDB$RELATION_NAME"].ToString().Trim();
                    string line = "ALTER TABLE " + QuoteIdentifier(tname) + " ADD ";
                    bool include = true;
                    if (consname.Length > 4)
                        if (consname.Substring(0, 5) == "INTEG")
                        {
                            include = false;
                        }
                    if (include)
                    {
                        line = line + "CONSTRAINT " + QuoteIdentifier(consname) + " ";
                    }
                    line = line + areader["RDB$TRIGGER_SOURCE"].ToString().Trim();
                    line = line + SentenceSeparator;
                    sbuilder.AppendLine(line);
                    if (table != null)
                    {
                        DataRow nrow = table.NewRow();
                        nrow["NAME"] = consname;
                        nrow["SOURCE"] = NormalizeLineBreaks(line);
                        table.Rows.Add(nrow);
                    }
                    idxrow++;
                    recordfound = idxrow < tareader.Rows.Count;
                    if (recordfound)
                        areader = tareader.Rows[idxrow];
                }
            }
            return sbuilder.ToString();
        }
        public static string GetSqlExceptions(string exceptionname, int dialect)
        {
            string sql = "SELECT G.RDB$EXCEPTION_NAME,G.RDB$MESSAGE " +
                " FROM RDB$EXCEPTIONS G " +
                " WHERE (G.RDB$SYSTEM_FLAG IS NULL OR G.RDB$SYSTEM_FLAG <> 1)";
            if (exceptionname != "")
                sql = sql + " AND G.RDB$EXCEPTION_NAME=" + QuoteStr(exceptionname);
            sql = sql + " ORDER BY G.RDB$EXCEPTION_NAME";
            return sql;
        }
        public static void ProcessExceptions(DataTable tareader, DataTable table, StringBuilder sbuilder, int dialect, string SentenceSeparator)
        {

            bool addmessage = false;
            if (table != null)
                if (table.Columns.IndexOf("NMESSAGE") >= 0)
                    addmessage = true;
            DataRow areader = null;
            int idxrow = 0;
            bool recordfound = idxrow < tareader.Rows.Count;
            if (recordfound)
                areader = tareader.Rows[idxrow];
            while (recordfound)
            {
                string exname = areader["RDB$EXCEPTION_NAME"].ToString().Trim();
                string line = "CREATE EXCEPTION " + QuoteIdentifier(exname, dialect);
                line = line + " " + QuoteStr(areader["RDB$MESSAGE"].ToString().Trim()) + SentenceSeparator;
                if (sbuilder != null)
                    sbuilder.AppendLine(line);
                if (table != null)
                {
                    DataRow nrow = table.NewRow();
                    nrow["NAME"] = exname;
                    nrow["SOURCE"] = NormalizeLineBreaks(line);
                    if (addmessage)
                        nrow["NMESSAGE"] = areader["RDB$MESSAGE"].ToString().Trim();
                    table.Rows.Add(nrow);
                }
                idxrow++;
                recordfound = idxrow < tareader.Rows.Count;
                if (recordfound)
                    areader = tareader.Rows[idxrow];
            }

        }
        public string ExtractException(string exceptionname,
            DataTable table)
        {
            StringBuilder sbuilder = new StringBuilder();

            string sql = GetSqlExceptions(exceptionname, dialect);


            using (DataTable tareader = OpenQuery(sql))
            {
                ProcessExceptions(tareader, table, sbuilder, dialect, SentenceSeparator);
            }
            return sbuilder.ToString();
        }
        internal static void GetSqlProcedures(string procname, int dialect,
            ref string sql, ref string dpendedsql, ref string sqlparams, ref string sqldim, bool includecollation, int OdsVersion)
        {
            dpendedsql = "SELECT DISTINCT RDB$DEPENDENT_NAME AS PROCNAME," +
                "RDB$DEPENDED_ON_NAME AS DEPENDE_DE " +
                " FROM RDB$DEPENDENCIES " +
                " WHERE RDB$DEPENDENT_TYPE=5 AND RDB$DEPENDED_ON_TYPE=5 " +
                " AND (NOT RDB$DEPENDENT_NAME=RDB$DEPENDED_ON_NAME) ";
            sql = "SELECT RDB$PROCEDURE_NAME,RDB$PROCEDURE_INPUTS,RDB$PROCEDURE_OUTPUTS, " +
                "  RDB$PROCEDURE_SOURCE,RDB$OWNER_NAME" +
                " FROM RDB$PROCEDURES " +
                " WHERE (RDB$SYSTEM_FLAG IS NULL OR RDB$SYSTEM_FLAG <> 1)";
            if (OdsVersion >= 12)
            {
                sql = sql + " AND RDB$PACKAGE_NAME IS NULL";
            }
            if (procname != "")
                sql = sql + " AND RDB$PROCEDURE_NAME=" + QuoteStr(procname);
            sql = sql + " ORDER BY RDB$PROCEDURE_NAME";
            sqlparams = "SELECT P.RDB$PROCEDURE_NAME AS PROCEDURE_NAME,P.RDB$PARAMETER_NAME,P.RDB$PARAMETER_TYPE AS PARAMETER_TYPE," +
                " P.RDB$PARAMETER_NUMBER," +
                "F.RDB$FIELD_TYPE AS FIELD_TYPE,F.RDB$FIELD_SUB_TYPE AS FIELD_SUB_TYPE,F.RDB$FIELD_NAME AS FIELD_NAME," +
                "F.RDB$SYSTEM_FLAG AS SYSTEM_FLAG,F.RDB$NULL_FLAG AS NULL_FLAG_DOMAIN," +
                "F.RDB$FIELD_LENGTH AS FIELD_LENGTH,F.RDB$FIELD_SCALE AS FIELD_SCALE,F.RDB$NULL_FLAG AS NULL_FLAG_DOMAIN," +
                "F.RDB$NULL_FLAG AS NULL_FLAG,F.RDB$CHARACTER_LENGTH AS CHARACTER_SIZE," +
                "F.RDB$FIELD_PRECISION AS FIELD_PRECISION," +
                "CO.RDB$COLLATION_NAME AS COLLATION_NAME," +
                "CH.RDB$CHARACTER_SET_NAME AS CHARACTER_SET_NAME," +
                "F.RDB$DEFAULT_SOURCE AS DEFAULT_SOURCE," +
                "F.RDB$VALIDATION_SOURCE AS VALIDATION_SOURCE," +
                "F.RDB$COMPUTED_SOURCE AS COMPUTED_SOURCE," +
                "F.RDB$SEGMENT_LENGTH AS SEG_LENGTH" +
                " FROM RDB$PROCEDURE_PARAMETERS P" +
                " LEFT OUTER JOIN RDB$FIELDS F" +
                " ON F.RDB$FIELD_NAME=P.RDB$FIELD_SOURCE" +
                " LEFT OUTER JOIN RDB$CHARACTER_SETS CH" +
                " ON CH.RDB$CHARACTER_SET_ID=F.RDB$CHARACTER_SET_ID" +
                " LEFT OUTER JOIN RDB$COLLATIONS CO" +
                " ON CO.RDB$COLLATION_ID=F.RDB$COLLATION_ID" +
                " AND CO.RDB$CHARACTER_SET_ID=F.RDB$CHARACTER_SET_ID" +
                " WHERE (P.RDB$SYSTEM_FLAG IS NULL OR P.RDB$SYSTEM_FLAG <> 1)";
            if (procname != "")
                sqlparams = sqlparams + " AND P.RDB$PROCEDURE_NAME=" + QuoteStr(procname);
            sqlparams = sqlparams + " ORDER BY P.RDB$PROCEDURE_NAME,P.RDB$PARAMETER_TYPE,P.RDB$PARAMETER_NUMBER";

            sqldim = "SELECT DISTINCT F.RDB$FIELD_NAME AS FIELD_NAME,D.RDB$DIMENSION,D.RDB$LOWER_BOUND,D.RDB$UPPER_BOUND" +
                " FROM RDB$PROCEDURE_PARAMETERS P" +
                " LEFT OUTER JOIN RDB$FIELDS F" +
                " ON F.RDB$FIELD_NAME=P.RDB$FIELD_SOURCE" +
                " LEFT OUTER JOIN RDB$FIELD_DIMENSIONS D" +
                " ON D.RDB$FIELD_NAME=F.RDB$FIELD_NAME" +
                " WHERE (P.RDB$SYSTEM_FLAG IS NULL OR P.RDB$SYSTEM_FLAG <> 1)" +
                " AND (NOT (D.RDB$DIMENSION IS NULL))";
            if (procname != "")
                sqldim = sqldim + " AND P.RDB$PROCEDURE_NAME=" + QuoteStr(procname);
            sqldim = sqldim + "ORDER BY F.RDB$FIELD_NAME,D.RDB$DIMENSION";
        }
        internal static void ProcessProcedures(string procname,
             DataTable tareader, DataTable deptable, DataTable tparams, DataTable tdimensions, DataTable table,
            StringBuilder sbuilder, string SentenceSeparator, int dialect, bool includecollation,
            bool includeRecursiveDependences, bool headerOnly)
        {
            foreach (DataRow xrow in deptable.Rows)
            {
                xrow["PROCNAME"] = xrow["PROCNAME"].ToString().Trim();
                xrow["DEPENDE_DE"] = xrow["DEPENDE_DE"].ToString().Trim();
            }
            foreach (DataRow xrow in tparams.Rows)
            {
                xrow["PROCEDURE_NAME"] = xrow["PROCEDURE_NAME"].ToString().Trim();
            }
            foreach (DataRow xrow in tareader.Rows)
            {
                xrow["RDB$PROCEDURE_NAME"] = xrow["RDB$PROCEDURE_NAME"].ToString().Trim();
            }
            DataView viewprocedures = null;
            DataView viewpendent = null;
            if (procname.Length == 0)
            {
                viewprocedures = new DataView(deptable, "", "PROCNAME", DataViewRowState.CurrentRows);
                viewpendent = new DataView(deptable, "", "DEPENDE_DE", DataViewRowState.CurrentRows);
            }



            SortedList<string, string> pending_procedures = new SortedList<string, string>();
            SortedList<string, string> pending_owners = new SortedList<string, string>();

            DataColumn[] keys3 = new DataColumn[3];
            keys3[0] = tparams.Columns["PROCEDURE_NAME"];
            keys3[1] = tparams.Columns["PARAMETER_TYPE"];
            keys3[2] = tparams.Columns["RDB$PARAMETER_NUMBER"];
            tparams.Constraints.Add("PRIMPARM", keys3, true);

            DataColumn[] keys = new DataColumn[2];
            keys[0] = tdimensions.Columns["FIELD_NAME"];
            keys[1] = tdimensions.Columns["RDB$DIMENSION"];
            tdimensions.Constraints.Add("PRIMDIMENSIONS", keys, true);

            short sub_type, segment, char_length, scale, precision, null_flag;
            string int_type = "";
            string validation_source, default_source, collation;
            string charset;

            DataRow areader = null;
            int idxrow = 0;
            bool recordfound = idxrow < tareader.Rows.Count;
            if (recordfound)
                areader = tareader.Rows[idxrow];
            DataView paramview2 = new DataView(tparams, "", "PROCEDURE_NAME,PARAMETER_TYPE", DataViewRowState.CurrentRows);
            object[] bparams = new object[2];

            while (recordfound)
            {
                string prname;
                prname = areader["RDB$PROCEDURE_NAME"].ToString().Trim();
                string owner_name;
                owner_name = areader["RDB$OWNER_NAME"].ToString().Trim();
                string line;
                line = "/* Procedure: " + prname + " Owner:" +
                            owner_name + " */" + System.Environment.NewLine +
                    "CREATE OR ALTER PROCEDURE " + QuoteIdentifier(prname, dialect) + System.Environment.NewLine;
                bool returnValues = false;

                // Input and output Parameters
                for (int pass = 0; pass < 2; pass++)
                {
                    bparams[0] = prname;
                    bparams[1] = pass.ToString();

                    DataRowView[] vparams = paramview2.FindRows(bparams);
                    //using (DataView paramview = new DataView(tparams, "PROCEDURE_NAME=" + QuoteStr(prname) +
                    //    " AND PARAMETER_TYPE=" + pass.ToString(), "RDB$PARAMETER_NUMBER", DataViewRowState.CurrentRows))
                    {
                        string inputparams;
                        inputparams = "";
                        foreach (DataRowView ivrow in vparams)
                        {
                            DataRow irow = ivrow.Row;
                            if (inputparams == "")
                                inputparams = "(" + System.Environment.NewLine + " ";
                            else
                                inputparams = inputparams + "," + System.Environment.NewLine + " ";
                            inputparams = inputparams + QuoteIdentifier(irow["RDB$PARAMETER_NAME"].ToString().Trim(), dialect) + " ";
                            sub_type = 0;
                            char_length = 0;
                            segment = 0;
                            scale = 0;
                            precision = 0;
                            null_flag = 0;
                            charset = "";
                            default_source = "";
                            validation_source = "";
                            collation = "";
                            string domain_name = irow["FIELD_NAME"].ToString().Trim();
                            bool null_flag_domain = false;

                            // Domain ?
                            bool isdomain = true;
                            if (domain_name.Length > 4)
                            {
                                if (domain_name.Substring(0, 4) == "RDB$")
                                    if ((domain_name[4] > '0') && (domain_name[4] <= '9'))
                                    {
                                        if (irow["SYSTEM_FLAG"] == DBNull.Value)
                                            isdomain = false;
                                        else
                                            if ((short)irow["SYSTEM_FLAG"] != 1)
                                            isdomain = false;
                                    }
                            }
                            if (null_flag == 0)
                            {
                                if (irow["NULL_FLAG"] != DBNull.Value)
                                    null_flag = (short)irow["NULL_FLAG"];
                                if (null_flag == 1)
                                {
                                    // If is a domain level null don't mark it as not null
                                    if (isdomain)
                                        if (irow["NULL_FLAG_DOMAIN"] != DBNull.Value)
                                        {
                                            if (Convert.ToInt32(irow["NULL_FLAG_DOMAIN"]) == 1)
                                            {
                                                null_flag_domain = true;
                                                null_flag = 0;
                                            }
                                        }
                                }
                            }
                            string data_type;
                            if (isdomain)
                            {
                                data_type = irow["FIELD_NAME"].ToString().Trim();
                                if (irow["NULL_FLAG_DOMAIN"] != DBNull.Value)
                                {
                                    if (Convert.ToInt32(irow["NULL_FLAG_DOMAIN"]) == 1)
                                    {
                                        null_flag_domain = true;
                                    }
                                }
                                inputparams = inputparams + data_type;
                                //if (irow["CHARACTER_SIZE"] != DBNull.Value)
                                //    char_length = (short)irow["CHARACTER_SIZE"];
                                //if (irow["CHARACTER_SET_NAME"] != DBNull.Value)
                                //{
                                //    charset = irow["CHARACTER_SET_NAME"].ToString().Trim();
                                //    inputparams = inputparams + " CHARACTER SET "
                                //}
                            }
                            else
                            {

                                if (irow["FIELD_SUB_TYPE"] != DBNull.Value)
                                    sub_type = (short)irow["FIELD_SUB_TYPE"];
                                if (irow["SEG_LENGTH"] != DBNull.Value)
                                    segment = (short)irow["SEG_LENGTH"];
                                if (irow["CHARACTER_SIZE"] != DBNull.Value)
                                    char_length = (short)irow["CHARACTER_SIZE"];
                                if (irow["FIELD_SCALE"] != DBNull.Value)
                                    scale = (short)irow["FIELD_SCALE"];
                                if (irow["FIELD_PRECISION"] != DBNull.Value)
                                    precision = (short)irow["FIELD_PRECISION"];
                                data_type = FieldTypeToSource((short)irow["FIELD_TYPE"], sub_type,
                                                    (short)irow["FIELD_LENGTH"], scale, char_length,
                                                    precision, dialect, ref int_type);
                                inputparams = inputparams + data_type;
                                if (irow["CHARACTER_SET_NAME"] != DBNull.Value)
                                    charset = irow["CHARACTER_SET_NAME"].ToString().Trim();
                                default_source = irow["DEFAULT_SOURCE"].ToString().Trim();
                                validation_source = irow["VALIDATION_SOURCE"].ToString().Trim();
                                if (irow["NULL_FLAG"] != DBNull.Value)
                                    null_flag = (short)irow["NULL_FLAG"];
                                if (irow["COLLATION_NAME"] != DBNull.Value)
                                    collation = irow["COLLATION_NAME"].ToString().Trim();
                                // Dimensions
                                string dimensions = "";
                                string field_name = irow["FIELD_NAME"].ToString().Trim();
                                object[] keyfind = new object[2];
                                keyfind[0] = field_name;
                                keyfind[1] = 0;
                                DataRow dimrow = tdimensions.Rows.Find(keys);
                                if (dimrow != null)
                                {
                                    using (DataView dimview = new DataView(tdimensions, "FIELD_NAME=" + field_name,
                                        "RDB$FIELD_DIMENSION", DataViewRowState.CurrentRows))
                                    {
                                        foreach (DataRowView dimvrow in dimview)
                                        {
                                            dimrow = dimvrow.Row;
                                            if (dimensions == "")
                                                dimensions = "[";
                                            else
                                                dimensions = ",";
                                            dimensions = dimensions + dimrow["LOWER_BOUND"].ToString() +
                                                ":" + dimrow["UPPER_BOUND"].ToString();
                                            dimensions = dimensions + ",";
                                            dimensions = dimensions + dimrow["LOWER_BOUND"].ToString() +
                                                ":" + dimrow["UPPER_BOUND"].ToString();
                                        }
                                        dimensions = dimensions + "]";
                                    }
                                }
                                if (dimensions.Length > 0)
                                    inputparams = inputparams + dimensions;
                                if (int_type == "BLOB")
                                {
                                    inputparams = inputparams + " SUB_TYPE " + sub_type.ToString();
                                    inputparams = inputparams + " SEGMENT SIZE " + segment.ToString();
                                }
                                if (charset.Length > 0)
                                    inputparams = inputparams + " CHARACTER SET " + charset;
                            }
                            if (default_source.Length > 0)
                                inputparams = inputparams + " " + default_source;
                            if (validation_source.Length > 0)
                                inputparams = inputparams + " " + validation_source;
                            if (null_flag == 1)
                                inputparams = inputparams + " NOT NULL";
                            if (includecollation)
                                if (collation.Length > 0)
                                    inputparams = inputparams + " COLLATE " + collation;

                        }
                        if (inputparams.Length > 0)
                        {
                            if (pass == 0)
                                line = line + inputparams + System.Environment.NewLine + ")" + System.Environment.NewLine;
                            if (pass == 1)
                            {
                                returnValues = true;
                                line = line + "RETURNS" + System.Environment.NewLine +
                                    inputparams + System.Environment.NewLine + ")" + System.Environment.NewLine;
                            }
                        }
                    }
                }
                string lineHeader = line + " AS BEGIN ";
                if (returnValues)
                {
                    lineHeader = lineHeader + "SUSPEND; ";
                }
                lineHeader = lineHeader + "END" + System.Environment.NewLine;
                if (headerOnly)
                {
                    if (returnValues)
                    {
                        line = line + "AS BEGIN SUSPEND; END" + System.Environment.NewLine; ;
                    }
                    else
                    {
                        line = line + "AS BEGIN END" + System.Environment.NewLine;
                    }
                }
                else
                    line = line + "AS" + System.Environment.NewLine + areader["RDB$PROCEDURE_SOURCE"].ToString().Trim() +
                    System.Environment.NewLine;
                // Check for dependences
                bool cueprocedure = false;
                if (viewprocedures != null)
                {
                    DataRowView[] nrv = viewprocedures.FindRows(prname);
                    if (nrv.Length > 0)
                        cueprocedure = true;
                    else
                    {
                        DataRowView[] nrvd = viewpendent.FindRows(prname);
                        List<DataRow> lrows = new List<DataRow>();
                        foreach (DataRowView vel in nrvd)
                        {
                            lrows.Add(vel.Row);
                        }
                        foreach (DataRow xrow in lrows)
                            viewpendent.Table.Rows.Remove(xrow);
                    }
                }
                if (cueprocedure)
                {
                    string nowner = "";
                    pending_procedures.Add(prname, line);
                    pending_owners.Add(prname, nowner);
                }
                else
                {
                    if (sbuilder != null)
                        sbuilder.AppendLine(line + SentenceSeparator);
                    if (table != null)
                    {
                        DataRow nrow = table.NewRow();
                        nrow["NAME"] = prname;
                        nrow["SOURCE"] = NormalizeLineBreaks(line);
                        nrow["SOURCE_HEADER"] = NormalizeLineBreaks(lineHeader);
                        if (nrow.Table.Columns.IndexOf("OWNER") >= 0)
                            nrow["OWNER"] = owner_name;
                        table.Rows.Add(nrow);
                    }
                }
                idxrow++;
                recordfound = idxrow < tareader.Rows.Count;
                if (recordfound)
                    areader = tareader.Rows[idxrow];
            }
            SortedList<string, string> posPendingProcedures = new SortedList<string, string>();
            while (pending_procedures.Count > 0)
                AddPendingProcedures(pending_procedures, pending_owners, sbuilder, table,
                    viewprocedures, viewpendent, pending_procedures.Keys[0], SentenceSeparator, dialect, 0, new SortedList<string, string>(), posPendingProcedures,
                    includeRecursiveDependences);
            foreach (string procName in posPendingProcedures.Keys)
            {
                string procSource = posPendingProcedures[procName];
                if (sbuilder != null)
                    sbuilder.AppendLine(procSource + SentenceSeparator);
                if (table != null)
                {
                    string owner_name = pending_owners[procName];
                    DataRow nrow = table.NewRow();
                    nrow["NAME"] = procName;
                    nrow["SOURCE"] = NormalizeLineBreaks(procSource);
                    if (nrow.Table.Columns.IndexOf("OWNER") >= 0)
                        nrow["OWNER"] = owner_name;
                    table.Rows.Add(nrow);
                }
            }
            if (viewprocedures != null)
                viewprocedures.Dispose();
        }
        public string ExtractProcedure(string procname,
            DataTable table, bool includeRecursiveDependences, bool headerOnly)
        {
            if (OdsVersion == 0)
            {
                if (ndbinfo == null)
                    ndbinfo = new FbDatabaseInfo(Connection);
                OdsVersion = ndbinfo.GetOdsVersion();
            }
            bool includecollation = OdsVersion >= 11;
            string dpendedsql = "";
            string sql = "";
            string sqlparams = "";
            string sqldim = "";

            GetSqlProcedures(procname, dialect, ref sql, ref dpendedsql, ref sqlparams, ref sqldim, includecollation, OdsVersion);


            StringBuilder sbuilder = new StringBuilder();
            DataSet data = new DataSet();
            try
            {
                using (DataTable tareader = OpenQuery(sql))
                {
                    DataTable deptable = new DataTable("DEPENDEN");
                    if (procname.Length == 0)
                    {
                        FillTable(dpendedsql, data, "DEPENDEN");
                        deptable = data.Tables["DEPENDEN"];
                    }
                    DataTable tparams = FillTable(sqlparams, data, "PARAMS");
                    DataTable tdimensions = FillTable(sqldim, data, "DIMENSIONS");

                    ProcessProcedures(procname, tareader, deptable, tparams, tdimensions, table, sbuilder, SentenceSeparator, dialect, includecollation,
                        includeRecursiveDependences, headerOnly);
                }
            }
            finally
            {
                foreach (DataTable atable in data.Tables)
                {
                    atable.Dispose();
                }
                data.Tables.Clear();
                data.Dispose();
            }
            return sbuilder.ToString();
        }

        public static void AddPendingProcedures(SortedList<string, string> pending_procedures, SortedList<string, string> pending_owners,
            StringBuilder sbuilder, DataTable table, DataView viewprocedures, DataView viewdependent, string pname, string SentenceSeparator, int dialect, int level,
            SortedList<string, string> PendingDependent, SortedList<string, string> postPendingProcedures, bool includeRecursiveDependences)
        {
            bool onlyDefinition = false;
            if (PendingDependent.IndexOfKey(pname) >= 0)
            {
                onlyDefinition = true;
            }
            if (level > 1000)
                throw new Exception("Recursive dependency level 1000 found at adding procedure: " + pname);
            DataRowView[] nrv = viewprocedures.FindRows(pname);
            if ((nrv.Length > 0) && (!onlyDefinition))
            {
                if (!postPendingProcedures.ContainsKey(pname))
                {
                    PendingDependent.Add(pname, pending_procedures[pname]);
                    AddPendingProcedures(pending_procedures, pending_owners, sbuilder,
                        table, viewprocedures, viewdependent, nrv[0]["DEPENDE_DE"].ToString(), SentenceSeparator, dialect, level + 1, PendingDependent, postPendingProcedures, includeRecursiveDependences);
                }
            }
            else
            {
                if (pending_procedures.IndexOfKey(pname) >= 0)
                {
                    if (!onlyDefinition)
                    {
                        if (sbuilder != null)
                            sbuilder.AppendLine(pending_procedures[pname] + SentenceSeparator);
                        if (table != null)
                        {
                            DataRow nrow = table.NewRow();
                            nrow["NAME"] = pname;
                            nrow["SOURCE"] = NormalizeLineBreaks(pending_procedures[pname]);
                            if (nrow.Table.Columns.IndexOf("OWNER") >= 0)
                                nrow["OWNER"] = pending_owners[pname];
                            table.Rows.Add(nrow);
                        }
                        pending_procedures.Remove(pname);
                        DataRowView[] nrvp = viewdependent.FindRows(pname);
                        List<DataRow> lrows = new List<DataRow>();
                        foreach (DataRowView vel in nrvp)
                        {
                            lrows.Add(vel.Row);
                        }
                        foreach (DataRow xrow in lrows)
                            viewdependent.Table.Rows.Remove(xrow);
                    }
                    else
                    {
                        string newsource = pending_procedures[pname];
                        string newsourceUpper = newsource.ToUpper();
                        int posbegin = newsource.ToUpper().IndexOf("BEGIN");
                        int posreturns = newsource.IndexOf("RETURNS");
                        if (posreturns > posbegin)
                            posreturns = -1;
                        newsource = newsource.Substring(0, posbegin);
                        if (posreturns >= 0)
                            newsource = newsource + " BEGIN SUSPEND; END";
                        else
                            newsource = newsource + " BEGIN END";
                        if (sbuilder != null)
                            sbuilder.AppendLine(newsource + SentenceSeparator);
                        if ((table != null) && (includeRecursiveDependences))
                        {
                            DataRow nrow = table.NewRow();
                            nrow["NAME"] = pname;
                            nrow["SOURCE"] = newsource;
                            nrow["DEFINITION"] = 1;
                            if (nrow.Table.Columns.IndexOf("OWNER") >= 0)
                                nrow["OWNER"] = pending_owners[pname];
                            table.Rows.Add(nrow);
                        }
                        postPendingProcedures.Add(pname, pending_procedures[pname]);
                        pending_procedures.Remove(pname);
                        DataRowView[] nrvp = viewdependent.FindRows(pname);
                        List<DataRow> lrows = new List<DataRow>();
                        foreach (DataRowView vel in nrvp)
                        {
                            lrows.Add(vel.Row);
                        }
                        foreach (DataRow xrow in lrows)
                            viewdependent.Table.Rows.Remove(xrow);
                    }
                }
            }
        }
        public static string GetTriggersSql(string triggername, string tablename, int dialect, bool global)
        {
            string sql = "SELECT T.RDB$RELATION_NAME,T.RDB$TRIGGER_NAME,T.RDB$TRIGGER_SOURCE, " +
              " T.RDB$TRIGGER_TYPE,T.RDB$TRIGGER_SEQUENCE,T.RDB$TRIGGER_INACTIVE ";
            sql = sql +
             " FROM RDB$TRIGGERS T " +
             " LEFT OUTER JOIN RDB$CHECK_CONSTRAINTS CHK ON T.RDB$TRIGGER_NAME = CHK.RDB$TRIGGER_NAME " +
             " WHERE (CHK.RDB$TRIGGER_NAME IS NULL) AND " +
             " (T.RDB$SYSTEM_FLAG IS NULL OR T.RDB$SYSTEM_FLAG <> 1) AND (T.RDB$FLAGS=1)";
            if (triggername != "")
                sql = sql + " AND T.RDB$TRIGGER_NAME=" + QuoteStr(triggername);
            if (global)
                sql = sql + " AND T.RDB$RELATION_NAME IS NULL";
            else
             if (tablename != "")
                sql = sql + " AND T.RDB$RELATION_NAME=" + QuoteStr(tablename);
            sql = sql + " ORDER BY T.RDB$RELATION_NAME,T.RDB$TRIGGER_TYPE,T.RDB$TRIGGER_SEQUENCE";
            return sql;
        }
        static string NormalizeLineBreaks(string input)
        {
            // Allow 10% as a rough guess of how much the string may grow.
            // If we're wrong we'll either waste space or have extra copies -
            // it will still work
            StringBuilder builder = new StringBuilder((int)(input.Length * 1.1));

            bool lastWasCR = false;

            foreach (char c in input)
            {
                if (lastWasCR)
                {
                    lastWasCR = false;
                    if (c == '\n')
                    {
                        continue; // Already written \r\n
                    }
                }
                switch (c)
                {
                    case '\r':
                        builder.Append("\r\n");
                        lastWasCR = true;
                        break;
                    case '\n':
                        builder.Append("\r\n");
                        break;
                    default:
                        builder.Append(c);
                        break;
                }
            }
            return builder.ToString();
        }

        public static void ProcessTriggers(DataTable tareader, DataTable table, StringBuilder sbuilder, int dialect, string SentenceSeparator)
        {
            DataRow areader = null;
            int idxrow = 0;
            bool recordfound = idxrow < tareader.Rows.Count;
            if (recordfound)
                areader = tareader.Rows[idxrow];
            bool addtablename = false;
            if (table != null)
                if (table.Columns.IndexOf("TABLE") >= 0)
                    addtablename = true;
            bool addsource = false;
            if (table != null)
                if (table.Columns.IndexOf("SOURCE") >= 0)
                    addsource = true;

            while (recordfound)
            {
                string trigname = areader["RDB$TRIGGER_NAME"].ToString().Trim();
                string line = "CREATE OR ALTER TRIGGER " + QuoteIdentifier(trigname, dialect);
                string relname = areader["RDB$RELATION_NAME"].ToString().Trim();
                int trigtype = Convert.ToInt32(areader["RDB$TRIGGER_TYPE"]);
                if (trigtype < 8190)
                    line = line + " FOR " + QuoteIdentifier(relname, dialect);
                string inactive = "INACTIVE";
                if (areader["RDB$TRIGGER_INACTIVE"] != DBNull.Value)
                {
                    if (0 == Convert.ToInt32(areader["RDB$TRIGGER_INACTIVE"]))
                    {
                        inactive = "ACTIVE";
                    }
                }
                string trigstring = "";
                switch (trigtype)
                {
                    case 1:
                        trigstring = "BEFORE INSERT";
                        break;
                    case 2:
                        trigstring = "AFTER INSERT";
                        break;
                    case 3:
                        trigstring = "BEFORE UPDATE";
                        break;
                    case 4:
                        trigstring = "AFTER UPDATE";
                        break;
                    case 5:
                        trigstring = "BEFORE DELETE";
                        break;
                    case 6:
                        trigstring = "AFTER DELETE";
                        break;
                    case 17:
                        trigstring = "BEFORE INSERT OR UPDATE";
                        break;
                    case 18:
                        trigstring = "AFTER INSERT OR UPDATE";
                        break;
                    case 25:
                        trigstring = "BEFORE INSERT OR DELETE";
                        break;
                    case 26:
                        trigstring = "AFTER INSERT OR DELETE";
                        break;
                    case 27:
                        trigstring = "BEFORE UPDATE OR DELETE";
                        break;
                    case 28:
                        trigstring = "AFTER UPDATE OR DELETE";
                        break;
                    case 113:
                        trigstring = "BEFORE INSERT OR UPDATE OR DELETE";
                        break;
                    case 114:
                        trigstring = "AFTER INSERT OR UPDATE OR DELETE";
                        break;
                    case 8192:
                        trigstring = "ON CONNECT";
                        break;
                    case 8193:
                        trigstring = "ON DISCONNECT";
                        break;
                    case 8194:
                        trigstring = "ON TRANSACTION START";
                        break;
                    case 8195:
                        trigstring = "ON TRANSACTION COMMIT";
                        break;
                    case 8196:
                        trigstring = "ON TRANSACTION ROLLBACK";
                        break;
                }
                line = line + " " + inactive + " " + trigstring + " POSITION " + areader["RDB$TRIGGER_SEQUENCE"].ToString().Trim() +
                  System.Environment.NewLine;
                line = line + areader["RDB$TRIGGER_SOURCE"].ToString().Trim();
                if (sbuilder != null)
                    sbuilder.AppendLine(line + SentenceSeparator);
                if (table != null)
                {
                    DataRow nrow = table.NewRow();
                    nrow["NAME"] = trigname;
                    if (nrow.Table.Columns.IndexOf("TRIGGER_ACTIVE") >= 0)
                    {
                        nrow["TRIGGER_INACTIVE"] = (int)(short)areader["RDB$TRIGGER_INACTIVE"];
                        nrow["TRIGGER_ACTIVE"] = ((short)areader["RDB$TRIGGER_INACTIVE"] == 0);
                        nrow["TRIGGER_TYPE"] = trigtype;
                        nrow["ACTION"] = trigstring;
                        nrow["FULL_SOURCE"] = NormalizeLineBreaks(line);
                        nrow["TRIGGER_SOURCE"] = NormalizeLineBreaks(areader["RDB$TRIGGER_SOURCE"].ToString().Trim());
                        nrow["TRIGGER_SEQUENCE"] = System.Convert.ToInt32(areader["RDB$TRIGGER_SEQUENCE"]);
                    }
                    if (addtablename)
                    {
                        nrow["TABLE"] = relname;
                    }
                    if (addsource)
                        nrow["SOURCE"] = NormalizeLineBreaks(line);

                    table.Rows.Add(nrow);
                }
                idxrow++;
                recordfound = idxrow < tareader.Rows.Count;
                if (recordfound)
                    areader = tareader.Rows[idxrow];
            }
        }

        public string ExtractTrigger(string triggername, string tablename,
            DataTable table, bool global)
        {
            StringBuilder sbuilder = new StringBuilder();
            string sql = GetTriggersSql(triggername, tablename, dialect, global);

            using (DataTable tareader = OpenQuery(sql))
            {
                ProcessTriggers(tareader, table, sbuilder, dialect, SentenceSeparator);
            }
            return sbuilder.ToString();
        }
        public string ExtractRoles(string rolename,
            DataTable table)
        {
            StringBuilder sbuilder = new StringBuilder();

            string nsql = "SELECT RDB$FIELD_NAME FROM RDB$RELATION_FIELDS " +
                " WHERE RDB$RELATION_NAME='RDB$ROLES' AND RDB$FIELD_NAME='RDB$SYSTEM_FLAG'";
            bool hassystemflag = false;
            using (DataTable tareader2 = OpenQuery(nsql))
            {
                if (tareader2.Rows.Count > 0)
                    hassystemflag = true;
            }
            string sql = "SELECT R.RDB$ROLE_NAME,R.RDB$OWNER_NAME " +
                " FROM RDB$ROLES R  ";
            if (hassystemflag)
                sql = sql + " WHERE (R.RDB$SYSTEM_FLAG IS NULL OR  R.RDB$SYSTEM_FLAG=0) ";
            if (rolename != "")
                sql = sql + " AND R.RDB$ROLE_NAME=" + QuoteStr(rolename);
            sql = sql + " ORDER BY R.RDB$ROLE_NAME";
            using (DataTable tareader = OpenQuery(sql))
            {
                DataRow areader = null;
                int idxrow = 0;
                bool recordfound = idxrow < tareader.Rows.Count;
                if (recordfound)
                    areader = tareader.Rows[idxrow];
                while (recordfound)
                {
                    string rolname = areader["RDB$ROLE_NAME"].ToString().Trim();
                    string line = "/* Role: " + rolname + " Owner:" + areader["RDB$OWNER_NAME"].ToString().Trim() + " */" +
                        System.Environment.NewLine + "CREATE ROLE " + QuoteIdentifier(rolname) + SentenceSeparator;
                    sbuilder.AppendLine(line);
                    if (table != null)
                    {
                        DataRow nrow = table.NewRow();
                        nrow["NAME"] = rolname;
                        nrow["SOURCE"] = line;
                        table.Rows.Add(nrow);
                    }
                    idxrow++;
                    recordfound = idxrow < tareader.Rows.Count;
                    if (recordfound)
                        areader = tareader.Rows[idxrow];
                }
            }
            return sbuilder.ToString();
        }
        /// <summary>
        /// Extract roles allowed for selected user, or users allowed in a role, or also all items
        /// </summary>
        /// <param name="rolename"></param>
        /// <param name="username"></param>
        /// <param name="table"></param>
        /// <returns></returns>
        public string ExtractRolesUser(string rolename, string username,
            DataTable table)
        {
            StringBuilder sbuilder = new StringBuilder();

            string sql = "SELECT R.RDB$USER,R.RDB$RELATION_NAME,R.RDB$GRANT_OPTION " +
                " FROM RDB$USER_PRIVILEGES R WHERE R.RDB$OBJECT_TYPE=13 AND R.RDB$USER_TYPE=8 ";
            if (rolename != "")
                sql = sql + " AND R.RDB$RELATION_NAME=" + QuoteStr(rolename);
            if (username != "")
                sql = sql + " AND R.RDB$USER=" + QuoteStr(username);
            sql = sql + " ORDER BY R.RDB$USER,R.RDB$RELATION_NAME";
            using (DataTable tareader = OpenQuery(sql))
            {
                DataRow areader = null;
                int idxrow = 0;
                bool recordfound = idxrow < tareader.Rows.Count;
                if (recordfound)
                    areader = tareader.Rows[idxrow];
                while (recordfound)
                {
                    string rolname = areader["RDB$RELATION_NAME"].ToString().Trim();
                    string usname = areader["RDB$USER"].ToString().Trim();
                    string line = "GRANT " + QuoteIdentifier(rolname) + " TO " + QuoteIdentifier(usname);
                    if (areader["RDB$GRANT_OPTION"] != DBNull.Value)
                    {
                        if (1 == (short)areader["RDB$GRANT_OPTION"])
                            line = line + " WITH ADMIN OPTION";
                    }
                    line = line + SentenceSeparator;
                    sbuilder.AppendLine(line);
                    if (table != null)
                    {
                        DataRow nrow = table.NewRow();
                        nrow["NAME"] = usname.ToString() + "____" + rolename.ToString();
                        nrow["SOURCE"] = line;
                        table.Rows.Add(nrow);
                    }
                    idxrow++;
                    recordfound = idxrow < tareader.Rows.Count;
                    if (recordfound)
                        areader = tareader.Rows[idxrow];
                }
            }
            return sbuilder.ToString();
        }
        private static string PrivilegeShortToPrivilege(string nvalue)
        {
            string nresult = "";
            switch (nvalue)
            {
                case "I":
                    nresult = "INSERT";
                    break;
                case "U":
                    nresult = "UPDATE";
                    break;
                case "D":
                    nresult = "DELETE";
                    break;
                case "S":
                    nresult = "SELECT";
                    break;
                case "R":
                    nresult = "REFERENCES";
                    break;
                case "X":
                    nresult = "EXECUTE";
                    break;
                default:
                    nresult = "SELECT";
                    break;
            }
            return nresult;
        }
        private static string CommaSeparatedFromList(List<string> nlist)
        {
            StringBuilder sbu = new StringBuilder();
            foreach (string s in nlist)
            {
                if (sbu.Length == 0)
                    sbu.Append(s);
                else
                    sbu.Append("," + s);
            }
            return sbu.ToString();
        }
        private void BuildGrant(StringBuilder sbuilder, string usname, string relname, string fieldname, bool goption, List<string> lprivileges, int obj_type, string user_type, DataTable table)
        {
            string privileges = FbExtract.CommaSeparatedFromList(lprivileges);
            string grantoption = "";
            if (goption)
            {
                grantoption = " WITH GRANT OPTION";
            }

            string line = "GRANT " + privileges;
            if (fieldname.Length > 0)
                line = line + " " + fieldname;
            line = line + " ON ";
            if (obj_type == 5)
                line = line + "PROCEDURE ";
            line = line + QuoteIdentifier(relname) +
                                   " TO " + user_type + " " + QuoteIdentifier(usname) + grantoption + SentenceSeparator;
            sbuilder.AppendLine(line);
            if (table != null)
            {
                DataRow nrow = table.NewRow();
                if (nrow.Table.Columns.IndexOf("USER_TYPE") >= 0)
                    nrow["USER_TYPE"] = user_type;
                if (nrow.Table.Columns.IndexOf("USER") >= 0)
                    nrow["USER"] = usname.ToString();
                if (nrow.Table.Columns.IndexOf("RELATION_NAME") >= 0)
                    nrow["RELATION_NAME"] = relname.ToString();
                if (nrow.Table.Columns.IndexOf("FIELD_NAME") >= 0)
                    nrow["FIELD_NAME"] = fieldname.ToString();
                if (nrow.Table.Columns.IndexOf("OBJECT_TYPE") >= 0)
                    nrow["OBJECT_TYPE"] = relname.ToString();
                if (nrow.Table.Columns.IndexOf("PRIVILEGES") >= 0)
                    nrow["PRIVILEGES"] = privileges;
                if (nrow.Table.Columns.IndexOf("NAME") >= 0)
                    nrow["NAME"] = usname + "_" + relname + "_" + fieldname + "_" + privileges;
                nrow["SOURCE"] = line;
                table.Rows.Add(nrow);
            }
        }
        /// <summary>
        /// Extract grants for tables and stored procedures procedures, filter can be applied to 
        /// table or procedure name (objectname) or by user.
        /// </summary>
        /// <param name="username"></param>
        /// <param name="objectname"></param>
        /// <param name="table"></param>
        /// <returns></returns>
        public string ExtractGrant(string username, string objectname,
            DataTable table)
        {
            StringBuilder sbuilder = new StringBuilder();

            string sql = "SELECT R.RDB$USER,R.RDB$RELATION_NAME,R.RDB$FIELD_NAME,R.RDB$GRANT_OPTION, " +
                " PROC.RDB$PROCEDURE_NAME,PROC.RDB$OWNER_NAME AS PROC_OWNER,RELC.RDB$OWNER_NAME AS REL_OWNER," +
                " R.RDB$PRIVILEGE,R.RDB$OBJECT_TYPE AS OBJ_TYPE,R.RDB$USER_TYPE AS USER_TYPE " +
                " FROM RDB$USER_PRIVILEGES R" +
                " LEFT OUTER JOIN RDB$RELATIONS RELC" +
                " ON RELC.RDB$RELATION_NAME=R.RDB$RELATION_NAME " +
                " LEFT OUTER JOIN RDB$PROCEDURES PROC" +
                " ON PROC.RDB$PROCEDURE_NAME=R.RDB$RELATION_NAME " +
                " WHERE (NOT R.RDB$PRIVILEGE='M') AND (R.RDB$FIELD_NAME IS NULL) " +
                " AND (" +
                " ((NOT R.RDB$RELATION_NAME IS NULL) AND (NOT RELC.RDB$OWNER_NAME=R.RDB$USER) AND (RELC.RDB$SYSTEM_FLAG=0 OR RELC.RDB$SYSTEM_FLAG IS NULL))" +
                " OR " +
                " ((NOT PROC.RDB$PROCEDURE_NAME IS NULL) AND (NOT PROC.RDB$OWNER_NAME=R.RDB$USER) AND (PROC.RDB$SYSTEM_FLAG=0 OR PROC.RDB$SYSTEM_FLAG IS NULL))" +
                ")";
            if (objectname != "")
                sql = sql + " AND R.RDB$RELATION_NAME=" + QuoteStr(objectname);
            if (username != "")
                sql = sql + " AND R.RDB$USER=" + QuoteStr(username);
            sql = sql + " ORDER BY R.RDB$USER,R.RDB$RELATION_NAME,R.RDB$FIELD_NAME,R.RDB$PRIVILEGE,R.RDB$GRANT_OPTION";
            List<string> lprivileges = new List<string>();
            // Execute a statement apart for options with columns option
            using (DataTable tareader = OpenQuery(sql))
            {
                DataRow areader = null;
                int idxrow = 0;
                bool recordfound = idxrow < tareader.Rows.Count;
                if (recordfound)
                    areader = tareader.Rows[idxrow];
                string oldrelname = "";
                string oldusname = "";
                string oldfieldname = "";
                bool oldgoption = false;
                string oldprivilege = "";
                string olduser_type = "";
                bool first = true;
                int oldobj_type = 0;

                while (recordfound)
                {
                    string relname = areader["RDB$RELATION_NAME"].ToString().Trim();
                    string usname = areader["RDB$USER"].ToString().Trim();
                    string fieldname = areader["RDB$FIELD_NAME"].ToString().Trim();
                    string privilege = areader["RDB$PRIVILEGE"].ToString().Trim();
                    bool goption = false;
                    int obj_type = 0;
                    string user_type = "";
                    if (areader["RDB$GRANT_OPTION"] != DBNull.Value)
                    {
                        if (1 == (short)areader["RDB$GRANT_OPTION"])
                        {
                            goption = true;
                        }
                    }
                    if (areader["USER_TYPE"] != DBNull.Value)
                    {
                        switch (System.Convert.ToInt32(areader["USER_TYPE"]))
                        {
                            case 1:
                                user_type = "VIEW";
                                break;
                            case 2:
                                user_type = "TRIGGER";
                                break;
                            case 3:
                                user_type = "PROCEDURE";
                                break;
                        }
                    }
                    if (areader["OBJ_TYPE"] != DBNull.Value)
                        obj_type = System.Convert.ToInt32(areader["OBJ_TYPE"]);
                    if (first)
                    {
                        oldrelname = relname;
                        oldusname = usname;
                        oldfieldname = fieldname;
                        oldgoption = goption;
                        oldprivilege = privilege;
                        oldobj_type = obj_type;
                        olduser_type = user_type;
                        lprivileges.Add(FbExtract.PrivilegeShortToPrivilege(privilege));
                    }
                    if ((oldrelname != relname) || (oldusname != usname) || (oldfieldname != fieldname)
                         || (oldgoption != goption))
                    {
                        BuildGrant(sbuilder, oldusname, oldrelname, oldfieldname, oldgoption, lprivileges, oldobj_type, olduser_type, table);
                        lprivileges.Clear();
                        oldrelname = relname;
                        oldusname = usname;
                        oldfieldname = fieldname;
                        oldgoption = goption;
                        first = false;
                        oldprivilege = privilege;
                        oldobj_type = obj_type;
                        olduser_type = user_type;
                        lprivileges.Add(FbExtract.PrivilegeShortToPrivilege(privilege));
                    }
                    else
                    {
                        if (!first)
                            lprivileges.Add(FbExtract.PrivilegeShortToPrivilege(privilege));
                    }
                    first = false;
                    idxrow++;
                    recordfound = idxrow < tareader.Rows.Count;
                    if (recordfound)
                        areader = tareader.Rows[idxrow];
                }
                if (!first)
                    BuildGrant(sbuilder, oldusname, oldrelname, oldfieldname, oldgoption, lprivileges, oldobj_type, olduser_type, table);
            }

            return sbuilder.ToString();
        }

        public string ExtractDatabase()
        {
            StringBuilder sbuilder = new StringBuilder();
            sbuilder.AppendLine(ExtractCreateDatabase());
            string oldsep = SentenceSeparator;
            try
            {
                sbuilder.AppendLine("SET SQL DIALECT " + dialect.ToString() + SentenceSeparator);
                sbuilder.AppendLine("");
                sbuilder.AppendLine(ExtractFilter("", null));
                sbuilder.AppendLine("");
                sbuilder.AppendLine(ExtractDomain("", "", null));
                sbuilder.AppendLine("");
                sbuilder.AppendLine(ExtractFunction("", null, true, ExtractFunctionType.Udfs));
                sbuilder.AppendLine("SET TERM " + AlternativeSentenceSeparator + SentenceSeparator);
                SentenceSeparator = AlternativeSentenceSeparator;
                sbuilder.AppendLine("");
                sbuilder.AppendLine(ExtractFunction("", null, true, ExtractFunctionType.Functions));

                sbuilder.AppendLine("");
                sbuilder.AppendLine(ExtractPackages("", null, true));
                sbuilder.AppendLine("");
                sbuilder.AppendLine(ExtractView("", null, true));
                sbuilder.AppendLine(ExtractProcedure("", null, true, true));
                sbuilder.AppendLine("SET TERM " + oldsep + SentenceSeparator);
                SentenceSeparator = oldsep;

                // Extract all tables
                sbuilder.AppendLine("");
                sbuilder.AppendLine(ExtractTable("", null, false, true, null));
                sbuilder.AppendLine(ExtractIndex("", "", null));
                sbuilder.AppendLine("");
                sbuilder.AppendLine(ExtractForeign("", "", null));
                sbuilder.AppendLine("");
                sbuilder.AppendLine(ExtractGenerator("", null));
                sbuilder.AppendLine("");
                sbuilder.AppendLine(ExtractView("", null, false));
                sbuilder.AppendLine("");
                sbuilder.AppendLine(ExtractException("", null));
                sbuilder.AppendLine("");
                sbuilder.AppendLine("SET TERM " + AlternativeSentenceSeparator + SentenceSeparator);
                SentenceSeparator = AlternativeSentenceSeparator;
                sbuilder.AppendLine(ExtractFunction("", null, false, ExtractFunctionType.Functions));
                sbuilder.AppendLine("");
                sbuilder.AppendLine(ExtractPackages("", null, false));
                sbuilder.AppendLine("");
                sbuilder.AppendLine(ExtractProcedure("", null, true, false));
                sbuilder.AppendLine("");
                sbuilder.AppendLine(ExtractTrigger("", "", null, false));
                sbuilder.AppendLine("");
                SentenceSeparator = oldsep;
                sbuilder.AppendLine("SET TERM " + oldsep + AlternativeSentenceSeparator);
                sbuilder.AppendLine(ExtractCheck("", "", null));
                sbuilder.AppendLine("");
                sbuilder.AppendLine(ExtractRoles("", null));
                sbuilder.AppendLine(ExtractRolesUser("", "", null));
                sbuilder.AppendLine(ExtractGrant("", "", null));
            }
            finally
            {
                SentenceSeparator = oldsep;
            }
            return sbuilder.ToString();
        }
    }
}
