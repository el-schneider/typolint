import { cldrQuotes } from "./locales.generated.ts";

export type QuotePair = readonly [open: string, close: string];

export interface QuotePairs {
  readonly primary: QuotePair;
  readonly secondary: QuotePair;
}

/**
 * How a hyphen typed as a sentence dash (`word - word`) should be written.
 * `report` means the locale's convention depends on context the linter cannot see
 * (Spanish raya, Portuguese travessão), so the hyphen is flagged without a fix.
 */
export type DashStyle =
  | { readonly kind: "replace"; readonly dash: "–" | "—"; readonly spaced: boolean }
  | { readonly kind: "report" };

/** Space characters by the names used in config files, where they would be invisible. */
export const spaceNames = {
  "narrow-nbsp": "\u202F",
  nbsp: "\u00A0",
  thin: "\u2009",
  hair: "\u200A",
} as const;
export type SpaceName = keyof typeof spaceNames;

/** Spaces the `punctuation-space` rule requires. Empty means the locale sets none. */
export interface Spacing {
  /** Mark → space before it, e.g. `?` → U+202F. */
  readonly before: ReadonlyMap<string, string>;
  /** Space after « ‹ and before » ›. */
  readonly insideGuillemets: string | undefined;
}

export interface LocaleConventions {
  readonly quotes: QuotePairs;
  /**
   * True when the user chose the quotes in a config. Only then are typographic quotes of
   * another style fixed; with CLDR defaults they are reported, since they may be house style.
   */
  readonly quotesChosen: boolean;
  readonly dash: DashStyle;
  readonly spacing: Spacing;
}

/** House style for one locale, written the way it looks in text. Every field is optional; missing ones keep the default. */
export interface LocaleOverride {
  /** Four characters: primary open, primary close, secondary open, secondary close, e.g. `"»«›‹"` for »German guillemets«. */
  readonly quotes?: string;
  /** What replaces a hyphen used as a dash: `"—"`, `" — "`, `"–"`, `" – "`, or `"report"` to flag without a fix. */
  readonly dash?: string;
  /** Spaces for the `punctuation-space` rule, by name: `narrow-nbsp`, `nbsp`, `thin`, `hair`. */
  readonly spacing?: {
    /** Marks → space before them, e.g. `{ ";:!?": "narrow-nbsp" }`. */
    readonly before?: Readonly<Record<string, string>>;
    /** Space after « ‹ and before » ›. */
    readonly insideGuillemets?: string;
  };
}

function parseSpace(value: string, label: string): string {
  if (!Object.hasOwn(spaceNames, value)) {
    throw new LocaleError(
      `${label}: expected one of ${Object.keys(spaceNames).join(", ")}, got ${JSON.stringify(value)}.`,
    );
  }
  return spaceNames[value as SpaceName];
}

function parseSpacing(value: NonNullable<LocaleOverride["spacing"]>, label: string): Spacing {
  const before = new Map<string, string>();
  for (const [marks, name] of Object.entries(value.before ?? {})) {
    const space = parseSpace(name, `${label}.before.${marks}`);
    for (const mark of marks) {
      if (!/^\p{P}$/u.test(mark)) {
        throw new LocaleError(`${label}.before: ${JSON.stringify(mark)} is not a punctuation mark.`);
      }
      before.set(mark, space);
    }
  }
  const inside = value.insideGuillemets;
  return {
    before,
    insideGuillemets: inside === undefined ? undefined : parseSpace(inside, `${label}.insideGuillemets`),
  };
}

const typographicQuotes = "“”„‟«»‹›‘’‚‛";

function parseQuotes(value: string, label: string): QuotePairs {
  const chars = [...value];
  if (chars.length !== 4 || !chars.every((c) => typographicQuotes.includes(c))) {
    throw new LocaleError(
      `${label}: expected four quote characters (primary open, close, secondary open, close) from ${typographicQuotes}, e.g. "»«›‹", got ${JSON.stringify(value)}.`,
    );
  }
  const [po, pc, so, sc] = chars as [string, string, string, string];
  return { primary: [po, pc], secondary: [so, sc] };
}

function parseDash(value: string, label: string): DashStyle {
  if (value === "report") return { kind: "report" };
  const m = /^( ?)([–—])\1$/u.exec(value);
  if (!m) {
    throw new LocaleError(
      `${label}: expected "—", " — ", "–", " – " or "report", got ${JSON.stringify(value)}.`,
    );
  }
  return { kind: "replace", dash: m[2] as "–" | "—", spaced: m[1] === " " };
}

const spacedEnDash: DashStyle = { kind: "replace", dash: "–", spaced: true };

// Not in CLDR. Only locales whose standard reference gives one dash for this use: Duden (de),
// Taalunie (nl), ČSN 01 6910 (cs), Språkrådet (sv), Dansk Sprognævn (da), Kotus (fi), RJP (pl).
// English is absent on purpose: Chicago, AP and British usage disagree, so it is house style.
const dashes: Readonly<Record<string, DashStyle>> = {
  de: spacedEnDash,
  nl: spacedEnDash,
  cs: spacedEnDash,
  sv: spacedEnDash,
  da: spacedEnDash,
  fi: spacedEnDash,
  pl: spacedEnDash,
};

const noSpacing: Spacing = { before: new Map(), insideGuillemets: undefined };

const spacings: Readonly<Record<string, Spacing>> = {
  fr: {
    before: new Map([...";:!?"].map((mark) => [mark, spaceNames["narrow-nbsp"]])),
    insideGuillemets: spaceNames["narrow-nbsp"],
  },
};

/** An unknown or malformed locale tag, or an override value that cannot be used. */
export class LocaleError extends Error {}

/** `EN`, `en_gb` and `en-gb` all become `en` or `en-GB`, the form used as table keys. */
function canonical(tag: string): string {
  try {
    const [canonicalTag] = Intl.getCanonicalLocales(tag.replaceAll("_", "-"));
    if (canonicalTag) return canonicalTag;
  } catch (error) {
    throw new LocaleError(`"${tag}" is not a valid locale tag.`, { cause: error });
  }
  throw new LocaleError(`"${tag}" is not a valid locale tag.`);
}

const language = (tag: string) => tag.split("-")[0] ?? tag;

/** Most specific match first: `de-AT` falls back to `de`. */
function lookup<T>(table: Readonly<Record<string, T>>, tag: string): T | undefined {
  return table[tag] ?? table[language(tag)];
}

export const knownLocales: readonly string[] = Object.freeze(Object.keys(cldrQuotes));

function parseOverride(key: string, override: LocaleOverride): Partial<LocaleConventions> {
  const label = `locales.${key}`;
  return {
    ...(override.quotes === undefined ? {} : { quotes: parseQuotes(override.quotes, `${label}.quotes`) }),
    ...(override.dash === undefined ? {} : { dash: parseDash(override.dash, `${label}.dash`) }),
    ...(override.spacing === undefined
      ? {}
      : { spacing: parseSpacing(override.spacing, `${label}.spacing`) }),
  };
}

/** Override keys in canonical form. Two keys for the same locale (`de-ch`, `de-CH`) are an error. */
function canonicalOverrides(
  overrides: Readonly<Record<string, LocaleOverride>>,
): Map<string, Partial<LocaleConventions>> {
  const byTag = new Map<string, Partial<LocaleConventions>>();
  const keyOf = new Map<string, string>();
  for (const [key, override] of Object.entries(overrides)) {
    const tag = canonical(key);
    const previous = keyOf.get(tag);
    if (previous !== undefined) {
      throw new LocaleError(`locales: "${previous}" and "${key}" are the same locale (${tag}). Keep one.`);
    }
    keyOf.set(tag, key);
    byTag.set(tag, parseOverride(key, override));
  }
  return byTag;
}

/** True if `tag` has built-in data or an override with quotes for it or its language. */
export function isKnownLocale(
  tag: string,
  overrides: Readonly<Record<string, LocaleOverride>> = {},
): boolean {
  try {
    resolveLocale(tag, overrides);
    return true;
  } catch (error) {
    if (error instanceof LocaleError) return false;
    throw error;
  }
}

/**
 * Conventions for `tag`: built-in defaults, then the override for its language, then the
 * override for the full tag. Each override field replaces only that field.
 */
export function resolveLocale(
  tag: string,
  overrides: Readonly<Record<string, LocaleOverride>> = {},
): LocaleConventions {
  const full = canonical(tag);
  const byTag = canonicalOverrides(overrides);
  const override = { ...byTag.get(language(full)), ...byTag.get(full) };
  const quotes = override.quotes ?? lookup(cldrQuotes, full);
  if (!quotes) {
    throw new LocaleError(
      `Unknown locale "${tag}". Built in: ${knownLocales.join(", ")}. Add quotes for it in a locale override.`,
    );
  }
  return {
    quotes,
    quotesChosen: override.quotes !== undefined,
    dash: override.dash ?? lookup(dashes, full) ?? { kind: "report" },
    spacing: override.spacing ?? lookup(spacings, full) ?? noSpacing,
  };
}
