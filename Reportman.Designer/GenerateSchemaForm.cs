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
using System.Data.Common;
using System.Drawing;
using System.Globalization;
using System.Threading;
using System.Threading.Tasks;
using System.Windows.Forms;

namespace Reportman.Designer
{
    /// <summary>
    /// «Generate with AI» of the local schemas screen (docs/generar-esquema-con-ia-plan.md §2.4): asks the domain («ventas,
    /// compras, ventas+compras... o todo»), an optional name and the AI (the AI of the schemas screen, with its credits
    /// gauge), and runs the generation: the AI reads the tables, their columns, their relations and 10 rows of the ones of
    /// the domain through this connection, and proposes a schema. What it does goes to the log of the dialog; Stop cancels
    /// it. It closes with OK and <see cref="Outcome"/> when there is a schema, which is not saved: the screen imports it as
    /// a new subschema to review and save.
    /// </summary>
    internal sealed class GenerateSchemaForm : Form
    {
        private readonly Func<DbConnection> _createConnection;
        private readonly TextBox _txtDomain;
        private readonly TextBox _txtName;
        private readonly AISelectionControl _aiSelection;
        private readonly TextBox _txtLog;
        private readonly Label _lblStatus;
        private readonly Button _btnGenerate;
        private readonly Button _btnStop;
        private readonly Button _btnCancel;
        private CancellationTokenSource _run;
        private bool _closeWhenStopped;
        private bool _restoring;

        /// <summary>The generation that ended with a schema; null until then.</summary>
        public SchemaGenerationOutcome Outcome { get; private set; }

        /// <summary>The name the user wrote for the subschema; empty for the AI's.</summary>
        public string SubschemaName { get { return _txtName.Text.Trim(); } }

        /// <summary>Initializes the dialog for a connection.</summary>
        /// <param name="createConnection">Creates a connection to the database the AI reads.</param>
        /// <param name="alias">The connection alias, for the caption.</param>
        public GenerateSchemaForm(Func<DbConnection> createConnection, string alias)
        {
            _createConnection = createConnection;
            Text = DesignerText.Tr(2058) + " · " + (alias ?? "");
            StartPosition = FormStartPosition.CenterParent;
            ShowInTaskbar = false;
            MinimizeBox = false;
            MaximizeBox = false;
            Size = new Size(680, 560);
            MinimumSize = new Size(520, 440);
            Padding = new Padding(10);

            var layout = new TableLayoutPanel { Dock = DockStyle.Fill, ColumnCount = 1, RowCount = 9 };
            for (int i = 0; i < 9; i++)
                layout.RowStyles.Add(new RowStyle(i == 7 ? SizeType.Percent : SizeType.AutoSize, 100f));
            var info = new Label { Text = DesignerText.Tr(2059), AutoSize = true, MaximumSize = new Size(640, 0), Margin = new Padding(0, 0, 0, 8) };
            var lblDomain = new Label { Text = DesignerText.Tr(2060), AutoSize = true, Margin = new Padding(0, 4, 0, 2) };
            _txtDomain = new TextBox { Dock = DockStyle.Fill };
            var lblName = new Label { Text = DesignerText.Tr(2061), AutoSize = true, Margin = new Padding(0, 8, 0, 2) };
            _txtName = new TextBox { Dock = DockStyle.Fill };
            // The AI of the schemas screen, kept when it changes ([SchemaAI] of reportman_auth.ini)
            _aiSelection = new AISelectionControl { Dock = DockStyle.Top, AutoSize = true, AutoSizeMode = AutoSizeMode.GrowAndShrink, Margin = new Padding(0, 10, 0, 6) };
            _aiSelection.ProviderChanged += (s, e) => KeepAI();
            _aiSelection.ModeChanged += (s, e) => KeepAI();
            _lblStatus = new Label { AutoSize = true, ForeColor = SystemColors.GrayText, Margin = new Padding(0, 4, 0, 4) };
            _txtLog = new TextBox
            {
                Dock = DockStyle.Fill,
                Multiline = true,
                ReadOnly = true,
                ScrollBars = ScrollBars.Vertical,
                WordWrap = true,
                Font = new Font(FontFamily.GenericMonospace, 8.5f)
            };
            layout.Controls.Add(info, 0, 0);
            layout.Controls.Add(lblDomain, 0, 1);
            layout.Controls.Add(_txtDomain, 0, 2);
            layout.Controls.Add(lblName, 0, 3);
            layout.Controls.Add(_txtName, 0, 4);
            layout.Controls.Add(_aiSelection, 0, 5);
            layout.Controls.Add(_lblStatus, 0, 6);
            layout.Controls.Add(_txtLog, 0, 7);

            var buttons = new FlowLayoutPanel { Dock = DockStyle.Bottom, FlowDirection = FlowDirection.RightToLeft, AutoSize = true, Padding = new Padding(0, 8, 0, 0) };
            _btnCancel = new Button { Text = DesignerText.Tr(94), AutoSize = true };
            _btnCancel.Click += (s, e) => Close();
            _btnStop = new Button { Text = DesignerText.Tr(1522), AutoSize = true, Visible = false };
            _btnStop.Click += (s, e) => Stop();
            _btnGenerate = new Button { Text = DesignerText.Tr(2062), AutoSize = true };
            _btnGenerate.Click += (s, e) => Generate();
            buttons.Controls.Add(_btnCancel);
            buttons.Controls.Add(_btnStop);
            buttons.Controls.Add(_btnGenerate);

            Controls.Add(layout);
            Controls.Add(buttons);
            AcceptButton = _btnGenerate;
            CancelButton = _btnCancel;

            RestoreAI();
            Shown += async (s, e) =>
            {
                _txtDomain.Focus();
                _aiSelection.RefreshState();
                _restoring = true;
                try
                {
                    RpAuthManager auth = RpAuthManager.Instance;
                    await _aiSelection.LoadUserAgentsAsync(auth.SchemaAITier, auth.SchemaAgentAiId);
                }
                catch (Exception)
                {
                    // Without the user's Agents the cloud tiers stay
                }
                finally
                {
                    _restoring = false;
                }
            };
            FormClosing += (s, e) =>
            {
                // Closed while it runs: it stops first, and closes when it has stopped
                if (_run != null)
                {
                    e.Cancel = true;
                    _closeWhenStopped = true;
                    Stop();
                }
            };
        }

        private void RestoreAI()
        {
            _restoring = true;
            try
            {
                RpAuthManager auth = RpAuthManager.Instance;
                _aiSelection.RestoreProviderSelection(auth.SchemaAITier, auth.SchemaAgentAiId);
                _aiSelection.SelectedMode = auth.SchemaAIMode;
            }
            finally
            {
                _restoring = false;
            }
        }

        private void KeepAI()
        {
            if (!_restoring)
                RpAuthManager.Instance.SaveSchemaAI(_aiSelection.SelectedTier, _aiSelection.SelectedMode, _aiSelection.AgentAiId);
        }

        private void UpdateState()
        {
            bool running = _run != null;
            _txtDomain.ReadOnly = running;
            _txtName.ReadOnly = running;
            _aiSelection.Enabled = !running;
            _btnGenerate.Enabled = !running;
            _btnStop.Visible = running;
        }

        private void Stop()
        {
            try { _run?.Cancel(); } catch (ObjectDisposedException) { }
        }

        private void AppendLog(string line)
        {
            if (IsDisposed)
                return;
            _txtLog.AppendText((_txtLog.TextLength > 0 ? Environment.NewLine : "") + line);
        }

        private void PostToUi(Action action)
        {
            if (IsDisposed || !IsHandleCreated)
                return;
            try { BeginInvoke(action); } catch (InvalidOperationException) { }
        }

        private async void Generate()
        {
            if (_run != null)
                return;
            string domain = _txtDomain.Text.Trim();
            if (domain.Length == 0)
            {
                MessageBox.Show(this, DesignerText.Tr(2063), Text, MessageBoxButtons.OK, MessageBoxIcon.Information);
                _txtDomain.Focus();
                return;
            }
            KeepAI();
            var cts = new CancellationTokenSource();
            _run = cts;
            UpdateState();
            _txtLog.Clear();
            _lblStatus.Text = DesignerText.Tr(2064);
            string tier = _aiSelection.SelectedTier;
            bool localAgent = string.Equals(tier, "LocalAgent", StringComparison.OrdinalIgnoreCase);
            RpAuthManager auth = RpAuthManager.Instance;
            var client = new ReportmanAgentClient
            {
                Token = auth.Token,
                InstallId = auth.InstallId,
                AcceptLanguage = auth.AILanguageCode,
                AITier = tier,
                ApiKey = "",
                HubDatabaseId = 0,
                HubSchemaId = 0
            };
            if (localAgent)
            {
                client.AgentSecret = _aiSelection.AgentSecret;
                client.AgentAiId = _aiSelection.AgentAiId;
            }
            client.LogMessage += message => auth.Log(message);
            string mode = _aiSelection.SelectedMode;
            string name = _txtName.Text.Trim();
            string language = auth.AILanguageCode;
            SchemaGenerationOutcome outcome = null;
            try
            {
                // Every read of the database and every call, off the UI thread
                outcome = await Task.Run(async () =>
                {
                    using (DbConnection connection = _createConnection())
                    {
                        await connection.OpenAsync(cts.Token).ConfigureAwait(false);
                        var loop = new SchemaGenerationLoop(client) { Connection = connection };
                        loop.StatusChanged += line => PostToUi(() => AppendLog(line));
                        return await loop.RunAsync(domain, name, mode, language, DatabaseCatalogReader.DialectOf(connection), this,
                            (sender, actor, stage, chunkType, chunk, input, output, id, prefill) =>
                                PostToUi(() => ShowProgress(stage, input, output)),
                            cts.Token).ConfigureAwait(false);
                    }
                }, cts.Token);
                if (IsDisposed)
                    return;
                if (outcome.Completed)
                {
                    Outcome = outcome;
                    _run = null;
                    DialogResult = DialogResult.OK;
                    Close();
                    return;
                }
                string error = outcome.ErrorMessage.Length > 0 ? outcome.ErrorMessage : DesignerText.Tr(1396);
                AppendLog(DesignerText.Format(2066, error));
                if (!auth.IsLoggedIn && !localAgent)
                    AppendLog(DesignerText.Tr(2070));
                _lblStatus.Text = DesignerText.Format(2066, error);
            }
            catch (OperationCanceledException)
            {
                if (!IsDisposed)
                {
                    AppendLog(DesignerText.Tr(1536));
                    _lblStatus.Text = DesignerText.Tr(1536);
                }
            }
            catch (Exception ex)
            {
                if (!IsDisposed)
                {
                    AppendLog(DesignerText.Format(2066, ex.Message));
                    _lblStatus.Text = DesignerText.Format(2066, ex.Message);
                }
            }
            finally
            {
                if (_run == cts)
                    _run = null;
                cts.Dispose();
                // The credits spent: the gauges of the AI panels follow (AuthChanged)
                if (!localAgent && auth.IsLoggedIn)
                    auth.RefreshStatusInBackground();
                if (!IsDisposed)
                {
                    UpdateState();
                    if (outcome != null && outcome.Credits > 0)
                        _lblStatus.Text += " · " + DesignerText.Format(2068, outcome.Credits.ToString("N0", CultureInfo.CurrentCulture),
                            outcome.Turns.ToString(CultureInfo.CurrentCulture));
                    if (_closeWhenStopped)
                        Close();
                }
            }
        }

        private void ShowProgress(string stage, int input, int output)
        {
            if (IsDisposed || _run == null)
                return;
            if (string.Equals(stage, "Queued", StringComparison.OrdinalIgnoreCase))
                _lblStatus.Text = DesignerText.Tr(1929);
            else if (input > 0 || output > 0)
                _lblStatus.Text = DesignerText.Tr(2064) + " " + input.ToString("N0", CultureInfo.CurrentCulture) + " / " +
                    output.ToString("N0", CultureInfo.CurrentCulture) + " tokens";
        }
    }
}
