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
        /// <summary>
        /// Initializes a new instance of the <see cref="DataProgress"/> dialog and its
        /// designer-generated controls.
        /// </summary>
        public DataProgress()
        {
            InitializeComponent();
        }
        /// <summary>
        /// Creates a <see cref="DataProgress"/> dialog, wires the specified callback, and
        /// shows the dialog modally so the operation runs with visual progress feedback.
        /// </summary>
        /// <param name="OnExecute">The callback that performs the data operation.</param>
        public static void ExecuteProgress(DataProgressEventHandler OnExecute)
        {
            DataProgress ndia = new DataProgress();
            ndia.OnExecute = OnExecute;
            ndia.timerexecute.Enabled = true;
            ndia.ShowDialog();
        }
        /// <summary>
        /// Updates the progress bar and label with the current record count, processes
        /// pending Windows messages, and reports whether the user has requested cancellation.
        /// </summary>
        /// <param name="sender">The source of the progress event.</param>
        /// <param name="records">The number of records processed so far.</param>
        /// <param name="count">The total number of records to process.</param>
        /// <param name="docancel">Set to <c>true</c> on return when the user clicked the cancel button.</param>
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
