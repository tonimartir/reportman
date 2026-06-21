using System;
using System.Drawing;
using System.Threading;
using System.Windows.Forms;
using Reportman.Reporting;

namespace Reportman.Designer
{
    /// <summary>
    /// Composite control that pairs a Monaco-based SQL editor with an AI schema selector
    /// and audit log, debouncing edits to request AI-powered SQL autocomplete from the
    /// Reportman agent.
    /// </summary>
    public class SQLEditorControl : UserControl
    {
        private TabControl _tabControl;
        private TabPage _tabSql;
        private TabPage _tabAudit;
        
        private Panel _topPanel;
        private AISchemaSelectorControl _schemaSelector;
        private CheckBox _chkAiToggle;
        
        private MonacoEditorControl _monacoEditor;
        
        private TextBox _txtAudit;
        
        private System.Windows.Forms.Timer _debounceTimer;
        private ReportmanAgentClient _agentClient;
        private CancellationTokenSource _currentInferenceCts;

        public SQLEditorControl()
        {
            InitializeComponent();
            _agentClient = new ReportmanAgentClient(); // Instantiation
            
            _debounceTimer = new System.Windows.Forms.Timer();
            _debounceTimer.Interval = 1000; // 1 second debounce
            _debounceTimer.Tick += DebounceTimer_Tick;
        }

        private void InitializeComponent()
        {
            this.Size = new Size(800, 600);
            
            _tabControl = new TabControl { Dock = DockStyle.Fill };
            _tabSql = new TabPage { Text = "SQL" };
            _tabAudit = new TabPage { Text = "Audit" };
            
            // Top Panel for SQL Tab
            _topPanel = new Panel { Dock = DockStyle.Top, Height = 55, Padding = new Padding(5) };
            
            _chkAiToggle = new CheckBox 
            { 
                Text = "AI Autocomplete", 
                Appearance = Appearance.Button, 
                Dock = DockStyle.Right, 
                Width = 120,
                TextAlign = ContentAlignment.MiddleCenter,
                Cursor = Cursors.Hand
            };
            
            _schemaSelector = new AISchemaSelectorControl { Dock = DockStyle.Left, Width = 300 };
            
            _topPanel.Controls.Add(_schemaSelector);
            _topPanel.Controls.Add(_chkAiToggle);
            
            // Monaco Editor
            _monacoEditor = new MonacoEditorControl { Dock = DockStyle.Fill };
            _monacoEditor.SqlContentChanged += MonacoEditor_SqlContentChanged;
            
            _tabSql.Controls.Add(_monacoEditor);
            _tabSql.Controls.Add(_topPanel);
            
            // Audit Tab
            _txtAudit = new TextBox 
            { 
                Multiline = true, 
                ScrollBars = ScrollBars.Vertical, 
                Dock = DockStyle.Fill,
                ReadOnly = true,
                BackColor = Color.Black,
                ForeColor = Color.Lime,
                Font = new Font("Consolas", 9f)
            };
            _tabAudit.Controls.Add(_txtAudit);
            
            _tabControl.TabPages.Add(_tabSql);
            _tabControl.TabPages.Add(_tabAudit);
            
            this.Controls.Add(_tabControl);
        }

        private void MonacoEditor_SqlContentChanged(object sender, EventArgs e)
        {
            if (_chkAiToggle.Checked)
            {
                // Restart debounce timer
                _debounceTimer.Stop();
                _debounceTimer.Start();
            }
        }

        private async void DebounceTimer_Tick(object sender, EventArgs e)
        {
            _debounceTimer.Stop();
            
            if (!_chkAiToggle.Checked) return;
            
            AppendAudit("Requesting AI completion...");
            
            // Cancel any pending inference
            _currentInferenceCts?.Cancel();
            _currentInferenceCts = new CancellationTokenSource();
            
            try
            {
                // We would normally extract the real cursor position and mode. 
                // Using dummy values for layout readiness.
                string currentSql = await _monacoEditor.GetSqlFromEditorAsync();
                int cursorPosition = currentSql.Length; // Fallback to end
                string mode = "Fast"; 
                
                // Ensure context is passed
                _agentClient.HubDatabaseId = _schemaSelector.HubDatabaseId;
                _agentClient.HubSchemaId = _schemaSelector.HubSchemaId;

                var result = await _agentClient.SuggestSqlAsync(
                    currentSql, 
                    cursorPosition, 
                    mode, 
                    this,
                    (senderObj, actor, stage, chunkType, chunk, inTokens, outTokens, progId, prefill) => 
                    {
                        // Handle streaming progress
                        // e.g. update status bar or audit logs
                    },
                    _currentInferenceCts.Token
                );

                if (result != null)
                {
                    // Pass the suggestion to Monaco's completion provider logic here 
                    // (Typically handled by sending a web message down to the javascript)
                    AppendAudit("Completion received.");
                }
            }
            catch (OperationCanceledException)
            {
                AppendAudit("Completion cancelled by user typing.");
            }
            catch (Exception ex)
            {
                AppendAudit("Error: " + ex.Message);
            }
        }

        private void AppendAudit(string message)
        {
            if (InvokeRequired)
            {
                Invoke(new Action(() => AppendAudit(message)));
                return;
            }
            _txtAudit.AppendText($"[{DateTime.Now:HH:mm:ss}] {message}{Environment.NewLine}");
        }
    }
}
