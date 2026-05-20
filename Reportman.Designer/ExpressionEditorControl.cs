using System;
using System.Drawing;
using System.Threading;
using System.Windows.Forms;
using Reportman.Reporting;

namespace Reportman.Designer
{
    public class ExpressionEditorControl : UserControl
    {
        private Panel _topPanel;
        private CheckBox _chkAiToggle;
        private Label _lblTitle;
        
        private MonacoEditorControl _monacoEditor;
        
        private System.Windows.Forms.Timer _debounceTimer;
        private ReportmanAgentClient _agentClient;
        private CancellationTokenSource _currentInferenceCts;

        public ExpressionEditorControl()
        {
            InitializeComponent();
            _agentClient = new ReportmanAgentClient();
            
            _debounceTimer = new System.Windows.Forms.Timer();
            _debounceTimer.Interval = 1000; // 1 second debounce
            _debounceTimer.Tick += DebounceTimer_Tick;
        }

        private void InitializeComponent()
        {
            this.Size = new Size(600, 400);
            
            _topPanel = new Panel { Dock = DockStyle.Top, Height = 40, Padding = new Padding(5) };
            
            _lblTitle = new Label 
            { 
                Text = "Expression Editor", 
                Dock = DockStyle.Left, 
                AutoSize = true,
                TextAlign = ContentAlignment.MiddleLeft,
                Font = new Font(this.Font, FontStyle.Bold)
            };
            
            _chkAiToggle = new CheckBox 
            { 
                Text = "AI Suggest", 
                Appearance = Appearance.Button, 
                Dock = DockStyle.Right, 
                Width = 100,
                TextAlign = ContentAlignment.MiddleCenter,
                Cursor = Cursors.Hand
            };
            
            _topPanel.Controls.Add(_lblTitle);
            _topPanel.Controls.Add(_chkAiToggle);
            
            _monacoEditor = new MonacoEditorControl { Dock = DockStyle.Fill };
            _monacoEditor.SqlContentChanged += MonacoEditor_ExpressionContentChanged;
            
            this.Controls.Add(_monacoEditor);
            this.Controls.Add(_topPanel);
        }

        private void MonacoEditor_ExpressionContentChanged(object sender, EventArgs e)
        {
            if (_chkAiToggle.Checked)
            {
                _debounceTimer.Stop();
                _debounceTimer.Start();
            }
        }

        private async void DebounceTimer_Tick(object sender, EventArgs e)
        {
            _debounceTimer.Stop();
            if (!_chkAiToggle.Checked) return;
            
            _currentInferenceCts?.Cancel();
            _currentInferenceCts = new CancellationTokenSource();
            
            try
            {
                string currentExpression = await _monacoEditor.GetSqlFromEditorAsync();
                int cursorPosition = currentExpression.Length; 
                string mode = "Expression"; // Specific mode for formulas/expressions
                
                var result = await _agentClient.SuggestSqlAsync(
                    currentExpression, 
                    cursorPosition, 
                    mode, 
                    this,
                    (senderObj, actor, stage, chunkType, chunk, inTokens, outTokens, progId, prefill) => 
                    {
                        // Progress visualization for expression completion
                    },
                    _currentInferenceCts.Token
                );

                if (result != null)
                {
                    // Success handling: Completion logic passes result back to Monaco via JS
                }
            }
            catch (OperationCanceledException)
            {
                // Cancelled due to user typing
            }
            catch (Exception ex)
            {
                Console.WriteLine("Expression AI Error: " + ex.Message);
            }
        }
        
        [System.ComponentModel.Browsable(false)]
        [System.ComponentModel.DesignerSerializationVisibility(System.ComponentModel.DesignerSerializationVisibility.Hidden)]
        public string Expression
        {
            get => _monacoEditor.SQL; // MonacoEditorControl reuses SQL property name
            set => _monacoEditor.SQL = value;
        }
    }
}
