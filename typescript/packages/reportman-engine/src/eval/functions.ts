// Port of Reportman.Reporting.EvalFunctions: the built-in functions of the expression language.
// The C# behaviours are kept as they are, including the odd ones (see the "C# parity" notes).

import {
  argumentNull,
  indexOfCulture,
  replaceNet,
  substringNet,
  toLowerNet,
  toUpperNet,
  trimNet,
} from '../util/chars.js';
import { fromBase64String } from '../util/base64.js';
import { CsDecimal } from '../util/decimal.js';
import { compareValue, numberToText, roundDecimalUp } from '../util/doubleutil.js';
import { argumentException, invalidCastException, NamedException, nullReferenceException, UnNamedException, divideByZeroException, overflowException, NetMessages } from '../util/netexception.js';
import { convertDecimalToInt64, NumberStyles, parseDecimal, parseDouble, parseInt32 } from '../util/numberparse.js';
import { parseDateTime } from '../util/dateparse.js';
import { DateTimeKind } from '../util/datetime.js';
import { ParamType, Variant, VariantType } from '../variant/variant.js';
import type { VariantContext } from '../variant/context.js';
import type { Evaluator } from './evaluator.js';
import { type EvalIdentifier, IdenFalse, IdenFunction, IdenNull, IdenTrue } from './identifiers.js';

abstract class BuiltinFunction extends IdenFunction {
  protected constructor(evaluator: Evaluator, name: string, paramCount: number, model = '') {
    super(evaluator);
    this.setParamCount(paramCount);
    this.name = name;
    this.fModel = model;
  }

  protected get ev(): Evaluator {
    return this.evalObject!;
  }

  protected get ctx(): VariantContext {
    return this.evalObject!.context;
  }

  protected typeError(name: string): NamedException {
    return new NamedException(this.translate(438), name);
  }

  /** (string)Params[i] with the null of a non text value. */
  protected str(i: number): string | null {
    return this.params[i]!.toImplicitString(this.ctx);
  }
}

/** A .NET string method called on a null string reference. */
function notNull(s: string | null): string {
  if (s === null) throw nullReferenceException();
  return s;
}

class IdenSinus extends BuiltinFunction {
  constructor(e: Evaluator) {
    super(e, 'SIN', 1, 'function Sin(value:double):double');
  }
  protected getValue(): Variant {
    const p = this.params[0]!;
    if (p.varType === VariantType.Null) return Variant.null;
    if (!p.isNumber()) throw this.typeError('SIN');
    return Variant.fromDouble(Math.sin(p.toDouble(this.ctx)));
  }
}

class IdenMax extends BuiltinFunction {
  constructor(e: Evaluator) {
    super(e, 'MAX', 2, 'function Max(value1,value2:Variant):Variant');
  }
  protected getValue(): Variant {
    if (this.params[0]!.varType === VariantType.Null) throw this.typeError('MAX');
    if (this.params[1]!.varType === VariantType.Null) throw this.typeError('MAX');
    return Variant.greaterThan(this.params[0]!, this.params[1]!, this.ctx) ? this.params[0]! : this.params[1]!;
  }
}

class IdenUpperCase extends BuiltinFunction {
  constructor(e: Evaluator) {
    super(e, 'UPPERCASE', 1, 'function UpperCase(value:string):string');
  }
  protected getValue(): Variant {
    const p = this.params[0]!;
    if (p.varType === VariantType.Null) return Variant.null;
    if (p.varType !== VariantType.String) throw this.typeError('UPPERCASE');
    return Variant.fromString(toUpperNet(p.toString(this.ctx)));
  }
}

class IdenStringToBin extends BuiltinFunction {
  constructor(e: Evaluator) {
    super(e, 'STRINGTOBIN', 1, 'function StringToBin(value:string):binary');
  }
  protected getValue(): Variant {
    const p = this.params[0]!;
    if (p.varType === VariantType.Null) return Variant.null;
    if (p.varType !== VariantType.String) throw this.typeError('STRINGTOBIN');
    return Variant.fromBinary(fromBase64String(p.toString(this.ctx)));
  }
}

class IdenDay extends BuiltinFunction {
  constructor(e: Evaluator) {
    super(e, 'DAY', 1, 'function DAY(value:DateTime):Integer');
  }
  protected getValue(): Variant {
    const p = this.params[0]!;
    if (p.varType === VariantType.Null) return Variant.null;
    if (p.varType !== VariantType.DateTime) throw this.typeError('DAY');
    return Variant.fromInteger(p.toDateTime(this.ctx).day);
  }
}

class IdenMonth extends BuiltinFunction {
  constructor(e: Evaluator) {
    super(e, 'MONTH', 1, 'function MONTH(value:DateTime):Integer');
  }
  protected getValue(): Variant {
    const p = this.params[0]!;
    if (p.varType === VariantType.Null) return Variant.null;
    if (p.varType !== VariantType.DateTime) throw this.typeError('MONTH');
    return Variant.fromInteger(p.toDateTime(this.ctx).month);
  }
}

const MONTH_NAMES: Readonly<Record<number, readonly string[]>> = {
  0: ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'],
  1: ['Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio', 'Julio', 'Agosto', 'Setiembre', 'Octubre', 'Noviembre', 'Diciembre'],
  2: ['Gener', 'Febrer', 'Mar\u00e7', 'Abril', 'Maig', 'Juny', 'Juliol', 'Agost', 'Setembre', 'Octubre', 'Novembre', 'Desembre'],
};

/** MonthName: the English (0), Spanish (1) or Catalan (2) name; "" otherwise. */
export function getMonthName(month: number, language: number): string {
  const names = MONTH_NAMES[language];
  if (names === undefined || month < 1 || month > 12) return '';
  return names[month - 1]!;
}

class IdenMonthName extends BuiltinFunction {
  constructor(e: Evaluator) {
    super(e, 'MONTHNAME', 1, 'function MonthName(value:Integer,DateTime):string');
  }
  protected getValue(): Variant {
    const p = this.params[0]!;
    if (p.varType === VariantType.Null) return Variant.null;
    if (p.varType === VariantType.Integer) return Variant.fromString(getMonthName(p.toInt(this.ctx), this.ev.language));
    if (p.varType === VariantType.DateTime) return Variant.fromString(getMonthName(p.toDateTime(this.ctx).month, this.ev.language));
    throw this.typeError('MONTHNAME');
  }
}

class IdenYear extends BuiltinFunction {
  constructor(e: Evaluator) {
    super(e, 'Year', 1, 'function Year(value:DateTime):Integer');
  }
  protected getValue(): Variant {
    const p = this.params[0]!;
    if (p.varType === VariantType.Null) return Variant.null;
    if (p.varType === VariantType.DateTime) return Variant.fromInteger(p.toDateTime(this.ctx).year);
    // C# parity: the error names MONTHNAME.
    throw this.typeError('MONTHNAME');
  }
}

class IdenFormatStr extends BuiltinFunction {
  constructor(e: Evaluator) {
    super(e, 'FORMATSTR', 2, 'function FormatStr(format:string, value:Variant):string');
  }
  protected getValue(): Variant {
    if (this.params[0]!.varType !== VariantType.String) throw this.typeError('FORMATSTR');
    const format = this.str(0)!;
    // C# parity: Params[0] cannot be Null here (checked above); the assignment is kept.
    if ((this.params[0]!.varType as VariantType) === VariantType.Null) this.params[0] = Variant.fromString('');
    return Variant.fromString(this.params[1]!.toFormatString(this.ctx, format, ParamType.Unknown, true));
  }
}

class IdenTrim extends BuiltinFunction {
  constructor(e: Evaluator) {
    super(e, 'TRIM', 1, 'function Trim(value:string):string');
  }
  protected getValue(): Variant {
    const p = this.params[0]!;
    if (p.varType === VariantType.Null) return Variant.null;
    if (p.varType !== VariantType.String) throw this.typeError('TRIM');
    return Variant.fromString(trimNet(p.toString(this.ctx)));
  }
}

class IdenLeft extends BuiltinFunction {
  constructor(e: Evaluator) {
    super(e, 'Left', 2, 'function Left(value:string, count:integer):string');
  }
  protected getValue(): Variant {
    if (this.params[0]!.varType === VariantType.Null) return Variant.null;
    const astring = this.str(0);
    let count = this.params[1]!.toInt(this.ctx);
    const s = notNull(astring);
    if (s.length < count) count = s.length;
    return Variant.fromString(substringNet(s, 0, count));
  }
}

class IdenReplaceStr extends BuiltinFunction {
  constructor(e: Evaluator) {
    super(e, 'REPLACESTR', 3, 'function Replace(const S:string, OldPattern,NewPattern: string):string');
  }
  protected getValue(): Variant {
    if (this.params[0]!.varType !== VariantType.String) throw this.typeError('S');
    if (this.params[1]!.varType !== VariantType.String) throw this.typeError('OldPattern');
    if (this.params[2]!.varType !== VariantType.String) throw this.typeError('NewPattern');
    const source = this.params[0]!.toString(this.ctx);
    const oldpattern = this.params[1]!.toString(this.ctx);
    const newpattern = this.params[2]!.toString(this.ctx);
    return Variant.fromString(replaceNet(source, oldpattern, newpattern));
  }
}

class IdenRight extends BuiltinFunction {
  constructor(e: Evaluator) {
    super(e, 'Right', 2, 'function Right(value:string, count:integer):string');
  }
  protected getValue(): Variant {
    if (this.params[0]!.varType === VariantType.Null) return Variant.null;
    const astring = this.str(0);
    let count = this.params[1]!.toInt(this.ctx);
    const s = notNull(astring);
    if (s.length < count) count = s.length;
    return Variant.fromString(substringNet(s, s.length - count, count));
  }
}

class IdenLength extends BuiltinFunction {
  constructor(e: Evaluator) {
    super(e, 'Length', 1, 'function Length(value:string):integer');
  }
  protected getValue(): Variant {
    const p = this.params[0]!;
    if (p.varType === VariantType.Null) return Variant.fromInteger(0);
    if (p.varType !== VariantType.String) throw this.typeError('LENGTH');
    return Variant.fromInteger(notNull(this.str(0)).length);
  }
}

class IdenIsInteger extends BuiltinFunction {
  constructor(e: Evaluator) {
    super(e, 'IsInteger', 1, 'function IsInteger(value:string):boolean');
  }
  protected getValue(): Variant {
    if (this.params[0]!.varType !== VariantType.String) throw this.typeError('ISINTEGER');
    try {
      parseInt32(this.str(0)!, NumberStyles.Integer, this.ctx.culture.number);
      return Variant.fromBoolean(true);
    } catch {
      return Variant.fromBoolean(false);
    }
  }
}

class IdenIsNumeric extends BuiltinFunction {
  constructor(e: Evaluator) {
    super(e, 'IsNumeric', 1, 'function IsNumeric(value:string):boolean');
  }
  protected getValue(): Variant {
    if (this.params[0]!.varType !== VariantType.String) throw this.typeError('ISNUMERIC');
    try {
      parseDouble(this.str(0)!, NumberStyles.Float | NumberStyles.AllowThousands, this.ctx.culture.number);
      return Variant.fromBoolean(true);
    } catch {
      return Variant.fromBoolean(false);
    }
  }
}

class IdenIsValidDateTime extends BuiltinFunction {
  constructor(e: Evaluator) {
    super(e, 'IsValidDateTime', 1, 'function IsValidDateTime(value:string):boolean');
  }
  protected getValue(): Variant {
    if (this.params[0]!.varType !== VariantType.String) throw this.typeError('ISVALIDDATETIME');
    try {
      parseDateTime(this.str(0)!, this.ctx.culture, this.ctx.now(), this.ctx.timeZone);
      return Variant.fromBoolean(true);
    } catch {
      return Variant.fromBoolean(false);
    }
  }
}

class IdenCheckExpression extends BuiltinFunction {
  constructor(e: Evaluator) {
    super(e, 'CheckExpression', 2, 'function CheckExpression(value:string):boolean');
  }
  protected getValue(): Variant {
    if (this.params[0]!.varType !== VariantType.String) throw this.typeError('CHECKEXPRESSION');
    if (this.params[1]!.varType !== VariantType.String) throw this.typeError('CHECKEXPRESSION');
    const aresult = this.ev.evaluateText(this.str(0)!);
    if (Variant.equals(aresult, Variant.fromBoolean(false), this.ctx)) throw new UnNamedException(this.str(1)!);
    return aresult;
  }
}

class IdenPos extends BuiltinFunction {
  constructor(e: Evaluator) {
    super(e, 'POS', 2, 'function Pos(substring,fullstring:string):integer');
  }
  protected getValue(): Variant {
    if (this.params[0]!.varType === VariantType.Null) return Variant.null;
    const substring = this.str(0);
    const fullstring = notNull(this.str(1));
    if (substring === null) throw argumentNull('value');
    return Variant.fromInteger(indexOfCulture(fullstring, substring) + 1);
  }
}

class IdenSubStr extends BuiltinFunction {
  constructor(e: Evaluator) {
    super(e, 'SubStr', 3, 'function SubStr(value:string, index,count:integer):string');
  }
  protected getValue(): Variant {
    if (this.params[0]!.varType === VariantType.Null) return Variant.null;
    const astring = notNull(this.str(0));
    if (astring.length === 0) return Variant.fromString('');
    const index = this.params[1]!.toInt(this.ctx);
    let count = this.params[2]!.toInt(this.ctx);
    if (astring.length < ((count - index) | 0)) count = astring.length;
    if (count <= 0) return Variant.fromString('');
    // SafeSubstring: Skip(startIndex).Take(length) over the UTF-16 code units.
    const start = Math.max(0, (index - 1) | 0);
    return Variant.fromString(astring.substring(start, Math.min(astring.length, start + count)));
  }
}

class IdenLowerCase extends BuiltinFunction {
  constructor(e: Evaluator) {
    super(e, 'LOWERCASE', 1);
  }
  protected getValue(): Variant {
    const p = this.params[0]!;
    if (p.varType === VariantType.Null) return Variant.null;
    if (p.varType !== VariantType.String) throw this.typeError('LOWERCASE');
    return Variant.fromString(toLowerNet(p.toString(this.ctx)));
  }
}

class IdenFileExists extends BuiltinFunction {
  constructor(e: Evaluator) {
    super(e, 'FILEEXISTS', 1);
  }
  protected getValue(): Variant {
    const p = this.params[0]!;
    if (p.varType === VariantType.Null) return Variant.fromBoolean(false);
    if (p.varType !== VariantType.String) throw new NamedException(this.translate(438), this.name);
    const path = p.toString(this.ctx);
    // new FileInfo("") throws
    if (path.length === 0) throw argumentException("The path is empty. (Parameter 'path')");
    return Variant.fromBoolean(this.ev.host.fileExists(path));
  }
}

class IdenToday extends BuiltinFunction {
  constructor(e: Evaluator) {
    super(e, 'TODAY', 0);
  }
  protected getValue(): Variant {
    return Variant.fromDateTime(this.ev.host.now().date.withKind(DateTimeKind.Local));
  }
}

class IdenNow extends BuiltinFunction {
  constructor(e: Evaluator) {
    super(e, 'NOW', 0);
  }
  protected getValue(): Variant {
    return Variant.fromDateTime(this.ev.host.now().withKind(DateTimeKind.Local));
  }
}

class IdenStr extends BuiltinFunction {
  constructor(e: Evaluator) {
    super(e, 'STR', 1);
  }
  protected getValue(): Variant {
    const p = this.params[0]!;
    if (p.varType !== VariantType.Null) return Variant.fromString(p.toString(this.ctx));
    return Variant.fromString('');
  }
}

class IdenFloatToDateTime extends BuiltinFunction {
  constructor(e: Evaluator) {
    super(e, 'FloatToDateTime', 1, 'function FloatToDateTime(value:double):DateTime');
  }
  protected getValue(): Variant {
    if (!this.params[0]!.isNumber()) throw this.typeError('FloatToDateTime');
    this.params[0]!.toDouble(this.ctx);
    // C# parity: Convert.ToDateTime(double) always throws InvalidCastException.
    throw invalidCastException('Double', 'DateTime');
  }
}

class IdenRound extends BuiltinFunction {
  constructor(e: Evaluator) {
    super(e, 'Round', 2, 'function Round(num:double,r:double):double');
  }
  protected getValue(): Variant {
    if (this.params[0]!.isNull) return Variant.null;
    if (!this.params[0]!.isNumber()) throw this.typeError('Round');
    const num = this.params[0]!.toDecimal(this.ctx);
    if (!this.params[1]!.isNumber()) throw this.typeError('Round');
    // C# parity: the multiple is read from Params[0], not Params[1].
    const r = this.params[0]!.toDecimal(this.ctx);
    return Variant.fromDecimal(roundDecimalUp(num, r));
  }
}

class IdenRoundToInteger extends BuiltinFunction {
  constructor(e: Evaluator) {
    super(e, 'RoundToInteger', 1, 'function RoundToInteger(num:double):integer');
  }
  protected getValue(): Variant {
    if (!this.params[0]!.isNumber()) throw this.typeError('RoundToInteger');
    const num = this.params[0]!.toDecimal(this.ctx);
    return Variant.fromLong(convertDecimalToInt64(num.round()));
  }
}

class IdenAbs extends BuiltinFunction {
  constructor(e: Evaluator) {
    super(e, 'Abs', 1, 'function Abs(num:double):double');
  }
  protected getValue(): Variant {
    if (!this.params[0]!.isNumber()) throw this.typeError('Abs');
    return this.params[0]!.abs(this.ctx);
  }
}

class IdenCompareValue extends BuiltinFunction {
  constructor(e: Evaluator) {
    super(e, 'CompareValue', 3, 'function CompareValue(p1,p2,epsilon:double):integer');
  }
  protected getValue(): Variant {
    if (!this.params[0]!.isNumber()) throw this.typeError('CompareValue');
    if (!this.params[1]!.isNumber()) throw this.typeError('CompareValue');
    if (!this.params[2]!.isNumber()) throw this.typeError('CompareValue');
    const p1 = this.params[0]!.toDecimal(this.ctx);
    const p2 = this.params[1]!.toDecimal(this.ctx);
    const p3 = this.params[2]!.toDecimal(this.ctx);
    return Variant.fromInteger(compareValue(p1, p2, p3));
  }
}

class IdenInt extends BuiltinFunction {
  constructor(e: Evaluator) {
    super(e, 'Int', 1, 'function Int(num:double):integer');
  }
  protected getValue(): Variant {
    if (!this.params[0]!.isNumber()) throw this.typeError('Int');
    const num = this.params[0]!.toDecimal(this.ctx);
    return Variant.fromLong(convertDecimalToInt64(num.truncate()));
  }
}

class IdenVal extends BuiltinFunction {
  constructor(e: Evaluator) {
    super(e, 'Val', 1, 'function Val(s:string):double');
  }
  protected getValue(): Variant {
    // As Delphi (TIdenVal): a number is itself, a text is converted (VAL('12') is 12)
    if (this.params[0]!.isNumber()) return this.params[0]!;
    if (!this.params[0]!.isString()) throw this.typeError('Val');
    const astring = notNull(this.str(0));
    if (astring.length < 1) return Variant.fromInteger(0);
    return Variant.fromDecimal(parseDecimal(astring, NumberStyles.Number, this.ctx.culture.number));
  }
}

class IdenModul extends BuiltinFunction {
  constructor(e: Evaluator) {
    super(e, 'Mod', 2, 'function Mod(d1,d2:integer):integer');
  }
  protected getValue(): Variant {
    if (!this.params[0]!.isInteger()) throw this.typeError('Mod');
    if (!this.params[1]!.isInteger()) throw this.typeError('Mod');
    const d1 = this.params[0]!.toLong(this.ctx);
    const d2 = this.params[1]!.toLong(this.ctx);
    if (d2 === 0n) throw divideByZeroException();
    if (d2 === -1n && d1 === -9223372036854775808n) throw overflowException(NetMessages.arithmeticOverflow);
    return Variant.fromLong(d1 % d2);
  }
}

class IdenEvalText extends BuiltinFunction {
  constructor(e: Evaluator) {
    super(e, 'Evaltext', 1, 'function EvalText(expression:string):Variant');
  }
  protected getValue(): Variant {
    if (!this.params[0]!.isString()) throw this.typeError('EvalText');
    return this.ev.evaluateText(this.str(0)!);
  }
}

class IdenNumToText extends BuiltinFunction {
  constructor(e: Evaluator) {
    super(e, 'NumToText', 2, 'function NumToText(num:double, female:boolean):string');
  }
  protected getValue(): Variant {
    if (!this.params[0]!.isNumber()) throw this.typeError('NumToText');
    if (!this.params[1]!.isBoolean()) throw this.typeError('NumToText');
    const num: CsDecimal = this.params[0]!.toDecimal(this.ctx);
    return Variant.fromString(numberToText(num, this.params[1]!.toBool(this.ctx), this.ev.language));
  }
}

/**
 * Evaluator.AddIdentifiers: the constants and built-in functions, in the C# order (TRUE, FALSE,
 * FALSO and CIERTO first; NULL between FILEEXISTS and TODAY).
 */
export function addBuiltinIdentifiers(add: (key: string, iden: EvalIdentifier) => void, e: Evaluator): void {
  add('TRUE', new IdenTrue(e));
  add('FALSE', new IdenFalse(e));
  add('FALSO', new IdenFalse(e));
  add('CIERTO', new IdenTrue(e));
  add('UPPERCASE', new IdenUpperCase(e));
  add('STRINGTOBIN', new IdenStringToBin(e));
  add('DAY', new IdenDay(e));
  add('MONTH', new IdenMonth(e));
  add('MONTHNAME', new IdenMonthName(e));
  add('YEAR', new IdenYear(e));
  add('TRIM', new IdenTrim(e));
  add('FORMATSTR', new IdenFormatStr(e));
  add('FORMATNUM', new IdenFormatStr(e));
  add('LEFT', new IdenLeft(e));
  add('REPLACESTR', new IdenReplaceStr(e));
  add('RIGHT', new IdenRight(e));
  add('LENGTH', new IdenLength(e));
  add('POS', new IdenPos(e));
  add('SUBSTR', new IdenSubStr(e));
  add('LOWERCASE', new IdenLowerCase(e));
  add('STR', new IdenStr(e));
  add('FILEEXISTS', new IdenFileExists(e));
  add('NULL', new IdenNull(e));
  add('TODAY', new IdenToday(e));
  add('NOW', new IdenNow(e));
  add('SIN', new IdenSinus(e));
  add('MAX', new IdenMax(e));
  add('ISINTEGER', new IdenIsInteger(e));
  add('ISNUMERIC', new IdenIsNumeric(e));
  add('ISVALIDDATETIME', new IdenIsValidDateTime(e));
  add('CHECKEXPRESSION', new IdenCheckExpression(e));
  add('FLOATTODATETIME', new IdenFloatToDateTime(e));
  add('ROUND', new IdenRound(e));
  add('ROUNDTOINTEGER', new IdenRoundToInteger(e));
  add('ABS', new IdenAbs(e));
  add('COMPAREVALUE', new IdenCompareValue(e));
  add('INT', new IdenInt(e));
  add('VAL', new IdenVal(e));
  add('MOD', new IdenModul(e));
  add('EVALTEXT', new IdenEvalText(e));
  add('NUMTOTEXT', new IdenNumToText(e));
}
