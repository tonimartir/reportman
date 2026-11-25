// The JSON of the designer's requests, read as Reportman.Server reads it (Newtonsoft with the engine's
// converters). One difference matters to the engine: VariantJsonConverter.ReadJson does not keep the
// type a Variant was written with ({"type": "Integer", "value": 1}); it assigns the value Newtonsoft
// read (Variant.AssignFromObject), so the type comes from the JSON token: an integer is a long, a
// number with a fraction or an exponent a double, a text in ISO date and time form a DateTime (the
// reader's DateParseHandling; one in UTC or with an offset taken to the local time), any other text a
// string, true or false a boolean, null a Null. Reading the request here does the same, before the
// model is hydrated.

import { unspecifiedDateText } from './document.js';

const VARIANT_TYPES = new Set(['Null', 'Byte', 'Boolean', 'Char', 'Integer', 'String', 'Double', 'Decimal', 'DateTime', 'Binary', 'Long']);
// DateTimeParser of Newtonsoft (IsoDateFormat): the time is required
const ISO_DATE_TIME = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,7})?(Z|[+-]\d{2}:\d{2})?$/;

/** A number of the JSON text with how it was written. */
class JsonNumber {
  constructor(
    readonly value: number,
    readonly float: boolean,
  ) {}
}

/** The Variant C# makes of a {type, value} it reads. */
function csVariant(v: Record<string, unknown>): Record<string, unknown> {
  const value = v.value;
  if (value === undefined) return { type: 'Null', value: null };
  if (value instanceof JsonNumber) return { type: value.float ? 'Double' : 'Long', value: value.value };
  if (value === null) return { type: 'Null', value: null };
  if (typeof value === 'boolean') return { type: 'Boolean', value };
  if (typeof value === 'string') {
    const m = ISO_DATE_TIME.exec(value);
    if (m === null) return { type: 'String', value };
    // Unspecified as it is; UTC or with an offset, to the local time (DateTime.ToLocalTime)
    if (m[2] === undefined) return { type: 'DateTime', value };
    const instant = new Date(value);
    return { type: 'DateTime', value: isNaN(instant.getTime()) ? value : unspecifiedDateText(instant) };
  }
  return v;
}

function isVariant(o: Record<string, unknown>): boolean {
  const keys = Object.keys(o);
  return typeof o.type === 'string' && VARIANT_TYPES.has(o.type) && keys.every((k) => k === 'type' || k === 'value');
}

/** JSON.parse of a request of the designer, its Variants typed as C# types them when it reads them. */
export function parseDesignerJson(text: string): unknown {
  return JSON.parse(text, function (this: unknown, key: string, value: unknown, context?: { source?: string }) {
    if (typeof value === 'number' && key === 'value') return new JsonNumber(value, /[.eE]/.test(context?.source ?? ''));
    if (value !== null && typeof value === 'object' && !Array.isArray(value)) {
      const o = value as Record<string, unknown>;
      if (o.value instanceof JsonNumber || isVariant(o)) {
        if (isVariant(o)) return csVariant(o);
        o.value = (o.value as JsonNumber).value;
      }
    }
    return value;
  });
}
