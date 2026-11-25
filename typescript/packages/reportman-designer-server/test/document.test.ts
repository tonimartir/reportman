// The report as the designer gets it: designerDocument of every report of the parity corpus of
// @reportman/lib equals the JSON the C# engine writes of it (golden-cs model-json, the fixtures of
// @reportman/lib), member by member; and the designer's JSON read back types its Variants as
// Newtonsoft does.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { readReportXml } from '@reportman/lib';
import { designerDocument, modelFromDocument, parseDesignerJson } from '@reportman/designer-server';

const libDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../reportman-lib');
const cases = (JSON.parse(fs.readFileSync(path.join(libDir, 'test/fixtures/cases.json'), 'utf8')) as { id: string; rep: string; json?: string }[]).filter(
  (c) => c.json !== undefined,
);

describe('designerDocument: the JSON of the C# engine', () => {
  for (const c of cases) {
    it(c.id, () => {
      const expected = JSON.parse(fs.readFileSync(path.join(libDir, c.json!), 'utf8')) as unknown;
      // As golden-cs reads it (LoadFromFile: not converted to .Net, which the server's LoadFromStream does)
      const model = readReportXml(new Uint8Array(fs.readFileSync(path.resolve(libDir, c.rep))));
      expect(JSON.parse(JSON.stringify(designerDocument(model)))).toEqual(expected);
    });
  }

  // Items with the same name (the quirks of the format), which hydrateReport names apart as the
  // designer itself does when it gets them
  for (const c of cases.filter((x) => !['synthetic-quirks', 'synthetic-kitchen-sink', 'synthetic-zlib-kitchen-sink'].includes(x.id))) {
    it(c.id + ' read back gives the same document', () => {
      // As golden-cs reads it (LoadFromFile: not converted to .Net, which the server's LoadFromStream does)
      const model = readReportXml(new Uint8Array(fs.readFileSync(path.resolve(libDir, c.rep))));
      const document = JSON.parse(JSON.stringify(designerDocument(model))) as Record<string, unknown>;
      expect(JSON.parse(JSON.stringify(designerDocument(modelFromDocument(structuredClone(document)))))).toEqual(document);
    });
  }
});

describe('parseDesignerJson: the Variants as Newtonsoft reads them', () => {
  it('types a Variant by its JSON token, not by the type it was written with (but an Integer or a Byte)', () => {
    const text =
      '{"a":{"type":"Integer","value":1},"b":{"type":"Double","value":2.0},"c":{"type":"Decimal","value":1e3},"d":{"type":"String","value":"2025-01-02T03:04:05"},' +
      '"e":{"type":"DateTime","value":"2025-01-02"},"f":{"type":"Binary","value":"AAEC"},"g":{"type":"String","value":null},"h":{"type":"Boolean","value":true},' +
      '"i":{"name":"eTag","value":7},"j":{"type":"Long"},"k":{"type":"Byte","value":2.5},"l":{"type":"Long","value":3}}';
    expect(parseDesignerJson(text)).toEqual({
      a: { type: 'Integer', value: 1 },
      b: { type: 'Double', value: 2 },
      c: { type: 'Double', value: 1000 },
      d: { type: 'DateTime', value: '2025-01-02T03:04:05' },
      e: { type: 'String', value: '2025-01-02' },
      f: { type: 'String', value: 'AAEC' },
      g: { type: 'Null', value: null },
      h: { type: 'Boolean', value: true },
      i: { name: 'eTag', value: 7 },
      j: { type: 'Null', value: null },
      // Convert.ToInt32 / ToByte of a number with a fraction: half to even
      k: { type: 'Byte', value: 2 },
      l: { type: 'Long', value: 3 },
    });
  });
});
