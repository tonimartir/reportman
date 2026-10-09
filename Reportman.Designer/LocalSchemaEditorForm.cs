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
using System.Globalization;
using System.Text;
using System.Threading.Tasks;
using System.Windows.Forms;
using Reportman.Drawing;
using Reportman.Reporting;

namespace Reportman.Designer
{
    /// <summary>
    /// The AI that «Analyze with AI» of <see cref="LocalSchemaEditorForm"/> uses: the provider and mode the
    /// copilot has selected.
    /// </summary>
    public class LocalSchemaAnalysisSettings
    {
        /// <summary>Gets or sets the AI tier: Standard, Precision or LocalAgent.</summary>
        public string Tier { get; set; } = "Standard";

        /// <summary>Gets or sets the AI mode: Fast or Reasoning.</summary>
        public string Mode { get; set; } = "Fast";

        /// <summary>Gets or sets the secret of the Agent that runs the AI (LocalAgent only).</summary>
        public string AgentSecret { get; set; } = "";

        /// <summary>Gets or sets the AI of that Agent (LocalAgent only).</summary>
        public long AgentAiId { get; set; }

        /// <summary>True when the AI runs on the user's Agent: the plan limits do not apply.</summary>
        public bool IsLocalAgent
        {
            get { return string.Equals(Tier, "LocalAgent", StringComparison.OrdinalIgnoreCase); }
        }
    }

    /// <summary>
    /// The local schemas of a direct connection (dbxschemas/ALIAS.json), as the cloud's schema screen
    /// (docs/esquemas-locales-pantalla-plan.md, §5.5.1): on the left «all the tables» (the dictionary, where
    /// tables, columns and relations are described once for every subschema) and the subschemas, which choose
    /// tables and columns; on the right the tabs Connection, Tables, Columns, Relations and Validation, with
    /// the counters of the plan, which warn and never block. Changes are saved with Save, and closing with
    /// changes asks.
    /// </summary>
    public partial class LocalSchemaEditorForm : Form
    {
        private const int PreviewRows = 5;
        private static readonly Color UsageGreen = Color.FromArgb(0x2E, 0x7D, 0x32);
        private static readonly Color UsageOrange = Color.FromArgb(0xE6, 0x51, 0x00);
        private static readonly Color UsageRed = Color.FromArgb(0xC6, 0x28, 0x28);

        private readonly string _folder;
        private readonly string _alias;
        private readonly Func<DbConnection> _createConnection;
        private readonly LocalSchemaAnalysisSettings _ai;
        private LocalSchemaFile _file;
        // The subschema shown, null for all the tables
        private LocalSubschema _current;
        private bool _filling;
        private bool _busy;
        private bool _dirty;
        private string _savedJson = "";
        private bool _savedOnce;
        private string _savedAddedName = "";
        private bool _startAdding;
        private LocalSubschema _added;
        private string _baseTitle = "";

        private SplitContainer _split;
        private ListBox _listSchemas;
        private Button _btnAdd;
        private Button _btnDuplicate;
        private Button _btnRename;
        private Button _btnDelete;
        private TextBox _txtSchemaDescription;
        private Label _lblTablesCounter;
        private Label _lblColumnsCounter;
        private Label _lblPlanWarning;
        private TabControl _tabs;
        private TabPage _tabConnection;
        private TabPage _tabTables;
        private TabPage _tabColumns;
        private TabPage _tabRelations;
        private TabPage _tabValidation;
        private Button _btnSave;
        private Button _btnClose;
        private Label _lblStatus;
        private ToolTip _toolTip;

        // Connection tab
        private TextBox _txtConnAlias;
        private TextBox _txtConnDialect;
        private TextBox _txtConnRead;
        private TextBox _txtConnTables;
        private TextBox _txtConnFile;
        private Button _btnRefresh;
        private Label _lblConnStatus;

        /// <summary>
        /// Shows the local schemas of the connection <paramref name="alias"/>. Returns true when the file
        /// was saved.
        /// </summary>
        /// <param name="owner">The owner window.</param>
        /// <param name="folder">The dbxschemas folder.</param>
        /// <param name="alias">The connection alias.</param>
        /// <param name="createConnection">Creates a connection to read the catalog from.</param>
        public static bool Edit(IWin32Window owner, string folder, string alias, Func<DbConnection> createConnection)
        {
            string added;
            return Edit(owner, folder, alias, createConnection, false, null, out added);
        }

        /// <summary>
        /// Shows the local schemas of the connection <paramref name="alias"/>; with
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
            return Edit(owner, folder, alias, createConnection, addSubschema, null, out addedSubschema);
        }

        /// <summary>
        /// Shows the local schemas of the connection <paramref name="alias"/>, as
        /// <see cref="Edit(IWin32Window, string, string, Func{DbConnection}, bool, out string)"/>, with the AI
        /// «Analyze with AI» uses (the copilot's selection). Returns true when the file was saved.
        /// </summary>
        /// <param name="owner">The owner window.</param>
        /// <param name="folder">The dbxschemas folder.</param>
        /// <param name="alias">The connection alias.</param>
        /// <param name="createConnection">Creates a connection to read the catalog and the preview from.</param>
        /// <param name="addSubschema">True to start adding a subschema.</param>
        /// <param name="analysis">The AI of the analysis; null for Standard and Fast.</param>
        /// <param name="addedSubschema">When saved, the name of the last subschema added in the dialog
        /// (empty when none was, or it was deleted again).</param>
        public static bool Edit(IWin32Window owner, string folder, string alias, Func<DbConnection> createConnection,
            bool addSubschema, LocalSchemaAnalysisSettings analysis, out string addedSubschema)
        {
            using (var form = new LocalSchemaEditorForm(folder, alias, createConnection, analysis))
            {
                form._startAdding = addSubschema;
                form.ShowDialog(owner);
                addedSubschema = form._savedOnce ? form._savedAddedName : "";
                return form._savedOnce;
            }
        }

        /// <summary>
        /// Initializes the dialog for one connection.
        /// </summary>
        /// <param name="folder">The dbxschemas folder.</param>
        /// <param name="alias">The connection alias.</param>
        /// <param name="createConnection">Creates a connection to read the catalog from.</param>
        public LocalSchemaEditorForm(string folder, string alias, Func<DbConnection> createConnection)
            : this(folder, alias, createConnection, null)
        {
        }

        /// <summary>
        /// Initializes the dialog for one connection, with the AI of «Analyze with AI».
        /// </summary>
        /// <param name="folder">The dbxschemas folder.</param>
        /// <param name="alias">The connection alias.</param>
        /// <param name="createConnection">Creates a connection to read the catalog and the preview from.</param>
        /// <param name="analysis">The AI of the analysis; null for Standard and Fast.</param>
        public LocalSchemaEditorForm(string folder, string alias, Func<DbConnection> createConnection,
            LocalSchemaAnalysisSettings analysis)
        {
            _folder = folder;
            _alias = (alias ?? "").Trim().ToUpperInvariant();
            _createConnection = createConnection;
            _ai = analysis ?? new LocalSchemaAnalysisSettings();
            InitializeComponent();
            Shown += async (s, e) =>
            {
                await LoadFileAsync();
                // Opened to add a subschema: the name is asked as soon as the tables are known
                if (_startAdding && !IsDisposed)
                {
                    _startAdding = false;
                    if (_file != null)
                        AddSubschema();
                }
            };
        }

        /// <summary>Cleans up the resources of the dialog.</summary>
        /// <param name="disposing">True to release managed resources.</param>
        protected override void Dispose(bool disposing)
        {
            if (disposing)
            {
                _toolTip?.Dispose();
                CancelBackgroundWork();
            }
            base.Dispose(disposing);
        }

        private string FilePath { get { return LocalSchemaStore.PathFor(_folder, _alias); } }

        private static string Tr(int index)
        {
            return Translator.TranslateStr(index);
        }

        // A translated caption without the "..." of a menu entry
        private static string Caption(int index)
        {
            return Tr(index).TrimEnd('.', '…', ' ');
        }

        /// <summary>
        /// A translated text with its %s and %d filled in order with <paramref name="args"/>, as the Delphi
        /// designer's Format does with the same resource strings (%% is a percent sign).
        /// </summary>
        private static string TrFormat(int index, params string[] args)
        {
            string text = Tr(index);
            var result = new StringBuilder(text.Length + 32);
            int next = 0;
            for (int i = 0; i < text.Length; i++)
            {
                char c = text[i];
                if (c == '%' && i + 1 < text.Length)
                {
                    char kind = text[i + 1];
                    if (kind == '%')
                    {
                        result.Append('%');
                        i++;
                        continue;
                    }
                    if (kind == 's' || kind == 'd')
                    {
                        if (args != null && next < args.Length)
                            result.Append(args[next]);
                        next++;
                        i++;
                        continue;
                    }
                }
                result.Append(c);
            }
            return result.ToString();
        }

        private static string Number(int value)
        {
            return value.ToString("N0", CultureInfo.CurrentCulture);
        }

        /// <summary>True when the plan limits do not apply: the AI runs on the user's Agent.</summary>
        private bool IgnorePlanLimits { get { return _ai.IsLocalAgent; } }

        private int MaxTables
        {
            get { return IgnorePlanLimits ? 0 : RpAuthManager.Instance.Profile.MaxTables; }
        }

        private int MaxColumnsPerTable
        {
            get { return IgnorePlanLimits ? 0 : RpAuthManager.Instance.Profile.MaxColumnsPerTable; }
        }

        // ===== Layout =====

        private void InitializeComponent()
        {
            SuspendLayout();
            _baseTitle = TrFormat(1845, _alias);
            Text = _baseTitle;
            StartPosition = FormStartPosition.CenterParent;
            // The sizes below are for Segoe UI 9 at 96 DPI: they scale with the screen
            Font = new Font("Segoe UI", 9f);
            AutoScaleDimensions = new SizeF(7F, 15F);
            AutoScaleMode = AutoScaleMode.Font;
            ClientSize = new Size(1060, 700);
            MinimumSize = new Size(820, 560);
            MinimizeBox = false;
            ShowInTaskbar = false;
            _toolTip = new ToolTip();

            // The size first: the distances are checked against it as they are assigned.
            _split = new SplitContainer { Size = new Size(1060, 650) };
            _split.Panel1MinSize = 180;
            _split.Panel2MinSize = 500;
            _split.SplitterDistance = 240;
            _split.FixedPanel = FixedPanel.Panel1;
            _split.Dock = DockStyle.Fill;
            _split.Panel1.Controls.Add(BuildSchemasPanel());
            _split.Panel2.Controls.Add(BuildRightPanel());

            var bottom = new Panel { Dock = DockStyle.Bottom, Height = 42, Padding = new Padding(8, 6, 8, 6) };
            var buttons = new FlowLayoutPanel
            {
                Dock = DockStyle.Right,
                FlowDirection = FlowDirection.RightToLeft,
                WrapContents = false,
                AutoSize = true,
                AutoSizeMode = AutoSizeMode.GrowAndShrink
            };
            _btnClose = new Button { Text = Tr(1891), AutoSize = true, MinimumSize = new Size(80, 0) };
            _btnClose.Click += (s, e) => Close();
            _btnSave = new Button { Text = Tr(46), AutoSize = true, MinimumSize = new Size(80, 0) };
            _btnSave.Click += (s, e) => SaveFile();
            buttons.Controls.Add(_btnClose);
            buttons.Controls.Add(_btnSave);
            _lblStatus = new Label { Dock = DockStyle.Fill, AutoEllipsis = true, TextAlign = ContentAlignment.MiddleLeft };
            bottom.Controls.Add(_lblStatus);
            bottom.Controls.Add(buttons);
            CancelButton = _btnClose;

            Controls.Add(_split);
            Controls.Add(bottom);
            UpdateButtons();
            ResumeLayout(false);
            PerformLayout();
        }

        private Control BuildSchemasPanel()
        {
            var group = new GroupBox { Text = Tr(1846), Dock = DockStyle.Fill, Padding = new Padding(6) };
            _listSchemas = new ListBox
            {
                Dock = DockStyle.Fill,
                IntegralHeight = false,
                DrawMode = DrawMode.OwnerDrawFixed,
                ItemHeight = TextRenderer.MeasureText("Ag", Font).Height + 6
            };
            _listSchemas.DrawItem += ListSchemas_DrawItem;
            _listSchemas.SelectedIndexChanged += ListSchemas_SelectedIndexChanged;

            var buttons = new TableLayoutPanel { Dock = DockStyle.Bottom, ColumnCount = 2, RowCount = 2, Height = 64 };
            buttons.ColumnStyles.Add(new ColumnStyle(SizeType.Percent, 50f));
            buttons.ColumnStyles.Add(new ColumnStyle(SizeType.Percent, 50f));
            buttons.RowStyles.Add(new RowStyle(SizeType.Percent, 50f));
            buttons.RowStyles.Add(new RowStyle(SizeType.Percent, 50f));
            _btnAdd = new Button { Text = Tr(149) + "...", Dock = DockStyle.Fill };
            _btnAdd.Click += (s, e) => AddSubschema();
            _btnDuplicate = new Button { Text = Tr(1847), Dock = DockStyle.Fill };
            _btnDuplicate.Click += (s, e) => DuplicateSubschema();
            _btnRename = new Button { Text = Tr(151) + "...", Dock = DockStyle.Fill };
            _btnRename.Click += (s, e) => RenameSubschema();
            _btnDelete = new Button { Text = Tr(150), Dock = DockStyle.Fill };
            _btnDelete.Click += (s, e) => DeleteSubschema();
            buttons.Controls.Add(_btnAdd, 0, 0);
            buttons.Controls.Add(_btnDuplicate, 1, 0);
            buttons.Controls.Add(_btnRename, 0, 1);
            buttons.Controls.Add(_btnDelete, 1, 1);

            var description = new Panel { Dock = DockStyle.Bottom, Height = 110, Padding = new Padding(0, 6, 0, 0) };
            var lblDescription = new Label { Text = Tr(197), Dock = DockStyle.Top, Height = 20 };
            _txtSchemaDescription = new TextBox { Dock = DockStyle.Fill, Multiline = true, ScrollBars = ScrollBars.Vertical, AcceptsReturn = true };
            _txtSchemaDescription.TextChanged += (s, e) =>
            {
                if (_filling || _current == null)
                    return;
                _current.Description = _txtSchemaDescription.Text;
                MarkDirty();
            };
            description.Controls.Add(_txtSchemaDescription);
            description.Controls.Add(lblDescription);

            group.Controls.Add(_listSchemas);
            group.Controls.Add(buttons);
            group.Controls.Add(description);
            return group;
        }

        private Control BuildRightPanel()
        {
            var panel = new Panel { Dock = DockStyle.Fill, Padding = new Padding(4, 0, 0, 0) };

            var counters = new Panel { Dock = DockStyle.Top, Height = 48, Padding = new Padding(2, 2, 2, 4) };
            var line = new FlowLayoutPanel { Dock = DockStyle.Top, Height = 22, WrapContents = false };
            _lblTablesCounter = new Label { AutoSize = true, Margin = new Padding(0, 2, 24, 0), Font = new Font(Font, FontStyle.Bold) };
            _lblColumnsCounter = new Label { AutoSize = true, Margin = new Padding(0, 2, 0, 0), Font = new Font(Font, FontStyle.Bold) };
            line.Controls.Add(_lblTablesCounter);
            line.Controls.Add(_lblColumnsCounter);
            _lblPlanWarning = new Label { Dock = DockStyle.Fill, AutoEllipsis = true, ForeColor = UsageRed };
            counters.Controls.Add(_lblPlanWarning);
            counters.Controls.Add(line);

            _tabs = new TabControl { Dock = DockStyle.Fill };
            _tabConnection = BuildConnectionTab();
            _tabTables = BuildTablesTab();
            _tabColumns = BuildColumnsTab();
            _tabRelations = BuildRelationsTab();
            _tabValidation = BuildValidationTab();
            _tabs.TabPages.Add(_tabConnection);
            _tabs.TabPages.Add(_tabTables);
            _tabs.TabPages.Add(_tabColumns);
            _tabs.TabPages.Add(_tabRelations);
            _tabs.TabPages.Add(_tabValidation);
            _tabs.SelectedIndexChanged += (s, e) => CommitEdits();

            panel.Controls.Add(_tabs);
            panel.Controls.Add(counters);
            return panel;
        }

        /// <summary>
        /// A list with its title above, a filter below the title and a footer: <paramref name="list"/> fills
        /// the rest.
        /// </summary>
        private Panel NewListPanel(Control list, out Label title, out TextBox filter, out Label footer)
        {
            var panel = new Panel { Dock = DockStyle.Fill, Margin = new Padding(0) };
            title = new Label { Dock = DockStyle.Top, Height = 20, AutoEllipsis = true, Font = new Font(Font, FontStyle.Bold) };
            var filterRow = new TableLayoutPanel { Dock = DockStyle.Top, Height = 30, ColumnCount = 2, RowCount = 1 };
            filterRow.ColumnStyles.Add(new ColumnStyle(SizeType.AutoSize));
            filterRow.ColumnStyles.Add(new ColumnStyle(SizeType.Percent, 100f));
            filterRow.Controls.Add(new Label { Text = Tr(1859) + ":", AutoSize = true, Anchor = AnchorStyles.Left, Margin = new Padding(0, 0, 4, 0) }, 0, 0);
            filter = new TextBox { Dock = DockStyle.Fill, Margin = new Padding(0, 2, 0, 2) };
            filterRow.Controls.Add(filter, 1, 0);
            footer = new Label { Dock = DockStyle.Bottom, Height = 20, ForeColor = SystemColors.GrayText, AutoEllipsis = true };
            list.Dock = DockStyle.Fill;
            panel.Controls.Add(list);
            panel.Controls.Add(filterRow);
            panel.Controls.Add(title);
            panel.Controls.Add(footer);
            return panel;
        }

        private static bool MatchesFilter(string text, string filter)
        {
            string f = (filter ?? "").Trim();
            return f.Length == 0 || (text ?? "").IndexOf(f, StringComparison.OrdinalIgnoreCase) >= 0;
        }

        private static TextBox ReadOnlyBox()
        {
            return new TextBox { ReadOnly = true, Dock = DockStyle.Fill, BorderStyle = BorderStyle.FixedSingle, BackColor = SystemColors.Control };
        }

        // ===== Connection tab =====

        private TabPage BuildConnectionTab()
        {
            var page = new TabPage(Tr(154)) { Padding = new Padding(10) };
            var grid = new TableLayoutPanel { Dock = DockStyle.Top, ColumnCount = 2, AutoSize = true, AutoSizeMode = AutoSizeMode.GrowAndShrink };
            grid.ColumnStyles.Add(new ColumnStyle(SizeType.AutoSize));
            grid.ColumnStyles.Add(new ColumnStyle(SizeType.Percent, 100f));
            _txtConnAlias = ReadOnlyBox();
            _txtConnDialect = ReadOnlyBox();
            _txtConnRead = ReadOnlyBox();
            _txtConnTables = ReadOnlyBox();
            _txtConnFile = ReadOnlyBox();
            AddRow(grid, Tr(1852), _txtConnAlias);
            AddRow(grid, Tr(1853), _txtConnDialect);
            AddRow(grid, Tr(1854), _txtConnRead);
            AddRow(grid, Tr(1855), _txtConnTables);
            AddRow(grid, Tr(1856), _txtConnFile);

            var refreshRow = new FlowLayoutPanel { Dock = DockStyle.Top, AutoSize = true, Padding = new Padding(0, 12, 0, 0), WrapContents = false };
            _btnRefresh = new Button { Text = Tr(1851), AutoSize = true };
            _btnRefresh.Click += async (s, e) => await RefreshAsync();
            refreshRow.Controls.Add(_btnRefresh);
            var info = new Label
            {
                Dock = DockStyle.Top,
                Height = 44,
                Padding = new Padding(0, 6, 0, 0),
                Text = Tr(1898)
            };
            _lblConnStatus = new Label { Dock = DockStyle.Fill, ForeColor = UsageRed, Padding = new Padding(0, 8, 0, 0) };

            page.Controls.Add(_lblConnStatus);
            page.Controls.Add(info);
            page.Controls.Add(refreshRow);
            page.Controls.Add(grid);
            return page;
        }

        private static void AddRow(TableLayoutPanel grid, string caption, Control value)
        {
            int row = grid.RowCount;
            grid.RowCount = row + 1;
            grid.RowStyles.Add(new RowStyle(SizeType.AutoSize));
            grid.Controls.Add(new Label { Text = caption, AutoSize = true, Anchor = AnchorStyles.Left, Margin = new Padding(0, 6, 12, 6) }, 0, row);
            value.Margin = new Padding(0, 3, 0, 3);
            grid.Controls.Add(value, 1, row);
        }

        private void FillConnectionTab()
        {
            _txtConnAlias.Text = _alias;
            _txtConnFile.Text = SafeFilePath();
            if (_file == null)
            {
                _txtConnDialect.Text = "";
                _txtConnRead.Text = "";
                _txtConnTables.Text = "";
                return;
            }
            _txtConnDialect.Text = _file.Dialect;
            _txtConnRead.Text = FormatGenerated(_file.GeneratedUtc);
            int relations = 0;
            foreach (LocalSchemaTable t in _file.Tables)
                relations += t.ForeignKeys.Count;
            _txtConnTables.Text = Number(_file.Tables.Count) + " (" + Tr(1850) + ": " + Number(relations) + ")";
        }

        private string SafeFilePath()
        {
            try
            {
                return FilePath;
            }
            catch (Exception ex)
            {
                return ex.Message;
            }
        }

        private static string FormatGenerated(string utc)
        {
            DateTime when;
            if (!string.IsNullOrEmpty(utc) &&
                DateTime.TryParse(utc, CultureInfo.InvariantCulture, DateTimeStyles.AdjustToUniversal | DateTimeStyles.AssumeUniversal, out when))
                return when.ToLocalTime().ToString("g", CultureInfo.CurrentCulture);
            return utc ?? "";
        }

        // ===== State =====

        private void SetStatus(string text)
        {
            _lblStatus.Text = text ?? "";
            _toolTip.SetToolTip(_lblStatus, _lblStatus.Text);
        }

        private void SetBusy(bool busy)
        {
            _busy = busy;
            UseWaitCursor = busy;
            _split.Enabled = !busy;
            UpdateButtons();
        }

        private void UpdateButtons()
        {
            bool hasFile = _file != null && !_busy;
            _btnSave.Enabled = hasFile;
            _btnAdd.Enabled = hasFile;
            _btnDuplicate.Enabled = hasFile && _current != null;
            _btnRename.Enabled = hasFile && _current != null;
            _btnDelete.Enabled = hasFile && _current != null;
            _txtSchemaDescription.Enabled = _current != null;
            _btnRefresh.Enabled = !_busy && _createConnection != null;
            UpdateTablesButtons();
            UpdateColumnsButtons();
            UpdateRelationButtons();
            UpdateAnalysisState();
        }

        /// <summary>Something was written: the title says so and closing asks.</summary>
        private void MarkDirty()
        {
            if (_filling)
                return;
            _dirty = true;
            UpdateTitle();
        }

        /// <summary>The tables or columns that travel changed: the counters and the list follow.</summary>
        private void StructureChanged()
        {
            MarkDirty();
            UpdateCounters();
            _listSchemas.Invalidate();
        }

        private void UpdateTitle()
        {
            string title = _baseTitle + (_dirty ? " *" : "");
            if (Text != title)
                Text = title;
        }

        /// <summary>True when there is something to save: written and not the same as what was saved.</summary>
        private bool IsDirty
        {
            get { return _dirty && _file != null && LocalSchemaStore.ToJson(_file) != _savedJson; }
        }

        /// <summary>Takes the value being typed in a grid.</summary>
        private void CommitEdits()
        {
            CommitGrid(_gridValues);
            CommitGrid(_gridPairs);
        }

        private static void CommitGrid(DataGridView grid)
        {
            if (grid == null || !grid.IsCurrentCellInEditMode)
                return;
            try
            {
                grid.EndEdit();
            }
            catch
            {
                // A value the grid does not take stays out
            }
        }

        // ===== Counters of the plan =====

        private void UpdateCounters()
        {
            if (_file == null)
            {
                _lblTablesCounter.Text = "";
                _lblColumnsCounter.Text = "";
                _lblPlanWarning.Text = "";
                return;
            }
            int tables, widest;
            string widestTable;
            LocalSchemaEditing.Count(_file, _current, out tables, out widest, out widestTable);
            int maxTables = MaxTables;
            int maxColumns = MaxColumnsPerTable;
            _lblTablesCounter.Text = TrFormat(1883, Usage(tables, maxTables));
            _lblTablesCounter.ForeColor = UsageColor(tables, maxTables);
            _lblColumnsCounter.Text = TrFormat(1884, Usage(widest, maxColumns) + (widestTable.Length > 0 ? " (" + widestTable + ")" : ""));
            _lblColumnsCounter.ForeColor = UsageColor(widest, maxColumns);
            bool over = LocalSchemaEditing.IsOverPlan(tables, widest, maxTables, maxColumns);
            _lblPlanWarning.Text = over ? "⚠ " + Tr(1844) : "";
            _toolTip.SetToolTip(_lblPlanWarning, _lblPlanWarning.Text);
            UpdateColumnsCounter();
        }

        /// <summary>«n / max», or «n» without a limit (none in the plan, or the AI on the Agent).</summary>
        private static string Usage(int count, int max)
        {
            string n = count.ToString("N0", CultureInfo.CurrentCulture);
            return max > 0 ? n + " / " + max.ToString("N0", CultureInfo.CurrentCulture) : n;
        }

        // As the cloud's screen: red from the limit, orange from 80 %
        private static Color UsageColor(int count, int max)
        {
            if (max <= 0)
                return SystemColors.ControlText;
            double ratio = count / (double)max;
            return ratio >= 1 ? UsageRed : ratio >= 0.8 ? UsageOrange : UsageGreen;
        }

        private bool IsOverPlan(LocalSubschema subschema)
        {
            int tables, widest;
            string widestTable;
            LocalSchemaEditing.Count(_file, subschema, out tables, out widest, out widestTable);
            return LocalSchemaEditing.IsOverPlan(tables, widest, MaxTables, MaxColumnsPerTable);
        }

        // ===== Loading, refreshing, saving =====

        private async Task LoadFileAsync()
        {
            SetBusy(true);
            try
            {
                LocalSchemaFile file = LocalSchemaStore.Load(FilePath);
                if (file == null)
                {
                    // Never generated: the catalog is read now (and saved, as the copilot would do).
                    SetStatus(TrFormat(1899, _alias));
                    file = await Task.Run(() => LocalSchemaStore.LoadOrGenerate(_folder, _alias, _createConnection, false));
                }
                if (IsDisposed)
                    return;
                _file = file;
                _savedJson = LocalSchemaStore.ToJson(_file);
                _dirty = false;
                SetStatus("");
                _lblConnStatus.Text = "";
            }
            catch (Exception ex)
            {
                if (IsDisposed)
                    return;
                string message = TrFormat(1900, _alias, ex.Message);
                SetStatus(message);
                _lblConnStatus.Text = message;
                _tabs.SelectedTab = _tabConnection;
            }
            finally
            {
                if (!IsDisposed)
                    SetBusy(false);
            }
            if (!IsDisposed)
                FillAll(null);
        }

        private async Task RefreshAsync()
        {
            if (_createConnection == null || _busy)
                return;
            CommitEdits();
            SetBusy(true);
            string selected = _current != null ? _current.Name : null;
            string added = _added != null ? _added.Name : null;
            try
            {
                SetStatus(TrFormat(1899, _alias));
                LocalSchemaFile fresh = await Task.Run(() =>
                {
                    using (DbConnection connection = _createConnection())
                        return LocalSchemaStore.Generate(connection, _alias);
                });
                if (IsDisposed)
                    return;
                // What was written here (descriptions, values, relations written by hand, subschemas, unsaved
                // changes included) is kept; the merge copies the subschemas, so they are followed by name.
                _file = LocalSchemaStore.Merge(_file, fresh);
                _current = selected != null ? LocalSchemaStore.FindSubschema(_file, selected) : null;
                _added = added != null ? LocalSchemaStore.FindSubschema(_file, added) : null;
                _relation = null;
                _dirty = true;
                UpdateTitle();
                SetStatus(TrFormat(1901, Number(_file.Tables.Count)));
                _lblConnStatus.Text = "";
            }
            catch (Exception ex)
            {
                if (IsDisposed)
                    return;
                SetStatus(ex.Message);
                _lblConnStatus.Text = ex.Message;
                MessageBox.Show(this, ex.Message, _btnRefresh.Text, MessageBoxButtons.OK, MessageBoxIcon.Error);
            }
            finally
            {
                if (!IsDisposed)
                    SetBusy(false);
            }
            if (!IsDisposed)
                FillAll(_current);
        }

        /// <summary>Saves the file; false when it was not saved.</summary>
        private bool SaveFile()
        {
            if (_file == null || _busy)
                return false;
            CommitEdits();
            List<KeyValuePair<LocalSchemaTable, LocalSchemaForeignKey>> incomplete = LocalSchemaEditing.IncompleteWrittenRelations(_file);
            if (incomplete.Count > 0)
            {
                string question = incomplete.Count == 1 ? Tr(1902) : TrFormat(1903, Number(incomplete.Count));
                if (MessageBox.Show(this, question, Tr(46), MessageBoxButtons.YesNo, MessageBoxIcon.Warning) != DialogResult.Yes)
                    return false;
                foreach (KeyValuePair<LocalSchemaTable, LocalSchemaForeignKey> pair in incomplete)
                    pair.Key.ForeignKeys.Remove(pair.Value);
                if (_relation != null && incomplete.Exists(p => p.Value == _relation.Fk))
                    _relation = null;
            }
            try
            {
                LocalSchemaStore.Save(_file, FilePath);
            }
            catch (Exception ex)
            {
                MessageBox.Show(this, ex.Message, Tr(46), MessageBoxButtons.OK, MessageBoxIcon.Error);
                return false;
            }
            _savedJson = LocalSchemaStore.ToJson(_file);
            _dirty = false;
            _savedOnce = true;
            _savedAddedName = _added != null && _file.Schemas.Contains(_added) ? _added.Name : "";
            UpdateTitle();
            // Saving normalizes the file (empty lists and values go): what is shown follows
            FillAll(_current);
            SetStatus(TrFormat(1904, FilePath) + (IsOverPlan(_current) ? "  ⚠ " + Tr(1844) : ""));
            return true;
        }

        /// <summary>Asks before closing with changes: save, don't save or stay.</summary>
        protected override void OnFormClosing(FormClosingEventArgs e)
        {
            CommitEdits();
            if (!e.Cancel && IsDirty)
            {
                DialogResult answer = MessageBox.Show(this, Tr(1886),
                    _baseTitle, MessageBoxButtons.YesNoCancel, MessageBoxIcon.Question);
                if (answer == DialogResult.Cancel || (answer == DialogResult.Yes && !SaveFile()))
                    e.Cancel = true;
            }
            if (!e.Cancel)
                CancelBackgroundWork();
            base.OnFormClosing(e);
        }

        private void CancelBackgroundWork()
        {
            try { _analysis?.Cancel(); } catch (ObjectDisposedException) { }
            try { _previewCts?.Cancel(); } catch (ObjectDisposedException) { }
        }

        // ===== The list of subschemas =====

        /// <summary>An entry of the list: a subschema, or all the tables (null).</summary>
        private sealed class SchemaEntry
        {
            public SchemaEntry(LocalSubschema schema)
            {
                Schema = schema;
            }

            public readonly LocalSubschema Schema;
        }

        private string EntryText(SchemaEntry entry)
        {
            if (_file == null)
                return "";
            int tables, widest;
            string widestTable;
            LocalSchemaEditing.Count(_file, entry.Schema, out tables, out widest, out widestTable);
            bool over = LocalSchemaEditing.IsOverPlan(tables, widest, MaxTables, MaxColumnsPerTable);
            string name = entry.Schema == null ? Tr(1843) : entry.Schema.Name;
            return (over ? "⚠ " : "") + name + " (" + tables.ToString(CultureInfo.CurrentCulture) + ")";
        }

        private void ListSchemas_DrawItem(object sender, DrawItemEventArgs e)
        {
            e.DrawBackground();
            if (e.Index >= 0 && e.Index < _listSchemas.Items.Count)
            {
                var entry = (SchemaEntry)_listSchemas.Items[e.Index];
                bool selected = (e.State & DrawItemState.Selected) == DrawItemState.Selected;
                Color color = selected ? SystemColors.HighlightText : _listSchemas.ForeColor;
                Font font = e.Font ?? _listSchemas.Font;
                Font bold = entry.Schema == null ? new Font(font, FontStyle.Bold) : null;
                try
                {
                    var bounds = new Rectangle(e.Bounds.Left + 3, e.Bounds.Top, Math.Max(0, e.Bounds.Width - 3), e.Bounds.Height);
                    TextRenderer.DrawText(e.Graphics, EntryText(entry), bold ?? font, bounds, color,
                        TextFormatFlags.Left | TextFormatFlags.VerticalCenter | TextFormatFlags.SingleLine |
                        TextFormatFlags.EndEllipsis | TextFormatFlags.NoPrefix);
                }
                finally
                {
                    bold?.Dispose();
                }
            }
            e.DrawFocusRectangle();
        }

        private void FillAll(LocalSubschema select)
        {
            _filling = true;
            try
            {
                _listSchemas.Items.Clear();
                int index = -1;
                if (_file != null)
                {
                    _listSchemas.Items.Add(new SchemaEntry(null));
                    index = 0;
                    foreach (LocalSubschema s in _file.Schemas)
                    {
                        _listSchemas.Items.Add(new SchemaEntry(s));
                        if (select != null && s == select)
                            index = _listSchemas.Items.Count - 1;
                    }
                }
                _listSchemas.SelectedIndex = index;
                _current = index > 0 ? select : null;
            }
            finally
            {
                _filling = false;
            }
            FillConnectionTab();
            FillCurrent();
        }

        private void ListSchemas_SelectedIndexChanged(object sender, EventArgs e)
        {
            if (_filling)
                return;
            CommitEdits();
            var entry = _listSchemas.SelectedItem as SchemaEntry;
            _current = entry != null ? entry.Schema : null;
            FillCurrent();
        }

        /// <summary>Shows the selected subschema (or all the tables) in every tab.</summary>
        private void FillCurrent()
        {
            _filling = true;
            try
            {
                _txtSchemaDescription.Text = _current != null ? _current.Description : "";
            }
            finally
            {
                _filling = false;
            }
            FillTablesTab();
            FillColumnsTab();
            FillRelationsTab();
            UpdateCounters();
            UpdateButtons();
        }

        private string AskName(string title, string initial, LocalSubschema except)
        {
            while (true)
            {
                string name = PromptText(this, title, Tr(544) + ":", initial);
                if (name == null)
                    return null;
                name = name.Trim();
                string problem = "";
                if (name.Length == 0)
                    problem = Tr(1905);
                else if (string.Equals(name, Tr(1843), StringComparison.OrdinalIgnoreCase) ||
                    string.Equals(name, "All tables", StringComparison.OrdinalIgnoreCase) ||
                    string.Equals(name, "All the tables", StringComparison.OrdinalIgnoreCase))
                    problem = TrFormat(1906, Tr(1843));
                else if (_file.Schemas.Exists(s => s != except && string.Equals(s.Name, name, StringComparison.OrdinalIgnoreCase)))
                    problem = TrFormat(1907, name);
                if (problem.Length == 0)
                    return name;
                MessageBox.Show(this, problem, title, MessageBoxButtons.OK, MessageBoxIcon.Warning);
                initial = name;
            }
        }

        private string UniqueName(string name)
        {
            string result = name;
            for (int n = 2; _file.Schemas.Exists(s => string.Equals(s.Name, result, StringComparison.OrdinalIgnoreCase)); n++)
                result = name + " " + n.ToString(CultureInfo.InvariantCulture);
            return result;
        }

        private void AddSubschema()
        {
            if (_file == null || _busy)
                return;
            CommitEdits();
            string name = AskName(Tr(1887), "", null);
            if (name == null)
                return;
            _added = new LocalSubschema { Name = name };
            _file.Schemas.Add(_added);
            StructureChanged();
            FillAll(_added);
            _tabs.SelectedTab = _tabTables;
        }

        private void DuplicateSubschema()
        {
            if (_file == null || _current == null)
                return;
            CommitEdits();
            // The name proposed is the same one numbered (no word to translate in it)
            string name = AskName(Caption(1847), UniqueName(_current.Name), null);
            if (name == null)
                return;
            LocalSubschema copy = LocalSchemaEditing.Duplicate(_current, name);
            _file.Schemas.Insert(_file.Schemas.IndexOf(_current) + 1, copy);
            StructureChanged();
            FillAll(copy);
        }

        private void RenameSubschema()
        {
            if (_current == null)
                return;
            CommitEdits();
            string name = AskName(Tr(151), _current.Name, _current);
            if (name == null || name == _current.Name)
                return;
            _current.Name = name;
            MarkDirty();
            FillAll(_current);
        }

        private void DeleteSubschema()
        {
            if (_current == null)
                return;
            if (MessageBox.Show(this, TrFormat(1888, _current.Name) + " " + TrFormat(1908, Tr(1843)),
                Tr(150), MessageBoxButtons.YesNo, MessageBoxIcon.Question) != DialogResult.Yes)
                return;
            _file.Schemas.Remove(_current);
            StructureChanged();
            FillAll(null);
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
                var ok = new Button { Text = Tr(93), DialogResult = DialogResult.OK, Left = 212, Top = 70, Width = 75 };
                var cancel = new Button { Text = Tr(94), DialogResult = DialogResult.Cancel, Left = 293, Top = 70, Width = 75 };
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
