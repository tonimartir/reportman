using Reportman.Drawing;
using Reportman.Reporting;
using System;
using System.Threading.Tasks;
using System.Windows.Forms;

namespace Reportman.Designer
{
    public partial class SQLEditor : UserControl
    {
        Report Report;
        string datainfoalias;
        private MonacoEditorControl monacoEditor;
        private SplitContainer sqlSplitContainer;
        private SqlChatPanelControl sqlChatPanel;
        private SqlEditorContext sqlEditorContext;
        private bool initialSqlSplitterDistanceApplied;

        public SQLEditor()
        {
            InitializeComponent();
            Dock = DockStyle.Fill;

            BOK.Text = Translator.TranslateStr(93);
            bcancel.Text = Translator.TranslateStr(94);

        }
        private void Init()
        {
            InitializeMonacoLayout();
            ApplySqlEditorContext();
        }

        private void InitializeMonacoLayout()
        {
            if (monacoEditor != null)
                return;

            tableLayoutPanel1.Controls.Remove(MemoSQL);
            MemoSQL.Visible = false;

            sqlSplitContainer = new SplitContainer
            {
                Dock = DockStyle.Fill,
                FixedPanel = FixedPanel.Panel2,
                Orientation = Orientation.Vertical,
                Panel2Collapsed = false,
                SplitterWidth = 6,
                TabIndex = MemoSQL.TabIndex
            };

            monacoEditor = new MonacoEditorControl
            {
                Dock = DockStyle.Fill,
                SQL = MemoSQL.Text,
                EnableSqlAutocompleteUi = true
            };
            monacoEditor.SqlContentChanged += MonacoEditor_SqlContentChanged;
            monacoEditor.SchemaContextChanged += MonacoEditor_SchemaContextChanged;

            sqlChatPanel = new SqlChatPanelControl
            {
                Dock = DockStyle.Fill,
                CurrentSqlProvider = SyncSqlAndReturnAsync
            };
            sqlChatPanel.Initialize(MemoSQL.Text,
                "Write your query in natural language. A new SQL query will be generated based on the current SQL and the selected schema. Click 'Apply' to use the generated SQL.");
            sqlChatPanel.ApplySuggestion += SqlChatPanel_ApplySuggestion;
            sqlChatPanel.SchemaContextChanged += SqlChatPanel_SchemaContextChanged;

            sqlSplitContainer.Panel1.Controls.Add(monacoEditor);
            sqlSplitContainer.Panel2.Controls.Add(sqlChatPanel);
            tableLayoutPanel1.Controls.Add(sqlSplitContainer, 0, 0);
            tableLayoutPanel1.SetColumnSpan(sqlSplitContainer, 3);

            ScheduleInitialSqlSplitterDistance();
        }

        private void MonacoEditor_SqlContentChanged(object sender, EventArgs e)
        {
            MemoSQL.Text = monacoEditor.SQL;
            if (sqlChatPanel != null)
                sqlChatPanel.SetCurrentSql(MemoSQL.Text);
        }

        private void SqlChatPanel_ApplySuggestion(object sender, string sql)
        {
            if (monacoEditor != null)
                monacoEditor.SQL = sql ?? "";
            MemoSQL.Text = sql ?? "";
            if (sqlChatPanel != null)
                sqlChatPanel.SetCurrentSql(MemoSQL.Text);
        }

        private void SqlChatPanel_SchemaContextChanged(object sender, SqlSchemaContextChangedEventArgs e)
        {
            DataInfo dinfo = GetDataInfo();
            if (dinfo != null)
                dinfo.HubSchemaId = e.HubSchemaId;

            sqlEditorContext.HubDatabaseId = e.HubDatabaseId;
            sqlEditorContext.HubSchemaId = e.HubSchemaId;
            sqlEditorContext.ApiKey = e.ApiKey ?? "";

            if (monacoEditor != null)
                monacoEditor.SetHubContext(sqlEditorContext.HubDatabaseId, sqlEditorContext.HubSchemaId,
                    sqlEditorContext.ApiKey);
        }

        private void MonacoEditor_SchemaContextChanged(object sender, SqlSchemaContextChangedEventArgs e)
        {
            DataInfo dinfo = GetDataInfo();
            if (dinfo != null)
                dinfo.HubSchemaId = e.HubSchemaId;

            sqlEditorContext.HubDatabaseId = e.HubDatabaseId;
            sqlEditorContext.HubSchemaId = e.HubSchemaId;
            sqlEditorContext.ApiKey = e.ApiKey ?? "";

            if (sqlChatPanel != null)
                sqlChatPanel.SetSelectedSchemaContext(sqlEditorContext.HubDatabaseId,
                    sqlEditorContext.HubSchemaId, sqlEditorContext.ApiKey);
        }

        private async Task SyncSqlFromEditorAsync()
        {
            if (monacoEditor == null)
                return;
            MemoSQL.Text = await monacoEditor.GetSqlFromEditorAsync();
            if (sqlChatPanel != null)
                sqlChatPanel.SetCurrentSql(MemoSQL.Text);
        }

        private async Task<string> SyncSqlAndReturnAsync()
        {
            await SyncSqlFromEditorAsync();
            return MemoSQL.Text;
        }

        private void ApplySqlEditorContext()
        {
            sqlEditorContext = ResolveSqlEditorContext();
            if (monacoEditor == null)
                return;

            monacoEditor.SetBaseConnectionContext(sqlEditorContext.HubDatabaseId,
                sqlEditorContext.HubSchemaId, sqlEditorContext.ApiKey,
                sqlEditorContext.RuntimeDb);

            if (sqlChatPanel != null)
            {
                sqlChatPanel.SetBaseConnectionContext(sqlEditorContext.HubDatabaseId,
                    sqlEditorContext.HubSchemaId, sqlEditorContext.ApiKey,
                    sqlEditorContext.RuntimeDb);
                sqlChatPanel.SetCurrentSql(MemoSQL.Text);
            }
        }

        private void ScheduleInitialSqlSplitterDistance()
        {
            sqlSplitContainer.HandleCreated += SqlSplitContainer_ApplyInitialSplitterDistanceWhenReady;
            sqlSplitContainer.SizeChanged += SqlSplitContainer_ApplyInitialSplitterDistanceWhenReady;
            SqlSplitContainer_ApplyInitialSplitterDistanceWhenReady(sqlSplitContainer, EventArgs.Empty);
        }

        private void SqlSplitContainer_ApplyInitialSplitterDistanceWhenReady(object sender, EventArgs e)
        {
            if (initialSqlSplitterDistanceApplied || sqlSplitContainer == null || !sqlSplitContainer.IsHandleCreated)
                return;

            if (!ApplyInitialSqlSplitterDistance())
                return;

            initialSqlSplitterDistanceApplied = true;
            sqlSplitContainer.HandleCreated -= SqlSplitContainer_ApplyInitialSplitterDistanceWhenReady;
            sqlSplitContainer.SizeChanged -= SqlSplitContainer_ApplyInitialSplitterDistanceWhenReady;
        }

        private bool ApplyInitialSqlSplitterDistance()
        {
            if (sqlSplitContainer == null || sqlSplitContainer.IsDisposed || sqlSplitContainer.Width <= 0)
                return false;

            int splitterWidth = Math.Max(1, sqlSplitContainer.SplitterWidth);
            int width = sqlSplitContainer.Width;
            int availableWidth = width - splitterWidth;
            if (availableWidth < 240)
                return false;

            int scaledMin = Convert.ToInt32(300 * Reportman.Drawing.Windows.GraphicUtils.DPIScale);
            int panel1Min = Math.Min(scaledMin, Math.Max(120, availableWidth / 2));
            int panel2Min = Math.Min(scaledMin, Math.Max(120, availableWidth - panel1Min));
            if (panel1Min + panel2Min > availableWidth)
                panel2Min = Math.Max(0, availableWidth - panel1Min);

            sqlSplitContainer.Panel1MinSize = panel1Min;
            sqlSplitContainer.Panel2MinSize = panel2Min;

            int desiredPanel2 = Math.Min(Convert.ToInt32(360 * Reportman.Drawing.Windows.GraphicUtils.DPIScale), availableWidth - panel1Min);
            desiredPanel2 = Math.Max(panel2Min, desiredPanel2);
            int distance = availableWidth - desiredPanel2;
            int maxDistance = availableWidth - panel2Min;
            distance = Math.Max(panel1Min, Math.Min(distance, maxDistance));
            sqlSplitContainer.SplitterDistance = distance;
            return true;
        }

        private SqlEditorContext ResolveSqlEditorContext()
        {
            SqlEditorContext result = new SqlEditorContext();
            DataInfo dinfo = GetDataInfo();
            if (dinfo == null || Report == null || string.IsNullOrWhiteSpace(dinfo.DatabaseAlias))
                return result;

            DatabaseInfo dbinfo = Report.DatabaseInfo[dinfo.DatabaseAlias];
            if (dbinfo == null)
                return result;

            dbinfo.ResolveHttpAgentConnectionParamsFromConfig();

            result.HubSchemaId = dinfo.HubSchemaId;
            result.HubDatabaseId = dbinfo.HttpAgentHubDatabaseId;
            result.ApiKey = dbinfo.HttpAgentApiKey ?? "";
            result.RuntimeDb = ResolveNlToSqlRuntime(dbinfo);
            return result;
        }

        private static string ResolveNlToSqlRuntime(DatabaseInfo dbinfo)
        {
            if (dbinfo == null)
                return "";

            if (dbinfo.Driver == DriverType.DotNet || dbinfo.Driver == DriverType.DotNet2)
                return "ADO_Net";

            if (dbinfo.HttpAgentHubDatabaseId > 0)
                return "ADO_Net";

            return "Delphi";
        }

        private DataInfo GetDataInfo()
        {
            if (Report == null || string.IsNullOrWhiteSpace(datainfoalias))
                return null;
            return Report.DataInfo[datainfoalias];
        }

        private DatabaseInfo GetDatabaseInfo(DataInfo dinfo)
        {
            if (Report == null || dinfo == null || string.IsNullOrWhiteSpace(dinfo.DatabaseAlias))
                return null;
            return Report.DatabaseInfo[dinfo.DatabaseAlias];
        }

        public static bool ShowDialog(ref string sql, FrameMainDesigner framemain, string datainfotalias)
        {
            using (Form newform = new Form())
            {
                newform.ShowIcon = false;
                newform.ShowInTaskbar = false;
                newform.StartPosition = FormStartPosition.CenterScreen;
                newform.Width = Convert.ToInt32(800 * Reportman.Drawing.Windows.GraphicUtils.DPIScale);
                newform.Height = Convert.ToInt32(600 * Reportman.Drawing.Windows.GraphicUtils.DPIScale);
                SQLEditor dia = new SQLEditor();
                dia.Report = framemain.Report;
                dia.MemoSQL.Text = sql;
                dia.datainfoalias = datainfotalias;
                dia.Init();

                newform.Controls.Add(dia);
                if (newform.ShowDialog(framemain.FindForm()) == DialogResult.OK)
                {
                    sql = dia.MemoSQL.Text;
                    return true;
                }
                else
                    return false;
            }
        }

        private async void BOK_Click(object sender, EventArgs e)
        {
            await SyncSqlFromEditorAsync();
            FindForm().DialogResult = DialogResult.OK;
        }

        private void bcancel_Click(object sender, EventArgs e)
        {
            FindForm().DialogResult = DialogResult.Cancel;
        }

        private async void bshowdata_Click(object sender, EventArgs e)
        {
            await SyncSqlFromEditorAsync();

            // SyncSqlFromEditorAsync awaits WebView2.ExecuteScriptAsync (reads the
            // SQL from Monaco). That Task completes INLINE inside CoreWebView2's
            // native completion callback, so our continuation here is still running
            // on WebView2's COM (STA) apartment. Opening a modal dialog below pumps
            // a nested message loop, which re-enters that apartment mid-callback and
            // throws SEHException "External component has thrown an exception". Yield
            // first so the connect + DataShow run on a clean message-loop turn, fully
            // outside the WebView2 callback.
            await Task.Yield();

            DataInfo dinfo = GetDataInfo();
            DatabaseInfo dbinfo = GetDatabaseInfo(dinfo);
            if (dinfo == null || dbinfo == null)
                return;

            string previousSqlOverride = dinfo.SQLOverride;
            dinfo.SQLOverride = MemoSQL.Text;
            try
            {
                dbinfo.ResolveHttpAgentConnectionParamsFromConfig();
                dbinfo.Connect();
                dinfo.DisConnect();
                dinfo.Connect();
            }
            finally
            {
                dinfo.SQLOverride = previousSqlOverride;
            }
            Reportman.Reporting.Forms.DataShow.ShowData(Report, datainfoalias, this.FindForm());
        }

        private struct SqlEditorContext
        {
            public long HubDatabaseId;
            public long HubSchemaId;
            public string ApiKey;
            public string RuntimeDb;
        }
    }
}
