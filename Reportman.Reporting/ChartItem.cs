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
using System;
using System.Drawing;

namespace Reportman.Reporting
{


    /// <summary>
    /// A printable report item that builds and renders a chart from expression-driven data series,
    /// accumulating values, captions and colors as the subreport iterates and drawing the result
    /// through the report's charting driver.
    /// </summary>
    public class ChartItem : PrintItemText
    {
        /// <summary>
        /// Default palette of RGB colors assigned to the chart series in the order they are created.
        /// </summary>
        public int[] SeriesColors ={0xFF0000,0xFFDDFF,0x00FF00,0x0000FF,
            0xFFFF00,0xFF00FF,0x00FFFF,0xAAAAAA,0xBB0000,0x00BB00,0x0000BB,0xBBBB00,
            0xBB00BB,0x00BBBB,0x777777,0x773333,0x337733,0x333377,0x777700,
            0x770077,0x007777};
        private Series FSeries;
        private const int DEF_DRAWWIDTH = 500;
        private VariableGraph FIdenChart;
        /// <summary>
        /// Gets or sets the expression that decides when a new series must be started while the subreport iterates.
        /// </summary>
        public string ChangeSerieExpression { get; set; }
        /// <summary>
        /// Gets or sets the expression that decides when the accumulated series must be cleared.
        /// </summary>
        public string ClearExpression { get; set; }
        /// <summary>
        /// Gets or sets the condition expression; a value is added only when it evaluates to true.
        /// </summary>
        public string GetValueCondition { get; set; }
        /// <summary>
        /// Gets or sets the expression evaluated to obtain the value (Y coordinate) of each data point.
        /// </summary>
        public string ValueExpression { get; set; }
        /// <summary>
        /// Gets or sets the expression evaluated to obtain the X coordinate of each data point.
        /// </summary>
        public string ValueXExpression { get; set; }
        /// <summary>
        /// Gets or sets the expression evaluated to obtain the caption shown for each value.
        /// </summary>
        public string CaptionExpression { get; set; }
        /// <summary>
        /// Gets or sets the expression evaluated to obtain the caption of each series.
        /// </summary>
        public string SerieCaption { get; set; }
        /// <summary>
        /// Gets or sets the expression evaluated to obtain the color of each value.
        /// </summary>
        public string ColorExpression { get; set; }
        /// <summary>
        /// Gets or sets the expression evaluated to obtain the color of each series.
        /// </summary>
        public string SerieColorExpression { get; set; }
        /// <summary>
        /// Gets or sets whether <see cref="ChangeSerieExpression"/> is a boolean trigger; when false a new series
        /// starts whenever the expression result changes.
        /// </summary>
        public bool ChangeSerieBool { get; set; }
        /// <summary>
        /// Gets or sets the visual style used to draw the series (bar, line, pie, and so on).
        /// </summary>
        public ChartType ChartStyle { get; set; }
        /// <summary>
        /// Gets or sets the name that identifies this chart so its values can be referenced from report expressions.
        /// </summary>
        public string Identifier { get; set; }
        /// <summary>
        /// Gets or sets whether <see cref="ClearExpression"/> is a boolean trigger; when false the series are cleared
        /// whenever the expression result changes.
        /// </summary>
        public bool ClearExpressionBool { get; set; }
        /// <summary>
        /// Gets or sets the charting driver used to render this chart.
        /// </summary>
        public ChartDriver Driver { get; set; }
        /// <summary>
        /// Gets or sets whether the chart is drawn with a 3D effect.
        /// </summary>
        public bool View3d { get; set; }
        /// <summary>
        /// Gets or sets whether the 3D walls are drawn behind the chart.
        /// </summary>
        public bool View3dWalls { get; set; }
        /// <summary>
        /// Gets or sets the perspective used for the 3D projection.
        /// </summary>
        public int Perspective { get; set; }
        /// <summary>
        /// Gets or sets the elevation angle of the 3D view.
        /// </summary>
        public int Elevation { get; set; }
        /// <summary>
        /// Gets or sets the rotation angle of the 3D view.
        /// </summary>
        public int Rotation { get; set; }
        /// <summary>
        /// Gets or sets the zoom percentage applied to the chart.
        /// </summary>
        public int Zoom { get; set; }
        /// <summary>
        /// Gets or sets the horizontal offset of the 3D view.
        /// </summary>
        public int HorzOffset { get; set; }
        /// <summary>
        /// Gets or sets the vertical offset of the 3D view.
        /// </summary>
        public int VertOffset { get; set; }
        /// <summary>
        /// Gets or sets the tilt angle of the 3D view.
        /// </summary>
        public int Tilt { get; set; }
        /// <summary>
        /// Gets or sets whether an orthogonal projection is used instead of a perspective one.
        /// </summary>
        public bool Orthogonal { get; set; }
        /// <summary>
        /// Gets or sets how multiple bar series are arranged (side by side, stacked, and so on).
        /// </summary>
        public BarType MultiBar { get; set; }
        /// <summary>
        /// Gets or sets the drawing resolution of the chart.
        /// </summary>
        public int Resolution { get; set; }
        /// <summary>
        /// Gets or sets whether the chart legend is shown.
        /// </summary>
        public bool ShowLegend { get; set; }
        /// <summary>
        /// Gets or sets whether value hints are shown on the chart.
        /// </summary>
        public bool ShowHint { get; set; }
        /// <summary>
        /// Gets or sets the style used to draw the value marks.
        /// </summary>
        public int MarkStyle { get; set; }
        /// <summary>
        /// Gets or sets the font size of the horizontal axis labels.
        /// </summary>
        public int HorzFontSize { get; set; }
        /// <summary>
        /// Gets or sets the font size of the vertical axis labels.
        /// </summary>
        public int VertFontSize { get; set; }
        /// <summary>
        /// Gets or sets the rotation applied to the horizontal axis labels.
        /// </summary>
        public int HorzFontRotation { get; set; }
        /// <summary>
        /// Gets or sets the rotation applied to the vertical axis labels.
        /// </summary>
        public int VertFontRotation { get; set; }
        /// <summary>
        /// Helper object used by the drawing driver to hold state while rendering the chart.
        /// </summary>
        public object DrawHelper;
        /// <summary>
        /// Gets or sets how the Y axis range is calculated automatically.
        /// </summary>
        public Series.AutoRangeAxis AutoRange { get; set; } = Series.AutoRangeAxis.Default;
        /// <summary>
        /// Gets or sets the lower bound of the Y axis used when automatic range is disabled.
        /// </summary>
        public double AxisYInitial { get; set; } = 0;
        /// <summary>
        /// Gets or sets the upper bound of the Y axis used when automatic range is disabled.
        /// </summary>
        public double AxisYFinal { get; set; } = 0;

        [System.Text.Json.Serialization.JsonIgnore]
        [Newtonsoft.Json.JsonIgnore]
        internal VariableGraph IdenChart
        {
            get
            {
                return FIdenChart;
            }
        }
        /// <summary>
        /// Associates the item with its report and creates the chart variable bound to the report evaluator.
        /// </summary>
        /// <param name="rp">The report that owns this chart item.</param>
        public override void SetReport(BaseReport rp)
        {
            base.SetReport(rp);
            FIdenChart = new VariableGraph(Report.Evaluator, Report);
            FIdenChart.NewChart = this;
        }
        /// <summary>
        /// Initializes a new <see cref="ChartItem"/> with the default size, 3D view and rendering settings.
        /// </summary>
        public ChartItem()
            : base()
        {
            Height = DEF_DRAWWIDTH;
            Width = Height;
            ShowHint = true;
            FSeries = new Series();
            FSeries.Logaritmic = false;
            //      FIdenChart.OnClear:=OnClear;
            //      FIdenChart.OnNewValue:=OnNewValue;
            //      FIdenChart.OnSerieColor:=OnSerieColor;
            //      FIdenChart.OnValueColor:=OnValueColor;
            //      FIdenChart.OnBounds:=OnBoundsValue;
            View3d = true;
            Perspective = 15;
            Elevation = 345;
            Rotation = 345;
            Resolution = 100;
            Zoom = 100;
            Orthogonal = true;
            MultiBar = BarType.Side;
            MarkStyle = 0;
            HorzFontSize = 0;
            VertFontSize = 0;
            ChangeSerieExpression = "";
            ClearExpression = "";
            GetValueCondition = "";
            ValueExpression = "";
            ValueXExpression = "";
            CaptionExpression = "";
            SerieCaption = "";
            ColorExpression = "";
            SerieColorExpression = "";
            Identifier = "";
        }
        /// <summary>
        /// Returns the serialization class name ("TRPCHART") that identifies this item type.
        /// </summary>
        /// <returns>The class name used when the report is stored.</returns>
        protected override string GetClassName()
        {
            return "TRPCHART";
        }
        /// <summary>
        /// Removes all accumulated series and resets the Y axis range to the configured bounds.
        /// </summary>
        public void Clear()
        {
            FSeries.Clear();
            FSeries.HighValue = AxisYFinal;
            FSeries.LowValue = AxisYInitial;
            FSeries.AutoRange = AutoRange;
        }
        /// <summary>
        /// Responds to subreport lifecycle events, clearing the series at the start and appending a value on each
        /// data change when the value condition is satisfied.
        /// </summary>
        /// <param name="newstate">The subreport event being raised.</param>
        /// <param name="newgroup">The name of the group associated with the event.</param>
        public override void SubReportChanged(SubReportEvent newstate, string newgroup)
        {
            switch (newstate)
            {
                case SubReportEvent.Start:
                    FClearValue = new Variant();
                    FSerieValue = new Variant();
                    Clear();
                    break;
                case SubReportEvent.DataChange:
                    // Gets a value if the condition is true
                    if (CheckValueCondition())
                        GetNewValue();
                    break;
            }
            base.SubReportChanged(newstate, newgroup);
        }
        private void GetNewValue()
        {
            if (ValueExpression.Length == 0)
                return;
            EvaluateClearExpression();
            bool changeserie = EvaluateChangeSerieExpression();
            string seriecaption = "";
            if (changeserie)
                seriecaption = EvaluateSerieCaption().ToString();

            string newcaption = "";

            if (this.CaptionExpression.Length > 0)
            {
                newcaption = EvaluateText(CaptionExpression);
                if (FSeries.SeriesItems.Count == 0)
                {
                    seriecaption = EvaluateSerieCaption().ToString();
                    changeserie = true;
                }
            }
            Variant newvalue = EvaluateText(ValueExpression);
            double newdoublevalue = 0;
            if (!newvalue.IsNull)
                newdoublevalue = newvalue;
            if (ValueXExpression.Length > 0)
            {
                Variant newvalueX = EvaluateText(ValueXExpression);
                NewValueXY(newvalueX, newdoublevalue, changeserie, newcaption, seriecaption);
            }
            else
                NewValue(newdoublevalue, changeserie, newcaption, seriecaption);

            if (SerieColorExpression.Length > 0)
            {
                int newcolor = EvaluateText(SerieColorExpression);
                if (newcolor != 0)
                    FSeries.SeriesItems[FSeries.SeriesItems.Count - 1].Color = newcolor;
            }
            if (this.ColorExpression.Length > 0)
            {
                int newcolor = EvaluateText(ColorExpression);
                if (newcolor != 0)
                {
                    SeriesItem nitem = FSeries.SeriesItems[FSeries.SeriesItems.Count - 1];
                    nitem.Colors[nitem.Colors.Count - 1] = newcolor;
                }
            }
        }
        private Variant EvaluateText(string ntext)
        {
            Evaluator fevaluator;
            fevaluator = Report.Evaluator;
            fevaluator.Expression = ntext;
            Variant aresult;
            fevaluator.Evaluate();
            aresult = fevaluator.Result;
            return aresult;
        }
        Variant FClearValue;
        Variant FSerieValue;
        /// <summary>
        /// Evaluates <see cref="ClearExpression"/> and clears the accumulated series items when it triggers.
        /// </summary>
        public void EvaluateClearExpression()
        {
            if (this.ClearExpression.Length == 0)
                return;
            Evaluator fevaluator;
            fevaluator = Report.Evaluator;
            Variant aresult;
            try
            {
                fevaluator.Expression = ClearExpression;
                fevaluator.Evaluate();
                aresult = fevaluator.Result;
                if (ClearExpressionBool)
                {
                    if (aresult)
                        FSeries.SeriesItems.Clear();
                }
                else
                {
                    if (FClearValue != aresult)
                    {
                        FSeries.SeriesItems.Clear();
                        FClearValue = aresult;
                    }
                }

            }
            catch (Exception E)
            {
                throw new ReportException(E.Message + (char)10 + Name + " Prop:ClearExpression ", this, "ClearExpression");
            }
        }
        /// <summary>
        /// Evaluates <see cref="ChangeSerieExpression"/> to decide whether a new series must be started.
        /// </summary>
        /// <returns><c>true</c> when a new series should begin; otherwise <c>false</c>.</returns>
        public bool EvaluateChangeSerieExpression()
        {
            if (this.ChangeSerieExpression.Length == 0)
                return false;
            bool nresult = false;
            Evaluator fevaluator;
            fevaluator = Report.Evaluator;
            Variant aresult;
            try
            {
                fevaluator.Expression = ChangeSerieExpression;
                fevaluator.Evaluate();
                aresult = fevaluator.Result;
                if (ChangeSerieBool)
                {
                    if (aresult)
                        nresult = true;
                }
                else
                {
                    if (FSerieValue != aresult)
                    {
                        FSerieValue = aresult;
                        nresult = true;
                    }
                }

            }
            catch (Exception E)
            {
                throw new ReportException(E.Message + (char)10 + Name + " Prop:ChangeSerieExpression " + (char)10 + PrintCondition, this, "ChangeSerieExpression");
            }
            return nresult;
        }
        /// <summary>
        /// Evaluates <see cref="SerieCaption"/> and returns the caption to use for the current series.
        /// </summary>
        /// <returns>The evaluated series caption, or an empty value when no expression is set.</returns>
        public Variant EvaluateSerieCaption()
        {
            if (this.SerieCaption.Length == 0)
                return "";
            Evaluator fevaluator;
            fevaluator = Report.Evaluator;
            Variant aresult;
            try
            {
                fevaluator.Expression = SerieCaption;
                fevaluator.Evaluate();
                aresult = fevaluator.Result;
            }
            catch (Exception E)
            {
                throw new ReportException(E.Message +(char)10 + Name + " Prop:SerieCaption " + (char)10 + PrintCondition, this, "SerieCaption");
            }
            return aresult;
        }
        /// <summary>
        /// Evaluates <see cref="GetValueCondition"/> to decide whether the current value must be added to the chart.
        /// </summary>
        /// <returns><c>true</c> when the value should be collected; otherwise <c>false</c>.</returns>
        public bool CheckValueCondition()
        {
            if (this.GetValueCondition.Length == 0)
                return true;
            Evaluator fevaluator;
            bool nresult = false;
            fevaluator = Report.Evaluator;
            Variant aresult;
            try
            {
                fevaluator.Expression = GetValueCondition;
                fevaluator.Evaluate();
                aresult = fevaluator.Result;
                nresult = aresult;
            }
            catch (Exception E)
            {
                throw new ReportException(E.Message + (char)10 + Name + " Prop:GetValueCondition " + (char)10 + PrintCondition, this, "GetValueCondition");
            }
            return nresult;
        }
        private SeriesItem GetSeries(ref bool firstserie, string seriecaption)
        {
            SeriesItem aserie = null;
            if (FSeries.SeriesItems.Count < 1)
            {
                aserie = new SeriesItem();
                aserie.ChartStyle = this.ChartStyle;
                firstserie = true;
                aserie.Caption = seriecaption;
                FSeries.FontSize = FontSize;
                FSeries.Resolution = Resolution;
                FSeries.ShowLegend = ShowLegend;
                FSeries.MultiBar = MultiBar;
                FSeries.MarkStyle = MarkStyle;
                FSeries.HorzFontRotation = HorzFontRotation;
                FSeries.VertFontRotation = VertFontRotation;
                FSeries.VertFontSize = VertFontSize;
                FSeries.HorzFontSize = HorzFontSize;
                FSeries.ShowHint = ShowHint;
                FSeries.Effect3D = this.View3d;

                FSeries.SeriesItems.Add(aserie);
            }
            else
                aserie = FSeries.SeriesItems[FSeries.SeriesItems.Count - 1];

            return aserie;
        }

        /// <summary>
        /// Adds a new value to the current series, optionally starting a new series first.
        /// </summary>
        /// <param name="newvalue">The value (Y coordinate) to add.</param>
        /// <param name="seriechange">Whether a new series must be started before adding the value.</param>
        /// <param name="valuecaption">The caption shown for the value.</param>
        /// <param name="seriecaption">The caption used when a new series is started.</param>
        public void NewValue(double newvalue, bool seriechange, string valuecaption, string seriecaption)
        {
            NewValueXY(null, newvalue, seriechange, valuecaption, seriecaption);
        }
        /// <summary>
        /// Configures the axis range and scale of the series.
        /// </summary>
        /// <param name="autol">Whether the lower bound is calculated automatically.</param>
        /// <param name="autoh">Whether the upper bound is calculated automatically.</param>
        /// <param name="lvalue">The lower bound used when it is not automatic.</param>
        /// <param name="hvalue">The upper bound used when it is not automatic.</param>
        /// <param name="logaritmic">Whether the axis uses a logarithmic scale.</param>
        /// <param name="logBase">The base of the logarithmic scale.</param>
        /// <param name="inverted">Whether the axis is inverted.</param>
        public void GraphicBounds(bool autol, bool autoh, double lvalue, double hvalue, bool logaritmic,
            double logBase, bool inverted)
        {
            if (autol)
            {
                if (autoh)
                    FSeries.AutoRange = Series.AutoRangeAxis.AutoBoth;
                else
                    FSeries.AutoRange = Series.AutoRangeAxis.AutoLower;
            }
            else
            {
                if (autoh)
                    FSeries.AutoRange = Series.AutoRangeAxis.AutoUpper;
                else
                    FSeries.AutoRange = Series.AutoRangeAxis.None;
            }
            FSeries.Logaritmic = logaritmic;
            FSeries.LogBase = logBase;
            FSeries.Inverted = inverted;
            FSeries.LowValue = lvalue;
            FSeries.HighValue = hvalue;
        }
        /// <summary>
        /// Adds a function-based series that is computed from the existing data instead of raw values.
        /// </summary>
        /// <param name="functionName">The name of the function that produces the series.</param>
        /// <param name="functionParams">The parameters passed to the function.</param>
        /// <param name="serieCaption">The caption used for the new series.</param>
        public void NewFunction(string functionName, string functionParams, string serieCaption)
        {
            if (FSeries.SeriesItems.Count > 0)
            {
                SeriesItem itemFunc = new SeriesItem();
                itemFunc.Caption = serieCaption;
                itemFunc.FunctionName = functionName;
                itemFunc.FunctionParams = functionParams;
                FSeries.SeriesItems.Add(itemFunc);
            }
        }
        /// <summary>
        /// Adds a new X/Y value to the current series, starting a new series when requested.
        /// </summary>
        /// <param name="newvalueX">The X coordinate; may be a number, a date/time or <c>null</c> for a category axis.</param>
        /// <param name="newvalue">The value (Y coordinate) to add.</param>
        /// <param name="seriechange">Whether a new series must be started before adding the value.</param>
        /// <param name="valuecaption">The caption shown for the value.</param>
        /// <param name="seriecaption">The caption used when a new series is started.</param>
        public void NewValueXY(object newvalueX, double newvalue, bool seriechange, string valuecaption, string seriecaption)
        {
            bool firstserie = false;

            SeriesItem aserie = GetSeries(ref firstserie, seriecaption);
            if (seriechange)
            {
                if (!firstserie)
                {
                    aserie = new SeriesItem();
                    aserie.ChartStyle = this.ChartStyle;
                    aserie.Caption = seriecaption;
                    FSeries.SeriesItems.Add(aserie);
                }
            }
            aserie.Values.Add(newvalue);
            aserie.ValueCaptions.Add(valuecaption);
            aserie.Colors.Add(aserie.Color);
            if (newvalueX != null)
            {
                if (newvalueX is Variant)
                {
                    Variant valor = (Variant)newvalueX;
                    if (valor.IsDateTime())
                        aserie.ValuesX.Add((DateTime)valor);
                    else
                        aserie.ValuesX.Add((double)valor);
                }
                else
                {
                    if (newvalueX is DateTime)
                        aserie.ValuesX.Add((DateTime)newvalueX);
                    else
                        aserie.ValuesX.Add(Convert.ToDouble(newvalueX));
                }
            }
        }
        /// <summary>
        /// Sets the color of the last value added to the current series.
        /// </summary>
        /// <param name="newcolor">The RGB color to apply.</param>
        public void GraphicColor(int newcolor)
        {
            if (FSeries.SeriesItems.Count == 0)
                return;
            FSeries.SeriesItems[FSeries.SeriesItems.Count - 1].SetLastValueColor(newcolor);
        }
        /// <summary>
        /// Sets the color of the current series.
        /// </summary>
        /// <param name="newcolor">The RGB color to apply.</param>
        public void GraphicSerieColor(int newcolor)
        {
            if (FSeries.SeriesItems.Count == 0)
                return;
            FSeries.SeriesItems[FSeries.SeriesItems.Count - 1].Color = newcolor; ;
        }
        /// <summary>
        /// Renders the accumulated series into the metafile, using the report's charting driver when available and
        /// falling back to the print driver otherwise.
        /// </summary>
        /// <param name="adriver">The print driver used when the report has no dedicated charting driver.</param>
        /// <param name="aposx">The X position where the chart is drawn.</param>
        /// <param name="aposy">The Y position where the chart is drawn.</param>
        /// <param name="newwidth">The available width for the chart.</param>
        /// <param name="newheight">The available height for the chart.</param>
        /// <param name="metafile">The metafile that receives the drawing output.</param>
        /// <param name="MaxExtent">The maximum extent available for the item.</param>
        /// <param name="PartialPrint">Set to indicate whether the item was only partially printed.</param>
        protected override void DoPrint(PrintOut adriver, int aposx, int aposy, int newwidth, int newheight, MetaFile metafile, Point MaxExtent, ref bool PartialPrint)
        {
            base.DoPrint(adriver, aposx, aposy, newwidth, newheight, metafile, MaxExtent, ref PartialPrint);
            FSeries.PrintWidth = PrintWidth;
            FSeries.PrintHeight = PrintHeight;

            if (FSeries.SeriesItems.Count == 0)
                return;
            if (Report.ChartingDriver != null)
                Report.ChartingDriver.DrawChart(FSeries, metafile, aposx, aposy, this);
            else
                adriver.DrawChart(FSeries, metafile, aposx, aposy, this);
        }
    }

}
