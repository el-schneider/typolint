import { isMap, isScalar, isSeq, parseDocument, type Node, type Scalar } from "yaml";
import { checkedUnits, type DataPath, type Extract, type SourceUnit, type StringLeaf } from "./document.ts";

const escapes: Readonly<Record<string, string>> = {
  "0": "\0",
  a: "\x07",
  b: "\b",
  t: "\t",
  "\t": "\t",
  n: "\n",
  v: "\v",
  f: "\f",
  r: "\r",
  e: "\x1B",
  " ": " ",
  '"': '"',
  "/": "/",
  "\\": "\\",
  N: "\x85",
  _: "\xA0",
  L: "\u2028",
  P: "\u2029",
};
const hexLength: Readonly<Record<string, number>> = { x: 2, u: 4, U: 8 };

/** Plain, single- and double-quoted scalars: escapes and line folding. */
function flowUnits(source: string, start: number, end: number, style: Scalar.Type): SourceUnit[] {
  const units: SourceUnit[] = [];
  const quoted = style !== "PLAIN";
  let pos = quoted ? start + 1 : start;
  const stop = quoted ? end - 1 : end;
  const push = (from: number, value: string, fold = false) =>
    units.push({ start: from, end: pos, value, fold });

  while (pos < stop) {
    const from = pos;
    const c = source[pos]!;
    if (/[ \t\r\n]/.test(c)) {
      while (pos < stop && /[ \t\r\n]/.test(source[pos]!)) pos++;
      const breaks = (source.slice(from, pos).match(/\n/g) ?? []).length;
      if (breaks === 0)
        for (let i = from; i < pos; i++) units.push({ start: i, end: i + 1, value: source[i]!, fold: false });
      else push(from, breaks === 1 ? " " : "\n".repeat(breaks - 1), true);
    } else if (style === "QUOTE_SINGLE" && c === "'") {
      pos += 2;
      push(from, "'");
    } else if (style === "QUOTE_DOUBLE" && c === "\\") {
      const esc = source[pos + 1]!;
      if (esc === "\n" || esc === "\r") {
        pos += 2;
        while (pos < stop && /[ \t\r\n]/.test(source[pos]!)) pos++;
        push(from, "", true);
      } else if (esc in hexLength) {
        const digits = hexLength[esc]!;
        pos += 2 + digits;
        push(from, String.fromCodePoint(Number.parseInt(source.slice(from + 2, pos), 16)));
      } else {
        pos += 2;
        push(from, escapes[esc] ?? esc);
      }
    } else {
      pos++;
      push(from, c);
    }
  }
  return units;
}

/** Literal (`|`) and folded (`>`) block scalars with clip, strip and keep chomping. */
function blockUnits(source: string, start: number, end: number, style: Scalar.Type): SourceUnit[] {
  const headerEnd = source.indexOf("\n", start) + 1;
  const header = source.slice(start, headerEnd);
  const chomp = header.includes("-") ? "strip" : header.includes("+") ? "keep" : "clip";
  const lines: { start: number; end: number }[] = [];
  for (let at = headerEnd; at < end;) {
    const lineEnd = source.indexOf("\n", at);
    const stop = lineEnd === -1 || lineEnd > end ? end : lineEnd;
    lines.push({ start: at, end: stop });
    at = stop + 1;
  }
  const firstContent = lines.find((l) => source.slice(l.start, l.end).trim() !== "");
  const indentDigit = /\d/.exec(header)?.[0];
  const indent = indentDigit
    ? Number(indentDigit)
    : firstContent
      ? /^ */.exec(source.slice(firstContent.start, firstContent.end))![0].length
      : 0;

  const units: SourceUnit[] = [];
  let pendingBreaks: { start: number; end: number }[] = [];
  let previousMoreIndented = true;
  for (const line of lines) {
    const content = { start: Math.min(line.start + indent, line.end), end: line.end };
    const text = source.slice(content.start, content.end);
    const breakAfter = { start: line.end, end: Math.min(line.end + 1, end) };
    if (text === "") {
      pendingBreaks.push(breakAfter);
      continue;
    }
    const moreIndented = /^[ \t]/.test(text);
    if (units.length > 0) {
      const [first, ...rest] = pendingBreaks;
      const foldToSpace =
        style === "BLOCK_FOLDED" && rest.length === 0 && !moreIndented && !previousMoreIndented;
      const span = { start: first!.start, end: pendingBreaks.at(-1)!.end };
      const value = foldToSpace
        ? " "
        : "\n".repeat(
            style === "BLOCK_FOLDED" && !moreIndented && !previousMoreIndented
              ? rest.length
              : pendingBreaks.length,
          );
      units.push({ ...span, value, fold: true });
    }
    for (let i = content.start; i < content.end; i++)
      units.push({ start: i, end: i + 1, value: source[i]!, fold: false });
    pendingBreaks = [breakAfter];
    previousMoreIndented = moreIndented;
  }
  if (chomp !== "strip" && pendingBreaks.length > 0 && pendingBreaks[0]!.end > pendingBreaks[0]!.start) {
    const kept = chomp === "keep" ? pendingBreaks : pendingBreaks.slice(0, 1);
    units.push({ start: kept[0]!.start, end: kept.at(-1)!.end, value: "\n".repeat(kept.length), fold: true });
  }
  return units;
}

function scalarUnits(source: string, node: Scalar<string>): SourceUnit[] | undefined {
  const [start, end] = node.range!;
  const style = node.type ?? "PLAIN";
  const units = style.startsWith("BLOCK")
    ? blockUnits(source, start, end, style)
    : flowUnits(source, start, end, style);
  return checkedUnits(units, node.value);
}

/** Every string value in a YAML document. Keys, comments and layout are left alone. */
export const extractYaml: Extract = (source) => {
  const doc = parseDocument(source);
  if (doc.errors.length > 0) throw new Error(doc.errors.map((e) => e.message).join("\n"));
  const leaves: StringLeaf[] = [];
  const walk = (node: Node | null | undefined, path: DataPath): void => {
    if (isMap(node)) {
      for (const pair of node.items) {
        const key = isScalar(pair.key) ? String(pair.key.value) : String(pair.key);
        walk(pair.value as Node | null, [...path, key]);
      }
    } else if (isSeq(node)) {
      node.items.forEach((item, index) => walk(item as Node | null, [...path, index]));
    } else if (isScalar(node) && typeof node.value === "string" && node.range) {
      const scalar = node as Scalar<string>;
      leaves.push({ path, value: scalar.value, start: node.range[0], units: scalarUnits(source, scalar) });
    }
  };
  walk(doc.contents, []);
  return leaves;
};
