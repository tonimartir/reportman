// CHSTOCHT and CHTTOCHS: the table of the engines against texts Windows mapped whole with
// LCMapString (fixtures/chinese.json, from test/generate-chinese-tables.mjs): the conversion is one
// character for one, so the table gives what Windows gives for any text.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { createContext, Evaluator, RpDateTime } from '@reportman/engine';

const here = path.dirname(fileURLToPath(import.meta.url));
const texts = JSON.parse(fs.readFileSync(path.join(here, 'fixtures', 'chinese.json'), 'utf8')) as { text: string; traditional: string; simplified: string }[];

function evaluate(text: string): string {
  const ev = new Evaluator({ context: createContext('en-US', { now: () => RpDateTime.create(2026, 11, 22, 9, 0, 0) }) });
  ev.expression = text;
  return ev.evaluate().toString();
}
const q = (s: string): string => "'" + s.replace(/'/g, "''") + "'";

describe('CHSTOCHT and CHTTOCHS', () => {
  it('give what LCMapString of Windows gives (zh-CN, traditional and simplified)', () => {
    expect(texts.length).toBeGreaterThan(10);
    for (const t of texts) {
      expect(evaluate(`CHSTOCHT(${q(t.text)})`), t.text).toBe(t.traditional);
      expect(evaluate(`CHTTOCHS(${q(t.text)})`), t.text).toBe(t.simplified);
    }
  });

  it('convert CHTTOCHS to simplified Chinese, not to traditional as Delphi did', () => {
    expect(evaluate("CHTTOCHS('繁體中文測試')")).toBe('繁体中文测试');
    expect(evaluate("CHSTOCHT('简体中文测试')")).toBe('簡體中文測試');
  });
});
