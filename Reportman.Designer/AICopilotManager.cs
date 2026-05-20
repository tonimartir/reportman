using System;
using System.Windows.Forms;

namespace Reportman.Designer
{
    public class AICopilotManager
    {
        private static AICopilotManager _instance;
        public static AICopilotManager Instance => _instance ?? (_instance = new AICopilotManager());
        
        private bool _isThinking;
        
        public bool IsThinking => _isThinking;
        
        public event EventHandler ThinkingStateChanged;
        
        // This simulates a cancellation token or mechanism that the active inference can hook into
        public Action OnCancelRequested;

        private AICopilotManager()
        {
        }

        public void BeginInference()
        {
            _isThinking = true;
            ThinkingStateChanged?.Invoke(this, EventArgs.Empty);
        }

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
