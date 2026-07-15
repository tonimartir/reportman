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
    /// A report print item that draws a geometric shape (rectangle, ellipse, line, etc.) with a
    /// configurable pen and brush, optionally deriving the fill color from an evaluated expression.
    /// </summary>
    public class ShapeItem : PrintPosItem
    {
        private const int DEF_DRAWWIDTH = 500;
        /// <summary>
        /// Gets or sets the style of the brush used to fill the shape.
        /// </summary>
        public BrushType BrushStyle { get; set; }
        /// <summary>
        /// Gets or sets the color of the brush used to fill the shape.
        /// </summary>
        public int BrushColor { get; set; }
        /// <summary>
        /// Gets or sets the pen style used to draw the outline of the shape.
        /// </summary>
        public PenType PenStyle { get; set; }
        /// <summary>
        /// Gets or sets the color of the shape.
        /// </summary>
        public int Color { get; set; }
        /// <summary>
        /// Gets or sets the geometric shape type to be drawn.
        /// </summary>
        public ShapeType Shape { get; set; }
        /// <summary>
        /// Gets or sets the width of the pen.
        /// </summary>
        public int PenWidth { get; set; }
        /// <summary>
        /// Gets or sets the color of the pen.
        /// </summary>
        public int PenColor { get; set; }
        /// <summary>
        /// Gets or sets the expression used to dynamically evaluate the brush color.
        /// </summary>
        public string BrushColorExpression { get; set; }
        /// <summary>
        /// Initializes a new instance of the <see cref="ShapeItem"/> class, initializing the brush color, dimensions, and brush color expression with default values.
        /// </summary>
        public ShapeItem()
            : base()
        {
            BrushColor = 0xFFFFFF;
            Height = DEF_DRAWWIDTH;
            Width = Height;
            BrushColorExpression = "";
        }
        /// <summary>
        /// Gets the class name of the shape item.
        /// </summary>
        /// <returns>A string representing the class name.</returns>
        protected override string GetClassName()
        {
            return "TRPSHAPE";
        }
        /// <summary>
        /// Performs the drawing action of the shape item onto the metafile pages using the given driver and dimensions.
        /// </summary>
        /// <param name="adriver">The output print driver.</param>
        /// <param name="aposx">The X coordinate position to print.</param>
        /// <param name="aposy">The Y coordinate position to print.</param>
        /// <param name="newwidth">The new width of the shape item.</param>
        /// <param name="newheight">The new height of the shape item.</param>
        /// <param name="metafile">The metafile containing the print objects.</param>
        /// <param name="MaxExtent">The maximum allowed size boundaries.</param>
        /// <param name="PartialPrint">A reference boolean indicating if the print was partial.</param>
        override protected void DoPrint(PrintOut adriver, int aposx, int aposy,
            int newwidth, int newheight, MetaFile metafile, Point MaxExtent,
            ref bool PartialPrint)
        {
            base.DoPrint(adriver, aposx, aposy, newwidth, newheight,
                metafile, MaxExtent, ref PartialPrint);
            var apage = metafile.Pages[metafile.CurrentPage];
            MetaObjectDraw metaobj = new MetaObjectDraw();
            FillAnnotation(metaobj, apage);

            metaobj.MetaType = MetaObjectType.Draw;
            metaobj.Top = aposy; metaobj.Left = aposx;
            metaobj.Width = PrintWidth; metaobj.Height = PrintHeight;
            metaobj.DrawStyle = Shape;
            metaobj.BrushStyle = (int)BrushStyle;
            metaobj.PenStyle = (int)PenStyle;
            metaobj.PenWidth = PenWidth;
            metaobj.PenColor = PenColor;
            if (BrushColorExpression.Length > 0)
            {
                try
                {
                    metaobj.BrushColor = Report.Evaluator.EvaluateText(BrushColorExpression);
                }
                catch
                {
                    metaobj.BrushColor = BrushColor;
                }
            }
            else
                metaobj.BrushColor = BrushColor;
            apage.Objects.Add(metaobj);
        }
        /// <summary>
        /// Calculates the layout extension size of the shape item based on the print driver boundaries.
        /// </summary>
        /// <param name="adriver">The output print driver.</param>
        /// <param name="MaxExtent">The maximum allowed extension size.</param>
        /// <param name="ForcePartial">A boolean indicating whether to force partial printing.</param>
        /// <returns>A <see cref="Point"/> containing the calculated width and height extension.</returns>
        override public Point GetExtension(PrintOut adriver, Point MaxExtent, bool ForcePartial)
        {
            Point aresult = base.GetExtension(adriver, MaxExtent, ForcePartial);
            if (Shape == ShapeType.HorzLine)
            {
                aresult.Y = PenWidth;
            }
            LastExtent = aresult;
            return aresult;
        }
    }
}
