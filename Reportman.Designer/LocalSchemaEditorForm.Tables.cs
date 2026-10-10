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
    // primary key), and the description of a table, which is the dictionary's.
    public partial class LocalSchemaEditorForm
    {
        private TableLayoutPanel _tablesLayout;
        private Panel _availablePanel;
        private Panel _tableButtonsPanel;
        private ListBox _listAvailable;
        private ListBox _listChosen;
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

        private TabPage BuildTablesTab()
        {
            var page = new TabPage(Tr(1848)) { Padding = new Padding(6) };

            _listAvailable = new ListBox { IntegralHeight = false, SelectionMode = SelectionMode.MultiExtended, DisplayMember = "Name" };
            _listAvailable.DoubleClick += (s, e) => AddSelectedTables();
            _listAvailable.SelectedIndexChanged += (s, e) => DescribeTable(_listAvailable.SelectedItem as LocalSchemaTable);
            _availablePanel = NewListPanel(_listAvailable, out _lblAvailable, out _txtAvailableFilter, out _lblAvailableCount);
            _lblAvailable.Text = Tr(1857);
            _txtAvailableFilter.TextChanged += (s, e) => FillAvailableTables();

            _listChosen = new ListBox { IntegralHeight = false, SelectionMode = SelectionMode.MultiExtended, DisplayMember = "Name" };
            _listChosen.DoubleClick += (s, e) => RemoveSelectedTables();
            _listChosen.SelectedIndexChanged += (s, e) => DescribeTable(_listChosen.SelectedItem as LocalSchemaTable);
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

        private static void FillList(ListBox list, List<LocalSchemaTable> tables)
        {
            var selected = new List<string>();
            foreach (object item in list.SelectedItems)
                selected.Add(((LocalSchemaTable)item).Name);
            list.BeginUpdate();
            try
            {
                list.Items.Clear();
                foreach (LocalSchemaTable t in tables)
                {
                    int index = list.Items.Add(t);
                    if (selected.Contains(t.Name))
                        list.SetSelected(index, true);
                }
            }
            finally
            {
                list.EndUpdate();
            }
        }

        private void FillAvailableTables()
        {
            var tables = new List<LocalSchemaTable>();
            int total = 0;
            if (_file != null && _current != null)
            {
                foreach (LocalSchemaTable t in _file.Tables)
                {
                    if (LocalSchemaEditing.HasTable(_current, t.Name))
                        continue;
                    total++;
                    if (MatchesFilter(t.Name, _txtAvailableFilter.Text))
                        tables.Add(t);
                }
            }
            bool filling = _filling;
            _filling = true;
            try
            {
                FillList(_listAvailable, tables);
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
            foreach (LocalSchemaTable t in chosen)
                if (MatchesFilter(t.Name, _txtChosenFilter.Text))
                    tables.Add(t);
            bool filling = _filling;
            _filling = true;
            try
            {
                FillList(_listChosen, tables);
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
            _btnAddTables.Enabled = editable && _listAvailable.SelectedItems.Count > 0;
            _btnRemoveTables.Enabled = editable && _listChosen.SelectedItems.Count > 0;
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

        private void AddSelectedTables()
        {
            if (_file == null || _current == null || _listAvailable.SelectedItems.Count == 0)
                return;
            var tables = new List<LocalSchemaTable>();
            foreach (object item in _listAvailable.SelectedItems)
                tables.Add((LocalSchemaTable)item);
            foreach (LocalSchemaTable t in tables)
                LocalSchemaEditing.AddTable(_file, _current, t);
            TablesChanged();
            // The tables added stay selected on the right, for their description
            _filling = true;
            try
            {
                _listChosen.ClearSelected();
                foreach (LocalSchemaTable t in tables)
                {
                    int index = _listChosen.Items.IndexOf(t);
                    if (index >= 0)
                        _listChosen.SetSelected(index, true);
                }
            }
            finally
            {
                _filling = false;
            }
            DescribeTable(tables.Count > 0 ? tables[tables.Count - 1] : null);
        }

        private void RemoveSelectedTables()
        {
            if (_file == null || _current == null || _listChosen.SelectedItems.Count == 0)
                return;
            var names = new List<string>();
            foreach (object item in _listChosen.SelectedItems)
                names.Add(((LocalSchemaTable)item).Name);
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
