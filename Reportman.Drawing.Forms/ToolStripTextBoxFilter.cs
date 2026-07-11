using System;
using System.ComponentModel;
using System.Drawing;
using System.Windows.Forms;

namespace Reportman.Drawing.Forms
{
    /// <summary>
    /// A ToolStrip-hosted label-and-textbox filter control that raises a debounced
    /// <see cref="DelayedTextChanged"/> event after the user stops typing for a configurable delay.
    /// </summary>
    public class ToolStripTextBoxFilter : ToolStripControlHost
    {
        private Label label;
        private TextBox textBox;
        private TableLayoutPanel panel;
        private Timer delayTimer;

        /// <summary>
        /// Initializes a new instance of the <see cref="ToolStripTextBoxFilter"/> class and its layout panel components.
        /// </summary>
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
        /// <summary>
        /// Sets the input focus to the filter's textbox control.
        /// </summary>
        public void FocusFilter()
        {
            this.textBox.Focus();
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
        /// <summary>
        /// Occurs when the textbox content is changed and the debouncing delay has elapsed.
        /// </summary>
        public event EventHandler DelayedTextChanged;
        /// <summary>
        /// Gets or sets the text displayed on the filter's label.
        /// </summary>
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
        /// <summary>
        /// Gets or sets the text entered into the filter's textbox.
        /// </summary>
        [DesignerSerializationVisibility(DesignerSerializationVisibility.Visible)]
        public string TextBoxText
        {
            get { return textBox.Text; }
            set { textBox.Text = value; }
        }
        /// <summary>
        /// Gets or sets the delay in milliseconds for debouncing textbox input before raising the <see cref="DelayedTextChanged"/> event.
        /// </summary>
        [DesignerSerializationVisibility(DesignerSerializationVisibility.Visible)]
        public int TextChangeDelay { get; set; } = 1000;
        /// <summary>
        /// Gets or sets the width of the filter's textbox control.
        /// </summary>
        [DesignerSerializationVisibility(DesignerSerializationVisibility.Visible)]
        public int TextBoxWidth
        {
            get { return textBox.Width; }
            set { textBox.Width = value; }
        }

        /// <summary>
        /// Returns the underlying textbox control.
        /// </summary>
        /// <returns>The <see cref="TextBox"/> control.</returns>
        public TextBox GetTextBox()
        {
            return textBox;
        }

        /// <summary>
        /// Returns the underlying label control.
        /// </summary>
        /// <returns>The <see cref="Label"/> control.</returns>
        public Label GetLabel()
        {
            return label;
        }
    }
}
