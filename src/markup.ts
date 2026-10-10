/**
 * Markup layer. A syntax turns a source string into regions of text that the rules may read,
 * with everything else (placeholders, markers, URLs, ICU syntax) held as opaque atoms.
 * Offsets are UTF-16 indexes into the source string.
 */

/**
 * `word`: stands in for a word, e.g. `{name}` in `{name}’s`. Rules see it as a letter.
 * `transparent`: a marker with no text of its own, e.g. `*` around emphasis. Rules skip it.
 */
export type AtomRole = "word" | "transparent";

export type Piece =
  | { readonly kind: "text"; readonly start: number; readonly end: number }
  /** Source characters that stand for one text character, e.g. ICU `''` for `'`. */
  | { readonly kind: "escape"; readonly char: string; readonly start: number; readonly end: number }
  | { readonly kind: "atom"; readonly role: AtomRole; readonly start: number; readonly end: number };

/** One run of message text. Quotes must balance within a region; ICU plural branches are separate regions. */
export type Region = readonly Piece[];

export interface ProtectPattern {
  readonly name: string;
  readonly pattern: RegExp;
  readonly role: AtomRole;
}

export const protectUrl: ProtectPattern = {
  name: "url",
  pattern: /\bhttps?:\/\/[^\s<>"]*[^\s<>".,;:!?)\]'”’»]/u,
  role: "word",
};
export const protectEmail: ProtectPattern = {
  name: "email",
  pattern: /[\p{L}\p{N}._%+-][\p{L}\p{N}._%+'-]*@[\p{L}\p{N}-]+(?:\.[\p{L}\p{N}-]+)+/u,
  role: "word",
};
export const protectCode: ProtectPattern = { name: "code", pattern: /`[^`\n]+`/u, role: "word" };
export const protectPlaceholder: ProtectPattern = {
  name: "placeholder",
  pattern: /\{[^{}]*\}/u,
  role: "word",
};
export const protectEmphasis: ProtectPattern = { name: "emphasis", pattern: /\*+/u, role: "transparent" };

/** Defaults for the `plain` syntax: `{placeholders}`, `*emphasis*` markers, URLs, emails, code spans. */
export const plainProtect: readonly ProtectPattern[] = [
  protectUrl,
  protectEmail,
  protectCode,
  protectPlaceholder,
  protectEmphasis,
];

/** Defaults inside ICU message text. ICU syntax itself is handled by the ICU parser. */
export const icuProtect: readonly ProtectPattern[] = [protectUrl, protectEmail, protectCode];

/**
 * Splits `source[start, end)` into text and atoms. Overlapping matches resolve to the earliest,
 * then longest, match.
 */
export function protectText(
  source: string,
  start: number,
  end: number,
  patterns: readonly ProtectPattern[],
): Piece[] {
  const slice = source.slice(start, end);
  const matches: { start: number; end: number; role: AtomRole }[] = [];
  for (const { pattern, role } of patterns) {
    const global = new RegExp(
      pattern.source,
      pattern.flags.includes("g") ? pattern.flags : `${pattern.flags}g`,
    );
    for (const m of slice.matchAll(global)) {
      if (m[0].length > 0) matches.push({ start: start + m.index, end: start + m.index + m[0].length, role });
    }
  }
  matches.sort((a, b) => a.start - b.start || b.end - a.end);

  const pieces: Piece[] = [];
  let at = start;
  for (const m of matches) {
    if (m.start < at) continue;
    if (m.start > at) pieces.push({ kind: "text", start: at, end: m.start });
    pieces.push({ kind: "atom", role: m.role, start: m.start, end: m.end });
    at = m.end;
  }
  if (at < end) pieces.push({ kind: "text", start: at, end });
  return pieces;
}

export function parsePlain(source: string, patterns: readonly ProtectPattern[] = plainProtect): Region[] {
  return [protectText(source, 0, source.length, patterns)];
}
