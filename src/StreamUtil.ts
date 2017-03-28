export class StreamUtil {
    public static longToByteArray(long: number) {
        let byteArray:Uint8Array = new Uint8Array([0, 0, 0, 0, 0, 0, 0, 0]);

        for (var index = 0; index < byteArray.length; index++) {
            var byte = long & 0xff;
            byteArray[index] = byte;
            long = (long - byte) / 256;
        }
        return byteArray;
    }
    public static byteArrayToLong(byteArray:Uint8Array) {
        var value = 0;
        for (var i = byteArray.length - 1; i >= 0; i--) {
            value = (value * 256) + byteArray[i];
        }
        return value;
    };

}

