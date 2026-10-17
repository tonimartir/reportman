using Reportman.Drawing;
using Reportman.Reporting;
using System;
using System.Threading.Tasks;
using System.Windows.Forms;

namespace Reportman.Designer
{
    /// <summary>
    /// Dialog for editing a data source's SQL query using a Monaco editor with schema-aware
    /// autocomplete, a natural-language-to-SQL chat panel, and a preview of the query results.
    /// </summary>
    public partial class SQLEditor : UserControl
    {
        Report Report;
        FrameMainDesigner FrameMain;
        string datainfoalias;
        private MonacoEditorControl monacoEditor;
        private SplitContainer sqlSplitContainer;
        private SqlChatPanelControl sqlChatPanel;
        private SqlEditorContext sqlEditorContext;
        private bool initialSqlSplitterDistanceApplied;
        // The schema the user chose in either selector, written to the dataset when the dialog is accepted
        private SqlSchemaContextChangedEventArgs chosenSchema;

        /// <summary>
        /// Initializes a new instance of the SQLEditor class, building UI layout and translating label controls.
        /// </summary>
        public SQLEditor()
        {
            InitializeComponent();
            Dock = DockStyle.Fill;

            BOK.Text = Translator.TranslateStr(93);
            bcancel.Text = Translator.TranslateStr(94);
            bshowdata.Text = Translator.TranslateStr(156);

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
            monacoEditor.LocalSchemaEditRequested += (s, e) => EditLocalSchema(e, monacoEditor.LocalSchemaAnalysis);

            sqlChatPanel = new SqlChatPanelControl
            {
                Dock = DockStyle.Fill,
                CurrentSqlProvider = SyncSqlAndReturnAsync
            };
            sqlChatPanel.Initialize(MemoSQL.Text, Translator.TranslateStr(1556));
            sqlChatPanel.ApplySuggestion += SqlChatPanel_ApplySuggestion;
            sqlChatPanel.SchemaContextChanged += SqlChatPanel_SchemaContextChanged;
            sqlChatPanel.LocalSchemaEditRequested += (s, e) => EditLocalSchema(e, sqlChatPanel.LocalSchemaAnalysis);

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

        // The two selectors (autocomplete and chat) show the same schema: the one chosen in either
        private void SqlChatPanel_SchemaContextChanged(object sender, SqlSchemaContextChangedEventArgs e)
        {
            chosenSchema = e;
            if (monacoEditor != null)
                monacoEditor.SetSelectedSchemaContext(e.HubDatabaseId, e.HubSchemaId, e.ApiKey,
                    e.LocalAlias, e.LocalSubschema);
        }

        private void MonacoEditor_SchemaContextChanged(object sender, SqlSchemaContextChangedEventArgs e)
        {
            chosenSchema = e;
            if (sqlChatPanel != null)
                sqlChatPanel.SetSelectedSchemaContext(e.HubDatabaseId, e.HubSchemaId, e.ApiKey,
                    e.LocalAlias, e.LocalSubschema);
        }

        /// <summary>
        /// "Local schemas..." and "New local schema..." of either selector: the utility of the local schema
        /// file of the connection, opened with the report's own connection (a relative SQLite database is
        /// next to the report, as from the data definitions) and, for «Analyze with AI», the AI of the panel
        /// that asked. After a save both selectors and the designer's copilot read the file again; the
        /// selector that asked selects the subschema added.
        /// </summary>
        private void EditLocalSchema(LocalSchemaEditEventArgs e, LocalSchemaAnalysisSettings analysis)
        {
            DatabaseInfo dbinfo = Report != null && e.Alias.Length > 0 ? Report.DatabaseInfo[e.Alias] : null;
            if (dbinfo == null)
                return;
            try
            {
                string added;
                if (!LocalSchemaEditorForm.Edit(FindForm(), LocalSchemaEditorForm.DesignerFolder(), e.Alias,
                    () => dbinfo.CreateDbConnection(), e.AddSubschema, analysis, out added))
                    return;
                e.AddedSubschema = e.AddSubschema ? added : "";
            }
            catch (Exception ex)
            {
                MessageBox.Show(FindForm(), ex.Message, DesignerText.Format(1845, e.Alias), MessageBoxButtons.OK, MessageBoxIcon.Error);
                return;
            }
            monacoEditor.ReloadLocalSchemas();
            sqlChatPanel.ReloadLocalSchemas();
            if (FrameMain != null)
                FrameMain.NotifyLocalSchemasChanged();
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

            // A direct connection: both selectors offer the subschemas of its local schema, as the copilot,
            // and start on the dataset's one (else the one chosen last, else the first one, else none)
            if (!string.IsNullOrEmpty(sqlEditorContext.DirectAlias))
            {
                string[] aliases = new string[] { sqlEditorContext.DirectAlias };
                bool preferLocal = sqlEditorContext.HubSchemaId == 0;
                string folder = LocalSchemaEditorForm.DesignerFolder();
                monacoEditor.LocalSchemaFolder = folder;
                monacoEditor.SetDirectConnections(aliases, sqlEditorContext.DirectAlias, preferLocal, sqlEditorContext.SchemaName);
                if (sqlChatPanel != null)
                {
                    sqlChatPanel.LocalSchemaFolder = folder;
                    sqlChatPanel.SetDirectConnections(aliases, sqlEditorContext.DirectAlias, preferLocal, sqlEditorContext.SchemaName);
                }
            }

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

            // Not an Agent connection (nor MyBase): the SQL runs on this computer, and its schema is local
            bool direct = dbinfo.Driver != DriverType.HttpAgent && dbinfo.Driver != DriverType.Mybase;
            result.HubSchemaId = dinfo.HubSchemaId;
            // A direct connection is not in the Hub: no cloud schema of some database is preferred for it
            result.HubDatabaseId = direct ? 0 : dbinfo.HttpAgentHubDatabaseId;
            result.ApiKey = dbinfo.HttpAgentApiKey ?? "";
            result.RuntimeDb = ResolveNlToSqlRuntime(dbinfo);
            result.DirectAlias = direct ? dbinfo.Alias : "";
            result.SchemaName = (dinfo.SchemaName ?? "").Trim();
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

        /// <summary>
        /// Displays the SQL editor dialog as a modal window.
        /// </summary>
        /// <param name="sql">The SQL query string to edit (passed by reference).</param>
        /// <param name="framemain">The main designer frame control acting as context.</param>
        /// <param name="datainfotalias">The alias of the report dataset being configured.</param>
        /// <returns>True if the user accepted the changes; otherwise, false.</returns>
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
                dia.FrameMain = framemain;
                dia.MemoSQL.Text = sql;
                dia.datainfoalias = datainfotalias;
                dia.Init();

                newform.Controls.Add(dia);
                if (newform.ShowDialog(framemain.FindForm()) == DialogResult.OK)
                {
                    sql = dia.MemoSQL.Text;
                    dia.StoreChosenSchema();
                    return true;
                }
                else
                    return false;
            }
        }

        /// <summary>
        /// Writes in the dataset the schema the user chose in the dialog, as one undo step: a local subschema
        /// by name (<see cref="DataInfo.SchemaName"/>, and no Hub schema), a Hub schema by id
        /// (<see cref="DataInfo.HubSchemaId"/>) only with an Agent connection: a direct connection never keeps
        /// the id of a cloud schema, as with the copilot.
        /// </summary>
        private void StoreChosenSchema()
        {
            DataInfo dinfo = GetDataInfo();
            if (dinfo == null || chosenSchema == null)
                return;
            bool direct = !string.IsNullOrEmpty(sqlEditorContext.DirectAlias);
            if (!chosenSchema.IsLocalSchema && direct)
                return;
            FrameMainDesigner.UndoItemState state = FrameMainDesigner.CaptureUndoState(dinfo);
            if (chosenSchema.IsLocalSchema)
            {
                dinfo.SchemaName = chosenSchema.LocalSubschema;
                dinfo.HubSchemaId = 0;
            }
            else
                dinfo.HubSchemaId = chosenSchema.HubSchemaId;
            int groupId = 0;
            if (FrameMainDesigner.AddUndoChanges(Report, state, ref groupId) && FrameMain != null)
                FrameMain.RefreshUndoList();
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
            // The dataset's connection when it is a direct one, else ""
            public string DirectAlias;
            // The local subschema the dataset was made with, "" when it says none
            public string SchemaName;
        }
    }
}
