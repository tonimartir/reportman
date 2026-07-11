using Reportman.Drawing;
using Reportman.Reporting;
using System;
using System.Windows.Forms;

namespace Reportman.Designer
{
    /// <summary>
    /// Dialog that lets the user pick a configured report library from a combo box
    /// and then choose a report from it, returning the selection along with the
    /// loaded report stream.
    /// </summary>
    public partial class OpenFromLibraryForm : Form
    {
        ReportLibraryConfigCollection libs;
        OpenFromLibrary.SelectionModeType SelectionType = OpenFromLibrary.SelectionModeType.Selection;
        /// <summary>
        /// Initializes a new instance of the <see cref="OpenFromLibraryForm"/> dialog,
        /// creating its designer-generated controls, applying translated captions, and
        /// wiring the accept/cancel events of the embedded library browser.
        /// </summary>
        public OpenFromLibraryForm()
        {
            InitializeComponent();

            Text = Translator.TranslateStr(1135);
            LabelLibrary.Text = Translator.TranslateStr(1140);
            openFromLibrary1.Visible = false;
            openFromLibrary1.OnAccept += OnAccept;
            openFromLibrary1.OnCancel += OnCancel;

        }
        ReportLibrarySelection ReportSelection;
        /// <summary>
        /// Handles the cancel event from the embedded library browser by clearing the
        /// current selection and closing the dialog with <see cref="DialogResult.Cancel"/>.
        /// </summary>
        /// <param name="sender">The source of the event.</param>
        /// <param name="args">The event data.</param>
        public void OnCancel(object sender, EventArgs args)
        {
            ReportSelection = null;
            DialogResult = DialogResult.Cancel;
        }
        /// <summary>
        /// Handles the accept event from the embedded library browser by reading the
        /// selected report name and its stream from the chosen library, building a
        /// <see cref="ReportLibrarySelection"/>, and closing the dialog with
        /// <see cref="DialogResult.OK"/>.
        /// </summary>
        /// <param name="sender">The source of the event.</param>
        /// <param name="args">The event data.</param>
        public void OnAccept(object sender, EventArgs args)
        {
            string ReportName = openFromLibrary1.GetSelectedReport();
            if (ReportName.Length == 0)
            {
                throw new Exception(Translator.TranslateStr(357));
            }
            ReportLibrarySelection selection = new ReportLibrarySelection();
            selection.ReportLibrary = (ReportLibraryConfig)comboLibrary.Items[comboLibrary.SelectedIndex];
            selection.ReportName = openFromLibrary1.GetSelectedReport();
            selection.Stream = selection.ReportLibrary.ReadReport(selection.ReportName);
            ReportSelection = selection;
            DialogResult = DialogResult.OK;
        }
        /// <summary>
        /// Displays the library-selection dialog modally, letting the user pick a library
        /// and a report from it, and returns the resulting selection.
        /// </summary>
        /// <param name="libs">The collection of configured report libraries to show.</param>
        /// <param name="SelectionType">The selection mode that determines available library-browser actions.</param>
        /// <param name="parent">The parent window that owns this dialog.</param>
        /// <returns>A <see cref="ReportLibrarySelection"/> with the chosen library and report stream, or <c>null</c> if the user cancelled.</returns>
        public static ReportLibrarySelection SelectReportFromLibraries(ReportLibraryConfigCollection libs,
              OpenFromLibrary.SelectionModeType SelectionType, IWin32Window parent)
        {
            using (OpenFromLibraryForm dia = new OpenFromLibraryForm())
            {
                dia.SelectionType = SelectionType;
                dia.libs = libs;
                dia.ShowDialog(parent);
                return dia.ReportSelection;
            }
        }

        private void bcancel_Click(object sender, EventArgs e)
        {
            DialogResult = DialogResult.Cancel;
        }

        private void OpenFromLibraryForm_Load(object sender, EventArgs e)
        {
            foreach (var lib in libs)
            {
                comboLibrary.Items.Add(lib);
            }
            if (libs.Count > 0)
                comboLibrary.SelectedIndex = 0;
        }

        private void comboLibrary_SelectedIndexChanged(object sender, EventArgs e)
        {
            if (comboLibrary.SelectedIndex < 0)
                openFromLibrary1.Visible = false;
            try
            {
                ReportLibraryConfig selected = (ReportLibraryConfig)comboLibrary.Items[comboLibrary.SelectedIndex];
                var factory = selected.GetFactory();
                if (selected.CurrentConnection == null)
                {
                    System.Data.Common.DbConnection connection = factory.CreateConnection();
                    connection.ConnectionString = selected.ADOConnectionString;
                    connection.Open();
                    selected.CurrentConnection = connection;
                }
                DbSqlExecuter executer = new DbSqlExecuter(selected.CurrentConnection, factory);
                openFromLibrary1.Init(executer, selected, OpenFromLibrary.SelectionModeType.SelectionEdit);
                openFromLibrary1.Visible = true;
            }
            catch
            {
                openFromLibrary1.Visible = false;
                throw;
            }
        }

        private void openFromLibrary1_Load(object sender, EventArgs e)
        {
            if (!openFromLibrary1.Visible)
                return;
            string selectedReport = openFromLibrary1.GetSelectedReport();
            if (selectedReport.Length > 0)
            {
                DialogResult = DialogResult.OK;
            }
        }

        private void OpenFromLibraryForm_FormClosed(object sender, FormClosedEventArgs e)
        {
            try
            {
                foreach (var lib in libs)
                {
                    if (lib.CurrentConnection != null)
                        lib.CurrentConnection.Close();
                }
            }
            catch
            {

            }
        }
    }
}
