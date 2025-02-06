using Reportman.Drawing;
using System;
using System.Windows.Forms;

namespace Reportman.Designer
{
    public partial class LibraryConfigForm : Form
    {
        public LibraryConfigForm()
        {
            InitializeComponent();

            Text = Translator.TranslateStr(1122);
            bok.Text = Translator.TranslateStr(93);
            bcancel.Text = Translator.TranslateStr(94);

            libConfig.Initialize();
        }

        private void bok_Click(object sender, EventArgs e)
        {
            libConfig.Save();
            DialogResult = DialogResult.OK;
        }

        private void bcancel_Click(object sender, EventArgs e)
        {
            DialogResult = DialogResult.Cancel;
        }
        public static bool ShowConfig(IWin32Window parent)
        {
            using (LibraryConfigForm dia = new LibraryConfigForm())
            {
                return dia.ShowDialog(parent) == DialogResult.OK;
            }
        }
    }
}
