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

using System;
using System.Collections.Generic;
using System.Drawing;
using System.Windows.Forms;
using Reportman.Drawing;

namespace Reportman.Designer
{
    /// <summary>
    /// The schema library of Reportman AI for «From the library...» of the local schema screen
    /// (docs/esquemas-locales-pantalla-plan.md, §5.7.1, C.2): its categories on the left and, on the right, the
    /// schemas of the one chosen with their versions. The schema chosen is imported as a file is (F7): it
    /// becomes a subschema of the connection with what its database has.
    /// </summary>
    internal sealed class LocalSchemaLibraryForm : Form
    {
        private readonly List<LocalSchemaLibraryCategory> _categories;
        private ListBox _listCategories;
        private ListView _listSchemas;
        private Label _lblDescription;
        private Button _btnOk;
        private LocalSchemaLibrarySchema _chosen;

        /// <summary>
        /// Shows the library already read and returns the schema chosen, or null when cancelled.
        /// </summary>
        /// <param name="owner">The owner window.</param>
        /// <param name="categories">The categories of the library, with their schemas.</param>
        public static LocalSchemaLibrarySchema Choose(IWin32Window owner, List<LocalSchemaLibraryCategory> categories)
        {
            using (var form = new LocalSchemaLibraryForm(categories))
                return form.ShowDialog(owner) == DialogResult.OK ? form._chosen : null;
        }

        /// <summary>Takes the schema chosen while the list is still there.</summary>
        /// <param name="e">The data of the event.</param>
        protected override void OnFormClosing(FormClosingEventArgs e)
        {
            _chosen = DialogResult == DialogResult.OK ? Selected : null;
            base.OnFormClosing(e);
        }

        private LocalSchemaLibraryForm(List<LocalSchemaLibraryCategory> categories)
        {
            _categories = categories ?? new List<LocalSchemaLibraryCategory>();
            InitializeComponent();
            FillCategories();
        }

        private static string Tr(int index)
        {
            return Translator.TranslateStr(index);
        }

        private LocalSchemaLibrarySchema Selected
        {
            get { return _listSchemas.SelectedItems.Count > 0 ? _listSchemas.SelectedItems[0].Tag as LocalSchemaLibrarySchema : null; }
        }

        private void InitializeComponent()
        {
            SuspendLayout();
            Text = Tr(1988);
            StartPosition = FormStartPosition.CenterParent;
            // The sizes below are for Segoe UI 9 at 96 DPI: they scale with the screen
            Font = new Font("Segoe UI", 9f);
            AutoScaleDimensions = new SizeF(7F, 15F);
            AutoScaleMode = AutoScaleMode.Font;
            ClientSize = new Size(640, 420);
            MinimumSize = new Size(480, 320);
            MinimizeBox = false;
            MaximizeBox = false;
            ShowIcon = false;
            ShowInTaskbar = false;

            // The size first: the distances are checked against it as they are assigned.
            var split = new SplitContainer { Size = new Size(640, 378) };
            split.Panel1MinSize = 140;
            split.Panel2MinSize = 240;
            split.SplitterDistance = 210;
            split.FixedPanel = FixedPanel.Panel1;
            split.Dock = DockStyle.Fill;

            _listCategories = new ListBox { Dock = DockStyle.Fill, IntegralHeight = false };
            _listCategories.SelectedIndexChanged += (s, e) => FillSchemas();
            split.Panel1.Controls.Add(_listCategories);
            split.Panel1.Controls.Add(NewTitle(Tr(241)));

            _listSchemas = new ListView
            {
                Dock = DockStyle.Fill,
                View = View.Details,
                FullRowSelect = true,
                MultiSelect = false,
                HideSelection = false,
                HeaderStyle = ColumnHeaderStyle.Nonclickable
            };
            _listSchemas.Columns.Add(Tr(544));
            _listSchemas.Columns.Add(Tr(91), TextRenderer.MeasureText(Tr(91) + "  00.00", Font).Width);
            _listSchemas.Resize += (s, e) => FitNameColumn();
            _listSchemas.SelectedIndexChanged += (s, e) => _btnOk.Enabled = Selected != null;
            // A double click (or Enter) on a schema takes it
            _listSchemas.ItemActivate += (s, e) =>
            {
                if (Selected != null)
                    DialogResult = DialogResult.OK;
            };
            _lblDescription = new Label { Dock = DockStyle.Bottom, Height = 38, Padding = new Padding(0, 4, 0, 0), AutoEllipsis = true, ForeColor = SystemColors.GrayText };
            split.Panel2.Padding = new Padding(4, 0, 0, 0);
            split.Panel2.Controls.Add(_listSchemas);
            split.Panel2.Controls.Add(NewTitle(Tr(1528)));
            split.Panel2.Controls.Add(_lblDescription);

            var bottom = new Panel { Dock = DockStyle.Bottom, Height = 42, Padding = new Padding(8, 6, 8, 6) };
            var buttons = new FlowLayoutPanel
            {
                Dock = DockStyle.Right,
                FlowDirection = FlowDirection.RightToLeft,
                WrapContents = false,
                AutoSize = true,
                AutoSizeMode = AutoSizeMode.GrowAndShrink
            };
            var cancel = new Button { Text = Tr(94), DialogResult = DialogResult.Cancel, AutoSize = true, MinimumSize = new Size(80, 0) };
            _btnOk = new Button { Text = Tr(93), DialogResult = DialogResult.OK, AutoSize = true, MinimumSize = new Size(80, 0), Enabled = false };
            buttons.Controls.Add(cancel);
            buttons.Controls.Add(_btnOk);
            bottom.Controls.Add(buttons);
            AcceptButton = _btnOk;
            CancelButton = cancel;

            Controls.Add(split);
            Controls.Add(bottom);
            ResumeLayout(false);
            PerformLayout();
        }

        private Label NewTitle(string text)
        {
            return new Label { Text = text, Dock = DockStyle.Top, Height = 20, AutoEllipsis = true, Font = new Font(Font, FontStyle.Bold) };
        }

        // The name takes the width the version leaves
        private void FitNameColumn()
        {
            if (_listSchemas.Columns.Count < 2)
                return;
            _listSchemas.Columns[0].Width = Math.Max(80, _listSchemas.ClientSize.Width - _listSchemas.Columns[1].Width - 4);
        }

        private void FillCategories()
        {
            _listCategories.BeginUpdate();
            try
            {
                foreach (LocalSchemaLibraryCategory category in _categories)
                    _listCategories.Items.Add(category.Name);
            }
            finally
            {
                _listCategories.EndUpdate();
            }
            if (_listCategories.Items.Count > 0)
                _listCategories.SelectedIndex = 0;
            else
                FillSchemas();
        }

        private void FillSchemas()
        {
            int index = _listCategories.SelectedIndex;
            LocalSchemaLibraryCategory category = index >= 0 && index < _categories.Count ? _categories[index] : null;
            _listSchemas.BeginUpdate();
            try
            {
                _listSchemas.Items.Clear();
                if (category != null)
                {
                    foreach (LocalSchemaLibrarySchema schema in category.Schemas)
                    {
                        var item = new ListViewItem(schema.Name) { Tag = schema };
                        item.SubItems.Add(schema.Version);
                        _listSchemas.Items.Add(item);
                    }
                }
            }
            finally
            {
                _listSchemas.EndUpdate();
            }
            FitNameColumn();
            _lblDescription.Text = category != null ? category.Description : "";
            _btnOk.Enabled = Selected != null;
        }
    }
}
