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
    /// <para>
    /// The names of the tables are read first. A large catalog (more than <see cref="LargeCatalogThreshold"/>
    /// tables: an ERP's thousands) reads the columns, keys and comments only of the tables it is asked for, with
    /// queries filtered by them: the names of a hundred thousand tables are a few megabytes, their columns are
    /// millions.
    /// </para>
    /// </summary>
    public static class DatabaseCatalogReader
    {
        /// <summary>
        /// The number of tables up to which every table of a catalog is read with its columns; a catalog with more is
        /// large and reads them only for the tables it is asked for (<see cref="ReadTables(DbConnection, IEnumerable{string}, int)"/>).
        /// </summary>
        public const int LargeCatalogThreshold = 5000;

        // The names of a filtered catalog query go in batches of this many (TABLE_NAME IN (...))
        private const int FilterBatch = 200;

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
        /// still listed. A large catalog (more than <see cref="LargeCatalogThreshold"/> tables) comes with
        /// the names only, every table marked as not read (<see cref="LocalSchemaTable.ColumnsRead"/>).
        /// </summary>
        public static List<LocalSchemaTable> ReadTables(DbConnection connection)
        {
            return ReadTables(connection, null, LargeCatalogThreshold);
        }

        /// <summary>
        /// Every user table and view of an open connection, sorted by name. The names are read first, with the
        /// comments of the tables where the database keeps them. With <paramref name="largeCatalogThreshold"/> tables
        /// or fewer every table comes with its columns, primary key and foreign keys, as
        /// <see cref="ReadTables(DbConnection)"/> always did; with more (a large catalog) only the tables of
        /// <paramref name="tablesToRead"/> do, read by queries filtered by them, and every other one has
        /// <see cref="LocalSchemaTable.ColumnsRead"/> false and no columns nor foreign keys.
        /// </summary>
        /// <param name="connection">The connection (opened here when it is closed).</param>
        /// <param name="tablesToRead">The tables to read with their columns in a large catalog (ignoring case); null for none.</param>
        /// <param name="largeCatalogThreshold">The number of tables from which the catalog is large
        /// (<see cref="LargeCatalogThreshold"/>); 0 or less, never.</param>
        public static List<LocalSchemaTable> ReadTables(DbConnection connection, IEnumerable<string> tablesToRead, int largeCatalogThreshold)
        {
            if (connection == null)
                throw new ArgumentNullException("connection");
            if (connection.State != ConnectionState.Open)
                connection.Open();
            Family family = FamilyOf(connection);
            List<CatalogName> names = family == Family.SQLite ? SqliteTableNames(connection) : CatalogTableNames(connection, family);
            bool large = largeCatalogThreshold > 0 && names.Count > largeCatalogThreshold;
            HashSet<string> wanted = null;
            if (large)
            {
                wanted = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
                if (tablesToRead != null)
                    foreach (string name in tablesToRead)
                        if (!string.IsNullOrEmpty(name))
                            wanted.Add(name.Trim());
            }

            var result = new List<LocalSchemaTable>(names.Count);
            var details = new List<KeyValuePair<CatalogName, LocalSchemaTable>>();
            foreach (CatalogName name in names)
            {
                // The database's own comment, where it keeps one, is the starting context of the table.
                var table = new LocalSchemaTable { Name = name.Name, Context = name.Description };
                if (wanted == null || wanted.Contains(name.Name))
                    details.Add(new KeyValuePair<CatalogName, LocalSchemaTable>(name, table));
                else
                    table.ColumnsRead = false;
                result.Add(table);
            }
            ReadDetails(connection, family, details, large);
            // The comments of the tables go with the names; the ones of the columns, with the columns read.
            TableComments(connection, family, result, null);
            ColumnComments(connection, family, Tables(details), large ? NamesOf(details) : null);
            return result;
        }

        /// <summary>
        /// The tables named in <paramref name="tables"/> (ignoring case) that the catalog of an open connection has, as
        /// it spells them and in its order, each one with its columns, primary key, foreign keys and the comments of the
        /// database, read by queries filtered by them: the columns of a large catalog, read when a table is used. A name
        /// the catalog does not have is left out.
        /// </summary>
        /// <param name="connection">The connection (opened here when it is closed).</param>
        /// <param name="tables">The names of the tables.</param>
        public static List<LocalSchemaTable> ReadTableDetails(DbConnection connection, IEnumerable<string> tables)
        {
            if (connection == null)
                throw new ArgumentNullException("connection");
            var result = new List<LocalSchemaTable>();
            var wanted = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
            if (tables != null)
                foreach (string name in tables)
                    if (!string.IsNullOrEmpty(name))
                        wanted.Add(name.Trim());
            if (wanted.Count == 0)
                return result;
            if (connection.State != ConnectionState.Open)
                connection.Open();
            Family family = FamilyOf(connection);
            // The names of the catalog: its spelling, its schema and the comment of each table
            List<CatalogName> names = family == Family.SQLite ? SqliteTableNames(connection) : CatalogTableNames(connection, family);
            var details = new List<KeyValuePair<CatalogName, LocalSchemaTable>>();
            foreach (CatalogName name in names)
            {
                if (!wanted.Contains(name.Name))
                    continue;
                var table = new LocalSchemaTable { Name = name.Name, Context = name.Description };
                details.Add(new KeyValuePair<CatalogName, LocalSchemaTable>(name, table));
                result.Add(table);
            }
            ReadDetails(connection, family, details, true);
            List<string> filter = NamesOf(details);
            TableComments(connection, family, result, filter);
            ColumnComments(connection, family, result, filter);
            return result;
        }

        private static List<LocalSchemaTable> Tables(List<KeyValuePair<CatalogName, LocalSchemaTable>> details)
        {
            var result = new List<LocalSchemaTable>(details.Count);
            foreach (KeyValuePair<CatalogName, LocalSchemaTable> pair in details)
                result.Add(pair.Value);
            return result;
        }

        private static List<string> NamesOf(List<KeyValuePair<CatalogName, LocalSchemaTable>> details)
        {
            var result = new List<string>(details.Count);
            foreach (KeyValuePair<CatalogName, LocalSchemaTable> pair in details)
                result.Add(pair.Key.Name);
            return result;
        }

        /// <summary>
        /// The columns, primary key and foreign keys of the tables of <paramref name="details"/>; with
        /// <paramref name="filtered"/> the queries for the whole database are filtered by those tables.
        /// </summary>
        private static void ReadDetails(DbConnection connection, Family family, List<KeyValuePair<CatalogName, LocalSchemaTable>> details,
            bool filtered)
        {
            if (details.Count == 0)
                return;
            DbProviderFactory factory = null;
            try { factory = DbProviderFactories.GetFactory(connection); } catch { }
            List<string> filter = filtered ? NamesOf(details) : null;

            // The INFORMATION_SCHEMA family answers one query for the whole database, far faster than a
            // KeyInfo reader per table (Npgsql reads the catalog each time).
            bool informationSchema = family == Family.PostgreSQL || family == Family.MySQL || family == Family.SQLServer;
            Dictionary<string, List<LocalSchemaForeignKey>> allForeignKeys = null;
            HashSet<string> primaryKeys = null;
            if (informationSchema)
            {
                try { allForeignKeys = InformationSchemaForeignKeys(connection, family, filter); }
                catch { allForeignKeys = new Dictionary<string, List<LocalSchemaForeignKey>>(StringComparer.OrdinalIgnoreCase); }
                try { primaryKeys = InformationSchemaPrimaryKeys(connection, family, filter); }
                catch { primaryKeys = null; }
            }

            foreach (KeyValuePair<CatalogName, LocalSchemaTable> pair in details)
            {
                LocalSchemaTable table = pair.Value;
                if (family == Family.SQLite)
                    SqliteColumns(connection, table);
                else if (!TryColumnsFromReader(connection, factory, table, !informationSchema))
                    ColumnsFromCatalog(connection, pair.Key.Schema, table);
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
            }
        }

        /// <summary>
        /// The comments the database keeps on its tables, as the starting context of each one that has none yet:
        /// Firebird (RDB$DESCRIPTION), PostgreSQL (COMMENT ON), SQL Server (MS_Description), MySQL (COMMENT) and
        /// Oracle (COMMENT ON). With <paramref name="filter"/> only of those tables, else of the whole database. Best
        /// effort: a catalog that cannot be read leaves them empty.
        /// </summary>
        private static void TableComments(DbConnection connection, Family family, List<LocalSchemaTable> tables, List<string> filter)
        {
            string sql, column;
            switch (family)
            {
                case Family.Firebird:
                    sql = "SELECT TRIM(RDB$RELATION_NAME), RDB$DESCRIPTION FROM RDB$RELATIONS " +
                        "WHERE RDB$DESCRIPTION IS NOT NULL AND COALESCE(RDB$SYSTEM_FLAG, 0) = 0";
                    column = "RDB$RELATION_NAME";
                    break;
                case Family.PostgreSQL:
                    sql = "SELECT c.relname, obj_description(c.oid, 'pg_class') FROM pg_class c " +
                        "JOIN pg_namespace n ON n.oid = c.relnamespace " +
                        "WHERE c.relkind IN ('r', 'v', 'm', 'p', 'f') AND n.nspname NOT IN ('pg_catalog', 'information_schema') " +
                        "AND obj_description(c.oid, 'pg_class') IS NOT NULL";
                    column = "c.relname";
                    break;
                case Family.SQLServer:
                    sql = "SELECT o.name, CAST(ep.value AS nvarchar(max)) FROM sys.extended_properties ep " +
                        "JOIN sys.objects o ON o.object_id = ep.major_id " +
                        "WHERE ep.class = 1 AND ep.minor_id = 0 AND ep.name = 'MS_Description'";
                    column = "o.name";
                    break;
                case Family.MySQL:
                    // A view's comment is the word VIEW, not a description.
                    sql = "SELECT TABLE_NAME, TABLE_COMMENT FROM INFORMATION_SCHEMA.TABLES " +
                        "WHERE TABLE_SCHEMA = DATABASE() AND TABLE_COMMENT <> '' AND TABLE_COMMENT <> 'VIEW'";
                    column = "TABLE_NAME";
                    break;
                case Family.Oracle:
                    sql = "SELECT TABLE_NAME, COMMENTS FROM USER_TAB_COMMENTS WHERE COMMENTS IS NOT NULL";
                    column = "TABLE_NAME";
                    break;
                default:
                    return;
            }
            if (tables.Count == 0)
                return;
            Dictionary<string, LocalSchemaTable> byName = ByName(tables);
            foreach (string query in Filtered(family, sql, " AND " + column, filter))
            {
                foreach (string[] row in Rows(connection, query, 2))
                {
                    LocalSchemaTable table;
                    if (byName.TryGetValue(row[0], out table) && string.IsNullOrEmpty(table.Context))
                        table.Context = row[1];
                }
            }
        }

        /// <summary>
        /// The comments the database keeps on the columns of <paramref name="tables"/>, as the starting context of each
        /// one that has none yet (the dialects of <see cref="TableComments"/>). With <paramref name="filter"/> the query
        /// is filtered by those tables, else it reads the whole database.
        /// </summary>
        private static void ColumnComments(DbConnection connection, Family family, List<LocalSchemaTable> tables, List<string> filter)
        {
            string sql, column;
            switch (family)
            {
                case Family.Firebird:
                    sql = "SELECT TRIM(RDB$RELATION_NAME), TRIM(RDB$FIELD_NAME), RDB$DESCRIPTION " +
                        "FROM RDB$RELATION_FIELDS WHERE RDB$DESCRIPTION IS NOT NULL";
                    column = "RDB$RELATION_NAME";
                    break;
                case Family.PostgreSQL:
                    sql = "SELECT c.relname, a.attname, col_description(c.oid, a.attnum) FROM pg_class c " +
                        "JOIN pg_namespace n ON n.oid = c.relnamespace JOIN pg_attribute a ON a.attrelid = c.oid " +
                        "WHERE a.attnum > 0 AND NOT a.attisdropped AND n.nspname NOT IN ('pg_catalog', 'information_schema') " +
                        "AND col_description(c.oid, a.attnum) IS NOT NULL";
                    column = "c.relname";
                    break;
                case Family.SQLServer:
                    sql = "SELECT o.name, c.name, CAST(ep.value AS nvarchar(max)) FROM sys.extended_properties ep " +
                        "JOIN sys.objects o ON o.object_id = ep.major_id " +
                        "JOIN sys.columns c ON c.object_id = ep.major_id AND c.column_id = ep.minor_id " +
                        "WHERE ep.class = 1 AND ep.minor_id > 0 AND ep.name = 'MS_Description'";
                    column = "o.name";
                    break;
                case Family.MySQL:
                    sql = "SELECT TABLE_NAME, COLUMN_NAME, COLUMN_COMMENT FROM INFORMATION_SCHEMA.COLUMNS " +
                        "WHERE TABLE_SCHEMA = DATABASE() AND COLUMN_COMMENT <> ''";
                    column = "TABLE_NAME";
                    break;
                case Family.Oracle:
                    sql = "SELECT TABLE_NAME, COLUMN_NAME, COMMENTS FROM USER_COL_COMMENTS WHERE COMMENTS IS NOT NULL";
                    column = "TABLE_NAME";
                    break;
                default:
                    return;
            }
            if (tables.Count == 0)
                return;
            Dictionary<string, LocalSchemaTable> byName = ByName(tables);
            foreach (string query in Filtered(family, sql, " AND " + column, filter))
            {
                foreach (string[] row in Rows(connection, query, 3))
                {
                    LocalSchemaTable table;
                    if (!byName.TryGetValue(row[0], out table))
                        continue;
                    LocalSchemaColumn c = table.Columns.Find(x => string.Equals(x.Name, row[1], StringComparison.OrdinalIgnoreCase));
                    if (c != null && string.IsNullOrEmpty(c.Context))
                        c.Context = row[2];
                }
            }
        }

        private static Dictionary<string, LocalSchemaTable> ByName(List<LocalSchemaTable> tables)
        {
            var result = new Dictionary<string, LocalSchemaTable>(StringComparer.OrdinalIgnoreCase);
            foreach (LocalSchemaTable t in tables)
                if (!result.ContainsKey(t.Name))
                    result.Add(t.Name, t);
            return result;
        }

        /// <summary>
        /// A catalog query as it is (no <paramref name="filter"/>), or once per batch of <see cref="FilterBatch"/>
        /// names of <paramref name="filter"/>, followed by <paramref name="condition"/> and <c>IN (...)</c>: " AND
        /// TABLE_NAME" after the WHERE of the query, or " WHERE TABLE_NAME" for one without. None for an empty filter.
        /// </summary>
        private static IEnumerable<string> Filtered(Family family, string sql, string condition, List<string> filter)
        {
            if (filter == null)
            {
                yield return sql;
                yield break;
            }
            for (int start = 0; start < filter.Count; start += FilterBatch)
            {
                var list = new System.Text.StringBuilder();
                for (int i = start; i < filter.Count && i < start + FilterBatch; i++)
                {
                    if (list.Length > 0)
                        list.Append(", ");
                    list.Append(Literal(family, filter[i]));
                }
                yield return sql + condition + " IN (" + list.ToString() + ")";
            }
        }

        /// <summary>A name as a string literal of the dialect: N'...' in SQL Server (the names are Unicode), the backslash escaped in MySQL.</summary>
        private static string Literal(Family family, string text)
        {
            string value = (text ?? "").Replace("'", "''");
            if (family == Family.MySQL)
                value = value.Replace("\\", "\\\\");
            return (family == Family.SQLServer ? "N'" : "'") + value + "'";
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

        /// <summary>The primary key columns as "table.column": of the whole database, or of the tables of <paramref name="filter"/>.</summary>
        private static HashSet<string> InformationSchemaPrimaryKeys(DbConnection connection, Family family, List<string> filter)
        {
            var result = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
            const string sql = @"SELECT kcu.TABLE_NAME, kcu.COLUMN_NAME
FROM INFORMATION_SCHEMA.TABLE_CONSTRAINTS tc
JOIN INFORMATION_SCHEMA.KEY_COLUMN_USAGE kcu ON kcu.CONSTRAINT_NAME = tc.CONSTRAINT_NAME AND kcu.CONSTRAINT_SCHEMA = tc.CONSTRAINT_SCHEMA AND kcu.TABLE_NAME = tc.TABLE_NAME
WHERE tc.CONSTRAINT_TYPE = 'PRIMARY KEY'";
            foreach (string query in Filtered(family, sql, " AND kcu.TABLE_NAME", filter))
            {
                using (DbCommand cmd = connection.CreateCommand())
                {
                    cmd.CommandText = query;
                    cmd.CommandTimeout = 20;
                    using (DbDataReader reader = cmd.ExecuteReader())
                    {
                        while (reader.Read())
                            result.Add(Convert.ToString(reader.GetValue(0)) + "." + Convert.ToString(reader.GetValue(1)));
                    }
                }
            }
            return result;
        }

        /// <summary>The foreign keys by source table: of the whole database, or of the tables of <paramref name="filter"/>.</summary>
        private static Dictionary<string, List<LocalSchemaForeignKey>> InformationSchemaForeignKeys(DbConnection connection, Family family, List<string> filter)
        {
            var result = new Dictionary<string, List<LocalSchemaForeignKey>>(StringComparer.OrdinalIgnoreCase);
            const string sql = @"SELECT rc.CONSTRAINT_NAME AS CN, kcu.TABLE_NAME AS FK_TABLE, kcu.COLUMN_NAME AS FK_COLUMN, kcu.ORDINAL_POSITION AS POS, kcu2.TABLE_NAME AS PK_TABLE, kcu2.COLUMN_NAME AS PK_COLUMN
FROM INFORMATION_SCHEMA.REFERENTIAL_CONSTRAINTS rc
JOIN INFORMATION_SCHEMA.KEY_COLUMN_USAGE kcu ON kcu.CONSTRAINT_NAME = rc.CONSTRAINT_NAME AND kcu.CONSTRAINT_SCHEMA = rc.CONSTRAINT_SCHEMA
JOIN INFORMATION_SCHEMA.KEY_COLUMN_USAGE kcu2 ON kcu2.CONSTRAINT_NAME = rc.UNIQUE_CONSTRAINT_NAME AND kcu2.CONSTRAINT_SCHEMA = rc.UNIQUE_CONSTRAINT_SCHEMA AND kcu2.ORDINAL_POSITION = kcu.ORDINAL_POSITION";
            foreach (string query in Filtered(family, sql, " WHERE kcu.TABLE_NAME", filter))
            {
                using (DbCommand cmd = connection.CreateCommand())
                {
                    cmd.CommandText = query + "\r\nORDER BY kcu.TABLE_NAME, rc.CONSTRAINT_NAME, kcu.ORDINAL_POSITION";
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
