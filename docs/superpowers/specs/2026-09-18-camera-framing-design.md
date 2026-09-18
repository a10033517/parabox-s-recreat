# Camera Framing Redesign — Design

## Revision note

This spec supersedes §9.2 (`cameraForPlayer`'s targeting formula) of
`2026-09-18-recursive-render-camera-design.md` ("the render spec"). Everything
else in the render spec — the recursive scene model, `resolveCanonicalBoardTransform`,
`childTransform`, the animation-kind classification in §10, the Void handling in §8 —
is unchanged and this document assumes it as prior art. Only the camera's targeting
formula (what point it centers on, how far it zooms out) changes.

## Background

The render spec shipped and merged (`3a07d6d`). Playtesting the actual build surfaced
two problems, both confirmed against real Patrick's Parabox screenshots (not this
renderer's own output):

1. **The camera recenters on every single step.** `cameraForPlayer` centers on the
   player's own fractional position within their current board, so it recomputes a new
   (source, target) pair and eases between them on every ordinary move — even when the
   player hasn't changed boards. Official Parabox holds the camera fixed while the
   player walks around inside the same board; it only reframes on entering or leaving a
   container.
2. **The camera zooms in tight enough to show only the player's own board.** Official
   Parabox zooms out one extra notch: while the player is inside a container, the shot
   also shows that container's own cell sitting on its parent board, with its immediate
   neighbors visible around it. A self-loop box viewed this way shows itself sitting
   next to what is recognizably "itself again" (via the ordinary recursive draw), not
   just its own bare interior filling the screen.

Both were confirmed by the user against a reference screenshot and restated back to
them for agreement before this redesign started.

## Goal

Redefine `cameraForPlayer`'s targeting formula so that:

- The camera only reframes when the player's board changes (enter/leave/teleport/Void),
  never on an ordinary same-board step.
- The shot always shows the player's current containing box **as seen from one level
  up**, with a small fixed ring of neighboring cells around it, so the "container next
  to its own recursively-drawn interior" effect is visible.
- Standing at the literal top level (no real container to zoom out to) still applies
  the same margin, exposing a sliver of the Void backdrop — root is no longer a special
  case that fills the screen edge-to-edge.

## Design decisions (confirmed with the user)

- **Framing rule: fixed 1-cell margin**, not "fit the whole parent board." Chosen over
  the alternative (always show the entire parent board) because a fixed margin gives
  consistent, predictable composition regardless of how large the parent board is —
  the alternative's zoom would swing wildly between a 3×3 parent and a 10×10 one.
- **Margin size: 1 cell.**
- **Root/void edge case: still apply the same margin, exposing the Void backdrop.**
  This unifies root with every other level under one rule instead of special-casing it
  (see "Root and Void" below) — root no longer fills the viewport edge-to-edge; it now
  always shows a thin ring of black Void around the whole board, consistent with the
  Void aesthetic already established in the render spec's §8 ("two floating islands").

## The new targeting formula

### What "current container" means

At any moment the player is standing on some board `F` (their `Location.board`).
`findContainerFor(world, F)` (already defined in `engine/types.ts`) returns the piece
`P` that owns `F` as its interior — `undefined` if `F` has no owner (only true at the
anchor board itself: root, or the Void board once the player has fallen in).

**This is the whole mechanism for "only reframe on board change":** the camera target
is now a function of `P` and *P's own position on its parent board* — not of the
player's own x/y within `F`. Walking around inside `F` doesn't change `P` or its
position, so the target doesn't change. `classifyMove` already tags an unchanged
`Location.board` as `'move'`; under the new formula, a `'move'`-kind step now produces
identical source and target cameras, so its lerp is a correct no-op — no separate
"freeze unless board changes" gate is needed on top of the formula itself.

### Case 1 — the player's board has an owner (`P` defined)

Let `Parent` be `P`'s own board (`world.locations[P].board`) and `(px, py)` be `P`'s
position on `Parent`. Resolve `Parent`'s canonical transform the same way the render
spec already does:

```ts
const parentTransform = resolveCanonicalBoardTransform(world, parentBoardId, anchor, cachedRootAnchorBoardId)
```

Center on `P`'s own cell, in `Parent`'s coordinate space — the same shape of formula
§9.2 already used, just one level up:

```ts
const centerX = parentTransform.originX + (px + 0.5) * parentTransform.scale
const centerY = parentTransform.originY + (py + 0.5) * parentTransform.scale
```

Zoom so that `P`'s own cell plus `marginCells` of `Parent`'s neighboring cells on every
side fill the viewport's shorter side:

```ts
const spanUnits = 1 + 2 * budget.marginCells          // container's own cell + margin ring
const pixelsPerRootUnit = Math.min(viewport.width, viewport.height) / (spanUnits * parentTransform.scale)
```

### Case 2 — the player's board has no owner (root or Void, `P` undefined)

`F` is the anchor board itself. There is no parent cell to zoom out to, so the margin
is applied directly in `F`'s own coordinate units instead of a parent's: show the whole
board (`0..boardSize`) plus `marginCells` of Void on every side.

```ts
const anchorTransform = resolveCanonicalBoardTransform(world, focusBoardId, anchor, cachedRootAnchorBoardId) // identity: origin 0,0, scale 1
const boardSize = world.boards[focusBoardId].size
const centerX = anchorTransform.originX + (boardSize / 2) * anchorTransform.scale
const centerY = anchorTransform.originY + (boardSize / 2) * anchorTransform.scale
const spanUnits = boardSize + 2 * budget.marginCells
const pixelsPerRootUnit = Math.min(viewport.width, viewport.height) / (spanUnits * anchorTransform.scale)
```

This case produces the "root now always shows a margin of Void" behavior —
previously root filled the screen exactly; now it gets the same treatment as every
nested level, just measured in its own units instead of a parent's.

### Worked example: self-loop (validates against the reference screenshot)

A self-loop box `A` sits on board `R` at `(ax, ay)`, with `A.boardRef === R` (its own
interior reference is the same board it sits on). Player enters `A`; `Location.board`
becomes `R` again (entering a direct self-loop doesn't change which board you're on).

- `findContainerFor(world, R)` finds `A` (the only piece with `boardRef === R`).
- `Parent = R`, `(px, py) = (ax, ay)` — `A`'s own position on `R`.
- `parentTransform = resolveCanonicalBoardTransform(world, R, anchor, cached)`.
- Camera centers on `A`'s own cell on `R`, zoomed to show `A` plus 1 ring of `R`'s other
  cells around it.

Because `R` is drawn recursively (unchanged from the render spec), `A`'s own cell in
this shot *also* recursively renders `A`'s interior — which is `R` again — producing
exactly "see the self-loop box, and next to it, a paler recursive copy of itself,"
matching the reference screenshot, with no self-loop-specific branch in the new
formula. The existing recursion-depth/pixel-cutoff budget (render spec §2.1, unchanged)
still bounds how many further self-similar copies actually get drawn.

### Fallback

`playerLoc === undefined` or a `null` result from `resolveCanonicalBoardTransform`
degrade the same way §9.2 already does — a sane default transform, never `NaN` — just
updated to the new viewport-relative zoom shape:

```ts
export function cameraFallbackForAnchor(anchor: CameraAnchor, viewport: Viewport, budget: CameraBudget): CameraTransform {
  const spanUnits = 1 + 2 * budget.marginCells
  return { anchor, centerX: 0.5, centerY: 0.5, pixelsPerRootUnit: clampCameraZoom(Math.min(viewport.width, viewport.height) / spanUnits) }
}
```

`clampCameraZoom`'s existing `MIN_ZOOM`/`MAX_ZOOM` bounds are unchanged and still apply
to every zoom computed above, including the fallback.

## Interface changes

- **Rename `cameraForPlayer` → `cameraForFocus`.** It no longer targets the player's
  own position; it targets the player's current containing box (or the anchor board
  itself). The old name would be actively misleading against the new formula.
- **`cameraForFocus` gains a required `viewport: Viewport` parameter.** The zoom
  formula now needs the actual viewport size to guarantee "always exactly
  `marginCells` of neighbors visible" regardless of canvas size — the old formula's
  zoom was viewport-independent (a fixed px-per-cell target), which can't make that
  guarantee. Signature: `cameraForFocus(world, viewport, budget, cachedRootAnchorBoardId?)`.
- **`CameraBudget` replaces `targetPlayerCellPixels` with `marginCells`.**
  ```ts
  export interface CameraBudget {
    marginCells: number   // default 1, per the confirmed design decision above
  }
  ```
  The old field name lived on in `RenderBudget` in `CanvasRenderer.ts` purely as a
  shared constant for the camera budget; since the camera no longer targets a fixed
  pixel-per-cell size, that field is removed from `RenderBudget` too and `marginCells:
  1` takes its place in `DEFAULT_RENDER_BUDGET`. `RenderBudget`'s other fields
  (`minCellPixels`, `maxCellsPerFrame`, `maxRecursionDepth`) are untouched — they
  govern the recursive draw's own cutoff, not the camera, and never depended on
  `targetPlayerCellPixels`.
- **All three call sites in `GameScreen.tsx`** (`handleMove`'s source/target camera
  computation, and the two live-camera computations in the render/animation loop) pass
  `viewportRef.current` and the new budget shape. `viewportRef` already exists and is
  kept current by the component's existing resize handling — no new state.
- **`camera.test.ts`** — every existing `cameraForPlayer(world, { targetPlayerCellPixels: 64 })`
  call is rewritten against `cameraForFocus(world, viewport, { marginCells: 1 })` with
  an explicit test viewport, and updated to assert the new center/zoom formula (center
  on the containing piece's parent-relative position, not the player's own).

## Interaction with animation (render spec §10, unchanged in kind)

- `classifyMove`'s four kinds (`move` / `enter-leave` / `teleport` / `void-transition`)
  are unchanged — they still classify by diffing `Location.board`.
- `'move'`: source and target cameras are now computed from the same `P`/`Parent`/
  `(px,py)`, since the player's own board didn't change — they come out numerically
  identical, so the eased lerp between them is a correct no-op. This is what delivers
  "camera doesn't move on an ordinary step" — verified directly by a test asserting
  `sourceCamera` and `targetCamera` are equal for a same-board move, rather than by any
  new skip-animation branch.
- `'enter-leave'` / `'teleport'`: `P` (or the anchor-board case) genuinely changes
  between pre- and post-move `World`, so source and target cameras differ and the
  existing ease-out lerp (§10.2/§10.3/§10.4, unchanged) now visibly reframes to the new
  containing box — this is the "zoom that shows the outer layer" the user asked for.
- `'void-transition'`: unchanged — still routed through the two-phase darken/fade
  in §8/§10.5, never lerped, since `resolveCanonicalBoardTransform`'s anchor changes
  (`root` → `void` or back) are not the same coordinate space.
- The anchor-mismatch guard in render spec §12 (`sourceCamera.anchor !== targetCamera.anchor`
  routes to the Void transition instead of a lerp) is unchanged.

## Files touched

- `src/game/render/camera.ts` — `cameraForPlayer` → `cameraForFocus`, new targeting
  formula (both cases above), `CameraBudget` shape change, `cameraFallbackForAnchor`
  signature change.
- `src/game/render/CanvasRenderer.ts` — remove `targetPlayerCellPixels` from
  `RenderBudget`/`DEFAULT_RENDER_BUDGET`; nothing else in this file changes (the
  recursive draw itself, its cutoff, and its budget fields are untouched).
- `src/game/GameScreen.tsx` — update the three `cameraForPlayer` call sites to
  `cameraForFocus` with `viewportRef.current` and the new budget; `classifyMove`,
  `isSimpleContainmentStep`, `getRenderLocationFactory`, `RenderAnimation`, the
  `requestAnimationFrame` loop, and the anchor-mismatch guard are otherwise untouched.
- `src/game/render/camera.test.ts` — rewritten against the new signature and formula.
- `src/game/render/CanvasRenderer.test.ts` — the `DEFAULT_RENDER_BUDGET` shape
  assertion (`describe('DEFAULT_RENDER_BUDGET', ...)`) drops `targetPlayerCellPixels: 64`
  and gains `marginCells: 1`; no other test in this file touches camera framing.
- `src/game/render/recursiveTransform.ts` — **unchanged.** `resolveCanonicalBoardTransform`,
  `childTransform`, and `resolveAnchorBoardId` already provide everything the new
  formula needs (walking `Parent`'s transform, and the anchor board's identity
  transform for Case 2).

## Testing strategy

- Unit tests on `cameraForFocus` directly (no DOM/canvas needed, same style as the
  existing `camera.test.ts`):
  - Player on a board with a container owner: center matches the container's own
    `(px+0.5, py+0.5)` mapped through the parent's transform; zoom matches
    `viewport-shortSide / (3 * parentTransform.scale)` for `marginCells: 1`.
  - Player at root with no owner: center matches the root board's own midpoint; zoom
    matches `viewport-shortSide / (boardSize + 2)`.
  - Player in Void: same shape as root, using the Void board's own size.
  - Self-loop case from the worked example above: center lands on the self-loop
    piece's own position on its parent board (not the player's literal position, which
    may differ after entering).
  - Two calls with the player at different positions on the *same* board (no board
    change) produce identical `CameraTransform`s.
  - Fallback path (missing `playerLoc`, or an unreachable `resolveCanonicalBoardTransform`)
    still returns a finite, clamped `CameraTransform`.
- `GameScreen`-level animation test: a same-board move classified `'move'` produces a
  `RenderAnimation` whose `sourceCamera` and `targetCamera` are equal (confirms the
  no-op-lerp claim above rather than merely trusting the formula).

## Out of scope this round

- Anything in the render spec's §1–§8 (recursive scene model, clone/flip/transfer
  recursion targets, cycle indicators) — untouched.
- Changing `minCellPixels`/recursion-depth cutoff behavior — untouched; the new camera
  simply feeds a different `pixelsPerRootUnit` into the same existing cutoff math.
- A user-configurable margin (settings/accessibility) — `marginCells` is a code
  constant (`DEFAULT_RENDER_BUDGET.marginCells = 1`), not exposed as a game option.
- Smoothing/easing curve changes beyond what §10 already specifies — only *what* the
  camera targets changes, not how the lerp between two differing targets is eased.
