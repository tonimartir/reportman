using System;
using System.Drawing;
using System.Drawing.Drawing2D;
using System.Windows.Forms;

namespace Reportman.Designer
{
    /// <summary>
    /// Replicates Delphi's TFRpAISelectionVCL: 3-column grid with Provider/Mode combos
    /// and credit gauge, plus an inference progress mode with Stop/Tokens/Spinner.
    /// </summary>
    public class AISelectionControl : UserControl
    {
        // Non-inference mode controls
        private Panel _panelNonInference;
        private Label _lblProvider;
        private ComboBox _comboProvider;
        private Label _lblMode;
        private ComboBox _comboMode;
        private Panel _panelGauge;
        private int _creditPercent = 0;

        // Inference progress mode controls
        private Panel _panelInference;
        private Button _btnStop;
        private Label _lblTokens;
        private Panel _panelSpinner;
        private Timer _spinnerTimer;
        private int _spinnerAngle = 0;
        private int _tokensIn = 0;
        private int _tokensOut = 0;

        // State
        private bool _isInferring;

        // Events
        public event EventHandler StopRequested;

        public string SelectedTier
        {
            get
            {
                if (_comboProvider.SelectedIndex == 0) return "Standard";
                if (_comboProvider.SelectedIndex == 1) return "Precision";
                return "LocalAgent";
            }
        }

        public string SelectedMode
        {
            get { return _comboMode.SelectedIndex == 1 ? "Reasoning" : "Fast"; }
        }

        public AISelectionControl()
        {
            InitializeComponent();
        }

        private void InitializeComponent()
        {
            this.AutoSize = true;
            this.AutoSizeMode = AutoSizeMode.GrowAndShrink;

            // ===== NON-INFERENCE MODE =====
            // 3-column grid: Provider(50%) | Mode(50%) | Gauge(auto ~44px)
            TableLayoutPanel gridAI = new TableLayoutPanel
            {
                Dock = DockStyle.Fill,
                ColumnCount = 3,
                RowCount = 2,
                AutoSize = true,
                AutoSizeMode = AutoSizeMode.GrowAndShrink,
                Padding = new Padding(2)
            };
            gridAI.ColumnStyles.Add(new ColumnStyle(SizeType.Percent, 50f));
            gridAI.ColumnStyles.Add(new ColumnStyle(SizeType.Percent, 50f));
            gridAI.ColumnStyles.Add(new ColumnStyle(SizeType.Absolute, 44f));
            gridAI.RowStyles.Add(new RowStyle(SizeType.AutoSize));
            gridAI.RowStyles.Add(new RowStyle(SizeType.AutoSize));

            _lblProvider = new Label { Text = "PROVIDER", AutoSize = true, Font = new Font("Segoe UI", 8f) };
            _comboProvider = new ComboBox { DropDownStyle = ComboBoxStyle.DropDownList, Dock = DockStyle.Fill };
            _comboProvider.Items.AddRange(new object[] { "Standard", "Precision" });
            _comboProvider.SelectedIndex = 0;
            _comboProvider.SelectedIndexChanged += (s, e) => UpdateGaugeVisibility();

            _lblMode = new Label { Text = "MODE", AutoSize = true, Font = new Font("Segoe UI", 8f) };
            _comboMode = new ComboBox { DropDownStyle = ComboBoxStyle.DropDownList, Dock = DockStyle.Fill };
            _comboMode.Items.AddRange(new object[] { "Fast", "Reasoning" });
            _comboMode.SelectedIndex = 0;

            // Credit gauge panel (custom painted circle)
            _panelGauge = new Panel
            {
                Size = new Size(40, 40),
                MinimumSize = new Size(30, 30),
                Dock = DockStyle.Fill,
                Cursor = Cursors.Hand
            };
            _panelGauge.Paint += PanelGauge_Paint;
            var gaugeTooltip = new ToolTip();
            gaugeTooltip.SetToolTip(_panelGauge, "Credits");

            gridAI.Controls.Add(_lblProvider, 0, 0);
            gridAI.Controls.Add(_comboProvider, 0, 1);
            gridAI.Controls.Add(_lblMode, 1, 0);
            gridAI.Controls.Add(_comboMode, 1, 1);
            gridAI.Controls.Add(_panelGauge, 2, 0);
            gridAI.SetRowSpan(_panelGauge, 2);

            _panelNonInference = new Panel
            {
                Dock = DockStyle.Fill,
                AutoSize = true,
                AutoSizeMode = AutoSizeMode.GrowAndShrink
            };
            _panelNonInference.Controls.Add(gridAI);

            // ===== INFERENCE PROGRESS MODE =====
            // 3-column grid: Stop(auto) | TokenInfo(100%) | Spinner(auto ~44px)
            TableLayoutPanel gridInference = new TableLayoutPanel
            {
                Dock = DockStyle.Fill,
                ColumnCount = 3,
                RowCount = 1,
                AutoSize = true,
                AutoSizeMode = AutoSizeMode.GrowAndShrink,
                Padding = new Padding(2)
            };
            gridInference.ColumnStyles.Add(new ColumnStyle(SizeType.AutoSize));
            gridInference.ColumnStyles.Add(new ColumnStyle(SizeType.Percent, 100f));
            gridInference.ColumnStyles.Add(new ColumnStyle(SizeType.Absolute, 44f));
            gridInference.RowStyles.Add(new RowStyle(SizeType.AutoSize));

            _btnStop = new Button { Text = "Stop", AutoSize = true, MinimumSize = new Size(50, 30) };
            _btnStop.Click += (s, e) => StopRequested?.Invoke(this, EventArgs.Empty);

            _lblTokens = new Label
            {
                Text = "Tokens (In/Out): 0 / 0",
                TextAlign = ContentAlignment.MiddleCenter,
                Dock = DockStyle.Fill,
                AutoSize = false
            };

            _panelSpinner = new Panel
            {
                Size = new Size(34, 34),
                MinimumSize = new Size(30, 30),
                Dock = DockStyle.Fill
            };
            _panelSpinner.Paint += PanelSpinner_Paint;

            gridInference.Controls.Add(_btnStop, 0, 0);
            gridInference.Controls.Add(_lblTokens, 1, 0);
            gridInference.Controls.Add(_panelSpinner, 2, 0);

            _panelInference = new Panel
            {
                Dock = DockStyle.Fill,
                Visible = false,
                AutoSize = true,
                AutoSizeMode = AutoSizeMode.GrowAndShrink
            };
            _panelInference.Controls.Add(gridInference);

            // Spinner timer (90ms, 24° per tick like Delphi)
            _spinnerTimer = new Timer { Interval = 90, Enabled = false };
            _spinnerTimer.Tick += (s, e) =>
            {
                _spinnerAngle = (_spinnerAngle + 24) % 360;
                _panelSpinner.Invalidate();
            };

            // Wrap both modes in a container TableLayoutPanel
            TableLayoutPanel wrapper = new TableLayoutPanel
            {
                Dock = DockStyle.Fill,
                ColumnCount = 1,
                RowCount = 1,
                AutoSize = true,
                AutoSizeMode = AutoSizeMode.GrowAndShrink
            };
            wrapper.RowStyles.Add(new RowStyle(SizeType.AutoSize));
            wrapper.ColumnStyles.Add(new ColumnStyle(SizeType.Percent, 100f));

            // Both panels occupy the same cell; only one is visible at a time
            wrapper.Controls.Add(_panelNonInference, 0, 0);
            wrapper.Controls.Add(_panelInference, 0, 0);

            this.Controls.Add(wrapper);
        }

        private void UpdateGaugeVisibility()
        {
            // In Delphi, gauge is hidden when using agent endpoints (index >= 2)
            _panelGauge.Visible = _comboProvider.SelectedIndex < 2;
        }

        /// <summary>
        /// Switch between normal and inference-progress mode.
        /// </summary>
        public void SetInferenceProgress(bool inferring)
        {
            _isInferring = inferring;
            _panelNonInference.Visible = !inferring;
            _panelInference.Visible = inferring;
            _spinnerTimer.Enabled = inferring;

            if (inferring)
            {
                _spinnerAngle = 0;
                _tokensIn = 0;
                _tokensOut = 0;
                UpdateTokenLabel();
            }
        }

        /// <summary>
        /// Update token counters during inference.
        /// </summary>
        public void UpdateTokens(int tokensIn, int tokensOut)
        {
            _tokensIn = tokensIn;
            _tokensOut = tokensOut;
            if (InvokeRequired)
                Invoke(new Action(UpdateTokenLabel));
            else
                UpdateTokenLabel();
        }

        private void UpdateTokenLabel()
        {
            _lblTokens.Text = $"Tokens (In/Out): {_tokensIn} / {_tokensOut}";
        }

        /// <summary>
        /// Set credit gauge percentage (0-100).
        /// </summary>
        public void SetCreditPercent(int percent)
        {
            _creditPercent = Math.Max(0, Math.Min(100, percent));
            _panelGauge.Invalidate();
        }

        private void PanelGauge_Paint(object sender, PaintEventArgs e)
        {
            // Draw circular credit gauge (like Delphi's PaintBoxGaugePaint)
            var g = e.Graphics;
            g.SmoothingMode = SmoothingMode.AntiAlias;

            int size = Math.Min(_panelGauge.Width, _panelGauge.Height) - 4;
            if (size < 8) return;
            int x = (_panelGauge.Width - size) / 2;
            int y = (_panelGauge.Height - size) / 2;
            var rect = new Rectangle(x, y, size, size);

            // Background circle
            using (var bgPen = new Pen(Color.FromArgb(220, 220, 220), 3f))
                g.DrawEllipse(bgPen, rect);

            // Credit arc
            if (_creditPercent > 0)
            {
                Color arcColor;
                if (_creditPercent < 50) arcColor = Color.FromArgb(0x4C, 0xAF, 0x50); // Green
                else if (_creditPercent < 75) arcColor = Color.FromArgb(0xFF, 0xB3, 0x00); // Amber
                else if (_creditPercent < 90) arcColor = Color.FromArgb(0xFF, 0x98, 0x00); // Orange
                else arcColor = Color.FromArgb(0xF4, 0x43, 0x36); // Red

                float sweepAngle = _creditPercent * 3.6f;
                using (var arcPen = new Pen(arcColor, 3f))
                    g.DrawArc(arcPen, rect, -90, sweepAngle);
            }

            // Center text
            string pctText = $"{_creditPercent}%";
            using (var font = new Font("Segoe UI", 7f, FontStyle.Bold))
            {
                var textSize = g.MeasureString(pctText, font);
                g.DrawString(pctText, font, Brushes.DimGray,
                    x + (size - textSize.Width) / 2,
                    y + (size - textSize.Height) / 2);
            }
        }

        private void PanelSpinner_Paint(object sender, PaintEventArgs e)
        {
            // Draw spinning arc (like Delphi's PaintBoxProgressPaint)
            var g = e.Graphics;
            g.SmoothingMode = SmoothingMode.AntiAlias;

            int size = Math.Min(_panelSpinner.Width, _panelSpinner.Height) - 4;
            if (size < 8) return;
            int x = (_panelSpinner.Width - size) / 2;
            int y = (_panelSpinner.Height - size) / 2;
            var rect = new Rectangle(x, y, size, size);

            // Background circle
            using (var bgPen = new Pen(Color.FromArgb(220, 220, 220), 3f))
                g.DrawEllipse(bgPen, rect);

            // Spinning arc
            using (var arcPen = new Pen(Color.FromArgb(0x21, 0x96, 0xF3), 3f))
                g.DrawArc(arcPen, rect, _spinnerAngle, 90);
        }

        protected override void Dispose(bool disposing)
        {
            if (disposing)
            {
                _spinnerTimer?.Dispose();
            }
            base.Dispose(disposing);
        }

        // ===== Agent Endpoints (matching Delphi's FAISelection) =====

        /// <summary>
        /// Clear all agent endpoints from the Provider combo, keeping only Standard/Precision.
        /// </summary>
        public void ClearAgentEndpoints()
        {
            while (_comboProvider.Items.Count > 2)
                _comboProvider.Items.RemoveAt(_comboProvider.Items.Count - 1);
            _agentEndpoints.Clear();
        }

        /// <summary>
        /// Add an agent endpoint to the Provider combo (only if online).
        /// </summary>
        public void AddAgentEndpoint(long agentAiId, string agentSecret, string displayName, bool isOnline)
        {
            if (!isOnline) return;
            var info = new AgentEndpointInfo { AgentAiId = agentAiId, AgentSecret = agentSecret, DisplayName = displayName };
            _agentEndpoints.Add(info);
            _comboProvider.Items.Add(displayName);
        }

        /// <summary>
        /// Restore previous provider selection after reloading agents.
        /// </summary>
        public void RestoreProviderSelection(string selectedTier, long selectedAgentAiId)
        {
            if (selectedAgentAiId > 0)
            {
                for (int i = 0; i < _agentEndpoints.Count; i++)
                {
                    if (_agentEndpoints[i].AgentAiId == selectedAgentAiId)
                    {
                        _comboProvider.SelectedIndex = 2 + i;
                        return;
                    }
                }
            }
            // Fallback to Standard/Precision
            if (string.Equals(selectedTier, "Precision", StringComparison.OrdinalIgnoreCase))
                _comboProvider.SelectedIndex = 1;
            else
                _comboProvider.SelectedIndex = 0;
        }

        public int AgentEndpointCount { get { return _agentEndpoints.Count; } }

        public long AgentAiId
        {
            get
            {
                int idx = _comboProvider.SelectedIndex - 2;
                if (idx >= 0 && idx < _agentEndpoints.Count)
                    return _agentEndpoints[idx].AgentAiId;
                return 0;
            }
        }

        public string AgentSecret
        {
            get
            {
                int idx = _comboProvider.SelectedIndex - 2;
                if (idx >= 0 && idx < _agentEndpoints.Count)
                    return _agentEndpoints[idx].AgentSecret;
                return "";
            }
        }

        /// <summary>
        /// Refresh the credit gauge from RpAuthManager.
        /// </summary>
        public void RefreshCreditsFromAuth()
        {
            var auth = RpAuthManager.Instance;
            int pct = (int)(auth.GetCreditsRatio() * 100);
            SetCreditPercent(pct);
        }

        /// <summary>
        /// Refresh auth state (credits gauge, etc).
        /// </summary>
        public void RefreshState()
        {
            RefreshCreditsFromAuth();
        }

        private System.Collections.Generic.List<AgentEndpointInfo> _agentEndpoints =
            new System.Collections.Generic.List<AgentEndpointInfo>();

        private class AgentEndpointInfo
        {
            public long AgentAiId;
            public string AgentSecret;
            public string DisplayName;
        }
    }
}
