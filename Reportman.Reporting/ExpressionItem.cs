using Reportman.Drawing;
using System;
using System.Collections.Generic;
using System.Drawing;
using System.Globalization;
using System.Text;

namespace Reportman.Reporting
{
    public class ExpressionItem : PrintItemText
    {
        private Doubles FValues;
        private EvalIdenExpression FIdenExpression;
        private Variant FExportValue;
        private bool FIsPartial;
        private bool FForcedPartial;
        private string FHtmlPartialText;
        private string FOldString;
        private bool FUpdated;
        private int FDataCount;
        private Variant FSumValue;
        private string FExpression;
        public string Expression
        {
            get { return FExpression; }
            set { FExpression = value; UpdateIsPageCount(); }
        }
        public string GroupName { get; set; }
        public Aggregate Aggregate { get; set; }
        public AggregateType AgType { get; set; }
        public string Identifier { get; set; }
        public bool AutoExpand { get; set; }
        public bool AutoContract { get; set; }
        public string DisplayFormat { get; set; }
        public string ExportDisplayFormat { get; set; }
        public ParamType DataType { get; set; }
        public Variant Value;
        public Variant ExportValue { get; set; }
        public Variant SumValue;
        public int DataCount;
        public bool Updated;
        public string AgIniValue { get; set; }
        public bool PrintOnlyOne { get; set; }
        public bool PrintNulls { get; set; }
        [System.Text.Json.Serialization.JsonIgnore]
        [Newtonsoft.Json.JsonIgnore]
        public bool IsPartial
        {
            get { return FIsPartial; }
        }
        public int PartialPos;
        public string ExportExpression { get; set; }
        public int ExportLine { get; set; }
        public int ExportPosition { get; set; }
        public int ExportSize { get; set; }
        public bool ExportDoNewLine { get; set; }
        public bool IsPageCount;
        public bool IsGroupPageCount;
        public int LastMetaIndex;
        protected override string GetClassName()
        {
            return "TRPEXPRESSION";
        }
        override protected void DoPrint(PrintOut adriver, int aposx, int aposy,
                    int newwidth, int newheight, MetaFile metafile, Point MaxExtent,
                    ref bool PartialPrint)
        {
            int newposition;
            string avalue;
            base.DoPrint(adriver, aposx, aposy, newwidth, newheight,
                metafile, MaxExtent, ref PartialPrint);
            LastMetaIndex = -1;

            TextObjectStruct TextObj = GetTextObject();
            if (PrintOnlyOne)
            {
                if (FOldString == TextObj.Text)
                    return;
            }
            FOldString = TextObj.Text;
            if (MultiPage || FForcedPartial)
            {

                MaxExtent.X = PrintWidth;
                if (IsHtml)
                {
                    if (!TrySplitHtmlForMultipage(adriver, TextObj, MaxExtent, out string currentHtml, out string remainingHtml))
                    {
                        currentHtml = TextObj.Text;
                        remainingHtml = string.Empty;
                    }

                    TextObj.Text = currentHtml;
                    if (!string.IsNullOrEmpty(remainingHtml))
                    {
                        FIsPartial = true;
                        PartialPrint = true;
                        FHtmlPartialText = remainingHtml;
                    }
                    else
                    {
                        FIsPartial = false;
                        FForcedPartial = false;
                        FHtmlPartialText = null;
                    }
                }
                else
                {
                    FHtmlPartialText = null;
                    newposition = MetaFile.CalcTextExtent(Report.Driver, MaxExtent, TextObj);
                    if (newposition < TextObj.Text.Length)
                    {
                        if (!FIsPartial)
                            PartialPos = 0;
                        FIsPartial = true;
                        PartialPrint = true;
                        PartialPos = PartialPos + newposition;
                        TextObj.Text = TextObj.Text.Substring(0, newposition);
                    }
                    else
                    {
                        FIsPartial = false;
                        FForcedPartial = false;
                    }
                }
            }
            MetaPage apage = metafile.Pages[metafile.CurrentPage];
            MetaObjectText aobj = new MetaObjectText();
            FillAnnotation(aobj, apage);
            aobj.MetaType = MetaObjectType.Text;
            aobj.Left = aposx;
            aobj.Top = aposy;
            aobj.Width = PrintWidth;
            aobj.Height = PrintHeight;
            aobj.Alignment = TextObj.Alignment;
            aobj.PrintStep = PrintStep;
            aobj.BackColor = BackColor;
            aobj.Transparent = Transparent;
            aobj.CutText = CutText;
            aobj.FontColor = FontColor;
            aobj.FontRotation = FontRotation;
            aobj.Type1Font = Type1Font;
            aobj.FontSize = FontSize;
            aobj.FontStyle = (short)FontStyle;
            aobj.TextP = apage.AddString(TextObj.Text);
            aobj.TextS = TextObj.Text.Length;
            aobj.WordWrap = WordWrap;
            aobj.LFontNameP = apage.AddString(LFontName);
            aobj.LFontNameS = LFontName.Length;
            aobj.WFontNameP = apage.AddString(WFontName);
            aobj.WFontNameS = WFontName.Length;
            aobj.RightToLeft = TextObj.RightToLeft;
            aobj.IsHtml = TextObj.IsHtml;
            apage.Objects.Add(aobj);

            LastMetaIndex = metafile.Pages[metafile.CurrentPage].Objects.Count - 1;
            // Is Total pages variable?
            if (IsPageCount)
            {
                Report.AddTotalPagesItem(metafile.CurrentPage, metafile.Pages[metafile.CurrentPage].Objects.Count - 1, DisplayFormat);
            }
            if (ExportValue.VarType != VariantType.Null)
            {
                try
                {
                    avalue = FExportValue.ToString(ExportDisplayFormat, ParamType.Unknown, true);

                    MetaObjectExport nobj = new MetaObjectExport();
                    nobj.MetaType = MetaObjectType.Export;
                    nobj.Left = aposx;
                    nobj.Top = aposy;
                    nobj.Width = PrintWidth;
                    nobj.Height = PrintHeight;
                    nobj.TextExpP = apage.AddString(avalue);
                    nobj.TextExpS = avalue.Length;
                    nobj.Line = ExportLine;
                    nobj.Position = ExportPosition;
                    nobj.DoNewLine = ExportDoNewLine;
                    nobj.Size = ExportSize;
                    apage.Objects.Add(nobj);
                }
                catch (Exception E)
                {
                    throw new ReportException(E.Message + (char)10 + Name + " Prop:ExportDisplayFormat",
                        this, "ExportDisplayFormat");
                }
            }
        }
        [System.Text.Json.Serialization.JsonIgnore]
        [Newtonsoft.Json.JsonIgnore]
        public EvalIdenExpression IdenExpression
        {
            get { return FIdenExpression; }
        }
        public void UpdateIsPageCount()
        {
            IsPageCount = false;
            IsGroupPageCount = false;
            string astring = Expression.Trim().ToUpper();
            if (astring == "PAGECOUNT")
                IsPageCount = true;
            else
                if (astring == "GROUPPAGECOUNT")
                IsGroupPageCount = true;
        }
        public override void SetReport(BaseReport rp)
        {
            base.SetReport(rp);
            FIdenExpression = new EvalIdenExpression(rp.Evaluator);
            FIdenExpression.ExpreItem = this;
        }
        public ExpressionItem()
            : base()
        {
            FExportValue = new Variant();
            FValues = new Doubles();
            FOldString = "";
            PrintNulls = true;
            Height = 275;
            AgIniValue = "0";
            Width = 1440;
            DataType = ParamType.Unknown;
            ExportSize = 20;
            ExportSize = 1;
            FOldString = "";
            FExpression = "";
            DisplayFormat = "";
            GroupName = "";
            ExportDisplayFormat = "";
            Identifier = "";
            ExportExpression = "";
        }
        public void Evaluate()
        {
            if (FUpdated)
                return;
            Evaluator fevaluator;
            try
            {
                fevaluator = Report.Evaluator;
                Value = fevaluator.EvaluateText(Expression);
                FUpdated = true;
            }
            catch (Exception E)
            {
                throw new ReportException(E.Message + (char)10 + Name  + " Prop:Expression", this, "Expression");
            }
            FExportValue = new Variant();
            if (ExportExpression.Length > 0)
            {
                try
                {
                    fevaluator = Report.Evaluator;
                    Value = fevaluator.EvaluateText(ExportExpression);
                }
                catch (Exception E)
                {
                    throw new ReportException(E.Message + (char)10 + Name + " Prop:ExportExpression", this, "ExportExpression");
                }

            }
        }
        private string GetText()
        {
            string expre;
            string aresult;
            expre = Expression.Trim();
            if (expre.Length == 0)
                return "";

            // Is Total pages variable?
            if (IsPageCount || IsGroupPageCount)
            {
                // 20 spaces
                return "                    ";
            }
            try
            {
                Evaluate();
                aresult = Value.ToString(DisplayFormat, DataType, PrintNulls);
                if (IsHtml)
                    aresult = EvaluateHtmlExpressions(aresult);
            }
            catch (Exception E)
            {
                throw new ReportException(E.Message + (char)10 + Name + " Prop:Expression",
                    this, "Expression");
            }
            if (IsHtml && FIsPartial && FHtmlPartialText != null)
                return FHtmlPartialText;

            if (IsPartial)
            {
                // Skip one boundary space/newline. Guard the index: PartialPos is a
                // full-string offset and could reach or exceed aresult.Length if the
                // evaluated text is shorter on a later pass (two-pass / total-pages
                // substitution), which would throw IndexOutOfRangeException.
                if (PartialPos < aresult.Length &&
                    ((aresult[PartialPos] == ' ') || (aresult[PartialPos] == (char)10)))
                    PartialPos++;
                if (PartialPos > aresult.Length)
                    PartialPos = aresult.Length;
                aresult = aresult.Substring(PartialPos, aresult.Length - PartialPos);
            }
            return aresult;
        }

        private bool TrySplitHtmlForMultipage(PrintOut adriver, TextObjectStruct textObj, Point maxExtent,
            out string currentHtml, out string remainingHtml)
        {
            currentHtml = textObj.Text;
            remainingHtml = string.Empty;

            if (string.IsNullOrEmpty(textObj.Text) || maxExtent.Y <= 0)
                return true;

            Point measureExtent = maxExtent;
            measureExtent.X = PrintWidth;
            List<LineInfo> lines = adriver.TextExtentLineInfo(textObj, ref measureExtent);
            if ((lines == null) || (lines.Count == 0))
                return false;

            int visibleLength = 0;
            int consumedHeight = 0;
            foreach (LineInfo line in lines)
            {
                int lineHeight = line.Height > 0 ? line.Height : Convert.ToInt32(Math.Round(line.LineHeight));
                if (lineHeight <= 0)
                    continue;

                if ((consumedHeight + lineHeight) > maxExtent.Y)
                    break;

                consumedHeight += lineHeight;
                int lineEnd = line.Position + line.Size;
                if (lineEnd > visibleLength)
                    visibleLength = lineEnd;
            }

            if (visibleLength <= 0)
                return false;

            List<HtmlFormatRun> runs = HtmlTextParser.Parse(textObj.Text, WFontName);
            int totalPlainLength = GetTotalPlainTextLength(runs);
            if (totalPlainLength <= 0)
                return true;

            if (visibleLength >= totalPlainLength)
                return true;

            SplitHtmlRuns(runs, visibleLength, out List<HtmlFormatRun> currentRuns, out List<HtmlFormatRun> remainingRuns);
            SkipLeadingPartialWhitespace(remainingRuns);

            if (!HasPrintableHtmlContent(remainingRuns))
                return true;

            currentHtml = BuildHtmlFromRuns(currentRuns);
            remainingHtml = BuildHtmlFromRuns(remainingRuns);

            if (string.IsNullOrEmpty(currentHtml) || string.IsNullOrEmpty(remainingHtml))
                return false;

            return true;
        }

        private static int GetTotalPlainTextLength(List<HtmlFormatRun> runs)
        {
            int totalLength = 0;
            foreach (HtmlFormatRun run in runs)
            {
                if (!string.IsNullOrEmpty(run.Text))
                    totalLength += run.Text.Length;
            }
            return totalLength;
        }

        private static void SplitHtmlRuns(List<HtmlFormatRun> runs, int visibleLength,
            out List<HtmlFormatRun> currentRuns, out List<HtmlFormatRun> remainingRuns)
        {
            currentRuns = new List<HtmlFormatRun>();
            remainingRuns = new List<HtmlFormatRun>();
            int remainingVisibleLength = visibleLength;

            foreach (HtmlFormatRun run in runs)
            {
                string runText = run.Text ?? string.Empty;
                if (remainingVisibleLength <= 0)
                {
                    if (runText.Length > 0)
                        remainingRuns.Add(run.Clone());
                    continue;
                }

                if (runText.Length <= remainingVisibleLength)
                {
                    if (runText.Length > 0)
                        currentRuns.Add(run.Clone());
                    remainingVisibleLength -= runText.Length;
                    continue;
                }

                HtmlFormatRun currentRun = run.Clone();
                currentRun.Text = runText.Substring(0, remainingVisibleLength);
                currentRuns.Add(currentRun);

                HtmlFormatRun nextRun = run.Clone();
                nextRun.Text = runText.Substring(remainingVisibleLength);
                remainingRuns.Add(nextRun);
                remainingVisibleLength = 0;
            }
        }

        private static void SkipLeadingPartialWhitespace(List<HtmlFormatRun> runs)
        {
            for (int index = 0; index < runs.Count; index++)
            {
                HtmlFormatRun run = runs[index];
                if (string.IsNullOrEmpty(run.Text))
                    continue;

                char firstChar = run.Text[0];
                if ((firstChar == ' ') || (firstChar == '\n'))
                {
                    run.Text = run.Text.Substring(1);
                    if (run.Text.Length == 0)
                    {
                        runs.RemoveAt(index);
                    }
                }
                break;
            }
        }

        private static bool HasPrintableHtmlContent(List<HtmlFormatRun> runs)
        {
            foreach (HtmlFormatRun run in runs)
            {
                if (string.IsNullOrEmpty(run.Text))
                    continue;

                foreach (char character in run.Text)
                {
                    if (!char.IsWhiteSpace(character) && character != '\u00A0')
                        return true;
                }
            }

            return false;
        }

        private static string BuildHtmlFromRuns(List<HtmlFormatRun> runs)
        {
            StringBuilder builder = new StringBuilder();
            foreach (HtmlFormatRun run in runs)
            {
                if (string.IsNullOrEmpty(run.Text))
                    continue;

                string segment = EncodeHtmlText(run.Text);
                if (segment.Length == 0)
                    continue;

                if (run.HasColor)
                {
                    int red = run.Color & 0xFF;
                    int green = (run.Color >> 8) & 0xFF;
                    int blue = (run.Color >> 16) & 0xFF;
                    segment = "<font color=\"#" + red.ToString("X2", CultureInfo.InvariantCulture)
                        + green.ToString("X2", CultureInfo.InvariantCulture)
                        + blue.ToString("X2", CultureInfo.InvariantCulture) + "\">" + segment + "</font>";
                }

                if (run.HasFontSize)
                    segment = "<span style=\"font-size:" + run.FontSize.ToString("0.##", CultureInfo.InvariantCulture) + "pt\">" + segment + "</span>";

                if (!string.IsNullOrEmpty(run.FontFamily))
                    segment = "<font face=\"" + EncodeHtmlAttribute(run.FontFamily) + "\">" + segment + "</font>";

                if (run.StrikeOut)
                    segment = "<strike>" + segment + "</strike>";
                if (run.Underline)
                    segment = "<u>" + segment + "</u>";
                if (run.Italic)
                    segment = "<i>" + segment + "</i>";
                if (run.Bold)
                    segment = "<b>" + segment + "</b>";

                builder.Append(segment);
            }
            return builder.ToString();
        }

        private static string EncodeHtmlText(string text)
        {
            StringBuilder builder = new StringBuilder(text.Length);
            foreach (char character in text)
            {
                switch (character)
                {
                    case '&':
                        builder.Append("&amp;");
                        break;
                    case '<':
                        builder.Append("&lt;");
                        break;
                    case '>':
                        builder.Append("&gt;");
                        break;
                    case '"':
                        builder.Append("&quot;");
                        break;
                    case '\r':
                        break;
                    case '\n':
                        builder.Append("<br>");
                        break;
                    case '\u00A0':
                        builder.Append("&nbsp;");
                        break;
                    default:
                        builder.Append(character);
                        break;
                }
            }
            return builder.ToString();
        }

        private static string EncodeHtmlAttribute(string value)
        {
            return value.Replace("&", "&amp;").Replace("\"", "&quot;").Replace("<", "&lt;").Replace(">", "&gt;");
        }
        public override void SubReportChanged(SubReportEvent newstate, string newgroup)
        {
            base.SubReportChanged(newstate, newgroup);

            Evaluator eval;
            eval = Report.Evaluator;
            switch (newstate)
            {
                case SubReportEvent.Start:
                    FExportValue = new Variant();
                    FIsPartial = false;
                    FForcedPartial = false;
                    FHtmlPartialText = null;
                    FOldString = "";
                    FUpdated = false;
                    FDataCount = 0;
                    if (Aggregate != Aggregate.None)
                    {
                        try
                        {
                            // Update with the initial value
                            eval.Expression = AgIniValue;
                            eval.Evaluate();
                            Value = eval.Result;
                            FSumValue = Value;
                            FUpdated = true;
                        }
                        catch (Exception E)
                        {
                            throw new ReportException(E.Message + (char)10 + Name + " Prop:AgIniValue", this, "AgIniValue");
                        }
                    }
                    break;
                case SubReportEvent.SubReportStart:
                    FExportValue = new Variant();
                    FIsPartial = false;
                    FForcedPartial = false;
                    FHtmlPartialText = null;
                    FOldString = "";
                    FUpdated = false;
                    FDataCount = 0;
                    if ((Aggregate != Aggregate.None) && (Aggregate != Aggregate.General))
                    {
                        try
                        {
                            // Update with the initial value
                            eval.Expression = AgIniValue;
                            eval.Evaluate();
                            Value = eval.Result;
                            FSumValue = Value;
                            FUpdated = true;
                        }
                        catch (Exception E)
                        {
                            throw new ReportException(E.Message + (char)10 + Name + " Prop:AgIniValue", this, "AgIniValue");
                        }
                    }
                    break;
                case SubReportEvent.DataChange:
                    FIsPartial = false;
                    FForcedPartial = false;
                    FHtmlPartialText = null;
                    FUpdated = false;
                    FDataCount++;
                    if (Aggregate != Aggregate.None)
                    {
                        try
                        {
                            eval.Expression = Expression;
                            eval.Evaluate();
                            // Do the operation
                            switch (AgType)
                            {
                                case AggregateType.Summary:
                                    if (eval.Result.VarType != VariantType.Null)
                                        Value = Value + eval.Result;
                                    break;
                                case AggregateType.Minimum:
                                    if (eval.Result.VarType != VariantType.Null)
                                    {
                                        if (Value > eval.Result)
                                            Value = eval.Result;
                                    }
                                    break;
                                case AggregateType.Maximum:
                                    if (eval.Result.VarType != VariantType.Null)
                                    {
                                        if (Value < eval.Result)
                                            Value = eval.Result;
                                    }
                                    break;
                                case AggregateType.Average:
                                    if (eval.Result.VarType == VariantType.Null)
                                    {
                                        FDataCount--;
                                    }
                                    else
                                    {
                                        FSumValue = FSumValue + eval.Result;
                                        Value = FSumValue / FDataCount;
                                    }
                                    break;
                                case AggregateType.StandardDeviation:
                                    if (eval.Result.VarType == VariantType.Null)
                                    {
                                        FDataCount--;
                                    }
                                    else
                                    {
                                        FValues.Add(eval.Result);
                                        Value = DoubleUtil.StandardDeviation(FValues);
                                    }
                                    break;

                            }
                            FUpdated = true;
                        }
                        catch (Exception E)
                        {
                            throw new ReportException(E.Message + (char)10 + Name + " Prop:Expression", this, "Expression");
                        }
                    }
                    break;
                case SubReportEvent.GroupChange:
                    FIsPartial = false;
                    FForcedPartial = false;
                    FHtmlPartialText = null;
                    FUpdated = false;
                    FOldString = "";
                    if (Aggregate == Aggregate.Group)
                    {
                        if (GroupName.ToUpper() == newgroup.ToUpper())
                        {
                            // Update with the initial value
                            try
                            {
                                // Update with the initial value
                                eval.Expression = AgIniValue;
                                eval.Evaluate();
                                Value = eval.Result;
                                FSumValue = Value;
                                FUpdated = true;
                            }
                            catch (Exception E)
                            {
                                throw new ReportException(E.Message + (char)10  + Name + " Prop:AgIniValue", this, "AgIniValue");
                            }
                        }
                    }
                    break;
                case SubReportEvent.PageChange:
                    FOldString = "";
                    if (Aggregate == Aggregate.None)
                    {
                        // Page variable must be recalculated
                        FUpdated = false;
                    }
                    if (Aggregate == Aggregate.Page)
                    {
                        // Update with the initial value
                        try
                        {
                            // Update with the initial value
                            eval.Expression = AgIniValue;
                            eval.Evaluate();
                            Value = eval.Result;
                            FSumValue = Value;
                            FUpdated = true;
                        }
                        catch (Exception E)
                        {
                            throw new ReportException(E.Message + (char)10 + Name + " Prop:AgIniValue", this, "AgIniValue");
                        }
                        SubReportChanged(SubReportEvent.DataChange, "");
                    }
                    break;
                case SubReportEvent.InvalidateValue:
                    FIsPartial = false;
                    FForcedPartial = false;
                    FHtmlPartialText = null;
                    FOldString = "";
                    FUpdated = false;
                    break;
            }
        }
        private TextObjectStruct GetTextObject()
        {
            int aalign;
            TextObjectStruct aresult = new TextObjectStruct();
            aresult.Text = GetText();
            aresult.LFontName = LFontName;
            aresult.WFontName = WFontName;
            aresult.FontSize = FontSize;
            aresult.FontRotation = FontRotation;
            aresult.FontStyle = (short)FontStyle;
            aresult.Type1Font = Type1Font;
            aresult.FontColor = FontColor;
            aresult.CutText = CutText;
            aalign = PrintAlignment | VPrintAlignment;
            if (SingleLine)
                aalign = aalign | MetaFile.AlignmentFlags_SingleLine;
            aresult.Alignment = aalign;
            aresult.WordWrap = WordWrap;
            aresult.RightToLeft = RightToLeft;
            aresult.PrintStep = PrintStep;
            aresult.IsHtml = IsHtml;
            return aresult;
        }
        override public Point GetExtension(PrintOut adriver, Point MaxExtent, bool ForcePartial)
        {
            TextObjectStruct atext;
            atext = GetTextObject();
            // Items printed only one time, have no extension
            if (PrintOnlyOne)
            {
                if (FOldString == atext.Text)
                {
                    return new Point(0, 0);
                }
            }

            int aposition;
            bool IsPartial;
            IsPartial = false;
            Point aresult = base.GetExtension(adriver, MaxExtent, ForcePartial);
            if ((MultiPage) || ForcePartial)
            {
                MaxExtent.X = aresult.X;
                if (IsHtml)
                {
                    if (!TrySplitHtmlForMultipage(adriver, atext, MaxExtent, out string currentHtml, out string remainingHtml))
                    {
                        currentHtml = atext.Text;
                        remainingHtml = string.Empty;
                    }
                    IsPartial = !string.IsNullOrEmpty(remainingHtml);
                    atext.Text = currentHtml;
                    aresult = adriver.TextExtent(atext, aresult);
                    if (IsPartial)
                        aresult.Y = MaxExtent.Y;
                }
                else
                {
                    aposition = MetaFile.CalcTextExtent(adriver, MaxExtent, atext);
                    if (aposition < atext.Text.Length)
                        IsPartial = true;
                    atext.Text = atext.Text.Substring(0, aposition);
                    aresult = adriver.TextExtent(atext, aresult);
                    if (IsPartial)
                        aresult.Y = MaxExtent.Y;
                }
            }
            else
                aresult = adriver.TextExtent(atext, aresult);
            LastExtent = aresult;
            return aresult;
        }
    }
}
