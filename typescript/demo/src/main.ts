// The live demo of reportman.es: the sample reports run by the JavaScript engine of the
// @reportman packages in the visitor's browser. Step 1 describes the parameters of a report and
// builds its form; step 2 lays the report out into a metafile drawn page by page on canvases by
// @reportman/canvas, or writes it as a PDF to download. Nothing is sent to a server.
import { CanvasPreview } from '@reportman/canvas';
import type { MetaFile } from '@reportman/metafile';
import { ParamType, type ParameterDescription, type ParameterInput } from '@reportman/engine';
import { loadSamples, needsTrueType, openSample, type OpenedSample, type Sample } from './samples.js';
import './demo.css';

const BASE = './';

const TEXTS = {
  en: {
    loading: 'Loading the samples…',
    preparing: 'Opening the report (the first time it downloads the SQLite engine, the database and the fonts)…',
    running: 'Running the report…',
    run: 'Run',
    pdf: 'Download PDF',
    trueType: 'Embedded TrueType fonts',
    culture: 'Culture',
    noParams: 'This report asks for no parameters.',
    pages: (n: number) => (n === 1 ? '1 page' : `${n} pages`),
    done: (pages: string, layout: number, draw: number) => `${pages}: laid out in ${layout} ms, drawn in ${draw} ms, in your browser.`,
    pdfDone: (kb: number, ms: number) => `PDF of ${kb} KB written in ${ms} ms.`,
    source: 'The report (.rep)',
    error: 'Error',
    needsTrueType: 'This report has HTML text or text from right to left, which are laid out with the TrueType fonts: tick “Embedded TrueType fonts”.',
  },
  es: {
    loading: 'Cargando los ejemplos…',
    preparing: 'Abriendo el informe (la primera vez descarga el motor SQLite, la base de datos y las fuentes)…',
    running: 'Ejecutando el informe…',
    run: 'Ejecutar',
    pdf: 'Descargar PDF',
    trueType: 'Fuentes TrueType incrustadas',
    culture: 'Cultura',
    noParams: 'Este informe no pide parámetros.',
    pages: (n: number) => (n === 1 ? '1 página' : `${n} páginas`),
    done: (pages: string, layout: number, draw: number) => `${pages}: compuesto en ${layout} ms y dibujado en ${draw} ms, en tu navegador.`,
    pdfDone: (kb: number, ms: number) => `PDF de ${kb} KB escrito en ${ms} ms.`,
    source: 'El informe (.rep)',
    error: 'Error',
    needsTrueType: 'Este informe tiene texto HTML o de derecha a izquierda, que se componen con las fuentes TrueType: marca «Fuentes TrueType incrustadas».',
  },
};

const CULTURES = ['en-US', 'es-ES', 'ca-ES', 'de-DE', 'fr-FR', 'it-IT', 'pt-BR'];

const language: 'en' | 'es' = document.documentElement.lang.startsWith('es') ? 'es' : 'en';
const T = TEXTS[language];

const $ = <E extends HTMLElement>(id: string): E => document.getElementById(id) as E;
const list = $<HTMLUListElement>('samples');
const titleEl = $<HTMLHeadingElement>('report-title');
const descEl = $<HTMLParagraphElement>('report-description');
const sourceEl = $<HTMLAnchorElement>('report-source');
const form = $<HTMLFormElement>('params');
const runButton = $<HTMLButtonElement>('run');
const pdfButton = $<HTMLButtonElement>('pdf');
const trueTypeBox = $<HTMLInputElement>('truetype');
const cultureSelect = $<HTMLSelectElement>('culture');
const statusEl = $<HTMLParagraphElement>('status');
const pagesEl = $<HTMLDivElement>('pages');

runButton.textContent = T.run;
pdfButton.textContent = T.pdf;
$<HTMLSpanElement>('truetype-label').textContent = T.trueType;
$<HTMLSpanElement>('culture-label').textContent = T.culture;
sourceEl.textContent = T.source;
for (const c of CULTURES) cultureSelect.add(new Option(c, c));
cultureSelect.value = language === 'es' ? 'es-ES' : 'en-US';

let samples: Sample[] = [];
let current: Sample | null = null;
let parameters: ParameterDescription[] = [];
/** Increases with each selection or run, so an answer that arrives late is dropped. */
let generation = 0;

function setStatus(text: string, error = false): void {
  statusEl.textContent = text;
  statusEl.classList.toggle('error', error);
}

function setBusy(busy: boolean): void {
  runButton.disabled = busy;
  pdfButton.disabled = busy;
  document.body.classList.toggle('busy', busy);
}

function errorText(e: unknown): string {
  // HTML text and right to left text are laid out with the TrueType fonts only
  if (!trueTypeBox.checked && needsTrueType(e)) return T.needsTrueType;
  return `${T.error}: ${e instanceof Error ? e.message : String(e)}`;
}

function open(): Promise<OpenedSample> {
  return openSample(BASE, current!.name, { trueType: trueTypeBox.checked, culture: cultureSelect.value });
}

/** The input of a parameter, by its type. */
function field(p: ParameterDescription): HTMLElement {
  const id = 'param-' + p.name;
  const label = document.createElement('label');
  label.htmlFor = id;
  label.textContent = p.description.trim() || p.name;
  if (p.hint.trim() !== '') label.title = p.hint;
  let input: HTMLInputElement | HTMLSelectElement;
  const value = p.value === null ? '' : String(p.value);
  switch (p.type as ParamType) {
    case ParamType.List:
    case ParamType.SubsExpreList:
    case ParamType.Multiple: {
      const select = document.createElement('select');
      select.multiple = p.type === ParamType.Multiple;
      for (const o of p.options) {
        const option = new Option(o.text, o.value);
        option.selected = select.multiple ? p.selected.includes(o.value) : o.value === value;
        select.add(option);
      }
      input = select;
      break;
    }
    case ParamType.Bool:
      input = document.createElement('input');
      input.type = 'checkbox';
      input.checked = p.value === true;
      break;
    default: {
      input = document.createElement('input');
      const types: Partial<Record<ParamType, string>> = {
        [ParamType.Integer]: 'number',
        [ParamType.Double]: 'number',
        [ParamType.Currency]: 'number',
        [ParamType.Date]: 'date',
        [ParamType.Time]: 'time',
        [ParamType.DateTime]: 'datetime-local',
      };
      input.type = types[p.type as ParamType] ?? 'text';
      if (p.type === ParamType.Integer) input.step = '1';
      else if (input.type === 'number') input.step = 'any';
      else if (p.type === ParamType.Time || p.type === ParamType.DateTime) input.step = '1';
      input.value = p.type === ParamType.DateTime ? value.substring(0, 19) : value;
    }
  }
  input.id = id;
  input.name = p.name;
  input.disabled = !p.editable;
  const wrap = document.createElement('div');
  wrap.className = 'field' + (input instanceof HTMLInputElement && input.type === 'checkbox' ? ' check' : '');
  wrap.append(label, input);
  return wrap;
}

/** The values of the form, by parameter name, as the engine takes them (ParameterInput). */
function values(): Record<string, ParameterInput> {
  const out: Record<string, ParameterInput> = {};
  for (const p of parameters) {
    if (!p.editable) continue;
    const el = form.elements.namedItem(p.name) as HTMLInputElement | HTMLSelectElement | null;
    if (el === null) continue;
    if (el instanceof HTMLSelectElement) out[p.name] = el.multiple ? [...el.selectedOptions].map((o) => o.value) : el.value;
    else if (el.type === 'checkbox') out[p.name] = el.checked;
    else if (el.value === '') out[p.name] = p.allowNulls ? null : '';
    else if (el.type === 'number') out[p.name] = Number(el.value);
    else out[p.name] = el.value;
  }
  return out;
}

/** Draws the pages of a metafile, as wide as the panel. */
async function draw(meta: MetaFile, opened: OpenedSample): Promise<void> {
  const preview = new CanvasPreview({ fonts: opened.fonts });
  pagesEl.replaceChildren();
  // The width the pages have (the panel without its padding); the canvases shrink with it after
  const padding = parseFloat(getComputedStyle(pagesEl).paddingLeft) * 2 || 0;
  const width = Math.max(320, pagesEl.clientWidth - padding);
  const ratio = window.devicePixelRatio || 1;
  for (let i = 0; i < meta.pages.currentCount; i++) {
    const natural = preview.pageSize(meta, i, 1);
    const scale = Math.min(1.5, width / natural.width) * ratio;
    const size = preview.pageSize(meta, i, scale);
    const canvas = document.createElement('canvas');
    canvas.width = size.width;
    canvas.height = size.height;
    canvas.style.width = '100%';
    canvas.style.maxWidth = `${size.width / ratio}px`;
    canvas.setAttribute('role', 'img');
    canvas.setAttribute('aria-label', `${current!.title}, ${i + 1} / ${meta.pages.currentCount}`);
    pagesEl.append(canvas);
    await preview.drawPage(canvas.getContext('2d')!, meta, i, { scale });
  }
}

/** Step 2: the preview of the report with the values of the form. */
async function run(): Promise<void> {
  if (current === null) return;
  const mine = ++generation;
  setBusy(true);
  setStatus(T.running);
  try {
    const opened = await open();
    const t0 = performance.now();
    const meta = await opened.report.executeToMetafile(values());
    const t1 = performance.now();
    if (mine !== generation) return;
    await draw(meta, opened);
    const t2 = performance.now();
    setStatus(T.done(T.pages(meta.pages.currentCount), Math.round(t1 - t0), Math.round(t2 - t1)));
  } catch (e) {
    if (mine === generation) setStatus(errorText(e), true);
  } finally {
    if (mine === generation) setBusy(false);
  }
}

/** Step 2 as a PDF, downloaded. */
async function pdf(): Promise<void> {
  if (current === null) return;
  const mine = ++generation;
  setBusy(true);
  setStatus(T.running);
  try {
    const opened = await open();
    const t0 = performance.now();
    const bytes = await opened.report.executeToPdf(values());
    const ms = Math.round(performance.now() - t0);
    if (mine !== generation) return;
    const url = URL.createObjectURL(new Blob([bytes as BlobPart], { type: 'application/pdf' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = current.name + '.pdf';
    document.body.append(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 60000);
    setStatus(T.pdfDone(Math.round(bytes.length / 1024), ms));
  } catch (e) {
    if (mine === generation) setStatus(errorText(e), true);
  } finally {
    if (mine === generation) setBusy(false);
  }
}

/** Step 1: selects a sample, builds the form of its parameters and runs it. */
async function select(sample: Sample): Promise<void> {
  current = sample;
  const mine = ++generation;
  for (const li of list.children) li.classList.toggle('selected', (li as HTMLElement).dataset.name === sample.name);
  if (location.hash !== '#' + sample.name) history.replaceState(null, '', '#' + sample.name);
  titleEl.textContent = sample.title;
  descEl.textContent = sample.description;
  sourceEl.href = `${BASE}samples/${sample.name}.rep`;
  form.replaceChildren();
  pagesEl.replaceChildren();
  parameters = [];
  setBusy(true);
  setStatus(T.preparing);
  try {
    const opened = await open();
    const described = await opened.report.describeParameters();
    if (mine !== generation) return;
    parameters = described;
    if (described.length === 0) {
      const p = document.createElement('p');
      p.className = 'muted';
      p.textContent = T.noParams;
      form.append(p);
    } else form.append(...described.map(field));
  } catch (e) {
    if (mine === generation) {
      setStatus(errorText(e), true);
      setBusy(false);
    }
    return;
  }
  await run();
}

function renderList(): void {
  list.replaceChildren(
    ...samples.map((s) => {
      const li = document.createElement('li');
      li.dataset.name = s.name;
      const button = document.createElement('button');
      button.type = 'button';
      if (s.thumbnail !== null) {
        const img = document.createElement('img');
        // A small copy of the sample's thumbnail (node demo/demo.mjs thumbs)
        img.src = `${BASE}thumbs/${s.name}.png`;
        img.alt = '';
        img.loading = 'lazy';
        img.width = 60;
        img.height = 85;
        button.append(img);
      }
      const span = document.createElement('span');
      span.textContent = s.title;
      button.append(span);
      button.addEventListener('click', () => void select(s));
      li.append(button);
      return li;
    }),
  );
}

runButton.addEventListener('click', () => void run());
pdfButton.addEventListener('click', () => void pdf());
form.addEventListener('submit', (e) => {
  e.preventDefault();
  void run();
});
trueTypeBox.addEventListener('change', () => void run());
cultureSelect.addEventListener('change', () => void run());

setStatus(T.loading);
try {
  samples = await loadSamples(BASE, language);
  renderList();
  const wanted = samples.find((s) => '#' + s.name === location.hash) ?? samples.find((s) => s.name === 'invoices') ?? samples[0];
  if (wanted !== undefined) await select(wanted);
} catch (e) {
  setStatus(errorText(e), true);
}
