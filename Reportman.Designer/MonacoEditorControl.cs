using System;
using System.Collections.Generic;
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
                _cachedSql = value;
                if (_isReady && !_updatingFromBrowser && _webView.CoreWebView2 != null)
                {
                    string safeSql = JsonSerializer.Serialize(value);
                    _webView.ExecuteScriptAsync($"if (window.editor) {{ window.editor.setValue({safeSql}); }}");
                }
            }
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
                // Apply pending cached SQL
                if (!string.IsNullOrEmpty(_cachedSql))
                {
                    SQL = _cachedSql;
                }
            }
        }

        private void WebView_WebMessageReceived(object sender, CoreWebView2WebMessageReceivedEventArgs e)
        {
            try
            {
                string message = e.TryGetWebMessageAsString();
                
                // Assuming Monaco posts back { type: 'contentChanged', value: '...' } 
                // Wait, Delphi implementation says: 
                // if it's a JSON object we parse it.
                // Let's implement basic handling based on standard Monaco integration events
                
                using (var doc = JsonDocument.Parse(message))
                {
                    var root = doc.RootElement;
                    if (root.TryGetProperty("type", out var typeProp) && typeProp.GetString() == "contentChanged")
                    {
                        if (root.TryGetProperty("value", out var valProp))
                        {
                            _updatingFromBrowser = true;
                            _cachedSql = valProp.GetString() ?? "";
                            SqlContentChanged?.Invoke(this, EventArgs.Empty);
                            _updatingFromBrowser = false;
                        }
                    }
                }
            }
            catch 
            {
                // Ignore parsing errors for unknown messages
            }
        }
        
        // Expose a method to get content asynchronously directly from Monaco if needed
        public async Task<string> GetSqlFromEditorAsync()
        {
            if (!_isReady || _webView.CoreWebView2 == null) return _cachedSql;
            string resultJson = await _webView.ExecuteScriptAsync("window.editor ? window.editor.getValue() : ''");
            _cachedSql = JsonSerializer.Deserialize<string>(resultJson);
            return _cachedSql;
        }
    }
}
