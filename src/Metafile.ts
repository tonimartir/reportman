import { MetaBase } from "./MetaBase";
import { MetaPage } from "./MetaPage";
import { StreamUtil } from "./StreamUtil";

export class Metafile extends MetaBase {
    public pages: MetaPage[] = [];
    public LoadFromStream(astream: ArrayBuffer) {
        // throw Error("not implemented")
    }
}
