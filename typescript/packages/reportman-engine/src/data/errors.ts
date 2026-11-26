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

/**
 * HTML text with the standard 14 PDF fonts: it is laid out only by the TrueType provider, which the
 * host gives with its fonts (the message is NEEDS_TRUETYPE_FONTS of @reportman/text, which this
 * package does not depend on). The C# standard device fails with a NullReferenceException.
 */
export class NeedsFontsError extends Error {
  constructor(what: string) {
    super(
      what +
        ' needs TrueType fonts, and the PDF has only the standard 14 PDF fonts: give it fonts (the fonts option of @reportman/node: ' +
        "fonts: {} for the fonts of the system, fonts: { folders: ['./fonts'] } for a folder of its own; reportman-pdf --fonts)",
    );
    this.name = 'NeedsFontsError';
  }
}
