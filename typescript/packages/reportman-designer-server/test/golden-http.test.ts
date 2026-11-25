// golden-http: the requests of golden-http/cases.json replayed against the Node servers (the designer
// server and the report server it mounts, @reportman/server), in order,
// on a fresh data folder with the sample reports installed, and each answer compared with the one
// Reportman.Server (C#) gave (golden-http/recorded.json, see golden-http/README.md). C# is the
// reference: a difference is a bug of the Node server, unless it is listed in DIFFERENCES below
// with its reason.

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { inflateSync } from 'node:zlib';
import { createHash } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { goldenServer, type GoldenHandler } from './golden-http/server.js';

interface GoldenCase {
  name: string;
  method: string;
  path: string;
  json?: unknown;
  form?: Record<string, string>;
  raw?: string;
  contentType?: string;
  expect?: 'json' | 'text' | 'pdf' | 'metafile' | 'binary' | 'status';
  mask?: string[];
  decode?: string[];
  pdf?: string[];
}
interface Recorded {
  name: string;
  status: number;
  contentType: string | null;
  contentDisposition: string | null;
  body: unknown;
}

const here = path.dirname(fileURLToPath(import.meta.url));
const folder = path.join(here, 'golden-http');
const samples = path.resolve(here, '../../../../samples');
const cases = (JSON.parse(fs.readFileSync(path.join(folder, 'cases.json'), 'utf8')) as { cases: GoldenCase[] }).cases;
const recordedDoc = JSON.parse(fs.readFileSync(path.join(folder, 'recorded.json'), 'utf8')) as { recordedOn: string; cases: Recorded[] };
const recorded = new Map(recordedDoc.cases.map((c) => [c.name, c]));

/**
 * The answers that differ from Reportman.Server on purpose, by case name: what differs and why.
 * Everything else must be equal.
 */
const DIFFERENCES: Record<string, string> = {};

/** The fields of an answer the Node server adds, by case name (documented in the README). */
const EXTENSIONS: Record<string, string[]> = {
  health: ['console'],
};

/** Cases whose route the Node server does not answer yet (none). */
const PENDING = new Set<string>([]);

/**
 * Members compared by what they mean, not by their text: replaced on both sides before comparing.
 * httpAgentBaseUrl of a connection the .rep does not set is the default of the engine, which C#
 * compiles in: "https://api.reportman.es:7006" in a Debug build (the one the answers were recorded
 * with), "https://aiapi.reportman.es" in a Release build (the one Node gives).
 */
function semantic(body: unknown): unknown {
  const report = (body as { report?: { databaseInfo?: Record<string, unknown>[] } } | null)?.report;
  for (const db of report?.databaseInfo ?? []) {
    if (db.httpAgentBaseUrl === 'https://api.reportman.es:7006' || db.httpAgentBaseUrl === 'https://aiapi.reportman.es') db.httpAgentBaseUrl = '<engine default>';
  }
  return body;
}

let handler: GoldenHandler;
let dataPath: string;
const answers = new Map<string, { status: number; contentType: string | null; contentDisposition: string | null; body: unknown }>();
const raw = new Map<string, unknown>();

beforeAll(async () => {
  dataPath = fs.mkdtempSync(path.join(os.tmpdir(), 'rpsrv-golden-'));
  handler = goldenServer(dataPath, new Date(recordedDoc.recordedOn + 'T12:00:00'));
  // As a new installation of Reportman.Server: the sample reports and their connection
  const installed = await handler({ method: 'POST', path: '/api/console/samples', query: new URLSearchParams(), headers: {} });
  if (installed.status !== 200) throw new Error('Installing the samples answered ' + installed.status);
  for (const c of cases) {
    const answer = await send(c);
    answers.set(c.name, answer);
  }
}, 600_000);

afterAll(() => {
  fs.rmSync(dataPath, { recursive: true, force: true });
});

async function send(c: GoldenCase) {
  const q = c.path.indexOf('?');
  const route = q < 0 ? c.path : c.path.substring(0, q);
  const query = new URLSearchParams(q < 0 ? '' : c.path.substring(q + 1));
  const headers: Record<string, string> = {};
  let body: Uint8Array | undefined;
  if (c.json !== undefined) {
    headers['content-type'] = 'application/json; charset=utf-8';
    body = new TextEncoder().encode(JSON.stringify(resolve(c.json)));
  } else if (c.form !== undefined) {
    headers['content-type'] = 'application/x-www-form-urlencoded';
    body = new TextEncoder().encode(new URLSearchParams(c.form).toString());
  } else if (c.raw !== undefined) {
    headers['content-type'] = c.contentType ?? 'text/plain';
    body = new TextEncoder().encode(c.raw);
  }
  const reply = await handler({ method: c.method, path: decodeURIComponent(route), query, headers, body });
  const contentType = reply.headers['content-type'] ?? null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(new TextDecoder().decode(reply.body));
  } catch {
    parsed = undefined;
  }
  raw.set(c.name, parsed);
  return {
    status: reply.status,
    contentType,
    contentDisposition: reply.headers['content-disposition'] ?? null,
    body: normalize(bodyOf(c, reply.status, reply.body, parsed)),
  };
}

/** The body of a request with its references resolved ($case/$path, $base64file, $json). */
function resolve(node: unknown): unknown {
  if (Array.isArray(node)) return node.map(resolve);
  if (node === null || typeof node !== 'object') return node;
  const o = node as Record<string, unknown>;
  if ('$case' in o) return structuredClone(pick(raw.get(o.$case as string), o.$path as string));
  if ('$base64file' in o) return fs.readFileSync(path.join(samples, o.$base64file as string)).toString('base64');
  if ('$json' in o) return JSON.stringify(resolve(o.$json));
  return Object.fromEntries(Object.entries(o).map(([k, v]) => [k, resolve(v)]));
}

function pick(node: unknown, dotted: string): unknown {
  for (const key of dotted.split('.')) node = node !== null && typeof node === 'object' ? (node as Record<string, unknown>)[key] : undefined;
  return node;
}

/** The answer normalized as the case says (the same rules as the recorder of C#). */
function bodyOf(c: GoldenCase, status: number, bytes: Uint8Array, parsed: unknown): unknown {
  const expect = c.expect ?? 'json';
  if (expect === 'status') return null;
  if (status >= 400 || expect === 'json') {
    if (parsed === undefined) return { $text: new TextDecoder().decode(bytes) };
    const body = structuredClone(parsed);
    for (const p of c.mask ?? []) replace(body, p, () => '<masked>');
    for (const p of c.decode ?? []) replace(body, p, (v) => Buffer.from(v as string, 'base64').toString('utf8'));
    for (const p of c.pdf ?? []) replace(body, p, (v) => ({ pages: pdfPages(Buffer.from(v as string, 'base64')) }));
    return body;
  }
  switch (expect) {
    case 'text':
      return new TextDecoder('utf-8', { ignoreBOM: true }).decode(bytes);
    case 'pdf':
      return { pdf: Buffer.from(bytes.subarray(0, 5)).toString('latin1') === '%PDF-', pages: pdfPages(bytes) };
    case 'metafile': {
      return { metafile: inflateSync(bytes).subarray(0, 10).toString('latin1') === 'RPMETAFILE' };
    }
    case 'binary': {
      return { size: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex') };
    }
    default:
      throw new Error('Unknown expect ' + expect);
  }
}

function replace(node: unknown, dotted: string, change: (v: unknown) => unknown): void {
  const [first, ...rest] = dotted.split('.');
  if (first === '*') {
    if (Array.isArray(node)) for (const item of node) replace(item, rest.join('.'), change);
    return;
  }
  if (node === null || typeof node !== 'object' || Array.isArray(node)) return;
  const o = node as Record<string, unknown>;
  if (o[first!] === undefined || o[first!] === null) return;
  if (rest.length === 0) o[first!] = change(o[first!]);
  else replace(o[first!], rest.join('.'), change);
}

function pdfPages(pdf: Uint8Array): number {
  return (Buffer.from(pdf).toString('latin1').match(/\/Type\s*\/Page(?![A-Za-z])/g) ?? []).length;
}

/** What depends on the machine and the day: the data folder and the day of the recording. */
function normalize(node: unknown): unknown {
  if (Array.isArray(node)) return node.map(normalize);
  if (node !== null && typeof node === 'object') return Object.fromEntries(Object.entries(node).map(([k, v]) => [k, normalize(v)]));
  if (typeof node !== 'string') return node;
  let s = node;
  for (const form of [dataPath, dataPath.replaceAll('\\', '/')]) {
    let at = s.toLowerCase().indexOf(form.toLowerCase());
    while (at >= 0) {
      let end = at + form.length;
      while (end < s.length && s[end] !== '"' && s[end] !== ';' && !/\s/.test(s[end]!)) end++;
      s = s.substring(0, at) + '<data>' + s.substring(at + form.length, end).replaceAll('\\', '/') + s.substring(end);
      at = s.toLowerCase().indexOf(form.toLowerCase());
    }
  }
  const [y, m, d] = recordedDoc.recordedOn.split('-');
  const p2 = (v: string) => v.padStart(2, '0');
  for (const date of [`${p2(m!)}/${p2(d!)}/${y}`, `${+m!}/${+d!}/${y}`, `${p2(d!)}/${p2(m!)}/${y}`, `${+d!}/${+m!}/${y}`, `${y}-${p2(m!)}-${p2(d!)}`]) s = s.replaceAll(date, '<today>');
  return s;
}

describe('golden-http: @reportman/server answers as Reportman.Server', () => {
  for (const c of cases) {
    const expected = recorded.get(c.name);
    const pending = PENDING.has(c.name);
    it.skipIf(pending || expected === undefined)(c.name + (DIFFERENCES[c.name] ? ' (differs: ' + DIFFERENCES[c.name] + ')' : ''), () => {
      const actual = answers.get(c.name)!;
      if (DIFFERENCES[c.name] !== undefined) return;
      const body = actual.body as Record<string, unknown>;
      for (const field of EXTENSIONS[c.name] ?? []) delete body[field];
      expect({ status: actual.status, body: semantic(actual.body) }).toEqual({ status: expected!.status, body: semantic(structuredClone(expected!.body)) });
      if (c.expect !== 'status') {
        expect(actual.contentType).toBe(expected!.contentType);
        expect(actual.contentDisposition).toBe(expected!.contentDisposition);
      }
    });
  }
});
