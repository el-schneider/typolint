import { describe, expect, test } from "vitest";
import { fix, lint, parseConfig, type Options } from "../src/index.ts";

const NNBSP = "\u202F";
const HAIR = "\u200A";
const THIN = "\u2009";

const fixed = (text: string, options: Options) => fix(text, options).text;

describe("punctuation-space with a configured spacing table", () => {
  const hair = {
    locale: "de",
    ...parseConfig({
      rules: { "punctuation-space": true },
      locales: { de: { spacing: { before: { "!?": "hair" } } } },
    }),
  };

  test.each([
    ["Wirklich?", `Wirklich${HAIR}?`],
    ["Wirklich?!", `Wirklich${HAIR}?!`],
    ["Wirklich !", `Wirklich${HAIR}!`],
    [`Wirklich${THIN}!`, `Wirklich${HAIR}!`],
    ["Hinweis: gut", "Hinweis: gut"],
    ["https://x.de/?q=1", "https://x.de/?q=1"],
    ["?", "?"],
  ])("%j", (input, output) => {
    expect(fixed(input, hair)).toBe(output);
    expect(fixed(output, hair)).toBe(output);
  });

  test("reports which space is missing and which is wrong", () => {
    expect(lint("Ja? Nein !", hair).map((i) => i.code)).toEqual([
      "punctuation-space/missing",
      "punctuation-space/wrong-space",
    ]);
  });

  test("French defaults: narrow no-break space before ; : ! ? and inside guillemets", () => {
    const fr = { locale: "fr", rules: { "punctuation-space": true } } as const;
    expect(fixed("« Oui » ; non !", fr)).toBe(`«${NNBSP}Oui${NNBSP}»${NNBSP}; non${NNBSP}!`);
  });

  test("a locale override can turn French spacing off", () => {
    const options = { locale: "fr", ...parseConfig({ preset: "strict", locales: { fr: { spacing: {} } } }) };
    expect(fixed("Oui ?", options)).toBe("Oui ?");
  });

  test("locales without a spacing table get no spaces, even with the rule on", () => {
    expect(fixed("Wirklich?", { locale: "de", rules: { "punctuation-space": true } })).toBe("Wirklich?");
  });

  test.each([
    [
      { locales: { de: { spacing: { before: { "!?": "hairline" } } } } },
      /spacing\.before\.!\?: expected one of narrow-nbsp, nbsp, thin, hair/,
    ],
    [{ locales: { de: { spacing: { before: { a: "hair" } } } } }, /"a" is not a punctuation mark/],
    [{ locales: { de: { spacing: { inside: "hair" } } } }, /spacing: unknown key inside/],
    [{ locales: { fr: { frenchSpacing: true } } }, /unknown key frenchSpacing/],
  ])("rejects %j", (raw, message) => {
    expect(() => parseConfig(raw)).toThrow(message);
  });
});

describe("presets", () => {
  const text = "Gut — wirklich. « Oui » ?";

  test("recommended is the default and leaves house-style rules off", () => {
    expect(parseConfig({})).toEqual({});
    expect(fixed(text, { locale: "de", ...parseConfig({ preset: "recommended" }) })).toBe(text);
  });

  test("strict turns on every opt-in rule", () => {
    expect(fixed("Gut — wirklich", { locale: "de", ...parseConfig({ preset: "strict" }) })).toBe(
      "Gut – wirklich",
    );
    expect(fixed("Oui ?", { locale: "fr", ...parseConfig({ preset: "strict" }) })).toBe(`Oui${NNBSP}?`);
  });

  test("a config's own rules apply on top of the preset", () => {
    const options = { locale: "de", ...parseConfig({ preset: "strict", rules: { "dash-style": false } }) };
    expect(fixed("Gut — wirklich", options)).toBe("Gut — wirklich");
  });

  test("an unknown preset is an error", () => {
    expect(() => parseConfig({ preset: "pint" })).toThrow(/preset: expected one of recommended, strict/);
  });
});
