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
        /// <summary>
        /// Gets or sets a value indicating whether the long-running operation should be cancelled.
        /// Defaults to <see langword="true"/>; set to <see langword="false"/> to allow the operation to continue.
        /// </summary>
        public bool Cancel;
        /// <summary>
        /// Gets the number of items processed so far in the current operation.
        /// </summary>
        public long Count
        {
            get
            {
                return fcount;
            }
        }
        /// <summary>
        /// Gets the total number of items expected to be processed in the current operation.
        /// </summary>
        public long Total
        {
            get
            {
                return ftotal;
            }
        }
        /// <summary>
        /// Initializes a new instance of the <see cref="ProgressArgs"/> class with the specified
        /// current count and total, and <see cref="Cancel"/> set to <see langword="true"/>.
        /// </summary>
        /// <param name="ncount">The number of items processed so far.</param>
        /// <param name="ntotal">The total number of items to process.</param>
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
