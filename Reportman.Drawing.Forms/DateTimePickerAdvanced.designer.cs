namespace Reportman.Drawing.Forms
{
    partial class DateTimePickerAdvanced
    {
        /// <summary> 
        /// Required designer variable.
        /// </summary>
        private System.ComponentModel.IContainer components = null;

        /// <summary> 
        /// Clean up any resources being used.
        /// </summary>
        /// <param name="disposing">true if managed resources should be disposed; otherwise, false.</param>
        protected override void Dispose(bool disposing)
        {
            if (disposing && (components != null))
            {
                components.Dispose();
            }
            base.Dispose(disposing);
        }

        #region Component Designer generated code

        /// <summary> 
        /// Required method for Designer support - do not modify 
        /// the contents of this method with the code editor.
        /// </summary>
        private void InitializeComponent()
        {
            this.components = new System.ComponentModel.Container();
            this.errorProvider1 = new System.Windows.Forms.ErrorProvider(this.components);
            this.txtDate = new System.Windows.Forms.TextBox();
            this.btnCalendar = new Reportman.Drawing.Forms.DateDropButton();
            ((System.ComponentModel.ISupportInitialize)(this.errorProvider1)).BeginInit();
            this.SuspendLayout();
            // 
            // errorProvider1
            // 
            this.errorProvider1.ContainerControl = this;
            // 
            // txtDate
            // 
            this.txtDate.Dock = System.Windows.Forms.DockStyle.Fill;
            this.txtDate.Location = new System.Drawing.Point(0, 0);
            this.txtDate.Margin = new System.Windows.Forms.Padding(4, 4, 4, 4);
            this.txtDate.Name = "txtDate";
            this.txtDate.Size = new System.Drawing.Size(124, 22);
            this.txtDate.TabIndex = 0;
            // 
            // btnCalendar
            // 
            this.btnCalendar.Dock = System.Windows.Forms.DockStyle.Right;
            this.btnCalendar.FlatStyle = System.Windows.Forms.FlatStyle.Flat;
            this.btnCalendar.Location = new System.Drawing.Point(124, 0);
            this.btnCalendar.Margin = new System.Windows.Forms.Padding(4, 4, 4, 4);
            this.btnCalendar.Name = "btnCalendar";
            this.btnCalendar.Size = new System.Drawing.Size(26, 25);
            this.btnCalendar.TabIndex = 1;
            this.btnCalendar.TabStop = false;
            this.btnCalendar.UseVisualStyleBackColor = true;
            // 
            // DateTimePickerAdvanced
            // 
            this.AutoScaleDimensions = new System.Drawing.SizeF(8F, 16F);
            this.AutoScaleMode = System.Windows.Forms.AutoScaleMode.Font;
            this.BorderStyle = System.Windows.Forms.BorderStyle.FixedSingle;
            this.Controls.Add(this.txtDate);
            this.Controls.Add(this.btnCalendar);
            this.Margin = new System.Windows.Forms.Padding(4, 4, 4, 4);
            this.Name = "DateTimePickerAdvanced";
            this.Size = new System.Drawing.Size(150, 25);
            ((System.ComponentModel.ISupportInitialize)(this.errorProvider1)).EndInit();
            this.ResumeLayout(false);
            this.PerformLayout();

        }

        #endregion

        private System.Windows.Forms.ErrorProvider errorProvider1;
        protected System.Windows.Forms.TextBox txtDate;
        protected Reportman.Drawing.Forms.DateDropButton btnCalendar;
    }
}
