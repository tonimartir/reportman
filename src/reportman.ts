import { readFileSync } from "fs";
import { install } from "source-map-support";
// install({hookRequire: true});
// install({environment: 'node'});
// install({ handleUncaughtExceptions : false });
install();

import { Metafile } from "./Metafile";

const meta: Metafile = new Metafile();
const buf: Buffer = readFileSync("spec/files/metasmall.rpmf");
console.log("Program started");
meta.LoadFromStream(buf.buffer);
console.log("Program End");
