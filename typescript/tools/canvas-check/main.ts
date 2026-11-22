// The page of tools/check-canvas.mjs: each case drawn by @reportman/canvas at 100 dpi, every page
// on its own canvas, and its pixels sent back in gray (the weights of poppler's gray, 0.3 0.59
// 0.11) for the script to compare with the raster of the PDF.
import { readRpmf } from '@reportman/metafile';
import { FontLibrary, memoryFontFile } from '@reportman/text';
import { CanvasPreview } from '@reportman/canvas';

interface CaseInfo {
  name: string;
  pages: number[];
  fonts: string[] | null;
}

const DPI = 100;
const out = document.getElementById('out')!;
const lines: string[] = [navigator.userAgent];

async function bytesOf(url: string): Promise<Uint8Array> {
  const r = await fetch(url);
  if (!r.ok) throw new Error(url + ': ' + String(r.status));
  return new Uint8Array(await r.arrayBuffer());
}

const cases = (await (await fetch('/__cases')).json()) as CaseInfo[];
for (const c of cases) {
  const meta = readRpmf(await bytesOf('/__rpmf?name=' + encodeURIComponent(c.name)));
  let fonts: FontLibrary | undefined;
  if (c.fonts !== null) {
    const files = await Promise.all(c.fonts.map(async (f) => memoryFontFile(f, await bytesOf('/__font?path=' + encodeURIComponent(f)))));
    fonts = new FontLibrary(files, { platform: 'windows' });
  }
  const preview = new CanvasPreview({ fonts });
  for (const pageIndex of c.pages) {
    const scale = DPI / 96;
    const size = preview.pageSize(meta, pageIndex, scale);
    const canvas = document.createElement('canvas');
    canvas.width = size.width;
    canvas.height = size.height;
    document.getElementById('pages')!.appendChild(canvas);
    const ctx = canvas.getContext('2d', { willReadFrequently: true })!;
    const started = performance.now();
    const result = await preview.drawPage(ctx, meta, pageIndex, { scale });
    const ms = performance.now() - started;
    const rgba = ctx.getImageData(0, 0, size.width, size.height).data;
    const gray = new Uint8Array(size.width * size.height);
    for (let i = 0; i < gray.length; i++)
      gray[i] = Math.round(0.3 * (rgba[i * 4] as number) + 0.59 * (rgba[i * 4 + 1] as number) + 0.11 * (rgba[i * 4 + 2] as number));
    const skipped = result.skipped.map((s) => `${s.objectIndex}: ${s.reason}`);
    const query = `case=${encodeURIComponent(c.name)}&page=${pageIndex}&w=${size.width}&h=${size.height}&ms=${ms.toFixed(0)}&skipped=${encodeURIComponent(JSON.stringify(skipped))}`;
    await fetch('/__page?' + query, { method: 'POST', body: gray });
    lines.push(`${c.name} page ${pageIndex + 1}: ${size.width} x ${size.height}, ${ms.toFixed(0)} ms, ${skipped.length} skipped`);
    out.textContent = lines.join('\n');
    // Only the last pages stay on the page
    if (document.getElementById('pages')!.childElementCount > 4) document.getElementById('pages')!.firstElementChild!.remove();
  }
}
lines.push('RESULT: drawn');
out.textContent = lines.join('\n');
await fetch('/__result', { method: 'POST', body: lines.join('\n') });
