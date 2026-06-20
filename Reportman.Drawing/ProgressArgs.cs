namespace Reportman.Drawing
{
    /// <summary>
    /// Event arguments reporting progress of a long-running operation, exposing the current
    /// count and total and allowing the handler to request cancellation.
    /// </summary>
    public class ProgressArgs
    {
        private long fcount;
        private long ftotal;
        public bool Cancel;
        public long Count
        {
            get
            {
                return fcount;
            }
        }
        public long Total
        {
            get
            {
                return ftotal;
            }
        }
        public ProgressArgs(long ncount, long ntotal)
        {
            fcount = ncount;
            ftotal = ntotal;
            Cancel = true;
        }
    }
    /// <summary>
    /// Callback invoked to report progress of a long-running operation; handlers may set
    /// <see cref="ProgressArgs.Cancel"/> to request that the operation stop.
    /// </summary>
    public delegate void ProgressEvent(object sender, ProgressArgs args);

}
