using Reportman.Drawing;
using System;
using System.Windows.Forms;

namespace Reportman.Designer
{
    /// <summary>
    /// Modal dialog that hosts the report library configuration control, persisting the
    /// settings when the user confirms with OK.
    /// </summary>
    public partial class LibraryConfigForm : Form
    {
        /// <summary>
        /// Initializes a new instance of the LibraryConfigForm class, setting up controls and localizing UI strings.
        /// </summary>
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
        /// <summary>
        /// Shows the library configuration form as a modal dialog.
        /// </summary>
        /// <param name="parent">The parent window that owns the modal dialog.</param>
        /// <returns>True if the user confirmed changes (clicked OK); otherwise, false.</returns>
        public static bool ShowConfig(IWin32Window parent)
        {
            using (LibraryConfigForm dia = new LibraryConfigForm())
            {
                return dia.ShowDialog(parent) == DialogResult.OK;
            }
        }
    }
}
