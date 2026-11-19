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
using System.ComponentModel;
using System.Data;
using System.Data.Common;
using System.IO;
using System.Text;

namespace Reportman.Designer
{
    /// <summary>
    /// Headless checks of the connections of this computer (invoked from designer.exe /localconnectionstest; F8 of the
    /// Reportman AI plan «conexiones locales»): the <c>DriverName=ADO.NET</c> sections of a dbxconnections.ini made in a
    /// temporary folder (never the user's file) next to a Delphi section and an Agent one, their passwords ciphered
    /// with DPAPI (the blobs of ProtectedData, as Reportman AI writes them), the alias of a report resolved by the
    /// engine to the string with its password, a password this user cannot read asked once and saved ciphered without
    /// touching any other byte of the file, a real query through the alias, and the driver list, the new report wizard
    /// and the connection editor of the designer keeping only the alias. Nothing is shown.
    /// </summary>
    public static class DesignerSelfTestLocalConnections
    {
        private const string FakeProvider = "RMSELFTESTPROVIDER";

        /// <summary>
        /// Runs the checks. Returns one line per failed check, some numbers, and a summary line
        /// ("LOCALCONNECTIONS: n passed, m failed").
        /// </summary>
        /// <param name="samplesDb">A SQLite database to query (it is copied first); empty for the samples.db next to
        /// designer.exe, or one made here when there is none.</param>
        /// <param name="failed">The number of failed checks.</param>
        public static string Run(string samplesDb, out int failed)
        {
            Log log = new Log();
            string dir = Path.Combine(Path.GetTempPath(), "rplocalconnections-" + Guid.NewGuid().ToString("N"));
            Directory.CreateDirectory(dir);
            string previousOverride = DbxDirectConnections.OverridePath;
            Func<DbxPasswordRequest, string> previousHook = DatabaseInfo.DirectConnectionPassword;
            DatabaseInfo.CustomProviderFactories[FakeProvider] = FakeFactory.Instance;
            try
            {
                string db = Path.Combine(dir, "samples.db");
                if (string.IsNullOrEmpty(samplesDb))
                    samplesDb = Path.Combine(AppDomain.CurrentDomain.BaseDirectory, "samples", "samples.db");
                if (File.Exists(samplesDb))
                {
                    File.Copy(samplesDb, db);
                    log.Info("database: a copy of " + samplesDb);
                }
                else
                {
                    MakeDatabase(db);
                    log.Info("database: made here (no " + samplesDb + ")");
                }
                string ini = Path.Combine(dir, "dbxconnections.ini");
                File.WriteAllBytes(ini, Latin1.GetBytes(IniText(db)));
                DbxDirectConnections.OverridePath = ini;
                DatabaseInfo.DirectConnectionPassword = null;

                RunCheck(log, "file: the ADO.NET sections and nothing else", l => TestRead(l, ini));
                RunCheck(log, "dpapi: round trip, ProtectedData blobs both ways", TestDpapi);
                RunCheck(log, "engine: the alias resolves to its string with the password", l => TestResolve(l));
                RunCheck(log, "engine: a password asked, saved ciphered once it opens", l => TestAsk(l, ini));
                RunCheck(log, "engine: cancelling the password", TestCancel);
                RunCheck(log, "engine: a secret added at the end of a file without a last line ending", l => TestWriteSecretAppend(l, dir));
                RunCheck(log, "engine: the Agent, Delphi and the report's own connection as before", TestNotBroken);
                RunCheck(log, "engine: a real query through the alias", l => TestQuery(l, db));
                // From here no password may be asked: the designer would show its dialog
                DatabaseInfo.DirectConnectionPassword = request =>
                {
                    throw new InvalidOperationException("A password was asked in the self-test: " + request.Alias);
                };
                RunCheck(log, "designer: the driver list and its test", TestDriverList);
                RunCheck(log, "designer: the new report wizard keeps only the alias", TestWizard);
                RunCheck(log, "designer: the connection editor keeps only the alias", TestEditor);
                RunCheck(log, "report file: saved, loaded and run by the alias", TestReportFile);
                RunCheck(log, "strings 2071-2075", TestStrings);
            }
            finally
            {
                DbxDirectConnections.OverridePath = previousOverride;
                DatabaseInfo.DirectConnectionPassword = previousHook;
                DatabaseInfo.CustomProviderFactories.Remove(FakeProvider);
                // The SQLite connections go without pooling: the folder can go
                try { Directory.Delete(dir, true); }
                catch { }
            }
            failed = log.Failed;
            return log.ToString();
        }

        private static readonly Encoding Latin1 = Encoding.GetEncoding(28591);
        private static string FVentasSecret = "";
        private static string FLockedSecret = "";

        // A Delphi section with a byte of ANSI (ñ) and a comment, an Agent one, and the connections of this computer
        private static string IniText(string db)
        {
            FVentasSecret = DbxDirectConnections.Protect("s3cret");
            byte[] garbage = new byte[64];
            new Random(7).NextBytes(garbage);
            // Ciphered by «another user»: this one cannot read it
            FLockedSecret = DbxDirectConnections.DpapiPrefix + Convert.ToBase64String(garbage);
            string nl = "\r\n";
            return "; Reportman connections (self-test)" + nl +
                "[DELPHIFB]" + nl +
                "DriverName=Interbase" + nl +
                "Database=C:\\datos\\a\u00F1o.fdb" + nl +
                "; a comment of Delphi" + nl +
                "User_Name=SYSDBA" + nl +
                "Password=masterkey" + nl +
                nl +
                "[AGENTDB]" + nl +
                "DriverName=Reportman AI Agent" + nl +
                "ApiKey=KEY-1" + nl +
                "HubDatabaseId=42" + nl +
                nl +
                "[VENTAS]" + nl +
                "DriverName=ADO.NET" + nl +
                "ProviderFactory=SQLiteCore" + nl +
                "Param.DataSource=C:\\datos\\ventas.db" + nl +
                "Secret.Password=" + FVentasSecret + nl +
                "ConnectionString=Data Source=C:\\datos\\ventas.db" + nl +
                "Delphi.DriverName=FireDAC" + nl +
                nl +
                "[SAMPLES]" + nl +
                "DriverName=ADO.NET" + nl +
                "ProviderFactory=SQLiteCore" + nl +
                "Param.DataSource=" + db + nl +
                "ConnectionString=Data Source=" + db + ";Pooling=False" + nl +
                nl +
                "[LOCKED]" + nl +
                "DriverName=ADO.NET" + nl +
                "ProviderFactory=" + FakeProvider + nl +
                "Param.Server=fake" + nl +
                "Secret.Password=" + FLockedSecret + nl +
                "; kept comment" + nl +
                "ConnectionString=Server=fake" + nl +
                "Delphi.Database=fake" + nl +
                nl +
                "[LOCKED2]" + nl +
                "DriverName=ADO.NET" + nl +
                "ProviderFactory=" + FakeProvider + nl +
                "Secret.Password=" + FLockedSecret + nl +
                "ConnectionString=Server=fake2" + nl +
                nl +
                "[CLEAR]" + nl +
                "DriverName=ADO.NET" + nl +
                "ProviderFactory=PostgreSQL" + nl +
                "Param.Host=localhost" + nl +
                "Param.Username=report" + nl +
                "Param.Password=pg-clear" + nl +
                "ConnectionString=Host=localhost;Username=report" + nl +
                nl +
                "[PARAMSONLY]" + nl +
                "DriverName=ADO.NET" + nl +
                "ProviderFactory=SQLiteCore" + nl +
                "Param.DataSource=C:\\x\\p.db" + nl;
        }

        private static void TestRead(Log log, string ini)
        {
            List<DbxDirectConnection> list = DbxDirectConnections.ReadDirect(ini);
            List<string> aliases = new List<string>();
            foreach (DbxDirectConnection c in list)
                aliases.Add(c.Alias);
            string joined = string.Join(",", aliases.ToArray());
            log.Check(joined == "VENTAS,SAMPLES,LOCKED,LOCKED2,CLEAR,PARAMSONLY", "the connections of this computer: " + joined);
            DbxDirectConnection ventas = DbxDirectConnections.FindDirect("ventas", ini);
            log.Check(ventas != null && ventas.ProviderFactory == "SQLiteCore", "VENTAS by its alias in lowercase, SQLiteCore");
            if (ventas == null)
                return;
            log.Check(ventas.Parameters.Count == 1 && ventas.Parameters["DataSource"] == "C:\\datos\\ventas.db", "its Param.DataSource");
            log.Check(ventas.Secrets.Count == 1 && ventas.Secrets["Password"] == FVentasSecret, "its Secret.Password, as it is");
            log.Check(ventas.ConnectionString == "Data Source=C:\\datos\\ventas.db", "its ConnectionString: " + ventas.ConnectionString);
            log.Check(ventas.Extra.Count == 1 && ventas.Extra[0].Key == "Delphi.DriverName", "the key of Delphi kept apart");
            log.Check(DbxDirectConnections.FindDirect("DELPHIFB", ini) == null && DbxDirectConnections.FindDirect("AGENTDB", ini) == null,
                "neither Delphi's nor the Agent's are connections of this computer");
            log.Check(DbxConnections.GetDirectConnections().Count == 6, "the designer reads the same file (OverridePath)");
        }

        private static void TestDpapi(Log log)
        {
            string secret = DbxDirectConnections.Protect("contraseña ñ €");
            log.Check(secret != null && secret.StartsWith("dpapi:", StringComparison.Ordinal), "dpapi: + base64");
            log.Check(DbxDirectConnections.Unprotect(secret) == "contraseña ñ €", "deciphered as it was");
            log.Check(DbxDirectConnections.Unprotect(FLockedSecret) == null, "another user's blob: null, no exception");
            log.Check(DbxDirectConnections.Unprotect("dpapi:%%%") == null && DbxDirectConnections.Unprotect("plain") == null,
                "not base64 or not dpapi: null");
#if NET5_0_OR_GREATER
            // The same blobs as ProtectedData with the entropy of Reportman AI (SecretProtector) and Reportman.Server
            byte[] entropy = Encoding.UTF8.GetBytes("Reportman.dbxconnections");
            string fromAI = "dpapi:" + Convert.ToBase64String(System.Security.Cryptography.ProtectedData.Protect(
                Encoding.UTF8.GetBytes("from-reportman-ai"), entropy, System.Security.Cryptography.DataProtectionScope.CurrentUser));
            log.Check(DbxDirectConnections.Unprotect(fromAI) == "from-reportman-ai", "a ProtectedData blob deciphered by the engine");
            byte[] back = System.Security.Cryptography.ProtectedData.Unprotect(Convert.FromBase64String(secret.Substring(6)), entropy,
                System.Security.Cryptography.DataProtectionScope.CurrentUser);
            log.Check(Encoding.UTF8.GetString(back) == "contraseña ñ €", "an engine blob deciphered by ProtectedData");
#endif
        }

        private static DatabaseInfo AliasOnly(string alias)
        {
            DatabaseInfo info = new DatabaseInfo();
            info.Alias = alias;
            info.Driver = DriverType.DotNet2;
            info.ProviderFactory = "";
            info.ConnectionString = "";
            return info;
        }

        private static string Key(string connectionString, string key)
        {
            DbConnectionStringBuilder builder = new DbConnectionStringBuilder();
            builder.ConnectionString = connectionString;
            object value;
            return builder.TryGetValue(key, out value) ? Convert.ToString(value) : null;
        }

        private static void TestResolve(Log log)
        {
            DatabaseInfo ventas = AliasOnly("VENTAS");
            log.Check(ventas.FindDirectConnectionFromConfig() != null, "VENTAS is a connection of this computer");
            using (DbConnection connection = ventas.CreateDbConnection())
            {
                log.Check(connection.GetType().Name == "SqliteConnection", "opened with SQLiteCore: " + connection.GetType().Name);
                log.Check(Key(connection.ConnectionString, "Password") == "s3cret", "the password deciphered and added");
                log.Check(Key(connection.ConnectionString, "Data Source") == "C:\\datos\\ventas.db", "its data source");
            }
            log.Check(ventas.ProviderFactory == "" && ventas.ConnectionString == "", "the report connection still keeps only the alias");

            // Reportman.Server's: the password in clear, not in its string
            DatabaseInfo clear = AliasOnly("CLEAR");
            using (DbConnection connection = clear.CreateDbConnection())
            {
                log.Check(Key(connection.ConnectionString, "Password") == "pg-clear", "Param.Password in clear added: " + connection.GetType().Name);
                log.Check(Key(connection.ConnectionString, "Host") == "localhost", "its host");
            }

            // Only Param.*: through the provider's builder (CLR names)
            DatabaseInfo onlyParams = AliasOnly("PARAMSONLY");
            using (DbConnection connection = onlyParams.CreateDbConnection())
                log.Check(Key(connection.ConnectionString, "Data Source") == "C:\\x\\p.db", "a string from Param.DataSource: " + connection.ConnectionString);
        }

        private static void TestAsk(Log log, string ini)
        {
            byte[] before = File.ReadAllBytes(ini);
            DatabaseInfo.DirectConnectionPassword = null;
            using (DbConnection connection = AliasOnly("LOCKED").CreateDbConnection())
                log.Check(Key(connection.ConnectionString, "Password") == null, "without a host that asks: opened without it");

            int calls = 0;
            DbxPasswordRequest seen = null;
            string answer = "wrong";
            DatabaseInfo.DirectConnectionPassword = request =>
            {
                calls++;
                seen = request;
                return answer;
            };
            // A mistyped password: it does not open, it is not kept
            DatabaseInfo locked = AliasOnly("LOCKED");
            bool refused = false;
            try
            {
                locked.Connect();
            }
            catch (Exception)
            {
                refused = true;
            }
            log.Check(refused && calls == 1, "a wrong password: refused by the provider, asked once (" + calls + ")");
            log.Check(seen != null && seen.Alias == "LOCKED" && seen.ParameterName == "Password" && seen.ProviderFactory == FakeProvider
                && string.Equals(seen.FileName, ini, StringComparison.OrdinalIgnoreCase), "the request: alias, parameter, provider and file");
            log.Check(Same(before, File.ReadAllBytes(ini)), "the file did not change with a password that did not open");

            // The right one: it opens, and it is saved ciphered in its section
            answer = "nueva";
            locked = AliasOnly("LOCKED");
            locked.Connect();
            log.Check(calls == 2, "asked again (" + calls + ")");
            log.Check(Key(locked.Connection.ConnectionString, "Password") == "nueva", "opened with the password given");
            locked.DisConnect();
            byte[] after = File.ReadAllBytes(ini);
            DbxDirectConnection saved = DbxDirectConnections.FindDirect("LOCKED", ini);
            string newSecret = saved != null && saved.Secrets.ContainsKey("Password") ? saved.Secrets["Password"] : "";
            log.Check(newSecret != FLockedSecret && DbxDirectConnections.Unprotect(newSecret) == "nueva", "Secret.Password ciphered for this user");
            // Every other byte as it was: the same file with only that value changed
            byte[] expected = Latin1.GetBytes(Latin1.GetString(before).Replace(
                "[LOCKED]\r\nDriverName=ADO.NET\r\nProviderFactory=" + FakeProvider + "\r\nParam.Server=fake\r\nSecret.Password=" + FLockedSecret,
                "[LOCKED]\r\nDriverName=ADO.NET\r\nProviderFactory=" + FakeProvider + "\r\nParam.Server=fake\r\nSecret.Password=" + newSecret));
            log.Check(Same(expected, after), "the rest of the file byte for byte (Delphi's ñ, comments, CRLF, LOCKED2's secret)");
            log.Info("file: " + before.Length + " bytes before, " + after.Length + " after; only the Secret.Password of LOCKED changed");

            // Now it is this user's: not asked any more
            using (DbConnection connection = AliasOnly("LOCKED").CreateDbConnection())
                log.Check(calls == 2 && Key(connection.ConnectionString, "Password") == "nueva", "deciphered the next time, not asked (" + calls + ")");
            DatabaseInfo.DirectConnectionPassword = null;
        }

        private static void TestCancel(Log log)
        {
            DatabaseInfo.DirectConnectionPassword = request => null;
            string message = "";
            try
            {
                AliasOnly("LOCKED2").CreateDbConnection().Dispose();
            }
            catch (NamedException ex)
            {
                message = ex.Message;
            }
            finally
            {
                DatabaseInfo.DirectConnectionPassword = null;
            }
            log.Check(message.Contains("LOCKED2"), "cancelled: the connection needs its password: " + message);
        }

        private static void TestWriteSecretAppend(Log log, string dir)
        {
            string file = Path.Combine(dir, "append.ini");
            // A UTF-8 file with BOM and LF endings, without the last one
            string text = "\uFEFF[DELPHI]\nDriverName=FireDAC\n\n[LAST]\nDriverName=ADO.NET\nProviderFactory=SQLiteCore\nParam.DataSource=C:\\b\u00E9.db";
            File.WriteAllBytes(file, new UTF8Encoding(false).GetBytes(text));
            DbxDirectConnections.WriteSecret(file, "last", "Password", "dpapi:QUJD");
            string after = new UTF8Encoding(false).GetString(File.ReadAllBytes(file));
            log.Check(after == text + "\nSecret.Password=dpapi:QUJD\n", "added after its last line, with the file's LF: " + after.Replace("\n", "\\n"));
            bool refused = false;
            try
            {
                DbxDirectConnections.WriteSecret(file, "DELPHI", "Password", "dpapi:QUJD");
            }
            catch (InvalidOperationException)
            {
                refused = true;
            }
            log.Check(refused, "never in a section of Delphi");
        }

        private static void TestNotBroken(Log log)
        {
            // The Agent: as before
            DatabaseInfo agent = AliasOnly("AGENTDB");
            log.Check(agent.FindDirectConnectionFromConfig() == null, "the Agent's is not a connection of this computer");
            agent.ResolveHttpAgentConnectionParamsFromConfig();
            log.Check(agent.Driver == DriverType.HttpAgent && agent.HttpAgentApiKey == "KEY-1" && agent.HttpAgentHubDatabaseId == 42,
                "the Agent's section still gives HttpAgent, its key and its Hub database");
            // Delphi's: not opened by the .Net engine, as before
            string error = "";
            try
            {
                AliasOnly("DELPHIFB").CreateDbConnection().Dispose();
            }
            catch (Exception ex)
            {
                error = ex.Message;
            }
            log.Check(error == "Provider factory not supplied", "a Delphi alias without provider: the same error as before (" + error + ")");
            // The report's own connection wins over the section with its alias
            DatabaseInfo own = new DatabaseInfo();
            own.Alias = "VENTAS";
            own.Driver = DriverType.DotNet2;
            own.ProviderFactory = "SQLiteCore";
            own.ConnectionString = "Data Source=C:\\own.db";
            log.Check(own.FindDirectConnectionFromConfig() == null, "a report with its own connection does not look at the file");
            using (DbConnection connection = own.CreateDbConnection())
                log.Check(connection.ConnectionString == "Data Source=C:\\own.db", "its own string, untouched: " + connection.ConnectionString);
            // LoadParams off (Reportman.Server binds its own connections): the file is not read
            DatabaseInfo off = AliasOnly("VENTAS");
            off.LoadParams = false;
            log.Check(off.FindDirectConnectionFromConfig() == null, "LoadParams=false: the file is not read");
        }

        private static string FirstTable(string db)
        {
            using (DbConnection connection = DbProviderFactories.GetFactory("SQLiteCore").CreateConnection())
            {
                connection.ConnectionString = "Data Source=" + db + ";Pooling=False";
                connection.Open();
                using (DbCommand command = connection.CreateCommand())
                {
                    command.CommandText = "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name";
                    return Convert.ToString(command.ExecuteScalar());
                }
            }
        }

        private static Report QueryReport(string alias, string sql)
        {
            Report report = new Report();
            report.CreateNew();
            while (report.DatabaseInfo.Count > 0)
                report.DatabaseInfo.RemoveAt(0);
            DatabaseInfo info = AliasOnly(alias);
            info.Report = report;
            report.DatabaseInfo.Add(info);
            DataInfo dataset = new DataInfo();
            dataset.Report = report;
            dataset.Alias = "QUERY";
            dataset.DatabaseAlias = alias;
            dataset.SQL = sql;
            report.DataInfo.Add(dataset);
            return report;
        }

        private static void TestQuery(Log log, string db)
        {
            string table = FirstTable(db);
            log.Check(table.Length > 0, "the database has tables");
            Report report = QueryReport("SAMPLES", "SELECT COUNT(*) AS N FROM " + table);
            try
            {
                report.DataInfo[0].Connect();
                long rows = Convert.ToInt64(report.DataInfo[0].Data.CurrentRow[0]);
                log.Check(rows > 0, "SELECT COUNT(*) FROM " + table + " through the alias SAMPLES: " + rows);
                log.Info("query: " + table + " has " + rows + " rows, read through the alias SAMPLES");
            }
            finally
            {
                report.DataInfo[0].DisConnect();
                report.DatabaseInfo[0].DisConnect();
            }
        }

        private static void TestDriverList(Log log)
        {
            using (ConnectionParamsControl control = new ConnectionParamsControl())
            {
                string aliases = string.Join(",", control.LocalAliases.ToArray());
                log.Check(aliases == "VENTAS,SAMPLES,LOCKED,LOCKED2,CLEAR,PARAMSONLY", "the list offers the connections of this computer: " + aliases);
                log.Check(control.SelectLocal("samples"), "SAMPLES chosen");
                log.Check(control.IsLocal && control.LocalAlias == "SAMPLES" && !control.IsHttpAgent, "local mode, its alias");
                log.Check(control.ProviderInvariant == "SQLiteCore" && control.ConnectionString == "",
                    "its provider, and no connection string for the report");
                control.TestConnection();
                log.Check(control.LastOk == true, "its test opens it by the alias: " + control.LastResultText);

                log.Check(control.SelectLocal("VENTAS"), "VENTAS chosen");
                PropertyDescriptorCollection properties = TypeDescriptor.GetProperties(control.GridSelectedObject);
                PropertyDescriptor dataSource = properties.Find("DataSource", false);
                PropertyDescriptor password = properties.Find("Password", false);
                log.Check(dataSource != null && Convert.ToString(dataSource.GetValue(control.GridSelectedObject)) == "C:\\datos\\ventas.db"
                    && dataSource.IsReadOnly, "its parameters, read-only");
                log.Check(password != null && Convert.ToString(password.GetValue(control.GridSelectedObject)) == LocalConnectionView.Mask,
                    "its password masked, never in clear");

                control.Populate(DatabaseInfo.FIREBIRD_PROVIDER2, "");
                log.Check(!control.IsLocal && control.LocalAlias == "" && control.ProviderInvariant == DatabaseInfo.FIREBIRD_PROVIDER2,
                    "a driver again: not local");
                log.Check(!control.SelectLocal("NOTTHERE") && !control.IsLocal, "an alias the file does not have is not chosen");
            }
        }

        private static void TestWizard(Log log)
        {
            bool selected, readOnly, readOnlyAfter;
            string aliasText;
            Report report = NewReportWizard.SelfTestLocal("SAMPLES", out selected, out aliasText, out readOnly, out readOnlyAfter);
            log.Check(selected && aliasText == "SAMPLES" && readOnly, "the name of the connection is the alias, read-only: " + aliasText);
            log.Check(!readOnlyAfter, "a driver again: the name can be written");
            log.Check(report.DatabaseInfo.Count == 1, "one connection");
            if (report.DatabaseInfo.Count == 1)
            {
                DatabaseInfo info = report.DatabaseInfo[0];
                log.Check(info.Alias == "SAMPLES" && info.Driver == DriverType.DotNet2 && info.ProviderFactory == "" && info.ConnectionString == "",
                    "only the alias in the report: " + info.Alias + "/" + info.Driver + "/'" + info.ProviderFactory + "'/'" + info.ConnectionString + "'");
            }
        }

        private static void TestEditor(Log log)
        {
            Report report = new Report();
            report.CreateNew();
            while (report.DatabaseInfo.Count > 0)
                report.DatabaseInfo.RemoveAt(0);
            DatabaseInfo connection = new DatabaseInfo();
            connection.Report = report;
            connection.Alias = "CONNECTION";
            connection.Driver = DriverType.DotNet2;
            connection.ProviderFactory = DatabaseInfo.FIREBIRD_PROVIDER2;
            connection.ConnectionString = "DataSource=localhost;Database=x.fdb";
            report.DatabaseInfo.Add(connection);
            DatabaseInfo other = new DatabaseInfo();
            other.Report = report;
            other.Alias = "OTHER";
            report.DatabaseInfo.Add(other);
            DataInfo q1 = new DataInfo();
            q1.Report = report;
            q1.Alias = "Q1";
            q1.DatabaseAlias = "CONNECTION";
            report.DataInfo.Add(q1);
            DataInfo q2 = new DataInfo();
            q2.Report = report;
            q2.Alias = "Q2";
            q2.DatabaseAlias = "OTHER";
            report.DataInfo.Add(q2);

            string error;
            bool ok = ConnectionEditor.ApplyLocal(report, connection, "SAMPLES", out error);
            log.Check(ok && connection.Alias == "SAMPLES" && connection.Driver == DriverType.DotNet2 && connection.ProviderFactory == ""
                && connection.ConnectionString == "", "renamed to the alias, only the alias kept");
            log.Check(q1.DatabaseAlias == "SAMPLES" && q2.DatabaseAlias == "OTHER", "its datasets follow it, the others do not");

            ok = ConnectionEditor.ApplyLocal(report, other, "samples", out error);
            log.Check(!ok && other.Alias == "OTHER" && error.Contains("samples"), "another connection with that alias: refused (" + error + ")");
        }

        private static void TestReportFile(Log log)
        {
            bool selected, readOnly, readOnlyAfter;
            string aliasText;
            Report report = NewReportWizard.SelfTestLocal("SAMPLES", out selected, out aliasText, out readOnly, out readOnlyAfter);
            byte[] bytes;
            using (MemoryStream stream = new MemoryStream())
            {
                report.SaveToStream(stream, StreamVersion.V2);
                bytes = stream.ToArray();
            }
            string xml = Encoding.UTF8.GetString(bytes);
            log.Check(xml.IndexOf("s3cret", StringComparison.Ordinal) < 0 && xml.IndexOf("Data Source", StringComparison.OrdinalIgnoreCase) < 0,
                "the saved report has neither a password nor a connection string");
            Report loaded = new Report();
            using (MemoryStream stream = new MemoryStream(bytes))
                loaded.LoadFromStream(stream, false);
            log.Check(loaded.DatabaseInfo.Count == 1 && loaded.DatabaseInfo[0].Alias == "SAMPLES" && loaded.DatabaseInfo[0].ProviderFactory == ""
                && loaded.DatabaseInfo[0].ConnectionString == "", "loaded: the alias, nothing else");
            if (loaded.DatabaseInfo.Count != 1)
                return;
            DatabaseInfo info = loaded.DatabaseInfo[0];
            try
            {
                info.Connect();
                using (IDbCommand command = info.Connection.CreateCommand())
                {
                    command.Transaction = info.CurrentTransaction;
                    command.CommandText = "SELECT COUNT(*) FROM sqlite_master WHERE type='table'";
                    long tables = Convert.ToInt64(command.ExecuteScalar());
                    log.Check(tables > 0, "the loaded report opens SAMPLES by its alias: " + tables + " tables");
                    log.Info("report file: " + bytes.Length + " bytes, loaded and connected by the alias (" + tables + " tables)");
                }
            }
            finally
            {
                info.DisConnect();
            }
        }

        private static void TestStrings(Log log)
        {
            for (int i = 2071; i <= 2075; i++)
            {
                string text = DesignerText.Tr(i);
                log.Check(text.Length > 0 && text != "XXXXXXX", "the string " + i.ToString() + ": " + text);
            }
            string item = DesignerText.Format(2071, "VENTAS");
            log.Check(item.Contains("VENTAS") && !item.Contains("%"), "the list item with its alias: " + item);
        }

        private static void MakeDatabase(string db)
        {
            using (DbConnection connection = DbProviderFactories.GetFactory("SQLiteCore").CreateConnection())
            {
                connection.ConnectionString = "Data Source=" + db + ";Pooling=False";
                connection.Open();
                using (DbCommand command = connection.CreateCommand())
                {
                    command.CommandText = "CREATE TABLE CUSTOMERS (ID INTEGER PRIMARY KEY, NAME TEXT);" +
                        "INSERT INTO CUSTOMERS VALUES (1, 'Ana'); INSERT INTO CUSTOMERS VALUES (2, 'Luis');";
                    command.ExecuteNonQuery();
                }
            }
        }

        private static bool Same(byte[] a, byte[] b)
        {
            if (a.Length != b.Length)
                return false;
            for (int i = 0; i < a.Length; i++)
                if (a[i] != b[i])
                    return false;
            return true;
        }

        // ---- a provider that only checks the password (no database): the engine's ask-and-save without a server ----

        private sealed class FakeFactory : DbProviderFactory
        {
            public static readonly FakeFactory Instance = new FakeFactory();
            public override DbConnection CreateConnection() { return new FakeConnection(); }
        }

        private sealed class FakeConnection : DbConnection
        {
            private ConnectionState FState = ConnectionState.Closed;
            public override string ConnectionString { get; set; }
            public override string Database { get { return "fake"; } }
            public override string DataSource { get { return "fake"; } }
            public override string ServerVersion { get { return "1"; } }
            public override ConnectionState State { get { return FState; } }
            public override void ChangeDatabase(string databaseName) { }

            public override void Open()
            {
                if (Key(ConnectionString ?? "", "Password") == "wrong")
                    throw new InvalidOperationException("Login failed (fake provider)");
                FState = ConnectionState.Open;
                OnStateChange(new StateChangeEventArgs(ConnectionState.Closed, ConnectionState.Open));
            }

            public override void Close()
            {
                if (FState == ConnectionState.Closed)
                    return;
                FState = ConnectionState.Closed;
                OnStateChange(new StateChangeEventArgs(ConnectionState.Open, ConnectionState.Closed));
            }

            protected override DbTransaction BeginDbTransaction(IsolationLevel isolationLevel) { return new FakeTransaction(this, isolationLevel); }
            protected override DbCommand CreateDbCommand() { throw new NotSupportedException(); }
        }

        private sealed class FakeTransaction : DbTransaction
        {
            private readonly DbConnection FConnection;
            private readonly IsolationLevel FLevel;
            public FakeTransaction(DbConnection connection, IsolationLevel level) { FConnection = connection; FLevel = level; }
            public override IsolationLevel IsolationLevel { get { return FLevel; } }
            protected override DbConnection DbConnection { get { return FConnection; } }
            public override void Commit() { }
            public override void Rollback() { }
        }

        // ---- the log, as the other self-tests ----

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
                return FText.ToString() + "LOCALCONNECTIONS: " + Passed.ToString() + " passed, " + Failed.ToString() + " failed" + Environment.NewLine;
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
    }
}
