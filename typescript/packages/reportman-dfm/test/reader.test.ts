// The reader of the DFM forms: the text, binary and zlib forms Delphi writes for a report give the
// same tree (the same objects, properties and values), and the DFMs of older versions are read.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { DfmError, decodeUtf8Strict, readDfm, reportForm, writeStringRoundTrip, type DfmObject } from '../src/reader.js';
import { corpus, originals } from './corpus.js';

const fixtures = path.join(path.dirname(fileURLToPath(import.meta.url)), 'fixtures');
const unitsHex = (s: string): string => Array.from({ length: s.length }, (_, i) => s.charCodeAt(i).toString(16).padStart(4, '0')).join('');

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
      expect(['text', 'zlib-binary', 'binary']).toContain(reportForm(o.dfm));
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

  it('decodes UTF-8 as TEncoding.UTF8.GetString: an invalid sequence is an error (fixtures/utf8.json, from Delphi)', () => {
    const cases = JSON.parse(fs.readFileSync(path.join(fixtures, 'utf8.json'), 'utf8')) as Record<string, string | null>;
    const wrong: string[] = [];
    for (const [hex, expected] of Object.entries(cases)) {
      let actual: string | null;
      try {
        actual = unitsHex(decodeUtf8Strict(new Uint8Array(Buffer.from(hex, 'hex'))));
      } catch (e) {
        if (!(e instanceof DfmError)) throw e;
        actual = null;
      }
      if (actual !== expected) wrong.push(`${hex}: Delphi ${expected}, dfm ${actual}`);
    }
    expect(wrong).toEqual([]);
    expect(Object.values(cases).filter((v) => v === null).length).toBeGreaterThan(50);
  });

  it('keeps a string of the text form as TWriter.WriteString and TReader.ReadString do (fixtures/writestring.json, from Delphi)', () => {
    const cases = JSON.parse(fs.readFileSync(path.join(fixtures, 'writestring.json'), 'utf8')) as Record<string, { type: number; value: string }>;
    const wrong: string[] = [];
    for (const [hex, expected] of Object.entries(cases)) {
      const s = String.fromCharCode(...(hex.match(/.{4}/g) ?? []).map((h) => Number.parseInt(h, 16)));
      const actual = unitsHex(writeStringRoundTrip(s));
      if (actual !== expected.value) wrong.push(`${hex}: Delphi ${expected.value} (value type ${expected.type}), dfm ${actual}`);
    }
    expect(wrong).toEqual([]);
    // Some lone surrogates become U+FFFD (vaUTF8String) and others stay (vaWString)
    expect(Object.values(cases).some((c) => c.type === 20 && c.value.includes('fffd'))).toBe(true);
    expect(Object.values(cases).some((c) => c.type === 18 && /d[89ab]..(?!d[c-f])/.test(c.value))).toBe(true);
  });

  it('reads a string on a line longer than the 4096 bytes of the buffer of TParser, which Delphi can not', () => {
    // RpObjectBinaryToText of the Lazarus port wrote a string on one line until 22-11-2026; Delphi
    // says "Line too long"
    const long = 'x'.repeat(6000) + 'ñ';
    const one = `object TRpReport\r\n  DocTitle = '${'x'.repeat(6000)}'#241\r\nend\r\n`;
    const fragments = 'x'.repeat(6000).match(/.{1,64}/g) ?? [];
    const split = `object TRpReport\r\n  DocTitle = \r\n    ${fragments.map((c) => `'${c}'`).join(' +\r\n    ')}#241\r\nend\r\n`;
    expect(readDfm(new TextEncoder().encode(one)).properties[0]!.value).toEqual({ type: 'string', value: long });
    expect(readDfm(new TextEncoder().encode(split)).properties[0]!.value).toEqual({ type: 'string', value: long });
  });

  it('follows TParser: blanks, codes without digits, wrapped and hexadecimal codes, one token after the end', () => {
    const text = "object TRpReport\x0c\r\n\x01A = 'a'#'b'#$41#4294967361\x1f\r\n  B = #$20ac#128512\r\n  C = 2.5f\r\n  D = 1.\r\nend\r\n\x1agarbage 'not closed";
    const values = Object.fromEntries(readDfm(new Uint8Array(Buffer.from(text, 'latin1'))).properties.map((p) => [p.name, p.value]));
    expect(values.A).toEqual({ type: 'string', value: 'a\0bAA' });
    expect(values.B).toEqual({ type: 'string', value: '€' });
    expect(values.C).toEqual({ type: 'extended', value: 2.5 });
    expect(values.D).toEqual({ type: 'extended', value: 1 });
    expect(() => readDfm(new TextEncoder().encode("object TRpReport\r\n  A = 'not closed\r\nend\r\n"))).toThrow(DfmError);
    expect(() => readDfm(new TextEncoder().encode('object TRpReport\r\n  A = +5\r\nend\r\n'))).toThrow(DfmError);
  });
});
