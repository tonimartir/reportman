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
using System.Data;
using System.Drawing;
using System.Globalization;
using System.Threading;
using System.Threading.Tasks;
using System.Windows.Forms;
using Reportman.Reporting;

namespace Reportman.Designer
{
    // The Columns tab: of the table clicked, its columns with a check box (checked = in the subschema's list),
    // the description and allowed values of the column clicked (the dictionary's), and a preview of 5 rows.
    public partial class LocalSchemaEditorForm
    {
        private ListBox _listColumnTables;
        private TextBox _txtColumnTablesFilter;
        private Label _lblColumnTables;
        private Label _lblColumnTablesCount;
        private ListView _listColumns;
        private TextBox _txtColumnsFilter;
        private Label _lblColumns;
        private Label _lblColumnsCount;
        private Button _btnAddAllColumns;
        private Button _btnClearColumns;
        private TextBox _txtColumnName;
        private TextBox _txtColumnType;
        private TextBox _txtColumnDescription;
        private Label _lblColumnAlsoIn;
        private DataGridView _gridValues;
        private Button _btnPreview;
        private Label _lblPreview;
        private DataGridView _gridPreview;
        private LocalSchemaTable _columnsTable;
        private LocalSchemaColumn _column;
        private CancellationTokenSource _previewCts;

        private TabPage BuildColumnsTab()
        {
            var page = new TabPage(Tr(1849)) { Padding = new Padding(6) };

            // The tables
            _listColumnTables = new ListBox { IntegralHeight = false, DisplayMember = "Name" };
            _listColumnTables.SelectedIndexChanged += (s, e) =>
            {
                if (_filling)
                    return;
                CommitEdits();
                _columnsTable = _listColumnTables.SelectedItem as LocalSchemaTable;
                _column = null;
                FillColumnsList();
                ClearPreview();
            };
            Panel tablesPanel = NewListPanel(_listColumnTables, out _lblColumnTables, out _txtColumnTablesFilter, out _lblColumnTablesCount);
            _lblColumnTables.Text = Tr(1848);
            _txtColumnTablesFilter.TextChanged += (s, e) => FillColumnsTab();

            // The columns of the table
            _listColumns = new ListView
            {
                View = View.Details,
                FullRowSelect = true,
                HideSelection = false,
                MultiSelect = false,
                CheckBoxes = true
            };
            _listColumns.Columns.Add(Tr(544), 170);
            _listColumns.Columns.Add(Tr(193), 130);
            _listColumns.Columns.Add(Tr(1912), 130);
            _listColumns.ItemChecked += ListColumns_ItemChecked;
            _listColumns.SelectedIndexChanged += (s, e) =>
            {
                if (_filling)
                    return;
                CommitEdits();
                _column = _listColumns.SelectedItems.Count > 0 ? (LocalSchemaColumn)_listColumns.SelectedItems[0].Tag : null;
                FillColumnDetails();
            };
            Label columnsFooter;
            Panel columnsPanel = NewListPanel(_listColumns, out _lblColumns, out _txtColumnsFilter, out columnsFooter);
            _txtColumnsFilter.TextChanged += (s, e) => FillColumnsList();
            columnsPanel.Controls.Remove(columnsFooter);
            columnsFooter.Dispose();
            var columnButtons = new FlowLayoutPanel { Dock = DockStyle.Bottom, Height = 34, WrapContents = false, Padding = new Padding(0, 3, 0, 0) };
            _btnAddAllColumns = new Button { Text = Tr(1861), AutoSize = true };
            _btnAddAllColumns.Click += (s, e) => AddAllColumns();
            _btnClearColumns = new Button { Text = Tr(1532), AutoSize = true };
            _btnClearColumns.Click += (s, e) => ClearColumns();
            _toolTip.SetToolTip(_btnAddAllColumns, Tr(1913));
            _toolTip.SetToolTip(_btnClearColumns, Tr(1914));
            _lblColumnsCount = new Label { AutoSize = true, Margin = new Padding(12, 8, 0, 0), Font = new Font(Font, FontStyle.Bold) };
            columnButtons.Controls.Add(_btnAddAllColumns);
            columnButtons.Controls.Add(_btnClearColumns);
            columnButtons.Controls.Add(_lblColumnsCount);
            columnsPanel.Controls.Add(columnButtons);

            // The column clicked
            var details = new TableLayoutPanel { Dock = DockStyle.Fill, ColumnCount = 2, RowCount = 7, Padding = new Padding(6, 0, 0, 0) };
            details.ColumnStyles.Add(new ColumnStyle(SizeType.AutoSize));
            details.ColumnStyles.Add(new ColumnStyle(SizeType.Percent, 100f));
            details.RowStyles.Add(new RowStyle(SizeType.AutoSize));
            details.RowStyles.Add(new RowStyle(SizeType.AutoSize));
            details.RowStyles.Add(new RowStyle(SizeType.AutoSize));
            details.RowStyles.Add(new RowStyle(SizeType.Percent, 40f));
            details.RowStyles.Add(new RowStyle(SizeType.AutoSize));
            details.RowStyles.Add(new RowStyle(SizeType.AutoSize));
            details.RowStyles.Add(new RowStyle(SizeType.Percent, 60f));
            _txtColumnName = ReadOnlyBox();
            _txtColumnType = ReadOnlyBox();
            details.Controls.Add(new Label { Text = Tr(544), AutoSize = true, Anchor = AnchorStyles.Left, Margin = new Padding(0, 4, 8, 4) }, 0, 0);
            details.Controls.Add(_txtColumnName, 1, 0);
            details.Controls.Add(new Label { Text = Tr(193), AutoSize = true, Anchor = AnchorStyles.Left, Margin = new Padding(0, 4, 8, 4) }, 0, 1);
            details.Controls.Add(_txtColumnType, 1, 1);
            var lblDescription = new Label { Text = Tr(1862), AutoSize = true, Margin = new Padding(0, 8, 0, 2) };
            details.Controls.Add(lblDescription, 0, 2);
            details.SetColumnSpan(lblDescription, 2);
            _txtColumnDescription = new TextBox { Dock = DockStyle.Fill, Multiline = true, ScrollBars = ScrollBars.Vertical, AcceptsReturn = true };
            _txtColumnDescription.TextChanged += (s, e) =>
            {
                if (_filling || _column == null)
                    return;
                _column.Context = _txtColumnDescription.Text;
                MarkDirty();
            };
            details.Controls.Add(_txtColumnDescription, 0, 3);
            details.SetColumnSpan(_txtColumnDescription, 2);
            _lblColumnAlsoIn = new Label { Dock = DockStyle.Fill, Height = 20, AutoEllipsis = true, ForeColor = SystemColors.GrayText };
            details.Controls.Add(_lblColumnAlsoIn, 0, 4);
            details.SetColumnSpan(_lblColumnAlsoIn, 2);
            var lblValues = new Label { Text = Tr(1864), AutoSize = true, Margin = new Padding(0, 6, 0, 2) };
            details.Controls.Add(lblValues, 0, 5);
            details.SetColumnSpan(lblValues, 2);
            _gridValues = new DataGridView
            {
                Dock = DockStyle.Fill,
                AllowUserToAddRows = true,
                AllowUserToDeleteRows = true,
                AllowUserToResizeRows = false,
                RowHeadersWidth = 28,
                AutoSizeColumnsMode = DataGridViewAutoSizeColumnsMode.Fill,
                BackgroundColor = SystemColors.Window,
                SelectionMode = DataGridViewSelectionMode.RowHeaderSelect
            };
            _gridValues.Columns.Add(new DataGridViewTextBoxColumn { HeaderText = Tr(1896), FillWeight = 35 });
            _gridValues.Columns.Add(new DataGridViewTextBoxColumn { HeaderText = Tr(1897), FillWeight = 65 });
            _gridValues.CellValueChanged += (s, e) => ReadAllowedValues();
            _gridValues.UserDeletedRow += (s, e) => ReadAllowedValues();
            details.Controls.Add(_gridValues, 0, 6);
            details.SetColumnSpan(_gridValues, 2);

            var layout = new TableLayoutPanel { Dock = DockStyle.Fill, ColumnCount = 3, RowCount = 1 };
            layout.ColumnStyles.Add(new ColumnStyle(SizeType.Percent, 24f));
            layout.ColumnStyles.Add(new ColumnStyle(SizeType.Percent, 40f));
            layout.ColumnStyles.Add(new ColumnStyle(SizeType.Percent, 36f));
            layout.RowStyles.Add(new RowStyle(SizeType.Percent, 100f));
            tablesPanel.Margin = new Padding(0, 0, 6, 0);
            layout.Controls.Add(tablesPanel, 0, 0);
            layout.Controls.Add(columnsPanel, 1, 0);
            layout.Controls.Add(details, 2, 0);

            // The preview
            var preview = new Panel { Dock = DockStyle.Bottom, Height = 180, Padding = new Padding(0, 6, 0, 0) };
            var previewBar = new FlowLayoutPanel { Dock = DockStyle.Top, Height = 32, WrapContents = false };
            // The text says 5, as PreviewRows
            _btnPreview = new Button { Text = Tr(1865), AutoSize = true };
            _btnPreview.Click += async (s, e) => await PreviewAsync();
            _lblPreview = new Label { AutoSize = true, Margin = new Padding(8, 8, 0, 0), ForeColor = SystemColors.GrayText };
            previewBar.Controls.Add(_btnPreview);
            previewBar.Controls.Add(_lblPreview);
            _gridPreview = new DataGridView
            {
                Dock = DockStyle.Fill,
                ReadOnly = true,
                AllowUserToAddRows = false,
                AllowUserToDeleteRows = false,
                AllowUserToResizeRows = false,
                RowHeadersVisible = false,
                AutoSizeColumnsMode = DataGridViewAutoSizeColumnsMode.DisplayedCells,
                BackgroundColor = SystemColors.Window
            };
            preview.Controls.Add(_gridPreview);
            preview.Controls.Add(previewBar);

            page.Controls.Add(layout);
            page.Controls.Add(preview);
            ClearPreview();
            return page;
        }

        private void FillColumnsTab()
        {
            var tables = new List<LocalSchemaTable>();
            List<LocalSchemaTable> all = LocalSchemaEditing.TablesOf(_file, _current);
            foreach (LocalSchemaTable t in all)
                if (MatchesFilter(t.Name, _txtColumnTablesFilter.Text))
                    tables.Add(t);
            // The table clicked stays, also after reading the database again (new objects, same name)
            LocalSchemaTable keep = null;
            if (_columnsTable != null)
                keep = tables.Find(t => string.Equals(t.Name, _columnsTable.Name, StringComparison.OrdinalIgnoreCase));
            if (keep == null && tables.Count > 0)
                keep = tables[0];
            if (keep != _columnsTable)
                ClearPreview();
            if (keep == null || _columnsTable == null || !string.Equals(keep.Name, _columnsTable.Name, StringComparison.OrdinalIgnoreCase))
                _column = null;
            _columnsTable = keep;
            bool filling = _filling;
            _filling = true;
            try
            {
                _listColumnTables.BeginUpdate();
                try
                {
                    _listColumnTables.Items.Clear();
                    foreach (LocalSchemaTable t in tables)
                        _listColumnTables.Items.Add(t);
                    _listColumnTables.SelectedItem = _columnsTable;
                }
                finally
                {
                    _listColumnTables.EndUpdate();
                }
            }
            finally
            {
                _filling = filling;
            }
            _lblColumnTables.Text = _current == null ? Tr(1843) : Tr(1858);
            _lblColumnTablesCount.Text = CountText(tables.Count, all.Count);
            FillColumnsList();
        }

        private static string TypeText(LocalSchemaColumn column)
        {
            string detected = (column.DetectedType ?? "").Trim();
            return detected.Length > 0 && !string.Equals(detected, column.DataType, StringComparison.OrdinalIgnoreCase)
                ? column.DataType + " (" + detected + ")"
                : column.DataType;
        }

        // 🔑 primary key, 🔗 source of a foreign key (pale while the relation does not travel: its two ends,
        // by table and by column, are not in the subschema)
        private string KeyText(LocalSchemaTable table, LocalSchemaColumn column, out bool pale)
        {
            pale = false;
            var parts = new List<string>();
            if (column.IsPrimaryKey)
                parts.Add("🔑");
            foreach (LocalSchemaForeignKey fk in table.ForeignKeys)
            {
                if (!fk.SourceColumns.Exists(c => string.Equals(c, column.Name, StringComparison.OrdinalIgnoreCase)))
                    continue;
                parts.Add("🔗 " + fk.TargetTable);
                if (LocalSchemaEditing.FindTable(_file, fk.TargetTable) == null || !LocalSchemaEditing.Travels(_file, _current, table, fk))
                    pale = true;
            }
            return string.Join(" ", parts);
        }

        private void FillColumnsList()
        {
            LocalSchemaTable table = _columnsTable;
            bool checks = _current != null;
            bool filling = _filling;
            _filling = true;
            try
            {
                _listColumns.BeginUpdate();
                try
                {
                    _listColumns.Items.Clear();
                    if (_listColumns.CheckBoxes != checks)
                        _listColumns.CheckBoxes = checks;
                    if (table != null)
                    {
                        List<string> travelling = LocalSchemaEditing.TravellingColumns(_current, table);
                        foreach (LocalSchemaColumn c in table.Columns)
                        {
                            if (!MatchesFilter(c.Name, _txtColumnsFilter.Text))
                                continue;
                            bool pale;
                            var item = new ListViewItem(c.Name) { Tag = c, UseItemStyleForSubItems = false };
                            item.SubItems.Add(TypeText(c));
                            ListViewItem.ListViewSubItem key = item.SubItems.Add(KeyText(table, c, out pale));
                            if (pale)
                                key.ForeColor = SystemColors.GrayText;
                            if (checks)
                                item.Checked = travelling.Exists(n => string.Equals(n, c.Name, StringComparison.OrdinalIgnoreCase));
                            _listColumns.Items.Add(item);
                            if (_column != null && string.Equals(c.Name, _column.Name, StringComparison.OrdinalIgnoreCase))
                            {
                                _column = c;
                                item.Selected = true;
                            }
                        }
                        if (_column != null && !table.Columns.Contains(_column))
                            _column = null;
                    }
                    else
                        _column = null;
                }
                finally
                {
                    _listColumns.EndUpdate();
                }
            }
            finally
            {
                _filling = filling;
            }
            _lblColumns.Text = table == null ? Tr(1849) : Tr(1849) + ": " + table.Name;
            UpdateColumnsCounter();
            UpdateColumnsButtons();
            FillColumnDetails();
        }

        /// <summary>The checks again from the model (a table left without a list travels with its primary key).</summary>
        private void SyncColumnChecks()
        {
            if (_columnsTable == null || _current == null || IsDisposed)
                return;
            List<string> travelling = LocalSchemaEditing.TravellingColumns(_current, _columnsTable);
            bool filling = _filling;
            _filling = true;
            try
            {
                foreach (ListViewItem item in _listColumns.Items)
                {
                    var c = (LocalSchemaColumn)item.Tag;
                    bool check = travelling.Exists(n => string.Equals(n, c.Name, StringComparison.OrdinalIgnoreCase));
                    if (item.Checked != check)
                        item.Checked = check;
                    // A relation may have started or stopped travelling
                    bool pale;
                    item.SubItems[2].Text = KeyText(_columnsTable, c, out pale);
                    item.SubItems[2].ForeColor = pale ? SystemColors.GrayText : _listColumns.ForeColor;
                }
            }
            finally
            {
                _filling = filling;
            }
            UpdateColumnsCounter();
            FillColumnAlsoIn();
        }

        private void UpdateColumnsCounter()
        {
            if (_lblColumnsCount == null)
                return;
            if (_columnsTable == null)
            {
                _lblColumnsCount.Text = "";
                return;
            }
            int count = LocalSchemaStore.ColumnsOf(_current, _columnsTable).Count;
            int max = MaxColumnsPerTable;
            _lblColumnsCount.Text = TrFormat(1915, Usage(count, max), Number(_columnsTable.Columns.Count));
            _lblColumnsCount.ForeColor = UsageColor(count, max);
        }

        private void UpdateColumnsButtons()
        {
            if (_btnAddAllColumns == null)
                return;
            bool editable = _file != null && _current != null && _columnsTable != null && !_busy;
            _btnAddAllColumns.Enabled = editable && _listColumns.Items.Count > 0;
            _btnClearColumns.Enabled = editable;
            _btnPreview.Enabled = _columnsTable != null && _createConnection != null && !_busy && _file != null;
        }

        private void ListColumns_ItemChecked(object sender, ItemCheckedEventArgs e)
        {
            if (_filling || _current == null || _columnsTable == null)
                return;
            var column = (LocalSchemaColumn)e.Item.Tag;
            List<string> chosen = LocalSchemaEditing.TravellingColumns(_current, _columnsTable);
            // The list raises the checks again when it creates its window: nothing changes then
            bool travels = chosen.Exists(n => string.Equals(n, column.Name, StringComparison.OrdinalIgnoreCase));
            if (travels == e.Item.Checked)
                return;
            chosen.RemoveAll(n => string.Equals(n, column.Name, StringComparison.OrdinalIgnoreCase));
            if (e.Item.Checked)
                chosen.Add(column.Name);
            LocalSchemaEditing.SetChosenColumns(_current, _columnsTable, chosen);
            ColumnsChanged();
            // Deferred: the list is still changing the check
            BeginInvoke(new Action(SyncColumnChecks));
        }

        private void AddAllColumns()
        {
            if (_current == null || _columnsTable == null)
                return;
            var names = new List<string>();
            foreach (ListViewItem item in _listColumns.Items)
                names.Add(((LocalSchemaColumn)item.Tag).Name);
            LocalSchemaEditing.AddColumns(_current, _columnsTable, names);
            ColumnsChanged();
            SyncColumnChecks();
        }

        // Only the list goes: the descriptions and allowed values are the dictionary's, nothing is lost
        private void ClearColumns()
        {
            if (_current == null || _columnsTable == null)
                return;
            LocalSchemaEditing.SetChosenColumns(_current, _columnsTable, null);
            ColumnsChanged();
            SyncColumnChecks();
        }

        /// <summary>The columns that travel changed: the counters and the relations follow.</summary>
        private void ColumnsChanged()
        {
            StructureChanged();
            FillRelationsTab();
        }

        private void FillColumnDetails()
        {
            LocalSchemaColumn column = _column;
            bool filling = _filling;
            _filling = true;
            try
            {
                _txtColumnName.Text = column != null ? column.Name : "";
                _txtColumnType.Text = column != null ? TypeText(column) : "";
                _txtColumnDescription.Text = column != null ? column.Context : "";
                _txtColumnDescription.Enabled = column != null;
                _gridValues.Rows.Clear();
                _gridValues.Enabled = column != null;
                if (column != null && column.AllowedValues != null)
                {
                    foreach (LocalAllowedValue value in column.AllowedValues)
                    {
                        int index = _gridValues.Rows.Add(value.Value, value.Label);
                        _gridValues.Rows[index].Tag = value;
                    }
                }
            }
            finally
            {
                _filling = filling;
            }
            FillColumnAlsoIn();
        }

        private void FillColumnAlsoIn()
        {
            List<string> others = _column != null && _columnsTable != null
                ? LocalSchemaEditing.SubschemasWithColumn(_file, _current, _columnsTable, _column)
                : new List<string>();
            _lblColumnAlsoIn.Text = others.Count == 0 ? "" : TrFormat(1863, string.Join(", ", others));
            _toolTip.SetToolTip(_lblColumnAlsoIn, _lblColumnAlsoIn.Text);
        }

        /// <summary>The allowed values of the column from the grid (a row without a value does not count).</summary>
        private void ReadAllowedValues()
        {
            if (_filling || _column == null)
                return;
            var values = new List<LocalAllowedValue>();
            foreach (DataGridViewRow row in _gridValues.Rows)
            {
                if (row.IsNewRow)
                    continue;
                string value = Convert.ToString(row.Cells[0].Value, CultureInfo.CurrentCulture) ?? "";
                if (value.Length == 0)
                    continue;
                // The same object keeps what a newer version wrote in it
                var item = row.Tag as LocalAllowedValue ?? new LocalAllowedValue();
                item.Value = value;
                item.Label = Convert.ToString(row.Cells[1].Value, CultureInfo.CurrentCulture) ?? "";
                row.Tag = item;
                values.Add(item);
            }
            _column.AllowedValues = values.Count > 0 ? values : null;
            MarkDirty();
        }

        // ===== Preview =====

        private void ClearPreview()
        {
            if (_gridPreview == null)
                return;
            try { _previewCts?.Cancel(); } catch (ObjectDisposedException) { }
            _previewCts = null;
            _gridPreview.DataSource = null;
            _lblPreview.Text = TrFormat(1916, Number(PreviewRows));
            UpdateColumnsButtons();
        }

        private async Task PreviewAsync()
        {
            if (_columnsTable == null || _file == null || _createConnection == null)
                return;
            ClearPreview();
            var cts = new CancellationTokenSource();
            _previewCts = cts;
            string table = _columnsTable.Name;
            string dialect = _file.Dialect;
            _btnPreview.Enabled = false;
            _lblPreview.Text = TrFormat(1917, table);
            try
            {
                DataTable rows = await Task.Run(() => LocalSchemaEditing.ReadPreview(_createConnection, dialect, table, PreviewRows));
                if (IsDisposed || cts.IsCancellationRequested)
                    return;
                _gridPreview.DataSource = rows;
                _lblPreview.Text = TrFormat(1918, rows.Rows.Count.ToString(CultureInfo.CurrentCulture), table);
            }
            catch (Exception ex)
            {
                if (IsDisposed || cts.IsCancellationRequested)
                    return;
                _gridPreview.DataSource = null;
                _lblPreview.Text = ex.Message;
                _toolTip.SetToolTip(_lblPreview, ex.Message);
            }
            finally
            {
                if (!IsDisposed && _previewCts == cts)
                {
                    _previewCts = null;
                    UpdateColumnsButtons();
                }
                cts.Dispose();
            }
        }
    }
}
