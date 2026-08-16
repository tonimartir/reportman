using System.IO;

namespace Reportman.Drawing
{
    /// <summary>
    /// Barcode symbologies a metafile barcode object can carry. This is the DEVICE vocabulary
    /// (what a receipt printer can draw by itself with a single command), deliberately smaller
    /// and independent from the report item's own barcode type list: the report layer maps
    /// its type to one of these, and a driver that does not know one of them just ignores it.
    /// </summary>
    public enum MetaBarcodeSymbology
    {
        /// <summary>Not a symbology a device can draw natively.</summary>
        Unknown = 0,
        /// <summary>QR Code (ISO/IEC 18004), model 2.</summary>
        QR = 1,
        /// <summary>Code 128 (any subset).</summary>
        Code128 = 2,
        /// <summary>EAN-13.</summary>
        EAN13 = 3,
        /// <summary>EAN-8.</summary>
        EAN8 = 4,
        /// <summary>Code 39.</summary>
        Code39 = 5,
        /// <summary>PDF417.</summary>
        PDF417 = 6,
        /// <summary>Interleaved 2 of 5.</summary>
        ITF = 7,
        /// <summary>Code 93.</summary>
        Code93 = 8,
        /// <summary>Codabar (NW-7).</summary>
        Codabar = 9,
        /// <summary>UPC-A.</summary>
        UPCA = 10,
        /// <summary>UPC-E.</summary>
        UPCE = 11
    }

    /// <summary>
    /// Error correction level for two-dimensional symbologies (QR). Same order as ISO 18004.
    /// </summary>
    public enum MetaBarcodeEcc
    {
        /// <summary>~7 % recovery.</summary>
        L = 0,
        /// <summary>~15 % recovery.</summary>
        M = 1,
        /// <summary>~25 % recovery.</summary>
        Q = 2,
        /// <summary>~30 % recovery.</summary>
        H = 3
    }

    /// <summary>
    /// A barcode stored in the metafile AS A BARCODE — the data, the symbology and the symbol
    /// geometry — instead of as the hundreds of rectangles that draw its modules.
    ///
    /// It exists for drivers that can render a barcode natively (a receipt printer given the
    /// text draws the QR itself; see <see cref="PrintOut.SupportsNativeBarcode"/>). The report
    /// barcode item emits this object ONLY when the active driver declares that support, and
    /// keeps emitting drawn modules for every other driver, so a metafile produced for a PDF or
    /// a preview never contains one and can still be read by older readers. Drivers that do
    /// not understand the type simply skip it in their DrawObject switch.
    ///
    /// The bounding box (Top/Left/Width/Height, in twips) is the space the barcode reserves in
    /// the layout, and it is what the driver uses to choose the module size and to skip the
    /// vertical space the symbol consumes. <see cref="Modules"/> and <see cref="Rows"/> tell
    /// how many modules the symbol has across and down (for QR both are the symbol size, e.g.
    /// 33 for a version 4), which is what turns a width in twips into a module size in dots
    /// without having to encode the data again inside the driver.
    /// </summary>
    public class MetaObjectBarcode : MetaObject
    {
        /// <summary>Barcode data position in MetaPage strings pool</summary>
        public int TextP;
        /// <summary>Barcode data length in MetaPage strings pool</summary>
        public int TextS;
        /// <summary>Symbology of the barcode</summary>
        public MetaBarcodeSymbology Symbology;
        /// <summary>Error correction level (two-dimensional symbologies)</summary>
        public MetaBarcodeEcc Ecc;
        /// <summary>Symbol width in modules (QR: symbol size; linear: total module count)</summary>
        public int Modules;
        /// <summary>Symbol height in modules (QR: symbol size; linear: 0 = as tall as the box)</summary>
        public int Rows;
        /// <summary>Data columns asked for (PDF417: 0 = automatic); Code 128: the subset (0 auto, 1 A, 2 B, 3 C).</summary>
        public int Columns;
        /// <summary>Symbology options. PDF417: bit 0 = truncated. Two-dimensional error correction beyond
        /// <see cref="Ecc"/> (PDF417 levels 0-8) travels here in bits 8-15.</summary>
        public int Flags;
        /// <summary>
        /// Fill the values of a MetaObjectBarcode, loading it from a binary buffer
        /// </summary>
        /// <param name="buf">Buffer containing information in binary format</param>
        /// <param name="index">Index to begin read in the buffer</param>
        /// <param name="ver">Version of the record format</param>
        override public void FillFromBuf(byte[] buf, int index, int ver)
        {
            int RECORD_OFFSET = GetRECORD_OFFSET(ver);
            base.FillFromBuf(buf, index, ver);
            TextP = StreamUtil.ByteArrayToInt(buf, index + RECORD_OFFSET, 4);
            TextS = StreamUtil.ByteArrayToInt(buf, index + RECORD_OFFSET + 4, 4);
            Symbology = (MetaBarcodeSymbology)StreamUtil.ByteArrayToInt(buf, index + RECORD_OFFSET + 8, 4);
            Ecc = (MetaBarcodeEcc)StreamUtil.ByteArrayToInt(buf, index + RECORD_OFFSET + 12, 4);
            Modules = StreamUtil.ByteArrayToInt(buf, index + RECORD_OFFSET + 16, 4);
            Rows = StreamUtil.ByteArrayToInt(buf, index + RECORD_OFFSET + 20, 4);
            Columns = StreamUtil.ByteArrayToInt(buf, index + RECORD_OFFSET + 24, 4);
            Flags = StreamUtil.ByteArrayToInt(buf, index + RECORD_OFFSET + 28, 4);
        }
        /// <summary>
        /// Save the information of the object into a stream
        /// </summary>
        /// <param name="astream">Destination stream</param>
        /// <param name="ver">Version of the record format</param>
        override public void SaveToStream(Stream astream, int ver)
        {
            int RECORD_OFFSET = GetRECORD_OFFSET(ver);
            int RECORD_SIZE = GetRECORD_SIZE(ver);
            base.SaveToStream(astream, ver);
            astream.Write(StreamUtil.IntToByteArray(TextP), 0, 4);
            astream.Write(StreamUtil.IntToByteArray(TextS), 0, 4);
            astream.Write(StreamUtil.IntToByteArray((int)Symbology), 0, 4);
            astream.Write(StreamUtil.IntToByteArray((int)Ecc), 0, 4);
            astream.Write(StreamUtil.IntToByteArray(Modules), 0, 4);
            astream.Write(StreamUtil.IntToByteArray(Rows), 0, 4);
            astream.Write(StreamUtil.IntToByteArray(Columns), 0, 4);
            astream.Write(StreamUtil.IntToByteArray(Flags), 0, 4);
            astream.Write(emptybuf, 0, RECORD_SIZE - 32 - RECORD_OFFSET);
        }
    }
}
