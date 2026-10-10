> Pre-1.0. Breaking changes are fine when they improve the API; note them in `CHANGELOG.md`. Remove this notice at 1.0.

- User-visible changes get one line under `## Unreleased` in `CHANGELOG.md`, in the style of the existing entries.
- Never bump `package.json`, add a version heading, tag, or create a release. `.github/workflows/release.yml` does that at release time.
- Defaults stay conservative. A fix may only target what is wrong in every style, or a style the user set in the config. Anything with valid alternatives is reported without a fix, or lives in an opt-in rule that `presets.strict` in `src/config.ts` turns on.
- Rule ids, issue codes (`issueCodes` in `src/rules.ts`), config keys and CLI flags are public contract; see "Stability" in `README.md`. Every new kind of issue gets its own code.
- `src/icu.ts` is a deliberate own parser. FormatJS reports offsets into unescaped text, but in-place fixes need source offsets. `@formatjs/icu-messageformat-parser` is only the test oracle in `test/icu.test.ts`.
- `src/locales.generated.ts` is generated from CLDR: change `scripts/build-locales.ts` and run `pnpm locales`, never edit the output.
- `test/fixtures/` holds invented copy only. Do not paste real product copy from other projects into tests.
- PRs are squash-merged with the PR title as the commit subject: one-line Conventional Commit, no trailing period.
