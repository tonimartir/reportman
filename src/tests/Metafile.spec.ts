import { AlignmentFlags } from "../Metafile";

describe("Check align flags",()=>{
    it("AlignLeft is 1 ",()=>{
        expect<boolean>(AlignmentFlags.AlignLeft===1).toBeTruthy("What the fuck");
    });
});