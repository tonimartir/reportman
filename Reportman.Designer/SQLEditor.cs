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
        private SqlEditorContext sqlEditorContext;

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
                Panel2Collapsed = true,
                SplitterWidth = 6,
                TabIndex = MemoSQL.TabIndex
            };

            monacoEditor = new MonacoEditorControl
            {
                Dock = DockStyle.Fill,
                SQL = MemoSQL.Text
            };
            monacoEditor.SqlContentChanged += MonacoEditor_SqlContentChanged;

            sqlSplitContainer.Panel1.Controls.Add(monacoEditor);
            tableLayoutPanel1.Controls.Add(sqlSplitContainer, 0, 0);
            tableLayoutPanel1.SetColumnSpan(sqlSplitContainer, 3);
        }

        private void MonacoEditor_SqlContentChanged(object sender, EventArgs e)
        {
            MemoSQL.Text = monacoEditor.SQL;
        }

        private async Task SyncSqlFromEditorAsync()
        {
            if (monacoEditor == null)
                return;
            MemoSQL.Text = await monacoEditor.GetSqlFromEditorAsync();
        }

        private void ApplySqlEditorContext()
        {
            sqlEditorContext = ResolveSqlEditorContext();
            if (monacoEditor == null)
                return;

            monacoEditor.SetHubContext(sqlEditorContext.HubDatabaseId, sqlEditorContext.HubSchemaId);
            monacoEditor.ApiKey = sqlEditorContext.ApiKey;
            monacoEditor.RuntimeDb = sqlEditorContext.RuntimeDb;
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
