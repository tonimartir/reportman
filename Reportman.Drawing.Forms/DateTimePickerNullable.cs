#region Copyright
/*
 *  Report Manager:  Database Reporting tool for .Net and Mono
 *
 *     The contents of this file are subject to the MPL License
 *     with optional use of GPL or LGPL licenses.
 *     You may not use this file except in compliance with the
 *     Licenses. You may obtain copies of the Licenses at:
 *     http://reportman.sourceforge.net/license
 *
 *     Software is distributed on an "AS IS" basis,
 *     WITHOUT WARRANTY OF ANY KIND, either
 *     express or implied.  See the License for the specific
 *     language governing rights and limitations.
 *
 *  Copyright (c) 1994 - 2008 Toni Martir (toni@reportman.es)
 *  All Rights Reserved.
*/
#endregion

using System;
using System.ComponentModel;
using System.Drawing;
using System.Windows.Forms;
using System.Windows.Forms.VisualStyles;

namespace Reportman.Drawing.Forms
{
    /// <summary>
    /// Nullable DateTime picker
    /// </summary>	
    public class DateTimePickerNullable : System.Windows.Forms.DateTimePicker
    {
        /// <summary>
        /// Represents the maximum date value supported by the nullable date time picker.
        /// </summary>
        public static readonly System.DateTime MaxDateValue = new System.DateTime(9997, 12, 31);
        /// <summary>
        /// Represents the minimum date value supported by the nullable date time picker.
        /// </summary>
        public static readonly System.DateTime MinDateValue = new System.DateTime(1900, 12, 31);
        private DateTimePickerFormat oldFormat = DateTimePickerFormat.Long;
        private string oldCustomFormat = null;
        private bool bIsNull = false;

        /// <summary>
        /// Initializes a new instance of the <see cref="DateTimePickerNullable"/> class, setting the default maximum and minimum date ranges.
        /// </summary>
        public DateTimePickerNullable() : base()
        {
            MaxDate = MaxDateValue;
            MinDate = System.DateTime.MinValue;
        }
        /// <summary>
        /// Gets or sets a value indicating whether pressing the Enter key acts as a Tab key to move focus.
        /// </summary>
        [DesignerSerializationVisibility(DesignerSerializationVisibility.Visible)]
        public bool EnterAsTab { get; set; }

        /// <summary>
        /// Delegate field for events raised before the Enter key triggers tab focus movement.
        /// </summary>
        public BeforeEnterTabEvent BeforeEnterTab;
        /// <summary>
        /// Processes a command key, optionally converting the Enter key to a Tab key.
        /// </summary>
        /// <param name="msg">A <see cref="Message"/>, passed by reference, that represents the window message to process.</param>
        /// <param name="keyData">One of the <see cref="Keys"/> values that represents the key to process.</param>
        /// <returns>true if the character was processed by the control; otherwise, false.</returns>
        protected override bool ProcessCmdKey(ref Message msg, Keys keyData)
        {
            if (EnterAsTab)
            {
                if (keyData == (Keys.Enter))
                {
                    bool cancelled = false;
                    BeforeEnterTab(ref cancelled);
                    if (!cancelled)
                        SendKeys.Send("{TAB}");
                }
            }
            return base.ProcessCmdKey(ref msg, keyData);
        }
        /// <summary>
        /// Gets or sets the date/time value assigned to the control. Returns <see cref="DateTime.MinValue"/> if the value is null.
        /// </summary>
        [DesignerSerializationVisibility(DesignerSerializationVisibility.Visible)]
        public new DateTime Value
        {
            get
            {
                if (bIsNull)
                    return DateTime.MinValue;
                else
                    return base.Value;
            }
            set
            {
                if (value == DateTime.MinValue)
                {
                    if (bIsNull == false)
                    {
                        oldFormat = this.Format;
                        oldCustomFormat = this.CustomFormat;
                        bIsNull = true;
                    }

                    this.Format = DateTimePickerFormat.Custom;
                    this.CustomFormat = " ";
                }
                else
                {
                    if (bIsNull)
                    {
                        this.Format = oldFormat;
                        this.CustomFormat = oldCustomFormat;
                        bIsNull = false;
                    }
                    base.Value = value;
                }
            }
        }
        /// <summary>
        /// Raises the ValueChanged event and updates the internal null state.
        /// </summary>
        /// <param name="eventargs">An <see cref="EventArgs"/> that contains the event data.</param>
        protected override void OnValueChanged(EventArgs eventargs)
        {
            bIsNull = (Value == DateTime.MinValue);
            base.OnValueChanged(eventargs);
        }
        /// <summary>
        /// Raises the Validated event and updates the internal null state.
        /// </summary>
        /// <param name="e">An <see cref="EventArgs"/> that contains the event data.</param>
        protected override void OnValidated(EventArgs e)
        {
            bIsNull = (Value == DateTime.MinValue);
            base.OnValidated(e);
        }
        /// <summary>
        /// Raises the CloseUp event and restores formats if a previously null value was selected.
        /// </summary>
        /// <param name="eventargs">An <see cref="EventArgs"/> that contains the event data.</param>
        protected override void OnCloseUp(EventArgs eventargs)
        {
            if (Control.MouseButtons == MouseButtons.None)
            {
                if (bIsNull)
                {
                    this.Format = oldFormat;
                    this.CustomFormat = oldCustomFormat;
                    bIsNull = false;
                }
            }
            base.OnCloseUp(eventargs);
        }

        /// <summary>
        /// Handles key presses down, allowing null values to be cleared or typed into, and suppression of the Return key if EnterAsTab is true.
        /// </summary>
        /// <param name="e">A <see cref="KeyEventArgs"/> containing event data.</param>
        protected override void OnKeyDown(KeyEventArgs e)
        {
            if (EnterAsTab)
            {
                if (e.KeyCode == Keys.Return)
                    e.SuppressKeyPress = true;
            }
            base.OnKeyDown(e);
            if (this.Value == DateTime.MinValue)
            {

                char keychar = '0';

                if ((e.KeyValue >= (int)Keys.NumPad0) && (e.KeyValue <= (int)Keys.NumPad9))
                {
                    keychar = (char)(((byte)keychar) + (e.KeyValue - Keys.NumPad0));
                    this.Value = DateTime.Today;
                }
                else if (e.KeyValue >= ((int)Keys.D0) && e.KeyValue <= ((int)Keys.D9))
                {
                    keychar = (char)(((byte)keychar) + (e.KeyValue - Keys.D0));
                    this.Value = DateTime.Today;
                }
                OnValueChanged(new EventArgs());

                SendKeys.Send("{RIGHT 1}");
                SendKeys.Send(keychar.ToString());
                e.Handled = true;
            }
            if (e.KeyCode == Keys.Delete)
            {
                this.Value = DateTime.MinValue;
                OnValueChanged(new EventArgs());
            }

        }
        /// <summary>
        /// Custom paints the DateTimePicker control, supporting empty/null displays.
        /// </summary>
        /// <param name="e">A <see cref="PaintEventArgs"/> containing paint event data.</param>
        protected override void OnPaint(System.Windows.Forms.PaintEventArgs e)
        {
#if MONO
			base.OnPaint(e);
            Graphics g = this.CreateGraphics();
            Rectangle dropDownRectangle =
               new Rectangle(ClientRectangle.Width - 17, 0, 17, 16);
            Brush bkgBrush;
            ComboBoxState visualState;

            //When the control is enabled the brush is set to Backcolor, 
            //otherwise to color stored in _backDisabledColor
            if (this.Enabled)
            {
                bkgBrush = new SolidBrush(this.BackColor);
                visualState = ComboBoxState.Normal;
            }
            else
            {
                bkgBrush = new SolidBrush(SystemColors.ButtonFace);
                visualState = ComboBoxState.Disabled;
            }
            // Painting...in action

            //Filling the background
            g.FillRectangle(bkgBrush, 0, 0, ClientRectangle.Width, ClientRectangle.Height);

            //Drawing the datetime text
            g.DrawString(this.Text, this.Font, Brushes.Black, 0, 2);

            //Drawing the dropdownbutton using ComboBoxRenderer
			if (ComboBoxRenderer.IsSupported)
            	ComboBoxRenderer.DrawDropDownButton(g, dropDownRectangle, visualState);
			{
				using (SolidBrush grebrush = new SolidBrush(SystemColors.ButtonFace))
				{
					g.FillRectangle(grebrush,dropDownRectangle);
					using (Pen bpen = new Pen(SystemColors.WindowText))
					{
						g.DrawRectangle(bpen,dropDownRectangle);
						StringFormat nformat = new StringFormat();
						nformat.Alignment = StringAlignment.Center;
						nformat.LineAlignment = StringAlignment.Center;
						g.DrawString("-",this.Font,Brushes.Black,dropDownRectangle,nformat);
					}
				}
			}

            g.Dispose();
            bkgBrush.Dispose();
			return;
#else
            Graphics g = this.CreateGraphics();

            //The dropDownRectangle defines position and size of dropdownbutton block, 
            //the width is fixed to 17 and height to 16. 
            //The dropdownbutton is aligned to right
            Rectangle dropDownRectangle =
               new Rectangle(ClientRectangle.Width - 17, 0, 17, 16);
            Brush bkgBrush;
            ComboBoxState visualState;

            //When the control is enabled the brush is set to Backcolor, 
            //otherwise to color stored in _backDisabledColor
            if (this.Enabled)
            {
                bkgBrush = new SolidBrush(this.BackColor);
                visualState = ComboBoxState.Normal;
            }
            else
            {
                bkgBrush = new SolidBrush(SystemColors.ButtonFace);
                visualState = ComboBoxState.Disabled;
            }

            // Painting...in action

            //Filling the background
            g.FillRectangle(bkgBrush, 0, 0, ClientRectangle.Width, ClientRectangle.Height);

            //Drawing the datetime text
            g.DrawString(this.Text, this.Font, Brushes.Black, 0, 2);

            //Drawing the dropdownbutton using ComboBoxRenderer
            ComboBoxRenderer.DrawDropDownButton(g, dropDownRectangle, visualState);

            g.Dispose();
            bkgBrush.Dispose();
#endif
        }
    }
}
