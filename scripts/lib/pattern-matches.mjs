// Ported from lucide-studio src/lib/get-pattern-matches.ts (verbatim logic).
// Unlike the app version, this takes a `patterns` Map as an argument instead of
// reading src/lib/patterns.json directly, so the harness can combine lucide + manifold sets.

export function buildPatternMap(patternData) {
  return new Map(
    Object.entries(patternData).map(([patternName, pattern]) => [
      patternName,
      {
        vectors: new Set(pattern.vectors),
        points: new Set(pattern.points),
        size: pattern.vectors.length,
      },
    ]),
  );
}

export const getVectors = (paths) =>
  paths.map(
    ({ next, prev, c }) =>
      (c.type === 8 || c.type === 4 || c.type === 1 ? 16 : c.type) +
      "|" +
      Math.round(Math.abs(next.x - prev.x) * 10) / 10 +
      "|" +
      Math.round(Math.abs(next.y - prev.y) * 10) / 10,
  );

export const getPoints = (paths, offset = { x: 0, y: 0 }) =>
  paths.map(
    ({ prev, next }) =>
      Math.round(((prev.x + next.x) / 2 - offset.x) * 10) / 10 +
      "|" +
      Math.round(((prev.y + next.y) / 2 - offset.y) * 10) / 10,
  );

export const getPatternMatches = (paths, patterns) => {
  const vectors = getVectors(paths);
  const vectorSet = new Set(vectors);

  const output = [];
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
      const matchedPaths = [];
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
      output.push({ patternName, paths: matchedPaths });
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

  // Mirror of the most-specific filter in src/lib/get-pattern-matches.ts.
  // Drops any match whose path set is a STRICT subset of another match's.
  // Keep the two in sync — they are not auto-synced.
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
