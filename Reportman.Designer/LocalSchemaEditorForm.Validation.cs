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
using System.Diagnostics;
using System.Globalization;
using System.Text.Json;
using System.Threading;
using System.Windows.Forms;
using Reportman.Reporting;

namespace Reportman.Designer
{
    // The Validation tab: Save, and «Analyze with AI», which sends what the copilot would send for the
    // subschema to NlToSql/AnalyzeSchemaStream and shows the Markdown it answers (🟢/🟡/🔴 per table and
    // column): what the AI does not understand.
    public partial class LocalSchemaEditorForm
    {
        private Button _btnValidationSave;
        private Button _btnAnalyze;
        private Button _btnStopAnalysis;
        private Label _lblAnalysis;
        private WebMarkdownControl _markdown;
        private CancellationTokenSource _analysis;

        private TabPage BuildValidationTab()
        {
            var page = new TabPage(Tr(1401)) { Padding = new Padding(6) };
            var info = new Label
            {
                Dock = DockStyle.Top,
                Height = 40,
                Text = Tr(1877)
            };
            var bar = new FlowLayoutPanel { Dock = DockStyle.Top, Height = 36, WrapContents = false };
            _btnValidationSave = new Button { Text = Tr(46), AutoSize = true };
            _btnValidationSave.Click += (s, e) => SaveFile();
            _btnAnalyze = new Button { Text = Tr(1876), AutoSize = true };
            _btnAnalyze.Click += (s, e) => Analyze();
            _btnStopAnalysis = new Button { Text = Tr(1522), AutoSize = true, Visible = false };
            _btnStopAnalysis.Click += (s, e) =>
            {
                try { _analysis?.Cancel(); } catch (ObjectDisposedException) { }
            };
            _lblAnalysis = new Label { AutoSize = true, Margin = new Padding(8, 9, 0, 0), ForeColor = System.Drawing.SystemColors.GrayText };
            bar.Controls.Add(_btnValidationSave);
            bar.Controls.Add(_btnAnalyze);
            bar.Controls.Add(_btnStopAnalysis);
            bar.Controls.Add(_lblAnalysis);
            _markdown = new WebMarkdownControl { Dock = DockStyle.Fill };

            page.Controls.Add(_markdown);
            page.Controls.Add(bar);
            page.Controls.Add(info);
            return page;
        }

        private void UpdateAnalysisState()
        {
            if (_btnAnalyze == null)
                return;
            bool running = _analysis != null;
            _btnValidationSave.Enabled = _file != null && !_busy;
            _btnAnalyze.Enabled = _file != null && !_busy && !running;
            _btnStopAnalysis.Visible = running;
        }

        private string SchemaCaption
        {
            get { return _alias + " · " + (_current == null ? Tr(1843) : _current.Name); }
        }

        private async void Analyze()
        {
            if (_file == null || _analysis != null)
                return;
            CommitEdits();
            var cts = new CancellationTokenSource();
            _analysis = cts;
            UpdateAnalysisState();
            string caption = SchemaCaption;
            var stats = new AIRequestLogStats();
            stats.Begin();
            _markdown.ClearAll();
            _lblAnalysis.Text = Tr(1878);
            bool cloud = !_ai.IsLocalAgent;
            try
            {
                var client = new ReportmanAgentClient
                {
                    Token = RpAuthManager.Instance.Token,
                    InstallId = RpAuthManager.Instance.InstallId,
                    AcceptLanguage = RpAuthManager.Instance.AILanguageCode,
                    AITier = _ai.Tier,
                    ApiKey = "",
                    HubDatabaseId = 0,
                    HubSchemaId = 0,
                    // What the copilot would send for this subschema (all the tables without one)
                    InlineConfig = LocalSchemaStore.BuildInlineConfig(_file, _current != null ? _current.Name : "")
                };
                if (_ai.IsLocalAgent)
                {
                    client.AgentSecret = _ai.AgentSecret;
                    client.AgentAiId = _ai.AgentAiId;
                }
                client.LogMessage += message => RpAuthManager.Instance.Log(message);
                // The request is written here, before the first await: later edits do not change it
                JsonDocument answer = await client.AnalyzeSchemaAsync(_ai.Mode, RpAuthManager.Instance.AILanguageCode, this,
                    (sender, actor, stage, chunkType, chunk, inputTokens, outputTokens, progressId, prefill) =>
                    {
                        long received = Stopwatch.GetTimestamp();
                        PostToUi(() => ShowAnalysisProgress(stats, actor, stage, chunkType, inputTokens, outputTokens, progressId, received));
                    },
                    cts.Token);
                using (answer)
                {
                    if (IsDisposed)
                        return;
                    stats.AddAnswer(answer);
                    ShowAnalysisAnswer(answer, caption, stats);
                }
            }
            catch (OperationCanceledException)
            {
                if (!IsDisposed)
                    _lblAnalysis.Text = Tr(1881);
            }
            catch (Exception ex)
            {
                if (!IsDisposed)
                {
                    _lblAnalysis.Text = Tr(1928);
                    _markdown.AppendMessage("system", Tr(355) + ": " + ex.Message);
                }
            }
            finally
            {
                if (_analysis == cts)
                    _analysis = null;
                cts.Dispose();
                if (!IsDisposed)
                    UpdateAnalysisState();
                // The credits spent: the gauges of the AI panels follow (AuthChanged)
                if (cloud && RpAuthManager.Instance.IsLoggedIn)
                    RpAuthManager.Instance.RefreshStatusInBackground();
            }
        }

        private void PostToUi(Action action)
        {
            if (IsDisposed || !IsHandleCreated)
                return;
            try
            {
                BeginInvoke(action);
            }
            catch (InvalidOperationException)
            {
            }
        }

        private void ShowAnalysisProgress(AIRequestLogStats stats, string actor, string stage, string chunkType,
            int inputTokens, int outputTokens, string progressId, long received)
        {
            if (IsDisposed || _analysis == null)
                return;
            stats.Progress(actor, stage, chunkType, inputTokens, outputTokens, progressId, received);
            if (string.Equals(stage, "Queued", StringComparison.OrdinalIgnoreCase))
                _lblAnalysis.Text = Tr(1929);
            else if (outputTokens > 0)
                _lblAnalysis.Text = TrFormat(1879, Number(inputTokens), Number(outputTokens));
            else
                _lblAnalysis.Text = Tr(1878);
        }

        private void ShowAnalysisAnswer(JsonDocument answer, string caption, AIRequestLogStats stats)
        {
            string totals = stats.End() ?? "";
            if (answer == null)
            {
                _lblAnalysis.Text = Tr(1396);
                return;
            }
            JsonElement root = answer.RootElement;
            string error = GetJsonString(root, "errorMessage");
            JsonElement result;
            bool hasResult = root.TryGetProperty("result", out result) && result.ValueKind == JsonValueKind.Object;
            if (error.Length == 0 && hasResult)
                error = GetJsonString(result, "errorMessage");
            if (error.Length > 0)
            {
                _lblAnalysis.Text = Tr(1928);
                // The plan's limit: the cloud's message already says the numbers and the way out
                _markdown.AppendMessage("system", ReportmanAgentClient.IsSchemaTooLargeForTier(answer) ? error : Tr(355) + ": " + error);
                return;
            }
            string explanation = hasResult ? GetJsonString(result, "explanation").Trim() : "";
            if (explanation.Length == 0)
            {
                _lblAnalysis.Text = Tr(1396);
                return;
            }
            _markdown.AppendMessage("assistant", explanation);
            string credits = "";
            if (hasResult && totals.IndexOf("credits", StringComparison.OrdinalIgnoreCase) < 0)
            {
                long consumed;
                JsonElement value;
                if (result.TryGetProperty("creditsConsumed", out value) && value.ValueKind == JsonValueKind.Number &&
                    value.TryGetInt64(out consumed) && consumed > 0)
                    credits = " · " + TrFormat(1930, consumed.ToString("N0", CultureInfo.CurrentCulture));
            }
            _lblAnalysis.Text = caption + ": " + totals + credits;
            _toolTip.SetToolTip(_lblAnalysis, _lblAnalysis.Text);
        }

        private static string GetJsonString(JsonElement element, string name)
        {
            JsonElement value;
            if (element.ValueKind != JsonValueKind.Object || !element.TryGetProperty(name, out value) || value.ValueKind == JsonValueKind.Null)
                return "";
            return value.ValueKind == JsonValueKind.String ? (value.GetString() ?? "") : value.GetRawText();
        }
    }
}
