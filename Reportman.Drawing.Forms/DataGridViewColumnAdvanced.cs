using System;
using System.Collections.Generic;
using System.ComponentModel;
using System.Drawing;
using System.Windows.Forms;

namespace Reportman.Drawing.Forms
{
    /// <summary>
    /// Callback raised before a tab page is entered, allowing a handler to veto the change by setting <c>cancel</c> to true.
    /// </summary>
    public delegate void BeforeEnterTabEvent(ref bool cancel);
    /// <summary>
    /// Identifies the kind of value a grid column edits, selecting the appropriate editor and formatting (text, numeric, date/time, boolean, combo box or password).
    /// </summary>
    public enum ColumnDataType
    {
        /// <summary>Free-form text value.</summary>
        Text,
        /// <summary>Whole-number integer value.</summary>
        Integer,
        /// <summary>Fixed-point numeric (decimal) value.</summary>
        Numeric,
        /// <summary>Floating-point value.</summary>
        Double,
        /// <summary>Date-only value.</summary>
        Date,
        /// <summary>Combined date and time value.</summary>
        DateTime,
        /// <summary>Time-of-day value.</summary>
        Time,
        /// <summary>Editable combo box selection.</summary>
        ComboBox,
        /// <summary>Non-editable drop-down list selection.</summary>
        ComboBoxList,
        /// <summary>Boolean (true/false) value.</summary>
        Boolean,
        /// <summary>Text value displayed masked as a password.</summary>
        Password
    };
    /// <summary>
    /// Callback invoked when a column's editor button is clicked; returns true if it changed <c>value</c> so the cell should be updated.
    /// </summary>
    public delegate bool DataColumnButtonClickEvent(DataGridViewColumn ncolumn, ref object value);
    /// <summary>
    /// A DataGridView column with extended editing behavior: typed input (<see cref="ColumnDataType"/>), maximum input length, an optional image button, and a pluggable search window.
    /// </summary>
    public class DataGridViewColumnAdvanced : DataGridViewColumn
    {
        private ColumnDataType FDataType;
        private int FMaxInputLength;
        private Image FImageButton;
        /// <summary>
        /// Handler invoked when the column's image button is clicked; it may change the cell value.
        /// </summary>
        public DataColumnButtonClickEvent ButtonClick;
        /// <summary>
        /// Scale factor applied to the image button when it is drawn.
        /// </summary>
        public float ImageButtonScale = 1.0f;
        /// <summary>
        /// Gets or sets the kind of value this column edits, which selects the editor and formatting.
        /// </summary>
        [DesignerSerializationVisibility(DesignerSerializationVisibility.Visible)]
        public ColumnDataType DataType
        {
            get
            {
                return FDataType;
            }
            set
            {
                FDataType = value;
            }
        }
        bool FReadOnlyInput;
        /// <summary>
        /// Gets or sets whether text input in this column's editor is read-only.
        /// </summary>
        [DesignerSerializationVisibility(DesignerSerializationVisibility.Visible)]

        public bool ReadOnlyInput
        {
            get { return FReadOnlyInput; }
            set
            {
                FReadOnlyInput = value;

            }
        }
        /// <summary>
        /// Optional search/lookup window attached to this column's editor.
        /// </summary>
        public ISearchWindow SearchWindow;
        /// <summary>
        /// Gets or sets the maximum number of characters allowed in the editor; negative values are clamped to zero.
        /// </summary>
        [DesignerSerializationVisibility(DesignerSerializationVisibility.Visible)]

        public int MaxInputLength
        {
            get
            {
                return FMaxInputLength;
            }
            set
            {
                FMaxInputLength = value;
                if (FMaxInputLength < 0)
                    FMaxInputLength = 0;
            }

        }
        /// <summary>
        /// Gets the width, in pixels, reserved for a column's image button, scaled to the current display DPI.
        /// </summary>
        public static int ImageWidth
        {
            get
            {
                return Convert.ToInt32(20 * Reportman.Drawing.Windows.GraphicUtils.DPIScaleY);
            }
        }
        /// <summary>
        /// Gets or sets the image shown on the in-cell button, or null for no button.
        /// </summary>
        [DesignerSerializationVisibility(DesignerSerializationVisibility.Visible)]
        public Image ImageButton
        {
            get { return FImageButton; }
            set
            {
                FImageButton = value;
            }
        }
        /// <summary>
        /// Initializes a new column that uses a <see cref="DataGridViewCellAdvanced"/> cell template and the text data type.
        /// </summary>
        public DataGridViewColumnAdvanced()
            : base(new DataGridViewCellAdvanced())
        {
            FDataType = ColumnDataType.Text;

        }

        /// <summary>
        /// Returns the preferred width of the column for the given auto-size mode.
        /// </summary>
        public override int GetPreferredWidth(DataGridViewAutoSizeColumnMode autoSizeColumnMode, bool fixedHeight)
        {
            int nwidth = base.GetPreferredWidth(autoSizeColumnMode, fixedHeight); ;
            return nwidth;
        }
        /// <summary>
        /// Gets or sets the template used to create the cells of this column.
        /// </summary>
        [DesignerSerializationVisibility(DesignerSerializationVisibility.Visible)]
        public override DataGridViewCell CellTemplate
        {
            get
            {
                return base.CellTemplate;
            }
            set
            {
                base.CellTemplate = value;
            }
        }
    }

    /// <summary>
    /// The cell type used by <see cref="DataGridViewColumnAdvanced"/>; hosts the <see cref="AdvancedEditingControl"/> editor and masks password-typed values when displaying.
    /// </summary>
    public class DataGridViewCellAdvanced : DataGridViewTextBoxCell
    {
        //DataGridViewComboBoxEditingControl ComboBoxPicker;
        //        CheckBoxPickerControl CheckBoxPicker;
        //DataGridViewTextBoxEditingControl TextBoxPicker;
        //EllipsisEditingControl EllipsisPicker;
        //ColorPickerControl ColorPickerc;
        //NumericUpDownPickerControl NumericPicker;
        //private EventHandler ButtonClicEvent;
        //private EventHandler ClickFontStyleEvent;
        /// <summary>
        /// Initializes a new advanced grid cell.
        /// </summary>
        public DataGridViewCellAdvanced()
            : base()
        {
            //ButtonClicEvent = new EventHandler(ButtonClick);
        }
        private void ButtonClick(object sender, EventArgs args)
        {
            /*            DataGridViewColumn col = GetColumn();
                        if (!(col is DataGridViewColumnAdvanced))
                            return;
                        DataGridViewColumnAdvanced ncolumn = (DataGridViewColumnAdvanced)GetColumn();
                        if (ncolumn.ButtonClick != null)
                            ncolumn.ButtonClick(ncolumn, new DataGridViewColumnEventArgs(ncolumn),);*/
        }
        private DataGridViewColumn GetColumn()
        {
            DataGridViewColumn ncol = null;
            if (DataGridView != null)
            {
                ncol = DataGridView.Columns[ColumnIndex];
            }
            return ncol;
        }
        /// <summary>
        /// Gets the type of the editing control (<see cref="AdvancedEditingControl"/>) hosted when the cell is edited.
        /// </summary>
        public override Type EditType
        {
            get
            {
                Type ntype = typeof(AdvancedEditingControl);
                //Return the type of the editing contol that ComboBox uses.
                /*                if (DataGridView != null)
                                {
                                    ObjectInspectorCellType celltype = (ObjectInspectorCellType)GetColumnValue("TYPEENUM");
                                    switch (celltype)
                                    {
                                        case ObjectInspectorCellType.Decimal:
                                        case ObjectInspectorCellType.Integer:
                                            ntype = typeof(NumericUpDownPickerControl);
                                            break;
                                        case ObjectInspectorCellType.DropDownList:
                                            ntype = typeof(DataGridViewComboBoxEditingControl);
                                            break;
                                        case ObjectInspectorCellType.Text:
                                        case ObjectInspectorCellType.FontStyle:
                                            ntype = typeof(DataGridViewTextBoxEditingControl);
                                            break;
                                        case ObjectInspectorCellType.Color:
                                            ntype = typeof(ColorPickerControl);
                                            break;
                                        case ObjectInspectorCellType.Boolean:
                                            ntype = typeof(CheckBoxPickerControl);
                                            break;
                                        case ObjectInspectorCellType.FontName:
                                            ntype = typeof(EllipsisEditingControl);
                                            break;
                                    }
                                }*/
                return ntype;
            }
        }
        /// <summary>
        /// Paints the cell using the base text-box cell rendering.
        /// </summary>
        protected override void Paint(Graphics graphics, Rectangle clipBounds, Rectangle cellBounds, int rowIndex, DataGridViewElementStates cellState, object value, object formattedValue, string errorText, DataGridViewCellStyle cellStyle, DataGridViewAdvancedBorderStyle advancedBorderStyle, DataGridViewPaintParts paintParts)
        {
            base.Paint(graphics, clipBounds, cellBounds, rowIndex, cellState, value, formattedValue, errorText, cellStyle, advancedBorderStyle, paintParts);
        }
        /// <summary>
        /// Returns the display text for the cell, masking the value with bullet characters when the column's data type is <see cref="ColumnDataType.Password"/>.
        /// </summary>
        protected override object GetFormattedValue(object value, int rowIndex, ref DataGridViewCellStyle cellStyle, System.ComponentModel.TypeConverter valueTypeConverter, System.ComponentModel.TypeConverter formattedValueTypeConverter, DataGridViewDataErrorContexts context)
        {
            DataGridViewColumnAdvanced ncol = (DataGridViewColumnAdvanced)GetColumn();
            if (ncol.DataType == ColumnDataType.Password)
            {
                if (value == null)
                    return "";
                else
                    if (value == DBNull.Value)
                    return "";
                else
                        if (value.ToString().Length == 0)
                    return "";
                else
                    return "" + (char)0x25CF + (char)0x25CF + (char)0x25CF + (char)0x25CF + (char)0x25CF + (char)0x25CF;
            }
            else
                return base.GetFormattedValue(value, rowIndex, ref cellStyle, valueTypeConverter, formattedValueTypeConverter, context);
        }

    }
    /// <summary>
    /// The in-cell editing control for <see cref="DataGridViewColumnAdvanced"/>; switches between a text box and date/time pickers depending on the column's <see cref="ColumnDataType"/> and supports an optional image button and search window.
    /// </summary>
    public partial class AdvancedEditingControl : UserControl, IDataGridViewEditingControl
    {
        /// <summary>
        /// Pool of reusable picture-box controls shared across editor instances to avoid repeated allocation.
        /// </summary>
        public static List<PictureBox> CachedPictureBoxControls = new List<PictureBox>();
        private TextBoxAdvanced textcontrol;
        private DateTimePickerNullable datecontrol1;
        private DateTimePickerAdvanced datecontrol2;
        //private DateTimePickerNullable datecontrol2;
        private PictureBox picbo;
        private ColumnDataType controldatatype;
        private ColumnDataType FDataType;
        private bool disabledchange;
        private int FMaxInputLength;
        private bool FReadOnlyInput;
        /// <summary>
        /// Gets or sets whether the hosted text editor is read-only.
        /// </summary>
        [DesignerSerializationVisibility(DesignerSerializationVisibility.Visible)]

        public bool ReadOnlyInput
        {
            get
            {
                return FReadOnlyInput;
            }
            set
            {
                ReadOnlyInput = value;
                UpdateReaonlyInput();
            }
        }
        ISearchWindow SearchWindow;
        /// <summary>
        /// When true, editors use the advanced date/time picker instead of the classic nullable picker.
        /// </summary>
        public static bool NewDatePicker = false;

        /// <summary>
        /// Forwards a key-down event from the hosted control to the editor's key-down handling.
        /// </summary>
        public void DoKeyDown(object sender, KeyEventArgs args)
        {
            OnKeyDown(args);
        }
        /// <summary>
        /// Forwards a key-press event from the hosted control to the editor's key-press handling.
        /// </summary>
        public void DoKeyPress(object sender, KeyPressEventArgs args)
        {
            OnKeyPress(args);
        }
        /// <summary>
        /// Forwards a key-up event from the hosted control to the editor's key-up handling.
        /// </summary>
        public void DoKeyUp(object sender, KeyEventArgs args)
        {
            OnKeyUp(args);
        }
        /// <summary>
        /// Scale factor applied to the image button when it is drawn.
        /// </summary>
        public float ImageButtonScale = 1.0f;
        /// <summary>
        /// Image displayed on the editor's image button.
        /// </summary>
        public Image FImageButton;
        /// <summary>
        /// Gets or sets the image shown on the editor's button.
        /// </summary>
        [DesignerSerializationVisibility(DesignerSerializationVisibility.Visible)]
        public Image ImageButton
        {
            get { return FImageButton; }
            set
            {
                FImageButton = value;
            }

        }
        DataGridView m_dataGridView = null;
        int m_rowIndex = 0;
        bool m_valueChanged = false;
        //string m_prevText = null;
        /// <summary>
        /// The control currently hosting input (a text box or a date/time picker).
        /// </summary>
        public Control MainControl;
        object prevvalue;
        /// <summary>
        /// Gets or sets the text of the hosted text editor.
        /// </summary>
        [DesignerSerializationVisibility(DesignerSerializationVisibility.Visible)]
        public new string Text
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
        /// Initializes a new editing control.
        /// </summary>
        public AdvancedEditingControl()
        {

        }
        private void MValueChange(object sender, EventArgs ev)
        {
            NotifyChange();
        }
        /// <summary>
        /// Notifies the grid of any pending value change so the current edit is committed.
        /// </summary>
        public void SaveCurrentValue()
        {
            NotifyChange();
        }
        void MLostFocus(object sender, EventArgs e)
        {
            NotifyChange();
        }
        void MDoubleClick(object sender, EventArgs e)
        {
            if (m_dataGridView is DataGridViewAdvanced)
            {
                DataGridViewAdvanced ngrid = ((DataGridViewAdvanced)m_dataGridView);
                // aceptamos el valor
                ngrid.FinishEdit();
                ngrid.DoDoubleClick(MainControl);
            }
        }

        private void UpdateReaonlyInput()
        {
            switch (FDataType)
            {
                case ColumnDataType.Double:
                case ColumnDataType.Integer:
                case ColumnDataType.Numeric:
                case ColumnDataType.Text:
                case ColumnDataType.Password:
                    if (textcontrol != null)
                    {
                        textcontrol.ReadOnly = FReadOnlyInput;
                    }
                    break;
            }

        }
        private void SetValue(object newvalue)
        {
            CreateControl();
            bool oldsearchenabled = false;
            switch (FDataType)
            {
                case ColumnDataType.Double:
                case ColumnDataType.Integer:
                case ColumnDataType.Numeric:
                    if (textcontrol.SearchWindow != null)
                    {
                        oldsearchenabled = textcontrol.SearchWindow.Enabled;
                        textcontrol.SearchWindow.Enabled = false;
                    }
                    try
                    {
                        textcontrol.Text = newvalue.ToString();
                    }
                    finally
                    {
                        if (textcontrol.SearchWindow != null)
                        {
                            textcontrol.SearchWindow.Enabled = oldsearchenabled;
                        }
                    }
                    break;
                case ColumnDataType.Text:
                case ColumnDataType.Password:
                    if (textcontrol.SearchWindow != null)
                    {
                        oldsearchenabled = textcontrol.SearchWindow.Enabled;
                        textcontrol.SearchWindow.Enabled = false;
                    }
                    try
                    {
                        textcontrol.Text = newvalue.ToString();
                    }
                    finally
                    {
                        if (textcontrol.SearchWindow != null)
                        {
                            textcontrol.SearchWindow.Enabled = oldsearchenabled;
                        }
                    }
                    break;
                case ColumnDataType.Date:
                    if (NewDatePicker)
                    {
                        if (newvalue != DBNull.Value)
                            datecontrol2.Value = System.Convert.ToDateTime(newvalue).Date;
                        else
                            datecontrol2.Value = DateTime.MinValue;
                    }
                    else
                    {
                        if (newvalue != DBNull.Value)
                            datecontrol1.Value = System.Convert.ToDateTime(newvalue).Date;
                        else
                            datecontrol1.Value = DateTime.MinValue;
                    }
                    break;
                case ColumnDataType.Time:
                    if (NewDatePicker)
                    {
                        if (newvalue != DBNull.Value)
                            datecontrol2.Value = System.Convert.ToDateTime(newvalue);
                        else
                            datecontrol2.Value = DateTime.MinValue;
                    }
                    else
                    {
                        if (newvalue != DBNull.Value)
                            datecontrol1.Value = System.Convert.ToDateTime(newvalue);
                        else
                            datecontrol1.Value = DateTime.MinValue;
                    }
                    break;
                case ColumnDataType.DateTime:
                    if (NewDatePicker)
                    {
                        if (newvalue != DBNull.Value)
                            datecontrol2.Value = System.Convert.ToDateTime(newvalue);
                        else
                            datecontrol2.Value = DateTime.MinValue;
                    }
                    else
                    {
                        if (newvalue != DBNull.Value)
                            datecontrol1.Value = System.Convert.ToDateTime(newvalue);
                        else
                            datecontrol1.Value = DateTime.MinValue;
                    }
                    break;
            }
        }
        /// <summary>
        /// Gets or sets the current editor value, converting between the cell value and the hosted control.
        /// </summary>
        [DesignerSerializationVisibility(DesignerSerializationVisibility.Visible)]

        public object NewValue
        {
            get { return GetValue(); }
            set
            {
                disabledchange = true;
                try
                {
                    SetValue(value);
                }
                finally
                {
                    disabledchange = false;
                }

                NotifyChange();
            }
        }
        private object GetValue()
        {
            object nresult = null;
            switch (FDataType)
            {
                case ColumnDataType.Text:
                case ColumnDataType.Password:
                    nresult = textcontrol.Text;
                    break;
                case ColumnDataType.Integer:
                case ColumnDataType.Double:
                case ColumnDataType.Numeric:
                    nresult = textcontrol.Text;
                    break;
                case ColumnDataType.Date:
                    if (datecontrol2 != null)
                    {
                        if (datecontrol2.Value == DateTime.MinValue)
                            nresult = DBNull.Value;
                        else
                            nresult = datecontrol2.Value.Date;
                    }
                    else
                    {
                        if (datecontrol1 != null)
                        {
                            if (datecontrol1.Value == DateTime.MinValue)
                                nresult = DBNull.Value;
                            else
                                nresult = datecontrol1.Value.Date;
                        }
                    }
                    break;
                case ColumnDataType.Time:
                    if (NewDatePicker)
                    {
                        if (datecontrol2.Value == DateTime.MinValue)
                            nresult = DBNull.Value;
                        else
                            nresult = datecontrol2.Value;
                    }
                    else
                    {
                        if (datecontrol1.Value == DateTime.MinValue)
                            nresult = DBNull.Value;
                        else
                            nresult = datecontrol1.Value;
                    }
                    break;
                case ColumnDataType.DateTime:
                    if (NewDatePicker)
                    {
                        if (datecontrol2.Value == DateTime.MinValue)
                            nresult = DBNull.Value;
                        else
                            nresult = datecontrol2.Value;
                    }
                    else
                    {
                        if (datecontrol1.Value == DateTime.MinValue)
                            nresult = DBNull.Value;
                        else
                            nresult = datecontrol1.Value;
                    }
                    break;
                    /*                case ColumnDataType.DateTime:
                                        if (datecontrol1.Value == DateTime.MinValue)
                                            nresult = DBNull.Value;
                                        else
                                            nresult = datecontrol1.Value.Add(datecontrol2.Value - datecontrol2.Value.Date);
                                        break;*/
            }
            return nresult;
        }
        private void SetNewValue(object nval)
        {
            switch (FDataType)
            {
                case ColumnDataType.Text:
                case ColumnDataType.Password:
                    textcontrol.Text = nval.ToString();
                    break;
                case ColumnDataType.Integer:
                case ColumnDataType.Double:
                case ColumnDataType.Numeric:
                    textcontrol.Text = nval.ToString();
                    break;
                case ColumnDataType.Date:
                case ColumnDataType.Time:
                case ColumnDataType.DateTime:
                    if (NewDatePicker)
                    {
                        if (nval.ToString() != "")
                            datecontrol2.Value = (DateTime)nval;
                    }
                    else
                    {
                        if (nval.ToString() != "")
                            datecontrol1.Value = (DateTime)nval;
                    }
                    break;
                    /*case ColumnDataType.DateTime:
                        datecontrol1.Value = ((DateTime)nval).Date;
                        datecontrol2.Value = (DateTime)nval;
                        break;*/
            }
        }
        private void PicboxButton_Click(object sender, EventArgs e)
        {
            DataGridViewColumnAdvanced ncol = GetColumn();
            if (ncol == null)
                return;
            if (ncol.ButtonClick != null)
            {
                object nvalue = GetValue();
                bool aresult = ncol.ButtonClick(GetColumn(), ref nvalue);
                if (aresult)
                {
                    //SetValue(nvalue);
                    //NotifyChange();
                }
            }
        }

        private void NotifyChange()
        {
            if (disabledchange)
                return;
            if (!GetValue().Equals(prevvalue))
            {
                m_valueChanged = true;
                m_dataGridView.NotifyCurrentCellDirty(true);
                prevvalue = GetValue();
            }
        }
        /// <summary>
        /// Applies the specified cell style to the editing control. This implementation performs no styling.
        /// </summary>
        public void ApplyCellStyleToEditingControl(DataGridViewCellStyle dataGridViewCellStyle)
        {
            // Do nothing
        }
        /// <summary>
        /// Gets the cursor used over the editing control.
        /// </summary>
        public Cursor EditingControlCursor
        {
            get
            {
                return Cursors.IBeam;
            }
        }
        /// <summary>
        /// Gets the cursor used over the editing panel.
        /// </summary>
        public Cursor EditingPanelCursor
        {
            get
            {
                return Cursors.IBeam;
            }
        }
        /// <summary>
        /// Gets or sets the grid that owns this editing control.
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
        /// Gets or sets the formatted value of the editing control.
        /// </summary>
        [DesignerSerializationVisibility(DesignerSerializationVisibility.Visible)]
        public object EditingControlFormattedValue
        {
            get
            {
                return GetEditingControlFormattedValue(DataGridViewDataErrorContexts.Display);
            }
            set
            {
                SetNewValue(value);
            }
        }
        /// <summary>
        /// Gets or sets the index of the row being edited.
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
        /// Gets or sets whether the value of the editing control has changed.
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
        /// Determines whether the editing control processes the given key or lets the grid handle it.
        /// </summary>
        public bool EditingControlWantsInputKey(Keys keyData, bool dataGridViewWantsInputKey)
        {
            if (FDataType == ColumnDataType.Date)
            {
                switch (keyData)
                {
                    case Keys.Down:
                        return false;
                    case Keys.Up:
                        return false;
                    default:
                        return true;
                }

            }

            switch (keyData)
            {
                case Keys.Tab:
                    return true;
                case Keys.Home:
                    return true;
                case Keys.End:
                    return true;
                case Keys.Left:
                    if ((this.textcontrol.SelectionLength == 0)
                        && (this.textcontrol.SelectionStart == 0))
                        return false;
                    else
                        return true;
                case Keys.Right:
                    if ((this.textcontrol.SelectionLength == 0)
                        && (this.textcontrol.SelectionStart == this.textcontrol.Text.Length))
                        return false;
                    else
                        return true;
                case Keys.Delete:
                    //                    this.textcontrol.Text = "";
                    return true;
                case Keys.Enter:
                    NotifyChange();
                    return false;
                case Keys.Up:
                    return false;
                case Keys.Down:
                    return false;
                default:
                    if (FDataType == ColumnDataType.Text)
                        return true;
                    else
                        return false;
            }
        }

        /// <summary>
        /// Returns the current editor value formatted as display text for the given error context.
        /// </summary>
        public object GetEditingControlFormattedValue(DataGridViewDataErrorContexts context)
        {
            object nvalue = GetValue();
            if (nvalue == null)
                return null;
            string fvalue = "";
            switch (FDataType)
            {
                case ColumnDataType.Text:
                case ColumnDataType.Password:
                    fvalue = nvalue.ToString();
                    break;
                case ColumnDataType.Double:
                case ColumnDataType.Integer:
                case ColumnDataType.Numeric:
                    fvalue = nvalue.ToString();
                    break;
                case ColumnDataType.Date:
                    if (nvalue == DBNull.Value)
                        fvalue = "";
                    else
                        fvalue = ((DateTime)nvalue).ToString("dd/MM/yyyy");
                    break;
                case ColumnDataType.Time:
                    if (nvalue == DBNull.Value)
                        fvalue = "";
                    else
                        fvalue = ((DateTime)nvalue).ToString("HH:mm:ss");
                    break;
                case ColumnDataType.DateTime:
                    if (nvalue == DBNull.Value)
                        fvalue = "";
                    else
                        fvalue = ((DateTime)nvalue).ToString("dd/MM/yyyy HH:mm:ss");
                    break;
            }
            return fvalue;
        }
        /// <summary>
        /// Creates or reuses the hosted input control appropriate for the current data type.
        /// </summary>
        public void CreateMainControl()
        {
            /*if (controldatatype != FDataType)
            {
                ReleaseInternalControl();
            }
            else
            {
                if (MainControl is TextBoxAdvanced)
                {
                    if (((TextBoxAdvanced)MainControl).MaxLength != FMaxInputLength)
                    {
                        ReleaseInternalControl();
                    }                        
                }
            }*/
            //this.RecreateHandle();
            ReleaseInternalControl();
            if (MainControl == null)
            {
                controldatatype = FDataType;
                switch (FDataType)
                {
                    case ColumnDataType.Text:
                    case ColumnDataType.Password:
                    case ColumnDataType.Numeric:
                    case ColumnDataType.Integer:
                    case ColumnDataType.Double:
                        if (datecontrol1 != null)
                        {
                            datecontrol1.Visible = false;
                        }
                        if (datecontrol2 != null)
                        {
                            datecontrol2.Visible = false;
                        }
                        if (textcontrol == null)
                        {
                            textcontrol = new TextBoxAdvanced();
                            textcontrol.BorderStyle = BorderStyle.None;
                            textcontrol.Font = this.EditingControlDataGridView.Font;
#if NETCOREAPP
#else
                            //textcontrol.Multiline = true;
                            //textcontrol.MinimumSize = new System.Drawing.Size(0, textcontrol.Height);
                            //textcontrol.Multiline = false;
#endif
                            //textcontrol.Margin = new System.Windows.Forms.Padding(0, 0, 0, 0);
                            textcontrol.LostFocus += new EventHandler(MLostFocus);
                            textcontrol.TextChanged += new EventHandler(MValueChange);
                            textcontrol.KeyDown += new KeyEventHandler(DoKeyDown);
                            textcontrol.KeyUp += new KeyEventHandler(DoKeyUp);
                            textcontrol.KeyPress += new KeyPressEventHandler(DoKeyPress);
                            textcontrol.DoubleClick += new EventHandler(MDoubleClick);
                            textcontrol.ReadOnly = FReadOnlyInput;
                            MainControl = textcontrol;
                            textcontrol.DataType = (TextBoxDataType)FDataType;
                            textcontrol.MaxLength = FMaxInputLength;
                            if (FDataType == ColumnDataType.Password)
                                textcontrol.UseSystemPasswordChar = true;
                            else
                                textcontrol.UseSystemPasswordChar = false;
                            Controls.Add(textcontrol);
                        }
                        else
                        {
                            textcontrol.Visible = true;
                            textcontrol.DataType = (TextBoxDataType)FDataType;
                            textcontrol.ReadOnly = FReadOnlyInput;
                            textcontrol.MaxLength = FMaxInputLength;
                            if (FDataType == ColumnDataType.Password)
                                textcontrol.UseSystemPasswordChar = true;
                            else
                                textcontrol.UseSystemPasswordChar = false;
                            MainControl = textcontrol;
                            this.Visible = true;
                        }
                        DataGridViewColumnAdvanced ncol = GetColumn();

                        textcontrol.SearchWindow = ncol.SearchWindow;
                        if (textcontrol.SearchWindow != null)
                            textcontrol.DataType = TextBoxDataType.Text;

                        ResizeControls();
                        break;
                    case ColumnDataType.Date:
                    case ColumnDataType.Time:
                    case ColumnDataType.DateTime:
                        if (textcontrol != null)
                        {
                            textcontrol.Visible = false;
                        }
                        if (NewDatePicker)
                        {
                            datecontrol2 = new DateTimePickerAdvanced();
                            datecontrol2.HandleLeftRightTabs = true;
                            datecontrol2.ValueChanged += new EventHandler(Datecontrol1_ValueChanged);
                            //datecontrol2 = new DateTimePickerNullable();
                            //datecontrol2.ValueChanged += new EventHandler(datecontrol1_ValueChanged);
                            datecontrol2.DateFormat = "dd/MM/yyyy";
                            if (FDataType == ColumnDataType.DateTime)
                                datecontrol2.TimeFormat = "HH:mm:ss";
                            else
                                if (FDataType == ColumnDataType.Time)
                            {
                                datecontrol2.DateFormat = "";
                                datecontrol2.TimeFormat = "HH:mm:ss";
                            }

                            //datecontrol2.Format = DateTimePickerFormat.Custom;
                            //datecontrol2.CustomFormat = "hh:mm:ss";
                            //datecontrol2.KeyDown += new KeyEventHandler(DoKeyDown);
                            //datecontrol2.KeyUp += new KeyEventHandler(DoKeyDown);
                            //datecontrol2.KeyPress += new KeyPressEventHandler(DoKeyPress);
                            datecontrol2.KeyDown += new KeyEventHandler(DoKeyDown);
                            datecontrol2.KeyUp += new KeyEventHandler(DoKeyDown);
                            datecontrol2.KeyPress += new KeyPressEventHandler(DoKeyPress);
                            datecontrol2.LostFocus += new EventHandler(MLostFocus);
                            datecontrol2.ValueChanged += new EventHandler(MValueChange);
                            //datecontrol2.LostFocus += new EventHandler(mLostFocus);
                            //datecontrol2.ValueChanged += new EventHandler(mValueChange);
                            datecontrol2.DoubleClick += new EventHandler(MDoubleClick);
                            //datecontrol2.DoubleClick += new EventHandler(mDoubleClick);
                            Controls.Add(datecontrol2);
                            MainControl = datecontrol2;
                        }
                        else
                        {
                            if (datecontrol1 == null)
                            {
                                datecontrol1 = new DateTimePickerNullable();
                                datecontrol1.ValueChanged += new EventHandler(Datecontrol1_ValueChanged);
                            }
                            //datecontrol2 = new DateTimePickerNullable();
                            //datecontrol2.ValueChanged += new EventHandler(datecontrol1_ValueChanged);
                            datecontrol1.Format = DateTimePickerFormat.Custom;
                            if (FDataType == ColumnDataType.DateTime)
                                datecontrol1.CustomFormat = "dd/MM/yyyy HH:mm:ss";
                            else
                                if (FDataType == ColumnDataType.Time)
                                datecontrol1.CustomFormat = "HH:mm:ss";
                            else
                                    if (FDataType == ColumnDataType.Date)
                                datecontrol1.CustomFormat = "dd/MM/yyyy";

                            //datecontrol2.Format = DateTimePickerFormat.Custom;
                            //datecontrol2.CustomFormat = "hh:mm:ss";
                            //datecontrol2.KeyDown += new KeyEventHandler(DoKeyDown);
                            //datecontrol2.KeyUp += new KeyEventHandler(DoKeyDown);
                            //datecontrol2.KeyPress += new KeyPressEventHandler(DoKeyPress);
                            datecontrol1.KeyDown += new KeyEventHandler(DoKeyDown);
                            datecontrol1.KeyUp += new KeyEventHandler(DoKeyDown);
                            datecontrol1.KeyPress += new KeyPressEventHandler(DoKeyPress);
                            datecontrol1.LostFocus += new EventHandler(MLostFocus);
                            datecontrol1.ValueChanged += new EventHandler(MValueChange);
                            //datecontrol2.LostFocus += new EventHandler(mLostFocus);
                            //datecontrol2.ValueChanged += new EventHandler(mValueChange);
                            datecontrol1.DoubleClick += new EventHandler(MDoubleClick);
                            //datecontrol2.DoubleClick += new EventHandler(mDoubleClick);
                            Controls.Add(datecontrol1);
                            //Controls.Add(datecontrol2);
                            MainControl = datecontrol1;

                        }
                        //datecontrol1.Visible = ((FDataType == ColumnDataType.Date) || (FDataType == ColumnDataType.DateTime));
                        //datecontrol2.Visible = ((FDataType == ColumnDataType.Time) || (FDataType == ColumnDataType.DateTime));
                        /*if (FDataType == ColumnDataType.Time)
                            MainControl = datecontrol2;
                        else
                            MainControl = datecontrol1;*/
                        if (MainControl != null)
                            MainControl.Visible = true;
                        ResizeControls();
                        break;
                }
            }
            else
            {

            }
        }

        void Datecontrol1_ValueChanged(object sender, EventArgs e)
        {
            if (!disabledchange)
                m_dataGridView.NotifyCurrentCellDirty(true);
        }
        /// <summary>
        /// Sets the bounds of the control and repositions the hosted input controls.
        /// </summary>
        protected override void SetBoundsCore(int x, int y, int width, int height, BoundsSpecified specified)
        {
            base.SetBoundsCore(x, y, width, height, specified);
            // CreateMainControl();
            ResizeControls();
        }
        private void ResizeControls()
        {
            if (MainControl != null)
            {
                MainControl.Top = (this.Height - MainControl.Height) / 2;
                int offset = 0;
                if (picbo != null)
                {
                    picbo.Width = DataGridViewColumnAdvanced.ImageWidth;
                    offset = picbo.Width;

                }
                //if (FDataType == ColumnDataType.DateTime)
                //{
                //   datecontrol1.Width = (this.Width - offset) / 2;
                //datecontrol2.Width = datecontrol1.Width;
                //datecontrol2.Left = datecontrol1.Width;
                //datecontrol2.Top = datecontrol1.Top;
                //}
                //else
                {
                    MainControl.Width = this.Width - offset;
                    //MainControl.Dock = DockStyle.Fill;
                }
            }
            Visible = true;
        }

        private DataGridViewColumnAdvanced GetColumn()
        {
            DataGridViewColumnAdvanced nresult = null;
            if (m_dataGridView == null)
                return nresult;
            if (m_dataGridView.CurrentCell == null)
                return nresult;
            if (m_dataGridView.CurrentCell.ColumnIndex < 0)
                return nresult;
            return (DataGridViewColumnAdvanced)m_dataGridView.Columns[m_dataGridView.CurrentCell.ColumnIndex];
        }
        private void CreatePictureBox()
        {
            if (CachedPictureBoxControls.Count > 0)
            {
                picbo = CachedPictureBoxControls[0];
                CachedPictureBoxControls.RemoveAt(0);
            }
            else
            {
                picbo = new PictureBox();
                picbo.SizeMode = PictureBoxSizeMode.Zoom;
                picbo.Width = DataGridViewColumnAdvanced.ImageWidth;
                picbo.Dock = DockStyle.Right;
            }
            picbo.Click += new EventHandler(PicboxButton_Click);
            Controls.Add(picbo);
        }
        private void ReleasePictureBox()
        {
            picbo.Click -= new EventHandler(PicboxButton_Click);
            if (Controls.Contains(picbo))
            {
                Controls.Remove(picbo);
            }
            CachedPictureBoxControls.Add(picbo);
            picbo = null;
        }
        private void CreateInternalControl()
        {

        }
        private void ReleaseInternalControl()
        {
            if (MainControl == null)
            {
                return;
            }
            MainControl.Visible = false;
            MainControl = null;
            /*if (MainControl is TextBoxAdvanced)
            {
                CachedTextBoxAdvancedControls.Add(MainControl as TextBoxAdvanced);
            }
            else
            {
                if (MainControl is DateTimePickerNullable)
                {
                    CachedDateTimePickerNullableControls.Add(MainControl as DateTimePickerNullable);
                }
                else
                {
                    if (MainControl is DateTimePickerAdvanced)
                    {
                        CachedDateTimePickerAdvancedControls.Add(MainControl as DateTimePickerAdvanced);
                    }
                }
            }
            if (Controls.Contains(MainControl))
            {
                Controls.Remove(MainControl);
            }
            MainControl = null;*/
        }
        /// <summary>
        /// Prepares the editor before editing begins, configuring the data type, image button, search window and initial value.
        /// </summary>
        public void PrepareEditingControlForEdit(bool selectAll)
        {
            DataGridViewColumnAdvanced ncol = GetColumn();

            if (ncol.ImageButton != null)
            {
                if (picbo == null)
                {
                    CreatePictureBox();
                }
                picbo.Image = ncol.ImageButton;
                picbo.Visible = true;
                if (!Controls.Contains(picbo))
                {
                    Controls.Add(picbo);
                }
            }
            else
            {
                if (picbo != null)
                {
                    ReleasePictureBox();
                }
            }
            if (FDataType != ncol.DataType)
            {
                ReleaseInternalControl();
                FDataType = ncol.DataType;
            }
            if (FReadOnlyInput != ncol.ReadOnlyInput)
            {
                FReadOnlyInput = ncol.ReadOnlyInput;
                UpdateReaonlyInput();
            }
            SearchWindow = ncol.SearchWindow;
            if (SearchWindow != null)
            {
                FDataType = ColumnDataType.Text;
                FMaxInputLength = 0;
            }
            else
            {
                FMaxInputLength = ncol.MaxInputLength;
            }

            CreateMainControl();
            if (MainControl is TextBoxAdvanced)
            {
                ((TextBoxAdvanced)MainControl).SearchWindow = SearchWindow;
            }
            disabledchange = true;
            try
            {
                prevvalue = DBNull.Value;
                if (this.m_dataGridView.CurrentCell.Value != null)
                    prevvalue = this.m_dataGridView.CurrentCell.Value;
                SetValue(prevvalue);
                prevvalue = GetValue();
            }
            finally
            {
                disabledchange = false;
            }
            if (this.textcontrol != null)
                if (selectAll)
                    this.textcontrol.SelectAll();
            if (MainControl != null)
                if (MainControl.Visible)
                    MainControl.Focus();
            ImageButtonScale = ncol.ImageButtonScale;
            ImageButton = ncol.ImageButton;
        }
        /// <summary>
        /// Gets whether the grid should reposition the editing control when its value changes; always false.
        /// </summary>
        public bool RepositionEditingControlOnValueChange
        {
            get
            {
                return false;
            }
        }
        /// <summary>
        /// Gets whether the hosted control (or the editor itself) has input focus.
        /// </summary>
        public override bool Focused
        {
            get
            {
                if (MainControl != null)
                    return MainControl.Focused;
                else
                    return base.Focused;
            }
        }
        /// <summary>
        /// Releases the resources used by the editing control and its hosted controls.
        /// </summary>
        protected override void Dispose(bool disposing)
        {
            if (textcontrol != null)
                textcontrol.Dispose();
            if (datecontrol1 != null)
                datecontrol1.Dispose();
            if (datecontrol2 != null)
                datecontrol2.Dispose();
            //            if (datecontrol2!=null)
            //                datecontrol2.Dispose();
            if (picbo != null)
                picbo.Dispose();

            base.Dispose(disposing);
        }
    }
    /// <summary>
    /// Navigation keystrokes forwarded to a search window so it can move its selection or accept the current entry.
    /// </summary>
    public enum SearchWindowKeyOperation
    {
        /// <summary>Move the selection up one item.</summary>
        Up,
        /// <summary>Move the selection down one item.</summary>
        Down,
        /// <summary>Move the selection up one page.</summary>
        PageUp,
        /// <summary>Move the selection down one page.</summary>
        PageDown,
        /// <summary>Accept the currently selected entry.</summary>
        Return
    };
    /// <summary>
    /// Callback raised when a search window should be shown, carrying the control to display in <see cref="ShowSearchWindowArgs"/>.
    /// </summary>
    public delegate void ShowSearchWindowEvent(object sender, ShowSearchWindowArgs args);
    /// <summary>
    /// Event arguments for showing a search window, exposing the control that hosts the search UI.
    /// </summary>
    public class ShowSearchWindowArgs
    {
        /// <summary>
        /// The control that hosts the search window UI.
        /// </summary>
        public Control Window;
        /// <summary>
        /// Initializes new arguments with the control that hosts the search window.
        /// </summary>
        public ShowSearchWindowArgs(Control ncontrol)
        {
            Window = ncontrol;
        }
    }
    /// <summary>
    /// Contract for a drop-down search/lookup window attached to a grid editor; implementers create the window control and respond to search-string changes, navigation keys and clicks.
    /// </summary>
    public interface ISearchWindow
    {
        /// <summary>
        /// Updates the search window with a new search string.
        /// </summary>
        void ChangeSearchString(string newvalue);
        /// <summary>
        /// Hides the search window and cancels the current search.
        /// </summary>
        void Deactivate();
        /// <summary>
        /// Applies a navigation keystroke to the search window.
        /// </summary>
        void KeyOperation(SearchWindowKeyOperation key_operation);
        /// <summary>
        /// Creates and returns the control that displays the search window.
        /// </summary>
        Control CreateWindow();
        /// <summary>
        /// Handles a click at the given client point; returns true if the click was consumed.
        /// </summary>
        bool Click(Point clientpoint);
        // Property declaration:
        /// <summary>
        /// Gets or sets whether the search window is active.
        /// </summary>
        bool Enabled
        {
            get;
            set;
        }
    }

}
