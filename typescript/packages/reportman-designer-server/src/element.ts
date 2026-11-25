// The <reportman-designer> element served by the designer server, from the same origin as its
// API: the files of @reportman/designer under {base}/designer/, Monaco (the SQL and expression
// editor) from the monaco-editor package under {base}/designer/assets/monaco-editor/min/, and a
// page with the element at {base}/designer/?report=ALIAS/path.rep. Nothing is loaded from
// another site: no cross-origin session, and it works without Internet.

import { existsSync, readFileSync, statSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import type { ServerRequest, ServerResponse } from '@reportman/server';

/** Options of the element's files. */
export interface DesignerElementOptions {
  /** The folder of the element's files (the dist of the package @reportman/designer); found by default. */
  folder?: string;
  /** The folder of Monaco's minified files (monaco-editor/min); found by default. */
  monaco?: string;
  /** The page of the designer at {base}/designer/ (true by default). */
  page?: boolean;
}

const TYPES: Record<string, string> = {
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.html': 'text/html; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.map': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.txt': 'text/plain; charset=utf-8',
};

const require = createRequire(import.meta.url);

/** The folder of an installed package, or undefined. */
function packageFolder(name: string): string | undefined {
  try {
    return path.dirname(require.resolve(name + '/package.json'));
  } catch {
    return undefined;
  }
}

let elementFolder: string | undefined | null = null;
let monacoFolder: string | undefined | null = null;

function folders(options: DesignerElementOptions): { element: string | undefined; monaco: string | undefined } {
  if (elementFolder === null) {
    const element = packageFolder('@reportman/designer');
    elementFolder = element === undefined ? undefined : path.join(element, 'dist');
  }
  if (monacoFolder === null) {
    const monaco = packageFolder('monaco-editor');
    monacoFolder = monaco === undefined ? undefined : path.join(monaco, 'min');
  }
  return { element: options.folder ?? elementFolder, monaco: options.monaco ?? monacoFolder };
}

const notFound = (message: string): ServerResponse => ({
  status: 404,
  headers: { 'content-type': 'text/plain; charset=utf-8' },
  body: new TextEncoder().encode(message),
});

/** A file inside a folder (never outside it), or undefined. */
function fileIn(folder: string, parts: string[]): string | undefined {
  if (parts.some((p) => p === '..' || p === '.' || p.includes('\\') || p.includes('\0'))) return undefined;
  const file = path.resolve(folder, ...parts);
  const root = path.resolve(folder) + path.sep;
  if (!file.startsWith(root)) return undefined;
  return existsSync(file) && statSync(file).isFile() ? file : undefined;
}

function fileResponse(file: string): ServerResponse {
  return {
    status: 200,
    headers: {
      'content-type': TYPES[path.extname(file).toLowerCase()] ?? 'application/octet-stream',
      'cache-control': 'no-cache',
      'x-content-type-options': 'nosniff',
    },
    body: new Uint8Array(readFileSync(file)),
  };
}

const escapeHtml = (s: string): string => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

/** The page of the designer: the element on the whole window, the report of ?report=. */
function page(request: ServerRequest, base: string): ServerResponse {
  const report = request.query.get('report') ?? '';
  const lang = request.query.get('lang') ?? '';
  const html = `<!doctype html>
<html>
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Report Manager designer</title>
<style>html, body { margin: 0; height: 100%; } reportman-designer { display: block; height: 100vh; }</style>
<script type="module" src="${base}/designer/main.js"></script>
</head>
<body>
<reportman-designer no-ai api-base="${escapeHtml(base + '/api')}" report="${escapeHtml(report)}"${lang.length > 0 ? ` lang="${escapeHtml(lang)}"` : ''}></reportman-designer>
</body>
</html>
`;
  return {
    status: 200,
    headers: {
      'content-type': 'text/html; charset=utf-8',
      'cache-control': 'no-cache',
      'x-content-type-options': 'nosniff',
      // Nothing from another site; Monaco's workers start from blob: URLs and the preview shows its PDF in a blob: frame
      'content-security-policy':
        "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self' data:; worker-src 'self' blob:; connect-src 'self'; frame-src 'self' blob:; object-src 'self' blob:; frame-ancestors 'self'",
    },
    body: new TextEncoder().encode(html),
  };
}

/** Answers GET {base}/designer/<parts>. */
export function elementResponse(parts: string[], request: ServerRequest, options: DesignerElementOptions, base: string): ServerResponse {
  if (request.method.toUpperCase() !== 'GET' && request.method.toUpperCase() !== 'HEAD') return notFound('Not found.');
  if (parts.length === 0 || (parts.length === 1 && parts[0] === 'index.html')) {
    if (options.page === false) return notFound('Not found.');
    return page(request, base);
  }
  const { element, monaco } = folders(options);
  // assets/monaco-editor/min/...: Monaco's files, from its own package
  if (parts[0] === 'assets' && parts[1] === 'monaco-editor' && parts[2] === 'min') {
    if (monaco === undefined) return notFound('Monaco is not installed: npm install monaco-editor');
    const file = fileIn(monaco, parts.slice(3));
    return file === undefined ? notFound('Not found.') : fileResponse(file);
  }
  if (element === undefined) return notFound('The element is not installed: npm install @reportman/designer');
  const file = fileIn(element, parts);
  return file === undefined ? notFound('Not found.') : fileResponse(file);
}
