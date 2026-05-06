using System;
using System.Drawing;
using System.Windows.Forms;
using Reportman.Drawing;

namespace Reportman.Designer
{
    internal static class MultilineTextEditorDialog
    {
        public static bool ShowDialog(ref string text, FrameMainDesigner framemain, string title)
        {
            using (Form dialog = new Form())
            using (TextBox memo = new TextBox())
            using (Button okButton = new Button())
            using (Button cancelButton = new Button())
            {
                dialog.ShowIcon = false;
                dialog.ShowInTaskbar = false;
                dialog.StartPosition = FormStartPosition.CenterScreen;
                dialog.MinimizeBox = false;
                dialog.MaximizeBox = false;
                dialog.FormBorderStyle = FormBorderStyle.Sizable;
                dialog.Width = Convert.ToInt32(700 * Reportman.Drawing.Windows.GraphicUtils.DPIScale);
                dialog.Height = Convert.ToInt32(500 * Reportman.Drawing.Windows.GraphicUtils.DPIScale);
                dialog.Text = string.IsNullOrEmpty(title) ? "Edit text" : title;
                dialog.AcceptButton = okButton;
                dialog.CancelButton = cancelButton;

                memo.Multiline = true;
                memo.AcceptsReturn = true;
                memo.AcceptsTab = true;
                memo.MaxLength = 0;
                memo.ScrollBars = ScrollBars.Both;
                memo.WordWrap = false;
                memo.Font = new Font("Consolas", 10F, FontStyle.Regular, GraphicsUnit.Point);
                memo.Text = text ?? string.Empty;
                memo.Dock = DockStyle.Fill;

                okButton.Text = Translator.TranslateStr(93);
                okButton.DialogResult = DialogResult.OK;
                okButton.Anchor = AnchorStyles.Right | AnchorStyles.Bottom;

                cancelButton.Text = Translator.TranslateStr(94);
                cancelButton.DialogResult = DialogResult.Cancel;
                cancelButton.Anchor = AnchorStyles.Right | AnchorStyles.Bottom;

                FlowLayoutPanel buttons = new FlowLayoutPanel();
                buttons.Dock = DockStyle.Bottom;
                buttons.FlowDirection = FlowDirection.RightToLeft;
                buttons.Padding = new Padding(8);
                buttons.Height = Convert.ToInt32(48 * Reportman.Drawing.Windows.GraphicUtils.DPIScale);
                buttons.Controls.Add(cancelButton);
                buttons.Controls.Add(okButton);

                Panel content = new Panel();
                content.Dock = DockStyle.Fill;
                content.Padding = new Padding(8, 8, 8, 0);
                content.Controls.Add(memo);

                dialog.Controls.Add(content);
                dialog.Controls.Add(buttons);

                if (dialog.ShowDialog(framemain.FindForm()) == DialogResult.OK)
                {
                    text = memo.Text;
                    return true;
                }

                return false;
            }
        }
    }
}