# Recursive Render & Camera — Design

## Revision note

The user supplied an external revision of this spec's first draft. Verified each change
independently rather than adopting wholesale; nearly all of it is correct and catches real
gaps the first draft had. What follows documents what changed and why.

**Adopted as genuine bug fixes to the first draft:**
- **`maxRecursionDepth` as a hard backstop, independent of the pixel cutoff (§2.1).** The
  first draft's termination argument ("a self-loop shrinks by `1/board.size` every step, so
  it always terminates for any `board.size > 1`") silently assumed `board.size > 1` without
  ever confirming the engine enforces that. It doesn't — nothing in `Board`'s type or
  `levelSchema.ts` rejects a `size: 1` board. A self-loop onto a `1×1` board never shrinks
  (`scale / 1 = scale`, forever) — the pixel cutoff alone would hang. A hard depth limit,
  checked independently of pixel size, is required.
- **Clone tint must compose across nested clones (§4.2).** The first draft passed a boolean
  `paleTint` per recursive call, resolved fresh from `resolveRecursionTarget` at each level —
  a clone nested inside another clone's peek, or an *ordinary* container reached deep inside
  a clone's peek, would silently reset to normal (untinted) color the moment the current
  piece itself isn't a clone, even though the whole subtree is still visually "inside a
  clone." Fixed by accumulating a numeric `tintAmount` through `DrawContext`, composed via
  `combineTint` at every level, so the accumulated paleness never resets partway down.
- **Viewport culling, not just a total cell budget (§2.3).** The first draft's only guard
  against runaway draw cost was a flat `maxCellsPerFrame` counter with no notion of what's
  actually on screen. A big board (or many root-level siblings) could exhaust that budget on
  off-screen content before the camera's own visible region is ever reached, leaving the
  screen looking incomplete even for a simple visible scene. Cull by screen-space
  intersection first; only count visible cell draws against the budget.
- **Pre-index pieces by board once per frame (§2.2).** The first draft's recursive function
  scanned `Object.entries(world.locations)` fresh inside every single board-draw call — an
  O(boards-drawn × total-pieces) scan. Build the per-board index once per frame instead.
- **Draw order: container border/marker last (§3).** The first draft never specified whether
  a container's own border marker (e.g. the `linkedTo` edge stripe) is drawn before or after
  its recursively-drawn interior. Before would mean the interior's own fills paint directly
  over the border, making it invisible. Marker must be drawn last.
- **Canonical board position vs. visual clone placement must be two different concepts
  (§1.2).** The first draft reused `childTransform` for both "where a board really sits in
  the containment tree" and "where a clone visually places someone else's board" without
  ever naming these as distinct. They must never be conflated: `cameraForPlayer` needs the
  player's *canonical* position (there is exactly one), never a clone's incidental visual
  copy of the same board content.
- **A `linkedTo` container's target should NOT always get a matching border (§6.2) — this
  corrects an actual mistake in the first draft, not just an omission.** The first draft
  claimed "the link's terminal `location` result is symmetric in effect even though
  `linkedTo` is authored one-directionally" and drew the border on both sides on that
  premise. That premise is simply false — confirmed against the Container Link spec and its
  own shipped test ("a one-directional link only affects exiting the linked side — C2
  (unlinked) still climbs to its own owner normally"). A container gets the border because
  **its own** `linkedTo` field is set, full stop; a target with no `linkedTo` of its own gets
  no border, because gameplay-wise nothing special happens when *entering* it from outside.
- **Non-player cross-board piece motion should NOT claim full ghost-rendered animation this
  round (§10.4).** The first draft's animation section implied any piece's clone-teleport or
  link-crossing would get the same camera-pan treatment as the player's — but the camera only
  ever tracks the player; there's no defined meaning for "pan the camera to a pushed box's
  destination" without confusing the player about their own position. Scoped down to a plain
  state-to-state snap for non-player cross-board motion this round.
- **Explicit anchor-mismatch guard on animation interpolation (§12).** Root-space and
  Void-space coordinates are not comparable — interpolating between them would produce a
  meaningless pan through unrelated numbers. Must check `sourceCamera.anchor !==
  targetCamera.anchor` and route to the dedicated Void transition instead of ever lerping
  across anchors.
- **A moving container's recursive interior must animate together with the container
  itself (§10.2).** Genuinely missed in the first draft: if a pushed container's own fill
  position is tweened but its nested recursive interior is computed from its un-tweened
  (snapped) `Location`, the shell slides smoothly while its visible contents jump. Both must
  read from the same interpolated `Location`.

**Adopted as reasonable engineering hygiene, low risk:** one explicit `worldToScreen`
helper instead of ad hoc camera math per call site (§9.1); explicit min/max camera zoom
clamps and a defined fallback for a missing/invalid player location (§9.2); an explicit
small `RenderAnimation` state object instead of scattered `useEffect` timing refs (§11);
concrete canvas/viewport requirements — DPR, `ResizeObserver`, cancel RAF on unmount (§13);
a recommended (not mandatory) budget-exhaustion priority order favoring the player's own
containment path over arbitrary iteration order (§14.1).

**Corrected, not adopted as written:** §10.1's illustrative code (`const result = move(action);
const postMoveWorld = result.state;`) does not match the real, already-shipped
`GameState.move(dir: Direction): boolean` — it returns a boolean, not an object with a
`.state` field. The underlying point (capture the exact pre/post `World`, don't assume
anything about `GameState`'s internal history representation) is correct and kept; the code
below reads `state.current` before and after calling `state.move(dir)`, which achieves the
same guarantee against the real shipped API instead of an invented one.

**Found independently, addressed by neither the first draft nor the revision:** how is the
render anchor's `identity` board concretely determined? Both versions wrote
`{ boardId: 'root', originX: 0, originY: 0, scale: 1 }` as if `'root'` unambiguously names a
structurally distinguishable board. It doesn't, as of this session's own earlier work —
`docs/superpowers/specs/2026-09-18-parabox-general-cycles.md` made `root` explicitly
*not* structurally special: a level whose containment graph is one connected cycle running
through the start has **no board with zero owners at all**, `root` included. `levelSchema.ts`
already handles this (`startBoardId` is the sole orphan board if one exists, otherwise
`locations[PLAYER_ID].board` at parse time) — the renderer's own anchor-resolution needs the
identical concept, and its upward walk needs the identical cycle-safety `computeTarget`
already has, or resolving a canonical transform for a board sitting on a cycle would hang
exactly the way the recursion budget exists to prevent. See §1.3 below — new content, not in
either prior version.

## Background

The current renderer (`src/game/render/CanvasRenderer.ts`, `GameScreen.tsx`) was built in
sub-project 2 as a deliberate simplification: the old pre-flat-`World` renderer drew a box's
interior recursively because the old `Grid`/`Box` data model was itself a nested object
tree. When the engine moved to a flat `World` (`boards`/`pieces`/`locations` records,
`Piece.boardRef` as a lookup rather than an embedded structure), sub-project 2's spec
explicitly scoped out "any transition animation on board switch (hard cut only)" and rewrote
the renderer to draw exactly one `Board` at a time — whichever board
`world.locations[PLAYER_ID].board` currently names — with a hard camera cut on every board
change. Every piece (`normal`, `container`, `player`) is a flat color block; a container's
interior is never drawn inside it.

Since then, this session added Void/self-loop-exit, general containment cycles, Clone
(`cloneOf`), Flip (`fliph`), and Transfer (`linkedTo`) — mechanics whose whole point is
spatial relationships between boards (what's inside what, what teleports where, what
mirrors what, what closes back on itself). The flat-color, one-board-at-a-time renderer
makes none of this visible.

The user supplied reference screenshots of the real Patrick's Parabox renderer, showing the
intended direction: **true continuous recursive rendering**. A container is not a flat block
— its own board is drawn, live, scaled down, inside its cell, recursively, to whatever depth
remains legible. There is no camera cut between boards for ordinary containment changes: the
camera is a pan/zoom transform over one continuously rendered scene, and entering/leaving a
container is that transform changing smoothly. Content that belongs to no board above the
level's own start renders as a black backdrop with sparse gray decorative dust — art
direction, unrelated to the engine's `VOID_BOARD_ID` gameplay board.

## Goal

Replace the flat one-board-at-a-time renderer with a recursive renderer and a continuous
camera so that:

1. every mechanic is visually self-explanatory through the thing it actually does;
2. movement through the game no longer uses a hard cut for ordinary containment changes;
3. the recursive scene remains bounded and performant even for deep, cyclic, or
   clone-duplicated structures;
4. animation is driven by exact pre-move/post-move snapshots, never inferred history
   internals.

## Explicitly out of scope this round

- **Click-to-inspect / peek-without-moving.** Once recursion is live, most of the original
  motivation is already satisfied passively. Revisit only if playtesting finds a specific
  remaining gap.
- **Final art / asset pipeline.** The target is diagnostic clarity, not final visual polish.
  Colors, shapes, and easing below are implementation-friendly starting points.
- **Mouse/touch interaction with the recursive scene.** The camera is fully state-driven
  this round.
- **Editor (`EditorScreen.tsx`) rendering.** Stays on its current flat renderer.
- **Device-specific performance tuning.** The limits below are starting values, tuned
  empirically during implementation, not device-certified numbers.
- **Ghost-rendered animation for a non-player piece's cross-board motion** (see §10.4) —
  deferred; a plain state snap is used this round.

---

# 1. Core architecture: one recursive scene, camera as a transform

## 1.1 Coordinate model

The engine already has the relationship rendering needs:

> one cell of a parent board contains the entire child board.

`computeTarget` (`rules.ts`) already climbs this relationship upward for movement,
accumulating a `relativeCoord: Fraction` at each step. Rendering walks the same relationship
downward, from the anchor board outward, producing a plain `{x, y, scale}` transform instead
of a `Fraction`.

```ts
// src/game/render/recursiveTransform.ts
export interface BoardTransform {
  boardId: BoardId
  // Top-left corner of this board's (0,0) cell, in the active anchor's units.
  originX: number
  originY: number
  // Size of ONE cell of this board, in anchor units. The anchor board's own
  // transform has scale === 1.
  scale: number
}

export function childTransform(
  parentTransform: BoardTransform,
  location: Location,
  childBoard: Board,
): BoardTransform {
  if (childBoard.size <= 0) {
    throw new Error(`Invalid board size: ${childBoard.size}`)
  }
  return {
    boardId: childBoard.id,
    originX: parentTransform.originX + location.x * parentTransform.scale,
    originY: parentTransform.originY + location.y * parentTransform.scale,
    scale: parentTransform.scale / childBoard.size,
  }
}
```

## 1.2 Canonical board position vs. visual clone placement

Two different concepts, never to be conflated:

- **Canonical position:** where a board really sits in the authored containment tree —
  found by walking its real owner chain (`boardRef`, via `findContainerFor`) toward the
  anchor. Every board has **at most one** canonical position under a given anchor (it may
  have none, if it belongs to the other anchor's tree entirely).
- **Visual placement:** where a recursive *draw* places a board's content inside a
  particular cell — a plain container's own `boardRef` board (which is also its canonical
  position), or a clone's live peek at its main body's board (which is emphatically **not**
  the peeked board's canonical position — it's a second, independent visual copy).

```ts
export function resolveCanonicalBoardTransform(
  world: World,
  boardId: BoardId,
  anchor: 'root' | 'void',
): BoardTransform | null

export function childTransform(
  parentTransform: BoardTransform,
  location: Location,
  childBoard: Board,
): BoardTransform
```

`resolveCanonicalBoardTransform` walks real ownership only — it must never follow
`cloneOf`. It's what `cameraForPlayer` uses to find the player's one true position; the
recursive *draw* function uses plain `childTransform` for both canonical descent and clone
placement, since both are legitimate uses of "place this board inside that cell," just
starting from different transforms.

## 1.3 Resolving the anchor and walking up to it (new this revision)

Neither prior version of this spec defined *which board* is the `root` anchor's identity
board, beyond writing the literal string `'root'` as if it were structurally guaranteed to
exist and be reachable by walking upward from anywhere. As of this session's own
`docs/superpowers/specs/2026-09-18-parabox-general-cycles.md`, it isn't: a level whose
containment graph is a pure cycle running through its own start has **no board with zero
owners at all** — walking "up" via `findContainerFor` from any board on that cycle loops the
ring forever, with no structural "top" to stop at, the exact same failure shape the
recursion depth limit (§2.1) exists to guard against on the way *down*.

**The render anchor's identity board is defined identically to `levelSchema.ts`'s own
`startBoardId`:** the sole board with zero owners, if one exists (the ordinary tree case);
otherwise, the board the player's `Location` names at the moment the level was loaded (the
cycle case) — computed once when a level is loaded, not re-derived from live, possibly
player-relocated state on every frame. The Void anchor's identity board is always
`VOID_BOARD_ID`, unambiguous.

```ts
// src/game/render/recursiveTransform.ts
export function resolveAnchorBoardId(world: World, anchor: 'root' | 'void'): BoardId | null {
  if (anchor === 'void') return VOID_BOARD_ID in world.boards ? VOID_BOARD_ID : null
  const ownerCount = new Map<BoardId, number>(Object.keys(world.boards).map((id) => [id, 0]))
  for (const piece of Object.values(world.pieces)) {
    if (piece.kind === 'container' && piece.boardRef !== undefined) {
      ownerCount.set(piece.boardRef, (ownerCount.get(piece.boardRef) ?? 0) + 1)
    }
  }
  const orphan = [...ownerCount.entries()].find(([, count]) => count === 0)
  if (orphan !== undefined) return orphan[0]
  return world.locations[PLAYER_ID]?.board ?? null
}

// Walks from boardId UP to the anchor board via findContainerFor, cycle-safe via a
// visited set (mirrors computeTarget's own `visited: Set<BoardId>`), then composes
// childTransform forward from the anchor's identity transform down through the
// discovered path. Returns null if boardId isn't reachable from this anchor at all
// (it belongs to the other anchor's tree) or a cycle prevents reaching the anchor
// board within a bounded number of steps.
export function resolveCanonicalBoardTransform(
  world: World,
  boardId: BoardId,
  anchor: 'root' | 'void',
): BoardTransform | null {
  const anchorBoardId = resolveAnchorBoardId(world, anchor)
  if (anchorBoardId === null) return null

  const path: { ownerBoardId: BoardId; location: Location; board: Board }[] = []
  let current = boardId
  const visited = new Set<BoardId>()
  while (current !== anchorBoardId) {
    if (visited.has(current)) return null // cycle that never reaches the anchor board
    visited.add(current)
    const ownerId = findContainerFor(world, current)
    if (ownerId === undefined) return null // no owner and not the anchor: unreachable
    const ownerLoc = world.locations[ownerId]
    if (ownerLoc === undefined) return null
    path.push({ ownerBoardId: ownerLoc.board, location: ownerLoc, board: world.boards[current] })
    current = ownerLoc.board
  }

  let transform: BoardTransform = { boardId: anchorBoardId, originX: 0, originY: 0, scale: 1 }
  for (let i = path.length - 1; i >= 0; i--) {
    transform = childTransform(transform, path[i].location, path[i].board)
  }
  return transform
}
```

Note this walk's own cycle guard (`visited`) is a *correctness* mechanism (it must terminate
so `cameraForPlayer` can run at all every frame), independent of and in addition to the
recursive *draw's* `maxRecursionDepth` (§2.1), which is a *rendering-cost* backstop for
content that's allowed to recurse but shouldn't recurse forever. Both are needed; they guard
different operations (one upward position lookup per frame, vs. a potentially
many-branches-deep downward draw per frame).

---

# 2. Recursive renderer

## 2.1 Render budget

```ts
export interface RenderBudget {
  minCellPixels: number          // default: 4 — stop recursing once a child cell would
                                  // render smaller than this
  maxCellsPerFrame: number       // default: 4000 — hard cap on visible cell draws/frame
  maxRecursionDepth: number      // default: 48 — last-resort stack-safety backstop,
                                  // independent of pixel size (see below)
  targetPlayerCellPixels: number // default: 64 — desired on-screen size of the player's
                                  // current board's cells; drives camera zoom
}
```

**Why the depth limit is required in addition to the pixel cutoff:** the pixel-cutoff
argument only guarantees termination when every recursively-entered board has `size > 1`.
Nothing in this engine's `Board` type or `levelSchema.ts` enforces that — a self-loop onto a
`1×1` board never shrinks (`scale / 1 = scale`, forever). Clone can also introduce cycles
that aren't ordinary `boardRef` parent/child cycles (a clone whose main body is itself deep
inside another clone's peek). `minCellPixels` is the normal visual cutoff for legibility;
`maxRecursionDepth` is the non-negotiable stack-safety backstop that holds even when pixel
size alone would allow more nesting. When the depth limit is hit, the container simply keeps
its flat fill/marker, exactly like hitting the pixel cutoff.

## 2.2 Pre-index pieces by board

The recursive function must not scan `world.locations` globally once per board-draw call —
that turns recursion into repeated global scans. Build a per-frame index once:

```ts
export interface BoardPieceEntry { pieceId: PieceId; location: Location }
export type PiecesByBoard = Map<BoardId, BoardPieceEntry[]>
export function indexPiecesByBoard(world: World): PiecesByBoard
```

## 2.3 Viewport culling, before the cell budget

A large board can contain far more cells than the camera can see at once. If the renderer
visits cells in row-major order and exhausts `maxCellsPerFrame` before reaching the visible
region, the screen can appear incomplete even though the actually-visible content is simple.
For every board: compute its screen-space rectangle first; skip entirely if outside the
viewport; otherwise derive the visible integer cell range and draw (and budget-count) only
cells intersecting the viewport; recurse only into container cells whose own rectangle
intersects the viewport.

```ts
interface Viewport { width: number; height: number }
interface ScreenRect { left: number; top: number; right: number; bottom: number }
```

---

# 3. Recursive draw contract

```ts
interface DrawContext {
  ctx: CanvasRenderingContext2D
  world: World
  camera: CameraTransform
  viewport: Viewport
  budget: RenderBudget
  piecesByBoard: PiecesByBoard
  cellsDrawnSoFar: { count: number }
  recursionDepth: number
  tintAmount: number    // accumulated clone paleness — 0 = normal, composed via combineTint
  mirrorH: boolean      // accumulated horizontal mirror — XOR of every fliph ancestor
  getRenderLocation: (pieceId: PieceId, world: World) => Location | null // animation hook, §10.2
}

function drawBoardRecursive(dc: DrawContext, board: Board, transform: BoardTransform): void {
  if (dc.cellsDrawnSoFar.count >= dc.budget.maxCellsPerFrame) return
  if (dc.recursionDepth >= dc.budget.maxRecursionDepth) return
  if (!Number.isFinite(transform.scale) || transform.scale <= 0) return

  const boardRect = boardScreenRect(transform, dc.camera, board.size)
  if (!intersectsViewport(boardRect, dc.viewport)) return

  // For each visible cell: draw the base cell, then any piece on it.
  // For a container piece whose recursion target is above the pixel cutoff: recurse
  // into the target board FIRST (drawBoardRecursive with the composed tint/mirror and
  // recursionDepth + 1), THEN draw this container's own border/marker on top — so the
  // marker is never painted over by the nested content.
}
```

**Draw order per container cell:** base cell → piece fill → nested board (if permitted) →
container border/marker. The marker-last rule matters most for `linkedTo`'s edge stripe and
the cycle-member color ring — nested content fills the whole cell and would otherwise erase
them.

---

# 4. Recursion target rules

## 4.1 Plain container

```ts
return { boardId: piece.boardRef, tintAmount: 0, mirrorH: piece.fliph ?? false }
```

## 4.2 Clone

A clone (`cloneOf`) is a **visual duplicate of the main body's current board**, not an
ownership edge.

```ts
export interface RecursionTarget { boardId: BoardId; tintAmount: number; mirrorH: boolean }

function resolveRecursionTarget(world: World, piece: Piece): RecursionTarget | null {
  if (piece.cloneOf !== undefined) {
    const mainBodyLoc = world.locations[piece.cloneOf]
    const mainBody = world.pieces[piece.cloneOf]
    if (mainBodyLoc === undefined || mainBody === undefined) return null
    return {
      boardId: mainBodyLoc.board,
      tintAmount: 0.35,
      // The clone's OWN fliph is inert for gameplay (tryEnter's cloneOf interception
      // returns before into.fliph is ever read) — using it here would render a mirrored
      // peek that lies about what happens on a real entry. The main body's own fliph is
      // what actually mirrors its interior, so that's what the peek reflects.
      mirrorH: mainBody.fliph ?? false,
    }
  }
  if (piece.boardRef === undefined) return null
  return { boardId: piece.boardRef, tintAmount: 0, mirrorH: piece.fliph ?? false }
}
```

**Clone placement uses the clone's own location, never the main body's:**

```ts
const childT = childTransform(transform, cloneOwnLocationOnCurrentBoard, world.boards[target.boardId])
```

**Tint composes, doesn't reset:**

```ts
function combineTint(parent: number, local: number): number {
  return 1 - (1 - parent) * (1 - local)
}
const nextTint = combineTint(dc.tintAmount, target.tintAmount)
```

Every fill inside the clone's subtree — at every depth, whether or not the piece at that
depth is itself a clone — is drawn with the accumulated `dc.tintAmount`, not a fresh
per-piece value. This is what keeps a clone-of-a-clone, or an ordinary container reached deep
inside a clone's peek, visibly paler than the "real" version rather than snapping back to
normal color the moment the current piece isn't itself a clone.

**Cross-anchor clones are fine, don't try to re-root them:** a clone's main body can happen
to be standing in the *other* anchor's tree (e.g. Void-locked, while the clone itself is
drawn from the `root` anchor). That's allowed — it's a visual placement, not an ownership
edge, so it never needs `resolveCanonicalBoardTransform` (which is anchor-scoped by
definition); it just needs plain `childTransform` from wherever the clone's own cell already
is, using whatever board content `mainBodyLoc.board` currently names, root or void. This
doesn't connect the two gameplay graphs — it only means the same board data can be visually
instantiated more than once, from either anchor.

---

# 5. Flip (`fliph`)

Content is mirrored, not marked with a separate icon:

```ts
const drawX = mirrorH ? board.size - 1 - x : x
```

The same mirrored x-coordinate is used for every piece's visual position on that board, not
just the base cells. Composition is XOR, so nesting a `fliph` container inside another
cancels correctly:

```ts
const nextMirrorH = dc.mirrorH !== target.mirrorH
```

---

# 6. Transfer (`linkedTo`)

`linkedTo` stays a pure gameplay relationship; the renderer only reads it, never infers one
from geometry or proximity.

## 6.1 Marker rule — corrected from the first draft

A container gets the distinct-colored perimeter border **because its own `linkedTo` field is
set** — nothing more. It is *not* mirrored onto whatever it points at unless that piece has
its own `linkedTo` field too. The first draft's claim that a link is "symmetric in effect"
was wrong (confirmed against the Container Link spec's own one-directional test coverage) —
drawing a border on an unlinked target would visually claim a relationship that doesn't
exist in gameplay.

## 6.2 Edge

A full perimeter border is the safe baseline — the renderer doesn't invent a permanent
"this specific edge" highlight when the gameplay data doesn't encode a single canonical edge
(a level author can push into a linked container from any direction; `linkedEntryCell`'s
mapping depends on which edge was actually exited through, not a fixed one). A more specific
edge highlight is a fine later refinement, not required this round.

---

# 7. Cycle indicators

`CYCLE_PALETTE`, `LOCKED_RING_COLOR`, and the `∞` infinite-destination marker are all kept,
unchanged, as secondary signals layered under the new recursion — none of them are replaced
by it. Recursive rendering makes a self-loop structurally visible by literally showing itself
getting smaller, but at heavy zoom-out the pixel cutoff stops that recursion early, and the
existing distinct color is the only remaining signal that the container is special at that
zoom level.

---

# 8. Two floating islands: root and Void

`root`'s tree and the engine's `VOID_BOARD_ID` are structurally disconnected — nothing ever
owns the Void board. The camera has exactly one active anchor at a time:

```ts
type CameraAnchor = 'root' | 'void'
const anchor: CameraAnchor = isInVoid(world, PLAYER_ID) ? 'void' : 'root'
```

Each anchor's identity board is resolved per §1.3 (not a literal `'root'` string). A
non-player piece sent to the Void while the player stays on the `root` side is invisible
until the anchor switches — unchanged from the currently-shipped renderer, which already
only ever draws the player's own current board, so this isn't a regression, just a named
limitation.

**Switching anchors is the one remaining hard transition** — no continuous pan/zoom path
exists between two disconnected trees. Dedicated effect ("fall into darkness"): darken/
desaturate → zoom toward black → swap the active anchor → initialize the camera around the
player's new position → fade the new anchor in. This is the *only* non-continuous camera
transition in the whole system.

---

# 9. Camera

```ts
export interface CameraTransform {
  centerX: number            // anchor-unit x the viewport center is looking at
  centerY: number
  pixelsPerRootUnit: number  // zoom
  anchor: CameraAnchor
}
```

## 9.1 One explicit world-to-screen mapping

```ts
function worldToScreen(x: number, y: number, camera: CameraTransform, viewport: Viewport) {
  return {
    x: (x - camera.centerX) * camera.pixelsPerRootUnit + viewport.width / 2,
    y: (y - camera.centerY) * camera.pixelsPerRootUnit + viewport.height / 2,
  }
}
```

Used everywhere a screen coordinate is needed, so no draw call invents its own camera math.

## 9.2 Computing the player's camera target

```ts
export function cameraForPlayer(world: World, viewport: Viewport, budget: RenderBudget): CameraTransform {
  const anchor: CameraAnchor = isInVoid(world, PLAYER_ID) ? 'void' : 'root'
  const playerLoc = world.locations[PLAYER_ID]
  if (playerLoc === undefined) return cameraFallbackForAnchor(anchor, viewport)

  const boardTransform = resolveCanonicalBoardTransform(world, playerLoc.board, anchor)
  if (boardTransform === null) return cameraFallbackForAnchor(anchor, viewport)

  const centerX = boardTransform.originX + (playerLoc.x + 0.5) * boardTransform.scale
  const centerY = boardTransform.originY + (playerLoc.y + 0.5) * boardTransform.scale
  const targetZoom = budget.targetPlayerCellPixels / boardTransform.scale

  return { anchor, centerX, centerY, pixelsPerRootUnit: clampCameraZoom(targetZoom) }
}
```

`targetZoom = desired player-cell pixels / current board-cell scale`: a deeply nested board
has a smaller anchor-space cell scale, so the camera zooms in further to keep the player's
local board legible. `clampCameraZoom` enforces explicit min/max bounds so a malformed or
extremely deep level can't produce an absurd or non-finite zoom. `cameraFallbackForAnchor`
returns a sane default (anchor's own identity transform, default zoom) for the degrade-safe
case of a missing player location or an unreachable canonical transform — never `NaN`.

---

# 10. Animation

Four visual cases. State interpolation and camera interpolation are handled separately.

## 10.1 Capture the exact pre-move and post-move `World`

```ts
const preMoveWorld = state.current
const moved = state.move(dir)          // GameState.move(dir: Direction): boolean — see
if (!moved) { /* no-op, nothing to animate */ }
const postMoveWorld = state.current     // .current getter, not an invented return value
```

Both reads use `GameState`'s already-public `.current` getter, captured immediately before
and after the mutating call — no assumption about `history`'s internal shape or indexing.
Store the exact `{preMoveWorld, postMoveWorld}` pair for the in-flight animation.

## 10.2 Ordinary movement on the same board

For a piece whose `Location.board` is unchanged, interpolate its local `x/y`:

```ts
function getRenderLocation(pieceId: PieceId, preWorld: World, postWorld: World, t: number): Location | null {
  // board unchanged case: { board: post.board, x: lerp(pre.x, post.x, t), y: lerp(pre.y, post.y, t) }
}
```

If the moved piece is itself a container, its recursively-drawn interior's `childTransform`
must use this SAME interpolated `Location`, not the snapped post-move one — otherwise the
container's shell slides smoothly while everything visible inside it jumps instantly to the
destination. `getRenderLocation` is threaded through `DrawContext` precisely so both the
piece's own fill and its recursive placement read the identical interpolated value.
Recommended starting duration: ~120ms, ease-out.

## 10.3 Entering / leaving a container

The player's `Location.board` changing from a parent to its child board does **not** switch
the rendered scene root — the recursive scene already contains both levels simultaneously.
Render the post-move world; compute the new `cameraForPlayer` target; ease the camera from
the old target to the new one; the destination board grows naturally as zoom increases. This
is a camera transition, not a renderer board swap. Recommended starting duration: ~250ms.

## 10.4 Clone / Transfer crossing (player only, this round)

When the player's board changes to somewhere that isn't a direct containment step, treat it
as a teleport-style camera move: both source and destination have real, computable
`resolveCanonicalBoardTransform` positions in the same anchor's recursive scene (once the
move completes, the destination is canonically reachable — that's what a completed move
guarantees), so the camera eases directly from one to the other. Recommended starting
duration: ~400ms — longer than an ordinary containment zoom, so it *reads* as "the camera
swooped somewhere" rather than merely a longer zoom.

**Non-player pieces:** the same engine mechanics can move a *pushed* piece across boards
without moving the player. The camera is never driven by a non-player piece. This round, a
non-player piece's cross-board motion uses a plain state-to-state snap — no ghost-rendered
source/destination ambiguity is introduced. A full cross-board piece animation is explicitly
deferred, not silently assumed.

## 10.5 Void entry / exit

The dedicated "fall into darkness" transition from §8 — the one non-continuous case.

---

# 11. Animation state

A small explicit state object, not timing scattered across React effects:

```ts
interface RenderAnimation {
  preWorld: World
  postWorld: World
  startTimeMs: number
  durationMs: number
  kind: 'move' | 'enter-leave' | 'teleport' | 'void-transition'
  sourceCamera: CameraTransform
  targetCamera: CameraTransform
}
```

The `requestAnimationFrame` loop reads this state each frame; once `t >= 1`, the render
snapshot becomes the post-move world and the animation state is cleared.

# 12. Camera anchor changes must be explicit

Never interpolate `root` coordinates toward `void` coordinates — they aren't the same
coordinate space and a lerp between them is meaningless. Whenever
`sourceCamera.anchor !== targetCamera.anchor`, run the Void transition (§8/§10.5) instead of
any of the eased camera paths above. Every other animation kind requires source and target
to share the same anchor.

---

# 13. Canvas and viewport handling

The canvas is a fixed viewport now, not a board-sized bitmap resized per move. `GameScreen`:
sizes the canvas to the viewport; accounts for device-pixel ratio; redraws every animation
frame (not just once per move); uses the same logical viewport dimensions for all camera
math; cancels the `requestAnimationFrame` callback on unmount. A `ResizeObserver` updates the
viewport when the containing element's size changes. The renderer no longer resizes the
logical world based on `currentBoard.size`.

---

# 14. Performance and determinism

- **Budget exhaustion priority (recommended, not a hard requirement):** when
  `maxCellsPerFrame` runs out mid-frame, prefer drawing the player's own canonical
  containment path first, then branches nearest the player's visible region, then other
  visible branches, before off-path deep branches — approximated by recursing the active
  path first, then siblings, rather than depending on arbitrary `Object.entries` order.
- **No off-screen recursion:** a child board whose screen rectangle is entirely outside the
  viewport consumes no recursive budget (§2.3).
- **No global location scans:** `piecesByBoard` is built once per frame (§2.2).
- **No stack-risk recursion:** `maxRecursionDepth` (§2.1) holds even when pixel size and
  cell budget would otherwise allow deeper nesting. `resolveCanonicalBoardTransform`'s own
  upward walk (§1.3) has its own independent cycle guard for the same reason, applied to a
  different operation (one position lookup per frame vs. a potentially deep downward draw).

---

# 15. Files touched

**New:** `src/game/render/recursiveTransform.ts` (`BoardTransform`, `childTransform`,
`resolveAnchorBoardId`, `resolveCanonicalBoardTransform`, screen-rect helpers).
`src/game/render/camera.ts` (`CameraTransform`, `cameraForPlayer`, `worldToScreen`,
interpolation/easing helpers).

**Rewritten:** `src/game/render/CanvasRenderer.ts` (`drawBoardRecursive`,
`resolveRecursionTarget`, per-board piece indexing, viewport culling, tint/mirror/link/cycle
helpers, border-drawn-last ordering). `src/game/GameScreen.tsx` (captures exact pre/post
`World`; owns `RenderAnimation` state and the `requestAnimationFrame` loop; computes camera
targets; selects anchor transitions; resizes viewport/canvas).

**Untouched:** `src/game/engine/**` — pure rendering/camera work; every mechanic this reuses
(`findContainerFor`, `mirrorHorizontal`'s composition property, `linkedEntryCell`'s edge
concept, `isInVoid`, the general-cycles `startBoardId` concept) was already built for
gameplay resolution and is only read here, never modified.

---

# 16. Testing strategy

**`recursiveTransform.test.ts`:** two- and three-level nesting produce the expected
`originX/Y/scale`; `scale` divides by child `board.size`; `resolveAnchorBoardId` returns the
sole orphan board for a tree level and the player's start board for a pure-cycle level
(reproduce a fixture from the general-cycles spec's own worked example); a `1×1` self-loop's
`resolveCanonicalBoardTransform` walk terminates via the visited-set guard rather than
hanging; invalid board sizes are rejected; canonical transform resolution never follows
`cloneOf`.

**`camera.test.ts`:** player directly on the anchor board centers on the player's cell
center; player nested two levels deep gets the expected canonical position; player on a
pure-cycle level (no orphan board) still resolves correctly via the player's-start-board
anchor; target zoom follows `targetPlayerCellPixels / boardCellScale`; a Void-standing player
selects the Void anchor; a missing/unreachable player location uses the defined fallback, not
`NaN`; `worldToScreen` maps the camera center to the viewport center.

**`CanvasRenderer.test.ts`:** existing base-case tests (flat color per kind, requirement
overlay, wall vs floor, cycle coloring, lock ring, infinity marker) continue to hold at zero
recursion depth. New: an above-cutoff container draws its nested board; a below-cutoff
container keeps its flat fill; viewport culling skips fully off-screen boards;
`maxCellsPerFrame` is enforced; `maxRecursionDepth` is enforced even for `1×1` recursion
(distinct from the pixel-cutoff test); a clone displays the main body's current board, not a
nonexistent `boardRef`; two clones of one main body produce two independent visual
placements; clone tint is provably paler (compare parsed RGB channels, not just string
inequality); nested clone tint composes rather than resetting; a clone whose main body is
Void-locked (cross-anchor) still resolves its live content; `fliph` mirrors both cells and
pieces consistently; a `linkedTo` container gets the border only when its own field is set,
never mirrored onto an unlinked target; container borders remain visible above nested
content (draw-order test); the player's containment-path branches receive budget priority
when the budget is tight.

**`GameScreen.test.tsx`:** an ordinary move produces intermediate tweened positions before
settling; moving a container interpolates its recursive interior together with the container
(not just its shell); the captured pre-move state is the exact `state.current` snapshot
immediately before `state.move()`, not derived from a history index; entering a container
changes the camera target without replacing the recursive scene root; clone/Transfer camera
movement uses the teleport duration; Void entry/exit uses the dedicated anchor transition,
never a lerp across anchors; undo restores state and cancels/replaces any in-flight
animation; `requestAnimationFrame` is cancelled on unmount.

**Manual verification** (per sub-project 2's own precedent — not fully automatable for a
continuously-animated canvas scene): play `11-clone-box`, `12-flip-box`, `13-transfer` in the
actual browser and confirm each visibly demonstrates its mechanic; also check a self-loop at
normal zoom, a deep nested chain, a `1×1` self-loop if one is deliberately constructed, a
level with many containers (budget exercise), a moving container's interior following it, and
root↔Void transitions. This is the real acceptance bar — the user's original complaint that
motivated this whole spec.

---

# 17. Implementation order

1. `recursiveTransform.ts` — `BoardTransform`, `childTransform`, `resolveAnchorBoardId`,
   `resolveCanonicalBoardTransform`, with their own tests (including the pure-cycle and
   `1×1` cases) passing before anything else starts.
2. Renderer base — fixed viewport, anchor selection, viewport culling, per-board piece
   index, recursive container drawing (flat mechanics only — no tint/mirror/link yet).
3. Mechanic visuals — cycle palette (should already mostly work from step 2), Clone live
   subtree + tint composition, Flip mirror composition, Transfer border.
4. Camera — player absolute position via `cameraForPlayer`, zoom formula, `worldToScreen`,
   interpolation.
5. Animation — exact pre/post snapshots, same-board interpolation (including a moving
   container's interior), enter/leave camera zoom, Clone/Transfer camera pan, Void anchor
   transition.
6. Cleanup and performance — RAF lifecycle, viewport resize handling, budget priority,
   manual verification against the three demo levels.

---

# 18. Acceptance criteria

- The game always renders a recursive scene from the active anchor, never "current board
  only."
- A container's interior is visible inside its cell whenever its screen cell size is above
  the recursion cutoff.
- Recursion is bounded by both the pixel cutoff and the independent recursion-depth limit —
  a `1×1` self-loop provably terminates.
- `resolveCanonicalBoardTransform` correctly resolves the player's position on both a normal
  tree level and a pure-cycle level (no orphan board), and its own upward walk is cycle-safe.
- Off-screen branches don't consume the visible-cell budget.
- Clone content follows the main body's current board (live), is visibly paler, and the
  tint composes correctly across nested clones.
- Flip mirrors actual content, including nested pieces, and composes correctly (XOR) when
  nested inside another `fliph` container.
- A `linkedTo` border appears only on a container whose own field is set — never inferred
  onto an unlinked target.
- Entering/leaving a container is a smooth camera transition, not a scene-root swap.
- Player clone/Transfer movement uses a smooth camera move within the same anchor;
  non-player cross-board motion uses a plain state snap this round.
- Root ↔ Void uses the dedicated anchor transition; no animation ever interpolates across
  anchors.
- Moving a container animates its recursive interior together with the container itself.
- Animation is driven by the exact `state.current` snapshot captured immediately before and
  after `state.move()` — no history-index assumptions.
- The render loop is cleaned up correctly on unmount.
- Existing gameplay rules and engine tests remain unchanged (`src/game/engine/**` untouched).
