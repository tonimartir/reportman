import { MetaObject } from "./MetaObject";
import { BrushType, ShapeType } from "./MetaTypes";

export class MetaObjectDraw extends MetaObject {
    public DrawStyle: ShapeType;
    public BrushStyle: BrushType;
    public BrushColor: number;
    public PenStyle: number;
    public PenWidth: number;
    public PenColor: number;
    public FillFromBuf(buf: ArrayBuffer, index: number): void {
        super.FillFromBuf(buf, index);
        /*base.FillFromBuf(buf, index);
        DrawStyle = (ShapeType)StreamUtil.ByteArrayToInt(buf, index + 17, 4);
        BrushStyle = StreamUtil.ByteArrayToInt(buf, index + 21, 4);
        BrushColor = StreamUtil.ByteArrayToInt(buf, index + 25, 4);
        PenStyle = StreamUtil.ByteArrayToInt(buf, index + 29, 4);
        PenWidth = StreamUtil.ByteArrayToInt(buf, index + 33, 4);
        PenColor = StreamUtil.ByteArrayToInt(buf, index + 37, 4);*/
    }
    public SaveToStream(/*Stream astream*/buf: number[]): void {

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
