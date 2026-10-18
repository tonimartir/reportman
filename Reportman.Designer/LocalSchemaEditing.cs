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
using System.IO;
using System.Text;
using System.Text.Encodings.Web;
using System.Text.Json;
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
            if (subschema == null)
            {
                result.AddRange(file.Tables);
                return result;
            }
            // A large catalog has a hundred thousand tables: the names of the subschema are looked up, not scanned
            HashSet<string> names = NameSet(subschema.Tables);
            foreach (LocalSchemaTable t in file.Tables)
                if (names.Contains(t.Name))
                    result.Add(t);
            return result;
        }

        /// <summary>The names, ignoring case, to look up.</summary>
        public static HashSet<string> NameSet(IEnumerable<string> names)
        {
            var result = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
            if (names != null)
                foreach (string n in names)
                    if (!string.IsNullOrEmpty(n))
                        result.Add(n);
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
            HashSet<string> chosen = NameSet(subschema.Tables);
            var catalog = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
            foreach (LocalSchemaTable t in file.Tables)
            {
                catalog.Add(t.Name);
                if (t == table || chosen.Contains(t.Name))
                    ordered.Add(t.Name);
            }
            // Names the catalog does not have any more stay, at the end: nothing is lost by adding.
            foreach (string name in subschema.Tables)
                if (!catalog.Contains(name) && !ContainsName(ordered, name))
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

        /// <summary>
        /// A copy of a subschema with another name: the same tables, columns, description and relations left out.
        /// </summary>
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
            if (source.ExcludedRelations != null)
            {
                copy.ExcludedRelations = new List<LocalRelationRef>();
                foreach (LocalRelationRef r in source.ExcludedRelations)
                {
                    if (r == null)
                        continue;
                    copy.ExcludedRelations.Add(new LocalRelationRef
                    {
                        SourceTable = r.SourceTable,
                        SourceColumns = new List<string>(r.SourceColumns ?? new List<string>()),
                        TargetTable = r.TargetTable,
                        TargetColumns = new List<string>(r.TargetColumns ?? new List<string>()),
                        Extra = r.Extra != null ? new Dictionary<string, System.Text.Json.JsonElement>(r.Extra) : null
                    });
                }
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
                // All the tables send every column (ColumnsOf), counted without copying them
                int columns = subschema == null ? t.Columns.Count : LocalSchemaStore.ColumnsOf(subschema, t).Count;
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
        /// decides: its two tables and the columns of both ends travel, and it is not left out of the subschema
        /// or of every one (<see cref="LocalSchemaStore.IsExcluded"/>). With all the tables, every relation not
        /// left out of every subschema.
        /// </summary>
        public static bool Travels(LocalSchemaFile file, LocalSubschema subschema, LocalSchemaTable source, LocalSchemaForeignKey fk)
        {
            if (source != null && LocalSchemaStore.IsExcluded(file, subschema, source.Name, fk))
                return false;
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
        /// Removes a relation people wrote from the dictionary and, when its table has no other one with the same
        /// ends, the entries that left it out of the subschemas and of every one: a relation written again later
        /// with those ends is not left out by them.
        /// </summary>
        public static void RemoveRelation(LocalSchemaFile file, LocalSchemaTable source, LocalSchemaForeignKey fk)
        {
            if (source == null || fk == null)
                return;
            source.ForeignKeys.Remove(fk);
            if (file == null || source.ForeignKeys.Exists(other => LocalSchemaStore.SameRelation(other, fk)))
                return;
            foreach (LocalSubschema s in file.Schemas)
                LocalSchemaStore.Unexclude(file, s, source.Name, fk);
            LocalSchemaStore.Unexclude(file, null, source.Name, fk);
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

        // ===== Export and import, in the format of the Reportman AI web (docs/esquemas-locales-pantalla-plan.md, §5.6) =====

        /// <summary>The name an export carries: the subschema's, or the connection alias for all the tables (null).</summary>
        public static string ExportName(LocalSchemaFile file, LocalSubschema subschema)
        {
            if (subschema != null)
                return subschema.Name ?? "";
            return file != null ? file.Alias ?? "" : "";
        }

        /// <summary>
        /// The file name an export proposes, as the web's: <c>&lt;name&gt;_Config.json</c>, with the characters a
        /// file name cannot have changed to '_'.
        /// </summary>
        public static string ExportFileName(string name)
        {
            string n = (name ?? "").Trim();
            if (n.Length == 0)
                n = "schema";
            var sb = new StringBuilder(n.Length + 12);
            foreach (char c in n)
                sb.Append(Array.IndexOf(Path.GetInvalidFileNameChars(), c) >= 0 ? '_' : c);
            return sb.ToString() + "_Config.json";
        }

        /// <summary>
        /// A subschema (all the tables for null) as the Reportman AI web exports and imports a schema:
        /// <c>{ "name", "schemaTables" }</c>, camelCase, indented with two spaces. The tables are what travels,
        /// exactly as the copilot sends them (<see cref="LocalSchemaStore.BuildInlineConfig"/>), but for the
        /// relations written here that are not complete yet, which are not saved either.
        /// </summary>
        public static string ExportJson(LocalSchemaFile file, LocalSubschema subschema)
        {
            if (file == null)
                throw new ArgumentNullException("file");
            Dictionary<string, object> inline = LocalSchemaStore.BuildInlineConfig(file, subschema != null ? subschema.Name : "");
            var tables = (List<object>)inline["schemaTables"];
            foreach (object table in tables)
            {
                var foreignKeys = ((Dictionary<string, object>)table)["foreignKeys"] as List<object>;
                if (foreignKeys != null)
                    foreignKeys.RemoveAll(IsIncompleteExport);
            }
            var root = new Dictionary<string, object>
            {
                { "name", ExportName(file, subschema) },
                { "schemaTables", tables }
            };
            // Written as JSON.stringify(exported, null, 2) writes it: the descriptions readable, LF line ends
            var options = new JsonSerializerOptions { WriteIndented = true, Encoder = JavaScriptEncoder.UnsafeRelaxedJsonEscaping };
            return JsonSerializer.Serialize(root, options).Replace("\r\n", "\n");
        }

        private static bool IsIncompleteExport(object item)
        {
            var fk = item as Dictionary<string, object>;
            if (fk == null)
                return true;
            object target, source, targets;
            fk.TryGetValue("targetTable", out target);
            fk.TryGetValue("sourceColumns", out source);
            fk.TryGetValue("targetColumns", out targets);
            var sourceColumns = source as List<string>;
            var targetColumns = targets as List<string>;
            return string.IsNullOrWhiteSpace(target as string) || sourceColumns == null || targetColumns == null ||
                sourceColumns.Count == 0 || sourceColumns.Count != targetColumns.Count ||
                sourceColumns.Exists(string.IsNullOrEmpty) || targetColumns.Exists(string.IsNullOrEmpty);
        }

        /// <summary>
        /// The name of an imported schema whose file says none: the file name without its extension and without
        /// the <c>_Config</c> an export adds.
        /// </summary>
        public static string NameFromFileName(string fileName)
        {
            string name = "";
            try
            {
                name = Path.GetFileNameWithoutExtension(fileName ?? "") ?? "";
            }
            catch (ArgumentException)
            {
                // Not a path: no name from it
            }
            if (name.EndsWith("_Config", StringComparison.OrdinalIgnoreCase))
                name = name.Substring(0, name.Length - "_Config".Length);
            return name.Trim();
        }

        /// <summary>
        /// <paramref name="name"/>, or numbered («name 2», «name 3»...) when a subschema or one of
        /// <paramref name="reservedNames"/> already has it (ignoring case).
        /// </summary>
        public static string UniqueSubschemaName(LocalSchemaFile file, string name, IEnumerable<string> reservedNames)
        {
            string result = name ?? "";
            for (int n = 2; ContainsName(reservedNames, result) ||
                (file != null && file.Schemas.Exists(s => string.Equals(s.Name, result, StringComparison.OrdinalIgnoreCase))); n++)
                result = (name ?? "") + " " + n.ToString(CultureInfo.InvariantCulture);
            return result;
        }

        /// <summary>
        /// Imports a schema the Reportman AI web exported (or a local screen: the same format; the PascalCase and
        /// numeric types of the Desktop are read too) as a new subschema of <paramref name="file"/>, added at the
        /// end, named as the file says (numbered when taken; without a name, after <paramref name="fileName"/>):
        /// <list type="bullet">
        /// <item>the tables of the file the catalog has (qualified names and templates found as
        /// <see cref="ResolveTable(LocalSchemaFile, string, IDictionary{string, string})"/> finds them, the first value of
        /// each placeholder), as the catalog spells them, each with the columns of the
        /// file the catalog has as its explicit list (its primary key when none is left); the types are the catalog's;</item>
        /// <item>the descriptions and allowed values of the file that are not empty go to the dictionary, shared by
        /// every subschema: what is imported wins;</item>
        /// <item>each relation of the file whose ends are in the catalog: the one the dictionary already has (the same
        /// target over the same columns) takes the file's description when it has one; a new one is added as written
        /// here (no constraint name);</item>
        /// <item>what the database does not have (tables, or columns of a table it has) is left out and listed.</item>
        /// </list>
        /// Null, and nothing changed, when the text is not a schema: not JSON, or without <c>schemaTables</c>.
        /// </summary>
        /// <param name="file">The local schema file.</param>
        /// <param name="json">The text of the imported file.</param>
        /// <param name="fileName">The path or name of the imported file, for the name when it has none.</param>
        /// <param name="reservedNames">Names a subschema cannot take (all the tables), or null.</param>
        public static LocalSchemaImportResult Import(LocalSchemaFile file, string json, string fileName, IEnumerable<string> reservedNames)
        {
            return Import(file, json, fileName, reservedNames, "");
        }

        /// <summary>
        /// Imports a schema as <see cref="Import(LocalSchemaFile, string, string, IEnumerable{string})"/> does, named
        /// <paramref name="subschemaName"/> when it is not empty (numbered when taken) instead of as the text says: a
        /// schema of the Reportman AI library is named as the library calls it, while its text (a database
        /// configuration) says the name of the database it was written for.
        /// </summary>
        /// <param name="file">The local schema file.</param>
        /// <param name="json">The text of the imported schema.</param>
        /// <param name="fileName">The path or name of the imported file, for the name when there is none.</param>
        /// <param name="reservedNames">Names a subschema cannot take (all the tables), or null.</param>
        /// <param name="subschemaName">The name of the new subschema; empty for the one the text says.</param>
        public static LocalSchemaImportResult Import(LocalSchemaFile file, string json, string fileName, IEnumerable<string> reservedNames,
            string subschemaName)
        {
            return Import(file, json, fileName, reservedNames, subschemaName, null);
        }

        /// <summary>
        /// Imports a schema as <see cref="Import(LocalSchemaFile, string, string, IEnumerable{string}, string)"/> does,
        /// with the values of the placeholders that build the names of its tables (<c>{COMPANY_NAME}</c> of
        /// <c>[{COMPANY_NAME}$Customer]</c>, as the library writes them for the AI): a placeholder without a value takes
        /// the first one <see cref="LibraryPlaceholders"/> finds, and every table and every target of a relation is the
        /// one <see cref="ResolveTable(LocalSchemaFile, string, IDictionary{string, string})"/> finds with them. The
        /// descriptions are imported as they are written, placeholders and all. The result says the values used.
        /// </summary>
        /// <param name="file">The local schema file.</param>
        /// <param name="json">The text of the imported schema.</param>
        /// <param name="fileName">The path or name of the imported file, for the name when there is none.</param>
        /// <param name="reservedNames">Names a subschema cannot take (all the tables), or null.</param>
        /// <param name="subschemaName">The name of the new subschema; empty for the one the text says.</param>
        /// <param name="templateValues">The value of each placeholder by its name without braces (ignoring case), or null.</param>
        public static LocalSchemaImportResult Import(LocalSchemaFile file, string json, string fileName, IEnumerable<string> reservedNames,
            string subschemaName, IDictionary<string, string> templateValues)
        {
            if (file == null)
                throw new ArgumentNullException("file");
            JsonDocument document = ParseSchemaJson(json);
            if (document == null)
                return null;
            using (document)
            {
                JsonElement root = document.RootElement;
                JsonElement schemaTables;
                if (!TryJsonProperty(root, "schemaTables", out schemaTables) || schemaTables.ValueKind != JsonValueKind.Array)
                    return null;
                // The placeholders the user did not choose take the value most of the tables have
                List<LocalSchemaPlaceholder> placeholders;
                Dictionary<string, string> filled = FilledValues(file, schemaTables, templateValues, out placeholders);
                var used = new List<KeyValuePair<string, string>>();
                string name = (subschemaName ?? "").Trim();
                if (name.Length == 0)
                    name = JsonText(root, "name").Trim();
                if (name.Length == 0)
                    name = NameFromFileName(fileName);
                if (name.Length == 0)
                    name = file.Alias ?? "";
                var result = new LocalSchemaImportResult();
                result.Subschema = new LocalSubschema { Name = UniqueSubschemaName(file, name, reservedNames) };
                // The columns of each table, gathered first: a table may come more than once
                var chosen = new Dictionary<LocalSchemaTable, List<string>>();
                var order = new List<LocalSchemaTable>();
                foreach (JsonElement item in schemaTables.EnumerateArray())
                {
                    string tableName = JsonText(item, "name").Trim();
                    if (tableName.Length == 0)
                        continue;
                    LocalSchemaTable table = ResolveTable(file, tableName, filled, used);
                    if (table == null)
                    {
                        // Said as the schema names it, template and all
                        AddSkipped(result.Skipped, tableName);
                        continue;
                    }
                    List<string> columns;
                    if (!chosen.TryGetValue(table, out columns))
                    {
                        columns = new List<string>();
                        chosen.Add(table, columns);
                        order.Add(table);
                    }
                    string context = JsonText(item, "context");
                    if (!string.IsNullOrWhiteSpace(context))
                        table.Context = context;
                    foreach (JsonElement c in JsonArray(item, "columns"))
                    {
                        string columnName = JsonText(c, "name").Trim();
                        if (columnName.Length == 0)
                            continue;
                        LocalSchemaColumn column = FindColumn(table, columnName);
                        if (column == null)
                        {
                            AddSkipped(result.Skipped, table.Name + "." + columnName);
                            continue;
                        }
                        if (!ContainsName(columns, column.Name))
                            columns.Add(column.Name);
                        string columnContext = JsonText(c, "context");
                        if (!string.IsNullOrWhiteSpace(columnContext))
                            column.Context = columnContext;
                        List<LocalAllowedValue> values = JsonAllowedValues(c);
                        if (values != null)
                            column.AllowedValues = values;
                    }
                    foreach (JsonElement fk in JsonArray(item, "foreignKeys"))
                        ImportRelation(file, table, fk, filled);
                }
                // None of its tables is in this database: it was written for another one, and an empty
                // subschema would be of no use. Nothing is created (and, with no table found, nothing was
                // written to the dictionary either)
                if (order.Count == 0)
                {
                    result.Subschema = null;
                    result.Name = name;
                    return result;
                }
                foreach (LocalSchemaTable table in order)
                {
                    AddTable(file, result.Subschema, table);
                    List<string> columns = chosen[table];
                    SetChosenColumns(result.Subschema, table, columns.Count > 0 ? columns : PrimaryKey(table));
                }
                file.Schemas.Add(result.Subschema);
                // The values used, in the order the placeholders come in the schema
                foreach (LocalSchemaPlaceholder placeholder in placeholders)
                {
                    string value = FindValue(used, placeholder.Name);
                    if (value != null)
                        AddValue(result.TemplateValues, placeholder.Name, value);
                }
                foreach (KeyValuePair<string, string> value in used)
                    AddValue(result.TemplateValues, value.Key, value.Value);
                return result;
            }
        }

        /// <summary>
        /// The value of each placeholder of the names of the tables for an import: the ones given, and for the others the
        /// value most of the tables have (the first of <see cref="LibraryPlaceholders"/>).
        /// </summary>
        private static Dictionary<string, string> FilledValues(LocalSchemaFile file, JsonElement schemaTables,
            IDictionary<string, string> templateValues, out List<LocalSchemaPlaceholder> placeholders)
        {
            placeholders = Placeholders(file, TableNames(schemaTables));
            var filled = new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase);
            if (templateValues != null)
                foreach (KeyValuePair<string, string> value in templateValues)
                    if (!string.IsNullOrWhiteSpace(value.Key) && !string.IsNullOrEmpty(value.Value))
                        filled[value.Key.Trim()] = value.Value;
            foreach (LocalSchemaPlaceholder placeholder in placeholders)
                if (!filled.ContainsKey(placeholder.Name))
                    filled[placeholder.Name] = placeholder.Values[0];
            return filled;
        }

        /// <summary>
        /// The tables of the catalog an import of <paramref name="json"/> with <paramref name="templateValues"/> resolves, as
        /// <see cref="Import(LocalSchemaFile, string, string, IEnumerable{string}, string, IDictionary{string, string})"/>
        /// finds them: the tables of the schema and the targets of their relations, as the file spells them, each once, in
        /// the order they come. Nothing is changed. The screen reads their columns before importing when the catalog is
        /// large: the import chooses among them. None when the text is not a schema.
        /// </summary>
        /// <param name="file">The local schema file.</param>
        /// <param name="json">The text of the schema to import.</param>
        /// <param name="templateValues">The value of each placeholder by its name without braces (ignoring case), or null.</param>
        public static List<string> ImportTables(LocalSchemaFile file, string json, IDictionary<string, string> templateValues)
        {
            if (file == null)
                throw new ArgumentNullException("file");
            var result = new List<string>();
            JsonDocument document = ParseSchemaJson(json);
            if (document == null)
                return result;
            using (document)
            {
                JsonElement schemaTables;
                if (!TryJsonProperty(document.RootElement, "schemaTables", out schemaTables) || schemaTables.ValueKind != JsonValueKind.Array)
                    return result;
                List<LocalSchemaPlaceholder> placeholders;
                Dictionary<string, string> filled = FilledValues(file, schemaTables, templateValues, out placeholders);
                foreach (JsonElement item in schemaTables.EnumerateArray())
                {
                    LocalSchemaTable table = ResolveTable(file, JsonText(item, "name"), filled);
                    if (table == null)
                        continue;
                    if (!ContainsName(result, table.Name))
                        result.Add(table.Name);
                    foreach (JsonElement fk in JsonArray(item, "foreignKeys"))
                    {
                        LocalSchemaTable target = ResolveTable(file, JsonText(fk, "targetTable"), filled);
                        if (target != null && !ContainsName(result, target.Name))
                            result.Add(target.Name);
                    }
                }
            }
            return result;
        }

        /// <summary>
        /// True when an item matches the words of <paramref name="filter"/> in its name or in its description, as every
        /// filter of the local schema screen does (<see cref="LocalSchemaFilter"/>).
        /// </summary>
        public static bool MatchesWords(string name, string description, string filter)
        {
            return new LocalSchemaFilter(filter).Matches(name, description);
        }

        /// <summary>
        /// A relation of an imported table into the dictionary, as the catalog spells it, when its ends are there:
        /// the same one the dictionary has takes its description (when it has one); a new one is written here. Its
        /// target is found as the tables of the schema are (<see cref="ResolveTable(LocalSchemaFile, string, IDictionary{string, string})"/>).
        /// </summary>
        private static void ImportRelation(LocalSchemaFile file, LocalSchemaTable source, JsonElement item, IDictionary<string, string> values)
        {
            LocalSchemaTable target = ResolveTable(file, JsonText(item, "targetTable"), values);
            if (target == null)
                return;
            List<string> sourceColumns = SpelledColumns(source, JsonNames(item, "sourceColumns"));
            List<string> targetColumns = SpelledColumns(target, JsonNames(item, "targetColumns"));
            if (sourceColumns == null || targetColumns == null || sourceColumns.Count == 0 || sourceColumns.Count != targetColumns.Count)
                return;
            var relation = new LocalSchemaForeignKey
            {
                ConstraintName = "",
                TargetTable = target.Name,
                SourceColumns = sourceColumns,
                TargetColumns = targetColumns,
                RelationshipContext = JsonText(item, "relationshipContext")
            };
            LocalSchemaForeignKey same = source.ForeignKeys.Find(fk => LocalSchemaStore.SameRelation(fk, relation));
            if (same == null)
                source.ForeignKeys.Add(relation);
            else if (!string.IsNullOrWhiteSpace(relation.RelationshipContext))
                same.RelationshipContext = relation.RelationshipContext;
        }

        /// <summary>The names as the table spells them; null when one is not a column of it.</summary>
        private static List<string> SpelledColumns(LocalSchemaTable table, List<string> names)
        {
            var result = new List<string>();
            foreach (string name in names)
            {
                LocalSchemaColumn column = FindColumn(table, name);
                if (column == null)
                    return null;
                result.Add(column.Name);
            }
            return result;
        }

        private static void AddSkipped(List<string> skipped, string name)
        {
            if (!ContainsName(skipped, name))
                skipped.Add(name);
        }

        /// <summary>
        /// A short list of names for a message: all of them when they are <paramref name="max"/> or fewer, else the
        /// first ones, «…» and how many more.
        /// </summary>
        public static string ShortList(IList<string> names, int max)
        {
            if (names == null || names.Count == 0)
                return "";
            if (max < 1)
                max = 1;
            if (names.Count <= max)
                return string.Join(", ", names);
            var shown = new List<string>();
            for (int i = 0; i < max; i++)
                shown.Add(names[i]);
            return string.Join(", ", shown) + ", … (+" + (names.Count - max).ToString(CultureInfo.CurrentCulture) + ")";
        }

        // ===== The names of the tables of an imported schema: qualified, or templates for the AI =====
        // The schemas of the Reportman AI library name their tables for the AI of the cloud: «[{COMPANY_NAME}$Customer]»
        // for a Dynamics BC, where each company has its own set («CRONUS España S_A_$Customer»), and
        // «[{DB_NAME}].dbo.OINV» for a SAP Business One, whose company database just has «OINV». The Delphi designer
        // (rplocalschemas.pas) and the web find them with the same rules, so the three import the same.

        /// <summary>A piece of a table name: a literal text, or a placeholder <c>{NAME}</c> (its name, without braces).</summary>
        private struct TemplatePiece
        {
            public TemplatePiece(string text, bool isPlaceholder)
            {
                Text = text;
                IsPlaceholder = isPlaceholder;
            }

            public readonly string Text;
            public readonly bool IsPlaceholder;
        }

        /// <summary>
        /// The table of the catalog a table name of an imported schema means, null when there is none:
        /// <list type="number">
        /// <item>the name as the catalog has it (ignoring case);</item>
        /// <item>else its last part, the qualifiers before a dot (outside brackets and quotes) dropped and one pair of
        /// enclosing brackets or quotes removed: <c>OINV</c> of <c>[{DB_NAME}].dbo.OINV</c>, as the catalog has it;</item>
        /// <item>else, when that part has placeholders (<c>{COMPANY_NAME}$Customer</c>): with a value in
        /// <paramref name="values"/> for every one of them, the table named as they make it; without some, the first
        /// table of the catalog (in its order) the part matches with the values there are, each placeholder taking one
        /// or more characters (the fewest first).</item>
        /// </list>
        /// </summary>
        /// <param name="file">The local schema file.</param>
        /// <param name="name">The name of the table in the imported schema.</param>
        /// <param name="values">The value of each placeholder by its name without braces (ignoring case), or null.</param>
        public static LocalSchemaTable ResolveTable(LocalSchemaFile file, string name, IDictionary<string, string> values)
        {
            return ResolveTable(file, name, values, null);
        }

        /// <summary>
        /// <see cref="ResolveTable(LocalSchemaFile, string, IDictionary{string, string})"/>, adding to
        /// <paramref name="used"/> (when it is not null) the value each placeholder had when a template found the table.
        /// </summary>
        private static LocalSchemaTable ResolveTable(LocalSchemaFile file, string name, IDictionary<string, string> values,
            List<KeyValuePair<string, string>> used)
        {
            if (file == null)
                return null;
            string trimmed = (name ?? "").Trim();
            if (trimmed.Length == 0)
                return null;
            LocalSchemaTable table = FindTable(file, trimmed);
            if (table != null)
                return table;
            string part = LastNamePart(trimmed);
            List<TemplatePiece> pieces = ParseTemplate(part);
            if (!HasPlaceholders(pieces))
                return FindTable(file, part);
            // The values there are become text: the rest of the placeholders are matched against the catalog
            var template = new List<TemplatePiece>();
            var given = new List<KeyValuePair<string, string>>();
            bool complete = true;
            foreach (TemplatePiece piece in pieces)
            {
                string value = piece.IsPlaceholder ? TemplateValue(values, piece.Text) : null;
                if (value != null)
                {
                    template.Add(new TemplatePiece(value, false));
                    AddValue(given, piece.Text, value);
                }
                else
                {
                    template.Add(piece);
                    complete = complete && !piece.IsPlaceholder;
                }
            }
            if (complete)
                table = FindTable(file, TemplateText(template));
            else
            {
                foreach (LocalSchemaTable t in file.Tables)
                {
                    var taken = new string[template.Count];
                    if (!MatchTemplate(template, 0, t.Name, 0, taken))
                        continue;
                    table = t;
                    for (int i = 0; i < template.Count; i++)
                        if (template[i].IsPlaceholder)
                            AddValue(given, template[i].Text, taken[i]);
                    break;
                }
            }
            if (table != null && used != null)
                foreach (KeyValuePair<string, string> value in given)
                    AddValue(used, value.Key, value.Value);
            return table;
        }

        /// <summary>
        /// The placeholders that build the names of the tables of a schema and, for each, the values this database has
        /// for it: the texts it takes in the names of the catalog that the tables match (only the tables whose name is
        /// not in the catalog as it is). The values come first when they find more tables of the schema, then in the
        /// order they are found (the tables of the schema in order and, for each, the catalog's); the placeholders in the
        /// order they come in the schema. A placeholder no table of the catalog gives a value to is not listed: its
        /// tables are not in this database. None when the text is not a schema.
        /// </summary>
        /// <param name="file">The local schema file.</param>
        /// <param name="json">The text of the schema, as <see cref="Import(LocalSchemaFile, string, string, IEnumerable{string}, string, IDictionary{string, string})"/> reads it.</param>
        public static List<LocalSchemaPlaceholder> LibraryPlaceholders(LocalSchemaFile file, string json)
        {
            if (file == null)
                throw new ArgumentNullException("file");
            List<string> names = SchemaTableNames(json);
            return names != null ? Placeholders(file, names) : new List<LocalSchemaPlaceholder>();
        }

        /// <summary>A value of a placeholder while they are gathered: the tables of the schema it finds, and when it came.</summary>
        private sealed class PlaceholderValue
        {
            public string Value = "";
            public readonly List<string> Tables = new List<string>();
            public int First;
        }

        private static List<LocalSchemaPlaceholder> Placeholders(LocalSchemaFile file, List<string> names)
        {
            var order = new List<string>();
            var found = new Dictionary<string, List<PlaceholderValue>>(StringComparer.OrdinalIgnoreCase);
            int occurrence = 0;
            foreach (string n in names)
            {
                string name = (n ?? "").Trim();
                if (name.Length == 0 || FindTable(file, name) != null)
                    continue;
                // A last part without placeholders is found, or not, as it is
                List<TemplatePiece> pieces = ParseTemplate(LastNamePart(name));
                if (!HasPlaceholders(pieces))
                    continue;
                foreach (TemplatePiece piece in pieces)
                {
                    if (piece.IsPlaceholder && !found.ContainsKey(piece.Text))
                    {
                        found.Add(piece.Text, new List<PlaceholderValue>());
                        order.Add(piece.Text);
                    }
                }
                foreach (LocalSchemaTable t in file.Tables)
                {
                    var taken = new string[pieces.Count];
                    if (!MatchTemplate(pieces, 0, t.Name, 0, taken))
                        continue;
                    for (int i = 0; i < pieces.Count; i++)
                    {
                        if (!pieces[i].IsPlaceholder)
                            continue;
                        List<PlaceholderValue> list = found[pieces[i].Text];
                        string text = taken[i];
                        PlaceholderValue value = list.Find(v => string.Equals(v.Value, text, StringComparison.OrdinalIgnoreCase));
                        if (value == null)
                        {
                            value = new PlaceholderValue { Value = text, First = occurrence++ };
                            list.Add(value);
                        }
                        if (!ContainsName(value.Tables, name))
                            value.Tables.Add(name);
                    }
                }
            }
            var result = new List<LocalSchemaPlaceholder>();
            foreach (string name in order)
            {
                List<PlaceholderValue> list = found[name];
                if (list.Count == 0)
                    continue;
                list.Sort((a, b) => a.Tables.Count != b.Tables.Count ? b.Tables.Count.CompareTo(a.Tables.Count) : a.First.CompareTo(b.First));
                var placeholder = new LocalSchemaPlaceholder { Name = name };
                foreach (PlaceholderValue value in list)
                    placeholder.Values.Add(value.Value);
                result.Add(placeholder);
            }
            return result;
        }

        /// <summary>
        /// How much of a schema of the library this database has: its tables (different names, ignoring case) and how
        /// many of them <see cref="ResolveTable(LocalSchemaFile, string, IDictionary{string, string})"/> finds without
        /// values (a template, when it matches some table). Null when the text is not a schema.
        /// </summary>
        /// <param name="file">The local schema file.</param>
        /// <param name="json">The text of the schema.</param>
        public static LocalSchemaCoverage LibraryCoverage(LocalSchemaFile file, string json)
        {
            if (file == null)
                throw new ArgumentNullException("file");
            List<string> names = SchemaTableNames(json);
            if (names == null)
                return null;
            var tables = new List<string>();
            int matched = 0;
            foreach (string n in names)
            {
                string name = (n ?? "").Trim();
                if (name.Length == 0 || ContainsName(tables, name))
                    continue;
                tables.Add(name);
                if (ResolveTable(file, name, null) != null)
                    matched++;
            }
            return new LocalSchemaCoverage(matched, tables.Count);
        }

        /// <summary>
        /// The schema of the library written for this database: of the ones whose <see cref="LocalSchemaLibrarySchema.Coverage"/>
        /// is <see cref="LocalSchemaCoverage.Detected"/>, the one with more tables here, then the one with the larger part
        /// of its tables here, then the first in the library's order. Null when none is.
        /// </summary>
        /// <param name="categories">The categories of the library, the coverage of their schemas known.</param>
        /// <param name="category">The category of the schema found, or null.</param>
        public static LocalSchemaLibrarySchema BestLibrarySchema(IList<LocalSchemaLibraryCategory> categories, out LocalSchemaLibraryCategory category)
        {
            category = null;
            LocalSchemaLibrarySchema best = null;
            if (categories == null)
                return null;
            foreach (LocalSchemaLibraryCategory c in categories)
            {
                foreach (LocalSchemaLibrarySchema schema in c.Schemas)
                {
                    LocalSchemaCoverage coverage = schema.Coverage;
                    if (coverage == null || !coverage.Detected)
                        continue;
                    if (best != null)
                    {
                        // matched/total compared without dividing: both totals are positive
                        LocalSchemaCoverage other = best.Coverage;
                        if (coverage.Matched < other.Matched || (coverage.Matched == other.Matched &&
                            (long)coverage.Matched * other.Total <= (long)other.Matched * coverage.Total))
                            continue;
                    }
                    best = schema;
                    category = c;
                }
            }
            return best;
        }

        /// <summary>The values of the placeholders for a message: «{COMPANY_NAME} = CRONUS España S_A_», joined by «, ».</summary>
        /// <param name="values">The placeholders (without braces) and their values.</param>
        public static string TemplateValuesText(IEnumerable<KeyValuePair<string, string>> values)
        {
            var parts = new List<string>();
            if (values != null)
                foreach (KeyValuePair<string, string> value in values)
                    parts.Add("{" + value.Key + "} = " + value.Value);
            return string.Join(", ", parts);
        }

        /// <summary>
        /// The last part of a table name: what follows its last dot outside brackets and quotes, trimmed, without one
        /// pair of enclosing brackets or quotes.
        /// </summary>
        private static string LastNamePart(string name)
        {
            int start = 0;
            char closing = '\0';
            for (int i = 0; i < name.Length; i++)
            {
                char c = name[i];
                if (closing != '\0')
                {
                    if (c == closing)
                        closing = '\0';
                }
                else if (c == '[')
                    closing = ']';
                else if (c == '"')
                    closing = '"';
                else if (c == '.')
                    start = i + 1;
            }
            string part = name.Substring(start).Trim();
            if (part.Length >= 2 && ((part[0] == '[' && part[part.Length - 1] == ']') || (part[0] == '"' && part[part.Length - 1] == '"')))
                part = part.Substring(1, part.Length - 2).Trim();
            return part;
        }

        /// <summary>A name split in literal texts and placeholders <c>{NAME}</c>, NAME one or more of A-Z, a-z, 0-9 and _.</summary>
        private static List<TemplatePiece> ParseTemplate(string text)
        {
            var result = new List<TemplatePiece>();
            var literal = new StringBuilder();
            int i = 0;
            while (i < text.Length)
            {
                if (text[i] == '{')
                {
                    int end = i + 1;
                    while (end < text.Length && IsPlaceholderChar(text[end]))
                        end++;
                    if (end > i + 1 && end < text.Length && text[end] == '}')
                    {
                        if (literal.Length > 0)
                        {
                            result.Add(new TemplatePiece(literal.ToString(), false));
                            literal.Clear();
                        }
                        result.Add(new TemplatePiece(text.Substring(i + 1, end - i - 1), true));
                        i = end + 1;
                        continue;
                    }
                }
                literal.Append(text[i]);
                i++;
            }
            if (literal.Length > 0)
                result.Add(new TemplatePiece(literal.ToString(), false));
            return result;
        }

        private static bool IsPlaceholderChar(char c)
        {
            return (c >= 'A' && c <= 'Z') || (c >= 'a' && c <= 'z') || (c >= '0' && c <= '9') || c == '_';
        }

        private static bool HasPlaceholders(List<TemplatePiece> pieces)
        {
            return pieces.Exists(p => p.IsPlaceholder);
        }

        /// <summary>The pieces as one text (a placeholder as it is written).</summary>
        private static string TemplateText(List<TemplatePiece> pieces)
        {
            var result = new StringBuilder();
            foreach (TemplatePiece piece in pieces)
                result.Append(piece.IsPlaceholder ? "{" + piece.Text + "}" : piece.Text);
            return result.ToString();
        }

        /// <summary>
        /// True when <paramref name="name"/>, from <paramref name="position"/>, matches the pieces from
        /// <paramref name="index"/>: the texts in order, ignoring case, and each placeholder one or more characters, the
        /// fewest first (the first match found wins). <paramref name="taken"/> gets the text of each placeholder.
        /// </summary>
        private static bool MatchTemplate(List<TemplatePiece> pieces, int index, string name, int position, string[] taken)
        {
            if (index == pieces.Count)
                return position == name.Length;
            TemplatePiece piece = pieces[index];
            if (!piece.IsPlaceholder)
                return position + piece.Text.Length <= name.Length &&
                    string.Compare(name, position, piece.Text, 0, piece.Text.Length, StringComparison.OrdinalIgnoreCase) == 0 &&
                    MatchTemplate(pieces, index + 1, name, position + piece.Text.Length, taken);
            // A placeholder written again takes the text it took before (as the Delphi designer and the web)
            for (int earlier = 0; earlier < index; earlier++)
            {
                if (pieces[earlier].IsPlaceholder && taken[earlier] != null &&
                    string.Equals(pieces[earlier].Text, piece.Text, StringComparison.OrdinalIgnoreCase))
                {
                    string text = taken[earlier];
                    if (position + text.Length > name.Length ||
                        string.Compare(name, position, text, 0, text.Length, StringComparison.OrdinalIgnoreCase) != 0 ||
                        !MatchTemplate(pieces, index + 1, name, position + text.Length, taken))
                        return false;
                    taken[index] = name.Substring(position, text.Length);
                    return true;
                }
            }
            for (int length = 1; position + length <= name.Length; length++)
            {
                taken[index] = name.Substring(position, length);
                if (MatchTemplate(pieces, index + 1, name, position + length, taken))
                    return true;
            }
            taken[index] = null;
            return false;
        }

        /// <summary>The value of a placeholder (ignoring the case of its name); null when there is none or it is empty.</summary>
        private static string TemplateValue(IDictionary<string, string> values, string name)
        {
            if (values == null)
                return null;
            string value;
            if (!values.TryGetValue(name, out value))
            {
                value = null;
                foreach (KeyValuePair<string, string> item in values)
                {
                    if (string.Equals((item.Key ?? "").Trim(), name, StringComparison.OrdinalIgnoreCase))
                    {
                        value = item.Value;
                        break;
                    }
                }
            }
            return string.IsNullOrEmpty(value) ? null : value;
        }

        private static string FindValue(List<KeyValuePair<string, string>> values, string name)
        {
            foreach (KeyValuePair<string, string> value in values)
                if (string.Equals(value.Key, name, StringComparison.OrdinalIgnoreCase))
                    return value.Value;
            return null;
        }

        // The first value of a placeholder stays
        private static void AddValue(List<KeyValuePair<string, string>> values, string name, string value)
        {
            if (FindValue(values, name) == null)
                values.Add(new KeyValuePair<string, string>(name, value));
        }

        /// <summary>The JSON of an imported schema, or null when it is not JSON.</summary>
        private static JsonDocument ParseSchemaJson(string json)
        {
            try
            {
                return JsonDocument.Parse((json ?? "").TrimStart('﻿'),
                    new JsonDocumentOptions { AllowTrailingCommas = true, CommentHandling = JsonCommentHandling.Skip });
            }
            catch (JsonException)
            {
                return null;
            }
        }

        /// <summary>The names of the tables of the <c>schemaTables</c> of a schema, as written.</summary>
        private static List<string> TableNames(JsonElement schemaTables)
        {
            var result = new List<string>();
            foreach (JsonElement item in schemaTables.EnumerateArray())
                result.Add(JsonText(item, "name"));
            return result;
        }

        /// <summary>The names of the tables of a schema; null when the text is not one (as for the import).</summary>
        private static List<string> SchemaTableNames(string json)
        {
            JsonDocument document = ParseSchemaJson(json);
            if (document == null)
                return null;
            using (document)
            {
                JsonElement schemaTables;
                if (!TryJsonProperty(document.RootElement, "schemaTables", out schemaTables) || schemaTables.ValueKind != JsonValueKind.Array)
                    return null;
                return TableNames(schemaTables);
            }
        }

        // ===== The schema library of Reportman AI (docs/esquemas-locales-pantalla-plan.md, §5.7.1, C.2) =====

        /// <summary>
        /// The categories of the Reportman AI schema library as <c>GET api/schema/list</c> answers them
        /// (<c>[{ id, name, description, schemas: [{ id, name, version, categoryId }] }]</c>, camelCase or PascalCase),
        /// in its order. A category without schemas is left out: there is nothing to choose in it. Anything but a
        /// list gives none; a text that is not JSON throws <see cref="JsonException"/>.
        /// </summary>
        /// <param name="json">The answer of the list.</param>
        public static List<LocalSchemaLibraryCategory> ParseLibrary(string json)
        {
            var result = new List<LocalSchemaLibraryCategory>();
            using (JsonDocument document = JsonDocument.Parse((json ?? "").TrimStart('﻿')))
            {
                JsonElement root = document.RootElement;
                if (root.ValueKind != JsonValueKind.Array)
                    return result;
                foreach (JsonElement item in root.EnumerateArray())
                {
                    if (item.ValueKind != JsonValueKind.Object)
                        continue;
                    var category = new LocalSchemaLibraryCategory
                    {
                        Name = JsonText(item, "name").Trim(),
                        Description = JsonText(item, "description").Trim()
                    };
                    foreach (JsonElement s in JsonArray(item, "schemas"))
                    {
                        // The schema is read later by its id: without one there is nothing to read
                        long id;
                        if (s.ValueKind != JsonValueKind.Object ||
                            !long.TryParse(JsonText(s, "id"), NumberStyles.Integer, CultureInfo.InvariantCulture, out id) || id <= 0)
                            continue;
                        string name = JsonText(s, "name").Trim();
                        category.Schemas.Add(new LocalSchemaLibrarySchema
                        {
                            Id = id,
                            Name = name.Length > 0 ? name : id.ToString(CultureInfo.InvariantCulture),
                            Version = JsonText(s, "version").Trim()
                        });
                    }
                    if (category.Schemas.Count > 0)
                        result.Add(category);
                }
            }
            return result;
        }

        /// <summary>
        /// The schema of an answer of <c>GET api/schema/{id}</c> (<c>{ id, name, version, categoryId, fullSchema }</c>):
        /// its <c>fullSchema</c>, a database configuration with <c>schemaTables</c> (maybe PascalCase, with numeric
        /// types) that <see cref="Import(LocalSchemaFile, string, string, IEnumerable{string}, string)"/> reads; empty
        /// when there is none. A text that is not JSON throws <see cref="JsonException"/>.
        /// </summary>
        /// <param name="json">The answer of the schema.</param>
        public static string LibraryFullSchema(string json)
        {
            using (JsonDocument document = JsonDocument.Parse((json ?? "").TrimStart('﻿')))
            {
                JsonElement value;
                if (!TryJsonProperty(document.RootElement, "fullSchema", out value))
                    return "";
                // A string with the JSON, as the cloud keeps it; an object written in place is read too
                if (value.ValueKind == JsonValueKind.String)
                    return value.GetString() ?? "";
                return value.ValueKind == JsonValueKind.Object ? value.GetRawText() : "";
            }
        }

        // The web reads the Desktop's PascalCase by lowering the first letter of every property; here, any case.
        private static bool TryJsonProperty(JsonElement element, string name, out JsonElement value)
        {
            value = default(JsonElement);
            if (element.ValueKind != JsonValueKind.Object)
                return false;
            if (element.TryGetProperty(name, out value))
                return true;
            foreach (JsonProperty property in element.EnumerateObject())
            {
                if (string.Equals(property.Name, name, StringComparison.OrdinalIgnoreCase))
                {
                    value = property.Value;
                    return true;
                }
            }
            return false;
        }

        /// <summary>A text property: a string as it is, a number or a boolean as written, anything else empty.</summary>
        private static string JsonText(JsonElement element, string name)
        {
            JsonElement value;
            if (!TryJsonProperty(element, name, out value))
                return "";
            switch (value.ValueKind)
            {
                case JsonValueKind.String:
                    return value.GetString() ?? "";
                case JsonValueKind.Number:
                case JsonValueKind.True:
                case JsonValueKind.False:
                    return value.GetRawText();
                default:
                    return "";
            }
        }

        /// <summary>The items of an array property; none when it is not an array.</summary>
        private static List<JsonElement> JsonArray(JsonElement element, string name)
        {
            var result = new List<JsonElement>();
            JsonElement value;
            if (TryJsonProperty(element, name, out value) && value.ValueKind == JsonValueKind.Array)
                foreach (JsonElement item in value.EnumerateArray())
                    if (item.ValueKind == JsonValueKind.Object || item.ValueKind == JsonValueKind.String)
                        result.Add(item);
            return result;
        }

        /// <summary>The names of an array of strings (the columns of a relation).</summary>
        private static List<string> JsonNames(JsonElement element, string name)
        {
            var result = new List<string>();
            foreach (JsonElement item in JsonArray(element, name))
                if (item.ValueKind == JsonValueKind.String)
                    result.Add((item.GetString() ?? "").Trim());
            return result;
        }

        /// <summary>The allowed values of an imported column with a value; null when it has none.</summary>
        private static List<LocalAllowedValue> JsonAllowedValues(JsonElement column)
        {
            var result = new List<LocalAllowedValue>();
            foreach (JsonElement item in JsonArray(column, "allowedValues"))
            {
                string value = JsonText(item, "value");
                if (value.Length > 0)
                    result.Add(new LocalAllowedValue { Value = value, Label = JsonText(item, "label") });
            }
            return result.Count > 0 ? result : null;
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

    /// <summary>
    /// The filter of the lists of the local schema screen (the same in the Delphi designer and the web): the text is split
    /// into words by white space, and an item matches when every word is in its name or in its description, different words
    /// maybe in different fields and in any order («cliente activo» finds CUSTOMERS, «Clientes activos y bloqueados»),
    /// ignoring case and accents. An empty text (or only spaces) matches everything. It runs over all the items, never over
    /// the ones a list shows.
    /// </summary>
    internal sealed class LocalSchemaFilter
    {
        // The letters with an accent of U+00C0-U+017F and their base letter (their NFD base), one to one; any other
        // character stays as it is, so the three designers compare the same
        private const string Accented = "ÀÁÂÃÄÅÇÈÉÊËÌÍÎÏÑÒÓÔÕÖÙÚÛÜÝàáâãäåçèéêëìíîïñòóôõöùúûüýÿĀāĂăĄąĆćĈĉĊċČčĎďĒēĔĕĖėĘęĚěĜĝĞğĠġĢģĤĥĨĩĪīĬĭĮįİĴĵĶķĹĺĻļĽľŃńŅņŇňŌōŎŏŐőŔŕŖŗŘřŚśŜŝŞşŠšŢţŤťŨũŪūŬŭŮůŰűŲųŴŵŶŷŸŹźŻżŽž";
        private const string Plain = "aaaaaaceeeeiiiinooooouuuuyaaaaaaceeeeiiiinooooouuuuyyaaaaaaccccccccddeeeeeeeeeegggggggghhiiiiiiiiijjkkllllllnnnnnnoooooorrrrrrssssssssttttuuuuuuuuuuuuwwyyyzzzzzz";
        private const char First = '\u00C0';
        private const char Last = '\u017F';
        private static readonly char[] Map = BuildMap();

        private readonly string[] _words;

        /// <summary>Initializes the filter of a text.</summary>
        /// <param name="text">The text typed in the filter box.</param>
        public LocalSchemaFilter(string text)
        {
            string[] words = (text ?? "").Split((char[])null, StringSplitOptions.RemoveEmptyEntries);
            for (int i = 0; i < words.Length; i++)
                words[i] = Fold(words[i]);
            _words = words;
        }

        /// <summary>True when the text has no word: everything matches.</summary>
        public bool IsEmpty
        {
            get { return _words.Length == 0; }
        }

        /// <summary>True when every word is in the name or in the description.</summary>
        /// <param name="name">The name of the item.</param>
        /// <param name="description">Its description; null or empty when it has none.</param>
        public bool Matches(string name, string description)
        {
            if (_words.Length == 0)
                return true;
            string folded = Fold(name);
            string context = null;
            foreach (string word in _words)
            {
                if (folded.IndexOf(word, StringComparison.Ordinal) >= 0)
                    continue;
                if (context == null)
                    context = Fold(description);
                if (context.IndexOf(word, StringComparison.Ordinal) < 0)
                    return false;
            }
            return true;
        }

        /// <summary>A text as the filter compares it: in lower case, then each letter of the table as its base letter.</summary>
        public static string Fold(string text)
        {
            if (string.IsNullOrEmpty(text))
                return "";
            char[] chars = text.ToLowerInvariant().ToCharArray();
            for (int i = 0; i < chars.Length; i++)
            {
                char c = chars[i];
                if (c >= First && c <= Last && Map[c - First] != '\0')
                    chars[i] = Map[c - First];
            }
            return new string(chars);
        }

        private static char[] BuildMap()
        {
            var map = new char[Last - First + 1];
            for (int i = 0; i < Accented.Length; i++)
                map[Accented[i] - First] = Plain[i];
            return map;
        }
    }

    /// <summary>What <see cref="LocalSchemaEditing.Import(LocalSchemaFile, string, string, IEnumerable{string}, string, IDictionary{string, string})"/> did.</summary>
    internal sealed class LocalSchemaImportResult
    {
        /// <summary>The subschema created, already in the file; null when none of the tables of the schema is in the database (nothing was created).</summary>
        public LocalSubschema Subschema { get; set; }

        /// <summary>The name of the schema imported, when <see cref="Subschema"/> is null (to say which one does not match).</summary>
        public string Name { get; set; } = "";

        /// <summary>What the database does not have and was left out: TABLE (as the schema names it), or TABLE.COLUMN of a table it has.</summary>
        public List<string> Skipped { get; } = new List<string>();

        /// <summary>
        /// The value each placeholder of the names of the tables had (its name without braces, and the value), for the
        /// ones that found some table, in the order they come in the schema; none when no name was a template.
        /// </summary>
        public List<KeyValuePair<string, string>> TemplateValues { get; } = new List<KeyValuePair<string, string>>();
    }

    /// <summary>
    /// A placeholder of the names of the tables of a schema (<see cref="LocalSchemaEditing.LibraryPlaceholders"/>) and
    /// the values this database has for it.
    /// </summary>
    internal sealed class LocalSchemaPlaceholder
    {
        /// <summary>Its name, without braces: <c>COMPANY_NAME</c> of <c>{COMPANY_NAME}</c>.</summary>
        public string Name { get; set; } = "";

        /// <summary>Its values as the catalog spells them, the one that finds more tables first; never empty.</summary>
        public List<string> Values { get; } = new List<string>();
    }

    /// <summary>How much of a schema of the library a database has (<see cref="LocalSchemaEditing.LibraryCoverage"/>).</summary>
    internal sealed class LocalSchemaCoverage
    {
        /// <summary>Initializes a coverage.</summary>
        /// <param name="matched">The tables of the schema the database has.</param>
        /// <param name="total">The tables of the schema.</param>
        public LocalSchemaCoverage(int matched, int total)
        {
            Matched = matched;
            Total = total;
        }

        /// <summary>The tables of the schema the database has.</summary>
        public int Matched { get; }

        /// <summary>The tables of the schema (different names).</summary>
        public int Total { get; }

        /// <summary>
        /// True when the schema seems written for the database: it has two of its tables or more (or the only one),
        /// and at least half of them.
        /// </summary>
        public bool Detected
        {
            get { return (Matched >= 2 || (Matched == Total && Total == 1)) && Matched * 2 >= Total; }
        }
    }

    /// <summary>A category of the Reportman AI schema library (<see cref="LocalSchemaEditing.ParseLibrary"/>).</summary>
    internal sealed class LocalSchemaLibraryCategory
    {
        /// <summary>The name of the category.</summary>
        public string Name { get; set; } = "";

        /// <summary>What the category is about; may be empty.</summary>
        public string Description { get; set; } = "";

        /// <summary>Its schemas, in the library's order.</summary>
        public List<LocalSchemaLibrarySchema> Schemas { get; } = new List<LocalSchemaLibrarySchema>();
    }

    /// <summary>A schema of the Reportman AI schema library as its list gives it: the schema itself is read by its id.</summary>
    internal sealed class LocalSchemaLibrarySchema
    {
        /// <summary>The id that <c>GET api/schema/{id}</c> reads.</summary>
        public long Id { get; set; }

        /// <summary>The name of the schema: the name of the subschema made from it.</summary>
        public string Name { get; set; } = "";

        /// <summary>Its version; may be empty.</summary>
        public string Version { get; set; } = "";

        /// <summary>
        /// Its schema (<see cref="LocalSchemaEditing.LibraryFullSchema"/>) when it was read before choosing; null when
        /// it was not, or could not be, read.
        /// </summary>
        public string FullSchema { get; set; }

        /// <summary>How much of it the database has (<see cref="LocalSchemaEditing.LibraryCoverage"/>); null when unknown.</summary>
        public LocalSchemaCoverage Coverage { get; set; }
    }
}
