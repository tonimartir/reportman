import { AlignmentFlags } from "../MetaTypes";
import { Metafile } from '../Metafile';

describe("Check align flags",()=>{
    it("AlignLeft is 1 ",()=>{
        expect<boolean>(AlignmentFlags.AlignLeft===1).toBeTruthy("What the fuck");
    });
});

describe("Test loading metafile",()=>{
    let metafile:Metafile = new Metafile();
    it("Loading metafile ",()=>{
        metafile.LoadFromStream(null);
        expect<boolean>(false).toBeTruthy("No debe llegar");
    });
});
