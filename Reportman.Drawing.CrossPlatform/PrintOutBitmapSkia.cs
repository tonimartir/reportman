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
using System.IO;
using SkiaSharp;
using System.Drawing;
using Point = System.Drawing.Point;

namespace Reportman.Drawing.CrossPlatform
{
    /// <summary>
    /// A BITMAP DRIVER THAT RUNS ANYWHERE: paints the pages of a metafile into raster images with
    /// SkiaSharp — the same library the PDF driver already carries — so a preview or a printer
    /// emulator can produce a PNG on Linux, Windows or Android without GDI+.
    ///
    /// It is deliberately a straightforward painter: text is drawn with the platform typeface Skia
    /// resolves for the family name (fontconfig on Linux, DirectWrite/GDI on Windows), lines are
    /// placed with the alignment flags the metafile carries, shapes and images as they come. It
    /// does not shape complex scripts (that is the PDF driver's job) and it ignores the barcode
    /// object (only receipt drivers emit it). Good enough to SEE a document; not a substitute for
    /// the exact-metrics pipeline.
    /// </summary>
    public class PrintOutBitmapSkia : PrintOut, IDisposable
    {
        /// <summary>Resolution of the produced bitmaps, dots per inch.</summary>
        public int Dpi = 203;
        /// <summary>Background of the page.</summary>
        public SKColor Background = SKColors.White;
        /// <summary>The pages painted by the last <see cref="Print"/>, one PNG per page.</summary>
        public List<byte[]> Pages = new List<byte[]>();
        /// <summary>Optional file name to write the pages to; a page number is inserted before the extension when there is more than one.</summary>
        public string FileName = "";

        private SKBitmap bitmap;
        private SKCanvas canvas;
        private float scale;        // pixels per twip

        /// <summary>Twips → pixels at the driver resolution.</summary>
        private float Px(int twips) { return twips * scale; }

        public override void NewDocument(MetaFile meta)
        {
            Pages.Clear();
            scale = (float)Dpi / Twips.TWIPS_PER_INCH;
        }

        public override void NewPage(MetaFile meta, MetaPage page)
        {
            int w = page.PageDetail.PhysicWidth > 0 ? page.PageDetail.PhysicWidth : meta.CustomX;
            int h = page.PageDetail.PhysicHeight > 0 ? page.PageDetail.PhysicHeight : meta.CustomY;
            if (page.Orientation == OrientationType.Landscape) { int t = w; w = h; h = t; }
            int pw = Math.Max(1, (int)Math.Round(w * scale));
            int ph = Math.Max(1, (int)Math.Round(h * scale));
            bitmap = new SKBitmap(pw, ph, SKColorType.Rgba8888, SKAlphaType.Premul);
            canvas = new SKCanvas(bitmap);
            canvas.Clear(Background);
        }

        public override void EndPage(MetaFile meta)
        {
            if (bitmap == null) return;
            canvas.Flush();
            using (SKImage img = SKImage.FromBitmap(bitmap))
            using (SKData data = img.Encode(SKEncodedImageFormat.Png, 100))
                Pages.Add(data.ToArray());
            canvas.Dispose(); canvas = null;
            bitmap.Dispose(); bitmap = null;
        }

        public override void EndDocument(MetaFile meta)
        {
            if (FileName.Length == 0) return;
            if (Pages.Count == 1)
                File.WriteAllBytes(FileName, Pages[0]);
            else
                for (int i = 0; i < Pages.Count; i++)
                    File.WriteAllBytes(Path.ChangeExtension(FileName, null) + "-" + (i + 1).ToString() + Path.GetExtension(FileName), Pages[i]);
        }

        public override bool Print(MetaFile meta)
        {
            if (!base.Print(meta)) return false;
            int index = FromPage - 1;
            meta.RequestPage(index);
            while (meta.Pages.CurrentCount > index && index <= ToPage - 1)
            {
                MetaPage page = meta.Pages[index];
                NewPage(meta, page);
                DrawPage(meta, page);
                EndPage(meta);
                index++;
                meta.RequestPage(index);
            }
            EndDocument(meta);
            return true;
        }

        public override void DrawPage(MetaFile meta, MetaPage page)
        {
            for (int i = 0; i < page.Objects.Count; i++)
                DrawObject(meta, page, page.Objects[i]);
        }

        private static SKColor Color(int rgb)
        {
            System.Drawing.Color c = GraphicUtils.ColorFromInteger(rgb);
            return new SKColor(c.R, c.G, c.B);
        }

        private void DrawObject(MetaFile meta, MetaPage page, MetaObject obj)
        {
            switch (obj.MetaType)
            {
                case MetaObjectType.Text: DrawText(page, (MetaObjectText)obj); break;
                case MetaObjectType.Draw: DrawShape((MetaObjectDraw)obj); break;
                case MetaObjectType.Image: DrawImage(page, (MetaObjectImage)obj); break;
                default: break;     // polygons, export and barcode objects: not painted here
            }
        }

        private void DrawText(MetaPage page, MetaObjectText obj)
        {
            string text = page.GetText(obj);
            if (text.Length == 0) return;
            string family = page.GetWFontNameText(obj);
            bool bold = GraphicUtils.FontStyleIsBold(obj.FontStyle);
            bool italic = GraphicUtils.FontStyleIsItalic(obj.FontStyle);
            bool underline = GraphicUtils.FontStyleIsUnderline(obj.FontStyle);
            using (SKTypeface face = SKTypeface.FromFamilyName(family,
                       bold ? SKFontStyleWeight.Bold : SKFontStyleWeight.Normal,
                       SKFontStyleWidth.Normal,
                       italic ? SKFontStyleSlant.Italic : SKFontStyleSlant.Upright)
                   ?? SKTypeface.Default)
            using (SKFont font = new SKFont(face, obj.FontSize * Dpi / 72f))
            using (SKPaint paint = new SKPaint { Color = Color(obj.FontColor), IsAntialias = true })
            {
                float left = Px(obj.Left), top = Px(obj.Top), width = Px(obj.Width), height = Px(obj.Height);
                if (!obj.Transparent)
                    using (SKPaint back = new SKPaint { Color = Color(obj.BackColor) })
                        canvas.DrawRect(left, top, width, height, back);

                SKFontMetrics m;
                font.GetFontMetrics(out m);
                float lineHeight = m.Descent - m.Ascent + m.Leading;
                string[] lines = SplitLines(text, font, width, obj.WordWrap && (obj.Alignment & MetaFile.AlignmentFlags_SingleLine) == 0);

                float blockHeight = lineHeight * lines.Length;
                float y = top;
                if ((obj.Alignment & MetaFile.AlignmentFlags_AlignVCenter) != 0) y = top + (height - blockHeight) / 2;
                else if ((obj.Alignment & MetaFile.AlignmentFlags_AlignBottom) != 0) y = top + height - blockHeight;

                canvas.Save();
                if (obj.CutText) canvas.ClipRect(new SKRect(left, top, left + width, top + height));
                foreach (string line in lines)
                {
                    float w = font.MeasureText(line);
                    float x = left;
                    if ((obj.Alignment & MetaFile.AlignmentFlags_AlignRight) != 0) x = left + width - w;
                    else if ((obj.Alignment & MetaFile.AlignmentFlags_AlignHCenter) != 0) x = left + (width - w) / 2;
                    float baseline = y - m.Ascent;
                    canvas.DrawText(line, x, baseline, SKTextAlign.Left, font, paint);
                    if (underline)
                        canvas.DrawLine(x, baseline + m.UnderlinePosition.GetValueOrDefault(font.Size * 0.1f),
                            x + w, baseline + m.UnderlinePosition.GetValueOrDefault(font.Size * 0.1f), paint);
                    y += lineHeight;
                }
                canvas.Restore();
            }
        }

        private static string[] SplitLines(string text, SKFont font, float width, bool wrap)
        {
            string[] hard = text.Replace("\r\n", "\n").Replace('\r', '\n').Split('\n');
            if (!wrap || width <= 0) return hard;
            List<string> result = new List<string>();
            foreach (string paragraph in hard)
            {
                string current = "";
                foreach (string word in paragraph.Split(' '))
                {
                    string candidate = current.Length == 0 ? word : current + " " + word;
                    if (font.MeasureText(candidate) <= width || current.Length == 0)
                        current = candidate;
                    else
                    {
                        result.Add(current);
                        current = word;
                    }
                }
                result.Add(current);
            }
            return result.ToArray();
        }

        private void DrawShape(MetaObjectDraw obj)
        {
            float left = Px(obj.Left), top = Px(obj.Top), width = Px(obj.Width), height = Px(obj.Height);
            SKRect r = new SKRect(left, top, left + width, top + height);
            bool fill = obj.BrushStyle != (int)BrushType.Clear;
            bool stroke = obj.PenStyle != (int)PenType.Clear;
            using (SKPaint brush = new SKPaint { Color = Color(obj.BrushColor), Style = SKPaintStyle.Fill, IsAntialias = false })
            using (SKPaint pen = new SKPaint
            {
                Color = Color(obj.PenColor), Style = SKPaintStyle.Stroke, IsAntialias = true,
                StrokeWidth = Math.Max(1f, Px(obj.PenWidth)),
            })
            {
                if (obj.PenStyle == (int)PenType.Dash) pen.PathEffect = SKPathEffect.CreateDash(new float[] { 6, 3 }, 0);
                else if (obj.PenStyle == (int)PenType.Dot) pen.PathEffect = SKPathEffect.CreateDash(new float[] { 2, 2 }, 0);
                switch (obj.DrawStyle)
                {
                    case ShapeType.Rectangle:
                    case ShapeType.Square:
                        if (fill) canvas.DrawRect(r, brush);
                        if (stroke) canvas.DrawRect(r, pen);
                        break;
                    case ShapeType.RoundRect:
                    case ShapeType.RoundSquare:
                        if (fill) canvas.DrawRoundRect(r, 4, 4, brush);
                        if (stroke) canvas.DrawRoundRect(r, 4, 4, pen);
                        break;
                    case ShapeType.Ellipse:
                    case ShapeType.Circle:
                        if (fill) canvas.DrawOval(r, brush);
                        if (stroke) canvas.DrawOval(r, pen);
                        break;
                    case ShapeType.HorzLine:
                        canvas.DrawLine(left, top, left + width, top, pen);
                        break;
                    case ShapeType.VertLine:
                        canvas.DrawLine(left, top, left, top + height, pen);
                        break;
                    case ShapeType.Oblique1:
                        canvas.DrawLine(left, top, left + width, top + height, pen);
                        break;
                    case ShapeType.Oblique2:
                        canvas.DrawLine(left, top + height, left + width, top, pen);
                        break;
                }
            }
        }

        private void DrawImage(MetaPage page, MetaObjectImage obj)
        {
            if (obj.PreviewOnly && !Previewing) return;
            MemoryStream stream = page.GetStream(obj);
            if (stream == null) return;
            stream.Position = 0;
            using (SKBitmap img = SKBitmap.Decode(stream))
            {
                if (img == null) return;
                float left = Px(obj.Left), top = Px(obj.Top), width = Px(obj.Width), height = Px(obj.Height);
                SKRect dest;
                switch (obj.DrawImageStyle)
                {
                    case ImageDrawStyleType.Stretch:
                        dest = new SKRect(left, top, left + width, top + height);
                        break;
                    case ImageDrawStyleType.Full:
                    {
                        // Keep the aspect ratio inside the box.
                        float k = Math.Min(width / img.Width, height / img.Height);
                        dest = new SKRect(left, top, left + img.Width * k, top + img.Height * k);
                        break;
                    }
                    default:
                    {
                        // Crop: at the image's own resolution.
                        int dpi = obj.DPIRes > 0 ? obj.DPIRes : 96;
                        float k = (float)Dpi / dpi;
                        dest = new SKRect(left, top, left + img.Width * k, top + img.Height * k);
                        canvas.Save();
                        canvas.ClipRect(new SKRect(left, top, left + width, top + height));
                        canvas.DrawBitmap(img, dest);
                        canvas.Restore();
                        return;
                    }
                }
                canvas.DrawBitmap(img, dest);
            }
        }

        public override Point GetPageSize(out int indexqt)
        {
            indexqt = 0;
            return new Point(12047, 17039);
        }

        public override Point GraphicExtent(MemoryStream astream, Point extent, int dpi)
        {
            astream.Position = 0;
            using (SKBitmap img = SKBitmap.Decode(astream))
            {
                if (img == null) return extent;
                int d = dpi > 0 ? dpi : 96;
                return new Point((int)Math.Round((double)img.Width / d * Twips.TWIPS_PER_INCH),
                    (int)Math.Round((double)img.Height / d * Twips.TWIPS_PER_INCH));
            }
        }


        public override Point SetPageSize(PageSizeDetail psize)
        {
            if (psize.Custom) return new Point(psize.CustomWidth, psize.CustomHeight);
            return new Point(psize.PhysicWidth > 0 ? psize.PhysicWidth : 12047, psize.PhysicHeight > 0 ? psize.PhysicHeight : 17039);
        }

        public override Point TextExtent(TextObjectStruct aobj, Point extent)
        {
            using (SKTypeface face = SKTypeface.FromFamilyName(aobj.WFontName) ?? SKTypeface.Default)
            using (SKFont font = new SKFont(face, aobj.FontSize * Dpi / 72f))
            {
                float w = font.MeasureText(aobj.Text ?? "");
                SKFontMetrics m;
                font.GetFontMetrics(out m);
                float s = (float)Dpi / Twips.TWIPS_PER_INCH;
                return new Point((int)Math.Round(w / s), (int)Math.Round((m.Descent - m.Ascent) / s));
            }
        }
        public override void Dispose()
        {
            canvas?.Dispose(); canvas = null;
            bitmap?.Dispose(); bitmap = null;
        }
    }
}
