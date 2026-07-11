using System;
using System.ComponentModel;
using System.Windows.Forms;

namespace Reportman.Designer
{
    /// <summary>
    /// Callback raised when the ellipsis button of an <see cref="EllipsisEditingControl"/> is clicked;
    /// the handler may replace <paramref name="text"/> and returns true if the value was changed.
    /// </summary>
    public delegate bool EllipsisClick(EllipsisEditingControl sender, ref string text);
    /// <summary>
    /// A DataGridView in-cell editing control that pairs a text box with an ellipsis button,
    /// letting the user edit a cell value directly or open an external picker via the button.
    /// </summary>
    public partial class EllipsisEditingControl : UserControl, IDataGridViewEditingControl
    {
        /// <summary>
        /// The <see cref="DataGridView"/> that owns this editing control.
        /// </summary>
        public DataGridView m_dataGridView = null;
        int m_rowIndex = 0;
        bool m_valueChanged = false;
        string m_prevText = null;
        /// <summary>
        /// Arbitrary caller-supplied data associated with this editing control.
        /// </summary>
        public object Data;
        /// <summary>
        /// Raised when the ellipsis button is clicked, letting a handler change the cell text.
        /// </summary>
        public event EllipsisClick ButtonClick;
        /// <summary>
        /// Indicates whether a <see cref="ButtonClick"/> handler has been assigned to this control.
        /// </summary>
        public bool AssignedEvent = false;
        /// <summary>
        /// Gets or sets the text shown in the editing control's text box.
        /// </summary>
        [DesignerSerializationVisibility(DesignerSerializationVisibility.Hidden), Browsable(false)]
        public override string Text
        {
            get
            {
                return textcontrol.Text;
            }
            set
            {
                textcontrol.Text = value;
            }
        }
        /// <summary>
        /// Initializes a new instance of the <see cref="EllipsisEditingControl"/> class and wires up its text box events.
        /// </summary>
        public EllipsisEditingControl()
        {
            InitializeComponent();
            this.textcontrol.LostFocus += new EventHandler(filePathTextBox_LostFocus);
            this.textcontrol.TextChanged += new EventHandler(nvaluechange);
        }
        private void nvaluechange(object sender, EventArgs ev)
        {
            NotifyChange();
        }
        void filePathTextBox_LostFocus(object sender, EventArgs e)
        {
            NotifyChange();
        }

        private void browseButton_Click(object sender, EventArgs e)
        {
            bool aresult = false;
            string ntext = this.textcontrol.Text;
            if (ButtonClick != null)
            {
                aresult = ButtonClick(this, ref ntext);
            }
            if (aresult)
            {
                this.textcontrol.Text = ntext;
                NotifyChange();
            }
        }

        private void NotifyChange()
        {
            if (this.textcontrol.Text != m_prevText)
            {
                m_valueChanged = true;
                m_dataGridView.NotifyCurrentCellDirty(true);
            }
        }

        #region IDataGridViewEditingControl Members

        /// <summary>
        /// Applies the given cell style to the editing control. This implementation does nothing.
        /// </summary>
        /// <param name="dataGridViewCellStyle">The cell style that would be applied.</param>
        public void ApplyCellStyleToEditingControl(DataGridViewCellStyle dataGridViewCellStyle)
        {
            // Do nothing
        }

        /// <summary>
        /// Gets the cursor shown when the mouse is over the editing control (an I-beam).
        /// </summary>
        public Cursor EditingControlCursor
        {
            get
            {
                return Cursors.IBeam;
            }
        }


        /// <summary>
        /// Gets the cursor used for the editing panel (an I-beam).
        /// </summary>
        public Cursor EditingPanelCursor
        {
            get
            {
                return Cursors.IBeam;
            }
        }
        /// <summary>
        /// Gets or sets the <see cref="DataGridView"/> that contains the cell being edited.
        /// </summary>
        [DesignerSerializationVisibility(DesignerSerializationVisibility.Hidden), Browsable(false)]
        public DataGridView EditingControlDataGridView
        {
            get
            {
                return m_dataGridView;
            }
            set
            {
                m_dataGridView = value;
            }
        }
        /// <summary>
        /// Gets or sets the formatted value of the cell being edited (the text box contents).
        /// </summary>
        [DesignerSerializationVisibility(DesignerSerializationVisibility.Hidden), Browsable(false)]
        public object EditingControlFormattedValue
        {
            get
            {
                return this.textcontrol.Text;
            }
            set
            {
                this.textcontrol.Text = value.ToString();
            }
        }
        /// <summary>
        /// Gets or sets the index of the owning cell's row.
        /// </summary>
        [DesignerSerializationVisibility(DesignerSerializationVisibility.Hidden), Browsable(false)]
        public int EditingControlRowIndex
        {
            get
            {
                return m_rowIndex;
            }
            set
            {
                m_rowIndex = value;
            }
        }
        /// <summary>
        /// Gets or sets a value indicating whether the value of the editing control has changed.
        /// </summary>
        [DesignerSerializationVisibility(DesignerSerializationVisibility.Hidden), Browsable(false)]
        public bool EditingControlValueChanged
        {
            get
            {
                return m_valueChanged;
            }
            set
            {
                m_valueChanged = value;
            }
        }

        /// <summary>
        /// Determines whether the specified key should be handled by the editing control rather than the grid.
        /// </summary>
        /// <param name="keyData">The key that was pressed.</param>
        /// <param name="dataGridViewWantsInputKey">true if the grid wants to process the key; otherwise, false.</param>
        /// <returns>true if the editing control should process the key; otherwise, false.</returns>
        public bool EditingControlWantsInputKey(Keys keyData, bool dataGridViewWantsInputKey)
        {
            switch (keyData)
            {
                case Keys.Tab:
                    return true;
                case Keys.Home:
                case Keys.End:
                case Keys.Left:
                    if (this.textcontrol.SelectionLength == this.textcontrol.Text.Length)
                        return false;
                    else
                        return true;
                case Keys.Right:
                    return true;
                case Keys.Delete:
                    this.textcontrol.Text = "";
                    return true;
                case Keys.Enter:
                    NotifyChange();
                    return false;
                default:
                    return false;
            }
        }

        /// <summary>
        /// Retrieves the formatted value of the editing control for the given error context.
        /// </summary>
        /// <param name="context">The context in which the value is requested.</param>
        /// <returns>The current text of the editing control.</returns>
        public object GetEditingControlFormattedValue(DataGridViewDataErrorContexts context)
        {
            return this.textcontrol.Text;
        }

        /// <summary>
        /// Prepares the editing control for editing by loading the current cell value and optionally selecting all text.
        /// </summary>
        /// <param name="selectAll">true to select all of the control's contents; otherwise, false.</param>
        public void PrepareEditingControlForEdit(bool selectAll)
        {
            if (this.m_dataGridView.CurrentCell.Value == null)
                this.textcontrol.Text = "";
            else
                this.textcontrol.Text = this.m_dataGridView.CurrentCell.Value.ToString();
            if (selectAll)
                this.textcontrol.SelectAll();
            m_prevText = this.textcontrol.Text;
        }

        /// <summary>
        /// Gets a value indicating whether the control should be repositioned when its value changes. Always false.
        /// </summary>
        public bool RepositionEditingControlOnValueChange
        {
            get
            {
                return false;
            }
        }

        #endregion

    }
}
