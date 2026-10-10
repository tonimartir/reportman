using System;
using System.Collections.Generic;
using System.Drawing;
using System.Drawing.Drawing2D;
using System.Threading.Tasks;
using System.Windows.Forms;
using Reportman.Drawing;
using Reportman.Reporting;

namespace Reportman.Designer
{
    /// <summary>
    /// The data of <see cref="AISchemaSelectorControl.LocalSchemaEditRequested"/>: the direct connection
    /// whose local schema file is to be edited, and whether the editor starts adding a subschema.
    /// </summary>
    public class LocalSchemaEditEventArgs : EventArgs
    {
        /// <summary>
        /// Initializes the data of a request to edit the local schema of <paramref name="alias"/>.
        /// </summary>
        /// <param name="alias">The direct connection.</param>
        /// <param name="addSubschema">True when the editor starts adding a subschema.</param>
        public LocalSchemaEditEventArgs(string alias, bool addSubschema)
        {
            Alias = alias ?? "";
            AddSubschema = addSubschema;
            AddedSubschema = "";
        }

        /// <summary>Gets the direct connection whose local schema file is edited.</summary>
        public string Alias { get; private set; }

        /// <summary>Gets a value indicating whether the editor starts adding a subschema.</summary>
        public bool AddSubschema { get; private set; }

        /// <summary>
        /// Gets or sets, set by the handler, the subschema added and saved in the editor: the selector
        /// selects it. Empty to keep the selection.
        /// </summary>
        public string AddedSubschema { get; set; }
    }

    /// <summary>
    /// Replicates Delphi's PSchemaHost layout:
    /// Row 0: "SCHEMA" label spanning full width (like PROVIDER/MODE labels)
    /// Row 1: [ComboBox (fill)] [Config ⚙ ▾ button] [Refresh button]
    /// The list groups the local schemas of the report's direct connections
    /// (<see cref="SetDirectConnections(IList{string}, string, bool)"/>: each subschema of the
    /// connection's dbxschemas file) and the Hub schemas, each with its icon (local or cloud), the
    /// number of tables that would travel and a warning when it does not fit the plan with the cloud
    /// AI, and ends with "New local schema..." and "New cloud schema...". A Hub schema reads «schema -
    /// Agent», with a red dot before the name while its Agent is not connected (it can still be
    /// chosen: the AI designs with the schema, only the data waits for the Agent; the Hub schemas are
    /// those of the login and of every Agent connection of dbxconnections.ini,
    /// docs/agents-desconectados-plan.md, §2.1). The config button drops down
    /// "Local schemas..." and "Cloud schemas..." (docs/esquemas-locales-pantalla-plan.md, §5.4.1).
    /// Only a subschema or a cloud schema goes to the AI, never the whole dictionary of the file
    /// ("all the tables" stays in the local schema screen only, §5.7.1).
    /// </summary>
    public class AISchemaSelectorControl : UserControl
    {
        private const string CloudSchemasUrl = "https://app.reportman.es/database-config";
        private const string WarningSign = "⚠ ";
        // Before the text (and the warning): a local subschema or a schema in the cloud
        private const string LocalIcon = "⛁ ";
        private const string CloudIcon = "☁ ";
        private const int ItemIndent = 14;
        // The open list is as wide as its longest entry, up to this (in logical pixels) or the screen
        private const int MaxDropDownWidth = 600;
        private static readonly Color OfflineDotColor = Color.FromArgb(220, 38, 38);

        // The choice made for each connection in this session: direct alias → subschema, Hub
        // database → schema.
        private static readonly Dictionary<string, string> RememberedSubschemas =
            new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase);
        private static readonly Dictionary<long, long> RememberedHubSchemas = new Dictionary<long, long>();

        private Label _lblSchema;
        private ComboBox _comboSchema;
        private Button _btnConfig;
        private ContextMenuStrip _menuConfig;
        private ToolStripMenuItem _menuLocalSchemas;
        private ToolStripMenuItem _menuCloudSchemas;
        private Button _btnRefresh;
        private ToolTip _toolTip;
        private readonly ActionItem _newLocalAction = new ActionItem(ActionKind.NewLocalSchema);
        private readonly ActionItem _newCloudAction = new ActionItem(ActionKind.NewCloudSchema);
        private bool _suppressSchemaChanged;
        private bool _ignorePlanLimits;
        private int _lastSchemaIndex = -1;
        private long _preferredHubDatabaseId;
        private long _preferredHubSchemaId;
        private string _preferredApiKey = "";
        private long _preferredConnectionHubDatabaseId;
        private string _preferredConnectionApiKey = "";
        private List<string> _directAliases = new List<string>();
        private string _defaultDirectAlias = "";
        private string _preferredLocalAlias = "";
        private string _preferredLocalSubschema = "";

        /// <summary>
        /// Occurs when the selected schema is changed.
        /// </summary>
        public event EventHandler SchemaChanged;

        /// <summary>
        /// Occurs when the user asks to edit the local schema file of a direct connection ("Local
        /// schemas..." of the config button) or to add a subschema to it ("New local schema..."). The
        /// handler opens the editor (it has the connection) and, after adding one, sets
        /// <see cref="LocalSchemaEditEventArgs.AddedSubschema"/>; the list is read again afterwards.
        /// </summary>
        public event EventHandler<LocalSchemaEditEventArgs> LocalSchemaEditRequested;

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
        /// Gets the subschema of <see cref="LocalAlias"/> selected, or "" when none is.
        /// </summary>
        public string LocalSubschema { get; private set; } = "";

        /// <summary>True when the selection is the local schema of a direct connection.</summary>
        public bool IsLocalSchemaSelected { get { return LocalAlias.Length > 0; } }

        /// <summary>
        /// Gets the direct connection of the report the AI needs a subschema of: with no schema
        /// selected (no subschema, no cloud schema) and a direct connection in the report, its alias;
        /// otherwise "". The copilot does not call the cloud then and asks to choose one (the AI only
        /// receives a subschema, never all the tables of the file).
        /// </summary>
        public string MissingSchemaAlias
        {
            get { return IsLocalSchemaSelected || HubDatabaseId != 0 || HubSchemaId != 0 ? "" : TargetDirectAlias; }
        }

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
        /// Gets or sets a value indicating whether the plan limits are ignored: true while the AI runs
        /// on the user's Agent (the LocalAgent provider), which has none, so no schema is marked.
        /// </summary>
        [System.ComponentModel.Browsable(false)]
        [System.ComponentModel.DesignerSerializationVisibility(System.ComponentModel.DesignerSerializationVisibility.Hidden)]
        public bool IgnorePlanLimits
        {
            get { return _ignorePlanLimits; }
            set
            {
                if (_ignorePlanLimits == value)
                    return;
                _ignorePlanLimits = value;
                UpdatePlanWarnings();
            }
        }

        /// <summary>
        /// Initializes a new instance of the AISchemaSelectorControl class.
        /// </summary>
        public AISchemaSelectorControl()
        {
            InitializeComponent();
        }

        /// <summary>
        /// Cleans up any resources being used.
        /// </summary>
        /// <param name="disposing">True if managed resources should be disposed; otherwise, false.</param>
        protected override void Dispose(bool disposing)
        {
            if (disposing)
            {
                _toolTip?.Dispose();
                _menuConfig?.Dispose();
            }
            base.Dispose(disposing);
        }

        private static string Tr(int index)
        {
            return Translator.TranslateStr(index);
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
                Text = Tr(1528).ToUpper(),
                AutoSize = true,
                Font = new Font("Segoe UI", 8f)
            };
            table.Controls.Add(_lblSchema, 0, 0);
            table.SetColumnSpan(_lblSchema, 3);

            _toolTip = new ToolTip();

            // Owner drawn: group headers that cannot be selected, indented schemas, and the actions
            // at the end below a line.
            _comboSchema = new ComboBox
            {
                DropDownStyle = ComboBoxStyle.DropDownList,
                DrawMode = DrawMode.OwnerDrawFixed,
                Dock = DockStyle.Fill,
                Anchor = AnchorStyles.Left | AnchorStyles.Right
            };
            _comboSchema.DrawItem += ComboSchema_DrawItem;
            _comboSchema.DropDown += ComboSchema_DropDown;
            _comboSchema.DropDownClosed += ComboSchema_DropDownClosed;
            _comboSchema.SelectedIndexChanged += ComboSchema_SelectedIndexChanged;
            _comboSchema.SelectionChangeCommitted += ComboSchema_SelectionChangeCommitted;
            _comboSchema.KeyDown += ComboSchema_KeyDown;
            _comboSchema.KeyPress += ComboSchema_KeyPress;
            _comboSchema.MouseWheel += ComboSchema_MouseWheel;
            _newLocalAction.Text = Tr(1838);
            _newLocalAction.First = true;
            _newCloudAction.Text = Tr(1839);
            _comboSchema.Items.Add(_newLocalAction);
            _comboSchema.Items.Add(_newCloudAction);

            _menuLocalSchemas = new ToolStripMenuItem(Tr(1840));
            _menuLocalSchemas.Click += (s, e) => RequestLocalSchemaEdit(TargetDirectAlias, false);
            _menuCloudSchemas = new ToolStripMenuItem(Tr(1841));
            _menuCloudSchemas.Click += (s, e) => OpenUrl(CloudSchemasUrl);
            _menuConfig = new ContextMenuStrip();
            _menuConfig.Items.Add(_menuLocalSchemas);
            _menuConfig.Items.Add(_menuCloudSchemas);
            _menuConfig.Opening += (s, e) => _menuLocalSchemas.Enabled = CanEditLocalSchema;

            _btnConfig = new Button
            {
                Text = "⚙ ▾",
                MinimumSize = new Size(38, 23),
                MaximumSize = new Size(46, 25),
                Dock = DockStyle.Fill
            };
            _btnConfig.Click += BtnConfig_Click;
            _toolTip.SetToolTip(_btnConfig, Tr(1496));

            _btnRefresh = new Button
            {
                Text = Tr(1149),
                MinimumSize = new Size(60, 23),
                MaximumSize = new Size(80, 25),
                Dock = DockStyle.Fill
            };
            _btnRefresh.Click += BtnRefresh_Click;

            table.Controls.Add(_comboSchema, 0, 1);
            table.Controls.Add(_btnConfig, 1, 1);
            table.Controls.Add(_btnRefresh, 2, 1);

            this.Controls.Add(table);
            UpdateActions();
        }

        /// <summary>
        /// Sets the direct (not Agent) connections of the report, whose local schemas are offered
        /// before the Hub schemas. When the list changes and <paramref name="preferLocal"/> is true
        /// (the report gives no Hub schema), the subschema chosen last in this session for
        /// <paramref name="preferredAlias"/> (else the first one of its file, else none) becomes the
        /// preferred selection; while the list stays the same the current choice is kept.
        /// </summary>
        /// <param name="aliases">Aliases of the report's direct connections.</param>
        /// <param name="preferredAlias">The connection the copilot should work with by default.</param>
        /// <param name="preferLocal">True when the report has no Hub schema of its own.</param>
        public void SetDirectConnections(IList<string> aliases, string preferredAlias, bool preferLocal)
        {
            SetDirectConnections(aliases, preferredAlias, preferLocal, null);
        }

        /// <summary>
        /// Sets the direct connections of the report, as <see cref="SetDirectConnections(IList{string}, string, bool)"/>,
        /// for a report just opened when <paramref name="reportSubschema"/> is not null: with
        /// <paramref name="preferLocal"/>, its subschema of <paramref name="preferredAlias"/> is selected
        /// while it is in the file; else the one chosen last in this session for that connection, else
        /// the first one of the file, else none (the copilot then asks to choose one).
        /// </summary>
        /// <param name="aliases">Aliases of the report's direct connections.</param>
        /// <param name="preferredAlias">The connection the copilot should work with by default.</param>
        /// <param name="preferLocal">True when the local schema should be selected rather than a Hub schema.</param>
        /// <param name="reportSubschema">Null to keep the current choice; otherwise the subschema the
        /// report's datasets of <paramref name="preferredAlias"/> were made with ("" when they say none).</param>
        public void SetDirectConnections(IList<string> aliases, string preferredAlias, bool preferLocal, string reportSubschema)
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

            string preferred = (preferredAlias ?? "").Trim();
            if (!list.Exists(x => string.Equals(x, preferred, StringComparison.OrdinalIgnoreCase)))
                preferred = list.Count > 0 ? list[0] : "";
            _defaultDirectAlias = preferred;

            if (reportSubschema != null && preferLocal && preferred.Length > 0)
            {
                // A report just opened: the subschema its datasets were made with, else the last one chosen
                _preferredLocalAlias = preferred;
                _preferredLocalSubschema = reportSubschema.Trim().Length > 0 ? reportSubschema.Trim() : RememberedSubschema(preferred);
            }
            else if (!same)
            {
                bool keepCurrent = _preferredLocalAlias.Length > 0 &&
                    list.Exists(x => string.Equals(x, _preferredLocalAlias, StringComparison.OrdinalIgnoreCase));
                if (!keepCurrent)
                {
                    _preferredLocalAlias = preferLocal ? preferred : "";
                    _preferredLocalSubschema = preferLocal ? RememberedSubschema(preferred) : "";
                }
            }
            ReloadLocalSchemas();
        }

        private static string RememberedSubschema(string alias)
        {
            string subschema;
            return alias.Length > 0 && RememberedSubschemas.TryGetValue(alias, out subschema) ? subschema : "";
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
            RebuildList(hubItems);
        }

        /// <summary>
        /// Reads the local schemas again and selects <paramref name="subschema"/> of the direct
        /// connection <paramref name="alias"/>, as if the user had chosen it (when it is not in the file,
        /// or is "", the one chosen last there, else the first one).
        /// </summary>
        /// <param name="alias">The direct connection.</param>
        /// <param name="subschema">The subschema.</param>
        public void SelectLocalSchema(string alias, string subschema)
        {
            _preferredLocalAlias = (alias ?? "").Trim();
            _preferredLocalSubschema = (subschema ?? "").Trim();
            ReloadLocalSchemas();
            SchemaChanged?.Invoke(this, EventArgs.Empty);
        }

        /// <summary>
        /// Marks again the schemas that do not fit the plan, after the profile (and so the plan)
        /// changed.
        /// </summary>
        public void RefreshPlanWarnings()
        {
            UpdatePlanWarnings();
        }

        /// <summary>
        /// True when the schema selected passes the plan's limits with the cloud AI: its tables, or
        /// the columns of its widest one, as the list counted them (an unknown count never does). The
        /// AI on the user's Agent has no limits: ask only when the AI runs in the cloud.
        /// </summary>
        public bool SelectedSchemaExceedsPlan()
        {
            SchemaEntry entry = _lastSchemaIndex >= 0 && _lastSchemaIndex < _comboSchema.Items.Count
                ? _comboSchema.Items[_lastSchemaIndex] as SchemaEntry : null;
            return entry != null && IsOverPlan(entry, RpAuthManager.Instance.Profile);
        }

        /// <summary>
        /// Triggers a refresh of the schema list from the registry config.
        /// </summary>
        public void RefreshSchemas()
        {
            UpdatePlanWarnings();
            LoadSchemasAsync();
        }

        /// <summary>
        /// Populates the list with the schemas of the Hub (the report's own Hub database first, the
        /// rest in their order), each labeled «schema - Agent» (<see cref="HubSchema.Label"/>), with the
        /// number of its tables and a red dot when its Agent is not connected.
        /// </summary>
        /// <param name="schemas">The schemas, as <see cref="RpAuthManager.GetUserSchemasAsync"/> lists them.</param>
        public void ApplySchemas(IEnumerable<HubSchema> schemas)
        {
            if (_preferredHubDatabaseId == 0 && _preferredHubSchemaId == 0)
            {
                _preferredHubDatabaseId = HubDatabaseId;
                _preferredHubSchemaId = HubSchemaId;
                _preferredApiKey = SchemaApiKey;
            }

            var hubItems = new List<SchemaItem>();
            if (schemas != null)
            {
                var otherItems = new List<SchemaItem>();
                foreach (HubSchema schema in schemas)
                {
                    if (schema == null)
                        continue;
                    var item = new SchemaItem
                    {
                        DisplayName = schema.Label,
                        HubDatabaseId = schema.HubDatabaseId,
                        HubSchemaId = schema.HubSchemaId,
                        ApiKey = schema.ApiKey ?? "",
                        IsOnline = schema.IsOnline,
                        Tables = schema.Tables,
                        WidestColumns = schema.WidestColumns
                    };
                    // The schemas of the report's own Hub database first
                    if (_preferredConnectionHubDatabaseId != 0 && item.HubDatabaseId == _preferredConnectionHubDatabaseId)
                        hubItems.Add(item);
                    else
                        otherItems.Add(item);
                }
                hubItems.AddRange(otherItems);
            }
            RebuildList(hubItems);
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
            UpdateActions();
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
                int index = FindPreferredIndex();
                if (index >= 0)
                    _comboSchema.SelectedIndex = index;
            }
            finally
            {
                _suppressSchemaChanged = false;
            }

            ApplySelectedSchema();
        }

        // ===== The list =====

        private void RebuildList(List<SchemaItem> hubItems)
        {
            List<LocalSchemaItem> localItems = BuildLocalItems();
            _suppressSchemaChanged = true;
            try
            {
                _comboSchema.BeginUpdate();
                try
                {
                    _comboSchema.Items.Clear();
                    if (localItems.Count > 0)
                    {
                        _comboSchema.Items.Add(new GroupHeaderItem(Tr(1836)));
                        foreach (LocalSchemaItem item in localItems)
                            _comboSchema.Items.Add(item);
                    }
                    if (hubItems.Count > 0)
                    {
                        _comboSchema.Items.Add(new GroupHeaderItem(Tr(1837)));
                        foreach (SchemaItem item in hubItems)
                            _comboSchema.Items.Add(item);
                    }
                    _comboSchema.Items.Add(_newLocalAction);
                    _comboSchema.Items.Add(_newCloudAction);
                    UpdatePlanWarningsOfItems();
                }
                finally
                {
                    _comboSchema.EndUpdate();
                }
                _comboSchema.SelectedIndex = FindPreferredIndex();
            }
            finally
            {
                _suppressSchemaChanged = false;
            }
            ApplySelectedSchema();
        }

        /// <summary>
        /// The local schemas of the direct connections: each subschema, with the tables that would
        /// travel. All the tables of a file (its dictionary) are not offered: a big database does not
        /// fit the AI whole, so only a subschema goes. A file that does not exist yet is not generated
        /// just to list it: that connection offers only "New local schema...".
        /// </summary>
        private List<LocalSchemaItem> BuildLocalItems()
        {
            var result = new List<LocalSchemaItem>();
            foreach (string alias in _directAliases)
            {
                LocalSchemaFile file = LoadLocalSchemaFile(alias);
                if (file == null)
                    continue;
                foreach (LocalSubschema s in file.Schemas)
                {
                    if (string.IsNullOrWhiteSpace(s.Name))
                        continue;
                    var item = new LocalSchemaItem(alias, s.Name);
                    CountTables(file, s.Name, item);
                    result.Add(item);
                }
            }
            return result;
        }

        private LocalSchemaFile LoadLocalSchemaFile(string alias)
        {
            if (string.IsNullOrWhiteSpace(LocalSchemaFolder))
                return null;
            try
            {
                return LocalSchemaStore.Load(LocalSchemaStore.PathFor(LocalSchemaFolder, alias));
            }
            catch (Exception ex)
            {
                RpAuthManager.Instance.Log("Local schema of " + alias + ": " + ex.Message);
                return null;
            }
        }

        /// <summary>The tables of a subschema and the columns of the widest one, as they travel inline.</summary>
        private static void CountTables(LocalSchemaFile file, string subschema, SchemaEntry entry)
        {
            LocalSubschema selected = LocalSchemaStore.FindSubschema(file, subschema);
            List<LocalSchemaTable> tables = LocalSchemaStore.TablesOf(file, subschema);
            int widest = 0;
            foreach (LocalSchemaTable table in tables)
                widest = Math.Max(widest, LocalSchemaStore.ColumnsOf(selected, table).Count);
            entry.Tables = tables.Count;
            entry.WidestColumns = widest;
        }

        /// <summary>Adds the schemas of <paramref name="source"/> not listed yet (by Hub database and schema).</summary>
        private static void AddMergedSchemas(IEnumerable<HubSchema> source, List<HubSchema> destination,
            HashSet<string> seenSchemaKeys)
        {
            if (source == null)
                return;

            foreach (HubSchema schema in source)
            {
                string schemaKey = schema.HubDatabaseId.ToString() + "|" + schema.HubSchemaId.ToString();
                if (seenSchemaKeys.Add(schemaKey))
                    destination.Add(schema);
            }
        }

        private async void LoadSchemasAsync()
        {
            _btnRefresh.Enabled = false;
            try
            {
                // The schemas of every Agent connection of dbxconnections.ini, as the Delphi copilot: the
                // report's connection first (its schemas run with its key), then the login's, then the
                // other connections'. The requests go together; a schema listed twice keeps the first.
                string preferredApiKey = _preferredConnectionApiKey;
                Task<List<HubSchema>> preferredSchemas = string.IsNullOrWhiteSpace(preferredApiKey) ? null
                    : RpAuthManager.Instance.GetApiKeySchemasAsync(preferredApiKey);
                Task<List<HubSchema>> userSchemas = RpAuthManager.Instance.GetUserSchemasAsync();
                var otherSchemas = new List<Task<List<HubSchema>>>();
                foreach (string apiKey in DbxConnections.GetAgentApiKeys())
                {
                    if (!string.Equals(apiKey, preferredApiKey, StringComparison.Ordinal))
                        otherSchemas.Add(RpAuthManager.Instance.GetApiKeySchemasAsync(apiKey));
                }

                var mergedSchemas = new List<HubSchema>();
                var seenSchemaKeys = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
                if (preferredSchemas != null)
                    AddMergedSchemas(await preferredSchemas, mergedSchemas, seenSchemaKeys);
                AddMergedSchemas(await userSchemas, mergedSchemas, seenSchemaKeys);
                foreach (Task<List<HubSchema>> schemas in otherSchemas)
                    AddMergedSchemas(await schemas, mergedSchemas, seenSchemaKeys);

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

        // ===== Selection =====

        private void ComboSchema_SelectedIndexChanged(object sender, EventArgs e)
        {
            object item = _comboSchema.SelectedItem;
            if (item is GroupHeaderItem)
            {
                // A header is skipped in the direction the selection moved (a click takes its first schema)
                int index = _comboSchema.SelectedIndex;
                int direction = index >= _lastSchemaIndex ? 1 : -1;
                int target = NextSelectableIndex(index, direction);
                if (target < 0)
                    target = NextSelectableIndex(index, -direction);
                _comboSchema.SelectedIndex = target;
                return;
            }
            // An action is only highlighted while the list is open: it runs when it is committed.
            if (item is ActionItem)
                return;
            ApplySelectedSchema();
            if (!_suppressSchemaChanged)
                SchemaChanged?.Invoke(this, EventArgs.Empty);
        }

        private void ComboSchema_SelectionChangeCommitted(object sender, EventArgs e)
        {
            ActionItem action = _comboSchema.SelectedItem as ActionItem;
            if (action == null)
                return;
            // Deferred: the combo is still processing the selection; the previous schema comes back first.
            BeginInvoke(new Action(() =>
            {
                RestoreLastSchema();
                RunAction(action);
            }));
        }

        private void ComboSchema_DropDownClosed(object sender, EventArgs e)
        {
            // Closed on an action or a header without committing it: the schema comes back.
            BeginInvoke(new Action(() =>
            {
                object item = _comboSchema.SelectedItem;
                if (item is ActionItem || item is GroupHeaderItem)
                    RestoreLastSchema();
            }));
        }

        private void RestoreLastSchema()
        {
            int index = _lastSchemaIndex >= 0 && _lastSchemaIndex < _comboSchema.Items.Count &&
                _comboSchema.Items[_lastSchemaIndex] is SchemaEntry ? _lastSchemaIndex : -1;
            _suppressSchemaChanged = true;
            try
            {
                _comboSchema.SelectedIndex = index;
            }
            finally
            {
                _suppressSchemaChanged = false;
            }
            ApplySelectedSchema();
        }

        private void ApplySelectedSchema()
        {
            object selected = _comboSchema.SelectedItem;
            if (selected is ActionItem || selected is GroupHeaderItem)
                return;
            if (selected is SchemaItem si)
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
                if (si.HubDatabaseId != 0)
                    RememberedHubSchemas[si.HubDatabaseId] = si.HubSchemaId;
            }
            else if (selected is LocalSchemaItem local)
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
                RememberedSubschemas[local.Alias] = local.Subschema;
            }
            else
            {
                // Nothing to select (yet): the preferences stay for when the list arrives.
                HubDatabaseId = 0;
                HubSchemaId = 0;
                SchemaApiKey = "";
                LocalAlias = "";
                LocalSubschema = "";
            }
            _lastSchemaIndex = selected is SchemaEntry ? _comboSchema.SelectedIndex : -1;
            UpdateActions();
            UpdateSelectionTooltip();
        }

        private int FindPreferredIndex()
        {
            int index = FindPreferredLocalIndex();
            if (index >= 0)
                return index;

            if (_preferredHubSchemaId != 0)
            {
                index = FindHubIndex(item => item.HubSchemaId == _preferredHubSchemaId);
                if (index >= 0)
                    return index;
            }

            if (_preferredHubDatabaseId != 0)
            {
                index = FindHubDatabaseIndex(_preferredHubDatabaseId);
                if (index >= 0)
                    return index;
            }

            if (_preferredConnectionHubDatabaseId != 0)
            {
                index = FindHubDatabaseIndex(_preferredConnectionHubDatabaseId);
                if (index >= 0)
                    return index;
            }

            // A direct connection without subschemas selects nothing, not a cloud schema of some other
            // database: the copilot asks to choose or make one.
            if (_preferredLocalAlias.Length > 0)
                return -1;

            // As before the local schemas existed: the first Hub schema.
            return FindHubIndex(item => true);
        }

        /// <summary>
        /// The subschema to select of the preferred direct connection: the one asked for (the report's,
        /// D3) while it is in the file; else the one chosen last there in this session; else the first
        /// one of the file; -1 when the file has none.
        /// </summary>
        private int FindPreferredLocalIndex()
        {
            if (_preferredLocalAlias.Length == 0)
                return -1;
            string remembered = RememberedSubschema(_preferredLocalAlias);
            int rememberedIndex = -1;
            int firstIndex = -1;
            for (int i = 0; i < _comboSchema.Items.Count; i++)
            {
                LocalSchemaItem item = _comboSchema.Items[i] as LocalSchemaItem;
                if (item == null || !string.Equals(item.Alias, _preferredLocalAlias, StringComparison.OrdinalIgnoreCase))
                    continue;
                if (string.Equals(item.Subschema, _preferredLocalSubschema, StringComparison.OrdinalIgnoreCase))
                    return i;
                if (rememberedIndex < 0 && string.Equals(item.Subschema, remembered, StringComparison.OrdinalIgnoreCase))
                    rememberedIndex = i;
                if (firstIndex < 0)
                    firstIndex = i;
            }
            // A subschema that was deleted or renamed (or an old report that names none) never falls
            // back to all the tables: the last one chosen, else the first one.
            return rememberedIndex >= 0 ? rememberedIndex : firstIndex;
        }

        /// <summary>The schema chosen last in this session for a Hub database, else its first one.</summary>
        private int FindHubDatabaseIndex(long hubDatabaseId)
        {
            long remembered;
            if (RememberedHubSchemas.TryGetValue(hubDatabaseId, out remembered))
            {
                int index = FindHubIndex(item => item.HubDatabaseId == hubDatabaseId && item.HubSchemaId == remembered);
                if (index >= 0)
                    return index;
            }
            return FindHubIndex(item => item.HubDatabaseId == hubDatabaseId);
        }

        private int FindHubIndex(Predicate<SchemaItem> match)
        {
            for (int i = 0; i < _comboSchema.Items.Count; i++)
            {
                SchemaItem item = _comboSchema.Items[i] as SchemaItem;
                if (item != null && match(item))
                    return i;
            }
            return -1;
        }

        /// <summary>The next item after <paramref name="from"/> that is not a header (a schema or an action), or -1.</summary>
        private int NextSelectableIndex(int from, int direction)
        {
            for (int i = from + direction; i >= 0 && i < _comboSchema.Items.Count; i += direction)
            {
                if (!(_comboSchema.Items[i] is GroupHeaderItem))
                    return i;
            }
            return -1;
        }

        /// <summary>The next schema after <paramref name="from"/> (no header, no action), or -1.</summary>
        private int NextSchemaIndex(int from, int direction)
        {
            for (int i = from + direction; i >= 0 && i < _comboSchema.Items.Count; i += direction)
            {
                if (_comboSchema.Items[i] is SchemaEntry)
                    return i;
            }
            return -1;
        }

        private void SelectByUser(int index)
        {
            if (index >= 0 && index != _comboSchema.SelectedIndex)
                _comboSchema.SelectedIndex = index;
        }

        // The closed list moves among the schemas only: the keyboard and the wheel never land on a
        // header or run an action (they would on their own).
        private void ComboSchema_KeyDown(object sender, KeyEventArgs e)
        {
            if (_comboSchema.DroppedDown || e.Alt || e.Control)
                return;
            int target;
            switch (e.KeyCode)
            {
                case Keys.Down:
                case Keys.Right:
                    target = NextSchemaIndex(_comboSchema.SelectedIndex, 1);
                    break;
                case Keys.Up:
                case Keys.Left:
                    target = NextSchemaIndex(_comboSchema.SelectedIndex < 0 ? _comboSchema.Items.Count : _comboSchema.SelectedIndex, -1);
                    break;
                case Keys.Home:
                case Keys.PageUp:
                    target = NextSchemaIndex(-1, 1);
                    break;
                case Keys.End:
                case Keys.PageDown:
                    target = NextSchemaIndex(_comboSchema.Items.Count, -1);
                    break;
                default:
                    return;
            }
            e.Handled = true;
            SelectByUser(target);
        }

        private void ComboSchema_KeyPress(object sender, KeyPressEventArgs e)
        {
            if (_comboSchema.DroppedDown || char.IsControl(e.KeyChar))
                return;
            e.Handled = true;
            int count = _comboSchema.Items.Count;
            int start = _comboSchema.SelectedIndex;
            string key = e.KeyChar.ToString();
            for (int step = 1; step <= count; step++)
            {
                int index = (start + step + count) % count;
                SchemaEntry entry = _comboSchema.Items[index] as SchemaEntry;
                if (entry != null && entry.Name.StartsWith(key, StringComparison.CurrentCultureIgnoreCase))
                {
                    SelectByUser(index);
                    return;
                }
            }
        }

        private void ComboSchema_MouseWheel(object sender, MouseEventArgs e)
        {
            if (_comboSchema.DroppedDown)
                return;
            if (e is HandledMouseEventArgs handled)
                handled.Handled = true;
            if (e.Delta < 0)
                SelectByUser(NextSchemaIndex(_comboSchema.SelectedIndex, 1));
            else if (e.Delta > 0)
                SelectByUser(NextSchemaIndex(_comboSchema.SelectedIndex < 0 ? _comboSchema.Items.Count : _comboSchema.SelectedIndex, -1));
        }

        // ===== Actions =====

        /// <summary>The direct connection of the local actions: the one selected, else the report's.</summary>
        private string TargetDirectAlias
        {
            get { return IsLocalSchemaSelected ? LocalAlias : _defaultDirectAlias; }
        }

        /// <summary>The Hub database of "New cloud schema...": the selected schema's, else the report's Agent connection's.</summary>
        private long TargetHubDatabaseId
        {
            get
            {
                if (HubDatabaseId > 0)
                    return HubDatabaseId;
                return IsLocalSchemaSelected ? 0 : _preferredConnectionHubDatabaseId;
            }
        }

        private bool CanEditLocalSchema
        {
            get { return TargetDirectAlias.Length > 0 && LocalSchemaEditRequested != null; }
        }

        private void UpdateActions()
        {
            _newLocalAction.Enabled = CanEditLocalSchema;
            _newLocalAction.Reason = "";
            _newCloudAction.Enabled = TargetHubDatabaseId > 0;
            // A direct connection is not in the Hub: there is nothing to create a cloud schema on
            _newCloudAction.Reason = !_newCloudAction.Enabled && (IsLocalSchemaSelected || _directAliases.Count > 0) ? Tr(1842) : "";
            _comboSchema.Invalidate();
        }

        private void RunAction(ActionItem action)
        {
            UpdateActions();
            if (!action.Enabled)
            {
                if (action.Reason.Length > 0)
                    _toolTip.Show(action.Reason, _comboSchema, 0, _comboSchema.Height, 4000);
                return;
            }
            if (action.Kind == ActionKind.NewLocalSchema)
                RequestLocalSchemaEdit(TargetDirectAlias, true);
            else
                OpenUrl(CloudSchemasUrl + "?new=1&hubDatabaseId=" + TargetHubDatabaseId);
        }

        private void RequestLocalSchemaEdit(string alias, bool addSubschema)
        {
            EventHandler<LocalSchemaEditEventArgs> handler = LocalSchemaEditRequested;
            if (handler == null || string.IsNullOrEmpty(alias))
                return;
            var args = new LocalSchemaEditEventArgs(alias, addSubschema);
            handler(this, args);
            // The file may have been generated, refreshed or changed: the list is read again
            if (!string.IsNullOrEmpty(args.AddedSubschema))
                SelectLocalSchema(alias, args.AddedSubschema);
            else
                ReloadLocalSchemas();
        }

        private static void OpenUrl(string url)
        {
            try
            {
                System.Diagnostics.Process.Start(new System.Diagnostics.ProcessStartInfo
                {
                    FileName = url,
                    UseShellExecute = true
                });
            }
            catch (Exception ex)
            {
                RpAuthManager.Instance.Log("Unable to open " + url + ": " + ex.Message);
            }
        }

        private void BtnConfig_Click(object sender, EventArgs e)
        {
            _menuConfig.Show(_btnConfig, new Point(0, _btnConfig.Height));
        }

        private void BtnRefresh_Click(object sender, EventArgs e)
        {
            RefreshSchemas();
        }

        // ===== Plan warnings =====

        private void UpdatePlanWarnings()
        {
            UpdatePlanWarningsOfItems();
            _comboSchema.Invalidate();
            UpdateSelectionTooltip();
        }

        private void UpdatePlanWarningsOfItems()
        {
            RpProfile profile = RpAuthManager.Instance.Profile;
            foreach (object item in _comboSchema.Items)
            {
                if (item is SchemaEntry entry)
                    entry.OverPlan = !_ignorePlanLimits && IsOverPlan(entry, profile);
            }
        }

        /// <summary>
        /// True when the tables that would travel, or the columns of the widest one, pass the plan's
        /// limits with the cloud AI (a limit of 0 or less is none; an unknown count is never marked).
        /// </summary>
        private static bool IsOverPlan(SchemaEntry entry, RpProfile profile)
        {
            if (entry.Tables < 0 || profile == null)
                return false;
            return (profile.MaxTables > 0 && entry.Tables > profile.MaxTables) ||
                (profile.MaxColumnsPerTable > 0 && entry.WidestColumns > profile.MaxColumnsPerTable);
        }

        private void UpdateSelectionTooltip()
        {
            SchemaEntry entry = _comboSchema.SelectedItem as SchemaEntry;
            string text = "";
            if (entry != null)
            {
                if (entry.OverPlan)
                    text = Tr(1844);
                // Its Agent is not connected: the AI designs with the schema, the data waits for it
                if (entry.Offline)
                    text = text.Length > 0 ? text + Environment.NewLine + Tr(2004) : Tr(2004);
                if (text.Length == 0)
                    text = entry.Caption;
            }
            _toolTip.SetToolTip(_comboSchema, text);
        }

        // ===== Drawing =====

        private void ComboSchema_DrawItem(object sender, DrawItemEventArgs e)
        {
            if (e.Index < 0 || e.Index >= _comboSchema.Items.Count)
            {
                e.DrawBackground();
                return;
            }
            object item = _comboSchema.Items[e.Index];
            GroupHeaderItem header = item as GroupHeaderItem;
            ActionItem action = item as ActionItem;
            bool inEdit = (e.State & DrawItemState.ComboBoxEdit) == DrawItemState.ComboBoxEdit;
            // Headers and disabled actions are never highlighted
            bool plain = header != null || (action != null && !action.Enabled);
            if (plain)
            {
                using (var back = new SolidBrush(_comboSchema.BackColor))
                    e.Graphics.FillRectangle(back, e.Bounds);
            }
            else
                e.DrawBackground();
            if (action != null && action.First && !inEdit)
                e.Graphics.DrawLine(SystemPens.ControlDark, e.Bounds.Left + 2, e.Bounds.Top, e.Bounds.Right - 3, e.Bounds.Top);

            int indent = inEdit ? 1 : (item is SchemaEntry ? ItemIndent : 3);
            var bounds = new Rectangle(e.Bounds.Left + indent, e.Bounds.Top, Math.Max(0, e.Bounds.Width - indent), e.Bounds.Height);
            bool selected = (e.State & DrawItemState.Selected) == DrawItemState.Selected;
            Color color = plain ? SystemColors.GrayText
                : (selected ? SystemColors.HighlightText : _comboSchema.ForeColor);
            const TextFormatFlags flags = TextFormatFlags.Left | TextFormatFlags.VerticalCenter | TextFormatFlags.SingleLine |
                TextFormatFlags.EndEllipsis | TextFormatFlags.NoPrefix;
            Font font = e.Font ?? _comboSchema.Font;
            SchemaEntry entry = item as SchemaEntry;
            if (header != null)
            {
                using (var bold = new Font(font, FontStyle.Bold))
                    TextRenderer.DrawText(e.Graphics, header.Text, bold, bounds, color, flags);
            }
            else if (entry != null && entry.Offline)
                DrawOfflineEntry(e.Graphics, entry, font, bounds, color, flags, selected);
            else
                TextRenderer.DrawText(e.Graphics, item.ToString(), font, bounds, color, flags);
            if (!plain)
                e.DrawFocusRectangle();
        }

        /// <summary>
        /// A schema whose Agent is not connected: its icon (and plan warning), a small red dot, then its
        /// name. On the highlight the dot is ringed with the text color so it still stands out.
        /// </summary>
        private static void DrawOfflineEntry(Graphics graphics, SchemaEntry entry, Font font, Rectangle bounds,
            Color color, TextFormatFlags flags, bool selected)
        {
            string prefix = entry.Prefix;
            int left = bounds.Left;
            if (prefix.Length > 0)
            {
                TextRenderer.DrawText(graphics, prefix, font, bounds, color, flags);
                left += TextRenderer.MeasureText(graphics, prefix, font, bounds.Size, flags & ~TextFormatFlags.EndEllipsis).Width;
            }
            int size = OfflineDotSize(font);
            int slot = OfflineDotSlot(font);
            var dot = new Rectangle(left + (slot - size) / 2, bounds.Top + (bounds.Height - size) / 2, size, size);
            SmoothingMode smoothing = graphics.SmoothingMode;
            graphics.SmoothingMode = SmoothingMode.AntiAlias;
            try
            {
                using (var brush = new SolidBrush(OfflineDotColor))
                    graphics.FillEllipse(brush, dot);
                if (selected)
                {
                    using (var pen = new Pen(color))
                        graphics.DrawEllipse(pen, dot);
                }
            }
            finally
            {
                graphics.SmoothingMode = smoothing;
            }
            left += slot;
            TextRenderer.DrawText(graphics, entry.Text, font,
                new Rectangle(left, bounds.Top, Math.Max(0, bounds.Right - left), bounds.Height), color, flags);
        }

        /// <summary>The diameter of the red dot: half the height of the text, so it follows the DPI.</summary>
        private static int OfflineDotSize(Font font)
        {
            return Math.Max(5, font.Height / 2);
        }

        /// <summary>The width the red dot takes in a line, with a little space at each side.</summary>
        private static int OfflineDotSlot(Font font)
        {
            return OfflineDotSize(font) * 3 / 2;
        }

        private void ComboSchema_DropDown(object sender, EventArgs e)
        {
            // As wide as the longest entry (its red dot included): at least the combo, at most
            // MaxDropDownWidth or the screen
            int width = 0;
            foreach (object item in _comboSchema.Items)
            {
                Font font = item is GroupHeaderItem ? new Font(_comboSchema.Font, FontStyle.Bold) : _comboSchema.Font;
                try
                {
                    int itemWidth = TextRenderer.MeasureText(item.ToString(), font).Width + ItemIndent + 8;
                    SchemaEntry entry = item as SchemaEntry;
                    if (entry != null && entry.Offline)
                        itemWidth += OfflineDotSlot(font);
                    width = Math.Max(width, itemWidth);
                }
                finally
                {
                    if (font != _comboSchema.Font)
                        font.Dispose();
                }
            }
            if (_comboSchema.Items.Count > _comboSchema.MaxDropDownItems)
                width += SystemInformation.VerticalScrollBarWidth;
            int maxWidth = Math.Min(_comboSchema.LogicalToDeviceUnits(MaxDropDownWidth), Screen.FromControl(this).WorkingArea.Width);
            _comboSchema.DropDownWidth = Math.Max(_comboSchema.Width, Math.Min(width, maxWidth));
        }

        // ===== Items =====

        /// <summary>A non-selectable group title of the list.</summary>
        private sealed class GroupHeaderItem
        {
            public GroupHeaderItem(string text)
            {
                Text = text ?? "";
            }

            public readonly string Text;

            public override string ToString() { return Text; }
        }

        private enum ActionKind
        {
            NewLocalSchema,
            NewCloudSchema
        }

        /// <summary>An entry at the end of the list that runs an action instead of being selected.</summary>
        private sealed class ActionItem
        {
            public ActionItem(ActionKind kind)
            {
                Kind = kind;
            }

            public readonly ActionKind Kind;
            public string Text = "";
            public bool Enabled;
            /// <summary>Why it is disabled, shown with it ("" when there is nothing to say).</summary>
            public string Reason = "";
            /// <summary>The first action: a line separates it from the schemas.</summary>
            public bool First;

            public override string ToString()
            {
                return Reason.Length > 0 ? Text + " (" + Reason + ")" : Text;
            }
        }

        /// <summary>A schema of the list, local or of the Hub, with what it would send to the AI.</summary>
        private abstract class SchemaEntry
        {
            /// <summary>Tables that would travel, or -1 when not known.</summary>
            public int Tables = -1;
            /// <summary>Columns of the widest of them.</summary>
            public int WidestColumns;
            /// <summary>True when it passes the plan's limits with the cloud AI.</summary>
            public bool OverPlan;

            public abstract string Name { get; }

            /// <summary>The icon before the text: local or cloud.</summary>
            public abstract string Icon { get; }

            /// <summary>True when the Agent that serves it is not connected: a red dot goes before the name.</summary>
            public virtual bool Offline { get { return false; } }

            /// <summary>What goes before the name: the icon and, over the plan, the warning.</summary>
            public string Prefix
            {
                get { return Icon + (OverPlan ? WarningSign : ""); }
            }

            /// <summary>The name and the number of tables.</summary>
            public string Text
            {
                get { return Name + (Tables >= 0 ? " (" + Tables + ")" : ""); }
            }

            public string Caption
            {
                get { return Prefix + Text; }
            }

            public override string ToString() { return Caption; }
        }

        /// <summary>
        /// A subschema of the local schema of a direct connection for the combo box.
        /// </summary>
        private sealed class LocalSchemaItem : SchemaEntry
        {
            public LocalSchemaItem(string alias, string subschema)
            {
                Alias = alias ?? "";
                Subschema = subschema ?? "";
            }

            public readonly string Alias;
            public readonly string Subschema;

            public override string Name
            {
                get { return Alias + " · " + Subschema; }
            }

            public override string Icon { get { return LocalIcon; } }
        }

        /// <summary>
        /// Schema data item for the combo box.
        /// </summary>
        private sealed class SchemaItem : SchemaEntry
        {
            /// <summary>The label: «schema - Agent» (<see cref="HubSchema.Label"/>).</summary>
            public string DisplayName = "";
            public long HubDatabaseId;
            public long HubSchemaId;
            public string ApiKey = "";
            /// <summary>Whether its Agent is connected; null when the cloud does not say (no dot).</summary>
            public bool? IsOnline;

            public override string Name { get { return DisplayName; } }

            public override string Icon { get { return CloudIcon; } }

            public override bool Offline { get { return IsOnline == false; } }
        }
    }
}
