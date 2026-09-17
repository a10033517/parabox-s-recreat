# Void Infinite Destination — Design

## Review summary

This revision replaces an earlier draft of the same feature after external review
found two real problems, both fixed here and re-verified against a standalone
reimplementation of the algorithm (not just reasoned about):

1. **Naming/semantics**: the earlier draft called the synthesized Void piece an
   "anchor" and modeled it as an incidental visual marker. It's better modeled as an
   explicit **infinite destination** — a `Piece.infiniteFor` field naming the real
   container it represents — because this also naturally covers a second case the
   earlier draft never handled: an infinite destination that's already present
   elsewhere (hand-authored in level JSON, or the real owner piece having separately
   ended up in the Void through its own earlier infinite event) must be **preferred**
   over synthesizing a new one, never duplicated.
2. **Adjacency**: the earlier draft placed the ejected piece at "the next free cell in
   the existing search order," which is not always actually *adjacent* to the
   destination (e.g. the search order's second entry is diagonal from its first). This
   revision uses a real 4-neighbor adjacency search for where the ejected piece lands,
   separate from the search used to place the destination itself.

**One thing NOT carried over from the external review that supplied these two fixes**:
that review also assumed `Piece.locked` is a stored boolean flag, and worried a
generated destination might be created without it set. That assumption is stale — this
codebase already derives "locked" from physical Void residency (`isInVoid`, added in
an earlier round), not a stored flag. `Piece.locked` doesn't exist in this codebase.
Nothing below reintroduces it: any piece placed on `VOID_BOARD_ID` — destination or
ejected piece alike — is automatically `isInVoid`, and every push-only/no-enter/ring
rule already keyed off that continues to apply with zero additional code. Re-verified
this is still true by re-reading `resolveBlocked`'s current guard, unchanged since an
earlier round, before writing this sentence.

Also **not** adopted from that review: making the real owner's mere Void presence
insufficient to serve as a destination, requiring an explicit `infiniteFor` marker on
it too. The user confirmed directly, across two separate rounds of this design's
clarification, that once the real owner is independently in the Void, later arrivals
through the same cycle should use it directly with no separate placeholder — this is
preserved as `findInfiniteDestination`'s first check, verified below against exactly
that scenario.

## Goal

When a piece resolves to infinite recursion through a genuine containment cycle, the
Void should represent *why* — not just relocate the piece as an inert locked box
indistinguishable from any other Void resident (which is what the currently-shipped
mechanic does for every case). Concretely: the engine identifies which container owns
the board the cycle actually broke on, and represents an "infinite copy" of that
container as a permanent, reusable, non-enterable **infinite destination** in the
Void. The piece that triggered this exits adjacent to that destination, as if pushed
out from inside it.

## Ground-truth example (verified against a standalone reimplementation of the
algorithm below, matching the real `computeTarget`'s traced behavior from an earlier
round — not just reasoned about)

```
boards: root (4x4), redInterior (4x4)
pieces:
  redPiece:    container, boardRef: redInterior, at root (3,1)      — flush right edge
  yellowPiece: container, boardRef: root,        at redInterior (3,1) — flush right edge

Push redPiece right.
```

The containment climb (traced against the real `computeTarget` in an earlier round):
`root` → (via `yellowPiece`) → `redInterior` → (via `redPiece`) → `root` again — the
repeat is on `root`, whose owner is `yellowPiece`.

Confirmed result, reproduced by the standalone reimplementation:
- A new destination `void-infinite:yellowPiece` is created at the Void's first free
  cell (the center, `(2,2)`, on a fresh Void), `infiniteFor: 'yellowPiece'`.
- `redPiece` lands at `(2,1)` — genuinely adjacent (directly above) the destination,
  not merely "the next slot in some list."
- The real `yellowPiece` does not move; still at `redInterior (3,1)`.
- A second, different piece pushed through the *same* cycle (same owner) reuses the
  *same* destination and lands in the next free adjacent cell (`(3,2)`, since `(2,1)`
  is now taken) — confirmed, not just asserted.
- If the real `yellowPiece` is later independently found already in the Void (e.g. it
  went through its own separate infinite event), a further arrival for that same owner
  uses the *real* `yellowPiece` directly as the destination — confirmed by
  constructing exactly that world state and checking the next arrival lands adjacent
  to the real piece's Void location, not a new placeholder.

## Scope of this round

- `computeTarget`'s `{kind: 'infinite'}` result now carries both the repeated board
  and that board's owning piece id (`ownerId`) — resolved once, at the point of
  detection, rather than forcing every caller to re-derive it.
- `sendToVoid` becomes destination-aware: it first checks whether a valid destination
  for `ownerId` already exists (the real owner if it's already `isInVoid`, or an
  existing piece with `infiniteFor === ownerId`) and reuses it; only synthesizes a new
  one when neither exists.
- A synthesized destination is `kind: 'normal'` (never enterable — `tryEnter` already
  requires `kind === 'container'`), `infiniteFor: ownerId`, and is placed via the Void
  board's normal 25-cell placement search (unchanged from the currently-shipped
  mechanic — no artificial capacity carve-out for destinations specifically).
- The piece that triggered the infinite result lands in a cell genuinely adjacent (one
  of the 4 cardinal neighbors, bounds-checked) to whatever destination it resolved to
  — not merely the next free cell in the board-wide placement search.
- Hand-authored levels *may* place a piece with `infiniteFor` set, and it will be
  found and reused exactly like a synthesized one — this falls out of
  `findInfiniteDestination` reading the field generically, with no special-casing
  needed between "authored" and "synthesized." No dedicated editor tooling or
  `parseLevel` validation for this field is added this round (mirrors this project's
  existing precedent: multi-node cycle levels are hand-authored JSON only, with no
  editor support, until a later round adds it).
- Rendering: a destination is colored using the real owner's identity (its cycle color
  if the owner is a cycle member, else its plain kind color), gets the existing locked
  ring (automatic — it's `isInVoid` like anything else in the Void), and additionally
  renders a small "∞" marker distinguishing it from an ordinary locked piece that
  merely happens to be sitting in the Void.

**Explicitly out of scope:**
- Infinite *Enter* / epsilon-paradox behavior (entering a box positioned to
  recursively contain its own entrance). This design is Infinite *Exit* only — the
  case this whole feature has been built and verified around throughout.
- Directional fidelity beyond "genuinely adjacent, deterministic 4-neighbor search."
  No information about which side the piece was pushed from survives into this
  resolution step, and nothing in this design's confirmation rounds asked for that
  precision.
- `parseLevel` validation or editor authoring support for hand-placed `infiniteFor`
  pieces (see above — supported at the data-model level, not built out further this
  round).
- Reserving the `void-infinite:` piece-id prefix against authored collisions, for the
  same reasons `void-anchor:` wasn't reserved in the design this replaces: a real but
  low-probability risk, smaller in scope than this round justifies fixing.

## Design

### 1. `computeTarget` returns the repeated board's owner directly

```ts
// src/game/engine/rules.ts
export type MoveTarget =
  | { kind: 'location'; location: Location; relativeCoord: Fraction }
  | { kind: 'infinite'; board: BoardId; ownerId: PieceId }
  | null // blocked: no owner to climb through (e.g. the true root boundary)
```

```ts
  if (visited.has(loc.board)) {
    // loc.board can only be in `visited` because an earlier step in this same climb
    // already called findContainerFor(world, loc.board) successfully (that's the only
    // way the climb reaches a board at all) — so this can never be undefined here.
    const ownerId = findContainerFor(world, loc.board) as PieceId
    return { kind: 'infinite', board: loc.board, ownerId }
  }
  visited.add(loc.board)
```

(Everything else about the climb — the `inBounds` check that must run before this, the
recursive call shape — is unchanged.)

### 2. `Piece.infiniteFor` marks a destination

```ts
// src/game/engine/types.ts
export interface Piece {
  id: PieceId
  kind: PieceKind
  boardRef?: BoardId   // present only when kind === 'container'
  infiniteFor?: PieceId // present only on an infinite destination — see sendToVoid
}
```

A piece with `infiniteFor !== undefined` is a destination representing the named real
piece. `kind` stays `'normal'` — the marker is what makes it special, not a new
`PieceKind` (introducing one would ripple into every `kind`-keyed switch —
`PIECE_COLORS`, `isCycleMember`'s `kind !== 'container'` check, `tryEnter`'s
`kind !== 'container'` check — for no behavioral gain, since "never enterable" already
falls out of `kind: 'normal'` for free).

### 3. Resolving (or creating) a destination

```ts
// src/game/engine/types.ts

function infiniteDestinationIdFor(ownerId: PieceId): PieceId {
  return `void-infinite:${ownerId}`
}

// A valid destination for ownerId is either the real ownerId piece itself, if it's
// already sitting in the Void (confirmed with the user: once the real piece is there,
// later arrivals through the same cycle use it directly, no separate placeholder), or
// any piece — synthesized by sendToVoid below, or hand-authored in a level — whose
// infiniteFor names ownerId.
function findInfiniteDestination(world: World, ownerId: PieceId): PieceId | undefined {
  if (isInVoid(world, ownerId)) return ownerId
  for (const [pieceId, piece] of Object.entries(world.pieces)) {
    if (piece.infiniteFor === ownerId && world.locations[pieceId] !== undefined) return pieceId
  }
  return undefined
}

const VOID_EXIT_OFFSETS: Array<{ dx: number; dy: number }> = [
  { dx: 0, dy: -1 }, { dx: 1, dy: 0 }, { dx: 0, dy: 1 }, { dx: -1, dy: 0 },
]

// A genuinely adjacent free cell to a destination, bounds-checked against the Void's
// own 5x5 extent — unlike reusing the board-wide placement search (VOID_CELL_ORDER),
// whose later entries are not necessarily adjacent to its earlier ones.
function findVoidExitCell(world: World, destination: { x: number; y: number }): { x: number; y: number } | undefined {
  for (const { dx, dy } of VOID_EXIT_OFFSETS) {
    const x = destination.x + dx
    const y = destination.y + dy
    if (x < 0 || y < 0 || x >= 5 || y >= 5) continue
    if (occupantAt(world, { board: VOID_BOARD_ID, x, y }) === undefined) return { x, y }
  }
  return undefined
}
```

### 4. `sendToVoid` becomes destination-aware

```ts
// src/game/engine/types.ts

// A piece that resolves to infinite recursion is relocated into the shared Void
// board, adjacent to the "infinite destination" representing whichever container
// owns the board the cycle actually broke on (ownerId — see computeTarget). If a
// valid destination for ownerId already exists (see findInfiniteDestination), it's
// reused; otherwise one is synthesized at the board-wide placement search's next
// free cell. Rejects (returns null, no mutation) an unknown pieceId, a piece already
// in the Void, a full Void (no cell for a new destination), or a destination with no
// free adjacent cell to exit into.
export function sendToVoid(world: World, pieceId: PieceId, ownerId: PieceId): World | null {
  if (world.pieces[pieceId] === undefined || isInVoid(world, pieceId)) return null

  const next = cloneWorld(world)
  if (next.boards[VOID_BOARD_ID] === undefined) {
    next.boards[VOID_BOARD_ID] = makeVoidBoard()
  }

  const existingDestinationId = findInfiniteDestination(next, ownerId)
  let destinationLoc: Location
  if (existingDestinationId !== undefined) {
    destinationLoc = next.locations[existingDestinationId]
  } else {
    const destinationCell = VOID_CELL_ORDER.find(
      ({ x, y }) => occupantAt(next, { board: VOID_BOARD_ID, x, y }) === undefined,
    )
    if (destinationCell === undefined) return null
    const destinationId = infiniteDestinationIdFor(ownerId)
    next.pieces[destinationId] = { id: destinationId, kind: 'normal', infiniteFor: ownerId }
    next.locations[destinationId] = { board: VOID_BOARD_ID, x: destinationCell.x, y: destinationCell.y }
    destinationLoc = next.locations[destinationId]
  }

  const exitCell = findVoidExitCell(next, destinationLoc)
  if (exitCell === undefined) return null

  next.locations[pieceId] = { board: VOID_BOARD_ID, x: exitCell.x, y: exitCell.y }
  return next
}
```

Atomicity is unchanged from the currently-shipped mechanic: every write happens on
`next` (the clone); every failure path returns before `next` is ever assigned back to
the caller, so the original `world` is never observably touched.

### 5. `tryMovePiece` passes `ownerId` through

```ts
// src/game/engine/rules.ts
if (target.kind === 'infinite') return sendToVoid(world, pieceId, target.ownerId)
```

### 6. `resolveBlocked` is unchanged

The currently-shipped two-sided `isInVoid(world, pieceId) || isInVoid(world, occupantId)`
guard already correctly makes any Void resident — destination or ordinary ejected piece
alike — push-only and never enterable/mergeable, on both sides of a blocked
interaction. Nothing about destinations needs a new rule here: a destination is just
another piece whose `location.board === VOID_BOARD_ID`.

### 7. Rendering: destination color plus an infinity marker

```ts
// src/game/render/CanvasRenderer.ts
const INFINITY_MARKER_COLOR = '#0f172a' // dark, readable against LOCKED_RING_COLOR's pale fill
```

```ts
  for (const [pieceId, location] of Object.entries(world.locations)) {
    if (location.board !== board.id) continue
    const piece = world.pieces[pieceId]
    // A destination (piece.infiniteFor set) has no cycle membership or kind of its
    // own worth rendering — it's colored as whichever real piece it represents.
    const colorSourceId = piece.infiniteFor ?? pieceId
    const colorSource = piece.infiniteFor !== undefined ? world.pieces[piece.infiniteFor] : piece
    ctx.fillStyle = isCycleMember(colorSourceId, world) ? cycleColorFor(colorSourceId) : PIECE_COLORS[colorSource.kind]
    ctx.fillRect(location.x * cellSize, location.y * cellSize, cellSize, cellSize)
    if (board.id === VOID_BOARD_ID) {
      ctx.save()
      ctx.strokeStyle = LOCKED_RING_COLOR
      ctx.lineWidth = Math.max(2, cellSize / 8)
      const inset = ctx.lineWidth / 2
      ctx.strokeRect(
        location.x * cellSize + inset, location.y * cellSize + inset,
        cellSize - inset * 2, cellSize - inset * 2,
      )
      if (piece.infiniteFor !== undefined) {
        ctx.fillStyle = INFINITY_MARKER_COLOR
        ctx.font = `${Math.floor(cellSize / 2)}px sans-serif`
        ctx.textAlign = 'center'
        ctx.textBaseline = 'middle'
        ctx.fillText('∞', location.x * cellSize + cellSize / 2, location.y * cellSize + cellSize / 2)
      }
      ctx.restore()
    }
  }
```

## Testing

- `rules.test.ts` (`computeTarget`): every existing `infinite`-result assertion gains a
  `board` and `ownerId` check. Add a case (reusing the `branchBoard`-hangs-off-a-cycle
  shape from an earlier round) where the repeated board is *not* the moved piece's own
  starting board, confirming `ownerId` still resolves to the correct (distant) owner.
- `types.test.ts` (`sendToVoid`/`findInfiniteDestination`): every existing call site
  gains an `ownerId` argument; re-derive every expected landing cell (a destination now
  occupies a cell before the ejected piece does, in every scenario — this mechanic has
  no more "goes infinite with no owner" case, since `computeTarget` only returns
  `infinite` via a genuine cycle, which always has an owner). New coverage:
  - First arrival for an owner with no existing destination: creates one at the Void's
    first free cell, `infiniteFor` set correctly, ejected piece lands in a genuinely
    adjacent free cell (assert the exact 4-neighbor relationship, not just "some cell
    in the Void").
  - Second arrival for the *same* owner: reuses the same destination id and location
    exactly (no second destination created).
  - A *different* owner gets its own, separate destination.
  - If the real owner piece is already `isInVoid` (construct this directly), a further
    arrival for that owner uses the real piece's own location as the destination — no
    synthesized destination created at all.
  - A hand-placed piece with `infiniteFor` already set (simulating an authored
    destination) is found and reused by `findInfiniteDestination` exactly like a
    synthesized one.
  - If a destination's own 4 neighbors are all occupied, the whole move fails (`null`),
    original world untouched.
  - Full-Void capacity (no free cell for a brand-new destination) still fails cleanly.
- `CanvasRenderer.test.ts`: a destination renders with the real owner's color (cycle
  color when applicable) and the "∞" marker; an ordinary (non-destination) locked Void
  piece gets the ring but *not* the marker.
- `src/levels/index.test.ts` / `10-void-storage.json`: re-verify the known win sequence
  still wins — `box1`/`box2` are both pushed off edges of `root`, owned by the
  self-loop `loopA`; the first push now also creates a `void-infinite:loopA`
  destination, the second reuses it, and both boxes land adjacent to it rather than at
  their previously-expected coordinates — the win condition itself is unaffected
  either way, since it never depended on Void internals.

## Acceptance criteria

- Infinite-exit detection identifies both the repeated board and the piece that owns
  it, in the same `computeTarget` result — no separate lookup needed downstream.
- An existing infinite destination for that owner (the real owner already in the Void,
  or any piece with a matching `infiniteFor`) is used in preference to synthesizing a
  new one; a new one is synthesized only when neither exists.
- A synthesized destination is placed via the Void's normal 25-cell placement search,
  is never enterable, and is reused by every later arrival for the same owner.
- The piece that triggered the infinite result lands in a cell genuinely adjacent (one
  of 4 cardinal neighbors, bounds-checked) to whatever destination it resolved to.
- The real owner piece never moves as a side effect of another piece in its cycle
  going to the Void.
- Void-residency-derived rules (`isInVoid`, the two-sided push-only guard, the locked
  ring) apply to destinations automatically, with zero destination-specific code
  needed for any of the three.
- A destination renders distinctly from an ordinary locked Void piece (owner's color +
  ring + "∞" marker, vs. just the piece's own color + ring).
- Capacity/adjacency failures are atomic: `null` with the original `World` completely
  unchanged.
- Existing 06–10 demo levels still win exactly as before.

## Reference

This design's overall shape — an "infinite box" endpoint that a recursive exit resolves
to, preferentially reusing one that already exists rather than always creating a new
one in null/void space — is modeled after community-documented descriptions of Patrick's
Parabox's own Infinite Exit behavior, not a claim to reproduce its exact implementation.
The data model and algorithm above are this codebase's own implementation decisions,
verified against this codebase's own engine (`computeTarget`'s traced recursion, and a
standalone reimplementation of the algorithm checked against three concrete scenarios),
not against the original game's source.
