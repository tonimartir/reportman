import { install } from 'source-map-support';
//install({hookRequire: true});
//install({environment: 'node'});
//install({ handleUncaughtExceptions : false });
install();

import { Metafile } from './Metafile';

console.log('Hello');

let meta:Metafile = new Metafile();
console.log('Metafile created');

meta.LoadFromStream(null);
