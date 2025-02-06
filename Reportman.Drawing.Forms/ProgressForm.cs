using System;
using System.Threading;
using System.Threading.Tasks;
using System.Windows.Forms;

namespace Reportman.Drawing.Forms
{
    public partial class ProgressForm : Form, ProgressForm.ITaskProgressShow
    {
        private Task TaskToExecute;
        private CancellationTokenSource CancelSource;
        TaskCompletionSource<bool> TaskCompletionSource = new TaskCompletionSource<bool>();
        public ProgressForm()
        {
            InitializeComponent();
        }

        private void ProgressForm_Load(object sender, EventArgs e)
        {
        }
        public static async Task Show(Task ntask, Action FinishCallBack, Control parent, CancellationTokenSource cancelSource, SetProgressCallback callback)
        {
            ProgressForm nform = new ProgressForm();
            nform.CancelSource = cancelSource;
            bool shown = false;
            if (callback != null)
            {
                callback(nform);
            }
            _ = Task.Run(() =>
              {
                  nform.TaskToExecute = ntask;
                  ntask.ContinueWith((tarea) =>
                  {
                      if (FinishCallBack != null)
                      {
                          if (nform.InvokeRequired)
                          {
                              nform.Invoke(FinishCallBack, null);

                          }
                          else
                              FinishCallBack();
                      }
                      nform.TaskCompletionSource.SetResult(true);
                  });
                  shown = true;
                  if (parent.InvokeRequired)
                  {
                      parent.Invoke(new Action(() =>
                      {
                          nform.ShowDialog(parent);
                      }), null);
                  }
                  else
                  {
                      nform.ShowDialog(parent);
                  }
              });
            await nform.TaskCompletionSource.Task;
            nform.Invoke(new Action(() =>
            {
                if (shown)
                {
                    nform.Close();
                }
            }), null);
        }
        public delegate void SetProgressCallback(ITaskProgressShow taskProgressObject);


        private void bcancel_Click(object sender, EventArgs e)
        {
            if (CancelSource != null)
            {
                CancelSource.Cancel();
            }
        }
        public void ShowProgress(int current, int total)
        {
            if (total == 0)
            {
                progressBar1.Value = 0;
                progressBar1.Maximum = 0;
                progressBar1.Style = ProgressBarStyle.Marquee;
            }
            else
            {
                progressBar1.Value = 0;
                progressBar1.Maximum = total;
                progressBar1.Value = current;
                progressBar1.Style = ProgressBarStyle.Continuous;
            }
        }
        public interface ITaskProgressShow
        {
            void ShowProgress(int current, int total);
        }
    }
}
