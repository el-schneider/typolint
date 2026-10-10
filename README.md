# typolint

Locale-aware typography linter for UI copy. It finds straight quotes, wrong apostrophes, three-dot ellipses, hyphens used as dashes and double spaces in translation strings, reports each issue with exact offsets, and fixes only what is certain.

```
$ typolint src/i18n/en.yaml
src/i18n/en.yaml:14:14  apostrophe/wrong-glyph  Use ’ (U+2019) for an apostrophe, not '. (fix: "’")  [signup.title]
```

- Zero runtime dependencies in the core. Reading YAML needs the `yaml` package (optional peer dependency).
- Quote characters per locale come from Unicode CLDR 48.2 and can be overridden per locale.
- Two string syntaxes: `plain` (`{placeholders}`, `*emphasis*`) and `icu` (ICU MessageFormat as used by FormatJS and react-intl).
- `--fix` edits string values in place. Comments, quoting style, key order and line breaks stay as they are.

Defaults are conservative. Out of the box, typolint fixes only what is wrong in every style: straight quotes, `'` as an apostrophe, `...`, a hyphen used as a dash where the locale has one standard dash. Where a valid alternative exists, such as `»…«` instead of `„…“` in German, it reports and leaves the choice to you. It fixes toward a house style only after you set that style in the config.

## Install

```sh
pnpm add -D typolint yaml   # yaml only if you lint YAML files
```

Node 22 or later.

## What it does not do

- It does not guess. An ambiguous character (`'tis`, `summer of '69`, `Jens‘ Buch`, an unbalanced `"`) is reported without a fix.
- It does not rewrite number ranges (`1-3`), minus signs (`5 - 3`) or feet and inches (`12"`).
- It does not insert special spaces unless you turn on `punctuation-space`.
- It does not prevent widows (a last word alone on a line). That depends on the line width, which only the renderer knows. Use CSS `text-wrap: pretty`.
- It does not change dashes that are already typographic unless you turn on `dash-style`.
- It does not check spelling, grammar or capitalisation.
- It does not read Markdown, HTML, `.astro` or source code. Use the API on strings you extract yourself, or add protect patterns for inline markup.

## Rules

| Rule                                 | Fixes                                                                                                                                                                                                    | Reports only                                                                                                                                                                                                              | Why                                                                                                                                                                                                  |
| ------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `apostrophe`                         | `You're` → `You’re`, `{name}'s` → `{name}’s`, `l'homme` → `l’homme`, `'90s` and `‘90s` → `’90s`, `rock 'n' roll` → `rock ’n’ roll`, `Andrea‘s` → `Andrea’s`                                              | `'tis`, `tables' legs`, `'69`: apostrophe or quote?                                                                                                                                                                       | The apostrophe is ’ (U+2019) in every Latin-script locale. In German, ‘ is the closing single quote, so `Andrea‘s` is a different, wrong character.                                                  |
| `quotes`                             | Straight `"` to the locale's primary and secondary pairs, by nesting depth. A wrong quote next to a correct partner (`„Hallo”` in German). Quotes of another style, once you set `quotes` for the locale | Quotes of another style while the locale uses CLDR defaults (`“…”` or `»…«` in German text): they may be house style. Unbalanced quotes; quotes whose direction is unclear; a single quote where a double one is expected | Each language has its own quote marks: en “…” ‘…’, de „…“ ‚…‘, fr «…». House styles differ; see [Adjusting to taste](#adjusting-to-taste). Fixes apply only when every quote in the string pairs up. |
| `ellipsis`                           | `...` → `…`                                                                                                                                                                                              |                                                                                                                                                                                                                           | One glyph with correct spacing; three dots can break across lines. Four or more dots are left alone.                                                                                                 |
| `dash`                               | `word - word` and `word -- word` → de, nl, pl, cs, sv, da, fi: `word – word`, or the dash you set. Next to a line break only the hyphen changes.                                                         | Hyphen between digits; locales without one standard dash (en, en-GB, es, pt, fr, it, tr) until you set `dash`; a closed dash that would need a line break removed                                                         | A hyphen joins words; a dash separates clauses.                                                                                                                                                      |
| `dash-style` (off by default)        | A typographic dash between words that differs from the locale's dash: de `Gut — wirklich` → `Gut – wirklich`; with `"en": { "dash": "—" }`, `good – really` → `good—really`                              |                                                                                                                                                                                                                           | One dash style per text. Off by default because dash style is house style. Unspaced en dashes (`3–5`, `Berlin–Hamburg`) and dashes between digits are left alone: they mark ranges.                  |
| `double-space`                       | Two or more spaces between words → one                                                                                                                                                                   |                                                                                                                                                                                                                           | Usually a typing or merge slip, and it renders unevenly. Leading indentation and trailing spaces are not touched.                                                                                    |
| `punctuation-space` (off by default) | The spaces in the locale's spacing table: French narrow no-break space (U+202F) before `; : ! ?` and inside « », or what you configure, such as a hair space before `! ?`                                |                                                                                                                                                                                                                           | Keeps the mark on the same line as its word, or sets the spacing a house style wants. Times like `12:30` and URLs like `?q=1` are left alone.                                                        |

Dash conventions are not in CLDR. Built-in dashes come only from locales with one standard reference: Duden (de), Taalunie (nl), ČSN 01 6910 (cs), Språkrådet (sv), Dansk Sprognævn (da), Kotus (fi), RJP (pl). English has none built in, because Chicago, AP and British usage disagree.

## Protected markup

These spans are never changed or flagged. A placeholder counts as a word, so `{name}'s` is an apostrophe after a word. An emphasis marker is skipped, so `*"Hello"*` is a quoted word.

- `plain`: `{placeholders}`, `*` markers, URLs, email addresses, `` `code` ``
- `icu`: arguments, `plural` / `select` / `selectordinal` syntax, `#`, rich-text tags (`<b>…</b>`, `<icon/>`), ICU apostrophe quoting (`'{'`), URLs, email addresses, `` `code` ``

In ICU messages, text inside each plural or select branch is linted as its own string. A straight `'` that ICU reads as an apostrophe (`You've`, `It''s`) is fixed to ’, which ICU leaves alone. A `'` that quotes syntax (`'{literal}'`) is never touched.

Add your own patterns with `protect`. They are added to the defaults:

```json
{ "protect": [{ "name": "html", "pattern": "<[^>]+>", "role": "transparent" }] }
```

`role` is `word` when the span stands in for a word (like `{name}`), or `transparent` when it is only a marker (like `*` or an HTML tag). `flags` is optional and defaults to `u`.

## Adjusting to taste

CLDR is the default. House styles differ, so every locale can be overridden in a config file. Write each setting the way it looks in text.

`typolint.json`:

```json
{
  "locales": {
    "de": { "quotes": "»«›‹" },
    "de-CH": { "quotes": "«»‹›" },
    "en": { "dash": " — " },
    "es": { "quotes": "«»“”" }
  },
  "preset": "strict",
  "rules": { "dash-style": false }
}
```

- `quotes`: four characters, in this order: primary open, primary close, secondary open, secondary close. The secondary pair is used for quotes inside quotes.
- `dash`: what replaces a hyphen used as a dash: `"—"`, `" — "`, `"–"`, `" – "`, or `"report"` to flag it without a fix.
- `spacing`: spaces for the `punctuation-space` rule. `before` maps marks to the space before them; `insideGuillemets` is the space after « ‹ and before » ›. Spaces are named because they are invisible: `narrow-nbsp` (U+202F), `nbsp` (U+00A0), `thin` (U+2009), `hair` (U+200A). French has `{ "before": { ";:!?": "narrow-nbsp" }, "insideGuillemets": "narrow-nbsp" }` built in; `"spacing": {}` turns it off.
- `preset`: `recommended` (the default) or `strict`. See below.
- `rules`: turns single rules on or off for all locales, on top of the preset.

Presets:

- `recommended`: `dash-style` and `punctuation-space` are off. Every other rule is on.
- `strict`: every rule is on.

A preset only switches rules. Each style is a rule or a locale setting of its own, so you can always set the single parts yourself.

Common styles:

| Style                              | `quotes` |
| ---------------------------------- | -------- |
| German, default (CLDR)             | `„“‚‘`   |
| German, guillemets (books)         | `»«›‹`   |
| Swiss, Liechtenstein               | `«»‹›`   |
| French, with English quotes inside | `«»“”`   |
| Spanish (RAE)                      | `«»“”`   |
| British, single quotes first       | `‘’“”`   |
| Dutch, double quotes first         | `“”‘’`   |

An override for `de` also applies to `de-AT` and `de-CH`. A `de-CH` override replaces only the fields it sets; it inherits the others from the `de` override, then from the defaults. Locale tags are case-insensitive (`en-gb`, `EN_GB` and `en-GB` are the same), and two keys for the same locale are an error.

The linter changes text to the configured style: with `"de": { "quotes": "»«›‹" }`, `„Hallo“` and `"Hallo"` both become `»Hallo«`. Without that setting, `»Hallo«` in German text is reported, with a hint to set the quotes, and left as it is. The apostrophe is always ’, in every style.

A hair space before `!` and `?`:

```json
{ "preset": "strict", "locales": { "de": { "spacing": { "before": { "!?": "hair" } } } } }
```

The config is checked when it loads. A wrong value stops the run and names its path, for example `typolint.json: locales.de.quotes: expected four quote characters …`.

Where the config is read:

- CLI: `typolint.json` in the current directory, or the file given with `--config`.
- API and Zod helper: pass the parsed config, see below.

A locale that is not built in needs only `quotes` in the config: `"ro": { "quotes": "„”«»" }`.

## CLI

```
typolint [options] <file.yaml|file.json ...>

  --locale <tag>      Locale for every file (default: from the file name, e.g. de.yaml, messages.fr.json)
  --syntax <syntax>   plain (default) or icu
  --fix               Write certain fixes back in place
  --config <file>     Config file (default: typolint.json in the current directory, if present)
```

Exit code 0 means no issues are left, 1 means issues are left (after `--fix`: issues that need a human), 2 means a usage, config or input error.

```sh
typolint src/i18n/*.yaml
typolint --fix src/i18n/*.yaml
typolint --syntax icu src/locales/*.json
```

A fix that would replace a YAML line fold (a line break inside a multi-line value) is reported but not applied. After each pass, the CLI parses the file again and checks that every edited value is exactly what the fix produced. If not, it stops and leaves the file unchanged.

## API

```ts
import { fix, lint } from "typolint";

lint("You're on the list.", { locale: "en" });
// [{ code: "apostrophe/wrong-glyph", rule: "apostrophe", start: 3, end: 4, message: "Use ’ (U+2019) …", fix: "’" }]

fix('{n, plural, one {"#" item} other {"#" items}}', { locale: "de", syntax: "icu" }).text;
// '{n, plural, one {„#“ item} other {„#“ items}}'
```

Options: `locale` (required), `syntax` (`plain` | `icu`), and the config fields `rules`, `locales` and `protect` (with `RegExp` patterns).

Each issue has a `code` such as `quotes/unclosed`: the rule, a slash and the kind of issue. Match on `code`; `message` is English display text and can change.

| Rule                | Codes                                                               |
| ------------------- | ------------------------------------------------------------------- |
| `apostrophe`        | `wrong-glyph`, `ambiguous`                                          |
| `quotes`            | `wrong-glyph`, `ambiguous-direction`, `unmatched-close`, `unclosed` |
| `ellipsis`          | `three-dots`                                                        |
| `dash`              | `hyphen`, `between-numbers`, `context-dependent`                    |
| `dash-style`        | `wrong-glyph`                                                       |
| `double-space`      | `repeated`                                                          |
| `punctuation-space` | `missing`, `wrong-space`                                            |

Errors are thrown, never turned into issues:

- `LocaleError`: unknown or malformed locale tag, or an override value that cannot be used.
- `ConfigError`: a wrong value in a config; the message starts with its path.
- `IcuSyntaxError`: an ICU message the linter cannot split into text, with `offset`. The ICU parser only finds the text to lint. It is not a full validator: an unclosed `<b>` tag or a plural without `other` passes. Use FormatJS to validate messages.

To use a config file, validate it with `parseConfig` and spread it into the options:

```ts
import { lint, parseConfig } from "typolint";
import raw from "./typolint.json" with { type: "json" };

const config = parseConfig(raw);
lint(text, { ...config, locale: "de" });
```

### Zod schema helper

`typographyRefinement` returns a function for `superRefine`. It lints every string in the parsed value and reports each issue at its data path:

```ts
import { parseConfig, typographyRefinement } from "typolint";
import raw from "./typolint.json" with { type: "json" };

const copy = z
  .object({ locale: z.string(), title: z.string() /* … */ })
  .superRefine(typographyRefinement({ ...parseConfig(raw), locale: (data) => data.locale }));
```

A build then fails with messages like `signup.title: typography/apostrophe/wrong-glyph: Use ’ (U+2019) for an apostrophe, not '. Fix: "’". In: "You're on the list."`. The schema does not know the file name, so `locale` can be a function of the parsed value.

## Locales

Built in: en, en-GB, de, fr, es, it, nl, pl, cs, sv, da, fi, pt, tr. Regional tags fall back to their language (`de-AT` → `de`).

To build in another locale from CLDR, add its tag to `defaultLocales` in `scripts/build-locales.ts` and run:

```sh
pnpm locales
```

This regenerates `src/locales.generated.ts` from the `cldr-misc-full` dev dependency. If the locale has a fixed dash convention, add it to `dashes` in `src/locale.ts`.

## Stability

The project is before 1.0, so any of this can still change. From 1.0 on:

- Stable: exported names, option and config shapes, rule ids, issue codes, CLI flags, exit codes, offsets as UTF-16 indexes.
- Not stable: `message` text. A minor version can find more issues in the same text, through a new rule or a new case of an existing rule; a new rule that changes text is off by default.

## Development

```sh
pnpm install
pnpm check    # typecheck, oxlint, oxfmt --check, vitest, build
```

`test/fixtures/` holds site copy in YAML and ICU messages in JSON for end-to-end CLI tests. The ICU parser is checked against `@formatjs/icu-messageformat-parser`.

## Credits

- Quote data: [Unicode CLDR](https://cldr.unicode.org/) via [`cldr-misc-full`](https://www.npmjs.com/package/cldr-misc-full), Unicode License v3.
- Test cases for apostrophes, quotes (de, en, fr, pl, fi) and ellipses are adapted from [typograf](https://github.com/typograf/typograf), MIT.

## License

MIT
