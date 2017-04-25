import { Inflate } from "pako";
import { MetaBase } from "./MetaBase";
import { MetaPage } from "./MetaPage";
import { StreamUtil } from "./StreamUtil";

export class Metafile extends MetaBase {
    public pages: MetaPage[] = [];
    public LoadFromStream(astream: ArrayBuffer) {
        // const zlib = require("zlib");
        // const decomp: Buffer = zlib.Inflate(astream);
        // const myBuffer: ArrayBuffer = decomp.buffer;
        const inflator: Inflate = new Inflate();
        inflator.push(astream, true);

        const unCompressedArray: Uint8Array = inflator.result as Uint8Array;
        const unCompressedBuffer: ArrayBuffer = new ArrayBuffer(unCompressedArray.length);

        unCompressedArray.map( (i: number, value: number): number => {
            unCompressedBuffer[i] = value;
            return value;
        });
        console.log(typeof unCompressedBuffer[0]);


        console.log(unCompressedBuffer[0]);

        //console.log(inflator.result);
        // throw Error("not implemented")
    }
}
