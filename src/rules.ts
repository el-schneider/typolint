import type { LocaleConventions, QuotePair } from "./locale.ts";

/**
 * Rules read a region as plain text in which every `word` atom is the single character WORD
 * and `transparent` atoms are absent. Offsets in findings index that text.
 */
export const WORD = "\uE000";

export const ruleIds = Object.freeze([
  "apostrophe",
  "quotes",
  "ellipsis",
  "dash",
  "dash-style",
  "double-space",
  "punctuation-space",
] as const);
export type RuleId = (typeof ruleIds)[number];

/**
 * Stable identity of each kind of issue, as `rule/kind`. Messages are display text and may
 * change; tools should match on codes.
 */
export const issueCodes = {
  apostrophe: ["wrong-glyph", "ambiguous"],
  quotes: ["wrong-glyph", "ambiguous-direction", "unmatched-close", "unclosed"],
  ellipsis: ["three-dots"],
  dash: ["hyphen", "between-numbers", "context-dependent"],
  "dash-style": ["wrong-glyph"],
  "double-space": ["repeated"],
  "punctuation-space": ["missing", "wrong-space"],
} as const satisfies Record<RuleId, readonly string[]>;

export type IssueCode = { [R in RuleId]: `${R}/${(typeof issueCodes)[R][number]}` }[RuleId];

export function ruleOf(code: IssueCode): RuleId {
  const rule = ruleIds.find((id) => code.startsWith(`${id}/`));
  if (rule === undefined) throw new Error(`Issue code without a rule: ${code}`);
  return rule;
}

export interface Finding {
  readonly code: IssueCode;
  readonly from: number;
  readonly to: number;
  readonly message: string;
  /** Replacement for `[from, to)`. Present only when the correction is certain. */
  readonly fix?: string;
}

type Rule = (text: string, locale: LocaleConventions) => Finding[];

const isLetter = (c: string | undefined) => c === WORD || (c !== undefined && /[\p{L}\p{M}]/u.test(c));
const isAlnum = (c: string | undefined) => isLetter(c) || (c !== undefined && /\p{N}/u.test(c));
/** `undefined` is the region edge, which counts as space. */
const isSpace = (c: string | undefined) => c === undefined || /\s/u.test(c);
const isPunct = (c: string | undefined) => c !== undefined && /[\p{P}\p{S}]/u.test(c);

const apostropheLike = "'‘’´`";

const isQuoteChar = (c: string | undefined) => c !== undefined && apostropheLike.includes(c);
/** Horizontal space characters a configured space may replace. */
const isSpaceLike = (c: string | undefined) => c !== undefined && /^[ \u00A0\u2000-\u200A\u202F]$/u.test(c);

/** UTF-16 offsets with their code unit; every character the rules look for is in the BMP. */
function* chars(text: string): Generator<[number, string]> {
  for (let i = 0; i < text.length; i++) yield [i, text[i]!];
}

/**
 * True where the character can only be an apostrophe: between letters (`You're`, `{name}'s`,
 * `l'homme`), before a decade (`'90s`), or in `'n'` between spaces (`rock 'n' roll`).
 */
function isCertainApostrophe(text: string, i: number): boolean {
  const prev = text[i - 1];
  const next = text[i + 1];
  if (isLetter(prev) && isLetter(next)) return true;
  if (!isAlnum(prev) && /^\d\ds(?![\p{L}\p{N}])/u.test(text.slice(i + 1))) return true;
  if (isSpace(prev) && next === "n" && isQuoteChar(text[i + 2]) && isSpace(text[i + 3])) return true;
  return prev === "n" && isQuoteChar(text[i - 2]) && isSpace(text[i - 3]) && isSpace(next);
}

const apostrophe: Rule = (text) => {
  const findings: Finding[] = [];
  for (const [i, c] of chars(text)) {
    if (!"'‘´`".includes(c)) continue;
    if (isCertainApostrophe(text, i)) {
      findings.push({
        code: "apostrophe/wrong-glyph",
        from: i,
        to: i + 1,
        message: `Use ’ (U+2019) for an apostrophe, not ${c}.`,
        fix: "’",
      });
    } else if (c === "'") {
      findings.push({
        code: "apostrophe/ambiguous",
        from: i,
        to: i + 1,
        message: "Straight ' here can be an apostrophe (’) or a quote. Decide by hand.",
      });
    }
  }
  return findings;
};

const singleWidth = "'‘’‚‛‹›";
const quoteChars = '"“”„‟«»‘’‚‛‹›';
type Role = "open" | "close";

function tableRole(c: string, locale: LocaleConventions): Role | undefined {
  const { primary, secondary } = locale.quotes;
  const opens = c === primary[0] || c === secondary[0];
  const closes = c === primary[1] || c === secondary[1];
  if (opens === closes) return undefined;
  return opens ? "open" : "close";
}

/** CommonMark-style flanking: an opening quote hugs the following word, a closing quote the preceding one. */
function contextRole(text: string, i: number): Role | undefined {
  const prev = text[i - 1];
  const next = text[i + 1];
  const left = !isSpace(next) && (!isPunct(next) || isSpace(prev) || isPunct(prev));
  const right = !isSpace(prev) && (!isPunct(prev) || isSpace(next) || isPunct(next));
  if (left === right) return undefined;
  return left ? "open" : "close";
}

function roleOf(text: string, i: number, locale: LocaleConventions): Role | undefined {
  const c = text[i]!;
  // Guillemets point the same way in every locale that uses them as listed, even with spaces inside.
  if ("«»‹›".includes(c)) return tableRole(c, locale) ?? contextRole(text, i);
  return contextRole(text, i) ?? tableRole(c, locale);
}

const quotes: Rule = (text, locale) => {
  const findings: Finding[] = [];
  const pairs: { open: number; close: number; expected: QuotePair }[] = [];
  const stack: { i: number; char: string }[] = [];
  let balanced = true;
  const unbalanced = (i: number, code: IssueCode, message: string) => {
    balanced = false;
    findings.push({ code, from: i, to: i + 1, message });
  };
  const level = (depth: number) => (depth % 2 === 0 ? locale.quotes.primary : locale.quotes.secondary);

  for (const [i, c] of chars(text)) {
    if (!quoteChars.includes(c) || isCertainApostrophe(text, i)) continue;
    const role = roleOf(text, i, locale);
    if (c === "’") {
      // Also the apostrophe: a quote only when it closes a single quote or opens one where the locale says so.
      const top = stack.at(-1);
      const closesSingle = role === "close" && top !== undefined && singleWidth.includes(top.char);
      const opensSingle = role === "open" && level(stack.length)[0] === "’";
      if (!closesSingle && !opensSingle) continue;
    }
    if (role === undefined) {
      unbalanced(
        i,
        "quotes/ambiguous-direction",
        `Cannot tell whether ${c} opens or closes a quote. Fix by hand.`,
      );
    } else if (role === "open") {
      stack.push({ i, char: c });
    } else {
      const open = stack.pop();
      if (open === undefined)
        unbalanced(i, "quotes/unmatched-close", `Closing quote ${c} has no opening quote.`);
      else pairs.push({ open: open.i, close: i, expected: level(stack.length) });
    }
  }
  for (const open of stack)
    unbalanced(open.i, "quotes/unclosed", `Opening quote ${text[open.i]} is never closed.`);

  for (const { open, close, expected } of pairs) {
    const ends = [
      { i: open, partner: close, want: expected[0], partnerWant: expected[1] },
      { i: close, partner: open, want: expected[1], partnerWant: expected[0] },
    ];
    for (const { i, partner, want, partnerWant } of ends) {
      const actual = text[i]!;
      if (actual === want) continue;
      // A typed " is never a style choice. Another typographic style (»…« in German) may be house
      // style: fix it only to quotes the user chose, or when the partner quote shows it is a typo.
      const typed = actual === '"';
      const sameWidth = typed || singleWidth.includes(actual) === singleWidth.includes(want);
      const certain = typed || locale.quotesChosen || text[partner] === partnerWant;
      const hint =
        typed || locale.quotesChosen
          ? ""
          : " If this is your house style, set the locale's quotes in the config.";
      findings.push({
        code: "quotes/wrong-glyph",
        from: i,
        to: i + 1,
        message: `Use ${want} here, not ${actual}.${hint}`,
        ...(balanced && sameWidth && certain ? { fix: want } : {}),
      });
    }
  }
  return findings.toSorted((a, b) => a.from - b.from);
};

const ellipsis: Rule = (text) =>
  [...text.matchAll(/(?<!\.)\.\.\.(?!\.)/gu)].map((m): Finding => ({
    code: "ellipsis/three-dots",
    from: m.index,
    to: m.index + 3,
    message: "Use … (U+2026) instead of three dots.",
    fix: "…",
  }));

const doubleSpace: Rule = (text) =>
  [...text.matchAll(/(?<=\S) {2,}(?=\S)/gu)].map((m): Finding => ({
    code: "double-space/repeated",
    from: m.index,
    to: m.index + m[0].length,
    message: "Use one space.",
    fix: " ",
  }));

/** A hyphen with whitespace on both sides, or a line break on one side, between two words. */
const dash: Rule = (text, locale) =>
  [...text.matchAll(/(?<=\S)(\s)(--?)(\s)(?=\S)/gu)].map((m): Finding => {
    const base = { from: m.index, to: m.index + m[0].length };
    const between = (re: RegExp) => re.test(text[m.index - 1] ?? "") && re.test(text[base.to] ?? "");
    if (between(/\p{N}/u)) {
      return {
        ...base,
        code: "dash/between-numbers",
        message: "Hyphen between numbers: minus sign, range or dash? Fix by hand.",
      };
    }
    if (locale.dash.kind === "report") {
      return {
        ...base,
        code: "dash/context-dependent",
        message:
          "Hyphen used as a dash. This locale has no single dash style; set the locale's dash in the config to fix it automatically.",
      };
    }
    const { dash: char, spaced } = locale.dash;
    const style = spaced ? ` ${char} ` : char;
    const message = `Use "${style}" for a dash, not a hyphen.`;
    if (m[1] === " " && m[3] === " ") return { ...base, code: "dash/hyphen", message, fix: style };
    // A line break next to the hyphen stays; only the hyphen changes, and only if the style is spaced.
    const hyphen = { from: m.index + 1, to: m.index + 1 + m[2]!.length };
    return spaced
      ? { ...hyphen, code: "dash/hyphen", message, fix: char }
      : { ...hyphen, code: "dash/hyphen", message: `${message} Remove the line break by hand.` };
  });

/**
 * A typographic dash between words that does not match the locale's dash style, e.g. an em
 * dash in German text that uses spaced en dashes. An unspaced en dash is left alone: it marks
 * ranges and routes (`3–5`, `Berlin–Hamburg`).
 */
const dashStyle: Rule = (text, locale) => {
  if (locale.dash.kind === "report") return [];
  const { dash: char, spaced } = locale.dash;
  const style = spaced ? ` ${char} ` : char;
  return [...text.matchAll(/(?<=\S)( ?)([–—])\1(?=\S)/gu)].flatMap((m): Finding[] => {
    const isEnDash = m[2] === "–";
    const isSpaced = m[1] === " ";
    if (m[0] === style || (isEnDash && !isSpaced)) return [];
    const digits = /\p{N}/u.test(text[m.index - 1]!) && /\p{N}/u.test(text[m.index + m[0].length]!);
    if (digits) return [];
    return [
      {
        code: "dash-style/wrong-glyph",
        from: m.index,
        to: m.index + m[0].length,
        message: `This text uses "${style}" for a dash, not "${m[0]}".`,
        fix: style,
      },
    ];
  });
};

const spaceLabel = (space: string) =>
  `U+${space.codePointAt(0)!.toString(16).toUpperCase().padStart(4, "0")}`;

/** Spaces the locale requires before marks and inside guillemets, e.g. French `Quoi ?` with U+202F. */
const punctuationSpace: Rule = (text, locale) => {
  const { before, insideGuillemets } = locale.spacing;
  const findings: Finding[] = [];
  /** `gap` is where the space belongs; if it holds another space, replace it, else insert at `insertAt`. */
  const require = (gap: number, insertAt: number, space: string) => {
    const c = text[gap];
    if (c === space) return;
    const message = `Use ${spaceLabel(space)} here.`;
    if (isSpaceLike(c)) {
      findings.push({ code: "punctuation-space/wrong-space", from: gap, to: gap + 1, message, fix: space });
    } else {
      findings.push({ code: "punctuation-space/missing", from: insertAt, to: insertAt, message, fix: space });
    }
  };
  for (const [i, c] of chars(text)) {
    const prev = text[i - 1];
    const next = text[i + 1];
    const space = before.get(c);
    if (space !== undefined) {
      // `?!` gets one space; a mark at the start of the text or after a lone space gets none.
      if (prev === undefined || before.has(prev) || (isSpaceLike(prev) && isSpace(text[i - 2]))) continue;
      if (!isSpace(next) && !isPunct(next)) continue; // 12:30, ?x
      require(isSpaceLike(prev) ? i - 1 : i, i, space);
    } else if (insideGuillemets !== undefined && "«‹".includes(c) && next !== undefined) {
      require(i + 1, i + 1, insideGuillemets);
    } else if (insideGuillemets !== undefined && "»›".includes(c) && prev !== undefined) {
      require(isSpaceLike(prev) ? i - 1 : i, i, insideGuillemets);
    }
  }
  return findings;
};

export const rules: Readonly<Record<RuleId, Rule>> = {
  apostrophe,
  quotes,
  ellipsis,
  dash,
  "dash-style": dashStyle,
  "double-space": doubleSpace,
  "punctuation-space": punctuationSpace,
};
