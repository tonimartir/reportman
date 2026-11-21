// The placeholders of a command, found as MySqlConnector 2.5 finds them (SqlParser): `@NAME`, `?NAME`,
// `@'NAME'`/`@"NAME"`/`` @`NAME` `` and positional `?`, outside string literals, quoted identifiers
// and comments (`-- `, `#`, `/* */`), backslash escapes in strings unless NoBackslashEscapes. `@@NAME`
// is a system variable. The state machine is MySqlConnector's, quirks included (a character right
// after a closing quote or after a parameter is not looked at).
//
// The driver also takes `:NAME` when NAME is a parameter of the command: the Delphi form the sample
// reports keep (MySqlConnector sends it to the server, which rejects it).

/** What the parser finds, in order. */
export interface SqlParserEvents {
  /** A named parameter: its text (with its prefix, `@`, `?` or `:`) at [index, index + length). */
  namedParameter(index: number, length: number): void;
  /** A positional parameter (`?`) at index. */
  positionalParameter(index: number): void;
}

/** FinalParseStates. */
export const FinalParseStates = { None: 0, Complete: 1, NeedsNewline: 2, NeedsSemicolon: 4 } as const;

const State = {
  Beginning: 0,
  Statement: 1,
  SingleQuotedString: 2,
  SingleQuotedStringBackslash: 3,
  SingleQuotedStringSingleQuote: 4,
  DoubleQuotedString: 5,
  DoubleQuotedStringBackslash: 6,
  DoubleQuotedStringDoubleQuote: 7,
  BacktickQuotedString: 8,
  BacktickQuotedStringBacktick: 9,
  EndOfLineComment: 10,
  Hyphen: 11,
  SecondHyphen: 12,
  ForwardSlash: 13,
  CStyleComment: 14,
  CStyleCommentAsterisk: 15,
  QuestionMark: 16,
  AtSign: 17,
  NamedParameter: 18,
} as const;
type State = (typeof State)[keyof typeof State];

function isWhitespace(ch: string): boolean {
  return ch === ' ' || ch === '\t' || ch === '\r' || ch === '\n';
}

/** SqlParser.IsVariableName. */
export function isVariableName(ch: string): boolean {
  if (ch.length === 0) return false;
  const c = ch.charCodeAt(0);
  return (c >= 97 && c <= 122) || (c >= 65 && c <= 90) || (c >= 48 && c <= 57) || c === 46 || c === 95 || c === 36 || c >= 0x80;
}

function isColonNameStart(ch: string): boolean {
  if (ch.length === 0) return false;
  const c = ch.charCodeAt(0);
  return (c >= 97 && c <= 122) || (c >= 65 && c <= 90) || c === 95 || c >= 0x80;
}

/**
 * SqlParser.Parse. `isColonParameter` tells whether `:NAME` (NAME without the colon) is a parameter of
 * the command. Returns the FinalParseStates.
 */
export function parseSql(
  sql: string,
  noBackslashEscapes: boolean,
  isColonParameter: (name: string) => boolean,
  events: SqlParserEvents,
): number {
  let parameterStartIndex = -1;
  let state: State = State.Beginning;
  let beforeCommentState: State = State.Beginning;
  let isNamedParameter = false;
  const n = sql.length;
  for (let index = 0; index < n; index++) {
    const ch = sql.charAt(index);
    if (state === State.EndOfLineComment) {
      if (ch === '\n') state = beforeCommentState;
    } else if (state === State.CStyleComment) {
      if (ch === '*') state = State.CStyleCommentAsterisk;
    } else if (state === State.CStyleCommentAsterisk) {
      state = ch === '/' ? beforeCommentState : State.CStyleComment;
    } else if (state === State.SingleQuotedString) {
      if (ch === "'") state = State.SingleQuotedStringSingleQuote;
      else if (ch === '\\' && !noBackslashEscapes) state = State.SingleQuotedStringBackslash;
    } else if (state === State.SingleQuotedStringBackslash) {
      state = State.SingleQuotedString;
    } else if (state === State.DoubleQuotedString) {
      if (ch === '"') state = State.DoubleQuotedStringDoubleQuote;
      else if (ch === '\\' && !noBackslashEscapes) state = State.DoubleQuotedStringBackslash;
    } else if (state === State.DoubleQuotedStringBackslash) {
      state = State.DoubleQuotedString;
    } else if (state === State.BacktickQuotedString) {
      if (ch === '`') state = State.BacktickQuotedStringBacktick;
    } else if (
      state === State.SingleQuotedStringSingleQuote ||
      state === State.DoubleQuotedStringDoubleQuote ||
      state === State.BacktickQuotedStringBacktick
    ) {
      const quote: string = state === State.SingleQuotedStringSingleQuote ? "'" : state === State.DoubleQuotedStringDoubleQuote ? '"' : '`';
      if (ch === quote) {
        state =
          state === State.SingleQuotedStringSingleQuote
            ? State.SingleQuotedString
            : state === State.DoubleQuotedStringDoubleQuote
              ? State.DoubleQuotedString
              : State.BacktickQuotedString;
      } else {
        if (isNamedParameter) events.namedParameter(parameterStartIndex, index - parameterStartIndex);
        state = ch === ';' ? State.Beginning : State.Statement;
      }
    } else if (state === State.SecondHyphen) {
      state = ch === ' ' ? State.EndOfLineComment : State.Statement;
    } else if (state === State.Hyphen) {
      state = ch === '-' ? State.SecondHyphen : State.Statement;
    } else if (state === State.ForwardSlash) {
      state = ch === '*' ? State.CStyleComment : State.Statement;
    } else if (state === State.QuestionMark) {
      if (isVariableName(ch)) {
        state = State.NamedParameter;
      } else {
        events.positionalParameter(parameterStartIndex);
        state = ch === ';' ? State.Beginning : State.Statement;
      }
    } else if (state === State.AtSign) {
      if (isVariableName(ch)) state = State.NamedParameter;
      else if (ch === '`') {
        state = State.BacktickQuotedString;
        isNamedParameter = true;
      } else if (ch === '"') {
        state = State.DoubleQuotedString;
        isNamedParameter = true;
      } else if (ch === "'") {
        state = State.SingleQuotedString;
        isNamedParameter = true;
      } else state = State.Statement;
    } else if (state === State.NamedParameter) {
      if (!isVariableName(ch)) {
        events.namedParameter(parameterStartIndex, index - parameterStartIndex);
        state = ch === ';' ? State.Beginning : State.Statement;
      }
    } else {
      if (ch === '-' && index < n - 2 && sql.charAt(index + 1) === '-' && sql.charAt(index + 2) === ' ') {
        beforeCommentState = state;
        state = State.Hyphen;
      } else if (ch === '/' && index < n - 1 && sql.charAt(index + 1) === '*') {
        beforeCommentState = state;
        state = State.ForwardSlash;
      } else if (ch === "'") state = State.SingleQuotedString;
      else if (ch === '"') state = State.DoubleQuotedString;
      else if (ch === '`') state = State.BacktickQuotedString;
      else if (ch === '?') {
        state = State.QuestionMark;
        parameterStartIndex = index;
      } else if (ch === '@') {
        state = State.AtSign;
        parameterStartIndex = index;
      } else if (ch === '#') {
        beforeCommentState = state;
        state = State.EndOfLineComment;
      } else if (ch === ';') {
        state = State.Beginning;
      } else if (ch === ':' && isColonNameStart(sql.charAt(index + 1))) {
        // the Delphi placeholder of a parameter of the command (an extension of the driver)
        let j = index + 1;
        while (j < n && isVariableName(sql.charAt(j))) j++;
        if (isColonParameter(sql.substring(index + 1, j))) {
          state = State.NamedParameter;
          parameterStartIndex = index;
        } else state = State.Statement;
      } else if (!isWhitespace(ch) && state === State.Beginning) {
        state = State.Statement;
      }
    }
  }

  let states: number = FinalParseStates.None;
  if (state === State.NamedParameter) {
    events.namedParameter(parameterStartIndex, n - parameterStartIndex);
    state = State.Statement;
  } else if (state === State.QuestionMark) {
    events.positionalParameter(parameterStartIndex);
    state = State.Statement;
  } else if (state === State.EndOfLineComment) {
    states |= FinalParseStates.NeedsNewline;
    state = beforeCommentState;
  } else if (
    state === State.SingleQuotedStringSingleQuote ||
    state === State.DoubleQuotedStringDoubleQuote ||
    state === State.BacktickQuotedStringBacktick
  ) {
    state = State.Statement;
  }
  if (state === State.Statement) {
    states |= FinalParseStates.NeedsSemicolon;
    state = State.Beginning;
  }
  if (state === State.Beginning) states |= FinalParseStates.Complete;
  return states;
}

/** MySqlParameter.NormalizeParameterName. */
export function normalizeParameterName(name: string): string {
  const t = name.trim();
  if (t.length >= 1 && (t.charAt(0) === '@' || t.charAt(0) === '?')) {
    const rest = t.substring(1);
    if (rest.length >= 2) {
      const q = rest.charAt(0);
      if ((q === '`' || q === "'" || q === '"') && rest.charAt(rest.length - 1) === q) {
        return rest.substring(1, rest.length - 1).split(q + q).join(q);
      }
    }
    return rest;
  }
  return t;
}

/** The key of a name compared with StringComparer.OrdinalIgnoreCase (simple upper-case mapping). */
export function ordinalIgnoreCaseKey(name: string): string {
  let out = '';
  for (const ch of name) {
    const u = ch.toUpperCase();
    out += u.length === ch.length ? u : ch;
  }
  return out;
}
