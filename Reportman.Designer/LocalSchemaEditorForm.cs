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
using System.IO;
using System.Text;
using System.Threading;
using System.Threading.Tasks;
using System.Windows.Forms;
using Reportman.Drawing;
using Reportman.Reporting;

namespace Reportman.Designer
{
    /// <summary>
    /// The AI that «Analyze with AI» of <see cref="LocalSchemaEditorForm"/> starts with: the provider and mode
    /// selected in the AI panel that opened it (the copilot, the SQL editor). The dialog lets the user change it.
    /// </summary>
    public class LocalSchemaAnalysisSettings
    {
        /// <summary>The provider and mode selected in <paramref name="selection"/>, with its Agent for LocalAgent.</summary>
        /// <param name="selection">The AI selection of a panel.</param>
        public static LocalSchemaAnalysisSettings From(AISelectionControl selection)
        {
            string tier = selection.SelectedTier;
            bool localAgent = string.Equals(tier, "LocalAgent", StringComparison.OrdinalIgnoreCase);
            return new LocalSchemaAnalysisSettings
            {
                Tier = tier,
                Mode = selection.SelectedMode,
                AgentSecret = localAgent ? selection.AgentSecret : "",
                AgentAiId = localAgent ? selection.AgentAiId : 0
            };
        }

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
    /// <para>
    /// A large catalog (<see cref="DatabaseCatalogReader.LargeCatalogThreshold"/> tables) comes with the names of its
    /// tables only, and the columns of a table are read when it is used: added to a subschema, clicked in Columns,
    /// chosen as an end of a relation, before an import. The lists paint only the rows they show, and their filters
    /// find the words typed in the names and in the descriptions (<see cref="LocalSchemaFilter"/>).
    /// </para>
    /// <para>
    /// Every read of the database (the catalog, the columns of some tables, the first rows of a table) runs off the UI
    /// thread, with a progress window when it takes a while and Cancel; a read cancelled changes nothing, and a first
    /// opening whose catalog read is cancelled closes the dialog (<see cref="RunReadAsync{T}"/>).
    /// </para>
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
        // The AI the analysis starts with; the Validation tab lets the user choose another one
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
        // The tables of a large catalog whose columns are being read
        private readonly HashSet<string> _readingTables = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
        // The tables whose read the user cancelled: the Columns tab does not read them again until one is clicked
        private readonly HashSet<string> _cancelledReads = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
        // Columns read while the Relations tab was not shown: it is filled again when it is
        private bool _relationsStale;

        private SplitContainer _split;
        private ListBox _listSchemas;
        private Button _btnAdd;
        private Button _btnDuplicate;
        private Button _btnRename;
        private Button _btnDelete;
        private Button _btnExport;
        private Button _btnImport;
        private Button _btnLibrary;
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
        private Label _lblConnLarge;

        /// <summary>
        /// The dbxschemas folder of this designer: next to the dbxconnections.ini it writes
        /// (%PUBLIC% on Windows), or next to the program when there is none. The copilot and the data
        /// definitions of the designer open the files of the same folder.
        /// </summary>
        public static string DesignerFolder()
        {
            string ini = DbxConnections.ResolveWritePath();
            if (string.IsNullOrEmpty(ini))
                ini = System.IO.Path.Combine(AppDomain.CurrentDomain.BaseDirectory, "dbxconnections.ini");
            return LocalSchemaStore.FolderFor(ini);
        }

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
        /// «Analyze with AI» starts with (the selection of the panel that opens it). Returns true when the file
        /// was saved.
        /// </summary>
        /// <param name="owner">The owner window.</param>
        /// <param name="folder">The dbxschemas folder.</param>
        /// <param name="alias">The connection alias.</param>
        /// <param name="createConnection">Creates a connection to read the catalog and the preview from.</param>
        /// <param name="addSubschema">True to start adding a subschema.</param>
        /// <param name="analysis">The AI the analysis starts with; null for Standard and Fast.</param>
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
        /// <param name="analysis">The AI the analysis starts with; null for Standard and Fast.</param>
        public LocalSchemaEditorForm(string folder, string alias, Func<DbConnection> createConnection,
            LocalSchemaAnalysisSettings analysis)
        {
            _folder = folder;
            _alias = (alias ?? "").Trim().ToUpperInvariant();
            _createConnection = createConnection;
            _ai = analysis ?? new LocalSchemaAnalysisSettings();
            InitializeComponent();
            _aiSelection.RestoreProviderSelection(_ai.Tier, _ai.AgentAiId);
            _aiSelection.SelectedMode = _ai.Mode;
            RpAuthManager.Instance.AuthChanged += OnAuthChanged;
            Shown += async (s, e) =>
            {
                // The user's Agents for the AI of the analysis (its Agent, when it came selected), while
                // the file is read
                _aiSelection.RefreshState();
                _ = _aiSelection.LoadUserAgentsAsync(_ai.Tier, _ai.AgentAiId);
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
                RpAuthManager.Instance.AuthChanged -= OnAuthChanged;
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

        /// <summary>True when the plan limits do not apply: the AI chosen for the analysis runs on the user's Agent.</summary>
        private bool IgnorePlanLimits
        {
            get
            {
                return _aiSelection != null &&
                    string.Equals(_aiSelection.SelectedTier, "LocalAgent", StringComparison.OrdinalIgnoreCase);
            }
        }

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

            var buttons = new TableLayoutPanel { Dock = DockStyle.Bottom, ColumnCount = 2, RowCount = 4, Height = 128 };
            buttons.ColumnStyles.Add(new ColumnStyle(SizeType.Percent, 50f));
            buttons.ColumnStyles.Add(new ColumnStyle(SizeType.Percent, 50f));
            buttons.RowStyles.Add(new RowStyle(SizeType.Percent, 25f));
            buttons.RowStyles.Add(new RowStyle(SizeType.Percent, 25f));
            buttons.RowStyles.Add(new RowStyle(SizeType.Percent, 25f));
            buttons.RowStyles.Add(new RowStyle(SizeType.Percent, 25f));
            _btnAdd = new Button { Text = Tr(149) + "...", Dock = DockStyle.Fill };
            _btnAdd.Click += (s, e) => AddSubschema();
            _btnDuplicate = new Button { Text = Tr(1847), Dock = DockStyle.Fill };
            _btnDuplicate.Click += (s, e) => DuplicateSubschema();
            _btnRename = new Button { Text = Tr(151) + "...", Dock = DockStyle.Fill };
            _btnRename.Click += (s, e) => RenameSubschema();
            _btnDelete = new Button { Text = Tr(150), Dock = DockStyle.Fill };
            _btnDelete.Click += (s, e) => DeleteSubschema();
            // In the format of the Reportman AI web (its schema screen exports and imports the same file)
            _btnExport = new Button { Text = Tr(1931), Dock = DockStyle.Fill };
            _btnExport.Click += (s, e) => ExportSubschema();
            _btnImport = new Button { Text = Tr(1932), Dock = DockStyle.Fill };
            _btnImport.Click += (s, e) => ImportSubschema();
            // The same import from the schema library of Reportman AI instead of a file
            _btnLibrary = new Button { Text = Tr(1986), Dock = DockStyle.Fill };
            _btnLibrary.Click += (s, e) => ImportFromLibrary();
            _toolTip.SetToolTip(_btnExport, Tr(1933));
            _toolTip.SetToolTip(_btnImport, Tr(1934));
            _toolTip.SetToolTip(_btnLibrary, Tr(1987));
            buttons.Controls.Add(_btnAdd, 0, 0);
            buttons.Controls.Add(_btnDuplicate, 1, 0);
            buttons.Controls.Add(_btnRename, 0, 1);
            buttons.Controls.Add(_btnDelete, 1, 1);
            buttons.Controls.Add(_btnExport, 0, 2);
            buttons.Controls.Add(_btnImport, 1, 2);
            buttons.Controls.Add(_btnLibrary, 0, 3);
            buttons.SetColumnSpan(_btnLibrary, 2);

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
            _tabs.SelectedIndexChanged += (s, e) =>
            {
                CommitEdits();
                // What waits for the tab to be shown: the columns of the table clicked, the relations of the tables read
                if (_tabs.SelectedTab == _tabColumns)
                    ReadColumnsTableLater(true);
                else if (_tabs.SelectedTab == _tabRelations && _relationsStale)
                    FillRelationsTab();
            };

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
            // The words of the name or of the description, in any order (LocalSchemaFilter)
#if NETCOREAPP
            filter.PlaceholderText = Tr(2035);
#endif
            _toolTip.SetToolTip(filter, Tr(2035));
            filterRow.Controls.Add(filter, 1, 0);
            footer = new Label { Dock = DockStyle.Bottom, Height = 20, ForeColor = SystemColors.GrayText, AutoEllipsis = true };
            list.Dock = DockStyle.Fill;
            panel.Controls.Add(list);
            panel.Controls.Add(filterRow);
            panel.Controls.Add(title);
            panel.Controls.Add(footer);
            return panel;
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
            // A large catalog says it: the columns of a table are read when it is used
            _lblConnLarge = new Label { Dock = DockStyle.Top, AutoSize = false, Height = 40, Padding = new Padding(0, 6, 0, 0), Visible = false };

            page.Controls.Add(_lblConnStatus);
            page.Controls.Add(_lblConnLarge);
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
                _lblConnLarge.Visible = false;
                return;
            }
            bool large = LocalSchemaStore.IsLargeCatalog(_file);
            _lblConnLarge.Text = large ? TrFormat(2032, Number(_file.Tables.Count)) : "";
            _lblConnLarge.Visible = large;
            _txtConnDialect.Text = _file.Dialect;
            _txtConnRead.Text = FormatGenerated(_file.GeneratedUtc);
            // The relations of the dictionary: not the ones of the catalog deleted with all the tables
            int relations = 0;
            foreach (LocalSchemaTable t in _file.Tables)
                foreach (LocalSchemaForeignKey fk in t.ForeignKeys)
                    if (!LocalSchemaStore.IsExcluded(_file, null, t.Name, fk))
                        relations++;
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

        /// <summary>
        /// A login, a logout or a new status of the user: the credits gauge and the Agents of the AI selection,
        /// and the counters of the plan, follow.
        /// </summary>
        private void OnAuthChanged(bool success)
        {
            if (IsDisposed)
                return;
            if (InvokeRequired)
            {
                PostToUi(() => OnAuthChanged(success));
                return;
            }
            _aiSelection.RefreshState();
            _ = _aiSelection.LoadUserAgentsAsync();
            PlanLimitsChanged();
        }

        /// <summary>The limits of the plan, or whether they apply, changed: the counters and the list follow.</summary>
        private void PlanLimitsChanged()
        {
            UpdateCounters();
            _listSchemas.Invalidate();
        }

        private void UpdateButtons()
        {
            bool hasFile = _file != null && !_busy;
            _btnSave.Enabled = hasFile;
            _btnAdd.Enabled = hasFile;
            _btnDuplicate.Enabled = hasFile && _current != null;
            _btnRename.Enabled = hasFile && _current != null;
            _btnDelete.Enabled = hasFile && _current != null;
            // Export works with all the tables too (the whole catalog); import always makes a new subschema
            _btnExport.Enabled = hasFile;
            _btnImport.Enabled = hasFile;
            _btnLibrary.Enabled = hasFile;
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
            bool cancelled = false;
            try
            {
                LocalSchemaFile file = LocalSchemaStore.Load(FilePath);
                if (file == null)
                {
                    // Never generated: the catalog is read now (and saved, as the copilot would do).
                    SetStatus(TrFormat(1899, _alias));
                    string folder = _folder;
                    string alias = _alias;
                    Func<DbConnection> createConnection = _createConnection;
                    file = await RunReadAsync(TrFormat(2040, _alias), CancellationToken.None,
                        (progress, token) => LocalSchemaStore.LoadOrGenerateAsync(folder, alias, createConnection, false,
                            DatabaseCatalogReader.LargeCatalogThreshold, progress, token));
                }
                if (IsDisposed)
                    return;
                _file = file;
                _savedJson = LocalSchemaStore.ToJson(_file);
                _dirty = false;
                SetStatus("");
                _lblConnStatus.Text = "";
            }
            catch (OperationCanceledException)
            {
                // Nothing to show: the file was not written
                cancelled = true;
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
            if (IsDisposed)
                return;
            if (cancelled)
            {
                Close();
                return;
            }
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
            bool cancelled = false;
            try
            {
                SetStatus(TrFormat(1899, _alias));
                // A large catalog reads again the columns of the tables of the subschemas and of the ones read (the
                // dialog is busy meanwhile: nothing changes the file while it is read)
                LocalSchemaFile previous = _file;
                string alias = _alias;
                Func<DbConnection> createConnection = _createConnection;
                LocalSchemaFile fresh = await RunReadAsync(TrFormat(2040, _alias), CancellationToken.None, async (progress, token) =>
                {
                    using (DbConnection connection = createConnection())
                        return await LocalSchemaStore.GenerateAsync(connection, alias, previous, DatabaseCatalogReader.LargeCatalogThreshold,
                            progress, token).ConfigureAwait(false);
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
            catch (OperationCanceledException)
            {
                // Cancelled: the file keeps what it had, and nothing is said
                cancelled = true;
                if (!IsDisposed)
                    SetStatus("");
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
            if (!IsDisposed && !cancelled)
                FillAll(_current);
        }

        /// <summary>
        /// Reads the columns of the tables of <paramref name="tables"/> the file has not read (a large catalog reads them
        /// when a table is used) and merges them into it (<see cref="LocalSchemaStore.MergeColumns"/>), saying it in the
        /// status line meanwhile, and in a progress window when it takes a while (<see cref="RunReadAsync{T}"/>). With
        /// <paramref name="block"/> the dialog is busy until they come (what follows needs them: adding tables, an import)
        /// and a failure is shown; else it goes on, and the tables already being read are not read twice. When it fails
        /// the tables stay unread and the status line says why; cancelled, they stay unread and nothing is said. False
        /// when it failed or was cancelled.
        /// </summary>
        private async Task<bool> ReadColumnsAsync(IEnumerable<string> tables, bool block)
        {
            if (_file == null)
                return false;
            List<string> unread = LocalSchemaStore.UnreadTables(_file, tables);
            if (!block)
                unread.RemoveAll(n => _readingTables.Contains(n));
            if (unread.Count == 0)
                return true;
            string names = LocalSchemaEditing.ShortList(unread, 5);
            Func<DbConnection> createConnection = _createConnection;
            foreach (string name in unread)
            {
                _readingTables.Add(name);
                _cancelledReads.Remove(name);
            }
            if (block)
                SetBusy(true);
            SetStatus(TrFormat(2033, names));
            try
            {
                if (createConnection == null)
                    throw new InvalidOperationException("No connection to read " + names);
                List<LocalSchemaTable> read = await RunReadAsync(TrFormat(2033, names), CancellationToken.None, async (progress, token) =>
                {
                    using (DbConnection connection = createConnection())
                        return await DatabaseCatalogReader.ReadTableDetailsAsync(connection, unread, progress, token).ConfigureAwait(false);
                });
                if (IsDisposed || _file == null)
                    return false;
                // Into the file shown now (the same one, or the one read again meanwhile)
                bool unchanged = !_dirty;
                List<string> merged = LocalSchemaStore.MergeColumns(_file, read);
                // What the catalog has is no change of the user's: a dialog without changes stays without them (they
                // are read again the next time), one with changes saves them too
                if (merged.Count > 0 && unchanged)
                    _savedJson = LocalSchemaStore.ToJson(_file);
                if (_lblStatus.Text == TrFormat(2033, names))
                    SetStatus("");
                if (merged.Count > 0)
                    ColumnsMerged();
                return true;
            }
            catch (OperationCanceledException)
            {
                if (IsDisposed)
                    return false;
                // The tables stay unread, and the Columns tab does not read them again by itself
                foreach (string name in unread)
                    _cancelledReads.Add(name);
                if (_lblStatus.Text == TrFormat(2033, names))
                    SetStatus("");
                return false;
            }
            catch (Exception ex)
            {
                if (IsDisposed)
                    return false;
                string message = TrFormat(2036, names, ex.Message);
                SetStatus(message);
                if (block)
                    MessageBox.Show(this, message, _baseTitle, MessageBoxButtons.OK, MessageBoxIcon.Warning);
                return false;
            }
            finally
            {
                foreach (string name in unread)
                    _readingTables.Remove(name);
                if (!IsDisposed)
                {
                    if (block)
                        SetBusy(false);
                    // The columns of the table clicked, or why they are not there
                    if (_columnsTable != null && unread.Contains(_columnsTable.Name))
                        FillColumnsList();
                }
            }
        }

        /// <summary>The columns of some tables were read: what shows them follows (the relations, when they are shown).</summary>
        private void ColumnsMerged()
        {
            FillConnectionTab();
            UpdateCounters();
            _listSchemas.Invalidate();
            if (_tabs.SelectedTab == _tabRelations)
                FillRelationsTab();
            else
                _relationsStale = true;
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
            // The reads of the database: what they read is thrown away
            foreach (CancellationTokenSource read in _reads.ToArray())
            {
                try { read.Cancel(); } catch (ObjectDisposedException) { }
            }
        }

        // ===== The list of subschemas =====

        /// <summary>An entry of the list: a subschema, or all the tables (null).</summary>
        private sealed class SchemaEntry
        {
            public SchemaEntry(LocalSchemaEditorForm owner, LocalSubschema schema)
            {
                _owner = owner;
                Schema = schema;
            }

            private readonly LocalSchemaEditorForm _owner;
            public readonly LocalSubschema Schema;

            // The text the list draws, also what accessibility reads for the item
            public override string ToString()
            {
                return _owner.EntryText(this);
            }
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
                    _listSchemas.Items.Add(new SchemaEntry(this, null));
                    index = 0;
                    foreach (LocalSubschema s in _file.Schemas)
                    {
                        _listSchemas.Items.Add(new SchemaEntry(this, s));
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
                else if (Array.Exists(ReservedNames, r => string.Equals(r, name, StringComparison.OrdinalIgnoreCase)))
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
            return LocalSchemaEditing.UniqueSubschemaName(_file, name, null);
        }

        /// <summary>The names a subschema cannot take: the one of all the tables, translated and in English.</summary>
        private static string[] ReservedNames
        {
            get { return new[] { Tr(1843), "All tables", "All the tables" }; }
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

        private static string SchemaFileFilter
        {
            get { return Tr(1939) + " (*.json)|*.json"; }
        }

        /// <summary>
        /// Saves what travels of the subschema shown (the whole catalog with all the tables) as the Reportman AI
        /// web exports a schema, so the web, or another local schema screen, imports it.
        /// </summary>
        private void ExportSubschema()
        {
            if (_file == null || _busy)
                return;
            CommitEdits();
            using (var dialog = new SaveFileDialog())
            {
                dialog.Title = Caption(1931);
                dialog.Filter = SchemaFileFilter;
                dialog.DefaultExt = "json";
                dialog.AddExtension = true;
                dialog.OverwritePrompt = true;
                dialog.FileName = LocalSchemaEditing.ExportFileName(LocalSchemaEditing.ExportName(_file, _current));
                if (dialog.ShowDialog(this) != DialogResult.OK)
                    return;
                try
                {
                    // UTF-8 without BOM, as the web's download
                    File.WriteAllText(dialog.FileName, LocalSchemaEditing.ExportJson(_file, _current), new UTF8Encoding(false));
                }
                catch (Exception ex)
                {
                    MessageBox.Show(this, ex.Message, Caption(1931), MessageBoxButtons.OK, MessageBoxIcon.Error);
                    return;
                }
                SetStatus(TrFormat(1935, dialog.FileName));
            }
        }

        /// <summary>
        /// Makes a new subschema from a schema exported by the Reportman AI web (or by a local schema screen): the
        /// tables and columns the database has, their descriptions and allowed values into the dictionary, and the
        /// relations; it stays selected and unsaved, and what the database does not have is said. When the names of
        /// its tables are templates with several values here, the user chooses them first.
        /// </summary>
        private async void ImportSubschema()
        {
            if (_file == null || _busy)
                return;
            CommitEdits();
            string path;
            using (var dialog = new OpenFileDialog())
            {
                dialog.Title = Caption(1932);
                dialog.Filter = SchemaFileFilter;
                dialog.CheckFileExists = true;
                if (dialog.ShowDialog(this) != DialogResult.OK)
                    return;
                path = dialog.FileName;
            }
            LocalSchemaImportResult result;
            try
            {
                string json = File.ReadAllText(path, Encoding.UTF8);
                Dictionary<string, string> values;
                if (!ChooseTemplateValues(json, out values))
                    return;
                // The tables it finds are read first (a large catalog): the import chooses among their columns
                if (!await ReadColumnsAsync(LocalSchemaEditing.ImportTables(_file, json, values), true) || IsDisposed)
                    return;
                result = LocalSchemaEditing.Import(_file, json, path, ReservedNames, "", values);
            }
            catch (Exception ex)
            {
                MessageBox.Show(this, ex.Message, Caption(1932), MessageBoxButtons.OK, MessageBoxIcon.Error);
                return;
            }
            if (result == null)
            {
                MessageBox.Show(this, Tr(1938), Caption(1932), MessageBoxButtons.OK, MessageBoxIcon.Warning);
                return;
            }
            ShowImported(result, Caption(1932));
        }

        /// <summary>
        /// Makes a new subschema from a schema of the Reportman AI library (<c>GET api/schema/list</c>, then
        /// <c>api/schema/{id}</c>): the same import as a file's, named as the library calls the schema; it stays
        /// selected and unsaved, and the subschema stays local (nothing is written to the cloud). Every schema of the
        /// library is read before choosing, to say how many of its tables this database has and to start on the one
        /// written for it; the one chosen is imported from what was read.
        /// </summary>
        private async void ImportFromLibrary()
        {
            if (_file == null || _busy)
                return;
            CommitEdits();
            string title = Caption(1986);
            List<LocalSchemaLibraryCategory> categories = null;
            SetBusy(true);
            try
            {
                categories = LocalSchemaEditing.ParseLibrary(await RpAuthManager.Instance.GetSchemaLibraryAsync());
                if (!IsDisposed)
                    await ReadLibrarySchemasAsync(categories);
            }
            catch (Exception ex)
            {
                categories = null;
                if (!IsDisposed)
                    MessageBox.Show(this, TrFormat(1989, ErrorReason(ex)), title, MessageBoxButtons.OK, MessageBoxIcon.Error);
            }
            finally
            {
                if (!IsDisposed)
                    SetBusy(false);
            }
            if (categories == null || IsDisposed)
                return;
            LocalSchemaLibrarySchema chosen = LocalSchemaLibraryForm.Choose(this, categories);
            if (chosen == null)
                return;

            string schema = chosen.FullSchema;
            if (schema == null)
            {
                // It could not be read with the others: read again now
                SetBusy(true);
                try
                {
                    schema = LocalSchemaEditing.LibraryFullSchema(await RpAuthManager.Instance.GetLibrarySchemaAsync(chosen.Id));
                }
                catch (Exception ex)
                {
                    if (!IsDisposed)
                        MessageBox.Show(this, TrFormat(1989, ErrorReason(ex)), title, MessageBoxButtons.OK, MessageBoxIcon.Error);
                }
                finally
                {
                    if (!IsDisposed)
                        SetBusy(false);
                }
                if (schema == null || IsDisposed)
                    return;
            }
            LocalSchemaImportResult result = null;
            if (schema.Length > 0)
            {
                Dictionary<string, string> values;
                if (!ChooseTemplateValues(schema, out values))
                    return;
                // The tables it finds are read first (a large catalog): the import chooses among their columns
                if (!await ReadColumnsAsync(LocalSchemaEditing.ImportTables(_file, schema, values), true) || IsDisposed)
                    return;
                try
                {
                    result = LocalSchemaEditing.Import(_file, schema, "", ReservedNames, chosen.Name, values);
                }
                catch (Exception ex)
                {
                    MessageBox.Show(this, TrFormat(1989, ErrorReason(ex)), title, MessageBoxButtons.OK, MessageBoxIcon.Error);
                    return;
                }
            }
            if (result == null)
            {
                // Read, but not a schema: nothing was changed
                MessageBox.Show(this, TrFormat(1989, Tr(1938)), title, MessageBoxButtons.OK, MessageBoxIcon.Warning);
                return;
            }
            ShowImported(result, title);
        }

        /// <summary>
        /// Reads every schema of the library at once, and how many of its tables this database has: a schema that
        /// cannot be read is left without them (it is read again if it is chosen).
        /// </summary>
        private Task ReadLibrarySchemasAsync(List<LocalSchemaLibraryCategory> categories)
        {
            var reads = new List<Task>();
            foreach (LocalSchemaLibraryCategory category in categories)
                foreach (LocalSchemaLibrarySchema schema in category.Schemas)
                    reads.Add(ReadLibrarySchemaAsync(schema));
            return Task.WhenAll(reads);
        }

        private async Task ReadLibrarySchemaAsync(LocalSchemaLibrarySchema schema)
        {
            string json;
            try
            {
                json = LocalSchemaEditing.LibraryFullSchema(await RpAuthManager.Instance.GetLibrarySchemaAsync(schema.Id));
            }
            catch (Exception)
            {
                // Shown without its coverage, and read again if it is chosen
                return;
            }
            if (IsDisposed || _file == null)
                return;
            schema.FullSchema = json;
            schema.Coverage = LocalSchemaEditing.LibraryCoverage(_file, json);
        }

        /// <summary>
        /// The values of the placeholders that build the names of the tables of a schema to import
        /// (<see cref="LocalSchemaEditing.LibraryPlaceholders"/>): one this database has a single value for takes it,
        /// and the user chooses among several. False when the user cancels: nothing is imported.
        /// </summary>
        private bool ChooseTemplateValues(string json, out Dictionary<string, string> values)
        {
            values = new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase);
            foreach (LocalSchemaPlaceholder placeholder in LocalSchemaEditing.LibraryPlaceholders(_file, json))
            {
                string value = placeholder.Values[0];
                if (placeholder.Values.Count > 1)
                {
                    value = PromptChoice(this, Tr(2029), TrFormat(2030, "{" + placeholder.Name + "}"), placeholder.Values);
                    if (value == null)
                        return false;
                }
                values[placeholder.Name] = value;
            }
            return true;
        }

        /// <summary>Why a request failed: its message and, when it says more, the one of its innermost cause.</summary>
        private static string ErrorReason(Exception ex)
        {
            Exception inner = ex;
            while (inner.InnerException != null)
                inner = inner.InnerException;
            return inner == ex || inner.Message == ex.Message ? ex.Message : ex.Message + " (" + inner.Message + ")";
        }

        /// <summary>
        /// A subschema just imported, from a file or from the library: selected and unsaved, as one added here
        /// (after saving, the copilot is left on it), saying what came in (and the values of the templates that named
        /// its tables) and what the database does not have.
        /// </summary>
        private void ShowImported(LocalSchemaImportResult result, string title)
        {
            // None of its tables is in this database: nothing was created, and the user is told it does not match
            if (result.Subschema == null)
            {
                MessageBox.Show(this, TrFormat(1993, result.Name), title, MessageBoxButtons.OK, MessageBoxIcon.Warning);
                return;
            }
            _added = result.Subschema;
            StructureChanged();
            FillAll(result.Subschema);
            _tabs.SelectedTab = _tabTables;
            string done = TrFormat(1936, result.Subschema.Name, Number(result.Subschema.Tables.Count));
            SetStatus(done);
            string message = done;
            // The names of its tables were templates: the values that made them
            if (result.TemplateValues.Count > 0)
                message += Environment.NewLine + TrFormat(2031, LocalSchemaEditing.TemplateValuesText(result.TemplateValues));
            if (result.Skipped.Count > 0)
                message += Environment.NewLine + Environment.NewLine + TrFormat(1937, LocalSchemaEditing.ShortList(result.Skipped, 12));
            MessageBox.Show(this, message, title, MessageBoxButtons.OK,
                result.Skipped.Count > 0 ? MessageBoxIcon.Warning : MessageBoxIcon.Information);
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

        /// <summary>One of a list of values, the first one selected; null when cancelled.</summary>
        private static string PromptChoice(IWin32Window owner, string title, string text, IList<string> values)
        {
            using (var form = new Form())
            {
                form.Text = title;
                form.FormBorderStyle = FormBorderStyle.FixedDialog;
                form.StartPosition = FormStartPosition.CenterParent;
                form.MinimizeBox = false;
                form.MaximizeBox = false;
                form.ShowInTaskbar = false;
                form.ShowIcon = false;
                form.AutoScaleMode = AutoScaleMode.Font;
                form.Font = new Font("Segoe UI", 9f);
                form.ClientSize = new Size(400, 260);
                var layout = new TableLayoutPanel { Dock = DockStyle.Fill, ColumnCount = 1, RowCount = 3, Padding = new Padding(12, 10, 12, 10) };
                layout.RowStyles.Add(new RowStyle(SizeType.AutoSize));
                layout.RowStyles.Add(new RowStyle(SizeType.Percent, 100f));
                layout.RowStyles.Add(new RowStyle(SizeType.AutoSize));
                // The text wraps in the width of the dialog
                var lbl = new Label { Text = text, AutoSize = true, MaximumSize = new Size(376, 0), Margin = new Padding(0, 0, 0, 8) };
                var list = new ListBox { Dock = DockStyle.Fill, IntegralHeight = false };
                foreach (string value in values)
                    list.Items.Add(value);
                if (list.Items.Count > 0)
                    list.SelectedIndex = 0;
                var buttons = new FlowLayoutPanel
                {
                    Dock = DockStyle.Fill,
                    FlowDirection = FlowDirection.RightToLeft,
                    WrapContents = false,
                    AutoSize = true,
                    AutoSizeMode = AutoSizeMode.GrowAndShrink,
                    Margin = new Padding(0, 8, 0, 0)
                };
                var cancel = new Button { Text = Tr(94), DialogResult = DialogResult.Cancel, Width = 75 };
                var ok = new Button { Text = Tr(93), DialogResult = DialogResult.OK, Width = 75 };
                buttons.Controls.Add(cancel);
                buttons.Controls.Add(ok);
                // A double click takes the value
                list.DoubleClick += (s, e) =>
                {
                    if (list.SelectedIndex >= 0)
                        form.DialogResult = DialogResult.OK;
                };
                layout.Controls.Add(lbl, 0, 0);
                layout.Controls.Add(list, 0, 1);
                layout.Controls.Add(buttons, 0, 2);
                form.Controls.Add(layout);
                form.AcceptButton = ok;
                form.CancelButton = cancel;
                form.ActiveControl = list;
                if (form.ShowDialog(owner) != DialogResult.OK || list.SelectedIndex < 0)
                    return null;
                return (string)list.SelectedItem;
            }
        }
    }
}
