// The SQL of a command as it goes to SQL Server. SqlClient sends the text as it is and the server
// binds the @NAME placeholders by name (case-insensitive under the usual collations); this driver
// also takes the Delphi form :NAME the sample reports keep, for the parameters of the command,
// rewritten to @NAME outside string literals, quoted identifiers ("...", [...]) and comments. A
// :NAME that is no parameter is left to the server, as SqlClient leaves it.

import { type QueryParameter, rewriteNamedParameters } from '@reportman/engine';

/** The SQL with each :NAME of a parameter of the command written @NAME. */
export function rewritePlaceholders(sql: string, parameters: readonly QueryParameter[]): string {
  if (parameters.length === 0 || !sql.includes(':')) return sql;
  const names = new Set(parameters.map((p) => (p.name.startsWith('@') ? p.name.substring(1) : p.name).toUpperCase()));
  return rewriteNamedParameters(sql, (placeholder) => (names.has(placeholder.name.toUpperCase()) ? '@' + placeholder.name : ':' + placeholder.name), ':').sql;
}
