# Clone Box — Design

## Goal

A **clone** is a container (or self-loop container) piece that doesn't have its own
real interior in practice: entering it — whether the player walks in, or any other
piece gets pushed into it — redirects to wherever the clone's **main body** piece is
*currently* standing, rather than descending into the clone's own `boardRef`. The main
body is an ordinary piece elsewhere (possibly on a totally different board); the clone
is just a portal to it.

This was worked out with the user over a few rounds of concrete examples, following
the same discipline as the Void mechanic: every claim below was verified against a
standalone reimplementation before being written down.

**Confirmed, concrete rule (verified):**

```
boards: root (4x4)
pieces: A (container, boardRef: root, self-loop — the main body), at root (0,0)
        B (container, cloneOf: A), at root (3,0)
        entrant (any piece), at root (2,0)

entrant tries to enter B, moving right.
```

- If A's current cell is empty, the entrant teleports directly there.
- In practice A's own cell is essentially always occupied — by A itself, since that's
  definitionally where A is standing. So the common case is: **A gets pushed one step
  further in the same direction the entrant was moving**, and the entrant takes the
  cell A just vacated. Verified: A moves `(0,0) → (1,0)`, entrant moves `(2,0) → (0,0)`.
- If A can't be pushed further (flush against a board edge, or blocked by something
  that itself can't move), the whole move **fails** — the entrant does not enter, does
  not teleport, nothing changes. Verified with A flush against the left edge.

This is the exact same shape as `resolveInfiniteExit`'s Void-exit rule from the
previous round ("pushed up, comes out the top; if blocked, chain-push; if the chain
can't complete, the move fails") — not a coincidence, it's the same underlying idea
(teleport to a fixed point, displacing whatever's there or failing) applied to a
different fixed point (a real piece's current location instead of a Void destination's
computed exit cell). `resolveCloneTeleport` below is written to make that resemblance
explicit rather than reinventing the pattern.

**Confirmed: this generalizes to any piece, not just the player.** Any piece — the
player, or an ordinary box being pushed — that ends up trying to enter a clone (i.e.
reaches the existing `tryEnter` call, in either its "entered" or "eaten" direction from
`resolveBlocked`) gets redirected the same way. No player-specific code; this is a
property of `tryEnter` itself.

## Explicitly out of scope / not fully resolved

- **"Infinite-large" / "infinite-small" emergent scenarios.** The user described two
  named puzzle patterns this mechanic is meant to enable (roughly: pushing the main
  body through a chain of clone-entries in one direction produces one effect; pushing
  the main body or its clone into a "trapped, can't-be-pushed-further" configuration
  produces the other). I was not able to pin these down to a precise, independently
  verifiable rule the way the core teleport rule above was verified — the description
  covers specific *level configurations* built from the core rule, not additional
  engine behavior. My best understanding is that both fall directly out of the core
  rule already verified above (repeatedly entering a clone chain-pushes the main body
  one step further each time; the main body eventually reaching an edge is what makes
  it "can't be pushed"), with no extra mechanic needed — but this is **not confirmed**,
  and should be validated empirically once the core mechanic ships (build the
  configurations the user described as real levels, see what actually happens, adjust
  only if it doesn't match).
- **Rendering.** No visual marker for clone pieces is specified this round (the user
  didn't ask for one). A clone currently renders identically to an ordinary container
  of its own `kind` — same treatment `08-two-node-cycle.json` had before cycle-member
  coloring existed. A distinguishing color/marker can be added in a follow-up the same
  way the infinite destination's `∞` marker was, once the core mechanic is confirmed
  working.
- **What a clone's own `boardRef` should point to.** `parseLevel`'s existing validation
  already requires any `kind: 'container'` piece to have a `boardRef` pointing at a
  real board — a clone is no exception, and this round doesn't relax that. In practice
  a clone's `boardRef` becomes dead weight (its own interior is never reached, since
  `tryEnter` redirects before ever consulting it) — level authors can point it at a
  self-loop of the clone's own board, an unused empty board, or anything else valid;
  the schema doesn't need to know or care which.
- **A clone of a clone**, or a main body whose `cloneOf` points at another clone. Not
  addressed; `resolveCloneTeleport` reads `world.locations[mainBodyId]` directly and
  does not itself check whether `mainBodyId` is itself a clone. If this needs defined
  behavior later, it needs its own round — this round only confirms the single-level
  (clone → real main body) case.

## Design

### `Piece.cloneOf`

```ts
// src/game/engine/types.ts
export interface Piece {
  id: PieceId
  kind: PieceKind
  boardRef?: BoardId    // present only when kind === 'container'
  infiniteFor?: PieceId // present only on an infinite destination
  cloneOf?: PieceId     // present only on a clone — names its main body
}
```

### `tryEnter` intercepts a clone before normal container-entry logic

```ts
// src/game/engine/rules.ts
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

  // ...rest of the function (getEntryCell, wall check, resolveBlocked) unchanged...
}
```

### `resolveCloneTeleport`

```ts
// src/game/engine/rules.ts

// A clone has no real interior in practice: entering it (from either tryEnter call
// site — the "entered" or "eaten" direction inside resolveBlocked, so this applies to
// any piece, not just the player) redirects to wherever mainBodyId is CURRENTLY
// standing, rather than descending into the clone's own boardRef. In practice that
// cell is occupied by the main body itself, so the common case is displacing it one
// step further in the same direction (an ordinary push, reusing tryMovePiece exactly
// like resolveInfiniteExit's Void-exit chain-push); if that push isn't possible, the
// whole move fails, same as any other blocked move.
export function resolveCloneTeleport(
  world: World,
  pieceId: PieceId,
  mainBodyId: PieceId,
  dir: Direction,
  inMotion: Map<PieceId, Direction>,
): World | null {
  const targetLoc = world.locations[mainBodyId]
  if (targetLoc === undefined) return null

  const occupant = occupantAt(world, targetLoc)
  if (occupant === undefined) return moveTo(world, pieceId, targetLoc)
  if (occupant === pieceId) return null // degenerate: pieceId IS the main body

  const pushed = tryMovePiece(world, occupant, dir, new Map(inMotion).set(pieceId, dir), new Set())
  if (pushed === null) return null
  return moveTo(pushed, pieceId, targetLoc)
}
```

No change to `resolveBlocked`, `tryMovePiece`, or `computeTarget` — a clone is reached
exclusively through `tryEnter`'s existing call sites, and this interception happens
entirely inside `tryEnter` itself.

### `parseLevel`

No change. A clone piece must still satisfy the existing `kind === 'container'` +
valid `boardRef` requirement (see "explicitly out of scope" above for what that
`boardRef` practically means once entry always redirects). `cloneOf` itself needs no
new validation this round — an authored level pointing `cloneOf` at a nonexistent
piece id would simply make `resolveCloneTeleport` return `null` at `world.locations[mainBodyId] === undefined`
(entering that clone always fails cleanly), which is acceptable degrade-safely
behavior rather than a parse-time error, consistent with how this codebase treats
similar "structurally odd but not unsafe" shapes elsewhere.

## Testing

- `tryEnter` / `resolveCloneTeleport` (`rules.test.ts`):
  - Entering a clone when the main body's cell is free teleports the entrant there
    directly.
  - Entering a clone when the main body occupies its own cell (the common case) pushes
    the main body one step further in the entrant's direction, and the entrant takes
    the vacated cell — reproduce the verified example (A `(0,0)→(1,0)`, entrant
    `(2,0)→(0,0)`).
  - Entering a clone fails (`null`, original world unchanged) when the main body can't
    be pushed further (flush against a board edge).
  - An ordinary box (not the player) pushed into a clone triggers the same redirect —
    prove this isn't player-specific.
  - A clone whose main body no longer exists (deleted/invalid `cloneOf` target) fails
    entry cleanly rather than throwing.
  - Control case: a normal (non-clone) container's entry behavior is completely
    unaffected — `tryEnter`'s existing container-entry tests must all still pass
    unchanged.
- `levelSchema.test.ts`: no new tests required this round (no new validation added),
  but confirm existing container-boardRef validation still applies to a piece that
  also happens to have `cloneOf` set (i.e., a clone still needs a valid `boardRef` to
  parse, per "explicitly out of scope" above).

## Acceptance criteria

- A piece with `cloneOf` set redirects any entry attempt (player or otherwise) to its
  main body's current location instead of its own `boardRef`.
- If that location is occupied, the occupant (almost always the main body itself) is
  pushed one step further in the entrant's own direction; if that's not possible, the
  whole move fails atomically.
- This applies uniformly regardless of which piece is entering — no player-specific
  code path.
- Normal (non-clone) container entry is completely unaffected.
- The "infinite-large"/"infinite-small" puzzle patterns are left for empirical
  validation via real levels once this ships, not additional engine rules baked in
  ahead of confirming they're needed.
