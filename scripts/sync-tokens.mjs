#!/usr/bin/env node
// Usage: node scripts/sync-tokens.mjs [path-to-manifold-repo]
//
// Copies the generated primitives.json swatch feed out of the Manifold
// design-system-tokens repo into src/lib/tokens/primitives.json so
// lucide-studio can consume it without a live dependency on that repo
// being checked out at build/run time.
//
// Source resolution order:
//   1. argv[2] (explicit path to the Manifold repo root), if given
//   2. MANIFOLD_REPO env var (path to the Manifold repo root), if set
//   3. default: "../../Manifold" relative to this studio repo's root
//      (i.e. sibling of the parent dir this repo lives in)
//
// In all three cases the repo-root path has
// "design-system-tokens/dist/json/primitives.json" appended to find the
// actual feed file.
//
// Refuses with a clear error if the source file does not exist. On
// success, prints the number of primitive stops copied.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(__dirname, "..");

const FEED_SUFFIX = "design-system-tokens/dist/json/primitives.json";

function resolveManifoldRepoRoot() {
  const fromArgv = process.argv[2];
  if (fromArgv) {
    return resolve(process.cwd(), fromArgv);
  }
  if (process.env.MANIFOLD_REPO) {
    return resolve(process.cwd(), process.env.MANIFOLD_REPO);
  }
  // Default: ../../Manifold relative to this studio repo's root.
  return resolve(repoRoot, "../../Manifold");
}

function countStops(json) {
  let count = 0;
  for (const set of json.sets ?? []) {
    for (const family of set.families ?? []) {
      count += (family.stops ?? []).length;
    }
  }
  return count;
}

function main() {
  const manifoldRepoRoot = resolveManifoldRepoRoot();
  const sourcePath = join(manifoldRepoRoot, FEED_SUFFIX);

  if (!existsSync(sourcePath)) {
    console.error(
      `sync-tokens: source file not found at:\n  ${sourcePath}\n\n` +
        `Resolved Manifold repo root: ${manifoldRepoRoot}\n\n` +
        `Fix by either:\n` +
        `  - passing the Manifold repo path as argv[2]:\n` +
        `      node scripts/sync-tokens.mjs /path/to/Manifold\n` +
        `  - setting MANIFOLD_REPO env var:\n` +
        `      MANIFOLD_REPO=/path/to/Manifold node scripts/sync-tokens.mjs\n` +
        `  - or checking out the Manifold repo at the default location:\n` +
        `      ${resolve(repoRoot, "../../Manifold")}\n`,
    );
    process.exit(1);
  }

  const raw = readFileSync(sourcePath, "utf8");
  let json;
  try {
    json = JSON.parse(raw);
  } catch (err) {
    console.error(`sync-tokens: source file is not valid JSON: ${sourcePath}\n${err.message}`);
    process.exit(1);
  }

  const destDir = join(repoRoot, "src/lib/tokens");
  const destPath = join(destDir, "primitives.json");
  mkdirSync(destDir, { recursive: true });
  writeFileSync(destPath, raw);

  const stopCount = countStops(json);
  console.log(
    `sync-tokens: copied ${stopCount} primitive stops from\n  ${sourcePath}\nto\n  ${destPath}`,
  );
}

main();
