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
using System.Data.Common;
using System.Drawing;
using System.Threading.Tasks;
using System.Windows.Forms;
using Reportman.Reporting;

namespace Reportman.Designer
{
    /// <summary>
    /// The utility for the local schema file of a direct connection (dbxschemas/ALIAS.json): reads the
    /// tables again from the database (keeping what was written for those that remain) and defines
    /// subschemas, a name and a selection of tables, that the copilot can send instead of all of them.
    /// Changes are saved when the dialog is accepted.
    /// </summary>
    public class LocalSchemaEditorForm : Form
    {
        private readonly string _folder;
        private readonly string _alias;
        private readonly Func<DbConnection> _createConnection;
        private LocalSchemaFile _file;
        private bool _filling;
        private bool _startAdding;
        private LocalSubschema _added;

        private Label _lblInfo;
        private Label _lblPath;
        private Button _btnRefresh;
        private ListBox _listSchemas;
        private Button _btnAdd;
        private Button _btnRename;
        private Button _btnDelete;
        private CheckedListBox _checkTables;
        private Button _btnCheckAll;
        private Button _btnCheckNone;
        private Label _lblTables;
        private Button _btnOk;
        private Button _btnCancel;

        /// <summary>
        /// Shows the utility for the connection <paramref name="alias"/>. Returns true when the file
        /// was saved.
        /// </summary>
        /// <param name="owner">The owner window.</param>
        /// <param name="folder">The dbxschemas folder.</param>
        /// <param name="alias">The connection alias.</param>
        /// <param name="createConnection">Creates a connection to read the catalog from.</param>
        public static bool Edit(IWin32Window owner, string folder, string alias, Func<DbConnection> createConnection)
        {
            string added;
            return Edit(owner, folder, alias, createConnection, false, out added);
        }

        /// <summary>
        /// Shows the utility for the connection <paramref name="alias"/>; with
        /// <paramref name="addSubschema"/> it starts asking the name of a new subschema, as "Add..."
        /// does, once the file is read. Returns true when the file was saved.
        /// </summary>
        /// <param name="owner">The owner window.</param>
        /// <param name="folder">The dbxschemas folder.</param>
        /// <param name="alias">The connection alias.</param>
        /// <param name="createConnection">Creates a connection to read the catalog from.</param>
        /// <param name="addSubschema">True to start adding a subschema.</param>
        /// <param name="addedSubschema">When saved, the name of the last subschema added in the dialog
        /// (empty when none was, or it was deleted again).</param>
        public static bool Edit(IWin32Window owner, string folder, string alias, Func<DbConnection> createConnection,
            bool addSubschema, out string addedSubschema)
        {
            using (var form = new LocalSchemaEditorForm(folder, alias, createConnection))
            {
                form._startAdding = addSubschema;
                bool saved = form.ShowDialog(owner) == DialogResult.OK;
                addedSubschema = saved ? form.AddedSubschemaName : "";
                return saved;
            }
        }

        /// <summary>The name of the last subschema added in the dialog, or "" when none is there.</summary>
        private string AddedSubschemaName
        {
            get { return _added != null && _file != null && _file.Schemas.Contains(_added) ? _added.Name : ""; }
        }

        /// <summary>
        /// Initializes the dialog for one connection.
        /// </summary>
        /// <param name="folder">The dbxschemas folder.</param>
        /// <param name="alias">The connection alias.</param>
        /// <param name="createConnection">Creates a connection to read the catalog from.</param>
        public LocalSchemaEditorForm(string folder, string alias, Func<DbConnection> createConnection)
        {
            _folder = folder;
            _alias = (alias ?? "").Trim().ToUpperInvariant();
            _createConnection = createConnection;
            InitializeComponent();
            Shown += async (s, e) =>
            {
                await LoadFileAsync();
                // Opened to add a subschema: the name is asked as soon as the tables are known
                if (_startAdding)
                {
                    _startAdding = false;
                    if (_file != null)
                        AddSubschema();
                }
            };
        }

        private string FilePath { get { return LocalSchemaStore.PathFor(_folder, _alias); } }

        private void InitializeComponent()
        {
            Text = "Local schema - " + _alias;
            StartPosition = FormStartPosition.CenterParent;
            AutoScaleMode = AutoScaleMode.Font;
            Font = new Font("Segoe UI", 9f);
            ClientSize = new Size(720, 500);
            MinimumSize = new Size(520, 380);
            MinimizeBox = false;
            ShowInTaskbar = false;

            var top = new Panel { Dock = DockStyle.Top, Height = 58, Padding = new Padding(8) };
            _btnRefresh = new Button { Text = "Refresh from database", Dock = DockStyle.Right, Width = 170 };
            _btnRefresh.Click += async (s, e) => await RefreshAsync();
            _lblInfo = new Label { Dock = DockStyle.Fill, AutoEllipsis = true, Text = "Reading..." };
            _lblPath = new Label { Dock = DockStyle.Bottom, Height = 20, AutoEllipsis = true, Text = "" };
            top.Controls.Add(_lblInfo);
            top.Controls.Add(_lblPath);
            top.Controls.Add(_btnRefresh);

            // The size first: the distances are checked against it as they are assigned.
            var split = new SplitContainer { Size = new Size(720, 400) };
            split.Panel1MinSize = 160;
            split.Panel2MinSize = 200;
            split.SplitterDistance = 240;
            split.Dock = DockStyle.Fill;

            var groupSchemas = new GroupBox { Text = "Subschemas", Dock = DockStyle.Fill, Padding = new Padding(6) };
            _listSchemas = new ListBox { Dock = DockStyle.Fill, IntegralHeight = false };
            _listSchemas.SelectedIndexChanged += (s, e) => FillTables();
            var schemaButtons = new FlowLayoutPanel { Dock = DockStyle.Bottom, Height = 36, FlowDirection = FlowDirection.LeftToRight, WrapContents = false };
            _btnAdd = new Button { Text = "Add...", AutoSize = true };
            _btnAdd.Click += (s, e) => AddSubschema();
            _btnRename = new Button { Text = "Rename...", AutoSize = true };
            _btnRename.Click += (s, e) => RenameSubschema();
            _btnDelete = new Button { Text = "Delete", AutoSize = true };
            _btnDelete.Click += (s, e) => DeleteSubschema();
            schemaButtons.Controls.Add(_btnAdd);
            schemaButtons.Controls.Add(_btnRename);
            schemaButtons.Controls.Add(_btnDelete);
            groupSchemas.Controls.Add(_listSchemas);
            groupSchemas.Controls.Add(schemaButtons);
            split.Panel1.Controls.Add(groupSchemas);

            var groupTables = new GroupBox { Text = "Tables of the subschema", Dock = DockStyle.Fill, Padding = new Padding(6) };
            _checkTables = new CheckedListBox { Dock = DockStyle.Fill, CheckOnClick = true, IntegralHeight = false };
            _checkTables.ItemCheck += CheckTables_ItemCheck;
            _lblTables = new Label { Dock = DockStyle.Top, Height = 22, Text = "" };
            var tableButtons = new FlowLayoutPanel { Dock = DockStyle.Bottom, Height = 36, FlowDirection = FlowDirection.LeftToRight, WrapContents = false };
            _btnCheckAll = new Button { Text = "Check all", AutoSize = true };
            _btnCheckAll.Click += (s, e) => CheckAll(true);
            _btnCheckNone = new Button { Text = "Check none", AutoSize = true };
            _btnCheckNone.Click += (s, e) => CheckAll(false);
            tableButtons.Controls.Add(_btnCheckAll);
            tableButtons.Controls.Add(_btnCheckNone);
            groupTables.Controls.Add(_checkTables);
            groupTables.Controls.Add(_lblTables);
            groupTables.Controls.Add(tableButtons);
            split.Panel2.Controls.Add(groupTables);

            var bottom = new FlowLayoutPanel { Dock = DockStyle.Bottom, Height = 44, FlowDirection = FlowDirection.RightToLeft, Padding = new Padding(8) };
            _btnCancel = new Button { Text = "Cancel", DialogResult = DialogResult.Cancel, AutoSize = true };
            _btnOk = new Button { Text = "OK", AutoSize = true };
            _btnOk.Click += BtnOk_Click;
            bottom.Controls.Add(_btnCancel);
            bottom.Controls.Add(_btnOk);
            AcceptButton = _btnOk;
            CancelButton = _btnCancel;

            Controls.Add(split);
            Controls.Add(top);
            Controls.Add(bottom);
            UpdateState();
        }

        private void SetBusy(bool busy)
        {
            UseWaitCursor = busy;
            _btnRefresh.Enabled = !busy;
            _btnOk.Enabled = !busy && _file != null;
            _listSchemas.Enabled = !busy;
            _checkTables.Enabled = !busy;
            if (!busy)
                UpdateState();
        }

        private async Task LoadFileAsync()
        {
            SetBusy(true);
            try
            {
                LocalSchemaFile file = LocalSchemaStore.Load(FilePath);
                if (file == null)
                {
                    // Never generated: the catalog is read now (and saved, as the copilot would do).
                    _lblInfo.Text = "Reading the tables of " + _alias + "...";
                    file = await Task.Run(() => LocalSchemaStore.LoadOrGenerate(_folder, _alias, _createConnection, false));
                }
                _file = file;
            }
            catch (Exception ex)
            {
                _lblInfo.Text = "The schema of " + _alias + " could not be read: " + ex.Message;
            }
            finally
            {
                SetBusy(false);
            }
            FillAll(null);
        }

        private async Task RefreshAsync()
        {
            SetBusy(true);
            string selected = SelectedSubschema != null ? SelectedSubschema.Name : null;
            try
            {
                _lblInfo.Text = "Reading the tables of " + _alias + "...";
                LocalSchemaFile fresh = await Task.Run(() =>
                {
                    using (DbConnection connection = _createConnection())
                        return LocalSchemaStore.Generate(connection, _alias);
                });
                // What was written here (contexts, subschemas, unsaved changes included) is kept.
                _file = LocalSchemaStore.Merge(_file, fresh);
                // The merge copies the subschemas: the one added here is followed by its name
                if (_added != null)
                    _added = LocalSchemaStore.FindSubschema(_file, _added.Name);
            }
            catch (Exception ex)
            {
                MessageBox.Show(this, ex.Message, "Refresh from database", MessageBoxButtons.OK, MessageBoxIcon.Error);
            }
            finally
            {
                SetBusy(false);
            }
            FillAll(selected);
        }

        private LocalSubschema SelectedSubschema
        {
            get { return _listSchemas.SelectedItem as LocalSubschema; }
        }

        private void FillAll(string selectName)
        {
            _filling = true;
            try
            {
                _listSchemas.Items.Clear();
                _listSchemas.DisplayMember = "Name";
                if (_file != null)
                {
                    foreach (LocalSubschema s in _file.Schemas)
                        _listSchemas.Items.Add(s);
                    _lblInfo.Text = _file.Tables.Count + " tables, dialect " + _file.Dialect +
                        (string.IsNullOrEmpty(_file.GeneratedUtc) ? "" : ", read " + _file.GeneratedUtc) +
                        ". Without a subschema the copilot sends all of them.";
                    _lblPath.Text = "File: " + FilePath;
                }
                int index = -1;
                for (int i = 0; i < _listSchemas.Items.Count; i++)
                {
                    if (selectName != null && string.Equals(((LocalSubschema)_listSchemas.Items[i]).Name, selectName, StringComparison.OrdinalIgnoreCase))
                        index = i;
                }
                if (index < 0 && _listSchemas.Items.Count > 0)
                    index = 0;
                _listSchemas.SelectedIndex = index;
            }
            finally
            {
                _filling = false;
            }
            FillTables();
        }

        private void FillTables()
        {
            if (_filling)
                return;
            _filling = true;
            try
            {
                _checkTables.Items.Clear();
                LocalSubschema schema = SelectedSubschema;
                if (_file != null && schema != null)
                {
                    foreach (LocalSchemaTable table in _file.Tables)
                    {
                        bool isIn = schema.Tables.Exists(n => string.Equals(n, table.Name, StringComparison.OrdinalIgnoreCase));
                        _checkTables.Items.Add(table.Name, isIn);
                    }
                }
            }
            finally
            {
                _filling = false;
            }
            UpdateState();
        }

        private void CheckTables_ItemCheck(object sender, ItemCheckEventArgs e)
        {
            if (_filling)
                return;
            LocalSubschema schema = SelectedSubschema;
            if (schema == null)
                return;
            string name = (string)_checkTables.Items[e.Index];
            schema.Tables.RemoveAll(n => string.Equals(n, name, StringComparison.OrdinalIgnoreCase));
            if (e.NewValue == CheckState.Checked)
            {
                // Kept in the order of the catalog.
                var ordered = new List<string>();
                foreach (LocalSchemaTable table in _file.Tables)
                {
                    if (string.Equals(table.Name, name, StringComparison.OrdinalIgnoreCase) ||
                        schema.Tables.Exists(n => string.Equals(n, table.Name, StringComparison.OrdinalIgnoreCase)))
                        ordered.Add(table.Name);
                }
                schema.Tables = ordered;
            }
            BeginInvoke(new Action(UpdateState));
        }

        private void CheckAll(bool value)
        {
            LocalSubschema schema = SelectedSubschema;
            if (schema == null || _file == null)
                return;
            schema.Tables = new List<string>();
            if (value)
            {
                foreach (LocalSchemaTable table in _file.Tables)
                    schema.Tables.Add(table.Name);
            }
            FillTables();
        }

        private void UpdateState()
        {
            bool hasFile = _file != null;
            LocalSubschema schema = SelectedSubschema;
            _btnAdd.Enabled = hasFile;
            _btnRename.Enabled = schema != null;
            _btnDelete.Enabled = schema != null;
            _btnCheckAll.Enabled = schema != null;
            _btnCheckNone.Enabled = schema != null;
            _btnOk.Enabled = hasFile && !UseWaitCursor;
            _lblTables.Text = schema == null
                ? (hasFile ? "Add a subschema to choose its tables." : "")
                : schema.Tables.Count + " of " + _file.Tables.Count + " tables in " + schema.Name;
        }

        private string AskName(string title, string initial, LocalSubschema except)
        {
            while (true)
            {
                string name = PromptText(this, title, "Subschema name:", initial);
                if (name == null)
                    return null;
                name = name.Trim();
                string problem = "";
                if (name.Length == 0)
                    problem = "The name cannot be empty.";
                else if (string.Equals(name, "All tables", StringComparison.OrdinalIgnoreCase))
                    problem = "\"All tables\" is the schema with every table; choose another name.";
                else if (_file.Schemas.Exists(s => s != except && string.Equals(s.Name, name, StringComparison.OrdinalIgnoreCase)))
                    problem = "There is already a subschema named " + name + ".";
                if (problem.Length == 0)
                    return name;
                MessageBox.Show(this, problem, title, MessageBoxButtons.OK, MessageBoxIcon.Warning);
                initial = name;
            }
        }

        private void AddSubschema()
        {
            if (_file == null)
                return;
            string name = AskName("Add subschema", "", null);
            if (name == null)
                return;
            _added = new LocalSubschema { Name = name };
            _file.Schemas.Add(_added);
            FillAll(name);
        }

        private void RenameSubschema()
        {
            LocalSubschema schema = SelectedSubschema;
            if (schema == null)
                return;
            string name = AskName("Rename subschema", schema.Name, schema);
            if (name == null)
                return;
            schema.Name = name;
            FillAll(name);
        }

        private void DeleteSubschema()
        {
            LocalSubschema schema = SelectedSubschema;
            if (schema == null)
                return;
            if (MessageBox.Show(this, "Delete the subschema " + schema.Name + "?", "Delete subschema",
                MessageBoxButtons.YesNo, MessageBoxIcon.Question) != DialogResult.Yes)
                return;
            _file.Schemas.Remove(schema);
            FillAll(null);
        }

        private void BtnOk_Click(object sender, EventArgs e)
        {
            if (_file == null)
                return;
            try
            {
                LocalSchemaStore.Save(_file, FilePath);
                DialogResult = DialogResult.OK;
                Close();
            }
            catch (Exception ex)
            {
                MessageBox.Show(this, ex.Message, "Save", MessageBoxButtons.OK, MessageBoxIcon.Error);
            }
        }

        /// <summary>A one line text prompt; null when cancelled.</summary>
        private static string PromptText(IWin32Window owner, string title, string label, string initial)
        {
            using (var form = new Form())
            {
                form.Text = title;
                form.FormBorderStyle = FormBorderStyle.FixedDialog;
                form.StartPosition = FormStartPosition.CenterParent;
                form.MinimizeBox = false;
                form.MaximizeBox = false;
                form.ShowInTaskbar = false;
                form.AutoScaleMode = AutoScaleMode.Font;
                form.Font = new Font("Segoe UI", 9f);
                form.ClientSize = new Size(380, 110);
                var lbl = new Label { Text = label, Left = 12, Top = 12, AutoSize = true };
                var box = new TextBox { Left = 12, Top = 34, Width = 356, Text = initial ?? "" };
                var ok = new Button { Text = "OK", DialogResult = DialogResult.OK, Left = 212, Top = 70, Width = 75 };
                var cancel = new Button { Text = "Cancel", DialogResult = DialogResult.Cancel, Left = 293, Top = 70, Width = 75 };
                form.Controls.Add(lbl);
                form.Controls.Add(box);
                form.Controls.Add(ok);
                form.Controls.Add(cancel);
                form.AcceptButton = ok;
                form.CancelButton = cancel;
                return form.ShowDialog(owner) == DialogResult.OK ? box.Text : null;
            }
        }
    }
}
