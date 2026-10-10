import { describe, expect, test } from "vitest";
import { fix, lint, type Options, type RuleId } from "../src/index.ts";

type Case = readonly [input: string, output: string, left?: readonly RuleId[]];

/** Fixes `input`, expects `output` and the rules of the issues left for a human; then checks idempotence. */
function check(options: Options, [input, output, left = []]: Case) {
  const result = fix(input, options);
  expect(result.text).toBe(output);
  expect(result.issues.map((i) => i.rule)).toEqual(left);
  expect(fix(result.text, options).text).toBe(result.text);
}

const table = (options: Options, cases: readonly Case[]) =>
  test.each(cases.map((c) => [c[0], c]))("%j", (_, c) => check(options, c));

const NNBSP = "\u202F";
const NBSP = "\u00A0";

describe("en", () => {
  describe("apostrophe", () => {
    table({ locale: "en" }, [
      ["You're on the list.", "You’re on the list."],
      ["We'll write once.", "We’ll write once."],
      ["{name}'s AI", "{name}’s AI"],
      ["Katie's and Erin's houses", "Katie’s and Erin’s houses"],
      ["the '90s", "the ’90s"],
      ["the ‘90s", "the ’90s"],
      ["rock 'n' roll", "rock ’n’ roll"],
      ["don´t and don`t", "don’t and don’t"],
      ["'tis the season", "'tis the season", ["apostrophe"]],
      ["tables' legs", "tables' legs", ["apostrophe"]],
      ["summer of '69", "summer of '69", ["apostrophe"]],
      ["Already right: you’re, ’90s, rock ’n’ roll", "Already right: you’re, ’90s, rock ’n’ roll"],
    ]);
  });

  describe("quotes", () => {
    table({ locale: "en" }, [
      [
        'One of the most famous phrases is "to be or not to be".',
        "One of the most famous phrases is “to be or not to be”.",
      ],
      [
        '"I have no special talent," Einstein. "I am only curious enough."',
        "“I have no special talent,” Einstein. “I am only curious enough.”",
      ],
      [
        '"I was reading "The Economics of the USA" yesterday," she replied to me.',
        "“I was reading ‘The Economics of the USA’ yesterday,” she replied to me.",
      ],
      ['"Hello"', "“Hello”"],
      ['("Hello")', "(“Hello”)"],
      ['"Hello"!', "“Hello”!"],
      ['"…"', "“…”"],
      ['*"Hello"* she said', "*“Hello”* she said"],
      ['"*Hello*" she said', "“*Hello*” she said"],
      ['"{name}" is here', "“{name}” is here"],
      ['"Line one\nline two" and you\'re', "“Line one\nline two” and you’re"],
      [
        "“Put all kindergarten mail in one place.” {name} writes",
        "“Put all kindergarten mail in one place.” {name} writes",
      ],
      ["“She said ‘no’ twice.”", "“She said ‘no’ twice.”"],
      ['He said "hi', 'He said "hi', ["quotes"]],
      ['a 12" screen', 'a 12" screen', ["quotes"]],
      ['say " hi', 'say " hi', ["quotes"]],
      // Single quotes at the top level may be house style (UK); reported, not rewritten.
      ["‘Hello,’ she said", "‘Hello,’ she said", ["quotes", "quotes"]],
      // One unbalanced quote blocks every quote fix in the string: the pairing is uncertain.
      ['"a" and "b', '"a" and "b', ["quotes", "quotes", "quotes"]],
    ]);
  });

  describe("ellipsis", () => {
    table({ locale: "en" }, [
      ["Wait... what", "Wait… what"],
      ["The ... fox jumped ...", "The … fox jumped …"],
      ["...\n...", "…\n…"],
      ["m...?", "m…?"],
      ["..", ".."],
      [".....", "....."],
      ["k....", "k...."],
    ]);
  });

  describe("dash", () => {
    table({ locale: "en", locales: { en: { dash: "—" } } }, [
      ["yes - no", "yes—no"],
      ["well -- maybe", "well—maybe"],
      ["5 - 3", "5 - 3", ["dash"]],
      ["e-mail, well-known", "e-mail, well-known"],
      ["- list item", "- list item"],
      ["#82 — Über das Weglassen", "#82 — Über das Weglassen"],
    ]);
  });

  describe("double space", () => {
    table({ locale: "en" }, [
      ["one  two   three", "one two three"],
      ["line one\n  indented", "line one\n  indented"],
      ["trailing  ", "trailing  "],
    ]);
  });

  describe("protected markup", () => {
    table({ locale: "en" }, [
      ["See https://example.com/it's-a-path...", "See https://example.com/it's-a-path…"],
      ["Mail you'd@example.com", "Mail you'd@example.com"],
      ["Write to 'a@b.com' now", "Write to 'a@b.com' now", ["apostrophe", "apostrophe"]],
      ['Run `don\'t "quote"` now', 'Run `don\'t "quote"` now'],
      ["{it's} stays", "{it's} stays"],
    ]);
  });

  test("fixes never touch protected spans, even in issues that span them", () => {
    const issues = lint("say *-* - x", { locale: "en" });
    for (const issue of issues)
      expect(issue.fix === undefined || !"say *-* - x".slice(issue.start, issue.end).includes("*")).toBe(
        true,
      );
  });
});

describe("hyphen next to a line break", () => {
  table({ locale: "de" }, [
    ["Text -\nmehr", "Text –\nmehr"],
    ["Text\n- mehr", "Text\n– mehr"],
  ]);
  // Closed em dash would need the line break removed; that is a human decision.
  table({ locale: "en" }, [["Text -\nmore", "Text -\nmore", ["dash"]]]);
});

describe("dash-style (opt-in)", () => {
  const on = { rules: { "dash-style": true } } as const;
  describe("de: spaced en dash", () => {
    table({ locale: "de", ...on }, [
      ["Gut — wirklich", "Gut – wirklich"],
      ["Gut—wirklich", "Gut – wirklich"],
      ["Gut – wirklich", "Gut – wirklich"],
      ["Berlin–Hamburg", "Berlin–Hamburg"],
      ["Seiten 3 — 5", "Seiten 3 — 5"],
      ["Ein– und Ausgang", "Ein– und Ausgang"],
      ["Gut - wirklich — ja", "Gut – wirklich – ja"],
    ]);
  });
  describe("en: closed em dash", () => {
    table({ locale: "en", ...on, locales: { en: { dash: "—" } } }, [
      ["good – really", "good—really"],
      ["good — really", "good—really"],
      ["pages 3–5", "pages 3–5"],
    ]);
  });
  test("follows the configured dash", () =>
    check({ locale: "en", ...on, locales: { en: { dash: " — " } } }, ["good—really", "good — really"]));
  test("is silent where the locale has no fixed dash", () =>
    check({ locale: "es", ...on }, ["sí — no", "sí — no"]));
  test("is off by default", () => check({ locale: "de" }, ["Gut — wirklich", "Gut — wirklich"]));
});

describe("English dash", () => {
  // Chicago, AP and British usage disagree, so English has no default dash.
  table({ locale: "en" }, [["yes - no", "yes - no", ["dash"]]]);
  table({ locale: "en-GB" }, [["yes - no", "yes - no", ["dash"]]]);
  table({ locale: "en-GB", locales: { "en-GB": { dash: " – " } } }, [["yes - no", "yes – no"]]);
});

describe("chosen quotes", () => {
  table({ locale: "de", locales: { de: { quotes: "„“‚‘" } } }, [
    ["“Englisch” zitiert", "„Englisch“ zitiert"],
    ["»Hallo«", "„Hallo“"],
  ]);
});

describe("de", () => {
  table({ locale: "de" }, [
    ["Andrea‘s Café", "Andrea’s Café"],
    ["Andrea's Café", "Andrea’s Café"],
    [
      'Dies habe, so Meyer, "nichts mit "Globalisierung" zu tun".',
      "Dies habe, so Meyer, „nichts mit ‚Globalisierung‘ zu tun“.",
    ],
    // Another typographic style may be house style: reported, fixed only once the user chooses quotes.
    ["“Englisch” zitiert", "“Englisch” zitiert", ["quotes", "quotes"]],
    ["»Hallo«", "»Hallo«", ["quotes", "quotes"]],
    // A wrong closer next to a correct opener is a typo, not a style.
    ["„Hallo”, sagte sie.", "„Hallo“, sagte sie."],
    ["„Hallo“, sagte sie.", "„Hallo“, sagte sie."],
    ["Er sagte: „Sie nannte es ‚Kunst‘.“", "Er sagte: „Sie nannte es ‚Kunst‘.“"],
    ["„Leg alle Mails an einen Ort.“ {name} schreibt", "„Leg alle Mails an einen Ort.“ {name} schreibt"],
    ["*„Kluge E-Mail“*, sagt er", "*„Kluge E-Mail“*, sagt er"],
    ["Ja - nein", "Ja – nein"],
    ["Frag nach {name} oder spring zu …", "Frag nach {name} oder spring zu …"],
    ["Das ist Jens‘ Buch", "Das ist Jens‘ Buch", ["quotes"]],
    ["‚Hallo‘ allein", "‚Hallo‘ allein", ["quotes", "quotes"]],
  ]);
});

describe("fr", () => {
  describe("punctuation-space on", () => {
    table({ locale: "fr", rules: { "punctuation-space": true } }, [
      ['Il appelle cela "une erreur".', `Il appelle cela «${NNBSP}une erreur${NNBSP}».`],
      ['"Oui", répondit-il.', `«${NNBSP}Oui${NNBSP}», répondit-il.`],
      [`satisfaits «${NBSP}de leur vie${NBSP}»`, `satisfaits «${NNBSP}de leur vie${NNBSP}»`],
      ['Il a répondu : "Je viendrai demain."', `Il a répondu${NNBSP}: «${NNBSP}Je viendrai demain.${NNBSP}»`],
      ["Quoi?", `Quoi${NNBSP}?`],
      ["Quoi ?", `Quoi${NNBSP}?`],
      ["Vraiment ?!", `Vraiment${NNBSP}?!`],
      ["À 12:30 ici", "À 12:30 ici"],
      ["l'homme, aujourd'hui", "l’homme, aujourd’hui"],
    ]);
  });
  describe("punctuation-space off (default)", () => {
    table({ locale: "fr" }, [['"Oui", dit-il ?', "«Oui», dit-il ?"]]);
  });
});

describe("other locales", () => {
  test.each([
    ["pl", 'że "tak naprawdę nie dzieje się nic"?', "że „tak naprawdę nie dzieje się nic”?"],
    ["fi", '"Varautuminen on heikkoa." ', "”Varautuminen on heikkoa.” "],
    ["sv", '"Hej", sa hon.', "”Hej”, sa hon."],
    ["nl", '"Hallo"', "‘Hallo’"],
    ["nl", "’s avonds", "’s avonds"],
    ["it", '"Ciao"', "«Ciao»"],
    ["cs", '"Ahoj"', "„Ahoj“"],
    ["da", '"Hej" - sagde hun', "“Hej” – sagde hun"],
    ["pt", '"Olá"', "“Olá”"],
    ["tr", "İstanbul'da", "İstanbul’da"],
    ["de-AT", '"Servus"', "„Servus“"],
  ])("%s %j", (locale, input, output) => check({ locale }, [input, output]));

  test.each(["es", "pt", "fr", "it", "tr"])("%s reports a hyphen dash without a fix", (locale) =>
    check({ locale }, ["sí - no", "sí - no", ["dash"]]),
  );
});

describe("options", () => {
  test("locale override replaces CLDR quotes", () =>
    check({ locale: "es", locales: { es: { quotes: "«»“”" } } }, ['"Hola"', "«Hola»"]));

  test("rules can be turned off", () =>
    check({ locale: "en", rules: { dash: false } }, ["yes - no", "yes - no"]));

  test("custom protect patterns", () =>
    check(
      {
        locale: "en",
        protect: [{ name: "html", pattern: /<[^>]+>/u, role: "transparent" }],
      },
      ['Click <a href="https://x.y">"here"</a>', 'Click <a href="https://x.y">“here”</a>'],
    ));

  test("unknown locale fails loudly", () => {
    expect(() => lint("x", { locale: "xx" })).toThrow(/Unknown locale "xx"/);
  });

  test("issues carry exact offsets", () => {
    const text = "He's {name}'s";
    const issues = lint(text, { locale: "en" });
    expect(issues).toMatchObject([
      { code: "apostrophe/wrong-glyph", rule: "apostrophe", start: 2, end: 3, fix: "’" },
      { code: "apostrophe/wrong-glyph", rule: "apostrophe", start: 11, end: 12, fix: "’" },
    ]);
  });
});
