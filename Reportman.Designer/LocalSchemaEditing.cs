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
        /// <item>the tables of the file the catalog has, as the catalog spells them, each with the columns of the
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
            if (file == null)
                throw new ArgumentNullException("file");
            JsonDocument document;
            try
            {
                document = JsonDocument.Parse((json ?? "").TrimStart('﻿'),
                    new JsonDocumentOptions { AllowTrailingCommas = true, CommentHandling = JsonCommentHandling.Skip });
            }
            catch (JsonException)
            {
                return null;
            }
            using (document)
            {
                JsonElement root = document.RootElement;
                JsonElement schemaTables;
                if (!TryJsonProperty(root, "schemaTables", out schemaTables) || schemaTables.ValueKind != JsonValueKind.Array)
                    return null;
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
                    LocalSchemaTable table = FindTable(file, tableName);
                    if (table == null)
                    {
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
                        ImportRelation(file, table, fk);
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
                return result;
            }
        }

        /// <summary>
        /// A relation of an imported table into the dictionary, as the catalog spells it, when its ends are there:
        /// the same one the dictionary has takes its description (when it has one); a new one is written here.
        /// </summary>
        private static void ImportRelation(LocalSchemaFile file, LocalSchemaTable source, JsonElement item)
        {
            LocalSchemaTable target = FindTable(file, JsonText(item, "targetTable").Trim());
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

    /// <summary>What <see cref="LocalSchemaEditing.Import(LocalSchemaFile, string, string, IEnumerable{string}, string)"/> did.</summary>
    internal sealed class LocalSchemaImportResult
    {
        /// <summary>The subschema created, already in the file; null when none of the tables of the schema is in the database (nothing was created).</summary>
        public LocalSubschema Subschema { get; set; }

        /// <summary>The name of the schema imported, when <see cref="Subschema"/> is null (to say which one does not match).</summary>
        public string Name { get; set; } = "";

        /// <summary>What the database does not have and was left out: TABLE, or TABLE.COLUMN of a table it has.</summary>
        public List<string> Skipped { get; } = new List<string>();
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
    }
}
