// The fixtures written by test/generate-dfm-fixtures.mjs from the Delphi engine.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { gunzipSync } from 'node:zlib';

const fixtures = path.join(path.dirname(fileURLToPath(import.meta.url)), 'fixtures');

/** A report of the corpus: its DFM forms as Delphi wrote them and the XML Delphi writes from them. */
export interface CorpusReport {
  group: string;
  name: string;
  text: Uint8Array;
  xml: Uint8Array;
  binary?: Uint8Array;
  zlib?: Uint8Array;
}

/** A DFM report as an older Delphi saved it, and the XML of reptotxt -xml. */
export interface OriginalReport {
  name: string;
  dfm: Uint8Array;
  xml: Uint8Array;
}

const latin1 = (s: string): Uint8Array => new Uint8Array(Buffer.from(s, 'latin1'));
const base64 = (s: string): Uint8Array => new Uint8Array(Buffer.from(s, 'base64'));

export function corpus(): CorpusReport[] {
  const result: CorpusReport[] = [];
  for (const file of fs.readdirSync(path.join(fixtures, 'corpus')).sort()) {
    const group = file.replace(/\.json\.gz$/, '');
    const bundle = JSON.parse(gunzipSync(fs.readFileSync(path.join(fixtures, 'corpus', file))).toString('utf8')) as Record<
      string,
      { text: string; xml: string; binary?: string; zlib?: string }
    >;
    for (const [name, e] of Object.entries(bundle)) {
      result.push({
        group,
        name,
        text: latin1(e.text),
        xml: latin1(e.xml),
        ...(e.binary !== undefined ? { binary: base64(e.binary) } : {}),
        ...(e.zlib !== undefined ? { zlib: base64(e.zlib) } : {}),
      });
    }
  }
  return result;
}

export function originals(): OriginalReport[] {
  const bundle = JSON.parse(gunzipSync(fs.readFileSync(path.join(fixtures, 'originals.json.gz'))).toString('utf8')) as Record<string, { dfm: string; xml: string }>;
  return Object.entries(bundle).map(([name, e]) => ({ name, dfm: base64(e.dfm), xml: latin1(e.xml) }));
}
