import { isWhiteSpaceNet } from 'reportman-text';
import { byteToHex2 } from './netformat.js';

/** String.Trim(): without the Char.IsWhiteSpace characters of both ends. */
export function trimNet(text: string): string {
  let start = 0;
  let end = text.length - 1;
  while (start <= end && isWhiteSpaceNet(text.charCodeAt(start))) start++;
  while (end >= start && isWhiteSpaceNet(text.charCodeAt(end))) end--;
  return text.substring(start, end + 1);
}

/** The text of an XML element or attribute (StringUtil.EscapeXML): &, <, >, " and ' escaped. */
export function escapeXml(text: string | null | undefined): string {
  if (text === null || text === undefined || text === '') return '';
  return text.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;').replaceAll("'", '&apos;');
}

/**
 * A PDF string (PDFFile.EncodePDFText): an escaped literal for ASCII text, UTF-16BE hexadecimal
 * with BOM otherwise (lone surrogates as U+FFFD, as the .NET encoder writes them).
 */
export function encodePDFText(text: string | null | undefined): string {
  const s = text ?? '';
  let isASCII = true;
  for (let i = 0; i < s.length; i++) {
    if (s.charCodeAt(i) > 127) {
      isASCII = false;
      break;
    }
  }
  if (isASCII) {
    let result = '(';
    for (const c of s) {
      switch (c) {
        case '(':
        case ')':
        case '\\':
          result += '\\' + c;
          break;
        default:
          result += c;
          break;
      }
    }
    return result + ')';
  }
  let hex = '<FEFF';
  for (let i = 0; i < s.length; i++) {
    let c = s.charCodeAt(i);
    if (c >= 0xd800 && c <= 0xdbff) {
      const d = i + 1 < s.length ? s.charCodeAt(i + 1) : 0;
      if (d >= 0xdc00 && d <= 0xdfff) {
        hex += byteToHex2(c >> 8) + byteToHex2(c) + byteToHex2(d >> 8) + byteToHex2(d);
        i++;
        continue;
      }
      c = 0xfffd;
    } else if (c >= 0xdc00 && c <= 0xdfff) c = 0xfffd;
    hex += byteToHex2(c >> 8) + byteToHex2(c);
  }
  return hex + '>';
}
