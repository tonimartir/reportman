// The text of an xml value as SqlClient gives it: SqlDataReader.GetValue reads the column as SqlXml
// and its Value writes the nodes again with an XmlWriter (ConformanceLevel.Fragment, default
// settings). The server sends its own serialization (no declaration, `<c/>`, double quotes); the
// writer changes it in a few ways this module reproduces: an empty element is `<c />`, `>` in text
// is `&gt;`, line breaks in text are Environment.NewLine, and in attributes `"`, tab, line feed and
// carriage return are entities.

import { EOL } from 'node:os';

const NAMED: Readonly<Record<string, string>> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };

/** The text of character and entity references. */
function decodeEntities(s: string): string {
  return s.replace(/&(#x[0-9a-fA-F]+|#[0-9]+|[A-Za-z]+);/g, (m, ref: string) => {
    if (ref.startsWith('#x')) return String.fromCodePoint(Number.parseInt(ref.substring(2), 16));
    if (ref.startsWith('#')) return String.fromCodePoint(Number.parseInt(ref.substring(1), 10));
    return NAMED[ref] ?? m;
  });
}

/** XmlReader's view of text: literal line ends as "\n" (the references kept as they are). */
function readText(raw: string): string {
  let out = '';
  let last = 0;
  const re = /&(#x[0-9a-fA-F]+|#[0-9]+|[A-Za-z]+);/g;
  for (let m = re.exec(raw); m !== null; m = re.exec(raw)) {
    out += raw.substring(last, m.index).replace(/\r\n?/g, '\n') + decodeEntities(m[0]);
    last = m.index + m[0].length;
  }
  return out + raw.substring(last).replace(/\r\n?/g, '\n');
}

/** Attribute-value normalization: literal white space as spaces, references decoded. */
function readAttribute(raw: string): string {
  let out = '';
  let last = 0;
  const re = /&(#x[0-9a-fA-F]+|#[0-9]+|[A-Za-z]+);/g;
  for (let m = re.exec(raw); m !== null; m = re.exec(raw)) {
    out += raw.substring(last, m.index).replace(/\r\n|[\t\n\r]/g, ' ') + decodeEntities(m[0]);
    last = m.index + m[0].length;
  }
  return out + raw.substring(last).replace(/\r\n|[\t\n\r]/g, ' ');
}

/** XmlEncodedRawTextWriter: text. */
function writeText(s: string): string {
  let out = '';
  for (let i = 0; i < s.length; i++) {
    const c = s.charAt(i);
    if (c === '&') out += '&amp;';
    else if (c === '<') out += '&lt;';
    else if (c === '>') out += '&gt;';
    else if (c === '\n') out += EOL;
    else if (c === '\r') {
      if (s.charAt(i + 1) === '\n') i++;
      out += EOL;
    } else out += c;
  }
  return out;
}

/** XmlEncodedRawTextWriter: an attribute value. */
function writeAttribute(s: string): string {
  let out = '';
  for (const c of s) {
    if (c === '&') out += '&amp;';
    else if (c === '<') out += '&lt;';
    else if (c === '>') out += '&gt;';
    else if (c === '"') out += '&quot;';
    else if (c === '\t') out += '&#x9;';
    else if (c === '\n') out += '&#xA;';
    else if (c === '\r') out += '&#xD;';
    else out += c;
  }
  return out;
}

/** SqlXml.Value of the text the server sent for an xml value. */
export function sqlXmlValue(xml: string): string {
  let out = '';
  let i = 0;
  const n = xml.length;
  while (i < n) {
    const lt = xml.indexOf('<', i);
    const end = lt < 0 ? n : lt;
    if (end > i) out += writeText(readText(xml.substring(i, end)));
    if (lt < 0) break;
    i = lt;
    if (xml.startsWith('<!--', i)) {
      const close = xml.indexOf('-->', i + 4);
      const stop = close < 0 ? n : close + 3;
      out += xml.substring(i, stop);
      i = stop;
    } else if (xml.startsWith('<![CDATA[', i)) {
      const close = xml.indexOf(']]>', i + 9);
      const stop = close < 0 ? n : close + 3;
      out += xml.substring(i, stop);
      i = stop;
    } else if (xml.startsWith('<?', i)) {
      const close = xml.indexOf('?>', i + 2);
      const stop = close < 0 ? n : close + 2;
      out += xml.substring(i, stop);
      i = stop;
    } else if (xml.startsWith('</', i)) {
      const close = xml.indexOf('>', i);
      const stop = close < 0 ? n : close + 1;
      out += '</' + xml.substring(i + 2, stop - 1).trim() + '>';
      i = stop;
    } else {
      // a start tag: its name, its attributes, empty or not
      let j = i + 1;
      while (j < n && !/[\s/>]/.test(xml.charAt(j))) j++;
      let tag = '<' + xml.substring(i + 1, j);
      for (;;) {
        while (j < n && /\s/.test(xml.charAt(j))) j++;
        const c = xml.charAt(j);
        if (c === '/') {
          tag += ' />';
          j = xml.indexOf('>', j) + 1;
          break;
        }
        if (c === '>' || j >= n) {
          tag += '>';
          j++;
          break;
        }
        const eq = xml.indexOf('=', j);
        const name = xml.substring(j, eq).trim();
        let k = eq + 1;
        while (k < n && /\s/.test(xml.charAt(k))) k++;
        const quote = xml.charAt(k);
        const closeQuote = xml.indexOf(quote, k + 1);
        tag += ' ' + name + '="' + writeAttribute(readAttribute(xml.substring(k + 1, closeQuote))) + '"';
        j = closeQuote + 1;
      }
      out += tag;
      i = j;
    }
  }
  return out;
}
