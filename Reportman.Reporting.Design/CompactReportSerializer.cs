using System;
using System.IO;
using System.Text;
using Reportman.Drawing;
using Reportman.Reporting;

namespace Reportman.Reporting.Design
{
    /// <summary>
    /// Serializes a Report into a compact text DSL for LLM context.
    /// Only non-default property values are emitted to reduce token usage.
    /// Font names are always included (Report Manager has no parent-font inheritance).
    /// </summary>
    public static class CompactReportSerializer
    {
        public static string Serialize(Report report)
        {
            var sb = new StringBuilder(4096);
            WriteDefaults(sb);
            sb.AppendLine();
            WriteReport(sb, report);
            return sb.ToString();
        }

        #region Defaults

        private static void WriteDefaults(StringBuilder sb)
        {
            sb.AppendLine("# DEFAULTS (omitted properties have these values)");
            sb.AppendLine("REPORT: FontName=\"Arial\" FontSize=10 FontStyle=0 FontRotation=0 FontColor=0x000000 BackColor=0xFFFFFF Transparent=true CutText=false Alignment=Left VAlignment=Top WordWrap=false SingleLine=false MultiPage=false PrintStep=BySize Type1Font=Helvetica PageOrientation=Default PageSize=Default PageHeight=16837 PageWidth=11906 CustomPageHeight=16837 CustomPageWidth=11906 PageBackColor=0xFFFFFF LeftMargin=574 RightMargin=574 TopMargin=574 BottomMargin=861 LinesPerInch=600 PaperSource=0 Duplex=0 AutoScale=Wide PreviewWindow=Normal PreviewMargins=false PreviewAbout=true GridVisible=true GridEnabled=true GridLines=false GridColor=0xFF0000 GridWidth=115 GridHeight=115 Copies=1 CollateCopies=false TwoPass=false PrinterFonts=Default PrintOnlyIfDataAvailable=false PrinterSelect=DefaultPrinter PDFConformance=PDF_1_4 PDFCompressed=false StreamFormat=Text ActionBefore=false ActionAfter=false Language=-1");
            sb.AppendLine("SECTION: Width=10700 Height=1500 GroupName=\"\" ChangeExpression=\"\" ChangeBool=false PageRepeat=false SkipPage=false SkipType=Default AlignBottom=false AutoExpand=false AutoContract=false HorzDesp=false VertDesp=false ForcePrint=false BeginPage=false IniNumPage=false Global=false Visible=true BackStyle=Design DrawStyle=Full SharedImage=None dpires=96 StreamFormat=Text SyncWidth=true PrintCondition=\"\" DoBeforePrint=\"\" DoAfterPrint=\"\" BackExpression=\"\"");
            sb.AppendLine("EXPRESSION: Width=1440 Height=275 FontName=\"Arial\" FontSize=10 FontStyle=0 FontColor=0x000000 BackColor=0xFFFFFF Transparent=true CutText=false WordWrap=false Alignment=Left VAlignment=Top SingleLine=false MultiPage=false PrintStep=BySize Type1Font=Helvetica IsHtml=false RightToLeft=false Expression=\"\" Aggregate=None AgType=Summary DataType=Unknown PrintNulls=true PrintOnlyOne=false AutoExpand=false AutoContract=false ExportSize=1 Align=None Hidden=false PrintCondition=\"\" DoBeforePrint=\"\" DoAfterPrint=\"\"");
            sb.AppendLine("LABEL: Width=0 Height=0 FontName=\"Arial\" FontSize=10 FontStyle=0 FontColor=0x000000 BackColor=0xFFFFFF Transparent=true CutText=false WordWrap=false Alignment=Left VAlignment=Top SingleLine=false MultiPage=false PrintStep=BySize Type1Font=Helvetica IsHtml=false RightToLeft=false Text=\"\" Align=None Hidden=false PrintCondition=\"\" DoBeforePrint=\"\" DoAfterPrint=\"\"");
            sb.AppendLine("IMAGE: Width=500 Height=500 Expression=\"\" DrawStyle=Crop dpires=100 CopyMode=0 Rotation=0 SharedImage=None Align=None Hidden=false PrintCondition=\"\" DoBeforePrint=\"\" DoAfterPrint=\"\"");
            sb.AppendLine("SHAPE: Width=500 Height=500 Shape=Rectangle BrushStyle=Solid BrushColor=0xFFFFFF PenStyle=Solid PenColor=0x000000 PenWidth=0 Color=0x000000 Align=None Hidden=false PrintCondition=\"\" DoBeforePrint=\"\" DoAfterPrint=\"\"");
            sb.AppendLine("BARCODE: Width=500 Height=500 Expression=\"'5449000000996'\" BarType=CodeEAN13 Modul=10 Ratio=2.0 Checksum=false Rotation=0 BColor=0x000000 BackColor=0xFFFFFF Transparent=false ECCLevel=-1 Truncated=false Align=None Hidden=false PrintCondition=\"\" DoBeforePrint=\"\" DoAfterPrint=\"\"");
            sb.AppendLine("CHART: Width=500 Height=500 FontName=\"Arial\" FontSize=10 FontStyle=0 FontColor=0x000000 BackColor=0xFFFFFF Transparent=true ChartStyle=Line Driver=Default View3d=true Perspective=15 Elevation=345 Rotation=345 Zoom=100 Orthogonal=true MultiBar=Side Resolution=100 ShowLegend=false ShowHint=true MarkStyle=0 AutoRange=Default Align=None Hidden=false PrintCondition=\"\" DoBeforePrint=\"\" DoAfterPrint=\"\"");
            sb.AppendLine("SUBREPORT: Alias=\"\" PrintOnlyIfDataAvailable=true ReOpenOnPrint=true ParentSub=\"\" ParentSec=\"\"");
            sb.AppendLine("DATABASE: Alias=\"\" Driver=DotNet2 ProviderFactory=\"\" ConnectionString=\"\"");
            sb.AppendLine("DATASET: Alias=\"\" DatabaseAlias=\"\" SQL=\"\" BDEType=Query OpenOnStart=true GroupUnion=false ParallelUnion=false");
            sb.AppendLine("PARAM: ParamType=String Alias=\"\" Visible=false IsReadOnly=false NeverVisible=false AllowNulls=false");
        }

        #endregion

        #region Report

        private static void WriteReport(StringBuilder sb, Report report)
        {
            sb.AppendLine("REPORT");
            const string i = "  ";

            // Font — always emit (batch editor maps FontName → WFontName + LFontName)
            AlwaysStr(sb, i, "FontName", report.WFontName);
            Int(sb, i, "FontSize", report.FontSize, 10);
            Int(sb, i, "FontStyle", report.FontStyle, 0);
            Int(sb, i, "FontRotation", report.FontRotation, 0);
            Col(sb, i, "FontColor", report.FontColor, 0);
            Col(sb, i, "BackColor", report.BackColor, 0xFFFFFF);
            Bool(sb, i, "Transparent", report.Transparent, true);
            Bool(sb, i, "CutText", report.CutText, false);
            Enm(sb, i, "Alignment", report.Alignment, TextAlignType.Left);
            Enm(sb, i, "VAlignment", report.VAlignment, TextAlignVerticalType.Top);
            Bool(sb, i, "WordWrap", report.WordWrap, false);
            Bool(sb, i, "SingleLine", report.SingleLine, false);
            Bool(sb, i, "MultiPage", report.MultiPage, false);
            Enm(sb, i, "PrintStep", report.PrintStep, PrintStepType.BySize);
            Enm(sb, i, "Type1Font", report.Type1Font, PDFFontType.Helvetica);

            // Page
            Enm(sb, i, "PageOrientation", report.PageOrientation, OrientationType.Default);
            Enm(sb, i, "PageSize", report.PageSize, PageSizeType.Default);
            Int(sb, i, "PageHeight", report.PageHeight, 16837);
            Int(sb, i, "PageWidth", report.PageWidth, 11906);
            Int(sb, i, "CustomPageHeight", report.CustomPageHeight, 16837);
            Int(sb, i, "CustomPageWidth", report.CustomPageWidth, 11906);
            Col(sb, i, "PageBackColor", report.PageBackColor, 0xFFFFFF);
            Int(sb, i, "LeftMargin", report.LeftMargin, 574);
            Int(sb, i, "RightMargin", report.RightMargin, 574);
            Int(sb, i, "TopMargin", report.TopMargin, 574);
            Int(sb, i, "BottomMargin", report.BottomMargin, 861);
            Int(sb, i, "LinesPerInch", report.LinesPerInch, 600);
            Int(sb, i, "PaperSource", report.PaperSource, 0);
            Int(sb, i, "Duplex", report.Duplex, 0);
            Str(sb, i, "ForcePaperName", report.ForcePaperName, "");
            Int(sb, i, "PageSizeIndex", report.PageSizeIndex, 0);

            // Scale / preview
            Enm(sb, i, "AutoScale", report.AutoScale, AutoScaleType.Wide);
            Enm(sb, i, "PreviewWindow", report.PreviewWindow, PreviewWindowStyleType.Normal);
            Bool(sb, i, "PreviewMargins", report.PreviewMargins, false);
            Bool(sb, i, "PreviewAbout", report.PreviewAbout, true);

            // Grid
            Bool(sb, i, "GridVisible", report.GridVisible, true);
            Bool(sb, i, "GridEnabled", report.GridEnabled, true);
            Bool(sb, i, "GridLines", report.GridLines, false);
            Col(sb, i, "GridColor", report.GridColor, 0xFF0000);
            Int(sb, i, "GridWidth", report.GridWidth, 115);
            Int(sb, i, "GridHeight", report.GridHeight, 115);

            // Print
            Int(sb, i, "Copies", report.Copies, 1);
            Bool(sb, i, "CollateCopies", report.CollateCopies, false);
            Bool(sb, i, "TwoPass", report.TwoPass, false);
            Enm(sb, i, "PrinterFonts", report.PrinterFonts, PrinterFontsType.Default);
            Bool(sb, i, "PrintOnlyIfDataAvailable", report.PrintOnlyIfDataAvailable, false);
            Enm(sb, i, "PrinterSelect", report.PrinterSelect, PrinterSelectType.DefaultPrinter);

            // PDF
            Enm(sb, i, "PDFConformance", report.PDFConformance, PDFConformanceType.PDF_1_4);
            Bool(sb, i, "PDFCompressed", report.PDFCompressed, false);

            // Document metadata
            Str(sb, i, "DocAuthor", report.DocAuthor, "");
            Str(sb, i, "DocTitle", report.DocTitle, "");
            Str(sb, i, "DocSubject", report.DocSubject, "");
            Str(sb, i, "DocProducer", report.DocProducer, "");
            Str(sb, i, "DocCreator", report.DocCreator, "");
            Str(sb, i, "DocCreationDate", report.DocCreationDate, "");
            Str(sb, i, "DocModificationDate", report.DocModificationDate, "");
            Str(sb, i, "DocKeywords", report.DocKeywords, "");
            Str(sb, i, "DocXMPContent", report.DocXMPContent, "");

            // Misc
            Enm(sb, i, "StreamFormat", report.StreamFormat, StreamFormatType.Text);
            Bool(sb, i, "ActionBefore", report.ActionBefore, false);
            Bool(sb, i, "ActionAfter", report.ActionAfter, false);
            Int(sb, i, "Language", report.Language, -1);

            // Children
            foreach (DatabaseInfo db in report.DatabaseInfo)
            {
                sb.AppendLine();
                sb.Append(i).Append("DATABASE \"").Append(Esc(db.Name)).AppendLine("\"");
                WriteDatabaseProps(sb, db, i + "  ");
            }

            foreach (DataInfo di in report.DataInfo)
            {
                sb.AppendLine();
                sb.Append(i).Append("DATASET \"").Append(Esc(di.Name)).AppendLine("\"");
                WriteDatasetProps(sb, di, i + "  ");
            }

            foreach (Param p in report.Params)
            {
                sb.AppendLine();
                sb.Append(i).Append("PARAM \"").Append(Esc(p.Name)).AppendLine("\"");
                WriteParamProps(sb, p, i + "  ");
            }

            foreach (SubReport sub in report.SubReports)
            {
                sb.AppendLine();
                sb.Append(i).Append("SUBREPORT \"").Append(Esc(sub.Name)).AppendLine("\"");
                WriteSubReportProps(sb, sub, i + "  ");
                WriteSections(sb, sub, i + "  ");
            }
        }

        #endregion

        #region DatabaseInfo

        private static void WriteDatabaseProps(StringBuilder sb, DatabaseInfo db, string i)
        {
            Str(sb, i, "Alias", db.Alias, "");
            Enm(sb, i, "Driver", db.Driver, DriverType.DotNet2);
            Str(sb, i, "ProviderFactory", db.ProviderFactory, "");
            Str(sb, i, "ConnectionString", db.ConnectionString, "");
            Enm(sb, i, "DotNetDriver", db.DotNetDriver, DotNetDriverType.OleDb);
            Str(sb, i, "ReportTable", db.ReportTable, "");
            Str(sb, i, "ReportSearchField", db.ReportSearchField, "");
            Str(sb, i, "ReportField", db.ReportField, "");
            Str(sb, i, "ReportGroupsTable", db.ReportGroupsTable, "");
            // HttpAgent
            Str(sb, i, "HttpAgentBaseUrl", db.HttpAgentBaseUrl, "");
            // Omit HttpAgentApiKey and HttpAgentToken — sensitive credentials
            Lng(sb, i, "HttpAgentHubDatabaseId", db.HttpAgentHubDatabaseId, 0);
        }

        #endregion

        #region DataInfo

        private static void WriteDatasetProps(StringBuilder sb, DataInfo di, string i)
        {
            Str(sb, i, "Alias", di.Alias, "");
            Str(sb, i, "DatabaseAlias", di.DatabaseAlias, "");
            Str(sb, i, "SQL", di.SQL, "");
            Str(sb, i, "SQLExplanation", di.SQLExplanation, "");
            Str(sb, i, "DataSource", di.DataSource, "");
            Str(sb, i, "MyBaseFilename", di.MyBaseFilename, "");
            Str(sb, i, "MyBaseFields", di.MyBaseFields, "");
            Str(sb, i, "MyBaseIndexFields", di.MyBaseIndexFields, "");
            Str(sb, i, "MyBaseMasterFields", di.MyBaseMasterFields, "");
            Str(sb, i, "BDEIndexFields", di.BDEIndexFields, "");
            Str(sb, i, "BDEIndexName", di.BDEIndexName, "");
            Str(sb, i, "BDETable", di.BDETable, "");
            Enm(sb, i, "BDEType", di.BDEType, DatasetType.Query);
            Str(sb, i, "BDEFilter", di.BDEFilter, "");
            Str(sb, i, "BDEMasterFields", di.BDEMasterFields, "");
            Str(sb, i, "BDEFirstRange", di.BDEFirstRange, "");
            Str(sb, i, "BDELastRange", di.BDELastRange, "");
            Bool(sb, i, "OpenOnStart", di.OpenOnStart, true);
            Bool(sb, i, "GroupUnion", di.GroupUnion, false);
            Bool(sb, i, "ParallelUnion", di.ParallelUnion, false);
            Lng(sb, i, "HubSchemaId", di.HubSchemaId, 0);
            WriteStrings(sb, i, "DataUnions", di.DataUnions);
        }

        #endregion

        #region Param

        private static void WriteParamProps(StringBuilder sb, Param p, string i)
        {
            Enm(sb, i, "ParamType", p.ParamType, ParamType.String);
            WriteVariantValue(sb, i, "Value", p.Value);
            Str(sb, i, "Alias", p.Alias, "");
            Str(sb, i, "Description", p.Description, "");
            Str(sb, i, "Hint", p.Hint, "");
            Str(sb, i, "Validation", p.Validation, "");
            Str(sb, i, "ErrorMessage", p.ErrorMessage, "");
            Bool(sb, i, "Visible", p.Visible, false);
            Bool(sb, i, "IsReadOnly", p.IsReadOnly, false);
            Bool(sb, i, "NeverVisible", p.NeverVisible, false);
            Bool(sb, i, "AllowNulls", p.AllowNulls, false);
            Str(sb, i, "LookupDataset", p.LookupDataset, "");
            Str(sb, i, "SearchDataset", p.SearchDataset, "");
            Str(sb, i, "Search", p.Search, "");
            Str(sb, i, "SearchParam", p.SearchParam, "");
            WriteStrings(sb, i, "Items", p.Items);
            WriteStrings(sb, i, "Values", p.Values);
            WriteStrings(sb, i, "Selected", p.Selected);
            WriteStrings(sb, i, "Datasets", p.Datasets);
        }

        #endregion

        #region SubReport

        private static void WriteSubReportProps(StringBuilder sb, SubReport sub, string i)
        {
            Str(sb, i, "Alias", sub.Alias, "");
            Bool(sb, i, "PrintOnlyIfDataAvailable", sub.PrintOnlyIfDataAvailable, true);
            Bool(sb, i, "ReOpenOnPrint", sub.ReOpenOnPrint, true);
            Str(sb, i, "ParentSub", sub.ParentSub, "");
            Str(sb, i, "ParentSec", sub.ParentSec, "");
        }

        #endregion

        #region Section

        private static void WriteSections(StringBuilder sb, SubReport sub, string i)
        {
            foreach (Section sec in sub.Sections)
            {
                sb.AppendLine();
                sb.Append(i).Append("SECTION ").Append(sec.SectionType);
                sb.Append(" \"").Append(Esc(sec.Name)).Append("\"");
                sb.Append(' ').Append(sec.Width).Append('x').Append(sec.Height);
                sb.AppendLine();
                WriteSectionProps(sb, sec, i + "  ");
                WriteComponents(sb, sec, i + "  ");
            }
        }

        private static void WriteSectionProps(StringBuilder sb, Section sec, string i)
        {
            Str(sb, i, "GroupName", sec.GroupName, "");
            Str(sb, i, "ChangeExpression", sec.ChangeExpression, "");
            Bool(sb, i, "ChangeBool", sec.ChangeBool, false);
            Bool(sb, i, "PageRepeat", sec.PageRepeat, false);
            Bool(sb, i, "SkipPage", sec.SkipPage, false);
            Str(sb, i, "BeginPageExpression", sec.BeginPageExpression, "");
            Enm(sb, i, "SkipType", sec.SkipType, SkipType.Default);
            Str(sb, i, "SkipToPageExpre", sec.SkipToPageExpre, "");
            Bool(sb, i, "SkipRelativeH", sec.SkipRelativeH, false);
            Bool(sb, i, "SkipRelativeV", sec.SkipRelativeV, false);
            Str(sb, i, "SkipExpreH", sec.SkipExpreH, "");
            Str(sb, i, "SkipExpreV", sec.SkipExpreV, "");
            Bool(sb, i, "AlignBottom", sec.AlignBottom, false);
            Bool(sb, i, "AutoExpand", sec.AutoExpand, false);
            Bool(sb, i, "AutoContract", sec.AutoContract, false);
            Bool(sb, i, "HorzDesp", sec.HorzDesp, false);
            Bool(sb, i, "VertDesp", sec.VertDesp, false);
            Bool(sb, i, "ForcePrint", sec.ForcePrint, false);
            Bool(sb, i, "BeginPage", sec.BeginPage, false);
            Bool(sb, i, "IniNumPage", sec.IniNumPage, false);
            Bool(sb, i, "Global", sec.Global, false);
            Bool(sb, i, "Visible", sec.Visible, true);
            Enm(sb, i, "BackStyle", sec.BackStyle, BackStyleType.Design);
            Enm(sb, i, "DrawStyle", sec.DrawStyle, ImageDrawStyleType.Full);
            Enm(sb, i, "SharedImage", sec.SharedImage, SharedImageType.None);
            Int(sb, i, "dpires", sec.dpires, 96);
            Enm(sb, i, "StreamFormat", sec.StreamFormat, StreamFormatType.Text);
            Bool(sb, i, "SyncWidth", sec.SyncWidth, true);
            Str(sb, i, "PrintCondition", sec.PrintCondition, "");
            Str(sb, i, "DoBeforePrint", sec.DoBeforePrint, "");
            Str(sb, i, "DoAfterPrint", sec.DoAfterPrint, "");
            Str(sb, i, "BackExpression", sec.BackExpression, "");
            Str(sb, i, "ExternalFilename", sec.ExternalFilename, "");
            Str(sb, i, "ExternalConnection", sec.ExternalConnection, "");
            Str(sb, i, "ExternalTable", sec.ExternalTable, "");
            Str(sb, i, "ExternalField", sec.ExternalField, "");
            Str(sb, i, "ExternalSearchField", sec.ExternalSearchField, "");
            Str(sb, i, "ExternalSearchValue", sec.ExternalSearchValue, "");
            Str(sb, i, "ChildSubReportName", sec.ChildSubReportName, "");
            if (sec.Stream != null && sec.Stream.Length > 0)
                sb.Append(i).Append("Stream=[embedded ").Append(sec.Stream.Length / 1024).AppendLine("KB]");
        }

        #endregion

        #region Components

        private static void WriteComponents(StringBuilder sb, Section sec, string i)
        {
            foreach (PrintPosItem comp in sec.Components)
            {
                sb.AppendLine();
                sb.Append(i).Append(TypeName(comp));
                sb.Append(" \"").Append(Esc(comp.Name)).Append("\"");
                sb.Append(" @").Append(comp.PosX).Append(',').Append(comp.PosY);
                sb.Append(' ').Append(comp.Width).Append('x').Append(comp.Height);
                sb.AppendLine();
                WriteComponentProps(sb, comp, i + "  ");
            }
        }

        private static void WriteComponentProps(StringBuilder sb, PrintPosItem comp, string i)
        {
            // PrintPosItem / PrintItem base
            Enm(sb, i, "Align", comp.Align, PrintItemAlign.None);
            Bool(sb, i, "Hidden", comp.Hidden, false);
            Bool(sb, i, "Visible", comp.Visible, true);
            Str(sb, i, "PrintCondition", comp.PrintCondition, "");
            Str(sb, i, "DoBeforePrint", comp.DoBeforePrint, "");
            Str(sb, i, "DoAfterPrint", comp.DoAfterPrint, "");
            Bool(sb, i, "PartialFlag", comp.PartialFlag, false);
            Str(sb, i, "AnnotationExpression", comp.AnnotationExpression, "");

            // Type-specific
            if (comp is ExpressionItem expr)
                WriteExpressionProps(sb, expr, i);
            else if (comp is LabelItem label)
                WriteLabelProps(sb, label, i);
            else if (comp is ChartItem chart)
                WriteChartProps(sb, chart, i);
            else if (comp is ImageItem img)
                WriteImageProps(sb, img, i);
            else if (comp is ShapeItem shape)
                WriteShapeProps(sb, shape, i);
            else if (comp is BarcodeItem barcode)
                WriteBarcodeProps(sb, barcode, i);
        }

        private static void WriteTextProps(StringBuilder sb, PrintItemText t, string i)
        {
            // Font name — always emit (batch editor maps FontName → WFontName + LFontName)
            AlwaysStr(sb, i, "FontName", t.WFontName);
            Int(sb, i, "FontSize", t.FontSize, 10);
            Int(sb, i, "FontStyle", t.FontStyle, 0);
            Int(sb, i, "FontRotation", t.FontRotation, 0);
            Col(sb, i, "FontColor", t.FontColor, 0);
            Col(sb, i, "BackColor", t.BackColor, 0xFFFFFF);
            Bool(sb, i, "Transparent", t.Transparent, true);
            Bool(sb, i, "CutText", t.CutText, false);
            Bool(sb, i, "WordWrap", t.WordWrap, false);
            Bool(sb, i, "IsHtml", t.IsHtml, false);
            Bool(sb, i, "WordBreak", t.WordBreak, false);
            Int(sb, i, "InterLine", t.InterLine, 0);
            Enm(sb, i, "Alignment", t.Alignment, TextAlignType.Left);
            Enm(sb, i, "VAlignment", t.VAlignment, TextAlignVerticalType.Top);
            Bool(sb, i, "SingleLine", t.SingleLine, false);
            Enm(sb, i, "Type1Font", t.Type1Font, PDFFontType.Helvetica);
            Bool(sb, i, "MultiPage", t.MultiPage, false);
            Enm(sb, i, "PrintStep", t.PrintStep, PrintStepType.BySize);
            Bool(sb, i, "RightToLeft", t.RightToLeft, false);
        }

        private static void WriteExpressionProps(StringBuilder sb, ExpressionItem e, string i)
        {
            WriteTextProps(sb, e, i);
            Str(sb, i, "Expression", e.Expression, "");
            Str(sb, i, "GroupName", e.GroupName, "");
            Enm(sb, i, "Aggregate", e.Aggregate, Aggregate.None);
            Enm(sb, i, "AgType", e.AgType, AggregateType.Summary);
            Str(sb, i, "Identifier", e.Identifier, "");
            Bool(sb, i, "AutoExpand", e.AutoExpand, false);
            Bool(sb, i, "AutoContract", e.AutoContract, false);
            Str(sb, i, "DisplayFormat", e.DisplayFormat, "");
            Str(sb, i, "ExportDisplayFormat", e.ExportDisplayFormat, "");
            Enm(sb, i, "DataType", e.DataType, ParamType.Unknown);
            Str(sb, i, "AgIniValue", e.AgIniValue, "0");
            Bool(sb, i, "PrintOnlyOne", e.PrintOnlyOne, false);
            Bool(sb, i, "PrintNulls", e.PrintNulls, true);
            Str(sb, i, "ExportExpression", e.ExportExpression, "");
            Int(sb, i, "ExportLine", e.ExportLine, 0);
            Int(sb, i, "ExportPosition", e.ExportPosition, 0);
            Int(sb, i, "ExportSize", e.ExportSize, 1);
            Bool(sb, i, "ExportDoNewLine", e.ExportDoNewLine, false);
        }

        private static void WriteLabelProps(StringBuilder sb, LabelItem l, string i)
        {
            WriteTextProps(sb, l, i);
            Str(sb, i, "Text", l.Text, "");
        }

        private static void WriteImageProps(StringBuilder sb, ImageItem img, string i)
        {
            Str(sb, i, "Expression", img.Expression, "");
            Enm(sb, i, "DrawStyle", img.DrawStyle, ImageDrawStyleType.Crop);
            Int(sb, i, "dpires", img.dpires, 100);
            Int(sb, i, "CopyMode", img.CopyMode, 0);
            Int(sb, i, "Rotation", img.Rotation, 0);
            Enm(sb, i, "SharedImage", img.SharedImage, SharedImageType.None);
            if (img.HasEmbeddedImageStream)
                sb.Append(i).Append("Stream=[embedded ").Append(img.EmbeddedImageByteCount / 1024).AppendLine("KB]");
        }

        private static void WriteShapeProps(StringBuilder sb, ShapeItem s, string i)
        {
            Enm(sb, i, "Shape", s.Shape, ShapeType.Rectangle);
            Enm(sb, i, "BrushStyle", s.BrushStyle, BrushType.Solid);
            Col(sb, i, "BrushColor", s.BrushColor, 0xFFFFFF);
            Enm(sb, i, "PenStyle", s.PenStyle, PenType.Solid);
            Col(sb, i, "PenColor", s.PenColor, 0);
            Int(sb, i, "PenWidth", s.PenWidth, 0);
            Col(sb, i, "Color", s.Color, 0);
            Str(sb, i, "BrushColorExpression", s.BrushColorExpression, "");
        }

        private static void WriteBarcodeProps(StringBuilder sb, BarcodeItem b, string i)
        {
            Str(sb, i, "Expression", b.Expression, "'5449000000996'");
            Enm(sb, i, "BarType", b.BarType, BarcodeType.CodeEAN13);
            Int(sb, i, "Modul", b.Modul, 10);
            Dbl(sb, i, "Ratio", b.Ratio, 2.0);
            Bool(sb, i, "Checksum", b.Checksum, false);
            Str(sb, i, "DisplayFormat", b.DisplayFormat, "");
            Int(sb, i, "Rotation", b.Rotation, 0);
            Col(sb, i, "BColor", b.BColor, 0);
            Col(sb, i, "BackColor", b.BackColor, 0xFFFFFF);
            Bool(sb, i, "Transparent", b.Transparent, false);
            Int(sb, i, "NumColumns", b.NumColumns, 0);
            Int(sb, i, "NumRows", b.NumRows, 0);
            Int(sb, i, "ECCLevel", b.ECCLevel, -1);
            Bool(sb, i, "Truncated", b.Truncated, false);
        }

        private static void WriteChartProps(StringBuilder sb, ChartItem c, string i)
        {
            WriteTextProps(sb, c, i);
            Str(sb, i, "ChangeSerieExpression", c.ChangeSerieExpression, "");
            Str(sb, i, "ClearExpression", c.ClearExpression, "");
            Str(sb, i, "GetValueCondition", c.GetValueCondition, "");
            Str(sb, i, "ValueExpression", c.ValueExpression, "");
            Str(sb, i, "ValueXExpression", c.ValueXExpression, "");
            Str(sb, i, "CaptionExpression", c.CaptionExpression, "");
            Str(sb, i, "SerieCaption", c.SerieCaption, "");
            Str(sb, i, "ColorExpression", c.ColorExpression, "");
            Str(sb, i, "SerieColorExpression", c.SerieColorExpression, "");
            Bool(sb, i, "ChangeSerieBool", c.ChangeSerieBool, false);
            Enm(sb, i, "ChartStyle", c.ChartStyle, ChartType.Line);
            Str(sb, i, "Identifier", c.Identifier, "");
            Bool(sb, i, "ClearExpressionBool", c.ClearExpressionBool, false);
            Enm(sb, i, "Driver", c.Driver, ChartDriver.Default);
            Bool(sb, i, "View3d", c.View3d, true);
            Bool(sb, i, "View3dWalls", c.View3dWalls, false);
            Int(sb, i, "Perspective", c.Perspective, 15);
            Int(sb, i, "Elevation", c.Elevation, 345);
            Int(sb, i, "Rotation", c.Rotation, 345);
            Int(sb, i, "Zoom", c.Zoom, 100);
            Int(sb, i, "HorzOffset", c.HorzOffset, 0);
            Int(sb, i, "VertOffset", c.VertOffset, 0);
            Int(sb, i, "Tilt", c.Tilt, 0);
            Bool(sb, i, "Orthogonal", c.Orthogonal, true);
            Enm(sb, i, "MultiBar", c.MultiBar, BarType.Side);
            Int(sb, i, "Resolution", c.Resolution, 100);
            Bool(sb, i, "ShowLegend", c.ShowLegend, false);
            Bool(sb, i, "ShowHint", c.ShowHint, true);
            Int(sb, i, "MarkStyle", c.MarkStyle, 0);
            Int(sb, i, "HorzFontSize", c.HorzFontSize, 0);
            Int(sb, i, "VertFontSize", c.VertFontSize, 0);
            Int(sb, i, "HorzFontRotation", c.HorzFontRotation, 0);
            Int(sb, i, "VertFontRotation", c.VertFontRotation, 0);
            Enm(sb, i, "AutoRange", c.AutoRange, Series.AutoRangeAxis.Default);
            Dbl(sb, i, "AxisYInitial", c.AxisYInitial, 0);
            Dbl(sb, i, "AxisYFinal", c.AxisYFinal, 0);
        }

        #endregion

        #region Helpers

        private static string TypeName(PrintPosItem comp)
        {
            if (comp is ExpressionItem) return "EXPRESSION";
            if (comp is LabelItem) return "LABEL";
            if (comp is ChartItem) return "CHART";
            if (comp is ImageItem) return "IMAGE";
            if (comp is ShapeItem) return "SHAPE";
            if (comp is BarcodeItem) return "BARCODE";
            return comp.ClassName;
        }

        private static string Esc(string s)
        {
            if (string.IsNullOrEmpty(s)) return "";
            return s
                .Replace("\\", "\\\\")
                .Replace("\"", "\\\"")
                .Replace("\r\n", "\\n")
                .Replace("\n", "\\n")
                .Replace("\r", "\\n")
                .Replace("\t", "\\t");
        }

        private static void AlwaysStr(StringBuilder sb, string i, string name, string val)
        {
            sb.Append(i).Append(name).Append("=\"").Append(Esc(val ?? "")).AppendLine("\"");
        }

        private static void Str(StringBuilder sb, string i, string name, string val, string def)
        {
            if (string.IsNullOrEmpty(val) && string.IsNullOrEmpty(def)) return;
            if (val == def) return;
            sb.Append(i).Append(name).Append("=\"").Append(Esc(val ?? "")).AppendLine("\"");
        }

        private static void Int(StringBuilder sb, string i, string name, int val, int def)
        {
            if (val == def) return;
            sb.Append(i).Append(name).Append('=').Append(val).AppendLine();
        }

        private static void Lng(StringBuilder sb, string i, string name, long val, long def)
        {
            if (val == def) return;
            sb.Append(i).Append(name).Append('=').Append(val).AppendLine();
        }

        private static void Dbl(StringBuilder sb, string i, string name, double val, double def)
        {
            if (val == def) return;
            sb.Append(i).Append(name).Append('=')
              .Append(val.ToString(System.Globalization.CultureInfo.InvariantCulture))
              .AppendLine();
        }

        private static void Bool(StringBuilder sb, string i, string name, bool val, bool def)
        {
            if (val == def) return;
            sb.Append(i).Append(name).Append('=').Append(val ? "true" : "false").AppendLine();
        }

        private static void Col(StringBuilder sb, string i, string name, int val, int def)
        {
            if (val == def) return;
            sb.Append(i).Append(name).Append("=0x").Append(val.ToString("X6")).AppendLine();
        }

        private static void Enm<T>(StringBuilder sb, string i, string name, T val, T def) where T : struct
        {
            if (val.Equals(def)) return;
            sb.Append(i).Append(name).Append('=').Append(val).AppendLine();
        }

        private static void WriteStrings(StringBuilder sb, string i, string name, Strings strs)
        {
            if (strs == null || strs.Count == 0) return;
            var joined = new StringBuilder();
            for (int idx = 0; idx < strs.Count; idx++)
            {
                if (idx > 0) joined.Append('|');
                joined.Append(Esc(strs[idx]));
            }
            sb.Append(i).Append(name).Append("=\"").Append(joined).AppendLine("\"");
        }

        private static void WriteVariantValue(StringBuilder sb, string i, string name, Variant v)
        {
            if (v.IsNull) return;
            string tag;
            string val;
            switch (v.VarType)
            {
                case VariantType.Boolean:
                    tag = "bool";
                    val = ((bool)v) ? "true" : "false";
                    break;
                case VariantType.Integer:
                    tag = "int";
                    val = ((int)v).ToString(System.Globalization.CultureInfo.InvariantCulture);
                    break;
                case VariantType.Long:
                    tag = "long";
                    val = ((long)v).ToString(System.Globalization.CultureInfo.InvariantCulture);
                    break;
                case VariantType.Double:
                    tag = "double";
                    val = ((double)v).ToString(System.Globalization.CultureInfo.InvariantCulture);
                    break;
                case VariantType.Decimal:
                    tag = "decimal";
                    val = ((decimal)v).ToString(System.Globalization.CultureInfo.InvariantCulture);
                    break;
                case VariantType.DateTime:
                    tag = "datetime";
                    val = ((DateTime)v).ToString("o", System.Globalization.CultureInfo.InvariantCulture);
                    break;
                case VariantType.String:
                    tag = "string";
                    val = Esc((string)v);
                    break;
                default:
                    tag = "string";
                    val = Esc(v.ToString());
                    break;
            }
            sb.Append(i).Append(name).Append('=').Append(tag).Append(':');
            if (tag == "string")
                sb.Append('"').Append(val).Append('"');
            else
                sb.Append(val);
            sb.AppendLine();
        }

        #endregion
    }
}
