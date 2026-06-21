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
        public FrameMainDesigner maindesigner;
        public MainForm()
        {
            InitializeComponent();

            maindesigner = new FrameMainDesigner();
            maindesigner.Dock = DockStyle.Fill;
            this.Controls.Add(maindesigner);
        }

        private void MainForm_Load(object sender, EventArgs e)
        {
            // Browse the command line
            string[] args = System.Environment.GetCommandLineArgs();
            if (args.Length > 1)
                maindesigner.OpenFile(args[1]);
        }

        private void MainForm_FormClosing(object sender, FormClosingEventArgs e)
        {
            if (maindesigner != null)
            {
                e.Cancel = !maindesigner.CheckSave();
            }
        }
    }
}