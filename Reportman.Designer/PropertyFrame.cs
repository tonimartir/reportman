using Reportman.Reporting;
using System;
using System.Windows.Forms;

namespace Reportman.Designer
{
    internal partial class PropertyFrame : UserControl
    {
        public IObjectInspector inspector;
        FrameMainDesigner FrameMain;
        public PropertyFrame()
        {
            InitializeComponent();
            // Add Object inspector grid
            inspector = new ObjectInspector();
            //inspector = new Inspector();
            inspector.ComboSelection = this.comboselection;
            inspector.Dock = DockStyle.Fill;

            panelclient.Controls.Add(inspector.GetControl());
        }
        public void Initialize(FrameMainDesigner nFrameMain)
        {
            FrameMain = nFrameMain;
            inspector.Initialize(FrameMain);
        }
        public void SetObject(DesignerInterface nobj)
        {
            inspector.SetObject(nobj);
        }

        private void comboselection_Click(object sender, EventArgs e)
        {
        }

        private void comboselection_SelectedIndexChanged(object sender, EventArgs e)
        {
            inspector.SetObjectFromCombo();
        }

        private void bback_Click(object sender, EventArgs e)
        {
            EditSubReport subreportedit = inspector.SubReportEdit;
            foreach (PrintItem item in subreportedit.SelectedItems.Values)
            {
                if (item is PrintPosItem)
                {
                    PrintPosItem pitem = (PrintPosItem)item;
                    Section nsection = pitem.Section;
                    nsection.Components.Remove(pitem);
                    nsection.Components.Insert(0, pitem);
                }
            }
            subreportedit.Redraw();
        }

        private void bforward_Click(object sender, EventArgs e)
        {
            EditSubReport subreportedit = inspector.SubReportEdit;
            foreach (PrintItem item in subreportedit.SelectedItems.Values)
            {
                if (item is PrintPosItem)
                {
                    PrintPosItem pitem = (PrintPosItem)item;
                    Section nsection = pitem.Section;
                    nsection.Components.Remove(pitem);
                    nsection.Components.Add(pitem);
                }
            }
            subreportedit.Redraw();
        }
    }
}
