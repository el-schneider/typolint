import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, test } from "vitest";
import { fix, lint, parseConfig, type Options } from "../src/index.ts";

const fixed = (text: string, options: Options) => fix(text, options).text;

describe("house quote styles", () => {
  const guillemets = { locales: { de: { quotes: "»«›‹" } } };
  const swiss = { locales: { de: { quotes: "«»‹›" } } };

  test.each([
    ['"Hallo"', "»Hallo«"],
    ["„Hallo“, sagte sie.", "»Hallo«, sagte sie."],
    ['Er sagte: "Sie nannte es "Kunst"."', "Er sagte: »Sie nannte es ›Kunst‹.«"],
    ["»Schon richtig«", "»Schon richtig«"],
    ["Andrea’s »Café«", "Andrea’s »Café«"],
  ])("German with guillemets »…«: %j", (input, output) => {
    expect(fixed(input, { locale: "de", ...guillemets })).toBe(output);
  });

  test.each([
    ['"Grüezi"', "«Grüezi»"],
    ["„Grüezi ‚so‘“", "«Grüezi ‹so›»"],
    ["Er sagte: «Sie nannte es ‹Kunst›.»", "Er sagte: «Sie nannte es ‹Kunst›.»"],
  ])("Swiss style «…»: %j", (input, output) => {
    expect(fixed(input, { locale: "de", ...swiss })).toBe(output);
  });

  test("an override for a language also applies to its regions", () => {
    expect(fixed('"Servus"', { locale: "de-AT", ...guillemets })).toBe("»Servus«");
  });

  test("a region override beats the language override", () => {
    const locales = { de: { quotes: "»«›‹" }, "de-CH": { quotes: "«»‹›" } };
    expect(fixed('"Grüezi"', { locale: "de-CH", locales })).toBe("«Grüezi»");
    expect(fixed('"Hallo"', { locale: "de", locales })).toBe("»Hallo«");
  });

  test("British single-first quotes keep apostrophes apart from closing quotes", () => {
    const options = { locale: "en-GB", locales: { "en-GB": { quotes: "‘’“”" } } };
    expect(fixed('"It\'s fine," she said.', options)).toBe("‘It’s fine,’ she said.");
    expect(fixed("‘It’s fine,’ she said.", options)).toBe("‘It’s fine,’ she said.");
    expect(fixed('"Say "hi"," he said.', options)).toBe("‘Say “hi”,’ he said.");
  });
});

describe("house dash styles", () => {
  test.each([
    [" — ", "yes — no"],
    ["—", "yes—no"],
    [" – ", "yes – no"],
  ])("en with %j", (dash, output) => {
    expect(fixed("yes - no", { locale: "en", locales: { en: { dash } } })).toBe(output);
  });

  test('"report" flags without a fix', () => {
    const issues = lint("Ja - nein", { locale: "de", locales: { de: { dash: "report" } } });
    expect(issues).toMatchObject([{ rule: "dash" }]);
    expect(issues[0]!.fix).toBeUndefined();
  });
});

describe("parseConfig", () => {
  test("accepts a full config", () => {
    const config = parseConfig({
      rules: { "punctuation-space": true, dash: false },
      locales: { de: { quotes: "»«›‹", dash: " – " }, fr: { spacing: {} } },
      protect: [{ name: "html", pattern: "<[^>]+>", role: "transparent" }],
    });
    expect(fixed('<b>"Hallo"</b> - ja', { locale: "de", ...config })).toBe("<b>»Hallo«</b> - ja");
  });

  test("extra protect patterns keep the defaults", () => {
    const config = parseConfig({ protect: [{ name: "html", pattern: "<[^>]+>", role: "transparent" }] });
    expect(fixed("<i>{it's}</i> it's", { locale: "en", ...config })).toBe("<i>{it's}</i> it’s");
  });

  test.each([
    [{ colour: true }, /config: unknown key colour/],
    [{ rules: { smart: true } }, /config\.rules: unknown key smart/],
    [{ rules: { dash: "yes" } }, /config\.rules\.dash: expected a boolean/],
    [{ locales: { de: { quotes: "»«" } } }, /locales\.de\.quotes: expected four quote characters/],
    [{ locales: { de: { quotes: "\"\"''" } } }, /locales\.de\.quotes: expected four quote characters/],
    [{ locales: { de: { dash: "-" } } }, /locales\.de\.dash: expected/],
    [{ locales: { de: { quote: "»«›‹" } } }, /locales\.de: unknown key quote/],
    [{ locales: { xx: { dash: "—" } } }, /Unknown locale "xx"/],
    [{ protect: [{ name: "x", pattern: "y", role: "atom" }] }, /protect\.0\.role/],
  ])("rejects %j", (raw, message) => {
    expect(() => parseConfig(raw)).toThrow(message);
  });

  test("a new locale needs only its quotes", () => {
    const config = parseConfig({ locales: { ro: { quotes: "„”«»" } } });
    expect(fixed('"Bună"', { locale: "ro", ...config })).toBe("„Bună”");
  });
});

describe("CLI config file", () => {
  const cli = new URL("../src/cli.ts", import.meta.url).pathname;
  const run = (args: string[], cwd: string) =>
    spawnSync(process.execPath, [cli, ...args], { cwd, encoding: "utf8" });

  test("typolint.json in the current directory is read without --config", () => {
    const dir = mkdtempSync(join(tmpdir(), "typolint-"));
    writeFileSync(join(dir, "typolint.json"), JSON.stringify({ locales: { de: { quotes: "»«›‹" } } }));
    writeFileSync(join(dir, "de.json"), '{"a": "„Hallo“"}');
    expect(run(["--fix", "de.json"], dir).status).toBe(0);
    expect(readFileSync(join(dir, "de.json"), "utf8")).toBe('{"a": "»Hallo«"}');
  });

  test("a bad config file stops the run with its path", () => {
    const dir = mkdtempSync(join(tmpdir(), "typolint-"));
    writeFileSync(join(dir, "typolint.json"), JSON.stringify({ locales: { de: { quotes: "»" } } }));
    writeFileSync(join(dir, "de.json"), '{"a": "x"}');
    const result = run(["de.json"], dir);
    expect(result.status).toBe(2);
    expect(result.stderr).toMatch(/typolint\.json: locales\.de\.quotes/);
  });

  test("a missing --config file is an error", () => {
    const dir = mkdtempSync(join(tmpdir(), "typolint-"));
    writeFileSync(join(dir, "de.json"), '{"a": "x"}');
    expect(run(["--config", "nope.json", "de.json"], dir).status).toBe(2);
  });
});
