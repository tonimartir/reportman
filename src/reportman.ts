import { install } from "source-map-support";
// install({hookRequire: true});
// install({environment: 'node'});
// install({ handleUncaughtExceptions : false });
install();

import { Metafile } from "./Metafile";

const meta: Metafile = new Metafile();

meta.LoadFromStream(null);
