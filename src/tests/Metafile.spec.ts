import { readFileSync } from "fs";
import { Metafile } from "../Metafile";
import { AlignmentFlags } from "../MetaTypes";

describe("Check align flags", () => {
    it("AlignLeft is 1 ", () => {
        expect<boolean>(AlignmentFlags.AlignLeft === 1).toBeTruthy("Alignment flag incorrect");
    });
});

describe("Test loading metafile 2", () => {
    const metafile: Metafile = new Metafile();
    it("Loading metafile 2", () => {
        const buf: Buffer = readFileSync("metatest.rpmf");
        metafile.LoadFromStream(buf.buffer);
        expect<number>(metafile.pages.length).toBe(0);
    });
});
