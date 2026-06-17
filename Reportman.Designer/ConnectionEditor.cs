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
    /// </summary>
    public partial class ConnectionEditor : UserControl
    {
        private ConnectionParamsControl FParams;
        private Button BOK;
        private Button bcancel;

        /// <summary>Result of editing a connection.</summary>
        public struct ConnResult
        {
            public bool IsAgent;
            public string ProviderInvariant;
            public string ConnectionString;
            public string AgentApiKey;
            public string AgentBaseUrl;
            public long AgentHubDatabaseId;
        }

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

            ConnResult res;
            if (!Edit(provider, sql, prefillAgent, ak, url, hubid, framemain.FindForm(), out res))
                return false;

            if (res.IsAgent)
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
                        "Could not save the agent connection to dbxconnections.ini:\n" + ex.Message,
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
            result = new ConnResult();
            using (Form newform = new Form())
            {
                newform.ShowIcon = false;
                newform.ShowInTaskbar = false;
                newform.StartPosition = FormStartPosition.CenterScreen;
                newform.Text = "Database connection";
                newform.Width = Convert.ToInt32(720 * Reportman.Drawing.Windows.GraphicUtils.DPIScale);
                newform.Height = Convert.ToInt32(560 * Reportman.Drawing.Windows.GraphicUtils.DPIScale);

                ConnectionEditor dia = new ConnectionEditor();
                newform.Controls.Add(dia);
                if (prefillAgent)
                    dia.FParams.PopulateHttpAgent(agentApiKey, agentBaseUrl, agentHubDbId, "");
                else
                    dia.FParams.Populate(provider, connstr);

                if (newform.ShowDialog(owner) != DialogResult.OK)
                    return false;

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
