using Reportman.Drawing;
using Reportman.Reporting;
using System;
using System.Windows.Forms;

namespace Reportman.Designer
{
    /// <summary>
    /// Dialog for editing a report's design grid settings, including spacing, color,
    /// line style, and whether the grid is enabled and visible.
    /// </summary>
    public partial class GridOptions : Form
    {
        /// <summary>
        /// Initializes a new instance of the <see cref="GridOptions"/> dialog and
        /// localizes all control labels and button text using the current translator.
        /// </summary>
        public GridOptions()
        {
            InitializeComponent();

            bok.Text = Translator.TranslateStr(93);
            bcancel.Text = Translator.TranslateStr(94);
            Text = Translator.TranslateStr(94);

            lhorzontal.Text = Translator.TranslateStr(180);
            lvertical.Text = Translator.TranslateStr(181);
            lcolor.Text = Translator.TranslateStr(185);
            lenabled.Text = Translator.TranslateStr(182);
            lvisible.Text = Translator.TranslateStr(183);
            lcombogridstyle.Text = Translator.TranslateStr(646);

            combostyle.Items[0] = Translator.TranslateStr(896);
            combostyle.Items[1] = Translator.TranslateStr(184);
        }
        /// <summary>
        /// Displays the grid-options dialog pre-populated with the specified report's
        /// current grid settings and writes back any changes the user confirms.
        /// </summary>
        /// <param name="nreport">The report whose grid settings are edited.</param>
        /// <returns><c>true</c> if the user confirmed changes; <c>false</c> if cancelled.</returns>
        public static bool AlterGridOptions(Report nreport)
        {
            bool nresult = false;

            using (GridOptions ndia = new GridOptions())
            {
                System.Drawing.Color oldcolor = GraphicUtils.ColorFromInteger(nreport.GridColor);
                ndia.bcolor.BackColor = oldcolor;
                ndia.checkenabled.Checked = nreport.GridEnabled;
                string oldwidth = Twips.TextFromTwips(nreport.GridWidth);
                string oldheight = Twips.TextFromTwips(nreport.GridHeight);
                ndia.textwidth.Text = oldwidth;
                ndia.textheight.Text = oldheight;
                if (nreport.GridLines)
                    ndia.combostyle.SelectedIndex = 1;
                else
                    ndia.combostyle.SelectedIndex = 0;
                ndia.checkvisible.Checked = nreport.GridVisible;
                if (ndia.ShowDialog() == DialogResult.OK)
                {
                    bool gridlines = (ndia.combostyle.SelectedIndex == 1);
                    // A value is read back only if edited: the text rounds the twips
                    int gridwidth = ndia.textwidth.Text == oldwidth ? nreport.GridWidth : Twips.TwipsFromText(ndia.textwidth.Text);
                    int gridheight = ndia.textheight.Text == oldheight ? nreport.GridHeight : Twips.TwipsFromText(ndia.textheight.Text);
                    int gridcolor = ndia.bcolor.BackColor == oldcolor ? nreport.GridColor :
                        Reportman.Drawing.GraphicUtils.IntegerFromColor(ndia.bcolor.BackColor);
                    // The grid is saved in the report
                    if (nreport.GridLines != gridlines || nreport.GridEnabled != ndia.checkenabled.Checked ||
                        nreport.GridWidth != gridwidth || nreport.GridHeight != gridheight ||
                        nreport.GridColor != gridcolor || nreport.GridVisible != ndia.checkvisible.Checked)
                        nreport.Modified = true;
                    nreport.GridLines = gridlines;
                    nreport.GridEnabled = ndia.checkenabled.Checked;
                    nreport.GridWidth = gridwidth;
                    nreport.GridHeight = gridheight;
                    nreport.GridColor = gridcolor;
                    nreport.GridVisible = ndia.checkvisible.Checked;
                    nresult = true;
                }
            }
            return nresult;
        }

        private void bcolor_Click(object sender, EventArgs e)
        {
            colordialog1.Color = bcolor.BackColor;
            if (colordialog1.ShowDialog() == DialogResult.OK)
                bcolor.BackColor = colordialog1.Color;
        }
    }
}
