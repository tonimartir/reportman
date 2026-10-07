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

namespace Reportman.Reporting
{
    /// <summary>
    /// The schema of a direct connection kept in a local file, <c>dbxschemas/&lt;ALIAS&gt;.json</c> in the
    /// folder of <c>dbxconnections.ini</c>, shared by the Delphi and .Net designers and Reportman Server.
    /// It holds every table of the database catalog (the default "all tables" schema, which is not stored
    /// as a named schema) and the subschemas the user defines (a name and a selection of tables). The
    /// table shape is the one of the Reportman AI schemas (SchemaTable), so the tables can be sent to the
    /// AI inline without conversion.
    /// </summary>
    public class LocalSchemaFile
    {
        /// <summary>Format version, currently 1.</summary>
        public int Version { get; set; } = 1;
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
    }

    /// <summary>A subschema of a <see cref="LocalSchemaFile"/>: a name and a selection of its tables.</summary>
    public class LocalSubschema
    {
        /// <summary>Subschema name.</summary>
        public string Name { get; set; } = "";
        /// <summary>Optional description.</summary>
        public string Description { get; set; } = "";
        /// <summary>Names of tables of <see cref="LocalSchemaFile.Tables"/>.</summary>
        public List<string> Tables { get; set; } = new List<string>();
    }

    /// <summary>
    /// Reads, writes, generates and refreshes <see cref="LocalSchemaFile"/> files, and builds the inline
    /// schema configuration the Reportman AI copilot needs for a direct connection.
    /// </summary>
    public static class LocalSchemaStore
    {
        /// <summary>Name of the folder, next to dbxconnections.ini, that holds the files.</summary>
        public const string FolderName = "dbxschemas";

        private static readonly string[] CloudColumnTypes =
            { "None", "Integer", "Numeric", "Currency", "String", "TextLong", "Date", "TimeStamp", "Boolean" };

        private static readonly string[] CloudDialects =
            { "Default", "SQLServer", "MySQL", "PostgreSQL", "Oracle", "SQLite", "Firebird1", "Firebird2", "Firebird4", "Firebird5", "Progress", "Firebird2Dialect1" };

        private static JsonSerializerOptions CreateJsonOptions()
        {
            return new JsonSerializerOptions
            {
                PropertyNamingPolicy = JsonNamingPolicy.CamelCase,
                PropertyNameCaseInsensitive = true,
                WriteIndented = true,
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
            string text = File.ReadAllText(path, Encoding.UTF8);
            LocalSchemaFile file = JsonSerializer.Deserialize<LocalSchemaFile>(text, CreateJsonOptions()) ?? new LocalSchemaFile();
            Normalize(file);
            return file;
        }

        /// <summary>Writes a file (UTF-8 without BOM), creating its folder when needed.</summary>
        public static void Save(LocalSchemaFile file, string path)
        {
            if (file == null)
                throw new ArgumentNullException("file");
            Normalize(file);
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
        /// Reads the catalog of an open or closed connection (it is opened and closed here when it was
        /// closed) into a new file for <paramref name="alias"/>.
        /// </summary>
        public static LocalSchemaFile Generate(DbConnection connection, string alias)
        {
            if (connection == null)
                throw new ArgumentNullException("connection");
            bool opened = false;
            if (connection.State != System.Data.ConnectionState.Open)
            {
                connection.Open();
                opened = true;
            }
            try
            {
                var file = new LocalSchemaFile();
                file.Alias = (alias ?? "").Trim().ToUpperInvariant();
                file.Dialect = DatabaseCatalogReader.DialectOf(connection);
                file.GeneratedUtc = DateTime.UtcNow.ToString("yyyy-MM-dd'T'HH:mm:ss'Z'", CultureInfo.InvariantCulture);
                file.Tables = DatabaseCatalogReader.ReadTables(connection);
                return file;
            }
            finally
            {
                if (opened)
                    connection.Close();
            }
        }

        /// <summary>
        /// The refreshed file: the tables of <paramref name="fresh"/> (just read from the catalog) with the
        /// context written in <paramref name="previous"/> for the tables, columns and foreign keys that
        /// still exist, and the subschemas of <paramref name="previous"/> without the tables that are gone.
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
            foreach (LocalSchemaTable table in fresh.Tables)
            {
                if (!freshNames.ContainsKey(table.Name))
                    freshNames.Add(table.Name, table.Name);
                LocalSchemaTable old;
                if (!oldTables.TryGetValue(table.Name, out old))
                    continue;
                if (!string.IsNullOrEmpty(old.Context))
                    table.Context = old.Context;
                foreach (LocalSchemaColumn column in table.Columns)
                {
                    LocalSchemaColumn oldColumn = old.Columns.Find(c => string.Equals(c.Name, column.Name, StringComparison.OrdinalIgnoreCase));
                    if (oldColumn != null && !string.IsNullOrEmpty(oldColumn.Context))
                        column.Context = oldColumn.Context;
                }
                foreach (LocalSchemaForeignKey fk in table.ForeignKeys)
                {
                    LocalSchemaForeignKey oldFk = old.ForeignKeys.Find(f => f.ConstraintName.Length > 0 &&
                        string.Equals(f.ConstraintName, fk.ConstraintName, StringComparison.OrdinalIgnoreCase));
                    if (oldFk != null && !string.IsNullOrEmpty(oldFk.RelationshipContext))
                        fk.RelationshipContext = oldFk.RelationshipContext;
                }
            }
            fresh.Schemas = new List<LocalSubschema>();
            foreach (LocalSubschema schema in previous.Schemas)
            {
                var kept = new LocalSubschema { Name = schema.Name, Description = schema.Description };
                foreach (string name in schema.Tables)
                {
                    string current;
                    if (freshNames.TryGetValue(name, out current) && !kept.Tables.Contains(current))
                        kept.Tables.Add(current);
                }
                fresh.Schemas.Add(kept);
            }
            if (string.IsNullOrEmpty(fresh.Alias))
                fresh.Alias = previous.Alias;
            return fresh;
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
            string path = PathFor(folder, alias);
            LocalSchemaFile existing = Load(path);
            if (existing != null && !refresh)
                return existing;
            if (createConnection == null)
                throw new InvalidOperationException("No connection to read the schema of " + alias);
            LocalSchemaFile fresh;
            using (DbConnection connection = createConnection())
                fresh = Generate(connection, alias);
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

        /// <summary>The subschema with that name (ignoring case), or null.</summary>
        public static LocalSubschema FindSubschema(LocalSchemaFile file, string subschema)
        {
            if (file == null || string.IsNullOrWhiteSpace(subschema))
                return null;
            return file.Schemas.Find(s => string.Equals(s.Name, subschema.Trim(), StringComparison.OrdinalIgnoreCase));
        }

        /// <summary>
        /// The database configuration the copilot sends inline for a direct connection:
        /// <c>{ name: ALIAS, dialect, schemaTables, hubDatabaseId: 0, hubSchemaId: 0 }</c>, with the tables of
        /// the chosen subschema (all of them when empty). The name is the connection alias: the AI puts a
        /// new dataset on the connection with that name.
        /// </summary>
        public static Dictionary<string, object> BuildInlineConfig(LocalSchemaFile file, string subschema)
        {
            if (file == null)
                throw new ArgumentNullException("file");
            var tables = new List<object>();
            foreach (LocalSchemaTable t in TablesOf(file, subschema))
            {
                var columns = new List<object>();
                foreach (LocalSchemaColumn c in t.Columns)
                {
                    columns.Add(new Dictionary<string, object>
                    {
                        { "name", c.Name },
                        { "dataType", CloudColumnType(c.DataType, c.DetectedType) },
                        { "context", c.Context ?? "" },
                        { "isPrimaryKey", c.IsPrimaryKey },
                        { "detectedType", c.DetectedType ?? "" }
                    });
                }
                var foreignKeys = new List<object>();
                foreach (LocalSchemaForeignKey fk in t.ForeignKeys)
                {
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
                { "schemaTables", tables }
            };
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

        private static void Normalize(LocalSchemaFile file)
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
                if (t.Columns == null) t.Columns = new List<LocalSchemaColumn>();
                if (t.ForeignKeys == null) t.ForeignKeys = new List<LocalSchemaForeignKey>();
                t.Columns.RemoveAll(c => c == null || string.IsNullOrEmpty(c.Name));
                foreach (LocalSchemaColumn c in t.Columns)
                {
                    if (c.DataType == null) c.DataType = "String";
                    if (c.Context == null) c.Context = "";
                    if (c.DetectedType == null) c.DetectedType = "";
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
            }
        }
    }
}
