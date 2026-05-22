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
        private static readonly object EnvironmentLock = new object();
        private static Task<CoreWebView2Environment> _sharedEnvironmentTask;

        private WebView2 _webView;
        private bool _isReady;
        private bool _initializationStarted;
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

        protected override void OnHandleCreated(EventArgs e)
        {
            base.OnHandleCreated(e);
            EnsureInitialized();
        }

        protected override void OnLoad(EventArgs e)
        {
            base.OnLoad(e);
            EnsureInitialized();
        }

        public void EnsureInitialized()
        {
            if (DesignMode || IsDisposed || _initializationStarted)
                return;

            _initializationStarted = true;
            _ = InitializeWebViewAsync();
        }

        private async Task InitializeWebViewAsync()
        {
            try
            {
                string assetPath = AssetsManager.EnsureWebMarkdownAssetsExtracted();
                AssetsManager.TryPreloadWebView2Loader(assetPath);

                _webView.CreateControl();
                var env = await GetSharedEnvironmentAsync(assetPath);
                if (IsDisposed)
                    return;
                
                await _webView.EnsureCoreWebView2Async(env);
                if (IsDisposed)
                    return;
                
                string url = "file:///" + assetPath.Replace('\\', '/') + "/index.html";
                _webView.CoreWebView2.Navigate(url);
            }
            catch (Exception ex)
            {
                Console.WriteLine("Error initializing WebMarkdown WebView2: " + ex.Message);
            }
        }

        private static Task<CoreWebView2Environment> GetSharedEnvironmentAsync(string assetPath)
        {
            lock (EnvironmentLock)
            {
                if (_sharedEnvironmentTask == null || _sharedEnvironmentTask.IsFaulted || _sharedEnvironmentTask.IsCanceled)
                {
                    string userDataFolder = Path.Combine(Path.GetDirectoryName(assetPath), "EdgeData");
                    _sharedEnvironmentTask = CoreWebView2Environment.CreateAsync(null, userDataFolder);
                }

                return _sharedEnvironmentTask;
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

        public void AppendLogLine(string text)
        {
            string safeText = JsonSerializer.Serialize(text ?? "");
            ExecuteOrQueue($"window.appendLogLine({safeText});");
        }

        public void AppendLogChunk(string chunk)
        {
            AppendLogChunkForKey("", chunk);
        }

        public void AppendLogChunkForKey(string key, string chunk)
        {
            string safeKey = JsonSerializer.Serialize(key ?? "");
            string safeChunk = JsonSerializer.Serialize(chunk ?? "");
            ExecuteOrQueue($"window.appendLogChunkForKey({safeKey}, {safeChunk});");
        }

        public void EndLogChunk()
        {
            EndLogChunkForKey("");
        }

        public void EndLogChunkForKey(string key)
        {
            string safeKey = JsonSerializer.Serialize(key ?? "");
            ExecuteOrQueue($"window.endLogChunkForKey({safeKey});");
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
