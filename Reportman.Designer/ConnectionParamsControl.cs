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

        public ConnectionParamsControl()
        {
            BuildUi();
            LoadProviders();
        }

        private void BuildUi()
        {
            Size = new Size(620, 460);

            TableLayoutPanel root = new TableLayoutPanel();
            root.Dock = DockStyle.Fill;
            root.ColumnCount = 1;
            root.RowCount = 4;
            root.ColumnStyles.Add(new ColumnStyle(SizeType.Percent, 100F));
            root.RowStyles.Add(new RowStyle(SizeType.AutoSize));   // driver row
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
            lblDriver.Text = "Driver:";
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

            // --- Property grid (dynamic parameters) ---
            grid = new PropertyGrid();
            grid.Dock = DockStyle.Fill;
            grid.ToolbarVisible = false;
            grid.HelpVisible = true;
            grid.PropertySort = PropertySort.Categorized;
            grid.PropertyValueChanged += Grid_PropertyValueChanged;
            root.Controls.Add(grid, 0, 1);

            // --- Connection string preview/edit ---
            TableLayoutPanel pconn = new TableLayoutPanel();
            pconn.Dock = DockStyle.Fill;
            pconn.ColumnCount = 1;
            pconn.RowCount = 2;
            pconn.AutoSize = true;
            lblConn = new Label();
            lblConn.Text = "Connection string:";
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
            root.Controls.Add(pconn, 0, 2);

            // --- Test row ---
            FlowLayoutPanel ptest = new FlowLayoutPanel();
            ptest.Dock = DockStyle.Fill;
            ptest.AutoSize = true;
            ptest.WrapContents = false;
            btnTest = new Button();
            btnTest.Text = "Test connection";
            btnTest.AutoSize = true;
            btnTest.Click += BtnTest_Click;
            lblResult = new Label();
            lblResult.AutoSize = true;
            lblResult.Anchor = AnchorStyles.Left;
            lblResult.Margin = new Padding(8, 8, 3, 0);
            ptest.Controls.Add(btnTest);
            ptest.Controls.Add(lblResult);
            root.Controls.Add(ptest, 0, 3);

            Controls.Add(root);

            // Apply translated captions when available (fall back to English literals)
            TryTranslate();
        }

        private void TryTranslate()
        {
            try { btnTest.Text = "Test connection"; }
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
            cmbProvider.Items.Add(new ProviderItem { Invariant = HTTP_AGENT, Display = "Reportman Agent (HTTP) — needs API key" });
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
            lblConn.Text = "Storage:";
            FUpdating = true;
            txtConn.ReadOnly = true;
            txtConn.Text = "API key & selected database are stored in dbxconnections.ini" +
                Environment.NewLine + "Path: " + DbxConnections.GetPath();
            FUpdating = false;
            SetResult(null, "");
        }

        private void ExitAgentMode()
        {
            FAgentMode = false;
            lblConn.Text = "Connection string:";
            txtConn.ReadOnly = false;
        }

        private void TestAgent()
        {
            string ak = AgentApiKey.Trim();
            if (ak.Length == 0)
            {
                SetResult(false, "API key is required.");
                return;
            }
            Cursor old = Cursor.Current;
            Cursor.Current = Cursors.WaitCursor;
            try
            {
                List<string> raw = System.Threading.Tasks.Task.Run(() =>
                    RpAuthManager.Instance.GetApiKeySchemasAsync(ak)).GetAwaiter().GetResult();
                HashSet<long> ids = new HashSet<long>();
                foreach (string s in raw)
                {
                    int eq = s.LastIndexOf('=');
                    if (eq < 0) continue;
                    string idp = s.Substring(eq + 1);
                    int bar = idp.IndexOf('|');
                    string idstr = bar >= 0 ? idp.Substring(0, bar) : idp;
                    long id;
                    if (long.TryParse(idstr.Trim(), out id) && id > 0)
                        ids.Add(id);
                }
                if (ids.Count == 0)
                {
                    SetResult(false, "API key accepted but no databases were returned (or the Hub is unreachable).");
                    return;
                }
                long sel = AgentHubDatabaseId;
                if (sel > 0 && !ids.Contains(sel))
                    SetResult(false, "API key OK (" + ids.Count + " databases) but the selected database is not in the list.");
                else
                    SetResult(true, "API key OK — " + ids.Count + " database(s) available.");
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
                SetResult(true, "Connection successful");
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
