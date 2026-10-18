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
using Reportman.Reporting;

namespace Reportman.Designer
{
    // The Tables tab: the tables of the database and the ones the subschema chooses (a table enters with its
    // primary key, its columns read first when the catalog is large), and the description of a table, which is
    // the dictionary's.
    public partial class LocalSchemaEditorForm
    {
        private TableLayoutPanel _tablesLayout;
        private Panel _availablePanel;
        private Panel _tableButtonsPanel;
        private TableList _listAvailable;
        private TableList _listChosen;
        private Label _lblAvailable;
        private Label _lblChosen;
        private TextBox _txtAvailableFilter;
        private TextBox _txtChosenFilter;
        private Label _lblAvailableCount;
        private Label _lblChosenCount;
        private Button _btnAddTables;
        private Button _btnRemoveTables;
        private Label _lblTableDescription;
        private Label _lblTableAlsoIn;
        private TextBox _txtTableDescription;
        private LocalSchemaTable _describedTable;

        /// <summary>
        /// A list of tables that paints only the rows it shows, so that a large catalog (a hundred thousand tables,
        /// filtered or not) fills and scrolls at once: a ListView in virtual mode with one column and no header, as a
        /// list box. Its tables are set at once (<see cref="SetTables"/>) keeping the selection by name, and
        /// <see cref="SelectionChanged"/> is raised once for what the user does, never for what the program does.
        /// Internal for the self-test (DesignerSelfTestLocalSchema).
        /// </summary>
        internal sealed class TableList : ListView
        {
            private List<LocalSchemaTable> _tables = new List<LocalSchemaTable>();
            // The names to select when the window is created (a list of a tab not shown yet has none)
            private HashSet<string> _pending;
            private string _pendingFocus;
            private int _quiet;
            private bool _posted;

            public TableList(bool multiSelect)
            {
                View = View.Details;
                HeaderStyle = ColumnHeaderStyle.None;
                FullRowSelect = true;
                HideSelection = false;
                MultiSelect = multiSelect;
                VirtualMode = true;
                Columns.Add("", 100);
                RetrieveVirtualItem += (s, e) =>
                    e.Item = new ListViewItem(e.ItemIndex >= 0 && e.ItemIndex < _tables.Count ? _tables[e.ItemIndex].Name : "");
                SearchForVirtualItem += SearchTable;
                // A click changes the selection twice (the old item, the new one) and a range comes apart: once, later
                SelectedIndexChanged += (s, e) => Changed();
                VirtualItemsSelectionRangeChanged += (s, e) => Changed();
                ClientSizeChanged += (s, e) => FitColumn();
            }

            /// <summary>The user changed the selection.</summary>
            public event EventHandler SelectionChanged;

            /// <summary>The tables of the list, in its order.</summary>
            public List<LocalSchemaTable> Tables
            {
                get { return _tables; }
            }

            /// <summary>The tables selected, in the order of the list.</summary>
            public List<LocalSchemaTable> SelectedTables
            {
                get
                {
                    var result = new List<LocalSchemaTable>();
                    if (!IsHandleCreated)
                        return result;
                    foreach (int index in SelectedIndices)
                        if (index >= 0 && index < _tables.Count)
                            result.Add(_tables[index]);
                    return result;
                }
            }

            /// <summary>The number of tables selected.</summary>
            public int SelectedCount
            {
                get { return IsHandleCreated ? SelectedIndices.Count : 0; }
            }

            /// <summary>The table the user is on: the focused one when it is selected, else the first selected; null for none.</summary>
            public LocalSchemaTable CurrentTable
            {
                get
                {
                    if (!IsHandleCreated || SelectedIndices.Count == 0)
                        return null;
                    ListViewItem focused = FocusedItem;
                    if (focused != null && focused.Index >= 0 && focused.Index < _tables.Count && SelectedIndices.Contains(focused.Index))
                        return _tables[focused.Index];
                    int first = SelectedIndices[0];
                    return first >= 0 && first < _tables.Count ? _tables[first] : null;
                }
            }

            /// <summary>Shows <paramref name="tables"/>, the ones selected before (by name) still selected.</summary>
            public void SetTables(List<LocalSchemaTable> tables)
            {
                HashSet<string> selected;
                string focus;
                if (IsHandleCreated)
                {
                    var names = new List<string>();
                    foreach (LocalSchemaTable t in SelectedTables)
                        names.Add(t.Name);
                    selected = LocalSchemaEditing.NameSet(names);
                    LocalSchemaTable current = CurrentTable;
                    focus = current != null ? current.Name : null;
                }
                else
                {
                    selected = _pending ?? new HashSet<string>(StringComparer.OrdinalIgnoreCase);
                    focus = _pendingFocus;
                }
                _tables = tables ?? new List<LocalSchemaTable>();
                Select(selected, focus);
            }

            /// <summary>Selects <paramref name="tables"/> (none for null), the last one focused and shown.</summary>
            public void SelectTables(IEnumerable<LocalSchemaTable> tables)
            {
                var names = new List<string>();
                if (tables != null)
                    foreach (LocalSchemaTable t in tables)
                        if (t != null)
                            names.Add(t.Name);
                Select(LocalSchemaEditing.NameSet(names), names.Count > 0 ? names[names.Count - 1] : null);
            }

            private void Select(HashSet<string> names, string focus)
            {
                if (!IsHandleCreated)
                {
                    _pending = names;
                    _pendingFocus = focus;
                    VirtualListSize = _tables.Count;
                    return;
                }
                _pending = null;
                _pendingFocus = null;
                _quiet++;
                BeginUpdate();
                try
                {
                    SelectedIndices.Clear();
                    VirtualListSize = _tables.Count;
                    int shown = -1;
                    if (names.Count > 0)
                    {
                        for (int i = 0; i < _tables.Count; i++)
                        {
                            if (!names.Contains(_tables[i].Name))
                                continue;
                            SelectedIndices.Add(i);
                            if (shown < 0 || string.Equals(_tables[i].Name, focus, StringComparison.OrdinalIgnoreCase))
                                shown = i;
                        }
                    }
                    if (shown >= 0)
                    {
                        Items[shown].Focused = true;
                        EnsureVisible(shown);
                    }
                }
                finally
                {
                    EndUpdate();
                    _quiet--;
                }
                // The same number of rows with other tables: the control would not paint them
                Invalidate();
            }

            protected override void OnHandleCreated(EventArgs e)
            {
                base.OnHandleCreated(e);
                FitColumn();
                Select(_pending ?? new HashSet<string>(StringComparer.OrdinalIgnoreCase), _pendingFocus);
            }

            private void Changed()
            {
                if (_quiet > 0 || _posted || !IsHandleCreated)
                    return;
                _posted = true;
                BeginInvoke(new Action(() =>
                {
                    _posted = false;
                    if (!IsDisposed && SelectionChanged != null)
                        SelectionChanged(this, EventArgs.Empty);
                }));
            }

            // Typing the first letters of a name goes to it, as in a list box
            private void SearchTable(object sender, SearchForVirtualItemEventArgs e)
            {
                if (string.IsNullOrEmpty(e.Text) || _tables.Count == 0)
                    return;
                int start = e.StartIndex >= 0 && e.StartIndex < _tables.Count ? e.StartIndex : 0;
                for (int n = 0; n < _tables.Count; n++)
                {
                    int i = (start + n) % _tables.Count;
                    string name = _tables[i].Name;
                    if (e.IsPrefixSearch ? name.StartsWith(e.Text, StringComparison.CurrentCultureIgnoreCase)
                        : string.Equals(name, e.Text, StringComparison.CurrentCultureIgnoreCase))
                    {
                        e.Index = i;
                        return;
                    }
                }
            }

            // The one column takes the width of the list: no horizontal bar, a long name ends in an ellipsis
            private void FitColumn()
            {
                if (Columns.Count == 0)
                    return;
                int width = Math.Max(20, ClientSize.Width - 1);
                if (Columns[0].Width != width)
                    Columns[0].Width = width;
            }
        }

        private TabPage BuildTablesTab()
        {
            var page = new TabPage(Tr(1848)) { Padding = new Padding(6) };

            _listAvailable = new TableList(true);
            _listAvailable.DoubleClick += (s, e) => AddSelectedTables();
            _listAvailable.SelectionChanged += (s, e) => DescribeTable(_listAvailable.CurrentTable);
            _availablePanel = NewListPanel(_listAvailable, out _lblAvailable, out _txtAvailableFilter, out _lblAvailableCount);
            _lblAvailable.Text = Tr(1857);
            _txtAvailableFilter.TextChanged += (s, e) => FillAvailableTables();

            _listChosen = new TableList(true);
            _listChosen.DoubleClick += (s, e) => RemoveSelectedTables();
            _listChosen.SelectionChanged += (s, e) => DescribeTable(_listChosen.CurrentTable);
            Panel chosenPanel = NewListPanel(_listChosen, out _lblChosen, out _txtChosenFilter, out _lblChosenCount);
            _txtChosenFilter.TextChanged += (s, e) => FillChosenTables();

            _tableButtonsPanel = new Panel { Dock = DockStyle.Fill, Margin = new Padding(0) };
            _btnAddTables = new Button { Text = "→", Width = 40, Height = 30, Left = 4, Top = 80 };
            _btnAddTables.Click += (s, e) => AddSelectedTables();
            _btnRemoveTables = new Button { Text = "←", Width = 40, Height = 30, Left = 4, Top = 116 };
            _btnRemoveTables.Click += (s, e) => RemoveSelectedTables();
            _toolTip.SetToolTip(_btnAddTables, Tr(1909));
            _toolTip.SetToolTip(_btnRemoveTables, Tr(1910));
            // The arrows say nothing to a screen reader: the same texts as the tooltips
            _btnAddTables.AccessibleName = Tr(1909);
            _btnRemoveTables.AccessibleName = Tr(1910);
            _tableButtonsPanel.Controls.Add(_btnAddTables);
            _tableButtonsPanel.Controls.Add(_btnRemoveTables);

            _tablesLayout = new TableLayoutPanel { Dock = DockStyle.Fill, ColumnCount = 3, RowCount = 1 };
            _tablesLayout.ColumnStyles.Add(new ColumnStyle(SizeType.Percent, 50f));
            _tablesLayout.ColumnStyles.Add(new ColumnStyle(SizeType.Absolute, 50f));
            _tablesLayout.ColumnStyles.Add(new ColumnStyle(SizeType.Percent, 50f));
            _tablesLayout.RowStyles.Add(new RowStyle(SizeType.Percent, 100f));
            _tablesLayout.Controls.Add(_availablePanel, 0, 0);
            _tablesLayout.Controls.Add(_tableButtonsPanel, 1, 0);
            _tablesLayout.Controls.Add(chosenPanel, 2, 0);

            var description = new Panel { Dock = DockStyle.Bottom, Height = 130, Padding = new Padding(0, 8, 0, 0) };
            _lblTableDescription = new Label { Dock = DockStyle.Top, Height = 20, AutoEllipsis = true };
            _lblTableAlsoIn = new Label { Dock = DockStyle.Bottom, Height = 20, AutoEllipsis = true, ForeColor = SystemColors.GrayText };
            _txtTableDescription = new TextBox { Dock = DockStyle.Fill, Multiline = true, ScrollBars = ScrollBars.Vertical, AcceptsReturn = true };
            _txtTableDescription.TextChanged += (s, e) =>
            {
                if (_filling || _describedTable == null)
                    return;
                _describedTable.Context = _txtTableDescription.Text;
                MarkDirty();
            };
            description.Controls.Add(_txtTableDescription);
            description.Controls.Add(_lblTableAlsoIn);
            description.Controls.Add(_lblTableDescription);

            page.Controls.Add(_tablesLayout);
            page.Controls.Add(description);
            return page;
        }

        private void FillTablesTab()
        {
            bool all = _current == null;
            // With all the tables nothing is chosen: the dictionary is only seen and described
            _tablesLayout.ColumnStyles[0].Width = all ? 0f : 50f;
            _tablesLayout.ColumnStyles[1].Width = all ? 0f : 50f;
            _availablePanel.Visible = !all;
            _tableButtonsPanel.Visible = !all;
            _lblChosen.Text = all ? Tr(1843) : Tr(1858);
            FillAvailableTables();
            FillChosenTables();
            LocalSchemaTable described = _describedTable != null && _file != null
                ? LocalSchemaEditing.FindTable(_file, _describedTable.Name) : null;
            DescribeTable(described);
        }

        private void FillAvailableTables()
        {
            var tables = new List<LocalSchemaTable>();
            int total = 0;
            if (_file != null && _current != null)
            {
                HashSet<string> chosen = LocalSchemaEditing.NameSet(_current.Tables);
                var filter = new LocalSchemaFilter(_txtAvailableFilter.Text);
                foreach (LocalSchemaTable t in _file.Tables)
                {
                    if (chosen.Contains(t.Name))
                        continue;
                    total++;
                    if (filter.Matches(t.Name, t.Context))
                        tables.Add(t);
                }
            }
            bool filling = _filling;
            _filling = true;
            try
            {
                _listAvailable.SetTables(tables);
            }
            finally
            {
                _filling = filling;
            }
            _lblAvailableCount.Text = CountText(tables.Count, total);
            UpdateTablesButtons();
        }

        private void FillChosenTables()
        {
            var tables = new List<LocalSchemaTable>();
            List<LocalSchemaTable> chosen = LocalSchemaEditing.TablesOf(_file, _current);
            var filter = new LocalSchemaFilter(_txtChosenFilter.Text);
            foreach (LocalSchemaTable t in chosen)
                if (filter.Matches(t.Name, t.Context))
                    tables.Add(t);
            bool filling = _filling;
            _filling = true;
            try
            {
                _listChosen.SetTables(tables);
            }
            finally
            {
                _filling = filling;
            }
            _lblChosenCount.Text = CountText(tables.Count, chosen.Count);
            UpdateTablesButtons();
        }

        private static string CountText(int shown, int total)
        {
            return shown == total ? TrFormat(1883, Number(total)) : TrFormat(1911, Number(shown), Number(total));
        }

        private void UpdateTablesButtons()
        {
            if (_btnAddTables == null)
                return;
            bool editable = _file != null && _current != null && !_busy;
            _btnAddTables.Enabled = editable && _listAvailable.SelectedCount > 0;
            _btnRemoveTables.Enabled = editable && _listChosen.SelectedCount > 0;
            _txtTableDescription.Enabled = _describedTable != null;
        }

        private void DescribeTable(LocalSchemaTable table)
        {
            UpdateTablesButtons();
            if (_filling)
                return;
            _describedTable = table;
            _filling = true;
            try
            {
                _txtTableDescription.Text = table != null ? table.Context : "";
            }
            finally
            {
                _filling = false;
            }
            _lblTableDescription.Text = table != null ? Tr(1860) + ": " + table.Name : Tr(1860);
            List<string> others = table != null ? LocalSchemaEditing.SubschemasWithTable(_file, _current, table) : new List<string>();
            _lblTableAlsoIn.Text = others.Count == 0 ? "" : TrFormat(1863, string.Join(", ", others));
            _toolTip.SetToolTip(_lblTableAlsoIn, _lblTableAlsoIn.Text);
            UpdateTablesButtons();
        }

        /// <summary>
        /// Adds the tables selected on the left to the subschema. Of a large catalog their columns are read first (the
        /// subschema's tables always have them): one that cannot be read is not added, and the status line says why.
        /// </summary>
        private async void AddSelectedTables()
        {
            if (_file == null || _current == null || _busy || _listAvailable.SelectedCount == 0)
                return;
            LocalSubschema subschema = _current;
            List<LocalSchemaTable> tables = _listAvailable.SelectedTables;
            var names = new List<string>();
            foreach (LocalSchemaTable t in tables)
                names.Add(t.Name);
            await ReadColumnsAsync(names, true);
            if (IsDisposed || _current != subschema)
                return;
            // The tables are the file's: reading their columns filled them in place
            tables.RemoveAll(t => !LocalSchemaStore.IsRead(t));
            if (tables.Count == 0)
                return;
            foreach (LocalSchemaTable t in tables)
                LocalSchemaEditing.AddTable(_file, _current, t);
            TablesChanged();
            // The tables added stay selected on the right, for their description
            _filling = true;
            try
            {
                _listChosen.SelectTables(tables);
            }
            finally
            {
                _filling = false;
            }
            DescribeTable(tables[tables.Count - 1]);
        }

        private void RemoveSelectedTables()
        {
            if (_file == null || _current == null || _listChosen.SelectedCount == 0)
                return;
            var names = new List<string>();
            foreach (LocalSchemaTable t in _listChosen.SelectedTables)
                names.Add(t.Name);
            // Only the choice goes: the descriptions stay in the dictionary
            foreach (string name in names)
                LocalSchemaEditing.RemoveTable(_current, name);
            TablesChanged();
        }

        /// <summary>The tables of the subschema changed: every tab that shows them follows.</summary>
        private void TablesChanged()
        {
            StructureChanged();
            FillAvailableTables();
            FillChosenTables();
            FillColumnsTab();
            FillRelationsTab();
        }
    }
}
