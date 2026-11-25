// The element's files served by the designer server: the page with <reportman-designer>, the
// element's files and Monaco's from their folders, never a file outside them.

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createDesignerServer, type DesignerServer } from '@reportman/designer-server';

let folder: string;
let server: DesignerServer;
const get = (p: string, query = '') =>
  server.handle({ method: 'GET', path: p, query: new URLSearchParams(query), headers: {}, remoteAddress: '127.0.0.1' });
const text = (body: Uint8Array) => new TextDecoder().decode(body);

beforeAll(() => {
  folder = fs.mkdtempSync(path.join(os.tmpdir(), 'rp-element-'));
  fs.mkdirSync(path.join(folder, 'element', 'assets', 'fonts'), { recursive: true });
  fs.mkdirSync(path.join(folder, 'monaco', 'vs'), { recursive: true });
  fs.writeFileSync(path.join(folder, 'element', 'main.js'), 'export {};');
  fs.writeFileSync(path.join(folder, 'element', 'assets', 'fonts', 'fonts.css'), '/* fonts */');
  fs.writeFileSync(path.join(folder, 'monaco', 'vs', 'loader.js'), '/* loader */');
  fs.writeFileSync(path.join(folder, 'secret.txt'), 'no');
  server = createDesignerServer({
    aliases: { REPORTS: folder },
    basePath: '/reportman',
    element: { folder: path.join(folder, 'element'), monaco: path.join(folder, 'monaco') },
  });
});

afterAll(() => {
  fs.rmSync(folder, { recursive: true, force: true });
});

describe('@reportman/designer-server: the element', () => {
  it('owns the designer routes and the element under its base path only', () => {
    expect(server.owns('/reportman/designer/')).toBe(true);
    expect(server.owns('/reportman/designer/main.js')).toBe(true);
    expect(server.owns('/reportman/api/designer/ReadReport')).toBe(true);
    expect(server.owns('/designer/main.js')).toBe(false);
    expect(server.owns('/reportman/api/reports/aliases')).toBe(false);
    expect(server.routes()).toEqual(['/reportman/api/designer/*', '/reportman/designer', '/reportman/designer/*']);
  });

  it('gives a page with the element, its API under the base path and without AI', async () => {
    const page = await get('/reportman/designer/', 'report=REPORTS/sales.rep&lang=en');
    expect(page.status).toBe(200);
    expect(page.headers['content-type']).toBe('text/html; charset=utf-8');
    const html = text(page.body);
    expect(html).toContain('<script type="module" src="/reportman/designer/main.js"></script>');
    expect(html).toContain('<reportman-designer no-ai api-base="/reportman/api" report="REPORTS/sales.rep" lang="en">');
    // Nothing from another site
    expect(page.headers['content-security-policy']).toContain("default-src 'self'");
    expect(html).not.toMatch(/https?:\/\//);
  });

  it('escapes the report name of the page', async () => {
    const html = text((await get('/reportman/designer/', 'report="><script>x</script>')).body);
    expect(html).not.toContain('<script>x</script>');
    expect(html).toContain('report="&#34;&#62;&#60;script&#62;x&#60;/script&#62;"');
  });

  it('serves the element and Monaco from their folders', async () => {
    const main = await get('/reportman/designer/main.js');
    expect(main.status).toBe(200);
    expect(main.headers['content-type']).toBe('text/javascript; charset=utf-8');
    expect(text(main.body)).toBe('export {};');
    expect(text((await get('/reportman/designer/assets/fonts/fonts.css')).body)).toBe('/* fonts */');
    const loader = await get('/reportman/designer/assets/monaco-editor/min/vs/loader.js');
    expect(loader.status).toBe(200);
    expect(text(loader.body)).toBe('/* loader */');
  });

  it('never serves a file outside the folders', async () => {
    for (const p of ['/reportman/designer/../secret.txt', '/reportman/designer/assets/monaco-editor/min/../../../secret.txt', '/reportman/designer/nope.js'])
      expect((await get(p)).status).toBe(404);
  });
});
