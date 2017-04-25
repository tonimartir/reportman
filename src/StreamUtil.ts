export class StreamUtil {
    public static longToByteArray(long: number) {
        const byteArray: Uint8Array = new Uint8Array([0, 0, 0, 0, 0, 0, 0, 0]);

        for (let index = 0; index < byteArray.length; index++) {
            // tslint:disable-next-line:no-bitwise
            const byte = long & 0xff;
            byteArray[index] = byte;
            long = (long - byte) / 256;
        }
        return byteArray;
    }
    public static byteArrayToLong(byteArray: ArrayBuffer) {
        let value = 0;
        for (let i = byteArray.byteLength - 1; i >= 0; i--) {
            value = (value * 256) + (byteArray as any)[i];
        }
        return value;
    }
    public static intToByteArray(num: number): ArrayBuffer {
        const arr = new ArrayBuffer(4); // an Int32 takes 4 bytes
        const view = new DataView(arr);
        view.setInt32(0, num, false); // byteOffset = 0; litteEndian = false
        return arr;
    }
    public static byteArrayToInt(buf: ArrayBuffer, index: number): number {
        const view = new DataView(buf, index);
        const result = view.getInt32(0, false);
        return result;
    }
    public static byteArrayToByte(buf: ArrayBuffer, index: number): number {
        const view = new DataView(buf, index);
        const result = view.getUint8(0);
        return result;
    }
    public static shortToByteArray(num: number) {
        const arr = new ArrayBuffer(2); // an Int32 takes 4 bytes
        const view = new DataView(arr);
        view.setInt16(0, num, false); // byteOffset = 0; litteEndian = false
        return arr;
    }
    public static byteArrayToShort(buf: ArrayBuffer, index: number) {
        const view = new DataView(buf, index);
        const result = view.getInt16(0, false);
        return result;
    }
}
