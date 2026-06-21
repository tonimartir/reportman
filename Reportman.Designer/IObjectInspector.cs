using System.Windows.Forms;

namespace Reportman.Designer
{
    internal interface IObjectInspector
    {
        ComboBox ComboSelection { get; set; }
        DockStyle Dock { get; set; }
        Control GetControl();
        void Initialize(FrameMainDesigner nFrameMain);
        void SetObject(DesignerInterface nobj);
        void SetObjectFromCombo();
        EditSubReport SubReportEdit { get; set; }
        FrameStructure Structure { get; set; }
        PropertyChanged OnPropertyChange { get; set; }
        void FinishEdit();
    }
    /// <summary>
    /// Callback raised when an inspected object's property is edited, reporting the
    /// property name and its new value.
    /// </summary>
    public delegate void PropertyChanged(string propertyName, object value);

}
