// The errors of the report engine (Reportman.Reporting.ReportException, NoDataToPrintException).

import { NetException } from '../util/netexception.js';

/** ReportException: an error in a report item, with the item and the property. */
export class ReportException extends NetException {
  /** The name of the report item (the C# exception keeps the item itself). */
  readonly itemName: string;
  readonly propertyName: string;

  constructor(message: string, itemName: string, propertyName: string) {
    super('ReportException', message);
    this.itemName = itemName;
    this.propertyName = propertyName;
  }
}

/** NoDataToPrintException: the report has no data to print. */
export class NoDataToPrintException extends NetException {
  constructor(message: string) {
    super('NoDataToPrintException', message);
  }
}
