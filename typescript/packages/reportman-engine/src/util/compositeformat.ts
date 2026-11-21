// string.Format(format, args) of .NET 10 (StringBuilder.AppendFormatHelper) for string arguments:
// "{index[,alignment][:format]}" holes, "{{" and "}}" escapes, and the same FormatException
// messages. A format item of a string argument is ignored, as in .NET (string is not
// IFormattable).

import { formatException, NetMessages } from './netexception.js';

const INDEX_LIMIT = 1_000_000;
const WIDTH_LIMIT = 1_000_000;

function invalid(offset: number, reason: string): never {
  throw formatException(NetMessages.formatInvalidStringAt(offset, reason));
}

/** string.Format(format, args...) where every argument is a string (or null). */
export function compositeFormat(format: string, args: readonly (string | null)[]): string {
  let sb = '';
  let pos = 0;
  const moveNext = (): string => {
    pos++;
    if (pos >= format.length) invalid(pos, NetMessages.formatUnclosedFormatItem);
    return format[pos]!;
  };
  for (;;) {
    let ch: string;
    for (;;) {
      if (pos >= format.length) return sb;
      const remainder = format.slice(pos);
      const brace = remainder.search(/[{}]/);
      if (brace < 0) return sb + remainder;
      sb += remainder.slice(0, brace);
      pos += brace;
      const b = format[pos]!;
      ch = moveNext();
      if (b === ch) {
        sb += ch;
        pos++;
        continue;
      }
      if (b !== '{') invalid(pos, NetMessages.formatUnexpectedClosingBrace);
      break;
    }
    let width = 0;
    let leftJustify = false;
    let index = ch.charCodeAt(0) - 48;
    if (index < 0 || index >= 10) invalid(pos, NetMessages.formatExpectedAsciiDigit);
    ch = moveNext();
    if (ch !== '}') {
      while (ch >= '0' && ch <= '9' && index < INDEX_LIMIT) {
        index = index * 10 + ch.charCodeAt(0) - 48;
        ch = moveNext();
      }
      while (ch === ' ') ch = moveNext();
      if (ch === ',') {
        do {
          ch = moveNext();
        } while (ch === ' ');
        if (ch === '-') {
          leftJustify = true;
          ch = moveNext();
        }
        width = ch.charCodeAt(0) - 48;
        if (width < 0 || width >= 10) invalid(pos, NetMessages.formatExpectedAsciiDigit);
        ch = moveNext();
        while (ch >= '0' && ch <= '9' && width < WIDTH_LIMIT) {
          width = width * 10 + ch.charCodeAt(0) - 48;
          ch = moveNext();
        }
        while (ch === ' ') ch = moveNext();
      }
      if (ch !== '}') {
        if (ch !== ':') invalid(pos, NetMessages.formatUnclosedFormatItem);
        for (;;) {
          ch = moveNext();
          if (ch === '}') break;
          if (ch === '{') invalid(pos, NetMessages.formatUnclosedFormatItem);
        }
      }
    }
    pos++;
    if (index >= args.length) throw formatException(NetMessages.formatIndexOutOfRange);
    const s = args[index] ?? '';
    const padLen = width - s.length;
    if (!leftJustify && padLen > 0) sb += ' '.repeat(padLen);
    sb += s;
    if (leftJustify && padLen > 0) sb += ' '.repeat(padLen);
  }
}
