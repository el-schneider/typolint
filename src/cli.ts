#!/usr/bin/env node
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { parseConfig, type Config } from "./config.ts";
import { basename, extname } from "node:path";
import { parseArgs } from "node:util";
import { extractJson, fixDocument, lintDocument, type Extract, type LeafIssue } from "./document.ts";
import type { Options, Syntax } from "./lint.ts";
import { isKnownLocale } from "./locale.ts";

const usage = `Usage: typolint [options] <file.yaml|file.json ...>

Lints string values in YAML and JSON files. The locale comes from the file name
(de.yaml, messages.fr.json) unless --locale is given.

Options:
  --locale <tag>      Locale for every file, e.g. de or en-GB
  --syntax <syntax>   plain (default): {placeholders} and *emphasis*; icu: ICU MessageFormat
  --fix               Write certain fixes back in place; comments and layout stay as they are
  --config <file>     Config file (default: typolint.json in the current directory, if present)
  -h, --help          Show this help

Exit codes: 0 no issues, 1 issues left, 2 usage or input error.`;

class UsageError extends Error {}

const defaultConfig = "typolint.json";

/** An explicit --config must exist; the default file is optional. */
function readConfig(file: string | undefined): Config {
  const path = file ?? defaultConfig;
  if (file === undefined && !existsSync(path)) return {};
  return parseConfig(JSON.parse(readFileSync(path, "utf8")), path);
}

/** `de.yaml`, `messages.de.json`: built-in locales and locales added in the config. */
function localeFromName(file: string, config: Config): string {
  const stem = basename(file, extname(file));
  const found = [stem, stem.split(".").at(-1)!].find((candidate) => isKnownLocale(candidate, config.locales));
  if (found !== undefined) return found;
  throw new UsageError(`Cannot tell the locale of ${file} from its name. Pass --locale.`);
}

async function extractorFor(file: string): Promise<Extract> {
  const ext = extname(file).toLowerCase();
  if (ext === ".json") return extractJson;
  if (ext === ".yaml" || ext === ".yml") {
    try {
      return (await import("./yaml.ts")).extractYaml;
    } catch (error) {
      throw new UsageError(
        `Reading YAML needs the "yaml" package installed next to typolint. (${String(error)})`,
      );
    }
  }
  throw new UsageError(`Unsupported file type: ${file}`);
}

function position(source: string, offset: number): string {
  const before = source.slice(0, offset).split("\n");
  return `${before.length}:${before.at(-1)!.length + 1}`;
}

function formatIssue(file: string, source: string, issue: LeafIssue): string {
  const fix = issue.fix === undefined ? "" : ` (fix: ${JSON.stringify(issue.fix)})`;
  return `${file}:${position(source, issue.offset)}  ${issue.code}  ${issue.message}${fix}  [${issue.path.join(".")}]`;
}

async function main(argv: string[]): Promise<number> {
  const { values, positionals } = parseArgs({
    args: argv,
    allowPositionals: true,
    options: {
      locale: { type: "string" },
      syntax: { type: "string", default: "plain" },
      fix: { type: "boolean", default: false },
      config: { type: "string" },
      help: { type: "boolean", short: "h", default: false },
    },
  });
  if (values.help) {
    console.log(usage);
    return 0;
  }
  if (positionals.length === 0) throw new UsageError(usage);
  if (values.syntax !== "plain" && values.syntax !== "icu") {
    throw new UsageError(`Unknown --syntax ${values.syntax}. Use plain or icu.`);
  }
  const syntax: Syntax = values.syntax;
  const config = readConfig(values.config);

  let left = 0;
  for (const file of positionals) {
    const options: Options = {
      ...config,
      syntax,
      locale: values.locale ?? localeFromName(file, config),
    };
    const extract = await extractorFor(file);
    let source = readFileSync(file, "utf8");
    if (values.fix) {
      const fixed = fixDocument(source, extract, options);
      if (fixed !== source) {
        writeFileSync(file, fixed);
        source = fixed;
      }
    }
    const issues = lintDocument(source, extract, options);
    for (const issue of issues) console.log(formatIssue(file, source, issue));
    left += issues.length;
  }
  if (left > 0) console.log(`\n${left} issue${left === 1 ? "" : "s"}`);
  return left > 0 ? 1 : 0;
}

main(process.argv.slice(2)).then(
  (code) => process.exit(code),
  (error: unknown) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(2);
  },
);
