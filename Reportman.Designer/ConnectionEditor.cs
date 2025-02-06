using Reportman.Drawing;
using Reportman.Reporting;
using System;
using System.Windows.Forms;

namespace Reportman.Designer
{
    public partial class ConnectionEditor : UserControl
    {
        Report Report;
        string datainfoalias;
        public ConnectionEditor()
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
                newform.Width = Convert.ToInt32(800 * Reportman.Drawing.GraphicUtils.DPIScale);
                newform.Height = Convert.ToInt32(600 * Reportman.Drawing.GraphicUtils.DPIScale);
                ConnectionEditor dia = new ConnectionEditor();
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

        private void Btestconnection_Click(object sender, EventArgs e)
        {
            DatabaseInfo dbinfo = Report.DatabaseInfo[datainfoalias];
            dbinfo.DisConnect();
            string oldconnection = dbinfo.ConnectionString;
            try
            {
                dbinfo.ConnectionString = MemoSQL.Text;
                dbinfo.Connect();
                dbinfo.DisConnect();
            }
            finally
            {
                dbinfo.ConnectionString = oldconnection;
            }
            MessageBox.Show("Test connection successfull");

        }
    }
}
