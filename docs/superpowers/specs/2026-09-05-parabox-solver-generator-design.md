# Parabox PWA — Solver & Level Generator Rewrite (Sub-project 4)

> Revision note: this spec was reviewed (`2026-09-05-parabox-solver-generator-review.md`)
> before implementation began. The review's central finding — that hand-derived inverse
> logic must be validated against the real `applyMove()`, not trusted on its own — is
> now the spec's core design principle (see "Forward engine is the source of truth"
> below). Every other finding in the review is addressed inline; the review document
> itself is superseded by this revision and is not required implementation reading.

## Background

Sub-projects 1 (core engine — flat `World` model, push/enter/eat mechanics) and 2
(renderer + controls, camera-cut on entering/exiting boxes) are both complete and
merged into `master`. `tools/generator/*` still targets the retired custom nesting
mechanic (old `Grid`/`Box` tree model, old `applyMove`/`checkWin` signatures) and does
not compile against the current engine. This sub-project rewrites it end to end:
`seed.ts`, `inverseMoves.ts`, `generateLevel.ts`, `solver.ts`, `difficultyScorer.ts`,
`generateBatch.ts`, plus un-stubbing `src/levels/index.ts`'s `loadGeneratedLevels()` so
generated levels actually appear in the game (it currently always returns `[]`,
deliberately deferred by sub-project 2 to this sub-project).

This is the fourth of five planned sub-projects:

1. Core engine rewrite (shipped)
2. Renderer + controls update (shipped)
3. Editor rework (not yet started)
4. **Solver + level generator rewrite** (this spec)
5. Old-level migration/regeneration

## Research basis

Searched GitHub and academic literature before committing to an approach. No solver
exists for Patrick's Parabox specifically beyond the MIT-licensed Haskell reference
solver already used to design sub-project 1's engine (plain BFS with canonical-state
deduplication — no pattern databases, no IDA*). The reverse-generation-from-a-solved-
state strategy already chosen for this project (in the original brainstorming, before
sub-project 1) is independently used elsewhere: it's the third stage
("room reverse-playing") of Taylor & Parberry's academic "Procedural Generation of
Sokoban Levels" paper, and it's also what
[xbandrade/sokoban-solver-generator](https://github.com/xbandrade/sokoban-solver-generator)
does independently. A more advanced technique exists (IJCAI 2019's "Beta" system: forward
search + pattern-database hardness metrics + novelty search, aimed at generating puzzles
harder than human-designed ones) but targets a different difficulty notion (search-tree
hardness) than this project's (how many times an advanced mechanic — entering or eating
— is required in the optimal solution), and is significant over-engineering for small
auto-generated levels. No reason to change the generation *strategy*.

**What this research does and doesn't establish** (per review): the Sokoban literature
and the sibling generator repo validate that *reverse generation from a solved state* is
a sound generation strategy in general. Neither validates the correctness of this
project's specific `inversePush`/`inverseEnter`/`inverseEat` functions — Sokoban's
transition system (single-board push-only) is not the same transition system as
Parabox's nested-board push/enter/eat model. Those three functions are Parabox-specific
and are established below by testing them against this engine's own `applyMove()`, not
by appeal to the literature.

## Scope

**In scope:**
- Three constructive inverse-move functions (`inversePush`, `inverseEnter`,
  `inverseEat`), each producing a *candidate* predecessor for one of the engine's three
  forward mechanics, always confirmed against the real `applyMove()` before being
  accepted (see "Forward engine is the source of truth")
- A reverse random walk (`generateLevel.ts`) built on those three functions, guaranteeing
  the requested step count is actually reached (or reporting failure) and avoiding
  revisiting a state already produced during that walk
- A BFS solver (`solver.ts`) against the new engine, a deterministic canonical state key,
  and a "crossing move" counter replacing the old "box count shrank" signal
- Difficulty scoring and tiering (`difficultyScorer.ts`) — same shape as before, new
  signal
- Batch generation (`generateBatch.ts`) — guarantees its tier quotas or reports failure,
  rejects duplicate/near-duplicate levels, clears stale output before writing
- Un-stubbing `loadGeneratedLevels()` in `src/levels/index.ts` so generated levels are
  actually playable, not just written to disk

**Explicitly out of scope:**
- Board-crossing pushes (a piece being pushed out of a container into its parent) —
  `inversePush` is scoped to same-board pushes only, mirroring the old
  `inverseTranslate`'s deliberate scope limit to the simplest constructive case
- Reversing "eat" chains deeper than one level (player pushes a container which eats a
  normal box) — matches the one shape sub-project 2's own hand-designed eat level
  already exercises; deeper recursive eat chains are not attempted
- Self-recursive boards, flipped/mirrored containers — both already out of scope for
  the whole engine (sub-project 1), and stay out of scope here
- Symmetry-aware duplicate detection (e.g. treating a mirrored level as a duplicate) —
  exact canonical-state duplicate detection is in scope; symmetry detection is not,
  to avoid open-ended complexity for marginal benefit (per review §17)
- The editor (`src/editor/EditorScreen.tsx`) — sub-project 3
- Migrating old-format generated levels — none exist to migrate; the old
  `builtin/generated/*.json` files were already deleted in sub-project 2

## Forward engine is the source of truth

This is the spec's central design principle, added in response to review. The risk the
review identified: an inverse function that reconstructs its predecessor purely from
geometric reasoning (chain of occupied cells, entry-cell math, wall checks) is really
re-implementing a second copy of the engine's push/enter/eat rules. If the two copies
ever disagree — including through a bug in the spec's own hand-derivation — the
generator produces levels that *look* plausible but are not actually reachable by any
real sequence of forward moves, silently breaking every downstream guarantee (solver
correctness, difficulty scoring, "this level is solvable" at all).

The fix: geometric reasoning is used only to construct a *candidate* predecessor
cheaply — it is never trusted on its own. Every inverse function's last step, with no
exception, is:

```ts
function verifyPredecessor(candidate: World, dir: Direction, expected: World): World | null {
  const result = applyMove(candidate, dir)
  if (result === null) return null
  if (canonicalKey(result) !== canonicalKey(expected)) return null
  return candidate
}
```

`applyMove` — the same function the real game uses for every player move — is the only
authority on whether `candidate --dir--> expected` is a valid forward transition. An
inverse function's geometric checks (is there a wall here, is this cell occupied) exist
only to avoid wastefully constructing and rejecting obviously-wrong candidates; they are
never the final word. This directly resolves the review's chain-validity concern
(inversePush might geometrically look like a push but actually trigger enter/eat),
the direction-semantics concern (inverseEnter's `getEntryCell` direction convention
might not match `applyMove`'s), and the eaten-piece-type concern (inverseEat's target
might not be a piece `applyMove` actually allows to be eaten) all at once, because all
three failure modes are caught by the same round-trip check rather than needing three
separate ad hoc validations.

`canonicalKey` (used both here and by the solver and the batch generator's duplicate
detection) must be a true canonicalization, not raw `JSON.stringify` — see `solver.ts`
below.

## `seed.ts` — an already-solved `World`

```ts
import { Board, Cell, World } from '../../src/game/engine/types'
import { PLAYER_ID } from '../../src/game/engine/types'

const SEED_SIZE = 7

export function createSeedWorld(): World {
  const cells: Cell[][] = Array.from({ length: SEED_SIZE }, (_, y) =>
    Array.from({ length: SEED_SIZE }, (_, x) => {
      const isBorder = x === 0 || y === 0 || x === SEED_SIZE - 1 || y === SEED_SIZE - 1
      return { type: isBorder ? 'wall' : 'floor' } as Cell
    }),
  )
  cells[2][5] = { type: 'floor', requirement: 'box' }

  const inside: Board = {
    id: 'goalInside',
    size: 3,
    cells: Array.from({ length: 3 }, () => Array.from({ length: 3 }, () => ({ type: 'floor' as const }))),
  }
  const root: Board = { id: 'root', size: SEED_SIZE, cells }

  return {
    boards: { root, goalInside: inside },
    pieces: {
      [PLAYER_ID]: { id: PLAYER_ID, kind: 'player' },
      goal: { id: 'goal', kind: 'container', boardRef: 'goalInside' },
    },
    locations: {
      [PLAYER_ID]: { board: 'root', x: 3, y: 2 },
      goal: { board: 'root', x: 5, y: 2 },
    },
  }
}
```

The single `goal` piece does double duty exactly like the retired seed's did: it's a
`container` (so `inverseEnter`/`inverseEat` have something to work with from the very
first reverse-walk step) sitting exactly on the level's one `'box'`-requirement cell
(so the seed genuinely satisfies `checkWin` at rest, matching the "already solved"
starting point the whole reverse-generation strategy depends on). `goalInside` is an
empty 3×3 room — the reverse walk can push/enter/eat pieces into it as it runs.

**Per review §19, this is a testable claim, not an assumption.** `seed.test.ts` must
assert `checkWin(createSeedWorld()) === true` directly (using the real `checkWin`), not
merely assert the seed's shape matches a hand-written expected object. This is the one
fact the entire reverse-generation strategy is built on.

## `inverseMoves.ts` — three constructive inverses

Each function takes `(world, dir)` and either returns a valid predecessor `World` or
`null`. Each handles exactly one simple, easily-verified shape — the same "narrow but
correct" philosophy the retired `inverseTranslate`/`inverseNest` already used (its own
comment: "only handles chain length 1 and exactly 2") — and every candidate it builds is
confirmed against `applyMove` via `verifyPredecessor` before being returned (see above).
`generateLevel.ts` tries all three per step and uses whichever succeeds.

```ts
import {
  Board, Direction, PLAYER_ID, PieceId, World,
  inBounds, step, opposite, occupantAt, findContainerFor, cloneWorld,
} from '../../src/game/engine/types'
import { applyMove, getEntryCell } from '../../src/game/engine/rules'
import { HALF } from '../../src/game/engine/fraction'
import { canonicalKey } from './canonical'

function isOpenFloor(board: Board, x: number, y: number): boolean {
  return inBounds(board, x, y) && board.cells[y][x].type !== 'wall'
}

function verifyPredecessor(candidate: World, dir: Direction, expected: World): World | null {
  const result = applyMove(candidate, dir)
  if (result === null) return null
  if (canonicalKey(result) !== canonicalKey(expected)) return null
  return candidate
}
```

### `inversePush`

Candidate construction: reverse of a same-board push chain (0 or more pieces — a chain
of 0 is just the player walking into empty space). Requires the cell behind the player
to be open and empty (so the player could have come from there), and the chain in front
to end cleanly on an open, empty floor cell within the same board (no board-crossing).
**This geometric walk only proposes a candidate** — it does not by itself distinguish an
ordinary push from a chain that would actually trigger `enter`/`eat` in the real engine
(e.g. the chain's front piece is a container about to be entered rather than pushed).
That distinction is not re-implemented here; `verifyPredecessor` catches it, because
`applyMove(candidate, dir)` will produce a *different* resulting world (an enter/eat
result, not a uniform chain-shift) whenever the geometry was misleading, which fails the
canonical-equality check and correctly returns `null`.

```ts
export function inversePush(world: World, dir: Direction): World | null {
  const loc = world.locations[PLAYER_ID]
  const board = world.boards[loc.board]

  const behind = step(loc.x, loc.y, opposite(dir))
  if (!isOpenFloor(board, behind.x, behind.y)) return null
  if (occupantAt(world, { board: loc.board, x: behind.x, y: behind.y })) return null

  const chain: PieceId[] = []
  let cursor = step(loc.x, loc.y, dir)
  while (inBounds(board, cursor.x, cursor.y)) {
    const occupant = occupantAt(world, { board: loc.board, x: cursor.x, y: cursor.y })
    if (!occupant) break
    chain.push(occupant)
    cursor = step(cursor.x, cursor.y, dir)
  }
  if (!isOpenFloor(board, cursor.x, cursor.y)) return null
  if (occupantAt(world, { board: loc.board, x: cursor.x, y: cursor.y })) return null

  const candidate = cloneWorld(world)
  candidate.locations[PLAYER_ID] = { board: loc.board, x: behind.x, y: behind.y }
  let px = loc.x
  let py = loc.y
  for (const pieceId of chain) {
    candidate.locations[pieceId] = { board: loc.board, x: px, y: py }
    const forward = step(px, py, dir)
    px = forward.x
    py = forward.y
  }

  return verifyPredecessor(candidate, dir, world)
}
```

(The loop reassigns each piece in the chain to the position the piece *before* it in
the chain currently occupies — equivalent to shifting the whole chain back by one step,
computed iteratively to avoid needing a second pass.)

### `inverseEnter`

Candidate construction: reverse of the player walking directly into a container's
interior. Only matches when the player's current board is some container's interior
*and* the player is standing exactly on the center-of-edge entry cell for `dir` — i.e.,
`getEntryCell` run backward-as-a-lookup. `findContainerFor(world, loc.board)`'s result is
guaranteed unique by `parseLevel`'s own validation (`levelSchema.ts`: "every non-root
board must be referenced by exactly one container, except a single root board referenced
by none" — enforced at load time, not assumed here), so there is no ambiguity about
which container "owns" the board the player is standing on.

```ts
export function inverseEnter(world: World, dir: Direction): World | null {
  const loc = world.locations[PLAYER_ID]
  const board = world.boards[loc.board]
  const containerId = findContainerFor(world, loc.board)
  if (containerId === undefined) return null

  const { cell } = getEntryCell(board, dir, HALF)
  if (cell === null || cell.x !== loc.x || cell.y !== loc.y) return null

  const containerLoc = world.locations[containerId]
  const parentBoard = world.boards[containerLoc.board]
  const behind = step(containerLoc.x, containerLoc.y, opposite(dir))
  if (!isOpenFloor(parentBoard, behind.x, behind.y)) return null
  if (occupantAt(world, { board: containerLoc.board, x: behind.x, y: behind.y })) return null

  const candidate = cloneWorld(world)
  candidate.locations[PLAYER_ID] = { board: containerLoc.board, x: behind.x, y: behind.y }

  return verifyPredecessor(candidate, dir, world)
}
```

If `getEntryCell`'s direction convention ever turns out to disagree with what
`applyMove` actually produces for that direction, `verifyPredecessor` rejects the
candidate (wrong resulting world) rather than silently accepting a mis-directioned
predecessor — so this function degrades to "never fires" rather than "fires
incorrectly" if that assumption is ever wrong. The test suite (below) still exercises
all four directions explicitly rather than relying on this fallback.

### `inverseEat`

Candidate construction: reverse of the player pushing a container that couldn't be
pushed further (blocked by a wall immediately **ahead of the container, in the push
direction** — corrected from the original draft, which mislabeled this wall as "behind
the container") and couldn't be entered because its entry cell was occupied, so that
occupant got eaten into the container's interior instead. Scoped to exactly this
one-level shape (player → container → wall), matching the only eat pattern sub-project
2's own hand-designed level already exercises.

```ts
export function inverseEat(world: World, dir: Direction): World | null {
  const loc = world.locations[PLAYER_ID]
  const board = world.boards[loc.board]

  const containerPos = step(loc.x, loc.y, dir)
  const containerId = occupantAt(world, { board: loc.board, x: containerPos.x, y: containerPos.y })
  if (!containerId) return null
  const container = world.pieces[containerId]
  if (container.kind !== 'container' || container.boardRef === undefined) return null

  // wallAhead: the cell immediately ahead of the container in the push
  // direction — i.e. player -> container -> wall, all three in a row. This
  // is what blocks the container from being pushed further, forcing the
  // eat branch. (Earlier draft called this "behindContainerWall", which was
  // backwards — flagged in review.)
  const wallAhead = step(containerPos.x, containerPos.y, dir)
  if (!inBounds(board, wallAhead.x, wallAhead.y)) return null
  if (board.cells[wallAhead.y][wallAhead.x].type !== 'wall') return null

  const interior = world.boards[container.boardRef]
  const { cell: eatenCell } = getEntryCell(interior, opposite(dir), HALF)
  if (eatenCell === null) return null
  const eatenId = occupantAt(world, { board: interior.id, x: eatenCell.x, y: eatenCell.y })
  if (!eatenId) return null

  const behindPlayer = step(loc.x, loc.y, opposite(dir))
  if (!isOpenFloor(board, behindPlayer.x, behindPlayer.y)) return null
  if (occupantAt(world, { board: loc.board, x: behindPlayer.x, y: behindPlayer.y })) return null

  const candidate = cloneWorld(world)
  candidate.locations[PLAYER_ID] = { board: loc.board, x: behindPlayer.x, y: behindPlayer.y }
  candidate.locations[containerId] = {
    board: loc.board,
    x: loc.x + (dir === 'left' ? -1 : dir === 'right' ? 1 : 0),
    y: loc.y + (dir === 'up' ? -1 : dir === 'down' ? 1 : 0),
  }
  candidate.locations[eatenId] = { board: loc.board, x: containerPos.x, y: containerPos.y }

  return verifyPredecessor(candidate, dir, world)
}
```

Note: `candidate.locations[containerId]` above is `loc` shifted one step in `dir` — i.e.
exactly `containerPos` computed the same way as the original `step(loc.x, loc.y, dir)`
call; the inline arithmetic is written out to avoid a second call to `step` with
identical inputs. Implementers may factor this into a `step(loc.x, loc.y, dir)` call
instead if clearer — the value is identical either way, `containerPos`.

`container.boardRef === undefined` is checked explicitly above (not cast away with
`as string`) — per review §5.3, a container's `boardRef` is typed optional
(`Piece.boardRef?: BoardId`) and the code must handle that rather than assert past it,
even though `parseLevel` also enforces every container has one at load time; this
function may be called on hand-constructed candidates mid-generation, not only on
freshly-parsed levels, so it checks directly. `eatenId`'s eligibility to actually be
eaten (piece kind, no other engine-side restriction) is established by
`verifyPredecessor`, not by inspecting `eatenId`'s own fields here — same reasoning as
`inversePush`.

**Testing oracle for all three, formalized per review §27:** the round-trip property is
now built into every function via `verifyPredecessor`, so the *unit* tests exist to
prove the geometric candidate-construction logic is reachable and correct in the cases
it's meant to handle, not to re-prove the round-trip (that's structural now). Required
cases per function:

- `inversePush`: empty-destination walk (chain length 0), one-piece push, multi-piece
  push, blocked destination → `null`, occupied cell behind player → `null`, chain that
  runs off the board → `null`, all four directions, and — the case the review flagged
  as the actual risk — a geometry that *looks* like an ordinary push but where the
  chain's front piece is a container whose forward cell is empty on its interior (i.e.
  `applyMove` would actually resolve to something other than a uniform shift): confirm
  `inversePush` returns `null` for it via `verifyPredecessor`, not by re-deriving the
  case by hand.
- `inverseEnter`: all four directions, correct entry cell, wrong entry cell → `null`,
  root board → `null`, occupied/blocked parent-behind cell → `null`.
- `inverseEat`: all four directions, the full player→container→wall shape, no wall →
  `null`, no eaten piece present → `null`, container missing `boardRef` → `null`.

## `canonical.ts` — deterministic state key

Shared by `inverseMoves.ts` (`verifyPredecessor`), `generateLevel.ts` (cycle avoidance),
`solver.ts` (visited-state dedup), and `generateBatch.ts` (duplicate-level detection).

Per review §10: plain `JSON.stringify(world)` is not a canonicalization. Two `World`
values that are semantically identical (same boards, same pieces, same locations) but
were built through different code paths can have their object keys in different
insertion order, and `JSON.stringify` is sensitive to that order — so equal states could
produce unequal keys, silently breaking every use listed above (visited-state dedup in
the solver, cycle avoidance in the generator, duplicate detection in the batch). The fix
is to sort every object's keys before serializing:

```ts
function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize)
  if (value !== null && typeof value === 'object') {
    const sorted: Record<string, unknown> = {}
    for (const key of Object.keys(value as Record<string, unknown>).sort()) {
      sorted[key] = canonicalize((value as Record<string, unknown>)[key])
    }
    return sorted
  }
  return value
}

export function canonicalKey(world: World): string {
  return JSON.stringify(canonicalize(world))
}
```

`canonicalKey(a) === canonicalKey(b)` now holds exactly when `a` and `b` are the same
`World` value regardless of construction order, which is the property every one of its
call sites actually needs.

## `generateLevel.ts` — reverse random walk

Per review §7 and §8: the retired draft always returned a `World` even when it hadn't
actually applied the requested number of steps (silent partial generation), and had no
mechanism to avoid the walk cycling back through a state it had already visited
(`A → B → A`), which could leave a "10-step" level only a couple of moves from solved.
Both are fixed here: the function returns `null` if it can't reach the requested step
count within its attempt budget, and it never accepts a step whose resulting state has
already been seen earlier in this walk (compared via `canonicalKey`, not object
identity — the review's "avoid the *state*, not just the immediately preceding one"
point). It also now returns which mechanic (`push`/`enter`/`eat`) each accepted step
used, so callers and tests can verify the walk actually exercised the mechanics it's
supposed to (per review §9), instead of only knowing a step count.

```ts
import { Direction, World, cloneWorld } from '../../src/game/engine/types'
import { inverseEat, inverseEnter, inversePush } from './inverseMoves'
import { canonicalKey } from './canonical'

const DIRECTIONS: Direction[] = ['up', 'down', 'left', 'right']

export type GenerationEventKind = 'push' | 'enter' | 'eat'

export interface GenerationEvent {
  kind: GenerationEventKind
  direction: Direction
}

export interface GenerationResult {
  world: World
  events: GenerationEvent[]
}

const PATTERNS: { kind: GenerationEventKind; fn: (world: World, dir: Direction) => World | null }[] = [
  { kind: 'push', fn: inversePush },
  { kind: 'enter', fn: inverseEnter },
  { kind: 'eat', fn: inverseEat },
]

function shuffled<T>(items: T[], rng: () => number): T[] {
  const copy = [...items]
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1))
    ;[copy[i], copy[j]] = [copy[j], copy[i]]
  }
  return copy
}

// Returns null if `steps` reverse transitions could not all be applied
// within the attempt budget — callers must treat null as "try a different
// seed/rng draw," never fall back to a partially-built world.
export function generateLevel(seed: World, steps: number, rng: () => number): GenerationResult | null {
  let world = cloneWorld(seed)
  const events: GenerationEvent[] = []
  const seen = new Set<string>([canonicalKey(world)])
  let attempts = 0
  const maxAttempts = Math.max(steps, 1) * 20

  while (events.length < steps && attempts < maxAttempts) {
    attempts++
    const direction = DIRECTIONS[Math.floor(rng() * DIRECTIONS.length) % DIRECTIONS.length]

    let accepted: { kind: GenerationEventKind; world: World } | null = null
    for (const pattern of shuffled(PATTERNS, rng)) {
      const next = pattern.fn(world, direction)
      if (!next) continue
      const key = canonicalKey(next)
      if (seen.has(key)) continue
      accepted = { kind: pattern.kind, world: next }
      break
    }
    if (!accepted) continue

    world = accepted.world
    seen.add(canonicalKey(world))
    events.push({ kind: accepted.kind, direction })
  }

  if (events.length < steps) return null
  return { world, events }
}
```

Each attempt tries all three patterns (in a random order, so no pattern is
systematically favored) for one randomly chosen direction, applying whichever succeeds
first *and* whose resulting state hasn't been visited yet this walk. This mirrors the
retired generator's "try a primary pattern, fall back to the other" structure,
generalized from 2 patterns to 3, plus the cycle guard.

**On `steps` vs. difficulty (review §4, §18):** `steps` here is the number of *accepted
reverse transitions attempted during construction* — it is explicitly not the same
number as the level's eventual optimal solution length. The reverse walk can revisit
structurally-similar states, and a chain-length-0 `inversePush` step (the player simply
walking) changes nothing about puzzle structure while still counting as one step.
Downstream difficulty scoring (`difficultyScorer.ts`) always uses the solver's actual
optimal solution length on the finished level, never `steps` — this was already true in
the original design, but is now stated explicitly since it's easy to misread `steps` as
a difficulty knob.

## `solver.ts` — BFS plus a crossing-move counter

```ts
import { applyMove, checkWin } from '../../src/game/engine/rules'
import { Direction, World } from '../../src/game/engine/types'
import { canonicalKey } from './canonical'

const DIRECTIONS: Direction[] = ['up', 'down', 'left', 'right']

// Returns the shortest solution (BFS explores in unit-cost order, so the
// first solution found is optimal in move count) as a sequence of moves
// from initialWorld, or null. `null` means "no solution was found within
// maxDepth" — it is NOT proof the puzzle is mathematically unsolvable; a
// solution longer than maxDepth would also produce null. maxDepth is
// therefore a hidden difficulty ceiling for anything that calls this with
// a fixed depth (see generateBatch.ts).
export function solve(initialWorld: World, maxDepth = 200): Direction[] | null {
  if (checkWin(initialWorld)) return []

  const visited = new Set<string>([canonicalKey(initialWorld)])
  let frontier: { world: World; path: Direction[] }[] = [{ world: initialWorld, path: [] }]
  let depth = 0

  while (frontier.length > 0 && depth < maxDepth) {
    const nextFrontier: typeof frontier = []
    for (const { world, path } of frontier) {
      for (const direction of DIRECTIONS) {
        const next = applyMove(world, direction)
        if (!next) continue
        const key = canonicalKey(next)
        if (visited.has(key)) continue
        visited.add(key)
        const newPath = [...path, direction]
        if (checkWin(next)) return newPath
        nextFrontier.push({ world: next, path: newPath })
      }
    }
    frontier = nextFrontier
    depth++
  }
  return null
}

// Number of moves in the given path during which at least one piece
// changed which board it's on (an enter or an eat). A single move where
// multiple pieces cross boards at once still counts once — this counts
// EVENTS, not per-piece crossings, matching the difficulty model's intent
// ("did this move require using an advanced mechanic," not "how many
// pieces did it move between boards"). Named for that semantics per
// review §13, distinct from a literal per-piece crossing count.
export function countCrossingMoves(world: World, moves: Direction[]): number {
  let current = world
  let count = 0
  for (const direction of moves) {
    const next = applyMove(current, direction)
    if (!next) throw new Error('countCrossingMoves received an invalid move for this world')
    for (const pieceId of Object.keys(current.locations)) {
      if (current.locations[pieceId].board !== next.locations[pieceId].board) {
        count++
        break
      }
    }
    current = next
  }
  return count
}
```

`countCrossingMoves` replaces the retired `countNestingEvents`. Instead of watching a
single flat `boxes` array shrink (a signal that doesn't exist in the multi-board
`World` model), it compares every piece's `location.board` before and after each move
in the solution path and counts the move as one "event" if *any* piece's board
assignment changed — covering both `enter` and `eat` without needing to distinguish
which, matching the corresponding brainstorming decision.

**On BFS memory (review §12):** the frontier stores `{ world, path }` per node and
builds a new `path` array (`[...path, direction]`) per expansion. This is acceptable at
the state-space sizes this generator's levels produce (small boards, shallow optimal
solutions, `maxDepth` in the low hundreds) — it is not intended as a general-purpose
large-state solver. If level sizes grow substantially in a future sub-project, replace
this with a predecessor map (`visited state → {parent state, move}`) and reconstruct the
path by walking back from the goal, avoiding the repeated array copies.

## `difficultyScorer.ts`

Unchanged in shape from the retired version — same weight, same tier thresholds, just
renamed to match the new signal's name:

```ts
const BOARD_CROSSING_WEIGHT = 5

export function scoreDifficulty(moveCount: number, crossingMoveCount: number): number {
  return moveCount + crossingMoveCount * BOARD_CROSSING_WEIGHT
}

export function difficultyTier(score: number): 'easy' | 'medium' | 'hard' {
  if (score < 10) return 'easy'
  if (score < 25) return 'medium'
  return 'hard'
}
```

Per review §14: this formula's validity depends on `moveCount` being the *optimal*
solution length, which holds because `solve()` is a unit-cost BFS (documented on
`solve` above) — stated here explicitly since it's the load-bearing assumption behind
treating the score as a real difficulty measure rather than an artifact of whichever
solution the solver happened to find first.

**On hard-tier feasibility (review §15):** whether the hard tier (`score >= 25`) is
reachable at all under this generator's parameters — `steps` drawn from `3..10`,
`BOARD_CROSSING_WEIGHT = 5`, `maxDepth = 150` — cannot be proven analytically from the
spec; it depends on how often the reverse walk actually produces `enter`/`eat` events
versus plain pushes, which is an empirical property of `generateLevel`'s pattern
selection, not something derivable from the formula alone. The implementation plan must
include a diagnostic pass — run `generateLevelBatch` with a moderate target and inspect
its `stats` (below) and tier distribution — before treating `targetPerTier` as
achievable. If hard levels turn out to be rare or absent, the sanctioned knobs to adjust
are the `steps` range (e.g. widen `3..10`) and `MAX_ATTEMPTS`, not the tier thresholds
themselves (which are a difficulty *definition*, not a tuning parameter).

## `generateBatch.ts`

Per review §16 and §17: the retired design (and the first draft of this spec) could
silently return fewer than `targetPerTier` levels per tier after exhausting
`MAX_ATTEMPTS`, while `main()`'s log line still read as if generation succeeded, and had
no mechanism to reject a level that duplicates one already accepted in the same batch
(the same seed + a short random walk very easily produces equivalent or near-equivalent
levels). Both are fixed: the batch result reports whether it actually met quota, and
duplicate candidates (compared via `canonicalKey`, exact-match only — see Scope) are
rejected before being counted toward a tier.

```ts
import { mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { dirname, join } from 'node:path'
import { World } from '../../src/game/engine/types'
import { checkWin } from '../../src/game/engine/rules'
import { serializeLevel } from '../../src/game/engine/levelSchema'
import { createSeedWorld } from './seed'
import { generateLevel } from './generateLevel'
import { countCrossingMoves, solve } from './solver'
import { difficultyTier, scoreDifficulty } from './difficultyScorer'
import { canonicalKey } from './canonical'

export type Tier = 'easy' | 'medium' | 'hard'

export interface GeneratedLevel {
  tier: Tier
  world: World
  json: string
}

export interface BatchStats {
  attempts: number
  discardedGenerationFailed: number
  discardedAlreadySolved: number
  discardedUnsolvable: number
  discardedDuplicate: number
  discardedTierFull: number
}

export interface BatchResult {
  levels: GeneratedLevel[]
  complete: boolean
  counts: Record<Tier, number>
  stats: BatchStats
}

const MAX_ATTEMPTS = 500

export function generateLevelBatch(targetPerTier: number, rng: () => number): BatchResult {
  const counts: Record<Tier, number> = { easy: 0, medium: 0, hard: 0 }
  const results: GeneratedLevel[] = []
  const seenLevels = new Set<string>()
  const stats: BatchStats = {
    attempts: 0,
    discardedGenerationFailed: 0,
    discardedAlreadySolved: 0,
    discardedUnsolvable: 0,
    discardedDuplicate: 0,
    discardedTierFull: 0,
  }

  while (
    stats.attempts < MAX_ATTEMPTS &&
    (counts.easy < targetPerTier || counts.medium < targetPerTier || counts.hard < targetPerTier)
  ) {
    stats.attempts++

    const seed = createSeedWorld()
    const steps = 3 + Math.floor(rng() * 8)
    const generated = generateLevel(seed, steps, rng)
    if (!generated) {
      stats.discardedGenerationFailed++
      continue
    }
    const { world } = generated

    // The generator's own contract is "produce an unsolved, playable
    // level" (review §21) — checked directly here, not merely inferred
    // from solve() returning a non-empty path (which would also be true,
    // but this makes the invariant explicit and independent of solve()'s
    // implementation).
    if (checkWin(world)) {
      stats.discardedAlreadySolved++
      continue
    }

    const levelKey = canonicalKey(world)
    if (seenLevels.has(levelKey)) {
      stats.discardedDuplicate++
      continue
    }

    const solution = solve(world, 150)
    if (!solution || solution.length === 0) {
      stats.discardedUnsolvable++
      continue
    }

    const crossingMoveCount = countCrossingMoves(world, solution)
    const score = scoreDifficulty(solution.length, crossingMoveCount)
    const tier = difficultyTier(score)
    if (counts[tier] >= targetPerTier) {
      stats.discardedTierFull++
      continue
    }

    seenLevels.add(levelKey)
    counts[tier]++
    results.push({ tier, world, json: JSON.stringify(serializeLevel(world)) })
  }

  const complete =
    counts.easy >= targetPerTier && counts.medium >= targetPerTier && counts.hard >= targetPerTier

  return { levels: results, complete, counts, stats }
}

function main() {
  const outputDir = join(dirname(fileURLToPath(import.meta.url)), '../../src/levels/builtin/generated')
  // Overwrite policy (review §23): each run replaces the entire generated
  // set rather than appending numbered files on top of a stale previous
  // run, which would otherwise silently keep old levels around forever.
  rmSync(outputDir, { recursive: true, force: true })
  mkdirSync(outputDir, { recursive: true })

  const targetPerTier = 5
  const batch = generateLevelBatch(targetPerTier, Math.random)
  const tierCounters: Record<Tier, number> = { easy: 0, medium: 0, hard: 0 }
  for (const entry of batch.levels) {
    tierCounters[entry.tier]++
    const filename = `${entry.tier}-${String(tierCounters[entry.tier]).padStart(2, '0')}.json`
    writeFileSync(join(outputDir, filename), entry.json)
  }

  console.log(
    `Generated ${batch.levels.length} levels: ` +
      `easy=${batch.counts.easy} medium=${batch.counts.medium} hard=${batch.counts.hard} ` +
      `(attempts=${batch.stats.attempts}, ` +
      `discarded: genFailed=${batch.stats.discardedGenerationFailed} ` +
      `alreadySolved=${batch.stats.discardedAlreadySolved} ` +
      `unsolvable=${batch.stats.discardedUnsolvable} ` +
      `duplicate=${batch.stats.discardedDuplicate} ` +
      `tierFull=${batch.stats.discardedTierFull})`,
  )

  if (!batch.complete) {
    console.error(
      `Batch incomplete: wanted ${targetPerTier} per tier, got ` +
        `easy=${batch.counts.easy} medium=${batch.counts.medium} hard=${batch.counts.hard}. ` +
        'Written levels are still valid but the requested quota was not met.',
    )
    process.exitCode = 1
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main()
}
```

`serializeLevel(world)` currently returns `structuredClone(world)` — a plain object, not
a string — so `generateBatch.ts` wraps it in `JSON.stringify` before writing. Per review
§24, this coupling is real but is confined to exactly one line
(`JSON.stringify(serializeLevel(world))`, in `generateLevelBatch` above); if
`serializeLevel`'s contract ever changes to return a string directly, that is the one
line to update, not something this spec asks to abstract away pre-emptively — the
codebase's actual convention is that `serializeLevel`/`parseLevel` are a pair
(`levelSchema.ts`) and every other caller (e.g. sub-project 2's level loading) already
follows the same "the object it returns is what gets JSON-serialized by the caller"
pattern, so matching that existing convention is more consistent than inventing a new
one for this file alone.

The Windows-`file://`-path entry guard (`pathToFileURL(process.argv[1]).href`) is
preserved unchanged — it was a real bug fix from sub-project 1's Task 20, not something
to re-derive.

## `levels/index.ts` — un-stub `loadGeneratedLevels`

```ts
const generatedModules = import.meta.glob('./builtin/generated/*.json', { query: '?raw', import: 'default', eager: true }) as Record<string, string>

export function loadGeneratedLevels(): LevelMeta[] {
  return Object.entries(generatedModules).map(([path, raw]) => {
    const id = path.split('/').pop()!.replace('.json', '')
    return { id, name: id, world: parseLevel(JSON.parse(raw)) }
  })
}
```

Replaces the `return []` stub sub-project 2 left in place. Matches the exact
`JSON.parse`-then-`parseLevel` pattern already established for `BUILTIN_LEVELS` in the
same file (sub-project 2), and the same `import.meta.glob` mechanism the retired
version used for the old format. An empty `generated/` directory (e.g. before the
generator has ever been run) is explicitly legal — `loadGeneratedLevels()` returns `[]`
in that case, same as the stub it replaces, so the app never depends on generated levels
existing to function.

## Testing strategy

Expanded substantially from the first draft per review §27 — the review's core point
(§10, §20) was that "the function runs" and "the output differs from the input" are not
strong enough claims for a generator whose entire purpose is producing levels that are
simultaneously reachable, unsolved, and solvable. Every test below asserts one of those
three properties directly using the real engine functions (`applyMove`, `checkWin`,
`solve`), not a hand-computed expectation.

- **`seed.test.ts`**: `checkWin(createSeedWorld())` is `true` (the load-bearing claim,
  per review §19); all boards/pieces/locations referenced are internally consistent
  (`parseLevel(serializeLevel(createSeedWorld()))` does not throw).
- **`canonical.test.ts`**: two `World` values built with the same content but different
  object-key insertion order produce equal `canonicalKey`s; two different `World`
  values produce different keys.
- **`inverseMoves.test.ts`**: the per-function case lists under "Testing oracle" above
  — each includes the "looks valid geometrically but isn't" negative case, verified by
  asserting the function returns `null`, not by hand-predicting what it should return.
- **`generateLevel.test.ts`**: `steps: 0` returns a result whose `world` equals the seed
  and `events` is empty; a nonzero `steps` request either returns a result whose
  `events.length === steps` and whose `world` differs from the seed, or returns `null`
  (never a result with fewer events than requested — review §7); every event in a
  successful result's `events` list, when replayed forward via `applyMove` from the
  seed in event order, reproduces the exact `world` returned (the walk is actually
  reachable step by step — review §20, stronger than merely "the endpoints round-trip");
  no two intermediate states across one generation run share a `canonicalKey`
  (review §8).
- **`solver.test.ts`**: an already-won world solves to `[]`; a one-push-away world
  solves to a single direction; an unreachable-within-`maxDepth` world returns `null`;
  `solve` returns the *shortest* solution when a shorter and a longer path both exist
  (construct a case with a deliberate detour available and confirm the returned length
  is the short one); `countCrossingMoves` on a hand-built path with a known enter/eat
  move returns the expected count (traced by hand, not assumed).
- **`difficultyScorer.test.ts`**: pure-function boundary tests at the tier thresholds
  (unchanged in shape from the retired version).
- **`generateBatch.test.ts`**: with a small `targetPerTier` and a real `rng`, the
  returned batch either has `complete === true` with `counts` meeting quota in every
  tier, or `complete === false` and the caller can tell (review §16, not merely logged);
  every accepted level has `checkWin(world) === false` (review §21); no two accepted
  levels in one batch share a `canonicalKey` (review §17); `stats.attempts` plus every
  `discarded*` counter accounts for the full attempt count (sanity check that nothing is
  silently dropped uncounted).
- **`levels/index.test.ts`**: `loadGeneratedLevels()` against a fixture file under
  `builtin/generated/` parses correctly, the level's `checkWin` is `false`, and IDs
  across fixtures are unique (review §22); an empty `generated/` directory produces `[]`
  without throwing.

## Migration note

Files rewritten, not patched: `tools/generator/{seed,inverseMoves,generateLevel,solver,
difficultyScorer,generateBatch}.ts`, a new `tools/generator/canonical.ts`, and their
test files. `src/levels/index.ts` is modified (not rewritten) — only
`loadGeneratedLevels()`'s body changes, from `return []` to the real implementation
shown above; `BUILTIN_LEVELS`, `loadCustomLevels`, `CUSTOM_LEVEL_ID_PREFIX` are
untouched. After this sub-project ships, running `npm run generate:levels` (the
existing `package.json` script, already pointed at `tools/generator/generateBatch.ts`)
replaces the contents of `src/levels/builtin/generated/` with a fresh batch, and those
levels appear in the game's level select screen. `src/editor/EditorScreen.tsx` and
`tools/generator`'s dependents in it (if any) remain untouched and non-compiling —
sub-project 3's job.
