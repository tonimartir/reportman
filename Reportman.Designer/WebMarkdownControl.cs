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
    public class WebMarkdownControl : UserControl
    {
        private WebView2 _webView;
        private bool _isReady;
        private List<string> _pendingScripts;
        
        public bool IsReady => _isReady;

        public WebMarkdownControl()
        {
            _pendingScripts = new List<string>();
            InitializeComponent();
        }

        private void InitializeComponent()
        {
            this.Size = new Size(600, 400);
            
            _webView = new WebView2
            {
                Dock = DockStyle.Fill,
                DefaultBackgroundColor = Color.Transparent
            };
            
            _webView.NavigationCompleted += WebView_NavigationCompleted;
            
            this.Controls.Add(_webView);
        }

        protected override async void OnLoad(EventArgs e)
        {
            base.OnLoad(e);
            
            if (DesignMode) return;

            try
            {
                string assetPath = AssetsManager.EnsureWebMarkdownAssetsExtracted();
                AssetsManager.TryPreloadWebView2Loader(assetPath);

                // Setup user data folder in the same parent dir to avoid access rights issues
                string userDataFolder = Path.Combine(Path.GetDirectoryName(assetPath), "EdgeData");
                var env = await CoreWebView2Environment.CreateAsync(null, userDataFolder);
                
                await _webView.EnsureCoreWebView2Async(env);
                
                string url = "file:///" + assetPath.Replace('\\', '/') + "/index.html";
                _webView.CoreWebView2.Navigate(url);
            }
            catch (Exception ex)
            {
                Console.WriteLine("Error initializing WebMarkdown WebView2: " + ex.Message);
            }
        }

        private void WebView_NavigationCompleted(object sender, CoreWebView2NavigationCompletedEventArgs e)
        {
            if (e.IsSuccess)
            {
                _isReady = true;
                FlushPendingScripts();
            }
            else
            {
                Console.WriteLine($"WebMarkdown Navigation Failed. Error: {e.WebErrorStatus}");
            }
        }

        private void ExecuteOrQueue(string script)
        {
            if (_isReady && _webView.CoreWebView2 != null)
            {
                _webView.ExecuteScriptAsync(script);
            }
            else
            {
                _pendingScripts.Add(script);
            }
        }

        private void FlushPendingScripts()
        {
            foreach (var script in _pendingScripts)
            {
                _webView.ExecuteScriptAsync(script);
            }
            _pendingScripts.Clear();
        }

        public void AppendMessage(string role, string markdown)
        {
            string safeRole = JsonSerializer.Serialize(role);
            string safeMd = JsonSerializer.Serialize(markdown);
            ExecuteOrQueue($"window.appendMessage({safeRole}, {safeMd});");
        }

        public void BeginStreaming(string role)
        {
            string safeRole = JsonSerializer.Serialize(role);
            ExecuteOrQueue($"window.beginStreaming({safeRole});");
        }

        public void AppendStreamingChunk(string role, string chunk, int prefillPercent)
        {
            string safeRole = JsonSerializer.Serialize(role);
            string safeChunk = JsonSerializer.Serialize(chunk);
            ExecuteOrQueue($"window.appendStreamingChunk({safeRole}, {safeChunk}, {prefillPercent});");
        }

        public void FinishStreaming()
        {
            ExecuteOrQueue("window.finishStreaming();");
        }

        public void ClearAll()
        {
            ExecuteOrQueue("window.clearAll();");
        }

        public void ScrollToEnd()
        {
            ExecuteOrQueue("window.scrollToEnd();");
        }
    }
}
