import React from "react";
import { pathToPoints } from "@/lib/path-to-points";
import { Path, PathProps } from "@/lib/get-paths";

export const GapViolationHighlight = ({
  radius,
  stroke,
  strokeWidth,
  strokeOpacity,
  paths,
  exemptGroups = [],
  warnGroups = [],
  warnStroke,
  ...props
}: {
  paths: Path[];
  // Each entry is the set of subpath ids covered by one matched pattern whose
  // `gapOverlap` policy is "allow" / "warn". A pair is only reclassified when
  // BOTH colliding groups sit entirely inside the same entry, so a collision
  // with anything outside the pattern still renders as an error.
  exemptGroups?: number[][];
  warnGroups?: number[][];
  warnStroke?: string;
} & PathProps<"stroke" | "strokeOpacity" | "strokeWidth", "d">) => {
  const id = React.useId();

  const groupedPaths = Object.entries(
    paths.reduce(
      (groups, val) => {
        const key = val.c.id;
        groups[key] = [...(groups[key] || []), val];
        return groups;
      },
      {} as Record<number, Path[]>,
    ),
  );

  const groups: Group[] = [];

  for (const [pathId, paths] of groupedPaths) {
    const d = paths.map((path) => path.d).join(" ");
    const points = paths.flatMap((path) => pathToPoints(path));
    groups.push({ id: d, points, pathId: Number(pathId) });
  }

  const mergedGroups = mergeGroups(groups, 2);

  const coveredBy = (groups: number[][], a: MergedGroup, b: MergedGroup) =>
    groups.some((ids) => {
      const set = new Set(ids);
      return (
        a.pathIds.every((pathId) => set.has(pathId)) &&
        b.pathIds.every((pathId) => set.has(pathId))
      );
    });

  // allow wins over warn, warn wins over error.
  const policyFor = (a: MergedGroup, b: MergedGroup) =>
    coveredBy(exemptGroups, a, b)
      ? "allow"
      : coveredBy(warnGroups, a, b)
        ? "warn"
        : "error";

  return (
    <g {...props}>
      <defs xmlns="http://www.w3.org/2000/svg">
        <pattern
          id={`backdrop-pattern-${id}`}
          width=".1"
          height=".1"
          patternUnits="userSpaceOnUse"
          patternTransform="rotate(45 50 50)"
        >
          <line stroke={stroke} strokeWidth={0.1} y2={1} />
          <line stroke={stroke} strokeWidth={0.1} y2={1} />
        </pattern>
        <pattern
          id={`backdrop-pattern-warn-${id}`}
          width=".1"
          height=".1"
          patternUnits="userSpaceOnUse"
          patternTransform="rotate(-45 50 50)"
        >
          <line stroke={warnStroke ?? stroke} strokeWidth={0.1} y2={1} />
          <line stroke={warnStroke ?? stroke} strokeWidth={0.1} y2={1} />
        </pattern>
      </defs>
      {mergedGroups.flatMap((group, idx, arr) =>
        arr.slice(0, idx).map((val, i) => {
          const policy = policyFor(group, val);
          if (policy === "allow") return null;
          return (
            <g strokeWidth={strokeWidth} key={i} data-gap-policy={policy}>
              <mask
                id={`svg-preview-backdrop-mask-${id}-${i}`}
                maskUnits="userSpaceOnUse"
              >
                <path stroke="white" d={val.ds.join(" ")} />
              </mask>
              <path
                d={group.ds.join(" ")}
                stroke={
                  policy === "warn"
                    ? `url(#backdrop-pattern-warn-${id})`
                    : `url(#backdrop-pattern-${id})`
                }
                strokeWidth={strokeWidth}
                strokeOpacity={strokeOpacity}
                mask={`url(#svg-preview-backdrop-mask-${id}-${i})`}
              />
            </g>
          );
        }),
      )}
    </g>
  );
};

type Point = { x: number; y: number };
type Group = { id: string; points: Point[]; pathId: number };
type MergedGroup = { ds: string[]; pathIds: number[] };

// Euclidean distance
function distance(a: Point, b: Point): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

// Check if two groups should be merged based on minimum distance
function shouldMerge(a: Group, b: Group, minDistance: number): boolean {
  for (const pa of a.points) {
    for (const pb of b.points) {
      if (distance(pa, pb) <= minDistance) {
        return true;
      }
    }
  }
  return false;
}

// Merge groups and return, per merged group, its path `d` strings and the
// subpath ids it was built from (the ids are what the exemption is keyed on).
function mergeGroups(groups: Group[], minDistance: number): MergedGroup[] {
  const mergedGroups: Group[][] = groups.map((g) => [g]);

  let changed = true;
  while (changed) {
    changed = false;

    outer: for (let i = 0; i < mergedGroups.length; i++) {
      for (let j = i + 1; j < mergedGroups.length; j++) {
        // Check if any group in mergedGroups[i] should merge with any in mergedGroups[j]
        if (
          mergedGroups[i].some((ga) =>
            mergedGroups[j].some((gb) => shouldMerge(ga, gb, minDistance)),
          )
        ) {
          // Merge group j into group i
          mergedGroups[i] = [...mergedGroups[i], ...mergedGroups[j]];
          mergedGroups.splice(j, 1);
          changed = true;
          break outer;
        }
      }
    }
  }

  return mergedGroups.map((groupList) => ({
    ds: groupList.map((g) => g.id),
    pathIds: groupList.map((g) => g.pathId),
  }));
}
