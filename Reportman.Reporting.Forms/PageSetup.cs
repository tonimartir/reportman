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

using Reportman.Drawing;
using Reportman.Drawing.Forms;
using System;
using System.Collections.Generic;
using System.ComponentModel;
using System.IO;
using System.Windows.Forms;

namespace Reportman.Reporting.Forms
{
    /// <summary>
    /// Page setup form, page configuration and general options for the report
    /// </summary>
    public class PageSetup : System.Windows.Forms.Form
    {
        private System.Windows.Forms.Panel pbottom;
        private System.Windows.Forms.Button bcancel;
        private System.Windows.Forms.Button bok;
        private System.Windows.Forms.TabControl PControl;
        private System.Windows.Forms.TabPage tabpagesetup;
        private System.Windows.Forms.TabPage tabprintsetup;
        private System.Windows.Forms.TabPage taboptions;
        private GroupBox RPageSize;
        private RadioButton rpagecustom;
        private RadioButton rpagedefine;
        private RadioButton rpagedefault;
        private GroupBox GUserDefined;
        private Label LForceFormName;
        private Label LHeight;
        private Label LWidth;
        private GroupBox GPageSize;
        private ComboBox ComboPageSize;
        private Label LMetrics2;
        private Label LMetrics1;
        private TextBox EForceFormName;
        private NumericUpDown EPageHeight;
        private NumericUpDown EPageWidth;
        private GroupBox RPageOrientation;
        private RadioButton rorientationdefine;
        private RadioButton rorientationdefault;
        private GroupBox RPageMargins;
        private Label LMetrics4;
        private NumericUpDown MRight;
        private Label LMRight;
        private Label LMetrics3;
        private NumericUpDown MLeft;
        private Label LMLeft;
        private GroupBox RPageOrientationDefine;
        private RadioButton rlandscape;
        private RadioButton rportrait;
        private Label LMetrics5;
        private NumericUpDown MBottom;
        private Label LMBottom;
        private Label LMetrics6;
        private NumericUpDown MTop;
        private Label LMTop;
        private NumericUpDown ECopies;
        private Label LCopies;
        private CheckBox CheckDefaultCopies;
        private CheckBox CheckCollateCopies;
        private Label LBackColor;
        private Panel PanelColor;
        private ComboBox ComboStyle;
        private ComboBox ComboPreview;
        private Label LPreview;
        private ComboBox ComboLanguage;
        private Label LRLang;
        private Button BConfigurePrinters;
        private ComboBox ComboSelPrinter;
        private Label LSelectPrinter;
        private ComboBox ComboPaperSource;
        private Label LPaperSource;
        private NumericUpDown EPaperSource;
        private CheckBox CheckPreviewAbout;
        private CheckBox CheckMargins;
        private CheckBox CheckPrintOnlyIfData;
        private CheckBox CheckTwoPass;
        private NumericUpDown ELinesPerInch;
        private Label LMLinesPerInch;
        private ComboBox ComboDuplex;
        private Label LDuplex;
        private CheckBox CheckDrawerAfter;
        private CheckBox CheckDrawerBefore;
        private ComboBox ComboPrinterFonts;
        private Label LPrinterFonts;
        private ColorDialog cdialog;
        private decimal oldcustompageheight, oldcustompagewidth;
        private decimal oldmleft, oldmright, oldmtop, oldmbottom;
        private Panel panelOptionsTop;
        private GroupBox GPDF;
        private ComboBox ComboFormat;
        private Label LPreferedFormat;
        private Panel panelParentEmbedded;
        private Panel panelLabelEmbedded;
        private Label labelPDFEmbeddedFiles;
        private CheckBox CcheckBoxPDFCompressed;
        private Label LabelCompressed;
        private Label LabelPDFConformance;
        private ComboBox ComboPDFConformance;
        private ToolStripContainer toolStripContainer1;
        private ToolStrip toolStrip1;
        private ToolStripButton bnew;
        private ToolStripButton bdelete;
        private ToolStripButton bmodify;
        private ListView listViewEmbedded;
        private ColumnHeader colFilename;
        private ColumnHeader colMimeType;
        private ColumnHeader colRelationship;
        private ColumnHeader colDescription;
        private ColumnHeader colCreationDate;
        private ColumnHeader colModificationDate;
        private TabPage tabMetadata;
        private TableLayoutPanel tableDocMetadata;
        private Label labelAuthor;
        private TextBox textDocSubject;
        private Label labelDocSubject;
        private TextBox textDocTitle;
        private Label labelDocTitle;
        private TextBox textDocAuthor;
        private TextBox textDocCreator;
        private Label labelDocCreator;
        private TextBox textDocXMPMetadata;
        private Label labelXMPMetadata;
        private TextBox textDocModifyDate;
        private Label labelDocModifyDate;
        private TextBox textDocCreationDate;
        private Label labelDocCreationDate;
        private TextBox textDocProducer;
        private Label labelDocProducer;
        private ContextMenuStrip contextMenuStrip1;
        private TextBox textDocKeywords;
        private Label labelKeywords;
        private IContainer components;
        private ColumnHeader colSize;
        private List<EmbeddedFile> EmbeddedFiles = new List<EmbeddedFile>();

        /// <summary>
        /// Constructor
        /// </summary>
        public PageSetup()
        {
            //
            // Necessary for Windows forms designer
            //
            InitializeComponent();

            bok.Text = Translator.TranslateStr(93);
            bcancel.Text = Translator.TranslateStr(94);
            RPageSize.Text = Translator.TranslateStr(97);
            Text = Translator.TranslateStr(110);
            tabpagesetup.Text = Translator.TranslateStr(857);
            tabprintsetup.Text = Translator.TranslateStr(858);
            taboptions.Text = Translator.TranslateStr(974);
            rpagecustom.Text = Translator.TranslateStr(732);
            rpagedefine.Text = Translator.TranslateStr(96);
            rpagedefault.Text = Translator.TranslateStr(95);
            LWidth.Text = Translator.TranslateStr(554);
            LHeight.Text = Translator.TranslateStr(555);
            LForceFormName.Text = Translator.TranslateStr(1319);
            GPageSize.Text = Translator.TranslateStr(104);
            GUserDefined.Text = Translator.TranslateStr(733);
            LCopies.Text = Translator.TranslateStr(108);
            LMLinesPerInch.Text = Translator.TranslateStr(1377);
            CheckCollateCopies.Text = Translator.TranslateStr(109);
            CheckDefaultCopies.Text = Translator.TranslateStr(1432);
            LBackColor.Text = Translator.TranslateStr(116);
            LMLeft.Text = Translator.TranslateStr(100);
            LMRight.Text = Translator.TranslateStr(101);
            LMBottom.Text = Translator.TranslateStr(103);
            LMTop.Text = Translator.TranslateStr(102);
            RPageMargins.Text = Translator.TranslateStr(99);
            LRLang.Text = Translator.TranslateStr(112);
            LPrinterFonts.Text = Translator.TranslateStr(113);
            ComboPrinterFonts.Items.Clear();
            ComboPrinterFonts.Items.Add(Translator.TranslateStr(95));
            ComboPrinterFonts.Items.Add(Translator.TranslateStr(114));
            ComboPrinterFonts.Items.Add(Translator.TranslateStr(115));
            ComboPrinterFonts.Items.Add(Translator.TranslateStr(1433));
            CheckPreviewAbout.Text = Translator.TranslateStr(1163);
            CheckMargins.Text = Translator.TranslateStr(1264);
            CheckPrintOnlyIfData.Text = Translator.TranslateStr(800);
            CheckTwoPass.Text = Translator.TranslateStr(111);
            RPageOrientationDefine.Text = Translator.TranslateStr(105);
            RPageOrientation.Text = Translator.TranslateStr(98);
            rorientationdefault.Text = Translator.TranslateStr(95);
            rorientationdefine.Text = Translator.TranslateStr(96);
            rportrait.Text = Translator.TranslateStr(106);
            rlandscape.Text = Translator.TranslateStr(107);
            LSelectPrinter.Text = Translator.TranslateStr(741);
            LPreview.Text = Translator.TranslateStr(840);
            ComboPreview.Items.Clear();
            ComboPreview.Items.Add(Translator.TranslateStr(841));
            ComboPreview.Items.Add(Translator.TranslateStr(842));
            ComboStyle.Items.Clear();
            ComboStyle.Items.Add(Translator.TranslateStr(843));
            ComboStyle.Items.Add(Translator.TranslateStr(844));
            ComboStyle.Items.Add(Translator.TranslateStr(845));
            LDuplex.Text = Translator.TranslateStr(1300);
            ComboDuplex.Items.Clear();
            ComboDuplex.Items.Add(Translator.TranslateStr(95));
            ComboDuplex.Items.Add(Translator.TranslateStr(1301));
            ComboDuplex.Items.Add(Translator.TranslateStr(1303));
            ComboDuplex.Items.Add(Translator.TranslateStr(1302));
            ComboPaperSource.Items.Clear();
            ComboPaperSource.Items.Add(Translator.TranslateStr(95));
            ComboPaperSource.Items.Add(Translator.TranslateStr(1287));
            ComboPaperSource.Items.Add(Translator.TranslateStr(1288));
            ComboPaperSource.Items.Add(Translator.TranslateStr(1289));
            ComboPaperSource.Items.Add(Translator.TranslateStr(1290));
            ComboPaperSource.Items.Add(Translator.TranslateStr(1291));
            ComboPaperSource.Items.Add(Translator.TranslateStr(1292));
            ComboPaperSource.Items.Add(Translator.TranslateStr(1293));
            ComboPaperSource.Items.Add(Translator.TranslateStr(1294));
            ComboPaperSource.Items.Add(Translator.TranslateStr(1295));
            ComboPaperSource.Items.Add(Translator.TranslateStr(1296));
            ComboPaperSource.Items.Add(Translator.TranslateStr(1297));
            ComboPaperSource.Items.Add("---");
            ComboPaperSource.Items.Add("---");
            ComboPaperSource.Items.Add(Translator.TranslateStr(1298));
            ComboPaperSource.Items.Add(Translator.TranslateStr(1299));
            LPaperSource.Text = Translator.TranslateStr(1286);

            CheckDrawerBefore.Text = Translator.TranslateStr(1052);
            CheckDrawerAfter.Text = Translator.TranslateStr(1053);
            // Page sizes
            ComboPageSize.Items.Clear();
            int i;
            for (i = 0; i <= PrintOut.PageSizeArray.GetUpperBound(0); i++)
            {
                string papername = PrintOut.PageSizeName(i) + " (" +
                    (Twips.TwipsToCms(PrintOut.PageSizeArray[i, 0] * Twips.TWIPS_PER_INCH / 1000)).ToString("#,0.000") + " x " +
                    (Twips.TwipsToCms(PrintOut.PageSizeArray[i, 1] * Twips.TWIPS_PER_INCH / 1000)).ToString("#,0.000") + ") " +
                     Twips.TranslateUnit(Twips.DefaultUnit()).ToString();
                ComboPageSize.Items.Add(papername);
            }
            Translator.GetLanguageDescriptions(ComboLanguage.Items);

            LMetrics1.Text = Twips.DefaultUnitString();
            LMetrics2.Text = LMetrics1.Text;
            LMetrics3.Text = LMetrics1.Text;
            LMetrics4.Text = LMetrics1.Text;
            LMetrics5.Text = LMetrics1.Text;
            LMetrics6.Text = LMetrics1.Text;
            LPreferedFormat.Text = Translator.TranslateStr(970);

            ComboSelPrinter.Items.Clear();
            ComboSelPrinter.Items.Add(Translator.TranslateStr(467));
            ComboSelPrinter.Items.Add(Translator.TranslateStr(468));
            ComboSelPrinter.Items.Add(Translator.TranslateStr(469));
            ComboSelPrinter.Items.Add(Translator.TranslateStr(470));
            ComboSelPrinter.Items.Add(Translator.TranslateStr(471));
            ComboSelPrinter.Items.Add(Translator.TranslateStr(472));
            ComboSelPrinter.Items.Add(Translator.TranslateStr(473));
            ComboSelPrinter.Items.Add(Translator.TranslateStr(474));
            ComboSelPrinter.Items.Add(Translator.TranslateStr(475));
            ComboSelPrinter.Items.Add(Translator.TranslateStr(476));
            ComboSelPrinter.Items.Add(Translator.TranslateStr(477));
            ComboSelPrinter.Items.Add(Translator.TranslateStr(478));
            ComboSelPrinter.Items.Add(Translator.TranslateStr(479));
            ComboSelPrinter.Items.Add(Translator.TranslateStr(480));
            ComboSelPrinter.Items.Add(Translator.TranslateStr(481));
            ComboSelPrinter.Items.Add(Translator.TranslateStr(482));
            ComboFormat.Items.Clear();
            ComboFormat.Items.Add(Translator.TranslateStr(971));
            ComboFormat.Items.Add(Translator.TranslateStr(973));
            ComboFormat.Items.Add(Translator.TranslateStr(972));
            ComboFormat.Items.Add("XML");
            ComboFormat.Items.Add(Translator.TranslateStr(1350));


            GPDF.Text = Translator.TranslateStr(1457);
            LabelCompressed.Text = Translator.TranslateStr(1459);
            bnew.Text = Translator.TranslateStr(1158);
            bdelete.Text = Translator.TranslateStr(1159);
            bmodify.Text = Translator.TranslateStr(1478);
            panelLabelEmbedded.Text = Translator.TranslateStr(1465);
            LabelPDFConformance.Text = Translator.TranslateStr(1458);
            tabMetadata.Text = Translator.TranslateStr(1474);
            labelAuthor.Text = Translator.TranslateStr(1466);
            labelDocTitle.Text = Translator.TranslateStr(1467);
            labelDocSubject.Text = Translator.TranslateStr(1468);
            labelDocCreator.Text = Translator.TranslateStr(1473);
            labelDocProducer.Text = Translator.TranslateStr(1472);
            labelDocCreationDate.Text = Translator.TranslateStr(1469);
            labelDocModifyDate.Text = Translator.TranslateStr(1470);
            labelKeywords.Text = Translator.TranslateStr(1471);
            labelXMPMetadata.Text = Translator.TranslateStr(1479);

            listViewEmbedded.Columns[0].Text = Translator.TranslateStr(1463);
            listViewEmbedded.Columns[1].Text = Translator.TranslateStr(1460);
            listViewEmbedded.Columns[2].Text = Translator.TranslateStr(1461);
            listViewEmbedded.Columns[3].Text = Translator.TranslateStr(1464);
            listViewEmbedded.Columns[4].Text = Translator.TranslateStr(1462);
            listViewEmbedded.Columns[5].Text = Translator.TranslateStr(1476);
            listViewEmbedded.Columns[6].Text = Translator.TranslateStr(1477);
        }

        /// <summary>
        /// Code cleanup
        /// </summary>
        protected override void Dispose(bool disposing)
        {
            if (disposing)
            {
                if (components != null)
                {
                    components.Dispose();
                }
            }
            base.Dispose(disposing);
        }

        #region Windows forms designed generated code
        /// <summary>
        /// Necessary for windows forms designer
        /// </summary>
        private void InitializeComponent()
        {
            this.components = new System.ComponentModel.Container();
            this.pbottom = new System.Windows.Forms.Panel();
            this.bcancel = new System.Windows.Forms.Button();
            this.bok = new System.Windows.Forms.Button();
            this.PControl = new System.Windows.Forms.TabControl();
            this.tabpagesetup = new System.Windows.Forms.TabPage();
            this.PanelColor = new System.Windows.Forms.Panel();
            this.LBackColor = new System.Windows.Forms.Label();
            this.CheckCollateCopies = new System.Windows.Forms.CheckBox();
            this.CheckDefaultCopies = new System.Windows.Forms.CheckBox();
            this.ECopies = new System.Windows.Forms.NumericUpDown();
            this.LCopies = new System.Windows.Forms.Label();
            this.RPageMargins = new System.Windows.Forms.GroupBox();
            this.LMetrics5 = new System.Windows.Forms.Label();
            this.MBottom = new System.Windows.Forms.NumericUpDown();
            this.LMBottom = new System.Windows.Forms.Label();
            this.LMetrics6 = new System.Windows.Forms.Label();
            this.MTop = new System.Windows.Forms.NumericUpDown();
            this.LMTop = new System.Windows.Forms.Label();
            this.LMetrics4 = new System.Windows.Forms.Label();
            this.MRight = new System.Windows.Forms.NumericUpDown();
            this.LMRight = new System.Windows.Forms.Label();
            this.LMetrics3 = new System.Windows.Forms.Label();
            this.MLeft = new System.Windows.Forms.NumericUpDown();
            this.LMLeft = new System.Windows.Forms.Label();
            this.RPageOrientation = new System.Windows.Forms.GroupBox();
            this.rorientationdefine = new System.Windows.Forms.RadioButton();
            this.rorientationdefault = new System.Windows.Forms.RadioButton();
            this.RPageSize = new System.Windows.Forms.GroupBox();
            this.rpagecustom = new System.Windows.Forms.RadioButton();
            this.rpagedefine = new System.Windows.Forms.RadioButton();
            this.rpagedefault = new System.Windows.Forms.RadioButton();
            this.RPageOrientationDefine = new System.Windows.Forms.GroupBox();
            this.rportrait = new System.Windows.Forms.RadioButton();
            this.rlandscape = new System.Windows.Forms.RadioButton();
            this.GPageSize = new System.Windows.Forms.GroupBox();
            this.ComboPageSize = new System.Windows.Forms.ComboBox();
            this.GUserDefined = new System.Windows.Forms.GroupBox();
            this.LMetrics2 = new System.Windows.Forms.Label();
            this.LMetrics1 = new System.Windows.Forms.Label();
            this.EForceFormName = new System.Windows.Forms.TextBox();
            this.EPageHeight = new System.Windows.Forms.NumericUpDown();
            this.EPageWidth = new System.Windows.Forms.NumericUpDown();
            this.LForceFormName = new System.Windows.Forms.Label();
            this.LHeight = new System.Windows.Forms.Label();
            this.LWidth = new System.Windows.Forms.Label();
            this.tabprintsetup = new System.Windows.Forms.TabPage();
            this.ComboPrinterFonts = new System.Windows.Forms.ComboBox();
            this.LPrinterFonts = new System.Windows.Forms.Label();
            this.CheckDrawerAfter = new System.Windows.Forms.CheckBox();
            this.CheckDrawerBefore = new System.Windows.Forms.CheckBox();
            this.CheckPreviewAbout = new System.Windows.Forms.CheckBox();
            this.CheckMargins = new System.Windows.Forms.CheckBox();
            this.CheckPrintOnlyIfData = new System.Windows.Forms.CheckBox();
            this.CheckTwoPass = new System.Windows.Forms.CheckBox();
            this.ELinesPerInch = new System.Windows.Forms.NumericUpDown();
            this.LMLinesPerInch = new System.Windows.Forms.Label();
            this.ComboDuplex = new System.Windows.Forms.ComboBox();
            this.LDuplex = new System.Windows.Forms.Label();
            this.EPaperSource = new System.Windows.Forms.NumericUpDown();
            this.ComboPaperSource = new System.Windows.Forms.ComboBox();
            this.LPaperSource = new System.Windows.Forms.Label();
            this.BConfigurePrinters = new System.Windows.Forms.Button();
            this.ComboSelPrinter = new System.Windows.Forms.ComboBox();
            this.LSelectPrinter = new System.Windows.Forms.Label();
            this.ComboStyle = new System.Windows.Forms.ComboBox();
            this.ComboPreview = new System.Windows.Forms.ComboBox();
            this.LPreview = new System.Windows.Forms.Label();
            this.ComboLanguage = new System.Windows.Forms.ComboBox();
            this.LRLang = new System.Windows.Forms.Label();
            this.taboptions = new System.Windows.Forms.TabPage();
            this.panelParentEmbedded = new System.Windows.Forms.Panel();
            this.toolStripContainer1 = new System.Windows.Forms.ToolStripContainer();
            this.listViewEmbedded = new System.Windows.Forms.ListView();
            this.colFilename = ((System.Windows.Forms.ColumnHeader)(new System.Windows.Forms.ColumnHeader()));
            this.colMimeType = ((System.Windows.Forms.ColumnHeader)(new System.Windows.Forms.ColumnHeader()));
            this.colSize = ((System.Windows.Forms.ColumnHeader)(new System.Windows.Forms.ColumnHeader()));
            this.colRelationship = ((System.Windows.Forms.ColumnHeader)(new System.Windows.Forms.ColumnHeader()));
            this.colDescription = ((System.Windows.Forms.ColumnHeader)(new System.Windows.Forms.ColumnHeader()));
            this.colCreationDate = ((System.Windows.Forms.ColumnHeader)(new System.Windows.Forms.ColumnHeader()));
            this.colModificationDate = ((System.Windows.Forms.ColumnHeader)(new System.Windows.Forms.ColumnHeader()));
            this.toolStrip1 = new System.Windows.Forms.ToolStrip();
            this.bnew = new System.Windows.Forms.ToolStripButton();
            this.bdelete = new System.Windows.Forms.ToolStripButton();
            this.bmodify = new System.Windows.Forms.ToolStripButton();
            this.panelLabelEmbedded = new System.Windows.Forms.Panel();
            this.labelPDFEmbeddedFiles = new System.Windows.Forms.Label();
            this.panelOptionsTop = new System.Windows.Forms.Panel();
            this.GPDF = new System.Windows.Forms.GroupBox();
            this.CcheckBoxPDFCompressed = new System.Windows.Forms.CheckBox();
            this.LabelCompressed = new System.Windows.Forms.Label();
            this.LabelPDFConformance = new System.Windows.Forms.Label();
            this.ComboPDFConformance = new System.Windows.Forms.ComboBox();
            this.ComboFormat = new System.Windows.Forms.ComboBox();
            this.LPreferedFormat = new System.Windows.Forms.Label();
            this.tabMetadata = new System.Windows.Forms.TabPage();
            this.tableDocMetadata = new System.Windows.Forms.TableLayoutPanel();
            this.textDocKeywords = new System.Windows.Forms.TextBox();
            this.labelKeywords = new System.Windows.Forms.Label();
            this.textDocXMPMetadata = new System.Windows.Forms.TextBox();
            this.labelXMPMetadata = new System.Windows.Forms.Label();
            this.textDocModifyDate = new System.Windows.Forms.TextBox();
            this.labelDocModifyDate = new System.Windows.Forms.Label();
            this.textDocCreationDate = new System.Windows.Forms.TextBox();
            this.labelDocCreationDate = new System.Windows.Forms.Label();
            this.textDocProducer = new System.Windows.Forms.TextBox();
            this.labelDocProducer = new System.Windows.Forms.Label();
            this.textDocCreator = new System.Windows.Forms.TextBox();
            this.labelDocCreator = new System.Windows.Forms.Label();
            this.textDocSubject = new System.Windows.Forms.TextBox();
            this.labelDocSubject = new System.Windows.Forms.Label();
            this.textDocTitle = new System.Windows.Forms.TextBox();
            this.labelDocTitle = new System.Windows.Forms.Label();
            this.labelAuthor = new System.Windows.Forms.Label();
            this.textDocAuthor = new System.Windows.Forms.TextBox();
            this.cdialog = new System.Windows.Forms.ColorDialog();
            this.contextMenuStrip1 = new System.Windows.Forms.ContextMenuStrip(this.components);
            this.pbottom.SuspendLayout();
            this.PControl.SuspendLayout();
            this.tabpagesetup.SuspendLayout();
            ((System.ComponentModel.ISupportInitialize)(this.ECopies)).BeginInit();
            this.RPageMargins.SuspendLayout();
            ((System.ComponentModel.ISupportInitialize)(this.MBottom)).BeginInit();
            ((System.ComponentModel.ISupportInitialize)(this.MTop)).BeginInit();
            ((System.ComponentModel.ISupportInitialize)(this.MRight)).BeginInit();
            ((System.ComponentModel.ISupportInitialize)(this.MLeft)).BeginInit();
            this.RPageOrientation.SuspendLayout();
            this.RPageSize.SuspendLayout();
            this.RPageOrientationDefine.SuspendLayout();
            this.GPageSize.SuspendLayout();
            this.GUserDefined.SuspendLayout();
            ((System.ComponentModel.ISupportInitialize)(this.EPageHeight)).BeginInit();
            ((System.ComponentModel.ISupportInitialize)(this.EPageWidth)).BeginInit();
            this.tabprintsetup.SuspendLayout();
            ((System.ComponentModel.ISupportInitialize)(this.ELinesPerInch)).BeginInit();
            ((System.ComponentModel.ISupportInitialize)(this.EPaperSource)).BeginInit();
            this.taboptions.SuspendLayout();
            this.panelParentEmbedded.SuspendLayout();
            this.toolStripContainer1.ContentPanel.SuspendLayout();
            this.toolStripContainer1.TopToolStripPanel.SuspendLayout();
            this.toolStripContainer1.SuspendLayout();
            this.toolStrip1.SuspendLayout();
            this.panelLabelEmbedded.SuspendLayout();
            this.panelOptionsTop.SuspendLayout();
            this.GPDF.SuspendLayout();
            this.tabMetadata.SuspendLayout();
            this.tableDocMetadata.SuspendLayout();
            this.SuspendLayout();
            // 
            // pbottom
            // 
            this.pbottom.Controls.Add(this.bcancel);
            this.pbottom.Controls.Add(this.bok);
            this.pbottom.Dock = System.Windows.Forms.DockStyle.Bottom;
            this.pbottom.Location = new System.Drawing.Point(0, 450);
            this.pbottom.Name = "pbottom";
            this.pbottom.Size = new System.Drawing.Size(646, 56);
            this.pbottom.TabIndex = 1;
            // 
            // bcancel
            // 
            this.bcancel.DialogResult = System.Windows.Forms.DialogResult.Cancel;
            this.bcancel.Location = new System.Drawing.Point(265, 8);
            this.bcancel.Name = "bcancel";
            this.bcancel.Size = new System.Drawing.Size(138, 38);
            this.bcancel.TabIndex = 1;
            this.bcancel.Text = "Cancel";
            // 
            // bok
            // 
            this.bok.Location = new System.Drawing.Point(10, 9);
            this.bok.Name = "bok";
            this.bok.Size = new System.Drawing.Size(134, 37);
            this.bok.TabIndex = 0;
            this.bok.Text = "OK";
            this.bok.Click += new System.EventHandler(this.bok_Click);
            // 
            // PControl
            // 
            this.PControl.Controls.Add(this.tabpagesetup);
            this.PControl.Controls.Add(this.tabprintsetup);
            this.PControl.Controls.Add(this.taboptions);
            this.PControl.Controls.Add(this.tabMetadata);
            this.PControl.Dock = System.Windows.Forms.DockStyle.Fill;
            this.PControl.Location = new System.Drawing.Point(0, 0);
            this.PControl.Name = "PControl";
            this.PControl.SelectedIndex = 0;
            this.PControl.Size = new System.Drawing.Size(646, 450);
            this.PControl.TabIndex = 2;
            // 
            // tabpagesetup
            // 
            this.tabpagesetup.Controls.Add(this.PanelColor);
            this.tabpagesetup.Controls.Add(this.LBackColor);
            this.tabpagesetup.Controls.Add(this.CheckCollateCopies);
            this.tabpagesetup.Controls.Add(this.CheckDefaultCopies);
            this.tabpagesetup.Controls.Add(this.ECopies);
            this.tabpagesetup.Controls.Add(this.LCopies);
            this.tabpagesetup.Controls.Add(this.RPageMargins);
            this.tabpagesetup.Controls.Add(this.RPageOrientation);
            this.tabpagesetup.Controls.Add(this.RPageSize);
            this.tabpagesetup.Controls.Add(this.RPageOrientationDefine);
            this.tabpagesetup.Controls.Add(this.GPageSize);
            this.tabpagesetup.Controls.Add(this.GUserDefined);
            this.tabpagesetup.Location = new System.Drawing.Point(4, 25);
            this.tabpagesetup.Name = "tabpagesetup";
            this.tabpagesetup.Size = new System.Drawing.Size(638, 421);
            this.tabpagesetup.TabIndex = 0;
            this.tabpagesetup.Text = "Page setup";
            // 
            // PanelColor
            // 
            this.PanelColor.BorderStyle = System.Windows.Forms.BorderStyle.FixedSingle;
            this.PanelColor.Location = new System.Drawing.Point(155, 377);
            this.PanelColor.Name = "PanelColor";
            this.PanelColor.Size = new System.Drawing.Size(68, 23);
            this.PanelColor.TabIndex = 14;
            this.PanelColor.Click += new System.EventHandler(this.PanelColor_Click);
            this.PanelColor.Paint += new System.Windows.Forms.PaintEventHandler(this.PanelColor_Paint);
            // 
            // LBackColor
            // 
            this.LBackColor.AutoSize = true;
            this.LBackColor.Location = new System.Drawing.Point(20, 381);
            this.LBackColor.Name = "LBackColor";
            this.LBackColor.Size = new System.Drawing.Size(113, 16);
            this.LBackColor.TabIndex = 13;
            this.LBackColor.Text = "Background color";
            // 
            // CheckCollateCopies
            // 
            this.CheckCollateCopies.Anchor = ((System.Windows.Forms.AnchorStyles)(((System.Windows.Forms.AnchorStyles.Top | System.Windows.Forms.AnchorStyles.Left)
            | System.Windows.Forms.AnchorStyles.Right)));
            this.CheckCollateCopies.Location = new System.Drawing.Point(264, 345);
            this.CheckCollateCopies.Name = "CheckCollateCopies";
            this.CheckCollateCopies.Size = new System.Drawing.Size(363, 22);
            this.CheckCollateCopies.TabIndex = 8;
            this.CheckCollateCopies.Text = "Collate copies";
            // 
            // CheckDefaultCopies
            // 
            this.CheckDefaultCopies.Anchor = ((System.Windows.Forms.AnchorStyles)(((System.Windows.Forms.AnchorStyles.Top | System.Windows.Forms.AnchorStyles.Left)
            | System.Windows.Forms.AnchorStyles.Right)));
            this.CheckDefaultCopies.Location = new System.Drawing.Point(264, 378);
            this.CheckDefaultCopies.Name = "CheckDefaultCopies";
            this.CheckDefaultCopies.Size = new System.Drawing.Size(363, 22);
            this.CheckDefaultCopies.TabIndex = 9;
            this.CheckDefaultCopies.Text = "Default printer copies";
            this.CheckDefaultCopies.CheckedChanged += new System.EventHandler(this.CheckDefaultCopies_CheckedChanged);
            // 
            // ECopies
            // 
            this.ECopies.Location = new System.Drawing.Point(155, 344);
            this.ECopies.Minimum = new decimal(new int[] {
            1,
            0,
            0,
            0});
            this.ECopies.Name = "ECopies";
            this.ECopies.Size = new System.Drawing.Size(68, 22);
            this.ECopies.TabIndex = 7;
            this.ECopies.Value = new decimal(new int[] {
            1,
            0,
            0,
            0});
            // 
            // LCopies
            // 
            this.LCopies.AutoSize = true;
            this.LCopies.Location = new System.Drawing.Point(20, 350);
            this.LCopies.Name = "LCopies";
            this.LCopies.Size = new System.Drawing.Size(50, 16);
            this.LCopies.TabIndex = 12;
            this.LCopies.Text = "Copies";
            // 
            // RPageMargins
            // 
            this.RPageMargins.Anchor = ((System.Windows.Forms.AnchorStyles)(((System.Windows.Forms.AnchorStyles.Top | System.Windows.Forms.AnchorStyles.Left)
            | System.Windows.Forms.AnchorStyles.Right)));
            this.RPageMargins.Controls.Add(this.LMetrics5);
            this.RPageMargins.Controls.Add(this.MBottom);
            this.RPageMargins.Controls.Add(this.LMBottom);
            this.RPageMargins.Controls.Add(this.LMetrics6);
            this.RPageMargins.Controls.Add(this.MTop);
            this.RPageMargins.Controls.Add(this.LMTop);
            this.RPageMargins.Controls.Add(this.LMetrics4);
            this.RPageMargins.Controls.Add(this.MRight);
            this.RPageMargins.Controls.Add(this.LMRight);
            this.RPageMargins.Controls.Add(this.LMetrics3);
            this.RPageMargins.Controls.Add(this.MLeft);
            this.RPageMargins.Controls.Add(this.LMLeft);
            this.RPageMargins.Location = new System.Drawing.Point(5, 240);
            this.RPageMargins.Name = "RPageMargins";
            this.RPageMargins.Size = new System.Drawing.Size(622, 89);
            this.RPageMargins.TabIndex = 6;
            this.RPageMargins.TabStop = false;
            this.RPageMargins.Text = "Page margins";
            // 
            // LMetrics5
            // 
            this.LMetrics5.AutoSize = true;
            this.LMetrics5.Location = new System.Drawing.Point(584, 54);
            this.LMetrics5.Name = "LMetrics5";
            this.LMetrics5.Size = new System.Drawing.Size(31, 16);
            this.LMetrics5.TabIndex = 19;
            this.LMetrics5.Text = "inch";
            // 
            // MBottom
            // 
            this.MBottom.DecimalPlaces = 3;
            this.MBottom.Location = new System.Drawing.Point(479, 52);
            this.MBottom.Name = "MBottom";
            this.MBottom.Size = new System.Drawing.Size(98, 22);
            this.MBottom.TabIndex = 18;
            // 
            // LMBottom
            // 
            this.LMBottom.AutoSize = true;
            this.LMBottom.Location = new System.Drawing.Point(314, 54);
            this.LMBottom.Name = "LMBottom";
            this.LMBottom.Size = new System.Drawing.Size(49, 16);
            this.LMBottom.TabIndex = 17;
            this.LMBottom.Text = "Bottom";
            // 
            // LMetrics6
            // 
            this.LMetrics6.AutoSize = true;
            this.LMetrics6.Location = new System.Drawing.Point(256, 54);
            this.LMetrics6.Name = "LMetrics6";
            this.LMetrics6.Size = new System.Drawing.Size(31, 16);
            this.LMetrics6.TabIndex = 16;
            this.LMetrics6.Text = "inch";
            // 
            // MTop
            // 
            this.MTop.DecimalPlaces = 3;
            this.MTop.Location = new System.Drawing.Point(150, 52);
            this.MTop.Name = "MTop";
            this.MTop.Size = new System.Drawing.Size(98, 22);
            this.MTop.TabIndex = 15;
            // 
            // LMTop
            // 
            this.LMTop.AutoSize = true;
            this.LMTop.Location = new System.Drawing.Point(16, 54);
            this.LMTop.Name = "LMTop";
            this.LMTop.Size = new System.Drawing.Size(32, 16);
            this.LMTop.TabIndex = 14;
            this.LMTop.Text = "Top";
            // 
            // LMetrics4
            // 
            this.LMetrics4.AutoSize = true;
            this.LMetrics4.Location = new System.Drawing.Point(584, 24);
            this.LMetrics4.Name = "LMetrics4";
            this.LMetrics4.Size = new System.Drawing.Size(31, 16);
            this.LMetrics4.TabIndex = 13;
            this.LMetrics4.Text = "inch";
            // 
            // MRight
            // 
            this.MRight.DecimalPlaces = 3;
            this.MRight.Location = new System.Drawing.Point(479, 22);
            this.MRight.Name = "MRight";
            this.MRight.Size = new System.Drawing.Size(98, 22);
            this.MRight.TabIndex = 12;
            // 
            // LMRight
            // 
            this.LMRight.AutoSize = true;
            this.LMRight.Location = new System.Drawing.Point(314, 24);
            this.LMRight.Name = "LMRight";
            this.LMRight.Size = new System.Drawing.Size(38, 16);
            this.LMRight.TabIndex = 11;
            this.LMRight.Text = "Right";
            // 
            // LMetrics3
            // 
            this.LMetrics3.AutoSize = true;
            this.LMetrics3.Location = new System.Drawing.Point(256, 24);
            this.LMetrics3.Name = "LMetrics3";
            this.LMetrics3.Size = new System.Drawing.Size(31, 16);
            this.LMetrics3.TabIndex = 10;
            this.LMetrics3.Text = "inch";
            // 
            // MLeft
            // 
            this.MLeft.DecimalPlaces = 3;
            this.MLeft.Location = new System.Drawing.Point(150, 22);
            this.MLeft.Name = "MLeft";
            this.MLeft.Size = new System.Drawing.Size(98, 22);
            this.MLeft.TabIndex = 9;
            // 
            // LMLeft
            // 
            this.LMLeft.AutoSize = true;
            this.LMLeft.Location = new System.Drawing.Point(16, 24);
            this.LMLeft.Name = "LMLeft";
            this.LMLeft.Size = new System.Drawing.Size(28, 16);
            this.LMLeft.TabIndex = 8;
            this.LMLeft.Text = "Left";
            // 
            // RPageOrientation
            // 
            this.RPageOrientation.Controls.Add(this.rorientationdefine);
            this.RPageOrientation.Controls.Add(this.rorientationdefault);
            this.RPageOrientation.Location = new System.Drawing.Point(4, 140);
            this.RPageOrientation.Name = "RPageOrientation";
            this.RPageOrientation.Size = new System.Drawing.Size(288, 93);
            this.RPageOrientation.TabIndex = 4;
            this.RPageOrientation.TabStop = false;
            this.RPageOrientation.Text = "Page orientation";
            // 
            // rorientationdefine
            // 
            this.rorientationdefine.Location = new System.Drawing.Point(19, 53);
            this.rorientationdefine.Name = "rorientationdefine";
            this.rorientationdefine.Size = new System.Drawing.Size(250, 28);
            this.rorientationdefine.TabIndex = 1;
            this.rorientationdefine.Text = "Define";
            this.rorientationdefine.CheckedChanged += new System.EventHandler(this.rorientationdefault_CheckedChanged);
            // 
            // rorientationdefault
            // 
            this.rorientationdefault.Location = new System.Drawing.Point(19, 18);
            this.rorientationdefault.Name = "rorientationdefault";
            this.rorientationdefault.Size = new System.Drawing.Size(250, 28);
            this.rorientationdefault.TabIndex = 1;
            this.rorientationdefault.Text = "Default";
            this.rorientationdefault.CheckedChanged += new System.EventHandler(this.rorientationdefault_CheckedChanged);
            // 
            // RPageSize
            // 
            this.RPageSize.Controls.Add(this.rpagecustom);
            this.RPageSize.Controls.Add(this.rpagedefine);
            this.RPageSize.Controls.Add(this.rpagedefault);
            this.RPageSize.Location = new System.Drawing.Point(4, 3);
            this.RPageSize.Name = "RPageSize";
            this.RPageSize.Size = new System.Drawing.Size(288, 130);
            this.RPageSize.TabIndex = 1;
            this.RPageSize.TabStop = false;
            this.RPageSize.Text = "Page size";
            // 
            // rpagecustom
            // 
            this.rpagecustom.Location = new System.Drawing.Point(19, 92);
            this.rpagecustom.Name = "rpagecustom";
            this.rpagecustom.Size = new System.Drawing.Size(250, 28);
            this.rpagecustom.TabIndex = 2;
            this.rpagecustom.Text = "Customized";
            this.rpagecustom.Click += new System.EventHandler(this.rpagedefault_Click);
            // 
            // rpagedefine
            // 
            this.rpagedefine.Location = new System.Drawing.Point(19, 53);
            this.rpagedefine.Name = "rpagedefine";
            this.rpagedefine.Size = new System.Drawing.Size(250, 28);
            this.rpagedefine.TabIndex = 1;
            this.rpagedefine.Text = "Define";
            this.rpagedefine.Click += new System.EventHandler(this.rpagedefault_Click);
            // 
            // rpagedefault
            // 
            this.rpagedefault.Location = new System.Drawing.Point(19, 18);
            this.rpagedefault.Name = "rpagedefault";
            this.rpagedefault.Size = new System.Drawing.Size(250, 28);
            this.rpagedefault.TabIndex = 1;
            this.rpagedefault.Text = "Default";
            this.rpagedefault.Click += new System.EventHandler(this.rpagedefault_Click);
            // 
            // RPageOrientationDefine
            // 
            this.RPageOrientationDefine.Anchor = ((System.Windows.Forms.AnchorStyles)(((System.Windows.Forms.AnchorStyles.Top | System.Windows.Forms.AnchorStyles.Left)
            | System.Windows.Forms.AnchorStyles.Right)));
            this.RPageOrientationDefine.Controls.Add(this.rportrait);
            this.RPageOrientationDefine.Controls.Add(this.rlandscape);
            this.RPageOrientationDefine.Location = new System.Drawing.Point(310, 140);
            this.RPageOrientationDefine.Name = "RPageOrientationDefine";
            this.RPageOrientationDefine.Size = new System.Drawing.Size(317, 93);
            this.RPageOrientationDefine.TabIndex = 5;
            this.RPageOrientationDefine.TabStop = false;
            this.RPageOrientationDefine.Text = "Orientation definition";
            // 
            // rportrait
            // 
            this.rportrait.Location = new System.Drawing.Point(19, 18);
            this.rportrait.Name = "rportrait";
            this.rportrait.Size = new System.Drawing.Size(250, 28);
            this.rportrait.TabIndex = 1;
            this.rportrait.Text = "Portrait";
            // 
            // rlandscape
            // 
            this.rlandscape.Location = new System.Drawing.Point(19, 53);
            this.rlandscape.Name = "rlandscape";
            this.rlandscape.Size = new System.Drawing.Size(250, 28);
            this.rlandscape.TabIndex = 1;
            this.rlandscape.Text = "Landscape";
            // 
            // GPageSize
            // 
            this.GPageSize.Anchor = ((System.Windows.Forms.AnchorStyles)(((System.Windows.Forms.AnchorStyles.Top | System.Windows.Forms.AnchorStyles.Left)
            | System.Windows.Forms.AnchorStyles.Right)));
            this.GPageSize.Controls.Add(this.ComboPageSize);
            this.GPageSize.Location = new System.Drawing.Point(310, 3);
            this.GPageSize.Name = "GPageSize";
            this.GPageSize.Size = new System.Drawing.Size(317, 63);
            this.GPageSize.TabIndex = 2;
            this.GPageSize.TabStop = false;
            this.GPageSize.Text = "Custom size";
            // 
            // ComboPageSize
            // 
            this.ComboPageSize.Anchor = ((System.Windows.Forms.AnchorStyles)(((System.Windows.Forms.AnchorStyles.Top | System.Windows.Forms.AnchorStyles.Left)
            | System.Windows.Forms.AnchorStyles.Right)));
            this.ComboPageSize.Location = new System.Drawing.Point(7, 27);
            this.ComboPageSize.Name = "ComboPageSize";
            this.ComboPageSize.Size = new System.Drawing.Size(290, 24);
            this.ComboPageSize.TabIndex = 0;
            // 
            // GUserDefined
            // 
            this.GUserDefined.Anchor = ((System.Windows.Forms.AnchorStyles)(((System.Windows.Forms.AnchorStyles.Top | System.Windows.Forms.AnchorStyles.Left)
            | System.Windows.Forms.AnchorStyles.Right)));
            this.GUserDefined.Controls.Add(this.LMetrics2);
            this.GUserDefined.Controls.Add(this.LMetrics1);
            this.GUserDefined.Controls.Add(this.EForceFormName);
            this.GUserDefined.Controls.Add(this.EPageHeight);
            this.GUserDefined.Controls.Add(this.EPageWidth);
            this.GUserDefined.Controls.Add(this.LForceFormName);
            this.GUserDefined.Controls.Add(this.LHeight);
            this.GUserDefined.Controls.Add(this.LWidth);
            this.GUserDefined.Location = new System.Drawing.Point(310, 3);
            this.GUserDefined.Name = "GUserDefined";
            this.GUserDefined.Size = new System.Drawing.Size(317, 130);
            this.GUserDefined.TabIndex = 3;
            this.GUserDefined.TabStop = false;
            this.GUserDefined.Text = "Custom page size";
            // 
            // LMetrics2
            // 
            this.LMetrics2.AutoSize = true;
            this.LMetrics2.Location = new System.Drawing.Point(316, 60);
            this.LMetrics2.Name = "LMetrics2";
            this.LMetrics2.Size = new System.Drawing.Size(31, 16);
            this.LMetrics2.TabIndex = 7;
            this.LMetrics2.Text = "inch";
            // 
            // LMetrics1
            // 
            this.LMetrics1.AutoSize = true;
            this.LMetrics1.Location = new System.Drawing.Point(316, 20);
            this.LMetrics1.Name = "LMetrics1";
            this.LMetrics1.Size = new System.Drawing.Size(31, 16);
            this.LMetrics1.TabIndex = 6;
            this.LMetrics1.Text = "inch";
            // 
            // EForceFormName
            // 
            this.EForceFormName.Location = new System.Drawing.Point(174, 91);
            this.EForceFormName.Name = "EForceFormName";
            this.EForceFormName.Size = new System.Drawing.Size(134, 22);
            this.EForceFormName.TabIndex = 5;
            // 
            // EPageHeight
            // 
            this.EPageHeight.DecimalPlaces = 3;
            this.EPageHeight.Location = new System.Drawing.Point(174, 58);
            this.EPageHeight.Maximum = new decimal(new int[] {
            9999999,
            0,
            0,
            0});
            this.EPageHeight.Name = "EPageHeight";
            this.EPageHeight.Size = new System.Drawing.Size(134, 22);
            this.EPageHeight.TabIndex = 4;
            // 
            // EPageWidth
            // 
            this.EPageWidth.DecimalPlaces = 3;
            this.EPageWidth.Location = new System.Drawing.Point(174, 17);
            this.EPageWidth.Maximum = new decimal(new int[] {
            9999999,
            0,
            0,
            0});
            this.EPageWidth.Name = "EPageWidth";
            this.EPageWidth.Size = new System.Drawing.Size(134, 22);
            this.EPageWidth.TabIndex = 3;
            // 
            // LForceFormName
            // 
            this.LForceFormName.AutoSize = true;
            this.LForceFormName.Location = new System.Drawing.Point(10, 99);
            this.LForceFormName.Name = "LForceFormName";
            this.LForceFormName.Size = new System.Drawing.Size(75, 16);
            this.LForceFormName.TabIndex = 2;
            this.LForceFormName.Text = "Form name";
            // 
            // LHeight
            // 
            this.LHeight.AutoSize = true;
            this.LHeight.Location = new System.Drawing.Point(10, 60);
            this.LHeight.Name = "LHeight";
            this.LHeight.Size = new System.Drawing.Size(46, 16);
            this.LHeight.TabIndex = 1;
            this.LHeight.Text = "Height";
            // 
            // LWidth
            // 
            this.LWidth.AutoSize = true;
            this.LWidth.Location = new System.Drawing.Point(10, 25);
            this.LWidth.Name = "LWidth";
            this.LWidth.Size = new System.Drawing.Size(41, 16);
            this.LWidth.TabIndex = 0;
            this.LWidth.Text = "Width";
            // 
            // tabprintsetup
            // 
            this.tabprintsetup.Controls.Add(this.ComboPrinterFonts);
            this.tabprintsetup.Controls.Add(this.LPrinterFonts);
            this.tabprintsetup.Controls.Add(this.CheckDrawerAfter);
            this.tabprintsetup.Controls.Add(this.CheckDrawerBefore);
            this.tabprintsetup.Controls.Add(this.CheckPreviewAbout);
            this.tabprintsetup.Controls.Add(this.CheckMargins);
            this.tabprintsetup.Controls.Add(this.CheckPrintOnlyIfData);
            this.tabprintsetup.Controls.Add(this.CheckTwoPass);
            this.tabprintsetup.Controls.Add(this.ELinesPerInch);
            this.tabprintsetup.Controls.Add(this.LMLinesPerInch);
            this.tabprintsetup.Controls.Add(this.ComboDuplex);
            this.tabprintsetup.Controls.Add(this.LDuplex);
            this.tabprintsetup.Controls.Add(this.EPaperSource);
            this.tabprintsetup.Controls.Add(this.ComboPaperSource);
            this.tabprintsetup.Controls.Add(this.LPaperSource);
            this.tabprintsetup.Controls.Add(this.BConfigurePrinters);
            this.tabprintsetup.Controls.Add(this.ComboSelPrinter);
            this.tabprintsetup.Controls.Add(this.LSelectPrinter);
            this.tabprintsetup.Controls.Add(this.ComboStyle);
            this.tabprintsetup.Controls.Add(this.ComboPreview);
            this.tabprintsetup.Controls.Add(this.LPreview);
            this.tabprintsetup.Controls.Add(this.ComboLanguage);
            this.tabprintsetup.Controls.Add(this.LRLang);
            this.tabprintsetup.Location = new System.Drawing.Point(4, 25);
            this.tabprintsetup.Name = "tabprintsetup";
            this.tabprintsetup.Size = new System.Drawing.Size(633, 387);
            this.tabprintsetup.TabIndex = 1;
            this.tabprintsetup.Text = "Print setup";
            // 
            // ComboPrinterFonts
            // 
            this.ComboPrinterFonts.Anchor = ((System.Windows.Forms.AnchorStyles)(((System.Windows.Forms.AnchorStyles.Top | System.Windows.Forms.AnchorStyles.Left)
            | System.Windows.Forms.AnchorStyles.Right)));
            this.ComboPrinterFonts.DropDownStyle = System.Windows.Forms.ComboBoxStyle.DropDownList;
            this.ComboPrinterFonts.Location = new System.Drawing.Point(289, 159);
            this.ComboPrinterFonts.Name = "ComboPrinterFonts";
            this.ComboPrinterFonts.Size = new System.Drawing.Size(325, 24);
            this.ComboPrinterFonts.TabIndex = 13;
            // 
            // LPrinterFonts
            // 
            this.LPrinterFonts.AutoSize = true;
            this.LPrinterFonts.Location = new System.Drawing.Point(10, 163);
            this.LPrinterFonts.Name = "LPrinterFonts";
            this.LPrinterFonts.Size = new System.Drawing.Size(76, 16);
            this.LPrinterFonts.TabIndex = 21;
            this.LPrinterFonts.Text = "Printer fonts";
            // 
            // CheckDrawerAfter
            // 
            this.CheckDrawerAfter.Location = new System.Drawing.Point(13, 382);
            this.CheckDrawerAfter.Name = "CheckDrawerAfter";
            this.CheckDrawerAfter.Size = new System.Drawing.Size(269, 30);
            this.CheckDrawerAfter.TabIndex = 20;
            this.CheckDrawerAfter.Text = "Open drawer after print";
            // 
            // CheckDrawerBefore
            // 
            this.CheckDrawerBefore.Location = new System.Drawing.Point(13, 353);
            this.CheckDrawerBefore.Name = "CheckDrawerBefore";
            this.CheckDrawerBefore.Size = new System.Drawing.Size(269, 29);
            this.CheckDrawerBefore.TabIndex = 19;
            this.CheckDrawerBefore.Text = "Open drawer before print";
            // 
            // CheckPreviewAbout
            // 
            this.CheckPreviewAbout.Location = new System.Drawing.Point(13, 317);
            this.CheckPreviewAbout.Name = "CheckPreviewAbout";
            this.CheckPreviewAbout.Size = new System.Drawing.Size(269, 36);
            this.CheckPreviewAbout.TabIndex = 18;
            this.CheckPreviewAbout.Text = "About box in preview";
            // 
            // CheckMargins
            // 
            this.CheckMargins.Location = new System.Drawing.Point(13, 285);
            this.CheckMargins.Name = "CheckMargins";
            this.CheckMargins.Size = new System.Drawing.Size(268, 32);
            this.CheckMargins.TabIndex = 17;
            this.CheckMargins.Text = "Printable margins in preview";
            // 
            // CheckPrintOnlyIfData
            // 
            this.CheckPrintOnlyIfData.Location = new System.Drawing.Point(13, 254);
            this.CheckPrintOnlyIfData.Name = "CheckPrintOnlyIfData";
            this.CheckPrintOnlyIfData.Size = new System.Drawing.Size(269, 31);
            this.CheckPrintOnlyIfData.TabIndex = 16;
            this.CheckPrintOnlyIfData.Text = "Print only if data available";
            // 
            // CheckTwoPass
            // 
            this.CheckTwoPass.Location = new System.Drawing.Point(13, 223);
            this.CheckTwoPass.Name = "CheckTwoPass";
            this.CheckTwoPass.Size = new System.Drawing.Size(268, 31);
            this.CheckTwoPass.TabIndex = 15;
            this.CheckTwoPass.Text = "Two pass report";
            // 
            // ELinesPerInch
            // 
            this.ELinesPerInch.Location = new System.Drawing.Point(289, 190);
            this.ELinesPerInch.Minimum = new decimal(new int[] {
            1,
            0,
            0,
            0});
            this.ELinesPerInch.Name = "ELinesPerInch";
            this.ELinesPerInch.Size = new System.Drawing.Size(70, 22);
            this.ELinesPerInch.TabIndex = 14;
            this.ELinesPerInch.Value = new decimal(new int[] {
            1,
            0,
            0,
            0});
            // 
            // LMLinesPerInch
            // 
            this.LMLinesPerInch.AutoSize = true;
            this.LMLinesPerInch.Location = new System.Drawing.Point(10, 198);
            this.LMLinesPerInch.Name = "LMLinesPerInch";
            this.LMLinesPerInch.Size = new System.Drawing.Size(89, 16);
            this.LMLinesPerInch.TabIndex = 13;
            this.LMLinesPerInch.Text = "Lines per inch";
            // 
            // ComboDuplex
            // 
            this.ComboDuplex.Anchor = ((System.Windows.Forms.AnchorStyles)(((System.Windows.Forms.AnchorStyles.Top | System.Windows.Forms.AnchorStyles.Left)
            | System.Windows.Forms.AnchorStyles.Right)));
            this.ComboDuplex.DropDownStyle = System.Windows.Forms.ComboBoxStyle.DropDownList;
            this.ComboDuplex.Location = new System.Drawing.Point(289, 130);
            this.ComboDuplex.Name = "ComboDuplex";
            this.ComboDuplex.Size = new System.Drawing.Size(325, 24);
            this.ComboDuplex.TabIndex = 12;
            // 
            // LDuplex
            // 
            this.LDuplex.AutoSize = true;
            this.LDuplex.Location = new System.Drawing.Point(10, 134);
            this.LDuplex.Name = "LDuplex";
            this.LDuplex.Size = new System.Drawing.Size(91, 16);
            this.LDuplex.TabIndex = 11;
            this.LDuplex.Text = "Duplex Option";
            // 
            // EPaperSource
            // 
            this.EPaperSource.Location = new System.Drawing.Point(289, 102);
            this.EPaperSource.Name = "EPaperSource";
            this.EPaperSource.Size = new System.Drawing.Size(69, 22);
            this.EPaperSource.TabIndex = 9;
            this.EPaperSource.Value = new decimal(new int[] {
            1,
            0,
            0,
            0});
            this.EPaperSource.ValueChanged += new System.EventHandler(this.EPaperSource_ValueChanged);
            // 
            // ComboPaperSource
            // 
            this.ComboPaperSource.Anchor = ((System.Windows.Forms.AnchorStyles)(((System.Windows.Forms.AnchorStyles.Top | System.Windows.Forms.AnchorStyles.Left)
            | System.Windows.Forms.AnchorStyles.Right)));
            this.ComboPaperSource.DropDownStyle = System.Windows.Forms.ComboBoxStyle.DropDownList;
            this.ComboPaperSource.Location = new System.Drawing.Point(365, 102);
            this.ComboPaperSource.Name = "ComboPaperSource";
            this.ComboPaperSource.Size = new System.Drawing.Size(249, 24);
            this.ComboPaperSource.TabIndex = 10;
            this.ComboPaperSource.SelectedIndexChanged += new System.EventHandler(this.ComboPaperSource_SelectedIndexChanged);
            // 
            // LPaperSource
            // 
            this.LPaperSource.AutoSize = true;
            this.LPaperSource.Location = new System.Drawing.Point(10, 105);
            this.LPaperSource.Name = "LPaperSource";
            this.LPaperSource.Size = new System.Drawing.Size(128, 16);
            this.LPaperSource.TabIndex = 8;
            this.LPaperSource.Text = "Select paper source";
            // 
            // BConfigurePrinters
            // 
            this.BConfigurePrinters.Location = new System.Drawing.Point(622, 70);
            this.BConfigurePrinters.Name = "BConfigurePrinters";
            this.BConfigurePrinters.Size = new System.Drawing.Size(49, 27);
            this.BConfigurePrinters.TabIndex = 7;
            this.BConfigurePrinters.Text = "...";
            this.BConfigurePrinters.Click += new System.EventHandler(this.BConfigurePrinters_Click);
            // 
            // ComboSelPrinter
            // 
            this.ComboSelPrinter.Anchor = ((System.Windows.Forms.AnchorStyles)(((System.Windows.Forms.AnchorStyles.Top | System.Windows.Forms.AnchorStyles.Left)
            | System.Windows.Forms.AnchorStyles.Right)));
            this.ComboSelPrinter.DropDownStyle = System.Windows.Forms.ComboBoxStyle.DropDownList;
            this.ComboSelPrinter.Location = new System.Drawing.Point(289, 70);
            this.ComboSelPrinter.Name = "ComboSelPrinter";
            this.ComboSelPrinter.Size = new System.Drawing.Size(325, 24);
            this.ComboSelPrinter.TabIndex = 6;
            // 
            // LSelectPrinter
            // 
            this.LSelectPrinter.AutoSize = true;
            this.LSelectPrinter.Location = new System.Drawing.Point(10, 74);
            this.LSelectPrinter.Name = "LSelectPrinter";
            this.LSelectPrinter.Size = new System.Drawing.Size(85, 16);
            this.LSelectPrinter.TabIndex = 5;
            this.LSelectPrinter.Text = "Select printer";
            // 
            // ComboStyle
            // 
            this.ComboStyle.Anchor = ((System.Windows.Forms.AnchorStyles)(((System.Windows.Forms.AnchorStyles.Top | System.Windows.Forms.AnchorStyles.Left)
            | System.Windows.Forms.AnchorStyles.Right)));
            this.ComboStyle.DropDownStyle = System.Windows.Forms.ComboBoxStyle.DropDownList;
            this.ComboStyle.Location = new System.Drawing.Point(452, 40);
            this.ComboStyle.Name = "ComboStyle";
            this.ComboStyle.Size = new System.Drawing.Size(162, 24);
            this.ComboStyle.TabIndex = 4;
            // 
            // ComboPreview
            // 
            this.ComboPreview.DropDownStyle = System.Windows.Forms.ComboBoxStyle.DropDownList;
            this.ComboPreview.Location = new System.Drawing.Point(289, 40);
            this.ComboPreview.Name = "ComboPreview";
            this.ComboPreview.Size = new System.Drawing.Size(162, 24);
            this.ComboPreview.TabIndex = 3;
            // 
            // LPreview
            // 
            this.LPreview.AutoSize = true;
            this.LPreview.Location = new System.Drawing.Point(10, 44);
            this.LPreview.Name = "LPreview";
            this.LPreview.Size = new System.Drawing.Size(164, 16);
            this.LPreview.TabIndex = 2;
            this.LPreview.Text = "Preview window and scale";
            // 
            // ComboLanguage
            // 
            this.ComboLanguage.Anchor = ((System.Windows.Forms.AnchorStyles)(((System.Windows.Forms.AnchorStyles.Top | System.Windows.Forms.AnchorStyles.Left)
            | System.Windows.Forms.AnchorStyles.Right)));
            this.ComboLanguage.DropDownStyle = System.Windows.Forms.ComboBoxStyle.DropDownList;
            this.ComboLanguage.Location = new System.Drawing.Point(289, 10);
            this.ComboLanguage.Name = "ComboLanguage";
            this.ComboLanguage.Size = new System.Drawing.Size(325, 24);
            this.ComboLanguage.TabIndex = 1;
            // 
            // LRLang
            // 
            this.LRLang.AutoSize = true;
            this.LRLang.Location = new System.Drawing.Point(10, 14);
            this.LRLang.Name = "LRLang";
            this.LRLang.Size = new System.Drawing.Size(108, 16);
            this.LRLang.TabIndex = 0;
            this.LRLang.Text = "Report language";
            // 
            // taboptions
            // 
            this.taboptions.Controls.Add(this.panelParentEmbedded);
            this.taboptions.Controls.Add(this.panelOptionsTop);
            this.taboptions.Location = new System.Drawing.Point(4, 25);
            this.taboptions.Name = "taboptions";
            this.taboptions.Size = new System.Drawing.Size(638, 421);
            this.taboptions.TabIndex = 2;
            this.taboptions.Text = "Options";
            // 
            // panelParentEmbedded
            // 
            this.panelParentEmbedded.Controls.Add(this.toolStripContainer1);
            this.panelParentEmbedded.Controls.Add(this.panelLabelEmbedded);
            this.panelParentEmbedded.Dock = System.Windows.Forms.DockStyle.Fill;
            this.panelParentEmbedded.Location = new System.Drawing.Point(0, 124);
            this.panelParentEmbedded.Name = "panelParentEmbedded";
            this.panelParentEmbedded.Size = new System.Drawing.Size(638, 297);
            this.panelParentEmbedded.TabIndex = 5;
            // 
            // toolStripContainer1
            // 
            // 
            // toolStripContainer1.ContentPanel
            // 
            this.toolStripContainer1.ContentPanel.Controls.Add(this.listViewEmbedded);
            this.toolStripContainer1.ContentPanel.Size = new System.Drawing.Size(638, 231);
            this.toolStripContainer1.Dock = System.Windows.Forms.DockStyle.Fill;
            this.toolStripContainer1.Location = new System.Drawing.Point(0, 31);
            this.toolStripContainer1.Name = "toolStripContainer1";
            this.toolStripContainer1.Size = new System.Drawing.Size(638, 266);
            this.toolStripContainer1.TabIndex = 1;
            this.toolStripContainer1.Text = "toolStripContainer1";
            // 
            // toolStripContainer1.TopToolStripPanel
            // 
            this.toolStripContainer1.TopToolStripPanel.Controls.Add(this.toolStrip1);
            // 
            // listViewEmbedded
            // 
            this.listViewEmbedded.Columns.AddRange(new System.Windows.Forms.ColumnHeader[] {
            this.colFilename,
            this.colMimeType,
            this.colSize,
            this.colRelationship,
            this.colDescription,
            this.colCreationDate,
            this.colModificationDate});
            this.listViewEmbedded.Dock = System.Windows.Forms.DockStyle.Fill;
            this.listViewEmbedded.HideSelection = false;
            this.listViewEmbedded.Location = new System.Drawing.Point(0, 0);
            this.listViewEmbedded.MultiSelect = false;
            this.listViewEmbedded.Name = "listViewEmbedded";
            this.listViewEmbedded.Size = new System.Drawing.Size(638, 231);
            this.listViewEmbedded.TabIndex = 0;
            this.listViewEmbedded.UseCompatibleStateImageBehavior = false;
            this.listViewEmbedded.View = System.Windows.Forms.View.Details;
            // 
            // colFilename
            // 
            this.colFilename.Text = "File Name";
            this.colFilename.Width = 250;
            // 
            // colMimeType
            // 
            this.colMimeType.Text = "Mime Type";
            this.colMimeType.Width = 150;
            // 
            // colSize
            // 
            this.colSize.Text = "Size";
            this.colSize.Width = 90;
            // 
            // colRelationship
            // 
            this.colRelationship.Text = "Relationship";
            this.colRelationship.Width = 100;
            // 
            // colDescription
            // 
            this.colDescription.Text = "Description";
            this.colDescription.Width = 200;
            // 
            // colCreationDate
            // 
            this.colCreationDate.Text = "Creation Date";
            // 
            // colModificationDate
            // 
            this.colModificationDate.Text = "Mod.Date";
            this.colModificationDate.Width = 100;
            // 
            // toolStrip1
            // 
            this.toolStrip1.Dock = System.Windows.Forms.DockStyle.None;
            this.toolStrip1.GripStyle = System.Windows.Forms.ToolStripGripStyle.Hidden;
            this.toolStrip1.ImageScalingSize = new System.Drawing.Size(28, 28);
            this.toolStrip1.Items.AddRange(new System.Windows.Forms.ToolStripItem[] {
            this.bnew,
            this.bdelete,
            this.bmodify});
            this.toolStrip1.Location = new System.Drawing.Point(4, 0);
            this.toolStrip1.Name = "toolStrip1";
            this.toolStrip1.Size = new System.Drawing.Size(247, 35);
            this.toolStrip1.TabIndex = 0;
            // 
            // bnew
            // 
            this.bnew.Image = global::Reportman.Reporting.Forms.Properties.Resources.newdocument;
            this.bnew.ImageTransparentColor = System.Drawing.Color.Magenta;
            this.bnew.Name = "bnew";
            this.bnew.Size = new System.Drawing.Size(71, 32);
            this.bnew.Text = "New";
            this.bnew.Click += new System.EventHandler(this.bnew_Click);
            // 
            // bdelete
            // 
            this.bdelete.Image = global::Reportman.Reporting.Forms.Properties.Resources.delete;
            this.bdelete.ImageTransparentColor = System.Drawing.Color.Magenta;
            this.bdelete.Name = "bdelete";
            this.bdelete.Size = new System.Drawing.Size(85, 32);
            this.bdelete.Text = "Delete";
            this.bdelete.Click += new System.EventHandler(this.bdelete_Click);
            // 
            // bmodify
            // 
            this.bmodify.Image = global::Reportman.Reporting.Forms.Properties.Resources.label;
            this.bmodify.ImageTransparentColor = System.Drawing.Color.Magenta;
            this.bmodify.Name = "bmodify";
            this.bmodify.Size = new System.Drawing.Size(88, 32);
            this.bmodify.Text = "Modify";
            this.bmodify.Click += new System.EventHandler(this.bmodify_Click);
            // 
            // panelLabelEmbedded
            // 
            this.panelLabelEmbedded.Controls.Add(this.labelPDFEmbeddedFiles);
            this.panelLabelEmbedded.Dock = System.Windows.Forms.DockStyle.Top;
            this.panelLabelEmbedded.Location = new System.Drawing.Point(0, 0);
            this.panelLabelEmbedded.Name = "panelLabelEmbedded";
            this.panelLabelEmbedded.Size = new System.Drawing.Size(638, 31);
            this.panelLabelEmbedded.TabIndex = 0;
            // 
            // labelPDFEmbeddedFiles
            // 
            this.labelPDFEmbeddedFiles.AutoSize = true;
            this.labelPDFEmbeddedFiles.Location = new System.Drawing.Point(5, 7);
            this.labelPDFEmbeddedFiles.Name = "labelPDFEmbeddedFiles";
            this.labelPDFEmbeddedFiles.Size = new System.Drawing.Size(137, 16);
            this.labelPDFEmbeddedFiles.TabIndex = 0;
            this.labelPDFEmbeddedFiles.Text = "PDF Embedded Files";
            // 
            // panelOptionsTop
            // 
            this.panelOptionsTop.Controls.Add(this.GPDF);
            this.panelOptionsTop.Controls.Add(this.ComboFormat);
            this.panelOptionsTop.Controls.Add(this.LPreferedFormat);
            this.panelOptionsTop.Dock = System.Windows.Forms.DockStyle.Top;
            this.panelOptionsTop.Location = new System.Drawing.Point(0, 0);
            this.panelOptionsTop.Name = "panelOptionsTop";
            this.panelOptionsTop.Size = new System.Drawing.Size(638, 124);
            this.panelOptionsTop.TabIndex = 4;
            // 
            // GPDF
            // 
            this.GPDF.Controls.Add(this.CcheckBoxPDFCompressed);
            this.GPDF.Controls.Add(this.LabelCompressed);
            this.GPDF.Controls.Add(this.LabelPDFConformance);
            this.GPDF.Controls.Add(this.ComboPDFConformance);
            this.GPDF.Location = new System.Drawing.Point(8, 35);
            this.GPDF.Name = "GPDF";
            this.GPDF.Size = new System.Drawing.Size(617, 83);
            this.GPDF.TabIndex = 6;
            this.GPDF.TabStop = false;
            this.GPDF.Text = "PDF Options";
            // 
            // CcheckBoxPDFCompressed
            // 
            this.CcheckBoxPDFCompressed.AutoSize = true;
            this.CcheckBoxPDFCompressed.Location = new System.Drawing.Point(281, 57);
            this.CcheckBoxPDFCompressed.Name = "CcheckBoxPDFCompressed";
            this.CcheckBoxPDFCompressed.Size = new System.Drawing.Size(18, 17);
            this.CcheckBoxPDFCompressed.TabIndex = 10;
            this.CcheckBoxPDFCompressed.UseVisualStyleBackColor = true;
            // 
            // LabelCompressed
            // 
            this.LabelCompressed.AutoSize = true;
            this.LabelCompressed.Location = new System.Drawing.Point(6, 57);
            this.LabelCompressed.Name = "LabelCompressed";
            this.LabelCompressed.Size = new System.Drawing.Size(85, 16);
            this.LabelCompressed.TabIndex = 9;
            this.LabelCompressed.Text = "Compressed";
            // 
            // LabelPDFConformance
            // 
            this.LabelPDFConformance.AutoSize = true;
            this.LabelPDFConformance.Location = new System.Drawing.Point(6, 24);
            this.LabelPDFConformance.Name = "LabelPDFConformance";
            this.LabelPDFConformance.Size = new System.Drawing.Size(117, 16);
            this.LabelPDFConformance.TabIndex = 8;
            this.LabelPDFConformance.Text = "PDF Conformance";
            // 
            // ComboPDFConformance
            // 
            this.ComboPDFConformance.Anchor = ((System.Windows.Forms.AnchorStyles)(((System.Windows.Forms.AnchorStyles.Top | System.Windows.Forms.AnchorStyles.Left)
            | System.Windows.Forms.AnchorStyles.Right)));
            this.ComboPDFConformance.DropDownStyle = System.Windows.Forms.ComboBoxStyle.DropDownList;
            this.ComboPDFConformance.Items.AddRange(new object[] {
            "PDF 1.4",
            "PDF A/3"});
            this.ComboPDFConformance.Location = new System.Drawing.Point(281, 21);
            this.ComboPDFConformance.Name = "ComboPDFConformance";
            this.ComboPDFConformance.Size = new System.Drawing.Size(330, 24);
            this.ComboPDFConformance.TabIndex = 7;
            // 
            // ComboFormat
            // 
            this.ComboFormat.Anchor = ((System.Windows.Forms.AnchorStyles)(((System.Windows.Forms.AnchorStyles.Top | System.Windows.Forms.AnchorStyles.Left)
            | System.Windows.Forms.AnchorStyles.Right)));
            this.ComboFormat.DropDownStyle = System.Windows.Forms.ComboBoxStyle.DropDownList;
            this.ComboFormat.Location = new System.Drawing.Point(289, 3);
            this.ComboFormat.Name = "ComboFormat";
            this.ComboFormat.Size = new System.Drawing.Size(341, 24);
            this.ComboFormat.TabIndex = 5;
            // 
            // LPreferedFormat
            // 
            this.LPreferedFormat.AutoSize = true;
            this.LPreferedFormat.Location = new System.Drawing.Point(10, 7);
            this.LPreferedFormat.Name = "LPreferedFormat";
            this.LPreferedFormat.Size = new System.Drawing.Size(132, 16);
            this.LPreferedFormat.TabIndex = 4;
            this.LPreferedFormat.Text = "Prefered save format";
            // 
            // tabMetadata
            // 
            this.tabMetadata.Controls.Add(this.tableDocMetadata);
            this.tabMetadata.Location = new System.Drawing.Point(4, 25);
            this.tabMetadata.Name = "tabMetadata";
            this.tabMetadata.Padding = new System.Windows.Forms.Padding(3);
            this.tabMetadata.Size = new System.Drawing.Size(633, 387);
            this.tabMetadata.TabIndex = 3;
            this.tabMetadata.Text = "Metadata";
            this.tabMetadata.UseVisualStyleBackColor = true;
            // 
            // tableDocMetadata
            // 
            this.tableDocMetadata.Anchor = ((System.Windows.Forms.AnchorStyles)(((System.Windows.Forms.AnchorStyles.Top | System.Windows.Forms.AnchorStyles.Left)
            | System.Windows.Forms.AnchorStyles.Right)));
            this.tableDocMetadata.AutoSize = true;
            this.tableDocMetadata.ColumnCount = 2;
            this.tableDocMetadata.ColumnStyles.Add(new System.Windows.Forms.ColumnStyle());
            this.tableDocMetadata.ColumnStyles.Add(new System.Windows.Forms.ColumnStyle(System.Windows.Forms.SizeType.Percent, 100F));
            this.tableDocMetadata.Controls.Add(this.textDocKeywords, 1, 3);
            this.tableDocMetadata.Controls.Add(this.labelKeywords, 0, 3);
            this.tableDocMetadata.Controls.Add(this.textDocXMPMetadata, 1, 8);
            this.tableDocMetadata.Controls.Add(this.labelXMPMetadata, 0, 8);
            this.tableDocMetadata.Controls.Add(this.textDocModifyDate, 1, 7);
            this.tableDocMetadata.Controls.Add(this.labelDocModifyDate, 0, 7);
            this.tableDocMetadata.Controls.Add(this.textDocCreationDate, 1, 6);
            this.tableDocMetadata.Controls.Add(this.labelDocCreationDate, 0, 6);
            this.tableDocMetadata.Controls.Add(this.textDocProducer, 1, 5);
            this.tableDocMetadata.Controls.Add(this.labelDocProducer, 0, 5);
            this.tableDocMetadata.Controls.Add(this.textDocCreator, 1, 4);
            this.tableDocMetadata.Controls.Add(this.labelDocCreator, 0, 4);
            this.tableDocMetadata.Controls.Add(this.textDocSubject, 1, 2);
            this.tableDocMetadata.Controls.Add(this.labelDocSubject, 0, 2);
            this.tableDocMetadata.Controls.Add(this.textDocTitle, 1, 1);
            this.tableDocMetadata.Controls.Add(this.labelDocTitle, 0, 1);
            this.tableDocMetadata.Controls.Add(this.labelAuthor, 0, 0);
            this.tableDocMetadata.Controls.Add(this.textDocAuthor, 1, 0);
            this.tableDocMetadata.Location = new System.Drawing.Point(9, 6);
            this.tableDocMetadata.Name = "tableDocMetadata";
            this.tableDocMetadata.RowCount = 9;
            this.tableDocMetadata.RowStyles.Add(new System.Windows.Forms.RowStyle());
            this.tableDocMetadata.RowStyles.Add(new System.Windows.Forms.RowStyle());
            this.tableDocMetadata.RowStyles.Add(new System.Windows.Forms.RowStyle());
            this.tableDocMetadata.RowStyles.Add(new System.Windows.Forms.RowStyle());
            this.tableDocMetadata.RowStyles.Add(new System.Windows.Forms.RowStyle());
            this.tableDocMetadata.RowStyles.Add(new System.Windows.Forms.RowStyle());
            this.tableDocMetadata.RowStyles.Add(new System.Windows.Forms.RowStyle());
            this.tableDocMetadata.RowStyles.Add(new System.Windows.Forms.RowStyle());
            this.tableDocMetadata.RowStyles.Add(new System.Windows.Forms.RowStyle());
            this.tableDocMetadata.Size = new System.Drawing.Size(616, 380);
            this.tableDocMetadata.TabIndex = 0;
            // 
            // textDocKeywords
            // 
            this.textDocKeywords.Anchor = ((System.Windows.Forms.AnchorStyles)((System.Windows.Forms.AnchorStyles.Left | System.Windows.Forms.AnchorStyles.Right)));
            this.textDocKeywords.Location = new System.Drawing.Point(104, 87);
            this.textDocKeywords.Name = "textDocKeywords";
            this.textDocKeywords.Size = new System.Drawing.Size(509, 22);
            this.textDocKeywords.TabIndex = 18;
            // 
            // labelKeywords
            // 
            this.labelKeywords.Anchor = ((System.Windows.Forms.AnchorStyles)((System.Windows.Forms.AnchorStyles.Left | System.Windows.Forms.AnchorStyles.Right)));
            this.labelKeywords.AutoSize = true;
            this.labelKeywords.Location = new System.Drawing.Point(3, 90);
            this.labelKeywords.Name = "labelKeywords";
            this.labelKeywords.Size = new System.Drawing.Size(95, 16);
            this.labelKeywords.TabIndex = 17;
            this.labelKeywords.Text = "Keywords";
            // 
            // textDocXMPMetadata
            // 
            this.textDocXMPMetadata.Anchor = ((System.Windows.Forms.AnchorStyles)((System.Windows.Forms.AnchorStyles.Left | System.Windows.Forms.AnchorStyles.Right)));
            this.textDocXMPMetadata.Location = new System.Drawing.Point(104, 227);
            this.textDocXMPMetadata.Multiline = true;
            this.textDocXMPMetadata.Name = "textDocXMPMetadata";
            this.textDocXMPMetadata.ScrollBars = System.Windows.Forms.ScrollBars.Both;
            this.textDocXMPMetadata.Size = new System.Drawing.Size(509, 150);
            this.textDocXMPMetadata.TabIndex = 16;
            this.textDocXMPMetadata.WordWrap = false;
            // 
            // labelXMPMetadata
            // 
            this.labelXMPMetadata.Anchor = ((System.Windows.Forms.AnchorStyles)((System.Windows.Forms.AnchorStyles.Left | System.Windows.Forms.AnchorStyles.Right)));
            this.labelXMPMetadata.AutoSize = true;
            this.labelXMPMetadata.Location = new System.Drawing.Point(3, 294);
            this.labelXMPMetadata.Name = "labelXMPMetadata";
            this.labelXMPMetadata.Size = new System.Drawing.Size(95, 16);
            this.labelXMPMetadata.TabIndex = 15;
            this.labelXMPMetadata.Text = "XMP Metadata";
            // 
            // textDocModifyDate
            // 
            this.textDocModifyDate.Anchor = ((System.Windows.Forms.AnchorStyles)((System.Windows.Forms.AnchorStyles.Left | System.Windows.Forms.AnchorStyles.Right)));
            this.textDocModifyDate.Location = new System.Drawing.Point(104, 199);
            this.textDocModifyDate.Name = "textDocModifyDate";
            this.textDocModifyDate.Size = new System.Drawing.Size(509, 22);
            this.textDocModifyDate.TabIndex = 14;
            // 
            // labelDocModifyDate
            // 
            this.labelDocModifyDate.Anchor = ((System.Windows.Forms.AnchorStyles)((System.Windows.Forms.AnchorStyles.Left | System.Windows.Forms.AnchorStyles.Right)));
            this.labelDocModifyDate.AutoSize = true;
            this.labelDocModifyDate.Location = new System.Drawing.Point(3, 202);
            this.labelDocModifyDate.Name = "labelDocModifyDate";
            this.labelDocModifyDate.Size = new System.Drawing.Size(95, 16);
            this.labelDocModifyDate.TabIndex = 13;
            this.labelDocModifyDate.Text = "Modify Date";
            // 
            // textDocCreationDate
            // 
            this.textDocCreationDate.Anchor = ((System.Windows.Forms.AnchorStyles)((System.Windows.Forms.AnchorStyles.Left | System.Windows.Forms.AnchorStyles.Right)));
            this.textDocCreationDate.Location = new System.Drawing.Point(104, 171);
            this.textDocCreationDate.Name = "textDocCreationDate";
            this.textDocCreationDate.Size = new System.Drawing.Size(509, 22);
            this.textDocCreationDate.TabIndex = 12;
            // 
            // labelDocCreationDate
            // 
            this.labelDocCreationDate.Anchor = ((System.Windows.Forms.AnchorStyles)((System.Windows.Forms.AnchorStyles.Left | System.Windows.Forms.AnchorStyles.Right)));
            this.labelDocCreationDate.AutoSize = true;
            this.labelDocCreationDate.Location = new System.Drawing.Point(3, 174);
            this.labelDocCreationDate.Name = "labelDocCreationDate";
            this.labelDocCreationDate.Size = new System.Drawing.Size(95, 16);
            this.labelDocCreationDate.TabIndex = 11;
            this.labelDocCreationDate.Text = "Creation Date";
            // 
            // textDocProducer
            // 
            this.textDocProducer.Anchor = ((System.Windows.Forms.AnchorStyles)((System.Windows.Forms.AnchorStyles.Left | System.Windows.Forms.AnchorStyles.Right)));
            this.textDocProducer.Location = new System.Drawing.Point(104, 143);
            this.textDocProducer.Name = "textDocProducer";
            this.textDocProducer.Size = new System.Drawing.Size(509, 22);
            this.textDocProducer.TabIndex = 10;
            // 
            // labelDocProducer
            // 
            this.labelDocProducer.Anchor = ((System.Windows.Forms.AnchorStyles)((System.Windows.Forms.AnchorStyles.Left | System.Windows.Forms.AnchorStyles.Right)));
            this.labelDocProducer.AutoSize = true;
            this.labelDocProducer.Location = new System.Drawing.Point(3, 146);
            this.labelDocProducer.Name = "labelDocProducer";
            this.labelDocProducer.Size = new System.Drawing.Size(95, 16);
            this.labelDocProducer.TabIndex = 9;
            this.labelDocProducer.Text = "Producer";
            // 
            // textDocCreator
            // 
            this.textDocCreator.Anchor = ((System.Windows.Forms.AnchorStyles)((System.Windows.Forms.AnchorStyles.Left | System.Windows.Forms.AnchorStyles.Right)));
            this.textDocCreator.Location = new System.Drawing.Point(104, 115);
            this.textDocCreator.Name = "textDocCreator";
            this.textDocCreator.Size = new System.Drawing.Size(509, 22);
            this.textDocCreator.TabIndex = 8;
            // 
            // labelDocCreator
            // 
            this.labelDocCreator.Anchor = ((System.Windows.Forms.AnchorStyles)((System.Windows.Forms.AnchorStyles.Left | System.Windows.Forms.AnchorStyles.Right)));
            this.labelDocCreator.AutoSize = true;
            this.labelDocCreator.Location = new System.Drawing.Point(3, 118);
            this.labelDocCreator.Name = "labelDocCreator";
            this.labelDocCreator.Size = new System.Drawing.Size(95, 16);
            this.labelDocCreator.TabIndex = 7;
            this.labelDocCreator.Text = "Creator";
            // 
            // textDocSubject
            // 
            this.textDocSubject.Anchor = ((System.Windows.Forms.AnchorStyles)((System.Windows.Forms.AnchorStyles.Left | System.Windows.Forms.AnchorStyles.Right)));
            this.textDocSubject.Location = new System.Drawing.Point(104, 59);
            this.textDocSubject.Name = "textDocSubject";
            this.textDocSubject.Size = new System.Drawing.Size(509, 22);
            this.textDocSubject.TabIndex = 6;
            // 
            // labelDocSubject
            // 
            this.labelDocSubject.Anchor = ((System.Windows.Forms.AnchorStyles)((System.Windows.Forms.AnchorStyles.Left | System.Windows.Forms.AnchorStyles.Right)));
            this.labelDocSubject.AutoSize = true;
            this.labelDocSubject.Location = new System.Drawing.Point(3, 62);
            this.labelDocSubject.Name = "labelDocSubject";
            this.labelDocSubject.Size = new System.Drawing.Size(95, 16);
            this.labelDocSubject.TabIndex = 5;
            this.labelDocSubject.Text = "Subject";
            // 
            // textDocTitle
            // 
            this.textDocTitle.Anchor = ((System.Windows.Forms.AnchorStyles)((System.Windows.Forms.AnchorStyles.Left | System.Windows.Forms.AnchorStyles.Right)));
            this.textDocTitle.Location = new System.Drawing.Point(104, 31);
            this.textDocTitle.Name = "textDocTitle";
            this.textDocTitle.Size = new System.Drawing.Size(509, 22);
            this.textDocTitle.TabIndex = 4;
            // 
            // labelDocTitle
            // 
            this.labelDocTitle.Anchor = ((System.Windows.Forms.AnchorStyles)((System.Windows.Forms.AnchorStyles.Left | System.Windows.Forms.AnchorStyles.Right)));
            this.labelDocTitle.AutoSize = true;
            this.labelDocTitle.Location = new System.Drawing.Point(3, 34);
            this.labelDocTitle.Name = "labelDocTitle";
            this.labelDocTitle.Size = new System.Drawing.Size(95, 16);
            this.labelDocTitle.TabIndex = 3;
            this.labelDocTitle.Text = "Title";
            // 
            // labelAuthor
            // 
            this.labelAuthor.Anchor = ((System.Windows.Forms.AnchorStyles)((System.Windows.Forms.AnchorStyles.Left | System.Windows.Forms.AnchorStyles.Right)));
            this.labelAuthor.AutoSize = true;
            this.labelAuthor.Location = new System.Drawing.Point(3, 6);
            this.labelAuthor.Name = "labelAuthor";
            this.labelAuthor.Size = new System.Drawing.Size(95, 16);
            this.labelAuthor.TabIndex = 1;
            this.labelAuthor.Text = "Author";
            // 
            // textDocAuthor
            // 
            this.textDocAuthor.Anchor = ((System.Windows.Forms.AnchorStyles)((System.Windows.Forms.AnchorStyles.Left | System.Windows.Forms.AnchorStyles.Right)));
            this.textDocAuthor.Location = new System.Drawing.Point(104, 3);
            this.textDocAuthor.Name = "textDocAuthor";
            this.textDocAuthor.Size = new System.Drawing.Size(509, 22);
            this.textDocAuthor.TabIndex = 2;
            // 
            // contextMenuStrip1
            // 
            this.contextMenuStrip1.ImageScalingSize = new System.Drawing.Size(20, 20);
            this.contextMenuStrip1.Name = "contextMenuStrip1";
            this.contextMenuStrip1.Size = new System.Drawing.Size(61, 4);
            // 
            // PageSetup
            // 
            this.AcceptButton = this.bok;
            this.AutoScaleBaseSize = new System.Drawing.Size(6, 15);
            this.ClientSize = new System.Drawing.Size(646, 506);
            this.Controls.Add(this.PControl);
            this.Controls.Add(this.pbottom);
            this.FormBorderStyle = System.Windows.Forms.FormBorderStyle.FixedDialog;
            this.Name = "PageSetup";
            this.ShowInTaskbar = false;
            this.StartPosition = System.Windows.Forms.FormStartPosition.CenterScreen;
            this.pbottom.ResumeLayout(false);
            this.PControl.ResumeLayout(false);
            this.tabpagesetup.ResumeLayout(false);
            this.tabpagesetup.PerformLayout();
            ((System.ComponentModel.ISupportInitialize)(this.ECopies)).EndInit();
            this.RPageMargins.ResumeLayout(false);
            this.RPageMargins.PerformLayout();
            ((System.ComponentModel.ISupportInitialize)(this.MBottom)).EndInit();
            ((System.ComponentModel.ISupportInitialize)(this.MTop)).EndInit();
            ((System.ComponentModel.ISupportInitialize)(this.MRight)).EndInit();
            ((System.ComponentModel.ISupportInitialize)(this.MLeft)).EndInit();
            this.RPageOrientation.ResumeLayout(false);
            this.RPageSize.ResumeLayout(false);
            this.RPageOrientationDefine.ResumeLayout(false);
            this.GPageSize.ResumeLayout(false);
            this.GUserDefined.ResumeLayout(false);
            this.GUserDefined.PerformLayout();
            ((System.ComponentModel.ISupportInitialize)(this.EPageHeight)).EndInit();
            ((System.ComponentModel.ISupportInitialize)(this.EPageWidth)).EndInit();
            this.tabprintsetup.ResumeLayout(false);
            this.tabprintsetup.PerformLayout();
            ((System.ComponentModel.ISupportInitialize)(this.ELinesPerInch)).EndInit();
            ((System.ComponentModel.ISupportInitialize)(this.EPaperSource)).EndInit();
            this.taboptions.ResumeLayout(false);
            this.panelParentEmbedded.ResumeLayout(false);
            this.toolStripContainer1.ContentPanel.ResumeLayout(false);
            this.toolStripContainer1.TopToolStripPanel.ResumeLayout(false);
            this.toolStripContainer1.TopToolStripPanel.PerformLayout();
            this.toolStripContainer1.ResumeLayout(false);
            this.toolStripContainer1.PerformLayout();
            this.toolStrip1.ResumeLayout(false);
            this.toolStrip1.PerformLayout();
            this.panelLabelEmbedded.ResumeLayout(false);
            this.panelLabelEmbedded.PerformLayout();
            this.panelOptionsTop.ResumeLayout(false);
            this.panelOptionsTop.PerformLayout();
            this.GPDF.ResumeLayout(false);
            this.GPDF.PerformLayout();
            this.tabMetadata.ResumeLayout(false);
            this.tabMetadata.PerformLayout();
            this.tableDocMetadata.ResumeLayout(false);
            this.tableDocMetadata.PerformLayout();
            this.ResumeLayout(false);

        }
        #endregion
        private bool dook;
        private Report FReport;
        /// <summary>
        /// Show page setup dialog for the report
        /// </summary>
        /// <param name="rp">Report to modify</param>
        /// <param name="showadvanced">Set this parameter to true to show advanced tab, usually only useful 
        /// while designing the report</param>
        /// <returns>Returns true if the user modified the report</returns>
        public static bool ShowPageSetup(Report rp, bool showadvanced, IWin32Window parent = null)
        {
            using (PageSetup dia = new PageSetup())
            {
                dia.SetReport(rp);
                dia.ShowDialog(parent);
                return (dia.dook);
            }
        }
        private void bok_Click(object sender, System.EventArgs e)
        {
            short linch = (short)Math.Round(ELinesPerInch.Value * 100);
            if (linch < 100)
                linch = 100;
            if (linch > 3000)
                linch = 3000;
            Report rp = FReport;
            rp.LinesPerInch = linch;

            int acopies;
            if (CheckDefaultCopies.Checked)
                acopies = 0;
            else
                acopies = (int)ECopies.Value;
            if (acopies < 0)
                acopies = 1;
            rp.Copies = acopies;
            rp.CollateCopies = CheckCollateCopies.Checked;
            rp.TwoPass = CheckTwoPass.Checked;
            rp.PreviewAbout = CheckPreviewAbout.Checked;
            rp.PrintOnlyIfDataAvailable = CheckPrintOnlyIfData.Checked;
            rp.ActionBefore = CheckDrawerBefore.Checked;
            rp.ActionAfter = CheckDrawerAfter.Checked;
            rp.PageSize = PageSizeType.Default;
            if (rpagedefine.Checked)
                rp.PageSize = PageSizeType.Custom;
            else
                if (rpagecustom.Checked)
                rp.PageSize = PageSizeType.User;
            rp.PageSizeIndex = ComboPageSize.SelectedIndex;
            if (rp.PageSizeIndex < 0)
                rp.PageSizeIndex = 0;
            rp.PageWidth = PrintOut.PageSizeArray[rp.PageSizeIndex, 0] * Twips.TWIPS_PER_INCH / 1000;
            rp.PageHeight = PrintOut.PageSizeArray[rp.PageSizeIndex, 0] * Twips.TWIPS_PER_INCH / 1000;
            if (EPageWidth.Value != oldcustompagewidth)
                rp.CustomPageWidth = Twips.TwipsFromUnits(EPageWidth.Value);
            if (EPageHeight.Value != oldcustompageheight)
                rp.CustomPageHeight = Twips.TwipsFromUnits(EPageHeight.Value);
            if (MLeft.Value != oldmleft)
                rp.LeftMargin = Twips.TwipsFromUnits(MLeft.Value);
            if (MTop.Value != oldmtop)
                rp.TopMargin = Twips.TwipsFromUnits(MTop.Value);
            if (MRight.Value != oldmright)
                rp.RightMargin = Twips.TwipsFromUnits(MRight.Value);
            if (MBottom.Value != oldmbottom)
                rp.BottomMargin = Twips.TwipsFromUnits(MBottom.Value);

            rp.PageOrientation = OrientationType.Default;
            if (rorientationdefine.Checked)
            {
                if (rportrait.Checked)
                    rp.PageOrientation = OrientationType.Portrait;
                else
                    rp.PageOrientation = OrientationType.Landscape;
            }
            rp.PrinterSelect = (PrinterSelectType)ComboSelPrinter.SelectedIndex;
            rp.PageBackColor = Reportman.Drawing.GraphicUtils.IntegerFromColor(PanelColor.BackColor);
            rp.Language = ComboLanguage.SelectedIndex - 1;
            rp.PrinterFonts = (PrinterFontsType)ComboPrinterFonts.SelectedIndex;
            rp.PreviewMargins = CheckMargins.Checked;
            rp.PreviewWindow = (PreviewWindowStyleType)ComboPreview.SelectedIndex;
            rp.AutoScale = (AutoScaleType)ComboStyle.SelectedIndex;
            rp.StreamFormat = (StreamFormatType)ComboFormat.SelectedIndex;
            rp.PaperSource = (int)EPaperSource.Value;
            rp.Duplex = ComboDuplex.SelectedIndex;
            rp.ForcePaperName = EForceFormName.Text;

            rp.PDFConformance = (PDFConformanceType)ComboPDFConformance.SelectedIndex;
            rp.PDFCompressed = CcheckBoxPDFCompressed.Checked;
            rp.DocAuthor = textDocAuthor.Text;
            rp.DocCreator = textDocCreator.Text;
            rp.DocProducer = textDocProducer.Text;
            rp.DocTitle = textDocTitle.Text;
            rp.DocSubject = textDocSubject.Text;
            rp.DocCreationDate = textDocCreationDate.Text;
            rp.DocModificationDate = textDocModifyDate.Text;
            rp.DocKeywords = textDocKeywords.Text;
            rp.DocXMPContent = textDocXMPMetadata.Text;
            foreach (var efile in rp.EmbeddedFiles)
            {
                if (efile.Stream != null)
                {
                    efile.Stream.Dispose();
                    efile.Stream = null;
                }
            }
            rp.EmbeddedFiles.Clear();
            foreach (var efile in EmbeddedFiles)
            {
                rp.EmbeddedFiles.Add(efile);
            }

            dook = true;
            Close();
        }
        private void SetReport(Report rp)
        {
            FReport = rp;
            ELinesPerInch.Value = rp.LinesPerInch / 100;
            if (rp.Copies == 0)
            {
                CheckDefaultCopies.Checked = true;
                ECopies.Value = 1;
                CheckDefaultCopies_CheckedChanged(this, new EventArgs());
            }
            else
                ECopies.Value = rp.Copies;
            switch (FReport.PageSize)
            {
                case PageSizeType.Custom:
                    this.rpagedefine.Checked = true;
                    break;
                case PageSizeType.Default:
                    this.rpagedefault.Checked = true;
                    break;
                case PageSizeType.User:
                    this.rpagecustom.Checked = true;
                    break;
            }
            rpagedefault_Click(this, new EventArgs());
            EPageWidth.Value = Twips.UnitsFromTwips(FReport.CustomPageWidth);
            EPageHeight.Value = Twips.UnitsFromTwips(FReport.CustomPageHeight);
            EForceFormName.Text = FReport.ForcePaperName;
            CheckCollateCopies.Checked = rp.CollateCopies;
            CheckTwoPass.Checked = rp.TwoPass;
            CheckPreviewAbout.Checked = rp.PreviewAbout;
            CheckMargins.Checked = rp.PreviewMargins;
            CheckPrintOnlyIfData.Checked = rp.PrintOnlyIfDataAvailable;
            MLeft.Value = Twips.UnitsFromTwips(rp.LeftMargin);
            MTop.Value = Twips.UnitsFromTwips(rp.TopMargin);
            MRight.Value = Twips.UnitsFromTwips(rp.RightMargin);
            MBottom.Value = Twips.UnitsFromTwips(rp.BottomMargin);
            oldcustompageheight = EPageHeight.Value;
            oldcustompagewidth = EPageWidth.Value;
            oldmbottom = MBottom.Value;
            oldmright = MRight.Value;
            oldmtop = MTop.Value;
            oldmleft = MLeft.Value;
            ComboPageSize.SelectedIndex = rp.PageSizeIndex;
            if (rp.PageOrientation > OrientationType.Default)
            {
                rorientationdefine.Checked = true;
                if (rp.PageOrientation == OrientationType.Landscape)
                    rlandscape.Checked = true;
                else
                    rportrait.Checked = true;
            }
            else
            {
                rorientationdefault.Checked = true;
            }
            rorientationdefault_CheckedChanged(this, new EventArgs());
            ComboSelPrinter.SelectedIndex = (int)rp.PrinterSelect;
            PanelColor.BackColor = GraphicUtils.ColorFromInteger(rp.PageBackColor);
            ComboPrinterFonts.SelectedIndex = (int)rp.PrinterFonts;
            ComboLanguage.SelectedIndex = 0;
            if ((rp.Language + 1) < ComboLanguage.Items.Count)
                ComboLanguage.SelectedIndex = rp.Language + 1;
            ComboPreview.SelectedIndex = (int)rp.PreviewWindow;
            ComboStyle.SelectedIndex = (int)rp.AutoScale;
            ComboFormat.SelectedIndex = (int)rp.StreamFormat;
            EPaperSource.Value = rp.PaperSource;
            ComboDuplex.SelectedIndex = rp.Duplex;

            ComboPDFConformance.SelectedIndex = (int)(rp.PDFConformance);
            CcheckBoxPDFCompressed.Checked = rp.PDFCompressed;

            textDocAuthor.Text = rp.DocAuthor;
            textDocCreator.Text = rp.DocCreator;
            textDocProducer.Text = rp.DocProducer;
            textDocTitle.Text = rp.DocTitle;
            textDocSubject.Text = rp.DocSubject;
            textDocCreationDate.Text = rp.DocCreationDate;
            textDocModifyDate.Text = rp.DocModificationDate;
            textDocKeywords.Text = rp.DocKeywords;
            textDocXMPMetadata.Text = rp.DocXMPContent;

            foreach (var efile in rp.EmbeddedFiles)
            {
                EmbeddedFiles.Add((EmbeddedFile)efile.Clone());
            }
            UpdateEmbeddedList();
        }
        private void UpdateEmbeddedList()
        {
            listViewEmbedded.Items.Clear();
            foreach (var embedded in EmbeddedFiles)
            {
                ListViewItem listItem = new ListViewItem();
                listItem.Text = embedded.FileName;
                listItem.SubItems.Add(embedded.MimeType);
                listItem.SubItems.Add(StringUtil.GetSizeAsSmallString(embedded.Stream.Length));
                listItem.SubItems.Add(embedded.AFRelationShipToString());
                listItem.SubItems.Add(embedded.Description);
                listItem.SubItems.Add(embedded.CreationDate);
                listItem.SubItems.Add(embedded.ModificationDate);
                listViewEmbedded.Items.Add(listItem);
            }
            if (listViewEmbedded.Items.Count > 0)
                listViewEmbedded.Items[0].Selected = true;
        }

        private void rpagedefault_Click(object sender, EventArgs e)
        {
            GPageSize.Visible = rpagedefine.Checked;
            GUserDefined.Visible = rpagecustom.Checked;
        }

        private void CheckDefaultCopies_CheckedChanged(object sender, EventArgs e)
        {
            ECopies.Enabled = !CheckDefaultCopies.Checked;
        }

        private void rorientationdefault_CheckedChanged(object sender, EventArgs e)
        {
            RPageOrientationDefine.Visible = !rorientationdefault.Checked;
        }

        private void EPaperSource_ValueChanged(object sender, EventArgs e)
        {
            ComboPaperSource.SelectedIndex = -1;
            if (EPaperSource.Value < ComboPaperSource.Items.Count)
                ComboPaperSource.SelectedIndex = System.Convert.ToInt32(EPaperSource.Value);
        }

        private void bdelete_Click(object sender, EventArgs e)
        {
            List<EmbeddedFile> newEmbeddedFiles = new List<EmbeddedFile>();
            if (listViewEmbedded.SelectedIndices.Count != 1)
            {
                return;
            }
            int index = listViewEmbedded.SelectedIndices[0];
            EmbeddedFiles[index].Dispose();
            EmbeddedFiles.RemoveAt(index);
            UpdateEmbeddedList();
        }

        private void bnew_Click(object sender, EventArgs e)
        {
            OpenFileDialog ofd = new OpenFileDialog();
            ofd.Filter = "(*.*)|*.*";
            // Open file dialog
            if (ofd.ShowDialog() != DialogResult.OK)
            {
                return;
            }
            var embedded = new EmbeddedFile();
            embedded.FileName = System.IO.Path.GetFileName(ofd.FileName);
            embedded.Stream = StreamUtil.FileToMemoryStream(ofd.FileName);
            switch (Path.GetExtension(embedded.FileName).ToUpper())
            {
                case ".XML":
                    embedded.MimeType = "application/xml";
                    break;
                case ".PDF":
                    embedded.MimeType = "application/pdf";
                    break;
                case ".TXT":
                    embedded.MimeType = "text/plain";
                    break;
                case ".PNG":
                    embedded.MimeType = "image/png";
                    break;
                case ".JPG":
                    embedded.MimeType = "image/jpg";
                    break;
                case ".BMP":
                    embedded.MimeType = "image/bmp";
                    break;
                default:
                    embedded.MimeType = "application/octet-stream";
                    break;
            }
            if (EmbeddedFileForm.AskEmbeddedFileData(embedded))
            {
                EmbeddedFiles.Add(embedded);
                UpdateEmbeddedList();
            }
            else
            {
                embedded.Dispose();
            }
        }

        private void bmodify_Click(object sender, EventArgs e)
        {
            if (listViewEmbedded.SelectedIndices.Count != 1)
            {
                return;
            }
            int index = listViewEmbedded.SelectedIndices[0];
            if (EmbeddedFileForm.AskEmbeddedFileData(EmbeddedFiles[index]))
                UpdateEmbeddedList();
        }

        private void ComboPaperSource_SelectedIndexChanged(object sender, EventArgs e)
        {
            if (ComboPaperSource.SelectedIndex < 0)
                return;
            if (ComboPaperSource.SelectedIndex != EPaperSource.Value)
                EPaperSource.Value = ComboPaperSource.SelectedIndex;
        }

        private void PanelColor_Paint(object sender, PaintEventArgs e)
        {
        }

        private void PanelColor_Click(object sender, EventArgs e)
        {
            cdialog.Color = PanelColor.BackColor;
            if (cdialog.ShowDialog() == DialogResult.OK)
            {
                PanelColor.BackColor = cdialog.Color;
            }
        }

        private void BConfigurePrinters_Click(object sender, EventArgs e)
        {
            // Configure printers
            PrintersConfiguration.ShowPrintersConfiguration(this);
        }
    }
}
