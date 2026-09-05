# Parabox PWA — Multi-Goal Seed & Level Pruning (Sub-project 4b)

## Background

Sub-project 4 (solver + level generator rewrite) shipped and merged. Its final review flagged an open, un-fixed limitation: the 10 committed generated levels are near-identical variants of one puzzle, and 7 of 10 never require the container mechanic at all (their optimal solve never crosses a board boundary) — the seed's single win-condition site and lone filler box meant most of what got scrambled was decorative. Separately, the `hard` difficulty tier was found empirically unreachable (score ceiling ~23, threshold 25) because the seed only ever offered up to 2 board-crossing events total.

This sub-project addresses both by changing what the *seed* looks like and adding a post-generation cleanup pass — no changes to the engine (`src/game/engine/*`, already correct and out of scope) and no changes to the core reverse-walk/solver algorithms (`inverseMoves.ts`, `generateLevel.ts`, `solver.ts`, `canonicalKey`), which already operate generically over whatever `World` they're handed.

## Scope

**In scope:**
- `tools/generator/seed.ts`: rewritten to seed 3 or 4 independent, self-contained goal groups (container + its own pre-placed box + its own win-condition cell) on a bigger board, each group's container given a randomized wall-adjacent side (for `enter`/`eat` reachability) and a randomized interior board size (3 or 5), placed in a fixed, non-overlapping slot grid.
- A new `tools/generator/pruneUntouchedGoals.ts`: after the reverse walk runs, any goal group whose container is still exactly at its original seed position gets removed entirely (container piece, its interior board, whatever's inside it, and its win-condition cell) — it was never disturbed, so it contributes nothing to solving and would only pad the level with decoration.
- `tools/generator/generateBatch.ts`: wire the new seed shape and the new prune step into the pipeline, ahead of the existing `checkWin`/duplicate/solve/score checks (which need no logic changes — they already operate correctly on "whatever `World` they're handed," and pruning happens before them).
- `tools/generator/seed.test.ts`, a new `pruneUntouchedGoals.test.ts`, and `generateBatch.test.ts`: updated/added for the new shapes.

**Explicitly out of scope:**
- Any change to `src/game/engine/*` — already supports everything this needs (arbitrary board sizes, multiple simultaneous requirement cells) and is unrelated to this sub-project.
- Any change to `inverseMoves.ts`, `generateLevel.ts`, `solver.ts`, `canonical.ts`, `difficultyScorer.ts` — all four already operate generically over an arbitrary `World`; none of them know or need to know how many goal groups exist.
- Free-form/randomized placement of goal groups (collision detection, retry loops). See "Why a fixed slot grid" below.
- Randomizing the *number* of grid rows/columns, or the overall board size beyond what's needed for 3–4 groups. Interior-size and group-count randomization already deliver the variety asked for; further scale randomization is a separate future ask, not this one.
- Re-tuning `difficultyScorer.ts`'s tier thresholds. More groups mean more possible crossing events (up to 2 per group instead of a hard cap of ~2 total), which may make `hard` reachable as a side effect — that's worth checking empirically during implementation, but the thresholds themselves are a difficulty *definition*, not something this spec changes preemptively.

## Why a fixed slot grid, not free-form placement

Sub-project 4's own history is the argument here: hand-derived geometry for even a *single* wall-adjacent container needed two separate correction rounds after integration testing (a player start position one cell from a border, and an `inversePush` bug that only manifested near walls) despite careful hand-tracing at each step. Free-form random placement of 3–4 independent groups — checking each new candidate position against every previously placed group, retrying on collision — multiplies that class of risk considerably for a benefit (more organic-looking layouts) that doesn't matter to the actual goal (more solving variety).

Instead, the root board is divided into a fixed 2×2 grid of non-overlapping 5×5 slots (using 3 of the 4 slots when `groupCount` is 3). Every slot is geometrically identical: a container sits at the exact center of its slot, 2 cells of buffer floor separate it from every board edge and from every other slot's slot boundary, and its one randomized wall side is guaranteed to land inside the same slot's own bounds no matter which of the 4 directions is chosen (a center cell with a 2-cell margin in a 5-wide slot has room in every direction). This eliminates cross-group interference **by construction** — no runtime collision check is needed because the grid math makes overlap geometrically impossible — while still randomizing wall side and interior size per group for real variety.

## `seed.ts` — multi-goal seed

```ts
import {
  Cell, Direction, PLAYER_ID, World,
  step, opposite,
} from '../../src/game/engine/types'
import { getEntryCell } from '../../src/game/engine/rules'
import { HALF } from '../../src/game/engine/fraction'

// A 2x2 grid of slots (square, so GRID_COLS alone determines ROOT_SIZE —
// groupCount is always 3 or 4, and ceil(3/GRID_COLS) === ceil(4/GRID_COLS)
// === 2 rows for GRID_COLS=2, so the board never needs to vary in size).
const GRID_COLS = 2
const SLOT_SIZE = 5
const ROOT_SIZE = 2 + GRID_COLS * SLOT_SIZE // = 12
const INTERIOR_SIZES = [3, 5]
const DIRECTIONS: Direction[] = ['up', 'down', 'left', 'right']

function makeFloorCells(size: number): Cell[][] {
  return Array.from({ length: size }, () => Array.from({ length: size }, () => ({ type: 'floor' as const })))
}

export interface SeedGroup {
  containerId: string
  originalPosition: { x: number; y: number }
}

export interface SeedResult {
  world: World
  groups: SeedGroup[]
}

export function createSeedWorld(rng: () => number = Math.random): SeedResult {
  const groupCount = 3 + Math.floor(rng() * 2) // 3 or 4

  const cells: Cell[][] = Array.from({ length: ROOT_SIZE }, (_, y) =>
    Array.from({ length: ROOT_SIZE }, (_, x) => {
      const isBorder = x === 0 || y === 0 || x === ROOT_SIZE - 1 || y === ROOT_SIZE - 1
      return { type: isBorder ? 'wall' : 'floor' } as Cell
    }),
  )

  const boards: World['boards'] = {}
  const pieces: World['pieces'] = { [PLAYER_ID]: { id: PLAYER_ID, kind: 'player' } }
  const locations: World['locations'] = {}
  const groups: SeedGroup[] = []

  for (let i = 0; i < groupCount; i++) {
    const row = Math.floor(i / GRID_COLS)
    const col = i % GRID_COLS
    const slotOriginX = 1 + col * SLOT_SIZE
    const slotOriginY = 1 + row * SLOT_SIZE
    const center = Math.floor(SLOT_SIZE / 2) // = 2
    const containerX = slotOriginX + center
    const containerY = slotOriginY + center

    const wallDir = DIRECTIONS[Math.floor(rng() * DIRECTIONS.length)]
    const wallPos = step(containerX, containerY, wallDir)
    cells[wallPos.y][wallPos.x] = { type: 'wall' }
    cells[containerY][containerX] = { type: 'floor', requirement: 'box' }

    const interiorSize = INTERIOR_SIZES[Math.floor(rng() * INTERIOR_SIZES.length)]
    const interiorId = `goal${i}Inside`
    const containerId = `goal${i}`
    const boxId = `box${i}`

    boards[interiorId] = { id: interiorId, size: interiorSize, cells: makeFloorCells(interiorSize) }
    pieces[containerId] = { id: containerId, kind: 'container', boardRef: interiorId }
    pieces[boxId] = { id: boxId, kind: 'normal' }
    locations[containerId] = { board: 'root', x: containerX, y: containerY }

    const { cell: eatenCell } = getEntryCell(boards[interiorId], opposite(wallDir), HALF)
    // eatenCell is guaranteed non-null: HALF always maps to an in-bounds
    // center-of-edge cell for any board size >= 1 (verified for size 3 in
    // sub-project 4's Tasks 4-5, and by the same reasoning for size 5 here
    // — this is the exact hand-check the implementation plan must repeat).
    locations[boxId] = { board: interiorId, x: eatenCell!.x, y: eatenCell!.y }

    groups.push({ containerId, originalPosition: { x: containerX, y: containerY } })
  }

  boards.root = { id: 'root', size: ROOT_SIZE, cells }
  // Slot (0,0)'s container sits at (1+2, 1+2) = (3,3); the player goes at
  // (2,2) — 2 cells from every board edge (the safe minimum this project
  // learned the hard way) and off the diagonal from the container, so it
  // never coincides with that group's wall regardless of which of the 4
  // directions was randomly chosen for it.
  locations[PLAYER_ID] = { board: 'root', x: 2, y: 2 }

  return { world: { boards, pieces, locations }, groups }
}
```

Hand-verified before writing this code (same practice as sub-project 4's own spec):
- **All 4 slot positions stay clear of the outer border regardless of grid position.** Slot origins are `(1,1)`, `(6,1)`, `(1,6)`, `(6,6)`; every slot's center container is therefore at least 3 cells from the border on every axis (e.g. slot `(1,1)`'s container at `(3,3)` is 3 cells from the `x=0`/`y=0` border and `11-3=8` cells from the `x=11`/`y=11` border) — comfortably clear of the "2 cells minimum" rule this project already had to learn the hard way in sub-project 4.
- **A center-of-slot container's wall never leaves its own slot.** With `SLOT_SIZE = 5` and the container at the slot's exact center (local offset `(2,2)`, 0-indexed), stepping one cell in any of the 4 directions lands at local `(1,2)`, `(3,2)`, `(2,1)`, or `(2,3)` — all within the slot's own `[0,4]×[0,4]` local range. No wall placement can spill into a neighboring slot or the board border.
- **`getEntryCell` at size 5 behaves the same way as the already-verified size-3 case.** For `HALF = 1/2` and `unit = 1/5`: `fractionDivMod` gives `offset = 2`, `remainder = 1/10` (nonzero) — e.g. for `dir = 'right'`, `cell = { x: 0, y: offset } = (0, 2)`; for `'left'`, `(4, 2)`; for `'up'`, `(2, 4)`; for `'down'`, `(2, 0)`. All four are in-bounds, non-degenerate center-of-edge cells, consistent with the already-tested size-3 result — the formula is a straightforward affine scaling with no special-cased dependency on size 3.
- **The old `box2`-style plain filler piece is gone.** With 3–4 independent, genuinely load-bearing goal groups, a decorative extra piece is no longer needed for push-chain variety — multi-piece chains can already occur incidentally between adjacent groups' own pieces when they happen to align.

## `pruneUntouchedGoals.ts` — remove decoration after the walk

```ts
import { World, cloneWorld } from '../../src/game/engine/types'
import { SeedGroup } from './seed'

function removeGroup(world: World, containerId: string): World {
  const next = cloneWorld(world)
  const container = next.pieces[containerId]
  const loc = next.locations[containerId]

  if (container.boardRef !== undefined) {
    const interiorId = container.boardRef
    for (const [pieceId, pieceLoc] of Object.entries(next.locations)) {
      if (pieceLoc.board === interiorId) {
        delete next.pieces[pieceId]
        delete next.locations[pieceId]
      }
    }
    delete next.boards[interiorId]
  }

  const board = next.boards[loc.board]
  board.cells[loc.y][loc.x] = { type: board.cells[loc.y][loc.x].type }
  delete next.pieces[containerId]
  delete next.locations[containerId]

  return next
}

// A group whose container is still exactly at its seed-time position was
// never disturbed by the reverse walk — its own win-condition cell is
// therefore still satisfied, meaning it contributes nothing to what a
// solver would actually need to do. Removing it whole (container, its
// interior board, whatever's inside it, and its requirement cell) leaves
// only groups that are genuinely part of the puzzle: every KEPT group's
// requirement is, by construction, currently unsatisfied (that's the
// opposite of the removal condition), so checkWin() on the pruned result
// is false unless every group got pruned — which is exactly the
// already-handled "level came out pre-solved" case generateBatch.ts
// already discards.
export function pruneUntouchedGoals(world: World, groups: SeedGroup[]): World {
  let next = world
  for (const group of groups) {
    const current = next.locations[group.containerId]
    if (
      current.board === 'root' &&
      current.x === group.originalPosition.x &&
      current.y === group.originalPosition.y
    ) {
      next = removeGroup(next, group.containerId)
    }
  }
  return next
}
```

`SeedGroup` only needs `containerId` and `originalPosition` — a container's `boardRef` never changes during the reverse walk (none of `inversePush`/`inverseEnter`/`inverseEat` ever mutate `pieces`, only `locations`), so `removeGroup` looks it up fresh from the current world rather than needing it passed in.

**Why this is correct without touching `checkWin`, `solve`, `scoreDifficulty`, or `countCrossingMoves` at all:** every one of those functions already operates on "whatever `World` it's handed" — none of them know or care how many goal groups exist. Pruning happens once, right after `generateLevel` returns and before any of the existing checks, so everything downstream sees a `World` where every remaining goal is genuinely load-bearing. This is the same principle sub-project 4 already established for the inverse-move functions ("forward engine is the source of truth") applied one level up: here, the *engine's own win-condition check* is the source of truth for whether a group did anything, not a separate tracking mechanism.

## `generateBatch.ts` — wiring

```ts
import { createSeedWorld } from './seed'
import { pruneUntouchedGoals } from './pruneUntouchedGoals'
// ...(other imports unchanged)

// inside generateLevelBatch's loop, replacing the old seed/generate block:
    const { world: seed, groups } = createSeedWorld(rng)
    const steps = 3 + Math.floor(rng() * 20)
    const generated = generateLevel(seed, steps, rng)
    if (!generated) {
      stats.discardedGenerationFailed++
      continue
    }
    const world = pruneUntouchedGoals(generated.world, groups)

    if (checkWin(world)) {
      stats.discardedAlreadySolved++
      continue
    }
    // ...(everything from here on is unchanged — canonicalKey dedup,
    // solve(), countCrossingMoves(), scoreDifficulty(), tier bucketing —
    // all of it already operates on `world` generically)
```

No other line in `generateLevelBatch` changes. `main()` is untouched.

## Expected effects on generation quality (to verify empirically, not assumed)

- Every accepted level should now have at least one, and often 2-4, genuinely necessary board-crossing interactions — the "7 of 10 levels never use the container mechanic" finding should not recur, since an untouched group is removed rather than shipped as decoration.
- The achievable `crossingMoveCount` ceiling should rise from ~2 (one group) to potentially 6-8 (up to 2 events × 3-4 groups), which may make the `hard` tier reachable as a side effect. This is a plausible outcome given the mechanism, not a guarantee — verify with the same kind of diagnostic sweep sub-project 4's Task 11 used before assuming it.
- Bigger board (12×12 vs. 7×7) and more pieces (up to 9 vs. 5) will likely slow `solve()`'s BFS and `generateLevel`'s reverse walk somewhat. `generateBatch.ts`'s `MAX_ATTEMPTS`/`steps` range may need re-tuning the same way sub-project 4's did — expect this, don't be surprised by it.

## Testing strategy

- **`seed.test.ts`** (rewritten for the new signature and return shape): `checkWin(createSeedWorld(rng).world)` is `true` for several different `rng` draws (covering both `groupCount` values, 3 and 4); `parseLevel(serializeLevel(world))` doesn't throw for the same draws; `groups.length` matches the `groupCount` actually produced; every group's `container` really sits at `originalPosition` on `root` with a `requirement: 'box'` cell there at seed time; every group's wall cell and every other group's cells are mutually distinct (no two groups' geometry overlaps) — check this directly by collecting every wall/container coordinate across all groups for a given draw and asserting no duplicates.
- **`pruneUntouchedGoals.test.ts`** (new): a hand-built 2-group world where group A's container is still at its `originalPosition` and group B's has moved — pruning removes group A's container/interior/box/requirement entirely and leaves group B fully intact; pruning a world where every group is untouched removes all of them (and the result still passes `parseLevel`); the result of `pruneUntouchedGoals` always passes `parseLevel` validation (ownership/reachability/no-overlap all still hold after removal) for at least one nontrivial multi-group case.
- **`generateBatch.test.ts`** (updated call sites only — its existing property-based assertions don't need to change in kind): the four existing tests (`complete`/quota reporting, unsolved+parseable levels, no duplicate canonical states, stats accounting) should hold unchanged in spirit against the new pipeline.
- **New diagnostic step in the implementation plan (not a committed test):** before treating the new seed as done, run the same kind of direct sampling sub-project 4's Task 11 used — call `generateLevel`/`pruneUntouchedGoals`/`solve` directly across a range of `rng` seeds and step counts, and confirm (a) the reverse walk can reach the requested step count a reasonable fraction of the time from the new, larger seed, and (b) at least some fraction of accepted levels have `crossingMoveCount >= 2`. If either comes back far worse than sub-project 4's original 2-group seed, that's a signal to revisit `SLOT_SIZE`, `steps`, or `MAX_ATTEMPTS` before committing generated output — exactly the empirical-validation discipline sub-project 4 already established.

## Migration note

Files rewritten: `tools/generator/seed.ts` (signature change: `createSeedWorld` now takes an optional `rng` parameter and returns `SeedResult` instead of a bare `World`), `tools/generator/seed.test.ts`. New file: `tools/generator/pruneUntouchedGoals.ts` and its test. `tools/generator/generateBatch.ts` is modified only at its seed-creation and post-`generateLevel` lines, per the wiring section above — everything else in that file (the discard-reason stats, duplicate detection, scoring, tier bucketing, `main()`'s overwrite policy and reporting) is untouched. `inverseMoves.ts`, `generateLevel.ts`, `solver.ts`, `canonical.ts`, `difficultyScorer.ts`, and every file under `src/` are untouched by this sub-project.

`createSeedWorld`'s signature change is a breaking change for its one other existing caller: `generateLevel.test.ts` (from sub-project 4) calls `createSeedWorld()` directly and passes the result straight into `generateLevel(seed, steps, rng)`, expecting a bare `World`. Every such call site must change to `createSeedWorld().world` (the test doesn't need `groups` — pruning is `generateBatch.ts`'s concern, not `generateLevel`'s). This file is not otherwise in this sub-project's scope; the implementation plan must still include this one call-site fix so `generateLevel.test.ts` keeps compiling and passing.

The previously-committed `src/levels/builtin/generated/*.json` will be replaced wholesale the next time `npm run generate:levels` runs (per the existing overwrite policy) — this is expected, not a regression.
