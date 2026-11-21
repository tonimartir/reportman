import type { ParameterDescription } from 'reportman-engine';

/** Options of the reference parameters form. */
export interface ParametersFormOptions {
  /** Where the form posts its values (step 2). */
  action?: string;
  /** The text of the submit button. */
  submitText?: string;
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function valueText(p: ParameterDescription): string {
  const v = p.value;
  if (v === null || v === undefined) return '';
  return String(v);
}

function inputFor(p: ParameterDescription): string {
  const id = 'rp_' + p.name;
  const name = escapeHtml(p.name);
  const attrs: string[] = [`id="${escapeHtml(id)}"`, `name="${name}"`];
  if (!p.editable || p.readOnly) attrs.push('disabled');
  if (!p.allowNulls) attrs.push('required');
  if (p.hint) attrs.push(`title="${escapeHtml(p.hint)}"`);
  const value = valueText(p);
  switch (p.typeName) {
    case 'Bool':
      return `<input type="checkbox" value="true"${value === 'true' ? ' checked' : ''} ${attrs.join(' ')}>`;
    case 'List':
    case 'SubsExpreList': {
      const options = p.options
        .map((o) => `<option value="${escapeHtml(o.value)}"${o.value === value ? ' selected' : ''}>${escapeHtml(o.text)}</option>`)
        .join('');
      return `<select ${attrs.join(' ')}>${options}</select>`;
    }
    case 'Multiple': {
      const selected = new Set(p.selected);
      const options = p.options
        .map((o) => `<option value="${escapeHtml(o.value)}"${selected.has(o.value) ? ' selected' : ''}>${escapeHtml(o.text)}</option>`)
        .join('');
      return `<select multiple ${attrs.join(' ')}>${options}</select>`;
    }
    case 'Date':
      return `<input type="date" value="${escapeHtml(value)}" ${attrs.join(' ')}>`;
    case 'Time':
      return `<input type="time" step="1" value="${escapeHtml(value)}" ${attrs.join(' ')}>`;
    case 'DateTime':
      return `<input type="datetime-local" step="1" value="${escapeHtml(value)}" ${attrs.join(' ')}>`;
    case 'Integer':
      return `<input type="number" step="1" value="${escapeHtml(value)}" ${attrs.join(' ')}>`;
    case 'Double':
    case 'Currency':
      return `<input type="number" step="any" value="${escapeHtml(value)}" ${attrs.join(' ')}>`;
    default:
      return `<input type="text" value="${escapeHtml(value)}" ${attrs.join(' ')}>`;
  }
}

/**
 * A plain HTML form for the parameters of step 1, as a reference: a host usually draws its own
 * form from the same JSON. Dates go as yyyy-MM-dd, times as HH:mm:ss, the values the engine
 * accepts in step 2.
 */
export function renderParametersForm(parameters: readonly ParameterDescription[], options: ParametersFormOptions = {}): string {
  const rows = parameters
    .map((p) => {
      const label = escapeHtml(p.description || p.name);
      return `  <p><label for="${escapeHtml('rp_' + p.name)}">${label}</label><br>${inputFor(p)}</p>`;
    })
    .join('\n');
  const action = escapeHtml(options.action ?? '');
  const submit = escapeHtml(options.submitText ?? 'Print');
  return `<form method="post" action="${action}">\n${rows}\n  <p><button type="submit">${submit}</button></p>\n</form>\n`;
}
