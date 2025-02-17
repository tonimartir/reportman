using Reportman.Drawing;
using Reportman.Reporting;
using System;
using System.Windows.Forms;

namespace Reportman.Designer
{
    public partial class SQLEditor : UserControl
    {
        Report Report;
        string datainfoalias;
        public SQLEditor()
        {
            InitializeComponent();
            Dock = DockStyle.Fill;

            BOK.Text = Translator.TranslateStr(93);
            bcancel.Text = Translator.TranslateStr(94);

        }
        private void Init()
        {

        }
        public static bool ShowDialog(ref string sql, FrameMainDesigner framemain, string datainfotalias)
        {
            using (Form newform = new Form())
            {
                newform.ShowIcon = false;
                newform.ShowInTaskbar = false;
                newform.StartPosition = FormStartPosition.CenterScreen;
                newform.Width = Convert.ToInt32(800 * Reportman.Drawing.Windows.GraphicUtils.DPIScale);
                newform.Height = Convert.ToInt32(600 * Reportman.Drawing.Windows.GraphicUtils.DPIScale);
                SQLEditor dia = new SQLEditor();
                dia.Report = framemain.Report;
                dia.MemoSQL.Text = sql;
                dia.datainfoalias = datainfotalias;
                dia.Init();

                newform.Controls.Add(dia);
                if (newform.ShowDialog(framemain.FindForm()) == DialogResult.OK)
                {
                    sql = dia.MemoSQL.Text;
                    return true;
                }
                else
                    return false;
            }
        }

        private void BOK_Click(object sender, EventArgs e)
        {
            FindForm().DialogResult = DialogResult.OK;
        }

        private void bcancel_Click(object sender, EventArgs e)
        {
            FindForm().DialogResult = DialogResult.Cancel;
        }

        private void bshowdata_Click(object sender, EventArgs e)
        {
            DataInfo dinfo = Report.DataInfo[datainfoalias];
            DatabaseInfo dbinfo = Report.DatabaseInfo[dinfo.DatabaseAlias];
            dinfo.SQLOverride = MemoSQL.Text;
            try
            {
                dbinfo.Connect();
                dinfo.DisConnect();
                dinfo.Connect();
            }
            finally
            {
                dinfo.SQLOverride = "";
            }
            Reportman.Reporting.Forms.DataShow.ShowData(Report, datainfoalias, this.FindForm());
        }
    }
}
