// Usage: node scripts/release-changelog.ts X.Y.Z > notes.md
// Renames `## Unreleased` in CHANGELOG.md to `## X.Y.Z`, adds an empty `## Unreleased` above it,
// and prints the released section for the GitHub release notes.
import { readFileSync, writeFileSync } from "node:fs";

const [version] = process.argv.slice(2);
if (!/^\d+\.\d+\.\d+(-[0-9A-Za-z.-]+)?$/.test(version ?? "")) throw new Error(`Invalid version: ${version}`);
const file = new URL("../CHANGELOG.md", import.meta.url);
const changelog = readFileSync(file, "utf8");
if (changelog.includes(`\n## ${version}\n`)) throw new Error(`CHANGELOG.md already has ## ${version}`);
const match = /\n## Unreleased\n([\s\S]*?)(?=\n## |$)/.exec(changelog);
const notes = match?.[1]?.trim();
if (!match || !notes) throw new Error("CHANGELOG.md has no entries under ## Unreleased");
writeFileSync(file, changelog.replace(match[0], `\n## Unreleased\n\n## ${version}\n\n${notes}\n`));
console.log(notes);
