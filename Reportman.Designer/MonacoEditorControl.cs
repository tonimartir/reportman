using System;
using System.Collections.Generic;
using System.Drawing;
using System.IO;
using System.Text.Json;
using System.Threading;
using System.Threading.Tasks;
using System.Windows.Forms;
using Microsoft.Web.WebView2.Core;
using Microsoft.Web.WebView2.WinForms;
using Reportman.Reporting;

namespace Reportman.Designer
{
    public class MonacoEditorControl : UserControl
    {
        private const int AutoCompleteDebounceDelayMs = 1000;

        private readonly ReportmanAgentClient _agentClient;
        private readonly SemaphoreSlim _inferenceSemaphore = new SemaphoreSlim(1, 1);
        private WebView2 _webView;
        private TableLayoutPanel _topPanel;
        private AISchemaSelectorControl _schemaSelector;
        private CheckBox _chkAiToggle;
        private AISelectionControl _aiSelectionControl;
        private bool _enableSqlAutocompleteUi;
        private bool _isReady;
        private string _cachedSql = string.Empty;
        private bool _updatingFromBrowser;
        private CancellationTokenSource _debounceCts;
        private CancellationTokenSource _inferenceCts;
        private bool _isProcessingInference;
        private string _pendingRequestId = "";
        private string _pendingSql = "";
        private int _pendingCursorPosition;
        private string _lastAutoCompleteSql = "";
        private long _baseHubDatabaseId;
        private long _baseHubSchemaId;
        private long _selectedHubDatabaseId;
        private long _selectedHubSchemaId;
        private string _selectedSchemaApiKey = "";
        
        public event EventHandler SqlContentChanged;
        public event EventHandler<SqlSchemaContextChangedEventArgs> SchemaContextChanged;
        
        public MonacoEditorControl()
        {
            _agentClient = new ReportmanAgentClient();
            InitializeComponent();
            RpAuthManager.Instance.AuthChanged += AuthManager_AuthChanged;
        }

        protected override void Dispose(bool disposing)
        {
            if (disposing)
            {
                RpAuthManager.Instance.AuthChanged -= AuthManager_AuthChanged;
                _debounceCts?.Cancel();
                _debounceCts?.Dispose();
                _inferenceCts?.Cancel();
                _inferenceCts?.Dispose();
                _inferenceSemaphore.Dispose();
            }
            base.Dispose(disposing);
        }

        private void InitializeComponent()
        {
            this.Size = new Size(800, 600);

            _schemaSelector = new AISchemaSelectorControl
            {
                Dock = DockStyle.Fill,
                AutoSize = true,
                AutoSizeMode = AutoSizeMode.GrowAndShrink
            };
            _schemaSelector.SchemaChanged += SchemaSelector_SchemaChanged;

            _chkAiToggle = new CheckBox
            {
                Text = "AI Autocomplete",
                Appearance = Appearance.Button,
                AutoSize = false,
                Width = 130,
                Dock = DockStyle.Fill,
                TextAlign = ContentAlignment.MiddleCenter,
                Cursor = Cursors.Hand
            };
            _chkAiToggle.CheckedChanged += ChkAiToggle_CheckedChanged;

            _aiSelectionControl = new AISelectionControl
            {
                Dock = DockStyle.Fill,
                AutoSize = true,
                AutoSizeMode = AutoSizeMode.GrowAndShrink,
                ShowGauge = false,
                Visible = false
            };
            _aiSelectionControl.StopRequested += (s, e) => CancelAutoCompleteInference();

            _topPanel = new TableLayoutPanel
            {
                Dock = DockStyle.Top,
                ColumnCount = 2,
                RowCount = 2,
                AutoSize = true,
                AutoSizeMode = AutoSizeMode.GrowAndShrink,
                Padding = new Padding(4),
                Visible = false
            };
            _topPanel.ColumnStyles.Add(new ColumnStyle(SizeType.AutoSize));
            _topPanel.ColumnStyles.Add(new ColumnStyle(SizeType.Percent, 100f));
            _topPanel.RowStyles.Add(new RowStyle(SizeType.AutoSize));
            _topPanel.RowStyles.Add(new RowStyle(SizeType.AutoSize));
            _topPanel.Controls.Add(_chkAiToggle, 0, 0);
            _topPanel.Controls.Add(_schemaSelector, 1, 0);
            _topPanel.Controls.Add(_aiSelectionControl, 0, 1);
            _topPanel.SetColumnSpan(_aiSelectionControl, 2);
            
            _webView = new WebView2
            {
                Dock = DockStyle.Fill,
                DefaultBackgroundColor = Color.White
            };
            
            _webView.NavigationCompleted += WebView_NavigationCompleted;
            _webView.WebMessageReceived += WebView_WebMessageReceived;
            
            this.Controls.Add(_webView);
            this.Controls.Add(_topPanel);
        }

        [System.ComponentModel.Browsable(false)]
        [System.ComponentModel.DesignerSerializationVisibility(System.ComponentModel.DesignerSerializationVisibility.Hidden)]
        public bool EnableSqlAutocompleteUi
        {
            get => _enableSqlAutocompleteUi;
            set
            {
                if (_enableSqlAutocompleteUi == value)
                    return;

                _enableSqlAutocompleteUi = value;
                _topPanel.Visible = value;
                UpdateAutoCompleteOptionsLayout();

                if (!value)
                {
                    _chkAiToggle.Checked = false;
                    CancelAutoCompleteInference();
                    UpdateEffectiveSchemaContext();
                    return;
                }

                _aiSelectionControl.ShowGauge = false;
                _chkAiToggle.Checked = false;
                UpdateAutoCompleteOptionsLayout();
                _aiSelectionControl.RefreshState();
                _schemaSelector.SetPreferredConnection(_baseHubDatabaseId, ApiKey);
                _schemaSelector.SetHubContext(_selectedHubDatabaseId, _selectedHubSchemaId, _selectedSchemaApiKey);
                _schemaSelector.RefreshSchemas();
                LoadUserAgentsAsync();
                UpdateEffectiveSchemaContext();
            }
        }

        [System.ComponentModel.Browsable(false)]
        [System.ComponentModel.DesignerSerializationVisibility(System.ComponentModel.DesignerSerializationVisibility.Hidden)]
        public string SQL
        {
            get => _cachedSql;
            set
            {
                _cachedSql = NormalizeLineEndings(value);
                if (_isReady && !_updatingFromBrowser && _webView.CoreWebView2 != null)
                {
                    string safeSql = JsonSerializer.Serialize(_cachedSql);
                    _webView.ExecuteScriptAsync($"if (window.editor) {{ window.editor.setValue({safeSql}); }}");
                }
            }
        }

        [System.ComponentModel.Browsable(false)]
        [System.ComponentModel.DesignerSerializationVisibility(System.ComponentModel.DesignerSerializationVisibility.Hidden)]
        public long HubDatabaseId { get; private set; }

        [System.ComponentModel.Browsable(false)]
        [System.ComponentModel.DesignerSerializationVisibility(System.ComponentModel.DesignerSerializationVisibility.Hidden)]
        public long HubSchemaId { get; private set; }

        [System.ComponentModel.Browsable(false)]
        [System.ComponentModel.DesignerSerializationVisibility(System.ComponentModel.DesignerSerializationVisibility.Hidden)]
        public string ApiKey { get; set; } = "";

        [System.ComponentModel.Browsable(false)]
        [System.ComponentModel.DesignerSerializationVisibility(System.ComponentModel.DesignerSerializationVisibility.Hidden)]
        public string RuntimeDb { get; set; } = "";

        public void SetBaseConnectionContext(long hubDatabaseId, long hubSchemaId, string apiKey = "", string runtimeDb = "")
        {
            _baseHubDatabaseId = hubDatabaseId;
            _baseHubSchemaId = hubSchemaId;
            ApiKey = apiKey ?? "";
            RuntimeDb = runtimeDb ?? "";

            if (EnableSqlAutocompleteUi)
                _schemaSelector.SetPreferredConnection(_baseHubDatabaseId, ApiKey);

            SetHubContext(hubDatabaseId, hubSchemaId, ApiKey);

            if (EnableSqlAutocompleteUi)
                _schemaSelector.RefreshSchemas();
        }

        public void SetHubContext(long hubDatabaseId, long hubSchemaId)
        {
            SetHubContext(hubDatabaseId, hubSchemaId, "");
        }

        public void SetHubContext(long hubDatabaseId, long hubSchemaId, string apiKey)
        {
            _selectedHubDatabaseId = hubDatabaseId;
            _selectedHubSchemaId = hubSchemaId;
            _selectedSchemaApiKey = apiKey ?? "";

            if (EnableSqlAutocompleteUi)
                _schemaSelector.SetHubContext(hubDatabaseId, hubSchemaId, _selectedSchemaApiKey);

            UpdateEffectiveSchemaContext();
        }

        protected override async void OnLoad(EventArgs e)
        {
            base.OnLoad(e);
            
            if (DesignMode) return;

            try
            {
                string assetPath = AssetsManager.EnsureMonacoAssetsExtracted();
                AssetsManager.TryPreloadWebView2Loader(assetPath);

                string userDataFolder = Path.Combine(Path.GetDirectoryName(assetPath), "EdgeData");
                var env = await CoreWebView2Environment.CreateAsync(null, userDataFolder);
                
                await _webView.EnsureCoreWebView2Async(env);
                
                string url = "file:///" + assetPath.Replace('\\', '/') + "/index.html";
                _webView.CoreWebView2.Navigate(url);
            }
            catch (Exception ex)
            {
                Console.WriteLine("Error initializing MonacoEditor WebView2: " + ex.Message);
            }
        }

        private void WebView_NavigationCompleted(object sender, CoreWebView2NavigationCompletedEventArgs e)
        {
            if (e.IsSuccess)
            {
                _isReady = true;
                SQL = _cachedSql;
            }
        }

        private void WebView_WebMessageReceived(object sender, CoreWebView2WebMessageReceivedEventArgs e)
        {
            try
            {
                ProcessWebMessage(GetWebMessage(e));
            }
            catch
            {
                // Ignore parsing errors for unknown messages
            }
        }

        private static string GetWebMessage(CoreWebView2WebMessageReceivedEventArgs e)
        {
            try
            {
                return e.TryGetWebMessageAsString();
            }
            catch
            {
                return e.WebMessageAsJson;
            }
        }

        private void ProcessWebMessage(string message)
        {
            if (_updatingFromBrowser)
                return;

            if (message == null)
                return;

            if (message.StartsWith("00:", StringComparison.Ordinal))
            {
                _isReady = true;
                SQL = _cachedSql;
                return;
            }

            if (message.StartsWith("02:", StringComparison.Ordinal))
            {
                string requestId;
                int cursorOffset;
                string sql;
                if (TryParseAICompletionRequest(message.Substring(3), out requestId, out cursorOffset, out sql))
                    HandleAICompletionRequest(requestId, cursorOffset, sql);
                return;
            }

            if (!message.StartsWith("01:", StringComparison.Ordinal))
                return;

            UpdateCachedSqlFromBrowser(message.Substring(3));
        }

        private void AuthManager_AuthChanged(bool success)
        {
            if (InvokeRequired)
            {
                try
                {
                    Invoke(new Action(() => AuthManager_AuthChanged(success)));
                }
                catch
                {
                }
                return;
            }

            if (!EnableSqlAutocompleteUi)
                return;

            _aiSelectionControl.RefreshState();
            _schemaSelector.RefreshSchemas();
            LoadUserAgentsAsync();
        }

        private void ChkAiToggle_CheckedChanged(object sender, EventArgs e)
        {
            UpdateAutoCompleteOptionsLayout();
            if (_chkAiToggle.Checked)
                return;

            CancelAutoCompleteInference();
        }

        private void UpdateAutoCompleteOptionsLayout()
        {
            if (_aiSelectionControl == null)
                return;

            _aiSelectionControl.Visible = EnableSqlAutocompleteUi && _chkAiToggle.Checked;
        }

        private void SchemaSelector_SchemaChanged(object sender, EventArgs e)
        {
            UpdateEffectiveSchemaContext();
            SchemaContextChanged?.Invoke(this,
                new SqlSchemaContextChangedEventArgs(HubDatabaseId, HubSchemaId, EffectiveApiKey));
        }

        private void UpdateEffectiveSchemaContext()
        {
            if (EnableSqlAutocompleteUi)
            {
                HubDatabaseId = _schemaSelector.HubDatabaseId > 0 ? _schemaSelector.HubDatabaseId : _baseHubDatabaseId;
                HubSchemaId = (_schemaSelector.HubDatabaseId > 0 || _schemaSelector.HubSchemaId > 0)
                    ? _schemaSelector.HubSchemaId
                    : _baseHubSchemaId;
                return;
            }

            HubDatabaseId = _selectedHubDatabaseId > 0 ? _selectedHubDatabaseId : _baseHubDatabaseId;
            HubSchemaId = (_selectedHubDatabaseId > 0 || _selectedHubSchemaId > 0)
                ? _selectedHubSchemaId
                : _baseHubSchemaId;
        }

        private string EffectiveApiKey
        {
            get
            {
                if (EnableSqlAutocompleteUi)
                    return !string.IsNullOrWhiteSpace(_schemaSelector.SchemaApiKey) ? _schemaSelector.SchemaApiKey : ApiKey;

                return !string.IsNullOrWhiteSpace(_selectedSchemaApiKey) ? _selectedSchemaApiKey : ApiKey;
            }
        }

        private async void LoadUserAgentsAsync()
        {
            if (!EnableSqlAutocompleteUi || IsDisposed)
                return;

            try
            {
                string selectedTier = _aiSelectionControl.SelectedTier;
                long selectedAgentAiId = _aiSelectionControl.AgentAiId;
                _aiSelectionControl.ClearAgentEndpoints();

                if (string.IsNullOrWhiteSpace(RpAuthManager.Instance.Token))
                {
                    _aiSelectionControl.RestoreProviderSelection(selectedTier, selectedAgentAiId);
                    return;
                }

                var agents = await RpAuthManager.Instance.GetUserAgentsAsync();
                if (IsDisposed)
                    return;

                if (InvokeRequired)
                    Invoke(new Action(() => ApplyLoadedAgents(agents, selectedTier, selectedAgentAiId)));
                else
                    ApplyLoadedAgents(agents, selectedTier, selectedAgentAiId);
            }
            catch (Exception ex)
            {
                RpAuthManager.Instance.Log("LoadUserAgents Error: " + ex.Message);
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

                    if (!long.TryParse(parts[0], out long agentAiId))
                        agentAiId = 0;
                    string secret = parts[1];
                    bool isOnline = parts.Length >= 3 && parts[2] == "1";
                    if (isOnline)
                        _aiSelectionControl.AddAgentEndpoint(agentAiId, secret, displayName, true);
                }
            }

            _aiSelectionControl.RestoreProviderSelection(selectedTier, selectedAgentAiId);
        }

        private static bool TryParseAICompletionRequest(string payload, out string requestId,
            out int cursorOffset, out string sql)
        {
            requestId = "";
            cursorOffset = 0;
            sql = "";

            int headerEnd = payload.IndexOf('\n');
            if (headerEnd < 0)
                return false;

            string header = payload.Substring(0, headerEnd).TrimEnd('\r');
            int offsetSeparator = header.LastIndexOf(':');
            if (offsetSeparator <= 0)
                return false;

            requestId = header.Substring(0, offsetSeparator);
            if (requestId.Length == 0)
                return false;

            if (!int.TryParse(header.Substring(offsetSeparator + 1), out cursorOffset))
                cursorOffset = 0;

            sql = payload.Substring(headerEnd + 1);
            return true;
        }

        private void UpdateCachedSqlFromBrowser(string sql)
        {
            sql = NormalizeLineEndings(sql);
            if (string.Equals(_cachedSql, sql, StringComparison.Ordinal))
                return;

            _updatingFromBrowser = true;
            try
            {
                _cachedSql = sql;
                SqlContentChanged?.Invoke(this, EventArgs.Empty);
            }
            finally
            {
                _updatingFromBrowser = false;
            }
        }

        private void CancelAutoCompleteInference()
        {
            _debounceCts?.Cancel();
            _inferenceCts?.Cancel();
            SetInferenceProgress(false);
        }

        private async void HandleAICompletionRequest(string requestId, int cursorOffset, string sql)
        {
            if (string.IsNullOrWhiteSpace(requestId))
                return;

            if (!EnableSqlAutocompleteUi || !_chkAiToggle.Checked)
            {
                await SendEmptyAICompletionsAsync(requestId);
                return;
            }

            if (string.Equals(sql, _lastAutoCompleteSql, StringComparison.Ordinal))
            {
                await SendEmptyAICompletionsAsync(requestId);
                return;
            }

            _pendingRequestId = requestId;
            _pendingSql = sql ?? "";
            _pendingCursorPosition = cursorOffset;

            if (_isProcessingInference)
            {
                _inferenceCts?.Cancel();
                return;
            }

            _debounceCts?.Cancel();
            _debounceCts?.Dispose();
            _debounceCts = new CancellationTokenSource();

            try
            {
                await Task.Delay(AutoCompleteDebounceDelayMs, _debounceCts.Token);
            }
            catch (TaskCanceledException)
            {
                return;
            }

            await ProcessPendingInferenceAsync();
        }

        private async Task ProcessPendingInferenceAsync()
        {
            if (_isProcessingInference || string.IsNullOrWhiteSpace(_pendingRequestId))
                return;

            if (!EnableSqlAutocompleteUi || !_chkAiToggle.Checked)
            {
                string requestId = _pendingRequestId;
                _pendingRequestId = "";
                _pendingSql = "";
                _pendingCursorPosition = 0;
                await SendEmptyAICompletionsAsync(requestId);
                return;
            }

            string requestIdToProcess = _pendingRequestId;
            string sqlToProcess = _pendingSql;
            int cursorOffsetToProcess = _pendingCursorPosition;
            _lastAutoCompleteSql = sqlToProcess;
            await ProcessAutoCompleteInferenceAsync(requestIdToProcess, sqlToProcess, cursorOffsetToProcess);
        }

        private async Task ProcessAutoCompleteInferenceAsync(string requestId, string sql, int cursorOffset)
        {
            await _inferenceSemaphore.WaitAsync();
            _isProcessingInference = true;

            try
            {
                SetInferenceProgress(true);
                _aiSelectionControl.UpdateTokens(0, 0);

                _inferenceCts?.Cancel();
                _inferenceCts?.Dispose();
                _inferenceCts = new CancellationTokenSource(TimeSpan.FromSeconds(30));

                _agentClient.Token = RpAuthManager.Instance.Token;
                _agentClient.InstallId = RpAuthManager.Instance.InstallId;
                _agentClient.ApiKey = EffectiveApiKey;
                _agentClient.HubDatabaseId = HubDatabaseId;
                _agentClient.HubSchemaId = HubSchemaId;
                _agentClient.RuntimeDb = RuntimeDb;
                _agentClient.AITier = _aiSelectionControl.SelectedTier;

                if (string.Equals(_aiSelectionControl.SelectedTier, "LocalAgent", StringComparison.OrdinalIgnoreCase))
                {
                    _agentClient.AgentSecret = _aiSelectionControl.AgentSecret;
                    _agentClient.AgentAiId = _aiSelectionControl.AgentAiId;
                }
                else
                {
                    _agentClient.AgentSecret = "";
                    _agentClient.AgentAiId = 0;
                }

                JsonDocument result = await _agentClient.SuggestSqlAsync(
                    sql,
                    cursorOffset,
                    _aiSelectionControl.SelectedMode,
                    this,
                    (senderObj, actor, stage, chunkType, chunk, inTokens, outTokens, progId, prefill) =>
                    {
                        if (!string.Equals(actor, "AI", StringComparison.OrdinalIgnoreCase))
                            return;

                        if (IsDisposed)
                            return;

                        if (InvokeRequired)
                            BeginInvoke(new Action(() => UpdateInferenceTokens(inTokens, outTokens, progId, prefill, chunkType)));
                        else
                            UpdateInferenceTokens(inTokens, outTokens, progId, prefill, chunkType);
                    },
                    _inferenceCts.Token);

                if (result == null)
                {
                    await SendEmptyAICompletionsAsync(requestId);
                    return;
                }

                using (result)
                {
                    string responseJson = BuildAutoCompleteResponseJson(result);
                    if (string.IsNullOrWhiteSpace(responseJson))
                        await SendEmptyAICompletionsAsync(requestId);
                    else
                        await SendAICompletionsAsync(requestId, responseJson);
                }
            }
            catch (OperationCanceledException)
            {
                await SendEmptyAICompletionsAsync(requestId);
            }
            catch (Exception ex)
            {
                RpAuthManager.Instance.Log("SuggestSql Error: " + ex.Message);
                await SendEmptyAICompletionsAsync(requestId);
            }
            finally
            {
                SetInferenceProgress(false);
                _isProcessingInference = false;
                _inferenceSemaphore.Release();

                bool hasNewPendingRequest = !string.IsNullOrWhiteSpace(_pendingRequestId) &&
                    (!string.Equals(_pendingRequestId, requestId, StringComparison.Ordinal) ||
                     !string.Equals(_pendingSql, sql, StringComparison.Ordinal) ||
                     _pendingCursorPosition != cursorOffset);

                if (hasNewPendingRequest)
                    await ProcessPendingInferenceAsync();
            }
        }

        private void SetInferenceProgress(bool inferring)
        {
            if (IsDisposed)
                return;

            if (InvokeRequired)
            {
                BeginInvoke(new Action(() => _aiSelectionControl.SetInferenceProgress(inferring)));
                return;
            }

            _aiSelectionControl.SetInferenceProgress(inferring);
        }

        private void UpdateInferenceTokens(int inputTokens, int outputTokens, string progressId, int prefillPercent, string chunkType)
        {
            if (!string.IsNullOrWhiteSpace(progressId))
                _aiSelectionControl.TouchProgressToken(progressId);

            _aiSelectionControl.UpdateTokens(inputTokens, outputTokens, progressId, prefillPercent);

            if (string.Equals(chunkType, "End", StringComparison.OrdinalIgnoreCase) ||
                string.Equals(chunkType, "Full", StringComparison.OrdinalIgnoreCase))
            {
                _aiSelectionControl.FinishProgressToken(progressId);
            }
        }

        private static string BuildAutoCompleteResponseJson(JsonDocument result)
        {
            var inlineItems = new List<object>();
            var completionItems = new List<object>();

            if (TryGetProperty(result.RootElement, "result", out JsonElement resultElement) &&
                TryGetProperty(resultElement, "autoComplete", out JsonElement autoCompleteElement))
            {
                if (TryGetProperty(autoCompleteElement, "inlineCompletions", out JsonElement inlineCompletions) &&
                    inlineCompletions.ValueKind == JsonValueKind.Array)
                {
                    foreach (JsonElement item in inlineCompletions.EnumerateArray())
                    {
                        string text = JsonValueToString(item);
                        if (!string.IsNullOrWhiteSpace(text))
                            inlineItems.Add(new { insertText = text });
                    }
                }

                if (TryGetProperty(autoCompleteElement, "listCompletions", out JsonElement listCompletions) &&
                    listCompletions.ValueKind == JsonValueKind.Array)
                {
                    foreach (JsonElement item in listCompletions.EnumerateArray())
                    {
                        string text = JsonValueToString(item);
                        if (!string.IsNullOrWhiteSpace(text))
                        {
                            completionItems.Add(new
                            {
                                label = text,
                                insertText = text,
                                detail = "AI"
                            });
                        }
                    }
                }
            }

            return JsonSerializer.Serialize(new
            {
                inlineItems = inlineItems,
                completionItems = completionItems
            });
        }

        private static bool TryGetProperty(JsonElement element, string propertyName, out JsonElement value)
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

        private static string JsonValueToString(JsonElement value)
        {
            switch (value.ValueKind)
            {
                case JsonValueKind.String:
                    return value.GetString() ?? "";
                case JsonValueKind.Number:
                    return value.GetRawText();
                case JsonValueKind.True:
                    return "true";
                case JsonValueKind.False:
                    return "false";
                case JsonValueKind.Null:
                case JsonValueKind.Undefined:
                    return "";
                default:
                    return value.GetRawText().Trim('"');
            }
        }

        private async Task SendEmptyAICompletionsAsync(string requestId)
        {
            await SendAICompletionsAsync(requestId, "{\"inlineItems\":[],\"completionItems\":[]}");
        }

        public async Task SendAICompletionsAsync(string requestId, string responseJson)
        {
            if (!_isReady || _webView.CoreWebView2 == null)
                return;

            if (string.IsNullOrWhiteSpace(responseJson))
                responseJson = "{\"inlineItems\":[],\"completionItems\":[]}";

            string safeRequestId = JsonSerializer.Serialize(requestId ?? "");
            await _webView.ExecuteScriptAsync(
                $"if (window.receiveAICompletions) {{ window.receiveAICompletions({safeRequestId}, {responseJson}); }}");
        }

        private static string NormalizeLineEndings(string value)
        {
            if (value == null)
                return string.Empty;
            return value.Replace("\r\n", "\n").Replace("\r", "\n").Replace("\n", Environment.NewLine);
        }
        
        // Expose a method to get content asynchronously directly from Monaco if needed
        public async Task<string> GetSqlFromEditorAsync()
        {
            if (!_isReady || _webView.CoreWebView2 == null) return _cachedSql;
            string resultJson = await _webView.ExecuteScriptAsync("window.editor ? window.editor.getValue() : null");
            if (!string.IsNullOrWhiteSpace(resultJson) && !string.Equals(resultJson, "null", StringComparison.OrdinalIgnoreCase))
                _cachedSql = NormalizeLineEndings(JsonSerializer.Deserialize<string>(resultJson));
            return _cachedSql;
        }
    }
}
