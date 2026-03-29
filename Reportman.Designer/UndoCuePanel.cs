using Reportman.Reporting;
using System;
using System.Collections.Generic;
using System.ComponentModel;
using System.Drawing;
using System.Windows.Forms;

namespace Reportman.Designer
{
    /// <summary>
    /// Panel that displays the undo/redo operation queue for a Report.
    /// Equivalent to cue-list / cue-view Angular components.
    /// </summary>
    internal class UndoCuePanel : UserControl
    {
        private Panel panelButtons;
        private Button btnUndo;
        private Button btnRedo;
        private Button btnClear;
        private Panel panelList;
        private VScrollBar vscroll;
        private Report FReport;
        private int scrollOffset;
        private const int RowHeight = 60;
        private const int PropertyLineHeight = 16;
        private readonly Dictionary<int, bool> expandedStates = new Dictionary<int, bool>();

        public event EventHandler OnUndoRedo;

        public UndoCuePanel()
        {
            InitializeControls();
        }

        [DesignerSerializationVisibility(DesignerSerializationVisibility.Hidden), Browsable(false)]
        public Report Report
        {
            get { return FReport; }
            set
            {
                FReport = value;
                expandedStates.Clear();
                scrollOffset = 0;
                UpdateScrollBar();
                panelList.Invalidate();
            }
        }

        public void RefreshList()
        {
            UpdateScrollBar();
            panelList.Invalidate();
        }

        private void InitializeControls()
        {
            panelButtons = new Panel();
            panelButtons.Dock = DockStyle.Top;
            panelButtons.Height = 32;

            btnUndo = new Button();
            btnUndo.Text = "↩ Undo";
            btnUndo.Location = new Point(2, 4);
            btnUndo.Size = new Size(75, 24);
            btnUndo.Click += BtnUndo_Click;

            btnRedo = new Button();
            btnRedo.Text = "↪ Redo";
            btnRedo.Location = new Point(80, 4);
            btnRedo.Size = new Size(75, 24);
            btnRedo.Click += BtnRedo_Click;

            btnClear = new Button();
            btnClear.Text = "Clear";
            btnClear.Location = new Point(158, 4);
            btnClear.Size = new Size(55, 24);
            btnClear.Click += BtnClear_Click;

            panelButtons.Controls.Add(btnUndo);
            panelButtons.Controls.Add(btnRedo);
            panelButtons.Controls.Add(btnClear);

            vscroll = new VScrollBar();
            vscroll.Dock = DockStyle.Right;
            vscroll.Scroll += Vscroll_Scroll;

            panelList = new Panel();
            panelList.Dock = DockStyle.Fill;
            panelList.BackColor = Color.White;
            panelList.Paint += PanelList_Paint;
            panelList.MouseClick += PanelList_MouseClick;
            panelList.MouseWheel += PanelList_MouseWheel;
            panelList.Resize += (s, e) => { UpdateScrollBar(); panelList.Invalidate(); };

            Controls.Add(panelList);
            Controls.Add(vscroll);
            Controls.Add(panelButtons);
        }

        private List<ChangeObjectOperation> GetUndoOperationsDesc()
        {
            if (FReport?.UndoCue == null)
                return new List<ChangeObjectOperation>();
            var ops = new List<ChangeObjectOperation>(FReport.UndoCue.UndoOperations);
            ops.Reverse();
            return ops;
        }

        private int GetOperationHeight(ChangeObjectOperation op)
        {
            int h = RowHeight;
            bool expanded = true;
            if (expandedStates.ContainsKey(op.GetHashCode()))
                expanded = expandedStates[op.GetHashCode()];
            else
                expanded = op.ExpandedProperties;

            if (expanded && op.Properties.Count > 0)
            {
                h += PropertyLineHeight * op.Properties.Count + 20;
            }
            return h;
        }

        private int GetTotalContentHeight()
        {
            var ops = GetUndoOperationsDesc();
            int total = 0;
            foreach (var op in ops)
                total += GetOperationHeight(op);
            return total;
        }

        private void UpdateScrollBar()
        {
            int totalHeight = GetTotalContentHeight();
            int visibleHeight = panelList.Height;
            if (totalHeight > visibleHeight)
            {
                vscroll.Visible = true;
                vscroll.Maximum = totalHeight;
                vscroll.LargeChange = Math.Max(1, visibleHeight);
                vscroll.SmallChange = RowHeight;
                if (scrollOffset > totalHeight - visibleHeight)
                    scrollOffset = Math.Max(0, totalHeight - visibleHeight);
                vscroll.Value = Math.Min(scrollOffset, Math.Max(0, vscroll.Maximum - vscroll.LargeChange + 1));
            }
            else
            {
                vscroll.Visible = false;
                scrollOffset = 0;
            }
        }

        private void Vscroll_Scroll(object sender, ScrollEventArgs e)
        {
            scrollOffset = e.NewValue;
            panelList.Invalidate();
        }

        private void PanelList_MouseWheel(object sender, MouseEventArgs e)
        {
            scrollOffset -= e.Delta / 4;
            int maxScroll = Math.Max(0, GetTotalContentHeight() - panelList.Height);
            scrollOffset = Math.Max(0, Math.Min(scrollOffset, maxScroll));
            if (vscroll.Visible && scrollOffset <= vscroll.Maximum - vscroll.LargeChange + 1)
                vscroll.Value = scrollOffset;
            panelList.Invalidate();
        }

        private void PanelList_Paint(object sender, PaintEventArgs e)
        {
            var ops = GetUndoOperationsDesc();
            if (ops.Count == 0)
            {
                using (var font = new Font("Segoe UI", 9f))
                {
                    e.Graphics.DrawString("No undo operations", font, Brushes.Gray, 10, 10);
                }
                return;
            }

            int y = -scrollOffset;
            var bgLight = Color.White;
            var bgDark = Color.FromArgb(230, 230, 230);

            using (var fontNormal = new Font("Segoe UI", 8.5f))
            using (var fontBold = new Font("Segoe UI", 8.5f, FontStyle.Bold))
            using (var fontSmall = new Font("Segoe UI", 7.5f))
            using (var fontSmallStrike = new Font("Segoe UI", 7.5f, FontStyle.Strikeout))
            using (var penBorder = new Pen(Color.FromArgb(200, 200, 200)))
            {
                foreach (var op in ops)
                {
                    int opHeight = GetOperationHeight(op);
                    if (y + opHeight < 0)
                    {
                        y += opHeight;
                        continue;
                    }
                    if (y > panelList.Height)
                        break;

                    // Alternate background by groupId
                    Color bg = (op.GroupId % 2 == 1) ? bgDark : bgLight;
                    using (var brush = new SolidBrush(bg))
                    {
                        e.Graphics.FillRectangle(brush, 0, y, panelList.Width, opHeight);
                    }
                    e.Graphics.DrawLine(penBorder, 0, y + opHeight - 1, panelList.Width, y + opHeight - 1);

                    // Operation icon + component name
                    string icon = OperationText(op.Operation);
                    e.Graphics.DrawString(icon, fontBold, Brushes.Black, 6, y + 4);

                    int textX = 28;
                    if (!string.IsNullOrEmpty(op.ComponentName))
                    {
                        e.Graphics.DrawString(op.ComponentName, fontNormal, Brushes.FromArgb(60, 60, 60), textX, y + 4);
                        textX += (int)e.Graphics.MeasureString(op.ComponentName, fontNormal).Width + 4;
                    }
                    if (!string.IsNullOrEmpty(op.ComponentClass))
                    {
                        e.Graphics.DrawString("(" + op.ComponentClass + ")", fontSmall, Brushes.Gray, textX, y + 6);
                    }

                    // Date
                    if (op.Date.HasValue)
                    {
                        string dateStr = op.Date.Value.ToString("g");
                        var dateSize = e.Graphics.MeasureString(dateStr, fontSmall);
                        e.Graphics.DrawString(dateStr, fontSmall, Brushes.Gray, panelList.Width - dateSize.Width - 10, y + 4);
                    }

                    int detailY = y + 22;
                    // Parent info
                    if (!string.IsNullOrEmpty(op.ParentName))
                    {
                        e.Graphics.DrawString("Parent: " + op.ParentName, fontSmall, Brushes.FromArgb(80, 80, 80), 16, detailY);
                        detailY += PropertyLineHeight;
                    }
                    if (!string.IsNullOrEmpty(op.OldParentName))
                    {
                        e.Graphics.DrawString("Old Parent: " + op.OldParentName, fontSmall, Brushes.FromArgb(80, 80, 80), 16, detailY);
                        detailY += PropertyLineHeight;
                    }
                    if (op.OldItemIndex.HasValue)
                    {
                        e.Graphics.DrawString("Old Index: " + op.OldItemIndex.Value, fontSmall, Brushes.FromArgb(80, 80, 80), 16, detailY);
                        detailY += PropertyLineHeight;
                    }

                    // Properties toggle
                    bool expanded = true;
                    if (expandedStates.ContainsKey(op.GetHashCode()))
                        expanded = expandedStates[op.GetHashCode()];
                    else
                        expanded = op.ExpandedProperties;

                    if (op.Properties.Count > 0)
                    {
                        string toggleText = expanded ? "▼ Hide properties" : "▶ Show properties";
                        e.Graphics.DrawString(toggleText, fontSmall, Brushes.Blue, 16, detailY);
                        detailY += PropertyLineHeight + 2;

                        if (expanded)
                        {
                            foreach (var prop in op.Properties)
                            {
                                string propText = prop.PropertyName + " [" + prop.PropertyType + "]: ";
                                e.Graphics.DrawString(propText, fontSmall, Brushes.FromArgb(60, 60, 60), 24, detailY);
                                float propW = e.Graphics.MeasureString(propText, fontSmall).Width;

                                if (prop.OldValue != null)
                                {
                                    string oldStr = prop.OldValue.ToString();
                                    e.Graphics.DrawString(oldStr, fontSmallStrike, Brushes.Red, 24 + propW, detailY);
                                    propW += e.Graphics.MeasureString(oldStr, fontSmallStrike).Width + 4;
                                }

                                if (prop.NewValue != null)
                                {
                                    e.Graphics.DrawString(prop.NewValue.ToString(), fontSmall, Brushes.Green, 24 + propW, detailY);
                                }

                                detailY += PropertyLineHeight;
                            }
                        }
                    }

                    y += opHeight;
                }
            }
        }

        private void PanelList_MouseClick(object sender, MouseEventArgs e)
        {
            var ops = GetUndoOperationsDesc();
            int y = -scrollOffset;
            foreach (var op in ops)
            {
                int opHeight = GetOperationHeight(op);
                if (e.Y >= y && e.Y < y + opHeight)
                {
                    // Check if click is on the toggle area
                    if (op.Properties.Count > 0)
                    {
                        int toggleY = y + 22;
                        if (!string.IsNullOrEmpty(op.ParentName)) toggleY += PropertyLineHeight;
                        if (!string.IsNullOrEmpty(op.OldParentName)) toggleY += PropertyLineHeight;
                        if (op.OldItemIndex.HasValue) toggleY += PropertyLineHeight;

                        if (e.Y >= toggleY && e.Y < toggleY + PropertyLineHeight + 2 && e.X >= 16)
                        {
                            int hash = op.GetHashCode();
                            bool current = expandedStates.ContainsKey(hash) ? expandedStates[hash] : op.ExpandedProperties;
                            expandedStates[hash] = !current;
                            UpdateScrollBar();
                            panelList.Invalidate();
                            return;
                        }
                    }
                    break;
                }
                y += opHeight;
            }
        }

        private static string OperationText(OperationType operation)
        {
            switch (operation)
            {
                case OperationType.Add:
                    return "+";
                case OperationType.Modify:
                    return "M";
                case OperationType.Remove:
                    return "X";
                case OperationType.SwapDown:
                    return "v";
                case OperationType.SwapUp:
                    return "^";
                case OperationType.Rename:
                    return "R";
                default:
                    return "?";
            }
        }

        private void BtnUndo_Click(object sender, EventArgs e)
        {
            if (FReport?.UndoCue == null) return;
            var result = FReport.UndoCue.Undo(FReport);
            if (result != null)
            {
                expandedStates.Clear();
                UpdateScrollBar();
                panelList.Invalidate();
                OnUndoRedo?.Invoke(this, EventArgs.Empty);
            }
        }

        private void BtnRedo_Click(object sender, EventArgs e)
        {
            if (FReport?.UndoCue == null) return;
            var result = FReport.UndoCue.Redo(FReport);
            if (result != null)
            {
                expandedStates.Clear();
                UpdateScrollBar();
                panelList.Invalidate();
                OnUndoRedo?.Invoke(this, EventArgs.Empty);
            }
        }

        private void BtnClear_Click(object sender, EventArgs e)
        {
            if (FReport?.UndoCue == null) return;
            FReport.UndoCue.UndoOperations.Clear();
            FReport.UndoCue.RedoOperations.Clear();
            expandedStates.Clear();
            UpdateScrollBar();
            panelList.Invalidate();
        }

        private static class Brushes
        {
            public static readonly SolidBrush Black = new SolidBrush(Color.Black);
            public static readonly SolidBrush Gray = new SolidBrush(Color.Gray);
            public static readonly SolidBrush Blue = new SolidBrush(Color.Blue);
            public static readonly SolidBrush Red = new SolidBrush(Color.Red);
            public static readonly SolidBrush Green = new SolidBrush(Color.FromArgb(0, 128, 0));

            public static SolidBrush FromArgb(int r, int g, int b)
            {
                return new SolidBrush(Color.FromArgb(r, g, b));
            }
        }
    }
}
