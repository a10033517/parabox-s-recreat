# Parabox Self-Loop Box (Sub-project 6)

## Background

The engine (`src/game/engine/`) models containment as a strict tree: every non-root
`Board` has exactly one container piece whose `boardRef` points at it, walking upward
from any board eventually reaches the root (which has none). `levelSchema.ts`'s
`parseLevel` enforces this explicitly, with a comment noting that a containment cycle
"would otherwise hang `applyMove`'s board-exit recursion forever."

This spec adds the classic recursive-box trick from *Patrick's Parabox*: a single
container box whose interior is the very room it's sitting in. Opening it shows a copy
of the same room, containing itself again — and pushing it flush against a wall of that
room turns that specific wall into a genuine, deliberate dead end: anything that exits
through it (the box itself, another pushed piece, or the player) falls into unresolvable
recursion. For the player, that's a loss. For anything else, it's how you make something
disappear from the level permanently — a real mechanic in the original game, not a bug
to be designed away.

The user's stated intent is a single self-contained box, built increment-by-increment;
general multi-box cycles (A's interior is B, B's interior is A) are an explicit future
increment, not this one — though the detection mechanism this spec builds (see below)
generalizes to that case without modification, which is a useful side effect, not
something this increment tests or relies on.

This depends on the editor rework (sub-project 3, shipped on `master`) for level
authoring, and precedes any editor UI or engine work for general N-cycles.

## Scope

**In scope:**
- A container piece whose `boardRef` equals the very board it is physically located on
  — no second piece involved, and no restriction on which board (root included).
- `computeTarget`/`tryMovePiece` (`rules.ts`) are extended to detect when climbing
  out of a board's boundary would repeat a board it has already visited in the same
  climb, and to resolve that by removing the piece that triggered it from the world
  instead of crashing or hanging.
- `levelSchema.ts` is relaxed so a self-referencing container piece doesn't count
  toward its board's owner tally (otherwise a self-loop on the root board would make
  root look "owned" and break the single-root invariant).
- `worldEdit.ts`'s `deletePieceRecursively` is fixed so deleting a self-referencing
  container deletes only that piece — never the board it's also sitting on, or that
  board's other contents (which may include the player, standing right there).
- `rules.ts` gets a `checkLose` pure function, symmetric to `checkWin`: true when the
  player piece has no location. `GameState.ts` gets an `isLost` getter. `GameScreen.tsx`
  shows a small in-place "lost" notice with a recovery action when `isLost` is true.
  Unlike the previous draft of this spec, this state is now genuinely reachable through
  ordinary play once a self-loop level exists.
- The editor (`EditorScreen.tsx`) gets a new tool that places a self-referencing
  container on the currently-viewed board (any board, including root).

**Explicitly out of scope:**
- General multi-board cycles (A owns B, B owns A) — a future increment. The detection
  mechanism this spec adds is not cycle-length-specific, but nothing here is written,
  tested, or validated against that shape on purpose.
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

## Design: a single piece, and where the risk actually is

Earlier drafts of this spec assumed a self-loop needed two pieces (an external owner
elsewhere, plus a self-referencing one inside), and that self-looping the root board
was uniquely dangerous and should be forbidden. Both assumptions were wrong. The
mechanic needs exactly **one** piece: a container `B`, sitting at some cell on board
`Y`, with `B.boardRef === Y` — its own interior is the room it's already standing in.
`Y` can be any board, root included; nothing else needs to reference `Y` at all.

**Entering** `B` (`tryEnter` in `rules.ts`) is unchanged and always safe: it's a single,
direct lookup of `world.boards[B.boardRef]` with no recursion, exactly like entering any
other container. Since `B.boardRef === Y`, entering `B` places you back on `Y` — visually
the same room, containing `B` again.

**Exiting** a board (`computeTarget`'s out-of-bounds branch, which climbs upward via
`findContainerFor`) is where the mechanic lives. Walking off board `Y`'s edge finds `Y`'s
owner — `B` — and recurses using `B`'s own current position, in the same direction.
Two things can happen:

- If continuing from `B`'s position, in that direction, lands **in bounds** of `Y`, the
  exit resolves to that cell — i.e., stepping off `Y`'s edge just relocates you to a
  different cell of the same board `Y`. (This is a harmless, slightly strange "wrap"
  effect; it's an accepted side effect of the trick, not something this spec suppresses.)
- If it's **still out of bounds** — because `B` happens to be sitting flush against `Y`'s
  boundary in that same direction — the recursion computes the exact same thing again:
  same board `Y`, same piece `B`, same direction. Nothing about the inputs changed, so
  nothing will ever change no matter how many more times it recurses. This is genuine,
  detectable infinite regress, not a matter of searching harder.

Pushing `B` to any edge of `Y`, then trying to exit `Y` through that specific edge, is
exactly the trigger — which matches the requested behavior directly ("把自包箱推到邊
邊，那一側就變無限大").

`findContainerFor` (`types.ts`) needs **no change**: for a board owned solely by its
self-referencing piece, it already returns that piece — it's the only candidate, exactly
as today's "exactly one owner" code already assumes.

## `computeTarget` / `tryMovePiece` changes (`rules.ts`)

`computeTarget` gets an internal `visited: Set<BoardId>` (a new optional parameter,
defaulted to a fresh `Set()` so every top-level call starts clean) threaded through its
recursive calls. Before climbing out of `loc.board`, check whether `loc.board` is
already in `visited`; if so, the climb has provably returned to a board it already left
once in this same continuous walk — return a new sentinel result instead of recursing
again. Otherwise add `loc.board` to `visited` and recurse as today.

For any level that exists today (no self-references, a strict ownership tree), every
step of a climb visits a board it's never visited before — climbing a tree from a leaf
to the root never revisits a node — so `visited.has(...)` is never true and behavior is
completely unchanged. The check only ever fires once a cycle (this increment's single
self-loop, or a future multi-box one) actually exists in the world being walked.

```ts
export function computeTarget(
  world: World,
  loc: Location,
  dir: Direction,
  relativeCoord: Fraction,
  visited: Set<BoardId> = new Set(),
): { location: Location; relativeCoord: Fraction } | null | 'infinite' {
  const board = world.boards[loc.board]
  const { x, y } = step(loc.x, loc.y, dir)

  if (inBounds(board, x, y)) {
    return { location: { board: loc.board, x, y }, relativeCoord }
  }

  if (visited.has(loc.board)) return 'infinite'
  visited.add(loc.board)

  const containerId = findContainerFor(world, loc.board)
  if (containerId === undefined) return null

  const offset = dir === 'up' || dir === 'down' ? loc.x : loc.y
  const newRelativeCoord = divideByInt(addInt(relativeCoord, offset), board.size)

  const containerLoc = world.locations[containerId]
  return computeTarget(world, containerLoc, dir, newRelativeCoord, visited)
}
```

`tryMovePiece` is the sole caller of `computeTarget`. It gains one new branch: when
`computeTarget` returns `'infinite'`, the piece being moved (`pieceId`) is removed from
the world entirely, using a new small helper:

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
if (target === 'infinite') return removePiece(world, pieceId)
if (target === null) return null
// ...unchanged from here
```

That's the entire change. Nothing else in `rules.ts` needs to know about "infinite" as
a distinct concept, because of how the existing call chain already composes:

- **The player walks into it directly:** `applyMove` calls
  `tryMovePiece(world, PLAYER_ID, dir, ...)` at the top level. If that resolves to
  `'infinite'`, the function returns a world with `PLAYER_ID` removed — a completely
  ordinary, valid `World`, same shape `applyMove` always returns on a successful move.
  `checkLose` (below) reads that as a loss. `GameState.move()` still pushes it onto
  history like any other move, so `undo()` still recovers the pre-loss state.
- **Something else gets pushed into it:** `resolveBlocked` calls
  `tryMovePiece(world, occupantId, dir, ...)` to try pushing whatever is in the way.
  Today, a non-`null` result is treated as "the push succeeded, and `pushed` is the
  resulting world" — `moveTo(pushed, pieceId, target.location)` then places the
  *pusher* at its own target cell on top of that world. Since a "vanished" result is
  just an ordinary `World` missing `occupantId`, this existing code needs **no change**:
  the pusher completes its move normally, and the pushed piece is simply gone from the
  resulting world — exactly the requested "其他箱子被推進去就只是消失" behavior, with
  zero new logic in `resolveBlocked`.
- **The player gets pushed into it** (something else pushes the player out of its way,
  and that resolves to infinite): the same `tryMovePiece(world, PLAYER_ID, ...)` call
  inside `resolveBlocked` returns a world with the player removed, which flows through
  `moveTo(pushed, pieceId, target.location)` unchanged and produces a world with no
  player — `checkLose` still catches it. Being pushed in counts the same as walking in,
  which matches the stated rule ("玩家自己走進無限遷回才算輸") in spirit: it's still the
  player's own position that became unresolvable, regardless of what initiated the move.

## `levelSchema.ts` change

A container piece is **self-referencing** when `locations[piece.id].board ===
piece.boardRef`. The existing ownership-count loop must skip self-referencing pieces
when incrementing each board's owner tally. Without this, a self-loop placed on the
root board would make `ownerCount[root] === 1`, and the "exactly one board with no
owner is the root" check would find zero orphaned boards and reject an otherwise-valid
level. With self-references excluded from the count:

- A self-loop on the root board leaves `ownerCount[root] === 0`, so root is still
  correctly identified as the sole orphan/root.
- A self-loop on a normal non-root board `Y` that also has a real external owner
  (a separate container elsewhere with `boardRef: Y`) leaves `ownerCount[Y] === 1`
  (from the external owner alone) — still valid, unaffected either way.
- A self-loop on a non-root board with **no** external owner leaves `ownerCount[Y]
  === 0`, which correctly surfaces as a second orphan board (found 2, not 1) — such a
  board is genuinely unreachable from outside itself and the existing error is the
  right one, no new error message needed.

No other change to `levelSchema.ts` is needed: the reachability BFS already only
enqueues a board's owner when that board isn't already in `reached`, so a
self-referencing piece (whose `boardRef` always equals a board it's already sitting
on, hence already reached) is naturally a no-op there, exactly like today.

## `worldEdit.ts` changes

**`deletePieceRecursively`** currently assumes deleting a container always means
deleting its board and cascading into everything on that board. For a self-referencing
container this is wrong and dangerous: the board is the one the piece is *also
standing on*, which may include the player. Fix: when the stack-based walk pops a
container piece, only cascade into deleting its board (and recursing into that board's
occupants) when the piece is **not** self-referencing (`locations[pieceId].board !==
piece.boardRef`). A self-referencing container is deleted as a single piece, nothing
more — its board and everything else on it survive untouched.

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
consistent with every other tool in this file. Unlike the previous draft, this tool has
no board restriction: it works on root exactly like anywhere else.

## Testing

- `rules.test.ts`: `computeTarget` returns `'infinite'` when climbing would revisit an
  already-visited board (construct a world with a self-referencing container pushed
  flush against a board edge, and confirm the specific out-of-bounds direction that
  repeats resolves to `'infinite'`, while a perpendicular direction — which doesn't
  repeat — resolves normally). `tryMovePiece` removes the moved piece from the world
  when this happens, for both the player and a non-player piece. An end-to-end
  `applyMove` test: walking into and back out of a self-referencing container through a
  *non-flush* edge behaves like a normal "wrap" (lands elsewhere on the same board, not
  a crash); pushing the self-referencing box flush against an edge and then stepping
  that same direction removes the mover from the world; `checkWin`/`checkLose` behave
  correctly against a world containing a self-reference.
- `types.test.ts`: `removePiece` deletes both the `pieces` and `locations` entry and
  leaves everything else untouched; `findContainerFor` needs no new test since its
  behavior is unchanged (already covered by existing tests).
- `levelSchema.test.ts` (or wherever existing schema tests live): a hand-built world
  with a self-reference on the root board parses successfully and root is still
  correctly identified; a self-reference on a non-root board with a real external owner
  also parses successfully; a self-reference on a non-root board with *no* external
  owner is rejected (found 2 orphan boards).
- `worldEdit.test.ts`: `placeSelfLoopBox` places a piece with `boardRef` equal to its
  own board, including on root; blocked when the cell is occupied by (or transitively
  contains) the player. `deletePieceRecursively` deleting a self-referencing piece
  leaves its board and everything else on that board intact, while deleting a board's
  *external* owner still cascades through a self-referencing piece living inside it, as
  before.
- `EditorScreen.test.tsx`: placing 自包箱 on any board (root included) creates a piece
  whose `boardRef` equals the currently-active board id; it's never rejected there.
- `GameScreen.test.tsx`: with a hand-constructed `initialWorld` that is *already* in a
  lost state (no player location — a shortcut past needing a real in-game trap for this
  component-level test), the lost notice renders and its recovery button calls `undo`.
  A separate, real end-to-end test (in `GameState.test.ts`, alongside the existing
  `isWon` coverage) walks a hand-built self-loop level into the trap via real moves and
  confirms `GameState.isLost` becomes true and `undo()` recovers it.
