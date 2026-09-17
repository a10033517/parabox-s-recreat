# Void (虛空) Mechanic — Design

## Goal

Replace the current "a piece that resolves to infinite recursion is deleted from
the world" behavior with the original game's own answer to the same situation: the
piece is relocated into a shared, engine-synthesized "Void" board, where it becomes
a **locked** piece (visibly marked, pushable as a whole, but never enterable or
mergeable again). This fixes a real design gap found while playing `09-cycle-branch`:
today, a cycle-member container that gets pushed into infinite simply vanishes,
silently turning its former partner into an ordinary (non-cycle) container — there
is no trace, in the world or on screen, of what happened to it. The Void gives every
"went infinite" outcome a permanent, visible, in-world consequence instead of a
silent deletion.

**Scope of this round:**
- Any piece (player, normal box, or container) that resolves to `{kind: 'infinite'}`
  is moved into the Void and marked `locked`, instead of being removed from the
  world.
- A locked piece can still be pushed around as a whole unit, but nothing can ever
  enter it or be merged into it again, and it cannot enter or be merged into
  anything else.
- The player reaching the Void is **not** a loss condition. The player remains
  fully controllable inside the Void. Because the Void's only exits are permanently
  walled off, this is a soft dead end (the level can no longer be won), but the game
  does not tell the player they've "lost" — it simply stops being winnable.
- The pre-existing loss mechanic (`checkLose`, `GameState.isLost`, the lose-notice
  UI, `removePiece`) is retired entirely in this same round, since after this change
  nothing in the engine ever removes the player from `world.locations` again, making
  that whole code path permanently unreachable. Retiring it now avoids shipping dead
  code that asserts a scenario the engine can no longer produce.

**Explicitly out of scope:**
- Any way to escape the Void, or to push a locked piece back into a normal board
  from outside. The design intentionally leaves this unreachable — if a future round
  wants it, it needs its own design pass (an "escape" mechanic is genuinely a new
  puzzle-solving tool, not a bug fix).
- Authoring a Void board by hand in level JSON, or exposing it in the level editor.
  It is purely a runtime construct, synthesized into `World.boards` the first time
  something actually needs it, and it never appears in a level file `parseLevel`
  reads or `serializeLevel` writes (confirmed: no mid-game world state is ever
  persisted through `localStorage` or any other store in this codebase — only
  per-level *completion* flags are, via `src/storage/progress.ts`, which never
  touches a `World` value).
- A capacity larger than the Void's own 9 interior cells. If all 9 fill up, the move
  that would have produced a 10th locked piece fails outright (returns `null`, same
  as any other blocked move) rather than silently dropping a piece or crashing. This
  is expected to never actually happen in any level this codebase ships.

## Design

### The Void board

A single well-known board, id `'void'`, 5×5, walls on every perimeter cell, floor on
the interior 3×3 (9 cells). It is not part of any authored level. It's added to
`world.boards['void']` lazily, the first time a piece actually needs to go there —
every `World` this codebase ever loads or plays starts without it.

```ts
// src/game/engine/types.ts
export const VOID_BOARD_ID: BoardId = 'void'

function makeVoidBoard(): Board {
  const size = 5
  const cells: Cell[][] = Array.from({ length: size }, (_, y) =>
    Array.from({ length: size }, (_, x) => ({
      type: (x === 0 || y === 0 || x === size - 1 || y === size - 1 ? 'wall' : 'floor') as CellType,
    })),
  )
  return { id: VOID_BOARD_ID, size, cells }
}
```

### `Piece.locked`

```ts
// src/game/engine/types.ts
export interface Piece {
  id: PieceId
  kind: PieceKind
  boardRef?: BoardId // present only when kind === 'container'
  locked?: boolean    // present only once a piece has been sent to the Void — see sendToVoid
}
```

Optional, defaults to falsy/absent everywhere else. `parseLevel` needs no change:
it never appears in authored level JSON (only `sendToVoid`, a runtime function,
ever sets it), and the schema doesn't reject unrecognized piece fields today, so
there's nothing to loosen or tighten there.

### `sendToVoid` replaces `removePiece`

`removePiece` (`src/game/engine/types.ts:89-94`) has exactly one call site in the
whole codebase: `rules.ts:105`, `tryMovePiece`'s handling of
`target.kind === 'infinite'`. Delete `removePiece` and replace that call with a new
function:

```ts
// src/game/engine/types.ts

// Fixed search order for a free interior cell in the Void: center first (the
// natural first landing spot), then the remaining 8 interior cells in a fixed,
// deterministic order. Deterministic so tests can predict exactly where any
// given piece lands without needing to special-case "first vs. second piece."
const VOID_CELL_ORDER: Array<{ x: number; y: number }> = [
  { x: 2, y: 2 },
  { x: 1, y: 1 }, { x: 2, y: 1 }, { x: 3, y: 1 },
  { x: 1, y: 2 },                 { x: 3, y: 2 },
  { x: 1, y: 3 }, { x: 2, y: 3 }, { x: 3, y: 3 },
]

// A piece that resolves to infinite recursion is relocated into the shared Void
// board instead of being deleted from the world (see removePiece's old callers —
// this replaces the only one). It's marked `locked`, which resolveBlocked reads to
// keep it pushable but never enterable/mergeable again (see resolveBlocked below).
// Returns null — exactly like any other rejected move — if the Void's 9 interior
// cells are already full; this codebase never ships a level that can reach that in
// practice, but it must degrade safely rather than throw or silently drop a piece.
export function sendToVoid(world: World, pieceId: PieceId): World | null {
  const next = cloneWorld(world)
  if (next.boards[VOID_BOARD_ID] === undefined) {
    next.boards[VOID_BOARD_ID] = makeVoidBoard()
  }
  const cell = VOID_CELL_ORDER.find(
    ({ x, y }) => occupantAt(next, { board: VOID_BOARD_ID, x, y }) === undefined,
  )
  if (cell === undefined) return null
  next.locations[pieceId] = { board: VOID_BOARD_ID, x: cell.x, y: cell.y }
  next.pieces[pieceId] = { ...next.pieces[pieceId], locked: true }
  return next
}
```

```ts
// src/game/engine/rules.ts — tryMovePiece, replacing the removePiece line
if (target.kind === 'infinite') return sendToVoid(world, pieceId)
```

Update the surrounding comment (`rules.ts:97-104`) — it currently describes the
piece being "removed"/"vanish[ing]"; it now needs to describe the piece being
relocated into the Void and locked instead, and that this is no longer how a loss
happens (there is no loss anymore — see below).

### `resolveBlocked`: a locked occupant can only be pushed

```ts
// src/game/engine/rules.ts — resolveBlocked, after the existing push attempt
export function resolveBlocked(
  world: World,
  pieceId: PieceId,
  occupantId: PieceId,
  target: { location: Location; relativeCoord: Fraction },
  dir: Direction,
  inMotion: Map<PieceId, Direction>,
  beingEntered: Set<PieceId>,
): World | null {
  const nextInMotion = new Map(inMotion).set(pieceId, dir)

  const pushed = tryMovePiece(world, occupantId, dir, nextInMotion, new Set())
  if (pushed) return moveTo(pushed, pieceId, target.location)

  // A locked piece (see sendToVoid) can only ever be pushed as a whole unit —
  // nothing may enter it, and it may never be merged ("eaten") into anything
  // else either. Skipping straight to `return null` here, before either tryEnter
  // attempt below, is what makes "only out, never in" hold: the push attempt
  // above is still the one way a locked piece moves at all.
  if (world.pieces[occupantId]?.locked) return null

  const entered = tryEnter(
    world, pieceId, occupantId, dir, target.relativeCoord,
    nextInMotion, beingEntered,
  )
  if (entered) return entered

  const eaten = tryEnter(
    world, occupantId, pieceId, opposite(dir), HALF,
    nextInMotion, new Set(),
  )
  if (eaten) return moveTo(eaten, pieceId, target.location)

  return null
}
```

No change needed to `tryEnter` itself, or to the first `target.kind === 'infinite'`
branch in `tryMovePiece` — a locked piece pushed flush against the Void's own outer
wall just fails to move (blocked by a wall, same as any piece against any wall),
it does not somehow re-enter the infinite-resolution path.

### Losing is retired

After this change, nothing in the engine ever calls anything that deletes the
player from `world.locations` — `sendToVoid` always leaves the piece *with* a
location (inside the Void), it just relocates it. `checkLose(world)` (`rules.ts:194`,
`return world.locations[PLAYER_ID] === undefined`) becomes permanently unreachable:
there is no code path left, anywhere, that can make its condition true. Delete it,
`GameState.isLost` (`GameState.ts:19-21`), and the lose-notice UI in `GameScreen.tsx`
(`state.isLost && (...)`, lines 78-83) rather than leave them as dead code asserting
a scenario the engine can no longer produce.

`GameScreen.tsx`'s `lastBoardIdRef` fallback (lines 26-31, 44-46) exists specifically
to keep rendering working when the player has no location — also now unreachable
(the player's location is always defined). Simplify: read
`state.current.locations[PLAYER_ID].board` directly as `currentBoardId` (it can no
longer be undefined), dropping the ref and the fallback comment. This also means a
player standing in the Void renders exactly like standing on any other board — the
existing `renderBoard`/`currentBoard` plumbing needs no Void-specific handling at
all, it just naturally shows the Void's walls, floor, and the player (and any other
locked pieces) sitting in it.

### Rendering: a locked ring

```ts
// src/game/render/CanvasRenderer.ts
const LOCKED_RING_COLOR = '#facc15' // gold/yellow, distinct from any PIECE_COLORS or CYCLE_PALETTE entry
```

In `renderBoard`'s piece-drawing loop, after the existing `ctx.fillRect(...)` for a
piece, add a ring stroke when that piece is locked:

```ts
  for (const [pieceId, location] of Object.entries(world.locations)) {
    if (location.board !== board.id) continue
    const piece = world.pieces[pieceId]
    ctx.fillStyle = isCycleMember(pieceId, world) ? cycleColorFor(pieceId) : PIECE_COLORS[piece.kind]
    ctx.fillRect(location.x * cellSize, location.y * cellSize, cellSize, cellSize)
    if (piece.locked) {
      ctx.strokeStyle = LOCKED_RING_COLOR
      ctx.lineWidth = Math.max(2, cellSize / 8)
      const inset = ctx.lineWidth / 2
      ctx.strokeRect(
        location.x * cellSize + inset,
        location.y * cellSize + inset,
        cellSize - inset * 2,
        cellSize - inset * 2,
      )
    }
  }
```

Independent visual layer from cycle-member coloring — a piece can in principle be
both (a container that was mid-ring when it got pushed into a *different* infinite
resolution keeps its own `boardRef`/interior untouched, so it's still structurally a
cycle member even while sitting locked in the Void). Both draw; there's no conflict.

### Existing 06–09 demo levels

Unaffected functionally. Every one of them relies on a box vanishing to free the
cell it stood on so the player can stand there and win — that's still true (the box
moves to the Void, so its old cell is empty either way). `checkWin` never counts
pieces or checks `world.pieces` size, only what currently occupies each requirement
cell, so nothing about the win condition changes. The only visible difference:
the vanished box is now visible, locked, sitting in the Void, instead of having no
trace at all.

## Testing

- `types.test.ts`:
  - Delete the `describe('removePiece', ...)` block (the function itself is gone).
  - New `describe('sendToVoid', ...)`:
    - Synthesizes the Void board on first use (a `World` with no `'void'` board
      yet; after calling, `next.boards.void` exists, is 5×5, walls on the
      perimeter, floor inside).
    - Reuses the existing Void board on a second call (doesn't recreate/reset it —
      construct a `World` that already has a `'void'` board with one locked piece
      in it, call `sendToVoid` for a second piece, confirm both pieces' locations
      survive and the board object's cell contents are unchanged).
    - Places the first piece sent to the Void at the center cell (2, 2), and marks
      it `locked: true`.
    - Places a second, different piece at the next cell in `VOID_CELL_ORDER` when
      the center is already occupied.
    - Returns `null` (not a throw) when all 9 interior cells are already occupied
      (construct a `World` with 9 pre-placed locked pieces filling the Void, then
      call `sendToVoid` for a 10th).
- `rules.test.ts`:
  - Rewrite `'removes a self-loop box pushed flush against the board it owns,
    letting the pusher complete its move'` (currently asserts
    `next?.locations.loopBox` / `next?.pieces.loopBox` are `undefined`) to instead
    assert `loopBox` is now in the Void (`{ board: 'void', x: 2, y: 2 }`) with
    `next?.pieces.loopBox?.locked` `true`, and the pusher still completes its own
    move as before.
  - Rewrite `'resolveBlocked removes the player when pushing it resolves to
    infinite, treating it the same as any other piece'` the same way: player ends
    up in the Void, locked, rather than removed — rename it to drop "removes" from
    the description (e.g. `'resolveBlocked sends the player to the Void when
    pushing it resolves to infinite, treating it the same as any other piece'`).
  - Delete `describe('tryMovePiece — piece already removed from the world', ...)`
    entirely — it exercises a `World` shape (`removePiece(world, PLAYER_ID)`
    producing a player with no location) that no longer exists anywhere in this
    codebase once `removePiece` is deleted, and the import would no longer resolve.
  - Delete `describe('checkLose', ...)` — the function is gone.
  - New coverage for the `resolveBlocked` locked-occupant guard: a locked piece
    blocking a push, where the pusher can't push it further (wall behind it) —
    confirm the move fails outright (`null`), instead of falling through to enter/
    eaten resolution (build a small fixture: a locked piece adjacent to a wall, a
    pusher pushing into it).
  - New coverage: a piece that is NOT locked, standing where a locked piece could
    also plausibly stand (i.e. a regular container), still enters/gets entered
    normally — proving the guard is specific to `locked`, not a general "any
    container occupant" restriction.
- `GameState.test.ts`: replace `'reports isLost after a move resolves into infinite
  regress, and undo recovers it'` — delete it (the `isLost` getter no longer
  exists). If useful, add a lighter replacement confirming `GameState` doesn't
  throw and continues to accept moves after a piece (including the player) has been
  sent to the Void — but this is largely already covered by `rules.test.ts`'s
  own `sendToVoid`/`resolveBlocked` coverage, so only add it if `GameState`-level
  behavior (history/undo specifically) needs its own proof.
- `GameScreen.test.tsx`:
  - Delete `'a move that removes the player shows a lost notice, and its button
    recovers via undo'` and `'pressing a direction after losing does not crash, and
    the lost notice stays up'`.
  - New test: pushing the player into a self-loop (reusing the same `loopBox`
    fixture these two deleted tests used) does NOT show `lose-notice` (it no longer
    exists at all — assert `screen.queryByTestId('lose-notice')` is null), the
    canvas keeps rendering without throwing, and the player can still move
    afterward (e.g. click a direction button, confirm no crash and `onExit`/other
    handlers remain wired — mirroring the spirit of the deleted "does not crash"
    test, but for continued play instead of a stuck lose screen).
- `CanvasRenderer.test.ts`: a locked piece renders with the gold ring stroke
  (assert `ctx.strokeStyle` was set to `LOCKED_RING_COLOR` and `strokeRect` was
  called for that piece's cell); a non-locked piece of the same kind does not get
  a ring. A piece that is both a cycle member and locked gets both the cycle fill
  color and the ring (protects against the two code paths becoming
  mutually-exclusive by accident later).

## Acceptance criteria

- A piece (any kind) that resolves to infinite recursion is relocated into a
  shared, engine-synthesized Void board (`'void'`, 5×5, walled perimeter) instead
  of being deleted, and is marked `locked`.
- A locked piece can still be pushed as a single unit, but nothing can enter it or
  merge into it, and it cannot enter or merge into anything else.
- The Void's 9 interior cells fill in a fixed, deterministic order; a 10th
  simultaneous occupant fails the move cleanly (`null`) rather than crashing or
  silently dropping a piece.
- The player reaching the Void is not a loss: `checkLose`/`GameState.isLost`/the
  lose-notice UI/`removePiece` are deleted, not just made unreachable — the player
  remains fully controllable inside the Void afterward.
- Every existing 06–09 demo level still wins exactly as before.
- Locked pieces render with a visually distinct gold ring, independent of (and
  compatible with) cycle-member coloring.
