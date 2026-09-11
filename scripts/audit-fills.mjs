#!/usr/bin/env node
// Usage: node scripts/audit-fills.mjs <file.svg ...>
//
// Extracts every distinct fill color used across the given SVG files
// (fill="#rrggbb" attributes AND style="fill:#rrggbb" declarations, both
// occur across LINQX artwork), normalizes shorthand 3-digit hex to
// lowercase 6-digit, and matches each color against the nearest LINQX/XIQ
// primitive token stop by CIEDE2000 distance (ordinary sRGB path, D65
// white point). Prints a table: hex, file count, nearest token, dE,
// verdict.
//
// Verdict thresholds (ruled 2026-08 audit):
//   dE < 1.5          -> drift       (same token, rounding/gamut noise)
//   1.5 <= dE <= 4     -> review      (close relative, needs a human call)
//   dE > 4            -> off-system  (no matching primitive; likely improvised)
//
// This script intentionally vendors its own CIEDE2000 implementation
// instead of adding culori as a dependency (no package.json edits here).
// The math below is validated against four known-good anchor pairs from
// the prior manual audit (see docs / audit history); if you touch this
// file, re-run it against those anchors before trusting new output:
//   #017ea6 vs cyan 500 (#007ea6)      -> dE 0.03
//   #007ea6 vs cyan 500 (#007ea6)      -> dE 0.00
//   #65b45a vs XIQ green 300 (#66b45b) -> dE 0.18
//   #2b773b vs XIQ green 500 (#27761b) -> dE 5.53 (nearest "500" stop)
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));

// ---------------------------------------------------------------------
// Color math: sRGB (hex) -> linear sRGB -> XYZ (D65) -> CIELAB -> CIEDE2000
// ---------------------------------------------------------------------

function srgbToLinear(c) {
  const cn = c / 255;
  return cn <= 0.04045 ? cn / 12.92 : ((cn + 0.055) / 1.055) ** 2.4;
}

function hexToLab(hex) {
  const h = hex.replace("#", "");
  const r = parseInt(h.slice(0, 2), 16);
  const g = parseInt(h.slice(2, 4), 16);
  const b = parseInt(h.slice(4, 6), 16);

  const rl = srgbToLinear(r);
  const gl = srgbToLinear(g);
  const bl = srgbToLinear(b);

  // sRGB (linear) -> XYZ, D65
  const X = rl * 0.4124564 + gl * 0.3575761 + bl * 0.1804375;
  const Y = rl * 0.2126729 + gl * 0.7151522 + bl * 0.072175;
  const Z = rl * 0.0193339 + gl * 0.119192 + bl * 0.9503041;

  const Xn = 0.95047;
  const Yn = 1.0;
  const Zn = 1.08883;

  const x = X / Xn;
  const y = Y / Yn;
  const z = Z / Zn;

  const d = 6 / 29;
  const f = (t) => (t > d ** 3 ? Math.cbrt(t) : t / (3 * d ** 2) + 4 / 29);

  const fx = f(x);
  const fy = f(y);
  const fz = f(z);

  const L = 116 * fy - 16;
  const a = 500 * (fx - fy);
  const bb = 200 * (fy - fz);

  return { L, a, b: bb };
}

function deg(rad) {
  return (rad * 180) / Math.PI;
}
function rad(degrees) {
  return (degrees * Math.PI) / 180;
}

// Standard CIEDE2000 (Sharma et al.) implementation.
function ciede2000(lab1, lab2) {
  const kL = 1;
  const kC = 1;
  const kH = 1;

  const { L: L1, a: a1, b: b1 } = lab1;
  const { L: L2, a: a2, b: b2 } = lab2;

  const C1 = Math.sqrt(a1 * a1 + b1 * b1);
  const C2 = Math.sqrt(a2 * a2 + b2 * b2);
  const Cbar = (C1 + C2) / 2;

  const G = 0.5 * (1 - Math.sqrt(Cbar ** 7 / (Cbar ** 7 + 25 ** 7)));
  const a1p = (1 + G) * a1;
  const a2p = (1 + G) * a2;

  const C1p = Math.sqrt(a1p * a1p + b1 * b1);
  const C2p = Math.sqrt(a2p * a2p + b2 * b2);

  const hpAtan = (ap, b) => {
    if (ap === 0 && b === 0) return 0;
    const h = deg(Math.atan2(b, ap));
    return h < 0 ? h + 360 : h;
  };

  const h1p = hpAtan(a1p, b1);
  const h2p = hpAtan(a2p, b2);

  const dLp = L2 - L1;
  const dCp = C2p - C1p;

  let dhp;
  if (C1p * C2p === 0) {
    dhp = 0;
  } else if (Math.abs(h2p - h1p) <= 180) {
    dhp = h2p - h1p;
  } else if (h2p - h1p > 180) {
    dhp = h2p - h1p - 360;
  } else {
    dhp = h2p - h1p + 360;
  }

  const dHp = 2 * Math.sqrt(C1p * C2p) * Math.sin(rad(dhp) / 2);

  const Lbarp = (L1 + L2) / 2;
  const Cbarp = (C1p + C2p) / 2;

  let hbarp;
  if (C1p * C2p === 0) {
    hbarp = h1p + h2p;
  } else if (Math.abs(h1p - h2p) <= 180) {
    hbarp = (h1p + h2p) / 2;
  } else if (h1p + h2p < 360) {
    hbarp = (h1p + h2p + 360) / 2;
  } else {
    hbarp = (h1p + h2p - 360) / 2;
  }

  const T =
    1 -
    0.17 * Math.cos(rad(hbarp - 30)) +
    0.24 * Math.cos(rad(2 * hbarp)) +
    0.32 * Math.cos(rad(3 * hbarp + 6)) -
    0.2 * Math.cos(rad(4 * hbarp - 63));

  const dTheta = 30 * Math.exp(-(((hbarp - 275) / 25) ** 2));
  const RC = 2 * Math.sqrt(Cbarp ** 7 / (Cbarp ** 7 + 25 ** 7));
  const SL = 1 + (0.015 * (Lbarp - 50) ** 2) / Math.sqrt(20 + (Lbarp - 50) ** 2);
  const SC = 1 + 0.045 * Cbarp;
  const SH = 1 + 0.015 * Cbarp * T;
  const RT = -Math.sin(rad(2 * dTheta)) * RC;

  const dLTerm = dLp / (kL * SL);
  const dCTerm = dCp / (kC * SC);
  const dHTerm = dHp / (kH * SH);

  return Math.sqrt(dLTerm ** 2 + dCTerm ** 2 + dHTerm ** 2 + RT * dCTerm * dHTerm);
}

function ciede2000Hex(hexA, hexB) {
  return ciede2000(hexToLab(hexA), hexToLab(hexB));
}

// Self-check against the four known-good anchors. Warn (do not crash) if
// drift exceeds the ±0.05 tolerance called out in the audit brief.
function selfCheckAnchors() {
  const anchors = [
    { a: "#017ea6", b: "#007ea6", expected: 0.03 },
    { a: "#007ea6", b: "#007ea6", expected: 0.0 },
    { a: "#65b45a", b: "#66b45b", expected: 0.18 },
    { a: "#2b773b", b: "#27761b", expected: 5.53 },
  ];
  const failures = [];
  for (const { a, b, expected } of anchors) {
    const got = ciede2000Hex(a, b);
    if (Math.abs(got - expected) > 0.05) {
      failures.push(`${a} vs ${b}: expected ${expected}, got ${got.toFixed(2)}`);
    }
  }
  if (failures.length > 0) {
    console.error("audit-fills: CIEDE2000 self-check FAILED:\n" + failures.join("\n"));
    process.exit(1);
  }
}

// ---------------------------------------------------------------------
// Hex normalization
// ---------------------------------------------------------------------

function normalizeHex(raw) {
  let h = raw.trim().toLowerCase();
  if (!h.startsWith("#")) return null;
  h = h.slice(1);
  if (h.length === 3) {
    h = h
      .split("")
      .map((c) => c + c)
      .join("");
  }
  if (!/^[0-9a-f]{6}$/.test(h)) return null;
  return "#" + h;
}

// ---------------------------------------------------------------------
// SVG fill extraction
// ---------------------------------------------------------------------

const HEX_RE = /#[0-9a-fA-F]{3}(?:[0-9a-fA-F]{3})?\b/;

function extractFillsFromSvg(svgText) {
  const fills = new Set();

  // fill="#rrggbb" or fill='#rrggbb' attributes.
  const attrRe = /fill\s*=\s*["']([^"']+)["']/g;
  let m;
  while ((m = attrRe.exec(svgText))) {
    const match = m[1].match(HEX_RE);
    if (match) {
      const norm = normalizeHex(match[0]);
      if (norm) fills.add(norm);
    }
  }

  // style="...fill:#rrggbb;..." declarations.
  const styleRe = /style\s*=\s*["']([^"']+)["']/g;
  while ((m = styleRe.exec(svgText))) {
    const styleBody = m[1];
    const fillDeclRe = /fill\s*:\s*([^;"']+)/g;
    let fm;
    while ((fm = fillDeclRe.exec(styleBody))) {
      const match = fm[1].match(HEX_RE);
      if (match) {
        const norm = normalizeHex(match[0]);
        if (norm) fills.add(norm);
      }
    }
  }

  return fills;
}

// ---------------------------------------------------------------------
// Token feed loading + nearest-stop lookup
// ---------------------------------------------------------------------

function loadPrimitives() {
  const path = join(__dirname, "..", "src", "lib", "tokens", "primitives.json");
  let raw;
  try {
    raw = readFileSync(path, "utf8");
  } catch {
    console.error(
      `audit-fills: could not read token feed at:\n  ${path}\n` +
        `Run \`node scripts/sync-tokens.mjs\` first.`,
    );
    process.exit(1);
  }
  const json = JSON.parse(raw);
  const stops = [];
  for (const set of json.sets ?? []) {
    for (const family of set.families ?? []) {
      for (const stop of family.stops ?? []) {
        if (!stop.hex) continue;
        stops.push({
          setId: set.id,
          setLabel: set.label,
          familyName: family.name,
          step: stop.step,
          token: stop.token,
          hex: stop.hex.toLowerCase(),
          lab: hexToLab(stop.hex),
        });
      }
    }
  }
  return stops;
}

function findNearestStop(hex, stops) {
  const targetLab = hexToLab(hex);
  let best = null;
  let bestDist = Infinity;
  for (const stop of stops) {
    const dist = ciede2000(targetLab, stop.lab);
    if (dist < bestDist) {
      bestDist = dist;
      best = stop;
    }
  }
  return { stop: best, deltaE: bestDist };
}

function classify(deltaE) {
  if (deltaE < 1.5) return "drift";
  if (deltaE <= 4) return "review";
  return "off-system";
}

// ---------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------

function main() {
  selfCheckAnchors();

  const files = process.argv.slice(2);
  if (files.length === 0) {
    console.error("Usage: node scripts/audit-fills.mjs <file.svg ...>");
    process.exit(1);
  }

  const stops = loadPrimitives();

  // hex -> Set(files it appears in)
  const colorFiles = new Map();

  for (const filePath of files) {
    let text;
    try {
      text = readFileSync(filePath, "utf8");
    } catch (err) {
      console.error(`audit-fills: could not read ${filePath}: ${err.message}`);
      process.exit(1);
    }
    const fills = extractFillsFromSvg(text);
    for (const hex of fills) {
      if (!colorFiles.has(hex)) colorFiles.set(hex, new Set());
      colorFiles.get(hex).add(filePath);
    }
  }

  const rows = [];
  for (const [hex, fileSet] of colorFiles.entries()) {
    const { stop, deltaE } = findNearestStop(hex, stops);
    rows.push({
      hex,
      fileCount: fileSet.size,
      files: [...fileSet],
      nearestSet: stop ? stop.setLabel : null,
      nearestFamily: stop ? stop.familyName : null,
      nearestStep: stop ? stop.step : null,
      nearestToken: stop ? stop.token : null,
      nearestHex: stop ? stop.hex : null,
      deltaE,
      verdict: classify(deltaE),
    });
  }

  // Sort: off-system first, then review, then drift; within a group, by dE descending.
  const order = { "off-system": 0, review: 1, drift: 2 };
  rows.sort((a, b) => order[a.verdict] - order[b.verdict] || b.deltaE - a.deltaE);

  // Print table.
  const header = ["hex", "files", "nearest token", "dE", "verdict"];
  const lines = [header];
  for (const r of rows) {
    lines.push([
      r.hex,
      String(r.fileCount),
      r.nearestToken ? `${r.nearestSet}/${r.nearestToken}` : "(no primitives loaded)",
      r.deltaE.toFixed(2),
      r.verdict,
    ]);
  }
  const widths = header.map((_, i) => Math.max(...lines.map((l) => l[i].length)));
  for (const line of lines) {
    console.log(line.map((cell, i) => cell.padEnd(widths[i])).join("  "));
  }

  return rows;
}

// Export for programmatic reuse (e.g. by a token-candidates generator),
// while still running as a CLI table printer when invoked directly.
export {
  ciede2000,
  ciede2000Hex,
  hexToLab,
  normalizeHex,
  extractFillsFromSvg,
  loadPrimitives,
  findNearestStop,
  classify,
};

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}
