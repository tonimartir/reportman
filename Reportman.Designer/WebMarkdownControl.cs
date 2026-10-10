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
    /// <summary>
    /// WebView2-hosted control that renders chat conversations and log output as
    /// Markdown, supporting incremental streaming of assistant messages and log
    /// chunks into the embedded page.
    /// </summary>
    public class WebMarkdownControl : UserControl
    {
        private static readonly object EnvironmentLock = new object();
        private static Task<CoreWebView2Environment> _sharedEnvironmentTask;

        private WebView2 _webView;
        private bool _isReady;
        private bool _initializationStarted;
        private List<string> _pendingScripts;
        
        /// <summary>
        /// Gets a value indicating whether the embedded page has finished loading
        /// and is ready to receive script calls. Scripts issued before this becomes
        /// true are queued and flushed once navigation completes.
        /// </summary>
        public bool IsReady => _isReady;

        /// <summary>
        /// Initializes a new instance of the <see cref="WebMarkdownControl"/> class
        /// and builds the hosted WebView2 control.
        /// </summary>
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

        /// <summary>
        /// Raises the HandleCreated event and ensures WebView2 is initialized.
        /// </summary>
        /// <param name="e">An <see cref="EventArgs"/> that contains the event data.</param>
        protected override void OnHandleCreated(EventArgs e)
        {
            base.OnHandleCreated(e);
            EnsureInitialized();
        }

        /// <summary>
        /// Raises the Load event and ensures WebView2 is initialized.
        /// </summary>
        /// <param name="e">An <see cref="EventArgs"/> that contains the event data.</param>
        protected override void OnLoad(EventArgs e)
        {
            base.OnLoad(e);
            EnsureInitialized();
        }

        /// <summary>
        /// Ensures that the WebView2 control is initialized, starting the initialization process if it hasn't been started.
        /// </summary>
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
                _webView.ExecuteScriptAsync(BuildLocalizationScript());
                FlushPendingScripts();
            }
            else
            {
                Console.WriteLine($"WebMarkdown Navigation Failed. Error: {e.WebErrorStatus}");
            }
        }

        /// <summary>
        /// index.html writes its labels in English (the copy button, the message titles and the
        /// thinking blocks): the script puts the designer's translations in their place, also in the
        /// messages added later.
        /// </summary>
        private static string BuildLocalizationScript()
        {
            string labels = JsonSerializer.Serialize(new Dictionary<string, string>
            {
                { "copyAll", DesignerText.Tr(1940) },
                { "copied", DesignerText.Tr(1941) },
                { "You", DesignerText.Tr(1942) },
                { "Assistant", DesignerText.Tr(1943) },
                { "thinking", DesignerText.Tr(1944) }
            });
            return @"(function (L) {
    var btn = document.getElementById('copy-btn');
    if (btn && btn.lastChild)
        btn.lastChild.textContent = ' ' + L.copyAll;
    // The same as index.html, with the translated confirmation
    window.showCopySuccess = function (b) {
        var span = b.querySelector('span');
        var icon = span.textContent;
        var text = b.lastChild.textContent;
        span.textContent = '✅';
        b.lastChild.textContent = ' ' + L.copied;
        b.classList.add('copy-success');
        setTimeout(function () {
            span.textContent = icon;
            b.lastChild.textContent = text;
            b.classList.remove('copy-success');
        }, 2000);
    };
    function translate(node) {
        if (!node || node.nodeType !== 1)
            return;
        var titles = node.querySelectorAll('.msg-header > span:last-child');
        for (var i = 0; i < titles.length; i++) {
            var title = titles[i].textContent;
            if ((title === 'You' || title === 'Assistant') && L[title] !== title)
                titles[i].textContent = L[title];
        }
        var thinking = node.querySelectorAll('details.think-block > summary');
        for (var j = 0; j < thinking.length; j++) {
            var summary = thinking[j].textContent;
            if (summary.indexOf('Thinking...') >= 0 && L.thinking !== 'Thinking...')
                thinking[j].textContent = summary.replace('Thinking...', L.thinking);
        }
    }
    var messages = document.getElementById('messages');
    if (!messages)
        return;
    translate(messages);
    new MutationObserver(function (records) {
        for (var r = 0; r < records.length; r++)
            for (var k = 0; k < records[r].addedNodes.length; k++)
                translate(records[r].addedNodes[k]);
    }).observe(messages, { childList: true, subtree: true });
})(" + labels + ");";
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

        /// <summary>
        /// Appends a static markdown message to the web view.
        /// </summary>
        /// <param name="role">The role of the sender (e.g., user, assistant).</param>
        /// <param name="markdown">The markdown text content of the message.</param>
        public void AppendMessage(string role, string markdown)
        {
            string safeRole = JsonSerializer.Serialize(role);
            string safeMd = JsonSerializer.Serialize(markdown);
            ExecuteOrQueue($"window.appendMessage({safeRole}, {safeMd});");
        }

        /// <summary>
        /// Prepares the web view to begin receiving streaming markdown content for a role.
        /// </summary>
        /// <param name="role">The role of the sender for the streaming content.</param>
        public void BeginStreaming(string role)
        {
            string safeRole = JsonSerializer.Serialize(role);
            ExecuteOrQueue($"window.beginStreaming({safeRole});");
        }

        /// <summary>
        /// Appends a chunk of streaming markdown text to the active streaming message.
        /// </summary>
        /// <param name="role">The role of the sender.</param>
        /// <param name="chunk">The chunk of markdown text to append.</param>
        /// <param name="prefillPercent">A percentage or value related to prefilling or progress.</param>
        public void AppendStreamingChunk(string role, string chunk, int prefillPercent)
        {
            string safeRole = JsonSerializer.Serialize(role);
            string safeChunk = JsonSerializer.Serialize(chunk);
            ExecuteOrQueue($"window.appendStreamingChunk({safeRole}, {safeChunk}, {prefillPercent});");
        }

        /// <summary>
        /// Finishes the current streaming message session.
        /// </summary>
        public void FinishStreaming()
        {
            ExecuteOrQueue("window.finishStreaming();");
        }

        /// <summary>
        /// Appends a single line of log text to the view.
        /// </summary>
        /// <param name="text">The log text to append.</param>
        public void AppendLogLine(string text)
        {
            string safeText = JsonSerializer.Serialize(text ?? "");
            ExecuteOrQueue($"window.appendLogLine({safeText});");
        }

        /// <summary>
        /// Appends a chunk of log text to the view.
        /// </summary>
        /// <param name="chunk">The log chunk text to append.</param>
        public void AppendLogChunk(string chunk)
        {
            AppendLogChunkForKey("", chunk);
        }

        /// <summary>
        /// Appends a chunk of log text associated with a specific key.
        /// </summary>
        /// <param name="key">The key identifying the log stream or section.</param>
        /// <param name="chunk">The log chunk text to append.</param>
        public void AppendLogChunkForKey(string key, string chunk)
        {
            string safeKey = JsonSerializer.Serialize(key ?? "");
            string safeChunk = JsonSerializer.Serialize(chunk ?? "");
            ExecuteOrQueue($"window.appendLogChunkForKey({safeKey}, {safeChunk});");
        }

        /// <summary>
        /// Ends the active log chunk stream.
        /// </summary>
        public void EndLogChunk()
        {
            EndLogChunkForKey("");
        }

        /// <summary>
        /// Ends the log chunk stream associated with the specified key.
        /// </summary>
        /// <param name="key">The key identifying the log stream or section.</param>
        public void EndLogChunkForKey(string key)
        {
            string safeKey = JsonSerializer.Serialize(key ?? "");
            ExecuteOrQueue($"window.endLogChunkForKey({safeKey});");
        }

        /// <summary>
        /// Clears all messages and log content from the web view.
        /// </summary>
        public void ClearAll()
        {
            ExecuteOrQueue("window.clearAll();");
        }

        /// <summary>
        /// Scrolls the web view document to the end of the page.
        /// </summary>
        public void ScrollToEnd()
        {
            ExecuteOrQueue("window.scrollToEnd();");
        }
    }
}
