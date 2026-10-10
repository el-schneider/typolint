import { lint, type Issue, type Options } from "./lint.ts";

/** The part of Zod's `superRefine` context this helper uses. Zod 4's `RefinementCtx` satisfies it. */
export interface RefinementContext {
  addIssue(issue: { code: "custom"; message: string; path: (string | number)[]; input: unknown }): void;
}

export type RefinementOptions<T> = Omit<Options, "locale"> & {
  /** A locale tag, or a function that reads it from the parsed value. */
  readonly locale: string | ((value: T) => string);
};

function excerpt(text: string, issue: Issue): string {
  const from = Math.max(0, issue.start - 20);
  const to = Math.min(text.length, issue.end + 20);
  return `${from > 0 ? "…" : ""}${text.slice(from, to)}${to < text.length ? "…" : ""}`;
}

/**
 * For `schema.superRefine(...)`: lints every string in the value and reports each issue at its
 * data path, e.g. `subscribed.title`.
 */
export function typographyRefinement<T>(
  options: RefinementOptions<T>,
): (value: T, ctx: RefinementContext) => void {
  return (value, ctx) => {
    const locale = typeof options.locale === "function" ? options.locale(value) : options.locale;
    const visit = (node: unknown, path: (string | number)[]): void => {
      if (typeof node === "string") {
        for (const issue of lint(node, { ...options, locale })) {
          const fix = issue.fix === undefined ? "" : ` Fix: ${JSON.stringify(issue.fix)}.`;
          ctx.addIssue({
            code: "custom",
            message: `typography/${issue.code}: ${issue.message}${fix} In: ${JSON.stringify(excerpt(node, issue))}`,
            path,
            input: node,
          });
        }
      } else if (Array.isArray(node)) {
        node.forEach((item, index) => visit(item, [...path, index]));
      } else if (typeof node === "object" && node !== null) {
        for (const [key, item] of Object.entries(node)) visit(item, [...path, key]);
      }
    };
    visit(value, []);
  };
}
