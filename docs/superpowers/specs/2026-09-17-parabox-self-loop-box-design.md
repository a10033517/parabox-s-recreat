# Parabox Self-Loop Box (Sub-project 6)

## Background

The engine (`src/game/engine/`) models containment as a strict tree: every non-root
`Board` has exactly one container piece whose `boardRef` points at it, walking upward
from any board eventually reaches the root (which has none). `levelSchema.ts`'s
`parseLevel` enforces this explicitly, with a comment noting that a containment cycle
"would otherwise hang `applyMove`'s board-exit recursion forever."

*Patrick's Parabox* itself has self-containing boxes and a full infinite-exit paradox as
part of its own mechanics. This project does not reproduce that paradox in full — it
simplifies the infinite-exit transition to a single rule: the piece that triggers it is
removed from the world; if that piece is the player, the game enters a lost state. A
richer version of this — a level author explicitly marking a container as "the infinity
destination," so a triggering piece is relocated there instead of removed outright — is
a distinct, larger feature (a new per-piece marker, schema validation for it, and editor
UI) and is **out of scope for this spec**, tracked separately as sub-project 7.

The user's stated intent for this increment is a single self-contained box; general
multi-box cycles (A's interior is B, B's interior is A) are an explicit future
increment, not this one — though the detection mechanism this spec builds generalizes
to that case without modification. This spec includes one regression test proving the
opposite direction holds too: relaxing validation for this one specific shape must not
accidentally start accepting unrelated general cycles.

This depends on the editor rework (sub-project 3, shipped on `master`) for level
authoring, and precedes sub-project 7 (authored infinity destinations) and any future
work on general N-cycles.

## Scope

**In scope:**
- A container piece whose `boardRef` equals the very board it is physically located on
  — no second piece involved, and no restriction on which board (root included).
- `computeTarget`/`tryMovePiece` (`rules.ts`) are extended to detect when climbing out
  of a board's boundary would revisit a board already visited in the same climb, and to
  resolve that by removing the piece that triggered it from the world.
- `levelSchema.ts` is relaxed so a self-referencing container piece doesn't count
  toward its board's owner tally (otherwise a self-loop on the root board would make
  root look "owned" and break the single-root invariant) — with a regression test
  proving this relaxation doesn't also open the door to unrelated multi-board cycles.
- `worldEdit.ts`'s `deletePieceRecursively` is fixed so deleting a self-referencing
  container deletes only that piece — never the board it's also sitting on, or that
  board's other contents (which may include the player, standing right there).
- `rules.ts` gets a `checkLose` pure function, symmetric to `checkWin`: true when the
  player piece has no location. `GameState.ts` gets an `isLost` getter. `GameScreen.tsx`
  shows a small in-place "lost" notice with a recovery action when `isLost` is true.
  This state is genuinely reachable through ordinary play once a self-loop level exists.
- The editor (`EditorScreen.tsx`) gets a new tool that places a self-referencing
  container on the currently-viewed board (any board, including root).

**Explicitly out of scope:**
- **Authored infinity destinations** (sub-project 7): a level author marking a specific
  container as "where triggering pieces go" instead of removal. This spec's
  `removePiece` is written as the one and only current behavior, not as a default with
  a hook for sub-project 7 to override — YAGNI; sub-project 7 can refactor the call site
  when it exists.
- General multi-board cycles (A owns B, B owns A) — a future increment. The detection
  mechanism this spec adds is not cycle-length-specific, but nothing here is written,
  tested, or validated against that shape on purpose, beyond the one regression test
  confirming it's still rejected.
- The generator/solver (`tools/generator/*`) — untouched; self-loop levels are
  hand-authored via the editor only, exactly like the editor-rework precedent. `solve()`
  would not crash if it ever encountered a self-loop world (a "vanish" transition is
  just an ordinary new BFS state), but nothing in this spec makes the generator produce
  or reason about self-loop levels.
- Any change to `CanvasRenderer.ts` (it already draws one board at a time, flat; a
  self-loop needs nothing new from it — a vanished piece simply has no location entry
  to draw).
- A dedicated "you lost" screen/route or an `onLose` callback into `App.tsx` — the UI is
  a simple, always-available in-`GameScreen` notice, not new navigation.
- Any audio/visual feedback for a non-player piece vanishing (it simply stops being
  drawn, like any other piece with no location).

## Self-Loop Core Semantics

A self-loop box `B` on board `Y` satisfies:

```ts
locations[B].board === pieces[B].boardRef === Y
```

`B` is otherwise a completely normal movable, pushable piece. Self-loop changes only
`B`'s containment relation, nothing about its own movement semantics. `Y` can be any
board, root included; nothing else needs to reference `Y` at all.

- **Entering `B`:** a direct lookup of `B.boardRef` (`tryEnter`, unchanged), placing the
  mover on `Y`. No recursion — entering is never where the risk is.
- **Moving inside `Y`:** identical to ordinary board movement.
- **Exiting `Y`:** `computeTarget` checks whether stepping off the edge lands in bounds
  of `Y`. If it does, the exit resolves there — i.e. stepping off `Y`'s edge relocates
  you to a different cell of the same board (a harmless "wrap," not suppressed by this
  spec). If it's still out of bounds, traversal follows `Y`'s owner — `B` — using `B`'s
  own current position. If that traversal returns to a board already visited earlier in
  this same climb, **and** the requested direction is still out of bounds from there,
  the transition is classified `infinite`.

Pushing `B` to any edge of `Y`, then trying to exit `Y` through that specific edge, is
exactly the trigger. `infinite` is a classification of one movement transition, not a
state permanently attached to a board edge — if `B` is later moved or deleted, the
containment relation changes, and the same exit may no longer be infinite.

`findContainerFor` (`types.ts`) needs **no change**: for a board owned solely by its
self-referencing piece, it already returns that piece — the only candidate, exactly as
today's "exactly one owner" code already assumes.

## `computeTarget` / `tryMovePiece` changes (`rules.ts`)

`computeTarget`'s job is to classify a movement transition, nothing more; what an
`infinite` classification *means* for gameplay belongs to the caller. Its return type
becomes an explicit tagged shape instead of an ad-hoc string sentinel, so a future
mechanic (sub-project 7's authored destinations, or general cycles) can add a new
classification without `computeTarget` needing to know what any of them mean:

```ts
export type MoveTarget =
  | { kind: 'location'; location: Location; relativeCoord: Fraction }
  | { kind: 'infinite' }
  | null // blocked: no owner to climb through (e.g. the true root boundary)
```

`computeTarget` gets an internal `visited: Set<BoardId>` (a new optional parameter,
defaulted to a fresh `Set()` so every top-level call starts clean) threaded through its
recursive calls:

```ts
export function computeTarget(
  world: World,
  loc: Location,
  dir: Direction,
  relativeCoord: Fraction,
  visited: Set<BoardId> = new Set(),
): MoveTarget {
  const board = world.boards[loc.board]
  const { x, y } = step(loc.x, loc.y, dir)

  // inBounds MUST be checked before visited — a legitimate "wrap" (the recursive
  // owner position happens to be in bounds) is not a cycle, even if loc.board has
  // been visited before in this climb. Checking visited first would misclassify
  // every ordinary self-loop wrap as infinite.
  if (inBounds(board, x, y)) {
    return { kind: 'location', location: { board: loc.board, x, y }, relativeCoord }
  }

  if (visited.has(loc.board)) return { kind: 'infinite' }
  visited.add(loc.board)

  const containerId = findContainerFor(world, loc.board)
  if (containerId === undefined) return null

  const offset = dir === 'up' || dir === 'down' ? loc.x : loc.y
  const newRelativeCoord = divideByInt(addInt(relativeCoord, offset), board.size)

  const containerLoc = world.locations[containerId]
  return computeTarget(world, containerLoc, dir, newRelativeCoord, visited)
}
```

For any level that exists today (no self-references, a strict ownership tree), every
step of a climb visits a board it's never visited before — climbing a tree from a leaf
to the root never revisits a node — so `visited.has(...)` is never true and behavior is
completely unchanged. The check only ever fires once a genuine cycle (this increment's
single self-loop, or a future multi-box one) exists in the world being walked.

**What makes this sound, precisely:** within one `computeTarget` call chain, the `World`
itself is never mutated, and neither is any piece's location — this is a pure
classification pass over a fixed snapshot. So a board's owner, and that owner's
position, cannot change between two visits to the same board within the same climb. If
climbing reaches a board it has already left once, unresolved, in the very same
direction, no input that matters has changed, and none ever will within this call — the
transition is genuinely unresolvable, not merely difficult. (`relativeCoord` does change
between recursive calls, but it only carries the fractional cross-boundary coordinate
forward for a *successful* exit — it plays no role in whether the next step lands in or
out of bounds, which is purely a function of the owner's grid position and the
direction.)

`tryMovePiece` is the sole caller of `computeTarget`, and decides what `infinite` means
under the current game rules — today, removal:

```ts
// types.ts, alongside the existing moveTo
export function removePiece(world: World, pieceId: PieceId): World {
  const next = cloneWorld(world)
  delete next.pieces[pieceId]
  delete next.locations[pieceId]
  return next
}
```

```ts
// rules.ts, tryMovePiece
const target = computeTarget(world, loc, dir, HALF)
if (target === null) return null
if (target.kind === 'infinite') return removePiece(world, pieceId)

const targetBoard = world.boards[target.location.board]
// ...unchanged from here, reading target.location instead of the old bare object
```

That's the entire change to the call graph. Nothing else in `rules.ts` needs to know
about `infinite` as a concept, because of how the existing chain already composes:

- **The player walks into it directly:** `applyMove` calls
  `tryMovePiece(world, PLAYER_ID, dir, ...)` at the top level. If that resolves to
  `infinite`, the function returns a world with `PLAYER_ID` removed — an ordinary, valid
  `World`, the same shape `applyMove` always returns on a successful move. `checkLose`
  reads that as a loss. `GameState.move()` still pushes it onto history like any other
  move, so `undo()` still recovers the pre-loss state.
- **Something else gets pushed into it:** `resolveBlocked` calls
  `tryMovePiece(world, occupantId, dir, ...)` to try pushing whatever is in the way.
  Today, a non-`null` result is treated as "the push succeeded, and `pushed` is the
  resulting world" — `moveTo(pushed, pieceId, target.location)` then places the
  *pusher* at its own target cell on top of that world. A "vanished" result is just an
  ordinary `World` missing `occupantId`, so this existing code needs **no change**: the
  pusher completes its move normally, and the pushed piece is simply gone from the
  resulting world.
- **The player gets pushed into it:** the same `tryMovePiece(world, PLAYER_ID, ...)`
  call inside `resolveBlocked` returns a world with the player removed, flowing through
  `moveTo(pushed, pieceId, target.location)` unchanged, producing a world with no
  player — `checkLose` still catches it.

**Intentional rule, stated explicitly (not left as an implementation accident):** any
movement transition that removes `PLAYER_ID` — whether the player initiated the move
directly, or another piece's push chain caused it — results in a lost state. There is no
semantic difference in this engine between "the player walked into infinity" and "the
player was pushed into infinity"; both are simply "the player's position became
unresolvable."

## `levelSchema.ts` change

A container piece is **self-referencing** when `locations[piece.id].board ===
piece.boardRef`. The existing ownership-count loop must skip self-referencing pieces
when incrementing each board's owner tally. Without this, a self-loop placed on the
root board would make `ownerCount[root] === 1`, and the "exactly one board with no
owner is the root" check would find zero orphaned boards and reject an otherwise-valid
level. With self-references excluded from the count:

- A self-loop on the root board leaves `ownerCount[root] === 0` — root is still
  correctly identified as the sole orphan/root.
- A self-loop on a normal non-root board `Y` that also has a real external owner (a
  separate container elsewhere with `boardRef: Y`) leaves `ownerCount[Y] === 1` (from
  the external owner alone) — valid, unaffected either way.
- A self-loop on a non-root board with **no** external owner leaves `ownerCount[Y]
  === 0`, correctly surfacing as a second orphan board (found 2, not 1) — such a board
  is genuinely unreachable from outside itself, and the existing error is the right one.

No other change to `levelSchema.ts` is needed: the reachability BFS already only
enqueues a board's owner when that board isn't already in `reached`, so a
self-referencing piece (whose `boardRef` always equals a board it's already sitting on,
hence already reached) is naturally a no-op there.

**Regression requirement:** this relaxation is scoped narrowly — it must not weaken
validation for an unrelated, still-invalid shape. A hand-built two-board mutual cycle
(board A's occupant owns board B, board B's occupant owns board A — neither
self-referencing) must still be rejected by `parseLevel`, exactly as it is today.

| Configuration | Expected result |
|---|---|
| Self-loop on root | accepted |
| Self-loop on non-root board with a real external owner | accepted |
| Self-loop on non-root board with no external owner | rejected (2 orphan boards) |
| Two-board mutual cycle (A owns B, B owns A), no self-reference | rejected (unchanged) |

## `worldEdit.ts` changes

**Invariant:** deleting a self-loop piece must not delete or mutate the board
identified by its own `boardRef` — that board is the one the piece is *also standing
on*, and may contain the player, other boxes, and other nested boards.

`deletePieceRecursively` currently assumes deleting a container always means deleting
its board and cascading into everything on that board. Fix: when the stack-based walk
pops a container piece, only cascade into deleting its board (and recursing into that
board's occupants) when the piece is **not** self-referencing
(`locations[pieceId].board !== piece.boardRef`). A self-referencing container is
deleted as a single piece, nothing more — its board and everything else on it survive
untouched.

**New export**, `placeSelfLoopBox(world, boardId, x, y, ids): { world: World; ids:
EditorIds } | null`, mirroring `placeNormalBox`/`placeContainerBox`'s shape: allocates a
new piece id, places a `kind: 'container'` piece at `(x, y)` on `boardId` with
`boardRef: boardId` (the board it's already on — no new board is allocated, so only
`nextBoxId` advances, never `nextBoardId`). Returns `null` only when the target cell is
blocked (reusing `canPlacePieceAt`, same as the other two placement functions) — no
board restriction; root is a valid target.

## `rules.ts` / `GameState.ts` changes

```ts
export function checkLose(world: World): boolean {
  return world.locations[PLAYER_ID] === undefined
}
```

By design, `checkLose` only ever asks "does the player currently have a location?" — it
has no opinion on *why* the player might not. That keeps it reusable by any future
mechanic that can also cause player removal, without needing to know about `infinite`
transitions specifically.

`GameState.ts` gets `get isLost(): boolean { return checkLose(this.current) }`,
alongside the existing `isWon` getter.

## `GameScreen.tsx` change

When `state.isLost` is true, render a small notice in place (not a new screen or route)
offering the same recovery action the HUD's existing "复位上一步" (undo) button already
provides — extract that button's `onClick` body into a shared `handleUndo` function used
by both the HUD button and the notice's own button. No new prop, no `onLose` callback
into `App.tsx`.

## Editor changes

`EditorScreen.tsx` gets one new tool, "自包箱" (`self-loop-box`), alongside the existing
seven. Clicking it on a cell calls `placeSelfLoopBox(world, activeBoardId, x, y,
idsRef.current)`; a `null` result (blocked cell) is a no-op, exactly like the existing
wall-blocks-a-goal-tool rejection — no button-disabling, click-time rejection only,
consistent with every other tool in this file. This tool has no board restriction: it
works on root exactly like anywhere else.

## Responsibility summary

```text
computeTarget()
    │
    ├── { kind: 'location', ... }   — normal exit/wrap
    ├── null                        — blocked (no owner to climb through)
    └── { kind: 'infinite' }        — cyclic, unresolvable transition
             │
             ↓
      tryMovePiece() decides the current game rule:
             │
             └── removePiece(world, pieceId)

checkLose(world)
    only asks: does PLAYER_ID have a location? — never why it might not.

worldEdit.ts guarantees:
    normal (external-owner) container deletion → recursive board deletion
    self-referencing container deletion         → single-piece deletion only
```

Keeping `computeTarget` a pure classifier (rather than baking "remove the piece"
directly into its own return value) means a future mechanic — sub-project 7's authored
infinity destinations, or eventual general-cycle support — can add new classifications
or a different `tryMovePiece`-level response without `computeTarget` itself changing.

## Testing

### `rules.test.ts`

- `computeTarget` returns `{ kind: 'infinite' }` only when a climb revisits an
  already-visited board **and** the recursive exit remains out of bounds; a non-flush
  self-loop exit (the recursive position lands in bounds) resolves as a normal
  `{ kind: 'location', ... }` "wrap," not infinite. A perpendicular direction that
  doesn't continue the out-of-bounds condition also resolves normally.
- `tryMovePiece` converts an `infinite` classification into `removePiece` for both a
  player-piece move and a non-player-piece move — same code path, verified for both.
- End-to-end `applyMove` tests:
  - Walking into and back out of a self-referencing container through a *non-flush*
    edge behaves like a normal wrap (lands elsewhere on the same board, not a crash).
  - Pushing the self-referencing box flush against an edge, then stepping that same
    direction, removes the mover from the world.
  - A push chain (`Player → box A → self-loop box B`, player pushes toward B which is
    already flush against an edge) removes only `A`; the player completes its own move
    normally; `B` and its board are untouched. This exercises `resolveBlocked`'s
    existing composition, not just `tryMovePiece` in isolation — regression coverage
    for "pushing something into infinity doesn't just happen to work today, it's
    structurally guaranteed by how `moveTo(pushed, pieceId, target.location)` composes."
  - A push chain where the piece pushed into infinity is the **player itself** (some
    other piece pushes the player, and that resolves to infinite): `PLAYER_ID` is
    removed, `GameState.isLost` becomes true, and `undo()` recovers the pre-loss state
    — proving direct player movement and push-caused player movement share the same
    loss semantics.
  - `checkWin`/`checkLose` behave correctly against a world containing a self-reference.

### `types.test.ts`

- `removePiece` deletes both the `pieces` and `locations` entry for the given id and
  leaves every other piece untouched.
- `findContainerFor` needs no new test — its behavior is unchanged (already covered).

### `levelSchema.test.ts`

All four rows of the acceptance/rejection table above, each as its own test:
self-loop-on-root accepted and root still correctly identified; self-loop on a
non-root board with a real external owner accepted; self-loop on a non-root board with
no external owner rejected (2 orphans); the unrelated two-board mutual-cycle shape
still rejected exactly as before.

### `worldEdit.test.ts`

- `placeSelfLoopBox` places a piece with `boardRef` equal to its own board, including
  on root; blocked when the cell is occupied by (or transitively contains) the player.
- `deletePieceRecursively` deleting a self-referencing piece, on a board that also has
  a player, an ordinary box, and other content, leaves everything except the
  self-referencing piece itself untouched (the board, the player, the ordinary box all
  still present) — the most important mutation-regression test in this spec, since it's
  the one place a subtle mistake would silently destroy unrelated player/level state.
- Deleting a board's *external* owner still cascades through a self-referencing piece
  living inside it, exactly as before (only the self-reference case is special-cased).

### `EditorScreen.test.tsx`

- Placing 自包箱 on any board (root included) creates a piece whose `boardRef` equals
  the currently-active board id; it's never rejected there.

### `GameScreen.test.tsx`

- With a hand-constructed `initialWorld` that is *already* in a lost state (no player
  location — a shortcut past needing a real in-game trap for this component-level
  test), the lost notice renders and its recovery button calls `undo`.

### `GameState.test.ts`

- A separate, real end-to-end test (alongside the existing `isWon` coverage) walks a
  hand-built self-loop level into the trap via real moves and confirms
  `GameState.isLost` becomes true and `undo()` recovers it.
