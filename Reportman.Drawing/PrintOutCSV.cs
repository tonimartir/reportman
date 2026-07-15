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

using System;
using System.Collections.Generic;
using System.Text;

namespace Reportman.Drawing
{
    /// <summary>
    /// Report preocessing driver, capable of generate csv files
    /// </summary>
	public static class PrintOutCSV
    {
        /// <summary>
        /// Exports the specified pages of a <see cref="MetaFile"/> into a CSV string using default precision.
        /// </summary>
        /// <param name="nmeta">The <see cref="MetaFile"/> to export.</param>
        /// <param name="allpages">A value indicating whether to export all pages, ignoring the page range limits.</param>
        /// <param name="frompage">The starting 1-based page index to export (inclusive).</param>
        /// <param name="topage">The ending 1-based page index to export (inclusive).</param>
        /// <param name="separator">The field separator string (e.g. comma or semicolon).</param>
        /// <param name="delimiter">The text qualifier character (e.g. double quotes).</param>
        /// <returns>A CSV formatted string containing the text content of the pages.</returns>
        public static string ExportToCSV(MetaFile nmeta,
             bool allpages, int frompage, int topage, string separator, char delimiter)
        {
            return ExportToCSV(nmeta, allpages, frompage, topage, separator, delimiter, 10);
        }
        /// <summary>
        /// Exports the specified pages of a <see cref="MetaFile"/> into a CSV string using a custom precision.
        /// </summary>
        /// <param name="nmeta">The <see cref="MetaFile"/> to export.</param>
        /// <param name="allpages">A value indicating whether to export all pages, ignoring the page range limits.</param>
        /// <param name="frompage">The starting 1-based page index to export (inclusive).</param>
        /// <param name="topage">The ending 1-based page index to export (inclusive).</param>
        /// <param name="separator">The field separator string (e.g. comma or semicolon).</param>
        /// <param name="delimiter">The text qualifier character (e.g. double quotes).</param>
        /// <param name="precision">The horizontal alignment grid precision factor (greater values group elements into columns more broadly).</param>
        /// <returns>A CSV formatted string containing the text content of the pages.</returns>
        public static string ExportToCSV(MetaFile nmeta,
             bool allpages, int frompage, int topage, string separator, char delimiter, int precision)
        {
            int j, k;
            string[,] pmatrix;
            MetaPage apage;
            SortedList<string, int> columns = new();
            SortedList<string, int> rows = new();
            StringBuilder nbuilder = new();
            int index;
            string topstring;
            string leftstring;

            if (allpages)
            {
                nmeta.RequestPage(MetaFile.MAX_NUMBER_PAGES);
                frompage = 0;
                topage = nmeta.Pages.CurrentCount - 1;
            }
            else
            {
                frompage = frompage - 1;
                topage = topage - 1;
                nmeta.RequestPage(topage);
                if (topage > nmeta.Pages.CurrentCount - 1)
                    topage = nmeta.Pages.Count - 1;
            }
            // First distribute in columns
            columns.Clear();
            for (int i = frompage; i <= topage; i++)
            {
                apage = nmeta.Pages[i];
                for (j = 0; j < apage.Objects.Count; j++)
                {
                    MetaObject nobject = apage.Objects[j];
                    leftstring = (nobject.Left / precision).ToString("0000000000");
                    index = columns.IndexOfKey(leftstring);
                    if (index < 0)
                        columns.Add(leftstring, 1);
                    else
                        columns[leftstring] = columns[leftstring] + 1;
                }
            }

            // Distribute in rows and columns
            for (int i = frompage; i <= topage; i++)
            {
                apage = nmeta.Pages[i];
                rows.Clear();
                for (j = 0; j < apage.Objects.Count; j++)
                {
                    MetaObject nobject = apage.Objects[j];
                    if (nobject.MetaType == MetaObjectType.Text)
                    {
                        topstring = (nobject.Top / precision).ToString("0000000000");
                        index = rows.IndexOfKey(topstring);
                        if (index < 0)
                            rows.Add(topstring, 1);
                        else
                            rows[topstring] = rows[topstring] + 1;
                    }
                }
                TextFormat[,] fmatrix = null;
                pmatrix = new string[rows.Count, columns.Count];
                for (j = 0; j < apage.Objects.Count; j++)
                {
                    MetaObject nobject = apage.Objects[j];
                    PrintObject(pmatrix, apage, nobject,
                       precision, rows, columns, ref fmatrix);
                }
                for (j = 0; j < rows.Count; j++)
                {
                    for (k = 0; k < columns.Count; k++)
                    {
                        if (k != 0)
                            nbuilder.Append(separator);
                        string nvalue = pmatrix[j, k];
                        if (nvalue == null)
                            nvalue = "";
                        nbuilder.Append(StringUtil.CustomQuoteStr(nvalue, delimiter));
                    }
                    nbuilder.Append(System.Environment.NewLine);
                }
                // Page separator is new line
                nbuilder.Append(System.Environment.NewLine);
            }
            return nbuilder.ToString();
        }
        /// <summary>
        /// Captures the visual formatting (alignment, font size, family, style flags, and
        /// color) of a text cell when exporting a metafile to a tabular array.
        /// </summary>
        public class TextFormat
        {
            /// <summary>
            /// Horizontal alignment of a text cell: left, right, or centered.
            /// </summary>
            public enum AlignmentType
            {
                /// <summary>
                /// Left aligned text.
                /// </summary>
                Left,
                /// <summary>
                /// Right aligned text.
                /// </summary>
                Right,
                /// <summary>
                /// Centered text.
                /// </summary>
                Center
            };
            /// <summary>
            /// Gets or sets the horizontal alignment of the text cell.
            /// </summary>
            public AlignmentType Alignment;
            /// <summary>
            /// Gets or sets the font size of the text cell in points.
            /// </summary>
            public float FontSize;
            /// <summary>
            /// Gets or sets the font family name of the text cell.
            /// </summary>
            public string FamilyName;
            /// <summary>
            /// Bit flags describing font styling: bold, underline, italic, and strikethrough.
            /// </summary>
            [Flags]
            public enum FontStyle
            {
                /// <summary>
                /// Bold font style.
                /// </summary>
                Bold = 1,
                /// <summary>
                /// Underlined font style.
                /// </summary>
                Underline = 2,
                /// <summary>
                /// Italicized font style.
                /// </summary>
                Italic = 4,
                /// <summary>
                /// Struck-through font style.
                /// </summary>
                Strikethrough = 8
            };
            /// <summary>
            /// Gets or sets the font style flags (such as Bold, Italic, Underline) for the text cell.
            /// </summary>
            public FontStyle Style;
            /// <summary>
            /// Gets or sets the integer ARGB/color representation of the text cell's font.
            /// </summary>
            public int FontColor;
        }
        /// <summary>
        /// Exports the specified pages of a <see cref="MetaFile"/> to a tabular grid structure represented as list of lists, capturing optional text formatting metrics.
        /// </summary>
        /// <param name="nmeta">The <see cref="MetaFile"/> to export.</param>
        /// <param name="allpages">A value indicating whether to export all pages, ignoring the page range limits.</param>
        /// <param name="frompage">The starting 1-based page index to export (inclusive).</param>
        /// <param name="topage">The ending 1-based page index to export (inclusive).</param>
        /// <param name="precision">The horizontal alignment grid precision factor.</param>
        /// <param name="formats">An optional list structure to receive style format information matching each exported cell.</param>
        /// <returns>A list of list rows containing cell values.</returns>
        public static List<IList<object>> ExportToArray(MetaFile nmeta,
             bool allpages, int frompage, int topage, int precision, List<List<TextFormat>> formats)
        {
            List<IList<object>> nresult = new();
            int j, k;
            string[,] pmatrix;
            TextFormat[,] fmatrix = null;
            MetaPage apage;
            SortedList<string, int> columns = new();
            SortedList<string, int> rows = new();
            int index;
            string topstring;
            string leftstring;

            if (allpages)
            {
                nmeta.RequestPage(MetaFile.MAX_NUMBER_PAGES);
                frompage = 0;
                topage = nmeta.Pages.CurrentCount - 1;
            }
            else
            {
                frompage = frompage - 1;
                topage = topage - 1;
                nmeta.RequestPage(topage);
                if (topage > nmeta.Pages.CurrentCount - 1)
                    topage = nmeta.Pages.Count - 1;
            }
            // First distribute in columns
            columns.Clear();
            for (int i = frompage; i <= topage; i++)
            {
                apage = nmeta.Pages[i];
                for (j = 0; j < apage.Objects.Count; j++)
                {
                    MetaObject nobject = apage.Objects[j];
                    leftstring = (nobject.Left / precision).ToString("0000000000");
                    index = columns.IndexOfKey(leftstring);
                    if (index < 0)
                        columns.Add(leftstring, 1);
                    else
                        columns[leftstring] = columns[leftstring] + 1;
                }
            }

            // Distribute in rows and columns
            for (int i = frompage; i <= topage; i++)
            {
                apage = nmeta.Pages[i];
                rows.Clear();
                for (j = 0; j < apage.Objects.Count; j++)
                {
                    MetaObject nobject = apage.Objects[j];
                    if (nobject.MetaType == MetaObjectType.Text)
                    {
                        topstring = (nobject.Top / precision).ToString("0000000000");
                        index = rows.IndexOfKey(topstring);
                        if (index < 0)
                            rows.Add(topstring, 1);
                        else
                            rows[topstring] = rows[topstring] + 1;
                    }
                }
                pmatrix = new string[rows.Count, columns.Count];
                if (formats != null)
                {
                    fmatrix = new TextFormat[rows.Count, columns.Count];
                }
                for (j = 0; j < apage.Objects.Count; j++)
                {
                    MetaObject nobject = apage.Objects[j];
                    PrintObject(pmatrix, apage, nobject,
                       precision, rows, columns, ref fmatrix);
                }
                for (j = 0; j < rows.Count; j++)
                {
                    List<object> Values = new();
                    List<TextFormat> NewFormats = null;
                    if (formats != null)
                    {
                        NewFormats = new List<TextFormat>();
                    }
                    for (k = 0; k < columns.Count; k++)
                    {
                        Values.Add(pmatrix[j, k]);
                        if (formats != null)
                        {
                            NewFormats.Add(fmatrix[j, k]);
                        }
                    }
                    nresult.Add(Values);
                    if (formats != null)
                    {
                        formats.Add(NewFormats);
                    }
                }
            }
            return nresult;
        }

        static void PrintObject(string[,] pmatrix, MetaPage page, MetaObject obj, int precision, SortedList<string, int> rows,
         SortedList<string, int> columns, ref TextFormat[,] fmatrix)
        {
            string topstring = (obj.Top / precision).ToString("0000000000");
            string leftstring = (obj.Left / precision).ToString("0000000000");
            int arow = rows.IndexOfKey(topstring);
            int acolumn = columns.IndexOfKey(leftstring);
            switch (obj.MetaType)
            {
                case MetaObjectType.Text:
                    MetaObjectText otext = (MetaObjectText)obj;
                    pmatrix[arow, acolumn] = page.GetText(otext);
                    if (fmatrix != null)
                    {
                        TextFormat ntextformat = new();
                        ntextformat.FontColor = otext.FontColor;
                        ntextformat.FontSize = otext.FontSize;
                        ntextformat.FamilyName = page.GetWFontNameText(otext);

                        if ((otext.Alignment & MetaFile.AlignmentFlags_AlignHCenter) > 0)
                        {
                            ntextformat.Alignment = ntextformat.Alignment = TextFormat.AlignmentType.Center;
                        }
                        else
                            if ((otext.Alignment & MetaFile.AlignmentFlags_AlignRight) > 0)
                            {
                                ntextformat.Alignment = TextFormat.AlignmentType.Right;
                            }
                            else
                                ntextformat.Alignment = TextFormat.AlignmentType.Left;
                        int intfontstyle = otext.FontStyle;
                        if ((intfontstyle & 1) > 0)
                            ntextformat.Style = ntextformat.Style | TextFormat.FontStyle.Bold;
                        if ((intfontstyle & 2) > 0)
                            ntextformat.Style = ntextformat.Style | TextFormat.FontStyle.Italic;
                        if ((intfontstyle & 4) > 0)
                            ntextformat.Style = ntextformat.Style | TextFormat.FontStyle.Underline;
                        if ((intfontstyle & 8) > 0)
                            ntextformat.Style = ntextformat.Style | TextFormat.FontStyle.Strikethrough;
                        fmatrix[arow, acolumn] = ntextformat;
                    }
                    break;
                default:
                    break;
            }

        }
    }
}
