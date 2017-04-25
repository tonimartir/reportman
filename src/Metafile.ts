import { MetaBase } from "./MetaBase";
import { MetaPage } from "./MetaPage";
import { StreamUtil } from "./StreamUtil";


export class Metafile extends MetaBase {
    public pages: MetaPage[] = [];
    public LoadFromStream(astream: ArrayBuffer) {
        const zlib = require("zlib");
        const decomp: Buffer = zlib.Inflate(astream);
        const myBuffer: ArrayBuffer = decomp.buffer;
        
        console.log(decomp);
        // throw Error("not implemented")
    }
}
