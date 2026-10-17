using System;
using System.Windows.Forms;

namespace Reportman.Designer
{
    /// <summary>
    /// Top-level window of the Reportman designer application; hosts the main designer frame,
    /// opens a report passed on the command line, and prompts to save unsaved changes on close.
    /// </summary>
    public partial class MainForm : Form
    {
        /// <summary>
        /// The main designer frame control hosted inside this form.
        /// </summary>
        public FrameMainDesigner maindesigner;
        /// <summary>
        /// Initializes a new instance of the MainForm class, embedding and docking the main designer frame.
        /// </summary>
        public MainForm()
        {
            InitializeComponent();
            Text = DesignerText.Tr(1);
            // The designer starts maximized, as the Delphi one
            WindowState = FormWindowState.Maximized;

            maindesigner = new FrameMainDesigner();
            maindesigner.Dock = DockStyle.Fill;
            this.Controls.Add(maindesigner);
            Shown += MainForm_Shown;
        }

        private void MainForm_Load(object sender, EventArgs e)
        {
            // The local schema of the samples for the copilot, on a computer that does not have it
            // yet: before a report opens, so that its copilot lists the subschemas
            SampleReports.InstallSchema();
            // Browse the command line
            string[] args = System.Environment.GetCommandLineArgs();
            if (args.Length > 1)
                maindesigner.OpenFile(args[1]);
        }

        // Without a report on the command line, the welcome window with the sample reports, once the
        // main window is painted (unless the user hid it)
        private void MainForm_Shown(object sender, EventArgs e)
        {
            if (System.Environment.GetCommandLineArgs().Length > 1)
                return;
            BeginInvoke(new Action(() => maindesigner.ShowWelcome(true)));
        }

        private void MainForm_FormClosing(object sender, FormClosingEventArgs e)
        {
            // A designer closed with its exit button already asked
            if (maindesigner != null && maindesigner.Parent != null)
            {
                e.Cancel = !maindesigner.CheckSave();
            }
        }
    }
}