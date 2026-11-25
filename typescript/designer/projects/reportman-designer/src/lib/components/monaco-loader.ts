import loader from '@monaco-editor/loader';
import type * as Monaco from 'monaco-editor';

/** Monaco's stylesheet in each shadow root, once: done when it loaded (or failed). */
const stylesIn = new WeakMap<ShadowRoot, Promise<void>>();

/**
 * Monaco from the host's copy (monacoUrl, the folder with vs/loader.js), for an editor that will
 * live in `container`. Its loader puts editor.main.css in document's head, which does not reach into
 * a shadow root (<reportman-designer>): there the stylesheet is linked into that root as well, and
 * the editor waits for it (Monaco measures its layout when it is created).
 */
export async function loadMonaco(monacoUrl: string, container: HTMLElement): Promise<typeof Monaco> {
  loader.config({ paths: { vs: monacoUrl } });
  const monaco = await loader.init();
  const root = container.getRootNode();
  if (root instanceof ShadowRoot) {
    let loaded = stylesIn.get(root);
    if (!loaded) {
      const link = document.createElement('link');
      link.rel = 'stylesheet';
      link.href = new URL(monacoUrl.replace(/\/+$/, '') + '/editor/editor.main.css', document.baseURI).href;
      loaded = new Promise<void>((resolve) => {
        link.addEventListener('load', () => resolve(), { once: true });
        link.addEventListener('error', () => resolve(), { once: true });
      });
      stylesIn.set(root, loaded);
      root.appendChild(link);
    }
    await loaded;
  }
  return monaco;
}
