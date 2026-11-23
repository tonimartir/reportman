// The page of `node demo/demo.mjs check`: every sample run in the browser as the demo runs it
// (sql.js, the open fonts, with the standard 14 fonts too), with a fixed clock, each PDF posted
// back for the script to compare with the PDF @reportman/node writes for it; and the first page of
// each preview drawn, to see that the canvas draws everything.
import { CanvasPreview } from '@reportman/canvas';
import type { PdfClock } from '@reportman/pdf';
import { loadSamples, needsTrueType, openSample } from './samples.js';

export const CHECK_CLOCK: PdfClock = {
  now: () => new Date(Date.UTC(2026, 0, 15, 9, 30, 0)),
  offsetMinutes: () => 60,
};

const out = document.getElementById('out')!;
const lines: string[] = [navigator.userAgent];
const show = (): void => void (out.textContent = lines.join('\n'));

const samples = await loadSamples('./', 'en');
for (const s of samples) {
  for (const trueType of [true, false]) {
    const mode = trueType ? 'truetype' : 'standard';
    try {
      const opened = await openSample('./', s.name, { trueType, culture: 'en-US', clock: CHECK_CLOCK });
      const t0 = performance.now();
      const pdf = await opened.report.executeToPdf({});
      const t1 = performance.now();
      await fetch(`/__pdf?name=${encodeURIComponent(s.name)}&mode=${mode}`, { method: 'POST', body: pdf as BodyInit });
      const meta = await opened.report.executeToMetafile({});
      const preview = new CanvasPreview({ fonts: opened.fonts });
      const size = preview.pageSize(meta, 0, 1);
      const canvas = new OffscreenCanvas(size.width, size.height);
      const t2 = performance.now();
      const drawn = await preview.drawPage(canvas.getContext('2d')!, meta, 0, { scale: 1 });
      const t3 = performance.now();
      const skipped = drawn.skipped.map((k) => k.reason);
      lines.push(
        `${s.name} ${mode}: pdf ${pdf.length} bytes in ${Math.round(t1 - t0)} ms, ${meta.pages.currentCount} pages, ` +
          `page 1 drawn in ${Math.round(t3 - t2)} ms` + (skipped.length > 0 ? `, SKIPPED ${skipped.length}: ${[...new Set(skipped)].join('; ')}` : ''),
      );
    } catch (e) {
      // HTML text and right to left text need the TrueType fonts: the page says so
      if (!trueType && needsTrueType(e)) lines.push(`${s.name} ${mode}: needs the TrueType fonts (${(e as Error).message})`);
      else lines.push(`${s.name} ${mode}: FAILED ${e instanceof Error ? (e.stack ?? e.message) : String(e)}`);
    }
    show();
  }
}
lines.push('RESULT: done');
show();
await fetch('/__result', { method: 'POST', body: lines.join('\n') });
