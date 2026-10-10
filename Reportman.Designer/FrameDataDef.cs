using Reportman.Drawing;
using Reportman.Drawing.Forms;
using Reportman.Reporting;
using System;
using System.Collections.Generic;
using System.ComponentModel;
using System.Windows.Forms;

namespace Reportman.Designer
{
    /// <summary>
    /// Tree-based editor control for a report's data definitions, letting the user add,
    /// remove, reorder and connect database connections, datasets and parameters.
    /// </summary>
    public partial class FrameDataDef : UserControl
    {
        /// <summary>
        /// Occurs when the loaded report model is changed.
        /// </summary>
        public event EventHandler OnReportChange;
        /// <summary>
        /// Occurs when the selected tree node or its associated ReportItem changes.
        /// </summary>
        public event EventHandler OnSelectionChange;
        /// <summary>
        /// Initializes a new instance of the FrameDataDef class.
        /// </summary>
        public FrameDataDef()
        {
            InitializeComponent();
            // Translations
            badd.Text = Translator.TranslateStr(1158);
            bdelete.Text = Translator.TranslateStr(1159);
            bconnect.Text = Translator.TranslateStr(156);
            bup.Text = Translator.TranslateStr(139);
            bdown.Text = Translator.TranslateStr(140);
            mdataaddconnection.Text = Translator.TranslateStr(154);
            madddataset.Text = Translator.TranslateStr(1192);
            maddparam.Text = Translator.TranslateStr(722);

        }
        /// <summary>
        /// Gets the currently selected TreeNode that wraps a ReportItem model.
        /// </summary>
        /// <returns>The active TreeNode, or null if none is selected.</returns>
        public TreeNode FindSelectedNode()
        {
            if (RView.SelectedNode != null)
                if (RView.SelectedNode.Tag is ReportItem)
                    return RView.SelectedNode;
            return null;
        }
        private Report FReport;
        /// <summary>
        /// Gets or sets the report model definition whose data items are being edited.
        /// </summary>
        [DesignerSerializationVisibility(DesignerSerializationVisibility.Hidden), Browsable(false)]
        public Report Report
        {
            set
            {
                FReport = value;
                RefreshInterface();
            }
            get
            {
                return FReport;
            }
        }
        /// <summary>
        /// Rebuilds the tree view node structure representing the connections, datasets and parameters.
        /// </summary>
        public void RefreshInterface()
        {
            // Clear
            RView.BeginUpdate();
            try
            {
                RView.Nodes.Clear();
                if (FReport != null)
                {
                    TreeNode aparent = RView.Nodes.Add(Translator.TranslateStr(142));
                    TreeNode anew;
                    aparent.Tag = FReport.DatabaseInfo;
                    foreach (DatabaseInfo dbinfo in FReport.DatabaseInfo)
                    {
                        anew = aparent.Nodes.Add(dbinfo.Alias);
                        anew.Tag = dbinfo;
                    }
                    aparent = RView.Nodes.Add(Translator.TranslateStr(148));
                    aparent.Tag = FReport.DataInfo;
                    foreach (DataInfo dinfo in FReport.DataInfo)
                    {
                        anew = aparent.Nodes.Add(dinfo.Alias);
                        anew.Tag = dinfo;
                    }
                    aparent = RView.Nodes.Add(Translator.TranslateStr(152));
                    aparent.Tag = FReport.Params;
                    foreach (Param nparam in FReport.Params)
                    {
                        anew = aparent.Nodes.Add(nparam.Alias);
                        anew.Tag = nparam;
                    }
                }
                RView.ExpandAll();
                if (RView.SelectedNode == null)
                    RView.SelectedNode = RView.TopNode;
            }
            finally
            {
                RView.EndUpdate();
            }
            if (OnReportChange != null)
                OnReportChange(FReport, new EventArgs());
        }
        /// <summary>
        /// Debugging entry point to preview this layout inside a standalone Windows Form.
        /// </summary>
        /// <param name="filename">Optional report filename context.</param>
        public static void Test(string filename)
        {
            using (FrameDataDef fm = new FrameDataDef())
            {
                using (Form nform = new Form())
                {
                    fm.Parent = nform;
                    fm.Dock = DockStyle.Fill;
                    Report rp = new Report();
                    if (filename.Length > 0)
                        rp.LoadFromFile(filename);
                    else
                        rp.CreateNew();
                    fm.Report = rp;
                    nform.ShowDialog();
                }
            }
        }
        private void mdataaddconnection_Click(object sender, EventArgs e)
        {
            // Adding a new connection
            string conname = InputBox.Execute(Translator.TranslateStr(399),
                Translator.TranslateStr(400), "").Trim().ToUpper();
            if (conname.Length == 0)
                return;
            if (FReport.DatabaseInfo.IndexOf(conname) >= 0)
            {
                MessageBox.Show(Translator.TranslateStr(505));
                return;
            }
            DatabaseInfo dbinfo = new DatabaseInfo();
            dbinfo.Report = FReport;
            FReport.GenerateNewName(dbinfo);
            dbinfo.Alias = conname;
            FReport.DatabaseInfo.Add(dbinfo);
            FReport.AddComponent(dbinfo);
            RefreshInterface();
            SelectItem(dbinfo);
        }
        private void FillNodes(TreeNodeCollection source, List<TreeNode> destination)
        {
            foreach (TreeNode node in source)
            {
                destination.Add(node);
                FillNodes(node.Nodes, destination);
            }
        }
        /// <summary>
        /// Gets a flat list containing all TreeNodes currently in the tree hierarchy.
        /// </summary>
        /// <returns>A list of TreeNode objects.</returns>
        public List<TreeNode> GetAllNodes()
        {
            List<TreeNode> aresult = new List<TreeNode>();
            FillNodes(RView.Nodes, aresult);
            return aresult;
        }
        /// <summary>
        /// Programmatically selects the tree node representing the specified ReportItem.
        /// </summary>
        /// <param name="sec">The target ReportItem to select.</param>
        public void SelectItem(ReportItem sec)
        {
            List<TreeNode> col = GetAllNodes();
            // First try to find by reference
            foreach (TreeNode node in col)
            {
                if (node.Tag == sec)
                {
                    RView.SelectedNode = node;
                    return;
                }
            }
            // If not found by reference, try to find by name (for undo/redo scenarios)
            if (!string.IsNullOrEmpty(sec.Name))
            {
                foreach (TreeNode node in col)
                {
                    if (node.Tag is ReportItem item && item.Name == sec.Name)
                    {
                        RView.SelectedNode = node;
                        return;
                    }
                }
            }
        }

        private void RView_AfterSelect(object sender, TreeViewEventArgs e)
        {
            if (OnSelectionChange != null)
                OnSelectionChange(RView, new EventArgs());
        }
        private void madddataset_Click(object sender, EventArgs e)
        {
            // Adding a new dataset
            string conname = InputBox.Execute(Translator.TranslateStr(539),
                Translator.TranslateStr(540), "").Trim().ToUpper();
            if (conname.Length == 0)
                return;
            if (FReport.DataInfo.IndexOf(conname) >= 0)
            {
                MessageBox.Show(Translator.TranslateStr(519));
                return;
            }
            DataInfo dinfo = new DataInfo();
            dinfo.Report = FReport;
            FReport.GenerateNewName(dinfo);
            dinfo.Alias = conname;
            if (FReport.DatabaseInfo.Count > 0)
                dinfo.DatabaseAlias = FReport.DatabaseInfo[0].Alias;
            FReport.DataInfo.Add(dinfo);
            FReport.AddComponent(dinfo);
            RefreshInterface();
            SelectItem(dinfo);
        }
        private void maddparam_Click(object sender, EventArgs e)
        {
            // Adding a new dataset
            string paramname = InputBox.Execute(Translator.TranslateStr(543),
                Translator.TranslateStr(544), "").Trim().ToUpper();
            if (paramname.Length == 0)
                return;
            if (FReport.Params.IndexOf(paramname) >= 0)
            {
                MessageBox.Show(Translator.TranslateStr(545));
                return;
            }
            Param nparam = new Param();
            nparam.Report = FReport;
            FReport.GenerateNewName(nparam);
            nparam.Alias = paramname;
            FReport.Params.Add(nparam);
            FReport.AddComponent(nparam);
            RefreshInterface();
            SelectItem(nparam);
        }

        private void bdelete_Click(object sender, EventArgs e)
        {
            if (RView.SelectedNode == null)
                return;
            if (!(RView.SelectedNode.Tag is ReportItem))
                return;
            ReportItem pitem = (ReportItem)RView.SelectedNode.Tag;
            int groupId = FReport.UndoCue?.GetGroupId() ?? 0;
            FReport.DeleteItem(pitem, groupId);
            RefreshInterface();
        }

        private void bup_Click(object sender, EventArgs e)
        {
            MoveSelected(false);
        }

        private void bdown_Click(object sender, EventArgs e)
        {
            MoveSelected(true);
        }

        // Moves the selected connection, dataset or parameter up or down, in the report and in the tree
        private void MoveSelected(bool down)
        {
            TreeNode nnode = RView.SelectedNode;
            if (nnode == null || nnode.Parent == null)
                return;
            int index = nnode.Index;
            int newIndex = down ? index + 1 : index - 1;
            if (newIndex < 0 || newIndex >= nnode.Parent.Nodes.Count)
                return;
            ReportItem pitem = nnode.Tag as ReportItem;
            if (pitem == null || !MoveDataItem(FReport, pitem, down))
                return;
            // The same move in the tree, keeping the selection
            TreeNode segnode = nnode.Parent.Nodes[newIndex];
            nnode.Parent.Nodes.Remove(segnode);
            nnode.Parent.Nodes.Insert(index, segnode);
            if (OnReportChange != null)
                OnReportChange(FReport, new EventArgs());
        }

        /// <summary>
        /// Moves a connection, a dataset or a parameter one position up or down in its collection,
        /// recording the move in the undo history as one step. Returns false, changing nothing, for any
        /// other item or when it is already at that end.
        /// </summary>
        internal static bool MoveDataItem(Report report, ReportItem item, bool down)
        {
            if (!(item is DatabaseInfo) && !(item is DataInfo) && !(item is Param))
                return false;
            int groupId = 0;
            return UndoCue.SwapItem(report, item, down, ref groupId);
        }

        private void bconnect_Click(object sender, EventArgs e)
        {
            TreeNode nnode = FindSelectedNode();
            if (nnode == null)
                return;
            if (nnode.Tag is DatabaseInfo)
            {
                DatabaseInfo dbinfo = (DatabaseInfo)nnode.Tag;
                try
                {
                    dbinfo.Connect();
                    dbinfo.DisConnect();
                }
                catch (Exception E)
                {
                    MessageBox.Show(E.Message);
                }
            }
        }
    }
}
