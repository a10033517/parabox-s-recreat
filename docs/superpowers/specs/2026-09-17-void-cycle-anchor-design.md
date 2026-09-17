# Void Cycle Anchor — Design

## Goal

When a piece that's part of a genuine containment **cycle** gets pushed to infinity, the
Void should visibly represent *why* it's infinite — not just relocate the piece as an
inert locked box (which is what the currently-shipped Void mechanic does for every
case, cyclic or not). Concretely: pushing a cycle-participant into the Void generates
a permanent, reusable **anchor** in the Void — a non-enterable, themed placeholder
representing "an infinite copy of whichever container owns the board the cycle actually
broke on" — and the pushed piece lands next to it, as if pushed out from inside it.

This was worked out over several rounds of back-and-forth with concrete examples,
because prose descriptions of a recursive mechanic kept talking past each other; every
claim below was independently verified against the real engine (via `computeTarget`,
not assumed) before being written down here.

**Worked example, verified against the real engine (this is the ground truth the whole
design below is built to reproduce exactly):**

```
boards: root (4x4), redInterior (4x4)
pieces:
  redPiece:    container, boardRef: redInterior, at root (3,1)      — flush right edge
  yellowPiece: container, boardRef: root,        at redInterior (3,1) — flush right edge
  player: at root (2,1)

Push redPiece right (e.g. via a pusher, or by resolveBlocked pushing it as an occupant).
```

Confirmed by hand-tracing `computeTarget`'s actual recursion (not assumed): the climb
visits `root` (redPiece's own board) → exits via `yellowPiece` → visits `redInterior`
→ exits via `redPiece` (redPiece's own boardRef) → visits `root` **again** — `root` is
the board `computeTarget` detects as revisited, which is what makes this infinite.

Confirmed step by step with the user, across several corrections to earlier drafts of
this same example:
1. `root`'s owner (`yellowPiece`) is **not itself already in the Void**.
2. So: create a new **anchor** piece at the Void's first free cell (the center, on a
   fresh Void). It has no `boardRef` (so it can never actually be entered — see
   `tryEnter`'s existing `into.kind !== 'container'` check, which this satisfies by
   giving the anchor `kind: 'normal'`), and it's themed with `yellowPiece`'s render
   color (reusing `cycleColorFor`/`isCycleMember`, since `yellowPiece` itself hasn't
   moved and is still structurally a cycle member).
3. `redPiece` lands in the Void **next to this anchor** (the next free cell in the
   existing `VOID_CELL_ORDER` search) — not at the anchor's own cell.
4. The real `yellowPiece` does **not** move. It's still at `redInterior (3,1)`,
   completely unaffected.
5. If something else later goes infinite via the **same** cycle (same trigger board,
   same owner), it reuses this same anchor rather than creating a second one.
6. If the real `yellowPiece` itself is *later* independently pushed into the Void, it
   becomes usable as the anchor directly — no separate anchor is created once the real
   piece is already there.

**The critical, independently-verified nuance that makes this non-trivial:** the board
that triggers `{kind: 'infinite'}` is **not necessarily the pushed piece's own starting
board** — it's whichever board `computeTarget`'s climb visits a *second* time. Verified
with a deliberately constructed counter-example (`branchBoard` owned by `branchPiece`
sitting on `root`, `root`↔`redInterior` a genuine cycle): a piece starting on
`branchBoard`, pushed flush, climbs `branchBoard → root → redInterior → root` — the
repeat happens on `root`, three hops away from where the piece actually started. The
anchor must be keyed off `root`'s owner in this case, not off `branchBoard`'s owner —
using the piece's own starting board would silently pick the wrong anchor (or, worse,
one with no relation to the actual cycle at all) whenever the pushed piece isn't itself
sitting directly on the cyclic board.

## Scope of this round

- `computeTarget`'s `{kind: 'infinite'}` result now carries the triggering board id.
- `sendToVoid` takes that triggering board, resolves (or reuses, or creates) the
  correct anchor, and places the pushed piece next to it.
- A new optional `Piece.anchorFor` field marks a synthesized anchor and names the real
  piece it represents, for rendering.
- `CanvasRenderer` colors an anchor using the piece it represents (`anchorFor`), not
  its own (nonexistent) cycle membership.
- Anchors are void-resident pieces like any other: `isInVoid` (unchanged), the existing
  push-only guard in `resolveBlocked` (unchanged), and the locked ring (unchanged) all
  already apply to them automatically, with zero special-casing — they're just a piece
  whose `location.board === VOID_BOARD_ID`, exactly like anything else sent there.
- Every existing Void-mechanic test that exercises the infinite path through
  `applyMove`/`tryMovePiece` (rather than calling `sendToVoid` directly) needs its
  expected landing cells re-derived, since an anchor now occupies a cell before the
  pushed piece does in every case that involves a real cycle (which is every existing
  test — the mechanic that was shipped has no "goes infinite via a non-cyclic path"
  case, because `computeTarget` only ever returns `infinite` via a genuine board
  revisit, which is definitionally a cycle).

**Explicitly out of scope:**
- Directional placement of the ejected piece relative to the anchor (i.e., "pushed out
  the same side it went in"). No such rule was ever specified with enough precision to
  implement; the ejected piece lands at the next free cell in the existing
  `VOID_CELL_ORDER` search, same as an anchor-less arrival would, which naturally
  clusters it near the anchor without claiming any particular direction.
- Reserving the `void-anchor:` piece-id prefix at `parseLevel` the way `VOID_BOARD_ID`
  is reserved for board ids. An authored level using a piece id shaped like
  `void-anchor:something` could theoretically collide with a synthesized anchor's id
  later at runtime. This mirrors a real, deliberate choice already made for board ids
  in the original Void spec, but doing the same for piece ids here is a larger
  parser change than this round's scope justifies — flagged as a known, low-probability
  risk for a future round, not fixed now.
- What happens if the *anchor's own cell* becomes the target of some other push (e.g.
  pushing a piece into the anchor). The anchor is `isInVoid`, so the existing guard
  already makes it push-only/non-enterable like anything else in the Void — no new
  behavior needed, but no bespoke test targets this interaction specifically beyond
  what the existing "two locked pieces" coverage already proves generically.

## Design

### `computeTarget` exposes the triggering board

```ts
// src/game/engine/rules.ts
export type MoveTarget =
  | { kind: 'location'; location: Location; relativeCoord: Fraction }
  | { kind: 'infinite'; board: BoardId }
  | null // blocked: no owner to climb through (e.g. the true root boundary)
```

```ts
  if (visited.has(loc.board)) return { kind: 'infinite', board: loc.board }
```

(The only change inside `computeTarget` itself — everything else about the climb is
unchanged.)

### `sendToVoid` resolves an anchor before placing the piece

```ts
// src/game/engine/types.ts
export interface Piece {
  id: PieceId
  kind: PieceKind
  boardRef?: BoardId  // present only when kind === 'container'
  anchorFor?: PieceId // present only on a synthesized Void anchor — see sendToVoid
}
```

```ts
function anchorIdFor(realPieceId: PieceId): PieceId {
  return `void-anchor:${realPieceId}`
}

// A piece that resolves to infinite recursion is relocated into the shared Void
// board. If the infinite regress came from a genuine containment cycle — which it
// always does, since computeTarget only ever returns 'infinite' via a real board
// revisit — the piece is placed next to an "anchor": a permanent, reusable Void
// resident representing the container that owns the board the cycle broke on
// (triggerBoard). The anchor is the REAL owning piece if it's already in the Void,
// otherwise a synthesized placeholder (created once, reused by every later arrival
// through the same cycle) themed with that owner's render identity but never itself
// enterable (kind: 'normal', no boardRef).
export function sendToVoid(world: World, pieceId: PieceId, triggerBoard: BoardId): World | null {
  if (world.pieces[pieceId] === undefined || isInVoid(world, pieceId)) return null

  const next = cloneWorld(world)
  if (next.boards[VOID_BOARD_ID] === undefined) {
    next.boards[VOID_BOARD_ID] = makeVoidBoard()
  }

  const owner = findContainerFor(next, triggerBoard)
  if (owner !== undefined && !isInVoid(next, owner)) {
    const anchorId = anchorIdFor(owner)
    if (next.pieces[anchorId] === undefined) {
      const anchorCell = VOID_CELL_ORDER.find(
        ({ x, y }) => occupantAt(next, { board: VOID_BOARD_ID, x, y }) === undefined,
      )
      if (anchorCell === undefined) return null
      next.pieces[anchorId] = { id: anchorId, kind: 'normal', anchorFor: owner }
      next.locations[anchorId] = { board: VOID_BOARD_ID, x: anchorCell.x, y: anchorCell.y }
    }
  }

  const cell = VOID_CELL_ORDER.find(
    ({ x, y }) => occupantAt(next, { board: VOID_BOARD_ID, x, y }) === undefined,
  )
  if (cell === undefined) return null

  next.locations[pieceId] = { board: VOID_BOARD_ID, x: cell.x, y: cell.y }
  return next
}
```

Notes on this shape, since several things about it are easy to get subtly wrong:

- `owner` is resolved from `next` (the clone), not `world`, so if `pieceId` itself
  happens to be `owner` (impossible in practice — see below — but worth being
  deliberate about) the check stays internally consistent.
- `owner` can never legitimately be `undefined` here in practice: `sendToVoid` is only
  ever called with a `triggerBoard` that `computeTarget` just proved has an owner (the
  climb only continues past a board when `findContainerFor` succeeds for it — an
  `undefined` owner makes `computeTarget` return `null`, not `infinite`, so
  `sendToVoid` is never reached that way). The `owner !== undefined` check exists only
  as a defensive guard for callers other than `tryMovePiece`'s single call site (e.g.
  a future direct unit test), not because this path is reachable through normal play.
- The anchor-cell search and the final piece-cell search are two separate calls to the
  same `VOID_CELL_ORDER.find` — deliberately, not merged into one loop — because the
  anchor (if newly created) must actually occupy a cell (checked via `occupantAt`)
  before the second search runs, or the piece could be placed on top of it.
- If the owner is **already in the Void**, no anchor entry is created or looked up at
  all — `pieceId` just lands at the next free cell, the same as before this feature
  existed. This is what makes point 6 of the worked example correct for free: once the
  real piece is in the Void, it needs no proxy.

### `tryMovePiece` passes the triggering board through

```ts
// src/game/engine/rules.ts
if (target.kind === 'infinite') return sendToVoid(world, pieceId, target.board)
```

### Rendering: an anchor is colored as the piece it represents

```ts
// src/game/render/CanvasRenderer.ts
for (const [pieceId, location] of Object.entries(world.locations)) {
  if (location.board !== board.id) continue
  const piece = world.pieces[pieceId]
  // An anchor (piece.anchorFor set) has no cycle membership or kind of its own worth
  // rendering — it's colored as whichever real piece it represents instead.
  const colorSource = piece.anchorFor !== undefined ? world.pieces[piece.anchorFor] : piece
  const colorSourceId = piece.anchorFor ?? pieceId
  ctx.fillStyle = isCycleMember(colorSourceId, world) ? cycleColorFor(colorSourceId) : PIECE_COLORS[colorSource.kind]
  ctx.fillRect(location.x * cellSize, location.y * cellSize, cellSize, cellSize)
  if (board.id === VOID_BOARD_ID) {
    // ...unchanged ring-drawing block...
  }
}
```

`isCycleMember(colorSourceId, world)` reading the REAL owner's id (not the anchor's
own synthesized id) works correctly with zero changes to `isCycleMember` itself: the
real owner (e.g. `yellowPiece`) hasn't moved, so its own cycle-membership walk is
completely unaffected by the anchor's existence elsewhere in the Void.

## Testing

- `rules.test.ts` (`computeTarget`): update every existing assertion checking
  `result.kind === 'infinite'` to also check `result.board` matches the board actually
  expected to trigger the repeat — including at least one case (mirroring the
  `branchBoard` counter-example above) where the triggering board is **not** the
  moved piece's own starting board, to pin down the nuance this whole design turns on.
- `types.test.ts` (`sendToVoid`): every existing test's call site gains a
  `triggerBoard` argument; re-derive expected landing cells for each (an anchor now
  consumes the first free cell in every scenario that goes through a real cycle,
  shifting the previously-expected piece cell by one slot). New tests:
  - First arrival through a cycle creates an anchor themed on the correct owner, and
    the arriving piece lands in the very next free cell after it.
  - A second, different piece arriving through the **same** cycle reuses the existing
    anchor (same id, same location) rather than creating a second one.
  - A piece arriving through a **different** cycle (different trigger board, different
    owner) creates its own, separate anchor.
  - If the owner is already in the Void (arrange this via two sequential
    `sendToVoid` calls), no anchor is created at all — the arriving piece just takes
    the next free cell.
  - Full-Void capacity tests account for the anchor also consuming a cell.
- `CanvasRenderer.test.ts`: an anchor piece (`anchorFor` set) renders using the real
  owner's color (cycle color if the owner is a cycle member, else the owner's plain
  kind color) — not `PIECE_COLORS['normal']` (which its own `kind` would otherwise
  imply) and not any color derived from the anchor's own (nonexistent) `boardRef`.
- `src/levels/index.test.ts` / demo levels: `10-void-storage.json` (both `box1` and
  `box2` are pushed off edges of `root`, owned by the self-loop `loopA`) now also
  produces a `void-anchor:loopA` entry the first time either box arrives — re-verify
  this level's known win sequence still wins (it does; the anchor doesn't occupy any
  cell the win path depends on), and its exact final Void layout now additionally
  contains one themed anchor piece alongside the two boxes.

## Acceptance criteria

- Pushing a piece into infinity via a genuine cycle creates (or reuses) a themed,
  non-enterable anchor in the Void representing the board-owning container the cycle
  actually broke on — determined by the board `computeTarget` detects as revisited,
  not necessarily the pushed piece's own starting board.
- The anchor is created once per distinct owner and reused by every later arrival
  through the same cycle.
- If the real owner piece is itself already in the Void, it's used directly with no
  separate anchor.
- The real owner's own token never moves as a side effect of another piece in its
  cycle going to the Void.
- An anchor renders using the real owner's color identity (cycle color when
  applicable), and — like every Void resident — is push-only, non-enterable, and
  rendered with the locked ring, with no anchor-specific code needed for any of those
  three (they fall out of the existing `isInVoid`-based rules for free).
- Existing 06–10 demo levels still win exactly as before.
