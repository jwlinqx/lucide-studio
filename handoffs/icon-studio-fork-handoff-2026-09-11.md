# Handoff: Manifold Icon Studio fork

handoff · 2026-09-11 · kind: session · from: Cowork chat "lucide studio fork / fills"
Project: `Desktop/LINQX Repos/Manifold-Icon-Studio/lucide-studio`
Resume with: install pnpm (`npm install -g pnpm`), then `pnpm install && pnpm dev` in the repo and visually QA the five uncommitted feature sets at http://localhost:3000/edit.

## Where things stand

Jonathen forked jguddas/lucide-studio (clone is complete at upstream HEAD `753b484`, 2026-03-15, 224 commits) to become the Manifold icon studio, with fill support and Manifold-specific tooling as the goal. A phased implementation plan for editor modes, fills, editor UX, and token integration is written but not yet reviewed or built. Five feature sets are already implemented, typechecked, and verified still on disk 2026-09-11, all uncommitted: Manifold pattern recognition (26 entries with label/severity display), stroke-weight and pixelated preview tabs, the arc multi-drag fix, the radius handle affordance ported from the old artifact, and token-integration groundwork (feed sync, fill audit, 13 seeded token candidates). None of it has been visually QA'd because pnpm was missing on the Mac. On 2026-09-11 Jonathen added new asks: built-in templates with drag-drop or click-to-add plus a template previewer, a searchable icon browser, and modifier collision detection.

## Do first

1. Install pnpm, `pnpm install && pnpm dev` in the repo; done when localhost:3000/edit runs and pattern labels, the four preview tabs, arc group-drag, and the amber/blue radius handles all behave as described in this doc.
2. Ask: commit the working tree now that it's QA'd? Needs Jonathen's explicit yes (standing no-commit rule); done when he rules.
3. Ask: review `docs/fill-modes-plan.md` (Phases 0-4 + 2T); done when phases are approved or amended, before any Phase 0 build starts.

## Decisions locked

| Decision | Ruling | Rejected alternate | Evidence |
|---|---|---|---|
| Editor modes | three: stroke (default, byte-identical), multi-color fill, pixel-art | single fill toggle | ruled in chat 2026-08-17 |
| Fill state model | per-path fill attribute through parse/edit/export | preserving rect/circle element identity (deferred) | ruled in chat 2026-08-17 |
| Manifold patterns location | separate `manifold-patterns.json` with label/severity fields | appending to upstream patterns.json | ruled in chat 2026-08-17 |
| Corner variants (tl/bl/tr/br) | collapse to one displayed label | 4 separate entries per corner | ruled in chat 2026-08-17 |
| Lucide-identical patterns | skip plus-add, x-delete, check-br (resolve to lucide plus/x/small-check) | duplicate double-labels | `scripts/verify-patterns.mjs`, 39/39 |
| Zoom (Phase 4) | viewBox manipulation only | CSS transform (breaks coord math, snapping, hit tests) | `docs/fill-modes-plan.md` step 21 |
| Fill provenance thresholds | CIEDE2000 <1.5 drift-snap, >4 off-system, between = human | per-file majority vote | pixel-art spec section 7 |
| Artifact feature ports | deferred; fills first | porting lint overlay / multi-size preview now | ruled in chat 2026-08-17 |

## Do not redo

- Stroke-only-assumption survey of the repo: done; chokepoints recorded in the plan doc
- Pattern signature verification: 39/39 source SVGs self-match, corner groups collapse correctly, 2026-08-17
- CIEDE2000 anchor validation: 0.03 / 0.18 / 5.53 reproduced exactly by `scripts/audit-fills.mjs` self-check
- Upstream comparison: live studio.lucide.dev has 4 post-March UI features; stroke tabs + pixelated preview rebuilt here, Code tab and Discord/Report-bug links not
- `next build` in Claude's sandbox: fails only on the Google Fonts fetch; environment limitation, not a code problem
- Extending the old Cowork artifact: rejected (rewrite-not-extend verdict); the fork supersedes it

## Open

- fillSmallCircles behavior (non-destructive vs opt-in menu action vs remove): person (asked 2026-08-17, never answered)
- check-br currently renders as lucide's red "small check" guideline warning; shadow that key with a neutral Manifold label?: person
- Four review-band colors, not in the candidates registry: #ed7023 (1.86), #2b773b (3.05 vs viz prairie 550), #231f20 (3.06), #857f7b (3.45): person
- Do viz ramps count as legitimate fill sources for artwork, or exclude from matching?: person
- Built-in templates: drag-drop or click-to-add into the editor, plus a template previewer: research (requested 2026-09-11)
- Searchable icon browser in the preview, sectioned: current icons (lucide + custom folders), rejected (rejected folder), templates: research (requested 2026-09-11)
- Collision detection: when an added modifier would collide with existing geometry, suggest a tweak that passes guidelines; modifiers only, not other templates: research (requested 2026-09-11)

## Files touched

All verified on disk 2026-09-11; all uncommitted (HEAD still `753b484`). Paths relative to repo root.

| Path | What changed | State |
|---|---|---|
| `docs/fill-modes-plan.md` | Phases 0-4 + 2T plan | done, awaiting review |
| `src/lib/manifold-patterns.json` | 26 Manifold pattern entries | done |
| `src/lib/get-pattern-matches.ts` | merge manifold file, label/severity in output | done |
| `src/components/SvgPreview.tsx` | severity-based labels, strokeWidth prop | done, untested visually |
| `src/components/SvgEditor.tsx` | arc multi-drag fix, arcMidpoint, radius decorations | done, untested visually |
| `src/components/IconEditor.tsx` | preview tabs, PixelPreview, cursors | done, untested visually |
| `scripts/generate-pattern.mjs` | pattern authoring: svg + name → entry | done |
| `scripts/verify-patterns.mjs` | pattern verification harness | done |
| `scripts/lib/get-paths.mjs`, `scripts/lib/pattern-matches.mjs` | JS ports for the scripts | done |
| `scripts/sync-tokens.mjs` | token feed sync from Manifold repo | done |
| `scripts/audit-fills.mjs` | fill audit, vendored CIEDE2000 | done |
| `src/lib/tokens/primitives.json` | synced snapshot, 700 stops | done |
| `src/lib/token-candidates.json` | 13 off-system Bleuy colors with why/uses | done |

## Sources

- The plan all build work follows: `docs/fill-modes-plan.md`
- Thresholds, fill-source rules, verification assertions: `Documents/Claude/Projects/LINQX UX/bleuy-optimized/pixel-art-svg-optimizer-spec.md`
- Token feed source of truth: `Desktop/LINQX Repos/Manifold/design-system-tokens/dist/json/primitives.json`
- Upstream github.com/jguddas/lucide-studio at `753b484`; live site runs newer private code: checked in chat, 2026-08-17
- Modifier/template source SVGs: `Desktop/LINQX Repos/Manifold/assets/iconography/templates/{modifiers,templates}/svg/`

## Context the next session lacks

- No commits or pushes ever without Jonathen's explicit yes; everything stays working-tree until he rules
- `format`/`optimize`/`getPaths` are lodash.memoize'd on the SVG string alone; any options threading must fix the cache key first (plan Phase 0)
- Modifier filenames carry corner suffixes tl/bl/tr/br; cog-settings, design, pen-edit bl-vs-br are mirrored redraws, not translations
- "Pixelated preview" means 1x low-DPI screen simulation, not an art style
- The upstream repo appeared private to Jonathen but read public from here on 2026-08-17; his clone needs nothing from it anyway
- Jonathen typically works at 175% browser zoom in the real lucide studio; the canvas is too small at 100%. Treat this as the baseline motivation for Phase 4 zoom/pan (plan step 21) and sanity-check any editor UI at that zoom level

---

Resume prompt (paste into a new conversation):

```
Read `Desktop/LINQX Repos/Manifold-Icon-Studio/lucide-studio/handoffs/icon-studio-fork-handoff-2026-09-11.md`
and pick up from its "Do first". Treat Decisions locked as settled. Before
editing, check each row of Files touched against disk and tell me what has
drifted since 2026-09-11.
```
