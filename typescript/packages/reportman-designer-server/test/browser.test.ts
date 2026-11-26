// @reportman/designer-server/browser: the designer protocol without Node.js, over a backend the host
// gives (the live demo of reportman.es answers its designer so, from a service worker). Its modules
// import nothing of Node (nor the Node packages), and the protocol works over another store and
// another way of running reports: here a store in memory, asynchronous like the browser's caches.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { openReportModel, sqlite } from '@reportman/node';
import {
  DesignerOperations,
  DesignerProtocol,
  bytesToBase64,
  base64ToBytes,
  type DesignerBackend,
  type ServerRequest,
} from '@reportman/designer-server/browser';

const here = path.dirname(fileURLToPath(import.meta.url));
const src = path.resolve(here, '../src');
const samples = path.resolve(here, '../../../../samples');

describe('the browser entry', () => {
  it('imports no Node.js module, nor the Node packages, at run time', () => {
    const seen = new Set<string>();
    const outside: string[] = [];
    const visit = (file: string): void => {
      if (seen.has(file)) return;
      seen.add(file);
      const text = fs.readFileSync(file, 'utf8');
      for (const m of text.matchAll(/^\s*(import|export)\s+(type\s+)?[^;]*?from\s+'([^']+)'/gm)) {
        const isType = m[2] !== undefined;
        const spec = m[3]!;
        if (spec.startsWith('.')) visit(path.resolve(path.dirname(file), spec.replace(/\.js$/, '.ts')));
        else if (!isType && (spec.startsWith('node:') || spec === '@reportman/node' || spec === '@reportman/server')) outside.push(path.basename(file) + ' -> ' + spec);
      }
    };
    visit(path.join(src, 'browser.ts'));
    expect(outside).toEqual([]);
    expect([...seen].map((f) => path.basename(f))).toContain('operations.ts');
  });

  it('writes and reads base64 as Buffer does', () => {
    for (const length of [0, 1, 2, 3, 4, 5, 255, 1000]) {
      const bytes = Uint8Array.from({ length }, (_, i) => (i * 37 + length) & 255);
      expect(bytesToBase64(bytes)).toBe(Buffer.from(bytes).toString('base64'));
      expect(base64ToBytes(Buffer.from(bytes).toString('base64'))).toEqual(bytes);
    }
    expect(base64ToBytes('QU\nJD\r\n')).toEqual(new Uint8Array([65, 66, 67]));
  });
});

/** A backend over a store in memory, the samples and their SQLite database. */
function memoryBackend(): DesignerBackend & { saved: Map<string, Uint8Array> } {
  const saved = new Map<string, Uint8Array>();
  const notFound = (p: string) => Object.assign(new Error(`'${p}' does not exist.`), { kind: 'notFound' });
  const tag = (bytes: Uint8Array) => 'tag' + bytes.length + ':' + bytes.reduce((a, b) => (a * 31 + b) >>> 0, 7);
  const read = async (alias: string, p: string): Promise<Uint8Array | null> => {
    await Promise.resolve();
    const key = alias + '/' + p;
    if (saved.has(key)) return saved.get(key)!;
    const file = path.join(samples, p);
    return alias === 'SAMPLES' && fs.existsSync(file) ? new Uint8Array(fs.readFileSync(file)) : null;
  };
  const connection = sqlite(path.join(samples, 'samples.db'));
  return {
    saved,
    store: {
      async open(alias, p) {
        const content = await read(alias, p);
        if (content === null) throw notFound(p);
        return { content, eTag: tag(content) };
      },
      async save(alias, p, content, expected) {
        const current = await read(alias, p);
        if ((current === null ? null : tag(current)) !== expected) throw Object.assign(new Error(`'${p}' was modified by someone else.`), { kind: 'conflict' });
        saved.set(alias + '/' + p, content);
        return { eTag: tag(content) };
      },
    },
    open(model) {
      const report = openReportModel(model, { fonts: false, connections: Object.fromEntries(model.databaseInfo.map((d) => [d.alias, connection])) });
      return {
        prepareRun: () => report.prepareRun(),
        executeToPdf: ({ subReportIndexes, onMetafile }) => report.executeToPdf(null, { defaults: true, subReportIndexes, onMetafile }),
      };
    },
    fingerprint: () => 'samples.db',
    schemaConnection: (alias) => ({ kind: 'direct', alias, family: 'sqlite', factory: connection, definition: null, keepsFile: false, fingerprint: 'samples.db' }),
  };
}

function post(route: string, body: unknown): ServerRequest {
  return { method: 'POST', path: route, query: new URLSearchParams(), headers: { 'content-type': 'application/json' }, body: new TextEncoder().encode(JSON.stringify(body)) };
}

async function json(protocol: DesignerProtocol, request: ServerRequest): Promise<{ status: number; body: Record<string, any> }> {
  const reply = await protocol.handle(request);
  return { status: reply.status, body: JSON.parse(new TextDecoder().decode(reply.body)) };
}

describe('the protocol over another backend', () => {
  it('refuses everything without authorize', async () => {
    const protocol = new DesignerProtocol(new DesignerOperations(memoryBackend()));
    const r = await json(protocol, post('/api/designer/ReadReport', { reportName: 'SAMPLES/customers.rep' }));
    expect(r.body.errorMessage).toBe('The designer protocol was given no authorize function.');
  });

  it('opens, previews, saves with the ETag and answers the tools', async () => {
    const backend = memoryBackend();
    const protocol = new DesignerProtocol(new DesignerOperations(backend), { authorize: () => true, basePath: '/demo/designer' });
    expect(protocol.owns('/demo/designer/api/designer/ReadReport')).toBe(true);
    expect(protocol.owns('/demo/designer/index.html')).toBe(false);
    const route = (r: string) => '/demo/designer/api/designer/' + r;

    const opened = await json(protocol, post(route('ReadReport'), { reportName: 'SAMPLES/customers.rep' }));
    expect(opened.body.errorMessage).toBeUndefined();
    const doc = opened.body.report;
    expect(doc.subReports.length).toBe(1);

    const preview = await json(protocol, post(route('ExecuteReport'), { report: doc }));
    expect(preview.body.noData).toBe(false);
    expect(preview.body.result.pageCount).toBeGreaterThan(0);
    expect(new TextDecoder().decode(base64ToBytes(preview.body.result.base64Pdf).subarray(0, 5))).toBe('%PDF-');

    doc.copies = 3;
    const saved = await json(protocol, post(route('WriteReport'), { reportName: 'SAMPLES/customers.rep', report: doc, properties: [{ name: 'eTag', value: opened.body.eTag }] }));
    expect(saved.body.eTag).toBeDefined();
    expect(backend.saved.has('SAMPLES/customers.rep')).toBe(true);
    const stale = await json(protocol, post(route('WriteReport'), { reportName: 'SAMPLES/customers.rep', report: doc, properties: [{ name: 'eTag', value: opened.body.eTag }] }));
    expect(stale.body.errorMessage).toContain('modified by someone else');
    // A name that does not exist yet is created
    const created = await json(protocol, post(route('WriteReport'), { reportName: 'SAMPLES/mine.rep', report: doc }));
    expect(created.body.errorMessage).toBeUndefined();
    const reopened = await json(protocol, post(route('ReadReport'), { reportName: 'SAMPLES/mine.rep' }));
    expect(reopened.body.report.copies).toBe(3);

    const functions = await json(protocol, post(route('ReadReport'), { operation: 3, report: doc }));
    expect(functions.body.functions.some((f: { name: string }) => f.name === 'CUST.COMPANY_NAME')).toBe(true);
    const data = await json(protocol, post(route('ReadReport'), { operation: 6, report: doc, datasetName: 'CUST', expression: doc.dataInfo[0].sql }));
    expect(data.body.dataSets[0].rows.length).toBeGreaterThan(10);
    const schema = await protocol.handle({ method: 'GET', path: route('SqlSchema'), query: new URLSearchParams('alias=' + doc.databaseInfo[0].alias), headers: {} });
    const tables = (JSON.parse(new TextDecoder().decode(schema.body)).schemaTables as { name: string }[]).map((t) => t.name);
    expect(tables).toContain('CUSTOMERS');
  });
});
