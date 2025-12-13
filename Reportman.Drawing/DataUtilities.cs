using System;
using System.Collections.Generic;
using System.Data;
using System.Data.Common;
using System.Linq;
using System.Text;

namespace Reportman.Drawing
{
    /// <summary>
    /// DataTable and DataSet utilities
    /// </summary>
    public static class DataUtilities
    {
        static Dictionary<Type, DbType> typeMap = new Dictionary<Type, DbType>();
        /// <summary>
        /// Copy a DataTable, the standard Copy() command does not work for byte[] columns
        /// </summary>
        /// <param name="ntable"></param>
        /// <returns></returns>
        public static DataTable Copy(DataTable ntable)
        {
            DataTable newtable = ntable.Clone();

            int colcount = newtable.Columns.Count;
            object[] values = new object[colcount];
            foreach (DataRow xrow in ntable.Rows)
            {
                for (int i = 0; i < colcount; i++)
                    values[i] = xrow[i];
                newtable.Rows.Add(values);
            }
            return newtable;
        }
        /// <summary>
        /// Lee de forma asincrona desde un dbcommand
        /// </summary>
        public async static System.Threading.Tasks.Task<DataTable> FillAsync(DbCommand ncommand, string tableName, int from, int to)
        {
            System.Data.DataTable intdatatable = new DataTable(tableName);
            IDataReader nreader;
            int currentRecord = 0;
            if (to == -1)
            {
                to = int.MaxValue;
            }
            nreader = await ncommand.ExecuteReaderAsync().ConfigureAwait(false);
            try
            {
                try
                {
                    SortedList<string, int> RepeatedColumns = new SortedList<string, int>();
                    int nfieldcount = nreader.FieldCount;
                    object[] nobjarray = new object[nfieldcount];
                    for (int i = 0; i < nfieldcount; i++)
                    {
                        Type ntype = nreader.GetFieldType(i);
                        string colName = nreader.GetName(i);
                        if (intdatatable.Columns.IndexOf(colName) >= 0)
                        {
                            if (!RepeatedColumns.ContainsKey(colName))
                            {
                                RepeatedColumns.Add(colName, 1);
                            }
                            else
                            {
                                RepeatedColumns[colName] = RepeatedColumns[colName] + 1;
                            }
                            int index = RepeatedColumns[colName];
                            colName = colName + index.ToString();
                        }
                        intdatatable.Columns.Add(colName, ntype);
                    }
                    bool readedRecords;
                    bool doAsync = false;
                    if (nreader is DbDataReader)
                    {
                        readedRecords = await ((DbDataReader)nreader).ReadAsync().ConfigureAwait(false);
                        doAsync = true;
                    }
                    else
                    {
                        readedRecords = nreader.Read();
                    }
                    while (readedRecords)
                    {
                        currentRecord++;
                        if (currentRecord > to)
                        {
                            break;
                        }
                        if (currentRecord >= from)
                        {
                            for (int i = 0; i < nfieldcount; i++)
                            {
                                nobjarray[i] = nreader[i];
                            }
                            intdatatable.Rows.Add(nobjarray);
                            if (doAsync)
                            {
                                readedRecords = await ((DbDataReader)nreader).ReadAsync().ConfigureAwait(false);
                            }
                            else
                            {
                                readedRecords = nreader.Read();
                            }
                        }
                    }
                }
                finally
                {

                }
            }
            finally
            {
                nreader.Dispose();
            }
            return intdatatable;
        }
        static DataUtilities()
        {
            typeMap[typeof(byte)] = DbType.Byte;
            typeMap[typeof(sbyte)] = DbType.SByte;
            typeMap[typeof(short)] = DbType.Int16;
            typeMap[typeof(ushort)] = DbType.UInt16;
            typeMap[typeof(int)] = DbType.Int32;
            typeMap[typeof(uint)] = DbType.UInt32;
            typeMap[typeof(long)] = DbType.Int64;
            typeMap[typeof(ulong)] = DbType.UInt64;
            typeMap[typeof(float)] = DbType.Single;
            typeMap[typeof(double)] = DbType.Double;
            typeMap[typeof(decimal)] = DbType.Decimal;
            typeMap[typeof(bool)] = DbType.Boolean;
            typeMap[typeof(string)] = DbType.String;
            typeMap[typeof(char)] = DbType.StringFixedLength;
            typeMap[typeof(Guid)] = DbType.Guid;
            typeMap[typeof(DateTime)] = DbType.DateTime;
#if PocketPC
#else
            typeMap[typeof(DateTimeOffset)] = DbType.DateTimeOffset;
#endif
            typeMap[typeof(byte[])] = DbType.Binary;
            typeMap[typeof(byte?)] = DbType.Byte;
            typeMap[typeof(sbyte?)] = DbType.SByte;
            typeMap[typeof(short?)] = DbType.Int16;
            typeMap[typeof(ushort?)] = DbType.UInt16;
            typeMap[typeof(int?)] = DbType.Int32;
            typeMap[typeof(uint?)] = DbType.UInt32;
            typeMap[typeof(long?)] = DbType.Int64;
            typeMap[typeof(ulong?)] = DbType.UInt64;
            typeMap[typeof(float?)] = DbType.Single;
            typeMap[typeof(double?)] = DbType.Double;
            typeMap[typeof(decimal?)] = DbType.Decimal;
            typeMap[typeof(bool?)] = DbType.Boolean;
            typeMap[typeof(char?)] = DbType.StringFixedLength;
            typeMap[typeof(Guid?)] = DbType.Guid;
            typeMap[typeof(DateTime?)] = DbType.DateTime;
            typeMap[typeof(DateTimeOffset?)] = DbType.DateTimeOffset;
            //typeMap[typeof(System.Data.Linq.Binary)] = DbType.Binary;
        }
        public static System.Data.DbType TypeToDbType(System.Type ntype)
        {
            return typeMap[ntype];
        }
        public static DataTable GroupBy(List<DataTable> sources, string groupCols, string sumCols)
        {
            char char_split = ';';
            if (groupCols.Contains(","))
                char_split = ',';
            List<string> groupColumns = groupCols.Split(char_split).ToList();
            char_split = ';';
            if (sumCols.Contains(","))
                char_split = ',';
            List<string> sumColumns = sumCols.Split(char_split).ToList();
            DataTable result = (DataTable)sources[0].Clone();
            DataView nview = new DataView(result, "", String.Join(",", groupColumns), DataViewRowState.CurrentRows);
            var keys = new object[groupColumns.Count];
            foreach (DataTable table in sources)
            {
                foreach (DataRow row in table.Rows)
                {
                    DataRow newrow = null;
                    for (int i = 0; i < groupColumns.Count; i++)
                    {
                        string key = groupColumns[i];
                        keys[i] = row[key];
                    }
                    DataRowView[] findRows = nview.FindRows(keys);
                    if (findRows.Length > 0)
                        newrow = findRows[0].Row;
                    else
                    {
                        newrow = result.NewRow();
                        foreach (string key in groupColumns)
                        {
                            newrow[key] = row[key];
                        }
                        result.Rows.Add(newrow);
                    }
                    for (int i = 0; i < sumColumns.Count; i++)
                    {
                        string key = sumColumns[i];
                        object source = row[key];
                        object destination = newrow[key];
                        if (destination == DBNull.Value)
                            destination = source;
                        else
                        {
                            if (source != DBNull.Value)
                            {
                                switch (destination.GetType().ToString())
                                {
                                    case "System.Decimal":
                                        destination = Convert.ToDecimal(destination) + Convert.ToDecimal(source);
                                        break;
                                    case "System.Double":
                                        destination = Convert.ToDouble(destination) + Convert.ToDouble(source);
                                        break;
                                    case "System.Int32":
                                    case "System.Int16":
                                        destination = Convert.ToInt32(destination) + Convert.ToInt32(source);
                                        break;
                                    case "System.String":
                                        destination = destination.ToString() + source.ToString();
                                        break;
                                    default:
                                        throw new Exception("Sum not implemented for type " + destination.GetType().ToString());
                                }
                            }
                        }
                        newrow[key] = destination;
                    }
                }
            }
            return result;
        }
        public static List<List<T>> DividirLista<T>(List<T> lista, int tamañoMaximo)
        {
            List<List<T>> listasDivididas = new List<List<T>>();

            for (int i = 0; i < lista.Count; i += tamañoMaximo)
            {
                int elementosRestantes = Math.Min(tamañoMaximo, lista.Count - i);
                List<T> subLista = new List<T>(elementosRestantes);

                for (int j = 0; j < elementosRestantes; j++)
                {
                    subLista.Add(lista[i + j]);
                }

                listasDivididas.Add(subLista);
            }

            return listasDivididas;
        }
        public static int IndexOfDataRow(this DataView dv, DataRow xrow)
        {
            int nresult = -1;
            bool found = false;
            foreach (DataRowView rv in dv)
            {
                nresult++;
                if (rv.Row == xrow)
                {
                    found = true;
                    break;
                }
            }
            if (!found)
                return -1;
            else
                return nresult;
        }


        public static string GetCreationSql(DataTable ntable, string primkey)
        {
            StringBuilder nbuilder = new StringBuilder();

            foreach (DataColumn ncol in ntable.Columns)
            {
                if (nbuilder.Length == 0)
                    nbuilder.Append("(");
                else
                    nbuilder.Append(",");
                nbuilder.Append(ncol.ColumnName);
                nbuilder.Append(" ");
                string ntype = "";
                string ntypename = ncol.DataType.ToString();
                switch (ntypename)
                {
                    case "System.Int16":
                        ntype = "INT16";
                        break;
                    case "System.Int32":
                        ntype = "INT32";
                        break;
                    case "System.Int64":
                        ntype = "INT64";
                        break;
                    case "System.Double":
                        ntype = "DOUBLE PRECISION";
                        break;
                    case "System.Float":
                        ntype = "FLOAT";
                        break;
                    case "System.Decimal":
                        ntype = "NUMERIC(15,4)";
                        break;
                    case "System.DateTime":
                        ntype = "TIMESTAMP";
                        break;
                    case "System.String":
                        int nlength = ncol.MaxLength;
                        if (nlength <= 0)
                            ntype = "TEXT";
                        else
                            ntype = "VARCHAR(" + nlength.ToString() + ") ";
                        break;
                    case "System.Byte[]":
                        ntype = "BLOB";
                        break;
                    default:
                        throw new Exception("GetCreationSQL type unknown: " + ncol.DataType.ToString());
                }
                nbuilder.Append(ntype);
                if (ncol.ColumnName == primkey)
                    nbuilder.Append(" NOT NULL PRIMARY KEY ");
            }
            nbuilder.Append(")");
            string nresult = "CREATE TABLE " + ntable.TableName + nbuilder.ToString();
            return nresult;
        }

    }
}
