using Reportman.Drawing;
using System;
using System.ComponentModel;
using System.Drawing;
using System.IO;

namespace Reportman.Reporting
{
    /// <summary>
    /// A positioned report item that prints an image, taken either from an embedded stream or from
    /// an expression, honoring the draw style, resolution, rotation and image-sharing settings.
    /// </summary>
    public class ImageItem : PrintPosItem, IDisposable
    {
        private const int DEF_DRAWWIDTH = 500;
        private const int DEFAULT_DPI = 100;
        private MemoryStream FStream;
#if REPMAN_ZLIB
        private MemoryStream FDecompStream;
#endif
        /// <summary>
        /// Gets or sets the draw style used to fit the image within the item bounds
        /// (crop, tile, stretch and so on).
        /// </summary>
        public ImageDrawStyleType DrawStyle { get; set; }
        private long OldStreamPos;
        private MemoryStream FOldStream;
        /// <summary>
        /// Gets or sets the image resolution, in dots per inch, used when rendering the image.
        /// </summary>
        public int dpires { get; set; }
        /// <summary>
        /// Gets or sets the raster copy mode applied when the image is drawn.
        /// </summary>
        public int CopyMode { get; set; }
        /// <summary>
        /// Gets or sets the rotation angle applied to the image.
        /// </summary>
        public short Rotation { get; set; }
        /// <summary>
        /// Gets or sets the expression that, when not empty, is evaluated at print time
        /// to obtain the image stream instead of using the embedded stream.
        /// </summary>
        public string Expression { get; set; }
        /// <summary>
        /// Gets or sets how the image stream is shared between metafile objects to avoid
        /// duplicating identical image data.
        /// </summary>
        public SharedImageType SharedImage { get; set; }
        /// <summary>
        /// Releases the memory streams held by this item and disposes the base item.
        /// </summary>
        override public void Dispose()
        {
            base.Dispose();
#if REPMAN_DOTNET1
#else
            if (FStream != null)
            {
                FStream.Dispose();
                FStream = null;
            }
#if REPMAN_ZLIB
            if (FDecompStream != null)
            {
                FDecompStream.Dispose();
                FDecompStream = null;
            }
#endif
#endif
        }
        /// <summary>
        /// Initializes a new image item with the default resolution and size and an empty embedded stream.
        /// </summary>
        public ImageItem()
            : base()
        {
#if REPMAN_ZLIB
            FDecompStream = new MemoryStream();
#endif
            dpires = DEFAULT_DPI;
            Height = DEF_DRAWWIDTH;
            Width = Height;
            Expression = "";
            SharedImage = SharedImageType.None;

            FStream = new MemoryStream();
        }
        /// <summary>
        /// Returns the report class identifier used when serializing this item.
        /// </summary>
        protected override string GetClassName()
        {
            return "TRPIMAGE";
        }
        /// <summary>
        /// Gets the memory stream that holds the embedded image data.
        /// </summary>
        [Browsable(false)]
        [System.Text.Json.Serialization.JsonIgnore]
        [Newtonsoft.Json.JsonIgnore]
        public MemoryStream Stream
        {
            get { return FStream; }
            private set { FStream = value; }
        }
        /// <summary>
        /// Gets or sets the embedded image stream encoded as a Base64 string.
        /// </summary>
        public string StreamBase64
        {
            get { return Convert.ToBase64String(Stream.ToArray()); }
            set { FStream = new MemoryStream(Convert.FromBase64String(value)); }
        }
        /// <summary>
        /// Gets a value indicating whether an embedded image stream is present;
        /// setting it to false clears the embedded stream.
        /// </summary>
        public bool HasEmbeddedImageStream
        {
            get { return FStream != null && FStream.Length > 0; }
            set
            {
                if (!value)
                {
                    ClearEmbeddedImageStream();
                }
            }
        }
        /// <summary>
        /// Gets the size, in bytes, of the embedded image stream, or zero when none is present.
        /// </summary>
        public long EmbeddedImageByteCount
        {
            get { return FStream?.Length ?? 0; }
        }

        private void ClearEmbeddedImageStream()
        {
            if (FStream != null)
            {
                FStream.Dispose();
            }

            FStream = new MemoryStream();
            OldStreamPos = -1;
            FOldStream = null;
        }

        /// <summary>
        /// Handles subreport state changes, resetting the cached shared-image stream when a new subreport starts.
        /// </summary>
        public override void SubReportChanged(SubReportEvent newstate, string newgroup)
        {
            base.SubReportChanged(newstate, newgroup);
            if (newstate == SubReportEvent.Start)
            {
                OldStreamPos = -1;
                FOldStream = null;
            }
        }
        /// <summary>
        /// Returns the memory stream with the embedded image data, decompressing it when required,
        /// or null when no image is embedded.
        /// </summary>
        public MemoryStream GetMemoryStream()
        {
            MemoryStream aresult = null;
            if (FStream.Length > 0)
            {
#if REPMAN_ZLIB
                if (FDecompStream != null)
                    aresult = FDecompStream;
                else
#endif
                {
                    FStream.Seek(0, SeekOrigin.Begin);
                    if (StreamUtil.IsCompressed(FStream))
                    {
#if REPMAN_ZLIB
                        FStream.Seek(0, SeekOrigin.Begin);
                        StreamUtil.DeCompressStream(FStream, FDecompStream);
                        aresult = FDecompStream;
#else
	    					throw new UnNamedException("REPMAN_ZLIB not defined compressed streams not supported");
#endif
                    }
                    else
                        aresult = FStream;
                }
            }
            return aresult;
        }
        /// <summary>
        /// Returns the image stream to print, either evaluated from the expression or taken from the
        /// embedded stream, tracking the previous stream so shared images can be reused.
        /// </summary>
        public MemoryStream GetStream()
        {
            MemoryStream aresult = null;
            if (Expression.Length > 0)
            {
                aresult = Report.Evaluator.GetStreamFromExpression(Expression);
                if (aresult != null)
                {
                    if (FOldStream != null)
                    {
                        if (FOldStream.Length == aresult.Length)
                        {
                            if (SharedImage == SharedImageType.Variable)
                            {
                                byte[] sx = FOldStream.ToArray();
                                byte[] sy = aresult.ToArray();
                                for (int i = 0; i < FOldStream.Length; i++)
                                {
                                    if (sx[i] != sy[i])
                                    {
                                        OldStreamPos = -1;
                                        break;
                                    }
                                }
                            }
                            else
                                OldStreamPos = -1;
                        }
                        else
                            OldStreamPos = -1;
                    }
                }
            }
            else
            {
                if (FStream.Length > 0)
                {
                    if (FOldStream != null)
                        aresult = FOldStream;
                    else
                    {
                        FStream.Seek(0, SeekOrigin.Begin);
                        if (StreamUtil.IsCompressed(FStream))
                        {
#if REPMAN_ZLIB
                            FStream.Seek(0, SeekOrigin.Begin);
                            StreamUtil.DeCompressStream(FStream, FDecompStream);
                            aresult = FDecompStream;
#else
	    					throw new UnNamedException("REPMAN_ZLIB not defined compressed streams not supported");
#endif
                        }
                        else
                            aresult = FStream;
                    }
                }
            }
            FOldStream = aresult;
            return aresult;
        }
        /// <summary>
        /// Calculates the extent occupied by the image, measuring the graphic when the draw style
        /// requires it, and returns the resulting size.
        /// </summary>
        override public Point GetExtension(PrintOut adriver, Point MaxExtent, bool ForcePartial)
        {
            MemoryStream FMStream;
            Point aresult = base.GetExtension(adriver, MaxExtent, ForcePartial);
            if ((DrawStyle == ImageDrawStyleType.Crop) ||
             (DrawStyle == ImageDrawStyleType.Tile) ||
             (DrawStyle == ImageDrawStyleType.Tiledpi) ||
             (DrawStyle == ImageDrawStyleType.Stretch))
                return aresult; ;
            FMStream = GetStream();
            if (FMStream == null)
                return aresult;
            aresult = adriver.GraphicExtent(FMStream, aresult, dpires);
            LastExtent = aresult;
            return aresult;
        }
        /// <summary>
        /// Renders the image into the metafile as an image object, reusing a previously added
        /// stream when the image is shared.
        /// </summary>
        override protected void DoPrint(PrintOut adriver, int aposx, int aposy,
            int newwidth, int newheight, MetaFile metafile, Point MaxExtent,
            ref bool PartialPrint)
        {
            base.DoPrint(adriver, aposx, aposy, newwidth, newheight,
                metafile, MaxExtent, ref PartialPrint);
            MemoryStream FMStream = GetStream();
            if (FMStream == null)
                return;
            if (FMStream.Length == 0)
                return;
            MetaObjectImage metaobj = new();
            var apage = metafile.Pages[metafile.CurrentPage];
            FillAnnotation(metaobj, apage);
            metaobj.MetaType = MetaObjectType.Image;
            metaobj.Top = aposy; metaobj.Left = aposx;
            metaobj.Width = PrintWidth;
            metaobj.Height = PrintHeight;
            metaobj.CopyMode = 20;
            metaobj.DrawImageStyle = DrawStyle;
            metaobj.DPIRes = dpires;
            metaobj.PreviewOnly = false;
            if (OldStreamPos >= 0)
            {
                metaobj.StreamPos = OldStreamPos;
                metaobj.SharedImage = true;
            }
            else
            {
                metaobj.StreamPos = metafile.Pages[metafile.CurrentPage].AddStream(FMStream, SharedImage != SharedImageType.None);
                if (SharedImage != SharedImageType.None)
                    OldStreamPos = metaobj.StreamPos;
                metaobj.SharedImage = SharedImage != SharedImageType.None;
            }
            metaobj.StreamSize = FMStream.Length;
            apage.Objects.Add(metaobj);

        }
    }
}
