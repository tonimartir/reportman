using Reportman.Drawing;
using Reportman.Drawing.Forms;
using Reportman.Reporting;
using System;
using System.Collections.Generic;
using System.ComponentModel;
using System.Data;
using System.Drawing;
using System.Windows.Forms;

namespace Reportman.Designer
{
    internal partial class ObjectInspector : DataGridViewAdvanced, IObjectInspector
    {
        DataGridViewColumn ColLabel;
        DataGridViewColumn ColProperty;
        DesignerInterface CurrentInterface;
        [DesignerSerializationVisibility(DesignerSerializationVisibility.Hidden), Browsable(false)]
        public PropertyChanged OnPropertyChange { get; set; }
        DataRowChangeEventHandler rowchangeevent;
        DataSet data;
        String SDouble;
        String SInteger;
        String SString;
        string SDateTime;
        string SDate;
        string STime;
        bool selectingobject;
        ComboBox FComboSelection;
        [DesignerSerializationVisibility(DesignerSerializationVisibility.Hidden), Browsable(false)]
        public ComboBox ComboSelection
        {
            get
            {
                return FComboSelection;
            }
            set
            {
                FComboSelection = value;
            }
        }
        public Control GetControl()
        {
            return this;
        }
        [DesignerSerializationVisibility(DesignerSerializationVisibility.Hidden), Browsable(false)]
        public FrameStructure Structure { get; set; }
        [DesignerSerializationVisibility(DesignerSerializationVisibility.Hidden), Browsable(false)]
        public EditSubReport SubReportEdit { get; set; }
        public SortedList<int, ReportItem> CurrentList = new SortedList<int, ReportItem>();
        public ObjectInspector()
        {
            InitializeComponent();
            rowchangeevent = new DataRowChangeEventHandler(RowChange);
            ColumnHeadersVisible = false;
        }
        private void FormatCell(object sender, DataGridViewCellFormattingEventArgs e)
        {
            if (e.ColumnIndex == 0)
                return;
            DataGridViewRow dgview = Rows[e.RowIndex];
            DataRowView rview = (DataRowView)dgview.DataBoundItem;
            DataRow nrow = rview.Row;
            if (nrow["TYPE"].ToString() == SDouble)
            {
                e.CellStyle.Alignment = DataGridViewContentAlignment.MiddleRight;
            }
        }
        private DataTable FindDataTable(string tablename, DesignerInterface obj)
        {
            // Table name differen for different secions types
            if (obj.ReportItemObject is Section)
            {
                Section nsec = (Section)obj.ReportItemObject;
                tablename = tablename + nsec.SectionType.ToString();
            }
            Reportman.Drawing.Strings pnames = new Strings();
            DataTable properties = data.Tables[tablename];

            bool assignproperties = true;
            if (properties == null)
            {
                Reportman.Reporting.Variants pvalues = null;
                if (obj.SelectionList.Count == 1)
                {
                    assignproperties = false;
                    pvalues = new Variants();
                }
                properties = new DataTable(tablename);
                properties.Columns.Add("NAME", System.Type.GetType("System.String"));
                properties.Columns.Add("TYPE", System.Type.GetType("System.String"));
                properties.Columns.Add("TYPEENUM", System.Type.GetType("System.Int32"));
                properties.Columns.Add("VALUE", System.Type.GetType("System.Object"));
                properties.Columns.Add("VALUELIST", System.Type.GetType("System.Object"));
                properties.Columns.Add("INTERFACE", System.Type.GetType("System.Object"));
                properties.Columns.Add("VALUEBIN", System.Type.GetType("System.Object"));
                DataColumn acol = properties.Columns.Add("TWIPS", System.Type.GetType("System.Boolean"));
                acol.DefaultValue = false;

                properties.Constraints.Add("IPRIMNAME", properties.Columns["NAME"], true);
                Reportman.Drawing.Strings ptypes = new Strings();
                Reportman.Drawing.Strings lhints = new Strings();
                Reportman.Drawing.Strings lcat = new Strings();
                if (obj.ReportItemObject == null)
                {
                    obj.SetItem(obj.SelectionList.Values[0]);
                }
                obj.GetProperties(pnames, ptypes, pvalues, lhints, lcat);
                properties.Rows.Clear();
                for (int i = 0; i < pnames.Count; i++)
                {
                    bool isbinary = false;
                    DataRow nrow = properties.NewRow();
                    nrow["NAME"] = pnames[i];
                    nrow["TYPE"] = ptypes[i];
                    nrow["INTERFACE"] = obj;
                    nrow["VALUELIST"] = DBNull.Value;
                    nrow["TYPEENUM"] = System.Convert.ToInt32(ObjectInspectorCellType.Text);
                    if (ptypes[i] == Translator.TranslateStr(571))
                    {
                        nrow["TYPEENUM"] = System.Convert.ToInt32(ObjectInspectorCellType.Expression);
                    }
                    else
                    if (ptypes[i] == Translator.TranslateStr(1099))
                    {
                        nrow["TYPEENUM"] = System.Convert.ToInt32(ObjectInspectorCellType.ConnectionString);
                    }
                    else
                    if (ptypes[i] == "SQL")
                    {
                        nrow["TYPEENUM"] = System.Convert.ToInt32(ObjectInspectorCellType.SQL);
                    }
                    else
                        if (ptypes[i] == Translator.TranslateStr(556))
                    {
                        nrow["TYPEENUM"] = System.Convert.ToInt32(ObjectInspectorCellType.Decimal);
                        nrow["TWIPS"] = true;
                    }
                    else
                        if (ptypes[i] == Translator.TranslateStr(1171))
                    {
                        nrow["TYPEENUM"] = System.Convert.ToInt32(ObjectInspectorCellType.Decimal);
                        nrow["TWIPS"] = false;
                    }
                    else
                            if (ptypes[i] == Translator.TranslateStr(569))
                    {
                        nrow["TYPEENUM"] = System.Convert.ToInt32(ObjectInspectorCellType.DropDownList);
                        Strings alist = new Strings();
                        obj.GetPropertyValues(pnames[i], alist);
                        nrow["VALUELIST"] = alist;
                    }
                    else if (ptypes[i] == Translator.TranslateStr(961))
                    {
                        nrow["TYPEENUM"] = System.Convert.ToInt32(ObjectInspectorCellType.DropDown);
                        Strings alist = new Strings();
                        obj.GetPropertyValues(pnames[i], alist);
                        nrow["VALUELIST"] = alist;
                    }
                    else
                        if (ptypes[i] == Translator.TranslateStr(568))
                    {
                        nrow["TYPEENUM"] = System.Convert.ToInt32(ObjectInspectorCellType.Boolean);
                    }
                    else
                            if (ptypes[i] == Translator.TranslateStr(558))
                    {
                        nrow["TYPEENUM"] = System.Convert.ToInt32(ObjectInspectorCellType.Color);
                    }
                    else
                                if (ptypes[i] == Translator.TranslateStr(639))
                    {
                        isbinary = true;
                        nrow["TYPEENUM"] = System.Convert.ToInt32(ObjectInspectorCellType.Image);
                    }
                    else
                                if (ptypes[i] == Translator.TranslateStr(560))
                    {
                        nrow["TYPEENUM"] = System.Convert.ToInt32(ObjectInspectorCellType.FontName);
                    }
                    else
                            if (ptypes[i] == Translator.TranslateStr(566))
                    {
                        nrow["TYPEENUM"] = System.Convert.ToInt32(ObjectInspectorCellType.FontStyle);
                    }
                    else
                                // Font size
                                if (ptypes[i] == Translator.TranslateStr(559))
                    {
                        nrow["TYPEENUM"] = System.Convert.ToInt32(ObjectInspectorCellType.Integer);
                    }

                    if ((obj is DesignerInterfaceLabel) && (pnames[i] == Translator.TranslateStr(570)))
                    {
                        nrow["TYPEENUM"] = System.Convert.ToInt32(ObjectInspectorCellType.MultilineText);
                    }

                    if (pvalues != null)
                    {
                        if (isbinary)
                        {
                            nrow["VALUEBIN"] = pvalues[i];
                            System.IO.MemoryStream mstream = pvalues[i].GetStream();
                            nrow["VALUE"] = StringUtil.GetSizeAsString(mstream.Length);

                        }
                        else
                        {
                            if ((bool)nrow["TWIPS"])
                                nrow["VALUE"] = Twips.UnitsFromTwips(pvalues[i]);
                            else
                                nrow["VALUE"] = pvalues[i];
                        }
                    }
                    properties.Rows.Add(nrow);
                }
                properties.RowChanging += rowchangeevent;
                data.Tables.Add(properties);
            }
            if (assignproperties)
            {
                properties.RowChanging -= rowchangeevent;
                for (int i = 0; i < properties.Rows.Count; i++)
                {
                    DataRow nrow = properties.Rows[i];
                    string ntype = nrow["TYPE"].ToString();
                    ObjectInspectorCellType cellType = ObjectInspectorCellType.Text;
                    if (nrow["TYPEENUM"] != DBNull.Value)
                        cellType = (ObjectInspectorCellType)nrow["TYPEENUM"];
                    if ((ntype == Translator.TranslateStr(569)) || (ntype == Translator.TranslateStr(961)))
                    {
                        Strings alist = new Strings();
                        obj.GetPropertyValues(nrow["NAME"].ToString(), alist);
                        nrow["VALUELIST"] = alist;
                    }
                    Variant nvalue = obj.GetPropertyMulti(nrow["NAME"].ToString());
                    if (cellType == ObjectInspectorCellType.Color)
                    {
                        if (!nvalue.IsNull)
                            nrow["VALUE"] = (int)nvalue;
                    }
                    else
                    if (nvalue.VarType == VariantType.Binary)
                    {
                        nrow["VALUEBIN"] = nvalue;
                        nrow["VALUE"] = StringUtil.GetSizeAsString(nvalue.GetStream().Length);
                    }
                    else
                    {

                        if (nvalue.IsNull)
                        {
                            nrow["VALUE"] = DBNull.Value;
                        }
                        else
                        {
                            if ((bool)nrow["TWIPS"])
                                nrow["VALUE"] = Twips.UnitsFromTwips(nvalue);
                            else
                                nrow["VALUE"] = nvalue;
                            if (nrow["TYPE"].ToString() == Translator.TranslateStr(961))
                            {
                                Strings alist = new Strings();
                                obj.GetPropertyValues(nrow["NAME"].ToString(), alist);
                                nrow["VALUELIST"] = alist;
                            }
                        }
                    }
                }
                properties.RowChanging += rowchangeevent;
            }
            return properties;
        }
        private FrameMainDesigner FrameMain;
        public void Initialize(FrameMainDesigner nFrameMain)
        {
            FrameMain = nFrameMain;
            SString = Translator.TranslateStr(571);
            SInteger = Translator.TranslateStr(556);
            SDouble = Translator.TranslateStr(556);
            SDate = Translator.TranslateStr(888);
            SDateTime = Translator.TranslateStr(889);
            STime = Translator.TranslateStr(890);
            data = new DataSet();

            AutoGenerateColumns = false;
            SkipReadOnly = true;
            ColumnCount = 0;
            Columns.Add(new DataGridViewTextBoxColumn());
            ObjectInspectorColumn ncolumn = new ObjectInspectorColumn();
            ncolumn.FrameMain = FrameMain;
            Columns.Add(ncolumn);

            EnterAsTab = false;
            ColLabel = Columns[0];
            ColProperty = Columns[1];
            ColProperty.Resizable = DataGridViewTriState.False;
            ColLabel.Frozen = true;
            ColLabel.ReadOnly = true;
            ColLabel.DefaultCellStyle.BackColor = SystemColors.ButtonFace;
            ColLabel.DefaultCellStyle.Alignment = DataGridViewContentAlignment.MiddleRight;
            ColProperty.AutoSizeMode = DataGridViewAutoSizeColumnMode.None;
            ColLabel.AutoSizeMode = DataGridViewAutoSizeColumnMode.None;
            ColLabel.DataPropertyName = "NAME";
            ColProperty.DataPropertyName = "VALUE";
            ColProperty.DefaultCellStyle.Alignment = DataGridViewContentAlignment.MiddleLeft;
            AllowUserToOrderColumns = false;
            AllowUserToResizeRows = false;
            AllowUserToAddRows = false;
            AllowUserToDeleteRows = false;
            this.SelectionMode = DataGridViewSelectionMode.FullRowSelect;
            this.EditMode = DataGridViewEditMode.EditOnEnter;
            this.RowHeadersVisible = false;
            this.MultiSelect = false;

            ColLabel.SortMode = DataGridViewColumnSortMode.NotSortable;
            ColProperty.SortMode = DataGridViewColumnSortMode.NotSortable;

            ColProperty.AutoSizeMode = DataGridViewAutoSizeColumnMode.Fill;
            CellFormatting += new DataGridViewCellFormattingEventHandler(FormatCell);


            AutoSizeRowsMode = DataGridViewAutoSizeRowsMode.None;
            //            Font = new Font(Font.FontFamily, 6);
            int nheight = (int)Math.Round(Font.Size * 1.4 * (double)WinFormsGraphics.ScreenDPI() / (double)72);
            nheight = nheight + 5;
            if (nheight < 10)
                nheight = nheight + 2;
            RowTemplate.Height = nheight;
        }
        public void SetObject(DesignerInterface obj)
        {
            CurrentList.Clear();
            if (DataSource != null)
                if (CurrentRow != null)
                {
                    if (CurrentRow.DataBoundItem != null)
                        RowChange(this, new DataRowChangeEventArgs(((DataRowView)CurrentRow.DataBoundItem).Row, DataRowAction.Change));
                    DataSource = null;
                }
            CurrentInterface = obj;
            if (CurrentInterface == null)
            {
                Visible = false;
                return;
            }
            else
                Visible = true;
            Section nsection = null;
            bool issection = false;
            selectingobject = true;
            try
            {

                PrintPosItem nitem = null;
                if (CurrentInterface is DesignerInterfaceSection)
                {
                    issection = true;
                    nsection = (Section)CurrentInterface.SelectionList.Values[0];
                }
                else
                    if (CurrentInterface is DesignerInterfaceSizePos)
                {
                    nitem = (PrintPosItem)CurrentInterface.SelectionList.Values[0];
                    nsection = nitem.Section;
                    if (CurrentInterface.SelectionList.Count != 1)
                        nitem = null;
                }
                ComboSelection.Items.Clear();
                ComboSelection.SelectedIndex = -1;
                int selindex = 1;
                int newindex = 0;
                if (nsection != null)
                {
                    ComboSelection.Items.Add(nsection.Name);
                    CurrentList.Add(0, nsection);
                    foreach (PrintPosItem xitem in nsection.Components)
                    {
                        ComboSelection.Items.Add(xitem.Name);
                        CurrentList.Add(selindex, xitem);
                        if (nitem == xitem)
                            newindex = selindex;
                        selindex++;
                    }
                    if (issection)
                        ComboSelection.SelectedIndex = 0;
                    else
                        if (CurrentInterface.SelectionList.Count == 1)
                        ComboSelection.SelectedIndex = newindex;
                    if (Structure != null)
                        Structure.SelectItem(nsection, true);
                }
                else
                {
                    if (CurrentInterface.SelectionList.Count == 1)
                    {
                        ComboSelection.Items.Add(CurrentInterface.SelectionList.Values[0].Name);
                        ComboSelection.SelectedIndex = 0;
                        CurrentList.Add(0, CurrentInterface.SelectionList.Values[0]);
                        if (Structure != null)
                            Structure.SelectItem(CurrentInterface.SelectionList.Values[0], true);
                    }
                }


                DataTable properties = FindDataTable(obj.SelectionClassName, obj);
                DataSource = properties;
            }
            finally
            {
                selectingobject = false;
            }
        }
        public void SetObjectFromCombo()
        {
            if (selectingobject)
                return;
            if (CurrentList.Count == 0)
                return;
            if (ComboSelection.SelectedIndex > CurrentList.Count - 1)
                return;
            ReportItem ritem = CurrentList[ComboSelection.SelectedIndex];
            if (!(ritem is PrintItem))
                return;

            PrintItem nitem = (PrintItem)ritem;
            SubReportEdit.SelectPrintItem(nitem);
        }
        public void SelectProperty(string caption)
        {
            if (string.IsNullOrEmpty(caption) || DataSource == null)
                return;
            foreach (DataGridViewRow row in Rows)
            {
                DataRowView view = row.DataBoundItem as DataRowView;
                if (view == null || !string.Equals(view.Row["NAME"].ToString(), caption, StringComparison.Ordinal))
                    continue;
                // The caption cell is read only: the row is selected without editing the value
                if (row.Visible)
                    CurrentCell = row.Cells[ColLabel.Index];
                return;
            }
        }

        /// <summary>
        /// Headless self-test of the selection→property-commit→undo path. Populates the
        /// grid from the model (so the row value already equals the model) and fires the
        /// same no-op commit that switching selection triggers; it must NOT create an undo
        /// entry. Then it changes the value and commits, which MUST create one. Returns a
        /// short result string.
        /// </summary>
        internal string SelfTestUndoOnSelect(DesignerInterface obj, string translatedPropName, string changedValue)
        {
            if (data == null)
                data = new DataSet();
            selectingobject = true;
            CurrentInterface = obj;
            DataTable props = FindDataTable(obj.SelectionClassName, obj);
            DataSource = props;
            selectingobject = false;

            ReportItem first = obj.SelectionList.Values[0];
            UndoCue cue = first.Report != null ? first.Report.UndoCue : null;
            if (cue == null)
                return "NO UndoCue on report";

            DataRow target = null;
            foreach (DataRow row in props.Rows)
                if (row["NAME"].ToString() == translatedPropName) { target = row; break; }
            if (target == null)
                return "PROP NOT FOUND: " + translatedPropName;

            int before = cue.UndoOperations.Count;
            // (1) no-op commit (value already equals model) — what selection switching does
            RowChange(this, new DataRowChangeEventArgs(target, DataRowAction.Change));
            int afterNoop = cue.UndoOperations.Count;
            // (2) real change
            target["VALUE"] = changedValue;
            RowChange(this, new DataRowChangeEventArgs(target, DataRowAction.Change));
            int afterChange = cue.UndoOperations.Count;

            return string.Format("noopUndoDelta={0} (expect 0); realChangeUndoDelta={1} (expect 1)",
                afterNoop - before, afterChange - afterNoop);
        }

        /// <summary>
        /// Headless self-test helper: loads the rows of <paramref name="obj"/> and commits
        /// <paramref name="value"/> (as the inspector cell holds it, e.g. units for a twips
        /// property) to the row <paramref name="translatedPropName"/>, as editing it does.
        /// Returns false if there is no such row.
        /// </summary>
        internal bool SelfTestSetProperty(DesignerInterface obj, string translatedPropName, object value)
        {
            if (data == null)
                data = new DataSet();
            selectingobject = true;
            CurrentInterface = obj;
            DataTable props = FindDataTable(obj.SelectionClassName, obj);
            DataSource = props;
            selectingobject = false;
            foreach (DataRow row in props.Rows)
            {
                if (row["NAME"].ToString() != translatedPropName)
                    continue;
                props.RowChanging -= rowchangeevent;
                try
                {
                    row["VALUE"] = value;
                }
                finally
                {
                    props.RowChanging += rowchangeevent;
                }
                RowChange(this, new DataRowChangeEventArgs(row, DataRowAction.Change));
                return true;
            }
            return false;
        }

        protected override void OnPaint(PaintEventArgs pe)
        {
            // TODO: Agregar código de dibujo personalizado aquí

            // Llamando a la clase base OnPaint
            base.OnPaint(pe);
        }
        // Compares two Variant values to detect no-op property commits. Selecting an
        // object re-commits the focused property row (PrintCondition is the first row),
        // which must NOT apply the value again nor create an undo entry. Not used for
        // binary/image values (byte arrays all stringify the same).
        private static bool SameVariantValue(Variant a, Variant b)
        {
            try
            {
                object oa = a.AsObject();
                object ob = b.AsObject();
                if (oa == null) return ob == null;
                if (ob == null) return false;
                if (oa.Equals(ob)) return true;
                return string.Equals(oa.ToString(), ob.ToString(), StringComparison.Ordinal);
            }
            catch
            {
                return false; // on any uncertainty treat as changed (apply)
            }
        }

        // Depth of BeginUndoGroup calls, and the undo group used meanwhile (0: not created yet)
        private int FUndoGroupDepth;
        private int FUndoGroupId;

        /// <summary>
        /// Starts recording the property changes committed until <see cref="EndUndoGroup"/> as a
        /// single undo step (e.g. the font name, size and style set by a font dialog).
        /// </summary>
        internal void BeginUndoGroup()
        {
            if (FUndoGroupDepth == 0)
                FUndoGroupId = 0;
            FUndoGroupDepth++;
        }

        /// <summary>
        /// Ends the undo step started by <see cref="BeginUndoGroup"/>.
        /// </summary>
        internal void EndUndoGroup()
        {
            if (FUndoGroupDepth > 0)
                FUndoGroupDepth--;
            if (FUndoGroupDepth == 0)
                FUndoGroupId = 0;
        }

        // Model state of the selected items before a change, or null if the report records no undo
        private List<FrameMainDesigner.UndoItemState> CaptureUndoStates()
        {
            if (CurrentInterface == null || CurrentInterface.SelectionList.Count == 0)
                return null;
            ReportItem firstItem = CurrentInterface.SelectionList.Values[0];
            if (firstItem.Report == null || firstItem.Report.UndoCue == null)
                return null;
            var states = new List<FrameMainDesigner.UndoItemState>();
            foreach (ReportItem ritem in CurrentInterface.SelectionList.Values)
                states.Add(FrameMainDesigner.CaptureUndoState(ritem));
            return states;
        }

        // Records, as one undo group, what the change modified in every selected item: the MODEL
        // values with their real types (twips, enum values, booleans...) read before and after it,
        // never the text or units shown by the inspector ("2.540" cm, "Left"), which undo can not
        // restore. Each item keeps its own old value in a multiple selection.
        private void RecordUndoChanges(List<FrameMainDesigner.UndoItemState> states)
        {
            if (states == null || states.Count == 0)
                return;
            BaseReport report = states[0].Item.Report;
            if (report == null || report.UndoCue == null)
                return;
            int groupId = FUndoGroupDepth > 0 ? FUndoGroupId : 0;
            foreach (FrameMainDesigner.UndoItemState state in states)
                FrameMainDesigner.AddUndoChanges(report, state, ref groupId);
            if (FUndoGroupDepth > 0)
                FUndoGroupId = groupId;
        }

        // Sets the property in every selected item recording its undo operations
        private void SetPropertyWithUndo(string propName, Variant newvalue)
        {
            List<FrameMainDesigner.UndoItemState> undoStates = CaptureUndoStates();
            try
            {
                CurrentInterface.SetPropertyMulti(propName, newvalue);
            }
            finally
            {
                // Also after a failure: the items already changed can be undone
                RecordUndoChanges(undoStates);
            }
        }

        private void RowChange(object sender, DataRowChangeEventArgs args)
        {
            object newValue = DBNull.Value;
            bool executeonpropchange = false;
            string propName = args.Row["NAME"].ToString();

            // Capture old value before modification for undo / no-op detection
            Variant oldValue = new Variant();
            bool haveOld = false;
            if (CurrentInterface != null && CurrentInterface.SelectionList.Count > 0)
            {
                try
                {
                    oldValue = CurrentInterface.GetPropertyMulti(propName);
                    haveOld = true;
                }
                catch
                {
                    // Property may not exist yet
                }
            }

            if (args.Row["VALUE"] != DBNull.Value)
            {
                if (CurrentInterface != null)
                {
                    if ((bool)args.Row["TWIPS"])
                    {
                        Variant newvar = Twips.TwipsFromUnits(Variant.VariantFromObject(args.Row["VALUE"]));
                        // Only apply/record when the value really changed: selecting an
                        // object re-commits the focused row (often PrintCondition) and
                        // must not create a spurious undo entry.
                        if (!haveOld || !SameVariantValue(oldValue, newvar))
                        {
                            SetPropertyWithUndo(propName, newvar);
                            executeonpropchange = true;
                        }
                    }
                    else
                    {
                        bool isbinary = false;
                        if ((int)args.Row["TYPEENUM"] == System.Convert.ToInt32(ObjectInspectorCellType.Image))
                            isbinary = true;
                        if (!isbinary)
                        {
                            object newValueObject = args.Row["VALUE"];
                            object interfaceParamObject = args.Row["INTERFACE"];
                            if ((interfaceParamObject is DesignerInterfaceParam) && (propName == Translator.TranslateStr(194)))
                            {
                                var interfaceParam = (DesignerInterfaceParam)interfaceParamObject;
                                var param = (Param)interfaceParam.ReportItemObject;
                                switch (param.ParamType)
                                {
                                    case ParamType.Date:
                                        DateTime newDate = Convert.ToDateTime(newValueObject);
                                        newDate = newDate.Date;
                                        newValueObject = newDate;
                                        break;
                                    case ParamType.DateTime:
                                        DateTime newDate2 = Convert.ToDateTime(newValueObject);
                                        newValueObject = newDate2;
                                        break;
                                    case ParamType.Time:
                                        DateTime newDate3 = Convert.ToDateTime(newValueObject);
                                        newValueObject = newDate3;
                                        break;
                                }
                            }
                            Variant newvar = Variant.VariantFromObject(newValueObject);
                            // Only apply/record on a real change (see note above).
                            if (!haveOld || !SameVariantValue(oldValue, newvar))
                            {
                                SetPropertyWithUndo(propName, newvar);
                                executeonpropchange = true;
                            }
                        }
                    }

                }
                newValue = args.Row["VALUE"];
            }
            if (args.Row["VALUEBIN"] != DBNull.Value)
            {
                if (CurrentInterface != null)
                {
                    bool isbinary = false;
                    if ((int)args.Row["TYPEENUM"] == System.Convert.ToInt32(ObjectInspectorCellType.Image))
                        isbinary = true;
                    if (isbinary)
                    {
                        SetPropertyWithUndo(propName, Variant.VariantFromObject(args.Row["VALUEBIN"]));
                        executeonpropchange = true;
                    }
                }
                newValue = args.Row["VALUEBIN"];
            }

            if ((executeonpropchange) && (OnPropertyChange != null))
            {
                OnPropertyChange(propName, newValue);
            }
        }
    }
}
