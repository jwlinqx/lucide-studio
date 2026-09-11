import patternData from "@/lib/patterns.json";
import manifoldPatternData from "@/lib/manifold-patterns.json";
import suppressedLucidePatterns from "@/lib/suppressed-lucide-patterns.json";
import { Path } from "@/lib/get-paths";

export type PatternSeverity = "info" | "warning";

// How the gap/margin overlap lint treats collisions *between the paths of this
// pattern*. Collisions with anything outside the pattern always stay "error".
//   error - default. Red hatch, the stock lucide behaviour.
//   warn  - yellow hatch. For letter and number glyphs, whose strokes crowd
//           each other as a property of the type design rather than a mistake.
//   allow - no hatch. For shapes that interlock by design (the 3d modifier).
export type GapOverlapPolicy = "error" | "warn" | "allow";

const GAP_OVERLAP_POLICIES: GapOverlapPolicy[] = ["error", "warn", "allow"];

const readGapOverlap = (pattern: object): GapOverlapPolicy => {
  if (!("gapOverlap" in pattern)) return "error";
  const value = (pattern as { gapOverlap: unknown }).gapOverlap;
  return GAP_OVERLAP_POLICIES.includes(value as GapOverlapPolicy)
    ? (value as GapOverlapPolicy)
    : "error";
};

type PatternSource = {
  vectors: string[];
  points: string[];
  label: string;
  severity: PatternSeverity;
  gapOverlap: GapOverlapPolicy;
};

// Upstream lucide patterns that Manifold deliberately does not load.
// patterns.json is left byte-identical to upstream so it can be re-vendored
// without conflicts; the exclusions are declared here instead.
//
//   zero, big zero - lucide draws these as a plain rounded rect. In Manifold
//     that shape is the letter O (latin-uppercase-24/12), not a zero: our
//     numerals carry a slash (numeral-0-24 adds "M16 6 9 19", numeral-0-12
//     adds "M8 3 4 9"). Leaving them loaded labelled every O as a zero and
//     forced the collision to resolve across the lucide/manifold boundary.
//     Note this does not fully disambiguate at size 8, where our own 0 drops
//     the slash and is genuinely identical to our O.
//
// The list lives in its own JSON file so scripts/*.mjs (which cannot import
// this module) read the same source of truth instead of a hand-kept copy.
const SUPPRESSED_LUCIDE_PATTERNS = new Set<string>(suppressedLucidePatterns);

// Upstream lucide patterns encode severity in name length (>16 chars = warning).
// Manifold patterns carry explicit label/severity fields instead.
const allPatterns: [string, PatternSource][] = [
  ...Object.entries(patternData)
    .filter(([patternName]) => !SUPPRESSED_LUCIDE_PATTERNS.has(patternName))
    .map(
      ([patternName, pattern]): [string, PatternSource] => [
        patternName,
        {
          ...pattern,
          label: patternName,
          severity: patternName.length > 16 ? "warning" : "info",
          gapOverlap: "error",
        },
      ],
    ),
  ...Object.entries(manifoldPatternData).map(
    ([patternName, pattern]): [string, PatternSource] => [
      patternName,
      {
        vectors: pattern.vectors,
        points: pattern.points,
        label: pattern.label ?? patternName,
        severity: pattern.severity === "warning" ? "warning" : "info",
        gapOverlap: readGapOverlap(pattern),
      },
    ],
  ),
];

const patterns = new Map(
  allPatterns.map(([patternName, pattern]) => [
    patternName,
    {
      vectors: new Set(pattern.vectors),
      points: new Set(pattern.points),
      size: pattern.vectors.length,
      label: pattern.label,
      severity: pattern.severity,
      gapOverlap: pattern.gapOverlap,
    },
  ]),
);

export const getPatternMatches = (paths: Path[]) => {
  const vectors = getVectors(paths);
  const vectorSet = new Set(vectors);

  const output: {
    patternName: string;
    label: string;
    severity: PatternSeverity;
    gapOverlap: GapOverlapPolicy;
    paths: Path[];
  }[] = [];
  for (const [patternName, pattern] of patterns) {
    if (!pattern.vectors.isSubsetOf(vectorSet)) continue;

    for (let i = 0; i < paths.length * 2; i++) {
      if (!pattern.vectors.has(vectors[Math.floor(i / 2)])) continue;
      const points = getPoints(
        paths,
        paths[Math.floor(i / 2)][i % 2 ? "prev" : "next"],
      );
      const pointSet = new Set(points);
      if (!pattern.points.isSubsetOf(pointSet)) continue;
      const matchedPaths: Path[] = [];
      for (
        let j = 0;
        j < paths.length && matchedPaths.length < pattern.size;
        j++
      ) {
        if (!pattern.vectors.has(vectors[j])) continue;
        if (!pattern.points.has(points[j])) continue;
        matchedPaths.push(paths[j]);
      }
      if (matchedPaths.length !== pattern.size) continue;
      output.push({
        patternName,
        label: pattern.label,
        severity: pattern.severity,
        gapOverlap: pattern.gapOverlap,
        paths: matchedPaths,
      });
    }
  }
  const deduped = output.filter(
    (val, idx, arr) =>
      arr.findIndex(
        (t) =>
          t.patternName === val.patternName &&
          t.paths.every(
            ({ c: { id, idx } }, i) =>
              id === val.paths[i].c.id && idx === val.paths[i].c.idx,
          ),
      ) === idx,
  );

  // Keep only the most specific match per set of paths.
  //
  // Matching is subset-based: a pattern hits when its vectors and points are
  // contained in the drawing. So a drawn E also fully matches F and L, whose
  // segments are a subset of E's; likewise B and R contain P, Q contains O,
  // I contains T, and the slashed numeral 0 contains the letter O. That
  // stacked two or three labels on one glyph.
  //
  // Strict subsets only. Two patterns covering the EXACT same paths are left
  // alone, since neither is more specific and silently picking one would hide
  // a genuine duplicate that should be reconciled in the pattern data.
  const pathKeys = deduped.map(
    ({ paths: matched }) => new Set(matched.map(({ c }) => `${c.id}-${c.idx}`)),
  );
  return deduped.filter((_, idx) => {
    const own = pathKeys[idx];
    return !pathKeys.some(
      (other, j) =>
        j !== idx &&
        own.size < other.size &&
        [...own].every((key) => other.has(key)),
    );
  });
};

const getVectors = (paths: Path[]) =>
  paths.map(
    ({ next, prev, c }) =>
      (c.type === 8 || c.type === 4 || c.type === 1 ? 16 : c.type) +
      "|" +
      Math.round(Math.abs(next.x - prev.x) * 10) / 10 +
      "|" +
      Math.round(Math.abs(next.y - prev.y) * 10) / 10,
  );

const getPoints = (
  paths: Path[],
  offset: { x: number; y: number } = { x: 0, y: 0 },
) =>
  paths.map(
    ({ prev, next }) =>
      Math.round(((prev.x + next.x) / 2 - offset.x) * 10) / 10 +
      "|" +
      Math.round(((prev.y + next.y) / 2 - offset.y) * 10) / 10,
  );
