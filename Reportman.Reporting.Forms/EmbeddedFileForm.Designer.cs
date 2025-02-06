namespace Reportman.Reporting.Forms
{
    partial class EmbeddedFileForm
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

        #region Windows Form Designer generated code

        /// <summary>
        /// Required method for Designer support - do not modify
        /// the contents of this method with the code editor.
        /// </summary>
        private void InitializeComponent()
        {
            this.tableLayoutPanel1 = new System.Windows.Forms.TableLayoutPanel();
            this.textModificationDate = new System.Windows.Forms.TextBox();
            this.labelModificationDate = new System.Windows.Forms.Label();
            this.textCreationDate = new System.Windows.Forms.TextBox();
            this.labelCreationDate = new System.Windows.Forms.Label();
            this.labelRelationShip = new System.Windows.Forms.Label();
            this.textMimeType = new System.Windows.Forms.TextBox();
            this.labelMimeType = new System.Windows.Forms.Label();
            this.textFilename = new System.Windows.Forms.TextBox();
            this.labelFileName = new System.Windows.Forms.Label();
            this.labelDescription = new System.Windows.Forms.Label();
            this.textDescription = new System.Windows.Forms.TextBox();
            this.comboRelationShip = new System.Windows.Forms.ComboBox();
            this.bok = new System.Windows.Forms.Button();
            this.bcancel = new System.Windows.Forms.Button();
            this.tableLayoutPanel1.SuspendLayout();
            this.SuspendLayout();
            // 
            // tableLayoutPanel1
            // 
            this.tableLayoutPanel1.AutoSize = true;
            this.tableLayoutPanel1.ColumnCount = 2;
            this.tableLayoutPanel1.ColumnStyles.Add(new System.Windows.Forms.ColumnStyle());
            this.tableLayoutPanel1.ColumnStyles.Add(new System.Windows.Forms.ColumnStyle(System.Windows.Forms.SizeType.Percent, 100F));
            this.tableLayoutPanel1.Controls.Add(this.textModificationDate, 1, 5);
            this.tableLayoutPanel1.Controls.Add(this.labelModificationDate, 0, 5);
            this.tableLayoutPanel1.Controls.Add(this.textCreationDate, 1, 4);
            this.tableLayoutPanel1.Controls.Add(this.labelCreationDate, 0, 4);
            this.tableLayoutPanel1.Controls.Add(this.labelRelationShip, 0, 3);
            this.tableLayoutPanel1.Controls.Add(this.textMimeType, 1, 2);
            this.tableLayoutPanel1.Controls.Add(this.labelMimeType, 0, 2);
            this.tableLayoutPanel1.Controls.Add(this.textFilename, 1, 1);
            this.tableLayoutPanel1.Controls.Add(this.labelFileName, 0, 1);
            this.tableLayoutPanel1.Controls.Add(this.labelDescription, 0, 0);
            this.tableLayoutPanel1.Controls.Add(this.textDescription, 1, 0);
            this.tableLayoutPanel1.Controls.Add(this.comboRelationShip, 1, 3);
            this.tableLayoutPanel1.Location = new System.Drawing.Point(12, 12);
            this.tableLayoutPanel1.Name = "tableLayoutPanel1";
            this.tableLayoutPanel1.RowCount = 6;
            this.tableLayoutPanel1.RowStyles.Add(new System.Windows.Forms.RowStyle());
            this.tableLayoutPanel1.RowStyles.Add(new System.Windows.Forms.RowStyle());
            this.tableLayoutPanel1.RowStyles.Add(new System.Windows.Forms.RowStyle());
            this.tableLayoutPanel1.RowStyles.Add(new System.Windows.Forms.RowStyle());
            this.tableLayoutPanel1.RowStyles.Add(new System.Windows.Forms.RowStyle());
            this.tableLayoutPanel1.RowStyles.Add(new System.Windows.Forms.RowStyle());
            this.tableLayoutPanel1.Size = new System.Drawing.Size(579, 170);
            this.tableLayoutPanel1.TabIndex = 1;
            // 
            // textModificationDate
            // 
            this.textModificationDate.Anchor = ((System.Windows.Forms.AnchorStyles)((System.Windows.Forms.AnchorStyles.Left | System.Windows.Forms.AnchorStyles.Right)));
            this.textModificationDate.Location = new System.Drawing.Point(184, 145);
            this.textModificationDate.Name = "textModificationDate";
            this.textModificationDate.Size = new System.Drawing.Size(392, 22);
            this.textModificationDate.TabIndex = 12;
            // 
            // labelModificationDate
            // 
            this.labelModificationDate.Anchor = ((System.Windows.Forms.AnchorStyles)((System.Windows.Forms.AnchorStyles.Left | System.Windows.Forms.AnchorStyles.Right)));
            this.labelModificationDate.AutoSize = true;
            this.labelModificationDate.Location = new System.Drawing.Point(3, 148);
            this.labelModificationDate.Name = "labelModificationDate";
            this.labelModificationDate.Size = new System.Drawing.Size(175, 16);
            this.labelModificationDate.TabIndex = 11;
            this.labelModificationDate.Text = "Modification Date (ISO 8601)";
            // 
            // textCreationDate
            // 
            this.textCreationDate.Anchor = ((System.Windows.Forms.AnchorStyles)((System.Windows.Forms.AnchorStyles.Left | System.Windows.Forms.AnchorStyles.Right)));
            this.textCreationDate.Location = new System.Drawing.Point(184, 117);
            this.textCreationDate.Name = "textCreationDate";
            this.textCreationDate.Size = new System.Drawing.Size(392, 22);
            this.textCreationDate.TabIndex = 10;
            // 
            // labelCreationDate
            // 
            this.labelCreationDate.Anchor = ((System.Windows.Forms.AnchorStyles)((System.Windows.Forms.AnchorStyles.Left | System.Windows.Forms.AnchorStyles.Right)));
            this.labelCreationDate.AutoSize = true;
            this.labelCreationDate.Location = new System.Drawing.Point(3, 120);
            this.labelCreationDate.Name = "labelCreationDate";
            this.labelCreationDate.Size = new System.Drawing.Size(175, 16);
            this.labelCreationDate.TabIndex = 9;
            this.labelCreationDate.Text = "Creation Date (ISO 8601)";
            // 
            // labelRelationShip
            // 
            this.labelRelationShip.Anchor = ((System.Windows.Forms.AnchorStyles)((System.Windows.Forms.AnchorStyles.Left | System.Windows.Forms.AnchorStyles.Right)));
            this.labelRelationShip.AutoSize = true;
            this.labelRelationShip.Location = new System.Drawing.Point(3, 91);
            this.labelRelationShip.Name = "labelRelationShip";
            this.labelRelationShip.Size = new System.Drawing.Size(175, 16);
            this.labelRelationShip.TabIndex = 7;
            this.labelRelationShip.Text = "AFRelationShip";
            // 
            // textMimeType
            // 
            this.textMimeType.Anchor = ((System.Windows.Forms.AnchorStyles)((System.Windows.Forms.AnchorStyles.Left | System.Windows.Forms.AnchorStyles.Right)));
            this.textMimeType.Location = new System.Drawing.Point(184, 59);
            this.textMimeType.Name = "textMimeType";
            this.textMimeType.Size = new System.Drawing.Size(392, 22);
            this.textMimeType.TabIndex = 6;
            // 
            // labelMimeType
            // 
            this.labelMimeType.Anchor = ((System.Windows.Forms.AnchorStyles)((System.Windows.Forms.AnchorStyles.Left | System.Windows.Forms.AnchorStyles.Right)));
            this.labelMimeType.AutoSize = true;
            this.labelMimeType.Location = new System.Drawing.Point(3, 62);
            this.labelMimeType.Name = "labelMimeType";
            this.labelMimeType.Size = new System.Drawing.Size(175, 16);
            this.labelMimeType.TabIndex = 5;
            this.labelMimeType.Text = "Mime Type";
            // 
            // textFilename
            // 
            this.textFilename.Anchor = ((System.Windows.Forms.AnchorStyles)((System.Windows.Forms.AnchorStyles.Left | System.Windows.Forms.AnchorStyles.Right)));
            this.textFilename.Location = new System.Drawing.Point(184, 31);
            this.textFilename.Name = "textFilename";
            this.textFilename.Size = new System.Drawing.Size(392, 22);
            this.textFilename.TabIndex = 4;
            // 
            // labelFileName
            // 
            this.labelFileName.Anchor = ((System.Windows.Forms.AnchorStyles)((System.Windows.Forms.AnchorStyles.Left | System.Windows.Forms.AnchorStyles.Right)));
            this.labelFileName.AutoSize = true;
            this.labelFileName.Location = new System.Drawing.Point(3, 34);
            this.labelFileName.Name = "labelFileName";
            this.labelFileName.Size = new System.Drawing.Size(175, 16);
            this.labelFileName.TabIndex = 3;
            this.labelFileName.Text = "File Name";
            // 
            // labelDescription
            // 
            this.labelDescription.Anchor = ((System.Windows.Forms.AnchorStyles)((System.Windows.Forms.AnchorStyles.Left | System.Windows.Forms.AnchorStyles.Right)));
            this.labelDescription.AutoSize = true;
            this.labelDescription.Location = new System.Drawing.Point(3, 6);
            this.labelDescription.Name = "labelDescription";
            this.labelDescription.Size = new System.Drawing.Size(175, 16);
            this.labelDescription.TabIndex = 1;
            this.labelDescription.Text = "Description";
            // 
            // textDescription
            // 
            this.textDescription.Anchor = ((System.Windows.Forms.AnchorStyles)((System.Windows.Forms.AnchorStyles.Left | System.Windows.Forms.AnchorStyles.Right)));
            this.textDescription.Location = new System.Drawing.Point(184, 3);
            this.textDescription.Name = "textDescription";
            this.textDescription.Size = new System.Drawing.Size(392, 22);
            this.textDescription.TabIndex = 2;
            // 
            // comboRelationShip
            // 
            this.comboRelationShip.Anchor = ((System.Windows.Forms.AnchorStyles)((System.Windows.Forms.AnchorStyles.Left | System.Windows.Forms.AnchorStyles.Right)));
            this.comboRelationShip.DropDownStyle = System.Windows.Forms.ComboBoxStyle.DropDownList;
            this.comboRelationShip.FormattingEnabled = true;
            this.comboRelationShip.Location = new System.Drawing.Point(184, 87);
            this.comboRelationShip.Name = "comboRelationShip";
            this.comboRelationShip.Size = new System.Drawing.Size(392, 24);
            this.comboRelationShip.TabIndex = 8;
            // 
            // bok
            // 
            this.bok.DialogResult = System.Windows.Forms.DialogResult.OK;
            this.bok.Location = new System.Drawing.Point(12, 200);
            this.bok.Name = "bok";
            this.bok.Size = new System.Drawing.Size(122, 38);
            this.bok.TabIndex = 2;
            this.bok.Text = "OK";
            this.bok.UseVisualStyleBackColor = true;
            // 
            // bcancel
            // 
            this.bcancel.Anchor = ((System.Windows.Forms.AnchorStyles)((System.Windows.Forms.AnchorStyles.Left | System.Windows.Forms.AnchorStyles.Right)));
            this.bcancel.DialogResult = System.Windows.Forms.DialogResult.Cancel;
            this.bcancel.Location = new System.Drawing.Point(466, 200);
            this.bcancel.Name = "bcancel";
            this.bcancel.Size = new System.Drawing.Size(122, 38);
            this.bcancel.TabIndex = 3;
            this.bcancel.Text = "Cancel";
            this.bcancel.UseVisualStyleBackColor = true;
            // 
            // EmbeddedFileForm
            // 
            this.AcceptButton = this.bok;
            this.AutoScaleDimensions = new System.Drawing.SizeF(8F, 16F);
            this.AutoScaleMode = System.Windows.Forms.AutoScaleMode.Font;
            this.ClientSize = new System.Drawing.Size(602, 250);
            this.Controls.Add(this.bcancel);
            this.Controls.Add(this.bok);
            this.Controls.Add(this.tableLayoutPanel1);
            this.FormBorderStyle = System.Windows.Forms.FormBorderStyle.FixedDialog;
            this.Name = "EmbeddedFileForm";
            this.StartPosition = System.Windows.Forms.FormStartPosition.CenterScreen;
            this.Load += new System.EventHandler(this.EmbeddedFileForm_Load);
            this.tableLayoutPanel1.ResumeLayout(false);
            this.tableLayoutPanel1.PerformLayout();
            this.ResumeLayout(false);
            this.PerformLayout();

        }

        #endregion

        private System.Windows.Forms.TableLayoutPanel tableLayoutPanel1;
        private System.Windows.Forms.Label labelDescription;
        private System.Windows.Forms.TextBox textDescription;
        private System.Windows.Forms.TextBox textModificationDate;
        private System.Windows.Forms.Label labelModificationDate;
        private System.Windows.Forms.TextBox textCreationDate;
        private System.Windows.Forms.Label labelCreationDate;
        private System.Windows.Forms.Label labelRelationShip;
        private System.Windows.Forms.TextBox textMimeType;
        private System.Windows.Forms.Label labelMimeType;
        private System.Windows.Forms.TextBox textFilename;
        private System.Windows.Forms.Label labelFileName;
        private System.Windows.Forms.ComboBox comboRelationShip;
        private System.Windows.Forms.Button bok;
        private System.Windows.Forms.Button bcancel;
    }
}