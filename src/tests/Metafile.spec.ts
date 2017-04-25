import { Metafile } from "../Metafile";
import { AlignmentFlags } from "../MetaTypes";

describe("Check align flags", () => {
    it("AlignLeft is 1 ", () => {
        expect<boolean>(AlignmentFlags.AlignLeft === 0).toBeTruthy("What the fuck");
    });
});

describe("Test loading metafile 2", () => {
    const metafile: Metafile = new Metafile();
    it("Loading metafile 2", () => {
        metafile.LoadFromStream(null);
        expect<boolean>(true).toBeTruthy("Es cierto");
    });
});
