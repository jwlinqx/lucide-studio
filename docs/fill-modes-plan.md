# Implementation Plan: Editor Modes (Stroke / Multi-Color Fill / Pixel-Art)

Date: 2026-08-17. Status: PROPOSED, awaiting review.

## Decisions (fixed)

Three modes: (1) Stroke, the current Lucide behavior, stays the default and must remain behavior-identical; (2) Multi-color fill, per-path fill colors with a color picker; (3) Pixel-art optimizer, a panel hosting the Bleuy pipeline from `LINQX UX/bleuy-optimized/pixel-art-svg-optimizer-spec.md`. Fill state model is a per-path fill attribute preserved through parse, edit, and export; preserving original element identity (rect/circle) is explicitly deferred. No feature ports from the old vanilla-JS artifact in this pass.

## Survey notes

Verified against the fork: `format.ts` attribute whitelist is lines 16-51, output template lines 108-121. `SvgPreview.tsx` hardcoded root `<svg>` block is lines 806-819; `ColoredPath` (lines 156-173) is the only geometry-rendering group and currently assigns rainbow debug colors per segment, not real fill. `format`, `optimize`, and `getPaths` are all `lodash.memoize`-wrapped on a single positional argument; `_format` already accepts an `options` object that memoize's default resolver silently ignores, so options-based mode threading is a no-op cache-wise until fixed.

## Phase 0: Mode plumbing (no behavior change)

1. `src/app/page-client.tsx`: add `useQueryState("mode", {defaultValue: "stroke", history: "push"})` beside the existing `value` state; pass `mode`/`setMode` to `Menu` and `IconEditor`.
2. `src/lib/format.ts`: keep `_format(svg, options)`, default `options.mode = "stroke"`. Fix `memoize(_format)` to key on `svg + (options?.mode ?? "stroke")`. Required before any mode-specific caching is safe.
3. `src/lib/optimize.ts`: same memoize-key fix on the exported `optimize`.
4. `src/lib/get-paths.ts`: extend the command objects built in `getCommands` to carry `fill: node.attributes.fill`, propagated onto `Path.c.fill`. No visible behavior change yet.
5. Add a shared `EditorMode = "stroke" | "fill" | "pixel-art"` type.

## Phase 1: Stroke-mode regression safety

6. Confirm all existing `format(value)`/`optimize(value)` call sites are unaffected (mode defaults to "stroke"); diff formatted/optimized output for a corpus of real Lucide icons before/after Phase 0 to confirm byte-identical results.
7. Land Phase 0 alone and re-run the regression checklist below before starting Phase 2.

## Phase 2: Multi-color fill mode

8. `format.ts`: when `mode === "fill"`, append `"fill"` to the per-element `order` arrays (path, rect, circle, ellipse, polygon, polyline); leave circle's existing dot-fill entry untouched for stroke mode. Root template branches to `stroke="none"` and drops the forced `fill="none"` in fill mode.
9. `src/lib/path-to-path-node.ts`: copy `path.c.fill` onto the emitted node's `attributes.fill` when present, so parse, edit, and re-emit round-trip fill without touching geometry.
10. `src/lib/nodes-to-svg.ts`: accept an optional mode param mirroring the format.ts template branch for defensive consistency (every current caller re-runs output through `format()`, which is what actually applies the root attrs).
11. `src/components/providers/SelectionProvider.tsx`: add `fill?: string` to `Selection`.
12. `src/components/SvgPreview.tsx`: add a `mode` prop; in `ColoredPath`, fill mode renders each path with its real `c.fill ?? "currentColor"` and `stroke="none"` instead of rainbow debug colors. Root `<svg>` attrs branch identically to format.ts.
13. New `src/components/FillColorPicker.tsx`, shown in `IconEditor` only when `mode === "fill"`: lists distinct fills among selected paths, `<input type="color">` swatches, writes via a node patch plus `onChange(format(next, {mode: "fill"}))`.
14. `src/components/Menu.tsx`: add a mode switch (radio group). Disable in fill mode: Circlify (assumes stroke dot rendering) and Offify/Cutout/Cut (stroke-width geometry ops). Route "Tidy" through `optimize(value, {mode: "fill"})`.
15. `src/lib/optimize.ts`: gate `fillSmallCircles` (currently force-overwrites `fill="currentColor"` on tiny circles, wrong for real fills) to stroke mode only, or make it preserve existing fill. Gate the svgo preset overrides to also disable `removeUselessStrokeAndFill` and `convertColors` in fill mode. Make `getCircle`/`getRect`/`optimizeRect`/`optimizeEllipse`/`optimizeHalfCircle` copy the source path's fill attribute onto the synthesized element; they currently build fresh `INode`s and drop it silently.

### Phase 2T: token system integration (fills come from the design system)

13a. Vendor the token feed. `scripts/sync-tokens.mjs` copies `design-system-tokens/dist/json/primitives.json` from the sibling Manifold repo into `src/lib/tokens/primitives.json`. The snapshot is committed and refreshed manually; it is a generated file and is never hand-edited (its own $comment says so).
13b. Token swatches in the fill picker. `FillColorPicker` presents the primitive ramps grouped by set and family, each swatch labeled with its token name and stop; clicking applies that stop's hex to the selected paths. The SVG stores the literal hex (exports stay plain SVG); token identity is recovered by value equality against the vendored feed.
13c. Provenance classifier. For every distinct fill in the document: exact hex match to a stop = on-system, show the token name. Otherwise CIEDE2000 against all stops (vendored culori, precedent in the OKLCH cusp picker): dE < 1.5 = drift badge with one-click snap to the stop; dE > 4 = off-system badge; between = show both candidates, human decides. Thresholds are the ruled values from the pixel-art optimizer spec section 7.
13d. Off-system registry. `src/lib/token-candidates.json`: one entry per off-system color with hex, tentative name, why (free text, required when keeping an off-system fill), uses, nearest token and its dE, firstSeen date. This is the queue for graduating colors into the token system later; graduation means authoring a real primitive whose $description records the specific uses, then deleting the registry entry. Seeded from the Bleuy earth tones (rust and dirt colors improvised in the mascot artwork because no brown ramp exists in either brand).

## Phase 3: Pixel-art panel shell

16. New `src/components/PixelArtPanel.tsx`, mounted alongside (not replacing) the editor in page-client.tsx when `mode === "pixel-art"`; `value` stays the single source of truth so switching modes never loses the SVG.
17. Panel consumes current `value`, writes back only on explicit "Apply" via the same `setValue`, then pipes output through `format(output, {mode: "fill"})` (pixel-art output is fill-based) so it lands correctly if the user switches to fill mode.
18. Client-side stages per spec: parse (fill resolution: fill attr, then `style="fill:"`, then class via `<style>`, then missing means black), lattice recovery (ordinal rank of sorted distinct edge values, never `round(v/pitch)`), rect-merge, emit. Cross-file canvas alignment stays out of scope for this single-document panel per the spec's section 10 conclusion, but single-document palette audit is now in scope: it reuses the Phase 2T classifier and vendored primitives feed.
19. Implement the render-diff verification harness in-browser (offscreen canvas, blob-URL rasterization, 10x scale) asserting `differing_pixels === recolored_cells * scale²` on any recolor/apply action.
20. No code ported from the vanilla-JS artifact referenced in the spec; build fresh against this app's svgson/INode model.

## Phase 4: Editor UX (zoom, background, nudge, flexible panels)

Independent of modes; can land before or after Phase 2. Ordered by value per effort.

21. Zoom and pan. `SvgPreview` renders a fixed `viewBox="0 0 w h"` scaled to its container (SvgPreview.tsx:812), and `SvgEditor` maps mouse coords through that viewBox, so implement zoom by manipulating the viewBox (zoom factor + pan offset state on the editor wrapper), never by CSS transform, or every existing coordinate conversion, snap, and hit test keeps working unchanged. Wheel = zoom to cursor, space-drag or middle-drag = pan, keyboard +/-/0 = in/out/reset. Grid overlay density already derives from the viewBox so it scales for free.
22. Canvas background control. Today the canvas is painted only by the next-themes light/dark toggle (View > Theme, Menu.tsx:280-292). Add a View > Background submenu: theme surface (default), white, black, mid gray, checkerboard, and custom color. Paints a wrapper div behind the SVG only, never inside the exported markup. Persist in localStorage. This matters doubly for fill mode, where judging fills against one theme surface is not enough.
23. Arrow-key nudge. Whole-shape drag and Shift+click multi-select already exist (SvgEditor.tsx:425-465); what is missing is keyboard movement. Arrow keys move the current selection by one grid unit, Shift+arrow by 0.5 (Lucide geometry commonly sits on half-pixel), writing through the same in-place path mutation + `setPaths` commit the drag handler uses so undo history captures it.
24. Flexible panels. `IconEditor` hardcodes the code-editor/canvas split. Replace with react-resizable-panels (drag handle between code and canvas, collapsible code panel, sizes persisted to localStorage). The Phase 3 pixel-art panel mounts as a third panel in the same group instead of bespoke layout.
25. Regression note: none of 21-24 may touch the SVG string, `format`, or `optimize`; they are pure view/interaction state. The stroke-mode regression checklist below still applies unchanged.

## Stroke-mode regression checklist

- `format(icon)` and `optimize(icon)` output byte-identical to pre-change for a fixed corpus, mode omitted.
- Root `<svg>` still emits `fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"` when mode is unset or "stroke".
- No new `fill` attributes appear on any element for stroke-mode input, including via `fillSmallCircles` and the rect/circle reverse-conversion.
- Undo/redo history and its `useRef` state are unaffected by the new `mode` query key.
- Favicon effect (`page-client.tsx` `updateIcon`) still finds `.svg-preview-colored-path-group > path` and produces identical favicon markup.
- Menu actions (Tidy, Arcify, Offify, Cutout, Cut, Circlify) behave identically with mode "stroke" or unset.

## Risks and mitigations

- Memoize cache-key blindness: `format`/`optimize` already ignore their options argument for caching; fixed in Phase 0 before any mode-dependent call exists.
- SVGO preset stripping real fill: mode-conditional plugin overrides plus a fill round-trip fixture in the optimize test corpus.
- Circle/rect reverse-conversion dropping fill: explicit attribute copy at synthesis sites, covered by a dedicated fixture.
- Preview visually contradicting real fill state: `ColoredPath` fill-mode branch verified with manual visual QA before shipping Phase 2.
- Pixel-art panel corrupting undo history: writes only on explicit Apply, gated by the validation assertions from spec section 2.4.

## Deferred (future passes)

- Preserving original element identity (rect/circle/ellipse) instead of early element-to-path conversion.
- Ports from the old artifact: LINQX lint overlay (off-grid anchors, padding/gap), multi-size preview strip, tidy/primitive re-joining.
- Cross-file canvas alignment and CIEDE2000 palette snap against `design-system-tokens/dist/json/primitives.json` (multi-file, needs a file-collection model).
