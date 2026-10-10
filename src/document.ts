import { lint, selectEdits, type Issue, type Options } from "./lint.ts";

/**
 * A data file (JSON, YAML) seen as a list of string values with the source characters behind
 * each value character, so fixes edit the file in place without reformatting it.
 */
export type DataPath = readonly (string | number)[];

/** Source characters `[start, end)` that decode to `value`. `fold` marks line folding a fix must not replace. */
export interface SourceUnit {
  readonly start: number;
  readonly end: number;
  readonly value: string;
  readonly fold: boolean;
}

export interface StringLeaf {
  readonly path: DataPath;
  readonly value: string;
  /** Offset of the scalar in the source, used for positions when `units` is absent. */
  readonly start: number;
  /** Absent when this scalar style cannot be mapped back to source; it is linted but never edited. */
  readonly units: readonly SourceUnit[] | undefined;
}

export type Extract = (source: string) => StringLeaf[];

/** Returns `units` if they decode to `value`, so a wrong mapping can never produce an edit. */
export function checkedUnits(units: SourceUnit[], value: string): SourceUnit[] | undefined {
  return units.map((u) => u.value).join("") === value ? units : undefined;
}

/** Source offset of a value offset; the scalar start when the leaf is not mapped. */
export function sourceOffset(leaf: StringLeaf, offset: number): number {
  if (!leaf.units) return leaf.start;
  let at = 0;
  for (const unit of leaf.units) {
    if (at + unit.value.length > offset) return unit.start;
    at += unit.value.length;
  }
  return leaf.units.at(-1)?.end ?? leaf.start;
}

/** Source range for value range `[from, to)`, if it starts and ends on unit edges and replaces no line folding. */
function sourceRange(units: readonly SourceUnit[], from: number, to: number): [number, number] | undefined {
  let at = 0;
  let start: number | undefined;
  for (const unit of units) {
    const next = at + unit.value.length;
    if (start === undefined && at === from && (from === to || unit.value.length > 0)) {
      if (from === to) return [unit.start, unit.start];
      start = unit.start;
    }
    if (start !== undefined) {
      if (unit.fold) return undefined;
      if (next === to) return [start, unit.end];
      if (next > to) return undefined;
    }
    at = next;
  }
  if (from === to && from === at) {
    const end = units.at(-1)?.end;
    return end === undefined ? undefined : [end, end];
  }
  return undefined;
}

export interface LeafIssue extends Issue {
  readonly path: DataPath;
  /** Source offset in the file. */
  readonly offset: number;
}

export function lintDocument(source: string, extract: Extract, options: Options): LeafIssue[] {
  return extract(source).flatMap((leaf) =>
    lint(leaf.value, options).map((issue) => ({
      ...issue,
      path: leaf.path,
      offset: sourceOffset(leaf, issue.start),
    })),
  );
}

const pathKey = (path: DataPath) => JSON.stringify(path);

/**
 * Applies certain fixes in place, one pass at a time, until nothing changes. After each pass it
 * re-reads the file and checks that every edited value decodes to what the core fix produced.
 */
export function fixDocument(source: string, extract: Extract, options: Options): string {
  let text = source;
  for (let pass = 0; pass < 10; pass++) {
    const edits: { start: number; end: number; replacement: string }[] = [];
    const expected = new Map<string, string>();
    for (const leaf of extract(text)) {
      if (!leaf.units) continue;
      let value = leaf.value;
      for (const issue of selectEdits(lint(leaf.value, options)).toReversed()) {
        const range = sourceRange(leaf.units, issue.start, issue.end);
        if (!range) continue;
        edits.push({ start: range[0], end: range[1], replacement: issue.fix });
        value = value.slice(0, issue.start) + issue.fix + value.slice(issue.end);
      }
      if (value !== leaf.value) expected.set(pathKey(leaf.path), value);
    }
    if (edits.length === 0) return text;

    for (const edit of edits.toSorted((a, b) => b.start - a.start || b.end - a.end)) {
      text = text.slice(0, edit.start) + edit.replacement + text.slice(edit.end);
    }
    for (const leaf of extract(text)) {
      const want = expected.get(pathKey(leaf.path));
      if (want !== undefined && want !== leaf.value) {
        throw new Error(
          `In-place fix at ${pathKey(leaf.path)} decoded to ${JSON.stringify(leaf.value)}, expected ${JSON.stringify(want)}. File left unchanged.`,
        );
      }
    }
  }
  throw new Error("Fixes did not settle after 10 passes.");
}

/** Every string value in a JSON document. Object keys are not linted. */
export const extractJson: Extract = (source) => {
  JSON.parse(source); // fail loud on invalid JSON before the scanner trusts its shape
  const leaves: StringLeaf[] = [];
  let pos = 0;
  const skipSpace = () => {
    while (/\s/u.test(source[pos] ?? "")) pos++;
  };

  const string = (): { value: string; units: SourceUnit[] } => {
    const units: SourceUnit[] = [];
    pos++; // opening quote
    while (source[pos] !== '"') {
      const start = pos;
      let value: string;
      if (source[pos] === "\\") {
        const esc = source[pos + 1]!;
        if (esc === "u") {
          value = String.fromCharCode(Number.parseInt(source.slice(pos + 2, pos + 6), 16));
          pos += 6;
        } else {
          value = ({ b: "\b", f: "\f", n: "\n", r: "\r", t: "\t" } as Record<string, string>)[esc] ?? esc;
          pos += 2;
        }
      } else {
        value = source[pos]!;
        pos++;
      }
      units.push({ start, end: pos, value, fold: false });
    }
    pos++; // closing quote
    return { value: units.map((u) => u.value).join(""), units };
  };

  const value = (path: DataPath): void => {
    skipSpace();
    const c = source[pos];
    if (c === "{" || c === "[") {
      const close = c === "{" ? "}" : "]";
      pos++;
      for (let index = 0; ; index++) {
        skipSpace();
        if (source[pos] === close) break;
        let key: string | number = index;
        if (close === "}") {
          key = string().value;
          skipSpace();
          pos++; // colon
        }
        value([...path, key]);
        skipSpace();
        if (source[pos] === ",") pos++;
      }
      pos++;
    } else if (c === '"') {
      const start = pos;
      const s = string();
      leaves.push({ path, value: s.value, start, units: s.units });
    } else {
      while (pos < source.length && !/[\s,\]}]/u.test(source[pos]!)) pos++;
    }
  };

  value([]);
  return leaves;
};
