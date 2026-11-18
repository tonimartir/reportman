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

using Reportman.Reporting;
using System;
using System.Collections.Generic;
using System.Data.Common;
using System.Diagnostics;
using System.IO;
using System.Text;
using System.Text.Json;
using System.Threading;

namespace Reportman.Designer
{
    /// <summary>
    /// Headless checks of «Generate with AI» of the local schemas (invoked from designer.exe /generateschematest,
    /// docs/generar-esquema-con-ia-plan.md): the four reads the generator asks of a direct connection on a SQLite database
    /// made here (the names of the tables, columns with their primary key, the relations where a table is source OR target,
    /// at most 10 rows with a BLOB as «(BLOB)»), the sections of reportman_auth.ini that saving the session keeps, and the
    /// strings 2057-2070. With a token, the whole generation against the Reportman AI API (the development one in a Debug
    /// build): the rounds of client reads on a copy of samples.db and on EXAMPLE.FDB, and the import of the result as a
    /// new subschema of a local schema file in a temporary folder (never the user's).
    /// </summary>
    public static class DesignerSelfTestGenerateSchema
    {
        /// <summary>
        /// Runs the checks. Returns one line per failed check, the progress of the AI runs and a summary line
        /// ("GENERATESCHEMA: n passed, m failed").
        /// </summary>
        /// <param name="sqliteCopy">A COPY of a SQLite database to generate from with the AI; empty to skip it.</param>
        /// <param name="firebirdIni">A connections file with a [FBEXAMPLE] section (Param.DataSource, Database, Port, UserID,
        /// Password, Charset) to generate from EXAMPLE.FDB; empty to skip it.</param>
        /// <param name="tokenFile">The file with the token of the user; empty to skip the runs with the AI.</param>
        /// <param name="installId">The install id the token belongs to.</param>
        /// <param name="tier">Standard, Precision or LocalAgent.</param>
        /// <param name="mode">Fast or Reasoning.</param>
        /// <param name="domain">The domain asked for («ventas» when empty).</param>
        /// <param name="failed">The number of failed checks.</param>
        public static string Run(string sqliteCopy, string firebirdIni, string tokenFile, string installId, string tier, string mode,
            string domain, out int failed)
        {
            var log = new Log();
            RunCheck(log, "reader: the four reads on SQLite", TestReader);
            RunCheck(log, "auth ini: the sections the session does not write stay", TestIniSections);
            RunCheck(log, "strings 2057-2070", TestStrings);
            if (string.IsNullOrEmpty(tokenFile))
                log.Info("AI runs skipped: no /tokenfile");
            else
            {
                string token = File.ReadAllText(tokenFile).Trim();
                if (string.IsNullOrEmpty(domain))
                    domain = "ventas";
                if (!string.IsNullOrEmpty(sqliteCopy))
                    RunCheck(log, "AI: a copy of samples.db", l => TestGenerate(l, "SQLiteCore",
                        "Data Source=" + sqliteCopy + ";Pooling=False", "SAMPLES", token, installId, tier, mode, domain));
                if (!string.IsNullOrEmpty(firebirdIni))
                    RunCheck(log, "AI: EXAMPLE.FDB", l => TestGenerate(l, DatabaseInfo.FIREBIRD_PROVIDER2,
                        FirebirdConnectionString(firebirdIni, "FBEXAMPLE"), "EXAMPLE", token, installId, tier, mode, domain));
            }
            failed = log.Failed;
            return log.ToString();
        }

        private sealed class Log
        {
            private readonly StringBuilder FText = new StringBuilder();
            private string FTest = "";
            internal int Passed;
            internal int Failed;

            internal void Start(string test) { FTest = test; }

            internal void Check(bool condition, string message)
            {
                if (condition)
                {
                    Passed++;
                    return;
                }
                Failed++;
                FText.AppendLine("FAIL [" + FTest + "] " + message);
            }

            internal void Info(string message)
            {
                FText.AppendLine("     [" + FTest + "] " + message);
            }

            public override string ToString()
            {
                return FText.ToString() + "GENERATESCHEMA: " + Passed.ToString() + " passed, " + Failed.ToString() + " failed" + Environment.NewLine;
            }
        }

        private static void RunCheck(Log log, string name, Action<Log> test)
        {
            log.Start(name);
            try
            {
                test(log);
            }
            catch (Exception ex)
            {
                log.Check(false, "exception: " + ex);
            }
        }

        private static Func<DbConnection> Creator(string provider, string connectionString)
        {
            DbProviderFactory factory = DbProviderFactories.GetFactory(provider);
            return () =>
            {
                DbConnection connection = factory.CreateConnection();
                connection.ConnectionString = connectionString;
                return connection;
            };
        }

        // The four reads, and the answers as the API reads them (camelCase JSON)
        private static void TestReader(Log log)
        {
            string dir = Path.Combine(Path.GetTempPath(), "rpgenerate-" + Guid.NewGuid().ToString("N"));
            Directory.CreateDirectory(dir);
            try
            {
                Func<DbConnection> create = Creator("SQLiteCore", "Data Source=" + Path.Combine(dir, "reader.db") + ";Pooling=False");
                var sql = new StringBuilder(
                    "CREATE TABLE CUSTOMERS (CUSTOMERID INTEGER PRIMARY KEY, NAME TEXT, PHOTO BLOB);" +
                    "CREATE TABLE ORDERS (ORDERID INTEGER PRIMARY KEY, CUSTOMERID INTEGER REFERENCES CUSTOMERS(CUSTOMERID), STATUS TEXT);" +
                    "CREATE TABLE LINES (ORDERID INTEGER REFERENCES ORDERS(ORDERID), LINE INTEGER, QTY REAL, PRIMARY KEY (ORDERID, LINE));" +
                    "INSERT INTO CUSTOMERS VALUES (7, 'Ana', x'0102');");
                for (int i = 1; i <= 15; i++)
                    sql.Append("INSERT INTO ORDERS VALUES (" + i + ", 7, '" + (i % 2 == 0 ? "A" : "C") + "');");
                using (DbConnection connection = create())
                {
                    connection.Open();
                    using (DbCommand cmd = connection.CreateCommand())
                    {
                        cmd.CommandText = sql.ToString();
                        cmd.ExecuteNonQuery();
                    }
                }

                var requests = new List<SchemaGenerationRequest>
                {
                    new SchemaGenerationRequest { Id = "t", Kind = "Tables" },
                    new SchemaGenerationRequest { Id = "c", Kind = "Columns", Tables = { "orders", "MISSING" } },
                    new SchemaGenerationRequest { Id = "r1", Kind = "Relations", Tables = { "CUSTOMERS" } },
                    new SchemaGenerationRequest { Id = "r2", Kind = "Relations", Tables = { "ORDERS" } },
                    new SchemaGenerationRequest { Id = "f", Kind = "Rows", Tables = { "ORDERS", "CUSTOMERS", "MISSING" }, MaxRows = 50 },
                };
                List<Dictionary<string, object>> answers;
                using (DbConnection connection = create())
                    answers = SchemaGenerationReader.AnswerAsync(connection, requests, CancellationToken.None).GetAwaiter().GetResult();

                // Read back as the API reads them
                string json = JsonSerializer.Serialize(answers, new JsonSerializerOptions { PropertyNamingPolicy = JsonNamingPolicy.CamelCase });
                using (JsonDocument document = JsonDocument.Parse(json))
                {
                    JsonElement[] a = new JsonElement[5];
                    int n = 0;
                    foreach (JsonElement e in document.RootElement.EnumerateArray())
                        a[n++] = e;
                    log.Check(n == 5, "an answer per request: " + n);
                    foreach (JsonElement e in a)
                        log.Check(e.GetProperty("success").GetBoolean(), "answered: " + e.GetRawText());

                    log.Check(Names(a[0].GetProperty("tables")) == "CUSTOMERS|LINES|ORDERS", "the tables: " + Names(a[0].GetProperty("tables")));

                    JsonElement orders = a[1].GetProperty("columns").GetProperty("orders");
                    log.Check(orders.GetArrayLength() == 3, "ORDERS, asked as «orders», with its three columns: " + orders.GetRawText());
                    if (orders.GetArrayLength() == 3)
                    {
                        log.Check(orders[0].GetProperty("name").GetString() == "ORDERID" && orders[0].GetProperty("isPrimaryKey").GetBoolean(),
                            "its primary key first: " + orders[0].GetRawText());
                        log.Check(orders[0].GetProperty("suggestedDataType").GetString() == "Integer", "an Integer: " + orders[0].GetRawText());
                    }
                    log.Check(a[1].GetProperty("columns").GetProperty("MISSING").GetArrayLength() == 0, "a table it does not have: no columns");

                    log.Check(Relations(a[2]) == "ORDERS(CUSTOMERID)->CUSTOMERS(CUSTOMERID)" && a[2].GetProperty("includesIncoming").GetBoolean(),
                        "CUSTOMERS has no key of its own: the one arriving from ORDERS: " + Relations(a[2]));
                    log.Check(Relations(a[3]) == "LINES(ORDERID)->ORDERS(ORDERID)|ORDERS(CUSTOMERID)->CUSTOMERS(CUSTOMERID)",
                        "ORDERS: the one going out and the one arriving: " + Relations(a[3]));

                    JsonElement rows = a[4].GetProperty("rows");
                    log.Check(rows.GetProperty("ORDERS").GetProperty("rows").GetArrayLength() == 10, "at most 10 rows, whatever is asked");
                    JsonElement customer = rows.GetProperty("CUSTOMERS").GetProperty("rows")[0];
                    log.Check(customer[1].GetString() == "Ana" && customer[2].GetString() == "(BLOB)", "a BLOB as (BLOB): " + customer.GetRawText());
                    log.Check(rows.GetProperty("MISSING").GetProperty("error").GetString().Length > 0, "a table that fails says why, the rest answered");
                }
            }
            finally
            {
                try { Directory.Delete(dir, true); } catch { }
            }
        }

        private static string Names(JsonElement array)
        {
            var names = new List<string>();
            foreach (JsonElement e in array.EnumerateArray())
                names.Add(e.GetString());
            names.Sort(StringComparer.Ordinal);
            return string.Join("|", names);
        }

        private static string Relations(JsonElement answer)
        {
            var list = new List<string>();
            foreach (JsonElement r in answer.GetProperty("relations").EnumerateArray())
                list.Add(r.GetProperty("sourceTable").GetString() + "(" + string.Join(",", Strings(r.GetProperty("sourceColumns"))) + ")->" +
                    r.GetProperty("targetTable").GetString() + "(" + string.Join(",", Strings(r.GetProperty("targetColumns"))) + ")");
            list.Sort(StringComparer.Ordinal);
            return string.Join("|", list);
        }

        private static List<string> Strings(JsonElement array)
        {
            var result = new List<string>();
            foreach (JsonElement e in array.EnumerateArray())
                result.Add(e.GetString());
            return result;
        }

        // Saving the session rewrites [Auth], [Profile] and [Preferences]; the AI of the schemas ([SchemaAI], shared with
        // the Delphi designer) and any other section stay
        private static void TestIniSections(Log log)
        {
            string path = Path.Combine(Path.GetTempPath(), "rpauth-" + Guid.NewGuid().ToString("N") + ".ini");
            try
            {
                File.WriteAllLines(path, new[]
                {
                    "[Auth]", "Token=x", "", "[SchemaAI]", "Tier=Standard", "Mode=Reasoning", "AgentAiId=0", "",
                    "[Preferences]", "AIEnabled=1", "[Delphi]", "Key=Value"
                });
                string kept = string.Join("|", RpAuthManager.OtherSections(path));
                log.Check(kept == "|[SchemaAI]|Tier=Standard|Mode=Reasoning|AgentAiId=0||[Delphi]|Key=Value", "the other sections: " + kept);
                var lines = new List<string>(File.ReadAllLines(path));
                RpAuthManager.RemoveSection(lines, "schemaai");
                string left = string.Join("|", lines);
                log.Check(left == "[Auth]|Token=x||[Preferences]|AIEnabled=1|[Delphi]|Key=Value", "only [SchemaAI] removed: " + left);
            }
            finally
            {
                try { File.Delete(path); } catch { }
            }
        }

        private static void TestStrings(Log log)
        {
            for (int i = 2057; i <= 2070; i++)
            {
                string text = DesignerText.Tr(i);
                log.Check(text.Length > 0 && text != "XXXXXXX", "the string " + i.ToString() + ": " + text);
            }
            string done = DesignerText.Format(2065, "3", "2");
            log.Check(done.Contains("3") && done.Contains("2") && !done.Contains("%"), "the result with its two numbers: " + done);
        }

        // The whole generation against the API, and its import as a new subschema in a temporary folder
        private static void TestGenerate(Log log, string provider, string connectionString, string alias, string token, string installId,
            string tier, string mode, string domain)
        {
            Func<DbConnection> create = Creator(provider, connectionString);
            string dir = Path.Combine(Path.GetTempPath(), "rpgenerate-" + Guid.NewGuid().ToString("N"));
            Directory.CreateDirectory(dir);
            try
            {
                var client = new ReportmanAgentClient
                {
                    Token = token,
                    InstallId = installId ?? "",
                    AITier = string.IsNullOrEmpty(tier) ? "Standard" : tier,
                    AcceptLanguage = "es"
                };
                log.Info("API " + client.BaseUrl + ", " + client.AITier + "/" + (string.IsNullOrEmpty(mode) ? "Fast" : mode) + ", domain «" + domain + "»");
                SchemaGenerationOutcome outcome;
                var watch = Stopwatch.StartNew();
                using (DbConnection connection = create())
                using (var cts = new CancellationTokenSource(TimeSpan.FromMinutes(10)))
                {
                    connection.Open();
                    var loop = new SchemaGenerationLoop(client) { Connection = connection };
                    loop.StatusChanged += line => log.Info("  " + line);
                    outcome = loop.RunAsync(domain, "", string.IsNullOrEmpty(mode) ? "Fast" : mode, "es",
                        DatabaseCatalogReader.DialectOf(connection), null, null, cts.Token).GetAwaiter().GetResult();
                }
                log.Info(string.Format("{0}: {1} calls, {2} turns, {3} credits, {4} tables, {5} relations, {6:0.0} s{7}",
                    outcome.Status, outcome.Calls, outcome.Turns, outcome.Credits, outcome.Tables, outcome.Relations,
                    watch.Elapsed.TotalSeconds, outcome.ErrorMessage.Length > 0 ? " — " + outcome.ErrorMessage : ""));
                log.Check(outcome.Completed && outcome.Tables > 0, "a schema: " + outcome.Status + " " + outcome.ErrorMessage);
                log.Check(outcome.Calls > 1, "the database read by the client between calls: " + outcome.Calls + " calls");
                log.Check(outcome.Credits > 0 || string.Equals(tier, "LocalAgent", StringComparison.OrdinalIgnoreCase),
                    "the credits of the whole generation: " + outcome.Credits);
                foreach (string w in outcome.Warnings)
                    log.Info("  warning: " + w);
                if (!outcome.Completed)
                    return;

                // As the screen does: the local schema file of the connection, the columns of the tables read, the import
                LocalSchemaFile file = LocalSchemaStore.LoadOrGenerate(dir, alias, create, false);
                List<string> tables = LocalSchemaEditing.ImportTables(file, outcome.SchemaJson, null);
                using (DbConnection connection = create())
                    LocalSchemaStore.ReadColumns(file, connection, tables);
                LocalSchemaImportResult result = LocalSchemaEditing.Import(file, outcome.SchemaJson, "", null, outcome.SchemaName);
                log.Check(result != null && result.Subschema != null, "imported as a subschema");
                if (result == null || result.Subschema == null)
                    return;
                log.Check(result.Subschema.Tables.Count == outcome.Tables, "every table of the schema: " +
                    result.Subschema.Tables.Count + " of " + outcome.Tables + (result.Skipped.Count > 0 ? ", left out " + string.Join(", ", result.Skipped) : ""));
                int described = 0, columns = 0;
                foreach (string name in result.Subschema.Tables)
                {
                    LocalSchemaTable table = LocalSchemaEditing.FindTable(file, name);
                    if (table == null)
                        continue;
                    if (!string.IsNullOrWhiteSpace(table.Context))
                        described++;
                    foreach (LocalSchemaColumn c in table.Columns)
                        if (!string.IsNullOrWhiteSpace(c.Context))
                            columns++;
                }
                log.Check(described == result.Subschema.Tables.Count, "the descriptions of the tables in the dictionary: " + described);
                log.Check(columns > 0, "the descriptions of the columns in the dictionary: " + columns);
                log.Info("subschema «" + result.Subschema.Name + "»: " + string.Join(", ", result.Subschema.Tables) + "; " + columns + " columns described");
                LocalSchemaStore.Save(file, LocalSchemaStore.PathFor(dir, alias));
                log.Check(LocalSchemaStore.FindSubschema(LocalSchemaStore.Load(LocalSchemaStore.PathFor(dir, alias)), result.Subschema.Name) != null,
                    "saved and read again");
            }
            finally
            {
                try { Directory.Delete(dir, true); } catch { }
            }
        }

        // The connection string of EXAMPLE.FDB from a Reportman.Server connections file (its credentials never printed)
        private static string FirebirdConnectionString(string iniFile, string section)
        {
            var values = new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase);
            bool inside = false;
            foreach (string raw in File.ReadAllLines(iniFile))
            {
                string line = raw.Trim();
                if (line.StartsWith("[") && line.EndsWith("]"))
                {
                    inside = string.Equals(line.Substring(1, line.Length - 2), section, StringComparison.OrdinalIgnoreCase);
                    continue;
                }
                int eq = line.IndexOf('=');
                if (inside && eq > 0)
                    values[line.Substring(0, eq).Trim()] = line.Substring(eq + 1).Trim();
            }
            string Get(string key, string fallback)
            {
                string v;
                return values.TryGetValue("Param." + key, out v) && v.Length > 0 ? v : fallback;
            }
            return "DataSource=" + Get("DataSource", "localhost") + ";Database=" + Get("Database", "") + ";Port=" + Get("Port", "3050") +
                ";User=" + Get("UserID", "SYSDBA") + ";Password=" + Get("Password", "") + ";Charset=" + Get("Charset", "UTF8") + ";Dialect=3";
        }
    }
}
