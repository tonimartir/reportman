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
using System.Globalization;
using System.Text.RegularExpressions;
using Reportman.Reporting;

namespace Reportman.Designer
{
    /// <summary>
    /// What the local schema screen does to a <see cref="LocalSchemaFile"/>, without any window: the file's
    /// <c>tables</c> are the dictionary (descriptions, allowed values and relations, shared) and each subschema
    /// only chooses tables and columns. What travels to the AI follows <see cref="LocalSchemaStore.ColumnsOf"/>:
    /// a table of a subschema without a list of columns travels with its primary key only.
    /// </summary>
    internal static class LocalSchemaEditing
    {
        private static readonly Regex PlainIdentifier = new Regex("^[A-Za-z_][A-Za-z0-9_$]*$", RegexOptions.CultureInvariant);

        /// <summary>The table of the catalog with that name (ignoring case), or null.</summary>
        public static LocalSchemaTable FindTable(LocalSchemaFile file, string name)
        {
            if (file == null || string.IsNullOrEmpty(name))
                return null;
            return file.Tables.Find(t => string.Equals(t.Name, name, StringComparison.OrdinalIgnoreCase));
        }

        /// <summary>The column of a table with that name (ignoring case), or null.</summary>
        public static LocalSchemaColumn FindColumn(LocalSchemaTable table, string name)
        {
            if (table == null || string.IsNullOrEmpty(name))
                return null;
            return table.Columns.Find(c => string.Equals(c.Name, name, StringComparison.OrdinalIgnoreCase));
        }

        private static bool ContainsName(IEnumerable<string> names, string name)
        {
            if (names == null)
                return false;
            foreach (string n in names)
                if (string.Equals(n, name, StringComparison.OrdinalIgnoreCase))
                    return true;
            return false;
        }

        /// <summary>True when the subschema has the table; every table is in «all the tables» (null).</summary>
        public static bool HasTable(LocalSubschema subschema, string table)
        {
            return subschema == null || ContainsName(subschema.Tables, table);
        }

        /// <summary>The tables of a subschema (all of them for null), in the order of the catalog.</summary>
        public static List<LocalSchemaTable> TablesOf(LocalSchemaFile file, LocalSubschema subschema)
        {
            var result = new List<LocalSchemaTable>();
            if (file == null)
                return result;
            foreach (LocalSchemaTable t in file.Tables)
                if (HasTable(subschema, t.Name))
                    result.Add(t);
            return result;
        }

        /// <summary>The names of the columns of a table that travel with the subschema.</summary>
        public static List<string> TravellingColumns(LocalSubschema subschema, LocalSchemaTable table)
        {
            var result = new List<string>();
            foreach (LocalSchemaColumn c in LocalSchemaStore.ColumnsOf(subschema, table))
                result.Add(c.Name);
            return result;
        }

        /// <summary>The names of the primary key columns of a table.</summary>
        public static List<string> PrimaryKey(LocalSchemaTable table)
        {
            var result = new List<string>();
            if (table != null)
                foreach (LocalSchemaColumn c in table.Columns)
                    if (c.IsPrimaryKey)
                        result.Add(c.Name);
            return result;
        }

        /// <summary>
        /// Sets the columns a subschema chooses of a table, as the catalog spells them and in its order; none
        /// (null or empty) removes the list, and then the table travels with its primary key only.
        /// </summary>
        public static void SetChosenColumns(LocalSubschema subschema, LocalSchemaTable table, IEnumerable<string> names)
        {
            if (subschema == null || table == null)
                return;
            var chosen = new List<string>();
            foreach (LocalSchemaColumn c in table.Columns)
                if (ContainsName(names, c.Name))
                    chosen.Add(c.Name);
            RemoveColumnsEntry(subschema, table.Name);
            if (chosen.Count > 0)
            {
                if (subschema.Columns == null)
                    subschema.Columns = new Dictionary<string, List<string>>();
                subschema.Columns[table.Name] = chosen;
            }
            if (subschema.Columns != null && subschema.Columns.Count == 0)
                subschema.Columns = null;
        }

        private static void RemoveColumnsEntry(LocalSubschema subschema, string table)
        {
            if (subschema.Columns == null)
                return;
            var keys = new List<string>();
            foreach (string key in subschema.Columns.Keys)
                if (string.Equals(key, table, StringComparison.OrdinalIgnoreCase))
                    keys.Add(key);
            foreach (string key in keys)
                subschema.Columns.Remove(key);
            if (subschema.Columns.Count == 0)
                subschema.Columns = null;
        }

        /// <summary>Adds columns to the ones of a table that travel (an explicit list from then on).</summary>
        public static void AddColumns(LocalSubschema subschema, LocalSchemaTable table, IEnumerable<string> names)
        {
            if (subschema == null || table == null)
                return;
            List<string> chosen = TravellingColumns(subschema, table);
            if (names != null)
                chosen.AddRange(names);
            SetChosenColumns(subschema, table, chosen);
        }

        /// <summary>
        /// Adds a table to a subschema, in the order of the catalog, with its primary key as the explicit list
        /// of columns (people choose and describe the rest). False when it was already there.
        /// </summary>
        public static bool AddTable(LocalSchemaFile file, LocalSubschema subschema, LocalSchemaTable table)
        {
            if (file == null || subschema == null || table == null || HasTable(subschema, table.Name))
                return false;
            var ordered = new List<string>();
            foreach (LocalSchemaTable t in file.Tables)
                if (t == table || ContainsName(subschema.Tables, t.Name))
                    ordered.Add(t.Name);
            // Names the catalog does not have any more stay, at the end: nothing is lost by adding.
            foreach (string name in subschema.Tables)
                if (FindTable(file, name) == null && !ContainsName(ordered, name))
                    ordered.Add(name);
            subschema.Tables = ordered;
            SetChosenColumns(subschema, table, PrimaryKey(table));
            return true;
        }

        /// <summary>Removes a table, and its list of columns, from a subschema.</summary>
        public static void RemoveTable(LocalSubschema subschema, string table)
        {
            if (subschema == null || string.IsNullOrEmpty(table))
                return;
            subschema.Tables.RemoveAll(n => string.Equals(n, table, StringComparison.OrdinalIgnoreCase));
            RemoveColumnsEntry(subschema, table);
        }

        /// <summary>A copy of a subschema with another name: the same tables, columns and description.</summary>
        public static LocalSubschema Duplicate(LocalSubschema source, string name)
        {
            var copy = new LocalSubschema
            {
                Name = name ?? "",
                Description = source.Description ?? "",
                Tables = new List<string>(source.Tables),
                Extra = source.Extra != null ? new Dictionary<string, System.Text.Json.JsonElement>(source.Extra) : null
            };
            if (source.Columns != null)
            {
                copy.Columns = new Dictionary<string, List<string>>();
                foreach (KeyValuePair<string, List<string>> entry in source.Columns)
                    copy.Columns[entry.Key] = new List<string>(entry.Value ?? new List<string>());
            }
            return copy;
        }

        /// <summary>The subschemas other than <paramref name="except"/> that have the table.</summary>
        public static List<string> SubschemasWithTable(LocalSchemaFile file, LocalSubschema except, LocalSchemaTable table)
        {
            var result = new List<string>();
            if (file == null || table == null)
                return result;
            foreach (LocalSubschema s in file.Schemas)
                if (s != except && ContainsName(s.Tables, table.Name))
                    result.Add(s.Name);
            return result;
        }

        /// <summary>The subschemas other than <paramref name="except"/> where the column travels.</summary>
        public static List<string> SubschemasWithColumn(LocalSchemaFile file, LocalSubschema except, LocalSchemaTable table, LocalSchemaColumn column)
        {
            var result = new List<string>();
            if (file == null || table == null || column == null)
                return result;
            foreach (LocalSubschema s in file.Schemas)
                if (s != except && ContainsName(s.Tables, table.Name) && ContainsName(TravellingColumns(s, table), column.Name))
                    result.Add(s.Name);
            return result;
        }

        /// <summary>
        /// What a subschema (all the tables for null) sends to the AI: its tables and the columns of the widest
        /// one, the two numbers the plan limits.
        /// </summary>
        public static void Count(LocalSchemaFile file, LocalSubschema subschema, out int tables, out int widestColumns, out string widestTable)
        {
            tables = 0;
            widestColumns = 0;
            widestTable = "";
            foreach (LocalSchemaTable t in TablesOf(file, subschema))
            {
                tables++;
                int columns = LocalSchemaStore.ColumnsOf(subschema, t).Count;
                if (columns > widestColumns)
                {
                    widestColumns = columns;
                    widestTable = t.Name;
                }
            }
        }

        /// <summary>
        /// True when the numbers pass a plan's limits (a limit of 0 or less is none).
        /// </summary>
        public static bool IsOverPlan(int tables, int widestColumns, int maxTables, int maxColumnsPerTable)
        {
            return (maxTables > 0 && tables > maxTables) || (maxColumnsPerTable > 0 && widestColumns > maxColumnsPerTable);
        }

        /// <summary>A relation people wrote (the database does not declare it): its constraint name is empty.</summary>
        public static bool IsWritten(LocalSchemaForeignKey fk)
        {
            return fk != null && string.IsNullOrEmpty(fk.ConstraintName);
        }

        /// <summary>True when a relation has a target and as many source as target columns, at least one.</summary>
        public static bool IsComplete(LocalSchemaForeignKey fk)
        {
            return fk != null && !string.IsNullOrWhiteSpace(fk.TargetTable) && fk.SourceColumns.Count > 0 &&
                fk.SourceColumns.Count == fk.TargetColumns.Count &&
                !fk.SourceColumns.Exists(string.IsNullOrEmpty) && !fk.TargetColumns.Exists(string.IsNullOrEmpty);
        }

        /// <summary>
        /// True when the relation travels with the subschema, as <see cref="LocalSchemaStore.BuildInlineConfig"/>
        /// decides: its two tables and the columns of both ends travel (every relation with all the tables).
        /// </summary>
        public static bool Travels(LocalSchemaFile file, LocalSubschema subschema, LocalSchemaTable source, LocalSchemaForeignKey fk)
        {
            if (subschema == null)
                return true;
            LocalSchemaTable target = FindTable(file, fk.TargetTable);
            if (source == null || target == null || !HasTable(subschema, source.Name) || !HasTable(subschema, target.Name))
                return false;
            List<string> sourceColumns = TravellingColumns(subschema, source);
            List<string> targetColumns = TravellingColumns(subschema, target);
            foreach (string c in fk.SourceColumns)
                if (!ContainsName(sourceColumns, c))
                    return false;
            foreach (string c in fk.TargetColumns)
                if (!ContainsName(targetColumns, c))
                    return false;
            return true;
        }

        /// <summary>
        /// Makes a relation of a table of the subschema travel: adds the target table (with its primary key)
        /// when it is not there, and the columns of both ends. False when the target is not in the catalog.
        /// </summary>
        public static bool Complete(LocalSchemaFile file, LocalSubschema subschema, LocalSchemaTable source, LocalSchemaForeignKey fk)
        {
            if (subschema == null || source == null || fk == null)
                return false;
            LocalSchemaTable target = FindTable(file, fk.TargetTable);
            if (target == null)
                return false;
            AddTable(file, subschema, source);
            AddTable(file, subschema, target);
            AddColumns(subschema, source, fk.SourceColumns);
            AddColumns(subschema, target, fk.TargetColumns);
            return true;
        }

        /// <summary>
        /// The written relations that are not complete (no target or no pairs of columns): they are not
        /// saved. Each item is the source table and the relation.
        /// </summary>
        public static List<KeyValuePair<LocalSchemaTable, LocalSchemaForeignKey>> IncompleteWrittenRelations(LocalSchemaFile file)
        {
            var result = new List<KeyValuePair<LocalSchemaTable, LocalSchemaForeignKey>>();
            if (file == null)
                return result;
            foreach (LocalSchemaTable t in file.Tables)
                foreach (LocalSchemaForeignKey fk in t.ForeignKeys)
                    if (IsWritten(fk) && !IsComplete(fk))
                        result.Add(new KeyValuePair<LocalSchemaTable, LocalSchemaForeignKey>(t, fk));
            return result;
        }

        /// <summary>
        /// A name for the SQL of the dialect: as it is when it needs no quotes (a plain identifier in the case
        /// the database folds to), else quoted as the dialect quotes.
        /// </summary>
        public static string QuoteIdentifier(string dialect, string name)
        {
            string d = LocalSchemaStore.CloudDialect(dialect);
            name = name ?? "";
            bool plain = PlainIdentifier.IsMatch(name);
            if (d.StartsWith("Firebird", StringComparison.Ordinal) || d == "Oracle")
            {
                // Firebird dialect 1 has no quoted identifiers at all
                if ((plain && name == name.ToUpperInvariant()) || d == "Firebird2Dialect1")
                    return name;
                return "\"" + name.Replace("\"", "\"\"") + "\"";
            }
            if (d == "PostgreSQL")
                return plain && name == name.ToLowerInvariant() ? name : "\"" + name.Replace("\"", "\"\"") + "\"";
            if (plain)
                return name;
            if (d == "SQLServer")
                return "[" + name.Replace("]", "]]") + "]";
            if (d == "MySQL")
                return "`" + name.Replace("`", "``") + "`";
            return "\"" + name.Replace("\"", "\"\"") + "\"";
        }

        /// <summary>
        /// The SQL that reads the first <paramref name="rows"/> rows of a table in a dialect;
        /// <paramref name="limited"/> is false when the dialect is not known and the reader must stop by itself.
        /// </summary>
        public static string PreviewSql(string dialect, string table, int rows, out bool limited)
        {
            string d = LocalSchemaStore.CloudDialect(dialect);
            string name = QuoteIdentifier(d, table);
            string count = rows.ToString(CultureInfo.InvariantCulture);
            limited = true;
            if (d.StartsWith("Firebird", StringComparison.Ordinal))
                return "SELECT FIRST " + count + " * FROM " + name;
            switch (d)
            {
                case "SQLServer":
                    return "SELECT TOP " + count + " * FROM " + name;
                case "PostgreSQL":
                case "MySQL":
                case "SQLite":
                    return "SELECT * FROM " + name + " LIMIT " + count;
                case "Oracle":
                    return "SELECT * FROM " + name + " WHERE ROWNUM <= " + count;
            }
            limited = false;
            return "SELECT * FROM " + name;
        }

        /// <summary>
        /// Reads the first <paramref name="rows"/> rows of a table through a new connection (opened and closed
        /// here), as text to show: every value converted, a binary one as its size.
        /// </summary>
        public static DataTable ReadPreview(Func<DbConnection> createConnection, string dialect, string table, int rows)
        {
            if (createConnection == null)
                throw new InvalidOperationException("No connection to read " + table);
            bool limited;
            string sql = PreviewSql(dialect, table, rows, out limited);
            var result = new DataTable(table ?? "");
            result.Locale = CultureInfo.CurrentCulture;
            using (DbConnection connection = createConnection())
            {
                if (connection.State != ConnectionState.Open)
                    connection.Open();
                using (DbCommand command = connection.CreateCommand())
                {
                    command.CommandText = sql;
                    command.CommandTimeout = 30;
                    using (DbDataReader reader = command.ExecuteReader())
                    {
                        for (int i = 0; i < reader.FieldCount; i++)
                        {
                            string name = reader.GetName(i);
                            if (string.IsNullOrEmpty(name))
                                name = "#" + (i + 1).ToString(CultureInfo.InvariantCulture);
                            string unique = name;
                            for (int n = 2; result.Columns.Contains(unique); n++)
                                unique = name + " (" + n.ToString(CultureInfo.InvariantCulture) + ")";
                            result.Columns.Add(unique, typeof(string));
                        }
                        while (result.Rows.Count < rows && reader.Read())
                        {
                            var values = new object[reader.FieldCount];
                            for (int i = 0; i < reader.FieldCount; i++)
                                values[i] = DisplayValue(reader, i);
                            result.Rows.Add(values);
                        }
                        // Without a limit in the SQL the rest of the table is not read
                        if (!limited)
                        {
                            try { command.Cancel(); } catch { }
                        }
                    }
                }
            }
            return result;
        }

        private static string DisplayValue(DbDataReader reader, int ordinal)
        {
            object value;
            try
            {
                value = reader.GetValue(ordinal);
            }
            catch (Exception ex)
            {
                return "(" + ex.Message + ")";
            }
            if (value == null || value is DBNull)
                return "";
            byte[] bytes = value as byte[];
            if (bytes != null)
                return "(" + bytes.Length.ToString("N0", CultureInfo.CurrentCulture) + " " + Reportman.Drawing.Translator.TranslateStr(1176) + ")";
            string text = Convert.ToString(value, CultureInfo.CurrentCulture) ?? "";
            return text.Length > 200 ? text.Substring(0, 200) + "…" : text;
        }
    }
}
