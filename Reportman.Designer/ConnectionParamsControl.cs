#region Copyright
/*
 *  Report Manager:  Database Reporting tool for .Net and Mono
 *
 *     The contents of this file are subject to the MPL License
 *     with optional use of GPL or LGPL licenses.
 *     You may not use this file except in compliance with the
 *     Licenses. You may obtain copies of the Licenses at:
 *     http://reportman.sourceforge.net/license
 *
 *  Copyright (c) 1994 - 2026 Toni Martir (toni@reportman.es)
 *  All Rights Reserved.
*/
#endregion

using Reportman.Reporting;
using System;
using System.Collections.Generic;
using System.Data;
using System.Data.Common;
using System.Drawing;
using System.Windows.Forms;

namespace Reportman.Designer
{
    /// <summary>
    /// Reusable connection assistant. Lets the user pick a .Net provider (driver),
    /// edits its connection parameters dynamically through the provider's own
    /// <see cref="DbConnectionStringBuilder"/> bound to a <see cref="PropertyGrid"/>
    /// (works for ANY registered provider), shows the resulting connection string
    /// and tests the connection. The only persisted value is the connection string
    /// plus the provider factory invariant name (no JSON).
    /// </summary>
    public class ConnectionParamsControl : UserControl
    {
        private ComboBox cmbProvider;
        private PropertyGrid grid;
        private TextBox txtConn;
        private Button btnTest;
        private Label lblResult;
        private Label lblDriver;
        private Label lblConn;
        // Agent mode: the note under the driver (the session, the example connections) and "Log in"
        private Panel pagent;
        private TableLayoutPanel FRoot;
        private RowStyle FAgentRow;
        private Label lblAgentNote;
        private Button btnAgentLogin;
        private int FAgentListVersion;

        private DbConnectionStringBuilder FBuilder;
        private string FInvariant = "";
        private bool FUpdating;
        private bool? FLastOk;
        private string FLastMessage = "";

        /// <summary>Synthetic combo entry that selects the Reportman HTTP Agent "driver".</summary>
        public const string HTTP_AGENT = "__HTTPAGENT__";
        private HttpAgentParams FAgentParams;
        private bool FAgentMode;

        /// <summary>True when the HTTP Agent "driver" is selected.</summary>
        public bool IsHttpAgent { get { return FAgentMode; } }
        /// <summary>Agent API key (only meaningful in agent mode).</summary>
        public string AgentApiKey { get { return FAgentParams != null ? (FAgentParams.ApiKey ?? "") : ""; } }
        /// <summary>Agent base URL (only meaningful in agent mode).</summary>
        public string AgentBaseUrl { get { return FAgentParams != null ? (FAgentParams.BaseUrl ?? "") : ""; } }
        /// <summary>Selected Hub database id (only meaningful in agent mode).</summary>
        public long AgentHubDatabaseId
        {
            get { return (FAgentParams != null && FAgentParams.Database != null) ? FAgentParams.Database.Id : 0; }
        }
        /// <summary>Selected Hub database display name (only meaningful in agent mode).</summary>
        public string AgentDatabaseName
        {
            get { return (FAgentParams != null && FAgentParams.Database != null) ? FAgentParams.Database.Name : ""; }
        }

        /// <summary>
        /// True when the selected Hub database is an example of the Hub (<see cref="HubDatabaseRef.IsExample"/>):
        /// it answers without a login nor an API key, and it is read-only.
        /// </summary>
        public bool AgentDatabaseIsExample
        {
            get { return FAgentParams != null && FAgentParams.Database != null && FAgentParams.Database.IsExample; }
        }

        /// <summary>The note of the agent mode (for diagnostics/screenshots).</summary>
        public string AgentNoteText { get { return lblAgentNote != null ? lblAgentNote.Text : ""; } }

        /// <summary>True when the "Log in" button of the agent mode is shown (no Reportman AI session).</summary>
        public bool AgentLoginVisible { get { return pagent != null && pagent.Visible && btnAgentLogin.Visible; } }

        /// <summary>
        /// The task of the last load of the Hub databases of the agent mode (the first example selected when
        /// there is no database yet), for the self-tests; null before the first one.
        /// </summary>
        public System.Threading.Tasks.Task AgentListLoad { get; private set; }

        /// <summary>Last test connection result message (for diagnostics/screenshots).</summary>
        public string LastResultText { get { return FLastMessage; } }
        /// <summary>Last test connection outcome: null=not tested, true/false.</summary>
        public bool? LastOk { get { return FLastOk; } }
        /// <summary>Display text of the currently selected provider.</summary>
        public string SelectedProviderDisplay
        {
            get { return cmbProvider.SelectedItem != null ? cmbProvider.SelectedItem.ToString() : ""; }
        }

        /// <summary>Scroll the parameter grid to the first property (top).</summary>
        public void ScrollToTop()
        {
            try
            {
                GridItem g = grid.SelectedGridItem;
                if (g == null)
                    return;
                while (g.Parent != null)
                    g = g.Parent;
                if (g.GridItems.Count > 0)
                {
                    GridItem first = g.GridItems[0];
                    if (first.GridItems.Count > 0)
                        grid.SelectedGridItem = first.GridItems[0];
                    else
                        grid.SelectedGridItem = first;
                }
            }
            catch { }
        }

        /// <summary>Provider factory invariant name currently selected.</summary>
        public string ProviderInvariant
        {
            get { return FInvariant; }
        }

        /// <summary>Resulting connection string (decoded/encoded through the builder).</summary>
        public string ConnectionString
        {
            get
            {
                if (FAgentMode)
                    return "";
                if (FBuilder != null)
                {
                    try { return FBuilder.ConnectionString; }
                    catch { return txtConn.Text; }
                }
                return txtConn.Text;
            }
        }

        /// <summary>
        /// Initializes a new instance of the ConnectionParamsControl class, building the UI and loading providers.
        /// </summary>
        public ConnectionParamsControl()
        {
            BuildUi();
            LoadProviders();
        }

        private void BuildUi()
        {
            Size = new Size(620, 460);

            TableLayoutPanel root = new TableLayoutPanel();
            FRoot = root;
            root.Dock = DockStyle.Fill;
            root.ColumnCount = 1;
            root.RowCount = 5;
            root.ColumnStyles.Add(new ColumnStyle(SizeType.Percent, 100F));
            root.RowStyles.Add(new RowStyle(SizeType.AutoSize));   // driver row
            // agent note: its height is set by FitAgentNote (an autosized row does not follow a text that wraps)
            FAgentRow = new RowStyle(SizeType.Absolute, 0F);
            root.RowStyles.Add(FAgentRow);
            root.RowStyles.Add(new RowStyle(SizeType.Percent, 100F)); // property grid
            root.RowStyles.Add(new RowStyle(SizeType.AutoSize));   // conn string
            root.RowStyles.Add(new RowStyle(SizeType.AutoSize));   // test row
            root.Padding = new Padding(4);

            // --- Driver row ---
            FlowLayoutPanel pdriver = new FlowLayoutPanel();
            pdriver.Dock = DockStyle.Fill;
            pdriver.AutoSize = true;
            pdriver.WrapContents = false;
            lblDriver = new Label();
            lblDriver.Text = DesignerText.Tr(147) + ":";
            lblDriver.AutoSize = true;
            lblDriver.Anchor = AnchorStyles.Left;
            lblDriver.Margin = new Padding(3, 7, 3, 0);
            cmbProvider = new ComboBox();
            cmbProvider.DropDownStyle = ComboBoxStyle.DropDownList;
            cmbProvider.Width = 460;
            cmbProvider.SelectedIndexChanged += CmbProvider_SelectedIndexChanged;
            pdriver.Controls.Add(lblDriver);
            pdriver.Controls.Add(cmbProvider);
            root.Controls.Add(pdriver, 0, 0);

            // --- Agent note: with a session the API key is optional; without one the list has the
            // example connections, and "Log in" for the user's own; an example is read-only ---
            // Its height is the one of the text at its width (FitAgentNote): an autosized label that wraps
            // does not tell a table row its height
            pagent = new Panel();
            pagent.Dock = DockStyle.Fill;
            pagent.Margin = new Padding(3, 2, 3, 4);
            pagent.Visible = false;
            btnAgentLogin = new Button();
            btnAgentLogin.Text = DesignerText.Tr(1783, "Log in");
            btnAgentLogin.AutoSize = true;
            btnAgentLogin.Click += BtnAgentLogin_Click;
            lblAgentNote = new Label();
            lblAgentNote.AutoSize = false;
            lblAgentNote.ForeColor = SystemColors.GrayText;
            lblAgentNote.Padding = new Padding(0, 2, 8, 0);
            pagent.Controls.Add(lblAgentNote);
            pagent.Controls.Add(btnAgentLogin);
            root.Resize += (s, e) => FitAgentNote();
            root.Controls.Add(pagent, 0, 1);

            // --- Property grid (dynamic parameters) ---
            grid = new PropertyGrid();
            grid.Dock = DockStyle.Fill;
            grid.ToolbarVisible = false;
            grid.HelpVisible = true;
            grid.PropertySort = PropertySort.Categorized;
            grid.PropertyValueChanged += Grid_PropertyValueChanged;
            root.Controls.Add(grid, 0, 2);

            // --- Connection string preview/edit ---
            TableLayoutPanel pconn = new TableLayoutPanel();
            pconn.Dock = DockStyle.Fill;
            pconn.ColumnCount = 1;
            pconn.RowCount = 2;
            pconn.AutoSize = true;
            lblConn = new Label();
            lblConn.Text = DesignerText.Tr(1099) + ":";
            lblConn.AutoSize = true;
            lblConn.Margin = new Padding(0, 4, 0, 0);
            txtConn = new TextBox();
            txtConn.Multiline = true;
            txtConn.Dock = DockStyle.Fill;
            txtConn.Height = 44;
            txtConn.ScrollBars = ScrollBars.Vertical;
            txtConn.WordWrap = true;
            txtConn.Validated += TxtConn_Validated;
            pconn.Controls.Add(lblConn, 0, 0);
            pconn.Controls.Add(txtConn, 0, 1);
            root.Controls.Add(pconn, 0, 3);

            // --- Test row ---
            FlowLayoutPanel ptest = new FlowLayoutPanel();
            ptest.Dock = DockStyle.Fill;
            ptest.AutoSize = true;
            ptest.WrapContents = false;
            btnTest = new Button();
            btnTest.Text = DesignerText.Tr(1746);
            btnTest.AutoSize = true;
            btnTest.Click += BtnTest_Click;
            lblResult = new Label();
            lblResult.AutoSize = true;
            lblResult.Anchor = AnchorStyles.Left;
            lblResult.Margin = new Padding(8, 8, 3, 0);
            ptest.Controls.Add(btnTest);
            ptest.Controls.Add(lblResult);
            root.Controls.Add(ptest, 0, 4);

            Controls.Add(root);
            RpAuthManager.Instance.AuthChanged += AuthManager_AuthChanged;

            // Apply translated captions when available (fall back to English literals)
            TryTranslate();
        }

        /// <summary>Stops following the Reportman AI session.</summary>
        /// <param name="disposing">True when called from Dispose.</param>
        protected override void Dispose(bool disposing)
        {
            if (disposing)
                RpAuthManager.Instance.AuthChanged -= AuthManager_AuthChanged;
            base.Dispose(disposing);
        }

        private void AuthManager_AuthChanged(bool success)
        {
            if (IsDisposed)
                return;
            if (InvokeRequired)
            {
                try { BeginInvoke(new Action(() => AuthManager_AuthChanged(success))); } catch { }
                return;
            }
            if (FAgentMode)
            {
                UpdateAgentNote();
                // The session sees other databases
                StartAgentListLoad();
            }
        }

        private void TryTranslate()
        {
            try { btnTest.Text = DesignerText.Tr(1746); }
            catch { }
        }

        private sealed class ProviderItem
        {
            public string Invariant;
            public string Display;
            public override string ToString() { return Display; }
        }

        private static readonly Dictionary<string, string> FriendlyNames =
            new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase)
        {
            { "FirebirdSql.Data.FirebirdClient", "Firebird" },
            { "MySql.Data.MySqlClient",          "MySQL (Oracle)" },
            { "MySQLConnector",                  "MySQL (MySqlConnector)" },
            { "System.Data.SQLite",              "SQLite (System.Data.SQLite)" },
            { "SQLiteCore",                      "SQLite (Microsoft.Data.Sqlite)" },
            { "System.Data.Odbc",                "ODBC" },
            { "SQLServer",                       "SQL Server" },
            { "PostgreSQL",                      "PostgreSQL (Npgsql)" },
            { "Oracle",                          "Oracle" }
        };

        private void LoadProviders()
        {
            cmbProvider.Items.Clear();
            SortedList<string, ProviderItem> items =
                new SortedList<string, ProviderItem>(StringComparer.OrdinalIgnoreCase);

            try
            {
                DataTable dt = DbProviderFactories.GetFactoryClasses();
                if (dt != null)
                {
                    foreach (DataRow row in dt.Rows)
                    {
                        string inv = SafeCol(row, "InvariantName");
                        if (string.IsNullOrEmpty(inv))
                            continue;
                        if (!items.ContainsKey(inv))
                            items.Add(inv, new ProviderItem { Invariant = inv, Display = Friendly(inv, SafeCol(row, "Name")) });
                    }
                }
            }
            catch { }

            // Ensure the Firebird .Net provider is always offered.
            if (!items.ContainsKey(DatabaseInfo.FIREBIRD_PROVIDER2))
                items.Add(DatabaseInfo.FIREBIRD_PROVIDER2,
                    new ProviderItem { Invariant = DatabaseInfo.FIREBIRD_PROVIDER2, Display = Friendly(DatabaseInfo.FIREBIRD_PROVIDER2, null) });

            // Special HTTP Agent entry first (API key + Hub database, stored in dbxconnections.ini).
            // Not 1967 ("— needs an API key"): without one the connection uses the session, and the example
            // databases need neither
            cmbProvider.Items.Add(new ProviderItem { Invariant = HTTP_AGENT, Display = "Reportman AI Agent (HTTP)" });
            foreach (ProviderItem it in items.Values)
                cmbProvider.Items.Add(it);
        }

        private int IndexOfAgentItem()
        {
            for (int i = 0; i < cmbProvider.Items.Count; i++)
            {
                ProviderItem it = cmbProvider.Items[i] as ProviderItem;
                if (it != null && string.Equals(it.Invariant, HTTP_AGENT, StringComparison.Ordinal))
                    return i;
            }
            return -1;
        }

        private static string SafeCol(DataRow row, string col)
        {
            try
            {
                if (row.Table.Columns.Contains(col) && row[col] != DBNull.Value)
                    return row[col].ToString();
            }
            catch { }
            return "";
        }

        private static string Friendly(string invariant, string name)
        {
            string friendly;
            if (FriendlyNames.TryGetValue(invariant, out friendly))
                return friendly + "  (" + invariant + ")";
            if (!string.IsNullOrEmpty(name) && !string.Equals(name, invariant, StringComparison.OrdinalIgnoreCase))
                return name + "  (" + invariant + ")";
            return invariant;
        }

        /// <summary>Run the connection test programmatically (used by /dbconfig screenshots).</summary>
        public void TestConnection()
        {
            BtnTest_Click(this, EventArgs.Empty);
        }

        /// <summary>
        /// Initialize the control with an existing provider + connection string
        /// (decodes the connection string into the parameter grid).
        /// </summary>
        public void Populate(string providerInvariant, string connectionString)
        {
            if (!string.IsNullOrEmpty(providerInvariant) &&
                string.Equals(providerInvariant, HTTP_AGENT, StringComparison.Ordinal))
            {
                SelectHttpAgent();
                return;
            }
            string inv = providerInvariant;
            if (string.IsNullOrEmpty(inv))
                inv = DatabaseInfo.FIREBIRD_PROVIDER2;

            int found = -1;
            for (int i = 0; i < cmbProvider.Items.Count; i++)
            {
                ProviderItem it = (ProviderItem)cmbProvider.Items[i];
                if (string.Equals(it.Invariant, inv, StringComparison.OrdinalIgnoreCase))
                {
                    found = i;
                    break;
                }
            }
            if (found < 0)
            {
                // Provider not in the registered list: add it so it can still be edited.
                cmbProvider.Items.Add(new ProviderItem { Invariant = inv, Display = Friendly(inv, null) });
                found = cmbProvider.Items.Count - 1;
            }

            FUpdating = true;
            cmbProvider.SelectedIndex = found;
            FUpdating = false;
            LoadProvider(inv, connectionString);
        }

        private void CmbProvider_SelectedIndexChanged(object sender, EventArgs e)
        {
            if (FUpdating)
                return;
            ProviderItem it = cmbProvider.SelectedItem as ProviderItem;
            if (it == null)
                return;
            if (string.Equals(it.Invariant, HTTP_AGENT, StringComparison.Ordinal))
            {
                EnterAgentMode();
                return;
            }
            bool wasAgent = FAgentMode;
            if (FAgentMode)
                ExitAgentMode();
            // Preserve already entered values when switching provider.
            string keep = wasAgent ? "" : ConnectionString;
            LoadProvider(it.Invariant, keep);
        }

        // ---------------- HTTP Agent mode ----------------

        /// <summary>Select the HTTP Agent "driver" entry and switch the grid to agent params.</summary>
        public void SelectHttpAgent()
        {
            int idx = IndexOfAgentItem();
            if (idx < 0)
                return;
            FUpdating = true;
            cmbProvider.SelectedIndex = idx;
            FUpdating = false;
            EnterAgentMode();
        }

        /// <summary>Pre-fill the agent fields (used when editing an existing agent connection).</summary>
        public void PopulateHttpAgent(string apiKey, string baseUrl, long hubDatabaseId, string databaseName)
        {
            if (FAgentParams == null)
                FAgentParams = new HttpAgentParams();
            FAgentParams.ApiKey = apiKey ?? "";
            FAgentParams.BaseUrl = baseUrl ?? "";
            string name = string.IsNullOrEmpty(databaseName)
                ? (hubDatabaseId > 0 ? "(database " + hubDatabaseId + ")" : "")
                : databaseName;
            FAgentParams.Database = new HubDatabaseRef { Id = hubDatabaseId, Name = name };
            FAgentParams.LastList = new List<HubDatabaseRef>();
            if (hubDatabaseId > 0)
                FAgentParams.LastList.Add(FAgentParams.Database);

            int idx = IndexOfAgentItem();
            FUpdating = true;
            if (idx >= 0)
                cmbProvider.SelectedIndex = idx;
            FUpdating = false;
            EnterAgentMode();
        }

        private void EnterAgentMode()
        {
            FAgentMode = true;
            FInvariant = "";
            FBuilder = null;
            if (FAgentParams == null)
                FAgentParams = new HttpAgentParams();
            grid.SelectedObject = FAgentParams;
            try { grid.ExpandAllGridItems(); }
            catch { }
            lblConn.Text = DesignerText.Tr(1968) + ":";
            FUpdating = true;
            txtConn.ReadOnly = true;
            txtConn.Text = DesignerText.Tr(1969) +
                Environment.NewLine + DesignerText.Tr(1970) + ": " + DbxConnections.GetPath();
            FUpdating = false;
            SetResult(null, "");
            pagent.Visible = true;
            UpdateAgentNote();
            FitAgentNote();
            // The databases of the key, of the session or, without them, the examples: without a
            // database yet the first example is selected, the connection works without anything else
            StartAgentListLoad();
        }

        private void ExitAgentMode()
        {
            FAgentMode = false;
            FAgentListVersion++;
            pagent.Visible = false;
            FitAgentNote();
            lblConn.Text = DesignerText.Tr(1099) + ":";
            txtConn.ReadOnly = false;
        }

        /// <summary>
        /// The note of the agent mode: with a session the API key is optional (without it the connection uses
        /// the session and the report cannot run unattended); without one the list has the example connections
        /// and "Log in" is offered for the user's own. With an example selected, that it is read-only.
        /// </summary>
        private void UpdateAgentNote()
        {
            if (lblAgentNote == null)
                return;
            bool signedIn = RpAuthManager.Instance.IsLoggedIn;
            string note = signedIn
                ? DesignerText.Tr(1831, "You are signed in to Reportman AI: the API key is optional. Without it " +
                    "the connection uses your session, and the report cannot run unattended on this computer " +
                    "(printreptopdf, server, scheduled tasks).")
                : DesignerText.Tr(2055, "You are not signed in to Reportman AI: the list has the example " +
                    "connections. To use your own, log in or enter the API key.");
            if (AgentDatabaseIsExample)
                note += Environment.NewLine + DemoChip.Hint;
            lblAgentNote.Text = note;
            btnAgentLogin.Visible = !signedIn;
            FitAgentNote();
        }

        /// <summary>
        /// The note of the agent mode at the width it has: the text wrapped at its left, "Log in" at the top right,
        /// and the height of the text (or of the button).
        /// </summary>
        private void FitAgentNote()
        {
            if (pagent == null || lblAgentNote == null || FRoot == null)
                return;
            if (!FAgentMode)
            {
                FAgentRow.Height = 0F;
                return;
            }
            // The width of the column, not the one of the panel: it is laid out after its row
            int width = FRoot.ClientSize.Width - FRoot.Padding.Horizontal - pagent.Margin.Horizontal;
            Size button = btnAgentLogin.Visible ? btnAgentLogin.PreferredSize : Size.Empty;
            int labelWidth = width - button.Width;
            int textWidth = labelWidth - lblAgentNote.Padding.Horizontal;
            if (textWidth < 50)
                return;
            Size text = TextRenderer.MeasureText(lblAgentNote.Text, lblAgentNote.Font, new Size(textWidth, 0),
                TextFormatFlags.WordBreak | TextFormatFlags.TextBoxControl);
            int height = Math.Max(text.Height + lblAgentNote.Padding.Vertical + 2, button.Height);
            lblAgentNote.Bounds = new Rectangle(0, 0, labelWidth, height);
            if (btnAgentLogin.Visible)
                btnAgentLogin.Bounds = new Rectangle(labelWidth, 0, button.Width, button.Height);
            float rowHeight = height + pagent.Margin.Vertical;
            if (FAgentRow.Height != rowHeight)
                FAgentRow.Height = rowHeight;
        }

        private void BtnAgentLogin_Click(object sender, EventArgs e)
        {
            using (var form = new AILoginForm())
                form.ShowDialog(FindForm());
            // AuthChanged updates the note and the list; again in case it was not raised
            if (FAgentMode)
            {
                UpdateAgentNote();
                StartAgentListLoad();
            }
        }

        private void StartAgentListLoad()
        {
            AgentListLoad = LoadAgentListAsync();
        }

        /// <summary>
        /// Reads the Hub databases of the key (or the session, or the examples) for the selected one: its name and
        /// whether it is an example; without a database yet, the first example.
        /// </summary>
        private async System.Threading.Tasks.Task LoadAgentListAsync()
        {
            int version = ++FAgentListVersion;
            string apiKey = AgentApiKey.Trim();
            List<HubDatabaseRef> list;
            try
            {
                list = await System.Threading.Tasks.Task.Run(() => HttpAgentParams.LoadDatabasesAsync(apiKey));
            }
            catch (Exception ex)
            {
                RpAuthManager.Instance.Log("Hub database list error: " + ex.Message);
                return;
            }
            if (IsDisposed || !FAgentMode || version != FAgentListVersion || FAgentParams == null)
                return;
            FAgentParams.LastList = list;
            HubDatabaseRef selected = null;
            long id = AgentHubDatabaseId;
            foreach (HubDatabaseRef item in list)
            {
                if (id > 0 ? item.Id == id : item.IsExample)
                {
                    selected = item;
                    break;
                }
            }
            if (selected != null)
            {
                FAgentParams.Database = selected;
                grid.Refresh();
            }
            UpdateAgentNote();
        }

        private void TestAgent()
        {
            string ak = AgentApiKey.Trim();
            if (ak.Length == 0)
            {
                TestAgentWithoutKey();
                return;
            }
            Cursor old = Cursor.Current;
            Cursor.Current = Cursors.WaitCursor;
            try
            {
                List<HubSchema> schemas = System.Threading.Tasks.Task.Run(() =>
                    RpAuthManager.Instance.GetApiKeySchemasAsync(ak)).GetAwaiter().GetResult();
                HashSet<long> ids = new HashSet<long>();
                long sel = AgentHubDatabaseId;
                // The cloud lists the databases of an Agent that is not connected too: the key is
                // right, but their data cannot be opened until it comes back
                bool offline = false;
                foreach (HubSchema schema in schemas)
                {
                    if (schema.HubDatabaseId <= 0)
                        continue;
                    ids.Add(schema.HubDatabaseId);
                    if (schema.HubDatabaseId == sel && schema.IsOnline == false)
                        offline = true;
                }
                if (ids.Count == 0)
                {
                    SetResult(false, DesignerText.Tr(1675));
                    return;
                }
                if (sel > 0 && !ids.Contains(sel))
                    SetResult(false, DesignerText.Format(1971, ids.Count.ToString()));
                else if (offline)
                    SetResult(false, DesignerText.Tr(2004));
                else
                    SetResult(true, DesignerText.Format(1972, ids.Count.ToString()));
            }
            catch (Exception ex)
            {
                SetResult(false, ex.Message);
            }
            finally
            {
                Cursor.Current = old;
            }
        }

        /// <summary>
        /// The test of a connection without an API key, as it will run: with the session, or with nothing (the example
        /// databases answer to everybody, the Hub refuses the others with the clear error of the engine).
        /// </summary>
        private void TestAgentWithoutKey()
        {
            if (AgentHubDatabaseId <= 0)
            {
                SetResult(false, DesignerText.Tr(1756, "Please choose a Reportman AI connection."));
                return;
            }
            string name = AgentDatabaseName;
            if (name.EndsWith(DemoChip.TextSuffix, StringComparison.Ordinal))
                name = name.Substring(0, name.Length - DemoChip.TextSuffix.Length);
            var executor = new HttpAgentExecutor
            {
                BaseUrl = AgentBaseUrl.Trim().Length > 0 ? AgentBaseUrl.Trim() : RpAuthManager.HUB_API_URL,
                ApiKey = "",
                Token = RpAuthManager.Instance.Token,
                InstallId = RpAuthManager.Instance.InstallId,
                HubDatabaseId = AgentHubDatabaseId,
                ConnectionName = name
            };
            Cursor old = Cursor.Current;
            Cursor.Current = Cursors.WaitCursor;
            try
            {
                System.Threading.Tasks.Task.Run(() => executor.TestConnection()).GetAwaiter().GetResult();
                SetResult(true, DesignerText.Tr(1772, "Connection succeeded."));
            }
            catch (Exception ex)
            {
                SetResult(false, ex.Message);
            }
            finally
            {
                Cursor.Current = old;
            }
        }

        private void LoadProvider(string invariant, string connectionString)
        {
            FInvariant = invariant;
            DbProviderFactory factory = null;
            try { factory = DbProviderFactories.GetFactory(invariant); }
            catch { factory = null; }

            DbConnectionStringBuilder b = null;
            if (factory != null)
            {
                try { b = factory.CreateConnectionStringBuilder(); }
                catch { b = null; }
            }
            if (b == null)
                b = new DbConnectionStringBuilder();

            if (!string.IsNullOrEmpty(connectionString))
            {
                try { b.ConnectionString = connectionString; }
                catch { /* incompatible string for this provider: start clean */ }
            }

            FBuilder = b;
            grid.SelectedObject = FBuilder;
            try { grid.ExpandAllGridItems(); }
            catch { }
            UpdateConnText();
            SetResult(null, "");
        }

        private void Grid_PropertyValueChanged(object s, PropertyValueChangedEventArgs e)
        {
            UpdateConnText();
            SetResult(null, "");
            if (FAgentMode)
            {
                UpdateAgentNote();
                // Another key sees other databases: the name of the selected one, and whether it is an example
                if (e != null && e.ChangedItem != null && e.ChangedItem.PropertyDescriptor != null &&
                    e.ChangedItem.PropertyDescriptor.Name == "ApiKey")
                    StartAgentListLoad();
            }
        }

        private void UpdateConnText()
        {
            FUpdating = true;
            try
            {
                if (FBuilder != null)
                    txtConn.Text = FBuilder.ConnectionString;
            }
            catch { }
            finally { FUpdating = false; }
        }

        private void TxtConn_Validated(object sender, EventArgs e)
        {
            if (FUpdating || FBuilder == null)
                return;
            try
            {
                FBuilder.ConnectionString = txtConn.Text;
                grid.Refresh();
                SetResult(null, "");
            }
            catch
            {
                // Leave the raw text as typed; it will still be used on Test/OK.
            }
        }

        private void BtnTest_Click(object sender, EventArgs e)
        {
            if (FAgentMode)
            {
                TestAgent();
                return;
            }
            string cs = ConnectionString;
            Cursor old = Cursor.Current;
            Cursor.Current = Cursors.WaitCursor;
            try
            {
                // Test connectivity straight through the provider factory (same path
                // DatabaseInfo.Connect uses, but without needing a Report context).
                DbProviderFactory factory = null;
                if (DatabaseInfo.CustomProviderFactories.IndexOfKey(FInvariant) >= 0)
                    factory = DatabaseInfo.CustomProviderFactories[FInvariant];
                if (factory == null)
                    factory = DbProviderFactories.GetFactory(FInvariant);
                if (factory == null)
                    throw new Exception("Provider factory not found: " + FInvariant);

                using (DbConnection conn = factory.CreateConnection())
                {
                    if (conn == null)
                        throw new Exception("Could not create a connection for: " + FInvariant);
                    conn.ConnectionString = cs;
                    conn.Open();
                    conn.Close();
                }
                SetResult(true, DesignerText.Tr(1772));
            }
            catch (Exception ex)
            {
                SetResult(false, ex.Message);
            }
            finally
            {
                Cursor.Current = old;
            }
        }

        private void SetResult(bool? ok, string message)
        {
            FLastOk = ok;
            FLastMessage = ok == null ? "" : message;
            if (ok == null)
            {
                lblResult.Text = "";
                return;
            }
            lblResult.ForeColor = ok.Value ? Color.Green : Color.Firebrick;
            lblResult.Text = (ok.Value ? "✔ " : "✖ ") + message;
        }
    }
}
