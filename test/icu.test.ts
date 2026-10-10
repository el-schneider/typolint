import { parse, type MessageFormatElement } from "@formatjs/icu-messageformat-parser";
import { describe, expect, test } from "vitest";
import { parseIcu } from "../src/icu.ts";
import { fix, IcuSyntaxError, lint } from "../src/index.ts";

const icu = { locale: "en", syntax: "icu", locales: { en: { dash: "—" } } } as const;

describe("ICU messages", () => {
  test.each([
    [
      "{count, plural, one {# message} other {# messages}} · {shell}",
      "{count, plural, one {# message} other {# messages}} · {shell}",
    ],
    [
      "{count, plural, one {You've # message} other {You've # messages}}",
      "{count, plural, one {You’ve # message} other {You’ve # messages}}",
    ],
    ["Don''t", "Don’t"],
    ["This is '{literal}' text", "This is '{literal}' text"],
    ["'{'name'}' isn't", "'{'name'}' isn’t"],
    [
      "{gender, select, female {She's here} other {They're here}}",
      "{gender, select, female {She’s here} other {They’re here}}",
    ],
    ['{n, plural, one {"#" item} other {"#" items}}', "{n, plural, one {“#” item} other {“#” items}}"],
    [
      '"{count, plural, one {# file} other {# files}}" deleted',
      "“{count, plural, one {# file} other {# files}}” deleted",
    ],
    ["I''m {n, plural, =0 {'#' none} other {#}}", "I’m {n, plural, =0 {'#' none} other {#}}"],
    [
      "{n, plural, offset:1 =0 {nobody} one {you and # other's} other {you and # others}}",
      "{n, plural, offset:1 =0 {nobody} one {you and # other’s} other {you and # others}}",
    ],
    ['<b>"Bold"</b> and <link>here</link>\'s', "<b>“Bold”</b> and <link>here</link>’s"],
    ["<icon/>'s menu", "<icon/>’s menu"],
    ["{when, date, short} - {when, time, ::HHmm}", "{when, date, short}—{when, time, ::HHmm}"],
    ["Wait...", "Wait…"],
  ])("%j", (input, output) => {
    expect(fix(input, icu).text).toBe(output);
    expect(fix(output, icu).text).toBe(output);
  });

  test("quotes balance per branch, not across branches", () => {
    const issues = lint('{n, plural, one {"one} other {two"}}', icu);
    expect(issues.map((i) => i.message)).toEqual(
      expect.arrayContaining([
        expect.stringMatching(/never closed/),
        expect.stringMatching(/has no opening/),
      ]),
    );
    expect(issues.every((i) => i.fix === undefined)).toBe(true);
  });

  test("a straight apostrophe that is ICU quoting is never reported", () => {
    expect(lint("'{'braces'}' and '<'tag'>'", icu)).toEqual([]);
  });

  test("syntax errors fail loudly", () => {
    expect(() => lint("{unclosed", icu)).toThrow(IcuSyntaxError);
    expect(() => lint("{n, plural, one {x}", icu)).toThrow(IcuSyntaxError);
  });

  test("plain syntax treats ICU text as placeholders and words", () => {
    expect(fix("{count, plural, one {You've}}", { locale: "en" }).text).toBe("{count, plural, one {You've}}");
  });
});

/**
 * Independent oracle: FormatJS's own parser. Our text pieces must lie inside its literal
 * elements, our argument atoms must be its argument elements, and our `#` atoms its pound elements.
 */
describe("segmentation agrees with @formatjs/icu-messageformat-parser", () => {
  const corpus = [
    "Hello {name}, you have {count, plural, one {# message} other {# messages}}.",
    "{count, plural, one {# message} other {# messages}} · {shell}",
    "It''s '{'braces'}' and {gender, select, male {He''s} female {She's} other {They're}}",
    "{n, selectordinal, one {#st} two {#nd} few {#rd} other {#th}} place",
    "{a, plural, one {{b, select, x {# in select} other {y}}} other {z}}",
    "Price: {p, number, ::currency/EUR} on {d, date, short}",
    "<b>Bold {name}</b> and <br/> then '<'not a tag'>'",
    "{n, plural, =0 {'#' none} other {# items}} 'quoted '' apostrophe'",
  ];

  type Range = readonly [number, number];
  const key = ([a, b]: Range) => `${a}-${b}`;

  function formatjsRanges(message: string) {
    const literals: Range[] = [];
    const args: Range[] = [];
    const pounds: Range[] = [];
    const walk = (elements: MessageFormatElement[]) => {
      for (const el of elements) {
        const range: Range = [el.location!.start.offset, el.location!.end.offset];
        if (el.type === 0) literals.push(range);
        else if (el.type === 7) pounds.push(range);
        else if (el.type === 8) walk(el.children);
        else args.push(range);
        if (el.type === 5 || el.type === 6)
          for (const option of Object.values(el.options)) walk(option.value);
      }
    };
    walk(parse(message, { captureLocation: true }));
    return { literals, args, pounds };
  }

  test.each(corpus)("%j", (message) => {
    const expected = formatjsRanges(message);
    const pieces = parseIcu(message, []).flat();
    const atoms = pieces.filter((p) => p.kind === "atom");
    const argAtoms = atoms.filter((p) => message[p.start] === "{").map((p): Range => [p.start, p.end]);
    const poundAtoms = atoms
      .filter((p) => message.slice(p.start, p.end) === "#")
      .map((p): Range => [p.start, p.end]);

    expect(argAtoms.map(key).toSorted()).toEqual(expected.args.map(key).toSorted());
    expect(poundAtoms.map(key).toSorted()).toEqual(expected.pounds.map(key).toSorted());

    for (const p of pieces) {
      if (p.kind === "atom") continue;
      expect(
        expected.literals.some(([a, b]) => a <= p.start && p.end <= b),
        `piece ${p.start}-${p.end}`,
      ).toBe(true);
    }
  });
});
