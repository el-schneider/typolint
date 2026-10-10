import { spawnSync } from "node:child_process";
import { copyFileSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, test } from "vitest";

const cli = new URL("../src/cli.ts", import.meta.url).pathname;
const fixture = (name: string) => new URL(`fixtures/${name}`, import.meta.url).pathname;

function run(args: string[], cwd: string) {
  const result = spawnSync(process.execPath, [cli, ...args], { cwd, encoding: "utf8" });
  return { code: result.status, out: result.stdout, err: result.stderr };
}

function tempWith(files: Record<string, string>) {
  const dir = mkdtempSync(join(tmpdir(), "typolint-"));
  for (const [name, from] of Object.entries(files)) copyFileSync(from, join(dir, name));
  return dir;
}

describe("CLI on site copy in YAML", () => {
  test("lint reports the four known issues in en.yaml and none in de.yaml", () => {
    const dir = tempWith({ "en.yaml": fixture("site-en.yaml"), "de.yaml": fixture("site-de.yaml") });
    const { code, out } = run(["en.yaml", "de.yaml"], dir);
    expect(code).toBe(1);
    const lines = out
      .trim()
      .split("\n")
      .filter((l) => l.startsWith("en.yaml") || l.startsWith("de.yaml"));
    expect(lines.map((l) => l.replace(/ {2}Use.*\[/, " ["))).toEqual([
      "en.yaml:14:14  apostrophe/wrong-glyph [signup.title]",
      "en.yaml:15:35  apostrophe/wrong-glyph [signup.body]",
      "en.yaml:29:28  apostrophe/wrong-glyph [features.options.cloud.label]",
      "en.yaml:34:62  apostrophe/wrong-glyph [faq.0.a]",
    ]);
  });

  test("--fix changes exactly those apostrophes and nothing else", () => {
    const dir = tempWith({ "en.yaml": fixture("site-en.yaml"), "de.yaml": fixture("site-de.yaml") });
    const { code } = run(["--fix", "en.yaml", "de.yaml"], dir);
    expect(code).toBe(0);
    const before = readFileSync(fixture("site-en.yaml"), "utf8");
    const after = readFileSync(join(dir, "en.yaml"), "utf8");
    expect(after).toBe(
      before
        .replace(`"You're on the list."`, `"You’re on the list."`)
        .replace("We'll write once", "We’ll write once")
        .replaceAll("{name}'s sync", "{name}’s sync"),
    );
    expect(readFileSync(join(dir, "de.yaml"), "utf8")).toBe(readFileSync(fixture("site-de.yaml"), "utf8"));
    expect(run(["--fix", "en.yaml"], dir).code).toBe(0);
    expect(readFileSync(join(dir, "en.yaml"), "utf8")).toBe(after);
  });
});

describe("CLI on ICU messages in JSON", () => {
  test("--syntax icu finds nothing in clean en.json and de.json", () => {
    const dir = tempWith({ "en.json": fixture("messages-en.json"), "de.json": fixture("messages-de.json") });
    expect(run(["--syntax", "icu", "en.json", "de.json"], dir)).toMatchObject({ code: 0, out: "" });
  });

  test("--syntax icu fixes text inside plural branches and leaves ICU quoting alone", () => {
    const dir = mkdtempSync(join(tmpdir(), "typolint-"));
    writeFileSync(
      join(dir, "messages.en.json"),
      "{\n  \"a\": \"{n, plural, one {You've # mail} other {You've # mails}} '{'x'}'\"\n}\n",
    );
    expect(run(["--syntax", "icu", "--fix", "messages.en.json"], dir).code).toBe(0);
    expect(readFileSync(join(dir, "messages.en.json"), "utf8")).toBe(
      "{\n  \"a\": \"{n, plural, one {You’ve # mail} other {You’ve # mails}} '{'x'}'\"\n}\n",
    );
  });
});

describe("CLI errors", () => {
  test("a file name without a locale needs --locale", () => {
    const dir = tempWith({ "copy.yaml": fixture("site-de.yaml") });
    expect(run(["copy.yaml"], dir)).toMatchObject({ code: 2, err: expect.stringMatching(/--locale/) });
    expect(run(["--locale", "de", "copy.yaml"], dir).code).toBe(0);
  });

  test("an unknown option or format is a usage error", () => {
    const dir = mkdtempSync(join(tmpdir(), "typolint-"));
    expect(run(["--syntax", "md", "x.json"], dir).code).toBe(2);
    expect(run([], dir).code).toBe(2);
  });

  test("--config turns rules on and overrides locales", () => {
    const dir = mkdtempSync(join(tmpdir(), "typolint-"));
    writeFileSync(join(dir, "es.json"), '{"a": "\\"Hola\\" - dijo"}');
    writeFileSync(
      join(dir, "typolint.json"),
      JSON.stringify({
        rules: { dash: false },
        locales: { es: { quotes: "«»“”" } },
      }),
    );
    expect(run(["--config", "typolint.json", "--fix", "es.json"], dir).code).toBe(0);
    expect(readFileSync(join(dir, "es.json"), "utf8")).toBe('{"a": "«Hola» - dijo"}');
  });
});
