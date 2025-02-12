﻿using System.IO;

namespace Reportman.Drawing
{
    /// <summary>
    /// Image drawing object stored in a a MetaFile, it's a fixed length record, image stream can be
    /// stored in MetaPage stream or in MetaFile stream (SharedImage=true)
    /// </summary>
	public class MetaObjectImage : MetaObject
    {
        /// <summary>Integer CopyMode, for future use</summary>
		public int CopyMode;
        /// <summary>Image draw style (crop, stretch, full...)</summary>
        public ImageDrawStyleType DrawImageStyle;
        /// <summary>Dots per inch image resolution</summary>
        public int DPIRes;
        /// <summary>The image should be drawn in preview only, not in printout (useful for preprinted forms)</summary>
        public bool PreviewOnly;
        /// <summary>Stream begin position in MetaPage or MetaFile stream</summary>
        public long StreamPos;
        /// <summary>Stream length</summary>
        public long StreamSize;
        /// <summary>If true the image is saved on MetaFile stream instead of MetaPage stream, so multiple
        /// pages can share images to save memory and to generate smaller Adobe PDF output files</summary>
        public bool SharedImage;
        /// <summary>
        /// Fill the values of a MetaObjectImage, loading it from a binary buffer
        /// </summary>
        /// <param name="buf">Buffer containing information in binary format</param>
        /// <param name="index">Index to begin read in the buffer</param>
        override public void FillFromBuf(byte[] buf, int index, int ver)
        {
            int RECORD_OFFSET = GetRECORD_OFFSET(ver);
            base.FillFromBuf(buf, index, ver);
            CopyMode = StreamUtil.ByteArrayToInt(buf, index + RECORD_OFFSET, 4);
            DrawImageStyle = (ImageDrawStyleType)StreamUtil.ByteArrayToInt(buf, index + RECORD_OFFSET + 4, 4);
            DPIRes = StreamUtil.ByteArrayToInt(buf, index + RECORD_OFFSET + 8, 4);
            PreviewOnly = buf[index + RECORD_OFFSET + 12] != 0;
            StreamPos = StreamUtil.ByteArrayToLong(buf, index + RECORD_OFFSET + 13, 8);
            StreamSize = StreamUtil.ByteArrayToLong(buf, index + RECORD_OFFSET + 21, 8);
            SharedImage = buf[index + RECORD_OFFSET + 29] != 0;
        }
        /// <summary>
        /// Save the information of the object into a stream
        /// </summary>
        /// <param name="astream">Destination stream</param>
        override public void SaveToStream(Stream astream, int ver)
        {
            int RECORD_OFFSET = GetRECORD_OFFSET(ver);
            int RECORD_SIZE = GetRECORD_SIZE(ver);
            base.SaveToStream(astream, ver);
            astream.Write(StreamUtil.IntToByteArray(CopyMode), 0, 4);
            astream.Write(StreamUtil.IntToByteArray((int)DrawImageStyle), 0, 4);
            astream.Write(StreamUtil.IntToByteArray(DPIRes), 0, 4);
            astream.Write(StreamUtil.BoolToByteArray(PreviewOnly), 0, 1);
            astream.Write(StreamUtil.LongToByteArray(StreamPos), 0, 8);
            astream.Write(StreamUtil.LongToByteArray(StreamSize), 0, 8);
            astream.Write(StreamUtil.BoolToByteArray(SharedImage), 0, 1);
            astream.Write(emptybuf, 0, RECORD_SIZE - 30 - RECORD_OFFSET);
        }
    }

}
