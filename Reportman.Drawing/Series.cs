using System.Collections.Generic;

namespace Reportman.Drawing
{
    /// <summary>
    /// Describes a chart's overall appearance and axis configuration (ranges, scaling, fonts,
    /// 3D effect, legend) together with the collection of data series it contains.
    /// </summary>
    public class Series
    {
        /// <summary>
        /// Controls how a chart axis range is computed: from explicit bounds, or automatically
        /// for both ends, only the upper bound, only the lower bound, or not at all.
        /// </summary>
        public enum AutoRangeAxis
        {
            /// <summary>The axis range is taken from the explicitly configured bounds.</summary>
            Default = 0,
            /// <summary>Both the lower and upper bounds are computed automatically.</summary>
            AutoBoth = 1,
            /// <summary>Only the upper bound is computed automatically.</summary>
            AutoUpper = 2,
            /// <summary>Only the lower bound is computed automatically.</summary>
            AutoLower = 3,
            /// <summary>No automatic range is applied.</summary>
            None = 4
        };
        /// <summary>
        /// Axis range mode that determines whether the value axis bounds are taken from
        /// <see cref="LowValue"/> and <see cref="HighValue"/> or computed automatically.
        /// </summary>
        public AutoRangeAxis AutoRange;
        /// <summary>Lower bound of the value axis when the range is set explicitly.</summary>
        public double LowValue;
        /// <summary>Upper bound of the value axis when the range is set explicitly.</summary>
        public double HighValue;
        /// <summary>When true, the value axis uses a logarithmic scale.</summary>
        public bool Logaritmic;
        /// <summary>Base used for the logarithmic value axis scale.</summary>
        public double LogBase;
        /// <summary>When true, the value axis is drawn inverted, with high values at the bottom.</summary>
        public bool Inverted;
        /// <summary>Font size, in points, used for chart text.</summary>
        public float FontSize;
        /// <summary>Rendering resolution, in dots per inch, used when drawing the chart.</summary>
        public float Resolution = 100;
        /// <summary>When true, the chart legend is displayed.</summary>
        public bool ShowLegend;
        /// <summary>Rotation angle, in degrees, applied to horizontal axis labels.</summary>
        public int HorzFontRotation;
        /// <summary>Rotation angle, in degrees, applied to vertical axis labels.</summary>
        public int VertFontRotation;
        /// <summary>Font size, in points, used for vertical axis labels.</summary>
        public int VertFontSize;
        /// <summary>Font size, in points, used for horizontal axis labels.</summary>
        public int HorzFontSize;
        /// <summary>When true, hints (tooltips) are shown for chart points.</summary>
        public bool ShowHint;
        /// <summary>Width, in the chart's coordinate units, used when printing the chart.</summary>
        public int PrintWidth;
        /// <summary>Height, in the chart's coordinate units, used when printing the chart.</summary>
        public int PrintHeight;
        /// <summary>When true, the chart is drawn with a three-dimensional effect.</summary>
        public bool Effect3D;
        /// <summary>Style used to draw point marks on the chart.</summary>
        public int MarkStyle;
        /// <summary>How multiple bar series are combined (side by side, stacked, or stacked to 100 percent).</summary>
        public BarType MultiBar;
        /// <summary>Collection of data series that make up the chart.</summary>
        public List<SeriesItem> SeriesItems = new List<SeriesItem>();
        /// <summary>
        /// Initializes a new instance of the <see cref="Series"/> class with default range
        /// and appearance settings.
        /// </summary>
        public Series()
        {
            LowValue = 0.0;
            HighValue = 0.0;
            LogBase = 0.0;
            Inverted = false;
            AutoRange = AutoRangeAxis.Default;
            Effect3D = false;
        }
        /// <summary>Removes all data series from the chart.</summary>
        public void Clear()
        {
            SeriesItems.Clear();
        }
    }
    /// <summary>
    /// Enumerates the available chart rendering styles, such as line, bar, pie, area, gantt or radar.
    /// </summary>
    public enum ChartType
    {
        /// <summary>Line chart.</summary>
        Line,
        /// <summary>Vertical bar chart.</summary>
        Bar,
        /// <summary>Point (scatter) chart.</summary>
        Point,
        /// <summary>Horizontal bar chart.</summary>
        Horzbar,
        /// <summary>Area chart.</summary>
        Area,
        /// <summary>Pie chart.</summary>
        Pie,
        /// <summary>Arrow chart.</summary>
        Arrow,
        /// <summary>Bubble chart.</summary>
        Bubble,
        /// <summary>Gantt chart.</summary>
        Gantt,
        /// <summary>Spline (smoothed line) chart.</summary>
        Splines,
        /// <summary>Candlestick chart.</summary>
        CandleStick,
        /// <summary>Pyramid chart.</summary>
        Pyramid,
        /// <summary>Polar chart.</summary>
        Polar,
        /// <summary>Point and figure chart.</summary>
        PointFigure,
        /// <summary>Funnel chart.</summary>
        Funnel,
        /// <summary>Kagi chart.</summary>
        Kagi,
        /// <summary>Doughnut chart.</summary>
        Doughnut,
        /// <summary>Radar chart.</summary>
        Radar,
        /// <summary>Renko chart.</summary>
        Renko,
        /// <summary>Error bar chart.</summary>
        ErrorBar
    };
    /// <summary>
    /// Selects which charting back end renders the chart: the default, the built-in engine, or TeeChart.
    /// </summary>
    public enum ChartDriver
    {
        /// <summary>Use the default charting back end.</summary>
        Default,
        /// <summary>Use the built-in charting engine.</summary>
        Engine,
        /// <summary>Use the TeeChart charting component.</summary>
        Teechart
    };
    /// <summary>
    /// Specifies how multiple bar series are combined: not combined, placed side by side,
    /// stacked, or stacked to fill 100 percent.
    /// </summary>
    public enum BarType
    {
        /// <summary>Bars are not combined.</summary>
        None,
        /// <summary>Bars are placed side by side.</summary>
        Side,
        /// <summary>Bars are stacked on top of each other.</summary>
        Stacked,
        /// <summary>Bars are stacked and scaled to fill 100 percent.</summary>
        Stacked100
    };
    /// <summary>
    /// A single data series within a chart, holding its values, per-point colors and captions,
    /// value range, caption and the chart style used to draw it.
    /// </summary>
    public class SeriesItem
    {
        /// <summary>Y values of the series points.</summary>
        public Doubles Values;
        /// <summary>Optional X values of the series points, aligned with <see cref="Values"/>.</summary>
        public List<object> ValuesX;
        /// <summary>Per-point colors for the series, aligned with <see cref="Values"/>.</summary>
        public Integers Colors;
        /// <summary>Per-point captions for the series, aligned with <see cref="Values"/>.</summary>
        public Strings ValueCaptions;
        /// <summary>Default color of the series, or -1 to use an automatic color.</summary>
        public int Color;
        /// <summary>Caption used to identify the series, for example in the legend.</summary>
        public string Caption;
        /// <summary>Largest value found in the series.</summary>
        public double MaxValue;
        /// <summary>Smallest value found in the series.</summary>
        public double MinValue;
        /// <summary>Chart style used to draw this series.</summary>
        public ChartType ChartStyle;
        /// <summary>Name of the aggregate function applied to the series values, if any.</summary>
        public string FunctionName;
        /// <summary>Parameters passed to the aggregate function, if any.</summary>
        public string FunctionParams;
        /// <summary>
        /// Initializes a new empty <see cref="SeriesItem"/> with default color and value bounds.
        /// </summary>
        public SeriesItem()
        {
            Color = -1;
            MaxValue = -10e300;
            MinValue = +10e300;
            Values = new Doubles();
            ValuesX = new List<object>();
            Colors = new Integers();
            ValueCaptions = new Strings();
            Caption = "";
            ChartStyle = ChartType.Bar;

        }
        /// <summary>
        /// Sets the color of the most recently added point; does nothing if the series has no points.
        /// </summary>
        /// <param name="newcolor">Color to assign to the last point.</param>
        public void SetLastValueColor(int newcolor)
        {
            if (Colors.Count == 0)
                return;
            Colors[Colors.Count - 1] = newcolor;
        }
    }
}
