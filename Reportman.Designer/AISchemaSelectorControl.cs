using System;
using System.Collections.Generic;
using System.Drawing;
using System.Windows.Forms;

namespace Reportman.Designer
{
    /// <summary>
    /// Replicates Delphi's PSchemaHost layout:
    /// Row 0: "SCHEMA" label spanning full width (like PROVIDER/MODE labels)
    /// Row 1: [ComboBox (fill)] [Config ⚙ button] [Refresh button]
    /// </summary>
    public class AISchemaSelectorControl : UserControl
    {
        private Label _lblSchema;
        private ComboBox _comboSchema;
        private Button _btnConfig;
        private Button _btnRefresh;

        public event EventHandler SchemaChanged;

        public long HubDatabaseId { get; private set; }
        public long HubSchemaId { get; private set; }
        public string SchemaApiKey { get; private set; } = "";

        public AISchemaSelectorControl()
        {
            InitializeComponent();
        }

        private void InitializeComponent()
        {
            this.AutoSize = true;
            this.AutoSizeMode = AutoSizeMode.GrowAndShrink;

            TableLayoutPanel table = new TableLayoutPanel
            {
                Dock = DockStyle.Fill,
                ColumnCount = 3,
                RowCount = 2,
                AutoSize = true,
                AutoSizeMode = AutoSizeMode.GrowAndShrink,
                Padding = new Padding(2)
            };
            table.ColumnStyles.Add(new ColumnStyle(SizeType.Percent, 100f));
            table.ColumnStyles.Add(new ColumnStyle(SizeType.AutoSize));
            table.ColumnStyles.Add(new ColumnStyle(SizeType.AutoSize));
            table.RowStyles.Add(new RowStyle(SizeType.AutoSize));
            table.RowStyles.Add(new RowStyle(SizeType.AutoSize));

            _lblSchema = new Label
            {
                Text = "SCHEMA",
                AutoSize = true,
                Font = new Font("Segoe UI", 8f)
            };
            table.Controls.Add(_lblSchema, 0, 0);
            table.SetColumnSpan(_lblSchema, 3);

            _comboSchema = new ComboBox
            {
                DropDownStyle = ComboBoxStyle.DropDownList,
                Dock = DockStyle.Fill,
                Anchor = AnchorStyles.Left | AnchorStyles.Right
            };
            _comboSchema.Items.Add("Default / None");
            _comboSchema.SelectedIndex = 0;
            _comboSchema.SelectedIndexChanged += ComboSchema_SelectedIndexChanged;

            _btnConfig = new Button
            {
                Text = "⚙",
                MinimumSize = new Size(30, 23),
                MaximumSize = new Size(35, 25),
                Dock = DockStyle.Fill
            };
            _btnConfig.Click += BtnConfig_Click;
            var configTooltip = new ToolTip();
            configTooltip.SetToolTip(_btnConfig, "Configure DB Schemas");

            _btnRefresh = new Button
            {
                Text = "Refresh",
                MinimumSize = new Size(60, 23),
                MaximumSize = new Size(80, 25),
                Dock = DockStyle.Fill
            };
            _btnRefresh.Click += BtnRefresh_Click;

            table.Controls.Add(_comboSchema, 0, 1);
            table.Controls.Add(_btnConfig, 1, 1);
            table.Controls.Add(_btnRefresh, 2, 1);

            this.Controls.Add(table);
        }

        private void BtnConfig_Click(object sender, EventArgs e)
        {
            try
            {
                System.Diagnostics.Process.Start(new System.Diagnostics.ProcessStartInfo
                {
                    FileName = "https://app.reportman.es/database-config",
                    UseShellExecute = true
                });
            }
            catch { }
        }

        private void BtnRefresh_Click(object sender, EventArgs e)
        {
            // Trigger schema reload asynchronously
            LoadSchemasAsync();
        }

        private async void LoadSchemasAsync()
        {
            _btnRefresh.Enabled = false;
            try
            {
                var schemas = await RpAuthManager.Instance.GetUserSchemasAsync();
                ApplySchemas(schemas);
            }
            catch (Exception ex)
            {
                RpAuthManager.Instance.Log("Schema Refresh Error: " + ex.Message);
            }
            finally
            {
                _btnRefresh.Enabled = true;
            }
        }

        /// <summary>
        /// Apply loaded schemas to the combo. Called by AIChatPanelControl after loading.
        /// Format: "DisplayName=hubDatabaseId|hubSchemaId" or "DisplayName=hubDatabaseId|hubSchemaId|apiKey"
        /// </summary>
        public void ApplySchemas(List<string> schemas)
        {
            int prevSelected = _comboSchema.SelectedIndex;

            // Clear and add default
            ClearSchemaItems();
            _comboSchema.Items.Add("Default / None");

            if (schemas != null)
            {
                foreach (var entry in schemas)
                {
                    int eq = entry.IndexOf('=');
                    if (eq <= 0) continue;
                    string displayName = entry.Substring(0, eq);
                    string value = entry.Substring(eq + 1);
                    string[] parts = value.Split('|');

                    var item = new SchemaItem();
                    item.DisplayName = displayName;
                    if (parts.Length >= 1) item.HubDatabaseId = long.TryParse(parts[0], out var dbId) ? dbId : 0;
                    if (parts.Length >= 2) item.HubSchemaId = long.TryParse(parts[1], out var scId) ? scId : 0;
                    if (parts.Length >= 3) item.ApiKey = parts[2];

                    _comboSchema.Items.Add(item);
                }
            }

            // Restore selection if possible
            if (prevSelected >= 0 && prevSelected < _comboSchema.Items.Count)
                _comboSchema.SelectedIndex = prevSelected;
            else
                _comboSchema.SelectedIndex = 0;
        }

        private void ClearSchemaItems()
        {
            _comboSchema.Items.Clear();
            HubDatabaseId = 0;
            HubSchemaId = 0;
            SchemaApiKey = "";
        }

        private void ComboSchema_SelectedIndexChanged(object sender, EventArgs e)
        {
            if (_comboSchema.SelectedItem is SchemaItem si)
            {
                HubDatabaseId = si.HubDatabaseId;
                HubSchemaId = si.HubSchemaId;
                SchemaApiKey = si.ApiKey;
            }
            else
            {
                HubDatabaseId = 0;
                HubSchemaId = 0;
                SchemaApiKey = "";
            }
            SchemaChanged?.Invoke(this, EventArgs.Empty);
        }

        /// <summary>
        /// Schema data item for the combo box.
        /// </summary>
        private class SchemaItem
        {
            public string DisplayName;
            public long HubDatabaseId;
            public long HubSchemaId;
            public string ApiKey = "";

            public override string ToString() { return DisplayName; }
        }
    }
}
