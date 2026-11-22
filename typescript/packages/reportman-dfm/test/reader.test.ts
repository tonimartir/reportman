// The reader of the DFM forms: the text, binary and zlib forms Delphi writes for a report give the
// same tree (the same objects, properties and values), and the DFMs of older versions are read.
import { describe, expect, it } from 'vitest';
import { readDfm, reportForm, type DfmObject } from '../src/reader.js';
import { corpus, originals } from './corpus.js';

const json = (tree: DfmObject): string =>
  JSON.stringify(tree, (_k, v: unknown) => (typeof v === 'bigint' ? v.toString() + 'n' : v instanceof Uint8Array ? Buffer.from(v).toString('hex') : v));

describe('@reportman/dfm reader', () => {
  it('gives the same tree for the text, binary and zlib forms of each report', () => {
    const problems: string[] = [];
    let compared = 0;
    for (const r of corpus()) {
      const text = json(readDfm(r.text));
      for (const form of ['binary', 'zlib'] as const) {
        const bytes = r[form];
        if (bytes === undefined) continue;
        const other = json(readDfm(bytes));
        compared++;
        if (other !== text) {
          let i = 0;
          while (text[i] === other[i]) i++;
          problems.push(`${r.group}/${r.name} ${form}: ${text.substring(i - 60, i + 60)} <> ${other.substring(i - 60, i + 60)}`);
        }
      }
    }
    expect(problems.slice(0, 5)).toEqual([]);
    expect(compared).toBeGreaterThan(80);
  });

  it('reads the DFMs saved by older versions of Delphi', () => {
    for (const o of originals()) {
      const tree = readDfm(o.dfm);
      expect(tree.className, o.name).toBe('TRpReport');
      expect(['text', 'zlib-binary', 'zlib-text', 'binary']).toContain(reportForm(o.dfm));
    }
  });

  it('reads the values of the text grammar', () => {
    const text = `object TRpReport
  A = -12
  B = $FF
  C = 1.5
  D = 2.5s
  E = 12345678c
  F = 45351.5d
  G = 'it''s'#13#10'x' +
    'y'
  H = Null
  I = nil
  J = True
  K = [rpDrawerBefore, rpDrawerAfter]
  L.Strings = (
    'a'
    'b')
  M = {
    0A0B
    0C}
  N = 3000000000
  O = <
    item [2]
      X = 1
    end>
  object Child: TRpLabel
    P = Other.Name
  end
end
`;
    const tree = readDfm(new TextEncoder().encode(text));
    const values = Object.fromEntries(tree.properties.map((p) => [p.name, p.value]));
    expect(values.A).toEqual({ type: 'integer', value: -12 });
    expect(values.B).toEqual({ type: 'integer', value: 255 });
    expect(values.C).toEqual({ type: 'extended', value: 1.5 });
    expect(values.D).toEqual({ type: 'single', value: 2.5 });
    expect(values.E).toEqual({ type: 'currency', value: 1234.5678 });
    expect(values.F).toEqual({ type: 'date', value: 45351.5 });
    expect(values.G).toEqual({ type: 'string', value: "it's\r\nxy" });
    expect(values.H).toEqual({ type: 'null' });
    expect(values.I).toEqual({ type: 'nil' });
    expect(values.J).toEqual({ type: 'boolean', value: true });
    expect(values.K).toEqual({ type: 'set', value: ['rpDrawerBefore', 'rpDrawerAfter'] });
    expect(values['L.Strings']).toEqual({ type: 'list', value: [{ type: 'string', value: 'a' }, { type: 'string', value: 'b' }] });
    expect(values.M).toEqual({ type: 'binary', value: new Uint8Array([10, 11, 12]) });
    expect(values.N).toEqual({ type: 'int64', value: 3000000000n });
    expect(values.O).toEqual({ type: 'collection', value: [{ index: 2, properties: [{ name: 'X', value: { type: 'integer', value: 1 } }] }] });
    expect(tree.children[0]).toMatchObject({ className: 'TRpLabel', name: 'Child', properties: [{ name: 'P', value: { type: 'ident', value: 'Other.Name' } }] });
  });
});
