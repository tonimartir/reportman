using System;
using System.Collections.Generic;
using System.ComponentModel;
using System.Drawing;
using System.Text.Json;
using System.Threading;
using System.Threading.Tasks;
using System.Windows.Forms;
using Reportman.Reporting;
#if NET8_0_OR_GREATER
using Reportman.Hub.Client.DataChannel;
#endif

namespace Reportman.Designer
{
    /// <summary>
    /// Event data raised when the active Hub database, schema or API key bound to
    /// the SQL chat panel changes, carrying the effective identifiers used for
    /// subsequent AI requests.
    /// </summary>
    public class SqlSchemaContextChangedEventArgs : EventArgs
    {
        public SqlSchemaContextChangedEventArgs(long hubDatabaseId, long hubSchemaId, string apiKey)
        {
            HubDatabaseId = hubDatabaseId;
            HubSchemaId = hubSchemaId;
            ApiKey = apiKey ?? "";
        }

        public long HubDatabaseId { get; private set; }
        public long HubSchemaId { get; private set; }
        public string ApiKey { get; private set; }
    }

    /// <summary>
    /// Designer panel that lets the user chat with the Reportman AI agent to
    /// generate SQL from natural language, streaming the response and exposing
    /// the suggested SQL for the caller to apply.
    /// </summary>
    public class SqlChatPanelControl : UserControl
    {
        private AILoginFrameControl _loginControl;
        private AISelectionControl _aiSelectionControl;
        private AISchemaSelectorControl _schemaSelector;
        private TabControl _tabControl;
        private TabPage _chatTab;
        private TabPage _aiLogTab;
        private TabPage _netLogTab;
        private WebMarkdownControl _conversation;
        private WebMarkdownControl _aiLogView;
        private WebMarkdownControl _netLogView;
        private Panel _bottomPanel;
        private Panel _buttonPanel;
        private TextBox _promptText;
        private Button _sendButton;
        private Button _applyButton;
        private Button _clearButton;
        private ReportmanAgentClient _agentClient;
        private CancellationTokenSource _cts;
        private Action<string> _authLogHandler;
#if NET8_0_OR_GREATER
        private Action<string> _dcLogHandler;
#endif
        private bool _isBusy;
        private string _currentSql = "";
        private string _suggestedSql = "";
        private long _baseHubDatabaseId;
        private long _baseHubSchemaId;
        private string _baseApiKey = "";
        private string _runtimeDb = "";

        public event EventHandler<string> ApplySuggestion;
        public event EventHandler<SqlSchemaContextChangedEventArgs> SchemaContextChanged;

        [Browsable(false)]
        [DesignerSerializationVisibility(DesignerSerializationVisibility.Hidden)]
        public Func<Task<string>> CurrentSqlProvider { get; set; }

        public SqlChatPanelControl()
        {
            InitializeComponent();

            _agentClient = new ReportmanAgentClient();
            _agentClient.LogMessage += AppendNetLog;
            _authLogHandler = AppendNetLog;
            RpAuthManager.Instance.LogMessage += _authLogHandler;
#if NET8_0_OR_GREATER
            // Surface the WebRTC direct-channel handshake (iceServers, ICE
            // candidate exchange, peer state) in the Net Log so a Show Data
            // negotiation can be watched live, not just via the temp file.
            // net48 falls back to HTTP only, so there is no handshake to trace.
            _dcLogHandler = msg => AppendNetLog("DC " + msg);
            WebRtcDataChannelSession.DiagnosticLog += _dcLogHandler;
#endif
            RpAuthManager.Instance.AuthChanged += OnAuthChanged;
            HandleCreated += (s, e) =>
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
#if NET8_0_OR_GREATER
                if (_dcLogHandler != null)
                    WebRtcDataChannelSession.DiagnosticLog -= _dcLogHandler;
#endif
                if (_agentClient != null)
                    _agentClient.LogMessage -= AppendNetLog;
                if (_cts != null)
                    _cts.Dispose();
            }
            base.Dispose(disposing);
        }

        private void InitializeComponent()
        {
            MinimumSize = new Size(320, 400);

            _loginControl = new AILoginFrameControl
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

            _schemaSelector = new AISchemaSelectorControl
            {
                Dock = DockStyle.Fill,
                AutoSize = true,
                AutoSizeMode = AutoSizeMode.GrowAndShrink
            };
            _schemaSelector.SchemaChanged += SchemaSelector_SchemaChanged;

            TableLayoutPanel topPanel = new TableLayoutPanel
            {
                Dock = DockStyle.Top,
                ColumnCount = 1,
                RowCount = 3,
                AutoSize = true,
                AutoSizeMode = AutoSizeMode.GrowAndShrink
            };
            topPanel.ColumnStyles.Add(new ColumnStyle(SizeType.Percent, 100f));
            topPanel.RowStyles.Add(new RowStyle(SizeType.AutoSize));
            topPanel.RowStyles.Add(new RowStyle(SizeType.AutoSize));
            topPanel.RowStyles.Add(new RowStyle(SizeType.AutoSize));
            topPanel.Controls.Add(_loginControl, 0, 0);
            topPanel.Controls.Add(_aiSelectionControl, 0, 1);
            topPanel.Controls.Add(_schemaSelector, 0, 2);

            _tabControl = new TabControl { Dock = DockStyle.Fill };

            _chatTab = new TabPage { Text = "Chat" };
            _conversation = new WebMarkdownControl { Dock = DockStyle.Fill };
            _chatTab.Controls.Add(_conversation);

            _aiLogTab = new TabPage { Text = "AI Log" };
            Panel aiLogToolbar = new Panel
            {
                Dock = DockStyle.Top,
                Height = 38,
                Padding = new Padding(8, 5, 8, 5)
            };
            Button clearAiLogButton = new Button
            {
                Text = "Clear",
                Dock = DockStyle.Left,
                Width = 90
            };
            clearAiLogButton.Click += (s, e) => _aiLogView.ClearAll();
            aiLogToolbar.Controls.Add(clearAiLogButton);
            _aiLogView = new WebMarkdownControl
            {
                Dock = DockStyle.Fill
            };
            _aiLogTab.Controls.Add(_aiLogView);
            _aiLogTab.Controls.Add(aiLogToolbar);

            _netLogTab = new TabPage { Text = "Net Log" };
            Panel netLogToolbar = new Panel
            {
                Dock = DockStyle.Top,
                Height = 38,
                Padding = new Padding(8, 5, 8, 5)
            };
            Button clearNetLogButton = new Button
            {
                Text = "Clear",
                Dock = DockStyle.Left,
                Width = 90
            };
            clearNetLogButton.Click += (s, e) => _netLogView.ClearAll();
            netLogToolbar.Controls.Add(clearNetLogButton);
            _netLogView = new WebMarkdownControl
            {
                Dock = DockStyle.Fill
            };
            _netLogTab.Controls.Add(_netLogView);
            _netLogTab.Controls.Add(netLogToolbar);

            _tabControl.TabPages.Add(_chatTab);
            _tabControl.TabPages.Add(_aiLogTab);
            _tabControl.TabPages.Add(_netLogTab);

            _bottomPanel = new Panel
            {
                Dock = DockStyle.Bottom,
                Height = 112,
                Padding = new Padding(8)
            };

            _buttonPanel = new Panel
            {
                Dock = DockStyle.Right,
                Width = 104
            };

            _sendButton = new Button
            {
                Text = "Send",
                Dock = DockStyle.Top,
                Height = 30
            };
            _sendButton.Click += SendButton_Click;

            _applyButton = new Button
            {
                Text = "Apply",
                Dock = DockStyle.Top,
                Height = 30,
                Enabled = false
            };
            _applyButton.Click += ApplyButton_Click;

            _clearButton = new Button
            {
                Text = "Clear",
                Dock = DockStyle.Top,
                Height = 30
            };
            _clearButton.Click += ClearButton_Click;

            _buttonPanel.Controls.Add(_clearButton);
            _buttonPanel.Controls.Add(_applyButton);
            _buttonPanel.Controls.Add(_sendButton);

            _promptText = new TextBox
            {
                Dock = DockStyle.Fill,
                Multiline = true,
                ScrollBars = ScrollBars.Vertical,
                WordWrap = true
            };
            _promptText.TextChanged += (s, e) => UpdateButtons();
            _promptText.KeyDown += PromptText_KeyDown;

            _bottomPanel.Controls.Add(_promptText);
            _bottomPanel.Controls.Add(_buttonPanel);

            Controls.Add(_tabControl);
            Controls.Add(_bottomPanel);
            Controls.Add(topPanel);
        }

        private void EnsureWebMarkdownViewsInitialized()
        {
            _conversation?.EnsureInitialized();
            _aiLogView?.EnsureInitialized();
            _netLogView?.EnsureInitialized();
        }

        public void Initialize(string currentSql, string initialAssistantMessage)
        {
            _currentSql = currentSql ?? "";
            _suggestedSql = "";
            _promptText.Clear();
            _conversation.ClearAll();
            _aiLogView.ClearAll();
            _netLogView.ClearAll();
            EnsureWebMarkdownViewsInitialized();
            if (!string.IsNullOrWhiteSpace(initialAssistantMessage))
                _conversation.AppendMessage("assistant", initialAssistantMessage);
            UpdateButtons();
        }

        public void SetCurrentSql(string sql)
        {
            _currentSql = sql ?? "";
        }

        public void SetHubContext(long hubDatabaseId, long hubSchemaId, string apiKey, string runtimeDb)
        {
            SetBaseConnectionContext(hubDatabaseId, hubSchemaId, apiKey, runtimeDb);
        }

        public void SetBaseConnectionContext(long hubDatabaseId, long hubSchemaId, string apiKey, string runtimeDb)
        {
            _baseHubDatabaseId = hubDatabaseId;
            _baseHubSchemaId = hubSchemaId;
            _baseApiKey = apiKey ?? "";
            _runtimeDb = runtimeDb ?? "";
            _schemaSelector.SetPreferredConnection(_baseHubDatabaseId, _baseApiKey);
            _schemaSelector.SetHubContext(hubDatabaseId, hubSchemaId, _baseApiKey);
            _schemaSelector.RefreshSchemas();
        }

        public void SetSelectedSchemaContext(long hubDatabaseId, long hubSchemaId, string apiKey)
        {
            _schemaSelector.SetHubContext(hubDatabaseId, hubSchemaId, apiKey ?? "");
        }

        private long EffectiveHubDatabaseId
        {
            get { return _schemaSelector.HubDatabaseId > 0 ? _schemaSelector.HubDatabaseId : _baseHubDatabaseId; }
        }

        private long EffectiveHubSchemaId
        {
            get { return _schemaSelector.HubDatabaseId > 0 || _schemaSelector.HubSchemaId > 0 ? _schemaSelector.HubSchemaId : _baseHubSchemaId; }
        }

        private string EffectiveApiKey
        {
            get { return !string.IsNullOrWhiteSpace(_schemaSelector.SchemaApiKey) ? _schemaSelector.SchemaApiKey : _baseApiKey; }
        }

        private void OnAuthChanged(bool success)
        {
            if (InvokeRequired)
            {
                try { Invoke(new Action(() => OnAuthChanged(success))); } catch { }
                return;
            }

            _aiSelectionControl.RefreshState();
            _schemaSelector.RefreshSchemas();
            LoadUserAgentsAsync();
        }

        private void StartOnlineInitialization()
        {
            _aiSelectionControl.RefreshState();
            _schemaSelector.RefreshSchemas();
            if (RpAuthManager.Instance.IsLoggedIn)
            {
                RpAuthManager.Instance.RefreshStatusInBackground();
                LoadUserAgentsAsync();
            }
        }

        private async void LoadSchemasAsync()
        {
            _schemaSelector.RefreshSchemas();
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

                List<string> agents = await RpAuthManager.Instance.GetUserAgentsAsync();
                if (InvokeRequired)
                    Invoke(new Action(() => ApplyLoadedAgents(agents, selectedTier, selectedAgentAiId)));
                else
                    ApplyLoadedAgents(agents, selectedTier, selectedAgentAiId);
            }
            catch (Exception ex)
            {
                AppendAILog("LoadUserAgents Error: " + ex.Message);
            }
        }

        private void ApplyLoadedAgents(List<string> agents, string selectedTier, long selectedAgentAiId)
        {
            _aiSelectionControl.ClearAgentEndpoints();
            if (agents != null)
            {
                foreach (string entry in agents)
                {
                    int eq = entry.IndexOf('=');
                    if (eq <= 0)
                        continue;
                    string displayName = entry.Substring(0, eq);
                    string value = entry.Substring(eq + 1);
                    string[] parts = value.Split('|');
                    if (parts.Length < 2)
                        continue;

                    long agentAiId;
                    if (!long.TryParse(parts[0], out agentAiId))
                        agentAiId = 0;
                    string secret = parts[1];
                    bool isOnline = parts.Length >= 3 && parts[2] == "1";
                    if (isOnline)
                        _aiSelectionControl.AddAgentEndpoint(agentAiId, secret, displayName, true);
                }
            }
            _aiSelectionControl.RestoreProviderSelection(selectedTier, selectedAgentAiId);
        }

        private void SchemaSelector_SchemaChanged(object sender, EventArgs e)
        {
            SchemaContextChanged?.Invoke(this,
                new SqlSchemaContextChangedEventArgs(EffectiveHubDatabaseId, EffectiveHubSchemaId, EffectiveApiKey));
        }

        private void PromptText_KeyDown(object sender, KeyEventArgs e)
        {
            if (e.KeyCode == Keys.Enter && !e.Shift)
            {
                e.SuppressKeyPress = true;
                if (!_isBusy && !string.IsNullOrWhiteSpace(_promptText.Text))
                    SendButton_Click(sender, e);
            }
        }

        private void UpdateButtons()
        {
            _sendButton.Enabled = !_isBusy && !string.IsNullOrWhiteSpace(_promptText.Text);
            _applyButton.Enabled = !_isBusy && !string.IsNullOrWhiteSpace(_suggestedSql);
            _clearButton.Text = _isBusy ? "Stop" : "Clear";
        }

        private void SetBusy(bool busy)
        {
            _isBusy = busy;
            _promptText.Enabled = !busy;
            _aiSelectionControl.SetInferenceProgress(busy);
            UpdateButtons();
            _tabControl.SelectedTab = busy ? _aiLogTab : _chatTab;
        }

        private void ApplyButton_Click(object sender, EventArgs e)
        {
            if (!string.IsNullOrWhiteSpace(_suggestedSql))
                ApplySuggestion?.Invoke(this, _suggestedSql);
        }

        private void ClearButton_Click(object sender, EventArgs e)
        {
            if (_isBusy)
            {
                StopInference();
                return;
            }

            _conversation.ClearAll();
            _promptText.Clear();
            _suggestedSql = "";
            UpdateButtons();
        }

        private void StopInference()
        {
            if (_cts != null)
                _cts.Cancel();
            SafeAppendMessage("system", "Inference was cancelled by the user.");
        }

        private async void SendButton_Click(object sender, EventArgs e)
        {
            string prompt = _promptText.Text.Trim();
            if (prompt.Length == 0)
                return;

            _promptText.Clear();
            _suggestedSql = "";
            SetBusy(true);
            _cts = new CancellationTokenSource();
            AICopilotManager.Instance.OnCancelRequested = StopInference;
            AICopilotManager.Instance.BeginInference();

            try
            {
                string currentSql = CurrentSqlProvider != null ? await CurrentSqlProvider() : _currentSql;
                currentSql = currentSql ?? "";
                _currentSql = currentSql;

                SafeAppendMessage("user", prompt);
                SqlSuggestionResult result = await RequestSqlSuggestionAsync(prompt, currentSql, _cts.Token);
                if (!result.Success)
                {
                    SafeAppendMessage("system", result.ErrorMessage);
                    return;
                }

                SetSuggestedSql(result.Sql,
                    string.IsNullOrWhiteSpace(result.Explanation) ? "SQL generated." : result.Explanation);
            }
            catch (OperationCanceledException)
            {
                SafeAppendMessage("system", "Inference was cancelled by the user.");
            }
            catch (Exception ex)
            {
                SafeAppendMessage("system", "Error: " + ex.Message);
            }
            finally
            {
                AICopilotManager.Instance.EndInference();
                SetBusy(false);
                _promptText.Focus();
                _conversation.ScrollToEnd();
            }
        }

        private async Task<SqlSuggestionResult> RequestSqlSuggestionAsync(string prompt, string currentSql,
            CancellationToken cancellationToken)
        {
            ConfigureAgentClient();
            _conversation.BeginStreaming("agent");
            JsonDocument resultDoc = null;
            try
            {
                resultDoc = await _agentClient.TranslateToSqlAsync(
                    prompt,
                    currentSql,
                    _aiSelectionControl.SelectedMode,
                    RpAuthManager.Instance.AILanguage,
                    this,
                    (senderObj, actor, stage, chunkType, chunk, inputTokens, outputTokens, progressId, prefillPercent) =>
                    {
                        PostToUi(() => UpdateStreamingProgress(actor, stage, chunkType, chunk,
                            inputTokens, outputTokens, progressId, prefillPercent));
                    },
                    cancellationToken);

                return ExtractSqlSuggestionResult(resultDoc);
            }
            finally
            {
                _conversation.FinishStreaming();
                if (resultDoc != null)
                    resultDoc.Dispose();
            }
        }

        private void ConfigureAgentClient()
        {
            string tier = _aiSelectionControl.SelectedTier;
            _agentClient.Token = RpAuthManager.Instance.Token;
            _agentClient.InstallId = RpAuthManager.Instance.InstallId;
            _agentClient.AITier = tier;
            _agentClient.ApiKey = EffectiveApiKey;
            _agentClient.HubDatabaseId = EffectiveHubDatabaseId;
            _agentClient.HubSchemaId = EffectiveHubSchemaId;
            _agentClient.RuntimeDb = _runtimeDb;

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
        }

        private void SetSuggestedSql(string sql, string message)
        {
            _suggestedSql = sql ?? "";
            string text = string.IsNullOrWhiteSpace(message) ? "Suggested SQL:" : message + Environment.NewLine + Environment.NewLine + "Suggested SQL:";
            text += Environment.NewLine + "```sql" + Environment.NewLine + _suggestedSql + Environment.NewLine + "```";
            SafeAppendMessage("assistant", text);
            UpdateButtons();
        }

        private SqlSuggestionResult ExtractSqlSuggestionResult(JsonDocument resultDoc)
        {
            SqlSuggestionResult result = new SqlSuggestionResult();
            if (resultDoc == null)
            {
                result.ErrorMessage = "No final response received";
                return result;
            }

            JsonElement root = resultDoc.RootElement;
            string rootError = GetJsonString(root, "errorMessage");
            if (!string.IsNullOrWhiteSpace(rootError))
            {
                result.ErrorMessage = rootError;
                return result;
            }

            JsonElement resultElement = root;
            JsonElement nestedResult;
            if (TryGetJsonProperty(root, "result", out nestedResult) && nestedResult.ValueKind == JsonValueKind.Object)
                resultElement = nestedResult;

            string resultError = GetJsonString(resultElement, "errorMessage");
            if (!string.IsNullOrWhiteSpace(resultError))
            {
                result.ErrorMessage = resultError;
                return result;
            }

            result.Sql = FirstNonEmpty(
                GetJsonString(resultElement, "sql"),
                GetJsonString(resultElement, "generatedSql"),
                GetJsonString(resultElement, "SQL"));
            result.Explanation = GetJsonString(resultElement, "explanation");

            if (string.IsNullOrWhiteSpace(result.Sql))
                result.ErrorMessage = string.IsNullOrWhiteSpace(result.Explanation) ? "No SQL was returned by the service." : result.Explanation;

            return result;
        }

        private void SafeAppendMessage(string role, string text)
        {
            PostToUi(() => _conversation.AppendMessage(role, text ?? ""));
        }

        private void SafeAppendStreamingChunk(string chunk, int prefillPercent)
        {
            PostToUi(() => _conversation.AppendStreamingChunk("assistant", chunk ?? "", prefillPercent));
        }

        private void UpdateStreamingProgress(string actor, string stage, string chunkType, string chunk,
            int inputTokens, int outputTokens, string progressId, int prefillPercent)
        {
            if (string.Equals(stage, "ReceivingResponse", StringComparison.OrdinalIgnoreCase) &&
                string.Equals(chunkType, "Partial", StringComparison.OrdinalIgnoreCase))
            {
                SafeAppendStreamingChunk(chunk, prefillPercent);
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
            if (_aiLogView == null)
                return;

            string key = (progressId ?? "").Trim();
            string logChunk = chunk ?? "";
            if (IsFinalChunk(chunkType))
            {
                if (logChunk.Length > 0)
                    _aiLogView.AppendLogChunkForKey(key, logChunk);
                _aiLogView.EndLogChunkForKey(key);
            }
            else if (logChunk.Length > 0)
            {
                _aiLogView.AppendLogChunkForKey(key, logChunk);
            }
        }

        private static bool IsFinalChunk(string chunkType)
        {
            return string.Equals(chunkType, "End", StringComparison.OrdinalIgnoreCase) ||
                string.Equals(chunkType, "Full", StringComparison.OrdinalIgnoreCase);
        }

        private void AppendAILog(string message)
        {
            PostToUi(() =>
            {
                if (_aiLogView != null)
                    _aiLogView.AppendLogLine("[" + DateTime.Now.ToString("HH:mm:ss") + "] " + message);
            });
        }

        private void AppendNetLog(string message)
        {
            PostToUi(() =>
            {
                if (_netLogView != null)
                    _netLogView.AppendLogLine("[" + DateTime.Now.ToString("HH:mm:ss") + "] " + message);
            });
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

        private static bool TryGetJsonProperty(JsonElement element, string propertyName, out JsonElement value)
        {
            if (element.ValueKind == JsonValueKind.Object && element.TryGetProperty(propertyName, out value))
                return true;

            if (element.ValueKind == JsonValueKind.Object)
            {
                foreach (JsonProperty property in element.EnumerateObject())
                {
                    if (string.Equals(property.Name, propertyName, StringComparison.OrdinalIgnoreCase))
                    {
                        value = property.Value;
                        return true;
                    }
                }
            }

            value = default(JsonElement);
            return false;
        }

        private static string GetJsonString(JsonElement element, string propertyName)
        {
            JsonElement value;
            if (!TryGetJsonProperty(element, propertyName, out value) ||
                value.ValueKind == JsonValueKind.Null || value.ValueKind == JsonValueKind.Undefined)
                return "";

            if (value.ValueKind == JsonValueKind.String)
                return value.GetString() ?? "";

            return value.GetRawText();
        }

        private static string FirstNonEmpty(params string[] values)
        {
            foreach (string value in values)
            {
                if (!string.IsNullOrWhiteSpace(value))
                    return value;
            }
            return "";
        }

        private class SqlSuggestionResult
        {
            public string Sql = "";
            public string Explanation = "";
            public string ErrorMessage = "";
            public bool Success { get { return string.IsNullOrEmpty(ErrorMessage); } }
        }
    }
}