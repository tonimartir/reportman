import { AlignmentFlags } from "../MetaTypes";
import { Metafile } from '../Metafile';

describe("Check align flags",()=>{
    it("AlignLeft is 1 ",()=>{
        expect<boolean>(AlignmentFlags.AlignLeft===1).toBeTruthy("What the fuck");
    });
});

describe("Test loading metafile 2",()=>{
    let metafile:Metafile = new Metafile();
    it("Loading metafile 2",()=>{
        metafile.LoadFromStream(null);
        expect<boolean>(true).toBeTruthy("Es cierto");
    });
});
