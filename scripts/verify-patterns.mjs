#!/usr/bin/env node
// Usage:
//   node scripts/verify-patterns.mjs <manifoldTemplatesDir> [realIconFile...]
//
// <manifoldTemplatesDir> is the Manifold repo's
//   assets/iconography/templates/ directory (contains modifiers/svg/*.svg
//   and templates/svg/*.svg) — this lives in a sibling repo, not vendored
//   here, so it must be passed in.
// [realIconFile...] are optional paths to real icon SVGs (e.g. from
//   assets/iconography/icons-lucide/svg) to check for in-situ modifier
//   detection.
//
// Loads src/lib/patterns.json (lucide's 26 built-in patterns) together with
// src/lib/manifold-patterns.json (the new Manifold modifier/template
// patterns), and runs the ported getPatternMatches (scripts/lib/) over every
// Manifold source SVG to confirm:
//   1. every file fully matches its own expected pattern entry (self-match)
//   2. corner-variant families that are pure translations of one shape
//      (plus-add, quick-zap, x-delete, 3d) all resolve to the SAME entry
//   3. any unexpected/partial collisions with lucide's existing patterns are
//      surfaced rather than silently hidden
//
// This does not modify src/lib/patterns.json or src/lib/manifold-patterns.json;
// it is a read-only check.
import { readFileSync, readdirSync } from "node:fs";
import { getPaths } from "./lib/get-paths.mjs";
import { getPatternMatches, buildPatternMap } from "./lib/pattern-matches.mjs";

const [, , MOD_SRC, ...realIcons] = process.argv;
if (!MOD_SRC) {
  console.error(
    "Usage: node scripts/verify-patterns.mjs <manifoldTemplatesDir> [realIconFile...]",
  );
  process.exit(1);
}

const lucidePatterns = JSON.parse(
  readFileSync(new URL("../src/lib/patterns.json", import.meta.url), "utf8"),
);
const manifoldPatterns = JSON.parse(
  readFileSync(
    new URL("../src/lib/manifold-patterns.json", import.meta.url),
    "utf8",
  ),
);

// Exclusions applied by src/lib/get-pattern-matches.ts. Read from the shared
// JSON so this check sees exactly the pattern set the app loads.
const suppressedLucide = new Set(
  JSON.parse(
    readFileSync(
      new URL("../src/lib/suppressed-lucide-patterns.json", import.meta.url),
      "utf8",
    ),
  ),
);

const combined = {};
for (const [k, v] of Object.entries(lucidePatterns)) {
  if (suppressedLucide.has(k)) continue;
  combined[`lucide:${k}`] = v;
}
for (const [k, v] of Object.entries(manifoldPatterns)) combined[`manifold:${k}`] = v;
const combinedMap = buildPatternMap(combined);

const loadPaths = (file) => getPaths(readFileSync(file, "utf8"));

// Expected full-match key per source file. Three modifier families
// (check, plus-add, x-delete) were found to be pattern-identical to an
// existing lucide entry and were deliberately NOT duplicated into
// manifold-patterns.json — see the "skip mapping" notes below.
const EXPECT = {
  "modifier-3d-br.svg": "manifold:3d",
  "modifier-3d-tr.svg": "manifold:3d",
  "modifier-ai-sparkle-tr.svg": "manifold:ai-sparkle",
  "modifier-analysis-br.svg": "manifold:analysis",
  "modifier-angle-br.svg": "manifold:angle",
  "modifier-arrows-up-down.svg": "manifold:arrows-up-down",
  "modifier-change-switch.svg": "manifold:change-switch",
  "modifier-check-br.svg":
    "lucide:small check (consider increasing the size to 12x10)",
  "modifier-circle-gauge-br.svg": "manifold:circle-gauge",
  "modifier-clock-bl.svg": "manifold:clock",
  "modifier-cog-settings-bl.svg": "manifold:cog-settings-bl",
  "modifier-cog-settings-br.svg": "manifold:cog-settings-br",
  "modifier-design-bl.svg": "manifold:design-bl",
  "modifier-design-br.svg": "manifold:design-br",
  "modifier-droplet-br.svg": "manifold:droplet",
  "modifier-eraser-br.svg": "manifold:eraser",
  "modifier-pattern.svg": "manifold:pattern-mod",
  "modifier-pen-edit-bl.svg": "manifold:pen-edit-bl",
  "modifier-pen-edit-br.svg": "manifold:pen-edit-br",
  "modifier-pipe.svg": "manifold:pipe",
  "modifier-plus-add-bl.svg": "lucide:plus",
  "modifier-plus-add-br.svg": "lucide:plus",
  "modifier-plus-add-tl.svg": "lucide:plus",
  "modifier-plus-add-tr.svg": "lucide:plus",
  "modifier-preview-br.svg": "manifold:preview",
  "modifier-question-mark-bl.svg": "manifold:question-mark",
  "modifier-quick-zap-bl.svg": "manifold:quick-zap",
  "modifier-quick-zap-br.svg": "manifold:quick-zap",
  "modifier-quick-zap-tl.svg": "manifold:quick-zap",
  "modifier-quick-zap-tr.svg": "manifold:quick-zap",
  "modifier-thermometer-br.svg": "manifold:thermometer",
  "modifier-wave.svg": "manifold:wave",
  "modifier-x-delete-bl.svg": "lucide:x",
  "modifier-x-delete-br.svg": "lucide:x",
  "modifier-x-delete-tl.svg": "lucide:x",
  "modifier-x-delete-tr.svg": "lucide:x",
  "template-auto.svg": "manifold:template-auto",
  "template-chart.svg": "manifold:template-chart",
  "template-ruler.svg": "manifold:template-ruler",
};

console.log("=== Self-match check over all Manifold source SVGs ===");
let pass = 0,
  fail = 0;
for (const dir of ["modifiers/svg", "templates/svg"]) {
  for (const f of readdirSync(`${MOD_SRC}/${dir}`)) {
    const paths = loadPaths(`${MOD_SRC}/${dir}/${f}`);
    const matches = getPatternMatches(paths, combinedMap);
    const full = matches.filter((m) => m.paths.length === paths.length);
    const expectedKey = EXPECT[f];
    const gotExpected = full.some((m) => m.patternName === expectedKey);
    if (gotExpected) pass++;
    else fail++;
    console.log(
      `${gotExpected ? "PASS" : "FAIL"}  ${f.padEnd(32)} expected=${(expectedKey || "?").padEnd(28)} full-hits=[${full
        .map((m) => m.patternName)
        .join(", ")}]  all-hits=[${matches
        .map((m) => `${m.patternName}(${m.paths.length}/${paths.length})`)
        .join(", ")}]`,
    );
  }
}
console.log(`\nSelf-match: ${pass} pass, ${fail} fail (of ${pass + fail})`);

console.log("\n=== Corner-variant shared-entry check ===");
const groups = {
  "plus-add (skipped -> lucide:plus)": [
    "modifier-plus-add-bl.svg",
    "modifier-plus-add-br.svg",
    "modifier-plus-add-tl.svg",
    "modifier-plus-add-tr.svg",
  ],
  "quick-zap": [
    "modifier-quick-zap-bl.svg",
    "modifier-quick-zap-br.svg",
    "modifier-quick-zap-tl.svg",
    "modifier-quick-zap-tr.svg",
  ],
  "x-delete (skipped -> lucide:x)": [
    "modifier-x-delete-bl.svg",
    "modifier-x-delete-br.svg",
    "modifier-x-delete-tl.svg",
    "modifier-x-delete-tr.svg",
  ],
  "3d": ["modifier-3d-br.svg", "modifier-3d-tr.svg"],
};
for (const [group, files] of Object.entries(groups)) {
  const results = files.map((f) => {
    const paths = loadPaths(`${MOD_SRC}/modifiers/svg/${f}`);
    const matches = getPatternMatches(paths, combinedMap).filter(
      (m) => m.paths.length === paths.length,
    );
    return `${f}=>[${matches.map((m) => m.patternName).join(",")}]`;
  });
  console.log(`${group}: ${results.join("  ")}`);
}

if (realIcons.length) {
  console.log("\n=== In-situ detection on real icons ===");
  for (const f of realIcons) {
    const paths = loadPaths(f);
    const matches = getPatternMatches(paths, combinedMap);
    console.log(
      `${f}\n  total segments=${paths.length}  matches=[${
        matches.map((m) => `${m.patternName}(${m.paths.length})`).join(", ") ||
        "none"
      }]`,
    );
  }
}
