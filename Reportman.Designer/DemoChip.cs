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
 *  Copyright (c) 1994 - 2026 Toni Martir (toni@reportman.es)
 *  All Rights Reserved.
*/
#endregion

using System;
using System.Drawing;
using System.Drawing.Drawing2D;
using System.Windows.Forms;

namespace Reportman.Designer
{
    /// <summary>
    /// The «DEMO» chip after the name of an example database of the Hub (<see cref="HubSchema.IsExample"/>) in the
    /// owner-drawn lists, as Reportman.Web marks them: bold, a little smaller, orange on light orange, rounded. The
    /// lists that cannot draw it (a property grid, a menu) say it in the text with <see cref="TextSuffix"/>.
    /// </summary>
    internal static class DemoChip
    {
        /// <summary>The text of the chip; not translated, as in Reportman.Web.</summary>
        public const string Text = "DEMO";

        /// <summary>What goes after the name where the chip cannot be drawn.</summary>
        public const string TextSuffix = " (DEMO)";

        /// <summary>The text color of the chip (#FF9800, the one of Reportman.Web).</summary>
        public static readonly Color ForeColor = Color.FromArgb(0xFF, 0x98, 0x00);

        /// <summary>The background of the chip: #FF9800 at 13 % on white, as #ff980022 of Reportman.Web.</summary>
        public static readonly Color BackColor = Color.FromArgb(0xFF, 0xF1, 0xDD);

        private const TextFormatFlags ChipFlags = TextFormatFlags.NoPadding | TextFormatFlags.SingleLine |
            TextFormatFlags.NoPrefix | TextFormatFlags.HorizontalCenter | TextFormatFlags.VerticalCenter;

        /// <summary>
        /// The text that explains the chip (its tooltip, the note of the connection assistant): the example
        /// connections are read-only and are there to try Reportman AI without signing in.
        /// </summary>
        public static string Hint
        {
            get
            {
                return DesignerText.Tr(2056, "Example connection, read-only: it is there to try Reportman AI " +
                    "without signing in. Its schema cannot be changed.");
            }
        }

        /// <summary>The font of the chip for the font of the list (the caller disposes it).</summary>
        public static Font CreateFont(Font font)
        {
            return new Font(font.FontFamily, Math.Max(6f, font.SizeInPoints * 0.8f), FontStyle.Bold, GraphicsUnit.Point);
        }

        /// <summary>The width the chip takes after a name, with the gap before it.</summary>
        public static int Slot(Font font)
        {
            using (Font chipFont = CreateFont(font))
            {
                Size size = TextRenderer.MeasureText(Text, chipFont, Size.Empty, ChipFlags);
                return Gap(font) + size.Width + 2 * HorizontalPadding(font);
            }
        }

        /// <summary>
        /// Draws the chip after a name that ends at <paramref name="left"/> (the gap goes first), centered in the
        /// height of <paramref name="bounds"/> and cut at its right.
        /// </summary>
        public static void Draw(Graphics graphics, Font font, int left, Rectangle bounds)
        {
            using (Font chipFont = CreateFont(font))
            {
                Size textSize = TextRenderer.MeasureText(graphics, Text, chipFont, Size.Empty, ChipFlags);
                int height = Math.Max(1, Math.Min(bounds.Height - 2, textSize.Height + 2));
                var chip = new Rectangle(left + Gap(font), bounds.Top + (bounds.Height - height) / 2,
                    textSize.Width + 2 * HorizontalPadding(font), height);
                if (chip.Left >= bounds.Right)
                    return;
                if (chip.Right > bounds.Right)
                    chip.Width = bounds.Right - chip.Left;
                SmoothingMode smoothing = graphics.SmoothingMode;
                graphics.SmoothingMode = SmoothingMode.AntiAlias;
                try
                {
                    using (GraphicsPath path = RoundedRectangle(chip, Math.Max(2, font.Height / 4)))
                    using (var brush = new SolidBrush(BackColor))
                        graphics.FillPath(brush, path);
                }
                finally
                {
                    graphics.SmoothingMode = smoothing;
                }
                TextRenderer.DrawText(graphics, Text, chipFont, chip, ForeColor, ChipFlags);
            }
        }

        private static int Gap(Font font)
        {
            return Math.Max(4, font.Height / 3);
        }

        private static int HorizontalPadding(Font font)
        {
            return Math.Max(4, font.Height / 3);
        }

        private static GraphicsPath RoundedRectangle(Rectangle rect, int radius)
        {
            int diameter = Math.Min(2 * radius, Math.Min(rect.Width, rect.Height));
            var path = new GraphicsPath();
            if (diameter <= 1)
            {
                path.AddRectangle(rect);
                return path;
            }
            path.AddArc(rect.Left, rect.Top, diameter, diameter, 180, 90);
            path.AddArc(rect.Right - diameter, rect.Top, diameter, diameter, 270, 90);
            path.AddArc(rect.Right - diameter, rect.Bottom - diameter, diameter, diameter, 0, 90);
            path.AddArc(rect.Left, rect.Bottom - diameter, diameter, diameter, 90, 90);
            path.CloseFigure();
            return path;
        }
    }
}
