using System;
using System.Collections.Generic;
using System.Drawing;
using System.Windows.Forms;

namespace Reportman.Designer
{
    /// <summary>
    /// Replicates Delphi's PSchemaHost layout:
    /// Row 0: "SCHEMA" label spanning full width (like PROVIDER/MODE labels)
    /// Row 1: [ComboBox (fill)] [Config ⚙ button] [Refresh button] [Tables button]
    /// Besides the Hub schemas it can list the local schemas of the report's direct connections
    /// (<see cref="SetDirectConnections"/>): "all tables" and each subschema of the connection's
    /// dbxschemas file. The Tables button (only shown when there are direct connections) asks the
    /// host to edit that file.
    /// </summary>
    public class AISchemaSelectorControl : UserControl
    {
        private Label _lblSchema;
        private ComboBox _comboSchema;
        private Button _btnConfig;
        private Button _btnRefresh;
        private Button _btnLocalSchema;
        private bool _suppressSchemaChanged;
        private long _preferredHubDatabaseId;
        private long _preferredHubSchemaId;
        private string _preferredApiKey = "";
        private long _preferredConnectionHubDatabaseId;
        private string _preferredConnectionApiKey = "";
        private List<string> _directAliases = new List<string>();
        private string _preferredLocalAlias = "";
        private string _preferredLocalSubschema = "";

        /// <summary>
        /// Occurs when the selected schema is changed.
        /// </summary>
        public event EventHandler SchemaChanged;

        /// <summary>
        /// Occurs when the user asks to refresh or edit the local schema file of the selected direct
        /// connection (<see cref="LocalAlias"/>).
        /// </summary>
        public event EventHandler LocalSchemaEditRequested;

        /// <summary>
        /// Gets or sets the folder of the local schema files (dbxschemas). The subschemas offered for a
        /// direct connection are read from its file there.
        /// </summary>
        [System.ComponentModel.Browsable(false)]
        [System.ComponentModel.DesignerSerializationVisibility(System.ComponentModel.DesignerSerializationVisibility.Hidden)]
        public string LocalSchemaFolder { get; set; } = "";

        /// <summary>
        /// Gets the direct connection whose local schema is selected, or "" when a Hub schema (or none) is.
        /// </summary>
        public string LocalAlias { get; private set; } = "";

        /// <summary>
        /// Gets the subschema of <see cref="LocalAlias"/> selected, or "" for all its tables.
        /// </summary>
        public string LocalSubschema { get; private set; } = "";

        /// <summary>True when the selection is the local schema of a direct connection.</summary>
        public bool IsLocalSchemaSelected { get { return LocalAlias.Length > 0; } }

        /// <summary>
        /// Gets the identifier of the database currently selected.
        /// </summary>
        public long HubDatabaseId { get; private set; }
        /// <summary>
        /// Gets the identifier of the schema currently selected.
        /// </summary>
        public long HubSchemaId { get; private set; }
        /// <summary>
        /// Gets the API key associated with the selected schema.
        /// </summary>
        public string SchemaApiKey { get; private set; } = "";

        /// <summary>
        /// Initializes a new instance of the AISchemaSelectorControl class.
        /// </summary>
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
                ColumnCount = 4,
                RowCount = 2,
                AutoSize = true,
                AutoSizeMode = AutoSizeMode.GrowAndShrink,
                Padding = new Padding(2)
            };
            table.ColumnStyles.Add(new ColumnStyle(SizeType.Percent, 100f));
            table.ColumnStyles.Add(new ColumnStyle(SizeType.AutoSize));
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
            table.SetColumnSpan(_lblSchema, 4);

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

            _btnLocalSchema = new Button
            {
                Text = "Tables...",
                MinimumSize = new Size(60, 23),
                MaximumSize = new Size(80, 25),
                Dock = DockStyle.Fill,
                Visible = false,
                Enabled = false
            };
            _btnLocalSchema.Click += BtnLocalSchema_Click;
            configTooltip.SetToolTip(_btnLocalSchema, "Refresh the local schema of the connection and define subschemas");

            table.Controls.Add(_comboSchema, 0, 1);
            table.Controls.Add(_btnConfig, 1, 1);
            table.Controls.Add(_btnRefresh, 2, 1);
            table.Controls.Add(_btnLocalSchema, 3, 1);

            this.Controls.Add(table);
        }

        private void BtnLocalSchema_Click(object sender, EventArgs e)
        {
            if (IsLocalSchemaSelected)
                LocalSchemaEditRequested?.Invoke(this, EventArgs.Empty);
        }

        /// <summary>
        /// Sets the direct (not Agent) connections of the report, whose local schemas are offered
        /// before the Hub schemas. When the list changes and <paramref name="preferLocal"/> is true
        /// (the report gives no Hub schema), the "all tables" schema of <paramref name="preferredAlias"/>
        /// becomes the preferred selection; while the list stays the same the current choice is kept.
        /// </summary>
        /// <param name="aliases">Aliases of the report's direct connections.</param>
        /// <param name="preferredAlias">The connection the copilot should work with by default.</param>
        /// <param name="preferLocal">True when the report has no Hub schema of its own.</param>
        public void SetDirectConnections(IList<string> aliases, string preferredAlias, bool preferLocal)
        {
            var list = new List<string>();
            if (aliases != null)
            {
                foreach (string a in aliases)
                {
                    string alias = (a ?? "").Trim();
                    if (alias.Length > 0 && !list.Exists(x => string.Equals(x, alias, StringComparison.OrdinalIgnoreCase)))
                        list.Add(alias);
                }
            }
            bool same = list.Count == _directAliases.Count;
            for (int i = 0; same && i < list.Count; i++)
                same = string.Equals(list[i], _directAliases[i], StringComparison.OrdinalIgnoreCase);
            _directAliases = list;

            if (!same)
            {
                string preferred = (preferredAlias ?? "").Trim();
                if (!list.Exists(x => string.Equals(x, preferred, StringComparison.OrdinalIgnoreCase)))
                    preferred = list.Count > 0 ? list[0] : "";
                bool keepCurrent = _preferredLocalAlias.Length > 0 &&
                    list.Exists(x => string.Equals(x, _preferredLocalAlias, StringComparison.OrdinalIgnoreCase));
                if (!keepCurrent)
                {
                    _preferredLocalAlias = preferLocal ? preferred : "";
                    _preferredLocalSubschema = "";
                }
            }
            _btnLocalSchema.Visible = list.Count > 0;
            ReloadLocalSchemas();
        }

        /// <summary>
        /// Rebuilds the list keeping the selection, after a local schema file changed (refresh,
        /// subschemas added, renamed or deleted).
        /// </summary>
        public void ReloadLocalSchemas()
        {
            var hubItems = new List<SchemaItem>();
            foreach (object item in _comboSchema.Items)
            {
                if (item is SchemaItem si)
                    hubItems.Add(si);
            }
            _suppressSchemaChanged = true;
            try
            {
                _comboSchema.Items.Clear();
                _comboSchema.Items.Add("Default / None");
                AddLocalSchemaItems();
                foreach (SchemaItem si in hubItems)
                    _comboSchema.Items.Add(si);
                if (!SelectPreferredSchema())
                    _comboSchema.SelectedIndex = 0;
            }
            finally
            {
                _suppressSchemaChanged = false;
            }
            ApplySelectedSchema();
        }

        private void AddLocalSchemaItems()
        {
            foreach (string alias in _directAliases)
            {
                _comboSchema.Items.Add(new LocalSchemaItem { Alias = alias, Subschema = "" });
                foreach (string subschema in ReadSubschemaNames(alias))
                    _comboSchema.Items.Add(new LocalSchemaItem { Alias = alias, Subschema = subschema });
            }
        }

        private List<string> ReadSubschemaNames(string alias)
        {
            var names = new List<string>();
            if (string.IsNullOrWhiteSpace(LocalSchemaFolder))
                return names;
            try
            {
                Reportman.Reporting.LocalSchemaFile file = Reportman.Reporting.LocalSchemaStore.Load(
                    Reportman.Reporting.LocalSchemaStore.PathFor(LocalSchemaFolder, alias));
                if (file != null)
                {
                    foreach (Reportman.Reporting.LocalSubschema s in file.Schemas)
                        names.Add(s.Name);
                }
            }
            catch (Exception ex)
            {
                RpAuthManager.Instance.Log("Local schema of " + alias + ": " + ex.Message);
            }
            return names;
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

        /// <summary>
        /// Triggers a refresh of the schema list from the registry config.
        /// </summary>
        public void RefreshSchemas()
        {
            LoadSchemasAsync();
        }

        /// <summary>
        /// Populates the schema list combo box with a list of schema names.
        /// Format of elements: "DisplayName=hubDatabaseId|hubSchemaId" or "DisplayName=hubDatabaseId|hubSchemaId|apiKey"
        /// </summary>
        /// <param name="schemas">The list of schema name strings to apply.</param>
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
                // The local schemas of the report's own direct connections come first.
                AddLocalSchemaItems();

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

        /// <summary>
        /// Sets preferred connection parameters to auto-select schema context.
        /// </summary>
        /// <param name="hubDatabaseId">The preferred database identifier.</param>
        /// <param name="apiKey">The API key of the connection.</param>
        public void SetPreferredConnection(long hubDatabaseId, string apiKey = "")
        {
            _preferredConnectionHubDatabaseId = hubDatabaseId;
            _preferredConnectionApiKey = (apiKey ?? "").Trim();
        }

        /// <summary>
        /// Configures the active database and schema identifiers.
        /// </summary>
        /// <param name="hubDatabaseId">The active database identifier.</param>
        /// <param name="hubSchemaId">The active schema identifier.</param>
        /// <param name="apiKey">The active connection API key.</param>
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
            LocalAlias = "";
            LocalSubschema = "";
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
                LocalAlias = "";
                LocalSubschema = "";
                _preferredLocalAlias = "";
                _preferredLocalSubschema = "";
            }
            else if (_comboSchema.SelectedItem is LocalSchemaItem local)
            {
                // A direct connection's local schema: no Hub ids, the schema travels inline.
                HubDatabaseId = 0;
                HubSchemaId = 0;
                SchemaApiKey = "";
                _preferredHubDatabaseId = 0;
                _preferredHubSchemaId = 0;
                _preferredApiKey = "";
                LocalAlias = local.Alias;
                LocalSubschema = local.Subschema;
                _preferredLocalAlias = local.Alias;
                _preferredLocalSubschema = local.Subschema;
            }
            else
            {
                HubDatabaseId = 0;
                HubSchemaId = 0;
                SchemaApiKey = "";
                _preferredHubDatabaseId = 0;
                _preferredHubSchemaId = 0;
                _preferredApiKey = "";
                LocalAlias = "";
                LocalSubschema = "";
                _preferredLocalAlias = "";
                _preferredLocalSubschema = "";
            }
            if (_btnLocalSchema != null)
                _btnLocalSchema.Enabled = IsLocalSchemaSelected;
        }

        private bool SelectPreferredLocalSchema()
        {
            if (_preferredLocalAlias.Length == 0)
                return false;
            int allIndex = -1;
            for (int i = 1; i < _comboSchema.Items.Count; i++)
            {
                LocalSchemaItem item = _comboSchema.Items[i] as LocalSchemaItem;
                if (item == null || !string.Equals(item.Alias, _preferredLocalAlias, StringComparison.OrdinalIgnoreCase))
                    continue;
                if (string.Equals(item.Subschema, _preferredLocalSubschema, StringComparison.OrdinalIgnoreCase))
                {
                    _comboSchema.SelectedIndex = i;
                    return true;
                }
                if (item.Subschema.Length == 0 && allIndex < 0)
                    allIndex = i;
            }
            // A subschema that was deleted or renamed falls back to all the tables of the connection.
            if (allIndex >= 0)
            {
                _comboSchema.SelectedIndex = allIndex;
                return true;
            }
            return false;
        }

        private bool SelectPreferredSchema()
        {
            if (_comboSchema.Items.Count == 0)
                return false;

            if (SelectPreferredLocalSchema())
                return true;

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

            // As before the local schemas existed: the first Hub schema.
            for (int i = 1; i < _comboSchema.Items.Count; i++)
            {
                if (_comboSchema.Items[i] is SchemaItem)
                {
                    _comboSchema.SelectedIndex = i;
                    return true;
                }
            }

            return false;
        }

        /// <summary>
        /// The local schema of a direct connection for the combo box: all its tables or a subschema.
        /// </summary>
        private class LocalSchemaItem
        {
            public string Alias = "";
            public string Subschema = "";

            public override string ToString()
            {
                return Alias + " (local) - " + (Subschema.Length == 0 ? "All tables" : Subschema);
            }
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
