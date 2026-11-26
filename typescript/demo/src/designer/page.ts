// The page of the designer of the live demo: the <reportman-designer> element of @reportman/designer,
// answered by the service worker of this folder (sw.ts) instead of a server, the AI copilot included.
// The element and Monaco are files of this folder (element/); the samples, the database and the
// fonts are the demo's. «New report» makes a report on the samples' database and, with a request, the
// copilot designs it with the subschema chosen (the subschemas of samples/dbxschemas/SAMPLES.json,
// the local schema of the samples' connection); a sample opens with the subschema its datasets name.
import { loadSamples, type Sample } from '../sample-list.js';
import { OWN_REPORTS, STORE_CACHE, storeKey } from './names.js';
import './designer.css';

const lang = document.documentElement.lang === 'es' ? 'es' : 'en';
const TEXTS = {
  en: {
    sample: 'Report',
    samples: 'Samples',
    own: 'Your reports',
    restore: 'Restore the samples',
    restoreAsk: 'Restore every sample as it was? The changes you saved in this browser and the reports you made are lost.',
    download: 'Download .rep',
    newReport: 'New report',
    switchAsk: 'The report has changes that are not saved. Open another one anyway?',
    starting: 'Starting the designer…',
    noWorker: 'This browser does not run service workers (or they are blocked here), and the designer of the demo needs one: it is its server.',
    failed: 'The designer could not start: ',
    dialogTitle: 'New report',
    name: 'Name',
    schema: 'Schema (the tables the AI designs with)',
    prompt: 'What should it show? (the AI copilot designs it; leave it empty to design it yourself)',
    promptExample: 'Example: the orders of each customer with their lines and totals, grouped by country',
    create: 'Create',
    cancel: 'Cancel',
    badName: 'A name of letters, digits, spaces, - and _.',
    exists: 'There is already a report with that name.',
    tables: 'tables',
  },
  es: {
    sample: 'Informe',
    samples: 'Ejemplos',
    own: 'Tus informes',
    restore: 'Restaurar los ejemplos',
    restoreAsk: '¿Restaurar todos los ejemplos como estaban? Se pierden los cambios que hayas guardado en este navegador y los informes que hayas creado.',
    download: 'Descargar .rep',
    newReport: 'Nuevo informe',
    switchAsk: 'El informe tiene cambios sin guardar. ¿Abrir otro de todos modos?',
    starting: 'Iniciando el diseñador…',
    noWorker: 'Este navegador no ejecuta service workers (o están bloqueados aquí), y el diseñador de la demo necesita uno: es su servidor.',
    failed: 'El diseñador no ha podido arrancar: ',
    dialogTitle: 'Nuevo informe',
    name: 'Nombre',
    schema: 'Esquema (las tablas con las que diseña la IA)',
    prompt: '¿Qué debe mostrar? (lo diseña el copiloto de IA; déjalo vacío para diseñarlo tú)',
    promptExample: 'Por ejemplo: los pedidos de cada cliente con sus líneas y totales, agrupados por país',
    create: 'Crear',
    cancel: 'Cancelar',
    badName: 'Un nombre de letras, cifras, espacios, - y _.',
    exists: 'Ya hay un informe con ese nombre.',
    tables: 'tablas',
  },
}[lang];

const demoBase = new URL('../', location.href).href;
const apiBase = new URL('./api', location.href).pathname;
const LAST = 'reportman-designer-demo-sample';

const $ = <T extends HTMLElement>(id: string): T => document.getElementById(id) as T;
const host = $<HTMLDivElement>('designer');
const status = $<HTMLParagraphElement>('designer-status');
const select = $<HTMLSelectElement>('designer-sample');

function stored(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function store(key: string, value: string | null): void {
  try {
    if (value === null) localStorage.removeItem(key);
    else localStorage.setItem(key, value);
  } catch {
    // a private window
  }
}

/** The names of the reports the visitor made here. */
function ownReports(): string[] {
  try {
    const list = JSON.parse(stored(OWN_REPORTS) ?? '[]') as unknown;
    return Array.isArray(list) ? list.filter((n): n is string => typeof n === 'string') : [];
  } catch {
    return [];
  }
}

/** Resolves when a service worker that is installing or waiting is the active one, or was discarded. */
function activated(worker: ServiceWorker): Promise<void> {
  return new Promise((resolve) => {
    const check = () => {
      if (worker.state === 'activated' || worker.state === 'redundant') {
        worker.removeEventListener('statechange', check);
        resolve();
      }
    };
    worker.addEventListener('statechange', check);
    check();
  });
}

/**
 * The service worker of this folder, controlling the page, and the one of this version of the demo: a
 * browser that came before keeps the worker it installed then (the server of the designer as it was),
 * so the page asks for the new one now and waits until it answers, instead of talking to the old one.
 */
async function worker(): Promise<void> {
  if (!('serviceWorker' in navigator)) throw new Error(TEXTS.noWorker);
  let registration: ServiceWorkerRegistration;
  try {
    registration = await navigator.serviceWorker.register('./sw.js', { scope: './', updateViaCache: 'none' });
  } catch {
    // A private window of some browsers, a browser embedded in an application, a policy
    throw new Error(TEXTS.noWorker);
  }
  try {
    // sw.js is read again now: when it changed, the new worker starts installing
    await registration.update();
  } catch {
    // offline: the worker there is will do
  }
  const next = registration.installing ?? registration.waiting;
  if (next !== null) {
    // It takes over at once (skipWaiting and clients.claim): the page waits for it to be the one that answers
    const taken = new Promise<void>((resolve) => navigator.serviceWorker.addEventListener('controllerchange', () => resolve(), { once: true }));
    await activated(next);
    if (next.state === 'activated' && navigator.serviceWorker.controller?.scriptURL !== undefined && navigator.serviceWorker.controller !== next)
      await Promise.race([taken, new Promise((r) => setTimeout(r, 3000))]);
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

/**
 * A new designer on a report (a new element: it opens its report when it starts). With a request, the
 * copilot designs it with that subschema as soon as it opens.
 */
function open(name: string, design?: { prompt: string; subschema: string }): void {
  current?.remove();
  const designer = document.createElement('reportman-designer') as DesignerElement;
  designer.setAttribute('api-base', apiBase);
  designer.setAttribute('lang', lang);
  designer.setAttribute('report', 'SAMPLES/' + name + '.rep');
  if (design !== undefined && design.prompt.length > 0) {
    designer.setAttribute('design-prompt', design.prompt);
    designer.setAttribute('design-subschema', design.subschema);
  }
  host.appendChild(designer);
  current = designer;
  select.value = name;
  store(LAST, name);
}

/** The .rep of a report as it is now: the copy saved in this browser, else the sample. */
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

/** The list: the samples, then the reports made here. */
function fillList(samples: Sample[]): void {
  select.replaceChildren();
  const group = (label: string, items: { name: string; title: string }[]) => {
    if (items.length === 0) return;
    const g = document.createElement('optgroup');
    g.label = label;
    for (const item of items) {
      const option = document.createElement('option');
      option.value = item.name;
      option.textContent = item.title;
      g.appendChild(option);
    }
    select.appendChild(g);
  };
  group(TEXTS.samples, samples.map((s) => ({ name: s.name, title: s.title })));
  group(TEXTS.own, ownReports().map((n) => ({ name: n, title: n })));
}

/** The subschemas of the samples' connection: what the copilot designs with. */
async function subschemas(): Promise<{ name: string; description: string; tables: number }[]> {
  try {
    const reply = await fetch(new URL('samples/dbxschemas/SAMPLES.json', demoBase).href);
    const file = (await reply.json()) as { schemas?: { name?: string; description?: string; tables?: unknown[] }[] };
    return (file.schemas ?? [])
      .filter((s) => typeof s.name === 'string' && s.name.length > 0)
      .map((s) => ({ name: s.name!, description: s.description ?? '', tables: s.tables?.length ?? 0 }));
  } catch {
    return [];
  }
}

/** The dialog of «New report»: a name, a subschema and the request for the copilot. */
function newReportDialog(schemas: { name: string; description: string; tables: number }[], taken: (name: string) => boolean): Promise<{ name: string; subschema: string; prompt: string } | null> {
  const dialog = document.createElement('dialog');
  dialog.className = 'designer-new';
  const form = document.createElement('form');
  form.method = 'dialog';
  const title = document.createElement('h2');
  title.textContent = TEXTS.dialogTitle;
  const field = (label: string, control: HTMLElement): HTMLLabelElement => {
    const l = document.createElement('label');
    const span = document.createElement('span');
    span.textContent = label;
    l.append(span, control);
    return l;
  };
  const name = document.createElement('input');
  name.required = true;
  name.maxLength = 60;
  name.pattern = '[A-Za-z0-9][A-Za-z0-9 _\\-]*';
  let n = 1;
  while (taken('report' + n)) n++;
  name.value = 'report' + n;
  const schema = document.createElement('select');
  for (const s of schemas) {
    const option = document.createElement('option');
    option.value = s.name;
    option.textContent = s.name + ' (' + s.tables + ' ' + TEXTS.tables + ')' + (s.description ? ' · ' + s.description : '');
    schema.appendChild(option);
  }
  const prompt = document.createElement('textarea');
  prompt.rows = 4;
  prompt.placeholder = TEXTS.promptExample;
  const error = document.createElement('p');
  error.className = 'designer-new-error';
  error.setAttribute('role', 'alert');
  const buttons = document.createElement('div');
  buttons.className = 'designer-new-buttons';
  const cancel = document.createElement('button');
  cancel.type = 'button';
  cancel.className = 'btn';
  cancel.textContent = TEXTS.cancel;
  const create = document.createElement('button');
  create.type = 'submit';
  create.className = 'btn btn-primary';
  create.textContent = TEXTS.create;
  buttons.append(cancel, create);
  form.append(title, field(TEXTS.name, name), field(TEXTS.schema, schema), field(TEXTS.prompt, prompt), error, buttons);
  dialog.appendChild(form);
  document.body.appendChild(dialog);
  return new Promise((resolve) => {
    let result: { name: string; subschema: string; prompt: string } | null = null;
    cancel.addEventListener('click', () => dialog.close());
    form.addEventListener('submit', (e) => {
      const value = name.value.trim();
      if (!/^[A-Za-z0-9][A-Za-z0-9 _-]{0,59}$/.test(value)) {
        e.preventDefault();
        error.textContent = TEXTS.badName;
        return;
      }
      if (taken(value)) {
        e.preventDefault();
        error.textContent = TEXTS.exists;
        return;
      }
      result = { name: value, subschema: schema.value, prompt: prompt.value.trim() };
    });
    dialog.addEventListener('close', () => {
      dialog.remove();
      resolve(result);
    });
    dialog.showModal();
    name.select();
  });
}

async function start(): Promise<void> {
  $<HTMLLabelElement>('designer-sample-label').textContent = TEXTS.sample;
  const restore = $<HTMLButtonElement>('designer-restore');
  const save = $<HTMLButtonElement>('designer-download');
  const create = $<HTMLButtonElement>('designer-new');
  restore.textContent = TEXTS.restore;
  save.textContent = TEXTS.download;
  create.textContent = TEXTS.newReport;
  status.textContent = TEXTS.starting;
  const [samples] = await Promise.all([loadSamples(demoBase, lang), worker(), element()]);
  fillList(samples as Sample[]);
  const names = () => [...(samples as Sample[]).map((s) => s.name), ...ownReports()];
  const query = new URLSearchParams(location.search).get('report');
  const first = [query, stored(LAST), 'customers', names()[0]].find((n) => n !== null && n !== undefined && names().includes(n))!;
  const nameOf = (designer: HTMLElement | null) => (designer?.getAttribute('report') ?? '').replace(/^SAMPLES\//, '').replace(/\.rep$/, '');
  const leave = (): boolean => !(current?.modified === true && !confirm(TEXTS.switchAsk));
  select.addEventListener('change', () => {
    if (!leave()) {
      select.value = nameOf(current);
      return;
    }
    open(select.value);
  });
  restore.addEventListener('click', async () => {
    if (!confirm(TEXTS.restoreAsk)) return;
    await caches.delete(STORE_CACHE);
    store(OWN_REPORTS, null);
    fillList(samples as Sample[]);
    open((samples as Sample[]).some((s) => s.name === select.value) ? select.value : 'customers');
  });
  save.addEventListener('click', () => void download(select.value));
  const schemas = await subschemas();
  create.addEventListener('click', async () => {
    if (!leave()) return;
    const taken = (n: string) => names().some((m) => m.toLowerCase() === n.toLowerCase());
    const chosen = await newReportDialog(schemas, taken);
    if (chosen === null) return;
    const reply = await fetch(apiBase + '/demo/NewReport', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ name: chosen.name }) });
    if (!reply.ok) {
      status.textContent = TEXTS.failed + (reply.status === 409 ? TEXTS.exists : ((await reply.json().catch(() => ({}))) as { error?: string }).error ?? String(reply.status));
      status.classList.add('error');
      return;
    }
    status.textContent = '';
    status.classList.remove('error');
    store(OWN_REPORTS, JSON.stringify([...ownReports(), chosen.name]));
    fillList(samples as Sample[]);
    open(chosen.name, { prompt: chosen.prompt, subschema: chosen.subschema });
  });
  status.textContent = '';
  open(first);
}

start().catch((e: unknown) => {
  const message = e instanceof Error ? e.message : String(e);
  status.textContent = message === TEXTS.noWorker ? message : TEXTS.failed + message;
  status.classList.add('error');
});
