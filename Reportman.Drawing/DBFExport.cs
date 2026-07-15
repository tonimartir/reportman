using System;
using System.Data;
using System.Data.Common;
using System.IO;
using System.Text;

namespace Reportman.Reporting
{
    /// <summary>
    /// Progress callback invoked periodically during a long export, reporting the number of
    /// records processed out of the total; set <c>docancel</c> to true to abort the operation.
    /// </summary>
    public delegate void DataProgressEvent(object sender, int records, int count, ref bool docancel);
    /// <summary>
    /// Exports a <see cref="DataTable"/> to a dBASE IV (.DBF) file via an OLE DB connection,
    /// creating the table and inserting rows while reporting progress and supporting cancellation.
    /// </summary>
    public class DBFExport
    {
        /// <summary>
        /// Instantiates and configures a dBASE IV OLE DB Connection pointing to the specified folder context.
        /// </summary>
        /// <param name="folder">The folder containing dBASE files.</param>
        /// <returns>A DbConnection instance configured for dBASE IV.</returns>
        public static DbConnection CreateConnection(string folder)
        {
            DbProviderFactory nfac = DbProviderFactories.GetFactory("System.Data.OleDb");
            if (nfac == null)
            {
                throw new Exception("Oledb provider factory not found:OleDb Data Provider");
            }
            DbConnection connection = nfac.CreateConnection();
            //   connection.ConnectionString = "Provider=Microsoft.Jet.OLEDB.4.0; Data Source=" + folder + " ;Extended Properties=dBASE IV;User ID=Admin;Locale Identifier=3082;Password=";
            connection.ConnectionString = "Provider=Microsoft.ACE.OLEDB.12.0; Data Source=" + folder +
                  ";Extended Properties=dBASE IV;User ID=Admin;Password=";

            return connection;
        }
        /// <summary>
        /// Maps a System Type representation to its matching database DbType for OLE DB parameters.
        /// </summary>
        /// <param name="valor">The system type to map.</param>
        /// <param name="level">Level threshold defining date precision.</param>
        /// <returns>The matching DbType.</returns>
        public static DbType TypeToDBFDbType(Type valor, int level)
        {
            DbType aresult = DbType.AnsiString;
            switch (valor.ToString())
            {
                case "System.String":
                    aresult = DbType.AnsiString;
                    break;
                case "System.Int16":
                    aresult = DbType.Int16;
                    break;
                case "System.Int32":
                    aresult = DbType.Int32;
                    break;
                case "System.DateTime":
                    if (level <= 4)
                        aresult = DbType.Date;
                    else
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
                case "System.Byte[]":
                    aresult = DbType.Binary;
                    break;
                default:
                    throw new Exception("Unsupported type:" + valor.ToString());
            }
            return aresult;
        }
        /// <summary>
        /// Exports a DataTable to a dBASE IV file using default date mapping levels.
        /// </summary>
        /// <param name="ntable">The source DataTable.</param>
        /// <param name="filename">The target output file path.</param>
        /// <param name="connection">The dBASE database connection.</param>
        public static void SaveToFile(DataTable ntable, string filename, DbConnection connection)
        {
            SaveToFile(ntable, filename, connection, 4);
        }
        /// <summary>
        /// Exports a DataTable to a dBASE IV file with a custom date mapping level.
        /// </summary>
        /// <param name="ntable">The source DataTable.</param>
        /// <param name="filename">The target output file path.</param>
        /// <param name="connection">The dBASE database connection.</param>
        /// <param name="level">Level threshold defining date precision.</param>
        public static void SaveToFile(DataTable ntable, string filename, DbConnection connection, int level)
        {
            SaveToFile(ntable, filename, connection, level, null);
        }
        /// <summary>
        /// Exports a DataTable to a dBASE IV file with a progress callback.
        /// </summary>
        /// <param name="ntable">The source DataTable.</param>
        /// <param name="filename">The target output file path.</param>
        /// <param name="connection">The dBASE database connection.</param>
        /// <param name="level">Level threshold defining date precision.</param>
        /// <param name="eventprogress">The progress tracking callback delegate.</param>
        public static void SaveToFile(DataTable ntable, string filename, DbConnection connection, int level, DataProgressEvent eventprogress)
        {
            foreach (DataColumn ncol in ntable.Columns)
            {
                if (ncol.ColumnName.Length > 15)
                {
                    throw new Exception("Column name exceeding 15 characters, rename the column before exporting: Column name=" + ncol.ColumnName);
                }
            }
            DbProviderFactory nfac = DbProviderFactories.GetFactory("System.Data.OleDb");
            StringBuilder nbuilder = new StringBuilder();
            if (!File.Exists(filename + ".DBF"))
            {
                File.Delete(filename);
                filename = Path.GetFileName(filename);


                nbuilder.Append("CREATE TABLE ");
                nbuilder.Append(filename);
                nbuilder.Append(" (");
                for (int i = 0; i < ntable.Columns.Count; i++)
                {
                    DataColumn ncol = ntable.Columns[i];
                    if (i > 0)
                        nbuilder.Append(",");
                    nbuilder.Append(ncol.ColumnName);
                    nbuilder.Append(" ");
                    nbuilder.Append(TypeToDBFSqlType(ncol.DataType, ncol.MaxLength));

                }
                nbuilder.Append(")");

            }
            using (DbCommand ncommand = connection.CreateCommand())
            {
                if (!File.Exists(filename + ".DBF"))
                {
                    ncommand.CommandText = nbuilder.ToString();
                    ncommand.ExecuteNonQuery();
                }
                nbuilder = new StringBuilder();
                StringBuilder nfields = new StringBuilder(" (");
                StringBuilder nvalues = new StringBuilder(" (");
                nbuilder.Append("INSERT INTO ");
                string[] nfilename = filename.Split('\\');

                nbuilder.Append(nfilename[nfilename.Length - 1]);
                for (int i = 0; i < ntable.Columns.Count; i++)
                {
                    if (i > 0)
                    {
                        nfields.Append(",");
                        nvalues.Append(",");
                    }
                    DataColumn ncol = ntable.Columns[i];
                    nfields.Append(ncol.ColumnName);
                    nvalues.Append("@");
                    nvalues.Append(ncol.ColumnName);

                    DbParameter nparam = nfac.CreateParameter();
                    nparam.ParameterName = "@" + ncol.ColumnName;
                    nparam.DbType = TypeToDBFDbType(ncol.DataType, 4);
                    ncommand.Parameters.Add(nparam);
                }
                nfields.Append(")");
                nvalues.Append(")");
                ncommand.CommandText = nbuilder.ToString() + nfields.ToString() + " VALUES " + nvalues.ToString();
                DateTime mmfirst = DateTime.Now;
                int ncount = 0;
                bool docancel = false;
                using (DataView nview = new DataView(ntable, "", "", DataViewRowState.CurrentRows))
                {
                    foreach (DataRowView xrv in nview)
                    {
                        DataRow xrow = xrv.Row;
                        for (int i = 0; i < ntable.Columns.Count; i++)
                        {
                            ncommand.Parameters[i].Value = xrow[i];
                        }
                        ncommand.ExecuteNonQuery();
                        ncount++;
                        if ((ncount % 10) == 0)
                        {
                            DateTime mmlast = DateTime.Now;
                            if ((mmlast - mmfirst).TotalMilliseconds > 500)
                            {
                                if (eventprogress != null)
                                {
                                    eventprogress(null, ncount, ntable.Rows.Count, ref docancel);
                                    if (docancel)
                                        throw new Exception("Operation cancelled");
                                }
                                mmfirst = DateTime.Now;
                            }
                        }
                    }
                }
            }
        }
        /// <summary>
        /// Resolves the raw SQL column type definitions (e.g. CHAR, NUMERIC) matching a Type.
        /// </summary>
        /// <param name="ntype">The system type.</param>
        /// <param name="length">Length threshold for string representation columns.</param>
        /// <returns>The SQL database type string representation.</returns>
        public static string TypeToDBFSqlType(Type ntype, int length)
        {
            string nresult = "";
            if (length <= 0)
                length = 100;
            switch (ntype.ToString())
            {
                case "System.Char":
                    nresult = "CHAR(1)";
                    break;
                case "System.String":
                    nresult = "CHAR(" + length + ")";
                    break;
                case "System.Decimal":
                    nresult = "NUMERIC(18,4)";
                    break;
                case "System.Double":
                case "System.Float":
                case "System.Single":
                    nresult = "DOUBLE PRECISION";
                    break;
                case "System.Int32":
                case "System.Int16":
                case "System.Byte":
                    nresult = "SmallInt";
                    nresult = "NUMERIC(3,0)";
                    //nresult = "INTEGER";
                    break;
                case "System.DateTime":
                    nresult = "TIMESTAMP";
                    break;
                default:
                    throw new Exception("Type not supported in DBFExport:" + ntype.ToString());
            }
            return nresult;
        }
        /// <summary>
        /// Exports a DataTable to a dBASE IV file, automatically managing connection lifecycle and reporting progress.
        /// </summary>
        /// <param name="ntable">The source DataTable.</param>
        /// <param name="filename">The target output file path.</param>
        /// <param name="eventprogress">The progress tracking callback delegate.</param>
        public static void SaveToFile(DataTable ntable, string filename, DataProgressEvent eventprogress)
        {
            string folder = Path.GetDirectoryName(filename);
            DbConnection connection = CreateConnection(folder);
            connection.Open();
            try
            {
                SaveToFile(ntable, filename, connection, 4, eventprogress);
            }
            finally
            {
                connection.Close();
            }

        }
    }
}
