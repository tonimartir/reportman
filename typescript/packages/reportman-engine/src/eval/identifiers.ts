// Ports of EvalIdentifier, EvalIdentifiers, IdenConstant (IdenTrue, IdenFalse, IdenNull),
// IdenVariable, IdenVariableParam and IdenFunction: the named things an expression can use.
// The report engine adds its own identifiers (PAGE, PAGECOUNT...) by subclassing these and
// registering them with Evaluator.addIden / addVariable.

import { compareCulture } from '../util/chars.js';
import { argumentException, NetMessages, UnNamedException } from '../util/netexception.js';
import { Translator } from '../util/translator.js';
import { ParamType, Variant } from '../variant/variant.js';
import type { Evaluator } from './evaluator.js';

export abstract class EvalIdentifier {
  /** The identifier name (upper case once registered). */
  name = '';
  protected fModel = '';
  protected fHelp = '';
  /** The evaluator the identifier was created for (null for field identifiers). */
  evalObject: Evaluator | null;

  protected constructor(evaluator: Evaluator | null) {
    this.evalObject = evaluator;
  }

  protected abstract getValue(): Variant;
  protected abstract setValue(value: Variant): void;

  /** The declaration shown by the designer, e.g. "function Left(value:string, count:integer):string". */
  get model(): string {
    return this.fModel;
  }

  get help(): string {
    return this.fHelp;
  }

  get value(): Variant {
    return this.getValue();
  }

  set value(v: Variant) {
    this.setValue(v);
  }

  protected translate(index: number): string {
    return (this.evalObject?.context.translator ?? Translator.english).translateStr(index);
  }
}

/** A value that cannot be assigned. */
export class IdenConstant extends EvalIdentifier {
  protected fValue: Variant = Variant.null;

  constructor(evaluator: Evaluator | null, value: Variant = Variant.null) {
    super(evaluator);
    this.fValue = value;
  }

  protected getValue(): Variant {
    return this.fValue;
  }

  protected setValue(_value: Variant): void {
    throw new UnNamedException(this.translate(365));
  }
}

export class IdenTrue extends IdenConstant {
  constructor(evaluator: Evaluator | null) {
    super(evaluator, Variant.fromBoolean(true));
    this.name = 'TRUE';
  }
}

export class IdenFalse extends IdenConstant {
  constructor(evaluator: Evaluator | null) {
    super(evaluator, Variant.fromBoolean(false));
    this.name = 'FALSE';
  }
}

export class IdenNull extends IdenConstant {
  constructor(evaluator: Evaluator | null) {
    super(evaluator);
    this.name = 'NULL';
  }
}

/** A variable: assigned with ":=" in an expression or by the host. */
export class IdenVariable extends EvalIdentifier {
  protected fValue: Variant = Variant.null;

  constructor(evaluator: Evaluator | null) {
    super(evaluator);
  }

  protected setValue(value: Variant): void {
    this.fValue = value;
  }

  protected getValue(): Variant {
    return this.fValue;
  }
}

/** What IdenVariableParam needs of a report parameter (Reportman.Reporting.Param). */
export interface ParamLike {
  readonly paramType: ParamType;
  lastValue: Variant;
  getMultiValue(): Variant;
}

/** A variable bound to a report parameter (M.PARAMNAME). */
export class IdenVariableParam extends IdenVariable {
  private readonly fParam: ParamLike;

  constructor(evaluator: Evaluator | null, param: ParamLike) {
    super(evaluator);
    this.fParam = param;
  }

  protected override setValue(value: Variant): void {
    this.fParam.lastValue = value;
  }

  protected override getValue(): Variant {
    if (this.fParam.paramType === ParamType.Multiple) return this.fParam.getMultiValue();
    return this.fParam.lastValue;
  }
}

/**
 * A function: the evaluator parses ParamCount arguments into params (one shared array per
 * function instance, as in C#: a nested call of the same function writes into it) and then reads
 * value.
 */
export abstract class IdenFunction extends EvalIdentifier {
  private fParamCount = 0;
  params: Variant[] = [];

  protected constructor(evaluator: Evaluator | null) {
    super(evaluator);
  }

  protected setParamCount(count: number): void {
    this.params = count <= 0 ? [] : new Array<Variant>(count).fill(Variant.null);
    this.fParamCount = count;
  }

  get paramCount(): number {
    return this.fParamCount;
  }

  protected setValue(_value: Variant): void {
    throw new UnNamedException(this.translate(364));
  }
}

/** A function defined by a callback, for hosts that do not want to subclass IdenFunction. */
export class IdenCallbackFunction extends IdenFunction {
  private readonly callback: (params: readonly Variant[], self: IdenCallbackFunction) => Variant;

  constructor(
    evaluator: Evaluator | null,
    name: string,
    paramCount: number,
    callback: (params: readonly Variant[], self: IdenCallbackFunction) => Variant,
    model = '',
    help = '',
  ) {
    super(evaluator);
    this.setParamCount(paramCount);
    this.name = name;
    this.fModel = model;
    this.fHelp = help;
    this.callback = callback;
  }

  protected getValue(): Variant {
    return this.callback(this.params, this);
  }
}

/**
 * EvalIdentifiers: a SortedList<string, EvalIdentifier> (keys in culture order). Add throws when
 * the key exists. Lookups are exact on the (upper case) key.
 */
export class EvalIdentifiers {
  private readonly map = new Map<string, EvalIdentifier>();
  private sortedKeys: string[] | null = null;
  private readonly cultureName: string;

  constructor(cultureName = '') {
    this.cultureName = cultureName;
  }

  get count(): number {
    return this.map.size;
  }

  add(key: string, iden: EvalIdentifier): void {
    if (this.map.has(key)) throw argumentException(NetMessages.duplicateKey(key));
    this.map.set(key, iden);
    this.sortedKeys = null;
  }

  /** this[key] = iden (adds or replaces). */
  set(key: string, iden: EvalIdentifier): void {
    if (!this.map.has(key)) this.sortedKeys = null;
    this.map.set(key, iden);
  }

  get(key: string): EvalIdentifier | undefined {
    return this.map.get(key);
  }

  containsKey(key: string): boolean {
    return this.map.has(key);
  }

  remove(key: string): boolean {
    this.sortedKeys = null;
    return this.map.delete(key);
  }

  clear(): void {
    this.map.clear();
    this.sortedKeys = null;
  }

  /** The keys in SortedList order. */
  get keys(): readonly string[] {
    if (this.sortedKeys === null) this.sortedKeys = [...this.map.keys()].sort((a, b) => compareCulture(a, b, this.cultureName));
    return this.sortedKeys;
  }

  /** IndexOfKey. */
  indexOfKey(key: string): number {
    return this.map.has(key) ? this.keys.indexOf(key) : -1;
  }

  /** this[index]: the identifier at a position of the sorted keys. */
  at(index: number): EvalIdentifier {
    if (index < 0 || index >= this.count) throw new UnNamedException('Index out of range on EvalIdentifiers collection');
    return this.map.get(this.keys[index]!)!;
  }

  [Symbol.iterator](): IterableIterator<EvalIdentifier> {
    const keys = this.keys;
    return keys.map((k) => this.map.get(k)!)[Symbol.iterator]();
  }
}
