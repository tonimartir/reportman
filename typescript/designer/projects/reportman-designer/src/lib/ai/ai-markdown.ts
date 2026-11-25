import { Marked, Tokens } from 'marked';

/** The words the rendered markdown shows; the chat passes them translated. */
export interface AiMarkdownLabels {
  thinking: string;
  copy: string;
}

let labels: AiMarkdownLabels = { thinking: 'Reasoning', copy: 'Copy' };

const escapeHtml = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

const safeUrl = (href: string) => /^(https?:|mailto:)/i.test(href.trim());

/**
 * GitHub-flavoured markdown the way chat pages show it, with what an AI answer must not do
 * removed: raw HTML is shown as text (not interpreted), images are never fetched (a model that
 * read a poisoned value could otherwise leak data in an image URL; they become links), links open
 * in a new tab so the designer is never left, and fenced code gets a header with its language and
 * a Copy action. Angular's sanitizer still runs on the result.
 */
const md = new Marked({
  gfm: true,
  breaks: true,
  renderer: {
    html({ text }: Tokens.HTML | Tokens.Tag): string {
      return escapeHtml(text);
    },
    link(this: any, { href, title, tokens }: Tokens.Link): string {
      const inner = this.parser.parseInline(tokens);
      if (!href || !safeUrl(href)) return inner;
      return '<a href="' + escapeHtml(href) + '"' + (title ? ' title="' + escapeHtml(title) + '"' : '') + ' target="_blank" rel="noopener noreferrer">' + inner + '</a>';
    },
    image({ href, text }: Tokens.Image): string {
      const alt = escapeHtml(text || href || '');
      return href && safeUrl(href) ? '<a href="' + escapeHtml(href) + '" target="_blank" rel="noopener noreferrer">' + alt + '</a>' : alt;
    },
    code({ text, lang }: Tokens.Code): string {
      const language = (lang || '').trim().split(/\s+/)[0] ?? '';
      return '<div class="rp-code"><div class="rp-code-head"><span class="rp-code-lang">' + escapeHtml(language) + '</span>' +
        '<span class="rp-code-copy" role="button" tabindex="0">' + escapeHtml(labels.copy) + '</span></div>' +
        '<pre><code>' + escapeHtml(text) + '</code></pre></div>';
    },
  },
});

function renderPlain(text: string): string {
  try {
    return md.parse(text, { async: false }) as string;
  } catch {
    return '<p>' + escapeHtml(text) + '</p>';
  }
}

function thinkBlock(content: string, open: boolean): string {
  const body = content.trim();
  if (!body && !open) return '';
  return '<details class="rp-think"' + (open ? ' open' : '') + '><summary>' + escapeHtml(labels.thinking) + '</summary>' +
    '<div class="rp-think-body">' + (body ? renderPlain(body) : '…') + '</div></details>';
}

/**
 * Renders an AI text (whole or still streaming) as HTML. `<think>…</think>` becomes a collapsible
 * "Reasoning" block, open while the model is still thinking and closed once it has finished, the
 * way the Delphi designer shows reasoning models.
 */
export function renderAiMarkdown(text: string, words?: AiMarkdownLabels): string {
  if (!text) return '';
  if (words) labels = words;
  if (!/<think>/i.test(text)) return renderPlain(text);
  let html = '';
  let rest = text;
  for (;;) {
    const start = rest.search(/<think>/i);
    if (start < 0) { html += renderPlain(rest); break; }
    if (start > 0) html += renderPlain(rest.slice(0, start));
    rest = rest.slice(start + 7);
    const end = rest.search(/<\/think>/i);
    if (end < 0) { html += thinkBlock(rest, true); break; }
    html += thinkBlock(rest.slice(0, end), false);
    rest = rest.slice(end + 8);
  }
  return html;
}

/**
 * The Copy of a fenced code block. The rendered markdown is plain HTML, so whoever shows it
 * listens for clicks (and Enter/Space) on its container and passes them here; returns whether the
 * event was such a Copy.
 */
export function handleCodeCopy(event: Event, words: { copy: string; copied: string }): boolean {
  if (event instanceof KeyboardEvent && event.key !== 'Enter' && event.key !== ' ') return false;
  const button = (event.target as HTMLElement | null)?.closest?.('.rp-code-copy') as HTMLElement | null;
  if (!button) return false;
  event.preventDefault();
  const code = button.closest('.rp-code')?.querySelector('code')?.textContent ?? '';
  copyToClipboard(code).then((done) => {
    if (!done) return;
    button.textContent = words.copied;
    setTimeout(() => (button.textContent = words.copy), 1500);
  });
  return true;
}

/** Writes text to the clipboard: the async API where the page allows it, the selection trick elsewhere (an http LAN address). */
export async function copyToClipboard(text: string): Promise<boolean> {
  try {
    if (navigator.clipboard && window.isSecureContext) { await navigator.clipboard.writeText(text); return true; }
  } catch { /* fall back */ }
  const area = document.createElement('textarea');
  area.value = text;
  area.setAttribute('readonly', '');
  area.style.position = 'fixed';
  area.style.opacity = '0';
  document.body.appendChild(area);
  area.select();
  let done = false;
  try { done = document.execCommand('copy'); } catch { done = false; }
  area.remove();
  return done;
}
