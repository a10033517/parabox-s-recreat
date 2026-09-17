# Container Link (Transfer) — Design

## Revision note — ruling on external research with an unresolved gap

The user supplied external research arguing this mechanic should match Patrick's
Parabox's own "Transfer": a *movement-resolution fallback* (try the normal push/enter
first; only when that's impossible, check whether a transfer applies) rather than an
author-specified `linkedTo` pair. The cited material describes Transfer only in
general terms ("same-position transitioning between boxes," used when a target box
can't otherwise be pushed into available space at the same/larger/smaller layer) and
does not specify — anywhere I could find in what was supplied — **how the engine is
supposed to determine which box is the transfer partner of which**. Every other piece
of research incorporated into these three specs (Clone, Flip) came with either a
confirmed worked example or a concrete, directly implementable rule; this one piece
does not, and I asked the user directly whether they had a concrete candidate-matching
rule in mind or wanted to keep the already-confirmed `linkedTo` design — the question
went unanswered before being pointed back at the same document a second time.

**Ruling: keep the `linkedTo` design (author-specified, one hop, already fully
specified and verified against the user's own coordinate example in an earlier
round), and adopt only the *terminology* alignment** — this mechanic maps to what the
official game calls Transfer, so the spec and file are titled accordingly, and the
Global-Constraints-equivalent "why" below explains the mapping. The behavior itself —
`linkedTo`, one-directional per field, author-controlled, one hop, terminal
`location` result — is unchanged from the version the user already confirmed via a
concrete example. If a genuine auto-detection rule is wanted later, it needs its own
round with either a concrete example or an explicit specification of the matching
algorithm — inventing one now and presenting it as "the official design" would be
exactly the kind of unverified guess this whole design process has been built to
avoid.

Also adopted from the same research, since it's independent of the gap above: the
`flipsEntry`/`mirroredEntry` fields referenced in the original draft of this spec are
gone (see the Flip spec) — `fliph` is what a container carries now, and it has no
special interaction with a `linkedTo` container beyond composing the way any two
independent per-container properties would (both checks can run at the same point in
`computeTarget`, in either order, since neither reads the other's field).

## Goal

Two same-size containers can be authored as directly linked: exiting one's interior
through its own boundary lands you at the *same relative position* just inside the
other's interior — as if the two interiors were physically glued together at that
edge — instead of the normal "climb out to whichever board the container itself sits
on" resolution.

Worked out with the user via a concrete coordinate example, verified against a
standalone reimplementation of the mapping formula before writing this down.

## Ground-truth example (confirmed)

```
C1, C2: containers, same size (4x4 interiors), C1.linkedTo = C2 (author-set).
Player stands inside C1's interior at (3,1) — the rightmost column — and pushes right.
```

Normally (no link) this triggers the existing exit-to-parent resolution: climb out via
whichever board C1 itself sits on. **With the link**, the player instead appears
directly inside C2's interior at `(0, 1)` — the *same relative position*, mirrored
onto the opposite edge, exactly the way exiting any board already lands you on the
opposite edge of wherever you climb to (this reuses that same "opposite edge, matching
offset" idea, just applied board-to-board directly instead of via the normal
climb-to-owner path). Verified for all four directions against the confirmed example
(`right→(0,1)`, and by the same formula: `left→(size-1,y)`, `up→(x,size-1)`,
`down→(x,0)`).

## Scope of this round

- A container piece can carry `linkedTo`, naming another container piece.
- When the containment climb (`computeTarget`) would normally resolve "which board
  does this container's own location live on" for a piece exiting `linkedTo`'s
  *source* container's interior, it instead jumps directly to the *target*
  container's interior board, at the mirrored-offset cell described above — a
  terminal `location` result, not a further climb.
- The link is **authored, not inferred**. Nothing about "same size" or "can't be
  pushed" is engine-enforced; it's the level author's responsibility to actually
  arrange both containers so they behave as intended (matching sizes so the mapped
  cell is always in bounds, and whatever level geometry keeps them from being pushed
  apart, if that's part of the puzzle). The engine trusts `linkedTo` and does not
  second-guess it.
- The link is **one-directional per field**. `C1.linkedTo = C2` only affects exiting
  C1's interior. For the link to work in both directions, the author sets
  `linkedTo` on both pieces pointing at each other — this round does not infer or
  require symmetry.

**Explicitly out of scope:**
- Engine-side validation that a `linkedTo` pair actually has matching interior board
  sizes, or is actually immovable. If sizes mismatch, the mapped cell may land out of
  bounds — this round's behavior for that case (see "Design" below: the move simply
  fails) is a deliberate, minimal fallback, not a validated/rejected authoring error.
- Any interaction between a linked container and `fliph` on either side of the link
  (separate spec, same round) — `linkedEntryCell` doesn't consult either container's
  `fliph`, so a linked+flipped container behaves as a plain link this round; whether
  that composition should itself mirror is unexplored.
- Chained/transitive links (`C1.linkedTo = C2`, `C2.linkedTo = C3`, entering from C1
  expecting to somehow reach C3). This round only resolves one hop.
- Rendering: no visual indicator that two containers are linked.

## Design

### `Piece.linkedTo`

```ts
// src/game/engine/types.ts
export interface Piece {
  id: PieceId
  kind: PieceKind
  boardRef?: BoardId
  infiniteFor?: PieceId
  cloneOf?: PieceId
  fliph?: boolean
  linkedTo?: PieceId // present only on a container linked directly to another — see computeTarget
}
```

### `computeTarget` resolves a link before the normal climb

```ts
// src/game/engine/rules.ts

// The four directions' worth of "which cell of a same-size linked board does exiting
// this cell land on" — opposite edge, matching offset, exactly like exiting any board
// already lands you on the opposite edge of wherever the climb continues to; this is
// the same idea applied directly between two linked containers' interiors instead of
// via the normal owner-climb.
function linkedEntryCell(size: number, x: number, y: number, dir: Direction): { x: number; y: number } {
  switch (dir) {
    case 'right': return { x: 0, y }
    case 'left':  return { x: size - 1, y }
    case 'down':  return { x, y: 0 }
    case 'up':    return { x, y: size - 1 }
  }
}
```

```ts
// src/game/engine/rules.ts — computeTarget, replacing the unconditional climb-to-owner
// step with a link check first. Shown together with the Flip spec's climbDir change,
// since both patch this same step — the link check runs first and, when it applies,
// returns a terminal result before fliph is ever considered for THIS container (a
// linked container's own fliph, if it had one, would need its own decision about
// whether it also applies to linkedEntryCell — not addressed this round; see
// "explicitly out of scope").
  const containerId = findContainerFor(world, loc.board)
  if (containerId === undefined) return null
  const container = world.pieces[containerId]

  if (container.linkedTo !== undefined) {
    const linked = world.pieces[container.linkedTo]
    const linkedBoard = linked?.boardRef !== undefined ? world.boards[linked.boardRef] : undefined
    if (linkedBoard === undefined) return null // malformed link — fail cleanly, don't fall through
    const cell = linkedEntryCell(board.size, loc.x, loc.y, dir)
    if (!inBounds(linkedBoard, cell.x, cell.y)) return null // e.g. a size mismatch the author didn't intend
    return { kind: 'location', location: { board: linked.boardRef as BoardId, x: cell.x, y: cell.y }, relativeCoord }
  }

  const climbDir = container.fliph ? mirrorHorizontal(dir) : dir // see the Flip spec
  const offset = climbDir === 'up' || climbDir === 'down' ? loc.x : loc.y
  const newRelativeCoord = divideByInt(addInt(relativeCoord, offset), board.size)
  const containerLoc = world.locations[containerId]
  return computeTarget(world, containerLoc, climbDir, newRelativeCoord, visited)
```

The link check sits between finding `containerId` and the existing offset/climb logic
— everything before it (the `inBounds`/`visited`/infinite-detection checks earlier in
`computeTarget`, unchanged) and everything in the non-linked branch (unchanged) stay
exactly as they are. A linked exit is a **terminal** `location` result: it does not
add `loc.board` to `visited` and does not recurse further, so it cannot be
misclassified as part of an infinite cycle by the existing detection, and a link
resolution never itself contributes to a cycle the *unlinked* infinite-exit machinery
would need to know about.

`relativeCoord` is passed through unchanged in the linked-result case — it's part of
`MoveTarget`'s shape for every `location` result, but nothing consumes it for a result
that resolves directly to an in-bounds cell (confirmed by reading every caller of
`computeTarget`'s `location` branch), so there's no meaningful value to compute here
beyond satisfying the type.

## Testing

- `computeTarget` (`rules.test.ts`): exiting a linked container's interior in each of
  the four directions lands at the confirmed mapped cell (`right→(0,y)`,
  `left→(size-1,y)`, `up→(x,size-1)`, `down→(x,0)`) in the linked container's own
  interior board — reproduce the exact confirmed example (`(3,1)` pushing right →
  `(0,1)`).
- A container with no `linkedTo` set is completely unaffected — existing climb-to-owner
  behavior (including the self-loop/infinite-exit tests from earlier rounds) must
  still pass unmodified.
- A one-directional link (`C1.linkedTo = C2`, `C2.linkedTo` unset) only affects exiting
  C1 — exiting C2's interior still uses the normal climb-to-owner resolution.
- A malformed link (`linkedTo` names a piece with no `boardRef`, or the mapped cell
  lands out of bounds on a mismatched-size linked board) fails the move (`null`)
  rather than throwing or silently falling back to normal climbing.
- A link never triggers the infinite-detection path — confirm a scenario that would
  otherwise be a textbook infinite regress (if it were resolved via the normal climb)
  instead resolves as an ordinary, immediate `location` result when a link is present.

## Acceptance criteria

- A container can carry `linkedTo`, naming another container.
- Exiting a linked container's interior lands at the mirrored-offset cell in the
  linked container's own interior, not via the normal climb-to-owner resolution.
- The link is one-directional per field and entirely author-controlled — no
  same-size or immovability enforcement, no inferred symmetry.
- A malformed or out-of-bounds link resolution fails the move cleanly rather than
  falling through to some other behavior.
- Non-linked containers, and the existing self-loop/infinite-exit machinery, are
  completely unaffected.
