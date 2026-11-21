// The named parameters of a command, as FirebirdClient finds them (NamedParametersParser): every
// `@NAME` outside single and double quotes becomes a `?` placeholder, in order. Comments are not
// special (an `@NAME` in a comment is a parameter too, as in FirebirdClient), and a name is made of
// letters, digits, `_` and `$`.
//
// One addition: `:NAME` is the Delphi form of a placeholder, the one the SQL of a report keeps when
// the engine does not convert it (a SQLite connection of the Delphi engine). FirebirdClient leaves it
// to the server, which rejects it; here it is a placeholder when NAME is a parameter of the command,
// so the SQL of such a report runs. Any other `:NAME` stays as it is, and so does every `:NAME` in
// the body of an EXECUTE BLOCK (there it is a PSQL variable).

/** The SQL with `?` placeholders, and the parameter of each placeholder (with its `@` prefix). */
export interface ParsedSql {
  sql: string;
  names: string[];
}

const LETTER_OR_DIGIT = /[\p{L}\p{Nd}]/u;

/** char.IsLetterOrDigit(c) || c == '_' || c == '$' of one UTF-16 code unit. */
function isNameChar(c: string): boolean {
  return c === '_' || c === '$' || LETTER_OR_DIGIT.test(c);
}

/**
 * Parses the placeholders of `sql`. `isParameter` tells whether a `:NAME` names a parameter of the
 * command (case-insensitive, as FirebirdClient looks parameters up).
 */
export function parseNamedParameters(sql: string, isParameter: (name: string) => boolean): ParsedSql {
  if (sql.indexOf('@') < 0 && sql.indexOf(':') < 0) return { sql, names: [] };
  // In EXECUTE BLOCK the placeholders are in the input parameters; after AS, :NAME is a variable
  const colonEnd = executeBlockBody(sql);
  const names: string[] = [];
  let out = '';
  let inSingleQuotes = false;
  let inDoubleQuotes = false;
  let inParam = false;
  let param = '';
  const n = sql.length;
  for (let i = 0; i < n; i++) {
    const sym = sql.charAt(i);
    if (inParam) {
      if (isNameChar(sym)) {
        param += sym;
        continue;
      }
      // The character that ends a name is copied as it is (a quote there does not open a string)
      names.push(param);
      param = '';
      out += '?' + sym;
      inParam = false;
      continue;
    }
    if (sym === "'" && !inDoubleQuotes) inSingleQuotes = !inSingleQuotes;
    else if (sym === '"' && !inSingleQuotes) inDoubleQuotes = !inDoubleQuotes;
    else if (!inSingleQuotes && !inDoubleQuotes && sym === '@') {
      inParam = true;
      param = '@';
      continue;
    } else if (!inSingleQuotes && !inDoubleQuotes && sym === ':' && i < colonEnd) {
      let j = i + 1;
      while (j < n && isNameChar(sql.charAt(j))) j++;
      const name = sql.substring(i + 1, j);
      if (name.length > 0 && isParameter(name)) {
        names.push('@' + name);
        out += '?';
        i = j - 1;
        continue;
      }
    }
    out += sym;
  }
  if (inParam) {
    names.push(param);
    out += '?';
  }
  return { sql: out, names };
}

/**
 * Where the body of an EXECUTE BLOCK starts (its AS, outside quotes and parentheses), or the end of
 * the SQL for any other statement.
 */
function executeBlockBody(sql: string): number {
  const head = /^\s*EXECUTE\s+BLOCK\b/i.exec(sql);
  if (head === null) return sql.length;
  let depth = 0;
  let quote = '';
  for (let i = head[0].length; i < sql.length; i++) {
    const c = sql.charAt(i);
    if (quote !== '') {
      if (c === quote) quote = '';
      continue;
    }
    if (c === "'" || c === '"') quote = c;
    else if (c === '(') depth++;
    else if (c === ')') depth--;
    else if (depth === 0 && (c === 'A' || c === 'a') && /^AS\b/i.test(sql.substring(i, i + 3)) && !isNameChar(sql.charAt(i - 1))) return i;
  }
  return sql.length;
}
