namespace Reportman.Designer
{
    partial class ExpressionDlg
    {
        /// <summary> 
        /// Variable del diseñador necesaria.
        /// </summary>
        private System.ComponentModel.IContainer components = null;

        /// <summary> 
        /// Limpiar los recursos que se estén usando.
        /// </summary>
        /// <param name="disposing">true si los recursos administrados se deben desechar; false en caso contrario.</param>
        protected override void Dispose(bool disposing)
        {
            if (disposing && (components != null))
            {
                components.Dispose();
            }
            base.Dispose(disposing);
        }

        #region Código generado por el Diseñador de componentes

        /// <summary> 
        /// Método necesario para admitir el Diseñador. No se puede modificar
        /// el contenido de este método con el editor de código.
        /// </summary>
        private void InitializeComponent()
        {
            tableLayoutPanel1 = new System.Windows.Forms.TableLayoutPanel();
            BAdd = new System.Windows.Forms.Button();
            LParams = new System.Windows.Forms.Label();
            LItems = new System.Windows.Forms.ListBox();
            LCategory = new System.Windows.Forms.ListBox();
            MemoExpre = new System.Windows.Forms.TextBox();
            LModel = new System.Windows.Forms.Label();
            LHelp = new System.Windows.Forms.Label();
            BCancel = new System.Windows.Forms.Button();
            BOK = new System.Windows.Forms.Button();
            BConectar = new System.Windows.Forms.Button();
            BCheckSyn = new System.Windows.Forms.Button();
            BShowResult = new System.Windows.Forms.Button();
            tableLayoutPanel1.SuspendLayout();
            SuspendLayout();
            // 
            // tableLayoutPanel1
            // 
            tableLayoutPanel1.ColumnCount = 4;
            tableLayoutPanel1.ColumnStyles.Add(new System.Windows.Forms.ColumnStyle(System.Windows.Forms.SizeType.Percent, 25F));
            tableLayoutPanel1.ColumnStyles.Add(new System.Windows.Forms.ColumnStyle(System.Windows.Forms.SizeType.Percent, 25F));
            tableLayoutPanel1.ColumnStyles.Add(new System.Windows.Forms.ColumnStyle(System.Windows.Forms.SizeType.Percent, 25F));
            tableLayoutPanel1.ColumnStyles.Add(new System.Windows.Forms.ColumnStyle(System.Windows.Forms.SizeType.Percent, 25F));
            tableLayoutPanel1.Controls.Add(BAdd, 2, 1);
            tableLayoutPanel1.Controls.Add(LParams, 0, 4);
            tableLayoutPanel1.Controls.Add(LItems, 2, 2);
            tableLayoutPanel1.Controls.Add(LCategory, 0, 2);
            tableLayoutPanel1.Controls.Add(MemoExpre, 0, 0);
            tableLayoutPanel1.Controls.Add(LModel, 2, 3);
            tableLayoutPanel1.Controls.Add(LHelp, 0, 3);
            tableLayoutPanel1.Controls.Add(BCancel, 2, 5);
            tableLayoutPanel1.Controls.Add(BOK, 0, 5);
            tableLayoutPanel1.Controls.Add(BConectar, 0, 1);
            tableLayoutPanel1.Controls.Add(BCheckSyn, 1, 1);
            tableLayoutPanel1.Controls.Add(BShowResult, 3, 1);
            tableLayoutPanel1.Dock = System.Windows.Forms.DockStyle.Fill;
            tableLayoutPanel1.Location = new System.Drawing.Point(0, 0);
            tableLayoutPanel1.Margin = new System.Windows.Forms.Padding(4, 5, 4, 5);
            tableLayoutPanel1.Name = "tableLayoutPanel1";
            tableLayoutPanel1.RowCount = 6;
            tableLayoutPanel1.RowStyles.Add(new System.Windows.Forms.RowStyle(System.Windows.Forms.SizeType.Percent, 50F));
            tableLayoutPanel1.RowStyles.Add(new System.Windows.Forms.RowStyle());
            tableLayoutPanel1.RowStyles.Add(new System.Windows.Forms.RowStyle(System.Windows.Forms.SizeType.Percent, 50F));
            tableLayoutPanel1.RowStyles.Add(new System.Windows.Forms.RowStyle());
            tableLayoutPanel1.RowStyles.Add(new System.Windows.Forms.RowStyle());
            tableLayoutPanel1.RowStyles.Add(new System.Windows.Forms.RowStyle());
            tableLayoutPanel1.RowStyles.Add(new System.Windows.Forms.RowStyle(System.Windows.Forms.SizeType.Absolute, 31F));
            tableLayoutPanel1.Size = new System.Drawing.Size(660, 589);
            tableLayoutPanel1.TabIndex = 1;
            // 
            // BAdd
            // 
            BAdd.Anchor = System.Windows.Forms.AnchorStyles.None;
            BAdd.Location = new System.Drawing.Point(334, 223);
            BAdd.Margin = new System.Windows.Forms.Padding(4, 5, 4, 5);
            BAdd.Name = "BAdd";
            BAdd.Size = new System.Drawing.Size(156, 46);
            BAdd.TabIndex = 13;
            BAdd.Text = "Add";
            BAdd.UseVisualStyleBackColor = true;
            BAdd.Click += BAdd_Click;
            // 
            // LParams
            // 
            LParams.Anchor = System.Windows.Forms.AnchorStyles.Top | System.Windows.Forms.AnchorStyles.Bottom | System.Windows.Forms.AnchorStyles.Left | System.Windows.Forms.AnchorStyles.Right;
            LParams.AutoSize = true;
            tableLayoutPanel1.SetColumnSpan(LParams, 4);
            LParams.Location = new System.Drawing.Point(4, 512);
            LParams.Margin = new System.Windows.Forms.Padding(4, 0, 4, 0);
            LParams.Name = "LParams";
            LParams.Size = new System.Drawing.Size(652, 20);
            LParams.TabIndex = 7;
            LParams.Text = "Params";
            // 
            // LItems
            // 
            LItems.Anchor = System.Windows.Forms.AnchorStyles.Top | System.Windows.Forms.AnchorStyles.Bottom | System.Windows.Forms.AnchorStyles.Left | System.Windows.Forms.AnchorStyles.Right;
            tableLayoutPanel1.SetColumnSpan(LItems, 2);
            LItems.FormattingEnabled = true;
            LItems.Location = new System.Drawing.Point(334, 279);
            LItems.Margin = new System.Windows.Forms.Padding(4, 5, 4, 5);
            LItems.Name = "LItems";
            LItems.Size = new System.Drawing.Size(322, 204);
            LItems.TabIndex = 4;
            LItems.SelectedIndexChanged += LItems_SelectedIndexChanged;
            // 
            // LCategory
            // 
            LCategory.Anchor = System.Windows.Forms.AnchorStyles.Top | System.Windows.Forms.AnchorStyles.Bottom | System.Windows.Forms.AnchorStyles.Left | System.Windows.Forms.AnchorStyles.Right;
            tableLayoutPanel1.SetColumnSpan(LCategory, 2);
            LCategory.FormattingEnabled = true;
            LCategory.Items.AddRange(new object[] { "Database fields", "Functions", "Variables", "Constants", "Operators" });
            LCategory.Location = new System.Drawing.Point(4, 279);
            LCategory.Margin = new System.Windows.Forms.Padding(4, 5, 4, 5);
            LCategory.Name = "LCategory";
            LCategory.Size = new System.Drawing.Size(322, 204);
            LCategory.TabIndex = 3;
            LCategory.SelectedIndexChanged += LCategory_SelectedIndexChanged;
            // 
            // MemoExpre
            // 
            MemoExpre.Anchor = System.Windows.Forms.AnchorStyles.Top | System.Windows.Forms.AnchorStyles.Bottom | System.Windows.Forms.AnchorStyles.Left | System.Windows.Forms.AnchorStyles.Right;
            tableLayoutPanel1.SetColumnSpan(MemoExpre, 4);
            MemoExpre.Location = new System.Drawing.Point(4, 5);
            MemoExpre.Margin = new System.Windows.Forms.Padding(4, 5, 4, 5);
            MemoExpre.Multiline = true;
            MemoExpre.Name = "MemoExpre";
            MemoExpre.ScrollBars = System.Windows.Forms.ScrollBars.Both;
            MemoExpre.Size = new System.Drawing.Size(652, 208);
            MemoExpre.TabIndex = 1;
            // 
            // LModel
            // 
            LModel.Anchor = System.Windows.Forms.AnchorStyles.Top | System.Windows.Forms.AnchorStyles.Bottom | System.Windows.Forms.AnchorStyles.Left | System.Windows.Forms.AnchorStyles.Right;
            LModel.AutoSize = true;
            tableLayoutPanel1.SetColumnSpan(LModel, 2);
            LModel.Location = new System.Drawing.Point(334, 492);
            LModel.Margin = new System.Windows.Forms.Padding(4, 0, 4, 0);
            LModel.Name = "LModel";
            LModel.Size = new System.Drawing.Size(322, 20);
            LModel.TabIndex = 5;
            LModel.Text = "LModel";
            LModel.Click += Label1_Click;
            // 
            // LHelp
            // 
            LHelp.Anchor = System.Windows.Forms.AnchorStyles.Top | System.Windows.Forms.AnchorStyles.Bottom | System.Windows.Forms.AnchorStyles.Left | System.Windows.Forms.AnchorStyles.Right;
            LHelp.AutoSize = true;
            tableLayoutPanel1.SetColumnSpan(LHelp, 2);
            LHelp.Location = new System.Drawing.Point(4, 492);
            LHelp.Margin = new System.Windows.Forms.Padding(4, 0, 4, 0);
            LHelp.Name = "LHelp";
            LHelp.Size = new System.Drawing.Size(322, 20);
            LHelp.TabIndex = 6;
            LHelp.Text = "LHelp";
            // 
            // BCancel
            // 
            BCancel.Anchor = System.Windows.Forms.AnchorStyles.None;
            tableLayoutPanel1.SetColumnSpan(BCancel, 2);
            BCancel.Location = new System.Drawing.Point(417, 537);
            BCancel.Margin = new System.Windows.Forms.Padding(4, 5, 4, 5);
            BCancel.Name = "BCancel";
            BCancel.Size = new System.Drawing.Size(156, 46);
            BCancel.TabIndex = 8;
            BCancel.Text = "Cancel";
            BCancel.UseVisualStyleBackColor = true;
            BCancel.Click += BCancel_Click;
            // 
            // BOK
            // 
            BOK.Anchor = System.Windows.Forms.AnchorStyles.None;
            tableLayoutPanel1.SetColumnSpan(BOK, 2);
            BOK.Location = new System.Drawing.Point(78, 537);
            BOK.Margin = new System.Windows.Forms.Padding(4, 5, 4, 5);
            BOK.Name = "BOK";
            BOK.Size = new System.Drawing.Size(173, 46);
            BOK.TabIndex = 9;
            BOK.Text = "OK";
            BOK.UseVisualStyleBackColor = true;
            BOK.Click += BOK_Click;
            // 
            // BConectar
            // 
            BConectar.Anchor = System.Windows.Forms.AnchorStyles.None;
            BConectar.Location = new System.Drawing.Point(4, 223);
            BConectar.Margin = new System.Windows.Forms.Padding(4, 5, 4, 5);
            BConectar.Name = "BConectar";
            BConectar.Size = new System.Drawing.Size(156, 46);
            BConectar.TabIndex = 10;
            BConectar.Text = "Connect";
            BConectar.UseVisualStyleBackColor = true;
            BConectar.Click += BConectar_Click;
            // 
            // BCheckSyn
            // 
            BCheckSyn.Anchor = System.Windows.Forms.AnchorStyles.None;
            BCheckSyn.Location = new System.Drawing.Point(169, 223);
            BCheckSyn.Margin = new System.Windows.Forms.Padding(4, 5, 4, 5);
            BCheckSyn.Name = "BCheckSyn";
            BCheckSyn.Size = new System.Drawing.Size(156, 46);
            BCheckSyn.TabIndex = 12;
            BCheckSyn.Text = "Syntax Check";
            BCheckSyn.UseVisualStyleBackColor = true;
            BCheckSyn.Click += BCheckSyn_Click;
            // 
            // BShowResult
            // 
            BShowResult.Anchor = System.Windows.Forms.AnchorStyles.None;
            BShowResult.Location = new System.Drawing.Point(499, 223);
            BShowResult.Margin = new System.Windows.Forms.Padding(4, 5, 4, 5);
            BShowResult.Name = "BShowResult";
            BShowResult.Size = new System.Drawing.Size(157, 46);
            BShowResult.TabIndex = 11;
            BShowResult.Text = "Show Result";
            BShowResult.UseVisualStyleBackColor = true;
            BShowResult.Click += BShowResult_Click;
            // 
            // ExpressionDlg
            // 
            AutoScaleDimensions = new System.Drawing.SizeF(8F, 20F);
            AutoScaleMode = System.Windows.Forms.AutoScaleMode.Font;
            Controls.Add(tableLayoutPanel1);
            Margin = new System.Windows.Forms.Padding(4, 5, 4, 5);
            Name = "ExpressionDlg";
            Size = new System.Drawing.Size(660, 589);
            tableLayoutPanel1.ResumeLayout(false);
            tableLayoutPanel1.PerformLayout();
            ResumeLayout(false);

        }

        #endregion

        private System.Windows.Forms.TableLayoutPanel tableLayoutPanel1;
        private System.Windows.Forms.ListBox LItems;
        private System.Windows.Forms.ListBox LCategory;
        private System.Windows.Forms.TextBox MemoExpre;
        private System.Windows.Forms.Label LModel;
        private System.Windows.Forms.Label LHelp;
        private System.Windows.Forms.Label LParams;
        private System.Windows.Forms.Button BCancel;
        private System.Windows.Forms.Button BOK;
        private System.Windows.Forms.Button BShowResult;
        private System.Windows.Forms.Button BConectar;
        private System.Windows.Forms.Button BCheckSyn;
        private System.Windows.Forms.Button BAdd;
    }
}
