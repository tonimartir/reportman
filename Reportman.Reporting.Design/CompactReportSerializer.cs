using System;
using System.IO;
using System.Text;
using Reportman.Drawing;
using Reportman.Reporting;

namespace Reportman.Reporting.Design
{
    /// <summary>
    /// Serializes a Report into a compact text DSL for LLM instance context.
    /// Only properties present in the schemaContext (ReportContextBuilder allowed properties)
    /// are emitted, so the AI designer does not see properties it cannot edit.
    /// Only non-default property values are emitted to reduce token usage.
    /// Font names are always included (Report Manager has no parent-font inheritance).
    /// </summary>
    /// <remarks>
    /// EXCLUDED PROPERTIES — present in the model but intentionally not exposed to the designer.
    /// To expose a property, move it from this list to the corresponding Write* method AND
    /// add it to the matching AllowedProperties array in ReportContextBuilder.
    ///
    /// Report: FontName, FontSize, FontStyle, FontRotation, FontColor, BackColor, Transparent,
    ///   CutText, Alignment, VAlignment, WordWrap, SingleLine, MultiPage, PrintStep, Type1Font,
    ///   PageOrientation, PageSize, PageHeight, PageWidth, CustomPageHeight, CustomPageWidth,
    ///   PageBackColor, LeftMargin, RightMargin, TopMargin, BottomMargin, LinesPerInch,
    ///   PaperSource, Duplex, ForcePaperName, PageSizeIndex, AutoScale, PreviewWindow,
    ///   PreviewMargins, PreviewAbout, GridVisible, GridEnabled, GridLines, GridColor,
    ///   GridWidth, GridHeight, Copies, CollateCopies, TwoPass, PrinterFonts,
    ///   PrintOnlyIfDataAvailable, PrinterSelect, PDFConformance, PDFCompressed,
    ///   DocProducer, DocCreator, DocCreationDate, DocModificationDate, DocXMPContent,
    ///   StreamFormat, ActionBefore, ActionAfter, Language
    ///
    /// DatabaseInfo: entire object type (not editable by the designer)
    ///
    /// DataInfo (extras): SQL, MyBaseFilename, MyBaseFields,
    ///   MyBaseIndexFields, MyBaseMasterFields, BDEIndexFields, BDEIndexName, BDETable,
    ///   BDEType, BDEFilter, BDEMasterFields, BDEFirstRange, BDELastRange, OpenOnStart,
    ///   GroupUnion, ParallelUnion, HubSchemaId, DataUnions
    ///
    /// Param (extras): ErrorMessage, IsReadOnly, NeverVisible,
    ///   AllowNulls, LookupDataset, SearchDataset, Search, SearchParam, Items, Values,
    ///   Selected
    ///
    /// SubReport (extras): ReOpenOnPrint, ParentSub, ParentSec
    ///
    /// Section (extras): ChangeBool, SkipPage, SkipType, SkipToPageExpre, SkipRelativeH,
    ///   SkipRelativeV, SkipExpreH, SkipExpreV, HorzDesp, VertDesp, BeginPage, IniNumPage,
    ///   Global, Visible, BackStyle, DrawStyle, SharedImage, dpires, StreamFormat, SyncWidth,
    ///   DoBeforePrint, DoAfterPrint, BackExpression, ExternalFilename, ExternalConnection,
    ///   ExternalTable, ExternalField, ExternalSearchField, ExternalSearchValue,
    ///   ChildSubReportName, Stream
    ///
    /// Component base (extras): Hidden, Visible, PartialFlag, AnnotationExpression
    ///
    /// TextItem (extras): FontRotation, WordBreak, InterLine, PrintStep, Type1Font
    ///
    /// Expression (extras): DataType, ExportDisplayFormat, ExportExpression, ExportLine,
    ///   ExportPosition, ExportSize, ExportDoNewLine
    ///
    /// Image (extras): Stream (embedded indicator)
    ///
    /// Barcode (extras): Truncated
    ///
    /// Chart (extras): Driver, View3d, View3dWalls, Perspective, Elevation, Rotation, Zoom,
    ///   HorzOffset, VertOffset, Tilt, Orthogonal, MultiBar, Resolution, ShowHint, MarkStyle,
    ///   HorzFontSize, VertFontSize, HorzFontRotation, VertFontRotation, AutoRange,
    ///   AxisYInitial, AxisYFinal, Identifier, ColorExpression, SerieColorExpression,
    ///   ChangeSerieBool, ClearExpressionBool
    /// </remarks>
    public static class CompactReportSerializer
    {
        public static string Serialize(Report report)
        {
            var sb = new StringBuilder(4096);
            WriteReport(sb, report);
            return sb.ToString();
        }

        #region Report

        private static void WriteReport(StringBuilder sb, Report report)
        {
            sb.AppendLine("[REPORT]");
            const string i = "  ";

            // Schema-allowed Report properties: DocTitle, DocAuthor, DocSubject, DocKeywords
            Str(sb, i, "DocTitle", report.DocTitle, "");
            Str(sb, i, "DocAuthor", report.DocAuthor, "");
            Str(sb, i, "DocSubject", report.DocSubject, "");
            Str(sb, i, "DocKeywords", report.DocKeywords, "");

            // DatabaseInfo is not exposed to the designer (entire type excluded)

            foreach (DataInfo di in report.DataInfo)
            {
                sb.AppendLine();
                sb.Append(i).Append("[DATASET \"").Append(Esc(di.Name)).AppendLine("\"]");
                WriteDatasetProps(sb, di, i + "  ");
                sb.Append(i).AppendLine("[/DATASET]");
            }

            foreach (Param p in report.Params)
            {
                sb.AppendLine();
                sb.Append(i).Append("[PARAM \"").Append(Esc(p.Name)).AppendLine("\"]");
                WriteParamProps(sb, p, i + "  ");
                sb.Append(i).AppendLine("[/PARAM]");
            }

            for (var subReportIndex = 0; subReportIndex < report.SubReports.Count; subReportIndex++)
            {
                var sub = report.SubReports[subReportIndex];
                sb.AppendLine();
                sb.Append(i).Append("[SUBREPORT \"").Append(Esc(sub.Name)).AppendLine("\"]");
                WriteSubReportProps(sb, sub, subReportIndex, i + "  ");
                WriteSections(sb, sub, i + "  ");
                sb.Append(i).AppendLine("[/SUBREPORT]");
            }

            sb.AppendLine("[/REPORT]");
        }

        #endregion

        #region DataInfo

        private static void WriteDatasetProps(StringBuilder sb, DataInfo di, string i)
        {
            // Schema-allowed: Alias, DatabaseAlias, DataSource
            // Context-only extras kept in DSL to reduce duplicated JSON prompt payload.
            Str(sb, i, "Alias", di.Alias, "");
            Str(sb, i, "DatabaseAlias", di.DatabaseAlias, "");
            Str(sb, i, "DataSource", di.DataSource, "");
            Str(sb, i, "SqlExplanation", di.SQLExplanation, "");
            Str(sb, i, "SqlExplanationError", di.SQLExplanationError, "");
        }

        #endregion

        #region Param

        private static void WriteParamProps(StringBuilder sb, Param p, string i)
        {
            // Schema-allowed: Alias, ParamType, Description, Hint, Datasets, Value, Validation, UserVisible
            Str(sb, i, "Alias", p.Alias, "");
            Enm(sb, i, "ParamType", p.ParamType, ParamType.String);
            Str(sb, i, "Description", p.Description, "");
            Str(sb, i, "Hint", p.Hint, "");
            DatasetList(sb, i, "Datasets", p.Datasets);
            ParamValueTuple(sb, i, "Value", p);
            Str(sb, i, "Validation", p.Validation, "");
            Bool(sb, i, "UserVisible", p.UserVisible, false);
        }

        #endregion

        #region SubReport

        private static void WriteSubReportProps(StringBuilder sb, SubReport sub, int subReportIndex, string i)
        {
            // Schema-allowed: Alias, PrintOnlyIfDataAvailable
            Int(sb, i, "Index", subReportIndex, -1);
            Str(sb, i, "Alias", sub.Alias, "");
            Str(sb, i, "ParentSubReportName", sub.ParentSubReport?.Name, "");
            Str(sb, i, "ParentSectionName", sub.ParentSection?.Name, "");
            Bool(sb, i, "PrintOnlyIfDataAvailable", sub.PrintOnlyIfDataAvailable, true);
        }

        #endregion

        #region Section

        private static void WriteSections(StringBuilder sb, SubReport sub, string i)
        {
            for (var sectionIndex = 0; sectionIndex < sub.Sections.Count; sectionIndex++)
            {
                var sec = sub.Sections[sectionIndex];
                sb.AppendLine();
                sb.Append(i).Append("[SECTION ").Append(sec.SectionType);
                sb.Append(" \"").Append(Esc(sec.Name)).Append("\"");
                sb.Append(' ').Append(Px(sec.Width)).Append('x').Append(Px(sec.Height));
                sb.AppendLine("]");
                WriteSectionProps(sb, sec, sectionIndex, i + "  ");
                WriteComponents(sb, sec, i + "  ");
                sb.Append(i).AppendLine("[/SECTION]");
            }
        }

        private static void WriteSectionProps(StringBuilder sb, Section sec, int sectionIndex, string i)
        {
            // Schema-allowed: GroupName, ChangeExpression, BeginPageExpression,
            //   PageRepeat, ForcePrint, AlignBottom, AutoExpand, AutoContract, PrintCondition
            // (SectionType, Width, Height are on the inline header)
            Int(sb, i, "Index", sectionIndex, -1);
            Str(sb, i, "GroupName", sec.GroupName, "");
            Str(sb, i, "ChangeExpression", sec.ChangeExpression, "");
            Str(sb, i, "BeginPageExpression", sec.BeginPageExpression, "");
            Str(sb, i, "ChildSubReportName", sec.ChildSubReport?.Name, "");
            Bool(sb, i, "PageRepeat", sec.PageRepeat, false);
            Bool(sb, i, "ForcePrint", sec.ForcePrint, false);
            Bool(sb, i, "AlignBottom", sec.AlignBottom, false);
            Bool(sb, i, "AutoExpand", sec.AutoExpand, false);
            Bool(sb, i, "AutoContract", sec.AutoContract, false);
            Str(sb, i, "PrintCondition", sec.PrintCondition, "");
        }

        #endregion

        #region Components

        private static void WriteComponents(StringBuilder sb, Section sec, string i)
        {
            foreach (PrintPosItem comp in sec.Components)
            {
                var typeName = TypeName(comp);
                sb.AppendLine();
                sb.Append(i).Append('[').Append(typeName);
                sb.Append(" \"").Append(Esc(comp.Name)).Append("\"");
                sb.Append(" @").Append(Px(comp.PosX)).Append(',').Append(Px(comp.PosY));
                sb.Append(' ').Append(Px(comp.Width)).Append('x').Append(Px(comp.Height));
                sb.AppendLine("]");
                WriteComponentProps(sb, comp, i + "  ");
                sb.Append(i).Append("[/").Append(typeName).AppendLine("]");
            }
        }

        private static void WriteComponentProps(StringBuilder sb, PrintPosItem comp, string i)
        {
            // Schema-allowed CommonItem: PosX, PosY, Width, Height are on the inline header
            // Remaining common: Align, PrintCondition, DoBeforePrint, DoAfterPrint
            Enm(sb, i, "Align", comp.Align, PrintItemAlign.None);
            Str(sb, i, "PrintCondition", comp.PrintCondition, "");
            Str(sb, i, "DoBeforePrint", comp.DoBeforePrint, "");
            Str(sb, i, "DoAfterPrint", comp.DoAfterPrint, "");

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
            // Schema-allowed TextItem: Alignment, VAlignment, FontName, FontSize,
            //   FontStyle, FontColor, BackColor, Transparent, CutText, WordWrap,
            //   SingleLine, MultiPage, IsHtml, RightToLeft
            AlwaysStr(sb, i, "FontName", t.WFontName);
            Int(sb, i, "FontSize", t.FontSize, 10);
            Int(sb, i, "FontStyle", t.FontStyle, 0);
            Col(sb, i, "FontColor", t.FontColor, 0);
            Col(sb, i, "BackColor", t.BackColor, 0xFFFFFF);
            Bool(sb, i, "Transparent", t.Transparent, true);
            Bool(sb, i, "CutText", t.CutText, false);
            Bool(sb, i, "WordWrap", t.WordWrap, false);
            Enm(sb, i, "Alignment", t.Alignment, TextAlignType.Left);
            Enm(sb, i, "VAlignment", t.VAlignment, TextAlignVerticalType.Top);
            Bool(sb, i, "SingleLine", t.SingleLine, false);
            Bool(sb, i, "MultiPage", t.MultiPage, false);
            Bool(sb, i, "IsHtml", t.IsHtml, false);
            Bool(sb, i, "RightToLeft", t.RightToLeft, false);
        }

        private static void WriteExpressionProps(StringBuilder sb, ExpressionItem e, string i)
        {
            WriteTextProps(sb, e, i);
            // Schema-allowed Expression extras: Expression, GroupName, Aggregate, AgType,
            //   Identifier, DisplayFormat, AgIniValue, PrintNulls, AutoExpand, AutoContract, PrintOnlyOne
            Str(sb, i, "Expression", e.Expression, "");
            Str(sb, i, "GroupName", e.GroupName, "");
            Enm(sb, i, "Aggregate", e.Aggregate, Aggregate.None);
            Enm(sb, i, "AgType", e.AgType, AggregateType.Summary);
            Str(sb, i, "Identifier", e.Identifier, "");
            Str(sb, i, "DisplayFormat", e.DisplayFormat, "");
            Str(sb, i, "AgIniValue", e.AgIniValue, "0");
            Bool(sb, i, "PrintNulls", e.PrintNulls, true);
            Bool(sb, i, "AutoExpand", e.AutoExpand, false);
            Bool(sb, i, "AutoContract", e.AutoContract, false);
            Bool(sb, i, "PrintOnlyOne", e.PrintOnlyOne, false);
        }

        private static void WriteLabelProps(StringBuilder sb, LabelItem l, string i)
        {
            WriteTextProps(sb, l, i);
            Str(sb, i, "Text", l.Text, "");
        }

        private static void WriteImageProps(StringBuilder sb, ImageItem img, string i)
        {
            // Schema-allowed Image: DrawStyle, HasEmbeddedImageStream, EmbeddedImageByteCount,
            //   dpires, CopyMode, Rotation, Expression, SharedImage
            Str(sb, i, "Expression", img.Expression, "");
            Enm(sb, i, "DrawStyle", img.DrawStyle, ImageDrawStyleType.Crop);
            Int(sb, i, "dpires", img.dpires, 100);
            Int(sb, i, "CopyMode", img.CopyMode, 0);
            Int(sb, i, "Rotation", img.Rotation, 0);
            Enm(sb, i, "SharedImage", img.SharedImage, SharedImageType.None);
            Bool(sb, i, "HasEmbeddedImageStream", img.HasEmbeddedImageStream, false);
            if (img.HasEmbeddedImageStream && img.EmbeddedImageByteCount > 0)
                sb.Append(i).Append("EmbeddedImageByteCount=").Append(img.EmbeddedImageByteCount).AppendLine();
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
            // Schema-allowed Barcode: Expression, BarType, DisplayFormat, BColor, BackColor,
            //   Transparent, Modul, Ratio, Checksum, Rotation, NumColumns, NumRows, ECCLevel
            Str(sb, i, "Expression", b.Expression, "'5449000000996'");
            Enm(sb, i, "BarType", b.BarType, BarcodeType.CodeEAN13);
            Str(sb, i, "DisplayFormat", b.DisplayFormat, "");
            Col(sb, i, "BColor", b.BColor, 0);
            Col(sb, i, "BackColor", b.BackColor, 0xFFFFFF);
            Bool(sb, i, "Transparent", b.Transparent, false);
            Int(sb, i, "Modul", b.Modul, 10);
            Dbl(sb, i, "Ratio", b.Ratio, 2.0);
            Bool(sb, i, "Checksum", b.Checksum, false);
            Int(sb, i, "Rotation", b.Rotation, 0);
            Int(sb, i, "NumColumns", b.NumColumns, 0);
            Int(sb, i, "NumRows", b.NumRows, 0);
            Int(sb, i, "ECCLevel", b.ECCLevel, -1);
        }

        private static void WriteChartProps(StringBuilder sb, ChartItem c, string i)
        {
            // Chart does NOT inherit TextItem in schema — only CommonItem
            // Schema-allowed Chart: ChangeSerieExpression, ClearExpression, GetValueCondition,
            //   ValueExpression, ValueXExpression, CaptionExpression, SerieCaption, ChartStyle, ShowLegend
            Str(sb, i, "ChangeSerieExpression", c.ChangeSerieExpression, "");
            Str(sb, i, "ClearExpression", c.ClearExpression, "");
            Str(sb, i, "GetValueCondition", c.GetValueCondition, "");
            Str(sb, i, "ValueExpression", c.ValueExpression, "");
            Str(sb, i, "ValueXExpression", c.ValueXExpression, "");
            Str(sb, i, "CaptionExpression", c.CaptionExpression, "");
            Str(sb, i, "SerieCaption", c.SerieCaption, "");
            Enm(sb, i, "ChartStyle", c.ChartStyle, ChartType.Line);
            Bool(sb, i, "ShowLegend", c.ShowLegend, false);
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

        /// <summary>
        /// Converts a twips value to pixels at 96 DPI (1 px = 15 twips),
        /// matching the conversion used by ReportContextBuilder for currentValues.
        /// </summary>
        private static string Px(int twips)
        {
            var pixels = Math.Round((decimal)twips / 15m, 3, MidpointRounding.AwayFromZero);
            return pixels.ToString(System.Globalization.CultureInfo.InvariantCulture);
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

        private static void DatasetList(StringBuilder sb, string i, string name, Strings values)
        {
            if (values == null || values.Count == 0) return;
            sb.Append(i).Append(name).Append("=\"");
            for (int k = 0; k < values.Count; k++)
            {
                if (k > 0) sb.Append(',');
                sb.Append(Esc(values[k] ?? ""));
            }
            sb.AppendLine("\"");
        }

        private static void ParamValueTuple(StringBuilder sb, string i, string name, Param p)
        {
            object raw = p.Value.AsObject();
            string rendered = RenderVariantLiteral(raw, p.ParamType);
            if (string.IsNullOrEmpty(rendered) && p.ParamType == ParamType.String) return;
            sb.Append(i).Append(name).Append("={ DataType=").Append(p.ParamType)
              .Append(", Value=").Append(rendered).AppendLine(" }");
        }

        private static string RenderVariantLiteral(object raw, ParamType paramType = ParamType.Unknown)
        {
            if (raw == null) return "null";
            if (raw is string s) return "\"" + Esc(s) + "\"";
            if (raw is bool b) return b ? "true" : "false";
            if (raw is DateTime dt)
            {
                string fmt;
                if (paramType == ParamType.Date) fmt = "yyyy-MM-dd";
                else if (paramType == ParamType.Time) fmt = "HH:mm:ss";
                else fmt = "yyyy-MM-ddTHH:mm:ss";
                return "\"" + dt.ToString(fmt, System.Globalization.CultureInfo.InvariantCulture) + "\"";
            }
            if (raw is float f) return f.ToString(System.Globalization.CultureInfo.InvariantCulture);
            if (raw is double d) return d.ToString(System.Globalization.CultureInfo.InvariantCulture);
            if (raw is decimal m) return m.ToString(System.Globalization.CultureInfo.InvariantCulture);
            if (raw is byte || raw is sbyte || raw is short || raw is ushort
                || raw is int || raw is uint || raw is long || raw is ulong)
            {
                return System.Convert.ToString(raw, System.Globalization.CultureInfo.InvariantCulture);
            }
            return "\"" + Esc(System.Convert.ToString(raw, System.Globalization.CultureInfo.InvariantCulture) ?? "") + "\"";
        }

        #endregion
    }
}
