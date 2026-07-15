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
using System.Drawing;

namespace Reportman.Reporting
{
    /// <summary>
    /// Defines the scope over which an aggregate value is accumulated: none, per group,
    /// per page, or across the whole report.
    /// </summary>
    public enum Aggregate
    {
        /// <summary>
        /// No aggregation is performed.
        /// </summary>
        None,
        /// <summary>
        /// Accumulate values per report group.
        /// </summary>
        Group,
        /// <summary>
        /// Accumulate values per page.
        /// </summary>
        Page,
        /// <summary>
        /// Accumulate values across the entire report.
        /// </summary>
        General
    };
    /// <summary>
    /// The kind of aggregation applied to a value: sum, minimum, maximum, average, or
    /// standard deviation.
    /// </summary>
    public enum AggregateType
    {
        /// <summary>
        /// Calculate the sum (summary) of values.
        /// </summary>
        Summary,
        /// <summary>
        /// Find the minimum value.
        /// </summary>
        Minimum,
        /// <summary>
        /// Find the maximum value.
        /// </summary>
        Maximum,
        /// <summary>
        /// Calculate the average value.
        /// </summary>
        Average,
        /// <summary>
        /// Calculate the standard deviation of values.
        /// </summary>
        StandardDeviation
    };
    /// <summary>
    /// A report print item that renders a static, language-aware text label, selecting the
    /// string for the report's current language and supporting optional HTML content.
    /// </summary>
    public class LabelItem : PrintItemText
    {
        Strings FAllStrings;
        /// <summary>
        /// Initializes a new instance of the <see cref="LabelItem"/> class with empty localized string collections.
        /// </summary>
        public LabelItem()
            : base()
        {
            FAllStrings = new Strings();
        }
        /// <summary>
        /// Gets or sets the collection of localized text strings for the label, where each entry corresponds to a supported language.
        /// </summary>
        public Strings AllStrings { get { return FAllStrings; } set { FAllStrings = value; } }
        /// <summary>
        /// Gets or sets the text value of the label for the current report language.
        /// </summary>
        [System.Text.Json.Serialization.JsonIgnore]
        [Newtonsoft.Json.JsonIgnore]

        public string Text
        {
            get
            {
                int lang = Report.Language + 1;
                if (lang < 0)
                    lang = 0;
                if (lang < FAllStrings.Count)
                    return FAllStrings[lang];
                else
                    if (FAllStrings.Count > 0)
                        return FAllStrings[0];
                    else
                        return "";

            }
            set
            {
                // Mismo convenio que el getter (y que el designer web): el idioma L
                // vive en AllStrings[L + 1]. Antes el setter escribía en [L] y con
                // Language >= 0 leía y escribía slots distintos.
                int lang = Report.Language + 1;
                if (lang < 0)
                    lang = 0;
                string defaultvalue = "";
                if (FAllStrings.Count > 0)
                    defaultvalue = FAllStrings[0];
                while (lang > (FAllStrings.Count - 1))
                {
                    FAllStrings.Add(defaultvalue);
                }
                FAllStrings[lang] = value;
            }
        }
        /// <summary>
        /// Gets the class name identifier for the print item.
        /// </summary>
        /// <returns>A string representing the class name, "TRPLABEL".</returns>
        protected override string GetClassName()
        {
            return "TRPLABEL";
        }
        /// <summary>
        /// Performs the drawing of the label item onto the metafile, handling alignment, HTML encoding, fonts, and colors.
        /// </summary>
        /// <param name="adriver">The render driver used to output the item.</param>
        /// <param name="aposx">The horizontal coordinate position.</param>
        /// <param name="aposy">The vertical coordinate position.</param>
        /// <param name="newwidth">The width of the printed item.</param>
        /// <param name="newheight">The height of the printed item.</param>
        /// <param name="metafile">The destination metafile for drawing operations.</param>
        /// <param name="MaxExtent">The maximum drawing bounds allowed.</param>
        /// <param name="PartialPrint">A flag indicating if printing was partial.</param>
        override protected void DoPrint(PrintOut adriver, int aposx, int aposy,
            int newwidth, int newheight, MetaFile metafile, Point MaxExtent,
            ref bool PartialPrint)
        {
            int aalign;
            base.DoPrint(adriver, aposx, aposy, newwidth, newheight,
                metafile, MaxExtent, ref PartialPrint);
            MetaPage apage = metafile.Pages[metafile.CurrentPage];
            MetaObjectText metaobj = new();
            FillAnnotation(metaobj, apage);
            string finalText = IsHtml ? EvaluateHtmlExpressions(Text) : Text;
            metaobj.TextP = apage.AddString(finalText);
            metaobj.TextS = finalText.Length;
            metaobj.LFontNameP = apage.AddString(LFontName);
            metaobj.LFontNameS = LFontName.Length;
            metaobj.WFontNameP = apage.AddString(WFontName);
            metaobj.WFontNameS = WFontName.Length;
            metaobj.FontSize = FontSize;
            metaobj.BackColor = BackColor;
            metaobj.FontRotation = FontRotation;
            metaobj.FontStyle = (short)FontStyle;
            metaobj.FontColor = FontColor;
            metaobj.Type1Font = Type1Font;
            metaobj.CutText = CutText;
            metaobj.Transparent = Transparent;
            metaobj.WordWrap = WordWrap;
            metaobj.Top = aposy;
            metaobj.Left = aposx;
            metaobj.Width = PrintWidth;
            metaobj.Height = PrintHeight;
            metaobj.RightToLeft = RightToLeft;
            metaobj.PrintStep = PrintStep;
            metaobj.IsHtml = IsHtml;
            aalign = PrintAlignment | VPrintAlignment;
            if (SingleLine)
                aalign = aalign | MetaFile.AlignmentFlags_SingleLine;
            metaobj.Alignment = aalign;
            apage.Objects.Add(metaobj);
        }
        private TextObjectStruct GetTextObject()
        {
            int aalign;
            TextObjectStruct aresult = new();
            aresult.Text = IsHtml ? EvaluateHtmlExpressions(Text) : Text;
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
        /// <summary>
        /// Calculates the layout extent size required by the label based on its text, font, alignment, and wrapping properties.
        /// </summary>
        /// <param name="adriver">The print out driver containing drawing metric tools.</param>
        /// <param name="MaxExtent">The maximum size limits allowed.</param>
        /// <param name="ForcePartial">Forces calculating text extent under partial page layout rules.</param>
        /// <returns>A <see cref="Point"/> containing the calculated width and height dimensions.</returns>
        override public Point GetExtension(PrintOut adriver, Point MaxExtent, bool ForcePartial)
        {
            TextObjectStruct atext;
            atext = GetTextObject();
            Point aresult = base.GetExtension(adriver, MaxExtent, ForcePartial);
            aresult = adriver.TextExtent(atext, aresult);
            LastExtent = aresult;
            return aresult;
        }
    }
    /// <summary>
    /// An evaluator identifier function that resolves to the value of an associated
    /// <see cref="ExpressionItem"/>, evaluating it on demand.
    /// </summary>
    public class EvalIdenExpression : IdenFunction
    {
        /// <summary>
        /// Initializes a new instance of the <see cref="EvalIdenExpression"/> class with a specified evaluator.
        /// </summary>
        /// <param name="eval">The <see cref="Evaluator"/> context to associate with this identifier.</param>
        public EvalIdenExpression(Evaluator eval)
            : base(eval)
        { }
        /// <summary>
        /// The associated report expression item whose value is evaluated on demand.
        /// </summary>
        public ExpressionItem ExpreItem;
        /// <summary>
        /// Evaluates the expression item and returns its current value.
        /// </summary>
        /// <returns>A <see cref="Variant"/> containing the evaluated value.</returns>
        protected override Variant GetValue()
        {
            ExpreItem.Evaluate();
            return ExpreItem.Value;
        }
    }
}
