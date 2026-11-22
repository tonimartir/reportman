// Port of Reportman.Reporting.Evaluator: the recursive-descent evaluator of the expression
// language, with the same structure as the C# code so that the semantics are identical:
//
//   separator   ;                     (statements, the last value is the result)
//   variables   :=                    (assignment of a variable)
//   logicalOR   OR
//   logicalAND  AND
//   comparations  <> >< == = < <= > >=  (operands coerced with VariantCoercion)
//   sum_diff    + -                   (+ is Variant.ExpressionSum)
//   mul_div     * /
//   dosign      unary - + NOT, IIF, function calls
//   parentesis  ( )
//   operand     identifiers and literals
//
// Values travel by reference as in C# (ref Variant): a Ref is written by the callee, so the
// partial results of C# (a NOT or a sign applied to a previous value...) are the same here.

import { messageOf, NamedException, UnNamedException } from '../util/netexception.js';
import { toUpperNet } from '../util/chars.js';
import type { RpDateTime } from '../util/datetime.js';
import { compositeFormat } from '../util/compositeformat.js';
import { coercion as coercionOf } from '../variant/coercion.js';
import { createContext, systemNow, type VariantContext } from '../variant/context.js';
import { Variant, VariantType } from '../variant/variant.js';
import type { CultureInfo } from '../util/culture.js';
import { EvalException } from './exception.js';
import type { FieldResolver } from './fields.js';
import { IdenField } from './fields.js';
import { addBuiltinIdentifiers, IdenTime } from './functions.js';
import { EvalIdentifier, EvalIdentifiers, IdenFunction, IdenVariable } from './identifiers.js';
import { EvalParser, TokenType } from './parser.js';

/** A Variant passed by reference (ref Variant in C#). */
export interface Ref {
  v: Variant;
}

class ValueRef implements Ref {
  v: Variant;
  constructor(v: Variant = Variant.null) {
    this.v = v;
  }
}

/** ref idenf.Params[i]: a reference to a slot of the parameter array of a function. */
class ParamRef implements Ref {
  private readonly arr: Variant[];
  private readonly index: number;
  constructor(arr: Variant[], index: number) {
    this.arr = arr;
    this.index = index;
  }
  get v(): Variant {
    return this.arr[this.index]!;
  }
  set v(value: Variant) {
    this.arr[this.index] = value;
  }
}

/** The environment of the built-in functions: the clock and the file system. */
export interface EvalHost {
  /** DateTime.Now: the local wall clock (TODAY is its date). */
  now(): RpDateTime;
  /** FileInfo(path).Exists. */
  fileExists(path: string): boolean;
  /** The bytes of a file (GetStreamFromExpression); undefined when it does not exist. */
  readFile?(path: string): Uint8Array | undefined;
  /**
   * LOADFILE and GETINIVALUE may read files with readFile (Evaluator.AllowFileFunctions of C#;
   * false by default): a report is a file anybody who designs can write.
   */
  fileFunctions?: boolean;
}

/** A host with the JavaScript clock (local time) and no file system (FILEEXISTS is False). */
export const defaultHost: EvalHost = {
  now: systemNow,
  fileExists: () => false,
};

/** DataNeededEventArgs. */
export interface DataNeededEventArgs {
  readonly evaluator: Evaluator;
  readonly dataset: string;
}

export interface EvaluatorOptions {
  /** The culture (default en-US); ignored when context is given. */
  culture?: CultureInfo | string;
  /** Culture, messages and time zone. */
  context?: VariantContext;
  host?: EvalHost;
  /** Language of MONTHNAME and NUMTOTEXT: 0 English, 1 Spanish, 2 Catalan. */
  language?: number;
}

export class Evaluator {
  private fExpression = '';
  private fChecking = false;
  private fResult: Variant = Variant.null;
  private fEvaluating = false;
  private fIdentifierList: EvalIdentifiers;
  private readonly fParser: EvalParser;
  /** AliasList: the dataset fields an expression can read. */
  aliasList: FieldResolver | null = null;
  /** OnDatasetNeeded: called when a field is not found, before looking for it again. */
  onDatasetNeeded: ((args: DataNeededEventArgs) => void) | null = null;
  /** Language: 0 English, 1 Spanish, 2 Catalan (MONTHNAME, NUMTOTEXT). */
  language: number;
  readonly context: VariantContext;
  readonly host: EvalHost;

  constructor(options: EvaluatorOptions = {}, withIdentifiers = true) {
    this.host = options.host ?? defaultHost;
    const host = this.host;
    this.context = options.context ?? createContext(options.culture ?? 'en-US', { now: () => host.now() });
    this.language = options.language ?? 0;
    this.fParser = new EvalParser(this.context);
    this.fIdentifierList = new EvalIdentifiers(this.context.culture.name);
    if (withIdentifiers) addBuiltinIdentifiers((k, i) => this.fIdentifierList.add(k, i), this);
  }

  /** The identifiers (variables, constants and functions). */
  get identifiers(): EvalIdentifiers {
    return this.fIdentifierList;
  }

  /** The last result. */
  get result(): Variant {
    return this.fResult;
  }

  get expression(): string {
    return this.fExpression;
  }

  set expression(value: string) {
    if (this.fEvaluating) throw new UnNamedException(this.context.translator.translateStr(450));
    this.fExpression = value;
  }

  /** CheckSyntax. C# parity: Evaluate resets FChecking, so the text is evaluated in full. */
  checkSyntax(text: string): void {
    this.fChecking = true;
    try {
      this.evaluateText(text);
    } finally {
      this.fChecking = false;
    }
  }

  /** AddVariable: registers a variable as "M." + NAME. */
  addVariable(name: string, iden: EvalIdentifier): void {
    iden.name = toUpperNet(name);
    this.fIdentifierList.add('M.' + iden.name, iden);
  }

  /** AddIden: registers any identifier (a function, a constant...) under its upper case name. */
  addIden(name: string, iden: EvalIdentifier): void {
    iden.name = toUpperNet(name);
    this.fIdentifierList.add(iden.name, iden);
  }

  /** NewVariable: creates a variable with an initial value. */
  newVariable(name: string, valueIni: Variant): IdenVariable {
    if (this.searchIdentifier(name) !== null) throw new NamedException('Variable exists:' + name, name);
    const iden = new IdenVariable(this);
    this.addVariable(name, iden);
    iden.value = valueIni;
    return iden;
  }

  /** SearchIdentifier: an identifier, a variable (M.NAME or NAME) or a dataset field, or null. */
  searchIdentifier(idenname: string): EvalIdentifier | null {
    let iden: EvalIdentifier | null = null;
    idenname = toUpperNet(idenname);
    let sdataset = '';
    let sfield = idenname;
    const index = idenname.indexOf('.');
    if (index < 0) {
      const found = this.fIdentifierList.get(idenname);
      if (found !== undefined) {
        // TIME came from the Delphi engine when reports of the C# one could already name a field
        // TIME without its dataset: such a field keeps winning
        if (found instanceof IdenTime && this.aliasList !== null) {
          const r = this.aliasList.findField(idenname, '');
          if (r.iden !== null && !r.duplicated) return r.iden;
        }
        return found;
      }
      sfield = idenname;
    } else {
      sdataset = idenname.substring(0, index);
      sfield = idenname.substring(index + 1);
      if (sdataset === 'M') {
        const found = this.fIdentifierList.get('M.' + sfield);
        if (found !== undefined) return found;
      }
    }
    if (sdataset === '') {
      const found = this.fIdentifierList.get('M.' + sfield);
      if (found !== undefined) iden = found;
    }
    if (this.aliasList !== null) {
      let r = this.aliasList.findField(sfield, sdataset);
      if (r.iden === null && this.onDatasetNeeded !== null) {
        this.onDatasetNeeded({ evaluator: this, dataset: sdataset });
        r = this.aliasList.findField(sfield, sdataset);
      }
      if (r.duplicated) throw new NamedException('Especify variable or file:' + sfield, sfield);
      if (r.iden !== null) {
        if (iden !== null) throw new NamedException('Especify variable or file:' + sfield, sfield);
        if (r.iden instanceof IdenField) r.iden.translator = this.context.translator;
        iden = r.iden;
      }
    }
    return iden;
  }

  /**
   * GetStreamFromExpression: the bytes of a Binary field (without a Paradox graphic header), of a
   * Binary result, or of the file whose name the expression gives (host.readFile).
   */
  getStreamFromExpression(expre: string): Uint8Array | null {
    let iden: EvalIdentifier | null = this.searchIdentifier(expre);
    let memstream: Uint8Array | null = null;
    if (iden !== null) {
      if (iden instanceof IdenField) {
        const avalue = iden.value;
        if (avalue.varType === VariantType.Binary) {
          memstream = avalue.getBytes();
          if (memstream.length > 8) {
            const view = new DataView(memstream.buffer, memstream.byteOffset, memstream.byteLength);
            const count = view.getInt16(0, true);
            const htype = view.getInt16(2, true);
            const size = view.getInt32(4, true);
            if (count === 1 && htype === 0x0100) {
              // new byte[hd.Size] of a negative size
              if (size < 0) throw new UnNamedException('Arithmetic operation resulted in an overflow.');
              memstream = memstream.slice(8, 8 + size);
            }
          }
        } else if (avalue.varType !== VariantType.Null) iden = null;
      } else iden = null;
    }
    if (iden === null) {
      const avalue = this.evaluateText(expre);
      if (avalue.varType === VariantType.Binary) memstream = avalue.getBytes();
      else {
        if (avalue.varType !== VariantType.String) throw new NamedException('Field or file not found:' + expre, expre);
        const path = avalue.toString(this.context);
        if (!this.host.fileExists(path)) throw new NamedException('File not found:' + path, path);
        const bytes = this.host.readFile?.(path);
        if (bytes === undefined) throw new NamedException('File not found:' + path, path);
        memstream = new Uint8Array(bytes);
      }
    }
    return memstream;
  }

  // -------------------------------------------------------------------------------------------
  // The grammar

  private T(index: number): string {
    return this.context.translator.translateStr(index);
  }

  private error(index: number): EvalException {
    return new EvalException(this.T(index), this.fParser.sourceLine, this.fParser.sourcePos, '');
  }

  /** "Unknown identifier: X" whatever the translation ends with. */
  private unknownIdentifier(name: string): string {
    return this.T(440).replace(/[ :\r]+$/, '') + ': ' + name;
  }

  private operand(fvalue: Ref): void {
    const p = this.fParser;
    switch (p.currentToken()) {
      case TokenType.Symbol: {
        const iden = this.searchIdentifier(p.tokenString());
        if (iden === null) throw new EvalException(this.unknownIdentifier(p.tokenString()), p.sourceLine, p.sourcePos, '');
        // C# parity: a function reached here (after NOT or a sign: NOT ISNUMERIC(...)) is read
        // with the parameters of its previous call, and its arguments are left unparsed.
        fvalue.v = iden.value;
        p.nextToken();
        break;
      }
      case TokenType.String:
        fvalue.v = Variant.fromString(p.tokenString());
        p.nextToken();
        break;
      case TokenType.Integer:
        fvalue.v = Variant.fromInteger(p.asInteger);
        p.nextToken();
        break;
      case TokenType.Double:
        fvalue.v = Variant.fromDouble(p.asDouble);
        p.nextToken();
        break;
      case TokenType.Decimal:
        fvalue.v = Variant.fromDecimal(p.asDecimal);
        p.nextToken();
        break;
      case TokenType.Operator:
        // C# parity: an operator here leaves the value as it is and consumes nothing.
        break;
      default:
        throw this.error(449);
    }
  }

  private parentesis(fvalue: Ref): void {
    const p = this.fParser;
    if (p.currentToken() === TokenType.Operator) {
      let aoperator = p.tokenString();
      if (aoperator === '(') {
        p.nextToken();
        this.separator(fvalue);
        aoperator = '';
        if (p.currentToken() === TokenType.Operator) aoperator = p.tokenString();
        if (aoperator !== ')') throw this.error(441);
        p.nextToken();
      } else this.operand(fvalue);
    } else this.operand(fvalue);
  }

  private executeIIF(fvalue: Ref): void {
    const p = this.fParser;
    const auxiliar = new ValueRef();
    let aoperator = '';
    if (p.currentToken() === TokenType.Operator) aoperator = p.tokenString();
    if (aoperator !== '(') throw this.error(441);
    p.nextToken();
    this.separator(fvalue);
    if (fvalue.v.isNull) fvalue.v = Variant.fromBoolean(false);
    if (fvalue.v.varType !== VariantType.Boolean && !this.fChecking) throw this.error(438);
    aoperator = '';
    if (p.currentToken() === TokenType.Operator) aoperator = p.tokenString();
    if (aoperator !== ',') throw this.error(449);
    p.nextToken();
    if (this.fChecking) {
      this.separator(fvalue);
      aoperator = '';
      if (p.currentToken() === TokenType.Operator) aoperator = p.tokenString();
      if (aoperator !== ',') throw this.error(449);
      p.nextToken();
      this.separator(auxiliar);
    } else {
      let oldFChecking: boolean;
      if (fvalue.v.toBool(this.context)) {
        this.separator(fvalue);
        aoperator = '';
        if (p.currentToken() === TokenType.Operator) aoperator = p.tokenString();
        if (aoperator !== ',') throw this.error(449);
        p.nextToken();
        oldFChecking = this.fChecking;
        this.fChecking = true;
        this.separator(auxiliar);
        this.fChecking = oldFChecking;
      } else {
        oldFChecking = this.fChecking;
        this.fChecking = true;
        this.separator(auxiliar);
        aoperator = '';
        if (p.currentToken() === TokenType.Operator) aoperator = p.tokenString();
        if (aoperator !== ',') throw this.error(449);
        p.nextToken();
        this.fChecking = oldFChecking;
        this.separator(fvalue);
      }
    }
    aoperator = '';
    if (p.currentToken() === TokenType.Operator) aoperator = p.tokenString();
    if (aoperator !== ')') throw this.error(441);
    p.nextToken();
  }

  /** Unary operators (-, +, NOT), IIF and function calls. */
  private dosign(fvalue: Ref): void {
    const p = this.fParser;
    let aoperator = '';
    let iden: EvalIdentifier | null = null;
    let idenf: IdenFunction | null = null;
    if (p.currentToken() === TokenType.Operator) {
      aoperator = p.tokenString();
      if (aoperator === '-' || aoperator === '+' || aoperator === 'NOT' || aoperator === 'IIF') p.nextToken();
    } else if (p.currentToken() === TokenType.Symbol) {
      iden = this.searchIdentifier(p.tokenString());
      if (iden === null) throw new EvalException(this.unknownIdentifier(p.tokenString()), p.sourceLine, p.sourcePos, '');
      if (iden instanceof IdenFunction) {
        idenf = iden;
        if (idenf.paramCount > 0) {
          p.nextToken();
          if (p.currentToken() !== TokenType.Operator) throw this.error(441);
          if (p.tokenString() !== '(') throw this.error(441);
        }
        for (let i = 0; i < idenf.paramCount; i++) {
          p.nextToken();
          this.separator(new ParamRef(idenf.params, i));
          if (idenf.paramCount > i + 1) {
            aoperator = '';
            if (p.currentToken() === TokenType.Operator) aoperator = p.tokenString();
            if (aoperator !== ',') {
              throw new EvalException(compositeFormat(this.T(448), [',']), p.sourceLine, p.sourcePos, '');
            }
          }
        }
        if (idenf.paramCount > 0) {
          if (p.currentToken() !== TokenType.Operator) throw this.error(441);
          if (p.tokenString() !== ')') throw this.error(441);
          p.nextToken();
        }
      } else iden = null;
      aoperator = '';
    }
    if (iden === null) {
      if (aoperator === 'IIF') this.executeIIF(fvalue);
      else this.parentesis(fvalue);
    } else if (idenf!.paramCount < 1) p.nextToken();
    if (iden !== null) {
      if (!this.fChecking) fvalue.v = idenf!.value;
      else fvalue.v = Variant.null;
    } else if (aoperator === '-') {
      if (!this.fChecking) fvalue.v = Variant.negate(fvalue.v, this.context);
    } else if (aoperator === 'NOT') {
      if (!this.fChecking) fvalue.v = Variant.fromBoolean(!fvalue.v.toBool(this.context));
    }
  }

  private mulDiv(fvalue: Ref): void {
    const p = this.fParser;
    const auxiliar = new ValueRef();
    this.dosign(fvalue);
    while (p.currentToken() === TokenType.Operator) {
      const aoperator = p.tokenString();
      if (aoperator === '*') {
        p.nextToken();
        const auxiliar2 = fvalue.v;
        this.dosign(auxiliar);
        if (!this.fChecking) fvalue.v = Variant.mul(auxiliar2, auxiliar.v, this.context);
      } else if (aoperator === '/') {
        p.nextToken();
        const auxiliar2 = fvalue.v;
        this.dosign(auxiliar);
        if (!this.fChecking) fvalue.v = Variant.div(auxiliar2, auxiliar.v, this.context);
      } else break;
    }
  }

  private sumDiff(fvalue: Ref): void {
    const p = this.fParser;
    const auxiliar = new ValueRef();
    this.mulDiv(fvalue);
    while (p.currentToken() === TokenType.Operator) {
      const aoperator = p.tokenString();
      if (aoperator === '+') {
        p.nextToken();
        const auxiliar2 = fvalue.v;
        this.mulDiv(auxiliar);
        // C# parity: computed also while checking (no FChecking test around the +).
        fvalue.v = Variant.expressionSum(auxiliar2, auxiliar.v, this.context);
      } else if (aoperator === '-') {
        p.nextToken();
        const auxiliar2 = fvalue.v;
        this.mulDiv(auxiliar);
        fvalue.v = Variant.sub(auxiliar2, auxiliar.v, this.context);
      } else break;
    }
  }

  private comparations(fvalue: Ref): void {
    const p = this.fParser;
    const auxiliar = new ValueRef();
    const ctx = this.context;
    this.sumDiff(fvalue);
    while (p.currentToken() === TokenType.Operator) {
      const aoperator = p.tokenString();
      let op: ((a: Variant, b: Variant) => boolean) | null = null;
      if (aoperator === '<>' || aoperator === '><') op = (a, b) => Variant.notEquals(a, b, ctx);
      else if (aoperator === '==' || aoperator === '=') op = (a, b) => Variant.equals(a, b, ctx);
      else if (aoperator === '<') op = (a, b) => Variant.lessThan(a, b, ctx);
      else if (aoperator === '<=') op = (a, b) => Variant.lessOrEqual(a, b, ctx);
      else if (aoperator === '>') op = (a, b) => Variant.greaterThan(a, b, ctx);
      else if (aoperator === '>=') op = (a, b) => Variant.greaterOrEqual(a, b, ctx);
      else break;
      p.nextToken();
      let auxiliar2 = fvalue.v;
      this.sumDiff(auxiliar);
      if (!this.fChecking) {
        let right = auxiliar.v;
        [auxiliar2, right] = coerceOperands(auxiliar2, right, ctx);
        auxiliar.v = right;
        fvalue.v = Variant.fromBoolean(op(auxiliar2, right));
      }
    }
  }

  private logicalAND(fvalue: Ref): void {
    const p = this.fParser;
    this.comparations(fvalue);
    let aoperator = '';
    if (p.currentToken() === TokenType.Operator) aoperator = toUpperNet(p.tokenString());
    while (aoperator === 'AND') {
      const auxiliar = new ValueRef();
      const auxiliar2 = fvalue.v;
      p.nextToken();
      this.comparations(auxiliar);
      if (!this.fChecking) fvalue.v = Variant.fromBoolean(auxiliar2.toBool(this.context) && auxiliar.v.toBool(this.context));
      aoperator = '';
      if (p.currentToken() === TokenType.Operator) aoperator = toUpperNet(p.tokenString());
    }
  }

  private logicalOR(fvalue: Ref): void {
    const p = this.fParser;
    this.logicalAND(fvalue);
    let aoperator = '';
    if (p.currentToken() === TokenType.Operator) aoperator = toUpperNet(p.tokenString());
    while (aoperator === 'OR') {
      const auxiliar = new ValueRef();
      const auxiliar2 = fvalue.v;
      p.nextToken();
      this.logicalAND(auxiliar);
      if (!this.fChecking) fvalue.v = Variant.fromBoolean(auxiliar2.toBool(this.context) || auxiliar.v.toBool(this.context));
      aoperator = '';
      if (p.currentToken() === TokenType.Operator) aoperator = toUpperNet(p.tokenString());
    }
  }

  private variables(fvalue: Ref): void {
    const p = this.fParser;
    if (p.currentToken() === TokenType.Symbol) {
      const iden = this.searchIdentifier(p.tokenString());
      if (iden === null) {
        throw new EvalException(this.unknownIdentifier(p.tokenString()), p.sourceLine, p.sourcePos, p.tokenString());
      }
      if (iden instanceof IdenVariable) {
        if (p.isAssignment()) {
          p.nextToken();
          p.nextToken();
          this.separator(fvalue);
          // C# parity: the separator above evaluates the rest of the statement list before the
          // assignment, so "X := 5; X + 1" assigns X + 1 computed with the old X, not 5.
          if (!this.fChecking) iden.value = fvalue.v;
          let aoperator = '';
          if (p.currentToken() === TokenType.Operator) aoperator = p.tokenString();
          if (aoperator === ';') this.separator(fvalue);
        } else this.logicalOR(fvalue);
      } else this.logicalOR(fvalue);
    } else this.logicalOR(fvalue);
  }

  private separator(fvalue: Ref): void {
    const p = this.fParser;
    let aoperator = '';
    if (p.currentToken() === TokenType.Operator) aoperator = p.tokenString();
    if (aoperator === ';') {
      while (aoperator === ';') {
        p.nextToken();
        if (p.currentToken() !== TokenType.Eof) this.variables(fvalue);
        aoperator = '';
        if (p.currentToken() === TokenType.Operator) aoperator = p.tokenString();
      }
    } else {
      this.variables(fvalue);
      aoperator = '';
      if (p.currentToken() === TokenType.Operator) aoperator = p.tokenString();
      while (aoperator === ';') {
        p.nextToken();
        if (p.currentToken() !== TokenType.Eof) this.variables(fvalue);
        aoperator = '';
        if (p.currentToken() === TokenType.Operator) aoperator = p.tokenString();
      }
    }
  }

  private evaluateExpression(): Variant {
    const fpartial = new ValueRef();
    try {
      this.fEvaluating = true;
      try {
        this.separator(fpartial);
      } finally {
        this.fEvaluating = false;
      }
      if (this.fParser.currentToken() !== TokenType.Eof) throw this.error(449);
    } catch (e) {
      if (e instanceof EvalException) throw e;
      throw new EvalException(messageOf(e), this.fParser.sourceLine, this.fParser.sourcePos, '');
    }
    return fpartial.v;
  }

  /** EvaluateText: evaluates a text (in a nested evaluator sharing the identifiers when evaluating). */
  evaluateText(text: string): Variant {
    if (this.fEvaluating) {
      const nested = new Evaluator({ context: this.context, host: this.host, language: this.language }, false);
      nested.aliasList = this.aliasList;
      nested.fIdentifierList = this.fIdentifierList;
      nested.expression = text;
      nested.evaluate();
      return nested.result;
    }
    this.expression = text;
    this.evaluate();
    return this.result;
  }

  /** Evaluate: the value of the expression (True for an empty one). */
  evaluate(): Variant {
    this.fParser.expression = this.fExpression;
    this.fChecking = false;
    if (this.fParser.currentToken() === TokenType.Eof) this.fResult = Variant.fromBoolean(true);
    else this.fResult = this.evaluateExpression();
    return this.fResult;
  }
}

/**
 * Evaluator.CoerceOperands: VariantCoercion.Coercion when the types differ, but a date and a number,
 * which Variant.compare compares as numbers (as Delphi compares a TDateTime).
 */
function coerceOperands(a: Variant, b: Variant, ctx: VariantContext): [Variant, Variant] {
  if ((a.varType === VariantType.DateTime && b.isNumber()) || (b.varType === VariantType.DateTime && a.isNumber())) return [a, b];
  if (a.varType !== b.varType) {
    const c = coercionOf(a, b, ctx);
    if (c !== null) return c;
  }
  return [a, b];
}
