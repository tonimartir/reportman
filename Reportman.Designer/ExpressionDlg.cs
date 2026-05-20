using Reportman.Drawing;
using Reportman.Reporting;
using System;
using System.Collections.Generic;
using System.Data;
using System.Text;
using System.Text.Json;
using System.Windows.Forms;

namespace Reportman.Designer
{
    public partial class ExpressionDlg : UserControl
    {
        private const string ExpressionChatInitialMessage = "Ask for help rewriting, simplifying or validating the current expression. Click 'Apply' to replace the expression.";

        Report Report;
        Evaluator Evaluator;
        ExpressionChatPanelControl FExpressionChat;
        SplitContainer FSplitContainer;
        bool FSplitterInitialized;

        public ExpressionDlg()
        {
            InitializeComponent();
            InitializeExpressionChatLayout();


            BOK.Text = Translator.TranslateStr(93);
            BCancel.Text = Translator.TranslateStr(94);
            // LExpression.Caption:=TranslateStr(239,LExpression.Caption);
            Text = Translator.TranslateStr(240);
            //LabelCategory.Text = Translator.TranslateStr(241);
            //LOperation.Text = Translator.TranslateStr(242);
            BAdd.Text = Translator.TranslateStr(243);
            BCheckSyn.Text = Translator.TranslateStr(244);
            BShowResult.Text = Translator.TranslateStr(246);
            LCategory.Items.Clear();
            LCategory.Items.Add(Translator.TranslateStr(247));
            LCategory.Items.Add(Translator.TranslateStr(248));
            LCategory.Items.Add(Translator.TranslateStr(249));
            LCategory.Items.Add(Translator.TranslateStr(250));
            LCategory.Items.Add(Translator.TranslateStr(251));
            Dock = DockStyle.Fill;
            LModel.Text = "";
            LHelp.Text = "";
            LParams.Text = "";

            LItems.Items.Clear();
        }

        private void InitializeExpressionChatLayout()
        {
            if (FExpressionChat != null)
                return;

            Controls.Remove(tableLayoutPanel1);

            FSplitContainer = new SplitContainer
            {
                Dock = DockStyle.Fill,
                Orientation = Orientation.Vertical,
                SplitterWidth = 6,
                Panel1MinSize = 0,
                Panel2MinSize = 0
            };
            FSplitContainer.SizeChanged += (s, e) => ApplyInitialSplitterDistance();

            tableLayoutPanel1.Dock = DockStyle.Fill;
            FSplitContainer.Panel1.Controls.Add(tableLayoutPanel1);

            FExpressionChat = new ExpressionChatPanelControl
            {
                Dock = DockStyle.Fill,
                CurrentExpressionProvider = () => MemoExpre.Text,
                CursorPositionProvider = () => MemoExpre.SelectionStart,
                SemanticContextProvider = BuildExpressionSemanticContextJson,
                ValidateExpression = ValidateExpressionForChat
            };
            FExpressionChat.ApplySuggestion += ExpressionChat_ApplySuggestion;
            FSplitContainer.Panel2.Controls.Add(FExpressionChat);

            Controls.Add(FSplitContainer);
            MemoExpre.TextChanged += (s, e) => FExpressionChat.SetCurrentExpression(MemoExpre.Text);
            HandleCreated += (s, e) => BeginInvoke(new Action(ApplyInitialSplitterDistance));
        }

        private void ApplyInitialSplitterDistance()
        {
            if (FSplitterInitialized || FSplitContainer == null || FSplitContainer.Width <= 0)
                return;

            int width = FSplitContainer.ClientSize.Width;
            int splitterWidth = FSplitContainer.SplitterWidth;
            int desiredPanel1Min = Convert.ToInt32(300 * Reportman.Drawing.Windows.GraphicUtils.DPIScale);
            int desiredPanel2Min = Convert.ToInt32(280 * Reportman.Drawing.Windows.GraphicUtils.DPIScale);
            int available = width - splitterWidth;
            if (available < desiredPanel1Min + desiredPanel2Min)
                return;

            int chatWidth = Convert.ToInt32(380 * Reportman.Drawing.Windows.GraphicUtils.DPIScale);
            int distance = width - splitterWidth - chatWidth;
            int maxDistance = width - splitterWidth - desiredPanel2Min;
            if (distance < desiredPanel1Min)
                distance = desiredPanel1Min;
            if (distance > maxDistance)
                distance = maxDistance;
            if (distance < 0)
                return;

            FSplitContainer.Panel1MinSize = 0;
            FSplitContainer.Panel2MinSize = 0;
            FSplitContainer.SplitterDistance = distance;
            FSplitContainer.Panel1MinSize = desiredPanel1Min;
            FSplitContainer.Panel2MinSize = desiredPanel2Min;
            FSplitterInitialized = true;
        }

        private void ExpressionChat_ApplySuggestion(object sender, string expression)
        {
            MemoExpre.Text = expression;
            MemoExpre.Focus();
            MemoExpre.SelectionStart = MemoExpre.Text.Length;
            MemoExpre.SelectionLength = 0;
            FExpressionChat.SetCurrentExpression(MemoExpre.Text);
        }

        private void Label1_Click(object sender, EventArgs e)
        {

        }
        public static bool ShowDialog(ref string expression, FrameMainDesigner framemain)
        {
            using (Form newform = new Form())
            {
                newform.ShowIcon = false;
                newform.ShowInTaskbar = false;
                newform.StartPosition = FormStartPosition.CenterScreen;
                newform.Width = Convert.ToInt32(1120 * Reportman.Drawing.Windows.GraphicUtils.DPIScale);
                newform.Height = Convert.ToInt32(680 * Reportman.Drawing.Windows.GraphicUtils.DPIScale);
                newform.MinimumSize = new System.Drawing.Size(
                    Convert.ToInt32(900 * Reportman.Drawing.Windows.GraphicUtils.DPIScale),
                    Convert.ToInt32(560 * Reportman.Drawing.Windows.GraphicUtils.DPIScale));
                ExpressionDlg dia = new ExpressionDlg();
                dia.Report = framemain.Report;
                dia.MemoExpre.Text = expression;
                dia.Init();

                newform.Controls.Add(dia);
                if (newform.ShowDialog(framemain.FindForm()) == DialogResult.OK)
                {
                    expression = dia.MemoExpre.Text;
                    return true;
                }
                else
                    return false;
            }
        }

        private void BOK_Click(object sender, EventArgs e)
        {
            FindForm().DialogResult = DialogResult.OK;
        }

        private void BCancel_Click(object sender, EventArgs e)
        {
            FindForm().DialogResult = DialogResult.Cancel;
        }
        class HelpInformation
        {
            public HelpInformation(string nFunction, string nHelp, string nModel, string nParameters)
            {
                Function = nFunction;
                Help = nHelp;
                Model = nModel;
                Parameters = nParameters;
            }
            public string Help;
            public string Function;
            public string Model;
            public string Parameters;
            public override string ToString()
            {
                return Function;
            }
        }
        SortedList<int, List<HelpInformation>> HelpList = new SortedList<int, List<HelpInformation>>();
        private void FillConnectedDataSets()
        {
            List<HelpInformation> list1 = HelpList[0];
            list1.Clear();
            foreach (DatabaseInfo dbinfo in Report.DatabaseInfo)
            {
                dbinfo.Connect();
            }
            foreach (DataInfo datainfo in Report.DataInfo)
            {
                if (datainfo.Data != null)
                {
                    if (datainfo.Data.Columns.Count == 0)
                    {
                        datainfo.Connect();
                    }
                    foreach (DataColumn ndata in datainfo.Data.Columns)
                    {
                        HelpInformation newhelp = new HelpInformation(datainfo.Alias + "." + ndata.ColumnName, "", "", "");
                        list1.Add(newhelp);
                    }
                }
            }
            RebuildEvaluatorAliases();
        }

        private void RebuildEvaluatorAliases()
        {
            if (Evaluator == null || Report == null)
                return;

            FDataAlias.List.Clear();
            foreach (DataInfo datainfo in Report.DataInfo)
            {
                if (datainfo.Data == null)
                    continue;

                AliasCollectionItem aitem = new AliasCollectionItem();
                aitem.Alias = datainfo.Alias;
                aitem.Data = datainfo.Data;
                FDataAlias.List.Add(aitem);
            }
            Evaluator.AliasList = FDataAlias;
        }

        private void Init()
        {
            Evaluator = new Evaluator();
            Evaluator.Language = Report.Language;
            Report.AddReportItemsToEvaluator(Evaluator);


            HelpList.Add(0, new List<HelpInformation>());
            HelpList.Add(1, new List<HelpInformation>());
            HelpList.Add(2, new List<HelpInformation>());
            HelpList.Add(3, new List<HelpInformation>());
            HelpList.Add(4, new List<HelpInformation>());
            FillConnectedDataSets();
            foreach (EvalIdentifier iden in Evaluator.Identifiers)
            {
                List<HelpInformation> list1 = null;
                if (iden is EvalIdenExpression)
                    list1 = HelpList[2];
                else
                    if (iden is IdenFunction)
                    list1 = HelpList[1];
                else
                        if (iden is IdenVariable)
                    list1 = HelpList[2];
                else
                    if (iden is IdenConstant)
                    list1 = HelpList[3];
                if (list1 != null)
                {
                    HelpInformation newhelp = new HelpInformation(iden.Name, iden.Help, iden.Model, "");
                    list1.Add(newhelp);
                }
            }
            List<HelpInformation> oplist = HelpList[4];
            // +
            oplist.Add(new HelpInformation("+", Translator.TranslateStr(453), "", ""));
            // -
            oplist.Add(new HelpInformation("-", Translator.TranslateStr(454), "", ""));
            // *
            oplist.Add(new HelpInformation("*", Translator.TranslateStr(455), "", ""));
            // /
            oplist.Add(new HelpInformation("/", Translator.TranslateStr(456), "", ""));
            // :=
            oplist.Add(new HelpInformation(":=", "Assign value to variable", "", ""));
            // =
            oplist.Add(new HelpInformation("=", Translator.TranslateStr(457), "", ""));
            // >=
            oplist.Add(new HelpInformation(">=", Translator.TranslateStr(457), "", ""));
            // <=
            oplist.Add(new HelpInformation("<=", Translator.TranslateStr(457), "", ""));
            // >
            oplist.Add(new HelpInformation(">", Translator.TranslateStr(457), "", ""));
            // <
            oplist.Add(new HelpInformation("<", Translator.TranslateStr(457), "", ""));
            // <>
            oplist.Add(new HelpInformation("<>", Translator.TranslateStr(457), "", ""));
            // AND
            oplist.Add(new HelpInformation("AND", Translator.TranslateStr(458), "", ""));
            // OR
            oplist.Add(new HelpInformation("OR", Translator.TranslateStr(458), "", ""));
            // NOT
            oplist.Add(new HelpInformation("NOT", Translator.TranslateStr(458), "", ""));
            // ;
            oplist.Add(new HelpInformation(";", Translator.TranslateStr(462), Translator.TranslateStr(463), ""));
            // IIF
            oplist.Add(new HelpInformation("IIF", Translator.TranslateStr(462), Translator.TranslateStr(463), ""));

            if (FExpressionChat != null)
                FExpressionChat.Initialize(MemoExpre.Text, ExpressionChatInitialMessage);

        }

        DatasetAlias FDataAlias = new DatasetAlias();
        private void BConectar_Click(object sender, EventArgs e)
        {
            List<HelpInformation> list1 = HelpList[0];
            foreach (DatabaseInfo dbinfo in Report.DatabaseInfo)
            {
                dbinfo.Connect();
            }
            FDataAlias.List.Clear();
            foreach (DataInfo datainfo in Report.DataInfo)
            {
                datainfo.Connect();
            }
            FillConnectedDataSets();


            LCategory_SelectedIndexChanged(this, new EventArgs());
        }

        private string BuildExpressionSemanticContextJson()
        {
            var datasetColumnsBlocks = new List<string>();
            var functions = new List<Dictionary<string, string>>();
            var constants = new List<Dictionary<string, string>>();
            var memoryVariables = new List<string>();
            var root = new Dictionary<string, object>();

            if (Report != null)
            {
                foreach (DataInfo datainfo in Report.DataInfo)
                {
                    if (datainfo.Data == null || datainfo.Data.Columns.Count == 0)
                        continue;
                    datasetColumnsBlocks.Add(BuildDatasetColumnsBlock(datainfo.Alias, datainfo.Data.Columns));
                }

                foreach (Param param in Report.Params)
                {
                    if (param == null || string.IsNullOrWhiteSpace(param.Alias))
                        continue;
                    memoryVariables.Add("M." + param.Alias + ":" + GetSemanticParamType(param.ParamType));
                }
            }

            if (Evaluator != null)
            {
                foreach (EvalIdentifier iden in Evaluator.Identifiers)
                {
                    if (iden == null || iden is EvalIdenExpression)
                        continue;

                    if (iden is IdenFunction)
                        AddCatalogEntry(functions, iden.Model, iden.Help);
                    else if (iden is IdenConstant)
                        AddCatalogEntry(constants, iden.Model, iden.Help);
                }
            }

            root["datasetColumnsBlocks"] = datasetColumnsBlocks;
            root["functions"] = functions;
            root["constants"] = constants;
            if (memoryVariables.Count > 0)
                root["memoryVariablesBlock"] = BuildMemoryVariablesBlock(memoryVariables);

            return JsonSerializer.Serialize(root);
        }

        private static void AddCatalogEntry(List<Dictionary<string, string>> target, string model, string help)
        {
            if (string.IsNullOrWhiteSpace(model) && string.IsNullOrWhiteSpace(help))
                return;

            var entry = new Dictionary<string, string>();
            entry["model"] = model ?? "";
            if (!string.IsNullOrWhiteSpace(help))
                entry["help"] = help;
            target.Add(entry);
        }

        private static string BuildDatasetColumnsBlock(string datasetAlias, DataColumnCollection columns)
        {
            StringBuilder builder = new StringBuilder();
            builder.Append("[DATASET_COLUMNS ").Append(datasetAlias ?? "").AppendLine(" columns]");
            foreach (DataColumn column in columns)
                builder.Append(column.ColumnName).Append(':').AppendLine(GetSemanticFieldDataType(column.DataType));
            builder.Append("[/DATASET_COLUMNS]");
            return builder.ToString();
        }

        private static string BuildMemoryVariablesBlock(List<string> variables)
        {
            StringBuilder builder = new StringBuilder();
            builder.AppendLine("[MEMORY_VARIABLES]");
            foreach (string variable in variables)
                builder.AppendLine(variable);
            builder.Append("[/MEMORY_VARIABLES]");
            return builder.ToString();
        }

        private static string GetSemanticFieldDataType(Type dataType)
        {
            if (dataType == typeof(string) || dataType == typeof(char))
                return "string";
            if (dataType == typeof(bool))
                return "boolean";
            if (dataType == typeof(DateTime))
                return "datetime";
            if (dataType == typeof(byte) || dataType == typeof(short) || dataType == typeof(int) || dataType == typeof(sbyte) || dataType == typeof(ushort))
                return "integer";
            if (dataType == typeof(long) || dataType == typeof(uint) || dataType == typeof(ulong))
                return "bigint";
            if (dataType == typeof(float) || dataType == typeof(double))
                return "float";
            if (dataType == typeof(decimal))
                return "currency";
            if (dataType == typeof(byte[]))
                return "binary";
            return "unknown";
        }

        private static string GetSemanticParamType(ParamType paramType)
        {
            switch (paramType)
            {
                case ParamType.String:
                    return "string";
                case ParamType.Integer:
                    return "integer";
                case ParamType.Double:
                    return "float";
                case ParamType.Date:
                    return "date";
                case ParamType.Time:
                    return "time";
                case ParamType.DateTime:
                    return "datetime";
                case ParamType.Currency:
                    return "currency";
                case ParamType.Bool:
                    return "boolean";
                case ParamType.ExpreB:
                    return "expression_boolean";
                case ParamType.ExpreA:
                    return "expression_string";
                case ParamType.Subst:
                    return "substitution";
                case ParamType.List:
                    return "list";
                case ParamType.Multiple:
                    return "multiple";
                case ParamType.SubstExpre:
                    return "substitution_expression";
                case ParamType.SubsExpreList:
                    return "substitution_list";
                case ParamType.InitialValue:
                    return "initial_expression";
                default:
                    return "unknown";
            }
        }

        private bool ValidateExpressionForChat(string expression, out string errorMessage)
        {
            errorMessage = "";
            if (Evaluator == null)
            {
                if (string.IsNullOrWhiteSpace(expression))
                {
                    errorMessage = "Empty expression returned";
                    return false;
                }
                return true;
            }

            try
            {
                RebuildEvaluatorAliases();
                Evaluator.CheckSyntax(expression ?? "");
                return true;
            }
            catch (Exception ex)
            {
                errorMessage = ex.Message;
                return false;
            }
        }

        private void LCategory_SelectedIndexChanged(object sender, EventArgs e)
        {
            LItems.Items.Clear();
            if (LCategory.SelectedIndex < 0)
                return;
            List<HelpInformation> list1 = HelpList[LCategory.SelectedIndex];
            foreach (HelpInformation ninfo in list1)
            {
                LItems.Items.Add(ninfo);
            }
            LModel.Text = "";
            LHelp.Text = "";
            LParams.Text = "";
        }

        private void LItems_SelectedIndexChanged(object sender, EventArgs e)
        {
            if (LItems.SelectedIndex < 0)
            {
                LModel.Text = "";
                LHelp.Text = "";
                LParams.Text = "";
            }
            HelpInformation ninfo = (HelpInformation)LItems.Items[LItems.SelectedIndex];
            LModel.Text = ninfo.Model;
            LHelp.Text = ninfo.Help;
            LParams.Text = ninfo.Parameters;
        }

        private void BAdd_Click(object sender, EventArgs e)
        {
            if (LItems.SelectedIndex >= 0)
                MemoExpre.Text = MemoExpre.Text + LItems.Items[LItems.SelectedIndex].ToString();
        }

        private void BCheckSyn_Click(object sender, EventArgs e)
        {
            Evaluator.Expression = MemoExpre.Text;
            try
            {
                Evaluator.CheckSyntax(MemoExpre.Text);
                MessageBox.Show("Syntax is correct", "Correct", MessageBoxButtons.OK, MessageBoxIcon.Information);
            }
            catch (Exception ex)
            {
                if (ex is EvalException)
                {
                    MemoExpre.SelectionStart = ((EvalException)ex).SourcePos;
                    MemoExpre.SelectionLength = 0;
                }
                MemoExpre.Focus();
                //throw;    // do not throw message it will raise unhandled exception
                MessageBox.Show(ex.Message, "Error",MessageBoxButtons.OK, MessageBoxIcon.Error);
            }
        }

        private void BShowResult_Click(object sender, EventArgs e)
        {
            Evaluator.Expression = MemoExpre.Text;
            try
            {
                Evaluator.Evaluate();
                MessageBox.Show(Evaluator.Result.ToString(), "Result", MessageBoxButtons.OK, MessageBoxIcon.None);
            }
            catch (Exception ex)
            {
                if (ex is EvalException)
                {
                    MemoExpre.SelectionStart = ((EvalException)ex).SourcePos;
                    MemoExpre.SelectionLength = 0;
                }
                MemoExpre.Focus();
                //throw;      // do not throw message it will raise unhandled exception
                MessageBox.Show(ex.Message, "Error", MessageBoxButtons.OK, MessageBoxIcon.Error);
            }            
        }
    }
}
