using System;
using System.Drawing;
using System.Windows.Forms;

namespace Reportman.Drawing.Forms
{
    /// <summary>
    /// A simple modal dialog that prompts the user for a single value, either free text or a
    /// date, returning the entered value through its static Execute helpers.
    /// </summary>
    public partial class InputBox : Form
    {
        private bool dook;
        private bool isdate;
        /// <summary>
        /// Initializes a new instance of the <see cref="InputBox"/> dialog and its designer-generated components.
        /// </summary>
        public InputBox()
        {
            InitializeComponent();
        }

        private void InputBox_Load(object sender, EventArgs e)
        {
            bok.Text = Translator.TranslateStr(93);
            bcancel.Text = Translator.TranslateStr(271);
        }
        /// <summary>
        /// Displays a modal input dialog prompting the user for a text value.
        /// </summary>
        /// <param name="caption">The title text displayed in the dialog title bar.</param>
        /// <param name="prompt">The descriptive label text shown above the input field.</param>
        /// <param name="defaultvalue">The initial text pre-filled in the input field.</param>
        /// <returns>The text entered by the user, or <paramref name="defaultvalue"/> if the dialog was cancelled.</returns>
        public static string Execute(string caption, string prompt, string defaultvalue)
        {
            string aresult = defaultvalue;
            using (InputBox dia = new InputBox())
            {
                dia.Text = caption;
                dia.ltext.Text = prompt;
                dia.EditText.Text = defaultvalue;
                dia.ShowDialog();
                if (dia.dook)
                    aresult = dia.EditText.Text;
            }
            return aresult;
        }
        /// <summary>
        /// Displays a modal input dialog prompting the user to select a date.
        /// </summary>
        /// <param name="caption">The title text displayed in the dialog title bar.</param>
        /// <param name="prompt">The descriptive label text shown above the date picker.</param>
        /// <param name="value">On entry, the default date; on exit, the date selected by the user if confirmed.</param>
        /// <param name="dateformat">A custom date format string for the date picker, or an empty string for the default format.</param>
        /// <returns><see langword="true"/> if the user confirmed the selection; <see langword="false"/> if the dialog was cancelled.</returns>
        public static bool Execute(string caption, string prompt, ref DateTime value, string dateformat)
        {
            bool aresult = false;
            using (InputBox dia = new InputBox())
            {
                dia.Text = caption;
                dia.ltext.Text = prompt;
                dia.datepicker.Value = value;
                if (dateformat.Length > 0)
                    dia.datepicker.CustomFormat = dateformat;
                dia.isdate = true;
                dia.ShowDialog();
                if (dia.dook)
                {
                    value = dia.datepicker.Value;
                    aresult = true;
                }
            }
            return aresult;
        }
        /// <summary>
        /// Displays a modal input dialog prompting the user to select a date, using the default date format.
        /// </summary>
        /// <param name="caption">The title text displayed in the dialog title bar.</param>
        /// <param name="prompt">The descriptive label text shown above the date picker.</param>
        /// <param name="value">On entry, the default date; on exit, the date selected by the user if confirmed.</param>
        /// <returns><see langword="true"/> if the user confirmed the selection; <see langword="false"/> if the dialog was cancelled.</returns>
        public static bool Execute(string caption, string prompt, ref DateTime value)
        {
            return Execute(caption, prompt, ref value, "");
        }

        private void bok_Click(object sender, EventArgs e)
        {
            dook = true;
            Close();
        }

        private void bcancel_Click(object sender, EventArgs e)
        {
            Close();
        }

        private void InputBox_Scroll(object sender, ScrollEventArgs e)
        {

        }

        private void InputBox_Shown(object sender, EventArgs e)
        {
            if (isdate)
            {
                datepicker.Visible = true;
                EditText.Visible = false;
                maintable.Controls.Remove(EditText);
                maintable.Controls.Add(datepicker);
                datepicker.Focus();
            }
            else
                EditText.Focus();
            this.ClientSize = new Size(this.Width, maintable.Height);
        }
    }
}