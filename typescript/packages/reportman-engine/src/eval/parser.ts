// Port of Reportman.Reporting.EvalParser and TokenType: the tokenizer of the expression language.
// The quirks of the C# tokenizer are kept (see the "C# parity" notes).

import { isDigit, isLetter, isLetterOrDigit, isWhiteSpace, toUpperNet } from '../util/chars.js';
import { compositeFormat } from '../util/compositeformat.js';
import { CsDecimal } from '../util/decimal.js';
import { formatDecimal, formatDouble, formatInteger } from '../util/numberformat.js';
import { NumberStyles, parseDecimal, parseDouble, parseInt32 } from '../util/numberparse.js';
import type { VariantContext } from '../variant/context.js';
import { EvalException } from './exception.js';

/** Reportman.Reporting.TokenType. */
export enum TokenType {
  Eof = 0,
  Symbol = 1,
  String = 2,
  Integer = 3,
  Double = 4,
  Decimal = 5,
  Operator = 6,
  Comment = 7,
}

const EVAL_OPERATORS = '*+-/()=><:;,';
const COMPOSITE_OPERATORS = ':!<>=';
const HEXA_DIGITS = '0123456789ABCDEF';
const NUMBER_SET = '.Ee';
const FLOAT_EXPLICIT = 'cCdDsSfF';

function isValidFirstSymbol(c: string): boolean {
  return isLetter(c) || c === '.' || c === '_';
}

function isValidSecondSymbol(c: string): boolean {
  return isLetterOrDigit(c) || c === '.' || c === '_';
}

export class EvalParser {
  private fExpression = '';
  private aoperator = '';
  private fSourcePtr = 0;
  private fTokenPtr = 0;
  private fSourceLine = 0;
  private fBufEnd = 0;
  private fString = '';
  private fInteger = 0;
  private fDouble = 0;
  private fDecimal: CsDecimal = CsDecimal.zero;
  private fToken: TokenType = TokenType.Eof;
  private readonly ctx: VariantContext;

  constructor(ctx: VariantContext) {
    this.ctx = ctx;
  }

  get token(): TokenType {
    return this.fToken;
  }

  /** The current token (a method, so that a caller re-reads it after nextToken). */
  currentToken(): TokenType {
    return this.fToken;
  }

  get sourceLine(): number {
    return this.fSourceLine;
  }

  /** The position after the current token. */
  get sourcePos(): number {
    return this.fSourcePtr;
  }

  get asInteger(): number {
    return this.fInteger;
  }

  get asDouble(): number {
    return this.fDouble;
  }

  get asDecimal(): CsDecimal {
    return this.fDecimal;
  }

  /** The text of the current token (operators longer than two characters in upper case). */
  tokenString(): string {
    const nfi = this.ctx.culture.number;
    switch (this.fToken) {
      case TokenType.String:
        return this.fString;
      case TokenType.Integer:
        return formatInteger(this.fInteger, '', nfi, 32);
      case TokenType.Decimal:
        return formatDecimal(this.fDecimal, '', nfi);
      case TokenType.Double:
        return formatDouble(this.fDouble, '', nfi);
      case TokenType.Operator: {
        const l = this.fSourcePtr - this.fTokenPtr;
        const s = this.fExpression.substring(this.fTokenPtr, this.fSourcePtr);
        return l > 2 ? toUpperNet(s) : s;
      }
      default: {
        let s = this.fExpression.substring(this.fTokenPtr, this.fSourcePtr);
        if (this.fToken === TokenType.Symbol && s[0] === '[' && s[s.length - 1] === ']') s = s.substring(1, s.length - 1);
        return s;
      }
    }
  }

  private skipBlanks(): void {
    // C# parity: the loop stops at FBufEnd (length - 2): the last character is never skipped,
    // a trailing blank is read as an unknown character, which ends the expression (Eof).
    while (this.fSourcePtr <= this.fBufEnd) {
      const c = this.fExpression[this.fSourcePtr]!;
      if (c === '\n') this.fSourceLine++;
      if (!isWhiteSpace(c)) break;
      this.fSourcePtr++;
    }
  }

  private error448(text: string, pos: number): EvalException {
    return new EvalException(compositeFormat(this.ctx.translator.translateStr(448), [text]), this.fSourceLine, pos, '');
  }

  nextToken(): TokenType {
    const e = this.fExpression;
    this.skipBlanks();
    let p = this.fSourcePtr;
    this.fTokenPtr = p;
    let resulttype = TokenType.Eof;
    if (p >= e.length) {
      resulttype = TokenType.Eof;
    } else if (isValidFirstSymbol(e[p]!)) {
      p++;
      while (p < e.length) {
        if (isValidSecondSymbol(e[p]!) || e[p] === '.') p++;
        else break;
      }
      resulttype = TokenType.Symbol;
      const thetoken = toUpperNet(e.substring(this.fSourcePtr, p));
      if (thetoken === 'OR' || thetoken === 'AND' || thetoken === 'NOT' || thetoken === 'IIF') resulttype = TokenType.Operator;
    } else if (e[p] === '[') {
      p++;
      while (p < e.length) {
        if (e[p] !== ']') p++;
        else {
          p++;
          break;
        }
      }
      if (e[p - 1] !== ']') throw this.error448(']', p - 1);
      resulttype = TokenType.Symbol;
    } else if (EVAL_OPERATORS.includes(e[p]!)) {
      this.aoperator = e[p]!;
      p++;
      if (p < e.length) {
        switch (e[p]) {
          case '=':
            if (COMPOSITE_OPERATORS.includes(this.aoperator)) p++;
            break;
          case '<':
            if (this.aoperator === '>') p++;
            break;
          case '>':
            if (this.aoperator === '<') p++;
            break;
        }
      }
      resulttype = TokenType.Operator;
    } else if (e[p] === '#' || e[p] === "'") {
      // Each #nn is a character, as in Delphi: #13#10 is CR LF (the code starts again at each #;
      // it wraps as a C# int and is cut to 16 bits by (char)I)
      let j = 0;
      let i = 0;
      let str = '';
      while (p < e.length) {
        if (e[p] === '#') {
          p++;
          i = 0;
          while (p < e.length) {
            if (isDigit(e[p]!)) {
              i = (i * 10 + (e.charCodeAt(p) - 48)) | 0;
              p++;
              j++;
            } else break;
          }
          str += String.fromCharCode(i & 0xffff);
        } else if (e[p] === "'") {
          p++;
          while (p < e.length) {
            if (e[p] === "'") {
              p++;
              if (p < e.length) {
                if (e[p] !== "'") {
                  j++;
                  break;
                } else str += e[p];
              } else {
                j++;
                break;
              }
            } else str += e[p];
            j++;
            p++;
          }
        } else break;
      }
      this.fString = str;
      // C# parity: an unterminated string is an error only when nothing was read ('abc is "abc").
      if (p >= e.length && j === 0) throw this.error448("'", p - 1);
      resulttype = TokenType.String;
    } else if (e[p] === '$') {
      p++;
      let i = 0;
      let j = 0;
      if (p < e.length) {
        let index = HEXA_DIGITS.indexOf(toUpperNet(e[p]!));
        while (index >= 0) {
          i = (i * 16 + index) | 0;
          j++;
          p++;
          if (p < e.length) index = HEXA_DIGITS.indexOf(toUpperNet(e[p]!));
          else index = -1;
        }
      }
      if (j === 0) throw new EvalException(this.ctx.translator.translateStr(445), this.fSourceLine, p - 1, '');
      this.fInteger = i;
      resulttype = TokenType.Integer;
    } else if (isDigit(e[p]!)) {
      let fnumber = e[p]!;
      let decimals = -1;
      p++;
      resulttype = TokenType.Integer;
      if (p < e.length) {
        let index = NUMBER_SET.indexOf(e[p]!);
        while (index >= 0 || isDigit(e[p]!)) {
          if (index === 0) {
            if (decimals < 0) decimals++;
            else throw new EvalException(this.ctx.translator.translateStr(445), this.fSourceLine, p - 1, '');
            fnumber += this.ctx.culture.number.currencyDecimalSeparator;
            resulttype = TokenType.Decimal;
          } else if (index < 0) fnumber += e[p];
          else {
            resulttype = TokenType.Double;
            fnumber += e[p];
          }
          p++;
          if (p >= e.length) break;
          index = NUMBER_SET.indexOf(e[p]!);
        }
      }
      if (fnumber.length > 20) resulttype = TokenType.Double;
      if (resulttype === TokenType.Integer && fnumber.length > 8) resulttype = TokenType.Double;
      if (p < e.length && FLOAT_EXPLICIT.includes(e[p]!)) {
        p++;
        resulttype = TokenType.Double;
      }
      const nfi = this.ctx.culture.number;
      switch (resulttype) {
        case TokenType.Integer:
          this.fInteger = parseInt32(fnumber, NumberStyles.Integer, nfi);
          break;
        case TokenType.Decimal:
          this.fDecimal = parseDecimal(fnumber, NumberStyles.Number, nfi);
          break;
        case TokenType.Double:
          this.fDouble = parseDouble(fnumber, NumberStyles.Float | NumberStyles.AllowThousands, nfi);
          break;
      }
    }
    // C# parity: any other character (" ! @ { ...) ends the expression as an Eof token.
    this.fToken = resulttype;
    this.fSourcePtr = p;
    return resulttype;
  }

  get expression(): string {
    return this.fExpression;
  }

  set expression(value: string) {
    this.fExpression = value;
    this.fSourcePtr = 0;
    this.fTokenPtr = 1;
    this.fSourceLine = 1;
    this.fBufEnd = this.fExpression.length - 2;
    this.nextToken();
  }

  /** Whether the text after the current token starts with ":=" (blanks before the ':'). */
  isAssignment(): boolean {
    let index = this.fSourcePtr;
    let foundtwopoints = false;
    let foundequal = false;
    while (index <= this.fBufEnd) {
      const c = this.fExpression[index]!;
      if (!isWhiteSpace(c)) {
        if (c === ':') {
          if (foundtwopoints) break;
          foundtwopoints = true;
        } else if (c === '=') {
          if (foundtwopoints) foundequal = true;
          break;
        } else break;
      } else if (foundtwopoints) break;
      index++;
    }
    return foundtwopoints && foundequal;
  }
}
