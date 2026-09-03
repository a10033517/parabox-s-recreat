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
  width: number
  height: number
  cells: Cell[][] // [y][x]
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
- Exactly one piece has `kind: 'player'`.
- `normal` pieces have no `boardRef` — they can never be entered (maps to
  the reference solver's `Block`).
- `container` pieces always have a `boardRef` pointing at a `Board` in
  `World.boards` (maps to `BoardPiece`).
- A reverse index (`(board,x,y) -> PieceId`) is derived/maintained
  alongside `locations` for O(1) occupancy lookup — implementation detail,
  not part of the public shape.
- `requirement` replaces the old `target` cell type and `Box.isGoalBox`
  flag entirely (see Win Condition below).
- The root board has no piece referencing it as `boardRef` (nothing
  contains the top-level world). Attempting to exit the root board fails
  the move — the root board's outer boundary must be fully walled, same
  as today.

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
move-resolution path.

## Move resolution algorithm

Ported directly from the reference solver's `movePiece` /
`onPieceInTheWay` / `movePieceIntoAnother` / `targetCell`.

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
  //    (only succeeds if pieceId itself is a container)
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

  // exiting: find the piece that references this board as its interior
  const containerId = findContainerFor(world, loc.board)
  if (containerId === undefined) return null // root board, or dangling board — can't exit

  // Up/down crossings preserve horizontal (x) position, so the relevant
  // edge length is the board's width; left/right crossings preserve
  // vertical (y) position, so it's the board's height. Boards are not
  // guaranteed square, unlike the reference solver's, so this can't
  // reuse a single `width` like the source does.
  const axisSize = dir === 'up' || dir === 'down' ? board.width : board.height
  const offset = dir === 'up' || dir === 'down' ? loc.x : loc.y
  const newRelativeCoord = divideByInt(addInt(relativeCoord, offset), axisSize)

  const containerLoc = world.locations[containerId]
  return computeTarget(world, containerLoc, dir, newRelativeCoord)
}
```

`getEntryCell` (mirrors the reference solver's `getEntryCellXY`):

```ts
function getEntryCell(
  board: Board,
  dir: Direction,
  relativeCoord: Fraction,
): { cell: { x: number; y: number }; newRelativeCoord: Fraction } {
  // Same axis rule as computeTarget: up/down entry happens along the top
  // or bottom edge (spans width); left/right entry happens along the
  // left or right edge (spans height).
  const axisSize = dir === 'up' || dir === 'down' ? board.width : board.height
  const unit = makeFraction(1, axisSize)
  const { offset, remainder } = fractionDivMod(relativeCoord, unit)
  const scaled = multiplyByInt(remainder, axisSize)

  switch (dir) {
    case 'up':    return { cell: { x: offset, y: board.height - 1 }, newRelativeCoord: scaled }
    case 'down':  return { cell: { x: offset, y: 0 },                newRelativeCoord: scaled }
    case 'left':
      return isZero(remainder)
        ? { cell: { x: board.width - 1, y: offset - 1 }, newRelativeCoord: makeFraction(1, 1) }
        : { cell: { x: board.width - 1, y: offset },     newRelativeCoord: scaled }
    case 'right':
      return isZero(remainder)
        ? { cell: { x: 0, y: offset - 1 }, newRelativeCoord: makeFraction(1, 1) }
        : { cell: { x: 0, y: offset },     newRelativeCoord: scaled }
  }
}
```

Notes:
- `resolveBlocked` threads `beingEntered` through on every recursive call
  so a container can't be asked to receive into itself within one
  resolution chain (self-recursion guard — relevant even before we
  implement true self-recursive boards, because a container could
  otherwise indirectly reference itself through a push chain). The `eat`
  branch resets `beingEntered` to a fresh empty set because it's a
  logically separate resolution (the *occupant* entering the *mover*, not
  a continuation of the mover's own entry chain).
- For the overwhelmingly common case — pushing directly into an adjacent
  box with no prior board-crossing — `relativeCoord` is `HALF` the whole
  way through, so entry always lands on the center cell of the entered
  edge, matching the developer's stated "room in the middle of the side"
  rule.
- The fraction only diverges from `HALF` when a move crosses more than one
  board boundary in a single step (grows out of one box and immediately
  needs to enter/interact with another within the same keypress) — that's
  the scenario the user confirmed they'll actually hit and wants handled
  correctly rather than approximated.

## Win condition

```ts
function checkWin(world: World): boolean {
  for (const board of Object.values(world.boards)) {
    for (let y = 0; y < board.height; y++) {
      for (let x = 0; x < board.width; x++) {
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

`requirement: 'box'` is satisfied by any non-player piece regardless of
`kind` (`normal` or `container` both count equally) — no per-box flagging.
`requirement: 'player'` is satisfied only by the player. This replaces the
old `Box.isGoalBox` + `'target'` cell type from the shipped level schema.

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
- Consistent loop (a push chain that wraps back to a piece already
  in motion, same direction) succeeds as a no-op-for-that-piece
- Conflicting loop (wraps back with an opposing direction requirement)
  fails the whole move
- `checkWin`: `box` requirement satisfied by either `normal` or
  `container`; `player` requirement satisfied only by the player;
  unsatisfied requirement anywhere fails the whole check

## Migration note

Existing files affected: `src/game/engine/types.ts`, `rules.ts`,
`GameState.ts`, `levelSchema.ts` are rewritten, not patched. The existing
built-in and generated level JSON files (`src/levels/builtin/*`) are
incompatible with the new schema and are retired as part of this
sub-project — not converted. Sub-project 5 (old-level migration) decides
whether to hand-redesign replacement levels or regenerate via a rebuilt
generator (sub-project 4); until then, this sub-project's own test
fixtures are the only levels the new engine needs to satisfy.
