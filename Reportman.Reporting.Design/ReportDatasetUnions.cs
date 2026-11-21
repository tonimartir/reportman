using System;
using System.Collections.Generic;
using System.Globalization;
using Reportman.Reporting;

namespace Reportman.Reporting.Design
{
    /// <summary>
    /// A column of a dataset as the design tools see it: its name and a type name in the vocabulary
    /// of whoever gives it (the column blocks of the AI context use string, integer, currency...).
    /// </summary>
    public sealed class DatasetColumnInfo
    {
        /// <summary>Initializes a column with its name and type name.</summary>
        /// <param name="name">The column name.</param>
        /// <param name="typeName">The type name of the column.</param>
        public DatasetColumnInfo(string name, string typeName)
        {
            Name = name ?? string.Empty;
            TypeName = typeName ?? string.Empty;
        }

        /// <summary>The column name.</summary>
        public string Name { get; private set; }

        /// <summary>The type name of the column.</summary>
        public string TypeName { get; private set; }
    }

    /// <summary>
    /// Unions of datasets, as the engine builds them (DataInfo.BuildUnion): a dataset of a connection
    /// whose driver is <see cref="DriverType.Mybase"/> runs no SQL, its rows come from other datasets
    /// of the report listed in <see cref="DataInfo.DataUnions"/>, each entry "ALIAS" or, for a
    /// parallel union, "ALIAS-FIELD1;FIELD2" (the fields that match its rows with the first dataset).
    /// </summary>
    public static class ReportDatasetUnions
    {
        /// <summary>
        /// The connection of a database alias: the one with that exact alias, else the first one with
        /// it ignoring case. Null when the report has none.
        /// </summary>
        /// <param name="report">The report.</param>
        /// <param name="databaseAlias">The connection alias a dataset names.</param>
        /// <returns>The connection, or null.</returns>
        public static DatabaseInfo FindConnection(BaseReport report, string databaseAlias)
        {
            if (report == null || report.DatabaseInfo == null || string.IsNullOrEmpty(databaseAlias))
                return null;
            DatabaseInfo ignoringCase = null;
            foreach (DatabaseInfo database in report.DatabaseInfo)
            {
                if (database == null || database.Alias == null)
                    continue;
                if (string.Equals(database.Alias, databaseAlias, StringComparison.Ordinal))
                    return database;
                if (ignoringCase == null && string.Equals(database.Alias, databaseAlias, StringComparison.OrdinalIgnoreCase))
                    ignoringCase = database;
            }
            return ignoringCase;
        }

        /// <summary>Whether a connection is the in-memory one (driver Mybase): it opens no database.</summary>
        /// <param name="database">The connection.</param>
        /// <returns>True for a Mybase connection.</returns>
        public static bool IsMemoryConnection(DatabaseInfo database)
        {
            return database != null && database.Driver == DriverType.Mybase;
        }

        /// <summary>Whether a dataset belongs to an in-memory (Mybase) connection: it runs no SQL.</summary>
        /// <param name="report">The report of the dataset.</param>
        /// <param name="dataInfo">The dataset.</param>
        /// <returns>True when its connection is a Mybase one.</returns>
        public static bool IsMemoryDataset(BaseReport report, DataInfo dataInfo)
        {
            return dataInfo != null && IsMemoryConnection(FindConnection(report, dataInfo.DatabaseAlias));
        }

        /// <summary>Whether a dataset is a union of datasets: of a Mybase connection, with some entry in DataUnions.</summary>
        /// <param name="report">The report of the dataset.</param>
        /// <param name="dataInfo">The dataset.</param>
        /// <returns>True for a union.</returns>
        public static bool IsUnion(BaseReport report, DataInfo dataInfo)
        {
            return IsMemoryDataset(report, dataInfo) && GetEntries(dataInfo).Count > 0;
        }

        /// <summary>The entries of DataUnions that are not blank, trimmed.</summary>
        /// <param name="dataInfo">The dataset.</param>
        /// <returns>The entries, in order.</returns>
        public static IList<string> GetEntries(DataInfo dataInfo)
        {
            var entries = new List<string>();
            if (dataInfo == null || dataInfo.DataUnions == null)
                return entries;
            foreach (string entry in dataInfo.DataUnions)
            {
                if (!string.IsNullOrWhiteSpace(entry))
                    entries.Add(entry.Trim());
            }
            return entries;
        }

        /// <summary>The dataset alias of a union entry: the text before its first '-', as the engine reads it.</summary>
        /// <param name="entry">A DataUnions entry.</param>
        /// <returns>The alias of the source dataset.</returns>
        public static string GetSourceAlias(string entry)
        {
            if (entry == null)
                return string.Empty;
            int index = entry.IndexOf('-');
            return (index < 0 ? entry : entry.Substring(0, index)).Trim();
        }

        /// <summary>The common fields of a union entry (after its first '-', separated by ';'), in upper case.</summary>
        /// <param name="entry">A DataUnions entry.</param>
        /// <returns>The common fields; empty when the entry has none.</returns>
        public static IList<string> GetCommonFields(string entry)
        {
            var fields = new List<string>();
            if (entry == null)
                return fields;
            int index = entry.IndexOf('-');
            if (index < 0)
                return fields;
            foreach (string field in entry.Substring(index + 1).Split(';'))
            {
                string trimmed = field.Trim();
                if (trimmed.Length > 0)
                    fields.Add(trimmed.ToUpperInvariant());
            }
            return fields;
        }

        /// <summary>The entry with another source alias, keeping its common fields part ("-FIELD1;FIELD2").</summary>
        /// <param name="entry">A DataUnions entry.</param>
        /// <param name="newAlias">The new alias of its source dataset.</param>
        /// <returns>The renamed entry.</returns>
        public static string WithSourceAlias(string entry, string newAlias)
        {
            if (entry == null)
                return newAlias ?? string.Empty;
            int index = entry.IndexOf('-');
            return (newAlias ?? string.Empty) + (index < 0 ? string.Empty : entry.Substring(index));
        }

        /// <summary>Whether an entry reads the dataset of an alias (ignoring case).</summary>
        /// <param name="entry">A DataUnions entry.</param>
        /// <param name="datasetAlias">A dataset alias.</param>
        /// <returns>True when the entry names that dataset.</returns>
        public static bool EntryReads(string entry, string datasetAlias)
        {
            return !string.IsNullOrWhiteSpace(datasetAlias)
                && string.Equals(GetSourceAlias(entry), datasetAlias.Trim(), StringComparison.OrdinalIgnoreCase);
        }

        /// <summary>The aliases of the source datasets of a union, in the order of DataUnions.</summary>
        /// <param name="dataInfo">The union.</param>
        /// <returns>The source aliases.</returns>
        public static IList<string> GetSourceAliases(DataInfo dataInfo)
        {
            var aliases = new List<string>();
            foreach (string entry in GetEntries(dataInfo))
                aliases.Add(GetSourceAlias(entry));
            return aliases;
        }

        /// <summary>The unions of the report (datasets of a Mybase connection) with an entry that reads a dataset alias.</summary>
        /// <param name="report">The report.</param>
        /// <param name="datasetAlias">The alias of a dataset.</param>
        /// <returns>The unions that read it, in report order.</returns>
        public static IList<DataInfo> FindUnionsReading(BaseReport report, string datasetAlias)
        {
            var unions = new List<DataInfo>();
            if (report == null || report.DataInfo == null || string.IsNullOrWhiteSpace(datasetAlias))
                return unions;
            foreach (DataInfo candidate in report.DataInfo)
            {
                if (!IsMemoryDataset(report, candidate))
                    continue;
                foreach (string entry in GetEntries(candidate))
                {
                    if (EntryReads(entry, datasetAlias))
                    {
                        unions.Add(candidate);
                        break;
                    }
                }
            }
            return unions;
        }

        /// <summary>
        /// The prefix of the columns a parallel union adds for the dataset at a position of DataUnions
        /// (1-based: 2 for the second one gives "Q02_"). The marker column is named exactly the prefix.
        /// </summary>
        /// <param name="position">The 1-based position of the dataset in DataUnions.</param>
        /// <returns>The prefix, "Q" + two digits + "_".</returns>
        public static string GetParallelPrefix(int position)
        {
            return "Q" + position.ToString("00", CultureInfo.InvariantCulture) + "_";
        }

        /// <summary>
        /// The columns of a union, from the columns of its source datasets, with the rules of the engine:
        /// without ParallelUnion they are those of the first dataset (the others add rows by position,
        /// GroupUnion adds rows together); with ParallelUnion, after the columns of the first dataset,
        /// each later dataset adds a marker column named as its prefix (Q02_ for the second, of
        /// <paramref name="markerTypeName"/>) and its columns renamed prefix + name, except its common fields.
        /// </summary>
        /// <param name="union">The union.</param>
        /// <param name="sourceColumns">The columns of a source dataset by its alias, or null when they are unknown.</param>
        /// <param name="markerTypeName">The type name of the marker columns (an integer).</param>
        /// <param name="missingSource">The alias of the first source whose columns are unknown, or null.</param>
        /// <returns>The columns of the union, or null when the union has no entries or a source is unknown.</returns>
        public static IList<DatasetColumnInfo> DeriveColumns(DataInfo union, Func<string, IList<DatasetColumnInfo>> sourceColumns,
            string markerTypeName, out string missingSource)
        {
            missingSource = null;
            if (union == null || sourceColumns == null)
                return null;
            IList<string> entries = GetEntries(union);
            if (entries.Count == 0)
                return null;
            List<DatasetColumnInfo> result = null;
            var names = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
            for (int i = 0; i < entries.Count; i++)
            {
                string alias = GetSourceAlias(entries[i]);
                IList<DatasetColumnInfo> columns = sourceColumns(alias);
                if (columns == null)
                {
                    missingSource = alias;
                    return null;
                }
                if (result == null)
                {
                    result = new List<DatasetColumnInfo>();
                    foreach (DatasetColumnInfo column in columns)
                        AddColumn(result, names, column.Name, column.TypeName);
                    continue;
                }
                if (!union.ParallelUnion)
                    continue;
                string prefix = GetParallelPrefix(i + 1);
                IList<string> commonFields = GetCommonFields(entries[i]);
                AddColumn(result, names, prefix, markerTypeName);
                foreach (DatasetColumnInfo column in columns)
                {
                    if (commonFields.Contains((column.Name ?? string.Empty).ToUpperInvariant()))
                        continue;
                    AddColumn(result, names, prefix + column.Name, column.TypeName);
                }
            }
            return result;
        }

        private static void AddColumn(List<DatasetColumnInfo> columns, HashSet<string> names, string name, string typeName)
        {
            // A DataTable does not hold two columns of the same name (ignoring case)
            if (string.IsNullOrEmpty(name) || !names.Add(name))
                return;
            columns.Add(new DatasetColumnInfo(name, typeName));
        }
    }
}
