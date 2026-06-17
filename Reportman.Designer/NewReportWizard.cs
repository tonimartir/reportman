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
using System.IO;
using System.Windows.Forms;

namespace Reportman.Designer
{
    /// <summary>
    /// New report connection wizard (port of the Delphi modern new report wizard,
    /// adapted to the .Net model). On "New" the user chooses a connection route:
    /// a Reportman AI / DB Agent connection (API key + Hub database), a direct
    /// database connection (.Net provider + connection string) or no connection.
    /// Direct connections store the connection string in the report; agent
    /// connections store the API key + Hub database in dbxconnections.ini (the
    /// report only keeps the alias + HttpAgent driver), exactly like Delphi.
    /// </summary>
    public class NewReportWizard : Form
    {
        private enum Route { None, Agent, Direct }
        private enum WizPage { RouteSel, Connection }

        private readonly Report FReport;

        // chrome
        private Panel PHeader;
        private Label LTitle;
        private Label LHelper;
        private Panel PContent;
        private Panel PBottom;
        private Button BCancel;
        private Button BBack;
        private Button BNext;
        private Button BFinish;

        private WizPage FPage = WizPage.RouteSel;
        private Route FRoute = Route.Direct;

        // route page
        private RadioButton FRbAgent;
        private RadioButton FRbDirect;
        private RadioButton FRbNone;

        // connection page
        private TextBox FEdAlias;
        private ConnectionParamsControl FParams;

        private NewReportWizard(Report report)
        {
            FReport = report;
            BuildChrome();
            GoToPage(WizPage.RouteSel);
        }

        /// <summary>
        /// Show the wizard and configure the report connection. Returns
        /// DialogResult.OK when the user finished (DatabaseInfo configured, possibly
        /// none), DialogResult.Cancel to abort.
        /// </summary>
        public static DialogResult Run(Report report, IWin32Window owner)
        {
            using (NewReportWizard dia = new NewReportWizard(report))
            {
                return dia.ShowDialog(owner);
            }
        }

        private void BuildChrome()
        {
            ShowIcon = false;
            ShowInTaskbar = false;
            StartPosition = FormStartPosition.CenterScreen;
            FormBorderStyle = FormBorderStyle.Sizable;
            MinimizeBox = false;
            MaximizeBox = false;
            Text = "New report";
            float scale = Reportman.Drawing.Windows.GraphicUtils.DPIScale;
            ClientSize = new Size(Convert.ToInt32(740 * scale), Convert.ToInt32(560 * scale));
            MinimumSize = new Size(Convert.ToInt32(580 * scale), Convert.ToInt32(440 * scale));

            PHeader = new Panel();
            PHeader.Dock = DockStyle.Top;
            PHeader.Height = 70;
            PHeader.BackColor = Color.White;
            PHeader.Padding = new Padding(16, 10, 16, 6);
            LTitle = new Label();
            LTitle.Dock = DockStyle.Top;
            LTitle.AutoSize = false;
            LTitle.Height = 26;
            LTitle.Font = new Font(Font.FontFamily, 12F, FontStyle.Bold);
            LHelper = new Label();
            LHelper.Dock = DockStyle.Fill;
            LHelper.AutoSize = false;
            PHeader.Controls.Add(LHelper);
            PHeader.Controls.Add(LTitle);

            PBottom = new Panel();
            PBottom.Dock = DockStyle.Bottom;
            PBottom.Height = 48;
            PBottom.Padding = new Padding(8);

            BCancel = MakeButton(Translator.TranslateStr(94)); // Cancel
            BCancel.Click += delegate { DialogResult = DialogResult.Cancel; Close(); };
            BBack = MakeButton("< Back");
            BBack.Click += BBack_Click;
            BNext = MakeButton("Next >");
            BNext.Click += BNext_Click;
            BFinish = MakeButton("Finish");
            BFinish.Click += BFinish_Click;

            FlowLayoutPanel flow = new FlowLayoutPanel();
            flow.Dock = DockStyle.Fill;
            flow.FlowDirection = FlowDirection.RightToLeft;
            flow.Controls.Add(BCancel);
            flow.Controls.Add(BFinish);
            flow.Controls.Add(BNext);
            flow.Controls.Add(BBack);
            PBottom.Controls.Add(flow);

            PContent = new Panel();
            PContent.Dock = DockStyle.Fill;
            PContent.Padding = new Padding(16, 12, 16, 12);

            Controls.Add(PContent);
            Controls.Add(PBottom);
            Controls.Add(PHeader);
        }

        private Button MakeButton(string text)
        {
            Button b = new Button();
            b.Text = text;
            b.AutoSize = false;
            b.Size = new Size(110, 30);
            b.Margin = new Padding(6, 2, 0, 2);
            return b;
        }

        private void GoToPage(WizPage page)
        {
            FPage = page;
            PContent.SuspendLayout();
            PContent.Controls.Clear();
            if (page == WizPage.RouteSel)
                BuildRoutePage();
            else
                BuildConnectionPage();
            PContent.ResumeLayout(true);
            UpdateHeader();
            UpdateButtons();
        }

        private void UpdateHeader()
        {
            if (FPage == WizPage.RouteSel)
            {
                LTitle.Text = "Connection route";
                LHelper.Text = "Choose how this report will get its data: a Reportman AI / DB Agent, a direct database connection, or a blank report.";
            }
            else if (FRoute == Route.Agent)
            {
                LTitle.Text = "Reportman AI / DB Agent connection";
                LHelper.Text = "Enter the API key, then expand 'Database' to list the connections for that key. API key and database are stored in dbxconnections.ini.";
            }
            else
            {
                LTitle.Text = "Direct database connection";
                LHelper.Text = "Pick a .Net driver, edit its parameters and test the connection. Only the connection string is stored in the report.";
            }
        }

        private void UpdateButtons()
        {
            BBack.Visible = FPage != WizPage.RouteSel;
            if (FPage == WizPage.RouteSel)
            {
                bool immediateFinish = FRbNone != null && FRbNone.Checked;
                BNext.Visible = !immediateFinish;
                BFinish.Visible = immediateFinish;
                AcceptButton = immediateFinish ? BFinish : BNext;
            }
            else
            {
                BNext.Visible = false;
                BFinish.Visible = true;
                AcceptButton = BFinish;
            }
        }

        // ---------------- Route page ----------------
        private void BuildRoutePage()
        {
            int y = 8;
            FRbAgent = new RadioButton();
            FRbAgent.Text = "Reportman AI / DB Agent (distributed connection)";
            FRbAgent.Left = 8; FRbAgent.Top = y; FRbAgent.Width = 660; FRbAgent.AutoSize = false; FRbAgent.Height = 22;
            FRbAgent.Checked = FRoute == Route.Agent;
            FRbAgent.CheckedChanged += RouteChanged;
            PContent.Controls.Add(FRbAgent);
            AddHelp("Use a Reportman AI database connection authenticated with an API key.", 28, y + 24, 640);

            y += 70;
            FRbDirect = new RadioButton();
            FRbDirect.Text = "Direct database connection";
            FRbDirect.Left = 8; FRbDirect.Top = y; FRbDirect.Width = 660; FRbDirect.AutoSize = false; FRbDirect.Height = 22;
            FRbDirect.Checked = FRoute == Route.Direct;
            FRbDirect.CheckedChanged += RouteChanged;
            PContent.Controls.Add(FRbDirect);
            AddHelp("Connect directly using a .Net provider (Firebird, MySQL, PostgreSQL, SQL Server, SQLite, ODBC...).", 28, y + 24, 640);

            y += 70;
            FRbNone = new RadioButton();
            FRbNone.Text = "Continue with no connection (blank report)";
            FRbNone.Left = 8; FRbNone.Top = y; FRbNone.Width = 660; FRbNone.AutoSize = false; FRbNone.Height = 22;
            FRbNone.Checked = FRoute == Route.None;
            FRbNone.CheckedChanged += RouteChanged;
            PContent.Controls.Add(FRbNone);
            AddHelp("Create a blank report without selecting or creating any data connection.", 28, y + 24, 640);
        }

        private void AddHelp(string text, int left, int top, int width)
        {
            Label l = new Label();
            l.Text = text;
            l.Left = left; l.Top = top; l.Width = width;
            l.AutoSize = false; l.Height = 32;
            l.ForeColor = Color.DimGray;
            PContent.Controls.Add(l);
        }

        private void RouteChanged(object sender, EventArgs e)
        {
            if (FRbAgent != null && FRbAgent.Checked) FRoute = Route.Agent;
            else if (FRbDirect != null && FRbDirect.Checked) FRoute = Route.Direct;
            else if (FRbNone != null && FRbNone.Checked) FRoute = Route.None;
            UpdateButtons();
        }

        // ---------------- Connection page (shared by Agent + Direct) ----------------
        private void BuildConnectionPage()
        {
            TableLayoutPanel t = new TableLayoutPanel();
            t.Dock = DockStyle.Fill;
            t.ColumnCount = 1;
            t.RowCount = 3;
            t.ColumnStyles.Add(new ColumnStyle(SizeType.Percent, 100F));
            t.RowStyles.Add(new RowStyle(SizeType.AutoSize));
            t.RowStyles.Add(new RowStyle(SizeType.AutoSize));
            t.RowStyles.Add(new RowStyle(SizeType.Percent, 100F));

            Label l = new Label();
            l.Text = "Connection name (alias)";
            l.AutoSize = true;
            l.Margin = new Padding(0, 4, 0, 2);

            TextBox ed = new TextBox();
            ed.Dock = DockStyle.Fill;
            // Connection/dataset aliases are stored uppercase (same convention as
            // FrameDataDef's add-connection/add-dataset and the Delphi designer).
            ed.CharacterCasing = CharacterCasing.Upper;
            ed.Text = (FEdAlias != null) ? FEdAlias.Text : (FRoute == Route.Agent ? "AGENT" : "CONNECTION");
            FEdAlias = ed;

            if (FParams == null)
                FParams = new ConnectionParamsControl();
            FParams.Dock = DockStyle.Fill;
            FParams.Margin = new Padding(0, 6, 0, 0);

            t.Controls.Add(l, 0, 0);
            t.Controls.Add(ed, 0, 1);
            t.Controls.Add(FParams, 0, 2);
            PContent.Controls.Add(t);

            // Sync the driver/agent selection to the chosen route (preserve edits within a mode).
            if (FRoute == Route.Agent)
            {
                if (!FParams.IsHttpAgent)
                    FParams.SelectHttpAgent();
            }
            else
            {
                if (FParams.IsHttpAgent || string.IsNullOrEmpty(FParams.ProviderInvariant))
                    FParams.Populate(DatabaseInfo.FIREBIRD_PROVIDER2, "");
            }
        }

        // ---------------- Navigation ----------------
        private void BBack_Click(object sender, EventArgs e)
        {
            GoToPage(WizPage.RouteSel);
        }

        private void BNext_Click(object sender, EventArgs e)
        {
            if (FPage != WizPage.RouteSel)
                return;
            if (FRoute == Route.None)
            {
                Commit();
                DialogResult = DialogResult.OK;
                Close();
            }
            else
            {
                GoToPage(WizPage.Connection);
            }
        }

        private void BFinish_Click(object sender, EventArgs e)
        {
            if (FPage == WizPage.RouteSel && FRoute == Route.None)
            {
                Commit();
                DialogResult = DialogResult.OK;
                Close();
                return;
            }
            if (FPage == WizPage.Connection && FParams != null && FParams.IsHttpAgent &&
                FParams.AgentApiKey.Trim().Length == 0)
            {
                MessageBox.Show(this, "Please enter the agent API key.", "New report",
                    MessageBoxButtons.OK, MessageBoxIcon.Information);
                return;
            }
            Commit();
            DialogResult = DialogResult.OK;
            Close();
        }

        private void Commit()
        {
            while (FReport.DatabaseInfo.Count > 0)
                FReport.DatabaseInfo.RemoveAt(0);

            if (FRoute == Route.None)
                return;

            if (FParams != null && FParams.IsHttpAgent)
            {
                string alias = NonEmpty(FEdAlias != null ? FEdAlias.Text : "", "Agent").ToUpper();
                try
                {
                    DbxConnections.WriteAgent(alias, FParams.AgentApiKey,
                        FParams.AgentHubDatabaseId, FParams.AgentBaseUrl);
                }
                catch (Exception ex)
                {
                    MessageBox.Show(this,
                        "Could not save the agent connection to dbxconnections.ini:\n" + ex.Message,
                        "dbxconnections", MessageBoxButtons.OK, MessageBoxIcon.Warning);
                }
                DatabaseInfo it = new DatabaseInfo();
                it.Report = FReport;
                it.Alias = alias;
                it.Driver = DriverType.HttpAgent;
                it.ProviderFactory = "";
                it.ConnectionString = "";
                FReport.DatabaseInfo.Add(it);
            }
            else
            {
                DatabaseInfo it = new DatabaseInfo();
                it.Report = FReport;
                it.Alias = NonEmpty(FEdAlias != null ? FEdAlias.Text : "", "Connection").ToUpper();
                it.Driver = DriverType.DotNet2;
                it.ProviderFactory = FParams != null ? FParams.ProviderInvariant : "";
                it.ConnectionString = FParams != null ? FParams.ConnectionString : "";
                FReport.DatabaseInfo.Add(it);
            }
        }

        private static string NonEmpty(string value, string fallback)
        {
            string v = value == null ? "" : value.Trim();
            return v.Length == 0 ? fallback : v;
        }

        // ---------------- Headless test harness (designer.exe /newwizard /shot) ----------------

        public static void CapturePages(string pngBase)
        {
            Report rep = new Report();
            rep.CreateNew();
            NewReportWizard dia = new NewReportWizard(rep);
            dia.StartPosition = FormStartPosition.Manual;
            dia.Location = new Point(-3000, -3000);
            dia.Show();
            Application.DoEvents();
            CaptureForm(dia, pngBase + "_route.png");

            dia.FRoute = Route.Direct;
            dia.GoToPage(WizPage.Connection);
            Application.DoEvents();
            dia.FParams.Populate(DatabaseInfo.FIREBIRD_PROVIDER2,
                "DataSource=localhost;Database=c:\\data\\example.fdb;User=SYSDBA;Password=tw2000;Port=3050;Dialect=3;Charset=UTF8");
            dia.FParams.ScrollToTop();
            Application.DoEvents();
            CaptureForm(dia, pngBase + "_direct.png");

            dia.FRoute = Route.Agent;
            dia.GoToPage(WizPage.Connection);
            Application.DoEvents();
            dia.FParams.PopulateHttpAgent("DEMO-API-KEY", "", 0, "");
            Application.DoEvents();
            CaptureForm(dia, pngBase + "_agent.png");

            dia.Close();
            dia.Dispose();

            System.Text.StringBuilder sb = new System.Text.StringBuilder();
            sb.AppendLine(SelfTestDirect());
            sb.AppendLine(SelfTestAgent());
            File.WriteAllText(pngBase + "_selftest.txt", sb.ToString());
        }

        private static void CaptureForm(Form f, string path)
        {
            using (Bitmap bmp = new Bitmap(f.ClientSize.Width, f.ClientSize.Height))
            {
                f.DrawToBitmap(bmp, new Rectangle(0, 0, bmp.Width, bmp.Height));
                bmp.Save(path, System.Drawing.Imaging.ImageFormat.Png);
            }
        }

        private static string SelfTestDirect()
        {
            Report r = new Report();
            r.CreateNew();
            NewReportWizard w = new NewReportWizard(r);
            w.FRoute = Route.Direct;
            w.GoToPage(WizPage.Connection);
            w.FEdAlias.Text = "MyDB";
            w.FParams.Populate(DatabaseInfo.FIREBIRD_PROVIDER2,
                "DataSource=localhost;Database=c:\\data\\example.fdb;User=SYSDBA;Password=tw2000");
            w.Commit();
            string s = "DIRECT commit -> connections=" + r.DatabaseInfo.Count;
            if (r.DatabaseInfo.Count > 0)
            {
                DatabaseInfo di = r.DatabaseInfo[0];
                s += "; Alias=" + di.Alias + "; Driver=" + di.Driver +
                     "; Provider=" + di.ProviderFactory + "; ConnStr=" + di.ConnectionString;
            }
            w.Dispose();
            return s;
        }

        private static string SelfTestAgent()
        {
            string temp = Path.Combine(Path.GetTempPath(), "rmwiz_dbx_" + Guid.NewGuid().ToString("N") + ".ini");
            string prev = DbxConnections.OverridePath;
            DbxConnections.OverridePath = temp;
            try
            {
                Report r = new Report();
                r.CreateNew();
                NewReportWizard w = new NewReportWizard(r);
                w.FRoute = Route.Agent;
                w.GoToPage(WizPage.Connection);
                w.FEdAlias.Text = "MyAgent";
                w.FParams.PopulateHttpAgent("KEY-123", "https://api.reportman.es:7006", 42, "Demo DB");
                w.Commit();
                string s = "AGENT commit -> connections=" + r.DatabaseInfo.Count;
                if (r.DatabaseInfo.Count > 0)
                {
                    DatabaseInfo di = r.DatabaseInfo[0];
                    s += "; Alias=" + di.Alias + "; Driver=" + di.Driver +
                         "; Provider='" + di.ProviderFactory + "'; ConnStr='" + di.ConnectionString + "'";
                }
                string ak, url;
                long hub;
                DbxConnections.ReadAgent("MyAgent", out ak, out hub, out url);
                s += "  | [dbxconnections] ApiKey=" + ak + "; HubDatabaseId=" + hub + "; Url=" + url +
                     "; IsAgent=" + DbxConnections.IsAgentConnection("MyAgent");
                w.Dispose();
                return s;
            }
            finally
            {
                DbxConnections.OverridePath = prev;
                try { if (File.Exists(temp)) File.Delete(temp); } catch { }
            }
        }
    }
}
