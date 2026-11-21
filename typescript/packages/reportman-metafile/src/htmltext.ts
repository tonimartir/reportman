// HTML text (HtmlTextParser.cs): the supported subset of HTML of a text object as styled runs.
//
// The C# engine first normalizes the markup: AngleSharp parses it as an HTML document and gives
// back the inner HTML of its body, and HtmlSanitizer keeps the allowed tags and attributes (the
// rest of a removed element goes with it) and the allowed CSS properties of a style attribute,
// written again as AngleSharp.Css writes them. Then a regular expression walks the tags. Here a
// small tolerant tokenizer and tree builder do what those two libraries do with the markup of
// reports: implied html/head/body (the whitespace before the content is dropped), void elements,
// the paragraphs a block closes, the tbody of a table, raw text of script and style, end tags with
// no element open ignored (a stray </p> opens an empty one), entities decoded and written again,
// comments removed.

/** A span of text with its format (HtmlFormatRun). */
export interface HtmlFormatRun {
  text: string;
  bold: boolean;
  italic: boolean;
  underline: boolean;
  strikeOut: boolean;
  fontFamily: string | null;
  /** Font size in points (a float in C#), meaningful when hasFontSize. */
  fontSize: number;
  hasFontSize: boolean;
  /** Color as BGR (TColor), meaningful when hasColor. */
  color: number;
  hasColor: boolean;
}

function cloneRun(r: HtmlFormatRun): HtmlFormatRun {
  return { ...r };
}

// ---------------------------------------------------------------------------------------------
// Entities: the named entities of HTML 4 (and apos), and numeric references

const NAMED: Record<string, number> = {
  quot: 34, amp: 38, apos: 39, lt: 60, gt: 62, nbsp: 160, iexcl: 161, cent: 162, pound: 163, curren: 164, yen: 165,
  brvbar: 166, sect: 167, uml: 168, copy: 169, ordf: 170, laquo: 171, not: 172, shy: 173, reg: 174, macr: 175, deg: 176,
  plusmn: 177, sup2: 178, sup3: 179, acute: 180, micro: 181, para: 182, middot: 183, cedil: 184, sup1: 185, ordm: 186,
  raquo: 187, frac14: 188, frac12: 189, frac34: 190, iquest: 191, Agrave: 192, Aacute: 193, Acirc: 194, Atilde: 195,
  Auml: 196, Aring: 197, AElig: 198, Ccedil: 199, Egrave: 200, Eacute: 201, Ecirc: 202, Euml: 203, Igrave: 204,
  Iacute: 205, Icirc: 206, Iuml: 207, ETH: 208, Ntilde: 209, Ograve: 210, Oacute: 211, Ocirc: 212, Otilde: 213,
  Ouml: 214, times: 215, Oslash: 216, Ugrave: 217, Uacute: 218, Ucirc: 219, Uuml: 220, Yacute: 221, THORN: 222,
  szlig: 223, agrave: 224, aacute: 225, acirc: 226, atilde: 227, auml: 228, aring: 229, aelig: 230, ccedil: 231,
  egrave: 232, eacute: 233, ecirc: 234, euml: 235, igrave: 236, iacute: 237, icirc: 238, iuml: 239, eth: 240,
  ntilde: 241, ograve: 242, oacute: 243, ocirc: 244, otilde: 245, ouml: 246, divide: 247, oslash: 248, ugrave: 249,
  uacute: 250, ucirc: 251, uuml: 252, yacute: 253, thorn: 254, yuml: 255, OElig: 338, oelig: 339, Scaron: 352,
  scaron: 353, Yuml: 376, fnof: 402, circ: 710, tilde: 732, Alpha: 913, Beta: 914, Gamma: 915, Delta: 916,
  Epsilon: 917, Zeta: 918, Eta: 919, Theta: 920, Iota: 921, Kappa: 922, Lambda: 923, Mu: 924, Nu: 925, Xi: 926,
  Omicron: 927, Pi: 928, Rho: 929, Sigma: 931, Tau: 932, Upsilon: 933, Phi: 934, Chi: 935, Psi: 936, Omega: 937,
  alpha: 945, beta: 946, gamma: 947, delta: 948, epsilon: 949, zeta: 950, eta: 951, theta: 952, iota: 953, kappa: 954,
  lambda: 955, mu: 956, nu: 957, xi: 958, omicron: 959, pi: 960, rho: 961, sigmaf: 962, sigma: 963, tau: 964,
  upsilon: 965, phi: 966, chi: 967, psi: 968, omega: 969, thetasym: 977, upsih: 978, piv: 982, ensp: 8194, emsp: 8195,
  thinsp: 8201, zwnj: 8204, zwj: 8205, lrm: 8206, rlm: 8207, ndash: 8211, mdash: 8212, lsquo: 8216, rsquo: 8217,
  sbquo: 8218, ldquo: 8220, rdquo: 8221, bdquo: 8222, dagger: 8224, Dagger: 8225, bull: 8226, hellip: 8230,
  permil: 8240, prime: 8242, Prime: 8243, lsaquo: 8249, rsaquo: 8250, oline: 8254, frasl: 8260, euro: 8364,
  image: 8465, weierp: 8472, real: 8476, trade: 8482, alefsym: 8501, larr: 8592, uarr: 8593, rarr: 8594, darr: 8595,
  harr: 8596, crarr: 8629, lArr: 8656, uArr: 8657, rArr: 8658, dArr: 8659, hArr: 8660, forall: 8704, part: 8706,
  exist: 8707, empty: 8709, nabla: 8711, isin: 8712, notin: 8713, ni: 8715, prod: 8719, sum: 8721, minus: 8722,
  lowast: 8727, radic: 8730, prop: 8733, infin: 8734, ang: 8736, and: 8743, or: 8744, cap: 8745, cup: 8746, int: 8747,
  there4: 8756, sim: 8764, cong: 8773, asymp: 8776, ne: 8800, equiv: 8801, le: 8804, ge: 8805, sub: 8834, sup: 8835,
  nsub: 8836, sube: 8838, supe: 8839, oplus: 8853, otimes: 8855, perp: 8869, sdot: 8901, lceil: 8968, rceil: 8969,
  lfloor: 8970, rfloor: 8971, lang: 9001, rang: 9002, loz: 9674, spades: 9824, clubs: 9827, hearts: 9829, diams: 9830,
};

/** The characters references of a text decoded (the tokenizer of an HTML parser). */
function decodeReferences(text: string): string {
  if (text.indexOf('&') < 0) return text;
  let out = '';
  let i = 0;
  while (i < text.length) {
    const c = text.charAt(i);
    if (c !== '&') {
      out += c;
      i++;
      continue;
    }
    // Numeric
    const num = /^&#([xX][0-9a-fA-F]+|[0-9]+);?/.exec(text.substring(i));
    if (num !== null) {
      const v = (num[1] as string).startsWith('x') || (num[1] as string).startsWith('X') ? parseInt((num[1] as string).substring(1), 16) : parseInt(num[1] as string, 10);
      let cp = v;
      if (cp === 0 || cp > 0x10ffff || (cp >= 0xd800 && cp <= 0xdfff)) cp = 0xfffd;
      else if (cp >= 0x80 && cp <= 0x9f) cp = WIN1252_C1[cp - 0x80] ?? cp;
      out += String.fromCodePoint(cp);
      i += num[0].length;
      continue;
    }
    const named = /^&([A-Za-z][A-Za-z0-9]*);/.exec(text.substring(i));
    if (named !== null) {
      const v = NAMED[named[1] as string];
      if (v !== undefined) {
        out += String.fromCharCode(v);
        i += named[0].length;
        continue;
      }
    }
    out += c;
    i++;
  }
  return out;
}

// The numeric references 0x80-0x9F are read as Windows-1252, as HTML parsers do
const WIN1252_C1: (number | undefined)[] = [
  0x20ac, undefined, 0x201a, 0x0192, 0x201e, 0x2026, 0x2020, 0x2021, 0x02c6, 0x2030, 0x0160, 0x2039, 0x0152, undefined, 0x017d, undefined,
  undefined, 0x2018, 0x2019, 0x201c, 0x201d, 0x2022, 0x2013, 0x2014, 0x02dc, 0x2122, 0x0161, 0x203a, 0x0153, undefined, 0x017e, 0x0178,
];

// ---------------------------------------------------------------------------------------------
// Tokenizer and tree builder

interface HtmlElement {
  kind: 'element';
  name: string;
  attrs: [string, string][];
  children: HtmlNode[];
}
interface HtmlText {
  kind: 'text';
  value: string;
}
interface HtmlComment {
  kind: 'comment';
  value: string;
}
type HtmlNode = HtmlElement | HtmlText | HtmlComment;

type Token =
  | { type: 'start'; name: string; attrs: [string, string][]; selfClosing: boolean }
  | { type: 'end'; name: string }
  | { type: 'text'; value: string }
  | { type: 'comment'; value: string }
  | { type: 'doctype' };

const VOID = new Set(['area', 'base', 'basefont', 'bgsound', 'br', 'col', 'embed', 'hr', 'img', 'input', 'keygen', 'link', 'meta', 'param', 'source', 'track', 'wbr']);
const RAW_TEXT = new Set(['script', 'style', 'xmp', 'iframe', 'noembed', 'noframes', 'noscript']);
const RCDATA = new Set(['title', 'textarea']);
const HEAD_ELEMENTS = new Set(['meta', 'link', 'base', 'basefont', 'bgsound', 'title', 'style', 'script', 'noscript', 'template']);
// A start tag of these closes an open p (HTML5, in body; a table does not in quirks mode)
const CLOSES_P = new Set([
  'address', 'article', 'aside', 'blockquote', 'center', 'details', 'dialog', 'dir', 'div', 'dl', 'fieldset', 'figcaption', 'figure',
  'footer', 'header', 'hgroup', 'main', 'menu', 'nav', 'ol', 'p', 'section', 'summary', 'ul', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'pre',
  'listing', 'form', 'hr', 'plaintext', 'xmp',
]);
const HEADINGS = new Set(['h1', 'h2', 'h3', 'h4', 'h5', 'h6']);
// The elements that bound the scope of an element (the default scope of HTML5)
const SCOPE = new Set(['applet', 'caption', 'html', 'table', 'td', 'th', 'marquee', 'object', 'template']);

function tokenize(html: string): Token[] {
  const tokens: Token[] = [];
  let i = 0;
  let text = '';
  const flushText = (): void => {
    if (text.length > 0) {
      tokens.push({ type: 'text', value: decodeReferences(text) });
      text = '';
    }
  };
  const n = html.length;
  while (i < n) {
    const c = html.charAt(i);
    if (c !== '<') {
      text += c;
      i++;
      continue;
    }
    const next = html.charAt(i + 1);
    if (next === '!') {
      if (html.startsWith('<!--', i)) {
        flushText();
        const end = html.indexOf('-->', i + 4);
        const value = end < 0 ? html.substring(i + 4) : html.substring(i + 4, end);
        tokens.push({ type: 'comment', value });
        i = end < 0 ? n : end + 3;
        continue;
      }
      // Doctype or bogus comment
      flushText();
      const end = html.indexOf('>', i + 2);
      if (/^<!doctype/i.test(html.substring(i, i + 9))) tokens.push({ type: 'doctype' });
      else tokens.push({ type: 'comment', value: end < 0 ? html.substring(i + 2) : html.substring(i + 2, end) });
      i = end < 0 ? n : end + 1;
      continue;
    }
    if (next === '?') {
      // Bogus comment
      flushText();
      const end = html.indexOf('>', i + 2);
      tokens.push({ type: 'comment', value: end < 0 ? html.substring(i + 1) : html.substring(i + 1, end) });
      i = end < 0 ? n : end + 1;
      continue;
    }
    const isEnd = next === '/';
    const nameStart = isEnd ? i + 2 : i + 1;
    if (!/[A-Za-z]/.test(html.charAt(nameStart))) {
      if (isEnd && html.charAt(nameStart) === '>') {
        // </> is ignored
        i = nameStart + 1;
        continue;
      }
      if (isEnd && nameStart < n) {
        // </ followed by something else: a bogus comment
        flushText();
        const end = html.indexOf('>', nameStart);
        tokens.push({ type: 'comment', value: end < 0 ? html.substring(nameStart) : html.substring(nameStart, end) });
        i = end < 0 ? n : end + 1;
        continue;
      }
      text += c;
      i++;
      continue;
    }
    flushText();
    // Tag name
    let p = nameStart;
    while (p < n && !/[\s/>]/.test(html.charAt(p))) p++;
    const name = html.substring(nameStart, p).toLowerCase();
    // Attributes
    const attrs: [string, string][] = [];
    let selfClosing = false;
    for (;;) {
      while (p < n && /\s/.test(html.charAt(p))) p++;
      if (p >= n) break;
      const ch = html.charAt(p);
      if (ch === '>') {
        p++;
        break;
      }
      if (ch === '/') {
        p++;
        if (html.charAt(p) === '>') {
          selfClosing = true;
          p++;
          break;
        }
        continue;
      }
      let a = p;
      p++;
      while (p < n && !/[\s/>=]/.test(html.charAt(p))) p++;
      const aname = html.substring(a, p).toLowerCase();
      while (p < n && /\s/.test(html.charAt(p))) p++;
      let value = '';
      if (html.charAt(p) === '=') {
        p++;
        while (p < n && /\s/.test(html.charAt(p))) p++;
        const q = html.charAt(p);
        if (q === '"' || q === "'") {
          const end = html.indexOf(q, p + 1);
          value = end < 0 ? html.substring(p + 1) : html.substring(p + 1, end);
          p = end < 0 ? n : end + 1;
        } else {
          a = p;
          while (p < n && !/[\s>]/.test(html.charAt(p))) p++;
          value = html.substring(a, p);
        }
        value = decodeReferences(value);
      }
      if (!attrs.some((x) => x[0] === aname)) attrs.push([aname, value]);
    }
    if (isEnd) tokens.push({ type: 'end', name });
    else {
      tokens.push({ type: 'start', name, attrs, selfClosing });
      if (RAW_TEXT.has(name) || RCDATA.has(name)) {
        // The content up to the end tag, as text
        const re = new RegExp('</' + name + '[\\s/>]', 'i');
        const rest = html.substring(p);
        const m = re.exec(rest);
        const raw = m === null ? rest : rest.substring(0, m.index);
        if (raw.length > 0) tokens.push({ type: 'text', value: RCDATA.has(name) ? decodeReferences(raw) : raw });
        if (m === null) {
          i = n;
          continue;
        }
        const close = html.indexOf('>', p + m.index);
        tokens.push({ type: 'end', name });
        i = close < 0 ? n : close + 1;
        continue;
      }
    }
    i = p;
  }
  flushText();
  return tokens;
}

/** The body of a document parsed from HTML (the children of its body element). */
function parseBody(html: string): HtmlElement {
  const body: HtmlElement = { kind: 'element', name: 'body', attrs: [], children: [] };
  const stack: HtmlElement[] = [body];
  let inBody = false;
  const current = (): HtmlElement => stack[stack.length - 1] as HtmlElement;
  const appendText = (value: string): void => {
    const kids = current().children;
    const last = kids[kids.length - 1];
    if (last !== undefined && last.kind === 'text') last.value += value;
    else kids.push({ kind: 'text', value });
  };
  const inScope = (name: string, extra?: Set<string>): boolean => {
    for (let k = stack.length - 1; k > 0; k--) {
      const e = stack[k] as HtmlElement;
      if (e.name === name) return true;
      if (SCOPE.has(e.name) || (extra !== undefined && extra.has(e.name))) return false;
    }
    return false;
  };
  const popTo = (name: string): void => {
    while (stack.length > 1) {
      const e = stack.pop() as HtmlElement;
      if (e.name === name) break;
    }
  };
  const closeP = (): void => {
    if (inScope('p', new Set(['button']))) popTo('p');
  };
  const insert = (name: string, attrs: [string, string][], push: boolean): HtmlElement => {
    const el: HtmlElement = { kind: 'element', name, attrs, children: [] };
    current().children.push(el);
    if (push) stack.push(el);
    return el;
  };
  let skipUntil: string | null = null;
  for (const t of tokenize(html)) {
    if (t.type === 'doctype') continue;
    if (skipUntil !== null) {
      // The content of an element that went into the head
      if (t.type === 'end' && t.name === skipUntil) skipUntil = null;
      continue;
    }
    if (!inBody) {
      if (t.type === 'text') {
        const trimmed = t.value.replace(/^[\t\n\f\r ]+/, '');
        if (trimmed === '') continue;
        inBody = true;
        appendText(trimmed);
        continue;
      }
      if (t.type === 'comment') continue;
      if (t.type === 'start') {
        if (t.name === 'html' || t.name === 'head') continue;
        if (HEAD_ELEMENTS.has(t.name)) {
          // Into the head: not part of the body; raw text elements take their text with them
          if (!VOID.has(t.name) && !t.selfClosing) skipUntil = t.name;
          continue;
        }
        if (t.name === 'body') {
          inBody = true;
          continue;
        }
        inBody = true;
      } else if (t.type === 'end') {
        if (t.name === 'head' || t.name === 'html' || t.name === 'body' || t.name === 'br') {
          if (t.name !== 'br') continue;
        } else continue;
      }
    }
    if (t.type === 'text') {
      if (t.value.length > 0) appendText(t.value);
      continue;
    }
    if (t.type === 'comment') {
      current().children.push({ kind: 'comment', value: t.value });
      continue;
    }
    if (t.type === 'start') {
      const name = t.name;
      if (name === 'html' || name === 'body' || name === 'head') continue;
      if (CLOSES_P.has(name)) closeP();
      if (HEADINGS.has(name) && HEADINGS.has(current().name)) stack.pop();
      if (name === 'li') {
        for (let k = stack.length - 1; k > 0; k--) {
          const e = stack[k] as HtmlElement;
          if (e.name === 'li') {
            popTo('li');
            break;
          }
          if (['ul', 'ol', 'address', 'div', 'p'].includes(e.name) || SCOPE.has(e.name)) break;
        }
        closeP();
      }
      if (name === 'dd' || name === 'dt') {
        for (let k = stack.length - 1; k > 0; k--) {
          const e = stack[k] as HtmlElement;
          if (e.name === 'dd' || e.name === 'dt') {
            popTo(e.name);
            break;
          }
          if (['address', 'div', 'p'].includes(e.name) || SCOPE.has(e.name)) break;
        }
        closeP();
      }
      // Tables: the implied tbody and tr
      if (name === 'tr' && (current().name === 'table' || current().name === 'tbody' || current().name === 'thead' || current().name === 'tfoot')) {
        if (current().name === 'table') insert('tbody', [], true);
      } else if (name === 'tr' && (current().name === 'tr' || current().name === 'td' || current().name === 'th')) {
        while (stack.length > 1 && !['tbody', 'thead', 'tfoot', 'table'].includes(current().name)) stack.pop();
      }
      if ((name === 'td' || name === 'th') && ['table', 'tbody', 'thead', 'tfoot'].includes(current().name)) {
        if (current().name === 'table') insert('tbody', [], true);
        insert('tr', [], true);
      } else if ((name === 'td' || name === 'th') && inScope('td', new Set(['table']))) popTo('td');
      else if ((name === 'td' || name === 'th') && inScope('th', new Set(['table']))) popTo('th');
      if ((name === 'tbody' || name === 'thead' || name === 'tfoot') && ['tbody', 'thead', 'tfoot'].includes(current().name)) stack.pop();
      const isVoid = VOID.has(name);
      insert(name, t.attrs, !isVoid);
      continue;
    }
    // End tags
    const name = t.name;
    if (name === 'body' || name === 'html' || name === 'head') continue;
    if (name === 'br') {
      insert('br', [], false);
      continue;
    }
    if (name === 'p') {
      if (!inScope('p', new Set(['button']))) insert('p', [], false);
      else popTo('p');
      continue;
    }
    if (VOID.has(name)) continue;
    const scopeStop = name === 'td' || name === 'th' || name === 'tr' || name === 'tbody' || name === 'thead' || name === 'tfoot' ? new Set(['table']) : undefined;
    if (name === 'table') {
      if (inScope('table')) popTo('table');
      continue;
    }
    if (scopeStop !== undefined) {
      // A table element closes in its table
      for (let k = stack.length - 1; k > 0; k--) {
        const e = stack[k] as HtmlElement;
        if (e.name === name) {
          popTo(name);
          break;
        }
        if (e.name === 'table') break;
      }
      continue;
    }
    if (inScope(name)) popTo(name);
  }
  return body;
}

function escapeText(s: string): string {
  return s.replaceAll('&', '&amp;').replaceAll(' ', '&nbsp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');
}

function escapeAttribute(s: string): string {
  return s.replaceAll('&', '&amp;').replaceAll(' ', '&nbsp;').replaceAll('"', '&quot;');
}

/** The inner HTML of an element, as AngleSharp writes it. */
function innerHtml(el: HtmlElement): string {
  let out = '';
  for (const node of el.children) {
    if (node.kind === 'text') out += RAW_TEXT.has(el.name) ? node.value : escapeText(node.value);
    else if (node.kind === 'comment') out += '<!--' + node.value + '-->';
    else {
      out += '<' + node.name;
      for (const [k, v] of node.attrs) out += ' ' + k + '="' + escapeAttribute(v) + '"';
      out += '>';
      if (VOID.has(node.name)) continue;
      out += innerHtml(node) + '</' + node.name + '>';
    }
  }
  return out;
}

// ---------------------------------------------------------------------------------------------
// Sanitizer: the tags, attributes and CSS properties of HtmlTextParser's HtmlSanitizer

const ALLOWED_TAGS = new Set(['b', 'strong', 'i', 'em', 'u', 's', 'del', 'strike', 'span', 'font', 'br', 'p', 'div', 'table', 'tbody', 'thead', 'tfoot', 'tr', 'td', 'th']);
const ALLOWED_ATTRIBUTES = new Set(['style', 'face', 'size', 'color', 'colspan', 'rowspan']);
const ALLOWED_CSS = new Set(['color', 'font-family', 'font-size']);

const CSS_COLORS: Record<string, [number, number, number]> = {
  black: [0, 0, 0], silver: [192, 192, 192], gray: [128, 128, 128], grey: [128, 128, 128], white: [255, 255, 255], maroon: [128, 0, 0],
  red: [255, 0, 0], purple: [128, 0, 128], fuchsia: [255, 0, 255], magenta: [255, 0, 255], green: [0, 128, 0], lime: [0, 255, 0],
  olive: [128, 128, 0], yellow: [255, 255, 0], navy: [0, 0, 128], blue: [0, 0, 255], teal: [0, 128, 128], aqua: [0, 255, 255],
  cyan: [0, 255, 255], orange: [255, 165, 0], pink: [255, 192, 203], brown: [165, 42, 42], gold: [255, 215, 0],
  darkred: [139, 0, 0], darkgreen: [0, 100, 0], darkblue: [0, 0, 139], lightgray: [211, 211, 211], lightgrey: [211, 211, 211],
  darkgray: [169, 169, 169], darkgrey: [169, 169, 169], violet: [238, 130, 238], indigo: [75, 0, 130], coral: [255, 127, 80],
  salmon: [250, 128, 114], tomato: [255, 99, 71], crimson: [220, 20, 60], orchid: [218, 112, 214], khaki: [240, 230, 140],
  beige: [245, 245, 220], ivory: [255, 255, 240], tan: [210, 180, 140], chocolate: [210, 105, 30], firebrick: [178, 34, 34],
};

/** A CSS color as AngleSharp.Css writes it (rgba), null when it is not one. */
function cssColor(value: string): string | null {
  const v = value.trim().toLowerCase();
  let rgba: [number, number, number, number] | null = null;
  const named = CSS_COLORS[v];
  if (named !== undefined) rgba = [named[0], named[1], named[2], 1];
  else if (v === 'transparent') rgba = [0, 0, 0, 0];
  else {
    const hex = /^#([0-9a-f]{3,8})$/.exec(v);
    if (hex !== null) {
      const h = hex[1] as string;
      if (h.length === 3 || h.length === 4)
        rgba = [parseInt(h[0]! + h[0]!, 16), parseInt(h[1]! + h[1]!, 16), parseInt(h[2]! + h[2]!, 16), h.length === 4 ? parseInt(h[3]! + h[3]!, 16) / 255 : 1];
      else if (h.length === 6 || h.length === 8)
        rgba = [parseInt(h.substring(0, 2), 16), parseInt(h.substring(2, 4), 16), parseInt(h.substring(4, 6), 16), h.length === 8 ? parseInt(h.substring(6, 8), 16) / 255 : 1];
    } else {
      const fn = /^rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*(?:,\s*([\d.]+)\s*)?\)$/.exec(v);
      if (fn !== null) rgba = [Number(fn[1]), Number(fn[2]), Number(fn[3]), fn[4] === undefined ? 1 : Number(fn[4])];
    }
  }
  if (rgba === null) {
    if (v === 'inherit' || v === 'initial' || v === 'unset' || v === 'currentcolor') return v;
    return null;
  }
  return 'rgba(' + String(rgba[0]) + ', ' + String(rgba[1]) + ', ' + String(rgba[2]) + ', ' + String(Math.round(rgba[3] * 1000) / 1000) + ')';
}

/** A font-family value as AngleSharp.Css writes it: names as identifiers, strings double quoted. */
function cssFontFamily(value: string): string | null {
  const families: string[] = [];
  let i = 0;
  const v = value.trim();
  while (i < v.length) {
    while (i < v.length && /\s/.test(v.charAt(i))) i++;
    const q = v.charAt(i);
    if (q === '"' || q === "'") {
      const end = v.indexOf(q, i + 1);
      if (end < 0) return null;
      families.push('"' + v.substring(i + 1, end).replaceAll('\\', '\\\\').replaceAll('"', '\\"') + '"');
      i = end + 1;
    } else {
      let j = i;
      while (j < v.length && v.charAt(j) !== ',') j++;
      const words = v.substring(i, j).trim().split(/\s+/);
      if (words.length === 0 || words[0] === '' || words.some((w) => !/^-?[A-Za-z_\u0080-￿][\w\u0080-￿-]*$/.test(w))) return null;
      families.push(words.join(' '));
      i = j;
    }
    while (i < v.length && /\s/.test(v.charAt(i))) i++;
    if (i < v.length) {
      if (v.charAt(i) !== ',') return null;
      i++;
    }
  }
  return families.length === 0 ? null : families.join(', ');
}

/** A font-size value as AngleSharp.Css keeps it (a length, a percentage or a keyword), null when it is not one. */
function cssFontSize(value: string): string | null {
  const v = value.trim().toLowerCase();
  if (/^(xx-small|x-small|small|medium|large|x-large|xx-large|xxx-large|larger|smaller|inherit|initial|unset)$/.test(v)) return v;
  const m = /^([+]?\d*\.?\d+)(px|pt|pc|cm|mm|in|q|em|ex|ch|rem|vw|vh|vmin|vmax|%)$/.exec(v);
  if (m !== null) return m[0];
  if (/^0+(\.0*)?$/.test(v)) return '0';
  return null;
}

/** A style attribute with only the allowed properties, written as AngleSharp.Css writes it. */
function sanitizeStyle(style: string): string {
  const out: string[] = [];
  for (const decl of splitDeclarations(style)) {
    const k = decl.indexOf(':');
    if (k <= 0) continue;
    const prop = decl.substring(0, k).trim().toLowerCase();
    let value = decl.substring(k + 1).trim();
    let important = '';
    const imp = /\s*!\s*important\s*$/i.exec(value);
    if (imp !== null) {
      important = ' !important';
      value = value.substring(0, imp.index).trim();
    }
    if (!ALLOWED_CSS.has(prop)) continue;
    let written: string | null = null;
    if (prop === 'color') written = cssColor(value);
    else if (prop === 'font-family') written = cssFontFamily(value);
    else written = cssFontSize(value);
    if (written === null) continue;
    const existing = out.findIndex((d) => d.startsWith(prop + ': '));
    if (existing >= 0) out.splice(existing, 1);
    out.push(prop + ': ' + written + important);
  }
  return out.join('; ');
}

function splitDeclarations(style: string): string[] {
  const out: string[] = [];
  let cur = '';
  let quote = '';
  let depth = 0;
  for (const ch of style) {
    if (quote !== '') {
      cur += ch;
      if (ch === quote) quote = '';
      continue;
    }
    if (ch === '"' || ch === "'") {
      quote = ch;
      cur += ch;
      continue;
    }
    if (ch === '(') depth++;
    else if (ch === ')') depth = Math.max(0, depth - 1);
    if (ch === ';' && depth === 0) {
      out.push(cur);
      cur = '';
      continue;
    }
    cur += ch;
  }
  if (cur.trim() !== '') out.push(cur);
  return out;
}

function sanitizeNode(el: HtmlElement): void {
  const kept: HtmlNode[] = [];
  for (const node of el.children) {
    if (node.kind === 'comment') continue;
    if (node.kind === 'text') {
      kept.push(node);
      continue;
    }
    if (!ALLOWED_TAGS.has(node.name)) continue;
    const attrs: [string, string][] = [];
    for (const [k, v] of node.attrs) {
      if (!ALLOWED_ATTRIBUTES.has(k)) continue;
      if (k === 'style') {
        const s = sanitizeStyle(v);
        if (s === '') continue;
        attrs.push([k, s]);
      } else attrs.push([k, v]);
    }
    node.attrs = attrs;
    sanitizeNode(node);
    kept.push(node);
  }
  // Adjacent texts left by a removed element are one text node
  const merged: HtmlNode[] = [];
  for (const node of kept) {
    const last = merged[merged.length - 1];
    if (node.kind === 'text' && last !== undefined && last.kind === 'text') last.value += node.value;
    else merged.push(node);
  }
  el.children = merged;
}

const META_CHARSET = /<meta\b[^>]*(charset\s*=|http-equiv\s*=\s*["']?content-type["']?)[^>]*>/gi;

function isNullOrWhiteSpace(s: string): boolean {
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    const ws = c === 0x20 || (c >= 0x09 && c <= 0x0d) || c === 0xa0 || c === 0x85 || c === 0x1680 || (c >= 0x2000 && c <= 0x200a) || c === 0x2028 || c === 0x2029 || c === 0x202f || c === 0x205f || c === 0x3000;
    if (!ws) return false;
  }
  return true;
}

/**
 * The markup normalized into the supported subset (NormalizeSupportedHtml): parsed as a document,
 * the inner HTML of its body, sanitized. A text without '<' is left as it is.
 */
export function normalizeSupportedHtml(htmlText: string): string {
  if (isNullOrWhiteSpace(htmlText) || htmlText.indexOf('<') < 0) return htmlText;
  try {
    const withoutCharset = htmlText.replace(META_CHARSET, '');
    let normalized = innerHtml(parseBody(withoutCharset));
    if (normalized === '') normalized = htmlText;
    const fragment = parseFragment(normalized);
    sanitizeNode(fragment);
    return innerHtml(fragment);
  } catch {
    return htmlText;
  }
}

/** A fragment parsed in the context of a body (what HtmlSanitizer parses). */
function parseFragment(html: string): HtmlElement {
  // Inside a body there is no head to send content to, and leading whitespace is kept
  const marker = '\u0001';
  const body = parseBody(marker + html);
  const first = body.children[0];
  if (first !== undefined && first.kind === 'text') {
    first.value = first.value.substring(1);
    if (first.value === '') body.children.shift();
  }
  return body;
}

// ---------------------------------------------------------------------------------------------
// The runs (HtmlTextParser.Parse)

const TAG_REGEX = /<(\/?)(\w+)([^>]*)>/gi;
const STYLE_REGEX = /font-family\s*:\s*'?([^';]+)'?/i;
const SIZE_REGEX = /font-size\s*:\s*'?(\d+)(pt|px)?'?/i;
const COLOR_REGEX = /(?<![-\w])color\s*[:=]\s*['"]?([^;'"\s>]+)/i;

function decodeHtmlEntities(text: string): string {
  if (text === '') return text;
  return text.replaceAll('&nbsp;', ' ').replaceAll('&lt;', '<').replaceAll('&gt;', '>').replaceAll('&amp;', '&').replaceAll('&quot;', '"').replaceAll('&#39;', "'");
}

function extractFontFamily(attributes: string): string {
  const m = STYLE_REGEX.exec(attributes);
  return m !== null ? (m[1] as string) : '';
}

function extractColorValue(attributes: string): number | null {
  const m = COLOR_REGEX.exec(attributes);
  if (m === null) return null;
  let val = (m[1] as string).trim();
  if (val === '') return null;
  if (val.startsWith('#')) {
    val = val.substring(1);
    const hex = (s: string): number => {
      if (!/^[0-9a-fA-F]+$/.test(s)) throw new Error('Could not find any recognizable digits.');
      return parseInt(s, 16);
    };
    if (val.length === 6) return hex(val.substring(0, 2)) | (hex(val.substring(2, 4)) << 8) | (hex(val.substring(4, 6)) << 16);
    if (val.length === 3) return hex(val[0]! + val[0]!) | (hex(val[1]! + val[1]!) << 8) | (hex(val[2]! + val[2]!) << 16);
    return null;
  }
  switch (val.toLowerCase()) {
    case 'red':
      return 0x0000ff;
    case 'blue':
      return 0xff0000;
    case 'green':
      return 0x008000;
    case 'black':
      return 0x000000;
    case 'white':
      return 0xffffff;
    case 'yellow':
      return 0x00ffff;
    case 'orange':
      return 0x00a5ff;
    case 'purple':
      return 0x800080;
    case 'gray':
    case 'grey':
      return 0x808080;
    default:
      return null;
  }
}

function extractFontSize(attributes: string): number {
  const m = SIZE_REGEX.exec(attributes);
  if (m !== null) return parseInt(m[1] as string, 10);
  return 0;
}

function extractFontFace(attributes: string): string {
  let m = /face\s*=\s*"([^"]+)"/i.exec(attributes);
  if (m !== null) return m[1] as string;
  m = /face\s*=\s*'([^']+)'/i.exec(attributes);
  if (m !== null) return m[1] as string;
  m = /face\s*=\s*([^\s>]+)/i.exec(attributes);
  if (m !== null) return (m[1] as string).trim();
  return '';
}

function extractLegacyFontSize(attributes: string): number {
  const m = /size\s*=\s*"?(\d+)"?/i.exec(attributes);
  if (m === null) return 0;
  const size = parseInt(m[1] as string, 10);
  const after = m.index + m[0].length;
  const hasPtSuffix = after + 1 < attributes.length && attributes.substring(after, after + 2).toLowerCase() === 'pt';
  if (hasPtSuffix) return size;
  switch (size) {
    case 1:
      return 8;
    case 2:
      return 10;
    case 3:
      return 12;
    case 4:
      return 14;
    case 5:
      return 18;
    case 6:
      return 24;
    case 7:
      return 36;
    default:
      return size;
  }
}

function mergeRuns(runs: HtmlFormatRun[]): HtmlFormatRun[] {
  if (runs.length <= 1) return runs;
  const merged: HtmlFormatRun[] = [];
  let current = runs[0] as HtmlFormatRun;
  for (let i = 1; i < runs.length; i++) {
    const next = runs[i] as HtmlFormatRun;
    if (
      current.bold === next.bold &&
      current.italic === next.italic &&
      current.underline === next.underline &&
      current.strikeOut === next.strikeOut &&
      current.fontFamily === next.fontFamily &&
      current.fontSize === next.fontSize &&
      current.hasFontSize === next.hasFontSize &&
      current.color === next.color &&
      current.hasColor === next.hasColor
    )
      current.text += next.text;
    else {
      merged.push(current);
      current = next;
    }
  }
  merged.push(current);
  return merged;
}

/** The HTML parser of the text objects (HtmlTextParser). */
export const HtmlTextParser = {
  normalizeSupportedHtml,

  /**
   * The styled runs of an HTML fragment (Parse): b/strong, i/em, u, s/del/strike, span with the
   * family, size and color of its style, the legacy font (face, size 1-7 or in points, color),
   * line breaks for br and the end of p, div and tr, a space after a cell; consecutive runs with
   * the same style merged. An empty list for an empty text.
   */
  parse(htmlText: string | null, defaultFontFamily = ''): HtmlFormatRun[] {
    const runs: HtmlFormatRun[] = [];
    if (htmlText === null || htmlText === '') return runs;
    const preprocessed = normalizeSupportedHtml(htmlText);
    const normalizedHtml = preprocessed.replaceAll('\r\n', '\n').replaceAll('\r', '\n');
    const currentRun: HtmlFormatRun = {
      text: '',
      bold: false,
      italic: false,
      underline: false,
      strikeOut: false,
      fontFamily: defaultFontFamily,
      fontSize: 0,
      hasFontSize: false,
      color: 0,
      hasColor: false,
    };
    let lastIndex = 0;
    const fontFamilyStack: string[] = [defaultFontFamily];
    const fontSizeStack: number[] = [0];
    const colorStack: number[] = [-1];
    const peek = <T>(s: T[]): T => s[s.length - 1] as T;
    const addSpecialText = (text: string): void => {
      const r = cloneRun(currentRun);
      r.text = text;
      runs.push(r);
    };
    TAG_REGEX.lastIndex = 0;
    let match: RegExpExecArray | null;
    while ((match = TAG_REGEX.exec(normalizedHtml)) !== null) {
      if (match.index > lastIndex) {
        const textPart = decodeHtmlEntities(normalizedHtml.substring(lastIndex, match.index));
        if (textPart !== '') {
          const r = cloneRun(currentRun);
          r.text = textPart;
          runs.push(r);
        }
      }
      const isClosing = match[1] === '/';
      const tagName = (match[2] as string).toLowerCase();
      const tagAttributes = match[3] as string;
      if (!isClosing) {
        switch (tagName) {
          case 'b':
          case 'strong':
            currentRun.bold = true;
            break;
          case 'i':
          case 'em':
            currentRun.italic = true;
            break;
          case 'u':
            currentRun.underline = true;
            break;
          case 's':
          case 'del':
          case 'strike':
            currentRun.strikeOut = true;
            break;
          case 'span':
          case 'font': {
            const family = tagName === 'span' ? extractFontFamily(tagAttributes) : extractFontFace(tagAttributes);
            if (family !== '') {
              fontFamilyStack.push(family);
              currentRun.fontFamily = family;
            } else fontFamilyStack.push(currentRun.fontFamily as string);
            const size = tagName === 'span' ? extractFontSize(tagAttributes) : extractLegacyFontSize(tagAttributes);
            if (size > 0) {
              fontSizeStack.push(size);
              currentRun.fontSize = size;
              currentRun.hasFontSize = true;
            } else fontSizeStack.push(currentRun.fontSize);
            const color = extractColorValue(tagAttributes);
            if (color !== null) {
              colorStack.push(color);
              currentRun.color = color;
              currentRun.hasColor = true;
            } else colorStack.push(peek(colorStack));
            break;
          }
          case 'br':
            addSpecialText('\n');
            break;
        }
      } else {
        switch (tagName) {
          case 'b':
          case 'strong':
            currentRun.bold = false;
            break;
          case 'i':
          case 'em':
            currentRun.italic = false;
            break;
          case 'u':
            currentRun.underline = false;
            break;
          case 's':
          case 'del':
          case 'strike':
            currentRun.strikeOut = false;
            break;
          case 'span':
          case 'font':
            if (fontFamilyStack.length > 1) {
              fontFamilyStack.pop();
              currentRun.fontFamily = peek(fontFamilyStack);
            }
            if (fontSizeStack.length > 1) {
              fontSizeStack.pop();
              const peekSize = peek(fontSizeStack);
              if (peekSize > 0) {
                currentRun.fontSize = peekSize;
                currentRun.hasFontSize = true;
              } else {
                currentRun.fontSize = 0;
                currentRun.hasFontSize = false;
              }
            }
            if (colorStack.length > 1) {
              colorStack.pop();
              const peekColor = peek(colorStack);
              if (peekColor >= 0) {
                currentRun.color = peekColor;
                currentRun.hasColor = true;
              } else {
                currentRun.color = 0;
                currentRun.hasColor = false;
              }
            }
            break;
          case 'p':
          case 'div':
          case 'tr':
            addSpecialText('\n');
            break;
          case 'td':
          case 'th':
            addSpecialText(' ');
            break;
        }
      }
      lastIndex = match.index + match[0].length;
    }
    if (lastIndex < normalizedHtml.length) {
      const textPart = decodeHtmlEntities(normalizedHtml.substring(lastIndex));
      if (textPart !== '') {
        const r = cloneRun(currentRun);
        r.text = textPart;
        runs.push(r);
      }
    }
    return mergeRuns(runs);
  },
};
