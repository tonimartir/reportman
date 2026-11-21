// The errors of the server as FirebirdClient reports them (FbException): one line per status vector
// entry, its message with its arguments, joined by new lines (IscException.BuildExceptionMessage).
//
// node-firebird gives an Error whose message joins the texts of its own message table with ", ",
// and only the first entry's code and arguments. The entries are recovered by matching the message
// against that table, then written with the texts FirebirdClient uses: its own where it words them
// differently (the messages a report usually meets: SQL, conversion, arithmetic, lock, login and
// network errors), node-firebird's for the rest.

import { createRequire } from 'node:module';
import { NetException } from '@reportman/engine';

/** An error of the Firebird server or of the wire (FirebirdSql.Data.FirebirdClient.FbException). */
export class FbException extends NetException {
  /** The code of the first status vector entry (FbException.ErrorCode). */
  readonly errorCode: number;
  /** The status vector entries, as far as they can be told from the node-firebird message. */
  readonly errors: readonly StatusEntry[];

  constructor(message: string, errorCode = 0, errors: readonly StatusEntry[] = []) {
    super('FbException', message);
    this.errorCode = errorCode;
    this.errors = errors;
  }
}

/** A status vector entry: an error code and its arguments. */
export interface StatusEntry {
  readonly code: number;
  readonly params: readonly string[];
}

// FirebirdClient's text of the codes whose node-firebird text is worded differently
// (IscErrorMessages of FirebirdClient 10.3).
const CLIENT_TEXTS: Readonly<Record<number, string>> = {
  335544321: 'arithmetic exception, numeric overflow, or string truncation',
  335544323: 'file {0} is not a valid database',
  335544334: 'conversion error from string "{0}"',
  335544336: 'deadlock',
  335544344: 'I/O error during "{0}" operation for file "{1}"',
  335544345: 'lock conflict on no wait transaction',
  335544347: 'validation error for column {0}, value "{1}"',
  335544352: 'no permission for {0} access to {1} {2}',
  335544451: 'update conflicts with concurrent update',
  335544466: 'violation of FOREIGN KEY constraint "{0}" on table "{1}"',
  335544472: 'Your user name and password are not defined. Ask your database administrator to set up a Firebird login.',
  335544528: 'database {0} shutdown',
  335544583: 'SQLDA error',
  335544652: 'multiple rows in singleton select',
  335544665: 'violation of PRIMARY or UNIQUE KEY constraint "{0}" on table "{1}"',
  335544669: 'count of column list and variable list do not match',
  335544721: 'Unable to complete network request to host "{0}".',
  335544772: 'Floating-point divide by zero.  The code attempted to divide a floating-point value by zero.',
  335544775: 'Floating-point overflow.  The exponent of a floating-point operation is greater than the magnitude allowed.',
  335544777: 'Floating-point underflow.  The exponent of a floating-point operation is less than the magnitude allowed.',
  335544778: 'Integer divide by zero.  The code attempted to divide an integer value by an integer divisor of zero.',
  335544779: 'Integer overflow.  The result of an integer operation caused the most significant bit of the result to carry.',
  335544810: 'value exceeds the range for valid dates',
  335544822: 'Cannot use an aggregate or window function in a WHERE clause, use HAVING (for aggregate only) instead',
  335544823: 'Cannot use an aggregate or window function in a GROUP BY clause',
};

/** isc_random: a message that is only its argument. */
const GENERIC = 335544382;

interface Template {
  code: number;
  text: string;
  regex: RegExp;
  /** The placeholder number of each regex group. */
  slots: number[];
  /** The characters of the text that are not placeholders. */
  literal: number;
}

let templates: Template[] | undefined;
let table: Readonly<Record<string, string>> | undefined;

function messageTable(): Readonly<Record<string, string>> {
  if (table === undefined) {
    try {
      const require = createRequire(import.meta.url);
      table = require('node-firebird/lib/firebird.msg.json') as Record<string, string>;
    } catch {
      table = {};
    }
  }
  return table;
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function allTemplates(): Template[] {
  if (templates === undefined) {
    templates = [];
    for (const [key, text] of Object.entries(messageTable())) {
      const slots: number[] = [];
      let pattern = '';
      let literal = 0;
      let last = 0;
      for (const m of text.matchAll(/@(\d)/g)) {
        const part = text.substring(last, m.index);
        pattern += escapeRegExp(part);
        literal += part.length;
        pattern += '([\\s\\S]*?)';
        slots.push(Number(m[1]));
        last = m.index + m[0].length;
      }
      pattern += escapeRegExp(text.substring(last));
      literal += text.length - last;
      templates.push({ code: Number(key), text, regex: new RegExp('^' + pattern + '$'), slots, literal });
    }
  }
  return templates;
}

/** utils.lookupMessages of node-firebird for one entry. */
function nodeText(code: number, params: readonly unknown[]): string | undefined {
  let text = messageTable()[String(code)];
  if (text === undefined) return undefined;
  params.forEach((param, i) => {
    text = text!.replace('@' + String(i + 1), () => String(param));
  });
  return text;
}

/**
 * The status vector behind a node-firebird message: its first entry is known; the others are the
 * parse of the rest of the message that explains the most of its text with message texts.
 */
export function recoverStatus(message: string, code: number | undefined, params: readonly unknown[] | undefined): StatusEntry[] | undefined {
  if (code === undefined) return undefined;
  const first = nodeText(code, params ?? []);
  if (first === undefined || !message.startsWith(first)) return undefined;
  const head: StatusEntry = { code, params: (params ?? []).map((p) => String(p)) };
  const rest = message.substring(first.length);
  if (rest.length === 0) return [head];
  if (!rest.startsWith(', ')) return undefined;
  const text = rest.substring(2);
  // Each entry ends at a ", " or at the end
  const ends: number[] = [];
  for (let i = text.indexOf(', '); i >= 0; i = text.indexOf(', ', i + 1)) ends.push(i);
  ends.push(text.length);
  const starts = [0, ...ends.slice(0, -1).map((e) => e + 2)];
  // The best parse explains the most text with message texts; then it has the fewest arguments
  // holding a ', ' (the arguments of Firebird are names and numbers), then the fewest entries
  interface Best {
    score: number;
    commas: number;
    count: number;
    entries: StatusEntry[];
  }
  const memo = new Map<number, Best | null>();
  const solve = (start: number): Best | null => {
    if (start === text.length) return { score: 0, commas: 0, count: 0, entries: [] };
    const cached = memo.get(start);
    if (cached !== undefined) return cached;
    let best: Best | null = null;
    for (const end of ends) {
      if (end < start) continue;
      const next = end === text.length ? text.length : end + 2;
      if (next !== text.length && !starts.includes(next)) continue;
      const piece = text.substring(start, end);
      const tail = solve(next);
      if (tail === null) continue;
      for (const t of allTemplates()) {
        const m = t.regex.exec(piece);
        if (m === null) continue;
        const args: string[] = [];
        t.slots.forEach((slot, i) => {
          args[slot - 1] = m[i + 1]!;
        });
        const score = tail.score + (t.code === GENERIC ? 0 : t.literal);
        const commas = tail.commas + args.filter((a) => a !== undefined && a.includes(', ')).length;
        const count = tail.count + 1;
        const better =
          best === null ||
          score > best.score ||
          (score === best.score && (commas < best.commas || (commas === best.commas && count < best.count)));
        if (better) best = { score, commas, count, entries: [{ code: t.code, params: args.map((a) => a ?? '') }, ...tail.entries] };
      }
    }
    memo.set(start, best);
    return best;
  };
  const parsed = solve(0);
  return parsed === null ? undefined : [head, ...parsed.entries];
}

/** The FirebirdClient text of a status entry. */
function clientText(entry: StatusEntry): string {
  const client = CLIENT_TEXTS[entry.code];
  if (client !== undefined) return client.replace(/\{(\d)\}/g, (_, n: string) => entry.params[Number(n)] ?? '');
  return nodeText(entry.code, entry.params) ?? 'No message for error code ' + String(entry.code) + ' found.';
}

/** The FbException of an error of node-firebird (an Error with gdscode and gdsparams). */
export function fbException(e: unknown): Error {
  if (e instanceof NetException) return e;
  if (!(e instanceof Error)) return new FbException(String(e));
  const err = e as Error & { gdscode?: number; gdsparams?: unknown[] };
  if (err.gdscode === undefined) {
    // An error of the wire, not of the server (a closed connection, a refused socket...)
    const wire = new FbException(err.message);
    (wire as { cause?: unknown }).cause = e;
    return wire;
  }
  const entries = recoverStatus(err.message, err.gdscode, err.gdsparams);
  const message = entries === undefined ? err.message.replace(/, /g, '\n') : entries.map(clientText).join('\n');
  const result = new FbException(message, err.gdscode, entries ?? []);
  (result as { cause?: unknown }).cause = e;
  return result;
}
