# Flip — Design

## Revision note

The first draft of this spec modeled flip as a one-shot side effect of the existing
infinite-exit mechanic: pushing something into a self-loop augmented with a
`flipsEntry` marker toggled a `mirroredEntry` flag onto the piece that went to the
Void. The user supplied external research citing Patrick's Parabox's own custom-level
format, which gives both `Block` and `Ref` entries a persistent `fliph` property,
independent of any infinite-exit interaction — flip is a standing property of a box,
not something conferred by passing through a different mechanic.

That correction is adopted here: `flipsEntry`/`mirroredEntry` are gone, replaced by a
single persistent `fliph?: boolean` field any container (or clone — see the Clone
spec) can carry. The *effect* confirmed in the original round — pushed right, entry
computed as if pushed left; up/down untouched — is unchanged and still the
confirmed ground truth for the entry side.

**One part of the supplied research is adopted with my own reasoning, not by copying
it directly**: that flip should also affect the *exit* side (climbing back out of a
flipped box), not just entry. The research's own code for this was fragmentary
(illustrative snippets, no worked example), so rather than transcribing it, I derived
and sanity-checked the exit-side rule myself against this engine's actual
`computeTarget`, below — this is flagged explicitly since it wasn't confirmed against
a concrete example the way the entry-side rule was in the original round.

## Ground truth

### Entry side (confirmed in the original round)

```
Entering a container with fliph: true, pushing right, computes the SAME entry cell
as pushing left into an otherwise-identical non-flipped container would. Pushing
left computes the same cell as pushing right would. Up/down are unaffected.
```

### Exit side (my own derivation, verified against this engine's actual `computeTarget`
— not confirmed by the user, flagged as such)

Baseline, run against the real engine: a container `X` (`boardRef: 'Xinterior'`,
2×2) stands on `root` at `(1,1)`. Something inside `Xinterior` at `(1,0)` (the
rightmost column) pushes right and exits — **without** any flip, this lands at
`root (2,1)`: the climb continues in the same direction (`right`) from `X`'s own
location.

Reasoning for the flipped case: if `X`'s interior is genuinely mirrored left-right,
then reaching what's *physically* `X`'s right wall from inside is, from an outside
(unmirrored) point of view, equivalent to reaching `X`'s *true* left wall — so the
climb should continue as if the exit direction were `left`, not `right`, from `X`'s
own location (landing at `root (0,1)` instead of `root (2,1)`). Sanity-checked against
the *entry* rule for consistency: entering `X` (fliph) by pushing right already lands
you at the mirrored entry cell (`x = size-1`, the physically-rightmost column, per the
confirmed entry rule) — so for a box only as deep as its own size, continuing to push
right immediately reaches the exit, and getting kicked out the *opposite* (`left`)
side is the same "walked through a mirror" shape the entry rule already establishes.
This is offered as sound reasoning, not an independently confirmed example — worth a
second look before shipping if anything about it feels wrong once it's actually
playable.

## Scope of this round

- Any container piece (real `Block` or `Ref`/clone) can carry `fliph: boolean`, a
  persistent authored property — not toggled by any other mechanic, not conferred by
  passing through the Void.
- `tryEnter`'s entry-cell computation for a `fliph` container uses the
  left-right-mirrored direction (confirmed rule, unchanged from the original round).
- `computeTarget`'s climb, when exiting a `fliph` container's board, continues using
  the left-right-mirrored direction (my own derivation, flagged above).
- A clone (`cloneOf` set) can independently carry its own `fliph`, separate from
  whatever `fliph` its main body has (the Clone spec covers this; noted here since
  it's the same field).

**Explicitly out of scope:**
- Rendering. This spec asserts flip should eventually be visually consistent (box
  contents drawn mirrored to match the logical mapping), but no renderer change is
  specified this round — same status as every other mechanic's rendering this
  session, deferred to a follow-up once the logic is confirmed working.
- Vertical flip (`flipv` or similar). Not asked for.
- Any interaction with Container Link/Transfer (separate spec) or with the Void's
  infinite-exit mechanic beyond "these are independent — a piece can go through both
  a flip and an infinite exit in the course of a level, neither one triggers the
  other."

## Design

### `Piece.fliph`

```ts
// src/game/engine/types.ts
export interface Piece {
  id: PieceId
  kind: PieceKind
  boardRef?: BoardId
  infiniteFor?: PieceId
  cloneOf?: PieceId
  linkedTo?: PieceId  // see the Container Link / Transfer spec
  fliph?: boolean      // persistent horizontal-flip property — see below
}
```

(`flipsEntry` and `mirroredEntry` from the first draft are removed — not renamed,
removed. Nothing in this round reads or writes them.)

### The mirror helper

```ts
// src/game/engine/rules.ts
function mirrorHorizontal(dir: Direction): Direction {
  if (dir === 'left') return 'right'
  if (dir === 'right') return 'left'
  return dir
}
```

### Entry side: `tryEnter`

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
  const entryDir = into.fliph ? mirrorHorizontal(dir) : dir
  const { cell, newRelativeCoord } = getEntryCell(board, entryDir, relativeCoord)
  // ...rest unchanged: wall check on `cell`, resolveBlocked call using the ORIGINAL
  // `dir` (not entryDir) for everything after the entry cell is computed...
}
```

### Exit side: `computeTarget`

```ts
// src/game/engine/rules.ts — computeTarget, the climb-out step
  const containerId = findContainerFor(world, loc.board)
  if (containerId === undefined) return null
  const container = world.pieces[containerId]

  // Container Link / Transfer check goes here too, if that spec's design is also
  // adopted this round — see that spec for how the two compose. Flip's own change:
  const climbDir = container.fliph ? mirrorHorizontal(dir) : dir

  const offset = climbDir === 'up' || climbDir === 'down' ? loc.x : loc.y
  const newRelativeCoord = divideByInt(addInt(relativeCoord, offset), board.size)
  const containerLoc = world.locations[containerId]
  return computeTarget(world, containerLoc, climbDir, newRelativeCoord, visited)
```

Only `climbDir` changes from the current `dir`-everywhere shape; `offset`'s axis
selection (`up`/`down` vs. otherwise) is unaffected either way since
`mirrorHorizontal` never turns a horizontal direction into a vertical one — the only
thing that actually differs when `container.fliph` is true is that the *continued*
climb (and thus `newRelativeCoord`'s use of `climbDir`, and the recursive call's own
`dir` argument) proceeds in the mirrored direction instead.

### `parseLevel`

No change needed — `fliph` is a plain optional boolean, no new validation required.

## Testing

- `tryEnter` (`rules.test.ts`): entering a `fliph: true` container while pushing
  right computes the same entry cell as pushing left into an otherwise-identical
  non-flipped container; pushing left mirrors to right; up/down unaffected. Control
  case: a non-`fliph` container's entry is completely unchanged.
- `computeTarget` (`rules.test.ts`): reproduce the derived exit example above —
  exiting a `fliph: true` container continues the climb in the mirrored direction
  (verify against the concrete `root`/`Xinterior` example: without `fliph`, exiting
  right from `Xinterior (1,0)` lands `root (2,1)`; with `fliph: true` on `X`, the
  same exit lands `root (0,1)`). Control case: a non-`fliph` container's exit
  continuation is unaffected — every existing `computeTarget` test must still pass.
- A container can be `fliph: true` without being a self-loop, a clone, or linked —
  prove flip is independent of every other mechanic (a plain ordinary container with
  `fliph` set behaves exactly as described, nothing else about it changes).

## Acceptance criteria

- `fliph` is a persistent, author-set (or engine-set for a synthesized piece, if a
  future mechanic ever needs that) boolean property on a container — not toggled by
  the infinite-exit mechanic or any other side effect.
- Entering a `fliph` container mirrors the horizontal component of the push direction
  used to compute the entry cell; up/down entries are unaffected.
- Exiting a `fliph` container's board mirrors the horizontal component of the
  direction used to continue the climb outward; up/down exits are unaffected.
- A clone can carry its own `fliph`, independent of its main body's.
- No new `PieceKind`, no change to `parseLevel` validation.
