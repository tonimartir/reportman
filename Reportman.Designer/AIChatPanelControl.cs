using System;
using System.ComponentModel;
using System.Drawing;
using System.Text.Json;
using System.Windows.Forms;
using Reportman.Reporting;

namespace Reportman.Designer
{
    /// <summary>
    /// Replicates Delphi's TFRpChatFrame layout:
    /// PRoot → PTop(alTop) + PControl(alClient) + PBottom(alBottom)
    /// PBottom is OUTSIDE the TabControl so it's always visible.
    /// </summary>
    public class AIChatPanelControl : UserControl
    {
        // Top controls
        private AILoginFrameControl _aiLoginControl;
        private AISelectionControl _aiSelectionControl;
        private AISchemaSelectorControl _aiSchemaSelectorControl;

        // Tab control with 3 tabs
        private TabControl _tabControl;
        private TabPage _tabChat;
        private TabPage _tabLog;
        private TabPage _tabNetLog;

        // Chat tab content
        private WebMarkdownControl _markdownControl;

        // AI Log tab content
        private Panel _logToolbar;
        private Button _btnClearLog;
        private Button _btnReportAI;
        private WebMarkdownControl _logView;

        // Net Log tab content
        private Panel _netLogToolbar;
        private Button _btnClearNetLog;
        private WebMarkdownControl _netLogView;

        // Bottom panel (always visible, outside tabs)
        private Panel _panelBottom;
        private TextBox _txtPrompt;
        private Panel _panelButtons;
        private Button _btnSend;
        private Button _btnApply;
        private Button _btnClear;

        // State
        private bool _isBusy;
        private string _suggestedExpression = "";
        private string _existingContextJson = "";
        private System.Threading.CancellationTokenSource _cts;
        private Action<string> _authLogHandler;
        // Tokens and times of the running request for the AI log
        private readonly AIRequestLogStats _logStats = new AIRequestLogStats();

        // Agent client
        private ReportmanAgentClient _agentClient;

        /// <summary>
        /// Occurs when an expression suggestion is accepted and applied.
        /// </summary>
        public event EventHandler<string> ApplySuggestion;

        /// <summary>
        /// Gets or sets the provider callback function that returns the current report document XML representation.
        /// </summary>
        [Browsable(false)]
        [DesignerSerializationVisibility(DesignerSerializationVisibility.Hidden)]
        public Func<string> ReportDocumentProvider { get; set; }

        /// <summary>
        /// Gets or sets the action callback invoked to apply a modified report document XML representation to the designer.
        /// </summary>
        [Browsable(false)]
        [DesignerSerializationVisibility(DesignerSerializationVisibility.Hidden)]
        public Action<string> ApplyModifiedReportDocument { get; set; }

        /// <summary>
        /// Gets or sets an optional hook that binds the connections of a report loaded from the document
        /// before the copilot runs a SQL on it (a host that supplies its own connections). By default the
        /// connections of the document are used as they are.
        /// </summary>
        [Browsable(false)]
        [DesignerSerializationVisibility(DesignerSerializationVisibility.Hidden)]
        public Action<Report> PrepareReportConnections { get; set; }

        private string _localSchemaFolder;

        /// <summary>
        /// Gets or sets the folder of the local schema files of direct connections. By default the
        /// dbxschemas folder next to the dbxconnections.ini the designer uses.
        /// </summary>
        [Browsable(false)]
        [DesignerSerializationVisibility(DesignerSerializationVisibility.Hidden)]
        public string LocalSchemaFolder
        {
            get
            {
                if (string.IsNullOrEmpty(_localSchemaFolder))
                {
                    string ini = DbxConnections.ResolveWritePath();
                    if (string.IsNullOrEmpty(ini))
                        ini = System.IO.Path.Combine(AppDomain.CurrentDomain.BaseDirectory, "dbxconnections.ini");
                    return LocalSchemaStore.FolderFor(ini);
                }
                return _localSchemaFolder;
            }
            set
            {
                _localSchemaFolder = value;
                if (_aiSchemaSelectorControl != null)
                    _aiSchemaSelectorControl.LocalSchemaFolder = LocalSchemaFolder;
            }
        }

        /// <summary>
        /// Initializes a new instance of the AIChatPanelControl control.
        /// </summary>
        public AIChatPanelControl()
        {
            InitializeComponent();
            _agentClient = new ReportmanAgentClient();
            _agentClient.LogMessage += AppendNetLog;

            // Register auth listener like Delphi's TFRpChatFrame
            RpAuthManager.Instance.AuthChanged += OnAuthChanged;
            _authLogHandler = AppendNetLog;
            RpAuthManager.Instance.LogMessage += _authLogHandler;

            // Deferred startup: load schemas/agents and refresh status
            this.HandleCreated += (s, e) =>
            {
                EnsureWebMarkdownViewsInitialized();
                StartOnlineInitialization();
            };
        }

        /// <summary>
        /// Cleans up any resources being used.
        /// </summary>
        /// <param name="disposing">True if managed resources should be disposed; otherwise, false.</param>
        protected override void Dispose(bool disposing)
        {
            if (disposing)
            {
                RpAuthManager.Instance.AuthChanged -= OnAuthChanged;
                if (_authLogHandler != null)
                    RpAuthManager.Instance.LogMessage -= _authLogHandler;
                if (_agentClient != null)
                    _agentClient.LogMessage -= AppendNetLog;
            }
            base.Dispose(disposing);
        }

        /// <summary>
        /// Called when auth state changes (login, logout, status refresh).
        /// Matches Delphi's TFRpChatFrame.AuthChanged.
        /// </summary>
        private void OnAuthChanged(bool success)
        {
            if (InvokeRequired)
            {
                try { Invoke(new Action(() => OnAuthChanged(success))); } catch { }
                return;
            }

            // Refresh credits gauge
            _aiSelectionControl.RefreshState();
            // The plan may have changed: the schemas that do not fit it
            _aiSchemaSelectorControl.RefreshPlanWarnings();

            // Reload agents and schemas (like Delphi)
            LoadUserAgentsAsync();
            LoadSchemasAsync();
        }

        /// <summary>
        /// Startup initialization: validate token + load schemas/agents.
        /// Matches Delphi's TFRpChatFrame.StartOnlineInitialization.
        /// </summary>
        private void StartOnlineInitialization()
        {
            // Always load schemas (even for guests)
            LoadSchemasAsync();

            // If logged in, validate token and load agents
            if (RpAuthManager.Instance.IsLoggedIn)
            {
                RpAuthManager.Instance.RefreshStatusInBackground();
                LoadUserAgentsAsync();
            }
        }

        /// <summary>
        /// Sets the database hub and agent credentials context.
        /// </summary>
        /// <param name="hubDatabaseId">The hub database identifier.</param>
        /// <param name="hubSchemaId">The hub database schema identifier.</param>
        /// <param name="apiKey">The HTTP Agent authentication API key.</param>
        public void SetHubContext(long hubDatabaseId, long hubSchemaId, string apiKey)
        {
            string schemaApiKey = (apiKey ?? "").Trim();

            if (InvokeRequired)
            {
                try { Invoke(new Action(() => SetHubContext(hubDatabaseId, hubSchemaId, schemaApiKey))); } catch { }
                return;
            }

            _aiSchemaSelectorControl.SetPreferredConnection(hubDatabaseId, schemaApiKey);
            _aiSchemaSelectorControl.SetHubContext(hubDatabaseId, hubSchemaId, schemaApiKey);
            LoadSchemasAsync();
        }

        /// <summary>
        /// Sets the direct (not Agent) connections of the report: the schema selector offers the local
        /// schema of each one (all its tables and its subschemas), and with one selected the copilot
        /// sends that schema inline and runs the SQL it writes with the report's connection. Call it
        /// before <see cref="SetHubContext"/>.
        /// </summary>
        /// <param name="aliases">Aliases of the report's direct connections.</param>
        /// <param name="preferredAlias">The connection to select by default.</param>
        /// <param name="preferLocal">True when the report has no Hub schema: the local schema is selected by default.</param>
        public void SetDirectConnections(System.Collections.Generic.IList<string> aliases, string preferredAlias, bool preferLocal)
        {
            SetDirectConnections(aliases, preferredAlias, preferLocal, null);
        }

        /// <summary>
        /// Sets the direct connections of the report, as <see cref="SetDirectConnections(System.Collections.Generic.IList{string}, string, bool)"/>;
        /// for a report just opened, <paramref name="reportSubschema"/> is the subschema its datasets of
        /// <paramref name="preferredAlias"/> were made with (<see cref="DataInfo.SchemaName"/>, "" when
        /// they say none): it is selected while it is still in the local schema file, else all the tables.
        /// </summary>
        /// <param name="aliases">Aliases of the report's direct connections.</param>
        /// <param name="preferredAlias">The connection to select by default.</param>
        /// <param name="preferLocal">True when the local schema is selected by default.</param>
        /// <param name="reportSubschema">Null to keep the current choice (the same report again).</param>
        public void SetDirectConnections(System.Collections.Generic.IList<string> aliases, string preferredAlias, bool preferLocal,
            string reportSubschema)
        {
            if (InvokeRequired)
            {
                try { Invoke(new Action(() => SetDirectConnections(aliases, preferredAlias, preferLocal, reportSubschema))); } catch { }
                return;
            }
            _aiSchemaSelectorControl.LocalSchemaFolder = LocalSchemaFolder;
            _aiSchemaSelectorControl.SetDirectConnections(aliases, preferredAlias, preferLocal, reportSubschema);
        }

        /// <summary>A connection to the database of <paramref name="alias"/> as the report document defines it.</summary>
        private static Func<System.Data.Common.DbConnection> ConnectionFactory(string reportDocument, string alias, Action<Report> prepare)
        {
            return () =>
            {
                Report report = CopilotSqlProbe.LoadReport(reportDocument);
                if (prepare != null)
                    prepare(report);
                DatabaseInfo db = CopilotSqlProbe.FindDatabase(report, alias);
                if (db == null)
                    throw new InvalidOperationException("The report has no connection " + alias);
                return db.CreateDbConnection();
            };
        }

        /// <summary>
        /// "Local schemas..." and "New local schema..." of the selector: the utility of the connection's
        /// local schema file, adding a subschema in the second case (the selector selects it after).
        /// </summary>
        private void OnLocalSchemaEditRequested(object sender, LocalSchemaEditEventArgs e)
        {
            string alias = e.Alias;
            if (alias.Length == 0)
                return;
            try
            {
                string reportDocument = ReportDocumentProvider != null ? ReportDocumentProvider() : "";
                if (string.IsNullOrWhiteSpace(reportDocument))
                    throw new InvalidOperationException("Unable to serialize the current report to XML.");
                // «Analyze with AI» uses the provider and mode selected here
                string tier = _aiSelectionControl.SelectedTier;
                var analysis = new LocalSchemaAnalysisSettings
                {
                    Tier = tier,
                    Mode = _aiSelectionControl.SelectedMode,
                    AgentSecret = string.Equals(tier, "LocalAgent", StringComparison.OrdinalIgnoreCase) ? _aiSelectionControl.AgentSecret : "",
                    AgentAiId = string.Equals(tier, "LocalAgent", StringComparison.OrdinalIgnoreCase) ? _aiSelectionControl.AgentAiId : 0
                };
                string added;
                if (LocalSchemaEditorForm.Edit(FindForm(), LocalSchemaFolder, alias,
                    ConnectionFactory(reportDocument, alias, PrepareReportConnections), e.AddSubschema, analysis, out added))
                    e.AddedSubschema = e.AddSubschema ? added : "";
            }
            catch (Exception ex)
            {
                MessageBox.Show(FindForm(), ex.Message, DesignerText.Format(1845, alias), MessageBoxButtons.OK, MessageBoxIcon.Error);
            }
        }

        /// <summary>With the AI on the user's Agent the plan limits do not apply: no schema is marked.</summary>
        private void UpdateSchemaPlanLimits()
        {
            _aiSchemaSelectorControl.IgnorePlanLimits =
                string.Equals(_aiSelectionControl.SelectedTier, "LocalAgent", StringComparison.OrdinalIgnoreCase);
        }

        private void LoadSchemasAsync()
        {
            if (IsDisposed)
                return;

            _aiSchemaSelectorControl.RefreshSchemas();
        }

        private async void LoadUserAgentsAsync()
        {
            try
            {
                string selectedTier = _aiSelectionControl.SelectedTier;
                long selectedAgentAiId = _aiSelectionControl.AgentAiId;
                _aiSelectionControl.ClearAgentEndpoints();

                if (string.IsNullOrEmpty(RpAuthManager.Instance.Token))
                {
                    _aiSelectionControl.RestoreProviderSelection(selectedTier, selectedAgentAiId);
                    return;
                }

                var agents = await RpAuthManager.Instance.GetUserAgentsAsync();
                if (InvokeRequired)
                    Invoke(new Action(() => ApplyLoadedAgents(agents, selectedTier, selectedAgentAiId)));
                else
                    ApplyLoadedAgents(agents, selectedTier, selectedAgentAiId);
            }
            catch (Exception ex)
            {
                AppendLog("LoadUserAgents Error: " + ex.Message);
            }
        }

        private void ApplyLoadedAgents(System.Collections.Generic.List<string> agents, string selectedTier, long selectedAgentAiId)
        {
            _aiSelectionControl.ClearAgentEndpoints();
            foreach (var entry in agents)
            {
                int eq = entry.IndexOf('=');
                if (eq <= 0) continue;
                string displayName = entry.Substring(0, eq);
                string value = entry.Substring(eq + 1);
                string[] parts = value.Split('|');
                if (parts.Length >= 2)
                {
                    long agentAiId = long.TryParse(parts[0], out var aid) ? aid : 0;
                    string secret = parts[1];
                    bool isOnline = parts.Length >= 3 && parts[2] == "1";
                    if (isOnline)
                        _aiSelectionControl.AddAgentEndpoint(agentAiId, secret, displayName, true);
                }
            }
            _aiSelectionControl.RestoreProviderSelection(selectedTier, selectedAgentAiId);
        }

        private void InitializeComponent()
        {
            this.Size = new Size(400, 600);

            // ===== TOP SECTION: Login + AI Selection + Schema =====
            _aiLoginControl = new AILoginFrameControl
            {
                Dock = DockStyle.Fill,
                AutoSize = true,
                AutoSizeMode = AutoSizeMode.GrowAndShrink
            };

            _aiSelectionControl = new AISelectionControl
            {
                Dock = DockStyle.Fill,
                AutoSize = true,
                AutoSizeMode = AutoSizeMode.GrowAndShrink
            };
            _aiSelectionControl.StopRequested += (s, e) => StopInference();

            _aiSchemaSelectorControl = new AISchemaSelectorControl
            {
                Dock = DockStyle.Fill,
                AutoSize = true,
                AutoSizeMode = AutoSizeMode.GrowAndShrink
            };
            _aiSchemaSelectorControl.LocalSchemaEditRequested += OnLocalSchemaEditRequested;
            _aiSelectionControl.ProviderChanged += (s, e) => UpdateSchemaPlanLimits();
            UpdateSchemaPlanLimits();

            // Top panel with GridPanel stacking (like Delphi's GridTop)
            TableLayoutPanel topGrid = new TableLayoutPanel
            {
                Dock = DockStyle.Top,
                ColumnCount = 1,
                RowCount = 3,
                AutoSize = true,
                AutoSizeMode = AutoSizeMode.GrowAndShrink
            };
            topGrid.ColumnStyles.Add(new ColumnStyle(SizeType.Percent, 100f));
            topGrid.RowStyles.Add(new RowStyle(SizeType.AutoSize));
            topGrid.RowStyles.Add(new RowStyle(SizeType.AutoSize));
            topGrid.RowStyles.Add(new RowStyle(SizeType.AutoSize));

            topGrid.Controls.Add(_aiLoginControl, 0, 0);
            topGrid.Controls.Add(_aiSelectionControl, 0, 1);
            topGrid.Controls.Add(_aiSchemaSelectorControl, 0, 2);

            // ===== BOTTOM SECTION: MemoPrompt + Buttons (always visible, outside tabs) =====
            // Matches Delphi's PBottom: alBottom, h=110, padding=8
            _panelBottom = new Panel
            {
                Dock = DockStyle.Bottom,
                Height = 110,
                Padding = new Padding(8)
            };

            // PButtons: alRight, w=103
            _panelButtons = new Panel
            {
                Dock = DockStyle.Right,
                Width = 103
            };

            _btnSend = new Button
            {
                Text = DesignerText.Tr(1534),
                Dock = DockStyle.Top,
                Height = 30
            };
            _btnSend.Click += BtnSend_Click;

            _btnApply = new Button
            {
                Text = DesignerText.Tr(1535),
                Dock = DockStyle.Top,
                Height = 30,
                Enabled = false
            };
            _btnApply.Click += BtnApply_Click;

            _btnClear = new Button
            {
                Text = DesignerText.Tr(1532),
                Dock = DockStyle.Top,
                Height = 30
            };
            _btnClear.Click += BtnClear_Click;

            _panelButtons.Controls.Add(_btnClear);
            _panelButtons.Controls.Add(_btnApply);
            _panelButtons.Controls.Add(_btnSend);

            // MemoPrompt: alClient, vertical scrollbar
            _txtPrompt = new TextBox
            {
                Multiline = true,
                ScrollBars = ScrollBars.Vertical,
                Dock = DockStyle.Fill,
                WordWrap = true
            };
            _txtPrompt.KeyDown += TxtPrompt_KeyDown;
            _txtPrompt.TextChanged += (s, e) => UpdateButtons();

            _panelBottom.Controls.Add(_txtPrompt);
            _panelBottom.Controls.Add(_panelButtons);

            // ===== TAB CONTROL: Chat + AI Log + Net Log =====
            _tabControl = new TabControl { Dock = DockStyle.Fill };

            // --- Tab: Chat ---
            _tabChat = new TabPage { Text = DesignerText.Tr(1529) };
            _markdownControl = new WebMarkdownControl { Dock = DockStyle.Fill };
            _tabChat.Controls.Add(_markdownControl);

            // --- Tab: AI Log ---
            _tabLog = new TabPage { Text = DesignerText.Tr(1530) };

            _logToolbar = new Panel
            {
                Dock = DockStyle.Top,
                Height = 41,
                Padding = new Padding(8, 5, 8, 5)
            };
            _btnClearLog = new Button
            {
                Text = DesignerText.Tr(1532),
                Dock = DockStyle.Left,
                Width = 93
            };
            _btnClearLog.Click += (s, e) => _logView.ClearAll();
            _btnReportAI = new Button
            {
                Text = DesignerText.Tr(1533),
                Dock = DockStyle.Left,
                Width = 138
            };
            // Spacer between buttons
            Panel logSpacer = new Panel { Dock = DockStyle.Left, Width = 10 };
            _logToolbar.Controls.Add(_btnReportAI);
            _logToolbar.Controls.Add(logSpacer);
            _logToolbar.Controls.Add(_btnClearLog);

            _logView = new WebMarkdownControl
            {
                Dock = DockStyle.Fill
            };
            _tabLog.Controls.Add(_logView);
            _tabLog.Controls.Add(_logToolbar);

            // --- Tab: Net Log ---
            _tabNetLog = new TabPage { Text = DesignerText.Tr(1531) };

            _netLogToolbar = new Panel
            {
                Dock = DockStyle.Top,
                Height = 41,
                Padding = new Padding(8, 5, 8, 5)
            };
            _btnClearNetLog = new Button
            {
                Text = DesignerText.Tr(1532),
                Dock = DockStyle.Left,
                Width = 93
            };
            _btnClearNetLog.Click += (s, e) => _netLogView.ClearAll();
            _netLogToolbar.Controls.Add(_btnClearNetLog);

            _netLogView = new WebMarkdownControl
            {
                Dock = DockStyle.Fill
            };
            _tabNetLog.Controls.Add(_netLogView);
            _tabNetLog.Controls.Add(_netLogToolbar);

            _tabControl.TabPages.Add(_tabChat);
            _tabControl.TabPages.Add(_tabLog);
            _tabControl.TabPages.Add(_tabNetLog);

            // ===== ASSEMBLY: PRoot with PTop(alTop) + PBottom(alBottom) + PControl(alClient) =====
            // Order matters for Dock: Bottom first, then Top, then Fill
            this.Controls.Add(_tabControl);    // alClient (Fill) - added first
            this.Controls.Add(_panelBottom);   // alBottom
            this.Controls.Add(topGrid);        // alTop
        }

        private void EnsureWebMarkdownViewsInitialized()
        {
            _markdownControl?.EnsureInitialized();
            _logView?.EnsureInitialized();
            _netLogView?.EnsureInitialized();
        }

        // ===== Keyboard handling =====

        private void TxtPrompt_KeyDown(object sender, KeyEventArgs e)
        {
            // Enter sends, Shift+Enter = newline (like Delphi)
            if (e.KeyCode == Keys.Enter && !e.Shift)
            {
                e.SuppressKeyPress = true;
                if (!_isBusy && !string.IsNullOrWhiteSpace(_txtPrompt.Text))
                {
                    BtnSend_Click(sender, e);
                }
            }
        }

        // ===== Button state management =====

        private void UpdateButtons()
        {
            _btnSend.Enabled = !_isBusy && !string.IsNullOrWhiteSpace(_txtPrompt.Text);
            _btnApply.Enabled = !_isBusy && !string.IsNullOrEmpty(_suggestedExpression);

            if (_isBusy)
            {
                _btnClear.Text = DesignerText.Tr(1522);
            }
            else
            {
                _btnClear.Text = DesignerText.Tr(1532);
            }
        }

        private void SetBusy(bool busy)
        {
            _isBusy = busy;
            _txtPrompt.Enabled = !busy;
            _aiSelectionControl.SetInferenceProgress(busy);
            UpdateButtons();

            if (busy)
            {
                _tabControl.SelectedTab = _tabLog; // Switch to AI Log during inference
            }
            else
            {
                _tabControl.SelectedTab = _tabChat; // Switch back to Chat when done
            }
        }

        // ===== Button click handlers =====

        private void BtnApply_Click(object sender, EventArgs e)
        {
            if (!string.IsNullOrEmpty(_suggestedExpression))
            {
                ApplySuggestion?.Invoke(this, _suggestedExpression);
            }
        }

        private void BtnClear_Click(object sender, EventArgs e)
        {
            if (_isBusy)
            {
                // Stop mode
                StopInference();
            }
            else
            {
                // Clear mode
                _markdownControl.ClearAll();
                _logView.ClearAll();
                _netLogView.ClearAll();
                _txtPrompt.Clear();
                _suggestedExpression = "";
                UpdateButtons();
            }
        }

        private void StopInference()
        {
            _cts?.Cancel();
            AppendLog("Inference cancelled by user.");
        }

        // ===== Logging =====

        /// <summary>
        /// Appends a message to the AI execution logs window view.
        /// </summary>
        /// <param name="message">The message to log.</param>
        public void AppendLog(string message)
        {
            PostToUi(() => _logView.AppendLogLine($"[{DateTime.Now:HH:mm:ss}] {message}"));
        }

        /// <summary>
        /// Appends a message to the raw network/transport logs window view.
        /// </summary>
        /// <param name="message">The network message to log.</param>
        public void AppendNetLog(string message)
        {
            PostToUi(() => _netLogView.AppendLogLine($"[{DateTime.Now:HH:mm:ss}] {message}"));
        }

        private void PostToUi(Action action)
        {
            if (action == null || IsDisposed)
                return;

            if (InvokeRequired)
            {
                if (!IsHandleCreated)
                    return;

                try
                {
                    BeginInvoke(action);
                }
                catch (InvalidOperationException)
                {
                }
                return;
            }

            action();
        }

        // ===== Send logic =====

        private async void BtnSend_Click(object sender, EventArgs e)
        {
            string prompt = _txtPrompt.Text.Trim();
            if (string.IsNullOrEmpty(prompt)) return;

            _txtPrompt.Clear();
            SetBusy(true);
            _cts = new System.Threading.CancellationTokenSource();
            _logStats.Begin();

            try
            {
                _markdownControl.AppendMessage("user", prompt);
                _markdownControl.BeginStreaming("agent");

                string tier = _aiSelectionControl.SelectedTier;
                string mode = _aiSelectionControl.SelectedMode;
                string reportDocument = ReportDocumentProvider != null ? ReportDocumentProvider() : "";
                if (string.IsNullOrWhiteSpace(reportDocument))
                    throw new InvalidOperationException("Unable to serialize the current report to XML.");

                // Configure client
                _agentClient.Token = RpAuthManager.Instance.Token;
                _agentClient.InstallId = RpAuthManager.Instance.InstallId;
                _agentClient.AcceptLanguage = RpAuthManager.Instance.AILanguageCode;
                _agentClient.AITier = tier;
                _agentClient.ApiKey = _aiSchemaSelectorControl.SchemaApiKey;
                if (string.Equals(tier, "LocalAgent", StringComparison.OrdinalIgnoreCase))
                {
                    _agentClient.AgentSecret = _aiSelectionControl.AgentSecret;
                    _agentClient.AgentAiId = _aiSelectionControl.AgentAiId;
                }
                else
                {
                    _agentClient.AgentSecret = "";
                    _agentClient.AgentAiId = 0;
                }
                _agentClient.HubDatabaseId = _aiSchemaSelectorControl.HubDatabaseId;
                _agentClient.HubSchemaId = _aiSchemaSelectorControl.HubSchemaId;
                _agentClient.InlineConfig = null;

                // A direct connection's local schema: its file (generated from the catalog the first
                // time) travels inline, and the SQL the copilot writes is run here with that connection.
                string localAlias = _aiSchemaSelectorControl.LocalAlias;
                string localSubschema = _aiSchemaSelectorControl.LocalSubschema;
                string schemaFolder = LocalSchemaFolder;
                Action<Report> prepare = PrepareReportConnections;
                var connectionFactory = localAlias.Length > 0 ? ConnectionFactory(reportDocument, localAlias, prepare) : null;

                AICopilotManager.Instance.OnCancelRequested = () =>
                {
                    _cts.Cancel();
                    AppendLog("Inference cancelled by user.");
                };
                AICopilotManager.Instance.BeginInference();

                var loop = new CopilotModifyReportLoop(_agentClient) { PrepareReport = prepare };
                loop.StatusChanged += AppendLog;
                loop.AnswerReceived += _logStats.AddAnswer;
                var outcome = await System.Threading.Tasks.Task.Run(async () =>
                {
                    if (localAlias.Length > 0)
                    {
                        string path = LocalSchemaStore.PathFor(schemaFolder, localAlias);
                        if (!System.IO.File.Exists(path))
                            AppendLog("Reading the tables of " + localAlias + " into " + path + "...");
                        LocalSchemaFile schema = LocalSchemaStore.LoadOrGenerate(schemaFolder, localAlias, connectionFactory, false);
                        if (LocalSchemaStore.FindSubschema(schema, localSubschema) == null && localSubschema.Length > 0)
                            AppendLog("The subschema " + localSubschema + " is not in the file: all the tables are sent.");
                        _agentClient.InlineConfig = LocalSchemaStore.BuildInlineConfig(schema, localSubschema);
                        AppendLog("Schema " + localAlias + (localSubschema.Length > 0 ? " / " + localSubschema : "") + ": " +
                            LocalSchemaStore.TablesOf(schema, localSubschema).Count + " tables sent inline.");
                    }
                    return await loop.RunAsync(
                        prompt,
                        reportDocument,
                        mode,
                        RpAuthManager.Instance.AILanguage,
                        _existingContextJson,
                        this,
                        (senderObj, actor, stage, chunkType, chunk, inTokens, outTokens, progId, prefill) =>
                        {
                            long received = System.Diagnostics.Stopwatch.GetTimestamp();
                            PostToUi(() => UpdateStreamingProgress(actor, stage, chunkType, chunk,
                                inTokens, outTokens, progId, prefill, received));
                        },
                        _cts.Token).ConfigureAwait(false);
                }, _cts.Token);

                _markdownControl.FinishStreaming();
                HandleModifyReportResult(outcome);
            }
            catch (OperationCanceledException)
            {
                _markdownControl.FinishStreaming();
                SafeAppendMessage("system", DesignerText.Tr(1536));
            }
            catch (Exception ex)
            {
                _markdownControl.FinishStreaming();
                SafeAppendMessage("system", DesignerText.Tr(355) + ": " + ex.Message);
            }
            finally
            {
                string totals = _logStats.End();
                if (totals != null)
                    AppendLog(totals);
                AICopilotManager.Instance.EndInference();
                SetBusy(false);
                _txtPrompt.Focus();
                _markdownControl.ScrollToEnd();
            }
        }

        private void SafeAppendMessage(string role, string text)
        {
            PostToUi(() => _markdownControl.AppendMessage(role, text));
        }

        private void ProcessChunk(string chunk)
        {
            _markdownControl.AppendStreamingChunk("assistant", chunk, 0);
        }

        private void UpdateStreamingProgress(string actor, string stage, string chunkType, string chunk,
            int inputTokens, int outputTokens, string progressId, int prefillPercent, long received)
        {
            if (string.Equals(stage, "ReceivingResponse", StringComparison.OrdinalIgnoreCase) &&
                string.Equals(chunkType, "Partial", StringComparison.OrdinalIgnoreCase))
            {
                ProcessChunk(chunk);
            }

            AppendAILogProgress(chunkType, chunk, progressId);
            // A model call that ends: its tokens, time and speed
            string callStats = _logStats.Progress(actor, stage, chunkType, inputTokens, outputTokens, progressId, received);
            if (callStats != null)
                AppendLog(callStats);

            if (string.Equals(actor, "AI", StringComparison.OrdinalIgnoreCase))
            {
                if (!string.IsNullOrWhiteSpace(progressId))
                    _aiSelectionControl.TouchProgressToken(progressId);

                _aiSelectionControl.UpdateTokens(inputTokens, outputTokens, progressId, prefillPercent);

                if (IsFinalChunk(chunkType))
                    _aiSelectionControl.FinishProgressToken(progressId);
            }
        }

        private void AppendAILogProgress(string chunkType, string chunk, string progressId)
        {
            if (_logView == null)
                return;

            string key = (progressId ?? "").Trim();
            string logChunk = chunk ?? "";
            if (IsFinalChunk(chunkType))
            {
                if (logChunk.Length > 0)
                    _logView.AppendLogChunkForKey(key, logChunk);
                _logView.EndLogChunkForKey(key);
            }
            else if (logChunk.Length > 0)
            {
                _logView.AppendLogChunkForKey(key, logChunk);
            }
        }

        private static bool IsFinalChunk(string chunkType)
        {
            return string.Equals(chunkType, "End", StringComparison.OrdinalIgnoreCase) ||
                string.Equals(chunkType, "Full", StringComparison.OrdinalIgnoreCase);
        }

        private void HandleModifyReportResult(CopilotModifyReportOutcome outcome)
        {
            using (JsonDocument resultDoc = outcome.Result)
            {
                if (outcome.TooManyTurns)
                {
                    SafeAppendMessage("system", DesignerText.Tr(355) + ": " + DesignerText.Tr(1945));
                    return;
                }
                HandleModifyReportResult(resultDoc, outcome.DocumentToApply);
            }
        }

        private void HandleModifyReportResult(JsonDocument resultDoc, string documentToApply)
        {
            if (resultDoc == null)
            {
                SafeAppendMessage("assistant", DesignerText.Tr(1540));
                return;
            }

            var root = resultDoc.RootElement;
            string errorMessage = GetJsonString(root, "errorMessage");
            if (!string.IsNullOrWhiteSpace(errorMessage))
            {
                // The schema does not fit the plan: the cloud's message already says the numbers and the
                // way out, and is not a failure to debug.
                if (ReportmanAgentClient.IsSchemaTooLargeForTier(resultDoc))
                    SafeAppendMessage("system", errorMessage);
                else
                    SafeAppendMessage("system", DesignerText.Tr(355) + ": " + ComposeApiErrorMessage(errorMessage, GetJsonString(root, "debugDetails")));
                return;
            }

            if (!root.TryGetProperty("result", out var resultElement) || resultElement.ValueKind != JsonValueKind.Object)
            {
                SafeAppendMessage("assistant", DesignerText.Tr(1540));
                return;
            }

            string resultError = GetJsonString(resultElement, "errorMessage");
            if (!string.IsNullOrWhiteSpace(resultError))
            {
                SafeAppendMessage("system", DesignerText.Tr(355) + ": " + resultError);
                return;
            }

            string contextJson = GetJsonString(resultElement, "contextJson");
            if (!string.IsNullOrWhiteSpace(contextJson) && !string.Equals(contextJson.Trim(), "null", StringComparison.OrdinalIgnoreCase))
                _existingContextJson = contextJson;

            // After SQL turns an empty document means the last one sent, which carries the datasets made on the way.
            string modifiedReportDocument = GetJsonString(resultElement, "modifiedReportDocument");
            if (string.IsNullOrWhiteSpace(modifiedReportDocument))
                modifiedReportDocument = documentToApply ?? "";
            if (!string.IsNullOrWhiteSpace(modifiedReportDocument))
                ApplyModifiedReportDocumentSafely(modifiedReportDocument);

            string message = GetJsonString(resultElement, "explanation").Trim();
            if (message.Length == 0)
                message = DesignerText.Tr(!string.IsNullOrWhiteSpace(modifiedReportDocument) ? 1539 : 1540);
            SafeAppendMessage("assistant", message);
        }

        private void ApplyModifiedReportDocumentSafely(string reportDocument)
        {
            if (InvokeRequired)
            {
                PostToUi(() => ApplyModifiedReportDocumentSafely(reportDocument));
                return;
            }

            if (ApplyModifiedReportDocument != null)
                ApplyModifiedReportDocument(reportDocument);
            else
                SafeAppendMessage("system", "The server returned a modified report, but no apply handler is configured.");
        }

        private static string GetJsonString(JsonElement element, string propertyName)
        {
            if (!element.TryGetProperty(propertyName, out var value) || value.ValueKind == JsonValueKind.Null)
                return "";
            if (value.ValueKind == JsonValueKind.String)
                return value.GetString() ?? "";
            return value.GetRawText();
        }

        private static string ComposeApiErrorMessage(string message, string debugDetails)
        {
            if (string.IsNullOrWhiteSpace(debugDetails))
                return message;
            return message + Environment.NewLine + debugDetails;
        }
    }
}
