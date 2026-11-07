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
using System.IO;
using System.Text;
using System.Text.Json;
using System.Threading;

namespace Reportman.Designer
{
    /// <summary>
    /// The onboarding, headless (designer.exe /onboardingtest): a sample report opened as the welcome window opens
    /// it (its folder: the SQLite database of the samples is relative), its local schema and the subschema of the
    /// dataset sent inline, and a request of the copilot built with the copilot's own pieces (the document of
    /// <c>SaveReportAsXmlForAI</c>, <see cref="LocalSchemaStore.BuildInlineConfig"/> as the schema selector,
    /// <see cref="CopilotModifyReportLoop"/> with the folder of the report for its copies). It runs against the real
    /// API as a guest of a new installation (an install id "repman-..."), never with the session of the designer.
    /// </summary>
    public static class DesignerSelfTestOnboarding
    {
        /// <summary>The production API: the Debug designer talks to the development one.</summary>
        public const string ProductionApi = "https://aiapi.reportman.es";

        private sealed class OnboardingLog
        {
            public readonly StringBuilder Text = new StringBuilder();
            public int Passed;
            public int Failed;

            public void Line(string text)
            {
                Text.AppendLine(text);
                Console.WriteLine(text);
            }

            public void Check(bool ok, string what)
            {
                if (ok)
                    Passed++;
                else
                    Failed++;
                Line((ok ? "[OK] " : "[FAIL] ") + what);
            }
        }

        private static string OneLine(string text)
        {
            return (text ?? "").Replace("\r", " ").Replace("\n", " ");
        }

        private static string GetString(JsonElement element, string name)
        {
            JsonElement value;
            if (element.ValueKind != JsonValueKind.Object || !element.TryGetProperty(name, out value) ||
                value.ValueKind == JsonValueKind.Null)
                return "";
            return value.ValueKind == JsonValueKind.String ? value.GetString() ?? "" : value.GetRawText();
        }

        /// <summary>The report as the designer opens a file (FrameMainDesigner.OpenReportFileInternal).</summary>
        private static Report OpenAsDesigner(string fileName)
        {
            var report = new Report();
            using (MemoryStream memstream = StreamUtil.FileToMemoryStream(fileName))
            {
                memstream.Seek(0, SeekOrigin.Begin);
                report.LoadFromStream(memstream);
            }
            report.ConvertToDotNet();
            report.ReportFolder = Path.GetDirectoryName(Path.GetFullPath(fileName));
            return report;
        }

        /// <summary>The document the copilot sends (FrameMainDesigner.SaveReportAsXmlForAI).</summary>
        private static string DocumentOf(Report report)
        {
            using (var stream = new MemoryStream())
            {
                report.SaveToStream(stream, StreamVersion.V2);
                return Encoding.UTF8.GetString(stream.ToArray());
            }
        }

        /// <summary>
        /// Runs the onboarding. Returns the log and the summary line ("ONBOARDING: n passed, m failed").
        /// </summary>
        /// <param name="reportFile">The sample report (default: customers.rep of the installed samples).</param>
        /// <param name="installId">The install id of the guest ("repman-..."); empty: a new one.</param>
        /// <param name="mode">Fast or Reasoning, as the mode of the copilot.</param>
        /// <param name="prompt">The request; empty: the field in the dataset and in the report.</param>
        /// <param name="outFile">Where the document of the AI is saved; empty for nowhere.</param>
        /// <param name="runAI">False: the schema and the SQL of the copilot only, without the AI.</param>
        /// <param name="failed">The number of failed checks.</param>
        public static string Run(string reportFile, string installId, string mode, string prompt, string outFile,
            bool runAI, out int failed)
        {
            var log = new OnboardingLog();
            try
            {
                RunChecks(log, reportFile, installId, mode, prompt, outFile, runAI);
            }
            catch (Exception ex)
            {
                log.Check(false, "unexpected " + ex.GetType().Name + ": " + OneLine(ex.Message));
            }
            log.Line("ONBOARDING: " + log.Passed + " passed, " + log.Failed + " failed");
            failed = log.Failed;
            return log.Text.ToString();
        }

        private static void RunChecks(OnboardingLog log, string reportFile, string installId, string mode,
            string prompt, string outFile, bool runAI)
        {
            if (string.IsNullOrEmpty(reportFile))
                reportFile = Path.Combine(SampleReports.InstalledFolder(), "customers.rep");
            log.Line("Sample: " + reportFile);
            log.Line("Current folder: " + Directory.GetCurrentDirectory());
            Report report = OpenAsDesigner(reportFile);
            log.Check(!string.IsNullOrEmpty(report.ReportFolder), "the report knows its folder");

            DataInfo dataset = null;
            foreach (DataInfo info in report.DataInfo)
                if (string.Equals(info.Alias, "CUST", StringComparison.OrdinalIgnoreCase))
                    dataset = info;
            log.Check(dataset != null, "the dataset CUST");
            if (dataset == null)
                return;
            string alias = dataset.DatabaseAlias;
            log.Line("  connection " + alias + ", SCHEMANAME " + dataset.SchemaName);
            log.Line("  SQL before: " + OneLine(dataset.SQL));

            // The local schema, as the copilot's selector sends it (installed at start by the main form)
            SampleReports.InstallSchema();
            string folder = LocalSchemaEditorForm.DesignerFolder();
            string schemaPath = LocalSchemaStore.PathFor(folder, alias);
            log.Line("  schema file: " + schemaPath);
            log.Check(File.Exists(schemaPath), "the local schema of the samples is installed");
            LocalSchemaFile schema = LocalSchemaStore.Load(schemaPath);
            LocalSubschema selected = LocalSchemaStore.FindSubschema(schema, dataset.SchemaName);
            log.Check(selected != null, "the subschema " + dataset.SchemaName + " of the dataset is in the file");
            if (selected == null)
                return;
            Dictionary<string, object> inlineConfig = LocalSchemaStore.BuildInlineConfig(schema, selected.Name);
            log.Check(inlineConfig != null && inlineConfig.Count > 0, "the subschema travels inline");

            string document = DocumentOf(report);
            string reportFolder = report.ReportFolder;
            Action<Report> prepare = copy => copy.ReportFolder = reportFolder;

            // A SQL of the AI on a copy of that document, from a folder without the database
            string strayDb = Path.Combine(Directory.GetCurrentDirectory(), "samples.db");
            bool strayBefore = File.Exists(strayDb);
            var probe = new CopilotClientSqlRequest { Id = "p1", DatabaseAlias = alias, Sql = "SELECT COUNT(*) AS N FROM CUSTOMERS" };
            CopilotClientSqlResult probeResult = CopilotSqlProbe.Run(document, probe, prepare);
            log.Line("  probe: " + (probeResult.Columns != null ? probeResult.Columns.Count : 0) + " columns " +
                OneLine(probeResult.ErrorMessage));
            log.Check(probeResult.Success, "the SQL of the AI runs on the database of the sample");
            log.Check(strayBefore || !File.Exists(strayDb), "no empty samples.db in the current folder");

            if (!runAI)
            {
                log.Line("AI skipped (/noai)");
                return;
            }

            if (string.IsNullOrEmpty(installId))
                installId = "repman-onboardingtest-" + DateTime.Now.ToString("yyyyMMddHHmmss");
            if (string.IsNullOrEmpty(mode))
                mode = "Reasoning";
            if (string.IsNullOrEmpty(prompt))
                prompt = "Add the email of each customer to the dataset CUST and show it in the report as a new column after the phone";
            log.Line("Mode: Standard " + mode + ", guest " + installId);
            log.Line("Prompt: " + prompt);

            // The client as the copilot configures it (AIChatPanelControl.BtnSend_Click), a guest
            var client = new ReportmanAgentClient
            {
                BaseUrl = ProductionApi,
                Token = "",
                InstallId = installId,
                AcceptLanguage = "en",
                AITier = "Standard",
                ApiKey = "",
                AgentSecret = "",
                AgentAiId = 0,
                HubDatabaseId = 0,
                HubSchemaId = 0,
                InlineConfig = inlineConfig
            };
            var loop = new CopilotModifyReportLoop(client) { PrepareReport = prepare };
            loop.StatusChanged += s => log.Line("  [status] " + OneLine(s));
            CopilotModifyReportOutcome outcome = loop.RunAsync(prompt, document, mode, "English",
                "", null, null, CancellationToken.None).GetAwaiter().GetResult();
            log.Line("  calls: " + outcome.Calls + ", client SQL: " + outcome.SqlRequests.Count);
            for (int i = 0; i < outcome.SqlResults.Count; i++)
                log.Check(outcome.SqlResults[i].Success, "client SQL " + (i + 1) + " runs: " +
                    OneLine(outcome.SqlRequests[i].Sql) + " " + OneLine(outcome.SqlResults[i].ErrorMessage));
            using (JsonDocument result = outcome.Result)
            {
                log.Check(result != null, "the API answers");
                if (result == null)
                    return;
                JsonElement root = result.RootElement;
                string error = GetString(root, "errorMessage");
                if (error.Length > 0)
                    log.Line("  error: " + OneLine(error) + " " + OneLine(GetString(root, "debugDetails")));
                JsonElement final;
                bool hasResult = root.TryGetProperty("result", out final) && final.ValueKind == JsonValueKind.Object;
                if (hasResult)
                {
                    if (GetString(final, "errorMessage").Length > 0)
                        log.Line("  result error: " + OneLine(GetString(final, "errorMessage")));
                    string explanation = OneLine(GetString(final, "explanation"));
                    log.Line("  explanation: " + (explanation.Length > 500 ? explanation.Substring(0, 500) : explanation));
                }
                log.Check(error.Length == 0 && hasResult, "no error");
                string modified = hasResult ? GetString(final, "modifiedReportDocument") : "";
                if (modified.Length == 0)
                    modified = outcome.DocumentToApply ?? "";
                log.Check(modified.Length > 0, "a document to apply");
                if (modified.Length == 0)
                    return;
                if (!string.IsNullOrEmpty(outFile))
                {
                    File.WriteAllText(outFile, modified, new UTF8Encoding(false));
                    log.Line("  saved: " + outFile);
                }
                Report changed = CopilotSqlProbe.LoadReport(modified);
                DataInfo after = null;
                foreach (DataInfo info in changed.DataInfo)
                    if (string.Equals(info.Alias, "CUST", StringComparison.OrdinalIgnoreCase))
                        after = info;
                log.Check(after != null, "the dataset CUST is still there");
                if (after != null)
                {
                    log.Line("  SQL after: " + OneLine(after.SQL));
                    string sql = after.SQL.ToUpperInvariant();
                    log.Check(sql.Contains("EMAIL"), "its SQL has EMAIL");
                    log.Check(!sql.Contains("CUSTOMER_CODE"), "its columns keep their names (no CODE AS Customer_Code)");
                    log.Check(string.Equals(after.DatabaseAlias, alias, StringComparison.OrdinalIgnoreCase),
                        "on the connection " + alias);
                }
                log.Check(modified.ToUpperInvariant().Contains("CUST.EMAIL"), "the report has an expression with CUST.EMAIL");
            }
        }
    }
}
