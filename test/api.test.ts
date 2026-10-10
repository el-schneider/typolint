import { spawnSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, test } from "vitest";
import * as api from "../src/index.ts";
import { ConfigError, fix, IcuSyntaxError, lint, LocaleError, parseConfig } from "../src/index.ts";

describe("locale tags", () => {
  test.each([
    ["en-gb", "yes – no"],
    ["EN-GB", "yes – no"],
    ["en_GB", "yes – no"],
    ["EN", "yes—no"],
  ])("%s is read case-insensitively", (locale, output) => {
    const locales = { en: { dash: "—" }, "en-GB": { dash: " – " } };
    expect(fix("yes - no", { locale, locales }).text).toBe(output);
  });

  test("override keys are canonical too", () => {
    expect(fix('"Grüezi"', { locale: "de-CH", locales: { "de-ch": { quotes: "«»‹›" } } }).text).toBe(
      "«Grüezi»",
    );
  });

  test("two keys for the same locale are an error", () => {
    expect(() => parseConfig({ locales: { "de-CH": { dash: "—" }, "de-ch": { dash: "–" } } })).toThrow(
      /"de-CH" and "de-ch" are the same locale/,
    );
  });

  test("a region override inherits the fields it leaves out from the language override", () => {
    const locales = { de: { quotes: "»«›‹" }, "de-CH": { dash: " — " } };
    expect(fix('"Grüezi" - ja', { locale: "de-CH", locales }).text).toBe("»Grüezi« — ja");
    expect(fix('"Hallo" - ja', { locale: "de", locales }).text).toBe("»Hallo« – ja");
  });

  test("the CLI infers locales added in the config from the file name", () => {
    const dir = mkdtempSync(join(tmpdir(), "typolint-"));
    writeFileSync(join(dir, "typolint.json"), JSON.stringify({ locales: { ro: { quotes: "„”«»" } } }));
    writeFileSync(join(dir, "ro.json"), '{"a": "\\"Bună\\""}');
    const cli = new URL("../src/cli.ts", import.meta.url).pathname;
    const result = spawnSync(process.execPath, [cli, "ro.json"], { cwd: dir, encoding: "utf8" });
    expect(result.status).toBe(1);
    expect(result.stdout).toMatch(/quotes\/wrong-glyph/);
  });
});

describe("issue codes", () => {
  test.each([
    ["en", "You're", "apostrophe/wrong-glyph"],
    ["en", "'tis", "apostrophe/ambiguous"],
    ["de", "“Englisch”", "quotes/wrong-glyph"],
    ["en", 'He said "hi', "quotes/unclosed"],
    ["en", 'say " hi', "quotes/ambiguous-direction"],
    ["en", "Wait...", "ellipsis/three-dots"],
    ["de", "Ja - nein", "dash/hyphen"],
    ["en", "yes - no", "dash/context-dependent"],
    ["en", "5 - 3", "dash/between-numbers"],
    ["es", "sí - no", "dash/context-dependent"],
    ["en", "a  b", "double-space/repeated"],
  ])("%s %j reports %s", (locale, text, code) => {
    expect(lint(text, { locale }).map((i) => i.code)).toContain(code);
  });

  test("a closing quote without an opening one", () => {
    expect(lint("hi” there", { locale: "en" }).map((i) => i.code)).toEqual(["quotes/unmatched-close"]);
  });

  test("the rule is the part of the code before the slash", () => {
    for (const issue of lint('"a" - b... c  d', { locale: "en" }))
      expect(issue.code.startsWith(`${issue.rule}/`)).toBe(true);
  });
});

describe("errors", () => {
  test("an unknown locale throws LocaleError", () => {
    expect(() => lint("x", { locale: "xx" })).toThrow(LocaleError);
    expect(() => lint("x", { locale: "not a tag" })).toThrow(LocaleError);
  });

  test("a bad override value throws LocaleError with its path", () => {
    expect(() => lint("x", { locale: "de", locales: { de: { quotes: "»«" } } })).toThrow(
      /locales\.de\.quotes/,
    );
  });

  test("config errors are ConfigError and name the value", () => {
    expect(() => parseConfig({ rules: { smart: true } })).toThrow(ConfigError);
    expect(() => parseConfig({ locales: { de: { quotes: "»" } } })).toThrow(ConfigError);
    expect(() => parseConfig({ protect: [{ name: "x", pattern: "(", role: "word" }] })).toThrow(
      /^config\.protect\.0\.pattern: /,
    );
  });

  test("invalid ICU throws IcuSyntaxError with the offset", () => {
    expect(() => lint("Hi {name", { locale: "en", syntax: "icu" })).toThrow(IcuSyntaxError);
  });
});

test("the public API is exactly this", () => {
  expect(Object.keys(api).toSorted()).toEqual([
    "ConfigError",
    "IcuSyntaxError",
    "LocaleError",
    "cldrVersion",
    "fix",
    "knownLocales",
    "lint",
    "parseConfig",
    "ruleIds",
    "typographyRefinement",
  ]);
  expect(Object.isFrozen(api.ruleIds) && Object.isFrozen(api.knownLocales)).toBe(true);
});
