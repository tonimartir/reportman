// The functions of the Delphi engine that read files (LOADFILE, GETINIVALUE) and the rules around
// them that the expression fixtures cannot show. The expected values are the ones of the Delphi
// evaluator (TRpEvaluator, 22-11-2026), except LOADFILE: in Delphi 2009 and later it reads the bytes
// into a UTF-16 string and gives garbage, so the engines give what it gave before Unicode (the bytes
// as ANSI characters), which UTF8TOWIDESTRING(LOADFILE(f)) then reads as UTF-8.

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { createContext, DatasetAlias, Evaluator, MemoryTable, RpDateTime, Variant, VariantType } from '@reportman/engine';

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'reportman-delphi-'));
afterAll(() => fs.rmSync(dir, { recursive: true, force: true }));
const file = (name: string, bytes: number[] | string): string => {
  const p = path.join(dir, name);
  fs.writeFileSync(p, typeof bytes === 'string' ? Buffer.from(bytes, 'latin1') : Buffer.from(bytes));
  return p;
};

const now = () => RpDateTime.create(2026, 11, 22, 9, 30, 15);
const filesHost = {
  now,
  fileExists: (p: string) => fs.existsSync(p),
  readFile: (p: string) => (fs.existsSync(p) && fs.statSync(p).isFile() ? new Uint8Array(fs.readFileSync(p)) : undefined),
  fileFunctions: true,
};

function evaluate(text: string, host: object = filesHost): Variant {
  const ev = new Evaluator({ context: createContext('es-ES', { now }), host: host as typeof filesHost });
  ev.expression = text;
  return ev.evaluate();
}
const q = (s: string): string => "'" + s.replace(/'/g, "''") + "'";

describe('LOADFILE', () => {
  it('gives the bytes as ANSI characters, whatever the file holds', () => {
    expect(evaluate(`LOADFILE(${q(file('ansi.txt', 'caf\xe9\r\nline2'))})`).toString()).toBe('café\r\nline2');
    expect(evaluate(`LOADFILE(${q(file('utf8.txt', [0x63, 0x61, 0x66, 0xc3, 0xa9]))})`).toString()).toBe('cafÃ©');
    expect(evaluate(`LOADFILE(${q(file('bom.txt', [0xef, 0xbb, 0xbf, 0x61]))})`).toString()).toBe('ï»¿a');
    expect(evaluate(`LOADFILE(${q(file('c1.txt', [0x80, 0x81, 0x9f]))})`).toString()).toBe('€\u0081Ÿ');
    expect(evaluate(`LOADFILE(${q(file('empty.txt', []))})`).toString()).toBe('');
    expect(evaluate(`UTF8TOWIDESTRING(LOADFILE(${q(path.join(dir, 'utf8.txt'))}))`).toString()).toBe('café');
  });

  it('fails for a file that is not there and for a value that is not a text', () => {
    const missing = path.join(dir, 'missing.txt');
    expect(() => evaluate(`LOADFILE(${q(missing)})`)).toThrow('File not found:' + missing);
    expect(() => evaluate("LOADFILE('')")).toThrow('File not found:');
    expect(() => evaluate('LOADFILE(1)')).toThrow();
  });
});

describe('GETINIVALUE', () => {
  const ini = file('test.ini', '[Main]\r\nKey=Value\r\nSpaced = with spaces  \r\nQuoted="quoted"\r\nEmpty=\r\n[Other]\r\nkey=lower\r\nKey=Second\r\n');
  const odd = file('odd.ini', 'top=before\r\n  [ Spaced ]  \r\nFlag\r\n=nokey\r\n;Key=comment\r\n Key = v1 \r\n[Dup]\r\nA=1\r\n[dup]\r\nA=2\r\nB=3\r\n\r\n[Last]\r\nX = a = b\r\n');
  const read = (f: string, section: string, name: string): string => evaluate(`GETINIVALUE(${q(f)},${q(section)},${q(name)},'def')`).toString();

  it('reads a value as TMemIniFile', () => {
    expect(read(ini, 'Main', 'Key')).toBe('Value');
    expect(read(ini, 'main', 'KEY')).toBe('Value');
    expect(read(ini, 'Main', 'Spaced')).toBe('with spaces');
    expect(read(ini, 'Main', 'Quoted')).toBe('"quoted"');
    expect(read(ini, 'Main', 'Empty')).toBe('');
    expect(read(ini, 'Main', 'Nope')).toBe('def');
    expect(read(ini, 'Nope', 'Key')).toBe('def');
    expect(read(ini, 'Other', 'Key')).toBe('lower');
    expect(read(path.join(dir, 'missing.ini'), 'Main', 'Key')).toBe('def');
  });

  it('keeps the first of a repeated section, skips comments and names without a value', () => {
    expect(read(odd, 'Spaced', 'Flag')).toBe('def');
    expect(read(odd, 'Spaced', 'Key')).toBe('v1');
    expect(read(odd, 'Spaced', '')).toBe('nokey');
    expect(read(odd, 'Dup', 'A')).toBe('1');
    expect(read(odd, 'Dup', 'B')).toBe('def');
    expect(read(odd, 'Last', 'X')).toBe('a = b');
    expect(read(odd, '', 'top')).toBe('def');
  });

  it('reads a UTF-8 or UTF-16 file by its byte order mark, else ANSI', () => {
    const utf8 = file('u8.ini', [0xef, 0xbb, 0xbf, ...Buffer.from('[S]\nK=café\n', 'utf8')]);
    const utf16 = file('u16.ini', [0xff, 0xfe, ...Buffer.from('[S]\nK=é\n', 'utf16le')]);
    const ansi = file('ansi.ini', '[S]\nK=caf\xe9\n');
    expect(read(utf8, 'S', 'K')).toBe('café');
    expect(read(utf16, 'S', 'K')).toBe('é');
    expect(read(ansi, 'S', 'K')).toBe('café');
  });
});

describe('the file functions need the host to allow them', () => {
  it('fails without fileFunctions, as C# without Evaluator.AllowFileFunctions', () => {
    const host = { now, fileExists: () => true, readFile: () => new Uint8Array([0x61]) };
    expect(() => evaluate("LOADFILE('a.txt')", host)).toThrow('Reading files from expressions is not allowed');
    expect(() => evaluate("GETINIVALUE('a.ini','S','K','d')", host)).toThrow('Reading files from expressions is not allowed');
  });
});

describe('TIME', () => {
  it('is the time of now on day 0001-01-01, a time column for the engine', () => {
    const v = evaluate('TIME');
    expect(v.varType).toBe(VariantType.DateTime);
    expect(evaluate('YEAR(TIME)').toString()).toBe('1');
    // As Delphi: a time compares as a fraction of a day
    expect(evaluate('(TIME>0) AND (TIME<1)').toString()).toBe('True');
  });

  it('gives way to a field named TIME of a report, which C# reports could already read unqualified', () => {
    const ev = new Evaluator({ context: createContext('es-ES', { now }), host: filesHost });
    const alias = new DatasetAlias();
    alias.add('shifts', new MemoryTable(['TIME', 'NAME'], [['morning', 'a']]), 0);
    ev.aliasList = alias;
    ev.expression = 'TIME';
    expect(ev.evaluate().toString(ev.context)).toBe('morning');
    ev.expression = 'SHIFTS.TIME';
    expect(ev.evaluate().toString(ev.context)).toBe('morning');
  });
});
