# Recursive Render & Camera — Design

## Background

The current renderer (`src/game/render/CanvasRenderer.ts`, `GameScreen.tsx`) was built in
sub-project 2 as a deliberate simplification: the old pre-flat-`World` renderer drew a
box's interior recursively because the old `Grid`/`Box` data model was itself a nested
object tree. When the engine moved to a flat `World` (`boards`/`pieces`/`locations`
records, `Piece.boardRef` as a lookup rather than an embedded structure), sub-project 2's
spec explicitly scoped out "any transition animation on board switch (hard cut only)" and
rewrote the renderer to draw exactly one `Board` at a time — whichever board
`world.locations[PLAYER_ID].board` currently names — with a hard camera cut (canvas
resize + full redraw) on every board change. Every piece (`normal`, `container`, `player`)
is a flat color block; a container's interior is never drawn inside it.

Since then, this session added Void/self-loop-exit, Clone (`cloneOf`), Flip (`fliph`), and
Transfer (`linkedTo`) — four mechanics whose whole *point* is spatial relationships between
boards (what's inside what, what teleports where, what mirrors what). The flat-color,
one-board-at-a-time renderer makes none of this visible: a self-loop, a clone, and a plain
container currently differ only by an easily-missed hash-based fill color; a `fliph` or
`linkedTo` container has no visual marker at all; and there's no way to see what's "next
to" or "inside" anything without physically walking there and losing sight of where you
came from.

The user supplied two reference screenshots of the real Patrick's Parabox renderer. They
show the actual answer this spec adopts: **true continuous recursive rendering**. A
container is never a flat block — its own board is drawn, live, scaled down, inside its
cell, recursively, to whatever depth remains legible. There is no separate "camera cut"
between boards at all: the camera is a pan/zoom transform over one continuously-rendered
scene rooted at `root`, and entering/leaving a container is just that transform changing
smoothly. Content that belongs to no board at all (nothing above `root` in the containment
tree) renders as a black backdrop with sparse gray decorative dust — pure art direction,
unrelated to this engine's own `VOID_BOARD_ID` Void mechanic (a real, disconnected board
with real gameplay semantics — see "Two floating islands" below for how these interact).

## Goal

Replace the flat one-board-at-a-time renderer with a recursive renderer and a continuous
camera, so that: (1) every mechanic this session shipped is visually self-explanatory
without a separate icon legend, because the mechanic's actual effect (mirrored content,
a live peek at the main body, a shared edge) is what's drawn; (2) moving through the game
never "cuts" — the camera pans and zooms across one continuous scene; and (3) test levels
"feel like" they're testing something, because the mechanic they exercise is visibly
happening as you play, not just conceptually stateful under the hood.

## Explicitly out of scope this round

- **Click-to-inspect / peek-without-moving (originally proposed sub-project #5).** Once
  recursion is live, most of the motivating need — "let me see what's inside/around
  without walking there" — is already satisfied passively by the recursive draw itself.
  Revisit only if playtesting shows a real remaining gap (e.g. wanting to peek somewhere
  the camera currently can't reach because it's off the path from root to the player).
- **Final art / asset pipeline.** Per the user's explicit call this round: the goal is
  *diagnostic clarity* (can you tell what mechanic just happened), not shipped visual
  polish. Colors, shapes, and easing curves below are chosen to be clearly distinguishable
  and cheap to implement, not final art — expect a reskin pass later.
- **Mouse/touch interaction with the recursive scene** (clicking into a nested box,
  dragging the camera manually). Camera is fully driven by game state this round; manual
  camera control is a separate, later feature if wanted.
- **Editor (`EditorScreen.tsx`) rendering.** This spec covers `GameScreen`/`CanvasRenderer`
  only. The editor's own rendering is untouched and keeps its current flat style.
- **Mobile/perf tuning by device profiling.** The budget mechanism below (pixel-size cutoff
  + total-draw cap) is a *design-time* guardrail, not a tuned-against-real-hardware number.
  Exact constants are starting points for the implementer to adjust empirically.

## Core architecture: one continuously-recursive scene, camera is a transform over it

### The coordinate composition already exists — this reuses it, doesn't invent it

`computeTarget` (`rules.ts`) already climbs from a nested board up to its container's own
board, accumulating a `relativeCoord: Fraction` that expresses "where within the parent's
one cell does this nested position sit" at each step
(`divideByInt(addInt(relativeCoord, offset), board.size)`). Rendering needs exactly the
same composition, run in the opposite direction (root-down instead of nested-up) and
producing a plain `{x, y, scale}` transform instead of a `Fraction`: **a board's absolute
position is its container piece's absolute position, offset by the piece's local
`Location` scaled into one cell of the container's own absolute transform.** This is not
a new spatial model bolted onto the engine — it's the same "one cell of the parent board
equals the entire span of the child board" relationship the engine already climbs through
for movement, walked the other way for drawing.

```ts
// src/game/render/recursiveTransform.ts (new file)
export interface BoardTransform {
  boardId: BoardId
  originX: number   // this board's (0,0) cell's top-left corner, in root-relative
                     // "root cell units" (i.e. root's own cellSize == 1 unit)
  originY: number
  scale: number      // size (in root cell units) of ONE cell of THIS board;
                      // root's own transform has scale === 1
}

// Absolute transform of `boardId`, given the piece that owns it sits at `location`
// within a parent whose own transform is `parentTransform`.
function childTransform(parentTransform: BoardTransform, location: Location, childBoard: Board): BoardTransform {
  return {
    boardId: childBoard.id,
    originX: parentTransform.originX + location.x * parentTransform.scale,
    originY: parentTransform.originY + location.y * parentTransform.scale,
    scale: parentTransform.scale / childBoard.size,
  }
}
```

`root`'s own transform is `{ boardId: 'root', originX: 0, originY: 0, scale: 1 }` — one
root cell is exactly one unit. Every other board's transform is computed by walking down
from `root` via `findContainerFor`'s inverse (i.e. for each container piece on the board
currently being drawn, look up `piece.boardRef`, compute that child board's transform from
the piece's own `Location` and the current board's transform, and recurse).

### The recursive draw function

```ts
// src/game/render/CanvasRenderer.ts — replaces the current renderBoard
export interface RenderBudget {
  minCellPixels: number   // stop recursing into a board once one of ITS cells would
                           // render smaller than this many screen pixels (default: 4)
  maxCellsPerFrame: number // hard cap on total cell-draws across the whole recursive
                            // tree this frame (default: 4000) — protects against a
                            // pathological level (grid of containers each containing
                            // more containers) blowing up draw time regardless of
                            // per-branch pixel cutoffs
}

interface DrawContext {
  ctx: CanvasRenderingContext2D
  world: World
  camera: CameraTransform   // see "Camera" below — maps root-units to screen pixels
  budget: RenderBudget
  cellsDrawnSoFar: { count: number }  // mutable counter shared across the whole recursive call tree
}

function drawBoardRecursive(
  dc: DrawContext,
  board: Board,
  transform: BoardTransform,
  paleTint: boolean,       // true when drawing a clone's live peek (see "Clone" below)
  mirrorH: boolean,        // true when drawing inside a fliph container (see "Flip" below)
): void {
  const screenCellSize = transform.scale * dc.camera.pixelsPerRootUnit
  for (let y = 0; y < board.size; y++) {
    for (let x = 0; x < board.size; x++) {
      if (dc.cellsDrawnSoFar.count >= dc.budget.maxCellsPerFrame) return
      dc.cellsDrawnSoFar.count++
      const drawX = mirrorH ? board.size - 1 - x : x
      // ...fillRect at (transform.originX + drawX*transform.scale, ...) mapped through
      // dc.camera into screen pixels, size screenCellSize×screenCellSize...
    }
  }
  for (const [pieceId, location] of Object.entries(dc.world.locations)) {
    if (location.board !== board.id) continue
    const piece = dc.world.pieces[pieceId]
    // ...draw the piece's own fill at its cell (mirrored the same way as above if
    // mirrorH)...
    if (piece.kind === 'container' && screenCellSize >= dc.budget.minCellPixels) {
      const target = resolveRecursionTarget(dc.world, piece) // see below — handles
                                                                // boardRef vs cloneOf
      if (target !== null) {
        const childT = childTransform(transform, location, dc.world.boards[target.boardId])
        drawBoardRecursive(dc, dc.world.boards[target.boardId], childT, target.paleTint, mirrorH !== target.mirrorH)
      }
    }
  }
}
```

`mirrorH !== target.mirrorH` composes correctly for a `fliph` container nested inside
another `fliph` container (double negative cancels), matching `mirrorHorizontal`'s own
involution property already relied on in `rules.ts`.

### `resolveRecursionTarget` — per-mechanic recursion rules

```ts
function resolveRecursionTarget(world: World, piece: Piece): { boardId: BoardId; paleTint: boolean; mirrorH: boolean } | null {
  if (piece.cloneOf !== undefined) {
    // A clone has no boardRef of its own — recurse into whatever board the main
    // body is CURRENTLY on, live, exactly like the user's reference screenshot
    // (a clone shows the same content the real thing shows, paler). This is a
    // jump to an arbitrary other point in the tree, not a boardRef descent — the
    // generic per-branch pixel cutoff and the shared per-frame draw budget are
    // what keep this safe (a clone of a clone, or a main body that's itself deep
    // inside a huge structure, just costs more of the shared budget, the same as
    // any other expensive branch — no special-case cycle guard needed beyond the
    // budget already required for self-loops).
    const mainBodyLoc = world.locations[piece.cloneOf]
    if (mainBodyLoc === undefined) return null
    // Deliberately NOT piece.fliph (the clone's own field): the Flip spec's final
    // revision established that a clone's own fliph is inert for gameplay — tryEnter's
    // cloneOf interception returns before into.fliph is ever read, so it has no effect
    // on an actual entry. Applying it here anyway would render a mirrored peek that
    // lies about what really happens if the player walks over and enters for real.
    // The main body's OWN fliph is what actually mirrors its interior, so that's what
    // the peek uses.
    return { boardId: mainBodyLoc.board, paleTint: true, mirrorH: world.pieces[piece.cloneOf]?.fliph ?? false }
  }
  if (piece.boardRef === undefined) return null
  return { boardId: piece.boardRef, paleTint: false, mirrorH: piece.fliph ?? false }
}
```

A clone recursing into "whatever board the main body is on" needs that board's own
transform to draw the main body's *neighbors* in their correct relative positions too —
but this function only returns a `boardId`, not a `Location` within it. The caller
(`drawBoardRecursive`) draws that whole board via `childTransform`, exactly as it would
for any container — the fact that this is a *second, independent* placement of the same
board in the overall recursive tree (once at its real position under `root`, again inside
every clone pointing at it) is fine: `childTransform` only needs a parent transform and a
location, and both copies get their own, independently computed. Two clones of the same
main body simply produce two subtrees with identical *content* but different `originX/Y/scale`.

### Stop conditions

Two independent limits, matching the two failure modes:

1. **Per-branch pixel cutoff** (`minCellPixels`, default 4px): stops a self-loop, a
   multi-node cycle, or a clone-of-a-clone from recursing forever — once a board's own
   cells would render below this size, `drawBoardRecursive` isn't called for it; the
   container just keeps its flat fill color instead. This requires **no cycle-detection
   code at all** — a self-loop naturally shrinks by `1/board.size` every recursive step
   (since `childTransform`'s `scale` divides by `childBoard.size` each level), so it
   *always* terminates in a bounded number of steps for any `board.size > 1`, and the
   existing `CYCLE_PALETTE` hash-coloring becomes optional polish rather than the only
   cycle indicator (see "Keep or drop `CYCLE_PALETTE`" below).
2. **Per-frame total draw budget** (`maxCellsPerFrame`, default 4000): stops a level with
   many separate expensive branches (e.g. ten containers each with a deep interior, none
   individually near the pixel cutoff) from adding up to an unbounded frame cost. Checked
   once per cell-draw, shared via a mutable counter across the whole recursive call tree
   for one frame; once exhausted, remaining unvisited branches simply don't recurse
   further this frame (they still show their own flat fill, just not their interior) —
   never a hard error, always a graceful "less detail this frame."

Both numbers are starting points (comment says so in the interface) — the implementer
tunes them against real levels during implementation, not a spec-mandated exact value.

### Keep or drop `CYCLE_PALETTE`?

**Keep it**, as a secondary signal layered under the recursive draw, not instead of it.
Reasoning: the pixel cutoff means a *heavily zoomed-out* self-loop (its own cells already
near the 4px floor) shows almost no recursive detail — at that zoom level, the distinct
hash color is the only remaining way to tell "this recurses forever" apart from "this is
an ordinary container that happens to be small on screen right now." Losing it would
regress a working, tested piece of existing behavior for a benefit (one less color system)
that only matters at zoom levels where the recursion is providing the least information
anyway. `LOCKED_RING_COLOR` and the `∞` marker for Void infinite-destinations are kept for
the same reason — they're both orthogonal, cheap, already-shipped signals that the new
recursion doesn't replace or conflict with (see "Two floating islands" for how the ring
and `∞` marker meet the new backdrop).

## Per-mechanic visual rules (summary table)

| Mechanic | Recursion target | Visual marker |
|---|---|---|
| Plain container | own `boardRef` | none beyond the recursion itself |
| Self-loop / cycle member | own `boardRef` (shrinks toward itself) | `CYCLE_PALETTE` hash color, kept as a secondary signal |
| Clone (`cloneOf`) | main body's **current** board (live, jumps across the tree) | paler tint (see "Clone tint" below) over whatever color the content would normally have |
| Flip (`fliph`) | own `boardRef`, drawn horizontally mirrored | the mirrored content itself is the marker — no separate color/icon needed |
| Transfer (`linkedTo`) | own `boardRef`, unaffected | a distinct-colored border stripe on the shared edge (the edge `linkedEntryCell` maps through) |
| Void infinite destination | n/a (`infiniteFor`, not a container) | unchanged: colored as the real piece, `∞` marker, pale-slate ring (all pre-existing) |
| Locked (standing in the Void) | — | unchanged: pale-slate ring (pre-existing) |

### Clone tint

A flat alpha-blend toward white, applied uniformly to every fill color drawn anywhere
inside a clone's recursive subtree (the clone's own container fill, and every cell/piece
color inside its recursively-drawn content) — e.g. `mixWithWhite(color, 0.35)`. This reads
as "paler version of the real thing," matching the reference screenshot, and composes for
free with the existing color system (self-loop colors, plain piece colors, everything)
since it's a post-processing step on whatever color would otherwise be used, not a
separate palette.

### Transfer edge stripe

`Piece.linkedTo` already carries a `direction`-free "which edge" concept implicitly (any
of the four edges can be the glued one, depending on which direction a piece exits at,
per `linkedEntryCell`) — for rendering, only the *fact* of being linked needs to show,
not a specific edge (the level author is free to link containers of any relative size or
position, and there's no single "this edge always" rule to draw). Simplest faithful
option: draw a thin distinct-colored full-perimeter border on a `linkedTo` container (and
on its target, since the link's terminal `location` result is symmetric in effect even
though `linkedTo` is authored one-directionally) — cheap, unambiguous, doesn't need to
know which specific edge the player will exit through since that depends on which
direction they push.

## Two floating islands: `root` and the Void

`root` has no owner (nothing ever sets `boardRef` to `'root'` from outside the level's own
authored content in a way that would give it a container) — it's always the top of its own
containment tree, floating in the black backdrop per the reference screenshots. But this
engine's Void (`VOID_BOARD_ID`) is a **second, structurally disconnected board** —
synthesized lazily by `ensureInfiniteDestination`, never a descendant of `root` via any
`boardRef` chain. A camera model of "always recurse from `root`, pan/zoom to find the
player" has no path to the Void at all: it's not reachable by walking `boardRef` links no
matter how far you recurse, because nothing on the `root` tree owns it.

**Resolution:** the Void is the second floating island, rendered exactly like `root` is —
its own recursive tree, `{boardId: 'void', originX: 0, originY: 0, scale: 1}`, floating in
the same black backdrop art style. The camera has exactly one anchor at a time —
`root`'s tree or the Void's tree — determined by which one the player (`PLAYER_ID`) is
currently reachable from (in practice: `isInVoid(world, PLAYER_ID)` picks the Void anchor,
otherwise `root`). A piece other than the player sent to the Void while the player stays
on the `root` side is invisible until the anchor switches — unchanged from the current
shipped renderer, which already only ever draws the player's own current board, so this
isn't a regression this spec introduces, just a limitation worth naming.

**Switching anchors is the one remaining hard transition** — there is
no continuous pan/zoom path between two disconnected trees, so it gets its own dedicated
effect ("fall into darkness": a brief full-screen darken/desaturate + zoom-toward-black,
then swap the anchor and fade the new tree in) rather than either a jarring instant cut or
a fabricated pan across unrelated geometry. This is the *only* non-continuous camera
transition in the whole system — every other transition (entering/leaving a container,
crossing a `linkedTo` edge, a clone teleport) has a real geometric path through the same
recursively-rendered tree and gets a real pan/zoom.

## Camera

```ts
// src/game/render/camera.ts (new file)
export interface CameraTransform {
  // Maps a point in root-units (or void-units, whichever tree is currently anchored)
  // to screen pixels.
  centerX: number   // root-unit (or void-unit) x the canvas center is currently looking at
  centerY: number
  pixelsPerRootUnit: number  // current zoom level
  anchor: 'root' | 'void'
}

// Computes the camera transform that centers the player at a given zoom, by walking
// the player's actual containment chain (via findContainerFor, root/void-down) to get
// the player's absolute position in root-units (or void-units) — this is exactly
// childTransform's accumulation, applied to the player's own Location.
export function cameraForPlayer(world: World, pixelsPerRootUnit: number): CameraTransform
```

The camera's `centerX/centerY/pixelsPerRootUnit` are the values that get **tweened**
frame-to-frame (see "Animation" below) — `cameraForPlayer` computes the *target* transform
for the current `World` snapshot; the actual rendered transform each frame is an eased
interpolation toward that target, not a snap. This is what makes "entering a container" a
zoom instead of a cut: the target camera's `pixelsPerRootUnit` jumps up (the player's new
containing board has a much larger `scale` in root-units) and the render loop eases toward
it over a fixed duration rather than applying it instantly.

## Animation

Four distinct animated behaviors, layered on top of the static recursive draw:

1. **Ordinary piece movement** (push/walk, no board change): the moved piece's screen
   position tweens from its pre-move to its post-move cell over a short fixed duration
   (e.g. 120ms, ease-out) instead of snapping. `GameScreen` already has both the
   pre-move `World` (its own ref, or `GameState.history[history.length - 2]`) and the
   post-move `World` (`state.current`) available around every `move()` call — the tween
   interpolates each moved piece's `(x, y)` independently between those two snapshots'
   `Location` values (only pieces whose `Location` actually changed need tweening; most
   pieces on the visible board don't move on a given turn).
2. **Entering/leaving a container**: purely a `cameraForPlayer` target change, eased over
   a slightly longer duration than an ordinary move (e.g. 250ms) — no special-case code
   beyond the camera's own interpolation, since the whole point of the continuous scene is
   that this isn't a distinct kind of event from the camera's perspective.
3. **Clone teleport / Transfer crossing**: both are cases where the *player's* (or a
   pushed piece's) `Location.board` jumps to a place that isn't a simple parent/child of
   where it just was, but which — because both the source and destination are real points
   in the same `root`-rooted (or Void-rooted) recursive tree — has a real, computable pair
   of absolute root-unit positions. The camera eases from the source position to the
   destination position directly (a longer, distinct-feeling pan, e.g. 400ms) rather than
   the shorter "just zoom" duration used for ordinary containment changes — this is what
   makes a teleport *read* as "the camera swooped somewhere," not merely a longer zoom.
4. **Void entry/exit**: the dedicated "fall into darkness" transition from the "Two
   floating islands" section above — the one non-continuous case.

`GameScreen` determines which of these four applies by diffing the pre-move and post-move
`World`: if `PLAYER_ID`'s `Location.board` is unchanged, it's case 1 (or no camera change
at all); if changed and the new board is `VOID_BOARD_ID` or the old one was, it's case 4;
otherwise, it's case 2 or 3 depending on whether the new board is literally the old
container's `boardRef` / the old board's owner's `boardRef` (a simple containment step) or
not (anything else — clone or link) — this distinction only affects *which duration/easing
preset* is used, not whether a path exists, since `cameraForPlayer` computes the correct
target position either way.

## Files touched (expected shape, not a full plan)

- **New:** `src/game/render/recursiveTransform.ts` (`childTransform`, `BoardTransform`),
  `src/game/render/camera.ts` (`CameraTransform`, `cameraForPlayer`, interpolation helper).
- **Rewritten:** `src/game/render/CanvasRenderer.ts` (`drawBoardRecursive` replaces
  `renderBoard`; `resolveRecursionTarget`; per-mechanic color/tint/border helpers).
- **Rewritten:** `src/game/GameScreen.tsx` (drives a `requestAnimationFrame` loop instead
  of a one-shot `useEffect` redraw per move; tracks pre/post `World` pairs for tweening;
  computes `cameraForPlayer` targets and eases toward them; the canvas itself likely needs
  to be a fixed viewport size now rather than resized to match `currentBoard.size` each
  move, since the camera — not the canvas dimensions — now expresses "which board, how
  much of it" is visible).
- **Untouched:** `src/game/engine/**` (this is a pure rendering/camera change — no engine
  file needs to change; every mechanic this reuses, e.g. `findContainerFor`,
  `mirrorHorizontal`'s composition property, `linkedEntryCell`'s edge concept, was already
  built for gameplay resolution and is being read, not modified, by the renderer).

## Testing strategy

- **`recursiveTransform.test.ts`**: `childTransform` composition — a two-level and a
  three-level nesting produce the expected `originX/Y/scale`; a self-loop's own
  `childTransform` applied to itself shrinks `scale` by exactly `1/board.size` each call
  (the property the pixel-cutoff argument above depends on — verify it directly rather
  than just asserting termination).
- **`camera.test.ts`**: `cameraForPlayer` returns the `root` anchor's identity-composed
  position for a player standing directly on `root`; returns a correctly-scaled-up
  position for a player nested two levels deep (hand-computed expected value, same
  discipline as this session's engine specs); returns the Void anchor when
  `isInVoid(world, PLAYER_ID)`.
- **`CanvasRenderer.test.ts`**: existing tests (flat color per kind, requirement overlay,
  wall vs floor, cycle coloring, lock ring, infinity marker) continue to hold at zero
  recursion depth (a board with no visible containers, or containers whose screen size is
  below `minCellPixels`) — these should need minimal changes, since "draw this one board's
  cells and pieces" is still the base case of the recursive function. New tests: a
  container whose interior IS above the pixel cutoff triggers a nested `drawBoardRecursive`
  call (spy/count fillRect calls for the nested board's own cells); a clone renders its
  main body's actual current content, not its own (nonexistent) `boardRef`; a clone's fill
  colors are provably paler than the same content's un-cloned colors (compare parsed RGB
  channels, not just string inequality); a `fliph` container's recursively-drawn interior
  is mirrored (leftmost real cell renders at the rightmost screen position); a
  `maxCellsPerFrame` budget of e.g. 5 stops a deep recursion after exactly 5 cell-draws,
  provably (not just "doesn't crash").
- **`GameScreen.test.tsx`**: an ordinary push produces intermediate tweened frames between
  the pre/post positions before settling (mock `requestAnimationFrame`, advance a few
  frames, assert an in-between rendered position); entering a container changes the camera
  target without changing which board's data is drawn (the recursive tree already contains
  it); undo reverts both state and any in-flight animation cleanly.
- **Manual verification** (per sub-project 2's own precedent — this is not fully
  automatable for a canvas-rendered, continuously-animated scene): play all three of this
  session's new demo levels (`11-clone-box`, `12-flip-box`, `13-transfer`) in the actual
  browser and confirm each one *looks* like what it's testing — this was the user's
  original complaint motivating this whole spec, and is the real acceptance bar.
