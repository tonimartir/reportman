// Npgsql's SqlQueryParser: how a command with named parameters reaches PostgreSQL. The SQL is
// split into statements at the semicolons outside parentheses (legacy batching), and each
// placeholder `:name` or `@name` that names a parameter of the command becomes `$n`, numbered per
// statement in the order the parameters first appear. A placeholder that names no parameter is
// left as it is (PostgreSQL then reports the syntax error). String literals ('...' and E'...'),
// quoted identifiers, dollar-quoted strings and comments (nested block comments too) are skipped.

/** A statement of a command, with the parameters its `$n` refer to (by index in the command). */
export interface ParsedStatement {
  sql: string;
  /** For each `$n` (n = position + 1), the index of the parameter in the command. */
  parameters: number[];
}

function isLetter(ch: string): boolean {
  return (ch >= 'a' && ch <= 'z') || (ch >= 'A' && ch <= 'Z');
}

function code(ch: string): number {
  return ch.length === 0 ? 0 : ch.charCodeAt(0);
}

function isIdentifierStart(ch: string): boolean {
  const c = code(ch);
  return isLetter(ch) || ch === '_' || (c >= 128 && c <= 255);
}

function isDollarTagIdentifier(ch: string): boolean {
  const c = code(ch);
  return isLetter(ch) || (ch >= '0' && ch <= '9') || ch === '_' || (c >= 128 && c <= 255);
}

function isIdentifier(ch: string): boolean {
  const c = code(ch);
  return isLetter(ch) || (ch >= '0' && ch <= '9') || ch === '_' || ch === '$' || (c >= 128 && c <= 255);
}

/** char.IsLetterOrDigit for a character beyond ASCII. */
const LETTER_OR_DIGIT = /^[\p{L}\p{Nd}]$/u;

/** A character of a parameter name: letters, digits, '_' and '.' (and any Unicode letter or digit). */
function isParamNameChar(ch: string): boolean {
  if (ch.length === 0) return false;
  const c = ch.charCodeAt(0);
  if (c < 128) return isLetter(ch) || (ch >= '0' && ch <= '9') || ch === '_' || ch === '.';
  return LETTER_OR_DIGIT.test(ch);
}

function isWhiteSpace(ch: string): boolean {
  return /^\s$/u.test(ch);
}

/**
 * Parses the SQL of a command. `lookup` finds the parameter a placeholder names (its index in the
 * command, or -1); `standardConformingStrings` is the server setting (backslashes in '...').
 */
export function parseSql(sql: string, lookup: (name: string) => number, standardConformingStrings = true): ParsedStatement[] {
  const statements: ParsedStatement[] = [];
  let rewritten = '';
  let positional: number[] = [];
  let indexMap = new Map<string, number>();

  const end = sql.length;
  let currCharOfs = 0;
  let ch = '';
  let lastChar = '';
  let tagStart = 0;
  let tagEnd = 0;
  let currTokenBeg = 0;
  let blockCommentLevel = 0;
  let parenthesisLevel = 0;

  const finishStatement = (text: string): void => {
    statements.push({ sql: text, parameters: positional });
    positional = [];
    indexMap = new Map();
    rewritten = '';
  };

  // The states of Npgsql's parser (goto labels there).
  type State =
    | 'None'
    | 'NoneContinue'
    | 'NamedParamStart'
    | 'NamedParam'
    | 'Quoted'
    | 'EscapedStart'
    | 'Escaped'
    | 'MaybeConcatenatedEscaped'
    | 'MaybeConcatenatedEscaped2'
    | 'MaybeConcatenatedEscapeAfterComment'
    | 'DollarQuotedStart'
    | 'DollarQuotedInFirstDelim'
    | 'DollarQuoted'
    | 'LineCommentBegin'
    | 'LineComment'
    | 'BlockCommentBegin'
    | 'BlockComment'
    | 'BlockCommentEnd'
    | 'SemiColon'
    | 'Finish';

  let state: State = 'None';
  for (;;) {
    switch (state) {
      case 'None':
        if (currCharOfs >= end) {
          state = 'Finish';
          break;
        }
        lastChar = ch;
        ch = sql.charAt(currCharOfs++);
        state = 'NoneContinue';
        break;

      case 'NoneContinue': {
        let next: State | null = null;
        for (;;) {
          switch (ch) {
            case '/':
              next = 'BlockCommentBegin';
              break;
            case '-':
              next = 'LineCommentBegin';
              break;
            case "'":
              next = standardConformingStrings ? 'Quoted' : 'Escaped';
              break;
            case '$':
              if (!isIdentifier(lastChar)) next = 'DollarQuotedStart';
              break;
            case '"':
              next = 'Quoted';
              break;
            case ':':
              if (lastChar !== ':') next = 'NamedParamStart';
              break;
            case '@':
              if (lastChar !== '@') next = 'NamedParamStart';
              break;
            case ';':
              if (parenthesisLevel === 0) next = 'SemiColon';
              break;
            case '(':
              parenthesisLevel++;
              break;
            case ')':
              parenthesisLevel--;
              break;
            case 'e':
            case 'E':
              if (!isLetter(lastChar)) next = 'EscapedStart';
              break;
          }
          if (next !== null) break;
          if (currCharOfs >= end) {
            next = 'Finish';
            break;
          }
          lastChar = ch;
          ch = sql.charAt(currCharOfs++);
        }
        state = next;
        break;
      }

      case 'NamedParamStart':
        if (currCharOfs < end) {
          lastChar = ch;
          ch = sql.charAt(currCharOfs);
          if (isParamNameChar(ch)) {
            tagStart = currCharOfs - 1;
            currCharOfs++;
            state = 'NamedParam';
            break;
          }
        }
        // The character after the prefix is read again (Npgsql: goto None)
        state = 'None';
        break;

      case 'NamedParam':
        // At least one character of the name has been read
        for (;;) {
          lastChar = ch;
          if (currCharOfs >= end || !isParamNameChar((ch = sql.charAt(currCharOfs)))) {
            const name = sql.substring(tagStart + 1, currCharOfs);
            let index = indexMap.get(name);
            if (index === undefined) {
              const parameter = lookup(name);
              if (parameter < 0) {
                // Not a parameter of the command: the text stays as it was
                rewritten += sql.substring(currTokenBeg, currCharOfs);
                currTokenBeg = currCharOfs;
                if (currCharOfs >= end) {
                  state = 'Finish';
                  break;
                }
                currCharOfs++;
                state = 'NoneContinue';
                break;
              }
              positional.push(parameter);
              index = positional.length;
              indexMap.set(name, index);
            }
            rewritten += sql.substring(currTokenBeg, tagStart) + '$' + String(index);
            currTokenBeg = currCharOfs;
            if (currCharOfs >= end) {
              state = 'Finish';
              break;
            }
            currCharOfs++;
            state = 'NoneContinue';
            break;
          }
          currCharOfs++;
        }
        break;

      case 'Quoted': {
        const quote = ch;
        while (currCharOfs < end && sql.charAt(currCharOfs) !== quote) currCharOfs++;
        if (currCharOfs < end) {
          currCharOfs++;
          ch = '';
          state = 'None';
        } else state = 'Finish';
        break;
      }

      case 'EscapedStart':
        if (currCharOfs < end) {
          lastChar = ch;
          ch = sql.charAt(currCharOfs++);
          state = ch === "'" ? 'Escaped' : 'NoneContinue';
        } else state = 'Finish';
        break;

      case 'Escaped': {
        let next: State = 'Finish';
        while (currCharOfs < end) {
          ch = sql.charAt(currCharOfs++);
          if (ch === "'") {
            next = 'MaybeConcatenatedEscaped';
            break;
          }
          if (ch === '\\') {
            if (currCharOfs >= end) break;
            currCharOfs++;
          }
        }
        state = next;
        break;
      }

      case 'MaybeConcatenatedEscaped': {
        let next: State = 'Finish';
        while (currCharOfs < end) {
          ch = sql.charAt(currCharOfs++);
          if (ch === '\r' || ch === '\n') {
            next = 'MaybeConcatenatedEscaped2';
            break;
          }
          if (ch === ' ' || ch === '\t' || ch === '\f') continue;
          lastChar = '';
          next = 'NoneContinue';
          break;
        }
        state = next;
        break;
      }

      case 'MaybeConcatenatedEscaped2': {
        let next: State = 'Finish';
        while (currCharOfs < end) {
          ch = sql.charAt(currCharOfs++);
          if (ch === "'") {
            next = 'Escaped';
            break;
          }
          if (ch === '-') {
            if (currCharOfs >= end) break;
            ch = sql.charAt(currCharOfs++);
            if (ch === '-') {
              next = 'MaybeConcatenatedEscapeAfterComment';
              break;
            }
            lastChar = '';
            next = 'NoneContinue';
            break;
          }
          if (ch === ' ' || ch === '\t' || ch === '\n' || ch === '\r' || ch === '\f') continue;
          lastChar = '';
          next = 'NoneContinue';
          break;
        }
        state = next;
        break;
      }

      case 'MaybeConcatenatedEscapeAfterComment': {
        let next: State = 'Finish';
        while (currCharOfs < end) {
          ch = sql.charAt(currCharOfs++);
          if (ch === '\r' || ch === '\n') {
            next = 'MaybeConcatenatedEscaped2';
            break;
          }
        }
        state = next;
        break;
      }

      case 'DollarQuotedStart':
        if (currCharOfs < end) {
          ch = sql.charAt(currCharOfs);
          if (ch === '$') {
            // An empty tag: $$
            tagStart = tagEnd = currCharOfs;
            currCharOfs++;
            state = 'DollarQuoted';
            break;
          }
          if (isIdentifierStart(ch)) {
            tagStart = currCharOfs;
            currCharOfs++;
            state = 'DollarQuotedInFirstDelim';
            break;
          }
          lastChar = '$';
          currCharOfs++;
          state = 'NoneContinue';
        } else state = 'Finish';
        break;

      case 'DollarQuotedInFirstDelim': {
        let next: State = 'Finish';
        while (currCharOfs < end) {
          lastChar = ch;
          ch = sql.charAt(currCharOfs++);
          if (ch === '$') {
            tagEnd = currCharOfs - 1;
            next = 'DollarQuoted';
            break;
          }
          if (!isDollarTagIdentifier(ch)) {
            next = 'NoneContinue';
            break;
          }
        }
        state = next;
        break;
      }

      case 'DollarQuoted': {
        const tag = sql.substring(tagStart - 1, tagEnd + 1);
        const pos = sql.indexOf(tag, tagEnd + 1);
        if (pos < 0) {
          currCharOfs = end;
          state = 'Finish';
          break;
        }
        currCharOfs = pos + tagEnd - tagStart + 2;
        ch = '';
        state = 'None';
        break;
      }

      case 'LineCommentBegin':
        if (currCharOfs < end) {
          ch = sql.charAt(currCharOfs++);
          if (ch === '-') state = 'LineComment';
          else {
            lastChar = '';
            state = 'NoneContinue';
          }
        } else state = 'Finish';
        break;

      case 'LineComment': {
        let next: State = 'Finish';
        while (currCharOfs < end) {
          ch = sql.charAt(currCharOfs++);
          if (ch === '\r' || ch === '\n') {
            next = 'None';
            break;
          }
        }
        state = next;
        break;
      }

      case 'BlockCommentBegin': {
        let next: State = 'Finish';
        while (currCharOfs < end) {
          ch = sql.charAt(currCharOfs++);
          if (ch === '*') {
            blockCommentLevel++;
            next = 'BlockComment';
            break;
          }
          if (ch !== '/') {
            if (blockCommentLevel > 0) {
              next = 'BlockComment';
              break;
            }
            lastChar = '';
            next = 'NoneContinue';
            break;
          }
        }
        state = next;
        break;
      }

      case 'BlockComment': {
        let next: State = 'Finish';
        while (currCharOfs < end) {
          ch = sql.charAt(currCharOfs++);
          if (ch === '*') {
            next = 'BlockCommentEnd';
            break;
          }
          if (ch === '/') {
            next = 'BlockCommentBegin';
            break;
          }
        }
        state = next;
        break;
      }

      case 'BlockCommentEnd': {
        let next: State = 'Finish';
        while (currCharOfs < end) {
          ch = sql.charAt(currCharOfs++);
          if (ch === '/') {
            next = --blockCommentLevel > 0 ? 'BlockComment' : 'None';
            break;
          }
          if (ch !== '*') {
            next = 'BlockComment';
            break;
          }
        }
        state = next;
        break;
      }

      case 'SemiColon': {
        rewritten += sql.substring(currTokenBeg, currCharOfs - 1);
        finishStatement(rewritten);
        let more = false;
        while (currCharOfs < end) {
          ch = sql.charAt(currCharOfs);
          if (isWhiteSpace(ch)) {
            currCharOfs++;
            continue;
          }
          // Something after the semicolon: another statement (legacy batching)
          more = true;
          break;
        }
        if (!more) return statements;
        currTokenBeg = currCharOfs;
        state = 'None';
        break;
      }

      case 'Finish':
        rewritten += sql.substring(currTokenBeg, end);
        finishStatement(rewritten);
        return statements;
    }
  }
}
