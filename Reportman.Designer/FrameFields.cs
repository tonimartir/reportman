using Reportman.Drawing;
using Reportman.Reporting;
using System;
using System.ComponentModel;
using System.Data;
using System.Windows.Forms;

namespace Reportman.Designer
{
    /// <summary>
    /// User control that displays a report's datasets and variables in a tree view,
    /// letting the user drag fields out as expressions for use in the designer.
    /// </summary>
    public partial class FrameFields : UserControl
    {
        /// <summary>
        /// Occurs when the loaded report model changes.
        /// </summary>
        public event EventHandler OnReportChange;
        /// <summary>
        /// Initializes a new instance of the FrameFields control.
        /// </summary>
        public FrameFields()
        {
            InitializeComponent();
        }
        private Report FReport;
        /// <summary>
        /// Gets or sets the report definition whose datasets and variables are displayed.
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
        /// Clears and rebuilds the tree structure from the current report definition.
        /// </summary>
        public void RefreshInterface()
        {
            TreeNode anew;
            // Clear
            RView.BeginUpdate();
            try
            {
                RView.Nodes.Clear();
                if (FReport != null)
                {
                    // Show data sets
                    foreach (DataInfo dinfo in FReport.DataInfo)
                    {
                        anew = RView.Nodes.Add(dinfo.Alias);
                        anew.Tag = dinfo;
                        anew.Nodes.Add("");
                    }
                    // Show variables
                    anew = RView.Nodes.Add(Translator.TranslateStr(1147));
                    anew.Tag = FReport.Evaluator;
                    anew.Nodes.Add("");
                }
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
        /// Helper utility to test the control inside a standalone form window.
        /// </summary>
        /// <param name="filename">Optional report file path to load.</param>
        public static void Test(string filename)
        {
            using (FrameFields fm = new FrameFields())
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

        private void RView_BeforeExpand(object sender, TreeViewCancelEventArgs e)
        {
            // Change items inside the tree no tag assigned to the child
            if (e.Node.Tag is DataInfo)
            {
                if (e.Node.Nodes.Count > 0)
                {
                    if (e.Node.Nodes[0].Tag == null)
                    {
                        RView.BeginUpdate();
                        try
                        {
                            e.Node.Nodes.Clear();
                            DataInfo ninfo = (DataInfo)e.Node.Tag;
                            ninfo.Connect();
                            foreach (DataColumn ncolumn in ninfo.Data.Columns)
                            {
                                FieldInfo newinfo = new FieldInfo(ninfo, ncolumn.ColumnName);
                                newinfo.DataType = ncolumn.DataType;

                                if (ninfo.Data.ColumnSizes.IndexOfKey(ncolumn.ColumnName) >= 0)
                                {
                                    // Show field size only for strings
                                    if (newinfo.DataType.ToString() == "System.String")
                                        newinfo.fieldsize = ninfo.Data.ColumnSizes[ncolumn.ColumnName];
                                }
                                string colcaption = ncolumn.ColumnName + " - " + newinfo.DataType.ToString();
                                if (newinfo.fieldsize != 0)
                                    colcaption = colcaption + "(" + newinfo.fieldsize.ToString() + ")";
                                TreeNode newnode = e.Node.Nodes.Add(colcaption);
                                newnode.Tag = newinfo;
                            }

                        }
                        finally
                        {
                            RView.EndUpdate();
                        }
                    }
                }
            }
            if (e.Node.Tag is Evaluator)
            {
                if (e.Node.Nodes.Count > 0)
                {
                    if (e.Node.Nodes[0].Tag == null)
                    {
                        RView.BeginUpdate();
                        try
                        {
                            e.Node.Nodes.Clear();
                            Evaluator eval = (Evaluator)e.Node.Tag;
                            Strings list = FReport.GetReportVariables();
                            foreach (string s in list)
                            {
                                TreeNode newnode = e.Node.Nodes.Add(s);
                                newnode.Tag = new FieldInfo(null, s);
                            }
                        }
                        finally
                        {
                            RView.EndUpdate();
                        }
                    }
                }
            }
        }

        private void RView_DragEnter(object sender, DragEventArgs e)
        {
            e.Effect = DragDropEffects.None;
        }

        private void RView_ItemDrag(object sender, ItemDragEventArgs e)
        {
            //
            TreeNode aNode = (TreeNode)e.Item;
            if (aNode.Tag is FieldInfo)
            {
                FieldInfo finfo = (FieldInfo)aNode.Tag;
                string expression = finfo.fieldname;
                if (finfo.ninfo != null)
                    expression = finfo.ninfo.Alias + "." + expression;
                if (finfo.fieldsize > 0)
                {
                    if (finfo.fieldsize < 1000)
                        expression = expression + "_($" + finfo.fieldsize.ToString("000");
                }
                RView.DoDragDrop("__X__X__XX" + expression, DragDropEffects.All);
            }
        }

        private void RView_GiveFeedback(object sender, GiveFeedbackEventArgs e)
        {
            switch (e.Effect)
            {
                case DragDropEffects.Move:
                    e.UseDefaultCursors = true;
                    break;
                case DragDropEffects.Copy:
                    e.UseDefaultCursors = true;
                    break;
                default:
                    e.UseDefaultCursors = false;
                    Cursor.Current = Cursors.No;
                    break;
            }
        }

        private void RView_DragLeave(object sender, EventArgs e)
        {
        }
    }
    /// <summary>
    /// Describes a single field shown in the fields tree, carrying its owning dataset,
    /// field name, .NET data type and display size.
    /// </summary>
    public class FieldInfo
    {
        /// <summary>The parent database dataset definition.</summary>
        public DataInfo ninfo;
        /// <summary>The name of the database table field column.</summary>
        public string fieldname;
        /// <summary>The system .NET Type data representation of the field.</summary>
        public Type DataType;
        /// <summary>The column length display size threshold.</summary>
        public int fieldsize;
        /// <summary>
        /// Initializes a new instance of the FieldInfo metadata class.
        /// </summary>
        /// <param name="dinfo">The parent dataset definition.</param>
        /// <param name="fname">The field name.</param>
        public FieldInfo(DataInfo dinfo, string fname)
        {
            ninfo = dinfo;
            fieldname = fname;
        }
    }
}
