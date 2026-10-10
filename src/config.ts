import type { Options } from "./lint.ts";
import { LocaleError, resolveLocale, type LocaleOverride } from "./locale.ts";
import type { AtomRole, ProtectPattern } from "./markup.ts";
import { ruleIds, type RuleId } from "./rules.ts";

/** Everything in `Options` except the locale and syntax, which depend on the file being linted. */
export type Config = Pick<Options, "rules" | "locales" | "protect">;

/** A config value that cannot be used. The message starts with the path of the value. */
export class ConfigError extends Error {}

type Json = Record<string, unknown>;

/** `keys` limits the allowed keys; omit it for a map with free keys. */
function object(value: unknown, label: string, keys?: readonly string[]): Json {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new ConfigError(`${label}: expected an object.`);
  }
  if (!keys) return value as Json;
  const unknown = Object.keys(value).filter((k) => !keys.includes(k));
  if (unknown.length > 0) {
    throw new ConfigError(`${label}: unknown key ${unknown.join(", ")}. Allowed: ${keys.join(", ")}.`);
  }
  return value as Json;
}

function typed<T>(value: unknown, type: "string" | "boolean", label: string): T {
  if (typeof value !== type) throw new ConfigError(`${label}: expected a ${type}.`);
  return value as T;
}

function regExp(pattern: string, flags: string, at: string): RegExp {
  try {
    return new RegExp(pattern, flags);
  } catch (error) {
    throw new ConfigError(`${at}.pattern: ${(error as Error).message}`, { cause: error });
  }
}

/**
 * Named rule sets. `recommended` is the default: only rules whose fixes are certain and not a
 * matter of taste. `strict` adds every opt-in rule. A config's own `rules` apply on top.
 */
const presets: Readonly<Record<string, Readonly<Partial<Record<RuleId, boolean>>>>> = {
  recommended: {},
  strict: { "dash-style": true, "punctuation-space": true },
};

function spacing(value: unknown, label: string): NonNullable<LocaleOverride["spacing"]> {
  const s = object(value, label, ["before", "insideGuillemets"]);
  return {
    ...(s.before === undefined ? {} : { before: stringMap(s.before, `${label}.before`) }),
    ...(s.insideGuillemets === undefined
      ? {}
      : { insideGuillemets: typed<string>(s.insideGuillemets, "string", `${label}.insideGuillemets`) }),
  };
}

function stringMap(value: unknown, label: string): Record<string, string> {
  const map = object(value, label);
  for (const [key, item] of Object.entries(map)) typed<string>(item, "string", `${label}.${key}`);
  return map as Record<string, string>;
}

/**
 * Validates a config object, such as the parsed contents of `typolint.json`. Fails with the
 * path of the first wrong value, including quote and dash strings that cannot be used.
 */
export function parseConfig(raw: unknown, label = "config"): Config {
  const root = object(raw, label, ["preset", "rules", "locales", "protect"]);
  const config: { -readonly [K in keyof Config]: Config[K] } = {};

  const presetName =
    root.preset === undefined ? "recommended" : typed<string>(root.preset, "string", `${label}.preset`);
  const preset = Object.hasOwn(presets, presetName) ? presets[presetName] : undefined;
  if (preset === undefined) {
    throw new ConfigError(
      `${label}.preset: expected one of ${Object.keys(presets).join(", ")}, got ${JSON.stringify(presetName)}.`,
    );
  }
  const rules = root.rules === undefined ? {} : object(root.rules, `${label}.rules`, ruleIds);
  for (const [id, on] of Object.entries(rules)) typed<boolean>(on, "boolean", `${label}.rules.${id}`);
  const merged = { ...preset, ...(rules as Partial<Record<RuleId, boolean>>) };
  if (Object.keys(merged).length > 0) config.rules = merged;

  if (root.locales !== undefined) {
    const locales: Record<string, LocaleOverride> = {};
    for (const [tag, value] of Object.entries(object(root.locales, `${label}.locales`))) {
      const at = `${label}.locales.${tag}`;
      const o = object(value, at, ["quotes", "dash", "spacing"]);
      locales[tag] = {
        ...(o.quotes === undefined ? {} : { quotes: typed<string>(o.quotes, "string", `${at}.quotes`) }),
        ...(o.dash === undefined ? {} : { dash: typed<string>(o.dash, "string", `${at}.dash`) }),
        ...(o.spacing === undefined ? {} : { spacing: spacing(o.spacing, `${at}.spacing`) }),
      };
    }
    // Resolve now so a bad quote string or an unknown locale fails when the config loads, not mid-run.
    for (const tag of Object.keys(locales)) {
      try {
        resolveLocale(tag, locales);
      } catch (error) {
        if (!(error instanceof LocaleError)) throw error;
        throw new ConfigError(`${label}: ${error.message}`, { cause: error });
      }
    }
    config.locales = locales;
  }

  if (root.protect !== undefined) {
    if (!Array.isArray(root.protect)) throw new ConfigError(`${label}.protect: expected an array.`);
    config.protect = root.protect.map((value, i): ProtectPattern => {
      const at = `${label}.protect.${i}`;
      const p = object(value, at, ["name", "pattern", "flags", "role"]);
      const role = typed<AtomRole>(p.role, "string", `${at}.role`);
      if (role !== "word" && role !== "transparent") {
        throw new ConfigError(`${at}.role: expected "word" or "transparent".`);
      }
      const flags = p.flags === undefined ? "u" : typed<string>(p.flags, "string", `${at}.flags`);
      return {
        name: typed<string>(p.name, "string", `${at}.name`),
        pattern: regExp(typed<string>(p.pattern, "string", `${at}.pattern`), flags, at),
        role,
      };
    });
  }
  return config;
}
