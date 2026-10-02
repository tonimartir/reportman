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
 *  Copyright (c) 1994 - 2026 Toni Martir (toni@reportman.es)
 *  All Rights Reserved.
*/
#endregion

using System;
using System.Collections.Generic;
using System.Globalization;
using System.Reflection;

namespace Reportman.Drawing
{
    /// <summary>
    /// Draws a chart into a metafile page using only draw and text objects, so the drivers without a
    /// bitmap back end (PDF with FreeType, text, metafile export on Linux) print charts like the Delphi
    /// PDF driver does. Bars, horizontal bars, lines, points and areas are drawn natively; the styles the
    /// metafile cannot express with its primitives (pie, radar, bubble...) fall back to bars.
    /// </summary>
    public static class VectorChart
    {
        /// <summary>The same palette the GDI driver uses, as Report Manager colors (BGR).</summary>
        public static readonly int[] SeriesColors =
        {
            0xFF0000, 0xFF22FF, 0x00FF00, 0x0000FF,
            0xFF9800, 0x00BCD4, 0x9C27B0, 0xFFC107,
            0x4CAF50, 0x795548, 0x03A9F4, 0xE91E63,
            0x607D8B, 0x009688, 0xFF5722, 0x8BC34A,
            0x3F51B5, 0xCDDC39, 0x9E9E9E, 0x673AB7,
            0xA1887F
        };
        private const int TWIPS_PER_POINT = 20;
        private const int GRID_COLOR = 0xD0D0D0;
        private const int AXIS_COLOR = 0x606060;
        private const int WHITE = 0xFFFFFF;

        /// <summary>Everything the renderer needs to know about the chart item, read without a reference to Reporting.</summary>
        private sealed class Style
        {
            public string FontName = "Arial";
            public short FontSize = 8;
            public int FontColor = 0;
            public PDFFontType Type1Font = PDFFontType.Helvetica;
        }

        /// <summary>
        /// Draws the series at the given position (twips) with the size the chart item printed with.
        /// </summary>
        /// <param name="series">The accumulated series of the chart.</param>
        /// <param name="metafile">The metafile that receives the objects, on its current page.</param>
        /// <param name="posx">Left of the chart, in twips.</param>
        /// <param name="posy">Top of the chart, in twips.</param>
        /// <param name="chart">The chart item (a text item): its font is used for the labels.</param>
        public static void Draw(Series series, MetaFile metafile, int posx, int posy, object chart)
        {
            if (series == null || series.SeriesItems.Count == 0 || series.PrintWidth <= 0 || series.PrintHeight <= 0)
                return;
            MetaPage page = metafile.Pages[metafile.CurrentPage];
            Style style = ReadStyle(chart, series);
            int lineHeight = (int)Math.Round(style.FontSize * TWIPS_PER_POINT * 1.35);
            int charWidth = (int)Math.Round(style.FontSize * TWIPS_PER_POINT * 0.55);

            int points = 0;
            bool anyCaption = false;
            foreach (SeriesItem item in series.SeriesItems)
            {
                if (item.Values.Count > points) points = item.Values.Count;
                for (int i = 0; i < item.ValueCaptions.Count; i++)
                    if (!string.IsNullOrEmpty(item.ValueCaptions[i])) anyCaption = true;
            }
            if (points == 0)
                return;

            ChartType kind = series.SeriesItems[0].ChartStyle;
            bool horizontal = kind == ChartType.Horzbar;
            bool legend = series.ShowLegend && series.SeriesItems.Count > 1;

            // Value range: the item's axis bounds when it fixed them, otherwise the data with zero
            // always included (a bar that does not start at zero misleads).
            double min, max;
            Range(series, out min, out max);
            double step = NiceStep(max - min, 5);
            min = Math.Floor(min / step) * step;
            max = Math.Ceiling(max / step) * step;
            if (max <= min) max = min + step;

            // Gutters: value labels on one side, captions on the other, legend on top.
            string widest = FormatValue(max, step).Length >= FormatValue(min, step).Length ? FormatValue(max, step) : FormatValue(min, step);
            int valueGutter = widest.Length * charWidth + charWidth * 2;
            int captionGutter = anyCaption ? (horizontal ? Math.Min(series.PrintWidth / 3, 14 * charWidth) : lineHeight * 2) : lineHeight / 2;
            int legendGutter = legend ? lineHeight + lineHeight / 2 : 0;
            int margin = charWidth;

            int plotLeft, plotTop, plotWidth, plotHeight;
            if (horizontal)
            {
                plotLeft = posx + captionGutter;
                plotTop = posy + legendGutter + lineHeight / 2;
                plotWidth = series.PrintWidth - captionGutter - margin;
                plotHeight = series.PrintHeight - legendGutter - lineHeight / 2 - lineHeight;
            }
            else
            {
                plotLeft = posx + valueGutter;
                plotTop = posy + legendGutter + lineHeight / 2;
                plotWidth = series.PrintWidth - valueGutter - margin;
                plotHeight = series.PrintHeight - legendGutter - lineHeight / 2 - captionGutter;
            }
            if (plotWidth < charWidth * 4 || plotHeight < lineHeight)
                return;

            // Grid and value labels.
            int ticks = (int)Math.Round((max - min) / step);
            for (int t = 0; t <= ticks; t++)
            {
                double value = min + t * step;
                string label = FormatValue(value, step);
                if (horizontal)
                {
                    int x = plotLeft + (int)Math.Round((value - min) / (max - min) * plotWidth);
                    if (t > 0)
                        Line(page, plotTop, x, 1, plotHeight, ShapeType.VertLine, PenType.Dot, GRID_COLOR);
                    Text(page, plotTop + plotHeight + lineHeight / 8, x - charWidth * 4, charWidth * 8, lineHeight, label, style,
                        MetaFile.AlignmentFlags_AlignHCenter | MetaFile.AlignmentFlags_SingleLine, false);
                }
                else
                {
                    int y = plotTop + plotHeight - (int)Math.Round((value - min) / (max - min) * plotHeight);
                    if (t > 0)
                        Line(page, y, plotLeft, plotWidth, 1, ShapeType.HorzLine, PenType.Dot, GRID_COLOR);
                    Text(page, y - lineHeight / 2, posx, valueGutter - charWidth, lineHeight, label, style,
                        MetaFile.AlignmentFlags_AlignRight | MetaFile.AlignmentFlags_AlignVCenter | MetaFile.AlignmentFlags_SingleLine, false);
                }
            }
            // Axes.
            Line(page, plotTop, plotLeft, 1, plotHeight, ShapeType.VertLine, PenType.Solid, AXIS_COLOR);
            Line(page, plotTop + plotHeight, plotLeft, plotWidth, 1, ShapeType.HorzLine, PenType.Solid, AXIS_COLOR);

            // Series.
            int seriesCount = series.SeriesItems.Count;
            int slot = horizontal ? plotHeight / points : plotWidth / points;
            double zero = Math.Max(min, Math.Min(0, max));
            for (int s = 0; s < seriesCount; s++)
            {
                SeriesItem item = series.SeriesItems[s];
                int seriesColor = item.Color >= 0 ? item.Color : SeriesColors[s % SeriesColors.Length];
                ChartType itemKind = item.ChartStyle;
                bool asBars = itemKind != ChartType.Line && itemKind != ChartType.Point && itemKind != ChartType.Area
                    && itemKind != ChartType.Splines && itemKind != ChartType.Arrow;
                int previousX = 0, previousY = 0;
                for (int j = 0; j < item.Values.Count; j++)
                {
                    double value = item.Values[j];
                    int color = j < item.Colors.Count && item.Colors[j] >= 0 ? item.Colors[j] : seriesColor;
                    if (horizontal)
                    {
                        int barHeight = Math.Max(1, (int)Math.Round(slot * 0.7 / seriesCount));
                        int y = plotTop + j * slot + (int)Math.Round(slot * 0.15) + s * barHeight;
                        int xValue = plotLeft + (int)Math.Round((value - min) / (max - min) * plotWidth);
                        int xZero = plotLeft + (int)Math.Round((zero - min) / (max - min) * plotWidth);
                        Box(page, y, Math.Min(xZero, xValue), Math.Max(1, Math.Abs(xValue - xZero)), barHeight, color);
                        continue;
                    }
                    int x = plotLeft + j * slot;
                    int yValue = plotTop + plotHeight - (int)Math.Round((value - min) / (max - min) * plotHeight);
                    int yZero = plotTop + plotHeight - (int)Math.Round((zero - min) / (max - min) * plotHeight);
                    if (asBars)
                    {
                        int barWidth = Math.Max(1, (int)Math.Round(slot * 0.7 / seriesCount));
                        int left = x + (int)Math.Round(slot * 0.15) + s * barWidth;
                        Box(page, Math.Min(yZero, yValue), left, barWidth, Math.Max(1, Math.Abs(yValue - yZero)), color);
                    }
                    else
                    {
                        int cx = x + slot / 2;
                        if (itemKind == ChartType.Area)
                            Box(page, Math.Min(yZero, yValue), x + 1, Math.Max(1, slot - 2), Math.Max(1, Math.Abs(yValue - yZero)), color);
                        if (j > 0 && itemKind != ChartType.Point && itemKind != ChartType.Area)
                            Segment(page, previousX, previousY, cx, yValue, color);
                        if (itemKind == ChartType.Point || series.MarkStyle > 0 || points <= 12)
                        {
                            int radius = Math.Max(30, lineHeight / 5);
                            Shape(page, yValue - radius, cx - radius, radius * 2, radius * 2, ShapeType.Circle, color, PenType.Solid, color);
                        }
                        previousX = cx;
                        previousY = yValue;
                    }
                }
            }

            // Captions under (or beside) each point, from the first series that has them.
            if (anyCaption)
            {
                SeriesItem source = null;
                foreach (SeriesItem item in series.SeriesItems)
                    if (item.ValueCaptions.Count > 0) { source = item; break; }
                if (source != null)
                {
                    for (int j = 0; j < points && j < source.ValueCaptions.Count; j++)
                    {
                        string caption = source.ValueCaptions[j] ?? "";
                        if (caption.Length == 0) continue;
                        if (horizontal)
                            Text(page, plotTop + j * slot, posx, captionGutter - charWidth, slot, caption, style,
                                MetaFile.AlignmentFlags_AlignRight | MetaFile.AlignmentFlags_AlignVCenter, true);
                        else
                            Text(page, plotTop + plotHeight + lineHeight / 4, plotLeft + j * slot, slot, captionGutter - lineHeight / 4, caption, style,
                                MetaFile.AlignmentFlags_AlignHCenter, true);
                    }
                }
            }

            // Legend: a swatch and the caption of each series, in a row at the top.
            if (legend)
            {
                int x = plotLeft;
                int swatch = lineHeight * 2 / 3;
                for (int s = 0; s < seriesCount && x < posx + series.PrintWidth; s++)
                {
                    SeriesItem item = series.SeriesItems[s];
                    int color = item.Color >= 0 ? item.Color : SeriesColors[s % SeriesColors.Length];
                    string caption = string.IsNullOrEmpty(item.Caption) ? "Serie " + (s + 1).ToString(CultureInfo.InvariantCulture) : item.Caption;
                    int width = caption.Length * charWidth + charWidth;
                    Box(page, posy + (lineHeight - swatch) / 2, x, swatch, swatch, color);
                    Text(page, posy, x + swatch + charWidth / 2, width, lineHeight, caption, style,
                        MetaFile.AlignmentFlags_AlignLeft | MetaFile.AlignmentFlags_AlignVCenter | MetaFile.AlignmentFlags_SingleLine, false);
                    x += swatch + width + charWidth * 2;
                }
            }
        }

        private static void Range(Series series, out double min, out double max)
        {
            min = double.MaxValue;
            max = double.MinValue;
            foreach (SeriesItem item in series.SeriesItems)
            {
                for (int i = 0; i < item.Values.Count; i++)
                {
                    double v = item.Values[i];
                    if (double.IsNaN(v) || double.IsInfinity(v)) continue;
                    if (v < min) min = v;
                    if (v > max) max = v;
                }
            }
            if (min == double.MaxValue) { min = 0; max = 1; }
            bool fixedLow = series.AutoRange == Series.AutoRangeAxis.None || series.AutoRange == Series.AutoRangeAxis.AutoUpper;
            bool fixedHigh = series.AutoRange == Series.AutoRangeAxis.None || series.AutoRange == Series.AutoRangeAxis.AutoLower;
            if (fixedLow && series.LowValue < min) min = series.LowValue;
            if (fixedHigh && series.HighValue > max) max = series.HighValue;
            if (!fixedLow && min > 0) min = 0;
            if (!fixedHigh && max < 0) max = 0;
            if (max == min) max = min + 1;
        }

        /// <summary>A round step (1, 2, 2.5, 5 times a power of ten) giving about the wanted number of ticks.</summary>
        private static double NiceStep(double range, int ticks)
        {
            if (range <= 0) return 1;
            double raw = range / Math.Max(1, ticks);
            double magnitude = Math.Pow(10, Math.Floor(Math.Log10(raw)));
            double residual = raw / magnitude;
            double nice = residual <= 1 ? 1 : residual <= 2 ? 2 : residual <= 2.5 ? 2.5 : residual <= 5 ? 5 : 10;
            return nice * magnitude;
        }

        private static string FormatValue(double value, double step)
        {
            int decimals = 0;
            double s = step;
            while (decimals < 4 && Math.Abs(s - Math.Round(s)) > 1e-9) { s *= 10; decimals++; }
            return value.ToString("N" + decimals.ToString(CultureInfo.InvariantCulture), CultureInfo.CurrentCulture);
        }

        private static Style ReadStyle(object chart, Series series)
        {
            Style style = new Style();
            if (series.FontSize > 0) style.FontSize = (short)Math.Round(series.FontSize);
            if (chart == null) return style;
            Type type = chart.GetType();
            string fontName = Property<string>(type, chart, "WFontName");
            if (!string.IsNullOrEmpty(fontName)) style.FontName = fontName;
            object fontSize = Property<object>(type, chart, "FontSize");
            if (fontSize != null) { short size = Convert.ToInt16(fontSize); if (size > 0) style.FontSize = size; }
            object fontColor = Property<object>(type, chart, "FontColor");
            if (fontColor != null) style.FontColor = Convert.ToInt32(fontColor);
            object type1 = Property<object>(type, chart, "Type1Font");
            if (type1 is PDFFontType) style.Type1Font = (PDFFontType)type1;
            return style;
        }

        private static T Property<T>(Type type, object instance, string name) where T : class
        {
            PropertyInfo info = type.GetProperty(name);
            if (info == null) return null;
            try { return info.GetValue(instance, null) as T; } catch { return null; }
        }

        private static void Line(MetaPage page, int top, int left, int width, int height, ShapeType shape, PenType pen, int color)
        {
            Shape(page, top, left, width, height, shape, color, pen, color);
        }

        private static void Box(MetaPage page, int top, int left, int width, int height, int color)
        {
            Shape(page, top, left, width, height, ShapeType.Rectangle, color, PenType.Solid, color);
        }

        private static void Shape(MetaPage page, int top, int left, int width, int height, ShapeType shape, int brushColor, PenType pen, int penColor)
        {
            MetaObjectDraw obj = new MetaObjectDraw();
            obj.MetaType = MetaObjectType.Draw;
            obj.Top = top; obj.Left = left; obj.Width = width; obj.Height = height;
            obj.DrawStyle = shape;
            obj.BrushStyle = (int)(shape == ShapeType.HorzLine || shape == ShapeType.VertLine || shape == ShapeType.Oblique1 || shape == ShapeType.Oblique2 ? BrushType.Clear : BrushType.Solid);
            obj.BrushColor = brushColor;
            obj.PenStyle = (int)pen;
            obj.PenWidth = 0;
            obj.PenColor = penColor;
            page.Objects.Add(obj);
        }

        /// <summary>A straight segment between two points, with the only diagonals the metafile has: the two obliques of a box.</summary>
        private static void Segment(MetaPage page, int x1, int y1, int x2, int y2, int color)
        {
            if (x2 < x1) { int t = x1; x1 = x2; x2 = t; t = y1; y1 = y2; y2 = t; }
            int width = Math.Max(1, x2 - x1);
            if (y2 > y1)
                Line(page, y1, x1, width, y2 - y1, ShapeType.Oblique1, PenType.Solid, color);
            else if (y2 < y1)
                Line(page, y2, x1, width, y1 - y2, ShapeType.Oblique2, PenType.Solid, color);
            else
                Line(page, y1, x1, width, 1, ShapeType.HorzLine, PenType.Solid, color);
        }

        private static void Text(MetaPage page, int top, int left, int width, int height, string text, Style style, int alignment, bool wordWrap)
        {
            if (width <= 0 || height <= 0 || string.IsNullOrEmpty(text)) return;
            MetaObjectText obj = new MetaObjectText();
            obj.MetaType = MetaObjectType.Text;
            obj.Top = top; obj.Left = left; obj.Width = width; obj.Height = height;
            obj.TextP = page.AddString(text); obj.TextS = text.Length;
            obj.LFontNameP = page.AddString(style.FontName); obj.LFontNameS = style.FontName.Length;
            obj.WFontNameP = page.AddString(style.FontName); obj.WFontNameS = style.FontName.Length;
            obj.FontSize = style.FontSize;
            obj.FontColor = style.FontColor;
            obj.BackColor = WHITE;
            obj.Transparent = true;
            obj.CutText = true;
            obj.WordWrap = wordWrap;
            obj.Alignment = alignment;
            obj.Type1Font = style.Type1Font;
            obj.PrintStep = PrintStepType.BySize;
            page.Objects.Add(obj);
        }
    }
}
