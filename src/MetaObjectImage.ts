import { MetaObject } from "./MetaObject";
import { ImageDrawStyleType } from "./MetaTypes";
import { StreamUtil } from "./StreamUtil";

export class MetaObjectImage extends MetaObject {
    public CopyMode: number;
    public DrawImageStyle: ImageDrawStyleType;
    public DPIRes: number;
    public PreviewOnly: boolean;
    public StreamPos: number;
    public StreamSize: number;
    public SharedImage: boolean;
    public FillFromBuf(buf: ArrayBuffer, index: number): void {
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
    public SaveToStream(/*Stream astream*/buf: number[]): void {
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
