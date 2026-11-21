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

using Reportman.Drawing;
using Reportman.Reporting;
using System;
using System.Collections.Generic;
using System.Data;
using System.Drawing;
using System.Windows.Forms;

namespace Reportman.Designer
{
    /// <summary>
    /// The union of a dataset of the MyBase connection: the datasets it joins (DataUnions, "ALIAS" or
    /// "ALIAS-FIELD1;FIELD2" with the fields a parallel union matches by), and how (ParallelUnion,
    /// GroupUnion, MyBaseIndexFields).
    /// </summary>
    internal class UnionSettings
    {
        public List<string> Entries = new List<string>();
        public bool Parallel;
        public bool Group;
        public string IndexFields = "";

        /// <summary>The settings of a dataset.</summary>
        public static UnionSettings Of(DataInfo info)
        {
            var settings = new UnionSettings();
            foreach (string entry in info.DataUnions)
            {
                if (entry.Trim().Length > 0)
                    settings.Entries.Add(entry.Trim());
            }
            settings.Parallel = info.ParallelUnion;
            settings.Group = info.GroupUnion;
            settings.IndexFields = info.MyBaseIndexFields ?? "";
            return settings;
        }

        /// <summary>Writes the settings to a dataset.</summary>
        public void ApplyTo(DataInfo info)
        {
            info.DataUnions.Clear();
            foreach (string entry in Entries)
                info.DataUnions.Add(entry);
            info.ParallelUnion = Parallel;
            info.GroupUnion = Group;
            info.MyBaseIndexFields = IndexFields.Trim();
        }

        /// <summary>The text of the unions in the inspector: the entries separated by commas.</summary>
        public static string Summary(DataInfo info)
        {
            var entries = new List<string>();
            foreach (string entry in info.DataUnions)
            {
                if (entry.Trim().Length > 0)
                    entries.Add(entry.Trim());
            }
            return string.Join(", ", entries.ToArray());
        }

        /// <summary>The entries of a text of the inspector (separated by commas).</summary>
        public static List<string> ParseSummary(string text)
        {
            var entries = new List<string>();
            foreach (string entry in (text ?? "").Split(','))
            {
                if (entry.Trim().Length > 0)
                    entries.Add(entry.Trim());
            }
            return entries;
        }

        /// <summary>The dataset alias of an entry.</summary>
        public static string AliasOf(string entry)
        {
            int index = entry.IndexOf('-');
            return index < 0 ? entry : entry.Substring(0, index);
        }

        /// <summary>The common fields of an entry, as written ("" without them).</summary>
        public static string FieldsOf(string entry)
        {
            int index = entry.IndexOf('-');
            return index < 0 ? "" : entry.Substring(index + 1);
        }

        /// <summary>An entry from an alias and its common fields.</summary>
        public static string EntryOf(string alias, string fields)
        {
            var list = new List<string>();
            foreach (string field in (fields ?? "").Split(';'))
            {
                if (field.Trim().Length > 0)
                    list.Add(field.Trim());
            }
            return list.Count == 0 ? alias : alias + "-" + string.Join(";", list.ToArray());
        }

        private static int CountFields(string entry)
        {
            int count = 0;
            foreach (string field in FieldsOf(entry).Split(';'))
            {
                if (field.Trim().Length > 0)
                    count++;
            }
            return count;
        }

        /// <summary>
        /// What the engine would refuse, or null: a grouped union without index fields, a parallel union
        /// whose datasets do not name as many common fields as the first one.
        /// </summary>
        public string Validate()
        {
            if (Group && IndexFields.Trim().Length == 0)
                return Translator.TranslateStr(1084) + ": " + Translator.TranslateStr(164);
            if (Parallel && Entries.Count > 1)
            {
                int first = CountFields(Entries[0]);
                if (first > 0)
                {
                    for (int i = 1; i < Entries.Count; i++)
                    {
                        if (CountFields(Entries[i]) != first)
                            return Translator.TranslateStr(1444) + ": " + Entries[i];
                    }
                }
            }
            return null;
        }

        /// <summary>
        /// The columns the union gives (null when the fields of a dataset are not known): those of the first
        /// dataset and, in a parallel union, for each other one Qnn_ and its fields with the prefix but the
        /// common ones.
        /// </summary>
        public List<string> ResultColumns(Func<string, List<string>> fieldsOf)
        {
            var columns = new List<string>();
            for (int i = 0; i < Entries.Count; i++)
            {
                List<string> fields = fieldsOf(AliasOf(Entries[i]));
                if (fields == null)
                    return null;
                if (i == 0)
                {
                    columns.AddRange(fields);
                    continue;
                }
                if (!Parallel)
                    continue;
                string prefix = "Q" + (i + 1).ToString("00") + "_";
                var common = new List<string>();
                foreach (string field in FieldsOf(Entries[i]).Split(';'))
                {
                    if (field.Trim().Length > 0)
                        common.Add(field.Trim().ToUpperInvariant());
                }
                columns.Add(prefix);
                foreach (string field in fields)
                {
                    if (!common.Contains(field.ToUpperInvariant()))
                        columns.Add(prefix + field);
                }
            }
            return columns;
        }
    }

    /// <summary>
    /// The dialog of the unions of a dataset of the MyBase connection: the datasets it joins, in order, the
    /// fields a parallel union matches by, the grouping and the index fields.
    /// </summary>
    internal class UnionsEditorForm : Form
    {
        private readonly BaseReport report;
        private readonly string alias;
        private readonly UnionSettings settings;
        private readonly Dictionary<string, List<string>> fieldCache = new Dictionary<string, List<string>>(StringComparer.OrdinalIgnoreCase);
        private readonly ListBox listAvailable = new ListBox();
        private readonly ListBox listUnions = new ListBox();
        private readonly CheckedListBox listFields = new CheckedListBox();
        private readonly TextBox textFields = new TextBox();
        private readonly CheckBox checkParallel = new CheckBox();
        private readonly CheckBox checkGroup = new CheckBox();
        private readonly TextBox textIndex = new TextBox();
        private readonly Label labelColumns = new Label();
        private readonly Label labelFields = new Label();
        private bool updating;

        /// <summary>The settings as the dialog leaves them.</summary>
        public UnionSettings Settings { get { return settings; } }

        public UnionsEditorForm(DataInfo info)
        {
            report = info.Report;
            alias = info.Alias;
            settings = UnionSettings.Of(info);
            BuildControls();
            foreach (DataInfo other in report.DataInfo)
            {
                if (!string.Equals(other.Alias, alias, StringComparison.OrdinalIgnoreCase))
                    listAvailable.Items.Add(other.Alias);
            }
            updating = true;
            checkParallel.Checked = settings.Parallel;
            checkGroup.Checked = settings.Group;
            textIndex.Text = settings.IndexFields;
            updating = false;
            FillUnions(0);
        }

        private void BuildControls()
        {
            Text = Translator.TranslateStr(1083) + " - " + alias;
            Font = new Font("Segoe UI", 9F);
            AutoScaleMode = AutoScaleMode.Font;
            FormBorderStyle = FormBorderStyle.Sizable;
            MinimizeBox = false;
            MaximizeBox = false;
            ShowInTaskbar = false;
            StartPosition = FormStartPosition.CenterParent;
            ClientSize = new Size(760, 520);
            MinimumSize = new Size(640, 480);

            var tips = new ToolTip();
            var labelAvailable = new Label { Text = Translator.TranslateStr(1100), Location = new Point(12, 12), AutoSize = true };
            listAvailable.SetBounds(12, 32, 240, 220);
            listAvailable.Anchor = AnchorStyles.Top | AnchorStyles.Left;
            listAvailable.DoubleClick += delegate { AddSelected(); };

            var buttonAdd = new Button { Text = ">", Location = new Point(260, 60), Size = new Size(72, 28) };
            buttonAdd.Click += delegate { AddSelected(); };
            tips.SetToolTip(buttonAdd, Translator.TranslateStr(948));
            var buttonRemove = new Button { Text = "<", Location = new Point(260, 96), Size = new Size(72, 28) };
            buttonRemove.Click += delegate { RemoveSelected(); };
            tips.SetToolTip(buttonRemove, Translator.TranslateStr(949));
            var buttonUp = new Button { Text = Translator.TranslateStr(27), Location = new Point(260, 148), Size = new Size(72, 28) };
            buttonUp.Click += delegate { MoveSelected(-1); };
            var buttonDown = new Button { Text = Translator.TranslateStr(29), Location = new Point(260, 184), Size = new Size(72, 28) };
            buttonDown.Click += delegate { MoveSelected(1); };

            var labelUnions = new Label { Text = Translator.TranslateStr(1083), Location = new Point(340, 12), AutoSize = true };
            listUnions.SetBounds(340, 32, 408, 220);
            listUnions.Anchor = AnchorStyles.Top | AnchorStyles.Left | AnchorStyles.Right;
            listUnions.SelectedIndexChanged += delegate { ShowFieldsOfSelected(); };

            checkParallel.Text = Translator.TranslateStr(1440);
            checkParallel.AutoSize = true;
            checkParallel.Location = new Point(12, 264);
            tips.SetToolTip(checkParallel, Translator.TranslateStr(1441));
            checkParallel.CheckedChanged += delegate
            {
                if (updating)
                    return;
                settings.Parallel = checkParallel.Checked;
                ShowFieldsOfSelected();
                UpdateColumns();
            };
            checkGroup.Text = Translator.TranslateStr(1084);
            checkGroup.AutoSize = true;
            checkGroup.Location = new Point(12, 292);
            checkGroup.CheckedChanged += delegate
            {
                if (!updating)
                    settings.Group = checkGroup.Checked;
            };
            var labelIndex = new Label { Text = Translator.TranslateStr(164), Location = new Point(12, 324), AutoSize = true };
            textIndex.SetBounds(12, 344, 240, 24);
            textIndex.TextChanged += delegate
            {
                if (!updating)
                    settings.IndexFields = textIndex.Text;
            };

            labelFields.Text = Translator.TranslateStr(1444);
            labelFields.Location = new Point(340, 264);
            labelFields.Size = new Size(408, 36);
            labelFields.Anchor = AnchorStyles.Top | AnchorStyles.Left | AnchorStyles.Right;
            listFields.SetBounds(340, 302, 408, 110);
            listFields.Anchor = AnchorStyles.Top | AnchorStyles.Left | AnchorStyles.Right | AnchorStyles.Bottom;
            listFields.CheckOnClick = true;
            listFields.ItemCheck += ListFieldsItemCheck;
            textFields.SetBounds(340, 418, 408, 24);
            textFields.Anchor = AnchorStyles.Left | AnchorStyles.Right | AnchorStyles.Bottom;
            textFields.TextChanged += delegate { SetFieldsOfSelected(textFields.Text, false); };

            labelColumns.Location = new Point(12, 450);
            labelColumns.Size = new Size(736, 34);
            labelColumns.Anchor = AnchorStyles.Left | AnchorStyles.Right | AnchorStyles.Bottom;
            labelColumns.ForeColor = SystemColors.GrayText;

            var buttonOK = new Button { Text = Translator.TranslateStr(93), Size = new Size(96, 28) };
            buttonOK.Location = new Point(ClientSize.Width - 212, ClientSize.Height - 36);
            buttonOK.Anchor = AnchorStyles.Right | AnchorStyles.Bottom;
            buttonOK.Click += delegate
            {
                string problem = settings.Validate();
                if (problem != null)
                {
                    MessageBox.Show(this, problem, Text, MessageBoxButtons.OK, MessageBoxIcon.Warning);
                    return;
                }
                DialogResult = DialogResult.OK;
            };
            var buttonCancel = new Button { Text = Translator.TranslateStr(94), Size = new Size(96, 28), DialogResult = DialogResult.Cancel };
            buttonCancel.Location = new Point(ClientSize.Width - 108, ClientSize.Height - 36);
            buttonCancel.Anchor = AnchorStyles.Right | AnchorStyles.Bottom;
            AcceptButton = buttonOK;
            CancelButton = buttonCancel;

            Controls.AddRange(new Control[] { labelAvailable, listAvailable, buttonAdd, buttonRemove, buttonUp, buttonDown,
                labelUnions, listUnions, checkParallel, checkGroup, labelIndex, textIndex, labelFields, listFields,
                textFields, labelColumns, buttonOK, buttonCancel });
        }

        private void FillUnions(int selected)
        {
            updating = true;
            listUnions.Items.Clear();
            foreach (string entry in settings.Entries)
                listUnions.Items.Add(entry);
            updating = false;
            if (listUnions.Items.Count > 0)
                listUnions.SelectedIndex = Math.Max(0, Math.Min(selected, listUnions.Items.Count - 1));
            else
                ShowFieldsOfSelected();
            UpdateColumns();
        }

        /// <summary>Adds a dataset at the end of the union (the self-tests call it too).</summary>
        internal void AddDataset(string dataset)
        {
            settings.Entries.Add(dataset);
            FillUnions(settings.Entries.Count - 1);
        }

        private void AddSelected()
        {
            if (listAvailable.SelectedItem != null)
                AddDataset(listAvailable.SelectedItem.ToString());
        }

        private void RemoveSelected()
        {
            int index = listUnions.SelectedIndex;
            if (index < 0)
                return;
            settings.Entries.RemoveAt(index);
            FillUnions(index);
        }

        private void MoveSelected(int delta)
        {
            int index = listUnions.SelectedIndex;
            int target = index + delta;
            if (index < 0 || target < 0 || target >= settings.Entries.Count)
                return;
            string entry = settings.Entries[index];
            settings.Entries.RemoveAt(index);
            settings.Entries.Insert(target, entry);
            FillUnions(target);
        }

        /// <summary>The fields of a dataset of the report, opening it if it is not (null when it can not be opened).</summary>
        private List<string> FieldsOfDataset(string dataset)
        {
            List<string> fields;
            if (fieldCache.TryGetValue(dataset, out fields))
                return fields;
            fields = null;
            try
            {
                int index = report.DataInfo.IndexOf(dataset);
                if (index >= 0)
                {
                    DataInfo info = report.DataInfo[index];
                    if (info.Data.Columns.Count == 0)
                    {
                        info.GetDbItem().Connect();
                        info.Connect();
                    }
                    fields = new List<string>();
                    foreach (DataColumn column in info.Data.Columns)
                        fields.Add(column.ColumnName);
                }
            }
            catch
            {
                fields = null;
            }
            fieldCache[dataset] = fields;
            return fields;
        }

        private void ShowFieldsOfSelected()
        {
            int index = listUnions.SelectedIndex;
            bool enabled = settings.Parallel && index >= 0;
            listFields.Enabled = enabled;
            textFields.Enabled = enabled;
            labelFields.Enabled = enabled;
            updating = true;
            listFields.Items.Clear();
            textFields.Text = "";
            if (index >= 0)
            {
                string entry = settings.Entries[index];
                var selected = new List<string>();
                foreach (string field in UnionSettings.FieldsOf(entry).Split(';'))
                {
                    if (field.Trim().Length > 0)
                        selected.Add(field.Trim().ToUpperInvariant());
                }
                List<string> fields = enabled ? FieldsOfDataset(UnionSettings.AliasOf(entry)) : null;
                if (fields != null)
                {
                    foreach (string field in fields)
                        listFields.Items.Add(field, selected.Contains(field.ToUpperInvariant()));
                }
                textFields.Text = UnionSettings.FieldsOf(entry);
            }
            updating = false;
        }

        private void ListFieldsItemCheck(object sender, ItemCheckEventArgs e)
        {
            if (updating)
                return;
            var fields = new List<string>();
            for (int i = 0; i < listFields.Items.Count; i++)
            {
                bool isChecked = i == e.Index ? e.NewValue == CheckState.Checked : listFields.GetItemChecked(i);
                if (isChecked)
                    fields.Add(listFields.Items[i].ToString());
            }
            SetFieldsOfSelected(string.Join(";", fields.ToArray()), true);
        }

        /// <summary>The common fields of the selected entry (the self-tests call it too).</summary>
        internal void SetFieldsOfSelected(string fields, bool updateText)
        {
            if (updating)
                return;
            int index = listUnions.SelectedIndex;
            if (index < 0)
                return;
            string entry = UnionSettings.EntryOf(UnionSettings.AliasOf(settings.Entries[index]), fields);
            settings.Entries[index] = entry;
            updating = true;
            listUnions.Items[index] = entry;
            if (updateText)
                textFields.Text = UnionSettings.FieldsOf(entry);
            updating = false;
            UpdateColumns();
        }

        /// <summary>Selects an entry of the union (the self-tests).</summary>
        internal void SelectEntry(int index)
        {
            listUnions.SelectedIndex = index;
        }

        private void UpdateColumns()
        {
            List<string> columns = settings.ResultColumns(FieldsOfDataset);
            labelColumns.Text = columns == null || columns.Count == 0 ? ""
                : Translator.TranslateStr(1849) + ": " + string.Join(", ", columns.ToArray());
        }

        /// <summary>The text of the columns the union gives (the self-tests).</summary>
        internal string ColumnsText { get { return labelColumns.Text; } }

        /// <summary>Shows the dialog for a dataset; the settings when the user accepts them, else null.</summary>
        public static UnionSettings Edit(IWin32Window owner, DataInfo info)
        {
            using (var form = new UnionsEditorForm(info))
            {
                return form.ShowDialog(owner) == DialogResult.OK ? form.Settings : null;
            }
        }
    }
}
