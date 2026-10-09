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
using System.Globalization;
using System.Windows.Forms;
using Reportman.Reporting;

namespace Reportman.Designer
{
    // The Relations tab: the dictionary's relations whose two tables are in the subschema, the ones of the
    // catalog whose target is outside as suggestions («Complete»), and an editor for relations the database
    // does not declare (kept in the dictionary with an empty constraint name).
    public partial class LocalSchemaEditorForm
    {
        private ListView _listRelations;
        private ListViewGroup _groupRelations;
        private ListViewGroup _groupSuggested;
        private Button _btnNewRelation;
        private Button _btnDeleteRelation;
        private Button _btnCompleteRelation;
        private ComboBox _comboSourceTable;
        private ComboBox _comboTargetTable;
        private DataGridView _gridPairs;
        private DataGridViewComboBoxColumn _pairSourceColumn;
        private DataGridViewComboBoxColumn _pairTargetColumn;
        private TextBox _txtRelationDescription;
        private Label _lblRelationState;
        private RelationRef _relation;

        /// <summary>A relation of the list: its source table and the foreign key.</summary>
        private sealed class RelationRef
        {
            public RelationRef(LocalSchemaTable source, LocalSchemaForeignKey fk)
            {
                Source = source;
                Fk = fk;
            }

            public LocalSchemaTable Source;
            public readonly LocalSchemaForeignKey Fk;
        }

        private TabPage BuildRelationsTab()
        {
            var page = new TabPage(Tr(1850)) { Padding = new Padding(6) };

            var toolbar = new FlowLayoutPanel { Dock = DockStyle.Top, Height = 34, WrapContents = false };
            _btnNewRelation = new Button { Text = Tr(1874), AutoSize = true };
            _btnNewRelation.Click += (s, e) => NewRelation();
            _btnDeleteRelation = new Button { Text = Tr(150), AutoSize = true };
            _btnDeleteRelation.Click += (s, e) => DeleteRelation();
            _btnCompleteRelation = new Button { Text = Tr(1867), AutoSize = true };
            _btnCompleteRelation.Click += (s, e) => CompleteRelation();
            _toolTip.SetToolTip(_btnNewRelation, Tr(1868));
            _toolTip.SetToolTip(_btnCompleteRelation, Tr(1919));
            toolbar.Controls.Add(_btnNewRelation);
            toolbar.Controls.Add(_btnDeleteRelation);
            toolbar.Controls.Add(_btnCompleteRelation);

            _listRelations = new ListView
            {
                Dock = DockStyle.Fill,
                View = View.Details,
                FullRowSelect = true,
                HideSelection = false,
                MultiSelect = false,
                ShowGroups = true
            };
            _listRelations.Columns.Add(Tr(1869), 130);
            _listRelations.Columns.Add(Tr(1849), 120);
            _listRelations.Columns.Add(Tr(1870), 130);
            _listRelations.Columns.Add(Tr(1849), 120);
            _listRelations.Columns.Add(Tr(1312), 170);
            _listRelations.Columns.Add(Tr(197), 260);
            // The header of the relations follows the schema shown (FillRelationsTab)
            _groupRelations = new ListViewGroup(Tr(1850));
            _groupSuggested = new ListViewGroup(Tr(1866));
            _listRelations.Groups.Add(_groupRelations);
            _listRelations.Groups.Add(_groupSuggested);
            _listRelations.SelectedIndexChanged += (s, e) =>
            {
                if (_filling)
                    return;
                CommitEdits();
                _relation = _listRelations.SelectedItems.Count > 0 ? (RelationRef)_listRelations.SelectedItems[0].Tag : null;
                FillRelationEditor();
            };

            // The editor
            var editor = new GroupBox { Text = Tr(1464), Dock = DockStyle.Bottom, Height = 250, Padding = new Padding(6) };
            var grid = new TableLayoutPanel { Dock = DockStyle.Fill, ColumnCount = 4, RowCount = 5 };
            grid.ColumnStyles.Add(new ColumnStyle(SizeType.AutoSize));
            grid.ColumnStyles.Add(new ColumnStyle(SizeType.Percent, 50f));
            grid.ColumnStyles.Add(new ColumnStyle(SizeType.AutoSize));
            grid.ColumnStyles.Add(new ColumnStyle(SizeType.Percent, 50f));
            grid.RowStyles.Add(new RowStyle(SizeType.AutoSize));
            grid.RowStyles.Add(new RowStyle(SizeType.Percent, 55f));
            grid.RowStyles.Add(new RowStyle(SizeType.AutoSize));
            grid.RowStyles.Add(new RowStyle(SizeType.Percent, 45f));
            grid.RowStyles.Add(new RowStyle(SizeType.AutoSize));
            _comboSourceTable = new ComboBox { DropDownStyle = ComboBoxStyle.DropDownList, Dock = DockStyle.Fill };
            _comboSourceTable.SelectedIndexChanged += (s, e) => SourceTableChanged();
            _comboTargetTable = new ComboBox { DropDownStyle = ComboBoxStyle.DropDownList, Dock = DockStyle.Fill };
            _comboTargetTable.SelectedIndexChanged += (s, e) => TargetTableChanged();
            grid.Controls.Add(new Label { Text = Tr(1869), AutoSize = true, Anchor = AnchorStyles.Left, Margin = new Padding(0, 4, 6, 4) }, 0, 0);
            grid.Controls.Add(_comboSourceTable, 1, 0);
            grid.Controls.Add(new Label { Text = Tr(1870), AutoSize = true, Anchor = AnchorStyles.Left, Margin = new Padding(12, 4, 6, 4) }, 2, 0);
            grid.Controls.Add(_comboTargetTable, 3, 0);

            _gridPairs = new DataGridView
            {
                Dock = DockStyle.Fill,
                AllowUserToResizeRows = false,
                RowHeadersWidth = 28,
                AutoSizeColumnsMode = DataGridViewAutoSizeColumnsMode.Fill,
                BackgroundColor = SystemColors.Window,
                EditMode = DataGridViewEditMode.EditOnEnter
            };
            _pairSourceColumn = new DataGridViewComboBoxColumn { HeaderText = Tr(1871), FlatStyle = FlatStyle.Flat };
            _pairTargetColumn = new DataGridViewComboBoxColumn { HeaderText = Tr(1872), FlatStyle = FlatStyle.Flat };
            _gridPairs.Columns.Add(_pairSourceColumn);
            _gridPairs.Columns.Add(_pairTargetColumn);
            // A combo takes its value at once, not when the cell is left
            _gridPairs.CurrentCellDirtyStateChanged += (s, e) =>
            {
                if (_gridPairs.IsCurrentCellDirty)
                    _gridPairs.CommitEdit(DataGridViewDataErrorContexts.Commit);
            };
            _gridPairs.CellValueChanged += (s, e) => ReadPairs();
            _gridPairs.UserDeletedRow += (s, e) => ReadPairs();
            _gridPairs.DataError += (s, e) => e.ThrowException = false;
            grid.Controls.Add(_gridPairs, 0, 1);
            grid.SetColumnSpan(_gridPairs, 4);

            var lblDescription = new Label { Text = Tr(1894), AutoSize = true, Margin = new Padding(0, 6, 0, 2) };
            grid.Controls.Add(lblDescription, 0, 2);
            grid.SetColumnSpan(lblDescription, 4);
            _txtRelationDescription = new TextBox { Dock = DockStyle.Fill, Multiline = true, ScrollBars = ScrollBars.Vertical, AcceptsReturn = true };
            _txtRelationDescription.TextChanged += (s, e) =>
            {
                if (_filling || _relation == null)
                    return;
                _relation.Fk.RelationshipContext = _txtRelationDescription.Text;
                MarkDirty();
                UpdateRelationItem(_relation);
            };
            grid.Controls.Add(_txtRelationDescription, 0, 3);
            grid.SetColumnSpan(_txtRelationDescription, 4);
            _lblRelationState = new Label { Dock = DockStyle.Fill, Height = 20, AutoEllipsis = true, ForeColor = SystemColors.GrayText };
            grid.Controls.Add(_lblRelationState, 0, 4);
            grid.SetColumnSpan(_lblRelationState, 4);
            editor.Controls.Add(grid);

            page.Controls.Add(_listRelations);
            page.Controls.Add(toolbar);
            page.Controls.Add(editor);
            return page;
        }

        private static string Names(List<string> names)
        {
            return string.Join(", ", names ?? new List<string>());
        }

        /// <summary>Whether the relation is sent to the AI with the subschema, and if not, why.</summary>
        private string RelationState(RelationRef relation)
        {
            LocalSchemaForeignKey fk = relation.Fk;
            if (LocalSchemaEditing.IsWritten(fk) && !LocalSchemaEditing.IsComplete(fk))
                return Tr(1920);
            if (LocalSchemaEditing.FindTable(_file, fk.TargetTable) == null)
                return Tr(1921);
            if (LocalSchemaEditing.Travels(_file, _current, relation.Source, fk))
                return Tr(1922);
            if (!LocalSchemaEditing.HasTable(_current, fk.TargetTable))
                return Tr(1923);
            return Tr(1924);
        }

        private void FillRelationsTab()
        {
            if (_listRelations == null)
                return;
            RelationRef keep = _relation;
            RelationRef found = null;
            _groupRelations.Header = _current == null ? Tr(1850) : Tr(1893);
            bool filling = _filling;
            _filling = true;
            try
            {
                _listRelations.BeginUpdate();
                try
                {
                    _listRelations.Items.Clear();
                    foreach (LocalSchemaTable source in LocalSchemaEditing.TablesOf(_file, _current))
                    {
                        foreach (LocalSchemaForeignKey fk in source.ForeignKeys)
                        {
                            bool targetKnown = LocalSchemaEditing.FindTable(_file, fk.TargetTable) != null;
                            // In a subschema a relation is of the schema only when it travels (its two ends by table
                            // and by column); any other one with a known target is a suggestion
                            bool travels = targetKnown && LocalSchemaEditing.Travels(_file, _current, source, fk) &&
                                (!LocalSchemaEditing.IsWritten(fk) || LocalSchemaEditing.IsComplete(fk));
                            ListViewGroup group;
                            if (_current == null || travels)
                                group = _groupRelations;
                            else if (targetKnown || LocalSchemaEditing.IsWritten(fk))
                                group = _groupSuggested;
                            else
                                continue; // a target outside the catalog cannot be completed
                            var relation = keep != null && keep.Fk == fk ? keep : new RelationRef(source, fk);
                            relation.Source = source;
                            var item = new ListViewItem(new[] { "", "", "", "", "", "" }) { Tag = relation, Group = group };
                            _listRelations.Items.Add(item);
                            FillRelationItem(item, relation);
                            if (relation == keep)
                            {
                                found = relation;
                                item.Selected = true;
                            }
                        }
                    }
                }
                finally
                {
                    _listRelations.EndUpdate();
                }
                // The table names of the editor (the source among the subschema's tables)
                FillTableCombo(_comboSourceTable, LocalSchemaEditing.TablesOf(_file, _current));
                FillTableCombo(_comboTargetTable, _file != null ? _file.Tables : new List<LocalSchemaTable>());
            }
            finally
            {
                _filling = filling;
            }
            _relation = found;
            FillRelationEditor();
        }

        private static void FillTableCombo(ComboBox combo, List<LocalSchemaTable> tables)
        {
            bool same = combo.Items.Count == tables.Count;
            for (int i = 0; same && i < tables.Count; i++)
                same = (string)combo.Items[i] == tables[i].Name;
            if (same)
                return;
            combo.BeginUpdate();
            try
            {
                combo.Items.Clear();
                foreach (LocalSchemaTable t in tables)
                    combo.Items.Add(t.Name);
            }
            finally
            {
                combo.EndUpdate();
            }
        }

        private void FillRelationItem(ListViewItem item, RelationRef relation)
        {
            LocalSchemaForeignKey fk = relation.Fk;
            item.SubItems[0].Text = relation.Source.Name;
            item.SubItems[1].Text = Names(fk.SourceColumns);
            item.SubItems[2].Text = fk.TargetTable;
            item.SubItems[3].Text = Names(fk.TargetColumns);
            item.SubItems[4].Text = RelationState(relation) + (LocalSchemaEditing.IsWritten(fk) ? " · " + Tr(1875) : "");
            item.SubItems[5].Text = (fk.RelationshipContext ?? "").Replace("\r", " ").Replace("\n", " ");
            item.ForeColor = LocalSchemaEditing.Travels(_file, _current, relation.Source, fk) ? _listRelations.ForeColor : SystemColors.GrayText;
        }

        private void UpdateRelationItem(RelationRef relation)
        {
            foreach (ListViewItem item in _listRelations.Items)
            {
                if (item.Tag == relation)
                {
                    FillRelationItem(item, relation);
                    break;
                }
            }
            _lblRelationState.Text = relation != null ? RelationStateLine(relation) : "";
            UpdateRelationButtons();
        }

        private string RelationStateLine(RelationRef relation)
        {
            string origin = LocalSchemaEditing.IsWritten(relation.Fk)
                ? Tr(1925)
                : TrFormat(1926, relation.Fk.ConstraintName);
            return origin + " · " + RelationState(relation);
        }

        private void FillRelationEditor()
        {
            RelationRef relation = _relation;
            bool written = relation != null && LocalSchemaEditing.IsWritten(relation.Fk);
            bool filling = _filling;
            _filling = true;
            try
            {
                _comboSourceTable.SelectedItem = relation != null ? relation.Source.Name : null;
                if (relation != null && _comboSourceTable.SelectedIndex < 0)
                {
                    // A source outside the list (a relation of all the tables): shown as it is
                    _comboSourceTable.Items.Add(relation.Source.Name);
                    _comboSourceTable.SelectedItem = relation.Source.Name;
                }
                _comboTargetTable.SelectedItem = relation != null && relation.Fk.TargetTable.Length > 0
                    ? (object)LocalSchemaEditing.FindTable(_file, relation.Fk.TargetTable)?.Name : null;
                if (relation == null || _comboTargetTable.SelectedItem == null)
                    _comboTargetTable.SelectedIndex = -1;
                _comboSourceTable.Enabled = written && !_busy;
                _comboTargetTable.Enabled = written && !_busy;
                FillPairs(relation);
                _txtRelationDescription.Text = relation != null ? relation.Fk.RelationshipContext : "";
                _txtRelationDescription.Enabled = relation != null;
                _lblRelationState.Text = relation != null ? RelationStateLine(relation) : "";
            }
            finally
            {
                _filling = filling;
            }
            UpdateRelationButtons();
        }

        private void FillPairs(RelationRef relation)
        {
            bool written = relation != null && LocalSchemaEditing.IsWritten(relation.Fk);
            _gridPairs.Rows.Clear();
            SetComboItems(_pairSourceColumn, relation != null ? relation.Source : null);
            SetComboItems(_pairTargetColumn, relation != null ? LocalSchemaEditing.FindTable(_file, relation.Fk.TargetTable) : null);
            if (relation != null)
            {
                LocalSchemaForeignKey fk = relation.Fk;
                int count = Math.Max(fk.SourceColumns.Count, fk.TargetColumns.Count);
                for (int i = 0; i < count; i++)
                {
                    string source = i < fk.SourceColumns.Count ? fk.SourceColumns[i] : null;
                    string target = i < fk.TargetColumns.Count ? fk.TargetColumns[i] : null;
                    _gridPairs.Rows.Add(ItemOf(_pairSourceColumn, source), ItemOf(_pairTargetColumn, target));
                }
            }
            _gridPairs.ReadOnly = !written || _busy;
            _gridPairs.AllowUserToAddRows = written && !_busy;
            _gridPairs.AllowUserToDeleteRows = written && !_busy;
            _gridPairs.Enabled = relation != null;
        }

        private static void SetComboItems(DataGridViewComboBoxColumn column, LocalSchemaTable table)
        {
            column.Items.Clear();
            if (table == null)
                return;
            foreach (LocalSchemaColumn c in table.Columns)
                column.Items.Add(c.Name);
        }

        // The name as the combo has it (a value not in its items would not be shown)
        private static object ItemOf(DataGridViewComboBoxColumn column, string name)
        {
            if (string.IsNullOrEmpty(name))
                return null;
            foreach (object item in column.Items)
                if (string.Equals((string)item, name, StringComparison.OrdinalIgnoreCase))
                    return item;
            column.Items.Add(name);
            return name;
        }

        private void UpdateRelationButtons()
        {
            if (_btnNewRelation == null)
                return;
            bool editable = _file != null && !_busy;
            bool written = _relation != null && LocalSchemaEditing.IsWritten(_relation.Fk);
            _btnNewRelation.Enabled = editable && LocalSchemaEditing.TablesOf(_file, _current).Count > 0;
            _btnDeleteRelation.Enabled = editable && written;
            _btnCompleteRelation.Enabled = editable && _current != null && _relation != null &&
                LocalSchemaEditing.FindTable(_file, _relation.Fk.TargetTable) != null &&
                (!LocalSchemaEditing.IsWritten(_relation.Fk) || LocalSchemaEditing.IsComplete(_relation.Fk)) &&
                !LocalSchemaEditing.Travels(_file, _current, _relation.Source, _relation.Fk);
        }

        /// <summary>
        /// The pairs of columns of the relation from the grid; a pair with one side still empty is kept with
        /// an empty name (the relation is incomplete and is not sent until it has both).
        /// </summary>
        private void ReadPairs()
        {
            if (_filling || _relation == null || !LocalSchemaEditing.IsWritten(_relation.Fk))
                return;
            var sources = new List<string>();
            var targets = new List<string>();
            foreach (DataGridViewRow row in _gridPairs.Rows)
            {
                if (row.IsNewRow)
                    continue;
                string source = row.Cells[0].Value as string;
                string target = row.Cells[1].Value as string;
                if (string.IsNullOrEmpty(source) && string.IsNullOrEmpty(target))
                    continue;
                sources.Add(source ?? "");
                targets.Add(target ?? "");
            }
            _relation.Fk.SourceColumns = sources;
            _relation.Fk.TargetColumns = targets;
            MarkDirty();
            UpdateRelationItem(_relation);
            CompleteWrittenLater();
        }

        private void NewRelation()
        {
            List<LocalSchemaTable> tables = LocalSchemaEditing.TablesOf(_file, _current);
            if (tables.Count == 0)
                return;
            CommitEdits();
            // From the table being looked at in Columns, else the first one
            LocalSchemaTable source = _columnsTable != null && tables.Contains(_columnsTable) ? _columnsTable : tables[0];
            var fk = new LocalSchemaForeignKey { ConstraintName = "" };
            source.ForeignKeys.Add(fk);
            _relation = new RelationRef(source, fk);
            MarkDirty();
            FillRelationsTab();
            _comboTargetTable.Focus();
        }

        private void DeleteRelation()
        {
            if (_relation == null || !LocalSchemaEditing.IsWritten(_relation.Fk))
                return;
            string target = _relation.Fk.TargetTable.Length > 0 ? _relation.Fk.TargetTable : "?";
            if (MessageBox.Show(this, TrFormat(1927, _relation.Source.Name + " → " + target), Tr(150),
                MessageBoxButtons.YesNo, MessageBoxIcon.Question) != DialogResult.Yes)
                return;
            _relation.Source.ForeignKeys.Remove(_relation.Fk);
            _relation = null;
            MarkDirty();
            FillRelationsTab();
        }

        private void CompleteRelation()
        {
            if (_relation == null || _current == null)
                return;
            CommitEdits();
            if (!LocalSchemaEditing.Complete(_file, _current, _relation.Source, _relation.Fk))
                return;
            TablesChanged();
        }

        private void SourceTableChanged()
        {
            if (_filling || _relation == null || !LocalSchemaEditing.IsWritten(_relation.Fk))
                return;
            LocalSchemaTable source = LocalSchemaEditing.FindTable(_file, _comboSourceTable.SelectedItem as string);
            if (source == null || source == _relation.Source)
                return;
            // The relation belongs to its source table: it moves, and the source columns go
            _relation.Source.ForeignKeys.Remove(_relation.Fk);
            source.ForeignKeys.Add(_relation.Fk);
            _relation.Source = source;
            _relation.Fk.SourceColumns = new List<string>();
            _relation.Fk.TargetColumns = new List<string>();
            PrefillPairs(_relation);
            MarkDirty();
            FillRelationsTab();
            CompleteWrittenLater();
        }

        private void TargetTableChanged()
        {
            if (_filling || _relation == null || !LocalSchemaEditing.IsWritten(_relation.Fk))
                return;
            LocalSchemaTable target = LocalSchemaEditing.FindTable(_file, _comboTargetTable.SelectedItem as string);
            if (target == null || string.Equals(target.Name, _relation.Fk.TargetTable, StringComparison.OrdinalIgnoreCase))
                return;
            _relation.Fk.TargetTable = target.Name;
            PrefillPairs(_relation);
            MarkDirty();
            FillRelationsTab();
            CompleteWrittenLater();
        }

        /// <summary>
        /// A relation written while a subschema is shown is completed as a suggestion is, as soon as it has a
        /// target and all its pairs: the target table and the columns of both ends enter the subschema.
        /// Deferred: the grid may still be committing the value.
        /// </summary>
        private void CompleteWrittenLater()
        {
            RelationRef relation = _relation;
            if (_current == null || relation == null || !NeedsCompleting(relation))
                return;
            BeginInvoke(new Action(() =>
            {
                if (IsDisposed || _current == null || !NeedsCompleting(relation))
                    return;
                if (LocalSchemaEditing.Complete(_file, _current, relation.Source, relation.Fk))
                {
                    _relation = relation;
                    TablesChanged();
                }
            }));
        }

        private bool NeedsCompleting(RelationRef relation)
        {
            return LocalSchemaEditing.IsWritten(relation.Fk) && LocalSchemaEditing.IsComplete(relation.Fk) &&
                LocalSchemaEditing.FindTable(_file, relation.Fk.TargetTable) != null &&
                !LocalSchemaEditing.Travels(_file, _current, relation.Source, relation.Fk);
        }

        /// <summary>
        /// The pairs a new target suggests: its primary key, each one with the source column of the same name,
        /// or with none to choose in the grid.
        /// </summary>
        private void PrefillPairs(RelationRef relation)
        {
            LocalSchemaTable target = LocalSchemaEditing.FindTable(_file, relation.Fk.TargetTable);
            var sources = new List<string>();
            var targets = new List<string>();
            if (target != null)
            {
                foreach (string key in LocalSchemaEditing.PrimaryKey(target))
                {
                    LocalSchemaColumn source = LocalSchemaEditing.FindColumn(relation.Source, key);
                    sources.Add(source != null ? source.Name : "");
                    targets.Add(key);
                }
            }
            relation.Fk.SourceColumns = sources;
            relation.Fk.TargetColumns = targets;
        }
    }
}
