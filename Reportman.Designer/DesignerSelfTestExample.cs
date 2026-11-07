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
using Reportman.Reporting;
using System;
using System.Collections.Generic;
using System.Data;
using System.Drawing;
using System.IO;
using System.Net;
using System.Net.Sockets;
using System.Reflection;
using System.Text;
using System.Threading;
using System.Threading.Tasks;
using System.Windows.Forms;

namespace Reportman.Designer
{
    /// <summary>
    /// Headless checks of the example databases of the Hub (invoked from designer.exe /exampletest): the public
    /// ones (isExample, hubDatabaseId 7 in production) answer without a login nor an API key, as in Reportman.Web and
    /// the Delphi designer. The engine sends the request without credentials and gives the clear error of the Delphi
    /// engine when the Hub refuses another database (a local fake Hub), the session of the designer goes when there is
    /// no API key, the lists keep isExample and mark it «DEMO», and the connection assistant selects the example
    /// without anything else (against the real Hub, read-only: skipped without network).
    /// </summary>
    public static class DesignerSelfTestExample
    {
        private const string ExamplesJson =
            "{\"databases\":[" +
            "{\"displayName\":\"Example - Example\",\"name\":\"Example\",\"hubDatabaseId\":7,\"hubSchemaId\":21," +
            "\"isExample\":true,\"isOnline\":true,\"agentName\":\"ExampleAgent\"}," +
            "{\"displayName\":\"Sales - Main\",\"name\":\"Main\",\"hubDatabaseId\":17,\"hubSchemaId\":31," +
            "\"isExample\":false,\"isOnline\":false,\"agentName\":\"pc1\"}," +
            "{\"displayName\":\"Old - Old\",\"name\":\"Old\",\"hubDatabaseId\":18,\"hubSchemaId\":32,\"isExample\":\"true\"}," +
            "{\"displayName\":\"Older - Older\",\"name\":\"Older\",\"hubDatabaseId\":19,\"hubSchemaId\":33}]}";

        /// <summary>
        /// Runs the checks. Returns one line per failed or skipped check and a summary line
        /// ("EXAMPLE: n passed, m failed, k skipped").
        /// </summary>
        /// <param name="shotFolder">The folder for the captures of the lists and the assistant; null or empty for none.</param>
        /// <param name="failed">The number of failed checks.</param>
        public static string RunExampleTests(string shotFolder, out int failed)
        {
            var log = new ExampleLog();
            // Its constructor installs the session of the designer in the engine: before the checks that change it
            RpAuthManager auth = RpAuthManager.Instance;
            log.Check(auth != null && DatabaseInfo.HttpAgentSessionToken != null, "the designer gives its session to the engine");
            RunCheck(log, "strings: 2055, 2056 and the engine texts 1824, 1825", TestStrings);
            RunCheck(log, "HubSchema: isExample", TestParse);
            RunCheck(log, "Hub database list: the DEMO text", TestDatabaseList);
            RunCheck(log, "engine: the example without credentials, the clear error otherwise", TestEngine);
            RunCheck(log, "engine: the session of the designer without an API key", TestSession);
            RunCheck(log, "schema list: the DEMO chip and its hint", f => TestSchemaList(f, shotFolder));
            RunCheck(log, "connection assistant: the note and the example (real Hub)", f => TestAssistant(f, shotFolder));
            RunCheck(log, "local schemas of an Agent connection: the catalog through the API", TestHubCatalog);
            RunCheck(log, "local schemas of an Agent connection: the schema list", TestAgentSchemaList);
            RunCheck(log, "local schemas of an Agent connection: the example (real Hub)", TestHubCatalogOnline);
            failed = log.Failed;
            return log.ToString();
        }

        private sealed class ExampleLog
        {
            private readonly StringBuilder FText = new StringBuilder();
            private string FTest = "";
            internal int Passed;
            internal int Failed;
            internal int Skipped;

            internal void Start(string name)
            {
                FTest = name;
            }

            internal void Check(bool condition, string what)
            {
                if (condition)
                    Passed++;
                else
                {
                    Failed++;
                    FText.AppendLine("FAILED: " + FTest + ": " + what);
                }
            }

            internal void Equal(string expected, string actual, string what)
            {
                Check(string.Equals(expected, actual, StringComparison.Ordinal),
                    what + " (expected «" + expected + "», got «" + actual + "»)");
            }

            internal void Skip(string why)
            {
                Skipped++;
                FText.AppendLine("SKIPPED: " + FTest + ": " + why);
            }

            internal void Note(string text)
            {
                FText.AppendLine("  " + FTest + ": " + text);
            }

            public override string ToString()
            {
                return FText.ToString() + "EXAMPLE: " + Passed + " passed, " + Failed + " failed, " + Skipped + " skipped" +
                    Environment.NewLine;
            }
        }

        /// <summary>A file the checks write their steps to (to see where one hangs); "" for none.</summary>
        public static string TracePath = "";
        internal static void Trace(string text)
        {
            if (TracePath.Length > 0)
                File.AppendAllText(TracePath, DateTime.Now.ToString("HH:mm:ss.fff") + " " + text + Environment.NewLine);
        }

        private static void RunCheck(ExampleLog log, string name, Action<ExampleLog> test)
        {
            Trace("start " + name);
            log.Start(name);
            try
            {
                test(log);
            }
            catch (Exception ex)
            {
                log.Check(false, "exception " + ex.GetType().Name + ": " + ex.Message);
            }
        }

        // ===== Strings =====

        private static void TestStrings(ExampleLog log)
        {
            string note = Translator.TranslateStr(2055);
            log.Check(note.StartsWith("You are not signed in to Reportman AI: the list has the example", StringComparison.Ordinal) ||
                note.StartsWith("No ha iniciado sesión en Reportman AI: la lista muestra las conexiones de ejemplo", StringComparison.Ordinal),
                "2055 is the note without a session («" + note + "»)");
            string hint = Translator.TranslateStr(2056);
            log.Check(hint.StartsWith("Example connection, read-only", StringComparison.Ordinal) ||
                hint.StartsWith("Conexión de demostración, de solo lectura", StringComparison.Ordinal),
                "2056 is the read-only note («" + hint + "»)");
            log.Equal(hint, DemoChip.Hint, "the hint of the chip is 2056");
            log.Check(Translator.TranslateStr(1824).Contains("%s") && Translator.TranslateStr(1825).Contains("%s"),
                "1824 and 1825 name the connection");
        }

        // ===== Parsing and the lists =====

        private static void TestParse(ExampleLog log)
        {
            List<HubSchema> schemas = HubSchema.ListFromJson(ExamplesJson, "");
            log.Check(schemas.Count == 4, "four schemas");
            if (schemas.Count < 4)
                return;
            log.Check(schemas[0].IsExample, "isExample true");
            log.Check(!schemas[1].IsExample, "isExample false");
            log.Check(schemas[2].IsExample, "isExample \"true\"");
            log.Check(!schemas[3].IsExample, "no isExample (an older cloud): not an example");
            log.Equal("Example - ExampleAgent", schemas[0].DatabaseLabel, "the label is not changed");
        }

        private static void TestDatabaseList(ExampleLog log)
        {
            List<HubDatabaseRef> list = HttpAgentParams.DatabasesOf(HubSchema.ListFromJson(ExamplesJson, ""));
            log.Check(list.Count == 4, "one per database");
            if (list.Count < 4)
                return;
            log.Equal("Example - ExampleAgent (DEMO)", list[0].Name, "the example says DEMO");
            log.Check(list[0].IsExample && list[0].Id == 7, "the example, database 7");
            log.Equal("Sales - pc1 " + DesignerText.Tr(2005), list[1].Name, "not connected, not an example");
            log.Check(!list[1].IsExample, "database 17 is not an example");
        }

        // ===== The engine against a fake Hub =====

        /// <summary>
        /// A Hub on 127.0.0.1 that answers as the API: api/agent/execute of database 7 to everybody, of the others
        /// only with an API key or a session (403 otherwise); anything else 404 (the direct channel falls back).
        /// </summary>
        private sealed class FakeHub : IDisposable
        {
            private readonly TcpListener FListener;
            private readonly Thread FThread;
            private volatile bool FStop;
            internal readonly List<string> Requests = new List<string>();

            internal FakeHub()
            {
                FListener = new TcpListener(IPAddress.Loopback, 0);
                FListener.Start();
                FThread = new Thread(Serve) { IsBackground = true };
                FThread.Start();
            }

            internal string BaseUrl
            {
                get { return "http://127.0.0.1:" + ((IPEndPoint)FListener.LocalEndpoint).Port; }
            }

            internal string LastRequest
            {
                get { lock (Requests) return Requests.Count > 0 ? Requests[Requests.Count - 1] : ""; }
            }

            private void Serve()
            {
                while (!FStop)
                {
                    TcpClient client;
                    try
                    {
                        client = FListener.AcceptTcpClient();
                    }
                    catch
                    {
                        return;
                    }
                    try
                    {
                        using (client)
                            Answer(client.GetStream());
                    }
                    catch
                    {
                    }
                }
            }

            private void Answer(NetworkStream stream)
            {
                var headerBytes = new List<byte>();
                int b;
                while ((b = stream.ReadByte()) >= 0)
                {
                    headerBytes.Add((byte)b);
                    int n = headerBytes.Count;
                    if (n >= 4 && headerBytes[n - 4] == 13 && headerBytes[n - 3] == 10 && headerBytes[n - 2] == 13 && headerBytes[n - 1] == 10)
                        break;
                }
                string header = Encoding.ASCII.GetString(headerBytes.ToArray());
                string[] lines = header.Split(new[] { "\r\n" }, StringSplitOptions.None);
                string[] first = lines[0].Split(' ');
                string path = first.Length > 1 ? first[1] : "";
                int length = 0;
                string apiKey = "", authorization = "";
                foreach (string line in lines)
                {
                    int colon = line.IndexOf(':');
                    if (colon <= 0)
                        continue;
                    string name = line.Substring(0, colon).Trim();
                    string value = line.Substring(colon + 1).Trim();
                    if (name.Equals("Content-Length", StringComparison.OrdinalIgnoreCase))
                        int.TryParse(value, out length);
                    else if (name.Equals("X-Reportman-ApiKey", StringComparison.OrdinalIgnoreCase))
                        apiKey = value;
                    else if (name.Equals("Authorization", StringComparison.OrdinalIgnoreCase))
                        authorization = value;
                }
                var body = new byte[length];
                int read = 0;
                while (read < length)
                {
                    int count = stream.Read(body, read, length - read);
                    if (count <= 0)
                        break;
                    read += count;
                }
                string text = Encoding.UTF8.GetString(body, 0, read);
                string id = "";
                int idAt = text.IndexOf("\"hubDatabaseId\":", StringComparison.Ordinal);
                if (idAt >= 0)
                {
                    int start = idAt + "\"hubDatabaseId\":".Length;
                    int end = start;
                    while (end < text.Length && char.IsDigit(text[end]))
                        end++;
                    id = text.Substring(start, end - start);
                }
                string tableName = "";
                int tableAt = text.IndexOf("\"tableName\":\"", StringComparison.Ordinal);
                if (tableAt >= 0)
                {
                    int start = tableAt + "\"tableName\":\"".Length;
                    int end = text.IndexOf('"', start);
                    if (end > start)
                        tableName = text.Substring(start, end - start);
                }
                lock (Requests)
                    Requests.Add(path + "|" + id + (tableName.Length > 0 ? "/" + tableName : "") + "|" + apiKey + "|" + authorization);

                int status;
                string answer;
                bool test = path == "/api/agent/testconnection";
                bool catalog = path == "/api/agent/readtables" || path == "/api/agent/readcolumns" ||
                    path == "/api/agent/readforeignkeys";
                if (path == "/api/agent/databases")
                {
                    status = 200;
                    answer = "{\"databases\":[{\"hubDatabaseId\":7,\"hubSchemaId\":21,\"name\":\"Example\"," +
                        "\"displayName\":\"Example - Example\",\"isExample\":true,\"dialect\":\"Firebird5\"}]}";
                }
                else if (path != "/api/agent/execute" && !test && !catalog)
                {
                    status = 404;
                    answer = "{}";
                }
                else if (id != "7" && apiKey.Length == 0 && authorization.Length == 0)
                {
                    status = 403;
                    answer = "No access to this database. Valid API Key or Login required.";
                }
                else if (catalog)
                {
                    status = 200;
                    answer = CatalogAnswer(path, tableName);
                }
                else if (test)
                {
                    status = 200;
                    answer = "{\"success\":true,\"data\":{\"agentConnectionSuccess\":true,\"databaseConnectionSuccess\":true," +
                        "\"databaseError\":null,\"message\":\"Agent Connection: Success\"},\"error\":null}";
                }
                else
                {
                    status = 200;
                    answer = "{\"success\":true,\"data\":{\"columns\":[{\"name\":\"N\",\"dataType\":\"Int32\"}],\"rows\":[[50]]}}";
                }
                byte[] payload = Encoding.UTF8.GetBytes(answer);
                string response = "HTTP/1.1 " + status + (status == 200 ? " OK" : status == 403 ? " Forbidden" : " Not Found") + "\r\n" +
                    "Content-Type: " + (answer.StartsWith("{") ? "application/json" : "text/plain") + "\r\n" +
                    "Content-Length: " + payload.Length + "\r\nConnection: close\r\n\r\n";
                byte[] head = Encoding.ASCII.GetBytes(response);
                stream.Write(head, 0, head.Length);
                stream.Write(payload, 0, payload.Length);
                stream.Flush();
            }

            public void Dispose()
            {
                FStop = true;
                try { FListener.Stop(); } catch { }
            }

            /// <summary>The catalog of the example, as the Agent answers it (the names not sorted).</summary>
            private static string CatalogAnswer(string path, string table)
            {
                string data;
                if (path == "/api/agent/readtables")
                    data = "\"tables\":[\"SALES\",\"CUSTOMERS\",\"PRODUCTS\"]";
                else if (path == "/api/agent/readcolumns")
                {
                    string columns;
                    if (table == "CUSTOMERS")
                        columns = Column("CUSTOMERID", "System.Int32", "INTEGER", true, 4, 0, 0) + "," +
                            Column("CUSTOMERNAME", "System.String", "VARCHAR", false, 100, 0, 0);
                    else if (table == "PRODUCTS")
                        columns = Column("PRODUCTID", "System.Int32", "INTEGER", true, 4, 0, 0) + "," +
                            Column("PRICE", "System.Decimal", "NUMERIC", false, 0, 15, 2) + "," +
                            Column("NOTES", "System.String", "BLOB SUB_TYPE TEXT", false, 0, 0, 0) + "," +
                            Column("CREATED", "System.DateTime", "TIMESTAMP", false, 8, 0, 0) + "," +
                            Column("LAUNCHED", "System.DateTime", "DATE", false, 4, 0, 0);
                    else if (table == "SALES")
                        columns = Column("DOCID", "System.Int32", "INTEGER", true, 4, 0, 0) + "," +
                            Column("CUSTOMERID", "System.Int32", "INTEGER", false, 4, 0, 0) + "," +
                            Column("PRODUCTID", "System.Int32", "INTEGER", false, 4, 0, 0);
                    else
                        columns = "";
                    data = "\"columns\":[" + columns + "]";
                }
                else if (table == "SALES")
                    data = "\"foreignKeys\":[{\"constraintName\":\"FK_SALES_CUST\",\"sourceTable\":\"SALES\"," +
                        "\"sourceColumns\":[\"CUSTOMERID\"],\"targetTable\":\"CUSTOMERS\",\"targetColumns\":[\"CUSTOMERID\"]}," +
                        "{\"constraintName\":\"FK_SALES_PROD\",\"sourceTable\":\"SALES\",\"sourceColumns\":[\"PRODUCTID\"]," +
                        "\"targetTable\":\"PRODUCTS\",\"targetColumns\":[\"PRODUCTID\"]}]";
                else
                    data = "\"foreignKeys\":[]";
                return "{\"success\":true,\"data\":{" + data + "},\"error\":null}";
            }

            private static string Column(string name, string netType, string declared, bool key, int size, int precision, int scale)
            {
                return "{\"name\":\"" + name + "\",\"detectedNetType\":\"" + netType + "\",\"declaredDbType\":\"" + declared +
                    "\",\"isPrimaryKey\":" + (key ? "true" : "false") + ",\"isNullable\":true,\"isAutoIncrement\":false," +
                    "\"ordinalPosition\":0,\"size\":" + size + ",\"numericPrecision\":" + precision + ",\"numericScale\":" + scale +
                    ",\"suggestedDataType\":1}";
            }
        }

        /// <summary>SELECT through the executor of a connection; returns the value or throws.</summary>
        private static object OpenFirstValue(DatabaseInfo info)
        {
            Trace("open " + info.Alias);
            info.Connect();
            IDbCommand command = info.SqlExecuter.CreateCommand();
            command.CommandText = "SELECT COUNT(*) FROM CUSTOMERS";
            DataTable table = info.SqlExecuter.Open(command);
            return table.Rows.Count > 0 ? table.Rows[0][0] : null;
        }

        private static DatabaseInfo AgentConnection(string alias, string baseUrl, long hubDatabaseId)
        {
            var info = new DatabaseInfo();
            info.Alias = alias;
            info.Driver = DriverType.HttpAgent;
            info.LoadParams = false;
            info.HttpAgentBaseUrl = baseUrl;
            info.HttpAgentHubDatabaseId = hubDatabaseId;
            info.HttpAgentApiKey = "";
            info.HttpAgentToken = "";
            return info;
        }

        private static string Expected(int index, string alias)
        {
            string text = Translator.TranslateStr(index);
            int position = text.IndexOf("%s", StringComparison.Ordinal);
            return text.Substring(0, position) + alias + text.Substring(position + 2);
        }

        private static void TestEngine(ExampleLog log)
        {
            Func<string> savedToken = DatabaseInfo.HttpAgentSessionToken;
            DatabaseInfo.HttpAgentSessionToken = null;
            try
            {
                using (var hub = new FakeHub())
                {
                    // The example: without anything, the data
                    object value = OpenFirstValue(AgentConnection("EXAMPLE", hub.BaseUrl, 7));
                    log.Check(value != null && Convert.ToInt32(value) == 50, "the example answers without credentials");
                    log.Equal("/api/agent/execute|7||", hub.LastRequest, "sent without an API key nor a session");

                    // Another database: the Hub refuses it, the clear error of the Delphi engine with its alias
                    string message = "", name = "";
                    try
                    {
                        OpenFirstValue(AgentConnection("NOKEY", hub.BaseUrl, 17));
                    }
                    catch (NamedException ex)
                    {
                        message = ex.Message;
                        name = ex.Name;
                    }
                    log.Equal(Expected(1825, "NOKEY"), message, "refused without credentials: no API key and no session");
                    log.Equal("NOKEY", name, "the exception names the connection");
                    log.Equal("/api/agent/execute|17||", hub.LastRequest, "the Hub decides");

                    // With an API key the refusal is the Hub's own
                    int before = hub.Requests.Count;
                    message = "";
                    try
                    {
                        DatabaseInfo keyed = AgentConnection("KEYED", hub.BaseUrl, 17);
                        keyed.HttpAgentApiKey = "key-1";
                        log.Check(Convert.ToInt32(OpenFirstValue(keyed)) == 50, "with an API key the fake Hub answers");
                    }
                    catch (Exception ex)
                    {
                        message = ex.Message;
                    }
                    log.Equal("", message, "with an API key no error");
                    log.Check(hub.Requests.Count > before && hub.LastRequest == "/api/agent/execute|17|key-1|", "the API key is sent");

                    // No Hub database: the clear error before calling
                    before = hub.Requests.Count;
                    message = "";
                    try
                    {
                        OpenFirstValue(AgentConnection("NOTCONFIGURED", hub.BaseUrl, 0));
                    }
                    catch (NamedException ex)
                    {
                        message = ex.Message;
                    }
                    log.Equal(Expected(1824, "NOTCONFIGURED"), message, "no Hub database: not configured");
                    log.Check(hub.Requests.Count == before, "the Hub is not called without a Hub database");

                    // The test of a connection: the example answers, another database the clear error
                    var tester = new HttpAgentExecutor { BaseUrl = hub.BaseUrl, HubDatabaseId = 7, ConnectionName = "EXAMPLE" };
                    log.Equal("Agent Connection: Success", tester.TestConnection(), "the test of the example");
                    log.Equal("/api/agent/testconnection|7||", hub.LastRequest, "tested without credentials");
                    message = "";
                    try
                    {
                        new HttpAgentExecutor { BaseUrl = hub.BaseUrl, HubDatabaseId = 17, ConnectionName = "NOKEY" }.TestConnection();
                    }
                    catch (NamedException ex)
                    {
                        message = ex.Message;
                    }
                    log.Equal(Expected(1825, "NOKEY"), message, "the test refused without credentials");
                }
            }
            finally
            {
                DatabaseInfo.HttpAgentSessionToken = savedToken;
            }
        }

        private static void TestSession(ExampleLog log)
        {
            Func<string> savedToken = DatabaseInfo.HttpAgentSessionToken;
            Func<string> savedInstall = DatabaseInfo.HttpAgentSessionInstallId;
            DatabaseInfo.HttpAgentSessionToken = () => "tok-session";
            DatabaseInfo.HttpAgentSessionInstallId = () => "install-1";
            try
            {
                using (var hub = new FakeHub())
                {
                    DatabaseInfo info = AgentConnection("SESSION", hub.BaseUrl, 17);
                    object value = OpenFirstValue(info);
                    log.Check(value != null && Convert.ToInt32(value) == 50, "a private database with the session");
                    log.Equal("/api/agent/execute|17||Bearer tok-session", hub.LastRequest, "the session token is sent");
                    log.Equal("install-1", info.HttpAgentInstallId, "with the install id it is bound to");

                    DatabaseInfo keyed = AgentConnection("OWNKEY", hub.BaseUrl, 17);
                    keyed.HttpAgentApiKey = "key-2";
                    OpenFirstValue(keyed);
                    log.Equal("/api/agent/execute|17|key-2|", hub.LastRequest, "an API key wins over the session");
                }
            }
            finally
            {
                DatabaseInfo.HttpAgentSessionToken = savedToken;
                DatabaseInfo.HttpAgentSessionInstallId = savedInstall;
            }
        }

        // ===== The local schemas of an Agent connection =====

        private static LocalSchemaTable FindTable(LocalSchemaFile file, string name)
        {
            return file.Tables.Find(t => string.Equals(t.Name, name, StringComparison.OrdinalIgnoreCase));
        }

        private static string ColumnText(LocalSchemaTable table, string name)
        {
            LocalSchemaColumn c = table == null ? null : table.Columns.Find(x => x.Name == name);
            return c == null ? "(none)" : c.DataType + " " + c.DetectedType + (c.IsPrimaryKey ? " PK" : "");
        }

        private static void TestHubCatalog(ExampleLog log)
        {
            Func<string> savedToken = DatabaseInfo.HttpAgentSessionToken;
            DatabaseInfo.HttpAgentSessionToken = null;
            try
            {
                using (var hub = new FakeHub())
                {
                    // DatabaseInfo gives the connection of the Agent, with its alias, Hub database and credentials
                    DatabaseInfo info = AgentConnection("EXAMPLE", hub.BaseUrl, 7);
                    var connection = info.CreateDbConnection() as HubAgentConnection;
                    log.Check(connection != null && connection.HubDatabaseId == 7 && connection.ConnectionName == "EXAMPLE",
                        "CreateDbConnection of an Agent connection: a HubAgentConnection");
                    if (connection == null)
                        return;
                    log.Equal("Firebird5", DatabaseCatalogReader.DialectOf(connection), "the dialect the Hub keeps for it");

                    lock (hub.Requests) hub.Requests.Clear();
                    LocalSchemaFile file = LocalSchemaStore.GenerateAsync(connection, "example", null,
                        DatabaseCatalogReader.LargeCatalogThreshold, null, CancellationToken.None).GetAwaiter().GetResult();
                    log.Equal("EXAMPLE", file.Alias, "the alias of the file");
                    log.Equal("Firebird5", file.Dialect, "the dialect of the file");
                    var names = new List<string>();
                    foreach (LocalSchemaTable t in file.Tables)
                        names.Add(t.Name);
                    log.Equal("CUSTOMERS,PRODUCTS,SALES", string.Join(",", names), "the tables, sorted");
                    LocalSchemaTable customers = FindTable(file, "CUSTOMERS");
                    LocalSchemaTable products = FindTable(file, "PRODUCTS");
                    LocalSchemaTable sales = FindTable(file, "SALES");
                    // As the information schema, the same as the Delphi engine (CloudTypeOfSqlType, SqlTypeText)
                    log.Equal("Integer INTEGER(4) PK", ColumnText(customers, "CUSTOMERID"), "an integer key");
                    log.Equal("String VARCHAR(100)", ColumnText(customers, "CUSTOMERNAME"), "a varchar with its length");
                    log.Equal("Numeric NUMERIC(15,2)", ColumnText(products, "PRICE"), "a numeric with its precision and scale");
                    log.Equal("TextLong BLOB SUB_TYPE TEXT", ColumnText(products, "NOTES"), "a text blob");
                    log.Equal("TimeStamp TIMESTAMP(8)", ColumnText(products, "CREATED"), "a timestamp");
                    log.Equal("Date DATE(4)", ColumnText(products, "LAUNCHED"), "a date");
                    log.Check(sales != null && sales.ForeignKeys.Count == 2 && sales.ForeignKeys[0].ConstraintName == "FK_SALES_CUST" &&
                        sales.ForeignKeys[0].TargetTable == "CUSTOMERS" && sales.ForeignKeys[0].SourceColumns[0] == "CUSTOMERID" &&
                        sales.ForeignKeys[0].TargetColumns[0] == "CUSTOMERID", "the foreign keys of SALES");
                    log.Check(customers != null && customers.ForeignKeys.Count == 0, "CUSTOMERS has none");
                    string requests;
                    lock (hub.Requests) requests = string.Join(";", hub.Requests);
                    log.Check(requests.StartsWith("/api/agent/readtables|7||;/api/agent/readcolumns|7/CUSTOMERS||;" +
                        "/api/agent/readforeignkeys|7/CUSTOMERS||;", StringComparison.Ordinal), "a request of each per table, without credentials (" +
                        requests + ")");

                    // A large catalog: the names first, the columns of a table when it is used
                    LocalSchemaFile large = LocalSchemaStore.GenerateAsync(connection, "EXAMPLE", null, 2, null, CancellationToken.None)
                        .GetAwaiter().GetResult();
                    LocalSchemaTable largeSales = FindTable(large, "SALES");
                    log.Check(large.Tables.Count == 3 && largeSales != null && largeSales.ColumnsRead == false && largeSales.Columns.Count == 0,
                        "a large catalog: the names only");
                    List<LocalSchemaTable> details = DatabaseCatalogReader.ReadTableDetailsAsync(connection, new[] { "sales" }, null,
                        CancellationToken.None).GetAwaiter().GetResult();
                    log.Check(details.Count == 1 && details[0].Name == "SALES" && details[0].Columns.Count == 3 && details[0].ForeignKeys.Count == 2,
                        "the columns of a table read when it is used");

                    // The preview: its SQL through api/agent/execute
                    DataTable preview = LocalSchemaEditing.ReadPreviewAsync(() => info.CreateDbConnection(), file.Dialect, "CUSTOMERS", 5, null,
                        CancellationToken.None).GetAwaiter().GetResult();
                    log.Check(preview.Rows.Count == 1 && Convert.ToInt32(preview.Rows[0][0]) == 50, "the preview through the Agent");
                    log.Check(hub.LastRequest == "/api/agent/execute|7||", "the preview runs on the Hub database (" + hub.LastRequest + ")");

                    // Cancelled
                    bool cancelled = false;
                    using (var cts = new CancellationTokenSource())
                    {
                        cts.Cancel();
                        try
                        {
                            LocalSchemaStore.GenerateAsync(connection, "EXAMPLE", null, 0, null, cts.Token).GetAwaiter().GetResult();
                        }
                        catch (OperationCanceledException)
                        {
                            cancelled = true;
                        }
                    }
                    log.Check(cancelled, "a read cancelled");

                    // Another database without credentials: the clear error
                    string message = "";
                    try
                    {
                        LocalSchemaStore.GenerateAsync(AgentConnection("NOKEY", hub.BaseUrl, 17).CreateDbConnection(), "NOKEY", null, 0,
                            null, CancellationToken.None).GetAwaiter().GetResult();
                    }
                    catch (NamedException ex)
                    {
                        message = ex.Message;
                    }
                    log.Equal(Expected(1825, "NOKEY"), message, "refused without credentials: the clear error");
                }
            }
            finally
            {
                DatabaseInfo.HttpAgentSessionToken = savedToken;
            }
        }

        private static object PrivateValue(object target, string field)
        {
            System.Reflection.FieldInfo info = target.GetType().GetField(field, BindingFlags.NonPublic | BindingFlags.Instance | BindingFlags.Public);
            return info == null ? null : info.GetValue(target);
        }

        private static void TestAgentSchemaList(ExampleLog log)
        {
            string folder = Path.Combine(Path.GetTempPath(), "rm_exampletest_" + Guid.NewGuid().ToString("N"));
            Directory.CreateDirectory(folder);
            try
            {
                var file = new LocalSchemaFile { Alias = "EXAMPLE", Dialect = "Firebird5" };
                var customers = new LocalSchemaTable { Name = "CUSTOMERS" };
                customers.Columns.Add(new LocalSchemaColumn { Name = "CUSTOMERID", DataType = "Integer", IsPrimaryKey = true });
                customers.Columns.Add(new LocalSchemaColumn { Name = "CUSTOMERNAME", DataType = "String" });
                file.Tables.Add(customers);
                var subschema = new LocalSubschema { Name = "Sales" };
                subschema.Tables.Add("CUSTOMERS");
                file.Schemas.Add(subschema);
                LocalSchemaStore.Save(file, LocalSchemaStore.PathFor(folder, "EXAMPLE"));

                using (var form = new Form())
                {
                    form.StartPosition = FormStartPosition.Manual;
                    form.Location = new Point(-3000, -3000);
                    var selector = new AISchemaSelectorControl { Dock = DockStyle.Top, LocalSchemaFolder = folder };
                    selector.LocalSchemaEditRequested += (s, e) => { };
                    form.Controls.Add(selector);
                    form.Show();
                    Application.DoEvents();
                    var agents = new Dictionary<string, long>(StringComparer.OrdinalIgnoreCase) { { "EXAMPLE", 7 } };
                    selector.ApplySchemas(HubSchema.ListFromJson(ExamplesJson, ""));
                    selector.SetPreferredConnection(7, "");
                    // The report has its Hub schema: it stays selected, the local subschema is offered
                    selector.SetDirectConnections(new[] { "EXAMPLE" }, "EXAMPLE", false, null, agents);
                    var combo = (ComboBox)PrivateValue(selector, "_comboSchema");
                    bool listed = false;
                    foreach (object item in combo.Items)
                        if (item.ToString().Contains("EXAMPLE · Sales"))
                            listed = true;
                    log.Check(listed, "the local subschema of the Agent connection is listed");
                    log.Check(selector.HubDatabaseId == 7 && !selector.IsLocalSchemaSelected, "its Hub schema stays selected");
                    log.Equal("", selector.MissingSchemaAlias, "an Agent connection never misses a subschema");

                    selector.SelectLocalSchema("EXAMPLE", "Sales");
                    log.Check(selector.IsLocalSchemaSelected && selector.LocalAlias == "EXAMPLE" && selector.LocalSubschema == "Sales",
                        "its local subschema selected");
                    object newLocal = PrivateValue(selector, "_newLocalAction");
                    object newCloud = PrivateValue(selector, "_newCloudAction");
                    log.Check((bool)PrivateValue(newLocal, "Enabled"), "New local schema... for an Agent connection");
                    log.Check((bool)PrivateValue(newCloud, "Enabled"), "New cloud schema... on its Hub database");
                    log.Equal("", (string)PrivateValue(newCloud, "Reason"), "no «not in the Hub» for an Agent connection");
                    Dictionary<string, object> inline;
                    string message;
                    log.Check(selector.PrepareSchemaToSend("Standard", out inline, out message, null) && inline != null,
                        "the local subschema travels inline (" + message + ")");
                    object dialect;
                    log.Check(inline != null && inline.TryGetValue("dialect", out dialect) && Convert.ToString(dialect) == "Firebird5",
                        "with the dialect of its file");

                    // An Agent connection without a local file, local preferred and no Hub schema asked for: its Hub
                    // schema, not nothing
                    selector.SetPreferredConnection(0, "");
                    selector.SetHubContext(0, 0, "");
                    var agent2 = new Dictionary<string, long>(StringComparer.OrdinalIgnoreCase) { { "AGENT2", 7 } };
                    selector.SetDirectConnections(new[] { "AGENT2" }, "AGENT2", true, "", agent2);
                    log.Check(selector.HubDatabaseId == 7, "an Agent connection without subschemas: its Hub schema");
                    // A direct connection without subschemas (a selector of its own: this one keeps what it selected): nothing,
                    // the copilot asks for one, as before
                    var direct = new AISchemaSelectorControl { Dock = DockStyle.Top, LocalSchemaFolder = folder };
                    direct.LocalSchemaEditRequested += (s, e) => { };
                    form.Controls.Add(direct);
                    // As the designer: the connections and the context of the report, then the list of the Hub arrives
                    direct.SetDirectConnections(new[] { "DIRECT" }, "DIRECT", true, "", null);
                    direct.SetHubContext(0, 0, "");
                    direct.ApplySchemas(HubSchema.ListFromJson(ExamplesJson, ""));
                    log.Check(direct.HubDatabaseId == 0 && direct.MissingSchemaAlias == "DIRECT",
                        "a direct connection without subschemas: none, and the copilot asks");
                    log.Equal(DesignerText.Tr(1842), (string)PrivateValue(PrivateValue(direct, "_newCloudAction"), "Reason"),
                        "«not in the Hub» for a direct connection");
                    form.Close();
                }
            }
            finally
            {
                try { Directory.Delete(folder, true); } catch { }
            }
        }

        private static void TestHubCatalogOnline(ExampleLog log)
        {
            Func<string> savedToken = DatabaseInfo.HttpAgentSessionToken;
            DatabaseInfo.HttpAgentSessionToken = null;
            try
            {
                DatabaseInfo info = AgentConnection("EXAMPLE", RpAuthManager.HUB_API_URL, 7);
                LocalSchemaFile file;
                try
                {
                    file = LocalSchemaStore.GenerateAsync(info.CreateDbConnection(), "EXAMPLE", null,
                        DatabaseCatalogReader.LargeCatalogThreshold, null, CancellationToken.None).GetAwaiter().GetResult();
                }
                catch (Exception ex) when (ex is System.Net.Http.HttpRequestException || ex is TaskCanceledException)
                {
                    log.Skip("the Hub does not answer: " + ex.Message);
                    return;
                }
                log.Equal("Firebird5", file.Dialect, "the dialect of the example");
                LocalSchemaTable customers = FindTable(file, "CUSTOMERS");
                LocalSchemaTable sales = FindTable(file, "SALES");
                log.Check(customers != null && customers.Columns.Exists(c => c.Name == "CUSTOMERID" && c.IsPrimaryKey && c.DataType == "Integer"),
                    "CUSTOMERS and its key");
                log.Check(sales != null && sales.ForeignKeys.Exists(fk => fk.TargetTable == "CUSTOMERS"), "SALES and its relation to CUSTOMERS");
                log.Note(file.Tables.Count + " tables, " + (customers != null ? customers.Columns.Count : 0) + " columns in CUSTOMERS: " +
                    ColumnText(customers, "CUSTOMERNAME"));
            }
            finally
            {
                DatabaseInfo.HttpAgentSessionToken = savedToken;
            }
        }

        // ===== The schema list =====

        private static void TestSchemaList(ExampleLog log, string shotFolder)
        {
            using (var form = new Form())
            {
                form.StartPosition = FormStartPosition.Manual;
                form.Location = new Point(-3000, -3000);
                form.Size = new Size(520, 160);
                var selector = new AISchemaSelectorControl { Dock = DockStyle.Top };
                form.Controls.Add(selector);
                form.Show();
                Application.DoEvents();
                selector.ApplySchemas(HubSchema.ListFromJson(ExamplesJson, ""));
                selector.SetHubContext(7, 21, "");
                Application.DoEvents();
                log.Check(selector.HubDatabaseId == 7 && selector.HubSchemaId == 21, "the example selected");

                System.Reflection.FieldInfo comboField = typeof(AISchemaSelectorControl).GetField("_comboSchema", BindingFlags.NonPublic | BindingFlags.Instance);
                System.Reflection.FieldInfo tipField = typeof(AISchemaSelectorControl).GetField("_toolTip", BindingFlags.NonPublic | BindingFlags.Instance);
                var combo = (ComboBox)comboField.GetValue(selector);
                var tip = (ToolTip)tipField.GetValue(selector);
                log.Check(tip.GetToolTip(combo).Contains(DemoChip.Hint), "the hint of the example says read-only");

                // The items drawn as the list draws them: the chip of the example is orange
                MethodInfo draw = typeof(AISchemaSelectorControl).GetMethod("ComboSchema_DrawItem", BindingFlags.NonPublic | BindingFlags.Instance);
                int height = Math.Max(18, combo.ItemHeight + 4);
                int width = 460;
                // 24 bits: GDI text on an ARGB bitmap gets dark fringes the screen does not have
                using (var bmp = new Bitmap(width, height * combo.Items.Count, System.Drawing.Imaging.PixelFormat.Format24bppRgb))
                {
                    using (Graphics g = Graphics.FromImage(bmp))
                    {
                        g.Clear(Color.White);
                        for (int i = 0; i < combo.Items.Count; i++)
                        {
                            var args = new DrawItemEventArgs(g, combo.Font, new Rectangle(0, i * height, width, height), i,
                                i == combo.SelectedIndex ? DrawItemState.Selected : DrawItemState.None);
                            draw.Invoke(selector, new object[] { combo, args });
                        }
                    }
                    int exampleRow = -1, otherRow = -1;
                    for (int i = 0; i < combo.Items.Count; i++)
                    {
                        string text = combo.Items[i].ToString();
                        if (text.Contains("Example - ExampleAgent"))
                            exampleRow = i;
                        else if (text.Contains("Older / Older"))
                            otherRow = i;
                    }
                    log.Check(exampleRow >= 0 && otherRow >= 0, "the example and another schema in the list");
                    if (exampleRow >= 0)
                        log.Check(CountOrange(bmp, new Rectangle(0, exampleRow * height, width, height)) > 20, "the example has the orange chip");
                    if (otherRow >= 0)
                        log.Check(CountOrange(bmp, new Rectangle(0, otherRow * height, width, height)) == 0, "the others have no chip");
                    if (!string.IsNullOrEmpty(shotFolder))
                    {
                        Directory.CreateDirectory(shotFolder);
                        bmp.Save(Path.Combine(shotFolder, "example_schema_list.png"), System.Drawing.Imaging.ImageFormat.Png);
                    }
                }
                form.Close();
            }
        }

        private static int CountOrange(Bitmap bmp, Rectangle area)
        {
            int count = 0;
            for (int y = area.Top; y < area.Bottom && y < bmp.Height; y++)
                for (int x = area.Left; x < area.Right && x < bmp.Width; x++)
                {
                    Color c = bmp.GetPixel(x, y);
                    // The text of the chip, #FF9800, antialiased
                    if (c.R > 230 && c.G > 110 && c.G < 200 && c.B < 90)
                        count++;
                }
            return count;
        }

        // ===== The connection assistant against the real Hub =====

        private static void TestAssistant(ExampleLog log, string shotFolder)
        {
            using (var form = new Form())
            {
                form.StartPosition = FormStartPosition.Manual;
                form.Location = new Point(-3000, -3000);
                form.Size = new Size(720, 560);
                var control = new ConnectionParamsControl { Dock = DockStyle.Fill };
                form.Controls.Add(control);
                form.Show();
                Application.DoEvents();
                control.SelectHttpAgent();
                bool signedIn = RpAuthManager.Instance.IsLoggedIn;
                log.Note(signedIn ? "with the session of this computer" : "without a session");
                string note = control.AgentNoteText;
                log.Check(note.StartsWith(signedIn ? Translator.TranslateStr(1831) : Translator.TranslateStr(2055), StringComparison.Ordinal),
                    "the note of the " + (signedIn ? "session" : "example connections") + " («" + note + "»)");
                log.Check(control.AgentLoginVisible == !signedIn, "Log in only without a session");
                Task load = control.AgentListLoad;
                DateTime until = DateTime.Now.AddSeconds(30);
                while (load != null && !load.IsCompleted && DateTime.Now < until)
                {
                    Application.DoEvents();
                    Thread.Sleep(20);
                }
                Application.DoEvents();
                if (control.AgentHubDatabaseId <= 0)
                {
                    log.Skip("no example from the Hub (no network?)");
                }
                else
                {
                    log.Check(control.AgentDatabaseIsExample, "the first example selected without anything else (" +
                        control.AgentHubDatabaseId + " " + control.AgentDatabaseName + ")");
                    log.Check(control.AgentDatabaseName.EndsWith(DemoChip.TextSuffix, StringComparison.Ordinal), "its name says DEMO");
                    log.Check(control.AgentNoteText.EndsWith(DemoChip.Hint, StringComparison.Ordinal), "the note says read-only");
                    control.TestConnection();
                    log.Check(control.LastOk == true, "Test without an API key: " + control.LastResultText);
                }
                if (!string.IsNullOrEmpty(shotFolder))
                {
                    Directory.CreateDirectory(shotFolder);
                    using (var bmp = new Bitmap(form.ClientSize.Width, form.ClientSize.Height))
                    {
                        form.DrawToBitmap(bmp, new Rectangle(0, 0, bmp.Width, bmp.Height));
                        bmp.Save(Path.Combine(shotFolder, "example_connection_assistant.png"), System.Drawing.Imaging.ImageFormat.Png);
                    }
                }
                form.Close();
            }
        }
    }
}
