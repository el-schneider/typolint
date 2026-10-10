import { describe, expect, test } from "vitest";
import { extractJson, fixDocument, lintDocument } from "../src/document.ts";
import { extractYaml } from "../src/yaml.ts";

const en = { locale: "en", locales: { en: { dash: "—" } } } as const;

describe("YAML in place", () => {
  test("fixes string values and keeps comments, quoting styles and layout", () => {
    const source = [
      "# comment stays: don't touch",
      "title: You're here   # trailing comment",
      "single: 'It''s fine'",
      'double: "Say \\"hi\\" now..."',
      "folded: This line",
      "  continues - and here",
      "block: |",
      "  Line one's",
      '  "Quoted"',
      "flow: { a: Don't, b: \"Can't\" }",
      "list: [Won't, 3, true]",
      "count: 3",
      "",
    ].join("\n");
    const expected = [
      "# comment stays: don't touch",
      "title: You’re here   # trailing comment",
      "single: 'It’s fine'",
      'double: "Say “hi” now…"',
      "folded: This line",
      "  continues—and here",
      "block: |",
      "  Line one’s",
      "  “Quoted”",
      'flow: { a: Don’t, b: "Can’t" }',
      "list: [Won’t, 3, true]",
      "count: 3",
      "",
    ].join("\n");
    expect(fixDocument(source, extractYaml, en)).toBe(expected);
    expect(lintDocument(expected, extractYaml, en)).toEqual([]);
  });

  test("a fix that would rewrite a line break is reported, not applied", () => {
    const source = "a: one\n  - two\n";
    expect(extractYaml(source)[0]!.value).toBe("one - two");
    expect(fixDocument(source, extractYaml, en)).toBe(source);
    expect(lintDocument(source, extractYaml, en)).toMatchObject([{ rule: "dash", path: ["a"], fix: "—" }]);
  });

  test("issues carry data path and file offset", () => {
    const source = "faq:\n  items:\n    - q: Who's there?\n";
    expect(lintDocument(source, extractYaml, en)).toMatchObject([
      { rule: "apostrophe", path: ["faq", "items", 0, "q"], offset: source.indexOf("'") },
    ]);
  });

  test("invalid YAML fails loudly", () => {
    expect(() => extractYaml("a: [unclosed\n")).toThrow(/end with a \]/);
  });
});

describe("JSON in place", () => {
  test("fixes string values through escapes and keeps formatting", () => {
    const source = '{\n  "a": "You\'re",\n  "b": ["say \\"hi\\"", 3],\n  "c": {"d": "it\\u0027s"}\n}\n';
    const expected = '{\n  "a": "You’re",\n  "b": ["say “hi”", 3],\n  "c": {"d": "it’s"}\n}\n';
    expect(fixDocument(source, extractJson, en)).toBe(expected);
    expect(JSON.parse(expected)).toEqual({ a: "You’re", b: ["say “hi”", 3], c: { d: "it’s" } });
  });

  test("keys are not linted; paths use them", () => {
    expect(lintDocument('{"it\'s": "it\'s"}', extractJson, en)).toMatchObject([
      { path: ["it's"], offset: 12 },
    ]);
  });

  test("invalid JSON fails loudly", () => {
    expect(() => extractJson('{"a": }')).toThrow(SyntaxError);
  });
});
