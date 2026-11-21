#region Copyright
/*
 *  Report Manager:  Database Reporting tool for .Net and Mono
 *
 *     This Source Code Form is subject to the terms of the Mozilla
 *     Public License, v. 2.0. If a copy of the MPL was not distributed
 *     with this file, You can obtain one at https://mozilla.org/MPL/2.0/.
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
using System.Text.Json;
using System.Threading;
using System.Threading.Tasks;

namespace Reportman.Reporting
{
    /// <summary>A foreign key with the table it goes out of.</summary>
    public class CatalogRelation
    {
        /// <summary>The table the key goes out of.</summary>
        public string SourceTable { get; set; } = "";
        /// <summary>The key: its target table and the columns of both ends.</summary>
        public LocalSchemaForeignKey ForeignKey { get; set; } = new LocalSchemaForeignKey();
    }

    /// <summary>What <see cref="DatabaseCatalogReader.ReadRelationsAsync"/> reads.</summary>
    public class CatalogRelations
    {
        /// <summary>The keys, each once.</summary>
        public List<CatalogRelation> Relations { get; } = new List<CatalogRelation>();

        /// <summary>
        /// True when the keys arriving at the tables are there too (their target is one of the tables); false when the
        /// provider gives only the keys going out of each table, and some relations may be missing.
        /// </summary>
        public bool IncludesIncoming { get; set; }

        internal void Add(string sourceTable, LocalSchemaForeignKey fk)
        {
            foreach (CatalogRelation r in Relations)
                if (string.Equals(r.SourceTable, sourceTable, StringComparison.OrdinalIgnoreCase) &&
                    LocalSchemaStore.SameRelation(r.ForeignKey, fk))
                    return;
            Relations.Add(new CatalogRelation { SourceTable = sourceTable ?? "", ForeignKey = fk });
        }
    }

    /// <summary>
    /// A read the schema generator of Reportman AI asks of a client with a direct connection
    /// (docs/generar-esquema-con-ia-plan.md, «turno de apertura en el cliente»): no SQL comes from the cloud, only what to
    /// read of the catalog.
    /// </summary>
    public class SchemaGenerationRequest
    {
        /// <summary>The id the answer goes back with.</summary>
        public string Id { get; set; } = "";
        /// <summary>Tables (the names of every table), Columns, Relations (source OR target) or Rows.</summary>
        public string Kind { get; set; } = "";
        /// <summary>The tables of Columns, Relations and Rows.</summary>
        public List<string> Tables { get; set; } = new List<string>();
        /// <summary>The rows of each table for Rows (never more than <see cref="SchemaGenerationReader.MaxRows"/>).</summary>
        public int MaxRows { get; set; } = SchemaGenerationReader.MaxRows;
    }

    /// <summary>
    /// Answers the reads of the schema generator with an open connection: the names of the tables, the columns of some
    /// (primary key and type), the foreign keys in which some take part as source or target, and their first rows. Each
    /// answer is a dictionary ready to be serialized as the API's <c>SchemaClientResult</c>; a read that fails says why
    /// instead of throwing. Shared by the C# designer and Reportman.Server.
    /// </summary>
    public static class SchemaGenerationReader
    {
        /// <summary>The rows of a table the generator ever gets.</summary>
        public const int MaxRows = 10;

        // A text value longer than this goes cut: the AI only needs to see what the column holds
        private const int MaxText = 300;

        /// <summary>The <c>clientRequests</c> of a waiting answer of the generator.</summary>
        /// <param name="result">The <c>result</c> object of the answer.</param>
        public static List<SchemaGenerationRequest> ParseRequests(JsonElement result)
        {
            var list = new List<SchemaGenerationRequest>();
            JsonElement requests;
            if (!SchemaJson.TryGet(result, "clientRequests", out requests) || requests.ValueKind != JsonValueKind.Array)
                return list;
            foreach (JsonElement item in requests.EnumerateArray())
            {
                var request = new SchemaGenerationRequest { Id = SchemaJson.Text(item, "id"), Kind = SchemaJson.Text(item, "kind") };
                JsonElement tables;
                if (SchemaJson.TryGet(item, "tables", out tables) && tables.ValueKind == JsonValueKind.Array)
                    foreach (JsonElement t in tables.EnumerateArray())
                        if (t.ValueKind == JsonValueKind.String)
                            request.Tables.Add(t.GetString() ?? "");
                JsonElement rows;
                int n;
                if (SchemaJson.TryGet(item, "maxRows", out rows) && rows.ValueKind == JsonValueKind.Number && rows.TryGetInt32(out n))
                    request.MaxRows = n;
                list.Add(request);
            }
            return list;
        }

        /// <summary>One answer per request, in order.</summary>
        /// <param name="connection">The connection (opened here when it is closed).</param>
        /// <param name="requests">What the generator asks.</param>
        /// <param name="cancellationToken">Stops the reads.</param>
        public static async Task<List<Dictionary<string, object>>> AnswerAsync(DbConnection connection, IEnumerable<SchemaGenerationRequest> requests,
            CancellationToken cancellationToken)
        {
            if (connection == null)
                throw new ArgumentNullException("connection");
            var answers = new List<Dictionary<string, object>>();
            foreach (SchemaGenerationRequest request in requests)
            {
                cancellationToken.ThrowIfCancellationRequested();
                var answer = new Dictionary<string, object> { { "id", request.Id }, { "success", true } };
                try
                {
                    switch ((request.Kind ?? "").ToLowerInvariant())
                    {
                        case "tables":
                            answer["tables"] = await DatabaseCatalogReader.ReadTableNamesAsync(connection, cancellationToken).ConfigureAwait(false);
                            break;
                        case "columns":
                            answer["columns"] = await ColumnsAsync(connection, request.Tables, cancellationToken).ConfigureAwait(false);
                            break;
                        case "relations":
                            CatalogRelations relations = await DatabaseCatalogReader.ReadRelationsAsync(connection, request.Tables, cancellationToken).ConfigureAwait(false);
                            var list = new List<Dictionary<string, object>>();
                            foreach (CatalogRelation r in relations.Relations)
                                list.Add(new Dictionary<string, object>
                                {
                                    { "constraintName", r.ForeignKey.ConstraintName ?? "" },
                                    { "sourceTable", r.SourceTable },
                                    { "sourceColumns", r.ForeignKey.SourceColumns },
                                    { "targetTable", r.ForeignKey.TargetTable ?? "" },
                                    { "targetColumns", r.ForeignKey.TargetColumns }
                                });
                            answer["relations"] = list;
                            answer["includesIncoming"] = relations.IncludesIncoming;
                            break;
                        case "rows":
                            var rows = new Dictionary<string, object>(StringComparer.OrdinalIgnoreCase);
                            int max = Math.Max(1, Math.Min(MaxRows, request.MaxRows));
                            foreach (string table in request.Tables)
                            {
                                try { rows[table] = await RowsAsync(connection, table, max, cancellationToken).ConfigureAwait(false); }
                                catch (Exception ex) when (!(ex is OperationCanceledException))
                                { rows[table] = new Dictionary<string, object> { { "columns", new List<string>() }, { "rows", new List<object>() }, { "error", ex.Message } }; }
                            }
                            answer["rows"] = rows;
                            break;
                        default:
                            answer["success"] = false;
                            answer["errorMessage"] = "Unknown request: " + request.Kind;
                            break;
                    }
                }
                catch (Exception ex) when (!(ex is OperationCanceledException) || !cancellationToken.IsCancellationRequested)
                {
                    answer["success"] = false;
                    answer["errorMessage"] = ex.Message;
                }
                answers.Add(answer);
            }
            return answers;
        }

        /// <summary>The columns of each table as the API's DiscoveredColumn; a table the catalog does not have, none.</summary>
        private static async Task<Dictionary<string, object>> ColumnsAsync(DbConnection connection, List<string> tables, CancellationToken cancellationToken)
        {
            var result = new Dictionary<string, object>(StringComparer.OrdinalIgnoreCase);
            foreach (string name in tables)
                result[name] = new List<object>();
            List<LocalSchemaTable> read = await DatabaseCatalogReader.ReadTableDetailsAsync(connection, tables, null, cancellationToken).ConfigureAwait(false);
            foreach (LocalSchemaTable table in read)
            {
                var columns = new List<object>();
                int position = 0;
                foreach (LocalSchemaColumn c in table.Columns)
                {
                    string detected = c.DetectedType ?? "";
                    bool netType = detected.StartsWith("System.", StringComparison.Ordinal);
                    columns.Add(new Dictionary<string, object>
                    {
                        { "name", c.Name },
                        { "isPrimaryKey", c.IsPrimaryKey },
                        { "detectedNetType", netType ? detected : "" },
                        { "declaredDbType", netType ? "" : detected },
                        { "suggestedDataType", LocalSchemaStore.CloudColumnType(c.DataType, detected) },
                        { "ordinalPosition", ++position }
                    });
                }
                // The name the generator asked with, for the answer to find it
                string key = table.Name;
                foreach (string asked in tables)
                    if (string.Equals(asked, table.Name, StringComparison.OrdinalIgnoreCase))
                        key = asked;
                result[key] = columns;
            }
            return result;
        }

        /// <summary>The first <paramref name="max"/> rows of a table: its column names and each value as JSON can carry it.</summary>
        private static async Task<Dictionary<string, object>> RowsAsync(DbConnection connection, string table, int max, CancellationToken cancellationToken)
        {
            if (connection.State != ConnectionState.Open)
                await connection.OpenAsync(cancellationToken).ConfigureAwait(false);
            bool limited;
            string sql = LocalSchemaStore.PreviewSql(DatabaseCatalogReader.DialectOf(connection), table, max, out limited);
            var columns = new List<string>();
            var rows = new List<object>();
            using (DbCommand cmd = connection.CreateCommand())
            {
                cmd.CommandText = sql;
                cmd.CommandTimeout = 30;
                using (DbDataReader reader = await cmd.ExecuteReaderAsync(cancellationToken).ConfigureAwait(false))
                {
                    for (int i = 0; i < reader.FieldCount; i++)
                        columns.Add(reader.GetName(i));
                    while (rows.Count < max && await reader.ReadAsync(cancellationToken).ConfigureAwait(false))
                    {
                        var row = new List<object>(reader.FieldCount);
                        for (int i = 0; i < reader.FieldCount; i++)
                        {
                            object value;
                            try { value = reader.IsDBNull(i) ? null : reader.GetValue(i); }
                            catch (Exception) { value = "(?)"; }
                            row.Add(Plain(value));
                        }
                        rows.Add(row);
                    }
                    // A dialect without a limit: the rest of the table is not read
                    if (!limited)
                        try { cmd.Cancel(); } catch { }
                }
            }
            return new Dictionary<string, object> { { "columns", columns }, { "rows", rows } };
        }

        /// <summary>A value as the generator reads it: a binary one as «(BLOB)», a date in ISO, a long text cut.</summary>
        public static object Plain(object value)
        {
            if (value == null || value is DBNull)
                return null;
            if (value is byte[])
                return "(BLOB)";
            if (value is DateTime)
            {
                var d = (DateTime)value;
                return d.TimeOfDay == TimeSpan.Zero ? d.ToString("yyyy-MM-dd", CultureInfo.InvariantCulture)
                    : d.ToString("yyyy-MM-dd HH:mm:ss", CultureInfo.InvariantCulture);
            }
            if (value is DateTimeOffset)
                return ((DateTimeOffset)value).ToString("yyyy-MM-dd HH:mm:ss zzz", CultureInfo.InvariantCulture);
            if (value is bool || value is int || value is long || value is short || value is byte || value is sbyte ||
                value is uint || value is ulong || value is ushort || value is decimal)
                return value;
            if (value is double || value is float)
            {
                double d = Convert.ToDouble(value, CultureInfo.InvariantCulture);
                // JSON has no NaN nor infinity
                return double.IsNaN(d) || double.IsInfinity(d) ? (object)d.ToString(CultureInfo.InvariantCulture) : d;
            }
            string text = value is string ? (string)value : Convert.ToString(value, CultureInfo.InvariantCulture) ?? "";
            return text.Length > MaxText ? text.Substring(0, MaxText) + "…" : text;
        }
    }

    /// <summary>The end of a <see cref="SchemaGenerationLoop"/> run.</summary>
    public class SchemaGenerationOutcome
    {
        /// <summary>Completed, Failed, Cancelled, or NeedsClientResults when it stopped after the maximum of rounds.</summary>
        public string Status { get; set; } = "";
        /// <summary>The schema proposed (a database configuration with <c>schemaTables</c>, as the cloud exports it), as JSON; empty when none.</summary>
        public string SchemaJson { get; set; } = "";
        /// <summary>The name of the schema the AI proposed.</summary>
        public string SchemaName { get; set; } = "";
        /// <summary>What the AI says of it (Markdown).</summary>
        public string Explanation { get; set; } = "";
        /// <summary>What was left out and why.</summary>
        public List<string> Warnings { get; } = new List<string>();
        /// <summary>Why it failed, when it did.</summary>
        public string ErrorMessage { get; set; } = "";
        /// <summary>The <c>errorCode</c> of a failed answer (see <see cref="ReportmanAgentClient.SchemaTooLargeForTierCode"/>).</summary>
        public string ErrorCode { get; set; } = "";
        /// <summary>The credits of the whole generation.</summary>
        public int Credits { get; set; }
        /// <summary>The turns of the AI.</summary>
        public int Turns { get; set; }
        /// <summary>How many times the cloud was called.</summary>
        public int Calls { get; set; }
        /// <summary>The number of tables and of relations of the schema.</summary>
        public int Tables { get; set; }
        /// <summary>The number of relations of the schema.</summary>
        public int Relations { get; set; }
        /// <summary>The last answer of the cloud, as JSON (its user profile refreshes the credits).</summary>
        public string LastAnswerJson { get; set; } = "";

        /// <summary>True when there is a schema to import.</summary>
        public bool Completed { get { return string.Equals(Status, "Completed", StringComparison.OrdinalIgnoreCase) && SchemaJson.Length > 0; } }
    }

    /// <summary>
    /// «Generate with AI» of a local schema (docs/generar-esquema-con-ia-plan.md): asks the cloud for a schema of the domain
    /// the user wrote and, while it answers <c>NeedsClientResults</c>, reads what it asks of the database through
    /// <see cref="Answer"/> (by default <see cref="SchemaGenerationReader.AnswerAsync"/> on <see cref="Connection"/>) and
    /// calls again with the continuation, until it completes or fails. A Hub database (the client's
    /// <see cref="ReportmanAgentClient.HubDatabaseId"/>) is read by the cloud itself: one call.
    /// </summary>
    public class SchemaGenerationLoop
    {
        /// <summary>The rounds of client reads before giving up (the cloud stops at its own 40 turns before).</summary>
        public const int DefaultMaxRounds = 45;

        private readonly ReportmanAgentClient _client;

        /// <summary>Creates a loop that calls the cloud through <paramref name="client"/> (configured by the caller).</summary>
        public SchemaGenerationLoop(ReportmanAgentClient client)
        {
            if (client == null)
                throw new ArgumentNullException("client");
            _client = client;
        }

        /// <summary>The rounds of client reads before giving up.</summary>
        public int MaxRounds { get; set; } = DefaultMaxRounds;

        /// <summary>The direct connection the reads go to (when <see cref="Answer"/> is not set).</summary>
        public DbConnection Connection { get; set; }

        /// <summary>
        /// True (the default) to read the names of the tables of <see cref="Connection"/> first and send them with the first
        /// call, unless the catalog is large (<see cref="DatabaseCatalogReader.LargeCatalogThreshold"/>).
        /// </summary>
        public bool SendTableNames { get; set; } = true;

        /// <summary>Answers the reads the cloud asks; by default <see cref="SchemaGenerationReader.AnswerAsync"/> on <see cref="Connection"/>.</summary>
        public Func<IList<SchemaGenerationRequest>, CancellationToken, Task<List<Dictionary<string, object>>>> Answer { get; set; }

        /// <summary>The lines the user reads: what the AI does («Turn 2: the AI decides what to look at…») and reads.</summary>
        public event Action<string> StatusChanged;

        private void Status(string message)
        {
            Action<string> handler = StatusChanged;
            if (handler != null && !string.IsNullOrWhiteSpace(message))
                handler(message);
        }

        /// <summary>Runs the generation to the end.</summary>
        /// <param name="domain">What the user wants («ventas», «compras», «todo»...).</param>
        /// <param name="schemaName">The name of the schema; empty for the AI's.</param>
        /// <param name="mode">Fast or Reasoning.</param>
        /// <param name="languageCodeIso">The language of the descriptions and of the lines («es»).</param>
        /// <param name="dialect">The dialect of the direct connection (Firebird5, SQLite...); unused with a Hub database.</param>
        /// <param name="sender">The object raising the progress.</param>
        /// <param name="onProgress">Every progress frame of every call, as the client's other requests give them.</param>
        /// <param name="cancellationToken">Stops it.</param>
        public async Task<SchemaGenerationOutcome> RunAsync(string domain, string schemaName, string mode, string languageCodeIso, string dialect,
            object sender, ReportmanAgentClient.ProgressEventHandler onProgress, CancellationToken cancellationToken)
        {
            var outcome = new SchemaGenerationOutcome();
            bool clientExecutes = _client.HubDatabaseId == 0 && _client.HubSchemaId == 0;
            Func<IList<SchemaGenerationRequest>, CancellationToken, Task<List<Dictionary<string, object>>>> answer = Answer;
            if (answer == null && clientExecutes)
            {
                if (Connection == null)
                    throw new InvalidOperationException("No connection to read the database from");
                answer = (requests, ct) => SchemaGenerationReader.AnswerAsync(Connection, requests, ct);
            }
            ReportmanAgentClient.ProgressEventHandler progress = (s, actor, stage, chunkType, chunk, input, output, id, prefill) =>
            {
                // The lines of the generator: what the user reads
                if (string.Equals(actor, "System", StringComparison.OrdinalIgnoreCase) &&
                    string.Equals(stage, "ParsingResult", StringComparison.OrdinalIgnoreCase))
                    Status(chunk);
                if (onProgress != null)
                    onProgress(s, actor, stage, chunkType, chunk, input, output, id, prefill);
            };

            // The names of the tables go with the first call (the AI starts from them: a turn less), unless the catalog is
            // large: they would travel in every continuation
            List<string> initialTables = null;
            if (clientExecutes && SendTableNames && Connection != null)
            {
                try
                {
                    initialTables = await DatabaseCatalogReader.ReadTableNamesAsync(Connection, cancellationToken).ConfigureAwait(false);
                    if (initialTables.Count > DatabaseCatalogReader.LargeCatalogThreshold)
                        initialTables = null;
                }
                catch (Exception) when (!cancellationToken.IsCancellationRequested)
                {
                    initialTables = null;   // the AI asks for them
                }
            }

            string continuation = "";
            List<Dictionary<string, object>> results = null;
            for (int round = 0; ; round++)
            {
                cancellationToken.ThrowIfCancellationRequested();
                using (JsonDocument document = await _client.GenerateSchemaTurnAsync(domain, schemaName, mode, languageCodeIso, dialect,
                    clientExecutes, round == 0 ? initialTables : null, continuation, results, sender, progress, cancellationToken).ConfigureAwait(false))
                {
                    outcome.Calls++;
                    if (document == null)
                    {
                        outcome.Status = "Failed";
                        outcome.ErrorMessage = "The cloud gave no answer";
                        return outcome;
                    }
                    outcome.LastAnswerJson = document.RootElement.GetRawText();
                    JsonElement root = document.RootElement;
                    outcome.ErrorMessage = SchemaJson.Text(root, "errorMessage");
                    outcome.ErrorCode = SchemaJson.Text(root, "errorCode");
                    JsonElement result;
                    if (!SchemaJson.TryGet(root, "result", out result) || result.ValueKind != JsonValueKind.Object)
                    {
                        outcome.Status = "Failed";
                        if (outcome.ErrorMessage.Length == 0)
                            outcome.ErrorMessage = "The cloud gave no result";
                        return outcome;
                    }
                    outcome.Status = SchemaJson.Text(result, "status");
                    outcome.Credits = SchemaJson.Int(result, "creditsConsumed");
                    outcome.Turns = SchemaJson.Int(result, "turns");
                    if (!string.Equals(outcome.Status, "NeedsClientResults", StringComparison.OrdinalIgnoreCase))
                    {
                        Finish(outcome, result);
                        return outcome;
                    }
                    if (answer == null || round >= MaxRounds)
                    {
                        if (outcome.ErrorMessage.Length == 0)
                            outcome.ErrorMessage = "The AI kept asking for the database after " + round + " rounds";
                        return outcome;
                    }
                    continuation = SchemaJson.Text(result, "continuation");
                    List<SchemaGenerationRequest> requests = SchemaGenerationReader.ParseRequests(result);
                    results = await answer(requests, cancellationToken).ConfigureAwait(false);
                }
            }
        }

        private static void Finish(SchemaGenerationOutcome outcome, JsonElement result)
        {
            outcome.Explanation = SchemaJson.Text(result, "explanation");
            JsonElement warnings;
            if (SchemaJson.TryGet(result, "warnings", out warnings) && warnings.ValueKind == JsonValueKind.Array)
                foreach (JsonElement w in warnings.EnumerateArray())
                    if (w.ValueKind == JsonValueKind.String)
                        outcome.Warnings.Add(w.GetString() ?? "");
            JsonElement schema;
            if (SchemaJson.TryGet(result, "schema", out schema) && schema.ValueKind == JsonValueKind.Object)
            {
                outcome.SchemaJson = schema.GetRawText();
                outcome.SchemaName = SchemaJson.Text(schema, "name");
                JsonElement tables;
                if (SchemaJson.TryGet(schema, "schemaTables", out tables) && tables.ValueKind == JsonValueKind.Array)
                    foreach (JsonElement t in tables.EnumerateArray())
                    {
                        outcome.Tables++;
                        JsonElement keys;
                        if (SchemaJson.TryGet(t, "foreignKeys", out keys) && keys.ValueKind == JsonValueKind.Array)
                            outcome.Relations += keys.GetArrayLength();
                    }
            }
            if (outcome.Status.Length == 0)
                outcome.Status = "Failed";
        }
    }

    /// <summary>The few JSON reads of the schema generation, ignoring the case of the names.</summary>
    internal static class SchemaJson
    {
        public static bool TryGet(JsonElement element, string name, out JsonElement value)
        {
            if (element.ValueKind == JsonValueKind.Object)
            {
                if (element.TryGetProperty(name, out value))
                    return true;
                foreach (JsonProperty property in element.EnumerateObject())
                    if (string.Equals(property.Name, name, StringComparison.OrdinalIgnoreCase))
                    {
                        value = property.Value;
                        return true;
                    }
            }
            value = default(JsonElement);
            return false;
        }

        public static string Text(JsonElement element, string name)
        {
            JsonElement value;
            if (!TryGet(element, name, out value))
                return "";
            switch (value.ValueKind)
            {
                case JsonValueKind.String:
                    return value.GetString() ?? "";
                case JsonValueKind.Null:
                case JsonValueKind.Undefined:
                    return "";
                default:
                    return value.GetRawText();
            }
        }

        public static int Int(JsonElement element, string name)
        {
            JsonElement value;
            int n;
            return TryGet(element, name, out value) && value.ValueKind == JsonValueKind.Number && value.TryGetInt32(out n) ? n : 0;
        }
    }
}
