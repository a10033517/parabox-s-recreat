# Parabox PWA — Solver & Level Generator Rewrite (Sub-project 4)

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
sub-project 1) is independently validated twice over: it's the third stage
("room reverse-playing") of Taylor & Parberry's academic "Procedural Generation of
Sokoban Levels" paper, the most-cited approach in the field, and it's also exactly what
[xbandrade/sokoban-solver-generator](https://github.com/xbandrade/sokoban-solver-generator)
does independently. A more advanced technique exists (IJCAI 2019's "Beta" system: forward
search + pattern-database hardness metrics + novelty search, aimed at generating puzzles
harder than human-designed ones) but targets a different difficulty notion (search-tree
hardness) than this project's (how many times an advanced mechanic — entering or eating
— is required in the optimal solution), and is significant over-engineering for small
auto-generated levels. No reason to change strategy.

## Scope

**In scope:**
- Three constructive inverse-move functions (`inversePush`, `inverseEnter`,
  `inverseEat`), each the reverse of one of the engine's three forward mechanics
- A reverse random walk (`generateLevel.ts`) built on those three functions
- A BFS solver (`solver.ts`) against the new engine, plus a difficulty-relevant event
  counter replacing the old "box count shrank" signal
- Difficulty scoring and tiering (`difficultyScorer.ts`) — same shape as before, new
  signal
- Batch generation (`generateBatch.ts`) — same shape as before, new types
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
- The editor (`src/editor/EditorScreen.tsx`) — sub-project 3
- Migrating old-format generated levels — none exist to migrate; the old
  `builtin/generated/*.json` files were already deleted in sub-project 2

## Architecture

Same pipeline shape as the retired version, every stage rewritten against the new
engine:

```
seed.ts             → an already-solved World (new schema)
inverseMoves.ts      → inversePush / inverseEnter / inverseEat
generateLevel.ts      → reverse random walk, trying all three patterns per step
solver.ts             → BFS via the real applyMove/checkWin, plus countBoardCrossings
difficultyScorer.ts   → moveCount + boardCrossingCount * weight, tiered
generateBatch.ts      → orchestrates the above, writes src/levels/builtin/generated/*.json
levels/index.ts       → loadGeneratedLevels() reads what generateBatch.ts wrote
```

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

## `inverseMoves.ts` — three constructive inverses

Each function takes `(world, dir)` and either returns a valid predecessor `World` or
`null` if the current state doesn't match that function's specific pattern for that
direction. None of these attempt to be a general inverse of `applyMove` — each handles
exactly one simple, easily-verified shape, the same philosophy the retired
`inverseTranslate`/`inverseNest` already used (its own comment: "only handles chain
length 1 and exactly 2"). `generateLevel.ts` tries all three per step and uses whichever
succeeds.

```ts
import {
  Board, Direction, PLAYER_ID, PieceId, World,
  inBounds, step, opposite, occupantAt, findContainerFor, cloneWorld,
} from '../../src/game/engine/types'
import { getEntryCell } from '../../src/game/engine/rules'
import { HALF } from '../../src/game/engine/fraction'

const DIRECTIONS: Direction[] = ['up', 'down', 'left', 'right']

function isOpenFloor(board: Board, x: number, y: number): boolean {
  return inBounds(board, x, y) && board.cells[y][x].type !== 'wall'
}
```

### `inversePush`

Reverse of a same-board push chain (0 or more pieces — a chain of 0 is just the player
walking into empty space). Requires the cell behind the player to be open and empty
(so the player could have come from there), and the chain in front to end cleanly on
an open, empty floor cell within the same board (no board-crossing).

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

  const next = cloneWorld(world)
  next.locations[PLAYER_ID] = { board: loc.board, x: behind.x, y: behind.y }
  let px = loc.x
  let py = loc.y
  for (const pieceId of chain) {
    next.locations[pieceId] = { board: loc.board, x: px, y: py }
    const forward = step(px, py, dir)
    px = forward.x
    py = forward.y
  }
  return next
}
```

(The loop reassigns each piece in the chain to the position the piece *before* it in
the chain currently occupies — equivalent to shifting the whole chain back by one step,
computed iteratively to avoid needing a second pass.)

### `inverseEnter`

Reverse of the player walking directly into a container's interior. Only matches when
the player's current board is some container's interior *and* the player is standing
exactly on the center-of-edge entry cell for `dir` — i.e., `getEntryCell` run
backward-as-a-lookup.

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

  const next = cloneWorld(world)
  next.locations[PLAYER_ID] = { board: containerLoc.board, x: behind.x, y: behind.y }
  return next
}
```

### `inverseEat`

Reverse of: the player pushed a container that couldn't be pushed further (blocked by
a wall directly behind it) and couldn't be entered because its entry cell was occupied,
so that occupant got eaten into the container's interior instead. Scoped to exactly
this one-level shape (player → container → wall), matching the only eat pattern
sub-project 2's own hand-designed level already exercises.

```ts
export function inverseEat(world: World, dir: Direction): World | null {
  const loc = world.locations[PLAYER_ID]
  const board = world.boards[loc.board]

  const containerPos = step(loc.x, loc.y, dir)
  const containerId = occupantAt(world, { board: loc.board, x: containerPos.x, y: containerPos.y })
  if (!containerId) return null
  const container = world.pieces[containerId]
  if (container.kind !== 'container') return null

  const behindContainerWall = step(containerPos.x, containerPos.y, dir)
  if (!inBounds(board, behindContainerWall.x, behindContainerWall.y)) return null
  if (board.cells[behindContainerWall.y][behindContainerWall.x].type !== 'wall') return null

  const interior = world.boards[container.boardRef as string]
  const { cell: eatenCell } = getEntryCell(interior, opposite(dir), HALF)
  if (eatenCell === null) return null
  const eatenId = occupantAt(world, { board: interior.id, x: eatenCell.x, y: eatenCell.y })
  if (!eatenId) return null

  const behindPlayer = step(loc.x, loc.y, opposite(dir))
  if (!isOpenFloor(board, behindPlayer.x, behindPlayer.y)) return null
  if (occupantAt(world, { board: loc.board, x: behindPlayer.x, y: behindPlayer.y })) return null

  const next = cloneWorld(world)
  next.locations[PLAYER_ID] = { board: loc.board, x: behindPlayer.x, y: behindPlayer.y }
  next.locations[containerId] = { board: loc.board, x: loc.x + (dir === 'left' ? -1 : dir === 'right' ? 1 : 0), y: loc.y + (dir === 'up' ? -1 : dir === 'down' ? 1 : 0) }
  next.locations[eatenId] = { board: loc.board, x: containerPos.x, y: containerPos.y }
  return next
}
```

Note: `next.locations[containerId]` above is `loc` shifted one step in `dir` — i.e.
exactly `containerPos` computed the same way as the original `step(loc.x, loc.y, dir)`
call; the inline arithmetic is written out to avoid a second call to `step` with
identical inputs. Implementers may factor this into a `step(loc.x, loc.y, dir)` call
instead if clearer — the value is identical either way, `containerPos`.

**Testing oracle for all three:** rather than hand-deriving exact expected coordinates
for every test case (error-prone — a coordinate arithmetic mistake in the spec would go
unnoticed if the test just checks against an equally-mistaken hand-derived expectation),
the primary test for each function is a **round-trip property**: construct a
post-state `W`, call `inverseX(W, dir)` to get a candidate pre-state `P`, assert `P` is
non-null, then assert `applyMove(P, dir)` deep-equals `W`. This directly verifies "this
is a true inverse" using the already-approved, already-tested forward engine as the
oracle, instead of trusting hand arithmetic on both sides.

## `generateLevel.ts` — reverse random walk

```ts
import { Direction, World, cloneWorld } from '../../src/game/engine/types'
import { inverseEat, inverseEnter, inversePush } from './inverseMoves'

const DIRECTIONS: Direction[] = ['up', 'down', 'left', 'right']
const PATTERNS = [inversePush, inverseEnter, inverseEat]

function shuffled<T>(items: T[], rng: () => number): T[] {
  const copy = [...items]
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1))
    ;[copy[i], copy[j]] = [copy[j], copy[i]]
  }
  return copy
}

export function generateLevel(seed: World, steps: number, rng: () => number): World {
  let world = cloneWorld(seed)
  let applied = 0
  let attempts = 0
  const maxAttempts = Math.max(steps, 1) * 20

  while (applied < steps && attempts < maxAttempts) {
    attempts++
    const direction = DIRECTIONS[Math.floor(rng() * DIRECTIONS.length) % DIRECTIONS.length]
    let next: World | null = null
    for (const pattern of shuffled(PATTERNS, rng)) {
      next = pattern(world, direction)
      if (next) break
    }
    if (!next) continue
    world = next
    applied++
  }
  return world
}
```

Each attempt tries all three patterns (in a random order, so no pattern is
systematically favored) for one randomly chosen direction, applying whichever succeeds
first. This mirrors the retired generator's "try a primary pattern, fall back to the
other" structure, generalized from 2 patterns to 3.

## `solver.ts` — BFS plus board-crossing counting

```ts
import { applyMove, checkWin } from '../../src/game/engine/rules'
import { Direction, World } from '../../src/game/engine/types'

const DIRECTIONS: Direction[] = ['up', 'down', 'left', 'right']

function canonicalKey(world: World): string {
  return JSON.stringify(world)
}

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

export function countBoardCrossings(world: World, moves: Direction[]): number {
  let current = world
  let count = 0
  for (const direction of moves) {
    const next = applyMove(current, direction)
    if (!next) throw new Error('countBoardCrossings received an invalid move for this world')
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

`countBoardCrossings` replaces the retired `countNestingEvents`. Instead of watching a
single flat `boxes` array shrink (a signal that doesn't exist in the multi-board
`World` model), it compares every piece's `location.board` before and after each move
in the solution path and counts the move as one "event" if *any* piece's board
assignment changed — matching the old semantics of counting events, not magnitude
(one move that causes multiple pieces to cross boards still counts once, via the
`break`). This single signal covers both `enter` and `eat` without needing to
distinguish which — matches the corresponding brainstorming decision.

## `difficultyScorer.ts`

Unchanged in shape from the retired version — same weight, same tier thresholds, just
renamed to match the new signal's name:

```ts
const BOARD_CROSSING_WEIGHT = 5

export function scoreDifficulty(moveCount: number, boardCrossingCount: number): number {
  return moveCount + boardCrossingCount * BOARD_CROSSING_WEIGHT
}

export function difficultyTier(score: number): 'easy' | 'medium' | 'hard' {
  if (score < 10) return 'easy'
  if (score < 25) return 'medium'
  return 'hard'
}
```

## `generateBatch.ts`

Same orchestration shape as the retired version — including the already-solved-at-load
guard (`!solution || solution.length === 0`), which was a real Critical bug the
retired version originally shipped without, caught only in sub-project 1's final
whole-branch review. That guard is preserved unconditionally in the rewrite, not
re-derived from scratch.

```ts
import { mkdirSync, writeFileSync } from 'node:fs'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { dirname, join } from 'node:path'
import { World } from '../../src/game/engine/types'
import { serializeLevel } from '../../src/game/engine/levelSchema'
import { createSeedWorld } from './seed'
import { generateLevel } from './generateLevel'
import { countBoardCrossings, solve } from './solver'
import { difficultyTier, scoreDifficulty } from './difficultyScorer'

export type Tier = 'easy' | 'medium' | 'hard'

export interface GeneratedLevel {
  tier: Tier
  world: World
  json: string
}

const MAX_ATTEMPTS = 500

export function generateLevelBatch(targetPerTier: number, rng: () => number): GeneratedLevel[] {
  const counts: Record<Tier, number> = { easy: 0, medium: 0, hard: 0 }
  const results: GeneratedLevel[] = []
  let attempts = 0

  while (attempts < MAX_ATTEMPTS && (counts.easy < targetPerTier || counts.medium < targetPerTier || counts.hard < targetPerTier)) {
    attempts++
    const seed = createSeedWorld()
    const steps = 3 + Math.floor(rng() * 8)
    const world = generateLevel(seed, steps, rng)
    const solution = solve(world, 150)
    if (!solution || solution.length === 0) continue

    const boardCrossingCount = countBoardCrossings(world, solution)
    const score = scoreDifficulty(solution.length, boardCrossingCount)
    const tier = difficultyTier(score)
    if (counts[tier] >= targetPerTier) continue

    counts[tier]++
    results.push({ tier, world, json: JSON.stringify(serializeLevel(world)) })
  }

  return results
}

function main() {
  const outputDir = join(dirname(fileURLToPath(import.meta.url)), '../../src/levels/builtin/generated')
  mkdirSync(outputDir, { recursive: true })
  const batch = generateLevelBatch(5, Math.random)
  const tierCounters: Record<Tier, number> = { easy: 0, medium: 0, hard: 0 }
  for (const entry of batch) {
    tierCounters[entry.tier]++
    const filename = `${entry.tier}-${String(tierCounters[entry.tier]).padStart(2, '0')}.json`
    writeFileSync(join(outputDir, filename), entry.json)
  }
  console.log(`Generated ${batch.length} levels: easy=${tierCounters.easy} medium=${tierCounters.medium} hard=${tierCounters.hard}`)
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main()
}
```

Note `serializeLevel(world)` returns the `World` object itself (per sub-project 1's
`levelSchema.ts` — it's `structuredClone(world)`, not a JSON string), so
`generateBatch.ts` must `JSON.stringify` it before writing, unlike the retired version
where `serializeLevel` returned a string directly. The Windows-`file://`-path entry
guard (`pathToFileURL(process.argv[1]).href`) is preserved unchanged — it was a real
bug fix from sub-project 1's Task 20, not something to re-derive.

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
version used for the old format.

## Testing strategy

- `inverseMoves.test.ts`: for each of the three functions, the round-trip property
  described above (`applyMove(inverseX(W, dir), dir)` deep-equals `W`), plus at least
  one case per function where it correctly returns `null` (e.g. `inversePush` with
  nothing open behind the player; `inverseEnter` when the player isn't on a container's
  interior at all; `inverseEat` when there's no wall behind the container).
- `generateLevel.test.ts`: a generated world differs from the seed after a nonzero
  step count; running with `steps: 0` returns a world equal to the seed.
- `solver.test.ts`: an already-won world solves to `[]`; a one-push-away world solves
  to a single direction; an unreachable-within-`maxDepth` world returns `null`.
  `countBoardCrossings` on a hand-built solution path with a known enter/eat move
  returns the expected count (traced by hand, not assumed).
- `difficultyScorer.test.ts`: pure-function boundary tests at the tier thresholds
  (unchanged in shape from the retired version).
- `generateBatch.test.ts`: the already-solved-at-load guard actually skips such levels
  (construct a seed/step combination that reverse-walks back to a solved state, confirm
  it's excluded from the batch); tier bucketing respects `targetPerTier`.
- `levels/index.test.ts`: `loadGeneratedLevels()` against a fixture file under
  `builtin/generated/` parses correctly and the level starts unsolved (same pattern
  already used for `BUILTIN_LEVELS` in sub-project 2).

## Migration note

Files rewritten, not patched: `tools/generator/{seed,inverseMoves,generateLevel,solver,
difficultyScorer,generateBatch}.ts` and their test files. `src/levels/index.ts` is
modified (not rewritten) — only `loadGeneratedLevels()`'s body changes, from `return []`
to the real implementation shown above; `BUILTIN_LEVELS`, `loadCustomLevels`,
`CUSTOM_LEVEL_ID_PREFIX` are untouched. After this sub-project ships, running
`npm run generate:levels` (the existing `package.json` script, already pointed at
`tools/generator/generateBatch.ts`) populates `src/levels/builtin/generated/*.json`,
and those levels appear in the game's level select screen. `src/editor/EditorScreen.tsx`
and `tools/generator`'s dependents in it (if any) remain untouched and
non-compiling — sub-project 3's job.
