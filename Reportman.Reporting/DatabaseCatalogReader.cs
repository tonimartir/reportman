#region Copyright
/*
 *  Report Manager:  Database Reporting tool for .Net and Mono
 *
 *     The contents of this file are subject to the MPL License
 *     with optional use of GPL or LGPL licenses.
 *     You may not use this file except in compliance with the
 *     Licenses. You may obtain copies of the Licenses at:
 *     http://reportman.sourceforge.net/license
 *
 *  Copyright (c) 1994 - 2026 Toni Martir (toni@reportman.es)
 *  All Rights Reserved.
*/
#endregion

using System;
using System.Collections.Generic;
using System.Data;
using System.Data.Common;

namespace Reportman.Reporting
{
    /// <summary>
    /// Reads the tables, columns, primary keys and foreign keys of a database through its ADO.NET
    /// provider: the schema collections (Firebird, PostgreSQL, SQL Server, MySQL, Oracle, ODBC), the
    /// INFORMATION_SCHEMA views where they exist, and sqlite_master plus PRAGMA for SQLite
    /// (Microsoft.Data.Sqlite has no schema collections). Column types come from the reader schema of
    /// each table, without reading rows.
    /// </summary>
    public static class DatabaseCatalogReader
    {
        private enum Family { Other, Firebird, PostgreSQL, SQLite, SQLServer, MySQL, Oracle }

        private static Family FamilyOf(DbConnection connection)
        {
            string name = connection.GetType().FullName ?? "";
            if (name.StartsWith("FirebirdSql.", StringComparison.Ordinal))
                return Family.Firebird;
            if (name.StartsWith("Npgsql.", StringComparison.Ordinal))
                return Family.PostgreSQL;
            if (name.IndexOf("Sqlite", StringComparison.OrdinalIgnoreCase) >= 0)
                return Family.SQLite;
            if (name == "Microsoft.Data.SqlClient.SqlConnection" || name == "System.Data.SqlClient.SqlConnection")
                return Family.SQLServer;
            if (name.IndexOf("MySql", StringComparison.OrdinalIgnoreCase) >= 0)
                return Family.MySQL;
            if (name.IndexOf("Oracle", StringComparison.OrdinalIgnoreCase) >= 0)
                return Family.Oracle;
            return Family.Other;
        }

        /// <summary>The Reportman AI dialect name of an open connection (Firebird5, PostgreSQL, SQLite...), Default when unknown.</summary>
        public static string DialectOf(DbConnection connection)
        {
            switch (FamilyOf(connection))
            {
                case Family.Firebird:
                    string version = "";
                    try { version = connection.ServerVersion ?? ""; } catch { }
                    // "WI-V5.0.1.1469 Firebird 5.0": the major version follows the V.
                    int v = version.IndexOf("-V", StringComparison.OrdinalIgnoreCase);
                    char major = v >= 0 && v + 2 < version.Length ? version[v + 2] : '5';
                    if (major == '2' || major == '3')
                        return "Firebird2";
                    if (major == '4')
                        return "Firebird4";
                    if (major == '1')
                        return "Firebird1";
                    return "Firebird5";
                case Family.PostgreSQL:
                    return "PostgreSQL";
                case Family.SQLite:
                    return "SQLite";
                case Family.SQLServer:
                    return "SQLServer";
                case Family.MySQL:
                    return "MySQL";
                case Family.Oracle:
                    return "Oracle";
                default:
                    return "Default";
            }
        }

        /// <summary>The Reportman AI column type for a .NET type.</summary>
        public static string CloudType(Type type)
        {
            if (type == null)
                return "String";
            type = Nullable.GetUnderlyingType(type) ?? type;
            if (type == typeof(int) || type == typeof(long) || type == typeof(short) || type == typeof(byte)
                || type == typeof(sbyte) || type == typeof(uint) || type == typeof(ulong) || type == typeof(ushort))
                return "Integer";
            if (type == typeof(decimal) || type == typeof(double) || type == typeof(float))
                return "Numeric";
            if (type == typeof(bool))
                return "Boolean";
            if (type == typeof(DateTime) || type == typeof(DateTimeOffset))
                return "TimeStamp";
            if (type.FullName == "System.DateOnly")
                return "Date";
            if (type == typeof(byte[]))
                return "TextLong";
            return "String";
        }

        /// <summary>The Reportman AI column type for a declared database type ("VARCHAR(40)", "integer", "timestamp").</summary>
        public static string LooseType(string declared)
        {
            string t = (declared ?? "").ToUpperInvariant();
            if (t.Contains("INT") || t.Contains("SERIAL") || t.Contains("SMALL") || t.Contains("BIG"))
                return "Integer";
            if (t.Contains("BOOL") || t.Contains("BIT"))
                return "Boolean";
            if (t.Contains("TIMESTAMP") || t.Contains("DATETIME"))
                return "TimeStamp";
            if (t.Contains("DATE"))
                return "Date";
            if (t.Contains("CURRENCY") || t.Contains("MONEY"))
                return "Currency";
            if (t.Contains("DEC") || t.Contains("NUM") || t.Contains("FLOAT") || t.Contains("DOUBLE") || t.Contains("REAL"))
                return "Numeric";
            if (t.Contains("TEXT") || t.Contains("BLOB") || t.Contains("CLOB"))
                return "TextLong";
            return "String";
        }

        /// <summary>
        /// Every user table and view of an open connection, sorted by name, with columns, primary key
        /// and foreign keys (when the provider exposes them). A table whose columns cannot be read is
        /// still listed.
        /// </summary>
        public static List<LocalSchemaTable> ReadTables(DbConnection connection)
        {
            if (connection == null)
                throw new ArgumentNullException("connection");
            if (connection.State != ConnectionState.Open)
                connection.Open();
            Family family = FamilyOf(connection);
            DbProviderFactory factory = null;
            try { factory = DbProviderFactories.GetFactory(connection); } catch { }

            var result = new List<LocalSchemaTable>();
            List<CatalogName> names = family == Family.SQLite ? SqliteTableNames(connection) : CatalogTableNames(connection, family);

            // The INFORMATION_SCHEMA family answers one query for the whole database, far faster than a
            // KeyInfo reader per table (Npgsql reads the catalog each time).
            bool informationSchema = family == Family.PostgreSQL || family == Family.MySQL || family == Family.SQLServer;
            Dictionary<string, List<LocalSchemaForeignKey>> allForeignKeys = null;
            HashSet<string> primaryKeys = null;
            if (informationSchema)
            {
                try { allForeignKeys = InformationSchemaForeignKeys(connection); }
                catch { allForeignKeys = new Dictionary<string, List<LocalSchemaForeignKey>>(StringComparer.OrdinalIgnoreCase); }
                try { primaryKeys = InformationSchemaPrimaryKeys(connection); }
                catch { primaryKeys = null; }
            }

            foreach (CatalogName name in names)
            {
                // The database's own comment, where it keeps one, is the starting context of the table.
                var table = new LocalSchemaTable { Name = name.Name, Context = name.Description };
                if (family == Family.SQLite)
                    SqliteColumns(connection, table);
                else if (!TryColumnsFromReader(connection, factory, table, !informationSchema))
                    ColumnsFromCatalog(connection, name.Schema, table);
                if (primaryKeys != null)
                {
                    foreach (LocalSchemaColumn c in table.Columns)
                        c.IsPrimaryKey = primaryKeys.Contains(table.Name + "." + c.Name);
                }
                try
                {
                    if (allForeignKeys != null)
                    {
                        List<LocalSchemaForeignKey> fks;
                        if (allForeignKeys.TryGetValue(table.Name, out fks))
                            table.ForeignKeys.AddRange(fks);
                    }
                    else if (family == Family.SQLite)
                        SqliteForeignKeys(connection, table);
                    else if (family == Family.Firebird)
                        FirebirdForeignKeys(connection, table);
                }
                catch
                {
                    // A table whose foreign keys cannot be read keeps its columns.
                }
                result.Add(table);
            }
            ReadComments(connection, family, result);
            return result;
        }

        /// <summary>
        /// The comments the database keeps on its tables and columns, as the starting context of each one that
        /// has none yet: Firebird (RDB$DESCRIPTION), PostgreSQL (COMMENT ON), SQL Server (MS_Description), MySQL
        /// (COMMENT) and Oracle (COMMENT ON). Best effort: a catalog that cannot be read leaves them empty.
        /// </summary>
        private static void ReadComments(DbConnection connection, Family family, List<LocalSchemaTable> tables)
        {
            string tableSql, columnSql;
            switch (family)
            {
                case Family.Firebird:
                    tableSql = "SELECT TRIM(RDB$RELATION_NAME), RDB$DESCRIPTION FROM RDB$RELATIONS " +
                        "WHERE RDB$DESCRIPTION IS NOT NULL AND COALESCE(RDB$SYSTEM_FLAG, 0) = 0";
                    columnSql = "SELECT TRIM(RDB$RELATION_NAME), TRIM(RDB$FIELD_NAME), RDB$DESCRIPTION " +
                        "FROM RDB$RELATION_FIELDS WHERE RDB$DESCRIPTION IS NOT NULL";
                    break;
                case Family.PostgreSQL:
                    tableSql = "SELECT c.relname, obj_description(c.oid, 'pg_class') FROM pg_class c " +
                        "JOIN pg_namespace n ON n.oid = c.relnamespace " +
                        "WHERE c.relkind IN ('r', 'v', 'm', 'p', 'f') AND n.nspname NOT IN ('pg_catalog', 'information_schema') " +
                        "AND obj_description(c.oid, 'pg_class') IS NOT NULL";
                    columnSql = "SELECT c.relname, a.attname, col_description(c.oid, a.attnum) FROM pg_class c " +
                        "JOIN pg_namespace n ON n.oid = c.relnamespace JOIN pg_attribute a ON a.attrelid = c.oid " +
                        "WHERE a.attnum > 0 AND NOT a.attisdropped AND n.nspname NOT IN ('pg_catalog', 'information_schema') " +
                        "AND col_description(c.oid, a.attnum) IS NOT NULL";
                    break;
                case Family.SQLServer:
                    tableSql = "SELECT o.name, CAST(ep.value AS nvarchar(max)) FROM sys.extended_properties ep " +
                        "JOIN sys.objects o ON o.object_id = ep.major_id " +
                        "WHERE ep.class = 1 AND ep.minor_id = 0 AND ep.name = 'MS_Description'";
                    columnSql = "SELECT o.name, c.name, CAST(ep.value AS nvarchar(max)) FROM sys.extended_properties ep " +
                        "JOIN sys.objects o ON o.object_id = ep.major_id " +
                        "JOIN sys.columns c ON c.object_id = ep.major_id AND c.column_id = ep.minor_id " +
                        "WHERE ep.class = 1 AND ep.minor_id > 0 AND ep.name = 'MS_Description'";
                    break;
                case Family.MySQL:
                    // A view's comment is the word VIEW, not a description.
                    tableSql = "SELECT TABLE_NAME, TABLE_COMMENT FROM INFORMATION_SCHEMA.TABLES " +
                        "WHERE TABLE_SCHEMA = DATABASE() AND TABLE_COMMENT <> '' AND TABLE_COMMENT <> 'VIEW'";
                    columnSql = "SELECT TABLE_NAME, COLUMN_NAME, COLUMN_COMMENT FROM INFORMATION_SCHEMA.COLUMNS " +
                        "WHERE TABLE_SCHEMA = DATABASE() AND COLUMN_COMMENT <> ''";
                    break;
                case Family.Oracle:
                    tableSql = "SELECT TABLE_NAME, COMMENTS FROM USER_TAB_COMMENTS WHERE COMMENTS IS NOT NULL";
                    columnSql = "SELECT TABLE_NAME, COLUMN_NAME, COMMENTS FROM USER_COL_COMMENTS WHERE COMMENTS IS NOT NULL";
                    break;
                default:
                    return;
            }
            var byName = new Dictionary<string, LocalSchemaTable>(StringComparer.OrdinalIgnoreCase);
            foreach (LocalSchemaTable t in tables)
                if (!byName.ContainsKey(t.Name))
                    byName.Add(t.Name, t);
            foreach (string[] row in Rows(connection, tableSql, 2))
            {
                LocalSchemaTable table;
                if (byName.TryGetValue(row[0], out table) && string.IsNullOrEmpty(table.Context))
                    table.Context = row[1];
            }
            foreach (string[] row in Rows(connection, columnSql, 3))
            {
                LocalSchemaTable table;
                if (!byName.TryGetValue(row[0], out table))
                    continue;
                LocalSchemaColumn column = table.Columns.Find(c => string.Equals(c.Name, row[1], StringComparison.OrdinalIgnoreCase));
                if (column != null && string.IsNullOrEmpty(column.Context))
                    column.Context = row[2];
            }
        }

        /// <summary>The rows of a catalog query, trimmed text, without the ones with an empty value; none when it fails.</summary>
        private static List<string[]> Rows(DbConnection connection, string sql, int fieldCount)
        {
            var result = new List<string[]>();
            try
            {
                using (DbCommand cmd = connection.CreateCommand())
                {
                    cmd.CommandText = sql;
                    cmd.CommandTimeout = 20;
                    using (DbDataReader reader = cmd.ExecuteReader())
                    {
                        while (reader.Read())
                        {
                            var row = new string[fieldCount];
                            for (int i = 0; i < fieldCount; i++)
                                row[i] = reader.IsDBNull(i) ? "" : (Convert.ToString(reader.GetValue(i)) ?? "").Trim();
                            if (Array.TrueForAll(row, v => v.Length > 0))
                                result.Add(row);
                        }
                    }
                }
            }
            catch
            {
                // A catalog that cannot be read (permissions, an older server): no comments.
            }
            return result;
        }

        private static bool IsSystemSchema(string schema)
        {
            string s = (schema ?? "").ToUpperInvariant();
            return s == "INFORMATION_SCHEMA" || s == "PG_CATALOG" || s == "SYS" || s == "SYSTEM" || s == "MYSQL"
                || s == "PERFORMANCE_SCHEMA" || s.StartsWith("PG_TOAST");
        }

        private static string ColumnOf(DataTable table, params string[] candidates)
        {
            foreach (string c in candidates)
                if (table.Columns.Contains(c))
                    return c;
            return null;
        }

        private class CatalogName
        {
            public string Name = "";
            public string Schema = "";
            public string Description = "";
        }

        /// <summary>Tables and views through the ADO.NET "Tables" and "Views" collections, with their schema name and description.</summary>
        private static List<CatalogName> CatalogTableNames(DbConnection connection, Family family)
        {
            var result = new List<CatalogName>();
            var seen = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
            foreach (string collection in new string[] { "Tables", "Views" })
            {
                DataTable tables;
                try
                {
                    tables = connection.GetSchema(collection);
                }
                catch
                {
                    if (collection == "Tables")
                        throw;
                    continue;
                }
                string nameColumn = ColumnOf(tables, "TABLE_NAME", "VIEW_NAME") ?? tables.Columns[0].ColumnName;
                string typeColumn = ColumnOf(tables, "TABLE_TYPE", "TYPE");
                string schemaColumn = ColumnOf(tables, "TABLE_SCHEMA", "OWNER", "VIEW_SCHEMA");
                string systemColumn = ColumnOf(tables, "IS_SYSTEM_TABLE", "IS_SYSTEM_VIEW");
                string descriptionColumn = ColumnOf(tables, "DESCRIPTION", "REMARKS");
                foreach (DataRow row in tables.Rows)
                {
                    string type = typeColumn != null ? Convert.ToString(row[typeColumn]) ?? "" : "";
                    if (type.IndexOf("SYSTEM", StringComparison.OrdinalIgnoreCase) >= 0)
                        continue;
                    if (systemColumn != null && row[systemColumn] is bool && (bool)row[systemColumn])
                        continue;
                    string schema = schemaColumn != null ? Convert.ToString(row[schemaColumn]) ?? "" : "";
                    if (IsSystemSchema(schema))
                        continue;
                    string tableName = (Convert.ToString(row[nameColumn]) ?? "").Trim();
                    if (tableName.Length == 0)
                        continue;
                    // Firebird lists its own RDB$/MON$/SEC$ tables as plain tables in some versions.
                    if (family == Family.Firebird && tableName.IndexOf('$') >= 0)
                        continue;
                    if (seen.Add(tableName))
                    {
                        string description = descriptionColumn != null ? Convert.ToString(row[descriptionColumn]) ?? "" : "";
                        result.Add(new CatalogName { Name = tableName, Schema = schema.Trim(), Description = description.Trim() });
                    }
                }
            }
            result.Sort((a, b) => string.Compare(a.Name, b.Name, StringComparison.OrdinalIgnoreCase));
            return result;
        }

        private static List<CatalogName> SqliteTableNames(DbConnection connection)
        {
            var result = new List<CatalogName>();
            using (DbCommand cmd = connection.CreateCommand())
            {
                cmd.CommandText = "SELECT name FROM sqlite_master WHERE type IN ('table','view') AND name NOT LIKE 'sqlite_%' ORDER BY name";
                using (DbDataReader reader = cmd.ExecuteReader())
                {
                    while (reader.Read())
                        result.Add(new CatalogName { Name = reader.GetString(0) });
                }
            }
            return result;
        }

        private static void SqliteColumns(DbConnection connection, LocalSchemaTable table)
        {
            try
            {
                using (DbCommand cmd = connection.CreateCommand())
                {
                    cmd.CommandText = "PRAGMA table_info(\"" + table.Name.Replace("\"", "\"\"") + "\")";
                    using (DbDataReader reader = cmd.ExecuteReader())
                    {
                        while (reader.Read())
                        {
                            string declared = reader.IsDBNull(2) ? "" : Convert.ToString(reader.GetValue(2));
                            table.Columns.Add(new LocalSchemaColumn
                            {
                                Name = Convert.ToString(reader.GetValue(1)),
                                DetectedType = declared,
                                DataType = LooseType(declared),
                                IsPrimaryKey = !reader.IsDBNull(5) && Convert.ToInt64(reader.GetValue(5)) > 0
                            });
                        }
                    }
                }
            }
            catch
            {
                // Listed without columns.
            }
        }

        private static void SqliteForeignKeys(DbConnection connection, LocalSchemaTable table)
        {
            using (DbCommand cmd = connection.CreateCommand())
            {
                cmd.CommandText = "PRAGMA foreign_key_list(\"" + table.Name.Replace("\"", "\"\"") + "\")";
                using (DbDataReader reader = cmd.ExecuteReader())
                {
                    var byId = new Dictionary<long, LocalSchemaForeignKey>();
                    while (reader.Read())
                    {
                        long id = Convert.ToInt64(reader.GetValue(0));
                        LocalSchemaForeignKey fk;
                        if (!byId.TryGetValue(id, out fk))
                        {
                            fk = new LocalSchemaForeignKey
                            {
                                ConstraintName = "FK_" + table.Name + "_" + id,
                                TargetTable = Convert.ToString(reader.GetValue(2))
                            };
                            byId[id] = fk;
                            table.ForeignKeys.Add(fk);
                        }
                        fk.SourceColumns.Add(reader.IsDBNull(3) ? "" : Convert.ToString(reader.GetValue(3)));
                        fk.TargetColumns.Add(reader.IsDBNull(4) ? "" : Convert.ToString(reader.GetValue(4)));
                    }
                }
            }
        }

        /// <summary>Columns, types and primary key from the reader schema of SELECT * (SchemaOnly, plus KeyInfo when asked).</summary>
        private static bool TryColumnsFromReader(DbConnection connection, DbProviderFactory factory, LocalSchemaTable table, bool keyInfo)
        {
            try
            {
                using (DbCommand cmd = connection.CreateCommand())
                {
                    cmd.CommandText = "SELECT * FROM " + Quote(factory, table.Name);
                    cmd.CommandTimeout = 15;
                    CommandBehavior behavior = keyInfo ? CommandBehavior.SchemaOnly | CommandBehavior.KeyInfo : CommandBehavior.SchemaOnly;
                    using (DbDataReader reader = cmd.ExecuteReader(behavior))
                    {
                        DataTable schema = reader.GetSchemaTable();
                        if (schema == null || schema.Rows.Count == 0)
                            return false;
                        int ordinal = 0;
                        foreach (DataRow row in schema.Rows)
                        {
                            Type clr = schema.Columns.Contains("DataType") ? row["DataType"] as Type : null;
                            var column = new LocalSchemaColumn
                            {
                                Name = schema.Columns.Contains("ColumnName") ? (Convert.ToString(row["ColumnName"]) ?? "").Trim() : "",
                                DataType = CloudType(clr),
                                IsPrimaryKey = schema.Columns.Contains("IsKey") && row["IsKey"] is bool && (bool)row["IsKey"],
                                DetectedType = clr != null ? clr.FullName : ""
                            };
                            try
                            {
                                string declared = reader.GetDataTypeName(ordinal);
                                if (!string.IsNullOrEmpty(declared))
                                {
                                    column.DetectedType = declared;
                                    // The .NET type does not tell a date from a timestamp, nor a long text from a short one.
                                    string loose = LooseType(declared);
                                    if ((column.DataType == "TimeStamp" && loose == "Date") || (column.DataType == "String" && loose == "TextLong"))
                                        column.DataType = loose;
                                }
                            }
                            catch
                            {
                            }
                            if (column.Name.Length > 0)
                                table.Columns.Add(column);
                            ordinal++;
                        }
                    }
                }
                return table.Columns.Count > 0;
            }
            catch
            {
                table.Columns.Clear();
                return false;
            }
        }

        /// <summary>Fallback: names and declared types from the "Columns" collection, with no key.</summary>
        private static void ColumnsFromCatalog(DbConnection connection, string tableSchema, LocalSchemaTable table)
        {
            try
            {
                DataTable columns = connection.GetSchema("Columns", new string[] { null, string.IsNullOrEmpty(tableSchema) ? null : tableSchema, table.Name });
                string colName = ColumnOf(columns, "COLUMN_NAME") ?? columns.Columns[0].ColumnName;
                string colType = ColumnOf(columns, "DATA_TYPE", "COLUMN_DATA_TYPE", "TYPE_NAME");
                foreach (DataRow c in columns.Rows)
                {
                    string declared = colType == null ? "" : Convert.ToString(c[colType]) ?? "";
                    table.Columns.Add(new LocalSchemaColumn
                    {
                        Name = (Convert.ToString(c[colName]) ?? "").Trim(),
                        DetectedType = declared,
                        DataType = LooseType(declared)
                    });
                }
            }
            catch
            {
                // Listed without columns.
            }
        }

        private static void FirebirdForeignKeys(DbConnection connection, LocalSchemaTable table)
        {
            // The Firebird provider's collection has everything, ordered by constraint and position.
            DataTable rows = connection.GetSchema("ForeignKeyColumns", new string[] { null, null, table.Name });
            var byName = new Dictionary<string, List<DataRow>>(StringComparer.OrdinalIgnoreCase);
            var order = new List<string>();
            foreach (DataRow r in rows.Rows)
            {
                string name = (Convert.ToString(r["CONSTRAINT_NAME"]) ?? "").Trim();
                List<DataRow> list;
                if (!byName.TryGetValue(name, out list))
                {
                    list = new List<DataRow>();
                    byName.Add(name, list);
                    order.Add(name);
                }
                list.Add(r);
            }
            foreach (string name in order)
            {
                List<DataRow> list = byName[name];
                list.Sort((a, b) => Convert.ToInt32(a["ORDINAL_POSITION"]).CompareTo(Convert.ToInt32(b["ORDINAL_POSITION"])));
                var fk = new LocalSchemaForeignKey
                {
                    ConstraintName = name,
                    TargetTable = (Convert.ToString(list[0]["REFERENCED_TABLE_NAME"]) ?? "").Trim()
                };
                foreach (DataRow r in list)
                {
                    fk.SourceColumns.Add((Convert.ToString(r["COLUMN_NAME"]) ?? "").Trim());
                    fk.TargetColumns.Add((Convert.ToString(r["REFERENCED_COLUMN_NAME"]) ?? "").Trim());
                }
                table.ForeignKeys.Add(fk);
            }
        }

        private static HashSet<string> InformationSchemaPrimaryKeys(DbConnection connection)
        {
            var result = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
            using (DbCommand cmd = connection.CreateCommand())
            {
                cmd.CommandText = @"SELECT kcu.TABLE_NAME, kcu.COLUMN_NAME
FROM INFORMATION_SCHEMA.TABLE_CONSTRAINTS tc
JOIN INFORMATION_SCHEMA.KEY_COLUMN_USAGE kcu ON kcu.CONSTRAINT_NAME = tc.CONSTRAINT_NAME AND kcu.CONSTRAINT_SCHEMA = tc.CONSTRAINT_SCHEMA AND kcu.TABLE_NAME = tc.TABLE_NAME
WHERE tc.CONSTRAINT_TYPE = 'PRIMARY KEY'";
                cmd.CommandTimeout = 20;
                using (DbDataReader reader = cmd.ExecuteReader())
                {
                    while (reader.Read())
                        result.Add(Convert.ToString(reader.GetValue(0)) + "." + Convert.ToString(reader.GetValue(1)));
                }
            }
            return result;
        }

        private static Dictionary<string, List<LocalSchemaForeignKey>> InformationSchemaForeignKeys(DbConnection connection)
        {
            var result = new Dictionary<string, List<LocalSchemaForeignKey>>(StringComparer.OrdinalIgnoreCase);
            using (DbCommand cmd = connection.CreateCommand())
            {
                cmd.CommandText = @"SELECT rc.CONSTRAINT_NAME AS CN, kcu.TABLE_NAME AS FK_TABLE, kcu.COLUMN_NAME AS FK_COLUMN, kcu.ORDINAL_POSITION AS POS, kcu2.TABLE_NAME AS PK_TABLE, kcu2.COLUMN_NAME AS PK_COLUMN
FROM INFORMATION_SCHEMA.REFERENTIAL_CONSTRAINTS rc
JOIN INFORMATION_SCHEMA.KEY_COLUMN_USAGE kcu ON kcu.CONSTRAINT_NAME = rc.CONSTRAINT_NAME AND kcu.CONSTRAINT_SCHEMA = rc.CONSTRAINT_SCHEMA
JOIN INFORMATION_SCHEMA.KEY_COLUMN_USAGE kcu2 ON kcu2.CONSTRAINT_NAME = rc.UNIQUE_CONSTRAINT_NAME AND kcu2.CONSTRAINT_SCHEMA = rc.UNIQUE_CONSTRAINT_SCHEMA AND kcu2.ORDINAL_POSITION = kcu.ORDINAL_POSITION
ORDER BY kcu.TABLE_NAME, rc.CONSTRAINT_NAME, kcu.ORDINAL_POSITION";
                cmd.CommandTimeout = 20;
                using (DbDataReader reader = cmd.ExecuteReader())
                {
                    LocalSchemaForeignKey current = null;
                    string currentTable = "";
                    while (reader.Read())
                    {
                        string tableName = Convert.ToString(reader["FK_TABLE"]) ?? "";
                        string name = Convert.ToString(reader["CN"]) ?? "";
                        if (current == null || current.ConstraintName != name || currentTable != tableName)
                        {
                            current = new LocalSchemaForeignKey { ConstraintName = name, TargetTable = Convert.ToString(reader["PK_TABLE"]) ?? "" };
                            currentTable = tableName;
                            List<LocalSchemaForeignKey> list;
                            if (!result.TryGetValue(tableName, out list))
                            {
                                list = new List<LocalSchemaForeignKey>();
                                result[tableName] = list;
                            }
                            list.Add(current);
                        }
                        current.SourceColumns.Add(Convert.ToString(reader["FK_COLUMN"]) ?? "");
                        current.TargetColumns.Add(Convert.ToString(reader["PK_COLUMN"]) ?? "");
                    }
                }
            }
            return result;
        }

        private static string Quote(DbProviderFactory factory, string name)
        {
            if (factory != null)
            {
                try
                {
                    using (DbCommandBuilder builder = factory.CreateCommandBuilder())
                    {
                        if (builder != null)
                            return builder.QuoteIdentifier(name);
                    }
                }
                catch
                {
                    // Providers without a command builder.
                }
            }
            return "\"" + name.Replace("\"", "\"\"") + "\"";
        }
    }
}
