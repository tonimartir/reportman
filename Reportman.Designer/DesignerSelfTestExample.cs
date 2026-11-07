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
                lock (Requests)
                    Requests.Add(path + "|" + id + "|" + apiKey + "|" + authorization);

                int status;
                string answer;
                bool test = path == "/api/agent/testconnection";
                if (path != "/api/agent/execute" && !test)
                {
                    status = 404;
                    answer = "{}";
                }
                else if (id != "7" && apiKey.Length == 0 && authorization.Length == 0)
                {
                    status = 403;
                    answer = "No access to this database. Valid API Key or Login required.";
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
