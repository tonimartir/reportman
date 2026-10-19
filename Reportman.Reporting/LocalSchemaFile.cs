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
using System.Data.Common;
using System.Globalization;
using System.IO;
using System.Text;
using System.Text.Json;
using System.Text.Json.Serialization;
using System.Threading;
using System.Threading.Tasks;

namespace Reportman.Reporting
{
    /// <summary>
    /// The schema of a direct connection kept in a local file, <c>dbxschemas/&lt;ALIAS&gt;.json</c> in the
    /// folder of <c>dbxconnections.ini</c>, shared by the Delphi and .Net designers and Reportman Server.
    /// It holds every table of the database catalog (the default "all tables" schema, which is not stored
    /// as a named schema) and the subschemas the user defines (a name, a selection of tables and, from
    /// version 2, of their columns). The table shape is the one of the Reportman AI schemas (SchemaTable),
    /// so the tables can be sent to the AI inline without conversion.
    /// <para>
    /// Version 2 adds the allowed values of a column and the columns of a subschema, and every reader keeps
    /// what it does not know: the properties a newer designer wrote stay in <c>Extra</c> and are written
    /// back, so saving with an older designer never loses them.
    /// </para>
    /// </summary>
    public class LocalSchemaFile
    {
        /// <summary>Format version: 2 (allowed values, columns of a subschema); version 1 files are read too.</summary>
        public int Version { get; set; } = LocalSchemaStore.CurrentVersion;
        /// <summary>Connection alias, in upper case.</summary>
        public string Alias { get; set; } = "";
        /// <summary>A Reportman AI dialect name (Firebird5, PostgreSQL, SQLite, SQLServer...), Default when unknown.</summary>
        public string Dialect { get; set; } = "Default";
        /// <summary>When the tables were read from the catalog, ISO 8601 in UTC.</summary>
        public string GeneratedUtc { get; set; } = "";
        /// <summary>Every table and view of the catalog.</summary>
        public List<LocalSchemaTable> Tables { get; set; } = new List<LocalSchemaTable>();
        /// <summary>The subschemas defined by the user.</summary>
        public List<LocalSubschema> Schemas { get; set; } = new List<LocalSubschema>();
        /// <summary>
        /// The relations left out of every subschema (and of all the tables): a foreign key of the catalog people
        /// deleted from the dictionary, which the next reading of the catalog would bring back. Null or empty: none;
        /// written only when there is one.
        /// </summary>
        [JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)]
        public List<LocalRelationRef> ExcludedRelations { get; set; }
        /// <summary>Properties this version does not know, kept as they are.</summary>
        [JsonExtensionData]
        public Dictionary<string, JsonElement> Extra { get; set; }

        // ===== Export all / Import all (docs: SPEC X, the same in the Delphi designer, this designer and Reportman Server) =====

        /// <summary>
        /// True when <paramref name="json"/> is a whole local schema file: a JSON object with an array <c>tables</c>, what
        /// Export all writes or a <c>dbxschemas/&lt;ALIAS&gt;.json</c> copied as it is, from any designer or platform. A
        /// subschema exported with Export (the format of the Reportman AI web, with <c>schemaTables</c>), any other JSON and a
        /// text that is not JSON are not.
        /// </summary>
        /// <param name="json">The text of the file.</param>
        public static bool IsWholeFileJson(string json)
        {
            try
            {
                using (JsonDocument document = JsonDocument.Parse(WithoutBom(json),
                    new JsonDocumentOptions { AllowTrailingCommas = true, CommentHandling = JsonCommentHandling.Skip }))
                {
                    JsonElement root = document.RootElement;
                    if (root.ValueKind != JsonValueKind.Object)
                        return false;
                    JsonElement tables;
                    if (root.TryGetProperty("tables", out tables))
                        return tables.ValueKind == JsonValueKind.Array;
                    // Read as the file is read: the names of its properties ignoring case
                    foreach (JsonProperty property in root.EnumerateObject())
                        if (string.Equals(property.Name, "tables", StringComparison.OrdinalIgnoreCase))
                            return property.Value.ValueKind == JsonValueKind.Array;
                    return false;
                }
            }
            catch (JsonException)
            {
                return false;
            }
        }

        /// <summary>
        /// Reads a whole local schema file from its text, as <see cref="LocalSchemaStore.Load"/> reads it from disk: the
        /// properties of a newer version kept, everything normalized. Throws <see cref="JsonException"/> when the text is not
        /// the JSON of a file (check it first with <see cref="IsWholeFileJson"/>).
        /// </summary>
        /// <param name="json">The text of the file.</param>
        public static LocalSchemaFile Parse(string json)
        {
            LocalSchemaFile file = JsonSerializer.Deserialize<LocalSchemaFile>(WithoutBom(json), LocalSchemaStore.CreateJsonOptions())
                ?? new LocalSchemaFile();
            LocalSchemaStore.Normalize(file);
            return file;
        }

        private static string WithoutBom(string json)
        {
            return (json ?? "").TrimStart('\uFEFF');
        }

        /// <summary>
        /// True when the file has something people wrote, what an import of a whole file asks about before changing it: a
        /// subschema, a relation left out of every subschema, a relation written by hand, or a description of a table, of a
        /// column or of a relation, or allowed values of a column (a description that came from a comment of the database
        /// counts too: it only asks). A file just read from the catalog has none.
        /// </summary>
        public bool HasContent()
        {
            if (Schemas != null && Schemas.Exists(s => s != null))
                return true;
            if (ExcludedRelations != null && ExcludedRelations.Exists(r => r != null))
                return true;
            if (Tables == null)
                return false;
            foreach (LocalSchemaTable table in Tables)
            {
                if (table == null)
                    continue;
                if (IsWritten(table.Context))
                    return true;
                if (table.Columns != null)
                    foreach (LocalSchemaColumn column in table.Columns)
                        if (column != null && (IsWritten(column.Context) ||
                            (column.AllowedValues != null && column.AllowedValues.Exists(v => v != null && !string.IsNullOrEmpty(v.Value)))))
                            return true;
                if (table.ForeignKeys != null)
                    foreach (LocalSchemaForeignKey fk in table.ForeignKeys)
                        if (fk != null && (string.IsNullOrEmpty(fk.ConstraintName) || IsWritten(fk.RelationshipContext)))
                            return true;
            }
            return false;
        }

        /// <summary>
        /// The tables whose columns an import of <paramref name="imported"/> (<see cref="ImportAll"/>) needs and this file
        /// has not read (a large catalog reads the columns of a table when it is used): of the tables of
        /// <paramref name="imported"/> whose columns it has (all of them, unless its own catalog is large), of the tables of
        /// its subschemas and of the targets of its relations written by hand, the ones this file has with
        /// <see cref="LocalSchemaTable.ColumnsRead"/> false, as this file spells them, each once. They are read
        /// (<see cref="LocalSchemaStore.ReadColumnsAsync"/>) before importing; nothing is changed here.
        /// </summary>
        /// <param name="imported">The file to import.</param>
        public List<string> UnreadTablesOf(LocalSchemaFile imported)
        {
            var names = new List<string>();
            if (imported == null)
                return names;
            if (imported.Tables != null)
            {
                foreach (LocalSchemaTable table in imported.Tables)
                {
                    if (table == null || string.IsNullOrEmpty(table.Name))
                        continue;
                    // A table the imported file did not read either brings no column: nothing to read for it
                    if (LocalSchemaStore.IsRead(table))
                        names.Add(table.Name);
                    if (table.ForeignKeys != null)
                        foreach (LocalSchemaForeignKey fk in table.ForeignKeys)
                            if (fk != null && string.IsNullOrEmpty(fk.ConstraintName) && !string.IsNullOrEmpty(fk.TargetTable))
                                names.Add(fk.TargetTable);
                }
            }
            if (imported.Schemas != null)
                foreach (LocalSubschema schema in imported.Schemas)
                    if (schema != null && schema.Tables != null)
                        names.AddRange(schema.Tables);
            return LocalSchemaStore.UnreadTables(this, names);
        }

        /// <summary>
        /// Imports a whole local schema file (Export all of another installation) into this one, the file shown. The catalog
        /// of this file never changes (its tables, columns, types, primary keys and the relations its database declares):
        /// only what people wrote comes from <paramref name="imported"/>. With <paramref name="replace"/> this file is first
        /// emptied of what is written (every subschema, the relations left out of every subschema, the relations written by
        /// hand, every description and every list of allowed values); then, as a merge:
        /// <list type="number">
        /// <item>each table of <paramref name="imported"/> is the one of this file with its name, ignoring case; one this
        /// file does not have is skipped (<c>TABLE</c>);</item>
        /// <item>its description, when not empty, becomes the table's;</item>
        /// <item>each of its columns is the one of the table with its name; one it does not have is skipped
        /// (<c>TABLE.COLUMN</c>); its description, when not empty, becomes the column's, and its allowed values, when it has
        /// some, the column's whole list;</item>
        /// <item>its relations of the database (with a constraint name) are found by that name, ignoring case, or else by the
        /// same target table and columns, and their description, when not empty, becomes the one found's; one not found is
        /// ignored;</item>
        /// <item>its relations written by hand whose tables and columns are all here are added as written by hand, as this
        /// file spells them; one with the same ends here already takes their description when it is not empty; one with an
        /// end that is not here is ignored;</item>
        /// <item>the relations it leaves out of every subschema whose source table is here are added to this file's list,
        /// unless the same entry is there;</item>
        /// <item>its subschemas, in its order: the tables that are here (as this file spells them), the columns of their
        /// lists that are here (a list left empty: the primary key), the relations left out whose source table is here, the
        /// description and the properties of a newer version; one with the name of a subschema of this file (ignoring case)
        /// replaces it in place, else it is added at the end;</item>
        /// <item>the subschemas and descriptions of this file that <paramref name="imported"/> does not have stay.</item>
        /// </list>
        /// Nothing is saved. A large catalog reads first the tables <see cref="UnreadTablesOf"/> says.
        /// </summary>
        /// <param name="imported">The file to import (<see cref="Parse"/>).</param>
        /// <param name="replace">True to replace what is written here, false to merge with it.</param>
        public LocalSchemaImportAllResult ImportAll(LocalSchemaFile imported, bool replace)
        {
            if (imported == null)
                throw new ArgumentNullException("imported");
            // Its own copy: emptying this file must not empty the one imported
            if (ReferenceEquals(imported, this))
                imported = Parse(LocalSchemaStore.ToJson(this));
            LocalSchemaStore.Normalize(this);
            LocalSchemaStore.Normalize(imported);
            var result = new LocalSchemaImportAllResult();
            if (replace)
                ClearWritten();
            var tables = new Dictionary<string, LocalSchemaTable>(StringComparer.OrdinalIgnoreCase);
            foreach (LocalSchemaTable table in Tables)
                if (!tables.ContainsKey(table.Name))
                    tables.Add(table.Name, table);

            // 1-5. The dictionary: descriptions, allowed values and relations of the tables and columns this file has
            foreach (LocalSchemaTable source in imported.Tables)
            {
                LocalSchemaTable table;
                if (!tables.TryGetValue(source.Name, out table))
                {
                    AddSkipped(result.Skipped, source.Name);
                    continue;
                }
                if (IsWritten(source.Context))
                    table.Context = source.Context;
                foreach (LocalSchemaColumn sourceColumn in source.Columns)
                {
                    LocalSchemaColumn column = FindColumn(table, sourceColumn.Name);
                    if (column == null)
                    {
                        AddSkipped(result.Skipped, table.Name + "." + sourceColumn.Name);
                        continue;
                    }
                    if (IsWritten(sourceColumn.Context))
                        column.Context = sourceColumn.Context;
                    if (sourceColumn.AllowedValues != null && sourceColumn.AllowedValues.Count > 0)
                        column.AllowedValues = CopyValues(sourceColumn.AllowedValues);
                }
                // The relations of the database first, then the ones written by hand
                foreach (LocalSchemaForeignKey fk in source.ForeignKeys)
                    if (fk.ConstraintName.Length > 0)
                        DescribeRelation(table, fk);
                foreach (LocalSchemaForeignKey fk in source.ForeignKeys)
                    if (fk.ConstraintName.Length == 0)
                        ImportRelation(tables, table, fk);
            }

            // 6. The relations left out of every subschema
            if (imported.ExcludedRelations != null)
            {
                foreach (LocalRelationRef entry in imported.ExcludedRelations)
                {
                    if (!tables.ContainsKey(entry.SourceTable))
                        continue;
                    if (ExcludedRelations == null)
                        ExcludedRelations = new List<LocalRelationRef>();
                    if (IndexOfEntry(ExcludedRelations, entry) < 0)
                        ExcludedRelations.Add(CopyEntry(entry));
                }
            }

            // 7. The subschemas, replacing the ones with the same name
            foreach (LocalSubschema source in imported.Schemas)
            {
                LocalSubschema schema = ImportSubschema(tables, source, result.Skipped);
                int index = Schemas.FindIndex(s => string.Equals(s.Name, schema.Name, StringComparison.OrdinalIgnoreCase));
                if (index >= 0)
                {
                    Schemas[index] = schema;
                    result.Replaced++;
                }
                else
                    Schemas.Add(schema);
                result.Added++;
                result.Subschemas.Add(schema.Name);
            }
            return result;
        }

        /// <summary>Empties the file of what people wrote; the catalog stays (Replace of an import).</summary>
        private void ClearWritten()
        {
            Schemas.Clear();
            ExcludedRelations = null;
            foreach (LocalSchemaTable table in Tables)
            {
                table.Context = "";
                foreach (LocalSchemaColumn column in table.Columns)
                {
                    column.Context = "";
                    column.AllowedValues = null;
                }
                table.ForeignKeys.RemoveAll(fk => fk.ConstraintName.Length == 0);
                foreach (LocalSchemaForeignKey fk in table.ForeignKeys)
                    fk.RelationshipContext = "";
            }
        }

        /// <summary>
        /// The description of a relation of the database of an imported table to the same one here: the one with its constraint
        /// name, else the one with its ends.
        /// </summary>
        private static void DescribeRelation(LocalSchemaTable table, LocalSchemaForeignKey fk)
        {
            if (!IsWritten(fk.RelationshipContext))
                return;
            LocalSchemaForeignKey same = table.ForeignKeys.Find(f => f.ConstraintName.Length > 0 &&
                string.Equals(f.ConstraintName, fk.ConstraintName, StringComparison.OrdinalIgnoreCase))
                ?? table.ForeignKeys.Find(f => LocalSchemaStore.SameRelation(f, fk));
            if (same != null)
                same.RelationshipContext = fk.RelationshipContext;
        }

        /// <summary>
        /// A relation written by hand of an imported table, as this file spells its ends, when they are all here: added, or
        /// its description to the one with the same ends.
        /// </summary>
        private static void ImportRelation(Dictionary<string, LocalSchemaTable> tables, LocalSchemaTable table, LocalSchemaForeignKey fk)
        {
            LocalSchemaTable target;
            if (string.IsNullOrEmpty(fk.TargetTable) || !tables.TryGetValue(fk.TargetTable, out target))
                return;
            if (fk.SourceColumns.Count == 0 || fk.SourceColumns.Count != fk.TargetColumns.Count)
                return;
            List<string> sourceColumns = SpelledColumns(table, fk.SourceColumns);
            List<string> targetColumns = SpelledColumns(target, fk.TargetColumns);
            if (sourceColumns == null || targetColumns == null)
                return;
            var relation = new LocalSchemaForeignKey
            {
                ConstraintName = "",
                TargetTable = target.Name,
                SourceColumns = sourceColumns,
                TargetColumns = targetColumns,
                RelationshipContext = fk.RelationshipContext ?? "",
                Extra = CopyExtra(fk.Extra)
            };
            LocalSchemaForeignKey same = table.ForeignKeys.Find(f => LocalSchemaStore.SameRelation(f, relation));
            if (same == null)
                table.ForeignKeys.Add(relation);
            else if (IsWritten(relation.RelationshipContext))
                same.RelationshipContext = relation.RelationshipContext;
        }

        /// <summary>An imported subschema with what this file has of it; what it does not have goes to <paramref name="skipped"/>.</summary>
        private static LocalSubschema ImportSubschema(Dictionary<string, LocalSchemaTable> tables, LocalSubschema source, List<string> skipped)
        {
            var schema = new LocalSubschema
            {
                Name = source.Name,
                Description = source.Description ?? "",
                Extra = CopyExtra(source.Extra)
            };
            foreach (string name in source.Tables)
            {
                LocalSchemaTable table;
                if (!tables.TryGetValue(name, out table))
                {
                    AddSkipped(skipped, name);
                    continue;
                }
                if (!schema.Tables.Contains(table.Name))
                    schema.Tables.Add(table.Name);
            }
            if (source.Columns != null)
            {
                foreach (KeyValuePair<string, List<string>> entry in source.Columns)
                {
                    LocalSchemaTable table;
                    if (!tables.TryGetValue(entry.Key, out table) || !schema.Tables.Contains(table.Name))
                        continue;
                    var columns = new List<string>();
                    foreach (string name in entry.Value)
                    {
                        LocalSchemaColumn column = FindColumn(table, name);
                        if (column == null)
                            AddSkipped(skipped, table.Name + "." + name);
                        else if (!columns.Contains(column.Name))
                            columns.Add(column.Name);
                    }
                    // None left: the table goes with its primary key, as always
                    if (columns.Count == 0)
                        continue;
                    if (schema.Columns == null)
                        schema.Columns = new Dictionary<string, List<string>>();
                    schema.Columns[table.Name] = columns;
                }
            }
            if (source.ExcludedRelations != null)
            {
                foreach (LocalRelationRef entry in source.ExcludedRelations)
                {
                    if (!tables.ContainsKey(entry.SourceTable))
                        continue;
                    if (schema.ExcludedRelations == null)
                        schema.ExcludedRelations = new List<LocalRelationRef>();
                    if (IndexOfEntry(schema.ExcludedRelations, entry) < 0)
                        schema.ExcludedRelations.Add(CopyEntry(entry));
                }
            }
            return schema;
        }

        private static bool IsWritten(string text)
        {
            return !string.IsNullOrWhiteSpace(text);
        }

        private static LocalSchemaColumn FindColumn(LocalSchemaTable table, string name)
        {
            return table.Columns.Find(c => string.Equals(c.Name, name, StringComparison.OrdinalIgnoreCase));
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
            if (!skipped.Exists(s => string.Equals(s, name, StringComparison.OrdinalIgnoreCase)))
                skipped.Add(name);
        }

        private static int IndexOfEntry(List<LocalRelationRef> list, LocalRelationRef entry)
        {
            return LocalSchemaStore.IndexOfRelation(list, entry.SourceTable, new LocalSchemaForeignKey
            {
                TargetTable = entry.TargetTable,
                SourceColumns = entry.SourceColumns,
                TargetColumns = entry.TargetColumns
            });
        }

        private static LocalRelationRef CopyEntry(LocalRelationRef entry)
        {
            return new LocalRelationRef
            {
                SourceTable = entry.SourceTable,
                SourceColumns = new List<string>(entry.SourceColumns),
                TargetTable = entry.TargetTable,
                TargetColumns = new List<string>(entry.TargetColumns),
                Extra = CopyExtra(entry.Extra)
            };
        }

        private static List<LocalAllowedValue> CopyValues(List<LocalAllowedValue> values)
        {
            var result = new List<LocalAllowedValue>();
            foreach (LocalAllowedValue value in values)
                result.Add(new LocalAllowedValue { Value = value.Value, Label = value.Label ?? "", Extra = CopyExtra(value.Extra) });
            return result;
        }

        private static Dictionary<string, JsonElement> CopyExtra(Dictionary<string, JsonElement> extra)
        {
            return extra != null ? new Dictionary<string, JsonElement>(extra) : null;
        }
    }

    /// <summary>What <see cref="LocalSchemaFile.ImportAll"/> did.</summary>
    public class LocalSchemaImportAllResult
    {
        /// <summary>The subschemas imported: every subschema of the imported file.</summary>
        public int Added { get; set; }
        /// <summary>How many of <see cref="Added"/> replaced a subschema with the same name.</summary>
        public int Replaced { get; set; }
        /// <summary>The names of the subschemas imported, in the order of the imported file.</summary>
        public List<string> Subschemas { get; set; } = new List<string>();
        /// <summary>
        /// What the database does not have, not imported: <c>TABLE</c> (as the imported file names it) and
        /// <c>TABLE.COLUMN</c> (the table as this file spells it), each once, in the order found.
        /// </summary>
        public List<string> Skipped { get; set; } = new List<string>();
    }

    /// <summary>A table of a <see cref="LocalSchemaFile"/>.</summary>
    public class LocalSchemaTable
    {
        /// <summary>Table name, as the catalog gives it.</summary>
        public string Name { get; set; } = "";
        /// <summary>What the table means, written by the user (kept when refreshing).</summary>
        public string Context { get; set; } = "";
        /// <summary>The columns of the table.</summary>
        public List<LocalSchemaColumn> Columns { get; set; } = new List<LocalSchemaColumn>();
        /// <summary>The foreign keys of the table, when the provider exposes them.</summary>
        public List<LocalSchemaForeignKey> ForeignKeys { get; set; } = new List<LocalSchemaForeignKey>();
        /// <summary>
        /// False when the columns of the table were not read from the catalog: a large catalog
        /// (<see cref="DatabaseCatalogReader.LargeCatalogThreshold"/>) reads them when the table is used
        /// (<see cref="LocalSchemaStore.ReadColumns"/>), and until then <see cref="Columns"/> and <see cref="ForeignKeys"/>
        /// are empty. Null (not written) when they were read, as in every file written before; a file that says true
        /// is read as null.
        /// </summary>
        [JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)]
        public bool? ColumnsRead { get; set; }
        /// <summary>Properties this version does not know, kept as they are.</summary>
        [JsonExtensionData]
        public Dictionary<string, JsonElement> Extra { get; set; }
    }

    /// <summary>A column of a <see cref="LocalSchemaTable"/>.</summary>
    public class LocalSchemaColumn
    {
        /// <summary>Column name.</summary>
        public string Name { get; set; } = "";
        /// <summary>One of the Reportman AI column types: Integer, Numeric, Currency, String, TextLong, Date, TimeStamp, Boolean.</summary>
        public string DataType { get; set; } = "String";
        /// <summary>What the column means, written by the user (kept when refreshing).</summary>
        public string Context { get; set; } = "";
        /// <summary>True when the column is part of the primary key.</summary>
        public bool IsPrimaryKey { get; set; }
        /// <summary>The type the database reports (declared type or .NET type name).</summary>
        public string DetectedType { get; set; } = "";
        /// <summary>
        /// The values the column takes and what each one means (version 2), as in the cloud's schemas:
        /// the AI writes <c>STATE = 'A'</c> knowing that A is "active". Null when there are none.
        /// </summary>
        [JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)]
        public List<LocalAllowedValue> AllowedValues { get; set; }
        /// <summary>Properties this version does not know, kept as they are.</summary>
        [JsonExtensionData]
        public Dictionary<string, JsonElement> Extra { get; set; }
    }

    /// <summary>A value a column takes, and what it means.</summary>
    public class LocalAllowedValue
    {
        /// <summary>The value as it is in the database ("A", "1").</summary>
        public string Value { get; set; } = "";
        /// <summary>What it means ("Active").</summary>
        public string Label { get; set; } = "";
        /// <summary>Properties this version does not know, kept as they are.</summary>
        [JsonExtensionData]
        public Dictionary<string, JsonElement> Extra { get; set; }
    }

    /// <summary>A foreign key of a <see cref="LocalSchemaTable"/>.</summary>
    public class LocalSchemaForeignKey
    {
        /// <summary>Constraint name.</summary>
        public string ConstraintName { get; set; } = "";
        /// <summary>Referenced table.</summary>
        public string TargetTable { get; set; } = "";
        /// <summary>Columns of this table, in order.</summary>
        public List<string> SourceColumns { get; set; } = new List<string>();
        /// <summary>Columns of the referenced table, in the same order.</summary>
        public List<string> TargetColumns { get; set; } = new List<string>();
        /// <summary>What the relationship means, written by the user (kept when refreshing).</summary>
        public string RelationshipContext { get; set; } = "";
        /// <summary>Properties this version does not know, kept as they are.</summary>
        [JsonExtensionData]
        public Dictionary<string, JsonElement> Extra { get; set; }
    }

    /// <summary>A subschema of a <see cref="LocalSchemaFile"/>: a name and a selection of its tables and columns.</summary>
    public class LocalSubschema
    {
        /// <summary>Subschema name.</summary>
        public string Name { get; set; } = "";
        /// <summary>Optional description.</summary>
        public string Description { get; set; } = "";
        /// <summary>Names of tables of <see cref="LocalSchemaFile.Tables"/>.</summary>
        public List<string> Tables { get; set; } = new List<string>();
        /// <summary>
        /// The columns of some of its tables (version 2): table name to column names. A table that is not here
        /// goes with all its columns, so a version 1 file means the same. Null when every table goes whole.
        /// </summary>
        [JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)]
        public Dictionary<string, List<string>> Columns { get; set; }
        /// <summary>
        /// The relations left out of this subschema although both ends travel: deleted in it, or a suggestion
        /// discarded (the dictionary keeps them). Null or empty: none; written only when there is one.
        /// </summary>
        [JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)]
        public List<LocalRelationRef> ExcludedRelations { get; set; }
        /// <summary>Properties this version does not know, kept as they are.</summary>
        [JsonExtensionData]
        public Dictionary<string, JsonElement> Extra { get; set; }
    }

    /// <summary>
    /// A relation of a <see cref="LocalSchemaFile"/> by its ends, for the lists of relations left out
    /// (<see cref="LocalSchemaFile.ExcludedRelations"/>, <see cref="LocalSubschema.ExcludedRelations"/>): the tables and
    /// columns are compared ignoring case, the columns in the order of the foreign key, whatever its constraint name.
    /// </summary>
    public class LocalRelationRef
    {
        /// <summary>The table that has the foreign key.</summary>
        public string SourceTable { get; set; } = "";
        /// <summary>Its columns, in order.</summary>
        public List<string> SourceColumns { get; set; } = new List<string>();
        /// <summary>The referenced table.</summary>
        public string TargetTable { get; set; } = "";
        /// <summary>Its columns, in the same order.</summary>
        public List<string> TargetColumns { get; set; } = new List<string>();
        /// <summary>Properties this version does not know, kept as they are.</summary>
        [JsonExtensionData]
        public Dictionary<string, JsonElement> Extra { get; set; }
    }

    /// <summary>
    /// Reads, writes, generates and refreshes <see cref="LocalSchemaFile"/> files, and builds the inline
    /// schema configuration the Reportman AI copilot needs for a direct connection.
    /// <para>
    /// The reads of the database have an asynchronous form that reports its progress and stops when its token is
    /// cancelled (<see cref="DatabaseCatalogReader"/>); a read cancelled changes nothing: no file is written, and the
    /// columns read are not merged.
    /// </para>
    /// </summary>
    public static class LocalSchemaStore
    {
        /// <summary>Name of the folder, next to dbxconnections.ini, that holds the files.</summary>
        public const string FolderName = "dbxschemas";

        /// <summary>The format version this code writes (a newer file keeps its own number).</summary>
        public const int CurrentVersion = 2;

        private static readonly string[] CloudColumnTypes =
            { "None", "Integer", "Numeric", "Currency", "String", "TextLong", "Date", "TimeStamp", "Boolean" };

        private static readonly string[] CloudDialects =
            { "Default", "SQLServer", "MySQL", "PostgreSQL", "Oracle", "SQLite", "Firebird1", "Firebird2", "Firebird4", "Firebird5", "Progress", "Firebird2Dialect1" };

        internal static JsonSerializerOptions CreateJsonOptions()
        {
            return CreateJsonOptions(true);
        }

        private static JsonSerializerOptions CreateJsonOptions(bool indented)
        {
            return new JsonSerializerOptions
            {
                PropertyNamingPolicy = JsonNamingPolicy.CamelCase,
                PropertyNameCaseInsensitive = true,
                WriteIndented = indented,
                // The file is read by people too, and the descriptions are in their language: accents and
                // quotes are written as they are (as the Delphi designer does), not as escape sequences
                Encoder = System.Text.Encodings.Web.JavaScriptEncoder.UnsafeRelaxedJsonEscaping,
                ReadCommentHandling = JsonCommentHandling.Skip,
                AllowTrailingCommas = true
            };
        }

        /// <summary>The folder of the files for a given dbxconnections.ini path.</summary>
        /// <param name="dbxConnectionsPath">Full path of dbxconnections.ini (it does not need to exist).</param>
        public static string FolderFor(string dbxConnectionsPath)
        {
            if (string.IsNullOrWhiteSpace(dbxConnectionsPath))
                throw new ArgumentException("No dbxconnections.ini path");
            string dir = Path.GetDirectoryName(Path.GetFullPath(dbxConnectionsPath));
            return Path.Combine(dir ?? "", FolderName);
        }

        /// <summary>The path of the file of an alias inside <paramref name="folder"/>: the alias in upper case.</summary>
        public static string PathFor(string folder, string alias)
        {
            string name = (alias ?? "").Trim().ToUpperInvariant();
            if (name.Length == 0)
                throw new ArgumentException("No connection alias");
            var sb = new StringBuilder(name.Length);
            foreach (char c in name)
                sb.Append(Array.IndexOf(Path.GetInvalidFileNameChars(), c) >= 0 ? '_' : c);
            return Path.Combine(folder, sb.ToString() + ".json");
        }

        /// <summary>Reads a file, or returns null when it does not exist.</summary>
        public static LocalSchemaFile Load(string path)
        {
            if (string.IsNullOrEmpty(path) || !File.Exists(path))
                return null;
            return LocalSchemaFile.Parse(File.ReadAllText(path, Encoding.UTF8));
        }

        /// <summary>Writes a file (UTF-8 without BOM), creating its folder when needed.</summary>
        public static void Save(LocalSchemaFile file, string path)
        {
            if (file == null)
                throw new ArgumentNullException("file");
            Normalize(file);
            if (file.Version < CurrentVersion)
                file.Version = CurrentVersion;
            string dir = Path.GetDirectoryName(path);
            if (!string.IsNullOrEmpty(dir) && !Directory.Exists(dir))
                Directory.CreateDirectory(dir);
            string text = JsonSerializer.Serialize(file, CreateJsonOptions());
            // Written next to the old one and then moved over it, so a failure never leaves half a file.
            string temp = path + ".tmp";
            File.WriteAllText(temp, text, new UTF8Encoding(false));
            if (File.Exists(path))
                File.Delete(path);
            File.Move(temp, path);
        }

        /// <summary>Serializes a file as the JSON it is saved with.</summary>
        public static string ToJson(LocalSchemaFile file)
        {
            return JsonSerializer.Serialize(file, CreateJsonOptions());
        }

        /// <summary>
        /// Serializes a file as the JSON it is saved with, indented or in a single line (what a server-sent event carries:
        /// the strings escape their line breaks).
        /// </summary>
        public static string ToJson(LocalSchemaFile file, bool indented)
        {
            return JsonSerializer.Serialize(file, CreateJsonOptions(indented));
        }

        /// <summary>
        /// Reads the catalog of an open or closed connection (it is opened and closed here when it was
        /// closed) into a new file for <paramref name="alias"/>. A large catalog
        /// (<see cref="DatabaseCatalogReader.LargeCatalogThreshold"/>) comes with the names of its tables only.
        /// </summary>
        public static LocalSchemaFile Generate(DbConnection connection, string alias)
        {
            return Generate(connection, alias, null, DatabaseCatalogReader.LargeCatalogThreshold);
        }

        /// <summary>
        /// Reads the catalog of a connection into a new file for <paramref name="alias"/>, to refresh
        /// <paramref name="previous"/> (<see cref="Merge"/>): a large catalog reads the columns of the tables of its
        /// subschemas and of the ones whose columns it had read (<see cref="TablesToRead"/>), and only the names of the
        /// others.
        /// </summary>
        /// <param name="connection">The connection (opened and closed here when it was closed).</param>
        /// <param name="alias">The connection alias.</param>
        /// <param name="previous">The file being refreshed; null for a new one.</param>
        public static LocalSchemaFile Generate(DbConnection connection, string alias, LocalSchemaFile previous)
        {
            return Generate(connection, alias, previous, DatabaseCatalogReader.LargeCatalogThreshold);
        }

        /// <summary>
        /// <see cref="Generate(DbConnection, string, LocalSchemaFile)"/> with the number of tables from which the
        /// catalog is large (tests lower it; 0 or less, never).
        /// </summary>
        public static LocalSchemaFile Generate(DbConnection connection, string alias, LocalSchemaFile previous, int largeCatalogThreshold)
        {
            return GenerateAsync(connection, alias, previous, largeCatalogThreshold, null, CancellationToken.None).GetAwaiter().GetResult();
        }

        /// <summary>
        /// <see cref="Generate(DbConnection, string, LocalSchemaFile, int)"/> reporting its progress to
        /// <paramref name="progress"/> (the opening of the connection, the queries, the rows of all of them) and stopping
        /// when <paramref name="cancellationToken"/> is cancelled: it throws <see cref="OperationCanceledException"/>.
        /// </summary>
        /// <param name="connection">The connection (opened and closed here when it was closed).</param>
        /// <param name="alias">The connection alias.</param>
        /// <param name="previous">The file being refreshed; null for a new one.</param>
        /// <param name="largeCatalogThreshold">The number of tables from which the catalog is large
        /// (<see cref="DatabaseCatalogReader.LargeCatalogThreshold"/>; 0 or less, never).</param>
        /// <param name="progress">Where the progress of the read is reported; null for nowhere.</param>
        /// <param name="cancellationToken">Stops the read.</param>
        public static Task<LocalSchemaFile> GenerateAsync(DbConnection connection, string alias, LocalSchemaFile previous, int largeCatalogThreshold,
            IProgress<DatabaseReadProgress> progress, CancellationToken cancellationToken)
        {
            if (connection == null)
                throw new ArgumentNullException("connection");
            var tracker = new DatabaseReadTracker(progress);
            return DatabaseCatalogReader.RunAsync(tracker, cancellationToken,
                () => GenerateCoreAsync(connection, alias, previous, largeCatalogThreshold, tracker, cancellationToken));
        }

        private static async Task<LocalSchemaFile> GenerateCoreAsync(DbConnection connection, string alias, LocalSchemaFile previous,
            int largeCatalogThreshold, DatabaseReadTracker tracker, CancellationToken cancellationToken)
        {
            bool opened = false;
            if (connection.State != System.Data.ConnectionState.Open)
            {
                await tracker.OpenAsync(connection, cancellationToken).ConfigureAwait(false);
                opened = true;
            }
            try
            {
                var file = new LocalSchemaFile();
                file.Alias = (alias ?? "").Trim().ToUpperInvariant();
                file.Dialect = DatabaseCatalogReader.DialectOf(connection);
                file.GeneratedUtc = DateTime.UtcNow.ToString("yyyy-MM-dd'T'HH:mm:ss'Z'", CultureInfo.InvariantCulture);
                file.Tables = await DatabaseCatalogReader.ReadTablesCoreAsync(connection, TablesToRead(previous), largeCatalogThreshold,
                    tracker, cancellationToken).ConfigureAwait(false);
                return file;
            }
            finally
            {
                if (opened)
                    connection.Close();
            }
        }

        /// <summary>
        /// The tables whose columns a new reading of a large catalog reads for <paramref name="file"/>: the tables of its
        /// subschemas and the ones whose columns it had read. None for null.
        /// </summary>
        public static List<string> TablesToRead(LocalSchemaFile file)
        {
            var result = new List<string>();
            if (file == null)
                return result;
            var seen = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
            if (file.Schemas != null)
                foreach (LocalSubschema s in file.Schemas)
                    if (s != null && s.Tables != null)
                        foreach (string name in s.Tables)
                            if (!string.IsNullOrEmpty(name) && seen.Add(name))
                                result.Add(name);
            if (file.Tables != null)
                foreach (LocalSchemaTable t in file.Tables)
                    if (t != null && !string.IsNullOrEmpty(t.Name) && IsRead(t) && seen.Add(t.Name))
                        result.Add(t.Name);
            return result;
        }

        /// <summary>True when the columns of the table were read from the catalog (<see cref="LocalSchemaTable.ColumnsRead"/> is not false).</summary>
        public static bool IsRead(LocalSchemaTable table)
        {
            return table != null && table.ColumnsRead != false;
        }

        /// <summary>
        /// True when the columns of some table of the file were not read: its catalog is large, and the columns of a table
        /// are read when it is used.
        /// </summary>
        public static bool IsLargeCatalog(LocalSchemaFile file)
        {
            return file != null && file.Tables != null && file.Tables.Exists(t => t != null && !IsRead(t));
        }

        /// <summary>
        /// The tables of the file among <paramref name="names"/> (ignoring case) whose columns were not read, as the file
        /// spells them, each once, in the order of <paramref name="names"/>.
        /// </summary>
        public static List<string> UnreadTables(LocalSchemaFile file, IEnumerable<string> names)
        {
            var result = new List<string>();
            if (file == null || file.Tables == null || names == null)
                return result;
            var unread = new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase);
            foreach (LocalSchemaTable t in file.Tables)
                if (t != null && !string.IsNullOrEmpty(t.Name) && !IsRead(t) && !unread.ContainsKey(t.Name))
                    unread.Add(t.Name, t.Name);
            var seen = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
            foreach (string name in names)
            {
                string spelled;
                if (!string.IsNullOrEmpty(name) && unread.TryGetValue(name.Trim(), out spelled) && seen.Add(spelled))
                    result.Add(spelled);
            }
            return result;
        }

        /// <summary>
        /// The columns of some tables, read when they are used, merged into <paramref name="file"/>: for each table of the
        /// file whose columns were not read (<see cref="IsRead"/>) that <paramref name="catalogTables"/> has (ignoring
        /// case), its columns, primary key and foreign keys as the catalog has them (the comments of the database as the
        /// contexts of its columns), its own description kept (the catalog's when it has none), and the mark removed. A
        /// table already read is not touched. Returns the names of the tables merged, as the file spells them.
        /// </summary>
        /// <param name="file">The file.</param>
        /// <param name="catalogTables">The tables as the catalog has them (<see cref="DatabaseCatalogReader.ReadTableDetails"/>).</param>
        public static List<string> MergeColumns(LocalSchemaFile file, IEnumerable<LocalSchemaTable> catalogTables)
        {
            if (file == null)
                throw new ArgumentNullException("file");
            var result = new List<string>();
            if (catalogTables == null || file.Tables == null)
                return result;
            var unread = new Dictionary<string, LocalSchemaTable>(StringComparer.OrdinalIgnoreCase);
            foreach (LocalSchemaTable t in file.Tables)
                if (t != null && !string.IsNullOrEmpty(t.Name) && !IsRead(t) && !unread.ContainsKey(t.Name))
                    unread.Add(t.Name, t);
            foreach (LocalSchemaTable read in catalogTables)
            {
                LocalSchemaTable table;
                if (read == null || string.IsNullOrEmpty(read.Name) || !unread.TryGetValue(read.Name, out table))
                    continue;
                unread.Remove(read.Name);
                table.Columns = read.Columns ?? new List<LocalSchemaColumn>();
                table.ForeignKeys = read.ForeignKeys ?? new List<LocalSchemaForeignKey>();
                if (string.IsNullOrEmpty(table.Context) && !string.IsNullOrEmpty(read.Context))
                    table.Context = read.Context;
                table.ColumnsRead = null;
                result.Add(table.Name);
            }
            return result;
        }

        /// <summary>
        /// Reads from the catalog of a connection the columns of the tables of <paramref name="tables"/> that
        /// <paramref name="file"/> has not read yet, with queries filtered by them, and merges them into it
        /// (<see cref="MergeColumns"/>): what the designers do when a table of a large catalog is used. The connection is
        /// opened and closed here when it was closed, and not opened at all when every table was read already. Returns the
        /// names of the tables merged; one the catalog no longer has stays as it was.
        /// </summary>
        /// <param name="file">The file.</param>
        /// <param name="connection">A connection to its database.</param>
        /// <param name="tables">The names of the tables (ignoring case).</param>
        public static List<string> ReadColumns(LocalSchemaFile file, DbConnection connection, IEnumerable<string> tables)
        {
            return ReadColumnsAsync(file, connection, tables, null, CancellationToken.None).GetAwaiter().GetResult();
        }

        /// <summary>
        /// <see cref="ReadColumns"/> reporting its progress to <paramref name="progress"/> and stopping when
        /// <paramref name="cancellationToken"/> is cancelled: it throws <see cref="OperationCanceledException"/>, and the file
        /// stays as it was (nothing is merged).
        /// </summary>
        /// <param name="file">The file.</param>
        /// <param name="connection">A connection to its database.</param>
        /// <param name="tables">The names of the tables (ignoring case).</param>
        /// <param name="progress">Where the progress of the read is reported; null for nowhere.</param>
        /// <param name="cancellationToken">Stops the read.</param>
        public static Task<List<string>> ReadColumnsAsync(LocalSchemaFile file, DbConnection connection, IEnumerable<string> tables,
            IProgress<DatabaseReadProgress> progress, CancellationToken cancellationToken)
        {
            if (file == null)
                throw new ArgumentNullException("file");
            if (connection == null)
                throw new ArgumentNullException("connection");
            var tracker = new DatabaseReadTracker(progress);
            return DatabaseCatalogReader.RunAsync(tracker, cancellationToken,
                () => ReadColumnsCoreAsync(file, connection, tables, tracker, cancellationToken));
        }

        private static async Task<List<string>> ReadColumnsCoreAsync(LocalSchemaFile file, DbConnection connection, IEnumerable<string> tables,
            DatabaseReadTracker tracker, CancellationToken cancellationToken)
        {
            List<string> unread = UnreadTables(file, tables);
            if (unread.Count == 0)
                return new List<string>();
            bool opened = false;
            if (connection.State != System.Data.ConnectionState.Open)
            {
                await tracker.OpenAsync(connection, cancellationToken).ConfigureAwait(false);
                opened = true;
            }
            try
            {
                List<LocalSchemaTable> read = await DatabaseCatalogReader.ReadTableDetailsCoreAsync(connection, unread, tracker, cancellationToken)
                    .ConfigureAwait(false);
                // Cancelled while it read: the file is not touched
                cancellationToken.ThrowIfCancellationRequested();
                return MergeColumns(file, read);
            }
            finally
            {
                if (opened)
                    connection.Close();
            }
        }

        /// <summary>
        /// The refreshed file: the tables of <paramref name="fresh"/> (just read from the catalog) with what
        /// <paramref name="previous"/> had that the catalog cannot know, for the tables, columns and foreign keys
        /// that still exist: the context written, the allowed values and the properties of a newer version; and
        /// the subschemas of <paramref name="previous"/> without the tables and columns that are gone. A table of a large
        /// catalog whose columns <paramref name="fresh"/> did not read and <paramref name="previous"/> had read keeps them,
        /// as they were, until they are read again.
        /// </summary>
        public static LocalSchemaFile Merge(LocalSchemaFile previous, LocalSchemaFile fresh)
        {
            if (fresh == null)
                throw new ArgumentNullException("fresh");
            Normalize(fresh);
            if (previous == null)
                return fresh;
            Normalize(previous);
            var oldTables = new Dictionary<string, LocalSchemaTable>(StringComparer.OrdinalIgnoreCase);
            foreach (LocalSchemaTable t in previous.Tables)
                if (!oldTables.ContainsKey(t.Name))
                    oldTables.Add(t.Name, t);
            var freshNames = new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase);
            var freshTables = new Dictionary<string, LocalSchemaTable>(StringComparer.OrdinalIgnoreCase);
            foreach (LocalSchemaTable table in fresh.Tables)
            {
                if (!freshNames.ContainsKey(table.Name))
                {
                    freshNames.Add(table.Name, table.Name);
                    freshTables.Add(table.Name, table);
                }
                LocalSchemaTable old;
                if (!oldTables.TryGetValue(table.Name, out old))
                    continue;
                if (!string.IsNullOrEmpty(old.Context))
                    table.Context = old.Context;
                table.Extra = old.Extra;
                if (!IsRead(table) && IsRead(old))
                {
                    // Read before and not in this reading (a large catalog read without it): what was read stays, the
                    // relations people added come back below as the others
                    table.Columns = old.Columns;
                    table.ForeignKeys = old.ForeignKeys.FindAll(fk => fk.ConstraintName.Length > 0);
                    table.ColumnsRead = null;
                    continue;
                }
                foreach (LocalSchemaColumn column in table.Columns)
                {
                    LocalSchemaColumn oldColumn = old.Columns.Find(c => string.Equals(c.Name, column.Name, StringComparison.OrdinalIgnoreCase));
                    if (oldColumn == null)
                        continue;
                    if (!string.IsNullOrEmpty(oldColumn.Context))
                        column.Context = oldColumn.Context;
                    column.AllowedValues = oldColumn.AllowedValues;
                    column.Extra = oldColumn.Extra;
                }
                foreach (LocalSchemaForeignKey fk in table.ForeignKeys)
                {
                    LocalSchemaForeignKey oldFk = old.ForeignKeys.Find(f => f.ConstraintName.Length > 0 &&
                        string.Equals(f.ConstraintName, fk.ConstraintName, StringComparison.OrdinalIgnoreCase));
                    if (oldFk == null)
                        continue;
                    if (!string.IsNullOrEmpty(oldFk.RelationshipContext))
                        fk.RelationshipContext = oldFk.RelationshipContext;
                    fk.Extra = oldFk.Extra;
                }
            }
            // The relations people added (no constraint name): the catalog does not know them, so they are kept
            // while both ends are still there, as the catalog spells them now. One the database declares now is
            // the database's, with what people wrote of it.
            foreach (LocalSchemaTable table in fresh.Tables)
            {
                LocalSchemaTable old;
                if (!oldTables.TryGetValue(table.Name, out old))
                    continue;
                foreach (LocalSchemaForeignKey oldFk in old.ForeignKeys)
                {
                    if (oldFk.ConstraintName.Length > 0)
                        continue;
                    LocalSchemaForeignKey manual = ManualRelation(freshTables, table, oldFk);
                    if (manual == null)
                        continue;
                    LocalSchemaForeignKey same = table.ForeignKeys.Find(fk => SameRelation(fk, manual));
                    if (same == null)
                        table.ForeignKeys.Add(manual);
                    else if (string.IsNullOrEmpty(same.RelationshipContext))
                        same.RelationshipContext = manual.RelationshipContext;
                }
            }
            fresh.Schemas = new List<LocalSubschema>();
            foreach (LocalSubschema schema in previous.Schemas)
            {
                // The relations left out stay left out: the catalog brings its foreign keys back on every reading.
                var kept = new LocalSubschema { Name = schema.Name, Description = schema.Description, ExcludedRelations = schema.ExcludedRelations, Extra = schema.Extra };
                foreach (string name in schema.Tables)
                {
                    string current;
                    if (freshNames.TryGetValue(name, out current) && !kept.Tables.Contains(current))
                        kept.Tables.Add(current);
                }
                // The columns chosen of each table that is still there, as the catalog spells them now.
                if (schema.Columns != null)
                {
                    foreach (KeyValuePair<string, List<string>> entry in schema.Columns)
                    {
                        LocalSchemaTable table;
                        if (!freshTables.TryGetValue(entry.Key, out table) || !kept.Tables.Contains(table.Name))
                            continue;
                        var columns = new List<string>();
                        foreach (string name in entry.Value)
                        {
                            LocalSchemaColumn column = table.Columns.Find(c => string.Equals(c.Name, name, StringComparison.OrdinalIgnoreCase));
                            if (column != null && !columns.Contains(column.Name))
                                columns.Add(column.Name);
                            else if (column == null && !IsRead(table) && !columns.Contains(name))
                                columns.Add(name); // columns not read: the choice stays as it was written
                        }
                        if (columns.Count > 0)
                        {
                            if (kept.Columns == null)
                                kept.Columns = new Dictionary<string, List<string>>();
                            kept.Columns[table.Name] = columns;
                        }
                    }
                }
                fresh.Schemas.Add(kept);
            }
            if (string.IsNullOrEmpty(fresh.Alias))
                fresh.Alias = previous.Alias;
            fresh.ExcludedRelations = previous.ExcludedRelations;
            fresh.Extra = previous.Extra;
            if (previous.Version > fresh.Version)
                fresh.Version = previous.Version;
            return fresh;
        }

        /// <summary>
        /// A relation added by hand to <paramref name="table"/>, as the fresh catalog spells its ends; null when an end
        /// is gone.
        /// </summary>
        private static LocalSchemaForeignKey ManualRelation(Dictionary<string, LocalSchemaTable> fresh, LocalSchemaTable table, LocalSchemaForeignKey old)
        {
            LocalSchemaTable target;
            if (string.IsNullOrEmpty(old.TargetTable) || !fresh.TryGetValue(old.TargetTable, out target))
                target = null;
            if (target == null || old.SourceColumns == null || old.TargetColumns == null || old.SourceColumns.Count == 0
                || old.SourceColumns.Count != old.TargetColumns.Count)
                return null;
            List<string> source = Spelled(table, old.SourceColumns);
            List<string> targetColumns = Spelled(target, old.TargetColumns);
            if (source == null || targetColumns == null)
                return null;
            return new LocalSchemaForeignKey
            {
                ConstraintName = "",
                TargetTable = target.Name,
                SourceColumns = source,
                TargetColumns = targetColumns,
                RelationshipContext = old.RelationshipContext,
                Extra = old.Extra
            };
        }

        /// <summary>The names as the table spells them; null when one is not a column of it.</summary>
        private static List<string> Spelled(LocalSchemaTable table, List<string> names)
        {
            var result = new List<string>();
            foreach (string name in names)
            {
                LocalSchemaColumn column = table.Columns.Find(c => string.Equals(c.Name, name, StringComparison.OrdinalIgnoreCase));
                if (column == null)
                    return null;
                result.Add(column.Name);
            }
            return result;
        }

        /// <summary>The same relation: the same target table over the same columns, whatever its name.</summary>
        public static bool SameRelation(LocalSchemaForeignKey a, LocalSchemaForeignKey b)
        {
            return string.Equals(a.TargetTable, b.TargetTable, StringComparison.OrdinalIgnoreCase)
                && SameNames(a.SourceColumns, b.SourceColumns) && SameNames(a.TargetColumns, b.TargetColumns);
        }

        private static bool SameNames(List<string> a, List<string> b)
        {
            if (a == null || b == null || a.Count != b.Count)
                return false;
            for (int i = 0; i < a.Count; i++)
                if (!string.Equals(a[i], b[i], StringComparison.OrdinalIgnoreCase))
                    return false;
            return true;
        }

        /// <summary>
        /// Whether the relation <paramref name="fk"/> of <paramref name="sourceTable"/> is left out: of every subschema
        /// (the file's list) or of <paramref name="subschema"/> (its own list; null: the file's list only). A relation
        /// left out never travels to the AI, nor is it offered as a suggestion there.
        /// </summary>
        public static bool IsExcluded(LocalSchemaFile file, LocalSubschema subschema, string sourceTable, LocalSchemaForeignKey fk)
        {
            if (fk == null)
                return false;
            return IndexOfRelation(file != null ? file.ExcludedRelations : null, sourceTable, fk) >= 0
                || IndexOfRelation(subschema != null ? subschema.ExcludedRelations : null, sourceTable, fk) >= 0;
        }

        /// <summary>
        /// Leaves the relation <paramref name="fk"/> of <paramref name="sourceTable"/> out of <paramref name="subschema"/>
        /// (a relation deleted in it, a suggestion discarded: the dictionary keeps it), or out of every subschema when
        /// <paramref name="subschema"/> is null (a relation of the catalog deleted from the dictionary). Once.
        /// </summary>
        public static void Exclude(LocalSchemaFile file, LocalSubschema subschema, string sourceTable, LocalSchemaForeignKey fk)
        {
            if (file == null)
                throw new ArgumentNullException("file");
            if (fk == null)
                throw new ArgumentNullException("fk");
            List<LocalRelationRef> list;
            if (subschema != null)
            {
                if (subschema.ExcludedRelations == null)
                    subschema.ExcludedRelations = new List<LocalRelationRef>();
                list = subschema.ExcludedRelations;
            }
            else
            {
                if (file.ExcludedRelations == null)
                    file.ExcludedRelations = new List<LocalRelationRef>();
                list = file.ExcludedRelations;
            }
            if (IndexOfRelation(list, sourceTable, fk) >= 0)
                return;
            list.Add(new LocalRelationRef
            {
                SourceTable = sourceTable ?? "",
                SourceColumns = new List<string>(fk.SourceColumns ?? new List<string>()),
                TargetTable = fk.TargetTable ?? "",
                TargetColumns = new List<string>(fk.TargetColumns ?? new List<string>())
            });
        }

        /// <summary>
        /// The relation <paramref name="fk"/> of <paramref name="sourceTable"/> added again: out of the list of
        /// <paramref name="subschema"/> (when not null) and of the file's, instead of a second copy of it. True when it
        /// was in one of them.
        /// </summary>
        public static bool Unexclude(LocalSchemaFile file, LocalSubschema subschema, string sourceTable, LocalSchemaForeignKey fk)
        {
            if (fk == null)
                return false;
            bool removed = false;
            if (subschema != null && subschema.ExcludedRelations != null)
            {
                removed |= subschema.ExcludedRelations.RemoveAll(r => Refers(r, sourceTable, fk)) > 0;
                if (subschema.ExcludedRelations.Count == 0)
                    subschema.ExcludedRelations = null;
            }
            if (file != null && file.ExcludedRelations != null)
            {
                removed |= file.ExcludedRelations.RemoveAll(r => Refers(r, sourceTable, fk)) > 0;
                if (file.ExcludedRelations.Count == 0)
                    file.ExcludedRelations = null;
            }
            return removed;
        }

        internal static int IndexOfRelation(List<LocalRelationRef> list, string sourceTable, LocalSchemaForeignKey fk)
        {
            if (list == null)
                return -1;
            return list.FindIndex(r => Refers(r, sourceTable, fk));
        }

        /// <summary>The same ends: source and target tables and their columns in order, ignoring case.</summary>
        private static bool Refers(LocalRelationRef r, string sourceTable, LocalSchemaForeignKey fk)
        {
            return r != null
                && string.Equals(r.SourceTable ?? "", sourceTable ?? "", StringComparison.OrdinalIgnoreCase)
                && string.Equals(r.TargetTable ?? "", fk.TargetTable ?? "", StringComparison.OrdinalIgnoreCase)
                && SameNames(r.SourceColumns ?? new List<string>(), fk.SourceColumns ?? new List<string>())
                && SameNames(r.TargetColumns ?? new List<string>(), fk.TargetColumns ?? new List<string>());
        }

        /// <summary>
        /// The file of <paramref name="alias"/> in <paramref name="folder"/>: read when it exists, generated
        /// from the catalog (and saved) the first time, regenerated keeping what the user wrote when
        /// <paramref name="refresh"/> is true.
        /// </summary>
        /// <param name="folder">The dbxschemas folder.</param>
        /// <param name="alias">Connection alias.</param>
        /// <param name="createConnection">Creates a connection to read the catalog from (opened and closed here).</param>
        /// <param name="refresh">Regenerate the tables even when the file exists.</param>
        public static LocalSchemaFile LoadOrGenerate(string folder, string alias, Func<DbConnection> createConnection, bool refresh)
        {
            return LoadOrGenerate(folder, alias, createConnection, refresh, DatabaseCatalogReader.LargeCatalogThreshold);
        }

        /// <summary>
        /// <see cref="LoadOrGenerate(string, string, Func{DbConnection}, bool)"/> with the number of tables from which the
        /// catalog is large (tests lower it; 0 or less, never): a refresh of a large catalog reads again the columns of the
        /// tables of the subschemas and of the ones the file had read (<see cref="TablesToRead"/>).
        /// </summary>
        public static LocalSchemaFile LoadOrGenerate(string folder, string alias, Func<DbConnection> createConnection, bool refresh,
            int largeCatalogThreshold)
        {
            return LoadOrGenerateAsync(folder, alias, createConnection, refresh, largeCatalogThreshold, null, CancellationToken.None)
                .GetAwaiter().GetResult();
        }

        /// <summary>
        /// <see cref="LoadOrGenerate(string, string, Func{DbConnection}, bool, int)"/> reporting the progress of the read of
        /// the catalog (none when the file exists and is not refreshed) to <paramref name="progress"/>, and stopping when
        /// <paramref name="cancellationToken"/> is cancelled: it throws <see cref="OperationCanceledException"/>, and the file
        /// stays as it was (or is not created).
        /// </summary>
        /// <param name="folder">The dbxschemas folder.</param>
        /// <param name="alias">Connection alias.</param>
        /// <param name="createConnection">Creates a connection to read the catalog from (opened and closed here).</param>
        /// <param name="refresh">Regenerate the tables even when the file exists.</param>
        /// <param name="largeCatalogThreshold">The number of tables from which the catalog is large
        /// (<see cref="DatabaseCatalogReader.LargeCatalogThreshold"/>; 0 or less, never).</param>
        /// <param name="progress">Where the progress of the read is reported; null for nowhere.</param>
        /// <param name="cancellationToken">Stops the read.</param>
        public static async Task<LocalSchemaFile> LoadOrGenerateAsync(string folder, string alias, Func<DbConnection> createConnection, bool refresh,
            int largeCatalogThreshold, IProgress<DatabaseReadProgress> progress, CancellationToken cancellationToken)
        {
            string path = PathFor(folder, alias);
            LocalSchemaFile existing = Load(path);
            if (existing != null && !refresh)
                return existing;
            if (createConnection == null)
                throw new InvalidOperationException("No connection to read the schema of " + alias);
            LocalSchemaFile fresh;
            using (DbConnection connection = createConnection())
                fresh = await GenerateAsync(connection, alias, existing, largeCatalogThreshold, progress, cancellationToken).ConfigureAwait(false);
            // Cancelled while it read: nothing is written
            cancellationToken.ThrowIfCancellationRequested();
            LocalSchemaFile result = Merge(existing, fresh);
            Save(result, path);
            return result;
        }

        /// <summary>The tables of a subschema, or all of them when <paramref name="subschema"/> is empty or unknown.</summary>
        public static List<LocalSchemaTable> TablesOf(LocalSchemaFile file, string subschema)
        {
            var result = new List<LocalSchemaTable>();
            if (file == null)
                return result;
            LocalSubschema selected = FindSubschema(file, subschema);
            if (selected == null)
            {
                result.AddRange(file.Tables);
                return result;
            }
            foreach (LocalSchemaTable table in file.Tables)
            {
                if (selected.Tables.Exists(n => string.Equals(n, table.Name, StringComparison.OrdinalIgnoreCase)))
                    result.Add(table);
            }
            return result;
        }

        /// <summary>
        /// The columns of a table, in the order of the catalog: without a subschema («all the tables»), every one;
        /// in a subschema, the ones it chose, and only the primary key when it chose none for that table (people
        /// choose the columns and describe them: a column like CODPRIN without a word misleads the AI).
        /// </summary>
        public static List<LocalSchemaColumn> ColumnsOf(LocalSubschema subschema, LocalSchemaTable table)
        {
            var result = new List<LocalSchemaColumn>();
            if (table == null)
                return result;
            List<string> chosen = ChosenColumns(subschema, table.Name);
            foreach (LocalSchemaColumn column in table.Columns)
                if (subschema == null
                    || (chosen == null ? column.IsPrimaryKey : chosen.Exists(n => string.Equals(n, column.Name, StringComparison.OrdinalIgnoreCase))))
                    result.Add(column);
            return result;
        }

        private static List<string> ChosenColumns(LocalSubschema subschema, string table)
        {
            if (subschema == null || subschema.Columns == null)
                return null;
            foreach (KeyValuePair<string, List<string>> entry in subschema.Columns)
                if (string.Equals(entry.Key, table, StringComparison.OrdinalIgnoreCase) && entry.Value != null && entry.Value.Count > 0)
                    return entry.Value;
            return null;
        }

        /// <summary>The subschema with that name (ignoring case), or null.</summary>
        public static LocalSubschema FindSubschema(LocalSchemaFile file, string subschema)
        {
            if (file == null || string.IsNullOrWhiteSpace(subschema))
                return null;
            return file.Schemas.Find(s => string.Equals(s.Name, subschema.Trim(), StringComparison.OrdinalIgnoreCase));
        }

        /// <summary>
        /// The database configuration the copilot sends inline for a direct connection:
        /// <c>{ name: ALIAS, dialect, schemaTables, schemaName, hubDatabaseId: 0, hubSchemaId: 0 }</c>, with the tables of
        /// the chosen subschema (all of them when empty) and, of each one, the columns it chose, their allowed
        /// values, and the relations whose two ends are in what travels and that are not left out (<see cref="IsExcluded"/>:
        /// the file's list, and the subschema's). The name is the connection alias: the
        /// AI puts a new dataset on the connection with that name, and records the subschema's name in it
        /// (<c>schemaName</c>, empty for all the tables).
        /// </summary>
        public static Dictionary<string, object> BuildInlineConfig(LocalSchemaFile file, string subschema)
        {
            if (file == null)
                throw new ArgumentNullException("file");
            LocalSubschema selected = FindSubschema(file, subschema);
            List<LocalSchemaTable> chosenTables = TablesOf(file, subschema);
            var travels = new Dictionary<string, List<LocalSchemaColumn>>(StringComparer.OrdinalIgnoreCase);
            foreach (LocalSchemaTable t in chosenTables)
                travels[t.Name] = ColumnsOf(selected, t);
            var tables = new List<object>();
            foreach (LocalSchemaTable t in chosenTables)
            {
                var columns = new List<object>();
                foreach (LocalSchemaColumn c in travels[t.Name])
                {
                    var column = new Dictionary<string, object>
                    {
                        { "name", c.Name },
                        { "dataType", CloudColumnType(c.DataType, c.DetectedType) },
                        { "context", c.Context ?? "" },
                        { "isPrimaryKey", c.IsPrimaryKey },
                        { "detectedType", c.DetectedType ?? "" }
                    };
                    if (c.AllowedValues != null && c.AllowedValues.Count > 0)
                    {
                        var values = new List<object>();
                        foreach (LocalAllowedValue v in c.AllowedValues)
                            values.Add(new Dictionary<string, object> { { "value", v.Value ?? "" }, { "label", v.Label ?? "" } });
                        column.Add("allowedValues", values);
                    }
                    columns.Add(column);
                }
                var foreignKeys = new List<object>();
                foreach (LocalSchemaForeignKey fk in t.ForeignKeys)
                {
                    // A relation travels when its two ends do: a column the AI does not see is no use to it. Nor one
                    // people left out, of every subschema or of this one.
                    if (selected != null && (!Travels(travels, t.Name, fk.SourceColumns) || !Travels(travels, fk.TargetTable, fk.TargetColumns)))
                        continue;
                    if (IsExcluded(file, selected, t.Name, fk))
                        continue;
                    foreignKeys.Add(new Dictionary<string, object>
                    {
                        { "constraintName", fk.ConstraintName ?? "" },
                        { "targetTable", fk.TargetTable ?? "" },
                        { "sourceColumns", fk.SourceColumns ?? new List<string>() },
                        { "targetColumns", fk.TargetColumns ?? new List<string>() },
                        { "relationshipContext", fk.RelationshipContext ?? "" }
                    });
                }
                tables.Add(new Dictionary<string, object>
                {
                    { "name", t.Name },
                    { "context", t.Context ?? "" },
                    { "columns", columns },
                    { "foreignKeys", foreignKeys }
                });
            }
            return new Dictionary<string, object>
            {
                { "name", file.Alias },
                { "dialect", CloudDialect(file.Dialect) },
                { "hubDatabaseId", 0 },
                { "hubSchemaId", 0 },
                { "schemaName", selected != null ? selected.Name : "" },
                { "schemaTables", tables }
            };
        }

        private static bool Travels(Dictionary<string, List<LocalSchemaColumn>> travels, string table, List<string> columns)
        {
            List<LocalSchemaColumn> kept;
            if (string.IsNullOrEmpty(table) || !travels.TryGetValue(table, out kept))
                return false;
            foreach (string name in columns ?? new List<string>())
                if (!kept.Exists(c => string.Equals(c.Name, name, StringComparison.OrdinalIgnoreCase)))
                    return false;
            return true;
        }

        /// <summary>
        /// A Reportman AI dialect name for whatever the file says: the exact names pass, a plain
        /// "Firebird" (or another family name written by hand) becomes the closest one, anything else Default.
        /// </summary>
        public static string CloudDialect(string dialect)
        {
            string d = (dialect ?? "").Trim();
            foreach (string known in CloudDialects)
                if (string.Equals(known, d, StringComparison.OrdinalIgnoreCase))
                    return known;
            string u = d.ToUpperInvariant();
            if (u.StartsWith("FIREBIRD") || u == "INTERBASE")
                return "Firebird5";
            if (u.Contains("POSTGRES"))
                return "PostgreSQL";
            if (u.Contains("SQLITE"))
                return "SQLite";
            if (u.Contains("MYSQL") || u.Contains("MARIADB"))
                return "MySQL";
            if (u.Contains("ORACLE"))
                return "Oracle";
            if (u.Contains("SQLSERVER") || u.Contains("MSSQL") || u == "SQL SERVER")
                return "SQLServer";
            return "Default";
        }

        /// <summary>
        /// A Reportman AI column type name for a column of the file: an exact type name passes (any case);
        /// otherwise it is deduced from the declared database type ("VARCHAR(40)", "INTEGER"...).
        /// </summary>
        public static string CloudColumnType(string dataType, string detectedType)
        {
            string d = (dataType ?? "").Trim();
            foreach (string known in CloudColumnTypes)
                if (known != "None" && string.Equals(known, d, StringComparison.OrdinalIgnoreCase))
                    return known;
            string loose = d.Length > 0 ? d : (detectedType ?? "");
            return DatabaseCatalogReader.LooseType(loose);
        }

        internal static void Normalize(LocalSchemaFile file)
        {
            if (file.Alias == null) file.Alias = "";
            if (file.Dialect == null) file.Dialect = "Default";
            if (file.GeneratedUtc == null) file.GeneratedUtc = "";
            if (file.Tables == null) file.Tables = new List<LocalSchemaTable>();
            if (file.Schemas == null) file.Schemas = new List<LocalSubschema>();
            file.Tables.RemoveAll(t => t == null || string.IsNullOrEmpty(t.Name));
            foreach (LocalSchemaTable t in file.Tables)
            {
                if (t.Context == null) t.Context = "";
                // Read is written as nothing, as every file before the mark
                if (t.ColumnsRead == true) t.ColumnsRead = null;
                if (t.Columns == null) t.Columns = new List<LocalSchemaColumn>();
                if (t.ForeignKeys == null) t.ForeignKeys = new List<LocalSchemaForeignKey>();
                t.Columns.RemoveAll(c => c == null || string.IsNullOrEmpty(c.Name));
                foreach (LocalSchemaColumn c in t.Columns)
                {
                    if (c.DataType == null) c.DataType = "String";
                    if (c.Context == null) c.Context = "";
                    if (c.DetectedType == null) c.DetectedType = "";
                    if (c.AllowedValues != null)
                    {
                        c.AllowedValues.RemoveAll(v => v == null || string.IsNullOrEmpty(v.Value));
                        foreach (LocalAllowedValue v in c.AllowedValues)
                            if (v.Label == null) v.Label = "";
                        if (c.AllowedValues.Count == 0) c.AllowedValues = null;
                    }
                }
                t.ForeignKeys.RemoveAll(f => f == null);
                foreach (LocalSchemaForeignKey f in t.ForeignKeys)
                {
                    if (f.ConstraintName == null) f.ConstraintName = "";
                    if (f.TargetTable == null) f.TargetTable = "";
                    if (f.SourceColumns == null) f.SourceColumns = new List<string>();
                    if (f.TargetColumns == null) f.TargetColumns = new List<string>();
                    if (f.RelationshipContext == null) f.RelationshipContext = "";
                }
            }
            file.Schemas.RemoveAll(s => s == null || string.IsNullOrWhiteSpace(s.Name));
            foreach (LocalSubschema s in file.Schemas)
            {
                if (s.Description == null) s.Description = "";
                if (s.Tables == null) s.Tables = new List<string>();
                s.Tables.RemoveAll(n => string.IsNullOrEmpty(n));
                if (s.Columns != null)
                {
                    // Only tables of the subschema, and only tables with columns chosen (none chosen is all).
                    var columns = new Dictionary<string, List<string>>();
                    foreach (KeyValuePair<string, List<string>> entry in s.Columns)
                    {
                        if (string.IsNullOrEmpty(entry.Key) || entry.Value == null)
                            continue;
                        string table = s.Tables.Find(n => string.Equals(n, entry.Key, StringComparison.OrdinalIgnoreCase));
                        var names = entry.Value.FindAll(n => !string.IsNullOrEmpty(n));
                        if (table != null && names.Count > 0 && !columns.ContainsKey(table))
                            columns.Add(table, names);
                    }
                    s.Columns = columns.Count > 0 ? columns : null;
                }
                s.ExcludedRelations = NormalizeRelations(s.ExcludedRelations);
            }
            file.ExcludedRelations = NormalizeRelations(file.ExcludedRelations);
        }

        /// <summary>A list of relations left out: without the entries that name no table, each one once; null when empty.</summary>
        private static List<LocalRelationRef> NormalizeRelations(List<LocalRelationRef> list)
        {
            if (list == null)
                return null;
            var result = new List<LocalRelationRef>();
            foreach (LocalRelationRef r in list)
            {
                if (r == null || string.IsNullOrEmpty(r.SourceTable) || string.IsNullOrEmpty(r.TargetTable))
                    continue;
                if (r.SourceColumns == null) r.SourceColumns = new List<string>();
                if (r.TargetColumns == null) r.TargetColumns = new List<string>();
                var fk = new LocalSchemaForeignKey { TargetTable = r.TargetTable, SourceColumns = r.SourceColumns, TargetColumns = r.TargetColumns };
                if (IndexOfRelation(result, r.SourceTable, fk) < 0)
                    result.Add(r);
            }
            return result.Count > 0 ? result : null;
        }
    }
}
