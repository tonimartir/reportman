// Errors of the data layer with the .NET exception names the C# engine raises.

import { NetException } from '../util/netexception.js';

/** DataColumnCollection.Add of a name that is already a column. */
export function duplicateNameException(name: string): NetException {
  return new NetException('DuplicateNameException', `A column named '${name}' already belongs to this DataTable.`);
}

/** A feature of the C# engine that the TypeScript engine does not have yet. */
export class NotSupportedYetError extends Error {
  constructor(what: string) {
    super(what + ' is not supported yet by the TypeScript report engine (reportman-engine)');
    this.name = 'NotSupportedYetError';
  }
}
