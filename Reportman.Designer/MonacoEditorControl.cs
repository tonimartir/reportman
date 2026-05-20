using System;
using System.Drawing;
using System.IO;
using System.Text.Json;
using System.Threading.Tasks;
using System.Windows.Forms;
using Microsoft.Web.WebView2.Core;
using Microsoft.Web.WebView2.WinForms;

namespace Reportman.Designer
{
    public class MonacoEditorControl : UserControl
    {
        private WebView2 _webView;
        private bool _isReady;
        private string _cachedSql = string.Empty;
        private bool _updatingFromBrowser;
        
        public event EventHandler SqlContentChanged;
        
        public MonacoEditorControl()
        {
            InitializeComponent();
        }

        private void InitializeComponent()
        {
            this.Size = new Size(800, 600);
            
            _webView = new WebView2
            {
                Dock = DockStyle.Fill,
                DefaultBackgroundColor = Color.White
            };
            
            _webView.NavigationCompleted += WebView_NavigationCompleted;
            _webView.WebMessageReceived += WebView_WebMessageReceived;
            
            this.Controls.Add(_webView);
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

        public void SetHubContext(long hubDatabaseId, long hubSchemaId)
        {
            HubDatabaseId = hubDatabaseId;
            HubSchemaId = hubSchemaId;
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

            string newSql = null;

            using (JsonDocument doc = TryParseJson(message))
            {
                if (doc != null)
                {
                    JsonElement root = doc.RootElement;
                    if (root.ValueKind == JsonValueKind.Object)
                    {
                        string messageType = GetJsonString(root, "type");
                        if (string.Equals(messageType, "EDITOR_READY", StringComparison.OrdinalIgnoreCase))
                        {
                            _isReady = true;
                            SQL = _cachedSql;
                            return;
                        }

                        if (string.Equals(messageType, "GET_AI_COMPLETIONS", StringComparison.OrdinalIgnoreCase))
                        {
                            string requestId = GetJsonString(root, "requestId");
                            _ = SendEmptyAICompletionsAsync(requestId);
                            return;
                        }

                        if (string.Equals(messageType, "contentChanged", StringComparison.OrdinalIgnoreCase) ||
                            string.Equals(messageType, "CONTENT_CHANGED", StringComparison.OrdinalIgnoreCase))
                        {
                            newSql = GetFirstJsonString(root, "value", "sql", "code", "text");
                        }
                        else if (TryGetJsonProperty(root, "value", out JsonElement valueElement) &&
                            valueElement.ValueKind == JsonValueKind.String)
                        {
                            newSql = valueElement.GetString();
                        }
                    }
                    else if (root.ValueKind == JsonValueKind.String)
                    {
                        newSql = root.GetString();
                    }
                }
            }

            if (newSql == null)
                newSql = message;

            UpdateCachedSqlFromBrowser(newSql);
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

        private static JsonDocument TryParseJson(string value)
        {
            if (string.IsNullOrWhiteSpace(value))
                return null;

            try
            {
                return JsonDocument.Parse(value);
            }
            catch
            {
                return null;
            }
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
            if (!TryGetJsonProperty(element, propertyName, out JsonElement value) ||
                value.ValueKind == JsonValueKind.Null || value.ValueKind == JsonValueKind.Undefined)
                return "";

            return value.ValueKind == JsonValueKind.String ? value.GetString() ?? "" : value.GetRawText();
        }

        private static string GetFirstJsonString(JsonElement element, params string[] propertyNames)
        {
            foreach (string propertyName in propertyNames)
            {
                string value = GetJsonString(element, propertyName);
                if (value.Length > 0)
                    return value;
            }
            return "";
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
