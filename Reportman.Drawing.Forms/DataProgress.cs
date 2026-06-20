using System;
using System.Windows.Forms;

namespace Reportman.Reporting.Forms
{
    /// <summary>
    /// Callback executed by the <see cref="DataProgress"/> dialog to run the long-running data operation
    /// whose progress the dialog displays.
    /// </summary>
    public delegate void DataProgressEventHandler(object sender, DataProgress nform);
    /// <summary>
    /// Modal Windows Forms dialog that runs a data operation and shows record-count progress,
    /// allowing the user to cancel it.
    /// </summary>
    public partial class DataProgress : Form
    {
        bool cancelled;
        DataProgressEventHandler OnExecute;
        public DataProgress()
        {
            InitializeComponent();
        }
        public static void ExecuteProgress(DataProgressEventHandler OnExecute)
        {
            DataProgress ndia = new DataProgress();
            ndia.OnExecute = OnExecute;
            ndia.timerexecute.Enabled = true;
            ndia.ShowDialog();
        }
        public void ShowProgress(object sender, int records, int count, ref bool docancel)
        {
            lprogress.Text = "Records: " + records.ToString("##,##") + " of " + count.ToString("###,##");
            if (progbar.Value > count)
                progbar.Value = count;
            progbar.Maximum = count;
            progbar.Value = records;
            Application.DoEvents();
            docancel = cancelled;

        }
        private void timerexecute_Tick(object sender, EventArgs e)
        {
            timerexecute.Enabled = false;
            try
            {
                OnExecute(this, this);
            }
            finally
            {
                Close();
            }
        }

        private void bcancel_Click(object sender, EventArgs e)
        {
            cancelled = true;
        }
    }
}
