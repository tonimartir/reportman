// Port of Reportman.Reporting.EvalException.

import { NetException } from '../util/netexception.js';

/** An expression error with its line (1 based) and the position after the current token. */
export class EvalException extends NetException {
  readonly sourceLine: number;
  readonly sourcePos: number;
  elementName: string;

  constructor(message: string, sourceLine: number, sourcePos: number, elementName: string) {
    super('EvalException', message);
    this.sourceLine = sourceLine;
    this.sourcePos = sourcePos;
    this.elementName = elementName;
  }
}
