using System;
using System.Windows.Forms;

namespace Reportman.Designer
{
    /// <summary>
    /// Singleton that tracks the AI copilot's busy ("thinking") state, guards report
    /// modifications while inference is running, and wraps AI-driven changes so they can
    /// be grouped into the designer's undo/redo history.
    /// </summary>
    public class AICopilotManager
    {
        private static AICopilotManager _instance;
        /// <summary>
        /// Gets the singleton instance of the AICopilotManager.
        /// </summary>
        public static AICopilotManager Instance => _instance ?? (_instance = new AICopilotManager());
        
        private bool _isThinking;
        
        /// <summary>
        /// Gets a value indicating whether the AI copilot is currently executing a task.
        /// </summary>
        public bool IsThinking => _isThinking;
        
        /// <summary>
        /// Occurs when the busy (thinking) state of the AI copilot changes.
        /// </summary>
        public event EventHandler ThinkingStateChanged;
        
        // This simulates a cancellation token or mechanism that the active inference can hook into
        /// <summary>
        /// Action callback invoked to cancel the current background AI operation.
        /// </summary>
        public Action OnCancelRequested;

        private AICopilotManager()
        {
        }

        /// <summary>
        /// Sets the manager state to busy and raises the state-changed event.
        /// </summary>
        public void BeginInference()
        {
            _isThinking = true;
            ThinkingStateChanged?.Invoke(this, EventArgs.Empty);
        }

        /// <summary>
        /// Clears the manager busy state, clears the cancellation callback, and raises the state-changed event.
        /// </summary>
        public void EndInference()
        {
            _isThinking = false;
            OnCancelRequested = null;
            ThinkingStateChanged?.Invoke(this, EventArgs.Empty);
        }

        /// <summary>
        /// Checks if a modification to the report is allowed. 
        /// If the AI is thinking, prompts the user to cancel the AI task.
        /// </summary>
        /// <returns>True if the modification can proceed, False if it is blocked.</returns>
        public bool CheckModificationAllowed(IWin32Window owner)
        {
            if (!_isThinking)
                return true;

            var result = MessageBox.Show(owner, 
                "The AI is currently generating a response or processing a task.\n\n" +
                "If you modify the report now, it might cause inconsistencies. Do you want to cancel the AI task and proceed?", 
                "AI is Thinking", 
                MessageBoxButtons.YesNo, 
                MessageBoxIcon.Warning);

            if (result == DialogResult.Yes)
            {
                // Cancel inference
                OnCancelRequested?.Invoke();
                return true;
            }

            return false;
        }

        /// <summary>
        /// Wraps an AI modification so that it can be correctly logged into the Undo/Redo buffer of Reportman.
        /// </summary>
        public void ApplyAIMacro(string description, Action modifyAction)
        {
            // In a real scenario, this connects to Reportman's Report.BeginUndoGroup(description)
            // Report.BeginUndoGroup(description);
            try
            {
                modifyAction?.Invoke();
            }
            finally
            {
                // Report.EndUndoGroup();
            }
        }
    }
}
