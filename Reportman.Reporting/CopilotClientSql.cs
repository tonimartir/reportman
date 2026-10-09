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

using Reportman.Drawing;
using System;
using System.Collections.Generic;
using System.Data;
using System.Data.Common;
using System.Globalization;
using System.IO;
using System.Text;
using System.Text.Json;
using System.Threading;
using System.Threading.Tasks;

namespace Reportman.Reporting
{
    /// <summary>
    /// A dataset's SQL the Reportman AI copilot asks the client to run, because the database is not
    /// one the cloud can reach (a direct connection of the report).
    /// </summary>
    public class CopilotClientSqlRequest
    {
        /// <summary>Request identifier, sent back with the result.</summary>
        public string Id { get; set; } = "";
        /// <summary>The dataset the SQL is for (empty for a new one).</summary>
        public string DatasetAlias { get; set; } = "";
        /// <summary>The report connection to run it with.</summary>
        public string DatabaseAlias { get; set; } = "";
        /// <summary>The SQL as the dataset will keep it.</summary>
        public string Sql { get; set; } = "";
        /// <summary>The parameters the SQL uses.</summary>
        public List<CopilotSqlParameter> Parameters { get; set; } = new List<CopilotSqlParameter>();
    }

    /// <summary>A parameter of a <see cref="CopilotClientSqlRequest"/>.</summary>
    public class CopilotSqlParameter
    {
        /// <summary>Its name in the SQL (it may carry @, : or ?).</summary>
        public string Name { get; set; } = "";
        /// <summary>The value the AI gave: null, a string, a long, a double or a bool.</summary>
        public object Value { get; set; }
        /// <summary>Optional <see cref="System.Data.DbType"/> as an integer.</summary>
        public int? DbType { get; set; }
    }

    /// <summary>What running a <see cref="CopilotClientSqlRequest"/> gave, as the cloud expects it.</summary>
    public class CopilotClientSqlResult
    {
        /// <summary>The request identifier.</summary>
        public string Id { get; set; } = "";
        /// <summary>True when the SQL ran.</summary>
        public bool Success { get; set; }
        /// <summary>The database's message when it did not run.</summary>
        public string ErrorMessage { get; set; } = "";
        /// <summary>The columns of the result when it ran.</summary>
        public List<CopilotClientSqlColumn> Columns { get; set; } = new List<CopilotClientSqlColumn>();
    }

    /// <summary>A column of a <see cref="CopilotClientSqlResult"/>.</summary>
    public class CopilotClientSqlColumn
    {
        /// <summary>Column name.</summary>
        public string Name { get; set; } = "";
        /// <summary>The .NET type name (System.Int32, System.String...).</summary>
        public string DataType { get; set; } = "";
        /// <summary>Size of a string column, 0 when unknown.</summary>
        public int Size { get; set; }
    }

    /// <summary>
    /// What the client accepts to run of a SQL the AI wrote, before it reaches the database: a single
    /// statement that starts with SELECT or WITH and has none of the words that change data or
    /// schema, run code or grant rights (INSERT, UPDATE, DELETE, MERGE, DROP, ALTER, CREATE, TRUNCATE,
    /// GRANT, REVOKE, EXEC, EXECUTE, CALL, and INTO for SELECT ... INTO), looking at whole words outside
    /// string literals, quoted identifiers and comments. It errs on the strict side: a refused query is
    /// answered as an error and the AI rewrites it.
    /// </summary>
    public static class CopilotSqlGuard
    {
        private static readonly HashSet<string> Forbidden = new HashSet<string>(StringComparer.OrdinalIgnoreCase)
        {
            "INSERT", "UPDATE", "DELETE", "MERGE", "DROP", "ALTER", "CREATE", "TRUNCATE",
            "GRANT", "REVOKE", "EXEC", "EXECUTE", "CALL", "INTO"
        };

        /// <summary>
        /// "" when <paramref name="sql"/> can be run, otherwise why it is refused (in words the AI
        /// understands, so it can rewrite the query).
        /// </summary>
        public static string Check(string sql)
        {
            string text = sql ?? "";
            var words = new List<string>();
            bool statementEnded = false;
            int i = 0;
            while (i < text.Length)
            {
                char c = text[i];
                char next = i + 1 < text.Length ? text[i + 1] : '\0';
                if (c == '-' && next == '-')
                {
                    int end = text.IndexOf('\n', i);
                    i = end < 0 ? text.Length : end + 1;
                    continue;
                }
                if (c == '/' && next == '*')
                {
                    int end = text.IndexOf("*/", i + 2, StringComparison.Ordinal);
                    if (end < 0)
                        return Refuse("it has a comment that is not closed");
                    i = end + 2;
                    continue;
                }
                if (c == '\'' || c == '"' || c == '`' || c == '[')
                {
                    // A string literal or a quoted identifier: its content is not looked at.
                    char close = c == '[' ? ']' : c;
                    int j = i + 1;
                    bool closed = false;
                    while (j < text.Length)
                    {
                        if (text[j] == close)
                        {
                            // A doubled quote is an escaped quote, inside.
                            if (close != ']' && j + 1 < text.Length && text[j + 1] == close)
                            {
                                j += 2;
                                continue;
                            }
                            closed = true;
                            break;
                        }
                        j++;
                    }
                    if (!closed)
                        return Refuse("it has a quoted text that is not closed");
                    if (statementEnded)
                        return Refuse("it has more than one statement");
                    i = j + 1;
                    continue;
                }
                if (c == ';')
                {
                    statementEnded = true;
                    i++;
                    continue;
                }
                if (char.IsWhiteSpace(c))
                {
                    i++;
                    continue;
                }
                if (statementEnded)
                    return Refuse("it has more than one statement");
                if (char.IsLetter(c) || c == '_')
                {
                    int j = i;
                    while (j < text.Length && (char.IsLetterOrDigit(text[j]) || text[j] == '_' || text[j] == '$' || text[j] == '#'))
                        j++;
                    words.Add(text.Substring(i, j - i));
                    i = j;
                    continue;
                }
                i++;
            }
            if (words.Count == 0)
                return Refuse("it is empty");
            string first = words[0].ToUpperInvariant();
            if (first != "SELECT" && first != "WITH")
                return Refuse("it starts with " + first);
            foreach (string word in words)
            {
                if (Forbidden.Contains(word))
                    return Refuse("it contains " + word.ToUpperInvariant());
            }
            return "";
        }

        private static string Refuse(string why)
        {
            return "Refused by the designer: " + why + ". Only a single read-only query (SELECT, or WITH ... SELECT) " +
                "without INSERT, UPDATE, DELETE, MERGE, DROP, ALTER, CREATE, TRUNCATE, GRANT, REVOKE, EXEC, EXECUTE, CALL or INTO " +
                "is run to know its columns. Rewrite it as such a query.";
        }
    }

    /// <summary>
    /// Runs a SQL the copilot wrote as one more dataset of the report it is working on: a dataset is
    /// added to that report on the requested connection, the report parameters it names are linked (the
    /// new ones created with the AI's value), it is opened by the engine, its columns are read and
    /// everything is closed. The work is done inside a transaction that is rolled back.
    /// </summary>
    public static class CopilotSqlProbe
    {
        /// <summary>Alias of the dataset added to run the SQL.</summary>
        public const string ProbeAlias = "COPILOT_PROBE";

        /// <summary>Loads a report from its XML (or any format the engine reads) document.</summary>
        public static Report LoadReport(string reportDocument)
        {
            var report = new Report();
            using (var stream = new MemoryStream(Encoding.UTF8.GetBytes(reportDocument ?? "")))
                report.LoadFromStream(stream);
            return report;
        }

        /// <summary>
        /// Runs one request against the report <paramref name="reportDocument"/> describes. Never throws:
        /// a failure is returned with the database's message, which the cloud uses to fix the SQL.
        /// </summary>
        /// <param name="reportDocument">The report document the cloud returned with the request.</param>
        /// <param name="request">What to run.</param>
        /// <param name="prepareReport">Optional hook to bind the loaded report's connections as the host does.</param>
        public static CopilotClientSqlResult Run(string reportDocument, CopilotClientSqlRequest request, Action<Report> prepareReport)
        {
            var result = new CopilotClientSqlResult { Id = request != null ? request.Id ?? "" : "" };
            try
            {
                if (request == null)
                    throw new ArgumentNullException("request");
                Report report = LoadReport(reportDocument);
                if (prepareReport != null)
                    prepareReport(report);
                result.Columns = Probe(report, request.DatabaseAlias, request.Sql, request.Parameters);
                result.Success = true;
            }
            catch (Exception ex)
            {
                result.Success = false;
                result.Columns = new List<CopilotClientSqlColumn>();
                result.ErrorMessage = string.IsNullOrWhiteSpace(ex.Message) ? ex.GetType().Name : ex.Message.Trim();
            }
            return result;
        }

        /// <summary>
        /// The columns of <paramref name="sql"/> run as a new dataset of <paramref name="report"/> on the
        /// connection <paramref name="databaseAlias"/>. Throws with the database's message when it fails.
        /// The SQL is written by the AI and run without anybody seeing it, so it can never change data:
        /// only a single SELECT (or WITH) statement is accepted (<see cref="CopilotSqlGuard"/>), it is
        /// executed with <see cref="CommandBehavior.SchemaOnly"/> (no rows are read), and every
        /// transaction of the report is rolled back, never committed.
        /// </summary>
        public static List<CopilotClientSqlColumn> Probe(Report report, string databaseAlias, string sql, IEnumerable<CopilotSqlParameter> parameters)
        {
            if (report == null)
                throw new ArgumentNullException("report");
            string refused = CopilotSqlGuard.Check(sql);
            if (refused.Length > 0)
                throw new InvalidOperationException(refused);
            DatabaseInfo db = FindDatabase(report, databaseAlias);
            if (db == null)
                throw new NamedException("The report has no connection " + databaseAlias, databaseAlias ?? "");
            db.ResolveHttpAgentConnectionParamsFromConfig();
            if (db.Driver == DriverType.HttpAgent || db.Driver == DriverType.Mybase)
                throw new NamedException("The connection " + db.Alias + " is not a direct database connection: its SQL is not run by the designer", db.Alias);

            string alias = ProbeAlias;
            for (int n = 1; report.DataInfo.IndexOf(alias) >= 0; n++)
                alias = ProbeAlias + n.ToString(CultureInfo.InvariantCulture);
            var probe = new DataInfo();
            probe.Report = report;
            probe.Alias = alias;
            probe.DatabaseAlias = db.Alias;
            probe.SQL = sql ?? "";
            probe.OpenBehavior = CommandBehavior.SchemaOnly;
            report.GenerateNewName(probe);
            report.DataInfo.Add(probe);

            try
            {
                try
                {
                    ApplyParameterDefaults(report);
                }
                catch
                {
                    // As the preview: a default that cannot be evaluated leaves the parameter as it is.
                }
                if (parameters != null)
                {
                    foreach (CopilotSqlParameter parameter in parameters)
                        LinkParameter(report, alias, parameter);
                }
                report.UpdateParamsBeforeOpen(report.DataInfo.IndexOf(alias), true);
                probe.Connect();
                return ColumnsOf(probe);
            }
            finally
            {
                DisconnectAll(report);
            }
        }

        /// <summary>The columns of an open dataset, with the size of the string ones.</summary>
        public static List<CopilotClientSqlColumn> ColumnsOf(DataInfo dinfo)
        {
            var result = new List<CopilotClientSqlColumn>();
            if (dinfo == null || dinfo.Data == null)
                return result;
            foreach (DataColumn column in dinfo.Data.Columns)
            {
                int size = 0;
                if (column.DataType == typeof(string))
                {
                    int known;
                    if (dinfo.Data.ColumnSizes.TryGetValue(column.ColumnName, out known) && known > 0)
                        size = known;
                    else if (column.MaxLength > 0)
                        size = column.MaxLength;
                }
                result.Add(new CopilotClientSqlColumn
                {
                    Name = column.ColumnName,
                    DataType = column.DataType.ToString(),
                    Size = size
                });
            }
            return result;
        }

        /// <summary>The connection with that alias, matched exactly first and then ignoring case.</summary>
        public static DatabaseInfo FindDatabase(Report report, string databaseAlias)
        {
            string wanted = (databaseAlias ?? "").Trim();
            DatabaseInfo found = null;
            foreach (DatabaseInfo db in report.DatabaseInfo)
            {
                if (db.Alias == wanted)
                    return db;
                if (found == null && string.Equals(db.Alias, wanted, StringComparison.OrdinalIgnoreCase))
                    found = db;
            }
            return found;
        }

        /// <summary>
        /// Closes every dataset and connection of the report, rolling back (never committing) the
        /// transactions the engine opened.
        /// </summary>
        public static void DisconnectAll(Report report)
        {
            foreach (DataInfo dinfo in report.DataInfo)
            {
                try { dinfo.DisConnect(); } catch { }
            }
            foreach (DatabaseInfo db in report.DatabaseInfo)
            {
                try { db.DisConnectRollingBack(); }
                catch
                {
                    try { db.DisConnect(); } catch { }
                }
            }
        }

        /// <summary>
        /// The values a parameters form would start from (initial expressions evaluated, lookups read,
        /// «all» in a multiple selection that keeps none), as the preview runs.
        /// </summary>
        private static void ApplyParameterDefaults(Report report)
        {
            report.UpdateInitialValues();
            foreach (Param p in report.Params)
            {
                if (!p.UserVisible)
                    continue;
                if (p.ParamType != ParamType.List && p.ParamType != ParamType.SubsExpreList && p.ParamType != ParamType.Multiple)
                    continue;
                if (!string.IsNullOrEmpty(p.LookupDataset))
                    p.UpdateLookupValues();
                if (p.ParamType == ParamType.Multiple && p.Selected.Count == 0)
                    p.SelectAllValues();
            }
        }

        /// <summary>The name of a parameter as the report keeps it: without @, : or ?, in upper case.</summary>
        public static string ParameterAlias(string name)
        {
            string trimmed = (name ?? "").Trim().TrimStart('@', ':', '?').Trim();
            var sb = new StringBuilder(trimmed.Length);
            foreach (char c in trimmed)
                sb.Append(char.IsLetterOrDigit(c) ? c : '_');
            return sb.ToString().ToUpperInvariant();
        }

        /// <summary>
        /// The parameter as the cloud will leave it when it applies the dataset: the report's one with
        /// that alias now also feeds this dataset; a new one is created with the AI's value.
        /// </summary>
        private static void LinkParameter(Report report, string datasetAlias, CopilotSqlParameter parameter)
        {
            if (parameter == null)
                return;
            string name = ParameterAlias(parameter.Name);
            if (name.Length == 0)
                return;
            foreach (Param existing in report.Params)
            {
                if (string.Equals(existing.Alias, name, StringComparison.OrdinalIgnoreCase))
                {
                    if (existing.Datasets.IndexOf(datasetAlias) < 0)
                        existing.Datasets.Add(datasetAlias);
                    return;
                }
            }
            object value = PlainValue(parameter.Value);
            ParamType type = ParamTypeOf(parameter.DbType, value);
            var created = new Param();
            created.Report = report;
            created.Alias = name;
            created.ParamType = type;
            report.GenerateNewName(created);
            Variant variant = ToVariant(value, type);
            created.Value = variant;
            created.LastValue = variant;
            created.Datasets.Add(datasetAlias);
            report.Params.Add(created);
        }

        /// <summary>A string, long, double, bool, DateTime or null, whatever the JSON reader made of it.</summary>
        public static object PlainValue(object value)
        {
            if (value is JsonElement)
            {
                JsonElement e = (JsonElement)value;
                switch (e.ValueKind)
                {
                    case JsonValueKind.String:
                        return e.GetString();
                    case JsonValueKind.Number:
                        long l;
                        if (e.TryGetInt64(out l))
                            return l;
                        return e.GetDouble();
                    case JsonValueKind.True:
                        return true;
                    case JsonValueKind.False:
                        return false;
                    default:
                        return null;
                }
            }
            if (value is int)
                return (long)(int)value;
            if (value is decimal)
                return (double)(decimal)value;
            if (value is float)
                return (double)(float)value;
            return value;
        }

        private static Variant ToVariant(object value, ParamType type)
        {
            if (value == null)
                return new Variant();
            CultureInfo invariant = CultureInfo.InvariantCulture;
            try
            {
                switch (type)
                {
                    case ParamType.Bool:
                        return Convert.ToBoolean(value, invariant);
                    case ParamType.Integer:
                        return Convert.ToInt64(value, invariant);
                    case ParamType.Double:
                        return Convert.ToDouble(value, invariant);
                    case ParamType.Currency:
                        return Convert.ToDecimal(value, invariant);
                    case ParamType.Date:
                    case ParamType.Time:
                    case ParamType.DateTime:
                        if (value is DateTime)
                            return (DateTime)value;
                        return DateTime.Parse(Convert.ToString(value, invariant) ?? "", invariant);
                    default:
                        return Convert.ToString(value, invariant) ?? "";
                }
            }
            catch (FormatException)
            {
                return Convert.ToString(value, invariant) ?? "";
            }
        }

        private static ParamType ParamTypeOf(int? dbType, object value)
        {
            if (dbType.HasValue)
            {
                switch ((DbType)dbType.Value)
                {
                    case System.Data.DbType.Boolean:
                        return ParamType.Bool;
                    case System.Data.DbType.Byte:
                    case System.Data.DbType.SByte:
                    case System.Data.DbType.Int16:
                    case System.Data.DbType.Int32:
                    case System.Data.DbType.Int64:
                    case System.Data.DbType.UInt16:
                    case System.Data.DbType.UInt32:
                    case System.Data.DbType.UInt64:
                        return ParamType.Integer;
                    case System.Data.DbType.Currency:
                    case System.Data.DbType.Decimal:
                    case System.Data.DbType.VarNumeric:
                        return ParamType.Currency;
                    case System.Data.DbType.Double:
                    case System.Data.DbType.Single:
                        return ParamType.Double;
                    case System.Data.DbType.Date:
                        return ParamType.Date;
                    case System.Data.DbType.Time:
                        return ParamType.Time;
                    case System.Data.DbType.DateTime:
                    case System.Data.DbType.DateTime2:
                    case System.Data.DbType.DateTimeOffset:
                        return ParamType.DateTime;
                }
            }
            if (value is bool)
                return ParamType.Bool;
            if (value is long)
                return ParamType.Integer;
            if (value is double)
                return ParamType.Double;
            if (value is DateTime)
                return ParamType.DateTime;
            return ParamType.String;
        }
    }

    /// <summary>The end of a <see cref="CopilotModifyReportLoop"/> run.</summary>
    public class CopilotModifyReportOutcome
    {
        /// <summary>The cloud's last answer (the caller disposes it); null when the stream gave none.</summary>
        public JsonDocument Result { get; set; }
        /// <summary>
        /// The document to apply: the last answer's modified document or, when it is empty, the last
        /// document sent if it differs from the original (it carries the datasets made on the way).
        /// Empty when there is nothing to apply.
        /// </summary>
        public string DocumentToApply { get; set; } = "";
        /// <summary>How many times the cloud was called.</summary>
        public int Calls { get; set; }
        /// <summary>Every SQL the cloud asked to run, in order.</summary>
        public List<CopilotClientSqlRequest> SqlRequests { get; } = new List<CopilotClientSqlRequest>();
        /// <summary>What each of <see cref="SqlRequests"/> gave, in the same order.</summary>
        public List<CopilotClientSqlResult> SqlResults { get; } = new List<CopilotClientSqlResult>();
        /// <summary>True when the cloud was still waiting for SQL results after the maximum number of rounds.</summary>
        public bool TooManyTurns { get; set; }
    }

    /// <summary>
    /// The copilot's ModifyReport conversation with the client running the SQL
    /// (docs: "the SQL is run by whoever has the connection"): the request declares that the client
    /// executes SQL; while the answer's status is <c>NeedsClientSqlResults</c>, each requested SQL is run
    /// as one more dataset of the returned document (on the connection it names) and the cloud is called
    /// again with the same instructions, that document, the working context, the continuation and the
    /// columns (or the database's error). A database of the Hub keeps running in the cloud as before.
    /// </summary>
    public class CopilotModifyReportLoop
    {
        /// <summary>Default maximum number of client SQL rounds (the cloud also limits its own retries).</summary>
        public const int DefaultMaxRounds = 30;

        private readonly ReportmanAgentClient _client;

        /// <summary>Creates a loop that calls the cloud through <paramref name="client"/> (configured by the caller).</summary>
        public CopilotModifyReportLoop(ReportmanAgentClient client)
        {
            if (client == null)
                throw new ArgumentNullException("client");
            _client = client;
        }

        /// <summary>Maximum number of rounds of client SQL before giving up.</summary>
        public int MaxRounds { get; set; } = DefaultMaxRounds;

        /// <summary>Optional hook to bind a loaded report's connections as the host does before running SQL.</summary>
        public Action<Report> PrepareReport { get; set; }

        /// <summary>
        /// Runs one request; by default <see cref="CopilotSqlProbe.Run"/>. Arguments: the report document
        /// and the request.
        /// </summary>
        public Func<string, CopilotClientSqlRequest, CopilotClientSqlResult> SqlRunner { get; set; }

        /// <summary>A short line for each SQL being run and its outcome.</summary>
        public event Action<string> StatusChanged;

        /// <summary>
        /// Raised with each answer of the cloud (one per call: its final frame, with the usage steps and the
        /// credits of that call), on the loop's thread, before the loop disposes it.
        /// </summary>
        public event Action<JsonDocument> AnswerReceived;

        private void Status(string message)
        {
            Action<string> handler = StatusChanged;
            if (handler != null)
                handler(message);
        }

        private void Answer(JsonDocument answer)
        {
            Action<JsonDocument> handler = AnswerReceived;
            if (handler != null && answer != null)
                handler(answer);
        }

        /// <summary>
        /// Runs the request to the end. The progress of every call goes to <paramref name="onProgress"/>.
        /// </summary>
        public async Task<CopilotModifyReportOutcome> RunAsync(string userPrompt, string reportDocument, string mode, string userLanguage,
            string existingContextJson, object sender, ReportmanAgentClient.ProgressEventHandler onProgress, CancellationToken cancellationToken)
        {
            var outcome = new CopilotModifyReportOutcome();
            string sent = reportDocument ?? "";
            JsonDocument result = await _client.ModifyReportTurnAsync(userPrompt, sent, mode, userLanguage, existingContextJson,
                "", null, sender, onProgress, cancellationToken).ConfigureAwait(false);
            outcome.Calls = 1;
            int rounds = 0;
            try
            {
                Answer(result);
                while (IsWaitingForClientSql(result))
                {
                    if (rounds >= MaxRounds)
                    {
                        outcome.TooManyTurns = true;
                        break;
                    }
                    rounds++;
                    JsonElement waiting = result.RootElement.GetProperty("result");
                    string document = GetString(waiting, "modifiedReportDocument");
                    if (document.Length > 0)
                        sent = document;
                    string workingContext = GetString(waiting, "workingContextJson");
                    string continuation = GetString(waiting, "continuation");
                    List<CopilotClientSqlRequest> requests = ParseRequests(waiting);

                    var answers = new List<CopilotClientSqlResult>();
                    foreach (CopilotClientSqlRequest request in requests)
                    {
                        cancellationToken.ThrowIfCancellationRequested();
                        Status("Running SQL" + (request.DatasetAlias.Length > 0 ? " for " + request.DatasetAlias : "") +
                            " on " + request.DatabaseAlias + "...");
                        CopilotClientSqlResult answer = SqlRunner != null
                            ? SqlRunner(sent, request)
                            : CopilotSqlProbe.Run(sent, request, PrepareReport);
                        if (answer == null)
                            answer = new CopilotClientSqlResult { Id = request.Id, Success = false, ErrorMessage = "The SQL was not run" };
                        answer.Id = request.Id;
                        Status(answer.Success
                            ? "  " + answer.Columns.Count + " columns"
                            : "  Error: " + OneLine(answer.ErrorMessage));
                        answers.Add(answer);
                        outcome.SqlRequests.Add(request);
                        outcome.SqlResults.Add(answer);
                    }

                    JsonDocument next = await _client.ModifyReportTurnAsync(userPrompt, sent, mode, userLanguage, workingContext,
                        continuation, answers, sender, onProgress, cancellationToken).ConfigureAwait(false);
                    result.Dispose();
                    result = next;
                    outcome.Calls++;
                    Answer(result);
                }
            }
            catch
            {
                if (result != null)
                    result.Dispose();
                throw;
            }

            outcome.Result = result;
            if (!outcome.TooManyTurns && result != null)
            {
                JsonElement final;
                string modified = "";
                if (result.RootElement.ValueKind == JsonValueKind.Object &&
                    result.RootElement.TryGetProperty("result", out final) && final.ValueKind == JsonValueKind.Object)
                    modified = GetString(final, "modifiedReportDocument");
                if (modified.Length > 0)
                    outcome.DocumentToApply = modified;
                else if (!string.Equals(sent, reportDocument ?? "", StringComparison.Ordinal))
                    outcome.DocumentToApply = sent;
            }
            return outcome;
        }

        /// <summary>True when the answer's result status is NeedsClientSqlResults.</summary>
        public static bool IsWaitingForClientSql(JsonDocument answer)
        {
            if (answer == null || answer.RootElement.ValueKind != JsonValueKind.Object)
                return false;
            JsonElement result;
            if (!answer.RootElement.TryGetProperty("result", out result) || result.ValueKind != JsonValueKind.Object)
                return false;
            return string.Equals(GetString(result, "status"), "NeedsClientSqlResults", StringComparison.OrdinalIgnoreCase);
        }

        /// <summary>The <c>clientSqlRequests</c> of a waiting result.</summary>
        public static List<CopilotClientSqlRequest> ParseRequests(JsonElement result)
        {
            var list = new List<CopilotClientSqlRequest>();
            JsonElement requests;
            if (!TryGet(result, "clientSqlRequests", out requests) || requests.ValueKind != JsonValueKind.Array)
                return list;
            foreach (JsonElement item in requests.EnumerateArray())
            {
                var request = new CopilotClientSqlRequest
                {
                    Id = GetString(item, "id"),
                    DatasetAlias = GetString(item, "datasetAlias"),
                    DatabaseAlias = GetString(item, "databaseAlias"),
                    Sql = GetString(item, "sql")
                };
                JsonElement parameters;
                if (TryGet(item, "parameters", out parameters) && parameters.ValueKind == JsonValueKind.Array)
                {
                    foreach (JsonElement p in parameters.EnumerateArray())
                    {
                        var parameter = new CopilotSqlParameter { Name = GetString(p, "name") };
                        JsonElement value;
                        if (TryGet(p, "value", out value))
                            parameter.Value = CopilotSqlProbe.PlainValue(value.Clone());
                        JsonElement dbType;
                        int number;
                        if (TryGet(p, "dbType", out dbType) && dbType.ValueKind == JsonValueKind.Number && dbType.TryGetInt32(out number))
                            parameter.DbType = number;
                        request.Parameters.Add(parameter);
                    }
                }
                list.Add(request);
            }
            return list;
        }

        /// <summary>A database message on one short line (Firebird's first line alone says nothing).</summary>
        private static string OneLine(string text)
        {
            string[] parts = (text ?? "").Split(new char[] { '\r', '\n' }, StringSplitOptions.RemoveEmptyEntries);
            string joined = string.Join(" / ", Array.ConvertAll(parts, p => p.Trim()));
            return joined.Length > 200 ? joined.Substring(0, 200) + "..." : joined;
        }

        private static bool TryGet(JsonElement element, string name, out JsonElement value)
        {
            if (element.ValueKind == JsonValueKind.Object)
            {
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
            }
            value = default(JsonElement);
            return false;
        }

        private static string GetString(JsonElement element, string name)
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
    }
}
