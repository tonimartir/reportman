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

        // Agent client
        private ReportmanAgentClient _agentClient;

        // Events
        public event EventHandler<string> ApplySuggestion;

        [Browsable(false)]
        [DesignerSerializationVisibility(DesignerSerializationVisibility.Hidden)]
        public Func<string> ReportDocumentProvider { get; set; }

        [Browsable(false)]
        [DesignerSerializationVisibility(DesignerSerializationVisibility.Hidden)]
        public Action<string> ApplyModifiedReportDocument { get; set; }

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
                Text = "Send",
                Dock = DockStyle.Top,
                Height = 30
            };
            _btnSend.Click += BtnSend_Click;

            _btnApply = new Button
            {
                Text = "Apply",
                Dock = DockStyle.Top,
                Height = 30,
                Enabled = false
            };
            _btnApply.Click += BtnApply_Click;

            _btnClear = new Button
            {
                Text = "Clear",
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
            _tabChat = new TabPage { Text = "Chat" };
            _markdownControl = new WebMarkdownControl { Dock = DockStyle.Fill };
            _tabChat.Controls.Add(_markdownControl);

            // --- Tab: AI Log ---
            _tabLog = new TabPage { Text = "AI Log" };

            _logToolbar = new Panel
            {
                Dock = DockStyle.Top,
                Height = 41,
                Padding = new Padding(8, 5, 8, 5)
            };
            _btnClearLog = new Button
            {
                Text = "Clear",
                Dock = DockStyle.Left,
                Width = 93
            };
            _btnClearLog.Click += (s, e) => _logView.ClearAll();
            _btnReportAI = new Button
            {
                Text = "Report content",
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
            _tabNetLog = new TabPage { Text = "Net Log" };

            _netLogToolbar = new Panel
            {
                Dock = DockStyle.Top,
                Height = 41,
                Padding = new Padding(8, 5, 8, 5)
            };
            _btnClearNetLog = new Button
            {
                Text = "Clear",
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
                _btnClear.Text = "Stop";
            }
            else
            {
                _btnClear.Text = "Clear";
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

        public void AppendLog(string message)
        {
            PostToUi(() => _logView.AppendLogLine($"[{DateTime.Now:HH:mm:ss}] {message}"));
        }

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

                AICopilotManager.Instance.OnCancelRequested = () =>
                {
                    _cts.Cancel();
                    AppendLog("Inference cancelled by user.");
                };
                AICopilotManager.Instance.BeginInference();

                var resultDoc = await System.Threading.Tasks.Task.Run(async () =>
                    await _agentClient.ModifyReportAsync(
                        prompt,
                        reportDocument,
                        mode,
                        RpAuthManager.Instance.AILanguage,
                        _existingContextJson,
                        this,
                        (senderObj, actor, stage, chunkType, chunk, inTokens, outTokens, progId, prefill) =>
                        {
                            PostToUi(() => UpdateStreamingProgress(actor, stage, chunkType, chunk,
                                inTokens, outTokens, progId, prefill));
                        },
                        _cts.Token).ConfigureAwait(false), _cts.Token);

                _markdownControl.FinishStreaming();
                HandleModifyReportResult(resultDoc);
            }
            catch (OperationCanceledException)
            {
                _markdownControl.FinishStreaming();
                SafeAppendMessage("system", "Inference was cancelled by the user.");
            }
            catch (Exception ex)
            {
                _markdownControl.FinishStreaming();
                SafeAppendMessage("system", "Error: " + ex.Message);
            }
            finally
            {
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
            int inputTokens, int outputTokens, string progressId, int prefillPercent)
        {
            if (string.Equals(stage, "ReceivingResponse", StringComparison.OrdinalIgnoreCase) &&
                string.Equals(chunkType, "Partial", StringComparison.OrdinalIgnoreCase))
            {
                ProcessChunk(chunk);
            }

            AppendAILogProgress(chunkType, chunk, progressId);

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

        private void HandleModifyReportResult(JsonDocument resultDoc)
        {
            if (resultDoc == null)
            {
                SafeAppendMessage("assistant", "No report changes were returned.");
                return;
            }

            var root = resultDoc.RootElement;
            string errorMessage = GetJsonString(root, "errorMessage");
            if (!string.IsNullOrWhiteSpace(errorMessage))
            {
                SafeAppendMessage("system", "Error: " + ComposeApiErrorMessage(errorMessage, GetJsonString(root, "debugDetails")));
                return;
            }

            if (!root.TryGetProperty("result", out var resultElement) || resultElement.ValueKind != JsonValueKind.Object)
            {
                SafeAppendMessage("assistant", "No report changes were returned.");
                return;
            }

            string resultError = GetJsonString(resultElement, "errorMessage");
            if (!string.IsNullOrWhiteSpace(resultError))
            {
                SafeAppendMessage("system", "Error: " + resultError);
                return;
            }

            string contextJson = GetJsonString(resultElement, "contextJson");
            if (!string.IsNullOrWhiteSpace(contextJson) && !string.Equals(contextJson.Trim(), "null", StringComparison.OrdinalIgnoreCase))
                _existingContextJson = contextJson;

            string modifiedReportDocument = GetJsonString(resultElement, "modifiedReportDocument");
            if (!string.IsNullOrWhiteSpace(modifiedReportDocument))
                ApplyModifiedReportDocumentSafely(modifiedReportDocument);

            string message = GetJsonString(resultElement, "explanation").Trim();
            if (message.Length == 0)
                message = !string.IsNullOrWhiteSpace(modifiedReportDocument) ? "Report updated." : "No report changes were returned.";
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
