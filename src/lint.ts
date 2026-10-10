import { parseIcu } from "./icu.ts";
import { resolveLocale, type LocaleOverride } from "./locale.ts";
import { icuProtect, parsePlain, plainProtect, type ProtectPattern, type Region } from "./markup.ts";
import { ruleIds, ruleOf, rules, WORD, type Finding, type IssueCode, type RuleId } from "./rules.ts";

/** `plain`: text with `{placeholders}` and `*emphasis*`. `icu`: ICU MessageFormat (FormatJS, react-intl). */
export type Syntax = "plain" | "icu";

export interface Options {
  /** BCP 47 tag, e.g. `de` or `en-GB`. */
  readonly locale: string;
  readonly syntax?: Syntax;
  /** Turn rules on or off. `dash-style` and `punctuation-space` are off by default. */
  readonly rules?: Readonly<Partial<Record<RuleId, boolean>>>;
  /** Per-locale changes to the CLDR quotes and built-in conventions, keyed by locale tag. */
  readonly locales?: Readonly<Record<string, LocaleOverride>>;
  /** Extra patterns never touched or flagged, added to the syntax defaults (`plainProtect` or `icuProtect`). */
  readonly protect?: readonly ProtectPattern[];
}

export interface Issue {
  /** Stable kind of issue, e.g. `quotes/unclosed`. Match on this, not on `message`. */
  readonly code: IssueCode;
  /** The rule that reported it, the part of `code` before the slash. */
  readonly rule: RuleId;
  /** UTF-16 offsets into the linted string. `start === end` marks an insertion point. */
  readonly start: number;
  readonly end: number;
  readonly message: string;
  /** Replacement for `[start, end)`. Present only when the correction is certain. */
  readonly fix?: string;
}

const defaultRules: Readonly<Record<RuleId, boolean>> = {
  apostrophe: true,
  quotes: true,
  ellipsis: true,
  dash: true,
  "dash-style": false,
  "double-space": true,
  "punctuation-space": false,
};

interface Unit {
  readonly start: number;
  readonly end: number;
  readonly atom: boolean;
}

/** The text rules read for one region, with the source range behind each character. */
function project(source: string, region: Region): { text: string; units: Unit[] } {
  let text = "";
  const units: Unit[] = [];
  for (const piece of region) {
    if (piece.kind === "text") {
      text += source.slice(piece.start, piece.end);
      for (let i = piece.start; i < piece.end; i++) units.push({ start: i, end: i + 1, atom: false });
    } else if (piece.kind === "escape") {
      text += piece.char;
      units.push({ start: piece.start, end: piece.end, atom: false });
    } else if (piece.role === "word") {
      text += WORD;
      units.push({ start: piece.start, end: piece.end, atom: true });
    }
  }
  return { text, units };
}

/** Maps a finding back to source offsets. The fix survives only if it replaces plain, contiguous text. */
function toIssue(finding: Finding, units: readonly Unit[]): Issue {
  const { code, from, to, message, fix: replacement } = finding;
  const rule = ruleOf(code);
  const withFix = (ok: boolean) => (replacement !== undefined && ok ? { fix: replacement } : {});
  if (from === to) {
    const at = units[from]?.start ?? units.at(-1)?.end ?? 0;
    return { code, rule, start: at, end: at, message, ...withFix(true) };
  }
  const covered = units.slice(from, to);
  const start = covered[0]!.start;
  const end = covered.at(-1)!.end;
  const plain = covered.every((u, k) => !u.atom && (k === 0 || covered[k - 1]!.end === u.start));
  return { code, rule, start, end, message, ...withFix(plain) };
}

export function lint(source: string, options: Options): Issue[] {
  const locale = resolveLocale(options.locale, options.locales);
  const enabled = { ...defaultRules, ...options.rules };
  const regions =
    options.syntax === "icu"
      ? parseIcu(source, [...icuProtect, ...(options.protect ?? [])])
      : parsePlain(source, [...plainProtect, ...(options.protect ?? [])]);

  const issues: Issue[] = [];
  for (const region of regions) {
    const { text, units } = project(source, region);
    for (const id of ruleIds) {
      if (!enabled[id]) continue;
      for (const finding of rules[id](text, locale)) issues.push(toIssue(finding, units));
    }
  }
  return issues.toSorted((a, b) => a.start - b.start || a.end - b.end);
}

export type FixableIssue = Issue & { readonly fix: string };

/** Fixable issues that do not overlap, in order. Issues must be sorted as `lint` returns them. */
export function selectEdits(issues: readonly Issue[]): FixableIssue[] {
  const edits: FixableIssue[] = [];
  for (const issue of issues) {
    const last = edits.at(-1);
    if (issue.fix !== undefined && (last === undefined || issue.start >= last.end)) {
      edits.push({ ...issue, fix: issue.fix });
    }
  }
  return edits;
}

/** Applies every certain fix, then re-lints until nothing changes. Returns the text and what is left. */
export function fix(source: string, options: Options): { text: string; issues: Issue[] } {
  let text = source;
  for (let pass = 0; pass < 10; pass++) {
    const issues = lint(text, options);
    const edits = selectEdits(issues);
    if (edits.length === 0) return { text, issues };
    for (const edit of edits.toReversed()) text = text.slice(0, edit.start) + edit.fix + text.slice(edit.end);
  }
  throw new Error(`Fixes did not settle after 10 passes: ${JSON.stringify(source)}`);
}
