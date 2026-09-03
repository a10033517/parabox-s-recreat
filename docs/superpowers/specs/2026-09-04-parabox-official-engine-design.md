# Parabox PWA — Official-Style Engine Rewrite (Sub-project 1: Core Engine)

## Background

The shipped MVP (see `2026-08-24-parabox-pwa-design.md`) implements an
original, hand-designed nesting mechanic: a pushed chain only nests when it
terminates against a wall, and nesting is resolved by scanning backward for
the nearest `container`-type box. Playtesting showed this mechanic feels
wrong compared to the real Patrick's Parabox, and the decision was made to
replace it with a mechanic that matches the official game's actual rules as
closely as we can determine them.

This is a full mechanic replacement, not a patch. The change touches the
core data model, not just the move-resolution function, so it's being
scoped and built as its own sub-project rather than folded into a task on
top of the existing architecture. It's the first of five planned
sub-projects:

1. **Core engine rewrite** (this spec)
2. Renderer + controls update (player entering/exiting boxes)
3. Editor rework
4. Solver + level generator rewrite
5. Old-level migration/regeneration

Only sub-project 1 is in scope here. Sub-projects 2–5 depend on this one
landing first and will get their own brainstorming/spec pass.

## Research basis

Patrick's Parabox is closed-source. The exact mechanic was reconstructed by
directly reading the source of
[joshuakb2/Patricks-Parabox-Solver](https://github.com/joshuakb2/Patricks-Parabox-Solver)
(MIT-licensed Haskell solver that reimplements the game's rules to solve
levels), specifically `Main.hs`'s `movePiece` / `onPieceInTheWay` /
`movePieceIntoAnother` / `targetCell` functions, cross-checked against a
developer interview
([Game Developer: "Patrick's Parabox"](https://www.gamedeveloper.com/design/patrick-s-parabox-))
for the entry-condition rule ("room in the middle of the side you're
entering").

This is a reconstruction from a third-party reimplementation, not the
official source. Confidence is high for the algorithm shape (verified by
reading the raw code directly) but exact pixel/frame behavior can only be
confirmed against the real game during later playtesting.

**Revision note:** this spec went through a second correctness pass after
the first draft was approved — a review caught that boards were declared
rectangular (`width`/`height`) while the reference solver's boards are
square, that nothing enforced who "owns" a board (two containers could
reference the same board, making board-exit ambiguous), and that
`getEntryCell`'s boundary-case arithmetic could compute a negative array
index on deeply cascading entries. All three are fixed below, along with
two smaller gaps (a missing wall check, and width/height axis confusion)
fixed in an earlier pass. See the `World invariants` section for the
complete list of assumptions the engine now enforces.

## Scope

**In scope:**
- Flat multi-board world data model
- Recursive push → enter → eat move resolution
- Board-exit ("growing out") geometry, including the fractional
  edge-offset needed for a single move that crosses more than one board
  boundary
- Cell-based win condition (`box` / `player` requirements)
- Engine-level tests only (hand-written fixture levels)

**Explicitly out of scope for this sub-project:**
- Rendering, controls, editor, solver, generator — all deferred to
  sub-projects 2–5
- Self-recursive boxes (a box containing itself) — deferred to a future
  sub-project after this engine ships and is validated
- Flipped/mirrored boxes (`FlippedHorizontal`/`FlippedVertical`/`FlippedBoth`
  in the reference solver) — a level-design polish feature, not core
  physics; deferred indefinitely, revisit only if a level design needs it
- Rectangular (non-square) boards — the reference solver's boards are all
  square, and square boards keep the crossing geometry in `computeTarget`/
  `getEntryCell` simple and unambiguous. Revisit only if a level design
  genuinely needs a non-square room.
- Migrating or converting existing built-in/generated levels — the old
  levels are incompatible with the new rules and will simply be retired;
  new hand-written fixture levels validate this sub-project, full
  regeneration happens in sub-project 5

## Architecture: flat multi-board model

The current shipped engine models nesting as a tree: `Box.interior` is
itself a full `Grid`, recursively. The official game does not do this — it
models the world as a flat map from `(board, x, y)` to whatever piece
occupies that cell, where "boards" are independently-addressable rooms and
a box is just a piece that happens to reference one of those rooms as its
interior. This is what makes "growing out of a box" and (in the future)
self-recursion fall out naturally instead of requiring special-casing.

We are adopting this flat model for the rewrite.

```ts
type BoardId = string
type PieceId = string

type CellType = 'floor' | 'wall'
type Requirement = 'box' | 'player'

interface Cell {
  type: CellType
  requirement?: Requirement // only meaningful on 'floor' cells
}

interface Board {
  id: BoardId
  size: number       // every board is size × size — see World invariants
  cells: Cell[][]     // [y][x], cells.length === size, cells[y].length === size
}

type PieceKind = 'player' | 'normal' | 'container'

interface Piece {
  id: PieceId
  kind: PieceKind
  boardRef?: BoardId // present only when kind === 'container'
}

interface Location {
  board: BoardId
  x: number
  y: number
}

interface World {
  boards: Record<BoardId, Board>
  pieces: Record<PieceId, Piece>
  locations: Record<PieceId, Location>
}
```

Notes:
- `normal` pieces have no `boardRef` — they can never be entered (maps to
  the reference solver's `Block`).
- `container` pieces always have a `boardRef` pointing at a `Board` in
  `World.boards` (maps to `BoardPiece`).
- A reverse index (`(board,x,y) -> PieceId`) is derived/maintained
  alongside `locations` for O(1) occupancy lookup — implementation detail,
  not part of the public shape.
- `requirement` replaces the old `target` cell type and `Box.isGoalBox`
  flag entirely (see Win Condition below).
- Boards are square (`size`, not independent `width`/`height`) — see
  invariant 2 below for why, and the Research basis revision note for how
  this was caught.

### World invariants

The engine assumes — and `parseLevel` (see Testing strategy /
`levelSchema.ts`) rejects any level that violates — the following:

1. Exactly one piece has `kind === 'player'`.
2. Every board is square: `board.cells.length === board.size` and
   `board.cells[y].length === board.size` for every row.
3. The root board (the one nothing renders "from outside") is referenced
   by no container's `boardRef`.
4. Every non-root board is referenced by **exactly one** container — never
   zero, never two or more. This is what makes "which container did I
   exit through" unambiguous in `computeTarget`; two containers sharing a
   `boardRef` would make board-exit direction undefined.
5. Every `container` piece's `boardRef` points to a board that exists in
   `World.boards`.
6. No two containers reference the same `BoardId` (restates invariant 4
   from the container's side).
7. Every piece has exactly one entry in `World.locations`, and every
   location's `(board, x, y)` is in bounds for that board.
8. No two pieces occupy the same `(board, x, y)`.
9. `normal` pieces never have a `boardRef`.
10. `container` pieces always have a valid `boardRef`.
11. Flipped/mirrored container orientation is not implemented — board
    boundary traversal in `computeTarget` always preserves `dir`
    unchanged when crossing into a parent board. If orientation support
    is added later (out of scope here), the exit direction will need to
    be transformed per-container the way the reference solver's
    `flipIfNeeded` does.

`findContainerFor(world, boardId)` (used by `computeTarget` to find which
container a board is exited through) relies on invariant 4 to return a
single unambiguous answer. It is not itself responsible for enforcing the
invariant — level validation is (see `levelSchema.ts` below) — but engine
code should never construct a `World` that violates it.

## Fraction (exact rational)

The reference solver tracks edge-crossing position as an exact rational
(`Ratio Int`) rather than a float, because it makes an exact
`remainder == 0` boundary check when computing which cell to land in.
Floating point would make that check flaky at exact cell boundaries. We
mirror this with a small exact-fraction helper:

```ts
interface Fraction { numerator: number; denominator: number }

function makeFraction(n: number, d: number): Fraction   // reduces via gcd
function addInt(f: Fraction, n: number): Fraction       // n + f
function divideByInt(f: Fraction, n: number): Fraction  // f / n
function multiplyByInt(f: Fraction, n: number): Fraction // f * n
function isZero(f: Fraction): boolean
function fractionDivMod(f: Fraction, unit: Fraction): { offset: number; remainder: Fraction }

const HALF: Fraction = makeFraction(1, 2) // starting position: dead center of your own cell
```

Kept as small integer-pair arithmetic (numerator/denominator both
integers, reduced on construction) — no floating point anywhere in the
move-resolution path. This part of the design was reviewed and confirmed
correct as originally written — keep it exactly as specified here.

## Move resolution algorithm

Ported directly from the reference solver's `movePiece` /
`onPieceInTheWay` / `movePieceIntoAnother` / `targetCell`. The
push → enter → eat ordering, the `inMotion` loop guard, and the `eat`
branch's fresh (reset) `beingEntered` set were all reviewed and confirmed
correct as originally written — keep them exactly as specified here; only
`computeTarget` and `getEntryCell` change (square-board axis, and
boundary-safety on the entry cell).

```ts
type Direction = 'up' | 'down' | 'left' | 'right'

function applyMove(world: World, dir: Direction): World | null {
  return tryMovePiece(world, PLAYER_ID, dir, new Map())
}

// inMotion: PieceId -> Direction, tracks pieces already committed to
// moving this step, to detect consistent loops (ok) vs conflicting
// loops (fail) when a chain of pushes wraps back on itself.
function tryMovePiece(
  world: World,
  pieceId: PieceId,
  dir: Direction,
  inMotion: Map<PieceId, Direction>,
): World | null {
  const already = inMotion.get(pieceId)
  if (already !== undefined) {
    return already === dir ? world : null
  }

  const loc = world.locations[pieceId]
  const target = computeTarget(world, loc, dir, HALF) // HALF = 1/2 fraction
  if (target === null) return null // exited the root board with nothing beyond

  const targetBoard = world.boards[target.location.board]
  if (targetBoard.cells[target.location.y][target.location.x].type === 'wall') return null

  const occupant = occupantAt(world, target.location)
  if (!occupant) return moveTo(world, pieceId, target.location)

  return resolveBlocked(world, pieceId, occupant, target, dir, inMotion, new Set())
}

// beingEntered: containers already being entered earlier in this same
// resolution chain — prevents a container from (indirectly) being asked
// to receive into itself. Empty for a top-level push; carried forward
// once we're inside an `enter` resolution.
function resolveBlocked(
  world: World,
  pieceId: PieceId,
  occupantId: PieceId,
  target: { location: Location; relativeCoord: Fraction },
  dir: Direction,
  inMotion: Map<PieceId, Direction>,
  beingEntered: Set<PieceId>,
): World | null {
  const nextInMotion = new Map(inMotion).set(pieceId, dir)

  // 1. push: try to move the piece in the way, same direction
  const pushed = tryMovePiece(world, occupantId, dir, nextInMotion)
  if (pushed) return moveTo(pushed, pieceId, target.location)

  // 2. enter: pieceId tries to go into occupantId
  const entered = tryEnter(
    world, pieceId, occupantId, dir, target.relativeCoord,
    nextInMotion, beingEntered,
  )
  if (entered) return entered

  // 3. eat: occupantId tries to go into pieceId, opposite direction
  //    (only succeeds if pieceId itself is a container). Uses a fresh
  //    beingEntered set — this is a logically separate resolution (the
  //    *occupant* entering the *mover*), not a continuation of the
  //    mover's own entry chain.
  const eaten = tryEnter(
    world, occupantId, pieceId, opposite(dir), HALF,
    nextInMotion, new Set(),
  )
  if (eaten) return moveTo(eaten, pieceId, target.location)

  return null
}

function tryEnter(
  world: World,
  pieceId: PieceId,
  intoId: PieceId,
  dir: Direction,
  relativeCoord: Fraction,
  inMotion: Map<PieceId, Direction>,
  beingEntered: Set<PieceId>,
): World | null {
  if (beingEntered.has(intoId)) return null // self-recursion guard

  const into = world.pieces[intoId]
  if (into.kind !== 'container') return null

  const board = world.boards[into.boardRef!]
  const { cell, newRelativeCoord } = getEntryCell(board, dir, relativeCoord)
  if (cell === null) return null // boundary case landed outside the board — treat as blocked
  if (board.cells[cell.y][cell.x].type === 'wall') return null

  const target: Location = { board: board.id, x: cell.x, y: cell.y }
  const nextBeingEntered = new Set(beingEntered).add(intoId)

  const occupant = occupantAt(world, target)
  if (!occupant) return moveTo(world, pieceId, target)

  return resolveBlocked(
    world, pieceId, occupant, { location: target, relativeCoord: newRelativeCoord },
    dir, inMotion, nextBeingEntered,
  )
}
```

`computeTarget` (the "growing out" / board-exit case):

```ts
function computeTarget(
  world: World,
  loc: Location,
  dir: Direction,
  relativeCoord: Fraction,
): { location: Location; relativeCoord: Fraction } | null {
  const board = world.boards[loc.board]
  const { x, y } = step(loc, dir) // plain (x,y) delta, no bounds check

  if (inBounds(board, x, y)) {
    return { location: { board: loc.board, x, y }, relativeCoord }
  }

  // Exiting: find the single container that owns this board (invariant 4
  // guarantees at most one — findContainerFor returning "no container" is
  // exactly the "this is the root board" case).
  const containerId = findContainerFor(world, loc.board)
  if (containerId === undefined) return null // root board — can't exit

  // Direction we're leaving in preserves the perpendicular position: an
  // up/down crossing preserves x, a left/right crossing preserves y.
  // Boards are square (invariant 2), so `board.size` is the one edge
  // length that applies regardless of which pair we're using.
  const offset = dir === 'up' || dir === 'down' ? loc.x : loc.y
  const newRelativeCoord = divideByInt(addInt(relativeCoord, offset), board.size)

  const containerLoc = world.locations[containerId]
  // Note (invariant 11): dir is passed through unchanged. A flipped/
  // mirrored container would need to transform it here; that's out of
  // scope for this sub-project.
  return computeTarget(world, containerLoc, dir, newRelativeCoord)
}
```

`getEntryCell` (mirrors the reference solver's `getEntryCellXY`), now
returning a nullable `cell` so a boundary computation that would land
outside the board is reported instead of producing an invalid index:

```ts
function getEntryCell(
  board: Board,
  dir: Direction,
  relativeCoord: Fraction,
): { cell: { x: number; y: number } | null; newRelativeCoord: Fraction } {
  const unit = makeFraction(1, board.size)
  const { offset, remainder } = fractionDivMod(relativeCoord, unit)
  const scaled = multiplyByInt(remainder, board.size)

  const cell = (() => {
    switch (dir) {
      case 'up':    return { x: offset, y: board.size - 1 }
      case 'down':  return { x: offset, y: 0 }
      case 'left':
        return isZero(remainder)
          ? { x: board.size - 1, y: offset - 1 }
          : { x: board.size - 1, y: offset }
      case 'right':
        return isZero(remainder)
          ? { x: 0, y: offset - 1 }
          : { x: 0, y: offset }
    }
  })()

  const newRelativeCoord = isZero(remainder) && (dir === 'left' || dir === 'right')
    ? makeFraction(1, 1)
    : scaled

  if (!inBounds(board, cell.x, cell.y)) {
    return { cell: null, newRelativeCoord }
  }
  return { cell, newRelativeCoord }
}
```

## Win condition

```ts
function checkWin(world: World): boolean {
  for (const board of Object.values(world.boards)) {
    for (let y = 0; y < board.size; y++) {
      for (let x = 0; x < board.size; x++) {
        const cell = board.cells[y][x]
        if (!cell.requirement) continue
        const occupantId = occupantAt(world, { board: board.id, x, y })
        if (!occupantId) return false
        const occupant = world.pieces[occupantId]
        if (cell.requirement === 'player' && occupant.kind !== 'player') return false
        if (cell.requirement === 'box' && occupant.kind === 'player') return false
      }
    }
  }
  return true
}
```

`requirement: 'player'` is satisfied only by the player.
`requirement: 'box'` is satisfied by any *supported non-player* piece —
today that means `kind === 'normal'` or `kind === 'container'`, which
happen to be every non-player kind that exists, so `occupant.kind !==
'player'` is currently an equivalent and sufficient check. If a future
sub-project ever adds another piece kind, it must explicitly decide
whether that kind satisfies a `box` requirement rather than inheriting
this "anything non-player" default silently. This replaces the old
`Box.isGoalBox` + `'target'` cell type from the shipped level schema.

## Box-type mapping

The existing `boxType: 'normal' | 'container'` distinction from the
shipped MVP maps directly onto the reference solver's `Block` /
`BoardPiece` split, so the concept survives the rewrite unchanged in
spirit:

| Shipped MVP | Official (reference solver) | New engine |
|---|---|---|
| `boxType: 'normal'` | `Block` | `kind: 'normal'` — pushable, cannot be entered, can be *eaten* into a container |
| `boxType: 'container'` | `BoardPiece` | `kind: 'container'` — pushable, has an interior board, can be entered |

## Testing strategy

Hand-written fixture worlds (no reuse of the old shipped level JSON — it's
built for the retired mechanic). At minimum:

- Simple push into empty space
- Push blocked by wall
- Push chain of `normal` boxes against a wall (push fails, nothing eaten —
  `normal` boxes never receive)
- Push a `normal` box into an adjacent `container` box → enters at center
- Entry blocked because the center entry cell is a wall
- Entry blocked because the center entry cell is occupied and that
  occupant can't itself be pushed/entered/eaten further
- Eat: pushing a `container` box into a `normal` box that can't be pushed
  further — the `normal` box gets absorbed into the back of the moving
  container
- Player walks into a `container` box directly (enters it)
- Player exits a box (`container`'s interior has an open edge with no
  wall) into the parent board
- A single move that crosses two board boundaries in one step (exit one
  box immediately followed by entering/interacting with another) —
  verifies the fractional offset lands on the geometrically-correct
  non-center cell, not just "some cell"
- A fuller cross-board chain in one fixture: exit board A into the parent,
  land on an occupied cell that requires entering board B, and B's entry
  cell is itself occupied by a piece that must be pushed/entered/eaten to
  resolve — this single fixture is the one that actually exercises the
  fractional offset, board-exit, board-entry, recursive push, recursive
  enter, eat, `beingEntered`, and `inMotion` together, rather than each in
  isolation
- Consistent loop (a push chain that wraps back to a piece already
  in motion, same direction) succeeds as a no-op-for-that-piece
- Conflicting loop (wraps back with an opposing direction requirement)
  fails the whole move
- `getEntryCell` boundary safety: a `relativeCoord` that lands exactly on
  an edge boundary (`remainder` exactly zero at `offset === 0`) returns
  `cell: null` rather than a negative index, and `tryEnter` treats that
  the same as any other blocked entry
- `checkWin`: `box` requirement satisfied by either `normal` or
  `container`; `player` requirement satisfied only by the player;
  unsatisfied requirement anywhere fails the whole check
- `parseLevel` validation (see below): rejects a non-square board, a board
  referenced by zero containers when it isn't the level's one root board,
  a board referenced by two or more different containers, and the usual
  structural problems (missing player, dangling `boardRef`, out-of-bounds
  location, duplicate occupancy)

### Level schema validation

`levelSchema.ts`'s `parseLevel` is the single place `World invariants`
1–10 get enforced (invariant 11 has no data shape to validate — it's a
behavioral limitation of `computeTarget`, not a constraint on level
files). There is no separate `rootBoard` field in the schema — "the root
board" is derived: for every board, count how many containers reference
it as `boardRef`. Exactly one board must have a count of zero (that board
is the root); every other board must have a count of exactly one.
Concretely, `parseLevel` must reject:
- Zero or more-than-one `player` piece
- A board where `cells.length !== size` or any row's `length !== size`
- A `container` whose `boardRef` doesn't exist in `boards`
- Two containers with the same `boardRef`
- Any board whose reference count (per the derivation above) is not
  exactly 1, unless it's the single board with count 0
- Zero boards with a reference count of 0, or more than one (both mean
  there's no unambiguous root)
- A location referencing a nonexistent board, or out of bounds for its
  board
- Two pieces sharing the same `(board, x, y)`
- A piece with no matching location, or a location with no matching piece

## Migration note

Existing files affected: `src/game/engine/types.ts`, `rules.ts`,
`GameState.ts`, `levelSchema.ts` are rewritten, not patched. The existing
built-in and generated level JSON files (`src/levels/builtin/*`) are
incompatible with the new schema and are retired as part of this
sub-project — not converted. Sub-project 5 (old-level migration) decides
whether to hand-redesign replacement levels or regenerate via a rebuilt
generator (sub-project 4); until then, this sub-project's own test
fixtures are the only levels the new engine needs to satisfy.
