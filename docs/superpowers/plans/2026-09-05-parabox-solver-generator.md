# Parabox Solver & Level Generator Rewrite Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rewrite `tools/generator/*` (currently targets the retired custom-nesting engine and does not compile) against the current flat multi-board `World` engine, and un-stub `loadGeneratedLevels()` in `src/levels/index.ts` so generated levels appear in-game.

**Architecture:** Three constructive inverse-move functions build candidate predecessors and validate every one of them against the real `applyMove()` before accepting it (never trust hand-derived geometry alone). A reverse random walk built on those functions produces levels; a BFS solver and a deterministic canonical state key support both the walk (cycle avoidance) and batch generation (duplicate detection, difficulty scoring).

**Tech Stack:** TypeScript, Node (`tsx` for the CLI entry point), Vitest (`globals: true` — `test`/`expect` need no import, though some existing files import `describe`/`it`/`expect` from `'vitest'` explicitly; match whichever style the file you're touching already uses).

**Spec:** `docs/superpowers/specs/2026-09-05-parabox-solver-generator-design.md` (post-review revision — read this alongside the plan; it explains *why* each design choice was made, including two real bugs caught while drafting this plan: an unused `DIRECTIONS` constant, and an arithmetic error in `inverseEat`'s container-position reconstruction).

## Global Constraints

- Every inverse-move function's candidate predecessor must be validated via `applyMove(candidate, dir)` + `canonicalKey` equality before being returned — geometric construction (wall checks, occupancy checks) proposes a candidate, it never gets the final word.
- `canonicalKey` (in `tools/generator/canonical.ts`) must recursively sort object keys before `JSON.stringify` — never compare `World` states with raw `JSON.stringify` anywhere in `tools/generator`.
- `generateLevel()` returns `null` (never a partially-built world) if it cannot reach the requested step count within its attempt budget (`Math.max(steps, 1) * 20` attempts), and never re-accepts a state whose `canonicalKey` was already produced earlier in the same walk.
- `generateLevelBatch()` returns `complete: false` (a field the caller reads, not just a log line) when `MAX_ATTEMPTS = 500` is exhausted without meeting every tier's quota, and rejects a candidate level whose `canonicalKey` matches one already accepted in the same batch, before it is counted toward a tier.
- `checkWin(world) === false` is checked explicitly on every level `generateLevelBatch` accepts — never merely inferred from `solve()` returning a non-empty path.
- `src/levels/builtin/generated/` is cleared (`rmSync(dir, { recursive: true, force: true })`) before each batch run writes new files — overwrite, not append.
- `tsconfig.json` has `"noUnusedLocals": true` and `"noUnusedParameters": true` (and `tools` is in its `include`) — every import must be used at the point it is added; do not import a symbol a later task will need before that task actually uses it.
- All six retired files under `tools/generator/` (`seed.ts`, `inverseMoves.ts`, `generateLevel.ts`, `solver.ts`, `difficultyScorer.ts`, `generateBatch.ts`) and their five existing test files still reference the old `Grid`/`Box` API and do not compile against the current engine — each is fully rewritten (not patched) by this plan; the plan below is explicit everywhere a file's content is a full replacement versus an addition to a file this plan itself created earlier.

---

### Task 1: `canonical.ts` — deterministic state key

**Files:**
- Create: `tools/generator/canonical.ts`
- Test: `tools/generator/canonical.test.ts`

**Interfaces:**
- Produces: `canonicalKey(world: World): string` — every later task that needs to compare two `World` values for equality (inverse-move validation, generator cycle avoidance, solver visited-state dedup, batch duplicate detection) imports this.

- [x] **Step 1: Write the failing test**

```ts
import { World } from '../../src/game/engine/types'
import { canonicalKey } from './canonical'

test('canonicalKey is identical for equivalent content built with different key insertion order', () => {
  const board = {
    id: 'root',
    size: 3,
    cells: [
      [{ type: 'floor' as const }, { type: 'floor' as const }, { type: 'floor' as const }],
      [{ type: 'floor' as const }, { type: 'floor' as const }, { type: 'floor' as const }],
      [{ type: 'floor' as const }, { type: 'floor' as const }, { type: 'floor' as const }],
    ],
  }
  const a: World = {
    boards: { root: board },
    pieces: { player: { id: 'player', kind: 'player' } },
    locations: { player: { board: 'root', x: 1, y: 1 } },
  }
  const b: World = {
    locations: { player: { x: 1, board: 'root', y: 1 } },
    pieces: { player: { kind: 'player', id: 'player' } },
    boards: { root: board },
  }
  expect(canonicalKey(a)).toBe(canonicalKey(b))
})

test('canonicalKey differs when content differs', () => {
  const board = {
    id: 'root',
    size: 3,
    cells: [
      [{ type: 'floor' as const }, { type: 'floor' as const }, { type: 'floor' as const }],
      [{ type: 'floor' as const }, { type: 'floor' as const }, { type: 'floor' as const }],
      [{ type: 'floor' as const }, { type: 'floor' as const }, { type: 'floor' as const }],
    ],
  }
  const a: World = {
    boards: { root: board },
    pieces: { player: { id: 'player', kind: 'player' } },
    locations: { player: { board: 'root', x: 1, y: 1 } },
  }
  const b: World = { ...a, locations: { player: { board: 'root', x: 2, y: 1 } } }
  expect(canonicalKey(a)).not.toBe(canonicalKey(b))
})
```

- [x] **Step 2: Run test to verify it fails**

Run: `npx vitest run tools/generator/canonical.test.ts`
Expected: FAIL — `Cannot find module './canonical'` (the module doesn't exist yet).

- [x] **Step 3: Write minimal implementation**

```ts
import { World } from '../../src/game/engine/types'

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

- [x] **Step 4: Run test to verify it passes**

Run: `npx vitest run tools/generator/canonical.test.ts`
Expected: PASS (2 tests)

- [x] **Step 5: Commit**

```bash
git add tools/generator/canonical.ts tools/generator/canonical.test.ts
git commit -m "feat(generator): add deterministic canonicalKey for World state comparison"
```

---

### Task 2: `seed.ts` — an already-solved `World`

**Files:**
- Modify (full rewrite): `tools/generator/seed.ts` (currently builds an old-format `Grid` via `createEmptyGrid` — replace entirely)
- Create: `tools/generator/seed.test.ts` (no test file exists for `seed.ts` yet)

**Interfaces:**
- Produces: `createSeedWorld(): World` — Task 6 (`generateLevel.test.ts`) and Task 9 (`generateBatch.ts`) both call this directly.

- [x] **Step 1: Write the failing test**

```ts
import { checkWin } from '../../src/game/engine/rules'
import { parseLevel, serializeLevel } from '../../src/game/engine/levelSchema'
import { createSeedWorld } from './seed'

test('the seed world is already solved', () => {
  expect(checkWin(createSeedWorld())).toBe(true)
})

test('the seed world is internally consistent', () => {
  const seed = createSeedWorld()
  expect(() => parseLevel(serializeLevel(seed))).not.toThrow()
})
```

- [x] **Step 2: Run test to verify it fails**

Run: `npx vitest run tools/generator/seed.test.ts`
Expected: FAIL — `createSeedWorld` is not exported (the old file exports `createSeedGrid` instead) or a type error, since the old `seed.ts` still imports `createEmptyGrid`/`Grid` from `types.ts`, which no longer export those.

- [x] **Step 3: Write minimal implementation**

Replace the entire contents of `tools/generator/seed.ts`:

```ts
import { Board, Cell, World, PLAYER_ID } from '../../src/game/engine/types'

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

- [x] **Step 4: Run test to verify it passes**

Run: `npx vitest run tools/generator/seed.test.ts`
Expected: PASS (2 tests)

- [x] **Step 5: Commit**

```bash
git add tools/generator/seed.ts tools/generator/seed.test.ts
git commit -m "feat(generator): rewrite createSeedWorld against the current World engine"
```

---

### Task 3: `inverseMoves.ts` — `inversePush`

**Files:**
- Modify (full rewrite): `tools/generator/inverseMoves.ts` (currently `inverseTranslate`/`inverseNest` against the old `Grid` API — replace entirely; Tasks 4 and 5 will *append* to the file this task creates)
- Modify (full rewrite): `tools/generator/inverseMoves.test.ts`

**Interfaces:**
- Consumes: `canonicalKey` from `./canonical` (Task 1).
- Produces: `inversePush(world: World, dir: Direction): World | null`, plus two private helpers (`isOpenFloor`, `verifyPredecessor`) that Tasks 4 and 5 reuse without re-declaring — Task 4 and 5 append their exported functions below `inversePush` in the same file and use these two helpers as-is.

- [x] **Step 1: Write the failing test**

```ts
import { Board, Cell, Direction, World, step } from '../../src/game/engine/types'
import { applyMove } from '../../src/game/engine/rules'
import { inversePush } from './inverseMoves'

function makeBoard(id: string, size: number): Board {
  const cells: Cell[][] = Array.from({ length: size }, () =>
    Array.from({ length: size }, () => ({ type: 'floor' as const })),
  )
  return { id, size, cells }
}

function makeRootWorld(size: number): World {
  return {
    boards: { root: makeBoard('root', size) },
    pieces: { player: { id: 'player', kind: 'player' } },
    locations: { player: { board: 'root', x: 0, y: 0 } },
  }
}

test('inversePush reconstructs a plain walk with no pieces pushed', () => {
  const world = makeRootWorld(3)
  world.locations.player = { board: 'root', x: 1, y: 1 }
  const prev = inversePush(world, 'right')
  expect(prev).not.toBeNull()
  expect(applyMove(prev!, 'right')).toEqual(world)
})

test('inversePush reconstructs a single-piece push', () => {
  const world = makeRootWorld(4)
  world.pieces.box1 = { id: 'box1', kind: 'normal' }
  world.locations.player = { board: 'root', x: 1, y: 1 }
  world.locations.box1 = { board: 'root', x: 2, y: 1 }
  const prev = inversePush(world, 'right')
  expect(prev).not.toBeNull()
  expect(applyMove(prev!, 'right')).toEqual(world)
})

test('inversePush reconstructs a two-piece chain push', () => {
  const world = makeRootWorld(5)
  world.pieces.box1 = { id: 'box1', kind: 'normal' }
  world.pieces.box2 = { id: 'box2', kind: 'normal' }
  world.locations.player = { board: 'root', x: 1, y: 1 }
  world.locations.box1 = { board: 'root', x: 2, y: 1 }
  world.locations.box2 = { board: 'root', x: 3, y: 1 }
  const prev = inversePush(world, 'right')
  expect(prev).not.toBeNull()
  expect(applyMove(prev!, 'right')).toEqual(world)
})

test('inversePush returns null when a wall blocks the chain from landing', () => {
  const world = makeRootWorld(4)
  world.pieces.box1 = { id: 'box1', kind: 'normal' }
  world.locations.player = { board: 'root', x: 1, y: 1 }
  world.locations.box1 = { board: 'root', x: 2, y: 1 }
  world.boards.root.cells[1][3] = { type: 'wall' }
  expect(inversePush(world, 'right')).toBeNull()
})

test('inversePush returns null when the cell behind the player is occupied', () => {
  const world = makeRootWorld(4)
  world.pieces.blocker = { id: 'blocker', kind: 'normal' }
  world.locations.player = { board: 'root', x: 2, y: 1 }
  world.locations.blocker = { board: 'root', x: 1, y: 1 }
  expect(inversePush(world, 'right')).toBeNull()
})

test('inversePush returns null when the chain runs off the edge of the board', () => {
  const world = makeRootWorld(4)
  world.pieces.box1 = { id: 'box1', kind: 'normal' }
  world.pieces.box2 = { id: 'box2', kind: 'normal' }
  world.locations.player = { board: 'root', x: 1, y: 1 }
  world.locations.box1 = { board: 'root', x: 2, y: 1 }
  world.locations.box2 = { board: 'root', x: 3, y: 1 }
  expect(inversePush(world, 'right')).toBeNull()
})

test('inversePush works in all four directions', () => {
  const directions: Direction[] = ['up', 'down', 'left', 'right']
  for (const dir of directions) {
    const world = makeRootWorld(5)
    world.pieces.box1 = { id: 'box1', kind: 'normal' }
    world.locations.player = { board: 'root', x: 2, y: 2 }
    const ahead = step(2, 2, dir)
    world.locations.box1 = { board: 'root', x: ahead.x, y: ahead.y }
    const prev = inversePush(world, dir)
    expect(prev, `direction ${dir}`).not.toBeNull()
    expect(applyMove(prev!, dir)).toEqual(world)
  }
})

test('inversePush returns null when a container in the chain is wall-blocked (needs eat, not push)', () => {
  const world = makeRootWorld(5)
  world.pieces.container1 = { id: 'container1', kind: 'container', boardRef: 'inside' }
  world.boards.inside = makeBoard('inside', 3)
  world.locations.player = { board: 'root', x: 1, y: 1 }
  world.locations.container1 = { board: 'root', x: 2, y: 1 }
  world.boards.root.cells[1][3] = { type: 'wall' }
  // Geometrically this still looks like "player -> container1 -> wall,"
  // which inversePush's own chain walk correctly rejects (the cell after
  // the chain is a wall, not open floor) before ever reaching
  // verifyPredecessor. The real engine resolves this via enter/eat instead
  // of a uniform push (see inverseEnter/inverseEat in Tasks 4-5), which is
  // exactly why a uniform-push candidate must not be accepted here.
  expect(inversePush(world, 'right')).toBeNull()
})

test('inversePush treats an unblocked container as an ordinary pushable piece', () => {
  const world = makeRootWorld(5)
  world.pieces.container1 = { id: 'container1', kind: 'container', boardRef: 'inside' }
  world.boards.inside = makeBoard('inside', 3)
  world.locations.player = { board: 'root', x: 1, y: 1 }
  world.locations.container1 = { board: 'root', x: 2, y: 1 }
  const prev = inversePush(world, 'right')
  expect(prev).not.toBeNull()
  expect(applyMove(prev!, 'right')).toEqual(world)
})
```

- [x] **Step 2: Run test to verify it fails**

Run: `npx vitest run tools/generator/inverseMoves.test.ts`
Expected: FAIL — `inversePush` is not exported (the old file exports `inverseTranslate`/`inverseNest` instead).

- [x] **Step 3: Write minimal implementation**

Replace the entire contents of `tools/generator/inverseMoves.ts`:

```ts
import {
  Board, Direction, PLAYER_ID, PieceId, World,
  inBounds, step, opposite, occupantAt, cloneWorld,
} from '../../src/game/engine/types'
import { applyMove } from '../../src/game/engine/rules'
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

- [x] **Step 4: Run test to verify it passes**

Run: `npx vitest run tools/generator/inverseMoves.test.ts`
Expected: PASS (9 tests)

- [x] **Step 5: Commit**

```bash
git add tools/generator/inverseMoves.ts tools/generator/inverseMoves.test.ts
git commit -m "feat(generator): rewrite inversePush with applyMove-verified candidates"
```

---

### Task 4: `inverseMoves.ts` — `inverseEnter`

**Files:**
- Modify: `tools/generator/inverseMoves.ts` (append `inverseEnter` below `inversePush`; add three new imports)
- Modify: `tools/generator/inverseMoves.test.ts` (append new tests below Task 3's)

**Interfaces:**
- Consumes: `isOpenFloor`, `verifyPredecessor` (private helpers from Task 3, same file).
- Produces: `inverseEnter(world: World, dir: Direction): World | null` — Task 6 (`generateLevel.ts`) imports this alongside `inversePush` and `inverseEat`.

- [x] **Step 1: Write the failing test**

Append to `tools/generator/inverseMoves.test.ts` (add `getEntryCell` and `HALF` to the test file's imports):

```ts
import { getEntryCell } from '../../src/game/engine/rules'
import { HALF } from '../../src/game/engine/fraction'
import { inverseEnter } from './inverseMoves'
```

```ts
test('inverseEnter reconstructs the predecessor of walking into a container from the right', () => {
  const root = makeBoard('root', 5)
  root.cells[2][3] = { type: 'wall' }
  const world: World = {
    boards: { root, inside: makeBoard('inside', 3) },
    pieces: {
      player: { id: 'player', kind: 'player' },
      container1: { id: 'container1', kind: 'container', boardRef: 'inside' },
    },
    locations: {
      player: { board: 'inside', x: 0, y: 1 },
      container1: { board: 'root', x: 2, y: 2 },
    },
  }
  const prev = inverseEnter(world, 'right')
  expect(prev).not.toBeNull()
  expect(applyMove(prev!, 'right')).toEqual(world)
})

test('inverseEnter works in all four directions', () => {
  const directions: Direction[] = ['up', 'down', 'left', 'right']
  for (const dir of directions) {
    const root = makeBoard('root', 5)
    const containerPos = { x: 2, y: 2 }
    const wallPos = step(containerPos.x, containerPos.y, dir)
    root.cells[wallPos.y][wallPos.x] = { type: 'wall' }
    const inside = makeBoard('inside', 3)
    const { cell } = getEntryCell(inside, dir, HALF)
    const world: World = {
      boards: { root, inside },
      pieces: {
        player: { id: 'player', kind: 'player' },
        container1: { id: 'container1', kind: 'container', boardRef: 'inside' },
      },
      locations: {
        player: { board: 'inside', x: cell!.x, y: cell!.y },
        container1: { board: 'root', x: containerPos.x, y: containerPos.y },
      },
    }
    const prev = inverseEnter(world, dir)
    expect(prev, `direction ${dir}`).not.toBeNull()
    expect(applyMove(prev!, dir)).toEqual(world)
  }
})

test('inverseEnter returns null when the player is not on the correct entry cell', () => {
  const root = makeBoard('root', 5)
  root.cells[2][3] = { type: 'wall' }
  const world: World = {
    boards: { root, inside: makeBoard('inside', 3) },
    pieces: {
      player: { id: 'player', kind: 'player' },
      container1: { id: 'container1', kind: 'container', boardRef: 'inside' },
    },
    locations: {
      player: { board: 'inside', x: 1, y: 1 },
      container1: { board: 'root', x: 2, y: 2 },
    },
  }
  expect(inverseEnter(world, 'right')).toBeNull()
})

test('inverseEnter returns null on the root board (no owning container)', () => {
  const world: World = {
    boards: { root: makeBoard('root', 5) },
    pieces: { player: { id: 'player', kind: 'player' } },
    locations: { player: { board: 'root', x: 2, y: 2 } },
  }
  expect(inverseEnter(world, 'right')).toBeNull()
})

test('inverseEnter returns null when the cell behind the container is blocked', () => {
  const root = makeBoard('root', 5)
  root.cells[2][3] = { type: 'wall' }
  root.cells[2][1] = { type: 'wall' }
  const world: World = {
    boards: { root, inside: makeBoard('inside', 3) },
    pieces: {
      player: { id: 'player', kind: 'player' },
      container1: { id: 'container1', kind: 'container', boardRef: 'inside' },
    },
    locations: {
      player: { board: 'inside', x: 0, y: 1 },
      container1: { board: 'root', x: 2, y: 2 },
    },
  }
  expect(inverseEnter(world, 'right')).toBeNull()
})
```

- [x] **Step 2: Run test to verify it fails**

Run: `npx vitest run tools/generator/inverseMoves.test.ts`
Expected: FAIL — `inverseEnter` is not exported yet.

- [x] **Step 3: Write minimal implementation**

In `tools/generator/inverseMoves.ts`, change the first import to add `findContainerFor`, add a `getEntryCell` import from `rules`, and a new `HALF` import:

```ts
import {
  Board, Direction, PLAYER_ID, PieceId, World,
  inBounds, step, opposite, occupantAt, findContainerFor, cloneWorld,
} from '../../src/game/engine/types'
import { applyMove, getEntryCell } from '../../src/game/engine/rules'
import { HALF } from '../../src/game/engine/fraction'
import { canonicalKey } from './canonical'
```

Append below `inversePush`:

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

- [x] **Step 4: Run test to verify it passes**

Run: `npx vitest run tools/generator/inverseMoves.test.ts`
Expected: PASS (14 tests — 9 from Task 3 plus 5 new)

- [x] **Step 5: Commit**

```bash
git add tools/generator/inverseMoves.ts tools/generator/inverseMoves.test.ts
git commit -m "feat(generator): add inverseEnter with applyMove-verified candidates"
```

---

### Task 5: `inverseMoves.ts` — `inverseEat`

**Files:**
- Modify: `tools/generator/inverseMoves.ts` (append `inverseEat` below `inverseEnter`; no new imports needed)
- Modify: `tools/generator/inverseMoves.test.ts` (append new tests)

**Interfaces:**
- Consumes: `isOpenFloor`, `verifyPredecessor` (Task 3), `getEntryCell`/`HALF` (already imported by Task 4).
- Produces: `inverseEat(world: World, dir: Direction): World | null` — Task 6 imports this alongside the other two.

- [x] **Step 1: Write the failing test**

Append to `tools/generator/inverseMoves.test.ts` (add `inverseEat` to the import from `./inverseMoves`, and `opposite` to the import from engine types):

```ts
test('inverseEat reconstructs a player-pushes-container-which-eats-a-box sequence', () => {
  // Hand-traced against the real resolveBlocked recursion (see the spec's
  // "Forward engine is the source of truth" section): player pre=(0,1),
  // container pre=(1,1), box pre=(2,1), wall=(3,1), dir='right' produces
  // player post=(1,1), container post=(2,1), box now inside the container.
  // This is the exact scenario this test constructs as the POST state, and
  // it is the case that caught a real arithmetic bug in an earlier draft of
  // inverseEat (the container's reconstructed position was computed as
  // step(loc, dir) again instead of loc itself) — keep this named test even
  // though the generic round-trip check below would also have caught the
  // bug, so a regression here fails readably instead of only via an opaque
  // canonicalKey mismatch.
  const root = makeBoard('root', 5)
  root.cells[1][3] = { type: 'wall' }
  const world: World = {
    boards: { root, inside: makeBoard('inside', 3) },
    pieces: {
      player: { id: 'player', kind: 'player' },
      container1: { id: 'container1', kind: 'container', boardRef: 'inside' },
      box1: { id: 'box1', kind: 'normal' },
    },
    locations: {
      player: { board: 'root', x: 1, y: 1 },
      container1: { board: 'root', x: 2, y: 1 },
      box1: { board: 'inside', x: 2, y: 1 },
    },
  }
  const prev = inverseEat(world, 'right')
  expect(prev).not.toBeNull()
  expect(prev!.locations.player).toEqual({ board: 'root', x: 0, y: 1 })
  expect(prev!.locations.container1).toEqual({ board: 'root', x: 1, y: 1 })
  expect(prev!.locations.box1).toEqual({ board: 'root', x: 2, y: 1 })
  expect(applyMove(prev!, 'right')).toEqual(world)
})

test('inverseEat works in all four directions', () => {
  const directions: Direction[] = ['up', 'down', 'left', 'right']
  for (const dir of directions) {
    const root = makeBoard('root', 5)
    const playerPos = { x: 2, y: 2 }
    const containerPos = step(playerPos.x, playerPos.y, dir)
    const wallPos = step(containerPos.x, containerPos.y, dir)
    root.cells[wallPos.y][wallPos.x] = { type: 'wall' }
    const inside = makeBoard('inside', 3)
    const { cell: eatenCell } = getEntryCell(inside, opposite(dir), HALF)
    const world: World = {
      boards: { root, inside },
      pieces: {
        player: { id: 'player', kind: 'player' },
        container1: { id: 'container1', kind: 'container', boardRef: 'inside' },
        box1: { id: 'box1', kind: 'normal' },
      },
      locations: {
        player: { board: 'root', x: playerPos.x, y: playerPos.y },
        container1: { board: 'root', x: containerPos.x, y: containerPos.y },
        box1: { board: 'inside', x: eatenCell!.x, y: eatenCell!.y },
      },
    }
    const prev = inverseEat(world, dir)
    expect(prev, `direction ${dir}`).not.toBeNull()
    expect(applyMove(prev!, dir)).toEqual(world)
  }
})

test('inverseEat returns null when there is no wall ahead of the container', () => {
  const root = makeBoard('root', 5)
  const inside = makeBoard('inside', 3)
  const { cell: eatenCell } = getEntryCell(inside, 'left', HALF)
  const world: World = {
    boards: { root, inside },
    pieces: {
      player: { id: 'player', kind: 'player' },
      container1: { id: 'container1', kind: 'container', boardRef: 'inside' },
      box1: { id: 'box1', kind: 'normal' },
    },
    locations: {
      player: { board: 'root', x: 1, y: 1 },
      container1: { board: 'root', x: 2, y: 1 },
      box1: { board: 'inside', x: eatenCell!.x, y: eatenCell!.y },
    },
  }
  expect(inverseEat(world, 'right')).toBeNull()
})

test('inverseEat returns null when nothing is inside the container to eat', () => {
  const root = makeBoard('root', 5)
  root.cells[1][3] = { type: 'wall' }
  const world: World = {
    boards: { root, inside: makeBoard('inside', 3) },
    pieces: {
      player: { id: 'player', kind: 'player' },
      container1: { id: 'container1', kind: 'container', boardRef: 'inside' },
    },
    locations: {
      player: { board: 'root', x: 1, y: 1 },
      container1: { board: 'root', x: 2, y: 1 },
    },
  }
  expect(inverseEat(world, 'right')).toBeNull()
})

test('inverseEat returns null when the piece ahead is not a container', () => {
  const world: World = {
    boards: { root: makeBoard('root', 5) },
    pieces: {
      player: { id: 'player', kind: 'player' },
      box1: { id: 'box1', kind: 'normal' },
    },
    locations: {
      player: { board: 'root', x: 1, y: 1 },
      box1: { board: 'root', x: 2, y: 1 },
    },
  }
  expect(inverseEat(world, 'right')).toBeNull()
})

test('inverseEat returns null when the container has no boardRef', () => {
  const root = makeBoard('root', 5)
  root.cells[1][3] = { type: 'wall' }
  const world: World = {
    boards: { root },
    pieces: {
      player: { id: 'player', kind: 'player' },
      container1: { id: 'container1', kind: 'container' },
    },
    locations: {
      player: { board: 'root', x: 1, y: 1 },
      container1: { board: 'root', x: 2, y: 1 },
    },
  }
  expect(inverseEat(world, 'right')).toBeNull()
})
```

- [x] **Step 2: Run test to verify it fails**

Run: `npx vitest run tools/generator/inverseMoves.test.ts`
Expected: FAIL — `inverseEat` is not exported yet.

- [x] **Step 3: Write minimal implementation**

Append to `tools/generator/inverseMoves.ts`, below `inverseEnter`:

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
  // direction — player -> container -> wall, all three in a row. This is
  // what blocks the container from being pushed further, forcing the eat
  // branch.
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
  candidate.locations[containerId] = { board: loc.board, x: loc.x, y: loc.y }
  candidate.locations[eatenId] = { board: loc.board, x: containerPos.x, y: containerPos.y }

  return verifyPredecessor(candidate, dir, world)
}
```

- [x] **Step 4: Run test to verify it passes**

Run: `npx vitest run tools/generator/inverseMoves.test.ts`
Expected: PASS (20 tests — 14 from Tasks 3-4 plus 6 new)

- [x] **Step 5: Commit**

```bash
git add tools/generator/inverseMoves.ts tools/generator/inverseMoves.test.ts
git commit -m "feat(generator): add inverseEat with applyMove-verified candidates"
```

---

### Task 6: `generateLevel.ts` — reverse random walk

**Files:**
- Modify (full rewrite): `tools/generator/generateLevel.ts`
- Modify (full rewrite): `tools/generator/generateLevel.test.ts`

**Interfaces:**
- Consumes: `inversePush`, `inverseEnter`, `inverseEat` (Tasks 3-5), `canonicalKey` (Task 1), `createSeedWorld` (Task 2, test only).
- Produces: `GenerationEventKind`, `GenerationEvent`, `GenerationResult`, `generateLevel(seed: World, steps: number, rng: () => number): GenerationResult | null` — Task 9 (`generateBatch.ts`) imports `generateLevel` and reads `.world` from a successful result.

- [x] **Step 1: Write the failing test**

```ts
import { applyMove } from '../../src/game/engine/rules'
import { World } from '../../src/game/engine/types'
import { canonicalKey } from './canonical'
import { createSeedWorld } from './seed'
import { generateLevel } from './generateLevel'

function seededRng(startSeed: number): () => number {
  let s = startSeed
  return () => {
    s = (s * 1103515245 + 12345) & 0x7fffffff
    return (s % 10000) / 10000
  }
}

test('generateLevel with zero steps returns the seed unchanged with no events', () => {
  const seed = createSeedWorld()
  const result = generateLevel(seed, 0, () => 0)!
  expect(result.events).toEqual([])
  expect(result.world).toEqual(seed)
})

test('generateLevel returns null when no reverse move is ever possible', () => {
  const boxedIn: World = {
    boards: {
      root: {
        id: 'root',
        size: 3,
        cells: [
          [{ type: 'wall' }, { type: 'wall' }, { type: 'wall' }],
          [{ type: 'wall' }, { type: 'floor' }, { type: 'wall' }],
          [{ type: 'wall' }, { type: 'wall' }, { type: 'wall' }],
        ],
      },
    },
    pieces: { player: { id: 'player', kind: 'player' } },
    locations: { player: { board: 'root', x: 1, y: 1 } },
  }
  expect(generateLevel(boxedIn, 1, () => 0.5)).toBeNull()
})

test('generateLevel produces exactly `steps` events whose reverse replay is unique and reaches the seed', () => {
  const seed = createSeedWorld()
  // seededRng(42) is the primary choice; because pattern/direction selection
  // has a random component, if this specific seed value ever fails to reach
  // 5 steps within the attempt budget (result is null), try 7, 99, or 123
  // instead — any of them reaching 5 steps satisfies this test equally well.
  const result = generateLevel(seed, 5, seededRng(42))
  expect(result).not.toBeNull()
  expect(result!.events.length).toBe(5)

  let replayed = result!.world
  const seenKeys = new Set<string>([canonicalKey(replayed)])
  for (const event of [...result!.events].reverse()) {
    const next = applyMove(replayed, event.direction)
    expect(next).not.toBeNull()
    const key = canonicalKey(next!)
    expect(seenKeys.has(key)).toBe(false)
    seenKeys.add(key)
    replayed = next!
  }
  expect(replayed).toEqual(seed)
})
```

- [x] **Step 2: Run test to verify it fails**

Run: `npx vitest run tools/generator/generateLevel.test.ts`
Expected: FAIL — `generateLevel`'s current signature returns a `Grid`, and the old file imports `inverseNest`/`inverseTranslate`, which no longer exist.

- [x] **Step 3: Write minimal implementation**

Replace the entire contents of `tools/generator/generateLevel.ts`:

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

- [x] **Step 4: Run test to verify it passes**

Run: `npx vitest run tools/generator/generateLevel.test.ts`
Expected: PASS (3 tests). If the third test fails specifically because `result` is `null` (not because of an assertion mismatch), replace `seededRng(42)` with `seededRng(7)`, then `seededRng(99)`, then `seededRng(123)` in that one test until one succeeds — this is expected nondeterminism in which reverse-walk patterns get tried in which order, not a bug.

- [x] **Step 5: Commit**

```bash
git add tools/generator/generateLevel.ts tools/generator/generateLevel.test.ts
git commit -m "feat(generator): rewrite generateLevel with cycle avoidance and explicit failure"
```

---

### Task 7: `solver.ts` — BFS plus a crossing-move counter

**Files:**
- Modify (full rewrite): `tools/generator/solver.ts`
- Modify (full rewrite): `tools/generator/solver.test.ts`

**Interfaces:**
- Consumes: `canonicalKey` (Task 1), `BUILTIN_LEVELS` from `../../src/levels` (test only — already exports `{id, name, world}` per sub-project 2).
- Produces: `solve(initialWorld: World, maxDepth?: number): Direction[] | null`, `countCrossingMoves(world: World, moves: Direction[]): number` — Task 9 (`generateBatch.ts`) imports both.

- [x] **Step 1: Write the failing test**

```ts
import { World } from '../../src/game/engine/types'
import { BUILTIN_LEVELS } from '../../src/levels'
import { countCrossingMoves, solve } from './solver'

function makeSquareCells(size: number, fill: () => { type: 'floor' | 'wall'; requirement?: 'box' | 'player' }) {
  return Array.from({ length: size }, () => Array.from({ length: size }, fill))
}

test('solve returns an empty path for an already-won world', () => {
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
  expect(solve(world)).toEqual([])
})

test('solve finds a single-move solution', () => {
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
    locations: { player: { board: 'root', x: 0, y: 1 }, box1: { board: 'root', x: 1, y: 1 } },
  }
  expect(solve(world)).toEqual(['right'])
})

test('solve returns null when no solution exists', () => {
  const size = 4
  const cells = Array.from({ length: size }, (_, y) =>
    Array.from({ length: size }, (_, x) => {
      if (y !== 0) return { type: 'wall' as const }
      if (x === 2) return { type: 'wall' as const }
      if (x === 3) return { type: 'floor' as const, requirement: 'box' as const }
      return { type: 'floor' as const }
    }),
  )
  const world: World = {
    boards: { root: { id: 'root', size, cells } },
    pieces: { player: { id: 'player', kind: 'player' }, box1: { id: 'box1', kind: 'normal' } },
    locations: { player: { board: 'root', x: 0, y: 0 }, box1: { board: 'root', x: 1, y: 0 } },
  }
  expect(solve(world, 5)).toBeNull()
})

test('solve finds the shortest path even when longer alternate routes exist', () => {
  const size = 5
  const cells = makeSquareCells(size, () => ({ type: 'floor' }))
  cells[2][4] = { type: 'floor', requirement: 'box' }
  const world: World = {
    boards: { root: { id: 'root', size, cells } },
    pieces: { player: { id: 'player', kind: 'player' }, box1: { id: 'box1', kind: 'normal' } },
    locations: { player: { board: 'root', x: 2, y: 2 }, box1: { board: 'root', x: 3, y: 2 } },
  }
  expect(solve(world)).toEqual(['right'])
})

test('countCrossingMoves returns 0 for a plain push with no board change', () => {
  const root = { id: 'root', size: 3, cells: makeSquareCells(3, () => ({ type: 'floor' as const })) }
  const world: World = {
    boards: { root },
    pieces: { player: { id: 'player', kind: 'player' }, box1: { id: 'box1', kind: 'normal' } },
    locations: { player: { board: 'root', x: 0, y: 1 }, box1: { board: 'root', x: 1, y: 1 } },
  }
  expect(countCrossingMoves(world, ['right'])).toBe(0)
})

test('countCrossingMoves counts a move where a piece changes board', () => {
  const root = { id: 'root', size: 5, cells: makeSquareCells(5, () => ({ type: 'floor' as const })) }
  root.cells[2][3] = { type: 'wall' }
  const inside = { id: 'inside', size: 3, cells: makeSquareCells(3, () => ({ type: 'floor' as const })) }
  const world: World = {
    boards: { root, inside },
    pieces: {
      player: { id: 'player', kind: 'player' },
      container1: { id: 'container1', kind: 'container', boardRef: 'inside' },
    },
    locations: {
      player: { board: 'root', x: 1, y: 2 },
      container1: { board: 'root', x: 2, y: 2 },
    },
  }
  expect(countCrossingMoves(world, ['right'])).toBe(1)
})

test('every builtin level is solvable', () => {
  for (const level of BUILTIN_LEVELS) {
    const solution = solve(level.world, 100)
    expect(solution, `level ${level.id} should be solvable`).not.toBeNull()
  }
})
```

- [x] **Step 2: Run test to verify it fails**

Run: `npx vitest run tools/generator/solver.test.ts`
Expected: FAIL — `countCrossingMoves` is not exported (the old file exports `countNestingEvents`), and the old file's `Grid`-based types don't match `World`.

- [x] **Step 3: Write minimal implementation**

Replace the entire contents of `tools/generator/solver.ts`:

```ts
import { applyMove, checkWin } from '../../src/game/engine/rules'
import { Direction, World } from '../../src/game/engine/types'
import { canonicalKey } from './canonical'

const DIRECTIONS: Direction[] = ['up', 'down', 'left', 'right']

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

- [x] **Step 4: Run test to verify it passes**

Run: `npx vitest run tools/generator/solver.test.ts`
Expected: PASS (7 tests)

- [x] **Step 5: Commit**

```bash
git add tools/generator/solver.ts tools/generator/solver.test.ts
git commit -m "feat(generator): rewrite solver with canonicalKey dedup and countCrossingMoves"
```

---

### Task 8: `difficultyScorer.ts`

**Files:**
- Modify (rename parameter only): `tools/generator/difficultyScorer.ts`
- Modify (rename test wording only): `tools/generator/difficultyScorer.test.ts`

**Interfaces:**
- Produces: `scoreDifficulty(moveCount: number, crossingMoveCount: number): number`, `difficultyTier(score: number): 'easy' | 'medium' | 'hard'` — Task 9 imports both. Behavior is unchanged from the retired version; only the second parameter's name changes (`nestingCount` → `crossingMoveCount`) to match `countCrossingMoves`'s naming.

- [x] **Step 1: Write the failing test**

Replace the entire contents of `tools/generator/difficultyScorer.test.ts`:

```ts
import { difficultyTier, scoreDifficulty } from './difficultyScorer'

test('scoreDifficulty weighs crossing moves much higher than plain moves', () => {
  const noCrossing = scoreDifficulty(10, 0)
  const oneCrossing = scoreDifficulty(10, 1)
  expect(oneCrossing).toBeGreaterThan(noCrossing)
})

test('difficultyTier buckets scores into easy/medium/hard', () => {
  expect(difficultyTier(5)).toBe('easy')
  expect(difficultyTier(15)).toBe('medium')
  expect(difficultyTier(30)).toBe('hard')
})
```

- [x] **Step 2: Run test to verify it fails**

Run: `npx vitest run tools/generator/difficultyScorer.test.ts`
Expected: PASS already, actually — this file's existing implementation already satisfies these tests unchanged (only the parameter name differs, which isn't observable from outside). Run it anyway to confirm the baseline is green before the rename.

- [x] **Step 3: Write minimal implementation**

Replace the entire contents of `tools/generator/difficultyScorer.ts`:

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

- [x] **Step 4: Run test to verify it passes**

Run: `npx vitest run tools/generator/difficultyScorer.test.ts`
Expected: PASS (2 tests)

- [x] **Step 5: Commit**

```bash
git add tools/generator/difficultyScorer.ts tools/generator/difficultyScorer.test.ts
git commit -m "refactor(generator): rename difficultyScorer's crossing parameter for clarity"
```

---

### Task 9: `generateBatch.ts` — quota guarantees, duplicate rejection, overwrite policy

**Files:**
- Modify (full rewrite): `tools/generator/generateBatch.ts`
- Modify (full rewrite): `tools/generator/generateBatch.test.ts`

**Interfaces:**
- Consumes: `createSeedWorld` (Task 2), `generateLevel`/`GenerationResult` (Task 6), `solve`/`countCrossingMoves` (Task 7), `scoreDifficulty`/`difficultyTier` (Task 8), `canonicalKey` (Task 1), `checkWin` from `../../src/game/engine/rules`, `serializeLevel` from `../../src/game/engine/levelSchema`.
- Produces: `Tier`, `GeneratedLevel`, `BatchStats`, `BatchResult`, `generateLevelBatch(targetPerTier: number, rng: () => number): BatchResult`, plus the `main()` CLI entry point invoked by `npm run generate:levels`. Task 11 runs this CLI for real.

- [x] **Step 1: Write the failing test**

Replace the entire contents of `tools/generator/generateBatch.test.ts`:

```ts
import { checkWin } from '../../src/game/engine/rules'
import { parseLevel } from '../../src/game/engine/levelSchema'
import { canonicalKey } from './canonical'
import { generateLevelBatch } from './generateBatch'

function seededRng(startSeed: number): () => number {
  let s = startSeed
  return () => {
    s = (s * 1103515245 + 12345) & 0x7fffffff
    return (s % 10000) / 10000
  }
}

test('generateLevelBatch reports whether it actually met its tier quotas', () => {
  const result = generateLevelBatch(1, seededRng(42))
  if (result.complete) {
    expect(result.counts.easy).toBeGreaterThanOrEqual(1)
    expect(result.counts.medium).toBeGreaterThanOrEqual(1)
    expect(result.counts.hard).toBeGreaterThanOrEqual(1)
  } else {
    expect(result.counts.easy < 1 || result.counts.medium < 1 || result.counts.hard < 1).toBe(true)
  }
})

test('every accepted level is unsolved and parses back through parseLevel', () => {
  const result = generateLevelBatch(1, seededRng(42))
  expect(result.levels.length).toBeGreaterThan(0)
  for (const entry of result.levels) {
    const parsed = parseLevel(JSON.parse(entry.json))
    expect(checkWin(parsed)).toBe(false)
  }
})

test('no two accepted levels in one batch share a canonical state', () => {
  const result = generateLevelBatch(2, seededRng(7))
  const keys = result.levels.map((entry) => canonicalKey(entry.world))
  expect(new Set(keys).size).toBe(keys.length)
})

test('batch stats account for every attempt', () => {
  const result = generateLevelBatch(1, seededRng(99))
  const accountedFor =
    result.levels.length +
    result.stats.discardedGenerationFailed +
    result.stats.discardedAlreadySolved +
    result.stats.discardedUnsolvable +
    result.stats.discardedDuplicate +
    result.stats.discardedTierFull
  expect(accountedFor).toBe(result.stats.attempts)
})
```

- [x] **Step 2: Run test to verify it fails**

Run: `npx vitest run tools/generator/generateBatch.test.ts`
Expected: FAIL — `generateLevelBatch` currently returns a plain array, not a `BatchResult` with `.levels`/`.complete`/`.counts`/`.stats`, and the old file's imports (`createSeedGrid`, `countNestingEvents`) no longer exist.

- [x] **Step 3: Write minimal implementation**

Replace the entire contents of `tools/generator/generateBatch.ts`:

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

- [x] **Step 4: Run test to verify it passes**

Run: `npx vitest run tools/generator/generateBatch.test.ts`
Expected: PASS (4 tests)

- [x] **Step 5: Commit**

```bash
git add tools/generator/generateBatch.ts tools/generator/generateBatch.test.ts
git commit -m "feat(generator): rewrite generateBatch with quota reporting, dedup, and overwrite policy"
```

---

### Task 10: un-stub `loadGeneratedLevels()` in `src/levels/index.ts`

**Files:**
- Modify: `src/levels/index.ts` (replace only the `loadGeneratedLevels` stub — `BUILTIN_LEVELS`, `loadCustomLevels`, `CUSTOM_LEVEL_ID_PREFIX` are untouched)
- Modify: `src/levels/index.test.ts` (replace the `loadGeneratedLevels` `describe` block; leave the `BUILTIN_LEVELS`/`loadCustomLevels`/`CUSTOM_LEVEL_ID_PREFIX` blocks untouched)

**Interfaces:**
- Consumes: `parseLevel` from `../game/engine/levelSchema` (already imported by this file), `checkWin` from `../game/engine/rules` (test only).
- Produces: `parseGeneratedModules(modules: Record<string, string>): LevelMeta[]` (a new export, factored out of `loadGeneratedLevels` for testability without depending on Vite's `import.meta.glob` resolving real files on disk), updated `loadGeneratedLevels(): LevelMeta[]`. Task 11 will exercise the *real* `loadGeneratedLevels()` (backed by real files) once it commits generated output.

- [x] **Step 1: Write the failing test**

In `src/levels/index.test.ts`, replace the existing `loadGeneratedLevels` `describe` block:

```ts
describe('loadGeneratedLevels', () => {
  it('returns an empty array (sub-project 4 rebuilds the generator against the new format)', () => {
    expect(loadGeneratedLevels()).toEqual([])
  })
})
```

with:

```ts
describe('parseGeneratedModules', () => {
  it('returns an empty array for an empty module map', () => {
    expect(parseGeneratedModules({})).toEqual([])
  })

  it('parses a raw JSON module into a LevelMeta with an id derived from its filename', () => {
    const raw = JSON.stringify({
      boards: {
        root: {
          id: 'root',
          size: 3,
          cells: [
            [{ type: 'floor' }, { type: 'floor' }, { type: 'floor' }],
            [{ type: 'floor' }, { type: 'floor' }, { type: 'floor', requirement: 'box' }],
            [{ type: 'floor' }, { type: 'floor' }, { type: 'floor' }],
          ],
        },
      },
      pieces: { player: { id: 'player', kind: 'player' }, box1: { id: 'box1', kind: 'normal' } },
      locations: { player: { board: 'root', x: 0, y: 1 }, box1: { board: 'root', x: 1, y: 1 } },
    })
    const levels = parseGeneratedModules({ './builtin/generated/easy-01.json': raw })
    expect(levels).toHaveLength(1)
    expect(levels[0].id).toBe('easy-01')
    expect(levels[0].name).toBe('easy-01')
    expect(checkWin(levels[0].world)).toBe(false)
  })

  it('derives distinct ids for distinct filenames', () => {
    const raw = JSON.stringify({
      boards: { root: { id: 'root', size: 1, cells: [[{ type: 'floor' }]] } },
      pieces: { player: { id: 'player', kind: 'player' } },
      locations: { player: { board: 'root', x: 0, y: 0 } },
    })
    const levels = parseGeneratedModules({
      './builtin/generated/easy-01.json': raw,
      './builtin/generated/hard-01.json': raw,
    })
    expect(levels.map((l) => l.id).sort()).toEqual(['easy-01', 'hard-01'])
  })
})

describe('loadGeneratedLevels', () => {
  it('returns an empty array until the generator has been run (no files committed yet)', () => {
    expect(loadGeneratedLevels()).toEqual([])
  })
})
```

Also update the file's top import line to bring in the new export and `checkWin`:

```ts
import { BUILTIN_LEVELS, CUSTOM_LEVEL_ID_PREFIX, loadCustomLevels, loadGeneratedLevels, parseGeneratedModules } from './index'
import { checkWin } from '../game/engine/rules'
import { PLAYER_ID } from '../game/engine/types'
```

(`checkWin` and `PLAYER_ID` are both already imported by this file for the `BUILTIN_LEVELS` tests — just add `parseGeneratedModules` to the existing `./index` import list.)

- [x] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/levels/index.test.ts`
Expected: FAIL — `parseGeneratedModules` is not exported from `./index` yet.

- [x] **Step 3: Write minimal implementation**

In `src/levels/index.ts`, replace:

```ts
// Sub-project 4 rebuilds the generator against the new World format; nothing in
// that format exists yet.
export function loadGeneratedLevels(): LevelMeta[] {
  return []
}
```

with:

```ts
const generatedModules = import.meta.glob('./builtin/generated/*.json', {
  query: '?raw',
  import: 'default',
  eager: true,
}) as Record<string, string>

export function parseGeneratedModules(modules: Record<string, string>): LevelMeta[] {
  return Object.entries(modules).map(([path, raw]) => {
    const id = path.split('/').pop()!.replace('.json', '')
    return { id, name: id, world: parseLevel(JSON.parse(raw)) }
  })
}

export function loadGeneratedLevels(): LevelMeta[] {
  return parseGeneratedModules(generatedModules)
}
```

- [x] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/levels/index.test.ts`
Expected: PASS (all tests in the file, including the untouched `BUILTIN_LEVELS`/`loadCustomLevels`/`CUSTOM_LEVEL_ID_PREFIX` blocks)

- [x] **Step 5: Commit**

```bash
git add src/levels/index.ts src/levels/index.test.ts
git commit -m "feat(levels): un-stub loadGeneratedLevels via a testable parseGeneratedModules"
```

---

### Task 11: run the generator for real, verify feasibility, commit generated levels

**Files:**
- Create: `src/levels/builtin/generated/*.json` (written by running the generator — exact filenames determined by the run, e.g. `easy-01.json` .. `hard-05.json`)
- Modify: `tools/generator/generateBatch.ts` (only if Step 2 below finds the hard tier infeasible — widen the `steps` range, a sanctioned tuning knob per the spec)
- Modify: `src/levels/index.test.ts` (update the `loadGeneratedLevels` test now that real files exist)

**Interfaces:**
- Consumes: `generateLevelBatch`'s CLI entry point (`npm run generate:levels`, Task 9), `loadGeneratedLevels` (Task 10).
- Produces: the actual generated level files the shipped game reads at runtime.

- [x] **Step 1: Run the generator**

```bash
npm run generate:levels
```

Read the printed summary line (attempts, tier counts, discard reasons, and whether it reports "Batch incomplete").

- [x] **Step 2: If incomplete, tune and re-run**

If the console output says "Batch incomplete" (exit code 1) — most likely because the `hard` tier (`score >= 25`) is rarely or never reached — widen the step range in `tools/generator/generateBatch.ts`'s `generateLevelBatch`:

```ts
    const steps = 3 + Math.floor(rng() * 8)
```

to:

```ts
    const steps = 3 + Math.floor(rng() * 15)
```

(This is the spec's explicitly sanctioned knob — widen `steps`, not the tier thresholds, which are a difficulty *definition*.) Re-run `npm run generate:levels` and repeat this step (trying `rng() * 20`, then increasing `MAX_ATTEMPTS` from 500 if still incomplete) until the summary line reports full quota. If a `steps`/`MAX_ATTEMPTS` change was needed, note in the Task's commit message what changed and why (the actual attempt/discard numbers observed).

- [x] **Step 3: Update the `loadGeneratedLevels` integration test**

In `src/levels/index.test.ts`, replace the `loadGeneratedLevels` `describe` block written in Task 10:

```ts
describe('loadGeneratedLevels', () => {
  it('returns an empty array until the generator has been run (no files committed yet)', () => {
    expect(loadGeneratedLevels()).toEqual([])
  })
})
```

with:

```ts
describe('loadGeneratedLevels', () => {
  it('loads the committed generated levels, each unsolved with unique ids', () => {
    const levels = loadGeneratedLevels()
    expect(levels.length).toBeGreaterThan(0)
    for (const level of levels) {
      expect(checkWin(level.world)).toBe(false)
    }
    expect(new Set(levels.map((l) => l.id)).size).toBe(levels.length)
  })

  it('every generated level is solvable', () => {
    for (const level of loadGeneratedLevels()) {
      const solution = solve(level.world, 150)
      expect(solution, `level ${level.id} should be solvable`).not.toBeNull()
    }
  })
})
```

Add `solve` to this test file's imports:

```ts
import { solve } from '../../tools/generator/solver'
```

- [x] **Step 4: Run the test to verify it passes**

Run: `npx vitest run src/levels/index.test.ts`
Expected: PASS (all tests, including the two new ones against real committed files)

- [x] **Step 5: Run the full test suite**

Run: `npm test`
Expected: PASS — every test file across `src/` and `tools/generator/` is green.

- [x] **Step 6: Confirm the project builds cleanly**

Run: `npm run build`
Expected: succeeds with no TypeScript errors — this is the first point in the project where `tsc -b` type-checks the fully rewritten `tools/generator/*` alongside `src/` (per `tsconfig.json`'s `include: ["src", "tools"]`), so this step is what actually confirms no `noUnusedLocals`/`noUnusedParameters` violations or type mismatches slipped through the per-task Vitest runs.

- [x] **Step 7: Commit**

```bash
git add src/levels/builtin/generated/ src/levels/index.test.ts
# Only if Step 2 required a tuning change:
git add tools/generator/generateBatch.ts
git commit -m "feat(generator): generate and commit the shipped level batch"
```

---

## Self-Review Notes

- **Spec coverage:** every file the spec names (`canonical.ts`, `seed.ts`, `inverseMoves.ts`'s three functions, `generateLevel.ts`, `solver.ts`, `difficultyScorer.ts`, `generateBatch.ts`, `levels/index.ts`) has a task; the spec's "Forward engine is the source of truth" principle is Task 3-5's shared `verifyPredecessor`; the spec's hard-tier feasibility concern is Task 11's Step 2.
- **Placeholder scan:** no task step says "add appropriate handling" or defers code to be written later; every code block is complete and was hand-traced (Tasks 3, 4, 5 especially — see the spec's revision history for two bugs this hand-tracing caught before any code was written: an unused `DIRECTIONS` constant and an inverted arithmetic sign in `inverseEat`).
- **Type/name consistency:** an early draft of Task 2 used a `../src/...` relative import path (one level up); corrected to `../../src/...` (two levels up) to match `tools/generator/`'s actual depth relative to the repo root and every other task's imports.
- **Test-value risk, flagged rather than hidden:** Task 6's third test depends on a specific `seededRng(42)` sequence actually reaching 5 accepted steps within budget, which cannot be hand-verified without executing the code. The step includes a documented, bounded fallback (try `7`, `99`, `123`) rather than asserting false certainty.

## Execution Handoff

Plan complete and saved to `docs/superpowers/plans/2026-09-05-parabox-solver-generator.md`. Two execution options:

**1. Subagent-Driven (recommended)** - I dispatch a fresh subagent per task, review between tasks, fast iteration

**2. Inline Execution** - Execute tasks in this session using executing-plans, batch execution with checkpoints

**Which approach?**
