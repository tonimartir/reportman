using System;
using System.Collections.Generic;
using System.ComponentModel;
using System.Drawing;
using System.Text.Json;
using System.Threading;
using System.Threading.Tasks;
using System.Windows.Forms;
using Reportman.Reporting;

namespace Reportman.Designer
{
    public class ExpressionChatPanelControl : UserControl
    {
        public delegate bool ValidateExpressionHandler(string expression, out string errorMessage);

        private AILoginFrameControl _loginControl;
        private AISelectionControl _aiSelectionControl;
        private WebMarkdownControl _conversation;
        private Panel _bottomPanel;
        private Panel _buttonPanel;
        private TextBox _promptText;
        private Button _sendButton;
        private Button _applyButton;
        private Button _clearButton;
        private ReportmanAgentClient _agentClient;
        private CancellationTokenSource _cts;
        private bool _isBusy;
        private string _suggestedExpression = "";
        private string _currentExpression = "";

        public event EventHandler<string> ApplySuggestion;

        [Browsable(false)]
        [DesignerSerializationVisibility(DesignerSerializationVisibility.Hidden)]
        public Func<string> CurrentExpressionProvider { get; set; }

        [Browsable(false)]
        [DesignerSerializationVisibility(DesignerSerializationVisibility.Hidden)]
        public Func<int> CursorPositionProvider { get; set; }

        [Browsable(false)]
        [DesignerSerializationVisibility(DesignerSerializationVisibility.Hidden)]
        public Func<string> SemanticContextProvider { get; set; }

        [Browsable(false)]
        [DesignerSerializationVisibility(DesignerSerializationVisibility.Hidden)]
        public ValidateExpressionHandler ValidateExpression { get; set; }

        public ExpressionChatPanelControl()
        {
            InitializeComponent();

            _agentClient = new ReportmanAgentClient();
            _agentClient.LogMessage += LogClientMessage;
            RpAuthManager.Instance.AuthChanged += OnAuthChanged;
            HandleCreated += (s, e) => StartOnlineInitialization();
        }

        protected override void Dispose(bool disposing)
        {
            if (disposing)
            {
                RpAuthManager.Instance.AuthChanged -= OnAuthChanged;
                if (_agentClient != null)
                    _agentClient.LogMessage -= LogClientMessage;
                if (_cts != null)
                    _cts.Dispose();
            }
            base.Dispose(disposing);
        }

        private void InitializeComponent()
        {
            MinimumSize = new Size(300, 350);

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

            TableLayoutPanel topPanel = new TableLayoutPanel
            {
                Dock = DockStyle.Top,
                ColumnCount = 1,
                RowCount = 2,
                AutoSize = true,
                AutoSizeMode = AutoSizeMode.GrowAndShrink
            };
            topPanel.ColumnStyles.Add(new ColumnStyle(SizeType.Percent, 100f));
            topPanel.RowStyles.Add(new RowStyle(SizeType.AutoSize));
            topPanel.RowStyles.Add(new RowStyle(SizeType.AutoSize));
            topPanel.Controls.Add(_loginControl, 0, 0);
            topPanel.Controls.Add(_aiSelectionControl, 0, 1);

            _conversation = new WebMarkdownControl { Dock = DockStyle.Fill };

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

            Controls.Add(_conversation);
            Controls.Add(_bottomPanel);
            Controls.Add(topPanel);
        }

        public void Initialize(string currentExpression, string initialAssistantMessage)
        {
            _currentExpression = currentExpression ?? "";
            _suggestedExpression = "";
            _promptText.Clear();
            _conversation.ClearAll();
            if (!string.IsNullOrWhiteSpace(initialAssistantMessage))
                _conversation.AppendMessage("assistant", initialAssistantMessage);
            UpdateButtons();
        }

        public void SetCurrentExpression(string expression)
        {
            _currentExpression = expression ?? "";
        }

        private void OnAuthChanged(bool success)
        {
            if (InvokeRequired)
            {
                try { Invoke(new Action(() => OnAuthChanged(success))); } catch { }
                return;
            }

            _aiSelectionControl.RefreshState();
            LoadUserAgentsAsync();
        }

        private void StartOnlineInitialization()
        {
            _aiSelectionControl.RefreshState();
            if (RpAuthManager.Instance.IsLoggedIn)
            {
                RpAuthManager.Instance.RefreshStatusInBackground();
                LoadUserAgentsAsync();
            }
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
                LogClientMessage("LoadUserAgents Error: " + ex.Message);
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
            _applyButton.Enabled = !_isBusy && !string.IsNullOrWhiteSpace(_suggestedExpression);
            _clearButton.Text = _isBusy ? "Stop" : "Clear";
        }

        private void SetBusy(bool busy)
        {
            _isBusy = busy;
            _promptText.Enabled = !busy;
            _aiSelectionControl.SetInferenceProgress(busy);
            UpdateButtons();
        }

        private void ApplyButton_Click(object sender, EventArgs e)
        {
            if (!string.IsNullOrWhiteSpace(_suggestedExpression))
                ApplySuggestion?.Invoke(this, _suggestedExpression);
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
            _suggestedExpression = "";
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
            _suggestedExpression = "";
            SetBusy(true);
            _cts = new CancellationTokenSource();

            AICopilotManager.Instance.OnCancelRequested = StopInference;
            AICopilotManager.Instance.BeginInference();

            try
            {
                string currentExpression = CurrentExpressionProvider != null ? CurrentExpressionProvider() : _currentExpression;
                int cursorPosition = CursorPositionProvider != null ? CursorPositionProvider() : currentExpression.Length;
                string semanticContextJson = SemanticContextProvider != null ? SemanticContextProvider() : "{}";

                SafeAppendMessage("user", prompt);

                SuggestionResult result = await RequestSuggestionAsync(prompt, currentExpression, false, cursorPosition, semanticContextJson, _cts.Token);
                if (!result.Success)
                {
                    SafeAppendMessage("system", result.ErrorMessage);
                    return;
                }

                string validationError;
                if (!ValidateSuggestedExpression(result.Expression, out validationError))
                {
                    SafeAppendMessage("system", "Local validation failed. Retrying once: " + validationError);
                    result = await RequestSuggestionAsync(prompt, result.Expression, true, cursorPosition, semanticContextJson, _cts.Token);
                    if (!result.Success)
                    {
                        SafeAppendMessage("system", result.ErrorMessage);
                        return;
                    }

                    if (!ValidateSuggestedExpression(result.Expression, out validationError))
                    {
                        string retryMessage = "Generated expression is still invalid after one automatic fix: " + validationError;
                        if (!string.IsNullOrWhiteSpace(result.Explanation))
                            retryMessage += Environment.NewLine + Environment.NewLine + result.Explanation;
                        retryMessage += Environment.NewLine + Environment.NewLine + "You can still apply it and edit it manually.";
                        SetSuggestedExpression(result.Expression, retryMessage);
                        return;
                    }

                    SetSuggestedExpression(result.Expression,
                        string.IsNullOrWhiteSpace(result.Explanation)
                            ? "Expression fixed after local validation."
                            : "Expression fixed after local validation." + Environment.NewLine + Environment.NewLine + result.Explanation);
                    return;
                }

                SetSuggestedExpression(result.Expression,
                    string.IsNullOrWhiteSpace(result.Explanation) ? "Expression generated." : result.Explanation);
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

        private async Task<SuggestionResult> RequestSuggestionAsync(string prompt, string currentExpression, bool fix,
            int cursorPosition, string semanticContextJson, CancellationToken cancellationToken)
        {
            ConfigureAgentClient();
            _conversation.BeginStreaming("agent");
            JsonDocument resultDoc = null;
            try
            {
                resultDoc = await _agentClient.SuggestExpressionAsync(
                    prompt,
                    currentExpression,
                    fix,
                    cursorPosition,
                    _aiSelectionControl.SelectedMode,
                    semanticContextJson,
                    this,
                    (senderObj, actor, stage, chunkType, chunk, inputTokens, outputTokens, progressId, prefillPercent) =>
                    {
                        if (string.Equals(stage, "ReceivingResponse", StringComparison.OrdinalIgnoreCase) &&
                            string.Equals(chunkType, "Partial", StringComparison.OrdinalIgnoreCase))
                            SafeAppendStreamingChunk(chunk, prefillPercent);

                        _aiSelectionControl.UpdateTokens(inputTokens, outputTokens);
                    },
                    cancellationToken);

                return ExtractSuggestionResult(resultDoc);
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
            _agentClient.ApiKey = "";
            _agentClient.HubDatabaseId = 0;
            _agentClient.HubSchemaId = 0;

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

        private bool ValidateSuggestedExpression(string expression, out string errorMessage)
        {
            if (ValidateExpression != null)
                return ValidateExpression(expression, out errorMessage);

            errorMessage = "";
            bool result = !string.IsNullOrWhiteSpace(expression);
            if (!result)
                errorMessage = "Empty expression returned";
            return result;
        }

        private void SetSuggestedExpression(string expression, string message)
        {
            _suggestedExpression = expression ?? "";
            string text = string.IsNullOrWhiteSpace(message) ? "Suggested expression:" : message + Environment.NewLine + Environment.NewLine + "Suggested expression:";
            text += Environment.NewLine + "```reportman" + Environment.NewLine + _suggestedExpression + Environment.NewLine + "```";
            SafeAppendMessage("assistant", text);
            UpdateButtons();
        }

        private SuggestionResult ExtractSuggestionResult(JsonDocument resultDoc)
        {
            SuggestionResult result = new SuggestionResult();
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
            if (TryGetJsonProperty(root, "result", out JsonElement nestedResult) && nestedResult.ValueKind == JsonValueKind.Object)
                resultElement = nestedResult;

            string resultError = GetJsonString(resultElement, "errorMessage");
            if (!string.IsNullOrWhiteSpace(resultError))
            {
                result.ErrorMessage = resultError;
                return result;
            }

            result.Expression = GetJsonString(resultElement, "expression");
            result.Explanation = GetJsonString(resultElement, "explanation");

            if (string.IsNullOrWhiteSpace(result.Expression))
            {
                result.ErrorMessage = string.IsNullOrWhiteSpace(result.Explanation)
                    ? "Empty expression returned"
                    : result.Explanation;
            }

            return result;
        }

        private void SafeAppendMessage(string role, string text)
        {
            if (InvokeRequired)
                Invoke(new Action(() => _conversation.AppendMessage(role, text ?? "")));
            else
                _conversation.AppendMessage(role, text ?? "");
        }

        private void SafeAppendStreamingChunk(string chunk, int prefillPercent)
        {
            if (InvokeRequired)
                Invoke(new Action(() => _conversation.AppendStreamingChunk("assistant", chunk ?? "", prefillPercent)));
            else
                _conversation.AppendStreamingChunk("assistant", chunk ?? "", prefillPercent);
        }

        private void LogClientMessage(string message)
        {
            System.Diagnostics.Debug.WriteLine("ExpressionChat: " + message);
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

        private class SuggestionResult
        {
            public string Expression = "";
            public string Explanation = "";
            public string ErrorMessage = "";
            public bool Success { get { return string.IsNullOrEmpty(ErrorMessage); } }
        }
    }
}