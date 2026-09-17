# Parabox General Containment Cycles (Sub-project 6.1)

## Background

Sub-project 6 (shipped) added a single self-referencing "loop" box: a container whose
interior is the very board it's standing on. It was built and reviewed under one
specific model of "root": the board with zero owners, inferred structurally. That model
turns out to be wrong once a board can participate in a cycle, and produced two real,
user-found defects once played:

1. **The final review's own fix (`findContainerFor` preferring an external owner over a
   self-referencing one) silently defeats the trap whenever a self-loop box coexists on
   a board with a separate external owner.** The shipped `08-nested-loop.json` demo
   level exercises exactly this: `loopBox2` self-references `insideC`, which also has a
   real external owner (`containerC`, on root). Exiting `insideC` in *any* direction now
   always routes through `containerC` — the self-loop is permanently inert. The user
   found this by playing the level: "從自包箱裡把自己推出來" (you can push yourself
   back out of the self-loop) — which should be impossible once a loop exists.
2. **A self-loop that closes back through the level's actual starting point can't be
   expressed at all**, because `levelSchema.ts` identifies "root" as "the one board with
   zero owners" — a board that closes a cycle back to the start necessarily has an
   owner (the piece that closes the loop), so today's schema rejects it outright with
   "must have exactly one board with no owner."

The user's own resolution, arrived at through direct discussion, is simpler than either
of the above and is the basis for this spec:

> Root isn't structurally special. It's just wherever the level starts. If a self-loop
> (or a longer cycle) exists, root is one of the nodes *on* that cycle — there's no
> "outside" the loop to escape to, and no separate path in from outside either.

This spec corrects `08-nested-loop.json`'s shape (rejecting it going forward, since it's
now understood to be invalid — a self-loop box may never coexist with a separate
external owner on the same board), and generalizes the engine to support **any number
of containers forming one cycle that includes the level's own starting board** — not
just the one-node (self-referencing) case Sub-project 6 shipped. The `computeTarget`
cycle-detection mechanism Sub-project 6 already built (`visited: Set<BoardId>`) needs
**no changes at all** for this — it was already general. This has been empirically
verified against the real engine (see the worked example below) by hand-constructing a
`World` and replaying moves through `applyMove` directly, bypassing `parseLevel` (since
today's schema would reject the very shape being tested).

This spec was reviewed once already; the review's findings are incorporated directly
into the sections below (not kept as a separate addendum) — in particular, the "starting
board" must never be identified by the literal string `'root'` for anything that affects
gameplay/editing safety (only the *convention* that builtin levels happen to name their
starting board that way survives, purely as a file-naming habit, never as logic).

## Scope

**In scope:**
- Redefine how `levelSchema.ts` identifies the level's starting board and validates
  reachability, so a cycle that includes it is accepted — while every currently-invalid
  shape stays invalid (an isolated cycle disconnected from the start, a cycle mixed with
  a separate external owner on one of its boards, more than one board with zero owners).
- Remove `types.ts`'s `findContainerFor` external-owner preference — it existed only to
  cope with a two-owner board, which this spec makes impossible to construct at all (an
  over-owned board is rejected outright, the same as it always has been for any other
  reason).
- `worldEdit.ts`: generalize the "don't cascade-delete the board a piece is standing on"
  protection (`deletePieceRecursively`, `subtreeContainsPlayer`) to also cover a piece
  that closes a cycle back to the level's **actual starting board** (the board
  `locations[PLAYER_ID]` points at — never the literal string `'root'`), not just a
  piece that's self-referencing in the narrow single-node sense.
- Restrict the editor's self-loop-box tool to the root board only (tightening — Sub-
  project 6 shipped it usable on any board, which is exactly the shape this spec now
  rejects as invalid).
- `CanvasRenderer.ts`: any container that's part of a cycle (self-loop or a longer ring)
  gets a distinct, per-piece color from a small fixed palette — not one single "self-loop
  purple," so a multi-node cycle's members are visually distinguishable from each other
  (matching the user's own red/yellow example), not just distinguishable from ordinary
  containers. The palette gives a *visual distinction aid*, not a uniqueness guarantee —
  see the color section below for exactly what it does and doesn't promise.
- Replace `08-nested-loop.json` (now an invalid shape) with a new demo level built on a
  genuine two-node cycle through root, verified against the real engine before being
  written to spec (see below) — same discipline the sub-project 6 demo levels used.

**Explicitly out of scope:**
- Editor UI for authoring a multi-node cycle (connecting one container's interior to an
  *existing* board, rather than always minting a fresh one). Multi-node cycle levels are
  hand-authored JSON only this round, exactly like the self-loop box was before it got
  editor support. The self-loop-box tool itself stays in the editor, just root-restricted.
- Authored "infinity destination" markers (still tracked separately as sub-project 7 —
  unrelated to and not renumbered by this spec).
- Any change to `computeTarget`, `tryMovePiece`, or `checkLose` (`rules.ts`) — the cycle
  classification/removal mechanism already generalizes correctly, confirmed empirically.
- A cycle-local color-allocation algorithm that *guarantees* every ring member gets a
  visually distinct color (e.g. for rings larger than the palette, or on a hash
  collision). Not required this round — see the color section.

## Design

### Root is not structural — it's just where play starts

Today, `levelSchema.ts` finds "root" by computing `ownerCount` for every board and
requiring **exactly one** board with a count of zero — that board becomes `rootBoardId`,
and reachability is checked as a walk *from* it. This conflates two different things: "a
board nothing owns" (which is what makes a tree a tree) and "the board where the player
starts" (what the engine and the player actually care about, and the only thing that may
ever be used for gameplay/editing-safety logic). They happen to be the same board in
every level shipped so far, purely because those levels have no cycle.

Once a cycle exists, **every** board on it has exactly one owner — including whichever
one the player starts on. There is no board with zero owners at all in that case. The
fix: stop requiring a zero-owner board to exist. Instead:

- If exactly one board has zero owners, that's a normal tree-shaped level (unchanged
  from today) — reachability is walked from it, exactly as it is now.
- If **zero** boards have zero owners, the level's ownership graph is one connected
  cycle (with, optionally, ordinary tree branches hanging off any of its nodes — see the
  graph-theory note below). Reachability is instead walked from **the player's actual
  starting board** (`locations[PLAYER_ID].board`, validated to exist *before* it's used
  as a traversal seed — see "Validation ordering" below) — which works precisely because
  a cycle is reachable from any single node on it by walking forward around the ring,
  and the existing downward walk (via `piece.boardRef`, unchanged) already does exactly
  that once it has a starting point.
- More than one board with zero owners stays invalid, exactly as today (an incomplete
  or disconnected set of trees).

**Ownership counting and reachability answer two different questions, and neither
proves the other.** `ownerCount` answers "how many containers reference this board?" —
a purely local, per-board count. Reachability answers "can every board actually be
reached, by walking the graph, from wherever the level starts?" — a global,
whole-graph property. A cycle disconnected from the start can satisfy every local
owner-count constraint (every one of its boards has exactly one owner) while still
failing reachability outright, because nothing on the reachable side of the level ever
points into it. The two checks stay separate passes for exactly this reason; do not
collapse the reasoning that "owner counts look right" into "therefore reachable."

**Why this can't accidentally accept two independent cycles:** a connected graph with a
`boards`-count of nodes and exactly that many ownership edges (which is what "zero
orphans, and every board has exactly one owner" means numerically) has, as a basic
graph-theory fact, **exactly one cycle** if it's connected at all — the existing "every
board must be reachable" walk (unmodified) is what enforces connectivity. A second,
disconnected cycle elsewhere in the same level data fails that same reachability check
(its boards are never visited by the walk from wherever play starts) — nothing new
needs to be written to reject it. The existing "over-owned" check (`ownerCount > 1`,
unmodified) still rejects a board claimed by two containers for any reason, which is
now *also* what catches Sub-project 6's original mistake automatically: a board with
both a self-referencing owner and a separate external owner has `ownerCount === 2` once
self-references stop being specially excluded from the count (see below) — no bespoke
"reject this specific shape" code is needed for that anymore either.

### `levelSchema.ts` changes

**Stop excluding self-references from the ownership count.** Currently:

```ts
for (const piece of Object.values(pieces)) {
  if (piece.kind === 'container' && piece.boardRef !== undefined) {
    const isSelfReferencing = locations[piece.id]?.board === piece.boardRef
    if (!isSelfReferencing) {
      ownerCount[piece.boardRef] = (ownerCount[piece.boardRef] ?? 0) + 1
    }
  }
}
```

A self-referencing container is, structurally, just an ordinary owner now — it
contributes to its board's count exactly like any other container does. Simplify to:

```ts
for (const piece of Object.values(pieces)) {
  if (piece.kind === 'container' && piece.boardRef !== undefined) {
    ownerCount[piece.boardRef] = (ownerCount[piece.boardRef] ?? 0) + 1
  }
}
```

**Branch on the orphan count, validating the start board before it's used as a seed**
(this ordering matters: never treat an unvalidated player location as a traversal seed
and only discover it was invalid later):

```ts
const orphanBoards = Object.entries(ownerCount).filter(([, count]) => count === 0)
if (orphanBoards.length > 1) {
  throw new Error(
    `Level must have at most one board with no owner; found ${orphanBoards.length}`,
  )
}
const overOwnedBoards = Object.entries(ownerCount).filter(([, count]) => count > 1)
if (overOwnedBoards.length > 0) {
  const [boardId] = overOwnedBoards[0]
  throw new Error(`Board "${boardId}" has more than one owner (container referencing it)`)
}

let startBoardId: string
if (orphanBoards.length === 1) {
  startBoardId = orphanBoards[0][0]
} else {
  // orphanBoards.length === 0: the level is one connected cycle (or a cycle
  // with tree branches). There is no ownerless board to anchor on, so the
  // player's own starting board is the only board that can serve as the
  // reachability seed. Validate it explicitly here, before using it — do not
  // let the later per-piece location checks be the only thing standing
  // between an invalid player location and a confusing reachability error.
  const playerLocation = locations[PLAYER_ID]
  if (playerLocation === undefined) {
    throw new Error(
      'Cannot determine a starting board for reachability: no board is ownerless, and the player has no location',
    )
  }
  if (boards[playerLocation.board] === undefined) {
    throw new Error(
      `Cannot determine a starting board for reachability: the player's board "${playerLocation.board}" does not exist`,
    )
  }
  startBoardId = playerLocation.board
}
```

The existing per-piece location/bounds/collision checks elsewhere in `parseLevel` are
unaffected and still run in full — this is a narrower, earlier check specifically
gating what may be used as the reachability BFS's starting point.

**Reachability** keeps its existing algorithm verbatim, just seeded from `startBoardId`
instead of the old `rootBoardId`:

```ts
const reached = new Set<string>([startBoardId])
const queue: string[] = [startBoardId]
while (queue.length > 0) {
  // ...unchanged...
}
```

Update the comment above it (currently claims a cycle is always rejected, which stops
being true) to describe what reachability now actually guarantees: every board is
either part of the one connected structure containing the start, or the level is
invalid — regardless of whether that structure is a tree, a cycle, or a cycle with tree
branches hanging off it.

### `types.ts`: revert `findContainerFor`

The external-owner preference exists solely to cope with a board that has two owners —
one self-referencing, one external. That shape is now always invalid (over-owned, per
above), so a valid, already-parsed `World` can never reach this function with more than
one container referencing the same board — this simplification is only safe *because*
`parseLevel` rejects that shape before a `World` value can exist at all; a test must
pin down that rejection (see Testing) so a future change to validation can't silently
make this function ambiguous again. Revert to the simple version:

```ts
export function findContainerFor(world: World, boardId: BoardId): PieceId | undefined {
  for (const piece of Object.values(world.pieces)) {
    if (piece.kind === 'container' && piece.boardRef === boardId) return piece.id
  }
  return undefined
}
```

### `worldEdit.ts` changes

**Generalize the cascade-protection predicate — using the player's actual board, never
the literal string `'root'`.** Today, `deletePieceRecursively` and
`subtreeContainsPlayer` both skip descending into a piece's own board only when that
piece is *self*-referencing (`locations[id].board === boardRef`). A piece that closes a
longer cycle back to the level's starting board (but is *not* self-referencing — it's
physically standing somewhere else in the cycle) needs the same protection: deleting it
must never cascade into deleting the board the whole level is built on. `'root'` is
only ever a *naming convention* this codebase's tooling happens to use — hard-coding it
here would make deletion safety depend on that convention and silently stop protecting
any level whose starting board has a different ID. Use the actual player location
instead:

```ts
const startBoardId = world.locations[PLAYER_ID]?.board
const skipsCascade =
  locations[id]?.board === piece.boardRef ||
  (piece.boardRef !== undefined && piece.boardRef === startBoardId)
```

Every `World` this code ever legitimately runs against has a player location (the
editor's own invariants — `createEmptyWorld`, `movePlayer` — guarantee exactly one
player piece with a location at all times); `startBoardId` being `undefined` is not a
reachable case in practice, but the optional chaining means it degrades safely (no
piece's `boardRef` is ever literally `undefined`-as-a-string, so the second condition
just never matches) rather than throwing, if that invariant is ever violated elsewhere.

**Restrict `placeSelfLoopBox`'s caller to root only.** The function itself
(`worldEdit.ts`) stays a plain, unopinionated placement primitive — exactly like
`setRequirement` has no opinion about walls (`EditorScreen.tsx`'s `placeAt` handles
that rejection, not `worldEdit.ts`). The same pattern applies here: `EditorScreen.tsx`'s
`self-loop-box` branch gets a root-only guard, mirroring the existing
wall-blocks-a-goal-tool click-time rejection already in that file — no change to
`worldEdit.ts` itself. ("Root only" here is fine as the literal string `'root'` — this
is the *editor's own* convention for where a fresh level's starting board lives
(`createEmptyWorld` always names it that), not a claim about what's structurally
required, so it doesn't have the same failure mode as the `worldEdit.ts` deletion guard
above.)

### `CanvasRenderer.ts`: per-piece cycle colors

Replace the single "is this a self-loop box" boolean with "is this container part of a
cycle at all" (any ring size), reusing the same climb-and-detect-a-repeat idea
`computeTarget` already uses, but classifying membership rather than resolving a move:

```ts
function isCycleMember(pieceId: PieceId, world: World): boolean {
  const piece = world.pieces[pieceId]
  if (piece.kind !== 'container' || piece.boardRef === undefined) return false
  const start = piece.boardRef
  let current: BoardId = start
  const seen = new Set<BoardId>()
  while (!seen.has(current)) {
    seen.add(current)
    const owner = findContainerFor(world, current)
    if (owner === undefined) return false
    const ownerLoc = world.locations[owner]
    if (ownerLoc === undefined) return false
    current = ownerLoc.board
  }
  return current === start
}
```

This correctly distinguishes a cycle member from an ordinary container hanging off a
cycle node as a normal tree branch (e.g. Sub-project 6's `07-loop-eats-container`'s
`obstacleContainer`, which owns an unrelated board and must **not** be colored as a
cycle member) — traced by hand for both cases; verify with a unit test for each.

A cycle-member container gets a color derived deterministically from its own piece id
(a small fixed palette, indexed by a simple string hash), so two different pieces in the
same ring usually get two different colors (matching the user's red/yellow example)
without needing any new stored data on `Piece` — this stays a pure rendering-layer
computation, same as everything else in this file:

```ts
const CYCLE_PALETTE = ['#ef4444', '#eab308', '#a855f7', '#14b8a6', '#f97316']

function cycleColorFor(pieceId: PieceId): string {
  let hash = 0
  for (const ch of pieceId) hash = (hash * 31 + ch.charCodeAt(0)) >>> 0
  return CYCLE_PALETTE[hash % CYCLE_PALETTE.length]
}
```

A single self-loop box (a 1-node "ring") still gets exactly one color from this same
palette — there's no special case for ring size 1 versus larger.

**What this does and doesn't guarantee:** the palette is a *visual distinction aid*, not
a uniqueness guarantee. For a ring larger than the palette (more than 5 members), or on
a hash collision between two piece ids, two cycle members can end up sharing a color.
This is acceptable for this round — every demo level this spec ships has at most two
cycle members, well within the palette. If a future requirement becomes "every ring
member must always be visually distinct, no matter how large the ring," that needs a
proper cycle-local allocation (walk the ring in order, assign each member the next
unused palette slot) rather than a per-id hash — out of scope here; tests must not
assert global color uniqueness beyond the specific fixtures this spec introduces.

## Worked example (verified against the real engine)

To confirm `computeTarget`/`tryMovePiece` need no changes, this exact shape was hand-
constructed as a `World` object and played via `applyMove` directly (bypassing
`parseLevel`, which today would reject it before this spec's changes land):

- `root` (4x4): `player` at `(0,0)`, `box1` (normal) at `(1,0)`, `redPiece` (container,
  `boardRef: 'redInterior'`) at `(3,1)` — flush against root's right edge.
- `redInterior` (4x4): `yellowPiece` (container, `boardRef: 'root'`) at `(3,1)` — flush
  against redInterior's right edge. This closes the cycle: `root`'s owner is
  `yellowPiece`, `redInterior`'s owner is `redPiece`.
- `root`'s cell `(3,0)` has `requirement: 'player'`.

Pushing `box1` right three times: move 1 and 2 push it normally to `(3,0)`; move 3
tries to push it further right, off `root`'s edge — `computeTarget` climbs
`root → redInterior (via yellowPiece) → root again (via redPiece)`, revisits `root`,
classifies `infinite`, and `box1` is removed. The player moves into `(3,0)`, satisfying
the requirement. `checkWin` was `false` before this move and `true` immediately after,
confirmed by running the actual code (`applyMove`, `checkWin`) — not just traced by
hand. This becomes `08-two-node-cycle.json` (or similar), replacing the removed
`08-nested-loop.json`, with the same win condition and move sequence, once
`levelSchema.ts`'s change lands and the level can actually be saved and loaded like any
other builtin level.

## Testing

- `levelSchema.test.ts`:
  - Update the two Sub-project 6 tests that are now wrong — the
    self-loop-on-non-root-with-a-real-external-owner test must flip from "accepted" to
    "rejected" (over-owned); the self-loop-on-non-root-without-an-external-owner test's
    expected error may change (verify by tracing, don't assume) now that self-references
    count normally.
  - Add: a genuine two-node cycle through the level's start is accepted (the worked
    example above, or a smaller fixture).
  - The existing two-board mutual-cycle test (`ca`/`cb`, neither touching the start)
    stays rejected — confirm by tracing it's unaffected, don't just assume.
  - A level with two boards *both* having zero owners is still rejected (the `> 1` case
    — message wording changes slightly, update the assertion).
  - Explicit test: a board with both a self-referencing owner and a separate external
    owner is rejected as over-owned (this is what makes `findContainerFor`'s
    simplification safe — pin it down directly, don't rely on it being an incidental
    side effect of some other test).
  - Explicit test: an invalid/missing player location, when no board is ownerless
    (cycle case), is rejected with a clear error *before* reachability runs — not a
    generic "board not reachable" message.
- `types.test.ts`: `findContainerFor`'s existing coverage should still pass unmodified
  (its behavior for every case that was ever legal is unchanged) — no new test strictly
  required beyond the `levelSchema.test.ts` over-owned-rejection test above, since that's
  what actually guarantees this function never sees an ambiguous board.
- `worldEdit.test.ts`:
  - A hand-built two-node-cycle world (constructed directly, not through `parseLevel`)
    where deleting the piece that closes the loop back to the start (not itself
    self-referencing) does not cascade-delete the starting board or anything on it.
  - **Regression fixture whose starting board is not named `'root'`** (e.g. call it
    `'start'` or similar) — proving the deletion guard genuinely reads
    `locations[PLAYER_ID].board` rather than the literal string. This is the test that
    would fail if a future edit reintroduces the old naming assumption.
  - `EditorScreen.tsx`'s self-loop-box tool is a no-op when the active board isn't root
    (new test, mirroring the existing wall-blocks-goal-tool test's shape).
- `CanvasRenderer.test.ts`: a two-node-cycle world's two container pieces render with
  two *different* fillStyles from each other (not just each different from plain
  container blue); a container that merely owns an unrelated board (a normal tree
  branch hanging off a cycle node, like `07-loop-eats-container`'s `obstacleContainer`)
  is confirmed **not** colored as a cycle member. Do not assert color uniqueness beyond
  these specific fixtures (see the color section's guarantee/non-guarantee above).
- `src/levels/index.test.ts`: update the builtin-level-id list for the `08-nested-loop`
  → `08-two-node-cycle` (or chosen name) rename; the "each parses to an unsolved world"
  assertion continues to hold.

## Acceptance criteria

This sub-project is complete only when all of the following hold:

- A normal tree with exactly one ownerless board still parses.
- A connected cycle through the player's starting board parses.
- A disconnected cycle is rejected by reachability.
- Two ownerless boards are rejected.
- Any board with two owners is rejected, including self-loop plus external owner.
- `computeTarget`, `tryMovePiece`, and `checkLose` remain unchanged.
- Deleting a cycle-closing piece cannot delete the player's starting board — verified
  with a fixture whose starting board is *not* named `'root'`.
- A self-loop can be authored only on the root board through the editor UI.
- Cycle members receive deterministic cycle colors; tests do not assume global color
  uniqueness beyond the selected fixtures.
- The old `08-nested-loop.json` fixture is replaced by the verified two-node cycle level.
