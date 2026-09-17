# Random-Generate + Solve Generator Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the reverse-walk Parabox level generator with a random-generate → validate → solve → analyze → filter → save pipeline, as specified in the linked design doc.

**Architecture:** Four new modules (`randomGenerator.ts`, `basicValidator.ts`, `difficultyAnalyzer.ts`, `filter.ts`) feed a rewritten `generateBatch.ts` main loop; `solver.ts` gains one additive field (per-state branching factor) with no change to its existing search behavior or return contract's existing fields; fourteen reverse-walk-specific files are deleted once the new pipeline is proven out.

**Tech Stack:** TypeScript, Vitest, tsx (for running the generator script directly), the existing `src/game/engine/*` World/Board/Piece model (untouched).

**Spec:** `docs/superpowers/specs/2026-09-18-parabox-generator-random-solve-redesign.md`

## Global Constraints

- Only existing engine capabilities: `container` pieces with a `boardRef`, nested arbitrarily deep. No clone/possess. No generated cycles/self-reference (the engine's schema layer — `levelSchema.ts` — already tolerates a cycle in principle, but this generator never produces one; `basicValidator.ts` defensively rejects one if a bug ever creates it).
- Goals are always 1:1 with boxes (no shared/either-or goals) in this round.
- Every board is square (`Board.size x Board.size`) — this engine has no separate width/height per board, unlike the md's own example config, which assumes one.
- Tier threshold NUMBERS are not decided until Task 9's diagnostic pass runs against real generator output — every other task must not hardcode a guessed threshold.
- Every new/modified file gets real tests before being wired into `generateBatch.ts`.
- `git add`/`git commit` after each task (per Task Right-Sizing) — check `git status` before committing to confirm only the intended files are staged.
- Every commit message in this plan ends with:
  ```
  Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
  Claude-Session: https://claude.ai/code/session_01WZvm6XFks26PNA8PfypCxy
  ```

---

### Task 1: Solver branching-factor enrichment

**Files:**
- Modify: `tools/generator/solver.ts`
- Modify: `tools/generator/solver.test.ts`

**Interfaces:**
- Produces: `SolveResult.branchingFactors: number[]` — `branchingFactors[i]` is the count of the 4 directions that produced a valid (non-null) next state when the i-th expanded state (0-indexed, in expansion order) was expanded. `branchingFactors.length === expandedStates` always.

- [ ] **Step 1: Write the failing tests**

Add to `tools/generator/solver.test.ts` (near the other `solve` tests, after the "finds the shortest path" test):

```ts
test('branchingFactors has exactly one entry per expanded state, in expansion order', () => {
  // Forced 1-wide corridor: from every state, exactly one direction is
  // ever legal (walking backward is the only "other" option, but this
  // world never backtracks during BFS's forward exploration since visited
  // states are never re-expanded) — width-4 interior corridor, box needs
  // exactly 2 pushes.
  const size = 6
  const cells = Array.from({ length: size }, (_, y) =>
    Array.from({ length: size }, (_, x) => ({
      type: (y === 2 && x >= 1 && x <= 4 ? 'floor' : 'wall') as const,
    })),
  )
  cells[2][4] = { type: 'floor', requirement: 'box' }
  const world: World = {
    boards: { root: { id: 'root', size, cells } },
    pieces: { player: { id: 'player', kind: 'player' }, box1: { id: 'box1', kind: 'normal' } },
    locations: { player: { board: 'root', x: 1, y: 2 }, box1: { board: 'root', x: 2, y: 2 } },
  }
  const result = solve(world)!
  expect(result.moves).toEqual(['right', 'right'])
  expect(result.branchingFactors).toHaveLength(result.expandedStates)
  // Every expanded state in this 1-wide corridor has exactly 1 legal move
  // (forward — backward is never explored since BFS never re-expands the
  // start state, and there is no other direction at all here).
  expect(result.branchingFactors.every((b) => b === 1)).toBe(true)
})

test('branchingFactors is empty for an already-won world (0 expanded states)', () => {
  const world: World = {
    boards: {
      root: {
        id: 'root', size: 3,
        cells: [
          [{ type: 'floor' }, { type: 'floor' }, { type: 'floor' }],
          [{ type: 'floor' }, { type: 'floor' }, { type: 'floor', requirement: 'box' }],
          [{ type: 'floor' }, { type: 'floor' }, { type: 'floor' }],
        ],
      },
    },
    pieces: { player: { id: 'player', kind: 'player' }, box1: { id: 'box1', kind: 'normal' } },
    locations: { player: { board: 'root', x: 0, y: 1 }, box1: { board: 'root', x: 2, y: 1 } },
  }
  const result = solve(world)!
  expect(result.branchingFactors).toEqual([])
})

test('branchingFactors counts all 4 directions independent of visited-state pruning', () => {
  // Open 5x5 room, box already one push from its goal — the start state
  // has up to 4 legal directions (bounded by the border), not fewer just
  // because some neighbors get visited/pruned later in the search.
  const size = 5
  const cells: Cell[][] = Array.from({ length: size }, () =>
    Array.from({ length: size }, () => ({ type: 'floor' as const })),
  )
  cells[2][3] = { type: 'floor', requirement: 'box' }
  const world: World = {
    boards: { root: { id: 'root', size, cells } },
    pieces: { player: { id: 'player', kind: 'player' }, box1: { id: 'box1', kind: 'normal' } },
    locations: { player: { board: 'root', x: 1, y: 2 }, box1: { board: 'root', x: 2, y: 2 } },
  }
  const result = solve(world)!
  // The very first expanded state (the initial world) has 4 legal moves:
  // up/down/left/right all land on in-bounds floor (row/col 1 and 3 are
  // clear of the border at size 5).
  expect(result.branchingFactors[0]).toBe(4)
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tools/generator/solver.test.ts`
Expected: FAIL — `Property 'branchingFactors' does not exist on type 'SolveResult'` (TypeScript) or the field is `undefined` at runtime.

- [ ] **Step 3: Implement the enrichment**

In `tools/generator/solver.ts`, change the `SolveResult` interface and `solve()` body:

```ts
export interface SolveResult {
  moves: Direction[]
  expandedStates: number
  maxFrontierSize: number
  visitedStates: number
  // branchingFactors[i] = number of the 4 directions that produced a valid
  // (non-null) next state when the i-th expanded state was expanded, in
  // expansion order. Length === expandedStates always. Computed by trying
  // all 4 directions BEFORE checking any of them for a win or for having
  // been visited before, so it always reflects the true count of legal
  // actions from that state — not reduced by which neighbors happen to be
  // new or which one happens to win. Feeds difficultyAnalyzer.ts's
  // avgBranching/maxBranching/deadEndRatio.
  branchingFactors: number[]
}

export function solve(initialWorld: World, maxDepth = 200, maxExpandedStates = Infinity): SolveResult | null {
  if (checkWin(initialWorld)) {
    return { moves: [], expandedStates: 0, maxFrontierSize: 1, visitedStates: 1, branchingFactors: [] }
  }

  const visited = new Set<string>([canonicalKey(initialWorld)])
  let frontier: { world: World; path: Direction[] }[] = [{ world: initialWorld, path: [] }]
  let depth = 0
  let expandedStates = 0
  let maxFrontierSize = frontier.length
  const branchingFactors: number[] = []

  while (frontier.length > 0 && depth < maxDepth) {
    maxFrontierSize = Math.max(maxFrontierSize, frontier.length)
    const nextFrontier: typeof frontier = []
    for (const { world, path } of frontier) {
      if (expandedStates >= maxExpandedStates) return null
      expandedStates++

      const validNexts: { direction: Direction; next: World }[] = []
      for (const direction of DIRECTIONS) {
        const next = applyMove(world, direction)
        if (next) validNexts.push({ direction, next })
      }
      branchingFactors.push(validNexts.length)

      for (const { direction, next } of validNexts) {
        const key = canonicalKey(next)
        if (visited.has(key)) continue
        visited.add(key)
        const newPath = [...path, direction]
        if (checkWin(next)) {
          return { moves: newPath, expandedStates, maxFrontierSize, visitedStates: visited.size, branchingFactors }
        }
        nextFrontier.push({ world: next, path: newPath })
      }
    }
    frontier = nextFrontier
    depth++
  }
  return null
}
```

Also delete `countGroupsUsed` and `countFillerBoxesUsed` (both take a `SeedGroup`/filler-id-list that belongs to the deleted reverse-walk model) and the now-unused `import { SeedGroup } from './seed'` line at the top of the file.

- [ ] **Step 4: Update solver.test.ts to drop the deleted functions' tests**

Remove these three tests from `tools/generator/solver.test.ts` (they test `countGroupsUsed`/`countFillerBoxesUsed`, both deleted in Step 3):
- `'countGroupsUsed counts a group whose container or box moved, and does not throw on a group missing from the world'`
- `'countGroupsUsed counts a two-box group as used when only the second box moves, and only once when both move'`
- `'countFillerBoxesUsed counts a filler box only if it actually moves, and does not throw for a missing id'`

Remove `countFillerBoxesUsed, countGroupsUsed` from the import line at the top of the file, and remove `import { SeedGroup } from './seed'`.

- [ ] **Step 5: Run tests to verify they pass**

Run: `npx vitest run tools/generator/solver.test.ts`
Expected: PASS, all tests green.

- [ ] **Step 6: Commit**

```bash
git add tools/generator/solver.ts tools/generator/solver.test.ts
git commit -m "feat(generator): track per-state branching factor in solve()

Additive field on SolveResult, no change to existing search behavior or
return fields. Feeds the new difficultyAnalyzer.ts's avgBranching/
maxBranching/deadEndRatio metrics (see the redesign spec). Also deletes
countGroupsUsed/countFillerBoxesUsed — both took a SeedGroup/filler-id-list
from the reverse-walk model being replaced this round.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01WZvm6XFks26PNA8PfypCxy"
```

---

### Task 2: Random generator

**Files:**
- Create: `tools/generator/randomGenerator.ts`
- Create: `tools/generator/randomGenerator.test.ts`

**Interfaces:**
- Consumes: `World`, `Board`, `Cell`, `Piece`, `Direction`, `PLAYER_ID`, `inBounds`, `step`, `occupantAt`, `findContainerFor` from `../../src/game/engine/types`.
- Produces: `RandomGeneratorConfig` interface, `GeneratedCandidate { world: World }`, `randomGenerate(config, rng): GeneratedCandidate | null`.

- [ ] **Step 1: Write the failing tests**

Create `tools/generator/randomGenerator.test.ts`:

```ts
import { findContainerFor, inBounds, World } from '../../src/game/engine/types'
import { RandomGeneratorConfig, randomGenerate } from './randomGenerator'

function baseConfig(overrides: Partial<RandomGeneratorConfig> = {}): RandomGeneratorConfig {
  return {
    widthRange: [8, 8],
    heightRange: [8, 8],
    wallDensityRange: [0, 0],
    boxCountRange: [3, 3],
    containerProbability: 0,
    crossBoardGoalProbability: 0,
    interiorSizeRange: [3, 3],
    maxNestingDepth: 2,
    ...overrides,
  }
}

test('board size uses max(width, height), each drawn independently from its own range', () => {
  const config = baseConfig({ widthRange: [4, 4], heightRange: [7, 7], boxCountRange: [0, 0] })
  const result = randomGenerate(config, () => 0)
  expect(result).not.toBeNull()
  expect(result!.world.boards.root.size).toBe(7)
})

test('returns null when wallDensity 1 leaves no floor cells at all', () => {
  const config = baseConfig({ wallDensityRange: [1, 1], boxCountRange: [0, 0], containerProbability: 0 })
  expect(randomGenerate(config, Math.random)).toBeNull()
})

test('containerProbability 0 never creates a container piece', () => {
  const config = baseConfig({ containerProbability: 0 })
  const result = randomGenerate(config, Math.random)
  expect(result).not.toBeNull()
  const containers = Object.values(result!.world.pieces).filter((p) => p.kind === 'container')
  expect(containers).toHaveLength(0)
  expect(Object.keys(result!.world.boards)).toEqual(['root'])
})

test('crossBoardGoalProbability 0 places every goal on some box\'s own home board', () => {
  const config = baseConfig({ containerProbability: 0.5, crossBoardGoalProbability: 0, interiorSizeRange: [4, 4] })
  const result = randomGenerate(config, Math.random)
  expect(result).not.toBeNull()
  const { world } = result!
  const boxes = Object.values(world.pieces).filter((p) => p.kind === 'normal')
  const homeBoards = new Set(boxes.map((b) => world.locations[b.id].board))
  let totalGoals = 0
  let homeBoardGoals = 0
  for (const [boardId, board] of Object.entries(world.boards)) {
    const goalsHere = board.cells.flat().filter((c) => c.requirement === 'box').length
    totalGoals += goalsHere
    if (homeBoards.has(boardId)) homeBoardGoals += goalsHere
  }
  expect(totalGoals).toBe(homeBoardGoals)
})

test('every generated container is blocked on at least one side (enterable)', () => {
  const config = baseConfig({ boxCountRange: [4, 4], containerProbability: 1, crossBoardGoalProbability: 0.5, interiorSizeRange: [3, 5] })
  const result = randomGenerate(config, Math.random)
  expect(result).not.toBeNull()
  const { world } = result!
  for (const piece of Object.values(world.pieces)) {
    if (piece.kind !== 'container') continue
    const loc = world.locations[piece.id]
    const board = world.boards[loc.board]
    const neighbors = [[0, -1], [0, 1], [-1, 0], [1, 0]]
    const blocked = neighbors.some(([dx, dy]) => {
      const nx = loc.x + dx, ny = loc.y + dy
      return !inBounds(board, nx, ny) || board.cells[ny][nx].type === 'wall'
    })
    expect(blocked).toBe(true)
  }
})

test('maxNestingDepth caps how many levels of container nesting are created', () => {
  const config = baseConfig({ boxCountRange: [6, 6], containerProbability: 1, interiorSizeRange: [3, 3], maxNestingDepth: 1 })
  const result = randomGenerate(config, Math.random)
  expect(result).not.toBeNull()
  const { world } = result!
  function depthOf(boardId: string): number {
    let depth = 0
    let current = boardId
    while (current !== 'root') {
      const owner = findContainerFor(world, current)
      if (owner === undefined) break
      current = world.locations[owner].board
      depth++
    }
    return depth
  }
  for (const boardId of Object.keys(world.boards)) {
    expect(depthOf(boardId)).toBeLessThanOrEqual(config.maxNestingDepth)
  }
})

test('the player piece exists on a floor cell of the root board', () => {
  const config = baseConfig()
  const result = randomGenerate(config, Math.random)
  expect(result).not.toBeNull()
  const { world } = result!
  const loc = world.locations.player
  expect(loc.board).toBe('root')
  expect(world.boards.root.cells[loc.y][loc.x].type).toBe('floor')
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tools/generator/randomGenerator.test.ts`
Expected: FAIL — `Cannot find module './randomGenerator'`.

- [ ] **Step 3: Implement `randomGenerator.ts`**

```ts
import { Board, Cell, Direction, PLAYER_ID, World, inBounds, occupantAt, step } from '../../src/game/engine/types'

// Every randomizable range/probability the design spec's §4/§9 calls for.
// Starting values live in generatorConfig.ts, not here — this module is
// pure generation logic, agnostic to what the numbers actually are.
export interface RandomGeneratorConfig {
  widthRange: [number, number]
  heightRange: [number, number]
  wallDensityRange: [number, number]
  boxCountRange: [number, number]
  containerProbability: number
  crossBoardGoalProbability: number
  interiorSizeRange: [number, number]
  maxNestingDepth: number
}

export interface GeneratedCandidate {
  world: World
}

const DIRECTIONS: Direction[] = ['up', 'down', 'left', 'right']

function randInt(rng: () => number, min: number, max: number): number {
  return min + Math.floor(rng() * (max - min + 1))
}

function randFloat(rng: () => number, min: number, max: number): number {
  return min + rng() * (max - min)
}

function makeBoard(id: string, size: number, wallDensity: number, rng: () => number): Board {
  const cells: Cell[][] = Array.from({ length: size }, (_, y) =>
    Array.from({ length: size }, (_, x): Cell => {
      const isBorder = x === 0 || y === 0 || x === size - 1 || y === size - 1
      if (isBorder) return { type: 'wall' }
      return { type: rng() < wallDensity ? 'wall' : 'floor' }
    }),
  )
  return { id, size, cells }
}

// Floor cells with no requirement filter — used when placing a GOAL, which
// is a cell property and may legitimately coincide with a piece (that
// piece then incidentally already satisfies the requirement, which is
// valid, not an error).
function floorCells(board: Board): { x: number; y: number }[] {
  const cells: { x: number; y: number }[] = []
  for (let y = 0; y < board.size; y++) {
    for (let x = 0; x < board.size; x++) {
      if (board.cells[y][x].type === 'floor') cells.push({ x, y })
    }
  }
  return cells
}

// Floor cells with no current piece occupant — used for placing a PIECE
// (player/box/container), so two pieces don't land on the same cell purely
// by bad luck. This is a generator-side quality improvement, not a
// correctness requirement (basicValidator.ts still catches an overlap if
// one ever slips through), matching the design brief's own §4 Step 4 goal
// of not generating "obviously illegal overlaps" even before validation.
function unoccupiedFloorCells(world: World, board: Board): { x: number; y: number }[] {
  return floorCells(board).filter((c) => occupantAt(world, { board: board.id, x: c.x, y: c.y }) === undefined)
}

interface BoardEntry {
  id: string
  board: Board
  depth: number
}

export function randomGenerate(config: RandomGeneratorConfig, rng: () => number): GeneratedCandidate | null {
  const width = randInt(rng, config.widthRange[0], config.widthRange[1])
  const height = randInt(rng, config.heightRange[0], config.heightRange[1])
  const wallDensity = randFloat(rng, config.wallDensityRange[0], config.wallDensityRange[1])
  // Every board in this engine is square (Board.size) — use the larger of
  // width/height, since the design brief's own independent width/height
  // assumes a rectangular-grid engine this codebase doesn't have.
  const size = Math.max(width, height)
  const root = makeBoard('root', size, wallDensity, rng)

  const world: World = { boards: { root }, pieces: {}, locations: {} }
  world.pieces[PLAYER_ID] = { id: PLAYER_ID, kind: 'player' }

  const rootPlacementCells = unoccupiedFloorCells(world, root)
  if (rootPlacementCells.length === 0) return null
  const playerCell = rootPlacementCells[randInt(rng, 0, rootPlacementCells.length - 1)]
  world.locations[PLAYER_ID] = { board: 'root', x: playerCell.x, y: playerCell.y }

  const boards: BoardEntry[] = [{ id: 'root', board: root, depth: 0 }]
  let interiorCounter = 0
  let containerCounter = 0
  const boxCount = randInt(rng, config.boxCountRange[0], config.boxCountRange[1])

  for (let i = 0; i < boxCount; i++) {
    const boxId = `box${i}`
    const belowMaxDepth = boards.filter((b) => b.depth < config.maxNestingDepth)
    let homeBoardId: string

    if (belowMaxDepth.length > 0 && rng() < config.containerProbability) {
      const parent = belowMaxDepth[randInt(rng, 0, belowMaxDepth.length - 1)]
      const parentCells = unoccupiedFloorCells(world, parent.board)
      if (parentCells.length === 0) return null
      const containerCell = parentCells[randInt(rng, 0, parentCells.length - 1)]

      // Container-blockability fact (see the design spec §3/§5): a
      // container with open floor on all 4 sides can only ever be pushed,
      // never entered (resolveBlocked tries pushing the container further
      // BEFORE trying to enter it). Force a wall directly behind it in one
      // random direction so it's always enterable from at least that side.
      const blockDir = DIRECTIONS[randInt(rng, 0, DIRECTIONS.length - 1)]
      const behind = step(containerCell.x, containerCell.y, blockDir)
      if (inBounds(parent.board, behind.x, behind.y)) {
        parent.board.cells[behind.y][behind.x] = { type: 'wall' }
      } // else: the board edge already blocks it, nothing to do

      const interiorSize = randInt(rng, config.interiorSizeRange[0], config.interiorSizeRange[1])
      const interiorId = `interior${interiorCounter++}`
      const interior = makeBoard(interiorId, interiorSize, wallDensity, rng)
      world.boards[interiorId] = interior
      boards.push({ id: interiorId, board: interior, depth: parent.depth + 1 })

      const interiorCells = unoccupiedFloorCells(world, interior)
      if (interiorCells.length === 0) return null
      const boxCell = interiorCells[randInt(rng, 0, interiorCells.length - 1)]

      const containerId = `container${containerCounter++}`
      world.pieces[containerId] = { id: containerId, kind: 'container', boardRef: interiorId }
      world.locations[containerId] = { board: parent.id, x: containerCell.x, y: containerCell.y }

      world.pieces[boxId] = { id: boxId, kind: 'normal' }
      world.locations[boxId] = { board: interiorId, x: boxCell.x, y: boxCell.y }
      homeBoardId = interiorId
    } else {
      const home = boards[randInt(rng, 0, boards.length - 1)]
      const homeCells = unoccupiedFloorCells(world, home.board)
      if (homeCells.length === 0) return null
      const boxCell = homeCells[randInt(rng, 0, homeCells.length - 1)]
      world.pieces[boxId] = { id: boxId, kind: 'normal' }
      world.locations[boxId] = { board: home.id, x: boxCell.x, y: boxCell.y }
      homeBoardId = home.id
    }

    const otherBoards = boards.filter((b) => b.id !== homeBoardId)
    const goalBoardEntry =
      otherBoards.length > 0 && rng() < config.crossBoardGoalProbability
        ? otherBoards[randInt(rng, 0, otherBoards.length - 1)]
        : (boards.find((b) => b.id === homeBoardId) as BoardEntry)
    const goalCells = floorCells(goalBoardEntry.board)
    if (goalCells.length === 0) return null
    const goalCell = goalCells[randInt(rng, 0, goalCells.length - 1)]
    goalBoardEntry.board.cells[goalCell.y][goalCell.x] = { type: 'floor', requirement: 'box' }
  }

  return { world }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tools/generator/randomGenerator.test.ts`
Expected: PASS, all 7 tests green.

- [ ] **Step 5: Commit**

```bash
git add tools/generator/randomGenerator.ts tools/generator/randomGenerator.test.ts
git commit -m "feat(generator): random candidate generator (flat + optional container)

New tools/generator/randomGenerator.ts per the redesign spec §4: random
board fill, player placement, and per-box independent home-board (root or
a freshly built interior, chained to arbitrary depth up to a configured
cap) and goal-board (same board or a different existing one) choices.
Bakes in the container-blockability fact discovered earlier this
session (a container with open floor on all 4 sides can never be
entered — resolveBlocked always tries pushing it further first) by
forcing a wall behind every generated container.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01WZvm6XFks26PNA8PfypCxy"
```

---

### Task 3: Basic validator

**Files:**
- Create: `tools/generator/basicValidator.ts`
- Create: `tools/generator/basicValidator.test.ts`

**Interfaces:**
- Consumes: `World`, `BoardId`, `PLAYER_ID`, `findContainerFor`, `inBounds` from `../../src/game/engine/types`.
- Produces: `ValidationResult = { valid: true } | { valid: false; reason: string }`, `basicValidate(world, maxNestingDepth): ValidationResult`.

- [ ] **Step 1: Write the failing tests**

Create `tools/generator/basicValidator.test.ts`:

```ts
import { Board, Cell, PLAYER_ID, World } from '../../src/game/engine/types'
import { basicValidate } from './basicValidator'

function emptyBoard(id: string, size: number): Board {
  const cells: Cell[][] = Array.from({ length: size }, (_, y) =>
    Array.from({ length: size }, (_, x): Cell => {
      const isBorder = x === 0 || y === 0 || x === size - 1 || y === size - 1
      return { type: isBorder ? 'wall' : 'floor' }
    }),
  )
  return { id, size, cells }
}

function baseWorld(): World {
  const root = emptyBoard('root', 5)
  return {
    boards: { root },
    pieces: { [PLAYER_ID]: { id: PLAYER_ID, kind: 'player' } },
    locations: { [PLAYER_ID]: { board: 'root', x: 2, y: 2 } },
  }
}

test('accepts a minimal valid world', () => {
  expect(basicValidate(baseWorld(), 2)).toEqual({ valid: true })
})

test('rejects two pieces overlapping', () => {
  const world = baseWorld()
  world.pieces.box1 = { id: 'box1', kind: 'normal' }
  world.locations.box1 = { board: 'root', x: 2, y: 2 }
  expect(basicValidate(world, 2).valid).toBe(false)
})

test('rejects a piece starting on a wall cell', () => {
  const world = baseWorld()
  world.locations[PLAYER_ID] = { board: 'root', x: 0, y: 0 }
  expect(basicValidate(world, 2).valid).toBe(false)
})

test('rejects a world with no player piece', () => {
  const world = baseWorld()
  delete world.pieces[PLAYER_ID]
  delete world.locations[PLAYER_ID]
  expect(basicValidate(world, 2).valid).toBe(false)
})

test('rejects a goal count that does not match the box count', () => {
  const world = baseWorld()
  world.pieces.box1 = { id: 'box1', kind: 'normal' }
  world.locations.box1 = { board: 'root', x: 1, y: 1 }
  expect(basicValidate(world, 2).valid).toBe(false)
})

test('rejects a board whose floor is split into two disconnected regions', () => {
  const root = emptyBoard('root', 5)
  for (let y = 0; y < 5; y++) root.cells[y][2] = { type: 'wall' }
  const world: World = {
    boards: { root },
    pieces: { [PLAYER_ID]: { id: PLAYER_ID, kind: 'player' } },
    locations: { [PLAYER_ID]: { board: 'root', x: 1, y: 1 } },
  }
  expect(basicValidate(world, 2).valid).toBe(false)
})

test('rejects a container whose interior board has no owner (orphan)', () => {
  const world = baseWorld()
  world.boards.inside = emptyBoard('inside', 3)
  expect(basicValidate(world, 2).valid).toBe(false)
})

test('rejects a board referenced by more than one container', () => {
  const world = baseWorld()
  world.boards.inside = emptyBoard('inside', 3)
  world.boards.root.cells[1][1] = { type: 'wall' }
  world.boards.root.cells[1][3] = { type: 'wall' }
  world.pieces.container1 = { id: 'container1', kind: 'container', boardRef: 'inside' }
  world.locations.container1 = { board: 'root', x: 1, y: 2 }
  world.pieces.container2 = { id: 'container2', kind: 'container', boardRef: 'inside' }
  world.locations.container2 = { board: 'root', x: 3, y: 2 }
  expect(basicValidate(world, 2).valid).toBe(false)
})

test('rejects nesting depth beyond the configured maximum', () => {
  const world = baseWorld()
  const inside1 = emptyBoard('inside1', 3)
  const inside2 = emptyBoard('inside2', 3)
  world.boards.inside1 = inside1
  world.boards.inside2 = inside2
  world.boards.root.cells[1][1] = { type: 'wall' }
  world.pieces.container1 = { id: 'container1', kind: 'container', boardRef: 'inside1' }
  world.locations.container1 = { board: 'root', x: 1, y: 2 }
  inside1.cells[1][1] = { type: 'wall' }
  world.pieces.container2 = { id: 'container2', kind: 'container', boardRef: 'inside2' }
  world.locations.container2 = { board: 'inside1', x: 1, y: 2 }
  expect(basicValidate(world, 1).valid).toBe(false)
  expect(basicValidate(world, 2).valid).toBe(true)
})

test('rejects a container with open floor on all 4 sides (never enterable)', () => {
  const world = baseWorld()
  world.boards.inside = emptyBoard('inside', 3)
  world.pieces.container1 = { id: 'container1', kind: 'container', boardRef: 'inside' }
  world.locations.container1 = { board: 'root', x: 2, y: 2 }
  world.locations[PLAYER_ID] = { board: 'root', x: 1, y: 1 }
  expect(basicValidate(world, 2).valid).toBe(false)
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tools/generator/basicValidator.test.ts`
Expected: FAIL — `Cannot find module './basicValidator'`.

- [ ] **Step 3: Implement `basicValidator.ts`**

```ts
import { Board, BoardId, Cell, PLAYER_ID, World, findContainerFor, inBounds } from '../../src/game/engine/types'

export type ValidationResult = { valid: true } | { valid: false; reason: string }

function floodFillFloorCount(board: Board): number {
  const size = board.size
  const seen: boolean[][] = Array.from({ length: size }, () => new Array(size).fill(false))
  let start: { x: number; y: number } | null = null
  for (let y = 0; y < size && start === null; y++) {
    for (let x = 0; x < size; x++) {
      if (board.cells[y][x].type === 'floor') { start = { x, y }; break }
    }
  }
  if (start === null) return 0
  const stack: { x: number; y: number }[] = [start]
  seen[start.y][start.x] = true
  let count = 0
  while (stack.length > 0) {
    const { x, y } = stack.pop() as { x: number; y: number }
    count++
    for (const [dx, dy] of [[0, -1], [0, 1], [-1, 0], [1, 0]]) {
      const nx = x + dx, ny = y + dy
      if (!inBounds(board, nx, ny)) continue
      if (seen[ny][nx]) continue
      if (board.cells[ny][nx].type !== 'floor') continue
      seen[ny][nx] = true
      stack.push({ x: nx, y: ny })
    }
  }
  return count
}

function countCellsWhere(board: Board, predicate: (cell: Cell) => boolean): number {
  let count = 0
  for (const row of board.cells) for (const cell of row) if (predicate(cell)) count++
  return count
}

// Generator-specific validator (see the design spec §5): root is always
// literally named 'root' by construction (randomGenerator.ts's own
// invariant), so this doesn't need the more general "figure out which
// board is ownerless" logic that levelSchema.ts's parseLevel uses for
// arbitrary hand-authored input.
export function basicValidate(world: World, maxNestingDepth: number): ValidationResult {
  const seenCells = new Set<string>()
  for (const [pieceId, loc] of Object.entries(world.locations)) {
    const board = world.boards[loc.board]
    if (board === undefined) {
      return { valid: false, reason: `piece "${pieceId}" references a nonexistent board "${loc.board}"` }
    }
    if (!inBounds(board, loc.x, loc.y)) {
      return { valid: false, reason: `piece "${pieceId}" is out of bounds on board "${loc.board}"` }
    }
    if (board.cells[loc.y][loc.x].type === 'wall') {
      return { valid: false, reason: `piece "${pieceId}" starts on a wall cell` }
    }
    const key = `${loc.board}:${loc.x}:${loc.y}`
    if (seenCells.has(key)) {
      return { valid: false, reason: `two pieces overlap at board "${loc.board}" (${loc.x}, ${loc.y})` }
    }
    seenCells.add(key)
  }

  const playerPieces = Object.values(world.pieces).filter((p) => p.kind === 'player')
  if (playerPieces.length !== 1) {
    return { valid: false, reason: `expected exactly one player piece, found ${playerPieces.length}` }
  }
  if (world.pieces[PLAYER_ID] === undefined || world.locations[PLAYER_ID] === undefined) {
    return { valid: false, reason: `the player piece must be keyed by id "${PLAYER_ID}"` }
  }

  let goalCount = 0
  for (const board of Object.values(world.boards)) {
    goalCount += countCellsWhere(board, (cell) => cell.requirement === 'box')
  }
  const boxCount = Object.values(world.pieces).filter((p) => p.kind === 'normal').length
  if (goalCount !== boxCount) {
    return { valid: false, reason: `goal count (${goalCount}) does not match box count (${boxCount})` }
  }

  for (const [boardId, board] of Object.entries(world.boards)) {
    const totalFloor = countCellsWhere(board, (cell) => cell.type === 'floor')
    if (totalFloor === 0) {
      return { valid: false, reason: `board "${boardId}" has no floor cells at all` }
    }
    const reachable = floodFillFloorCount(board)
    if (reachable !== totalFloor) {
      return {
        valid: false,
        reason: `board "${boardId}"'s floor is not a single connected region (${reachable}/${totalFloor} reachable)`,
      }
    }
  }

  const ownerCount = new Map<BoardId, number>()
  for (const boardId of Object.keys(world.boards)) ownerCount.set(boardId, 0)
  for (const piece of Object.values(world.pieces)) {
    if (piece.kind !== 'container') continue
    if (piece.boardRef === undefined || world.boards[piece.boardRef] === undefined) {
      return { valid: false, reason: `container "${piece.id}" references a nonexistent board` }
    }
    ownerCount.set(piece.boardRef, (ownerCount.get(piece.boardRef) ?? 0) + 1)
  }
  for (const [boardId, count] of ownerCount) {
    if (boardId === 'root') {
      if (count !== 0) return { valid: false, reason: 'root board must not be referenced by any container' }
      continue
    }
    if (count !== 1) {
      return { valid: false, reason: `board "${boardId}" has ${count} owning containers, expected exactly 1` }
    }
  }

  for (const piece of Object.values(world.pieces)) {
    if (piece.kind !== 'container') continue
    let depth = 0
    let currentBoardId: BoardId = world.locations[piece.id].board
    const visited = new Set<BoardId>()
    while (currentBoardId !== 'root') {
      if (visited.has(currentBoardId)) {
        return { valid: false, reason: `board containment forms a cycle at "${currentBoardId}"` }
      }
      visited.add(currentBoardId)
      const ownerContainer = findContainerFor(world, currentBoardId)
      if (ownerContainer === undefined) {
        return { valid: false, reason: `board "${currentBoardId}" is not reachable back to root` }
      }
      currentBoardId = world.locations[ownerContainer].board
      depth++
      if (depth > maxNestingDepth) {
        return { valid: false, reason: `nesting depth exceeds ${maxNestingDepth}` }
      }
    }
  }

  for (const piece of Object.values(world.pieces)) {
    if (piece.kind !== 'container') continue
    const loc = world.locations[piece.id]
    const board = world.boards[loc.board]
    let blocked = false
    for (const [dx, dy] of [[0, -1], [0, 1], [-1, 0], [1, 0]]) {
      const nx = loc.x + dx, ny = loc.y + dy
      if (!inBounds(board, nx, ny) || board.cells[ny][nx].type === 'wall') { blocked = true; break }
    }
    if (!blocked) {
      return { valid: false, reason: `container "${piece.id}" has open floor on all 4 sides and can never be entered` }
    }
  }

  return { valid: true }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tools/generator/basicValidator.test.ts`
Expected: PASS, all 10 tests green.

- [ ] **Step 5: Commit**

```bash
git add tools/generator/basicValidator.ts tools/generator/basicValidator.test.ts
git commit -m "feat(generator): cheap structural validator for random candidates

New tools/generator/basicValidator.ts per the redesign spec §5/§6: overlap,
wall-start, missing-player, goal/box count mismatch, per-board floor
connectivity, container ownership, nesting depth, and the
container-blockability invariant. Root is assumed to always be named
'root' by construction (this generator's own invariant), simpler than
levelSchema.ts's parseLevel, which has to handle arbitrary hand-authored
input.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01WZvm6XFks26PNA8PfypCxy"
```

---

### Task 4: Difficulty analyzer

**Files:**
- Create: `tools/generator/difficultyAnalyzer.ts`
- Create: `tools/generator/difficultyAnalyzer.test.ts`

**Interfaces:**
- Consumes: `Direction, PLAYER_ID, World, cloneWorld, findContainerFor` from `../../src/game/engine/types`; `applyMove, checkWin` from `../../src/game/engine/rules`; `SolveResult, solve, countCrossingMoves` from `./solver`.
- Produces: `DifficultyVector` interface, `analyze(world, solved, maxSolverExpandedStates): DifficultyVector`.

- [ ] **Step 1: Write the failing tests**

Create `tools/generator/difficultyAnalyzer.test.ts`:

```ts
import { Cell, PLAYER_ID, World, opposite } from '../../src/game/engine/types'
import { getEntryCell } from '../../src/game/engine/rules'
import { HALF } from '../../src/game/engine/fraction'
import { SolveResult, solve } from './solver'
import { analyze } from './difficultyAnalyzer'

function makeSquareCells(size: number): Cell[][] {
  return Array.from({ length: size }, () => Array.from({ length: size }, (): Cell => ({ type: 'floor' })))
}

function trivialWorld(): World {
  return {
    boards: { root: { id: 'root', size: 3, cells: [
      [{ type: 'floor' }, { type: 'floor' }, { type: 'floor' }],
      [{ type: 'floor' }, { type: 'floor' }, { type: 'floor', requirement: 'box' }],
      [{ type: 'floor' }, { type: 'floor' }, { type: 'floor' }],
    ] } },
    pieces: { [PLAYER_ID]: { id: PLAYER_ID, kind: 'player' }, box1: { id: 'box1', kind: 'normal' } },
    locations: { [PLAYER_ID]: { board: 'root', x: 0, y: 1 }, box1: { board: 'root', x: 1, y: 1 } },
  }
}

function mockSolved(overrides: Partial<SolveResult> = {}): SolveResult {
  return { moves: ['right'], expandedStates: 1, maxFrontierSize: 1, visitedStates: 2, branchingFactors: [3], ...overrides }
}

test('avgBranching and maxBranching summarize solved.branchingFactors', () => {
  const vector = analyze(trivialWorld(), mockSolved({ branchingFactors: [2, 4, 3] }), 5000)
  expect(vector.avgBranching).toBeCloseTo(3, 5)
  expect(vector.maxBranching).toBe(4)
})

test('deadEndRatio is the fraction of expanded states with branching factor 0', () => {
  const vector = analyze(trivialWorld(), mockSolved({ branchingFactors: [2, 0, 3, 0], expandedStates: 4 }), 5000)
  expect(vector.deadEndRatio).toBeCloseTo(0.5, 5)
})

test('avgBranching and deadEndRatio are 0 for an already-solved (0-move) result', () => {
  const vector = analyze(trivialWorld(), mockSolved({ moves: [], expandedStates: 0, branchingFactors: [] }), 5000)
  expect(vector.avgBranching).toBe(0)
  expect(vector.deadEndRatio).toBe(0)
})

test('criticalDecisions counts the single fork in a 1-move puzzle with walkable-but-wrong alternatives', () => {
  const size = 5
  const cells: Cell[][] = Array.from({ length: size }, (_, y) =>
    Array.from({ length: size }, (_, x) => ({
      type: (x === 0 || y === 0 || x === size - 1 || y === size - 1 ? 'wall' : 'floor') as const,
    })),
  )
  cells[2][3] = { type: 'floor', requirement: 'box' }
  const world: World = {
    boards: { root: { id: 'root', size, cells } },
    pieces: { [PLAYER_ID]: { id: PLAYER_ID, kind: 'player' }, box1: { id: 'box1', kind: 'normal' } },
    locations: { [PLAYER_ID]: { board: 'root', x: 1, y: 2 }, box1: { board: 'root', x: 2, y: 2 } },
  }
  const solved = solve(world)!
  expect(solved.moves).toEqual(['right'])
  const vector = analyze(world, solved, 5000)
  expect(vector.criticalDecisions).toBe(1)
})

test('criticalDecisions is 0 for a forced 1-wide corridor with no alternative moves', () => {
  const size = 5
  const cells: Cell[][] = Array.from({ length: size }, () =>
    Array.from({ length: size }, () => ({ type: 'wall' as const })),
  )
  for (let x = 1; x < size - 1; x++) cells[2][x] = { type: 'floor' }
  cells[2][3] = { type: 'floor', requirement: 'box' }
  const world: World = {
    boards: { root: { id: 'root', size, cells } },
    pieces: { [PLAYER_ID]: { id: PLAYER_ID, kind: 'player' }, box1: { id: 'box1', kind: 'normal' } },
    locations: { [PLAYER_ID]: { board: 'root', x: 1, y: 2 }, box1: { board: 'root', x: 2, y: 2 } },
  }
  const solved = solve(world)!
  expect(solved.moves).toEqual(['right', 'right'])
  const vector = analyze(world, solved, 5000)
  expect(vector.criticalDecisions).toBe(0)
})

test('nestedBoxRequired is true and maxContainerDepthUsed is 1 when the goal is only reachable inside a container', () => {
  const root = { id: 'root', size: 6, cells: makeSquareCells(6) }
  for (let i = 0; i < 6; i++) {
    root.cells[0][i] = { type: 'wall' }; root.cells[5][i] = { type: 'wall' }
    root.cells[i][0] = { type: 'wall' }; root.cells[i][5] = { type: 'wall' }
  }
  root.cells[2][4] = { type: 'wall' }
  const inside = { id: 'inside', size: 3, cells: makeSquareCells(3) }
  const { cell: entry } = getEntryCell(inside, opposite('right'), HALF)
  inside.cells[entry!.y][entry!.x] = { type: 'floor', requirement: 'box' }
  const world: World = {
    boards: { root, inside },
    pieces: {
      [PLAYER_ID]: { id: PLAYER_ID, kind: 'player' },
      container1: { id: 'container1', kind: 'container', boardRef: 'inside' },
      box1: { id: 'box1', kind: 'normal' },
    },
    locations: {
      [PLAYER_ID]: { board: 'root', x: 1, y: 2 },
      container1: { board: 'root', x: 2, y: 2 },
      box1: { board: 'root', x: 3, y: 2 },
    },
  }
  const solved = solve(world)!
  const vector = analyze(world, solved, 5000)
  expect(vector.nestedBoxRequired).toBe(true)
  expect(vector.nestedBoxUsed).toBe(true)
  expect(vector.maxContainerDepthUsed).toBe(1)
})

test('nestedBoxRequired is false when the container is never needed for the solution', () => {
  const size = 6
  const cells = makeSquareCells(size)
  for (let i = 0; i < size; i++) {
    cells[0][i] = { type: 'wall' }; cells[size - 1][i] = { type: 'wall' }
    cells[i][0] = { type: 'wall' }; cells[i][size - 1] = { type: 'wall' }
  }
  cells[3][3] = { type: 'floor', requirement: 'box' }
  const inside = { id: 'inside', size: 3, cells: makeSquareCells(3) }
  const world: World = {
    boards: { root: { id: 'root', size, cells }, inside },
    pieces: {
      [PLAYER_ID]: { id: PLAYER_ID, kind: 'player' },
      box1: { id: 'box1', kind: 'normal' },
      container1: { id: 'container1', kind: 'container', boardRef: 'inside' },
    },
    locations: {
      [PLAYER_ID]: { board: 'root', x: 1, y: 3 },
      box1: { board: 'root', x: 2, y: 3 },
      container1: { board: 'root', x: 4, y: 4 },
    },
  }
  const solved = solve(world)!
  expect(solved.moves).toEqual(['right'])
  const vector = analyze(world, solved, 5000)
  expect(vector.nestedBoxRequired).toBe(false)
  expect(vector.nestedBoxUsed).toBe(false)
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tools/generator/difficultyAnalyzer.test.ts`
Expected: FAIL — `Cannot find module './difficultyAnalyzer'`.

- [ ] **Step 3: Implement `difficultyAnalyzer.ts`**

```ts
import { Direction, PLAYER_ID, World, cloneWorld, findContainerFor } from '../../src/game/engine/types'
import { applyMove, checkWin } from '../../src/game/engine/rules'
import { SolveResult, countCrossingMoves, solve } from './solver'

export interface DifficultyVector {
  solutionLength: number
  expandedStates: number
  generatedStates: number
  maxQueueSize: number
  avgBranching: number
  maxBranching: number
  deadEndRatio: number
  criticalDecisions: number
  spaceTransitions: number
  nestedBoxUsed: boolean
  nestedBoxRequired: boolean
  maxContainerDepthUsed: number
}

const DIRECTIONS: Direction[] = ['up', 'down', 'left', 'right']

function containerDepthOf(world: World, boardId: string): number {
  let depth = 0
  let current = boardId
  const visited = new Set<string>()
  while (current !== 'root') {
    if (visited.has(current)) break // defensive; this generator never creates a cycle
    visited.add(current)
    const owner = findContainerFor(world, current)
    if (owner === undefined) break
    current = world.locations[owner].board
    depth++
  }
  return depth
}

function maxContainerDepthUsed(world: World, moves: Direction[]): number {
  let current = world
  let maxDepth = containerDepthOf(current, current.locations[PLAYER_ID].board)
  for (const direction of moves) {
    const next = applyMove(current, direction)
    if (!next) throw new Error('maxContainerDepthUsed received an invalid move for this world')
    maxDepth = Math.max(maxDepth, containerDepthOf(next, next.locations[PLAYER_ID].board))
    current = next
  }
  return maxDepth
}

// For each state S on the optimal path, k = (moves remaining in the
// optimal solution FROM S, counting the upcoming move) is exactly the
// right solve() budget to give an alternative first move from S: the
// alternative consumes 1 of those k moves reaching its own resulting
// state, leaving k-1 to match the optimal's own remaining length from
// there, +1 slack (so an equally-short alternate solution still doesn't
// count as a dead end) = k. See the design spec §7's own derivation.
function criticalDecisions(world: World, solved: SolveResult, maxSolverExpandedStates: number): number {
  let current = world
  let decisions = 0
  for (let i = 0; i < solved.moves.length; i++) {
    const taken = solved.moves[i]
    const k = solved.moves.length - i
    let anySucceeds = false
    let hasAlternative = false
    for (const direction of DIRECTIONS) {
      if (direction === taken) continue
      const alt = applyMove(current, direction)
      if (!alt) continue
      hasAlternative = true
      if (checkWin(alt) || solve(alt, k, maxSolverExpandedStates) !== null) { anySucceeds = true; break }
    }
    if (hasAlternative && !anySucceeds) decisions++
    const next = applyMove(current, taken)
    if (!next) throw new Error('criticalDecisions received an invalid move for this world')
    current = next
  }
  return decisions
}

// Mechanic relevance (design spec §7/md §18): seal every container's cell
// into a wall and remove the container piece itself, but deliberately do
// NOT delete its interior board or anything inside it — the goal (and any
// box) that lived there stays in the world, so checkWin still requires it;
// it simply becomes permanently unreachable now that its only entrance is
// gone. Deleting the board instead would make its goal cell vanish
// entirely, which checkWin would misread as "nothing left to satisfy,
// trivially won" rather than "impossible to reach" — the wrong signal.
function nestedBoxRequired(world: World, solved: SolveResult, maxSolverExpandedStates: number): boolean {
  const frozen = cloneWorld(world)
  for (const piece of Object.values(world.pieces)) {
    if (piece.kind !== 'container') continue
    const loc = frozen.locations[piece.id]
    if (loc === undefined) continue
    const board = frozen.boards[loc.board]
    if (board !== undefined) board.cells[loc.y][loc.x] = { type: 'wall' }
    delete frozen.pieces[piece.id]
    delete frozen.locations[piece.id]
  }
  if (checkWin(frozen)) return false
  const frozenSolved = solve(frozen, solved.moves.length + 1, maxSolverExpandedStates)
  return frozenSolved === null
}

export function analyze(world: World, solved: SolveResult, maxSolverExpandedStates: number): DifficultyVector {
  const avgBranching =
    solved.branchingFactors.length > 0
      ? solved.branchingFactors.reduce((a, b) => a + b, 0) / solved.branchingFactors.length
      : 0
  const maxBranching = solved.branchingFactors.length > 0 ? Math.max(...solved.branchingFactors) : 0
  const deadEnds = solved.branchingFactors.filter((b) => b === 0).length
  const deadEndRatio = solved.expandedStates > 0 ? deadEnds / solved.expandedStates : 0
  const spaceTransitions = countCrossingMoves(world, solved.moves)

  return {
    solutionLength: solved.moves.length,
    expandedStates: solved.expandedStates,
    generatedStates: solved.visitedStates,
    maxQueueSize: solved.maxFrontierSize,
    avgBranching,
    maxBranching,
    deadEndRatio,
    criticalDecisions: criticalDecisions(world, solved, maxSolverExpandedStates),
    spaceTransitions,
    nestedBoxUsed: spaceTransitions > 0,
    nestedBoxRequired: nestedBoxRequired(world, solved, maxSolverExpandedStates),
    maxContainerDepthUsed: maxContainerDepthUsed(world, solved.moves),
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tools/generator/difficultyAnalyzer.test.ts`
Expected: PASS, all 7 tests green.

- [ ] **Step 5: Commit**

```bash
git add tools/generator/difficultyAnalyzer.ts tools/generator/difficultyAnalyzer.test.ts
git commit -m "feat(generator): difficulty vector analyzer

New tools/generator/difficultyAnalyzer.ts per the redesign spec §7:
avgBranching/maxBranching/deadEndRatio from solve()'s new branchingFactors,
criticalDecisions via bounded re-solve of each alternative at every state
on the optimal path, nestedBoxRequired via freeze-the-mechanic-and-resolve
(same pattern as this session's earlier filler-box necessity check),
maxContainerDepthUsed by replaying the solution.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01WZvm6XFks26PNA8PfypCxy"
```

---

### Task 5: Filter

**Files:**
- Create: `tools/generator/filter.ts`
- Create: `tools/generator/filter.test.ts`

**Interfaces:**
- Consumes: `DifficultyVector` from `./difficultyAnalyzer`.
- Produces: `RangeFilter`, `DifficultyFilter`, `Tier`, `accept(vector, filter): boolean`, `classifyTier(vector, tiers): Tier | 'reject'`.

- [ ] **Step 1: Write the failing tests**

Create `tools/generator/filter.test.ts`:

```ts
import { DifficultyVector } from './difficultyAnalyzer'
import { accept, classifyTier } from './filter'

function vector(overrides: Partial<DifficultyVector> = {}): DifficultyVector {
  return {
    solutionLength: 10, expandedStates: 100, generatedStates: 150, maxQueueSize: 20,
    avgBranching: 2, maxBranching: 3, deadEndRatio: 0.1, criticalDecisions: 1,
    spaceTransitions: 0, nestedBoxUsed: false, nestedBoxRequired: false, maxContainerDepthUsed: 0,
    ...overrides,
  }
}

test('accept passes when every present range is satisfied', () => {
  expect(accept(vector({ solutionLength: 15 }), { solutionLength: { min: 10, max: 20 } })).toBe(true)
})

test('accept fails when a value is below min', () => {
  expect(accept(vector({ solutionLength: 5 }), { solutionLength: { min: 10 } })).toBe(false)
})

test('accept fails when a value is above max', () => {
  expect(accept(vector({ solutionLength: 25 }), { solutionLength: { max: 20 } })).toBe(false)
})

test('accept ignores fields with no range configured', () => {
  expect(accept(vector({ solutionLength: 99999 }), {})).toBe(true)
})

test('accept enforces requireNestedBox', () => {
  expect(accept(vector({ nestedBoxRequired: false }), { requireNestedBox: true })).toBe(false)
  expect(accept(vector({ nestedBoxRequired: true }), { requireNestedBox: true })).toBe(true)
})

test('classifyTier checks hard first, then medium, then easy, then rejects', () => {
  const tiers = {
    hard: { solutionLength: { min: 20 } },
    medium: { solutionLength: { min: 10 } },
    easy: { solutionLength: { min: 0 } },
  }
  expect(classifyTier(vector({ solutionLength: 25 }), tiers)).toBe('hard')
  expect(classifyTier(vector({ solutionLength: 15 }), tiers)).toBe('medium')
  expect(classifyTier(vector({ solutionLength: 5 }), tiers)).toBe('easy')
  expect(classifyTier(vector({ solutionLength: -1 }), tiers)).toBe('reject')
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tools/generator/filter.test.ts`
Expected: FAIL — `Cannot find module './filter'`.

- [ ] **Step 3: Implement `filter.ts`**

```ts
import { DifficultyVector } from './difficultyAnalyzer'

export interface RangeFilter { min?: number; max?: number }

export interface DifficultyFilter {
  solutionLength?: RangeFilter
  expandedStates?: RangeFilter
  criticalDecisions?: RangeFilter
  deadEndRatio?: RangeFilter
  avgBranching?: RangeFilter
  requireNestedBox?: boolean
}

export type Tier = 'easy' | 'medium' | 'hard'

function inRange(value: number, range?: RangeFilter): boolean {
  if (range === undefined) return true
  if (range.min !== undefined && value < range.min) return false
  if (range.max !== undefined && value > range.max) return false
  return true
}

// Direct port of the design brief's own §20 accept() — every present
// range is a hard requirement, absent ranges are unconstrained.
export function accept(vector: DifficultyVector, filter: DifficultyFilter): boolean {
  if (!inRange(vector.solutionLength, filter.solutionLength)) return false
  if (!inRange(vector.expandedStates, filter.expandedStates)) return false
  if (!inRange(vector.criticalDecisions, filter.criticalDecisions)) return false
  if (!inRange(vector.deadEndRatio, filter.deadEndRatio)) return false
  if (!inRange(vector.avgBranching, filter.avgBranching)) return false
  if (filter.requireNestedBox === true && !vector.nestedBoxRequired) return false
  return true
}

// Checks the most exclusive preset first (hard, then medium, then easy) so
// a candidate satisfying more than one preset's ranges is classified by
// the strictest one it clears, matching the old scorer's own "check hard
// requirements first" priority (see the design spec §8).
export function classifyTier(
  vector: DifficultyVector,
  tiers: { easy: DifficultyFilter; medium: DifficultyFilter; hard: DifficultyFilter },
): Tier | 'reject' {
  if (accept(vector, tiers.hard)) return 'hard'
  if (accept(vector, tiers.medium)) return 'medium'
  if (accept(vector, tiers.easy)) return 'easy'
  return 'reject'
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tools/generator/filter.test.ts`
Expected: PASS, all 6 tests green.

- [ ] **Step 5: Commit**

```bash
git add tools/generator/filter.ts tools/generator/filter.test.ts
git commit -m "feat(generator): range-based difficulty filter + tier classification

New tools/generator/filter.ts per the redesign spec §8/md §20: accept()
is a direct port of the design brief's own range-based filter. classifyTier
checks hard/medium/easy in that fixed order so overlapping presets resolve
to the strictest one, matching the old scorer's priority.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01WZvm6XFks26PNA8PfypCxy"
```

---

### Task 6: New generator config

**Files:**
- Modify: `tools/generator/generatorConfig.ts` (full rewrite — old content is entirely reverse-walk-specific)

**Interfaces:**
- Consumes: `RandomGeneratorConfig` from `./randomGenerator`; `DifficultyFilter` from `./filter`.
- Produces: `GeneratorConfig` interface, `GENERATOR_CONFIG: GeneratorConfig`.

- [ ] **Step 1: Replace the file contents**

Overwrite `tools/generator/generatorConfig.ts` entirely with:

```ts
import { RandomGeneratorConfig } from './randomGenerator'
import { DifficultyFilter } from './filter'

export interface GeneratorConfig {
  generator: RandomGeneratorConfig
  maxSolveDepth: number
  maxSolverExpandedStates: number
  tiers: { easy: DifficultyFilter; medium: DifficultyFilter; hard: DifficultyFilter }
  hardCandidatePoolSize: number
  diversityWeight: number
  maxAttempts: number
}

function assertRange(range: [number, number], name: string): void {
  const [min, max] = range
  if (!Number.isFinite(min) || !Number.isFinite(max) || min > max) {
    throw new Error(`${name} must be a valid [min, max] range with min <= max, got [${min}, ${max}]`)
  }
}

function assertProbability(value: number, name: string): void {
  if (!Number.isFinite(value) || value < 0 || value > 1) {
    throw new Error(`${name} must be a probability in [0, 1], got ${value}`)
  }
}

// Generator ranges come directly from the design brief's own §5 example
// config — a documented starting point, not a tuned final answer (this
// project's own repeated experience: guessed thresholds turn out
// structurally unreachable; real values come from a diagnostic pass — see
// the redesign spec's Rollout section and this plan's Task 9).
//
// Tier filters start EMPTY (accept anything solvable) deliberately: with
// all three empty, classifyTier's hard-first priority means every solved
// candidate classifies as 'hard' and easy/medium never fill — this is
// intentional, not a bug. It forces Task 9's diagnostic-tuning pass to run
// before generateBatch.ts can produce a meaningful three-tier split, rather
// than silently shipping guessed numbers.
export const GENERATOR_CONFIG: GeneratorConfig = {
  generator: {
    widthRange: [6, 10],
    heightRange: [6, 10],
    wallDensityRange: [0.15, 0.40],
    boxCountRange: [1, 4],
    containerProbability: 0.3,
    crossBoardGoalProbability: 0.3,
    interiorSizeRange: [3, 5],
    maxNestingDepth: 2,
  },
  maxSolveDepth: 200,
  maxSolverExpandedStates: 20000,
  tiers: {
    easy: {},
    medium: {},
    hard: {},
  },
  hardCandidatePoolSize: 60,
  diversityWeight: 10,
  maxAttempts: 5000,
}

assertRange(GENERATOR_CONFIG.generator.widthRange, 'generator.widthRange')
assertRange(GENERATOR_CONFIG.generator.heightRange, 'generator.heightRange')
assertRange(GENERATOR_CONFIG.generator.wallDensityRange, 'generator.wallDensityRange')
assertRange(GENERATOR_CONFIG.generator.boxCountRange, 'generator.boxCountRange')
assertRange(GENERATOR_CONFIG.generator.interiorSizeRange, 'generator.interiorSizeRange')
assertProbability(GENERATOR_CONFIG.generator.containerProbability, 'generator.containerProbability')
assertProbability(GENERATOR_CONFIG.generator.crossBoardGoalProbability, 'generator.crossBoardGoalProbability')
if (GENERATOR_CONFIG.generator.maxNestingDepth < 0) {
  throw new Error('generator.maxNestingDepth must be >= 0')
}
```

- [ ] **Step 2: Typecheck (no test file for a pure config — verified by every other module that imports it)**

Run: `npx tsc --noEmit`
Expected: errors ONLY in files not yet updated by this plan (`generateBatch.ts`, `generateLevel.ts`, `seed.ts`, `injectObstacle.ts`, `trimUnusedCells.ts`, and their tests, all still referencing the old config shape — these get fixed/deleted in Tasks 7-8) plus the pre-existing unrelated `EditorScreen.tsx` errors. No NEW error type beyond "old files reference the old config shape."

- [ ] **Step 3: Commit**

```bash
git add tools/generator/generatorConfig.ts
git commit -m "feat(generator): replace generator config with the new random+solve shape

Full rewrite of tools/generator/generatorConfig.ts's GeneratorConfig for
the redesign — RandomGeneratorConfig ranges/probabilities, solver budget,
per-tier DifficultyFilter, and diversity/pool-size knobs. Tier filters
start empty on purpose (see the file's own comment) — Task 9's diagnostic
pass sets real thresholds before generateBatch.ts ships anything with
meaningful tiers. This intentionally breaks tools/generator/*.ts files
still on the old config shape (generateBatch.ts, seed.ts, generateLevel.ts,
injectObstacle.ts, trimUnusedCells.ts, and their tests) — fixed by
replacing generateBatch.ts (Task 7) and deleting the rest (Task 8).

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01WZvm6XFks26PNA8PfypCxy"
```

---

### Task 7: New generateBatch.ts main loop

**Files:**
- Modify: `tools/generator/generateBatch.ts` (full rewrite)
- Modify: `tools/generator/generateBatch.test.ts` (full rewrite)

**Interfaces:**
- Consumes: `randomGenerate` from `./randomGenerator`; `basicValidate` from `./basicValidator`; `analyze, DifficultyVector` from `./difficultyAnalyzer`; `accept, classifyTier, Tier, DifficultyFilter` from `./filter`; `canonicalKey` from `./canonical`; `solve` from `./solver`; `GENERATOR_CONFIG, GeneratorConfig` from `./generatorConfig`.
- Produces: `GeneratedLevel`, `BatchStats`, `BatchResult`, `HardCandidate`, `profileDistance(a, b)`, `selectDiverseTopN(candidates, n)`, `generateLevelBatch(targetPerTier, rng, maxAttempts?, config?)`.

- [ ] **Step 1: Write the failing tests**

Overwrite `tools/generator/generateBatch.test.ts` entirely with:

```ts
import { checkWin } from '../../src/game/engine/rules'
import { parseLevel } from '../../src/game/engine/levelSchema'
import { canonicalKey } from './canonical'
import { World } from '../../src/game/engine/types'
import { DifficultyVector } from './difficultyAnalyzer'
import { GeneratorConfig } from './generatorConfig'
import {
  HardCandidate, generateLevelBatch, profileDistance, selectDiverseTopN,
} from './generateBatch'

function seededRng(startSeed: number): () => number {
  let s = startSeed
  return () => {
    s = (s * 1103515245 + 12345) & 0x7fffffff
    return (s % 10000) / 10000
  }
}

// A generous, unrestricted test config: the shipped GENERATOR_CONFIG's
// tiers start empty on purpose (see generatorConfig.ts's own comment) —
// that already means "accept anything, classify as hard" by default, so
// these tests use it directly rather than building a separate one, EXCEPT
// where a test specifically needs a non-trivial tier split.
function testConfig(overrides: Partial<GeneratorConfig> = {}): GeneratorConfig {
  return {
    generator: {
      widthRange: [6, 6], heightRange: [6, 6], wallDensityRange: [0.15, 0.3],
      boxCountRange: [1, 2], containerProbability: 0.2, crossBoardGoalProbability: 0.2,
      interiorSizeRange: [3, 3], maxNestingDepth: 1,
    },
    maxSolveDepth: 100,
    maxSolverExpandedStates: 20000,
    tiers: { easy: {}, medium: {}, hard: {} },
    hardCandidatePoolSize: 10,
    diversityWeight: 10,
    maxAttempts: 500,
    ...overrides,
  }
}

test('generateLevelBatch reports whether it actually met its tier quotas', () => {
  const result = generateLevelBatch(1, seededRng(42), 500, testConfig())
  if (result.complete) {
    expect(result.counts.easy).toBeGreaterThanOrEqual(1)
    expect(result.counts.medium).toBeGreaterThanOrEqual(1)
    expect(result.counts.hard).toBeGreaterThanOrEqual(1)
  } else {
    expect(result.counts.easy < 1 || result.counts.medium < 1 || result.counts.hard < 1).toBe(true)
  }
})

test('every accepted level is unsolved and parses back through parseLevel', () => {
  // Empty tiers mean everything solvable classifies as 'hard' — force at
  // least one hard slot to be reachable within a small pool.
  const result = generateLevelBatch(1, seededRng(1), 500, testConfig({ hardCandidatePoolSize: 3 }))
  expect(result.levels.length).toBeGreaterThan(0)
  for (const entry of result.levels) {
    const parsed = parseLevel(JSON.parse(entry.json))
    expect(checkWin(parsed)).toBe(false)
  }
})

test('no two accepted levels in one batch share a canonical state', () => {
  const result = generateLevelBatch(2, seededRng(7), 500, testConfig({ hardCandidatePoolSize: 5 }))
  const keys = result.levels.map((entry) => canonicalKey(entry.world))
  expect(new Set(keys).size).toBe(keys.length)
})

test('batch stats account for every attempt', () => {
  const result = generateLevelBatch(1, seededRng(99), 300, testConfig())
  const accountedFor =
    result.stats.discardedGenerationFailed +
    result.stats.discardedInvalid +
    result.stats.discardedAlreadySolved +
    result.stats.discardedUnsolvable +
    result.stats.discardedDuplicate +
    result.stats.discardedTierFull +
    result.stats.discardedTierReject +
    result.levels.length
  // Hard candidates that are found but NOT selected into the final
  // levels list are counted neither in `levels.length` nor in any
  // discarded-* bucket at attempt time (they're pool members, resolved
  // only at the very end by selectDiverseTopN) — account for them too.
  const unselectedHardCandidates = result.hardCandidatesFound - result.counts.hard
  expect(accountedFor + unselectedHardCandidates).toBe(result.stats.attempts)
})

test('hardCandidatesFound reflects the pool size independent of how many were finally selected', () => {
  const result = generateLevelBatch(1, seededRng(11), 500, testConfig({ hardCandidatePoolSize: 8 }))
  expect(result.hardCandidatesFound).toBeLessThanOrEqual(8)
  expect(result.counts.hard).toBeLessThanOrEqual(result.hardCandidatesFound)
})

function makeVector(overrides: Partial<DifficultyVector> = {}): DifficultyVector {
  return {
    solutionLength: 10, expandedStates: 100, generatedStates: 150, maxQueueSize: 20,
    avgBranching: 2, maxBranching: 3, deadEndRatio: 0.1, criticalDecisions: 1,
    spaceTransitions: 0, nestedBoxUsed: false, nestedBoxRequired: false, maxContainerDepthUsed: 0,
    ...overrides,
  }
}

function makeCandidate(vector: Partial<DifficultyVector>, score: number): HardCandidate {
  return { world: {} as World, json: '{}', vector: makeVector(vector), score }
}

test('profileDistance is 0 for identical vectors and grows with any difference', () => {
  const a = makeVector()
  expect(profileDistance(a, a)).toBe(0)
  const b = makeVector({ solutionLength: 30 })
  expect(profileDistance(a, b)).toBeGreaterThan(0)
})

test('selectDiverseTopN prefers a lower-score-but-distinct candidate over a near-duplicate of a higher one', () => {
  const highA = makeCandidate({ solutionLength: 30, criticalDecisions: 3 }, 50)
  const highB = makeCandidate({ solutionLength: 31, criticalDecisions: 3 }, 49) // near-duplicate of highA
  const distinct = makeCandidate({ solutionLength: 15, criticalDecisions: 0, avgBranching: 4 }, 40)
  const selected = selectDiverseTopN([highA, highB, distinct], 2)
  expect(selected).toHaveLength(2)
  expect(selected).toContain(highA)
  expect(selected).toContain(distinct)
})

test('selectDiverseTopN returns fewer than N if fewer candidates are available', () => {
  const only = makeCandidate({}, 10)
  expect(selectDiverseTopN([only], 5)).toHaveLength(1)
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tools/generator/generateBatch.test.ts`
Expected: FAIL — old `generateBatch.ts` doesn't export `HardCandidate`/`profileDistance`/`selectDiverseTopN` with the new shapes, and the old `generateLevelBatch` signature doesn't accept a `config` parameter.

- [ ] **Step 3: Implement the new `generateBatch.ts`**

Overwrite `tools/generator/generateBatch.ts` entirely with:

```ts
import { mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { dirname, join } from 'node:path'
import { World } from '../../src/game/engine/types'
import { checkWin } from '../../src/game/engine/rules'
import { serializeLevel } from '../../src/game/engine/levelSchema'
import { randomGenerate } from './randomGenerator'
import { basicValidate } from './basicValidator'
import { DifficultyVector, analyze } from './difficultyAnalyzer'
import { Tier, classifyTier } from './filter'
import { canonicalKey } from './canonical'
import { solve } from './solver'
import { GENERATOR_CONFIG, GeneratorConfig } from './generatorConfig'

export type { Tier }

export interface GeneratedLevel {
  tier: Tier
  world: World
  json: string
}

export interface BatchStats {
  attempts: number
  discardedGenerationFailed: number
  discardedInvalid: number
  discardedAlreadySolved: number
  discardedUnsolvable: number
  discardedDuplicate: number
  discardedTierFull: number
  discardedTierReject: number
}

export interface BatchResult {
  levels: GeneratedLevel[]
  complete: boolean
  counts: Record<Tier, number>
  stats: BatchStats
  hardCandidatesFound: number
}

export interface HardCandidate {
  world: World
  json: string
  vector: DifficultyVector
  score: number
}

function scoreDifficulty(vector: DifficultyVector): number {
  return (
    vector.solutionLength +
    vector.criticalDecisions * 5 +
    vector.avgBranching * 3 +
    Math.log2(vector.expandedStates + 1) * 2 +
    (vector.nestedBoxRequired ? 10 : 0)
  )
}

export function profileDistance(a: DifficultyVector, b: DifficultyVector): number {
  const term = (x: number, y: number, scale: number) => Math.abs(x - y) / scale
  return (
    term(a.solutionLength, b.solutionLength, 20) +
    term(a.criticalDecisions, b.criticalDecisions, 3) +
    term(a.avgBranching, b.avgBranching, 2) +
    term(a.expandedStates, b.expandedStates, 5000) +
    term(a.spaceTransitions, b.spaceTransitions, 3)
  )
}

export function selectDiverseTopN(candidates: HardCandidate[], n: number, diversityWeight: number = GENERATOR_CONFIG.diversityWeight): HardCandidate[] {
  const remaining = [...candidates]
  const selected: HardCandidate[] = []
  while (selected.length < n && remaining.length > 0) {
    let bestIndex = 0
    let bestValue = -Infinity
    for (let i = 0; i < remaining.length; i++) {
      const candidate = remaining[i]
      const diversityBonus =
        selected.length === 0
          ? 0
          : Math.min(...selected.map((chosen) => profileDistance(chosen.vector, candidate.vector)))
      const value = candidate.score + diversityWeight * diversityBonus
      if (value > bestValue) { bestValue = value; bestIndex = i }
    }
    selected.push(remaining[bestIndex])
    remaining.splice(bestIndex, 1)
  }
  return selected
}

export function generateLevelBatch(
  targetPerTier: number,
  rng: () => number,
  maxAttempts: number = GENERATOR_CONFIG.maxAttempts,
  config: GeneratorConfig = GENERATOR_CONFIG,
): BatchResult {
  const counts: Record<Tier, number> = { easy: 0, medium: 0, hard: 0 }
  const results: GeneratedLevel[] = []
  const seenLevels = new Set<string>()
  const hardCandidates: HardCandidate[] = []
  const hardPoolTarget = config.hardCandidatePoolSize
  const stats: BatchStats = {
    attempts: 0, discardedGenerationFailed: 0, discardedInvalid: 0,
    discardedAlreadySolved: 0, discardedUnsolvable: 0, discardedDuplicate: 0,
    discardedTierFull: 0, discardedTierReject: 0,
  }

  while (
    stats.attempts < maxAttempts &&
    (counts.easy < targetPerTier || counts.medium < targetPerTier || hardCandidates.length < hardPoolTarget)
  ) {
    stats.attempts++
    const generated = randomGenerate(config.generator, rng)
    if (!generated) { stats.discardedGenerationFailed++; continue }
    const { world } = generated

    const validation = basicValidate(world, config.generator.maxNestingDepth)
    if (!validation.valid) { stats.discardedInvalid++; continue }

    if (checkWin(world)) { stats.discardedAlreadySolved++; continue }

    const levelKey = canonicalKey(world)
    if (seenLevels.has(levelKey)) { stats.discardedDuplicate++; continue }

    const solved = solve(world, config.maxSolveDepth, config.maxSolverExpandedStates)
    if (!solved || solved.moves.length === 0) { stats.discardedUnsolvable++; continue }

    const vector = analyze(world, solved, config.maxSolverExpandedStates)
    const tier = classifyTier(vector, config.tiers)
    if (tier === 'reject') { stats.discardedTierReject++; continue }

    if (tier === 'hard') {
      if (hardCandidates.length >= hardPoolTarget) { stats.discardedTierFull++; continue }
      seenLevels.add(levelKey)
      hardCandidates.push({ world, json: JSON.stringify(serializeLevel(world)), vector, score: scoreDifficulty(vector) })
      continue
    }

    if (counts[tier] >= targetPerTier) { stats.discardedTierFull++; continue }
    seenLevels.add(levelKey)
    counts[tier]++
    results.push({ tier, world, json: JSON.stringify(serializeLevel(world)) })
  }

  for (const candidate of selectDiverseTopN(hardCandidates, targetPerTier, config.diversityWeight)) {
    counts.hard++
    results.push({ tier: 'hard', world: candidate.world, json: candidate.json })
  }

  const complete = counts.easy >= targetPerTier && counts.medium >= targetPerTier && counts.hard >= targetPerTier
  return { levels: results, complete, counts, stats, hardCandidatesFound: hardCandidates.length }
}

function main() {
  const outputDir = join(dirname(fileURLToPath(import.meta.url)), '../../src/levels/builtin/generated')
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
      `(hardCandidatesFound=${batch.hardCandidatesFound}, attempts=${batch.stats.attempts}, ` +
      `discarded: genFailed=${batch.stats.discardedGenerationFailed} ` +
      `invalid=${batch.stats.discardedInvalid} ` +
      `alreadySolved=${batch.stats.discardedAlreadySolved} ` +
      `unsolvable=${batch.stats.discardedUnsolvable} ` +
      `duplicate=${batch.stats.discardedDuplicate} ` +
      `tierFull=${batch.stats.discardedTierFull} ` +
      `tierReject=${batch.stats.discardedTierReject})`,
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

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tools/generator/generateBatch.test.ts`
Expected: PASS. This step's tests are the slowest in the plan (each attempt does a full random-generate → validate → solve → analyze cycle) — if any test times out, first check whether `testConfig()`'s ranges are so restrictive that `discardedGenerationFailed`/`discardedInvalid` consume the entire `maxAttempts` budget before finding enough solved candidates; widen `wallDensityRange`'s upper bound down (less wall) or `boxCountRange` down (fewer boxes) if so, rather than just raising `maxAttempts`, since that only masks a too-restrictive config rather than fixing it.

- [ ] **Step 5: Commit**

```bash
git add tools/generator/generateBatch.ts tools/generator/generateBatch.test.ts
git commit -m "feat(generator): rewrite generateBatch.ts for the random+solve pipeline

Main loop is now generate -> validate -> checkWin-guard -> dedup -> solve
-> analyze -> classifyTier -> save, replacing the reverse-walk-specific
version. generateLevelBatch now takes an optional GeneratorConfig
parameter (defaulting to GENERATOR_CONFIG) instead of reading the module
singleton directly, so tests can exercise a small, fast config without
mutating shared state. selectDiverseTopN/profileDistance are kept (same
greedy score+diversity selection as before) but now key off
DifficultyVector fields instead of the deleted Approach-A-specific ones.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01WZvm6XFks26PNA8PfypCxy"
```

---

### Task 8: Delete the obsolete reverse-walk modules

**Files:**
- Delete: `tools/generator/seed.ts`, `tools/generator/seed.test.ts`
- Delete: `tools/generator/generateLevel.ts`, `tools/generator/generateLevel.test.ts`
- Delete: `tools/generator/inverseMoves.ts`, `tools/generator/inverseMoves.test.ts`
- Delete: `tools/generator/pruneUntouchedGoals.ts`, `tools/generator/pruneUntouchedGoals.test.ts`
- Delete: `tools/generator/injectObstacle.ts`, `tools/generator/injectObstacle.test.ts`
- Delete: `tools/generator/trimUnusedCells.ts`, `tools/generator/trimUnusedCells.test.ts`
- Delete: `tools/generator/difficultyScorer.ts`, `tools/generator/difficultyScorer.test.ts`

**Interfaces:**
- Consumes: nothing new.
- Produces: nothing new — this task only removes code Tasks 1-7 already made obsolete.

- [ ] **Step 1: Confirm nothing outside `tools/generator/` depends on these files**

Run: `grep -rn "from '\.\./generator/seed\|from '\.\./generator/generateLevel\|from '\.\./generator/inverseMoves\|from '\.\./generator/pruneUntouchedGoals\|from '\.\./generator/injectObstacle\|from '\.\./generator/trimUnusedCells\|from '\.\./generator/difficultyScorer" src/`
Expected: no output (already confirmed during planning — `src/levels/index.test.ts` only imports `solve` from `./solver`, unaffected).

- [ ] **Step 2: Delete the files**

```bash
rm tools/generator/seed.ts tools/generator/seed.test.ts
rm tools/generator/generateLevel.ts tools/generator/generateLevel.test.ts
rm tools/generator/inverseMoves.ts tools/generator/inverseMoves.test.ts
rm tools/generator/pruneUntouchedGoals.ts tools/generator/pruneUntouchedGoals.test.ts
rm tools/generator/injectObstacle.ts tools/generator/injectObstacle.test.ts
rm tools/generator/trimUnusedCells.ts tools/generator/trimUnusedCells.test.ts
rm tools/generator/difficultyScorer.ts tools/generator/difficultyScorer.test.ts
```

- [ ] **Step 3: Typecheck and run the full generator suite**

Run: `npx tsc --noEmit`
Expected: no errors in `tools/generator/*` at all now — only the pre-existing unrelated `src/editor/EditorScreen.tsx`/`EditorScreen.test.tsx` errors remain (confirmed present before this whole plan started; unrelated to the generator).

Run: `npx vitest run tools/generator`
Expected: PASS, every remaining test file green (`canonical`, `solver`, `randomGenerator`, `basicValidator`, `difficultyAnalyzer`, `filter`, `generateBatch`).

- [ ] **Step 4: Commit**

```bash
git add -A tools/generator/
git commit -m "refactor(generator): delete the reverse-walk generator and its tests

seed.ts, generateLevel.ts, inverseMoves.ts, pruneUntouchedGoals.ts,
injectObstacle.ts, trimUnusedCells.ts, difficultyScorer.ts, and their
tests — the concepts they implement (SeedGroup, reverse walk from a solved
state, filler/obstacle post-hoc injection, Approach-A-specific difficulty
scoring) have no equivalent in the random-generate+solve architecture that
replaces them (Tasks 1-7). Confirmed nothing outside tools/generator/
imports any of them.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01WZvm6XFks26PNA8PfypCxy"
```

---

### Task 9: Diagnostic pass — set real tier thresholds

**Files:**
- Modify: `tools/generator/generatorConfig.ts` (fill in `tiers.easy`/`tiers.medium`/`tiers.hard`, currently `{}`)

**Interfaces:**
- Consumes: everything from Tasks 1-8.
- Produces: the same `GeneratorConfig` shape, with real `DifficultyFilter` values instead of empty objects.

This task has no fixed code to write ahead of time — per the Global Constraints, the numbers are measured, not guessed. Follow this exact procedure (mirrors the diagnostic passes already run successfully earlier this session for `minReverseSteps`/`obstacleBoxProbability`):

- [ ] **Step 1: Write a throwaway diagnostic script**

Create a scratch file OUTSIDE the repo (your scratchpad/temp directory, not `tools/generator/`) — e.g. `diagTierDistribution.ts`:

```ts
import { randomGenerate } from 'C:/Users/a1003/parabox-game-pwa/tools/generator/randomGenerator'
import { basicValidate } from 'C:/Users/a1003/parabox-game-pwa/tools/generator/basicValidator'
import { analyze } from 'C:/Users/a1003/parabox-game-pwa/tools/generator/difficultyAnalyzer'
import { solve } from 'C:/Users/a1003/parabox-game-pwa/tools/generator/solver'
import { checkWin } from 'C:/Users/a1003/parabox-game-pwa/src/game/engine/rules'
import { canonicalKey } from 'C:/Users/a1003/parabox-game-pwa/tools/generator/canonical'
import { GENERATOR_CONFIG } from 'C:/Users/a1003/parabox-game-pwa/tools/generator/generatorConfig'

const rng = Math.random
const seen = new Set<string>()
const vectors: ReturnType<typeof analyze>[] = []
let attempts = 0
let genFailed = 0, invalid = 0, alreadySolved = 0, dup = 0, unsolvable = 0

while (vectors.length < 300 && attempts < 20000) {
  attempts++
  const generated = randomGenerate(GENERATOR_CONFIG.generator, rng)
  if (!generated) { genFailed++; continue }
  const { world } = generated
  const validation = basicValidate(world, GENERATOR_CONFIG.generator.maxNestingDepth)
  if (!validation.valid) { invalid++; continue }
  if (checkWin(world)) { alreadySolved++; continue }
  const key = canonicalKey(world)
  if (seen.has(key)) { dup++; continue }
  seen.add(key)
  const solved = solve(world, GENERATOR_CONFIG.maxSolveDepth, GENERATOR_CONFIG.maxSolverExpandedStates)
  if (!solved || solved.moves.length === 0) { unsolvable++; continue }
  vectors.push(analyze(world, solved, GENERATOR_CONFIG.maxSolverExpandedStates))
}

function percentile(values: number[], p: number): number {
  const sorted = [...values].sort((a, b) => a - b)
  return sorted[Math.floor(sorted.length * p)] ?? 0
}

function summarize(name: keyof (typeof vectors)[number]) {
  const values = vectors.map((v) => Number(v[name]))
  console.log(`${name}: min=${Math.min(...values)} p25=${percentile(values,0.25)} p50=${percentile(values,0.5)} p75=${percentile(values,0.75)} p90=${percentile(values,0.9)} max=${Math.max(...values)}`)
}

console.log(JSON.stringify({ attempts, genFailed, invalid, alreadySolved, dup, unsolvable, solvedCount: vectors.length }))
summarize('solutionLength')
summarize('expandedStates')
summarize('criticalDecisions')
summarize('avgBranching')
summarize('deadEndRatio')
console.log('nestedBoxRequired rate:', vectors.filter((v) => v.nestedBoxRequired).length / vectors.length)
```

- [ ] **Step 2: Run it and record the real distribution**

Run: `npx tsx <path-to-diagTierDistribution.ts>` (via the project's own `npx tsx`, from the repo root so the absolute imports resolve) — this may take several minutes; if it looks stuck, verify the process is still consuming CPU (per this session's own established practice of checking with the OS process list) rather than assuming a hang.

Record the printed percentiles.

- [ ] **Step 3: Pick threshold values from the observed distribution, not from a guess**

A reasonable starting split (adjust based on what Step 2 actually printed):
- `easy`: `solutionLength` below the observed p50, `criticalDecisions` max 1.
- `medium`: `solutionLength` between the observed p50 and p85ish.
- `hard`: `solutionLength` above the observed p85, AND `criticalDecisions` at or above the observed p75, so `hard` actually requires more genuine decision points, not just more moves.

Update `tools/generator/generatorConfig.ts`'s `tiers` field with the concrete numbers you observed (do not copy the placeholder numbers above verbatim — they must come from your own Step 2 run's real output).

- [ ] **Step 4: Re-run the full generator test suite to confirm nothing regressed**

Run: `npx vitest run tools/generator`
Expected: PASS. (`generateBatch.test.ts`'s tests all build their own `testConfig()` with empty tiers, per Task 7, so they're unaffected by this change to the shipped `GENERATOR_CONFIG` defaults.)

- [ ] **Step 5: Delete the scratch diagnostic script** (it was never part of the repo)

- [ ] **Step 6: Commit**

```bash
git add tools/generator/generatorConfig.ts
git commit -m "feat(generator): set real tier thresholds from a diagnostic pass

Replaces the placeholder empty tier filters with values measured against
this generator's own real output (N solved candidates sampled via
Math.random), following this project's own established rule: a guessed
threshold has twice already turned out structurally unreachable once real
data came in, so thresholds only ship after being checked against a real
distribution.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01WZvm6XFks26PNA8PfypCxy"
```

---

### Task 10: Regenerate shipped levels, verify, final check

**Files:**
- Modify: `src/levels/builtin/generated/*.json` (regenerated output, not hand-edited)

**Interfaces:**
- Consumes: the finished pipeline from Tasks 1-9.
- Produces: 15 shipped level files (5 easy, 5 medium, 5 hard), matching the existing naming convention (`easy-01.json` … `hard-05.json`).

- [ ] **Step 1: Run the full project test suite**

Run: `npx vitest run`
Expected: PASS except the same 11 pre-existing `src/editor/EditorScreen.test.tsx` failures already present before this plan started (confirm by checking they're the same test names, not new ones).

- [ ] **Step 2: Typecheck the whole project**

Run: `npx tsc --noEmit`
Expected: only the pre-existing `EditorScreen.tsx`/`EditorScreen.test.tsx` errors, nothing in `tools/generator/*`.

- [ ] **Step 3: Regenerate the shipped levels**

Run: `npm run generate:levels`
Expected: exits 0, prints `Generated 15 levels: easy=5 medium=5 hard=5 (...)`. If it reports incomplete (`process.exitCode = 1`), the tier thresholds from Task 9 are too strict for the configured `maxAttempts` — go back to Task 9 and loosen the tightest-looking threshold (usually `hard`'s), then retry this step; do not raise `maxAttempts` as a substitute for fixing an unreachable threshold, per this project's own established experience.

- [ ] **Step 4: Verify the shipped JSON**

Run a quick sanity check that every generated file actually parses and is unsolved-but-solvable:

```bash
node --experimental-strip-types -e "
const fs = require('fs')
const path = require('path')
const dir = 'src/levels/builtin/generated'
for (const file of fs.readdirSync(dir)) {
  const data = JSON.parse(fs.readFileSync(path.join(dir, file), 'utf-8'))
  console.log(file, Object.keys(data.boards).length, 'boards,', Object.keys(data.pieces).length, 'pieces')
}
"
```

(If `--experimental-strip-types` isn't available in the project's Node version, use `npx tsx -e "..."` with the equivalent TypeScript instead — the point is just confirming every file is valid JSON with the expected top-level shape.)

- [ ] **Step 5: Verify the dev server still serves the new levels**

Run: `npm run dev` in the background, then `curl -s http://localhost:5173/ -o /dev/null -w "%{http_code}\n"` — expect `200`.

- [ ] **Step 6: Commit the regenerated levels**

```bash
git add src/levels/builtin/generated/
git commit -m "chore(generator): regenerate shipped levels via the new random+solve pipeline

15 levels (5 easy / 5 medium / 5 hard) produced end-to-end by the
random-generate -> validate -> solve -> analyze -> filter pipeline from
this plan's Tasks 1-9, replacing the reverse-walk-generated batch.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01WZvm6XFks26PNA8PfypCxy"
```

---

## Self-review notes (for whoever executes this plan)

- **Spec coverage:** Task 1 covers spec §6 (solver enrichment). Task 2 covers §4. Task 3 covers §5. Task 4 covers §7. Task 5 covers §8's `accept`/tier mechanism. Task 6 covers §9. Task 7 covers §8's `generateBatch.ts` integration. Task 8 covers §3's deletion list. Task 9-10 cover the spec's §11 Rollout steps 2-5. Mutation/evolution/diversity-beyond-dedup/`.txt` export/UI are explicitly out of scope per the spec's §1 and are NOT tasked here.
- **Known simplification carried from the spec, not a plan gap:** `deadEndRatio`'s narrow definition (immediately-stuck states only, not full backward-reachability) is intentional — see `difficultyAnalyzer.ts`'s own code comment in Task 4.
- **Type consistency check:** `DifficultyVector` (Task 4) is used identically in `filter.ts` (Task 5), `generateBatch.ts` (Task 7), and the Task 9 diagnostic script — same field names throughout (`solutionLength`, `expandedStates`, `criticalDecisions`, `avgBranching`, `deadEndRatio`, `nestedBoxRequired`, `nestedBoxUsed`, `spaceTransitions`, `maxContainerDepthUsed`, `generatedStates`, `maxQueueSize`, `maxBranching`). `RandomGeneratorConfig` (Task 2) matches exactly between `randomGenerator.ts` and its use inside `GeneratorConfig` (Task 6).
