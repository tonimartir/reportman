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
        private bool _suppressSchemaChanged;
        private long _preferredHubDatabaseId;
        private long _preferredHubSchemaId;
        private string _preferredApiKey = "";
        private long _preferredConnectionHubDatabaseId;
        private string _preferredConnectionApiKey = "";

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
            RefreshSchemas();
        }

        private async void LoadSchemasAsync()
        {
            _btnRefresh.Enabled = false;
            try
            {
                var mergedSchemas = new List<string>();
                var seenSchemaKeys = new HashSet<string>(StringComparer.OrdinalIgnoreCase);

                if (!string.IsNullOrWhiteSpace(_preferredConnectionApiKey))
                {
                    var apiKeySchemas = await RpAuthManager.Instance.GetApiKeySchemasAsync(_preferredConnectionApiKey);
                    AddMergedSchemas(apiKeySchemas, mergedSchemas, seenSchemaKeys, _preferredConnectionApiKey);
                }

                var userSchemas = await RpAuthManager.Instance.GetUserSchemasAsync();
                AddMergedSchemas(userSchemas, mergedSchemas, seenSchemaKeys, "");

                if (!IsDisposed)
                    ApplySchemas(mergedSchemas);
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

        public void RefreshSchemas()
        {
            LoadSchemasAsync();
        }

        /// <summary>
        /// Apply loaded schemas to the combo. Called by AIChatPanelControl after loading.
        /// Format: "DisplayName=hubDatabaseId|hubSchemaId" or "DisplayName=hubDatabaseId|hubSchemaId|apiKey"
        /// </summary>
        public void ApplySchemas(List<string> schemas)
        {
            long previousHubDatabaseId = HubDatabaseId;
            long previousHubSchemaId = HubSchemaId;
            string previousApiKey = SchemaApiKey;
            if (_preferredHubDatabaseId == 0 && _preferredHubSchemaId == 0)
            {
                _preferredHubDatabaseId = previousHubDatabaseId;
                _preferredHubSchemaId = previousHubSchemaId;
                _preferredApiKey = previousApiKey;
            }

            // Clear and add default
            _suppressSchemaChanged = true;
            try
            {
                ClearSchemaItems();
                _comboSchema.Items.Add("Default / None");

                if (schemas != null)
                {
                    var preferredItems = new List<SchemaItem>();
                    var otherItems = new List<SchemaItem>();

                    foreach (var entry in schemas)
                    {
                        if (!TryParseSchemaEntry(entry, out var item))
                            continue;

                        if (_preferredConnectionHubDatabaseId != 0 && item.HubDatabaseId == _preferredConnectionHubDatabaseId)
                            preferredItems.Add(item);
                        else
                            otherItems.Add(item);
                    }

                    AddSchemaItems(preferredItems);
                    AddSchemaItems(otherItems);
                }

                if (!SelectPreferredSchema())
                    _comboSchema.SelectedIndex = 0;
            }
            finally
            {
                _suppressSchemaChanged = false;
            }

            ApplySelectedSchema();
        }

        public void SetPreferredConnection(long hubDatabaseId, string apiKey = "")
        {
            _preferredConnectionHubDatabaseId = hubDatabaseId;
            _preferredConnectionApiKey = (apiKey ?? "").Trim();
        }

        public void SetHubContext(long hubDatabaseId, long hubSchemaId, string apiKey = "")
        {
            _preferredHubDatabaseId = hubDatabaseId;
            _preferredHubSchemaId = hubSchemaId;
            _preferredApiKey = apiKey ?? "";

            _suppressSchemaChanged = true;
            try
            {
                if (!SelectPreferredSchema() && _comboSchema.Items.Count > 0)
                    _comboSchema.SelectedIndex = 0;
            }
            finally
            {
                _suppressSchemaChanged = false;
            }

            ApplySelectedSchema();
        }

        private static void AddMergedSchemas(IEnumerable<string> source, List<string> destination,
            HashSet<string> seenSchemaKeys, string defaultApiKey)
        {
            if (source == null)
                return;

            foreach (var entry in source)
            {
                if (!TryParseSchemaEntry(entry, out var item))
                    continue;

                string schemaKey = item.HubDatabaseId.ToString() + "|" + item.HubSchemaId.ToString();
                if (!seenSchemaKeys.Add(schemaKey))
                    continue;

                string apiKey = string.IsNullOrWhiteSpace(item.ApiKey) ? defaultApiKey : item.ApiKey;
                destination.Add(item.DisplayName + "=" + item.HubDatabaseId + "|" + item.HubSchemaId + "|" + apiKey);
            }
        }

        private void AddSchemaItems(IEnumerable<SchemaItem> items)
        {
            foreach (var item in items)
                _comboSchema.Items.Add(item);
        }

        private static bool TryParseSchemaEntry(string entry, out SchemaItem item)
        {
            item = null;

            if (string.IsNullOrWhiteSpace(entry))
                return false;

            int eq = entry.IndexOf('=');
            if (eq <= 0)
                return false;

            string displayName = entry.Substring(0, eq);
            string value = entry.Substring(eq + 1);
            string[] parts = value.Split('|');

            item = new SchemaItem();
            item.DisplayName = displayName;
            if (parts.Length >= 1) item.HubDatabaseId = long.TryParse(parts[0], out var dbId) ? dbId : 0;
            if (parts.Length >= 2) item.HubSchemaId = long.TryParse(parts[1], out var scId) ? scId : 0;
            if (parts.Length >= 3) item.ApiKey = parts[2];
            return true;
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
            ApplySelectedSchema();
            if (!_suppressSchemaChanged)
                SchemaChanged?.Invoke(this, EventArgs.Empty);
        }

        private void ApplySelectedSchema()
        {
            if (_comboSchema.SelectedItem is SchemaItem si)
            {
                HubDatabaseId = si.HubDatabaseId;
                HubSchemaId = si.HubSchemaId;
                SchemaApiKey = si.ApiKey;
                _preferredHubDatabaseId = si.HubDatabaseId;
                _preferredHubSchemaId = si.HubSchemaId;
                _preferredApiKey = si.ApiKey;
            }
            else
            {
                HubDatabaseId = 0;
                HubSchemaId = 0;
                SchemaApiKey = "";
                _preferredHubDatabaseId = 0;
                _preferredHubSchemaId = 0;
                _preferredApiKey = "";
            }
        }

        private bool SelectPreferredSchema()
        {
            if (_comboSchema.Items.Count == 0)
                return false;

            if (_preferredHubSchemaId != 0)
            {
                for (int i = 1; i < _comboSchema.Items.Count; i++)
                {
                    SchemaItem item = _comboSchema.Items[i] as SchemaItem;
                    if (item == null)
                        continue;

                    if (item.HubSchemaId == _preferredHubSchemaId)
                    {
                        _comboSchema.SelectedIndex = i;
                        return true;
                    }
                }
            }

            if (_preferredHubDatabaseId != 0)
            {
                for (int i = 1; i < _comboSchema.Items.Count; i++)
                {
                    SchemaItem item = _comboSchema.Items[i] as SchemaItem;
                    if (item == null)
                        continue;

                    if (item.HubDatabaseId == _preferredHubDatabaseId)
                    {
                        _comboSchema.SelectedIndex = i;
                        return true;
                    }
                }
            }

            if (_preferredConnectionHubDatabaseId != 0)
            {
                for (int i = 1; i < _comboSchema.Items.Count; i++)
                {
                    SchemaItem item = _comboSchema.Items[i] as SchemaItem;
                    if (item == null)
                        continue;

                    if (item.HubDatabaseId == _preferredConnectionHubDatabaseId)
                    {
                        _comboSchema.SelectedIndex = i;
                        return true;
                    }
                }
            }

            if (_comboSchema.Items.Count > 1)
            {
                _comboSchema.SelectedIndex = 1;
                return true;
            }

            return false;
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
