// The page of the designer of the live demo: the <reportman-designer> element of @reportman/designer,
// answered by the service worker of this folder (sw.ts) instead of a server. The element and Monaco
// are files of this folder (element/); the samples, the database and the fonts are the demo's.
import { loadSamples, type Sample } from '../sample-list.js';
import { STORE_CACHE, storeKey } from './names.js';
import './designer.css';

const lang = document.documentElement.lang === 'es' ? 'es' : 'en';
const TEXTS = {
  en: {
    sample: 'Sample report',
    restore: 'Restore the samples',
    restoreAsk: 'Restore every sample as it was? The changes you saved in this browser are lost.',
    download: 'Download .rep',
    switchAsk: 'The report has changes that are not saved. Open another one anyway?',
    starting: 'Starting the designer…',
    noWorker: 'This browser does not run service workers (or they are blocked here), and the designer of the demo needs one: it is its server.',
    failed: 'The designer could not start: ',
  },
  es: {
    sample: 'Informe de ejemplo',
    restore: 'Restaurar los ejemplos',
    restoreAsk: '¿Restaurar todos los ejemplos como estaban? Se pierden los cambios que hayas guardado en este navegador.',
    download: 'Descargar .rep',
    switchAsk: 'El informe tiene cambios sin guardar. ¿Abrir otro de todos modos?',
    starting: 'Iniciando el diseñador…',
    noWorker: 'Este navegador no ejecuta service workers (o están bloqueados aquí), y el diseñador de la demo necesita uno: es su servidor.',
    failed: 'El diseñador no ha podido arrancar: ',
  },
}[lang];

const demoBase = new URL('../', location.href).href;
const apiBase = new URL('./api', location.href).pathname;
const LAST = 'reportman-designer-demo-sample';

const $ = <T extends HTMLElement>(id: string): T => document.getElementById(id) as T;
const host = $<HTMLDivElement>('designer');
const status = $<HTMLParagraphElement>('designer-status');
const select = $<HTMLSelectElement>('designer-sample');

function remembered(): string | null {
  try {
    return localStorage.getItem(LAST);
  } catch {
    return null;
  }
}

function remember(name: string): void {
  try {
    localStorage.setItem(LAST, name);
  } catch {
    // a private window
  }
}

/** The service worker of this folder, controlling the page. */
async function worker(): Promise<void> {
  if (!('serviceWorker' in navigator)) throw new Error(TEXTS.noWorker);
  try {
    await navigator.serviceWorker.register('./sw.js', { scope: './' });
  } catch {
    // A private window of some browsers, a browser embedded in an application, a policy
    throw new Error(TEXTS.noWorker);
  }
  await navigator.serviceWorker.ready;
  if (navigator.serviceWorker.controller === null)
    await new Promise<void>((resolve) => navigator.serviceWorker.addEventListener('controllerchange', () => resolve(), { once: true }));
}

/** The element's script, once. */
let elementLoading: Promise<void> | undefined;
function element(): Promise<void> {
  elementLoading ??= new Promise<void>((resolve, reject) => {
    const script = document.createElement('script');
    script.type = 'module';
    script.src = new URL('./element/main.js', location.href).href;
    script.onload = () => resolve(customElements.whenDefined('reportman-designer').then(() => undefined));
    script.onerror = () => reject(new Error('element/main.js'));
    document.head.appendChild(script);
  });
  return elementLoading;
}

type DesignerElement = HTMLElement & { modified?: boolean };
let current: DesignerElement | null = null;

/** A new designer on a sample (a new element: it opens its report when it starts). */
function open(name: string): void {
  current?.remove();
  const designer = document.createElement('reportman-designer') as DesignerElement;
  designer.setAttribute('no-ai', '');
  designer.setAttribute('api-base', apiBase);
  designer.setAttribute('lang', lang);
  designer.setAttribute('report', 'SAMPLES/' + name + '.rep');
  host.appendChild(designer);
  current = designer;
  select.value = name;
  remember(name);
}

/** The .rep of a sample as it is now: the copy saved in this browser, else the sample. */
async function download(name: string): Promise<void> {
  const cache = await caches.open(STORE_CACHE);
  const saved = await cache.match(storeKey(demoBase, name + '.rep'));
  const response = saved ?? (await fetch(new URL('samples/' + encodeURIComponent(name + '.rep'), demoBase).href));
  const url = URL.createObjectURL(await response.blob());
  const a = document.createElement('a');
  a.href = url;
  a.download = name + '.rep';
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10000);
}

async function start(): Promise<void> {
  $<HTMLLabelElement>('designer-sample-label').textContent = TEXTS.sample;
  const restore = $<HTMLButtonElement>('designer-restore');
  const save = $<HTMLButtonElement>('designer-download');
  restore.textContent = TEXTS.restore;
  save.textContent = TEXTS.download;
  status.textContent = TEXTS.starting;
  const [samples] = await Promise.all([loadSamples(demoBase, lang), worker(), element()]);
  for (const s of samples as Sample[]) {
    const option = document.createElement('option');
    option.value = s.name;
    option.textContent = s.title;
    select.appendChild(option);
  }
  const names = samples.map((s) => s.name);
  const query = new URLSearchParams(location.search).get('report');
  const first = [query, remembered(), 'customers', names[0]].find((n) => n !== null && n !== undefined && names.includes(n))!;
  select.addEventListener('change', () => {
    if (current?.modified === true && !confirm(TEXTS.switchAsk)) {
      select.value = (current.getAttribute('report') ?? '').replace(/^SAMPLES\//, '').replace(/\.rep$/, '');
      return;
    }
    open(select.value);
  });
  restore.addEventListener('click', async () => {
    if (!confirm(TEXTS.restoreAsk)) return;
    await caches.delete(STORE_CACHE);
    open(select.value);
  });
  save.addEventListener('click', () => void download(select.value));
  status.textContent = '';
  open(first);
}

start().catch((e: unknown) => {
  const message = e instanceof Error ? e.message : String(e);
  status.textContent = message === TEXTS.noWorker ? message : TEXTS.failed + message;
  status.classList.add('error');
});
