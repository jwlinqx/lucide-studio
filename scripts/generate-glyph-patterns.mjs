#!/usr/bin/env node
// Usage: node scripts/generate-glyph-patterns.mjs <manifoldTemplatesDir> [--write]
//
// Batch-generates pattern entries for every letter and numeral template in the
// Manifold repo's assets/iconography/templates/ directory and merges them into
// src/lib/manifold-patterns.json.
//
// Uses the same signature logic as scripts/generate-pattern.mjs (anchor =
// paths[0].next, vectors/points parallel arrays). Matching is scale-sensitive,
// so each size of a glyph is a DISTINCT pattern — which is what lets the
// gapOverlap policy differ per size.
//
// Policy, per the design call on 2026-08-18:
//   *-24  -> no gapOverlap key (falls through to "error", red hatch). At 24 the
//            glyph fills the canvas, so a margin collision is a real problem.
//   *-12  -> "warn" (yellow hatch)
//   *-8   -> "warn" (yellow hatch)
//            At 12 and 8 the glyph is a modifier sitting inside a host icon;
//            crowded margins are inherent to the small sizes.
//
// Without --write it prints a summary and writes nothing.
import { readFileSync, writeFileSync, readdirSync, existsSync } from "node:fs";
import { join, basename } from "node:path";
import { getPaths } from "./lib/get-paths.mjs";
import { getVectors, getPoints } from "./lib/pattern-matches.mjs";

const [, , TEMPLATES_DIR, ...flags] = process.argv;
const WRITE = flags.includes("--write");

if (!TEMPLATES_DIR) {
  console.error(
    "Usage: node scripts/generate-glyph-patterns.mjs <manifoldTemplatesDir> [--write]",
  );
  process.exit(1);
}

// Only glyph families. `modifiers/` and `templates/` are handled elsewhere.
const GLYPH_FAMILIES = [
  "arabic-numerals-8",
  "arabic-numerals-12",
  "arabic-numerals-24",
  "latin-uppercase-8",
  "latin-uppercase-12",
  "latin-uppercase-24",
  "latin-lowercase-24",
  "greek-lowercase-24",
];

const gapOverlapForSize = (size) => (size === 24 ? null : "warn");

// Glyphs that are the SAME drawing at the same size collapse into one shared
// entry, because no signature can tell them apart. At size 8 the numeral 0
// drops the slash it carries at 24 ("M16 6 9 19") and 12 ("M8 3 4 9"), which
// makes it byte-identical to the uppercase O. Two entries meant two stacked
// labels on one shape, so they share a key instead.
//
// Left side = generated key (source filename), right side = shared key. The
// merged entry is written once; the superseded keys are deleted on --write.
// Signatures are asserted identical, so this cannot silently mask a real
// difference if a template is redrawn.
const MERGED_KEYS = {
  "numeral-0-8": "Tiny-0/O",
  "letter-o-uppercase-8": "Tiny-0/O",
};

// Size carries a word, not a number: 8 is the "Tiny" cut, 12 the "Small" cut,
// and 24 is the glyph itself with no qualifier, since it is the base drawing.
//   letter-d-uppercase-8   -> Tiny-D
//   letter-d-uppercase-12  -> Small-D
//   letter-d-uppercase-24  -> D
//   letter-e-lowercase-24  -> e
//   letter-eta-lowercase-24 -> eta
//   numeral-0-12           -> Small-0
const SIZE_PREFIX = { 8: "Tiny-", 12: "Small-", 24: "" };

// The glyph itself, casing preserved: "D", "e", "eta", "0".
const glyphNameFor = (name) => {
  const numeral = name.match(/^numeral-(.+)-\d+$/);
  if (numeral) return numeral[1];
  const letter = name.match(/^letter-(.+)-(uppercase|lowercase)-\d+$/);
  if (letter) {
    const [, glyph, casing] = letter;
    return glyph.length === 1 && casing === "uppercase"
      ? glyph.toUpperCase()
      : glyph;
  }
  return name;
};

const keyFor = (name, size) => `${SIZE_PREFIX[size] ?? ""}${glyphNameFor(name)}`;

// Keys from the previous filename-based convention (letter-*, numeral-*).
// Deleted on --write so a rename does not leave both generations loaded.
const isLegacyGlyphKey = (key) => /^(letter|numeral)-/.test(key);

const entries = [];
const skipped = [];

for (const family of GLYPH_FAMILIES) {
  const dir = join(TEMPLATES_DIR, family, "svg");
  if (!existsSync(dir)) {
    skipped.push(`${family} (no svg/ dir)`);
    continue;
  }
  const size = Number(family.match(/-(\d+)$/)[1]);

  for (const file of readdirSync(dir).filter((f) => f.endsWith(".svg")).sort()) {
    const name = basename(file, ".svg");
    const paths = getPaths(readFileSync(join(dir, file), "utf8"));
    if (paths.length === 0) {
      skipped.push(`${file} (no path segments)`);
      continue;
    }

    const key = MERGED_KEYS[name] ?? keyFor(name, size);
    const gapOverlap = gapOverlapForSize(size);
    // Key order is for diff readability only: label, severity, glyph,
    // gapOverlap, vectors, points. `glyph` marks this entry as generated from
    // a template file, so a re-run can tell its own output from hand-authored
    // modifier and template patterns.
    const ordered = {
      label: key,
      severity: "info",
      glyph: true,
      ...(gapOverlap ? { gapOverlap } : {}),
      vectors: getVectors(paths),
      points: getPoints(paths, paths[0].next),
    };

    entries.push({
      key,
      sourceName: name,
      family,
      size,
      segments: paths.length,
      ordered,
    });
  }
}

const targetUrl = new URL("../src/lib/manifold-patterns.json", import.meta.url);
const existing = JSON.parse(readFileSync(targetUrl, "utf8"));

const signature = (p) => `${p.vectors.join(",")}|${p.points.join(",")}`;

// Collapse entries that MERGED_KEYS routed to a shared key. Their signatures
// must be identical — if a template is redrawn so they diverge, fail loudly
// rather than silently keeping whichever came last.
const collapsed = new Map();
for (const entry of entries) {
  const prior = collapsed.get(entry.key);
  if (!prior) {
    collapsed.set(entry.key, { ...entry, sources: [entry.sourceName] });
    continue;
  }
  if (signature(prior.ordered) !== signature(entry.ordered)) {
    console.error(
      `MERGE CONFLICT: ${prior.sources.join(", ")} and ${entry.sourceName} both map to "${entry.key}" but their signatures differ. Remove them from MERGED_KEYS or reconcile the templates.`,
    );
    process.exit(1);
  }
  prior.sources.push(entry.sourceName);
}
const finalEntries = [...collapsed.values()];

// Keys this run supersedes: anything merged away, plus any leftover key from
// the old filename-based convention.
const supersededKeys = [
  ...new Set([
    ...Object.keys(MERGED_KEYS).filter((k) => k in existing),
    ...Object.keys(existing).filter(isLegacyGlyphKey),
  ]),
];

// A generated key must not collide with a hand-authored pattern (modifiers,
// templates). Entries this script wrote carry `"glyph": true`, so re-runs
// recognise their own output instead of reporting it as a collision.
const mergeTargets = new Set(Object.values(MERGED_KEYS));
const reserved = new Set(
  Object.keys(existing).filter(
    (k) =>
      !isLegacyGlyphKey(k) &&
      existing[k].glyph !== true &&
      !mergeTargets.has(k),
  ),
);

// Signature-level duplicate detection across everything that will be loaded.
// Entries this run replaces are excluded, or every re-run would report each
// glyph as a duplicate of its own previous self.
const replacedKeys = new Set([
  ...finalEntries.map(({ key }) => key),
  ...supersededKeys,
]);
const bySignature = new Map();
for (const [key, val] of Object.entries(existing)) {
  if (replacedKeys.has(key)) continue;
  bySignature.set(signature(val), [`manifold:${key}`]);
}
const lucide = JSON.parse(
  readFileSync(new URL("../src/lib/patterns.json", import.meta.url), "utf8"),
);
// Same exclusions the app applies in src/lib/get-pattern-matches.ts, so this
// report cannot flag collisions against patterns that are never loaded.
const suppressed = new Set(
  JSON.parse(
    readFileSync(
      new URL("../src/lib/suppressed-lucide-patterns.json", import.meta.url),
      "utf8",
    ),
  ),
);
for (const [key, val] of Object.entries(lucide)) {
  if (suppressed.has(key)) continue;
  const sig = signature(val);
  bySignature.set(sig, [...(bySignature.get(sig) || []), `lucide:${key}`]);
}
const dupes = [];
for (const { key, ordered } of finalEntries) {
  const sig = signature(ordered);
  const prior = bySignature.get(sig);
  if (prior) dupes.push(`${key} <-> ${prior.join(", ")}`);
  bySignature.set(sig, [...(prior || []), `manifold:${key}`]);
}

const byPolicy = finalEntries.reduce((acc, e) => {
  const p = e.ordered.gapOverlap ?? "error (default, key absent)";
  acc[p] = (acc[p] || 0) + 1;
  return acc;
}, {});

console.log(
  `glyph patterns generated: ${finalEntries.length} (from ${entries.length} template files)`,
);
for (const [policy, count] of Object.entries(byPolicy))
  console.log(`  ${policy}: ${count}`);
for (const { key, sources } of finalEntries.filter((e) => e.sources.length > 1))
  console.log(`  merged into "${key}": ${sources.join(" + ")}`);
if (skipped.length) console.log(`skipped:\n  ${skipped.join("\n  ")}`);
if (supersededKeys.length)
  console.log(`superseded keys to delete: ${supersededKeys.length}`);

const reservedHits = finalEntries
  .filter(({ key }) => reserved.has(key) && !(key in MERGED_KEYS))
  .map(({ key, sources }) => `${key} (from ${sources.join(", ")})`);
if (reservedHits.length) {
  console.error(
    `KEY COLLISION with a non-glyph pattern:\n  ${reservedHits.join("\n  ")}\nRename via MERGED_KEYS or adjust SIZE_PREFIX.`,
  );
  process.exit(1);
}
if (dupes.length) console.log(`DUPLICATE SIGNATURES:\n  ${dupes.join("\n  ")}`);

if (!WRITE) {
  console.log("\ndry run, nothing written. re-run with --write");
  process.exit(0);
}

const merged = { ...existing };
for (const key of supersededKeys) delete merged[key];
for (const { key, ordered } of finalEntries) merged[key] = ordered;

writeFileSync(targetUrl, `${JSON.stringify(merged, null, 2)}\n`);
console.log(
  `\nwrote ${finalEntries.length} entries to src/lib/manifold-patterns.json (${Object.keys(merged).length} total, ${supersededKeys.length} deleted)`,
);
