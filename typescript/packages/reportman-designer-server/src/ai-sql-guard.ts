// Whether a SQL the AI wrote is only a read (AiSqlGuard of Reportman.Server). The copilot's SQL is run
// here to learn its columns automatically, without anybody reading it first: one SELECT (or WITH) and
// nothing that changes data or structure, or it is not run at all. It is the first of the locks; the
// connection it runs on is also closed without committing.

const WRITES = /\b(INSERT|UPDATE|DELETE|MERGE|DROP|ALTER|CREATE|TRUNCATE|GRANT|REVOKE|EXEC|EXECUTE|CALL|INTO)\b/i;

/** Null when the SQL is a single read; otherwise why not, for the AI to rewrite it. */
export function whyNotARead(sql: string | null | undefined): string | null {
  let code = withoutLiterals(sql ?? '').trim();
  while (code.endsWith(';')) code = code.substring(0, code.length - 1).trimEnd();
  if (code.length === 0) return 'The SQL is empty.';
  if (code.includes(';')) return "Only one statement can be checked: remove everything after the first ';'.";
  const first = /^\(*\s*([A-Za-z]+)/.exec(code)?.[1] ?? '';
  if (first.toUpperCase() !== 'SELECT' && first.toUpperCase() !== 'WITH') return 'Only a query (SELECT or WITH) can be checked, not ' + first.toUpperCase() + '.';
  const write = WRITES.exec(code);
  return write !== null ? 'A dataset only reads: the query cannot contain ' + write[0].toUpperCase() + '.' : null;
}

/** The SQL without its strings, quoted names and comments, which may say anything. */
function withoutLiterals(sql: string): string {
  let result = '';
  for (let i = 0; i < sql.length; i++) {
    const c = sql[i]!;
    if (c === '-' && sql[i + 1] === '-') {
      while (i < sql.length && sql[i] !== '\n') i++;
      result += ' ';
      continue;
    }
    if (c === '/' && sql[i + 1] === '*') {
      const end = sql.indexOf('*/', i + 2);
      i = end < 0 ? sql.length : end + 1;
      result += ' ';
      continue;
    }
    const close = c === "'" ? "'" : c === '"' ? '"' : c === '`' ? '`' : c === '[' ? ']' : '';
    if (close !== '') {
      i++;
      while (i < sql.length) {
        if (sql[i] === close) {
          // A doubled quote is the quote itself, inside the literal
          if (close !== ']' && sql[i + 1] === close) {
            i += 2;
            continue;
          }
          break;
        }
        i++;
      }
      result += ' x ';
      continue;
    }
    result += c;
  }
  return result;
}
