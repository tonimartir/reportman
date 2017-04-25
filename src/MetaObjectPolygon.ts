import { MetaObject } from "./MetaObject";
import { BrushType, PenType } from "./MetaTypes";
import { StreamUtil } from "./StreamUtil";

export class MetaObjectPolygon extends MetaObject {
    public PolyBrushStyle: BrushType;
    public PolyBrushColor: number;
    public PolyPenStyle: PenType;
    public PolyPenWidth: number;
    public PolyPenColor: number;
    public PolyPointCount: number;
    public PolyStreamPos: number;
    public PolyStreamSize: number;
    public FillFromBuf(buf: ArrayBuffer, index: number): void {
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
    public SaveToStream(/*Stream astream*/buf: number[]): void {
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
