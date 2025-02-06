using System;
using System.ComponentModel;
using System.Drawing;
using System.Windows.Forms;

namespace Reportman.Drawing.Forms
{
    public class ToolStripTextBoxFilter : ToolStripControlHost
    {
        private Label label;
        private TextBox textBox;
        private TableLayoutPanel panel;
        private Timer delayTimer;

        public ToolStripTextBoxFilter() : base(new TableLayoutPanel())
        {
            panel = (TableLayoutPanel)this.Control;
            panel.RowStyles.Add(new RowStyle(SizeType.AutoSize, 0));
            panel.RowStyles.Add(new RowStyle(SizeType.AutoSize, 0));
            panel.ColumnStyles.Add(new ColumnStyle(SizeType.AutoSize, 0));
            panel.AutoSize = true;
            panel.Anchor = AnchorStyles.Top | AnchorStyles.Bottom;
            InitializeComponents();
        }

        private void InitializeComponents()
        {
            delayTimer = new Timer();
            delayTimer.Tick += DelayTimer_Tick;
            label = new Label();
            label.Margin = new Padding(0, 0, 0, 0);
            label.Padding = new Padding(0, 0, 0, 0);
            textBox = new TextBox();
            textBox.Margin = new Padding(0, 0, 0, 3);
            panel.Controls.Add(textBox);
            panel.Controls.Add(label);

            label.AutoSize = true;
            label.Anchor = AnchorStyles.Top | AnchorStyles.Bottom;
            // label.Location = new Point(0, 4); // Puedes ajustar la posición según sea necesario

            // textBox.Location = new Point(label.Width + 5, 0);
            textBox.Width = 100; // Puedes ajustar el ancho según sea necesario
            textBox.Anchor = AnchorStyles.Top | AnchorStyles.Bottom;

            textBox.TextChanged += TextBox_TextChanged;

            panel.AutoSize = true;
            panel.AutoSizeMode = AutoSizeMode.GrowAndShrink;
            panel.Padding = new Padding(0);
            panel.Margin = new Padding(0);

        }

        private void DelayTimer_Tick1(object sender, EventArgs e)
        {
            throw new NotImplementedException();
        }

        private void TextBox_TextChanged(object sender, EventArgs e)
        {
            delayTimer.Enabled = false;
            delayTimer.Interval = TextChangeDelay;
            delayTimer.Enabled = true;
        }
        private void DelayTimer_Tick(object sender, EventArgs e)
        {
            delayTimer.Enabled = false;
            DelayedTextChanged?.Invoke(this, EventArgs.Empty);
        }
        public event EventHandler DelayedTextChanged;
        [DesignerSerializationVisibility(DesignerSerializationVisibility.Visible)]
        public string LabelText
        {
            get { return label.Text; }
            set
            {
                label.Text = value;
                textBox.Location = new Point(label.Width + 5, 0); // Ajustar la posición del TextBox
            }
        }
        [DesignerSerializationVisibility(DesignerSerializationVisibility.Visible)]
        public string TextBoxText
        {
            get { return textBox.Text; }
            set { textBox.Text = value; }
        }
        [DesignerSerializationVisibility(DesignerSerializationVisibility.Visible)]
        public int TextChangeDelay { get; set; } = 1000;
        [DesignerSerializationVisibility(DesignerSerializationVisibility.Visible)]
        public int TextBoxWidth
        {
            get { return textBox.Width; }
            set { textBox.Width = value; }
        }

        public TextBox GetTextBox()
        {
            return textBox;
        }

        public Label GetLabel()
        {
            return label;
        }
    }
}
