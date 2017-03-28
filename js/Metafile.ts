export class Metafile {

}
export enum AutoScaleType {
    Wide = 0, Real = 1, EntirePage = 2, Custom = 3, Height = 4
};
export enum BrushType {
    Solid = 0, Clear = 1, Horizontal = 2, Vertical = 3,
    ADiagonal = 4, BDiagonal = 5, ACross = 6, BCross = 7,
    Dense1 = 8, Dense2 = 9, Dense3 = 10, Dense4 = 11,
    Dense5 = 12, Dense6 = 13, Dense7 = 14
};
export enum PenType {
    Solid = 0, Dash = 1, Dot = 2, DashDot = 3, DashDotDot = 4, Clear = 5
};
export enum ImageDrawStyleType {
    Crop = 0, Stretch = 1, Full = 2, Tile = 3, Tiledpi = 4
};
export enum ShapeType {
    Rectangle = 0, Square = 1, RoundRect = 2, RoundSquare = 3,
    Ellipse = 4, Circle = 5, HorzLine = 6, VertLine = 7,
    Oblique1 = 8, Oblique2 = 9
};
export enum PrintStepType {
    BySize = 0, cpi20 = 1, cpi17 = 2, cpi15 = 3, cpi12 = 4,
    cpi10 = 5, cpi6 = 6, cpi5 = 7
};
export enum PdfFontType {
    Helvetica = 0, Courier = 1, TimesRoman = 2, Symbol = 3,
    ZafDingbats = 4, Linked = 5, Embedded = 6
};
export enum PrinterSelectType {
    DefaultPrinter, ReportPrinter, TicketPrinter, Graphicprinter,
    Characterprinter, ReportPrinter2, TicketPrinter2, UserPrinter1,
    UserPrinter2, UserPrinter3, UserPrinter4, UserPrinter5,
    UserPrinter6, UserPrinter7, UserPrinter8, UserPrinter9,
    PlainPrinter, PlainFullPrinter,
    Printer1, Printer2, Printer3, Printer4, Printer5, Printer6, Printer7, Printer8, Printer9, Printer10,
    Printer11, Printer12, Printer13, Printer14, Printer15, Printer16, Printer17, Printer18, Printer19, Printer20,
    Printer21, Printer22, Printer23, Printer24, Printer25, Printer26, Printer27, Printer28, Printer29, Printer30,
    Printer31, Printer32, Printer33, Printer34, Printer35, Printer36, Printer37, Printer38, Printer39, Printer40,
    Printer41, Printer42, Printer43, Printer44, Printer45, Printer46, Printer47, Printer48, Printer49, Printer50
};
export enum OrientationType {
    Default, Portrait, Landscape
};
export enum PreviewWindowStyleType {
    Normal, Maximized
};
enum MetaSeparator { FileHeader, PageHeader, ObjectHeader, StreamHeader };
export enum MetaObjectType {
    Text, Draw, Image, Polygon, Export
};
export class TotalPage {
    public PageIndex: number;
    public ObjectIndex: number;
    public DisplayFormat: string;
}
export class PageSizeDetail {
    public Index: number;
    public Custom: boolean;
    public CustomWidth: number;
    public CustomHeight: number;
    public PhysicWidth: number;
    public PhysicHeight: number;
    public PaperSource: number;
    public ForcePaperName: string;
    public Duplex: number;
}
export enum TextAlignType {
    Left, Right, Center, Justify
};
export enum TextAlignVerticalType {
    Top, Bottom, Center
};
export enum AlignmentFlags {
    AlignLeft = 1, AlignRight = 2, AlignHJustify = 1024, AlignHCenter = 4,
    AlignVCenter = 32, AlignBottom = 16, SingleLine = 64
};

export abstract class MetaObject {
    public Id: number;
    //public const int RECORD_SIZE = 66;
    //protected static byte[] emptybuf = new byte[100];
    public Top: number;
    public Left: number;
    public Width: number;
    public Height: number;
    public MetaType: MetaObjectType;
    public static CreateFromBuf(buf: Array<number>, index: number): MetaObject {
        let aresult: MetaObject = null;
        let metatype: MetaObjectType = <MetaObjectType>buf[index + 16];
        switch (metatype) {
            case MetaObjectType.Text:
                aresult = new MetaObjectText();
                break;
            case MetaObjectType.Draw:
                aresult = new MetaObjectDraw();
                break;
            case MetaObjectType.Image:
                aresult = new MetaObjectImage();
                break;
            case MetaObjectType.Polygon:
                aresult = new MetaObjectPolygon();
                break;
            case MetaObjectType.Export:
                aresult = new MetaObjectExport();
                break;
        }
        return aresult;
    }
    public static GetIntHorizAlignment(Alignment: TextAlignType): number {
        let aresult: number = 0;
        if (Alignment === TextAlignType.Right)
            aresult = AlignmentFlags.AlignRight;
        else
            if (Alignment === TextAlignType.Center)
                aresult = AlignmentFlags.AlignHCenter;
            else
                if (Alignment === TextAlignType.Justify)
                    aresult = AlignmentFlags.AlignHJustify;
        return aresult;
    }
    public static GetIntVertAlignment(VAlignment: TextAlignVerticalType): number {
        // Inverse the alignment for BidiMode Full
        let aresult: number = 0;
        if (VAlignment === TextAlignVerticalType.Center)
            aresult = AlignmentFlags.AlignVCenter;
        else
            if (VAlignment === TextAlignVerticalType.Bottom)
                aresult = AlignmentFlags.AlignBottom;
        return aresult;
    }
    public FillFromBuf(buf: Array<number>, index: number): void {
		/*	Top = StreamUtil.ByteArrayToInt(buf, index + 0, 4);
			Left = StreamUtil.ByteArrayToInt(buf, index + 4, 4);
			Width = StreamUtil.ByteArrayToInt(buf, index + 8, 4);
			Height = StreamUtil.ByteArrayToInt(buf, index + 12, 4);
			MetaType = (MetaObjectType)buf[index + 16];*/
    }
    public SaveToStream(/*Stream astream*/buf: Array<number>): void {
        /*			astream.Write(StreamUtil.IntToByteArray(Top), 0, 4);
                    astream.Write(StreamUtil.IntToByteArray(Left), 0, 4);
                    astream.Write(StreamUtil.IntToByteArray(Width), 0, 4);
                    astream.Write(StreamUtil.IntToByteArray(Height), 0, 4);
                    astream.Write(StreamUtil.ByteToByteArray((byte)MetaType), 0, 1);*/
    }
}

export class MetaObjectText extends MetaObject {
    public TextP: number;
    public TextS: number;
    public LFontNameP: number;
    public LFontNameS: number;
    public WFontNameP: number;
    public WFontNameS: number;
    public FontSize: number;
    public FontRotation: number;
    public FontStyle: number;
    public Type1Font: PdfFontType;
    public FontColor: number;
    public BackColor: number;
    public Transparent: boolean;
    public CutText: boolean;
    public Alignment: number;
    public WordWrap: boolean;
    public RightToLeft: boolean;
    public PrintStep: PrintStepType;
    public FillFromBuf(buf: Array<number>, index: number): void {
        super.FillFromBuf(buf, index);
        /*			TextP = StreamUtil.ByteArrayToInt(buf, index + 17, 4);
                    TextS = StreamUtil.ByteArrayToInt(buf, index + 21, 4);
                    LFontNameP = StreamUtil.ByteArrayToInt(buf, index + 25, 4);
                    LFontNameS = StreamUtil.ByteArrayToInt(buf, index + 29, 4);
                    WFontNameP = StreamUtil.ByteArrayToInt(buf, index + 33, 4);
                    WFontNameS = StreamUtil.ByteArrayToInt(buf, index + 37, 4);
                    FontSize = StreamUtil.ByteArrayToShort(buf, index + 41, 2);
                    FontRotation = StreamUtil.ByteArrayToShort(buf, index + 43, 2);
                    FontStyle = StreamUtil.ByteArrayToShort(buf, index + 45, 2);
                    Type1Font = (PDFFontType)StreamUtil.ByteArrayToShort(buf, index + 47, 2);
                    FontColor = StreamUtil.ByteArrayToInt(buf, index + 49, 4);
                    BackColor = StreamUtil.ByteArrayToInt(buf, index + 53, 4);
                    Transparent = buf[index + 57] != 0;
                    CutText = buf[index + 58] != 0;
                    Alignment = StreamUtil.ByteArrayToShort(buf, index + 59, 2);
                    WordWrap = buf[index + 61] != 0;
                    RightToLeft = buf[index + 62] != 0;
                    PrintStep = (PrintStepType)buf[index + 63];*/
    }
    public SaveToStream(/*Stream astream*/buf: Array<number>): void {

        super.SaveToStream(buf);
        /*base.SaveToStream(astream);
        astream.Write(StreamUtil.IntToByteArray(TextP), 0, 4);
        astream.Write(StreamUtil.IntToByteArray(TextS), 0, 4);
        astream.Write(StreamUtil.IntToByteArray(LFontNameP), 0, 4);
        astream.Write(StreamUtil.IntToByteArray(LFontNameS), 0, 4);
        astream.Write(StreamUtil.IntToByteArray(WFontNameP), 0, 4);
        astream.Write(StreamUtil.IntToByteArray(WFontNameS), 0, 4);
        astream.Write(StreamUtil.ShortToByteArray(FontSize), 0, 2);
        astream.Write(StreamUtil.ShortToByteArray(FontRotation), 0, 2);
        astream.Write(StreamUtil.ShortToByteArray(FontStyle), 0, 2);
        astream.Write(StreamUtil.ShortToByteArray((short)Type1Font), 0, 2);
        astream.Write(StreamUtil.IntToByteArray(FontColor), 0, 4);
        astream.Write(StreamUtil.IntToByteArray(BackColor), 0, 4);
        astream.Write(StreamUtil.BoolToByteArray(Transparent), 0, 1);
        astream.Write(StreamUtil.BoolToByteArray(CutText), 0, 1);
        astream.Write(StreamUtil.ShortToByteArray(Alignment), 0, 2);
        astream.Write(StreamUtil.BoolToByteArray(WordWrap), 0, 1);
        astream.Write(StreamUtil.BoolToByteArray(RightToLeft), 0, 1);
        astream.Write(StreamUtil.ByteToByteArray((byte)PrintStep), 0, 1);
        astream.Write(emptybuf, 0, RECORD_SIZE - 47 - 17);*/

    }
}
export class MetaObjectDraw extends MetaObject {
    public DrawStyle: ShapeType;
    public BrushStyle: BrushType;
    public BrushColor: number;
    public PenStyle: number;
    public PenWidth: number;
    public PenColor: number;
    public FillFromBuf(buf: Array<number>, index: number): void {
        super.FillFromBuf(buf, index);
        /*base.FillFromBuf(buf, index);
        DrawStyle = (ShapeType)StreamUtil.ByteArrayToInt(buf, index + 17, 4);
        BrushStyle = StreamUtil.ByteArrayToInt(buf, index + 21, 4);
        BrushColor = StreamUtil.ByteArrayToInt(buf, index + 25, 4);
        PenStyle = StreamUtil.ByteArrayToInt(buf, index + 29, 4);
        PenWidth = StreamUtil.ByteArrayToInt(buf, index + 33, 4);
        PenColor = StreamUtil.ByteArrayToInt(buf, index + 37, 4);*/
    }
    public SaveToStream(/*Stream astream*/buf: Array<number>): void {

        super.SaveToStream(buf);
        /*    base.SaveToStream(astream);
        astream.Write(StreamUtil.IntToByteArray((int)DrawStyle), 0, 4);
        astream.Write(StreamUtil.IntToByteArray(BrushStyle), 0, 4);
        astream.Write(StreamUtil.IntToByteArray(BrushColor), 0, 4);
        astream.Write(StreamUtil.IntToByteArray(PenStyle), 0, 4);
        astream.Write(StreamUtil.IntToByteArray(PenWidth), 0, 4);
        astream.Write(StreamUtil.IntToByteArray(PenColor), 0, 4);
        astream.Write(emptybuf, 0, RECORD_SIZE - 24 - 17);*/
    }
}
export class MetaObjectImage extends MetaObject
{
		public CopyMode:number;
        public DrawImageStyle:ImageDrawStyleType ;
        public DPIRes:number;
        public PreviewOnly: boolean;
        public StreamPos:number;
        public StreamSize:number;
        public SharedImage:boolean;
    public FillFromBuf(buf: Array<number>, index: number): void {
        super.FillFromBuf(buf, index);
        /*base.FillFromBuf(buf, index);
        CopyMode = StreamUtil.ByteArrayToInt(buf, index + 17, 4);
        DrawImageStyle = (ImageDrawStyleType)StreamUtil.ByteArrayToInt(buf, index + 21, 4);
        DPIRes = StreamUtil.ByteArrayToInt(buf, index + 25, 4);
        PreviewOnly = buf[index + 29] != 0;
        StreamPos = StreamUtil.ByteArrayToLong(buf, index + 30, 8);
        StreamSize = StreamUtil.ByteArrayToLong(buf, index + 38, 8);
        SharedImage = buf[index + 46] != 0;*/
    }
    public SaveToStream(/*Stream astream*/buf: Array<number>): void {
        super.SaveToStream(buf);
        /*base.SaveToStream(astream);
        astream.Write(StreamUtil.IntToByteArray(CopyMode), 0, 4);
        astream.Write(StreamUtil.IntToByteArray((int)DrawImageStyle), 0, 4);
        astream.Write(StreamUtil.IntToByteArray(DPIRes), 0, 4);
        astream.Write(StreamUtil.BoolToByteArray(PreviewOnly), 0, 1);
        astream.Write(StreamUtil.LongToByteArray(StreamPos), 0, 8);
        astream.Write(StreamUtil.LongToByteArray(StreamSize), 0, 8);
        astream.Write(StreamUtil.BoolToByteArray(SharedImage), 0, 1);
        astream.Write(emptybuf, 0, RECORD_SIZE - 30 - 17);*/
    }
}
export class MetaObjectPolygon extends MetaObject
{
        public PolyBrushStyle:BrushType;
        public PolyBrushColor:number;
        public PolyPenStyle:PenType;
        public PolyPenWidth:number;
        public PolyPenColor:number;
        public PolyPointCount:number;
        public PolyStreamPos:number;
        public PolyStreamSize:number;
    public FillFromBuf(buf: Array<number>, index: number): void {
        super.FillFromBuf(buf, index);
        /*base.FillFromBuf(buf, index);
        PolyBrushStyle = StreamUtil.ByteArrayToInt(buf, index + 17, 4);
        PolyBrushColor = StreamUtil.ByteArrayToInt(buf, index + 21, 4);
        PolyPenStyle = StreamUtil.ByteArrayToInt(buf, index + 25, 4);
        PolyPenWidth = StreamUtil.ByteArrayToInt(buf, index + 29, 4);
        PolyPenColor = StreamUtil.ByteArrayToInt(buf, index + 33, 4);
        PolyPointCount = StreamUtil.ByteArrayToInt(buf, index + 37, 4);
        PolyStreamPos = StreamUtil.ByteArrayToLong(buf, index + 41, 8);
        PolyStreamSize = StreamUtil.ByteArrayToLong(buf, index + 49, 8);*/
    }
    public SaveToStream(/*Stream astream*/buf: Array<number>): void {
        super.SaveToStream(buf);
        /*base.SaveToStream(astream);
        astream.Write(StreamUtil.IntToByteArray(PolyBrushStyle), 0, 4);
        astream.Write(StreamUtil.IntToByteArray(PolyBrushColor), 0, 4);
        astream.Write(StreamUtil.IntToByteArray(PolyPenStyle), 0, 4);
        astream.Write(StreamUtil.IntToByteArray(PolyPenColor), 0, 4);
        astream.Write(StreamUtil.IntToByteArray(PolyBrushStyle), 0, 4);
        astream.Write(StreamUtil.IntToByteArray(PolyPointCount), 0, 4);
        astream.Write(StreamUtil.LongToByteArray(PolyStreamPos), 0, 8);
        astream.Write(StreamUtil.LongToByteArray(PolyStreamSize), 0, 8);*/
    }
}
export class MetaObjectExport extends MetaObject
{
        public TextExpP:number;
        public TextExpS:number;
        public Line:number;
        public Position:number;
        public Size:number;
        public DoNewLine:boolean;
    public FillFromBuf(buf: Array<number>, index: number): void {
        super.FillFromBuf(buf, index);
        /*base.FillFromBuf(buf, index);
        TextExpP = StreamUtil.ByteArrayToInt(buf, index + 17, 4);
        TextExpS = StreamUtil.ByteArrayToInt(buf, index + 21, 4);
        Line = StreamUtil.ByteArrayToInt(buf, index + 25, 4);
        Position = StreamUtil.ByteArrayToInt(buf, index + 29, 4);
        Size = StreamUtil.ByteArrayToInt(buf, index + 33, 4);
        DoNewLine = buf[index + 37] != 0;*/
    }
    public SaveToStream(/*Stream astream*/buf: Array<number>): void {
        super.SaveToStream(buf);
        /*base.SaveToStream(astream);
        astream.Write(StreamUtil.IntToByteArray(TextExpP), 0, 4);
        astream.Write(StreamUtil.IntToByteArray(TextExpP), 0, 4);
        astream.Write(StreamUtil.IntToByteArray(Line), 0, 4);
        astream.Write(StreamUtil.IntToByteArray(Position), 0, 4);
        astream.Write(StreamUtil.IntToByteArray(Size), 0, 4);
        astream.Write(StreamUtil.BoolToByteArray(DoNewLine), 0, 1);*/
    }
}
