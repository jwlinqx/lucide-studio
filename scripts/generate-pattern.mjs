#!/usr/bin/env node
// Usage: node scripts/generate-pattern.mjs <file.svg> <name>
//
// Computes a pattern signature (vectors + points) for an SVG file in the
// same format used by src/lib/patterns.json / src/lib/manifold-patterns.json,
// so it can be matched by src/lib/get-pattern-matches.ts at runtime.
//
// This ports the segmentation/vector/point logic from src/lib/get-paths.ts
// and src/lib/get-pattern-matches.ts (TypeScript, React-typed) into plain
// ESM under scripts/lib/ so it can run standalone with `node` (no ts-node /
// Next.js build needed) via the app's existing svgson / element-to-path /
// svg-pathdata / lodash dependencies. If get-paths.ts or
// get-pattern-matches.ts ever change, re-port scripts/lib/*.mjs to match —
// they are NOT auto-synced.
//
// Generation convention (must match how the matcher searches for anchors):
//   - anchor = the FIRST path segment's "next" endpoint, in source-document
//     order (this corresponds to the matcher's own i=0 trial: it tries
//     paths[0]['next'] as a candidate anchor before any other segment/
//     endpoint combination).
//   - vectors/points are parallel arrays, one entry per path segment, in
//     the order svg-pathdata/getPaths produced them.
//   - Matching is translation-invariant but scale- and rotation-sensitive:
//     an SVG drawn at a different size or angle will NOT match, even if
//     it's conceptually "the same" shape.
//
// Prints JSON: { name, vectors, points, segmentCount }
import { readFileSync } from "node:fs";
import { getPaths } from "./lib/get-paths.mjs";
import { getVectors, getPoints } from "./lib/pattern-matches.mjs";

const [, , file, name] = process.argv;
if (!file) {
  console.error("Usage: node scripts/generate-pattern.mjs <file.svg> <name>");
  process.exit(1);
}

const src = readFileSync(file, "utf8");
const paths = getPaths(src);
if (paths.length === 0) {
  console.error(`No path segments found in ${file}`);
  process.exit(1);
}

const anchor = paths[0].next; // matches the matcher's i=0 -> paths[0]['next'] trial
const vectors = getVectors(paths);
const points = getPoints(paths, anchor);

console.log(
  JSON.stringify(
    { name: name || file, vectors, points, segmentCount: paths.length },
    null,
    2,
  ),
);
