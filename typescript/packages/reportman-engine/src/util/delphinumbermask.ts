// The number masks of the Delphi engine (FormatFloat) as custom formats of .NET, for the reports
// converted from Delphi (convertedFromDelphi). The same code as DelphiNumberMask.cs of the C#
// engine. What differs between the two mask languages: for Delphi % and the per mille sign are
// text (.NET multiplies by 100 and 1000), a backslash is text (.NET: an escape), a comma anywhere
// in a section asks for thousands separators (.NET: only between two digits of the integer part;
// before the decimal point it divides by 1000), and an E is an exponent only with a sign after it
// (.NET: also E0).

/** Translates the section that starts at i into out; returns the index of its ; or the length. */
function section(mask: string, start: number, out: string[]): number {
  let sb = '';
  // The positions in sb of the digit placeholders of the integer part
  const integerDigits: number[] = [];
  let grouping = false;
  let decimalPoint = -1;
  let i = start;
  while (i < mask.length && mask.charAt(i) !== ';') {
    const c = mask.charAt(i);
    switch (c) {
      case "'":
      case '"': {
        let end = mask.indexOf(c, i + 1);
        if (end < 0) end = mask.length - 1;
        sb += mask.substring(i, end + 1);
        i = end + 1;
        continue;
      }
      case ',':
        grouping = true;
        break;
      case '.':
        // The first one is the decimal point; the others write nothing
        if (decimalPoint < 0) {
          decimalPoint = sb.length;
          sb += '.';
        }
        break;
      case '0':
      case '#':
        if (decimalPoint < 0) integerDigits.push(sb.length);
        sb += c;
        break;
      case 'E':
      case 'e': {
        // E+ and E- are the exponent in both; an E before a 0 is one for .NET only
        const next = i + 1 < mask.length ? mask.charAt(i + 1) : '';
        if (next === '0') sb += '\\';
        sb += c;
        if (next === '+' || next === '-') {
          sb += next;
          i++;
        }
        break;
      }
      case '%':
      case '‰':
      case '\\':
        sb += '\\' + c;
        break;
      default:
        sb += c;
    }
    i++;
  }
  if (grouping) {
    // .NET groups when a comma is between two digits of the integer part
    const insert = (at: number, text: string): void => {
      sb = sb.substring(0, at) + text + sb.substring(at);
    };
    if (integerDigits.length >= 2) insert((integerDigits[0] as number) + 1, ',');
    else if (integerDigits.length === 1) insert(integerDigits[0] as number, '#,');
    else if (decimalPoint >= 0) insert(decimalPoint, '#,#');
  }
  out.push(sb);
  return i;
}

/** The custom format of .NET that formats as FormatFloat does with the mask. */
export function delphiNumberMaskToDotNet(mask: string): string {
  if (mask.length === 0) return mask;
  const out: string[] = [];
  let i = 0;
  for (;;) {
    i = section(mask, i, out);
    if (i >= mask.length) break;
    // The ; that ended the section
    i++;
    // A mask that ends in ; has an empty last section
    if (i >= mask.length) {
      out.push('');
      break;
    }
  }
  return out.join(';');
}
