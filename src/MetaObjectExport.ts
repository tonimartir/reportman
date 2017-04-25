import { MetaObject } from "./MetaObject";
import { StreamUtil } from "./StreamUtil";

export class MetaObjectExport extends MetaObject {
    public TextExpP: number;
    public TextExpS: number;
    public Line: number;
    public Position: number;
    public Size: number;
    public DoNewLine: boolean;
    public FillFromBuf(buf: ArrayBuffer, index: number): void {
        super.FillFromBuf(buf, index);
        /*base.FillFromBuf(buf, index);
        TextExpP = StreamUtil.ByteArrayToInt(buf, index + 17, 4);
        TextExpS = StreamUtil.ByteArrayToInt(buf, index + 21, 4);
        Line = StreamUtil.ByteArrayToInt(buf, index + 25, 4);
        Position = StreamUtil.ByteArrayToInt(buf, index + 29, 4);
        Size = StreamUtil.ByteArrayToInt(buf, index + 33, 4);
        DoNewLine = buf[index + 37] != 0;*/
    }
    public SaveToStream(/*Stream astream*/buf: number[]): void {
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
