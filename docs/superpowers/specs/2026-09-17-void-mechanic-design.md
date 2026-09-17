# Void (虛空) Mechanic — Design

## Goal

Replace the current "a piece that resolves to infinite recursion is deleted from
the world" behavior with a runtime Void modeled after Patrick's Parabox's own
handling of infinite/paradox situations: the piece is relocated into a shared,
engine-synthesized "Void" board, where it becomes a **locked** piece (visibly
marked, pushable as a whole, but never enterable or mergeable again).

This fixes a real design gap found while playing `09-cycle-branch`: today, a
cycle-member container that gets pushed into infinite simply vanishes, silently
turning its former partner into an ordinary (non-cycle) container — there is no
trace, in the world or on screen, of what happened to it. The Void gives every
"went infinite" outcome a permanent, visible, in-world consequence instead of a
silent deletion.

This implementation deliberately generalizes the behavior to all piece kinds and
uses its own 5×5 runtime board — it is modeled after the original game's Void /
infinite-paradox behavior, not a claim to reproduce every detail of it.

**Scope of this round:**
- Any piece (player, normal box, or container) that resolves to `{kind: 'infinite'}`
  is moved into the Void and marked `locked`, instead of being removed from the
  world.
- A locked piece can still be pushed around as a whole unit, including as part of
  a normal push chain.
- A locked piece can never be entered, merged into, or eaten into — and, symmetrically,
  a locked *moving* piece can never enter or merge into another piece once its own
  push attempt fails. The lock applies on both sides of a blocked interaction (see
  "Locked interaction rule" below — this is the one place the first draft of this
  spec under-specified the rule, caught in review).
- The player reaching the Void is **not** a loss condition. The player remains
  fully controllable inside the Void, subject to normal movement rules. Because the
  Void's only exits are permanently walled off, reaching it makes the level
  unsolvable unless the player uses the existing undo/history mechanism to rewind
  past that move — undo is not itself disabled or special-cased by any of this.
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
  reads or `serializeLevel` writes. Verified directly against this codebase (not
  assumed): no mid-game world state is ever persisted through `localStorage` or any
  other store — `src/storage/progress.ts` only ever persists per-level *completion*
  flags, never a `World` value (`grep`-confirmed: no `World`/`parseLevel`/
  `serializeLevel` reference anywhere in that file). If a generic world serializer
  is ever added later, it must explicitly reject or omit the runtime-only Void
  rather than accidentally treating it as authorable level data — noted here as a
  constraint on future work, not something this round needs to build.
- A capacity larger than the Void's own 9 interior cells. If all 9 fill up, the move
  that would have produced a 10th locked piece fails outright — `sendToVoid` returns
  `null`, exactly like any other blocked move, and the original `World` is left
  completely unchanged (see "Infinite resolution and full-Void failure" below). This
  is expected to never actually happen in any level this codebase ships.

## Invariants

These are engine rules `sendToVoid`/`resolveBlocked` must uphold, not merely
renderer conventions:

1. `piece.locked === true` implies the piece is located on `VOID_BOARD_ID`.
2. A locked piece can move only by landing on an empty destination or by
   successfully pushing another piece out of its way — never by falling back to
   enter/eat resolution.
3. A locked *occupant* blocking a push can be pushed, but if that push fails it may
   not be entered or eaten.
4. A locked piece can never be merged into or entered by any other piece, and can
   never itself enter or merge into another piece.
5. A piece is sent to the Void at most once: `sendToVoid` on an already-locked
   piece is rejected (`null`), not moved to a second Void cell.
6. `VOID_BOARD_ID` (`'void'`) is reserved and cannot be authored as a level board id.
7. A failed `sendToVoid` is atomic: it returns `null` and the caller's original
   `World` is unchanged.
8. The Void board is shared by every piece in one `World` — one Void per world, not
   one per source board or per piece.
9. Undo restores the state immediately before a Void-sending move exactly as it
   restores any other move — no special-casing needed, since `GameState.undo()`
   just pops `history`, and a Void-sending move is a completely ordinary
   non-null result pushed onto that same history.

## Design

### The Void board

A single well-known board, id `'void'`, 5×5, walls on every perimeter cell, floor on
the interior 3×3 (9 cells). It is not part of any authored level. It's added to
`world.boards['void']` lazily, the first time a piece actually needs to go there —
every `World` this codebase ever loads or plays starts without it.

The id is reserved: `parseLevel` must reject an authored board whose id is
`VOID_BOARD_ID`, so a hand-authored board can never collide with the
runtime-synthesized one.

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

```ts
// src/game/engine/levelSchema.ts — inside the existing per-board validation loop
// (the one that already checks board.id !== boardId), add:
if (boardId === VOID_BOARD_ID) {
  throw new Error(`Board id "${VOID_BOARD_ID}" is reserved for the runtime Void and cannot be authored`)
}
```

### `Piece.locked`

```ts
// src/game/engine/types.ts
export interface Piece {
  id: PieceId
  kind: PieceKind
  boardRef?: BoardId // present only when kind === 'container'
  locked?: boolean    // runtime-only; true only after sendToVoid — see below
}
```

Optional, so authored level JSON needs no new required field — the *engine*
establishes "a locked piece is in the Void," not the authoring format.
`parseLevel` needs no change to accept or reject `locked`: it never appears in
authored level JSON (only `sendToVoid`, a runtime function, ever sets it), the
schema doesn't reject unrecognized piece fields today, and an authored
`locked: true` simply isn't a supported level feature — there's nothing to
loosen or tighten in the parser for this field specifically (unlike the board id,
which does need the explicit reserved-id rejection above, since a colliding board
id would actually corrupt runtime behavior).

### `sendToVoid` replaces `removePiece`

`removePiece` (`src/game/engine/types.ts:89-94`) has exactly one call site in the
whole codebase: `rules.ts:105`, `tryMovePiece`'s handling of
`target.kind === 'infinite'`. Delete `removePiece` and replace that call with a new
function that validates its input before touching anything:

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
// board instead of being deleted from the world (see removePiece's old caller —
// this replaces the only one). It's marked `locked`, which resolveBlocked reads to
// keep it pushable but never enterable/mergeable again (see resolveBlocked below).
// Rejects (returns null, no mutation) an unknown pieceId, an already-locked piece
// (invariant 5: a piece is only ever sent to the Void once), or a full Void
// (invariant 7: atomic failure) — the caller always gets back either the original
// world untouched, or a new world with exactly one piece relocated and locked.
export function sendToVoid(world: World, pieceId: PieceId): World | null {
  const piece = world.pieces[pieceId]
  if (piece === undefined || piece.locked) return null

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

`cloneWorld` (`structuredClone(world)`) is a deep clone, so it already preserves
`locked` (and every other piece field) with no change needed there — verified by
reading its implementation, not assumed.

### Locked interaction rule: push only, never enter/eat, on both sides

**This is the one place the first draft of this spec under-specified the rule,
caught in review, and the correction matters.** The original draft only guarded
the *occupant* being locked — that stops an ordinary piece from entering a locked
piece, but it does **not** stop a **locked moving piece** from falling through to
`tryEnter`/eaten resolution when its own push attempt fails, meaning a locked piece
could still end up merged into something else. The rule must guard **both sides**:
after the push attempt, if *either* the moving piece (`pieceId`) or the occupant
(`occupantId`) is locked, no enter/eat fallback is allowed — only:

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

  // The normal push path is the only legal way a locked piece — on either side —
  // may participate in a blocked move.
  const pushed = tryMovePiece(world, occupantId, dir, nextInMotion, new Set())
  if (pushed) return moveTo(pushed, pieceId, target.location)

  // No push was possible. If either side of this interaction is locked, it may
  // never be entered, eaten, or itself enter/eat the other — skip straight to
  // failure instead of trying either tryEnter direction below.
  if (world.pieces[pieceId]?.locked || world.pieces[occupantId]?.locked) return null

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

The guard's position matters: it must come *after* the push attempt (otherwise a
locked piece could never move at all) and *before* both `tryEnter` calls
(otherwise either direction could still violate the lock).

`tryEnter` itself needs no change. Verified directly (not assumed): `resolveBlocked`
is the *only* production call site of `tryEnter` in this codebase — grepped the
whole `src/` tree, the only other reference is a direct unit test of `tryEnter`
itself, not a gameplay path. So enforcing the lock at `resolveBlocked`'s single
choke point is sufficient; there is no other caller that could bypass it.

### Infinite resolution and full-Void failure

A full Void is a rejected move — not a new paradox state, not a loss state.
`sendToVoid` returns `null` in that case; because it clones into `next` and only
assigns into `next` (never mutates the caller's `world` in place), returning `null`
instead of `next` means the original `World` is retained completely unchanged by
the caller. The source piece is never partially relocated, marked locked, or
otherwise altered when the Void turns out to be full.

### Losing is retired; undo is not

After this change, nothing in the engine ever calls anything that deletes the
player from `world.locations` — `sendToVoid` always leaves the piece *with* a
location (inside the Void), it just relocates it. `checkLose(world)` (`rules.ts:194`,
`return world.locations[PLAYER_ID] === undefined`) becomes permanently unreachable:
there is no code path left, anywhere, that can make its condition true. Delete it,
`removePiece`, `GameState.isLost` (`GameState.ts:19-21`), and the lose-notice UI in
`GameScreen.tsx` (`state.isLost && (...)`, lines 78-83) rather than leave them as
dead code asserting a scenario the engine can no longer produce.

Entering the Void is therefore not represented as `isLost` at all — it's simply a
normal move whose resulting world has the player on the runtime Void board.
`GameState`'s move history / undo mechanism needs **no changes**: `undo()` just
pops `history`, and a Void-sending move is an entirely ordinary non-null result
pushed onto that same history like any other move — undo restores the
immediately-preceding state exactly as it always has.

`GameScreen.tsx`'s `lastBoardIdRef` fallback (lines 26-31, 44-46) exists
specifically to keep rendering working when the player has no location — also now
unreachable (the player's location is always defined). Simplify:

```ts
const currentBoardId = state.current.locations[PLAYER_ID].board
```

dropping the ref and its now-stale comment. This also means a player standing in
the Void renders exactly like standing on any other board — the existing
`renderBoard`/`currentBoard` plumbing needs no Void-specific handling at all, it
just naturally shows the Void's walls, floor, and the player (and any other locked
pieces) sitting in it. Verified directly: nothing else in `GameScreen.tsx` (camera,
input handlers, win-check `useEffect`) assumes `PLAYER_ID` lives on any particular
board id — they all read `state.current`/`state.isWon` generically.

### Rendering: a locked ring

```ts
// src/game/render/CanvasRenderer.ts
const LOCKED_RING_COLOR = '#facc15' // gold/yellow, distinct from any PIECE_COLORS or CYCLE_PALETTE entry
```

In `renderBoard`'s piece-drawing loop, after the existing `ctx.fillRect(...)` for a
piece, add a ring stroke when that piece is locked, saving/restoring context state
so the stroke settings don't leak into whatever draws next:

```ts
  for (const [pieceId, location] of Object.entries(world.locations)) {
    if (location.board !== board.id) continue
    const piece = world.pieces[pieceId]
    ctx.fillStyle = isCycleMember(pieceId, world) ? cycleColorFor(pieceId) : PIECE_COLORS[piece.kind]
    ctx.fillRect(location.x * cellSize, location.y * cellSize, cellSize, cellSize)
    if (piece.locked) {
      ctx.save()
      ctx.strokeStyle = LOCKED_RING_COLOR
      ctx.lineWidth = Math.max(2, cellSize / 8)
      const inset = ctx.lineWidth / 2
      ctx.strokeRect(
        location.x * cellSize + inset,
        location.y * cellSize + inset,
        cellSize - inset * 2,
        cellSize - inset * 2,
      )
      ctx.restore()
    }
  }
```

Independent visual layer from cycle-member coloring — a piece can in principle be
both (a container that was mid-ring when it got pushed into a *different* infinite
resolution keeps its own `boardRef`/interior untouched, so it's still structurally
a cycle member even while sitting locked in the Void — verified: `isCycleMember`
only reads `piece.boardRef` and walks `findContainerFor`/`world.locations`, never
looks at `piece.locked` or cares what board the piece itself is standing on). Both
draw; there's no conflict.

### Existing 06–09 demo levels

Unaffected functionally. Every one of them relies on a box vanishing to free the
cell it stood on so the player can stand there and win — that's still true (the box
moves to the Void, so its old cell is empty either way). `checkWin` never counts
pieces or checks `world.pieces` size, only what currently occupies each requirement
cell, so nothing about the win condition changes. The only visible difference:
the vanished box is now visible, locked, sitting in the Void, instead of having no
trace at all. Also unaffected: level-completion persistence (`src/storage/progress.ts`)
only ever records completion of the normal win path — nothing about a Void-sending
move touches it.

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
    - Rejects an unknown `pieceId` with `null` (no mutation).
    - Rejects an already-locked piece with `null` and does not move it (invariant 5).
    - Returns `null` (not a throw) when all 9 interior cells are already occupied
      (construct a `World` with 9 pre-placed locked pieces filling the Void, then
      call `sendToVoid` for a 10th) — and confirm the *original* world argument is
      completely unchanged afterward (invariant 7: no source location or `locked`
      flag was touched).
    - The generated Void board is shared by multiple different pieces sent to it
      from the same `World` (invariant 8).
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
  - New lock-interaction coverage in `resolveBlocked`, both directions (this is
    exactly what the review round caught was missing from the first draft):
    1. **Unlocked pusher → locked occupant, push succeeds:** an unlocked piece can
       push a locked piece when the destination beyond it is free.
    2. **Unlocked pusher → locked occupant, push fails:** if the locked occupant
       can't be pushed (wall or another obstacle behind it), the move returns
       `null` — it does not fall through to entering/eating the locked occupant.
    3. **Locked mover → unlocked occupant, push succeeds:** a locked piece
       (already sitting in the Void, mid another push chain) can push an unlocked
       piece when the push succeeds.
    4. **Locked mover → unlocked occupant, push fails:** if that push fails, the
       locked moving piece must not fall through to `tryEnter`/eaten resolution
       either — the move returns `null`.
    5. **Locked → locked:** a successful push chain between two locked pieces is
       still allowed; a failed push between them returns `null`, no enter/eat
       fallback on either side.
    6. **Control case:** two *unlocked* pieces in the same Void-shaped coordinate
       fixture still resolve via ordinary enter/eat behavior — proving the new
       guard triggers on `locked`, not on being physically located on the Void
       board or at any particular coordinate.
  - A full-Void regression test reachable through `tryMovePiece`/`resolveBlocked`:
    when `sendToVoid` returns `null` because the Void is already full, the
    original source piece and its pusher both remain exactly where they were
    (the overall move fails cleanly, matching invariant 7 at the `rules.ts` level,
    not just inside `sendToVoid` itself).
- `GameState.test.ts`:
  - Delete `'reports isLost after a move resolves into infinite regress, and undo
    recovers it'` — the `isLost` getter no longer exists.
  - New: a move that sends the player to the Void can be undone, restoring the
    exact pre-move state (player's prior board/location, `world.boards` without
    the synthesized `'void'` board reappearing — since `undo()` just pops history,
    this should hold for free, but it's exactly the kind of thing worth pinning
    down with a real assertion rather than trusting it by inference).
  - New: issuing another move while already in the Void doesn't throw and
    continues normal history bookkeeping (`moveCount` increments, etc.).
- `GameScreen.test.tsx`:
  - Delete `'a move that removes the player shows a lost notice, and its button
    recovers via undo'` and `'pressing a direction after losing does not crash, and
    the lost notice stays up'`.
  - New test: pushing the player into a self-loop (reusing the same `loopBox`
    fixture these two deleted tests used) does NOT show `lose-notice` (it no longer
    exists at all — assert `screen.queryByTestId('lose-notice')` is null), the
    canvas keeps rendering without throwing, the player's current board is now
    `'void'`, the player can still accept direction input afterward without
    crashing, and `onExit`/other existing screen handlers remain unaffected.
- `CanvasRenderer.test.ts`: a locked piece renders with the gold ring stroke
  (assert `ctx.strokeStyle` was set to `LOCKED_RING_COLOR` and `strokeRect` was
  called for that piece's cell); a non-locked piece of the same kind does not get
  a ring. A piece that is both a cycle member and locked gets both the cycle fill
  color and the ring (protects against the two code paths becoming
  mutually-exclusive by accident later). Confirm `save()`/`restore()` mean the
  stroke style set for a locked piece doesn't leak into a subsequently-drawn
  unlocked piece's fill (e.g. draw a locked piece then an unlocked one, confirm the
  unlocked one's fill isn't polluted by leftover stroke state).
- `levelSchema.test.ts`: a new test asserting an authored board with id `'void'`
  is rejected by `parseLevel` (invariant 6) — proving the reserved id can't
  collide with runtime synthesis.

## Acceptance criteria

- A piece (any kind) that resolves to infinite recursion is relocated into a
  shared, engine-synthesized Void board (`'void'`, 5×5, walled perimeter) instead
  of being deleted, and is marked `locked`.
- A locked piece can still be pushed as a single unit, including as part of a push
  chain.
- A locked occupant cannot be entered or eaten into when a push fails, **and**
  symmetrically a locked moving piece cannot enter or merge into another piece
  when its own push attempt fails — the lock is enforced on both sides of a
  blocked interaction.
- The Void's 9 interior cells fill in a fixed, deterministic order; a 10th
  simultaneous occupant fails the move cleanly (`null`) without mutating the
  original world, rather than crashing or silently dropping a piece.
- The Void board id (`'void'`) is reserved: an authored level using that id as a
  board is rejected by `parseLevel`.
- The player reaching the Void is not a loss: `checkLose`/`GameState.isLost`/the
  lose-notice UI/`removePiece` are deleted, not just made unreachable — the player
  remains fully controllable inside the Void afterward.
- Undo restores the state immediately before a Void-sending move exactly as it
  restores any other move.
- Every existing 06–09 demo level still wins exactly as before.
- Locked pieces render with a visually distinct gold ring, independent of (and
  compatible with) cycle-member coloring, and the renderer doesn't leak
  locked-piece stroke state into subsequently-drawn pieces.
