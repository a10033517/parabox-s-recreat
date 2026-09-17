# Flip Box — Design

## Goal

A self-loop with a "flip" modifier applied to it marks anything that goes infinite
through it (and ends up in the Void, per the existing mechanic) as **mirrored**: from
then on, anyone trying to enter that piece's own interior gets a left-right-swapped
entry — pushed right, they enter as if they'd pushed left, and vice versa (up/down are
unaffected).

Worked out with the user via a concrete example, verified before writing this down.

## Implementation choice: a field on the self-loop, not a second stacked piece

The user described this as a separate "flip box" piece `F` **stacked on top of** a
self-loop `L` — two pieces sharing one cell. This codebase has no existing concept of
two pieces occupying the same cell (`occupantAt` returns at most one match;
`parseLevel` explicitly rejects two pieces sharing a location), and introducing one
just for this feature would be a much larger, riskier change than the confirmed
gameplay effect actually requires.

The confirmed effect is entirely about **what happens to a piece that passes through
a flip-augmented self-loop** — nothing about `F` needs to exist as an independently
movable, independently rendered piece for that effect to hold. So this design
represents "a self-loop with a flip modifier" as a single piece with an extra boolean
field, not two pieces. If a future round needs `F` to be its own manipulable object
(picked up, moved independently of `L`), that's a larger follow-up, not this one.

## Ground-truth example (confirmed)

```
root board, C = some other container, pushed into a self-loop L that has the flip
modifier set.
```

- Without the flip modifier: `C` goes to the Void through the existing infinite-exit
  mechanic (`resolveInfiniteExit`), exactly as any piece pushed into a self-loop
  already does — unaffected by this feature.
- With the flip modifier: **the same thing happens** — `C` still goes to the Void,
  still locked, still renders in the Void like anything else there. The *only*
  difference: `C` is additionally marked mirrored. `C`'s own position, ownership, and
  everything else about how it got to the Void is completely unchanged.
- Later, when anyone (player or another piece) tries to enter `C`'s own interior
  (wherever `C` is by then — the Void doesn't block a locked piece from later being
  pushed elsewhere by a push chain), the entry direction used to compute *which cell
  of `C`'s board* they land on is left-right swapped. Pushing right computes the entry
  cell as if pushing left; pushing left computes it as if pushing right. Up and down
  are untouched.

**Toggle, not a one-shot flag.** Passing through a flip-augmented self-loop a second
time inverts the mark back off (mirroring twice is the identity). This wasn't asked
about directly but is the mathematically obvious behavior for "mirrored" and costs
nothing extra to implement as a toggle instead of a one-way set — flagged here as a
judgment call, not confirmed by name, low risk either way since no example exercises
passing through twice.

## Scope of this round

- A container piece can carry a `flipsEntry` marker, meaningful specifically when
  that piece is also a self-loop (`boardRef === ` the board it stands on) — the
  Void-bound infinite-exit path is the only trigger this round.
- A piece that goes infinite through a self-loop carrying `flipsEntry` gets its own
  `mirroredEntry` flag toggled as part of that same relocation.
- `tryEnter`'s entry-cell computation for a piece with `mirroredEntry` set uses the
  left-right-swapped direction, and only there — nothing else about how that piece
  is pushed, rendered, or resolved elsewhere changes.

**Explicitly out of scope:**
- Flip as an independently placeable/movable piece (see "Implementation choice"
  above).
- Any interaction with the Container Link mechanic (separate spec, same round) —
  the two are independent features; whether they compose in some interesting way is
  unexplored and not asked about.
- Rendering: no visual marker specified for a `mirroredEntry` piece this round (same
  status as the clone box spec — can follow the `∞`-marker precedent later).

## Design

### `Piece.flipsEntry` / `Piece.mirroredEntry`

```ts
// src/game/engine/types.ts
export interface Piece {
  id: PieceId
  kind: PieceKind
  boardRef?: BoardId
  infiniteFor?: PieceId
  cloneOf?: PieceId
  flipsEntry?: boolean    // present on a self-loop augmented with the flip modifier
  mirroredEntry?: boolean // present (and toggled) on a piece that has passed through one
}
```

### Toggling on infinite-exit

```ts
// src/game/engine/types.ts — inside ensureInfiniteDestination's caller, or
// resolveInfiniteExit in rules.ts (wherever the piece's own record is written when
// it lands in the Void)
const owner = world.pieces[ownerId]
if (owner?.flipsEntry) {
  next.pieces[pieceId] = { ...next.pieces[pieceId], mirroredEntry: !next.pieces[pieceId].mirroredEntry }
}
```

This needs to run in `resolveInfiniteExit` (rules.ts), which already has `ownerId`
(the piece the infinite climb resolved to — the self-loop `L` itself, when `L` is a
literal self-loop) available, and already produces the final `World` with `pieceId`
relocated. The exact insertion point: right before returning the successful
`moveTo(...)` result, mutate `pieceId`'s own record on that same `next`/`pushed`
world rather than issuing a second `moveTo`-style clone.

### Mirrored entry direction

```ts
// src/game/engine/rules.ts
function mirrorLeftRight(dir: Direction): Direction {
  if (dir === 'left') return 'right'
  if (dir === 'right') return 'left'
  return dir
}
```

```ts
// src/game/engine/rules.ts — tryEnter, only the getEntryCell call site changes
export function tryEnter(
  world: World,
  pieceId: PieceId,
  intoId: PieceId,
  dir: Direction,
  relativeCoord: Fraction,
  inMotion: Map<PieceId, Direction>,
  beingEntered: Set<PieceId>,
): World | null {
  if (beingEntered.has(intoId)) return null

  const into: Piece = world.pieces[intoId]
  if (into.cloneOf !== undefined) {
    return resolveCloneTeleport(world, pieceId, into.cloneOf, dir, inMotion)
  }
  if (into.kind !== 'container') return null

  const board = world.boards[into.boardRef as string]
  const entryDir = into.mirroredEntry ? mirrorLeftRight(dir) : dir
  const { cell, newRelativeCoord } = getEntryCell(board, entryDir, relativeCoord)
  // ...rest unchanged (wall check, resolveBlocked call, using the ORIGINAL dir for
  // everything after entry-cell computation, not entryDir)...
}
```

Only the `getEntryCell` call uses the mirrored direction. Everything else in
`tryEnter` after that point (the wall check on the computed cell, the subsequent
`resolveBlocked` call for the pusher's own continued resolution) keeps using the
original `dir` — mirroring is purely about *which cell of the target's own board* is
computed as the entry point, not about anything happening outside that board.

## Testing

- `types.test.ts` / `rules.test.ts` (`resolveInfiniteExit`): a piece pushed into a
  self-loop with `flipsEntry: true` ends up in the Void with `mirroredEntry: true`; a
  second pass through the same flip-augmented self-loop toggles it back to falsy.
  A piece pushed into an ordinary (non-flipping) self-loop never gets `mirroredEntry`
  set, proving this doesn't apply universally.
- `tryEnter` (`rules.test.ts`): entering a piece with `mirroredEntry: true` while
  pushing right computes the SAME entry cell as pushing left into an otherwise
  identical non-mirrored piece would, and vice versa; pushing up/down into a mirrored
  piece is unaffected (matches the non-mirrored case exactly).
- Control case: entering an ordinary (non-mirrored) container's entry-cell
  computation is completely unchanged — all existing `getEntryCell`/`tryEnter` tests
  must still pass unmodified.

## Acceptance criteria

- A self-loop container can carry a `flipsEntry` marker.
- A piece that goes infinite through such a self-loop has its own `mirroredEntry`
  flag toggled as part of landing in the Void; its physical relocation, locking, and
  Void-residency are otherwise completely unchanged from the existing mechanic.
- Entering a piece with `mirroredEntry` set computes its entry cell using the
  left-right-swapped push direction; up/down entries and everything about the pusher's
  own subsequent resolution are unaffected.
- Passing through a flip-augmented self-loop twice restores the original (non-mirrored)
  state.
- No new piece kind, no two-pieces-one-cell change to the data model.
