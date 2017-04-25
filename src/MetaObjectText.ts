import { MetaObject } from "./MetaObject";
import { PdfFontType, PrintStepType } from "./MetaTypes";

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
    public FillFromBuf(buf: ArrayBuffer, index: number): void {
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
    public SaveToStream(/*Stream astream*/buf: number[]): void {

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
