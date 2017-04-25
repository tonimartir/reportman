import { MetaObjectDraw } from "./MetaObjectDraw";
import { MetaObjectExport } from "./MetaObjectExport";
import { MetaObjectImage } from "./MetaObjectImage";
import { MetaObjectPolygon } from "./MetaObjectPolygon";
import { MetaObjectText } from "./MetaObjectText";
import { AlignmentFlags, MetaObjectType, TextAlignType, TextAlignVerticalType } from "./MetaTypes";
import { StreamUtil } from "./StreamUtil";

export abstract class MetaObject {
    public static CreateFromBuf(buf: number[], index: number): MetaObject {
        let aresult: MetaObject = null;
        const metatype: MetaObjectType = buf[index + 16] as MetaObjectType;
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
                if (Alignment === TextAlignType.Justify) {

                    aresult = AlignmentFlags.AlignHJustify;
                }
        return aresult;
    }
    public static GetIntVertAlignment(VAlignment: TextAlignVerticalType): number {
        // inverse the alignment for BidiMode Full
        let aresult: number = 0;
        if (VAlignment === TextAlignVerticalType.Center)
            aresult = AlignmentFlags.AlignVCenter;
        else
            if (VAlignment === TextAlignVerticalType.Bottom)
                aresult = AlignmentFlags.AlignBottom;
        return aresult;
    }
    public Id: number;
    // public const int RECORD_SIZE = 66;
    // protected static byte[] emptybuf = new byte[100];
    public Top: number;
    public Left: number;
    public Width: number;
    public Height: number;
    public MetaType: MetaObjectType;
    public FillFromBuf(buf: ArrayBuffer, index: number): void {
        this.Top = StreamUtil.byteArrayToInt(buf, index + 0);
        this.Left = StreamUtil.byteArrayToInt(buf, index + 4);
        this.Width = StreamUtil.byteArrayToInt(buf, index + 8);
        this.Height = StreamUtil.byteArrayToInt(buf, index + 12);
        this.MetaType = StreamUtil.byteArrayToByte(buf, index + 16) as MetaObjectType;
    }
    public SaveToStream(/*Stream astream*/buf: number[]): void {
        /*			astream.Write(StreamUtil.IntToByteArray(Top), 0, 4);
                    astream.Write(StreamUtil.IntToByteArray(Left), 0, 4);
                    astream.Write(StreamUtil.IntToByteArray(Width), 0, 4);
                    astream.Write(StreamUtil.IntToByteArray(Height), 0, 4);
                    astream.Write(StreamUtil.ByteToByteArray((byte)MetaType), 0, 1);*/
    }
}
