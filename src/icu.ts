import { icuProtect, protectText, type Piece, type ProtectPattern, type Region } from "./markup.ts";

/**
 * ICU MessageFormat as read by FormatJS (react-intl): arguments, plural/select/selectordinal
 * branches, `#`, rich-text tags and apostrophe quoting. Each branch message is its own region;
 * the enclosing message sees the whole argument as one word.
 *
 * Apostrophe rules (ICU 4.8+, "DOUBLE_OPTIONAL"): `''` is a literal apostrophe; `'` before
 * `{ } < >` (and `#` inside plural) opens a quoted literal up to the next single `'`;
 * any other `'` is a literal apostrophe.
 */
type ArgKind = "plural" | "select" | "none";

export class IcuSyntaxError extends Error {
  readonly offset: number;
  constructor(message: string, offset: number) {
    super(`${message} at offset ${offset}`);
    this.offset = offset;
  }
}

const tagName = /[A-Za-z][\w.-]*/y;
const identifier = /[^\s{}#,<>'=]+|=\d+/uy;

export function parseIcu(source: string, patterns: readonly ProtectPattern[] = icuProtect): Region[] {
  const regions: Region[] = [];
  let pos = 0;

  const fail = (message: string): never => {
    throw new IcuSyntaxError(message, pos);
  };
  const skipSpace = () => {
    while (pos < source.length && /\s/u.test(source[pos]!)) pos++;
  };
  const read = (re: RegExp): string | undefined => {
    re.lastIndex = pos;
    const m = re.exec(source);
    if (!m) return undefined;
    pos += m[0].length;
    return m[0];
  };

  /** Parses message text until an unmatched `}` (nested) or the end (top level). */
  function parseMessage(nested: boolean, arg: ArgKind): void {
    const pieces: Piece[] = [];
    let textStart = pos;
    const flushText = () => {
      if (pos > textStart) pieces.push(...protectText(source, textStart, pos, patterns));
    };
    const atom = (role: "word" | "transparent", start: number) => {
      pieces.push({ kind: "atom", role, start, end: pos });
      textStart = pos;
    };

    while (pos < source.length) {
      const ch = source[pos]!;
      const next = source[pos + 1];
      if (ch === "}" && nested) break;
      if (ch === "'" && next === "'") {
        flushText();
        pieces.push({ kind: "escape", char: "'", start: pos, end: pos + 2 });
        pos += 2;
        textStart = pos;
      } else if (
        ch === "'" &&
        next !== undefined &&
        ("{}<>".includes(next) || (next === "#" && arg === "plural"))
      ) {
        flushText();
        const start = pos;
        pos += 2;
        while (pos < source.length) {
          if (source[pos] === "'" && source[pos + 1] === "'") pos += 2;
          else if (source[pos] === "'") {
            pos++;
            break;
          } else pos++;
        }
        atom("word", start);
      } else if (ch === "{") {
        flushText();
        const start = pos;
        argument();
        atom("word", start);
      } else if (ch === "#" && arg === "plural") {
        flushText();
        pos++;
        atom("word", pos - 1);
      } else if (ch === "<" && next !== undefined && /[A-Za-z/]/.test(next)) {
        flushText();
        const start = pos;
        pos += next === "/" ? 2 : 1;
        if (read(tagName) === undefined) fail("Expected a tag name");
        skipSpace();
        const selfClosing = source.startsWith("/>", pos);
        if (selfClosing) pos += 2;
        else if (source[pos] === ">") pos++;
        else fail("Expected > to end the tag");
        atom(selfClosing ? "word" : "transparent", start);
      } else {
        pos++;
      }
    }
    flushText();
    regions.push(pieces);
  }

  function argument(): void {
    pos++; // {
    skipSpace();
    if (read(identifier) === undefined) fail("Expected an argument name");
    skipSpace();
    if (source[pos] === "}") {
      pos++;
      return;
    }
    if (source[pos] !== ",") fail("Expected , or }");
    pos++;
    skipSpace();
    const type = read(/[A-Za-z]+/y) ?? fail("Expected an argument type");
    skipSpace();
    if (type === "plural" || type === "selectordinal" || type === "select") {
      if (source[pos] !== ",") fail("Expected , after the argument type");
      pos++;
      skipSpace();
      if (type !== "select" && read(/offset:\s*\d+/y) !== undefined) skipSpace();
      while (source[pos] !== "}") {
        if (pos >= source.length) fail("Unclosed argument");
        if (read(identifier) === undefined) fail("Expected a selector");
        skipSpace();
        if (source[pos] !== "{") fail("Expected { after the selector");
        pos++;
        parseMessage(true, type === "select" ? "select" : "plural");
        if (source[pos] !== "}") fail("Unclosed branch");
        pos++;
        skipSpace();
      }
      pos++;
      return;
    }
    // number, date, time and their styles or skeletons: opaque up to the matching brace.
    let depth = 1;
    while (depth > 0) {
      if (pos >= source.length) fail("Unclosed argument");
      if (source[pos] === "{") depth++;
      else if (source[pos] === "}") depth--;
      pos++;
    }
  }

  parseMessage(false, "none");
  return regions;
}
