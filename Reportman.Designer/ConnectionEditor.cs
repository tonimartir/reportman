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

using Reportman.Drawing;
using Reportman.Reporting;
using System;
using System.Drawing;
using System.Windows.Forms;

namespace Reportman.Designer
{
    /// <summary>
    /// Connection assistant dialog. Hosts a <see cref="ConnectionParamsControl"/>
    /// (driver picker + dynamic parameter grid + test) and OK/Cancel. Opened from
    /// the object inspector "Connection String" property and from the new report
    /// wizard. For a .Net provider the connection string is stored in the report;
    /// for the HTTP Agent driver the API key + Hub database are stored in
    /// dbxconnections.ini (Delphi-compatible) and the report only keeps the alias.
    /// A connection of this computer (a <c>DriverName=ADO.NET</c> section of
    /// dbxconnections.ini, written by Reportman.Server or Reportman AI) is chosen
    /// from the driver list and, as the Agent's, the report only keeps its alias.
    /// </summary>
    public partial class ConnectionEditor : UserControl
    {
        private ConnectionParamsControl FParams;
        private Button BOK;
        private Button bcancel;

        /// <summary>Result of editing a connection.</summary>
        public struct ConnResult
        {
            /// <summary>Gets a value indicating whether the connection uses the HTTP Agent driver.</summary>
            public bool IsAgent;
            /// <summary>Gets the database provider invariant name.</summary>
            public string ProviderInvariant;
            /// <summary>Gets the ADO connection string.</summary>
            public string ConnectionString;
            /// <summary>Gets the HTTP Agent API key.</summary>
            public string AgentApiKey;
            /// <summary>Gets the HTTP Agent API base URL.</summary>
            public string AgentBaseUrl;
            /// <summary>Gets the HTTP Agent Hub database identifier.</summary>
            public long AgentHubDatabaseId;
            /// <summary>
            /// Gets a value indicating whether a connection of this computer was chosen (a <c>DriverName=ADO.NET</c>
            /// section of dbxconnections.ini): the report keeps only its alias.
            /// </summary>
            public bool IsLocal;
            /// <summary>Gets the alias of the connection of this computer.</summary>
            public string LocalAlias;
        }

        /// <summary>
        /// Initializes a new instance of the ConnectionEditor dialog class.
        /// </summary>
        public ConnectionEditor()
        {
            InitializeComponent();
            BuildUi();
        }

        private void BuildUi()
        {
            Dock = DockStyle.Fill;

            TableLayoutPanel root = new TableLayoutPanel();
            root.Dock = DockStyle.Fill;
            root.ColumnCount = 1;
            root.RowCount = 2;
            root.ColumnStyles.Add(new ColumnStyle(SizeType.Percent, 100F));
            root.RowStyles.Add(new RowStyle(SizeType.Percent, 100F));
            root.RowStyles.Add(new RowStyle(SizeType.AutoSize));

            FParams = new ConnectionParamsControl();
            FParams.Dock = DockStyle.Fill;
            root.Controls.Add(FParams, 0, 0);

            FlowLayoutPanel buttons = new FlowLayoutPanel();
            buttons.Dock = DockStyle.Fill;
            buttons.AutoSize = true;
            buttons.FlowDirection = FlowDirection.RightToLeft;
            buttons.Padding = new Padding(6);

            bcancel = new Button();
            bcancel.Text = Translator.TranslateStr(94);
            bcancel.AutoSize = true;
            bcancel.MinimumSize = new Size(110, 30);
            bcancel.Click += bcancel_Click;

            BOK = new Button();
            BOK.Text = Translator.TranslateStr(93);
            BOK.AutoSize = true;
            BOK.MinimumSize = new Size(110, 30);
            BOK.Click += BOK_Click;

            buttons.Controls.Add(bcancel);
            buttons.Controls.Add(BOK);
            root.Controls.Add(buttons, 0, 1);

            Controls.Add(root);
        }

        private void BOK_Click(object sender, EventArgs e)
        {
            FindForm().DialogResult = DialogResult.OK;
        }

        private void bcancel_Click(object sender, EventArgs e)
        {
            FindForm().DialogResult = DialogResult.Cancel;
        }

        /// <summary>
        /// Edit the connection of an existing report DatabaseInfo. Keeps the historical
        /// signature used by the object inspector. On OK it updates the DatabaseInfo
        /// driver/provider factory/connection string (HTTP Agent → provider factory
        /// empty + connection string empty, params written to dbxconnections.ini).
        /// </summary>
        public static bool ShowDialog(ref string sql, FrameMainDesigner framemain, string datainfotalias)
        {
            DatabaseInfo dbinfo = framemain.Report.DatabaseInfo[datainfotalias];
            bool prefillAgent = dbinfo != null && dbinfo.Driver == DriverType.HttpAgent;
            string ak = "";
            string url = "";
            long hubid = 0;
            if (prefillAgent)
                DbxConnections.ReadAgent(datainfotalias, out ak, out hubid, out url);
            string provider = dbinfo != null ? dbinfo.ProviderFactory : "";
            // A connection of this computer: the report keeps only its alias, the connections file the rest
            string localAlias = null;
            if (!prefillAgent && dbinfo != null && string.IsNullOrEmpty(provider) && string.IsNullOrEmpty(sql) &&
                DbxConnections.FindDirectConnection(datainfotalias) != null)
                localAlias = datainfotalias;

            ConnResult res;
            if (!Edit(provider, sql, prefillAgent, ak, url, hubid, localAlias, framemain.FindForm(), out res))
                return false;

            if (res.IsLocal)
            {
                string error;
                if (!ApplyLocal(framemain.Report, dbinfo, res.LocalAlias, out error))
                {
                    MessageBox.Show(framemain.FindForm(), error, Translator.TranslateStr(1979),
                        MessageBoxButtons.OK, MessageBoxIcon.Warning);
                    return false;
                }
                sql = "";
                framemain.RefreshDataItem(dbinfo);
            }
            else if (res.IsAgent)
            {
                if (dbinfo != null)
                {
                    dbinfo.Driver = DriverType.HttpAgent;
                    dbinfo.ProviderFactory = "";
                }
                sql = "";
                try
                {
                    DbxConnections.WriteAgent(datainfotalias, res.AgentApiKey, res.AgentHubDatabaseId, res.AgentBaseUrl);
                }
                catch (Exception ex)
                {
                    MessageBox.Show(framemain.FindForm(),
                        Translator.TranslateStr(1758) + ex.Message,
                        "dbxconnections", MessageBoxButtons.OK, MessageBoxIcon.Warning);
                }
            }
            else
            {
                if (dbinfo != null)
                {
                    dbinfo.Driver = DriverType.DotNet2;
                    dbinfo.ProviderFactory = res.ProviderInvariant;
                }
                sql = res.ConnectionString;
            }
            return true;
        }

        /// <summary>
        /// Generic entry point: shows the assistant and returns the user's choices.
        /// Used by /dbconfig and by ShowDialog. When <paramref name="prefillAgent"/>
        /// is true the dialog opens in HTTP Agent mode with the given parameters.
        /// </summary>
        public static bool Edit(string provider, string connstr, bool prefillAgent,
            string agentApiKey, string agentBaseUrl, long agentHubDbId,
            IWin32Window owner, out ConnResult result)
        {
            return Edit(provider, connstr, prefillAgent, agentApiKey, agentBaseUrl, agentHubDbId, null, owner, out result);
        }

        /// <summary>
        /// The report connection <paramref name="dbinfo"/> becomes the connection of this computer
        /// <paramref name="localAlias"/>: only its alias stays in the report (driver Dot Net 2, no provider factory nor
        /// connection string), and the engine reads the rest from dbxconnections.ini. A connection with another alias
        /// is renamed, and its datasets follow it. False (with the reason) when the report already has another
        /// connection with that alias.
        /// </summary>
        public static bool ApplyLocal(Report report, DatabaseInfo dbinfo, string localAlias, out string error)
        {
            error = "";
            if (dbinfo == null || string.IsNullOrWhiteSpace(localAlias))
                return false;
            string oldAlias = dbinfo.Alias ?? "";
            if (!string.Equals(oldAlias, localAlias, StringComparison.Ordinal))
            {
                if (report != null)
                {
                    foreach (DatabaseInfo other in report.DatabaseInfo)
                    {
                        if (other != dbinfo && string.Equals(other.Alias, localAlias, StringComparison.OrdinalIgnoreCase))
                        {
                            error = Translator.TranslateStr(505).TrimEnd(':', ' ') + ": " + localAlias;
                            return false;
                        }
                    }
                    foreach (DataInfo dataset in report.DataInfo)
                        if (string.Equals(dataset.DatabaseAlias, oldAlias, StringComparison.OrdinalIgnoreCase))
                            dataset.DatabaseAlias = localAlias;
                }
                dbinfo.Alias = localAlias;
            }
            dbinfo.Driver = DriverType.DotNet2;
            dbinfo.ProviderFactory = "";
            dbinfo.ConnectionString = "";
            return true;
        }

        /// <summary>
        /// Generic entry point: shows the assistant and returns the user's choices. When
        /// <paramref name="prefillAgent"/> is true the dialog opens in HTTP Agent mode with the given parameters;
        /// with <paramref name="localAlias"/>, on that connection of this computer.
        /// </summary>
        public static bool Edit(string provider, string connstr, bool prefillAgent,
            string agentApiKey, string agentBaseUrl, long agentHubDbId, string localAlias,
            IWin32Window owner, out ConnResult result)
        {
            result = new ConnResult();
            using (Form newform = new Form())
            {
                newform.ShowIcon = false;
                newform.ShowInTaskbar = false;
                newform.StartPosition = FormStartPosition.CenterScreen;
                newform.Text = Translator.TranslateStr(1979);
                newform.Width = Convert.ToInt32(720 * Reportman.Drawing.Windows.GraphicUtils.DPIScale);
                newform.Height = Convert.ToInt32(560 * Reportman.Drawing.Windows.GraphicUtils.DPIScale);

                ConnectionEditor dia = new ConnectionEditor();
                newform.Controls.Add(dia);
                if (prefillAgent)
                    dia.FParams.PopulateHttpAgent(agentApiKey, agentBaseUrl, agentHubDbId, "");
                else if (string.IsNullOrEmpty(localAlias) || !dia.FParams.SelectLocal(localAlias))
                    dia.FParams.Populate(provider, connstr);

                if (newform.ShowDialog(owner) != DialogResult.OK)
                    return false;

                result.IsLocal = dia.FParams.IsLocal;
                result.LocalAlias = dia.FParams.LocalAlias;
                result.IsAgent = dia.FParams.IsHttpAgent;
                result.ProviderInvariant = dia.FParams.ProviderInvariant;
                result.ConnectionString = dia.FParams.ConnectionString;
                result.AgentApiKey = dia.FParams.AgentApiKey;
                result.AgentBaseUrl = dia.FParams.AgentBaseUrl;
                result.AgentHubDatabaseId = dia.FParams.AgentHubDatabaseId;

#if NET8_0_OR_GREATER
                // The connection settings (e.g. ApiKey / HubDatabaseId) may have
                // changed in the dialog. Invalidate the cached warm Direct Channel
                // sessions so the next data fetch / report run uses the new values
                // instead of reusing a session opened with the previous ones — no
                // application restart needed. (net48 has no Direct Channel pool —
                // HTTP only — so there is nothing to invalidate there.)
                DirectAgentExecutor.ResetChannelPool();
#endif
                return true;
            }
        }
    }
}
